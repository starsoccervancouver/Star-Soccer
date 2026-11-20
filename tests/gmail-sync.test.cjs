const {test}=require('node:test');
const assert=require('node:assert/strict');
const {Buffer}=require('node:buffer');
const owner='owner@example.test', ids={'Payments - Incoming':'incoming',Deposited:'deposited',Registrations:'registrations',Leads:'leads'};
const from='notify@payments.interac.ca';
function msg(sender,subject,text,labels,authDomain=sender.split('@')[1]){
 return {id:'abc123',threadId:'thread123',internalDate:String(Date.UTC(2026,10,19)),labelIds:labels,payload:{headers:[{name:'From',value:sender},{name:'Subject',value:subject},{name:'Authentication-Results',value:'mx.google.com; dmarc=pass header.from='+authDomain}],mimeType:'text/plain',body:{data:Buffer.from(text).toString('base64url')}}};
}
test('only owner-marked authenticated incoming notices with the same CAD amount can post',async()=>{
 const {classifyMessage}=await import('../private-attendance/gmail-message.mjs');
 const m=msg(from,'Interac e-Transfer: EXAMPLE PARENT sent you $60.00. Claim your deposit!','Message: for BOOK-100 Transfer Details Reference Number: CA123456 Sent From: EXAMPLE PARENT Amount: $60.00 (CAD)',['INBOX','incoming','deposited']);
 assert.equal(classifyMessage(m,ids,owner).verified,true);
 assert.equal(classifyMessage({...m,labelIds:['deposited']},ids,owner).verified,true);
 for(const labels of [['INBOX'],['INBOX','incoming']]){
  const event=classifyMessage({...m,labelIds:labels},ids,owner);assert.equal(event,null);
 }
 m.payload.headers[2].value='mx.google.com; dmarc=fail header.from=payments.interac.ca';assert.equal(classifyMessage(m,ids,owner).verified,false);
 m.payload.headers[2].value='mx.google.com; dmarc=pass header.from=payments.interac.ca';m.payload.headers[1].value=m.payload.headers[1].value.replace('60.00','50.00');assert.equal(classifyMessage(m,ids,owner).verified,false);
});
test('separates provider registrations, direct parent inquiries and unrelated mail',async()=>{
 const {classifyMessage}=await import('../private-attendance/gmail-message.mjs');
 const m=msg('noreply@formspree.io','Star Soccer camp registration','Registration version:\nSS-CAMP-V2\nClient reference:\nSS-CAMP-EXAMPLE\nPlayer name:\nExample Player\nParent name:\nExample Parent\nemail:\nparent@example.test\nBooking type:\nCamp\n',['INBOX']);
 const e=classifyMessage(m,ids,owner);assert.equal(e.form,true);assert.equal(e.contact,'parent@example.test');assert.equal(e.child,'Example Player');assert.equal(e.reference,'SS-CAMP-EXAMPLE');
 assert.equal(classifyMessage(msg('parent@example.test','Soccer camp availability','Is there room for two?',['INBOX']),ids,owner).type,'inquiry');
 assert.equal(classifyMessage(msg('news@example.test','Your receipt','Subscription renewal',['INBOX']),ids,owner),null);
 assert.equal(classifyMessage({...m,labelIds:['SENT']},ids,owner),null);
});

function campLedger() {
 const db=ledger();
 db.tables.families[0].fields.Email='parent@example.test';
 db.tables.players.push({id:'campPlayer',fields:{Player:'Example Player',Family:['familyA'],'Player status':'Active'}});
 db.tables.sessions=['am','pm'].map(slot=>({id:slot,fields:{
  'Source session ID':'winter-christmas-'+slot+':2026-12-25',Session:'Christmas camp '+slot,
  Date:'2026-12-25',Time:slot==='am'?'9 AM–noon':'12:30–3:30 PM',Venue:'Kitsilano Turf',
  'Session status':'Planned',Capacity:20,Attendance:[]
 }}));
 db.tables.attendance=[];
 db.saveMany=async(table,rows,options)=>{
  const result=[];
  for(const fields of rows){
   const row=await db.save(table,fields,options);
   const session=db.tables.sessions.find(session=>session.id===fields.Session[0]);
   if(!session.fields.Attendance.includes(row.id))session.fields.Attendance.push(row.id);
   result.push(row);
  }
  return result;
 };
 return db;
}

