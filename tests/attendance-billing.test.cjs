const test = require('node:test');
const assert = require('node:assert/strict');
const id = n => 'rec'+String(n).padStart(14,'0');

function fixture() {
  const input = {playerId:id(1),sessionId:id(2),attendanceId:id(3)};
  const session = {date:'2026-11-27',programId:id(7),players:[{playerId:id(1)}]};
  const rows = {
    sessions:[{id:id(2),fields:{Date:'2026-11-27','Weekly program':[id(7)],'Session rate CAD':25}}],
    programs:[{id:id(7),fields:{'Drop-in CAD':25}}],
    players:[{id:id(1),fields:{Family:[id(4)],'Recurring Enrollments':[id(5)]}}],
    attendance:[{id:id(3),fields:{Player:[id(1)],Session:[id(2)],Enrollment:[id(5)],'Coverage state':'Active','Expected per-session CAD':30}}],
    enrollments:[{id:id(5),fields:{'Enrollment status':'Active','Effective from':'2026-10-01',Player:[id(1)],Family:[id(4)],'Weekly program':[id(7)],'Billing approval':'Approved','Billing schedule':'Per session','Agreed per-session CAD':30}}],
    bookings:[]
  };
  const db = {
    list:async (table,fields,filter) => rows[table].filter(r=>filter.startsWith('{Source booking ID}') ?
      filter.includes(r.fields['Source booking ID']) : filter.includes(r.id)),
    async save(table,data,options) {
      if (options.id) return Object.assign(rows[table].find(r=>r.id===options.id).fields,data);
      assert.equal(options.key,'Source booking ID');
      const row={id:id(8),fields:data};
      row.fields['Billing basis']='Attendance';
      rows[table].push(row);
      rows.attendance[0].fields.Booking=[row.id];
      rows.players[0].fields.Bookings=[row.id];
      return row;
    }
  };
  return {input,session,rows,db};
}

test('a present visit uses the dated session rate rather than an older player agreement, across retries',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  const {input,session,rows,db}=fixture();
  await prepareAttendedVisit(db,input,session);
  await prepareAttendedVisit(db,input,session);
  assert.equal(rows.bookings.length,1);
  assert.deepEqual(rows.bookings[0].fields.Player,[input.playerId]);
  assert.deepEqual(rows.bookings[0].fields.Attendance,[input.attendanceId]);
  assert.equal(rows.bookings[0].fields['Charge CAD'],25);
});

test('valid pass, lapsed pass, historical date and duplicate roster entries do not create visit fees',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  for (const scenario of ['pass','expired','historical','duplicate']) {
    const {input,session,rows,db}=fixture();
    if(scenario==='historical') session.date='2026-11-20';
    if(scenario==='duplicate') session.players.push({playerId:id(1)});
    if(['pass','expired'].includes(scenario)) Object.assign(rows.enrollments[0].fields,
      {'Billing schedule':'Four-session prepaid','Prepaid covered from':'2026-11-01','Prepaid covered until':scenario==='pass'?'2026-12-01':'2026-11-10'});
    await prepareAttendedVisit(db,input,session);
    assert.equal(rows.bookings.length,0);
    if(scenario==='pass') assert.equal(rows.attendance[0].fields['Billing review'],'Approved coverage');
    if(['expired','duplicate'].includes(scenario)) assert.equal(rows.attendance[0].fields['Billing review'],'Needs reconciliation');
  }
});

test('an unknown session rate creates a price-review line with no invented charge',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  const {input,session,rows,db}=fixture();
  delete rows.sessions[0].fields['Session rate CAD'];
  delete rows.programs[0].fields['Drop-in CAD'];
  await prepareAttendedVisit(db,input,session);
  assert.equal(rows.bookings[0].fields['Charge review'],'Needs pricing confirmation');
  assert.equal(rows.bookings[0].fields['Charge CAD'],undefined);
});

test('an existing dated booking is repriced without changing recorded payments',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  const {input,session,rows,db}=fixture();
  rows.attendance[0].fields.Booking=[id(8)];
  rows.bookings.push({id:id(8),fields:{Player:[input.playerId],Family:[id(4)],Attendance:[input.attendanceId],
    'First session':[input.sessionId],'Start date':session.date,'Covered dates':session.date,'Booking status':'Accepted',
    'Booking type':'Drop-in','Billing basis':'Attendance','Charge review':'Agreed','Charge CAD':30,
    'Agreed per-visit CAD':30,'Payment Allocations':[id(20)]}});
  await prepareAttendedVisit(db,input,session);
  assert.equal(rows.bookings[0].fields['Charge CAD'],25);
  assert.equal(rows.bookings[0].fields['Agreed per-visit CAD'],25);
  assert.deepEqual(rows.bookings[0].fields['Payment Allocations'],[id(20)]);
});

