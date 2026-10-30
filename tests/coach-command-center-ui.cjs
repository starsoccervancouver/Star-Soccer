/* Factual next actions and isolated club workspace regressions. No live requests. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T19:00:00Z';
  const rid = n => 'rec' + String(n).padStart(14, '0');
  const profile = { email: 'coach@example.test', name: 'Alex Morgan · Preview coach', role: 'coach' };
  const player = (id, name, actualAttendance = 'Not marked') => ({ playerId: rid(id), attendanceId: rid(id + 100), name, kind: 'dropin', status: 'Attending', actualAttendance, issues: [] });
  const session = (id, date, players) => ({ id: rid(id), date, time: '4:00–5:00 PM', location: 'Preview training field', status: 'Scheduled', capacity: 20, capacityUsed: players.length, expected: players.length, counts: { yes: players.length, no: 0, awaiting: 0, confirmed: 0 }, players, issues: [] });
  const sessions = [session(1, '2026-10-29', [player(101, 'Preview Maya'), player(102, 'Preview Sam'), player(103, 'Preview Noah')]), session(2, '2026-10-28', [player(101, 'Preview Maya', 'Present'), player(102, 'Preview Sam')]), session(3, '2026-10-30', [player(101, 'Preview Maya'), player(102, 'Preview Sam')]), session(4, '2026-11-01', [player(103, 'Preview Noah')]), session(5, '2026-09-02', [player(102, 'Preview Sam')])];
  const notes = [
    { id: 'note1', session_id: rid(1), player_id: rid(101), category: 'Goal', body: 'Preview observation: try checking the space before receiving.', review_date: '2026-10-28', author_email: profile.email, updated_at: now, version: 1 },
    { id: 'note2', session_id: rid(1), player_id: rid(102), category: 'Confidence', body: 'Preview observation: encouraged teammates during the game.', review_date: '2026-11-05', author_email: profile.email, updated_at: now, version: 1 },
  ];
  const tasks = [
    { id: 'task1', session_id: rid(1), title: 'Prepare the small-sided game', due_date: '2026-10-28', status: 'open', author_email: profile.email, version: 1 },
    { id: 'task2', session_id: rid(1), title: 'Pack bibs and spare footballs', due_date: '2026-10-29', status: 'open', author_email: profile.email, version: 1 },
    { id: 'task3', session_id: rid(1), title: 'Completed preview follow-up', due_date: '2026-10-27', status: 'done', author_email: profile.email, version: 1 },
  ];
  const assets = {};
  for (const [url, file, type] of [['/workspace','workspace.html','text/html'],['/workspace/assets/workspace.js','workspace.js','text/javascript'],['/workspace/assets/workspace.css','workspace.css','text/css'],['/assets/app.css','app.css','text/css'],['/assets/logo.svg','logo.svg','image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file), type };
  assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
  require('./coach-fixture-fonts.cjs')(assets);
  const { clubConfigScript } = await import('../private-attendance/club-config.mjs');
  assets['/workspace/assets/club-config.js'].body = clubConfigScript(require('../private-attendance/club-config.json'));
  const requests = [], errors = [];
  const browser = await chromium.launch();
  let checks = 0, signedIn = true;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(({ now }) => { const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } }; }, { now });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin, 'No live or third-party network allowed');
      requests.push({ path: url.pathname, method: request.method() });
      if (assets[url.pathname]) return route.fulfill({ status: 200, contentType: assets[url.pathname].type, body: assets[url.pathname].body });
      let value;
      if (url.pathname.endsWith('/bootstrap')) value = { profile: signedIn ? profile : null, csrfToken: 'fixture', googleEnabled: true };
      else if (url.pathname.endsWith('/desk')) value = { profile, sessions, notes, tasks, observedAt: now };
      else if (url.pathname.endsWith('/session')) value = { plan: { version: 1, content: { focus: 'Finding space together', warmup: '8 minutes of ball mastery and changes of direction.', technical: 'Passing gates. Work in pairs and look up before passing.', game: 'Small-sided games with two targets.', equipment: 'Balls, cones and two colours of bibs.', reflection: '' } } };
      else if (url.pathname.endsWith('/logout')) { signedIn = false; value = { signedOut: true }; }
      else throw Error('Unexpected request: ' + request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', e => errors.push(e.message));
    await page.goto(origin + '/workspace'); await page.locator('#app').waitFor({ state: 'visible' });
    assert.match(await page.locator('#home-priorities').innerText(), /1 recent session with unmarked players/);
    assert.match(await page.locator('#home-priorities').innerText(), /1 note with a review date due/);
    assert.equal(await page.locator('#home-stats .desk-stat').first().innerText(), 'Sessions · next 7 days\n3'); checks++;
    await page.getByRole('button', { name: /Finish attendance/ }).click();
    assert.equal(await page.locator('#session').inputValue(), rid(2));
    assert.equal(await page.locator('#attendance-past').getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await page.locator('#roster .attendance-status').allTextContents(), ['Present', 'Not marked']); checks++;
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.getByRole('button', { name: /Review coaching observations/ }).click();
    assert.equal(await page.locator('#note-review-filter').isChecked(), true);
    assert.equal(await page.locator('#note-list .note-card').count(), 1);
    await page.locator('#note-category-filter').selectOption('Confidence');
    assert.equal(await page.locator('#note-list .note-card').count(), 0);
    await page.locator('#note-review-filter').uncheck();
    assert.equal(await page.locator('#note-list .note-card').count(), 1); checks++;
    await page.getByRole('button', { name: 'Tasks & follow-ups', exact: true }).click();
    assert.equal(await page.locator('#task-list .task-row').count(), 2);
    assert.equal(await page.locator('#task-list .task-overdue').count(), 1);
    await page.getByRole('button', { name: 'Completed', exact: true }).click();
    assert.equal(await page.locator('#task-list .task-row').count(), 1);
    assert.match(await page.locator('#task-list').innerText(), /Reopen/); checks++;
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await page.locator('#coaching-hub').getByRole('button', { name: /^Plan session for Thu/ }).click();
    await page.waitForFunction(() => !document.querySelector('#plan-focus').disabled);
    await page.locator('#plan-focus').fill('Unsaved fixture plan');
    page.once('dialog', d => d.dismiss());
    await page.locator('#planner-home').click();
    assert.equal(await page.locator('#panel-plan').isVisible(), true);
    assert.equal(await page.locator('#plan-focus').inputValue(), 'Unsaved fixture plan');
    page.once('dialog', d => d.accept()); await page.locator('#planner-home').click(); checks++;
    fs.mkdirSync('outputs', { recursive: true });
    await page.locator('#page-title').focus(); await page.evaluate(() => window.scrollTo(0,0));
    await page.screenshot({ path: 'outputs/coach-command-center-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'outputs/coach-command-center-mobile.png', fullPage: true });
    for (const width of [320,390,768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const tab of ['home','notes','tasks','plan']) {
        if (await page.locator('body').evaluate(body => body.classList.contains('planner-focus-mode'))) await page.locator('#planner-home').click();
        await page.locator('#navigation [data-tab="'+tab+'"]').click();
        if (tab === 'plan') { await page.locator('#planner-open-selected').click(); await page.waitForFunction(() => !document.querySelector('#plan-focus').disabled); }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'No overflow: ' + tab + ' at ' + width);
      }
    } checks++;
    assert.equal(requests.filter(r => /attendance$|save$|archive$|invite$|assign$/.test(r.path)).length, 0, 'Review/navigation tools never mutate records');
    assert.deepEqual(errors, []); checks++;
    profile.role='owner'; tasks.forEach(t=>t.status='done'); notes.forEach(n=>n.review_date='2027-01-01'); sessions.forEach(s=>s.players.forEach(p=>p.actualAttendance='Present')); sessions[0].issues=[{reason:'Parent email missing',player:'Preview Maya'}]; await page.reload(); await page.locator('#app').waitFor({state:'visible'}); await page.locator('.priority-roster-details summary').click(); assert.match(await page.locator('#home-priorities').innerText(),/Parent email missing: Preview Maya/); assert.doesNotMatch(await page.locator('#home-priorities').innerText(),/Nothing needs a follow-up/); checks++;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.locator('#login').waitFor({ state: 'visible' });
    for (const id of ['home-priorities','task-list','note-list','session-field-tools']) assert.equal(await page.locator('#'+id).innerText(), '', 'Clears private '+id);
    checks++;
    console.log('Coach command center: '+checks+' checks passed (factual priorities, dated navigation, filters, draft guard, responsive layout, no mutations, sign-out clearing).');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
