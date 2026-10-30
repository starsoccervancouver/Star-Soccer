/* Read-only navigation buckets; only verified program links establish recurrence. */
(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CoachGroups = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const text = value => typeof value === 'string' ? value.normalize('NFKC').trim().replace(/\s+/g, ' ') : '';
  const venueKey = value => text(value).toLowerCase();
  const timeKey = value => text(value).toLowerCase().replace(/[–—−]/g, '-').replace(/\s+/g, '');
  const recordId = value => typeof value === 'string' && /^rec[A-Za-z0-9]{14}$/.test(value);
  // Navigation only: a camp week never establishes shared attendance or note history.
  const winterWeeks = [
    { week: 1, start: '2026-12-21', end: '2026-12-25' },
    { week: 2, start: '2026-12-28', end: '2027-01-01' },
  ];
  function campWeek(session) {
    const camp = /\b(winter\s+camp|christmas|boxing)\b/i.test(text(session?.label)) || session?.players?.some(player => player.kind === 'camp');
    return camp ? winterWeeks.find(week => session.date >= week.start && session.date <= week.end) : null;
  }
  function weekday(session) {
    const date = session?.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(date + 'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? parsed.getUTCDay() : null;
  }
  function identity(session) {
    if (!session || !text(session.id)) return null;
    const camp = campWeek(session);
    if (camp && weekday(session) !== null) return { key: JSON.stringify(['winter-camp', camp.start]), kind: 'camp', week: camp.week, start: camp.start, end: camp.end,
      weekday: null, day: 'Camps', time: '', location: '', programId: null, verified: false };
    const day = weekday(session), time = timeKey(session.time), location = venueKey(session.location);
    const verified = recordId(session.programId) && day !== null && !!time && !!location;
    return { key: JSON.stringify([verified ? 'program' : 'other', verified ? session.programId : null, day, time, location]),
      weekday: day, day: weekdays[day] || 'Other sessions', time: text(session.time), location: text(session.location),
      programId: recordId(session.programId) ? session.programId : null, verified };
  }
  function key(session) { return identity(session)?.key || null; }
  function sameGroup(a, b) {
    if (text(a?.id) && a.id === b?.id) return true;
    const left = identity(a), right = identity(b);
    return !!left?.verified && !!right?.verified && left.key === right.key;
  }
  function label(value) {
    if (Array.isArray(value?.sessionIds) && typeof value.label === 'string') return value.label;
    const group = identity(value);
    if (!group) return 'Choose a group';
    if (group.kind === 'camp') return 'Winter Camp — Week ' + group.week;
    return [group.day, group.time || 'Time to confirm', group.location || 'Venue to confirm', group.verified ? '' : 'Other sessions'].filter(Boolean).join(' · ');
  }
  function minute(value) {
    const parts = text(value).toLowerCase().replace(/noon/g, '12:00 pm').split(/[–—-]/), match = parts[0].trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (!match) return 1440;
    const suffix = match[3] || parts[1]?.match(/(am|pm)\s*$/)?.[1], hour = Number(match[1]), minutes = Number(match[2] || 0);
    if (minutes > 59 || hour > (suffix ? 12 : 23) || suffix && hour < 1) return 1440;
    return (suffix ? hour % 12 + (suffix === 'pm' ? 12 : 0) : hour) * 60 + minutes;
  }
  const compareSessions = (a, b) => text(a.date).localeCompare(text(b.date)) || minute(a.time) - minute(b.time) || text(a.id).localeCompare(text(b.id));
  function upcoming(session, now, local) {
    if (weekday(session) === null || ['cancelled', 'completed'].includes(text(session.status).toLowerCase())) return false;
    if (Number.isFinite(Date.parse(session.startAt))) {
      return Date.parse(session.startAt) >= now.getTime() || Date.parse(session.endAt) > now.getTime();
    }
    const end = text(session.time).split(/[–—-]/)[1];
    return session.date > local.date || session.date === local.date && (minute(session.time) >= local.minute || end && minute(end) < 1440 && minute(end) > local.minute);
  }
  function members(sessions, groupKey) {
    if (typeof groupKey !== 'string' || !Array.isArray(sessions)) return [];
    return sessions.filter(session => key(session) === groupKey).slice().sort(compareSessions);
  }
  function groups(sessions, { now = new Date(), timeZone = globalThis.CoachClub?.timeZone || 'America/Vancouver' } = {}) {
    const buckets = new Map();
    for (const session of Array.isArray(sessions) ? sessions : []) {
      const item = identity(session); if (!item) continue;
      if (!buckets.has(item.key)) buckets.set(item.key, { ...item, id: item.key, label: label(session), sessions: [], sessionIds: [] });
      const group = buckets.get(item.key);
      if (group.sessionIds.includes(session.id)) continue;
      group.sessions.push(session); group.sessionIds.push(session.id);
    }
    const result = [...buckets.values()].sort((a, b) => (a.weekday === null ? 8 : a.weekday || 7) - (b.weekday === null ? 8 : b.weekday || 7) || timeKey(a.time).localeCompare(timeKey(b.time)) || venueKey(a.location).localeCompare(venueKey(b.location)) || a.key.localeCompare(b.key));
    const labels = new Map();
    for (const group of result) {
      group.sessions.sort(compareSessions); group.sessionIds = group.sessions.map(session => session.id);
      const sameLabel = labels.get(group.label) || []; sameLabel.push(group); labels.set(group.label, sameLabel);
    }
    // Distinct programs at the same time and venue stay separate and selectable.
    for (const sameLabel of labels.values()) if (sameLabel.length > 1) sameLabel.forEach((group, index) => { group.label += ' · Group ' + (index + 1); });
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(now).map(part => [part.type, part.value]));
    const local = { date: parts.year + '-' + parts.month + '-' + parts.day, minute: Number(parts.hour) * 60 + Number(parts.minute) };
    const next = new Map(result.map(group => [group.key, group.sessions.find(session => upcoming(session, now, local))]));
    // Keep history reachable after upcoming groups; stable keys break equal-slot ties.
    return result.sort((a, b) => {
      const left = next.get(a.key), right = next.get(b.key);
      if (!!left !== !!right) return left ? -1 : 1;
      return (left && right ? text(left.date).localeCompare(text(right.date)) || minute(left.time) - minute(right.time) : 0) || a.key.localeCompare(b.key);
    });
  }
  return Object.freeze({ key, groups, sameGroup, members, label });
});
