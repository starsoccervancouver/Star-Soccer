/* Standalone drill editing regression. Fictional data and intercepted local assets only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const origin = 'https://builder.example.test';
  const profile = { email: 'builder@example.test', name: 'Fictional Builder', role: 'owner', sessionVersion: 1 };
  const standalone = { profile, tab: 'library', session: null, selected: '', sessions: [], notes: [], busy: false, planReady: false };
  const assets = {};
  const sheets = ['workspace', 'workspace-session', 'workspace-tactics', 'workspace-library'];
  for (const name of sheets) assets['/' + name + '.css'] = { type: 'text/css', body: fs.readFileSync('private-attendance/web/' + name + '.css', 'utf8') };
  for (const name of ['workspace-tactics', 'workspace-library']) assets['/' + name + '.js'] = { type: 'text/javascript', body: fs.readFileSync('private-attendance/web/' + name + '.js', 'utf8') };
  for (const [name, file] of [['manrope', 'manrope-normal-latin'], ['instrument-serif', 'instrument-serif-italic-latin']]) assets['/workspace/assets/' + name + '.woff2'] = { type: 'font/woff2', body: fs.readFileSync('fonts/' + file + '.woff2') };
  assets['/workspace'] = { type: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + sheets.map(name => '<link rel="stylesheet" href="/' + name + '.css">').join('') + '<script defer src="/workspace-tactics.js"></script><script defer src="/workspace-library.js"></script></head><body><main style="max-width:1200px;margin:auto"><section id="session-home"><details id="tactics-disclosure"><summary>Tactics</summary><section id="tactics-board-tools"></section></details><section id="coach-drill-library"></section></section><section id="standalone-drill-library"></section></main></body></html>' };
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
    await context.addInitScript(profile => {
      window.CoachClub = { name: 'Fictional Club', timeZone: 'America/Vancouver' };
      window.confirm = () => true;
      window.builderCalls = []; window.builderRecords = []; window.builderTacticsCalls = [];
      window.addEventListener('coach:library-request', event => {
        const { operation, payload, resolve, reject } = event.detail;
        builderCalls.push({ operation, payload: structuredClone(payload) });
        if (operation === 'list') return resolve({ drills: structuredClone(builderRecords) });
        if (operation !== 'save') return reject(new Error('Unexpected fictional operation: ' + operation));
        const drill = { ...structuredClone(payload), id: payload.id || 'fictional-drill-1', version: payload.expectedVersion + 1, request_id: payload.requestId || builderRecords[0]?.request_id, author_email: profile.email, updated_by: profile.email, created_at: '2026-10-30T18:00:00Z', updated_at: '2026-10-30T18:00:00Z' };
        builderRecords = [drill, ...builderRecords.filter(row => row.id !== drill.id)]; resolve({ drill: structuredClone(drill) });
      });
      window.addEventListener('coach:tactics-request', event => {
        builderTacticsCalls.push(event.detail.operation);
        if (event.detail.operation === 'list') setTimeout(() => event.detail.resolve({ diagrams: [] }), 30);
        else event.detail.reject(new Error('Standalone drill must use its unified save'));
      });
    }, profile);
    const networkErrors = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url()), asset = assets[url.pathname];
      if (url.origin !== origin || !asset) { networkErrors.push(url.href); return route.abort(); }
      return route.fulfill({ status: 200, contentType: asset.type, body: asset.body });
    });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message));
    const publish = value => page.evaluate(detail => window.dispatchEvent(new CustomEvent('coach:context', { detail })), value);
    const reveal = async selector => { const closed = page.locator(selector).locator('xpath=ancestor::details[not(@open)]'); while (await closed.count()) await closed.first().locator(':scope > summary').click(); };
    const fill = async (selector, value) => { await reveal(selector); await page.locator(selector).fill(value); await page.locator(selector).dispatchEvent('change'); };
    const save = async () => {
      const previous = await page.evaluate(() => builderCalls.filter(row => row.operation === 'save').length);
      await page.locator('#library-save').click();
      await page.waitForFunction(previous => builderCalls.filter(row => row.operation === 'save').length === previous + 1 && !CoachLibrary.isBusy(), previous);
      assert.equal(await page.evaluate(() => CoachLibrary.isDirty()), false, 'Verified save establishes a clean combined draft');
      assert.doesNotMatch(await page.locator('#tactics-status').textContent(), /Unsaved changes/, 'Canvas shares the saved drill status');
      assert.equal(await page.locator('.library-editor-header #library-status').count(), 1, 'Save feedback stays with the primary action');
      return page.evaluate(() => builderCalls.filter(row => row.operation === 'save').at(-1).payload);
    };
    await page.goto(origin + '/workspace'); await publish(standalone);
    await page.waitForFunction(() => !document.getElementById('library-new').disabled);
    assert.equal(await page.locator('#library-form').isVisible(), false, 'Initial library view does not open a blank editor');
    assert.equal(await page.locator('#library-diagram-editor #tactics-pitch-board').count(), 0);
    await page.locator('#library-new').click();
    await page.locator('#library-diagram-editor #tactics-pitch-board').waitFor();
    assert.equal(await page.locator('#library-drill-details').evaluate(n => n.open), false);
    const initialLayout = await page.evaluate(() => ({ fieldTop: document.getElementById('tactics-pitch-board').getBoundingClientRect().top, detailsTop: document.getElementById('library-drill-details').getBoundingClientRect().top }));
    assert(initialLayout.fieldTop < 550, 'New drill opens directly on the builder');
    assert(initialLayout.detailsTop > initialLayout.fieldTop, 'Written details are below the builder');
    assert.equal(await page.locator('#tactics-equipment').evaluate(n => n.open), false);
    assert.equal(await page.locator('#tactics-save').isVisible(), false, 'One visible Save drill action');
    assert.equal(await page.locator('.tactics-edit-history #tactics-undo,.tactics-edit-history #tactics-redo').count(), 2, 'Undo and redo stay beside field editing');
    assert.equal(await page.locator('.tactics-sequence-actions #tactics-play,.tactics-sequence-actions #tactics-reset,.tactics-sequence-actions #tactics-add-frame').count(), 3, 'Playback and phase creation share the sequence controls');
    assert.equal(await page.locator('.tactics-inspector #tactics-add-frame').count(), 0, 'No duplicate phase creation in the inspector');
    assert.equal(await page.locator('.library-editor-header > #library-cancel').count(), 1, 'Back is separate from the save actions');
    for (const width of [390, 1280]) {
      await page.setViewportSize({ width, height: 844 }); await page.locator('#library-new').click();
      assert(await page.locator('#tactics-pitch-board').evaluate(n => n.getBoundingClientRect().top < 600), 'New drill shows the field near the top at ' + width + 'px');
      assert(await page.getByLabel('Field view', { exact: true }).isVisible());
      assert(await page.locator('#tactics-add-frame').isVisible(), 'Next phase remains available for a blank drill');
      const header = await page.evaluate(() => { const back = document.getElementById('library-cancel').getBoundingClientRect(), save = document.getElementById('library-save').getBoundingClientRect(); return { back:back.x, save:save.x }; });
      assert(header.back < header.save, 'Back is left of Save at ' + width + 'px');
    }
    await fill('#library-title', 'Fictional passing and finish');
    await fill('#library-setup', 'Pass through the gate and finish into the small goal.');
    await fill('#tactics-phase-notes', 'Starting cue before placing pieces.');
    assert.equal(await page.evaluate(() => CoachTactics.libraryDiagram().frames[0].notes), 'Starting cue before placing pieces.', 'Phase notes survive even before pieces are added');
    await fill('#tactics-phase-notes', '');
    for (const kind of ['home', 'away', 'ball', 'goal']) { await reveal('#tactics-add-' + kind); await page.locator('#tactics-add-' + kind).click(); }
    assert.equal(await page.getByLabel('Piece label', { exact: true }).count(), 1);
    assert(await page.getByLabel('Field view', { exact: true }).isVisible(), 'Field choice is visible without opening export settings');
    assert.equal(await page.locator('#tactics-pitch').evaluate(n => !!n.closest('.tactics-compact-details')), false);
    const positionsBeforeView = await page.evaluate(() => CoachTactics.libraryDiagram().frames[0].positions);
    for (const view of ['full', 'half', 'facing-goal', 'away-from-goal', 'blank']) {
      await page.locator('#tactics-pitch').selectOption(view);
      assert.equal(await page.locator('#tactics-pitch-board [data-field-view]').getAttribute('data-field-view'), view);
      assert.deepEqual(await page.evaluate(() => CoachTactics.libraryDiagram().frames[0].positions), positionsBeforeView, 'Changing the field preserves placed pieces');
      if (view.includes('goal')) assert.equal(await page.locator('#tactics-pitch-board [data-field-goal]').getAttribute('data-field-goal'), view === 'facing-goal' ? 'top' : 'bottom');
    }
    await page.locator('#tactics-pitch').selectOption('facing-goal');
    await fill('#tactics-rotation', '90');
    await page.locator('#tactics-add-frame').click();
    await fill('#tactics-frame-title', 'Finish');
    await fill('#tactics-phase-notes', 'Look up before the final pass.');
    assert.equal(await page.evaluate(() => CoachLibrary.isDirty()), true);
    const first = await save();
    assert.equal(first.title, 'Fictional passing and finish');
    assert.equal(first.setup, 'Pass through the gate and finish into the small goal.');
    assert.equal(first.diagram.schemaVersion, 1);
    assert.equal(first.diagram.pitch, 'facing-goal', 'Field orientation saves with the drill');
    assert.deepEqual(first.diagram.items.map(item => item.kind), ['home', 'away', 'ball', 'goal']);
    assert.equal(first.diagram.frames.length, 2);
    assert.equal(first.diagram.frames[1].notes, 'Look up before the final pass.');
    const goal = first.diagram.items.find(item => item.kind === 'goal');
    assert.equal(first.diagram.frames[0].positions.find(position => position.id === goal.id).rotation, 90);
    assert.equal(await page.locator('#library-form').isVisible(), true, 'Saved editor remains available');
    assert.equal(await page.locator('#tactics-frame-1').getAttribute('aria-pressed'), 'true', 'Save preserves the active phase');
    assert.deepEqual(await page.evaluate(() => builderTacticsCalls), [], 'Standalone editing never saves or loads session diagrams');

    await page.locator('#library-list').getByRole('button', { name: 'Edit drill', exact: true }).click();
    await page.locator('#tactics-frame-1').click();
    await fill('#tactics-phase-notes', 'Receive on the half turn, then finish.');
    const second = await save();
    assert.equal(second.id, 'fictional-drill-1'); assert.equal(second.expectedVersion, 1);
    assert.equal(second.diagram.frames[1].notes, 'Receive on the half turn, then finish.');
    assert.deepEqual(second.diagram.frames[0], first.diagram.frames[0], 'Editing later notes preserves starting positions');

    // Exercise actual pointer routes, possession and group editing on fictional pieces.
    const home = first.diagram.items.find(i => i.kind === 'home').id, away = first.diagram.items.find(i => i.kind === 'away').id, ball = first.diagram.items.find(i => i.kind === 'ball').id;
    const draft = () => page.evaluate(() => CoachTactics.libraryDiagram());
    const at = async (id, phase = 1) => (await draft()).frames[phase].positions.find(p => p.id === id);
    const screen = point => page.locator('#tactics-pitch-board').evaluate((board, point) => { const p = board.createSVGPoint(); p.x = point.x * 10; p.y = point.y * 6.5; const next = p.matrixTransform(board.getScreenCTM()); return { x: next.x, y: next.y }; }, point);
    const drag = async (start, points) => { await page.locator('#tactics-pitch-board').scrollIntoViewIfNeeded(); const p = await screen(start); await page.mouse.move(p.x, p.y); await page.mouse.down(); for (const point of points) { const q = await screen(point); await page.mouse.move(q.x, q.y, { steps: 6 }); } await page.mouse.up(); };
    await page.locator('#tactics-item').selectOption(home);
    assert.equal(await page.getByLabel('Shirt label', { exact: true }).count(), 1);
    await drag(await at(home), [{ x: 40, y: 25 }, { x: 60, y: 18 }, { x: 78, y: 34 }]);
    const recorded = await at(home); assert(recorded.trail?.length >= 2, 'Curved drag retains intermediate trajectory');
    assert.equal(await page.locator('[data-tactics-path="' + home + '"]').getAttribute('stroke'), '#355d79');
    assert(await page.locator('[data-route-handle]').count() > 0);
    const beforeHandle = await draft(), handle = await page.locator('[data-route-handle="0"]').boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 + 35, { steps: 5 }); await page.mouse.up();
    assert.notDeepEqual((await at(home)).trail, recorded.trail, 'Dragging route handle bends existing movement');
    await page.locator('#tactics-undo').click(); assert.deepEqual(await draft(), beforeHandle, 'Handle edit is a single undo');
    await page.locator('#tactics-mode-place').click(); const beforePlace = await draft();
    await drag(await at(home), [{ x: recorded.x - 8, y: recorded.y + 8 }]);
    const placed = await draft(); for (let phase = 0; phase < 2; phase++) { const before = beforePlace.frames[phase].positions.find(p => p.id === home), after = placed.frames[phase].positions.find(p => p.id === home); assert(Math.abs(after.x - before.x + 8) < .3); assert(Math.abs(after.y - before.y - 8) < .3); }
    assert.equal(placed.frames[1].positions.find(p => p.id === home).trail.length, recorded.trail.length, 'Placement shifts the layout without recording a new route');
    await page.locator('#tactics-undo').click(); assert.deepEqual(await draft(), beforePlace);
    await page.locator('#tactics-mode-record').click();
    await page.locator('#tactics-item').selectOption(away); await drag(await at(away), [{ x: 25, y: 65 }]);
    assert.equal(await page.locator('[data-tactics-path="' + away + '"]').getAttribute('stroke'), '#92651c');
    await page.locator('#tactics-item').selectOption(home);
    await page.locator('[data-tactics-item="' + away + '"]').click({ modifiers: ['Shift'] });
    assert.match(await page.locator('#tactics-selection-count').textContent(), /2 selected/);
    await page.locator('#tactics-item').selectOption(home);
    await reveal('#tactics-multiselect'); await page.locator('#tactics-multiselect').check();
    await page.locator('[data-tactics-item="' + away + '"]').click();
    await page.locator('#tactics-multiselect').uncheck();
    assert.match(await page.locator('#tactics-selection-count').textContent(), /2 selected/, 'Group selection also works without a Shift key');
    const beforeCopy = await draft(); await page.locator('#tactics-duplicate-item').click(); assert.equal((await draft()).items.length, beforeCopy.items.length + 2);
    await page.locator('#tactics-undo').click(); assert.deepEqual(await draft(), beforeCopy);
    await page.locator('#tactics-item').selectOption(ball); await drag(await at(ball), [await at(home)]);
    assert.equal((await at(ball)).attachedTo, home, 'Drop ball on player attaches possession');
    assert.equal(await page.locator('[data-possession="' + home + '"]').count(), 1);
    await drag(await at(ball), [{ x: 30, y: 85 }]); assert.equal((await at(ball)).attachedTo, undefined, 'Drag ball away releases possession');
    assert.equal(await page.locator('[data-tactics-path="' + ball + '"]').getAttribute('stroke'), '#303b42');
    const diagramBeforeView = await draft(), view = () => page.locator('#tactics-pitch-board').evaluate(n => { const v = n.viewBox.baseVal; return { x:v.x,y:v.y,width:v.width,height:v.height }; });
    assert(await page.locator('#tactics-zoom-out').isDisabled()); assert.equal(await page.locator('#tactics-zoom-fit').isVisible(), false);
    assert.equal(await page.locator('.tactics-pan-controls').isVisible(), false, 'No dead arrow controls when the whole field is visible');
    assert.equal(await page.locator('#tactics-zoom-value').textContent(), '100%');
    await page.locator('#tactics-zoom-in').click(); const zoomed = await view(); assert(zoomed.width < 1120);
    assert(await page.locator('.tactics-pan-controls').isVisible()); assert.equal(await page.locator('#tactics-zoom-value').textContent(), '125%');
    await page.locator('#tactics-pan-left').click(); assert((await view()).x < zoomed.x, 'Pan actually moves the visible field');
    for (let step = 0; step < 5; step++) await page.locator('#tactics-zoom-in').click();
    assert(await page.locator('#tactics-zoom-in').isDisabled()); assert.equal(await page.locator('#tactics-zoom-value').textContent(), '250%');
    for (const direction of ['left','up','right','down']) {
      const control = page.locator('#tactics-pan-' + direction); for (let step = 0; step < 20 && await control.isEnabled(); step++) await control.click();
      assert(await control.isDisabled(), direction + ' disables at the field edge'); const bounds = await view();
      assert(bounds.x >= -60.001 && bounds.y >= -60.001 && bounds.x + bounds.width <= 1060.001 && bounds.y + bounds.height <= 710.001, 'Panning stays inside the complete field view');
    }
    await page.locator('#tactics-zoom-out').click(); const wider = await view();
    assert(wider.x + wider.width <= 1060.001 && wider.y + wider.height <= 710.001, 'Zooming out reclamps a panned viewport');
    await page.locator('#tactics-zoom-fit').click(); assert.deepEqual(await view(), { x:-60,y:-60,width:1120,height:770 });
    assert(await page.locator('#tactics-zoom-out').isDisabled()); assert.equal(await page.locator('.tactics-pan-controls').isVisible(), false);
    assert.deepEqual(await draft(), diagramBeforeView, 'View controls never edit a drill or its recorded movement');
    await save();
    for (const selector of ['#library-drill-details', '.tactics-advanced', '#tactics-phase-options', '#tactics-playback-options']) { const details = page.locator(selector); if (await details.evaluate(n => n.open)) await details.locator(':scope > summary').click(); }
    fs.mkdirSync('outputs', { recursive: true });
    await page.locator('#library-form').screenshot({ path: 'outputs/coach-builder-simplified-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('#tactics-phase-notes').scrollIntoViewIfNeeded();
    const pinned = await page.locator('.library-editor-header').evaluate(el => { const r = el.getBoundingClientRect(), save = document.getElementById('library-save').getBoundingClientRect(); return {top:r.top,saveBottom:save.bottom,sticky:getComputedStyle(el).position}; });
    assert.equal(pinned.sticky, 'sticky'); assert(pinned.top >= 0 && pinned.saveBottom < 844, 'Save stays available while editing notes on mobile');
    await page.locator('#library-form').screenshot({ path: 'outputs/coach-builder-simplified-mobile.png' });
    await page.setViewportSize({ width: 1280, height: 1050 });

    const session = { id: 'rec00000000000001', status: 'Scheduled', players: [] };
    await publish({ ...standalone, tab: 'plan', session, selected: session.id, sessions: [session], planReady: true });
    assert.equal(await page.locator('#library-diagram-editor #tactics-pitch-board').count(), 0, 'Leaving library releases its editor');
    assert.equal(await page.locator('#tactics-disclosure #tactics-pitch-board').count(), 1, 'Session editor returns to its own mount');
    await publish(standalone);
    await page.locator('#library-list').getByRole('button', { name: 'Edit drill', exact: true }).click();
    await page.locator('#tactics-frame-1').click();
    assert.equal(await page.locator('#tactics-phase-notes').inputValue(), second.diagram.frames[1].notes);
    assert.deepEqual(await page.evaluate(() => CoachTactics.libraryDiagram()), await page.evaluate(() => builderRecords[0].diagram));
    assert.equal(await page.evaluate(() => CoachLibrary.isDirty()), false);
    assert.equal(await page.locator('#tactics-pitch').inputValue(), 'facing-goal', 'Reopened drill restores the field orientation');
    // Choosing a saved drill must wait for the selected session and never write a session automatically.
    await publish({ ...standalone, sessions: [session, { ...session, id: 'cancelled-session', status: 'Cancelled' }] });
    await page.evaluate(({ profile, session }) => {
      window.builderInsertions = [];
      window.addEventListener('coach:open-session', event => {
        document.getElementById('tactics-disclosure').open = true;
        window.dispatchEvent(new CustomEvent('coach:context', { detail: { profile, session, selected: session.id, sessions: [session], tab: 'plan', busy: false, planReady: false } }));
        event.detail.resolve(true);
        setTimeout(() => window.dispatchEvent(new CustomEvent('coach:context', { detail: { profile, session, selected: session.id, sessions: [session], tab: 'plan', busy: false, planReady: true } })), 10);
      });
      window.addEventListener('coach:insert-plan', event => {
        const value = event.detail;
        if (CoachTactics.useDraft({ sessionId: session.id, title: value.title, diagram: value.diagram })) { value.inserted = true; builderInsertions.push({ title: value.title, text: value.text, diagram: value.diagram }); }
      });
    }, { profile, session });
    await page.locator('#library-list').getByRole('button', { name: 'Use in session', exact: true }).click();
    assert.equal(await page.locator('#library-session-choice option[value="cancelled-session"]').count(), 0);
    await page.locator('#library-session-choice').selectOption(session.id);
    await page.locator('#library-open-session').click();
    await page.waitForFunction(() => builderInsertions.length === 1);
    assert.equal(await page.evaluate(() => builderInsertions[0].title), first.title);
    assert.match(await page.evaluate(() => builderInsertions[0].text), /Pass through the gate/);
    assert.deepEqual(await page.evaluate(() => CoachTactics.getDraft().diagram), await page.evaluate(() => builderRecords[0].diagram));
    assert(await page.evaluate(() => CoachTactics.isDirty()), 'Using a drill creates a reviewable session draft');
    assert((await page.evaluate(() => builderTacticsCalls)).every(operation => operation === 'list'), 'Use in session makes no automatic writes');
    assert.deepEqual(errors, []); assert.deepEqual(networkErrors, []);
    await context.close();
    console.log('Drill workspace: unified saves, editable routes, place/record modes, mouse/touch group selection, duplication, possession, rotation, zoom, session insertion and draft safety passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
