/* Same-origin browser harness. All form requests below are mocked; no email is sent. */
(async () => {
  const frame=document.querySelector('#site'),results=document.querySelector('#results');
  let passed=0,failed=0;
  function check(condition,message) {
    const li=document.createElement('li');li.textContent=(condition?'PASS: ':'FAIL: ')+message;
    if(condition)passed++;else{failed++;li.className='fail';}results.append(li);
  }
  async function load(url,width=375) {
    frame.style.width=width+'px';
    await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Page load timed out: '+url)),15000);
      frame.onload=()=>{clearTimeout(timeout);resolve();};
      // Force a document load even when the harness last replaced this URL.
      if(frame.contentWindow.location.href===new URL('../'+url,location.href).href)frame.contentWindow.location.reload();
      else frame.src='../'+url;
    });
    const doc=frame.contentDocument;
    await doc.fonts.ready;
    await new Promise(resolve=>frame.contentWindow.requestAnimationFrame(()=>frame.contentWindow.requestAnimationFrame(resolve)));
    for(let i=0;i<200 && doc.documentElement.dataset.countsState==='loading';i++)await new Promise(resolve=>setTimeout(resolve,10));
    const numeric=[...doc.querySelectorAll('input[type="number"]:not([data-native-number])')].filter(el=>el.step!=='any' && !el.closest('.honeypot,[aria-hidden="true"]'));
    for(let i=0;i<100 && numeric.some(el=>!el.closest('.ss-number-stepper'));i++)await new Promise(resolve=>setTimeout(resolve,10));
    return doc;
  }
  const change=(doc,id,value)=>{const el=doc.getElementById(id);el.value=value;el.dispatchEvent(new frame.contentWindow.Event('change',{bubbles:true}));};
  try {
    const pages=['index.html','programs.html','program-private-small-group.html','methodology.html','locations.html','contact.html','camps.html','christmas-camp-registration.html','boxing-camp-registration.html','selectivo.html','registration.html?sessionId=wednesday&type=pass4','registration-thank-you.html'];
    for(const width of [320,375,430,900,1024,1440]) {
      for(const page of pages) {
        const doc=await load(page,width);
        const overflow=doc.documentElement.scrollWidth-doc.documentElement.clientWidth;
        const oversized=[...doc.body.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>doc.documentElement.clientWidth+1).slice(0,4).map(el=>el.className).join(', ');
        check(overflow<=1,`${page} at ${width}px has no horizontal overflow${overflow>1?' ('+overflow+'px; '+oversized+')':''}`);
        const header=doc.querySelector('.site-header').getBoundingClientRect();
        check(Math.abs(header.left)<=1 && Math.abs(header.right-doc.documentElement.clientWidth)<=1,`${page} at ${width}px has navigation across the full screen width`);
        check(!doc.querySelector('.site-nav .header-program-cta') && [...doc.querySelectorAll('.site-nav a')].some(a=>a.getAttribute('href')==='programs.html'),`${page} at ${width}px keeps Weekly Training without a duplicate Find a Session tab`);
        const numeric=[...doc.querySelectorAll('input[type="number"]:not([data-native-number])')].filter(el=>el.step!=='any' && !el.closest('.honeypot,[aria-hidden="true"]'));
        if(numeric.length){
          check(numeric.every(el=>el.closest('.ss-number-stepper') && el.labels.length && !el.closest('label')),`${page} at ${width}px enhances number fields while preserving an associated label`);
          check(numeric.every(el=>[...el.closest('.ss-number-stepper').querySelectorAll('button')].length===2 && [...el.closest('.ss-number-stepper').querySelectorAll('button')].every(button=>button.type==='button' && button.getAttribute('aria-controls')===el.id && button.getAttribute('aria-label') && button.getBoundingClientRect().width>=44 && button.getBoundingClientRect().height>=44)),`${page} at ${width}px has labelled 44px minus and plus controls that cannot submit the form`);
        }
        if(page==='index.html') {
          const programs=doc.querySelector('.hero-action-programs'),camps=doc.querySelector('.hero-action-camps');
          check(programs && camps && programs.getAttribute('href')==='programs.html#sessions' && camps.getAttribute('href')==='camps.html',`Homepage at ${width}px keeps the two approved program and camp destinations`);
          check(programs && camps && [programs,camps].every(el=>el.getClientRects().length && el.getBoundingClientRect().height>=48),`Homepage at ${width}px shows large program and camp actions`);
          check(camps && ['$200','save $50','$185','save $65','$250','per player'].every(text=>camps.textContent.includes(text)),`Homepage at ${width}px states both winter discounts and the per-player basis`);
          check(doc.querySelector('h1').textContent.includes('the beautiful game'),`Homepage at ${width}px uses the approved headline`);
          const copy=doc.querySelector('.immersive-hero-copy').getBoundingClientRect(),actions=doc.querySelector('.hero-action-panel').getBoundingClientRect();
          check(width>900?actions.left>=copy.right:actions.top>=copy.bottom,`Homepage at ${width}px places choices to the right on desktop and below on mobile`);
        }
        if(page==='camps.html') {
          const links=[...doc.querySelectorAll('.camp-week-card .winter-camp-cta')];
          check(links.length===2 && links.every(el=>el.getBoundingClientRect().bottom<=740 && el.getBoundingClientRect().height>=48),`Camps at ${width}px shows both registration buttons within the first 740px (${Math.round(links.at(-1).getBoundingClientRect().bottom)}px)`);
          check(!doc.querySelector('.camp-overview') && [...doc.querySelectorAll('.camp-card-details')].every(el=>el.textContent.includes('20 players') && el.textContent.includes('noon–12:30')),`Camp cards at ${width}px include capacity and supervised lunch details`);
          check([...doc.querySelectorAll('.camp-week-card,.seasonal-feature')].every(el=>!frame.contentWindow.getComputedStyle(el,'::before').backgroundImage.includes('url(') && frame.contentWindow.getComputedStyle(el).backgroundImage==='none'),`Camp cards at ${width}px have solid surfaces without photography`);
        }
        if(page==='programs.html') {
          const actions=[...doc.querySelectorAll('.schedule-direct-actions a')];
          check(actions.length===8 && actions.every(el=>el.getClientRects().length && el.getBoundingClientRect().height>=48),`Training at ${width}px shows direct drop-in and pass buttons on every card`);
          check(!doc.querySelector('details.schedule-entry,.session-share'),`Training at ${width}px has no registration disclosure or copy-link step`);
          if(width<=430)check(actions.slice(0,2).every(el=>el.getBoundingClientRect().bottom<=740),`Training at ${width}px shows the first session's registration buttons within 740px (${Math.round(actions[0].getBoundingClientRect().bottom)}px)`);
        }
        if(doc.body.classList.contains('quick-flow') && width<=430){
          const form=doc.querySelector('form'),submit=form.querySelector('[type="submit"]');
          // The approved private form and 44px stepper rows stack on narrow phones.
          const limit=doc.body.classList.contains('private-registration')?950:(width<=420 && numeric.length?850:740);
          check(submit.getBoundingClientRect().bottom<=limit && submit.getBoundingClientRect().height>=48,`${page} at ${width}px keeps a large submit button within ${limit}px (${Math.round(submit.getBoundingClientRect().bottom)}px)`);
          check([...form.querySelectorAll('[required]')].filter(el=>el.getClientRects().length).length<=4,`${page} starts with at most four essential inputs`);
        }
        if(doc.body.classList.contains('seasonal-registration')){
          const more=doc.querySelector('[data-optional-fields]');
          check(doc.querySelectorAll('form details').length===1 && !more.open && more.querySelector('summary').textContent==='Tell us more (optional)' && more.nextElementSibling.matches('[type="submit"]') && !more.querySelector('[required]'),`${page} at ${width}px has one optional Tell us more directly before registration`);
          const panel=doc.querySelector('.quick-panel').getBoundingClientRect(),info=doc.querySelector('.registration-info').getBoundingClientRect();
          check(info.width>0,`${page} at ${width}px shows its information card`);
          if(width>=900)check(panel.width>info.width*1.5 && info.left>=panel.right,`${page} at ${width}px gives the registration form more space beside the info card`);
          if(width<=430)check(info.top>=panel.bottom,`${page} at ${width}px keeps the form before the information card`);
          const theme=frame.contentWindow.getComputedStyle(doc.body).getPropertyValue('--registration-art');
          check(theme.includes(page.startsWith('registration.html')?'autumn-field':'winter-field'),`${page} at ${width}px uses its matching seasonal artwork`);
          check(!doc.querySelector('.registration-info img') && frame.contentWindow.getComputedStyle(doc.querySelector('.registration-info')).backgroundColor==='rgb(16, 38, 61)',`${page} at ${width}px keeps imagery outside the opaque information card`);
          if(page.startsWith('registration.html')){
            const trigger=doc.querySelector('#pass-calendar-trigger'),picker=doc.querySelector('#pass-calendar');
            trigger.click();const r=picker.getBoundingClientRect();
            check(picker.open && doc.querySelector('#pass-start').hidden && r.left>=0 && r.right<=width && r.height<=716,`Pass calendar at ${width}px replaces the native picker and fits the screen`);
            check([...picker.querySelectorAll('.pass-calendar-day:not(:disabled)')].every(day=>new Date(day.dataset.date+'T12:00:00Z').getUTCDay()===3),`Pass calendar at ${width}px only offers Wednesday start dates`);
            picker.querySelector('.pass-calendar-cancel').click();
          }
        }
        if(doc.body.matches('.fall-programs-page,.winter-camps-page,.seasonal-registration')){
          const bg=frame.contentWindow.getComputedStyle(doc.body,'::before');
          check(bg.position==='fixed' && bg.backgroundImage.includes('-field-') && !doc.querySelector('.fall-hero-art,.winter-hero-art'),`${page} at ${width}px uses one continuous seasonal page background`);
        }
        if(page==='contact.html'){
          const more=doc.querySelector('[data-optional-fields]');
          check(!more.open && more.querySelector('summary').textContent==='Tell us more (optional)' && more.nextElementSibling.matches('[type="submit"]'),`Contact at ${width}px puts a collapsed Tell us more immediately before Send`);
          check(!more.querySelector('[required]') && more.querySelector('[name="Name"]') && more.querySelector('[name="Topic"]') && more.querySelector('[name="Referral source"]'),`Contact at ${width}px keeps name, topic and referral details optional`);
          const formCard=doc.querySelector('.quick-panel').getBoundingClientRect();
          const infoCard=doc.querySelector('.registration-info');
          const infoRect=infoCard.getBoundingClientRect();
          check(infoRect.width>0 && infoCard.textContent.includes('as soon as possible') && infoCard.querySelector('a[href="mailto:starsoccervancouver@gmail.com"]'),`Contact at ${width}px shows the response information card and verified email`);
          if(width>=900)check(infoRect.left>=formCard.right && formCard.width>infoRect.width*1.4,`Contact at ${width}px keeps the form wider than the right-hand guide`);
          if(width<=430)check(infoRect.top>=formCard.bottom,`Contact at ${width}px stacks the information card below the form`);
        }
        if(['contact.html','locations.html','methodology.html'].includes(page)){
          const bg=frame.contentWindow.getComputedStyle(doc.body,'::before');
          check(bg.position==='fixed' && bg.backgroundImage.includes(page==='contact.html'?'1497366754035':page==='locations.html'?'1556056504':'photo-1652318696037-8d34c4d2f378'),`${page} at ${width}px has its distinct full-page themed background`);
        }
        if(page==='methodology.html'){
          const nav=doc.querySelector('.method-restored-nav');
          const navStyle=frame.contentWindow.getComputedStyle(nav);
          check(navStyle.backgroundColor==='rgba(0, 0, 0, 0)' && navStyle.backgroundImage==='none' && navStyle.boxShadow==='none',`Our Approach at ${width}px has no solid bar behind the section links`);
          check([...nav.querySelectorAll('a')].every(link=>link.getBoundingClientRect().height>=44),`Our Approach at ${width}px keeps the links easy to tap`);
        }
        if(width<=430) {
          const controls=[...doc.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(el=>el.getClientRects().length && !el.closest('[aria-hidden="true"]'));
          if(controls.length)check(controls.every(el=>parseFloat(frame.contentWindow.getComputedStyle(el).fontSize)>=16),`${page} at ${width}px uses readable 16px form controls`);
          if(page==='index.html') {
            check([...doc.querySelectorAll('.home-contact-column a')].every(el=>el.getBoundingClientRect().height>=44),`Footer links at ${width}px have 44px touch targets`);
          }
        }
      }
    }
    let doc=await load('camps.html',320);
    for(const details of doc.querySelectorAll('.camp-card-details'))details.querySelector('summary').click();
    check([...doc.querySelectorAll('.camp-card-details')].every(el=>el.open && el.querySelector('ul').getClientRects().length) && doc.documentElement.scrollWidth<=321,'Both camp detail disclosures open without overflow at 320px');
    doc=await load('programs.html',320);
    check(!doc.querySelector('[data-filter-panel]').open && doc.querySelector('.schedule-entry-main').getBoundingClientRect().bottom<=740,'Training starts with visible sessions and expandable optional filters ('+Math.round(doc.querySelector('.schedule-entry-main').getBoundingClientRect().bottom)+'px)');
    doc.querySelector('[data-filter-panel] summary').click();
    check(doc.querySelector('#schedule-age').getClientRects().length>0,'Training filter disclosure exposes working controls');
    check(doc.querySelector('[data-session-day="friday"] .session-capacity').textContent==='3/20 players · 17 places remaining','Schedule shows the dated ledger count');
    check(doc.querySelector('[data-session-day="thursday"] .session-capacity').textContent==='0/20 players · 20 places remaining','Recorded zero is shown as zero');
    check(!doc.querySelector('.count-refresh') && doc.documentElement.dataset.countsState==='ready','Counts load automatically without a refresh button');
    check(!doc.querySelector('.count-feed-note'),'Training page keeps session counts without the ledger-status message');
    frame.contentWindow.fetch=async()=>{throw new TypeError('Offline');};
    doc.dispatchEvent(new frame.contentWindow.Event('visibilitychange'));
    for(let i=0;i<100 && doc.documentElement.dataset.countsState==='loading';i++)await new Promise(resolve=>setTimeout(resolve,10));
    check([...doc.querySelectorAll('.session-capacity')].every(el=>el.textContent==='Capacity 20 · Count unavailable'),'Failed refresh removes old counts and never substitutes zero');
    doc=await load('registration.html?sessionId=friday&type=dropin',320);
    check(![...doc.querySelectorAll('input[type="date"]')].some(el=>el.getClientRects().length) && !doc.querySelector('.count-feed-note') && !doc.querySelector('[data-optional-fields]').open,'Weekly registration keeps the date picker and optional questions out of the initial flow');
    check([...doc.querySelector('form').querySelectorAll('[required]')].map(el=>el.name).sort().join(',')==='Experience,Player age,Player name,email','Weekly registration requires exactly child, age, email and experience');
    check(doc.querySelector('[data-training-info-option]').textContent==='Friday · Drop-in' && doc.querySelector('[data-training-info-price]').textContent==='$25 CAD' && doc.querySelector('[data-training-info-venue]').textContent==='Connaught Park','Drop-in information card follows the selected session and approved price');
    doc=await load('programs.html?age=14&day=sunday&source=test#sessions');
    check(doc.querySelector('[data-filter-panel]').open,'Shared filtered links open the filter controls automatically');
    check(!doc.querySelector('#schedule-empty').hidden,'Incompatible age/day shows empty state');
    doc.querySelector('#schedule-reset').click();
    check(doc.querySelectorAll('.schedule-entry:not([hidden])').length===4,'Clear filters restores every session');
    check(frame.contentWindow.location.search==='?source=test' && frame.contentWindow.location.hash==='#sessions','Clear filters preserves unrelated query and anchor');
    change(doc,'schedule-age','14');
    check(doc.querySelectorAll('.schedule-entry:not([hidden])').length===1,'Age 14 shows only eligible training');
    check(frame.contentWindow.location.search.includes('age=14'),'Filter is reflected in shareable URL');
    check(doc.querySelectorAll('.schedule-next').length===4,'Every session shows its next Vancouver date');
    const url=frame.contentWindow.location.href;
    doc=await load(url.split('/').pop());
    check(doc.querySelector('#schedule-age').value==='14' && doc.querySelectorAll('.schedule-entry:not([hidden])').length===1,'Reload restores the selected filter');
    const toggle=doc.querySelector('.mobile-nav-toggle');toggle.click();
    check(toggle.getAttribute('aria-label').toLowerCase().includes(toggle.textContent.toLowerCase()),'Navigation accessible name includes the visible button label');
    check(toggle.getAttribute('aria-expanded')==='true' && frame.contentWindow.getComputedStyle(doc.querySelector('nav')).display!=='none','Mobile menu opens');
    check([...doc.querySelectorAll('nav a')].every(el=>el.getBoundingClientRect().height>=44),'Expanded mobile menu links have 44px touch targets');
    doc.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    check(toggle.getAttribute('aria-expanded')==='false' && doc.activeElement===toggle,'Escape closes menu and returns focus');
    check(!doc.querySelector('.header-program-cta') && [...doc.querySelectorAll('nav a')].some(a=>a.getAttribute('href')==='programs.html'),'Navigation removes redundant session CTA and retains Weekly Training');
    for(const day of ['wednesday','thursday','friday','sunday']) {
      doc=await load('programs.html?day='+day,320);
      const row=doc.querySelector('.schedule-entry:not([hidden])'),links=[...row.querySelectorAll('.schedule-direct-actions a')];
      check(doc.querySelectorAll('.schedule-entry:not([hidden])').length===1 && links.length===2 && links.every(el=>el.getClientRects().length),'Shared '+day+' link shows both registration options immediately');
      check(links.every((el,i)=>{const u=new URL(el.href);return u.searchParams.get('sessionId')===day && u.searchParams.get('type')===['dropin','pass4'][i];}),'Direct '+day+' links select the correct group and registration type');
      check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth+1,day+' registration choices have no overflow at 320px');
    }
    doc=await load('programs.html?day=friday&age=8&email=private%40example.invalid#sessions',320);
    const fridayLinks=[...doc.querySelectorAll('[data-session-day="friday"] .schedule-direct-actions a')];
    check(fridayLinks.every(el=>!new URL(el.href).searchParams.has('email') && !new URL(el.href).searchParams.has('age')),'Registration links keep session and product without forwarding unrelated query values');
    doc=await load('registration.html?sessionId=camp-u4-u6&type=dropin');
    check(doc.querySelector('#training-registration').hidden && doc.querySelector('#registration-status').textContent.includes('no longer available'),'Retired camp registration is rejected');
    doc=await load('registration.html?sessionId=wednesday&type=pass4');
    const win=frame.contentWindow,form=doc.querySelector('form');
    check(!form.elements.namedItem('Start date') && !form.elements.namedItem('Parent name').required && !form.elements.namedItem('Referral source').required,'Pass keeps extra context optional and the chosen start date separate');
    const passPlan=frame.contentWindow.StarWeeklySignup.passPlan('wednesday');
    check(!doc.querySelector('#quick-pass-summary').hidden && doc.querySelector('#pass-price').textContent.includes('$95') && doc.querySelector('#pass-start').value===passPlan.start && doc.querySelector('#pass-end').textContent===frame.contentWindow.StarTraining.prettyDate(passPlan.end),'Pass preview shows the approved total, upcoming start and fourth-session end');
    const changedStart=frame.contentWindow.StarTraining.addDays(passPlan.start,7);
    const calendarTrigger=doc.querySelector('#pass-calendar-trigger'),picker=doc.querySelector('#pass-calendar');
    calendarTrigger.click();
    if(!picker.querySelector('[data-date="'+changedStart+'"]'))picker.querySelector('.pass-calendar-arrow[aria-label="Next month"]').click();
    picker.querySelector('[data-date="'+changedStart+'"]').click();
    await new Promise(resolve=>setTimeout(resolve,20));
    check(!picker.open && doc.querySelector('#pass-start').value===changedStart && doc.activeElement===calendarTrigger && calendarTrigger.getAttribute('aria-expanded')==='false','Choosing a calendar day saves the date, closes the panel and returns focus');
    const chosenPassPlan=frame.contentWindow.StarWeeklySignup.passPlan('wednesday',changedStart);
    check(doc.querySelector('#pass-end').textContent===frame.contentWindow.StarTraining.prettyDate(chosenPassPlan.end),'Changing the start on the form updates the fourth-session end immediately');
    check(doc.querySelector('[data-training-info-date]').textContent===frame.contentWindow.StarTraining.prettyDate(chosenPassPlan.start) && doc.querySelector('[data-training-info-end]').textContent===frame.contentWindow.StarTraining.prettyDate(chosenPassPlan.end),'Pass information card updates both dates when the parent changes the start');
    calendarTrigger.click();
    doc.activeElement.dispatchEvent(new win.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
    check(doc.activeElement.dataset.date===win.StarTraining.addDays(changedStart,7),'Calendar arrow keys move focus between eligible training dates across months');
    picker.dispatchEvent(new win.Event('cancel',{cancelable:true}));
    await new Promise(resolve=>setTimeout(resolve,20));
    check(!picker.open && doc.querySelector('#pass-start').value===changedStart && doc.activeElement===calendarTrigger,'Cancelling keyboard selection preserves the selected start date and restores focus');
    for(const [name,value] of [['email','test@example.invalid'],['Player name','Test Player'],['Player age','10'],['Experience','some']])form.elements.namedItem(name).value=value;
    form.querySelector('[data-optional-fields] summary').click();
    for(const [name,value] of [['Parent name','Example Parent'],['Notes','Working on confidence'],['Referral source','community']])form.elements.namedItem(name).value=value;
    let calls=0,receivedData,firstReference;
    win.fetch=async(url,options)=>{calls++;receivedData=options.body;firstReference=receivedData.get('Client reference');return {ok:true,json:async()=>({success:false})};};
    form.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(calls===1 && doc.querySelector('#receipt').hidden && !form.hidden && form.elements.namedItem('Player name').value==='Test Player','Service rejection retains entries and cannot show a receipt');
    check(receivedData.get('Parent name')==='Example Parent' && receivedData.get('Notes')==='Working on confidence' && receivedData.get('Referral source')==='School / community','Weekly registration preserves optional parent, coach note and referral context');
    check(receivedData.get('Experience')==='Some experience' && receivedData.get('Registration version')==='SS-PASS-V1' && receivedData.get('Requested option')==='Four-session pass' && receivedData.get('Covered dates')===chosenPassPlan.dates.join(', ') && receivedData.get('Price CAD')==='95' && receivedData.get('Expected end date')===chosenPassPlan.end && receivedData.get('Pass start date')===changedStart && receivedData.get('Pass start choice')==='Selected date','Pass payload carries the quoted four dates and correct price for authoritative intake validation');
    const recovery=doc.querySelector('.registration-recovery a'),help=new URL(recovery.href),helpBody=help.searchParams.get('body');
    check(help.protocol==='mailto:' && helpBody.includes(firstReference) && helpBody.includes('not confirmed') && !helpBody.includes('Test Player') && !helpBody.includes('test@example.invalid'),'Failure recovery keeps the reference without personal form entries');
    win.fetch=async(url,options)=>{calls++;receivedData=options.body;return {ok:true,json:async()=>({success:true})};};
    form.requestSubmit();form.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(calls===2 && form.hidden && !doc.querySelector('#receipt').hidden,'Accepted registration shows receipt and blocks duplicate submission');
    check(receivedData.get('Client reference')===firstReference && doc.querySelector('.registration-recovery').hidden,'Retries keep the same reference and hide stale recovery on acceptance');
    check(doc.querySelector('#receipt').textContent.includes('pass confirmation') && doc.querySelector('#receipt').textContent.includes('payment') && doc.querySelector('#receipt').textContent.includes('$95') && doc.querySelector('#receipt').textContent.includes('4th session'),'Pass receipt preserves price and expected dates with email/payment follow-up');
    check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth+1,'Weekly receipt fits a narrow phone');
    doc=await load('program-private-small-group.html?coach=romeo');
    check(doc.querySelector('[name="Preferred coach"]').value==='romeo','Coach preference survives the inquiry link');
    check(doc.querySelector('[name="Referral source"]') && !doc.querySelector('[name="Referral source"]').required,'Private inquiry also offers optional referral source');
    const players=doc.querySelector('[name="Players"]'),stepper=players.closest('.ss-number-stepper');
    const minus=stepper.querySelector('[data-direction="-1"]'),plus=stepper.querySelector('[data-direction="1"]');
    let stepperSubmits=0;doc.querySelector('#private-inquiry').addEventListener('submit',()=>stepperSubmits++);
    check(players.value==='1' && minus.disabled,'Private player control starts at one with decrement disabled');
    plus.click();
    check(players.value==='2' && doc.querySelector('#private-estimate').textContent.includes('$45 per player') && doc.querySelector('#private-info-price').textContent==='$45 CAD' && doc.querySelector('#private-info-total').textContent.includes('$90'),'Increasing players updates the actual form calculator and sidebar');
    minus.click();
    check(players.value==='1' && minus.disabled && doc.querySelector('#private-info-price').textContent==='$60 CAD' && stepperSubmits===0,'Decreasing players respects the minimum, refreshes the quote and never submits');
    players.value='2';players.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
    const duration=doc.querySelector('[name="Minutes"]');duration.value='120';duration.dispatchEvent(new frame.contentWindow.Event('change',{bubbles:true}));
    check(doc.querySelector('#private-estimate').textContent.includes('$80 per player') && doc.querySelector('#private-estimate').textContent.includes('$160 total'),'Private two-hour group quote keeps approved rounding');
    const privateForm=doc.querySelector('#private-inquiry');privateForm.elements.namedItem('email').value='test@example.invalid';privateForm.elements.namedItem('Player ages').value='8, 9';
    let privateCalls=0,privateData;frame.contentWindow.fetch=async(url,options)=>{privateCalls++;privateData=options.body;return {ok:true,json:async()=>({success:true})};};
    privateForm.requestSubmit();privateForm.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(privateCalls===1 && privateData.get('Preferred coach')==='Romeo Dinglis' && privateData.get('Estimate CAD').includes('160') && doc.querySelector('[data-feedback]').textContent.includes('Request received'),'Private inquiry accepts essential details without a parent name or availability and preserves coach and quote');
    doc=await load('camps.html',320);
    check(!doc.querySelector('form') && !doc.body.textContent.includes('Request free Friday') && doc.body.textContent.includes('No registration required.'),'Camp landing page has no registration form or free-Friday request; drop-ins need no registration');
    check(doc.querySelector('a[href="christmas-camp-registration.html"]').textContent==='Register for Week 1' && doc.querySelector('a[href="boxing-camp-registration.html"]').textContent==='Register for Week 2','Each numbered winter camp links directly to its own registration page');
    check([...doc.querySelectorAll('.camp-price-saving')].every((el,i)=>el.textContent.includes('$250') && el.textContent.includes(['Save $50','Save $65'][i])),'Both camp cards show the standard $250 and correct package savings');
    check(doc.querySelector('.camp-card-highlight').textContent==='Christmas gift: Christmas Day is free!','Week 1 clearly advertises the free Christmas Day gift');
    doc=await load('christmas-camp-registration.html',320);
    const camp=doc.querySelector('#camp-registration'),campWin=frame.contentWindow;
    const age=camp.elements.namedItem('Player age'),ageStepper=age.closest('.ss-number-stepper');
    check(age.value==='' && !age.checkValidity(),'Camp age stays blank and required until the family chooses it');
    ageStepper.querySelector('[data-direction="1"]').click();
    check(age.value==='5' && ageStepper.querySelector('[data-direction="-1"]').disabled,'An explicit age increase starts at the approved minimum');
    age.value='14';age.dispatchEvent(new campWin.Event('input',{bubbles:true}));
    check(ageStepper.querySelector('[data-direction="1"]').disabled,'Camp age increase disables at the maximum');
    age.value='15';age.dispatchEvent(new campWin.Event('input',{bubbles:true}));
    check(!age.checkValidity(),'Direct age entry still enforces the native maximum');
    age.value='';age.dispatchEvent(new campWin.Event('input',{bubbles:true}));
    check(doc.querySelector('[data-camp-price]').textContent==='$200 CAD' && doc.querySelectorAll('#camp-dates li').length===5,'Christmas package is $200 and includes all five dates');
    check(doc.querySelector('#camp-booking-title').textContent==='Winter Camp — Week 1' && doc.querySelector('[data-camp-standard]').textContent==='$250' && doc.querySelector('[data-camp-saving]').textContent==='$50','Week 1 registration has the numbered camp name and $50 savings');
    const setCamp=(name,value)=>{const el=camp.elements.namedItem(name);el.value=value;el.dispatchEvent(new campWin.Event('change',{bubbles:true}));};
    setCamp('Daily session','both');
    check(doc.querySelector('[data-camp-price]').textContent==='$400 CAD' && doc.querySelector('[data-camp-total]').textContent==='$400 CAD' && !camp.elements.namedItem('Booking option'),'Christmas registration only offers weekly packages, with both sessions at $400');
    check(doc.querySelector('[data-camp-standard]').textContent==='$500' && doc.querySelector('[data-camp-saving]').textContent==='$100','Week 1 both-session savings scale to $100 against $500');
    check(doc.querySelector('[data-camp-info-price]').textContent==='$400 CAD' && doc.querySelector('[data-camp-info-savings]').textContent==='Standard $500 · Save $100' && doc.querySelector('[data-camp-info-time]').textContent.includes('12:30–3:30 PM') && doc.querySelector('[data-camp-info-lunch]').textContent.includes('noon–12:30'),'Week 1 information card stays synchronized with both-session price, savings, times and lunch');
    check(doc.querySelector('[data-quick-camp-time]').textContent.includes('12:30–3:30 PM') && doc.querySelector('[data-quick-camp-time]').textContent.includes('Supervised lunch included'),'Both-session choice shows the full times and lunch supervision outside the dropdown');
    check(camp.elements.namedItem('Player age').min==='5' && camp.elements.namedItem('Player age').max==='14','Camp form uses the approved ages 5–14');
    for(const [name,value] of [['email','test@example.invalid'],['Player name','Test Player'],['Player age','5'],['Referral source','referral']])camp.elements.namedItem(name).value=value;
    let campCalls=0,campData,campReference;
    campWin.fetch=async(url,options)=>{campCalls++;campData=options.body;campReference=campData.get('Client reference');return {ok:true,json:async()=>({success:false})};};
    camp.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(campCalls===1 && !camp.hidden && doc.querySelector('#camp-receipt').hidden && camp.elements.namedItem('Player name').value==='Test Player','Rejected camp submission retains parent entries and cannot show a receipt');
    check(campData.get('Price CAD')==='400' && campData.get('Covered dates').split(', ').length===5 && campData.get('Camp session keys').split('; ').length===10 && campData.get('Referral source')==='Family / friend' && campData.get('Registration version')==='SS-CAMP-V2' && campData.get('Camp week ID')==='christmas' && campData.get('Camp slot')==='both','Camp registration carries validated package keys, intake version, price and optional attribution');
    campWin.fetch=async(url,options)=>{campCalls++;campData=options.body;return {ok:true,json:async()=>({success:true})};};
    camp.requestSubmit();camp.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(campCalls===2 && camp.hidden && !doc.querySelector('#camp-receipt').hidden && campData.get('Client reference')===campReference,'Accepted camp request shows a receipt and blocks duplicate submissions with one reference');
    check(doc.querySelector('#camp-receipt').textContent.includes('$400 CAD') && doc.querySelector('#camp-receipt').textContent.includes('noon–12:30 included') && doc.documentElement.scrollWidth<=321,'Package receipt keeps the correct charge and lunch details readable at 320px');
    doc=await load('boxing-camp-registration.html?week=christmas&kind=dropin&slot=pm&price=1#camp-booking',320);
    check(doc.querySelector('[data-camp-price]').textContent==='$185 CAD' && doc.querySelector('#camp-dates').textContent.includes('Jan 1, 2027'),'Boxing registration keeps its own $185 package despite untrusted week, kind and price parameters');
    check(doc.querySelector('#camp-booking-title').textContent==='Winter Camp — Week 2' && doc.querySelector('[data-camp-standard]').textContent==='$250' && doc.querySelector('[data-camp-saving]').textContent==='$65','Week 2 registration shows the numbered name and $65 savings');
    doc.querySelector('[name="Daily session"]').value='both';doc.querySelector('[name="Daily session"]').dispatchEvent(new frame.contentWindow.Event('change',{bubbles:true}));
    check(doc.querySelector('[data-camp-price]').textContent==='$370 CAD' && doc.querySelector('[data-camp-lunch]').textContent.includes('Supervised lunch included'),'Boxing Week both-session package is $370 with lunch');
    check(doc.querySelector('[data-camp-standard]').textContent==='$500' && doc.querySelector('[data-camp-saving]').textContent==='$130','Week 2 both-session savings scale to $130 against $500');
    check(doc.querySelector('[data-camp-info-price]').textContent==='$370 CAD' && doc.querySelector('[data-camp-info-savings]').textContent==='Standard $500 · Save $130','Week 2 information card shows the selected package and savings');
    doc=await load('contact.html?program=camps#contact-inquiry');
    check(doc.querySelector('[name="Topic"]').value==='Winter camps' && !doc.querySelector('[name="Message"]').value,'Camp inquiry link selects the right topic without writing a message for the parent');
    const contact=doc.querySelector('form');
    check([...contact.querySelectorAll('[required]')].map(el=>el.name).sort().join(',')==='Message,email','Contact only requires email and a message');
    const more=contact.querySelector('[data-optional-fields]');more.querySelector('summary').click();
    check(more.open && more.querySelector('[name="Referral source"]').getClientRects().length && doc.documentElement.scrollWidth<=doc.documentElement.clientWidth+1,'Tell us more opens optional context without overflow');
    contact.elements.namedItem('email').value='test@example.invalid';contact.elements.namedItem('Message').value='Mocked contact test';contact.elements.namedItem('Referral source').value='community';
    contact.elements.namedItem('Name').value='Example Parent';contact.elements.namedItem('Player or session details').value='Age 8, Thursday';
    let contactData;frame.contentWindow.fetch=async(url,options)=>{contactData=options.body;return {ok:true,json:async()=>({success:true})};};
    contact.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(contactData.get('Referral source')==='School / community' && doc.querySelector('[data-feedback]').textContent.includes('accepted'),'Contact inquiry includes the selected source after mocked service acceptance');
    check(contactData.get('Name')==='Example Parent' && contactData.get('Topic')==='Winter camps' && contactData.get('Player or session details')==='Age 8, Thursday','Optional name, enquiry topic and player/session context reach the inquiry');
  } catch(error) {
    check(false,error.message);
  } finally {
    document.querySelector('#status').textContent=`Complete: ${passed} passed, ${failed} failed`;
    document.body.dataset.result=failed?'fail':'pass';
  }
})();