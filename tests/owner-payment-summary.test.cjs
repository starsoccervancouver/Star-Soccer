const {test}=require('node:test');
const assert=require('node:assert/strict');

test('upcoming totals separate gross bookings, known outstanding balances and unknowns',async()=>{
 const {ownerWorkflows,fields}=await import('../private-attendance/owner-workflows.mjs');
 const data=Object.fromEntries(Object.keys(fields).map(key=>[key,[]]));
 const booking=(id,gross,balance,due)=>({id,fields:{'Booking status':'Accepted','Charge review':'Agreed',
   'Upcoming booked CAD':gross,'Balance CAD':balance,'Due now CAD':due}});
 data.bookings=[booking('settled',655,0,0),booking('partial',185,100,15),booking('missing',50,undefined,0)];
 const report=ownerWorkflows(data,{now:Date.now(),notices:[],calendar:[],desk:{sessions:[]}});
 const summary=report.lines.find(row=>row.group==='Payments').text;
 assert.match(summary,/\$15\.00 due now/);
 assert.match(summary,/\$85\.00 outstanding on upcoming bookings \(1 balances unknown\)/);
 assert.match(summary,/\$890\.00 upcoming booked/);
 assert.ok(report.items.some(row=>row.title==='Upcoming balance unknown'&&row.link.endsWith('/missing')));
});

test('verified cash with a player-only booking counts once, and conflicting links stay unresolved',async()=>{
 const {ownerWorkflows,fields}=await import('../private-attendance/owner-workflows.mjs');
 const data=Object.fromEntries(Object.keys(fields).map(key=>[key,[]]));
 const payment={Direction:'Incoming',Verification:'Verified',Method:'Cash','Amount CAD':60,'Players associated (not allocation)':['child']};
 data.payments=[{id:'receipt',fields:payment}];
 data.bookings=[{id:'camp',fields:{Player:['child']}}];
 data.allocations=[{fields:{Payment:['receipt'],Booking:['camp'],'Applied CAD':60,'Review status':'Verified allocation'}}];
 const remaining=()=>ownerWorkflows(data,{now:Date.now(),notices:[],calendar:[],desk:{sessions:[]}}).items.some(row=>row.link.endsWith('/receipt'));
 assert.equal(remaining(),false);
 data.bookings[0].fields.Player=['other'];
 assert.equal(remaining(),true);
 data.bookings[0].fields.Player=['child'];
 payment.Family=['other-family'];
 assert.equal(remaining(),true);
 delete payment.Family;
 data.allocations=[];
 assert.equal(remaining(),true);
});
