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
  assert.deepEqual(await underline(navLink),{color:'rgb(141, 198, 255)',opacity:'1',name:'nav-underline-pulse',iterations:'1'},'The blue underline pulses once per hover');
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
      await require('./pro-d-camp.cjs')();console.log('Pro-D camp mocked submission checks passed');
    }
  } finally {if(browser)await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
