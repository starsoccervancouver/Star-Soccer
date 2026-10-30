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
  const session = (id, date, players, status = 'Scheduled') => ({ id: rid(id), date, time: '4:00–5:00 PM', location: 'Fictional training field and meeting point', status, capacity: 20, capacityUsed: players.length, expected: players.length, players });
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
  ];
  const notes = [
    { id: 'fictional-maya-note', player_id: rid(101), body: 'Fictional Maya coaching progress', category: 'Technical', review_date: '2026-12-30', updated_at: now },
    { id: 'fictional-noah-note', player_id: rid(102), body: 'Fictional Noah coaching progress', category: 'Goal', review_date: '2027-01-10', updated_at: now },
    { id: 'fictional-session-note', player_id: null, body: 'Fictional general session observation', category: 'Session review', updated_at: now },
  ];
  const contextValue = { profile, session: sessions[0], sessions, selected: rid(1), notes, tasks: [], plan: { content: {} }, planReady: true, busy: false, tab: 'home' };
  const assets = {};
  addAssets(assets);
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/workspace/assets/workspace.css"><link rel="stylesheet" href="/workspace/assets/coaching.css"><script defer src="/workspace/assets/coaching.js"></script></head><body><main class="desk-main"><section id="coaching-hub"></section><section id="player-development"></section><section id="practice-toolbox"></section></main></body></html>';
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
    assert.equal(await agenda.count(), 4, 'Only the next seven dates and four requested weekdays appear, including explicitly cancelled dates');
    assert.equal(await agenda.filter({ hasText: 'Cancelled' }).count(), 1);
    assert.equal(await agenda.filter({ hasText: 'Cancelled' }).locator('button:enabled').count(), 0);
    assert.equal(await page.locator('#coaching-hub').getByText('1 note ready for review', { exact: true }).count(), 1);
    checks++;

    await agenda.filter({ has: page.locator('.tag', { hasText: '2 expected' }) }).getByRole('button', { name: /^Open roster for/ }).click();
    await agenda.filter({ has: page.locator('.tag', { hasText: '2 expected' }) }).getByRole('button', { name: /^Plan session for/ }).click();
    let actions = await page.evaluate(() => fixtureCoachEvents.filter(event => event.type === 'coach:open-session'));
    assert.deepEqual(actions.map(action => action.detail), [{ sessionId: rid(1), tab: 'attendance' }, { sessionId: rid(1), tab: 'plan' }]);
    checks++;

    assert.equal(await page.locator('#development-player option').count(), 2, 'Only named players present in the supplied scope are selectable');
    assert.equal(await page.locator('#development-player').inputValue(), rid(101));
    assert.deepEqual(await page.locator('.development-summary strong').allTextContents(), ['1', '0', '2'], 'Future and cancelled sessions do not count; unmarked is never inferred absent');
    assert.match(await page.locator('#player-development').innerText(), /unmarked session is not an absence/i);
    assert.match(await page.locator('.development-observation').innerText(), /Fictional Maya coaching progress/);
    assert(!(await page.locator('#player-development').innerText()).includes('Fictional Noah coaching progress'));
    assert(!(await page.locator('#player-development').innerText()).includes('Fictional general session observation'));
    checks++;

    await page.locator('#player-development').getByRole('button', { name: /^Add a note for/ }).click();
    assert.deepEqual(await page.evaluate(() => fixtureCoachEvents.filter(event => event.type === 'coach:add-note').at(-1).detail), { sessionId: rid(1), playerId: rid(101) });
    await page.locator('#development-player').selectOption(rid(102));
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

    const sourceOptions = await page.locator('#copy-plan-source option').evaluateAll(options => options.map(option => option.value));
    assert(!sourceOptions.includes(rid(1)), 'The current plan cannot copy itself');
    assert(!sourceOptions.includes(rid(6)) && !sourceOptions.includes(rid(7)), 'Cancelled sessions are not offered as templates');
    assert(!sourceOptions.includes(rid(10)), 'Malformed dates must not become plan-copy options');
    await page.locator('#copy-plan-source').selectOption(rid(4));
    await page.getByRole('button', { name: 'Copy plan to draft', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => fixtureCoachEvents.filter(event => event.type === 'coach:copy-plan').at(-1).detail), { sourceSessionId: rid(4) });
    assert.match(await page.locator('.practice-reuse').innerText(), /reflection is left behind/);
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
    await page.evaluate(value => window.dispatchEvent(new CustomEvent('coach:context', { detail: value })), { ...contextValue, session: null, selected: '', sessions: [], notes: [] });
    assert.match(await page.locator('#coaching-hub').innerText(), /No assigned training sessions/);
    assert.match(await page.locator('#player-development').innerText(), /Player profiles appear/);
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
