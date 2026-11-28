const {test}=require('node:test');
const assert=require('node:assert/strict');
const rid=n=>'rec'+String(n).padStart(14,'0');
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const row=(id,fields)=>({id,fields});

async function fixture(t){
 const {openStore}=await import('../private-attendance/sqlite-store.mjs');
 const {createSessionRoster}=await import('../private-attendance/coach-session-roster.mjs');
 const store=openStore();t.after(()=>store.close());
 const tables={
  sessions:[
   row(rid(1),{Session:'Friday training',Date:'2026-11-27',Time:'4 PM',Venue:'Fictional field','Session status':'Planned','Weekly program':[rid(9)]}),
   row(rid(2),{Session:'Friday training',Date:'2026-12-04',Time:'4 PM',Venue:'Fictional field','Session status':'Planned','Weekly program':[rid(9)]}),
   row(rid(3),{Session:'Friday training',Date:'2026-12-11',Time:'4 PM',Venue:'Fictional field','Session status':'Cancelled','Weekly program':[rid(9)]})
  ],
  players:[row(rid(10),{Player:'Fictional Player','Player status':'Active',Family:[rid(11)]})],
  families:[row(rid(11),{Family:'Fictional Family','Guardian name':'Fictional Parent'})],
  programs:[row(rid(9),{Program:'Friday','Drop-in CAD':30})],
  attendance:[],bookings:[],enrollments:[]
 };
 let next=100,failAfter=null;
 const db={
  async list(name){return structuredClone(tables[name]);},
  async save(name,fields,{key}){
   let record=tables[name].find(item=>item.fields[key]===fields[key]);
   if(!record){record=row(rid(next++),{});tables[name].push(record);}
   Object.assign(record.fields,structuredClone(fields));
   if(failAfter===name){failAfter=null;throw Error('response lost');}
   return structuredClone(record);
  }
 };
 const roster=createSessionRoster({db,store,today:()=> '2026-11-27'});
 return {roster,tables,fail:name=>{failAfter=name;}};
}

test('player options include the group rate and an existing approved player rate',async t=>{
 const {roster,tables}=await fixture(t);
 tables.enrollments.push(row(rid(41),{Player:[rid(10)],Family:[rid(11)],'Weekly program':[rid(9)],
  'Enrollment status':'Active','Billing schedule':'Per session','Billing approval':'Approved','Agreed per-session CAD':25.5}));
 const result=await roster.options(rid(1));
 assert.equal(result.rate,30);
 assert.equal(result.players[0].agreedRate,25.5);
 assert.equal(result.families[0].name,'Fictional Parent');
});

test('drop-in creates one attendance-based booking and retries safely after a lost response',async t=>{
 const {roster,tables,fail}=await fixture(t);
 const input={id:uid(1),sessionId:rid(1),playerId:rid(10),mode:'dropin',rateCents:3000};
 fail('bookings');
 await assert.rejects(roster.add('owner@example.test',input),/response lost/);
 const result=await roster.add('owner@example.test',input);
 assert.equal(result.added,1);
 assert.equal(tables.bookings.length,1);
 assert.equal(tables.bookings[0].fields['Charge CAD'],30);
 assert.equal(tables.bookings[0].fields['Booking type'],'Drop-in');
 assert.equal(tables.attendance.length,1);
 assert.equal(tables.attendance[0].fields['Attendance status'],'Not marked');
 assert.deepEqual(tables.attendance[0].fields.Booking,[tables.bookings[0].id]);
 assert.equal((await roster.add('owner@example.test',input)).duplicate,true);
 assert.equal((await roster.add('owner@example.test',{...input,id:uid(2)})).added,0);
 assert.equal(tables.bookings.length,1);
});

test('a lost attendance response can be retried without duplicating the player or booking',async t=>{
 const {roster,tables,fail}=await fixture(t);
 const input={id:uid(10),sessionId:rid(1),newName:'Fictional New Player',mode:'dropin',rateCents:3000};
 fail('attendance');
 await assert.rejects(roster.add('owner@example.test',input),/response lost/);
 await roster.add('owner@example.test',input);
 assert.equal(tables.players.length,2);
 assert.equal(tables.bookings.length,1);
 assert.equal(tables.attendance.length,1);
});

test('an existing pass is reused for a drop-in without another charge',async t=>{
 const {roster,tables}=await fixture(t);
 tables.bookings.push(row(rid(30),{Player:[rid(10)],Family:[rid(11)],'Booking type':'Four consecutive sessions',
  'Booking status':'Accepted','Start date':'2026-11-27','Covered dates':'2026-11-27, 2026-12-04','Fixed-price package':true}));
 await roster.add('owner@example.test',{id:uid(3),sessionId:rid(1),playerId:rid(10),mode:'dropin',rateCents:3000});
 assert.equal(tables.bookings.length,1);
 assert.deepEqual(tables.attendance[0].fields.Booking,[rid(30)]);
 assert.equal(tables.attendance[0].fields['Billing schedule at date'],'Four-session prepaid');
});

