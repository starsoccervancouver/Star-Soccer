/* Group-first attendance navigation with fictional rosters and intercepted transport only. */
const assert = require('node:assert/strict'), fs = require('node:fs'), { chromium } = require('playwright');
const { openSession, openView, leaveGroup } = require('./coach-fixture-navigation.cjs');
(async () => {
  const origin = 'https://attendance.starsoccer.ca', now = '2026-12-31T20:00:00Z';
  const rid = n => 'rec' + String(n).padStart(14, '0');
  const profile = { email: 'owner@example.test', name: 'Fixture Owner', role: 'owner' }, assets = {};
  for (const [url, file, type] of [['/workspace','workspace.html','text/html'],['/workspace/assets/workspace.css','workspace.css','text/css'],['/workspace/assets/workspace.js','workspace.js','text/javascript'],['/assets/app.css','app.css','text/css'],['/assets/logo.svg','logo.svg','image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
  assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
  require('./coach-fixture-fonts.cjs')(assets);
  const player = n => ({ playerId: rid(100+n), attendanceId: rid(200+n), name: n === 6 ? 'Historic Player' : 'Fixture Player ' + n, kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] });
  const session = (n, date, time = '4:00 PM', players = [], status = 'Scheduled') => ({ id: rid(n), programId: rid(900), date, time, location: 'Fictional field', status, capacity: 20, capacityUsed: players.length, expected: players.length, counts: { yes: 0, no: 0, awaiting: players.length, confirmed: 0 }, issues: [], players });
  const sessions = [session(8,'2026-12-23','4:00 PM',[player(8)],'Cancelled'), session(7,'2026-12-27','9:00 AM',[player(7)]), session(6,'2026-12-30','4:00 PM',[player(6)]), session(2,'2026-12-31'), session(3,'2027-01-01','3:00 PM',[player(3)]), session(4,'2027-01-01','5:00 PM',[player(4)]), session(5,'2027-01-03','9:00 AM',[],'Cancelled'), session(1,'2027-01-06','4:00 PM',[player(1)]), session(9,'2027-01-08','3:00 PM',[player(9)])];
  const browser = await chromium.launch(); let checks = 0;
  async function fixture(rows = sessions, role = 'owner', allowMark = false) {
    const context = await browser.newContext();
    await context.addInitScript(now => { const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } }; }, now);
    const writes = [], errors = []; let releaseMark;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()); assert.equal(url.origin, origin, 'No live network');
      if (assets[url.pathname]) return route.fulfill({ status: 200, contentType: assets[url.pathname].type, body: assets[url.pathname].body });
      let value;
      if (url.pathname.endsWith('/bootstrap')) value = { profile: { ...profile, role }, csrfToken: 'fictional-csrf', googleEnabled: true };
      else if (url.pathname.endsWith('/desk')) value = { profile: { ...profile, role }, sessions: rows, notes: [], tasks: [], observedAt: now };
      else if (url.pathname.endsWith('/session')) value = { plan: { version: 0, content: {} } };
      else if (allowMark && url.pathname.endsWith('/attendance')) { const payload = request.postDataJSON(); writes.push(payload); await new Promise(resolve => { releaseMark = resolve; }); value = { saved: true, status: payload.status }; }
      else throw Error('Unexpected fixture request: ' + url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/workspace'); await page.locator('#app').waitFor({ state: 'visible' });
    return { page, context, writes, errors, release: () => releaseMark?.() };
  }
  try {
    const f = await fixture(), page = f.page;
    await page.locator('#navigation [data-tab="plan"]').click();
    assert.equal(await page.locator('#planner-session-browser').isVisible(), true);
    assert.equal(await page.locator('#panel-attendance').isVisible(), false, 'Attendance starts at a training group, never a global dated roster');
    assert.equal(await page.locator('#planner-days [data-group-key]').count(), 5, 'Different Friday time slots stay separate groups'); checks++;
    await openSession(page, sessions, rid(1), 'attendance');
    assert.equal(await page.locator('#session-toolbar').isVisible(), false);
    await page.locator('#planner-focus-date').click();
    const dates = await page.locator('#planner-date option').evaluateAll(options => options.filter(o => o.value).map(o => o.value));
    assert.deepEqual(new Set(dates), new Set([rid(8), rid(6), rid(1)]));
    assert(!dates.includes(rid(3)), 'Only dates from the Wednesday group are offered'); checks++;
    await openSession(page, sessions, rid(6), 'attendance'); await page.locator('#roster').getByText('Historic Player', { exact: true }).waitFor();
    assert.match(await page.locator('#roster-title').innerText(), /Dec 30/); checks++;
    await openSession(page, sessions, rid(8), 'attendance');
    assert.equal(await page.locator('#roster').getByRole('button', { name: 'Present', exact: true }).isDisabled(), true);
    await openView(page, 'notes'); assert.equal(await page.locator('#note-body').isDisabled(), true, 'Cancelled historical dates remain read-only'); checks++;
    await openSession(page, sessions, rid(1), 'attendance'); assert(!(await page.locator('#roster').innerText()).includes('Historic Player')); checks++;
    await openSession(page, sessions, rid(3), 'attendance'); await page.locator('#roster').getByText('Fixture Player 3', { exact: true }).waitFor();
    await page.locator('#planner-focus-date').click();
    assert.deepEqual(new Set(await page.locator('#planner-date option').evaluateAll(options => options.filter(o => o.value).map(o => o.value))), new Set([rid(3), rid(9)]));
    await openSession(page, sessions, rid(4), 'attendance'); await page.locator('#roster').getByText('Fixture Player 4', { exact: true }).waitFor(); checks++;
    await openSession(page, sessions, rid(2), 'attendance'); assert.match(await page.locator('#roster').innerText(), /No named players|No players/); checks++;
    await page.setViewportSize({ width: 390, height: 844 }); assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: 'outputs/attendance-upcoming-week-fictional-mobile.png', fullPage: true });
    assert.equal(f.writes.length, 0); assert.deepEqual(f.errors, []); await f.context.close(); checks++;
    const coach = await fixture([sessions.find(s => s.id === rid(3))], 'coach');
    await coach.page.locator('#navigation [data-tab="plan"]').click();
    assert.equal(await coach.page.locator('#planner-days [data-group-key]').count(), 1);
    await openSession(coach.page, sessions, rid(3), 'attendance');
    assert(!(await coach.page.locator('body').innerText()).includes('Historic Player'));
    await coach.page.locator('#planner-focus-date').click(); assert.equal(await coach.page.locator('#planner-date option').count(), 1);
    assert.equal(coach.writes.length, 0); assert.deepEqual(coach.errors, []); await coach.context.close(); checks++;
    const pendingRows = [session(2,'2026-12-31','4:00 PM',[player(2)]),session(3,'2027-01-01','4:00 PM',[player(3)])];
    const pending = await fixture(pendingRows, 'owner', true);
    await openSession(pending.page, pendingRows, rid(2), 'attendance');
    await pending.page.locator('#roster').getByRole('button', { name: 'Present', exact: true }).click();
    await pending.page.waitForFunction(() => document.querySelector('#planner-back').disabled);
    assert.equal(pending.writes.length, 1); assert.equal(pending.writes[0].sessionId, rid(2));
    assert.equal(await pending.page.locator('#planner-focus-date').isDisabled(), true);
    assert.equal(await pending.page.locator('#session-workspace-tabs [data-session-view="notes"]').isDisabled(), true);
    pending.release(); await pending.page.locator('#roster button.current').getByText('Present', { exact: true }).waitFor();
    assert.equal(await pending.page.locator('#planner-back').isDisabled(), false);
    assert.deepEqual(pending.errors, []); await pending.context.close(); checks++;
    console.log('Attendance group/history UI: ' + checks + ' isolated group, date, cancellation, role-scope, pending-save and mobile checks passed.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
