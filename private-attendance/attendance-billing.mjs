import {sessionRate, sessionRateCutover, validSessionRate} from './session-rate.mjs';

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
  const review = async () => {
    if (a['Billing review'] !== 'Needs reconciliation') await db.save('attendance',{'Billing review':'Needs reconciliation'},{id:attendanceId});
  };
  // Dated prices replace individual rates only from the owner's chosen date.
  // Verify the current dated session instead of trusting a cached roster.
  let rate;
  if (session.date >= sessionRateCutover) {
    const [dated] = await byId(db, 'sessions', [sessionId], ['Date','Weekly program','Session rate CAD']);
    if (dated.fields.Date !== session.date) throw Error('BILLING_LINK_CHANGED');
    const programs = dated.fields['Weekly program'] || [];
    if (programs.length > 1 || session.programId && !one(programs,session.programId)) return review();
    const program = programs.length === 1 ? (await byId(db,'programs',programs,['Drop-in CAD']))[0].fields : null;
    rate = sessionRate(dated.fields,program);
  }
  const bookingFields = ['Player','Family','Booking status','Booking type','Fixed-price package','Billing basis',
    'Start date','Covered dates','First session','Attendance','Charge CAD','Charge review','Agreed per-visit CAD'];
  const checkBooking = async b => {
    if (session.date < sessionRateCutover) return;
    const f = b.fields;
    if (f['Fixed-price package'] === true || f['Billing basis'] === 'Pass or package' ||
        f['Booking type'] === 'Four consecutive sessions' || f['Billing basis'] === 'Historical') return;
    // An attendance row marked as prepaid must not silently turn into a
    // separate visit fee just because a conflicting drop-in is attached.
    if (a['Billing schedule at date'] === 'Four-session prepaid' ||
        a['Preparation registration kind']?.includes('SS-PASS-V1')) return review();
    const dates = [...new Set(String(f['Covered dates'] || f['Start date'] || '').match(/\d{4}-\d{2}-\d{2}/g) || [])];
    if (!['Accepted','Completed'].includes(f['Booking status']) || f['Billing basis'] !== 'Attendance' ||
        !one(f.Player,playerId) || !dates.includes(session.date) || !f.Attendance?.includes(attendanceId)) return review();
    if (!['Agreed','Needs pricing confirmation'].includes(f['Charge review'])) return review();
    if (!validSessionRate(rate)) return review();
    if (dates.length > 1 || f.Attendance?.length > 1) {
      // A shared drop-in booking has one per-visit price. Do not silently
      // overwrite it if different dated prices cannot be represented safely.
      const freeCampDay = rate === 0 && session.date.endsWith('-12-25') &&
        a['Preparation registration kind']?.includes('SS-CAMP-DROPIN-V1');
      if (!freeCampDay && (!validSessionRate(f['Agreed per-visit CAD']) || f['Agreed per-visit CAD'] !== rate)) await review();
      return;
    }
    if (f['Start date'] !== session.date || !one(f['First session'],sessionId)) return review();
    const changes = {};
    if (f['Charge CAD'] !== rate) changes['Charge CAD'] = rate;
    if (f['Agreed per-visit CAD'] != null && f['Agreed per-visit CAD'] !== rate) changes['Agreed per-visit CAD'] = rate;
    if (f['Charge review'] !== 'Agreed') changes['Charge review'] = 'Agreed';
    if (Object.keys(changes).length) await db.save('bookings',changes,{id:b.id});
  };
  if (session.players.filter(p => p.playerId === playerId).length !== 1 || a.Booking?.length > 1) return review();
  if (a.Booking?.length === 1) {
    const [booking] = await byId(db,'bookings',a.Booking,bookingFields);
    return checkBooking(booking);
  }
  const [player] = await byId(db,'players',[playerId],['Family','Family reference','Source player ID','Bookings','Recurring Enrollments']);
  const family = player.fields.Family || [];
  if (family.length > 1) return review();
  const bookings = await byId(db,'bookings',player.fields.Bookings,
    bookingFields);
  const matching = bookings.filter(({fields:b}) => ['Accepted','Completed'].includes(b['Booking status']) &&
    (b['First session']?.includes(sessionId) || (String(b['Covered dates'] || b['Start date']).match(/\d{4}-\d{2}-\d{2}/g) || []).includes(session.date)));
  if (matching.length) {
    // Reuse a confirmed booking for this exact session. Ambiguous dates and
    // overlapping passes are resolved by the owner before another fee is added.
    const b = matching[0];
    if (matching.length === 1 && one(b.fields['First session'],sessionId) && one(b.fields.Player,playerId) &&
        (family.length ? one(b.fields.Family,family[0]) : !b.fields.Family?.length) && !b.fields.Attendance?.length) {
      await db.save('attendance',{Booking:[b.id]},{id:attendanceId});
      b.fields.Attendance = [attendanceId];
      return checkBooking(b);
    }
    return review();
  }
  const enrollments = await byId(db,'enrollments',player.fields['Recurring Enrollments'],
    ['Player','Family','Weekly program','Enrollment status','Effective from','Effective until','Billing schedule','Billing approval','Agreed per-session CAD','Prepaid covered from','Prepaid covered until']);
  const active = enrollments.filter(({fields:e}) => one(e.Player,playerId) && (family.length ? one(e.Family,family[0]) : !e.Family?.length) &&
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
  if (session.date < sessionRateCutover) {
    if (enrollmentRateApproved) rate = e['Agreed per-session CAD'];
    else if (rowRateApproved) rate = a['Expected per-session CAD'];
  }
  const key = 'VISIT-' + sessionId + '-' + playerId;
  // A cancelled or manually detached booking can still own this key. Reopening
  // it through an upsert would overwrite the owner's correction.
  const previous = await db.list('bookings',['Source booking ID'],"{Source booking ID}='" + key + "'");
  if (previous.length) return review();
  await db.save('bookings',{
    'Source booking ID':key,'Booking reference':key, Player:[playerId],...(family.length?{Family:family}:{}),
    'Player reference':player.fields['Source player ID'],'Family reference':player.fields['Family reference'],
    'First session':[sessionId], Attendance:[attendanceId],'Start date':session.date,'Covered dates':session.date,
    'Booking type':'Drop-in','Booking status':'Accepted','Charge review':price(rate)?'Agreed':'Needs pricing confirmation',
    ...(price(rate)?{'Charge CAD':rate}:{})
  },{key:'Source booking ID'});
}

