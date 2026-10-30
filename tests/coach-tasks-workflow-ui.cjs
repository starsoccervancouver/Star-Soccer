/* Task editing, captured targets and recovery. Fictional records and blocked external network. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const rid = n => 'rec' + String(n).padStart(14, '0');
const owner = { email: 'fictional-owner@example.test', name: 'Fictional Owner', role: 'owner', sessionVersion: 1 };
const sessions = [1, 2].map(n => ({ id: rid(n), date: n === 1 ? '2026-10-29' : '2026-10-30', time: '4:00–5:00 PM', location: n === 1 ? 'Fictional North Field' : 'Fictional South Field', status: 'Scheduled', capacity: 20, capacityUsed: 1, expected: 1, counts: { yes: 0, no: 0, awaiting: 1, confirmed: 0 }, issues: [], players: [{ playerId: rid(n + 100), attendanceId: rid(n + 200), name: 'Fictional Player ' + n, kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] }] }));
const task = (id, title, sessionId, status = 'open', author = owner.email) => ({ id, title, session_id: sessionId, status, author_email: author, due_date: '2026-10-30', version: 1, created_at: now });
const initialTasks = [task('task_a', 'Pack blue bibs', rid(1)), task('task_b', 'Review first touch', rid(2), 'done', 'fictional-coach@example.test'), task('task_c', 'Check spare balls', null)];
const assets = {};
for (const [url, file, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);

(async () => {
  const browser = await chromium.launch(); let checks = 0;
  try {
    async function fixture() {
      const context = await browser.newContext({ viewport: { width: 1365, height: 950 } });
      const state = { profile: { ...owner }, tasks: initialTasks.map(t => ({ ...t })), mode: 'success' }, requests = [], errors = [], pending = [];
      await context.addInitScript(({ now }) => {
        const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } };
        window.fixtureAnswers = []; window.fixturePrompts = [];
        window.confirm = text => { fixturePrompts.push(text); return fixtureAnswers.shift() === true; };
      }, { now });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== origin) { errors.push('Unexpected external network ' + url.origin); return route.abort(); }
        if (assets[path]) return route.fulfill({ status: 200, contentType: assets[path].type, body: assets[path].body });
        const payload = request.postData() ? request.postDataJSON() : undefined;
        requests.push({ path, payload, method: request.method(), headers: request.headers() });
        let value, status = 200;
        if (path.endsWith('/bootstrap')) value = { profile: state.profile, csrfToken: 'fictional-tasks-csrf', googleEnabled: true };
        else if (path.endsWith('/desk')) value = { profile: state.profile, sessions, notes: [], tasks: state.tasks, observedAt: now };
        else if (path.endsWith('/session')) value = { plan: { session_id: payload.sessionId, version: 0, content: {} } };
        else if (path.endsWith('/diagrams/list')) value = { diagrams: [] };
        else if (path.endsWith('/refresh')) value = { saved: true };
        else if (path.endsWith('/tasks/save')) {
          let mode = state.mode;
          if (mode === 'delay') mode = await new Promise(resolve => pending.push(resolve));
          if (mode === 'reject') { status = 400; value = { error: 'FICTIONAL_REJECTION', message: 'Fictional task was rejected. Draft retained.' }; }
          else {
            const old = payload.id && state.tasks.find(t => t.id === payload.id);
            if (old && old.version !== payload.expectedVersion) { status = 409; value = { error: 'TASK_CHANGED', message: 'The follow-up changed. Refresh before editing.' }; }
            else {
              const saved = old ? { ...old, title: payload.title, due_date: payload.dueDate, status: payload.status, version: old.version + 1 } : { ...task('task_new_' + state.tasks.length, payload.title, payload.sessionId, payload.status), due_date: payload.dueDate };
              state.tasks = [saved, ...state.tasks.filter(t => t.id !== saved.id)];
              if (mode === 'lost-ambiguous') state.tasks.push({ ...saved, id: saved.id + '_duplicate' });
              if (mode === 'lost-unique' || mode === 'lost-ambiguous') return route.abort('failed');
              value = { tasks: state.tasks };
            }
          }
        } else if (path.endsWith('/logout')) { state.profile = null; value = { signedOut: true }; }
        else { errors.push('Unexpected fixture action ' + request.method() + ' ' + path); status = 403; value = { error: 'UNEXPECTED_FIXTURE' }; }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.stack || error.message));
      await page.goto(origin + '/workspace'); await page.locator('#app').waitFor({ state: 'visible' });
      await page.locator('#navigation [data-tab="tasks"]').click();
      return { page, context, state, requests, errors, pending, answer: value => page.evaluate(value => fixtureAnswers.push(value), value) };
    }
    const count = (f, suffix) => f.requests.filter(r => r.path.endsWith(suffix)).length;
    const row = (f, title) => f.page.locator('#task-list .task-row').filter({ has: f.page.getByText(title, { exact: true }) });
    const finish = async f => { assert.deepEqual(f.errors, []); await f.context.close(); };

    {
      const f = await fixture();
      assert.equal(await f.page.locator('#task-scope').inputValue(), 'all');
      assert.equal(await f.page.locator('#task-list .task-row').count(), 2);
      await f.page.locator('[data-task-filter="all"]').click();
      await f.page.locator('#task-search').fill('south');
      assert.equal(await f.page.locator('#task-list .task-row').count(), 1);
      assert.match(await f.page.locator('#task-list').innerText(), /Review first touch/);
      assert.match(await f.page.locator('#task-summary').innerText(), /1 of 3/);
      await f.page.locator('#task-search-clear').click();
      await f.page.locator('#task-scope').selectOption('selected');
      assert.equal(await f.page.locator('#task-list .task-row').count(), 1);
      assert.match(await f.page.locator('#task-list').innerText(), /Pack blue bibs/);
      assert.equal(count(f, '/tasks/save'), 0); checks++; await finish(f);
    }
    {
      const f = await fixture();
      await f.page.locator('[data-task-filter="all"]').click();
      await row(f, 'Review first touch').getByRole('button', { name: 'Edit', exact: true }).click();
      assert.equal(await f.page.locator('#session').inputValue(), rid(1));
      assert.match(await f.page.locator('#task-target').innerText(), /Fri, Oct 30.*Completed/);
      await f.page.locator('#task-title').fill('Review first touch video');
      await f.page.locator('#task-due').fill('2026-11-04');
      await f.page.locator('#task-submit').click();
      await f.page.locator('#task-list').getByText('Review first touch video', { exact: true }).waitFor();
      const sent = f.requests.find(r => r.path.endsWith('/tasks/save'));
      assert.deepEqual(sent.payload, { id: 'task_b', title: 'Review first touch video', sessionId: rid(2), dueDate: '2026-11-04', status: 'done', expectedVersion: 1 });
      assert.equal(sent.headers['x-csrf-token'], 'fictional-tasks-csrf');
      assert.equal(f.state.tasks.find(t => t.id === 'task_b').author_email, 'fictional-coach@example.test');
      assert.equal(await f.page.locator('#task-title').inputValue(), ''); checks++; await finish(f);
    }
    {
      const f = await fixture();
      await row(f, 'Pack blue bibs').getByRole('button', { name: 'Edit', exact: true }).click();
      await f.page.locator('#task-title').fill('Unsaved editing draft');
      await f.answer(false); await f.page.locator('#task-cancel').click();
      assert.equal(await f.page.locator('#task-title').inputValue(), 'Unsaved editing draft');
      await f.answer(true); await f.page.locator('#task-cancel').click();
      assert.equal(await f.page.locator('#task-title').inputValue(), '');
      assert.equal(await f.page.locator('#task-submit').innerText(), 'Add task');
      assert.equal(count(f, '/tasks/save'), 0); checks++; await finish(f);
    }
    {
      const f = await fixture();
      await f.page.locator('#task-due').fill('2026-11-02');
      await f.page.locator('#task-title').fill('Bring cones for this group');
      await f.answer(false); await f.page.locator('#session').selectOption(rid(2));
      assert.equal(await f.page.locator('#session').inputValue(), rid(1), 'Declined session switch keeps captured target');
      assert.equal(await f.page.locator('#task-title').inputValue(), 'Bring cones for this group');
      await f.page.locator('#task-submit').click();
      await f.page.locator('#task-list').getByText('Bring cones for this group', { exact: true }).waitFor();
      assert.equal(f.requests.find(r => r.path.endsWith('/tasks/save')).payload.sessionId, rid(1));
      assert.equal(count(f, '/tasks/save'), 1); checks++; await finish(f);
    }
    {
      const f = await fixture(); f.state.mode = 'reject';
      await row(f, 'Pack blue bibs').getByRole('button', { name: 'Edit', exact: true }).click();
      await f.page.locator('#task-title').fill('Retained title');
      await f.page.locator('#task-submit').click();
      await f.page.waitForFunction(() => document.getElementById('task-save-status').textContent.includes('rejected'));
      assert.equal(await f.page.locator('#task-title').inputValue(), 'Retained title');
      assert.equal(count(f, '/desk'), 1, 'Definite server rejection does not trigger speculative recovery');
      f.state.mode = 'success'; await f.page.locator('#task-submit').click();
      await f.page.locator('#task-list').getByText('Retained title', { exact: true }).waitFor();
      assert.equal(f.requests.filter(r => r.path.endsWith('/tasks/save'))[1].payload.expectedVersion, 1);
      checks++; await finish(f);
    }
    {
      const f = await fixture();
      await row(f, 'Pack blue bibs').getByRole('button', { name: 'Edit', exact: true }).click();
      await f.page.locator('#task-title').fill('My retained revision');
      f.state.tasks.find(t => t.id === 'task_a').version = 2;
      f.state.tasks.find(t => t.id === 'task_a').title = 'Another coach revised this task';
      await f.page.locator('#task-submit').click();
      await f.page.waitForFunction(() => document.getElementById('task-save-status').textContent.includes('changed'));
      assert.equal(await f.page.locator('#task-title').inputValue(), 'My retained revision');
      assert.equal(f.state.tasks.find(t => t.id === 'task_a').title, 'Another coach revised this task');
      assert.equal(f.requests.find(r => r.path.endsWith('/tasks/save')).payload.expectedVersion, 1);
      await f.answer(true); await f.page.locator('#refresh').click();
      await f.page.locator('#task-list').getByText('Another coach revised this task', { exact: true }).waitFor();
      await row(f, 'Another coach revised this task').getByRole('button', { name: 'Edit', exact: true }).click();
      await f.page.locator('#task-title').fill('Reviewed revision'); await f.page.locator('#task-submit').click();
      await f.page.locator('#task-list').getByText('Reviewed revision', { exact: true }).waitFor();
      assert.equal(f.requests.filter(r => r.path.endsWith('/tasks/save'))[1].payload.expectedVersion, 2);
      checks++; await finish(f);
    }
    {
      const f = await fixture(); f.state.mode = 'lost-unique';
      await f.page.locator('#task-title').fill('Recovered task');
      await f.page.locator('#task-submit').click();
      await f.page.locator('#task-list').getByText('Recovered task', { exact: true }).waitFor();
      assert.equal(count(f, '/tasks/save'), 1);
      assert.equal(count(f, '/desk'), 2);
      assert.equal(await f.page.locator('#task-title').inputValue(), '');
      checks++; await finish(f);
    }
    {
      const f = await fixture(); f.state.mode = 'lost-ambiguous';
      await f.page.locator('#task-title').fill('Uncertain task'); await f.page.locator('#task-submit').click();
      await f.page.waitForFunction(() => document.getElementById('task-save-status').textContent.includes('could not be verified'));
      assert.equal(await f.page.locator('#task-submit').isDisabled(), true);
      assert.equal(await f.page.locator('#task-title').inputValue(), 'Uncertain task');
      await f.page.locator('#task-form').evaluate(form => form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true })));
      assert.equal(count(f, '/tasks/save'), 1); checks++; await finish(f);
    }
    {
      const f = await fixture(); f.state.mode = 'delay';
      await f.page.locator('#task-title').fill('Pending follow-up'); await f.page.locator('#task-submit').click();
      assert.equal(await f.page.locator('#session').isDisabled(), true);
      assert.equal(await f.page.locator('#task-cancel').isDisabled(), true);
      assert.equal(await f.page.locator('#navigation [data-tab="home"]').isDisabled(), true);
      assert.equal(f.pending.length, 1); f.pending.shift()('success');
      await f.page.locator('#task-list').getByText('Pending follow-up', { exact: true }).waitFor(); checks++; await finish(f);
    }
    {
      const f = await fixture();
      await row(f, 'Pack blue bibs').getByRole('button', { name: 'Mark done', exact: true }).click();
      await f.page.waitForFunction(() => document.getElementById('task-summary').textContent.includes('2 completed'));
      await f.page.locator('[data-task-filter="done"]').click();
      await row(f, 'Pack blue bibs').getByRole('button', { name: 'Reopen', exact: true }).click();
      await f.page.waitForFunction(() => document.getElementById('task-summary').textContent.includes('1 completed'));
      const sent = f.requests.filter(r => r.path.endsWith('/tasks/save'));
      assert.equal(sent[0].payload.expectedVersion, 1); assert.equal(sent[1].payload.expectedVersion, 2);
      assert.equal(sent[1].payload.sessionId, rid(1)); checks++; await finish(f);
    }
    {
      const f = await fixture();
      await f.page.locator('#task-title').fill('Do not lose this draft');
      await f.answer(false); await f.page.locator('#navigation [data-tab="home"]').click();
      assert.equal(await f.page.locator('#panel-tasks').isVisible(), true);
      await f.answer(false); await f.page.locator('#refresh').click();
      assert.equal(count(f, '/refresh'), 0);
      await f.answer(false); await f.page.locator('#logout').click();
      assert.equal(count(f, '/logout'), 0);
      assert.equal(await f.page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); return !window.dispatchEvent(e); }), true);
      assert.equal(await f.page.locator('#task-title').inputValue(), 'Do not lose this draft');
      await f.answer(true); await f.page.locator('#navigation [data-tab="home"]').click();
      assert.equal(await f.page.locator('#task-title').inputValue(), '');
      checks++; await finish(f);
    }
    {
      const f = await fixture();
      for (const width of [1365, 390, 320]) {
        await f.page.setViewportSize({ width, height: 900 });
        assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, 'No task-page overflow at ' + width);
        assert.equal(await f.page.locator('#task-submit').evaluate(el => el.getBoundingClientRect().height >= 44), true);
      }
      await f.page.locator('#task-search').fill('bibs');
      await f.page.locator('#logout').click(); await f.page.locator('#login').waitFor({ state: 'visible' });
      assert.equal(await f.page.locator('#task-list').innerText(), '');
      assert.equal(await f.page.locator('#task-title').inputValue(), '');
      assert.equal(await f.page.locator('#task-search').inputValue(), '');
      checks++; await finish(f);
    }
    console.log('Coach follow-ups: ' + checks + ' grouped editing, target, filter, recovery, draft, privacy and responsive checks passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
