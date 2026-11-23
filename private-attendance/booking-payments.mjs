import {collectibleBooking} from './session-books.mjs';
import {deny} from './coach-store.mjs';

const recordId=/^rec[A-Za-z0-9]{14}$/;
const commandId=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const cents=v=>Number.isFinite(v)?Math.round(v*100):null;
const one=(links,id)=>Array.isArray(links)&&links.length===1&&links[0]===id;
const conflict=()=>deny('PAYMENT_LEDGER_CHANGED',409);
const validCents=v=>Number.isSafeInteger(v)&&v>0;
const bookingFields=['Family','Player','Family reference','Booking status','Charge review','Due now CAD','Payment Allocations'];
const receiptFields=['Source payment ID','Payment reference','Evidence reference','Payment date','Direction','Method','Verification','Family','Family reference','Amount CAD','Payment context','Payment Allocations'];
const allocationFields=['Allocation ID','Payment','Booking','Amount CAD','Applied CAD','Review status'];

function validate(input,today){
 const {familyId,date,method,reference,items}=input;
 if(!recordId.test(familyId)||typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date||date>today||
  !['Cash','E-transfer'].includes(method)||typeof reference!=='string'||(method==='Cash'?reference!=='':!(/^[A-Z0-9]{6,24}$/).test(reference))||
  !Array.isArray(items)||!items.length||items.some(i=>!i||!recordId.test(i.bookingId)||!validCents(i.applyCents)||!validCents(i.dueCents)||i.applyCents>i.dueCents)||
  new Set(items.map(i=>i.bookingId)).size!==items.length||!validCents(items.reduce((n,i)=>n+i.applyCents,0)))deny('INVALID_PAYMENT',400);
 return {familyId,date,method,reference,items:items.map(({bookingId,dueCents,applyCents})=>({bookingId,dueCents,applyCents}))};
}

