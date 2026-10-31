const assert = require('node:assert/strict'), fs = require('node:fs'), { chromium } = require('playwright');
(async () => {
  const { validateDiagram } = await import('../private-attendance/tactics-validation.mjs');
  const browser = await chromium.launch();
  try {
    for (const [role, width] of [['coach',390],['owner',320],['owner',1280]]) {
      const page = await browser.newPage({viewport:{width,height:844}}), errors = []; page.setDefaultTimeout(6000);
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => { if (route.request().url() === 'https://presets.example.test/fixture') return route.fulfill({contentType:'text/html',body:'<main><div><section id="coach-drill-library"></section></div><div id="standalone-drill-library"></div></main>'}); errors.push('Unexpected network'); return route.abort(); });
      await page.goto('https://presets.example.test/fixture');
      await page.addStyleTag({content:'*{box-sizing:border-box}body{margin:12px}input,textarea,select{max-width:100%}label{display:block}' + ['library','presets','starters'].map(name => fs.readFileSync('private-attendance/web/workspace-'+name+'.css','utf8')).join('\n')});
      await page.evaluate(role => {
        window.calls=[]; window.additions=[]; window.saved=[]; window.failSave=false;
        window.fixture={profile:{email:'fixture@example.test',role},tab:'library',notes:[],sessions:[],groupSessions:[],session:null,busy:false,planReady:false};
        window.addEventListener('coach:request-context',()=>window.dispatchEvent(new CustomEvent('coach:context',{detail:fixture})));
        window.addEventListener('coach:insert-plan',event=>{ additions.push(structuredClone(event.detail));event.detail.inserted=true; });
        window.addEventListener('coach:library-request',event=>{const {operation,payload,resolve,reject}=event.detail;calls.push({operation,payload});if(operation==='list')resolve({drills:saved});else if(operation==='save'){if(failSave)return reject(new Error('Unverified fixture save'));const drill={...payload,id:payload.id||'fixture-drill',author_email:'fixture@example.test',version:payload.expectedVersion+1,request_id:payload.requestId,updated_at:'2026-10-30T18:00:00Z'};saved=[drill];resolve({drill});}else throw Error('Unexpected fixture operation');});
      },role);
      for(const name of ['library','starters','presets']) await page.addScriptTag({content:fs.readFileSync('private-attendance/web/workspace-'+name+'.js','utf8')});
      await page.waitForFunction(()=>!document.querySelector('#library-source-filter').disabled);
      assert.match(await page.locator('#library-results').innerText(),/8 of 20 matching drills/);
      assert.equal(await page.locator('#library-presets,#library-starters').count(),0,'All sources share one library');
      await page.selectOption('#library-source-filter','preset'); await page.locator('#library-more').click();
      assert.equal(await page.locator('.library-preset').count(),10);
      assert.equal(await page.locator('.library-preset svg').count(),10,'Every preset has an original sketch');
      assert.equal(await page.locator('[data-insert=true]:visible').count(),0,'Standalone drafts have no session insertion');
      for(const [band,count] of [['young',4],['middle',3],['older',3]]) { await page.selectOption('#library-age-filter',band); assert.equal(await page.locator('.library-preset').count(),count); }
      await page.selectOption('#library-filter','warmup'); assert.equal(await page.locator('.library-preset').count(),0); assert.match(await page.locator('#library-list').innerText(),/No drills match/);
      await page.selectOption('#library-age-filter',''); await page.selectOption('#library-filter','all');
      await page.locator('#library-search').fill('FIFA'); assert.match(await page.locator('#library-results').innerText(),/8 of 8 matching drills/);
      await page.locator('#library-search').fill(''); await page.locator('#library-more').click();
      for(let index=0;index<10;index++) {
        const card=page.locator('.library-preset').nth(index); await card.locator('summary').click();
        const source=card.locator('.preset-source a'), href=await source.getAttribute('href');
        assert.match(href,/^https:\/\/(www\.fifatrainingcentre\.com|learn\.englandfootball\.com)\//); assert.equal(await source.getAttribute('rel'),'noopener noreferrer');
        if(index)page.once('dialog',dialog=>dialog.accept()); await card.locator('[data-preset-title]').click();
        assert.equal(await page.locator('#library-title').inputValue(),(await card.locator('h3').innerText()).slice(0,68)+' (variation)'); assert((await page.locator('#library-setup').inputValue()).includes(href));
        assert.match(await page.locator('#library-coaching').inputValue(),/Technical Intelligence:.*\nPerception:.*\nDecision Making:.*\nAsk the players:/);
        assert.match(await page.locator('#library-progression').inputValue(),/^Our suggested adaptation:/); assert(await page.evaluate(()=>CoachLibrary.isDirty()));
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Open practice fits '+width); await card.locator('summary').click();
      }
      assert.equal(await page.evaluate(()=>calls.filter(call=>call.operation==='save').length),0,'Browsing and prefill never save');
      const first=page.locator('.library-preset').first(); page.once('dialog',dialog=>dialog.dismiss()); await first.locator('[data-preset-title]').click();
      assert.equal(await page.locator('#library-title').inputValue(),'3v3 with wide support (variation)','Declining replacement preserves draft');
      await page.locator('#library-save').click(); await page.waitForFunction(()=>!CoachLibrary.isBusy()&&!CoachLibrary.isDirty());
      let writes=await page.evaluate(()=>calls.filter(call=>call.operation==='save')); assert.equal(writes.length,1); assert.match(writes[0].payload.setup,/optimising-game-application\.php/); assert.match(writes[0].payload.coaching,/Perception:/); assert.equal(writes[0].payload.diagram.frames.length,1); assert.deepEqual(validateDiagram(writes[0].payload.diagram),writes[0].payload.diagram,'Sketch round-trips through the server validator');
      await page.selectOption('#library-source-filter','saved'); assert.equal(await page.locator('.library-card').count(),1); assert.match(await page.locator('.library-source-tag').innerText(),/Private saved drill/);
      await page.evaluate(()=>saved.push({...saved[0],id:'foreign-drill',title:'PRIVATE_COACH_MARKER',author_email:'another-coach@example.test'}));
      await page.locator('#library-reload').click(); await page.waitForFunction(()=>!document.querySelector('#library-reload').disabled);
      assert.equal(await page.locator('.library-card').count(),role==='owner'?2:1,'Private author restriction survives unified rendering');
      await page.selectOption('#library-source-filter','all'); await page.locator('#library-search').fill('PRIVATE_COACH_MARKER'); assert.equal(await page.locator('.library-card').count(),role==='owner'?1:0,'Search cannot expose another coach\'s private drill');
      await page.evaluate(()=>{fixture={...fixture,tab:'plan',session:{id:'fixture-session',status:'Scheduled'},planReady:true};window.dispatchEvent(new CustomEvent('coach:context',{detail:fixture}));});
      await page.locator('#library-disclosure > summary').click(); await page.waitForFunction(()=>!document.querySelector('#library-source-filter').disabled);
      await page.selectOption('#library-source-filter','preset');
      assert(await first.locator('[data-preset-title]').isEnabled(),'Preset draft works in session drawer'); assert(await first.locator('[data-insert=true]').isEnabled(),'Preset insertion works in session drawer');
      await first.locator('[data-insert=true]').click(); const addition=await page.evaluate(()=>additions.at(-1));
      assert.equal(addition.title,'Colour-cue ball control'); assert.equal(addition.minutes,8); assert.equal(addition.target,'warmup'); assert.match(addition.text,/fifatrainingcentre\.com/); assert.equal(addition.diagram.schemaVersion,1);
      assert.equal(await page.evaluate(()=>calls.filter(call=>call.operation==='save').length),1,'Insertion does not save either draft');
      await first.locator('[data-preset-title]').click(); assert.equal(await page.locator('#library-title').inputValue(),addition.title+' (variation)'); assert(await page.evaluate(()=>CoachLibrary.isDirty()));
      await page.evaluate(()=>{fixture.busy=true;window.dispatchEvent(new CustomEvent('coach:context',{detail:fixture}));}); assert(await first.locator('[data-preset-title]').isDisabled()); assert(await first.locator('[data-insert=true]').isDisabled());
      await page.evaluate(()=>{fixture.busy=false;fixture.session.status='Cancelled';window.dispatchEvent(new CustomEvent('coach:context',{detail:fixture}));}); assert(await first.locator('[data-insert=true]').isDisabled(),'Cancelled session rejects insertion');
      await page.evaluate(()=>{fixture.session.status='Scheduled';failSave=true;window.dispatchEvent(new CustomEvent('coach:context',{detail:fixture}));}); await page.locator('#library-save').click(); await page.waitForFunction(()=>!CoachLibrary.isBusy());
      assert(await page.locator('#library-retry').isVisible()); assert(await first.locator('[data-preset-title]').isDisabled()); assert(await first.locator('[data-insert=true]').isDisabled(),'Uncertain save guards all catalog actions');
      await page.evaluate(()=>{failSave=false;}); await page.locator('#library-retry').click(); await page.waitForFunction(()=>!CoachLibrary.isBusy()&&!CoachLibrary.isDirty());
      writes=await page.evaluate(()=>calls.filter(call=>call.operation==='save')); assert.deepEqual(writes.at(-1).payload,writes.at(-2).payload,'Recovery retries the exact same payload');
      await page.evaluate(()=>window.dispatchEvent(new CustomEvent('coach:context',{detail:{profile:null}})));
      assert(await page.locator('#coach-drill-library').isHidden()); assert.equal(await page.locator('#library-title').inputValue(),''); assert.equal(await page.locator('#library-age-filter').inputValue(),''); assert.equal(await page.locator('#library-list').textContent(),''); assert.deepEqual(errors,[]); await page.close();
    }
    console.log('Unified catalog: 20 ideas, source/search/age/phase filters, original sketches, attributed drafts, session insertion, busy/cancelled/recovery/logout safety and 320/390/1280 layouts passed.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
