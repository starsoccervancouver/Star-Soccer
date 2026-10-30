/* All browser data and assets are synthetic/local; no live account is used. */
const assert = require('node:assert/strict'), fs = require('node:fs'), { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const assets = Object.fromEntries(['workspace-blocks.js', 'workspace-blocks.css', 'workspace-session.js', 'workspace-session.css', 'workspace.css'].map(name => ['/' + name, fs.readFileSync('private-attendance/web/' + name, 'utf8')]));
    await page.route('**/*', route => { const path = new URL(route.request().url()).pathname; if (path.endsWith('.woff2')) return route.fulfill({ status: 404, body: '' }); assert(path in assets, 'Only fixture assets may be requested: ' + path); return route.fulfill({ contentType: path.endsWith('.js') ? 'application/javascript' : 'text/css', body: assets[path] }); });
    await page.setContent('<html><head><link rel="stylesheet" href="https://fixture.test/workspace.css"><link rel="stylesheet" href="https://fixture.test/workspace-blocks.css"><link rel="stylesheet" href="https://fixture.test/workspace-session.css"></head><body><form id="plan-form"><label>Focus<textarea id="plan-focus"></textarea></label><section id="plan-activities"></section><label>Warm-up<textarea id="plan-warmup"></textarea></label><label>Technical<textarea id="plan-technical"></textarea></label><label>Game<textarea id="plan-game"></textarea></label><button type="submit">Save shared plan</button></form><details id="session-field-disclosure" open><summary>Run session</summary><section id="session-field-tools"></section></details></body></html>');
    await page.addScriptTag({ url: 'https://fixture.test/workspace-blocks.js' }); await page.addScriptTag({ url: 'https://fixture.test/workspace-session.js' });
    await page.evaluate(() => {
      window.fixture = { profile: { email: 'fixture@example.test', role: 'coach' }, session: { id: 'fixture-session', time: '4–5 PM', date: '2026-10-30', status: 'Scheduled', players: [] }, selected: 'fixture-session', tab: 'plan', planReady: true, busy: false, plan: { version: 1, content: { focus: 'Saved focus', warmup: 'Legacy unchanged', technical: '', game: '' } } };
      window.saves = 0;
      window.publish = () => window.dispatchEvent(new CustomEvent('coach:context', { detail: { ...fixture, planDirty: CoachPlanBlocks.isDirty() } }));
      CoachPlanBlocks.load(fixture.plan.content, fixture.session); publish();
      window.addEventListener('coach:blocks-changed', publish);
      document.querySelector('#plan-form').addEventListener('submit', event => { event.preventDefault(); if (CoachPlanBlocks.validate()) return; const content = { ...fixture.plan.content }; const blocks = CoachPlanBlocks.content(); if (blocks !== undefined) content.activities = blocks; fixture.plan = { version: fixture.plan.version + 1, content }; saves++; CoachPlanBlocks.load(content, fixture.session); publish(); });
      window.print = () => { window.printed = document.querySelector('#session-print-sheet').textContent; };
    });
    assert.equal(await page.evaluate(() => CoachPlanBlocks.content()), undefined, 'Loading a legacy plan never converts it');
    await page.getByRole('button', { name: 'First-touch starter', exact: true }).click();
    assert.equal(await page.locator('.plan-block').count(), 4); assert.equal(await page.evaluate(() => saves), 0, 'Starters only edit the shared draft');
    assert.match(await page.locator('.plan-block-budget').innerText(), /55 minutes planned.*60-minute/);
    await page.locator('#plan-block-0-title').fill('Receive <script>not HTML</script>');
    await page.locator('#plan-block-0-duration').fill('30');
    assert.match(await page.locator('.plan-block-budget').innerText(), /15 minutes over/);
    await page.getByRole('button', { name: 'Move down activity 1', exact: true }).focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#plan-block-1-title').inputValue(), 'Receive <script>not HTML</script>');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'plan-block-1-title', 'Keyboard reorder keeps focus on the moved activity');
    await page.getByRole('button', { name: 'Open field view', exact: true }).click();
    assert.equal(await page.locator('#field-timer-output').innerText(), '10:00', 'Unsaved blocks do not replace the saved field plan');
    assert.match(await page.locator('#field-dialog-unsaved-warning').innerText(), /not saved/); await page.getByRole('button', { name: 'Close field view' }).click();
    await page.getByRole('button', { name: 'Save shared plan', exact: true }).click();
    assert.equal(await page.evaluate(() => fixture.plan.content.warmup), 'Legacy unchanged'); assert.equal(await page.evaluate(() => saves), 1); assert.equal(await page.evaluate(() => CoachPlanBlocks.isDirty()), false);
    await page.getByRole('button', { name: 'Open field view', exact: true }).click(); assert.equal(await page.locator('#field-timer-output').innerText(), '20:00');
    await page.locator('#field-stage-activity-1').click(); assert.equal(await page.locator('#field-timer-output').innerText(), '30:00');
    assert.equal(await page.locator('#session-field-view script').count(), 0);
    await page.getByRole('button', { name: 'Print session sheet', exact: true }).last().click();
    const printed = await page.evaluate(() => printed); assert.match(printed, /75 minutes planned.*60-minute/); assert.match(printed, /30 min/); assert.match(printed, /supporting notesLegacy unchanged/);
    await page.getByRole('button', { name: 'Close field view' }).click();
    await page.locator('#plan-block-0-duration').fill('0'); assert.match(await page.evaluate(() => CoachPlanBlocks.validate()), /1 to 120/); await page.evaluate(() => CoachPlanBlocks.discard());
    page.on('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Remove activity 1', exact: true }).click(); assert.equal(await page.locator('.plan-block').count(), 3);
    await page.evaluate(() => { fixture.busy = true; publish(); }); assert.equal(await page.locator('#plan-block-0-stage').isDisabled(), true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('coach:context', { detail: null }))); assert.equal(await page.locator('.plan-block').count(), 0);
    assert.equal(await page.evaluate(() => CoachPlanBlocks.content()), undefined);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Editor fits a phone screen');
    console.log('PASS: structured plan draft, keyboard ordering, explicit save, saved field timers/print, legacy retention and sign-out cleanup');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
