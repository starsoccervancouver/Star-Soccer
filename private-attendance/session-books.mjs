import coachGroups from './web/workspace-groups.js';

// A booking owns the charge and its verified payment allocations. A roster place
// alone does not establish a price, and a shared charge belongs in the books once.
const fields = {
  sessions: ['Session', 'Source session ID', 'Weekly program', 'Date', 'Time', 'Venue', 'Session status', 'Attendance'],
  attendance: ['Session', 'Session date', 'Player', 'Booking', 'Coverage state', 'Attendance status', 'Covered session key', 'Attended billing session', 'Preparation registration kind'],
  players: ['Player', 'Family', 'Attendance', 'Bookings'],
  bookings: ['Source booking ID', 'Player', 'Family', 'Attendance', 'First session', 'Start date', 'Covered dates', 'Booking status', 'Booking type',
    'Charge review', 'Charge CAD', 'Billing basis', 'Attendance-adjusted charge CAD', 'Payment Allocations', 'Verified applied CAD', 'Balance CAD', 'Due now CAD', 'Upcoming booked CAD', 'Unresolved price count', 'Fixed-price package'],
  families: ['Family', 'Players', 'Bookings', 'Guardian name', 'Email', 'Phone', 'Payments', 'Unverified payment claims CAD', 'Verified family receipts CAD', 'Verified applied CAD'],
  payments: ['Family','Family reference','Players associated (not allocation)','Method','Verification','Direction','Amount CAD','Training portion CAD','Thank-you gift CAD'],
  allocations: ['Payment','Booking','Review status','Applied CAD']
};

const links = value => Array.isArray(value) ? value : [];
const single = value => links(value).length === 1 ? value[0] : null;
const emptyAmounts = {amountCharged: null, amountPaid: null, amountOutstanding: null, amountDue: null, amountUpcoming: null};
const recognizedSession = new Set(['Planned', 'Confirmed', 'Completed']);
const recognizedBooking = new Set(['Accepted', 'Completed']);
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const validDate = value => typeof value === 'string' && dayPattern.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const fieldIndex = rows => new Map(rows.map(({id, fields}) => [id, fields]));

function coveredDates(booking) {
  const input = String(booking['Covered dates'] || booking['Start date'] || '').trim();
  // Imported camp bookings can append a slot description after the date list.
  const [dateList, slot, extra] = input.split('|');
  if (extra !== undefined || slot !== undefined && (!/\b\d{1,2}:\d{2}\s*(?:am|pm)?\s*[-–—]\s*\d{1,2}:\d{2}\s*(?:am|pm)\b/i.test(slot) || /\d{4}-\d{2}-\d{2}/.test(slot))) return [];
  const dates = dateList.trim().split(/[\s,;]+/).filter(Boolean);
  return dates.length && dates.every(validDate) ? [...new Set(dates)].sort() : [];
}

function household(familyId, family) {
  return {familyId: family ? familyId : null, familyName: family?.Family?.trim() || null, contact: contactOf(family)};
}

function contactOf(family) {
  if (!family) return null;
  const guardian = family['Guardian name'] || null, email = family.Email || null, phone = family.Phone || null;
  return guardian || email || phone ? {guardian, email, phone} : null;
}

function familyForBooking(bookingId, booking, playerId, player, families) {
  const playerFamilies = links(player?.Family), bookingFamilies = links(booking.Family);
  const family = families.get(single(playerFamilies));
  const consistent = playerFamilies.length <= 1 && bookingFamilies.length <= 1 &&
    (!playerFamilies.length || links(family?.Players).includes(playerId)) &&
    (!bookingFamilies.length || bookingFamilies[0] === single(playerFamilies) && links(family?.Bookings).includes(bookingId));
  return {consistent, family: consistent ? family : null};
}

function isPackage(booking) {
  return booking['Billing basis'] === 'Pass or package' || booking['Fixed-price package'] === true || booking['Booking type'] === 'Four consecutive sessions';
}

function cents(amount) {
  return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(Math.round(amount * 100)) &&
    Math.abs(Math.round(amount * 100) - amount * 100) < 0.000001 ? Math.round(amount * 100) : null;
}

