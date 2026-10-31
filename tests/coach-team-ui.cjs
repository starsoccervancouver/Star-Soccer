/* Full workspace, fictional accounts/rosters, and intercepted requests only. */
const assert = require('node:assert/strict'), fs = require('node:fs');
const { chromium } = require('playwright');
const { openDestination, leaveGroup } = require('./coach-fixture-navigation.cjs');
const origin = 'https://attendance.starsoccer.ca', rid = n => 'rec' + String(n).padStart(14, '0'), now = '2026-10-30T18:00:00Z';
const player = (n, name) => ({ playerId: rid(100 + n), name, age: 10, status: 'Confirmed', kind: 'weekly', actualAttendance: null, issues: [] });
const a = player(1, 'Fictional Alex'), b = player(2, 'Fictional Bailey'), c = player(3, 'Other group player'), unassigned = player(4, 'Unassigned player');
const row = (n, date, program, location, players) => ({ id: rid(n), programId: rid(program), date, time: '4:00–5:00 PM', location, players, status: 'Scheduled', capacity: 20, capacityUsed: players.length, expected: players.length, counts: { yes: 0, no: 0, awaiting: 0, confirmed: players.length }, issues: [] });
const sessions = [row(1, '2026-10-30', 800, 'Fictional West Field', [a]), row(2, '2026-11-06', 800, 'Fictional West Field', [a, b]), row(3, '2026-10-30', 801, 'Fictional North Field', [c]), row(4, '2026-11-13', 800, 'Fictional West Field', [unassigned])];
const accounts = [{ email: 'ada@example.test', name: 'Ada Fictional', role: 'coach', active: 1, assignments: [rid(1), rid(2), rid(999)] }, { email: 'bea@example.test', name: 'Bea Fictional', role: 'coach', active: 1, assignments: [rid(3)] }, { email: 'past@example.test', name: 'Past Fictional Coach', role: 'coach', active: 0, assignments: [] }, { email: 'viewer@example.test', name: 'Fictional Viewer', role: 'admin', active: 1, assignments: [] }];
const authoredNotes = Array.from({ length: 11 }, (_, n) => ({ id: 'note_ada_' + n, author_email: accounts[0].email, session_id: rid(1), player_id: n % 2 ? null : a.playerId, category: 'Observation', body: n === 0 ? 'Ada cue <img src=x onerror=alert(1)> stays literal.' : 'Ada coaching cue ' + n, updated_at: now })).concat([{ id: 'note_bea', author_email: accounts[1].email, session_id: rid(3), player_id: c.playerId, category: 'Goal', body: 'Bea only coaching note', updated_at: now }]);
const assets = {};
for (const [url, name, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + name, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' }; require('./coach-fixture-fonts.cjs')(assets);
(async () => {
  const browser = await chromium.launch();
  try {
    async function fixture(role = 'owner', hash = '') {
      const context = await browser.newContext({ viewport: { width: 1360, height: 900 } }), requests = [], errors = [], state = { failNotes: false, holdEmail: '', release: null };
      const profile = { email: 'viewer@example.test', name: 'Fictional Viewer', role, sessionVersion: 1 };
      await context.addInitScript(now => { const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } }; window.confirm = () => true; }, now);
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), asset = assets[url.pathname];
        if (url.origin !== origin) { errors.push('External request: ' + url.origin); return route.abort(); }
        if (asset) return route.fulfill({ contentType: asset.type, body: asset.body });
        const payload = request.postData() ? request.postDataJSON() : undefined; requests.push({ path: url.pathname, payload, method: request.method() });
        const endpoint = url.pathname.replace('/workspace/api/', ''); let value, status = 200;
        if (endpoint === 'bootstrap') value = { profile, csrfToken: 'fictional-team-csrf', googleEnabled: true };
        else if (endpoint === 'desk' || endpoint === 'refresh') value = { profile, sessions, notes: authoredNotes, tasks: [], observedAt: now };
        else if (endpoint === 'coaching-team') { if (profile.role === 'coach') { status = 403; value = { error: 'ACCESS_DENIED' }; } else value = { coaches: accounts }; }
        else if (endpoint === 'coaching-team/notes') {
          if (state.holdEmail === payload.email) await new Promise(resolve => { state.release = resolve; });
          if (state.failNotes) { status = 503; value = { error: 'TEMPORARY', message: 'Fictional notes unavailable' }; } else value = { notes: authoredNotes.filter(n => n.author_email === payload.email) };
        } else if (endpoint === 'session') value = { plan: { session_id: payload.sessionId, version: 1, content: {} }, notes: authoredNotes.filter(n => n.session_id === payload.sessionId) };
        else if (endpoint === 'logout') value = { signedOut: true };
        else if (endpoint === 'drills/list') value = { drills: [] };
        else if (endpoint === 'resources/list') value = { resources: [] };
        else if (endpoint === 'diagrams/list') value = { diagrams: [] };
        else { errors.push('Unexpected request: ' + endpoint); status = 403; value = { error: 'UNEXPECTED_FIXTURE' }; }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/workspace' + hash); await page.locator('#app').waitFor({ state: 'visible' }); await page.waitForFunction(() => !document.getElementById('refresh').disabled);
      return { context, page, requests, errors, profile, state };
    }
    const f = await fixture(), page = f.page;
    assert(!f.requests.some(r => r.path.endsWith('/coaching-team')), 'Directory loads only when opened');
    await openDestination(page, 'coaches'); await page.locator('[data-coach-email="ada@example.test"]').waitFor();
    assert.equal(await page.locator('#coaching-selected-name').textContent(), accounts[0].name);
    assert.equal(await page.locator('.coaching-group').count(), 1, 'Verified recurring assigned dates share one group');
    assert.equal(await page.locator('.coaching-player-list button').count(), 2, 'Players are deduplicated across assigned dates');
    assert.doesNotMatch(await page.locator('#coaching-coach-detail').textContent(), /Unassigned player|Other group player/);
    assert.match(await page.locator('#coaching-coach-detail').textContent(), /1 assigned session is outside/);
    await page.locator('#coaching-tab-notes').click(); await page.locator('[data-note-id="note_ada_0"]').waitFor();
    assert.equal(await page.locator('.coaching-note').count(), 10);
    assert.equal(await page.locator('.coaching-note img').count(), 0, 'Note content stays text');
    assert.match(await page.locator('.coaching-note').first().textContent(), /<img src=x/);
    assert.doesNotMatch(await page.locator('#coaching-notes').textContent(), /Bea only/);
    await page.locator('#coaching-notes-more').click(); assert.equal(await page.locator('.coaching-note').count(), 11);
    await page.locator('[data-coach-email="bea@example.test"]').click(); await page.locator('[data-note-id="note_bea"]').waitFor();
    f.state.holdEmail = 'ada@example.test'; await page.locator('[data-coach-email="ada@example.test"]').click();
    await page.waitForFunction(() => document.getElementById('coaching-notes').textContent.includes('Loading notes'));
    while (!f.state.release) await new Promise(resolve => setTimeout(resolve, 10));
    await page.locator('[data-coach-email="bea@example.test"]').click(); await page.locator('[data-note-id="note_bea"]').waitFor();
    const delayed = page.waitForResponse(r => r.url().endsWith('/coaching-team/notes') && r.request().postDataJSON().email === 'ada@example.test'); f.state.holdEmail = ''; f.state.release(); await delayed;
    assert.equal(await page.locator('#coaching-selected-name').textContent(), 'Bea Fictional'); assert.doesNotMatch(await page.locator('#coaching-notes').textContent(), /Ada coaching cue/);
    f.state.failNotes = true; await page.locator('[data-coach-email="ada@example.test"]').click(); await page.getByRole('button', { name: 'Retry notes', exact: true }).waitFor();
    f.state.failNotes = false; await page.getByRole('button', { name: 'Retry notes', exact: true }).click(); await page.locator('[data-note-id="note_ada_0"]').waitFor();
    await page.locator('#coaching-tab-groups').click();
    fs.mkdirSync('outputs', { recursive: true }); await page.screenshot({ path: 'outputs/coaching-team-desktop.png', fullPage: true });
    for (const width of [320, 390, 768, 1360]) { await page.setViewportSize({ width, height: 900 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No horizontal overflow at ' + width); assert(await page.locator('.coaching-coach').first().evaluate(n => n.getBoundingClientRect().height >= 44)); }
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: 'outputs/coaching-team-mobile.png', fullPage: true });
    await page.locator('.coaching-player-list [data-player-id="' + b.playerId + '"]').click(); await page.locator('#panel-notes').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#session').inputValue(), rid(2)); assert.equal(await page.locator('#note-player').inputValue(), b.playerId);
    await leaveGroup(page); await openDestination(page, 'coaches'); await page.locator('#coaching-team-search').fill('Past Fictional');
    assert.equal(await page.locator('.coaching-coach').count(), 1); await page.locator('.coaching-coach').click(); assert.match(await page.locator('#coaching-coach-detail').textContent(), /Inactive account|No groups are assigned/);
    await page.locator('#logout').click(); await page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#coaching-coach-list').textContent(), ''); assert.equal(await page.locator('#coaching-coach-detail').textContent(), '');
    assert.deepEqual(f.errors, []); assert(!f.requests.some(r => /\/users|\/save|\/assign/.test(r.path)), 'Read-only directory makes no management or write requests'); await f.context.close();
    const admin = await fixture('admin', '#view=coaches'); await admin.page.locator('[data-coach-email="ada@example.test"]').waitFor();
    await admin.page.reload(); await admin.page.locator('[data-coach-email="ada@example.test"]').waitFor(); assert.equal(new URL(admin.page.url()).hash, '#view=coaches');
    admin.profile.role = 'coach'; admin.profile.sessionVersion++; await admin.page.locator('#refresh').click(); await admin.page.waitForFunction(() => document.querySelector('[data-tab="coaches"]').hidden);
    assert.equal(await admin.page.locator('#coaching-coach-detail').textContent(), ''); assert.equal(await admin.page.locator('#panel-coaches').isVisible(), false); assert.deepEqual(admin.errors, []); await admin.context.close();
    const coach = await fixture('coach', '#view=coaches'); assert.equal(await coach.page.locator('[data-tab="coaches"]').isVisible(), false); assert.equal(await coach.page.locator('#panel-coaches').isVisible(), false); assert(!coach.requests.some(r => r.path.includes('/coaching-team'))); assert.deepEqual(coach.errors, []); await coach.context.close();
    console.log('Coaching team: owner/admin access, lazy reads, assignment/roster scope, authored notes, stale-response safety, retry, player links, mobile, deep links and sign-out passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