function verifiedCamper(db){
 db.tables.bookings.push({id:'priorCamp',fields:{Player:['campPlayer'],Family:['familyA'],'Payment Allocations':['priorAllocation'],'Booking status':'Completed'}});
 db.tables.allocations.push({id:'priorAllocation',fields:{Booking:['priorCamp'],Payment:['priorDeposit'],'Applied CAD':60,'Review status':'Verified allocation'}});
 db.tables.payments.push({id:'priorDeposit',fields:{Family:['familyA'],Method:'E-transfer',Direction:'Incoming',Verification:'Verified','Verified by':'Star Soccer owner via Gmail Deposited label','Source payment ID':'INTERAC-PREVIOUS'}});
}

async function campEvent() {
 const {classifyMessage}=await import('../private-attendance/gmail-message.mjs');
 return classifyMessage(msg('noreply@formspree.io','Star Soccer camp registration','Registration version: SS-CAMP-DROPIN-V1\nClient reference: SS-CAMP-EXAMPLE\nPlayer name: Example Player\nParent name: Example Parent\nPlayer age: 8\nemail: parent@example.test\nCamp week ID: christmas\nCamp slot: both\nCovered dates: 2026-12-25\nCamp session keys: winter-christmas-am:2026-12-25; winter-christmas-pm:2026-12-25',['INBOX']),ids,owner);
}

const placementOptions={campPlacementSince:'2026-11-19T00:00:00Z',now:new Date('2026-11-19T02:00:00Z')};
test('returning verified camper is placed in both dated slots once with the published price and no new payment',async()=>{
 const {syncLedgerEvent}=await import('../private-attendance/gmail-ledger.mjs');
 const db=campLedger(),event=await campEvent();
 verifiedCamper(db);
 await syncLedgerEvent(db,event,placementOptions);
 await syncLedgerEvent(db,event,placementOptions);
 const [registration]=db.tables.registrations;
 const campBookings=db.tables.bookings.filter(row=>row.fields['Source booking ID']);
 assert.equal(registration.fields.Status,'Expected');
 assert.equal(campBookings.length,1);
 assert.equal(campBookings[0].fields['Charge review'],'Agreed');
 assert.equal(campBookings[0].fields['Charge CAD'],0);
 assert.equal(db.tables.payments.length,1);
 assert.deepEqual(registration.fields.Booking,[campBookings[0].id]);
 assert.deepEqual(db.tables.attendance.map(row=>row.fields.Session),[['am'],['pm']]);
 assert.ok(db.tables.attendance.every(row=>row.fields['Website Registrations'][0]===registration.id));
 assert.equal(db.tables.intake[0].fields.Review,'Matched');
});

test('a full slot, mismatched keys, or unverified player keeps all seats under review',async()=>{
 const {syncLedgerEvent}=await import('../private-attendance/gmail-ledger.mjs');
 const event=await campEvent();
 const cases=[
  db=>{db.tables.sessions[1].fields['Expected headcount (owner reported)']=20;},
  db=>{db.tables.players[0].fields['Player status']='Name to confirm';},
  db=>{db.tables.sessions[1].fields['Source session ID']='unexpected';}
 ];
 for(const arrange of cases){
  const db=campLedger();
  verifiedCamper(db);
  arrange(db);
  await syncLedgerEvent(db,event,placementOptions);
  assert.equal(db.tables.registrations[0].fields.Status,'Needs review');
  assert.equal(db.tables.intake[0].fields.Review,'Needs clarification');
  assert.equal(db.tables.bookings.length,2);
  assert.equal(db.tables.attendance.length,0);
 }
 const beforeCutover=campLedger();
 await syncLedgerEvent(beforeCutover,event,{...placementOptions,campPlacementSince:'2026-11-20T00:00:00Z'});
 assert.equal(beforeCutover.tables.registrations[0].fields.Status,'Needs review');
 assert.equal(beforeCutover.tables.attendance.length,0);
});

