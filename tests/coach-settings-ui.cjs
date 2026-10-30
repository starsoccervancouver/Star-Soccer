/* Full Coach Desk settings tests. Fictional accounts and intercepted network only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { openSession, openDestination } = require('./coach-fixture-navigation.cjs');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const key = 'coach-desk-display-v1', rid = n => 'rec' + String(n).padStart(14, '0');
const sessions = [1, 2].map(n => ({ id: rid(n), date: n === 1 ? '2026-10-29' : '2026-10-30', time: '4:00–5:00 PM', location: 'Fictional practice field', status: 'Scheduled', capacity: 20, capacityUsed: 1, expected: 1, counts: { yes: 0, no: 0, awaiting: 1, confirmed: 0 }, issues: [], players: [{ playerId: rid(100 + n), attendanceId: rid(200 + n), name: 'Fictional player ' + n, kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] }] }));
const assets = {};
for (const [url, file, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);

(async () => {
  const browser = await chromium.launch(); let checks = 0;
  try {
    async function fixture({ role = 'owner', stored, hash = '', deniedStorage = false } = {}) {
      const context = await browser.newContext({ viewport: { width: 1365, height: 950 } });
      const state = { profile: { email: 'fictional-' + role + '@example.test', name: 'Fictional ' + role, role, sessionVersion: 1 } }, requests = [], errors = [];
      await context.addInitScript(({ now, key, stored, deniedStorage }) => {
        const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } };
        if (stored !== undefined && !sessionStorage.getItem('fixture-seeded')) { localStorage.setItem(key, stored); sessionStorage.setItem('fixture-seeded', 'true'); }
        if (deniedStorage) { Storage.prototype.getItem = () => { throw new DOMException('Fictional blocked storage', 'SecurityError'); }; Storage.prototype.setItem = () => { throw new DOMException('Fictional blocked storage', 'SecurityError'); }; Storage.prototype.removeItem = () => { throw new DOMException('Fictional blocked storage', 'SecurityError'); }; }
        window.fixtureAnswers = []; window.fixturePrompts = [];
        window.confirm = text => { fixturePrompts.push(text); return fixtureAnswers.shift() === true; };
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.fixtureCopied = value; } }, configurable: true });
      }, { now, key, stored, deniedStorage });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== origin) { errors.push('Unexpected external network ' + url.origin); return route.abort(); }
        if (assets[path]) return route.fulfill({ status: 200, contentType: assets[path].type, body: assets[path].body });
        const payload = request.postData() ? request.postDataJSON() : undefined; requests.push({ path, method: request.method(), payload });
        let value;
        if (path.endsWith('/bootstrap')) value = { profile: state.profile, csrfToken: 'fictional-settings-csrf', googleEnabled: true };
        else if (path.endsWith('/desk')) value = { profile: state.profile, sessions, notes: [], tasks: [], observedAt: now };
        else if (path.endsWith('/session')) value = { plan: { session_id: payload.sessionId, version: 0, content: {} } };
        else if (path.endsWith('/users') && role === 'owner') value = { users: [{ ...state.profile, active: 1, session_version: 1, assignments: [] }], credentials: [] };
        else if (path.endsWith('/audit') && role !== 'coach') value = { events: [{ id: 'fictional-event', action: 'plan-updated', actor_email: state.profile.email, occurred_at: now, detail: '{}' }] };
        else if (path.endsWith('/legacy-notes') && role !== 'coach') value = { notes: [] };
        else if (path.endsWith('/diagrams/list')) value = { diagrams: [] };
        else if (path.endsWith('/drills/list')) value = { drills: [] };
        else if (path.endsWith('/refresh')) value = { profile: state.profile, sessions, observedAt: now };
        else if (path.endsWith('/logout')) { state.profile = null; value = { signedOut: true }; }
        else { errors.push('Unexpected fixture action: ' + request.method() + ' ' + path); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"FICTIONAL_FORBIDDEN"}' }); }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/workspace' + hash); await page.locator('#app').waitFor({ state: 'visible' });
      return { page, context, state, requests, errors, answer: value => page.evaluate(value => fixtureAnswers.push(value), value) };
    }
    const clickSettings = async f => { if (await f.page.locator('body').evaluate(body => body.classList.contains('planner-focus-mode'))) { await f.page.locator('#planner-home').click(); if (await f.page.locator('body').evaluate(body => body.classList.contains('planner-focus-mode'))) return; } await openDestination(f.page, 'settings'); };
    const section = (f, name) => f.page.locator('#settings-navigation [data-settings-tab="' + name + '"]');
    const count = (f, suffix) => f.requests.filter(r => r.path.endsWith(suffix)).length;

    for (const role of ['owner', 'admin', 'coach']) {
      const f = await fixture({ role }); await clickSettings(f);
      assert.equal(await f.page.locator('#panel-settings').isVisible(), true);
      assert.deepEqual(await f.page.locator('#navigation button[data-tab]').evaluateAll(buttons=>buttons.map(button=>button.dataset.tab)), ['home','plan','profiles','library','settings'], 'Main navigation contains only active coaching sections');
      assert.equal(await f.page.locator('#navigation [data-tab="team"],#navigation [data-tab="activity"],#navigation [data-tab="legacy"]').count(), 0);
      assert.equal(await f.page.locator('#profile-name').innerText(), 'Fictional ' + role);
      assert.equal(await f.page.locator('#profile-email').innerText(), 'fictional-' + role + '@example.test');
      assert.match(await f.page.locator('#profile-role').innerText(), role === 'admin' ? /admin/i : new RegExp(role, 'i'));
      assert(!(await f.page.locator('#profile-role').innerText()).includes('\uFFFD'), 'Role labels have no broken character encoding');
      assert.equal(await f.page.locator('#profile-name input,#profile-email input').count(), 0, 'Identity is not a misleading editable form');
      assert.equal(await f.page.locator('#session-toolbar').isVisible(), false);
      assert.equal(count(f, '/users') + count(f, '/audit') + count(f, '/legacy-notes'), 0, 'Profile does not read administrative data');
      assert.equal(await section(f, 'team').isVisible(), role === 'owner');
      assert.equal(await section(f, 'activity').isVisible(), role !== 'coach');
      assert.equal(await section(f, 'legacy').isVisible(), role !== 'coach');
      if (role === 'owner') {
        await section(f, 'team').click(); await f.page.waitForFunction(() => document.getElementById('user-list').textContent.includes('Fictional owner'));
        assert.equal(await f.page.locator('#panel-team').isVisible(), true); assert.equal(await f.page.locator('#session-toolbar').isVisible(), false); assert.equal(count(f, '/users'), 1);
      } else {
        await section(f, 'team').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await f.page.locator('#panel-team').isVisible(), false); assert.equal(count(f, '/users'), 0, 'Hidden owner navigation cannot grant access');
      }
      if (role !== 'coach') {
        await section(f, 'activity').click(); await f.page.waitForFunction(() => document.getElementById('activity-list').textContent.includes('plan updated'));
        assert.equal(await f.page.locator('#session-toolbar').isVisible(), false); assert.equal(count(f, '/audit'), 1);
        await section(f, 'legacy').click(); assert.equal(count(f, '/legacy-notes'), 0, 'Legacy import stays explicitly loaded');
        await f.page.locator('#load-legacy').click(); await f.page.waitForFunction(() => document.getElementById('legacy-list').textContent.includes('No written'));
      } else {
        for (const tab of ['activity', 'legacy']) await section(f, tab).evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(count(f, '/audit') + count(f, '/legacy-notes'), 0); assert.equal(await f.page.locator('#panel-settings').isVisible(), true);
      }
      assert.deepEqual(f.errors, []); checks++; await f.context.close();
    }

    const p = await fixture();
    assert.equal(await p.page.locator('#home-notes,#go-notes').count(), 0, 'Overview no longer includes the recent-notes widget');
    await p.page.locator('#open-profile').click();
    assert.equal(await p.page.locator('#preference-density,#preference-motion').count(), 0);
    const normalSize = await p.page.locator('.preference-preview p').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    await p.page.locator('#preference-text-size').selectOption('large');
    assert(await p.page.locator('.preference-preview p').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) > normalSize, 'Reading size changes rendered text immediately');
    assert.equal(await p.page.locator('#note-body').evaluate(el => getComputedStyle(el).fontSize), '18px', 'The preference changes the actual note editor');
    await p.page.locator('#preference-session-view').selectOption('calendar');
    await p.page.locator('#preference-start').selectOption('plan');
    const stored = await p.page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    assert.deepEqual(stored, { start: 'plan', textSize: 'large', sessionView: 'calendar' });
    assert.equal(p.requests.filter(r => r.method === 'POST').length, 0, 'Preferences do not make remote writes');
    await p.page.locator('#navigation [data-tab="home"]').click();
    assert.equal(await p.page.locator('#coaching-hub').getAttribute('data-coach-view'), 'calendar');
    assert.equal(await p.page.locator('#coaching-hub .coach-calendar').isVisible(), true);
    await p.page.locator('#navigation [data-tab="plan"]').click();
    assert.equal(await p.page.locator('#planner-session-browser').getAttribute('data-coach-view'), 'calendar');
    await p.page.reload(); await p.page.locator('#panel-plan').waitFor({ state: 'visible' });
    assert.equal(await p.page.locator('#planner-session-browser').getAttribute('data-coach-view'), 'calendar');
    assert.equal(await p.page.locator('#note-body').evaluate(el => getComputedStyle(el).fontSize), '18px'); checks++;
    await clickSettings(p); await p.page.locator('#preference-session-view').selectOption('list');
    await p.page.locator('#navigation [data-tab="home"]').click(); assert.equal(await p.page.locator('#coaching-hub').getAttribute('data-coach-view'), 'list');
    await p.page.locator('#navigation [data-tab="plan"]').click(); assert.equal(await p.page.locator('#planner-session-browser').getAttribute('data-coach-view'), 'list');
    await clickSettings(p); await p.page.locator('#reset-preferences').click();
    assert.equal(await p.page.locator('#preference-start').inputValue(), 'home');
    assert.equal(await p.page.locator('#preference-text-size').inputValue(), 'standard');
    assert.equal(await p.page.locator('#preference-session-view').inputValue(), 'grid');
    assert.equal(await p.page.locator('#planner-session-browser').getAttribute('data-coach-view'), 'grid');
    assert.equal(await p.page.locator('.preference-preview p').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), normalSize);
    assert.equal(await p.page.evaluate(key => localStorage.getItem(key), key), null);
    await p.page.locator('#copy-workspace-link').click(); assert.equal(await p.page.evaluate(() => fixtureCopied), origin + '/workspace');
    await p.page.reload(); await p.page.locator('#panel-home').waitFor({ state: 'visible' }); assert.deepEqual(p.errors, []); checks++;
    for (const start of ['profiles', 'library']) {
      await clickSettings(p); await p.page.locator('#preference-start').selectOption(start);
      await p.page.reload(); await p.page.locator('#panel-' + start).waitFor({ state: 'visible' });
    }
    assert.deepEqual(p.errors, []); checks++; await p.context.close();

    for (const stored of ['{broken', JSON.stringify({ start: 'team', textSize: 'anything', sessionView: 'all', owner: true })]) {
      const bad = await fixture({ role: 'coach', stored }); assert.equal(await bad.page.locator('#panel-home').isVisible(), true);
      await clickSettings(bad); assert.equal(await bad.page.locator('#preference-text-size').inputValue(), 'standard'); assert.equal(await bad.page.locator('#preference-session-view').inputValue(), 'grid'); assert.deepEqual(bad.errors, []); await bad.context.close();
    }
    const legacy = await fixture({ stored: JSON.stringify({start:'attendance',density:'compact',reduceMotion:true}) });
    assert.equal(await legacy.page.locator('#panel-plan').isVisible(), true, 'Old attendance startup setting migrates to Training groups');
    await clickSettings(legacy); assert.equal(await legacy.page.locator('#preference-start').inputValue(), 'plan'); assert.equal(await legacy.page.locator('#preference-text-size').inputValue(), 'standard'); assert.deepEqual(legacy.errors, []); await legacy.context.close();
    const blocked = await fixture({ deniedStorage: true }); await clickSettings(blocked); await blocked.page.locator('#preference-text-size').selectOption('large');
    assert.equal(await blocked.page.locator('#note-body').evaluate(el => getComputedStyle(el).fontSize), '18px'); assert.match(await blocked.page.locator('#preferences-status').innerText(), /Applied for this visit/); assert.deepEqual(blocked.errors, []); await blocked.context.close(); checks++;

    const d = await fixture(); await openSession(d.page, sessions, rid(1), 'plan'); await d.page.waitForFunction(() => !document.getElementById('plan-focus').disabled);
    await d.page.locator('#plan-focus').fill('Fictional unsaved plan'); await d.answer(false); await clickSettings(d);
    assert.equal(await d.page.locator('#panel-plan').isVisible(), true); assert.equal(await d.page.locator('#plan-focus').inputValue(), 'Fictional unsaved plan');
    await d.answer(true); await clickSettings(d); assert.equal(await d.page.locator('#panel-settings').isVisible(), true);
    await openSession(d.page, sessions, rid(1), 'plan'); await d.page.locator('#planner-open-tools').click(); await d.page.waitForFunction(() => !document.getElementById('tactics-title').disabled);
    await d.page.locator('#tactics-title').fill('Fictional unsaved drill'); await d.page.locator('#planner-close-drawer').click(); await d.answer(false); await clickSettings(d);
    assert.equal(await d.page.locator('#panel-plan').isVisible(), true); assert.equal(await d.page.locator('#tactics-title').inputValue(), 'Fictional unsaved drill');
    await d.answer(true); await clickSettings(d); assert.equal(await d.page.locator('#panel-settings').isVisible(), true); assert.deepEqual(d.errors, []); checks++;

    await d.page.locator('#preference-text-size').selectOption('large');
    for (const width of [1365, 390, 320]) {
      await d.page.setViewportSize({ width, height: 950 });
      if(width<900){assert(await d.page.locator('#navigation [data-tab="settings"]').isHidden());await d.page.locator('.desk-nav-more').click();assert(await d.page.locator('#navigation [data-tab="settings"]').isVisible());await d.page.locator('#navigation [data-tab="settings"]').click();assert.equal(await d.page.locator('.desk-nav-more').getAttribute('aria-expanded'),'false');}
      assert(await d.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at ' + width);
      for (const id of ['open-profile', 'preference-start', 'preference-text-size', 'preference-session-view', 'reset-preferences', 'copy-workspace-link']) {
        const box = await d.page.locator('#' + id).boundingBox(); assert(box && box.height >= 43, id + ' retains a touch target at ' + width);
      }
    }
    const contrast = await d.page.evaluate(() => {
      const luminance = value => { const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; };
      const background = luminance(getComputedStyle(document.querySelector('.profile-card')).backgroundColor);
      return ['#profile-role', '.profile-help'].map(selector => { const foreground = luminance(getComputedStyle(document.querySelector(selector)).color); return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05); });
    });
    assert(contrast.every(ratio => ratio >= 4.5), 'Small text on the dark profile card stays readable');
    await d.page.setViewportSize({ width: 1365, height: 950 }); await d.page.evaluate(() => window.scrollTo(0, 0)); fs.mkdirSync('outputs', { recursive: true }); await d.page.screenshot({ path: 'outputs/coach-settings-desktop.png', fullPage: true });
    await d.page.setViewportSize({ width: 390, height: 950 }); await d.page.evaluate(() => window.scrollTo(0, 0)); await d.page.screenshot({ path: 'outputs/coach-settings-mobile.png', fullPage: true }); checks++;
    await d.page.locator('#logout').click(); await d.page.locator('#login').waitFor({ state: 'visible' });
    for (const id of ['profile-name', 'profile-email', 'profile-role', 'profile-scope', 'profile-signin']) assert.equal((await d.page.locator('#' + id).textContent()).trim(), '', id + ' clears on sign-out');
    assert.equal(await d.page.locator('#app').isVisible(), false); assert.deepEqual(d.errors, []); checks++;
    await d.context.close();

    const hash = await fixture({ role: 'coach', stored: JSON.stringify({ start: 'plan', density: 'comfortable', reduceMotion: false }), hash: '#view=settings' });
    assert.equal(await hash.page.locator('#panel-settings').isVisible(), true, 'Explicit profile link overrides saved starting view'); assert.equal(count(hash, '/users') + count(hash, '/audit'), 0); assert.deepEqual(hash.errors, []); checks++;
    await hash.context.close();
    console.log('Coach settings UI: ' + checks + ' grouped role, preference, privacy, draft and responsive checks passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
