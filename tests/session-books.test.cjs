const {test} = require('node:test');
const assert = require('node:assert/strict');
const books = import('../private-attendance/session-books.mjs');
const today = '2026-11-22';
function fixture() {
  return {
    sessions: [{id: 'friday', fields: {Session: 'Friday Kits', Date: '2026-11-20', Time: '3:45–4:45 pm', Venue: 'Kits',
      'Session status': 'Completed', Attendance: ['a']}}],
    players: [{id: 'child', fields: {Player: 'Test player', Attendance: ['a'], Bookings: ['b'], Family: ['f']}}],
    attendance: [{id: 'a', fields: {Session: ['friday'], Player: ['child'], Booking: ['b'], 'Coverage state': 'Active',
      'Session date': '2026-11-20', 'Attendance status': 'Present'}}],
    families: [{id: 'f', fields: {Players: ['child'], 'Guardian name': 'Test parent', Email: 'parent@example.invalid', Phone: '555',
      'Verified family receipts CAD': 20, 'Verified applied CAD': 20, 'Unverified payment claims CAD': 0}}],
    bookings: [{id: 'b', fields: {Player: ['child'], Family: ['f'], Attendance: ['a'], 'First session': ['friday'],
      'Start date': '2026-11-20', 'Covered dates': '2026-11-20', 'Booking status': 'Completed', 'Booking type': 'Drop-in', 'Billing basis': 'Historical',
      'Charge review': 'Agreed', 'Charge CAD': 45, 'Attendance-adjusted charge CAD': 45, 'Verified applied CAD': 20,
      'Balance CAD': 25, 'Due now CAD': 25, 'Unresolved price count': 0}}]
  };
}
async function project(change) {
  const inputs = fixture();
  if (change) change(inputs);
  return (await books).buildSessionBooks(inputs, today).rows;
}
function nextSeat(data) {
  const next = structuredClone(data.sessions[0]);
  next.id = 'sunday';
  Object.assign(next.fields, {Session: 'Sunday Kits', Date: '2026-11-22', Attendance: ['a2']});
  data.sessions.push(next);
  const another = structuredClone(data.attendance[0]);
  another.id = 'a2';
  Object.assign(another.fields, {Session: ['sunday'], 'Session date': '2026-11-22'});
  data.attendance.push(another);
  data.players[0].fields.Attendance.push('a2');
  data.bookings[0].fields.Attendance.push('a2');
  data.bookings[0].fields['Covered dates'] += ', 2026-11-22';
}

test('attributes only the exact charge and its verified partial allocation to a single dated player visit', async () => {
  const [row] = await project();
  assert.deepEqual(row, {scope: 'session', attendanceId: 'a', sessionId: 'friday', sessionLabel: 'Friday Kits',
    date: '2026-11-20', time: '3:45–4:45 pm', location: 'Kits', attendanceStatus: 'Present', playerId: 'child', playerName: 'Test player',
    bookingId: 'b', bookingType: 'Drop-in', status: 'due', amountCharged: 45, amountPaid: 20,
    amountDue: 25, familyId: 'f', familyName: 'Test parent', contact: {guardian: 'Test parent', email: 'parent@example.invalid', phone: '555'}});
  const [paid] = await project(t => Object.assign(t.bookings[0].fields, {'Verified applied CAD': 45, 'Balance CAD': 0, 'Due now CAD': 0}));
  assert.equal(paid.status, 'paid');
  const [walkIn] = await project(t => {
    delete t.players[0].fields.Family;
    delete t.bookings[0].fields.Family;
    delete t.bookings[0].fields['Verified applied CAD'];
    Object.assign(t.bookings[0].fields, {'Balance CAD': 45, 'Due now CAD': 45});
  });
  assert.deepEqual([walkIn.status, walkIn.amountDue, walkIn.contact], ['due', 45, null]);
});

test('withholds session dues when identity, attendance, agreed amounts, or payment allocation disagree', async () => {
  const cases = [
    t => t.attendance[0].fields['Attendance status'] = 'Absent',
    t => t.attendance[0].fields['Session date'] = '2026-11-19',
    t => t.sessions[0].fields.Attendance = [],
    t => t.players[0].fields.Bookings = [],
    t => t.bookings[0].fields['Covered dates'] = 'unknown',
    t => t.bookings[0].fields['Booking status'] = 'Pending review',
    t => t.bookings[0].fields['Due now CAD'] = 0,
    t => t.bookings[0].fields['Balance CAD'] = -5,
    t => t.bookings[0].fields['Charge review'] = 'Needs confirmation',
    t => {t.bookings[0].fields['Payment Allocations'] = ['pending']; delete t.bookings[0].fields['Verified applied CAD'];},
    t => t.bookings[0].fields['Unresolved price count'] = 1,
    t => t.families[0].fields['Verified family receipts CAD'] = 40,
    t => t.families[0].fields['Unverified payment claims CAD'] = 25,
    t => t.bookings[0].fields['Billing basis'] = 'Attendance'
  ];
  for (const mutate of cases) {
    const [row] = await project(mutate);
    assert.deepEqual([row.status, row.amountDue, row.amountPaid], ['review', null, null], mutate.toString());
  }
  const [mismatch] = await project(t => {t.bookings[0].fields.Family = ['different'];});
  assert.equal(mismatch.status, 'review');
  assert.equal(mismatch.contact, null);
  const [exact] = await project(t => {
    t.bookings[0].fields['Billing basis'] = 'Attendance';
    t.attendance[0].fields['Attended billing session'] = 'friday';
  });
  assert.equal(exact.status, 'due');
});

