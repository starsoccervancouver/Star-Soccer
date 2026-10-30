/* Isolated Coach Desk usability regressions. All data and clipboard writes are fictional. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const origin = 'https://attendance.starsoccer.ca';
  const now = '2026-12-31T20:00:00Z';
  const rid = n => 'rec' + String(n).padStart(14, '0');
  const profile = { email: 'owner@example.test', name: 'Fixture Owner', role: 'owner' };
  const assets = {};
  for (const [url, file, type] of [
    ['/workspace', 'workspace.html', 'text/html'],
    ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'],
    ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'],
    ['/assets/app.css', 'app.css', 'text/css'],
    ['/assets/logo.svg', 'logo.svg', 'image/svg+xml'],
  ]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
  assets['/workspace/assets/passkeys.js'] = {
    body: fs.readFileSync('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', 'utf8'),
    type: 'text/javascript',
  };
  require('./coach-fixture-fonts.cjs')(assets);
  const player = (n, name, actualAttendance) => ({
    playerId: rid(100 + n), attendanceId: rid(200 + n), name,
    kind: 'dropin', status: 'Attending', response: 'yes', actualAttendance, issues: [],
  });
  const players = [
    player(1, 'Fictional Maya Chen', 'Not marked'),
    player(2, 'Fictional Noah Rivera', 'Present'),
    player(3, 'Fictional Ari Patel', 'Absent'),
  ];
  const session = (id, date, roster) => ({
    id: rid(id), date, time: '4:00 PM', location: 'Fictional field', status: 'Scheduled',
    capacity: 20, capacityUsed: roster.length, registered: roster.length, expected: roster.length,
    counts: { yes: roster.length, no: 0, awaiting: 0, confirmed: 0 }, players: roster, issues: [],
  });
  const sessions = [
    session(1, '2026-12-31', players),
    session(2, '2027-01-01', [player(4, 'Fictional Friday Player', 'Not marked')]),
  ];
  const { openSession, leaveGroup } = require('./coach-fixture-navigation.cjs');
  const users = [
    { ...profile, active: true, assignments: [] },
    { email: 'coach@example.test', name: 'Fixture Coach', role: 'coach', active: true, assignments: [rid(1)] },
    { email: 'disabled@example.test', name: 'Disabled Fixture', role: 'coach', active: false, assignments: [] },
  ];
  const browser = await chromium.launch();
  let checks = 0;
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ now }) => {
      const BaseDate = Date;
      const ms = BaseDate.parse(now);
      window.Date = class extends BaseDate {
        constructor(...args) { super(...(args.length ? args : [ms])); }
        static now() { return ms; }
      };
      // This replaces only the fixture page's clipboard; the system clipboard is never used.
      window.fixtureClipboard = [];
      window.fixtureClipboardBlocked = false;
      Object.defineProperty(navigator, 'clipboard', { value: {
        writeText: async value => {
          if (window.fixtureClipboardBlocked) throw new Error('Fixture clipboard denied');
          window.fixtureClipboard.push(value);
        },
      } });
    }, { now });
    const requests = [];
    let signedIn = true;
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      assert.equal(url.origin, origin, 'No live network permitted');
      requests.push({ path: url.pathname, method: request.method() });
      const asset = assets[url.pathname];
      if (asset) return route.fulfill({ status: 200, contentType: asset.type, body: asset.body });
      let value;
      if (url.pathname === '/workspace/api/session') value = { plan: { version: 0, content: {} } };
      else if (request.method() === 'POST') {
        assert.equal(url.pathname, '/workspace/api/logout', 'Usability controls must not write business records or issue enrollment tokens');
        signedIn = false;
        value = { signedOut: true };
      } else if (url.pathname === '/workspace/api/bootstrap') {
        value = { profile: signedIn ? profile : null, csrfToken: 'fixture-csrf', googleEnabled: true };
      } else if (url.pathname === '/workspace/api/desk') {
        value = { profile, sessions, notes: [], tasks: [], observedAt: now };
      } else if (url.pathname === '/workspace/api/users') {
        value = { users, credentials: [] };
      } else throw new Error('Unexpected fixture request ' + url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    await page.goto(origin + '/workspace');
    await page.locator('#app').waitFor({ state: 'visible' });
    await openSession(page, sessions, rid(1), 'attendance');

    const rows = page.locator('#roster .roster-row');
    assert.equal(await rows.count(), 3);
    assert.deepEqual(await rows.locator('.attendance-status').allTextContents(), ['Not marked', 'Present', 'Absent']);
    assert.deepEqual(await rows.locator('button.current').allTextContents(), ['Not marked', 'Present', 'Absent']);
    assert.equal(await page.getByRole('button', { name: 'Reset', exact: true }).count(), 0);
    for (const row of await rows.all()) {
      assert.equal(await row.locator('button[aria-pressed="true"]').count(), 1);
    }
    checks++;

    // An unmarked child must not have the same green status treatment as a present child.
    const unmarked = rows.filter({ hasText: 'Fictional Maya Chen' });
    assert.equal(await unmarked.locator('button.current.unmarked').count(), 1);
    assert.equal(await unmarked.locator('.attendance-status.status-unmarked').count(), 1);
    const buttonColors = await rows.locator('button.current').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).backgroundColor));
    assert.notEqual(buttonColors[0], buttonColors[1]);
    assert.notEqual(buttonColors[0], buttonColors[2]);
    checks++;

    const search = page.getByRole('searchbox', { name: 'Find a player' });
    const clear = page.getByRole('button', { name: 'Clear search', exact: true });
    assert.equal(await search.isEnabled(), true);
    assert.equal(await clear.isVisible(), false);
    assert.equal(await page.locator('#roster-search-count').innerText(), '3 players');
    const originalStats = await page.locator('#attendance-stats').innerText();
    await search.fill('  mAyA cHeN  ');
    assert.equal(await rows.count(), 1);
    assert.equal(await rows.locator('strong').innerText(), 'Fictional Maya Chen');
    assert.equal(await page.locator('#roster-search-count').innerText(), '1 of 3 players shown');
    assert.equal(await page.locator('#attendance-stats').innerText(), originalStats, 'Search must not change session totals');
    checks++;

    await search.fill('No fictional match');
    assert.equal(await rows.count(), 0);
    assert.equal(await page.locator('#roster-search-count').innerText(), '0 of 3 players shown');
    assert.match(await page.locator('#roster').innerText(), /No players match these filters/);
    await clear.click();
    assert.equal(await page.locator('#roster-search').inputValue(), '');
    assert.equal(await rows.count(), 3);
    assert.equal(await clear.isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'roster-search');
    checks++;

    await search.fill('Maya');
    await openSession(page, sessions, rid(2), 'attendance');
    assert.equal(await search.inputValue(), '', 'Selecting another session must restore that full roster');
    assert.equal(await page.locator('#roster-search-count').innerText(), '1 player');
    assert.equal(await rows.locator('strong').innerText(), 'Fictional Friday Player');
    checks++;

    await page.setViewportSize({ width: 390, height: 844 });
    await search.fill('Friday');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert.equal(await clear.isVisible(), true);
    checks++;

    await leaveGroup(page); await page.getByRole('button', { name: 'Settings & profile', exact: true }).click();
    await page.getByRole('button', { name: 'Team & access', exact: true }).click();
    await page.locator('#user-list .account-row').first().waitFor();
    const signinLinks = page.getByRole('button', { name: 'Copy sign-in link', exact: true });
    assert.equal(await signinLinks.count(), 2, 'Only active accounts receive a sign-in-link action');
    assert.equal(await page.getByRole('button', { name: 'Copy setup link', exact: true }).count(), 0);
    assert.match(await page.locator('#team-signin-help').innerText(), /Continue with Google/);
    assert.match(await page.locator('#team-signin-help').innerText(), /No email is sent automatically/);
    checks++;

    await signinLinks.first().click();
    await signinLinks.nth(1).click();
    assert.deepEqual(await page.evaluate(() => window.fixtureClipboard), [origin + '/workspace', origin + '/workspace']);
    assert.match(await page.locator('#notice').innerText(), /Approved coaches can choose Continue with Google/);
    assert.equal(requests.filter(request => request.path.includes('/users/invite')).length, 0);
    assert.equal(requests.filter(request => request.method === 'POST' && !request.path.endsWith('/session')).length, 0);
    checks++;

    await page.evaluate(() => { window.fixtureClipboardBlocked = true; });
    await signinLinks.first().click();
    await page.locator('#global-error').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#global-error').innerText(), 'Open attendance.starsoccer.ca/workspace and choose Continue with Google.');
    assert.equal(requests.filter(request => request.method === 'POST' && !request.path.endsWith('/session')).length, 0);
    checks++;

    await openSession(page, sessions, rid(2), 'attendance');
    await search.fill('Friday');
    await leaveGroup(page); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#roster-search').inputValue(), '');
    assert.equal(await page.locator('#roster').innerText(), '');
    assert.equal(await page.locator('#roster-search-count').innerText(), '');
    assert.equal(await page.locator('#user-list').innerText(), '');
    assert.equal(await page.getByRole('button', { name: 'Continue with Google', exact: true }).isVisible(), true);
    assert.equal(await page.locator('#enroll-options').isVisible(), false);
    assert.deepEqual(requests.filter(request => request.method === 'POST' && !request.path.endsWith('/session')).map(request => request.path), ['/workspace/api/logout']);
    checks++;

    console.log('Coach Desk quality of life UI: ' + checks + ' isolated status, search, clear, session reset, mobile, stable Google-link and logout checks passed. No live network, business writes, emails or system clipboard used.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
