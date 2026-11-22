const test=require('node:test'),assert=require('node:assert/strict');
const id=n=>String(1000000000000000+n),contact='parent@example.test',owner='club@example.test';
test('only confirmed aligned bookings file their original registration, actual sent confirmation and evidenced inbound leads',async()=>{
 const {outcomeFiling,outcomePlans}=await import('../private-attendance/gmail-outcome-labels.mjs');
 const reg={id:'r',fields:{Status:'Confirmed',Booking:['b'],Player:['p'],Family:['f'],'Parent email':contact,'Source Gmail ID':id(1),'Confirmation Gmail ID':id(2),Reference:'SS-EXAMPLE'}};
 const booking={id:'b',fields:{'Booking status':'Accepted',Family:['f'],Player:['p']}};
 const lead=(n,stage,ref)=>({id:'lead'+n,fields:{Kind:'Question','Parent email':contact,Family:['f'],'Message ID':id(n),'Lead stage':stage,'Web client reference':ref}});
 const leads=[lead(3),lead(4),lead(5,'Registered'),lead(6,'Lost'),lead(7,undefined,'SS-EXAMPLE')];
 assert.equal(outcomePlans([{...reg,fields:{...reg.fields,Status:'Expected'}}],[booking],leads).length,0);
 assert.equal(outcomePlans([reg],[{...booking,fields:{...booking.fields,Player:['other']}}],leads).length,0);
 const messages=new Map();
 for(let n=1;n<=7;n++){
  messages.set(id(n),{id:id(n),threadId:n===3?id(2):id(n),labelIds:n===2?['SENT']:n===7?['lost']:[],internalDate:String(n===2?200:100),payload:{headers:[{name:'From',value:n===2?owner:contact},{name:'To',value:n===2?contact:owner}]}});
 }
 const map=new Map(),storage={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),delete:async k=>map.delete(k),transaction:async fn=>fn(storage),list:async({prefix,limit})=>new Map([...map].filter(([k])=>k.startsWith(prefix)).slice(0,limit))};
 let now=5e6;const calls=[];
 const labels={'Registrations/Registered':'registered','Registrations/Confirmtaions':'confirmed','Leads/Converted':'converted','Leads/Lost':'lost','Payments - Incoming/Deposited':'deposited','Payments - Incoming/Receipts':'receipts'};
 const job=outcomeFiling({storage,clock:()=>now,owners:[owner],labels,ledger:{list:async n=>({bookings:[booking],registrations:[reg],intake:leads})[n]},read:async path=>messages.get(path.slice(9)),modify:async(id,labels)=>{calls.push([id,...labels]);messages.get(id).labelIds.push(...labels);}});
 async function finish(){for(let i=0;i<10;i++)if(!await job.step())return;throw Error('not finished');}
 await finish();assert.deepEqual(calls,[[id(2),'confirmed'],[id(1),'registered'],[id(3),'converted'],[id(5),'converted']]);
 now+=3600001;await finish();assert.equal(calls.length,4);
 for(const m of messages.values())m.labelIds=[];messages.get(id(2)).labelIds=['DRAFT','SENT'];now+=3600001;await finish();assert.equal(calls.length,4);
});