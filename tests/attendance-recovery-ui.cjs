/* Fictional loopback browser checks. No external services or business records. */
const assert=require('node:assert/strict'),{chromium}=require('playwright');

(async()=>{
 const {startDemo}=await import('../private-attendance/demo.mjs');
 const demo=await startDemo({port:0});let browser;
 try{
  browser=await chromium.launch();const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(6000);
  await context.route('**/*',route=>new URL(route.request().url()).origin===demo.origin?route.continue():route.abort());
  const invitation=demo.drafts.find(draft=>draft.playerName==='Alex'),sessionId=demo.snapshot.sessions[0].id;
  const player=()=>demo.service.dashboard({sessionId}).sessions[0].players.find(row=>row.playerId==='demo_alex');
  let bootstrapFailed=false,bootstraps=0;
  await page.route('**/api/bootstrap',route=>{bootstraps++;if(!bootstrapFailed){bootstrapFailed=true;return route.abort('failed');}return route.continue();});
  await page.goto(invitation.yesUrl);await page.locator('#retry').waitFor({state:'visible'});
  assert.equal(page.url(),demo.origin+'/respond');assert.equal(player().response,null);
  await page.locator('#retry').click();await page.locator('#details').waitFor({state:'visible'});
  assert.equal(await page.locator('#player').textContent(),'Alex');assert.equal(player().response,null);
  assert(await page.locator('#retry').isHidden());assert(await page.locator('#error').isHidden());

  let previewFailed=false;
  await page.route('**/api/preview',route=>{if(!previewFailed){previewFailed=true;return route.abort('failed');}return route.continue();});
  await page.locator('#no').click();await page.locator('#retry').waitFor({state:'visible'});
  assert(await page.locator('#confirm').isDisabled());assert.equal(player().response,null);
  await page.locator('#retry').click();await page.locator('#details').waitFor({state:'visible'});
  assert.equal(await page.locator('#no').getAttribute('aria-pressed'),'true');assert(await page.locator('#confirm').isEnabled());

  let expired=false;
  await page.route('**/api/respond',route=>{if(!expired){expired=true;return route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'CSRF_FAILED',message:'Your browser session expired.'})});}return route.continue();});
  await page.locator('#confirm').click();await page.locator('#retry').waitFor({state:'visible'});
  assert.equal(player().response,null);assert(await page.locator('#confirm').isHidden());
  const previousBootstraps=bootstraps;
  await page.locator('#retry').click();await page.locator('#details').waitFor({state:'visible'});
  assert.equal(bootstraps,previousBootstraps+1);assert.equal(player().response,null);
  await page.locator('#confirm').click();await page.locator('#success').waitFor({state:'visible'});
  assert.equal(player().response,'no');assert.equal(player().version,1);
  assert(await page.locator('#retry').isHidden());assert(await page.locator('#error').isHidden());
  console.log('Parent in-page recovery passed: initial load, selection preview, expired browser, and explicit reconfirmation.');
 }finally{await browser?.close();await new Promise(resolve=>demo.server.close(resolve));demo.store.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
