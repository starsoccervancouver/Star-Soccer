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
        if(width<=430) {
          const controls=[...doc.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(el=>el.getClientRects().length && !el.closest('[aria-hidden="true"]'));
          if(controls.length)check(controls.every(el=>parseFloat(frame.contentWindow.getComputedStyle(el).fontSize)>=16),`${page} at ${width}px uses readable 16px form controls`);
          if(page==='index.html') {
            const action=doc.querySelector('.mobile-hero-actions .button');
            check(action.getClientRects().length>0 && action.getBoundingClientRect().bottom<800 && action.getBoundingClientRect().height>=48,`Homepage at ${width}px puts a large session button on the first screen`);
            check([...doc.querySelectorAll('.home-contact-column a')].every(el=>el.getBoundingClientRect().height>=44),`Footer links at ${width}px have 44px touch targets`);
          }
        }
      }
    }
    let doc=await load('programs.html',320);
    check(doc.querySelector('[data-session-day="friday"] .session-capacity').textContent==='3/20 players · 17 places remaining','Schedule shows the dated ledger count');
    check(doc.querySelector('[data-session-day="thursday"] .session-capacity').textContent==='0/20 players · 20 places remaining','Recorded zero is shown as zero');
    check(!doc.querySelector('.count-refresh') && doc.documentElement.dataset.countsState==='ready','Counts load automatically without a refresh button');
    frame.contentWindow.fetch=async()=>{throw new TypeError('Offline');};
    doc.dispatchEvent(new frame.contentWindow.Event('visibilitychange'));
    for(let i=0;i<100 && doc.documentElement.dataset.countsState==='loading';i++)await new Promise(resolve=>setTimeout(resolve,10));
    check([...doc.querySelectorAll('.session-capacity')].every(el=>el.textContent==='Capacity 20 · Count unavailable'),'Failed refresh removes old counts and never substitutes zero');
    doc=await load('registration.html?sessionId=friday&type=pass4',320);
    const countDate=frame.contentWindow.StarTraining.nextDate(frame.contentWindow.StarTraining.getSession('friday'));
    const shortcut=doc.querySelector('.booking-next-date');
    check(!doc.querySelector('#booking-date').value,'Registration leaves the training date for the parent to choose');
    shortcut.click();
    check(doc.querySelector('#booking-date').value===countDate && shortcut.getBoundingClientRect().height>=48 && doc.documentElement.scrollWidth<=321,'Next-session shortcut selects a valid Friday and fits a 320px screen');
    await new Promise(resolve=>frame.contentWindow.requestAnimationFrame(resolve));
    check(doc.querySelectorAll('#booking-dates .session-capacity').length===4 && [...doc.querySelectorAll('#booking-dates .session-capacity')].every(el=>el.textContent.startsWith('3/20 players')),'Four-session pass shows a separate count for each covered date');
    change(doc,'booking-date',frame.contentWindow.StarTraining.addDays(countDate,70));
    await new Promise(resolve=>frame.contentWindow.requestAnimationFrame(resolve));
    check([...doc.querySelectorAll('#booking-dates .session-capacity')].every(el=>el.textContent==='Capacity 20 · Count unavailable'),'Dates outside the ledger window show unavailable counts');
    doc=await load('programs.html?age=14&day=sunday&source=test#sessions');
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
    toggle.click();doc.querySelector('.header-program-cta').click();
    check(doc.activeElement===doc.querySelector('#sessions') && toggle.getAttribute('aria-expanded')==='false','Same-page menu link moves focus to sessions');
    for(const day of ['wednesday','thursday','friday','sunday']) {
      doc=await load('programs.html?day='+day,320);
      check(doc.querySelectorAll('.schedule-entry:not([hidden])').length===1 && doc.querySelector('.schedule-entry:not([hidden])').open,'Shared '+day+' link opens its booking options');
      check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth+1,'Expanded '+day+' session has no overflow at 320px');
    }
    doc=await load('programs.html?day=friday&age=8&email=private%40example.invalid#sessions',320);
    let copied='';
    Object.defineProperty(frame.contentWindow.navigator,'clipboard',{configurable:true,value:{writeText:async value=>{copied=value;}}});
    doc.querySelector('[data-session-day="friday"] .session-share').click();await new Promise(resolve=>setTimeout(resolve,30));
    check(copied==='https://starsoccer.ca/programs.html?day=friday#sessions' && doc.querySelector('[data-session-day="friday"] .share-feedback').textContent.includes('copied'),'Share copies the approved session without age or unrelated query values');
    Object.defineProperty(frame.contentWindow.navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Permission denied');}}});
    doc.querySelector('[data-session-day="friday"] .session-share').click();await new Promise(resolve=>setTimeout(resolve,30));
    const manual=doc.querySelector('[data-session-day="friday"] .session-share-manual');
    check(!manual.hidden && doc.activeElement===manual.querySelector('input') && manual.querySelector('input').readOnly,'Clipboard denial offers a focused, selectable fallback link');
    check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth+1 && doc.querySelector('[data-session-day="friday"] .session-share').getBoundingClientRect().height>=44,'Sharing fallback fits 320px and keeps a large touch target');
    doc=await load('registration.html?sessionId=camp-u4-u6&type=dropin');
    check(doc.querySelector('#training-registration').hidden && doc.querySelector('#registration-status').textContent.includes('no longer available'),'Retired camp registration is rejected');
    doc=await load('registration.html?sessionId=wednesday&type=pass4');
    check(doc.querySelector('#booking-summary').textContent.includes('Payment instructions') && doc.querySelector('#booking-summary').textContent.includes('starsoccervancouver@gmail.com'),'Payment destination and instructions are visible before registration');
    doc.querySelector('.booking-form-jump').click();
    check(doc.activeElement===doc.querySelector('#training-registration'),'Mobile booking shortcut moves focus to player details');
    const win=frame.contentWindow,form=doc.querySelector('form'),T=win.StarTraining;
    form.elements.namedItem('Start date').value=T.nextDate(T.getSession('wednesday'));
    for(const [name,value] of [['Parent name','Website Test'],['email','test@example.invalid'],['Player name','Test Player'],['Player age','10']])form.elements.namedItem(name).value=value;
    let calls=0,receivedData,firstReference;
    const source=form.elements.namedItem('Referral source');
    check(source && !source.required && source.value==='','Referral source is optional and has no assumed selection');
    source.value='referral';
    win.fetch=async(url,options)=>{calls++;receivedData=options.body;firstReference=receivedData.get('Client reference');return {ok:true,json:async()=>({success:false})};};
    form.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(calls===1 && doc.querySelector('#receipt').hidden && !form.hidden && form.elements.namedItem('Player name').value==='Test Player','Service rejection retains entries and cannot show a receipt');
    check(receivedData.get('Referral source')==='Family / friend','Parent-reported referral source is included in the actual submission payload');
    const recovery=doc.querySelector('.registration-recovery a'),help=new URL(recovery.href),helpBody=help.searchParams.get('body');
    check(!recovery.closest('.registration-recovery').hidden && help.protocol==='mailto:' && helpBody.includes(firstReference) && helpBody.includes('not confirmed') && !helpBody.includes('Test Player') && !helpBody.includes('test@example.invalid'),'Failure exposes an email recovery draft with the reference and no personal form entries');
    win.fetch=async(url,options)=>{calls++;receivedData=options.body;return {ok:true,json:async()=>({success:true})};};
    form.requestSubmit();form.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(calls===2 && form.hidden && !doc.querySelector('#receipt').hidden,'Accepted registration shows receipt and blocks duplicate submission');
    check(receivedData.get('Client reference')===firstReference && doc.querySelector('.registration-recovery').hidden,'Retries keep the same reference and hide stale recovery on acceptance');
    check(doc.querySelector('#receipt').textContent.includes('$95') && doc.querySelector('#booking-dates').children.length===4,'Four-session receipt keeps the approved price and dates');
    check([...doc.querySelectorAll('#receipt button')].some(button=>button.textContent==='Download booking & payment details') && doc.documentElement.scrollWidth<=doc.documentElement.clientWidth+1,'Mobile receipt offers saved payment details without overflow');
    doc=await load('program-private-small-group.html?coach=romeo');
    check(doc.querySelector('[name="Preferred coach"]').value==='romeo','Coach preference survives the inquiry link');
    check(doc.querySelector('[name="Referral source"]') && !doc.querySelector('[name="Referral source"]').required,'Private inquiry also offers optional referral source');
    doc.querySelector('[name="Players"]').value='2';
    const duration=doc.querySelector('[name="Minutes"]');duration.value='120';duration.dispatchEvent(new frame.contentWindow.Event('change',{bubbles:true}));
    check(doc.querySelector('#private-estimate').textContent.includes('$80 per player') && doc.querySelector('#private-estimate').textContent.includes('$160 total'),'Private two-hour group quote keeps approved rounding');
    doc=await load('camps.html',320);
    check(!doc.querySelector('form') && !doc.body.textContent.includes('Request free Friday') && doc.body.textContent.includes('No registration required.'),'Camp landing page has no registration form or free-Friday request; drop-ins need no registration');
    check(doc.querySelector('a[href="christmas-camp-registration.html"]').textContent==='Register for Christmas Week' && doc.querySelector('a[href="boxing-camp-registration.html"]').textContent==='Register for Boxing Week','Each camp links to its own registration page');
    doc=await load('christmas-camp-registration.html',320);
    const camp=doc.querySelector('#camp-registration'),campWin=frame.contentWindow;
    check(doc.querySelector('[data-camp-price]').textContent==='$200 CAD' && doc.querySelectorAll('#camp-dates li').length===5,'Christmas package is $200 and includes all five dates');
    const setCamp=(name,value)=>{const el=camp.elements.namedItem(name);el.value=value;el.dispatchEvent(new campWin.Event('change',{bubbles:true}));};
    setCamp('Daily session','both');
    check(doc.querySelector('[data-camp-price]').textContent==='$400 CAD' && doc.querySelector('[data-camp-total]').textContent==='$400 CAD' && !camp.elements.namedItem('Booking option'),'Christmas registration only offers weekly packages, with both sessions at $400');
    check(camp.elements.namedItem('Player age').min==='5' && camp.elements.namedItem('Player age').max==='14','Camp form uses the approved ages 5–14');
    for(const [name,value] of [['Parent name','Website Test'],['email','test@example.invalid'],['Player name','Test Player'],['Player age','5'],['Referral source','referral']])camp.elements.namedItem(name).value=value;
    let campCalls=0,campData,campReference;
    campWin.fetch=async(url,options)=>{campCalls++;campData=options.body;campReference=campData.get('Client reference');return {ok:true,json:async()=>({success:false})};};
    camp.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(campCalls===1 && !camp.hidden && doc.querySelector('#camp-receipt').hidden && camp.elements.namedItem('Player name').value==='Test Player','Rejected camp submission retains parent entries and cannot show a receipt');
    check(campData.get('Price CAD')==='400' && campData.get('Covered dates').split(', ').length===5 && campData.get('Camp session keys').split('; ').length===10 && campData.get('Referral source')==='Family / friend','Camp registration carries the package price, all ten dated session keys and optional attribution');
    campWin.fetch=async(url,options)=>{campCalls++;campData=options.body;return {ok:true,json:async()=>({success:true})};};
    camp.requestSubmit();camp.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(campCalls===2 && camp.hidden && !doc.querySelector('#camp-receipt').hidden && campData.get('Client reference')===campReference,'Accepted camp request shows a receipt and blocks duplicate submissions with one reference');
    check(doc.querySelector('#camp-receipt').textContent.includes('$400 CAD') && doc.querySelector('#camp-receipt').textContent.includes('noon–12:30 included') && doc.documentElement.scrollWidth<=321,'Package receipt keeps the correct charge and lunch details readable at 320px');
    doc=await load('boxing-camp-registration.html?week=christmas&kind=dropin&slot=pm&price=1#camp-booking',320);
    check(doc.querySelector('[data-camp-price]').textContent==='$185 CAD' && doc.querySelector('#camp-dates').textContent.includes('Jan 1, 2027'),'Boxing registration keeps its own $185 package despite untrusted week, kind and price parameters');
    doc.querySelector('[name="Daily session"]').value='both';doc.querySelector('[name="Daily session"]').dispatchEvent(new frame.contentWindow.Event('change',{bubbles:true}));
    check(doc.querySelector('[data-camp-price]').textContent==='$370 CAD' && doc.querySelector('[data-camp-lunch]').textContent.includes('Supervised lunch included'),'Boxing Week both-session package is $370 with lunch');
    doc=await load('contact.html?program=camps#contact-inquiry');
    check(doc.querySelector('[name="Topic"]').value==='Future camps' && !doc.querySelector('[name="Message"]').value,'Camp inquiry link selects the right topic without writing a message for the parent');
    const contact=doc.querySelector('form');
    contact.elements.namedItem('Name').value='Website Test';contact.elements.namedItem('email').value='test@example.invalid';contact.elements.namedItem('Message').value='Mocked contact test';contact.elements.namedItem('Referral source').value='community';
    let contactData;frame.contentWindow.fetch=async(url,options)=>{contactData=options.body;return {ok:true,json:async()=>({success:true})};};
    contact.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(contactData.get('Referral source')==='School / community' && doc.querySelector('[data-feedback]').textContent.includes('accepted'),'Contact inquiry includes the selected source after mocked service acceptance');
  } catch(error) {
    check(false,error.message);
  } finally {
    document.querySelector('#status').textContent=`Complete: ${passed} passed, ${failed} failed`;
    document.body.dataset.result=failed?'fail':'pass';
  }
})();
