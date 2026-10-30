/* Draft replacement and pending archive regressions. Fictional routes only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const origin = 'https://attendance.starsoccer.ca';
  const now = '2026-10-29T18:00:00Z';
  const rid = n => 'rec' + String(n).padStart(14, '0');
  const profile = { email: 'fixture-owner@example.test', name: 'Fictional Owner', role: 'owner' };
  const session = (n, date) => ({
    id: rid(n), date, time: '4:00–5:00 PM', location: 'Fictional practice field', status: 'Planned',
    capacity: 20, capacityUsed: 1, registered: 1, expected: 1, issues: [],
    counts: { yes: 0, no: 0, confirmed: 0, awaiting: 1 },
    players: [{ playerId: rid(100 + n), attendanceId: rid(200 + n), name: 'Fictional Player ' + n,
      kind: 'dropin', status: 'Not yet asked', response: null, actualAttendance: 'Not marked', issues: [] }],
  });
  const sessions = [session(1, '2026-10-29'), session(2, '2026-10-30')];
  const note = (id, sessionId, body) => ({ id, session_id: rid(sessionId), player_id: rid(100 + sessionId),
    author_email: profile.email, category: 'General', body, review_date: null, created_at: now, updated_at: now, version: 1 });
  let notes = [note('fixture-note-a', 1, 'Saved fictional note A'), note('fixture-note-b', 1, 'Saved fictional note B'), note('fixture-note-c', 2, 'Saved fictional note C')];
  const assets = {};
  for (const [url, file, type] of [
    ['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'],
    ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/assets/app.css', 'app.css', 'text/css'],
    ['/assets/logo.svg', 'logo.svg', 'image/svg+xml'],
  ]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
  assets['/workspace/assets/passkeys.js'] = { body: fs.readFileSync('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', 'utf8'), type: 'text/javascript' };
  require('./coach-fixture-fonts.cjs')(assets);
  const browser = await chromium.launch();
  let checks = 0, releaseArchive;
  const mutations = [];
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ now }) => {
      const BaseDate = Date, value = BaseDate.parse(now);
      window.Date = class extends BaseDate { constructor(...args) { super(...(args.length ? args : [value])); } static now() { return value; } };
      window.fixtureConfirmAnswers = [];
      window.fixtureConfirmPrompts = [];
      window.confirm = text => { fixtureConfirmPrompts.push(text); return fixtureConfirmAnswers.shift() === true; };
    }, { now });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin, 'No live network permitted');
      if (assets[url.pathname]) return route.fulfill({ status: 200, contentType: assets[url.pathname].type, body: assets[url.pathname].body });
      let result;
      if (url.pathname === '/workspace/api/bootstrap') result = { profile, csrfToken: 'fictional-csrf', googleEnabled: true };
      else if (url.pathname === '/workspace/api/desk') result = { profile, sessions, notes, tasks: [], observedAt: now };
      else if (url.pathname === '/workspace/api/notes/archive' && request.method() === 'POST') {
        const payload = request.postDataJSON();
        mutations.push({ path: url.pathname, payload });
        const accepted = await new Promise(resolve => { releaseArchive = resolve; });
        releaseArchive = null;
        if (!accepted) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'FICTIONAL_RETRY', message: 'Fictional archive unavailable. Try again.' }) });
        notes = notes.filter(item => item.id !== payload.id);
        result = { archived: true };
      } else throw new Error('Unexpected fixture action: ' + request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const card = text => page.locator('#note-list .note-card').filter({ has: page.getByText(text, { exact: true }) });
    const answer = value => page.evaluate(value => fixtureConfirmAnswers.push(value), value);
    const promptCount = () => page.evaluate(() => fixtureConfirmPrompts.length);
    await page.goto(origin + '/workspace');
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.getByRole('button', { name: 'Player notes & goals', exact: true }).click();
    assert.equal(await page.locator('#session').inputValue(), rid(1));

    await page.locator('#note-body').fill('Unsaved fictional observation');
    await answer(false);
    await card('Saved fictional note B').getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.locator('#note-body').inputValue(), 'Unsaved fictional observation', 'Cancelling same-session edit preserves the draft');
    assert.equal(await page.locator('#session').inputValue(), rid(1));
    assert.equal(await promptCount(), 1);
    assert.equal(mutations.length, 0);
    checks++;

    await answer(true);
    await card('Saved fictional note B').getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.locator('#note-body').inputValue(), 'Saved fictional note B');
    assert.equal(await page.locator('#note-player').inputValue(), rid(101));
    assert.equal(await page.locator('#note-cancel').isVisible(), true);
    await page.locator('#note-body').fill('Locally edited fictional B');
    const promptsBeforeSameTarget = await promptCount();
    await card('Saved fictional note B').getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.locator('#note-body').inputValue(), 'Locally edited fictional B', 'Reopening the active note never replaces its draft');
    assert.equal(await promptCount(), promptsBeforeSameTarget);
    checks++;

    await answer(false);
    await card('Saved fictional note C').getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.locator('#session').inputValue(), rid(1));
    assert.equal(await page.locator('#note-body').inputValue(), 'Locally edited fictional B', 'Cancelling cross-session edit keeps the original date and note');
    assert.equal(await page.locator('#note-player').inputValue(), rid(101));
    await answer(true);
    await card('Saved fictional note C').getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await page.locator('#session').inputValue(), rid(2));
    assert.equal(await page.locator('#note-body').inputValue(), 'Saved fictional note C');
    assert.equal(await page.locator('#note-player').inputValue(), rid(102));
    assert.equal(mutations.length, 0, 'Editing a draft is not a save');
    checks++;

    await page.locator('#note-body').fill('Fictional C draft preserved on failure');
    await answer(false);
    await card('Saved fictional note C').getByRole('button', { name: 'Archive', exact: true }).click();
    assert.equal(mutations.length, 0, 'Cancelled archive makes no request');
    assert.equal(await page.locator('#note-body').inputValue(), 'Fictional C draft preserved on failure');
    checks++;

    const beginArchive = async () => {
      await answer(true);
      const request = page.waitForRequest(req => new URL(req.url()).pathname === '/workspace/api/notes/archive');
      await card('Saved fictional note C').getByRole('button', { name: 'Archive', exact: true }).click();
      await request;
      await page.waitForFunction(() => document.getElementById('session').disabled);
      assert.equal(await page.locator('#logout').isDisabled(), true);
      assert.equal(await page.locator('#refresh').isDisabled(), true);
      assert.equal(await page.locator('#note-body').isDisabled(), true, 'Archive locks the active editor so late success cannot discard new typing');
      assert.equal(await page.locator('#navigation button[data-tab="attendance"]').isDisabled(), true);
      assert.equal(await card('Saved fictional note C').getByRole('button', { name: 'Archive', exact: true }).isDisabled(), true);
      const before = mutations.length;
      await card('Saved fictional note C').getByRole('button', { name: 'Archive', exact: true }).evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.locator('#navigation button[data-tab="attendance"]').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      assert.equal(mutations.length, before, 'A duplicate event while pending cannot send another archive');
      assert.equal(await page.locator('#panel-notes').isVisible(), true);
      assert.equal(await page.locator('#session').inputValue(), rid(2));
    };
    await beginArchive();
    assert.equal(typeof releaseArchive, 'function');
    releaseArchive(false);
    await page.waitForFunction(() => !document.getElementById('session').disabled);
    assert.equal(await page.locator('#note-body').inputValue(), 'Fictional C draft preserved on failure');
    assert.equal(await page.locator('#note-body').isEnabled(), true);
    assert.equal(await page.locator('#note-cancel').isVisible(), true);
    assert.equal(await card('Saved fictional note C').count(), 1);
    assert.match(await page.locator('#global-error').innerText(), /Fictional archive unavailable/);
    checks++;

    await beginArchive();
    releaseArchive(true);
    await page.waitForFunction(() => !document.getElementById('session').disabled);
    assert.equal(await card('Saved fictional note C').count(), 0);
    assert.equal(await page.locator('#note-body').inputValue(), '', 'Successful archival resets only its active editor');
    assert.equal(await page.locator('#note-body').isEnabled(), true);
    assert.equal(await page.locator('#note-cancel').isVisible(), false);
    assert.equal(await page.locator('#note-title').innerText(), 'Add a coaching note');
    assert.equal(mutations.length, 2, 'One failed attempt and one explicit retry only');
    assert(mutations.every(item => item.path.endsWith('/notes/archive') && item.payload.id === 'fixture-note-c' && item.payload.expectedVersion === 1));
    assert.deepEqual(errors, []);
    checks++;
    console.log('Coach draft safety: ' + checks + ' grouped draft, cancellation, target and pending-archive checks passed. Fictional data only.');
  } finally {
    if (releaseArchive) releaseArchive(false);
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
