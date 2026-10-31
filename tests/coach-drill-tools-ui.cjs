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
    assert.equal(await page.locator('#tactics-new-player').isVisible(), false, 'An empty drill shows Add player without the unused New colour tool');
    assert.equal(await page.locator('#tactics-phase-popover').isVisible(), false, 'Movement phases start collapsed');
    assert.equal(await page.locator('#tactics-frames').isVisible(), false, 'Phase thumbnails are unavailable until the phase dropdown opens');
    assert.equal(await page.locator('#tactics-progress').isVisible(), false, 'The playback scrubber stays inside the closed phase dropdown');

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
    assert.equal(await page.locator('#tactics-new-player').isVisible(), false, 'Drawn arrows alone do not reveal New colour');
    await page.locator('#tactics-add-player').click();
    assert(await page.locator('#tactics-player-colors').isVisible());
    const palette = ['blue', 'gold', 'red', 'green', 'purple', 'white'];
    assert.deepEqual(await page.locator('[data-player-color]').evaluateAll(nodes => nodes.map(n => n.dataset.playerColor)), palette, 'Exactly six player colours are offered');
    assert.equal((await draft()).items.length, 0, 'Opening the palette does not add a player');
    const beforeFirstColour = await draft();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#tactics-player-colors').isVisible(), false, 'Escape closes the first colour palette');
    assert(await page.locator('#tactics-add-player').evaluate(el => el === document.activeElement), 'Escape returns focus to Add player when New colour is hidden');
    assert.deepEqual(await draft(), beforeFirstColour, 'Cancelling the first palette does not alter the diagram');
    await page.locator('#tactics-add-player').click();
    await page.locator('[data-player-color="blue"]').click();
    assert.equal((await draft()).items.length, 1); assert.equal((await draft()).items[0].color, 'blue');
    assert.equal(await page.locator('#tactics-player-colors').isVisible(), false, 'Choosing a colour closes the palette');
    assert(await page.locator('#tactics-new-player').isVisible(), 'New colour appears once the first player exists');
    const firstColourDraft = await draft(); await page.locator('#tactics-undo').click();
    assert.equal(await page.locator('#tactics-new-player').isVisible(), false, 'Undoing the only player hides New colour again');
    await page.locator('#tactics-redo').click(); assert.deepEqual(await draft(), firstColourDraft);
    assert(await page.locator('#tactics-new-player').isVisible(), 'Redo restores New colour with the player');
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
    const rect = selector => page.locator(selector).evaluate(el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height, right:r.right, bottom:r.bottom }; });
    const inViewport = async (selector, label) => {
      const r = await rect(selector), viewport = page.viewportSize();
      assert(r.width > 0 && r.height > 0 && r.x >= -.5 && r.y >= -.5 && r.right <= viewport.width + .5 && r.bottom <= viewport.height + .5, label + ' stays entirely inside ' + viewport.width + '×' + viewport.height + ': ' + JSON.stringify(r));
      return r;
    };
    const resetScroll = () => page.evaluate(() => { window.scrollTo(0, 0); for (const el of document.querySelectorAll('#library-form,.tactics-inspector')) el.scrollTop = 0; });
    const openPhases = async () => { if (!await page.locator('#tactics-phase-popover').isVisible()) await page.locator('#tactics-phases-toggle').click(); };
    // A real drill's phase dropdown must fit too, not just an empty one-phase board.
    for (let phase = 1; phase < 5; phase++) await page.locator('#tactics-add-frame').click();
    assert.equal(await page.locator('#tactics-phase-popover').isVisible(), false, 'Adding phases leaves the dropdown closed');
    const layoutDraft = await draft();
    const viewports = [{width:1280,height:800}, {width:1440,height:1000}, {width:1920,height:1080}, {width:1024,height:768}, {width:390,height:844}, {width:320,height:700}, {width:844,height:390}];
    for (const viewport of viewports) {
      const size = viewport.width + 'x' + viewport.height;
      await page.setViewportSize(viewport); await resetScroll();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No document horizontal overflow at ' + size);
      await inViewport('#library-cancel', 'Back'); await inViewport('#library-save', 'Save');
      assert.equal(await page.locator('#tactics-phase-popover').isVisible(), false, 'Phase dropdown remains closed at ' + size);
      assert.equal(await page.locator('#tactics-frames').isVisible(), false, 'Closed thumbnails stay unavailable at ' + size);
      assert.equal(await page.locator('#tactics-progress').isVisible(), false, 'Closed scrubber stays unavailable at ' + size);
      assert(await page.locator('#tactics-play').isVisible(), 'Play remains on the toolbar at ' + size);
      assert(await page.locator('#tactics-add-frame').isVisible(), 'Next phase remains on the toolbar at ' + size);
      if (viewport.width >= 1000) {
        const field = await inViewport('#tactics-pitch-board', 'The complete field');
        assert(field.width >= 500 && field.height >= 300, 'The normal desktop field remains a useful size at ' + size + ': ' + field.width + '×' + field.height);
        await inViewport('#tactics-phases-toggle', 'The phase dropdown toggle');
        await inViewport('#tactics-add-frame', 'Add phase');
        await inViewport('#tactics-play', 'Playback');
        assert((await rect('#tactics-item')).width >= 180, 'The desktop inspector keeps a readable full-width piece selector at ' + size);
        for (const selector of ['#tactics-purpose', '#tactics-pitch']) assert((await rect(selector)).width >= 100, 'Inspector view choices remain readable at ' + size + ': ' + selector);
      }
      for (const target of await page.locator('#library-form button:visible,#library-form summary:visible').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { name:el.id || el.textContent.trim(), width:r.width, height:r.height }; }))) {
        assert(target.width >= 43.5 && target.height >= 43.5, size + ': ' + target.name + ' keeps a 44px touch target (' + target.width + '×' + target.height + ')');
      }
      await page.locator('#tactics-new-player').click();
      for (const color of palette) await inViewport('[data-player-color="' + color + '"]', color + ' palette choice');
      for (const target of await page.locator('[data-player-color]').evaluateAll(elements => elements.map(el => { const r = el.getBoundingClientRect(); return { color:el.dataset.playerColor, width:r.width, height:r.height }; }))) {
        assert(target.width >= 43.5 && target.height >= 43.5, size + ': ' + target.color + ' swatch keeps a 44px touch target');
      }
      await page.locator('#tactics-new-player').click(); await resetScroll();
      const screenshot = 'outputs/drill-creator-' + size + '.png'; await page.screenshot({ path: screenshot });
      if (size === '1280x800') fs.copyFileSync(screenshot, 'outputs/drill-creator-desktop.png');
      if (size === '390x844') fs.copyFileSync(screenshot, 'outputs/drill-creator-mobile.png');

      await openPhases();
      assert.equal(await page.locator('#tactics-phases-toggle').getAttribute('aria-expanded'), 'true');
      await inViewport('#tactics-phase-popover', 'The open phase dropdown');
      assert(await page.locator('#tactics-frames').isVisible(), 'Opening the dropdown reveals phase thumbnails at ' + size);
      assert(await page.locator('#tactics-progress').isVisible(), 'Opening the dropdown reveals the scrubber at ' + size);
      await page.locator('#tactics-progress').scrollIntoViewIfNeeded(); await inViewport('#tactics-progress', 'The open playback scrubber');
      await page.locator('#tactics-phases-toggle').click();
      assert.equal(await page.locator('#tactics-phase-popover').isVisible(), false, 'The phase toggle closes its dropdown at ' + size);
      await openPhases(); await page.locator('#tactics-frame-0').click();
      assert.equal(await page.locator('#tactics-frame-0').getAttribute('aria-pressed'), 'true', 'The first thumbnail remains selectable in the dropdown');
      await openPhases(); await page.locator('#tactics-frame-4').click();
      assert.equal(await page.locator('#tactics-frame-4').getAttribute('aria-pressed'), 'true', 'The final thumbnail remains selectable in the dropdown');
      await openPhases(); await page.keyboard.press('Escape');
      assert.equal(await page.locator('#tactics-phase-popover').isVisible(), false, 'Escape closes the phase dropdown at ' + size);
      assert.equal(await page.locator('#tactics-phases-toggle').getAttribute('aria-expanded'), 'false');
      assert(await page.locator('#tactics-phases-toggle').evaluate(el => el === document.activeElement), 'Escape restores phase-toggle focus');
      assert.deepEqual(await draft(), layoutDraft, 'Opening, selecting and closing phases never changes the diagram at ' + size);
      await resetScroll();

      if (viewport.width >= 1000) {
        // The existing expandable controls and a resized notes field create a long inspector.
        const openedInspectorDetails = [];
        for (const selector of ['#tactics-phase-options', '.tactics-advanced']) {
          if (await page.locator(selector + ' > summary').isVisible() && !await page.locator(selector).evaluate(el => el.open)) { await page.locator(selector + ' > summary').click(); openedInspectorDetails.push(selector); }
        }
        const oldNotesStyle = await page.locator('#tactics-phase-notes').getAttribute('style');
        await page.locator('#tactics-phase-notes').evaluate(el => el.style.height = '700px');
        await resetScroll();
        const inspector = await inViewport('.tactics-inspector', 'The independent inspector');
        assert(await page.locator('.tactics-inspector').evaluate(el => el.scrollHeight > el.clientHeight + 20 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY)), 'Long inspector has its own scroll area at ' + size);
        const beforeScroll = await page.evaluate(() => ({ form:document.getElementById('library-form').scrollTop, document:document.scrollingElement.scrollTop, field:document.getElementById('tactics-pitch-board').getBoundingClientRect().top }));
        await page.mouse.move(inspector.right - 3, inspector.y + Math.min(100, inspector.height / 2)); await page.mouse.wheel(0, 600);
        await page.waitForFunction(() => document.querySelector('.tactics-inspector').scrollTop > 0);
        const afterScroll = await page.evaluate(() => ({ form:document.getElementById('library-form').scrollTop, document:document.scrollingElement.scrollTop, field:document.getElementById('tactics-pitch-board').getBoundingClientRect().top }));
        assert.deepEqual(afterScroll, beforeScroll, 'Scrolling the long inspector leaves the field and creator stationary at ' + size);
        await inViewport('#tactics-phases-toggle', 'Phases while the inspector scrolls');
        await page.locator('#tactics-phase-notes').evaluate((el, oldStyle) => { if (oldStyle === null) el.removeAttribute('style'); else el.setAttribute('style', oldStyle); }, oldNotesStyle);
        for (const selector of openedInspectorDetails) await page.locator(selector + ' > summary').click();
        await resetScroll();
      }

      // Written details remain reachable and editable after the space-saving layout closes them.
      await page.locator('#library-drill-details > summary').click(); await page.locator('#library-setup').click();
      const setup = await inViewport('#library-setup', 'The focused setup field'), header = await rect('.library-editor-header');
      assert(setup.y >= header.bottom - 1, 'The reopened setup field clears the sticky header at ' + size);
      assert(await page.locator('#library-setup').evaluate(el => document.activeElement === el), 'Reopened details can receive focus at ' + size);
      await inViewport('#library-cancel', 'Back with details open'); await inViewport('#library-save', 'Save with details open');
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Open details do not cause horizontal overflow at ' + size);
      await page.locator('#library-drill-details > summary').click(); await resetScroll();
    }
    assert.deepEqual(await draft(), layoutDraft, 'Viewport, palette, inspector and written-details checks never change the diagram');
    await page.setViewportSize({ width: 1440, height: 1000 });
    // A curved gesture retains intermediate points and moves as one annotation.
    const beforeCurve=await draft();
    await page.locator('#tactics-draw-arrow').click();
    assert.equal(await page.locator('#tactics-draw-arrow').getAttribute('aria-label'),'Draw curved arrow');
    await page.locator('#tactics-pitch-board').scrollIntoViewIfNeeded();
    const curveStart=await screen({x:15,y:35});await page.mouse.move(curveStart.x,curveStart.y);await page.mouse.down();
    for(const point of [{x:30,y:12},{x:50,y:10},{x:68,y:25},{x:78,y:38}]){const at=await screen(point);await page.mouse.move(at.x,at.y,{steps:6});}
    await page.mouse.up();await page.locator('#tactics-draw-arrow').click();
    const curved=(await draft()).frames[4].arrows.at(-1),curveId=curved.id;
    assert(curved.points?.length>1&&curved.points.length<=32,'Freehand gesture stores bounded intermediate points');
    const curveGroup=page.locator('[data-tactics-arrow="'+curveId+'"]'),curvePath=curveGroup.locator('path[stroke]:not([stroke="transparent"])');
    assert.match(await curvePath.getAttribute('d'),/ Q/,'Freehand route is visibly curved');
    assert.equal(await curveGroup.locator('polygon').count(),1,'Curve ends in an arrowhead');
    await page.locator('#tactics-undo').click();assert.deepEqual(await draft(),beforeCurve,'Entire freehand stroke is one undo');
    await page.locator('#tactics-redo').click();assert.deepEqual((await draft()).frames[4].arrows.at(-1),curved,'Redo restores the exact curve');
    const middleCurve=await curvePath.evaluate(path=>{const point=path.getPointAtLength(path.getTotalLength()/2);return {x:point.x/10,y:point.y/6.5};});
    await drag(middleCurve,{x:middleCurve.x+4,y:middleCurve.y+3});
    await page.locator('#tactics-pitch-board').focus();await page.keyboard.press('ArrowRight');
    const translatedCurve=(await draft()).frames[4].arrows.find(value=>value.id===curveId);
    closeTo(translatedCurve.x1-curved.x1,5,'Pointer and keyboard translate the curve start');closeTo(translatedCurve.y2-curved.y2,3,'Translation preserves curve end offset');
    assert.equal(translatedCurve.points.length,curved.points.length);
    translatedCurve.points.forEach((point,index)=>{closeTo(point.x-curved.points[index].x,5,'Each curve point moves horizontally');closeTo(point.y-curved.points[index].y,3,'Each curve point moves vertically');});
    await resetScroll();await page.screenshot({path:'outputs/curved-draw-builder.png'});
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
    assert.deepEqual((await draft()).frames[4].arrows.find(value=>value.id===curveId),translatedCurve,'Saving and reopening retain the freehand points exactly');
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
