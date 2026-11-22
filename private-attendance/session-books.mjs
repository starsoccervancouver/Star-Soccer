// A booking owns the charge and its verified payment allocations. A roster place
// alone does not establish a price, and a shared charge belongs in the books once.
const fields = {
  sessions: ['Session', 'Date', 'Time', 'Venue', 'Session status', 'Attendance'],
  attendance: ['Session', 'Session date', 'Player', 'Booking', 'Coverage state', 'Attendance status', 'Covered session key', 'Attended billing session', 'Preparation registration kind'],
  players: ['Player', 'Family', 'Attendance', 'Bookings'],
  bookings: ['Player', 'Family', 'Attendance', 'First session', 'Start date', 'Covered dates', 'Booking status', 'Booking type',
    'Charge review', 'Charge CAD', 'Billing basis', 'Attendance-adjusted charge CAD', 'Payment Allocations', 'Verified applied CAD', 'Balance CAD', 'Due now CAD', 'Unresolved price count', 'Fixed-price package'],
  families: ['Family', 'Players', 'Guardian name', 'Email', 'Phone', 'Payments', 'Unverified payment claims CAD', 'Verified family receipts CAD', 'Verified applied CAD']
};

const links = value => Array.isArray(value) ? value : [];
const single = value => links(value).length === 1 ? value[0] : null;
const emptyAmounts = {amountCharged: null, amountPaid: null, amountDue: null};
const recognizedSession = new Set(['Planned', 'Confirmed', 'Completed']);
const recognizedBooking = new Set(['Accepted', 'Completed']);
const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const validDate = value => typeof value === 'string' && dayPattern.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().startsWith(value);
const fieldIndex = rows => new Map(rows.map(({id, fields}) => [id, fields]));

function coveredDates(booking) {
  const input = String(booking['Covered dates'] || booking['Start date'] || '').trim();
  const dates = input.split(/[\s,;]+/).filter(Boolean);
  return dates.length && dates.every(validDate) ? [...new Set(dates)].sort() : [];
}

function contactOf(family) {
  if (!family) return null;
  const guardian = family['Guardian name'] || null, email = family.Email || null, phone = family.Phone || null;
  return guardian || email || phone ? {guardian, email, phone} : null;
}

function familyForBooking(booking, playerId, player, families) {
  const playerFamilies = links(player?.Family), bookingFamilies = links(booking.Family);
  const family = families.get(single(playerFamilies));
  const consistent = playerFamilies.length <= 1 && bookingFamilies.length <= 1 &&
    (!playerFamilies.length || links(family?.Players).includes(playerId)) &&
    (!bookingFamilies.length || bookingFamilies[0] === single(playerFamilies));
  return {consistent, family: consistent ? family : null};
}

function isPackage(booking) {
  return booking['Billing basis'] === 'Pass or package' || booking['Fixed-price package'] === true || booking['Booking type'] === 'Four consecutive sessions';
}

function cents(amount) {
  return Number.isFinite(amount) && amount >= 0 && Number.isSafeInteger(Math.round(amount * 100)) &&
    Math.abs(Math.round(amount * 100) - amount * 100) < 0.000001 ? Math.round(amount * 100) : null;
}

function reconciledAmounts(booking, family, upcoming) {
  if (booking['Charge review'] !== 'Agreed' || booking['Unresolved price count'] !== 0) return null;
  const [charged, balance, due] = ['Attendance-adjusted charge CAD', 'Balance CAD', 'Due now CAD'].map(key => cents(booking[key]));
  const paid = cents(booking['Verified applied CAD'] ?? (links(booking['Payment Allocations']).length === 0 ? 0 : null));
  if ([charged, paid, balance, due].includes(null) || charged - paid !== balance || due !== (upcoming ? 0 : balance)) return null;
  // A family-level unapplied receipt or claim cannot be assigned to this booking.
  if (due > 0 && family) {
    const claims = family['Unverified payment claims CAD'], received = family['Verified family receipts CAD'], applied = family['Verified applied CAD'];
    const noReceipts = !links(family.Payments).length;
    const receipts = cents(received ?? (noReceipts ? 0 : null)), claimsTotal = cents(claims ?? (noReceipts ? 0 : null));
    if (claimsTotal !== 0 || receipts === null || receipts !== cents(applied ?? (noReceipts ? 0 : null))) return null;
  }
  return {amountCharged: charged / 100, amountPaid: paid / 100, amountDue: due / 100};
}

