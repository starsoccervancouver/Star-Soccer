/* Inquiry recovery contracts. Local static server, fictional data and mocked delivery only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
const recoveryStub = `window.StarFormRecovery={show(container,options){window.fixtureRecovery={...options,requests:options.requests.map(data=>Object.fromEntries(data))};container.textContent='Local recovery fixture';}};`;

(async () => {
  const server = http.createServer((request, response) => {
    const file = path.resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end(); return; }
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
    response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    response.end(fs.readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  let checks = 0;
  try {
    for (const file of ['contact.html', 'program-private-small-group.html']) {
      for (const initialMode of ['accepted', 'rejected', 'errors200', 'network', 'timeout', 'malformed', 'server', 'unknown', 'requestTimeout', 'ambiguousRateLimit']) {
        const context = await browser.newContext(), writes = [], errors = [];
        let mode = initialMode;
        await context.addInitScript(recoveryStub);
        await context.addInitScript(() => {
          const original = window.setTimeout;
          window.setTimeout = (fn, delay, ...args) => original(fn, delay === 20000 ? 30 : delay, ...args);
        });
        await context.route('**/*', async route => {
          const request = route.request(), url = new URL(request.url());
          if (url.origin === origin) {
            if (url.pathname === '/form-recovery.js') return route.fulfill({ contentType: 'text/javascript', body: recoveryStub });
            return route.continue();
          }
          assert.equal(url.origin, 'https://formspree.io', 'No other external service is permitted');
          assert.equal(url.pathname, '/f/testform', 'Only the fictional fixture endpoint is used');
          assert.equal(request.method(), 'POST'); writes.push(request.postData());
          if (mode === 'network') return route.abort();
          if (mode === 'timeout') { await new Promise(resolve => setTimeout(resolve, 100)); return route.abort(); }
          const status = mode === 'rejected' ? 422 : mode === 'server' ? 503 : mode === 'requestTimeout' ? 408 : mode === 'ambiguousRateLimit' ? 429 : 200;
          const body = mode === 'malformed' ? '<html>Unavailable</html>' : JSON.stringify(['unknown', 'ambiguousRateLimit'].includes(mode) ? { unexpected: true } : ['rejected', 'errors200', 'server', 'requestTimeout'].includes(mode) ? { errors: [{ message: 'Fixture reject' }] } : { next: 'https://formspree.io/thanks' });
          return route.fulfill({ status, contentType: 'application/json', body });
        });
        const page = await context.newPage(); page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
        await page.goto(origin + '/' + file + '?utm_source=fictional#inquiry');
        await page.waitForFunction(() => typeof window.StarFormService?.submit === 'function');
        const form = page.locator('form[data-inquiry]'), email = form.locator('[name="email"]'), submit = form.locator('[type="submit"]');
        await form.evaluate(element => { element.action = 'https://formspree.io/f/testform'; });
        await email.fill('fictional@example.test');
        const field = form.locator(file === 'contact.html' ? '[name="Message"]' : '[name="Youngest age"]');
        await field.fill(file === 'contact.html' ? 'Fictional inquiry details' : '8');
        await submit.click(); await page.waitForFunction(() => !document.querySelector('form[data-inquiry]').hasAttribute('aria-busy'));
        assert.equal(writes.length, 1);
        assert.match(writes[0], /name="Client reference"\r\n\r\nSS-INQUIRY-[a-f0-9-]{36}/);
        assert.match(writes[0], new RegExp('name="Submission page"\\r\\n\\r\\nhttps://starsoccer\\.ca/' + file.replace('.', '\\.')));
        assert.match(writes[0], /name="subject"\r\n\r\nStar Soccer/);
        assert.match(writes[0], /name="email"\r\n\r\nfictional@example\.test/);
        assert.match(writes[0], /name="_gotcha"\r\n\r\n/);
        assert(!/name="(?:_url|_replyto|_subject|_honey|_template|_captcha)"/.test(writes[0]), 'Legacy provider controls are converted before sending');
        assert(!writes[0].includes(origin), 'The provider gets a canonical public URL, never the local origin');
        assert(!writes[0].includes('Submission page"\r\n\r\nhttps://starsoccer.ca/' + file + '?'), 'Source URL strips query parameters');
        if (mode === 'accepted') {
          assert.match(await form.locator('[data-feedback]').innerText(), /was submitted/);
          assert.match(await form.locator('[data-feedback]').innerText(), /reply to fictional@example\.test/);
          assert.equal(await submit.isDisabled(), true);
          assert.equal(await page.evaluate(() => window.fixtureRecovery), undefined);
        } else {
          const result = await page.evaluate(() => fixtureRecovery), rejected = ['rejected', 'errors200'].includes(mode);
          assert.equal(result.states[0].state, rejected ? 'rejected' : 'uncertain');
          assert.equal(result.reference, result.requests[0]['Client reference']);
          assert.equal(result.requests[0].email, 'fictional@example.test');
          assert.equal(result.requests[0]._url, 'https://starsoccer.ca/' + file);
          assert.equal(result.requests[0][file === 'contact.html' ? 'Message' : 'Player ages'], file === 'contact.html' ? 'Fictional inquiry details' : '8 years');
          assert.equal(await submit.isDisabled(), !rejected); assert.equal(await email.isDisabled(), !rejected);
          assert.equal(await email.inputValue(), 'fictional@example.test');
          if (rejected) {
            await email.fill('edited-fictional@example.test'); mode = 'accepted'; await submit.click();
            await page.waitForFunction(() => !document.querySelector('form[data-inquiry]').hasAttribute('aria-busy'));
            assert.equal(writes.length, 2); assert(writes[1].includes(result.reference), 'A rejected retry retains the reference');
            assert(writes[1].includes('edited-fictional@example.test'), 'A wholly rejected request remains editable');
            assert.match(await form.locator('[data-feedback]').innerText(), /reply to edited-fictional@example\.test/);
            assert.equal(await form.locator('.form-recovery').isVisible(), false);
          } else {
            await form.evaluate(element => element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
            assert.equal(writes.length, 1, 'An uncertain outcome cannot replay from another submit event');
          }
        }
        assert.deepEqual(errors, []); checks++; await context.close();
      }
    }
    console.log('Inquiry recovery: ' + checks + ' local contact/private acceptance, rejection, timeout, network, malformed-response, server-error, snapshot and stable-reference cases passed. No live submissions.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
