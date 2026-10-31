/* Focused creator tools. Only fictional records and intercepted local assets are used. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const origin = 'https://drill-tools.example.test';
  const profile = { email: 'tools@example.test', name: 'Fictional Tools Coach', role: 'owner', sessionVersion: 1 };
  const fixture = { profile, tab: 'library', session: null, selected: '', sessions: [], notes: [], busy: false, planReady: false };
  const assets = {};
  const styles = ['workspace', 'workspace-session', 'workspace-tactics', 'workspace-library'];
  for (const name of styles) assets['/' + name + '.css'] = { type: 'text/css', body: fs.readFileSync('private-attendance/web/' + name + '.css', 'utf8') };
  for (const name of ['workspace-tactics', 'workspace-library']) assets['/' + name + '.js'] = { type: 'text/javascript', body: fs.readFileSync('private-attendance/web/' + name + '.js', 'utf8') };
  for (const [name, file] of [['manrope', 'manrope-normal-latin'], ['instrument-serif', 'instrument-serif-italic-latin']]) assets['/workspace/assets/' + name + '.woff2'] = { type: 'font/woff2', body: fs.readFileSync('fonts/' + file + '.woff2') };
  assets['/workspace'] = { type: 'text/html', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + styles.map(name => '<link rel="stylesheet" href="/' + name + '.css">').join('') + '<script defer src="/workspace-tactics.js"></script><script defer src="/workspace-library.js"></script></head><body><main><section><details id="tactics-disclosure"><summary>Tactics</summary><section id="tactics-board-tools"></section></details><section id="coach-drill-library"></section></section><section id="standalone-drill-library"></section></main></body></html>' };
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, hasTouch: true });
    await context.addInitScript(profile => {
      window.CoachClub = { name: 'Fictional Club', timeZone: 'America/Vancouver' };
      window.confirm = () => true;
      window.toolCalls = []; window.toolRecords = [];
      window.addEventListener('coach:library-request', event => {
        const { operation, payload, resolve, reject } = event.detail;
        toolCalls.push({ operation, payload: structuredClone(payload) });
        if (operation === 'list') return resolve({ drills: structuredClone(toolRecords) });
        if (operation !== 'save') return reject(new Error('Unexpected fictional operation: ' + operation));
        const drill = { ...structuredClone(payload), id: payload.id || 'fictional-tool-drill', version: payload.expectedVersion + 1, request_id: payload.requestId || toolRecords[0]?.request_id, author_email: profile.email, updated_by: profile.email, created_at: '2026-10-30T18:00:00Z', updated_at: '2026-10-30T18:00:00Z' };
        toolRecords = [drill]; resolve({ drill: structuredClone(drill) });
      });
      window.addEventListener('coach:tactics-request', event => event.detail.reject(new Error('Standalone tools must use the combined drill save')));
    }, profile);
    const networkErrors = [], errors = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url()), asset = assets[url.pathname];
      if (url.origin !== origin || !asset) { networkErrors.push(url.href); return route.abort(); }
      return route.fulfill({ status: 200, contentType: asset.type, body: asset.body });
    });
    const page = await context.newPage(); page.setDefaultTimeout(7000);
    page.on('pageerror', error => errors.push(error.message));
    const draft = () => page.evaluate(() => CoachTactics.libraryDiagram());
    const reveal = async selector => { const closed = page.locator(selector).locator('xpath=ancestor::details[not(@open)]'); while (await closed.count()) await closed.first().locator(':scope > summary').click(); };
    const screen = point => page.locator('#tactics-pitch-board').evaluate((board, point) => { const p = board.createSVGPoint(); p.x = point.x * 10; p.y = point.y * 6.5; const s = p.matrixTransform(board.getScreenCTM()); return { x: s.x, y: s.y }; }, point);
    const drag = async (from, to) => {
      await page.locator('#tactics-pitch-board').scrollIntoViewIfNeeded();
      const a = await screen(from), b = await screen(to);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
    };
    const draw = async (from, to) => {
      if (await page.locator('#tactics-draw-arrow').getAttribute('aria-pressed') !== 'true') await page.locator('#tactics-draw-arrow').click();
      await drag(from, to);
      if (await page.locator('#tactics-draw-arrow').getAttribute('aria-pressed') === 'true') await page.locator('#tactics-draw-arrow').click();
    };
    const closeTo = (actual, expected, message) => assert(Math.abs(actual - expected) < .35, message + ': ' + actual);
    const arrow = async (phase = 0) => (await draft()).frames[phase].arrows?.[0];

    await page.goto(origin + '/workspace');
    await page.evaluate(detail => window.dispatchEvent(new CustomEvent('coach:context', { detail })), fixture);
    await page.waitForFunction(() => !document.getElementById('library-new').disabled);
    await page.locator('#library-new').click();
    assert.equal(await draft(), null);
    assert.equal(await page.locator('#tactics-add-home,#tactics-add-away').count(), 0, 'The toolbar has one player tool instead of team-specific buttons');

    // A drawn arrow is useful even before players are placed, and must count as draft content.
    await draw({ x: 15, y: 20 }, { x: 70, y: 20 });
    const originalArrow = await arrow();
    assert(originalArrow?.id, 'Dragging creates a persisted arrow');
    assert.equal(originalArrow.color, 'charcoal');
    closeTo(originalArrow.x1, 15, 'Arrow begins at the chosen field point'); closeTo(originalArrow.y1, 20, 'Arrow start y');
    closeTo(originalArrow.x2, 70, 'Arrow ends at the chosen field point'); closeTo(originalArrow.y2, 20, 'Arrow end y');
    assert.equal((await draft()).items.length, 0, 'Arrows are independent of player routes');
    assert(await page.locator('[data-tactics-arrow="' + originalArrow.id + '"]').count());
    assert.equal(await page.evaluate(() => CoachLibrary.isDirty()), true, 'An arrow-only drill is dirty');
    await page.locator('#tactics-undo').click(); assert.equal(await draft(), null, 'Undo removes the initial arrow');
    await page.locator('#tactics-redo').click(); assert.deepEqual(await arrow(), originalArrow, 'Redo restores the exact arrow');

    // Browser-generated touch cancellation must discard both an unfinished tap and a dragged arrow.
    const beforeCancel = await draft(), touch = await context.newCDPSession(page);
    await page.locator('#tactics-draw-arrow').click(); await page.locator('#tactics-pitch-board').scrollIntoViewIfNeeded();
    const touchStart = await screen({ x: 10, y: 65 }), touchEnd = await screen({ x: 90, y: 65 });
    for (const moved of [false, true]) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...touchStart, id: 1 }] });
      if (moved) {
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...touchEnd, id: 1 }] });
        assert.equal((await draft()).frames[0].arrows.length, 2, 'The touch drag has created a pending arrow before cancellation');
      }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      assert.deepEqual(await draft(), beforeCancel, (moved ? 'Cancelled touch drag' : 'Cancelled touch tap') + ' restores the full previous diagram');
      assert.equal(await page.locator('#tactics-pitch-board [data-tactics-arrow]').count(), 1, 'Cancellation leaves no zero-length or unfinished arrow on the field');
    }
    await touch.detach();
    await page.locator('#tactics-undo').click(); assert.equal(await draft(), null, 'Cancelled touch gestures do not consume an undo step');
    await page.locator('#tactics-redo').click(); assert.deepEqual(await draft(), beforeCancel);

    // Keyboard users can add, delete and recover an arrow without pointer interaction.
    await page.locator('#tactics-pitch-board').focus(); await page.keyboard.press('Enter');
    const keyboardDraft = await draft(), keyboardArrow = keyboardDraft.frames[0].arrows.at(-1);
    assert.equal(keyboardDraft.frames[0].arrows.length, 2, 'Enter adds an arrow when the drawing tool is active');
    assert.notEqual(keyboardArrow.id, originalArrow.id);
    assert(Math.hypot(keyboardArrow.x2 - keyboardArrow.x1, keyboardArrow.y2 - keyboardArrow.y1) > 0, 'Keyboard-created arrow has a visible length');
    await page.keyboard.press('Delete'); assert.deepEqual(await draft(), beforeCancel, 'Delete removes the selected keyboard arrow');
    await page.keyboard.press('Control+z'); assert.deepEqual(await draft(), keyboardDraft, 'Keyboard undo restores the deleted arrow');
    await page.keyboard.press('Control+z'); assert.deepEqual(await draft(), beforeCancel, 'A second undo removes the keyboard creation');
    await page.locator('#tactics-draw-arrow').click();

    // Select the shaft, then drag an endpoint and move the whole arrow.
    const middle = await screen({ x: 42.5, y: 20 }); await page.mouse.click(middle.x, middle.y);
    assert.equal(await page.locator('[data-arrow-end]').count(), 2, 'Selected arrows expose two endpoint handles');
    await drag({ x: 70, y: 20 }, { x: 78, y: 29 });
    const editedArrow = await arrow(); closeTo(editedArrow.x2, 78, 'Endpoint edit changes arrow end'); closeTo(editedArrow.y2, 29, 'Endpoint edit changes arrow angle');
    assert.equal(editedArrow.x1, originalArrow.x1); assert.equal(editedArrow.y1, originalArrow.y1);
    await page.locator('#tactics-undo').click(); assert.deepEqual(await arrow(), originalArrow, 'Endpoint edit is one undo');
    await page.locator('#tactics-redo').click(); assert.deepEqual(await arrow(), editedArrow);
    await drag({ x: (editedArrow.x1 + editedArrow.x2) / 2, y: (editedArrow.y1 + editedArrow.y2) / 2 }, { x: (editedArrow.x1 + editedArrow.x2) / 2 + 6, y: (editedArrow.y1 + editedArrow.y2) / 2 + 8 });
    const movedArrow = await arrow(); closeTo(movedArrow.x1 - editedArrow.x1, 6, 'Moving an arrow translates its start'); closeTo(movedArrow.x2 - editedArrow.x2, 6, 'Moving an arrow translates its end'); closeTo(movedArrow.y1 - editedArrow.y1, 8, 'Moving an arrow translates vertically');
    await page.locator('#tactics-remove-arrow').click(); assert.equal((await draft())?.frames[0].arrows?.length || 0, 0, 'Selected arrow can be deleted');
    await page.locator('#tactics-undo').click(); assert.deepEqual(await arrow(), movedArrow, 'Delete is undoable');
    await page.locator('#tactics-redo').click(); assert.equal((await draft())?.frames[0].arrows?.length || 0, 0);
    await page.locator('#tactics-undo').click();

    // The first player asks for a colour. Further clicks repeat it; New colour changes it.
    assert.equal(await page.locator('#tactics-player-colors').isVisible(), false);
    await page.locator('#tactics-add-player').click();
    assert(await page.locator('#tactics-player-colors').isVisible());
    const palette = ['blue', 'gold', 'red', 'green', 'purple', 'white'];
    assert.deepEqual(await page.locator('[data-player-color]').evaluateAll(nodes => nodes.map(n => n.dataset.playerColor)), palette, 'Exactly six player colours are offered');
    assert.equal((await draft()).items.length, 0, 'Opening the palette does not add a player');
    await page.locator('[data-player-color="blue"]').click();
    assert.equal((await draft()).items.length, 1); assert.equal((await draft()).items[0].color, 'blue');
    assert.equal(await page.locator('#tactics-player-colors').isVisible(), false, 'Choosing a colour closes the palette');
    await page.locator('#tactics-add-player').click();
    assert.deepEqual((await draft()).items.map(i => i.color), ['blue', 'blue'], 'Add player remembers the current colour');
    assert.equal(await page.locator('#tactics-player-colors').isVisible(), false);
    for (const color of palette.slice(1)) { await page.locator('#tactics-new-player').click(); await page.locator('[data-player-color="' + color + '"]').click(); }
    assert.deepEqual((await draft()).items.map(i => i.color), ['blue', ...palette], 'Each swatch adds a player of the chosen colour');
    const shirts = await page.locator('#tactics-pitch-board [data-tactics-item] [data-symbol] path:first-child').evaluateAll(nodes => nodes.map(n => n.getAttribute('fill')));
    assert.equal(new Set(shirts).size, 6, 'All six colours render as distinct shirts on the field');
    await page.locator('#tactics-add-player').click(); assert.equal((await draft()).items.at(-1).color, 'white', 'The latest colour is remembered');
    const firstPlayer = (await draft()).items[0].id;
    await page.locator('#tactics-item').selectOption(firstPlayer); await reveal('#tactics-player-color'); await page.locator('#tactics-player-color').selectOption('red');
    assert.equal((await draft()).items.find(i => i.id === firstPlayer).color, 'red', 'An existing player can change colour');
    await page.locator('#tactics-undo').click(); assert.equal((await draft()).items.find(i => i.id === firstPlayer).color, 'blue', 'Colour changes are undoable');
    await page.locator('#tactics-redo').click(); assert.equal((await draft()).items.find(i => i.id === firstPlayer).color, 'red');
    const beforeArrow = await draft();
    await draw({ x: 15, y: 80 }, { x: 75, y: 80 });
    assert.equal((await draft()).frames[0].arrows.length, 2);
    assert.deepEqual((await draft()).frames[0].positions, beforeArrow.frames[0].positions, 'Drawing an arrow never moves the selected player');

    await reveal('#library-title'); await page.locator('#library-title').fill('Fictional six-colour drill'); await page.locator('#library-title').dispatchEvent('change');
    await reveal('#library-setup'); await page.locator('#library-setup').fill('Pass between players and follow the drawn arrows.'); await page.locator('#library-setup').dispatchEvent('change');
    await page.locator('#library-drill-details > summary').click();
    const playerIds = (await draft()).items.map(item => item.id);
    for (const [index, id] of playerIds.entries()) {
      await page.locator('#tactics-item').selectOption(id);
      await drag((await draft()).frames[0].positions.find(p => p.id === id), { x: 22 + index % 4 * 18, y: index < 4 ? 47 : 64 });
    }
    for (const [kind, point] of [['ball', {x:30,y:48}], ['cone', {x:45,y:75}], ['goal', {x:90,y:62}]]) {
      await reveal('#tactics-add-' + kind); await page.locator('#tactics-add-' + kind).click();
      const id = (await draft()).items.at(-1).id; await drag((await draft()).frames[0].positions.find(p => p.id === id), point);
    }
    fs.mkdirSync('outputs', { recursive: true });
    for (const [name, viewport] of [['desktop', {width:1280,height:800}], ['mobile', {width:390,height:844}]]) {
      await page.setViewportSize(viewport); await page.locator('#library-form').evaluate(el => el.scrollTop = 0);
      await page.screenshot({ path: 'outputs/drill-creator-' + name + '.png' });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const beforeSave = await draft();
    await page.locator('#library-save').click();
    await page.waitForFunction(() => !CoachLibrary.isBusy() && !CoachLibrary.isDirty());
    const saved = await page.evaluate(() => toolCalls.filter(c => c.operation === 'save').at(-1).payload.diagram);
    assert.deepEqual(saved, beforeSave, 'One drill save contains every colour and drawn arrow');
    const { validateDiagram } = await import('../private-attendance/tactics-validation.mjs');
    assert.deepEqual(validateDiagram(saved), saved, 'The persisted tools pass production validation unchanged');
    await page.locator('#library-cancel').click(); await page.locator('#library-list').getByRole('button', { name: 'Edit drill', exact: true }).click();
    assert.deepEqual(await draft(), saved, 'Reopening restores colours and arrows exactly');
    assert.equal(await page.locator('[data-tactics-arrow]').count() >= 2, true, 'Saved arrows render when reopened');
    await page.locator('#library-form').screenshot({ path: 'outputs/coach-drill-tools-desktop.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Focused creator fits a phone');
    await page.locator('#tactics-new-player').click();
    assert(await page.locator('[data-player-color="white"]').isVisible(), 'All colours remain available on a phone');
    await page.locator('#library-form').screenshot({ path: 'outputs/coach-drill-tools-mobile.png' });
    assert.deepEqual(errors, []); assert.deepEqual(networkErrors, []);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, 'Private drill data remains out of browser storage');
    await context.close();
    console.log('Focused drill tools: six colours, remembered colour, recolouring, arrow drawing/editing/moving/deletion, touch cancellation, keyboard arrows, undo/redo and saved round-trip passed. Mock data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
