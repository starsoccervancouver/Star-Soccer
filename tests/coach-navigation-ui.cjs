/* Private navigation with fictional authentication and local-only transport. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { openDestination } = require('./coach-fixture-navigation.cjs');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const rid = n => 'rec' + String(n).padStart(14, '0');
const rows = [1, 2, 3].map((n, i) => ({ id: rid(n), programId: rid(800), date: ['2026-10-29', '2026-10-22', '2026-11-05'][i], time: '4:00–5:00 PM', location: 'Fictional field', status: 'Scheduled', players: [], capacity: 20, capacityUsed: 0, expected: 0, counts: { yes: 0, no: 0, awaiting: 0, confirmed: 0 }, issues: [] }));
const assets = {};
for (const [url, name, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + name, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);

(async () => {
  const browser = await chromium.launch();
  try {
    async function fixture(hash = '', role = 'coach') {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), requests = [], errors = [];
      const profile = { email: 'fictional-navigation@example.test', name: 'Fictional Coach', role, sessionVersion: 1 };
      await context.addInitScript(now => {
        const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } };
        window.fixtureAnswers = []; window.fixturePrompts = [];
        window.confirm = text => { fixturePrompts.push(text); return fixtureAnswers.shift() === true; };
      }, now);
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin !== origin) { errors.push('Unexpected external request: ' + url.origin); return route.abort(); }
        const asset = assets[url.pathname];
        if (asset) return route.fulfill({ contentType: asset.type, body: asset.body });
        const payload = request.postData() ? request.postDataJSON() : undefined;
        requests.push({ path: url.pathname, payload });
        let value;
        if (url.pathname.endsWith('/bootstrap')) value = { profile, csrfToken: 'fictional-navigation-csrf', googleEnabled: true };
        else if (url.pathname.endsWith('/desk')) value = { profile, sessions: rows, notes: [], tasks: [], observedAt: now };
        else if (url.pathname.endsWith('/session') && rows.some(row => row.id === payload.sessionId)) value = { plan: { session_id: payload.sessionId, version: 1, content: { focus: 'Saved focus ' + payload.sessionId } } };
        else if (url.pathname.endsWith('/drills/list')) value = { drills: [] };
        else if (url.pathname.endsWith('/resources/list')) value = { resources: [] };
        else if (url.pathname.endsWith('/diagrams/list')) value = { diagrams: [] };
        else { errors.push('Unexpected or unauthorized request: ' + url.pathname); return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'UNEXPECTED_FIXTURE' }) }); }
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/workspace' + hash); await page.locator('#app').waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.getElementById('refresh').disabled);
      return { context, page, requests, errors };
    }
    const planHash = '#view=plan&session=' + rid(2) + '&section=plan';
    const f = await fixture(planHash);
    await f.page.locator('#planner-workspace').waitFor({ state: 'visible' });
    await f.page.waitForFunction(id => document.getElementById('session').value === id && !document.getElementById('plan-focus').disabled, rid(2));
    assert.equal(new URL(f.page.url()).hash, planHash, 'Initial context keeps the requested historical date');
    assert.equal(await f.page.locator('#plan-focus').inputValue(), 'Saved focus ' + rid(2));
    await f.page.reload(); await f.page.locator('#planner-workspace').waitFor({ state: 'visible' });
    await f.page.waitForFunction(() => !document.getElementById('plan-focus').disabled);
    assert.equal(await f.page.locator('#session').inputValue(), rid(2), 'Reload restores the exact authorized date');
    await f.page.locator('[data-session-view="attendance"]').click();
    await f.page.waitForURL('**#view=plan&session=' + rid(2) + '&section=attendance');
    await f.page.goBack(); await f.page.locator('#session-plan-section').waitFor({ state: 'visible' });
    assert.equal(new URL(f.page.url()).hash, planHash, 'Back restores the previous workspace section');
    await f.page.goForward(); await f.page.locator('#panel-attendance').waitFor({ state: 'visible' });
    await f.page.locator('[data-session-view="plan"]').click();
    await f.page.locator('#plan-focus').fill('Keep this unsaved plan');
    await f.page.evaluate(() => { location.hash = 'view=home'; });
    await f.page.waitForFunction(() => fixturePrompts.length > 0);
    assert.equal(await f.page.locator('#plan-focus').inputValue(), 'Keep this unsaved plan');
    assert.equal(new URL(f.page.url()).hash, planHash, 'Rejected hash navigation restores the current URL');
    assert.equal(await f.page.locator('#session-plan-section').isVisible(), true);
    await f.page.evaluate(() => { fixtureAnswers.push(true); location.hash = 'view=library'; });
    await f.page.locator('#panel-library').waitFor({ state: 'visible' });
    assert.equal(new URL(f.page.url()).hash, '#view=library');
    await f.page.reload(); await f.page.locator('#panel-library').waitFor({ state: 'visible' });
    assert.equal(new URL(f.page.url()).hash, '#view=library', 'Resource route survives reload');
    await openDestination(f.page, 'profiles');
    await f.page.waitForURL('**#view=profiles');
    await f.page.goBack(); await f.page.locator('#panel-library').waitFor({ state: 'visible' });
    await f.page.goForward(); await f.page.locator('#panel-profiles').waitFor({ state: 'visible' });
    assert.deepEqual(f.errors, []); await f.context.close();

    for (const hash of ['#view=plan&session=' + rid(99) + '&section=plan', '#view=team', '#view=activity', '#view=legacy', '#view=plan&session=javascript%3Aalert(1)&section=plan', '#view=%3Cscript%3Ealert(1)%3C%2Fscript%3E']) {
      const denied = await fixture(hash);
      await denied.page.waitForFunction(() => ['#view=home', '#view=plan'].includes(location.hash)).catch(error => { throw new Error('Denied route ' + hash + ' stayed at ' + denied.page.url(), { cause: error }); });
      assert(await denied.page.locator('#panel-home').isVisible() || await denied.page.locator('#planner-session-browser').isVisible(), 'Denied route falls back to an authorized overview: ' + hash);
      assert.equal(await denied.page.locator('#planner-workspace').isVisible(), false);
      assert(!denied.requests.some(request => request.payload?.sessionId === rid(99)), 'Unknown date is never fetched');
      assert(!denied.requests.some(request => /\/(?:users|activity|legacy|save|attendance)$/.test(request.path)), 'No privileged or write request');
      assert.deepEqual(denied.errors, []); await denied.context.close();
    }
    console.log('PASS: authenticated deep links, exact date/section reload, resource reload, Back/Forward, draft rejection, unauthorized and malicious route guards. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