export const playerPaymentReference=id=>'player:'+id;

// A family can carry an unapplied receipt and a claim for the same transfer.
// Surface both signals together; only verified training money has an amount.
function receiptReviews(tables, families, bookings) {
  const applied = new Map(), reviews = new Map(), familyIssues = new Set(), playerIssues = new Set();
  for (const {fields:a} of tables.allocations) {
    const pid = single(a.Payment);
    if (!pid || a['Review status'] !== 'Verified allocation') continue;
    const entries = applied.get(pid) || [];
    const booking=bookings.get(single(a.Booking));
    entries.push({family:single(booking?.Family),player:single(booking?.Player), amount:cents(a['Applied CAD'])});
    applied.set(pid,entries);
  }
  function item(fid,pid) {
    const key = fid || pid;
    if (!reviews.has(key)) reviews.set(key,{fid,pid:fid?null:pid,unapplied:0,claims:false,check:false});
    if (fid) familyIssues.add(fid);
    return reviews.get(key);
  }
  for (const {id,fields:p} of tables.payments) {
    if (p.Verification !== 'Verified' || p.Direction !== 'Incoming') continue;
    const fid = single(p.Family), linked = links(families.get(fid)?.Payments).includes(id) ? fid : null;
    const gross = cents(p['Amount CAD']), gift = cents(p['Thank-you gift CAD'] ?? 0);
    const training = p['Training portion CAD'] == null && gross !== null && gift !== null ? gross - gift : cents(p['Training portion CAD']);
    const entries = applied.get(id) || [];
    const player=single(p['Players associated (not allocation)']);
    const playerReceipt=!links(p.Family).length && player && p['Family reference']===playerPaymentReference(player) &&
      entries.length && entries.every(a=>a.player===player && a.amount>0) && entries.reduce((sum,a)=>sum+a.amount,0)===training;
    if ((!linked && !playerReceipt) || !['E-transfer','Cash'].includes(p.Method) || training === null || training < 0 ||
      gross !== null && training > gross || entries.some(a => (!playerReceipt && a.family !== linked) || a.amount === null)) {
      item(linked,id).check = true;
      if(!links(p.Family).length && player)playerIssues.add(player);
      // A one-sided receipt link can affect collection without identifying a parent for display.
      if (fid && families.has(fid)) familyIssues.add(fid);
      continue;
    }
    const remainder = training - entries.reduce((sum,a)=>sum+a.amount,0);
    if (remainder < 0) item(linked,id).check = true;
    if (remainder > 0) item(linked,id).unapplied += remainder;
  }
  for (const [fid,f] of families) {
    if (Number.isFinite(f['Unverified payment claims CAD']) && f['Unverified payment claims CAD'] !== 0) item(fid,null).claims = true;
  }
  const rows = Array.from(reviews.values(), ({fid,pid,unapplied,claims,check}) => {
    const reasons = [];
    if (unapplied) reasons.push('Match the unapplied training payment to a booking.');
    if (claims && !unapplied) reasons.push('Review the family payment flag and match the recorded transfers.');
    if (check) reasons.push('Check the receipt amount, method and allocation links.');
    return {scope:'family', status:'review', ...emptyAmounts, reviewBalance:null, amountUnapplied:unapplied?unapplied/100:null,
      reviewReason:reasons.join(' '), ...household(fid,families.get(fid)), paymentId:pid, bookingId:null, attendanceId:null,
      playerId:null, playerName:null, sessionId:null, sessionLabel:null, date:null, time:null, location:null,
      sessionGroupKey:'payment-review',sessionGroupLabel:'Family payment reviews'};
  });
  return {rows, familyIssues, playerIssues, paymentFamilies:new Map(tables.payments.map(p=>[p.id,single(p.fields.Family)]))};
}

