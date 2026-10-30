/* Player note folders and group-scoped recommendations. Fictional context; no API or business writes. */
const assert = require('node:assert/strict'), fs = require('node:fs'), { chromium } = require('playwright');
const origin = 'https://coach.example.test';
const profile = { email: 'fictional-coach@example.test', role: 'coach', sessionVersion: 1 };
const sam = { playerId: 'player-sam', name: 'Fictional Sam' }, lee = { playerId: 'player-lee', name: 'Fictional Lee' }, morgan = { playerId: 'player-morgan', name: 'Unrelated Morgan' };
const current = { id: 'current', date: '2026-11-04', time: '4:00–5:00 PM', location: 'Fictional Park', players: [sam] };
const past = { id: 'past', date: '2026-10-28', time: current.time, location: current.location, players: [sam, lee] };
const other = { id: 'other', date: current.date, time: current.time, location: current.location, players: [sam, morgan] };
const note = (id, session_id, player_id, body) => ({ id, session_id, player_id, body, category: 'General', author_email: profile.email });
const notes = [note('g1', 'current', null, 'Passing group practice PRIVATE_GROUP'), note('g2', 'past', null, 'More passing'), note('g3', 'other', null, 'Finishing PRIVATE_OTHER_GROUP'), note('s1', 'current', sam.playerId, 'Scanning PRIVATE_SAM'), note('s2', 'past', sam.playerId, 'Early scanning'), note('s3', 'other', sam.playerId, 'Finishing PRIVATE_SAM_OTHER_GROUP'), note('l1', 'past', lee.playerId, 'Defending PRIVATE_LEE'), note('m1', 'other', morgan.playerId, 'Ball control PRIVATE_MORGAN')];
const initial = { profile, session: current, sessions: [current, past, other], groupSessions: [current, past], notes, noteFolder: '', workspaceView: 'notes', tab: 'plan', busy: false, planReady: true, plan: { content: {} } };

