const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=file=>fs.readFileSync(file,'utf8');
const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(([,key,value])=>[key,value.replace(/&amp;/g,'&')]));
const matchesWidth=(media,width)=>[...media.matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)].every(([,bound,value])=>bound==='max'?width<=Number(value):width>=Number(value));

test('homepage discovers one responsive hero eagerly and keeps both crop families within budget',()=>{
  const html=read('index.html');
  const picture=html.match(/<picture class="home-training-photo">([\s\S]*?)<\/picture>/)?.[1];
  assert(picture,'Hero must be discoverable in HTML without waiting for CSS or JavaScript');
  const img=attributes(picture.match(/<img\b[^>]*>/)[0]);
  assert.equal(img.fetchpriority,'high');
  assert.notEqual(img.loading,'lazy');
  assert(Number(img.width)>0&&Number(img.height)>0,'Reserve the image dimensions');
  const preloads=[...html.matchAll(/<link\b[^>]*>/g)].map(m=>attributes(m[0])).filter(t=>t.rel==='preload'&&t.as==='image');
  assert.equal(preloads.length,0,'HTML picture selection must not compete with obsolete stock-photo preloads');
  const sources=[...picture.matchAll(/<source\b[^>]*>/g)].map(m=>attributes(m[0]));
  const credits=JSON.parse(read('site-photos/credits.json')).assets;
  for(const width of [320,390,600,700,701,900,1440,1920])for(const dpr of [1,2,3]){
    const source=sources.find(s=>s.type==='image/avif'&&matchesWidth(s.media||'',width));
    assert(source,'AVIF source missing at '+width+'px');
    assert.equal(source.sizes,'100vw');
    const candidates=source.srcset.split(',').map(s=>{const [file,w]=s.trim().split(/\s+/);return {file,width:parseInt(w,10)}});
    const selected=candidates.find(c=>c.width>=width*dpr)||candidates.at(-1);
    assert(selected.file.includes(width<=700?'home-mobile-':'home-wide-'),'Use the device-specific crop');
    assert(selected.width<=(width<=700?800:1920),'Limit source resolution');
    assert(fs.statSync(selected.file).size<(width<=700?70000:180000),'Keep hero bytes bounded even on high-density screens');
    assert(credits.find(c=>c.file===selected.file)?.source.includes('DSC03269.jpg'),'Keep the owner-approved photograph');
  }
  assert(sources.some(s=>s.type==='image/webp'),'Keep a WebP fallback');
  assert(fs.existsSync(img.src));
});
