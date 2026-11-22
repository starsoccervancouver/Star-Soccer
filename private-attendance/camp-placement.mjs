import winterCamps from '../winter-camps.js';
import {sessionTimes, vancouverInstant} from './airtable-roster.mjs';

const dayCamp = 'SS-DAY-CAMP-V1';
export const campVersions = [dayCamp, 'SS-CAMP-V2', 'SS-CAMP-DROPIN-V1'];
const sourcePrefix = 'gmail-camp:';
const sameLink = (value, id) => value?.length === 1 && value[0] === id;
const split = (value, separator) => (value || '').split(separator).map(item => item.trim()).filter(Boolean);
const sameSet = (a, b) => a.length === b.length && new Set(a).size === a.length && a.every(x => b.includes(x));
const review = reason => ({placed: false, message: reason});
const open = new Set(['Planned', 'Confirmed']);

export function campRequest(event, now) {
  if (!/^\d{1,2}$/.test(event.age || '')) return;
  if (event.version === dayCamp) {
    const date = '2026-11-20';
    if (event.campId === 'pro-d-2026-11-20' && event.dates === date &&
        Number(event.age) >= 6 && Number(event.age) <= 13) {
      return {price: 60, dates: [date], slots: [{key: 'SS-20261120-KITS-PROD', date, time: '12 pm–3 pm'}]};
    }
    return;
  }
  const kind = event.version === 'SS-CAMP-V2' ? 'week' : 'dropin';
  const dates = split(event.dates, ',');
  try {
    const quote = winterCamps.quote({week: event.campWeek, kind, slot: event.campSlot, age: event.age, dates}, now);
    if (sameSet(dates, quote.dates) && sameSet(split(event.campKeys, ';'), quote.sessions.map(slot => slot.key))) {
      return {price: quote.price, dates: quote.dates, slots: quote.sessions};
    }
  } catch {
    // Late, invalid or obsolete requests stay in the placement queue.
  }
}

