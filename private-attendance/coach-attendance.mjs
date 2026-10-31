import {deny} from './coach-store.mjs';
const defaultFields=Object.freeze({status:'Attendance status',player:'Player',session:'Session',coverage:'Coverage state',date:'Session date',linkedDate:'Web session date',sessionStatus:'Web session status'}),links=v=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:x.id):[];
export function createCoachAttendance({store,coaches,baseId,tableId,token,writesEnabled=false,fieldMap=defaultFields,timeZone='America/Vancouver',fetchFn=fetch,clock=()=>new Date()}){
 const dayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 if(!/^app[A-Za-z0-9]{14}$/.test(baseId)||!/^tbl[A-Za-z0-9]{14}$/.test(tableId))throw Error('INVALID_ATTENDANCE_TARGET');
 const keys=Object.keys(defaultFields);if(!fieldMap||typeof fieldMap!=='object'||Object.keys(fieldMap).length!==keys.length||keys.some(key=>typeof fieldMap[key]!=='string'||!fieldMap[key].trim()||fieldMap[key].length>100)||new Set(Object.values(fieldMap)).size!==keys.length)throw Error('INVALID_ATTENDANCE_FIELDS');const fields=Object.fromEntries(keys.map(key=>[key,fieldMap[key]])),useFieldIds=keys.every(key=>/^fld[A-Za-z0-9]{14}$/.test(fields[key]));if(!useFieldIds&&keys.some(key=>/^fld[A-Za-z0-9]{14}$/.test(fields[key])))throw Error('MIXED_ATTENDANCE_FIELDS');
 async function request(id,method='GET',body){const url=new URL('https://api.airtable.com/v0/'+baseId+'/'+tableId+'/'+id);url.searchParams.set('returnFieldsByFieldId',String(useFieldIds));const r=await fetchFn(url,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000),...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw Error('ATTENDANCE_SYNC_PENDING');return r.json();}
 const assertWritable=()=>{if(writesEnabled!==true)deny('ATTENDANCE_WRITES_DISABLED',503);};
 return {assertWritable,async save(actor,input,session){
  assertWritable();
  const {commandId,sessionId,attendanceId,playerId,status,expectedStatus}=input;coaches.requireSession(actor,sessionId);
  if(typeof commandId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(commandId)||![attendanceId,playerId].every(x=>typeof x==='string'&&/^rec[A-Za-z0-9]{14}$/.test(x))||!['Not marked','Present','Absent'].includes(status)||!['Not marked','Present','Absent'].includes(expectedStatus))deny('INVALID_ATTENDANCE_CHANGE',400);
  if(!session||session.id!==sessionId||!session.players.some(p=>p.playerId===playerId&&p.attendanceId===attendanceId))deny();
  const today=dayFormatter.format(clock());if(status!=='Not marked'&&(session.date>today||session.status==='Cancelled'))deny('SESSION_NOT_STARTED',409);
  const payload=JSON.stringify({sessionId,attendanceId,playerId,status,expectedStatus}),old=store.get('SELECT * FROM coach_attendance_commands WHERE id=?',commandId);
  if(old&&(old.actor_email!==actor.email||old.payload!==payload))deny('COMMAND_CONFLICT',409);
  const inspect=r=>{if(r?.id!==attendanceId||links(r.fields?.[fields.player]).length!==1||links(r.fields?.[fields.session]).length!==1||links(r.fields[fields.player])[0]!==playerId||links(r.fields[fields.session])[0]!==sessionId||r.fields[fields.coverage]!=='Active'||r.fields[fields.date]!==session.date||(!Array.isArray(r.fields[fields.linkedDate])||r.fields[fields.linkedDate].length!==1||r.fields[fields.linkedDate][0].slice(0,10)!==session.date)||(r.fields[fields.sessionStatus]||[]).includes('Cancelled'))deny('ATTENDANCE_IDENTITY_CHANGED',409);return r.fields[fields.status]||'Not marked';};
  const before=inspect(await request(attendanceId));if(!['Not marked','Present','Absent'].includes(before))deny('ATTENDANCE_CHANGED',409);
  // A retried acknowledgement must not restore an older answer in the client or roster cache.
  if(old?.state==='confirmed')return {saved:true,duplicate:true,status:before,...(before!==status?{superseded:true}:{})};
  if(old&&before===status){store.run("UPDATE coach_attendance_commands SET state='confirmed' WHERE id=?",commandId);coaches.recordAudit(actor,'attendance-recovered',attendanceId,{status,sessionId});return {saved:true,recovered:true,status};}
  if(before!==expectedStatus)deny('ATTENDANCE_CHANGED',409);if(before===status)return {saved:true,noChange:true,status};
  if(!old)store.run('INSERT INTO coach_attendance_commands VALUES(?,?,?,?,?,?,?)',commandId,actor.email,sessionId,attendanceId,payload,'pending',clock().toISOString());
  try{await request(attendanceId,'PATCH',{fields:{[fields.status]:status}});if(inspect(await request(attendanceId))!==status)throw Error('ATTENDANCE_SYNC_PENDING');}catch{deny('ATTENDANCE_SYNC_PENDING',503);}
  store.run("UPDATE coach_attendance_commands SET state='confirmed' WHERE id=?",commandId);coaches.recordAudit(actor,'attendance-marked',attendanceId,{sessionId,previous:before,status});return {saved:true,status};
 }};
}