(async () => {
  const browser = await chromium.launch(); let checks = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 } });
    await context.addInitScript(value => {
      window.fixtureContext = value; window.fixtureRequests = []; window.fixturePending = []; window.fixtureAllow = true; window.fixtureDelay = false;
      window.fixturePublish = next => { fixtureContext = next; window.dispatchEvent(new CustomEvent('coach:context', { detail: next })); };
      window.addEventListener('coach:request-context', () => fixturePublish(fixtureContext));
      window.addEventListener('coach:note-folder', event => {
        const { playerId, resolve } = event.detail; fixtureRequests.push(playerId);
        const finish = allowed => { if (allowed && fixtureContext) fixturePublish({ ...fixtureContext, noteFolder: playerId }); resolve(allowed); };
        if (fixtureDelay) fixturePending.push(finish); else finish(fixtureAllow);
      });
      window.addEventListener('coach:library-request', event => { if (event.detail.operation === 'list') event.detail.resolve({ drills: [] }); else throw Error('No writes allowed'); });
      window.fixtureInsertions = []; window.addEventListener('coach:insert-plan', event => fixtureInsertions.push(event.detail));
    }, initial);
    const errors = [], requests = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url()); requests.push(url.pathname);
      if (url.origin !== origin) { errors.push('External request'); return route.abort(); }
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/folders.css"><link rel="stylesheet" href="/library.css"><style>body{margin:20px;font-family:Arial,sans-serif}button,input,textarea,select{box-sizing:border-box}button{font:inherit}</style><script defer src="/folders.js"></script><script defer src="/library.js"></script></head><body><section id="player-note-folders"></section><section id="coach-drill-library"></section></body></html>' });
      const files = { '/folders.js': ['workspace-folders.js', 'text/javascript'], '/folders.css': ['workspace-folders.css', 'text/css'], '/library.js': ['workspace-library.js', 'text/javascript'], '/library.css': ['workspace-library.css', 'text/css'] };
      if (files[url.pathname]) return route.fulfill({ contentType: files[url.pathname][1], body: fs.readFileSync('private-attendance/web/' + files[url.pathname][0], 'utf8') });
      errors.push('Unexpected request ' + url.pathname); return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message)); await page.goto(origin);
    const folders = page.locator('#note-folders-list'), card = id => folders.locator('[data-player-folder="' + id + '"]');
    assert.equal(await folders.locator('button').count(), 3, 'One group folder plus distinct players across group dates');
    assert.match(await card('').innerText(), /2 notes/); assert.match(await card(sam.playerId).innerText(), /2 notes/); assert.match(await card(lee.playerId).innerText(), /1 note/);
    assert.doesNotMatch(await folders.innerText(), /Morgan|PRIVATE_/); assert.equal(await card('').getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => fixtureRequests.length), 0, 'Rendering does not select or mutate a folder'); checks++;

    await page.evaluate(() => { fixtureAllow = false; }); await card(sam.playerId).click();
    assert.equal(await card('').getAttribute('aria-pressed'), 'true'); assert.equal(await card(sam.playerId).getAttribute('aria-pressed'), 'false');
    assert.match(await page.locator('#note-folders-status').innerText(), /Kept the current folder/);
    await page.evaluate(() => { fixtureAllow = true; fixtureDelay = true; }); await card(sam.playerId).click();
    assert.equal(await card(lee.playerId).isEnabled(), false);
    await page.evaluate(() => document.querySelector('[data-player-folder="player-lee"]').click());
    assert.deepEqual(await page.evaluate(() => fixtureRequests), [sam.playerId, sam.playerId], 'Pending folder change cannot request a second selection');
    await page.evaluate(() => fixturePending.shift()(true)); await page.waitForFunction(() => document.querySelector('[data-player-folder="player-sam"]').getAttribute('aria-pressed') === 'true');
    assert.match(await page.locator('#note-folder-selected').innerText(), /Fictional Sam’s notes/); checks++;

    await page.evaluate(() => { fixtureDelay = false; }); await card(lee.playerId).click();
    assert.equal(await card(lee.playerId).getAttribute('aria-pressed'), 'true'); assert.match(await page.locator('#note-folder-selected').innerText(), /not on this date’s roster.*Choose a date/);
    assert.match(await card(lee.playerId).innerText(), /Previous group player/);
    await page.locator('#note-folders-search').fill('Lee'); assert.equal(await folders.locator('button').count(), 1);
    await page.locator('#note-folders-search').fill('Morgan'); assert.equal(await folders.locator('button').count(), 0, 'Search cannot expose another group’s player');
    await page.locator('#note-folders-search').fill(''); checks++;

    await page.evaluate(() => { window.fixtureCard = document.querySelector('[data-player-folder="player-lee"]'); fixturePublish({ ...fixtureContext }); });
    assert.equal(await page.evaluate(() => fixtureCard === document.querySelector('[data-player-folder="player-lee"]')), true, 'Stable context preserves keyboard focus and card nodes');
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    for (const box of await folders.locator('button').evaluateAll(elements => elements.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })))) assert(box.width >= 44 && box.height >= 44);
    await card(sam.playerId).focus(); await page.keyboard.press('Enter'); assert.equal(await card(sam.playerId).getAttribute('aria-pressed'), 'true'); checks++;

    const recommendations = page.locator('#library-recommendations');
    assert.deepEqual(errors, []);
    await page.locator('#library-disclosure > summary').click();
    assert.match(await recommendations.innerText(), /Passing keyword match in 2 accessible notes/);
    assert.doesNotMatch(await recommendations.innerText(), /Finishing|PRIVATE_/);
    await page.locator('#library-note-scope').selectOption(sam.playerId);
    assert.match(await recommendations.innerText(), /Scanning keyword match in 2 accessible notes/);
    assert.doesNotMatch(await recommendations.innerText(), /Finishing|PRIVATE_/);
    assert.equal(await page.locator('#library-note-scope option').count(), 3, 'Library can review current and previous group players');
    await recommendations.getByRole('button', { name: /Add suggestion/ }).click();
    const inserted = await page.evaluate(() => fixtureInsertions); assert.equal(inserted.length, 1); assert.doesNotMatch(inserted[0].text, /PRIVATE_|Fictional|keyword/); checks++;

    await page.evaluate(() => { fixtureDelay = true; }); await card(lee.playerId).click();
    await page.locator('#note-folders-search').evaluate(el => { el.value = 'old query'; });
    await page.evaluate(other => fixturePublish({ ...fixtureContext, session: other, groupSessions: [other], noteFolder: '' }), other);
    assert.equal(await page.locator('#note-folders-search').inputValue(), ''); assert.match(await folders.innerText(), /Morgan/); assert.doesNotMatch(await folders.innerText(), /Lee/);
    // A stale response resolves without publishing a new root context; it must not change this group.
    await page.evaluate(() => fixturePending.shift()(false));
    assert.equal(await card('').getAttribute('aria-pressed'), 'true'); assert.equal(await page.locator('#note-folders-status').innerText(), ''); checks++;

    await page.evaluate(() => fixturePublish({ ...fixtureContext, groupSessions: undefined }));
    assert.equal(await page.locator('#player-note-folders').isVisible(), false, 'Missing group scope never falls back to all sessions');
    await page.evaluate(() => fixturePublish(null));
    assert.equal(await folders.textContent(), ''); assert.equal(await page.locator('#note-folders-search').inputValue(), ''); assert.equal(await page.locator('#note-folder-selected').textContent(), '');
    assert.equal(await recommendations.textContent(), ''); assert.equal(await page.evaluate(() => localStorage.length), 0);
    assert(requests.every(path => ['/', '/folders.js', '/folders.css', '/library.js', '/library.css'].includes(path))); assert.deepEqual(errors, []); checks++;
    await context.close(); console.log('Coach player folders: ' + checks + ' grouped scope, counts, guarded selection, recommendation, privacy and mobile checks passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
