/* Session preparation only. Saves diagrams through the authenticated Coach Desk bridge. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), mount = $('tactics-board-tools');
  if (!mount) return;
  mount.classList.add('tactics-studio');
  const ns = 'http://www.w3.org/2000/svg';
  const clone = value => JSON.parse(JSON.stringify(value));
  const possessionPoint = player => ({ x: Math.min(100, player.x + 2), y: Math.min(100, player.y + 2) });
  const minimumRecordedDrag = 3;
  const pieceLayer = item => ({ zone: 0, cone: 1, goal: 2, home: 3, away: 3, ball: 3 })[item.kind];
  let deviceView = 'auto';
  const encode = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
  const uid = prefix => prefix + crypto.randomUUID().replaceAll('-', '').slice(0, 20);
  const kinds = { home: 'Blue player', away: 'Gold player', cone: 'Cone', ball: 'Ball', goal: 'Goal', zone: 'Zone' };
  const playerColors = { blue: '#326887', gold: '#d9ae63', red: '#b64d49', green: '#397561', purple: '#79549d', white: '#f5f2e9' };
  const playerColor = item => item.color || (item.kind === 'away' ? 'gold' : 'blue');
  const playerInk = item => ['gold', 'white'].includes(playerColor(item)) ? '#203039' : '#fff';
  const pieceName = item => ['home', 'away'].includes(item.kind) ? playerColor(item)[0].toUpperCase() + playerColor(item).slice(1) + ' player' : kinds[item.kind];
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
  let libraryBinding = null, sessionDraft = null, libraryLocked = false, librarySaveBlocked = false;
  let currentLoad = null;
  let editMode = 'place', selectedIds = new Set(), zoom = 1, viewCenter = { x: 500, y: 325 };
  let currentPlayerColor = null, selectedArrow = '';
  let cameraMode = 'full', showGrid = false, showLanes = false, panelHidden = false, scene = null;
  const homeAnchor = document.createComment('session tactics editor'); mount.before(homeAnchor);
  const selection = () => [...new Set([selectedItem, ...selectedIds])].filter(id => record.content.items.some(i => i.id === id));
  function selectPiece(id, additive = false) { selectedArrow = ''; if (!additive) selectedIds.clear(); else if (selectedIds.has(id)) { selectedIds.delete(id); selectedItem = [...selectedIds].at(-1) || ''; return; } selectedItem = id; if (id) selectedIds.add(id); }
  const snapshot = () => encode({ title: record.title, content: record.content });
  baseline = snapshot();
  const dirty = () => !libraryBinding && !!identity && snapshot() !== baseline;
  const active = () => !!context?.profile && (libraryBinding ? context.tab === 'library' : !!context?.session && context.selected === context.session.id && context.tab === 'plan' && context.session.status !== 'Cancelled');
  const editable = () => active() && loaded && !pending && !context.busy && !running && !libraryLocked;
  const currentFrame = () => record.content.frames[frameIndex];
  const capture = () => ({ title: record.title, content: clone(record.content), frameIndex, selectedItem, selectedIds: selection(), selectedArrow });
  const apply = value => { record.title = value.title; record.content = clone(value.content); frameIndex = value.frameIndex; selectedItem = value.selectedItem; selectedIds = new Set(value.selectedIds || []); selectedArrow = value.selectedArrow || ''; };
  const remember = () => { undo.push(capture()); if (undo.length > 30) undo.shift(); redo = []; };
  const libraryDiagram = () => libraryBinding && (record.content.purpose === 'team-pattern' || record.content.items.length || record.content.frames.length > 1 || record.content.frames.some(f => f.notes || f.arrows?.length || f.title !== 'Starting positions') || record.content.pitch !== 'full') ? clone(record.content) : null;
  const notifyDraft = () => { if (pointer) return; if (libraryBinding) { libraryBinding.onChange?.(libraryDiagram()); renderStatus(); } window.dispatchEvent(new Event('coach:tactics-dirty')); };
  function tell(text, error = false) { message = text; messageError = error; renderStatus(); }
  function request(operation, payload) { return new Promise((resolve, reject) => window.dispatchEvent(new CustomEvent('coach:tactics-request', { detail: { operation, payload, resolve, reject } }))); }
  function stopPlayback(reset = true) { running = false; cancelAnimationFrame(animation); animation = 0; if (reset) { elapsed = 0; renderedPositions = null; } renderPlayback(); }
  function mutate(fn, text) { if (!editable()) return; stopPlayback(); remember(); fn(); if (text) tell(text); render(); notifyDraft(); }
  function clear(next = blank()) { stopPlayback(); record = clone(next); record.content = clone(next.content); editMode = record.content.frames.length > 1 ? 'record' : 'place'; frameIndex = 0; selectedItem = selectedArrow = ''; currentPlayerColor = null; selectedIds.clear(); undo = []; redo = []; titleEditing = labelEditing = frameEditing = notesEditing = false; lastAttempt = null; recoveryNeeded = false; baseline = snapshot(); render(); notifyDraft(); }
  function discard() { stopPlayback(); const saved = JSON.parse(baseline); record.title = saved.title; record.content = saved.content; frameIndex = 0; selectedItem = ''; selectedIds.clear(); undo = []; redo = []; titleEditing = labelEditing = frameEditing = notesEditing = false; render(); notifyDraft(); }
  function openLibrary(binding) {
    if (!binding?.host || pending) return false;
    stopPlayback(); closePhases(); closeColors();
    if (!libraryBinding) sessionDraft = { record: clone(record), baseline, frameIndex, selectedItem, selectedIds: selection(), undo: clone(undo), redo: clone(redo), loaded, loadAttempted, lastAttempt, recoveryNeeded, message, messageError, identity, editMode };
    libraryBinding = binding; libraryLocked = librarySaveBlocked = false; binding.host.append(mount);
    record = { ...blank(), title: binding.title || 'Drill diagram' }; if (binding.diagram) record.content = clone(binding.diagram);
    baseline = snapshot(); editMode = record.content.frames.length > 1 ? 'record' : 'place'; frameIndex = 0; selectPiece(''); currentPlayerColor = null; undo = []; redo = []; loaded = true; recoveryNeeded = false; lastAttempt = null;
    resetCamera(); setPanelHidden(false); tell('Diagram and phase notes save with this drill.'); render(); return true;
  }
  function closeLibrary() {
    if (!libraryBinding) return;
    stopPlayback(); closePhases(); closeColors(); pointer = null; libraryBinding = null; libraryLocked = librarySaveBlocked = false; homeAnchor.after(mount);
    if (sessionDraft) { ({ record, baseline, frameIndex, selectedItem, undo, redo, loaded, loadAttempted, lastAttempt, recoveryNeeded, message, messageError, editMode } = sessionDraft); selectedIds = new Set(sessionDraft.selectedIds); }
    sessionDraft = null; resetCamera(); setPanelHidden(false); render();
  }
  window.CoachTactics = Object.freeze({ isDirty: dirty, isBusy: () => pending, discard,
    prepareSession: async sessionId => { if (libraryBinding || !active() || context.session.id !== sessionId) return false; if (pending && currentLoad) await currentLoad; if (!active() || context.session.id !== sessionId) return false; if (!loaded) await load(); return active() && context.session.id === sessionId && loaded && !pending; },
    openLibrary, closeLibrary, libraryDiagram, setLibraryLocked: (value, saveBlocked = value) => { if (libraryBinding && (libraryLocked !== !!value || librarySaveBlocked !== !!saveBlocked)) { libraryLocked = !!value; librarySaveBlocked = !!saveBlocked; if (libraryLocked) stopPlayback(); render(); } },
    setLibraryTitle: value => { if (libraryBinding) { record.title = String(value || 'Drill diagram').slice(0, 80); renderStatus(); } },
    getDraft: () => !libraryBinding && active() && loaded && !pending && !running ? { sessionId: context.session.id, title: record.title, diagram: clone(record.content) } : null,
    preview: content => content?.frames?.[0] && Array.isArray(content.items) ? previewFrame(content.frames[0], content.items, content.pitch) : null,
    previewAt,
    useDraft });
  function useDraft(value) {
    if (libraryBinding || !editable() || recoveryNeeded || value.sessionId !== context.session.id || value.diagram?.schemaVersion !== 1 || !Array.isArray(value.diagram.items) || !value.diagram.frames?.length) return false;
    if (dirty() && !confirm('Replace the current unsaved diagram with this drill’s diagram?')) return false;
    clear(); record.title = String(value.title || 'Drill diagram').slice(0, 80); record.content = clone(value.diagram); editMode = record.content.frames.length > 1 ? 'record' : 'place'; $('tactics-disclosure').open = true;
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
  const pitch = select('tactics-pitch', [['full', 'Full field'], ['half', 'Half field'], ['facing-goal', 'Facing goal'], ['away-from-goal', 'Away from goal'], ['blank', 'Training field']]);
  pitch.addEventListener('change', () => mutate(() => { record.content.pitch = pitch.value; resetCamera(); }));
  heading.append(field('Setup name', title));
  const fieldView = field('Pitch markings', pitch); fieldView.className = 'tactics-field-view';
  const purpose = select('tactics-purpose', [['drill', 'Drill'], ['team-pattern', 'Team pattern']]);
  purpose.addEventListener('change', () => mutate(() => { if (purpose.value === 'team-pattern') record.content.purpose = purpose.value; else delete record.content.purpose; }, purpose.value === 'team-pattern' ? 'Team pattern: show positioning, team movements and decisions.' : 'Drill: build a practice activity for your session.'));
  const viewOptions = el('div', '', 'tactics-view-options'); viewOptions.append(fieldView);
  const topActions = el('div', '', 'tactics-toolbar tactics-main-toolbar');
  const addGroup = el('div', '', 'tactics-pieces'); addGroup.setAttribute('role', 'group'); addGroup.setAttribute('aria-label', 'Add a piece');
  function addPiece(kind, destination, color, preset = {}) {
    if (!kinds[kind] || !editable() || record.content.items.length >= 40) return;
    if (editMode === 'arrow') editMode = 'place';
    mutate(() => {
      const item = { id: uid('piece_'), kind, label: ['home', 'away'].includes(kind) ? String(record.content.items.filter(i => ['home', 'away'].includes(i.kind) && playerColor(i) === (color || (kind === 'away' ? 'gold' : 'blue'))).length + 1) : '' };
      if (['home', 'away'].includes(kind) && color) item.color = color;
      if (kind === 'zone') { item.label = preset.outline ? 'Box' : 'Zone'; item.zone = { shape: preset.shape || 'rect', width: 25, height: 25, color: 'blue', ...(preset.outline ? { outline: true } : {}) }; }
      record.content.items.push(item); const offset = record.content.items.length % 6;
      const centre = cameraPoint(viewCenter), { unitX, unitY } = pitchGeometry();
      for (const frame of record.content.frames) { frame.positions.push({ id: item.id, ...(destination || { x: clamp(centre.x / unitX + offset * 2 - 5), y: clamp(centre.y / unitY + offset * 2 - 5) }), ...(preset.facing ? {facing:0} : {}), ...(preset.shadow ? {shadow:{length:25,width:20}} : {}) }); if (kind === 'zone') constrainZone(frame, item); }
      selectPiece(item.id);
    }, (color ? color[0].toUpperCase() + color.slice(1) + ' player' : kinds[kind]) + ' added.');
  }
  const playerTools = el('div', '', 'tactics-player-tools'), colorMenu = el('div', '', 'tactics-player-colors'); colorMenu.id = 'tactics-player-colors'; colorMenu.hidden = true; colorMenu.setAttribute('role', 'group'); colorMenu.setAttribute('aria-label', 'Choose player colour');
  const currentColor = el('span', '', 'tactics-current-color'); currentColor.setAttribute('aria-hidden', 'true');
  function closeColors() { colorMenu.hidden = true; newPlayer.setAttribute('aria-expanded', 'false'); addPlayerButton.setAttribute('aria-expanded', 'false'); }
  function choosePlayerColor() { if (!editable()) return; colorMenu.hidden = !colorMenu.hidden; newPlayer.setAttribute('aria-expanded', String(!colorMenu.hidden)); addPlayerButton.setAttribute('aria-expanded', String(!colorMenu.hidden)); if (!colorMenu.hidden) colorMenu.querySelector('button').focus(); }
  function addPlayer(destination) { if (!currentPlayerColor) { choosePlayerColor(); return; } addPiece(currentPlayerColor === 'gold' ? 'away' : 'home', destination, currentPlayerColor); }
  const addPlayerButton = button('Player', 'tactics-add-player', () => addPlayer()); addPlayerButton.setAttribute('aria-label', 'Add player'); addPlayerButton.prepend(currentColor); addPlayerButton.draggable = true; addPlayerButton.title = 'Add another player in the current colour, or drag onto the field';
  addPlayerButton.addEventListener('dragstart', event => { if (!editable() || !currentPlayerColor) return event.preventDefault(); event.dataTransfer.setData('application/x-coach-piece', 'player'); event.dataTransfer.effectAllowed = 'copy'; });
  const newPlayer = button('▾', 'tactics-new-player', choosePlayerColor); newPlayer.setAttribute('aria-label', 'Add player in a new colour'); newPlayer.setAttribute('aria-expanded', 'false'); newPlayer.setAttribute('aria-controls', colorMenu.id); newPlayer.title = 'Choose another player colour';
  addPlayerButton.setAttribute('aria-controls', colorMenu.id); addPlayerButton.setAttribute('aria-expanded', 'false');
  for (const [color, fill] of Object.entries(playerColors)) { const swatch = button(color[0].toUpperCase() + color.slice(1), '', () => { currentPlayerColor = color; closeColors(); addPlayer(); addPlayerButton.focus(); }); swatch.dataset.playerColor = color; swatch.title = 'Add ' + color + ' player'; const dot = el('span', '', 'tactics-current-color'); dot.style.backgroundColor = fill; dot.setAttribute('aria-hidden', 'true'); swatch.prepend(dot); colorMenu.append(swatch); }
  playerTools.append(addPlayerButton, newPlayer, colorMenu); addGroup.append(playerTools);
  playerTools.addEventListener('keydown', event => { if (event.key === 'Escape' && !colorMenu.hidden) { event.preventDefault(); event.stopPropagation(); closeColors(); (newPlayer.hidden ? addPlayerButton : newPlayer).focus(); } });
  playerTools.addEventListener('focusout', event => { if (!playerTools.contains(event.relatedTarget)) closeColors(); });
  for (const kind of ['ball', 'cone', 'goal']) {
    const label = kinds[kind];
    const add = button('', 'tactics-add-' + kind, () => addPiece(kind)); add.setAttribute('aria-label', 'Add ' + label.toLowerCase());
    const icon = svg('svg', { viewBox: '-36 -32 72 64', width: 22, height: 22, 'aria-hidden': 'true' }); icon.append(pieceArtwork(kind)); add.prepend(icon);
    add.draggable = true; add.title = 'Add ' + label.toLowerCase() + ' · drag onto field';
    add.addEventListener('dragstart', event => { if (!editable() || add.disabled) return event.preventDefault(); event.dataTransfer.setData('application/x-coach-piece', kind); event.dataTransfer.effectAllowed = 'copy'; });
    add.dataset.pieceKind = kind; addGroup.append(add);
  }
  function addPlayerTool(tool, destination) {
    if (!editable()) return;
    if(editMode==='arrow')editMode='place';
    const target = destination && record.content.items.filter(i=>['home','away'].includes(i.kind)).map(i=>({id:i.id,distance:routeDistance(destination,positionIn(currentFrame(),i.id))})).filter(i=>i.distance<=5).sort((a,b)=>a.distance-b.distance)[0];
    if (target) { mutate(()=>{selectPiece(target.id);const p=currentFrame().positions.find(p=>p.id===target.id);if(!Number.isFinite(p.facing))p.facing=0;if(tool==='shadow')p.shadow={length:25,width:20};},'Player tool attached for this phase. It moves with the player.'); }
    else tell('Select an existing player, then use Body direction or Cover shadow in the player settings.');
  }
  topActions.append(addGroup, viewOptions);
  const arrange = el('details', '', 'tactics-arrange'); arrange.append(el('summary','Arrange'));
  const arrangeTools = el('div', '', 'tactics-arrange-tools');
  const choosePlayers = sameColour => { const item=record.content.items.find(i=>i.id===selectedItem); if(sameColour&&!['home','away'].includes(item?.kind))return tell('Select a player first.'); const ids=record.content.items.filter(i=>['home','away'].includes(i.kind)&&(!sameColour||playerColor(i)===playerColor(item))).map(i=>i.id); selectedArrow=''; selectedItem=ids[0]||''; selectedIds=new Set(ids);render(); };
  arrangeTools.append(button('All players','tactics-select-players',()=>choosePlayers(false)),button('Same colour','tactics-select-colour',()=>choosePlayers(true)),button('Clear selection','tactics-clear-selection',()=>{selectPiece('');render();}));
  function alignPlayers(axis) {
    const ids=selection().filter(id=>['home','away','cone'].includes(record.content.items.find(i=>i.id===id)?.kind));
    if(ids.length<2)return tell('Select at least two players or cones.');
    const positions=ids.map(id=>positionIn(currentFrame(),id)),value=positions.reduce((sum,p)=>sum+p[axis],0)/ids.length;
    mutate(()=>{for(const id of ids){const p=positionIn(currentFrame(),id),dx=axis==='x'?value-p.x:0,dy=axis==='y'?value-p.y:0;if(editMode==='place')shiftLayout([id],dx,dy,capture());else placePiece(currentFrame(),id,{x:p.x+dx,y:p.y+dy});}},'Selected pieces aligned. Undo restores their positions.');
  }
  arrangeTools.append(button('Align across','tactics-align-row',()=>alignPlayers('y')),button('Align down','tactics-align-column',()=>alignPlayers('x'))); arrange.append(arrangeTools);

  const editModes = el('div', '', 'tactics-edit-modes'); editModes.setAttribute('role', 'group'); editModes.setAttribute('aria-label', 'Editing mode');
  for (const [mode, text] of [['place', 'Layout'], ['record', 'Movement']]) { const control = button(text, 'tactics-mode-' + mode, () => { editMode = mode; render(); tell(mode === 'place' ? 'Move the layout: selected pieces shift in every phase, preserving their routes.' : frameIndex ? 'Drag a player or ball to record its route into this phase.' : 'Add a next phase to record movement.'); }); control.title = mode === 'place' ? 'Reposition pieces across every phase' : 'Record a route into this phase'; editModes.append(control); }
  const arrowTool = button('Arrow', 'tactics-draw-arrow', () => { if (!editable()) return; editMode = editMode === 'arrow' ? 'place' : 'arrow'; selectPiece(''); render(); tell(editMode === 'arrow' ? 'Draw any route on the field; it follows your curve and ends with an arrowhead. For a straight path, focus the field and press Enter. Drawings belong to this phase.' : 'Select and move pieces.'); }); arrowTool.setAttribute('aria-label', 'Draw curved arrow'); arrowTool.title = 'Draw an arrow directly on the field'; editModes.append(arrowTool);
  const shapes = el('details', '', 'tactics-shapes'); shapes.append(el('summary','Shape'));
  const shapeChoices = el('div', '', 'tactics-shape-choices');
  for (const [shape, label] of [['rect','▭ Rectangle'],['ellipse','◯ Oval'],['triangle','△ Triangle'],['diamond','◇ Diamond']]) shapeChoices.append(button(label,'tactics-shape-add-'+shape,()=>{addPiece('zone',undefined,undefined,{shape,outline:true});shapes.open=false;}));
  shapeChoices.append(button('▰ Filled area', 'tactics-add-zone', () => { addPiece('zone'); shapes.open = false; }));
  shapes.append(shapeChoices); addGroup.append(shapes);
  const selectionCount = el('p', '', 'tactics-selection-count'); selectionCount.id = 'tactics-selection-count';
  const multiSelect = input('tactics-multiselect', 'checkbox'), multiLabel = field('Select multiple', multiSelect); multiLabel.className = 'tactics-check';
  multiSelect.addEventListener('change', () => tell(multiSelect.checked ? 'Tap pieces to add them to the selection. Drag a selected piece to move the group.' : 'Click a piece to select it. Shift-click adds or removes pieces.'));
  arrangeTools.prepend(multiLabel);
  topActions.append(editModes, selectionCount);
  const boardLayout = el('div', '', 'tactics-board-layout');
  const canvasWrap = el('div', '', 'tactics-canvas-wrap');
  const board = svg('svg', { id: 'tactics-pitch-board', viewBox: '-60 -60 1120 770', role: 'group', 'aria-label': 'Tactics field. Shift-click to select a group. Drag pieces or route handles; use arrow keys to move.', tabindex: '0' });
  canvasWrap.append(board);
  const pathCaption = el('p', '', 'tactics-path-caption'); pathCaption.id = 'tactics-path-caption';
  const emptyHint = el('div', 'Add players, then build your first phase.', 'tactics-empty-hint'); emptyHint.id = 'tactics-empty-hint'; canvasWrap.append(emptyHint);
  const help = el('p', 'Place the starting pieces, add a next phase, then drag players and balls along their route. The full drag is recorded, including curves. Paths show movement into the selected phase; during playback they show the next movement. Dashed: player. Solid: ball. Equipment and zones have no paths. Drag an attached ball to release it. Arrows: move · Shift: farther · Ctrl/⌘ Z: undo · Delete: remove from all steps · Escape: deselect.', 'tactics-board-help');
  const side = el('div', '', 'tactics-piece-panel');
  const itemSelect = select('tactics-item', [['', 'Choose a piece']]);
  const selectionHint = el('p', 'Select a player or object on the field to edit it.', 'tactics-selection-hint');
  itemSelect.addEventListener('change', () => { if (!editable()) return; selectPiece(itemSelect.value); stopPlayback(); render(); });
  const labelInput = input('tactics-label'); labelInput.maxLength = 12;
  const pieceLabel = field('Shirt label', labelInput);
  const playerColorSelect = select('tactics-player-color', Object.keys(playerColors).map(color => [color, color[0].toUpperCase() + color.slice(1)]));
  const playerColorField = field('Player colour', playerColorSelect);
  playerColorSelect.addEventListener('change', () => mutate(() => { for (const item of record.content.items) if (selection().includes(item.id) && ['home', 'away'].includes(item.kind)) item.color = playerColorSelect.value; currentPlayerColor = playerColorSelect.value; }, 'Player colour updated in every phase.'));
  const removeArrow = button('Delete arrow', 'tactics-remove-arrow', () => mutate(() => { currentFrame().arrows = (currentFrame().arrows || []).filter(arrow => arrow.id !== selectedArrow); selectedArrow = ''; }, 'Arrow removed from this phase.'));
  let labelEditing = false;
  labelInput.addEventListener('input', () => { if (!editable()) return; const item = record.content.items.find(i => i.id === selectedItem); if (!item) return; if (!labelEditing) { remember(); labelEditing = true; } item.label = labelInput.value.trim(); draw(); editedText(); });
  labelInput.addEventListener('blur', () => { labelEditing = false; });
  const pathToggle = input('tactics-paths', 'checkbox'); pathToggle.checked = true; pathToggle.addEventListener('change', draw);
  const pathLabel = field('Show movement paths', pathToggle); pathLabel.className = 'tactics-check';
  const carrier = select('tactics-ball-carrier', [['', 'Free ball']]);
  carrier.addEventListener('change', () => mutate(() => { const p = currentFrame().positions.find(p => p.id === selectedItem); if (!p) return; if (carrier.value) attachBall(p.id, carrier.value, false); else detachBall(currentFrame(), p); }, carrier.value ? 'Ball attached for this step. It follows the player; drag it to release.' : 'Ball detached for this step.'));
  const carrierField = field('Ball carrier · this step', carrier);
  const straighten = button('Straighten path', 'tactics-straighten', () => mutate(() => { const transition = shownTransition(); if (!transition) return; delete transition.from.positions.find(p => p.id === selectedItem).curve; delete transition.to.positions.find(p => p.id === selectedItem).trail; }, 'Path straightened. Undo restores the recorded route.'));
  const redrawRoute = button('Redraw route', 'tactics-redraw-route', () => mutate(() => { const transition = shownTransition(); if (!transition || !selectedItem) return; const start = positionIn(transition.from, selectedItem); delete transition.from.positions.find(p => p.id === selectedItem).curve; delete transition.to.positions.find(p => p.id === selectedItem).trail; frameIndex = transition.index + 1; editMode = 'record'; placePiece(currentFrame(), selectedItem, { x: start.x, y: start.y }); }, 'Back at the start of this movement. Drag the piece along its new route.'));
  redrawRoute.title = 'Start this movement again from the previous phase';
  const routeActions = el('div', '', 'tactics-route-actions'); routeActions.append(redrawRoute, straighten);
  const zoneControls = el('div', '', 'tactics-zone-controls');
  const zoneShape = select('tactics-zone-shape', [['rect', 'Rectangle'], ['ellipse', 'Oval'], ['triangle', 'Triangle'], ['diamond', 'Diamond']]);
  const zoneColor = select('tactics-zone-color', [['blue', 'Blue'], ['gold', 'Gold'], ['green', 'Green']]);
  const zoneWidth = input('tactics-zone-width', 'range'), zoneHeight = input('tactics-zone-height', 'range');
  const zoneOutline = input('tactics-zone-outline','checkbox'), outlineLabel=field('Outline only',zoneOutline);outlineLabel.className='tactics-check';
  zoneOutline.addEventListener('change',()=>mutate(()=>{const item=record.content.items.find(i=>i.id===selectedItem);if(!item?.zone)return;if(zoneOutline.checked)item.zone.outline=true;else delete item.zone.outline;},'Zone appearance updated in every phase.'));
  for (const control of [zoneWidth, zoneHeight]) { control.min = '5'; control.max = '90'; control.step = '1'; }
  for (const [control, key] of [[zoneShape, 'shape'], [zoneColor, 'color'], [zoneWidth, 'width'], [zoneHeight, 'height']]) control.addEventListener('change', () => mutate(() => { const item = record.content.items.find(i => i.id === selectedItem); if (!item?.zone) return; item.zone[key] = ['width', 'height'].includes(key) ? Number(control.value) : control.value; for (const f of record.content.frames) constrainZone(f, item); }, 'Zone updated in every phase.'));
  zoneControls.append(field('Zone shape', zoneShape), field('Zone colour', zoneColor), outlineLabel, field('Zone width', zoneWidth), field('Zone height', zoneHeight), el('p', 'Drag to move. Use the corner handle to resize any shape. Shape and size apply to every phase.', 'small'));
  side.append(field('Selected piece', itemSelect), pieceLabel, button('Duplicate piece', 'tactics-duplicate-item', duplicatePiece), button('Remove from all steps', 'tactics-remove-item', () => mutate(() => { const ids = selection(); for (const f of record.content.frames) { for (const p of f.positions) if (ids.includes(p.attachedTo)) detachBall(f, p); f.positions = f.positions.filter(p => !ids.includes(p.id)); } record.content.items = record.content.items.filter(i => !ids.includes(i.id)); selectPiece(''); }, 'Piece removed from every step. Undo restores it.')));
  side.append(zoneControls, selectionHint);
  side.insertBefore(playerColorField, pieceLabel.nextSibling); side.prepend(removeArrow);
  const advanced = el('div', '', 'tactics-piece-settings'); advanced.append(carrierField, routeActions); side.append(advanced);
  const pieceActions = el('div', '', 'tactics-piece-actions'); for (const id of ['tactics-duplicate-item', 'tactics-remove-item']) pieceActions.append(side.querySelector('#' + id)); advanced.before(pieceActions);
  const rotation = input('tactics-rotation', 'number'); rotation.min = '0'; rotation.max = '360'; rotation.step = 'any';
  rotation.addEventListener('change', () => mutate(() => { const p = currentFrame().positions.find(p => p.id === selectedItem), value = Number(rotation.value); if (p && Number.isFinite(value) && value >= 0 && value < 360) p.rotation = value; }, 'Goal direction updated for this phase.'));
  const rotationField = field('Goal direction (degrees)', rotation); side.append(rotationField);
  const bodyTools = el('details', '', 'tactics-body-tools'); bodyTools.id = 'tactics-player-tools'; bodyTools.append(el('summary', 'Player overlays'));
  const bodyEnabled = input('tactics-body-direction', 'checkbox'), bodyLabel = field('Show body direction', bodyEnabled); bodyLabel.className = 'tactics-check';
  const playerPosition = () => currentFrame().positions.find(p => p.id === selectedItem);
  const setFacing = angle => mutate(() => { const p = playerPosition(); if (p) p.facing = ((angle % 360) + 360) % 360; }, 'Body direction updated for this phase. Movement stays unchanged.');
  bodyEnabled.addEventListener('change', () => mutate(() => { const p = playerPosition(); if (bodyEnabled.checked) p.facing = p.facing || 0; else delete p.facing; }));
  const shadowEnabled = input('tactics-cover-shadow', 'checkbox'), shadowLabel = field('Show cover shadow', shadowEnabled); shadowLabel.className = 'tactics-check';
  shadowEnabled.addEventListener('change', () => mutate(() => { const p = playerPosition(); if (shadowEnabled.checked) p.shadow = { length: 25, width: 20 }; else delete p.shadow; }));
  const visionEnabled = input('tactics-vision', 'checkbox'), visionLabel = field('Show field of view', visionEnabled); visionLabel.className = 'tactics-check';
  visionEnabled.addEventListener('change', () => mutate(() => { const p = playerPosition(); if (!p) return; if (visionEnabled.checked) { p.facing ??= 0; p.vision = { angle: 150, length: 20 }; } else delete p.vision; }));
  bodyTools.append(bodyLabel, visionLabel, shadowLabel, el('p', 'Turn the player with the round handle on the field. Drag the diamond handles to resize view distance or cover shadow. Field of view starts at 150°.', 'small')); pieceActions.before(bodyTools);
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
  const duration = input('tactics-duration', 'number'); duration.min = '.5'; duration.max = '20'; duration.step = 'any'; duration.inputMode = 'decimal';
  duration.addEventListener('change', () => { if (!editable()) return; const value = Number(duration.value); if (!Number.isFinite(value) || value < .5 || value > 20) { duration.value = String(currentFrame().duration); return tell('Choose a movement time between 0.5 and 20 seconds.', true); } if (value !== currentFrame().duration) { remember(); currentFrame().duration = value; scrub.max = String(totalSeconds()); $('tactics-sequence-summary').textContent = record.content.frames.length + ' / 12 steps · ' + totalSeconds() + 's · ' + record.content.items.length + ' / 40 pieces'; editedText(); } });
  const durationField = field('Seconds to next step', duration);
  frameSettings.append(field('Step name', frameTitle), durationField);
  const phaseActions = el('div', '', 'tactics-toolbar');
  phaseActions.append(button('+ Next phase', 'tactics-add-frame', () => mutate(() => { if (record.content.frames.length >= 12) return tell('Use up to 12 phases in one setup.', true); const next = clone(currentFrame()); next.id = uid('phase_'); next.title = 'Phase ' + (record.content.frames.length + 1); for (const p of next.positions) delete p.trail; record.content.frames.splice(frameIndex + 1, 0, next); frameIndex++; editMode = 'record'; }, 'Phase copied. Drag players and balls along the route you want to record.')), button('Remove phase', 'tactics-remove-frame', () => mutate(() => { if (record.content.frames.length <= 1) return; record.content.frames.splice(frameIndex, 1); frameIndex = Math.min(frameIndex, record.content.frames.length - 1); }, 'Phase removed.')));
  const playback = el('div', '', 'tactics-playback');
  playback.append(button('Play movement', 'tactics-play', togglePlayback, true), button('Back to start', 'tactics-reset', () => { if (!active() || pending) return; stopPlayback(); frameIndex = 0; render(); }), el('span', '', 'small'));
  playback.lastChild.id = 'tactics-playback-status'; playback.lastChild.setAttribute('aria-live', 'off');
  phaseActions.append(button('Move step earlier', 'tactics-step-earlier', () => reorderStep(-1)), button('Move step later', 'tactics-step-later', () => reorderStep(1)));
  const phaseOptions = el('details', '', 'tactics-phase-options'); phaseOptions.id = 'tactics-phase-options'; phaseOptions.append(el('summary', 'Phase options'), durationField, ...[...phaseActions.children].slice(1)); phaseActions.append(phaseOptions);
  const speed = select('tactics-speed', [['0.5', '0.5×'], ['1', '1×'], ['2', '2×']]); speed.value = '1';
  speed.addEventListener('change', () => { if (running) pause(); playbackSpeed = Number(speed.value); renderPlayback(); });
  const loop = input('tactics-loop', 'checkbox'); loop.addEventListener('change', () => { loopPlayback = loop.checked; });
  const scrub = input('tactics-progress', 'range'); scrub.min = '0'; scrub.step = '.1'; scrub.value = '0';
  scrub.addEventListener('input', () => seek(Number(scrub.value)));
  const previewControls = el('div', '', 'tactics-preview-controls');
  previewControls.append(field('Playback speed', speed), field('Loop', loop), field('Animation position (seconds)', scrub));
  const playbackOptions = el('details', '', 'tactics-playback-options'); playbackOptions.id = 'tactics-playback-options'; playbackOptions.append(el('summary', 'Playback options'), ...[...previewControls.children].slice(0, 2));
  previewControls.append(playbackOptions);
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
  const saveLibrary = button('Save to library', 'tactics-save-library', () => {
    if (!editable() || libraryBinding || recoveryNeeded) return;
    const detail = { sessionId: context.selected, drill: { title: record.title.trim() || 'Session drill', minutes: 10, target: 'technical', setup: record.content.frames.map(f => f.title + (f.notes ? ': ' + f.notes : '')).join('\n').slice(0, 2000), diagram: clone(record.content) } };
    window.dispatchEvent(new CustomEvent('coach:library-prefill', { detail }));
    if (detail.accepted) { requestAnimationFrame(() => { $('library-form')?.scrollIntoView({ block: 'center' }); $('library-title')?.focus(); }); tell('Library copy ready. Review the details and save the drill.'); }
    else tell('Finish or clear the current library draft, then try again.', true);
  });
  workbar.append(heading.firstChild, saveControl, saveLibrary, status);
  const editHistory = el('div', '', 'tactics-edit-history'); editHistory.setAttribute('role', 'group'); editHistory.setAttribute('aria-label', 'Edit history'); editHistory.append(undoControl, redoControl);
  for (const [control, icon, name] of [[undoControl, '↶', 'Undo'], [redoControl, '↷', 'Redo']]) { control.textContent = icon; control.setAttribute('aria-label', name); control.title = name; }
  const editTools = el('div', '', 'tactics-edit-tools'); editModes.replaceWith(editTools); editTools.append(editModes, editHistory);
  const modeHint = el('p', '', 'tactics-mode-hint'); modeHint.id = 'tactics-mode-hint';
  const sequenceActions = el('div', '', 'tactics-sequence-actions'); sequenceActions.setAttribute('role', 'group'); sequenceActions.setAttribute('aria-label', 'Playback and phases');
  const phasePicker = el('div', '', 'tactics-phase-picker');
  phases.id = 'tactics-phase-popover'; phases.hidden = true;
  function closePhases(returnFocus = false) { phases.hidden = true; phaseToggle.setAttribute('aria-expanded', 'false'); if (returnFocus) phaseToggle.focus(); }
  function placePhaseMenu() {
    const anchor = phaseToggle.getBoundingClientRect(), width = Math.min(560, innerWidth - 24);
    const below = innerHeight - anchor.bottom - 12, above = anchor.top - 12, useAbove = below < 180 && above > below;
    phases.style.position = 'fixed'; phases.style.right = 'auto'; phases.style.width = width + 'px';
    phases.style.maxHeight = Math.max(100, Math.min(440, useAbove ? above : below)) + 'px';
    phases.style.left = Math.max(12, Math.min(innerWidth - width - 12, anchor.right - width)) + 'px';
    phases.style.top = Math.max(8, useAbove ? anchor.top - phases.offsetHeight - 6 : anchor.bottom + 6) + 'px';
  }
  const phaseToggle = button('Phase 1 ▾', 'tactics-phases-toggle', () => { phases.hidden = !phases.hidden; phaseToggle.setAttribute('aria-expanded', String(!phases.hidden)); if (!phases.hidden) placePhaseMenu(); });
  phaseToggle.setAttribute('aria-controls', phases.id); phaseToggle.setAttribute('aria-expanded', 'false');
  phasePicker.append(phaseToggle, phases);
  phasePicker.addEventListener('keydown', event => { if (event.key === 'Escape' && !phases.hidden) { event.preventDefault(); event.stopPropagation(); closePhases(true); } });
  phasePicker.addEventListener('focusout', event => { if (!phasePicker.contains(event.relatedTarget)) closePhases(); });
  document.addEventListener('pointerdown', event => { if (!phases.hidden && !phasePicker.contains(event.target)) closePhases(); });
  window.addEventListener('resize', () => closePhases());
  sequenceActions.append(phasePicker, playControl, phaseActions.querySelector('#tactics-add-frame')); topActions.append(sequenceActions);
  const extras = el('details', '', 'tactics-compact-details'); extras.append(el('summary', 'Setup options'), heading, editingActions, saveActions,
    button('Save draft as new setup', 'tactics-save-copy', () => { if (!editable() || recoveryNeeded) return; const draft = clone(record), draftMode = editMode; clear(); record.title = (draft.title.slice(0, 73) + ' (copy)').slice(0, 80); record.content = draft.content; editMode = draftMode; render(); tell('New unsaved copy. Save setup to keep it.'); notifyDraft(); }), intro);
  // Preserve existing controls and IDs while bringing the board and main actions forward.
  extras.append(help);
  const fieldColumn = el('div', '', 'tactics-field-column'), inspector = el('aside', '', 'tactics-inspector'), phaseEditor = el('section', '', 'tactics-phase-editor');
  phaseEditor.append(el('h3', 'Phase notes'), frameSettings, phaseNotes.parentElement, phaseActions);
  inspector.id = 'tactics-inspector';
  const paletteHeading = el('h3', 'Add to field', 'tactics-palette-heading');
  topActions.replaceChildren(paletteHeading, addGroup, selectionCount);
  side.append(arrange);
  editTools.append(modeHint);
  fieldColumn.append(editTools, canvasWrap, sequenceActions);
  inspector.append(side);
  const written = el('section', '', 'tactics-written'); written.append(field('Activity type', purpose), extras);
  boardLayout.replaceChildren(fieldColumn, topActions, inspector, written);
  const mobileLinks = el('div', '', 'tactics-mobile-links');
  function focusInspector(control) { setPanelHidden(false); control.scrollIntoView({ block: 'center', behavior: 'instant' }); control.focus({ preventScroll: true }); }
  mobileLinks.append(button('Selected piece', 'tactics-jump-piece', () => focusInspector(itemSelect)), button('Phase notes', 'tactics-jump-notes', () => { notesMenu.open = true; placeNotesMenu(); phaseNotes.focus({ preventScroll: true }); }));
  sequenceActions.append(mobileLinks);
  const backField = button('Back to field ↑', 'tactics-back-field', () => { editTools.scrollIntoView({ block: 'start', behavior: 'instant' }); board.focus({ preventScroll: true }); }); backField.className = 'secondary tactics-back-field'; inspector.prepend(backField);
  const camera = select('tactics-camera', [['full','Full field'],['left-half','Left half · side'],['right-half','Right half · side'],['facing-goal','Half · facing goal'],['away-from-goal','Half · away from goal']]);
  camera.setAttribute('aria-label', 'Camera view'); camera.title = 'Change your view without moving players or changing the drill';
  camera.addEventListener('change', () => { cameraMode = record.content.pitch === 'full' ? camera.value : 'full'; zoom = 1; const g = cameraGeometry(); viewCenter = { x: g.x + g.width / 2, y: g.y + g.height / 2 }; draw(); });
  const focusField = button('Focus field', 'tactics-focus-field', () => setPanelHidden(!panelHidden));
  focusField.setAttribute('aria-controls', inspector.id); focusField.setAttribute('aria-expanded','true');
  function setPanelHidden(hidden) { panelHidden = hidden; inspector.hidden = topActions.hidden = hidden; document.body.classList.toggle('tactics-field-focus', hidden); focusField.textContent = hidden ? 'Show tools' : 'Focus field'; focusField.setAttribute('aria-expanded', String(!hidden)); requestAnimationFrame(() => { if (active()) draw(); }); }
  const gridControl = button('Thirds', 'tactics-grid', () => { showGrid = !showGrid; draw(); });
  gridControl.title = 'Show a thirds guide for spacing and positioning'; gridControl.setAttribute('aria-pressed','false');
  const laneControl = button('Lanes', 'tactics-lanes', () => { showLanes = !showLanes; draw(); });
  laneControl.title = 'Show wide areas, half-spaces and middle'; laneControl.setAttribute('aria-label', laneControl.title);
  const cameraTools = el('div', '', 'tactics-camera-tools');
  const viewMenu = el('details', '', 'tactics-view-menu'); viewMenu.id = 'tactics-view-menu';
  const cameraField = field('Focus area · does not change the drill', camera), viewMenuBody = el('div', '', 'tactics-view-menu-body');
  const guides = el('div', '', 'tactics-view-guides'); guides.append(gridControl, laneControl);
  const viewSummary = el('summary', 'View'); viewSummary.setAttribute('aria-label', 'View settings'); viewSummary.title = 'Focus area, guides and movement paths';
  viewMenuBody.append(cameraField, guides, pathLabel); viewMenu.append(viewSummary, viewMenuBody);
  viewMenu.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); viewMenu.open = false; viewMenu.querySelector('summary').focus(); } });
  const notesMenu = el('details', '', 'tactics-notes-menu'); notesMenu.id = 'tactics-notes-menu';
  const notesSummary = el('summary', 'Phase notes');
  notesMenu.append(notesSummary, phaseEditor);
  function placeNotesMenu() {
    if (!notesMenu.open) return;
    const anchor = notesSummary.getBoundingClientRect(), width = Math.min(360, innerWidth - 24);
    const desired = Math.min(400, phaseEditor.scrollHeight || 360), below = innerHeight - anchor.bottom - 20, above = anchor.top - 20;
    const opensAbove = below < Math.min(desired, 240) && above > below;
    const available = Math.max(120, Math.min(innerHeight - 24, opensAbove ? above : below));
    const top = Math.max(12, opensAbove ? anchor.top - 8 - Math.min(desired, available) : anchor.bottom + 8);
    phaseEditor.style.left = Math.max(12, Math.min(anchor.left, innerWidth - width - 12)) + 'px';
    phaseEditor.style.top = top + 'px'; phaseEditor.style.width = width + 'px';
    phaseEditor.style.maxHeight = Math.min(available, innerHeight - top - 12) + 'px';
  }
  notesMenu.addEventListener('toggle', placeNotesMenu);
  notesMenu.addEventListener('keydown', event => { if (event.key === 'Escape' && notesMenu.open) { event.preventDefault(); event.stopPropagation(); notesMenu.open = false; notesSummary.focus(); } });
  notesMenu.addEventListener('focusout', event => { if (event.relatedTarget && !notesMenu.contains(event.relatedTarget)) notesMenu.open = false; });
  document.addEventListener('pointerdown', event => { if (notesMenu.open && !notesMenu.contains(event.target)) notesMenu.open = false; });
  document.addEventListener('scroll', placeNotesMenu, true);
  window.addEventListener('resize', placeNotesMenu);
  cameraTools.append(viewMenu, notesMenu, focusField);
  const deviceControl = select('tactics-device-view', [['auto', 'Fit my device'], ['wide', 'Wide field'], ['tall', 'Upright field']]);
  deviceControl.setAttribute('aria-label', 'Preferred field orientation');
  deviceControl.addEventListener('change', () => { deviceView = deviceControl.value; zoom = 1; draw(); }); cameraTools.prepend(field('Orientation', deviceControl));
  const viewControls = el('div', '', 'tactics-view-controls'); viewControls.setAttribute('aria-label', 'Field view');
  const panControls = el('div', '', 'tactics-pan-controls'); panControls.setAttribute('role', 'group'); panControls.setAttribute('aria-label', 'Move zoomed view');
  const zoomValue = el('output', '100%', 'tactics-zoom-value'); zoomValue.id = 'tactics-zoom-value'; zoomValue.setAttribute('aria-label', 'Field zoom');
  // Saved coordinates stay normalized; only their display units depend on the pitch.
  function pitchGeometry(view = record.content.pitch) {
    const [width, height] = view === 'half' ? [500, 650] : ['facing-goal', 'away-from-goal'].includes(view) ? [650, 500] : [1000, 650];
    return { width, height, unitX: width / 100, unitY: height / 100, landscape: width >= height };
  }
  function cameraGeometry() {
    const pitch = pitchGeometry(), crop = record.content.pitch === 'full' && cameraMode !== 'full';
    const x = crop && cameraMode !== 'left-half' ? pitch.width / 2 : 0, width = crop ? pitch.width / 2 : pitch.width;
    const tall = deviceView === 'tall' || deviceView === 'auto' && innerWidth < 600 && innerHeight > innerWidth;
    let angle = !crop && (tall && pitch.landscape || deviceView === 'wide' && !pitch.landscape) ? 90 : 0;
    if (crop && ['facing-goal','away-from-goal'].includes(cameraMode)) angle = cameraMode === 'facing-goal' ? -90 : 90;
    const cx = pitch.width / 2, cy = pitch.height / 2, rad = angle * Math.PI / 180;
    const rotate = (px, py) => ({ x: cx + (px-cx)*Math.cos(rad) - (py-cy)*Math.sin(rad), y: cy + (px-cx)*Math.sin(rad) + (py-cy)*Math.cos(rad) });
    const corners = [rotate(x,0),rotate(x+width,0),rotate(x,pitch.height),rotate(x+width,pitch.height)];
    const xs = corners.map(p=>p.x), ys = corners.map(p=>p.y);
    return { x: Math.min(...xs)-22, y: Math.min(...ys)-22, width: Math.max(...xs)-Math.min(...xs)+44, height: Math.max(...ys)-Math.min(...ys)+44, angle };
  }
  function cameraPoint(p, inverse = true) { const { width, height } = pitchGeometry(), cx = width / 2, cy = height / 2, rad = (inverse ? -1 : 1) * cameraGeometry().angle * Math.PI / 180; return { x: cx+(p.x-cx)*Math.cos(rad)-(p.y-cy)*Math.sin(rad), y: cy+(p.x-cx)*Math.sin(rad)+(p.y-cy)*Math.cos(rad) }; }
  function resetCamera() { cameraMode = 'full'; zoom = 1; const { width, height } = pitchGeometry(); viewCenter = { x: width / 2, y: height / 2 }; }
  function cameraDelta([x,y]) { const { unitX, unitY } = pitchGeometry(), angle = -cameraGeometry().angle * Math.PI / 180; return [(x*unitX*Math.cos(angle)-y*unitY*Math.sin(angle))/unitX, (x*unitX*Math.sin(angle)+y*unitY*Math.cos(angle))/unitY]; }
  const viewBounds = () => { const g = cameraGeometry(); return { left: g.x + g.width / 2 / zoom, right: g.x + g.width - g.width / 2 / zoom, top: g.y + g.height / 2 / zoom, bottom: g.y + g.height - g.height / 2 / zoom }; };
  function updateViewControls() {
    const locked = !active() || !loaded || pending, bounds = viewBounds(), fit = zoom === 1, near = (a, b) => Math.abs(a - b) < .001;
    camera.hidden = cameraField.hidden = record.content.pitch !== 'full'; camera.value = cameraMode; camera.disabled = locked || camera.hidden; deviceControl.disabled = locked; deviceControl.value = deviceView; gridControl.disabled = focusField.disabled = locked; gridControl.setAttribute('aria-pressed',String(showGrid));
    laneControl.hidden = record.content.pitch === 'blank'; laneControl.disabled = locked || laneControl.hidden; laneControl.setAttribute('aria-pressed', String(showLanes && !laneControl.hidden));
    $('tactics-zoom-out').disabled = locked || fit; $('tactics-zoom-in').disabled = locked || zoom === 2.5;
    $('tactics-zoom-fit').hidden = fit; $('tactics-zoom-fit').disabled = locked || fit;
    const percentage = Math.round(zoom * 100) + '%'; if (zoomValue.textContent !== percentage) zoomValue.textContent = percentage; panControls.hidden = fit;
    for (const [direction, edge] of [['left', near(viewCenter.x, bounds.left)], ['right', near(viewCenter.x, bounds.right)], ['up', near(viewCenter.y, bounds.top)], ['down', near(viewCenter.y, bounds.bottom)]]) $('tactics-pan-' + direction).disabled = locked || fit || edge;
  }
  function setView(factor = zoom, dx = 0, dy = 0) {
    if (!active() || !loaded || pending) return;
    zoom = Math.max(1, Math.min(2.5, factor)); const bounds = viewBounds();
    viewCenter = { x: Math.max(bounds.left, Math.min(bounds.right, viewCenter.x + dx)), y: Math.max(bounds.top, Math.min(bounds.bottom, viewCenter.y + dy)) }; draw();
  }
  const zoomOut = button('−', 'tactics-zoom-out', () => setView(zoom - .25)), zoomIn = button('+', 'tactics-zoom-in', () => setView(zoom + .25)), fitField = button('Fit field', 'tactics-zoom-fit', () => { setView(1); zoomIn.focus(); });
  zoomOut.setAttribute('aria-label', 'Zoom out'); zoomOut.title = 'Zoom out'; zoomIn.setAttribute('aria-label', 'Zoom in'); zoomIn.title = 'Zoom in'; fitField.title = 'Show the entire field';
  viewControls.append(zoomOut, zoomValue, zoomIn, fitField); panControls.append(el('span', 'Move view', 'small'));
  for (const [name, text, dx, dy] of [['left', '←', -100, 0], ['up', '↑', 0, -80], ['down', '↓', 0, 80], ['right', '→', 100, 0]]) { const b = button(text, 'tactics-pan-' + name, () => setView(zoom, dx, dy)); b.setAttribute('aria-label', 'Pan field ' + name); b.title = 'Move view ' + name; panControls.append(b); }
  viewControls.append(panControls);
  const fieldDock = el('div', '', 'tactics-field-dock'); fieldDock.append(cameraTools, viewControls); fieldColumn.append(fieldDock);
  function placeFieldDock() {
    if (fieldDock.parentElement !== editor || fieldDock.nextElementSibling !== boardLayout) editor.insertBefore(fieldDock, boardLayout);
    if (viewOptions.parentElement !== fieldDock) fieldDock.prepend(viewOptions);
    if (topActions.parentElement !== boardLayout) fieldColumn.after(topActions);
    if (focusField.parentElement !== cameraTools) cameraTools.append(focusField);
    fieldColumn.dataset.dock = 'top';
  }
  new ResizeObserver(() => { if (active() && loaded) draw(); }).observe(fieldColumn);
  // Keep the phase description available to assistive tools without another controls panel.
  pathCaption.hidden = true; canvasWrap.append(pathCaption); board.setAttribute('aria-describedby', pathCaption.id);
  editor.append(boardLayout, recoveryActions);
  mount.append(workbar, editor, library, reuse);
  function editedText() { $('tactics-undo').disabled = !undo.length; $('tactics-redo').disabled = !redo.length; $('tactics-save').disabled = recoveryNeeded || !record.title.trim() || (!dirty() && !!record.id); renderStatus(); notifyDraft(); }
  function duplicatePiece() {
    const ids = selection(); if (!ids.length || record.content.items.length + ids.length > 40) return;
    mutate(() => {
      const copies = new Map(ids.map(id => [id, uid('piece_')]));
      for (const id of ids) { const original = record.content.items.find(i => i.id === id), copy = { ...clone(original), id: copies.get(id) }; record.content.items.push(copy);
        for (const f of record.content.frames) { const p = f.positions.find(v => v.id === id), at = positionIn(f, id), next = { ...clone(p), id: copy.id, x: clamp(at.x + 5), y: clamp(at.y + 5) }; if (copies.has(p.attachedTo)) next.attachedTo = copies.get(p.attachedTo); else delete next.attachedTo; if (next.trail) next.trail = next.trail.map(p => ({ x: clamp(p.x + 5), y: clamp(p.y + 5) })); f.positions.push(next); if (copy.zone) constrainZone(f, copy); }
      }
      selectedIds = new Set(copies.values()); selectedItem = [...selectedIds].at(-1);
    }, 'Selection copied into every phase. Possession within the copied group is preserved.');
  }
  function reorderStep(direction) {
    const next = frameIndex + direction; if (next < 0 || next >= record.content.frames.length) return;
    mutate(() => { const [frame] = record.content.frames.splice(frameIndex, 1); record.content.frames.splice(next, 0, frame); frameIndex = next; }, 'Step moved. Review the movement before saving.');
  }
  function totalSeconds() { return record.content.frames.slice(0, -1).reduce((sum, f) => sum + f.duration, 0); }
  function positionIn(frame, id) {
    const p = frame.positions.find(p => p.id === id), player = p?.attachedTo && frame.positions.find(v => v.id === p.attachedTo);
    return player ? { id, ...possessionPoint(player) } : { id, x: p.x, y: p.y };
  }
  function detachBall(frame, p) { if (!p?.attachedTo) return; Object.assign(p, positionIn(frame, p.id)); delete p.attachedTo; }
  function attachBall(id, playerId, recording) {
    const p = currentFrame().positions.find(p => p.id === id), destination = possessionPoint(positionIn(currentFrame(), playerId));
    if (!recording) { const at = positionIn(currentFrame(), id); shiftLayout([id], destination.x - at.x, destination.y - at.y, capture()); }
    p.attachedTo = playerId; Object.assign(p, destination);
  }
  function constrainZone(frame, item) {
    const p = frame.positions.find(p => p.id === item.id); if (!p || !item.zone) return;
    p.x = Math.max(item.zone.width / 2, Math.min(100 - item.zone.width / 2, p.x)); p.y = Math.max(item.zone.height / 2, Math.min(100 - item.zone.height / 2, p.y));
  }
  function resizeShape(id, width, height) {
    const item=record.content.items.find(i=>i.id===id);if(!item?.zone)return;
    item.zone.width=Math.max(5,Math.min(90,Math.round(width)));item.zone.height=Math.max(5,Math.min(90,Math.round(height)));
    for(const frame of record.content.frames)constrainZone(frame,item);
  }
  function resizeGoal(id, size) {
    const item = record.content.items.find(i => i.id === id); if (item?.kind !== 'goal') return;
    item.scale = Math.max(.5, Math.min(4, Math.round(size * 100) / 100));
  }
  function goalCorner(item, position) {
    const screenScale = Math.max(.01, Math.hypot(board.getScreenCTM()?.a || 0, board.getScreenCTM()?.b || 0) || 1);
    const size = Math.max(.62, .48 / screenScale) * (item.scale || 1), angle = (position.rotation || 0) * Math.PI / 180;
    return { x: (33 * Math.cos(angle) - 24 * Math.sin(angle)) * size, y: (33 * Math.sin(angle) + 24 * Math.cos(angle)) * size };
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
  const routeDistance = (a, b, view = record.content.pitch) => { const { unitX, unitY } = pitchGeometry(view); return Math.hypot((a.x - b.x) * unitX, (a.y - b.y) * unitY) / 10; };
  // Reduce hand jitter while retaining the actual route, bounded for saved diagrams.
  function simplifyRoute(points, tolerance = .35) {
    if (points.length <= 2) return points;
    const { unitX, unitY } = pitchGeometry(), a = points[0], b = points.at(-1), dx = (b.x - a.x) * unitX, dy = (b.y - a.y) * unitY, length = dx * dx + dy * dy;
    let max = tolerance, split = 0;
    for (let i = 1; i < points.length - 1; i++) { const p = points[i], t = length ? Math.max(0, Math.min(1, ((p.x - a.x) * unitX * dx + (p.y - a.y) * unitY * dy) / length)) : 0, distance = routeDistance(p, { x: a.x + dx / unitX * t, y: a.y + dy / unitY * t }); if (distance > max) { max = distance; split = i; } }
    return split ? [...simplifyRoute(points.slice(0, split + 1), tolerance).slice(0, -1), ...simplifyRoute(points.slice(split), tolerance)] : [a, b];
  }
  function boundedRoute(points, limit = 34) { let reduced = simplifyRoute(points), tolerance = .35; while (reduced.length > limit) { tolerance *= 1.5; reduced = simplifyRoute(points, tolerance); } return reduced; }
  function saveDraggedRoute(points, id = selectedItem) {
    const reduced = boundedRoute(points);
    const p = currentFrame().positions.find(p => p.id === id); if (!p) return;
    if (reduced.length > 2) p.trail = reduced.slice(1, -1).map(p => ({ x: p.x, y: p.y })); else delete p.trail;
    if (frameIndex) delete record.content.frames[frameIndex - 1].positions.find(p => p.id === id).curve;
  }
  // Paths and playback use one route, including captured drags and legacy bends.
  function curveControl(start, end, bend = 0, view = record.content.pitch) {
    const { width, height, unitX, unitY } = pitchGeometry(view), dx = (end.x - start.x) * unitX, dy = (end.y - start.y) * unitY, length = Math.hypot(dx, dy) || 1;
    return { x: Math.max(0, Math.min(width, (start.x + end.x) * unitX / 2 - dy / length * bend * 4)), y: Math.max(0, Math.min(height, (start.y + end.y) * unitY / 2 + dx / length * bend * 4)) };
  }
  function routePoints(from, to, id, view = record.content.pitch) {
    const p = from.positions.find(p => p.id === id), q = to.positions.find(p => p.id === id);
    if (p.attachedTo && p.attachedTo === q.attachedTo) return routePoints(from, to, p.attachedTo, view).map(possessionPoint);
    const start = positionIn(from, id), end = positionIn(to, id);
    if (q.trail?.length) {
      // Smooth corners without overshoot; paths and playback use the same route.
      const points = [start, ...q.trail, end], smooth = [start];
      for (let i = 0; i < points.length - 1; i++) { const a = points[i], b = points[i + 1]; for (const t of [.25, .75]) smooth.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }); }
      return [...smooth, end];
    }
    if (!p.curve) return [start, end];
    const c = curveControl(start, end, p.curve, view), { unitX, unitY } = pitchGeometry(view);
    return Array.from({ length: 25 }, (_, i) => { const t = i / 24, u = 1 - t; return { x: u * u * start.x + 2 * u * t * c.x / unitX + t * t * end.x, y: u * u * start.y + 2 * u * t * c.y / unitY + t * t * end.y }; });
  }
  function motionPosition(from, to, id, t, view = record.content.pitch) {
    const p = from.positions.find(p => p.id === id), q = to.positions.find(p => p.id === id);
    if (p.attachedTo && p.attachedTo === q.attachedTo) return { id, ...possessionPoint(motionPosition(from, to, p.attachedTo, t, view)) };
    const points = routePoints(from, to, id, view), lengths = points.slice(1).map((p, i) => routeDistance(points[i], p, view));
    let remaining = lengths.reduce((sum, v) => sum + v, 0) * t;
    for (let i = 0; i < lengths.length; i++) { if (remaining <= lengths[i] || i === lengths.length - 1) { const fraction = lengths[i] ? remaining / lengths[i] : 1, a = points[i], b = points[i + 1]; return { id, x: a.x + (b.x - a.x) * fraction, y: a.y + (b.y - a.y) * fraction }; } remaining -= lengths[i]; }
  }
  function motionPositions(from, to, t, view = record.content.pitch) {
    return from.positions.map(p => { const q = to.positions.find(v => v.id === p.id), result = { ...(t >= 1 ? q : p), ...motionPosition(from, to, p.id, t, view) }; delete result.attachedTo;
      if (Number.isFinite(p.facing) && Number.isFinite(q.facing)) result.facing = (p.facing + ((q.facing - p.facing + 540) % 360 - 180) * t + 360) % 360;
      return result;
    });
  }
  function directionTo(from, to, view = record.content.pitch) { const { unitX, unitY } = pitchGeometry(view); return (Math.atan2((to.x - from.x) * unitX, -(to.y - from.y) * unitY) * 180 / Math.PI + 360) % 360; }
  function nearestBall(p, frame, items, view = record.content.pitch) {
    if (!p) return null;
    return items.filter(i => i.kind === 'ball').map(i => positionIn(frame, i.id)).filter(ball => routeDistance(p, ball, view) > .1).sort((a, b) => routeDistance(p, a, view) - routeDistance(p, b, view))[0] || null;
  }
  function playerArtwork(kind, position, color) {
    if (!['home', 'away'].includes(kind) || !Number.isFinite(position?.facing)) return pieceArtwork(kind, color);
    const art = svg('g', { 'data-symbol': kind, 'data-facing': position.facing, transform: 'rotate(' + position.facing + ')', 'aria-hidden': 'true' });
    // A top-down head and shoulder line show body angle; the chevron marks the front.
    art.append(svg('path', { d: 'M-8-11 Q-17-11-23-3 L-21 8 L-13 6 L-12 19 Q0 24 12 19 L13 6 L21 8 L23-3 Q17-11 8-11Z', fill: playerColors[color || (kind === 'away' ? 'gold' : 'blue')], stroke: '#fffdf7', 'stroke-width': 2.5, 'stroke-linejoin':'round' }), svg('circle', { cy: -12, r: 8, fill: '#f1e4cf', stroke: '#293b31', 'stroke-width': 2 }), svg('path', { d:'M-3-19 L0-24 L3-19Z', fill:'#293b31', 'data-player-front':'' }), svg('path', { d: 'M-9-30 L0-37 L9-30', fill:'none', stroke:'#fffdf7', 'stroke-width':5, 'stroke-linecap':'round', 'stroke-linejoin':'round', 'pointer-events':'none' }), svg('path', { d: 'M-9-30 L0-37 L9-30', fill:'none', stroke:'#20382d', 'stroke-width':2.5, 'stroke-linecap':'round', 'stroke-linejoin':'round', 'data-body-direction':'', 'pointer-events':'none' }));
    return art;
  }
  function visionArtwork(item, frame, view = record.content.pitch) {
    const p = frame.positions.find(v => v.id === item.id); if (!p?.vision || !['home', 'away'].includes(item.kind)) return null;
    const { width, height, unitX, unitY } = pitchGeometry(view), radius = p.vision.length * unitX, half = p.vision.angle * Math.PI / 360, x = radius * Math.sin(half), y = -radius * Math.cos(half);
    const group = svg('svg', { width, height, viewBox: '0 0 ' + width + ' ' + height, overflow: 'hidden', 'pointer-events': 'none', 'data-player-vision': item.id });
    group.append(svg('path', { d: `M0 0 L${-x} ${y} A${radius} ${radius} 0 0 1 ${x} ${y} Z`, transform: `translate(${p.x*unitX} ${p.y*unitY}) rotate(${p.facing || 0})`, fill: playerColors[playerColor(item)], 'fill-opacity': .08, stroke: '#edf1dd', 'stroke-opacity': .35, 'stroke-width': 1 })); return group;
  }
  function shadowArtwork(item, frame, items, view = record.content.pitch) {
    const p = frame.positions.find(v => v.id === item.id); if (!p?.shadow || !['home', 'away'].includes(item.kind)) return null;
    const { width, height, unitX, unitY } = pitchGeometry(view), at = positionIn(frame, item.id), ball = nearestBall(at, frame, items, view), angle = ball ? directionTo(at, ball, view) : p.facing || 0;
    const clipped = svg('svg', { x: 0, y: 0, width, height, viewBox: '0 0 ' + width + ' ' + height, overflow: 'hidden', 'pointer-events': 'none', 'data-cover-shadow': item.id, 'aria-hidden': 'true' });
    clipped.append(svg('path', { d: 'M0 0 L' + (-p.shadow.width * unitX / 2) + ' ' + p.shadow.length * unitX + ' L' + p.shadow.width * unitX / 2 + ' ' + p.shadow.length * unitX + 'Z', transform: 'translate(' + at.x * unitX + ' ' + at.y * unitY + ') rotate(' + angle + ')', fill: playerColor(item) === 'white' ? '#68747b' : playerColors[playerColor(item)], 'fill-opacity': .10, stroke: playerColor(item) === 'white' ? '#68747b' : playerColors[playerColor(item)], 'stroke-opacity': .22, 'stroke-width': 1 }));
    return clipped;
  }
  function pieceArtwork(kind, color) {
    const art = svg('g', { 'aria-hidden': 'true', 'data-symbol': kind, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' });
    if (['home', 'away'].includes(kind)) {
      const fill = playerColors[color || (kind === 'away' ? 'gold' : 'blue')];
      art.append(svg('path', { d: 'M-9-22 L-24-13 L-17-1 L-11-5 V23 H11 V-5 L17-1 L24-13 L9-22 Q0-13-9-22Z', fill, stroke: '#45515a', 'stroke-width': 2 }), svg('path', { d: 'M-9-22 Q0-7 9-22 M-11 18 H11', fill: 'none', stroke: '#ffffff70', 'stroke-width': 2 }));
    } else if (kind === 'cone') {
      art.append(svg('ellipse', { cy: 5, rx: 15, ry: 6, fill: '#ed9146', stroke: '#8c4c24', 'stroke-width': 1.5 }), svg('path', { d: 'M-13 4 Q-7 1-5-4 Q0-9 5-4 Q7 1 13 4 Q0 11-13 4Z', fill: '#f5a45c', stroke: '#8c4c24', 'stroke-width': 1.2 }), svg('ellipse', { cy: -3, rx: 4, ry: 2, fill: '#87502b' }));
    } else if (kind === 'ball') {
      art.append(svg('circle', { r: 16, fill: '#fffdf7', stroke: '#334451', 'stroke-width': 2 }), svg('path', { d: 'M0-8 L8-2 L5 7 L-5 7 L-8-2Z M0-8 V-16 M8-2 L15-5 M5 7 L10 13 M-5 7 L-10 13 M-8-2 L-15-5', fill: '#334451', stroke: '#334451', 'stroke-width': 1.5 }), svg('path', { d: 'M-5-14 L0-11 L5-14 M13-8 L11-3 L15 0 M12 10 L6 10 L5 15 M-12 10 L-6 10 L-5 15 M-13-8 L-11-3 L-15 0', fill: 'none', stroke: '#334451', 'stroke-width': 2 }));
    } else if (kind === 'goal') {
      art.append(svg('path', { d: 'M-30 21 L-24-20 H24 L30 21Z', fill: '#eef3f2', stroke: '#667a7c', 'stroke-width': 2 }), svg('path', { d: 'M-24-20 L-30-9 H30 L24-20 M-30-9 V21 H30 V-9 M-18-18 L-21 21 M-6-19 L-7 21 M6-19 L7 21 M18-18 L21 21 M-27 1 H27 M-29 11 H29', fill: 'none', stroke: '#9caca9', 'stroke-width': 1.5 }), svg('path', { d: 'M-30 21 V-9 H30 V21', fill: 'none', stroke: '#344b57', 'stroke-width': 6 }), svg('path', { d: 'M-30 21 V-9 H30 V21', fill: 'none', stroke: '#fffdf5', 'stroke-width': 3 }));
    } else if (kind === 'zone') art.append(svg('rect', { x: -29, y: -22, width: 58, height: 44, rx: 3, fill: '#668ab32b', stroke: '#53789d', 'stroke-width': 3, 'stroke-dasharray': '5 4' }));
    return art;
  }
  function arrowArtwork(arrow, interactive = false, view = record.content.pitch) {
    const { unitX, unitY } = pitchGeometry(view), x1 = arrow.x1 * unitX, y1 = arrow.y1 * unitY, x2 = arrow.x2 * unitX, y2 = arrow.y2 * unitY;
    const points = [{x:x1,y:y1}, ...(arrow.points || []).map(p=>({x:p.x*unitX,y:p.y*unitY})), {x:x2,y:y2}], previous = points.slice(0,-1).reverse().find(p=>Math.hypot(x2-p.x,y2-p.y)>.01) || points[0];
    const angle = Math.atan2(y2 - previous.y, x2 - previous.x), color = playerColors[arrow.color] || '#38434a';
    const length = points.slice(1).reduce((sum,p,i)=>sum+Math.hypot(p.x-points[i].x,p.y-points[i].y),0);
    const scale = interactive ? Math.max(.1, board.getScreenCTM()?.a || 1) : 1, head = Math.min(18 / scale, length * .45);
    let d = 'M'+x1+' '+y1; for(let i=1;i<points.length-1;i++){const p=points[i],next=points[i+1];d+=' Q'+p.x+' '+p.y+' '+(p.x+next.x)/2+' '+(p.y+next.y)/2;} d+=' L'+x2+' '+y2;
    const shape = arrow.points?.length ? ['path',{d,fill:'none','stroke-linecap':'round','stroke-linejoin':'round'}] : ['line',{x1,y1,x2,y2}];
    const group = svg('g', interactive ? { 'data-tactics-arrow': arrow.id, role:'button', tabindex: editable() ? '0' : '-1', 'aria-label':'Drawn path with arrowhead. Select to adjust or delete.', 'aria-pressed':String(selectedArrow === arrow.id) } : { 'data-preview-arrow': arrow.id });
    if (interactive) group.append(svg(shape[0], { ...shape[1],stroke:'transparent','stroke-width':18/scale,'pointer-events':'stroke' }));
    group.append(svg(shape[0], { ...shape[1],stroke:color,'stroke-width':2.5/scale,'pointer-events':'none' }),svg('polygon',{points:[[x2,y2],[x2-head*Math.cos(angle-.45),y2-head*Math.sin(angle-.45)],[x2-head*Math.cos(angle+.45),y2-head*Math.sin(angle+.45)]].map(p=>p.join(',')).join(' '),fill:color,'pointer-events':'none'}));
    if (interactive && selectedArrow === arrow.id && editable()) for (const [end,x,y] of [['start',x1,y1],['end',x2,y2]]) group.append(svg('circle',{cx:x,cy:y,r:7/scale,fill:'#fffdf5',stroke:color,'stroke-width':2/scale,'data-arrow-end':end,tabindex:0,role:'button','aria-label':'Arrow '+end+'. Drag or use arrow keys.'}));
    return group;
  }
  function translateArrow(arrow, original, dx, dy) {
    const points = [{x:original.x1,y:original.y1}, ...(original.points || []), {x:original.x2,y:original.y2}];
    dx = Math.max(-Math.min(...points.map(p=>p.x)), Math.min(100-Math.max(...points.map(p=>p.x)),dx));
    dy = Math.max(-Math.min(...points.map(p=>p.y)), Math.min(100-Math.max(...points.map(p=>p.y)),dy));
    for(const end of ['1','2']){arrow['x'+end]=original['x'+end]+dx;arrow['y'+end]=original['y'+end]+dy;}
    if(original.points) arrow.points=original.points.map(p=>({x:p.x+dx,y:p.y+dy}));
  }
  function zoneArtwork(item, p, preview = false, view = record.content.pitch) {
    const { unitX, unitY } = pitchGeometry(view), width = item.zone.width * unitX, height = item.zone.height * unitY, color = { blue: '#426f9b', gold: '#956b20', green: '#397561' }[item.zone.color];
    const group = svg('g', { transform: 'translate(' + p.x * unitX + ' ' + p.y * unitY + ')', 'data-zone': item.id });
    if (!preview) { group.dataset.tacticsItem = item.id; group.setAttribute('role', 'button'); group.setAttribute('tabindex', editable() ? '0' : '-1'); group.setAttribute('aria-label', 'Zone ' + item.label); group.setAttribute('aria-pressed', String(selection().includes(item.id))); }
    const attrs = { fill: color, 'fill-opacity': item.zone.outline ? 0 : .13, stroke: color, 'stroke-width': selectedItem === item.id && !preview ? 3 : 2, 'stroke-dasharray': item.zone.outline ? 'none' : '7 5', 'vector-effect': 'non-scaling-stroke' };
    group.append(['triangle', 'diamond'].includes(item.zone.shape) ? svg('polygon', { points: item.zone.shape === 'triangle' ? `0,${-height/2} ${width/2},${height/2} ${-width/2},${height/2}` : `0,${-height/2} ${width/2},0 0,${height/2} ${-width/2},0`, ...attrs }) : item.zone.shape === 'ellipse' ? svg('ellipse', { rx: width / 2, ry: height / 2, ...attrs }) : svg('rect', { x: -width / 2, y: -height / 2, width, height, rx: 5, ...attrs }));
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
  // Pure playback renderer for the library viewer; never changes the active editor.
  function previewAt(content, seconds = 0) {
    if (!content?.frames?.length || !Array.isArray(content.items)) return null;
    const total = content.frames.slice(0, -1).reduce((sum, frame) => sum + frame.duration, 0);
    let remaining = Math.max(0, Math.min(total, Number(seconds) || 0)), index = 0;
    while (index < content.frames.length - 1 && remaining >= content.frames[index].duration) remaining -= content.frames[index++].duration;
    const frame = content.frames[index], next = content.frames[index + 1];
    const positions = next && remaining > 0 ? motionPositions(frame, next, remaining / frame.duration, content.pitch) : frame.positions;
    return { image: previewFrame({ ...frame, positions }, content.items, content.pitch, true), index, total };
  }
  function previewFrame(frame, items = record.content.items, view = record.content.pitch, labelled = false) {
    const { width, height, unitX, unitY } = pitchGeometry(view), thumbnail = svg('svg', { viewBox: '0 0 ' + width + ' ' + height, 'aria-hidden': 'true' });
    thumbnail.append(fieldArtwork(view));
    for (const item of items) { const shadow = shadowArtwork(item, frame, items, view); if (shadow) thumbnail.append(shadow); const vision = visionArtwork(item, frame, view); if (vision) thumbnail.append(vision); }
    for (const item of [...items].sort((a, b) => pieceLayer(a) - pieceLayer(b))) { const p = positionIn(frame, item.id), settings = frame.positions.find(v => v.id === item.id); if (item.kind === 'zone') thumbnail.append(zoneArtwork(item, p, true, view)); else { const symbol = svg('g', { transform: 'translate(' + p.x * unitX + ' ' + p.y * unitY + ') scale(1)', 'data-preview-piece': item.id }); const graphic = playerArtwork(item.kind, settings, item.color); if (item.kind === 'goal') graphic.setAttribute('transform', 'rotate(' + (settings.rotation || 0) + ') scale(' + (item.scale || 1) + ')'); symbol.append(graphic); if (labelled && item.label && ['home', 'away'].includes(item.kind)) symbol.append(svg('text', { x: 0, y: 5, 'text-anchor': 'middle', 'font-size': 16, 'font-family': 'Arial,sans-serif', 'font-weight': 700, fill: playerInk(item) }, item.label)); thumbnail.append(symbol); } }
    for (const arrow of frame.arrows || []) thumbnail.append(arrowArtwork(arrow, false, view));
    return thumbnail;
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
    status.textContent = ((libraryBinding ? window.CoachLibrary?.isDirty() : dirty()) ? 'Unsaved changes · ' : '') + message;
    status.classList.toggle('tactics-error', messageError);
  }
  function render() {
    if (!context?.profile) { mount.replaceChildren(); return; }
    if (!mount.childElementCount) mount.append(workbar, editor, library, reuse);
    title.value = record.title; pitch.value = record.content.pitch; purpose.value = record.content.purpose || 'drill';
    workbar.firstElementChild.hidden = !!libraryBinding;
    library.hidden = reuse.hidden = recoveryActions.hidden = !!libraryBinding;
    extras.hidden = !!libraryBinding;
    $('tactics-archive').hidden = $('tactics-save-copy').hidden = !!libraryBinding;
    $('tactics-save').textContent = libraryBinding ? 'Save drill' : 'Save setup';
    $('tactics-save').hidden = !!libraryBinding; saveLibrary.hidden = !!libraryBinding;
    selectionCount.hidden = selection().length < 2;
    phaseOptions.hidden = previewControls.hidden = playback.hidden = record.content.frames.length < 2;
    for (const mode of ['place', 'record']) $('tactics-mode-' + mode).setAttribute('aria-pressed', String(editMode === mode));
    arrowTool.setAttribute('aria-pressed', String(editMode === 'arrow')); board.style.cursor = editMode === 'arrow' ? 'crosshair' : '';
    modeHint.textContent = editMode === 'arrow' ? 'Draw on the field' : editMode === 'place' ? 'Moves every phase' : frameIndex ? 'Records this phase' : 'Set starting positions';
    modeHint.title = editMode === 'place' ? 'Moving a piece adjusts its position in every phase and preserves its route.' : 'Add a next phase, then drag players and balls to record their movement.';
    currentColor.style.backgroundColor = currentPlayerColor ? playerColors[currentPlayerColor] : 'transparent'; currentColor.hidden = !currentPlayerColor;
    newPlayer.hidden = !record.content.items.some(item => ['home', 'away'].includes(item.kind));
    selectionCount.textContent = selection().length > 1 ? selection().length + ' selected · drag or duplicate together' : 'Shift-click pieces to select a group';
    librarySelect.replaceChildren(); const unsaved = el('option', 'New unsaved setup'); unsaved.value = ''; librarySelect.append(unsaved);
    for (const d of diagrams) { const option = el('option', d.title); option.value = d.id; librarySelect.append(option); }
    librarySelect.value = record.id || '';
    itemSelect.replaceChildren(); const none = el('option', 'Choose a piece'); none.value = ''; itemSelect.append(none);
    for (const item of record.content.items) { const option = el('option', pieceName(item) + (item.label ? ' · ' + item.label : '')); option.value = item.id; itemSelect.append(option); }
    if (!record.content.items.some(i => i.id === selectedItem)) selectedItem = '';
    itemSelect.value = selectedItem; labelInput.value = record.content.items.find(i => i.id === selectedItem)?.label || '';
    const position = currentFrame().positions.find(p => p.id === selectedItem);
    const selectedKind = record.content.items.find(i => i.id === selectedItem)?.kind;
    pieceLabel.firstChild.textContent = ['home', 'away'].includes(selectedKind) ? 'Shirt label' : 'Piece label';
    rotationField.hidden = selectedKind !== 'goal'; rotation.value = String(position?.rotation || 0);
    bodyTools.hidden = !['home', 'away'].includes(selectedKind);
    visionEnabled.checked = !!position?.vision;
    bodyEnabled.checked = Number.isFinite(position?.facing);
    shadowEnabled.checked = !!position?.shadow;
    carrier.replaceChildren(); const free = el('option', 'Free ball'); free.value = ''; carrier.append(free);
    for (const player of record.content.items.filter(i => ['home', 'away'].includes(i.kind))) { const option = el('option', pieceName(player) + ' ' + player.label); option.value = player.id; carrier.append(option); }
    carrier.value = position?.attachedTo || ''; carrierField.hidden = selectedKind !== 'ball';
    const transition = shownTransition(), routeStart = transition?.from.positions.find(p => p.id === selectedItem), routeEnd = transition?.to.positions.find(p => p.id === selectedItem);
    routeActions.hidden = !['home', 'away', 'ball'].includes(selectedKind) || !routeEnd || !!routeStart?.attachedTo && routeStart.attachedTo === routeEnd.attachedTo;
    advanced.hidden = carrierField.hidden && routeActions.hidden;
    pieceLabel.hidden = pieceActions.hidden = !selectedItem;
    zoneControls.hidden = selectedKind !== 'zone';
    if (!zoneControls.hidden) { const zone = record.content.items.find(i => i.id === selectedItem).zone; zoneShape.value = zone.shape; zoneColor.value = zone.color; zoneWidth.value = zone.width; zoneHeight.value = zone.height; zoneOutline.checked=!!zone.outline; }
    if (!currentFrame().arrows?.some(arrow => arrow.id === selectedArrow)) selectedArrow = '';
    side.dataset.selected = String(!!selectedItem || !!selectedArrow);
    selectionHint.hidden = !!selectedItem || !!selectedArrow;
    playerColorField.hidden = !['home','away'].includes(selectedKind); if (!playerColorField.hidden) playerColorSelect.value = playerColor(record.content.items.find(item => item.id === selectedItem));
    removeArrow.hidden = !selectedArrow;
    const phaseScroll = frameButtons.scrollLeft;
    frameButtons.replaceChildren(...record.content.frames.map((f, index) => { const b = button('', 'tactics-frame-' + index, () => { if (!editable()) return; stopPlayback(); frameIndex = index; render(); closePhases(true); }); const preview = el('span', '', 'tactics-frame-preview'); preview.append(previewFrame(f)); b.append(preview, el('span', (index + 1) + '. ' + f.title)); b.dataset.tacticsFrame = index; b.setAttribute('aria-pressed', String(frameIndex === index)); return b; }));
    frameButtons.scrollLeft = phaseScroll;
    frameTitle.value = currentFrame().title; duration.value = String(currentFrame().duration); phaseNotes.value = currentFrame().notes || '';
    durationField.hidden = frameIndex === record.content.frames.length - 1;
    $('tactics-sequence-summary').textContent = record.content.frames.length + ' / 12 steps · ' + totalSeconds() + 's · ' + record.content.items.length + ' / 40 pieces';
    const disabled = !editable();
    for (const control of mount.querySelectorAll('button,input,select,textarea')) control.disabled = disabled;
    $('tactics-play').disabled = !active() || !loaded || pending || context.busy || record.content.frames.length < 2;
    phaseToggle.disabled = !active() || !loaded || pending || context.busy;
    $('tactics-reset').disabled = !active() || !loaded || pending || context.busy;
    speed.disabled = loop.disabled = scrub.disabled = !active() || !loaded || pending || context.busy || record.content.frames.length < 2;
    scrub.max = String(totalSeconds());
    $('tactics-retry').disabled = !active() || pending || context.busy;
    pathToggle.disabled = !active() || !loaded;
    labelInput.disabled = disabled || !selectedItem;
    for (const control of side.querySelectorAll('button')) control.disabled = disabled || (!selectedItem && !arrange.contains(control));
    $('tactics-select-players').disabled = disabled || !record.content.items.some(item => ['home','away'].includes(item.kind));
    $('tactics-select-colour').disabled = disabled || !['home','away'].includes(selectedKind);
    $('tactics-clear-selection').disabled = disabled || !selection().length;
    for (const id of ['tactics-align-row','tactics-align-column']) $(id).disabled = disabled || selection().filter(id => ['home','away','cone'].includes(record.content.items.find(item => item.id === id)?.kind)).length < 2;
    for (const control of [backField, ...mobileLinks.querySelectorAll('button')]) control.disabled = !active() || !loaded || pending;
    removeArrow.disabled = disabled || !selectedArrow;
    $('tactics-duplicate-item').disabled = disabled || !selectedItem || record.content.items.length + selection().length > 40;
    $('tactics-duplicate-item').textContent = selection().length > 1 ? 'Duplicate selection' : 'Duplicate piece';
    $('tactics-step-earlier').disabled = disabled || frameIndex === 0;
    $('tactics-step-later').disabled = disabled || frameIndex === record.content.frames.length - 1;
    $('tactics-save-copy').disabled = disabled || recoveryNeeded;
    $('tactics-remove-frame').disabled = disabled || record.content.frames.length <= 1;
    $('tactics-add-frame').disabled = disabled || record.content.frames.length >= 12;
    $('tactics-save').disabled = disabled || recoveryNeeded || !record.title.trim() || (!dirty() && !!record.id);
    if (libraryBinding) $('tactics-save').disabled = librarySaveBlocked || !active() || running;
    $('tactics-archive').disabled = disabled || !record.id;
    reopen.hidden = !record.id; reopen.disabled = disabled || !record.id || !diagrams.some(d => d.id === record.id);
    $('tactics-undo').disabled = disabled || !undo.length; $('tactics-redo').disabled = disabled || !redo.length;
    for (const control of addGroup.querySelectorAll('button')) control.disabled = disabled || record.content.items.length >= 40;
    emptyHint.hidden = !!record.content.items.length || !!currentFrame().arrows?.length || editMode === 'arrow';
    mount.setAttribute('aria-busy', String(pending));
    renderReuse();
    renderStatus(); draw(); renderPlayback();
  }
  function fieldArtwork(view) {
    const { width, height } = pitchGeometry(view), vertical = ['facing-goal', 'away-from-goal'].includes(view);
    const art = svg('g', { 'data-field-view': view, 'pointer-events': 'none' });
    art.append(svg('rect', { width, height, fill: '#abc69d' }));
    for (let at = 0; at < (vertical ? height : width); at += 200) art.append(svg('rect', { x: vertical ? 0 : at, y: vertical ? at : 0, width: vertical ? width : Math.min(100, width - at), height: vertical ? Math.min(100, height - at) : height, fill: '#9db98e' }));
    const lines = svg('g', { fill: 'none', stroke: '#f0f5e8', 'stroke-width': 2.5, 'pointer-events': 'none' });
    lines.append(svg('rect', { x: 25, y: 25, width: width - 50, height: height - 50, rx: 2, 'data-field-boundary': 'true' }));
    if (view !== 'blank') {
      if (view === 'full') lines.append(svg('line', { x1: 500, y1: 25, x2: 500, y2: 625 }), svg('circle', { cx: 500, cy: 325, r: 80 }), svg('circle', { cx: 500, cy: 325, r: 3, fill: '#f0f5e8' }), svg('rect', { x: 25, y: 175, width: 150, height: 300 }), svg('rect', { x: 825, y: 175, width: 150, height: 300 }), svg('rect', { x: 25, y: 250, width: 55, height: 150 }), svg('rect', { x: 920, y: 250, width: 55, height: 150 }));
      else if (view === 'half') lines.append(svg('rect', { x: 25, y: 175, width: 150, height: 300 }), svg('rect', { x: 25, y: 250, width: 55, height: 150 }), svg('path', { d: 'M 475 245 A80 80 0 0 0 475 405' }));
      else {
        const end = svg('g', { 'data-field-goal': view === 'facing-goal' ? 'top' : 'bottom', transform: view === 'away-from-goal' ? 'translate(0 500) scale(1 -1)' : '' });
        end.append(svg('rect', { x: 175, y: 25, width: 300, height: 150 }), svg('rect', { x: 250, y: 25, width: 150, height: 55 }), svg('circle', { cx: 325, cy: 125, r: 3, fill: '#f0f5e8' }), svg('path', { d: 'M263 175 A80 80 0 0 0 387 175 M245 475 A80 80 0 0 1 405 475' }), svg('rect', { x: 265, y: 7, width: 120, height: 18, fill: '#f5f7ef', stroke: '#677b67' }), svg('path', { d: 'M285 7 V25 M305 7 V25 M325 7 V25 M345 7 V25 M365 7 V25 M265 16 H385', 'stroke-width': 1 }));
        lines.append(end);
      }
    }
    art.append(lines);
    return art;
  }
  function draw() {
    placeFieldDock();
    if (record.content.pitch !== 'full' && cameraMode !== 'full') resetCamera();
    const geometry = cameraGeometry(), bounds = viewBounds(), { width, height, unitX, unitY } = pitchGeometry();
    viewCenter = { x: Math.max(bounds.left, Math.min(bounds.right, viewCenter.x)), y: Math.max(bounds.top, Math.min(bounds.bottom, viewCenter.y)) };
    updateViewControls();
    board.setAttribute('viewBox', [viewCenter.x - geometry.width / 2 / zoom, viewCenter.y - geometry.height / 2 / zoom, geometry.width / zoom, geometry.height / zoom].join(' '));
    const scrollContainer = board.closest('#library-form') || board.closest('.planner-drawer-content');
    const fieldTop = canvasWrap.getBoundingClientRect().top + (scrollContainer?.scrollTop || window.scrollY);
    const footerHeight = sequenceActions.getBoundingClientRect().height || 44;
    const fieldHeight = Math.max(180, innerHeight - (innerWidth >= 1000 ? fieldTop : 150) - footerHeight - 20);
    boardLayout.style.setProperty('--pitch-max-width', fieldHeight * geometry.width / geometry.height + 'px');
    fieldColumn.style.setProperty('--pitch-max-width', fieldHeight * geometry.width / geometry.height + 'px');
    board.closest('#library-form')?.style.setProperty('--pitch-max-width', fieldHeight * geometry.width / geometry.height + 'px');
    boardLayout.dataset.upright = String(geometry.height > geometry.width); board.closest('#library-form')?.setAttribute('data-upright', String(geometry.height > geometry.width)); board.dataset.camera = cameraMode; board.style.setProperty('--field-height', fieldHeight + 'px'); board.style.setProperty('--field-ratio', geometry.width + ' / ' + geometry.height); board.dataset.orientation = geometry.height > geometry.width ? 'tall' : 'wide';
    board.replaceChildren();
    scene = svg('g', { 'data-camera-scene': '', transform: 'rotate(' + geometry.angle + ' ' + width / 2 + ' ' + height / 2 + ')' });
    board.append(scene); scene.append(fieldArtwork(record.content.pitch));
    if (showLanes && record.content.pitch !== 'blank') {
      const lanes = svg('g', { 'data-tactics-lanes': '', 'pointer-events': 'none' });
      const vertical = ['facing-goal', 'away-from-goal'].includes(record.content.pitch);
      const labelX = record.content.pitch === 'full' && cameraMode !== 'full' ? (cameraMode === 'left-half' ? 250 : 750) : width / 2, laneWidth = (width - 50) / 5, laneHeight = (height - 50) / 5;
      ['Wide', 'Half-space', 'Middle', 'Half-space', 'Wide'].forEach((name, index) => {
        const x = vertical ? 25 + index * laneWidth : 25, y = vertical ? 25 : 25 + index * laneHeight;
        lanes.append(svg('rect', { x, y, width: vertical ? laneWidth : width - 50, height: vertical ? height - 50 : laneHeight, fill: index % 2 ? '#e8d8a8' : '#d8e6ec', 'fill-opacity': .18, 'data-lane': name }));
        if (index) lanes.append(svg('path', { d: vertical ? 'M' + x + ' 25 V' + (height - 25) : 'M25 ' + y + ' H' + (width - 25), stroke: '#f3f5df', 'stroke-width': 1.5, 'stroke-dasharray': '8 6', opacity: .85 }));
        const tx = vertical ? x + laneWidth / 2 : labelX, ty = vertical ? height / 2 : y + laneHeight / 2;
        lanes.append(svg('text', { x: tx, y: ty, transform: 'rotate(' + -geometry.angle + ' ' + tx + ' ' + ty + ')', 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-size': 14, 'font-weight': 600, fill: '#293e32', stroke: '#cbdcbb', 'stroke-width': 3, 'paint-order': 'stroke' }, name));
      });
      scene.append(lanes);
    }
    if (showGrid) { const guides = svg('g', { 'data-tactics-grid': '', fill:'none', stroke:'#f8f3d6', 'stroke-width':1.5, 'stroke-dasharray':'9 7', opacity:.7, 'pointer-events':'none' }); for (const fraction of [1/3,2/3]) guides.append(svg('path',{d:'M'+(25+(width-50)*fraction)+' 25 V'+(height-25)+' M25 '+(25+(height-50)*fraction)+' H'+(width-25)})); scene.append(guides); }
    for (const item of record.content.items.filter(i => i.kind === 'zone')) { const p = renderedPositions?.find(p => p.id === item.id) || positionIn(currentFrame(), item.id); scene.append(zoneArtwork(item, p)); }
    const visibleFrame = renderedPositions ? { ...currentFrame(), positions: renderedPositions } : currentFrame();
    for (const item of record.content.items) { const shadow = shadowArtwork(item, visibleFrame, record.content.items); if (shadow) scene.append(shadow); const vision = visionArtwork(item, visibleFrame); if (vision) scene.append(vision); }
    const defs = svg('defs');
    for (const [kind, color] of [...Object.entries(playerColors), ['ball', '#303b42']]) { const marker = svg('marker', { id: 'tactics-arrow-' + kind, viewBox: '0 0 10 10', refX: 24, refY: 5, markerWidth: 5, markerHeight: 5, orient: 'auto' }); marker.append(svg('path', { d: 'M0 0 L10 5 L0 10z', fill: kind === 'white' ? '#68747b' : color })); defs.append(marker); }
    scene.append(defs);
    const transition = shownTransition();
    pathCaption.textContent = editMode === 'arrow' ? 'Drag to draw · Select an arrow to adjust its ends · Delete removes it from this phase' : transition ? 'Movement: ' + transition.from.title + ' → ' + transition.to.title + ' · Dashed: player · Solid: ball' : 'Starting positions · Add a next phase, then drag players and balls to record their route.';
    if (pathToggle.checked && transition) {
      const { from, to } = transition;
      for (const item of record.content.items) {
        if (!['home', 'away', 'ball'].includes(item.kind)) continue;
        const points = routePoints(from, to, item.id), length = points.slice(1).reduce((sum, p, i) => sum + routeDistance(points[i], p), 0); if (length < .3) continue;
        const scale = Math.max(.01, board.getScreenCTM()?.a || 1);
        const color = item.kind === 'ball' ? 'ball' : playerColor(item);
        scene.append(svg('path', { d: points.map((p, i) => (i ? 'L ' : 'M ') + p.x * unitX + ' ' + p.y * unitY).join(' '), 'data-tactics-path': item.id, fill: 'none', stroke: color === 'ball' ? '#303b42' : color === 'white' ? '#68747b' : playerColors[color], opacity: selectedItem && !selection().includes(item.id) ? .28 : 1, 'stroke-width': 2.5 / scale, 'stroke-dasharray': item.kind === 'ball' ? 'none' : (7 / scale) + ' ' + (5 / scale), 'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'marker-end': length * 10 * scale > 35 ? 'url(#tactics-arrow-' + color + ')' : 'none', 'pointer-events': 'none' }));
      }
    }
    drawRouteHandles(transition);
    const positions = renderedPositions || currentFrame().positions;
    for (const item of [...record.content.items].sort((a,b)=>pieceLayer(a)-pieceLayer(b)||Number(selection().includes(a.id))-Number(selection().includes(b.id)))) {
      if (item.kind === 'zone') continue;
      const p = renderedPositions ? positions.find(point => point.id === item.id) : positionIn(currentFrame(), item.id); if (!p) continue;
      const piece = svg('g', { transform: 'translate(' + (p.x * unitX) + ' ' + (p.y * unitY) + ')', 'data-tactics-item': item.id, role: 'button', tabindex: editable() ? '0' : '-1', 'aria-label': pieceName(item) + (item.label ? ' ' + item.label : '') + ', position ' + Math.round(p.x) + ', ' + Math.round(p.y), 'aria-pressed': String(selection().includes(item.id)), 'aria-disabled': String(!editable()) });
      const screenScale = Math.max(.01, board.getScreenCTM()?.a || 1), artScale = Math.max(.62, .48 / screenScale);
      const art = svg('g', { class: 'tactics-piece-art', transform: 'scale(' + artScale + ')' });
      const hitRadius = Math.max(26, 22 / screenScale / artScale);
      piece.append(art); art.append(svg('circle', { r: hitRadius, fill: 'transparent', class: 'tactics-hit' }));
      if (selection().includes(item.id)) art.append(svg('circle', { r: 28, fill: 'none', stroke: '#152d42', 'stroke-width': 3, 'stroke-dasharray': '4 3', 'pointer-events': 'none' }));
      const settings = visibleFrame.positions.find(v => v.id === item.id), graphic = playerArtwork(item.kind, settings, item.color); if (item.kind === 'goal') graphic.setAttribute('transform', 'rotate(' + (settings.rotation || 0) + ') scale(' + (item.scale || 1) + ')'); else if (item.kind === 'cone' || ['home','away'].includes(item.kind) && !Number.isFinite(settings.facing)) graphic.setAttribute('transform','rotate('+(-geometry.angle)+')'); art.append(graphic);
      if (['home', 'away'].includes(item.kind) && currentFrame().positions.some(v => v.attachedTo === item.id)) art.append(svg('circle', { cx: 22, cy: -23, r: 7, fill: '#fffdf7', stroke: '#203742', 'stroke-width': 2, 'data-possession': item.id }));
      if (item.label) {
        const inside = ['home', 'away'].includes(item.kind) && item.label.length <= 3, width = Math.max(34, item.label.length * 8 + 12);
        const at = cameraPoint({ x:p.x*unitX, y:p.y*unitY }, false), view = board.viewBox.baseVal;
        const labelX = inside ? 0 : Math.max((view.x+4-at.x)/artScale+width/2, Math.min(0,(view.x+view.width-4-at.x)/artScale-width/2));
        const labelY = at.y + 47 * artScale > view.y+view.height-4 ? -47 : 27;
        const caption = svg('g', { transform:'rotate('+(-geometry.angle)+')', 'pointer-events':'none' });
        if (!inside) caption.append(svg('rect', { x: labelX - width / 2, y: labelY, width, height: 20, rx: 5, fill: '#f6f4ec' }));
        caption.append(svg('text', { x: labelX, y: inside ? 5 : labelY + 14, 'text-anchor': 'middle', 'font-family': 'Arial,sans-serif', 'font-size': inside ? 16 : 12, 'font-weight': 700, fill: inside ? playerInk(item) : '#173044' }, item.label));
        if (at.x >= view.x && at.x <= view.x+view.width && at.y >= view.y && at.y <= view.y+view.height) art.append(caption);
      }
      scene.append(piece);
    }
    for (const arrow of currentFrame().arrows || []) scene.append(arrowArtwork(arrow, true));
    const facingPosition = visibleFrame.positions.find(p => p.id === selectedItem);
    if (editable() && !renderedPositions && selection().length === 1 && facingPosition) {
      const p=facingPosition, scale=Math.max(.01,Math.hypot(board.getScreenCTM()?.a||0,board.getScreenCTM()?.b||0)||1);
      const handle=(kind,dx,dy,angle,label)=>{const a=angle*Math.PI/180,x=Math.max(22,Math.min(width-22,p.x*unitX+dx*Math.cos(a)-dy*Math.sin(a))),y=Math.max(22,Math.min(height-22,p.y*unitY+dx*Math.sin(a)+dy*Math.cos(a))),g=svg('g',{'data-overlay-control':kind});
        g.append(svg('circle',{cx:x,cy:y,r:22/scale,fill:'transparent','data-overlay-handle':kind}),svg('path',{d:'M0 -8 L8 0 L0 8 L-8 0Z',transform:'translate('+x+' '+y+') scale('+(1/scale)+')',fill:'#fffdf7',stroke:'#253b46','stroke-width':2,'data-overlay-handle':kind,role:'slider',tabindex:0,'aria-label':label,'aria-valuemin':5,'aria-valuemax':60,'aria-valuenow':kind==='vision'?p.vision.length:p.shadow.length}));scene.append(g);};
      if(p.vision)handle('vision',0,-p.vision.length*unitX,p.facing||0,'View distance. Drag or use arrow keys to resize.');
      if(p.shadow){const ball=nearestBall(p,visibleFrame,record.content.items);handle('shadow',p.shadow.width*unitX/2,p.shadow.length*unitX,ball?directionTo(p,ball):p.facing||0,'Cover shadow. Drag to resize width and depth; arrow keys adjust.');}
    }

    if (editable() && !renderedPositions && selection().length === 1 && Number.isFinite(facingPosition?.facing)) {
      const at = positionIn(visibleFrame, selectedItem), angle = facingPosition.facing * Math.PI / 180, scale = Math.max(.01, board.getScreenCTM()?.a || 1), radius = 48 / scale;
      const x = Math.max(-40, Math.min(width+40, at.x * unitX + Math.sin(angle) * radius)), y = Math.max(-40, Math.min(height+40, at.y * unitY - Math.cos(angle) * radius));
      const turn = svg('g', { 'data-facing-control': selectedItem }); turn.append(svg('line', { x1: at.x * unitX + Math.sin(angle) * 30 / scale, y1: at.y * unitY - Math.cos(angle) * 30 / scale, x2: x, y2: y, stroke: '#253b46', 'stroke-width': 1.5 / scale, 'pointer-events': 'none' }), svg('circle', { cx: x, cy: y, r: 22 / scale, fill: 'transparent', 'data-facing-handle': selectedItem }), svg('circle', { cx: x, cy: y, r: 8 / scale, fill: '#fffdf7', stroke: '#253b46', 'stroke-width': 2 / scale, 'data-facing-handle': selectedItem, role: 'slider', tabindex: 0, 'aria-label': 'Body direction. Drag to turn; arrow keys turn 15 degrees.', 'aria-valuemin': 0, 'aria-valuemax': 359, 'aria-valuenow': Math.round(facingPosition.facing) })); scene.append(turn);
    }
    const sizedItem = record.content.items.find(i => i.id === selectedItem);
    if (editable() && !renderedPositions && selection().length === 1 && (sizedItem?.zone || sizedItem?.kind === 'goal')) {
      const p = currentFrame().positions.find(p => p.id === sizedItem.id), field = pitchGeometry(), scale = Math.max(.01, Math.hypot(board.getScreenCTM()?.a || 0, board.getScreenCTM()?.b || 0) || 1);
      const corner = sizedItem.zone ? { x: sizedItem.zone.width / 2 * field.unitX, y: sizedItem.zone.height / 2 * field.unitY } : goalCorner(sizedItem, p);
      const at = cameraPoint({ x: p.x * field.unitX + corner.x, y: p.y * field.unitY + corner.y }, false), view = board.viewBox.baseVal, margin = 22 / scale;
      const bound = point => ({ x: Math.max(view.x + margin, Math.min(view.x + view.width - margin, point.x)), y: Math.max(view.y + margin, Math.min(view.y + view.height - margin, point.y)) });
      let handlePoint = bound(at);
      if (sizedItem.kind === 'goal') {
        const center = cameraPoint({ x: p.x * field.unitX, y: p.y * field.unitY }, false), radius = Math.hypot(corner.x, corner.y) + 28 / scale;
        const angle = ((p.rotation || 0) + cameraGeometry().angle) * Math.PI / 180;
        const candidates = [[33,24],[-33,24],[33,-24],[-33,-24]].map(([dx,dy]) => {
          const length = Math.hypot(dx,dy);
          return { x: center.x + (dx*Math.cos(angle)-dy*Math.sin(angle))/length*radius, y: center.y + (dx*Math.sin(angle)+dy*Math.cos(angle))/length*radius };
        });
        // Keep the touch target separate from the goal body, choosing an inward corner at an edge.
        handlePoint = candidates.find(point => point.x >= view.x+margin && point.x <= view.x+view.width-margin && point.y >= view.y+margin && point.y <= view.y+view.height-margin)
          || candidates.map(bound).sort((a,b) => Math.hypot(b.x-center.x,b.y-center.y)-Math.hypot(a.x-center.x,a.y-center.y))[0];
      }
      const { x, y } = cameraPoint(handlePoint);
      const attributes = { 'data-size-resize': sizedItem.id, ...(sizedItem.zone ? { 'data-box-resize': sizedItem.id } : {}) };
      const label = sizedItem.zone ? 'Resize ' + sizedItem.zone.shape + '. Arrow keys adjust width and height.' : 'Resize goal. Right or down grows; left or up shrinks.';
      const value = sizedItem.zone ? sizedItem.zone.width + '% wide, ' + sizedItem.zone.height + '% high' : Math.round((sizedItem.scale || 1) * 100) + '%';
      const handle = svg('g', { 'data-size-control': sizedItem.id });
      handle.append(svg('circle', { cx: x, cy: y, r: 22 / scale, fill: 'transparent', ...attributes }), svg('rect', { x: x - 7 / scale, y: y - 7 / scale, width: 14 / scale, height: 14 / scale, rx: 2 / scale, fill: '#fffdf7', stroke: '#355d79', 'stroke-width': 2 / scale, ...attributes, tabindex: 0, role: 'button', 'aria-label': label + ' Current size: ' + value + '. Shift changes size faster.' })); scene.append(handle);
    }
  }
  const clamp = v => Math.max(4, Math.min(96, Math.round(v * 10) / 10));
  function moveSelected(dx, dy) { mutate(() => { const ids = selection(), before = capture(); if (editMode === 'place') shiftLayout(ids, dx, dy, before); else for (const id of ids) { const p = positionIn(currentFrame(), id); if (currentFrame().positions.find(p => p.id === id).attachedTo && ids.includes(currentFrame().positions.find(p => p.id === id).attachedTo)) continue; placePiece(currentFrame(), id, { x: clamp(p.x + dx), y: clamp(p.y + dy) }); } }); }
  function point(event, bounded = true) { const p = board.createSVGPoint(); p.x = event.clientX; p.y = event.clientY; const matrix = scene?.getScreenCTM(); if (!matrix) return null; const next = p.matrixTransform(matrix.inverse()), { unitX, unitY } = pitchGeometry(); return { x: bounded ? clamp(next.x / unitX) : next.x / unitX, y: bounded ? clamp(next.y / unitY) : next.y / unitY }; }
  board.addEventListener('dragover', event => { if (editable() && event.dataTransfer.types.includes('application/x-coach-piece')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } });
  board.addEventListener('drop', event => { if (!editable()) return; const kind = event.dataTransfer.getData('application/x-coach-piece'), destination = point(event); if ((!kinds[kind] && !['player','body','shadow','box'].includes(kind)) || !destination) return; event.preventDefault(); if (kind === 'player') addPlayer(destination); else if(['body','shadow'].includes(kind))addPlayerTool(kind,destination);else if(kind==='box')addPiece('zone',destination,undefined,{outline:true});else addPiece(kind, destination); });
  function routeHandles(transition) {
    const item = record.content.items.find(i => i.id === selectedItem);
    if (!transition || !item || !['home', 'away', 'ball'].includes(item.kind)) return [];
    const p = transition.from.positions.find(p => p.id === item.id), q = transition.to.positions.find(p => p.id === item.id);
    if (p.attachedTo && p.attachedTo === q.attachedTo) return [];
    if (q.trail?.length) return q.trail.map(p => ({ ...p }));
    const points = routePoints(transition.from, transition.to, selectedItem);
    if (routeDistance(points[0], points.at(-1)) < .3) return [];
    return points.length === 2 ? [{ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 }] : points.filter((p, i) => i > 0 && i < points.length - 1 && i % 4 === 0);
  }
  function drawRouteHandles(transition) {
    if (!editable() || !pathToggle.checked || editMode !== 'record') return;
    const radius = 6 / Math.max(.01, board.getScreenCTM()?.a || 1), { unitX, unitY } = pitchGeometry();
    routeHandles(transition).forEach((p, index) => scene.append(svg('circle', { cx: p.x * unitX, cy: p.y * unitY, r: radius, fill: '#fffdf7', stroke: '#253b4b', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke', 'data-route-handle': index, tabindex: 0, role: 'button', 'aria-label': 'Route point ' + (index + 1) + '. Drag or use arrow keys to bend movement.' })));
  }
  function updateRouteHandle(index, destination, handles = routeHandles(shownTransition())) {
    const transition = shownTransition(); if (!transition || !handles[index]) return;
    handles[index] = destination; transition.to.positions.find(p => p.id === selectedItem).trail = handles;
    delete transition.from.positions.find(p => p.id === selectedItem).curve;
  }
  function shiftLayout(ids, dx, dy, before) {
    for (let index = 0; index < record.content.frames.length; index++) {
      const frame = record.content.frames[index], source = before.content.frames[index];
      for (const id of ids) {
        const original = source.positions.find(p => p.id === id), p = frame.positions.find(p => p.id === id);
        if (original.attachedTo && ids.includes(original.attachedTo)) continue;
        const at = positionIn(source, id); placePiece(frame, id, { x: clamp(at.x + dx), y: clamp(at.y + dy) });
        if (original.trail) p.trail = original.trail.map(v => ({ x: clamp(v.x + dx), y: clamp(v.y + dy) }));
      }
    }
  }
  board.addEventListener('pointerdown', event => {
    if (!editable() || event.button !== 0) return;
    const sizeHandle = event.target.closest('[data-size-resize]');
    if (sizeHandle) {
      const start = point(event, false); if (!start) return;
      pointer = { id: event.pointerId, before: capture(), history: { undo: undo.slice(), redo: redo.slice() }, moved: false, start, resizeItem: sizeHandle.dataset.sizeResize };
      const p = currentFrame().positions.find(p => p.id === pointer.resizeItem), field = pitchGeometry(), hit = sizeHandle.closest('[data-size-control]').querySelector('circle');
      pointer.resizeDirection = { x: Number(hit.getAttribute('cx')) - p.x*field.unitX, y: Number(hit.getAttribute('cy')) - p.y*field.unitY };
      board.focus({ preventScroll: true }); board.setPointerCapture(event.pointerId); event.preventDefault(); return;
    }
    const overlayHandle=event.target.closest('[data-overlay-handle]');
    if(overlayHandle){pointer={id:event.pointerId,before:capture(),history:{undo:undo.slice(),redo:redo.slice()},moved:false,overlay:overlayHandle.dataset.overlayHandle,start:point(event,false)};board.setPointerCapture(event.pointerId);event.preventDefault();return;}
    const facingHandle = event.target.closest('[data-facing-handle]');
    if (facingHandle) { pointer = { id: event.pointerId, before: capture(), history:{undo:undo.slice(),redo:redo.slice()}, moved: false, facing: facingHandle.dataset.facingHandle, start: point(event, false) }; board.setPointerCapture(event.pointerId); event.preventDefault(); return; }
    const arrowTarget = event.target.closest('[data-tactics-arrow]'), arrowEnd = event.target.closest('[data-arrow-end]');
    if (arrowTarget) {
      const start = point(event); if (!start) return; selectPiece(''); selectedArrow = arrowTarget.dataset.tacticsArrow;
      pointer = { id:event.pointerId, before:capture(), history:{undo:undo.slice(),redo:redo.slice()}, moved:false, start, arrowId:selectedArrow, arrowHandle:arrowEnd?.dataset.arrowEnd };
      board.setPointerCapture(event.pointerId); event.preventDefault(); render(); return;
    }
    if (editMode === 'arrow') {
      if ((currentFrame().arrows?.length || 0) >= 24) return tell('Use up to 24 drawn arrows per phase.',true);
      const start = point(event); if (!start) return; const before = capture(); selectPiece(''); selectedArrow = uid('arrow_');
      currentFrame().arrows ||= []; currentFrame().arrows.push({id:selectedArrow,x1:start.x,y1:start.y,x2:start.x,y2:start.y,color:'charcoal'});
      pointer = {id:event.pointerId,before,history:{undo:undo.slice(),redo:redo.slice()},moved:false,start,arrowId:selectedArrow,arrowHandle:'end',arrowNew:true,trace:[start]};
      board.setPointerCapture(event.pointerId); event.preventDefault(); draw(); return;
    }
    const handle = event.target.closest('[data-route-handle]');
    if (handle) { pointer = { id: event.pointerId, before: capture(), moved: false, handle: Number(handle.dataset.routeHandle), handles: routeHandles(shownTransition()) }; board.setPointerCapture(event.pointerId); event.preventDefault(); return; }
    const target = event.target.closest('[data-tactics-item]');
    if (target) {
      const id = target.dataset.tacticsItem;
      if (event.shiftKey) { selectPiece(id, true); render(); return; }
      if (multiSelect.checked && !selection().includes(id)) { selectPiece(id, true); render(); return; }
      if (!selection().includes(id)) selectPiece(id); else selectedItem = id;
      stopPlayback();
      const ids = selection(), routes = {};
      if (editMode === 'record' && frameIndex > 0) for (const id of ids) if (['home', 'away', 'ball'].includes(record.content.items.find(i => i.id === id).kind)) routes[id] = routePoints(record.content.frames[frameIndex - 1], currentFrame(), id).map(p => ({ x: p.x, y: p.y }));
      pointer = { id: event.pointerId, before: capture(), history: { undo: undo.slice(), redo: redo.slice() }, moved: false, start: point(event), ids, routes };
      board.setPointerCapture(event.pointerId); event.preventDefault(); render();
    } else if (selectedItem) { const destination = point(event), start = positionIn(currentFrame(), selectedItem); if (destination) moveSelected(destination.x - start.x, destination.y - start.y); }
  });
  function dragPointer(event) {
    if (!pointer || pointer.id !== event.pointerId || !editable()) return;
    const destination = point(event, !pointer.facing && !pointer.overlay && !pointer.resizeItem); if (!destination) return;
    if (pointer.handle === undefined && routeDistance(pointer.start, destination) < .2 && !pointer.moved) return;
    if (!pointer.moved) { undo.push(pointer.before); if (undo.length > 30) undo.shift(); redo = []; pointer.moved = true; }
    if (pointer.resizeItem) {
      const item = pointer.before.content.items.find(i => i.id === pointer.resizeItem), dx = destination.x - pointer.start.x, dy = destination.y - pointer.start.y;
      if (item.zone) {
        for (const [index, frame] of record.content.frames.entries()) Object.assign(frame.positions.find(p => p.id === item.id), pointer.before.content.frames[index].positions.find(p => p.id === item.id));
        resizeShape(item.id, item.zone.width + dx * 2, item.zone.height + dy * 2);
      } else {
        const p = pointer.before.content.frames[frameIndex].positions.find(p => p.id === item.id), corner = goalCorner({ ...item, scale: 1 }, p), field = pitchGeometry(), direction = pointer.resizeDirection;
        resizeGoal(item.id, (item.scale || 1) + (dx*field.unitX*direction.x + dy*field.unitY*direction.y) / Math.hypot(direction.x,direction.y) / Math.hypot(corner.x,corner.y));
      }
      draw(); renderStatus(); notifyDraft(); return;
    }
    if(pointer.overlay){const {unitX,unitY}=pitchGeometry(),p=playerPosition(),dx=(destination.x-p.x)*unitX,dy=(destination.y-p.y)*unitY,clamp=v=>Math.max(5,Math.min(60,Math.round(v)));
      if(pointer.overlay==='vision')p.vision.length=clamp(Math.hypot(dx,dy)/unitX);
      else {const ball=nearestBall(p,currentFrame(),record.content.items),a=(ball?directionTo(p,ball):p.facing||0)*Math.PI/180;p.shadow={width:clamp(Math.abs(dx*Math.cos(a)+dy*Math.sin(a))/(unitX/2)),length:clamp((-dx*Math.sin(a)+dy*Math.cos(a))/unitX)};}
      draw();renderStatus();notifyDraft();return;}
    if (pointer.facing) { const p = currentFrame().positions.find(p => p.id === pointer.facing); p.facing = Math.round(directionTo(p, destination)) % 360; draw(); renderStatus(); notifyDraft(); return; }
    if (pointer.arrowId) {
      const arrow = currentFrame().arrows.find(item=>item.id===pointer.arrowId); if (!arrow) return;
      if (pointer.arrowNew) {
        for(const sample of [...(event.getCoalescedEvents?.() || []),event]) { const p=point(sample); if(p && routeDistance(pointer.trace.at(-1),p)>=.25) pointer.trace.push(p); }
        if(pointer.trace.length>256) pointer.trace=boundedRoute(pointer.trace,128);
        const reduced=boundedRoute([...pointer.trace,destination],34).slice(1,-1); arrow.x2=destination.x;arrow.y2=destination.y;
        if(reduced.length)arrow.points=reduced;else delete arrow.points;
      } else if (pointer.arrowHandle) { const end=pointer.arrowHandle==='start'?'1':'2'; arrow['x'+end]=destination.x; arrow['y'+end]=destination.y; }
      else { const original=pointer.before.content.frames[frameIndex].arrows.find(item=>item.id===pointer.arrowId); translateArrow(arrow,original,destination.x-pointer.start.x,destination.y-pointer.start.y); }
      draw(); renderStatus(); notifyDraft(); return;
    }
    if (pointer.handle !== undefined) { updateRouteHandle(pointer.handle, destination, pointer.handles); draw(); renderStatus(); notifyDraft(); return; }
    const dx = destination.x - pointer.start.x, dy = destination.y - pointer.start.y;
    if (!pointer.recording && editMode === 'record' && frameIndex > 0 && routeDistance(pointer.start, destination) >= (record.content.items.find(i => i.id === selectedItem)?.kind === 'ball' && !pointer.before.content.frames[frameIndex].positions.find(p => p.id === selectedItem)?.attachedTo ? .5 : minimumRecordedDrag)) {
      // Discard the temporary layout adjustment before recording the actual drag.
      record.content.frames.forEach((frame, index) => { frame.positions = clone(pointer.before.content.frames[index].positions); });
      pointer.recording = true;
    }
    if (!pointer.recording) shiftLayout(pointer.ids, dx, dy, pointer.before);
    else for (const id of pointer.ids) {
      const original = pointer.before.content.frames[frameIndex], at = positionIn(original, id), p = original.positions.find(p => p.id === id);
      if (p.attachedTo && pointer.ids.includes(p.attachedTo)) continue;
      const next = { x: clamp(at.x + dx), y: clamp(at.y + dy) }; placePiece(currentFrame(), id, next);
      const points = pointer.routes[id];
      if (points) {
        for (const sample of [...(event.getCoalescedEvents?.() || []), event]) { const pos = point(sample); if (!pos) continue; const nextSample = { x: clamp(at.x + pos.x - pointer.start.x), y: clamp(at.y + pos.y - pointer.start.y) }; if (routeDistance(points.at(-1), nextSample) >= .25) points.push(nextSample); }
        if (points.length > 256) pointer.routes[id] = boundedRoute(points, 128);
        saveDraggedRoute([...pointer.routes[id], next], id);
      }
    }
    draw(); renderStatus(); notifyDraft();
  }
  board.addEventListener('pointermove', dragPointer);
  const endPointer = event => {
    if (!pointer) return;
    if((pointer.overlay||pointer.facing)&&event.type==='pointercancel'){undo=pointer.history.undo;redo=pointer.history.redo;apply(pointer.before);pointer=null;render();notifyDraft();return;}
    if (pointer.ids && event.type === 'pointercancel') { undo = pointer.history.undo; redo = pointer.history.redo; apply(pointer.before); pointer = null; render(); notifyDraft(); return; }
    if(pointer.resizeItem){if(event.type==='pointercancel'){undo=pointer.history.undo;redo=pointer.history.redo;apply(pointer.before);}else if(pointer.moved&&event.type==='pointerup')dragPointer(event);pointer=null;render();notifyDraft();return;}
    if (pointer.arrowId) {
      if (event.type === 'pointercancel' || pointer.arrowNew && !pointer.moved) { undo=pointer.history.undo;redo=pointer.history.redo;apply(pointer.before); }
      else if (pointer.moved && event.type === 'pointerup') dragPointer(event);
      pointer = null; render(); notifyDraft(); return;
    }
    if (pointer.moved && event.type === 'pointerup') {
      dragPointer(event);
      if (!pointer.overlay && !pointer.facing && pointer.handle === undefined && pointer.ids.length === 1 && record.content.items.find(i => i.id === selectedItem)?.kind === 'ball') {
        const p = currentFrame().positions.find(p => p.id === selectedItem);
        const target = record.content.items.filter(i => ['home', 'away'].includes(i.kind)).map(i => ({ id: i.id, distance: routeDistance(p, positionIn(currentFrame(), i.id)) })).filter(i => i.distance <= 3).sort((a, b) => a.distance - b.distance)[0];
        if (target) {
          if (!pointer.recording && pointer.before.content.frames[frameIndex].positions.find(p => p.id === selectedItem).attachedTo === target.id) { record.content.frames.forEach((frame, index) => { frame.positions = clone(pointer.before.content.frames[index].positions); }); undo = pointer.history.undo; redo = pointer.history.redo; }
          else attachBall(selectedItem, target.id, !!pointer.recording);
          tell(pointer.recording ? 'Ball attached. Its recorded route is kept.' : 'Ball placed with the player. No movement recorded.');
        } else tell(pointer.recording ? 'Ball released. Its recorded route is kept.' : 'Ball placed. No movement recorded.');
      }
    }
    pointer = null; render(); notifyDraft();
  };
  board.addEventListener('pointerup', endPointer); board.addEventListener('pointercancel', endPointer); board.addEventListener('lostpointercapture', endPointer);
  board.addEventListener('keydown', event => {
    if (!editable()) return;
    const overlayHandle=event.target.closest('[data-overlay-handle]');
    if(overlayHandle&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const kind=overlayHandle.dataset.overlayHandle;mutate(()=>{const p=playerPosition(),key=kind==='shadow'&&['ArrowLeft','ArrowRight'].includes(event.key)?'width':'length',part=kind==='shadow'?p.shadow:p.vision;part[key]=Math.max(5,Math.min(60,part[key]+(['ArrowRight','ArrowUp'].includes(event.key)?1:-1)));});board.querySelector('[data-overlay-handle="'+kind+'"][role="slider"]')?.focus();return;}
    const sizeHandle = event.target.closest('[data-size-resize]');
    if (sizeHandle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault(); const id = sizeHandle.dataset.sizeResize, item = record.content.items.find(i => i.id === id), step = event.shiftKey ? 5 : 1;
      mutate(() => { if (item.zone) resizeShape(id, item.zone.width + (event.key === 'ArrowRight' ? 2 : event.key === 'ArrowLeft' ? -2 : 0) * step, item.zone.height + (event.key === 'ArrowDown' ? 2 : event.key === 'ArrowUp' ? -2 : 0) * step); else resizeGoal(id, (item.scale || 1) + (['ArrowRight', 'ArrowDown'].includes(event.key) ? .1 : -.1) * step); });
      board.querySelector('[data-size-resize][role="button"]')?.focus(); return;
    }
    if (event.key === 'Escape' && pointer?.resizeItem) { event.preventDefault(); event.stopPropagation(); const id = pointer.id; endPointer({ type: 'pointercancel' }); if (board.hasPointerCapture(id)) board.releasePointerCapture(id); board.querySelector('[data-size-resize][role="button"]')?.focus(); return; }
    const facingHandle = event.target.closest('[data-facing-handle]');
    if (facingHandle && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); setFacing((playerPosition()?.facing || 0) + (['ArrowLeft', 'ArrowDown'].includes(event.key) ? -15 : 15)); board.querySelector('[data-facing-handle][role="slider"]')?.focus(); return; }
    const arrowTarget=event.target.closest('[data-tactics-arrow]'), arrowEnd=event.target.closest('[data-arrow-end]');
    if (arrowTarget && ['Enter',' '].includes(event.key)) { event.preventDefault(); selectPiece('');selectedArrow=arrowTarget.dataset.tacticsArrow;render();board.focus();return; }
    const arrowDirections={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if (selectedArrow && arrowDirections[event.key]) {
      event.preventDefault(); const end=arrowEnd?.dataset.arrowEnd, [dx,dy]=cameraDelta(arrowDirections[event.key]);
      mutate(()=>{const arrow=currentFrame().arrows.find(item=>item.id===selectedArrow);if(!arrow)return;if(!end)translateArrow(arrow,clone(arrow),dx,dy);else{const key=end==='start'?'1':'2';arrow['x'+key]=clamp(arrow['x'+key]+dx);arrow['y'+key]=clamp(arrow['y'+key]+dy);}});
      (end?board.querySelector('[data-tactics-arrow="'+selectedArrow+'"] [data-arrow-end="'+end+'"]'):board)?.focus();return;
    }
    if (editMode==='arrow' && event.key==='Enter' && event.target===board && !selectedArrow) {
      event.preventDefault(); if((currentFrame().arrows?.length||0)>=24)return tell('Use up to 24 drawn arrows per phase.',true);
      mutate(()=>{selectPiece('');selectedArrow=uid('arrow_');const {unitX,unitY}=pitchGeometry(),start=cameraPoint({x:viewCenter.x-100/zoom,y:viewCenter.y}),end=cameraPoint({x:viewCenter.x+100/zoom,y:viewCenter.y});currentFrame().arrows||=[];currentFrame().arrows.push({id:selectedArrow,x1:clamp(start.x/unitX),y1:clamp(start.y/unitY),x2:clamp(end.x/unitX),y2:clamp(end.y/unitY),color:'charcoal'});},'Arrow added. Use arrow keys to move it, or drag either end.');board.focus();return;
    }
    const target = event.target.closest('[data-tactics-item]');
    if (target && ['Enter', ' '].includes(event.key)) { event.preventDefault(); selectPiece(target.dataset.tacticsItem, event.shiftKey); render(); board.focus(); return; }
    const handle = event.target.closest('[data-route-handle]');
    const directions = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (handle && directions[event.key]) { event.preventDefault(); const index = Number(handle.dataset.routeHandle), p = routeHandles(shownTransition())[index], [dx, dy] = cameraDelta(directions[event.key]); mutate(() => updateRouteHandle(index, { x: clamp(p.x + dx), y: clamp(p.y + dy) })); board.querySelector('[data-route-handle=\"' + index + '\"]')?.focus(); return; }
    if (directions[event.key] && (selectedItem || target)) { event.preventDefault(); if (target) selectedItem = target.dataset.tacticsItem; const [x, y] = cameraDelta(directions[event.key]); moveSelected(x * (event.shiftKey ? 5 : 1), y * (event.shiftKey ? 5 : 1)); board.focus(); }
  });
  mount.addEventListener('keydown', event => {
    if (!editable() || event.target.closest('input,textarea,select,[contenteditable=true]')) return;
    let control;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') control = event.shiftKey ? 'tactics-redo' : 'tactics-undo';
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') control = 'tactics-redo';
    else if (event.key === 'Delete' && selectedArrow) control = 'tactics-remove-arrow';
    else if (event.key === 'Delete' && selectedItem) control = 'tactics-remove-item';
    else if (event.key === 'Escape' && (selectedArrow || editMode === 'arrow')) { event.preventDefault();event.stopPropagation();selectedArrow='';editMode='place';render();board.focus();return; }
    else if (event.key === 'Escape' && selectedItem) { event.preventDefault(); event.stopPropagation(); selectPiece(''); render(); board.focus(); return; }
    if (control) { event.preventDefault(); $(control).click(); board.focus(); }
  });
  function renderPlayback() {
    if (!$('tactics-play')) return;
    $('tactics-play').textContent = running ? 'Pause movement' : elapsed ? 'Resume movement' : 'Play movement';
    $('tactics-play').setAttribute('aria-label', $('tactics-play').textContent); $('tactics-play').title = $('tactics-play').textContent;
    phaseToggle.textContent = 'Phase ' + (frameIndex + 1) + ' / ' + record.content.frames.length + ' ▾'; phaseToggle.title = currentFrame().title;
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
  function load() { if (pending) return currentLoad; currentLoad = loadSession(); return currentLoad; }
  async function loadSession() {
    if (!active() || pending || context.busy || !$('tactics-disclosure')?.open) return;
    const ticket = ++requestEpoch, sessionId = context.session.id, startedIdentity = identity, wasLoaded = loaded;
    pending = true; loadAttempted = true; tell('Loading this session’s setups…'); render();
    try {
      const result = await request('list', { sessionId }); if (ticket !== requestEpoch || identity !== startedIdentity) return;
      if (!Array.isArray(result.diagrams) || result.diagrams.some(d => d.session_id !== sessionId)) throw Error('The saved setups could not be verified for this session.');
      diagrams = result.diagrams; loaded = true;
      if (recoveryNeeded && lastAttempt) {
        const matches = diagrams.filter(d => (!lastAttempt.id || d.id === lastAttempt.id) && d.version === lastAttempt.expectedVersion + 1 && d.title === lastAttempt.title && encode(d.content) === encode(lastAttempt.content));
        if (matches.length === 1) { const draftMatches = record.title.trim() === lastAttempt.title && encode(record.content) === encode(lastAttempt.content); if (draftMatches) { clear(matches[0]); tell('Your earlier save was found and verified.'); } else { record.id = matches[0].id; record.version = matches[0].version; baseline = encode({ title: matches[0].title, content: matches[0].content }); recoveryNeeded = false; lastAttempt = null; tell('Your earlier save was found. Your newer edits remain unsaved.'); } }
        else if (matches.length > 1) { tell('More than one matching setup exists. Open the saved setup you want before making further changes.', true); }
        else { recoveryNeeded = false; lastAttempt = null; tell('Saved setups refreshed. Review the list before saving your retained draft.'); }
      } else tell(diagrams.length ? 'Saved setups refreshed. Open the latest saved version to replace your draft.' : 'No saved setups yet. Add pieces or try the passing triangle.');
    }
    catch (error) { if (ticket !== requestEpoch || identity !== startedIdentity) return; loaded = wasLoaded; tell(error.message || 'Setups could not load. Your current diagram is still here. Try Refresh saved setups again.', true); }
    finally { if (ticket === requestEpoch && identity === startedIdentity) { pending = false; render(); } }
  }
  async function save() {
    if (libraryBinding) { if (!librarySaveBlocked) libraryBinding.onSave?.(); return; }
    if (!editable() || recoveryNeeded || !record.title.trim()) return;
    stopPlayback(); const ticket = requestEpoch, startedIdentity = identity, payload = { id: record.id, sessionId: context.session.id, title: record.title.trim(), content: clone(record.content), expectedVersion: record.version };
    pending = true; lastAttempt = clone(payload); tell('Saving setup…'); render();
    try { const result = await request('save', payload); if (ticket !== requestEpoch || identity !== startedIdentity) return; const saved = result.diagram; if (!saved?.id || !saved.content || saved.session_id !== payload.sessionId || saved.version !== payload.expectedVersion + 1 || payload.id && payload.id !== saved.id || saved.title !== payload.title || encode(saved.content) !== encode(payload.content)) throw Error('The save could not be verified. Your changes are still here.'); diagrams = [saved, ...diagrams.filter(d => d.id !== saved.id)]; record = clone(saved); baseline = snapshot(); undo = []; redo = []; lastAttempt = null; recoveryNeeded = false; tell('Setup saved to this session.'); notifyDraft(); }
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
    if (libraryBinding && (next?.tab !== 'library' || next?.profile?.email !== context?.profile?.email || next?.profile?.sessionVersion !== context?.profile?.sessionVersion || next?.profile?.role !== context?.profile?.role)) closeLibrary();
    if (libraryBinding) { context = next; if (next.busy) stopPlayback(); render(); return; }
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
