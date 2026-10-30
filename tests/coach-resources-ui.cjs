/* Intercepted browser fixtures only: no real records or external link visits. */
const assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright');
const origin='https://attendance.starsoccer.ca',now='2026-10-30T19:00:00Z';
const profile={email:'coach@example.test',name:'Preview Coach',role:'coach',sessionVersion:1};
const resource=(id,extra={})=>({id,title:'Passing inspiration',url:'https://example.test/passing',kind:'video',topic:'Passing',notes:'Try an extra supporting player.',favourite:false,author_email:profile.email,request_id:id+'-create-request',created_at:now,updated_at:now,updated_by:profile.email,version:1,...extra});
const assets={};require('./coach-fixture-fonts.cjs')(assets);
for(const [path,file,type]of [['/workspace','workspace.html','text/html'],['/workspace/assets/workspace.js','workspace.js','text/javascript'],['/workspace/assets/workspace.css','workspace.css','text/css'],['/assets/app.css','app.css','text/css'],['/assets/logo.svg','logo.svg','image/svg+xml']])assets[path]={body:fs.readFileSync('private-attendance/web/'+file),type};assets['/workspace/assets/passkeys.js']={body:'',type:'text/javascript'};
(async()=>{const browser=await chromium.launch();try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),requests=[],errors=[];let signedIn=true,mode='normal',rows=[resource('resource_1'),resource('resource_2',{title:'Session design article',url:'https://example.test/planning',kind:'article',favourite:true,topic:'Planning'}),resource('resource_other',{title:'Private other coach link',author_email:'other@example.test',url:'https://example.test/private'})];
 await context.addInitScript(()=>{window.answers=[];window.confirm=()=>answers.shift()===true;window.copied=[];Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>copied.push(text)}});});
 await context.route('**/*',async route=>{const request=route.request(),url=new URL(request.url());if(url.origin!==origin){errors.push('External request '+url.origin);return route.abort();}if(assets[url.pathname])return route.fulfill({status:200,contentType:assets[url.pathname].type,body:assets[url.pathname].body});const payload=request.postData()?request.postDataJSON():null;requests.push({path:url.pathname,payload});let value,status=200;
  if(url.pathname.endsWith('/bootstrap'))value={profile:signedIn?profile:null,csrfToken:'preview-csrf',googleEnabled:true};
  else if(url.pathname.endsWith('/desk'))value={profile,sessions:[],notes:[],tasks:[],observedAt:now};
  else if(url.pathname.endsWith('/drills/list'))value={drills:[]};
  else if(url.pathname.endsWith('/resources/list'))value={resources:rows};
  else if(url.pathname.endsWith('/resources/save')){
   if(mode==='lost-before')return route.abort();const old=payload.id&&rows.find(row=>row.id===payload.id);
   if(old&&old.version!==payload.expectedVersion){status=409;value={error:'RESOURCE_CHANGED',message:'This link changed. Refresh before editing.'};}
   else{const saved=resource(old?.id||'resource_'+(rows.length+1),{...payload,version:(old?.version||0)+1,request_id:old?.request_id||payload.requestId});rows=[saved,...rows.filter(row=>row.id!==saved.id)];value={resource:saved};if(mode==='lost-after')return route.abort();}
  }else if(url.pathname.endsWith('/resources/archive')){rows=rows.filter(row=>row.id!==payload.id);value={saved:true};}
  else if(url.pathname.endsWith('/logout')){signedIn=false;value={signedOut:true};}
  else{errors.push('Unexpected request '+url.pathname);status=403;value={error:'UNEXPECTED'};}return route.fulfill({status,json:value});
 });
 const page=await context.newPage();page.setDefaultTimeout(6000);page.on('pageerror',error=>errors.push(error.message));const count=suffix=>requests.filter(row=>row.path.endsWith(suffix)).length;
 await page.goto(origin+'/workspace');await page.locator('#app').waitFor({state:'visible'});await page.getByRole('button',{name:'Coach resources',exact:true}).click();
 assert.equal(await page.locator('#resource-pane-drills').isVisible(),true);assert.equal(count('/resources/list'),0,'Inspiration loads only on demand');
 await page.getByRole('tab',{name:'Inspiration',exact:true}).click();await page.locator('#resources-reload').filter({hasText:'Refresh links'}).waitFor();await page.locator('[data-resource-id="resource_1"]').waitFor();
 assert.equal(await page.locator('.resource-card').count(),2);assert.doesNotMatch(await page.locator('#resources-list').innerText(),/Private other coach/);
 const link=page.locator('[data-resource-id="resource_1"] a');assert.equal(await link.getAttribute('href'),'https://example.test/passing');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');assert.equal(await page.locator('#coach-resources iframe').count(),0);
 await page.locator('#resources-search').fill('Session design');assert.equal(await page.locator('.resource-card').count(),1);await page.locator('#resources-search').fill('');await page.locator('#resources-kind').selectOption('video');assert.equal(await page.locator('.resource-card').count(),1);await page.locator('#resources-kind').selectOption('');
 await page.locator('#resources-favourites').check();assert.equal(await page.locator('.resource-card').count(),1);await page.locator('#resources-favourites').uncheck();
 await page.locator('[data-resource-id="resource_1"] button').first().click();await page.getByText('Link saved to your collection.',{exact:true}).waitFor();assert.equal(rows.find(row=>row.id==='resource_1').favourite,true);
 await page.locator('#resource-add').click();await page.locator('#resource-title').fill('New link');await page.getByRole('tab',{name:'Guides & kit'}).click();assert.equal(await page.locator('#resource-pane-inspiration').isVisible(),true,'Subtabs protect a draft');
 await page.locator('#navigation [data-tab="home"]').click();assert.equal(await page.locator('#panel-library').isVisible(),true,'Sidebar protects the same draft');
 await page.locator('#resource-url').fill('https://user:pass@example.test/private');const beforeInvalid=count('/resources/save');await page.locator('#resource-save').click();assert.equal(count('/resources/save'),beforeInvalid);
 await page.locator('#resource-url').fill('https://example.test/new');mode='lost-after';await page.locator('#resource-save').click();await page.locator('#resources-retry').waitFor({state:'visible'});assert.equal(await page.locator('#resource-title').inputValue(),'New link');
 mode='normal';await page.locator('#resources-reload').click();await page.getByText('Your previous action is verified.',{exact:true}).waitFor();assert.equal(rows.filter(row=>row.url==='https://example.test/new').length,1);assert.equal(await page.locator('#resource-form').isVisible(),false);
 await page.locator('#resource-add').click();await page.locator('#resource-title').fill('Retry safely');await page.locator('#resource-url').fill('https://example.test/retry');mode='lost-before';await page.locator('#resource-save').click();await page.locator('#resources-retry').waitFor({state:'visible'});const attempt=requests.filter(row=>row.path.endsWith('/resources/save')).at(-1).payload;
 mode='normal';await page.locator('#resources-retry').click();await page.getByText('Link saved to your collection.',{exact:true}).waitFor();assert.deepEqual(requests.filter(row=>row.path.endsWith('/resources/save')).at(-1).payload,attempt,'Recovery repeats the exact save');
 await page.locator('[data-resource-id="resource_1"]').getByRole('button',{name:'Edit',exact:true}).click();await page.locator('#resource-notes').fill('Updated coaching idea.');await page.locator('#resource-save').click();await page.getByText('Link saved to your collection.',{exact:true}).waitFor();assert.equal(rows.find(row=>row.id==='resource_1').notes,'Updated coaching idea.');
 await page.evaluate(()=>answers.push(true));await page.locator('[data-resource-id="resource_1"]').getByRole('button',{name:'Archive',exact:true}).click();await page.getByText('Link archived.',{exact:true}).waitFor();assert(!rows.some(row=>row.id==='resource_1'));
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'outputs/coach-resources-inspiration.png',fullPage:true});
 await page.getByRole('tab',{name:'Inspiration',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'Guides & kit'}).getAttribute('aria-selected'),'true');
 await page.getByRole('button',{name:'Copy outline',exact:true}).first().click();assert.match(await page.evaluate(()=>copied[0]),/Build a session/);await page.locator('#resource-kit-0').check();
 await page.screenshot({path:'outputs/coach-resources-guides.png',fullPage:true});
 for(const width of [320,390,768]){await page.setViewportSize({width,height:844});for(const tab of ['Drill library','Inspiration','Guides & kit']){await page.getByRole('tab',{name:tab,exact:true}).click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,tab+' fits at '+width);}}
 await page.getByRole('tab',{name:'Inspiration',exact:true}).click();await page.locator('#resource-add').click();await page.locator('#resource-title').fill('Unsaved private link');await page.evaluate(()=>answers.push(true));await page.locator('#logout').click();await page.locator('#login').waitFor({state:'visible'});
 assert.equal(await page.locator('#resources-list').textContent(),'');assert.equal(await page.locator('#resource-title').inputValue(),'');assert.equal(await page.locator('#resource-kit-0').isChecked(),false);
 assert.equal(requests.some(row=>/\/(attendance|notes|plans|diagrams)\//.test(row.path)),false);assert.deepEqual(errors,[]);await context.close();console.log('Coach Resources: private links, lazy loading, filters, favourites, edits, recovery, drafts, guide tools, keyboard, mobile and sign-out passed. Mock transport only.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1});
