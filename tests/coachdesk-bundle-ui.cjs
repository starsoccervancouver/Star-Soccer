/* Exercise shipped bundles at the main-site path using fictional roster transport. */
const assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{const [{serveCoachAssets}]=await Promise.all([import('../private-attendance/cloudflare/coach-assets.mjs')]);const browser=await chromium.launch();try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:950}}),errors=[],requests=[];let signedIn=true;
  await context.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());requests.push(url.pathname);if(url.origin!=='https://starsoccer.ca'){errors.push('External request');return route.abort();}
   const asset=serveCoachAssets(new Request(req.url()));if(asset)return route.fulfill({status:asset.status,headers:Object.fromEntries(asset.headers),body:Buffer.from(await asset.arrayBuffer())});
   let value;if(url.pathname==='/coachdesk/api/bootstrap')value={profile:signedIn?{email:'preview@example.test',name:'Preview Coach',role:'coach',sessionVersion:1}:null,csrfToken:'preview',googleEnabled:true};
   else if(url.pathname==='/coachdesk/api/desk')value={profile:{email:'preview@example.test',name:'Preview Coach',role:'coach',sessionVersion:1},sessions:[],notes:[],tasks:[],observedAt:'2026-10-30T18:00:00Z'};
   else if(url.pathname==='/coachdesk/api/drills/list')value={drills:[]};else if(url.pathname==='/coachdesk/api/resources/list')value={resources:[]};else if(url.pathname==='/coachdesk/api/logout'){signedIn=false;value={signedOut:true};}
   else{errors.push('Unexpected request '+url.pathname);return route.abort();}return route.fulfill({status:200,json:value});
  });
  const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));await page.goto('https://starsoccer.ca/coachdesk');await page.locator('#app').waitFor({state:'visible'});
  await page.locator('#navigation [data-tab="profiles"]').click();assert.match(await page.locator('#profiles-list').innerText(),/Player profiles will appear/);
  await page.locator('#navigation [data-tab="library"]').click();await page.getByRole('tab',{name:'Inspiration',exact:true}).click();await page.getByText('Start with a useful video, article or coaching document. Save a link above.',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'Guides & kit'}).click();assert.equal(await page.getByRole('button',{name:'Copy outline',exact:true}).count(),3);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  await page.locator('#logout').click();await page.locator('#login').waitFor({state:'visible'});assert.equal(await page.locator('#google-signin-button').isVisible(),true);assert.equal(new URL(page.url()).pathname,'/coachdesk');
  assert.equal(requests.filter(path=>/desk\.[a-f0-9]+\.js$/.test(path)).length,1);assert.equal(requests.filter(path=>/desk\.[a-f0-9]+\.css$/.test(path)).length,1);assert(!requests.some(path=>path.startsWith('/workspace')));assert.deepEqual(errors,[]);
  await page.screenshot({path:'outputs/coachdesk-main-signin-'+width+'.png',fullPage:true});await context.close();
 }
 console.log('Shipped Coach Desk bundles passed desktop/mobile, new-path assets/API, resources, profiles and sign-out checks with mock data.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
