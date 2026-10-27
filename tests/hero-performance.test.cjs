const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const read=file=>fs.readFileSync(file,'utf8');
const attributes=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map(([,key,value])=>[key,value.replace(/&amp;/g,'&')]));
const matchesWidth=(media,width)=>[...media.matchAll(/\((min|max)-width:\s*([\d.]+)px\)/g)].every(([,bound,value])=>bound==='max'?width<=Number(value):width>=Number(value));

// Read the cascade, including nested media blocks, so a preload cannot quietly
// diverge from the image CSS actually selects at the navigation breakpoint.
function heroBackgrounds(css,media='') {
  const rules=[];
  css=css.replace(/\/\*[\s\S]*?\*\//g,'');
  for(let position=0;position<css.length;) {
    const open=css.indexOf('{',position);
    if(open<0)break;
    let end=open+1,depth=1;
    while(end<css.length&&depth) {if(css[end]==='{')depth++;if(css[end]==='}')depth--;end++;}
    const selector=css.slice(position,open).trim(),body=css.slice(open+1,end-1);
    if(selector.startsWith('@media'))rules.push(...heroBackgrounds(body,media+' '+selector));
    else if(selector.split(',').some(value=>['.immersive-hero','body.home-landing .immersive-hero'].includes(value.trim()))) {
      const url=body.match(/url\(["']?(https:\/\/images\.unsplash\.com\/[^"')]+)["']?\)/)?.[1];
      if(url)rules.push({media,url});
    }
    position=end;
  }
  return rules;
}

test('homepage preloads exactly the hero image selected by the CSS at each breakpoint',()=>{
  const preloads=[...read('index.html').matchAll(/<link\b[^>]*>/g)].map(match=>attributes(match[0])).filter(tag=>tag.rel==='preload'&&tag.as==='image');
  const backgrounds=[...heroBackgrounds(read('styles.css')),...heroBackgrounds(read('homepage-conversion.css'))];
  for(const width of [320,390,600,601,700,900,901,1050,1440,1920]) {
    const selected=backgrounds.filter(rule=>matchesWidth(rule.media,width)).at(-1);
    assert(selected,'Missing homepage hero at '+width+'px');
    const preload=preloads.filter(tag=>matchesWidth(tag.media||'',width));
    assert.equal(preload.length,1,'Exactly one hero should be preloaded at '+width+'px');
    assert.equal(preload[0].href,selected.url,'Preload mismatch downloads an extra image at '+width+'px');
    assert.equal(preload[0].fetchpriority,'high','The visible hero must retain priority');
    const image=new URL(selected.url);
    assert.equal(image.pathname,'/photo-1517466787929-bc90951d0974','Keep the approved hero photograph');
    assert.equal(image.searchParams.get('w'),width<=900?'800':'1600','Avoid oversized mobile images');
    assert.equal(image.searchParams.get('auto'),'format','Retain format negotiation');
  }
});