export async function placeCampRegistration(db, {event, registration, family, player, now, confirmationId}) {
  if (!['Needs review', 'Processing'].includes(registration.fields.Status) || registration.fields.Booking?.length ||
      !player || !family || registration.fields['Source Gmail ID'] !== event.id) {
    return review('Check the family, player and existing registration before placing.');
  }
  const request = campRequest(event, new Date(event.received));
  if (!request) return review('Check the camp dates, time slots and age eligibility before placing.');

  const source = sourcePrefix + event.reference;
  const bookings = await db.list('bookings', ['Source booking ID', 'Player', 'Family', 'Booking status', 'Covered dates', 'Start date']);
  const own = bookings.filter(row => row.fields['Source booking ID'] === source);
  const existing = own[0];
  if (own.length > 1 || existing && (
    !sameLink(existing.fields.Player, player.id) || !sameLink(existing.fields.Family, family.id) ||
    existing.fields['Booking status'] !== 'Accepted' ||
    !sameSet(split(existing.fields['Covered dates'], ','), request.dates)
  ) || bookings.some(({id, fields}) => id !== existing?.id && fields.Player?.includes(player.id) &&
    !['Cancelled', 'Completed'].includes(fields['Booking status']) &&
    split(fields['Covered dates'] || fields['Start date'], /[,;\n]+/).some(date => request.dates.includes(date)))) {
    return review('Check a potentially overlapping camp booking before placing.');
  }

  const sessions = await db.list('sessions', ['Source session ID', 'Session', 'Date', 'Time', 'Venue', 'Session status', 'Weekly program', 'Capacity', 'Attendance', 'Expected headcount (owner reported)']);
  const attendance = await db.list('attendance', ['Source coverage key', 'Player', 'Session', 'Booking', 'Coverage state', 'Session date', 'Website Registrations']);
  const coverage = [];
  for (const slot of request.slots) {
    const matches = sessions.filter(row => row.fields['Source session ID'] === slot.key);
    const session = matches[0];
    const s = session?.fields;
    if (matches.length !== 1 || s.Date !== slot.date || s.Venue !== 'Kitsilano Turf' ||
        !open.has(s['Session status']) || s['Weekly program']?.length ||
        !Number.isInteger(s.Capacity) || s.Capacity < 1 || s.Capacity > 20) {
      return review('Check the dated camp session and its capacity before placing.');
    }
    let startsAt;
    try {
      const [start, end] = sessionTimes(s.Time).map(time => vancouverInstant(slot.date, time));
      const expected = sessionTimes(slot.time).map(time => vancouverInstant(slot.date, time));
      if (start !== expected[0] || end !== expected[1]) {
        return review('Check the camp session time before placing.');
      }
      startsAt = Date.parse(start);
    } catch {
      return review('Check the camp session time before placing.');
    }
    const rows = attendance.filter(row => row.fields.Session?.includes(session.id));
    if (!sameSet(rows.map(row => row.id), s.Attendance || []) || rows.some(({fields}) =>
      !sameLink(fields.Session, session.id) || fields['Session date'] !== slot.date ||
      !['Active', 'Void'].includes(fields['Coverage state']) ||
      fields['Coverage state'] === 'Active' && fields.Player?.length !== 1)) {
      return review('Check the camp roster entries and capacity before placing.');
    }
    const key = source + ':' + slot.key;
    const previous = attendance.filter(row => row.fields['Source coverage key'] === key);
    const alreadyPlaced = previous.length === 1 && existing && sameLink(previous[0].fields.Booking, existing.id) &&
      sameLink(previous[0].fields.Session, session.id) && sameLink(previous[0].fields.Player, player.id) &&
      sameLink(previous[0].fields['Website Registrations'], registration.id) && previous[0].fields['Coverage state'] === 'Active';
    const active = rows.filter(row => row.fields['Coverage state'] === 'Active');
    const autoPlaced = active.filter(row => row.fields['Source coverage key']?.startsWith(sourcePrefix)).length;
    const reported = s['Expected headcount (owner reported)'] ?? 0;
    if (previous.length && !alreadyPlaced || active.some(row => row.fields.Player.includes(player.id) && row !== previous[0]) ||
        !Number.isInteger(reported) || reported < 0 ||
        !alreadyPlaced && (startsAt <= now.getTime() || Math.max(active.length, reported + autoPlaced) >= s.Capacity)) {
      return review('Check camp capacity or an existing seat before placing.');
    }
    if (!alreadyPlaced) coverage.push({key, session, date: slot.date});
  }

  // The mail coordinator serializes placement. Stable keys let it resume after
  // an uncertain API response without rewriting attendance already on the roster.
  const booking = existing || await db.save('bookings', {
    'Source booking ID': source, 'Booking reference': event.reference, Player: [player.id], Family: [family.id],
    'Booking type': 'Drop-in', 'Booking status': 'Accepted', 'Charge review': 'Agreed', 'Charge CAD': request.price,
    ...(event.version === 'SS-CAMP-V2' ? {'Fixed-price package': true} : {}),
    ...(event.version === 'SS-CAMP-DROPIN-V1' ? {'Agreed per-visit CAD': request.price / (request.slots.filter(slot => slot.date !== winterCamps.getWeek(event.campWeek).freeDate).length || 1)} : {}),
    'Start date': request.dates[0], 'Covered dates': request.dates.join(', '),
    'First session': [coverage[0].session.id], 'Accepted date': now.toISOString().slice(0, 10)
  }, {key: 'Source booking ID'});
  if (coverage.length) await db.saveMany('attendance', coverage.map(({key, session, date}) => ({
    'Source coverage key': key, 'Attendance entry': player.fields.Player + ' · ' + session.fields.Session,
    Player: [player.id], Session: [session.id], Booking: [booking.id], 'Website Registrations': [registration.id],
    'Coverage state': 'Active', 'Coverage approved': true, 'Session date': date, 'Attendance status': 'Not marked'
  })), {key: 'Source coverage key'});
  await db.save('registrations', {
    Status: confirmationId ? 'Confirmed' : 'Expected', Booking: [booking.id], Family: [family.id], Player: [player.id],
    'Confirmation Gmail ID': confirmationId,
    'Processing notes': confirmationId ? 'Owner confirmation recorded from Gmail. Payment is recorded separately.' : 'Returning player placed on the camp roster. This registration did not record a payment.',
    'Camp session keys': request.slots.map(slot => slot.key).join('; ')
  }, {id: registration.id});
  return {placed: true, message: confirmationId ? 'Parent confirmation recorded and player placed on the camp roster.' : 'Returning player placed on the camp roster. No payment recorded.'};
}