test('passes and multi-session booking payments appear once, with covered dates and no attributed session', async () => {
  for (const basis of ['Pass or package', 'Historical', 'Attendance']) {
    const rows = await project(t => {nextSeat(t); t.bookings[0].fields['Billing basis'] = basis;});
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].status, rows[0].scope, rows[0].sessionId, rows[0].amountDue, rows[0].coveredDates],
      ['package', 'booking', null, 25, ['2026-11-20','2026-11-22']]);
  }
  const [shared] = await project(t => {nextSeat(t); t.bookings[0].fields.Player.push('sibling');});
  assert.deepEqual([shared.status, shared.playerId, shared.playerName, shared.contact, shared.amountDue], ['review',null,null,null,null]);
  const [pass] = await project(t => {
    delete t.attendance[0].fields.Booking;
    t.bookings = [];
    t.attendance[0].fields['Covered session key'] = 'friday';
  });
  assert.deepEqual([pass.status, pass.scope, pass.amountDue], ['package', 'session', null]);
});

test('contradictory seats never duplicate or invent a collectible amount', async () => {
  const rows = await project(t => {
    const extra = structuredClone(t.attendance[0]); extra.id = 'other'; extra.fields.Booking = ['b2']; t.attendance.push(extra);
    const extraBook = structuredClone(t.bookings[0]); extraBook.id = 'b2'; extraBook.fields.Attendance = ['other']; t.bookings.push(extraBook);
    t.players[0].fields.Attendance.push('other'); t.players[0].fields.Bookings.push('b2'); t.sessions[0].fields.Attendance.push('other');
  });
  assert.equal(rows.length, 2);
  assert.ok(rows.every(row => row.status === 'review' && row.amountDue === null));
});

test('cancelled or void coverage is excluded; dated future, cleared, and unplaced rows cannot become session dues', async () => {
  for (const change of [t => t.sessions[0].fields['Session status'] = 'Cancelled',
    t => t.bookings[0].fields['Booking status'] = 'Cancelled', t => t.attendance[0].fields['Coverage state'] = 'Void']) {
    assert.deepEqual(await project(change), []);
  }
  const [upcoming] = await project(t => {
    t.sessions[0].fields.Date = t.attendance[0].fields['Session date'] = t.bookings[0].fields['Start date'] = t.bookings[0].fields['Covered dates'] = '2026-11-27';
    t.bookings[0].fields['Due now CAD'] = 0;
  });
  assert.deepEqual([upcoming.status, upcoming.amountDue], ['upcoming', 0]);
  const [absent] = await project(t => {
    Object.assign(t.bookings[0].fields, {'Billing basis': 'Attendance', 'Verified applied CAD': 0, 'Balance CAD': 0,
      'Attendance-adjusted charge CAD': 0, 'Due now CAD': 0});
    t.attendance[0].fields['Attendance status'] = 'Absent';
  });
  assert.equal(absent.status, 'no-charge');
  for (const basis of ['Pass or package', 'Historical']) {
    const [unplaced] = await project(t => {t.attendance = []; t.bookings[0].fields.Attendance = []; t.bookings[0].fields['Billing basis'] = basis;});
    assert.deepEqual([unplaced.scope, unplaced.status, unplaced.sessionId, unplaced.amountDue],
      ['booking', basis === 'Historical' ? 'review' : 'package', null, 25]);
  }
});

test('reads each paginated source once on demand, with no notes or unrelated private fields', async () => {
  const data = fixture(), reads = [];
  const {readSessionBooks} = await books;
  const result = await readSessionBooks(async (table, fields) => {
    reads.push(table);
    assert.ok(!fields.some(field => /notes|evidence|emergency/i.test(field)));
    return data[table];
  }, new Date('2026-11-22T23:00:00Z'), 'America/Vancouver');
  assert.deepEqual(reads.sort(), ['attendance','bookings','families','players','sessions']);
  assert.equal(result.rows[0].status, 'due');
});

test('a due session links to its own booking and uses the ledger family name',async()=>{
  const data=fixture(), id='rec00000000000001', source={baseId:'app00000000000001',bookings:'tbl00000000000001'};
  data.bookings[0].id=id;data.players[0].fields.Bookings=[id];data.attendance[0].fields.Booking=[id];
  data.families[0].fields.Family='Fixture household';
  const [row]=(await books).buildSessionBooks(data,today,source).rows;
  assert.equal(row.familyName,'Fixture household');assert.equal(row.familyId,'f');
  assert.equal(row.bookingUrl,'https://airtable.com/'+source.baseId+'/'+source.bookings+'/'+id);
});
