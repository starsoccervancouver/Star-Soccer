/* Day-first planning and private drawers. Uses only the authorized workspace context. */
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
  const sortSessions = rows => [...rows].sort((a, b) => a.date.localeCompare(b.date) || (startMinute(a) ?? 1440) - (startMinute(b) ?? 1440) || String(a.id).localeCompare(String(b.id)));
  const nextSession = (rows, day = null) => {
    const now = localNow();
    return sortSessions((rows || []).filter(s => {
      if (!usable(s) || day !== null && weekday(s.date) !== Number(day)) return false;
      if (s.startAt && Number.isFinite(Date.parse(s.startAt))) return Date.parse(s.startAt) >= Date.now();
      return s.date > now.date || s.date === now.date && startMinute(s) !== null && startMinute(s) >= now.minute;
    }))[0] || null;
  };
  let context = null, identity = '', pane = '', opener = null, noteSaving = false, uncertain = false;
  const dirty = () => !!$('planner-note-body')?.value.trim();
  const busy = () => noteSaving;
  function resetDraft() {
    $('planner-note-form')?.reset();
    if ($('planner-note-status')) $('planner-note-status').textContent = '';
    uncertain = false;
  }
  window.CoachPlanner = Object.freeze({ nextSession, isDirty: dirty, isBusy: busy, discard: resetDraft });
  const current = () => context?.session;
  const unavailable = () => !context?.profile || !current() || context.tab !== 'plan';
  const locked = () => !!context?.busy || noteSaving;
  const sameGroup = (a, b) => a && b && weekday(a.date) === weekday(b.date) && String(a.time || '').trim() === String(b.time || '').trim() && String(a.location || '').trim() === String(b.location || '').trim();

  function renderDays() {
    const rows = context?.sessions || [], selected = current();
    const days = [...new Set([...(club.trainingDays || [3, 4, 5, 0]), ...rows.filter(usable).filter(s => nextSession([s])).map(s => weekday(s.date))])];
    $('planner-days').replaceChildren(...days.map(day => {
      const next = nextSession(rows, day), button = make('button', '', 'planner-day');
      button.type = 'button'; button.dataset.weekday = String(day);
      button.setAttribute('aria-pressed', String(!!selected && weekday(selected.date) === day));
      button.disabled = locked() || !next;
      button.append(make('strong', ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][day]), make('span', next ? label(next.date).split(', ').slice(1).join(', ') || next.date : 'No upcoming session'));
      if (next) button.append(make('span', next.time || 'Time to confirm', 'planner-day-time'));
      button.addEventListener('click', () => { if (next && !locked()) emit('coach:open-session', { sessionId: next.id, tab: 'plan' }); });
      return button;
    }));
    $('planner-session-title').textContent = selected ? label(selected.date) : 'Choose a training day';
    $('planner-session-detail').textContent = selected ? [selected.time, selected.location].filter(Boolean).join(' · ') : 'No upcoming assigned session. You can still choose a recorded session below.';
    const next = selected && nextSession(rows, weekday(selected.date));
    $('planner-session-mode').textContent = selected ? next?.id === selected.id ? 'Next session for this day' : 'Selected date' : 'No session selected';
    const dates = sortSessions(rows.filter(s => s.status !== 'Cancelled'));
    $('planner-date').replaceChildren(...dates.map(s => { const option = make('option', label(s.date) + ' · ' + s.time + ' · ' + s.location); option.value = s.id; return option; }));
    if (!selected) { const option = make('option', 'Choose a session'); option.value = ''; $('planner-date').prepend(option); }
    $('planner-date').value = selected?.id || '';
    for (const id of ['planner-other-date', 'planner-date']) $(id).disabled = locked() || !dates.length;
    for (const id of ['planner-open-notes', 'planner-open-tools', 'planner-open-run']) $(id).disabled = locked() || !selected;
  }

  function renderNotes() {
    const selected = current(), picker = $('planner-notes-player'), previous = picker.value;
    picker.replaceChildren(new Option('Group notes', ''), ...(selected?.players || []).map(player => new Option(player.name, player.playerId)));
    picker.value = [...picker.options].some(o => o.value === previous) ? previous : '';
    const playerId = picker.value;
    const list = (context?.notes || []).filter(note => {
      if (playerId) return note.player_id === playerId;
      if (note.player_id) return false;
      return note.session_id === selected?.id || sameGroup(selected, context?.sessions?.find(s => s.id === note.session_id));
    }).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const heading = make('p', playerId ? 'Player history across your accessible sessions.' : 'Group history for this training day, time and venue.', 'small');
    const cards = list.map(note => {
      const source = context.sessions.find(s => s.id === note.session_id), card = make('article', '', 'planner-note-card');
      const date = source?.date ? label(source.date) : 'Previous session';
      card.append(make('span', note.category, 'tag'), make('h3', date), make('p', note.body, 'note-body'), make('p', (note.author_email === context.profile.email ? 'Your private note' : note.author_email) + (note.updated_at ? ' · ' + new Intl.DateTimeFormat('en-CA', { timeZone: club.timeZone, month: 'short', day: 'numeric' }).format(new Date(note.updated_at)) : ''), 'small'));
      return card;
    });
    $('planner-notes-list').replaceChildren(heading, ...(cards.length ? cards : [make('p', playerId ? 'No notes for this player yet.' : 'No group notes yet. Add one for this session below.', 'empty-state')]));
    $('planner-note-body').placeholder = playerId ? 'What would help this player in the next session?' : 'What should the coaching group work on next?';
    for (const control of $('planner-note-form').querySelectorAll('input,select,textarea,button')) control.disabled = locked() || unavailable() || uncertain;
    picker.disabled = locked() || unavailable();
  }

  function closeDrawer(force = false) {
    if (noteSaving && !force) return;
    const wasOpen = !!pane || !$('planner-drawer').hidden;
    pane = '';
    $('planner-drawer').hidden = true; $('planner-drawer-backdrop').hidden = true;
    $('app').inert = false; document.body.classList.remove('planner-drawer-open');
    for (const id of ['tactics-disclosure', 'practice-ideas', 'session-field-disclosure']) if ($(id)) $(id).open = false;
    for (const id of ['planner-open-notes', 'planner-open-tools', 'planner-open-run']) $(id)?.setAttribute('aria-expanded', 'false');
    if (wasOpen) document.dispatchEvent(new Event('coach:dictation-stop'));
    if (!force && opener?.isConnected && !opener.disabled) opener.focus();
  }
  function openDrawer(next, button) {
    if (unavailable() || locked()) return;
    pane = next; opener = button;
    $('planner-drawer').dataset.pane = next;
    $('planner-drawer-title').textContent = ({ notes: 'Group & player notes', tools: 'Drills & tactics', run: 'Run this session' })[next];
    for (const name of ['notes', 'tools', 'run']) $('planner-' + name + '-pane').hidden = name !== next;
    $('planner-drawer').hidden = false; $('planner-drawer-backdrop').hidden = false;
    $('app').inert = true; document.body.classList.add('planner-drawer-open');
    button.setAttribute('aria-expanded', 'true');
    if (next === 'notes') renderNotes();
    if (next === 'tools') { $('tactics-disclosure').open = true; $('practice-ideas').open = true; }
    if (next === 'run') $('session-field-disclosure').open = true;
    $('planner-close-drawer').focus();
  }
  async function saveNote(event) {
    event.preventDefault();
    if (unavailable() || locked() || uncertain || !dirty()) return;
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

  $('planner-other-date').addEventListener('click', () => {
    const open = $('planner-date-options').hidden;
    $('planner-date-options').hidden = !open; $('planner-other-date').setAttribute('aria-expanded', String(open));
    if (open) $('planner-date').focus();
  });
  $('planner-date').addEventListener('change', () => {
    if (!locked()) emit('coach:open-session', { sessionId: $('planner-date').value, tab: 'plan' });
    renderDays();
  });
  for (const name of ['notes', 'tools', 'run']) $('planner-open-' + name).addEventListener('click', event => openDrawer(name, event.currentTarget));
  $('planner-close-drawer').addEventListener('click', () => closeDrawer());
  $('planner-drawer-backdrop').addEventListener('click', () => closeDrawer());
  $('planner-notes-player').addEventListener('change', event => {
    if (dirty() && !confirm('Switch note folders and discard this unsaved note?')) { event.target.value = event.target.dataset.previous || ''; return; }
    resetDraft(); event.target.dataset.previous = event.target.value; renderNotes();
  });
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
      closeDrawer(true); resetDraft(); $('planner-notes-player').replaceChildren(); $('planner-notes-player').dataset.previous = '';
    }
    identity = nextIdentity; context = next;
    if (!next?.profile) {
      closeDrawer(true); resetDraft();
      for (const id of ['planner-days', 'planner-session-title', 'planner-session-detail', 'planner-session-mode', 'planner-date', 'planner-notes-list']) $(id).replaceChildren();
      return;
    }
    if (next.tab !== 'plan') closeDrawer(true);
    renderDays();
    if (pane === 'notes') renderNotes();
  });
  emit('coach:request-context');
})();
