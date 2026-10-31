/* Activity drafts live in memory and save only through the existing shared-plan form. */
(() => {
  'use strict';
  const mount = document.getElementById('plan-activities');
  if (!mount) return;
  const stages = { warmup: 'Warm-up', technical: 'Technical', game: 'Game / application', other: 'Break / other' };
  const playerColors = { blue: '#326887', gold: '#d9ae63', red: '#b64d49', green: '#397561', purple: '#79549d', white: '#f5f2e9' };
  const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; };
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const maxPlanBytes = 62000;
  const legacyKeys = ['focus', 'warmup', 'technical', 'game', 'equipment', 'reflection'];
  let saved, draft, session = null, context = null, loadedSessionId = null, enabled = false;
  // Mirror the bounded tactics shape for immediate draft feedback. The server
  // remains authoritative through the shared validateDiagram validator.
  function diagramCopy(value) {
    const object = (value, required, optional = []) => value && typeof value === 'object' && !Array.isArray(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
    const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value);
    const text = (value, max, multiline = false) => typeof value === 'string' && value.length <= max && !(multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(value);
    const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
    if (!object(value, ['schemaVersion', 'pitch', 'items', 'frames'], ['purpose']) || Object.hasOwn(value, 'purpose') && !['drill', 'team-pattern'].includes(value.purpose) || value.schemaVersion !== 1 || !['full', 'half', 'blank', 'facing-goal', 'away-from-goal'].includes(value.pitch) || !Array.isArray(value.items) || value.items.length > 40 || !Array.isArray(value.frames) || !value.frames.length || value.frames.length > 12) return null;
    const kinds = new Map(), frames = new Set();
    for (const item of value.items) {
      if (!object(item, ['id', 'kind', 'label'], ['zone', 'color']) || !id(item.id) || kinds.has(item.id) || !['home', 'away', 'cone', 'ball', 'goal', 'zone'].includes(item.kind) || !text(item.label, 12)) return null;
      if (Object.hasOwn(item, 'color') && (!['home', 'away'].includes(item.kind) || typeof item.color !== 'string' || !Object.hasOwn(playerColors, item.color))) return null;
      kinds.set(item.id, item.kind);
      if (item.kind === 'zone') {
        if (!object(item.zone, ['shape', 'width', 'height', 'color'], ['outline']) || Object.hasOwn(item.zone, 'outline') && typeof item.zone.outline !== 'boolean' || !['rect', 'ellipse'].includes(item.zone.shape) || !['blue', 'gold', 'green'].includes(item.zone.color) || !number(item.zone.width, 5, 90) || !number(item.zone.height, 5, 90)) return null;
      } else if (Object.hasOwn(item, 'zone')) return null;
    }
    for (const frame of value.frames) {
      if (!object(frame, ['id', 'title', 'duration', 'positions'], ['notes', 'arrows']) || !id(frame.id) || frames.has(frame.id) || !text(frame.title, 80) || !number(frame.duration, .5, 20) || !Array.isArray(frame.positions) || frame.positions.length !== value.items.length || Object.hasOwn(frame, 'notes') && !text(frame.notes, 1000, true)) return null;
      frames.add(frame.id); const seen = new Set();
      for (const position of frame.positions) {
        if (!object(position, ['id', 'x', 'y'], ['curve', 'attachedTo', 'trail', 'rotation', 'facing', 'shadow']) || !kinds.has(position.id) || seen.has(position.id) || !number(position.x, 0, 100) || !number(position.y, 0, 100) || Object.hasOwn(position, 'curve') && !number(position.curve, -50, 50)) return null;
        seen.add(position.id);
        if (Object.hasOwn(position, 'facing') && (!['home', 'away'].includes(kinds.get(position.id)) || !number(position.facing, 0, 360) || position.facing === 360)) return null;
        if (Object.hasOwn(position, 'shadow') && (!['home', 'away'].includes(kinds.get(position.id)) || !object(position.shadow, ['length', 'width']) || !number(position.shadow.length, 5, 60) || !number(position.shadow.width, 5, 60))) return null;
        if (Object.hasOwn(position, 'rotation') && (kinds.get(position.id) !== 'goal' || !number(position.rotation, 0, 360) || position.rotation === 360)) return null;
        if (Object.hasOwn(position, 'attachedTo') && (kinds.get(position.id) !== 'ball' || !['home', 'away'].includes(kinds.get(position.attachedTo)))) return null;
        if (Object.hasOwn(position, 'trail') && (!['home', 'away', 'ball'].includes(kinds.get(position.id)) || !Array.isArray(position.trail) || !position.trail.length || position.trail.length > 32 || position.trail.some(point => !object(point, ['x', 'y']) || !number(point.x, 0, 100) || !number(point.y, 0, 100)))) return null;
      }
      if (Object.hasOwn(frame, 'arrows')) {
        if (!Array.isArray(frame.arrows) || frame.arrows.length > 24) return null;
        const arrowIds = new Set();
        for (const arrow of frame.arrows) {
          if (!object(arrow, ['id', 'x1', 'y1', 'x2', 'y2', 'color'], ['points']) || !id(arrow.id) || arrowIds.has(arrow.id) || !['x1', 'y1', 'x2', 'y2'].every(key => number(arrow[key], 0, 100)) || typeof arrow.color !== 'string' || !(Object.hasOwn(playerColors, arrow.color) || arrow.color === 'charcoal')) return null;
          if (Object.hasOwn(arrow, 'points') && (!Array.isArray(arrow.points) || !arrow.points.length || arrow.points.length > 32 || arrow.points.some(p => !object(p, ['x', 'y']) || !number(p.x, 0, 100) || !number(p.y, 0, 100)))) return null;
          arrowIds.add(arrow.id);
        }
      }
    }
    try { const json = JSON.stringify(value); return new TextEncoder().encode(json).length <= 56000 ? JSON.parse(json) : null; } catch { return null; }
  }
  function withinBudget(blocks = draft) {
    const content = Object.fromEntries(legacyKeys.map(key => [key, document.getElementById('plan-' + key)?.value ?? context?.plan?.content?.[key] ?? '']));
    if (blocks !== undefined) content.activities = blocks;
    return new TextEncoder().encode(JSON.stringify(content)).length <= maxPlanBytes;
  }
  function previewDiagram(value, title = 'Activity diagram') {
    const diagram = diagramCopy(value); if (!diagram) return null;
    const figure = node('figure', '', 'plan-block-diagram-preview');
    const svg = (tag, attrs, label) => { const el = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value); if (label) el.textContent = label; return el; };
    let image = window.CoachTactics?.preview?.(diagram);
    if (!image) {
      image = svg('svg', { viewBox: '0 0 200 130', 'aria-hidden': 'true' });
      image.append(svg('rect', { width: 200, height: 130, fill: '#e3ebdc' }), svg('rect', { x: 5, y: 5, width: 190, height: 120, fill: 'none', stroke: '#8ea58b' }));
      for (const item of diagram.items) {
        const p = diagram.frames[0].positions.find(position => position.id === item.id), x = p.x * 2, y = p.y * 1.3;
        if (item.kind === 'zone') { image.append(svg(item.zone.shape === 'ellipse' ? 'ellipse' : 'rect', item.zone.shape === 'ellipse' ? { cx: x, cy: y, rx: item.zone.width, ry: item.zone.height * .65, fill: item.zone.outline ? 'none' : '#537b782b', stroke: '#537b78' } : { x: x - item.zone.width, y: y - item.zone.height * .65, width: item.zone.width * 2, height: item.zone.height * 1.3, fill: item.zone.outline ? 'none' : '#537b782b', stroke: '#537b78' })); continue; }
        image.append(svg(item.kind === 'cone' ? 'path' : item.kind === 'goal' ? 'rect' : 'circle', item.kind === 'cone' ? { d: 'M' + x + ' ' + (y - 5) + 'l-4 9h8z', fill: '#bf762c' } : item.kind === 'goal' ? { x: x - 7, y: y - 4, width: 14, height: 8, fill: 'none', stroke: '#414849' } : { cx: x, cy: y, r: item.kind === 'ball' ? 3 : 5, fill: item.kind === 'ball' ? '#fff' : playerColors[item.color || (item.kind === 'home' ? 'blue' : 'gold')], stroke: '#414849' }));
        if (item.label) image.append(svg('text', { x, y: y - 7, 'text-anchor': 'middle', 'font-size': 7, fill: '#263332' }, item.label));
      }
      for (const arrow of diagram.frames[0].arrows || []) {
        const x1 = arrow.x1 * 2, y1 = arrow.y1 * 1.3, x2 = arrow.x2 * 2, y2 = arrow.y2 * 1.3;
        const points = [{x:x1,y:y1},...(arrow.points || []).map(p=>({x:p.x*2,y:p.y*1.3})),{x:x2,y:y2}], previous = points.slice(0,-1).reverse().find(p=>Math.hypot(x2-p.x,y2-p.y)>.01) || points[0];
        const angle = Math.atan2(y2 - previous.y, x2 - previous.x), length = points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0), head = Math.min(5,length*.45), color = playerColors[arrow.color] || '#38434a';
        let d='M'+x1+' '+y1;for(let i=1;i<points.length-1;i++){const p=points[i],next=points[i+1];d+=' Q'+p.x+' '+p.y+' '+(p.x+next.x)/2+' '+(p.y+next.y)/2;}d+=' L'+x2+' '+y2;
        const group = svg('g', { 'data-preview-arrow': arrow.id });
        group.append(arrow.points?.length ? svg('path',{d,fill:'none',stroke:color,'stroke-width':1.2,'stroke-linecap':'round','stroke-linejoin':'round'}) : svg('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': 1.2 }), svg('polygon', { points: [[x2, y2], [x2 - head * Math.cos(angle - .45), y2 - head * Math.sin(angle - .45)], [x2 - head * Math.cos(angle + .45), y2 - head * Math.sin(angle + .45)]].map(point => point.join(',')).join(' '), fill: color }));
        image.append(group);
      }
    }
    figure.append(image, node('figcaption', title + ' · ' + (diagram.frames[0].title || 'Starting positions') + (diagram.frames.length > 1 ? ' · ' + diagram.frames.length + ' saved phases' : '')));
    return figure;
  }
  const originals = new Map();
  for (const key of ['warmup', 'technical', 'game']) { const label = document.getElementById('plan-' + key)?.closest('label'); const text = label && [...label.childNodes].find(child => child.nodeType === 3 && child.textContent.trim()); if (text) originals.set(key, { text, value: text.textContent }); }
  function recordedMinutes(value) {
    if (!value) return null;
    const start = Date.parse(value.startAt), end = Date.parse(value.endAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 86400000) return (end - start) / 60000;
    const parts = String(value.time || '').toLowerCase().replace(/\b(?:12(?::00)?\s*)?noon\b/g, '12:00 pm').split(/[–—-]/);
    const parse = s => { const m = s?.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/); return m && +m[1] <= (m[3] ? 12 : 23) && (!m[3] || +m[1] > 0) && +(m[2] || 0) < 60 ? { h: +m[1], m: +(m[2] || 0), p: m[3] || '' } : null; };
    if (parts.length !== 2) return null;
    const from = parse(parts[0]), to = parse(parts[1]); if (!from || !to) return null;
    const inherited = !from.p && !!to.p && from.h >= 1 && from.h <= 12; if (inherited) from.p = to.p;
    const mins = v => (v.p ? v.h % 12 + (v.p === 'pm' ? 12 : 0) : v.h) * 60 + v.m;
    let first = mins(from), last = mins(to); if (inherited && first > last && to.p === 'pm') first -= 720;
    return last > first && last - first <= 720 ? last - first : null;
  }
  function budget() {
    const total = (draft || []).reduce((sum, block) => sum + (Number(block.duration) || 0), 0), slot = recordedMinutes(session), el = mount.querySelector('.plan-block-budget');
    if (!el) return;
    el.hidden = !draft?.length;
    el.textContent = total + ' minutes planned' + (slot === null ? ' · Session length not recorded.' : ' / ' + slot + '-minute session · ' + (total > slot ? (total - slot) + ' minutes over.' : total < slot ? (slot - total) + ' minutes available for transitions.' : 'Fits the session.'));
    el.classList.toggle('is-over-budget', slot !== null && total > slot);
  }
  function labels() {
    for (const [key, value] of originals) value.text.textContent = ({ warmup: 'Warm-up notes', technical: 'Technical notes', game: 'Game notes' })[key];
    const summary = document.querySelector('#plan-supporting-notes > summary');
    if (summary) {
      const count = ['warmup', 'technical', 'game'].filter(key => document.getElementById('plan-' + key)?.value.trim()).length;
      summary.textContent = 'Supporting coaching notes' + (count ? ' · ' + count + ' filled' : '');
    }
  }
  function changed(message) {
    labels(); budget();
    const status = mount.querySelector('.plan-block-status'); if (status && message !== undefined) status.textContent = message;
    window.dispatchEvent(new CustomEvent('coach:blocks-changed'));
  }
  function button(text, action, label) { const el = node('button', text, 'secondary'); el.type = 'button'; if (label) el.setAttribute('aria-label', label); el.addEventListener('click', () => { if (enabled && !el.disabled && el.dataset.boundary !== 'true') action(); }); return el; }
  function setEnabled(value) {
    enabled = !!value;
    mount.querySelectorAll('input,textarea,select,button').forEach(el => { el.disabled = !enabled || el.dataset.boundary === 'true'; });
  }
  const canEdit = () => enabled && !!context?.profile && context.tab === 'plan' && context.planReady && !context.busy && !!session?.id && context.selected === session.id && loadedSessionId === session.id && String(session.status).toLowerCase() !== 'cancelled';
  function attachCurrentDiagram(index) {
    if (!canEdit() || !draft?.[index]) return;
    const current = window.CoachTactics?.getDraft();
    if (!current || current.sessionId !== session.id) return changed('Open Drills & tactics for this session, prepare a setup, then use its draft here.');
    const diagram = diagramCopy(current.diagram);
    if (!diagram) return changed('This tactics draft could not be attached. Check its pieces and phases.');
    const next = draft.map((block, at) => at === index ? { ...block, diagram } : block);
    if (!withinBudget(next)) return changed('This plan is too large to save. Remove a diagram or shorten the plan before attaching another.');
    if (draft[index].diagram && !confirm('Replace this activity’s diagram with the current tactics draft? Save the shared plan to keep the change.')) return;
    draft = next; render(-1, 'Diagram copied into this activity. Save the shared plan to keep both together.'); changed();
  }
  function render(focusIndex = -1, message = '') {
    mount.replaceChildren();
    const heading = node('div', '', 'plan-blocks-heading'); heading.append(node('h3', 'Activity sequence'), node('span', draft?.length ? draft.length + ' / 16 activities' : 'Timed running order', 'small'));
    mount.append(heading);
    const tools = node('div', '', 'plan-blocks-tools');
    const add = button('Add activity', () => { draft = [...(draft || []), { title: '', duration: 10, stage: 'warmup', instructions: '', equipment: '' }]; render(draft.length - 1, 'Activity added to your draft. Save the shared plan when ready.'); changed(); }); add.id = 'plan-add-activity'; add.dataset.boundary = String((draft?.length || 0) >= 16); tools.append(add);
    if (!draft?.length) for (const [key, title] of [['touch', 'First-touch starter'], ['passing', 'Passing starter']]) tools.append(button(title, () => { draft = starter(key); render(0, 'Starter added to your draft. Adapt it for your group, then save the shared plan.'); changed(); }));
    mount.append(tools);
    const total = node('p', '', 'plan-block-budget'); total.setAttribute('role', 'status'); mount.append(total);
    const list = node('ol', '', 'plan-block-list');
    (draft || []).forEach((block, index) => {
      const item = node('li', '', 'plan-block'), head = node('div', '', 'plan-block-head'), actions = node('div', '', 'plan-block-actions'); item.dataset.blockIndex = String(index);
      head.append(node('h4', 'Activity ' + (index + 1)));
      for (const [text, offset] of [['Move up', -1], ['Move down', 1]]) { const move = button(text, () => { const target = index + offset; [draft[index], draft[target]] = [draft[target], draft[index]]; render(target, 'Activity moved to position ' + (target + 1) + '.'); changed(); }, text + ' activity ' + (index + 1)); move.dataset.boundary = String(index + offset < 0 || index + offset >= draft.length); actions.append(move); }
      actions.append(button('Remove', () => { if ((block.title.trim() || block.instructions.trim() || block.equipment.trim()) && !confirm('Remove this activity from your draft? This takes effect when you save the shared plan.')) return; draft.splice(index, 1); render(Math.min(index, draft.length - 1), 'Activity removed from your draft.'); changed(); if (!draft.length) document.getElementById('plan-add-activity').focus(); }, 'Remove activity ' + (index + 1)));
      head.append(actions); item.append(head);
      const fields = node('div', '', 'plan-block-fields');
      for (const [key, title, tag, max] of [['title', 'Activity title', 'input', 120], ['duration', 'Minutes', 'input', 120], ['stage', 'Stage', 'select', 0], ['instructions', 'Setup, coaching points & progressions', 'textarea', 2000], ['equipment', 'Equipment for this activity', 'input', 500]]) {
        const label = node('label', title, ['stage', 'instructions', 'equipment'].includes(key) ? 'plan-block-wide' : ''), field = node(tag); field.id = 'plan-block-' + index + '-' + key; field.dataset.blockField = key; label.htmlFor = field.id;
        if (tag === 'select') for (const [value, title] of Object.entries(stages)) { const option = node('option', title); option.value = value; field.append(option); }
        else if (key === 'duration') { field.type = 'number'; field.min = '1'; field.max = '120'; field.step = '1'; field.inputMode = 'numeric'; field.required = true; }
        else { field.maxLength = max; if (key === 'title') field.required = true; if (tag === 'textarea') field.rows = 3; }
        field.value = block[key]; field.addEventListener('input', () => { if (!enabled) return; block[key] = key === 'duration' ? (field.value === '' ? '' : Number(field.value)) : field.value; changed(); });
        label.append(field); fields.append(label);
      }
      item.append(fields);
      const diagram = node('section', '', 'plan-block-diagram');
      diagram.append(node('h5', 'Activity diagram'));
      const preview = previewDiagram(block.diagram, block.title || 'Activity ' + (index + 1));
      if (preview) diagram.append(preview);
      else diagram.append(node('p', 'Optional setup snapshot, saved with the shared plan.', 'small'));
      const diagramActions = node('div', '', 'plan-block-diagram-actions');
      const attach = button('Use current tactics draft', () => attachCurrentDiagram(index), 'Use current tactics draft for activity ' + (index + 1));
      attach.id = 'plan-block-' + index + '-attach-diagram'; diagramActions.append(attach);
      if (block.diagram) diagramActions.append(button('Remove diagram', () => { if (!canEdit() || !confirm('Remove this activity’s diagram? This takes effect when you save the shared plan.')) return; delete block.diagram; render(-1, 'Diagram removed from this draft. Save the shared plan when ready.'); changed(); }, 'Remove diagram from activity ' + (index + 1)));
      diagram.append(diagramActions); item.append(diagram); list.append(item);
    });
    mount.append(list);
    if (!draft?.length) mount.append(node('p', 'Add an activity or choose a starter. Existing written plans are in Supporting coaching notes.', 'plan-block-empty'));
    const status = node('p', message, 'plan-block-status small'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); mount.append(status);
    labels(); budget(); setEnabled(enabled);
    if (focusIndex >= 0) document.getElementById('plan-block-' + focusIndex + '-title')?.focus();
  }
  function starter(kind) {
    const touch = kind === 'touch';
    return [
      { title: 'Ball mastery & movement', duration: 10, stage: 'warmup', instructions: 'One ball per player in a marked area. Dribble into space; on a signal, change direction. Encourage small touches and looking up.', equipment: 'Balls, cones' },
      { title: touch ? 'Receive into space' : 'Pass & move through gates', duration: 20, stage: 'technical', instructions: touch ? 'Pairs pass through a gate. Receive with the back foot into space before returning the pass. Progress by changing the receiving angle.' : 'Pairs pass through cone gates, then find a new gate. Ask players to scan before receiving and move after each pass.', equipment: 'Balls, cone gates' },
      { title: 'Small-sided game', duration: 20, stage: 'game', instructions: touch ? 'Play small-sided games. Look for a first touch away from pressure. Pause briefly to praise a useful receiving angle.' : 'Play small-sided games. Encourage support angles and movement after the pass. Adjust numbers and space to suit the group.', equipment: 'Bibs, balls, goals' },
      { title: 'Review & water', duration: 5, stage: 'other', instructions: 'Ask players what helped today and invite one example. Allow time for water and transitions.', equipment: '' },
    ];
  }
  function load(content = {}, nextSession = null) { saved = clone(content.activities); draft = clone(saved); session = nextSession; loadedSessionId = nextSession?.id || null; render(); }
  // An activity owns a snapshot; later tactics edits never change the saved plan.
  function drillBlock(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { target, text, title, minutes, diagram } = value;
    if (!canEdit() || (draft?.length || 0) >= 16) return null;
    if (!Object.hasOwn(stages, target) || typeof text !== 'string' || !text.trim() || text.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return null;
    const activityTitle = title === undefined ? text.split(/\r?\n/, 1)[0].replace(/\s*\(\d+ min(?: starting point)?\)\s*$/, '').trim() : title;
    const duration = minutes === undefined ? 10 : minutes;
    if (typeof activityTitle !== 'string' || !activityTitle.trim() || activityTitle.length > 120 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(activityTitle) || !Number.isInteger(duration) || duration < 1 || duration > 120) return null;
    const block = { title: activityTitle, duration, stage: target, instructions: text, equipment: '' };
    if (diagram !== undefined && diagram !== null) { const snapshot = diagramCopy(diagram); if (!snapshot) return null; block.diagram = snapshot; }
    return withinBudget([...(draft || []), block]) ? block : null;
  }
  function addDrill(value = {}) {
    const block = drillBlock(value);
    if (!block) return false;
    draft = [...(draft || []), block];
    render(draft.length - 1, 'Activity added to the sequence. Save the shared plan when ready.');
    changed();
    return true;
  }
  window.CoachPlanBlocks = {
    load, addDrill, canAddDrill: value => !!drillBlock(value), previewDiagram, content: () => clone(draft), isDirty: () => JSON.stringify(draft) !== JSON.stringify(saved),
    discard: () => { draft = clone(saved); render(); }, copy: content => { draft = clone(content?.activities); render(-1, 'Activity sequence copied to your draft.'); },
    clear: () => { enabled = false; load(); }, setEnabled, recordedMinutes,
    validate: () => { for (const [index, block] of (draft || []).entries()) { if (!block.title.trim()) return 'Add a title for activity ' + (index + 1) + '.'; if (!Number.isInteger(block.duration) || block.duration < 1 || block.duration > 120) return 'Choose 1 to 120 whole minutes for activity ' + (index + 1) + '.'; if (Object.hasOwn(block, 'diagram') && !diagramCopy(block.diagram)) return 'Check the diagram for activity ' + (index + 1) + '.'; } return withinBudget() ? '' : 'This plan is too large to save. Remove a diagram or shorten the plan.'; },
  };
  window.addEventListener('coach:context', event => { context = event.detail; if (!context?.profile) return window.CoachPlanBlocks.clear(); session = context.session; setEnabled(context.tab === 'plan' && context.planReady && !context.busy && !!session?.id && context.selected === session.id && loadedSessionId === session.id && String(session.status).toLowerCase() !== 'cancelled'); labels(); budget(); });
  for (const key of ['warmup', 'technical', 'game']) document.getElementById('plan-' + key)?.addEventListener('input', labels);
  render();
})();
