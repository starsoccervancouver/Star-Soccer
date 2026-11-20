const {test}=require('node:test'),assert=require('node:assert/strict');
const memory=()=>{const map=new Map();return {get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),delete:async k=>(Array.isArray(k)?k:[k]).forEach(id=>map.delete(id)),list:async({prefix,limit})=>new Map([...map].filter(([k])=>k.startsWith(prefix)).slice(0,limit))};};
test('hourly generation resumes in bounded batches, clears on a family reply, and holds on source failure',async()=>{
 const {createFollowupJob}=await import('../private-attendance/registration-followup-job.mjs');
 const {STAR_SOCCER_OWNER}=await import('../private-attendance/deployment-config.mjs');
 const t0=Date.parse('2026-11-17T15:00:00Z'),conf='11ab000000000001',thr='11ab000000000002',parent='test@example.test',bid='booking-123';
 const reg={Reference:'SS-REG-001',Player:['p'],Family:['f'],Booking:[bid],'Confirmation Gmail ID':conf,'Parent email':parent,'Player history at registration':'First-time verified'};
 const tables={registrations:[{id:'r',fields:reg}],bookings:[{id:bid,fields:{Player:['p'],Family:['f'],'Booking status':'Accepted'}}],players:[{id:'p',fields:{Family:['f']}}],families:[{id:'f',fields:{Email:parent}}]};
 let now=t0+86400000,h='100',calls=0,fail=false;
 const storage=memory(),ledger={async listPage(table){calls++;if(fail)throw Error('quota');return {records:tables[table]||[]};}};
 const message=(id,labels,from,to,at)=>({id,threadId:thr,internalDate:String(at),labelIds:labels,payload:{mimeType:'text/plain',headers:Object.entries({From:from,To:to,Subject:'Registration confirmed | SS-REG-001'}).map(([name,value])=>({name,value})),body:{data:''}}});
 const msgs=[message(conf,['SENT'],STAR_SOCCER_OWNER,parent,t0)];
 const read=async path=>{calls++;if(path==='profile')return {emailAddress:STAR_SOCCER_OWNER,historyId:h};if(path==='threads')return {threads:[{id:thr}]};if(path==='messages/'+conf)return {id:conf,threadId:thr};if(path==='threads/'+thr)return {id:thr,historyId:h,messages:msgs};throw Error('Unexpected read');};
 async function finish(){
  for(let i=0;i<25;i++){const job=createFollowupJob({storage,ledger,read,config:{baseId:'fixture',tables:{bookings:'bookings'}},clock:()=>now});calls=0;const result=await job.step();assert(calls<=6);if(result.state!=='checking')return result;}
  throw Error('Check did not finish');
 }
 const first=await finish();assert.equal(first.state,'ready');assert.equal(first.items[0].label,'Follow up with family');
 assert.deepEqual(await finish(),first);assert.equal(calls,0);
 now+=3600000;h='101';msgs.push(message('11ab000000000003',['INBOX'],parent,STAR_SOCCER_OWNER,now-1000));assert.deepEqual((await finish()).items,[]);
 now+=3600000;fail=true;assert.equal((await finish()).state,'unavailable');
});
test('no verified new bookings finishes with one ledger page and one mailbox identity check',async()=>{
 const {createFollowupJob}=await import('../private-attendance/registration-followup-job.mjs');
 const {STAR_SOCCER_OWNER}=await import('../private-attendance/deployment-config.mjs');
 const calls=[];const job=createFollowupJob({storage:memory(),config:{},ledger:{listPage:async(name,fields,formula)=>{calls.push(name);assert.match(formula,/First-time verified/);return {records:[]};}},read:async path=>{calls.push(path);return {emailAddress:STAR_SOCCER_OWNER,historyId:'123'};}});
 const preview=await job.step({force:true});assert.equal(preview.lastScheduledAt,null);calls.length=0;
 const r=await job.step();assert.ok(r.lastScheduledAt);assert.equal(r.eligibleBookings,0);assert.equal(r.state,'ready');assert.deepEqual(calls,['registrations','profile']);
});
