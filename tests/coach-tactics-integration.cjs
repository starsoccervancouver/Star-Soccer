/* Real Coach Desk + tactics bridge against isolated fictional network responses. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
const origin='https://attendance.starsoccer.ca',now='2026-10-29T18:00:00Z',rid=n=>'rec'+String(n).padStart(14,'0');
const profile={email:'fixture-tactics@example.test',name:'Fictional Tactics Coach',role:'owner'};
const {openSession}=require('./coach-fixture-navigation.cjs');
const sessions=[1,2].map(n=>({id:rid(n),programId:rid(900),date:n===1?'2026-10-29':'2026-11-05',time:'4:00–5:00 PM',location:'Fictional tactics field',status:'Planned',capacity:20,capacityUsed:1,expected:1,counts:{yes:0,no:0,confirmed:0,awaiting:1},issues:[],players:[{playerId:rid(100+n),attendanceId:rid(200+n),name:'Fictional Tactics Player '+n,kind:'dropin',status:'Not yet asked',actualAttendance:'Not marked',issues:[]}]}));
const board=()=>({schemaVersion:1,pitch:'full',items:[{id:'home_1',kind:'home',label:'1'}],frames:[{id:'phase_1',title:'Start',duration:3,positions:[{id:'home_1',x:30,y:50}]}]});
const saved=(sessionId=rid(1))=>({id:'diagram_'+'a'.repeat(27),session_id:sessionId,title:'Fictional saved setup',content:board(),created_by:profile.email,updated_by:profile.email,created_at:now,updated_at:now,version:1});
const assets={};
for(const [url,file,type]of [['/workspace','workspace.html','text/html'],['/workspace/assets/workspace.css','workspace.css','text/css'],['/workspace/assets/workspace.js','workspace.js','text/javascript'],['/assets/app.css','app.css','text/css'],['/assets/logo.svg','logo.svg','image/svg+xml']])assets[url]={body:fs.readFileSync('private-attendance/web/'+file,'utf8'),type};
assets['/workspace/assets/passkeys.js']={body:fs.readFileSync('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js','utf8'),type:'text/javascript'};
require('./coach-fixture-fonts.cjs')(assets);

(async()=>{
 const browser=await chromium.launch();let checks=0;
 try{
  async function fixture(){
   const context=await browser.newContext(),requests=[],errors=[],pending=[];
   const state={listMode:'success',saveMode:'success',diagrams:[saved()],profile};
   await context.addInitScript(({now})=>{const BaseDate=Date,at=BaseDate.parse(now);window.Date=class extends BaseDate{constructor(...args){super(...(args.length?args:[at]));}static now(){return at;}};window.fixtureConfirmAnswers=[];window.fixtureConfirmPrompts=[];window.confirm=text=>{fixtureConfirmPrompts.push(text);return fixtureConfirmAnswers.shift()===true;};},{now});
   await context.route('**/*',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(url.origin!==origin){errors.push('Unexpected outside network '+url.origin);return route.abort();}
    if(assets[path])return route.fulfill({status:200,contentType:assets[path].type,body:assets[path].body});
    const payload=request.postData()?request.postDataJSON():undefined;requests.push({path,payload,headers:request.headers(),method:request.method()});
    let value,status=200;
    if(path.endsWith('/bootstrap'))value={profile:state.profile,csrfToken:'fictional-tactics-csrf',googleEnabled:true};
    else if(path.endsWith('/desk'))value={profile:state.profile,sessions,notes:[],tasks:[],observedAt:now};
    else if(path.endsWith('/session'))value={plan:{session_id:payload.sessionId,version:0,content:{}}};
    else if(path.endsWith('/refresh'))value={profile:state.profile,sessions,observedAt:now};
    else if(path.endsWith('/logout')){state.profile=null;value={signedOut:true};}
    else if(path.endsWith('/diagrams/list')){
     let mode=state.listMode;if(mode==='delay')mode=await new Promise(resolve=>pending.push({path,payload,resolve}));
     if(mode==='unauthorized'){status=401;value={error:'SIGN_IN_REQUIRED',message:'Sign in again.'};}else value={diagrams:state.diagrams.filter(d=>d.session_id===payload.sessionId)};
    }else if(path.endsWith('/diagrams/save')){
     let mode=state.saveMode;if(mode==='delay')mode=await new Promise(resolve=>pending.push({path,payload,resolve}));
     if(mode==='fail'){status=503;value={error:'FICTIONAL_UNAVAILABLE',message:'Fictional save is unavailable. Your draft is retained.'};}
     else if(mode==='unauthorized'){status=401;value={error:'SIGN_IN_REQUIRED',message:'Sign in again.'};}
     else{const diagram={...saved(payload.sessionId),id:payload.id||'diagram_'+'b'.repeat(27),title:payload.title,content:payload.content,version:payload.expectedVersion+1};state.diagrams=[diagram,...state.diagrams.filter(d=>d.id!==diagram.id)];value={diagram};}
    }else if(path.endsWith('/diagrams/archive')){state.diagrams=state.diagrams.filter(d=>d.id!==payload.id);value={saved:true};}
    else{errors.push('Unexpected fixture action '+request.method()+' '+path);status=500;value={error:'UNEXPECTED_FIXTURE'};}
    return route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
   });
   const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.stack||error.message));
   await page.goto(origin+'/workspace');await page.locator('#app').waitFor({state:'visible'});
   return {context,page,state,requests,errors,pending,answer:value=>page.evaluate(value=>fixtureConfirmAnswers.push(value),value),release:(path,mode='success')=>{const index=pending.findIndex(item=>item.path.endsWith(path));assert(index>=0,'Expected pending '+path);pending.splice(index,1)[0].resolve(mode);}};
  }

  const enterPlan=async f=>{await openSession(f.page,sessions,rid(1),'plan');await f.page.waitForFunction(()=>!document.getElementById('plan-focus').disabled);};
  const openBoard=async f=>{await f.page.locator('#planner-open-tools').click();await f.page.waitForFunction(()=>!document.getElementById('tactics-title').disabled);};
  const chooseDate=async(f,id)=>{if(!await f.page.locator('#planner-dates-pane').isVisible())await f.page.locator('#planner-focus-date').click();await f.page.locator('[data-session-date-id="'+id+'"]').click();};
  const count=(f,suffix)=>f.requests.filter(r=>r.path.endsWith(suffix)).length;
  const beginBridgeList=async f=>{
   const waiting=f.page.waitForRequest(request=>new URL(request.url()).pathname.endsWith('/diagrams/list'));
   await f.page.evaluate(()=>{window.fixtureBridgeResult=null;new Promise((resolve,reject)=>window.dispatchEvent(new CustomEvent('coach:tactics-request',{detail:{operation:'list',payload:{sessionId:document.getElementById('session').value},resolve,reject}}))).then(value=>window.fixtureBridgeResult={ok:true,value},error=>window.fixtureBridgeResult={ok:false,message:error.message});});
   await waiting;
  };

  const f=await fixture();
  assert.equal(count(f,'/diagrams/list'),0,'Overview does not fetch diagrams');
  await enterPlan(f);assert.equal(count(f,'/diagrams/list'),0,'Collapsed board remains lazy');
  await openBoard(f);assert.equal(count(f,'/diagrams/list'),1);
  assert.deepEqual(f.requests.find(r=>r.path.endsWith('/diagrams/list')).payload,{sessionId:rid(1)});
  await f.page.locator('#tactics-library').selectOption(saved().id);
  assert.equal(await f.page.locator('#tactics-title').inputValue(),'Fictional saved setup');
  assert.equal(await f.page.evaluate(()=>CoachTactics.isDirty()),false);
  checks++;

  await f.page.locator('#tactics-title').fill('Unsaved fictional tactics');
  assert.equal(await f.page.evaluate(()=>CoachTactics.isDirty()),true);
  await f.page.locator('#planner-close-drawer').click();
  const promptBefore=await f.page.evaluate(()=>fixtureConfirmPrompts.length);
  for(const action of [()=>f.page.locator('#planner-home').click(),()=>chooseDate(f,rid(2)),()=>f.page.locator('#planner-back').click()]){
   await f.answer(false);await action();
   assert.equal(await f.page.locator('#tactics-title').inputValue(),'Unsaved fictional tactics');
   assert.equal(await f.page.locator('#session').inputValue(),rid(1));
   assert.equal(await f.page.locator('#panel-plan').isVisible(),true);
   if(await f.page.locator('#planner-drawer').isVisible())await f.page.locator('#planner-close-drawer').click();
  }
  assert.equal(await f.page.evaluate(()=>fixtureConfirmPrompts.length),promptBefore+3);
  assert.equal(count(f,'/refresh'),0);assert.equal(count(f,'/logout'),0);assert.equal(count(f,'/diagrams/save'),0);
  checks++;

  await openBoard(f);
  f.state.saveMode='delay';const saveRequested=f.page.waitForRequest(request=>new URL(request.url()).pathname.endsWith('/diagrams/save'));
  await f.page.locator('#tactics-save').click();await saveRequested;
  await f.page.waitForFunction(()=>document.getElementById('session').disabled);
  for(const id of ['session','refresh','logout','plan-focus','tactics-title','tactics-save'])assert.equal(await f.page.locator('#'+id).isDisabled(),true,id+' locks during save');
  for(const tab of ['home','plan','notes','tasks'])assert.equal(await f.page.locator('#navigation button[data-tab="'+tab+'"]').isDisabled(),true);
  const payload=f.requests.find(r=>r.path.endsWith('/diagrams/save'));
  assert.equal(payload.headers['x-csrf-token'],'fictional-tactics-csrf');assert.equal(payload.method,'POST');
  assert.equal(payload.payload.sessionId,rid(1));assert.equal(payload.payload.id,saved().id);assert.equal(payload.payload.expectedVersion,1);assert.equal(payload.payload.title,'Unsaved fictional tactics');assert.deepEqual(payload.payload.content,board());
  await f.page.locator('#tactics-save').evaluate(b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  await f.page.locator('#navigation button[data-tab="home"]').evaluate(b=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));
  assert.equal(count(f,'/diagrams/save'),1);assert.equal(await f.page.locator('#panel-plan').isVisible(),true);
  f.release('/diagrams/save','fail');await f.page.waitForFunction(()=>!CoachTactics.isBusy());
  assert.equal(await f.page.locator('#tactics-title').inputValue(),'Unsaved fictional tactics');assert.equal(await f.page.evaluate(()=>CoachTactics.isDirty()),true);
  assert.match(await f.page.locator('#tactics-status').innerText(),/Fictional save is unavailable/);
  assert.equal(await f.page.locator('#plan-focus').isEnabled(),true);
  checks++;

  f.state.saveMode='success';await f.page.locator('#tactics-save').click();await f.page.waitForFunction(()=>!CoachTactics.isBusy()&&!CoachTactics.isDirty());
  assert.equal(count(f,'/diagrams/save'),2);assert.equal(await f.page.locator('#session').isEnabled(),true);assert.equal(await f.page.locator('#logout').isEnabled(),true);
  assert.equal(f.state.diagrams[0].title,'Unsaved fictional tactics');assert.equal(f.state.diagrams[0].version,2);
  assert.deepEqual(f.errors,[]);checks++;
  await f.context.close();

  const g=await fixture();await enterPlan(g);g.state.listMode='delay';await beginBridgeList(g);
  await chooseDate(g,rid(2));assert.equal(await g.page.locator('#session').inputValue(),rid(2));
  g.release('/diagrams/list');await g.page.waitForFunction(()=>fixtureBridgeResult!==null);
  const late=await g.page.evaluate(()=>fixtureBridgeResult);assert.equal(late.ok,false);assert.match(late.message,/session changed/i);
  assert.equal(await g.page.locator('#tactics-title').inputValue(),'New drill');assert.equal(await g.page.locator('#tactics-library option').count(),1);
  assert.equal(count(g,'/diagrams/list'),1);assert.deepEqual(g.errors,[]);checks++;
  await g.context.close();

  const h=await fixture();await enterPlan(h);await openBoard(h);await h.page.locator('#tactics-library').selectOption(saved().id);
  h.state.listMode='delay';await beginBridgeList(h);h.state.saveMode='unauthorized';await h.page.locator('#tactics-title').fill('Private draft before expiry');await h.page.locator('#tactics-save').click();
  await h.page.locator('#login').waitFor({state:'visible'});assert.equal(await h.page.locator('#app').isVisible(),false);
  assert.equal(await h.page.locator('#tactics-board-tools').innerText(),'');assert.equal(await h.page.locator('#tactics-title').count(),0);
  assert.equal(await h.page.evaluate(()=>CoachTactics.isDirty()),false);assert.equal(await h.page.evaluate(()=>CoachTactics.isBusy()),false);
  h.release('/diagrams/list');await h.page.waitForFunction(()=>fixtureBridgeResult!==null);
  const expired=await h.page.evaluate(()=>fixtureBridgeResult);assert.equal(expired.ok,false);assert.match(expired.message,/session changed/i);
  assert(!await h.page.locator('#tactics-board-tools').innerText().then(text=>text.includes('Fictional saved setup')||text.includes('Private draft before expiry')));
  assert.equal(await h.page.locator('#tactics-title').count(),0);assert.deepEqual(h.errors,[]);checks++;
  await h.context.close();

  console.log('Coach tactics integration: '+checks+' grouped checks passed. Fictional requests only.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
