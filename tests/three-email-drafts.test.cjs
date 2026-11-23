const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,today,date}=require('./email-draft-fixtures.cjs');
const template='<img src="logo"><p>VANCOUVER · PRO-D CAMPS</p><p>Registration confirmed</p><h1>{{CAMP_TITLE}}</h1><img src="field"><p>Thanks for registering! {{PLAYER_NAMES}}</p><p>The fee is {{PRICE_PER_PLAYER}}</p><p>Thanks,<br>Romeo</p><img src="signature">';
async function setup(){
 const {runDraftJob}=await import('../private-attendance/draft-job.mjs');
 const d=fixture(template),map=new Map(),drafts=new Map(),delivered=new Map();
 const storage={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),transaction:f=>f(storage)};
 const db={list:async table=>d[table],save:async(table,fields,{key,id})=>{
  let r=d[table].find(r=>id?r.id===id:r.fields[key]===fields[key]);
  if(!r)d[table].push(r={id:'row'+d[table].length,fields:{}});Object.assign(r.fields,fields);return r;
 }};
 let count=0;
 const mail={prior:async()=>false,sent:async id=>id==='sent-id'?id:null,
  create:async c=>{const draft={id:'draft'+(++count),message:{threadId:'thread'+count},c};drafts.set(draft.id,draft);return draft;},
  getDraft:async id=>drafts.get(id),findSent:async key=>delivered.get(key),obsolete:async id=>{drafts.get(id).withdrawn=true;}};
 const context={db,storage,mail,now:Date.parse(today+'T20:00:00Z')};
 const initial={...d,bookings:[],payments:[],enrollments:[]};
 await runDraftJob({...context,now:context.now-86400000,db:{...db,list:async n=>initial[n]}});
 return {d,map,drafts,delivered,mail,run:()=>runDraftJob(context),get count(){return count;}};
}
test('all three rules run twice without duplicates, and never send',async()=>{
 const s=await setup();await s.run();await s.run();assert.equal(s.count,6);
 const byKey=new Map([...s.drafts.values()].map(x=>[x.c.key,x.c]));
 assert.match(byKey.get('Confirmation:Paid').html,/covers this booking in full/);
 assert.match(byKey.get('Confirmation:Unpaid').html,/CAD \$60.00.*e-transfer/);
 assert.match(byKey.get('Confirmation:Partial').html,/applied CAD \$20.00.*remaining balance is CAD \$40.00/);
 for(const c of byKey.values())assert.deepEqual(c.html.match(/<img[^>]*>/g),['<img src="logo">','<img src="field">','<img src="signature">']);
 assert.match(byKey.get('Receipt:siblings').html,/Example Paid.*60.00.*Example Partial.*20.00/);
 assert.match(byKey.get('Receipt:cash').html,/CAD \$25.00 by cash/);
 assert.ok(!byKey.get('Receipt:cash').html.includes('<li>'));
 assert.match(byKey.get('Renewal:active:'+date).html,/Example training/);assert.ok(!byKey.has('Renewal:renewed:'+date));
 const renewal=s.d.draftLog.find(r=>r.fields['Email key']==='Renewal:active:'+date).fields;
 s.d.enrollments[0].fields['Prepaid covered until']='2027-02-12';await s.run();await s.run();
 assert.equal(renewal.Status,'Obsolete');assert.ok(s.drafts.get(renewal['Gmail draft ID']).withdrawn);assert.equal(s.count,6);
});
test('manual sending, edited drafts and deletion do not regenerate mail',async()=>{
 const s=await setup();s.d.registrations.push({id:'reg',fields:{Reference:'SS-TEST-PAID',Status:'Expected',Booking:['Paid'],Player:['Paid'],Family:['family'],'Parent email':'owner@example.test'}});
 await s.run();const log=s.d.draftLog.find(r=>r.fields['Email key']==='Confirmation:Paid').fields;
 s.drafts.get(log['Gmail draft ID']).edited=true;await s.run();assert.equal(s.count,6);
 s.drafts.delete(log['Gmail draft ID']);s.delivered.set('Confirmation:Paid','sent-id');await s.run();await s.run();
 assert.equal(log['Sent Gmail ID'],'sent-id');assert.equal(s.d.registrations[0].fields['Confirmation Gmail ID'],'sent-id');
 const lost=s.d.draftLog.find(r=>r.fields['Email key']==='Receipt:cash').fields;s.drafts.delete(lost['Gmail draft ID']);await s.run();await s.run();
 assert.equal(lost.Status,'Review');assert.equal(s.count,6);
});
test('a verified split revises the same Gmail draft, survives a lost response and preserves owner text',async()=>{
 const {draftMailbox,mime}=await import('../private-attendance/draft-mailbox.mjs');
 const s=await setup(),allocations=s.d.allocations.splice(0);
 await s.run();
 const log=s.d.draftLog.find(r=>r.fields['Email key']==='Receipt:siblings').fields;
 const id=log['Gmail draft ID'],original=s.drafts.get(id).c,thread=log['Gmail thread ID'];
 const state=s.map.get('mail-drafts:lock:Receipt:siblings');
 // Existing receipts only stored the original signature.
 delete state.allocationHtml;delete state.receiptFamily;
 let raw=mime({...original,html:original.html.replace('Thanks,<br>Romeo','See you soon,<br>Romeo')});
 const body=()=>Buffer.from(Buffer.from(raw,'base64url').toString().split('\r\n\r\n')[1],'base64').toString();
 let writes=0;
 const mailbox=draftMailbox({read:async path=>{
  assert.equal(path,'drafts/'+id);return {message:{threadId:thread,raw}};
 },fetchFn:async(url,options)=>{
  assert.equal(url.pathname.split('/').pop(),id);assert.equal(options.method,'PUT');
  const payload=JSON.parse(options.body).message;assert.equal(payload.threadId,thread);
  raw=payload.raw;writes++;if(writes===1)throw Error('response lost');return Response.json({id});
 }});
 s.mail.reviseReceipt=mailbox.reviseReceipt;
 s.d.allocations.push(allocations[0]);await s.run();assert.equal(writes,0);
 s.d.allocations.push(allocations[1]);
 await assert.rejects(s.run(),/response lost/);
 await s.run();await s.run();
 assert.equal(log.Status,'Draft');assert.equal(log['Gmail draft ID'],id);assert.equal(writes,1);
 assert.match(body(),/Example Paid.*60\.00.*Example Partial.*20\.00/);
 assert.match(body(),/See you soon/);assert.equal(s.count,6);
 s.d.allocations[0].fields['Applied CAD']=s.d.allocations[0].fields['Amount CAD']=55;
 s.d.allocations[1].fields['Applied CAD']=s.d.allocations[1].fields['Amount CAD']=25;
 await s.run();await s.run();assert.equal(writes,2);assert.match(body(),/55\.00.*25\.00/);
 const validRaw=raw;
 raw=Buffer.from('Cc: other@example.test\r\n'+Buffer.from(raw,'base64url').toString('latin1'),'latin1').toString('base64url');
 s.d.allocations.pop();await s.run();await s.run();
 assert.equal(writes,2);assert.equal(log.Status,'Review');
 raw=validRaw;await s.run();await s.run();
 assert.equal(writes,3);assert.equal(log.Status,'Draft');assert.ok(!body().includes('<li>'));
 s.drafts.delete(id);s.delivered.set(original.key,'sent-receipt');await s.run();
 s.d.allocations.length=0;await s.run();assert.equal(writes,3);assert.equal(log.Status,'Sent');assert.equal(s.count,6);
});
test('automated placement, unverified payment and opted-out renewal cannot produce drafts',async()=>{
 const s=await setup();s.d.bookings[1].fields['Source booking ID']='gmail-weekly:form';s.d.payments[1].fields.Verification='Needs review';
 s.d.enrollments[0].fields['Weekly attendance email preference']='Opted out';await s.run();await s.run();
 const keys=()=>[...s.drafts.values()].map(x=>x.c.key);assert.ok(!keys().includes('Confirmation:Unpaid'));assert.ok(!keys().includes('Receipt:cash'));assert.ok(!keys().includes('Renewal:active:'+date));
 s.d.bookings[1].fields['Owner approved confirmation']=true;s.d.payments[1].fields.Verification='Verified';await s.run();await s.run();
 assert.equal(keys().filter(x=>x==='Confirmation:Unpaid').length,1);assert.equal(keys().filter(x=>x==='Receipt:cash').length,1);
});
test('an uncertain Gmail POST stays held on a retry and historical receipts stay quiet',async()=>{
 const s=await setup();let count=0;const create=s.mail.create;s.mail.create=async c=>{if(c.key==='Confirmation:Paid'){count++;throw Error('uncertain');}return create(c);};
 await assert.rejects(s.run());await s.run();await s.run();assert.equal(count,1);
 assert.equal(s.d.draftLog.find(r=>r.fields['Email key']==='Confirmation:Paid').fields.Status,'Review');
 const other=await setup();other.map.delete('mail-drafts:baseline:v1');await other.run();await other.run();assert.ok(![...other.drafts.values()].some(x=>['Confirmation','Receipt'].includes(x.c.kind)));
});

