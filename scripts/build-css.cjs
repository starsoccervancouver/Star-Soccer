/* Keep editable CSS; ship only selectors used by maintained pages and scripts. */
const fs = require('node:fs');
const { PurgeCSS } = require('purgecss');
const { transform } = require('lightningcss');
const { gzipSync } = require('node:zlib');
const path = require('node:path');
process.chdir(path.join(__dirname, '..'));

async function build() {
  const sources = ['styles.css', 'audit-fixes.css', 'restoration.css'];
  const raw = sources.map(file => fs.readFileSync(file, 'utf8')).join('\n');
  const content = fs.readdirSync('.').filter(file => /\.(html|js)$/.test(file));
  const [result] = await new PurgeCSS().purge({
    content, css: [{ raw }],
    // Runtime states, form receipts, focus and native disclosure must survive.
    safelist: { standard: [/^mobile-nav/, /^is-/, /^data-/, 'hidden', 'open', 'receipt', 'true', 'false'] },
    variables: false, keyframes: false, fontFace: false
  });
  const { code } = transform({
    filename: 'site.min.css', code: Buffer.from(result.css), minify: true,
    targets: { chrome: 100 << 16, firefox: 100 << 16, safari: 15 << 16 }
  });
  fs.writeFileSync('site.min.css', code);
  console.log(`CSS: ${Buffer.byteLength(raw)} → ${code.length} bytes (${Math.round((1-code.length/Buffer.byteLength(raw))*100)}% smaller); gzip ${gzipSync(code).length} bytes.`);
}
build().catch(error => { console.error(error); process.exitCode = 1; });
