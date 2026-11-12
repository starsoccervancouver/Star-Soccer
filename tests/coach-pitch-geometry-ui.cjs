/* Pitch geometry and input checks use only fictional records and intercepted local assets. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const origin = 'https://pitch-geometry.example.test', assets = {};
  const styles = ['workspace', 'workspace-session', 'workspace-tactics', 'workspace-library'];
  for (const name of styles) assets['/' + name + '.css'] = { type: 'text/css', body: fs.readFileSync('private-attendance/web/' + name + '.css', 'utf8') };
  for (const name of ['workspace-tactics', 'workspace-library']) assets['/' + name + '.js'] = { type: 'text/javascript', body: fs.readFileSync('private-attendance/web/' + name + '.js', 'utf8') };
  for (const [name, file] of [['manrope', 'manrope-normal-latin'], ['instrument-serif', 'instrument-serif-italic-latin']]) assets['/workspace/assets/' + name + '.woff2'] = { type: 'font/woff2', body: fs.readFileSync('fonts/' + file + '.woff2') };
  assets['/workspace'] = { type: 'text/html', body: '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">' + styles.map(name => '<link rel="stylesheet" href="/' + name + '.css">').join('') + '<script defer src="/workspace-tactics.js"></script><script defer src="/workspace-library.js"></script></head><body><main><details id="tactics-disclosure"><summary>Tactics</summary><section id="tactics-board-tools"></section></details><section id="coach-drill-library"></section><section id="standalone-drill-library"></section></main></body></html>' };
  const source = {
    schemaVersion: 1, pitch: 'half',
    items: [{ id: 'player', kind: 'home', label: '1' }, { id: 'ball', kind: 'ball', label: '' }, { id: 'zone', kind: 'zone', label: '', zone: { shape: 'rect', width: 20, height: 15, color: 'blue' } }],
    frames: [
      { id: 'start', title: 'Start', duration: 3, positions: [{ id: 'player', x: 20, y: 25, facing: 90, vision: { length: 20, angle: 90 }, shadow: { length: 25, width: 20 }, curve: 15 }, { id: 'ball', x: 30, y: 60 }, { id: 'zone', x: 75, y: 80 }], arrows: [{ id: 'arrow', x1: 15, y1: 85, x2: 45, y2: 85, color: 'charcoal' }] },
      { id: 'end', title: 'End', duration: 3, positions: [{ id: 'player', x: 70, y: 70, facing: 120, vision: { length: 20, angle: 90 }, shadow: { length: 25, width: 20 } }, { id: 'ball', x: 50, y: 30 }, { id: 'zone', x: 75, y: 80 }] }
    ]
  };
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }), errors = [], requests = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url()), asset = assets[url.pathname];
      if (url.origin !== origin || !asset) { requests.push(url.href); return route.abort(); }
      return route.fulfill({ status: 200, contentType: asset.type, body: asset.body });
    });
    await context.addInitScript(() => {
      window.CoachClub = { name: 'Fictional Club', timeZone: 'America/Vancouver' };
      window.addEventListener('coach:library-request', event => { if (event.detail.operation === 'list') event.detail.resolve({ drills: [] }); else event.detail.reject(Error('Unexpected write')); });
    });
    const page = await context.newPage(); page.setDefaultTimeout(7000); page.on('pageerror', error => errors.push(error.message));
    const board = page.locator('#tactics-pitch-board');
    const draft = () => page.evaluate(() => CoachTactics.libraryDiagram());
    const open = diagram => page.evaluate(diagram => CoachTactics.openLibrary({ host: document.getElementById('library-diagram-editor'), title: 'Fictional geometry drill', diagram }), diagram);
    const screen = point => board.evaluate((board, point) => {
      const surface = board.querySelector('[data-field-view] > rect'), p = board.createSVGPoint();
      p.x = point.x * Number(surface.getAttribute('width')) / 100; p.y = point.y * Number(surface.getAttribute('height')) / 100;
      const result = p.matrixTransform(board.querySelector('[data-camera-scene]').getScreenCTM()); return { x: result.x, y: result.y };
    }, point);
    const drag = async (from, to) => { await board.scrollIntoViewIfNeeded(); const a = await screen(from), b = await screen(to); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up(); };
    const close = (actual, expected, message) => assert(Math.abs(actual - expected) < .35, message + ': ' + actual);
    await page.goto(origin + '/workspace');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('coach:context', { detail: { profile: { email: 'geometry@example.test', name: 'Fictional Coach', role: 'owner', sessionVersion: 1 }, tab: 'library', session: null, selected: '', sessions: [], notes: [], busy: false } })));
    await page.locator('#library-new').click();
    await open(source);
    assert.deepEqual(await draft(), source, 'Opening a saved half field retains its normalized content exactly');
    const dimensions = { full: [1000, 650], half: [500, 650], 'facing-goal': [650, 500], 'away-from-goal': [650, 500], blank: [1000, 650] };
    for (const [pitch, [width, height]] of Object.entries(dimensions)) {
      await page.locator('#tactics-pitch').selectOption(pitch);
      for (const orientation of ['auto', 'wide', 'tall']) {
        await page.locator('#tactics-device-view').selectOption(orientation);
        const geometry = await board.evaluate(board => {
          const surface = board.querySelector('[data-field-view] > rect'), boundary = board.querySelector('[data-field-boundary]'), player = board.querySelector('[data-tactics-item="player"]').transform.baseVal.consolidate().matrix;
          const zone = board.querySelector('[data-zone="zone"] rect'), arrow = board.querySelector('[data-tactics-arrow="arrow"] line'), box = board.viewBox.baseVal;
          return { surface: [Number(surface.getAttribute('width')), Number(surface.getAttribute('height'))], boundary: [Number(boundary.getAttribute('width')), Number(boundary.getAttribute('height'))], view: [box.width, box.height], player: [player.e, player.f], zone: [Number(zone.getAttribute('width')), Number(zone.getAttribute('height'))], arrow: [Number(arrow.getAttribute('x1')), Number(arrow.getAttribute('y1')), Number(arrow.getAttribute('x2')), Number(arrow.getAttribute('y2'))], overlays: [...board.querySelectorAll('[data-player-vision],[data-cover-shadow]')].map(el => el.getAttribute('viewBox')) };
        });
        assert.deepEqual(geometry.surface, [width, height], pitch + ' logical dimensions');
        assert.deepEqual(geometry.boundary, [width - 50, height - 50], pitch + ' boundary follows the surface');
        const rotated = orientation === 'wide' && width < height || orientation === 'tall' && width > height;
        close(geometry.view[0], (rotated ? height : width) + 44, pitch + ' orientation width'); close(geometry.view[1], (rotated ? width : height) + 44, pitch + ' orientation height');
        assert.deepEqual(geometry.player, [width * .2, height * .25]);
        assert.deepEqual(geometry.zone, [width * .2, height * .15]);
        assert.deepEqual(geometry.arrow, [width * .15, height * .85, width * .45, height * .85]);
        assert.deepEqual(geometry.overlays, ['0 0 ' + width + ' ' + height, '0 0 ' + width + ' ' + height]);
        assert.deepEqual(await draft(), { ...source, pitch }, 'Orientation and pitch selection preserve every normalized item, phase and route');
      }
      const preview = await page.evaluate(content => {
        const image = CoachTactics.preview(content), p = image.querySelector('[data-preview-piece="player"]').transform.baseVal.consolidate().matrix;
        return { viewBox: image.getAttribute('viewBox'), player: [p.e, p.f], overlays: [...image.querySelectorAll('[data-player-vision],[data-cover-shadow]')].map(el => el.getAttribute('viewBox')) };
      }, { ...source, pitch });
      assert.equal(preview.viewBox, '0 0 ' + width + ' ' + height);
      assert.deepEqual(preview.player, [width * .2, height * .25]);
      assert.deepEqual(preview.overlays, ['0 0 ' + width + ' ' + height, '0 0 ' + width + ' ' + height]);
    }
    // Preview playback uses the saved pitch even while another type is being edited.
    const previewWhileBlank = await page.evaluate(content => CoachTactics.previewAt(content, 1.25).image.outerHTML, source);
    await open(source);
    assert.equal(await page.evaluate(content => CoachTactics.previewAt(content, 1.25).image.outerHTML, source), previewWhileBlank);
    for (const [pitch, orientation] of [['half', 'wide'], ['half', 'tall'], ['facing-goal', 'wide'], ['away-from-goal', 'tall']]) {
      await open({ ...source, pitch }); await page.locator('#tactics-device-view').selectOption(orientation);
      await drag({ x: 20, y: 25 }, { x: 32, y: 40 });
      const moved = (await draft()).frames[0].positions[0]; close(moved.x, 32, pitch + ' drag x'); close(moved.y, 40, pitch + ' drag y');
      await page.locator('#tactics-undo').click(); assert.deepEqual(await draft(), { ...source, pitch });
      await page.locator('#tactics-item').selectOption('player');
      const before = await screen({ x: 20, y: 25 }); await board.press('ArrowRight');
      const movedByKey = (await draft()).frames[0].positions[0], after = await screen(movedByKey);
      assert(after.x > before.x, pitch + ' keyboard right moves right in the displayed orientation'); close(after.y, before.y, pitch + ' keyboard right preserves screen height');
    }
    await open(source); await page.locator('#tactics-device-view').selectOption('tall'); await page.locator('#tactics-item').selectOption('player');
    await drag({ x: 40, y: 25 }, { x: 50, y: 25 });
    assert.equal((await draft()).frames[0].positions[0].vision.length, 30, 'Half-field overlay drag matches the rendered normalized radius');
    await page.locator('#tactics-undo').click(); assert.deepEqual(await draft(), source);
    await page.locator('#tactics-view-menu > summary').click(); await page.locator('#tactics-grid').click(); await page.locator('#tactics-lanes').click();
    const guides = await board.evaluate(board => [...board.querySelectorAll('[data-tactics-grid],[data-tactics-lanes]')].map(el => { const box = el.getBBox(); return { x: box.x, y: box.y, right: box.x + box.width, bottom: box.y + box.height }; }));
    for (const guide of guides) assert(guide.x >= 25 && guide.y >= 25 && guide.right <= 475 && guide.bottom <= 625, 'Half-field guides stay within its shortened boundary');
    // Full-field camera modes remain views of unchanged full-field coordinates.
    await open({ ...source, pitch: 'full' }); await page.locator('#tactics-device-view').selectOption('wide');
    for (const mode of ['left-half', 'right-half', 'facing-goal', 'away-from-goal']) {
      await page.locator('#tactics-camera').selectOption(mode);
      const result = await board.evaluate(board => { const box = board.viewBox.baseVal, p = board.querySelector('[data-tactics-item="player"]').transform.baseVal.consolidate().matrix; return { width: box.width, height: box.height, player: [p.e, p.f] }; });
      const end = mode.endsWith('goal'); close(result.width, end ? 694 : 544, 'Full-field camera width'); close(result.height, end ? 544 : 694, 'Full-field camera height'); assert.deepEqual(result.player, [200, 162.5]);
      assert.deepEqual(await draft(), { ...source, pitch: 'full' });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await open(source); await page.locator('#tactics-device-view').selectOption('auto');
    assert.equal(await board.getAttribute('data-orientation'), 'tall', 'Native half field stays upright on mobile');
    await page.locator('#tactics-device-view').selectOption('wide'); assert.equal(await board.getAttribute('data-orientation'), 'wide');
    assert.deepEqual(await draft(), source); assert.deepEqual(errors, []); assert.deepEqual(requests, []);
    await context.close();
    console.log('Pitch geometry passed: true half-field dimensions, orientations, normalized drag/keyboard/overlay input, preview playback, guides and unchanged full-field camera crops. Mock data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
