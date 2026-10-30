/* Actual resource/editor components; fictional account and in-memory transport only. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
(async()=>{const browser=await chromium.launch();try{for(const [role,width] of [['coach',390],['owner',320],['owner',1280]]){
 const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>{if(route.request().url()==='https://presets.example.test/fixture')return route.fulfill({contentType:'text/html',body:'<main><div><section id="coach-drill-library"></section></div><div id="standalone-drill-library"></div></main>'});errors.push('Unexpected network');return route.abort();});
 await page.goto('https://presets.example.test/fixture');
 await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:12px}input,textarea,select{max-width:100%}label{display:block}'+fs.readFileSync('private-attendance/web/workspace-presets.css','utf8')});
 await page.evaluate(role=>{
  window.calls=[];window.fixture={profile:{email:'fixture@example.test',role},tab:'library',notes:[],sessions:[],groupSessions:[],session:null,busy:false,planReady:false};
  window.addEventListener('coach:request-context',()=>window.dispatchEvent(new CustomEvent('coach:context',{detail:window.fixture})));
  window.addEventListener('coach:library-request',event=>{const {operation,payload,resolve}=event.detail;window.calls.push({operation,payload});if(operation==='list')resolve({drills:[]});else if(operation==='save')resolve({drill:{...payload,id:'fixture-drill',author_email:'fixture@example.test',version:1,request_id:payload.requestId,updated_at:'2026-10-30T18:00:00Z'}});else throw Error('Unexpected fixture operation');});
 },role);
 for(const name of ['library','starters','presets'])await page.addScriptTag({content:fs.readFileSync('private-attendance/web/workspace-'+name+'.js','utf8')});
 await page.waitForFunction(()=>!document.querySelector('[data-preset-title]').disabled);
 assert.equal(await page.locator('.library-preset').count(),10);assert.equal(await page.locator('.preset-new').count(),3);assert.equal(await page.locator('.library-starter').count(),10,'Original collection is preserved');
 assert(await page.locator('#library-presets').evaluate(el=>el.open));
 for(const [band,count]of [['young',4],['middle',3],['older',3]]){await page.selectOption('#preset-ages',band);assert.equal(await page.locator('.library-preset:visible').count(),count);}
 await page.selectOption('#preset-phase','warmup');assert.equal(await page.locator('.library-preset:visible').count(),0);assert.match(await page.locator('#preset-results').innerText(),/No practices match/);
 await page.selectOption('#preset-ages','');await page.selectOption('#preset-phase','');
 for(let i=0;i<10;i++){
  const card=page.locator('.library-preset').nth(i);await card.locator('summary').click();
  const source=card.locator('.preset-source a');const href=await source.getAttribute('href');assert.match(href,/^https:\/\/(www\.fifatrainingcentre\.com|learn\.englandfootball\.com)\//);assert.equal(await source.getAttribute('rel'),'noopener noreferrer');
  if(i)page.once('dialog',dialog=>dialog.accept());await card.locator('button').click();
  assert.equal(await page.locator('#library-title').inputValue(),await card.locator('.preset-title').innerText());
  assert((await page.locator('#library-setup').inputValue()).includes(href),'Attribution retained for '+i);
  assert.match(await page.locator('#library-coaching').inputValue(),/Technical Intelligence:.*\nPerception:.*\nDecision Making:.*\nAsk the players:/);
  assert.match(await page.locator('#library-progression').inputValue(),/^Our suggested adaptation:/);
  assert(await page.evaluate(()=>CoachLibrary.isDirty()));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Open practice fits '+width);
  await card.locator('summary').click();
 }
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.operation==='save').length),0,'Browsing and prefill never save');
 const first=page.locator('.library-preset').first();await first.locator('summary').click();page.once('dialog',dialog=>dialog.dismiss());await first.locator('button').click();assert.equal(await page.locator('#library-title').inputValue(),'3v3 with wide support','Dirty cancellation preserves draft');
 await page.locator('#library-save').click();await page.waitForFunction(()=>document.querySelector('#library-list').textContent.includes('3v3 with wide support'));
 const writes=await page.evaluate(()=>calls.filter(c=>c.operation==='save'));assert.equal(writes.length,1);assert.match(writes[0].payload.setup,/optimising-game-application\.php/);assert.match(writes[0].payload.coaching,/Perception:/);
 await page.evaluate(()=>{fixture.busy=true;window.dispatchEvent(new CustomEvent('coach:context',{detail:fixture}));});assert(await first.locator('button').isDisabled(),'Busy editor blocks prefill');
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('coach:context',{detail:{profile:null}})));
 assert(await page.locator('#coach-drill-library').isHidden());assert.equal(await page.locator('#library-title').inputValue(),'');assert.equal(await page.locator('#preset-ages').inputValue(),'');assert.equal(await page.locator('#library-presets').evaluate(el=>el.open),false);assert(await first.locator('button').isDisabled());assert.deepEqual(errors,[]);await page.close();
 }console.log('TPD presets: 10 sourced practices + original collection, age/phase filters, source/TPD retention, draft safety, explicit save, lock/logout and 320/390/1280 layouts passed.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
