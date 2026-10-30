/* Session preparation only. Saves diagrams through the authenticated Coach Desk bridge. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), mount = $('tactics-board-tools');
  if (!mount) return;
  const ns = 'http://www.w3.org/2000/svg';
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = prefix => prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const kinds = { home: 'Blue player', away: 'Gold player', cone: 'Cone', ball: 'Ball', goal: 'Goal' };
  const el = (tag, text = '', className = '') => { const n = document.createElement(tag); n.textContent = text; if (className) n.className = className; return n; };
  const svg = (tag, attributes = {}, text = '') => { const n = document.createElementNS(ns, tag); for (const [key, value] of Object.entries(attributes)) n.setAttribute(key, String(value)); if (text) n.textContent = text; return n; };
  const button = (text, id, fn, primary = false) => { const n = el('button', text, primary ? '' : 'secondary'); n.type = 'button'; n.id = id; n.addEventListener('click', fn); return n; };
  const field = (text, input) => { const label = el('label', text); label.htmlFor = input.id; label.append(input); return label; };
  const input = (id, type = 'text') => { const n = el('input'); n.id = id; n.type = type; return n; };
  const select = (id, options) => { const n = el('select'); n.id = id; for (const [value, title] of options) { const o = el('option', title); o.value = value; n.append(o); } return n; };
  const blank = () => ({ id: null, title: 'New drill', version: 0, content: { schemaVersion: 1, pitch: 'full', items: [], frames: [{ id: uid('phase_'), title: 'Starting positions', duration: 3, positions: [] }] } });
  let context = null, identity = '', record = blank(), baseline = '', diagrams = [], loaded = false, loadAttempted = false, pending = false, requestEpoch = 0, lastAttempt = null, recoveryNeeded = false;
  let selectedItem = '', frameIndex = 0, undo = [], redo = [], pointer = null, running = false, animation = 0, elapsed = 0, started = 0, renderedPositions = null;
  let message = 'Choose a session, then open the tactics board.', messageError = false;
  const snapshot = () => JSON.stringify({ title: record.title, content: record.content });
  baseline = snapshot();
  const dirty = () => !!identity && snapshot() !== baseline;
  const active = () => !!context?.profile && !!context?.session && context.selected === context.session.id && context.tab === 'plan' && context.session.status !== 'Cancelled';
  const editable = () => active() && loaded && !pending && !context.busy && !running;
  const currentFrame = () => record.content.frames[frameIndex];
  const capture = () => ({ title: record.title, content: clone(record.content), frameIndex, selectedItem });
  const apply = value => { record.title = value.title; record.content = clone(value.content); frameIndex = value.frameIndex; selectedItem = value.selectedItem; };
  const remember = () => { undo.push(capture()); if (undo.length > 30) undo.shift(); redo = []; };
  const notifyDraft = () => window.dispatchEvent(new Event('coach:tactics-dirty'));
  function tell(text, error = false) { message = text; messageError = error; renderStatus(); }
  function request(operation, payload) { return new Promise((resolve, reject) => window.dispatchEvent(new CustomEvent('coach:tactics-request', { detail: { operation, payload, resolve, reject } }))); }
  function stopPlayback(reset = true) { running = false; cancelAnimationFrame(animation); animation = 0; if (reset) { elapsed = 0; renderedPositions = null; } renderPlayback(); }
  function mutate(fn, text) { if (!editable()) return; stopPlayback(); remember(); fn(); if (text) tell(text); render(); notifyDraft(); }
  function clear(next = blank()) { stopPlayback(); record = clone(next); record.content = clone(next.content); frameIndex = 0; selectedItem = ''; undo = []; redo = []; lastAttempt = null; recoveryNeeded = false; baseline = snapshot(); render(); notifyDraft(); }
  function discard() { stopPlayback(); const saved = JSON.parse(baseline); record.title = saved.title; record.content = saved.content; frameIndex = 0; selectedItem = ''; undo = []; redo = []; render(); notifyDraft(); }
  window.CoachTactics = Object.freeze({ isDirty: dirty, isBusy: () => pending, discard });

  const intro = el('div', '', 'tactics-intro');
  intro.append(el('p', 'Map the setup. Show the movement.', 'tactics-kicker'), el('p', 'Place players and equipment, add the next phase, then move the pieces to show what happens next. Diagrams are shared with coaches assigned to this session.', 'small'));
  const library = el('div', '', 'tactics-library');
  const librarySelect = select('tactics-library', [['', 'New unsaved setup']]);
  librarySelect.addEventListener('change', () => { if (!editable()) return; const chosen = diagrams.find(d => d.id === librarySelect.value); if (!chosen) { librarySelect.value = record.id || ''; return; } if (dirty() && !confirm('Open this saved diagram and discard unsaved diagram changes?')) { librarySelect.value = record.id || ''; return; } clear(chosen); tell('Saved diagram opened.'); });
  library.append(field('Saved setups for this session', librarySelect), button('New setup', 'tactics-new', () => { if (!editable() || dirty() && !confirm('Start a new setup and discard unsaved diagram changes?')) return; clear(); tell('Start with an empty field or try the passing triangle.'); }));
  const editor = el('div', '', 'tactics-editor');
  editor.id = 'tactics-editor';
  const heading = el('div', '', 'tactics-heading');
  const title = input('tactics-title'); title.maxLength = 80; title.value = record.title;
  title.addEventListener('input', () => { if (!editable()) return; record.title = title.value; renderStatus(); $('tactics-save').disabled = recoveryNeeded || !record.title.trim() || (!dirty() && !!record.id); notifyDraft(); });
  const pitch = select('tactics-pitch', [['full', 'Full pitch'], ['half', 'Half pitch'], ['blank', 'Open training area']]);
  pitch.addEventListener('change', () => mutate(() => { record.content.pitch = pitch.value; }));
  heading.append(field('Setup name', title), field('Field', pitch));
  const topActions = el('div', '', 'tactics-toolbar');
  const addGroup = el('div', '', 'tactics-pieces'); addGroup.setAttribute('role', 'group'); addGroup.setAttribute('aria-label', 'Add a piece');
  for (const [kind, label] of Object.entries(kinds)) {
    const add = button('+ ' + label, 'tactics-add-' + kind, () => mutate(() => {
      if (record.content.items.length >= 40) return tell('This board has 40 pieces. Remove one before adding another.', true);
      const item = { id: uid('piece_'), kind, label: ['home', 'away'].includes(kind) ? String(record.content.items.filter(i => i.kind === kind).length + 1) : '' };
      record.content.items.push(item); const offset = record.content.items.length % 6;
      for (const frame of record.content.frames) frame.positions.push({ id: item.id, x: 43 + offset * 3, y: 42 + offset * 3 });
      selectedItem = item.id;
    }, label + ' added. Drag it, tap its destination, or use the position controls.'));
    add.dataset.pieceKind = kind; addGroup.append(add);
  }
  topActions.append(addGroup);
  const boardLayout = el('div', '', 'tactics-board-layout');
  const canvasWrap = el('div', '', 'tactics-canvas-wrap');
  const board = svg('svg', { id: 'tactics-pitch-board', viewBox: '0 0 1000 650', role: 'group', 'aria-label': 'Tactics field. Select a piece and drag, tap a destination, or use arrow keys.', tabindex: '0' });
  canvasWrap.append(board);
  const emptyHint = el('div', 'Add a player or try the passing triangle to begin.', 'tactics-empty-hint'); emptyHint.id = 'tactics-empty-hint'; canvasWrap.append(emptyHint);
  const help = el('p', 'Drag pieces, or select one and tap its destination. Arrow keys move a selected piece; Shift moves farther.', 'tactics-board-help');
  const side = el('div', '', 'tactics-piece-panel');
  const itemSelect = select('tactics-item', [['', 'Choose a piece']]);
  itemSelect.addEventListener('change', () => { if (!editable()) return; selectedItem = itemSelect.value; stopPlayback(); render(); });
  const labelInput = input('tactics-label'); labelInput.maxLength = 12;
  labelInput.addEventListener('change', () => mutate(() => { const item = record.content.items.find(i => i.id === selectedItem); if (item) item.label = labelInput.value.trim(); }));
  const nudge = el('div', '', 'tactics-nudge'); nudge.setAttribute('role', 'group'); nudge.setAttribute('aria-label', 'Move selected piece');
  for (const [direction, text, dx, dy] of [['up', '↑ Up', 0, -2], ['left', '← Left', -2, 0], ['right', 'Right →', 2, 0], ['down', 'Down ↓', 0, 2]]) nudge.append(button(text, 'tactics-nudge-' + direction, () => moveSelected(dx, dy)));
  const coordinate = el('p', '', 'small'); coordinate.id = 'tactics-coordinate';
  const pathToggle = input('tactics-paths', 'checkbox'); pathToggle.checked = true; pathToggle.addEventListener('change', draw);
  const pathLabel = field('Show movement paths', pathToggle); pathLabel.className = 'tactics-check';
  side.append(field('Selected piece', itemSelect), field('Short label', labelInput), nudge, coordinate, button('Remove piece', 'tactics-remove-item', () => mutate(() => { const id = selectedItem; record.content.items = record.content.items.filter(i => i.id !== id); for (const f of record.content.frames) f.positions = f.positions.filter(p => p.id !== id); selectedItem = ''; }, 'Piece removed from every phase.')), pathLabel);
  boardLayout.append(canvasWrap, side);
  const phases = el('section', '', 'tactics-phases'); phases.setAttribute('aria-label', 'Movement phases');
  const phaseHeading = el('div', '', 'tactics-phase-heading'); phaseHeading.append(el('h3', 'Movement sequence'), el('span', '', 'small')); phaseHeading.lastChild.id = 'tactics-sequence-summary';
  const frameButtons = el('div', '', 'tactics-frame-list'); frameButtons.id = 'tactics-frames'; frameButtons.setAttribute('role', 'group'); frameButtons.setAttribute('aria-label', 'Choose a movement phase');
  const frameSettings = el('div', '', 'tactics-frame-settings');
  const frameTitle = input('tactics-frame-title'); frameTitle.maxLength = 80; frameTitle.addEventListener('change', () => mutate(() => { currentFrame().title = frameTitle.value.trim() || 'Phase ' + (frameIndex + 1); }));
  const duration = input('tactics-duration', 'number'); duration.min = '.5'; duration.max = '20'; duration.step = '.5'; duration.inputMode = 'decimal';
  duration.addEventListener('change', () => { const value = Number(duration.value); if (!Number.isFinite(value) || value < .5 || value > 20) { duration.value = String(currentFrame().duration); return tell('Choose a movement time between 0.5 and 20 seconds.', true); } mutate(() => { currentFrame().duration = value; }); });
  frameSettings.append(field('Phase name', frameTitle), field('Seconds to next phase', duration));
  const phaseActions = el('div', '', 'tactics-toolbar');
  phaseActions.append(button('+ Next phase', 'tactics-add-frame', () => mutate(() => { if (record.content.frames.length >= 12) return tell('Use up to 12 phases in one setup.', true); const next = clone(currentFrame()); next.id = uid('phase_'); next.title = 'Phase ' + (record.content.frames.length + 1); record.content.frames.splice(frameIndex + 1, 0, next); frameIndex++; }, 'Phase copied. Move the pieces to their next positions.')), button('Remove phase', 'tactics-remove-frame', () => mutate(() => { if (record.content.frames.length <= 1) return; record.content.frames.splice(frameIndex, 1); frameIndex = Math.min(frameIndex, record.content.frames.length - 1); }, 'Phase removed.')));
  const playback = el('div', '', 'tactics-playback');
  playback.append(button('Play movement', 'tactics-play', togglePlayback, true), button('Back to start', 'tactics-reset', () => { if (!active() || pending) return; stopPlayback(); frameIndex = 0; render(); }), el('span', '', 'small'));
  playback.lastChild.id = 'tactics-playback-status'; playback.lastChild.setAttribute('aria-live', 'off');
  phases.append(phaseHeading, frameButtons, frameSettings, phaseActions, playback);
  const footer = el('div', '', 'tactics-footer');
  const editingActions = el('div', '', 'tactics-toolbar');
  editingActions.append(button('Undo', 'tactics-undo', () => { if (!editable() || !undo.length) return; stopPlayback(); redo.push(capture()); apply(undo.pop()); render(); notifyDraft(); }), button('Redo', 'tactics-redo', () => { if (!editable() || !redo.length) return; stopPlayback(); undo.push(capture()); apply(redo.pop()); render(); notifyDraft(); }), button('Passing triangle', 'tactics-preset', preset));
  const saveActions = el('div', '', 'tactics-toolbar');
  saveActions.append(button('Save setup', 'tactics-save', save, true), button('Archive setup', 'tactics-archive', archive));
  const status = el('p', '', 'tactics-status'); status.id = 'tactics-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const reload = button('Refresh saved setups', 'tactics-retry', () => load());
  const reopen = button('Open latest saved version', 'tactics-open-latest', () => { if (!editable()) return; const latest = diagrams.find(d => d.id === record.id); if (!latest || dirty() && !confirm('Open the latest saved version and discard your unsaved diagram changes?')) return; clear(latest); tell('Latest loaded version opened.'); });
  const recoveryActions = el('div', '', 'tactics-toolbar tactics-recovery-actions'); recoveryActions.append(reload, reopen);
  footer.append(editingActions, saveActions, status, recoveryActions);
  editor.append(heading, topActions, boardLayout, help, phases, footer);
  mount.append(intro, library, editor);

  function renderStatus() {
    status.textContent = (dirty() ? 'Unsaved changes · ' : '') + message;
    status.classList.toggle('tactics-error', messageError);
  }
  function render() {
    if (!context?.profile) { mount.replaceChildren(); return; }
    if (!mount.childElementCount) mount.append(intro, library, editor);
    title.value = record.title; pitch.value = record.content.pitch;
    librarySelect.replaceChildren(); const unsaved = el('option', 'New unsaved setup'); unsaved.value = ''; librarySelect.append(unsaved);
    for (const d of diagrams) { const option = el('option', d.title); option.value = d.id; librarySelect.append(option); }
    librarySelect.value = record.id || '';
    itemSelect.replaceChildren(); const none = el('option', 'Choose a piece'); none.value = ''; itemSelect.append(none);
    for (const item of record.content.items) { const option = el('option', kinds[item.kind] + (item.label ? ' · ' + item.label : '')); option.value = item.id; itemSelect.append(option); }
    if (!record.content.items.some(i => i.id === selectedItem)) selectedItem = '';
    itemSelect.value = selectedItem; labelInput.value = record.content.items.find(i => i.id === selectedItem)?.label || '';
    const position = currentFrame().positions.find(p => p.id === selectedItem); coordinate.textContent = position ? 'Position: ' + Math.round(position.x) + '% across · ' + Math.round(position.y) + '% down' : 'Select a piece to position or label it.';
    frameButtons.replaceChildren(...record.content.frames.map((f, index) => { const b = button((index + 1) + '. ' + f.title, 'tactics-frame-' + index, () => { if (!editable()) return; stopPlayback(); frameIndex = index; render(); }); b.dataset.tacticsFrame = index; b.setAttribute('aria-pressed', String(frameIndex === index)); return b; }));
    frameTitle.value = currentFrame().title; duration.value = String(currentFrame().duration);
    $('tactics-sequence-summary').textContent = record.content.frames.length + ' / 12 phases · ' + record.content.items.length + ' / 40 pieces';
    const disabled = !editable();
    for (const control of mount.querySelectorAll('button,input,select')) control.disabled = disabled;
    $('tactics-play').disabled = !active() || !loaded || pending || context.busy || record.content.frames.length < 2;
    $('tactics-reset').disabled = !active() || !loaded || pending || context.busy;
    $('tactics-retry').disabled = !active() || pending || context.busy;
    pathToggle.disabled = !active() || !loaded;
    labelInput.disabled = disabled || !selectedItem;
    for (const control of side.querySelectorAll('button')) control.disabled = disabled || !selectedItem;
    $('tactics-remove-frame').disabled = disabled || record.content.frames.length <= 1;
    $('tactics-add-frame').disabled = disabled || record.content.frames.length >= 12;
    $('tactics-save').disabled = disabled || recoveryNeeded || !record.title.trim() || (!dirty() && !!record.id);
    $('tactics-archive').disabled = disabled || !record.id;
    reopen.hidden = !record.id; reopen.disabled = disabled || !record.id || !diagrams.some(d => d.id === record.id);
    $('tactics-undo').disabled = disabled || !undo.length; $('tactics-redo').disabled = disabled || !redo.length;
    for (const control of addGroup.querySelectorAll('button')) control.disabled = disabled || record.content.items.length >= 40;
    emptyHint.hidden = !!record.content.items.length;
    mount.setAttribute('aria-busy', String(pending));
    renderStatus(); draw(); renderPlayback();
  }
  function draw() {
    board.replaceChildren();
    board.append(svg('rect', { width: 1000, height: 650, fill: '#eef2e8' }));
    for (let i = 0; i < 10; i += 2) board.append(svg('rect', { x: i * 100, width: 100, height: 650, fill: '#e3ebdc' }));
    const lines = svg('g', { fill: 'none', stroke: '#8ea58b', 'stroke-width': 2.5, 'pointer-events': 'none' });
    if (record.content.pitch !== 'blank') {
      lines.append(svg('rect', { x: 25, y: 25, width: 950, height: 600, rx: 2 }));
      if (record.content.pitch === 'full') lines.append(svg('line', { x1: 500, y1: 25, x2: 500, y2: 625 }), svg('circle', { cx: 500, cy: 325, r: 80 }), svg('circle', { cx: 500, cy: 325, r: 3, fill: '#8ea58b' }), svg('rect', { x: 25, y: 175, width: 150, height: 300 }), svg('rect', { x: 825, y: 175, width: 150, height: 300 }), svg('rect', { x: 25, y: 250, width: 55, height: 150 }), svg('rect', { x: 920, y: 250, width: 55, height: 150 }));
      else lines.append(svg('rect', { x: 25, y: 145, width: 220, height: 360 }), svg('rect', { x: 25, y: 235, width: 85, height: 180 }), svg('path', { d: 'M 975 245 A80 80 0 0 0 975 405' }));
    }
    board.append(lines);
    const defs = svg('defs'), marker = svg('marker', { id: 'tactics-arrow', viewBox: '0 0 10 10', refX: 8, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }); marker.append(svg('path', { d: 'M0 0 L10 5 L0 10z', fill: '#536e60' })); defs.append(marker); board.append(defs);
    if (pathToggle.checked && record.content.frames.length > 1) {
      const from = record.content.frames[frameIndex === 0 ? 0 : frameIndex - 1], to = record.content.frames[frameIndex === 0 ? 1 : frameIndex];
      for (const start of from.positions) { const end = to.positions.find(p => p.id === start.id); if (!end || Math.hypot(end.x - start.x, end.y - start.y) < 1) continue; board.append(svg('line', { x1: start.x * 10, y1: start.y * 6.5, x2: end.x * 10, y2: end.y * 6.5, stroke: '#536e60', 'stroke-width': 3, 'stroke-dasharray': '9 7', 'marker-end': 'url(#tactics-arrow)', opacity: .7, 'pointer-events': 'none' })); }
    }
    const positions = renderedPositions || currentFrame().positions;
    for (const item of record.content.items) {
      const p = positions.find(point => point.id === item.id); if (!p) continue;
      const piece = svg('g', { transform: 'translate(' + (p.x * 10) + ' ' + (p.y * 6.5) + ')', 'data-tactics-item': item.id, role: 'button', tabindex: editable() ? '0' : '-1', 'aria-label': kinds[item.kind] + (item.label ? ' ' + item.label : '') + ', position ' + Math.round(p.x) + ', ' + Math.round(p.y), 'aria-pressed': String(item.id === selectedItem), 'aria-disabled': String(!editable()) });
      const art = svg('g', { class: 'tactics-piece-art' });
      piece.append(art); art.append(svg('circle', { r: 30, fill: 'transparent', class: 'tactics-hit' }));
      if (item.id === selectedItem) art.append(svg('circle', { r: 28, fill: 'none', stroke: '#152d42', 'stroke-width': 3, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
      if (['home', 'away'].includes(item.kind)) art.append(svg('circle', { r: 20, fill: item.kind === 'home' ? '#255978' : '#e7c59a', stroke: item.kind === 'home' ? '#fff' : '#704e29', 'stroke-width': 2.5 }));
      if (item.kind === 'cone') art.append(svg('path', { d: 'M0 -21 L20 18 L-20 18z', fill: '#c86e37', stroke: '#7e3c20', 'stroke-width': 2 }));
      if (item.kind === 'ball') art.append(svg('circle', { r: 15, fill: '#fff', stroke: '#253a48', 'stroke-width': 3 }), svg('path', { d: 'M0 -8 L8 -2 L5 7 L-5 7 L-8 -2z', fill: '#253a48' }));
      if (item.kind === 'goal') art.append(svg('rect', { x: -28, y: -15, width: 56, height: 30, fill: '#fff', stroke: '#536e60', 'stroke-width': 4 }), svg('path', { d: 'M-18 -15V15 M-7 -15V15 M7 -15V15 M18 -15V15 M-28 0H28', stroke: '#a5b5a2', 'stroke-width': 1.5 }));
      if (item.label) art.append(svg('text', { x: 0, y: ['home', 'away'].includes(item.kind) ? 5 : 38, 'text-anchor': 'middle', 'font-family': 'Arial,sans-serif', 'font-size': item.label.length > 4 ? 12 : 16, 'font-weight': 700, fill: item.kind === 'home' ? '#fff' : '#173044', 'pointer-events': 'none' }, item.label));
      board.append(piece);
    }
  }
  const clamp = v => Math.max(4, Math.min(96, Math.round(v * 10) / 10));
  function moveSelected(dx, dy) { mutate(() => { const p = currentFrame().positions.find(v => v.id === selectedItem); if (p) { p.x = clamp(p.x + dx); p.y = clamp(p.y + dy); } }); }
  function point(event) { const p = board.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; const matrix = board.getScreenCTM(); if (!matrix) return null; const next = p.matrixTransform(matrix.inverse()); return { x: clamp(next.x / 10), y: clamp(next.y / 6.5) }; }
  board.addEventListener('pointerdown', event => {
    if (!editable() || event.button !== 0) return;
    const target = event.target.closest('[data-tactics-item]');
    if (target) { selectedItem = target.dataset.tacticsItem; stopPlayback(); pointer = { id: event.pointerId, before: capture(), moved: false }; board.setPointerCapture(event.pointerId); event.preventDefault(); render(); }
    else if (selectedItem) { const destination = point(event); if (destination) mutate(() => Object.assign(currentFrame().positions.find(p => p.id === selectedItem), destination)); }
  });
  board.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId || !editable()) return;
    const destination = point(event), p = currentFrame().positions.find(p => p.id === selectedItem); if (!destination || !p || p.x === destination.x && p.y === destination.y) return;
    if (!pointer.moved) { undo.push(pointer.before); if (undo.length > 30) undo.shift(); redo = []; pointer.moved = true; }
    Object.assign(p, destination); draw(); renderStatus(); notifyDraft();
  });
  const endPointer = () => { if (!pointer) return; pointer = null; render(); };
  board.addEventListener('pointerup', endPointer); board.addEventListener('pointercancel', endPointer); board.addEventListener('lostpointercapture', endPointer);
  board.addEventListener('keydown', event => {
    if (!editable()) return;
    const target = event.target.closest('[data-tactics-item]');
    if (target && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectedItem = target.dataset.tacticsItem; render(); board.focus(); return; }
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (directions[event.key] && (selectedItem || target)) { event.preventDefault(); if (target) selectedItem = target.dataset.tacticsItem; const [x, y] = directions[event.key]; moveSelected(x * (event.shiftKey ? 5 : 1), y * (event.shiftKey ? 5 : 1)); board.focus(); }
  });
  function renderPlayback() {
    if (!$('tactics-play')) return;
    $('tactics-play').textContent = running ? 'Pause movement' : elapsed ? 'Resume movement' : 'Play movement';
    $('tactics-play').setAttribute('aria-pressed', String(running));
    $('tactics-playback-status').textContent = record.content.frames.length < 2 ? 'Add a next phase to animate movement.' : (running ? 'Playing · ' : elapsed ? 'Paused · ' : '') + 'Phase ' + (frameIndex + 1) + ' of ' + record.content.frames.length;
  }
  function tick(now) {
    if (!running) return;
    const frames = record.content.frames, durationMs = frames[frameIndex].duration * 1000, progress = Math.min(1, (elapsed + now - started) / durationMs);
    const from = frames[frameIndex], to = frames[frameIndex + 1];
    renderedPositions = from.positions.map(p => { const destination = to.positions.find(q => q.id === p.id); return { id: p.id, x: p.x + (destination.x - p.x) * progress, y: p.y + (destination.y - p.y) * progress }; });
    draw();
    if (progress >= 1) { frameIndex++; elapsed = 0; started = now; if (frameIndex >= frames.length - 1) { stopPlayback(); render(); return; } renderPlayback(); }
    animation = requestAnimationFrame(tick);
  }
  function pause() { if (!running) return; elapsed += performance.now() - started; stopPlayback(false); render(); }
  function togglePlayback() {
    if (!active() || !loaded || pending || context.busy || record.content.frames.length < 2 || document.hidden) return;
    if (running) return pause();
    if (frameIndex >= record.content.frames.length - 1) { frameIndex = 0; elapsed = 0; renderedPositions = null; }
    document.dispatchEvent(new Event('coach:dictation-stop'));
    running = true; started = performance.now(); render(); animation = requestAnimationFrame(tick);
  }
  function preset() {
    if (!editable() || (record.content.items.length || dirty()) && !confirm('Replace this diagram with a passing triangle? You can Undo this change.')) return;
    mutate(() => {
      record.title = 'Passing triangle'; record.content.pitch = 'blank';
      const ids = [uid('piece_'), uid('piece_'), uid('piece_'), uid('piece_')];
      record.content.items = ids.map((id, i) => ({ id, kind: i === 3 ? 'ball' : 'home', label: i === 3 ? '' : String(i + 1) }));
      const placements = [[{ x: 25, y: 72 }, { x: 50, y: 25 }, { x: 75, y: 72 }, { x: 29, y: 70 }], [{ x: 48, y: 29 }, { x: 50, y: 25 }, { x: 75, y: 72 }, { x: 53, y: 30 }], [{ x: 48, y: 29 }, { x: 71, y: 69 }, { x: 75, y: 72 }, { x: 71, y: 72 }]];
      record.content.frames = placements.map((points, i) => ({ id: uid('phase_'), title: ['Set up', 'Pass & follow', 'Next pass'][i], duration: 3, positions: points.map((p, j) => ({ id: ids[j], ...p })) }));
      frameIndex = 0; selectedItem = '';
    }, 'Example loaded into your unsaved diagram. Adapt the positions, then save it for this session.');
  }
  async function load() {
    if (!active() || pending || context.busy || !$('tactics-disclosure')?.open) return;
    const ticket = ++requestEpoch, sessionId = context.session.id, startedIdentity = identity, wasLoaded = loaded;
    pending = true; loadAttempted = true; tell('Loading this session’s setups…'); render();
    try {
      const result = await request('list', { sessionId }); if (ticket !== requestEpoch || identity !== startedIdentity) return;
      if (!Array.isArray(result.diagrams) || result.diagrams.some(d => d.session_id !== sessionId)) throw Error('The saved setups could not be verified for this session.');
      diagrams = result.diagrams; loaded = true;
      if (recoveryNeeded && lastAttempt) {
        const matches = diagrams.filter(d => (!lastAttempt.id || d.id === lastAttempt.id) && d.version === lastAttempt.expectedVersion + 1 && d.title === lastAttempt.title && JSON.stringify(d.content) === JSON.stringify(lastAttempt.content));
        if (matches.length === 1) { const draftMatches = record.title.trim() === lastAttempt.title && JSON.stringify(record.content) === JSON.stringify(lastAttempt.content); if (draftMatches) { clear(matches[0]); tell('Your earlier save was found and verified.'); } else { record.id = matches[0].id; record.version = matches[0].version; baseline = JSON.stringify({ title: matches[0].title, content: matches[0].content }); recoveryNeeded = false; lastAttempt = null; tell('Your earlier save was found. Your newer edits remain unsaved.'); } }
        else if (matches.length > 1) { tell('More than one matching setup exists. Open the saved setup you want before making further changes.', true); }
        else { recoveryNeeded = false; lastAttempt = null; tell('Saved setups refreshed. Review the list before saving your retained draft.'); }
      } else tell(diagrams.length ? 'Saved setups refreshed. Open the latest saved version to replace your draft.' : 'No saved setups yet. Add pieces or try the passing triangle.');
    }
    catch (error) { if (ticket !== requestEpoch || identity !== startedIdentity) return; loaded = wasLoaded; tell(error.message || 'Setups could not load. Your current diagram is still here. Try Refresh saved setups again.', true); }
    finally { if (ticket === requestEpoch && identity === startedIdentity) { pending = false; render(); } }
  }
  async function save() {
    if (!editable() || recoveryNeeded || !record.title.trim()) return;
    stopPlayback(); const ticket = requestEpoch, startedIdentity = identity, payload = { id: record.id, sessionId: context.session.id, title: record.title.trim(), content: clone(record.content), expectedVersion: record.version };
    pending = true; lastAttempt = clone(payload); tell('Saving setup…'); render();
    try { const result = await request('save', payload); if (ticket !== requestEpoch || identity !== startedIdentity) return; const saved = result.diagram; if (!saved?.id || !saved.content || saved.session_id !== payload.sessionId || saved.version !== payload.expectedVersion + 1 || payload.id && payload.id !== saved.id || saved.title !== payload.title || JSON.stringify(saved.content) !== JSON.stringify(payload.content)) throw Error('The save could not be verified. Your changes are still here.'); diagrams = [saved, ...diagrams.filter(d => d.id !== saved.id)]; record = clone(saved); baseline = snapshot(); undo = []; redo = []; lastAttempt = null; recoveryNeeded = false; tell('Setup saved to this session.'); notifyDraft(); }
    catch (error) { if (ticket === requestEpoch && identity === startedIdentity) { const conflict = error.code === 'DIAGRAM_CHANGED' || error.code === 'TACTICS_CHANGED'; recoveryNeeded = !error.code; tell(conflict ? 'Another coach changed this setup. Your edits are still here. Refresh saved setups, then open the latest saved version.' : error.code ? error.message : 'We could not verify the save. Your draft is still here. Refresh saved setups before retrying.', true); } }
    finally { if (ticket === requestEpoch && identity === startedIdentity) { pending = false; render(); } }
  }
  async function archive() {
    if (!editable() || !record.id || !confirm('Archive this setup? It will leave this session’s active setups.' + (dirty() ? ' Unsaved diagram changes will be discarded after archiving succeeds.' : ''))) return;
    stopPlayback(); const ticket = requestEpoch, startedIdentity = identity, id = record.id, payload = { id, sessionId: context.session.id, expectedVersion: record.version };
    pending = true; tell('Archiving setup…'); render();
    try { await request('archive', payload); if (ticket !== requestEpoch || identity !== startedIdentity) return; diagrams = diagrams.filter(d => d.id !== id); clear(); tell('Setup archived.'); }
    catch (error) { if (ticket === requestEpoch && identity === startedIdentity) tell(error.message || 'The setup could not be archived. Your changes are still here.', true); }
    finally { if (ticket === requestEpoch && identity === startedIdentity) { pending = false; render(); } }
  }
  window.addEventListener('coach:context', event => {
    const next = event.detail || null, nextIdentity = next?.profile && next.session ? [next.profile.email, next.profile.role, next.profile.sessionVersion, next.session.id].join(':') : '';
    const changed = identity !== nextIdentity;
    if (changed || !next || next.busy || next.tab !== 'plan') { pause(); pointer = null; }
    context = next;
    if (changed) { identity = nextIdentity; requestEpoch++; pending = false; loaded = false; loadAttempted = false; diagrams = []; clear(); tell(nextIdentity ? 'Open the board to load this session’s setups.' : 'Choose a session, then open the tactics board.'); }
    if (!next?.profile) { loaded = false; diagrams = []; }
    render();
    if (!loaded && !loadAttempted && !pending && active() && $('tactics-disclosure')?.open) load();
  });
  $('tactics-disclosure')?.addEventListener('toggle', event => { if (!event.currentTarget.open) pause(); else if (!loaded) load(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => stopPlayback());
  render();
  window.dispatchEvent(new CustomEvent('coach:request-context'));
})();
