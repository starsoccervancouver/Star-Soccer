const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const rid=n=>'rec'+String(n).padStart(14,'0');
async function fixture(t){
 const {openStore}=await import('../private-attendance/sqlite-store.mjs'),{createBookingPayments}=await import('../private-attendance/booking-payments.mjs');
 const store=openStore();t.after(()=>store.close());
 const familyId=rid(1),tables={bookings:[],allocations:[],payments:[]},original=[32.5,28];
 for(const [i,value] of original.entries())tables.bookings.push({id:rid(10+i),fields:{Family:[familyId],Player:[rid(20+i)],'Family reference':'household','Booking status':'Accepted','Charge review':'Agreed','Due now CAD':value}});
 let fault=false,seq=50;
 const db={async list(table,fields,formula){
  let rows=tables[table];
  if(formula){
   const value=formula.split("'")[1];
   if(formula.startsWith('RECORD_ID'))rows=rows.filter(r=>r.id===value);
   else if(formula.startsWith('LEFT'))rows=rows.filter(r=>r.fields['Allocation ID'].startsWith(value));
   else{const key=formula.match(/\{(.*?)\}/)[1];rows=rows.filter(r=>r.fields[key]===value);}
  }
  return structuredClone(rows);
 },async save(table,fields,options){
  let r=tables[table].find(r=>options.id?r.id===options.id:r.fields[options.key]===fields[options.key]);
  if(!r){r={id:rid(seq++),fields:{}};tables[table].push(r);}
  Object.assign(r.fields,fields);
  if(table==='allocations'){
   r.fields['Applied CAD']=fields['Amount CAD'];
   const receipt=tables.payments.find(p=>p.id===fields.Payment[0]);receipt.fields['Payment Allocations']=tables.allocations.filter(a=>a.fields.Payment[0]===receipt.id).map(a=>a.id);
   for(const [i,b] of tables.bookings.entries())b.fields['Due now CAD']=original[i]-tables.allocations.filter(a=>a.fields.Booking[0]===b.id).reduce((v,a)=>v+a.fields['Amount CAD'],0);
   if(fault){fault=false;throw Error('response lost');}
  }
  return structuredClone(r);
 }};
 const books=async()=>({rows:tables.bookings.map(b=>({status:'due',scope:'session',bookingId:b.id,playerId:b.fields.Player[0],familyId,familyName:'Fixture household',amountDue:b.fields['Due now CAD']}))});
 const service=createBookingPayments({store,db,books,today:()=>'2026-11-22'});
 const input={id:randomUUID(),familyId,date:'2026-11-21',method:'Cash',reference:'',items:[{bookingId:rid(10),dueCents:3250,applyCents:3250},{bookingId:rid(11),dueCents:2800,applyCents:750}]};
 return {service,tables,input,fail:()=>{fault=true;},save:v=>service.save('owner@example.test',v)};
}
test('one actual receipt reduces two exact bookings, supports partials and verifies a retry',async t=>{
 const {service,tables,input,fail,save}=await fixture(t);fail();
 await assert.rejects(save(input),/response lost/);
 assert.equal(service.pending()[0].amount,40);
 await assert.rejects(save({...input,id:randomUUID()}),/PAYMENT_PENDING/);
 await assert.rejects(save({...input,date:'2026-11-20'}),/PAYMENT_CONFLICT/);
 await assert.rejects(service.save('different@example.test',{id:input.id}),/PAYMENT_CONFLICT/);
 assert.deepEqual(await save({id:input.id}),{saved:true});assert.deepEqual(await save(input),{saved:true});
 assert.deepEqual(service.pending(),[]);assert.equal(tables.payments.length,1);assert.equal(tables.allocations.length,2);
 assert.deepEqual(tables.bookings.map(b=>b.fields['Due now CAD']),[0,20.5]);
 const receipt=tables.payments[0].fields;assert.equal(receipt['Payment date'],input.date);assert.equal(receipt['Amount CAD'],40);assert.equal(receipt.Method,'Cash');assert.deepEqual(receipt.Family,[input.familyId]);
});
test('stale balances, wrong families, invalid amounts/dates and reused transfer evidence cannot post',async t=>{
 const {service,tables,input,save}=await fixture(t);
 for(const change of [{familyId:rid(9)},{items:[{...input.items[0],dueCents:4000}]},{items:[{...input.items[0],applyCents:3251}]},{date:'2026-11-23'},{method:'E-transfer',reference:''}]){
  await assert.rejects(save({...input,...change}));
 }
 const wire={...input,method:'E-transfer',reference:'ABC123456'};
 tables.payments.push({id:rid(88),fields:{'Evidence reference':'Interac ABC123456',Method:'E-transfer'}});
 await assert.rejects(save(wire),/PAYMENT_ALREADY_EXISTS/);assert.equal(tables.allocations.length,0);assert.equal(service.pending().length,0);
 tables.payments.pop();await save(wire);assert.equal(tables.payments[0].fields['Source payment ID'],'INTERAC-ABC123456');
});
