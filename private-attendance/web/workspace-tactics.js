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
  let message = 'Choose a session, then open the tactics board.', messageError = false, playbackSpeed = 1, loopPlayback = false, titleEditing = false;
  let sourceSessionId = '', sourceDiagrams = [];
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
  function clear(next = blank()) { stopPlayback(); record = clone(next); record.content = clone(next.content); frameIndex = 0; selectedItem = ''; undo = []; redo = []; titleEditing = labelEditing = frameEditing = notesEditing = false; lastAttempt = null; recoveryNeeded = false; baseline = snapshot(); render(); notifyDraft(); }
  function discard() { stopPlayback(); const saved = JSON.parse(baseline); record.title = saved.title; record.content = saved.content; frameIndex = 0; selectedItem = ''; undo = []; redo = []; titleEditing = labelEditing = frameEditing = notesEditing = false; render(); notifyDraft(); }
  window.CoachTactics = Object.freeze({ isDirty: dirty, isBusy: () => pending, discard,
    getDraft: () => active() && loaded && !pending && !running ? { sessionId: context.session.id, title: record.title, diagram: clone(record.content) } : null,
    preview: content => content?.frames?.[0] && Array.isArray(content.items) ? previewFrame(content.frames[0], content.items) : null,
    useDraft });
  function useDraft(value) {
    if (!editable() || recoveryNeeded || value.sessionId !== context.session.id || value.diagram?.schemaVersion !== 1 || !Array.isArray(value.diagram.items) || !value.diagram.frames?.length) return false;
    if (dirty() && !confirm('Replace the current unsaved diagram with this drill’s diagram?')) return false;
    clear(); record.title = String(value.title || 'Drill diagram').slice(0, 80); record.content = clone(value.diagram); $('tactics-disclosure').open = true;
    render(); tell('Drill diagram copied to this session draft. Save setup to keep it.'); notifyDraft(); return true;
  }

  const intro = el('div', '', 'tactics-intro');
  intro.append(el('p', 'Map the setup. Show the movement.', 'tactics-kicker'), el('p', 'Place players and equipment, add the next phase, then move the pieces to show what happens next. Diagrams are shared with coaches assigned to this session.', 'small'));
  const library = el('div', '', 'tactics-library');
  const librarySelect = select('tactics-library', [['', 'New unsaved setup']]);
  librarySelect.addEventListener('change', () => { if (!editable()) return; const chosen = diagrams.find(d => d.id === librarySelect.value); if (!chosen) { librarySelect.value = record.id || ''; return; } if (dirty() && !confirm('Open this saved diagram and discard unsaved diagram changes?')) { librarySelect.value = record.id || ''; return; } clear(chosen); tell('Saved diagram opened.'); });
  library.append(field('Saved setups for this session', librarySelect), button('New setup', 'tactics-new', () => { if (!editable() || dirty() && !confirm('Start a new setup and discard unsaved diagram changes?')) return; clear(); tell('Start with an empty field or try the passing triangle.'); }));
  const reuse = el('details', '', 'tactics-reuse'); reuse.id = 'tactics-reuse';
  reuse.append(el('summary', 'Reuse a setup from another session'), el('p', 'Choose a session you can access, then copy a saved setup into this session. The original stays unchanged. Review your copy and choose Save setup when ready.', 'small'));
  const sourceSelect = select('tactics-source-session', [['', 'Choose a date in this group']]);
  const sourceBoard = select('tactics-source-board', [['', 'Load a session first']]);
  sourceSelect.addEventListener('change', () => { if (!editable() || recoveryNeeded) return; sourceSessionId = sourceSelect.value; sourceDiagrams = []; renderReuse(); });
  sourceBoard.addEventListener('change', renderReuseControls);
  const sourceActions = el('div', '', 'tactics-reuse-actions');
  sourceActions.append(button('Load saved setups', 'tactics-source-load', loadSource), button('Copy setup to this session', 'tactics-source-copy', copySource));
  const sourceStatus = el('p', '', 'small'); sourceStatus.id = 'tactics-source-status'; sourceStatus.setAttribute('role', 'status');
  reuse.append(field('Source session', sourceSelect), field('Saved setup to copy', sourceBoard), sourceActions, sourceStatus);
  const editor = el('div', '', 'tactics-editor');
  editor.id = 'tactics-editor';
  const heading = el('div', '', 'tactics-heading');
  const title = input('tactics-title'); title.maxLength = 80; title.value = record.title;
  title.addEventListener('input', () => { if (!editable()) return; if (!titleEditing) { remember(); titleEditing = true; } record.title = title.value; $('tactics-undo').disabled = false; renderStatus(); $('tactics-save').disabled = recoveryNeeded || !record.title.trim() || (!dirty() && !!record.id); notifyDraft(); });
  title.addEventListener('blur', () => { titleEditing = false; });
  const pitch = select('tactics-pitch', [['full', 'Full pitch'], ['half', 'Half pitch'], ['blank', 'Open training area']]);
  pitch.addEventListener('change', () => mutate(() => { record.content.pitch = pitch.value; }));
  heading.append(field('Setup name', title), field('Field', pitch));
  const topActions = el('div', '', 'tactics-toolbar');
  const addGroup = el('div', '', 'tactics-pieces'); addGroup.setAttribute('role', 'group'); addGroup.setAttribute('aria-label', 'Add a piece');
  function addPiece(kind, destination) {
    if (!kinds[kind] || !editable() || record.content.items.length >= 40) return;
    mutate(() => {
      const item = { id: uid('piece_'), kind, label: ['home', 'away'].includes(kind) ? String(record.content.items.filter(i => i.kind === kind).length + 1) : '' };
      record.content.items.push(item); const offset = record.content.items.length % 6;
      for (const frame of record.content.frames) frame.positions.push({ id: item.id, ...(destination || { x: 43 + offset * 3, y: 42 + offset * 3 }) });
      selectedItem = item.id;
    }, kinds[kind] + ' added. Drag it, tap its destination, or use the position controls.');
  }
  for (const [kind, label] of Object.entries(kinds)) {
    const add = button('+ ' + label, 'tactics-add-' + kind, () => addPiece(kind));
    add.draggable = true; add.title = 'Click to add, or drag onto the field';
    add.addEventListener('dragstart', event => { if (!editable() || add.disabled) return event.preventDefault(); event.dataTransfer.setData('application/x-coach-piece', kind); event.dataTransfer.effectAllowed = 'copy'; });
    add.dataset.pieceKind = kind; addGroup.append(add);
  }
  topActions.append(addGroup);
  const boardLayout = el('div', '', 'tactics-board-layout');
  const canvasWrap = el('div', '', 'tactics-canvas-wrap');
  const board = svg('svg', { id: 'tactics-pitch-board', viewBox: '-120 -100 1240 870', role: 'group', 'aria-label': 'Tactics field. Select a piece and drag, tap a destination, or use arrow keys.', tabindex: '0' });
  canvasWrap.append(board);
  const emptyHint = el('div', 'Add a player or try the passing triangle to begin.', 'tactics-empty-hint'); emptyHint.id = 'tactics-empty-hint'; canvasWrap.append(emptyHint);
  const help = el('p', 'Drag pieces from the toolbar onto the field, or click to add. Select and drag or tap to move. Arrows: move · Shift: farther · Ctrl/⌘ Z: undo · Delete: remove from all steps · Escape: deselect. Paths lead to the next step: solid for a free ball, dashed for players. Cones and goals have no paths. Drag an attached ball to release it.', 'tactics-board-help');
  const side = el('div', '', 'tactics-piece-panel');
  const itemSelect = select('tactics-item', [['', 'Choose a piece']]);
  itemSelect.addEventListener('change', () => { if (!editable()) return; selectedItem = itemSelect.value; stopPlayback(); render(); });
  const labelInput = input('tactics-label'); labelInput.maxLength = 12;
  let labelEditing = false;
  labelInput.addEventListener('input', () => { if (!editable()) return; const item = record.content.items.find(i => i.id === selectedItem); if (!item) return; if (!labelEditing) { remember(); labelEditing = true; } item.label = labelInput.value.trim(); draw(); editedText(); });
  labelInput.addEventListener('blur', () => { labelEditing = false; });
  const nudge = el('div', '', 'tactics-nudge'); nudge.setAttribute('role', 'group'); nudge.setAttribute('aria-label', 'Move selected piece');
  for (const [direction, text, dx, dy] of [['up', '↑ Up', 0, -2], ['left', '← Left', -2, 0], ['right', 'Right →', 2, 0], ['down', 'Down ↓', 0, 2]]) nudge.append(button(text, 'tactics-nudge-' + direction, () => moveSelected(dx, dy)));
  const coordinate = el('p', '', 'small'); coordinate.id = 'tactics-coordinate';
  const pathToggle = input('tactics-paths', 'checkbox'); pathToggle.checked = true; pathToggle.addEventListener('change', draw);
  const pathLabel = field('Show movement paths', pathToggle); pathLabel.className = 'tactics-check';
  const carrier = select('tactics-ball-carrier', [['', 'Free ball']]);
  carrier.addEventListener('change', () => mutate(() => { const p = currentFrame().positions.find(p => p.id === selectedItem); if (!p) return; if (carrier.value) { p.attachedTo = carrier.value; Object.assign(p, positionIn(currentFrame(), p.id)); } else detachBall(currentFrame(), p); }, carrier.value ? 'Ball attached for this step. It follows the player; drag it to release.' : 'Ball detached for this step.'));
  const carrierField = field('Ball carrier · this step', carrier);
  const detach = button('Detach ball', 'tactics-detach-ball', () => mutate(() => detachBall(currentFrame(), currentFrame().positions.find(p => p.id === selectedItem)), 'Ball detached for this step.'));
  const bend = input('tactics-curve', 'range'); bend.min = '-50'; bend.max = '50'; bend.step = '5';
  const bendValue = el('span', '', 'small'); bendValue.id = 'tactics-curve-value';
  bend.addEventListener('input', () => { bendValue.textContent = Number(bend.value) === 0 ? 'Straight' : (Number(bend.value) < 0 ? 'Left' : 'Right') + ' bend · ' + Math.abs(Number(bend.value)); });
  bend.addEventListener('change', () => mutate(() => { const p = currentFrame().positions.find(p => p.id === selectedItem); if (!p) return; const value = Number(bend.value); if (value) p.curve = value; else delete p.curve; }, 'Path updated. Play movement to preview it.'));
  const bendField = field('Path to next step · left / right', bend); bendField.append(bendValue);
  side.append(el('p', 'Select a piece on the field or use the list below. Drag to move; Escape clears selection.', 'tactics-selection-hint'), field('Selected piece', itemSelect), field('Short label', labelInput), carrierField, detach, bendField, nudge, coordinate, button('Duplicate piece', 'tactics-duplicate-item', duplicatePiece), button('Remove from all steps', 'tactics-remove-item', () => mutate(() => { const id = selectedItem; for (const f of record.content.frames) { for (const p of f.positions) if (p.attachedTo === id) detachBall(f, p); f.positions = f.positions.filter(p => p.id !== id); } record.content.items = record.content.items.filter(i => i.id !== id); selectedItem = ''; }, 'Piece removed from every step. Undo restores it.')), pathLabel);
  boardLayout.append(canvasWrap, side);
  const phases = el('section', '', 'tactics-phases'); phases.setAttribute('aria-label', 'Movement phases');
  const phaseHeading = el('div', '', 'tactics-phase-heading'); phaseHeading.append(el('h3', 'Movement sequence'), el('span', '', 'small')); phaseHeading.lastChild.id = 'tactics-sequence-summary';
  const frameButtons = el('div', '', 'tactics-frame-list'); frameButtons.id = 'tactics-frames'; frameButtons.setAttribute('role', 'group'); frameButtons.setAttribute('aria-label', 'Choose a movement phase');
  const frameSettings = el('div', '', 'tactics-frame-settings');
  const frameTitle = input('tactics-frame-title'); frameTitle.maxLength = 80; let frameEditing = false;
  frameTitle.addEventListener('input', () => { if (!editable()) return; if (!frameEditing) { remember(); frameEditing = true; } currentFrame().title = frameTitle.value.trim() || 'Step ' + (frameIndex + 1); const selected = $('tactics-frame-' + frameIndex); if (selected) selected.lastChild.textContent = (frameIndex + 1) + '. ' + currentFrame().title; editedText(); });
  frameTitle.addEventListener('blur', () => { frameEditing = false; });
  const phaseNotes = el('textarea'); phaseNotes.id = 'tactics-phase-notes'; phaseNotes.rows = 3; phaseNotes.maxLength = 1000; phaseNotes.placeholder = 'Coaching cues, instructions, or what happens in this step…'; let notesEditing = false;
  phaseNotes.addEventListener('input', () => { if (!editable()) return; if (!notesEditing) { remember(); notesEditing = true; } if (phaseNotes.value) currentFrame().notes = phaseNotes.value; else delete currentFrame().notes; editedText(); });
  phaseNotes.addEventListener('blur', () => { notesEditing = false; });
  const duration = input('tactics-duration', 'number'); duration.min = '.5'; duration.max = '20'; duration.step = '.5'; duration.inputMode = 'decimal';
  duration.addEventListener('change', () => { if (!editable()) return; const value = Number(duration.value); if (!Number.isFinite(value) || value < .5 || value > 20) { duration.value = String(currentFrame().duration); return tell('Choose a movement time between 0.5 and 20 seconds.', true); } if (value !== currentFrame().duration) { remember(); currentFrame().duration = value; scrub.max = String(totalSeconds()); $('tactics-sequence-summary').textContent = record.content.frames.length + ' / 12 steps · ' + totalSeconds() + 's · ' + record.content.items.length + ' / 40 pieces'; editedText(); } });
  const durationField = field('Seconds to next step', duration);
  frameSettings.append(field('Step name', frameTitle), durationField);
  const phaseActions = el('div', '', 'tactics-toolbar');
  phaseActions.append(button('+ Next phase', 'tactics-add-frame', () => mutate(() => { if (record.content.frames.length >= 12) return tell('Use up to 12 phases in one setup.', true); const next = clone(currentFrame()); next.id = uid('phase_'); next.title = 'Phase ' + (record.content.frames.length + 1); record.content.frames.splice(frameIndex + 1, 0, next); frameIndex++; }, 'Phase copied. Move the pieces to their next positions.')), button('Remove phase', 'tactics-remove-frame', () => mutate(() => { if (record.content.frames.length <= 1) return; record.content.frames.splice(frameIndex, 1); frameIndex = Math.min(frameIndex, record.content.frames.length - 1); }, 'Phase removed.')));
  const playback = el('div', '', 'tactics-playback');
  playback.append(button('Play movement', 'tactics-play', togglePlayback, true), button('Back to start', 'tactics-reset', () => { if (!active() || pending) return; stopPlayback(); frameIndex = 0; render(); }), el('span', '', 'small'));
  playback.lastChild.id = 'tactics-playback-status'; playback.lastChild.setAttribute('aria-live', 'off');
  phaseActions.append(button('Move step earlier', 'tactics-step-earlier', () => reorderStep(-1)), button('Move step later', 'tactics-step-later', () => reorderStep(1)));
  const speed = select('tactics-speed', [['0.5', '0.5×'], ['1', '1×'], ['2', '2×']]); speed.value = '1';
  speed.addEventListener('change', () => { if (running) pause(); playbackSpeed = Number(speed.value); renderPlayback(); });
  const loop = input('tactics-loop', 'checkbox'); loop.addEventListener('change', () => { loopPlayback = loop.checked; });
  const scrub = input('tactics-progress', 'range'); scrub.min = '0'; scrub.step = '.1'; scrub.value = '0';
  scrub.addEventListener('input', () => seek(Number(scrub.value)));
  const previewControls = el('div', '', 'tactics-preview-controls');
  previewControls.append(field('Playback speed', speed), field('Loop', loop), field('Animation position (seconds)', scrub));
  phases.append(previewControls);
  phases.append(phaseHeading, frameButtons, frameSettings, field('Notes for this step', phaseNotes), phaseActions, previewControls, playback);
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
  const workbar = el('div', '', 'tactics-workbar');
  const undoControl = editingActions.children[0], redoControl = editingActions.children[1], playControl = playback.firstElementChild, saveControl = saveActions.firstElementChild;
  workbar.append(heading.firstChild, undoControl, redoControl, playControl, saveControl, status);
  const extras = el('details', '', 'tactics-compact-details'); extras.append(el('summary', 'Field, templates & export'), heading, editingActions, saveActions,
    button('Export SVG image', 'tactics-export', exportImage), button('Print diagram', 'tactics-print', printDiagram),
    button('Save draft as new setup', 'tactics-save-copy', () => { if (!editable() || recoveryNeeded) return; const draft = clone(record); clear(); record.title = (draft.title.slice(0, 73) + ' (copy)').slice(0, 80); record.content = draft.content; render(); tell('New unsaved copy. Save setup to keep it.'); notifyDraft(); }), intro);
  // Preserve existing controls and IDs while bringing the board and main actions forward.
  extras.append(help);
  editor.append(topActions, boardLayout, phases, extras, recoveryActions);
  mount.append(workbar, editor, library, reuse);
  function editedText() { $('tactics-undo').disabled = !undo.length; $('tactics-redo').disabled = !redo.length; $('tactics-save').disabled = recoveryNeeded || !record.title.trim() || (!dirty() && !!record.id); renderStatus(); notifyDraft(); }
  function duplicatePiece() {
    if (!selectedItem || record.content.items.length >= 40) return;
    mutate(() => { const original = record.content.items.find(i => i.id === selectedItem), copy = { ...original, id: uid('piece_') }; record.content.items.push(copy); for (const f of record.content.frames) { const p = f.positions.find(v => v.id === original.id), at = positionIn(f, original.id), next = { ...p, id: copy.id, x: clamp(at.x + 5), y: clamp(at.y + 5) }; delete next.attachedTo; f.positions.push(next); } selectedItem = copy.id; }, 'Piece copied into every step. A copied ball starts free.');
  }
  function reorderStep(direction) {
    const next = frameIndex + direction; if (next < 0 || next >= record.content.frames.length) return;
    mutate(() => { const [frame] = record.content.frames.splice(frameIndex, 1); record.content.frames.splice(next, 0, frame); frameIndex = next; }, 'Step moved. Review the movement before saving.');
  }
  function totalSeconds() { return record.content.frames.slice(0, -1).reduce((sum, f) => sum + f.duration, 0); }
  function positionIn(frame, id) {
    const p = frame.positions.find(p => p.id === id), player = p?.attachedTo && frame.positions.find(v => v.id === p.attachedTo);
    return player ? { id, x: Math.min(100, player.x + 6), y: Math.min(100, player.y + 6) } : { id, x: p.x, y: p.y };
  }
  function detachBall(frame, p) { if (!p?.attachedTo) return; Object.assign(p, positionIn(frame, p.id)); delete p.attachedTo; }
  function placePiece(frame, id, destination) {
    const p = frame.positions.find(p => p.id === id); if (!p) return;
    detachBall(frame, p); Object.assign(p, destination);
    for (const ball of frame.positions) if (ball.attachedTo === id) Object.assign(ball, positionIn(frame, ball.id));
  }
  // The same quadratic curve drives the visible path, scrubbing and playback.
  function curveControl(start, end, bend = 0) {
    const dx = (end.x - start.x) * 10, dy = (end.y - start.y) * 6.5, length = Math.hypot(dx, dy) || 1;
    return { x: Math.max(0, Math.min(1000, (start.x + end.x) * 5 - dy / length * bend * 4)), y: Math.max(0, Math.min(650, (start.y + end.y) * 3.25 + dx / length * bend * 4)) };
  }
  function motionPosition(from, to, id, t) {
    const p = from.positions.find(p => p.id === id), q = to.positions.find(p => p.id === id);
    if (p.attachedTo && p.attachedTo === q.attachedTo) { const player = motionPosition(from, to, p.attachedTo, t); return { id, x: Math.min(100, player.x + 6), y: Math.min(100, player.y + 6) }; }
    const start = positionIn(from, id), end = positionIn(to, id), c = curveControl(start, end, p.curve), u = 1 - t;
    return { id, x: u * u * start.x + 2 * u * t * c.x / 10 + t * t * end.x, y: u * u * start.y + 2 * u * t * c.y / 6.5 + t * t * end.y };
  }
  function motionPositions(from, to, t) { return from.positions.map(p => motionPosition(from, to, p.id, t)); }
  function seek(seconds) {
    if (!active() || !loaded || pending || context.busy || record.content.frames.length < 2) return;
    stopPlayback(); const frames = record.content.frames; frameIndex = 0;
    while (frameIndex < frames.length - 1 && seconds >= frames[frameIndex].duration) { seconds -= frames[frameIndex].duration; frameIndex++; }
    if (frameIndex < frames.length - 1) { elapsed = seconds * 1000; renderedPositions = motionPositions(currentFrame(), frames[frameIndex + 1], seconds / currentFrame().duration); }
    render();
  }
  function previewFrame(frame, items = record.content.items) {
    const thumbnail = svg('svg', { viewBox: '0 0 1000 650', 'aria-hidden': 'true' });
    thumbnail.append(svg('rect', { width: 1000, height: 650, fill: '#e3ebdc' }), svg('rect', { x: 25, y: 25, width: 950, height: 600, fill: 'none', stroke: '#8ea58b', 'stroke-width': 8 }));
    for (const raw of frame.positions) { const item = items.find(i => i.id === raw.id); if (!item) continue; const p = positionIn(frame, raw.id); thumbnail.append(svg('circle', { cx: p.x * 10, cy: p.y * 6.5, r: 24, fill: ({ home: '#255978', away: '#a9742a', cone: '#a8552e', ball: '#fff', goal: '#536e60' })[item.kind], stroke: '#293e37', 'stroke-width': 5 })); }
    return thumbnail;
  }
  function exportBoard() {
    const copy = board.cloneNode(true); copy.setAttribute('xmlns', ns); copy.setAttribute('width', '1600'); copy.setAttribute('height', '1040');
    copy.removeAttribute('id'); copy.removeAttribute('tabindex'); copy.removeAttribute('style');
    for (const n of copy.querySelectorAll('.tactics-hit')) n.remove();
    copy.prepend(svg('desc', {}, currentFrame().title + (currentFrame().notes ? '\n' + currentFrame().notes : ''))); return copy;
  }
  function exportImage() {
    if (!active() || !loaded || pending) return;
    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(exportBoard())], { type: 'image/svg+xml' }));
    const a = el('a'); a.href = url; a.download = 'star-soccer-drill.svg'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); tell('Current board exported as an SVG image.');
  }
  function printDiagram() {
    if (!active() || !loaded || pending) return;
    const page = window.open('', '_blank'); if (!page) return tell('Allow this print window or use Export image.', true);
    const doc = page.document; doc.title = 'Star Soccer drill'; const name = doc.createElement('h1'); name.textContent = record.title; const detail = doc.createElement('p'); detail.textContent = 'Step ' + (frameIndex + 1) + ': ' + currentFrame().title; const picture = doc.importNode(exportBoard(), true); picture.style.width = '100%'; picture.style.height = 'auto'; const notes = doc.createElement('p'); notes.textContent = currentFrame().notes || ''; notes.style.whiteSpace = 'pre-wrap'; doc.body.append(name, detail, picture, notes); page.focus(); page.print();
  }

  function renderReuseControls() {
    const disabled = !editable() || recoveryNeeded;
    sourceSelect.disabled = disabled || sourceSelect.options.length < 2;
    sourceBoard.disabled = disabled || !sourceDiagrams.length;
    $('tactics-source-load').disabled = disabled || !sourceSessionId;
    $('tactics-source-copy').disabled = disabled || !sourceDiagrams.some(d => d.id === sourceBoard.value);
  }
  function renderReuse() {
    const candidates = (context?.groupSessions || []).filter(s => s.id !== context?.selected && s.status !== 'Cancelled').sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.id).localeCompare(String(b.id)));
    if (!candidates.some(s => s.id === sourceSessionId)) { sourceSessionId = ''; sourceDiagrams = []; }
    sourceSelect.replaceChildren(...[['', 'Choose a session'], ...candidates.map(s => [s.id, [s.date, s.time, s.location].filter(Boolean).join(' · ')])].map(([value, label]) => { const option = el('option', label); option.value = value; return option; }));
    sourceSelect.value = sourceSessionId;
    const selected = sourceBoard.value;
    sourceBoard.replaceChildren(...[['', sourceDiagrams.length ? 'Choose a saved setup' : 'Load a session first'], ...sourceDiagrams.map(d => [d.id, d.title])].map(([value, label]) => { const option = el('option', label); option.value = value; return option; }));
    sourceBoard.value = sourceDiagrams.some(d => d.id === selected) ? selected : '';
    renderReuseControls();
  }
  async function loadSource() {
    if (!editable() || recoveryNeeded || !sourceSessionId || !context.groupSessions?.some(s => s.id === sourceSessionId && s.id !== context.selected && s.status !== 'Cancelled')) return;
    const ticket = ++requestEpoch, startedIdentity = identity, source = sourceSessionId, target = context.selected;
    pending = true; sourceDiagrams = []; sourceStatus.textContent = 'Loading saved setups…'; render();
    try {
      const result = await request('source-list', { sessionId: target, sourceSessionId: source });
      if (ticket !== requestEpoch || identity !== startedIdentity || context?.selected !== target || sourceSessionId !== source) return;
      if (!Array.isArray(result.diagrams) || result.diagrams.some(d => d.session_id !== source || !d.id || typeof d.title !== 'string' || d.content?.schemaVersion !== 1 || !Array.isArray(d.content.items) || !Array.isArray(d.content.frames) || !d.content.frames.length)) throw Error('The source setups could not be verified. Your current diagram is unchanged.');
      sourceDiagrams = clone(result.diagrams);
      sourceStatus.textContent = sourceDiagrams.length ? sourceDiagrams.length + ' saved setup' + (sourceDiagrams.length === 1 ? '' : 's') + ' available. Choose one to copy.' : 'No saved setups in that session. Choose another session.';
    } catch (error) { if (ticket === requestEpoch && identity === startedIdentity) sourceStatus.textContent = error.message || 'The source session could not be loaded. Your diagram is unchanged.'; }
    finally { if (ticket === requestEpoch && identity === startedIdentity) { pending = false; render(); } }
  }
  function copySource() {
    if (!editable() || recoveryNeeded) return;
    const source = sourceDiagrams.find(d => d.id === sourceBoard.value);
    if (!source || source.session_id !== sourceSessionId || !context.groupSessions?.some(s => s.id === sourceSessionId && s.id !== context.selected && s.status !== 'Cancelled')) return;
    if (dirty() && !confirm('Copy this setup and discard your current unsaved diagram changes?')) return;
    const copied = clone(source.content), copiedTitle = source.title.trim().slice(0, 73) + ' (copy)';
    clear(); record.title = copiedTitle.slice(0, 80); record.content = copied;
    tell('Copied into a new unsaved setup for this session. The original is unchanged.'); render(); notifyDraft();
  }

  function renderStatus() {
    status.textContent = (dirty() ? 'Unsaved changes · ' : '') + message;
    status.classList.toggle('tactics-error', messageError);
  }
  function render() {
    if (!context?.profile) { mount.replaceChildren(); return; }
    if (!mount.childElementCount) mount.append(workbar, editor, library, reuse);
    title.value = record.title; pitch.value = record.content.pitch;
    librarySelect.replaceChildren(); const unsaved = el('option', 'New unsaved setup'); unsaved.value = ''; librarySelect.append(unsaved);
    for (const d of diagrams) { const option = el('option', d.title); option.value = d.id; librarySelect.append(option); }
    librarySelect.value = record.id || '';
    itemSelect.replaceChildren(); const none = el('option', 'Choose a piece'); none.value = ''; itemSelect.append(none);
    for (const item of record.content.items) { const option = el('option', kinds[item.kind] + (item.label ? ' · ' + item.label : '')); option.value = item.id; itemSelect.append(option); }
    if (!record.content.items.some(i => i.id === selectedItem)) selectedItem = '';
    itemSelect.value = selectedItem; labelInput.value = record.content.items.find(i => i.id === selectedItem)?.label || '';
    const position = currentFrame().positions.find(p => p.id === selectedItem); coordinate.textContent = position ? 'Position: ' + Math.round(position.x) + '% across · ' + Math.round(position.y) + '% down' : 'Select a piece to position or label it.';
    const selectedKind = record.content.items.find(i => i.id === selectedItem)?.kind;
    carrier.replaceChildren(); const free = el('option', 'Free ball'); free.value = ''; carrier.append(free);
    for (const player of record.content.items.filter(i => ['home', 'away'].includes(i.kind))) { const option = el('option', kinds[player.kind] + ' ' + player.label); option.value = player.id; carrier.append(option); }
    carrier.value = position?.attachedTo || ''; carrierField.hidden = selectedKind !== 'ball'; detach.hidden = !position?.attachedTo;
    const nextPosition = record.content.frames[frameIndex + 1]?.positions.find(p => p.id === selectedItem);
    bendField.hidden = !['home', 'away', 'ball'].includes(selectedKind) || !nextPosition || !!position?.attachedTo && position.attachedTo === nextPosition.attachedTo;
    bend.value = String(position?.curve || 0); bendValue.textContent = Number(bend.value) === 0 ? 'Straight' : (Number(bend.value) < 0 ? 'Left' : 'Right') + ' bend · ' + Math.abs(Number(bend.value));
    side.dataset.selected = String(!!selectedItem);
    const phaseScroll = frameButtons.scrollLeft;
    frameButtons.replaceChildren(...record.content.frames.map((f, index) => { const b = button('', 'tactics-frame-' + index, () => { if (!editable()) return; stopPlayback(); frameIndex = index; render(); }); const preview = el('span', '', 'tactics-frame-preview'); preview.append(previewFrame(f)); b.append(preview, el('span', (index + 1) + '. ' + f.title)); b.dataset.tacticsFrame = index; b.setAttribute('aria-pressed', String(frameIndex === index)); return b; }));
    frameButtons.scrollLeft = phaseScroll;
    frameTitle.value = currentFrame().title; duration.value = String(currentFrame().duration); phaseNotes.value = currentFrame().notes || '';
    durationField.hidden = frameIndex === record.content.frames.length - 1;
    $('tactics-sequence-summary').textContent = record.content.frames.length + ' / 12 steps · ' + totalSeconds() + 's · ' + record.content.items.length + ' / 40 pieces';
    const disabled = !editable();
    for (const control of mount.querySelectorAll('button,input,select,textarea')) control.disabled = disabled;
    $('tactics-play').disabled = !active() || !loaded || pending || context.busy || record.content.frames.length < 2;
    $('tactics-reset').disabled = !active() || !loaded || pending || context.busy;
    speed.disabled = loop.disabled = scrub.disabled = !active() || !loaded || pending || context.busy || record.content.frames.length < 2;
    scrub.max = String(totalSeconds());
    $('tactics-retry').disabled = !active() || pending || context.busy;
    pathToggle.disabled = !active() || !loaded;
    labelInput.disabled = disabled || !selectedItem;
    for (const control of side.querySelectorAll('button')) control.disabled = disabled || !selectedItem;
    $('tactics-duplicate-item').disabled = disabled || !selectedItem || record.content.items.length >= 40;
    $('tactics-step-earlier').disabled = disabled || frameIndex === 0;
    $('tactics-step-later').disabled = disabled || frameIndex === record.content.frames.length - 1;
    $('tactics-save-copy').disabled = disabled || recoveryNeeded;
    $('tactics-remove-frame').disabled = disabled || record.content.frames.length <= 1;
    $('tactics-add-frame').disabled = disabled || record.content.frames.length >= 12;
    $('tactics-save').disabled = disabled || recoveryNeeded || !record.title.trim() || (!dirty() && !!record.id);
    $('tactics-archive').disabled = disabled || !record.id;
    reopen.hidden = !record.id; reopen.disabled = disabled || !record.id || !diagrams.some(d => d.id === record.id);
    $('tactics-undo').disabled = disabled || !undo.length; $('tactics-redo').disabled = disabled || !redo.length;
    for (const control of addGroup.querySelectorAll('button')) control.disabled = disabled || record.content.items.length >= 40;
    emptyHint.hidden = !!record.content.items.length;
    mount.setAttribute('aria-busy', String(pending));
    renderReuse();
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
    if (pathToggle.checked && frameIndex < record.content.frames.length - 1) {
      const from = currentFrame(), to = record.content.frames[frameIndex + 1];
      for (const item of record.content.items) {
        if (!['home', 'away', 'ball'].includes(item.kind)) continue;
        const p = from.positions.find(p => p.id === item.id), q = to.positions.find(p => p.id === item.id);
        if (p.attachedTo && p.attachedTo === q.attachedTo) continue;
        const start = positionIn(from, item.id), end = positionIn(to, item.id); if (Math.hypot(end.x - start.x, end.y - start.y) < 1) continue;
        const c = curveControl(start, end, p.curve);
        board.append(svg('path', { d: 'M ' + start.x * 10 + ' ' + start.y * 6.5 + ' Q ' + c.x + ' ' + c.y + ' ' + end.x * 10 + ' ' + end.y * 6.5, 'data-tactics-path': item.id, fill: 'none', stroke: '#536e60', 'stroke-width': 4, 'stroke-dasharray': item.kind === 'ball' ? 'none' : '9 7', 'marker-end': 'url(#tactics-arrow)', opacity: .85, 'pointer-events': 'none' }));
      }
    }
    const positions = renderedPositions || currentFrame().positions;
    for (const item of record.content.items) {
      const p = renderedPositions ? positions.find(point => point.id === item.id) : positionIn(currentFrame(), item.id); if (!p) continue;
      const piece = svg('g', { transform: 'translate(' + (p.x * 10) + ' ' + (p.y * 6.5) + ')', 'data-tactics-item': item.id, role: 'button', tabindex: editable() ? '0' : '-1', 'aria-label': kinds[item.kind] + (item.label ? ' ' + item.label : '') + ', position ' + Math.round(p.x) + ', ' + Math.round(p.y), 'aria-pressed': String(item.id === selectedItem), 'aria-disabled': String(!editable()) });
      const screenScale = Math.max(.01, board.getScreenCTM()?.a || 1), artScale = Math.max(1, .85 / screenScale);
      const art = svg('g', { class: 'tactics-piece-art', transform: 'scale(' + artScale + ')' });
      const hitRadius = Math.max(26, 22 / screenScale / artScale);
      piece.append(art); art.append(svg('circle', { r: hitRadius, fill: 'transparent', class: 'tactics-hit' }));
      if (item.id === selectedItem) art.append(svg('circle', { r: 28, fill: 'none', stroke: '#152d42', 'stroke-width': 3, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
      if (['home', 'away'].includes(item.kind)) art.append(svg('circle', { r: 20, fill: item.kind === 'home' ? '#255978' : '#e7c59a', stroke: item.kind === 'home' ? '#fff' : '#704e29', 'stroke-width': 2.5 }));
      if (item.kind === 'cone') art.append(svg('path', { d: 'M0 -21 L20 18 L-20 18z', fill: '#c86e37', stroke: '#7e3c20', 'stroke-width': 2 }));
      if (item.kind === 'ball') art.append(svg('circle', { r: 15, fill: '#fff', stroke: '#253a48', 'stroke-width': 3 }), svg('path', { d: 'M0 -8 L8 -2 L5 7 L-5 7 L-8 -2z', fill: '#253a48' }));
      if (item.kind === 'goal') art.append(svg('rect', { x: -28, y: -15, width: 56, height: 30, fill: '#fff', stroke: '#536e60', 'stroke-width': 4 }), svg('path', { d: 'M-18 -15V15 M-7 -15V15 M7 -15V15 M18 -15V15 M-28 0H28', stroke: '#a5b5a2', 'stroke-width': 1.5 }));
      if (item.label) {
        const inside = ['home', 'away'].includes(item.kind) && item.label.length <= 3, width = Math.max(34, item.label.length * 8 + 12);
        const labelX = inside ? 0 : Math.max((-116 - p.x * 10) / artScale + width / 2, Math.min(0, (1116 - p.x * 10) / artScale - width / 2));
        const labelY = p.y * 6.5 + 47 * artScale > 766 ? -47 : 27;
        if (!inside) art.append(svg('rect', { x: labelX - width / 2, y: labelY, width, height: 20, rx: 5, fill: '#f6f4ec', 'pointer-events': 'none' }));
        art.append(svg('text', { x: labelX, y: inside ? 5 : labelY + 14, 'text-anchor': 'middle', 'font-family': 'Arial,sans-serif', 'font-size': inside ? 16 : 12, 'font-weight': 700, fill: inside && item.kind === 'home' ? '#fff' : '#173044', 'pointer-events': 'none' }, item.label));
      }
      board.append(piece);
    }
  }
  const clamp = v => Math.max(4, Math.min(96, Math.round(v * 10) / 10));
  function moveSelected(dx, dy) { mutate(() => { if (!selectedItem) return; const p = positionIn(currentFrame(), selectedItem); placePiece(currentFrame(), selectedItem, { x: clamp(p.x + dx), y: clamp(p.y + dy) }); }); }
  function point(event) { const p = board.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; const matrix = board.getScreenCTM(); if (!matrix) return null; const next = p.matrixTransform(matrix.inverse()); return { x: clamp(next.x / 10), y: clamp(next.y / 6.5) }; }
  board.addEventListener('dragover', event => { if (editable() && event.dataTransfer.types.includes('application/x-coach-piece')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
  board.addEventListener('drop', event => { if (!editable()) return; const kind = event.dataTransfer.getData('application/x-coach-piece'), destination = point(event); if (!kinds[kind] || !destination) return; event.preventDefault(); addPiece(kind, destination); });
  board.addEventListener('pointerdown', event => {
    if (!editable() || event.button !== 0) return;
    const target = event.target.closest('[data-tactics-item]');
    if (target) { selectedItem = target.dataset.tacticsItem; stopPlayback(); pointer = { id: event.pointerId, before: capture(), moved: false }; board.setPointerCapture(event.pointerId); event.preventDefault(); render(); }
    else if (selectedItem) { const destination = point(event); if (destination) mutate(() => placePiece(currentFrame(), selectedItem, destination)); }
  });
  board.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId || !editable()) return;
    const destination = point(event), p = currentFrame().positions.find(p => p.id === selectedItem); if (!destination || !p || p.x === destination.x && p.y === destination.y) return;
    if (!pointer.moved) { undo.push(pointer.before); if (undo.length > 30) undo.shift(); redo = []; pointer.moved = true; }
    placePiece(currentFrame(), selectedItem, destination); draw(); renderStatus(); notifyDraft();
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
  mount.addEventListener('keydown', event => {
    if (!editable() || event.target.closest('input,textarea,select,[contenteditable=true]')) return;
    let control;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') control = event.shiftKey ? 'tactics-redo' : 'tactics-undo';
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') control = 'tactics-redo';
    else if (event.key === 'Delete' && selectedItem) control = 'tactics-remove-item';
    else if (event.key === 'Escape' && selectedItem) { event.preventDefault(); event.stopPropagation(); selectedItem = ''; render(); board.focus(); return; }
    if (control) { event.preventDefault(); $(control).click(); board.focus(); }
  });
  function renderPlayback() {
    if (!$('tactics-play')) return;
    $('tactics-play').textContent = running ? 'Pause movement' : elapsed ? 'Resume movement' : 'Play movement';
    $('tactics-play').setAttribute('aria-pressed', String(running));
    $('tactics-playback-status').textContent = record.content.frames.length < 2 ? 'Add a next phase to animate movement.' : (running ? 'Playing · ' : elapsed ? 'Paused · ' : '') + 'Phase ' + (frameIndex + 1) + ' of ' + record.content.frames.length;
    scrub.value = String(record.content.frames.slice(0, frameIndex).reduce((sum, f) => sum + f.duration, 0) + elapsed / 1000);
    for (const b of frameButtons.children) b.setAttribute('aria-pressed', String(Number(b.dataset.tacticsFrame) === frameIndex));
    if (running) { frameTitle.value = currentFrame().title; phaseNotes.value = currentFrame().notes || ''; duration.value = currentFrame().duration; }
    const current = frameButtons.children[frameIndex];
    if (current) { const a = current.getBoundingClientRect(), b = frameButtons.getBoundingClientRect(); if (a.left < b.left) frameButtons.scrollLeft -= b.left - a.left; else if (a.right > b.right) frameButtons.scrollLeft += a.right - b.right; }
  }
  function tick(now) {
    if (!running) return;
    const frames = record.content.frames, durationMs = frames[frameIndex].duration * 1000, progress = Math.min(1, (elapsed + (now - started) * playbackSpeed) / durationMs);
    const from = frames[frameIndex], to = frames[frameIndex + 1];
    renderedPositions = motionPositions(from, to, progress);
    draw();
    scrub.value = String(frames.slice(0, frameIndex).reduce((sum, f) => sum + f.duration, 0) + progress * currentFrame().duration);
    if (progress >= 1) { frameIndex++; elapsed = 0; started = now; if (frameIndex >= frames.length - 1) { if (loopPlayback) { frameIndex = 0; renderedPositions = null; } else { stopPlayback(); render(); return; } } renderPlayback(); }
    animation = requestAnimationFrame(tick);
  }
  function pause() { if (!running) return; elapsed += (performance.now() - started) * playbackSpeed; stopPlayback(false); render(); }
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
    if (changed) { identity = nextIdentity; requestEpoch++; pending = false; loaded = false; loadAttempted = false; diagrams = []; sourceSessionId = ''; sourceDiagrams = []; sourceStatus.textContent = ''; reuse.open = false; clear(); tell(nextIdentity ? 'Open the board to load this session’s setups.' : 'Choose a session, then open the tactics board.'); }
    if (!next?.profile) { loaded = false; diagrams = []; }
    render();
    if (!loaded && !loadAttempted && !pending && active() && $('tactics-disclosure')?.open) load();
  });
  $('tactics-disclosure')?.addEventListener('toggle', event => { if (!event.currentTarget.open) pause(); else if (!loaded) load(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
  window.addEventListener('pagehide', () => stopPlayback());
  let boardWidth = 0;
  new ResizeObserver(() => { const width = board.getBoundingClientRect().width; if (width && width !== boardWidth) { boardWidth = width; draw(); } }).observe(board);
  new ResizeObserver(() => { const scroller = mount.closest('.planner-drawer-content'); if (scroller) scroller.style.scrollPaddingTop = (getComputedStyle(workbar).position === 'sticky' ? workbar.getBoundingClientRect().height + 12 : 12) + 'px'; }).observe(workbar);
  render();
  window.dispatchEvent(new CustomEvent('coach:request-context'));
})();