test('Pro-D placement checks the exact noon session and its ages 6–13',async()=>{
 const {syncLedgerEvent}=await import('../private-attendance/gmail-ledger.mjs');
 const {classifyMessage}=await import('../private-attendance/gmail-message.mjs');
 const event=classifyMessage(msg('noreply@formspree.io','Star Soccer Pro-D camp registration','Intake version: SS-DAY-CAMP-V1\nRegistration reference: SS-DAY-EXAMPLE\nPlayer name: Example Player\nPlayer age: 13\nemail: parent@example.test\nCamp ID: pro-d-2026-11-20\nSession date: 2026-11-20',['INBOX']),ids,owner);
 function ledgerWithProD(){
  const db=campLedger();
  const [session]=db.tables.sessions;
  Object.assign(session.fields,{'Source session ID':'SS-20261120-KITS-PROD',Date:'2026-11-20',Time:'12:00 pm – 3:00 pm'});
  return db;
 }
 const db=ledgerWithProD();
 verifiedCamper(db);
 await syncLedgerEvent(db,event,placementOptions);
 assert.equal(db.tables.registrations[0].fields.Status,'Expected');
 assert.equal(db.tables.attendance[0].fields['Session date'],'2026-11-20');
 const ineligible=ledgerWithProD();
 await syncLedgerEvent(ineligible,{...event,age:'14'},placementOptions);
 assert.equal(ineligible.tables.registrations[0].fields.Status,'Needs review');
 assert.equal(ineligible.tables.attendance.length,0);
});

test('retry resumes a camp placement after an uncertain attendance write',async()=>{
 const {syncLedgerEvent}=await import('../private-attendance/gmail-ledger.mjs');
 const db=campLedger(),event=await campEvent(),write=db.saveMany;
 verifiedCamper(db);
 db.saveMany=async(table,rows,options)=>{
  await write(table,rows,options);
  throw Error('AIRTABLE_WRITE_UNCERTAIN');
 };
 await assert.rejects(syncLedgerEvent(db,event,placementOptions),/AIRTABLE_WRITE_UNCERTAIN/);
 assert.equal(db.tables.registrations[0].fields.Status,'Needs review');
 await syncLedgerEvent(db,event,placementOptions);
 assert.equal(db.tables.registrations[0].fields.Status,'Expected');
 assert.equal(db.tables.bookings.filter(row=>row.fields['Source booking ID']).length,1);
 assert.equal(db.tables.attendance.length,2);
});

test('new camper waits for owner email, then a Deposited receipt verifies their later cash registration',async()=>{
 const {syncLedgerEvent}=await import('../private-attendance/gmail-ledger.mjs');
 const {classifyMessage}=await import('../private-attendance/gmail-message.mjs');
 const db=campLedger(),template=await campEvent();
 db.tables.players.length=0;
 db.tables.families.length=0;
 db.tables.sessions.push({id:'secondDay',fields:{...db.tables.sessions[0].fields,
  Date:'2026-12-24','Source session ID':'winter-christmas-am:2026-12-24',Attendance:[]}});
 const first={...template,campSlot:'am',dates:'2026-12-24',campKeys:'winter-christmas-am:2026-12-24'};
 await syncLedgerEvent(db,first,placementOptions);
 await syncLedgerEvent(db,first,placementOptions);
 assert.equal(db.tables.players.length,1);
 assert.equal(db.tables.families.length,1);
 assert.equal(db.tables.registrations[0].fields.Status,'Processing');
 assert.equal(db.tables.attendance.length,0);
 const sent=msg(owner,'Star Soccer camp registration confirmed | Winter Camp | '+first.reference,'',['SENT']);
 sent.id='sent1';
 sent.payload.headers.push({name:'To',value:'Other Parent <other@example.test>'});
 await syncLedgerEvent(db,classifyMessage(sent,ids,owner,owner),placementOptions);
 assert.equal(db.tables.registrations[0].fields.Status,'Processing');
 sent.payload.headers.at(-1).value='Example Parent <parent@example.test>';
 assert.equal(classifyMessage(sent,ids,owner),null);
 await syncLedgerEvent(db,classifyMessage(sent,ids,owner,owner),placementOptions);
 assert.equal(db.tables.registrations[0].fields.Status,'Confirmed');
 assert.equal(db.tables.attendance.length,1);
 const payment=msg(from,'Interac e-Transfer: EXAMPLE PARENT sent you $60.00. Claim your deposit!',
  'Message: '+first.reference+' Transfer Details Reference Number: CA789999 Sent From: Example Parent Amount: $60.00 (CAD)',['INBOX','incoming']);
 payment.id='payment1';
 await syncLedgerEvent(db,classifyMessage(payment,ids,owner),placementOptions);
 assert.equal(db.tables.payments.length,0);
 payment.labelIds.push('deposited');
 await syncLedgerEvent(db,classifyMessage(payment,ids,owner),placementOptions);
 assert.equal(db.tables.payments[0].fields.Verification,'Verified');
 assert.equal(db.tables.allocations[0].fields['Applied CAD'],60);
 await syncLedgerEvent(db,{...template,id:'returning',reference:'SS-CAMP-RETURNING'},placementOptions);
 assert.equal(db.tables.registrations[1].fields.Status,'Expected');
 assert.equal(db.tables.attendance.length,3);
 assert.equal(db.tables.payments.length,1);
 await syncLedgerEvent(db,{...template,id:'sibling',reference:'SS-CAMP-SIBLING',child:'Example Sibling'},placementOptions);
 assert.equal(db.tables.registrations[2].fields.Status,'Processing');
 assert.equal(db.tables.players.length,2);
 assert.equal(db.tables.attendance.length,3);
});

