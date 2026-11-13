const assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');

async function run(){
  const root=path.resolve(__dirname,'..');
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.avif':'image/avif','.webp':'image/webp'};
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep))return res.writeHead(403).end();
    fs.readFile(file,(error,data)=>{if(error)return res.writeHead(404).end();res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch();
    async function setup(mode='success'){
      const page=await browser.newPage({viewport:{width:390,height:850}});
      await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
      await page.addInitScript(mode=>{
        Date.now=()=>Date.parse('2026-11-12T18:00:00Z');
        window.requests=[];window.delivery=mode;
        window.fetch=async(url,options)=>{
          if(!String(url).startsWith('https://formspree.io/f/'))throw new Error('Unexpected external request');
          window.requests.push({url,body:Object.fromEntries(options.body),options:{credentials:options.credentials,redirect:options.redirect}});
          if(window.delivery==='network')throw new TypeError('Failed to fetch');
          const status=window.delivery==='rejected'?422:window.delivery==='limited'?429:200;
          return new Response(JSON.stringify(status===200?(window.delivery==='unknown'?{}:{next:'/thanks'}):{errors:[{message:'Rejected'}]}),{status,headers:{'Content-Type':'application/json',...(status===429?{'Retry-After':'60'}:{})}});
        };
      },mode);
      await page.goto(`http://127.0.0.1:${server.address().port}/pro-d-camp-registration.html`);
      await page.locator('#camp-player').fill('Alex <Test>');
      await page.locator('#camp-age').fill('8');
      await page.locator('#camp-email').fill('parent@example.test');
      return page;
    }
    const send=page=>page.evaluate(()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
    const accepted=await setup();
    for(const age of ['5','14','15','6.5']){await accepted.locator('#camp-age').fill(age);await send(accepted);assert.equal(await accepted.evaluate(()=>requests.length),0);}
    await accepted.locator('#camp-age').fill('13');
    await accepted.evaluate(()=>{const form=document.querySelector('form');for(let i=0;i<2;i++)form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));});
    await accepted.locator('#camp-registration[hidden]').waitFor({state:'attached'});
    const sent=await accepted.evaluate(()=>requests);
    assert.equal(sent.length,1);assert.equal(sent[0].url,'https://formspree.io/f/mvkkyyyw');
    for(const [key,value] of Object.entries({email:'parent@example.test','Session date':'2026-11-20','Start time':'12:00','End time':'15:00','Time zone':'America/Vancouver',Location:'Kitsilano Turf','Total CAD':'60','Intake version':'SS-DAY-CAMP-V1',Capacity:'20'}))assert.equal(sent[0].body[key],value);
    assert.equal(sent[0].options.credentials,'omit');
    assert.match(await accepted.locator('#day-camp-receipt').innerText(),/Alex <Test>.*parent@example\.test/s);
    assert.equal(await accepted.locator('#day-camp-receipt img').count(),0);
    await send(accepted);assert.equal(await accepted.evaluate(()=>requests.length),1);await accepted.close();
    const retry=await setup('rejected');await send(retry);await retry.getByRole('heading',{name:'Your request was not submitted'}).waitFor();
    assert.equal(await retry.locator('button[type=submit]').isEnabled(),true);
    await retry.evaluate(()=>window.delivery='success');await send(retry);await retry.locator('#camp-registration[hidden]').waitFor({state:'attached'});
    const refs=await retry.evaluate(()=>requests.map(r=>r.body['Registration reference']));assert.equal(refs.length,2);assert.equal(refs[0],refs[1]);await retry.close();
    const limited=await setup('limited');await send(limited);await limited.getByRole('heading',{name:'Your request was not submitted'}).waitFor();await send(limited);
    assert.equal(await limited.evaluate(()=>requests.length),1);assert.equal(await limited.locator('button[type=submit]').isDisabled(),true);await limited.close();
    for(const mode of ['network','unknown']){
      const uncertain=await setup(mode);await send(uncertain);await uncertain.getByRole('heading',{name:'We couldn’t confirm receipt'}).waitFor();await send(uncertain);
      assert.equal(await uncertain.evaluate(()=>requests.length),1);assert.equal(await uncertain.locator('button[type=submit]').isDisabled(),true);
      assert.match(await uncertain.getByRole('link',{name:'Email these details'}).getAttribute('href'),/^mailto:starsoccervancouver@gmail\.com/);await uncertain.close();
    }
    const late=await setup();await late.evaluate(()=>Date.now=()=>Date.parse('2026-11-20T20:00:00Z'));await send(late);
    assert.equal(await late.evaluate(()=>requests.length),0);assert.equal(await late.locator('button[type=submit]').innerText(),'Registration closed');await late.close();
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
module.exports=run;
if(require.main===module)run().then(()=>console.log('Pro-D camp mocked submission checks passed')).catch(error=>{console.error(error);process.exitCode=1;});
