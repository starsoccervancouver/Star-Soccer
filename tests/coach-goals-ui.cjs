/* Fictional player goals only. All requests are intercepted; no external services. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
const {openDestination,openSession,openFolder,openView,leaveGroup}=require('./coach-fixture-navigation.cjs');
const origin='https://attendance.starsoccer.ca',now='2026-10-30T18:00:00Z',rid=n=>'rec'+String(n).padStart(14,'0');
const profile={email:'goal-coach@example.test',name:'Fictional Goal Coach',role:'coach',sessionVersion:1};
const players=[101,102].map((id,i)=>({playerId:rid(id),attendanceId:rid(id+100),name:i?'Fictional Lee':'Fictional Maya',age:9,kind:'dropin',status:'Confirmed',actualAttendance:'Not marked',issues:[]}));
const sessions=[['2026-10-28',1],['2026-11-04',2]].map(([date,id])=>({id:rid(id),programId:rid(800),date,time:'4:00–5:00 PM',location:'Fictional field',players,status:'Scheduled',capacity:20,expected:2,capacityUsed:2,counts:{yes:0,no:0,confirmed:2,awaiting:0},issues:[]}));
const note=(id,extra={})=>({id,session_id:rid(1),player_id:rid(101),body:'Legacy freeform goal',category:'Goal',goal:null,review_date:null,author_email:profile.email,created_at:now,updated_at:now,version:1,...extra});
const notes=[note('legacy'),note('private-other',{author_email:'other@example.test',body:'Other coach private goal',goal:{status:'achieved',successMeasure:'Foreign private measure',evidence:'Foreign evidence'}}),note('other-player',{player_id:rid(102),body:'Another player goal'})];
const assets={};require('./coach-fixture-fonts.cjs')(assets);
for(const [route,file,type]of [['/workspace','workspace.html','text/html'],['/workspace/assets/workspace.js','workspace.js','text/javascript'],['/workspace/assets/workspace.css','workspace.css','text/css'],['/assets/app.css','app.css','text/css'],['/assets/logo.svg','logo.svg','image/svg+xml']])assets[route]={body:fs.readFileSync('private-attendance/web/'+file),type};
assets['/workspace/assets/passkeys.js']={body:'',type:'text/javascript'};
(async()=>{
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext({viewport:{width:1440,height:1100}}),requests=[],errors=[];let signedIn=true,sequence=0,holdSave=null,nextSaveFailure=false,abortNextSave=false;
  await context.addInitScript(now=>{const Base=Date;window.Date=class extends Base{constructor(...args){super(...(args.length?args:[now]));}static now(){return Base.parse(now);}};window.fixtureAnswers=[];window.fixturePrompts=[];window.confirm=message=>{fixturePrompts.push(message);return fixtureAnswers.shift()===true;};},now);
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());if(url.origin!==origin){errors.push('Unexpected external request: '+url.origin);return route.abort();}
   if(assets[url.pathname])return route.fulfill({status:200,contentType:assets[url.pathname].type,body:assets[url.pathname].body});
   const payload=request.postData()?request.postDataJSON():null;requests.push({path:url.pathname,payload});let value;
   if(url.pathname.endsWith('/bootstrap'))value={profile:signedIn?profile:null,csrfToken:'fictional-goals',googleEnabled:true};
   else if(url.pathname.endsWith('/desk'))value={profile,sessions,notes,tasks:[],observedAt:now};
   else if(url.pathname.endsWith('/session'))value={plan:{session_id:payload.sessionId,version:0,content:{}}};
   else if(url.pathname.endsWith('/diagrams/list'))value={diagrams:[]};
   else if(url.pathname.endsWith('/notes/save')){
    if(holdSave)await holdSave;
    if(abortNextSave){abortNextSave=false;return route.abort();}
    if(nextSaveFailure){nextSaveFailure=false;return route.fulfill({status:400,json:{error:'INVALID_GOAL',message:'Fictional rejected save; keep the draft.'}});}
    const old=notes.find(row=>row.id===payload.id);assert.equal(payload.expectedVersion,old?.version||0);
    const saved=note(old?.id||'saved-'+(++sequence),{session_id:payload.sessionId,player_id:payload.playerId,category:payload.category,body:payload.body,review_date:payload.reviewDate,goal:payload.goal?{...payload.goal,drillId:payload.goal.drillId||null}:null,version:(old?.version||0)+1});
    if(old)notes.splice(notes.indexOf(old),1,saved);else notes.unshift(saved);value={note:saved};
   }else if(url.pathname.endsWith('/logout')){signedIn=false;value={signedOut:true};}
   else{errors.push('Unexpected request: '+url.pathname);return route.fulfill({status:403,json:{error:'UNEXPECTED_FIXTURE'}});}
   return route.fulfill({status:200,json:value});
  });
  const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/workspace');await page.locator('#app').waitFor({state:'visible'});await openDestination(page,'profiles');await page.locator('[data-profile-id="'+rid(101)+'"]').click();
  assert.doesNotMatch(await page.locator('#player-profile-detail').innerText(),/Other coach private|Foreign evidence|Another player/);
  await page.locator('#profile-add-goal').click();await page.locator('#profile-note-goal-fields').waitFor({state:'visible'});
  assert.equal(await page.locator('#panel-profiles').isVisible(),true,'Add goal stays inside the player profile');assert.equal(await page.locator('#profile-note-session').inputValue(),rid(2));
  await page.locator('#profile-note-body').fill('Receive on the back foot');await page.locator('#profile-note-goal-successMeasure').fill('Four of five controlled receives');await page.locator('#profile-note-goal-status').selectOption('in-progress');await page.locator('#profile-note-goal-evidence').fill('Passing pairs: three controlled receives');await page.locator('#profile-note-review').fill('2026-11-11');
  await page.locator('#profile-back').click();assert.equal(await page.locator('#profile-note-body').inputValue(),'Receive on the back foot','Declining navigation retains the inline draft');
  let releaseSave;holdSave=new Promise(resolve=>releaseSave=resolve);await page.locator('#profile-note-form button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('profile-note-body').disabled);
  assert.equal(await page.locator('#profile-note-goal-evidence').inputValue(),'Passing pairs: three controlled receives','Busy context renders preserve structured fields');assert.equal(await page.locator('#profile-back').isDisabled(),true);
  holdSave=null;releaseSave();await page.waitForFunction(()=>document.getElementById('profile-note-status')?.textContent.includes('Private note saved'));
  const inline=requests.filter(row=>row.path.endsWith('/notes/save')).at(-1).payload;assert.equal(inline.playerId,rid(101));assert.equal(inline.sessionId,rid(2));assert.equal(inline.reviewDate,'2026-11-11');assert.deepEqual(inline.goal,{successMeasure:'Four of five controlled receives',status:'in-progress',evidence:'Passing pairs: three controlled receives'});
  assert.match(await page.locator('#player-profile-detail').innerText(),/Four of five controlled receives/);assert.deepEqual(await page.locator('.profile-goal-progress span').allTextContents(),['1 planned','1 in progress','0 achieved']);assert.equal(await page.locator('#profile-note-body').inputValue(),'');
  await page.locator('#profile-add-note').click();await page.locator('#profile-note-body').fill('Encouraged a teammate');nextSaveFailure=true;await page.locator('#profile-note-form button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('profile-note-status')?.textContent.includes('Fictional rejected'));
  assert.equal(await page.locator('#profile-note-body').inputValue(),'Encouraged a teammate');assert.equal(await page.locator('#profile-note-form button[type="submit"]').isEnabled(),true);
  await page.locator('#profile-note-form button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('profile-note-status')?.textContent.includes('Private note saved'));assert.equal(requests.filter(row=>row.path.endsWith('/notes/save')).at(-1).payload.goal,null);
  await page.locator('#profile-add-goal').click();await page.locator('#profile-note-body').fill('Fictional uncertain goal');await page.locator('#profile-note-goal-evidence').fill('Keep this private evidence while checking the save');abortNextSave=true;
  const beforeUncertain=requests.filter(row=>row.path.endsWith('/notes/save')).length;await page.locator('#profile-note-form button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('profile-note-status')?.textContent.includes('could not be verified'));
  assert.equal(await page.locator('#profile-note-body').inputValue(),'Fictional uncertain goal');assert.equal(await page.locator('#profile-note-goal-evidence').inputValue(),'Keep this private evidence while checking the save');assert.equal(await page.locator('#profile-note-form button[type="submit"]').isDisabled(),true);
  await page.locator('#profile-note-form').evaluate(form=>form.requestSubmit());assert.equal(requests.filter(row=>row.path.endsWith('/notes/save')).length,beforeUncertain+1,'An uncertain save cannot be retried into a duplicate');
  await page.evaluate(()=>fixtureAnswers.push(true));await page.locator('#profile-note-cancel').click();await page.locator('#profile-add-note').click();
  for(const width of [390,768]){await page.setViewportSize({width,height:950});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'Profile composer fits '+width);}await page.setViewportSize({width:1440,height:1100});
  await page.locator('#profile-open-notes').click();await page.locator('#panel-notes').waitFor({state:'visible'});
  const mainCard=page.locator('#note-list .note-card').filter({hasText:'Receive on the back foot'});await mainCard.getByRole('button',{name:'Edit',exact:true}).click();
  assert.equal(await page.locator('#note-goal-successMeasure').inputValue(),'Four of five controlled receives');assert.equal(await page.locator('#note-goal-status').inputValue(),'in-progress');assert.equal(await page.locator('#note-goal-evidence').inputValue(),'Passing pairs: three controlled receives');
  await page.locator('#note-goal-status').selectOption('achieved');await page.locator('#note-goal-evidence').fill('Five controlled receives in the game');await page.locator('#note-form button[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#note-list .goal-progress-achieved'));
  const edited=requests.filter(row=>row.path.endsWith('/notes/save')).at(-1).payload;assert.equal(edited.expectedVersion,1);assert.equal(edited.goal.status,'achieved');assert.equal(edited.goal.evidence,'Five controlled receives in the game');
  await openFolder(page,'');await page.locator('#note-category').selectOption('Goal');assert.equal(await page.locator('#note-goal-fields').isVisible(),false);await page.locator('#note-body').fill('Group confidence goal');await page.locator('#note-form button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('note-body').value==='');assert.equal(requests.filter(row=>row.path.endsWith('/notes/save')).at(-1).payload.goal,null);
  await openFolder(page,rid(101));await page.locator('#note-category').selectOption('Goal');await page.locator('#note-goal-successMeasure').fill('Unsaved measure only');await page.locator('#planner-back').click();assert.equal(await page.locator('#panel-notes').isVisible(),true);assert.equal(await page.locator('#note-goal-successMeasure').inputValue(),'Unsaved measure only');
  await page.evaluate(()=>fixtureAnswers.push(true));await page.locator('#planner-back').click();await openSession(page,sessions,rid(2),'plan');await page.locator('#planner-open-notes').click();await page.locator('#planner-notes-player').selectOption(rid(101));await page.locator('#planner-note-category').selectOption('Goal');await page.locator('#planner-note-goal-fields').waitFor({state:'visible'});
  await page.locator('#planner-note-body').fill('Look up before passing');await page.locator('#planner-note-goal-successMeasure').fill('Scan before four passes');await page.locator('#planner-note-goal-status').selectOption('in-progress');await page.locator('#planner-note-goal-evidence').fill('Observed in three-player passing');await page.locator('#planner-note-form button[type="submit"]').click();await page.waitForFunction(()=>document.getElementById('planner-note-status').textContent.includes('Private note saved'));
  const quick=requests.filter(row=>row.path.endsWith('/notes/save')).at(-1).payload;assert.equal(quick.playerId,rid(101));assert.equal(quick.goal.successMeasure,'Scan before four passes');assert.equal(quick.goal.status,'in-progress');assert.equal(quick.goal.evidence,'Observed in three-player passing');
  await page.locator('#planner-notes-player').selectOption('');await page.locator('#planner-note-category').selectOption('Goal');assert.equal(await page.locator('#planner-note-goal-fields').isVisible(),false);await page.locator('#planner-close-drawer').click();
  await leaveGroup(page);await openDestination(page,'profiles');assert.match(await page.locator('#player-profile-detail').innerText(),/Five controlled receives in the game/);assert.deepEqual(await page.locator('.profile-goal-progress span').allTextContents(),['1 planned','1 in progress','1 achieved']);
  await page.locator('#profile-add-goal').click();await page.locator('#profile-note-goal-successMeasure').fill('Private unsaved logout measure');await page.locator('#logout').click();assert.equal(await page.locator('#app').isVisible(),true);assert.equal(requests.filter(row=>row.path.endsWith('/logout')).length,0);
  await page.evaluate(()=>fixtureAnswers.push(true));await page.locator('#logout').click();await page.locator('#login').waitFor({state:'visible'});assert.equal(await page.locator('#player-profile-detail').textContent(),'');assert.equal(await page.locator('#note-goal-successMeasure').inputValue(),'');assert.equal(await page.locator('#planner-note-goal-evidence').inputValue(),'');
  assert.equal(requests.some(row=>/\/(attendance|plans\/save|refresh)$/.test(row.path)),false);assert.deepEqual(errors,[]);await context.close();
  console.log('Goals UI passed: inline profile drafts, privacy, save/failure recovery, main edit, group scope, quick drawer, mobile, guards and logout. All requests mocked.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