function ledger(){
 const tables={families:[{id:'familyA',fields:{'Guardian name':'Example Parent'}}],players:[],registrations:[],bookings:[{id:'bookA',fields:{Family:['familyA'],'Booking reference':'BOOK-100','Booking status':'Accepted','Charge review':'Agreed','Balance CAD':80}}],payments:[],allocations:[],intake:[]};
 return {tables,async list(table,fields,filter){
  return tables[table].filter(r=>!filter||filter==="RECORD_ID()='"+r.id+"'"||Object.entries(r.fields).some(([k,v])=>typeof v==='string'&&filter.includes('{'+k+"}='"+v+"'")));
 },async save(table,fields,{key,id}){let row=tables[table].find(r=>id?r.id===id:r.fields[key]===fields[key]);
  if(!row){row={id:table+tables[table].length,fields:{}};tables[table].push(row);}
  Object.assign(row.fields,fields);
  if(table==='bookings'&&fields['Charge CAD']!==undefined)row.fields['Balance CAD']=fields['Charge CAD'];
  if(table==='allocations'){
   const booking=tables.bookings.find(b=>b.id===fields.Booking[0]),receipt=tables.payments.find(p=>p.id===fields.Payment[0]);
   const reference=booking.fields['Family reference'];
   row.fields['Applied CAD']=reference&&receipt.fields['Family reference']===reference?fields['Amount CAD']:0;
   receipt.fields['Payment Allocations']=[row.id];booking.fields['Payment Allocations']=[row.id];booking.fields['Balance CAD']-=row.fields['Applied CAD'];
  }return row;
 }};
}
const e={id:'message123',thread:'thread123',type:'payment',sender:from,received:'2026-11-19T12:00:00Z',ref:'CA123456',amount:60,payer:'Example Parent',memo:'Payment for BOOK-100',verified:true};
test('a matched partial payment applies once, including after a retry',async()=>{
 const {syncLedgerEvent}=await import('../private-attendance/gmail-ledger.mjs');const db=ledger();
 await syncLedgerEvent(db,e);await syncLedgerEvent(db,e);
 assert.equal(db.tables.payments.length,1);assert.equal(db.tables.allocations.length,1);assert.equal(db.tables.bookings[0].fields['Balance CAD'],20);assert.equal(db.tables.intake.length,1);assert.equal(db.tables.intake[0].fields.Review,'Matched');
});
test('exact full payment uses the existing booking family reference; conflicting references go to review',async()=>{
 const {syncLedgerEvent}=await import('../private-attendance/gmail-ledger.mjs');
 for(const conflict of [false,true]){
  const db=ledger(),booking=db.tables.bookings[0].fields;
  Object.assign(booking,{'Family reference':'F-100','Accepted date':'2026-11-01','Balance CAD':60});
  if(conflict)db.tables.payments.push({id:'prior',fields:{'Source payment ID':'INTERAC-'+e.ref,'Family reference':'F-200',Family:['familyA'],'Amount CAD':60,Verification:'Verified','Payment context':'Cloud Gmail intake.'}});
  await syncLedgerEvent(db,{...e,memo:''});
  assert.equal(booking['Balance CAD'],conflict?60:0);
  assert.equal(db.tables.payments[0].fields['Family reference'],conflict?'F-200':'F-100');
  assert.equal(db.tables.intake[0].fields.Review,conflict?'Needs clarification':'Matched');
 }
});
test('a previously ignored deposit stays closed on replay',async()=>{
 const {syncLedgerEvent}=await import('../private-attendance/gmail-ledger.mjs'),db=ledger();
 db.tables.intake.push({id:'historical',fields:{'Message ID':e.id,Review:'Ignore'}});
 await syncLedgerEvent(db,e);assert.equal(db.tables.payments.length,0);assert.equal(db.tables.intake[0].fields.Review,'Ignore');
});
test('ambiguous payer or an existing receipt without transfer evidence goes to review',async()=>{
 const {syncLedgerEvent}=await import('../private-attendance/gmail-ledger.mjs');
 for(const ambiguous of [true,false]){
 const db=ledger();if(ambiguous)db.tables.families.push({id:'familyB',fields:{'Guardian name':'Example Parent'}});
 else db.tables.payments.push({id:'old',fields:{Family:['familyA'],'Amount CAD':60,Verification:'Verified'}});
 const before=db.tables.payments.length;await syncLedgerEvent(db,e);
 assert.equal(db.tables.payments.length,before);assert.equal(db.tables.allocations.length,0);assert.equal(db.tables.intake[0].fields.Review,'Needs clarification');
 }
});
test('no background access until consent and a separate signed-in owner flow',async()=>{
 const {createCloudMail}=await import('../private-attendance/gmail-cloud.mjs');const records=new Map();let alarm=0,calls=0;
 const storage={get:async k=>records.get(k),put:async(k,v)=>records.set(k,v),delete:async k=>(Array.isArray(k)?k:[k]).forEach(n=>records.delete(n)),transaction:async fn=>fn(storage),setAlarm:async n=>{alarm=n},deleteAlarm:async()=>{alarm=0},list:async({prefix,limit})=>new Map([...records].filter(([k])=>k.startsWith(prefix)).slice(0,limit))};
 const {STAR_SOCCER_OWNER}=await import('../private-attendance/deployment-config.mjs');
 const mock=async (u,options)=>{calls++;const url=new URL(u);
 assert.equal(options.redirect,'manual');
 if(url.hostname==='oauth2.googleapis.com'){assert.equal(options.headers['Content-Type'],'application/x-www-form-urlencoded');assert.ok(new URLSearchParams(options.body).has('grant_type'));}
 if(url.hostname==='oauth2.googleapis.com')return Response.json({access_token:'access',refresh_token:'fixture-refresh',scope:'https://www.googleapis.com/auth/gmail.readonly'});
 if(url.pathname.endsWith('/profile'))return Response.json({emailAddress:STAR_SOCCER_OWNER,historyId:'290'});
 if(url.pathname.endsWith('/labels'))return Response.json({labels:Object.entries(ids).map(([name,id])=>({name,id}))});
 if(url.pathname.endsWith('/messages'))return Response.json({messages:[]});throw Error('unexpected request');};
 const mail=createCloudMail(storage,{COOKIE_KEY:'example-key',GOOGLE_CLIENT_ID:'example.apps.googleusercontent.com',GOOGLE_CLIENT_SECRET:'example',AIRTABLE_CONFIG:'{"tables":{}}'},{fetchFn:mock});
 await mail.cycle();assert.equal(calls,0);assert.equal((await mail.handle('status')).connected,false);
 const start=await mail.handle('start',{}),url=new URL(start.url),state=url.searchParams.get('state');
 assert.equal(url.searchParams.get('scope'),'https://www.googleapis.com/auth/gmail.readonly');
 await assert.rejects(mail.handle('finish',{state,browser:'incorrect',code:'fake'}),/CONSENT_EXPIRED/);assert.equal(calls,0);
 await mail.handle('finish',{state,browser:start.browser,code:'fake'});assert.ok(alarm);assert.equal((await mail.handle('status')).connected,true);
 assert(!JSON.stringify([...records]).includes('fixture-refresh'));
 await mail.cycle();assert.equal((await mail.handle('status')).error,null);
 await mail.handle('disconnect',{});assert.equal(alarm,0);assert.equal((await mail.handle('status')).connected,false);
});
