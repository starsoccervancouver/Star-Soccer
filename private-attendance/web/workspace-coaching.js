/* Coach preparation tools. All records arrive from the already-authorized workspace. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const element = (tag, text = '', className = '') => {
    const el = document.createElement(tag);
    el.textContent = String(text ?? '');
    if (className) el.className = className;
    return el;
  };
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const validDate = date => {
    if (!datePattern.test(date || '')) return false;
    const parsed = new Date(date + 'T12:00:00Z');
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: window.CoachClub?.timeZone || 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const dateLabel = date => validDate(date) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(date + 'T12:00:00Z')) : 'Date not recorded';
  const empty = text => element('p', text, 'empty-state');
  let context = null;
  let playerId = '';
  let ageFilter = 'all';
  let skillFilter = 'all';
  let copySource = '';
  let copyGroup = '';
  const groupSessions = () => Array.isArray(context?.groupSessions) ? context.groupSessions : [];
  const authorizedGroups = () => window.CoachGroups?.groups(context?.sessions || []) || [];

  // Original starter activities, intended for coach adaptation rather than a fixed curriculum.
  const drills = [
    { id: 'traffic', title: 'Move, turn, find space', skill: 'Ball control', minAge: 5, maxAge: 8, minutes: 8, target: 'warmup',
      setup: 'Mark a safe square with a ball for each player. Players move into empty space and try a different turn when the coach gives a signal.',
      coaching: 'Start slowly. Encourage small touches, a look up before changing direction, and enough space between players.',
      progression: 'Invite players to choose a turn and explain when it helps them keep the ball.', equipment: 'One ball per player; cones to mark a safe square.' },
    { id: 'gates', title: 'Find a passing gate', skill: 'Passing', minAge: 5, maxAge: 99, minutes: 10, target: 'technical',
      setup: 'Set out several wide cone gates. In pairs, players find a clear gate, pass through it, then move together to another gate.',
      coaching: 'Let players choose a comfortable distance. Look at the receiver, use a controlled pass and prepare the next touch.',
      progression: 'Ask the receiver to move to a new angle before the next pass. Adjust gate width to the group.', equipment: 'One ball per pair; pairs of cones for wide passing gates.' },
    { id: 'receive', title: 'Receive into a new space', skill: 'First touch', minAge: 9, maxAge: 99, minutes: 12, target: 'technical',
      setup: 'Work in small groups with a passer, receiver and two exit gates. The receiver checks the available space before receiving, then guides the first touch toward an open gate.',
      coaching: 'Encourage an early look, a comfortable receiving position and a first touch that stays close enough for the next action.',
      progression: 'Add light, controlled pressure only when players are ready; keep both exit options available.', equipment: 'Balls; cones for two wide exit gates per group; bibs for optional light pressure.' },
    { id: 'support', title: 'Pass and offer a new angle', skill: 'Decision making', minAge: 5, maxAge: 99, minutes: 10, target: 'game',
      setup: 'Use a small playing area with two teams and neutral helpers if needed. After passing, players look for a new supporting position.',
      coaching: 'Ask where the next passing option could be. Help players make the area larger or smaller to match the group.',
      progression: 'Give the team a choice of two target areas so players can decide where there is more space.', equipment: 'One active ball and spare balls; cones; two colours of bibs.' },
    { id: 'transition', title: 'Find the next target', skill: 'Decision making', minAge: 9, maxAge: 99, minutes: 12, target: 'game',
      setup: 'Play a small-sided game with a target at each end. When possession changes, players look for a safe first action and teammates offer support.',
      coaching: 'Pause briefly when useful to ask what players saw. Keep the playing numbers and space appropriate to the group.',
      progression: 'Add a second target at each end to create a choice of direction. Keep the main focus on noticing space and supporting teammates.', equipment: 'Balls; cones or appropriate goals; two colours of bibs.' },
  ];

  function button(text, action, { primary = false, label = '' } = {}) {
    const result = element('button', text, primary ? 'button' : 'secondary');
    result.type = 'button';
    result.disabled = !!context?.busy;
    if (label) result.setAttribute('aria-label', label);
    result.addEventListener('click', () => { if (context && !context.busy) action(); });
    return result;
  }

  function heading(target, eyebrow, title, copy) {
    target.append(element('p', eyebrow, 'eyebrow'), element('h2', title));
    if (copy) target.append(element('p', copy, 'small'));
  }

  function visiblePlayers() {
    const result = new Map();
    for (const session of groupSessions()) {
      for (const player of session.players || []) {
        if (player.playerId && !result.has(player.playerId)) result.set(player.playerId, player);
      }
    }
    return [...result.values()].sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }

  function renderHub() {
    const target = $('coaching-hub');
    if (!target) return;
    target.replaceChildren();
    if (!context) return;
    target.className = 'card coaching-hub';
    const start = today(), groups = authorizedGroups();
    heading(target, 'Your training groups', 'Choose a group', 'Open the group to prepare a session, check attendance or find a player’s notes.');
    const agenda = element('div', '', 'coaching-agenda');
    const camps = element('section', '', 'coach-camps-section'); camps.setAttribute('aria-label', 'Camps');
    camps.append(element('h3', 'Camps', 'coach-camps-heading'));
    const campCards = element('div', '', 'coaching-agenda'); camps.append(campCards);
    for (const group of groups) {
      const members = group.sessions.filter(session => validDate(session.date) && session.status !== 'Cancelled');
      const next = window.CoachPlanner?.nextSession ? window.CoachPlanner.nextSession(members) : members.find(session => session.date >= start);
      const session = next || members.at(-1) || group.sessions.filter(session => validDate(session.date)).at(-1);
      const row = element('article', '', 'coaching-agenda-row' + (group.sessionIds.includes(context.selected) ? ' is-current' : ''));
      row.dataset.groupKey = group.key;
      const details = element('div', '', 'coaching-agenda-details');
      details.append(element('h3', group.label));
      details.append(element('p', session ? (next ? 'Next session: ' : 'Most recent session: ') + dateLabel(session.date) : 'No active session recorded', 'small'));
      const actions = element('div', '', 'coaching-inline-actions');
      const open = button(group.kind === 'camp' ? 'Choose camp day' : 'Open group', () => { if (session) emit('coach:open-session', { sessionId: session.id, tab: 'plan', workspaceView: 'attendance', resolve: accepted => { if (accepted && group.kind === 'camp') $('planner-focus-date').click(); } }); }, { primary: true, label: 'Open group: ' + group.label });
      if (!session) open.disabled = true;
      actions.append(open);
      row.append(details, actions);
      (group.kind === 'camp' ? campCards : agenda).append(row);
    }
    target.append(agenda);
    if (campCards.children.length) target.append(camps);
    window.CoachViews?.mount(target, 'overview', { groups, locked:!!context.busy, onOpen:sessionId => emit('coach:open-session', { sessionId, tab:'plan', workspaceView:'attendance' }) });
    if (!groups.length) target.append(empty('No assigned training groups are available.'));
    const due = (context.notes || []).filter(note => validDate(note.review_date) && note.review_date <= start);
    if (due.length && !$('home-priorities')) {
      const review = element('div', '', 'coaching-review-alert');
      review.append(element('strong', due.length + ' note' + (due.length === 1 ? '' : 's') + ' ready for review'), element('p', 'Based on review dates you or an approved coach recorded. Open player notes to choose the next step.', 'small'));
      if (context.selected) review.append(button('Review player notes', () => emit('coach:open-session', { sessionId: context.selected, tab: 'notes' })));
      target.append(review);
    }
  }

  function renderDevelopment() {
    const target = $('player-development');
    if (!target) return;
    target.replaceChildren();
    if (!context) return;
    target.className = 'card player-development';
    heading(target, 'Player development', 'A useful player picture', 'Attendance history and saved observations within this training group.');
    const scopedSessions = groupSessions(), memberIds = new Set(scopedSessions.map(session => session.id));
    if (!scopedSessions.length) return target.append(empty('Open a training group to see its player folders and history.'));
    const players = visiblePlayers();
    if (!players.length) return target.append(empty('Player profiles appear when your assigned rosters contain named players.'));
    const selectedPlayer = players.find(player => player.playerId === context.noteFolder);
    playerId = selectedPlayer?.playerId || '';
    if (!selectedPlayer) return target.append(empty('Open a player’s folder above to see their notes and attendance history.'));
    target.append(element('h3', selectedPlayer.name || 'Named player'));
    const observations = (context.notes || []).filter(note => note.player_id === playerId && memberIds.has(note.session_id)).sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
    const seen = new Set();
    const history = [];
    for (const session of scopedSessions) {
      if (!validDate(session.date) || session.date > today() || session.status === 'Cancelled' || seen.has(session.id)) continue;
      const row = (session.players || []).find(player => player.playerId === playerId);
      if (!row) continue;
      seen.add(session.id);
      history.push({ session, row });
    }
    history.sort((a, b) => b.session.date.localeCompare(a.session.date) || String(b.session.time || '').localeCompare(String(a.session.time || '')));
    const summary = element('div', '', 'development-summary');
    for (const [status, title] of [['Present', 'Marked present'], ['Absent', 'Marked absent'], ['Not marked', 'Not marked']]) {
      const stat = element('div');
      stat.append(element('span', title), element('strong', history.filter(item => (item.row.actualAttendance || 'Not marked') === status).length));
      summary.append(stat);
    }
    target.append(summary, element('p', 'Only recorded physical attendance is shown. An unmarked session is not an absence; parent replies are separate.', 'small'));
    const currentSession = memberIds.has(context.session?.id) && context.session?.status !== 'Cancelled' && context.session?.players?.some(player => player.playerId === playerId) ? context.session : scopedSessions.filter(session => session.status !== 'Cancelled' && (session.players || []).some(player => player.playerId === playerId)).sort((a, b) => b.date.localeCompare(a.date))[0];
    const selectedPlayerId = playerId;
    if (currentSession) target.append(button('Add a note for ' + (selectedPlayer?.name || 'this player'), () => emit('coach:add-note', { sessionId: currentSession.id, playerId: selectedPlayerId }), { primary: true }));
    const columns = element('div', '', 'development-columns');
    const notes = element('section');
    notes.append(element('h3', 'Recent coaching observations'));
    if (!observations.length) notes.append(empty('No saved observations for this player yet.'));
    for (const note of observations.slice(0, 5)) {
      const card = element('article', '', 'development-observation');
      card.append(element('span', note.category || 'General', 'tag'), element('p', note.body || '', 'note-body'));
      const meta = [];
      if (note.updated_at) {
        const stamp = new Date(note.updated_at);
        if (!Number.isNaN(stamp.getTime())) {
          const date = new Intl.DateTimeFormat('en-CA', { timeZone: window.CoachClub?.timeZone || 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(stamp);
          meta.push('Saved ' + dateLabel(date));
        }
      }
      if (note.review_date && validDate(note.review_date)) meta.push('Review ' + dateLabel(note.review_date));
      card.append(element('p', meta.join(' · '), 'small'));
      notes.append(card);
    }
    const attendance = element('section');
    attendance.append(element('h3', 'Recent dated attendance'));
    if (!history.length) attendance.append(empty('No current or past dated attendance records are available.'));
    const list = element('ol', '', 'development-attendance');
    for (const item of history.slice(0, 8)) {
      const row = element('li');
      const status = ['Present', 'Absent'].includes(item.row.actualAttendance) ? item.row.actualAttendance : 'Not marked';
      row.append(element('span', dateLabel(item.session.date)), element('span', status, 'attendance-status ' + ({ Present: 'status-present', Absent: 'status-absent', 'Not marked': 'status-unmarked' })[status]));
      list.append(row);
    }
    attendance.append(list);
    columns.append(notes, attendance);
    target.append(columns);
  }

  function renderToolbox() {
    const target = $('practice-toolbox');
    if (!target) return;
    target.replaceChildren();
    if (!context) return;
    target.className = 'card practice-toolbox';
    heading(target, 'Build the session', 'Practice ideas & reuse', 'Original starting points to adapt to your players. Insertions change only the draft; review and choose Save shared plan when ready.');
    const locked = !!context.busy || !context.planReady || !context.selected;
    const filters = element('div', '', 'practice-toolbox-filters');
    for (const [id, title, values, current, change] of [
      ['drill-age', 'Age group', [['all', 'All ages'], ['young', 'Ages 5–8'], ['youth', 'Ages 9–14'], ['older', 'Ages 15+']], ageFilter, value => { ageFilter = value; }],
      ['drill-skill', 'Skill focus', [['all', 'All focuses'], ['Ball control', 'Ball control'], ['Passing', 'Passing'], ['First touch', 'First touch'], ['Decision making', 'Decision making']], skillFilter, value => { skillFilter = value; }],
    ]) {
      const label = element('label', title);
      label.htmlFor = id;
      const select = element('select');
      select.id = id;
      select.setAttribute('aria-label', title);
      for (const [value, text] of values) {
        const option = element('option', text);
        option.value = value;
        select.append(option);
      }
      select.value = current;
      select.disabled = !!context.busy;
      select.addEventListener('change', () => { change(select.value); renderToolbox(); });
      label.append(select);
      filters.append(label);
    }
    target.append(filters);
    const matching = drills.filter(drill => (skillFilter === 'all' || drill.skill === skillFilter) && (ageFilter === 'all' || ageFilter === 'young' && drill.minAge <= 8 && drill.maxAge >= 5 || ageFilter === 'youth' && drill.minAge <= 14 && drill.maxAge >= 9 || ageFilter === 'older' && drill.maxAge >= 15));
    const activities = element('div', '', 'practice-activities');
    for (const drill of matching) {
      const card = element('details', '', 'practice-activity');
      card.dataset.drillId = drill.id;
      const summary = element('summary');
      summary.append(element('strong', drill.title), element('span', drill.skill + ' · ' + drill.minutes + ' min starting point', 'small'));
      card.append(summary, element('p', drill.setup), element('p', 'Coach: ' + drill.coaching), element('p', 'Adapt: ' + drill.progression));
      const actions = element('div', '', 'coaching-inline-actions');
      const names = { warmup: 'warm-up', technical: 'technical activity', game: 'game / application' };
      const text = drill.title + ' (' + drill.minutes + ' min starting point)\n' + drill.setup + '\nCoach: ' + drill.coaching + '\nAdapt: ' + drill.progression;
      const add = button('Add to ' + names[drill.target], () => emit('coach:insert-plan', { target: drill.target, text }));
      const equipment = button('Add equipment', () => emit('coach:insert-plan', { target: 'equipment', text: drill.equipment }));
      const save = button('Save to drill archive', () => emit('coach:library-prefill', { sessionId: context.selected, drill: { title: drill.title, skill: drill.skill, minutes: drill.minutes, target: drill.target, setup: drill.setup, coaching: drill.coaching, progression: drill.progression, equipment: drill.equipment } }));
      add.disabled = equipment.disabled = save.disabled = locked;
      actions.append(add, equipment, save);
      card.append(actions);
      activities.append(card);
    }
    target.append(element('p', matching.length + ' activit' + (matching.length === 1 ? 'y' : 'ies') + ' match', 'small'), activities);
    if (!matching.length) target.append(empty('No starter activities match these filters. Try another focus or age group.'));
    const reuse = element('section', '', 'practice-reuse');
    reuse.append(element('h3', 'Reuse a group’s session plan'), element('p', 'Choose a training group, then a date to copy its saved plan into this draft. The source plan stays unchanged and its after-session reflection is left behind.', 'small'));
    const sourceGroups = authorizedGroups().filter(group => group.sessions.some(session => session.id !== context.selected && session.status !== 'Cancelled' && validDate(session.date)));
    if (!sourceGroups.some(group => group.key === copyGroup)) copyGroup = '';
    const groupLabel = element('label', 'Training group to reuse');
    groupLabel.htmlFor = 'copy-plan-group';
    const groupSelect = element('select');
    groupSelect.id = 'copy-plan-group';
    groupSelect.setAttribute('aria-label', 'Training group to reuse');
    const groupPlaceholder = element('option', 'Choose a training group');
    groupPlaceholder.value = '';
    groupSelect.append(groupPlaceholder);
    for (const group of sourceGroups) {
      const option = element('option', group.label);
      option.value = group.key;
      groupSelect.append(option);
    }
    groupSelect.value = copyGroup;
    groupSelect.disabled = locked || !sourceGroups.length;
    groupSelect.addEventListener('change', () => {
      if (locked) return;
      copyGroup = sourceGroups.some(group => group.key === groupSelect.value) ? groupSelect.value : '';
      copySource = '';
      renderToolbox();
    });
    groupLabel.append(groupSelect);
    const selectedGroup = sourceGroups.find(group => group.key === copyGroup);
    const candidates = (selectedGroup?.sessions || []).filter(session => session.id !== context.selected && session.status !== 'Cancelled' && validDate(session.date)).sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
    if (!candidates.some(session => session.id === copySource)) copySource = '';
    const label = element('label', 'Date to reuse');
    label.htmlFor = 'copy-plan-source';
    const select = element('select');
    select.id = 'copy-plan-source';
    select.setAttribute('aria-label', 'Date to reuse');
    const placeholder = element('option', copyGroup ? 'Choose a recorded date' : 'Choose a group first');
    placeholder.value = '';
    select.append(placeholder);
    for (const session of candidates) {
      const option = element('option', dateLabel(session.date));
      option.value = session.id;
      select.append(option);
    }
    select.value = copySource;
    select.disabled = locked || !candidates.length;
    const copy = button('Copy plan to draft', () => { if (!locked && candidates.some(session => session.id === copySource)) emit('coach:copy-plan', { sourceSessionId: copySource }); });
    copy.disabled = locked || !copySource;
    select.addEventListener('change', () => { if (locked) return; copySource = candidates.some(session => session.id === select.value) ? select.value : ''; copy.disabled = locked || !copySource; });
    label.append(select);
    reuse.append(groupLabel, label, copy);
    if (!context.planReady) reuse.append(element('p', 'Choose a session and wait for its plan to load before adding activities or copying a plan.', 'small'));
    target.append(reuse);
  }

  function render() {
    renderHub();
    renderDevelopment();
    renderToolbox();
  }

  window.addEventListener('coach:context', event => {
    const next = event.detail && event.detail.profile ? event.detail : null;
    const identity = value => value?.profile ? [value.profile.email, value.profile.role, value.profile.sessionVersion].join('|') : '';
    if (identity(context) !== identity(next)) playerId = copySource = copyGroup = '';
    context = next;
    if (!context) {
      playerId = copySource = copyGroup = '';
      ageFilter = skillFilter = 'all';
    }
    render();
  });
  emit('coach:request-context', {});
})();
