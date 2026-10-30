/* Player directory and private drafts over authorized records. The workspace owns all requests. */
(() => {
  'use strict';
  const host = document.getElementById('player-profiles'); if (!host) return;
  const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; };
  const button = (text, fn, cls = 'secondary') => { const el = node('button', text, cls); el.type = 'button'; el.addEventListener('click', fn); return el; };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: window.CoachClub?.timeZone || 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dateLabel = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(date + 'T12:00:00Z')) : 'Date to confirm';
  const scopeKey = session => { const group = scopeBySession.get(session.id); return group?.verified ? group.key : session.id; };
  const scopeLabel = session => window.CoachGroups.label(session) + (scopeBySession.get(session.id)?.verified ? '' : ' · ' + dateLabel(session.date));
  let scopeBySession = new Map(), rosterSource = null;
  let context = null, identity = '', selected = '', group = '', directory = [], pending = false, epoch = 0;
  let composer = null, saving = false;
  const dirty = () => !!composer && (!!composer.body.value.trim() || !!composer.review.value || !!window.CoachGoals?.isDirty('profile-note'));
  function discard() { window.CoachGoals?.unmount('profile-note'); composer = null; }
  function leaveDraft() { if (saving || context?.busy) return false; if (dirty() && !confirm('Discard this unsaved player note?')) return false; discard(); return true; }
  window.CoachProfiles = Object.freeze({isDirty:dirty,isBusy:()=>saving,discard});
  const toolbar = node('div', '', 'profiles-toolbar'), searchLabel = node('label', 'Find a player'), search = node('input');
  search.id = 'profiles-search'; search.type = 'search'; search.placeholder = 'Search player names'; search.autocomplete = 'off'; searchLabel.htmlFor = search.id; searchLabel.append(search);
  const groupLabel = node('label', 'Training group'), filter = node('select'); filter.id = 'profiles-filter'; groupLabel.htmlFor = filter.id; groupLabel.append(filter);
  const count = node('p', '', 'small'); count.id = 'profiles-count'; count.setAttribute('role', 'status');
  const cards = node('div', '', 'profiles-grid'); cards.id = 'profiles-list';
  const detail = node('section', '', 'profile-detail'); detail.id = 'player-profile-detail'; detail.hidden = true;
  toolbar.append(searchLabel, groupLabel); host.append(toolbar, count, cards, detail);
  function buildDirectory() {
    scopeBySession = new Map(); for (const group of window.CoachGroups.groups(context.sessions || [])) for (const id of group.sessionIds) scopeBySession.set(id, group);
    const players = new Map();
    for (const session of context.sessions || []) for (const player of session.players || []) {
      if (!player.playerId || !session.id) continue;
      if (!players.has(player.playerId)) players.set(player.playerId, { id: player.playerId, name: player.name || 'Named player', rows: [] });
      const entry = players.get(player.playerId);
      if (!entry.rows.some(row => row.session.id === session.id)) entry.rows.push({ session, player });
    }
    directory = [...players.values()].map(entry => {
      entry.rows.sort((a, b) => a.session.date.localeCompare(b.session.date) || a.session.time.localeCompare(b.session.time));
      const latest = entry.rows.at(-1)?.player; entry.name = latest?.name || entry.name; entry.age = latest?.age;
      return entry;
    }).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }
  function renderList() {
    const scopes = new Map(); for (const entry of directory) for (const row of entry.rows) scopes.set(scopeKey(row.session), scopeLabel(row.session));
    const old = filter.value; filter.replaceChildren(new Option('All my groups', ''));
    for (const [value, label] of scopes) filter.append(new Option(label, value));
    filter.value = scopes.has(old) ? old : '';
    const query = search.value.trim().toLocaleLowerCase();
    const visible = directory.filter(entry => entry.name.toLocaleLowerCase().includes(query) && (!filter.value || entry.rows.some(row => scopeKey(row.session) === filter.value)));
    count.textContent = visible.length + ' of ' + directory.length + ' players · From your accessible rosters';
    cards.replaceChildren();
    for (const entry of visible) {
      const card = button('', () => { selected = entry.id; group = filter.value; render(); detail.querySelector('h2')?.focus(); }, 'player-directory-card');
      card.dataset.profileId = entry.id;
      const avatar = node('span', entry.name.split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase(), 'profile-avatar'); avatar.setAttribute('aria-hidden', 'true');
      const text = node('span', '', 'player-directory-card-text'), groups = new Set(entry.rows.map(row => scopeKey(row.session)));
      text.append(node('strong', entry.name), node('span', [entry.age ? 'Age ' + entry.age : '', groups.size + (groups.size === 1 ? ' group' : ' groups')].filter(Boolean).join(' · '), 'small'), node('span', 'View profile →', 'player-directory-card-link'));
      card.append(avatar, text); cards.append(card);
    }
    if (!visible.length) cards.append(node('p', directory.length ? 'No players match. Try another name or group.' : 'Player profiles will appear when named players are on your accessible rosters.', 'empty-state'));
  }
  function observations(entry, rows) {
    const sessions = new Set(rows.map(row => row.session.id)), full = ['owner', 'admin'].includes(context.profile.role);
    return (context.notes || []).filter(note => note.player_id === entry.id && sessions.has(note.session_id) && (full || note.author_email === context.profile.email))
      .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
  }
  function notesSection(title, rows, emptyText) {
    const section = node('section', '', 'profile-section'); section.append(node('h3', title));
    for (const note of rows.slice(0, 6)) {
      const item = node('article', '', 'profile-observation');
      const session = context.sessions.find(row => row.id === note.session_id);
      item.append(node('p', note.category + ' · ' + dateLabel(session?.date), 'small'), node('p', note.body));
      const goal = window.CoachGoals?.renderCard(note); if (goal) item.append(goal);
      if (note.review_date) item.append(node('p', 'Review ' + dateLabel(note.review_date), 'small'));
      section.append(item);
    }
    if (!rows.length) section.append(node('p', emptyText, 'empty-state'));
    if (rows.length > 6) section.append(node('p', 'Showing the latest 6. Open this player’s notes for more.', 'small'));
    return section;
  }
  async function openNotes(entry, rows, goal = false) {
    if (pending || !leaveDraft()) return;
    const available = rows.filter(row => row.session.status !== 'Cancelled');
    const target = available.find(row => row.session.date >= today()) || available.at(-1);
    if (!target) return;
    const ticket = epoch; pending = true; render();
    const accepted = await new Promise(resolve => window.dispatchEvent(new CustomEvent('coach:profile-open', { detail: { playerId: entry.id, sessionId: target.session.id, goal, resolve } })));
    if (ticket !== epoch) return;
    pending = false; if (context?.tab === 'profiles') render(); if (!accepted && context?.tab === 'profiles') detail.querySelector('[role="status"]').textContent = 'Could not open those notes. Refresh the roster and try again.';
  }
  function openComposer(entry, rows, category) {
    if (saving || context.busy) return;
    if (!composer) {
      const available = rows.filter(row => row.session.status !== 'Cancelled');
      const target = available.find(row => row.session.date >= today()) || available.at(-1); if (!target) return;
      const form = node('form', '', 'profile-note-composer'); form.id = 'profile-note-form';
      const title = node('h3', 'Add a private player note'); form.append(title, node('p', 'Private to you and full-access admins. Choose the session this observation belongs to.', 'small'));
      const field = (name, label, tag = 'input') => { const wrapper = node('label', label), input = node(tag); input.id = 'profile-note-' + name; wrapper.htmlFor = input.id; wrapper.append(input); form.append(wrapper); return input; };
      const session = field('session', 'Session date', 'select');
      for (const row of available) session.append(new Option(dateLabel(row.session.date) + ' · ' + row.session.time, row.session.id)); session.value = target.session.id;
      const categoryField = field('category', 'Category', 'select'); for (const value of ['General','Technical','Tactical','Physical','Confidence','Goal','Session review']) categoryField.append(new Option(value,value));
      const body = field('body', 'What did you notice?', 'textarea'); body.rows = 4; body.required = true; body.maxLength = 6000;
      const review = field('review', 'Review date · optional'); review.type = 'date';
      const actions = node('div', '', 'profile-actions'), save = node('button', 'Save private note', 'button'); save.type = 'submit';
      const cancel = button('Discard draft', () => { if (leaveDraft()) render(); }); cancel.id = 'profile-note-cancel';
      const status = node('p', '', 'small'); status.id = 'profile-note-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite');
      actions.append(save,cancel); form.append(actions,status);
      composer = {form,session,category:categoryField,body,review,status,save,cancel,playerId:entry.id,group,uncertain:false};
      window.CoachGoals?.mount('profile-note',{form,body,category:categoryField,player:()=>entry.id});
      form.addEventListener('submit', saveProfileNote);
    }
    composer.category.value = category; window.CoachGoals?.sync('profile-note'); render(); composer.body.focus();
  }
  async function saveProfileNote(event) {
    event.preventDefault(); const draft = composer;
    if (!draft || saving || context?.busy || draft.uncertain || !draft.body.value.trim()) return;
    const entry = directory.find(row => row.id === draft.playerId), target = entry?.rows.find(row => row.session.id === draft.session.value && scopeKey(row.session) === draft.group && row.session.status !== 'Cancelled');
    if (!target) { draft.status.textContent = 'Choose an available session date for this player.'; return; }
    const payload = {playerId:draft.playerId,sessionId:target.session.id,category:draft.category.value,body:draft.body.value.trim(),goal:window.CoachGoals?.read('profile-note') || null,reviewDate:draft.review.value || null};
    const ticket = epoch; saving = true; draft.status.textContent = 'Saving private note…'; render();
    try {
      await new Promise((resolve,reject)=>window.dispatchEvent(new CustomEvent('coach:profile-note-save',{detail:{payload,resolve,reject}})));
      if (ticket !== epoch || composer !== draft) return;
      const sessionId = draft.session.value; draft.form.reset(); draft.session.value = sessionId; window.CoachGoals?.reset('profile-note');
      draft.status.textContent = 'Private note saved for ' + dateLabel(target.session.date) + '.';
    } catch (error) {
      if (ticket !== epoch || composer !== draft) return;
      draft.uncertain = !!error.uncertain; draft.status.textContent = error.message || 'Could not save. Your draft is still here.';
    } finally { if (ticket === epoch) { saving = false; render(); } }
  }
  function renderComposer() {
    if (!composer) return;
    const locked = saving || context.busy;
    for (const input of composer.form.querySelectorAll('input,select,textarea,button')) input.disabled = locked;
    composer.save.disabled = locked || composer.uncertain; window.CoachGoals?.sync('profile-note'); detail.append(composer.form);
  }
  function renderDetail(entry) {
    detail.replaceChildren();
    const back = button('← All players', () => { if (!leaveDraft()) return; selected = ''; group = ''; render(); search.focus(); }); back.id = 'profile-back'; back.disabled = saving || context.busy; detail.append(back);
    const header = node('div', '', 'profile-heading'), name = node('h2', entry.name); name.tabIndex = -1;
    header.append(name, node('p', entry.age ? 'Age ' + entry.age : 'Player profile', 'small')); detail.append(header);
    const groups = new Map(); for (const row of entry.rows) groups.set(scopeKey(row.session), scopeLabel(row.session));
    if (!groups.has(group)) { const next = entry.rows.find(row => row.session.status !== 'Cancelled' && row.session.date >= today()) || entry.rows.at(-1); group = scopeKey(next.session); }
    detail.append(node('p', groups.get(group), 'small'));
    const rows = entry.rows.filter(row => scopeKey(row.session) === group), history = rows.filter(row => row.session.status !== 'Cancelled' && row.session.date <= today());
    const stats = node('div', '', 'profile-stats');
    for (const [value, label] of [['Present', 'Marked present'], ['Absent', 'Marked absent'], ['Not marked', 'Not marked']]) {
      const stat = node('div'); stat.append(node('strong', String(history.filter(row => (row.player.actualAttendance || 'Not marked') === value).length)), node('span', label)); stats.append(stat);
    }
    detail.append(stats, node('p', 'Recorded dates through today. Parent RSVPs are separate from attendance.', 'small'));
    const status = node('p'); status.setAttribute('role', 'status');
    const open = button('Open player notes', () => openNotes(entry, rows)); open.id = 'profile-open-notes'; open.disabled = pending || saving || context.busy || !rows.some(row => row.session.status !== 'Cancelled');
    const add = button('Add private note', () => openComposer(entry, rows, 'General'), 'button'); add.id = 'profile-add-note'; add.disabled = open.disabled;
    const goalAction = button('Add development goal', () => openComposer(entry, rows, 'Goal')); goalAction.id = 'profile-add-goal'; goalAction.disabled = open.disabled;
    const actions = node('div', '', 'profile-actions'); actions.append(add, goalAction, open); detail.append(actions, status); renderComposer();
    const notes = observations(entry, rows), columns = node('div', '', 'profile-columns');
    const goals = notes.filter(note => note.category === 'Goal'), progress = node('div', '', 'profile-goal-progress');
    progress.setAttribute('aria-label', 'Development goal progress');
    for (const [state, label] of [['planned','Planned'],['in-progress','In progress'],['achieved','Achieved']]) progress.append(node('span', goals.filter(note => (note.goal?.status || 'planned') === state).length + ' ' + label.toLowerCase(), 'goal-progress goal-progress-' + state));
    if (goals.length) detail.append(progress);
    columns.append(notesSection('Development goals', notes.filter(note => note.category === 'Goal'), 'No goals saved for this group yet.'), notesSection('Coaching observations', notes.filter(note => note.category !== 'Goal'), 'No player notes saved for this group yet.'));
    detail.append(columns);
    const historyBox = node('details', '', 'profile-history'); historyBox.append(node('summary', 'Attendance history · ' + history.length + ' recorded dates'));
    for (const row of [...history].reverse()) {
      const item = node('div', '', 'profile-history-row'); item.append(node('span', dateLabel(row.session.date) + ' · ' + row.session.time), node('strong', row.player.actualAttendance || 'Not marked')); historyBox.append(item);
    }
    if (!history.length) historyBox.append(node('p', 'No past attendance records for this group yet.', 'empty-state'));
    detail.append(historyBox, node('p', 'Only your accessible records are shown. Notes reflect the latest loaded history; refresh the roster for updates.', 'small'));
  }
  function render() {
    if (!context?.profile) return;
    const entry = directory.find(row => row.id === selected); if (!entry) selected = '';
    toolbar.hidden = count.hidden = cards.hidden = !!entry; detail.hidden = !entry;
    if (entry) renderDetail(entry); else renderList();
  }
  search.addEventListener('input', renderList); filter.addEventListener('change', renderList);
  window.addEventListener('coach:context', event => {
    const next = event.detail, key = next?.profile ? [next.profile.email, next.profile.role, next.profile.sessionVersion].join(':') : '';
    if (key !== identity) { epoch++; discard(); saving = false; identity = key; selected = group = ''; directory = []; scopeBySession.clear(); rosterSource = null; search.value = ''; filter.replaceChildren(); cards.replaceChildren(); detail.replaceChildren(); count.textContent = ''; pending = false; }
    context = next;
    if (!next?.profile) { detail.hidden = true; return; }
    if (rosterSource !== next.sessions) { buildDirectory(); rosterSource = next.sessions; } if (next.tab === 'profiles') render(); else { cards.replaceChildren(); detail.replaceChildren(); count.textContent = ''; }
  });
  window.dispatchEvent(new CustomEvent('coach:request-context'));
})();
