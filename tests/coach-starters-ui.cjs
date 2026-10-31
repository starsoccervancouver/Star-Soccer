/* Original starter ideas exercise the real editor with an isolated in-memory transport. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch();try{for(const [role,width] of [['coach',390],['owner',320]]){
 const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>{if(route.request().url()==='https://starters.example.test/fixture')return route.fulfill({contentType:'text/html',body:'<main><div><section id="coach-drill-library"></section></div><div id="standalone-drill-library"></div></main>'});errors.push('Unexpected network');return route.abort();});
 await page.goto('https://starters.example.test/fixture');
 await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:12px}input,textarea,select{max-width:100%}label{display:block}'+fs.readFileSync('private-attendance/web/workspace-library.css','utf8')+fs.readFileSync('private-attendance/web/workspace-starters.css','utf8')});
 await page.evaluate(role=>{
  window.calls=[];window.fixture={profile:{email:'fixture@example.test',role},tab:'library',notes:[],sessions:[],groupSessions:[],session:null,busy:false,planReady:false};
  window.addEventListener('coach:request-context',()=>window.dispatchEvent(new CustomEvent('coach:context',{detail:window.fixture})));
  window.addEventListener('coach:library-request',event=>{const {operation,payload,resolve}=event.detail;window.calls.push({operation,payload});if(operation==='list')resolve({drills:[]});else if(operation==='save')resolve({drill:{...payload,id:'fixture-drill',author_email:'fixture@example.test',version:1,request_id:payload.requestId,updated_at:'2026-10-30T18:00:00Z'}});else throw Error('Unexpected fixture operation');});
 },role);
 await page.addScriptTag({content:fs.readFileSync('private-attendance/web/workspace-library.js','utf8')});
 await page.addScriptTag({content:fs.readFileSync('private-attendance/web/workspace-starters.js','utf8')});
 await page.waitForFunction(()=>!document.querySelector('[data-starter-title]').disabled);
 await page.selectOption('#library-source-filter','starter');await page.locator('#library-more').click();assert.equal(await page.locator('.library-starter').count(),10);assert.equal(await page.locator('.library-starter svg').count(),10);
 const cards=page.locator('.library-starter');for(let i=0;i<10;i++){const text=await cards.nth(i).textContent();assert.match(text,/Ages \d+–\d+/);assert.match(text,/players/);assert.match(text,/Equipment:/);}
 await cards.first().locator('summary').click();await cards.first().locator('[data-starter-title]').click();
 assert(await page.locator('#library-form').isVisible());assert.equal(await page.locator('#library-title').inputValue(),'Island parking (variation)');assert.match(await page.locator('#library-setup').inputValue(),/Ages 5–8; 4–12 players/);assert(await page.evaluate(()=>CoachLibrary.isDirty()));
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.operation==='save').length),0,'Preview and Use as draft never save');
 await cards.nth(1).locator('summary').click();page.once('dialog',dialog=>dialog.dismiss());await cards.nth(1).locator('[data-starter-title]').click();assert.equal(await page.locator('#library-title').inputValue(),'Island parking (variation)','Cancelling keeps the existing draft');
 page.once('dialog',dialog=>dialog.accept());await cards.nth(1).locator('[data-starter-title]').click();assert.equal(await page.locator('#library-title').inputValue(),'Mirror the leader (variation)');
 await page.locator('#library-save').click();await page.waitForFunction(()=>!CoachLibrary.isBusy()&&!CoachLibrary.isDirty());
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.operation==='save').length),1);assert.equal(await page.locator('#library-source-filter').inputValue(),'saved','Saved variations open the private library');await page.selectOption('#library-source-filter','starter');await page.locator('#library-more').click();assert.equal(await page.locator('.library-starter').count(),10,'Collection remains available with saved drills');assert.equal(await page.evaluate(()=>CoachLibrary.isDirty()),false);
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Starter cards fit '+width);
 await page.evaluate(()=>{window.dispatchEvent(new CustomEvent('coach:context',{detail:{profile:null}}));window.dispatchEvent(new CustomEvent('coach:library-prefill',{detail:{source:'starter',drill:{title:'Should not open',setup:'No permission',target:'warmup',minutes:8}}}));});
 assert(await page.locator('#coach-drill-library').isHidden());assert.equal(await page.locator('#library-title').inputValue(),'');assert.deepEqual(errors,[]);await page.close();
 }console.log('Starter drills passed for coach/owner: ten previews, age/player/equipment metadata, safe dirty replacement, explicit-save-only persistence, empty/populated library, 390/320 fit and logout isolation.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
