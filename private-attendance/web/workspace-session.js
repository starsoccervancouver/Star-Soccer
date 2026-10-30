/* Read-only, on-field preparation. Never marks attendance or persists roster data. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const node = (tag, text = '', className = '') => {
    const element = document.createElement(tag);
    element.textContent = String(text ?? '');
    if (className) element.className = className;
    return element;
  };
  const legacyStages = [
    { key: 'warmup', title: 'Warm-up', minutes: 10 },
    { key: 'technical', title: 'Technical activity', minutes: 20 },
    { key: 'game', title: 'Game / application', minutes: 20 },
  ];
  let stages = legacyStages;
  const stageLabels = { warmup: 'Warm-up', technical: 'Technical', game: 'Game / application', other: 'Break / other' };
  const defaults = () => stages.map(stage => stage.minutes);
  let context = null, identity = '', stageIndex = 0, durations = defaults();
  let remaining = durations[0] * 60000, running = false, startedAt = 0, timer = null;
  let timerMessage = 'Ready when you are.', contentSignature = '';
  const mount = $('session-field-tools');
  if (!mount) return;

  const dialog = node('dialog', '', 'field-view');
  dialog.id = 'session-field-view';
  dialog.setAttribute('aria-labelledby', 'field-view-title');
  document.body.append(dialog);
  const sheet = node('section', '', 'session-print-sheet');
  sheet.id = 'session-print-sheet';
  sheet.setAttribute('aria-label', 'Private printable session plan and roster');
  document.body.append(sheet);

  const clubName = () => window.CoachClub?.name || 'Star Soccer';
  const active = () => !!context?.profile && !!context.session && context.selected === context.session.id && context.tab === 'plan' && context.planReady && !context.busy && context.session.status !== 'Cancelled';
  const content = () => context?.plan?.content || {};
  const hasActivities = () => Array.isArray(content().activities) && content().activities.length > 0;
  const savedStages = () => hasActivities() ? content().activities.map((block, index) => ({ key: 'activity-' + index, title: block.title, minutes: block.duration, instructions: block.instructions, equipment: block.equipment, stage: block.stage })) : legacyStages;
  function recordedMinutes() {
    const session = context?.session;
    if (!session) return null;
    const start = Date.parse(session.startAt), end = Date.parse(session.endAt);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      const minutes = (end - start) / 60000;
      return Number.isInteger(minutes) && minutes > 0 && minutes <= 1440 ? minutes : null;
    }
    const parts = String(session.time || '').toLowerCase().replace(/\b(?:12(?::00)?\s*)?noon\b/g, '12:00 pm').split(/[–—-]/);
    if (parts.length !== 2) return null;
    const parse = value => {
      const match = value.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
      if (!match || Number(match[2] || 0) > 59 || Number(match[1]) > (match[3] ? 12 : 23) || (match[3] && Number(match[1]) < 1)) return null;
      return { hour: Number(match[1]), minute: Number(match[2] || 0), period: match[3] || '' };
    };
    const from = parse(parts[0]), to = parse(parts[1]);
    if (!from || !to) return null;
    const minutes = value => (value.period ? value.hour % 12 + (value.period === 'pm' ? 12 : 0) : value.hour) * 60 + value.minute;
    const inherited = !from.period && !!to.period && from.hour >= 1 && from.hour <= 12;
    if (inherited) from.period = to.period;
    let first = minutes(from), last = minutes(to);
    if (inherited && first > last && to.period === 'pm') first -= 720;
    const duration = last - first;
    return duration > 0 && duration <= 720 ? duration : null;
  }
  function renderBudgets() {
    const total = durations.reduce((sum, minutes) => sum + minutes, 0), slot = recordedMinutes(), difference = slot === null ? null : slot - total;
    const text = slot === null ? 'Session length not recorded · ' + total + ' minutes in stage timers.' : slot + '-minute recorded session · ' + total + ' minutes in stage timers · ' + (difference > 0 ? difference + ' minutes left for breaks or transitions.' : difference < 0 ? Math.abs(difference) + ' minutes over the recorded session.' : 'Stage timers fit the recorded session.');
    for (const element of document.querySelectorAll('.field-time-budget')) {
      if (element.textContent !== text) element.textContent = text;
      element.classList.toggle('is-over-budget', difference !== null && difference < 0);
    }
  }
  function budget(id) {
    const element = node('p', '', 'field-time-budget');
    element.id = id;
    element.setAttribute('role', 'status');
    return element;
  }
  function unsavedWarning(id) {
    const warning = node('section', '', 'field-unsaved-warning');
    warning.id = id;
    warning.hidden = !context?.planDirty;
    if (warning.hidden) return warning;
    warning.append(node('strong', 'Your latest plan edits are not saved.'), node('p', 'Field view and printed sheets use your last saved plan. Return to the plan to save your changes first.'));
    warning.append(makeButton('Return to plan', id + '-return', () => { closeField(); window.dispatchEvent(new CustomEvent('coach:return-plan')); }));
    return warning;
  }
  const readableDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return 'Date not recorded';
    const date = new Date(value + 'T12:00:00Z');
    return Number.isNaN(date.getTime()) ? 'Date not recorded' : new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(date);
  };
  const makeButton = (text, id, action, primary = false) => {
    const button = node('button', text, primary ? 'button' : 'secondary');
    button.type = 'button';
    button.id = id;
    button.addEventListener('click', action);
    return button;
  };
  const currentMilliseconds = () => running ? Math.max(0, remaining - (performance.now() - startedAt)) : remaining;
  const displayTime = value => {
    const seconds = Math.max(0, Math.ceil(value / 1000));
    return Math.floor(seconds / 60).toString().padStart(2, '0') + ':' + (seconds % 60).toString().padStart(2, '0');
  };

  function clearPrint() {
    document.body.classList.remove('printing-session-sheet');
    sheet.replaceChildren();
  }

  function pause(message = 'Timer paused.') {
    if (running) remaining = currentMilliseconds();
    running = false;
    if (timer) clearInterval(timer);
    timer = null;
    timerMessage = message;
    renderTimer();
  }

  function resetTimer(message = 'Ready when you are.') {
    pause(message);
    remaining = durations[stageIndex] * 60000;
    renderTimer();
  }

  function closeField() {
    if (dialog.open) dialog.close();
    pause('Timer paused.');
    document.body.classList.remove('field-view-open');
  }

  function tick() {
    if (running && currentMilliseconds() <= 0) {
      remaining = 0;
      running = false;
      clearInterval(timer);
      timer = null;
      timerMessage = 'Time reached. Move to the next activity when your players are ready.';
    }
    renderTimer();
  }

  function startOrPause() {
    if (!active() || !dialog.open || document.hidden) return;
    if (running) return pause();
    if (remaining <= 0) remaining = durations[stageIndex] * 60000;
    running = true;
    startedAt = performance.now();
    timerMessage = 'Timer running. Pauses when you leave this view or switch apps.';
    timer = setInterval(tick, 250);
    renderTimer();
  }

  function renderTimer() {
    if (!$('field-timer-output')) return;
    $('field-timer-output').textContent = displayTime(currentMilliseconds());
    $('field-timer-toggle').textContent = running ? 'Pause timer' : 'Start timer';
    $('field-timer-toggle').setAttribute('aria-pressed', String(running));
    $('field-timer-status').textContent = timerMessage;
    $('field-timer-minutes').disabled = running;
    $('field-stage-label').textContent = stages[stageIndex].title;
    const stage = stages[stageIndex];
    $('field-stage-content').textContent = hasActivities() ? [stageLabels[stage.stage] + ' · ' + stage.minutes + ' minutes saved', stage.instructions || 'No instructions saved yet.', stage.equipment ? 'Equipment: ' + stage.equipment : ''].filter(Boolean).join('\n\n') : String(content()[stage.key] || '').trim() || 'No activity has been saved for this stage yet.';
    $('field-timer-total').textContent = hasActivities() ? 'Timers start from saved activity durations. Adjustments here apply to this visit only.' : 'Adjust each stage for this visit. Timer choices do not change the saved plan.';
    renderBudgets();
    for (const [index, button] of [...dialog.querySelectorAll('[data-field-stage]')].entries()) {
      button.setAttribute('aria-pressed', String(index === stageIndex));
      button.classList.toggle('is-active', index === stageIndex);
    }
  }

  function rosterTable() {
    const table = node('table', '', 'field-roster-table'), thead = node('thead'), row = node('tr'), tbody = node('tbody');
    for (const label of ['Player', 'Preparation', 'Recorded attendance']) row.append(node('th', label));
    thead.append(row);
    for (const player of context?.session?.players || []) {
      const entry = node('tr');
      entry.append(node('td', player.name || 'Unnamed player'), node('td', player.status || 'Not yet asked'), node('td', ['Present', 'Absent'].includes(player.actualAttendance) ? player.actualAttendance : 'Not marked'));
      tbody.append(entry);
    }
    table.append(thead, tbody);
    return table;
  }

  function renderDialog() {
    dialog.replaceChildren();
    const header = node('header', '', 'field-view-heading'), heading = node('div');
    heading.append(node('p', clubName() + ' · On the field', 'eyebrow'));
    const title = node('h2', readableDate(context.session.date));
    title.id = 'field-view-title';
    heading.append(title, node('p', [context.session.time, context.session.location].filter(Boolean).join(' · '), 'small'));
    header.append(heading, makeButton('Close field view', 'close-field-view', closeField));
    dialog.append(header, unsavedWarning('field-dialog-unsaved-warning'), node('p', 'Saved plan only. This view never changes attendance or your saved plan.', 'field-saved-notice'), budget('field-time-budget'));
    const focus = node('section', '', 'field-focus');
    focus.append(node('span', 'Session focus', 'eyebrow'), node('p', String(content().focus || '').trim() || 'No session focus saved yet.'));
    dialog.append(focus);

    const grid = node('div', '', 'field-stage-grid'), activity = node('section', '', 'field-activity');
    const stageButtons = node('div', '', 'field-stages');
    stageButtons.setAttribute('role', 'group');
    stageButtons.setAttribute('aria-label', 'Session stage');
    stages.forEach((stage, index) => {
      const button = makeButton((index + 1) + '. ' + stage.title, 'field-stage-' + stage.key, () => {
        if (!active() || stageIndex === index) return;
        stageIndex = index;
        resetTimer('New stage selected. Start the timer when ready.');
        $('field-timer-minutes').value = durations[stageIndex];
      });
      button.dataset.fieldStage = stage.key;
      stageButtons.append(button);
    });
    const stageTitle = node('h3');
    stageTitle.id = 'field-stage-label';
    const stageBody = node('p', '', 'field-stage-copy');
    stageBody.id = 'field-stage-content';
    activity.append(stageButtons, stageTitle, stageBody);
    const timerPanel = node('section', '', 'field-timer');
    timerPanel.setAttribute('aria-label', 'Optional activity timer');
    const output = node('output');
    output.id = 'field-timer-output';
    output.setAttribute('aria-live', 'off');
    output.setAttribute('aria-label', 'Time remaining');
    const label = node('label', 'Timer duration (minutes)');
    label.htmlFor = 'field-timer-minutes';
    const minutes = node('input');
    minutes.id = 'field-timer-minutes';
    minutes.type = 'number';
    minutes.min = '1';
    minutes.max = '120';
    minutes.step = '1';
    minutes.inputMode = 'numeric';
    minutes.value = String(durations[stageIndex]);
    minutes.addEventListener('change', () => {
      const next = Number(minutes.value);
      if (!Number.isInteger(next) || next < 1 || next > 120) {
        minutes.value = String(durations[stageIndex]);
        timerMessage = 'Choose a whole number from 1 to 120 minutes.';
        return renderTimer();
      }
      durations[stageIndex] = next;
      resetTimer('Timer duration updated for this visit. The saved plan is unchanged.');
    });
    label.append(minutes);
    const actions = node('div', '', 'field-timer-actions');
    actions.append(makeButton('Start timer', 'field-timer-toggle', startOrPause, true), makeButton('Reset', 'field-timer-reset', () => resetTimer('Timer reset. Start when ready.')));
    const status = node('p', '', 'small');
    status.id = 'field-timer-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    const total = node('p', '', 'small');
    total.id = 'field-timer-total';
    timerPanel.append(node('p', 'Optional stage timer', 'eyebrow'), output, label, actions, status, total);
    grid.append(activity, timerPanel);
    dialog.append(grid);
    const preparation = node('section', '', 'field-equipment');
    preparation.append(node('h3', 'Equipment & setup'), node('p', String(content().equipment || '').trim() || 'No equipment list saved yet.'));
    if (hasActivities()) {
      const notes = node('details', '', 'field-roster');
      notes.append(node('summary', 'Supporting stage coaching notes'));
      for (const stage of legacyStages) if (String(content()[stage.key] || '').trim()) notes.append(node('h3', stage.title), node('p', content()[stage.key], 'field-stage-copy'));
      preparation.append(notes);
    }
    const roster = node('details', '', 'field-roster');
    roster.append(node('summary', 'Session roster · ' + (context.session.players || []).length + ' named players'), node('p', 'Parent replies help you prepare. Check players in from Attendance only after checking they are there.', 'small'), rosterTable());
    if (!context.session.players?.length) roster.append(node('p', 'No named players recorded for this session.', 'small'));
    dialog.append(preparation, roster, makeButton('Print session sheet', 'field-print-session', printSession));
    renderTimer();
  }

  function printSession() {
    if (!active()) return;
    pause('Timer paused for printing.');
    sheet.replaceChildren();
    sheet.append(node('p', clubName() + ' · Private session preparation'), node('h1', readableDate(context.session.date)), node('p', [context.session.time, context.session.location].filter(Boolean).join(' · ')));
    sheet.append(node('p', 'Saved plan and full named roster. Parent replies and physical attendance are separate.'));
    if (context.planDirty) sheet.append(node('p', 'Saved version: unsaved plan edits are not included in this sheet.'));
    const focus = node('section'); focus.append(node('h2', 'Session focus'), node('p', String(content().focus || '').trim() || 'Not recorded in the saved plan.')); sheet.append(focus);
    if (hasActivities()) {
      const total = content().activities.reduce((sum, block) => sum + block.duration, 0), slot = recordedMinutes();
      sheet.append(node('h2', 'Activity running order'), node('p', total + ' minutes planned' + (slot === null ? ' · Session length not recorded.' : ' / ' + slot + '-minute session' + (total > slot ? ' · ' + (total - slot) + ' minutes over.' : '.'))));
      content().activities.forEach((block, index) => { const section = node('section'); section.append(node('h3', (index + 1) + '. ' + block.title + ' · ' + block.duration + ' min · ' + stageLabels[block.stage]), node('p', block.instructions || 'No instructions recorded.')); if (block.equipment) section.append(node('p', 'Equipment: ' + block.equipment)); sheet.append(section); });
    }
    for (const [key, label] of [['warmup', 'Warm-up'], ['technical', 'Technical activity'], ['game', 'Game / application'], ['equipment', 'Equipment & setup']]) {
      const section = node('section');
      if (hasActivities() && key !== 'equipment' && !String(content()[key] || '').trim()) continue;
      section.append(node('h2', label + (hasActivities() && key !== 'equipment' ? ' · supporting notes' : '')), node('p', String(content()[key] || '').trim() || 'Not recorded in the saved plan.'));
      sheet.append(section);
    }
    sheet.append(node('h2', 'Session roster'), rosterTable());
    if (!context.session.players?.length) sheet.append(node('p', 'No named players recorded for this session.'));
    document.body.classList.add('printing-session-sheet');
    try { window.print(); } catch {
      clearPrint();
      timerMessage = 'The print dialog could not open. Please try your browser again.';
      renderTimer();
    }
  }

  function openField() {
    if (!active()) return;
    document.dispatchEvent(new Event('coach:dictation-stop'));
    renderDialog();
    dialog.showModal();
    document.body.classList.add('field-view-open');
    $('close-field-view').focus();
  }

  function renderEntry() {
    mount.replaceChildren();
    if (!context?.profile) return;
    mount.append(unsavedWarning('field-unsaved-warning'), node('p', 'Take the saved session plan to the field, use an optional activity timer, or print the plan and full roster.', 'small'));
    if (context.session) mount.append(budget('field-time-budget-entry'));
    const actions = node('div', '', 'field-entry-actions');
    const open = makeButton('Open field view', 'open-field-view', openField, true);
    const print = makeButton('Print session sheet', 'print-session-sheet', printSession);
    open.disabled = print.disabled = !active();
    actions.append(open, print);
    mount.append(actions);
    if (!context.planReady) mount.append(node('p', 'Choose a session and wait for its saved plan to load.', 'small'));
    else if (!hasActivities() && !['focus', 'warmup', 'technical', 'game', 'equipment'].some(key => String(content()[key] || '').trim())) mount.append(node('p', 'No preparation plan has been saved for this session yet. The field view will show the recorded roster and empty plan sections.', 'small'));
    renderBudgets();
  }

  window.addEventListener('coach:context', event => {
    const next = event.detail || null;
    const nextIdentity = next?.profile && next.session ? [next.profile.email, next.profile.role, next.profile.sessionVersion, next.session.id].join(':') : '';
    const nextSignature = JSON.stringify([next?.session, next?.plan]);
    const changedIdentity = nextIdentity !== identity;
    if (changedIdentity || !next || next.busy || next.tab !== 'plan' || !next.planReady || nextSignature !== contentSignature) { closeField(); clearPrint(); }
    context = next;
    identity = nextIdentity;
    if (changedIdentity || nextSignature !== contentSignature) {
      dialog.replaceChildren();
      stageIndex = 0;
      stages = savedStages();
      durations = defaults();
      resetTimer();
      clearPrint();
    }
    contentSignature = nextSignature;
    if (!next?.profile) {
      dialog.replaceChildren();
      clearPrint();
    }
    const warning = $('field-dialog-unsaved-warning');
    if (warning && warning.hidden === !!next?.planDirty) warning.replaceWith(unsavedWarning('field-dialog-unsaved-warning'));
    renderEntry();
  });
  dialog.addEventListener('close', () => { pause(); document.body.classList.remove('field-view-open'); });
  dialog.addEventListener('cancel', () => pause());
  $('session-field-disclosure')?.addEventListener('toggle', event => { if (!event.currentTarget.open) closeField(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause('Timer paused while you are away. Start again when ready.'); });
  window.addEventListener('pagehide', () => { closeField(); clearPrint(); });
  window.addEventListener('afterprint', clearPrint);
  window.dispatchEvent(new CustomEvent('coach:request-context'));
})();
