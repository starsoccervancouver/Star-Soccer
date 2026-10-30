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
  let context = null, identity = '', epoch = 0, records = [], loaded = false, loading = false, writing = false;
  let record = blank(), baseline = '', recovery = null, lastAttempt = null, historyLimit = 8, suggestionInputs = null;
  const permitted = drill => context?.profile && (['owner', 'admin'].includes(context.profile.role) || drill.author_email === context.profile.email);
  const standalone = () => context?.tab === 'library';
  const ready = () => !!context?.profile && ['plan', 'library'].includes(context.tab);
  const sessionHome = mount.parentNode, sessionAnchor = document.createComment('session drill library'); sessionHome.insertBefore(sessionAnchor, mount);
  const locked = () => !ready() || !!context.busy || writing || loading;
  const canInsert = () => !locked() && !standalone() && context.planReady && context.session?.status !== 'Cancelled';
  const values = () => Object.fromEntries(fields.map(key => [key, key === 'minutes' ? Number($('library-' + key).value) : $('library-' + key).value.trim()]));
  const fingerprint = value => JSON.stringify(Object.fromEntries(fields.map(key => [key, value[key]])));
  const dirty = () => !!identity && (Boolean(recovery) || fingerprint(values()) !== baseline);
  const request = (operation, payload) => new Promise((resolve, reject) => emit('coach:library-request', { operation, payload, resolve, reject }));
  const notify = (text, error = false) => { $('library-status').textContent = text; $('library-status').setAttribute('role', error ? 'alert' : 'status'); };
  function action(text, handler, cls = 'secondary') { const b = node('button', text, cls); b.type = 'button'; b.addEventListener('click', handler); return b; }
  function label(text, control) { const el = node('label', text); el.htmlFor = control.id; el.append(control); return el; }
  function select(id, entries) { const el = node('select'); el.id = id; entries.forEach(([value, text]) => { const option = node('option', text); option.value = value; el.append(option); }); return el; }
  function writeEditor(next = blank()) {
    record = clone(next); for (const key of fields) $('library-' + key).value = record[key] ?? '';
    baseline = fingerprint(values()); recovery = null; lastAttempt = null;
    $('library-editor-title').textContent = record.id ? 'Edit reusable drill' : 'Create a reusable drill';
    renderState();
  }
  function discard() { if (writing) return; writeEditor(); if (standalone()) editor.hidden = true; notify(''); }
  window.CoachLibrary = Object.freeze({ isDirty: dirty, isBusy: () => writing, discard });

  const newDrill = action('New drill', () => { if (locked() || recovery) return; if (dirty() && !confirm('Start a new drill and discard this draft?')) return; writeEditor(); editor.hidden = false; $('library-title').focus(); }, 'button'); newDrill.id = 'library-new';
  const disclosure = node('details', '', 'coaching-tools-disclosure library-disclosure'); disclosure.id = 'library-disclosure';
  disclosure.append(node('summary', 'Your drill library & suggested practice'));
  const body = node('div', '', 'library-body');
  body.append(node('h2', 'Keep good drills close'), node('p', 'Save reusable practice ideas here. Your drills are private to you and approved full-access coaches. Add one to a session only when you choose.', 'small'));
  const status = node('p', '', 'library-status'); status.id = 'library-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); body.append(status);
  const filters = node('div', '', 'library-filters'), search = node('input'); search.id = 'library-search'; search.type = 'search'; search.placeholder = 'Title, focus or setup'; search.autocomplete = 'off';
  const focus = select('library-filter', [['all', 'Every plan section'], ...Object.entries(targets)]);
  filters.append(label('Find a saved drill', search), label('Plan section', focus));
  const reload = action('Load saved drills', () => load(true)); reload.id = 'library-reload';
  filters.append(reload, newDrill); body.append(filters);
  const results = node('p', '', 'small'); results.id = 'library-results'; results.setAttribute('role', 'status'); body.append(results);
  const list = node('div', '', 'library-list'); list.id = 'library-list'; body.append(list);
  const more = action('Show more drills', () => { historyLimit += 8; renderList(); }); more.id = 'library-more'; more.hidden = true; body.append(more);
  const suggestions = node('section', '', 'library-suggestions'); suggestions.setAttribute('aria-labelledby', 'library-suggestions-title');
  const suggestionTitle = node('h3', 'Ideas from your coaching notes'); suggestionTitle.id = 'library-suggestions-title';
  suggestions.append(suggestionTitle, node('p', 'Simple keyword matches in notes you can access for this group or selected player. These are starting points to review, not assessments. Notes are not sent to an AI service or copied into the shared plan.', 'small'));
  const scope = select('library-note-scope', [['', 'Group notes only']]); suggestions.append(label('Use notes for', scope));
  const recommendationList = node('div', '', 'library-recommendations'); recommendationList.id = 'library-recommendations'; suggestions.append(recommendationList); body.append(suggestions);
  const editor = node('form', '', 'library-editor'); editor.id = 'library-form';
  const editorTitle = node('h3', 'Create a reusable drill'); editorTitle.id = 'library-editor-title'; editor.append(editorTitle);
  editor.append(node('p', 'Describe the activity without player names or private observations so it can be reused safely.', 'small'));
  const grid = node('div', '', 'library-editor-grid');
  for (const [key, title, maximum, required] of [['title', 'Drill name', 80, true], ['skill', 'Skill focus', 80, false]]) {
    const input = node('input'); input.id = 'library-' + key; input.maxLength = maximum; input.required = required; input.autocomplete = 'off'; grid.append(label(title, input));
  }
  const minutes = node('input'); minutes.id = 'library-minutes'; minutes.type = 'number'; minutes.min = '1'; minutes.max = '120'; minutes.step = '1'; minutes.required = true;
  grid.append(label('Minutes', minutes), label('Add to', select('library-target', Object.entries(targets)))); editor.append(grid);
  for (const [key, title] of [['setup', 'Setup & instructions'], ['coaching', 'Coaching points (optional)'], ['progression', 'Adaptations (optional)'], ['equipment', 'Equipment (optional)']]) {
    const field = node('textarea'); field.id = 'library-' + key; field.rows = key === 'setup' ? 4 : 2; field.maxLength = 2000; field.required = key === 'setup'; editor.append(label(title, field));
  }
  const editorActions = node('div', '', 'library-actions'), save = node('button', 'Save drill', 'button'); save.id = 'library-save'; save.type = 'submit';
  const cancel = action('Clear draft', () => { if (locked()) return; if (dirty() && !confirm('Discard this unsaved drill?')) return; discard(); }); cancel.id = 'library-cancel';
  const retry = action('Retry same save', () => { if (recovery && !locked()) persist(recovery); }); retry.id = 'library-retry'; retry.hidden = true;
  editorActions.append(save, cancel, retry); editor.append(editorActions);
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
  search.addEventListener('input', () => { historyLimit = 8; renderList(); }); focus.addEventListener('change', () => { historyLimit = 8; renderList(); });
  scope.addEventListener('change', renderSuggestions);
  disclosure.addEventListener('toggle', () => { if (disclosure.open && ready() && !loaded && !loading) load(); });
  editor.addEventListener('submit', event => {
    event.preventDefault(); if (locked() || recovery || !editor.reportValidity()) return;
    const draft = values(), signature = fingerprint(draft);
    const payload = { id: record.id, ...draft, diagram: record.diagram || null, expectedVersion: record.version || 0 };
    if (!record.id) payload.requestId = lastAttempt?.signature === signature ? lastAttempt.payload.requestId : crypto.randomUUID();
    lastAttempt = { signature, payload }; persist({ operation: 'save', payload });
  });
  function renderState() {
    for (const field of editor.querySelectorAll('input,select,textarea')) field.disabled = locked() || !!recovery;
    save.disabled = locked() || !!recovery; cancel.disabled = locked(); retry.disabled = locked();
    cancel.hidden = !record.id && !dirty(); retry.hidden = !recovery; retry.textContent = recovery?.operation === 'archive' ? 'Retry same archive' : 'Retry same save';
    newDrill.hidden = !standalone(); newDrill.disabled = locked() || !!recovery;
    suggestions.hidden = reuse.hidden = standalone();
    capture.disabled = !canInsert() || !!recovery; reload.disabled = locked() || loading;
    search.disabled = focus.disabled = scope.disabled = locked();
    reload.textContent = loading ? 'Loading…' : loaded ? 'Refresh saved drills' : 'Load saved drills';
    save.textContent = writing ? 'Saving…' : record.id ? 'Save changes' : 'Save drill';
    for (const el of list.querySelectorAll('button')) { el.disabled = locked() || !!recovery || (el.dataset.insert === 'true' && !canInsert()); if (el.dataset.insert === 'true') el.hidden = standalone(); }
    for (const el of recommendationList.querySelectorAll('button')) el.disabled = !canInsert() || !!recovery;
    emit('coach:library-state', { starterEnabled:standalone() && !locked() && !recovery, loaded, count:records.length });
  }
  function insert(drill) {
    if (!canInsert() || recovery) return;
    const text = drill.title + ' (' + drill.minutes + ' min)\n' + drill.setup + (drill.coaching ? '\nCoach: ' + drill.coaching : '') + (drill.progression ? '\nAdapt: ' + drill.progression : '') + (drill.equipment ? '\nEquipment: ' + drill.equipment : '');
    emit('coach:insert-plan', { target: drill.target, text }); notify('Activity offered to your plan draft. Review it and save the shared plan when ready.');
  }
  function edit(drill) {
    if (locked() || recovery || !permitted(drill)) return;
    if (dirty() && !confirm('Edit this drill and discard the current unsaved drill?')) return;
    writeEditor(drill); editor.hidden = false; notify(''); $('library-title').focus();
  }
  function renderList() {
    const query = search.value.trim().toLowerCase();
    const matching = records.filter(permitted).filter(drill => (focus.value === 'all' || drill.target === focus.value) && (!query || [drill.title, drill.skill, drill.setup, drill.coaching, drill.progression, drill.equipment].join(' ').toLowerCase().includes(query))).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)) || a.title.localeCompare(b.title));
    results.textContent = loaded ? Math.min(matching.length, historyLimit) + ' of ' + matching.length + ' matching drills' : 'Open or load your library to see saved drills.';
    list.replaceChildren();
    for (const drill of matching.slice(0, historyLimit)) {
      const card = node('article', '', 'library-card'); card.dataset.drillId = drill.id;
      card.append(node('h3', drill.title), node('p', [drill.skill, drill.minutes + ' min', targets[drill.target]].filter(Boolean).join(' · '), 'small'), node('p', drill.setup, 'library-instructions'));
      if (drill.coaching) card.append(node('p', 'Coach: ' + drill.coaching));
      if (drill.progression) card.append(node('p', 'Adapt: ' + drill.progression));
      if (drill.equipment) card.append(node('p', 'Equipment: ' + drill.equipment, 'small'));
      card.append(node('p', drill.author_email === context.profile.email ? 'Your reusable drill' : 'Shared with full-access coaches · ' + drill.author_email, 'small'));
      const actions = node('div', '', 'library-actions'), add = action('Add to ' + targets[drill.target].toLowerCase(), () => insert(drill)); add.dataset.insert = 'true';
      const change = action('Edit drill', () => edit(drill)), archive = action('Archive drill', () => {
        if (locked() || recovery || !permitted(drill)) return;
        if (dirty()) return notify('Save or clear your current drill draft before archiving.', true);
        if (confirm('Archive this reusable drill? Saved session plans will stay unchanged.')) persist({ operation: 'archive', payload: { id: drill.id, expectedVersion: drill.version } });
      });
      actions.append(add, change, archive); card.append(actions); list.append(card);
    }
    if (loaded && !matching.length) list.append(node('p', records.length ? 'No saved drills match these filters.' : 'Your library is empty. Save a useful activity below to reuse it.', 'empty-state'));
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
  function matchesSaved(drill, payload) { return drill && (!payload.id || drill.id === payload.id) && drill.version >= payload.expectedVersion + 1 && fingerprint(drill) === fingerprint(payload) && JSON.stringify(drill.diagram || null) === JSON.stringify(payload.diagram || null) && (payload.id || drill.request_id === payload.requestId); }
  async function load(force = false) {
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
      else notify('Saved drills refreshed.');
      renderList(); renderSuggestions();
    } catch (error) { if (ticket === epoch && identity === started) notify(error.message || 'Your library could not load. Try again.', true); }
    finally { if (ticket === epoch && identity === started) { loading = false; renderState(); } }
  }
  async function persist(attempt) {
    if (locked()) return;
    const ticket = ++epoch, started = identity; writing = true; recovery = null; renderState();
    notify(attempt.operation === 'archive' ? 'Archiving drill…' : 'Saving drill…');
    try {
      const result = await request(attempt.operation, clone(attempt.payload)); if (ticket !== epoch || identity !== started) return;
      if (attempt.operation === 'save') {
        const saved = validateRows([result.drill])[0]; if (!matchesSaved(saved, attempt.payload)) throw Error('The save could not be verified. Refresh the library before changing this draft.');
        records = [saved, ...records.filter(drill => drill.id !== saved.id)]; writeEditor(saved); if (standalone()) editor.hidden = true; notify('Reusable drill saved. Session plans stay unchanged until you add it.');
      } else {
        if (result.saved !== true) throw Error('The archive could not be verified.');
        records = records.filter(drill => drill.id !== attempt.payload.id); if (record.id === attempt.payload.id) writeEditor(); notify('Drill archived. Previously saved plans stay unchanged.');
      }
      renderList(); renderSuggestions();
    } catch (error) {
      if (ticket !== epoch || identity !== started) return;
      if (!error.code) recovery = clone(attempt);
      notify(error.code ? error.message || 'The drill could not be saved. Review or refresh it.' : 'The result could not be verified. Refresh the library or retry the exact same action; your draft is kept.', true);
    } finally { if (ticket === epoch && identity === started) { writing = false; renderState(); } }
  }
  window.addEventListener('coach:library-prefill', event => {
    const value = event.detail || {}, drill = value.drill;
    const starter = value.source === 'starter' && standalone();
    if (!ready() || locked() || recovery || !starter && value.sessionId !== context.session?.id || !drill || !Object.hasOwn(targets, drill.target) || !Number.isInteger(drill.minutes) || drill.minutes < 1 || drill.minutes > 120) return;
    const draft = { ...blank() };
    for (const key of fields) {
      const text = drill[key] ?? '';
      if (key === 'minutes') draft[key] = text;
      else { if (typeof text !== 'string' || text.length > (['title', 'skill'].includes(key) ? 80 : key === 'target' ? 20 : 2000)) return; draft[key] = text.trim(); }
    }
    if (!draft.title || !draft.setup) return;
    if (dirty() && !confirm('Replace your unsaved drill with this practice idea?')) return;
    writeEditor(draft); baseline = fingerprint(blank()); disclosure.open = true; editor.hidden = false; renderState();
    notify('Practice idea copied to a new drill draft. Review it and choose Save drill to keep it.'); $('library-title').focus();
  });
  window.addEventListener('coach:context', event => {
    const next = event.detail, nextIdentity = next?.profile ? [next.profile.email, next.profile.role, next.profile.sessionVersion, next.session?.id || ''].join(':') : '';
    if (nextIdentity !== identity) {
      epoch++; writing = loading = false; records = []; loaded = false; recovery = lastAttempt = null; identity = nextIdentity; context = next;
      disclosure.open = false; search.value = ''; focus.value = 'all'; scope.value = ''; historyLimit = 8; suggestionInputs = null; writeEditor(); notify(''); list.replaceChildren(); recommendationList.replaceChildren(); results.textContent = ''; scope.replaceChildren();
    } else context = next;
    if (!next?.profile) { mount.hidden = true; sessionAnchor.after(mount); return; }
    const root = standalone() ? $('standalone-drill-library') : sessionHome;
    if (mount.parentNode !== root) {
      if (standalone()) root.append(mount); else sessionAnchor.after(mount);
      editor.hidden = standalone() && !dirty();
      if (standalone()) results.before(editor); else body.append(editor);
      disclosure.open = standalone();
    }
    disclosure.querySelector('summary').hidden = standalone();
    mount.classList.toggle('library-standalone', standalone());
    mount.hidden = false; renderState(); renderSuggestions();
    if (standalone() && !loaded && !loading) { disclosure.open = true; load(); }
  });
  writeEditor(); emit('coach:request-context');
})();
