/* Reusable drills and transparent note suggestions. Fictional data, intercepted transport only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { openSession, openDestination } = require('./coach-fixture-navigation.cjs');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const rid = n => 'rec' + String(n).padStart(14, '0');
const owner = { email: 'library-owner@example.test', name: 'Fictional Library Owner', role: 'owner', sessionVersion: 1 };
const player = (n, name) => ({ playerId: rid(n), attendanceId: rid(n + 500), name, kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] });
const sam = player(101, 'Fictional Sam'), lee = player(102, 'Fictional Lee');
const session = (n, date, players = [sam]) => ({ id: rid(n), programId: rid(800), date, time: '4:00–5:00 PM', location: 'Fictional West Field', players, status: 'Scheduled', capacity: 20, capacityUsed: players.length, expected: players.length, counts: { yes: 0, no: 0, awaiting: players.length, confirmed: 0 }, issues: [] });
const sessions = [session(1, '2026-10-29'), session(2, '2026-10-22'), session(3, '2026-10-30', [lee])];
const notes = [
  { id: 'note1', session_id: rid(2), player_id: null, body: 'Group scanning PRIVATE_GROUP_DETAIL', category: 'Tactical', author_email: owner.email, updated_at: now },
  { id: 'note2', session_id: rid(3), player_id: null, body: 'Unrelated finishing PRIVATE_OTHER_GROUP', category: 'General', author_email: owner.email, updated_at: now },
  { id: 'note3', session_id: rid(2), player_id: sam.playerId, body: 'Sam passing PRIVATE_PLAYER_DETAIL', category: 'Technical', author_email: owner.email, updated_at: now },
  { id: 'note4', session_id: rid(3), player_id: lee.playerId, body: 'Lee defending PRIVATE_OTHER_PLAYER', category: 'Technical', author_email: owner.email, updated_at: now },
];
const drill = n => ({ id: 'drill_fixture_' + n, title: 'Reusable drill ' + n, skill: n === 10 ? 'Unique finishing' : 'Passing', minutes: 10, target: n % 2 ? 'technical' : 'warmup', setup: 'Set out a safe area and rotate roles.', coaching: 'Look for space.', progression: 'Adjust the distance.', equipment: 'Cones and balls.', diagram: null, author_email: owner.email, updated_by: owner.email, created_at: now, updated_at: now, version: 1, request_id: 'fixture-request-' + n });
const assets = {};
for (const [url, file, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);

(async () => {
  const browser = await chromium.launch(); let checks = 0;
  try {
    async function fixture({ role = 'owner', width = 1365, standalone = false, noSessions = false } = {}) {
      const context = await browser.newContext({ viewport: { width, height: 950 } });
      const profile = { ...owner, role };
      const state = { profile, drills: Array.from({ length: 10 }, (_, i) => drill(i + 1)), mode: 'success', listDelay: false }, requests = [], errors = [], pending = [], pendingLists = [];
      await context.addInitScript(({ now }) => {
        const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } };
        window.fixtureAnswers = []; window.fixturePrompts = []; window.confirm = text => { fixturePrompts.push(text); return fixtureAnswers.shift() === true; };
      }, { now });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== origin) { errors.push('Unexpected outside network ' + url.origin); return route.abort(); }
        if (assets[path]) return route.fulfill({ status: 200, contentType: assets[path].type, body: assets[path].body });
        const payload = request.postData() ? request.postDataJSON() : undefined;
        requests.push({ path, payload, method: request.method() });
        let value, status = 200;
        if (path.endsWith('/bootstrap')) value = { profile: state.profile, csrfToken: 'fictional-library-csrf', googleEnabled: true };
        else if (path.endsWith('/desk')) value = { profile: state.profile, sessions: noSessions ? [] : sessions, notes, tasks: [], observedAt: now };
        else if (path.endsWith('/session')) value = { plan: { version: 1, session_id: payload.sessionId, content: { technical: 'Saved receiving activity', warmup: 'Saved movement activity' } } };
        else if (path.endsWith('/diagrams/list')) value = { diagrams: [] };
        else if (path.endsWith('/drills/list')) { const snapshot = state.drills.map(row => ({ ...row })); if (state.listDelay) await new Promise(resolve => pendingLists.push(resolve)); value = { drills: snapshot }; }
        else if (path.endsWith('/drills/save')) {
          let mode = state.mode; if (mode === 'delay') mode = await new Promise(resolve => pending.push(resolve));
          if (mode === 'reject') { status = 409; value = { error: 'DRILL_CHANGED', message: 'Fictional drill changed. Refresh before editing.' }; }
          else if (mode === 'lost-before') return route.abort('failed');
          else {
            const old = payload.id && state.drills.find(d => d.id === payload.id), existing = payload.requestId && state.drills.find(d => d.request_id === payload.requestId);
            if (existing) value = { drill: existing };
            else {
              const saved = { ...drill(100 + state.drills.length), ...payload, id: old?.id || 'drill_new_' + state.drills.length, author_email: old?.author_email || profile.email, version: (old?.version || 0) + 1, request_id: old?.request_id || payload.requestId };
              state.drills = [saved, ...state.drills.filter(d => d.id !== saved.id)]; value = { drill: saved };
            }
            if (mode === 'lost-after') return route.abort('failed');
          }
        } else if (path.endsWith('/drills/archive')) { state.drills = state.drills.filter(d => d.id !== payload.id); value = { saved: true }; }
        else if (path.endsWith('/logout')) { state.profile = null; value = { signedOut: true }; }
        else { errors.push('Unexpected fixture action ' + request.method() + ' ' + path); status = 403; value = { error: 'UNEXPECTED_FIXTURE' }; }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(6500); page.on('pageerror', error => errors.push(error.stack || error.message));
      await page.goto(origin + '/workspace'); await page.locator('#app').waitFor({ state: 'visible' });
      if (standalone) await openDestination(page, 'library');
      else { await openSession(page, sessions, rid(1), 'plan'); await page.locator('#planner-open-tools').click(); }
      return { page, context, state, requests, errors, pending, pendingLists, answer: value => page.evaluate(value => fixtureAnswers.push(value), value) };
    }
    const count = (f, suffix) => f.requests.filter(r => r.path.endsWith(suffix)).length;
    const open = async f => { await f.page.locator('#library-disclosure > summary').click(); await f.page.waitForFunction(() => document.getElementById('library-reload').textContent === 'Refresh saved drills'); };
    const clean = async f => { assert.deepEqual(f.errors, []); await f.context.close(); };
    const fill = async (f, title) => { await f.page.locator('#library-title').fill(title); await f.page.locator('#library-setup').fill('Pairs pass through wide gates.'); };

    const standalone = await fixture({standalone:true,noSessions:true,width:390});
    await standalone.page.waitForFunction(()=>document.getElementById('library-reload').textContent==='Refresh saved drills');
    assert.equal(await standalone.page.locator('#panel-library').isVisible(),true);
    assert.equal(await standalone.page.locator('#library-form').isVisible(),false);
    assert.equal(count(standalone,'/session'),0,'Standalone library needs no session');
    assert.equal(await standalone.page.locator('#library-list [data-insert=true]:visible').count(),0);
    await standalone.page.locator('#library-new').click(); await fill(standalone,'Standalone new activity');
    await openDestination(standalone.page, 'profiles');
    assert.equal(await standalone.page.locator('#panel-library').isVisible(),true,'Unsaved drill stays after declining navigation');
    await standalone.page.locator('#library-save').click(); await standalone.page.getByText('Reusable drill saved. Session plans stay unchanged until you add it.',{exact:true}).waitFor();
    assert.equal(count(standalone,'/drills/save'),1); assert.equal(count(standalone,'/session'),0);
    assert.equal(await standalone.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await standalone.page.screenshot({path:'outputs/coach-library-standalone-mobile.png',fullPage:true});
    await standalone.page.locator('#logout').click(); await standalone.page.locator('#login').waitFor({state:'visible'});
    assert.equal(await standalone.page.locator('#library-list').textContent(),''); await clean(standalone); checks++;

    const f = await fixture(); assert.equal(count(f, '/drills/list'), 0, 'Closed archive makes no server request'); await open(f);
    assert.equal(count(f, '/drills/list'), 1); assert.equal(await f.page.locator('#library-list .library-card').count(), 8);
    await f.page.locator('#library-more').click(); assert.equal(await f.page.locator('#library-list .library-card').count(), 10);
    await f.page.locator('#library-search').fill('Unique finishing'); assert.equal(await f.page.locator('#library-list .library-card').count(), 1);
    await f.page.locator('#library-filter').selectOption('technical'); assert.equal(await f.page.locator('#library-list .library-card').count(), 0);
    await f.page.locator('#library-search').fill(''); await f.page.locator('#library-filter').selectOption('all'); checks++;

    const recommendations = f.page.locator('#library-recommendations');
    assert.match(await recommendations.innerText(), /Scanning keyword match in 1 accessible note/);
    assert.doesNotMatch(await recommendations.innerText(), /PRIVATE_|Finishing keyword|Defending keyword|Passing keyword/);
    assert.equal(await f.page.locator('#library-note-scope option').count(), 2);
    const nodeIdentity = await f.page.evaluate(() => { window.fixtureSuggestionNode = document.querySelector('#library-recommendations > article'); return !!fixtureSuggestionNode; }); assert(nodeIdentity);
    await f.page.evaluate(() => window.dispatchEvent(new CustomEvent('coach:request-context')));
    assert.equal(await f.page.evaluate(() => fixtureSuggestionNode === document.querySelector('#library-recommendations > article')), true, 'Unchanged context does not rebuild suggestions');
    await recommendations.getByRole('button', { name: /Add suggestion/ }).click();
    assert.match(await f.page.locator('#plan-technical').inputValue(), /Look, receive, choose/);
    assert.doesNotMatch(await f.page.locator('#plan-technical').inputValue(), /PRIVATE_|Fictional Sam|Scanning keyword/);
    assert.equal(count(f, '/plans/save'), 0, 'Adding a suggestion only changes the plan draft');
    await f.page.locator('#library-note-scope').selectOption(sam.playerId);
    assert.match(await recommendations.innerText(), /From your saved library · Passing keywords/); assert.doesNotMatch(await recommendations.innerText(), /PRIVATE_|Scanning keyword|Defending keyword/);
    assert.equal(await recommendations.locator('[data-saved-drill]').count(), 4, 'Relevant saved drills are ranked first and bounded'); checks++;

    await fill(f, 'A new reusable practice'); f.state.mode = 'delay'; await f.page.locator('#library-save').click();
    await f.page.waitForFunction(() => CoachLibrary.isBusy()); assert.equal(f.pending.length, 1);
    assert.equal(await f.page.locator('#library-title').isEnabled(), false); assert.equal(await f.page.locator('#logout').isEnabled(), false);
    await f.page.evaluate(() => document.getElementById('library-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(count(f, '/drills/save'), 1, 'Pending save cannot be submitted twice');
    const first = f.requests.find(r => r.path.endsWith('/drills/save')); assert.match(first.payload.requestId, /^[0-9a-f-]{36}$/); assert.equal(first.payload.expectedVersion, 0);
    f.pending.shift()('success'); await f.page.waitForFunction(() => !CoachLibrary.isBusy());
    assert.equal(await f.page.evaluate(() => CoachLibrary.isDirty()), false); assert.equal(f.state.drills.length, 11); checks++;

    f.state.mode = 'success'; await f.page.locator('#library-title').fill('Updated reusable practice'); await f.page.locator('#library-save').click();
    await f.page.waitForFunction(() => !CoachLibrary.isBusy());
    const update = f.requests.filter(r => r.path.endsWith('/drills/save')).at(-1).payload;
    assert.equal(update.id, f.state.drills[0].id); assert.equal(update.expectedVersion, 1); assert.equal(update.requestId, undefined); assert.equal(f.state.drills[0].version, 2);
    await f.page.locator('#library-cancel').click();
    const archivedId = f.state.drills[0].id; await f.page.locator('#library-search').fill('Updated reusable practice'); await f.answer(true);
    await f.page.locator('.library-card[data-drill-id="' + archivedId + '"]').getByRole('button', { name: 'Archive drill', exact: true }).click();
    await f.page.waitForFunction(() => !CoachLibrary.isBusy()); assert.equal(f.state.drills.some(d => d.id === archivedId), false); assert.equal(count(f, '/plans/save'), 0); await f.page.locator('#library-search').fill(''); checks++;

    await f.page.locator('#library-source-section').selectOption('technical'); await f.page.locator('#library-capture').click(); assert.equal(await f.page.locator('#library-setup').inputValue(), 'Saved receiving activity');
    assert.equal(await f.page.evaluate(() => CoachLibrary.isDirty()), true); assert.equal(count(f, '/drills/save'), 2, 'Capturing a saved plan creates only an unsaved drill');
    await f.page.locator('#planner-close-drawer').click(); await f.page.locator('#planner-home').click();
    assert.equal(await f.page.locator('#panel-plan').isVisible(), true, 'Unsaved library draft protects navigation');
    await f.page.locator('#planner-open-tools').click();
    await f.page.evaluate(id => window.dispatchEvent(new CustomEvent('coach:library-prefill', { detail: { sessionId: id, drill: { title: 'Starter idea', skill: 'Passing', minutes: 8, target: 'warmup', setup: 'Move through safe space.', coaching: '', progression: '', equipment: '' } } })), rid(1));
    assert.equal(await f.page.locator('#library-setup').inputValue(), 'Saved receiving activity', 'Cancelled prefill preserves draft');
    await f.answer(true);
    await f.page.evaluate(id => window.dispatchEvent(new CustomEvent('coach:library-prefill', { detail: { sessionId: id, drill: { title: 'Starter idea', skill: 'Passing', minutes: 8, target: 'warmup', setup: 'Move through safe space.', coaching: '', progression: '', equipment: '' } } })), rid(1));
    assert.equal(await f.page.locator('#library-title').inputValue(), 'Starter idea'); assert.equal(await f.page.evaluate(() => CoachLibrary.isDirty()), true); assert.equal(count(f, '/drills/save'), 2); checks++;

    f.state.mode = 'lost-after'; await f.page.locator('#library-save').click(); await f.page.locator('#library-retry').waitFor({ state: 'visible' });
    assert.equal(await f.page.locator('#library-title').isEnabled(), false); const savedCount = f.state.drills.length;
    await f.page.locator('#library-reload').click(); await f.page.waitForFunction(() => !document.getElementById('library-reload').disabled);
    assert.equal(await f.page.locator('#library-retry').isVisible(), false); assert.equal(f.state.drills.length, savedCount); assert.equal(count(f, '/drills/save'), 3); checks++;

    await f.page.locator('#library-cancel').click(); await fill(f, 'Retry without duplicating'); f.state.mode = 'lost-before';
    await f.page.locator('#library-save').click(); await f.page.locator('#library-retry').waitFor({ state: 'visible' });
    const uncertain = f.requests.filter(r => r.path.endsWith('/drills/save')).at(-1).payload;
    f.state.mode = 'success'; await f.page.locator('#library-retry').click(); await f.page.waitForFunction(() => !CoachLibrary.isBusy());
    assert.deepEqual(f.requests.filter(r => r.path.endsWith('/drills/save')).at(-1).payload, uncertain, 'Retry uses exact create request identity and payload');
    assert.equal(f.state.drills.filter(d => d.request_id === uncertain.requestId).length, 1); checks++;

    await f.page.locator('#library-search').fill('Retry'); await f.page.locator('#planner-close-drawer').click(); await f.answer(true); await f.page.locator('#planner-home').click(); await f.page.locator('#logout').click();
    await f.page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(await f.page.locator('#library-search').inputValue(), ''); assert.equal(await f.page.locator('#library-title').inputValue(), '');
    assert.equal(await f.page.locator('#library-list').textContent(), ''); assert.equal(await recommendations.textContent(), '');
    assert.equal(await f.page.evaluate(() => Object.values(localStorage).some(value => /Reusable|PRIVATE_|Retry without/.test(value))), false); await clean(f); checks++;

    const g = await fixture({ role: 'coach', width: 390 }); g.state.drills.unshift({ ...drill(99), author_email: 'other-coach@example.test', title: 'PRIVATE_OTHER_COACH_DRILL' });
    await open(g); assert.doesNotMatch(await g.page.locator('#library-list').innerText(), /PRIVATE_OTHER_COACH_DRILL/);
    assert.equal(await g.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    const invalidWrites = count(g, '/drills/save');
    await g.page.evaluate(() => window.dispatchEvent(new CustomEvent('coach:library-prefill', { detail: { sessionId: 'wrong-session', drill: { title: 'Wrong target', setup: 'Not allowed', target: 'technical', minutes: 10 } } })));
    assert.equal(await g.page.locator('#library-title').inputValue(), ''); assert.equal(count(g, '/drills/save'), invalidWrites); checks++;

    g.state.listDelay = true; await g.page.locator('#library-reload').click(); await g.page.waitForFunction(() => document.getElementById('library-reload').textContent === 'Loading…');
    assert.equal(g.pendingLists.length, 1); await g.page.locator('#planner-close-drawer').click(); await g.page.locator('#planner-home').click(); await g.page.locator('#logout').click(); await g.page.locator('#login').waitFor({ state: 'visible' });
    const response = g.page.waitForResponse(r => r.url().endsWith('/drills/list')); g.pendingLists.shift()(); await response;
    await g.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await g.page.locator('#library-list').textContent(), '', 'Late list cannot reappear after logout'); assert.equal(await g.page.locator('#coach-drill-library').isVisible(), false); await clean(g); checks++;
    console.log('Coach drill library: ' + checks + ' grouped CRUD, recovery, suggestions, privacy, draft and mobile checks passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
