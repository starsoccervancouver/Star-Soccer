import {buildOwnerOverview} from './owner-overview.mjs';
/* On-demand, fully paginated reads. No public counts, payments or bookings are written. */
import {createHash} from 'node:crypto';
import {parseMirrorNotes} from './airtable-adapter.mjs';
const links=v=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:x.id):[];
const one=v=>{const a=links(v);if(a.length!==1)throw new Error('AMBIGUOUS_ROSTER_IDENTITY');return a[0];};
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
export function sessionTimes(value){
 const parts=String(value).toLowerCase().replace(/noon/g,'12:00 pm').split(/\s*[–—-]\s*/);if(parts.length!==2)throw new Error('INVALID_SESSION_TIME');
 const expand=s=>s.trim().replace(/^(\d{1,2})\s*(am|pm)$/,'$1:00 $2');parts[0]=expand(parts[0]);parts[1]=expand(parts[1]);
 if(!/(am|pm)$/.test(parts[0])&&/(am|pm)$/.test(parts[1]))parts[0]+=' '+parts[1].match(/(am|pm)$/)[1];
 return parts;
}
export function vancouverInstant(day,time){return sessionInstant(day,time,'America/Vancouver');}
export function sessionInstant(day,time,timeZone='America/Vancouver'){
 if(!date(day))throw new Error('INVALID_SESSION_DATE');
 const m=/^(\d{1,2}):(\d{2})\s*(am|pm)$/i.exec(time.trim());if(!m||+m[1]<1||+m[1]>12||+m[2]>59)throw new Error('INVALID_SESSION_TIME');
 const target=Date.parse(day+'T'+String((+m[1]%12)+(m[3].toLowerCase()==='pm'?12:0)).padStart(2,'0')+':'+m[2]+':00Z');
 // BC ended seasonal clock changes in March 2026; keep older runtime tzdata safe.
 if(timeZone==='America/Vancouver'&&day>='2026-03-09')return new Date(target+7*3600000).toISOString();
 const format=new Intl.DateTimeFormat('sv-SE',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
 let guess=target;for(let i=0;i<3;i++){const shown=Date.parse(format.format(new Date(guess)).replace(' ','T')+'Z');guess+=target-shown;}
 if(Date.parse(format.format(new Date(guess)).replace(' ','T')+'Z')!==target)throw new Error('INVALID_SESSION_TIME');return new Date(guess).toISOString();
}
export function normalizeAirtableRoster({tables,observedAt,revision,verifiedContacts={},timeZone='America/Vancouver'}){
 const by=name=>new Map((tables[name]||[]).map(r=>[r.id,r.fields]));
 const sessions=by('sessions'),players=by('players'),families=by('families'),bookings=by('bookings'),enrollments=by('enrollments'),registrations=by('registrations');
 const result=[],history=[],preferences=[];
 for(const [id,s]of sessions){
  if(!['Planned','Confirmed','Cancelled','Completed'].includes(s['Session status'])||s.Capacity!==20)throw new Error('INVALID_SESSION_OR_CAPACITY');
  const times=sessionTimes(s.Time);
  result.push({id,label:s.Session,startAt:sessionInstant(s.Date,times[0],timeZone),endAt:sessionInstant(s.Date,times[1],timeZone),location:s.Venue,capacity:20,status:s['Session status']==='Cancelled'?'cancelled':s['Session status']==='Completed'?'completed':'scheduled',ownerExpected:s['Expected headcount (owner reported)']??0,entries:[]});
 }
 const sessionMap=new Map(result.map(s=>[s.id,s]));
 for(const r of tables.attendance||[]){const a=r.fields;if(a['Coverage state']==='Void')continue;if(a['Coverage state']!=='Active')throw new Error('UNVERIFIED_COVERAGE');
  const playerId=one(a.Player),sessionId=one(a.Session),p=players.get(playerId),s=sessionMap.get(sessionId);if(!p||!s)throw new Error('UNRESOLVED_ROSTER_IDENTITY');
  if(p['Player status']==='Inactive')continue;if(!['Active','Name to confirm'].includes(p['Player status']))throw new Error('UNKNOWN_PLAYER_STATUS');
  const familyId=one(p.Family),f=families.get(familyId);if(!f)throw new Error('UNRESOLVED_FAMILY');
  const day=sessions.get(sessionId).Date;if(a['Session date']!==day)throw new Error('COVERAGE_DATE_CONFLICT');
  let kind,enrollment;
  if(links(a.Booking).length){const b=bookings.get(one(a.Booking));if(!b)throw new Error('MISSING_BOOKING');if(['Cancelled','Completed'].includes(b['Booking status']))continue;
   if(b['Booking status']!=='Accepted'||!links(b.Player).includes(playerId)||one(b.Family)!==familyId)throw new Error('UNVERIFIED_BOOKING');
   const dates=String(b['Covered dates']||b['Start date']||'').match(/\d{4}-\d{2}-\d{2}/g)||[];if(!dates.includes(day))throw new Error('UNCOVERED_SESSION');
   kind=b['Booking type']==='Four consecutive sessions'?'pass':b['Booking type']==='Drop-in'?'dropin':null;
  }else{
   enrollment=enrollments.get(one(a.Enrollment));
   if(!enrollment||enrollment['Enrollment status']!=='Active'||enrollment['Billing approval']!=='Approved'||one(enrollment.Player)!==playerId||one(enrollment.Family)!==familyId||one(enrollment['Weekly program'])!==one(sessions.get(sessionId)['Weekly program'])||!date(enrollment['Effective from'])||day<enrollment['Effective from']||enrollment['Effective until']&&day>enrollment['Effective until'])throw new Error('UNVERIFIED_ENROLLMENT');
   kind=enrollment['Billing schedule']==='Four-session prepaid'?'pass':'dropin';
  }
  for(const regId of links(a['Website Registrations'])){const k=registrations.get(regId)?.['Registration kind'];if(['SS-CAMP-V2','SS-CAMP-DROPIN-V1'].includes(k))kind='camp';if(k==='SS-PASS-V1')kind='pass';}
  if(!kind)throw new Error('UNKNOWN_BOOKING_KIND');
  // Legacy sync is scoped to RSVP Reminders and exact Calendar references.
  // Never issue custom capabilities for a row still linked to that workflow.
  if(kind==='dropin'&&(links(a['RSVP Reminders']).length||links(a['RSVP reminder']).length))throw new Error('LEGACY_RSVP_OWNERSHIP_HOLD');
  const matches=[...enrollments].filter(([,e])=>links(e.Player).includes(playerId)&&links(e.Family).includes(familyId)&&e['Enrollment status']==='Active');
  const choices=matches.map(([,e])=>e['Weekly attendance email preference']);
  const pref=choices.includes('Opted out')?'disabled':choices.length&&choices.every(v=>v==='Enabled')?'enabled':'unknown';
  const verified=verifiedContacts[familyId];
  s.entries.push({playerId,familyId,attendanceId:r.id,name:p.Player,guardianName:f['Guardian name']||null,emailVerified:!!verified?.evidence&&verified.email===f.Email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.Email||''),kind,reserved:true,eligible:true,reminderPreference:pref});
  const meta=parseMirrorNotes(a['RSVP response notes']).event;
  const response=a['RSVP status']==='Yes'?'yes':a['RSVP status']==='No'?'no':null;
  if(meta&&(meta.playerId!==playerId||meta.sessionId!==sessionId||meta.attendanceId!==r.id||meta.response!==response))throw new Error('RSVP_HISTORY_CONFLICT');
  if(response&&!a['RSVP updated at'])throw new Error('RSVP_HISTORY_TIMESTAMP_REQUIRED');
  history.push({attendanceId:r.id,physicalAttendance:a['Attendance status']||'Not marked',response,version:meta?.version||1,updatedAt:a['RSVP updated at']||null});
  for(const [enrollmentId]of matches)preferences.push({enrollmentId,playerId,familyId});
 }
 return {snapshot:{schemaVersion:1,source:'airtable-verified',snapshotId:'read_'+digest(tables).slice(0,20),revision,observedAt,complete:true,approved:true,sessions:result},history,preferences};
}
export const readFields={
 sessions:['Session','Date','Time','Venue','Session status','Capacity','Expected headcount (owner reported)','Weekly program','Attendance'],
 attendance:['Player','Session','Booking','Enrollment','Coverage state','Session date','Website Registrations','RSVP response notes','RSVP status','RSVP updated at','Attendance status','RSVP Reminders','RSVP reminder','Session preparation status','Billing schedule at date'],
 players:['Player','Player status','Family','Age'],families:['Guardian name','Email'],
 bookings:['Booking type','Booking status','Player','Family','Covered dates','Start date'],
 enrollments:['Enrollment status','Billing approval','Player','Family','Effective from','Effective until','Billing schedule','Weekly program','Weekly attendance email preference'],
 registrations:['Registration kind']
};
export function createRosterReader({baseId,token,tableMap,verifiedContacts={},timeZone='America/Vancouver',fetchFn=fetch,clock=()=>new Date()}={}){
 if(!/^app[A-Za-z0-9]{14}$/.test(baseId)||!token||!tableMap||Object.keys(readFields).some(name=>!/^tbl[A-Za-z0-9]{14}$/.test(tableMap[name]||'')))throw new Error('PRIVATE_AIRTABLE_CONFIGURATION_REQUIRED');
 async function read(name){const rows=[],seen=new Set(),offsets=new Set();let offset;do{const url=new URL('https://api.airtable.com/v0/'+baseId+'/'+tableMap[name]);url.searchParams.set('pageSize','100');for(const f of readFields[name])url.searchParams.append('fields[]',f);if(offset)url.searchParams.set('offset',offset);const r=await fetchFn(url,{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('AIRTABLE_READ_FAILED');const v=await r.json();if(!Array.isArray(v.records))throw new Error('INCOMPLETE_AIRTABLE_READ');for(const row of v.records){if(seen.has(row.id)||!row.fields)throw new Error('INVALID_AIRTABLE_PAGE');seen.add(row.id);rows.push(row);}if(rows.length>10000||v.offset&&offsets.has(v.offset))throw new Error('AIRTABLE_PAGE_LIMIT');offset=v.offset;if(offset)offsets.add(offset);}while(offset);return rows;}
 async function collect(){const observedAt=clock().toISOString(),tables={};for(const name of ['sessions','attendance','players','families','bookings','enrollments','registrations'])tables[name]=await read(name);
  // A second read rejects changes during collection, rather than blessing an incomplete roster.
  const second=await read('attendance'),sessions=await read('sessions');if(digest(second)!==digest(tables.attendance)||digest(sessions)!==digest(tables.sessions))throw new Error('ROSTER_CHANGED_DURING_READ');
  const allIds=new Set(tables.attendance.map(r=>r.id));for(const s of tables.sessions)if(links(s.fields.Attendance).some(id=>!allIds.has(id)))throw new Error('INCOMPLETE_AIRTABLE_READ');
  return {tables,observedAt};
 }
 return {async overview(){const {tables,observedAt}=await collect();return buildOwnerOverview(tables,observedAt,verifiedContacts);},async read(revision,sessionId){if(!/^rec[A-Za-z0-9]{14}$/.test(sessionId||''))throw new Error('EXACT_SESSION_REQUIRED');const {tables,observedAt}=await collect();
  tables.sessions=tables.sessions.filter(r=>r.id===sessionId);if(tables.sessions.length!==1)throw new Error('SESSION_NOT_FOUND');tables.attendance=tables.attendance.filter(r=>links(r.fields.Session).includes(sessionId));
  return normalizeAirtableRoster({tables,observedAt,revision,verifiedContacts,timeZone});}};
}
