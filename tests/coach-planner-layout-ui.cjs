/* Day-first planner, private notes and tool drawers. All data and transport are fictional. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const groups = require('../private-attendance/web/workspace-groups.js');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const rid = n => 'rec' + String(n).padStart(14, '0');
const player = (n, name) => ({ playerId: rid(n), attendanceId: rid(n + 500), name, kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] });
const sam = player(101, 'Fictional Sam'), lee = player(102, 'Fictional Lee'), other = player(103, 'Fictional Morgan');
const session = (n, date, { time = '4:00–5:00 PM', location = 'Fictional West Field', status = 'Scheduled', players = [sam, lee] } = {}) => ({ id: rid(n), programId: rid(900), date, time, location, status, capacity: 20, capacityUsed: players.length, expected: players.length, counts: { yes: 0, no: 0, awaiting: players.length, confirmed: 0 }, issues: [], players });
const sessions = [
  session(1, '2026-10-28'),
  session(2, '2026-10-29'),
  session(3, '2026-10-30', { players: [other] }),
  session(4, '2026-11-01'),
  session(5, '2026-11-04', { time: '9:00–10:00 AM', status: 'Cancelled' }),
  session(6, '2026-11-04', { time: '4:00–5:00 PM' }),
  session(7, '2026-11-04', { time: '6:00–7:00 PM', location: 'Fictional East Field' }),
  session(8, '2026-11-11'),
  session(9, '2026-10-21', { location: 'Fictional East Field', players: [other] }),
  session(10, '2026-10-28', { time: '6:00–7:00 PM', players: [other] })
];
const owner = { email: 'fictional-owner@example.test', name: 'Fictional Owner', role: 'owner', sessionVersion: 1 };
const note = (n, sessionId, playerId, body, author = owner.email) => ({ id: 'note_fixture_' + n, session_id: sessionId, player_id: playerId, body, category: 'General', author_email: author, created_at: now, updated_at: now, review_date: null, version: 1 });
const notes = [
  note(1, rid(1), null, 'Wednesday group: scanning before the pass.'),
  note(2, rid(2), null, 'Thursday group: keep the circle small.'),
  note(3, rid(9), null, 'Other field group: bring spare bibs.'),
  note(4, rid(1), sam.playerId, 'Sam: encourage the first touch.'),
  note(5, rid(4), lee.playerId, 'Lee: celebrate using both feet.'),
  note(6, rid(3), other.playerId, 'Morgan: unrelated player history.'),
  note(7, rid(10), null, 'Other time group: a separate evening session.'),
  note(8, rid(2), sam.playerId, 'Sam: a separate Thursday observation.'),
];
const assets = {};
for (const [url, file, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);
assets['/workspace/assets/planner.js'] = { body: fs.readFileSync('private-attendance/web/workspace-planner.js', 'utf8'), type: 'text/javascript' };

(async () => {
  const browser = await chromium.launch(); let checks = 0;
  try {
    async function fixture({ role = 'owner', rows = sessions, savedStart, hash = '', extraNotes = [] } = {}) {
      const context = await browser.newContext({ viewport: { width: 1365, height: 950 } });
      const profile = { ...owner, role, email: role === 'owner' ? owner.email : 'fictional-coach@example.test' };
      const state = { profile, notes: [...notes, ...extraNotes].map(n => ({ ...n, author_email: profile.email })), noteMode: 'success' }, requests = [], errors = [], pending = [];
      await context.addInitScript(({ now, savedStart }) => {
        const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } };
        if (savedStart) localStorage.setItem('coach-desk-display-v1', JSON.stringify({ start: savedStart, density: 'comfortable', reduceMotion: false }));
        window.fixtureAnswers = []; window.fixturePrompts = [];
        window.confirm = text => { fixturePrompts.push(text); return fixtureAnswers.shift() === true; };
      }, { now, savedStart });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== origin) { errors.push('Unexpected outside network ' + url.origin); return route.abort(); }
        if (assets[path]) return route.fulfill({ status: 200, contentType: assets[path].type, body: assets[path].body });
        const payload = request.postData() ? request.postDataJSON() : undefined;
        requests.push({ path, payload, method: request.method(), headers: request.headers() });
        let value, status = 200;
        if (path.endsWith('/bootstrap')) value = { profile: state.profile, csrfToken: 'fictional-planner-csrf', googleEnabled: true };
        else if (path.endsWith('/desk')) value = { profile: state.profile, sessions: rows, notes: state.notes, tasks: [], observedAt: now };
        else if (path.endsWith('/session')) value = { plan: { session_id: payload.sessionId, version: 0, content: {} } };
        else if (path.endsWith('/diagrams/list')) value = { diagrams: [] };
        else if (path.endsWith('/notes/save')) {
          let mode = state.noteMode;
          if (mode === 'delay') mode = await new Promise(resolve => pending.push(resolve));
          if (mode === 'fail') { status = 400; value = { error: 'FICTIONAL_REJECTION', message: 'Fictional note was rejected. Your draft is retained.' }; }
          else {
            const saved = note(100 + state.notes.length, payload.sessionId, payload.playerId, payload.body, state.profile.email);
            state.notes.unshift(saved);
            if (mode === 'lost-ambiguous') state.notes.unshift({ ...saved, id: saved.id + '_second' });
            if (mode === 'lost-unique' || mode === 'lost-ambiguous') return route.abort('failed');
            value = { note: saved };
          }
        } else if (path.endsWith('/logout')) { state.profile = null; value = { signedOut: true }; }
        else { errors.push('Unexpected fixture action ' + request.method() + ' ' + path); status = 403; value = { error: 'UNEXPECTED_FIXTURE' }; }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.stack || error.message));
      await page.goto(origin + '/workspace' + hash); await page.locator('#app').waitFor({ state: 'visible' });
      return { page, context, requests, errors, state, pending, rows, answer: value => page.evaluate(value => fixtureAnswers.push(value), value) };
    }
    const card = (f, row) => f.page.locator('#planner-days [data-group-key=' + JSON.stringify(groups.key(row)) + ']');
    const enterSelected = async f => { const selected = await f.page.locator('#session').inputValue(); await card(f, f.rows.find(row=>row.id===selected)).click(); await f.page.waitForFunction(() => !document.getElementById('plan-focus').disabled); };
    const enter = async f => { await f.page.locator('#navigation [data-tab="plan"]').click(); await enterSelected(f); };
    const count = (f, suffix) => f.requests.filter(r => r.path.endsWith(suffix)).length;
    const current = f => f.page.locator('#session').inputValue();
    const day = (f, number) => { const row=f.rows.find(row=>new Date(row.date+'T12:00:00Z').getUTCDay()===number&&row.time==='4:00–5:00 PM'&&row.location==='Fictional West Field');return row?card(f,row):f.page.locator('#planner-days [data-weekday="'+number+'"]').first(); };
    const selectDate = async (f, id) => {
      const selectedId=await current(f), selected=f.rows.find(row=>row.id===selectedId), target=f.rows.find(row=>row.id===id);
      if(groups.key(selected)!==groups.key(target)){
        await f.page.locator('#planner-back').click();
        if(await f.page.locator('#planner-workspace').isVisible())return;
        await card(f,target).click();
        await f.page.waitForFunction(()=>!document.getElementById('plan-focus').disabled);
      }
      if(await current(f)===id)return;
      if(!await f.page.locator('#planner-dates-pane').isVisible())await f.page.locator('#planner-focus-date').click();
      await f.page.locator('[data-session-date-id="'+id+'"]').click();
    };
    const choose = async (f, id) => { await selectDate(f, id); await f.page.waitForFunction(id => document.getElementById('session').value === id && !document.getElementById('plan-focus').disabled, id); };
    const chooseDay = async (f, number) => { await f.page.locator('#planner-back').click(); await day(f, number).click(); await f.page.waitForFunction(() => !document.getElementById('plan-focus').disabled); };
    const clean = f => assert.deepEqual(f.errors, []);

    const f = await fixture(); await enter(f);
    assert.equal(await f.page.locator('#session-toolbar').isVisible(), false, 'Planner has one focused date chooser');
    assert.equal(await current(f), rid(2), 'Opening the planner starts at the nearest upcoming session');
    assert.equal(await f.page.locator('#planner-drawer').isVisible(), false);
    assert.equal(count(f, '/notes/save') + count(f, '/diagrams/list'), 0, 'Entering the planner does not write notes or fetch a closed board');
    const currentSelection = await f.page.evaluate(() => {
      const future = { id: 'future', date: '2026-10-29', time: '4:00–5:00 PM', status: 'Scheduled' };
      const ongoing = { id: 'ongoing', date: '2026-10-29', time: '10:00 AM–12:00 PM', status: 'Scheduled' };
      const pick = rows => CoachPlanner.nextSession(rows)?.id || null;
      return [
        pick([future, ongoing]),
        pick([future, { ...ongoing, time: '10:00–11:00 AM' }]),
        pick([future, { ...ongoing, status: 'Cancelled' }]),
        pick([future, { ...ongoing, status: 'Completed' }]),
        pick([future, { ...ongoing, startAt: '2026-10-29T17:00:00Z', endAt: '2026-10-29T19:00:00Z' }]),
        pick([future, { ...ongoing, time: 'Time to confirm' }]),
      ];
    });
    assert.deepEqual(currentSelection, ['ongoing', 'future', 'future', 'future', 'ongoing', 'future'], 'An active session remains reachable until its end, without reopening ended or cancelled sessions');
    checks++;
    await chooseDay(f, 3);
    assert.equal(await current(f), rid(6), 'Wednesday chooses its next active session, skipping a cancelled earlier slot');
    assert.match(await f.page.locator('#planner-focus-title').innerText(), /Wednesday/);
    assert.match(await f.page.locator('#planner-focus-detail').innerText(), /Nov|November/);
    await f.page.locator('#planner-focus-date').click(); assert.equal(await f.page.locator('[data-session-date-id="' + rid(8) + '"]').count(), 0, 'Dates more than one week ahead stay outside the sidebar');
    await choose(f, rid(1)); assert.equal(await current(f), rid(1), 'Past sessions remain explicitly reachable');
    await chooseDay(f, 3); await f.page.waitForFunction(() => document.getElementById('session').value.endsWith('000006'));
    assert.equal(await current(f), rid(6), 'Choosing the weekday again returns to its next session');
    assert.equal(await f.page.locator('[data-session-date-id="' + rid(5) + '"]').count(), 0, 'A cancelled date in another time slot stays outside this group');
    clean(f); checks++;

    const timeChoices = await f.page.evaluate(() => {
      const base = { date: '2026-10-29', status: 'Scheduled' };
      const rows = [
        { ...base, id: 'started', time: '9:00–10:00 AM' },
        { ...base, id: 'cancelled', time: '11:30 AM–12:30 PM', status: 'Cancelled' },
        { ...base, id: 'upcoming', time: '12:00–1:00 PM' },
        { ...base, id: 'unknown', time: 'Time to confirm' }
      ];
      const explicit = [
        { ...base, id: 'explicit-past', time: '2:00–3:00 PM', startAt: '2026-10-29T17:00:00Z' },
        { ...base, id: 'explicit-next', time: '3:00–4:00 PM', startAt: '2026-10-29T19:00:00Z' }
      ];
      return { next: CoachPlanner.nextSession(rows)?.id, explicit: CoachPlanner.nextSession(explicit)?.id, noWednesday: CoachPlanner.nextSession(rows, 3), none: CoachPlanner.nextSession([]) };
    });
    assert.deepEqual(timeChoices, { next: 'upcoming', explicit: 'explicit-next', noWednesday: null, none: null }, 'Next-session selection respects Vancouver current time, cancellations and explicit start timestamps');
    checks++;

    for (const startup of [{ savedStart: 'plan' }, { hash: '#view=plan' }]) {
      const initial = await fixture({ ...startup, rows: [sessions[7], sessions[1], sessions[2]] });
      await initial.page.locator('#panel-plan').waitFor({ state: 'visible' });
      await enterSelected(initial);
      await initial.page.waitForFunction(() => !document.getElementById('plan-focus').disabled);
      assert.equal(await current(initial), rid(2), 'Direct planner entry chooses the next session, not the first unsorted roster row');
      assert.equal(await initial.page.locator('#session-toolbar').isVisible(), false);
      assert.equal(count(initial, '/notes/save'), 0); clean(initial); await initial.context.close();
    }
    checks++;

    await f.page.locator('#plan-focus').fill('Fictional focus to preserve while reading notes');
    await f.page.locator('#planner-open-notes').click();
    assert.equal(await f.page.locator('#planner-notes-pane').isVisible(), true);
    const groupText = await f.page.locator('#planner-notes-list').innerText();
    assert.match(groupText, /Wednesday group: scanning/);
    assert(!groupText.includes('Thursday group') && !groupText.includes('Other field group') && !groupText.includes('Other time group') && !groupText.includes('Sam:'), 'Group folder excludes other weekdays, times, venues and individual notes');
    const optionText = await f.page.locator('#planner-notes-player').innerText();
    assert(optionText.includes('Fictional Sam') && optionText.includes('Fictional Lee') && !optionText.includes('Fictional Morgan'), 'Only selected-session players have folders');
    await f.page.locator('#planner-notes-player').selectOption(sam.playerId);
    assert.match(await f.page.locator('#planner-notes-list').innerText(), /Sam: encourage/);
    assert(!(await f.page.locator('#planner-notes-list').innerText()).includes('Morgan:'), 'Unrelated player notes remain out of this folder');
    assert(!(await f.page.locator('#planner-notes-list').innerText()).includes('separate Thursday'), 'The same player’s notes in another group stay out of this folder');
    await f.page.locator('#planner-close-drawer').click();
    assert.equal(await f.page.locator('#plan-focus').inputValue(), 'Fictional focus to preserve while reading notes');
    assert.equal(await f.page.locator('#planner-open-notes').evaluate(el => el === document.activeElement), true, 'Closing returns focus to the drawer opener');
    await f.answer(false); await selectDate(f, rid(3));
    assert.equal(await current(f), rid(6)); assert.equal(await f.page.locator('#plan-focus').inputValue(), 'Fictional focus to preserve while reading notes');
    await f.answer(true); await choose(f, rid(3));
    assert.equal(await current(f), rid(3)); assert.equal(await f.page.locator('#plan-focus').inputValue(), '');
    clean(f); checks++;

    await chooseDay(f, 3);
    await f.page.locator('#planner-open-notes').click(); await f.page.locator('#planner-notes-player').selectOption(sam.playerId);
    await f.page.locator('#planner-note-body').fill('Fictional personal observation from the planning drawer.');
    f.state.noteMode = 'delay'; const submitted = f.page.waitForRequest(r => new URL(r.url()).pathname.endsWith('/notes/save'));
    await f.page.locator('#planner-note-form button[type="submit"]').click(); await submitted;
    assert.equal(count(f, '/notes/save'), 1);
    const write = f.requests.find(r => r.path.endsWith('/notes/save'));
    assert.equal(write.payload.sessionId, rid(6)); assert.equal(write.payload.playerId, sam.playerId); assert.equal(write.payload.body, 'Fictional personal observation from the planning drawer.');
    assert.equal(write.headers['x-csrf-token'], 'fictional-planner-csrf');
    assert.equal(await f.page.locator('#planner-note-form button[type="submit"]').isDisabled(), true, 'A pending note cannot be submitted twice');
    assert.equal(await day(f, 5).isDisabled(), true, 'Session changes are locked while the note is saving');
    f.pending.shift()('fail'); await f.page.waitForFunction(() => !document.querySelector('#planner-note-form button[type="submit"]').disabled);
    assert.equal(await f.page.locator('#planner-note-body').inputValue(), write.payload.body, 'Failed note save retains the draft');
    assert.match(await f.page.locator('#planner-note-status').innerText(), /rejected|retained/i);
    f.state.noteMode = 'success'; await f.page.locator('#planner-note-form button[type="submit"]').click();
    await f.page.waitForFunction(() => document.getElementById('planner-note-body').value === '');
    assert.equal(count(f, '/notes/save'), 2); assert.match(await f.page.locator('#planner-notes-list').innerText(), /Fictional personal observation/);
    assert.equal(await current(f), rid(6)); clean(f); checks++;

    await f.page.locator('#planner-close-drawer').click(); await f.page.locator('#planner-open-tools').click();
    await f.page.waitForFunction(() => document.getElementById('tactics-title') && !document.getElementById('tactics-title').disabled);
    assert.equal(await f.page.locator('#planner-tools-pane').isVisible(), true);
    assert.equal(await f.page.locator('#tactics-board-tools').isVisible(), true);
    assert.equal(await f.page.locator('#practice-toolbox').isVisible(), true);
    assert.equal(count(f, '/diagrams/list'), 1, 'Board loads only when its pullout opens');
    await f.page.locator('#tactics-title').fill('Unsaved fictional tactic');
    await f.page.locator('#planner-close-drawer').click();
    await f.answer(false); await selectDate(f, rid(3));
    assert.equal(await current(f), rid(6), 'Tactics drafts protect day changes even with the pullout closed');
    await f.page.locator('#planner-open-tools').click(); assert.equal(await f.page.locator('#tactics-title').inputValue(), 'Unsaved fictional tactic');
    await f.page.locator('#planner-close-drawer').click(); await f.answer(true); await selectDate(f, rid(3));
    await f.page.waitForFunction(() => !document.getElementById('plan-focus').disabled);
    assert.equal(await current(f), rid(3)); clean(f); checks++;

    await f.page.locator('#planner-open-notes').click();
    const focusInside = () => f.page.evaluate(() => document.getElementById('planner-drawer').contains(document.activeElement));
    assert.equal(await focusInside(), true, 'Opening a drawer moves keyboard focus inside it');
    for (let index = 0; index < 18; index++) { await f.page.keyboard.press('Tab'); assert.equal(await focusInside(), true, 'Tab stays in the open drawer'); }
    await f.page.keyboard.press('Escape'); assert.equal(await f.page.locator('#planner-drawer').isVisible(), false);
    assert.equal(await f.page.locator('#planner-open-notes').evaluate(el => el === document.activeElement), true);
    await f.page.locator('#planner-open-run').click(); assert.equal(await f.page.locator('#planner-run-pane').isVisible(), true); assert.equal(await f.page.locator('#session-field-tools').isVisible(), true);
    await f.page.keyboard.press('Escape'); clean(f); checks++;

    for (const width of [1365, 390, 320]) {
      await f.page.setViewportSize({ width, height: 950 });
      assert(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Planner does not overflow at ' + width);
      for (const id of ['planner-focus-date', 'planner-open-notes', 'planner-open-tools', 'planner-open-run']) { const box = await f.page.locator('#' + id).boundingBox(); assert(box && box.height >= 43, id + ' touch target at ' + width); }
      await f.page.locator('#planner-open-notes').click();
      assert(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Notes drawer does not overflow at ' + width);
      const box = await f.page.locator('#planner-drawer').boundingBox(); assert(box && box.x >= -1 && box.x + box.width <= width + 1, 'Drawer fits at ' + width);
      await f.page.keyboard.press('Escape');
      await f.page.locator('#planner-open-tools').click(); assert(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Tools drawer does not overflow at ' + width); await f.page.keyboard.press('Escape');
    }
    const type = await f.page.locator('#page-title').evaluate(el => getComputedStyle(el).fontFamily);
    assert(!/instrument|(?:^|,\s*)serif(?:,|$)/i.test(type), 'Planner heading uses the simple sans typography');
    assert(await f.page.locator('#planner-open-notes').evaluate(el => parseFloat(getComputedStyle(el).borderRadius) >= 10), 'Planner controls use rounded buttons');
    assert.equal(await f.page.evaluate(() => localStorage.length), 0, 'Planning does not persist identities, private notes or players in browser storage');
    await f.page.setViewportSize({ width: 1365, height: 950 }); await f.page.evaluate(() => scrollTo(0, 0)); fs.mkdirSync('outputs', { recursive: true }); await f.page.screenshot({ path: 'outputs/coach-planner-desktop.png', fullPage: true });
    await f.page.setViewportSize({ width: 390, height: 950 }); await f.page.evaluate(() => scrollTo(0, 0)); await f.page.screenshot({ path: 'outputs/coach-planner-mobile.png', fullPage: true });
    clean(f); checks++;
    await f.page.locator('#planner-home').click(); await f.page.locator('#logout').click(); await f.page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(await f.page.locator('#planner-drawer').isVisible(), false); assert.equal((await f.page.locator('#planner-notes-list').textContent()).trim(), '');
    assert.equal((await f.page.locator('#planner-note-body').inputValue()).trim(), ''); clean(f); checks++;
    await f.context.close();

    const restricted = await fixture({ role: 'coach', rows: [sessions[2]] }); await enter(restricted);
    assert.equal(await current(restricted), rid(3)); assert.equal(await day(restricted, 3).count(), 0, 'An unassigned group is absent');
    await restricted.page.locator('#planner-open-notes').click();
    assert(!(await restricted.page.locator('#planner-notes-player').innerText()).includes('Fictional Sam'), 'Unassigned players have no folder');
    clean(restricted); await restricted.context.close(); checks++;

    const unmapped = await fixture({ rows: [sessions[0], sessions[5]].map(row => ({ ...row, programId: null })) });
    await unmapped.page.locator('#navigation [data-tab="plan"]').click();
    assert.equal(await unmapped.page.locator('#planner-days [data-group-key]').count(), 1, 'Unmapped dates use one navigation bucket, not dated cards');
    await unmapped.page.locator('#planner-days [data-group-key]').click();
    assert.equal(await current(unmapped), rid(6));
    await unmapped.page.locator('#planner-open-notes').click();
    assert(!(await unmapped.page.locator('#planner-notes-list').innerText()).includes('Wednesday group: scanning'), 'Unmapped navigation does not imply shared group history');
    await unmapped.page.locator('#planner-notes-player').selectOption(sam.playerId);
    assert(!(await unmapped.page.locator('#planner-notes-list').innerText()).includes('Sam: encourage'), 'Unmapped navigation does not imply shared player history');
    await unmapped.page.locator('#planner-close-drawer').click();
    await choose(unmapped, rid(1));
    await unmapped.page.locator('#planner-open-notes').click();
    assert.match(await unmapped.page.locator('#planner-notes-list').innerText(), /Wednesday group: scanning/,'The recorded date remains explicitly reachable');
    clean(unmapped); await unmapped.context.close(); checks++;

    const draft = await fixture(); await enter(draft); await draft.page.locator('#planner-open-notes').click();
    await draft.page.locator('#planner-note-body').fill('Fictional unsaved group note'); await draft.page.locator('#planner-close-drawer').click();
    await draft.answer(false); await selectDate(draft, rid(3));
    assert.equal(await current(draft), rid(2), 'An unsaved drawer note protects its original session');
    await draft.page.locator('#planner-open-notes').click(); assert.equal(await draft.page.locator('#planner-note-body').inputValue(), 'Fictional unsaved group note');
    await draft.page.locator('#planner-close-drawer').click(); await draft.answer(true); await selectDate(draft, rid(3));
    await draft.page.waitForFunction(() => document.getElementById('session').value.endsWith('000003'));
    await draft.page.locator('#planner-open-notes').click(); assert.equal(await draft.page.locator('#planner-note-body').inputValue(), '', 'Confirmed discard cannot attach the old note to a new group');
    assert.equal(count(draft, '/notes/save'), 0); clean(draft); await draft.context.close(); checks++;

    for (const mode of ['lost-unique', 'lost-ambiguous']) {
      const body = 'Fictional note with a lost save response';
      const lost = await fixture({ extraNotes: [note(90, rid(2), sam.playerId, body)] });
      await enter(lost); await lost.page.locator('#planner-open-notes').click(); await lost.page.locator('#planner-notes-player').selectOption(sam.playerId);
      await lost.page.locator('#planner-note-body').fill(body); lost.state.noteMode = mode;
      await lost.page.locator('#planner-note-form button[type="submit"]').click();
      await lost.page.waitForFunction(() => !CoachPlanner.isBusy());
      assert.equal(count(lost, '/notes/save'), 1, 'A lost response never automatically retries the note write');
      assert.equal(count(lost, '/desk'), 2, 'A lost response triggers one authoritative notes readback');
      if (mode === 'lost-unique') {
        assert.equal(await lost.page.locator('#planner-note-body').inputValue(), '', 'A unique new matching note confirms the write');
        assert.match(await lost.page.locator('#planner-note-status').innerText(), /saved/i);
        assert.equal(lost.state.notes.filter(n => n.body === body && n.session_id === rid(2)).length, 2, 'An old identical note is excluded from recovery matching');
        assert.equal(await lost.page.locator('#planner-note-form button[type="submit"]').isEnabled(), true);
      } else {
        assert.equal(await lost.page.locator('#planner-note-body').inputValue(), body, 'Ambiguous readback retains the draft for review');
        assert.match(await lost.page.locator('#planner-note-status').innerText(), /could not be verified|review/i);
        assert.equal(await lost.page.locator('#planner-note-form button[type="submit"]').isDisabled(), true, 'Ambiguous write stays on hold');
        await lost.page.locator('#planner-note-form').evaluate(form => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(count(lost, '/notes/save'), 1, 'Even synthetic submit cannot retry an uncertain save');
      }
      clean(lost); await lost.context.close(); checks++;
    }

    console.log('Coach planner layout: ' + checks + ' grouped day-selection, private-note, drawer, draft and responsive checks passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
