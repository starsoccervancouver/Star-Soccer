/* Lost note responses use fictional, in-memory records and intercepted requests only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { openSession, leaveGroup } = require('./coach-fixture-navigation.cjs');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const rid = n => 'rec' + String(n).padStart(14, '0');
const profile = { email: 'fixture-note-recovery@example.test', name: 'Fictional Coach', role: 'coach' };
const sessions = [{ id: rid(1), programId: rid(900), date: '2026-10-29', time: '4:00–5:00 PM', location: 'Fictional field', status: 'Scheduled', players: [], capacity: 20, capacityUsed: 0, expected: 0, counts: { yes: 0, no: 0, awaiting: 0, confirmed: 0 }, issues: [] }];
const assets = {};
for (const [url, name, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + name, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);

(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext(), notes = [], requests = [], errors = [];
    let mode = 'lost', readbackFails = false, nextId = 1;
    await context.addInitScript(now => {
      const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } };
      window.fixtureAnswers = []; window.fixturePrompts = [];
      window.confirm = text => { fixturePrompts.push(text); return fixtureAnswers.shift() === true; };
    }, now);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      assert.equal(url.origin, origin, 'No live network permitted');
      const asset = assets[url.pathname]; if (asset) return route.fulfill({ contentType: asset.type, body: asset.body });
      const payload = request.postData() ? request.postDataJSON() : undefined;
      requests.push({ path: url.pathname, payload });
      let value;
      if (url.pathname.endsWith('/bootstrap')) value = { profile, csrfToken: 'fictional-csrf', googleEnabled: true };
      else if (url.pathname.endsWith('/desk')) {
        if (readbackFails) return route.abort();
        value = { profile, sessions, notes, tasks: [], observedAt: now };
      } else if (url.pathname.endsWith('/refresh')) value = { refreshed: true };
      else if (url.pathname.endsWith('/session')) value = { plan: { version: 0, content: {} } };
      else if (url.pathname.endsWith('/notes/save')) {
        if (mode === 'rejected') return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'NOTE_CHANGED', message: 'The note changed. Reload it before saving.' }) });
        const previous = notes.find(note => note.id === payload.id);
        const note = { id: previous?.id || 'fictional-note-' + nextId++, session_id: payload.sessionId, player_id: payload.playerId, author_email: previous?.author_email || profile.email, category: payload.category, body: payload.body.trim(), review_date: payload.reviewDate, goal: payload.goal, version: payload.expectedVersion + 1, created_at: previous?.created_at || now, updated_at: now };
        if (previous) notes.splice(notes.indexOf(previous), 1, note); else notes.push(note);
        if (mode === 'lost') return route.abort();
        value = { note };
      } else throw Error('Unexpected request: ' + url.pathname);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
    });
    const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/workspace'); await page.locator('#app').waitFor({ state: 'visible' });
    await openSession(page, sessions, rid(1), 'notes');
    const save = page.locator('#note-form button[type="submit"]'), body = page.locator('#note-body');
    const writes = () => requests.filter(request => request.path.endsWith('/notes/save')).length;
    await body.fill('  Fictional observation with trimmed edges  '); await save.click();
    await page.locator('#note-list').getByText('Fictional observation with trimmed edges', { exact: true }).waitFor();
    assert.equal(await body.inputValue(), '', 'A verified lost response clears the stored draft');
    assert.equal(writes(), 1, 'Recovery reads the note and never repeats the write');
    assert.equal(notes.length, 1);

    await page.locator('#note-list').getByRole('button', { name: 'Edit', exact: true }).click();
    await body.fill('Updated fictional observation'); await save.click();
    await page.locator('#note-list').getByText('Updated fictional observation', { exact: true }).waitFor();
    assert.equal(await body.inputValue(), ''); assert.equal(notes[0].version, 2); assert.equal(writes(), 2);

    readbackFails = true;
    await body.fill('Fictional save requiring manual review'); await save.click();
    await page.locator('#global-error').getByText(/could not be verified/).waitFor();
    assert.equal(await body.inputValue(), 'Fictional save requiring manual review');
    assert.equal(await save.isDisabled(), true, 'An unverified create cannot be retried as a duplicate');
    assert.equal(await page.locator('#note-cancel').isVisible(), true, 'A new uncertain draft can be cleared after review');
    await leaveGroup(page);
    assert.equal(await body.inputValue(), 'Fictional save requiring manual review', 'Declining navigation preserves the uncertain draft');
    assert.equal(writes(), 3); assert.equal(notes.length, 2);

    readbackFails = false;
    await page.evaluate(() => fixtureAnswers.push(true)); await page.locator('#note-cancel').click();
    await leaveGroup(page); await page.locator('#refresh').click();
    await page.waitForFunction(() => !document.getElementById('refresh').disabled);
    await openSession(page, sessions, rid(1), 'notes');
    assert.equal(await page.locator('#note-list .note-card').count(), 2, 'Refresh reveals the original successful save');
    mode = 'rejected';
    await body.fill('Fictional rejected draft'); await save.click();
    await page.locator('#global-error').getByText(/note changed/).waitFor();
    assert.equal(await body.inputValue(), 'Fictional rejected draft'); assert.equal(await save.isDisabled(), false, 'A definite rejection keeps an editable draft');
    assert.equal(notes.length, 2); assert.equal(writes(), 4); assert.deepEqual(errors, []);
    await context.close();
    console.log('Note save recovery: lost create/edit responses, exact readback, no duplicate retry, uncertain draft guard, refresh and definite rejection passed. Mock transport only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
