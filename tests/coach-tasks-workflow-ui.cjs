/* Retired task navigation and its player-goal replacement. Fictional records only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { openDestination } = require('./coach-fixture-navigation.cjs');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const rid = n => 'rec' + String(n).padStart(14, '0');
const sessions = [{ id: rid(1), programId: rid(900), date: '2026-10-29', time: '4:00–5:00 PM', location: 'Fictional field', status: 'Scheduled', capacity: 20, capacityUsed: 1, expected: 1, counts: { yes: 0, no: 0, awaiting: 1, confirmed: 0 }, issues: [], players: [{ playerId: rid(101), attendanceId: rid(201), name: 'Fictional Player', kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] }] }];
const assets = {};
for (const [url, file, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);

(async () => {
  const browser = await chromium.launch();
  try {
    for (const role of ['owner', 'coach']) for (const width of [1365, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } }), requests = [], errors = [];
      const profile = { email: 'fictional-task-retirement@example.test', name: 'Fictional Coach', role };
      await context.addInitScript(now => {
        const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } };
        localStorage.setItem('coach-desk-display-v1', JSON.stringify({ start: 'tasks', textSize: 'standard', sessionView: 'grid' }));
      }, now);
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        assert.equal(url.origin, origin, 'No live network permitted');
        const asset = assets[url.pathname]; if (asset) return route.fulfill({ contentType: asset.type, body: asset.body });
        requests.push(url.pathname);
        let value;
        if (url.pathname.endsWith('/bootstrap')) value = { profile, csrfToken: 'fictional-csrf', googleEnabled: true };
        else if (url.pathname.endsWith('/desk')) value = { profile, sessions, notes: [], tasks: [{ id: 'old-task', title: 'Retired fictional follow-up', status: 'open', due_date: '2026-10-20', author_email: profile.email, session_id: rid(1), version: 1 }], observedAt: now };
        else if (url.pathname.endsWith('/session')) value = { plan: { version: 0, content: {} } };
        else throw Error('Unexpected read or mutation: ' + url.pathname);
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/workspace#view=tasks'); await page.locator('#panel-home').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.getElementById('refresh').disabled);
      assert.equal(new URL(page.url()).hash, '#view=home', 'Retired routes and saved starting-page choices return to Overview');
      assert.equal(await page.locator('#navigation [data-tab="tasks"]').count(), 0);
      assert.equal(await page.locator('#preference-start option[value="tasks"]').count(), 0);
      assert.equal(await page.locator('#panel-tasks').isVisible(), false);
      assert.equal(await page.locator('#home-followups').innerText(), '');
      assert.doesNotMatch(await page.locator('#home-stats').innerText(), /follow-ups/i);
      assert.equal(await page.getByText('Retired fictional follow-up', { exact: true }).isVisible(), false);
      await openDestination(page, 'profiles');
      await page.locator('[data-profile-id="' + rid(101) + '"]').click();
      await page.locator('#profile-add-goal').click();
      assert.equal(await page.locator('#profile-note-category').inputValue(), 'Goal', 'Development goals remain available from the player profile');
      assert.equal(await page.locator('#profile-note-form').isVisible(), true);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert(!requests.some(path => /save$|archive$|tasks/.test(path)), 'Opening the current workflow never writes a record');
      assert.deepEqual(errors, []); await context.close();
    }
    console.log('Retired tasks: hidden controls, old route/preference fallback, legacy-data exclusion and player-goal replacement passed for owner/coach on desktop/mobile. No writes or live traffic.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
