/* Animated tactics board checks. All requests, people and sessions are fictional. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const origin = 'https://tactics.example.test';
  const session = { id: 'rec00000000000001', date: '2026-10-30', time: '4–5 PM', location: 'Fictional field', status: 'Scheduled', players: [] };
  const fixture = { selected: session.id, session, sessions: [session], groupSessions: [session], profile: { email: 'fictional-coach@example.test', name: 'Fictional Coach', role: 'coach' }, tab: 'plan', busy: false, planReady: true };
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/session.css"><link rel="stylesheet" href="/tactics.css"><script defer src="/tactics.js"></script></head><body style="background:#f4f2ec"><main style="max-width:1100px;margin:0 auto;padding:16px"><h1>Fictional Club · tactics preview</h1><section class="card"><details id="tactics-disclosure" class="coaching-tools-disclosure"><summary>Tactics & drill diagrams</summary><section id="tactics-board-tools"></section></details></section></main></body></html>';
  const assets = {
    '/workspace': { body: html, type: 'text/html' },
    '/workspace.css': { body: fs.readFileSync('private-attendance/web/workspace.css', 'utf8'), type: 'text/css' },
    '/session.css': { body: fs.readFileSync('private-attendance/web/workspace-session.css', 'utf8'), type: 'text/css' },
    '/workspace/assets/manrope.woff2': { body: fs.readFileSync('fonts/manrope-normal-latin.woff2'), type: 'font/woff2' },
    '/workspace/assets/instrument-serif.woff2': { body: fs.readFileSync('fonts/instrument-serif-italic-latin.woff2'), type: 'font/woff2' },
    '/tactics.css': { body: fs.readFileSync('private-attendance/web/workspace-tactics.css', 'utf8'), type: 'text/css' },
    '/tactics.js': { body: fs.readFileSync('private-attendance/web/workspace-tactics.js', 'utf8'), type: 'text/javascript' },
  };
  const browser = await chromium.launch();
  let checks = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1050 } });
    await context.addInitScript(() => {
      window.CoachClub = { name: 'Fictional Club', timeZone: 'America/Vancouver' };
      window.fixtureCalls = [];
      window.fixtureRecords = [];
      window.fixtureHold = '';
      window.fixtureFailure = '';
      window.fixtureLoseSaveResponse = false;
      window.fixtureConfirm = true;
      window.fixturePending = null;
      window.fixturePrompts = [];
      window.confirm = message => { fixturePrompts.push(message); return fixtureConfirm; };
      window.fixtureProcess = request => {
        const { operation, payload } = request;
        if (operation === 'list') return { diagrams: structuredClone(fixtureRecords.filter(item => item.session_id === payload.sessionId)) };
        if (operation === 'save') {
          const diagram = { id: payload.id || 'diagram-fictional-' + (fixtureRecords.length + 1), session_id: payload.sessionId, title: payload.title, content: structuredClone(payload.content), version: payload.expectedVersion + 1, updated_at: '2026-10-29T18:00:00Z', updated_by: 'fictional-coach@example.test' };
          fixtureRecords = [diagram, ...fixtureRecords.filter(item => item.id !== diagram.id)];
          return { diagram };
        }
        fixtureRecords = fixtureRecords.filter(item => item.id !== payload.id);
        return { archived: true };
      };
      window.addEventListener('coach:tactics-request', event => {
        const { operation, payload, resolve, reject } = event.detail;
        const request = { operation, payload: structuredClone(payload) };
        fixtureCalls.push(request);
        if (fixtureHold === operation) { fixturePending = { request, resolve, reject }; return; }
        if (fixtureFailure === operation) { reject(Object.assign(new Error('Fictional conflict: reload the saved board or keep your draft.'), { code: 'DIAGRAM_CHANGED' })); return; }
        if (operation === 'save' && fixtureLoseSaveResponse) { fixtureProcess(request); reject(new Error('Fictional connection lost after save')); return; }
        resolve(fixtureProcess(request));
      });
    });
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, origin, 'Tactics test may never access live or third-party data');
      assert(assets[url.pathname], 'Unexpected network request ' + url.pathname);
      return route.fulfill({ status: 200, contentType: assets[url.pathname].type, body: assets[url.pathname].body, headers: {'Content-Security-Policy': "img-src 'self'"} });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const publish = value => page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), value);
    const open = () => page.locator('#tactics-disclosure').evaluate(element => { element.open = true; });
    const count = operation => page.evaluate(operation => fixtureCalls.filter(item => item.operation === operation).length, operation);
    const saved = () => page.evaluate(() => fixtureCalls.filter(item => item.operation === 'save').at(-1)?.payload);
    const fill = async (selector, value) => { await page.locator(selector).fill(value); await page.locator(selector).dispatchEvent('change'); };
    const save = async () => { const n = await count('save'); await page.locator('#tactics-save').click(); await page.waitForFunction(n => fixtureCalls.filter(item => item.operation === 'save').length > n, n); await page.waitForFunction(() => !CoachTactics.isBusy()); return saved(); };
    await page.goto(origin + '/workspace');
    await publish(null);
    assert.equal(await count('list'), 0);
    await publish(fixture);
    assert.equal(await count('list'), 0, 'Closed board does not eagerly request stored diagrams');
    await open();
    await page.locator('#tactics-title').waitFor();
    await page.waitForFunction(() => !CoachTactics.isBusy());
    assert.equal(await count('list'), 1);
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), false);
    checks++;

    await fill('#tactics-title', 'Fictional movement drill');
    for (const kind of ['home', 'away', 'cone', 'ball', 'goal']) await page.locator('#tactics-add-' + kind).click();
    await fill('#tactics-label', 'G1');
    await page.locator('#tactics-nudge-right').click();
    const first = await save();
    assert.equal(first.sessionId, session.id);
    assert.equal(first.content.items.length, 5);
    assert.deepEqual(first.content.items.map(item => item.kind), ['home', 'away', 'cone', 'ball', 'goal']);
    assert.equal(first.content.frames.length, 1);
    assert.equal(first.content.frames[0].positions.length, 5);
    assert.equal(first.content.items.at(-1).label, 'G1');
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), false);
    checks++;

    const firstPieceId = first.content.items[0].id;
    await page.locator('#tactics-item').selectOption(firstPieceId);
    await page.locator('#tactics-pitch-board').focus();
    await page.keyboard.press('Shift+ArrowRight');
    await fill('#tactics-label', '<img>');
    const moved = await save();
    assert.equal(moved.content.frames[0].positions.find(item => item.id === firstPieceId).x, first.content.frames[0].positions.find(item => item.id === firstPieceId).x + 5, 'Keyboard movement changes normalized position');
    assert.equal(await page.locator('#tactics-pitch-board img').count(), 0, 'Label markup renders as SVG text, never HTML');
    await page.locator('#tactics-pitch-board').click({ position: { x: 90, y: 90 } });
    const placed = await save();
    const target = page.locator('#tactics-pitch-board [data-tactics-item="' + firstPieceId + '"]');
    const beforeDrag = await target.boundingBox();
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2, beforeDrag.y + beforeDrag.height / 2);
    await page.mouse.down();
    await page.mouse.move(beforeDrag.x + beforeDrag.width / 2 + 50, beforeDrag.y + beforeDrag.height / 2 - 30, { steps: 6 });
    await page.mouse.up();
    const dragged = await save();
    assert.notDeepEqual(dragged.content.frames[0].positions.find(item => item.id === firstPieceId), placed.content.frames[0].positions.find(item => item.id === firstPieceId), 'Pointer dragging moves the selected piece');
    await page.locator('#tactics-item').selectOption(first.content.items.at(-1).id);
    checks++;

    await page.locator('#tactics-add-frame').click();
    await fill('#tactics-frame-title', 'Pass and move');
    assert.equal(await page.locator('#tactics-duration').isVisible(), false, 'Final step has no unused transition timing');
    await page.locator('#tactics-frame-0').click();
    assert.equal(await page.locator('#tactics-frame-0').getAttribute('aria-pressed'), 'true', 'Select the first transition before editing timing');
    assert.equal(await page.locator('#tactics-duration').evaluate(n => n.parentElement.hidden), false, 'Only the last step hides duration');
    await fill('#tactics-duration', '2');
    await page.locator('#tactics-frame-1').click();
    await page.locator('#tactics-nudge-left').click();
    await page.locator('#tactics-nudge-down').click();
    const second = await save();
    assert.equal(second.content.frames.length, 2);
    assert.equal(second.content.frames[1].title, 'Pass and move');
    assert.equal(second.content.frames[0].duration, 2);
    const lastId = second.content.items.at(-1).id;
    assert.notDeepEqual(second.content.frames[0].positions.find(item => item.id === lastId), second.content.frames[1].positions.find(item => item.id === lastId), 'A later phase can move an item without changing the starting phase');
    await page.locator('#tactics-frame-0').click();
    await fill('#tactics-duration', '-1');
    assert.equal(await page.locator('#tactics-duration').inputValue(), '2', 'Invalid phase duration is restored');
    assert.match(await page.locator('#tactics-status').innerText(), /0.5 and 20/);
    await page.locator('#tactics-frame-1').click();
    checks++;

    await page.locator('#tactics-nudge-right').click();
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), true);
    await page.locator('#tactics-undo').click();
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), false, 'Undo returns to saved state');
    await page.locator('#tactics-redo').click();
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), true);
    await page.locator('#tactics-undo').click();
    checks++;

    await page.locator('#tactics-reset').click();
    await page.locator('#tactics-play').click();
    await page.waitForTimeout(120);
    assert.match(await page.locator('#tactics-play').innerText(), /pause/i);
    const movingBoard = await page.locator('#tactics-pitch-board').innerHTML();
    await page.waitForTimeout(120);
    assert.notEqual(await page.locator('#tactics-pitch-board').innerHTML(), movingBoard, 'Animation changes rendered positions');
    await publish({ ...fixture, tab: 'notes' });
    assert.doesNotMatch(await page.locator('#tactics-play').innerText(), /pause/i, 'Leaving planner pauses playback');
    await publish(fixture);
    await page.locator('#tactics-play').click();
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    assert.doesNotMatch(await page.locator('#tactics-play').innerText(), /pause/i, 'Hidden page pauses playback');
    await page.evaluate(() => { delete document.hidden; });
    checks++;

    await fill('#tactics-title', 'Draft retained after conflict');
    await page.evaluate(() => { fixtureFailure = 'save'; });
    const beforeFailure = await count('save');
    await page.locator('#tactics-save').click();
    await page.waitForFunction(() => !CoachTactics.isBusy());
    assert.equal(await count('save'), beforeFailure + 1);
    assert.equal(await page.locator('#tactics-title').inputValue(), 'Draft retained after conflict');
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), true);
    assert.match(await page.locator('#tactics-status').innerText(), /conflict|changed|draft/i);
    await page.waitForTimeout(100);
    assert.equal(await count('save'), beforeFailure + 1, 'A conflict never retries or overwrites automatically');
    await page.evaluate(() => { fixtureFailure = ''; fixtureRecords[0].title = 'Saved by another fictional coach'; fixtureRecords[0].version++; });
    await page.locator('#tactics-retry').click();
    await page.waitForFunction(() => !CoachTactics.isBusy());
    assert.equal(await page.locator('#tactics-title').inputValue(), 'Draft retained after conflict', 'Refreshing saved setups preserves the unsaved draft');
    await page.evaluate(() => { fixtureConfirm = false; });
    await page.locator('#tactics-open-latest').click();
    assert.equal(await page.locator('#tactics-title').inputValue(), 'Draft retained after conflict');
    await page.evaluate(() => { fixtureConfirm = true; });
    await page.locator('#tactics-open-latest').click();
    assert.equal(await page.locator('#tactics-title').inputValue(), 'Saved by another fictional coach', 'Explicit latest-version action resolves cached version conflict');
    await fill('#tactics-title', 'Fictional follow-up edit');
    await page.evaluate(() => { fixtureHold = 'save'; });
    await page.locator('#tactics-save').click();
    await page.waitForFunction(() => !!fixturePending);
    assert.equal(await page.locator('#tactics-title').isDisabled(), true);
    assert.equal(await page.locator('#tactics-save').isDisabled(), true);
    const beforeDuplicate = await count('save');
    await page.locator('#tactics-save').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await count('save'), beforeDuplicate, 'Pending save ignores synthetic duplicate click');
    await page.evaluate(() => { fixtureHold = ''; const pending = fixturePending; fixturePending = null; pending.resolve(fixtureProcess(pending.request)); });
    await page.waitForFunction(() => !CoachTactics.isBusy());
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), false);
    checks++;

    await fill('#tactics-title', 'Fictional save with uncertain response');
    const beforeUncertain = await count('save');
    await page.evaluate(() => { fixtureLoseSaveResponse = true; });
    await page.locator('#tactics-save').click();
    await page.waitForFunction(() => !CoachTactics.isBusy());
    assert.equal(await page.locator('#tactics-save').isDisabled(), true, 'Unknown save outcome blocks blind retry');
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), true);
    await page.evaluate(() => { fixtureLoseSaveResponse = false; });
    await page.locator('#tactics-retry').click();
    await page.waitForFunction(() => !CoachTactics.isBusy());
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), false, 'Readback of the exact saved payload resolves an uncertain success');
    assert.equal(await count('save'), beforeUncertain + 1, 'Recovery reads never duplicate the saved setup');
    checks++;

    await page.evaluate(() => { fixtureConfirm = false; });
    const beforeArchive = await count('archive');
    await page.locator('.tactics-compact-details > summary').click();
    await page.locator('#tactics-archive').click();
    assert.equal(await count('archive'), beforeArchive, 'Cancelled archive cannot mutate');
    await page.evaluate(() => { fixtureConfirm = true; });
    await page.locator('#tactics-archive').click();
    await page.waitForFunction(() => !CoachTactics.isBusy());
    assert.equal(await count('archive'), beforeArchive + 1);
    assert.equal(await page.evaluate(() => fixtureRecords.length), 0);
    checks++;

    await page.locator('#tactics-preset').click();
    await fill('#tactics-title', 'Fictional passing triangle');
    await save();
    assert.equal(await page.locator('.tactics-frame-preview svg').count(), 3);
    await page.locator('#tactics-frame-1').click();
    await page.locator('#tactics-step-earlier').click();
    assert.match(await page.locator('#tactics-frame-0').innerText(), /Pass & follow/);
    await page.locator('#tactics-undo').click();
    assert.match(await page.locator('#tactics-frame-0').innerText(), /Set up/);
    const selectedPiece = await page.locator('#tactics-item option').nth(1).getAttribute('value');
    await page.locator('#tactics-item').selectOption(selectedPiece);
    await page.locator('#tactics-duplicate-item').click();
    assert.equal(await page.locator('#tactics-pitch-board [data-tactics-item]').count(), 5);
    await page.locator('#tactics-pitch-board').focus(); await page.keyboard.press('Control+z');
    assert.equal(await page.locator('#tactics-pitch-board [data-tactics-item]').count(), 4);
    await page.keyboard.press('Escape'); assert.equal(await page.locator('#tactics-item').inputValue(), '');
    const unchanged = await page.evaluate(() => JSON.stringify(CoachTactics.getDraft().diagram));
    await page.locator('#tactics-progress').evaluate(n => { n.value = '1.5'; n.dispatchEvent(new Event('input', {bubbles:true})); });
    assert.match(await page.locator('#tactics-play').innerText(), /Resume/);
    assert.equal(await page.evaluate(() => JSON.stringify(CoachTactics.getDraft().diagram)), unchanged, 'Scrubbing does not change the saved animation');
    await page.locator('#tactics-speed').selectOption('2'); await page.locator('#tactics-loop').check();
    assert.equal(await page.locator('#tactics-speed').inputValue(), '2');
    await page.locator('#tactics-reset').click();
    await fill('#tactics-duration', '.5'); await page.locator('#tactics-frame-1').click(); await fill('#tactics-duration', '.5');
    await page.locator('#tactics-reset').click(); await page.locator('#tactics-play').click();
    await page.waitForTimeout(700);
    assert.match(await page.locator('#tactics-play').innerText(), /Pause/, 'Loop continues beyond the half-second sequence at 2×');
    await page.locator('#tactics-loop').uncheck();
    await page.waitForFunction(() => !document.getElementById('tactics-play').textContent.includes('Pause'));
    await page.locator('#tactics-reset').click();
    const download = page.waitForEvent('download', {timeout:6000}); await page.locator('#tactics-export').click();
    const exported = await download; assert.equal(exported.suggestedFilename(), 'star-soccer-drill.svg');
    assert.match(fs.readFileSync(await exported.path(), 'utf8'), /<svg[^>]+xmlns=/, 'Export produces a standalone SVG under the production image policy');
    await page.evaluate(() => { window.fixturePrinted = null; window.open = () => { const doc = document.implementation.createHTMLDocument(''); return {document:doc,focus(){},print(){window.fixturePrinted={title:doc.querySelector('h1').textContent,pictures:doc.querySelectorAll('svg').length};}}; }; });
    await page.locator('#tactics-print').click();
    assert.deepEqual(await page.evaluate(() => fixturePrinted), {title:'Fictional passing triangle',pictures:1});
    checks++;
    await page.setViewportSize({ width: 1280, height: 1050 });
    fs.mkdirSync('outputs', { recursive: true });
    await page.screenshot({ path: 'outputs/coach-tactics-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'outputs/coach-tactics-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 320, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Board fits 320px viewport');
    for (const box of await page.locator('#tactics-board-tools button:visible').evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height }; }))) {
      assert(box.height >= 44 && box.width >= 44, 'Board buttons have usable touch targets');
    }
    checks++;

    await publish(null);
    assert.equal(await page.locator('#tactics-board-tools').textContent(), '', 'Sign-out removes private diagrams from DOM');
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), false);
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, 'Private diagrams never persist in browser storage');
    await page.evaluate(() => { fixtureHold = 'list'; });
    await publish(fixture);
    await open();
    await page.waitForFunction(() => !!fixturePending);
    await publish(null);
    await page.evaluate(() => { fixtureHold = ''; const pending = fixturePending; fixturePending = null; pending.resolve(fixtureProcess(pending.request)); });
    await page.waitForTimeout(50);
    assert.equal(await page.locator('#tactics-board-tools').textContent(), '', 'Late list response cannot repopulate after logout');
    checks++;

    assert.deepEqual(errors, []);
    console.log('Coach tactics UI: ' + checks + ' grouped checks passed. Fictional data and mocked transport only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
