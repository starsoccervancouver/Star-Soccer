// A booking is the ledger's allocation target. The ledger computes the amount
// earned from live attendance, so correcting a mark never rewrites a receipt.
const recordId = /^rec[A-Za-z0-9]{14}$/;
const one = (links, id) => links?.length === 1 && links[0] === id;
const price = n => Number.isFinite(n) && n >= 0;

async function byId(db, table, ids, fields) {
  const rows = [];
  const unique = [...new Set(ids || [])];
  if (unique.some(id => !recordId.test(id))) throw Error('INVALID_BILLING_LINK');
  for (let i = 0; i < unique.length; i += 40) {
    const batch = unique.slice(i, i + 40);
    const filter = batch.map(id => "RECORD_ID()='" + id + "'").join(',');
    const records = await db.list(table, fields, batch.length === 1 ? filter : 'OR(' + filter + ')');
    if (records.length !== batch.length || records.some(r => !batch.includes(r.id))) throw Error('BILLING_LINK_CHANGED');
    rows.push(...records);
  }
  return rows;
}

export async function prepareAttendedVisit(db, {playerId, attendanceId, sessionId}, session) {
  if (session.date < '2026-11-21') return;
  const [row] = await byId(db, 'attendance', [attendanceId],
    ['Player','Session','Booking','Enrollment','Coverage state','Billing schedule at date','Expected per-session CAD','Preparation registration kind','Billing review','Coverage approved']);
  const a = row.fields;
  if (!one(a.Player,playerId) || !one(a.Session,sessionId) || a['Coverage state'] !== 'Active') throw Error('BILLING_LINK_CHANGED');
  if (a.Booking?.length === 1) return;
  const review = async () => {
    if (a['Billing review'] !== 'Needs reconciliation') await db.save('attendance',{'Billing review':'Needs reconciliation'},{id:attendanceId});
  };
  if (a.Booking?.length || session.players.filter(p => p.playerId === playerId).length !== 1) return review();
  const [player] = await byId(db,'players',[playerId],['Family','Family reference','Source player ID','Bookings','Recurring Enrollments']);
  const family = player.fields.Family;
  if (family?.length !== 1) return review();
  const bookings = await byId(db,'bookings',player.fields.Bookings,
    ['Player','Family','Booking status','Start date','Covered dates','First session','Attendance']);
  const matching = bookings.filter(({fields:b}) => ['Accepted','Completed'].includes(b['Booking status']) &&
    (b['First session']?.includes(sessionId) || (String(b['Covered dates'] || b['Start date']).match(/\d{4}-\d{2}-\d{2}/g) || []).includes(session.date)));
  if (matching.length) {
    // Reuse a confirmed booking for this exact session. Ambiguous dates and
    // overlapping passes are resolved by the owner before another fee is added.
    const b = matching[0];
    if (matching.length === 1 && one(b.fields['First session'],sessionId) && one(b.fields.Player,playerId) &&
        one(b.fields.Family,family[0]) && !b.fields.Attendance?.length) {
      await db.save('attendance',{Booking:[b.id]},{id:attendanceId});
      return;
    }
    return review();
  }
  const enrollments = await byId(db,'enrollments',player.fields['Recurring Enrollments'],
    ['Player','Family','Weekly program','Enrollment status','Effective from','Effective until','Billing schedule','Billing approval','Agreed per-session CAD','Prepaid covered from','Prepaid covered until']);
  const active = enrollments.filter(({fields:e}) => one(e.Player,playerId) && one(e.Family,family[0]) &&
    one(e['Weekly program'],session.programId) && e['Enrollment status'] === 'Active' &&
    e['Effective from'] <= session.date && (!e['Effective until'] || e['Effective until'] >= session.date));
  const pass = active.some(({fields:e}) => e['Billing schedule'] === 'Four-session prepaid' && e['Billing approval'] === 'Approved' &&
    e['Prepaid covered from'] <= session.date && e['Prepaid covered until'] >= session.date);
  if (pass) {
    if (a['Billing schedule at date'] !== 'Four-session prepaid' || !a['Coverage approved'] || a['Billing review'] !== 'Approved coverage') {
      await db.save('attendance',{'Billing schedule at date':'Four-session prepaid','Coverage approved':true,'Billing review':'Approved coverage'},{id:attendanceId});
    }
    return;
  }
  if (a['Billing schedule at date'] === 'Four-session prepaid' || a['Preparation registration kind']?.includes('SS-PASS-V1') ||
      active.some(({fields:e}) => e['Billing schedule'] === 'Four-session prepaid') || a.Enrollment?.length && !active.some(e=>one(a.Enrollment,e.id))) return review();
  const e = active.length === 1 ? active[0].fields : null;
  const enrollmentRateApproved = e?.['Billing approval'] === 'Approved' && e['Billing schedule'] === 'Per session' &&
    price(e['Agreed per-session CAD']) && (a['Expected per-session CAD'] == null || a['Expected per-session CAD'] === e['Agreed per-session CAD']);
  const rowRateApproved = !active.length && !a.Enrollment?.length && a['Billing schedule at date'] === 'Per session' &&
    a['Billing review'] === 'Approved coverage' && price(a['Expected per-session CAD']);
  let rate;
  if (enrollmentRateApproved) rate = e['Agreed per-session CAD'];
  else if (rowRateApproved) rate = a['Expected per-session CAD'];
  const key = 'VISIT-' + sessionId + '-' + playerId;
  // A cancelled or manually detached booking can still own this key. Reopening
  // it through an upsert would overwrite the owner's correction.
  const previous = await db.list('bookings',['Source booking ID'],"{Source booking ID}='" + key + "'");
  if (previous.length) return review();
  await db.save('bookings',{
    'Source booking ID':key,'Booking reference':key, Player:[playerId],Family:family,
    'Player reference':player.fields['Source player ID'],'Family reference':player.fields['Family reference'],
    'First session':[sessionId], Attendance:[attendanceId],'Start date':session.date,'Covered dates':session.date,
    'Booking type':'Drop-in','Booking status':'Accepted','Charge review':price(rate)?'Agreed':'Needs pricing confirmation',
    ...(price(rate)?{'Charge CAD':rate}:{})
  },{key:'Source booking ID'});
}

