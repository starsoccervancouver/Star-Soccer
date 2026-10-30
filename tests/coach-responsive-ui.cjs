/* Private Coach Desk presentation checks against isolated fictional sources only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const addFonts = require('./coach-fixture-fonts.cjs');
const { openSession, openView, openFolder, leaveGroup } = require('./coach-fixture-navigation.cjs');

(async () => {
  const origin = 'https://attendance.starsoccer.ca';
  const now = '2026-12-31T20:00:00Z';
  const rid = n => 'rec' + String(n).padStart(14, '0');
  const profile = { email: 'long-coach-owner-address-for-responsive-layout@example.test', name: 'Fictional Coaching Owner With A Long Display Name', role: 'owner' };
  const assets = {};
  for (const [url, file, type] of [
    ['/workspace', 'workspace.html', 'text/html'],
    ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'],
    ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'],
    ['/assets/app.css', 'app.css', 'text/css'],
    ['/assets/logo.svg', 'logo.svg', 'image/svg+xml'],
  ]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
  assets['/workspace/assets/passkeys.js'] = { body: fs.readFileSync('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', 'utf8'), type: 'text/javascript' };
  addFonts(assets);
  const player = (n, name, actualAttendance) => ({ playerId: rid(n + 100), attendanceId: rid(n + 200), name, kind: 'dropin', status: 'Attending', response: 'yes', actualAttendance, issues: [] });
  const players = [
    player(1, 'Fictional Maya With A Particularly Long Family Name', 'Not marked'),
    player(2, 'Fictional Noah Rivera', 'Present'),
    player(3, 'Fictional Ari Patel', 'Absent'),
  ];
  const session = (n, date, rows) => ({ id: rid(n), date, time: '3:45 PM – 5:15 PM', location: 'Fictional Vancouver training ground and field-side meeting point', status: 'Scheduled', capacity: 20, capacityUsed: rows.length, registered: rows.length, expected: rows.length, counts: { yes: rows.length, no: 0, awaiting: 0, confirmed: 0 }, players: rows, issues: [] });
  const sessions = [session(1, '2026-12-31', players), session(2, '2027-01-01', [player(4, 'Fictional Friday Player', 'Not marked')])];
  const notes = [{ id: 'fixture-note', player_id: rid(101), session_id: rid(1), author_email: profile.email, category: 'Technical', body: 'A fictional coaching observation with a long word: ' + 'CoachingObservation'.repeat(6), updated_at: now, version: 1 }];
  const tasks = [{ id: 'fixture-task', title: 'Prepare extra equipment and a progression for the next fictional coaching session', author_email: profile.email, session_id: rid(1), status: 'open', due_date: '2027-01-01', version: 1 }];
  const users = [{ ...profile, active: true, assignments: [], session_version: 1 }, { email: 'fixture-coach-with-long-address@example.test', name: 'Fictional Additional Coach With A Long Display Name', role: 'coach', active: true, assignments: [rid(1)], session_version: 1 }];
  const browser = await chromium.launch();
  const requests = [];
  let releaseRefresh, refreshStarted, releaseNoteSave, noteSaveStarted, signedIn = true, savedNotePayload;
  const refreshReady = new Promise(resolve => refreshStarted = resolve);
  const noteSaveReady = new Promise(resolve => noteSaveStarted = resolve);
  let checks = 0;
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ now }) => {
      const OriginalDate = Date, ms = OriginalDate.parse(now);
      window.Date = class extends OriginalDate { constructor(...args) { super(...(args.length ? args : [ms])); } static now() { return ms; } };
      window.fixturePrints = [];
      window.fixturePrintError = false;
      window.print = () => { if (window.fixturePrintError) throw new Error('Fixture printer unavailable'); window.fixturePrints.push({ text: document.querySelector('#print-roster-sheet')?.innerText, html: document.querySelector('#print-roster-sheet')?.innerHTML, printing: document.body.classList.contains('printing-roster') }); };
    }, { now });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin, 'No live or third-party network is permitted');
      requests.push({ path: url.pathname, method: request.method(), body: request.postData() });
      const asset = assets[url.pathname];
      if (asset) return route.fulfill({ status: 200, contentType: asset.type, body: asset.body });
      let value;
      if (url.pathname.endsWith('/bootstrap')) value = { profile: signedIn ? profile : null, csrfToken: 'fixture-csrf', googleEnabled: true };
      else if (url.pathname.endsWith('/logout') && request.method() === 'POST') { signedIn = false; value = { signedOut: true }; }
      else if (url.pathname.endsWith('/desk')) value = { profile, sessions, notes, tasks, observedAt: now };
      else if (url.pathname.endsWith('/users')) value = { users, credentials: [] };
      else if (url.pathname.endsWith('/audit')) value = { events: [{ action: 'note-saved', actor_email: profile.email, occurred_at: now }] };
      else if (url.pathname.endsWith('/session') && request.method() === 'POST') value = { plan: { version: 0, content: { focus: 'Fictional first touch focus', warmup: 'Movement and ball work' } } };
      else if (url.pathname.endsWith('/legacy-notes') && request.method() === 'POST') value = { notes: [] };
      else if (url.pathname.endsWith('/refresh') && request.method() === 'POST') { refreshStarted(); await new Promise(resolve => releaseRefresh = resolve); value = { refreshed: true }; }
      else if (url.pathname.endsWith('/notes/save') && request.method() === 'POST') {
        savedNotePayload = JSON.parse(request.postData());
        assert.equal(savedNotePayload.id, 'fixture-note');
        assert.equal(savedNotePayload.sessionId, rid(1));
        assert.equal(savedNotePayload.playerId, rid(101));
        noteSaveStarted();
        await new Promise(resolve => releaseNoteSave = resolve);
        value = { note: { ...notes[0], body: savedNotePayload.body, updated_at: now, version: 2 } };
      }
      else throw Error('Unexpected fixture request or business write: ' + request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.goto(origin + '/workspace');
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.evaluate(() => document.fonts.ready);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#navigation button[data-tab="plan"]').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.locator('#panel-plan').isVisible(), true, 'Keyboard attendance entry first presents training groups');
    assert.equal(await page.evaluate(() => document.activeElement.dataset.tab), 'plan');
    await openSession(page, sessions, rid(1), 'attendance');
    checks++;

    await openView(page, 'plan');
    await page.locator('#plan-focus').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.querySelector('#plan-focus').disabled);
    await page.locator('#plan-focus').fill('Unsaved fictional session plan');
    assert.match(await page.locator('#plan-state').innerText(), /Unsaved changes/);
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#planner-back').click();
    assert.equal(await page.locator('#plan-focus').inputValue(), 'Unsaved fictional session plan', 'Cancelling the return to session selection must not reset the draft');
    checks++;
    const planReads = requests.filter(request => request.path.endsWith('/session')).length;
    await page.locator('#planner-focus-date').click();
    assert.equal(await page.locator('#session').inputValue(), rid(1));
    assert.equal(await page.locator('#plan-focus').inputValue(), 'Unsaved fictional session plan', 'Changing session visibility must preserve the current planner draft');
    assert.equal(await page.locator('#plan-state').isVisible(), true);
    assert.equal(requests.filter(request => request.path.endsWith('/session')).length, planReads, 'Changing visibility must not refetch over an unsaved plan');
    await page.locator('#planner-focus-date').click();
    checks++;

    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#planner-home').click();
    assert.equal(await page.locator('#panel-plan').isVisible(), true, 'Cancelling navigation must preserve the planner');
    assert.equal(await page.locator('#plan-focus').inputValue(), 'Unsaved fictional session plan');
    checks++;
    page.once('dialog', dialog => dialog.dismiss());
    await openSession(page, sessions, rid(2), 'plan');
    assert.equal(await page.locator('#session').inputValue(), rid(1), 'Cancelling a session change must keep the original date');
    assert.equal(await page.locator('#plan-focus').inputValue(), 'Unsaved fictional session plan');
    checks++;
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('#planner-back').click();
    assert.equal(requests.filter(request => request.path.endsWith('/refresh')).length, 0, 'Declining the planner exit must not discard or refetch');
    assert.equal(await page.locator('#plan-focus').inputValue(), 'Unsaved fictional session plan');
    assert.equal(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; }), true);
    checks++;
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#planner-home').click();
    await openSession(page, sessions, rid(1), 'attendance');
    assert.equal(await page.locator('#panel-attendance').isVisible(), true);
    await openView(page, 'plan');
    await page.waitForFunction(() => !document.querySelector('#plan-focus').disabled);
    assert.equal(await page.locator('#plan-focus').inputValue(), 'Fictional first touch focus');
    assert.equal(await page.locator('#plan-state').isVisible(), false);
    checks++;
    await openView(page, 'attendance');
    const stats = await page.locator('#attendance-stats').innerText();
    await page.getByLabel('Show attendance', { exact: true }).selectOption('Not marked');
    assert.equal(await page.locator('#roster .roster-row').count(), 1);
    assert.match(await page.locator('#roster').innerText(), /Fictional Maya/);
    assert.equal(await page.locator('#attendance-stats').innerText(), stats, 'Filtering must preserve authoritative session totals');
    await page.getByRole('searchbox', { name: 'Find a player' }).fill('Ari');
    assert.equal(await page.locator('#roster .roster-row').count(), 0, 'Search and status filters combine');
    await page.getByRole('button', { name: 'Clear search', exact: true }).click();
    assert.equal(await page.getByLabel('Show attendance', { exact: true }).inputValue(), 'Not marked');
    assert.equal(await page.locator('#roster .roster-row').count(), 1);
    checks++;
    await page.getByLabel('Show attendance', { exact: true }).selectOption('Absent');
    assert.equal(await page.locator('#roster .roster-row').count(), 1);
    await page.locator('#print-roster').click();
    const printed = await page.evaluate(() => window.fixturePrints);
    assert.equal(printed.length, 1);
    assert.equal(printed[0].printing, true);
    for (const child of players) assert(printed[0].text.includes(child.name), 'Printing includes the complete selected roster');
    assert(printed[0].text.includes('Fictional Vancouver training ground'));
    assert(!printed[0].text.includes('Fictional Friday Player'), 'Printing must not leak another session');
    assert(!printed[0].text.includes(notes[0].body), 'Private coaching notes are not part of the roster handout');
    assert.equal(await page.evaluate(() => document.body.classList.contains('printing-roster')), true, 'Printing content remains available until the browser reports completion');
    await page.emulateMedia({ media: 'print' });
    assert.equal(await page.locator('#app').isVisible(), false, 'Private notes and other dashboard panels must be excluded from print');
    assert.equal(await page.locator('#print-roster-sheet').isVisible(), true);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
    await page.emulateMedia({ media: 'screen' });
    assert.equal(await page.locator('#print-roster-sheet').innerHTML(), '');
    assert.equal(await page.evaluate(() => document.body.classList.contains('printing-roster')), false);
    assert.equal(await page.getByLabel('Show attendance', { exact: true }).inputValue(), 'Absent', 'Printing must preserve current filters');
    checks++;
    await page.evaluate(() => { window.fixturePrintError = true; });
    await page.locator('#print-roster').click();
    assert.equal(await page.locator('#print-roster-sheet').innerHTML(), '', 'Failed printing must immediately clear the private handout');
    assert.equal(await page.evaluate(() => document.body.classList.contains('printing-roster')), false);
    await page.evaluate(() => { window.fixturePrintError = false; });
    checks++;

    await openSession(page, sessions, rid(2), 'attendance');
    assert.equal(await page.getByLabel('Show attendance', { exact: true }).inputValue(), 'all');
    assert.equal(await page.locator('#roster .roster-row').count(), 1);
    checks++;

    await leaveGroup(page); await page.locator('#refresh').click();
    await refreshReady;
    assert.equal(await page.locator('#desk-main').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('#desk-loading').isVisible(), true);
    assert.equal(await page.locator('.attendance-controls button').count(), 3);
    assert.equal(await page.locator('.attendance-controls button:disabled').count(), 3, 'All physical attendance controls lock while the roster refresh is pending');
    await page.locator('.attendance-controls button').evaluateAll(buttons => buttons.forEach(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true }))));
    assert.equal(requests.filter(request => request.path.endsWith('/attendance')).length, 0, 'Pending refresh must not issue physical attendance commands');
    releaseRefresh();
    await page.waitForFunction(() => document.querySelector('#desk-main').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('#desk-loading').isVisible(), false);
    assert.equal(requests.filter(request => request.path.endsWith('/refresh')).length, 1, 'Roster refresh remains manual');
    checks++;

    await openSession(page, sessions, rid(1), 'notes'); await openFolder(page, rid(101));
    await page.locator('#note-list').getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#note-body').fill('Pending fictional note revision');
    await page.getByRole('button', { name: 'Save private note', exact: true }).click();
    await noteSaveReady;
    assert.equal(await page.locator('#note-list .note-actions button').count(), 2);
    assert.equal(await page.locator('#note-list .note-actions button:disabled').count(), 2, 'Edit and Archive lock while a note is saving');
    const beforePending = { session: await page.locator('#session').inputValue(), player: await page.locator('#note-player').inputValue(), body: await page.locator('#note-body').inputValue() };
    let unexpectedDialogs = 0;
    const dismissUnexpected = dialog => { unexpectedDialogs++; return dialog.dismiss(); };
    page.on('dialog', dismissUnexpected);
    await page.locator('#note-list .note-actions button').evaluateAll(buttons => buttons.forEach(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true }))));
    await page.locator('#note-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    page.off('dialog', dismissUnexpected);
    assert.equal(unexpectedDialogs, 0, 'Guarded Archive must not open a confirmation during a save');
    assert.deepEqual({ session: await page.locator('#session').inputValue(), player: await page.locator('#note-player').inputValue(), body: await page.locator('#note-body').inputValue() }, beforePending, 'A pending save keeps its original session and editor contents');
    assert.equal(requests.filter(request => request.path.endsWith('/notes/save')).length, 1, 'Repeated submit must not start a second save');
    assert.equal(requests.filter(request => request.path.endsWith('/notes/archive')).length, 0, 'Pending-save Archive must not reach the server');
    releaseNoteSave();
    await page.locator('#note-list').getByText('Pending fictional note revision', { exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('#note-list .note-actions button').disabled);
    assert.equal(await page.locator('#note-body').inputValue(), '');
    assert.equal(await page.locator('#note-state').isVisible(), false);
    checks++;

    await page.evaluate(() => document.fonts.ready);
    const type = await page.evaluate(() => ({ body: getComputedStyle(document.body).fontFamily, heading: getComputedStyle(document.querySelector('#page-title')).fontFamily, faces: [...document.fonts].map(face => ({ family: face.family, status: face.status })) }));
    assert.match(type.body, /Manrope/);
    assert.match(type.heading, /Manrope/);
    assert(type.faces.some(face => /Manrope/.test(face.family) && face.status === 'loaded'), 'Simple brand typography loads from isolated first-party fixtures');
    checks++;
    const tabs = ['home', 'attendance', 'notes', 'plan', 'tasks', 'settings', 'team', 'activity', 'legacy'];
    for (const width of [320, 390, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of tabs) {
        if (await page.locator('body').evaluate(body => body.classList.contains('planner-focus-mode'))) await page.locator('#planner-home').click();
        const settingsSection = ['team', 'activity', 'legacy'].includes(tab);
        await page.locator('#navigation button[data-tab="' + (settingsSection ? 'settings' : tab === 'attendance' ? 'plan' : tab) + '"]').click();
        if (settingsSection) await page.locator('#settings-navigation button[data-settings-tab="' + tab + '"]').click();
        if (['plan', 'attendance', 'notes'].includes(tab)) await openSession(page, sessions, rid(1), tab);
        await page.locator('#panel-' + tab).waitFor({ state: 'visible' });
        const overflow = await page.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: [...document.querySelectorAll('#app *')].filter(element => { const rect = element.getBoundingClientRect(); return rect.width && (rect.right > innerWidth + 1 || rect.left < -1) && !element.closest('#navigation'); }).slice(-12).map(element => ({ tag: element.tagName, id: element.id, class: element.className, left: element.getBoundingClientRect().left, right: element.getBoundingClientRect().right, width: element.getBoundingClientRect().width })) }));
        assert(overflow.scroll <= width + 1, tab + ' must not overflow at ' + width + 'px: ' + JSON.stringify(overflow));
        assert.equal(await page.locator('#navigation button.nav-active').getAttribute('data-tab'), settingsSection ? 'settings' : tab === 'attendance' ? 'plan' : tab);
        if (settingsSection) assert.equal(await page.locator('#settings-navigation button[data-settings-tab="' + tab + '"]').getAttribute('aria-current'), 'page');
        assert.equal(await page.locator('#navigation button.nav-active').getAttribute('aria-current'), 'page');
        // Inspect one current DOM snapshot: async plan readback may replace toolbox controls.
        const smallButtons = await page.evaluate(() => [...document.querySelectorAll('#app button')].filter(button => button.getClientRects().length && getComputedStyle(button).visibility !== 'hidden').filter(button => button.getBoundingClientRect().height < 43.5).map(button => ({ text: button.textContent, height: button.getBoundingClientRect().height })));
        assert.deepEqual(smallButtons, [], tab + ' buttons need 44px touch targets at ' + width + 'px');
        checks++;
      }
    }

    assert.deepEqual(requests.filter(request => request.method === 'POST').map(request => request.path).filter(path => !['/workspace/api/session', '/workspace/api/legacy-notes', '/workspace/api/refresh', '/workspace/api/notes/save'].includes(path)), [], 'Only the explicitly mocked note save may write fixture business data');
    checks++;
    await page.setViewportSize({ width: 390, height: 844 });
    await openSession(page, sessions, rid(1), 'attendance');
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: 'outputs/coach-desk-redesign-fictional-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: 'outputs/coach-desk-redesign-fictional-desktop.png', fullPage: true });
    await page.locator('#print-roster').click();
    assert.equal(await page.evaluate(() => document.body.classList.contains('printing-roster')), true);
    await leaveGroup(page); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#print-roster-sheet').innerHTML(), '', 'Signing out clears a pending private print handout');
    assert.equal(await page.evaluate(() => document.body.classList.contains('printing-roster')), false);
    assert.deepEqual(players.map(player => player.actualAttendance), ['Not marked', 'Present', 'Absent']);
    checks++;

    console.log('Coach responsive presentation: ' + checks + ' isolated viewport, tab, touch-target and keyboard checks passed. No live network, real records or email.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
