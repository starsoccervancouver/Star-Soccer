const {test}=require('node:test'),assert=require('node:assert/strict');
const http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),{chromium}=require('playwright');
const Family=require('../family-registration.js');

test('only explicit definitive rejections are retryable, with a bounded-by-provider retry time',()=>{
 for(const status of [200,400,422,429])assert(Family.rejected({ok:status===200,status},{success:'false'}));
 for(const status of [408,500,502,503])assert(!Family.rejected({ok:false,status},{success:false}));
 assert(!Family.rejected({ok:true,status:200},{success:true}));assert(!Family.rejected({ok:false,status:429},null));
 assert.equal(Family.retryAfter({status:429,headers:new Headers({'Retry-After':'60'})},1000),61000);
 assert.equal(Family.retryAfter({status:429,headers:new Headers({'Retry-After':'Thu, 05 Nov 2026 20:01:00 GMT'})},Date.parse('2026-11-05T20:00:00Z')),Date.parse('2026-11-05T20:01:00Z'));
 assert.equal(Family.retryAfter({status:429,headers:new Headers({'Retry-After':'invalid'})},1000),0);
});

test('family retries preserve original requests and never resend accepted or uncertain players',async t=>{
 const root=path.resolve(__dirname,'..'),server=http.createServer(async(req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(await fs.readFile(file));}catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
 t.after(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
 browser=await chromium.launch();const origin='http://127.0.0.1:'+server.address().port;
 async function fixture(url,failure){
  const page=await browser.newPage();page.setDefaultTimeout(5000);
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.addInitScript(()=>{const RealDate=Date;window.fixtureNow=RealDate.parse('2026-11-05T20:00:00Z');window.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[window.fixtureNow]));}static now(){return window.fixtureNow;}};});
  await page.goto(origin+url);await page.locator('.family-add-player').waitFor();
  await page.evaluate(failure=>{
   const form=document.querySelector('form');form.action='https://formspree.io/f/testform';for(const [name,value]of [['email','fixture@example.invalid'],['Player name','Alex Fixture'],['Player age','8'],['Experience','new']]){const input=form.elements.namedItem(name);if(input)input.value=value;}
   for(const [name,age]of [['Sam Fixture','9'],['Jo Fixture','7']]){document.querySelector('.family-add-player').click();const extra=document.querySelector('.family-player:last-child');extra.querySelector('[data-player-field=name]').value=name;extra.querySelector('[data-player-field=age]').value=age;if(extra.querySelector('select'))extra.querySelector('select').value='some';}
   if(new URLSearchParams(location.search).get('kind')==='dropin'){const days=document.querySelectorAll('[name="Camp days"]');days[0].checked=true;days[1].checked=true;days[0].dispatchEvent(new Event('change',{bubbles:true}));}
   window.fixtureRequests=[];window.StarFormRecovery={show:(_,details)=>{window.fixtureOriginal=details.requests.map(data=>[...data.entries()]);}};
   window.fetch=async(url,options)=>{if(String(url)!=='https://formspree.io/f/testform')throw new Error('Unexpected submission endpoint');fixtureRequests.push([...options.body.entries()]);if(fixtureRequests.length===2){if(failure==='network')throw new TypeError('Fixture offline');if(failure==='malformed')return new Response('not JSON',{status:200});return new Response(JSON.stringify({errors:[{message:'Fixture rejected'}]}),{status:failure,headers:{'Content-Type':'application/json',...(failure===429?{'Retry-After':'60'}:{})}});}return new Response(JSON.stringify({next:'https://formspree.io/thanks'}),{status:200,headers:{'Content-Type':'application/json'}});};
   form.requestSubmit();
  },failure);
  await page.waitForFunction(()=>fixtureRequests.length===2&&!document.querySelector('form').hasAttribute('aria-busy'));
  return page;
 }
 for(const url of ['/registration.html?sessionId=thursday&type=dropin','/registration.html?sessionId=thursday&type=pass4','/christmas-camp-registration.html','/boxing-camp-registration.html?kind=dropin'])await t.test(url+' retries only remaining original snapshots',async()=>{
  const page=await fixture(url,429);try{
   assert(await page.locator('.registration-retry').isVisible());assert(await page.locator('form [type=submit]').isDisabled());assert(await page.locator('input[name=email]').isDisabled());assert(await page.locator('.family-add-player').isDisabled());
   await page.locator('.registration-retry').click();assert.equal(await page.evaluate(()=>fixtureRequests.length),2);
   await page.evaluate(()=>{fixtureNow+=7*86400000;document.querySelector('input[name=email]').value='changed@example.invalid';document.querySelector('[data-player-field=name]').value='Changed';document.querySelector('form').requestSubmit();});
   assert.equal(await page.evaluate(()=>fixtureRequests.length),2,'The original form cannot reconstruct a partially accepted family');
   await page.locator('.registration-retry').click();await page.locator('form').waitFor({state:'hidden'});
   const result=await page.evaluate(()=>({sent:fixtureRequests,original:fixtureOriginal}));
   const businessFields=entries=>entries.filter(([key])=>!key.startsWith('_')&&!['subject','Submission page'].includes(key)).sort(([a],[b])=>a.localeCompare(b));
   assert.equal(result.sent.length,4);assert.deepEqual(businessFields(result.sent[0]),businessFields(result.original[0]));assert.deepEqual(businessFields(result.sent[1]),businessFields(result.original[1]));assert.deepEqual(result.sent[2],result.sent[1]);assert.deepEqual(businessFields(result.sent[3]),businessFields(result.original[2]));
   assert.equal(new Set(result.original.map(entries=>Object.fromEntries(entries)['Client reference'])).size,3);
   assert(result.original.every(entries=>Object.fromEntries(entries)._url==='https://starsoccer.ca/'+url.split('?')[0].slice(1)));
   for(const [sentIndex,originalIndex]of [[0,0],[1,1],[2,1],[3,2]]){const sent=Object.fromEntries(result.sent[sentIndex]),original=Object.fromEntries(result.original[originalIndex]);assert.equal(sent.subject,original._subject);assert.equal(sent['Submission page'],original._url);assert.equal(sent._gotcha,'');}
  }finally{await page.close();}
 });
 for(const url of ['/registration.html?sessionId=thursday&type=dropin','/christmas-camp-registration.html'])for(const failure of ['network','malformed',408,503])await t.test(url+' stops on '+failure,async()=>{
  const page=await fixture(url,failure);try{assert.equal(await page.locator('.registration-retry').count(),0);assert(await page.locator('form [type=submit]').isDisabled());await page.evaluate(()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(await page.evaluate(()=>fixtureRequests.length),2);}finally{await page.close();}
 });
});