test('a prepaid enrollment covers its dates while permanent attendance continues after the pass ends',async t=>{
 const {roster,tables}=await fixture(t);
 tables.enrollments.push(row(rid(40),{Enrollment:'Fictional pass',Player:[rid(10)],Family:[rid(11)],
  'Weekly program':[rid(9)],'Enrollment status':'Active','Effective from':'2026-11-27','Effective until':'2026-12-04',
  'Billing schedule':'Four-session prepaid','Billing approval':'Approved','Prepaid covered from':'2026-11-27','Prepaid covered until':'2026-12-04'}));
 const result=await roster.add('owner@example.test',{id:uid(8),sessionId:rid(1),playerId:rid(10),mode:'permanent',rateCents:3000});
 assert.equal(result.added,2);
 assert.equal(tables.bookings.length,0);
 assert(tables.attendance.every(item=>item.fields.Enrollment[0]===rid(40)));
 tables.sessions.push(row(rid(4),{Session:'Friday',Date:'2026-12-18','Session status':'Planned','Weekly program':[rid(9)]}));
 tables.enrollments[0].fields['Enrollment status']='Paused';
 assert.equal((await roster.sync()).added,0,'A paused enrollment stops future additions');
 tables.enrollments[0].fields['Enrollment status']='Ended';
 assert.equal((await roster.sync()).added,1);
 assert.equal(tables.bookings.length,1);
 assert.equal(tables.bookings[0].fields['Charge CAD'],30);
});

test('permanent players join future weekly dates, and an ended enrollment stops further additions',async t=>{
 const {roster,tables}=await fixture(t);
 const result=await roster.add('owner@example.test',{id:uid(4),sessionId:rid(1),playerId:rid(10),mode:'permanent',rateCents:3000});
 assert.equal(result.added,2);
 assert.equal(result.recurring,true);
 assert.equal(tables.enrollments.length,1);
 assert.equal(tables.attendance.length,2);
 assert.equal(tables.bookings.length,2);
 tables.enrollments[0].fields['Agreed per-session CAD']=35;
 tables.sessions.push(row(rid(4),{Session:'Friday',Date:'2026-12-18','Session status':'Planned','Weekly program':[rid(9)]}));
 assert.equal((await roster.sync()).added,1);
 assert.equal(tables.bookings[2].fields['Charge CAD'],35,'Future dates use the current approved player rate');
 assert.equal((await roster.sync()).added,0);
 tables.enrollments[0].fields['Enrollment status']='Ended';
 tables.sessions.push(row(rid(5),{Session:'Friday',Date:'2026-12-25','Session status':'Planned','Weekly program':[rid(9)]}));
 assert.equal((await roster.sync()).added,0);
 assert.equal(tables.attendance.length,3);
});

test('a new unlinked player can be added without creating a family',async t=>{
 const {roster,tables,fail}=await fixture(t);
 const input={id:uid(5),sessionId:rid(1),newName:'New Fictional Player',mode:'dropin',rateCents:2500};
 fail('players');
 await assert.rejects(roster.add('owner@example.test',input),/response lost/);
 await roster.add('owner@example.test',input);
 assert.equal(tables.players.length,2);
 assert.equal(tables.families.length,1);
 assert.equal(tables.players[1].fields.Family,undefined);
 assert.equal(tables.bookings[0].fields.Family,undefined);
});

test('conflicting bookings and non-recurring sessions are held for review',async t=>{
 const {roster,tables}=await fixture(t);
 tables.bookings.push(
  row(rid(30),{Player:[rid(10)],'Booking status':'Accepted','Covered dates':'2026-11-27'}),
  row(rid(31),{Player:[rid(10)],'Booking status':'Accepted','Covered dates':'2026-11-27'})
 );
 await assert.rejects(roster.add('owner@example.test',{id:uid(6),sessionId:rid(1),playerId:rid(10),mode:'dropin',rateCents:3000}),error=>error.code==='ROSTER_BOOKING_CONFLICT');
 assert.equal(tables.attendance.length,0);
 tables.sessions[0].fields['Weekly program']=[];
 await assert.rejects(roster.add('owner@example.test',{id:uid(7),sessionId:rid(1),playerId:rid(10),mode:'permanent',rateCents:3000}),error=>error.code==='ROSTER_NOT_RECURRING');
});

test('a conflicting future date is reported and is never assigned a duplicate charge',async t=>{
 const {roster,tables}=await fixture(t);
 tables.bookings.push(
  row(rid(30),{Player:[rid(10)],'Booking status':'Accepted','Covered dates':'2026-12-04'}),
  row(rid(31),{Player:[rid(10)],'Booking status':'Accepted','Covered dates':'2026-12-04'})
 );
 const result=await roster.add('owner@example.test',{id:uid(9),sessionId:rid(1),playerId:rid(10),mode:'permanent',rateCents:3000});
 assert.equal(result.added,1);
 assert.deepEqual(result.reviewDates,['2026-12-04']);
 const sync=await roster.sync();
 assert.equal(sync.issues.length,1);
 assert.equal(sync.issues[0].sessionId,rid(2));
 assert.equal(tables.attendance.length,1);
});

test('a recurring player is held for review when their approved rate is removed',async t=>{
 const {roster,tables}=await fixture(t);
 await roster.add('owner@example.test',{id:uid(11),sessionId:rid(1),playerId:rid(10),mode:'permanent',rateCents:3000});
 tables.enrollments[0].fields['Billing approval']='Needs review';
 tables.sessions.push(row(rid(4),{Session:'Friday',Date:'2026-12-18','Session status':'Planned','Weekly program':[rid(9)]}));
 const result=await roster.sync();
 assert.equal(result.added,0);
 assert.equal(result.issues[0].reason,'Permanent player’s rate needs review');
 assert.equal(tables.bookings.length,2);
});
