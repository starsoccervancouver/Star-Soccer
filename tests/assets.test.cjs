const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {gzipSync}=require('node:zlib');
const {execFileSync}=require('node:child_process');
test('shared stylesheet stays within the transfer budget and preserves runtime states',()=>{
  const css=fs.readFileSync('site.min.css');
  assert(css.length<60000,'CSS must stay under 60 KB');
  assert(gzipSync(css).length<14000,'Gzip CSS must stay under 14 KB');
  for(const token of ['mobile-nav-open','data-nav-ready','is-error','[hidden]',':focus-visible','schedule-next','session-capacity','count-feed-note','@media print'])assert(css.includes(token),'Missing runtime style: '+token);
});
test('public artifact includes all routes and excludes development files',()=>{
  execFileSync(process.execPath,['scripts/stage-site.cjs']);
  const names=fs.readdirSync('_site');
  for(const name of ['node_modules','tests','scripts','README.md','package.json','styles.css'])assert(!names.includes(name),'Development file published: '+name);
  assert(!names.some(name=>name.endsWith('.png')),'Reference screenshots must not be published');
  for(const name of fs.readdirSync('.').filter(name=>name.endsWith('.html')))assert(names.includes(name),'Missing route: '+name);
  assert(fs.existsSync('_site/Star soccer/index.html'));
  assert(fs.existsSync('_site/site.min.css'));
  assert(fs.existsSync('_site/session-counts.js'));
  assert(!fs.existsSync('_site/SESSION_COUNTS.md'));
});
