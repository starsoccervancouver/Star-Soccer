import {createHash} from 'node:crypto';
const columns={
 bookings:['Family','Player','First session','Covered dates','Start date','Charge CAD','Charge review','Fixed-price package','Agreed per-visit CAD'],
 payments:['Family','Booking','Amount CAD','Training portion CAD','Thank-you gift CAD','Direction','Method','Payment date','Verification','Verified by','Source payment ID'],
 allocations:['Payment','Booking','Amount CAD','Review status','Allocation ID']
};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const evidence=(kind,fields)=>Object.fromEntries(columns[kind].filter(k=>fields[k]!==undefined).map(k=>[k,fields[k]]));
// Only instrument writes already authorized by the caller. Intents describe requests; confirmed events require the source record ID.
export function auditFinancialWrites(db,storage,{source,actor,reason,clock}){
 const context={source,actor,reason};
 async function track(table,values,opts){
  if(!columns[table])return db.saveMany(table,values,opts);
  const intents=values.map(f=>{
   const key=opts.id||f[opts.key];if(!key)throw Error('FINANCIAL_SOURCE_KEY_REQUIRED');
   const facts=evidence(table,f);
   const ref=hash([context,table,key,facts]);
   return {ref,table,sourceKey:key,requested:facts,...context};
  });
  await storage.transaction(async tx=>{
   for(const i of intents)if(!await tx.get('finance:event:'+i.ref)&&!await tx.get('finance:pending:'+i.ref))
    await tx.put('finance:pending:'+i.ref,{...i,requestedAt:new Date(clock()).toISOString()});
  });
  const rows=await db.saveMany(table,values,opts);
  if(rows.length!==intents.length||rows.some(r=>!r.id||!r.fields))throw Error('AIRTABLE_WRITE_UNCERTAIN');
  await storage.transaction(async tx=>{
   for(const [n,i] of intents.entries()){
    const eventKey='finance:event:'+i.ref;
    if(!await tx.get(eventKey)){
     const intent=await tx.get('finance:pending:'+i.ref),f=evidence(table,rows[n].fields);
     const type=table==='bookings'?'charge':table==='allocations'?'allocation':f.Verification!=='Verified'?'unverified payment record':f.Direction==='Incoming'?'verified payment':'outgoing payment for review';
     await tx.put(eventKey,{...intent,type,recordId:rows[n].id,observed:f,confirmedAt:new Date(clock()).toISOString()});
    }
    await tx.delete('finance:pending:'+i.ref);
   }
  });
  return rows;
 }
 return {...db,saveMany:track,async save(table,fields,opts){
  if(!columns[table])return db.save(table,fields,opts);
  return (await track(table,[fields],opts))[0];
 }};
}
