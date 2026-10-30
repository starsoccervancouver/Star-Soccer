/* Session preparation only. Saves diagrams through the authenticated Coach Desk bridge. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), mount = $('tactics-board-tools');
  if (!mount) return;
  const ns = 'http://www.w3.org/2000/svg';
  const clone = value => JSON.parse(JSON.stringify(value));
  const uid = prefix => prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const kinds = { home: 'Blue player', away: 'Gold player', cone: 'Cone', ball: 'Ball', goal: 'Goal', zone: 'Zone' };
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
      if (kind === 'zone') { item.label = 'Zone'; item.zone = { shape: 'rect', width: 25, height: 25, color: 'blue' }; }
      record.content.items.push(item); const offset = record.content.items.length % 6;
      for (const frame of record.content.frames) { frame.positions.push({ id: item.id, ...(destination || { x: 43 + offset * 3, y: 42 + offset * 3 }) }); if (kind === 'zone') constrainZone(frame, item); }
      selectedItem = item.id;
    }, kinds[kind] + ' added. Drag it, tap its destination, or use the position controls.');
  }
  for (const [kind, label] of Object.entries(kinds)) {
    const add = button('+ ' + label, 'tactics-add-' + kind, () => addPiece(kind));
    const icon = svg('svg', { viewBox: '-36 -32 72 64', width: 24, height: 24, 'aria-hidden': 'true' }); icon.append(pieceArtwork(kind)); add.prepend(icon);
    add.draggable = true; add.title = 'Click to add, or drag onto the field';
    add.addEventListener('dragstart', event => { if (!editable() || add.disabled) return event.preventDefault(); event.dataTransfer.setData('application/x-coach-piece', kind); event.dataTransfer.effectAllowed = 'copy'; });
    add.dataset.pieceKind = kind; addGroup.append(add);
  }
  topActions.append(addGroup);
  const boardLayout = el('div', '', 'tactics-board-layout');
  const canvasWrap = el('div', '', 'tactics-canvas-wrap');
  const board = svg('svg', { id: 'tactics-pitch-board', viewBox: '-120 -100 1240 870', role: 'group', 'aria-label': 'Tactics field. Select a piece and drag, tap a destination, or use arrow keys.', tabindex: '0' });
  canvasWrap.append(board);
  const pathCaption = el('p', '', 'tactics-path-caption'); pathCaption.id = 'tactics-path-caption';
  const emptyHint = el('div', 'Add a player or try the passing triangle to begin.', 'tactics-empty-hint'); emptyHint.id = 'tactics-empty-hint'; canvasWrap.append(emptyHint);
  const help = el('p', 'Place the starting pieces, add a next phase, then drag players and balls along their route. The full drag is recorded, including curves. Paths show movement into the selected phase; during playback they show the next movement. Dashed: player. Solid: ball. Equipment and zones have no paths. Drag an attached ball to release it. Arrows: move · Shift: farther · Ctrl/⌘ Z: undo · Delete: remove from all steps · Escape: deselect.', 'tactics-board-help');
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
  bend.addEventListener('change', () => mutate(() => { const transition = shownTransition(); if (!transition) return; const p = transition.from.positions.find(p => p.id === selectedItem), q = transition.to.positions.find(p => p.id === selectedItem); if (!p || !q) return; delete q.trail; const value = Number(bend.value); if (value) p.curve = value; else delete p.curve; }, 'Recorded route replaced with a simple bend. Undo restores it.'));
  const bendField = field('Simple bend · replaces dragged route', bend); bendField.append(bendValue);
  const straighten = button('Straighten path', 'tactics-straighten', () => mutate(() => { const transition = shownTransition(); if (!transition) return; delete transition.from.positions.find(p => p.id === selectedItem).curve; delete transition.to.positions.find(p => p.id === selectedItem).trail; }, 'Path straightened. Undo restores the recorded route.'));
  const redrawRoute = button('Redraw route', 'tactics-redraw-route', () => mutate(() => { const transition = shownTransition(); if (!transition || !selectedItem) return; const start = positionIn(transition.from, selectedItem); delete transition.from.positions.find(p => p.id === selectedItem).curve; delete transition.to.positions.find(p => p.id === selectedItem).trail; frameIndex = transition.index + 1; placePiece(currentFrame(), selectedItem, { x: start.x, y: start.y }); }, 'Back at the start of this movement. Drag the piece along its new route.'));
  redrawRoute.title = 'Start this movement again from the previous phase';
  const routeActions = el('div', '', 'tactics-route-actions'); routeActions.append(redrawRoute, straighten);
  const zoneControls = el('div', '', 'tactics-zone-controls');
  const zoneShape = select('tactics-zone-shape', [['rect', 'Rectangle'], ['ellipse', 'Oval']]);
  const zoneColor = select('tactics-zone-color', [['blue', 'Blue'], ['gold', 'Gold'], ['green', 'Green']]);
  const zoneWidth = input('tactics-zone-width', 'range'), zoneHeight = input('tactics-zone-height', 'range');
  for (const control of [zoneWidth, zoneHeight]) { control.min = '5'; control.max = '90'; control.step = '1'; }
  for (const [control, key] of [[zoneShape, 'shape'], [zoneColor, 'color'], [zoneWidth, 'width'], [zoneHeight, 'height']]) control.addEventListener('change', () => mutate(() => { const item = record.content.items.find(i => i.id === selectedItem); if (!item?.zone) return; item.zone[key] = ['width', 'height'].includes(key) ? Number(control.value) : control.value; for (const f of record.content.frames) constrainZone(f, item); }, 'Zone updated in every phase.'));
  zoneControls.append(field('Zone shape', zoneShape), field('Zone colour', zoneColor), field('Zone width', zoneWidth), field('Zone height', zoneHeight), el('p', 'Drag the zone to move it. Shape and size apply to every phase.', 'small'));
  side.append(el('p', 'Select a piece on the field or use the list below. Drag to move; Escape clears selection.', 'tactics-selection-hint'), field('Selected piece', itemSelect), field('Short label', labelInput), carrierField, detach, bendField, nudge, coordinate, button('Duplicate piece', 'tactics-duplicate-item', duplicatePiece), button('Remove from all steps', 'tactics-remove-item', () => mutate(() => { const id = selectedItem; for (const f of record.content.frames) { for (const p of f.positions) if (p.attachedTo === id) detachBall(f, p); f.positions = f.positions.filter(p => p.id !== id); } record.content.items = record.content.items.filter(i => i.id !== id); selectedItem = ''; }, 'Piece removed from every step. Undo restores it.')), pathLabel);
  side.insertBefore(zoneControls, nudge); side.insertBefore(routeActions, nudge);
  canvasWrap.append(pathCaption); boardLayout.append(canvasWrap, side);
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
  phaseActions.append(button('+ Next phase', 'tactics-add-frame', () => mutate(() => { if (record.content.frames.length >= 12) return tell('Use up to 12 phases in one setup.', true); const next = clone(currentFrame()); next.id = uid('phase_'); next.title = 'Phase ' + (record.content.frames.length + 1); for (const p of next.positions) delete p.trail; record.content.frames.splice(frameIndex + 1, 0, next); frameIndex++; }, 'Phase copied. Drag players and balls along the route you want to record.')), button('Remove phase', 'tactics-remove-frame', () => mutate(() => { if (record.content.frames.length <= 1) return; record.content.frames.splice(frameIndex, 1); frameIndex = Math.min(frameIndex, record.content.frames.length - 1); }, 'Phase removed.')));
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
    mutate(() => { const original = record.content.items.find(i => i.id === selectedItem), copy = { ...clone(original), id: uid('piece_') }; record.content.items.push(copy); for (const f of record.content.frames) { const p = f.positions.find(v => v.id === original.id), at = positionIn(f, original.id), next = { ...p, id: copy.id, x: clamp(at.x + 5), y: clamp(at.y + 5) }; delete next.attachedTo; if (next.trail) next.trail = next.trail.map(p => ({ x: clamp(p.x + 5), y: clamp(p.y + 5) })); f.positions.push(next); if (copy.zone) constrainZone(f, copy); } selectedItem = copy.id; }, 'Piece copied into every step. A copied ball starts free.');
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
  function constrainZone(frame, item) {
    const p = frame.positions.find(p => p.id === item.id); if (!p || !item.zone) return;
    p.x = Math.max(item.zone.width / 2, Math.min(100 - item.zone.width / 2, p.x)); p.y = Math.max(item.zone.height / 2, Math.min(100 - item.zone.height / 2, p.y));
  }
  function placePiece(frame, id, destination) {
    const p = frame.positions.find(p => p.id === id); if (!p) return;
    detachBall(frame, p); Object.assign(p, destination);
    const item = record.content.items.find(i => i.id === id); if (item?.zone) constrainZone(frame, item);
    for (const ball of frame.positions) if (ball.attachedTo === id) Object.assign(ball, positionIn(frame, ball.id));
  }
  function shownTransition() {
    const index = running || elapsed || frameIndex === 0 ? frameIndex : frameIndex - 1;
    return record.content.frames[index + 1] ? { from: record.content.frames[index], to: record.content.frames[index + 1], index } : null;
  }
  const routeDistance = (a, b) => Math.hypot(a.x - b.x, (a.y - b.y) * .65);
  // Reduce hand jitter while retaining the actual route, bounded for saved diagrams.
  function simplifyRoute(points, tolerance = .35) {
    if (points.length <= 2) return points;
    const a = points[0], b = points.at(-1), dx = b.x - a.x, dy = (b.y - a.y) * .65, length = dx * dx + dy * dy;
    let max = tolerance, split = 0;
    for (let i = 1; i < points.length - 1; i++) { const p = points[i], t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * .65 * dy) / length)) : 0, distance = routeDistance(p, { x: a.x + dx * t, y: a.y + dy / .65 * t }); if (distance > max) { max = distance; split = i; } }
    return split ? [...simplifyRoute(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplifyRoute(points.slice(split), tolerance)] : [a, b];
  }
  function boundedRoute(points, limit = 34) { let reduced = simplifyRoute(points), tolerance = .35; while (reduced.length > limit) { tolerance *= 1.5; reduced = simplifyRoute(points, tolerance); } return reduced; }
  function saveDraggedRoute(points) {
    const reduced = boundedRoute(points);
    const p = currentFrame().positions.find(p => p.id === selectedItem); if (!p) return;
    if (reduced.length > 2) p.trail = reduced.slice(1, -1).map(p => ({ x: p.x, y: p.y })); else delete p.trail;
    if (frameIndex) delete record.content.frames[frameIndex - 1].positions.find(p => p.id === selectedItem).curve;
  }
  // Paths and playback use one route, including captured drags and legacy bends.
  function curveControl(start, end, bend = 0) {
    const dx = (end.x - start.x) * 10, dy = (end.y - start.y) * 6.5, length = Math.hypot(dx, dy) || 1;
    return { x: Math.max(0, Math.min(1000, (start.x + end.x) * 5 - dy / length * bend * 4)), y: Math.max(0, Math.min(650, (start.y + end.y) * 3.25 + dx / length * bend * 4)) };
  }
  function routePoints(from, to, id) {
    const p = from.positions.find(p => p.id === id), q = to.positions.find(p => p.id === id);
    if (p.attachedTo && p.attachedTo === q.attachedTo) return routePoints(from, to, p.attachedTo).map(p => ({ x: Math.min(100, p.x + 6), y: Math.min(100, p.y + 6) }));
    const start = positionIn(from, id), end = positionIn(to, id);
    if (q.trail?.length) return [start, ...q.trail, end];
    if (!p.curve) return [start, end];
    const c = curveControl(start, end, p.curve);
    return Array.from({ length: 25 }, (_, i) => { const t = i / 24, u = 1 - t; return { x: u * u * start.x + 2 * u * t * c.x / 10 + t * t * end.x, y: u * u * start.y + 2 * u * t * c.y / 6.5 + t * t * end.y }; });
  }
  function motionPosition(from, to, id, t) {
    const p = from.positions.find(p => p.id === id), q = to.positions.find(p => p.id === id);
    if (p.attachedTo && p.attachedTo === q.attachedTo) { const carrier = motionPosition(from, to, p.attachedTo, t); return { id, x: Math.min(100, carrier.x + 6), y: Math.min(100, carrier.y + 6) }; }
    const points = routePoints(from, to, id), lengths = points.slice(1).map((p, i) => routeDistance(points[i], p));
    let remaining = lengths.reduce((sum, v) => sum + v, 0) * t;
    for (let i = 0; i < lengths.length; i++) { if (remaining <= lengths[i] || i === lengths.length - 1) { const fraction = lengths[i] ? remaining / lengths[i] : 1, a = points[i], b = points[i + 1]; return { id, x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction }; } remaining -= lengths[i]; }
  }
  function motionPositions(from, to, t) { return from.positions.map(p => motionPosition(from, to, p.id, t)); }
  function pieceArtwork(kind) {
    const art = svg('g', { 'aria-hidden': 'true', 'data-symbol': kind, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    if (['home', 'away'].includes(kind)) {
      const fill = kind === 'home' ? '#326887' : '#d9ae63';
      art.append(svg('path', { d: 'M-9-22 L-24-13 L-17-1 L-11-5 V23 H11 V-5 L17-1 L24-13 L9-22 Q0-13-9-22Z', fill, stroke: '#f8faf8', 'stroke-width': 3 }), svg('path', { d: 'M-9-22 Q0-7 9-22 M-11 18 H11', fill: 'none', stroke: kind === 'home' ? '#a5c5d7' : '#826333', 'stroke-width': 2 }));
    } else if (kind === 'cone') {
      art.append(svg('ellipse', { cx: 0, cy: 19, rx: 25, ry: 7, fill: '#8d482d' }), svg('path', { d: 'M-18 17 L-5-23 Q0-28 5-23 L18 17 Q0 26-18 17Z', fill: '#df8950', stroke: '#85482e', 'stroke-width': 2 }), svg('path', { d: 'M-11-3 Q0 3 11-3 L14 6 Q0 13-14 6Z', fill: '#fff4dc' }), svg('path', { d: 'M0-20 L-9 16', fill: 'none', stroke: '#f8bd83', 'stroke-width': 3 }));
    } else if (kind === 'ball') {
      art.append(svg('circle', { r: 16, fill: '#fffdf7', stroke: '#334451', 'stroke-width': 2 }), svg('path', { d: 'M0-8 L8-2 L5 7 L-5 7 L-8-2Z M0-8 V-16 M8-2 L15-5 M5 7 L10 13 M-5 7 L-10 13 M-8-2 L-15-5', fill: '#334451', stroke: '#334451', 'stroke-width': 1.5 }), svg('path', { d: 'M-5-14 L0-11 L5-14 M13-8 L11-3 L15 0 M12 10 L6 10 L5 15 M-12 10 L-6 10 L-5 15 M-13-8 L-11-3 L-15 0', fill: 'none', stroke: '#334451', 'stroke-width': 2 }));
    } else if (kind === 'goal') {
      art.append(svg('path', { d: 'M-30 21 L-24-20 H24 L30 21Z', fill: '#eef3f2', stroke: '#667a7c', 'stroke-width': 2 }), svg('path', { d: 'M-24-20 L-30-9 H30 L24-20 M-30-9 V21 H30 V-9 M-18-18 L-21 21 M-6-19 L-7 21 M6-19 L7 21 M18-18 L21 21 M-27 1 H27 M-29 11 H29', fill: 'none', stroke: '#9caca9', 'stroke-width': 1.5 }), svg('path', { d: 'M-30 21 V-9 H30 V21', fill: 'none', stroke: '#344b57', 'stroke-width': 6 }), svg('path', { d: 'M-30 21 V-9 H30 V21', fill: 'none', stroke: '#fffdf5', 'stroke-width': 3 }));
    } else if (kind === 'zone') art.append(svg('rect', { x: -29, y: -22, width: 58, height: 44, rx: 3, fill: '#668ab32b', stroke: '#53789d', 'stroke-width': 3, 'stroke-dasharray': '5 4' }));
    return art;
  }
  function zoneArtwork(item, p, preview = false) {
    const width = item.zone.width * 10, height = item.zone.height * 6.5, color = { blue: '#426f9b', gold: '#956b20', green: '#397561' }[item.zone.color];
    const group = svg('g', { transform: 'translate(' + p.x * 10 + ' ' + p.y * 6.5 + ')', 'data-zone': item.id });
    if (!preview) { group.dataset.tacticsItem = item.id; group.setAttribute('role', 'button'); group.setAttribute('tabindex', editable() ? '0' : '-1'); group.setAttribute('aria-label', 'Zone ' + item.label); group.setAttribute('aria-pressed', String(selectedItem === item.id)); }
    const attrs = { fill: color, 'fill-opacity': .13, stroke: color, 'stroke-width': selectedItem === item.id && !preview ? 3 : 2, 'stroke-dasharray': '7 5', 'vector-effect': 'non-scaling-stroke' };
    group.append(item.zone.shape === 'ellipse' ? svg('ellipse', { rx: width / 2, ry: height / 2, ...attrs }) : svg('rect', { x: -width / 2, y: -height / 2, width, height, rx: 5, ...attrs }));
    if (item.label && !preview) { const font = Math.max(15, 11 / Math.max(.01, board.getScreenCTM()?.a || 1)); group.append(svg('text', { x: 0, y: 5, 'text-anchor': 'middle', 'font-family': 'Arial,sans-serif', 'font-size': font, 'font-weight': 700, fill: color, 'pointer-events': 'none' }, item.label)); }
    return group;
  }
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
    for (const item of [...items].sort((a, b) => (b.kind === 'zone') - (a.kind === 'zone'))) { const p = positionIn(frame, item.id); if (item.kind === 'zone') thumbnail.append(zoneArtwork(item, p, true)); else { const symbol = svg('g', { transform: 'translate(' + p.x * 10 + ' ' + p.y * 6.5 + ') scale(1.6)' }); symbol.append(pieceArtwork(item.kind)); thumbnail.append(symbol); } }
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
    const transition = shownTransition(), routeStart = transition?.from.positions.find(p => p.id === selectedItem), routeEnd = transition?.to.positions.find(p => p.id === selectedItem);
    bendField.hidden = !['home', 'away', 'ball'].includes(selectedKind) || !routeEnd || !!routeStart?.attachedTo && routeStart.attachedTo === routeEnd.attachedTo;
    routeActions.hidden = bendField.hidden;
    bend.value = String(routeStart?.curve || 0); bendValue.textContent = routeEnd?.trail?.length ? 'Recorded drag route' : Number(bend.value) === 0 ? 'Straight' : (Number(bend.value) < 0 ? 'Left' : 'Right') + ' bend · ' + Math.abs(Number(bend.value));
    zoneControls.hidden = selectedKind !== 'zone';
    if (!zoneControls.hidden) { const zone = record.content.items.find(i => i.id === selectedItem).zone; zoneShape.value = zone.shape; zoneColor.value = zone.color; zoneWidth.value = zone.width; zoneHeight.value = zone.height; }
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
    for (const item of record.content.items.filter(i => i.kind === 'zone')) { const p = renderedPositions?.find(p => p.id === item.id) || positionIn(currentFrame(), item.id); board.append(zoneArtwork(item, p)); }
    const defs = svg('defs');
    for (const [kind, color] of [['player', '#355d79'], ['ball', '#94621d']]) { const marker = svg('marker', { id: 'tactics-arrow-' + kind, viewBox: '0 0 10 10', refX: 24, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto' }); marker.append(svg('path', { d: 'M0 0 L10 5 L0 10z', fill: color })); defs.append(marker); }
    board.append(defs);
    const transition = shownTransition();
    pathCaption.textContent = transition ? 'Movement: ' + transition.from.title + ' → ' + transition.to.title + ' · Dashed: player · Solid: ball' : 'Starting positions · Add a next phase, then drag players and balls to record their route.';
    if (pathToggle.checked && transition) {
      const { from, to } = transition;
      for (const item of record.content.items) {
        if (!['home', 'away', 'ball'].includes(item.kind)) continue;
        const points = routePoints(from, to, item.id), length = points.slice(1).reduce((sum, p, i) => sum + routeDistance(points[i], p), 0); if (length < .3) continue;
        const scale = Math.max(.01, board.getScreenCTM()?.a || 1);
        board.append(svg('path', { d: points.map((p, i) => (i ? 'L ' : 'M ') + p.x * 10 + ' ' + p.y * 6.5).join(' '), 'data-tactics-path': item.id, fill: 'none', stroke: item.kind === 'ball' ? '#94621d' : '#355d79', 'stroke-width': 2.5 / scale, 'stroke-dasharray': item.kind === 'ball' ? 'none' : (7 / scale) + ' ' + (5 / scale), 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'marker-end': length * 10 * scale > 35 ? 'url(#tactics-arrow-' + (item.kind === 'ball' ? 'ball' : 'player') + ')' : 'none', 'pointer-events': 'none' }));
      }
    }
    const positions = renderedPositions || currentFrame().positions;
    for (const item of record.content.items) {
      if (item.kind === 'zone') continue;
      const p = renderedPositions ? positions.find(point => point.id === item.id) : positionIn(currentFrame(), item.id); if (!p) continue;
      const piece = svg('g', { transform: 'translate(' + (p.x * 10) + ' ' + (p.y * 6.5) + ')', 'data-tactics-item': item.id, role: 'button', tabindex: editable() ? '0' : '-1', 'aria-label': kinds[item.kind] + (item.label ? ' ' + item.label : '') + ', position ' + Math.round(p.x) + ', ' + Math.round(p.y), 'aria-pressed': String(item.id === selectedItem), 'aria-disabled': String(!editable()) });
      const screenScale = Math.max(.01, board.getScreenCTM()?.a || 1), artScale = Math.max(1, .85 / screenScale);
      const art = svg('g', { class: 'tactics-piece-art', transform: 'scale(' + artScale + ')' });
      const hitRadius = Math.max(26, 22 / screenScale / artScale);
      piece.append(art); art.append(svg('circle', { r: hitRadius, fill: 'transparent', class: 'tactics-hit' }));
      if (item.id === selectedItem) art.append(svg('circle', { r: 28, fill: 'none', stroke: '#152d42', 'stroke-width': 3, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
      art.append(pieceArtwork(item.kind));
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
    if (target) { selectedItem = target.dataset.tacticsItem; stopPlayback(); const item = record.content.items.find(i => i.id === selectedItem); pointer = { id: event.pointerId, before: capture(), moved: false, points: frameIndex > 0 && ['home', 'away', 'ball'].includes(item.kind) ? [...routePoints(record.content.frames[frameIndex - 1], currentFrame(), selectedItem)].map(p => ({ x: p.x, y: p.y })) : null }; board.setPointerCapture(event.pointerId); event.preventDefault(); render(); }
    else if (selectedItem) { const destination = point(event); if (destination) mutate(() => placePiece(currentFrame(), selectedItem, destination)); }
  });
  board.addEventListener('pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId || !editable()) return;
    const destination = point(event), p = currentFrame().positions.find(p => p.id === selectedItem); if (!destination || !p || p.x === destination.x && p.y === destination.y) return;
    if (!pointer.moved) { undo.push(pointer.before); if (undo.length > 30) undo.shift(); redo = []; pointer.moved = true; }
    if (pointer.points) {
      const samples = event.getCoalescedEvents?.() || [];
      for (const sample of [...samples, event]) { const p = point(sample); if (p && routeDistance(pointer.points.at(-1), p) >= .25) pointer.points.push(p); }
      if (pointer.points.length > 256) pointer.points = boundedRoute(pointer.points, 128);
    }
    placePiece(currentFrame(), selectedItem, destination);
    if (pointer.points) { const points = [...pointer.points]; if (routeDistance(points.at(-1), destination) > 0) points.push(destination); saveDraggedRoute(points); }
    draw(); renderStatus(); notifyDraft();
  });
  const endPointer = event => { if (!pointer) return; if (pointer.moved && event.type === 'pointerup') { const destination = point(event); if (destination) { placePiece(currentFrame(), selectedItem, destination); if (pointer.points) saveDraggedRoute([...pointer.points, destination]); } } pointer = null; render(); notifyDraft(); };
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
  let boardSize = '';
  new ResizeObserver(() => { const bounds = board.getBoundingClientRect(), size = bounds.width + ':' + bounds.height; if (bounds.width && size !== boardSize) { boardSize = size; draw(); } }).observe(board);
  render();
  window.dispatchEvent(new CustomEvent('coach:request-context'));
})();
