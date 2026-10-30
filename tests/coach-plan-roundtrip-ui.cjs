/* Real workspace + in-memory production plan store; every request is intercepted. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright'),{openSession}=require('./coach-fixture-navigation.cjs');
(async()=>{
 const [{createCoachStore,OWNER_EMAIL},{openStore}]=await Promise.all([import('../private-attendance/coach-store.mjs'),import('../private-attendance/sqlite-store.mjs')]);
 const store=openStore(),coaches=createCoachStore({store}),profile=coaches.actor(OWNER_EMAIL),rid=n=>'rec'+String(n).padStart(14,'0'),origin='https://fixture.test';
 const sessions=[1,2,3].map(n=>({id:rid(n),programId:rid(900),date:'2026-11-0'+n,time:'4–5 PM',location:'Fixture field',status:n===3?'Cancelled':'Planned',capacity:20,capacityUsed:0,expected:0,registered:0,issues:[],counts:{yes:0,no:0,confirmed:0,awaiting:0},players:[]}));
 coaches.savePlan(profile,{sessionId:rid(1),expectedVersion:0,content:{focus:'Legacy focus',warmup:'Original warmup',technical:'Original technical',game:'Original game',equipment:'Original kit',reflection:'Original reflection'}});
 const assets={}; for(const [url,file,type]of [['/workspace','workspace.html','text/html'],['/workspace/assets/workspace.css','workspace.css','text/css'],['/workspace/assets/workspace.js','workspace.js','text/javascript'],['/assets/app.css','app.css','text/css'],['/assets/logo.svg','logo.svg','image/svg+xml'],['/workspace/assets/blocks.js','workspace-blocks.js','text/javascript'],['/workspace/assets/blocks.css','workspace-blocks.css','text/css']])assets[url]={body:fs.readFileSync('private-attendance/web/'+file,'utf8'),type};
 assets['/workspace/assets/passkeys.js']={body:fs.readFileSync('node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js','utf8'),type:'text/javascript'}; require('./coach-fixture-fonts.cjs')(assets);
 const browser=await chromium.launch();let signedIn=true,posts=0,loseResponse=true;
 try{
 const page=await browser.newPage();page.setDefaultTimeout(6000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>{window.confirm=()=>false;});
 await page.route('**/*',async route=>{const req=route.request(),url=new URL(req.url());assert.equal(url.origin,origin);if(assets[url.pathname])return route.fulfill({contentType:assets[url.pathname].type,body:assets[url.pathname].body});const payload=req.postData()?req.postDataJSON():{};let value;
 if(url.pathname.endsWith('/bootstrap'))value={profile:signedIn?profile:null,csrfToken:'fixture-token'};
 else if(url.pathname.endsWith('/desk'))value={profile,sessions,notes:[],tasks:[],observedAt:new Date().toISOString()};
 else if(url.pathname.endsWith('/session'))value={plan:coaches.plan(profile,payload.sessionId)};
 else if(url.pathname.endsWith('/plans/save')){posts++;value={plan:coaches.savePlan(profile,payload)};if(loseResponse){loseResponse=false;return route.abort('failed');}}
 else if(url.pathname.endsWith('/logout')){signedIn=false;value={ok:true};}
 else if(url.pathname.endsWith('/diagrams')||url.pathname.endsWith('/drills'))value={diagrams:[],drills:[]};
 else throw Error('Unexpected fixture route '+url.pathname);
 return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
 });
 await page.goto(origin+'/workspace');await page.locator('#app').waitFor({state:'visible'});await openSession(page,sessions,rid(1),'plan');
 assert.equal(await page.evaluate(()=>CoachPlanBlocks.content()),undefined);
 await page.getByRole('button',{name:'First-touch starter',exact:true}).click();assert.equal(posts,0);assert.equal(await page.locator('#plan-state').isVisible(),true);
 assert.equal(await page.evaluate(()=>{const diagram={schemaVersion:1,pitch:'full',items:[{id:'ball',kind:'ball',label:''}],frames:[{id:'start',title:'Receive and turn',duration:3,positions:[{id:'ball',x:35,y:40}]}]};return CoachPlanBlocks.addDrill({target:'technical',title:'Diagram activity',text:'Receive, scan and turn.',minutes:8,diagram});}),true);
 assert.equal(await page.locator('#plan-activities .plan-block-diagram-preview svg').count(),1);
 await page.locator('#planner-back').click();assert.equal(await page.locator('#plan-block-0-title').isVisible(),true,'Declining navigation preserves draft');
 await page.locator('#planner-save').click();await page.waitForFunction(()=>!CoachPlanBlocks.isDirty());assert.equal(posts,1,'Uncertain response reads back instead of a second POST');
 assert.equal(coaches.plan(profile,rid(1)).version,2);assert.equal(coaches.plan(profile,rid(1)).content.warmup,'Original warmup');assert.equal(coaches.plan(profile,rid(1)).content.reflection,'Original reflection');
 assert.equal(coaches.plan(profile,rid(1)).content.activities[4].diagram.frames[0].positions[0].x,35,'One plan save stores the diagram snapshot');
 await page.reload();await page.locator('#app').waitFor({state:'visible'});await openSession(page,sessions,rid(1),'plan');assert.equal(await page.locator('.plan-block').count(),5);assert.equal(await page.locator('#plan-block-0-duration').inputValue(),'10');assert.equal(await page.locator('#plan-technical').inputValue(),'Original technical');
 assert.equal(await page.locator('#plan-activities .plan-block-diagram-preview svg').count(),1,'Reload restores the activity thumbnail');
 await openSession(page,sessions,rid(2),'plan');await page.evaluate(id=>window.dispatchEvent(new CustomEvent('coach:copy-plan',{detail:{sourceSessionId:id}})),rid(1));await page.waitForFunction(()=>CoachPlanBlocks.content()?.length===5);assert.equal(posts,1);assert.equal(await page.locator('#plan-reflection').inputValue(),'','Copy retains destination reflection');
 await page.locator('#planner-save').click();await page.waitForFunction(()=>!CoachPlanBlocks.isDirty());assert.equal(posts,2);assert.equal(coaches.plan(profile,rid(2)).content.activities.length,5);
 assert.deepEqual(coaches.plan(profile,rid(2)).content.activities[4].diagram,coaches.plan(profile,rid(1)).content.activities[4].diagram,'Plan copy retains the snapshot');
 await page.evaluate(()=>{window.print=()=>{window.printedDiagramCount=document.querySelectorAll('#session-print-sheet .plan-block-diagram-preview svg').length;};});
 if(process.env.COACH_PLAN_SNAPSHOT_SCREENSHOT_DIR){const dir=process.env.COACH_PLAN_SNAPSHOT_SCREENSHOT_DIR;fs.mkdirSync(dir,{recursive:true});await page.setViewportSize({width:390,height:844});await page.evaluate(()=>{document.getElementById('notice').hidden=true;});await page.locator('[data-block-index="4"] .plan-block-diagram').scrollIntoViewIfNeeded();await page.locator('[data-block-index="4"] .plan-block-diagram').screenshot({path:require('node:path').join(dir,'activity-diagram-phone.png')});}
 await page.locator('#planner-open-run').click();await page.locator('#open-field-view').click();await page.locator('#field-stage-activity-4').click();assert.equal(await page.locator('#field-stage-diagram svg').count(),1);
 if(process.env.COACH_PLAN_SNAPSHOT_SCREENSHOT_DIR){await page.locator('#field-stage-diagram').scrollIntoViewIfNeeded();await page.screenshot({path:require('node:path').join(process.env.COACH_PLAN_SNAPSHOT_SCREENSHOT_DIR,'field-diagram-phone.png')});}
 await page.locator('#field-print-session').click();assert.equal(await page.evaluate(()=>printedDiagramCount),1);await page.locator('#close-field-view').click();await page.locator('#planner-close-drawer').click();
 await openSession(page,sessions,rid(3),'plan',{ready:false});await page.waitForFunction(()=>document.getElementById('plan-load-status').textContent.includes('read-only'));assert.equal(await page.locator('#plan-add-activity').isDisabled(),true);
 await page.locator('#planner-home').click();await page.locator('#logout').click();await page.locator('#login').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>CoachPlanBlocks.content()),undefined);assert.equal(await page.locator('.plan-block').count(),0);assert.deepEqual(errors,[]);
 console.log('PASS: real workspace legacy/block save+reload, copy, dirty navigation, uncertain-save single POST, cancelled read-only, logout cleanup');
 }finally{await browser.close();store.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
