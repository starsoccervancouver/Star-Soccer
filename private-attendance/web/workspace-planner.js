/* Group-first planning and private drawers. Uses only the authorized workspace context. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const make = (tag, text = '', className = '') => {
    const node = document.createElement(tag); node.textContent = String(text ?? '');
    if (className) node.className = className;
    return node;
  };
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const club = window.CoachClub || { timeZone: 'America/Vancouver', trainingDays: [3, 4, 5, 0] };
  const weekday = date => new Date(date + 'T12:00:00Z').getUTCDay();
  const label = date => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' }).format(new Date(date + 'T12:00:00Z'));
  const localNow = () => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: club.timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map(p => [p.type, p.value]));
    return { date: parts.year + '-' + parts.month + '-' + parts.day, minute: Number(parts.hour) * 60 + Number(parts.minute) };
  };
  const startMinute = session => {
    const parts = String(session.time || '').toLowerCase().replace(/noon/g, '12:00 pm').split(/[–—-]/);
    let start = parts[0].trim();
    if (!/\b(?:am|pm)\b/.test(start) && /(?:am|pm)\s*$/.test(parts[1] || '')) start += ' ' + parts[1].match(/(am|pm)\s*$/)[1];
    const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/.exec(start);
    if (!match || Number(match[2] || 0) > 59 || Number(match[1]) > (match[3] ? 12 : 23)) return null;
    return (match[3] ? Number(match[1]) % 12 + (match[3] === 'pm' ? 12 : 0) : Number(match[1])) * 60 + Number(match[2] || 0);
  };
  const usable = session => session && /^\d{4}-\d{2}-\d{2}$/.test(session.date || '') && !['cancelled', 'completed'].includes(String(session.status).toLowerCase());
  const endMinute = session => {
    const end = String(session.time || '').split(/[–—-]/)[1];
    return end ? startMinute({ time: end.trim() }) : null;
  };
  const inProgress = session => {
    if (!usable(session)) return false;
    if (session.startAt) return Number.isFinite(Date.parse(session.endAt)) && Date.parse(session.startAt) <= Date.now() && Date.parse(session.endAt) > Date.now();
    const now = localNow(), start = startMinute(session), end = endMinute(session);
    return session.date === now.date && start !== null && end !== null && end > start && start <= now.minute && end > now.minute;
  };
  const sortSessions = rows => [...rows].sort((a, b) => a.date.localeCompare(b.date) || (startMinute(a) ?? 1440) - (startMinute(b) ?? 1440) || String(a.id).localeCompare(String(b.id)));
  const nextSession = (rows, day = null) => {
    const now = localNow();
    return sortSessions((rows || []).filter(s => {
      if (!usable(s) || day !== null && weekday(s.date) !== Number(day)) return false;
      if (inProgress(s)) return true;
      if (s.startAt && Number.isFinite(Date.parse(s.startAt))) return Date.parse(s.startAt) >= Date.now();
      return s.date > now.date || s.date === now.date && startMinute(s) !== null && startMinute(s) >= now.minute;
    })).sort((a, b) => Number(inProgress(b)) - Number(inProgress(a)))[0] || null;
  };
  let context = null, identity = '', pane = '', opener = null, noteSaving = false, uncertain = false;
  let historyLimit = 10, dateLimit = 20, focusedSession = '', focusEpoch = 0;
  const dirty = () => !!$('planner-note-body')?.value.trim();
  const busy = () => noteSaving;
  function resetDraft() {
    $('planner-note-form')?.reset();
    if ($('planner-note-status')) $('planner-note-status').textContent = '';
    uncertain = false;
  }
  window.CoachPlanner = Object.freeze({ nextSession, isDirty: dirty, isBusy: busy, discard: resetDraft, focusSession, exitFocus, isFocused: () => !!focusedSession && focusedSession === context?.selected && context?.tab === 'plan' });
  const current = () => context?.session;
  const readOnly = () => String(current()?.status).toLowerCase() === 'cancelled';
  const unavailable = () => !context?.profile || !current() || context.tab !== 'plan';
  const locked = () => !!context?.busy || noteSaving;
  const sameGroup = (a, b) => !!window.CoachGroups?.sameGroup(a, b);
  const selectedGroup = () => context?.selectedGroup || window.CoachGroups?.groups(context?.sessions || []).find(group => group.key === window.CoachGroups.key(current())) || null;
  const groupHistory = () => (context?.groupSessions || context?.sessions || []).filter(row => sameGroup(current(), row));
  const groupTarget = group => nextSession(group.sessions) || sortSessions(group.sessions.filter(row => row && /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') && row.date <= localNow().date && String(row.status).toLowerCase() !== 'cancelled')).at(-1) || sortSessions(group.sessions.filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row?.date || '') && String(row.status).toLowerCase() === 'cancelled')).at(-1) || null;

  function closeDatePicker() {
    if (pane === 'dates') closeDrawer(true);
    for (const id of ['planner-other-date', 'planner-focus-date']) $(id).setAttribute('aria-expanded', 'false');
  }
  function renderDates() {
    const today = localNow().date, end = new Date(today + 'T12:00:00Z');
    end.setUTCDate(end.getUTCDate() + 7);
    const cutoff = end.toISOString().slice(0, 10), month = $('planner-dates-month').value;
    $('planner-dates-month').max = cutoff.slice(0, 7);
    $('planner-dates-detail').textContent = 'Dates through ' + label(cutoff) + '. All available past sessions are accessible.';
    const rows = sortSessions((selectedGroup()?.sessions || []).filter(s => /^\d{4}-\d{2}-\d{2}$/.test(s.date || '') && s.date <= cutoff && (!month || s.date.startsWith(month))));
    const upcoming = rows.filter(s => s.date >= today), past = rows.filter(s => s.date < today).reverse();
    const row = session => {
      const button = make('button', '', 'planner-date-row'), selected = session.id === current()?.id;
      button.type = 'button'; button.dataset.sessionDateId = session.id; button.disabled = locked();
      if (selected) button.setAttribute('aria-current', 'date');
      button.append(make('strong', label(session.date) + ', ' + session.date.slice(0, 4)), make('span', [session.time, session.location].filter(Boolean).join(' · '), 'planner-date-meta'));
      const status = String(session.status).toLowerCase();
      const detail = [selected ? 'Selected' : '', status === 'cancelled' ? 'Cancelled · Read only' : status === 'completed' ? 'Completed' : ''].filter(Boolean).join(' · ');
      if (detail) button.append(make('span', detail, 'planner-date-state'));
      button.addEventListener('click', () => requestSession(session.id));
      return button;
    };
    $('planner-dates-upcoming').replaceChildren(...(upcoming.length ? upcoming.map(row) : [make('p', 'No sessions in the next seven days' + (month ? ' for this month.' : '.'), 'planner-dates-empty')]));
    $('planner-dates-past').replaceChildren(...(past.length ? past.slice(0, dateLimit).map(row) : [make('p', 'No past sessions' + (month ? ' for this month.' : ' available.'), 'planner-dates-empty')]));
    $('planner-dates-more').hidden = past.length <= dateLimit;
    $('planner-dates-count').textContent = past.length > dateLimit ? 'Showing ' + dateLimit + ' of ' + past.length + ' past sessions.' : past.length + ' past session' + (past.length === 1 ? '' : 's') + '.';
    for (const id of ['planner-dates-month', 'planner-dates-clear', 'planner-dates-more']) $(id).disabled = locked();
    $('planner-dates-clear').hidden = !month;
  }
  function renderFocus() {
    const selected = current(), active = !!focusedSession && focusedSession === selected?.id && context?.tab === 'plan' && !!context?.profile;
    document.body.classList.toggle('planner-focus-mode', active);
    $('planner-focus-bar').hidden = !active;
    $('planner-session-browser').hidden = active;
    $('planner-workspace').hidden = !active;
    const group = selectedGroup();
    $('planner-focus-title').textContent = active ? group?.kind === 'camp' ? group.label : (group?.day || 'Training') + ' group' + (group?.label.match(/ · Group \d+$/)?.[0] || '') : '';
    $('planner-focus-detail').textContent = active ? [readOnly() ? 'Cancelled · Read only' : '', label(selected.date), selected.time, selected.location].filter(Boolean).join(' · ') : '';
    if (!active) closeDatePicker();
    for (const id of ['planner-back', 'planner-home', 'planner-focus-date']) $(id).disabled = locked();
    $('planner-save').disabled = !active || locked() || readOnly() || !context?.planReady;
    $('planner-save').textContent = context?.planDirty ? 'Save changes' : 'Save plan';
    document.dispatchEvent(new Event('coach:dictation-state'));
  }
  function focusSession(sessionId) {
    if (!context?.profile || context.tab !== 'plan' || current()?.id !== sessionId) return false;
    const newlyFocused = focusedSession !== sessionId || !$('planner-workspace').getClientRects().length;
    focusedSession = sessionId; closeDatePicker(); renderFocus(); emit('coach:focus-changed', { focused: true, sessionId });
    if (newlyFocused) {
      const ticket = ++focusEpoch;
      requestAnimationFrame(() => { if (ticket !== focusEpoch || focusedSession !== sessionId || context?.tab !== 'plan') return; $('planner-focus-title').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); });
    }
    return true;
  }
  function exitFocus() {
    focusedSession = ''; focusEpoch++; closeDrawer(true); closeDatePicker(); renderFocus(); emit('coach:focus-changed', { focused: false, sessionId: null });
    if (context?.profile && context.tab === 'plan') { $('planner-chooser-title').focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }
  }
  function requestSession(sessionId, chooseDate = false) {
    if (!sessionId || locked()) return;
    emit('coach:open-session', { sessionId, tab: 'plan', resolve: accepted => { if (accepted) { focusSession(sessionId); if (chooseDate) $('planner-focus-date').click(); } } });
  }
  function requestExit(destination) {
    if (locked()) return;
    emit('coach:planner-navigate', { destination, resolve: accepted => { if (accepted) exitFocus(); } });
  }

  function renderDays() {
    const rows = context?.sessions || [], selected = current();
    const groups = window.CoachGroups?.groups(rows) || [], group = selectedGroup();
    $('planner-other-date').hidden = true;
    document.querySelector('.planner-session-summary').hidden = true;
    const cards = groups.map(item => {
      const next = groupTarget(item), button = make('button', '', 'planner-day');
      button.type = 'button'; button.dataset.weekday = String(item.weekday ?? ''); button.dataset.groupKey = item.key;
      button.setAttribute('aria-pressed', String(item.key === group?.key));
      button.disabled = locked() || !next;
      button.append(make('strong', item.label), make('span', item.kind === 'camp' ? 'Choose a day and morning or afternoon session' : item.verified ? 'Attendance, plans and player notes' : 'Separate dates · no shared group history'));
      button.append(make('span', next ? inProgress(next) ? 'In progress · ' + label(next.date) : nextSession(item.sessions) ? 'Next · ' + label(next.date) : 'Recorded dates · ' + label(next.date) : 'No available dates', 'planner-day-time'));
      button.addEventListener('click', () => { if (next) requestSession(next.id, item.kind === 'camp'); });
      return button;
    });
    const regular = cards.filter((_, index) => groups[index].kind !== 'camp'), camps = cards.filter((_, index) => groups[index].kind === 'camp');
    $('planner-days').replaceChildren(...regular, ...(camps.length ? [make('h3', 'Camps', 'coach-camps-heading'), ...camps] : []), ...(!groups.length ? [make('p', 'No assigned training groups yet.', 'empty-state')] : []));
    $('planner-session-title').textContent = selected ? window.CoachGroups.label(group || selected) : 'Choose a training group';
    $('planner-session-detail').textContent = selected ? [label(selected.date), selected.time, selected.location].filter(Boolean).join(' · ') : 'No assigned training group.';
    const next = group && nextSession(group.sessions);
    $('planner-session-mode').textContent = selected ? inProgress(selected) ? 'In progress' : next?.id === selected.id ? 'Next session for this group' : 'Selected date' : 'No session selected';
    renderDates();
    $('planner-open-selected').disabled = locked() || !selected;
    for (const id of ['planner-open-notes', 'planner-open-tools', 'planner-open-run']) $(id).disabled = locked() || !selected;
    if (readOnly()) for (const id of ['planner-open-tools', 'planner-open-run']) $(id).disabled = true;
    window.CoachViews?.mount($('planner-session-browser'), 'training', { groups, locked:locked(), onOpen:sessionId => requestSession(sessionId) });
    renderFocus();
  }

  function renderNotes() {
    const selected = current(), picker = $('planner-notes-player'), previous = picker.value;
    picker.replaceChildren(new Option('Group notes', ''), ...(selected?.players || []).map(player => new Option(player.name, player.playerId)));
    picker.value = [...picker.options].some(o => o.value === previous) ? previous : '';
    const playerId = picker.value;
    const query = $('planner-notes-search').value.trim().toLowerCase();
    const historyIds = new Set(groupHistory().map(row => row.id));
    const list = (context?.notes || []).filter(note => {
      if (!historyIds.has(note.session_id)) return false;
      if (query && !(note.body + ' ' + note.category + ' ' + note.author_email).toLowerCase().includes(query)) return false;
      if (playerId) return note.player_id === playerId;
      if (note.player_id) return false;
      return true;
    }).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const heading = make('p', selectedGroup()?.verified ? playerId ? 'This player’s notes within this training group.' : 'Group notes across its recorded dates.' : 'Notes for this date only. This session has no verified recurring group.', 'small');
    const cards = list.slice(0, historyLimit).map(note => {
      const source = context.sessions.find(s => s.id === note.session_id), card = make('article', '', 'planner-note-card note-card');
      const date = source?.date ? label(source.date) : 'Previous session';
      card.append(make('span', note.category, 'tag'), make('h3', date), make('p', note.body, 'note-body'), make('p', (note.author_email === context.profile.email ? 'Your private note' : note.author_email) + (note.updated_at ? ' · ' + new Intl.DateTimeFormat('en-CA', { timeZone: club.timeZone, month: 'short', day: 'numeric' }).format(new Date(note.updated_at)) : ''), 'small'));
      return card;
    });
    $('planner-notes-list').replaceChildren(heading, ...(cards.length ? cards : [make('p', query ? 'No notes match your search.' : playerId ? 'No notes for this player yet.' : 'No group notes yet. Add one for this session above.', 'empty-state')]));
    $('planner-notes-results').textContent = Math.min(list.length, historyLimit) + ' of ' + list.length + ' matching notes' + (context.notes.length >= 200 ? ' · Showing the 200 most recent accessible notes; older history may be omitted.' : '');
    $('planner-notes-more').hidden = list.length <= historyLimit;
    $('planner-note-body').placeholder = playerId ? 'What would help this player in the next session?' : 'What should the coaching group work on next?';
    for (const control of $('planner-note-form').querySelectorAll('input,select,textarea,button')) control.disabled = locked() || unavailable() || readOnly() || uncertain;
    picker.disabled = locked() || unavailable();
    document.dispatchEvent(new Event('coach:dictation-state'));
  }

  function closeDrawer(force = false) {
    if (noteSaving && !force) return;
    const wasOpen = !!pane || !$('planner-drawer').hidden;
    pane = '';
    $('planner-drawer').hidden = true; $('planner-drawer-backdrop').hidden = true;
    $('app').inert = false; document.body.classList.remove('planner-drawer-open');
    for (const id of ['tactics-disclosure', 'practice-ideas', 'session-field-disclosure']) if ($(id)) $(id).open = false;
    for (const id of ['planner-open-notes', 'planner-open-tools', 'planner-open-run', 'planner-focus-date', 'planner-other-date']) $(id)?.setAttribute('aria-expanded', 'false');
    if (wasOpen) document.dispatchEvent(new Event('coach:dictation-stop'));
    document.dispatchEvent(new Event('coach:dictation-state'));
    if (!force && opener?.isConnected && !opener.disabled) opener.focus();
  }
  function openDrawer(next, button) {
    if (unavailable() || locked() || readOnly() && !['notes', 'dates'].includes(next)) return;
    pane = next; opener = button;
    $('planner-drawer').dataset.pane = next;
    $('planner-drawer-title').textContent = ({ dates: 'View other sessions', notes: 'Group & player notes', tools: 'Drills & tactics', run: 'Run this session' })[next];
    for (const name of ['dates', 'notes', 'tools', 'run']) $('planner-' + name + '-pane').hidden = name !== next;
    $('planner-drawer').hidden = false; $('planner-drawer-backdrop').hidden = false;
    $('app').inert = true; document.body.classList.add('planner-drawer-open');
    button.setAttribute('aria-expanded', 'true');
    if (next === 'dates') renderDates();
    if (next === 'notes') renderNotes();
    if (next === 'tools') { $('tactics-disclosure').open = true; $('practice-ideas').open = true; }
    if (next === 'run') $('session-field-disclosure').open = true;
    $('planner-close-drawer').focus();
  }
  async function saveNote(event) {
    event.preventDefault();
    if (unavailable() || locked() || readOnly() || uncertain || !dirty()) return;
    const targetIdentity = identity, playerId = $('planner-notes-player').value || null;
    const payload = { sessionId: current().id, playerId, category: $('planner-note-category').value, body: $('planner-note-body').value.trim() };
    noteSaving = true; $('planner-note-status').textContent = 'Saving private note…'; renderNotes(); $('planner-close-drawer').disabled = true;
    try {
      await new Promise((resolve, reject) => emit('coach:planner-note-save', { payload, resolve, reject }));
      if (identity !== targetIdentity) return;
      resetDraft(); $('planner-notes-player').value = playerId || '';
      $('planner-note-status').textContent = 'Private note saved for ' + label(current().date) + '.';
    } catch (error) {
      if (identity !== targetIdentity) return;
      uncertain = !!error.uncertain;
      $('planner-note-status').textContent = error.message || 'Could not save. Your draft is still here.';
    } finally {
      noteSaving = false; $('planner-close-drawer').disabled = false;
      if (identity === targetIdentity) { renderNotes(); renderDays(); }
    }
  }

  function toggleDatePicker(event) {
    if (locked() || !focusedSession || focusedSession !== current()?.id || context?.tab !== 'plan') return;
    if (pane === 'dates') closeDrawer();
    else openDrawer('dates', event.currentTarget);
  }
  $('planner-other-date').addEventListener('click', toggleDatePicker);
  $('planner-focus-date').addEventListener('click', toggleDatePicker);
  $('planner-back').addEventListener('click', () => requestExit('sessions'));
  $('planner-home').addEventListener('click', () => requestExit('home'));
  $('planner-open-selected').addEventListener('click', () => requestSession(current()?.id));
  $('planner-dates-month').addEventListener('input', () => { dateLimit = 20; renderDates(); });
  $('planner-dates-clear').addEventListener('click', () => { $('planner-dates-month').value = ''; dateLimit = 20; renderDates(); $('planner-dates-month').focus(); });
  $('planner-dates-more').addEventListener('click', () => {
    const previous = dateLimit; dateLimit += 20; renderDates();
    $('planner-dates-past').querySelectorAll('button')[previous]?.focus();
  });
  for (const name of ['notes', 'tools', 'run']) $('planner-open-' + name).addEventListener('click', event => openDrawer(name, event.currentTarget));
  $('planner-close-drawer').addEventListener('click', () => closeDrawer());
  window.addEventListener('coach:return-plan', () => {
    if (context?.tab !== 'plan' || noteSaving) return;
    closeDrawer(); $('plan-focus').focus();
  });
  $('planner-drawer-backdrop').addEventListener('click', () => closeDrawer());
  $('planner-notes-player').addEventListener('change', event => {
    document.dispatchEvent(new Event('coach:dictation-stop'));
    if (dirty() && !confirm('Switch note folders and discard this unsaved note?')) { event.target.value = event.target.dataset.previous || ''; return; }
    resetDraft(); historyLimit = 10; $('planner-notes-search').value = ''; event.target.dataset.previous = event.target.value; renderNotes();
  });
  $('planner-notes-search').addEventListener('input', () => { historyLimit = 10; renderNotes(); });
  $('planner-notes-more').addEventListener('click', () => { historyLimit += 10; renderNotes(); });
  $('planner-note-form').addEventListener('submit', saveNote);
  $('planner-drawer').addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeDrawer(); }
    if (event.key !== 'Tab') return;
    const controls = [...$('planner-drawer').querySelectorAll('button,select,input,textarea,a[href],summary,[tabindex="0"]')].filter(el => !el.disabled && el.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  window.addEventListener('coach:context', event => {
    const next = event.detail || null, nextIdentity = next?.profile ? [next.profile.email, next.profile.role, next.profile.sessionVersion, next.session?.id || ''].join(':') : '';
    if (identity !== nextIdentity) {
      dateLimit = 20; $('planner-dates-month').value = '';
      closeDrawer(true); resetDraft(); historyLimit = 10; $('planner-notes-search').value = ''; $('planner-notes-results').textContent = ''; $('planner-notes-more').hidden = true; $('planner-notes-player').replaceChildren(); $('planner-notes-player').dataset.previous = '';
    }
    identity = nextIdentity; context = next;
    if (!next?.profile) {
      focusedSession = ''; focusEpoch++; closeDatePicker(); renderFocus();
      closeDrawer(true); resetDraft();
      for (const id of ['planner-days', 'planner-session-title', 'planner-session-detail', 'planner-session-mode', 'planner-dates-upcoming', 'planner-dates-past', 'planner-dates-detail', 'planner-dates-count', 'planner-notes-list']) $(id).replaceChildren();
      return;
    }
    if (next.tab !== 'plan') { focusedSession = ''; focusEpoch++; closeDatePicker(); closeDrawer(true); }
    renderDays();
    if (pane === 'notes') renderNotes();
  });
  emit('coach:request-context');
})();
