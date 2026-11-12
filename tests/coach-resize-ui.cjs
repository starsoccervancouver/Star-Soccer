/* Resize interactions with fictional diagrams and intercepted local assets only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const origin = 'https://resize.example.test', session = { id: 'fictional-resize-session', status: 'Scheduled' };
  const fixture = { profile: { email: 'resize@example.test', role: 'coach' }, session, selected: session.id, tab: 'plan', busy: false, planReady: true };
  const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/workspace.css"><link rel="stylesheet" href="/workspace-tactics.css"><script defer src="/workspace-tactics.js"></script></head><body><main><details id="tactics-disclosure" open><summary>Tactics</summary><section id="tactics-board-tools"></section></details></main></body></html>';
  const assets = { '/': { body: html, type: 'text/html' } };
  for (const name of ['workspace.css', 'workspace-tactics.css', 'workspace-tactics.js']) assets['/' + name] = { body: fs.readFileSync('private-attendance/web/' + name, 'utf8'), type: name.endsWith('.js') ? 'text/javascript' : 'text/css' };
  for (const [name, file] of [['manrope', 'manrope-normal-latin'], ['instrument-serif', 'instrument-serif-italic-latin']]) assets['/workspace/assets/' + name + '.woff2'] = { body: fs.readFileSync('fonts/' + file + '.woff2'), type: 'font/woff2' };
  const browser = await chromium.launch();
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: true });
      const failures = [];
      await context.route('**/*', route => {
        const url = new URL(route.request().url()), asset = assets[url.pathname];
        if (url.origin !== origin || !asset) { failures.push(url.href); return route.abort(); }
        return route.fulfill({ status: 200, contentType: asset.type, body: asset.body });
      });
      await context.addInitScript(() => {
        window.CoachClub = { name: 'Fictional Club', timeZone: 'America/Vancouver' };
        window.confirm = () => true;
        window.addEventListener('coach:tactics-request', event => {
          const { operation, resolve, reject } = event.detail;
          if (operation === 'list') resolve({ diagrams: [] }); else reject(new Error('Resize checks never save live data'));
        });
      });
      const page = await context.newPage();
      page.on('pageerror', error => failures.push(error.message));
      await page.goto(origin);
      await page.evaluate(detail => window.dispatchEvent(new CustomEvent('coach:context', { detail })), fixture);
      await page.waitForFunction(() => window.CoachTactics?.getDraft());
      const draft = () => page.evaluate(() => CoachTactics.getDraft().diagram);
      const load = async (item, pitch = 'full', rotation = 0, at = { x: 50, y: 50 }) => {
        await page.evaluate(({ item, pitch, rotation, at, sessionId }) => CoachTactics.useDraft({ sessionId, title: 'Fictional resize drill', diagram: { schemaVersion: 1, pitch, items: [item], frames: [0, 1].map(i => ({ id: 'phase' + i, title: 'Phase ' + i, duration: 2, positions: [{ id: item.id, ...at, ...(item.kind === 'goal' ? { rotation } : {}) }] })) } }), { item, pitch, rotation, at, sessionId: session.id });
        await page.locator('#tactics-item').selectOption(item.id);
        await page.locator('#tactics-pitch-board').scrollIntoViewIfNeeded();
      };
      const handle = () => page.locator('[data-size-resize][role="button"]');
      const gesture = async (cancel = false) => {
        await handle().scrollIntoViewIfNeeded();
        const r = await handle().boundingBox(), a = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        const center = await page.locator('[data-tactics-item]').evaluate(el => { const p = el.ownerSVGElement.createSVGPoint(), result = p.matrixTransform(el.getScreenCTM()); return { x: result.x, y: result.y }; });
        const length = Math.hypot(a.x - center.x, a.y - center.y), b = { x: a.x + (a.x - center.x) / length * 25, y: a.y + (a.y - center.y) / length * 25 };
        const touch = await context.newCDPSession(page);
        await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...a, id: 1 }] });
        await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...b, id: 1 }] });
        await touch.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
        await touch.detach();
      };
      const moveGoalBody = async () => {
        await page.locator('[data-tactics-item="goal"]').evaluate(el => el.scrollIntoView({ block: 'center' }));
        const before = await draft(), boardBounds = await page.locator('#tactics-pitch-board').boundingBox();
        const center = await page.locator('[data-tactics-item="goal"]').evaluate(el => { const p=el.ownerSVGElement.createSVGPoint(), at=p.matrixTransform(el.getScreenCTM()); return {x:at.x,y:at.y}; });
        const towards = { x: boardBounds.x+boardBounds.width/2-center.x, y: boardBounds.y+boardBounds.height/2-center.y }, length = Math.hypot(towards.x,towards.y);
        const end = length > 10 ? {x:center.x+towards.x/length*30,y:center.y+towards.y/length*30} : {x:center.x+24,y:center.y+12};
        assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.closest('[data-tactics-item]')?.dataset.tacticsItem,center),'goal','The goal center remains a movement target: '+JSON.stringify({width,center,boardBounds,target:await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.outerHTML.slice(0,300),center)}));
        await page.mouse.move(center.x,center.y); await page.mouse.down(); await page.mouse.move(end.x,end.y,{steps:5}); await page.mouse.up();
        const after = await draft();
        assert.notDeepEqual(after.frames[0].positions,before.frames[0].positions,'Dragging the goal body moves it');
        assert.deepEqual(after.items,before.items,'Dragging the goal body preserves its size');
        await page.locator('#tactics-undo').click(); assert.deepEqual(await draft(),before);
      };
      for (const shape of ['rect', 'ellipse', 'triangle', 'diamond']) for (const outline of [false, true]) {
        await load({ id: 'shape', kind: 'zone', label: '', zone: { shape, width: 25, height: 25, color: 'blue', ...(outline ? { outline } : {}) } }, shape === 'ellipse' ? 'half' : 'full');
        const before = await draft();
        assert.equal(await handle().count(), 1, shape + ' exposes a resize handle');
        await gesture();
        const resized = await draft();
        assert(resized.items[0].zone.width > 25 && resized.items[0].zone.height > 25, shape + ' touch drag grows both dimensions: ' + JSON.stringify({ width, item: resized.items[0], failures }));
        assert.deepEqual(resized.frames, before.frames, 'Resizing centered shapes preserves every phase position');
        await page.locator('#tactics-undo').click(); assert.deepEqual(await draft(), before, 'One undo restores the whole drag');
        await page.locator('#tactics-redo').click(); assert.deepEqual(await draft(), resized);
        await gesture(true); assert.deepEqual(await draft(), resized, 'Touch cancellation restores the exact diagram');
        await page.locator('#tactics-undo').click(); assert.deepEqual(await draft(), before, 'Cancelled gestures consume no history');
        await handle().press('ArrowRight'); assert.equal((await draft()).items[0].zone.width, 27);
        assert(await handle().evaluate(el => el === document.activeElement), 'Keyboard resize retains focus after redraw');
        await handle().press('Shift+ArrowDown'); assert.equal((await draft()).items[0].zone.height, 35);
      }
      for (const rotation of [0, 90, 270]) {
        await load({ id: 'goal', kind: 'goal', label: '' }, rotation === 90 ? 'facing-goal' : 'full', rotation);
        await moveGoalBody();
        const before = await draft();
        await handle().press('ArrowRight');
        assert.equal((await draft()).items[0].scale, 1.1);
        assert.match(await page.locator('#tactics-pitch-board [data-symbol="goal"]').getAttribute('transform'), /scale\(1\.1\)/);
        await page.locator('#tactics-undo').click(); assert.deepEqual(await draft(), before, 'Legacy goal data restores without adding size defaults');
        await gesture(); const resized = await draft(); assert.notEqual(resized.items[0].scale, 1, 'Rotated goal touch handle changes its size');
        assert.deepEqual(resized.frames, before.frames, 'Goal resize preserves phase positions and rotations');
        await page.locator('#tactics-undo').click(); assert.deepEqual(await draft(), before);
        await gesture(true); assert.deepEqual(await draft(), before, 'Goal touch cancellation restores legacy data');
      }
      await load({ id: 'goal', kind: 'goal', label: '' });
      const beforeEscape = await draft(), r = await handle().boundingBox();
      await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2); await page.mouse.down(); await page.mouse.move(r.x + 30, r.y + 30);
      assert.notDeepEqual(await draft(), beforeEscape, 'Mouse resize begins before Escape');
      await page.keyboard.press('Escape'); await page.mouse.up();
      assert.deepEqual(await draft(), beforeEscape, 'Escape cancels an in-progress mouse resize');
      await load({ id: 'goal', kind: 'goal', label: '', scale: 4 }, 'full', 0, { x: 96, y: 96 });
      await moveGoalBody();
      const boardBounds = await page.locator('#tactics-pitch-board').boundingBox(), hitBounds = await page.locator('circle[data-size-resize]').boundingBox();
      assert(hitBounds.x >= boardBounds.x - 1 && hitBounds.y >= boardBounds.y - 1 && hitBounds.x + hitBounds.width <= boardBounds.x + boardBounds.width + 1 && hitBounds.y + hitBounds.height <= boardBounds.y + boardBounds.height + 1, 'Large goal at the field edge keeps its complete touch handle inside the board');
      await handle().press('ArrowRight'); assert.equal((await draft()).items[0].scale, 4, 'Goal size remains bounded');
      await load({ id: 'goal', kind: 'goal', label: '', scale: .5 });
      await handle().press('ArrowLeft'); assert.equal((await draft()).items[0].scale, .5);
      assert.deepEqual(failures, []);
      await context.close();
    }
    console.log('Resize UI passed: all shapes, goals, touch, keyboard, bounds, undo and cancellation at desktop/mobile widths.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