function reconciledAmounts(booking, familyId, family, upcoming, receipts) {
  if (booking['Charge review'] !== 'Agreed' || booking['Unresolved price count'] !== 0) return {issue:'Confirm the agreed price.'};
  const [charged, balance, due] = ['Attendance-adjusted charge CAD', 'Balance CAD', 'Due now CAD'].map(key => cents(booking[key]));
  const paid = cents(booking['Verified applied CAD'] ?? (links(booking['Payment Allocations']).length === 0 ? 0 : null));
  const futureBooked = cents(booking['Upcoming booked CAD']);
  if ([charged, paid, balance, due].includes(null) || charged - paid !== balance || due > balance ||
    balance > due && (futureBooked === null ? !upcoming : balance - due > futureBooked)) {
    return {issue:'Check the booking charge, applied payments and due date.'};
  }
  // A family-level unapplied receipt or claim cannot be assigned to this booking.
  if (balance > 0 && !family && receipts.playerIssues.has(single(booking.Player))) {
    return {issue:'Reconcile the player’s receipt before collection.'};
  }
  if (balance > 0 && family) {
    const claims = family['Unverified payment claims CAD'], received = family['Verified family receipts CAD'], applied = family['Verified applied CAD'];
    const payments = links(family.Payments), noReceipts = !payments.length;
    const gross = cents(received ?? (noReceipts ? 0 : null)), claimsTotal = cents(claims ?? (noReceipts ? 0 : null));
    if (receipts.familyIssues.has(familyId) || payments.some(pid=>receipts.paymentFamilies.get(pid)!==familyId) || claimsTotal !== 0 ||
      noReceipts && (gross === null || gross !== cents(applied ?? 0))) {
      return {issue:'Reconcile the family’s receipts and payment claims before collection.'};
    }
  }
  return {amounts:{amountCharged: charged / 100, amountPaid: paid / 100, amountOutstanding: balance / 100,
    amountDue: due / 100, amountUpcoming: (balance - due) / 100}};
}

function review(row, booking, reason) {
  row.reviewReason = reason;
  const recorded = recognizedBooking.has(booking?.['Booking status']) ? cents(booking['Balance CAD']) : null;
  row.reviewBalance = recorded > 0 ? recorded / 100 : null;
  return row;
}

const wholeBookings = {sessionGroupKey:'whole-bookings', sessionGroupLabel:'Whole bookings'};
function sessionGroups(sessions) {
  const items = [...sessions].map(([id,s]) => ({id, label:s.Session, date:s.Date, time:s.Time, location:s.Venue,
    programId:single(s['Weekly program']), proD:/-PROD$/i.test(s['Source session ID'] || ''), status:s['Session status']}));
  const result = new Map();
  for (const group of coachGroups.familyGroups(items)) {
    for (const s of group.sessions) {
      const key = group.key || JSON.stringify(['pro-d',s.date,s.location?.trim().toLowerCase()]);
      result.set(s.id,{sessionGroupKey:key,sessionGroupLabel:group.label});
    }
  }
  return result;
}

