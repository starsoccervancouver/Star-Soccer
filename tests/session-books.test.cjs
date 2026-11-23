const {test} = require('node:test');
const assert = require('node:assert/strict');
const books = import('../private-attendance/session-books.mjs');
const today = '2026-11-22';
function fixture() {
  return {
    payments: [], allocations: [],
    sessions: [{id: 'friday', fields: {Session: 'Friday Kits', Date: '2026-11-20', Time: '3:45–4:45 pm', Venue: 'Kits',
      'Session status': 'Completed', Attendance: ['a']}}],
    players: [{id: 'child', fields: {Player: 'Test player', Attendance: ['a'], Bookings: ['b'], Family: ['f']}}],
    attendance: [{id: 'a', fields: {Session: ['friday'], Player: ['child'], Booking: ['b'], 'Coverage state': 'Active',
      'Session date': '2026-11-20', 'Attendance status': 'Present'}}],
    families: [{id: 'f', fields: {Players: ['child'], Bookings:['b'], 'Guardian name': 'Test parent', Email: 'parent@example.invalid', Phone: '555',
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
  const {sessionGroupKey,sessionGroupLabel,...details} = row;
  assert.ok(sessionGroupKey); assert.match(sessionGroupLabel,/Friday.*Kits/);
  assert.deepEqual(details, {scope: 'session', attendanceId: 'a', sessionId: 'friday', sessionLabel: 'Friday Kits',
    date: '2026-11-20', time: '3:45–4:45 pm', location: 'Kits', attendanceStatus: 'Present', playerId: 'child', playerName: 'Test player',
    bookingId: 'b', bookingType: 'Drop-in', status: 'due', amountCharged: 45, amountPaid: 20,
    amountDue: 25, amountOutstanding:25, amountUpcoming:0, reviewBalance:null,reviewReason:null,
    familyId:'f',familyName:null,contact: {guardian: 'Test parent', email: 'parent@example.invalid', phone: '555'}});
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

test('cancelled or void coverage cannot create a debt; stale approved booking balances are held for review', async () => {
  assert.deepEqual(await project(t=>t.bookings[0].fields['Booking status']='Cancelled'),[]);
  for (const change of [t => t.sessions[0].fields['Session status'] = 'Cancelled',
    t => t.attendance[0].fields['Coverage state'] = 'Void']) {
    const rows = await project(change);
    assert.equal(rows.length,1);
    assert.ok(rows.every(r=>r.status==='review' && r.amountOutstanding === null && r.reviewBalance === 25));
  }
  const [upcoming] = await project(t => {
    t.sessions[0].fields.Date = t.attendance[0].fields['Session date'] = t.bookings[0].fields['Start date'] = t.bookings[0].fields['Covered dates'] = '2026-11-27';
    t.bookings[0].fields['Due now CAD'] = 0;
  });
  assert.deepEqual([upcoming.status, upcoming.amountDue,upcoming.amountOutstanding,upcoming.amountUpcoming], ['upcoming', 0,25,25]);
  const [absent] = await project(t => {
    Object.assign(t.bookings[0].fields, {'Billing basis': 'Attendance', 'Verified applied CAD': 0, 'Balance CAD': 0,
      'Attendance-adjusted charge CAD': 0, 'Due now CAD': 0});
    t.attendance[0].fields['Attendance status'] = 'Absent';
  });
  assert.equal(absent.status, 'no-charge');
  for (const basis of ['Pass or package', 'Historical']) {
    const [unplaced] = await project(t => {t.attendance = []; t.bookings[0].fields.Attendance = []; t.bookings[0].fields['Billing basis'] = basis;});
    assert.deepEqual([unplaced.scope, unplaced.status, unplaced.sessionId, unplaced.amountDue],
      ['booking', basis === 'Historical' ? 'due' : 'package', null, 25]);
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
  assert.deepEqual(reads.sort(), ['allocations','attendance','bookings','families','payments','players','sessions']);
  assert.equal(result.rows[0].status, 'due');
});

test('whole-booking balance includes the unpaid portion of an upcoming camp with an imported slot description',async()=>{
  const [row]=await project(t=>{
    const date='2026-12-21';
    Object.assign(t.sessions[0].fields,{Session:'Winter camp morning',Date:date});
    t.attendance[0].fields['Session date']=date;
    Object.assign(t.bookings[0].fields,{'Billing basis':'Pass or package','Start date':date,
      'Covered dates':date+', 2026-12-22 | Winter Camp 12:30–3:30 PM','Due now CAD':0,'Upcoming booked CAD':45});
  });
  assert.deepEqual([row.status,row.scope,row.amountCharged,row.amountOutstanding,row.amountDue,row.amountUpcoming],
    ['package','booking',45,25,0,25]);
  assert.equal(row.coveredDates.length,2);
  assert.match(row.sessionGroupLabel,/Winter Camp.*Week 1/);
  const [partial]=await project(t=>{
    nextSeat(t);
    Object.assign(t.bookings[0].fields,{'Upcoming booked CAD':20,'Due now CAD':5});
  });
  assert.deepEqual([partial.amountOutstanding,partial.amountDue,partial.amountUpcoming],[25,5,20]);
  const [conflict]=await project(t=>t.bookings[0].fields['Covered dates']+=' | changed to 2026-12-21');
  assert.deepEqual([conflict.status,conflict.amountOutstanding,conflict.reviewBalance],['review',null,25]);
});

test('family receipt reviews sum unapplied training money once, exclude gifts and never count claims twice',async()=>{
  const receipt={id:'receipt',fields:{Family:['f'],Verification:'Verified',Direction:'Incoming',Method:'Cash','Amount CAD':65,'Thank-you gift CAD':10}};
  const allocation={id:'allocation',fields:{Payment:['receipt'],Booking:['b'],'Review status':'Verified allocation','Applied CAD':20}};
  const prepare=t=>{
    t.families[0].fields.Payments=['receipt'];
    Object.assign(t.families[0].fields,{'Verified family receipts CAD':65,'Unverified payment claims CAD':35});
    t.payments.push(structuredClone(receipt));
    t.allocations.push(structuredClone(allocation));
  };
  const rows=await project(prepare);
  assert.equal(rows.length,2);
  const unmatched=rows.find(row=>row.scope==='family'),held=rows.find(row=>row.scope==='session');
  assert.deepEqual([unmatched.familyId,unmatched.amountUnapplied,unmatched.amountOutstanding,unmatched.reviewBalance],['f',35,null,null]);
  assert.deepEqual([held.status,held.reviewBalance,held.amountOutstanding,held.amountDue],['review',25,null,null]);
  const settled=await project(t=>{
    prepare(t);
    t.payments[0].fields['Training portion CAD']=20;
    t.families[0].fields['Unverified payment claims CAD']=0;
  });
  assert.equal(settled.length,1);
  assert.equal(settled[0].amountOutstanding,25,'gift and other non-training funds do not mask legitimate debts');
  const unlinked=await project(t=>{prepare(t);delete t.payments[0].fields.Family;});
  assert.ok(unlinked.some(r=>r.paymentId==='receipt' && r.familyId===null && r.contact===null && r.amountUnapplied===null));
});

test('uses verified family identities and the existing recurring, Pro-D and winter-session groups',async()=>{
  const [named]=await project(t=>{
    t.families[0].fields['Guardian name']=' ';
    t.families[0].fields.Family='Test household';
    t.sessions[0].fields['Weekly program']=['rec12345678901234'];
  });
  assert.equal(named.familyName,'Test household');
  assert.match(named.sessionGroupKey,/program/);
  const [prod]=await project(t=>t.sessions[0].fields['Source session ID']='2026-11-20-PROD');
  assert.match(prod.sessionGroupLabel,/Pro-D Camp/);
  const [conflicting]=await project(t=>{t.bookings[0].fields.Family=['other'];});
  assert.deepEqual([conflicting.familyId,conflicting.familyName,conflicting.contact],[null,null,null]);
  const [stale]=await project(t=>t.families[0].fields.Bookings=[]);
  assert.deepEqual([stale.status,stale.familyId,stale.contact,stale.reviewBalance],['review',null,null,25]);
  const [unlinked]=await project(t=>{delete t.bookings[0].fields.Family;delete t.players[0].fields.Family;});
  assert.deepEqual([unlinked.playerId,unlinked.familyId,unlinked.amountOutstanding],['child',null,25]);
});

test('a due session links to its own booking and uses the ledger family name',async()=>{
  const data=fixture(), id='rec00000000000001', source={baseId:'app00000000000001',bookings:'tbl00000000000001'};
  data.bookings[0].id=id;data.players[0].fields.Bookings=[id];data.attendance[0].fields.Booking=[id];
  data.families[0].fields.Bookings=[id];data.families[0].fields.Family='Fixture household';
  const [row]=(await books).buildSessionBooks(data,today,source).rows;
  assert.equal(row.familyName,'Fixture household');assert.equal(row.familyId,'f');
  assert.equal(row.bookingUrl,'https://airtable.com/'+source.baseId+'/'+source.bookings+'/'+id);
});

test('Overview shares a pending read and refreshes on expiry, mutation or a direct Books read',async()=>{
  const {createBooksReader}=await books;
  let calls=0,now=0;
  const read=createBooksReader(async()=>++calls,()=>now);
  const overview=()=>read({unpaid:true});
  assert.deepEqual(await Promise.all([overview(),overview()]),[1,1]);
  assert.equal(await overview(),1);
  now=30000;
  assert.equal(await overview(),2);
  assert.equal(await read(),3);
  read.invalidate();
  assert.equal(await overview(),4);
});

test('opening summaries persist only unpaid fields and an old read cannot undo invalidation',async()=>{
 const {createBooksReader}=await books;
 let value=null,finish;
 const store={save:entry=>{value=entry;},read:()=>value,clear:()=>{value=null;}};
 const report={rows:[{scope:'session',status:'due',amountDue:12,playerName:'Example',contact:{email:'private'}}]};
 const reader=createBooksReader(async()=>report,()=>100,store);
 await reader();
 assert.equal(value.checkedAt,100);assert.equal(value.rows[0].contact,undefined);
 const reopened=createBooksReader(()=>new Promise(resolve=>{finish=resolve;}),()=>105,store);
 assert.equal(reopened.lastUnpaid().rows[0].amountDue,12);
 const request=reopened();
 await Promise.resolve();
 reopened.invalidate();finish(report);await request;
 assert.equal(reopened.lastUnpaid(),null);
});

test('agreed historical carryovers stay attached to the same player without a fabricated session date',async()=>{
 const t=fixture(),origin='rec00000000000001',past='rec00000000000002';
 t.bookings[0].id=origin;
 t.attendance[0].fields.Booking=[origin];
 t.players[0].fields.Bookings=[origin,past];t.families[0].fields.Bookings=[origin,past];
 const record={...t.bookings[0].fields,Attendance:[],'First session':[],'Start date':null,'Covered dates':null,
  'Source booking ID':'past-booking-balance:'+origin,'Charge CAD':50,'Attendance-adjusted charge CAD':50,'Verified applied CAD':0,'Balance CAD':50,'Due now CAD':50};
 t.bookings.push({id:past,fields:record});
 const {buildSessionBooks,unpaidSessionRows}=await books;
 const read=()=>unpaidSessionRows(buildSessionBooks(t,today)).find(r=>r.bookingId===past);
 assert.equal(read().amountDue,50);
 record['Charge review']='Needs pricing confirmation';assert.equal(read(),undefined);
 record['Charge review']='Agreed';t.bookings[0].fields.Player=['other'];assert.equal(read(),undefined);
});

test('a player-linked receipt fully allocated to that player clears the receipt review',async()=>{
 const t=fixture(),{buildSessionBooks}=await books;
 delete t.players[0].fields.Family;delete t.bookings[0].fields.Family;
 t.payments=[{id:'receipt',fields:{Verification:'Verified',Direction:'Incoming',Method:'Cash','Amount CAD':20,
  'Players associated (not allocation)':['child'],'Family reference':'player:child'}}];
 t.allocations=[{id:'allocation',fields:{Payment:['receipt'],Booking:['b'],'Applied CAD':20,'Review status':'Verified allocation'}}];
 const reviews=()=>buildSessionBooks(t,today).rows.filter(r=>r.scope==='family');
 assert.equal(reviews().length,0);
 t.allocations[0].fields['Applied CAD']=10;assert.equal(reviews().length,1);
 assert.equal(buildSessionBooks(t,today).rows.find(r=>r.scope==='session').status,'review');
 t.allocations[0].fields['Applied CAD']=20;t.bookings[0].fields.Player=['different child'];assert.equal(reviews().length,1);
});
