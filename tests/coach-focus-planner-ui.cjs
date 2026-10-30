/* Dedicated planning workspace. Fictional sessions and intercepted requests only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {chromium} = require('playwright');
const origin='https://attendance.starsoccer.ca', now='2026-10-29T18:00:00Z';
const rid=n=>'rec'+String(n).padStart(14,'0');
const profile={email:'fictional-planner@example.test',name:'Fictional Coach',role:'owner',sessionVersion:1};
const row=(n,date,status='Scheduled')=>({id:rid(n),date,time:'4:00–5:00 PM',location:'Fictional training field',status,capacity:20,capacityUsed:0,expected:0,counts:{yes:0,no:0,awaiting:0,confirmed:0},issues:[],players:[]});
const rows=[row(1,'2026-10-29'),row(2,'2026-10-30'),row(3,'2026-11-04'),row(4,'2026-10-28'),row(5,'2026-11-04','Cancelled')];
const assets={};
for(const [url,file,type] of [['/workspace','workspace.html','text/html'],['/workspace/assets/workspace.js','workspace.js','text/javascript'],['/workspace/assets/workspace.css','workspace.css','text/css'],['/assets/app.css','app.css','text/css'],['/assets/logo.svg','logo.svg','image/svg+xml']])assets[url]={body:fs.readFileSync('private-attendance/web/'+file,'utf8'),type};
assets['/workspace/assets/passkeys.js']={body:'',type:'text/javascript'};
require('./coach-fixture-fonts.cjs')(assets);
// Library behavior has a separate fixture; this suite isolates navigation guards.
assets['/workspace/assets/library.js']={body:'',type:'text/javascript'};
assets['/workspace/assets/library.css']={body:'',type:'text/css'};

(async()=>{
 const browser=await chromium.launch();let checks=0;
 try{
  async function fixture(){
   const context=await browser.newContext({viewport:{width:1365,height:950}}),state={profile:{...profile},failedSession:null,delaySave:false},requests=[],errors=[],pending=[];
   await context.addInitScript(now=>{const Base=Date;window.Date=class extends Base{constructor(...args){super(...(args.length?args:[now]));}static now(){return Base.parse(now);}};window.answers=[];window.prompts=[];window.contextEvents=0;window.addEventListener('coach:context',()=>contextEvents++);window.confirm=text=>{prompts.push(text);return answers.shift()===true;};},now);
   await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==origin){errors.push('Unexpected external request');return route.abort();}
    if(assets[url.pathname])return route.fulfill({status:200,contentType:assets[url.pathname].type,body:assets[url.pathname].body});
    const payload=req.postData()?req.postDataJSON():undefined;requests.push({path:url.pathname,payload,method:req.method()});let value,status=200;
    if(url.pathname.endsWith('/bootstrap'))value={profile:state.profile,csrfToken:'fictional-focus-csrf',googleEnabled:true};
    else if(url.pathname.endsWith('/desk'))value={profile:state.profile,sessions:rows,notes:[],tasks:[],observedAt:now};
    else if(url.pathname.endsWith('/session')){if(state.failedSession===payload.sessionId){status=503;value={error:'FICTIONAL_PLAN_LOAD',message:'Fictional unavailable plan'};}else value={plan:{session_id:payload.sessionId,version:1,content:{focus:'Saved focus for '+payload.sessionId}}};}
    else if(url.pathname.endsWith('/diagrams/list'))value={diagrams:[]};
    else if(url.pathname.endsWith('/plans/save')){if(state.delaySave)await new Promise(resolve=>pending.push(resolve));value={plan:{session_id:payload.sessionId,version:payload.expectedVersion+1,content:payload.content,updated_at:now,updated_by:profile.email}};}
    else if(url.pathname.endsWith('/logout')){state.profile=null;value={signedOut:true};}
    else {errors.push('Unexpected fixture route '+url.pathname);status=403;value={error:'UNEXPECTED_FIXTURE'};}
    return route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
   });
   const page=await context.newPage();page.setDefaultTimeout(6500);page.on('pageerror',error=>errors.push(error.message));
   await page.goto(origin+'/workspace');await page.locator('#app').waitFor({state:'visible'});
   return{page,context,state,requests,errors,pending,answer:value=>page.evaluate(value=>answers.push(value),value)};
  }
  const enterChooser=async f=>{await f.page.locator('#navigation [data-tab="plan"]').click();await f.page.locator('#planner-session-browser').waitFor({state:'visible'});await f.page.waitForFunction(()=>!document.getElementById('planner-open-selected').disabled);};
  const focus=async(f,day=3)=>{await f.page.locator('#planner-days [data-weekday="'+day+'"]').click();await f.page.locator('#planner-workspace').waitFor({state:'visible'});await f.page.waitForFunction(()=>!document.getElementById('plan-focus').disabled);};
  const focused=f=>f.page.evaluate(()=>document.body.classList.contains('planner-focus-mode'));
  const clean=f=>assert.deepEqual(f.errors,[]);

  const f=await fixture();await enterChooser(f);
  assert.equal(await f.page.locator('#plan-form').isVisible(),false,'Landing is a day chooser, not an unfinished editor');
  assert.equal(await f.page.locator('#navigation').isVisible(),true);
  assert.equal(await f.page.locator('#planner-focus-bar').isVisible(),false);
  assert.equal(f.requests.filter(r=>/\/(?:plans\/save|notes\/save|diagrams\/save|attendance)$/.test(r.path)).length,0);
  checks++;

  await focus(f);assert.equal(await focused(f),true);
  assert.equal(await f.page.locator('#session').inputValue(),rid(3),'Wednesday opens its next scheduled session');
  assert.equal(await f.page.locator('.desk-header').isVisible(),false);
  assert.equal(await f.page.locator('#navigation').isVisible(),false);
  assert.equal(await f.page.locator('#planner-days').isVisible(),false);
  assert.equal(await f.page.locator('.page-heading').isVisible(),false);
  await f.page.waitForFunction(()=>document.activeElement.id==='planner-focus-title');
  assert.match(await f.page.locator('#planner-focus-title').innerText(),/Wednesday/);
  assert.equal(await f.page.locator('#plan-focus').inputValue(),'Saved focus for '+rid(3));
  assert.equal(await f.page.getByRole('button',{name:'+',exact:true}).count(),0,'No unrelated expansion controls leak into the workspace');
  checks++;

  await f.page.locator('#plan-focus').fill('K');
  const dirtyBroadcasts=await f.page.evaluate(()=>contextEvents);
  await f.page.locator('#plan-focus').pressSequentially('eep this focused draft');
  assert.equal(await f.page.evaluate(()=>contextEvents),dirtyBroadcasts,'Typing within an already dirty plan does not redraw every connected tool');
  await f.answer(false);await f.page.locator('#planner-back').click();assert.equal(await focused(f),true);assert.equal(await f.page.locator('#plan-focus').inputValue(),'Keep this focused draft');
  await f.answer(false);await f.page.locator('#planner-home').click();assert.equal(await focused(f),true);
  await f.page.locator('#planner-focus-date').click();await f.answer(false);await f.page.locator('#planner-date').selectOption(rid(2));assert.equal(await f.page.locator('#session').inputValue(),rid(3));assert.equal(await f.page.locator('#planner-date').inputValue(),rid(3));
  assert.equal(await f.page.locator('#plan-focus').inputValue(),'Keep this focused draft');
  await f.answer(true);await f.page.locator('#planner-back').click();assert.equal(await focused(f),false);assert.equal(await f.page.locator('#planner-workspace').isVisible(),false);assert.equal(await f.page.locator('#planner-date-options').isVisible(),false);
  assert.equal(await f.page.locator('#plan-focus').inputValue(),'Saved focus for '+rid(3),'Approved Back restores the saved plan');
  assert.equal(await f.page.evaluate(()=>document.activeElement.id),'planner-chooser-title');
  checks++;

  await focus(f,5);await f.page.locator('#planner-open-notes').click();await f.page.locator('#planner-note-body').fill('Keep this private note draft');await f.page.locator('#planner-close-drawer').click();
  assert.equal(await focused(f),true);assert.equal(await f.page.locator('#planner-note-body').inputValue(),'Keep this private note draft');
  await f.answer(false);await f.page.locator('#planner-back').click();assert.equal(await focused(f),true);
  await f.page.locator('#planner-open-notes').click();assert.equal(await f.page.locator('#planner-note-body').inputValue(),'Keep this private note draft');await f.page.locator('#planner-close-drawer').click();
  await f.answer(true);await f.page.locator('#planner-back').click();assert.equal(await f.page.locator('#planner-note-body').inputValue(),'');
  await focus(f,4);await f.page.locator('#planner-open-tools').click();assert.equal(await f.page.locator('#tactics-disclosure').isVisible(),true);assert.equal(await f.page.locator('#coach-drill-library').count(),1);await f.page.locator('#planner-close-drawer').click();
  await f.page.locator('#planner-open-run').click();assert.equal(await f.page.locator('#session-field-disclosure').isVisible(),true);await f.page.keyboard.press('Escape');assert.equal(await f.page.locator('#planner-drawer').isVisible(),false);assert.equal(await focused(f),true);
  checks++;

  f.state.delaySave=true;await f.page.locator('#plan-focus').fill('Save this fictional session');
  assert.equal(await f.page.locator('#planner-save').innerText(),'Save changes');
  assert.equal(await f.page.locator('#plan-form button[type="submit"]').isVisible(),true,'Footer save remains available');
  await f.page.locator('#planner-save').click();await f.page.waitForFunction(()=>document.getElementById('planner-home').disabled);
  assert.equal(f.requests.filter(r=>r.path.endsWith('/plans/save')).length,1,'Top action submits the existing plan form exactly once');
  assert.equal(f.requests.find(r=>r.path.endsWith('/plans/save')).payload.content.focus,'Save this fictional session');
  assert.equal(await f.page.locator('#planner-save').isDisabled(),true);
  assert.equal(await f.page.locator('#planner-back').isDisabled(),true);assert.equal(await f.page.locator('#planner-focus-date').isDisabled(),true);
  assert.equal(f.pending.length,1);f.pending.shift()();await f.page.waitForFunction(()=>!document.getElementById('planner-home').disabled);f.state.delaySave=false;
  const sessionReads=f.requests.filter(r=>r.path.endsWith('/session')).length;
  await f.page.locator('#planner-home').click();assert.equal(await focused(f),false);assert.equal(await f.page.locator('#panel-home').isVisible(),true);
  assert.match(await f.page.locator('#next-title').innerText(),/Oct(?:ober)? 29/,'Overview heading follows the selected session');
  assert.equal(await f.page.locator('#next-details').innerText(),rows[0].time+' · '+rows[0].location);
  await f.page.locator('#go-plan').click();await f.page.locator('#planner-workspace').waitFor({state:'visible'});assert.equal(await focused(f),true,'Overview shortcut enters a focused session directly');
  assert.equal(f.requests.filter(r=>r.path.endsWith('/session')).length,sessionReads,'Reopening the same current plan reuses its saved in-memory state');
  checks++;

  await f.page.locator('#planner-focus-date').click();f.state.failedSession=rid(4);await f.page.locator('#planner-date').selectOption(rid(4));await f.page.locator('#plan-retry').waitFor({state:'visible'});
  assert.equal(await focused(f),true);assert.equal(await f.page.locator('#plan-focus').isDisabled(),true);assert.equal(await f.page.locator('#plan-focus').inputValue(),'');
  f.state.failedSession=null;await f.page.locator('#plan-retry').click();await f.page.waitForFunction(()=>!document.getElementById('plan-focus').disabled);assert.equal(await f.page.locator('#plan-focus').inputValue(),'Saved focus for '+rid(4));
  checks++;

  for(const width of [1365,390,320]){
   await f.page.setViewportSize({width,height:900});
   assert(await f.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No horizontal overflow at '+width);
   for(const id of ['planner-back','planner-home','planner-focus-date','planner-save','planner-open-notes','planner-open-tools','planner-open-run'])assert((await f.page.locator('#'+id).boundingBox()).height>=44,id+' touch target');
   assert.equal(await f.page.locator('#plan-focus').evaluate(el=>getComputedStyle(el).fontSize),'16px');
   if(process.env.COACH_FOCUS_SCREENSHOT_DIR){fs.mkdirSync(process.env.COACH_FOCUS_SCREENSHOT_DIR,{recursive:true});await f.page.screenshot({path:require('node:path').join(process.env.COACH_FOCUS_SCREENSHOT_DIR,'coach-focus-'+width+'.png'),fullPage:true});}
  }
  await f.page.locator('#planner-home').click();await f.page.locator('#logout').click();await f.page.locator('#login').waitFor({state:'visible'});
  assert.equal(await focused(f),false);assert.equal(await f.page.locator('#planner-focus-title').innerText(),'');assert.equal(await f.page.locator('#planner-focus-detail').innerText(),'');assert.equal(await f.page.locator('#plan-focus').inputValue(),'');
  assert.equal(await f.page.locator('#planner-workspace').isVisible(),false);clean(f);await f.context.close();checks++;
  console.log('Coach focus planner: '+checks+' grouped chooser, guarded navigation, drawers, recovery, mobile and privacy checks passed. Fictional data only.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
