/* Notes drawer browsing and dictation lifecycle. Fictional records and mocked speech only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const rid = n => 'rec' + String(n).padStart(14, '0');
const profile = { email: 'notes-owner@example.test', name: 'Fictional Notes Owner', role: 'owner', sessionVersion: 1 };
const player = (n, name) => ({ playerId: rid(n), attendanceId: rid(n + 500), name, kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] });
const sam = player(101, 'Fictional Sam'), lee = player(102, 'Fictional Lee'), other = player(103, 'Fictional Morgan');
const session = (n, date, time = '4:00–5:00 PM', location = 'Fictional West Field', players = [sam, lee]) => ({ id: rid(n), date, time, location, players, status: 'Scheduled', capacity: 20, capacityUsed: players.length, expected: players.length, counts: { yes: 0, no: 0, awaiting: players.length, confirmed: 0 }, issues: [] });
const sessions = [session(1, '2026-10-29'), session(2, '2026-10-22'), session(3, '2026-10-28'), session(4, '2026-10-22', '6:00–7:00 PM'), session(5, '2026-10-22', '4:00–5:00 PM', 'Fictional East Field', [other])];
const note = (n, sessionId, playerId, body) => ({ id: 'fictional-note-' + n, session_id: sessionId, player_id: playerId, body, category: 'General', author_email: profile.email, updated_at: new Date(Date.parse(now) - n * 60000).toISOString(), created_at: now, version: 1 });
const notes = [
  ...Array.from({ length: 12 }, (_, i) => note(i + 1, rid(i % 2 ? 2 : 1), null, 'Group observation ' + (i + 1) + (i === 11 ? ': targeted passing' : ': scanning'))),
  note(20, rid(3), null, 'Unrelated weekday group'), note(21, rid(4), null, 'Unrelated time group'), note(22, rid(5), null, 'Unrelated venue group'),
  note(30, rid(1), sam.playerId, 'Sam current first touch'), note(31, rid(3), sam.playerId, 'Sam earlier passing'),
  note(32, rid(1), lee.playerId, 'Lee private confidence'), note(33, rid(5), other.playerId, 'Morgan unrelated player'),
];
const assets = {};
for (const [url, file, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);

(async () => {
  const browser = await chromium.launch(); let checks = 0;
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 } });
    await context.addInitScript(({ now }) => {
      const RealDate = Date;
      window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return RealDate.parse(now); } };
      window.fixtureAnswers = []; window.fixturePrompts = [];
      window.confirm = message => { fixturePrompts.push(message); return fixtureAnswers.shift() === true; };
      const speech = window.fixtureSpeech = { instances: [] };
      const result = text => { const entry = [{ transcript: text, confidence: 1 }]; entry.isFinal = true; return { type: 'result', resultIndex: 0, results: [entry] }; };
      class MockRecognition {
        constructor() { this.starts = this.stops = this.aborts = 0; speech.instances.push(this); }
        start() { this.starts++; queueMicrotask(() => this.onstart?.({ type: 'start' })); }
        stop() { this.stops++; queueMicrotask(() => this.onend?.({ type: 'end' })); }
        abort() { this.aborts++; queueMicrotask(() => this.onend?.({ type: 'end' })); }
      }
      speech.emit = (index, text) => speech.instances[index]?.onresult?.(result(text));
      speech.capture = index => { speech.instances[index].capturedResult = speech.instances[index].onresult; };
      speech.emitLate = (index, text) => speech.instances[index]?.capturedResult?.(result(text));
      Object.defineProperty(window, 'SpeechRecognition', { value: MockRecognition, configurable: true });
      Object.defineProperty(window, 'webkitSpeechRecognition', { value: MockRecognition, configurable: true });
    }, { now });
    const requests = [], errors = []; let signedIn = true;
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      if (url.origin !== origin) { errors.push('Unexpected outside network: ' + url.origin); return route.abort(); }
      if (assets[path]) return route.fulfill({ status: 200, contentType: assets[path].type, body: assets[path].body });
      const payload = request.postData() ? request.postDataJSON() : undefined;
      requests.push({ path, payload, method: request.method() });
      let value, status = 200;
      if (path.endsWith('/bootstrap')) value = { profile: signedIn ? profile : null, csrfToken: 'fictional-notes-csrf', googleEnabled: true };
      else if (path.endsWith('/desk')) value = { profile, sessions, notes, tasks: [], observedAt: now };
      else if (path.endsWith('/session')) value = { plan: { session_id: payload.sessionId, version: 0, content: {} } };
      else if (path.endsWith('/diagrams/list')) value = { diagrams: [] };
      else if (path.endsWith('/logout')) { signedIn = false; value = { signedOut: true }; }
      else { errors.push('Unexpected fixture action: ' + request.method() + ' ' + path); status = 403; value = { error: 'UNEXPECTED_FIXTURE' }; }
      return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.stack || error.message));
    await page.goto(origin + '/workspace');
    await page.locator('#app').waitFor({ state: 'visible' });
    await page.locator('#navigation [data-tab="plan"]').click();
    await page.waitForFunction(() => !document.getElementById('plan-focus').disabled);
    await page.locator('#planner-open-notes').click();
    const list = page.locator('#planner-notes-list'), field = page.locator('#planner-note-body'), dictate = page.locator('#dictation-planner-note-body');
    const cards = list.locator('.planner-note-card'), search = page.locator('#planner-notes-search');
    assert.equal(await page.locator('#planner-notes-pane').isVisible(), true);
    assert(await page.evaluate(() => Boolean(document.getElementById('planner-note-form').compareDocumentPosition(document.querySelector('.planner-note-history')) & Node.DOCUMENT_POSITION_FOLLOWING)), 'Compose appears before the history, even for a large folder');
    assert.equal(await cards.count(), 10);
    assert.match(await page.locator('#planner-notes-results').innerText(), /10 of 12/);
    assert.equal(await page.locator('#planner-notes-more').isVisible(), true);
    assert.equal(await page.evaluate(() => fixtureSpeech.instances.length), 0, 'Opening notes cannot start a microphone');
    assert.equal(await dictate.isEnabled(), true); checks++;

    await page.locator('#planner-notes-more').click();
    assert.equal(await cards.count(), 12);
    assert.match(await page.locator('#planner-notes-results').innerText(), /12 of 12/);
    assert.equal(await page.locator('#planner-notes-more').isVisible(), false);
    assert(!/Unrelated|Sam|Lee|Morgan/.test(await list.innerText()), 'Group history excludes other days, times, venues and individual notes');
    await search.fill('targeted passing');
    assert.equal(await cards.count(), 1); assert.match(await list.innerText(), /Group observation 12/);
    await search.fill('not in any note'); assert.equal(await cards.count(), 0); assert.match(await list.innerText(), /No notes match/);
    await search.fill(''); assert.equal(await cards.count(), 10, 'Changing the search resets the history limit'); checks++;

    await page.locator('#planner-notes-player').selectOption(sam.playerId);
    assert.equal(await cards.count(), 2); assert.match(await list.innerText(), /Sam current first touch/); assert.match(await list.innerText(), /Sam earlier passing/);
    assert(!/Group observation|Lee|Morgan/.test(await list.innerText()), 'A player folder excludes every other player and group note');
    const options = await page.locator('#planner-notes-player').innerText();
    assert(options.includes(sam.name) && options.includes(lee.name) && !options.includes(other.name), 'Only roster players have a selectable folder');
    await search.fill('group observation'); assert.equal(await cards.count(), 0, 'Search cannot escape the selected player scope');
    await search.fill(''); checks++;

    await dictate.click();
    assert.equal(await dictate.getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => { fixtureSpeech.capture(0); fixtureSpeech.emit(0, 'Sam needs more first-touch practice.'); });
    assert.equal(await field.inputValue(), 'Sam needs more first-touch practice.');
    await page.evaluate(() => fixtureAnswers.push(true));
    await page.locator('#planner-notes-player').selectOption(lee.playerId);
    assert.equal(await field.inputValue(), '');
    assert.equal(await dictate.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.evaluate(() => fixtureSpeech.instances[0].aborts), 1);
    await page.evaluate(() => fixtureSpeech.emitLate(0, 'Stale Sam words must not enter Lee notes.'));
    assert.equal(await field.inputValue(), '', 'Late recognition cannot cross a player folder boundary');
    assert.match(await list.innerText(), /Lee private confidence/); checks++;

    await field.fill('Keep this unsaved Lee note.'); await dictate.click();
    await page.evaluate(() => fixtureSpeech.capture(1));
    await page.locator('#planner-notes-player').selectOption(sam.playerId);
    assert.equal(await page.locator('#planner-notes-player').inputValue(), lee.playerId, 'Declining the discard prompt restores the previous folder');
    assert.equal(await field.inputValue(), 'Keep this unsaved Lee note.');
    assert.equal(await page.evaluate(() => fixtureSpeech.instances[1].aborts), 1);
    await page.evaluate(() => fixtureSpeech.emitLate(1, 'Late words after cancelled folder change.'));
    assert.equal(await field.inputValue(), 'Keep this unsaved Lee note.'); checks++;

    await field.fill(''); await dictate.click();
    await page.evaluate(() => fixtureSpeech.capture(2));
    await page.locator('#planner-close-drawer').click();
    assert.equal(await page.locator('#planner-drawer').isVisible(), false);
    assert.equal(await page.evaluate(() => fixtureSpeech.instances[2].aborts), 1);
    await page.evaluate(() => { fixtureSpeech.emitLate(2, 'Closed drawer late words.'); document.getElementById('dictation-planner-note-body').click(); });
    assert.equal(await page.evaluate(() => fixtureSpeech.instances.length), 3, 'A closed drawer cannot start dictation');
    assert.equal(await field.inputValue(), '');
    await page.locator('#planner-open-tools').click();
    assert.equal(await page.locator('#planner-notes-pane').isVisible(), false);
    await page.evaluate(() => document.getElementById('dictation-planner-note-body').click());
    assert.equal(await page.evaluate(() => fixtureSpeech.instances.length), 3, 'A hidden notes pane cannot start dictation');
    await page.locator('#planner-close-drawer').click(); checks++;

    await page.locator('#planner-open-notes').click();
    await page.locator('#planner-notes-player').selectOption('');
    await search.fill('scanning'); await page.locator('#planner-notes-more').click();
    assert.equal(await cards.count(), 11);
    await page.locator('#planner-close-drawer').click();
    await page.locator('#logout').click(); await page.locator('#login').waitFor({ state: 'visible' });
    assert.equal(await search.inputValue(), ''); assert.equal(await list.textContent(), '');
    assert.equal(await page.locator('#planner-notes-player option').count(), 0);
    assert.equal(await page.locator('#planner-notes-results').textContent(), '');
    assert.equal(await page.locator('#planner-notes-more').isVisible(), false);
    assert.equal(await field.inputValue(), '');
    assert.equal(await page.locator('#planner-drawer').isVisible(), false);
    assert.equal(requests.filter(r => /\/(notes|plans|tasks)\/save$/.test(r.path)).length, 0, 'Browsing, dictation and logout never persist a note automatically');
    assert.deepEqual(errors, []); checks++;
    await context.close();
    console.log('Coach notes drawer: ' + checks + ' grouped browsing, scope, dictation and privacy checks passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
