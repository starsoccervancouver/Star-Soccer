/* Exercise the actual fallback on public pages. External requests are blocked. */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..'),origin='https://recovery.example.invalid';
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
(async()=>{
  const browser=await chromium.launch();let checks=0;
  try{
    const context=await browser.newContext({viewport:{width:320,height:740},acceptDownloads:true});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());if(url.origin!==origin)return route.abort();
      const file=path.resolve(root,'.'+url.pathname);
      if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return route.fulfill({status:404});
      return route.fulfill({body:fs.readFileSync(file),contentType:types[path.extname(file)]||'application/octet-stream'});
    });
    await context.addInitScript(()=>{
      const Base=Date,now=Base.parse('2026-11-05T19:00:00Z');window.Date=class extends Base{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
      const realFetch=window.fetch.bind(window);window.requests=[];
      window.fetch=async(url,options)=>{if(!String(url).includes('formspree.io/f/'))return realFetch(url,options);window.requests.push(Object.fromEntries(options.body));throw new TypeError('Fixture offline');};
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async value=>{window.copiedDetails=value;}}});
    });
    for(const url of ['/contact.html','/program-private-small-group.html','/registration.html?sessionId=wednesday&type=dropin','/christmas-camp-registration.html','/boxing-camp-registration.html']){
      const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+url);
      const form=page.locator('form');await form.locator('[type=submit]:not([disabled])').waitFor();
      await form.locator('[name=email]').fill('parent-entered@example.invalid');
      await page.evaluate(()=>{
        const form=document.querySelector('form');form.action='https://formspree.io/f/testform';
        for(const [name,value] of [['Message','Which group suits my child?'],['Player name','Alex <Fixture>'],['Player age','10'],['Youngest age','10'],['Experience','new']]){const field=form.elements.namedItem(name);if(field)field.value=value;}
        form.requestSubmit();
      });
      const section=page.locator('.form-recovery-actions');
      try{await section.waitFor({timeout:7000});}catch(error){console.error(url,await page.evaluate(()=>({invalid:[...document.querySelectorAll(':invalid')].filter(el=>el.name).map(el=>({name:el.name,value:el.value,message:el.validationMessage})),requests:window.requests,status:document.querySelector('[data-feedback],#registration-status,#camp-status')?.textContent})),errors);throw error;}
      const body=await section.locator('textarea').inputValue();assert.match(body,/email: parent-entered@example\.invalid/);assert(!body.includes('_replyto'));assert(!body.includes('_captcha'));assert(!body.includes('[object Object]'));
      const email=new URL(await section.locator('a').getAttribute('href'));assert.equal(email.protocol,'mailto:');assert.equal(email.pathname,'starsoccervancouver@gmail.com');
      await section.getByRole('button',{name:'Copy details',exact:true}).click();assert.equal(await page.evaluate(()=>window.copiedDetails),body);
      await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined}));
      await section.getByRole('button',{name:'Copy details',exact:true}).click();assert.equal(await section.locator('details').evaluate(el=>el.open),true);
      assert.equal(await section.locator('textarea').evaluate(el=>el.selectionEnd-el.selectionStart),body.length);
      const downloadPromise=page.waitForEvent('download');await section.getByRole('button',{name:'Save a copy',exact:true}).click();const download=await downloadPromise;assert.equal(fs.readFileSync(await download.path(),'utf8'),body);
      await page.evaluate(()=>document.querySelector('form').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(await page.evaluate(()=>window.requests.length),1);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No mobile overflow: '+url);
      assert.deepEqual(errors,[]);checks++;await page.close();
    }
    // Long requests remain complete in copy/download instead of a truncated mailto link.
    const page=await context.newPage();await page.goto(origin+'/contact.html');
    await page.waitForFunction(()=>Boolean(window.StarFormRecovery));
    await page.evaluate(()=>{const target=document.createElement('div');document.body.append(target);const data=new FormData();data.set('email','parent@example.invalid');data.set('Message','Long message '.repeat(250)+'END');StarFormRecovery.show(target,{email:'starsoccervancouver@gmail.com',requests:[data],reference:'TEST',subject:'Fixture\r\nSubject'});});
    const long=page.locator('.form-recovery-actions');const link=new URL(await long.locator('a').getAttribute('href'));assert.equal(link.searchParams.get('body'),null);assert.equal(link.searchParams.get('subject'),'Fixture  Subject');assert.match(await long.locator('textarea').inputValue(),/END\n$/);checks++;
    console.log(checks+' actual recovery flows passed; no external submissions.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