test('past charges, fixed packages and passes keep their agreed prices',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  for(const kind of ['past','pass','package']){
    const {input,session,rows,db}=fixture();
    if(kind==='past')session.date='2026-11-26';
    rows.attendance[0].fields.Booking=[id(8)];
    rows.bookings.push({id:id(8),fields:{Player:[input.playerId],Attendance:[input.attendanceId],
      'First session':[input.sessionId],'Start date':session.date,'Covered dates':session.date,'Booking status':'Accepted',
      'Billing basis':kind==='past'?'Attendance':'Pass or package',
      'Booking type':kind==='pass'?'Four consecutive sessions':'Drop-in',
      'Fixed-price package':kind==='package','Charge review':'Agreed','Charge CAD':185}});
    await prepareAttendedVisit(db,input,session);
    assert.equal(rows.bookings[0].fields['Charge CAD'],185,kind);
  }
});

test('a free dated session and the weekly fallback use their actual prices',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  for(const kind of ['free','fallback']){
    const {input,session,rows,db}=fixture();
    if(kind==='free')rows.sessions[0].fields['Session rate CAD']=0;
    else delete rows.sessions[0].fields['Session rate CAD'];
    await prepareAttendedVisit(db,input,session);
    assert.equal(rows.bookings[0].fields['Charge CAD'],kind==='free'?0:25);
  }
});

test('a player without a family still gets their own attendance-priced booking',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  const {input,session,rows,db}=fixture();
  delete rows.players[0].fields.Family;
  delete rows.players[0].fields['Recurring Enrollments'];
  delete rows.attendance[0].fields.Enrollment;
  await prepareAttendedVisit(db,input,session);
  assert.equal(rows.bookings[0].fields['Charge CAD'],25);
  assert.equal(rows.bookings[0].fields.Family,undefined);
  assert.deepEqual(rows.bookings[0].fields.Player,[input.playerId]);
});

test('a shared drop-in booking with incompatible session rates is held for review',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  const {input,session,rows,db}=fixture();
  rows.attendance[0].fields.Booking=[id(8)];
  rows.bookings.push({id:id(8),fields:{Player:[input.playerId],Attendance:[input.attendanceId,id(9)],
    'First session':[input.sessionId],'Start date':session.date,'Covered dates':session.date+', 2026-12-04','Booking status':'Accepted',
    'Booking type':'Drop-in','Billing basis':'Attendance','Charge review':'Agreed','Charge CAD':60,'Agreed per-visit CAD':30}});
  await prepareAttendedVisit(db,input,session);
  assert.equal(rows.attendance[0].fields['Billing review'],'Needs reconciliation');
  assert.equal(rows.bookings[0].fields['Charge CAD'],60);
});

test('a drop-in linked to explicitly prepaid attendance is held instead of being repriced',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  const {input,session,rows,db}=fixture();
  Object.assign(rows.attendance[0].fields,{Booking:[id(8)],'Billing schedule at date':'Four-session prepaid','Coverage approved':true});
  rows.bookings.push({id:id(8),fields:{Player:[input.playerId],Attendance:[input.attendanceId],
    'First session':[input.sessionId],'Start date':session.date,'Covered dates':session.date,'Booking status':'Accepted',
    'Booking type':'Drop-in','Billing basis':'Attendance','Charge review':'Agreed','Charge CAD':30}});
  await prepareAttendedVisit(db,input,session);
  assert.equal(rows.attendance[0].fields['Billing review'],'Needs reconciliation');
  assert.equal(rows.bookings[0].fields['Charge CAD'],30);
});

test('an owner-cancelled booking is never reopened by a retried attendance write',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  const {input,session,rows,db}=fixture();
  rows.bookings.push({id:id(8),fields:{'Booking status':'Cancelled','Source booking ID':'VISIT-'+input.sessionId+'-'+input.playerId}});
  await prepareAttendedVisit(db,input,session);
  assert.equal(rows.bookings.length,1);
  assert.equal(rows.bookings[0].fields['Booking status'],'Cancelled');
  assert.equal(rows.attendance[0].fields['Billing review'],'Needs reconciliation');
});
