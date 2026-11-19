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
function ledger(){
 const tables={families:[{id:'familyA',fields:{'Guardian name':'Example Parent'}}],players:[],registrations:[],bookings:[{id:'bookA',fields:{Family:['familyA'],'Booking reference':'BOOK-100','Booking status':'Accepted','Charge review':'Agreed','Balance CAD':80}}],payments:[],allocations:[],intake:[]};
 return {tables,async list(table,fields,filter){
  return tables[table].filter(r=>!filter||Object.entries(r.fields).some(([k,v])=>typeof v==='string'&&filter.includes('{'+k+"}='"+v+"'")));
 },async save(table,fields,{key,id}){let row=tables[table].find(r=>id?r.id===id:r.fields[key]===fields[key]);
  if(!row){row={id:table+tables[table].length,fields:{}};tables[table].push(row);}
  Object.assign(row.fields,fields);if(table==='allocations'){
   row.fields['Applied CAD']=fields['Amount CAD'];tables.payments[0].fields['Payment Allocations']=[row.id];tables.bookings[0].fields['Balance CAD']-=fields['Amount CAD'];
  }return row;
 }};
}
const e={id:'message123',thread:'thread123',type:'payment',sender:from,received:'2026-11-19T12:00:00Z',ref:'CA123456',amount:60,payer:'Example Parent',memo:'Payment for BOOK-100',verified:true};
test('a matched partial payment applies once, including after a retry',async()=>{
 const {syncLedgerEvent}=await import('../private-attendance/gmail-ledger.mjs');const db=ledger();
 await syncLedgerEvent(db,e);await syncLedgerEvent(db,e);
 assert.equal(db.tables.payments.length,1);assert.equal(db.tables.allocations.length,1);assert.equal(db.tables.bookings[0].fields['Balance CAD'],20);assert.equal(db.tables.intake.length,1);assert.equal(db.tables.intake[0].fields.Review,'Matched');
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
 const mock=async u=>{calls++;const url=new URL(u);
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
