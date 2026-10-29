const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('every shared public footer provides one Coach Desk link without JavaScript',()=>{
  const pages=fs.readdirSync(root).filter(file=>file.endsWith('.html')&&read(file).includes('class="home-contact-footer"'));
  assert(pages.length>=12,'Expected the primary public pages and registration pages');
  for(const file of pages){
    const footer=read(file).match(/<footer\b[^>]*class="home-contact-footer"[^>]*>[\s\S]*?<\/footer>/)?.[0];
    assert(footer,file+' needs its shared footer');
    const links=[...footer.matchAll(/<a\b[^>]*href="coach\.html"[^>]*>([\s\S]*?)<\/a>/g)];
    assert.equal(links.length,1,file+' needs exactly one static coach link');
    assert.equal(links[0][1],'Coach Desk',file+' uses a consistent label');
  }
});

test('coach entry describes Google sign-in and keeps access private',()=>{
  const source=read('coach.html');
  assert.match(source,/<meta name="robots" content="noindex,nofollow">/);
  assert.match(source,/<a class="button" href="https:\/\/attendance\.starsoccer\.ca\/workspace">/);
  assert.match(source,/Continue with Google using your approved account\./);
  assert.match(source,/Access is limited to approved coaches\./);
  assert.doesNotMatch(source,/Use the passkey|setup=|token=|secret=/i);
});
