/* Coach Desk audit regressions. Fictional accounts, rosters and intercepted requests only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const rid = n => 'rec' + String(n).padStart(14, '0');
const owner = { email: 'fictional-owner@example.test', name: 'Fictional Owner', role: 'owner', sessionVersion: 1 };
const coach = { email: 'fictional-coach@example.test', name: 'Fictional Coach', role: 'coach', active: 1, session_version: 1, assignments: [] };
const row = (n, date, time, startAt, endAt) => ({ id: rid(n), date, time, startAt, endAt, location: 'Fictional practice field', status: 'Scheduled', capacity: 20, capacityUsed: 1, expected: 1, counts: { yes: 0, no: 0, awaiting: 1, confirmed: 0 }, issues: [], players: [{ playerId: rid(100 + n), attendanceId: rid(200 + n), name: 'Fictional player ' + n, kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] }] });
const sessions = [
  row(3, '2026-10-30', '4:00–5:00 PM', '2026-10-30T23:00:00Z', '2026-10-31T00:00:00Z'),
  row(2, '2026-10-29', 'noon–1:00 PM', '2026-10-29T19:00:00Z', '2026-10-29T20:00:00Z'),
  row(4, '2026-10-29', '9:00–10:00 AM', '2026-10-29T16:00:00Z', '2026-10-29T17:00:00Z'),
  row(1, '2026-10-29', '10:30–11:30 AM', '2026-10-29T17:30:00Z', '2026-10-29T18:30:00Z'),
];
const assets = {};
for (const [url, file, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);

(async () => {
  const browser = await chromium.launch(); let checks = 0;
  try {
    async function fixture() {
      const context = await browser.newContext({ viewport: { width: 1365, height: 950 } });
      const state = { profile: { ...owner }, coach: { ...coach, assignments: [] }, assignmentMode: 'success', failPlan: null, delayPlan: null }, requests = [], errors = [], pending = [], pendingPlans = [];
      await context.addInitScript(now => {
        const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } };
        window.fixtureAnswers = []; window.fixturePrompts = [];
        window.confirm = text => { fixturePrompts.push(text); return fixtureAnswers.shift() === true; };
      }, now);
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== origin) { errors.push('Unexpected network ' + url.origin); return route.abort(); }
        if (assets[path]) return route.fulfill({ status: 200, contentType: assets[path].type, body: assets[path].body });
        const payload = request.postData() ? request.postDataJSON() : undefined;
        requests.push({ path, payload, headers: request.headers(), method: request.method() });
        let value, status = 200;
        if (path.endsWith('/bootstrap')) value = { profile: state.profile, csrfToken: 'fictional-audit-csrf', googleEnabled: true };
        else if (path.endsWith('/desk')) value = { profile: state.profile, sessions, notes: [], tasks: [], observedAt: now };
        else if (path.endsWith('/users')) value = { users: [{ ...owner, active: 1, session_version: 1, assignments: [] }, state.coach], credentials: [] };
        else if (path.endsWith('/assign')) {
          let mode = state.assignmentMode;
          if (mode === 'delay') mode = await new Promise(resolve => pending.push(resolve));
          if (mode === 'fail') { status = 403; value = { error: 'FICTIONAL_ASSIGNMENT_REJECTED', message: 'Fictional assignment rejected.' }; }
          else {
            state.coach.assignments = payload.assigned ? [...new Set([...state.coach.assignments, payload.sessionId])] : state.coach.assignments.filter(id => id !== payload.sessionId);
            value = { saved: true };
          }
        } else if (path.endsWith('/session')) {
          if (state.delayPlan === payload.sessionId) await new Promise(resolve => pendingPlans.push(resolve));
          if (state.failPlan === payload.sessionId) { state.failPlan = null; status = 503; value = { error: 'FICTIONAL_PLAN_UNAVAILABLE', message: 'Fictional plan unavailable. Please retry.' }; }
          else value = { plan: { session_id: payload.sessionId, version: 1, content: { focus: 'Saved focus for ' + payload.sessionId, warmup: 'A saved warm-up' }, updated_by: owner.email, updated_at: now } };
        } else if (path.endsWith('/diagrams/list')) value = { diagrams: [] };
        else if (path.endsWith('/logout')) { state.profile = null; value = { signedOut: true }; }
        else { errors.push('Unexpected action ' + request.method() + ' ' + path); status = 403; value = { error: 'UNEXPECTED_FIXTURE' }; }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.stack || error.message));
      await page.goto(origin + '/workspace'); await page.locator('#app').waitFor({ state: 'visible' });
      return { page, context, state, requests, errors, pending, pendingPlans };
    }
    const f = await fixture();
    await f.page.locator('#navigation [data-tab="settings"]').click();
    await f.page.locator('[data-settings-tab="team"]').click();
    await f.page.locator('#assignments input').waitFor({ state: 'visible' });
    await f.page.locator('#session').selectOption(rid(1));
    await f.page.locator('#assignment-session').getByText(/Oct 29/).waitFor();
    f.state.assignmentMode = 'delay';
    await f.page.locator('#assignments input').check();
    await f.page.waitForFunction(() => document.getElementById('session').disabled);
    assert.equal(await f.page.locator('#logout').isEnabled(), false);
    assert.equal(await f.page.locator('#user-form button[type="submit"]').isEnabled(), false);
    assert.equal(await f.page.locator('#navigation [data-tab="attendance"]').isEnabled(), false);
    assert.equal(f.pending.length, 1);
    const assignment = f.requests.find(r => r.path.endsWith('/assign'));
    assert.equal(assignment.payload.sessionId, rid(1));
    assert.equal(assignment.payload.email, coach.email);
    assert.equal(assignment.payload.assigned, true);
    assert.equal(assignment.headers['x-csrf-token'], 'fictional-audit-csrf');
    // Even a synthetic selector event cannot redirect the pending operation.
    await f.page.evaluate(id => { const select = document.getElementById('session'); select.value = id; select.dispatchEvent(new Event('change', { bubbles: true })); }, rid(2));
    assert.equal(await f.page.locator('#session').inputValue(), rid(1));
    f.pending.shift()('success');
    await f.page.waitForFunction(() => !document.getElementById('session').disabled);
    assert.equal(await f.page.locator('#assignments input').isChecked(), true);
    assert.deepEqual(f.state.coach.assignments, [rid(1)]);
    await f.page.locator('#session').selectOption(rid(2));
    await f.page.waitForFunction(() => !document.querySelector('#assignments input').checked);
    assert.equal(await f.page.locator('#assignments input').isChecked(), false, 'The completed assignment must not leak to a different session');
    checks++;

    await f.page.locator('#session').selectOption(rid(1));
    await f.page.waitForFunction(() => document.querySelector('#assignments input').checked);
    f.state.assignmentMode = 'delay';
    await f.page.locator('#assignments input').uncheck();
    await f.page.waitForFunction(() => document.getElementById('session').disabled);
    f.pending.shift()('fail');
    await f.page.waitForFunction(() => !document.getElementById('session').disabled);
    assert.equal(await f.page.locator('#assignments input').isChecked(), true, 'Failure restores the last known assignment');
    assert.equal(await f.page.locator('#user-form button[type="submit"]').isEnabled(), true);
    assert.match(await f.page.locator('#global-error').innerText(), /assignment rejected/i);
    assert.deepEqual(f.state.coach.assignments, [rid(1)]);
    checks++;

    await f.page.locator('#navigation [data-tab="plan"]').click();
    await f.page.locator('#planner-open-selected').click();
    await f.page.waitForFunction(() => !document.getElementById('plan-focus').disabled);
    assert.equal(await f.page.locator('#session').inputValue(), rid(1), 'Planner prioritizes the session currently underway');
    assert.match(await f.page.locator('#planner-session-mode').innerText(), /in progress|happening now/i);
    assert.match(await f.page.locator('#plan-focus').inputValue(), new RegExp(rid(1)));
    checks++;

    f.state.failPlan = rid(2);
    await f.page.locator('#planner-focus-date').click();
    await f.page.locator('#planner-date').selectOption(rid(2));
    await f.page.locator('#plan-retry').waitFor({ state: 'visible' });
    assert.equal(await f.page.locator('#plan-focus').inputValue(), '', 'A failed target plan must not retain another session’s text');
    assert.equal(await f.page.locator('#plan-warmup').inputValue(), '');
    assert.equal(await f.page.locator('#plan-focus').isEnabled(), false);
    assert.equal(await f.page.locator('#plan-form button[type="submit"]').isEnabled(), false);
    assert.match(await f.page.locator('#plan-load-status').innerText(), /unavailable|could not|retry/i);
    await f.page.locator('#plan-retry').click();
    await f.page.waitForFunction(id => !document.getElementById('plan-focus').disabled && document.getElementById('plan-focus').value.includes(id), rid(2));
    assert.equal(await f.page.locator('#plan-retry').isVisible(), false);
    assert.equal(f.requests.filter(r => r.path.endsWith('/session') && r.payload.sessionId === rid(2)).length, 2);
    assert.equal(f.requests.filter(r => /\/(?:plans|notes|tasks)\/save$/.test(r.path)).length, 0, 'All plan review/recovery operations stay read-only');
    checks++;

    const chosen = await f.page.evaluate(rows => {
      const withoutInstants = rows.map(({ startAt, endAt, ...s }) => s);
      return {
        ongoing: CoachPlanner.nextSession(rows)?.id,
        parsedOngoing: CoachPlanner.nextSession(withoutInstants)?.id,
        endedOnly: CoachPlanner.nextSession(rows.filter(s => s.id.endsWith('000004'))),
        ongoingCancelled: CoachPlanner.nextSession(rows.map(s => s.id.endsWith('000001') ? { ...s, status: 'Cancelled' } : s))?.id,
      };
    }, sessions);
    assert.equal(chosen.ongoing, rid(1)); assert.equal(chosen.parsedOngoing, rid(1)); assert.equal(chosen.endedOnly, null); assert.equal(chosen.ongoingCancelled, rid(2));
    checks++;

    f.state.delayPlan = rid(3);
    if (!await f.page.locator('#planner-date').isVisible()) await f.page.locator('#planner-focus-date').click();
    await f.page.locator('#planner-date').selectOption(rid(3));
    await f.page.waitForFunction(() => document.getElementById('plan-focus').disabled);
    assert.equal(f.pendingPlans.length, 1);
    assert.equal(await f.page.locator('#plan-focus').inputValue(), '');
    await f.page.locator('#planner-focus-date').click();
    if (!await f.page.locator('#planner-date').isVisible()) await f.page.locator('#planner-focus-date').click();
    assert.equal(f.requests.filter(r => r.path.endsWith('/session') && r.payload.sessionId === rid(3)).length, 1, 'Reopening the same loading plan does not create competing requests');
    await f.page.locator('#planner-date').selectOption(rid(2));
    await f.page.waitForFunction(id => !document.getElementById('plan-focus').disabled && document.getElementById('plan-focus').value.includes(id), rid(2));
    const olderResponse = f.page.waitForResponse(response => response.url().endsWith('/session') && response.request().postDataJSON().sessionId === rid(3));
    f.pendingPlans.shift()(); await olderResponse;
    await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await f.page.locator('#session').inputValue(), rid(2));
    assert.equal(await f.page.locator('#plan-focus').inputValue(), 'Saved focus for ' + rid(2), 'A late response cannot replace the selected session plan');
    assert.equal(await f.page.locator('#plan-focus').isEnabled(), true);
    checks++;

    f.state.delayPlan = rid(1);
    if (!await f.page.locator('#planner-date').isVisible()) await f.page.locator('#planner-focus-date').click();
    await f.page.locator('#planner-date').selectOption(rid(1));
    await f.page.waitForFunction(() => document.getElementById('plan-focus').disabled);
    assert.equal(f.pendingPlans.length, 1);
    await f.page.locator('#planner-home').click(); await f.page.locator('#logout').click(); await f.page.locator('#login').waitFor({ state: 'visible' });
    const signedOutResponse = f.page.waitForResponse(response => response.url().endsWith('/session') && response.request().postDataJSON().sessionId === rid(1));
    f.pendingPlans.shift()(); await signedOutResponse;
    await f.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await f.page.locator('#plan-focus').inputValue(), '', 'Late plan data cannot reappear after sign-out');
    assert.equal(await f.page.locator('#plan-warmup').inputValue(), '');
    assert.equal(await f.page.locator('#plan-updated').textContent(), '');
    assert.equal(await f.page.locator('#app').isVisible(), false);
    checks++;
    assert.deepEqual(f.errors, []);
    await f.context.close();
    console.log('Coach audit safety: ' + checks + ' grouped pending-access, plan-load recovery and in-progress session checks passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
