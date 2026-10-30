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
  function weekday(session) {
    const date = session?.date;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const parsed = new Date(date + 'T12:00:00Z');
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? parsed.getUTCDay() : null;
  }
  function identity(session) {
    if (!session || !text(session.id)) return null;
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
    return [group.day, group.time || 'Time to confirm', group.location || 'Venue to confirm', group.verified ? '' : 'Other sessions'].filter(Boolean).join(' · ');
  }
  const compareSessions = (a, b) => text(a.date).localeCompare(text(b.date)) || timeKey(a.time).localeCompare(timeKey(b.time)) || text(a.id).localeCompare(text(b.id));
  function members(sessions, groupKey) {
    if (typeof groupKey !== 'string' || !Array.isArray(sessions)) return [];
    return sessions.filter(session => key(session) === groupKey).slice().sort(compareSessions);
  }
  function groups(sessions) {
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
    return result;
  }
  return Object.freeze({ key, groups, sameGroup, members, label });
});
