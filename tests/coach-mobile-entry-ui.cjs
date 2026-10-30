/* Phone navigation and upcoming groups, with fictional records and every request intercepted. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{chromium}=require('playwright');
const origin='https://coach-mobile.example.test',now='2026-10-30T18:00:00Z',rid=n=>'rec'+String(n).padStart(14,'0');
const profile={email:'mobile@example.test',name:'Fixture Coach',role:'owner'};
const row=(n,date,extra={})=>({id:rid(n),programId:rid(100),label:'Weekly training',date,time:'4:00–5:00 PM',location:'Fictional West Field',status:'Scheduled',capacity:20,capacityUsed:0,expected:0,players:[],counts:{},issues:[],...extra});
const sessions=[row(1,'2026-11-03'),row(2,'2026-10-30'),row(3,'2026-10-29',{status:'Completed'}),row(4,'2026-12-21',{label:'Christmas camp',time:'9:00 AM–12:00 PM'}),row(5,'2026-12-22',{label:'Christmas camp',time:'12:30–3:30 PM'}),row(6,'2026-12-28',{label:'Boxing camp'}),row(7,'2027-01-01',{label:'Boxing camp'})];
const assets={};for(const [url,file,type] of [['/workspace','workspace.html','text/html'],['/workspace/assets/workspace.js','workspace.js','text/javascript'],['/workspace/assets/workspace.css','workspace.css','text/css'],['/assets/app.css','app.css','text/css'],['/assets/logo.svg','logo.svg','image/svg+xml']])assets[url]={body:fs.readFileSync('private-attendance/web/'+file,'utf8'),type};
assets['/workspace/assets/passkeys.js']={body:'',type:'text/javascript'};require('./coach-fixture-fonts.cjs')(assets);
(async()=>{const browser=await chromium.launch();try{
 const page=await browser.newPage(),errors=[],requests=[];page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(now=>{const Base=Date;window.Date=class extends Base{constructor(...a){super(...(a.length?a:[now]));}static now(){return Base.parse(now);}};},now);
 await page.route('**/*',async route=>{const url=new URL(route.request().url()),p=url.pathname;if(url.origin!==origin){errors.push('External request: '+url);return route.abort();}if(assets[p])return route.fulfill({contentType:assets[p].type,body:assets[p].body});requests.push(p);let value;
  if(p.endsWith('/bootstrap'))value={profile,csrfToken:'fixture',googleEnabled:true};else if(p.endsWith('/desk'))value={profile,sessions,notes:[],tasks:[],observedAt:now};else if(p.endsWith('/session'))value={plan:{version:0,content:{}}};else if(p.endsWith('/diagrams/list'))value={diagrams:[]};else if(p.endsWith('/drills/list'))value={drills:[]};else{errors.push('Unexpected request: '+p);return route.abort();}return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});});
 for(const width of [390,320]){
  await page.setViewportSize({width,height:844});await page.goto(origin+'/workspace');const home=page.locator('#coaching-hub'),cue=home.locator('[data-view-action="continue-group"]');await cue.waitFor();await page.evaluate(()=>document.fonts.ready);
  assert.equal(await cue.getAttribute('data-next-session-id'),rid(2),'Friday is next before Tuesday');
  assert.match(await home.locator(':scope > .coaching-agenda .coaching-agenda-row').first().innerText(),/Friday/);
  assert.equal(await home.locator(':scope > .coaching-agenda .coaching-agenda-row').count(),3,'Archived Thursday remains reachable');
  assert.equal(await home.locator('.coach-camps-section .coaching-agenda-row').count(),2,'Camps remain two grouped weeks');
  assert(await cue.evaluate(el=>el.getBoundingClientRect().bottom<=844),'Continue next group is entirely above the fold at '+width);
  assert(await page.locator('#home-stats').evaluate(el=>el.getBoundingClientRect().height<100),'Summary stays compact at '+width);
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow at '+width);
  assert(await page.locator('#navigation').evaluate(el=>el.scrollWidth<=el.clientWidth),'No hidden horizontal navigation at '+width);
  assert(await page.locator('#navigation [data-tab="plan"]').isVisible());assert(await page.locator('#navigation [data-tab="library"]').isHidden());
  await page.locator('.desk-nav-more').click();for(const tab of ['profiles','library','settings'])assert(await page.locator('#navigation [data-tab="'+tab+'"]').isVisible());
  await page.keyboard.press('Escape');assert(await page.locator('#navigation [data-tab="library"]').isHidden());
  await page.locator('.desk-nav-more').click();await page.locator('#navigation [data-tab="settings"]').click();assert(await page.locator('#panel-settings').isVisible());assert.equal(await page.locator('.desk-nav-more').getAttribute('aria-expanded'),'false');
  await page.locator('#navigation [data-tab="home"]').click();await page.evaluate(()=>scrollTo(0,0));
  if(process.env.COACH_MOBILE_SCREENSHOT_DIR){fs.mkdirSync(process.env.COACH_MOBILE_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.COACH_MOBILE_SCREENSHOT_DIR,'overview-'+width+'.png'),fullPage:true});}
  await cue.click();assert(await page.locator('body').evaluate(el=>el.classList.contains('planner-focus-mode')));assert.equal(await page.locator('#session').inputValue(),rid(2));
  assert.equal((await page.locator('.planner-focus-heading').innerText()).match(/Fictional West Field/g)?.length,1,'Venue appears once in session heading');
  assert(await page.locator('#planner-back').isVisible());assert(await page.locator('#planner-home').isVisible());await page.locator('#planner-back').click();assert(await page.locator('#planner-session-browser').isVisible());
 }
 assert.deepEqual(errors,[]);assert(requests.every(p=>/\/(bootstrap|desk|session|diagrams\/list|drills\/list)$/.test(p)),'Only fixture reads were requested');
 console.log('Mobile entry passed: 390/320 above-fold Continue, compact stats, More navigation, Friday ordering, archived groups, two camp weeks, full-screen Back/Home; no live traffic or business writes.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
