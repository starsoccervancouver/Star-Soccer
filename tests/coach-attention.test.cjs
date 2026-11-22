const test=require('node:test');
const assert=require('node:assert/strict');
const inbox='romeo@example.test', now=Date.parse('2026-11-20T08:05Z');
const id=n=>String(1000000000000000+n);
const wrap=fields=>({fields,id:id(100)});
const query=async(kind,{tables={},messages=[],threads={},labels={Deposited:'label1'}}={},cursor)=>{
 const {attentionPage}=await import('../private-attendance/attention-inbox.mjs');
 const ledger={list:async name=>(tables[name]||[]).map(wrap)};
 async function read(path){
  if(path==='messages')return {messages:messages.map(({id})=>({id}))};
  if(path==='threads')return {threads:Object.keys(threads).map(id=>({id}))};
  if(path.startsWith('messages/'))return messages.find(m=>m.id===path.slice(9));
  const key=path.slice(8);if(threads[key])return {messages:threads[key]};
  throw Error('GMAIL_404');
 }
 return attentionPage({ledger,read,labels,mailbox:inbox,now},kind,cursor);
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
 const nested=await query('payments',{labels:{'Payments - Incoming/Deposited':'nested'},messages:[transfer(2,'DEF456',['nested']),transfer(4,'HIJ789',[])]});
 assert.deepEqual(nested.resolved,['INTERAC-DEF456']);assert.deepEqual(nested.items.map(i=>i.key),['INTERAC-HIJ789']);
 const res=await query('payments',{messages:[transfer(1,'ABC123',[]),transfer(2,'DEF456',[]),transfer(3,'DEF456',['label1']),transfer(4,'HIJ789',[]),transfer(5,'SPOOF1',[],undefined,false)],tables:{payments:[{Verification:'Verified',Direction:'Incoming','Evidence reference':'Gmail '+id(4)+'; Interac HIJ789'}]}});
 assert.deepEqual(res.items.filter(i=>!res.resolved.includes(i.key)).map(i=>i.key),['INTERAC-ABC123']);
});
test('other mail skips tracked and answered threads and opens the exact flagged incoming message',async()=>{
 const threads={[id(1)]:[message(1,['INBOX','IMPORTANT'],'Tracked')],[id(2)]:[message(2,['INBOX','STARRED'],'Review me')],[id(3)]:[message(3,['INBOX','IMPORTANT'],'Old'),message(4,['SENT'],'Answered')]};
 const {items}=await query('other',{tables:{intake:[{Kind:'Question','Gmail thread ID':id(1)}]},threads});
 assert.deepEqual(items.map(i=>i.title),['Review me']);
});

test('report completions persist across reads, reopen for new mail, and keep transfer reminders grouped',async()=>{
 const {reportCompletions}=await import('../private-attendance/report-completions.mjs');
 const marks=new Map(),storage={
  get:async keys=>Array.isArray(keys)?new Map(keys.filter(key=>marks.has(key)).map(key=>[key,marks.get(key)])):marks.get(keys),
  put:async(key,value)=>marks.set(key,value),delete:async key=>marks.delete(key)
 };
 const reports=()=>reportCompletions(storage,'fixture-secret');
 const row=async(kind,messageId)=>(await reports().include(kind,{items:[{key:'same-thread',messageId}]})).items[0];
 for(const kind of ['other','inquiries','payments','registrations']){
  const first=await row(kind,'message1');assert.equal(first.completed,false);
  await reports().set(kind,first.completionToken,true);
  await reports().set(kind,first.completionToken,true);
  assert.equal((await row(kind,'message1')).completed,true);
  assert.equal((await row(kind,'message2')).completed,['payments','registrations'].includes(kind));
  await assert.rejects(reports().set('different-category',first.completionToken,false),/INVALID_REQUEST/);
  await reports().set(kind,first.completionToken,false);
  assert.equal((await row(kind,'message1')).completed,false);
 }
});

test('saved rows can be found and reopened after leaving the live report; legacy marks and archive pages stay distinct',async()=>{
 const {reportCompletions}=await import('../private-attendance/report-completions.mjs');
 const marks=new Map(),storage={
  get:async keys=>Array.isArray(keys)?new Map(keys.filter(k=>marks.has(k)).map(k=>[k,marks.get(k)])):marks.get(keys),
  put:async(k,v)=>marks.set(k,v),delete:async k=>marks.delete(k),
  list:async({prefix,startAfter='',limit})=>new Map([...marks].filter(([k])=>k.startsWith(prefix)&&k>startAfter).sort(([a],[b])=>a<b?-1:1).slice(0,limit))
 };
 const reports=()=>reportCompletions(storage,'fixed-secret');
 const row=async n=>(await reports().include('inquiries',{items:[{key:'thread',messageId:String(n),title:'Session question '+n,status:'Awaiting reply',date:'2026-11-21',href:'https://mail.google.com/#all/'+n}]})).items[0];
 const first=await row(1),second=await row(2);
 await assert.rejects(reports().set('inquiries',first.completionToken,true,second.receipt),/INVALID_REQUEST/);
 await reports().set('inquiries',first.completionToken,true,first.receipt);
 const [saved]=(await reports().history('inquiries')).items;
 assert.equal(saved.title,first.title);assert.equal(saved.href,first.href);assert.ok(saved.completedAt);
 assert.deepEqual((await reports().history('payments')).items,[]);
 assert.equal((await row(2)).completed,false);
 await reports().set('inquiries',saved.completionToken,false,saved.receipt);
 assert.equal((await reports().history('inquiries')).items[0].reopened,true);
 await reports().set('inquiries',second.completionToken,true);
 assert.equal((await row(2)).completed,true);
 assert.equal((await reports().history('inquiries')).items.find(i=>i.messageId==='2').completedAt,null);
 for(let i=3;i<=52;i++){const r=await row(i);await reports().set('inquiries',r.completionToken,true,r.receipt);}
 const page=await reports().history('inquiries'),next=await reports().history('inquiries',page.next);
 assert.equal(page.items.length,50);assert.equal(next.items.length,2);assert.equal(next.next,null);
 assert.equal(new Set([...page.items,...next.items].map(i=>i.completionToken)).size,52);
});
