/* Private, reusable drills and explicit suggestions from authorized notes. No external AI or browser storage. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = String(text ?? ''); if (cls) el.className = cls; return el; };
  const mount = $('coach-drill-library'); if (!mount) return;
  const fields = ['title', 'skill', 'minutes', 'target', 'setup', 'coaching', 'progression', 'equipment'];
  const targets = { warmup: 'Warm-up', technical: 'Technical activity', game: 'Game / application' };
  const blank = () => ({ id: null, title: '', skill: '', minutes: 10, target: 'technical', setup: '', coaching: '', progression: '', equipment: '', diagram: null, version: 0 });
  const clone = value => JSON.parse(JSON.stringify(value));
  const encode = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const purpose = drill => drill.diagram?.purpose === 'team-pattern' ? 'team-pattern' : 'drill';
  const typeName = drill => purpose(drill) === 'team-pattern' ? 'Team pattern' : 'Drill';
  let context = null, identity = '', epoch = 0, records = [], loaded = false, loading = false, writing = false;
  const catalogs = new Map(), sourceNames = { saved: 'Private library', preset: 'TPD preset', starter: 'Original starter' };
  let record = blank(), baseline = '', recovery = null, conflict = false, lastAttempt = null, historyLimit = 8, suggestionInputs = null;
  let diagramOpen = false, diagramEpoch = 0;
  let editorStandalone = null;
  let sessionChoice = null, pendingUse = null, sessionGroup = null, sessionReturn = null;
  const accountKey = value => value?.profile ? [value.profile.email, value.profile.role, value.profile.sessionVersion].join(':') : '';
  const permitted = drill => context?.profile && (['owner', 'admin'].includes(context.profile.role) || drill.author_email === context.profile.email);
  const standalone = () => context?.tab === 'library';
  const ready = () => !!context?.profile && ['plan', 'library'].includes(context.tab);
  const sessionHome = mount.parentNode, sessionAnchor = document.createComment('session drill library'); sessionHome.insertBefore(sessionAnchor, mount);
  const locked = () => !ready() || !!context.busy || writing || loading;
  const canInsert = () => !locked() && !standalone() && context.planReady && context.session?.status !== 'Cancelled';
  const values = () => ({ ...Object.fromEntries(fields.map(key => [key, key === 'minutes' ? Number($('library-' + key).value) : $('library-' + key).value.trim()])), diagram: record.diagram || null });
  const fingerprint = value => encode({ ...Object.fromEntries(fields.map(key => [key, value[key]])), diagram: value.diagram || null });
  const dirty = () => !!identity && (Boolean(recovery) || fingerprint(values()) !== baseline);
  const request = (operation, payload) => new Promise((resolve, reject) => emit('coach:library-request', { operation, payload, resolve, reject }));
  const notify = (text, error = false) => { $('library-status').textContent = text; $('library-status').setAttribute('role', error ? 'alert' : 'status'); };
  function action(text, handler, cls = 'secondary') { const b = node('button', text, cls); b.type = 'button'; b.addEventListener('click', handler); return b; }
  function label(text, control) { const el = node('label', text); el.htmlFor = control.id; el.append(control); return el; }
  function select(id, entries) { const el = node('select'); el.id = id; entries.forEach(([value, text]) => { const option = node('option', text); option.value = value; el.append(option); }); return el; }
  function closeDiagram() { diagramOpen = false; diagramEpoch++; document.body.classList.remove('drill-creator-focus'); window.CoachTactics?.closeLibrary?.(); }
  function openDiagram(reload = false) {
    if (!standalone() || editor.hidden || diagramOpen && !reload || !window.CoachTactics?.openLibrary) return;
    const ticket = ++diagramEpoch; diagramOpen = true;
    window.CoachTactics.openLibrary({ host: diagramEditor, diagram: clone(record.diagram || null), title: record.title,
      onChange: diagram => { if (ticket !== diagramEpoch || !standalone() || locked() || recovery) return; record.diagram = diagram ? clone(diagram) : null; renderState(); },
      onSave: () => { if (ticket === diagramEpoch && standalone()) editor.requestSubmit(); }
    });
    window.CoachTactics.setLibraryLocked?.(locked() || !!recovery, locked() || !!recovery || conflict);
  }
  function writeEditor(next = blank(), preserveDiagram = false) {
    record = clone(next); for (const key of fields) $('library-' + key).value = record[key] ?? '';
    baseline = fingerprint(values()); recovery = null; conflict = false; lastAttempt = null;
    $('library-editor-title').textContent = record.id ? 'Edit reusable drill' : 'Create a reusable drill';
    if (!preserveDiagram) drillDetails.open = !standalone();
    if (diagramOpen && !preserveDiagram) openDiagram(true);
    renderState();
  }
  function discard() { if (writing) return; closeDiagram(); writeEditor(); if (standalone()) editor.hidden = true; renderState(); notify(''); }
  function focusEditor() { renderState(); $('library-title').focus({ preventScroll: standalone() }); if (standalone()) editor.scrollIntoView({ block: 'start' }); }
  window.CoachLibrary = Object.freeze({ isDirty: dirty, isBusy: () => writing, discard, registerCatalog, createDiagram });

  const newDrill = action('New drill or team pattern', () => { if (locked() || recovery) return; if (dirty() && !confirm('Start a new drill or team pattern and discard this draft?')) return; writeEditor(); editor.hidden = false; openDiagram(); focusEditor(); }, 'button'); newDrill.id = 'library-new';
  const disclosure = node('details', '', 'coaching-tools-disclosure library-disclosure'); disclosure.id = 'library-disclosure';
  disclosure.append(node('summary', 'Drills & team patterns · saved, TPD presets & starters'));
  const body = node('div', '', 'library-body');
  body.append(node('h2', 'Find an activity for your session'), node('p', 'Search your private drills and team patterns, 10 TPD presets and 10 original starters together. Add to a session or open an editable draft. Saving is always your choice.', 'small'));
  const status = node('p', '', 'library-status'); status.id = 'library-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); body.append(status);
  const filters = node('div', '', 'library-filters'), search = node('input'); search.id = 'library-search'; search.type = 'search'; search.placeholder = 'Title, focus, setup or source'; search.autocomplete = 'off';
  const focus = select('library-filter', [['all', 'Every session phase'], ...Object.entries(targets)]);
  const sourceFilter = select('library-source-filter', [['all', 'Every source'], ['saved', 'Private library'], ['preset', 'TPD presets · 10'], ['starter', 'Original starters · 10']]);
  const ageFilter = select('library-age-filter', [['', 'All suggested ages'], ['young', 'Younger · 5–9'], ['middle', 'Developing · 8–12'], ['older', 'Older · 12–14'], ['unspecified', 'Age not specified']]);
  const skillFilter = select('library-skill-filter', [['', 'Every skill focus']]), durationFilter = select('library-duration-filter', [['', 'Any duration'], ['short', 'Up to 10 minutes'], ['medium', '11–20 minutes'], ['long', 'Over 20 minutes']]);
  filters.append(label('Find a drill or team pattern', search), label('Source', sourceFilter), label('Suggested ages', ageFilter), label('Session phase', focus));
  const typeFilter = select('library-type-filter', [['', 'Drills & team patterns'], ['drill', 'Drills'], ['team-pattern', 'Team patterns']]);
  const advancedFilters = node('details', '', 'library-advanced-filters'); advancedFilters.id = 'library-advanced-filters';
  const advancedSummary = node('summary', 'More filters'), advancedGrid = node('div', '', 'library-advanced-grid');
  advancedGrid.append(label('Type', typeFilter), label('Skill focus', skillFilter), label('Duration', durationFilter)); advancedFilters.append(advancedSummary, advancedGrid);
  const reload = action('Load library', () => load(true)); reload.id = 'library-reload';
  const toolbar = node('div', '', 'library-toolbar'); toolbar.append(advancedFilters, reload, newDrill); body.append(filters, toolbar);
  const results = node('p', '', 'small'); results.id = 'library-results'; results.setAttribute('role', 'status'); body.append(results);
  const list = node('div', '', 'library-list'); list.id = 'library-list'; body.append(list);
  const more = action('Show more drills', () => { historyLimit += 8; renderList(); }); more.id = 'library-more'; more.hidden = true; body.append(more);
  const sessionPicker = node('dialog', '', 'library-session-picker'); sessionPicker.id = 'library-session-picker'; sessionPicker.setAttribute('aria-labelledby', 'library-session-title');
  const sessionHeading = node('div', '', 'library-session-heading'), sessionChoiceTitle = node('h2'); sessionChoiceTitle.id = 'library-session-title';
  const sessionClose = action('Close', () => closeSessionPicker()); sessionClose.id = 'library-session-close';
  sessionHeading.append(sessionChoiceTitle, sessionClose);
  const sessionIntro = node('p', '', 'small'), sessionBack = action('← Training groups', () => { sessionGroup = null; sessionPast.checked = false; renderSessionGrid(); sessionGrid.querySelector('button')?.focus(); }); sessionBack.id = 'library-session-back';
  const sessionPast = node('input'); sessionPast.type = 'checkbox'; sessionPast.id = 'library-session-past';
  const pastLabel = label('Show past dates', sessionPast); pastLabel.className = 'library-session-past';
  const sessionTools = node('div', '', 'library-session-tools'); sessionTools.append(sessionBack, pastLabel);
  const sessionGrid = node('div', '', 'library-session-grid'); sessionGrid.id = 'library-session-grid';
  sessionPicker.append(sessionHeading, sessionIntro, sessionTools, sessionGrid); mount.append(sessionPicker);
  sessionPast.addEventListener('change', renderSessionGrid);
  sessionPicker.addEventListener('cancel', event => { event.preventDefault(); closeSessionPicker(); });
  function closeSessionPicker(restore = true) {
    sessionPicker.close(); sessionChoice = null; sessionGroup = null; sessionGrid.replaceChildren(); sessionChoiceTitle.textContent = sessionIntro.textContent = '';
    const trigger = sessionReturn; sessionReturn = null; if (restore && trigger?.isConnected) trigger.focus();
  }
  const availableSessions = () => (context?.sessions || []).filter(session => !['cancelled', 'completed'].includes(String(session.status).toLowerCase()));
  const localDate = () => new Intl.DateTimeFormat('en-CA', { timeZone: window.CoachClub?.timeZone || 'America/Vancouver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const sessionDateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(value + 'T12:00:00Z')) : 'Date to confirm';
  function sessionCard(title, detail, handler) {
    const button = action('', handler, 'library-session-card'); button.append(node('strong', title), node('span', detail), node('span', 'Choose →', 'library-session-link')); return button;
  }
  function renderSessionGrid() {
    sessionGrid.replaceChildren(); if (!sessionChoice) return;
    const available = availableSessions(), today = localDate();
    const upcoming = session => window.CoachPlanner?.nextSession ? !!window.CoachPlanner.nextSession([session]) : session.date >= today;
    const groups = window.CoachGroups?.groups(available) || available.map(session => ({ key: session.id, label: session.label || sessionDateLabel(session.date), sessions: [session] }));
    const group = groups.find(item => item.key === sessionGroup);
    sessionBack.hidden = !group; pastLabel.hidden = !group || !group.sessions.some(session => !upcoming(session));
    sessionChoiceTitle.textContent = 'Add “' + sessionChoice.title + '” to a session';
    sessionIntro.textContent = group ? group.label + ' · Choose a date. The drill opens in the session plan for you to review and save.' : 'Choose a training group or camp week, then the date. Your library drill stays unchanged.';
    if (!group) {
      sessionGroup = null;
      for (const item of groups) {
        const next = item.sessions.find(upcoming);
        const button = sessionCard(item.label, next ? 'Next: ' + sessionDateLabel(next.date) + ' · ' + (next.time || 'Time to confirm') : 'Past dates available', () => { sessionGroup = item.key; sessionPast.checked = !next; renderSessionGrid(); (sessionGrid.querySelector('button') || sessionBack).focus(); });
        button.dataset.sessionGroup = item.key; sessionGrid.append(button);
      }
    } else {
      for (const session of group.sessions.filter(item => sessionPast.checked || upcoming(item))) {
        const button = sessionCard(sessionDateLabel(session.date), [session.time || 'Time to confirm', session.location || 'Venue to confirm'].join(' · '), () => openChosenSession(session.id));
        button.dataset.sessionId = session.id; sessionGrid.append(button);
      }
    }
    if (!sessionGrid.children.length) sessionGrid.append(node('p', group ? 'No upcoming dates in this group. Choose another group or show past dates.' : 'No available sessions. Ask an administrator to add or assign a session.', 'empty-state'));
  }
  function openChosenSession(sessionId) {
    if (locked() || recovery || !sessionChoice || pendingUse) return;
    if (dirty()) return notify('Save or clear your drill draft first', true);
    const chosen = availableSessions().find(session => session.id === sessionId);
    if (!chosen) return notify('Choose an available session first.', true);
    const attempt = { drill: clone(sessionChoice), sessionId: chosen.id, account: accountKey(context), fromSession: context.session?.id || '', accepted: false, inFlight: false };
    pendingUse = attempt; closeSessionPicker(false);
    emit('coach:open-session', { sessionId: chosen.id, tab: 'plan', workspaceView: 'plan', resolve: accepted => {
      if (pendingUse !== attempt) return;
      if (!accepted) { pendingUse = null; notify('The session could not be opened. Your saved drill is unchanged.', true); renderState(); return; }
      attempt.accepted = true; finishSessionUse();
    } });
  }
  const suggestions = node('section', '', 'library-suggestions'); suggestions.setAttribute('aria-labelledby', 'library-suggestions-title');
  const suggestionTitle = node('h3', 'Ideas from your coaching notes'); suggestionTitle.id = 'library-suggestions-title';
  suggestions.append(suggestionTitle, node('p', 'Simple keyword matches in notes you can access for this group or selected player. These are starting points to review, not assessments. Notes are not sent to an AI service or copied into the shared plan.', 'small'));
  const scope = select('library-note-scope', [['', 'Group notes only']]); suggestions.append(label('Use notes for', scope));
  const recommendationList = node('div', '', 'library-recommendations'); recommendationList.id = 'library-recommendations'; suggestions.append(recommendationList); body.append(suggestions);
  const editor = node('form', '', 'library-editor'); editor.id = 'library-form';
  const editorTitle = node('h3', 'Create a reusable drill'); editorTitle.id = 'library-editor-title'; editor.append(editorTitle);
  const editorHeader = node('div', '', 'library-editor-header'); editor.append(editorHeader);
  const drillDetails = node('details', '', 'library-drill-details'); drillDetails.id = 'library-drill-details';
  const detailsBody = node('div', '', 'library-details-body'); drillDetails.append(node('summary', 'Drill details'), detailsBody); editor.append(drillDetails);
  detailsBody.append(node('p', 'Describe the activity without player names or private observations so it can be reused safely.', 'small'));
  const grid = node('div', '', 'library-editor-grid');
  for (const [key, title, maximum, required] of [['title', 'Drill name', 80, true], ['skill', 'Skill focus', 80, false]]) {
    const input = node('input'); input.id = 'library-' + key; input.maxLength = maximum; input.required = required; input.autocomplete = 'off'; (key === 'title' ? editorHeader : grid).append(label(title, input));
  }
  const minutes = node('input'); minutes.id = 'library-minutes'; minutes.type = 'number'; minutes.min = '1'; minutes.max = '120'; minutes.step = '1'; minutes.required = true;
  grid.append(label('Minutes', minutes), label('Add to', select('library-target', Object.entries(targets)))); detailsBody.append(grid);
  for (const [key, title] of [['setup', 'Setup & instructions'], ['coaching', 'Coaching points (optional)'], ['progression', 'Adaptations (optional)'], ['equipment', 'Equipment (optional)']]) {
    const field = node('textarea'); field.id = 'library-' + key; field.rows = key === 'setup' ? 4 : 2; field.maxLength = 2000; field.required = key === 'setup'; detailsBody.append(label(title, field));
  }
  const editorActions = node('div', '', 'library-actions'), save = node('button', 'Save drill', 'button'); save.id = 'library-save'; save.type = 'submit';
  const diagramBox = node('section', '', 'library-diagram'), diagramPreview = node('div', '', 'library-diagram-preview'), diagramStatus = node('p', '', 'small'); diagramStatus.id = 'library-diagram-status';
  const attachDiagram = action('Attach current tactics board', () => { if (locked() || recovery) return; const draft = window.CoachTactics?.getDraft(); if (!draft || draft.sessionId !== context.session?.id) return notify('Open the tactics board in a session first, then attach it here.', true); record.diagram = clone(draft.diagram); renderState(); notify('Diagram attached to this drill draft. Save drill to keep both together.'); }); attachDiagram.id = 'library-attach-diagram';
  const removeDiagram = action('Remove attached diagram', () => { if (locked() || recovery) return; record.diagram = null; renderState(); }); removeDiagram.id = 'library-remove-diagram';
  diagramBox.append(node('h4', 'Drill diagram'), diagramPreview, diagramStatus, attachDiagram, removeDiagram); editor.append(diagramBox);
  const diagramEditor = node('section', '', 'library-diagram-editor'); diagramEditor.id = 'library-diagram-editor'; editor.append(diagramEditor);
  const cancel = action('Clear draft', () => { if (locked()) return; if (dirty() && !confirm('Discard this unsaved drill?')) return; discard(); if (standalone()) newDrill.focus(); }); cancel.id = 'library-cancel';
  const retry = action('Retry same save', () => { if (recovery && !locked()) persist(recovery); }); retry.id = 'library-retry'; retry.hidden = true;
  const latest = action('Open latest saved drill', () => { if (locked() || recovery || !conflict) return; if (dirty() && !confirm('Discard your unsaved changes and open the latest saved drill?')) return; load(true, record.id); }); latest.id = 'library-open-latest';
  const keepCopy = action('Keep draft as new drill', () => { if (!locked() && !recovery && conflict) copyDraft({ ...record, ...values() }); }); keepCopy.id = 'library-keep-copy';
  editorActions.append(save, cancel, retry, latest, keepCopy); editor.append(editorActions);
  const reuse = node('div', '', 'library-capture'), source = select('library-source-section', Object.entries(targets));
  const capture = action('Use saved plan section', () => {
    if (!canInsert() || recovery) return;
    const key = source.value, text = context.plan?.content?.[key];
    if (!String(text || '').trim()) return notify('Save an activity in that plan section first.', true);
    if (dirty() && !confirm('Replace the unsaved drill with this saved plan section?')) return;
    writeEditor({ ...blank(), title: targets[key] + ' activity', target: key, setup: String(text).slice(0, 2000) });
    baseline = fingerprint(blank());
    notify(String(text).length > 2000 ? 'The first 2,000 characters were copied. Review the draft, remove personal details, then save.' : 'Copied from the saved plan. Review the draft and remove personal details before saving.'); renderState();
  }); capture.id = 'library-capture'; reuse.append(label('Turn a saved activity into a drill', source), capture); editor.append(reuse); body.append(editor); disclosure.append(body); mount.append(disclosure);
  for (const key of fields) $('library-' + key).addEventListener('input', renderState);
  const viewer = node('dialog', '', 'library-viewer'); viewer.id = 'library-viewer'; viewer.setAttribute('aria-labelledby', 'library-view-title');
  const viewHeader = node('header', '', 'library-view-header'), viewTitle = node('h2'); viewTitle.id = 'library-view-title';
  const viewClose = action('Close preview', () => closeView()); viewClose.id = 'library-view-close';
  viewHeader.append(viewTitle, viewClose);
  const viewMeta = node('p', '', 'library-view-meta'), viewLayout = node('div', '', 'library-view-layout'), viewVisual = node('section', '', 'library-view-visual');
  const viewBoard = node('div', '', 'library-view-board'); viewBoard.id = 'library-view-board'; viewBoard.setAttribute('role', 'img');
  const viewControls = node('div', '', 'library-view-controls'), viewPlay = action('Play movement', toggleViewPlayback, 'button'), viewRestart = action('Back to start', () => seekView(0));
  viewPlay.id = 'library-view-play'; viewPlay.setAttribute('aria-pressed', 'false'); viewRestart.id = 'library-view-restart';
  const viewProgress = node('input'); viewProgress.id = 'library-view-progress'; viewProgress.type = 'range'; viewProgress.min = '0'; viewProgress.step = '.01';
  const viewScrub = label('Playback position', viewProgress), viewPhases = node('div', '', 'library-view-phases'); viewPhases.id = 'library-view-phases'; viewPhases.setAttribute('role', 'group'); viewPhases.setAttribute('aria-label', 'Drill phases');
  const viewPhaseTitle = node('h3'), viewPhaseNotes = node('p', '', 'library-instructions'); viewPhaseTitle.id = 'library-view-phase-title'; viewPhaseNotes.id = 'library-view-phase-notes';
  const viewInstructions = node('section', '', 'library-view-instructions'); viewInstructions.id = 'library-view-instructions'; viewInstructions.setAttribute('aria-label', 'Drill instructions');
  viewControls.append(viewPlay, viewRestart); viewVisual.append(viewBoard, viewControls, viewScrub, viewPhases, viewPhaseTitle, viewPhaseNotes); viewLayout.append(viewVisual, viewInstructions); viewer.append(viewHeader, viewMeta, viewLayout); mount.append(viewer);
  let viewedDrill = null, viewOrigin = null, viewTime = 0, viewTotal = 0, viewAnimation = 0, viewPlaying = false, viewLastTime = 0, viewPhaseIndex = -1;
  function pauseView() { cancelAnimationFrame(viewAnimation); viewAnimation = 0; viewPlaying = false; viewPlay.textContent = 'Play movement'; viewPlay.setAttribute('aria-pressed', 'false'); }
  function clearView() { pauseView(); viewedDrill = null; viewTime = viewTotal = 0; viewPhaseIndex = -1; viewTitle.textContent = viewMeta.textContent = viewPhaseTitle.textContent = viewPhaseNotes.textContent = ''; viewBoard.replaceChildren(); viewBoard.removeAttribute('aria-label'); viewPhases.replaceChildren(); viewInstructions.replaceChildren(); }
  function closeView(restoreFocus = true) { const origin = viewOrigin; viewOrigin = null; clearView(); if (viewer.open) viewer.close(); if (restoreFocus && origin?.isConnected) origin.focus(); }
  viewer.addEventListener('cancel', event => { event.preventDefault(); closeView(); });
  viewer.addEventListener('close', clearView);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pauseView(); });
  viewProgress.addEventListener('input', () => seekView(Number(viewProgress.value)));
  function renderView() {
    if (!viewedDrill) return;
    let result = null;
    try { result = window.CoachTactics?.previewAt?.(viewedDrill.diagram, viewTime); } catch { /* Keep instructions available for an invalid legacy diagram. */ }
    viewBoard.replaceChildren(result ? result.image : node('p', viewedDrill.diagram ? 'This diagram could not be previewed. The drill instructions are below.' : 'No diagram saved for this drill. Follow the instructions to set it up.', 'small'));
    viewProgress.value = String(viewTime);
    viewProgress.setAttribute('aria-valuetext', Math.round(viewTime) + ' of ' + viewTotal + ' seconds');
    viewBoard.setAttribute('aria-label', result ? viewedDrill.title + ' — ' + viewedDrill.diagram.frames[result.index].title : 'Drill diagram unavailable');
    viewControls.hidden = viewScrub.hidden = !result || !viewTotal; viewPhases.hidden = !result;
    const index = result?.index ?? -1;
    if (index !== viewPhaseIndex) {
      viewPhaseIndex = index; const phase = viewedDrill.diagram?.frames?.[index];
      viewPhaseTitle.textContent = phase ? 'Phase ' + (index + 1) + ': ' + phase.title : '';
      viewPhaseNotes.textContent = phase?.notes || '';
      [...viewPhases.children].forEach((button, i) => button.setAttribute('aria-pressed', String(i === index)));
    }
  }
  function seekView(seconds) { pauseView(); viewTime = Math.max(0, Math.min(viewTotal, seconds)); renderView(); }
  function toggleViewPlayback() {
    if (viewPlaying) return pauseView();
    if (!viewedDrill || !viewTotal || !viewer.open) return;
    if (viewTime >= viewTotal) viewTime = 0;
    viewPlaying = true; viewPlay.textContent = 'Pause movement'; viewPlay.setAttribute('aria-pressed', 'true'); viewLastTime = performance.now();
    const tick = now => {
      if (!viewPlaying || !viewer.open || !viewedDrill) return;
      viewTime = Math.min(viewTotal, viewTime + (now - viewLastTime) / 1000); viewLastTime = now; renderView();
      if (viewTime >= viewTotal) pauseView(); else viewAnimation = requestAnimationFrame(tick);
    };
    viewAnimation = requestAnimationFrame(tick);
  }
  function viewDrill(drill, origin) {
    if (locked() || recovery || drill.source === 'saved' && !permitted(drill)) return;
    clearView(); viewedDrill = clone(drill); viewOrigin = origin; viewTitle.textContent = drill.title;
    viewMeta.textContent = [typeName(drill), sourceNames[drill.source], drill.skill, drill.minutes + ' min', targets[drill.target], 'Read-only preview'].filter(Boolean).join(' · ');
    let time = 0;
    for (const [index, phase] of (viewedDrill.diagram?.frames || []).entries()) { const start = time; const choice = action((index + 1) + '. ' + phase.title, () => seekView(start)); choice.setAttribute('aria-pressed', 'false'); viewPhases.append(choice); if (index < viewedDrill.diagram.frames.length - 1) time += phase.duration; }
    viewTotal = time; viewProgress.max = String(time);
    for (const [key, title] of [['setup', 'Setup & instructions'], ['coaching', 'Coaching points'], ['progression', 'Adaptations'], ['equipment', 'Equipment']]) if (drill[key]) viewInstructions.append(node('h3', title), node('p', drill[key], 'library-instructions'));
    if (drill.attribution) { const link = node('a', 'Source: ' + drill.attribution.label); link.href = drill.attribution.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; viewInstructions.append(link); }
    renderView(); viewer.showModal(); viewClose.focus();
  }
  search.addEventListener('input', () => { historyLimit = 8; renderList(); });
  for (const filter of [focus, sourceFilter, ageFilter, skillFilter, durationFilter, typeFilter]) filter.addEventListener('change', () => { historyLimit = 8; renderList(); });
  scope.addEventListener('change', renderSuggestions);
  disclosure.addEventListener('toggle', () => { if (disclosure.open && ready() && !loaded && !loading) load(); });
  editor.addEventListener('invalid', event => { if (drillDetails.contains(event.target)) drillDetails.open = true; }, true);
  editor.addEventListener('submit', event => {
    event.preventDefault(); if (locked() || recovery || conflict || !editor.reportValidity()) return;
    if (diagramOpen && window.CoachTactics?.libraryDiagram) record.diagram = clone(window.CoachTactics.libraryDiagram());
    const draft = values(), signature = fingerprint(draft);
    const payload = { id: record.id, ...draft, expectedVersion: record.version || 0 };
    if (!record.id) payload.requestId = lastAttempt?.signature === signature ? lastAttempt.payload.requestId : crypto.randomUUID();
    lastAttempt = { signature, payload }; persist({ operation: 'save', payload });
  });
  function renderState() {
    document.body.classList.toggle('drill-creator-focus', !!context?.profile && standalone() && !editor.hidden);
    if (editorStandalone !== standalone()) {
      editorStandalone = standalone(); drillDetails.open = !editorStandalone;
      if (editorStandalone) { editorHeader.prepend(cancel); editorHeader.append(editorActions); editorHeader.after(diagramEditor, drillDetails); body.prepend(editor); }
      else { editorActions.append(cancel); editor.append(editorActions, reuse); editorHeader.after(drillDetails, diagramBox, diagramEditor); body.append(editor); }
    }
    const currentType = typeName(record);
    editorTitle.textContent = (record.id ? 'Edit reusable ' : 'Create a reusable ') + currentType.toLowerCase();
    drillDetails.querySelector('summary').textContent = currentType + ' details';
    $('library-title').parentElement.firstChild.textContent = currentType + ' name';
    editorTitle.hidden = standalone(); cancel.textContent = standalone() ? 'Back to library' : 'Clear draft';
    if (standalone() && !editor.hidden) editorHeader.append(status); else if (status.parentNode !== body) filters.before(status);
    if (diagramOpen) window.CoachTactics?.setLibraryTitle?.($('library-title').value);
    diagramBox.hidden = standalone(); diagramEditor.hidden = !standalone();
    diagramPreview.replaceChildren(); const thumbnail = window.CoachTactics?.preview(record.diagram); if (thumbnail) diagramPreview.append(thumbnail);
    diagramStatus.textContent = record.diagram ? 'Attached · ' + record.diagram.frames.length + ' steps. Changes to the tactics board do not change this saved copy.' : 'No diagram attached.';
    attachDiagram.hidden = standalone(); attachDiagram.disabled = removeDiagram.disabled = locked() || !!recovery; removeDiagram.hidden = !record.diagram;
    for (const field of editor.querySelectorAll('input,select,textarea')) if (!diagramEditor.contains(field)) field.disabled = locked() || !!recovery;
    if (diagramOpen) window.CoachTactics?.setLibraryLocked?.(locked() || !!recovery, locked() || !!recovery || conflict);
    save.disabled = locked() || !!recovery || conflict; cancel.disabled = locked(); retry.disabled = locked();
    latest.hidden = keepCopy.hidden = !conflict; latest.disabled = keepCopy.disabled = locked() || !!recovery;
    cancel.hidden = !standalone() && !record.id && !dirty(); retry.hidden = !recovery; retry.textContent = recovery?.operation === 'archive' ? 'Retry same archive' : 'Retry same save';
    newDrill.hidden = !standalone(); newDrill.disabled = locked() || !!recovery;
    suggestions.hidden = reuse.hidden = standalone();
    capture.disabled = !canInsert() || !!recovery; reload.disabled = locked() || loading;
    search.disabled = sourceFilter.disabled = ageFilter.disabled = focus.disabled = skillFilter.disabled = durationFilter.disabled = typeFilter.disabled = scope.disabled = locked();
    reload.textContent = loading ? 'Loading…' : loaded ? 'Refresh library' : 'Load library';
    save.textContent = writing ? 'Saving…' : record.id ? 'Save changes' : record.variation ? 'Save private variation' : 'Save ' + currentType.toLowerCase();
    for (const el of list.querySelectorAll('button')) { el.disabled = locked() || !!recovery || (el.dataset.insert === 'true' && !canInsert()); if (el.dataset.insert === 'true') el.hidden = standalone(); }
    for (const el of list.querySelectorAll('[data-use-session]')) el.hidden = !standalone();
    if (sessionPicker.open && (!standalone() || !sessionChoice)) closeSessionPicker(false);
    for (const el of sessionGrid.querySelectorAll('button')) el.disabled = locked() || !!recovery || !!pendingUse;
    for (const el of recommendationList.querySelectorAll('button')) el.disabled = !canInsert() || !!recovery;
    emit('coach:library-state', { starterEnabled:ready() && !locked() && !recovery, insertEnabled:canInsert() && !recovery, loaded, count:records.length });
    finishSessionUse();
  }
  async function finishSessionUse() {
    const attempt = pendingUse;
    if (!attempt || !attempt.accepted || attempt.inFlight || accountKey(context) !== attempt.account || context?.tab !== 'plan' || context.session?.id !== attempt.sessionId || !canInsert()) return;
    attempt.inFlight = true;
    try {
      // Let all context listeners enable the loaded plan before inserting its activity snapshot.
      // The independent tactics drawer does not need to be opened or loaded.
      await Promise.resolve();
      if (pendingUse !== attempt || accountKey(context) !== attempt.account || context?.tab !== 'plan' || context.session?.id !== attempt.sessionId) return;
      pendingUse = null; sessionChoice = null;
      if (canInsert()) insert(attempt.drill);
      else notify('The session is not ready. Open your saved drill again to add it.', true);
    } catch (error) {
      if (pendingUse === attempt) { pendingUse = null; notify('The session could not be prepared. Your saved drill is unchanged.', true); }
    }
  }
  function chooseSession(drill, trigger) {
    if (!standalone() || locked() || recovery || drill.source === 'saved' && !permitted(drill)) return;
    if (dirty()) return notify('Save or clear your drill draft first', true);
    pendingUse = null; sessionChoice = clone(drill); sessionGroup = null; sessionReturn = trigger || document.activeElement; sessionPast.checked = false;
    renderSessionGrid(); sessionPicker.showModal(); (sessionGrid.querySelector('button') || sessionClose).focus(); renderState();
  }
  function insert(drill) {
    if (!canInsert() || recovery) return;
    const text = drill.title + ' (' + drill.minutes + ' min)\n' + drill.setup + (drill.coaching ? '\nCoach: ' + drill.coaching : '') + (drill.progression ? '\nAdapt: ' + drill.progression : '') + (drill.equipment ? '\nEquipment: ' + drill.equipment : '');
    const addition = { target: drill.target, text, title: drill.title, minutes: drill.minutes, diagram: drill.diagram || null };
    emit('coach:insert-plan', addition); if (addition.inserted) notify(drill.diagram ? 'Activity and diagram added to your plan draft. Save the shared plan when ready.' : 'Activity added to your session draft. Review it and save the plan when ready.');
  }
  function edit(drill) {
    if (locked() || recovery || !permitted(drill)) return;
    if (dirty() && !confirm('Edit this drill and discard the current unsaved drill?')) return;
    writeEditor(drill); editor.hidden = false; openDiagram(); notify(''); focusEditor();
  }
  function copyDraft(drill) {
    writeEditor({ ...blank(), ...Object.fromEntries(fields.map(key => [key, drill[key]])), title: drill.title.slice(0, 73) + ' (copy)', diagram: drill.diagram || null });
    baseline = fingerprint(blank()); editor.hidden = false; openDiagram(); renderState();
    notify('Unsaved ' + typeName(record).toLowerCase() + ' copy. Review it and choose Save to keep it.'); focusEditor();
  }
  function registerCatalog(source, drills) {
    if (!['preset', 'starter'].includes(source) || !Array.isArray(drills)) return;
    catalogs.set(source, drills.map(drill => ({ ...clone(drill), source, id: source + ':' + drill.id })));
    if (ready()) renderList();
  }
  // Original schematic positions, shared with the existing tactics board format.
  function createDiagram(title, pieces) {
    const items = pieces.map(([kind], index) => ({ id: 'piece_' + index, kind, label: kind === 'home' || kind === 'away' ? String(index + 1) : '' }));
    return { schemaVersion: 1, pitch: 'full', items, frames: [{ id: 'start', title: title.slice(0, 60), duration: 3, positions: pieces.map(([, x, y], index) => ({ id: items[index].id, x, y })) }] };
  }
  function previewDiagram(drill) {
    const existing = window.CoachTactics?.preview(drill.diagram); if (existing) return existing;
    if (!drill.diagram?.frames?.[0]) return null;
    const svg = (tag, attributes) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, value); return el; };
    const image = svg('svg', { viewBox: '0 0 200 130', 'aria-hidden': 'true' });
    image.append(svg('rect', { width: 200, height: 130, fill: '#e3ebdc' }), svg('rect', { x: 5, y: 5, width: 190, height: 120, fill: 'none', stroke: '#8ea58b' }));
    for (const piece of drill.diagram.items) {
      const point = drill.diagram.frames[0].positions.find(item => item.id === piece.id); if (!point) continue;
      const x = point.x * 2, y = point.y * 1.3;
      image.append(piece.kind === 'cone' ? svg('path', { d: `M${x} ${y - 4}l-4 8h8z`, fill: '#b96a26' }) : piece.kind === 'goal' ? svg('rect', { x: x - 3, y: y - 9, width: 6, height: 18, fill: '#fff', stroke: '#59695c' }) : svg('circle', { cx: x, cy: y, r: piece.kind === 'ball' ? 2.5 : 4, fill: piece.kind === 'ball' ? '#fff' : piece.kind === 'away' ? '#c7784b' : '#365c7a', stroke: '#35453c' }));
    }
    return image;
  }
  function ageBand(drill) {
    if (drill.band) return drill.band;
    const ages = drill.setup.match(/\bages?\s+(\d+)\s*[–-]\s*(\d+)/i);
    return ages ? Number(ages[2]) <= 9 ? 'young' : Number(ages[2]) <= 12 ? 'middle' : 'older' : 'unspecified';
  }
  function renderList() {
    const query = search.value.trim().toLowerCase();
    const available = [...records.filter(permitted).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || a.title.localeCompare(b.title)).map(drill => ({ ...drill, source: 'saved' })), ...[...catalogs.values()].flat()], priorSkill = skillFilter.value, skills = new Map(available.filter(drill => drill.skill.trim()).map(drill => [drill.skill.trim().toLowerCase(), drill.skill.trim()]));
    skillFilter.replaceChildren(...select('', [['', 'Every skill focus'], ...[...skills].sort((a, b) => a[1].localeCompare(b[1]))]).options); skillFilter.value = skills.has(priorSkill) ? priorSkill : '';
    const extraCount = Number(!!skillFilter.value) + Number(!!durationFilter.value) + Number(!!typeFilter.value); advancedSummary.textContent = 'More filters' + (extraCount ? ' · ' + extraCount + ' active' : '');
    const matching = available.filter(drill => (!typeFilter.value || purpose(drill) === typeFilter.value) && (sourceFilter.value === 'all' || sourceFilter.value === drill.source) && (!ageFilter.value || ageBand(drill) === ageFilter.value) && (focus.value === 'all' || drill.target === focus.value) && (!skillFilter.value || drill.skill.trim().toLowerCase() === skillFilter.value) && (!durationFilter.value || (durationFilter.value === 'short' ? drill.minutes <= 10 : durationFilter.value === 'medium' ? drill.minutes > 10 && drill.minutes <= 20 : drill.minutes > 20)) && (!query || [drill.title, drill.skill, drill.setup, drill.coaching, drill.progression, drill.equipment, typeName(drill), sourceNames[drill.source]].join(' ').toLowerCase().includes(query)));
    results.textContent = Math.min(matching.length, historyLimit) + ' of ' + matching.length + ' matching drills and team patterns' + (loaded ? '' : ' · Load saved drills to include your private library.');
    list.replaceChildren();
    for (const drill of matching.slice(0, historyLimit)) {
      const card = node('article', '', 'library-card' + (drill.source === 'saved' ? '' : ' library-' + drill.source)); card.dataset.drillId = drill.id; card.dataset.source = drill.source; card.dataset.purpose = purpose(drill);
      const longSetup = drill.setup.length > 160;
      const publicIdea = drill.source !== 'saved';
      const setupSummary = publicIdea ? drill.setup.split(/\n\nSource:/)[0].replace(/^(?:Suggested )?ages[^\n]*\n/i, '').replace(/^Source setup \(paraphrased\):\s*/i, '').replace(/\s+/g, ' ').trim() : drill.setup;
      const summaryLimit = publicIdea ? 140 : 160;
      const sourceTag = node('span', sourceNames[drill.source], 'library-source-tag');
      const badges = node('div', '', 'library-card-badges'); badges.append(node('span', typeName(drill), 'library-type-tag'), sourceTag);
      card.append(badges, node('h3', drill.title), node('p', [drill.skill, drill.ages && 'Ages ' + drill.ages, drill.players, drill.minutes + ' min', targets[drill.target]].filter(Boolean).join(' · '), 'small'));
      const thumbnail = previewDiagram(drill); if (thumbnail) { const preview = node('figure', '', 'library-diagram-preview'); preview.append(thumbnail); if (publicIdea) preview.append(node('figcaption', 'Original sketch · illustrative starting positions', 'small')); card.append(preview); }
      card.append(node('p', setupSummary.length > summaryLimit ? setupSummary.slice(0, summaryLimit - 3).trimEnd() + '…' : setupSummary, 'library-instructions'));
      if (drill.attribution) {
        const attribution = node('p', '', 'preset-source small'), link = node('a', 'Source: ' + drill.attribution.label.split(' · ')[0]); link.href = drill.attribution.url; link.title = drill.attribution.label; link.target = '_blank'; link.rel = 'noopener noreferrer'; attribution.append(link); card.append(attribution);
      }
      if (publicIdea || longSetup || drill.coaching || drill.progression || drill.equipment) {
        const details = node('details', '', 'library-card-details'); details.append(node('summary', 'Drill details'));
        if (publicIdea || longSetup) details.append(node('p', drill.setup, 'library-instructions'));
        for (const [key, label] of [['coaching', 'Coach'], ['progression', 'Adapt'], ['equipment', 'Equipment']]) if (drill[key]) details.append(node('p', label + ': ' + drill[key], 'library-instructions'));
        if (drill.attribution) details.append(node('p', drill.attribution.detail, 'small'));
        if (publicIdea) details.append(node('p', drill.source === 'preset' ? 'Ages, timings and TPD prompts are coaching suggestions. Source notes are paraphrased; no endorsement implied.' : 'Original Star Soccer starting point. Adapt for the players present.', 'small'));
        card.append(details);
      }
      if (!publicIdea) card.append(node('p', drill.author_email === context.profile.email ? 'Your reusable ' + typeName(drill).toLowerCase() : 'Shared with full-access coaches · ' + drill.author_email, 'small'));
      const actions = node('div', '', 'library-actions'), add = action('Add to session', () => insert(drill)); add.dataset.insert = 'true'; add.setAttribute('aria-label', 'Add ' + drill.title + ' to session');
      const view = action('View ' + typeName(drill).toLowerCase(), () => viewDrill(drill, view), 'button'); view.dataset.viewDrill = 'true'; actions.append(view, add);
      const useSession = action('Add to session', () => chooseSession(drill, useSession)); useSession.dataset.useSession = 'true'; actions.append(useSession);
      if (drill.source !== 'saved') {
        const use = action('Edit drill', () => emit('coach:library-prefill', { source: drill.source, drill })); use.dataset[drill.source + 'Title'] = drill.title; use.setAttribute('aria-label', 'Edit ' + drill.title); actions.append(use);
      } else {
        const change = action('Edit ' + typeName(drill).toLowerCase(), () => edit(drill));
        actions.append(change);
      }
      card.append(actions); list.append(card);
    }
    if (!matching.length) list.append(node('p', 'No drills or team patterns match these filters. Try a different type, source, age group or session phase.', 'empty-state'));
    more.hidden = matching.length <= historyLimit; renderState();
  }
  function sameGroup(a, b) { return !!window.CoachGroups?.sameGroup(a, b); }
  const topics = [
    { skill: 'Passing', match: /\b(pass(?:ing|es)?|support|angles?)\b/i, title: 'Pass and offer a new angle', minutes: 10, target: 'technical', setup: 'In groups of three, pass to a teammate and move to offer a new passing angle. Use comfortable distances and rotate roles.', coaching: 'Look up before the pass. Help the receiver by moving into clear space.', progression: 'Add a passive defender once the group is ready.', equipment: 'Balls and cones.' },
    { skill: 'First touch', match: /\b(first touch|receiv(?:e|ing)|control)\b/i, title: 'Receive through an open gate', minutes: 10, target: 'technical', setup: 'Create two cone gates beside a receiving area. A partner passes; the receiver takes a controlled first touch toward an open gate.', coaching: 'Prepare the body before the ball arrives and keep the next touch within reach.', progression: 'Let the passer indicate a gate as the ball travels.', equipment: 'One ball per pair and cones.' },
    { skill: 'Scanning', match: /\b(scan(?:ning)?|aware(?:ness)?|look up|head up)\b/i, title: 'Look, receive, choose', minutes: 10, target: 'technical', setup: 'Use pairs with two wide receiving gates. Before receiving, look around and call an open gate, then move the ball toward it.', coaching: 'Encourage early looks and a calm decision rather than speed.', progression: 'Add a supporting teammate as another option.', equipment: 'Balls and cones.' },
    { skill: 'Ball control', match: /\b(dribbl(?:e|ing)|turns?|close control)\b/i, title: 'Move and turn into space', minutes: 8, target: 'warmup', setup: 'Give each player a ball inside a generously spaced area. Move to free space and choose a turn when the coach signals.', coaching: 'Use small touches and check for nearby players before changing direction.', progression: 'Invite players to demonstrate a turn and try a different one.', equipment: 'One ball per player and boundary cones.' },
    { skill: 'Finishing', match: /\b(finish(?:ing)?|shoot(?:ing)?|shots?)\b/i, title: 'Control, then finish', minutes: 12, target: 'technical', setup: 'Set a short approach to an appropriate goal. Receive a pass, control into space and finish. Rotate roles, leaving safe space between attempts.', coaching: 'Choose placement before power. Retrieve balls only when the area is clear.', progression: 'Offer two finishing targets so players choose a clear route.', equipment: 'Balls, cones and an appropriate goal.' },
    { skill: 'Defending', match: /\b(defend(?:ing|er|ers)?|press(?:ing)?|tackl(?:e|ing))\b/i, title: 'Delay and guide', minutes: 10, target: 'game', setup: 'Use short one-versus-one channels. The defender aims to slow the attacker and guide them away from a target, with controlled contact and generous rest.', coaching: 'Stay balanced and patient. Match the challenge to the players.', progression: 'Add a supporting defender to practise communicating.', equipment: 'Balls, cones and bibs.' },
  ];
  function renderSuggestions() {
    const input = [context?.notes, context?.session, context?.sessions, context?.groupSessions, scope.value, records];
    if (suggestionInputs && input.every((value, index) => value === suggestionInputs[index])) return;
    suggestionInputs = input;
    const selected = context?.session;
    const groupRows = Array.isArray(context?.groupSessions) ? context.groupSessions : (context?.sessions || []).filter(session => session.id === selected?.id || sameGroup(selected, session));
    const groupIds = new Set(groupRows.map(session => session.id));
    const players = new Map(); for (const session of groupRows) for (const player of session.players || []) if (!players.has(player.playerId)) players.set(player.playerId, player);
    const prior = scope.value; scope.replaceChildren(new Option('Group notes only', ''), ...[...players.values()].map(player => new Option(player.name, player.playerId)));
    scope.value = [...scope.options].some(option => option.value === prior) ? prior : '';
    const applicable = (context?.notes || []).filter(note => groupIds.has(note.session_id) && (scope.value ? note.player_id === scope.value : !note.player_id));
    const matched = topics.map(topic => ({ topic, count: applicable.filter(note => topic.match.test(String(note.body || '') + ' ' + String(note.category || ''))).length })).filter(item => item.count);
    const saved = records.filter(permitted).map(drill => ({ drill, matches: matched.filter(({ topic }) => topic.match.test(drill.skill + ' ' + drill.title)) })).filter(item => item.matches.length)
      .sort((a, b) => b.matches.reduce((sum, item) => sum + item.count, 0) - a.matches.reduce((sum, item) => sum + item.count, 0) || String(b.drill.updated_at).localeCompare(String(a.drill.updated_at)) || a.drill.title.localeCompare(b.drill.title));
    recommendationList.replaceChildren();
    for (const item of saved.slice(0, 4)) {
      const card = node('article', '', 'library-suggestion'); card.dataset.savedDrill = item.drill.id;
      card.append(node('h4', item.drill.title), node('p', 'From your saved library · ' + item.matches.map(match => match.topic.skill + ' keywords in ' + match.count + ' accessible ' + (match.count === 1 ? 'note' : 'notes')).join('; ') + '. Review this activity before adding it.', 'small'), node('p', item.drill.setup));
      card.append(action('Add saved drill to ' + targets[item.drill.target].toLowerCase(), () => insert(item.drill))); recommendationList.append(card);
    }
    for (const { topic, count } of matched) {
      if (recommendationList.children.length >= 4) break;
      if (saved.some(item => item.matches.some(match => match.topic === topic))) continue;
      const card = node('article', '', 'library-suggestion'); card.dataset.topic = topic.skill;
      card.append(node('h4', topic.title), node('p', topic.skill + ' keyword match in ' + count + ' accessible ' + (count === 1 ? 'note' : 'notes') + '. Check whether this focus is still useful.', 'small'), node('p', topic.setup));
      const actions = node('div', '', 'library-actions');
      actions.append(action('Add suggestion to ' + targets[topic.target].toLowerCase(), () => insert(topic)), action('Save idea as a drill', () => emit('coach:library-prefill', { sessionId: context.session.id, drill: topic })));
      card.append(actions); recommendationList.append(card);
    }
    if (!recommendationList.children.length) recommendationList.append(node('p', applicable.length ? 'No clear practice-topic keywords matched these notes. Choose a starter idea or create your own drill.' : 'No accessible notes in this folder yet. Your saved drills and starter activities are still available.', 'empty-state'));
    renderState();
  }
  function validateRows(rows) {
    if (!Array.isArray(rows) || new Set(rows.map(drill => drill.id)).size !== rows.length || rows.some(drill => !drill || typeof drill.id !== 'string' || !Number.isInteger(drill.version) || drill.version < 1 || !Object.hasOwn(targets, drill.target) || !fields.every(key => key === 'minutes' ? Number.isInteger(drill.minutes) && drill.minutes >= 1 && drill.minutes <= 120 : typeof drill[key] === 'string') || typeof drill.author_email !== 'string')) throw Error('The saved drill list could not be verified. Please refresh.');
    return rows.filter(permitted);
  }
  function matchesSaved(drill, payload) { return drill && (!payload.id || drill.id === payload.id) && drill.version >= payload.expectedVersion + 1 && fingerprint(drill) === fingerprint(payload) && (payload.id || drill.request_id === payload.requestId); }
  async function load(force = false, openId = null) {
    if (!ready() || loading || writing || context.busy || loaded && !force) return;
    const ticket = ++epoch, started = identity; loading = true; renderState();
    try {
      const result = await request('list', {}); if (ticket !== epoch || identity !== started) return;
      const next = validateRows(result.drills); records = next; loaded = true;
      if (recovery?.operation === 'save') {
        const matches = records.filter(drill => matchesSaved(drill, recovery.payload));
        if (matches.length === 1) { writeEditor(matches[0]); notify('The earlier save is verified. Your drill is in the library.'); }
        else notify('The earlier save is not verified yet. Retry the same save or review before discarding.', true);
      } else if (recovery?.operation === 'archive' && !records.some(drill => drill.id === recovery.payload.id)) { writeEditor(); notify('The earlier archive is verified.'); }
      else if (openId) {
        const saved = records.find(drill => drill.id === openId);
        if (saved) { writeEditor(saved); notify('Latest saved drill opened.'); }
        else notify('This drill is no longer available. Keep your draft as a new drill to preserve it.', true);
      } else if (force || conflict) notify(conflict ? 'Saved drills refreshed. Open the latest saved drill or keep your draft as a new drill.' : 'Saved drills refreshed.');
      renderList(); renderSuggestions();
    } catch (error) { if (ticket === epoch && identity === started) notify(error.message || 'Your library could not load. Try again.', true); }
    finally { if (ticket === epoch && identity === started) { loading = false; renderState(); } }
  }
  async function persist(attempt) {
    if (locked()) return;
    const ticket = ++epoch, started = identity, privateVariation = !!record.variation; writing = true; recovery = null; renderState();
    notify(attempt.operation === 'archive' ? 'Archiving drill…' : 'Saving drill…');
    try {
      const result = await request(attempt.operation, clone(attempt.payload)); if (ticket !== epoch || identity !== started) return;
      if (attempt.operation === 'save') {
        const saved = validateRows([result.drill])[0]; if (!matchesSaved(saved, attempt.payload)) throw Error('The save could not be verified. Refresh the library before changing this draft.');
        records = [saved, ...records.filter(drill => drill.id !== saved.id)]; writeEditor(saved, true);
        if (privateVariation) { sourceFilter.value = 'saved'; focus.value = 'all'; search.value = ageFilter.value = skillFilter.value = durationFilter.value = typeFilter.value = ''; historyLimit = 8; }
        notify('Reusable ' + typeName(saved).toLowerCase() + ' saved. Session plans stay unchanged until you add it.');
      } else {
        if (result.saved !== true) throw Error('The archive could not be verified.');
        records = records.filter(drill => drill.id !== attempt.payload.id); if (record.id === attempt.payload.id) writeEditor(); notify('Drill archived. Previously saved plans stay unchanged.');
      }
      renderList(); renderSuggestions();
    } catch (error) {
      if (ticket !== epoch || identity !== started) return;
      if (!error.code) recovery = clone(attempt);
      if (error.code === 'DRILL_CHANGED' && attempt.operation === 'save' && attempt.payload.id === record.id) conflict = true;
      notify(error.code ? error.message || 'The drill could not be saved. Review or refresh it.' : 'The result could not be verified. Refresh the library or retry the exact same action; your draft is kept.', true);
    } finally { if (ticket === epoch && identity === started) { writing = false; renderState(); } }
  }
  window.addEventListener('coach:library-prefill', event => {
    const value = event.detail || {}, drill = value.drill;
    const catalogIdea = catalogs.get(value.source)?.some(item => item.id === drill?.id);
    const sessionIdea = !standalone() && !!context?.session?.id && value.sessionId === context.session.id;
    if (!ready() || locked() || recovery || !catalogIdea && !sessionIdea || !drill || !Object.hasOwn(targets, drill.target) || !Number.isInteger(drill.minutes) || drill.minutes < 1 || drill.minutes > 120) return;
    const draft = { ...blank() };
    for (const key of fields) {
      const text = drill[key] ?? '';
      if (key === 'minutes') draft[key] = text;
      else { if (typeof text !== 'string' || text.length > (['title', 'skill'].includes(key) ? 80 : key === 'target' ? 20 : 2000)) return; draft[key] = text.trim(); }
    }
    if (!draft.title || !draft.setup) return;
    if (catalogIdea && drill.diagram) draft.diagram = clone(drill.diagram);
    if (dirty() && !confirm('Replace your unsaved drill with this practice idea?')) return;
    if (drill.diagram) draft.diagram = clone(drill.diagram);
    if (catalogIdea) { draft.title = draft.title.slice(0, 68) + ' (variation)'; draft.variation = true; }
    writeEditor(draft); baseline = fingerprint(blank()); disclosure.open = true; editor.hidden = false; openDiagram(); renderState();
    notify(catalogIdea ? 'Private variation draft. Your changes will stay in your private drill library; the original remains unchanged.' : 'Practice idea copied to a new drill draft. Review it and choose Save drill to keep it.'); focusEditor();
  });
  window.addEventListener('coach:context', event => {
    const next = event.detail, nextIdentity = next?.profile ? [next.profile.email, next.profile.role, next.profile.sessionVersion, next.session?.id || ''].join(':') : '';
    if (nextIdentity !== identity || next?.tab !== context?.tab) closeView(false);
    if (pendingUse && (accountKey(next) !== pendingUse.account || !['library', 'plan'].includes(next?.tab) || pendingUse.navigated && next.tab !== 'plan' || ![pendingUse.fromSession, pendingUse.sessionId].includes(next.session?.id || '') || next.tab === 'plan' && next.session?.id !== pendingUse.sessionId)) pendingUse = null;
    if (pendingUse && next.tab === 'plan' && next.session?.id === pendingUse.sessionId) pendingUse.navigated = true;
    if (nextIdentity !== identity || next?.tab !== 'library') closeSessionPicker(false);
    if (nextIdentity !== identity || next?.tab !== 'library') closeDiagram();
    if (nextIdentity !== identity) {
      epoch++; writing = loading = false; records = []; loaded = false; recovery = lastAttempt = null; identity = nextIdentity; context = next;
      disclosure.open = advancedFilters.open = false; search.value = ''; focus.value = sourceFilter.value = 'all'; ageFilter.value = skillFilter.value = durationFilter.value = typeFilter.value = ''; scope.value = ''; historyLimit = 8; suggestionInputs = null; writeEditor(); notify(''); list.replaceChildren(); recommendationList.replaceChildren(); results.textContent = ''; scope.replaceChildren(); skillFilter.replaceChildren(...select('', [['', 'Every skill focus']]).options);
    } else context = next;
    if (!next?.profile) { mount.hidden = true; sessionAnchor.after(mount); return; }
    const root = standalone() ? $('standalone-drill-library') : sessionHome;
    if (mount.parentNode !== root) {
      if (standalone()) root.append(mount); else sessionAnchor.after(mount);
      editor.hidden = standalone() && !dirty();
      if (standalone()) body.prepend(editor); else body.append(editor);
      if (standalone() && !editor.hidden) openDiagram();
      disclosure.open = standalone();
    }
    disclosure.querySelector('summary').hidden = standalone();
    mount.classList.toggle('library-standalone', standalone());
    mount.hidden = false; if (ready() && !list.children.length) renderList(); renderState(); renderSuggestions();
    if (standalone() && !loaded && !loading) { disclosure.open = true; load(); }
  });
  writeEditor(); emit('coach:request-context');
})();
