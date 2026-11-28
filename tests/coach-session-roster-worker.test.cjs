const {test}=require('node:test');
const assert=require('node:assert/strict');
const {DatabaseSync}=require('node:sqlite');

function makeStorage(t){
  const db=new DatabaseSync(':memory:'),values=new Map();
  t.after(()=>db.close());
  return {
   sql:{exec(query,...args){
    let rows=[],written=0;
    if(!args.length&&query.includes(';'))db.exec(query);
    else{const stmt=db.prepare(query);if(stmt.columns().length)rows=stmt.all(...args);else written=Number(stmt.run(...args).changes);}
    return {toArray:()=>rows,rowsWritten:written};
   }},
   transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},
   async get(key){return values.get(key);},
   async put(key,value){values.set(key,value);},
   async setAlarm(value){this.nextAlarm=value;}
  };
 }

test('permanent roster sync has its own retrying alarm and updates the workspace cache',async t=>{
 const [{AttendanceCoordinator},{gmailHost}]=await Promise.all([
  import('../private-attendance/cloudflare/production-worker.mjs'),import('../private-attendance/gmail-cloud.mjs')
 ]);
 const workers=new Map();
 const env={ATTENDANCE_MODE:'live',LIVE_EMAIL_SENDS:'false',OWNER_APPROVED:'true',LIVE_AIRTABLE_WRITES:'true',
  ADMIN_KEY:'a'.repeat(43),COOKIE_KEY:'b'.repeat(43),AIRTABLE_TOKEN:'fictional',AIRTABLE_CONFIG:'{}',
  ATTENDANCE_COORDINATOR:{idFromName:name=>name,get:name=>({fetch:(input,options)=>workers.get(name).fetch(input instanceof Request?input:new Request(input,options))})}};
 const ledger=new AttendanceCoordinator({storage:makeStorage(t)},env);
 const timerStorage=makeStorage(t),timer=new AttendanceCoordinator({storage:timerStorage},env);
 const workspace=new AttendanceCoordinator({storage:makeStorage(t)},env);
 workers.set('private-gmail-ledger-v1',ledger);
 workers.set('coach-roster-scheduler-v1',timer);
 workers.set('single-private-writer-v1',workspace);
 let syncs=0,invalidations=0;
 ledger.rosterManager={
  async add(){return {saved:true,recurring:true,added:1};},
  async sync(){syncs++;return {added:1,issues:[{sessionId:'rec00000000000001',player:'Fictional',reason:'Permanent player needs roster review'}]};}
 };
 workspace.invalidateRoster=()=>{invalidations++;};
 const response=await ledger.fetch(new Request('https://'+gmailHost+'/coach-roster-add',{method:'POST',body:JSON.stringify({actor:'owner@example.test',input:{mode:'permanent'}})}));
 assert.equal(response.status,200);
 assert.equal(await timerStorage.get('roster-scheduler'),true);
 assert(timerStorage.nextAlarm>Date.now());
 await timer.alarm();
 assert.equal(syncs,1);assert.equal(invalidations,1);
 assert(timerStorage.nextAlarm>Date.now());
 const issue=workspace.store.get("SELECT value FROM runtime_state WHERE key='coach-roster-issues'");
 assert.equal(JSON.parse(issue.value)[0].reason,'Permanent player needs roster review');
 ledger.rosterManager.sync=async()=>{throw Error('fictional network failure');};
 await assert.rejects(timer.alarm(),/ROSTER_SYNC_FAILED/);
 assert(timerStorage.nextAlarm>Date.now(),'The next attempt is scheduled before a failed sync');
});

test('the production coordinator reads and writes a drop-in through Airtable',async t=>{
 const [{AttendanceCoordinator},{gmailHost}]=await Promise.all([
  import('../private-attendance/cloudflare/production-worker.mjs'),import('../private-attendance/gmail-cloud.mjs')
 ]);
 const rid=n=>'rec'+String(n).padStart(14,'0'),tid=n=>'tbl'+String(n).padStart(14,'0');
 const names=['sessions','players','families','programs','attendance','bookings','enrollments'];
 const ids=Object.fromEntries(names.map((name,index)=>[name,tid(index)]));
 const records={
  sessions:[{id:rid(1),fields:{Session:'Friday',Date:'2026-11-27','Session status':'Planned','Weekly program':[rid(9)]}}],
  players:[{id:rid(10),fields:{Player:'Fictional Player','Player status':'Active',Family:[rid(11)]}}],
  families:[{id:rid(11),fields:{Family:'Fictional Family'}}],
  programs:[{id:rid(9),fields:{Program:'Friday','Drop-in CAD':30}}],
  attendance:[],bookings:[],enrollments:[]
 };
 let next=100;
 const original=global.fetch;
 global.fetch=async(url,options={})=>{
  const name=names.find(key=>ids[key]===decodeURIComponent(new URL(url).pathname.split('/').pop()));
  assert(name,'The fixture permits only its Airtable tables');
  if(!options.method||options.method==='GET')return Response.json({records:records[name]});
  assert.equal(options.method,'PATCH');
  const payload=JSON.parse(options.body),key=payload.performUpsert.fieldsToMergeOn[0];
  const output=payload.records.map(item=>{
   let record=records[name].find(row=>row.fields[key]===item.fields[key]);
   if(!record){record={id:rid(next++),fields:{}};records[name].push(record);}
   Object.assign(record.fields,item.fields);
   return record;
  });
  return Response.json({records:output});
 };
 t.after(()=>{global.fetch=original;});
 const env={ATTENDANCE_MODE:'live',LIVE_EMAIL_SENDS:'false',OWNER_APPROVED:'true',LIVE_AIRTABLE_WRITES:'true',
  ADMIN_KEY:'a'.repeat(43),COOKIE_KEY:'b'.repeat(43),AIRTABLE_TOKEN:'fictional',
  AIRTABLE_CONFIG:JSON.stringify({baseId:'app00000000000000',tables:ids})};
 const worker=new AttendanceCoordinator({storage:makeStorage(t)},env);
 const call=(operation,input)=>worker.fetch(new Request('https://'+gmailHost+'/'+operation,{method:'POST',body:JSON.stringify({actor:'owner@example.test',input})}));
 const options=await call('coach-roster-options',{sessionId:rid(1)});
 assert.equal(options.status,200);
 assert.equal((await options.json()).players[0].name,'Fictional Player');
 const added=await call('coach-roster-add',{id:'00000000-0000-4000-8000-000000000001',sessionId:rid(1),playerId:rid(10),mode:'dropin',rateCents:3000});
 assert.equal(added.status,200);
 assert.equal(records.bookings[0].fields['Charge CAD'],30);
 assert.equal(records.attendance[0].fields['Attendance status'],'Not marked');
 assert.deepEqual(records.attendance[0].fields.Booking,[records.bookings[0].id]);
});
