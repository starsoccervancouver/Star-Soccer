/* Winter camp navigation only; all transport is intercepted with fictional data. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
const origin='https://attendance.starsoccer.ca',rid=n=>'rec'+String(n).padStart(14,'0');
const profile={email:'coach@example.test',name:'Fixture Coach',role:'coach'},sessions=[];
for(const [week,start] of [[1,'2026-12-21'],[2,'2026-12-28']])for(let day=0;day<5;day++)for(const time of ['9:00 AM–12:00 PM','12:30–3:30 PM']){
 const date=new Date(start+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+day);
 sessions.push({id:rid(sessions.length+1),label:week===1?'Christmas camp':'Boxing Week camp',date:date.toISOString().slice(0,10),time,location:'Fixture Turf',status:'Scheduled',capacity:20,expected:0,capacityUsed:0,players:[],counts:{},issues:[]});
}
sessions.push({...sessions[0],id:rid(100),label:'Wednesday training',date:'2026-12-23',programId:rid(200)});
const assets={};for(const [url,file,type] of [['/workspace','workspace.html','text/html'],['/workspace/assets/workspace.js','workspace.js','text/javascript'],['/workspace/assets/workspace.css','workspace.css','text/css'],['/assets/app.css','app.css','text/css'],['/assets/logo.svg','logo.svg','image/svg+xml']])assets[url]={body:fs.readFileSync('private-attendance/web/'+file,'utf8'),type};
assets['/workspace/assets/passkeys.js']={body:'',type:'text/javascript'};require('./coach-fixture-fonts.cjs')(assets);
(async()=>{const browser=await chromium.launch();try{const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.setDefaultTimeout(6000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const Base=Date;window.Date=class extends Base{constructor(...a){super(...(a.length?a:['2026-12-24T18:00:00Z']));}static now(){return Base.parse('2026-12-24T18:00:00Z');}};});
 await page.route('**/*',async route=>{const path=new URL(route.request().url()).pathname;if(assets[path])return route.fulfill({contentType:assets[path].type,body:assets[path].body});let value;
 if(path.endsWith('/bootstrap'))value={profile,csrfToken:'fixture',googleEnabled:true};else if(path.endsWith('/desk'))value={profile,sessions,notes:[],tasks:[],observedAt:'2026-12-24T18:00:00Z'};else if(path.endsWith('/session'))value={plan:{version:0,content:{}}};else if(path.endsWith('/diagrams/list'))value={diagrams:[]};else if(path.endsWith('/drills/list'))value={drills:[]};else{errors.push('Unexpected request '+path);return route.abort();}return route.fulfill({contentType:'application/json',body:JSON.stringify(value)});});
 await page.goto(origin+'/workspace');await page.locator('.coach-camps-section').waitFor();assert.equal(await page.locator('.coach-camps-section .coaching-agenda-row').count(),2);
 await page.locator('.coach-camps-section button').first().click();assert.equal(await page.locator('#planner-dates-pane').isVisible(),true);assert.equal(await page.locator('[data-session-date-id]').count(),10);
 const week1=await page.locator('[data-session-date-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sessionDateId));assert.deepEqual(new Set(week1),new Set(sessions.slice(0,10).map(s=>s.id)));
 await page.locator('[data-session-date-id="'+rid(4)+'"]').click();assert.equal(await page.locator('#session').inputValue(),rid(4));
 await page.locator('#planner-back').click();assert.equal(await page.locator('#planner-days .coach-camps-heading').textContent(),'Camps');assert.equal(await page.locator('#planner-days button').count(),3);
 await page.locator('#planner-days button').filter({hasText:'Winter Camp — Week 2'}).click();assert.equal(await page.locator('#planner-dates-pane').isVisible(),true);const week2=await page.locator('[data-session-date-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.sessionDateId));assert.deepEqual(new Set(week2),new Set(sessions.slice(10,18).map(s=>s.id)));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);console.log('Camp UI passed: two camp cards, isolated week/day/slot selection, retained session IDs, mobile layout, no writes.');
 }finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
