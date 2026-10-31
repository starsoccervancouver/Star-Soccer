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
  const [{ validatePlanContent }, { validateDiagram }] = await Promise.all([import('../private-attendance/plan-blocks.mjs'), import('../private-attendance/tactics-validation.mjs')]);
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
    const fill = async (f, title) => { await f.page.locator('#library-title').fill(title); if (!(await f.page.locator('#library-drill-details').evaluate(el => el.open))) await f.page.locator('#library-drill-details > summary').click(); await f.page.locator('#library-setup').fill('Pairs pass through wide gates.'); };

    const standalone = await fixture({standalone:true,noSessions:true,width:390});
    await standalone.page.waitForFunction(()=>document.getElementById('library-reload').textContent==='Refresh saved drills');
    assert.equal(await standalone.page.locator('#panel-library').isVisible(),true);
    assert.equal(await standalone.page.locator('#library-form').isVisible(),false);
    assert.equal(count(standalone,'/session'),0,'Standalone library needs no session');
    assert.equal(await standalone.page.locator('#library-list [data-insert=true]:visible').count(),0);
    await standalone.page.locator('#library-new').click();
    assert.equal(await standalone.page.locator('#library-drill-details').evaluate(el=>el.open),false,'Standalone details start collapsed');
    assert.equal(await standalone.page.locator('.library-body').evaluate(el=>el.firstElementChild.id),'library-form','Editor comes before catalog filters');
    await standalone.page.locator('#library-title').fill('Standalone new activity');
    await standalone.page.locator('#library-form').evaluate(el=>el.requestSubmit());
    assert.equal(await standalone.page.locator('#library-drill-details').evaluate(el=>el.open),true,'Required-field validation opens collapsed details');
    assert.equal(count(standalone,'/drills/save'),0,'Missing required instructions never submit');
    await fill(standalone,'Standalone new activity');
    await standalone.page.locator('#library-setup').scrollIntoViewIfNeeded();
    const stickySave = await standalone.page.locator('#library-save').evaluate(el => { const r=el.getBoundingClientRect(), nav=document.querySelector('.desk-nav').getBoundingClientRect(); return {top:r.top,navBottom:nav.bottom,hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('#library-save')===el}; });
    assert(stickySave.top >= stickySave.navBottom && stickySave.hit, 'Sticky Save stays below mobile navigation and remains clickable');
    await openDestination(standalone.page, 'profiles');
    assert.equal(await standalone.page.locator('#panel-library').isVisible(),true,'Unsaved drill stays after declining navigation');
    await standalone.page.locator('#library-save').click(); await standalone.page.getByText('Reusable drill saved. Session plans stay unchanged until you add it.',{exact:true}).waitFor();
    assert.equal(count(standalone,'/drills/save'),1); assert.equal(count(standalone,'/session'),0);
    assert.equal(await standalone.page.locator('#library-drill-details').evaluate(el=>el.open),true,'Saving preserves the open details panel');
    assert.equal(await standalone.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await standalone.page.screenshot({path:'outputs/coach-library-standalone-mobile.png',fullPage:true});
    await standalone.page.locator('#logout').click(); await standalone.page.locator('#login').waitFor({state:'visible'});
    assert.equal(await standalone.page.locator('#library-list').textContent(),''); await clean(standalone); checks++;

    const viewing = await fixture({ standalone: true, width: 390 });
    await viewing.page.waitForFunction(() => document.getElementById('library-reload').textContent === 'Refresh saved drills');
    const viewed = viewing.state.drills[0];
    viewed.title = 'Fictional preview drill'; viewed.coaching = 'Scan before receiving.';
    viewed.diagram = { schemaVersion: 1, pitch: 'blank', items: [{ id: 'runner', kind: 'home', label: '9' }, { id: 'ball', kind: 'ball', label: '' }, { id: 'goal', kind: 'goal', label: '' }], frames: [
      { id: 'start', title: 'Possession', notes: 'Open passing angles.', duration: .5, positions: [{ id: 'runner', x: 20, y: 50 }, { id: 'ball', x: 26, y: 56, attachedTo: 'runner' }, { id: 'goal', x: 90, y: 50, rotation: 90 }] },
      { id: 'break', title: 'Transition', notes: 'Run forward together.', duration: .5, positions: [{ id: 'runner', x: 60, y: 50, trail: [{ x: 40, y: 30 }] }, { id: 'ball', x: 66, y: 56, attachedTo: 'runner' }, { id: 'goal', x: 90, y: 50, rotation: 90 }] },
      { id: 'finish', title: 'Shoot', notes: 'Choose the open corner.', duration: 3, positions: [{ id: 'runner', x: 65, y: 50 }, { id: 'ball', x: 90, y: 50 }, { id: 'goal', x: 90, y: 50, rotation: 90 }] }
    ] };
    const savedSnapshot = JSON.stringify(viewing.state.drills);
    await viewing.page.locator('#library-reload').click(); await viewing.page.waitForFunction(() => !document.getElementById('library-reload').disabled);
    const viewCard = viewing.page.locator('.library-card[data-drill-id="' + viewed.id + '"]'), viewButton = viewCard.getByRole('button', { name: 'View drill', exact: true });
    assert.equal(await viewing.page.getByRole('button', { name: 'Archive drill', exact: true }).count(), 0);
    await viewButton.click();
    assert.equal(await viewing.page.getByRole('dialog', { name: viewed.title }).isVisible(), true);
    assert.equal(await viewing.page.locator('#library-view-close').evaluate(e => e === document.activeElement), true);
    assert.match(await viewing.page.locator('#library-view-instructions').innerText(), /Scan before receiving/);
    assert.match(await viewing.page.locator('#library-view-board svg').textContent(), /9/);
    assert.equal(await viewing.page.locator('#library-viewer input:not([type=range]),#library-viewer textarea').count(), 0);
    assert.equal(await viewing.page.evaluate(() => CoachLibrary.isDirty() || CoachTactics.isDirty()), false);
    await viewing.page.locator('#library-view-progress').evaluate(el => { el.value = '0.25'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    const animated = await viewing.page.locator('#library-view-board [data-preview-piece="runner"]').evaluate(e => e.getAttribute('transform'));
    assert.match(animated, /translate\(400 195\)/, 'Preview follows the saved non-linear route');
    assert.match(await viewing.page.locator('#library-view-board [data-preview-piece="ball"]').getAttribute('transform'), /translate\(460 234\)/, 'Attached ball follows the runner');
    assert.equal(await viewing.page.locator('#library-view-board [data-preview-piece="goal"] [data-symbol=goal]').getAttribute('transform'), 'rotate(90)');
    await viewing.page.locator('#library-view-play').click();
    await viewing.page.waitForFunction(() => document.getElementById('library-view-phase-title').textContent === 'Phase 3: Shoot' && document.getElementById('library-view-play').getAttribute('aria-pressed') === 'false');
    assert.equal(await viewing.page.locator('#library-view-phase-notes').textContent(), 'Choose the open corner.');
    await viewing.page.locator('#library-view-restart').click(); await viewing.page.locator('#library-view-play').click();
    await viewing.page.getByRole('button', { name: '2. Transition', exact: true }).click();
    assert.equal(await viewing.page.locator('#library-view-play').getAttribute('aria-pressed'), 'false', 'Phase selection pauses playback');
    assert.equal(await viewing.page.locator('#library-view-progress').inputValue(), '0.5');
    assert.equal(await viewing.page.locator('#library-viewer').evaluate(e => e.scrollWidth <= e.clientWidth), true, 'Mobile preview does not overflow');
    await viewing.page.keyboard.press('Escape');
    assert.equal(await viewing.page.locator('#library-viewer').isVisible(), false);
    assert.equal(await viewButton.evaluate(e => e === document.activeElement), true, 'Escape restores focus');
    await viewButton.click(); assert.equal(await viewing.page.locator('#library-view-progress').inputValue(), '0', 'Reopening starts at the first phase');
    await viewing.page.locator('#library-view-close').click();
    await viewing.page.getByRole('button', { name: 'View drill', exact: true }).nth(1).click();
    assert.match(await viewing.page.locator('#library-view-board').textContent(), /No diagram saved/);
    assert.equal(await viewing.page.locator('#library-view-play').isVisible(), false);
    await viewing.page.locator('#library-view-close').click();
    assert.equal(JSON.stringify(viewing.state.drills), savedSnapshot, 'Viewing never changes saved drills');
    assert.equal(count(viewing, '/drills/save') + count(viewing, '/drills/archive') + count(viewing, '/plans/save'), 0, 'Preview has no write requests');
    await viewButton.click();
    await viewing.page.evaluate(() => window.dispatchEvent(new CustomEvent('coach:context', { detail: { profile: null, tab: 'library' } })));
    assert.equal(await viewing.page.locator('#library-viewer').isVisible(), false);
    assert.doesNotMatch(await viewing.page.locator('#library-viewer').textContent(), /Fictional preview|Scan before/);
    await clean(viewing); checks++;

    const copies = await fixture({ standalone: true });
    await copies.page.waitForFunction(() => document.getElementById('library-reload').textContent === 'Refresh saved drills');
    const original = copies.state.drills[0]; original.minutes = 25; original.setup = 'Long setup instruction. '.repeat(12); original.diagram = { schemaVersion:1,pitch:'half',items:[{id:'player_1',kind:'home',label:'1'}],frames:[{id:'phase_1',title:'Start',duration:3,positions:[{id:'player_1',x:20,y:40}]}] };
    await copies.page.locator('#library-reload').click(); await copies.page.waitForFunction(() => !document.getElementById('library-reload').disabled);
    await copies.page.locator('#library-advanced-filters > summary').click();
    await copies.page.locator('#library-skill-filter').selectOption('unique finishing'); assert.equal(await copies.page.locator('.library-card').count(), 1);
    await copies.page.locator('#library-duration-filter').selectOption('long'); assert.equal(await copies.page.locator('.library-card').count(), 0);
    await copies.page.locator('#library-skill-filter').selectOption(''); assert.equal(await copies.page.locator('.library-card').count(), 1);
    const originalCard = copies.page.locator('.library-card[data-drill-id="' + original.id + '"]');
    assert.equal(await originalCard.locator('details').getAttribute('open'), null);
    await originalCard.locator('summary').click(); assert.equal(await originalCard.getByText(original.setup, { exact: true }).isVisible(), true);
    await originalCard.getByRole('button', { name: 'Duplicate drill', exact: true }).click();
    assert.equal(await copies.page.locator('#library-title').inputValue(), original.title + ' (copy)'); assert.equal(await copies.page.evaluate(() => CoachLibrary.isDirty()), true);
    assert.equal(count(copies, '/drills/save'), 0, 'Duplicating creates only an editable draft');
    await copies.page.locator('#library-save').click(); await copies.page.waitForFunction(() => !CoachLibrary.isBusy());
    const copyPayload = copies.requests.filter(r => r.path.endsWith('/drills/save')).at(-1).payload;
    assert.equal(copyPayload.id, null); assert.equal(copyPayload.expectedVersion, 0); assert.deepEqual(copyPayload.diagram, original.diagram);
    assert.equal(original.version, 1); assert.notEqual(copies.state.drills[0].id, original.id); checks++;

    await originalCard.getByRole('button', { name: 'Edit drill', exact: true }).click(); await copies.page.locator('#library-title').fill('My conflict draft');
    original.title = 'Latest shared drill'; original.version = 2; copies.state.mode = 'reject';
    await copies.page.locator('#library-save').click(); await copies.page.locator('#library-open-latest').waitFor({ state: 'visible' });
    assert.equal(await copies.page.locator('#library-title').inputValue(), 'My conflict draft'); assert.equal(await copies.page.locator('#library-save').isEnabled(), false);
    assert.equal(await copies.page.locator('#library-retry').isVisible(), false);
    const beforeLatest = count(copies, '/drills/list'); await copies.page.locator('#library-open-latest').click();
    assert.equal(count(copies, '/drills/list'), beforeLatest); assert.equal(await copies.page.locator('#library-title').inputValue(), 'My conflict draft', 'Declining discard preserves the conflict draft');
    await copies.answer(true); await copies.page.locator('#library-open-latest').click(); await copies.page.getByText('Latest saved drill opened.', { exact: true }).waitFor();
    assert.equal(await copies.page.locator('#library-title').inputValue(), 'Latest shared drill'); assert.equal(await copies.page.locator('#library-open-latest').isVisible(), false);
    copies.state.mode = 'success'; await copies.page.locator('#library-title').fill('Updated latest drill'); await copies.page.locator('#library-save').click(); await copies.page.waitForFunction(() => !CoachLibrary.isBusy());
    assert.equal(copies.requests.filter(r => r.path.endsWith('/drills/save')).at(-1).payload.expectedVersion, 2);
    await originalCard.getByRole('button', { name: 'Edit drill', exact: true }).click(); await copies.page.locator('#library-title').fill('Keep these changes'); copies.state.mode = 'reject';
    await copies.page.locator('#library-save').click(); await copies.page.locator('#library-keep-copy').waitFor({ state: 'visible' });
    await copies.page.locator('#library-keep-copy').click(); assert.equal(await copies.page.locator('#library-title').inputValue(), 'Keep these changes (copy)');
    assert.equal(await copies.page.evaluate(() => CoachLibrary.isDirty()), true); copies.state.mode = 'success';
    await copies.page.locator('#library-save').click(); await copies.page.waitForFunction(() => !CoachLibrary.isBusy());
    const kept = copies.requests.filter(r => r.path.endsWith('/drills/save')).at(-1).payload;
    assert.equal(kept.id, null); assert.equal(kept.expectedVersion, 0); assert.deepEqual(kept.diagram, original.diagram);
    assert.equal(copies.state.drills.find(d => d.id === original.id).title, 'Updated latest drill'); await clean(copies); checks++;

    const ideas = await fixture({ width: 390 }); await open(ideas);
    let longestInstructions = 0;
    for (const source of ['preset', 'starter']) {
      await ideas.page.locator('#library-source-filter').selectOption(source); await ideas.page.locator('#library-more').click();
      const cards = ideas.page.locator('#library-list .library-card'); assert.equal(await cards.count(), 10);
      await ideas.page.evaluate(() => CoachPlanBlocks.discard());
      for (let index = 0; index < 10; index++) {
        await ideas.page.evaluate(() => CoachTactics.discard());
        const title = await cards.nth(index).locator('h3').innerText();
        await cards.nth(index).locator('[data-insert=true]').click();
        const activities = await ideas.page.evaluate(() => CoachPlanBlocks.content());
        assert.equal(activities.length, index + 1, source + ': ' + title + ' appends to the primary sequence');
        const activity = activities.at(-1); assert.equal(activity.title, title); assert.match(activity.instructions, new RegExp('\\(' + activity.duration + ' min\\)'));
        assert.deepEqual(validatePlanContent({ activities }), { activities }); longestInstructions = Math.max(longestInstructions, activity.instructions.length);
        assert(activity.diagram.items.length > 0); assert.deepEqual(validateDiagram(activity.diagram), activity.diagram);
        assert.equal(await ideas.page.evaluate(() => CoachTactics.isDirty()), false, 'Adding a preset keeps standalone tactics untouched');
        assert.equal(await ideas.page.locator('#plan-technical').inputValue(), 'Saved receiving activity', 'Supporting notes are preserved');
        if (source === 'preset') assert.match(activity.instructions, /https:\/\/(www\.fifatrainingcentre\.com|learn\.englandfootball\.com)\//);
      }
    }
    assert.equal(count(ideas, '/plans/save') + count(ideas, '/diagrams/save') + count(ideas, '/drills/save'), 0, 'All 20 direct additions remain unsaved drafts');
    console.log('All 20 library ideas insert valid primary activities with original diagram snapshots; longest combined instructions: ' + longestInstructions + ' / 2000 characters.');
    await clean(ideas); checks++;

    const attached = await fixture(); await open(attached);
    await attached.page.locator('#tactics-add-home').click(); await fill(attached, 'Diagram drill');
    await attached.page.locator('#library-attach-diagram').click();
    assert.match(await attached.page.locator('#library-diagram-status').innerText(), /Attached/);
    assert.equal(await attached.page.evaluate(() => CoachLibrary.isDirty()), true);
    await attached.page.locator('#library-save').click(); await attached.page.waitForFunction(() => !CoachLibrary.isBusy());
    const diagramPayload = attached.requests.filter(r => r.path.endsWith('/drills/save')).at(-1).payload;
    assert.equal(diagramPayload.diagram.items.length, 1);
    await attached.page.evaluate(() => CoachTactics.discard());
    await attached.page.locator('#library-search').fill('Diagram drill');
    const diagramCard = attached.page.locator('#library-list .library-card').filter({hasText:'Diagram drill'});
    assert.equal(await diagramCard.locator('svg').count(), 1);
    await diagramCard.locator('[data-insert=true]').click();
    assert.match(await attached.page.locator('#plan-block-0-instructions').inputValue(), /Diagram drill/);
    assert.equal(await attached.page.evaluate(() => CoachPlanBlocks.content()[0].diagram.items.length), 1);
    assert.equal(await attached.page.evaluate(() => CoachTactics.isDirty()), false);
    assert.equal(count(attached, '/diagrams/save'), 0, 'Adding a diagram is an explicit draft, not a server write');
    const insertedActivities = await attached.page.evaluate(() => CoachPlanBlocks.content());
    await diagramCard.locator('[data-insert=true]').click();
    const secondInsert = await attached.page.evaluate(() => CoachPlanBlocks.content());
    assert.equal(secondInsert.length, insertedActivities.length + 1);
    assert.deepEqual(secondInsert[0], insertedActivities[0], 'Adding another copy never overwrites the first activity or diagram');
    await diagramCard.getByRole('button',{name:'Edit drill',exact:true}).click();
    await attached.page.locator('#library-remove-diagram').click();
    assert.equal(await attached.page.evaluate(() => CoachLibrary.isDirty()), true, 'Removing only a diagram protects the unsaved draft');
    await clean(attached); checks++;

    const f = await fixture(); assert.equal(count(f, '/drills/list'), 0, 'Closed archive makes no server request'); await open(f);
    await f.page.locator('#library-source-filter').selectOption('saved');
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
    assert.match(await f.page.locator('#plan-block-0-instructions').inputValue(), /Look, receive, choose/);
    assert.doesNotMatch(await f.page.locator('#plan-block-0-instructions').inputValue(), /PRIVATE_|Fictional Sam|Scanning keyword/);
    assert.equal(count(f, '/plans/save'), 0, 'Adding a suggestion only changes the plan draft');
    await f.page.locator('#library-note-scope').selectOption(sam.playerId);
    assert.match(await recommendations.innerText(), /From your saved library · Passing keywords/); assert.doesNotMatch(await recommendations.innerText(), /PRIVATE_|Scanning keyword|Defending keyword/);
    assert.equal(await recommendations.locator('[data-saved-drill]').count(), 4, 'Relevant saved drills are ranked first and bounded'); checks++;

    await fill(f, 'A new reusable practice'); f.state.mode = 'delay'; await f.page.locator('#library-save').click();
    await f.page.waitForFunction(() => CoachLibrary.isBusy()); assert.equal(f.pending.length, 1);
    assert.equal(await f.page.locator('#library-title').isEnabled(), false); assert.equal(await f.page.locator('#logout').isEnabled(), false);
    assert.equal(await f.page.getByRole('button', { name: 'Duplicate drill', exact: true }).first().isEnabled(), false);
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
    const viewedId = f.state.drills[0].id; await f.page.locator('#library-search').fill('Updated reusable practice');
    await f.page.locator('.library-card[data-drill-id="' + viewedId + '"]').getByRole('button', { name: 'View drill', exact: true }).click();
    assert.equal(await f.page.locator('#library-viewer').isVisible(), true); await f.page.locator('#library-view-close').click();
    assert.equal(f.state.drills.some(d => d.id === viewedId), true); assert.equal(count(f, '/drills/archive'), 0); assert.equal(count(f, '/plans/save'), 0); await f.page.locator('#library-search').fill(''); checks++;

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
