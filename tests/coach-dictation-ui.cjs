/* Browser speech recognition is mocked. No microphone, live network or real records. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const addAssets = require('./coach-fixture-fonts.cjs');

(async () => {
  const origin = 'https://attendance.starsoccer.ca';
  const now = '2026-12-31T20:00:00Z';
  const rid = n => 'rec' + String(n).padStart(14, '0');
  const profile = { email: 'dictation-owner@example.test', name: 'Fictional Dictation Owner', role: 'owner' };
  const sessions = [
    { id: rid(1), date: '2026-12-31', time: '4:00 PM', location: 'Fictional field', status: 'Scheduled', capacity: 20, capacityUsed: 1, expected: 1, counts: { yes: 0, no: 0, awaiting: 1, confirmed: 0 }, issues: [], players: [{ playerId: rid(101), attendanceId: rid(201), name: 'Fictional Player', kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] }] },
    { id: rid(2), date: '2027-01-01', time: '4:00 PM', location: 'Other fictional field', status: 'Scheduled', capacity: 20, capacityUsed: 1, expected: 1, counts: { yes: 0, no: 0, awaiting: 1, confirmed: 0 }, issues: [], players: [{ playerId: rid(102), attendanceId: rid(202), name: 'Other Fictional Player', kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] }] },
  ];
  const assets = {};
  for (const [url, file, type] of [
    ['/workspace', 'workspace.html', 'text/html'],
    ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'],
    ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'],
    ['/assets/app.css', 'app.css', 'text/css'],
    ['/assets/logo.svg', 'logo.svg', 'image/svg+xml'],
  ]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
  assets['/workspace/assets/passkeys.js'] = { body: fs.readFileSync('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js', 'utf8'), type: 'text/javascript' };
  addAssets(assets);
  const browser = await chromium.launch();
  let checks = 0;
  const allRequests = [];
  try {
    async function fixture(supported = true) {
      const context = await browser.newContext();
      await context.addInitScript(({ supported, now }) => {
        const RealDate = Date, instant = RealDate.parse(now);
        window.Date = class extends RealDate { constructor(...args) { super(...(args.length ? args : [instant])); } static now() { return instant; } };
        const speech = window.fixtureSpeech = { instances: [], startError: null };
        const eventFor = (segments, resultIndex) => {
          const results = segments.map(segment => {
            const result = [{ transcript: segment.text, confidence: 1 }];
            result.isFinal = segment.final !== false;
            result.item = index => result[index];
            return result;
          });
          results.item = index => results[index];
          return { type: 'result', resultIndex, results };
        };
        class MockRecognition {
          constructor() { this.starts = this.stops = this.aborts = 0; speech.instances.push(this); }
          start() { if (speech.startError) throw new DOMException('Fictional browser failure', speech.startError); this.starts++; queueMicrotask(() => this.onstart?.({ type: 'start' })); }
          stop() { this.stops++; queueMicrotask(() => this.onend?.({ type: 'end' })); }
          abort() { this.aborts++; queueMicrotask(() => this.onend?.({ type: 'end' })); }
        }
        speech.emit = (index, segments, resultIndex = 0) => speech.instances[index]?.onresult?.(eventFor(segments, resultIndex));
        speech.capture = index => { speech.instances[index].capturedResult = speech.instances[index].onresult; };
        speech.emitLate = (index, segments, resultIndex = 0) => speech.instances[index]?.capturedResult?.(eventFor(segments, resultIndex));
        speech.error = (index, error) => speech.instances[index]?.onerror?.({ type: 'error', error });
        speech.end = index => speech.instances[index]?.onend?.({ type: 'end' });
        Object.defineProperty(window, 'SpeechRecognition', { value: supported ? MockRecognition : undefined, configurable: true });
        Object.defineProperty(window, 'webkitSpeechRecognition', { value: supported ? MockRecognition : undefined, configurable: true });
      }, { supported, now });
      let signedIn = true;
      const requests = [];
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        assert.equal(url.origin, origin, 'No live or speech-provider request is permitted in tests');
        const record = { path: url.pathname, method: request.method(), body: request.postData() };
        requests.push(record); allRequests.push(record);
        const asset = assets[url.pathname];
        if (asset) return route.fulfill({ status: 200, contentType: asset.type, body: asset.body });
        let value;
        if (url.pathname.endsWith('/bootstrap')) value = { profile: signedIn ? profile : null, csrfToken: 'fixture-csrf', googleEnabled: true };
        else if (url.pathname.endsWith('/desk')) value = { profile, sessions, notes: [], tasks: [], observedAt: now };
        else if (url.pathname.endsWith('/session') && request.method() === 'POST') value = { plan: { version: 0, content: { focus: JSON.parse(request.postData()).sessionId === rid(1) ? 'Existing focus' : 'Other session focus', warmup: 'Movement and ball work' } } };
        else if (url.pathname.endsWith('/logout') && request.method() === 'POST') { signedIn = false; value = { signedOut: true }; }
        else if (url.pathname.endsWith('/notes/save') && request.method() === 'POST') {
          const payload = JSON.parse(request.postData());
          assert.equal(payload.sessionId, rid(1));
          value = { note: { id: 'fixture-saved-note', ...payload, session_id: payload.sessionId, player_id: payload.playerId, author_email: profile.email, updated_at: now, version: 1 } };
        } else throw Error('Unexpected fixture request: ' + request.method() + ' ' + url.pathname);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(6000);
      await page.goto(origin + '/workspace');
      await page.locator('#app').waitFor({ state: 'visible' });
      await page.locator('#navigation button[data-tab="notes"]').click();
      await page.locator('#dictation-note-body').waitFor({ state: 'visible' });
      return { context, page, requests };
    }

    const { context, page, requests } = await fixture();
    const note = page.locator('#note-body'), noteButton = page.locator('#dictation-note-body'), noteStatus = page.locator('#dictation-status-note-body');
    assert.equal(await page.locator('[data-dictation-label]').count(), 7);
    assert.equal(await page.evaluate(() => fixtureSpeech.instances.length), 0, 'Opening the app must never open the microphone');
    assert.match(await page.locator('#note-dictation-help').innerText(), /browser|speech|audio/i);
    checks++;

    await note.fill('Existing note.');
    await note.evaluate(element => element.setSelectionRange(element.value.length, element.value.length));
    await noteButton.click();
    assert.equal(await noteButton.getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => fixtureSpeech.instances[0].starts), 1);
    await page.evaluate(() => fixtureSpeech.emit(0, [{ text: 'Interim passing words', final: false }]));
    assert.equal(await note.inputValue(), 'Existing note.', 'Interim speech belongs in the preview, not the saved field');
    assert.match(await noteStatus.innerText(), /Interim passing words/);
    checks++;

    await page.evaluate(() => fixtureSpeech.emit(0, [{ text: 'Player improved passing.', final: true }]));
    assert.equal(await note.inputValue(), 'Existing note. Player improved passing.');
    await page.evaluate(() => fixtureSpeech.emit(0, [{ text: 'Player improved passing.', final: true }], 0));
    assert.equal(await note.inputValue(), 'Existing note. Player improved passing.', 'A repeated final result must not duplicate text');
    await page.evaluate(() => fixtureSpeech.emit(0, [{ text: 'Player improved passing.', final: true }, { text: 'Next focus is scanning.', final: true }], 1));
    assert.equal(await note.inputValue(), 'Existing note. Player improved passing. Next focus is scanning.');
    assert.equal(requests.filter(request => request.path.endsWith('/notes/save')).length, 0, 'Dictation must never save automatically');
    assert.equal(await page.locator('#note-state').isVisible(), true);
    checks++;

    await page.evaluate(() => fixtureSpeech.capture(0));
    await noteButton.click();
    const stoppedText = await note.inputValue();
    await page.evaluate(() => fixtureSpeech.emitLate(0, [{ text: 'Late words must not appear.', final: true }], 0));
    assert.equal(await note.inputValue(), stoppedText);
    assert.equal(await noteButton.getAttribute('aria-pressed'), 'false');
    checks++;

    await note.fill('Strong passing today.');
    await note.evaluate(element => element.setSelectionRange(7, 14));
    await noteButton.click();
    await page.evaluate(() => fixtureSpeech.emit(1, [{ text: 'first touch', final: true }]));
    assert.equal(await note.inputValue(), 'Strong first touch today.', 'Dictation should respect the selected text and retain its surroundings');
    await page.evaluate(() => fixtureSpeech.end(1));
    checks++;

    await noteButton.click();
    await page.evaluate(() => fixtureSpeech.error(2, 'not-allowed'));
    assert.match(await noteStatus.innerText(), /permission|allow|blocked|denied/i);
    assert.equal(await noteButton.getAttribute('aria-pressed'), 'false');
    assert.equal(await note.inputValue(), 'Strong first touch today.');
    checks++;

    await noteButton.click();
    await page.evaluate(() => fixtureSpeech.error(3, 'no-speech'));
    assert.match(await noteStatus.innerText(), /no speech|didn.t hear|could not hear|try again/i);
    assert.equal(await note.inputValue(), 'Strong first touch today.');
    checks++;

    await note.fill('1234567890');
    await note.evaluate(element => { element.maxLength = 15; element.setSelectionRange(10, 10); });
    await noteButton.click();
    await page.evaluate(() => fixtureSpeech.emit(4, [{ text: 'more than five words', final: true }]));
    assert((await note.inputValue()).length <= 15, 'Dictation must respect the existing text limit');
    await page.evaluate(() => { fixtureSpeech.end(4); document.querySelector('#note-body').maxLength = 6000; });
    checks++;

    await note.fill('Manual text to preserve.');
    await noteButton.click();
    await page.evaluate(() => { fixtureSpeech.capture(5); document.dispatchEvent(new CustomEvent('coach:dictation-stop')); });
    await page.evaluate(() => fixtureSpeech.emitLate(5, [{ text: 'Cancelled speech.', final: true }]));
    assert.equal(await note.inputValue(), 'Manual text to preserve.');
    assert.equal(await noteButton.getAttribute('aria-pressed'), 'false');
    checks++;

    // Planner voice controls are field-specific and one microphone session may be active at a time.
    await page.locator('#navigation button[data-tab="plan"]').click();
    await page.waitForFunction(() => !document.querySelector('#plan-focus').disabled);
    const focusButton = page.locator('#dictation-plan-focus'), warmupButton = page.locator('#dictation-plan-warmup');
    await focusButton.click();
    await page.evaluate(() => fixtureSpeech.capture(6));
    await warmupButton.click();
    assert.equal(await focusButton.getAttribute('aria-pressed'), 'false');
    assert.equal(await warmupButton.getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => fixtureSpeech.emitLate(6, [{ text: 'Wrong field late speech.', final: true }]));
    assert.equal(await page.locator('#plan-focus').inputValue(), 'Existing focus');
    await page.evaluate(() => fixtureSpeech.emit(7, [{ text: 'Ball mastery.', final: true }]));
    assert.match(await page.locator('#plan-warmup').inputValue(), /Ball mastery\./);
    assert.equal(await page.locator('#plan-state').isVisible(), true);
    checks++;

    await page.evaluate(() => fixtureSpeech.capture(7));
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#session').selectOption(rid(2));
    await page.waitForFunction(() => !document.querySelector('#plan-focus').disabled && document.querySelector('#plan-focus').value === 'Other session focus');
    await page.evaluate(() => fixtureSpeech.emitLate(7, [{ text: 'Previous session speech.', final: true }]));
    assert.equal(await page.locator('#plan-focus').inputValue(), 'Other session focus');
    assert.equal(await page.locator('#plan-warmup').inputValue(), 'Movement and ball work');
    checks++;

    await focusButton.click();
    await page.evaluate(() => fixtureSpeech.capture(8));
    await page.locator('#navigation button[data-tab="notes"]').click();
    await page.evaluate(() => fixtureSpeech.emitLate(8, [{ text: 'Speech after tab switch.', final: true }]));
    assert.equal(await page.locator('#plan-focus').inputValue(), 'Other session focus');
    assert.equal(await focusButton.getAttribute('aria-pressed'), 'false');
    checks++;

    // Return to the original fictional date for one intentional mocked note save.
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#session').selectOption(rid(1));
    await note.fill('Review this dictated note before saving.');
    await noteButton.click();
    await page.evaluate(() => fixtureSpeech.capture(9));
    await page.getByRole('button', { name: 'Save private note', exact: true }).click();
    await page.getByText('Private coaching note saved.', { exact: true }).waitFor();
    await page.evaluate(() => fixtureSpeech.emitLate(9, [{ text: 'Speech after saving.', final: true }]));
    assert.equal(await note.inputValue(), '');
    assert.equal(requests.filter(request => request.path.endsWith('/notes/save')).length, 1);
    checks++;

    await page.setViewportSize({ width: 320, height: 740 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    assert((await noteButton.boundingBox()).height >= 44);
    checks++;

    await noteButton.click();
    await page.evaluate(() => fixtureSpeech.capture(10));
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await page.locator('#login').waitFor({ state: 'visible' });
    await page.evaluate(() => fixtureSpeech.emitLate(10, [{ text: 'Private speech after logout.', final: true }]));
    assert.equal(await note.inputValue(), '');
    assert.equal(await noteButton.getAttribute('aria-pressed'), 'false');
    checks++;
    await context.close();

    const unsupported = await fixture(false);
    assert.equal(await unsupported.page.locator('#dictation-note-body').isEnabled(), false);
    assert.match(await unsupported.page.locator('#note-dictation-help').innerText(), /not available|unavailable|not supported|voice typing/i);
    assert.equal(await unsupported.page.evaluate(() => fixtureSpeech.instances.length), 0);
    assert.equal(unsupported.requests.filter(request => request.path.endsWith('/notes/save')).length, 0);
    checks++;
    await unsupported.context.close();
    assert.deepEqual(allRequests.filter(request => request.method === 'POST').map(request => request.path).filter(path => !['/workspace/api/session', '/workspace/api/logout', '/workspace/api/notes/save'].includes(path)), []);
    assert.equal(sessions[0].players[0].actualAttendance, 'Not marked');
    checks++;
    console.log('Coach dictation UI: ' + checks + ' isolated recognition, transcript, privacy, cancellation, save-boundary and mobile checks passed. No real microphone or live records used.');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
