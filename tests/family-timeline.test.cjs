const test=require('node:test');
const assert=require('node:assert/strict');
test('a family receipt identifies sibling bookings and the exact source message',async()=>{
 const {createFamilyLedger}=await import('../private-attendance/family-ledger.mjs');
 const id=n=>'rec'+String(n).padStart(14,'0');
 const row=(n,fields)=>({id:id(n),fields:{Family:[id(1)],...fields}});
 const data={families:[row(1,{Players:[id(2),id(3)],Bookings:[id(4),id(5)],Payments:[id(6)]})],
  players:[row(2,{Player:'A'}),row(3,{Player:'B'})],
  bookings:[row(4,{Player:[id(2)],'Booking reference':'First'}),row(5,{Player:[id(3)],'Booking reference':'Second'})],
  payments:[row(6,{'Payment Allocations':[id(7),id(8)],'Amount CAD':120,'Evidence reference':'Gmail 1234567890abcdef; Interac example'})],
  allocations:[7,8].map(n=>row(n,{Payment:[id(6)],Booking:[id(n-3)],'Applied CAD':60,'Review status':'Verified allocation'}))};
 const ledger=createFamilyLedger(async(table,fields,ids)=>data[table].filter(r=>ids.includes(r.id)));
 const payment=async()=>(await ledger.detail(id(1))).timeline.find(e=>e.kind==='Payment');
 const p=await payment();assert.equal(p.message,'1234567890abcdef');
 assert.deepEqual(p.details.filter(Boolean),['$60.00 applied to A · First','$60.00 applied to B · Second']);
 data.allocations[1].fields.Booking=[id(99)];
 assert((await payment()).details.includes('Allocation needs review'));
});
