/* Camp audit regressions. All pages are served from local source; all external traffic is blocked. */
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),origin='https://camp-fixture.example.invalid';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.avif':'image/avif','.webp':'image/webp','.png':'image/png','.jpg':'image/jpeg'};

(async()=>{
  const browser=await chromium.launch();let checks=0;
  try{
    const context=await browser.newContext({viewport:{width:390,height:844}});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort();
      const file=path.resolve(root,'.'+url.pathname);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({status:404,body:'Fixture missing'});
      return route.fulfill({status:200,contentType:types[path.extname(file)]||'application/octet-stream',body:fs.readFileSync(file)});
    });
    await context.addInitScript(()=>{
      const BaseDate=Date,ms=BaseDate.parse('2026-10-29T19:00:00Z');
      window.Date=class extends BaseDate{constructor(...args){super(...(args.length?args:[ms]));}static now(){return ms;}};
      const realFetch=window.fetch.bind(window),realTimeout=window.setTimeout.bind(window);
      window.setTimeout=(fn,delay,...args)=>realTimeout(fn,delay===20000?15:delay,...args);
      window.fixtureRequests=[];window.fixtureOutcomes=[];
      window.fetch=async(url,options={})=>{
        if(!String(url).startsWith('https://formsubmit.co/ajax/'))return realFetch(url,options);
        window.fixtureRequests.push(Object.fromEntries(options.body.entries()));
        const outcome=window.fixtureOutcomes.shift()||'accept';
        if(outcome==='timeout')return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('Fixture timeout','AbortError')),{once:true}));
        if(outcome==='network')throw new TypeError('Fixture network failure');
        if(outcome==='malformed')return new Response('not JSON',{status:200});
        return new Response(JSON.stringify({success:outcome!=='reject'}),{status:200,headers:{'content-type':'application/json'}});
      };
    });
    async function pageFor(query=''){
      const page=await context.newPage();page.on('pageerror',error=>{throw error;});
      await page.goto(origin+'/christmas-camp-registration.html'+query);
      await page.locator('.family-add-player').waitFor();return page;
    }
    async function fill(page,siblings=false){
      await page.locator('[name="email"]').fill('fixture@example.invalid');
      await page.locator('[name="Player name"]').fill('Fixture Player One');
      await page.locator('[name="Player age"]').fill('7');
      if(siblings){await page.locator('.family-add-player').click();await page.locator('#player-2-name').fill('Fixture Player Two');await page.locator('#player-2-age').fill('10');await page.locator('#player-2-notes').fill('Second player fixture note');}
    }
    async function submit(page){await page.locator('#camp-registration [type="submit"]').click();}
    async function outcome(page,list){await page.evaluate(list=>{window.fixtureOutcomes=list;},list);}
    const requestData=page=>page.evaluate(()=>window.fixtureRequests);
    async function failStatus(page,pattern){await page.locator('#camp-status').filter({hasText:pattern}).waitFor();}
    async function check(label,fn){await fn();checks++;console.log('PASS '+label);}

    await check('two siblings retain one family reference and separate canonical per-player requests',async()=>{
      const page=await pageFor();await fill(page,true);
      assert.equal(await page.locator('[data-camp-total]').textContent(),'$400 CAD');
      await submit(page);await page.locator('#camp-receipt').waitFor({state:'visible'});
      const requests=await requestData(page);assert.equal(requests.length,2);
      assert.deepEqual(requests.map(r=>r['Player name']),['Fixture Player One','Fixture Player Two']);
      assert.deepEqual(requests.map(r=>r['Player age']),['7','10']);
      assert.equal(requests[1].Notes,'Second player fixture note');
      assert(requests.every(r=>r.email==='fixture@example.invalid'&&r['Price CAD']==='200'&&r['Family players']==='2'&&r['Registration version']==='SS-CAMP-V2'&&r['Camp slot']==='am'));
      assert.equal(requests[0]['Family reference'],requests[1]['Family reference']);
      assert.notEqual(requests[0]['Client reference'],requests[1]['Client reference']);
      assert(requests.every(r=>/^SS-CAMP-[A-Z0-9-]{6,40}$/.test(r['Client reference'])));
      assert.match(await page.locator('.camp-receipt-details').textContent(),/Total for all players: \$400 CAD/);
      await page.evaluate(()=>document.querySelector('#camp-registration').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      assert.equal((await requestData(page)).length,2);await page.close();
    });
    await check('explicit rejection permits retry with unchanged player and family references',async()=>{
      const page=await pageFor();await fill(page);await outcome(page,['reject','accept']);
      await submit(page);await failStatus(page,/not accepted/);
      assert.equal(await page.locator('#camp-registration [type="submit"]').isDisabled(),false);
      await submit(page);await page.locator('#camp-receipt').waitFor({state:'visible'});
      const requests=await requestData(page);assert.equal(requests.length,2);
      assert.equal(requests[0]['Client reference'],requests[1]['Client reference']);assert.equal(requests[0]['Family reference'],requests[1]['Family reference']);await page.close();
    });
    await check('partial sibling acceptance freezes the form and never repeats the accepted player',async()=>{
      const page=await pageFor();await fill(page,true);await outcome(page,['accept','reject']);
      await submit(page);await failStatus(page,/Sending has stopped to avoid duplicates/);
      const status=await page.locator('#camp-status').textContent();assert.match(status,/Player 1: submitted/);assert.match(status,/Player 2: not accepted/);
      assert.equal(await page.locator('#camp-registration [type="submit"]').isDisabled(),true);assert.equal(await page.locator('.family-add-player').isDisabled(),true);
      assert.equal(await page.locator('#camp-receipt').isVisible(),false);
      await page.evaluate(()=>document.querySelector('#camp-registration').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
      assert.equal((await requestData(page)).length,2);await page.close();
    });
    await check('timeouts never show a completed receipt or enable blind retries',async()=>{
      const page=await pageFor();await fill(page);await outcome(page,['timeout']);
      await submit(page);await failStatus(page,/delivery uncertain/);
      assert.equal(await page.locator('#camp-receipt').isVisible(),false);assert.equal(await page.locator('#camp-registration [type="submit"]').isDisabled(),true);
      assert.equal((await requestData(page)).length,1);await page.close();
    });
    await check('uncertain retry after a rejection changes state to uncertain and freezes',async()=>{
      const page=await pageFor();await fill(page);await outcome(page,['reject','timeout']);
      await submit(page);await failStatus(page,/not accepted/);await submit(page);await failStatus(page,/delivery uncertain/);
      assert.equal(await page.locator('#camp-registration [type="submit"]').isDisabled(),true);assert.equal(await page.locator('#camp-receipt').isVisible(),false);await page.close();
    });
    await check('Christmas paid-day selection offers the cheaper full week for one or both daily slots',async()=>{
      for(const slot of ['am','both']){
        const page=await pageFor('?kind=dropin&slot='+slot);
        for(const date of ['2026-12-21','2026-12-22','2026-12-23','2026-12-24'])await page.locator('[name="Camp days"][value="'+date+'"]').check();
        assert.equal(await page.locator('[data-camp-total]').textContent(),slot==='am'?'$240 CAD':'$480 CAD');
        assert.equal(await page.locator('.camp-package-saving').isVisible(),true);
        assert.match(await page.locator('.camp-package-saving').textContent(),slot==='am'?/Save \$40 per player/:/Save \$80 per player/);
        await page.locator('.camp-package-saving button').click();
        assert.equal(await page.locator('[name="Booking option"][value="week"]').isChecked(),true);
        assert.equal(await page.locator('[data-camp-total]').textContent(),slot==='am'?'$200 CAD':'$400 CAD');
        assert.equal(await page.locator('#camp-dates li').count(),5);assert.match(await page.locator('#camp-dates').textContent(),/Dec 25/);
        await fill(page);await submit(page);await page.locator('#camp-receipt').waitFor({state:'visible'});
        const [request]=await requestData(page);assert.equal(request['Camp slot'],slot);assert.equal(request['Camp booking kind'],'week');assert.equal(request['Covered dates'].split(', ').length,5);
        assert.equal(request['Camp session keys'].split('; ').length,slot==='am'?5:10);await page.close();
      }
    });
    console.log(checks+' camp audit browser checks passed; no live requests.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
