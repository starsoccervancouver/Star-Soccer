const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const origin='https://starsoccer.ca';
const read=name=>fs.readFileSync(name,'utf8');
const decode=value=>value.replace(/&(?:amp|quot|apos|lt|gt|#(\d+)|#x([\da-f]+));/gi,(whole,decimal,hex)=>decimal?String.fromCodePoint(Number(decimal)):hex?String.fromCodePoint(parseInt(hex,16)):({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[whole.toLowerCase()]));
const attrs=tag=>Object.fromEntries([...tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([,key,double,single])=>[key.toLowerCase(),decode(double??single)]));
const tags=(source,name)=>[...source.matchAll(new RegExp('<'+name+'\\b[^>]*>','gi'))].map(match=>attrs(match[0]));
const meta=(source,key)=>tags(source,'meta').find(tag=>(tag.name||tag.property)===key)?.content;
const canonical=source=>tags(source,'link').find(tag=>tag.rel==='canonical')?.href;
const fullPages=fs.readdirSync('.').filter(name=>name.endsWith('.html')&&!read(name).includes('data-redirect='));

test('sitemap lists canonical, indexable landing pages and keeps registration actions out of search',()=>{
  const urls=[...read('sitemap.xml').matchAll(/<loc>(.*?)<\/loc>/g)].map(match=>decode(match[1]));
  assert(urls.length>0);assert.equal(new Set(urls).size,urls.length,'Sitemap duplicates a URL');
  for(const url of urls){
    const parsed=new URL(url);assert.equal(parsed.origin,origin);assert.equal(parsed.search,'');assert.equal(parsed.hash,'');
    const file=parsed.pathname==='/'?'index.html':parsed.pathname.slice(1);
    const source=read(file);
    assert.equal(canonical(source),url,file+' canonical must match sitemap');
    assert(!/noindex/i.test(meta(source,'robots')||''),file+' should be indexable');
    assert(!source.includes('data-redirect='),file+' is a retired route');
  }
  for(const file of ['registration.html','christmas-camp-registration.html','boxing-camp-registration.html','registration-thank-you.html']){
    assert.match(meta(read(file),'robots')||'',/\bnoindex\b/,file+' action must stay out of search');
    assert(!urls.includes(origin+'/'+file),file+' must not appear in sitemap');
  }
});

test('each full page connects accurate organization, website and page identities to its canonical URL',()=>{
  const svg=attrs(read('logo-star-soccer-minimalized.svg').match(/<svg\b[^>]*>/)[0]);
  for(const file of fullPages){
    const source=read(file),url=canonical(source);
    const scripts=[...source.matchAll(/<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)];
    assert.equal(scripts.length,1,file+' needs one unambiguous graph');
    const data=JSON.parse(scripts[0][1]);assert.equal(data['@context'],'https://schema.org');
    const graph=data['@graph'];assert(Array.isArray(graph));
    assert.equal(new Set(graph.map(node=>node['@id'])).size,graph.length,file+' has duplicate node IDs');
    const organization=graph.find(node=>node['@type']==='SportsOrganization');
    const website=graph.find(node=>node['@type']==='WebSite');
    const page=graph.find(node=>node['@type']==='WebPage');
    assert.equal(organization['@id'],origin+'/#organization');assert.equal(organization.url,origin+'/');
    assert.equal(website['@id'],origin+'/#website');assert.equal(website.url,origin+'/');
    assert.equal(website.publisher['@id'],organization['@id']);
    assert.equal(page['@id'],url+'#webpage');assert.equal(page.url,url);
    assert.equal(page.isPartOf['@id'],website['@id']);assert.equal(page.about['@id'],organization['@id']);
    assert.equal(page.description,meta(source,'description'),file+' schema description must not be truncated');
    assert(page.description.length>30,file+' needs a useful description');
    assert.equal(organization.logo.url,origin+'/logo-star-soccer-minimalized.svg');
    assert.equal(organization.logo.width,Number(svg.width));assert.equal(organization.logo.height,Number(svg.height));
  }
});

function jpegSize(buffer){
  assert.equal(buffer.readUInt16BE(0),0xffd8,'Expected a JPEG');
  for(let offset=2;offset<buffer.length;){
    assert.equal(buffer[offset++],0xff,'Invalid JPEG segment');
    while(buffer[offset]===0xff)offset++;
    const marker=buffer[offset++];
    if(marker===0xd9||marker===0xda)break;
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    const length=buffer.readUInt16BE(offset);assert(length>=2);
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {height:buffer.readUInt16BE(offset+3),width:buffer.readUInt16BE(offset+5)};
    offset+=length;
  }
  throw new Error('JPEG has no dimensions');
}

test('share metadata points to the real 1200 by 630 branded image',()=>{
  const image=fs.readFileSync('star-soccer-social.jpg');
  assert.deepEqual(jpegSize(image),{width:1200,height:630});
  assert(image.length<250000,'Share graphic transfer budget is 250 KB');
  for(const file of fullPages){
    const source=read(file);
    assert.equal(meta(source,'og:image'),origin+'/star-soccer-social.jpg',file);
    assert.equal(meta(source,'twitter:image'),meta(source,'og:image'),file);
    assert.equal(meta(source,'og:image:width'),'1200');assert.equal(meta(source,'og:image:height'),'630');
    assert(meta(source,'og:image:alt')?.length>10);assert.equal(meta(source,'twitter:card'),'summary_large_image');
  }
});

test('campaign context initializes once before any form handler on every maintained full page',()=>{
  for(const file of fullPages){
    const scripts=tags(read(file),'script').filter(tag=>tag.src);
    const positions=scripts.map((tag,index)=>tag.src.startsWith('campaign-source.js')?index:-1).filter(index=>index>=0);
    assert.equal(positions.length,1,file+' needs exactly one campaign loader');
    const campaign=positions[0];
    // Defer is a boolean HTML attribute and is inspected from the original start tag.
    assert.match(read(file),/<script\b[^>]*src="campaign-source\.js[^\"]*"[^>]*\bdefer\b/i,file);
    for(let index=0;index<scripts.length;index++)if(/^(booking|weekly-signup-form|camp-booking)\.js(?:\?|$)/.test(scripts[index].src))assert(campaign<index,file+' must initialize attribution before handlers');
  }
});

test('retired home aliases preserve query and fragment while resolving to the canonical root',()=>{
  for(const file of ['about.html','Star soccer/index.html']){
    const source=read(file);assert.equal(canonical(source),origin+'/');
    assert.match(source,/<body\b[^>]*data-redirect="\/"/);
    assert.match(meta(source,'robots')||'',/noindex/);
  }
  const replacements=[];
  vm.runInNewContext(read('legacy-redirect.js'),{document:{body:{dataset:{redirect:'/'}}},location:{search:'?utm_source=school',hash:'#sessions',replace:value=>replacements.push(value)}});
  assert.deepEqual(replacements,['/?utm_source=school#sessions']);
});
