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
      window.diagramFixture = { schemaVersion: 1, pitch: 'facing-goal', items: [{ id: 'player_1', kind: 'home', label: '1', color: 'purple' }, {id:'goal_1',kind:'goal',label:''}], frames: [{ id: 'start', title: 'Starting positions', duration: 3, positions: [{ id: 'player_1', x: 25, y: 50 },{id:'goal_1',x:90,y:50,rotation:90}], arrows: [{ id: 'arrow_1', x1: 25, y1: 50, x2: 65, y2: 50, color: 'charcoal' }] }] };
      window.currentTactics = { sessionId: fixture.session.id, title: 'Current setup', diagram: structuredClone(diagramFixture) };
      window.CoachTactics = { getDraft: () => currentTactics };
      window.publish = () => window.dispatchEvent(new CustomEvent('coach:context', { detail: { ...fixture, planDirty: CoachPlanBlocks.isDirty() } }));
      CoachPlanBlocks.load(fixture.plan.content, fixture.session); publish();
      window.addEventListener('coach:blocks-changed', publish);
      document.querySelector('#plan-form').addEventListener('submit', event => { event.preventDefault(); if (CoachPlanBlocks.validate()) return; const content = { ...fixture.plan.content }; const blocks = CoachPlanBlocks.content(); if (blocks !== undefined) content.activities = blocks; fixture.plan = { version: fixture.plan.version + 1, content }; saves++; CoachPlanBlocks.load(content, fixture.session); publish(); });
      window.print = () => { window.printed = document.querySelector('#session-print-sheet').textContent; window.printedDiagrams = document.querySelectorAll('#session-print-sheet .plan-block-diagram-preview svg').length; };
    });
    assert.equal(await page.evaluate(() => CoachPlanBlocks.content()), undefined, 'Loading a legacy plan never converts it');
    const annotations = await page.evaluate(() => {
      const drill = diagram => ({ target: 'technical', title: 'Annotated drill', text: 'Pass into space.', minutes: 10, diagram });
      const colors = { blue: '#326887', gold: '#d9ae63', red: '#b64d49', green: '#397561', purple: '#79549d', white: '#f5f2e9' }, accepted = [], rendered = [];
      for (const pitch of ['full', 'half', 'blank', 'facing-goal', 'away-from-goal']) {
        const diagram = structuredClone(diagramFixture); diagram.pitch = pitch;
        accepted.push(CoachPlanBlocks.canAddDrill(drill(diagram)));
      }
      for (const [color, fill] of Object.entries(colors)) for (const kind of ['home', 'away']) {
        const diagram = structuredClone(diagramFixture); diagram.items[0].color = color; diagram.items[0].kind = kind; diagram.frames[0].arrows[0].color = color;
        accepted.push(CoachPlanBlocks.canAddDrill(drill(diagram)));
        const preview = CoachPlanBlocks.previewDiagram(diagram);
        rendered.push(preview?.querySelector('circle')?.getAttribute('fill') === fill && preview?.querySelector('[data-preview-arrow] line')?.getAttribute('stroke') === fill && preview?.querySelector('[data-preview-arrow] polygon')?.getAttribute('fill') === fill);
      }
      const boundary = structuredClone(diagramFixture); boundary.frames[0].arrows = Array.from({ length: 24 }, (_, index) => ({ id: 'arrow_' + index, x1: 0, y1: 100, x2: 100, y2: 0, color: 'charcoal' }));
      boundary.frames.push({ ...structuredClone(boundary.frames[0]), id: 'next' }); accepted.push(CoachPlanBlocks.canAddDrill(drill(boundary)));
      boundary.frames[0].arrows = []; accepted.push(CoachPlanBlocks.canAddDrill(drill(boundary)));
      const invalid = [], check = mutate => { const diagram = structuredClone(diagramFixture); mutate(diagram); invalid.push(CoachPlanBlocks.canAddDrill(drill(diagram))); invalid.push(CoachPlanBlocks.previewDiagram(diagram) !== null); };
      for (const color of ['charcoal', 'toString', '#fff', null, undefined, 1, false, {}, [], ['blue']]) check(diagram => { diagram.items[0].color = color; });
      for (const kind of ['ball', 'cone', 'goal', 'zone']) check(diagram => { diagram.items[0].kind = kind; if (kind === 'zone') diagram.items[0].zone = { shape: 'rect', width: 20, height: 20, color: 'blue' }; });
      for (const arrows of [null, undefined, {}, 'arrows', false]) check(diagram => { diagram.frames[0].arrows = arrows; });
      for (const arrow of [null, undefined, {}, [], 1, false]) check(diagram => { diagram.frames[0].arrows = [arrow]; });
      for (const color of ['black', 'toString', null, undefined, 1, false, {}, [], ['blue']]) check(diagram => { diagram.frames[0].arrows[0].color = color; });
      for (const key of ['x1', 'y1', 'x2', 'y2']) for (const value of [-.01, 100.01, NaN, Infinity, null, undefined, '50', true, {}, []]) check(diagram => { diagram.frames[0].arrows[0][key] = value; });
      for (const id of ['', 'bad id', 'a'.repeat(41), null, undefined, 1, []]) check(diagram => { diagram.frames[0].arrows[0].id = id; });
      for (const key of ['id', 'x1', 'y1', 'x2', 'y2', 'color']) check(diagram => { delete diagram.frames[0].arrows[0][key]; });
      check(diagram => { diagram.frames[0].arrows[0].url = 'https://outside.test/'; });
      check(diagram => { diagram.frames[0].arrows.push({ ...diagram.frames[0].arrows[0] }); });
      check(diagram => { diagram.frames[0].arrows = Array.from({ length: 25 }, (_, index) => ({ ...diagram.frames[0].arrows[0], id: 'arrow_' + index })); });
      const fallback = CoachPlanBlocks.previewDiagram(diagramFixture), line = fallback.querySelector('[data-preview-arrow] line');
      return { accepted, rendered, invalid, unchanged: CoachPlanBlocks.content() === undefined, charcoal: line.getAttribute('stroke'), endpoints: ['x1', 'y1', 'x2', 'y2'].map(key => line.getAttribute(key)), fallbackOnly: !CoachTactics.preview };
    });
    assert(annotations.accepted.every(Boolean), 'Client accepts the server field views, colours, empty arrows, boundary coordinates and arrow limit');
    assert(annotations.rendered.every(Boolean), 'Fallback preview renders each player and arrow colour');
    assert(annotations.invalid.every(value => value === false), 'Invalid annotations fail preflight and preview');
    assert.equal(annotations.unchanged, true); assert.equal(annotations.fallbackOnly, true); assert.equal(annotations.charcoal, '#38434a'); assert.deepEqual(annotations.endpoints, ['50', '65', '130', '65']);
    const patternInsertion = await page.evaluate(() => {
      const diagram = structuredClone(diagramFixture); diagram.purpose = 'team-pattern';
      Object.assign(diagram.frames[0].positions[0], { facing: 270, shadow: { length: 40, width: 20 } });
      const activity = value => ({ target: 'game', title: 'Fictional cover pattern', text: 'Face the ball and cover the passing lane.', minutes: 10, diagram: value });
      const accepted = CoachPlanBlocks.addDrill(activity(diagram)), retained = CoachPlanBlocks.content()?.[0]?.diagram;
      CoachPlanBlocks.discard(); publish();
      const rejected = [], unchanged = [], check = mutate => {
        const invalid = structuredClone(diagram); mutate(invalid);
        rejected.push(CoachPlanBlocks.addDrill(activity(invalid)));
        unchanged.push(CoachPlanBlocks.content() === undefined);
        CoachPlanBlocks.discard(); publish();
      };
      for (const purpose of ['tactic', '', null, 1]) check(value => { value.purpose = purpose; });
      check(value => { value.frames[0].positions[1].facing = 90; });
      check(value => { value.frames[0].positions[1].shadow = { length: 20, width: 20 }; });
      for (const dimension of ['length', 'width']) for (const invalid of [4, 61, '20', null]) check(value => { value.frames[0].positions[0].shadow[dimension] = invalid; });
      return { accepted, diagram, retained, rejected, unchanged };
    });
    assert.equal(patternInsertion.accepted, true, 'A team pattern with player facing and cover shadow can be added to a plan');
    assert.deepEqual(patternInsertion.retained, patternInsertion.diagram, 'Plan insertion retains purpose, facing, shadow, colours and arrows');
    assert(patternInsertion.rejected.every(value => value === false), 'Invalid purpose, non-player facing/shadow and invalid shadow dimensions are rejected');
    assert(patternInsertion.unchanged.every(Boolean), 'Rejected pattern insertions leave the legacy plan unchanged');
    const curvedArrow = await page.evaluate(() => {
      const diagram = structuredClone(diagramFixture);
      diagram.frames[0].arrows[0].points = [{ x: 35, y: 25 }, { x: 50, y: 30 }];
      const activity = value => ({ target: 'technical', title: 'Fictional curved pass', text: 'Pass around the defender.', minutes: 10, diagram: value });
      const accepted = CoachPlanBlocks.addDrill(activity(diagram)), retained = CoachPlanBlocks.content()?.[0]?.diagram;
      const preview = CoachPlanBlocks.previewDiagram(diagram), path = preview?.querySelector('[data-preview-arrow] path')?.getAttribute('d'), arrowhead = preview?.querySelector('[data-preview-arrow] polygon')?.getAttribute('points');
      CoachPlanBlocks.discard(); publish();
      const rejected = [], unchanged = [];
      const invalidPoints = [[], Array.from({ length: 33 }, () => ({ x: 20, y: 30 })), null, {}, [{ x: 20 }], [{ x: 20, y: 30, extra: 1 }], [null], [{ x: -1, y: 30 }], [{ x: 20, y: 101 }], [{ x: NaN, y: 30 }], [{ x: 20, y: Infinity }], [{ x: '20', y: 30 }]];
      for (const points of invalidPoints) {
        const invalid = structuredClone(diagram); invalid.frames[0].arrows[0].points = points;
        rejected.push(CoachPlanBlocks.addDrill(activity(invalid)), CoachPlanBlocks.previewDiagram(invalid) !== null);
        unchanged.push(CoachPlanBlocks.content() === undefined); CoachPlanBlocks.discard(); publish();
      }
      return { accepted, retained, diagram, path, arrowhead, rejected, unchanged };
    });
    assert.equal(curvedArrow.accepted, true, 'Curved arrows can be added to a plan');
    assert.deepEqual(curvedArrow.retained, curvedArrow.diagram, 'Activity snapshots retain the complete curved arrow');
    assert.match(curvedArrow.path, /Q/, 'Fallback previews render a quadratic curved path');
    assert.equal(curvedArrow.arrowhead.trim().split(/\s+/).length, 3, 'Curved paths retain a triangular arrowhead');
    assert(curvedArrow.rejected.every(value => value === false), 'Empty, oversized and malformed curve points fail insertion and preview');
    assert(curvedArrow.unchanged.every(Boolean), 'Rejected curves leave the legacy plan unchanged');
    const outlinedZone = await page.evaluate(() => {
      const diagram = structuredClone(diagramFixture);
      diagram.items.push({ id: 'box_1', kind: 'zone', label: '', zone: { shape: 'rect', width: 30, height: 20, color: 'blue', outline: true } });
      diagram.frames[0].positions.push({ id: 'box_1', x: 50, y: 50 });
      const activity = value => ({ target: 'technical', title: 'Fictional outlined area', text: 'Keep the passing area clear.', minutes: 10, diagram: value });
      const accepted = CoachPlanBlocks.addDrill(activity(diagram)), retained = CoachPlanBlocks.content()?.[0]?.diagram;
      const fill = CoachPlanBlocks.previewDiagram(diagram)?.querySelector('rect[width="60"][height="26"]')?.getAttribute('fill');
      CoachPlanBlocks.discard(); publish();
      const rejected = [], unchanged = [];
      for (const outline of ['true', 1, null, {}, []]) {
        const invalid = structuredClone(diagram); invalid.items.at(-1).zone.outline = outline;
        rejected.push(CoachPlanBlocks.addDrill(activity(invalid)), CoachPlanBlocks.previewDiagram(invalid) !== null);
        unchanged.push(CoachPlanBlocks.content() === undefined); CoachPlanBlocks.discard(); publish();
      }
      return { accepted, diagram, retained, fill, rejected, unchanged };
    });
    assert.equal(outlinedZone.accepted, true, 'Outlined boxes can be added to the plan');
    assert.deepEqual(outlinedZone.retained, outlinedZone.diagram, 'Plan snapshots preserve the outlined box');
    assert.equal(outlinedZone.fill, 'none', 'Fallback preview leaves the outlined box unfilled');
    assert(outlinedZone.rejected.every(value => value === false), 'Nonboolean outline values fail insertion and preview');
    assert(outlinedZone.unchanged.every(Boolean), 'Rejected outlined boxes do not change the plan');
    const insertion = await page.evaluate(() => {
      const drill = { target: 'technical', title: 'Receive safely', text: '  Keep exact instructions\nwith a second line.  ', minutes: 12, diagram: structuredClone(diagramFixture) };
      const canAdd = CoachPlanBlocks.canAddDrill(drill), unchangedBeforeAdd = CoachPlanBlocks.content() === undefined;
      const result = CoachPlanBlocks.addDrill(drill), content = CoachPlanBlocks.content();
      const isolated = CoachPlanBlocks.content(); isolated[0].title = 'External mutation';
      const internalTitle = CoachPlanBlocks.content()[0].title;
      drill.diagram.frames[0].positions[0].x = 90;
      const internalDiagramX = CoachPlanBlocks.content()[0].diagram.frames[0].positions[0].x;
      CoachPlanBlocks.discard(); publish();
      const invalid = [null, [], {}, { ...drill, target: 'equipment' }, { ...drill, text: 'x'.repeat(2001) }, { ...drill, text: 'bad\x00text' }, { ...drill, title: ' ' }, { ...drill, title: 'x'.repeat(121) }, { ...drill, minutes: 0 }, { ...drill, minutes: 121 }, { ...drill, minutes: 1.5 }, { ...drill, minutes: '12' }, { ...drill, diagram: { ...diagramFixture, url: 'https://outside.test/' } }, { ...drill, diagram: { title: 'Invalid snapshot' } }].map(value => CoachPlanBlocks.addDrill(value));
      const guarded = [];
      for (const patch of [{ busy: true }, { planReady: false }, { tab: 'home' }, { selected: 'other-session' }, { session: { ...fixture.session, status: 'cancelled' } }]) {
        window.dispatchEvent(new CustomEvent('coach:context', { detail: { ...fixture, ...patch } }));
        guarded.push(CoachPlanBlocks.addDrill(drill));
      }
      publish();
      CoachPlanBlocks.load({ activities: Array.from({ length: 16 }, () => ({ ...content[0] })) }, fixture.session); publish();
      const canAddAtLimit = CoachPlanBlocks.canAddDrill(drill), limited = CoachPlanBlocks.addDrill(drill), limitedCount = CoachPlanBlocks.content().length;
      const disabledAtLimit = document.getElementById('plan-add-activity').disabled;
      CoachPlanBlocks.load(fixture.plan.content, fixture.session); publish();
      const largeDiagram = { ...structuredClone(diagramFixture), frames: Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(diagramFixture.frames[0]), id: 'phase_' + index, notes: '田'.repeat(1000) })) };
      const large = { ...drill, diagram: largeDiagram }, budgetFirst = CoachPlanBlocks.addDrill(large), budgetSecond = CoachPlanBlocks.addDrill(large), budgetCount = CoachPlanBlocks.content().length;
      CoachPlanBlocks.load(fixture.plan.content, fixture.session); publish();
      return { result, canAdd, unchangedBeforeAdd, canAddAtLimit, content, internalTitle, internalDiagramX, invalid, guarded, limited, limitedCount, disabledAtLimit, budgetFirst, budgetSecond, budgetCount, saves };
    });
    assert.equal(insertion.result, true); assert.equal(insertion.saves, 0, 'Insertion never saves');
    assert.equal(insertion.canAdd, true); assert.equal(insertion.unchangedBeforeAdd, true, 'Preflight never changes a draft'); assert.equal(insertion.canAddAtLimit, false);
    assert.equal(insertion.content[0].instructions, '  Keep exact instructions\nwith a second line.  ');
    assert.equal(insertion.content[0].duration, 12); assert.equal(insertion.internalTitle, 'Receive safely');
    assert.deepEqual(Object.keys(insertion.content[0]).sort(), ['diagram', 'duration', 'equipment', 'instructions', 'stage', 'title'], 'Diagram snapshot is part of this activity');
    assert.equal(insertion.internalDiagramX, 25, 'Later source edits cannot change the activity snapshot');
    assert.equal(insertion.content[0].diagram.items[0].color, 'purple'); assert.equal(insertion.content[0].diagram.pitch, 'facing-goal'); assert.deepEqual(insertion.content[0].diagram.frames[0].arrows, [{ id: 'arrow_1', x1: 25, y1: 50, x2: 65, y2: 50, color: 'charcoal' }]);
    assert.equal(insertion.budgetFirst, true); assert.equal(insertion.budgetSecond, false); assert.equal(insertion.budgetCount, 1, 'UTF-8 aggregate byte limit rejects another diagram without changing the draft');
    assert(insertion.invalid.every(value => value === false), 'Invalid inputs fail without a partial draft');
    assert(insertion.guarded.every(value => value === false), 'Busy, unloaded, cancelled or mismatched sessions reject insertion');
    assert.equal(insertion.limited, false); assert.equal(insertion.limitedCount, 16); assert.equal(insertion.disabledAtLimit, true);
    assert.equal(await page.evaluate(() => CoachPlanBlocks.content()), undefined, 'Guard tests preserve the legacy plan');
    await page.getByRole('button', { name: 'First-touch starter', exact: true }).click();
    assert.equal(await page.locator('.plan-block').count(), 4); assert.equal(await page.evaluate(() => saves), 0, 'Starters only edit the shared draft');
    assert.match(await page.locator('.plan-block-budget').innerText(), /55 minutes planned.*60-minute/);
    await page.evaluate(() => { currentTactics.sessionId = 'other-session'; });
    await page.locator('#plan-block-0-attach-diagram').click();
    assert.equal(await page.evaluate(() => CoachPlanBlocks.content()[0].diagram), undefined, 'Tactics draft from another session cannot attach');
    await page.evaluate(() => { currentTactics.sessionId = fixture.session.id; });
    await page.locator('#plan-block-0-attach-diagram').click();
    assert.equal(await page.locator('.plan-block-diagram-preview svg').count(), 1);
    await page.evaluate(() => { currentTactics.diagram.frames[0].positions[0].x = 80; });
    assert.equal(await page.evaluate(() => CoachPlanBlocks.content()[0].diagram.frames[0].positions[0].x), 25, 'Attachment is a copy of the current tactics draft');
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
    assert.equal(await page.locator('#field-stage-diagram svg').count(), 1, 'Field view includes the saved activity diagram');
    assert.equal(await page.locator('#field-stage-diagram circle').first().getAttribute('fill'), '#79549d', 'Saved field view retains player colour');
    assert.equal(await page.locator('#field-stage-diagram [data-preview-arrow] line').getAttribute('stroke'), '#38434a', 'Saved field view retains drawn arrows');
    assert.equal(await page.locator('#session-field-view script').count(), 0);
    await page.getByRole('button', { name: 'Print session sheet', exact: true }).last().click();
    const printed = await page.evaluate(() => printed); assert.match(printed, /75 minutes planned.*60-minute/); assert.match(printed, /30 min/); assert.match(printed, /supporting notesLegacy unchanged/);
    assert.equal(await page.evaluate(() => printedDiagrams), 1, 'Printable saved plan includes the diagram');
    await page.getByRole('button', { name: 'Close field view' }).click();
    await page.locator('#plan-block-0-duration').fill('0'); assert.match(await page.evaluate(() => CoachPlanBlocks.validate()), /1 to 120/); await page.evaluate(() => CoachPlanBlocks.discard());
    await page.getByRole('button', { name: 'Remove diagram from activity 2', exact: true }).click();
    assert.equal(await page.locator('#plan-activities .plan-block-diagram-preview svg').count(), 1, 'Declining removal retains the snapshot');
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Remove diagram from activity 2', exact: true }).click();
    assert.equal(await page.locator('#plan-activities .plan-block-diagram-preview svg').count(), 0); await page.evaluate(() => CoachPlanBlocks.discard());
    page.on('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Remove activity 1', exact: true }).click(); assert.equal(await page.locator('.plan-block').count(), 3);
    await page.evaluate(() => { fixture.busy = true; publish(); }); assert.equal(await page.locator('#plan-block-0-stage').isDisabled(), true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('coach:context', { detail: null }))); assert.equal(await page.locator('.plan-block').count(), 0);
    assert.equal(await page.evaluate(() => CoachPlanBlocks.content()), undefined);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Editor fits a phone screen');
    console.log('PASS: structured plan draft, keyboard ordering, explicit save, saved field timers/print, legacy retention and sign-out cleanup');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