export function buildSessionBooks(tables, today, source = {}) {
  if (!validDate(today)) throw Error('SESSION_BOOKS_DATE_REQUIRED');
  const sessions = fieldIndex(tables.sessions), players = fieldIndex(tables.players), bookings = fieldIndex(tables.bookings);
  const families = fieldIndex(tables.families), attendance = fieldIndex(tables.attendance);
  const receipts = receiptReviews(tables,families,bookings);
  const rows = [...receipts.rows], byBooking = new Map(), bySeat = new Map(), groups = sessionGroups(sessions);
  for (const [attendanceId, a] of attendance) {
    const sessionId = single(a.Session), playerId = single(a.Player), bookingId = single(a.Booking);
    const session = sessions.get(sessionId), player = players.get(playerId), booking = bookings.get(bookingId);
    if (!session || session['Session status'] === 'Cancelled' || a['Coverage state'] === 'Void' || booking?.['Booking status'] === 'Cancelled') continue;
    const familyId = single(player?.Family), family = families.get(familyId);
    const linkedFamily = links(family?.Players).includes(playerId) ? family : null;
    const valid = recognizedSession.has(session['Session status']) && validDate(session.Date) && session.Date === a['Session date'] &&
      a['Coverage state'] === 'Active' && links(session.Attendance).includes(attendanceId) && !!player && links(player.Attendance).includes(attendanceId);
    const seat = {attendanceId, sessionId, playerId, bookingId, session, player, a, family: linkedFamily, valid};
    const key = [playerId, sessionId].join('/');
    const seats = bySeat.get(key) || [];
    seats.push(seat);
    bySeat.set(key, seats);
    if (bookingId) {
      const members = byBooking.get(bookingId) || [];
      members.push(seat);
      byBooking.set(bookingId, members);
    }
  }

  function sessionRow(seat) {
    const {attendanceId, playerId, player, sessionId, session, a, bookingId, valid, family} = seat;
    const booking=bookings.get(bookingId);
    const unlinkedCoachBooking=String(booking?.['Source booking ID']||'').startsWith('coach:')&&!links(booking?.Family).length;
    return {scope: 'session', attendanceId, playerId, playerName: player?.Player || null, sessionId, sessionLabel: session.Session || null,
      date: session.Date || null, time: session.Time || null, location: session.Venue || null,
      attendanceStatus: a['Attendance status'] || 'Not marked', bookingId, bookingType: bookings.get(bookingId)?.['Booking type'] || null,
      status: 'review', ...emptyAmounts, reviewReason:null, reviewBalance:null,
      ...(groups.get(sessionId) || wholeBookings), ...household(unlinkedCoachBooking?null:single(player?.Family), unlinkedCoachBooking?null:valid ? family : null)};
  }

  const processed = new Set();
  for (const seats of bySeat.values()) {
    for (const seat of seats) {
      const {a, bookingId, playerId, sessionId, session, player, family} = seat;
      const row = sessionRow(seat), booking = bookings.get(bookingId);
      if (!booking) {
        if (seats.length === 1 && seat.valid && !links(a.Booking).length) {
          if (a['Covered session key'] === sessionId) row.status = 'package';
          else if (session.Date > today) row.status = 'upcoming';
          else if (a['Attendance status'] === 'Absent') row.status = 'no-charge';
        }
        if (row.status === 'review') review(row, null, 'Check the attendance and its booking link.');
        rows.push(row);
        continue;
      }
      if (processed.has(bookingId)) continue;
      processed.add(bookingId);
      const members = byBooking.get(bookingId), reverse = links(booking.Attendance);
      const dates = coveredDates(booking), starts = booking['Start date'], first = links(booking['First session']);
      const basis = booking['Billing basis'];
      const packageBooking = isPackage(booking);
      const ambiguousPlayer = !single(booking.Player) || members.some(m => m.playerId !== single(booking.Player));
      const multiple = dates.length > 1 || new Set(members.map(m => m.sessionId)).size > 1 || packageBooking || ambiguousPlayer;
      if (multiple) {
        Object.assign(row, {scope: 'booking', attendanceId: null, sessionId: null, date: validDate(starts) ? starts : null,
          coveredDates: dates, time: null, location: null, attendanceStatus: null, sessionLabel: packageBooking ? 'Pass or package' : 'Shared booking'});
        const group = groups.get(sessionId);
        if (!group || members.some(m => groups.get(m.sessionId)?.sessionGroupKey !== group.sessionGroupKey)) Object.assign(row,wholeBookings);
        if (ambiguousPlayer) Object.assign(row, {playerId: null, playerName: null}, household(null,null));
      }
      const memberIds = new Set(members.map(m => m.attendanceId));
      const allLinked = reverse.length > 0 && reverse.every(id => {
        const record = attendance.get(id);
        return record && single(record.Booking) === bookingId && (record['Coverage state'] === 'Void' ||
          sessions.get(single(record.Session))?.['Session status'] === 'Cancelled' || memberIds.has(id));
      });
      const validMembers = members.every(m => m.valid && m.playerId === playerId && reverse.includes(m.attendanceId) && dates.includes(m.session.Date) &&
        bySeat.get([m.playerId, m.sessionId].join('/')).length === 1);
      const familyAgrees = familyForBooking(bookingId, booking, playerId, player, families).consistent;
      const firstMatches = first.length === 0 || first.length === 1 && sessions.get(first[0])?.Date === starts && (multiple || first[0] === sessionId);
      const verified = recognizedBooking.has(booking['Booking status']) && ['Historical', 'Attendance', 'Pass or package'].includes(basis) &&
        validDate(starts) && dates[0] === starts && firstMatches && single(booking.Player) === playerId && links(player?.Bookings).includes(bookingId) &&
        allLinked && validMembers && familyAgrees;
      if (!verified) {
        if (!familyAgrees || ambiguousPlayer) Object.assign(row, household(null,null));
        rows.push(review(row, booking, 'Verify the booking, player and dated roster links.'));
        continue;
      }
      const upcoming = starts > today;
      const {amounts, issue} = reconciledAmounts(booking, single(player?.Family), family, upcoming, receipts);
      if (amounts) {
        const attended = a['Attendance status'] === 'Present';
        if (multiple) Object.assign(row, amounts, {status: 'package'});
        else if ((upcoming || amounts.amountUpcoming > 0) && amounts.amountDue === 0) Object.assign(row, amounts, {status: 'upcoming'});
        else if (amounts.amountDue > 0) {
          if (attended && (basis === 'Historical' || a['Attended billing session'] === sessionId)) Object.assign(row, amounts, {status: 'due'});
        } else if (amounts.amountPaid > 0) Object.assign(row, amounts, {status: 'paid'});
        else if (basis !== 'Attendance' || a['Attendance status'] === 'Absent' || a['Attended billing session'] === sessionId ||
          booking['Charge CAD'] === 0 || (session.Date.endsWith('-12-25') && links(a['Preparation registration kind']).includes('SS-CAMP-DROPIN-V1'))) {
          Object.assign(row, amounts, {status: 'no-charge'});
        }
      }
      if (row.status === 'review') review(row, booking, issue || 'Confirm the player’s attendance before collecting this charge.');
      if (row.status === 'due') {
        if (/^app[A-Za-z0-9]{14}$/.test(source.baseId) && /^tbl[A-Za-z0-9]{14}$/.test(source.bookings) && /^rec[A-Za-z0-9]{14}$/.test(bookingId)) {
          row.bookingUrl = 'https://airtable.com/' + source.baseId + '/' + source.bookings + '/' + bookingId;
        }
      }
      rows.push(row);
    }
  }
  // Books also includes approved bookings that have not been placed on a roster.
  // An owner-confirmed carryover can be collectible even when the earlier camp date is unknown.
  for (const [bookingId, booking] of bookings) {
    if (processed.has(bookingId) || !recognizedBooking.has(booking['Booking status'])) continue;
    const linked = links(booking.Attendance);
    const voided = linked.length && linked.every(id => {
      const a = attendance.get(id);
      return a && (a['Coverage state'] === 'Void' || sessions.get(single(a.Session))?.['Session status'] === 'Cancelled');
    });
    const first = links(booking['First session']), firstSession = sessions.get(single(first));
    const cancelled = firstSession?.['Session status'] === 'Cancelled';
    if ((voided || cancelled) && !(cents(booking['Balance CAD']) > 0)) continue;
    const dates = coveredDates(booking), date = booking['Start date'], playerId = single(booking.Player), player = players.get(playerId);
    const {consistent, family} = familyForBooking(bookingId, booking, playerId, player, families);
    const identity = !!player && links(player.Bookings).includes(bookingId) && consistent;
    const row = {scope: 'booking', attendanceId: null, playerId, playerName: player?.Player || null, sessionId: null,
      sessionLabel: firstSession?.Session || 'Unplaced booking', date: validDate(date) ? date : null, time: null, location: null,
      attendanceStatus: null, bookingId, bookingType: booking['Booking type'] || null, coveredDates: dates,
      ...household(single(player?.Family), identity ? family : null), ...(groups.get(single(first)) || wholeBookings),
      status: 'review', reviewReason:null, reviewBalance:null, ...emptyAmounts};
    let reason = 'Check the booking’s player and roster links.';
    const sourceMatch=/^past-booking-balance:(rec[A-Za-z0-9]{14})$/.exec(booking['Source booking ID']||'');
    const sourceBooking=sourceMatch&&bookings.get(sourceMatch[1]);
    if (identity && !linked.length && !first.length && !date && !booking['Covered dates'] &&
      booking['Booking status']==='Completed' && booking['Billing basis']==='Historical' && !isPackage(booking) &&
      sourceBooking && sourceMatch[1]!==bookingId && single(sourceBooking.Player)===playerId) {
      row.sessionLabel='Earlier camp · date unrecorded';
      const {amounts,issue}=reconciledAmounts(booking,single(player.Family),family,false,receipts);
      if(amounts && amounts.amountUpcoming===0){
        Object.assign(row,amounts,{pastBookingBalance:true,status:amounts.amountDue>0?'due':amounts.amountPaid>0?'paid':'no-charge'});
      }else reason=issue||reason;
    } else if (voided || cancelled) reason = 'Check the recorded balance on this cancelled session or void roster place.';
    else if (identity && !linked.length && validDate(date) && dates[0] === date && (!first.length ||
      first.length === 1 && recognizedSession.has(firstSession?.['Session status']) && firstSession.Date === date)) {
      const {amounts,issue} = reconciledAmounts(booking, single(player?.Family), family, date > today, receipts);
      if (amounts && (isPackage(booking) || booking['Billing basis'] === 'Historical')) {
        Object.assign(row, amounts);
        row.status = isPackage(booking) ? 'package' : amounts.amountDue > 0 ? 'due' : amounts.amountUpcoming > 0 ? 'upcoming' : amounts.amountPaid > 0 ? 'paid' : 'no-charge';
      } else reason = issue || 'Confirm attendance and its booking link.';
    }
    if (row.status === 'review') review(row, booking, reason);
    rows.push(row);
  }
  return {rows: rows.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) ||
    String(a.sessionLabel || '').localeCompare(String(b.sessionLabel || '')) || String(a.playerName || '').localeCompare(String(b.playerName || '')))};
}