test('withdrawing an edited reminder preserves its contents and removes all family recipients',async()=>{
 const {draftMailbox}=await import('../private-attendance/draft-mailbox.mjs');
 const old='To: parent@example.test\r\nCc: second@example.test,\r\n third@example.test\r\nBcc: fourth@example.test\r\nSubject: family edit\r\nContent-Type: text/plain\r\n\r\nOwner-edited renewal body.';
 let updated;const mb=draftMailbox({owner:'owner@example.test',access:'fixture',read:async()=>({message:{raw:Buffer.from(old).toString('base64url')}}),fetchFn:async(url,options)=>{assert.equal(options.method,'PUT');updated=Buffer.from(JSON.parse(options.body).message.raw,'base64url').toString();return Response.json({id:'draft'});}});
 await mb.obsolete('draft','Renewal:example:2027-01-12','Renewed');
 assert.match(updated,/^To: owner@example.test/);assert.ok(updated.endsWith('Owner-edited renewal body.'));
 assert.doesNotMatch(updated,/parent@|second@|third@|fourth@/);
});

test('Gmail history reconciles a consumed owner test draft once, including a renamed thread',async()=>{
 const {observeDraftSend}=await import('../private-attendance/draft-job.mjs');
 const {marker}=await import('../private-attendance/draft-rules.mjs');
 const owner='owner@example.test',key='Test:20261122:Confirmation:Unpaid';
 const fields={'Email key':key,'Email kind':'Confirmation','Source record':'test-log',Status:'Draft',Recipient:owner,'Gmail draft ID':'draft-a','Gmail thread ID':'old-thread'};
 const log={fields};let writes=0;const db={list:async()=>[log],save:async(t,f)=>{writes++;Object.assign(fields,f);}};
 const storage={get:async()=>({draftId:'draft-a',to:owner})};
 const subject='[OWNER TEST unpaid] Example | '+marker('Confirmation:Unpaid');
 const message={id:'sent-42',threadId:'new-thread',labelIds:['SENT','INBOX'],payload:{headers:[{name:'Subject',value:'=?UTF-8?B?'+Buffer.from(subject).toString('base64')+'?='}]}};
 const mail={sent:async(id,to)=>id==='sent-42'&&to===owner?id:null,getDraft:async()=>null};
 const opt={db,storage,mail,message,owner};
 assert.equal(await observeDraftSend({...opt,message:{...message,labelIds:['DRAFT']}}),false);
 assert.equal(await observeDraftSend({...opt,mail:{...mail,getDraft:async()=>({id:'draft-a'})}}),false);
 assert.equal(await observeDraftSend({...opt,owner:'other@example.test'}),false);assert.equal(writes,0);
 assert.equal(await observeDraftSend(opt),true);assert.equal(fields['Sent Gmail ID'],'sent-42');
 assert.equal(await observeDraftSend(opt),false);assert.equal(writes,1);
});
