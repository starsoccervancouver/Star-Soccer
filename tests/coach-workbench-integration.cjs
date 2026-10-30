/* New preparation tools through the real workspace handlers; isolated fictional API only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const addAssets = require('./coach-fixture-fonts.cjs');

(async () => {
  const origin = 'https://attendance.starsoccer.ca', now = '2026-12-31T20:00:00Z';
  const rid = n => 'rec' + String(n).padStart(14, '0');
  const profile = { email: 'workbench-coach@example.test', name: 'Fictional Workbench Coach', role: 'coach' };
  const player = { playerId: rid(101), attendanceId: rid(201), name: 'Fictional Preparation Player', kind: 'dropin', status: 'Attending', actualAttendance: 'Not marked', issues: [] };
  const makeSession = (id, date) => ({ id: rid(id), date, time: '4:00–5:00 PM', location: 'Fictional field', status: 'Scheduled', capacity: 20, capacityUsed: 1, expected: 1, counts: { yes: 1, no: 0, awaiting: 0, confirmed: 0 }, issues: [], players: [{ ...player }] });
  const sessions = [makeSession(1, '2026-12-31'), makeSession(2, '2026-12-30'), makeSession(3, '2027-01-01')];
  const targetPlan = { version: 4, content: { focus: 'Target focus', warmup: 'Target warm-up', technical: '', game: '', equipment: '', reflection: 'Keep this session reflection.' } };
  const sourcePlan = { version: 9, content: { focus: 'Source focus', warmup: 'Source warm-up', technical: 'Source technical activity', game: 'Source game', equipment: 'Source equipment', reflection: 'Do not copy source reflection.' } };
  const sourceSnapshot = JSON.stringify(sourcePlan);
  const assets = {};
  for (const [url, file, type] of [
    ['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'],
    ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/assets/app.css', 'app.css', 'text/css'],
    ['/assets/logo.svg', 'logo.svg', 'image/svg+xml'],
  ]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
  assets['/workspace/assets/passkeys.js'] = { body: fs.readFileSync('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', 'utf8'), type: 'text/javascript' };
  addAssets(assets);
  const requests = [];
  let releaseCopy, copyStarted, savedPayload;
  const copyReady = new Promise(resolve => copyStarted = resolve);
  const browser = await chromium.launch();
  let checks = 0;
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ now }) => {
      const BaseDate = Date, time = BaseDate.parse(now);
      window.Date = class extends BaseDate { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } };
      Object.defineProperty(window, 'SpeechRecognition', { value: undefined, configurable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined, configurable: true });
    }, { now });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin, 'No live or third-party network permitted');
      const record = { path: url.pathname, method: request.method(), body: request.postData() };
      requests.push(record);
      const asset = assets[url.pathname];
      if (asset) return route.fulfill({ status: 200, contentType: asset.type, body: asset.body });
      let value;
      if (url.pathname.endsWith('/bootstrap')) value = { profile, csrfToken: 'fixture-csrf', googleEnabled: true };
      else if (url.pathname.endsWith('/desk')) value = { profile, sessions, notes: [], tasks: [], observedAt: now };
      else if (url.pathname.endsWith('/session') && request.method() === 'POST') {
        const payload = JSON.parse(request.postData());
        assert([rid(1), rid(2), rid(3)].includes(payload.sessionId));
        if (payload.sessionId === rid(2)) { copyStarted(); await new Promise(resolve => releaseCopy = resolve); value = { plan: sourcePlan }; }
        else value = { plan: targetPlan };
      } else if (url.pathname.endsWith('/plans/save') && request.method() === 'POST') {
        savedPayload = JSON.parse(request.postData());
        assert.equal(savedPayload.sessionId, rid(1));
        assert.equal(savedPayload.expectedVersion, 4, 'Copying a plan must not use the source plan version to write the target');
        value = { plan: { version: 5, content: savedPayload.content, updated_at: now, updated_by: profile.email } };
      } else throw Error('Unexpected fixture request: ' + request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.goto(origin + '/workspace');
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.locator('#coaching-hub .coaching-agenda-row').first().getByRole('button', { name: /^Plan session for/ }).click();
    await page.waitForFunction(() => !document.querySelector('#plan-focus').disabled && document.querySelector('#plan-focus').value === 'Target focus');
    assert.equal(await page.locator('#session').inputValue(), rid(1));
    assert.equal(await page.locator('#panel-plan').isVisible(), true);
    assert.equal(await page.locator('#practice-ideas').getAttribute('open'), null, 'Optional practice ideas start collapsed so the editor is immediately available');
    await page.locator('#practice-ideas > summary').click();
    checks++;

    await page.locator('.practice-activity[data-drill-id="traffic"] summary').click();
    await page.locator('.practice-activity[data-drill-id="traffic"]').getByRole('button', { name: 'Add to warm-up', exact: true }).click();
    assert.match(await page.locator('#plan-warmup').inputValue(), /^Target warm-up\n\nMove, turn, find space/);
    assert.equal(await page.locator('#plan-state').isVisible(), true);
    assert.equal(requests.filter(request => request.path.endsWith('/plans/save')).length, 0);
    checks++;

    await page.locator('#copy-plan-source').selectOption(rid(2));
    const beforeCancel = await page.locator('#plan-warmup').inputValue();
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Copy plan to draft', exact: true }).click();
    assert.equal(await page.locator('#plan-warmup').inputValue(), beforeCancel);
    assert.equal(requests.filter(request => request.path.endsWith('/session') && JSON.parse(request.body).sessionId === rid(2)).length, 0);
    checks++;

    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Copy plan to draft', exact: true }).click();
    await copyReady;
    assert.equal(await page.locator('#session').isEnabled(), false);
    assert.equal(await page.locator('#plan-focus').isEnabled(), false);
    await page.evaluate(({ sessionId }) => window.dispatchEvent(new CustomEvent('coach:open-session', { detail: { sessionId, tab: 'attendance' } })), { sessionId: rid(3) });
    assert.equal(await page.locator('#session').inputValue(), rid(1), 'An in-flight copy pins the exact target session');
    releaseCopy();
    await page.waitForFunction(() => !document.querySelector('#plan-focus').disabled && document.querySelector('#plan-focus').value === 'Source focus');
    assert.equal(await page.locator('#plan-warmup').inputValue(), 'Source warm-up');
    assert.equal(await page.locator('#plan-technical').inputValue(), 'Source technical activity');
    assert.equal(await page.locator('#plan-game').inputValue(), 'Source game');
    assert.equal(await page.locator('#plan-equipment').inputValue(), 'Source equipment');
    assert.equal(await page.locator('#plan-reflection').inputValue(), 'Keep this session reflection.', 'Reusing preparation never copies another date’s reflection');
    assert.equal(await page.locator('#plan-state').isVisible(), true);
    assert.equal(requests.filter(request => request.path.endsWith('/plans/save')).length, 0);
    checks++;

    const beforeInvalid = requests.length;
    await page.evaluate(({ sourceSessionId }) => {
      window.dispatchEvent(new CustomEvent('coach:copy-plan', { detail: { sourceSessionId } }));
      window.dispatchEvent(new CustomEvent('coach:insert-plan', { detail: { target: 'reflection', text: 'Forbidden automatic reflection' } }));
    }, { sourceSessionId: rid(999) });
    assert.equal(requests.length, beforeInvalid, 'Unknown source sessions are rejected without a network request');
    assert.equal(await page.locator('#plan-reflection').inputValue(), 'Keep this session reflection.');
    checks++;

    await page.getByRole('button', { name: 'Save shared plan', exact: true }).click();
    await page.getByText('Shared session plan saved.', { exact: true }).waitFor();
    assert.equal(requests.filter(request => request.path.endsWith('/plans/save')).length, 1);
    assert.equal(savedPayload.content.focus, 'Source focus');
    assert.equal(savedPayload.content.reflection, 'Keep this session reflection.');
    assert.equal(await page.locator('#plan-state').isVisible(), false);
    assert.equal(JSON.stringify(sourcePlan), sourceSnapshot, 'The source plan remains unchanged');
    checks++;

    await page.locator('#navigation button[data-tab="notes"]').click();
    assert.equal(await page.locator('#player-history-panel').getAttribute('open'), null, 'Player history starts collapsed so the note editor stays prominent');
    await page.locator('#player-history-panel > summary').click();
    await page.locator('#player-development').getByRole('button', { name: /^Add a note for/ }).click();
    assert.equal(await page.locator('#note-player').inputValue(), rid(101));
    assert.equal(await page.locator('#session').inputValue(), rid(1));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'note-body');
    assert.equal(requests.filter(request => request.path.endsWith('/notes/save')).length, 0);
    checks++;

    await page.locator('#note-body').fill('Unsaved fictional observation to preserve.');
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#player-development').getByRole('button', { name: /^Add a note for/ }).click();
    assert.equal(await page.locator('#note-body').inputValue(), 'Unsaved fictional observation to preserve.', 'Starting another note for the same player/date must respect a cancelled discard prompt');
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#player-development').getByRole('button', { name: /^Add a note for/ }).click();
    assert.equal(await page.locator('#note-body').inputValue(), '', 'Accepting the prompt starts a clean note');
    assert.equal(await page.locator('#note-player').inputValue(), rid(101));
    checks++;

    const notePlayer = await page.locator('#note-player').inputValue();
    await page.evaluate(({ sessionId, playerId }) => window.dispatchEvent(new CustomEvent('coach:add-note', { detail: { sessionId, playerId } })), { sessionId: rid(1), playerId: rid(999) });
    assert.equal(await page.locator('#note-player').inputValue(), notePlayer, 'A nonexistent player cannot be selected through a forced event');
    assert.equal(sessions[0].players[0].actualAttendance, 'Not marked');
    assert.deepEqual(requests.filter(request => request.method === 'POST').map(request => request.path).filter(path => !['/workspace/api/session', '/workspace/api/plans/save'].includes(path)), []);
    checks++;

    await page.locator('#navigation button[data-tab="plan"]').click();
    await page.waitForFunction(() => !document.querySelector('#plan-focus').disabled);
    if (await page.locator('#practice-ideas').getAttribute('open') !== null) await page.locator('#practice-ideas > summary').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => { document.activeElement?.blur(); document.querySelector('#notice').hidden = true; window.scrollTo(0, 0); });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: 'outputs/coach-workbench-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: 'outputs/coach-workbench-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.evaluate(() => window.scrollTo(0, 0));
    const firstFieldBox = await page.locator('#plan-focus').boundingBox();
    assert(firstFieldBox.y < 1100, 'Collapsed optional tools keep the first editor near the start of the narrow mobile planner: ' + JSON.stringify(firstFieldBox));
    assert.equal(await page.locator('#practice-ideas').getAttribute('open'), null);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    checks++;
    console.log('Coach workbench integration: ' + checks + ' isolated draft, source-copy, target/version, review and quick-action checks passed. No live records or network.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
