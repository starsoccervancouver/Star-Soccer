const test = require('node:test');
const assert = require('node:assert/strict');
const id = n => 'rec'+String(n).padStart(14,'0');

function fixture() {
  const input = {playerId:id(1),sessionId:id(2),attendanceId:id(3)};
  const session = {date:'2026-11-27',programId:id(7),players:[{playerId:id(1)}]};
  const rows = {
    players:[{id:id(1),fields:{Family:[id(4)],'Recurring Enrollments':[id(5)]}}],
    attendance:[{id:id(3),fields:{Player:[id(1)],Session:[id(2)],Enrollment:[id(5)],'Coverage state':'Active','Expected per-session CAD':30}}],
    enrollments:[{id:id(5),fields:{'Enrollment status':'Active','Effective from':'2026-10-01',Player:[id(1)],Family:[id(4)],'Weekly program':[id(7)],'Billing approval':'Approved','Billing schedule':'Per session','Agreed per-session CAD':30}}],
    bookings:[]
  };
  const db = {
    list:async (table,fields,filter) => rows[table].filter(r=>filter.includes(r.id)),
    async save(table,data,options) {
      if (options.id) return Object.assign(rows[table].find(r=>r.id===options.id).fields,data);
      assert.equal(options.key,'Source booking ID');
      const row={id:id(8),fields:data};
      rows[table].push(row);
      rows.attendance[0].fields.Booking=[row.id];
      rows.players[0].fields.Bookings=[row.id];
      return row;
    }
  };
  return {input,session,rows,db};
}

test('a present visit gets one allocatable booking at the approved player rate across retries',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  const {input,session,rows,db}=fixture();
  await prepareAttendedVisit(db,input,session);
  await prepareAttendedVisit(db,input,session);
  assert.equal(rows.bookings.length,1);
  assert.deepEqual(rows.bookings[0].fields.Player,[input.playerId]);
  assert.deepEqual(rows.bookings[0].fields.Attendance,[input.attendanceId]);
  assert.equal(rows.bookings[0].fields['Charge CAD'],30);
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

test('an unknown or conflicting rate creates a price-review line with no invented charge',async()=>{
  const {prepareAttendedVisit}=await import('../private-attendance/attendance-billing.mjs');
  const {input,session,rows,db}=fixture();
  rows.enrollments[0].fields['Agreed per-session CAD']=45;
  await prepareAttendedVisit(db,input,session);
  assert.equal(rows.bookings[0].fields['Charge review'],'Needs pricing confirmation');
  assert.equal(rows.bookings[0].fields['Charge CAD'],undefined);
});
