/* Fictional rosters only. Every request is intercepted; no production connections. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { leaveGroup, openDestination } = require('./coach-fixture-navigation.cjs');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-30T18:00:00Z';
const rid = n => 'rec' + String(n).padStart(14, '0');
const profile = { email: 'coach@example.test', name: 'Preview Coach', role: 'coach', sessionVersion: 1 };
const player = (id, name, actualAttendance = 'Not marked') => ({ playerId: rid(id), attendanceId: rid(id + 100), name, age: 9, kind: 'dropin', status: 'Confirmed', actualAttendance });
const session = (id, date, programId, players, status = 'Scheduled') => ({ id: rid(id), programId: rid(programId), date, time: '4:00–5:00 PM', location: 'Preview field', players, status, capacity: 20, expected: players.length, capacityUsed: players.length, counts: { yes: 1, no: 0, confirmed: 0, awaiting: 0 }, issues: [] });
const sessions = [
  session(1, '2026-10-28', 800, [player(101, 'Preview Maya', 'Present'), player(102, 'Preview Noah')]),
  session(2, '2026-11-04', 800, [player(101, 'Preview Maya', 'Present')]),
  session(3, '2026-10-21', 800, [player(101, 'Preview Maya', 'Absent')]),
  session(4, '2026-10-14', 800, [player(101, 'Preview Maya', 'Present')], 'Cancelled'),
  session(5, '2026-10-29', 801, [player(101, 'Preview Maya')]),
  session(6, '2026-10-30', 802, [player(103, 'Preview Maya')]),
];
const note = (id, sessionId, playerId, body, category = 'General', author = profile.email) => ({ id, session_id: rid(sessionId), player_id: playerId ? rid(playerId) : null, body, category, author_email: author, updated_at: now, version: 1 });
const notes = [note('goal', 1, 101, 'Look up before receiving.', 'Goal'), note('own', 3, 101, 'Improved passing angles.'), note('other-group', 5, 101, 'Thursday finishing focus.'), note('other-player', 1, 102, 'Other player private note.'), note('foreign', 1, 101, 'Another coach private note.', 'General', 'other@example.test'), note('group', 1, null, 'Group-only observation.'), note('inaccessible', 999, 101, 'Outside assigned roster.')];
const assets = {}; require('./coach-fixture-fonts.cjs')(assets);
for (const [route, file, type] of [['/workspace','workspace.html','text/html'],['/workspace/assets/workspace.js','workspace.js','text/javascript'],['/workspace/assets/workspace.css','workspace.css','text/css'],['/assets/app.css','app.css','text/css'],['/assets/logo.svg','logo.svg','image/svg+xml']]) assets[route] = { body: fs.readFileSync('private-attendance/web/' + file), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(now => { const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } }; }, now);
    const requests = [], errors = []; let signedIn = true;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), payload = request.postData() ? request.postDataJSON() : null;
      if (url.origin !== origin) { errors.push('Unexpected external request'); return route.abort(); }
      if (assets[url.pathname]) return route.fulfill({ status: 200, contentType: assets[url.pathname].type, body: assets[url.pathname].body });
      requests.push({ path: url.pathname, payload }); let value;
      if (url.pathname.endsWith('/bootstrap')) value = { profile: signedIn ? profile : null, csrfToken: 'preview', googleEnabled: true };
      else if (url.pathname.endsWith('/desk')) value = { profile, sessions, notes, tasks: [], observedAt: now };
      else if (url.pathname.endsWith('/session')) value = { plan: { version: 0, content: {} } };
      else if (url.pathname.endsWith('/logout')) { signedIn = false; value = { signedOut: true }; }
      else { errors.push('Unexpected request: ' + url.pathname); return route.fulfill({ status: 403, json: { error: 'UNEXPECTED' } }); }
      return route.fulfill({ status: 200, json: value });
    });
    const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/workspace'); await page.locator('#app').waitFor({ state: 'visible' });
    await openDestination(page, 'profiles');
    assert.equal(await page.locator('#profiles-list .player-directory-card').count(), 3, 'IDs distinguish players with the same name: '+JSON.stringify({errors,count:await page.locator('#profiles-count').textContent()}));
    assert.equal(requests.filter(r => !/\/(bootstrap|desk)$/.test(r.path)).length, 0, 'Profiles reuse loaded records without extra reads');
    await page.locator('#profiles-search').fill('Noah'); assert.equal(await page.locator('.player-directory-card').count(), 1);
    await page.locator('#profiles-search').fill('Maya'); assert.equal(await page.locator('.player-directory-card').count(), 2);
    await page.locator('#profiles-search').fill(''); await page.screenshot({ path: 'outputs/coach-player-directory.png', fullPage: true });
    await page.locator('[data-profile-id="' + rid(101) + '"]').click();
    let text = await page.locator('#player-profile-detail').innerText();
    assert.match(text, /Look up before receiving/); assert.match(text, /Improved passing angles/);
    assert.doesNotMatch(text, /Thursday finishing|Other player private|Another coach private|Group-only|Outside assigned/);
    assert.deepEqual(await page.locator('.profile-stats strong').allTextContents(), ['1','1','0'], 'Cancelled and future dates do not count as physical attendance');
    await page.locator('.profile-history summary').click(); assert.equal(await page.locator('.profile-history-row').count(), 2);
    assert.equal(await page.locator('#profile-group').count(), 0, 'Profile does not show a second group dropdown');
    await page.locator('#profile-back').click();
    const otherGroup = await page.evaluate(session => CoachGroups.key(session), sessions[4]);
    const firstGroup = await page.evaluate(session => CoachGroups.key(session), sessions[0]);
    await page.locator('#profiles-filter').selectOption(otherGroup); await page.locator('[data-profile-id="' + rid(101) + '"]').click(); text = await page.locator('#player-profile-detail').innerText();
    assert.match(text, /Thursday finishing/); assert.doesNotMatch(text, /Look up before receiving|Improved passing/);
    await page.locator('#profile-back').click(); await page.locator('#profiles-filter').selectOption(firstGroup); await page.locator('[data-profile-id="' + rid(101) + '"]').click();
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({ path: 'outputs/coach-player-profile.png', fullPage: true });
    for (const width of [320, 390, 768]) { await page.setViewportSize({ width, height: 844 }); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'Profile fits at ' + width); }
    await page.screenshot({ path: 'outputs/coach-player-profile-mobile.png', fullPage: true });
    await page.locator('#profile-open-notes').click(); await page.locator('#panel-notes').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#session').inputValue(), rid(2), 'Opens next roster date in the chosen group');
    assert.equal(await page.locator('#note-player').inputValue(), rid(101), 'Opens the exact player folder');
    assert.match(await page.locator('#note-list').innerText(), /Look up before receiving/);
    await leaveGroup(page); await openDestination(page, 'profiles');
    assert.equal(await page.locator('#player-profile-detail h2').innerText(), 'Preview Maya', 'Profile remains selected when returning');
    await page.locator('#profile-back').click(); await page.locator('#profiles-search').fill('Nobody'); assert.equal(await page.locator('.player-directory-card').count(), 0);
    await page.locator('#profiles-search').fill(''); await page.locator('#profiles-filter').selectOption(firstGroup); assert.equal(await page.locator('.player-directory-card').count(), 2);
    profile.role = 'owner'; await page.reload(); await openDestination(page, 'profiles'); await page.locator('[data-profile-id="' + rid(101) + '"]').click();
    text = await page.locator('#player-profile-detail').innerText(); assert.match(text, /Another coach private/); assert.doesNotMatch(text, /Outside assigned|Other player private/);
    await page.locator('#logout').click(); await page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#profiles-list').textContent(), ''); assert.equal(await page.locator('#player-profile-detail').textContent(), '');
    assert.equal(requests.some(r => /\/(save|archive|mark|refresh)$/.test(r.path)), false, 'Profile browsing never writes business data');
    assert.deepEqual(errors, []); await context.close();
    console.log('Player profiles: directory, scoped notes/goals, attendance, exact navigation, roles, mobile, logout and no-write checks passed. Mock data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
