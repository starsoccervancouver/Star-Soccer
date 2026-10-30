/* Synthetic-only browser checks for the on-field saved plan and timer. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const origin = 'https://coach.example.test';
  const session = {
    id: 'fictional-session-one', date: '2026-10-30', time: '4:00–5:00 PM', location: 'Fictional Field', status: 'Scheduled',
    capacity: 20, expected: 2, capacityUsed: 2,
    players: [
      { playerId: 'fictional-player-one', name: 'Fictional Maya', status: 'Attending', actualAttendance: 'Not marked', guardianEmail: 'not-on-print@example.test' },
      { playerId: 'fictional-player-two', name: 'Fictional Noah', status: 'Declined', actualAttendance: 'Absent' },
    ],
  };
  const fixture = {
    selected: session.id, session, sessions: [session], profile: { email: 'fictional-coach@example.test', name: 'Fictional Coach', role: 'coach' }, tab: 'plan', planReady: true, busy: false,
    plan: { version: 1, content: { focus: 'Saved first-touch focus', warmup: 'Saved warm-up <script>neverExecute()</script>', technical: 'Saved technical activity', game: 'Saved game', equipment: 'Saved cones and balls', reflection: 'PRIVATE REFLECTION DO NOT PRINT' } },
    notes: [{ body: 'PRIVATE NOTE DO NOT PRINT' }], tasks: [],
  };
  const html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/session.css"><script defer src="/session.js"></script></head><body><main id="app" class="desk-main"><details id="session-field-disclosure"><summary>Run this session</summary><section id="session-field-tools"></section></details><textarea id="plan-focus">UNSAVED FOCUS DO NOT PRINT</textarea><p id="private-note">PRIVATE NOTE DO NOT PRINT</p></main></body></html>';
  const assets = {
    '/workspace': { type: 'text/html', body: html },
    '/workspace.css': { type: 'text/css', body: fs.readFileSync('private-attendance/web/workspace.css', 'utf8') },
    '/session.css': { type: 'text/css', body: fs.readFileSync('private-attendance/web/workspace-session.css', 'utf8') },
    '/session.js': { type: 'text/javascript', body: fs.readFileSync('private-attendance/web/workspace-session.js', 'utf8') },
  };
  const browser = await chromium.launch();
  let checks = 0;
  try {
    const browserContext = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    await browserContext.addInitScript(() => {
      window.CoachClub = { name: 'Fictional Club' };
      window.printSnapshots = [];
      window.print = () => window.printSnapshots.push(document.querySelector('#session-print-sheet').textContent);
      window.fixtureTime = 0;
      const originalNow = performance.now.bind(performance);
      Object.defineProperty(performance, 'now', { value: () => originalNow() + window.fixtureTime });
    });
    const requests = [];
    await browserContext.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin, 'All test requests stay on the mocked origin');
      requests.push({ path: url.pathname, method: request.method() });
      if (url.pathname.endsWith('.woff2')) return route.fulfill({ status: 404, body: '' });
      assert(assets[url.pathname], 'Field tools must not fetch any business data: ' + url.pathname);
      return route.fulfill({ status: 200, contentType: assets[url.pathname].type, body: assets[url.pathname].body });
    });
    const page = await browserContext.newPage();
    page.setDefaultTimeout(6000);
    const publish = value => page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), value);
    const open = async () => {
      await page.locator('#session-field-disclosure').evaluate(element => { element.open = true; });
      await page.locator('#open-field-view').click();
    };
    await page.goto(origin + '/workspace');
    assert.equal(await page.locator('#session-field-tools').innerText(), '');
    await publish(fixture);
    assert.equal(await page.locator('#session-field-disclosure').evaluate(element => element.open), false, 'Field tools begin collapsed');
    await open();
    assert.match(await page.locator('#session-field-view').innerText(), /Fictional Club/i);
    assert.match(await page.locator('#session-field-view').innerText(), /Saved first-touch focus/);
    assert(!(await page.locator('#session-field-view').innerText()).includes('UNSAVED FOCUS'));
    assert.equal(await page.locator('#field-timer-output').innerText(), '10:00');
    assert.equal(await page.locator('#field-timer-toggle').getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#session-field-view script').count(), 0, 'Saved content renders as text, not HTML');
    checks++;

    await page.locator('#field-timer-minutes').fill('1');
    await page.locator('#field-timer-minutes').dispatchEvent('change');
    await page.locator('#field-timer-toggle').click();
    await page.evaluate(() => { window.fixtureTime += 15000; });
    await page.waitForFunction(() => document.querySelector('#field-timer-output').textContent < '00:47');
    await page.locator('#field-timer-toggle').click();
    const paused = await page.locator('#field-timer-output').innerText();
    await page.evaluate(() => { window.fixtureTime += 10000; });
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#field-timer-output').innerText(), paused, 'Pausing stops elapsed time');
    await page.locator('#field-timer-toggle').click();
    await page.evaluate(() => { window.fixtureTime += 60000; });
    await page.waitForFunction(() => document.querySelector('#field-timer-output').textContent === '00:00');
    assert.equal(await page.locator('#field-timer-toggle').getAttribute('aria-pressed'), 'false');
    assert.match(await page.locator('#field-timer-status').innerText(), /Time reached/);
    checks++;

    await page.locator('#field-timer-minutes').fill('-1');
    await page.locator('#field-timer-minutes').dispatchEvent('change');
    assert.equal(await page.locator('#field-timer-minutes').inputValue(), '1');
    assert.match(await page.locator('#field-timer-status').innerText(), /whole number/);
    await page.locator('#field-timer-minutes').fill('');
    await page.locator('#field-timer-minutes').dispatchEvent('change');
    assert.equal(await page.locator('#field-timer-minutes').inputValue(), '1');
    await page.locator('#field-timer-minutes').fill('121');
    await page.locator('#field-timer-minutes').dispatchEvent('change');
    assert.equal(await page.locator('#field-timer-minutes').inputValue(), '1');
    await page.locator('#field-stage-technical').click();
    assert.equal(await page.locator('#field-timer-output').innerText(), '20:00');
    assert.equal(await page.locator('#field-stage-content').innerText(), 'Saved technical activity');
    assert.equal(await page.locator('#field-timer-toggle').getAttribute('aria-pressed'), 'false', 'Changing stage does not auto-start');
    checks++;

    await page.locator('#field-print-session').click();
    const printed = await page.evaluate(() => printSnapshots.at(-1));
    assert(printed.includes('Fictional Maya') && printed.includes('Fictional Noah'), 'Print includes full named roster');
    assert(printed.includes('Not marked') && printed.includes('Absent'), 'Physical attendance retains actual recorded state');
    assert(printed.includes('Saved technical activity'));
    for (const forbidden of ['PRIVATE NOTE', 'PRIVATE REFLECTION', 'UNSAVED FOCUS', 'not-on-print@example.test', 'fictional-coach@example.test']) assert(!printed.includes(forbidden), 'Print excludes ' + forbidden);
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#app').isVisible(), false);
    assert.equal(await page.locator('#session-field-view').isVisible(), false);
    assert.equal(await page.locator('#session-print-sheet').isVisible(), true);
    await page.emulateMedia({ media: 'screen' });
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    assert.equal(await page.locator('#session-print-sheet').textContent(), '');
    checks++;

    await page.locator('#field-timer-toggle').click();
    await publish({ ...fixture, tab: 'notes' });
    assert.equal(await page.locator('#session-field-view').evaluate(element => element.open), false, 'Leaving planner closes field mode');
    assert.equal(await page.locator('#field-timer-toggle').getAttribute('aria-pressed'), 'false');
    await publish({ ...fixture, busy: true });
    assert.equal(await page.locator('#open-field-view').isDisabled(), true);
    await publish({ ...fixture, planReady: false, session: { ...session, id: 'fictional-session-two' }, selected: 'fictional-session-two' });
    assert.equal(await page.locator('#open-field-view').isDisabled(), true, 'New session cannot display the previous session plan while loading');
    assert.equal(await page.locator('#session-field-view').textContent(), '', 'Changing sessions clears the prior session from the closed dialog');
    await publish({ ...fixture, session: { ...session, id: 'fictional-session-two' }, selected: session.id });
    assert.equal(await page.locator('#open-field-view').isDisabled(), true, 'Mismatched selected and context session cannot open');
    checks++;

    await publish({ ...fixture, plan: { version: 0, content: {} } });
    assert.match(await page.locator('#session-field-tools').innerText(), /No preparation plan has been saved/);
    await open();
    assert.match(await page.locator('#field-stage-content').innerText(), /No activity has been saved/);
    await page.locator('#close-field-view').click();
    await publish(fixture);
    await open();
    await page.locator('#field-timer-toggle').click();
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    assert.equal(await page.locator('#field-timer-toggle').getAttribute('aria-pressed'), 'false');
    await page.evaluate(() => { delete document.hidden; });
    await page.locator('#field-timer-toggle').click();
    await page.locator('#session-field-disclosure').evaluate(element => { element.open = false; });
    await page.waitForFunction(() => !document.querySelector('#session-field-view').open);
    assert.equal(await page.locator('#field-timer-toggle').getAttribute('aria-pressed'), 'false');
    checks++;

    await open();
    await page.locator('#field-timer-toggle').click();
    await publish({ ...fixture, profile: { email: 'different-coach@example.test', role: 'coach' } });
    assert.equal(await page.locator('#session-field-view').evaluate(element => element.open), false);
    assert.equal(await page.locator('#session-field-view').textContent(), '', 'Changing accounts clears the prior dialog content');
    await open();
    assert.equal(await page.locator('#field-timer-output').innerText(), '10:00', 'Account change resets ephemeral timer state');
    await publish(null);
    assert.equal(await page.locator('#session-field-view').textContent(), '', 'Logout clears private session content');
    assert.equal(await page.locator('#session-field-tools').textContent(), '');
    assert.equal(await page.locator('#session-print-sheet').textContent(), '');
    assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0, 'Roster and plan are never stored in browser storage');
    checks++;

    await publish(fixture);
    await page.setViewportSize({ width: 320, height: 740 });
    await open();
    await page.locator('.field-roster summary').click();
    assert.equal(await page.locator('#session-field-view').evaluate(element => element.scrollWidth <= element.clientWidth + 1), true, 'No horizontal overflow on a 320px screen');
    for (const box of await page.locator('#session-field-view button').evaluateAll(elements => elements.map(element => { const bounds = element.getBoundingClientRect(); return { width: bounds.width, height: bounds.height }; }))) {
      assert(box.width >= 44 && box.height >= 44, 'Field controls maintain usable touch targets');
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#session-field-view').evaluate(element => element.open), false, 'Escape closes modal');
    assert.equal(requests.filter(request => request.method !== 'GET').length, 0, 'Session tools never mutate a backend');
    checks++;

    console.log('Coach field session UI: ' + checks + ' checks passed. No live records, microphone or email used.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
