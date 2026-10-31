/* Read-only coaching directory. Requests and authorization belong to the workspace. */
(() => {
  'use strict';
  const host = document.getElementById('coaching-team'); if (!host) return;
  const node = (tag, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = String(text ?? ''); if (cls) n.className = cls; return n; };
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const button = (text, fn, cls = 'secondary') => { const n = node('button', text, cls); n.type = 'button'; n.addEventListener('click', fn); return n; };
  const label = (text, control) => { const n = node('label', text); n.htmlFor = control.id; n.append(control); return n; };
  const request = (operation, payload = {}) => new Promise((resolve, reject) => emit('coach:team-request', { operation, payload, resolve, reject }));
  const roles = { owner: 'Owner', admin: 'Full-access admin', coach: 'Coach' };
  const allowed = value => !!value?.profile && ['owner', 'admin'].includes(value.profile.role);
  const identityOf = value => allowed(value) ? [value.profile.email, value.profile.role, value.profile.sessionVersion].join(':') : '';
  const countLabel = (n, text) => n + ' ' + text + (n === 1 ? '' : 's');
  const initials = name => String(name || '?').split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const dateLabel = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en-CA', { timeZone: window.CoachClub?.timeZone || 'America/Vancouver', year: 'numeric', month: 'short', day: 'numeric' }).format(date) : ''; };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: window.CoachClub?.timeZone || 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let context = null, identity = '', coaches = [], selected = '', loaded = false, loading = false, directoryEpoch = 0, notesEpoch = 0;
  let notes = [], notesFor = '', notesLoading = false, notesError = '', section = 'groups', noteLimit = 10;
  const active = () => allowed(context) && context.tab === 'coaches';
  const blocked = () => !active() || context.busy;
  const toolbar = node('div', '', 'coaching-team-toolbar'), search = node('input'); search.id = 'coaching-team-search'; search.type = 'search'; search.placeholder = 'Coach name'; search.autocomplete = 'off';
  const refresh = button('Refresh coaches', () => loadDirectory(true)); refresh.id = 'coaching-team-refresh';
  const status = node('p', '', 'coaching-status'); status.id = 'coaching-team-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  toolbar.append(label('Find a coach', search), refresh, status);
  const layout = node('div', '', 'coaching-team-layout'), sidebar = node('aside', '', 'coaching-team-sidebar'), coachList = node('div', '', 'coaching-coach-list'), detail = node('section', '', 'coaching-team-detail');
  sidebar.setAttribute('aria-label', 'Coaches'); coachList.id = 'coaching-coach-list'; detail.id = 'coaching-coach-detail'; sidebar.append(coachList); layout.append(sidebar, detail); host.append(toolbar, layout);
  function message(text, error = false) { status.textContent = text; status.classList.toggle('coaching-error', error); status.setAttribute('role', error ? 'alert' : 'status'); }
  function choose(email) {
    if (blocked() || loading || selected === email) return;
    selected = email; notesEpoch++; notes = []; notesFor = ''; notesError = ''; notesLoading = false; noteLimit = 10;
    render(); if (section === 'notes') loadNotes();
  }
  function assignedGroups(coach) {
    const assignments = new Set(coach.assignments || []), sessions = (context.sessions || []).filter(s => assignments.has(s.id)), groups = new Map(), scopes = new Map();
    for (const scope of window.CoachGroups?.groups(sessions) || []) for (const id of scope.sessionIds) scopes.set(id, scope);
    for (const session of sessions) {
      const scope = scopes.get(session.id), key = scope?.verified ? scope.key : session.id;
      if (!groups.has(key)) groups.set(key, { key, label: window.CoachGroups?.label(session) || session.label || session.location || 'Assigned session', sessions: [], players: new Map() });
      const group = groups.get(key); group.sessions.push(session);
      for (const player of session.players || []) if (player.playerId) {
        const old = group.players.get(player.playerId);
        if (!old || String(old.session.date) < String(session.date)) group.players.set(player.playerId, { ...player, session });
      }
    }
    for (const group of groups.values()) group.sessions.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.id).localeCompare(String(b.id)));
    return { groups: [...groups.values()].sort((a, b) => a.label.localeCompare(b.label)), missing: assignments.size - sessions.length };
  }
  function openSession(sessionId, playerId = null) {
    if (blocked()) return;
    if (playerId) emit('coach:profile-open', { sessionId, playerId, resolve: accepted => { if (!accepted) message('This player’s session could not be opened. Refresh the roster and try again.', true); } });
    else emit('coach:open-session', { sessionId, tab: 'plan', resolve: accepted => { if (!accepted) message('This session could not be opened. Refresh the roster and try again.', true); } });
  }
  function renderGroups(coach, scope) {
    const panel = node('section', '', 'coaching-group-list'); panel.id = 'coaching-groups'; panel.append(node('h3', 'Assigned groups & players'), node('p', 'Players listed here come from this coach’s assigned sessions.', 'coaching-muted'));
    if (!scope.groups.length) panel.append(node('p', scope.missing ? 'No assigned sessions are in the loaded roster.' : 'No groups are assigned to this account.', 'empty-state'));
    for (const [index, group] of scope.groups.entries()) {
      const card = node('details', '', 'coaching-group'); card.open = index === 0;
      const summary = node('summary'); summary.append(node('strong', group.label), node('span', countLabel(group.players.size, 'player') + ' · ' + countLabel(group.sessions.length, 'assigned session'), 'coaching-muted')); card.append(summary);
      const first = group.sessions[0], last = group.sessions.at(-1), dates = first.date === last.date ? dateLabel(first.date + 'T12:00:00Z') : dateLabel(first.date + 'T12:00:00Z') + ' – ' + dateLabel(last.date + 'T12:00:00Z');
      card.append(node('p', dates, 'coaching-muted'));
      const available = group.sessions.filter(s => s.status !== 'Cancelled'), next = available.find(s => s.date >= today()) || available.at(-1) || last;
      const open = button('Open group', () => openSession(next.id)); open.disabled = blocked(); card.append(open);
      const roster = node('ul', '', 'coaching-player-list');
      for (const player of [...group.players.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
        const row = node('li'), openPlayer = button(player.name || 'Player', () => openSession(player.session.id, player.playerId)); openPlayer.dataset.playerId = player.playerId; openPlayer.disabled = blocked(); row.append(openPlayer); roster.append(row);
      }
      if (!roster.children.length) card.append(node('p', 'No named players in these assigned sessions.', 'coaching-muted')); else card.append(roster);
      panel.append(card);
    }
    if (scope.missing > 0) panel.append(node('p', countLabel(scope.missing, 'assigned session') + (scope.missing === 1 ? ' is' : ' are') + ' outside the loaded roster.', 'coaching-muted'));
    return panel;
  }
  function renderNotes() {
    const panel = node('section', '', 'coaching-notes'); panel.id = 'coaching-notes'; panel.append(node('h3', 'Notes written by this coach'));
    if (notesLoading) { const pending = node('p', 'Loading notes…', 'coaching-status'); pending.setAttribute('role', 'status'); panel.append(pending); return panel; }
    if (notesError) { const error = node('p', notesError, 'coaching-error'); error.setAttribute('role', 'alert'); const retry = button('Retry notes', () => loadNotes(true)); retry.disabled = blocked(); panel.append(error, retry); return panel; }
    if (!notes.length) { panel.append(node('p', 'No recent notes written by this coach.', 'empty-state')); return panel; }
    panel.append(node('p', 'Showing ' + Math.min(noteLimit, notes.length) + ' of ' + notes.length + ' recent notes' + (notes.length === 200 ? ' · Latest 200' : ''), 'coaching-muted'));
    const list = node('div', '', 'coaching-note-list');
    for (const note of notes.slice(0, noteLimit)) {
      const session = (context.sessions || []).find(s => s.id === note.session_id), player = session?.players?.find(p => p.playerId === note.player_id);
      const card = node('article', '', 'coaching-note'), header = node('header'); card.dataset.noteId = note.id;
      const subject = note.player_id ? player?.name || 'Player note' : 'Group note';
      header.append(node('strong', subject + ' · ' + (note.category || 'Coaching note')), node('time', dateLabel(note.updated_at), 'coaching-muted'));
      card.append(header, node('p', note.body, 'coaching-note-body'));
      if (session) { card.append(node('p', (window.CoachGroups?.label(session) || session.location || 'Session') + ' · ' + dateLabel(session.date + 'T12:00:00Z'), 'coaching-muted')); const open = button('Open notes', () => note.player_id && player ? openSession(session.id, player.playerId) : emit('coach:open-session', { sessionId: session.id, tab: 'notes' })); open.disabled = blocked(); card.append(open); }
      else card.append(node('p', 'Session is outside the loaded roster.', 'coaching-muted'));
      list.append(card);
    }
    panel.append(list);
    if (notes.length > noteLimit) { const more = button('Show more notes', () => { noteLimit += 10; renderDetail(); }); more.id = 'coaching-notes-more'; more.disabled = blocked(); panel.append(more); }
    return panel;
  }
  function renderDetail() {
    detail.replaceChildren(); const coach = coaches.find(c => c.email === selected); if (!coach) { detail.append(node('p', 'Choose a coach to view their groups and notes.', 'empty-state')); return; }
    const scope = assignedGroups(coach), players = new Set(scope.groups.flatMap(group => [...group.players.keys()])), header = node('header', '', 'coaching-coach-header'), avatar = node('span', initials(coach.name), 'coaching-avatar'), text = node('div'); avatar.setAttribute('aria-hidden', 'true');
    const name = node('h2', coach.name || coach.email); name.id = 'coaching-selected-name';
    text.append(name, node('p', (roles[coach.role] || 'Coach') + (coach.active ? '' : ' · Inactive account'), 'coaching-muted'), node('p', coach.email, 'coaching-muted')); header.append(avatar, text);
    detail.append(header, node('p', countLabel(scope.groups.length, 'assigned group') + ' · ' + countLabel(players.size, 'player'), 'coaching-stats'));
    const tabs = node('div', '', 'coaching-tabs'); tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', 'Coach information');
    for (const [key, title] of [['groups', 'Groups & players'], ['notes', 'Coach notes']]) { const tab = button(title, () => { section = key; renderDetail(); if (key === 'notes') loadNotes(); }); tab.id = 'coaching-tab-' + key; tab.classList.toggle('secondary', section !== key); tab.setAttribute('aria-pressed', String(section === key)); tab.disabled = blocked(); tabs.append(tab); }
    detail.append(tabs, section === 'groups' ? renderGroups(coach, scope) : renderNotes());
  }
  function render() {
    host.hidden = !allowed(context); if (host.hidden) return;
    refresh.disabled = blocked() || loading; search.disabled = blocked(); refresh.textContent = loading ? 'Loading…' : 'Refresh coaches'; host.setAttribute('aria-busy', String(loading));
    const query = search.value.trim().toLocaleLowerCase(), visible = coaches.filter(c => (c.name + ' ' + c.email).toLocaleLowerCase().includes(query)); coachList.replaceChildren();
    for (const coach of visible) { const entry = button('', () => choose(coach.email), 'coaching-coach'); entry.dataset.coachEmail = coach.email; entry.setAttribute('aria-pressed', String(coach.email === selected)); entry.disabled = blocked() || loading; const avatar = node('span', initials(coach.name), 'coaching-avatar'); avatar.setAttribute('aria-hidden', 'true'); const text = node('span'); text.append(node('strong', coach.name || coach.email), node('span', (roles[coach.role] || 'Coach') + (coach.active ? '' : ' · Inactive'), 'coaching-muted')); entry.append(avatar, text); coachList.append(entry); }
    if (!visible.length) coachList.append(node('p', loaded ? 'No coaches match this search.' : 'Loading coaching team…', 'coaching-muted'));
    renderDetail();
  }
  async function loadDirectory(force = false) {
    if (blocked() || loading || loaded && !force) return;
    const ticket = ++directoryEpoch, who = identity; loading = true; notesEpoch++; notesLoading = false; notes = []; notesFor = ''; notesError = ''; message('Loading coaching team…'); render();
    try {
      const result = await request('list'); if (ticket !== directoryEpoch || who !== identity || !active()) return;
      if (!Array.isArray(result.coaches) || result.coaches.some(c => typeof c.email !== 'string' || typeof c.name !== 'string' || !roles[c.role] || !Array.isArray(c.assignments))) throw Error('The coaching directory could not be verified.');
      coaches = result.coaches.map(c => ({ email: c.email, name: c.name, role: c.role, active: !!c.active, assignments: [...new Set(c.assignments)] })).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name)); loaded = true;
      if (!coaches.some(c => c.email === selected)) selected = coaches.find(c => c.active && c.role === 'coach')?.email || coaches[0]?.email || '';
      notesFor = ''; message(coaches.length + ' team accounts');
    } catch (error) { if (ticket === directoryEpoch && who === identity) message(error.message || 'The coaching team could not load. Try Refresh coaches.', true); }
    finally { if (ticket === directoryEpoch && who === identity) { loading = false; render(); if (section === 'notes') loadNotes(true); } }
  }
  async function loadNotes(force = false) {
    if (blocked() || !selected || notesLoading || notesFor === selected && !force) return;
    const ticket = ++notesEpoch, who = identity, email = selected; notesLoading = true; notes = []; notesError = ''; renderDetail();
    try {
      const result = await request('notes', { email }); if (ticket !== notesEpoch || who !== identity || email !== selected || !active()) return;
      if (!Array.isArray(result.notes) || result.notes.some(n => n.author_email !== email || typeof n.body !== 'string')) throw Error('These notes could not be verified.');
      notes = result.notes; notesFor = email; noteLimit = 10;
    } catch (error) { if (ticket === notesEpoch && who === identity) { notesError = error.message || 'Notes could not load. Try again.'; notesFor = ''; } }
    finally { if (ticket === notesEpoch && who === identity) { notesLoading = false; renderDetail(); } }
  }
  search.addEventListener('input', render);
  window.addEventListener('coach:context', event => {
    const next = event.detail || null, key = identityOf(next), wasActive = active(); context = next;
    if (identity !== key) { identity = key; directoryEpoch++; notesEpoch++; coaches = []; selected = ''; notes = []; notesFor = ''; loaded = loading = notesLoading = false; notesError = ''; section = 'groups'; search.value = ''; coachList.replaceChildren(); detail.replaceChildren(); message(''); }
    else if (wasActive && !active()) { directoryEpoch++; notesEpoch++; loading = notesLoading = false; }
    render(); if (active() && !loaded && !loading) loadDirectory(); else if (active() && section === 'notes' && !notesFor && !notesLoading) loadNotes();
  });
  host.hidden = true; emit('coach:request-context');
})();