export async function readSessionBooks(read, now, timeZone, source) {
  const tables = await Promise.all(Object.entries(fields).map(async ([key, wanted]) => [key, await read(key, wanted)]));
  // Matches sessionInstant's BC rule on hosts still using pre-2026 timezone data.
  const zone = timeZone === 'America/Vancouver' && now >= new Date('2026-03-09') ? 'Etc/GMT+7' : timeZone;
  const today = new Intl.DateTimeFormat('en-CA', {timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
  return buildSessionBooks(Object.fromEntries(tables), today, source);
}

// Overview can reuse a recent display read. Books and payment validation always request fresh data.
export const collectibleBooking = row => row.scope==='session' || (row.scope==='booking' && row.pastBookingBalance===true);

export function unpaidSessionRows(report) {
  return report.rows.filter(row=>collectibleBooking(row) && row.status==='due' && Number.isFinite(row.amountDue) && row.amountDue>0)
    .map(row=>{
      const {scope,status,amountDue,bookingId,familyId,familyName,playerId,playerName,pastBookingBalance,
        date,time,location,sessionLabel,bookingType,attendanceStatus,coveredDates,amountCharged,amountPaid}=row;
      return {scope,status,amountDue,bookingId,familyId,familyName,playerId,playerName,pastBookingBalance,
        date,time,location,sessionLabel,bookingType,attendanceStatus,coveredDates,amountCharged,amountPaid};
    });
}

export function createBooksReader(load, clock = Date.now, summaryStore) {
  let recent = null;
  function read({unpaid = false} = {}) {
    if (unpaid && recent && clock() < recent.expires) return recent.result;
    const entry = {expires: Infinity};
    recent = entry;
    entry.result = Promise.resolve().then(() => load({unpaid})).then(report => {
      const checkedAt=clock();
      entry.expires = checkedAt + 30_000;
      if (summaryStore && recent===entry) summaryStore.save({checkedAt,rows:unpaidSessionRows(report)});
      return report;
    }).catch(error => {
      if (recent === entry) recent = null;
      throw error;
    });
    return entry.result;
  }
  read.invalidate = () => { recent = null; summaryStore?.clear(); };
  read.lastUnpaid = () => summaryStore?.read();
  return read;
}