export function createBookingPayments({store,db,books,today}){
 store.run('CREATE TABLE IF NOT EXISTS booking_payment_commands(id TEXT PRIMARY KEY,actor TEXT NOT NULL,family TEXT NOT NULL,source TEXT NOT NULL UNIQUE,payload TEXT NOT NULL,plan TEXT NOT NULL,started INTEGER NOT NULL DEFAULT 0,done INTEGER NOT NULL DEFAULT 0)');
 const find=(table,fields,key,value)=>db.list(table,fields,"{"+key+"}='"+value+"'");
 async function booking(id){
  const rows=await db.list('bookings',bookingFields,"RECORD_ID()='"+id+"'");
  if(rows.length!==1||rows[0].id!==id)conflict();
  return rows[0].fields;
 }
 const pending=()=>store.all('SELECT id,plan FROM booking_payment_commands WHERE done=0').map(({id,plan})=>{
  const p=JSON.parse(plan);return {id,familyId:p.familyId,name:p.name,amount:p.total/100};
 });
 async function commit(plan,retry){
  const {source,familyId,familyRef,items,total}=plan;
  const received=await find('payments',receiptFields,'Source payment ID',source);
  if(received.length>1)conflict();
  let receipt=received[0];
  const memo='Coach Desk receipt '+plan.id;
  function assertReceipt(record){
   const f=record.fields;
   if(f['Source payment ID']!==source||f['Payment context']!==memo||f['Family reference']!==familyRef||!one(f.Family,familyId)||f.Method!==plan.method||f.Direction!=='Incoming'||f.Verification!=='Verified'||f['Payment date']!==plan.date||cents(f['Amount CAD'])!==total)conflict();
  }
  if(receipt)assertReceipt(receipt);
  if(retry&&!receipt){
   const {rows}=await books();
   if(!items.every(i=>rows.some(r=>collectibleBooking(r)&&r.status==='due'&&r.familyId===familyId&&r.bookingId===i.bookingId&&cents(r.amountDue)===i.dueCents)))conflict();
  }
  const allocations=await db.list('allocations',allocationFields,"LEFT({Allocation ID},"+(source.length+1)+")='"+source+"-'");
  const expected=new Set(items.map(i=>source+'-'+i.bookingId));
  if(allocations.some(a=>!expected.has(a.fields['Allocation ID']))||
    receipt?.fields['Payment Allocations']?.some(id=>!allocations.some(a=>a.id===id)))conflict();
  const targets=[];
  for(const item of items){
   const f=await booking(item.bookingId),id=source+'-'+item.bookingId;
   const existing=allocations.filter(a=>a.fields['Allocation ID']===id);
   if(!one(f.Family,familyId)||!one(f.Player,item.playerId)||!['Accepted','Completed'].includes(f['Booking status'])||f['Charge review']!=='Agreed'||
    (f['Family reference']?f['Family reference']!==familyRef:f['Payment Allocations']?.length)||existing.length>1)conflict();
   if(existing.length){
    const a=existing[0].fields;
    if(!receipt||!one(a.Payment,receipt.id)||!one(a.Booking,item.bookingId)||a['Review status']!=='Verified allocation'||cents(a['Amount CAD'])!==item.applyCents)conflict();
   }else if(cents(f['Due now CAD'])!==item.dueCents)conflict();
   targets.push({item,id,existing:existing.length>0,reference:f['Family reference']});
  }
  store.run('UPDATE booking_payment_commands SET started=1 WHERE id=?',plan.id);
  if(!receipt)receipt=await db.save('payments',{'Source payment ID':source,'Payment reference':source,'Amount CAD':total/100,Direction:'Incoming',Method:plan.method,Verification:'Verified',
   Family:[familyId],'Family reference':familyRef,'Payment date':plan.date,'Verified by':plan.actor,'Evidence reference':plan.reference||memo,'Payment context':memo},{key:'Source payment ID'});
  for(const {item,id,existing,reference} of targets){
   if(existing)continue;
   if(!reference)await db.save('bookings',{'Family reference':familyRef},{id:item.bookingId});
   await db.save('allocations',{'Allocation ID':id,Payment:[receipt.id],Booking:[item.bookingId],'Amount CAD':item.applyCents/100,'Review status':'Verified allocation'},{key:'Allocation ID'});
  }
  const saved=await find('payments',receiptFields,'Source payment ID',source);
  if(saved.length!==1||saved[0].id!==receipt.id)conflict();
  assertReceipt(saved[0]);
  for(const {item,id} of targets){
   const posted=await find('allocations',allocationFields,'Allocation ID',id);
   const a=posted[0]?.fields;
   if(posted.length!==1||!one(a.Payment,receipt.id)||!one(a.Booking,item.bookingId)||cents(a['Applied CAD'])!==item.applyCents||
    cents((await booking(item.bookingId))['Due now CAD'])!==item.dueCents-item.applyCents)deny('PAYMENT_PENDING',503);
  }
 }
 async function save(actor,input){
  if(!commandId.test(input.id))deny('INVALID_PAYMENT',400);
  const old=store.get('SELECT * FROM booking_payment_commands WHERE id=?',input.id);
  const resume=Object.keys(input).length===1;
  const payload=resume?null:JSON.stringify(validate(input,today()));
  if(old&&(actor!==old.actor||(!resume&&payload!==old.payload)))deny('PAYMENT_CONFLICT',409);
  if(resume&&!old)deny('PAYMENT_CONFLICT',409);
  if(old?.done)return {saved:true};
  let plan;
  if(old)plan=JSON.parse(old.plan);
  else{
   const p=JSON.parse(payload);
   if(store.get('SELECT id FROM booking_payment_commands WHERE family=? AND done=0',p.familyId))deny('PAYMENT_PENDING',409);
   const {rows}=await books(),items=[],references=new Set();
   let name;
   for(const item of p.items){
    const row=rows.find(r=>collectibleBooking(r)&&r.status==='due'&&r.bookingId===item.bookingId&&r.familyId===p.familyId);
    if(!row||cents(row.amountDue)!==item.dueCents)conflict();
    const f=await booking(item.bookingId);
    if(!one(f.Family,p.familyId)||!one(f.Player,row.playerId)||(!f['Family reference']&&f['Payment Allocations']?.length))conflict();
    if(f['Family reference'])references.add(f['Family reference']);
    name=row.familyName||row.contact?.guardian||'Family';
    items.push({...item,playerId:row.playerId});
   }
   if(references.size>1)conflict();
   const source=p.method==='Cash'?'COACH-'+input.id:'INTERAC-'+p.reference;
   if(p.method==='E-transfer'){
    if(store.get('SELECT id FROM booking_payment_commands WHERE source=?',source))deny('PAYMENT_ALREADY_EXISTS',409);
    const records=await db.list('payments',['Source payment ID','Payment reference','Evidence reference']);
    if(records.some(({fields:f})=>[f['Source payment ID'],f['Payment reference']].some(v=>[source,p.reference].includes(String(v||'').trim().toUpperCase()))||
      (String(f['Evidence reference']||'').toUpperCase().match(/[A-Z0-9]+/g)||[]).includes(p.reference)))deny('PAYMENT_ALREADY_EXISTS',409);
   }
   plan={...p,id:input.id,actor,source,name,items,familyRef:[...references][0]||name,total:items.reduce((n,i)=>n+i.applyCents,0)};
   store.run('INSERT INTO booking_payment_commands(id,actor,family,source,payload,plan) VALUES(?,?,?,?,?,?)',input.id,actor,p.familyId,source,payload,JSON.stringify(plan));
  }
  try{await commit(plan,!!old);}
  catch(error){
   // A rejected preflight has no remote writes. Once a write was attempted, keep the original command for recovery.
   if(error.code==='PAYMENT_LEDGER_CHANGED')store.run('DELETE FROM booking_payment_commands WHERE id=? AND started=0',input.id);
   throw error;
  }
  store.run('UPDATE booking_payment_commands SET done=1 WHERE id=?',input.id);
  return {saved:true};
 }
 return {save,pending};
}
