/* Preparation and development tools with fictional, already-scoped records only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const addAssets = require('./coach-fixture-fonts.cjs');

(async () => {
  const origin = 'https://attendance.starsoccer.ca';
  const now = '2026-12-31T20:00:00Z';
  const rid = n => 'rec' + String(n).padStart(14, '0');
  const profile = { email: 'coach@example.test', name: 'Fictional Coach', role: 'coach' };
  const player = (id, name, actualAttendance, response = 'yes') => ({ playerId: rid(id), attendanceId: rid(id + 100), name, actualAttendance, response, status: response === 'yes' ? 'Attending' : 'Not yet asked' });
  const maya = status => player(101, 'Fictional Maya With A Long Family Name', status);
  const noah = status => player(102, 'Fictional Noah Rivera', status);
  const session = (id, date, players, status = 'Scheduled') => ({ id: rid(id), programId: rid(900), programName: 'Fictional soccer training', date, time: '4:00–5:00 PM', location: 'Fictional training field and meeting point', status, capacity: 20, capacityUsed: players.length, expected: players.length, players });
  const sessions = [
    session(1, '2026-12-31', [maya('Not marked'), noah('Absent')]),
    session(2, '2027-01-01', [maya('Not marked')]),
    session(3, '2027-01-06', [noah('Not marked')]),
    session(4, '2026-12-30', [maya('Present'), noah('Not marked')]),
    session(5, '2026-12-28', [maya('Not marked')]),
    session(6, '2026-12-29', [maya('Present')], 'Cancelled'),
    session(7, '2026-12-31', [maya('Not marked')], 'Cancelled'),
    session(8, '2027-01-05', [noah('Not marked')]),
    session(9, '2027-01-07', [maya('Not marked')]),
    session(10, '2026-12-00', [maya('Not marked')]),
    session(11, '2026-12-24', [maya('Present'), noah('Not marked')]),
  ];
  const notes = [
    { id: 'fictional-maya-note', session_id: rid(11), player_id: rid(101), body: 'Fictional Maya coaching progress', category: 'Technical', review_date: '2026-12-30', updated_at: now },
    { id: 'fictional-noah-note', session_id: rid(1), player_id: rid(102), body: 'Fictional Noah coaching progress', category: 'Goal', review_date: '2027-01-10', updated_at: now },
    { id: 'fictional-session-note', session_id: rid(1), player_id: null, body: 'Fictional general session observation', category: 'Session review', updated_at: now },
    { id: 'fictional-other-group-note', session_id: rid(4), player_id: rid(101), body: 'Unrelated Wednesday observation', category: 'Technical', updated_at: now },
  ];
  const contextValue = { profile, session: sessions[0], sessions, groupSessions: [sessions[0], sessions[6], sessions[8], sessions[10]], noteFolder: rid(101), selected: rid(1), notes, tasks: [], plan: { content: {} }, planReady: true, busy: false, tab: 'home' };
  const assets = {};
  addAssets(assets);
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/workspace/assets/workspace.css"><link rel="stylesheet" href="/workspace/assets/coaching.css"><script defer src="/workspace/assets/groups.js"></script><script defer src="/workspace/assets/coaching.js"></script></head><body><main class="desk-main"><section id="coaching-hub"></section><section id="player-development"></section><section id="practice-toolbox"></section></main></body></html>';
  assets['/workspace'] = { body: html, type: 'text/html' };
  assets['/workspace/assets/workspace.css'] = { body: fs.readFileSync('private-attendance/web/workspace.css', 'utf8'), type: 'text/css' };
  const browser = await chromium.launch();
  let checks = 0;
  try {
    const context = await browser.newContext();
    await context.addInitScript(({ now }) => {
      const BaseDate = Date, instant = BaseDate.parse(now);
      window.Date = class extends BaseDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return instant; } };
      window.fixtureCoachEvents = [];
      for (const type of ['coach:request-context', 'coach:open-session', 'coach:add-note', 'coach:insert-plan', 'coach:copy-plan']) window.addEventListener(type, event => window.fixtureCoachEvents.push({ type, detail: event.detail }));
    }, { now });
    const requests = [];
    await context.route('**/*', route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin, 'No live or external network is permitted');
      requests.push({ path: url.pathname, method: request.method() });
      const asset = assets[url.pathname];
      assert(asset, 'Preparation tools must not fetch business data independently: ' + url.pathname);
      return route.fulfill({ status: 200, contentType: asset.type, body: asset.body });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    await page.goto(origin + '/workspace');
    await page.waitForFunction(() => fixtureCoachEvents.some(event => event.type === 'coach:request-context'));
    assert.equal(await page.locator('#coaching-hub').innerText(), '');
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), contextValue);
    await page.evaluate(() => document.fonts.ready);
    const agenda = page.locator('.coaching-agenda-row');
    assert.equal(await agenda.count(), 6, 'Each recurring weekday group appears once, with the incomplete date held separately');
    assert.equal(await agenda.locator('button').count(), 6, 'Each group has one clear entry action');
    assert.equal(await agenda.filter({ hasText: 'No active session recorded' }).locator('button:disabled').count(), 1, 'An invalid date cannot open a session');
    assert.equal(await agenda.locator('h3').filter({ hasText: /Dec|Jan|2026|2027/ }).count(), 0, 'Dates are context inside group cards, never top-level group names');
    assert.equal(await page.locator('#coaching-hub').getByText('1 note ready for review', { exact: true }).count(), 1);
    checks++;

    await agenda.filter({ has: page.locator('h3', { hasText: /Thursday/ }) }).getByRole('button', { name: /^Open group:/ }).click();
    let actions = await page.evaluate(() => fixtureCoachEvents.filter(event => event.type === 'coach:open-session'));
    assert.deepEqual(actions.map(({ detail: { sessionId, tab, workspaceView } }) => ({ sessionId, tab, workspaceView })), [{ sessionId: rid(1), tab: 'plan', workspaceView: 'attendance' }]);
    checks++;

    assert.equal(await page.locator('#development-player').count(), 0, 'History follows the chosen player folder without a competing global player dropdown');
    assert.match(await page.locator('#player-development h3').first().innerText(), /Fictional Maya/);
    assert.deepEqual(await page.locator('.development-summary strong').allTextContents(), ['1', '0', '1'], 'History stays in this group; future/cancelled sessions do not count and unmarked is never inferred absent');
    assert.match(await page.locator('#player-development').innerText(), /unmarked session is not an absence/i);
    assert.match(await page.locator('.development-observation').innerText(), /Fictional Maya coaching progress/);
    assert(!(await page.locator('#player-development').innerText()).includes('Fictional Noah coaching progress'));
    assert(!(await page.locator('#player-development').innerText()).includes('Fictional general session observation'));
    assert(!(await page.locator('#player-development').innerText()).includes('Unrelated Wednesday observation'), 'The same player’s notes in another group stay outside this folder');
    checks++;

    await page.locator('#player-development').getByRole('button', { name: /^Add a note for/ }).click();
    assert.deepEqual(await page.evaluate(() => fixtureCoachEvents.filter(event => event.type === 'coach:add-note').at(-1).detail), { sessionId: rid(1), playerId: rid(101) });
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), { ...contextValue, noteFolder: rid(102) });
    assert.deepEqual(await page.locator('.development-summary strong').allTextContents(), ['0', '1', '1']);
    assert.match(await page.locator('.development-observation').innerText(), /Fictional Noah coaching progress/);
    checks++;

    assert.equal(await page.locator('.practice-activity').count(), 5);
    await page.locator('#drill-age').selectOption('young');
    await page.locator('#drill-skill').selectOption('First touch');
    assert.equal(await page.locator('.practice-activity').count(), 0);
    assert.match(await page.locator('#practice-toolbox').innerText(), /No starter activities match/);
    await page.locator('#drill-skill').selectOption('Ball control');
    assert.equal(await page.locator('.practice-activity').count(), 1);
    await page.locator('.practice-activity summary').click();
    await page.getByRole('button', { name: 'Add to warm-up', exact: true }).click();
    await page.getByRole('button', { name: 'Add equipment', exact: true }).click();
    actions = await page.evaluate(() => fixtureCoachEvents.filter(event => event.type === 'coach:insert-plan'));
    assert.deepEqual(actions.map(action => action.detail.target), ['warmup', 'equipment']);
    assert.match(actions[0].detail.text, /Move, turn, find space/);
    assert.match(actions[1].detail.text, /One ball per player/);
    assert.equal(requests.filter(request => request.method === 'POST').length, 0, 'Inserting a practice idea changes only a draft through the root UI');
    checks++;

    assert.equal(await page.locator('#copy-plan-source').isDisabled(), true, 'Dates stay unavailable until a source training group is selected');
    assert.equal(await page.locator('#copy-plan-source option').count(), 1, 'No global cross-group date dropdown');
    const thursdayKey = await page.evaluate(session => CoachGroups.key(session), sessions[0]);
    await page.locator('#copy-plan-group').selectOption(thursdayKey);
    const sourceOptions = await page.locator('#copy-plan-source option').evaluateAll(options => options.map(option => option.value));
    assert(!sourceOptions.includes(rid(1)), 'The current plan cannot copy itself');
    assert(!sourceOptions.includes(rid(6)) && !sourceOptions.includes(rid(7)), 'Cancelled sessions are not offered as templates');
    assert(!sourceOptions.includes(rid(10)), 'Malformed dates must not become plan-copy options');
    assert(!sourceOptions.includes(rid(4)), 'The date picker contains only the chosen group');
    const wednesdayKey = await page.evaluate(session => CoachGroups.key(session), sessions[3]);
    await page.locator('#copy-plan-group').selectOption(wednesdayKey);
    await page.locator('#copy-plan-source').selectOption(rid(4));
    await page.getByRole('button', { name: 'Copy plan to draft', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => fixtureCoachEvents.filter(event => event.type === 'coach:copy-plan').at(-1).detail), { sourceSessionId: rid(4) });
    assert.match(await page.locator('.practice-reuse').innerText(), /reflection is left behind/);
    checks++;

    await page.locator('#copy-plan-group').selectOption(thursdayKey);
    assert.equal(await page.locator('#copy-plan-source').inputValue(), '', 'Changing source groups clears the previous date');
    assert.equal(await page.getByRole('button', { name: 'Copy plan to draft', exact: true }).isDisabled(), true);
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), { ...contextValue, session: sessions[1], selected: rid(2), groupSessions: [sessions[1]] });
    assert.match(await page.locator('#player-development h3').first().innerText(), /Fictional Maya/);
    assert.equal(await page.locator('.development-observation').count(), 0, 'A player’s observations from another group do not follow them into this group');
    assert.deepEqual(await page.locator('.development-summary strong').allTextContents(), ['0', '0', '0']);
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), { ...contextValue, noteFolder: '' });
    assert.equal(await page.locator('.development-summary').count(), 0, 'The group notes folder never shows an arbitrary player’s history');
    assert.match(await page.locator('#player-development').innerText(), /Open a player’s folder/);
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), { ...contextValue, groupSessions: undefined });
    assert.equal(await page.locator('#development-player').count(), 0, 'Missing group scope never falls back to every authorized player');
    assert.match(await page.locator('#player-development').innerText(), /Open a training group/);
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), { ...contextValue, profile: { ...profile, email: 'another-coach@example.test' } });
    assert.equal(await page.locator('#copy-plan-group').inputValue(), '', 'Identity changes reset source group/date choices');
    assert.equal(await page.locator('#copy-plan-source').inputValue(), '');
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), contextValue);
    checks++;

    const eventCount = await page.evaluate(() => fixtureCoachEvents.length);
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), { ...contextValue, busy: true });
    assert.equal(await page.locator('#coaching-hub button:enabled').count(), 0);
    assert.equal(await page.locator('#player-development button:enabled').count(), 0);
    assert.equal(await page.locator('#practice-toolbox button:enabled').count(), 0);
    await page.locator('#coaching-hub button').first().evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    assert.equal(await page.evaluate(() => fixtureCoachEvents.length), eventCount);
    checks++;

    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), { ...contextValue, planReady: false });
    assert.equal(await page.locator('#practice-toolbox button:enabled').count(), 0);
    assert.match(await page.locator('.practice-reuse').innerText(), /wait for its plan to load/);
    checks++;

    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), contextValue);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Coaching tools must fit at ' + width + 'px');
      assert.deepEqual(await page.locator('button:visible').evaluateAll(buttons => buttons.filter(button => button.getBoundingClientRect().height < 43.5).map(button => ({ text: button.innerText, height: button.getBoundingClientRect().height }))), []);
      checks++;
    }

    await page.evaluate(() => window.dispatchEvent(new CustomEvent('coach:context', { detail: null })));
    for (const id of ['coaching-hub', 'player-development', 'practice-toolbox']) assert.equal(await page.locator('#' + id).innerHTML(), '', 'Sign-out clears all scoped content from ' + id);
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), { ...contextValue, session: null, selected: '', sessions: [], groupSessions: [], notes: [] });
    assert.match(await page.locator('#coaching-hub').innerText(), /No assigned training groups/);
    assert.match(await page.locator('#player-development').innerText(), /Open a training group/);
    assert.equal(await page.locator('#drill-age').inputValue(), 'all', 'A cleared identity cannot inherit a previous user filter');
    assert.equal(await page.locator('#drill-skill').inputValue(), 'all');
    checks++;
    assert.equal(requests.filter(request => request.method !== 'GET').length, 0);
    assert.deepEqual(sessions[0].players.map(player => player.actualAttendance), ['Not marked', 'Absent']);
    checks++;
    console.log('Coach preparation tools: ' + checks + ' isolated agenda, development, drill, permission-boundary and responsive checks passed. No business writes or live network.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
