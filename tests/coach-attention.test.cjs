const test=require('node:test');
const assert=require('node:assert/strict');
const inbox='romeo@example.test', now=Date.parse('2026-11-20T08:05Z');
const id=n=>String(1000000000000000+n);
const wrap=fields=>({fields,id:id(100)});
const query=async(kind,{tables={},messages=[],threads={}}={},cursor)=>{
 const {attentionPage}=await import('../private-attendance/attention-inbox.mjs');
 const ledger={list:async name=>(tables[name]||[]).map(wrap)};
 async function read(path){
  if(path==='messages')return {messages:messages.map(({id})=>({id}))};
  if(path==='threads')return {threads:Object.keys(threads).map(id=>({id}))};
  if(path.startsWith('messages/'))return messages.find(m=>m.id===path.slice(9));
  const key=path.slice(8);if(threads[key])return {messages:threads[key]};
  throw Error('GMAIL_404');
 }
 return attentionPage({ledger,read,labels:{Deposited:'label1'},mailbox:inbox,now},kind,cursor);
};
const message=(n,labels,subject)=>({id:id(n),threadId:id(n),labelIds:labels,internalDate:String(now+n),payload:{headers:[{name:'Subject',value:subject}]}});
test('registration queue retains expected and pending requests while suppressing confirmed, declined, past and duplicate sources',async()=>{
 const source=n=>({'Source Gmail ID':id(n),Reference:'Booked '+n});
 const res=await query('registrations',{tables:{registrations:[{...source(1),Status:'Expected'},{...source(2),'Confirmation Gmail ID':id(99)},{...source(3),Status:'Declined'},{...source(4),'Next session date':'2026-11-19'}],intake:[1,5].map(n=>({'Message ID':id(n),Subject:'Request '+n,Kind:'Registration candidate',Review:'Needs clarification'}))}});
 assert.deepEqual(res.items.map(i=>i.title),['Booked 1','Request 5']);
 assert(res.items[0].href.endsWith('#all/'+id(1)));
});
test('actual replies close an inquiry, drafts leave it open and a later incoming message reopens it',async()=>{
 const intake=[1,2,3].map(n=>({Kind:'Question','Message ID':id(n),'Gmail thread ID':id(n),'Reply workflow':n===3?'Sent - confirmed':''}));
 const {items}=await query('inquiries',{tables:{intake},threads:{
  [id(1)]:[message(1,['INBOX'],'One'),message(8,['SENT'],'Reply')],
  [id(2)]:[message(2,[],'Two'),message(9,['DRAFT'],'Draft')],
  [id(3)]:[message(3,['INBOX'],'Three'),message(10,['SENT'],'Reply'),message(11,['INBOX'],'New question')]}});
 assert.deepEqual(items.map(i=>i.title),['Two','New question']);
 assert(items[1].href.endsWith(id(11)));
});
test('incoming transfers remain pending when read, reminders reconcile by exact reference and verified evidence resolves a transfer',async()=>{
 function transfer(n,ref,labels,subject='Interac e-Transfer: A sent you $50.00.',valid=true){
  const m=message(n,labels,subject);
  m.payload.mimeType='text/plain';
  m.payload.body={data:Buffer.from('Reference Number: '+ref).toString('base64url')};
  m.payload.headers.push({name:'From',value:'notify@payments.interac.ca'},{name:'authentication-results',value:'mx.google.com; dmarc='+(valid?'pass':'fail')+' header.from=payments.interac.ca'});
  return m;
 }
 const res=await query('payments',{messages:[transfer(1,'ABC123',[]),transfer(2,'DEF456',[]),transfer(3,'DEF456',['label1']),transfer(4,'HIJ789',[]),transfer(5,'SPOOF1',[],undefined,false)],tables:{payments:[{Verification:'Verified',Direction:'Incoming','Evidence reference':'Gmail '+id(4)+'; Interac HIJ789'}]}});
 assert.deepEqual(res.items.filter(i=>!res.resolved.includes(i.key)).map(i=>i.key),['INTERAC-ABC123']);
});
test('other mail skips tracked and answered threads and opens the exact flagged incoming message',async()=>{
 const threads={[id(1)]:[message(1,['INBOX','IMPORTANT'],'Tracked')],[id(2)]:[message(2,['INBOX','STARRED'],'Review me')],[id(3)]:[message(3,['INBOX','IMPORTANT'],'Old'),message(4,['SENT'],'Answered')]};
 const {items}=await query('other',{tables:{intake:[{Kind:'Question','Gmail thread ID':id(1)}]},threads});
 assert.deepEqual(items.map(i=>i.title),['Review me']);
});
