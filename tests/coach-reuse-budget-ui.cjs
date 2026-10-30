/* Fictional sessions only: reusable diagrams, session budgets and saved-plan safeguards. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const origin = 'https://coach-reuse.example.test';
  const target = { id: 'fictional-target', date: '2026-11-06', time: '4:00–5:00 PM', location: 'Fictional Field', status: 'Scheduled', players: [] };
  const source = { ...target, id: 'fictional-source', date: '2026-10-30' };
  const cancelled = { ...target, id: 'fictional-cancelled', status: 'Cancelled' };
  const setup = { id: 'fictional-original-diagram', session_id: source.id, title: 'Passing exercise '.repeat(5), version: 7, content: { schemaVersion: 1, pitch: 'half', items: [{ id: 'fictional-player', kind: 'home', label: 'P1' }], frames: [{ id: 'fictional-phase-one', title: 'Start', duration: 3, positions: [{ id: 'fictional-player', x: 20, y: 30 }] }, { id: 'fictional-phase-two', title: 'Move', duration: 5, positions: [{ id: 'fictional-player', x: 60, y: 30 }] }] } };
  const fixture = { selected: target.id, session: target, sessions: [target, source, cancelled], profile: { email: 'fictional-coach@example.test', role: 'coach', sessionVersion: 1 }, tab: 'plan', planReady: true, planDirty: false, busy: false, plan: { version: 1, content: { focus: 'Saved session focus', warmup: 'Saved warm-up', technical: 'Saved passing activity', game: 'Saved game', equipment: 'Saved cones' } } };
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/session.css"><link rel="stylesheet" href="/tactics.css"><script defer src="/session.js"></script><script defer src="/tactics.js"></script></head><body><main style="max-width:1000px;margin:auto;padding:12px"><details id="tactics-disclosure"><summary>Drill board</summary><section id="tactics-board-tools"></section></details><details id="session-field-disclosure"><summary>Run session</summary><section id="session-field-tools"></section></details><textarea id="plan-focus">Unsaved plan text</textarea></main></body></html>';
  const assets = { '/workspace': { type: 'text/html', body: html } };
  for (const [url, file] of [['workspace.css', 'workspace.css'], ['session.css', 'workspace-session.css'], ['tactics.css', 'workspace-tactics.css'], ['session.js', 'workspace-session.js'], ['tactics.js', 'workspace-tactics.js']]) assets['/' + url] = { type: url.endsWith('.js') ? 'text/javascript' : 'text/css', body: fs.readFileSync('private-attendance/web/' + file, 'utf8') };
  const browser = await chromium.launch();
  let checks = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    await context.addInitScript(original => {
      window.fixtureRecords = [original]; window.fixtureCalls = []; window.fixtureHeld = null;
      window.fixtureHoldSource = false; window.fixtureWrongSource = false; window.fixtureSaveFailure = false;
      window.fixtureConfirm = true; window.fixturePrompts = []; window.fixtureReturns = 0; window.fixturePrints = [];
      window.confirm = text => { fixturePrompts.push(text); return fixtureConfirm; };
      window.print = () => fixturePrints.push(document.querySelector('#session-print-sheet').textContent);
      window.addEventListener('coach:return-plan', () => fixtureReturns++);
      window.addEventListener('coach:tactics-request', event => {
        const { operation, payload, resolve, reject } = event.detail;
        fixtureCalls.push({ operation, payload: structuredClone(payload) });
        if (operation === 'source-list' && fixtureHoldSource) { fixtureHeld = { resolve, reject, payload }; return; }
        if (operation === 'list' || operation === 'source-list') {
          const id = operation === 'list' ? payload.sessionId : payload.sourceSessionId;
          const diagrams = structuredClone(fixtureRecords.filter(item => item.session_id === id));
          if (operation === 'source-list' && fixtureWrongSource && diagrams.length) diagrams[0].session_id = 'fictional-not-authorized';
          resolve({ diagrams }); return;
        }
        if (operation === 'save') {
          if (fixtureSaveFailure) { reject(new Error('Fictional uncertain save')); return; }
          const diagram = { id: payload.id || 'fictional-copy-' + fixtureRecords.length, session_id: payload.sessionId, title: payload.title, content: structuredClone(payload.content), version: payload.expectedVersion + 1 };
          fixtureRecords = [diagram, ...fixtureRecords.filter(item => item.id !== diagram.id)];
          resolve({ diagram }); return;
        }
        reject(new Error('Unexpected test operation ' + operation));
      });
    }, setup);
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      assert.equal(url.origin, origin, 'No live or third-party requests are allowed in this fixture');
      if (url.pathname.endsWith('.woff2')) return route.fulfill({ status: 404, body: '' });
      assert(assets[url.pathname], 'Unexpected network request ' + url.pathname);
      return route.fulfill({ status: 200, contentType: assets[url.pathname].type, body: assets[url.pathname].body });
    });
    const page = await context.newPage(), errors = [];
    page.setDefaultTimeout(6000);
    page.on('pageerror', error => errors.push(error.message));
    const publish = value => page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), value);
    const calls = operation => page.evaluate(operation => fixtureCalls.filter(call => call.operation === operation), operation);
    const fill = async (id, value) => { await page.locator(id).fill(value); await page.locator(id).dispatchEvent('change'); };
    const idle = () => page.waitForFunction(() => !CoachTactics.isBusy());
    const openReuse = async () => { await page.locator('#tactics-disclosure').evaluate(element => { element.open = true; }); await idle(); await page.locator('#tactics-reuse').evaluate(element => { element.open = true; }); };
    const loadSource = async () => { await page.locator('#tactics-source-session').selectOption(source.id); await page.locator('#tactics-source-load').click(); await idle(); };
    const openField = async () => { await page.locator('#session-field-disclosure').evaluate(element => { element.open = true; }); await page.locator('#open-field-view').click(); };
    await page.goto(origin + '/workspace');
    await publish(fixture);
    assert.equal((await calls('list')).length, 0);
    assert.equal((await calls('source-list')).length, 0);
    await openReuse();
    const options = await page.locator('#tactics-source-session option').evaluateAll(elements => elements.map(element => element.value));
    assert.deepEqual(options, ['', source.id], 'Only accessible noncurrent, noncancelled sessions appear');
    await page.locator('#tactics-source-session').selectOption(source.id);
    assert.equal((await calls('source-list')).length, 0, 'Choosing a source does not fetch until asked');
    await loadSource();
    assert.deepEqual((await calls('source-list'))[0].payload, { sessionId: target.id, sourceSessionId: source.id });
    assert.equal((await calls('save')).length, 0);
    checks++;

    await page.locator('#tactics-source-board').selectOption(setup.id);
    await page.locator('#tactics-source-copy').click();
    assert.equal(await page.evaluate(() => CoachTactics.isDirty()), true);
    assert.equal(await page.locator('#tactics-library').inputValue(), '', 'Copied board has no saved target ID');
    assert.equal((await calls('save')).length, 0, 'Copying itself never writes');
    assert.equal((await page.locator('#tactics-title').inputValue()).length, 80, 'Copy title fits the server limit');
    assert.match(await page.locator('#tactics-status').innerText(), /new unsaved setup/);
    await page.locator('#tactics-save').click(); await idle();
    const saved = (await calls('save')).at(-1).payload;
    assert.equal(saved.id, null); assert.equal(saved.expectedVersion, 0); assert.equal(saved.sessionId, target.id);
    assert.deepEqual(saved.content, setup.content, 'Copy retains every piece and animation frame');
    assert.deepEqual(await page.evaluate(id => fixtureRecords.find(item => item.id === id), setup.id), setup, 'Source remains unchanged');
    checks++;

    await fill('#tactics-title', 'Keep my current draft');
    await page.evaluate(() => { fixtureConfirm = false; });
    await page.locator('#tactics-source-copy').click();
    assert.equal(await page.locator('#tactics-title').inputValue(), 'Keep my current draft');
    assert.match(await page.evaluate(() => fixturePrompts.at(-1)), /discard.*unsaved/i);
    await page.evaluate(() => { fixtureConfirm = true; });
    await page.locator('#tactics-source-copy').click();
    assert.equal(await page.locator('#tactics-library').inputValue(), '');
    checks++;

    await page.evaluate(() => { fixtureWrongSource = true; });
    await loadSource();
    assert.match(await page.locator('#tactics-source-status').innerText(), /could not be verified/);
    assert.equal(await page.locator('#tactics-source-copy').isDisabled(), true);
    await page.evaluate(() => { fixtureWrongSource = false; fixtureHoldSource = true; });
    await page.locator('#tactics-source-load').click();
    assert.equal(await page.locator('#tactics-title').isDisabled(), true, 'A pending read guards edits and navigation');
    const another = { ...fixture, session: { ...target, id: 'fictional-other-target' }, selected: 'fictional-other-target', sessions: [source, { ...target, id: 'fictional-other-target' }] };
    await publish(another);
    await page.evaluate(() => { fixtureHoldSource = false; fixtureHeld.resolve({ diagrams: [fixtureRecords.find(item => item.id === 'fictional-original-diagram')] }); });
    await idle();
    assert.equal(await page.locator('#tactics-source-session').inputValue(), '');
    assert.equal(await page.locator('#tactics-source-board option').count(), 1, 'Stale source result cannot enter a different target session');
    assert.equal(await page.locator('#tactics-title').inputValue(), 'New drill');
    checks++;

    await publish(fixture); await idle(); await openReuse(); await loadSource();
    await page.locator('#tactics-source-board').selectOption(setup.id);
    await page.locator('#tactics-source-copy').click();
    await page.evaluate(() => { fixtureSaveFailure = true; });
    await page.locator('#tactics-save').click(); await idle();
    assert.equal(await page.locator('#tactics-source-copy').isDisabled(), true);
    assert.equal(await page.locator('#tactics-source-load').isDisabled(), true, 'An uncertain save must be recovered before replacing it');
    assert.match(await page.locator('#tactics-status').innerText(), /could not verify the save/);
    await page.evaluate(() => { fixtureSaveFailure = false; });
    checks++;

    await publish({ ...fixture, profile: { ...fixture.profile, sessionVersion: 2 } }); await idle();
    await openField();
    assert.match(await page.locator('#field-time-budget').innerText(), /60-minute recorded session.*50 minutes.*10 minutes left/);
    assert.equal(await page.locator('#field-timer-toggle').getAttribute('aria-pressed'), 'false');
    await fill('#field-timer-minutes', '25');
    assert.match(await page.locator('#field-time-budget').innerText(), /65 minutes.*5 minutes over/);
    assert.equal(await page.locator('#field-time-budget').evaluate(element => element.classList.contains('is-over-budget')), true);
    assert.equal(await page.locator('#field-timer-toggle').getAttribute('aria-pressed'), 'false', 'Budget changes never start a timer');
    await fill('#field-timer-minutes', '20');
    assert.match(await page.locator('#field-time-budget').innerText(), /Stage timers fit/);
    await page.locator('#close-field-view').click();
    checks++;

    for (const [index, time, expected] of [[1, '3:45–5:00 PM', 75], [2, '3:45–5:15 PM', 90], [3, '11 AM–12:30 PM', 90], [4, '11–1 PM', 120], [5, '9am–12 noon', 180], [6, '15:45–17:15', 90]]) {
      const session = { ...target, id: 'fictional-budget-' + index, time };
      await publish({ ...fixture, session, selected: session.id });
      await openField();
      assert.match(await page.locator('#field-time-budget').innerText(), new RegExp(expected + '-minute recorded session'));
      assert.equal(await page.locator('#field-timer-output').innerText(), '10:00', 'New sessions reset temporary timer durations');
      await page.locator('#close-field-view').click();
    }
    checks++;

    const timed = { ...target, id: 'fictional-iso', startAt: '2026-11-06T16:00:00-08:00', endAt: '2026-11-06T17:15:00-08:00' };
    await publish({ ...fixture, session: timed, selected: timed.id });
    assert.match(await page.locator('#field-time-budget-entry').textContent(), /75-minute recorded session/);
    for (const time of ['Time to be confirmed', '4:99–5:00 PM', '4–4 PM', '13 AM–2 PM']) {
      const session = { ...target, id: 'fictional-invalid-' + time, time };
      await publish({ ...fixture, session, selected: session.id });
      assert.match(await page.locator('#field-time-budget-entry').textContent(), /Session length not recorded/);
    }
    checks++;

    await publish({ ...fixture, planDirty: true });
    await page.locator('#session-field-disclosure').evaluate(element => { element.open = true; });
    assert.equal(await page.locator('#field-unsaved-warning').isVisible(), true);
    await page.locator('#field-unsaved-warning-return').click();
    assert.equal(await page.evaluate(() => fixtureReturns), 1);
    await openField();
    assert.equal(await page.locator('#field-dialog-unsaved-warning').isVisible(), true);
    await page.locator('#field-print-session').click();
    assert.match(await page.evaluate(() => fixturePrints.at(-1)), /unsaved plan edits are not included/);
    assert(!(await page.evaluate(() => fixturePrints.at(-1))).includes('Unsaved plan text'));
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.locator('#field-dialog-unsaved-warning-return').click();
    assert.equal(await page.locator('#session-field-view').evaluate(element => element.open), false);
    assert.equal(await page.evaluate(() => fixtureReturns), 2);
    await openField(); await publish(fixture);
    assert.equal(await page.locator('#field-dialog-unsaved-warning').isVisible(), false, 'Saving clears the warning even while field view is open');
    await page.locator('#close-field-view').click();
    checks++;

    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await openReuse(); await loadSource(); await page.locator('#tactics-source-board').selectOption(setup.id);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Reuse controls fit mobile width ' + width);
      for (const id of ['tactics-source-load', 'tactics-source-copy', 'tactics-source-session', 'tactics-source-board']) assert((await page.locator('#' + id).boundingBox()).height >= 44, id + ' remains touch-friendly');
      await publish({ ...fixture, planDirty: true }); await openField();
      assert(await page.locator('#session-field-view').evaluate(element => element.scrollWidth <= element.clientWidth + 1), 'Field view fits mobile width ' + width);
      assert((await page.locator('#field-dialog-unsaved-warning-return').boundingBox()).height >= 44);
      await page.locator('#close-field-view').click();
    }
    checks++;

    await publish(null);
    assert.equal(await page.locator('#tactics-board-tools').textContent(), '');
    assert.equal(await page.locator('#session-field-tools').textContent(), '');
    assert.equal(await page.locator('#session-field-view').textContent(), '');
    assert.equal(await page.locator('#session-print-sheet').textContent(), '');
    assert.deepEqual(errors, []);
    checks++;
    console.log(JSON.stringify({ passed: true, checks, scope: 'Synthetic cross-session copies, stale/recovery guards, time budgets, unsaved warnings and mobile controls; no live data or attendance writes.' }));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
