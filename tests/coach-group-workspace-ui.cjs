/* Complete group-first Coach Desk interaction; fictional data and intercepted transport only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { openSession, openView, openFolder, leaveGroup, focused } = require('./coach-fixture-navigation.cjs');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const rid = n => 'rec' + String(n).padStart(14, '0');
const owner = { email: 'group-owner@example.test', name: 'Fictional Coach', role: 'owner', sessionVersion: 1 };
const player = (n, name, slot) => ({ playerId: rid(n), attendanceId: rid(500 + n + slot), name, age: 9, kind: 'dropin', status: 'Yes', actualAttendance: 'Not marked', issues: [] });
const session = (n, date, program, roster) => ({ id: rid(n), programId: rid(program), date, time: '4:00–5:00 PM', location: 'Fictional West Field', players: roster.map(([id, name]) => player(id, name, n)), status: 'Scheduled', capacity: 20, capacityUsed: roster.length, expected: roster.length, counts: { yes: roster.length, no: 0, awaiting: 0, confirmed: 0 }, issues: [] });
const sessions = [
  session(1, '2026-10-29', 800, [[101, 'Fictional Sam'], [102, 'Fictional Lee']]),
  session(2, '2026-10-22', 800, [[101, 'Fictional Sam'], [103, 'Fictional Avery']]),
  session(3, '2026-11-05', 800, [[101, 'Fictional Sam']]),
  session(4, '2026-10-29', 801, [[101, 'Fictional Sam'], [104, 'Fictional Robin']]),
  session(5, '2026-10-22', 801, [[101, 'Fictional Sam']]),
];
const note = (id, sessionId, playerId, body) => ({ id, session_id: rid(sessionId), player_id: playerId ? rid(playerId) : null, body, category: 'Technical', review_date: null, author_email: owner.email, updated_at: now, version: 1 });
const seedNotes = [note('group-a', 2, null, 'Our group is learning to scan before receiving.'), note('sam-a-old', 2, 101, 'SAM_GROUP_A_OLD: Passing is becoming more controlled.'), note('sam-a-current', 1, 101, 'SAM_GROUP_A_CURRENT: Encourage a look before receiving.'), note('sam-b', 4, 101, 'OTHER_GROUP_PRIVATE_SAM: This belongs only to the second program.'), note('former-a', 2, 103, 'AVERY_GROUP_A: Worked on receiving in space.'), note('robin-b', 4, 104, 'OTHER_GROUP_PRIVATE_ROBIN: Unrelated player observation.')];
const assets = {};
for (const [url, file, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);

(async () => {
  const browser = await chromium.launch(); let checks = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 950 } });
    const state = { profile: owner, sessions: structuredClone(sessions), notes: structuredClone(seedNotes) }, requests = [], errors = [];
    await context.addInitScript(({ now }) => {
      const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } };
      window.fixtureAnswers = []; window.fixturePrompts = []; window.confirm = text => { fixturePrompts.push(text); return fixtureAnswers.shift() === true; };
    }, { now });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
      if (url.origin !== origin) { errors.push('Unexpected external transport: ' + url.origin); return route.abort(); }
      if (assets[pathname]) return route.fulfill({ status: 200, contentType: assets[pathname].type, body: assets[pathname].body });
      const payload = request.postData() ? request.postDataJSON() : undefined;
      requests.push({ path: pathname, method: request.method(), payload });
      let value, status = 200;
      if (pathname.endsWith('/bootstrap')) value = { profile: state.profile, csrfToken: 'fictional-group-csrf', googleEnabled: true };
      else if (pathname.endsWith('/desk')) value = { profile: state.profile, sessions: state.sessions, notes: state.notes, tasks: [], observedAt: now };
      else if (pathname.endsWith('/session')) value = { plan: { session_id: payload.sessionId, version: 1, content: { focus: 'Saved fixture focus ' + payload.sessionId, technical: 'A passing activity.' } } };
      else if (pathname.endsWith('/diagrams/list')) value = { diagrams: [] };
      else if (pathname.endsWith('/drills/list')) value = { drills: [] };
      else if (pathname.endsWith('/notes/save')) {
        const saved = { id: payload.id || 'new-note-' + requests.length, session_id: payload.sessionId, player_id: payload.playerId, body: payload.body, category: payload.category, review_date: payload.reviewDate, author_email: owner.email, updated_at: now, version: payload.expectedVersion + 1 };
        state.notes = [saved, ...state.notes.filter(item => item.id !== saved.id)]; value = { note: saved };
      } else if (pathname.endsWith('/attendance')) {
        const row = state.sessions.find(item => item.id === payload.sessionId)?.players.find(item => item.playerId === payload.playerId && item.attendanceId === payload.attendanceId);
        assert(row, 'Mock attendance requires the exact session/player/attendance record'); row.actualAttendance = payload.status; value = { status: payload.status };
      } else if (pathname.endsWith('/logout')) { state.profile = null; value = { signedOut: true }; }
      else { errors.push('Unexpected fixture action: ' + request.method() + ' ' + pathname); status = 403; value = { error: 'UNEXPECTED_FIXTURE' }; }
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.stack || error.message));
    const answer = value => page.evaluate(value => fixtureAnswers.push(value), value);
    const writes = suffix => requests.filter(request => request.path.endsWith(suffix));
    const selected = () => page.locator('#session').inputValue();
    const screenshot = async name => { if (!process.env.COACH_GROUP_SCREENSHOT_DIR) return; const dir = path.resolve(process.env.COACH_GROUP_SCREENSHOT_DIR); fs.mkdirSync(dir, { recursive: true }); await page.screenshot({ path: path.join(dir, name + '.png'), fullPage: true }); };
    await page.goto(origin + '/workspace'); await page.locator('#app').waitFor({ state: 'visible' });

    assert.equal(await page.locator('#coaching-hub .coaching-agenda-row').count(), 2, 'Home lists recurring groups rather than every dated session');
    assert.equal(await page.locator('#session').isVisible(), false); assert.equal(await page.locator('#planner-date').isVisible(), false);
    const labels = await page.locator('#coaching-hub h3').allTextContents(); assert.notEqual(labels[0], labels[1], 'Distinct programs at identical weekday/time/venue remain distinguishable');
    await page.locator('#navigation [data-tab="plan"]').click();
    assert.equal(await page.locator('#planner-days [data-group-key]').count(), 2); assert.equal(await page.locator('#session-workspace-tabs').isVisible(), false);
    assert.equal(await page.locator('#planner-date').isVisible(), false); assert.equal(await page.locator('#session-toolbar').isVisible(), false);
    await screenshot('coach-groups-desktop');
    for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); await screenshot('coach-groups-' + width); }
    await page.setViewportSize({ width: 1365, height: 950 }); checks++;

    await openSession(page, sessions, rid(1), 'attendance'); assert.equal(await selected(), rid(1));
    assert.equal(await page.locator('#panel-attendance').isVisible(), true); assert.equal(await page.locator('#panel-notes').isVisible(), false);
    await page.locator('#planner-focus-date').click();
    const dates = await page.locator('#planner-date option').evaluateAll(nodes => nodes.map(node => node.value));
    assert.deepEqual(dates.slice().sort(), [rid(1), rid(2), rid(3)].sort(), 'Date chooser is limited to the selected verified group');
    await page.locator('#planner-focus-date').click();
    await openView(page, 'plan'); assert.equal(await page.locator('#session-plan-section').isVisible(), true); assert.equal(await page.locator('#panel-attendance').isVisible(), false);
    assert.equal(await selected(), rid(1)); await openView(page, 'notes'); assert.equal(await page.locator('#panel-notes').isVisible(), true); checks++;

    assert.equal(await page.locator('#note-folders-list [data-player-folder]').count(), 4, 'Group folder plus the union of its players, including former players');
    assert.doesNotMatch(await page.locator('#note-folders-list').innerText(), /Robin/);
    await openFolder(page, rid(101));
    assert.equal(await page.locator('#note-list .note-card').count(), 2); const samHistory = await page.locator('#note-list').innerText();
    assert.match(samHistory, /SAM_GROUP_A_OLD/); assert.match(samHistory, /SAM_GROUP_A_CURRENT/); assert.doesNotMatch(samHistory, /OTHER_GROUP_PRIVATE|AVERY_GROUP/);
    await screenshot('coach-player-folder-desktop');
    for (const width of [390, 320]) { await page.setViewportSize({ width, height: 844 }); await screenshot('coach-player-folder-' + width); }
    await page.setViewportSize({ width: 1365, height: 950 });
    await page.locator('#player-history-panel > summary').click(); assert.doesNotMatch(await page.locator('#player-development').innerText(), /OTHER_GROUP_PRIVATE/); checks++;

    await openFolder(page, rid(103)); assert.match(await page.locator('#note-list').innerText(), /AVERY_GROUP_A/);
    assert.equal(await page.locator('#note-body').isEnabled(), false); assert.equal(await page.locator('#note-form button[type="submit"]').isEnabled(), false);
    assert.match(await page.locator('#note-folder-help').innerText(), /not on the selected date/);
    const beforeIllegal = writes('/notes/save').length;
    await page.evaluate(() => document.getElementById('note-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(writes('/notes/save').length, beforeIllegal, 'Direct form event cannot write a former player note to an absent roster date');
    await openSession(page, sessions, rid(2), 'notes'); assert.equal(await page.locator('#note-player').inputValue(), rid(103)); assert.equal(await page.locator('#note-body').isEnabled(), true);
    await page.locator('#note-body').fill('A useful new observation for Avery on their recorded date.');
    await page.locator('#note-form button[type="submit"]').click(); await page.waitForFunction(() => document.getElementById('note-body').value === '');
    assert.deepEqual(Object.fromEntries(['sessionId', 'playerId', 'id', 'expectedVersion'].map(key => [key, writes('/notes/save').at(-1).payload[key]])), { sessionId: rid(2), playerId: rid(103), id: null, expectedVersion: 0 }); checks++;

    await openSession(page, sessions, rid(1), 'notes'); await openFolder(page, rid(101));
    await page.locator('#note-list .note-card').filter({ hasText: 'SAM_GROUP_A_OLD' }).getByRole('button', { name: 'Edit', exact: true }).click();
    assert.equal(await selected(), rid(2), 'Editing historical note selects its actual dated session');
    await page.locator('#note-body').fill('SAM_GROUP_A_OLD: Updated fictional observation.'); await page.locator('#note-form button[type="submit"]').click();
    await page.waitForFunction(() => document.getElementById('note-body').value === '');
    const edit = writes('/notes/save').at(-1).payload; assert.equal(edit.id, 'sam-a-old'); assert.equal(edit.sessionId, rid(2)); assert.equal(edit.playerId, rid(101)); assert.equal(edit.expectedVersion, 1); checks++;

    await openSession(page, sessions, rid(1), 'attendance');
    await page.getByRole('group', { name: 'Attendance for Fictional Sam', exact: true }).getByRole('button', { name: 'Present', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#roster .attendance-status')?.textContent === 'Present');
    const attendance = writes('/attendance').at(-1).payload; assert.equal(attendance.sessionId, rid(1)); assert.equal(attendance.playerId, rid(101)); assert.equal(attendance.attendanceId, sessions[0].players[0].attendanceId); assert.equal(attendance.expectedStatus, 'Not marked'); assert.equal(attendance.status, 'Present');
    assert.equal(state.sessions[3].players[0].actualAttendance, 'Not marked', 'Same player in another group remains unchanged'); checks++;

    await openFolder(page, rid(101)); await page.locator('#note-body').fill('Unsaved note that must stay with this group.');
    assert.equal(await openSession(page, sessions, rid(3), 'notes'), false); assert.equal(await selected(), rid(1)); assert.match(await page.locator('#note-body').inputValue(), /Unsaved note/);
    assert.equal(await openSession(page, sessions, rid(4), 'notes'), false); assert.equal(await selected(), rid(1)); assert.equal(await focused(page), true);
    const countBeforeGuard = writes('/notes/save').length; await answer(true); await openSession(page, sessions, rid(4), 'notes'); assert.equal(writes('/notes/save').length, countBeforeGuard, 'Discarding a draft never saves it');
    await openFolder(page, rid(101)); assert.match(await page.locator('#note-list').innerText(), /OTHER_GROUP_PRIVATE_SAM/); assert.doesNotMatch(await page.locator('#note-list').innerText(), /SAM_GROUP_A_/); checks++;

    await openView(page, 'plan'); await page.locator('#plan-focus').fill('Unsaved session plan.');
    assert.equal(await openSession(page, sessions, rid(5), 'plan'), false); assert.equal(await selected(), rid(4)); assert.equal(await page.locator('#plan-focus').inputValue(), 'Unsaved session plan.');
    await answer(true); await openSession(page, sessions, rid(1), 'notes'); await openFolder(page, rid(101));
    assert.equal(writes('/plans/save').length, 0); checks++;

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'No horizontal overflow at ' + width);
      const tabs = page.locator('#session-workspace-tabs'); assert.equal(await tabs.isVisible(), true); await openView(page, 'attendance'); await openView(page, 'notes');
      assert.equal(await page.locator('#note-folders-list [data-player-folder]').first().isVisible(), true);
      await leaveGroup(page); await page.locator('#navigation [data-tab="plan"]').click(); assert.equal(await page.locator('#planner-days [data-group-key]').count(), 2); assert.equal(await page.locator('#planner-date').isVisible(), false);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Chooser fits at ' + width);
      await openSession(page, sessions, rid(1), 'notes'); await openFolder(page, rid(101));
    } checks++;

    await page.locator('#note-folders-search').fill('Sam'); await page.locator('#note-search').fill('CURRENT'); await leaveGroup(page);
    await page.locator('#logout').click(); await page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#note-body').inputValue(), ''); assert.equal(await page.locator('#note-list').textContent(), ''); assert.equal(await page.locator('#note-folders-list').textContent(), ''); assert.equal(await page.locator('#note-folders-search').inputValue(), ''); assert.equal(await page.locator('#note-search').inputValue(), '');
    assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => /SAM_GROUP|Fictional|AVERY|observation/.test(value))), false, 'Private roster and notes never enter local storage');
    assert.deepEqual(errors, []); checks++;
    await context.close(); console.log('Coach group workspace: ' + checks + ' integrated navigation, isolation, exact-write, draft, mobile and logout checks passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