export function buildSessionBooks(tables, today, source = {}) {
  if (!validDate(today)) throw Error('SESSION_BOOKS_DATE_REQUIRED');
  const sessions = fieldIndex(tables.sessions), players = fieldIndex(tables.players), bookings = fieldIndex(tables.bookings);
  const families = fieldIndex(tables.families), attendance = fieldIndex(tables.attendance);
  const rows = [], byBooking = new Map(), bySeat = new Map();
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
    return {scope: 'session', attendanceId, playerId, playerName: player?.Player || null, sessionId, sessionLabel: session.Session || null,
      date: session.Date || null, time: session.Time || null, location: session.Venue || null,
      attendanceStatus: a['Attendance status'] || 'Not marked', bookingId, bookingType: bookings.get(bookingId)?.['Booking type'] || null,
      status: 'review', ...emptyAmounts, contact: valid ? contactOf(family) : null};
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
        if (ambiguousPlayer) Object.assign(row, {playerId: null, playerName: null, contact: null});
      }
      const memberIds = new Set(members.map(m => m.attendanceId));
      const allLinked = reverse.length > 0 && reverse.every(id => {
        const record = attendance.get(id);
        return record && single(record.Booking) === bookingId && (record['Coverage state'] === 'Void' ||
          sessions.get(single(record.Session))?.['Session status'] === 'Cancelled' || memberIds.has(id));
      });
      const validMembers = members.every(m => m.valid && m.playerId === playerId && reverse.includes(m.attendanceId) && dates.includes(m.session.Date) &&
        bySeat.get([m.playerId, m.sessionId].join('/')).length === 1);
      const familyAgrees = familyForBooking(booking, playerId, player, families).consistent;
      const firstMatches = first.length === 0 || first.length === 1 && sessions.get(first[0])?.Date === starts && (multiple || first[0] === sessionId);
      const verified = recognizedBooking.has(booking['Booking status']) && ['Historical', 'Attendance', 'Pass or package'].includes(basis) &&
        validDate(starts) && dates[0] === starts && firstMatches && single(booking.Player) === playerId && links(player?.Bookings).includes(bookingId) &&
        allLinked && validMembers && familyAgrees;
      if (!verified) {
        if (!familyAgrees || members.some(m => m.playerId !== playerId) || single(booking.Player) !== playerId) row.contact = null;
        rows.push(row);
        continue;
      }
      const upcoming = starts > today;
      const amounts = reconciledAmounts(booking, family, upcoming);
      if (amounts) {
        const attended = a['Attendance status'] === 'Present';
        if (multiple) Object.assign(row, amounts, {status: 'package'});
        else if (upcoming) Object.assign(row, amounts, {status: 'upcoming'});
        else if (amounts.amountDue > 0) {
          if (attended && (basis === 'Historical' || a['Attended billing session'] === sessionId)) Object.assign(row, amounts, {status: 'due'});
        } else if (amounts.amountPaid > 0) Object.assign(row, amounts, {status: 'paid'});
        else if (basis !== 'Attendance' || a['Attendance status'] === 'Absent' || a['Attended billing session'] === sessionId ||
          booking['Charge CAD'] === 0 || (session.Date.endsWith('-12-25') && links(a['Preparation registration kind']).includes('SS-CAMP-DROPIN-V1'))) {
          Object.assign(row, amounts, {status: 'no-charge'});
        }
      }
      if (row.status === 'due') {
        row.familyId = family ? single(player.Family) : null;
        row.familyName = family?.Family || family?.['Guardian name'] || null;
        if (/^app[A-Za-z0-9]{14}$/.test(source.baseId) && /^tbl[A-Za-z0-9]{14}$/.test(source.bookings) && /^rec[A-Za-z0-9]{14}$/.test(bookingId)) {
          row.bookingUrl = 'https://airtable.com/' + source.baseId + '/' + source.bookings + '/' + bookingId;
        }
      }
      rows.push(row);
    }
  }
  // Books also includes approved bookings that have not been placed on a roster.
  // An unplaced booking can never enter the per-session unpaid queue.
  for (const [bookingId, booking] of bookings) {
    if (processed.has(bookingId) || !recognizedBooking.has(booking['Booking status'])) continue;
    const linked = links(booking.Attendance);
    if (linked.length && linked.every(id => {
      const a = attendance.get(id);
      return a && (a['Coverage state'] === 'Void' || sessions.get(single(a.Session))?.['Session status'] === 'Cancelled');
    })) continue;
    const first = links(booking['First session']), firstSession = sessions.get(single(first));
    if (firstSession?.['Session status'] === 'Cancelled') continue;
    const dates = coveredDates(booking), date = booking['Start date'], playerId = single(booking.Player), player = players.get(playerId);
    const {consistent, family} = familyForBooking(booking, playerId, player, families);
    const identity = !!player && links(player.Bookings).includes(bookingId) && consistent;
    const row = {scope: 'booking', attendanceId: null, playerId, playerName: player?.Player || null, sessionId: null,
      sessionLabel: firstSession?.Session || 'Unplaced booking', date: validDate(date) ? date : null, time: null, location: null,
      attendanceStatus: null, bookingId, bookingType: booking['Booking type'] || null, coveredDates: dates,
      contact: identity ? contactOf(family) : null, status: 'review', ...emptyAmounts};
    if (identity && !linked.length) {
      const amounts = reconciledAmounts(booking, family, date > today);
      if (amounts) Object.assign(row, amounts);
      if (amounts && isPackage(booking) && validDate(date) && dates[0] === date && (!first.length ||
        first.length === 1 && recognizedSession.has(firstSession?.['Session status']) && firstSession.Date === date)) row.status = 'package';
    }
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
