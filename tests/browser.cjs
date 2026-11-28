/* CI runner for the same harness available manually at /tests/browser.html. */
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const T=require('../training.js');
const columns=['Date','Group','Players','Capacity','Places remaining','Session status'];
const countRows=T.catalog.sessions.flatMap(s=>Array.from({length:8},(_,i)=>{
  const players=({wednesday:2,friday:3})[s.id]||0;
  return {c:[T.addDays(T.nextDate(s),7*i),s.id,players,20,20-players,'Planning'].map(v=>({v}))};
}));
const countFixture='/*O_o*/\ngoogle.visualization.Query.setResponse('+JSON.stringify({status:'ok',table:{cols:columns.map(label=>({label})),rows:countRows}})+');';
const root=path.resolve(__dirname,'..');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.avif':'image/avif','.webp':'image/webp'};
const server=http.createServer((req,res)=>{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(err,data)=>{if(err){res.writeHead(404).end();return;}res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);});
});

async function checkPublicHover(browser,desktop,base){
  const fill='rgba(121, 191, 255, 0.12)';
  const surface=locator=>locator.evaluate(el=>{
    const style=getComputedStyle(el);
    return {shadow:style.boxShadow,fill:style.backgroundColor,image:style.backgroundImage,color:style.color};
  });
  await desktop.goto(base+'/index.html');
  const logo=desktop.getByRole('link',{name:'Star Soccer home'});
  const logoSurface=await surface(logo);
  await logo.hover();
  assert.deepEqual(await surface(logo),logoSurface,'Header logo has no pointer highlight');
  const desktopLogo=await logo.locator('img').boundingBox();
  assert(desktopLogo.x<=12 && desktopLogo.width===200,'Desktop logo is larger and left-aligned');
  await logo.focus();await desktop.keyboard.press('Tab');await desktop.keyboard.press('Shift+Tab');
  assert(await logo.evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el).outlineStyle!=='none'),'Header logo keeps visible keyboard focus');
  const navLink=desktop.locator('.site-nav a[href="camps.html"]');
  const underline=link=>link.evaluate(el=>{
    const style=getComputedStyle(el,'::after');
    return {color:style.backgroundColor,opacity:style.opacity,name:style.animationName,iterations:style.animationIterationCount};
  });
  const navSurface=await surface(navLink);
  assert.equal((await underline(navLink)).opacity,'0','Inactive navigation starts without an underline');
  await navLink.hover();
  assert.deepEqual(await surface(navLink),navSurface,'Hovering navigation does not tint the background');
  assert.deepEqual(await underline(navLink),{color:'rgb(0, 157, 255)',opacity:'1',name:'nav-underline-pulse',iterations:'1'},'The blue underline pulses once per hover');
  assert(await navLink.evaluate(el=>{
    const pulse=el.getAnimations({subtree:true}).find(animation=>animation.animationName==='nav-underline-pulse');
    const frames=pulse?.effect.getKeyframes();
    const line=getComputedStyle(el,'::after');
    return frames?.[0].transform==='scaleX(0)' && frames.at(-1).transform==='scaleX(1)' &&
      Math.abs(parseFloat(line.transformOrigin)-parseFloat(line.width)/2)<1;
  }),'The electric-blue underline grows from the center to full width');
  const hero=desktop.locator('.hero-action-camps');
  await hero.hover();
  await desktop.waitForFunction(fill=>getComputedStyle(document.querySelector('.hero-action-camps')).boxShadow.includes(fill),fill);
  assert.equal((await underline(navLink)).opacity,'0','The hovered underline clears when the pointer leaves');
  await hero.focus();await desktop.keyboard.press('Tab');await desktop.keyboard.press('Shift+Tab');
  assert(await hero.evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el).outlineStyle!=='none'),'Keyboard focus remains visible');
  await desktop.goto(base+'/locations.html');
  const current=desktop.locator('.site-nav .active').first(),currentSurface=await surface(current);
  const otherTab=desktop.locator('.site-nav a:not([aria-current])').first();
  assert.equal(currentSurface.fill,(await surface(otherTab)).fill,'Current navigation has no background highlight');
  assert.equal((await underline(current)).opacity,'1','The current page has a visible blue underline');
  await current.hover();assert.deepEqual(await surface(current),currentSurface,'Hover leaves the current tab background alone');
  await desktop.emulateMedia({reducedMotion:'reduce'});
  assert.equal((await underline(current)).name,'none','Reduced motion keeps the underline static');
  await desktop.emulateMedia({reducedMotion:'no-preference'});
  await current.focus();await desktop.keyboard.press('Tab');await desktop.keyboard.press('Shift+Tab');
  assert(await current.evaluate(el=>el.matches(':focus-visible')&&getComputedStyle(el).outlineStyle==='solid'),'Current navigation keeps visible keyboard focus');
  await desktop.goto(base+'/registration.html?sessionId=wednesday&type=dropin');
  const submit=desktop.locator('button[type=submit]').first();
  await submit.evaluate(el=>{el.disabled=true;});const disabledSurface=await surface(submit);
  await submit.hover({force:true});assert.deepEqual(await surface(submit),disabledSurface,'Disabled controls retain their state');

  await desktop.goto(base+'/registration.html?sessionId=wednesday&type=pass4');
  await desktop.locator('#pass-calendar-trigger').click();
  const selectedDay=desktop.locator('#pass-calendar [aria-selected=true] button');
  const selectedDaySurface=await surface(selectedDay);
  await selectedDay.hover();
  assert.equal((await surface(selectedDay)).fill,selectedDaySurface.fill,'Pass calendar keeps the selected date colour');
  const unavailable=desktop.locator('#pass-calendar .pass-calendar-day:disabled').first();
  await unavailable.hover({force:true});
  assert(!(await surface(unavailable)).image.includes(fill),'Unavailable calendar days do not get the pointer tint');

  const touch=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true});
  try{
    await touch.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
    const page=await touch.newPage();await page.goto(base+'/index.html');
    const mobileLogo=await page.getByRole('link',{name:'Star Soccer home'}).locator('img').boundingBox();
    assert(mobileLogo.x<=6 && mobileLogo.width>=108,'Mobile logo is larger and left-aligned');
    const link=page.locator('.hero-action-camps'),rest=await surface(link);
    await link.hover();assert.deepEqual(await surface(link),rest,'Touch-only devices do not get sticky pointer highlighting');
  }finally{await touch.close();}
}
async function checkFootballNews(page, base) {
  // At 01:00 UTC it is still November 27 in Vancouver.
  await page.clock.setFixedTime(new Date('2026-11-28T01:00:00Z'));
  const url='https://example.com/';
  const checkedAt='2026-11-28T00:00:00Z';
  const barcaHighlight='https://www.uefa.com/uefachampionsleague/video/02ab-222871ca3407-ab3f8f54d19d-1000/';
  const barcaThumbnail='https://editorial.uefa.com/resources/02ab-222871ca3406-f80aec914f45-1000/format/wide1/sabah-barcelona_hl_-_facebook.jpeg';
  const uefaHighlight='https://www.uefa.com/uefachampionsleague/video/02ab-2228984630a6-db8bc83542cb-1000/';
  const uefaThumbnail='https://editorial.uefa.com/resources/02ab-2228984630a5-647331bf682b-1000/format/wide1/psg-roma.jpeg';
  const otherHighlight='https://www.uefa.com/uefachampionsleague/video/02ab-2228bc00c56a-d1df30a90905-1000/';
  const otherThumbnail='https://editorial.uefa.com/resources/02ab-2228bc00c569-748e620c9c7e-1000/format/wide1/inter-stuttgart.jpeg';
  const video={youtubeId:'abcdefghijk'};
  const game={date:'2026-11-22',goals:[2,0],competition:'League',source:'Test feed',url};
  const payload={version:1,sources:{
    whitecaps:{kind:'results',checkedAt,items:[
      {...game,home:'Vancouver Whitecaps',away:'Real Salt Lake',...video},
      {...game,home:'Old result',away:'Old visitor',date:'2026-11-20',...video},
      {...game,home:'Future result',away:'Future visitor',date:'2026-11-28',...video},
    ]},
    'la-liga':{kind:'results',checkedAt,items:[
      {...game,home:'Barcelona',away:'Villarreal',goals:[3,2],competition:'La Liga',...video},
    ]},
    'champions-league':{kind:'results',checkedAt,items:[
      {...game,home:'Sabah',away:'FC Barcelona',goals:[1,4],date:'2026-11-25',competition:'Champions League',
        highlightUrl:barcaHighlight,highlightThumbnail:barcaThumbnail},
      {...game,home:'Paris St. Germain',away:'AS Rom',goals:[2,2],competition:'Champions League',
        highlightUrl:uefaHighlight,highlightThumbnail:uefaThumbnail},
      {...game,home:'Inter Mailand',away:'VfB Stuttgart',goals:[2,0],competition:'Champions League',
        highlightUrl:otherHighlight,highlightThumbnail:otherThumbnail},
    ]},
    'premier-league':{kind:'results',checkedAt,items:[
      {...game,home:'Liverpool',away:'Manchester United',goals:[4,0],competition:'Premier League',...video},
      {...game,home:'Tottenham Hotspur',away:'Ipswich Town',competition:'Premier League',
        espnVideoUrl:'https://www.espn.com/video/clip/_/id/123456/tottenham-ipswich-highlights',
        espnThumbnail:'https://espnmedia-cdn.akamaized.net/espn/media/common/tottenham.jpg',
        espnVideoKind:'highlights',espnExpiresAt:'2027-03-25T00:00:00Z'},
      {...game,home:'No media',away:'No picture',competition:'Premier League'},
    ]},
    'serie-a':{kind:'results',checkedAt,items:[
      {...game,home:'Atalanta',away:'Inter Milan',goals:[4,4],competition:'Serie A',...video},
    ]},
    'ligue-1':{kind:'results',checkedAt,items:[
      {...game,home:'Paris Saint-Germain',away:'Marseille',competition:'Ligue 1',youtubeId:'psgfixture1'},
    ]},
    'international-men':{kind:'results',checkedAt,items:[
      {...game,home:'Canada',away:'Guatemala',date:'2026-11-16',...video},
    ]},
  }};
  let blockParisImage=false;
  const pixel='<svg xmlns="http://www.w3.org/2000/svg" width="16" height="9"/>';
  await page.route('**/football-news.json', route=>route.fulfill({json:payload}));
  await page.route('https://i.ytimg.com/**', route=>
    blockParisImage && route.request().url().includes('/psgfixture1/')
      ? route.abort()
      : route.fulfill({contentType:'image/svg+xml',body:pixel}));
  await page.route('https://espnmedia-cdn.akamaized.net/**', route=>route.fulfill({contentType:'image/svg+xml',body:pixel}));
  await page.route('https://editorial.uefa.com/**', route=>
    blockParisImage && route.request().url()===uefaThumbnail
      ? route.abort()
      : route.fulfill({contentType:'image/svg+xml',body:pixel}));
  await page.goto(base+'/index.html');
  const section=page.getByRole('region',{name:'Football News'});
  const cards=section.getByRole('article');
  await cards.first().waitFor();
  await section.scrollIntoViewIfNeeded();
  await cards.locator('img').evaluateAll(images=>images.forEach(image=>{image.loading='eager';}));
  await page.waitForFunction(()=>[...document.querySelectorAll('#football-news .football-story img')]
    .every(image=>image.complete && image.naturalWidth>0));
  assert.equal(await cards.count(),5,'The grid displays five matches with images');
  assert.equal(await section.getByRole('tab').count(),0,'The story grid does not create subtabs');
  const titles=await cards.getByRole('heading').allTextContents();
  assert.deepEqual(titles,[
    'Whitecaps open the playoffs with a 2–0 win',
    'Barcelona beat Sabah 4–1',
    'Paris Saint-Germain and Roma draw 2–2',
    'Atalanta rescue a 4–4 draw against Inter',
    'Liverpool put four past Manchester United',
  ],'Whitecaps, Barcelona, Champions League and two other big matches have no repeated team');
  assert.equal(await cards.nth(1).getByRole('link',{name:/Watch highlights on UEFA/}).getAttribute('href'),barcaHighlight);
  assert.equal(await cards.nth(1).locator('img').getAttribute('src'),barcaThumbnail);
  assert.equal(await cards.nth(2).getByRole('link',{name:/Watch highlights on UEFA/}).getAttribute('href'),uefaHighlight);
  assert.equal(await cards.nth(2).locator('img').getAttribute('src'),uefaThumbnail);
  assert.equal(await section.getByText(/Old result|Future result|Canada beat|No media|Villarreal/).count(),0,
    'Expired, future, duplicate-team and imageless items are omitted');

  blockParisImage=true;
  await page.reload();
  await section.scrollIntoViewIfNeeded();
  await cards.locator('img').evaluateAll(images=>images.forEach(image=>{image.loading='eager';}));
  await page.waitForFunction(()=>document.querySelectorAll('#football-news .football-story').length===5 &&
    !document.querySelector('#football-news .football-story h3')?.textContent.includes('Paris') &&
    ![...document.querySelectorAll('#football-news .football-story h3')].some(h=>h.textContent.includes('Paris')) &&
    [...document.querySelectorAll('#football-news .football-story img')].every(image=>image.complete && image.naturalWidth>0));
  const afterFailure=await cards.getByRole('heading').allTextContents();
  assert(afterFailure.some(title=>title.includes('Stuttgart')),'Another match replaces a card with an unavailable image');
  assert.equal(afterFailure.filter(title=>title.includes('Inter')).length,1,'Team deduplication still applies after image failure');
  const espn=section.getByRole('link',{name:/Watch highlights on ESPN/});
  assert.equal(await espn.count(),1,'The verified ESPN match video fills another card');
  assert.equal(await espn.getAttribute('href'),'https://www.espn.com/video/clip/_/id/123456/tottenham-ipswich-highlights');
  assert.equal(await espn.locator('xpath=ancestor::article').locator('img').getAttribute('src'),
    'https://espnmedia-cdn.akamaized.net/espn/media/common/tottenham.jpg');
}


(async()=>{
  let browser;
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch();
    const page=await browser.newPage();
    // CI uses fallback fonts and no external network; form tests cannot send email.
    await page.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='127.0.0.1')return route.continue();
      if(url.hostname==='docs.google.com' && url.pathname==='/spreadsheets/d/1xnSKoG20G9P-OcESiUv71IPOSYdEGfU6CLm38xcnSmA/gviz/tq')return route.fulfill({contentType:'application/javascript',body:countFixture,headers:{'Access-Control-Allow-Origin':'*'}});
      return route.abort();
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/browser.html`);
    await page.locator('body[data-result]').waitFor({timeout:120000});
    console.log(await page.locator('#status').textContent());
    const failures=await page.locator('.fail').allTextContents();
    if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}
    else {
      await checkPublicHover(browser,page,'http://127.0.0.1:'+server.address().port);
      console.log('Public hover, selection, keyboard and touch checks passed');
      await checkFootballNews(page,'http://127.0.0.1:'+server.address().port);
      console.log('Football news cards, media links, and seven-day Vancouver date window passed');
      await require('./pro-d-camp.cjs')();console.log('Pro-D camp mocked submission checks passed');
    }
  } finally {if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
