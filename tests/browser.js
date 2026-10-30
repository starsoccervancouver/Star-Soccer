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
    const pages=['index.html','programs.html','program-private-small-group.html','methodology.html','locations.html','contact.html','camps.html','christmas-camp-registration.html','boxing-camp-registration.html','christmas-camp-registration.html?kind=dropin','boxing-camp-registration.html?kind=dropin','selectivo.html','registration.html?sessionId=wednesday&type=pass4','registration.html?sessionId=wednesday&type=dropin','registration-thank-you.html'];
    for(const width of [320,375,430,900,1024,1440]) {
      for(const page of pages) {
        const doc=await load(page,width);
        const overflow=doc.documentElement.scrollWidth-doc.documentElement.clientWidth;
        const oversized=[...doc.body.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>doc.documentElement.clientWidth+1).slice(0,4).map(el=>el.className).join(', ');
        check(overflow<=1,`${page} at ${width}px has no horizontal overflow${overflow>1?' ('+overflow+'px; '+oversized+')':''}`);
        const header=doc.querySelector('.site-header').getBoundingClientRect();
        check(doc.fonts.check('700 16px Manrope') && !doc.querySelector('link[href*="fonts.googleapis.com"],link[href*="fonts.gstatic.com"]'),`${page} at ${width}px renders its local brand font without Google font connections`);
        check(Math.abs(header.left)<=1 && Math.abs(header.right-doc.documentElement.clientWidth)<=1,`${page} at ${width}px has navigation across the full screen width`);
        const brandImages=[...doc.querySelectorAll('img.brand-logo')];
        check(brandImages.length>=1 && brandImages.every(img=>img.getAttribute('src').includes('galactic')), `${page} at ${width}px uses the Galactic Swoosh logo in the header and footer`);
        check(doc.querySelector('link[rel="icon"]')?.getAttribute('href')?.includes('star-soccer-favicon.svg'), `${page} at ${width}px uses the new star favicon`);
        check(!doc.querySelector('.site-nav .header-program-cta') && [...doc.querySelectorAll('.site-nav a')].some(a=>a.getAttribute('href')==='programs.html'),`${page} at ${width}px keeps Weekly Training without a duplicate Find a Session tab`);
        const numeric=[...doc.querySelectorAll('input[type="number"]:not([data-native-number])')].filter(el=>el.step!=='any' && !el.closest('.honeypot,[aria-hidden="true"]'));
        if(numeric.length){
          check(numeric.every(el=>el.closest('.ss-number-stepper') && el.labels.length && !el.closest('label')),`${page} at ${width}px enhances number fields while preserving an associated label`);
          check(numeric.every(el=>[...el.closest('.ss-number-stepper').querySelectorAll('button')].length===2 && [...el.closest('.ss-number-stepper').querySelectorAll('button')].every(button=>button.type==='button' && button.getAttribute('aria-controls')===el.id && button.getAttribute('aria-label') && (!el.getClientRects().length || button.getBoundingClientRect().width>=44 && button.getBoundingClientRect().height>=44))),`${page} at ${width}px has labelled 44px visible minus and plus controls that cannot submit the form`);
        }
        if(page==='index.html') {
          const heroPhotos=frame.contentWindow.performance.getEntriesByType('resource').filter(r=>r.name.includes('/site-photos/home-'));
          check(heroPhotos.length===1 && heroPhotos[0].name.includes('-'+(width<=900?'800':'1600')+'.avif'),`Homepage at ${width}px downloads one local hero at the right size`);
          const programs=doc.querySelector('.hero-action-programs'),camps=doc.querySelector('.hero-action-camps');
          check(programs && camps && programs.getAttribute('href')==='programs.html#sessions' && camps.getAttribute('href')==='camps.html',`Homepage at ${width}px keeps the two approved program and camp destinations`);
          check(programs && camps && [programs,camps].every(el=>el.getClientRects().length && el.getBoundingClientRect().height>=48),`Homepage at ${width}px shows large program and camp actions`);
          check(camps && camps.textContent.includes('Register for discounted winter camps') && !camps.textContent.includes('$250'),`Homepage at ${width}px leads with the streamlined discounted winter camp action`);
          check(doc.querySelector('h1').textContent.includes('Soccer coaching in Vancouver.'),`Homepage at ${width}px describes the coaching service and location`);
          const copy=doc.querySelector('.immersive-hero-copy').getBoundingClientRect(),actions=doc.querySelector('.hero-action-panel').getBoundingClientRect();
          check(width>900?actions.left>=copy.right:actions.top>=copy.bottom,`Homepage at ${width}px places choices to the right on desktop and below on mobile`);
        }
        if(page==='camps.html') {
          const links=[...doc.querySelectorAll('.camp-week-card .winter-camp-cta')];
          check(links.length===2 && links.every(el=>el.getBoundingClientRect().bottom<=755 && el.getBoundingClientRect().height>=48),`Camps at ${width}px shows both registration buttons within the first 755px (${Math.round(links.at(-1).getBoundingClientRect().bottom)}px)`);
          check(!doc.querySelector('.camp-overview') && [...doc.querySelectorAll('.camp-card-details')].every(el=>el.textContent.includes('20 players') && el.textContent.includes('noon–12:30')),`Camp cards at ${width}px include capacity and supervised lunch details`);
          check([...doc.querySelectorAll('.camp-week-card,.seasonal-feature')].every(el=>!frame.contentWindow.getComputedStyle(el,'::before').backgroundImage.includes('url(') && frame.contentWindow.getComputedStyle(el).backgroundImage==='none'),`Camp cards at ${width}px have solid surfaces without photography`);
        }
        if(page==='programs.html') {
          const youthCards=[...doc.querySelectorAll('#sessions .schedule-entry[data-session-day]:not([data-audience="adult"])')];
          const actions=youthCards.flatMap(card=>[...card.querySelectorAll('.schedule-direct-actions a')]);
          check(youthCards.length===4 && actions.length===8 && youthCards.every(card=>{
            const links=[...card.querySelectorAll('.schedule-direct-actions a')];
            return links.length===2 && links.every((link,index)=>{
              const url=new URL(link.href);
              return url.pathname.endsWith('/registration.html') && url.searchParams.get('sessionId')===card.dataset.sessionDay && url.searchParams.get('type')===['dropin','pass4'][index] && link.getClientRects().length && link.getBoundingClientRect().height>=48;
            });
          }),`Training at ${width}px shows direct drop-in and pass buttons on all four youth cards`);
          const adultCard=doc.querySelector('#sessions #adult-women.schedule-entry[data-audience="adult"][data-session-day="tuesday"][data-session-location="fen-burdett"]');
          const adultLinks=adultCard?[...adultCard.querySelectorAll('.schedule-direct-actions a')]:[];
          const adultUrl=adultLinks.length===1?new URL(adultLinks[0].href):null;
          check(!!adultCard && adultCard.textContent.includes('9:30–11:00 AM') && adultCard.textContent.includes('Fen Burdett Stadium') && adultCard.textContent.includes('$20 per session') && adultCard.textContent.includes('8/20 reported') && adultUrl?.pathname.endsWith('/contact.html') && adultUrl.searchParams.get('topic')==='adult-women' && adultLinks[0].getClientRects().length && adultLinks[0].getBoundingClientRect().height>=48 && !adultCard.querySelector('a[href*="registration.html"],.session-capacity'),`Training at ${width}px puts Tuesday adult women in the weekly schedule without youth booking or an unreliable count`);
          check([...doc.querySelectorAll('#sessions .schedule-entry')].length===5 && doc.querySelector('#sessions .schedule-entry')===adultCard && doc.querySelector('#schedule-results').textContent==='Showing 5 of 5 sessions',`Training at ${width}px shows all five sessions in the weekly list`);
          check(!doc.querySelector('details.schedule-entry,.session-share'),`Training at ${width}px has no registration disclosure or copy-link step`);
          if(width<=430)check(adultLinks[0].getBoundingClientRect().bottom<=820,`Training at ${width}px puts Tuesday's enquiry within the first screen (${Math.round(adultLinks[0].getBoundingClientRect().bottom)}px)`);
        }
        if(doc.body.classList.contains('quick-flow') && width<=430){
          const form=doc.querySelector('form'),submit=form.querySelector('[type="submit"]');
          // The approved private form and 44px stepper rows stack on narrow phones.
          // Passes now show all four dated availability rows beside submit.
          const limit=page.startsWith('registration.html') && page.includes('type=pass4')?(width<=420?950:850):page.includes('kind=dropin')?850:doc.body.classList.contains('private-registration')?740:(width<=420 && numeric.length?850:740);
          check(submit.getBoundingClientRect().bottom<=limit && submit.getBoundingClientRect().height>=48,`${page} at ${width}px keeps a large submit button within ${limit}px (${Math.round(submit.getBoundingClientRect().bottom)}px)`);
          if(doc.body.classList.contains('private-registration')){
            doc.querySelector('[name="Training format"][value="smallgroup"]').click();
            check(submit.getBoundingClientRect().bottom<=limit && submit.getBoundingClientRect().height>=48,`Small group at ${width}px also keeps its inquiry button within ${limit}px (${Math.round(submit.getBoundingClientRect().bottom)}px)`);
            doc.querySelector('[name="Training format"][value="private"]').click();
          }
          check([...form.querySelectorAll('[required]')].filter(el=>el.getClientRects().length).length<=4,`${page} starts with at most four essential inputs`);
        }
        if(doc.body.classList.contains('seasonal-registration')){
          if(page.startsWith('registration.html') && page.includes('type=dropin')){
            const price=doc.querySelector('#quick-dropin-summary');
            check(!price.hidden && price.textContent.includes('$30 CAD') && price.getBoundingClientRect().bottom<doc.querySelector('#training-registration [type="submit"]').getBoundingClientRect().top,`Drop-in at ${width}px shows its catalog price and payment reassurance before registration`);
          }
          if(page.includes('kind=dropin')){
            const total=doc.querySelector('[data-camp-total]');
            check(total.getBoundingClientRect().right<=width && [...doc.querySelectorAll('.camp-day')].every(el=>el.getBoundingClientRect().width>=44 && el.getBoundingClientRect().height>=44),`Camp drop-in at ${width}px keeps the total readable and every day touch-friendly`);
          }
          const more=doc.querySelector('[data-optional-fields]');
          check(doc.querySelectorAll('form details').length===1 && !more.open && more.querySelector('summary').textContent==='Tell us more (optional)' && (more.nextElementSibling.matches('[type="submit"]') || (page.startsWith('registration.html') && more.nextElementSibling.id==='booking-dates' && doc.querySelector('#booking-dates').nextElementSibling.id==='family-total' && doc.querySelector('#family-total').nextElementSibling.matches('[type="submit"]'))) && !more.querySelector('[required]'),`${page} at ${width}px keeps optional details before the final date/total and registration controls`);
          const panel=doc.querySelector('.quick-panel').getBoundingClientRect(),info=doc.querySelector('.registration-info').getBoundingClientRect();
          check(info.width>0,`${page} at ${width}px shows its information card`);
          if(width>=900)check(panel.width>info.width*1.5 && info.left>=panel.right,`${page} at ${width}px gives the registration form more space beside the info card`);
          if(width<=430)check(info.top>=panel.bottom,`${page} at ${width}px keeps the form before the information card`);
          const theme=frame.contentWindow.getComputedStyle(doc.body).getPropertyValue('--registration-art');
          check(theme.includes(page.includes('private-small-group') || page.startsWith('registration.html')?'autumn-field':'winter-field'),`${page} at ${width}px uses its matching seasonal artwork`);
          check(!doc.querySelector('.registration-info img') && frame.contentWindow.getComputedStyle(doc.querySelector('.registration-info')).backgroundColor==='rgb(16, 38, 61)',`${page} at ${width}px keeps imagery outside the opaque information card`);
          if(page.startsWith('registration.html') && page.includes('type=pass4')){
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
          const loaded=frame.contentWindow.performance.getEntriesByType('resource').filter(r=>/(autumn|winter)-field-\d+\.(avif|webp)/.test(r.name));
          check(loaded.length===1 && loaded[0].name.includes('-'+(width<=700?'800':'1600')+'.avif'),`${page} at ${width}px downloads one correctly sized seasonal photo without a duplicate preload`);
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
          check(bg.position==='fixed' && bg.backgroundImage.includes('site-photos/'+(page==='contact.html'?'contact':page==='locations.html'?'locations':'approach')+'-'),`${page} at ${width}px has its distinct locally served full-page themed background`);
        }
        if(page==='methodology.html'){
          const nav=doc.querySelector('.method-restored-nav');
          const navStyle=frame.contentWindow.getComputedStyle(nav);
          check(navStyle.backgroundColor==='rgba(0, 0, 0, 0)' && navStyle.backgroundImage==='none' && navStyle.boxShadow==='none',`Our Approach at ${width}px has no solid bar behind the section links`);
          check([...nav.querySelectorAll('a')].every(link=>link.getBoundingClientRect().height>=44),`Our Approach at ${width}px keeps the links easy to tap`);
        }
        if(width<=430) {
          check(header.height<=78,`${page} at ${width}px keeps the mobile header compact`);
          const controls=[...doc.querySelectorAll('input:not([type="hidden"]),select,textarea')].filter(el=>el.getClientRects().length && !el.closest('[aria-hidden="true"]'));
          if(controls.length)check(controls.every(el=>parseFloat(frame.contentWindow.getComputedStyle(el).fontSize)>=16),`${page} at ${width}px uses readable 16px form controls`);
          if(page==='index.html') {
            check([...doc.querySelectorAll('.home-contact-column a')].every(el=>el.getBoundingClientRect().height>=44),`Footer links at ${width}px have 44px touch targets`);
          }
        }
      }
    }
    let doc=await load('',320);
    check(doc.querySelector('h1')?.textContent.includes('Soccer coaching in Vancouver.') && doc.querySelector('.site-header a[aria-label="Star Soccer home"]')?.getAttribute('href')==='/', 'Root home navigation serves the current homepage');
    const faq=doc.querySelector('.home-parent-faq details');
    faq.querySelector('summary').click();
    check(faq.open && faq.querySelector('p').getClientRects().length && [...faq.querySelectorAll('a')].every(link=>link.getAttribute('href')) && doc.documentElement.scrollWidth<=321,'Parent FAQ opens with working program links and fits a 320px screen');
    doc=await load('program-private-small-group.html?format=smallgroup&coach=evan',320);
    const groupForm=doc.querySelector('#private-inquiry'),groupPlayers=groupForm.elements.namedItem('Players');
    const groupChoice=groupForm.querySelector('[value="smallgroup"]'),privateChoice=groupForm.querySelector('[value="private"]');
    check(groupChoice.checked && groupPlayers.value==='6' && groupPlayers.min==='6' && groupPlayers.max==='18' && groupForm.elements.namedItem('Preferred coach').value==='evan','Small group direct link restores the format, minimum headcount and coach');
    check(doc.querySelector('#private-estimate').textContent.includes('$180 total') && doc.querySelector('#private-summary-title').textContent==='Small Group Training','Small group starts with a clear whole-group total');
    groupPlayers.value='18';groupPlayers.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
    const groupPlus=groupPlayers.closest('.ss-number-stepper').querySelector('[data-direction="1"]');
    check(groupPlayers.checkValidity() && groupPlus.disabled && doc.querySelector('#private-estimate').textContent.includes('$540 total'),'18 players is accepted and the stepper stops at the group limit');
    groupForm.elements.namedItem('email').value='test@example.invalid';groupForm.elements.namedItem('Youngest age').value='8';groupForm.elements.namedItem('Oldest age').value='9';
    let groupCalls=0,groupData;frame.contentWindow.fetch=async(url,options)=>{groupCalls++;groupData=options.body;return {ok:true,json:async()=>({success:true})};};
    groupPlayers.value='19';groupPlayers.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));groupForm.requestSubmit();
    check(!groupPlayers.checkValidity() && groupCalls===0 && !doc.querySelector('#private-estimate').textContent.includes('$570'),'19 players cannot produce a quote or submit a group inquiry');
    groupPlayers.value='5';groupPlayers.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
    check(!groupPlayers.checkValidity(),'Small group selection rejects headcounts below six');
    privateChoice.click();
    check(groupPlayers.value==='5' && groupPlayers.min==='1' && groupPlayers.max==='5' && doc.querySelector('#private-estimate').textContent.includes('$175 total'),'Switching to private preserves a valid five-player inquiry and refreshes the total');
    groupPlayers.value='6';groupPlayers.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
    check(!groupPlayers.checkValidity(),'Private selection rejects headcounts above five');
    groupChoice.click();groupPlayers.value='18';groupPlayers.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
    groupForm.requestSubmit();groupForm.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(groupCalls===1 && groupData.get('Format')==='Small Group Training (6–18 players)' && groupData.get('Estimate CAD')==='30 per player; 540 group total' && groupData.get('Preferred coach')==='Evan Lycos','Small group submits the category, exact quote and coach once');
    doc=await load('program-private-small-group.html?coach=romeo',375);
    check(!doc.querySelector('[data-private-format],.private-training-options .button,.private-training-guide .button') && doc.querySelectorAll('#private-inquiry [type="submit"]').length===1,'Private coaching has one clear inquiry action in its form and no duplicate return-to-form buttons');
    doc=await load('camps.html',320);
    for(const details of doc.querySelectorAll('.camp-card-details'))details.querySelector('summary').click();
    check([...doc.querySelectorAll('.camp-card-details')].every(el=>el.open && el.querySelector('ul').getClientRects().length) && doc.documentElement.scrollWidth<=321,'Both camp detail disclosures open without overflow at 320px');
    doc=await load('programs.html',320);
    check(!doc.querySelector('[data-filter-panel]').open && doc.querySelector('.schedule-entry-main').getBoundingClientRect().bottom<=740,'Training starts with visible sessions and expandable optional filters ('+Math.round(doc.querySelector('.schedule-entry-main').getBoundingClientRect().bottom)+'px)');
    doc.querySelector('[data-filter-panel] summary').click();
    check(doc.querySelector('#schedule-age').getClientRects().length>0,'Training filter disclosure exposes working controls');
    check(doc.querySelector('[data-session-day="friday"] .session-capacity').textContent==='3/20 players · 17 places remaining','Schedule shows the dated ledger count');
    check(doc.querySelector('[data-session-day="thursday"] .session-capacity').textContent==='0/20 players · 20 places remaining','Recorded zero is shown as zero');
    check(!doc.querySelector('.count-refresh') && doc.documentElement.dataset.countsState==='ready','Counts load automatically without a refresh button');
    check(doc.querySelector('.count-feed-note'),'Training page shows count freshness and availability guidance');
    frame.contentWindow.fetch=async()=>{throw new TypeError('Offline');};
    doc.dispatchEvent(new frame.contentWindow.Event('visibilitychange'));
    for(let i=0;i<100 && doc.documentElement.dataset.countsState==='loading';i++)await new Promise(resolve=>setTimeout(resolve,10));
    check([...doc.querySelectorAll('.session-capacity')].every(el=>el.textContent.includes('Contact us for availability') && el.querySelector('a[href^="mailto:"]')),'Failed refresh removes old counts and never substitutes zero');
    doc=await load('registration.html?sessionId=friday&type=dropin',320);
    check(![...doc.querySelectorAll('input[type="date"]')].some(el=>el.getClientRects().length) && doc.querySelector('#booking-dates li').dataset.sessionDate===frame.contentWindow.StarTraining.nextDate(frame.contentWindow.StarTraining.getSession('friday')) && !doc.querySelector('[data-optional-fields]').open,'Weekly drop-in shows the upcoming date beside submission while extra questions stay optional');
    check([...doc.querySelector('form').querySelectorAll('[required]')].map(el=>el.name).sort().join(',')==='Experience,Player age,Player name,email','Weekly registration requires exactly child, age, email and experience');
    check(doc.querySelector('[data-training-info-option]').textContent==='Friday · Drop-in' && doc.querySelector('[data-training-info-price]').textContent==='$25 CAD' && doc.querySelector('[data-training-info-venue]').textContent==='Connaught Park','Drop-in information card follows the selected session and approved price');
    doc=await load('programs.html?age=14&day=sunday&source=test#sessions');
    check(doc.querySelector('[data-filter-panel]').open,'Shared filtered links open the filter controls automatically');
    check(!doc.querySelector('#schedule-empty').hidden,'Incompatible age/day shows empty state');
    doc.querySelector('#schedule-reset').click();
    check(doc.querySelectorAll('.schedule-entry:not([hidden])').length===5 && doc.querySelectorAll('#sessions .schedule-entry:not([hidden])').length===5 && !doc.querySelector('#adult-women').hidden && doc.querySelector('#schedule-results').textContent==='Showing 5 of 5 sessions','Clear filters restores four youth sessions and Tuesday adults in the same list');
    check(frame.contentWindow.location.search==='?source=test' && frame.contentWindow.location.hash==='#sessions','Clear filters preserves unrelated query and anchor');
    change(doc,'schedule-age','14');
    check(doc.querySelectorAll('.schedule-entry:not([hidden])').length===1,'Age 14 shows only eligible training');
    check(frame.contentWindow.location.search.includes('age=14'),'Filter is reflected in shareable URL');
    check(doc.querySelectorAll('.schedule-next').length===4,'All four youth sessions show their next Vancouver date');
    doc.querySelector('#schedule-reset').click();
    change(doc,'schedule-age','adult');
    check(doc.querySelectorAll('#sessions .schedule-entry:not([hidden])').length===1 && !doc.querySelector('#adult-women').hidden && doc.querySelector('#schedule-results').textContent==='Showing 1 of 5 sessions','Adult age filter displays only Tuesday');
    doc.querySelector('#schedule-reset').click();
    change(doc,'schedule-day','tuesday');
    check(!doc.querySelector('#adult-women').hidden && doc.querySelectorAll('#sessions .schedule-entry:not([hidden])').length===1,'Tuesday filter displays adult women');
    doc.querySelector('#schedule-reset').click();
    change(doc,'schedule-location','fen-burdett');
    check(!doc.querySelector('#adult-women').hidden && doc.querySelectorAll('#sessions .schedule-entry:not([hidden])').length===1,'Fen Burdett location filter displays adult women');
    doc.querySelector('#schedule-reset').click();
    change(doc,'schedule-age','14');
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
    doc=await load('contact.html?topic=adult-women',375);
    check(doc.querySelector('select[name="Topic"]')?.value==="Tuesday women's soccer" && doc.querySelector('select[name="Topic"]').closest('details')?.open,'Adult Tuesday enquiry preselects the correct contact topic');
    doc=await load('registration.html?sessionId=camp-u4-u6&type=dropin');
    check(doc.querySelector('#training-registration').hidden && doc.querySelector('#registration-status').textContent.includes('no longer available'),'Retired camp registration is rejected');
    doc=await load('index.html?utm_source=local-guide&utm_medium=directory&utm_campaign=winter2026&email=private%40example.invalid');
    const campaignPreview=new frame.contentWindow.FormData();
    frame.contentWindow.StarCampaignSource.append(campaignPreview);
    check(campaignPreview.get('Campaign source (URL tag)')==='local-guide' && campaignPreview.get('Campaign medium (URL tag)')==='directory' && campaignPreview.get('Campaign name (URL tag)')==='winter2026' && [...campaignPreview].length===3,'Landing page retains only explicit campaign labels without forwarding unrelated personal URL values');
    doc=await load('registration.html?sessionId=wednesday&type=pass4');
    check(doc.querySelector('#quick-dropin-summary').hidden,'Pass registration uses its existing pass summary without a second drop-in price');
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
    check(receivedData.get('Campaign source (URL tag)')==='local-guide' && receivedData.get('Campaign medium (URL tag)')==='directory' && receivedData.get('Campaign name (URL tag)')==='winter2026' && receivedData.get('Referral source')==='School / community','A campaign landing followed by weekly registration carries attribution separately from the parent-reported referral');
    check(receivedData.get('Experience')==='Some experience' && receivedData.get('Registration version')==='SS-PASS-V1' && receivedData.get('Requested option')==='Four-session pass' && receivedData.get('Covered dates')===chosenPassPlan.dates.join(', ') && receivedData.get('Price CAD')==='95' && receivedData.get('Expected end date')===chosenPassPlan.end && receivedData.get('Pass start date')===changedStart && receivedData.get('Pass start choice')==='Selected date','Pass payload carries the quoted four dates and correct price for authoritative intake validation');
    const recovery=doc.querySelector('.registration-recovery a'),help=new URL(recovery.href),helpBody=help.searchParams.get('body');
    check(help.protocol==='mailto:' && helpBody.includes(firstReference) && helpBody.includes('not confirmed') && !helpBody.includes('Test Player') && !helpBody.includes('test@example.invalid'),'Failure recovery keeps the reference without personal form entries');
    win.fetch=async(url,options)=>{calls++;receivedData=options.body;return {ok:true,json:async()=>({success:true})};};
    form.requestSubmit();form.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(calls===2 && form.hidden && !doc.querySelector('#receipt').hidden,'Accepted registration shows receipt and blocks duplicate submission');
    check(receivedData.get('Client reference')===firstReference && doc.querySelector('.registration-recovery').hidden,'Retries keep the same reference and hide stale recovery on acceptance');
    check(doc.querySelector('#receipt').textContent.includes('pass confirmation') && doc.querySelector('#receipt').textContent.includes('payment') && doc.querySelector('#receipt').textContent.includes('$95') && doc.querySelector('#receipt').textContent.includes('4th session'),'Pass receipt preserves price and expected dates with email/payment follow-up');
    check(doc.documentElement.scrollWidth<=doc.documentElement.clientWidth+1,'Weekly receipt fits a narrow phone');
    doc=await load('registration.html?sessionId=friday&type=pass4',320);
    const rolloverWindow=frame.contentWindow,rolloverForm=doc.querySelector('#training-registration'),rolloverTraining=rolloverWindow.StarTraining,rolloverSession=rolloverTraining.getSession('friday'),originalDate=rolloverWindow.Date;
    const displayedStart=doc.querySelector('#pass-start').value,scanStart=originalDate.parse(displayedStart+'T00:00:00Z');let cutoff=null;
    for(let minute=0;minute<48*60;minute++){
      const instant=scanStart+minute*60000,clock=rolloverTraining.localClock(new originalDate(instant));
      if(clock.date===displayedStart&&clock.minutes===rolloverSession.startMinutes){cutoff=instant;break;}
    }
    if(cutoff===null)throw new Error('Could not locate Vancouver session cutoff for rollover test');
    let controlledNow=cutoff-60000;
    rolloverWindow.Date=class extends originalDate{constructor(...args){super(...(args.length?args:[controlledNow]));}static now(){return controlledNow;}};
    check(rolloverTraining.nextDate(rolloverSession)===displayedStart,'Controlled clock starts before the displayed pass start cutoff');
    for(const [name,value] of [['email','rollover@example.invalid'],['Player name','Test Player'],['Player age','8'],['Experience','new']])rolloverForm.elements.namedItem(name).value=value;
    let rolloverCalls=0,rolloverPayload;rolloverWindow.fetch=async(url,options)=>{rolloverCalls++;rolloverPayload=options.body;return {ok:true,json:async()=>({success:true})};};
    controlledNow=cutoff;
    rolloverForm.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    const updatedStart=rolloverTraining.nextDate(rolloverSession),updatedPlan=rolloverWindow.StarWeeklySignup.passPlan('friday');
    check(rolloverCalls===0 && !rolloverForm.hidden && updatedStart!==displayedStart && doc.querySelector('#pass-start').value===updatedStart && doc.querySelector('#registration-status').textContent.includes('Review the four updated dates'),'Crossing the default pass cutoff updates dates and requires review without sending a request');
    check([...doc.querySelectorAll('#booking-dates li')].map(el=>el.dataset.sessionDate).join(', ')===updatedPlan.dates.join(', ') && doc.querySelector('#pass-end').textContent===rolloverTraining.prettyDate(updatedPlan.end),'All four visible pass dates and the fourth-session end update after rollover');
    rolloverForm.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(rolloverCalls===1 && rolloverForm.hidden && rolloverPayload.get('Pass start date')===updatedStart && rolloverPayload.get('Covered dates')===updatedPlan.dates.join(', '),'A second deliberate submission sends the reviewed four-date pass exactly once');
    rolloverWindow.Date=originalDate;
    doc=await load('registration.html?sessionId=friday&type=dropin',320);
    const siblingForm=doc.querySelector('#training-registration'),siblingWindow=frame.contentWindow;
    for(const [name,value] of [['email','family@example.invalid'],['Player name','Alex Example'],['Player age','8'],['Experience','new']])siblingForm.elements.namedItem(name).value=value;
    doc.querySelector('.family-add-player').click();
    const extra=doc.querySelector('.family-player');
    extra.querySelector('[data-player-field="name"]').value='Alex Example';extra.querySelector('[data-player-field="age"]').value='9';extra.querySelector('select').value='some';
    siblingForm.dispatchEvent(new siblingWindow.Event('submit',{bubbles:true,cancelable:true}));
    check(!extra.querySelector('[data-player-field="name"]').validity.valid,'Duplicate sibling names are rejected to keep player identities separate');
    siblingForm.elements.namedItem('Player name').value='Sam Example';siblingForm.elements.namedItem('Player name').dispatchEvent(new siblingWindow.Event('input',{bubbles:true}));
    check(extra.querySelector('[data-player-field="name"]').validity.valid,'Editing the first player clears stale duplicate-name errors on a sibling');
    check(doc.querySelector('#family-total').textContent.includes('$50') && doc.documentElement.scrollWidth<=321,'Sibling form shows the two-player total and fits a narrow phone');
    const siblingPayloads=[];siblingWindow.fetch=async(url,options)=>{siblingPayloads.push(options.body);return {ok:true,json:async()=>({success:true})};};
    siblingForm.requestSubmit();siblingForm.requestSubmit();await new Promise(resolve=>setTimeout(resolve,50));
    check(siblingPayloads.length===2 && siblingPayloads[0].get('Player name')==='Sam Example' && siblingPayloads[1].get('Player name')==='Alex Example' && siblingPayloads[1].get('Experience')==='Some experience','One family action sends exactly one canonical registration per child');
    check(siblingPayloads[0].get('Client reference')!==siblingPayloads[1].get('Client reference') && siblingPayloads[0].get('Family reference')===siblingPayloads[1].get('Family reference') && siblingPayloads.every(p=>p.get('Price CAD')==='25'&&p.get('Family requested total CAD')==='50'),'Sibling requests retain unique references, a shared family reference and independent prices');
    check(siblingForm.hidden && doc.querySelector('#receipt').textContent.includes('Sam Example') && doc.querySelector('#receipt').textContent.includes('Alex Example'),'Successful family receipt names each received request without claiming reserved places');
    doc=await load('registration.html?sessionId=friday&type=dropin',320);
    const partialForm=doc.querySelector('#training-registration'),partialWindow=frame.contentWindow;
    for(const [name,value] of [['email','family@example.invalid'],['Player name','Alex Example'],['Player age','8'],['Experience','new']])partialForm.elements.namedItem(name).value=value;
    doc.querySelector('.family-add-player').click();const partialExtra=doc.querySelector('.family-player');partialExtra.querySelector('[data-player-field="name"]').value='Sam Example';partialExtra.querySelector('[data-player-field="age"]').value='9';partialExtra.querySelector('select').value='some';
    let partialCalls=0;partialWindow.fetch=async()=>{partialCalls++;if(partialCalls===2)throw new TypeError('Offline');return {ok:true,json:async()=>({success:true})};};
    partialForm.requestSubmit();await new Promise(resolve=>setTimeout(resolve,50));
    check(partialCalls===2 && partialForm.querySelector('[type="submit"]').disabled && partialForm.elements.namedItem('email').disabled && doc.querySelector('#receipt').hidden,'Partial family acceptance freezes the form and prevents resending the received child');
    check(doc.querySelector('.registration-recovery').textContent.includes('Alex Example — request received') && doc.querySelector('.registration-recovery').textContent.includes('Sam Example — receipt not confirmed'),'Partial family submission reports each child’s actual submission state');
    doc=await load('program-private-small-group.html?coach=romeo');
    check(doc.querySelector('[name="Preferred coach"]').value==='romeo','Coach preference survives the inquiry link');
    check(doc.querySelector('[name="Referral source"]') && !doc.querySelector('[name="Referral source"]').required,'Private inquiry also offers optional referral source');
    const players=doc.querySelector('[name="Players"]'),stepper=players.closest('.ss-number-stepper');
    const minus=stepper.querySelector('[data-direction="-1"]'),plus=stepper.querySelector('[data-direction="1"]');
    let stepperSubmits=0;doc.querySelector('#private-inquiry').addEventListener('submit',()=>stepperSubmits++);
    check(players.value==='1' && minus.disabled,'Private player control starts at one with decrement disabled');
    const singleAge=doc.querySelector('[name="Youngest age"]'),hiddenOldest=doc.querySelector('[name="Oldest age"]');
    check(singleAge.value==='' && !singleAge.checkValidity() && singleAge.min==='5' && hiddenOldest.disabled && !hiddenOldest.required && !hiddenOldest.getClientRects().length && doc.querySelector('#private-age-label').textContent==='Player age','One player requires an explicit age and shows only one required age ticker');
    singleAge.value='4';singleAge.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
    check(!singleAge.checkValidity(),'The player age cannot be below five');
    singleAge.value='5';singleAge.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
    check(singleAge.closest('.ss-number-stepper').querySelector('[data-direction="-1"]').disabled,'Age ticker decrement stops at five');
    plus.click();
    check(!hiddenOldest.disabled && hiddenOldest.required && hiddenOldest.getClientRects().length && doc.querySelector('#private-age-label').textContent==='Youngest age','Adding a second player reveals the age range');
    check(players.value==='2' && doc.querySelector('#private-estimate').textContent.includes('$55 per player') && doc.querySelector('#private-info-price').textContent==='$55 CAD' && doc.querySelector('#private-info-total').textContent.includes('$110'),'Increasing players updates the actual form calculator and sidebar');
    minus.click();
    check(hiddenOldest.disabled && !hiddenOldest.getClientRects().length && singleAge.getAttribute('aria-label')==='Player age','Returning to one player hides the upper age and restores its accessible label');
    check(players.value==='1' && minus.disabled && doc.querySelector('#private-info-price').textContent==='$65 CAD' && stepperSubmits===0,'Decreasing players respects the minimum, refreshes the quote and never submits');
    players.value='2';players.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));
    const duration=doc.querySelector('[name="Minutes"]');duration.value='120';duration.dispatchEvent(new frame.contentWindow.Event('change',{bubbles:true}));
    check(doc.querySelector('#private-estimate').textContent.includes('$110 per player') && doc.querySelector('#private-estimate').textContent.includes('$220 total'),'Private two-hour quote preserves a consistent hourly rate');
    const privateForm=doc.querySelector('#private-inquiry');privateForm.elements.namedItem('email').value='test@example.invalid';privateForm.elements.namedItem('Youngest age').value='8';privateForm.elements.namedItem('Oldest age').value='9';
    let privateCalls=0,privateData;frame.contentWindow.fetch=async(url,options)=>{privateCalls++;privateData=options.body;return {ok:true,json:async()=>({success:true})};};
    const youngest=privateForm.elements.namedItem('Youngest age'),oldest=privateForm.elements.namedItem('Oldest age');
    const editAge=(el,value)=>{el.value=value;el.dispatchEvent(new frame.contentWindow.Event('input',{bubbles:true}));};
    check(youngest.type==='number' && oldest.type==='number' && !privateForm.elements.namedItem('Player ages') && youngest.closest('.ss-number-stepper') && oldest.closest('.ss-number-stepper'),'Age range replaces the comma-separated text box with two tickers');
    editAge(oldest,'7');privateForm.requestSubmit();
    check(privateCalls===0 && !oldest.checkValidity(),'An inverted age range blocks submission');
    editAge(youngest,'6');
    check(oldest.checkValidity(),'Changing the youngest age clears a previously inverted range');
    editAge(youngest,'8');editAge(oldest,'9');
    oldest.closest('.ss-number-stepper').querySelector('[data-direction="-1"]').click();
    check(oldest.value==='8' && oldest.min==='8' && oldest.closest('.ss-number-stepper').querySelector('[data-direction="-1"]').disabled,'Oldest age ticker cannot step below the youngest age');
    editAge(oldest,'9');
    oldest.closest('.ss-number-stepper').querySelector('[data-direction="1"]').click();
    check(oldest.value==='10' && privateCalls===0,'Age ticker advances the upper end without submitting');
    editAge(oldest,'99');
    check(oldest.closest('.ss-number-stepper').querySelector('[data-direction="1"]').disabled,'Oldest-age ticker stops at its maximum');
    editAge(youngest,'8.5');privateForm.requestSubmit();
    check(!youngest.checkValidity() && privateCalls===0,'Fractional ages cannot be submitted');
    editAge(youngest,'8');editAge(oldest,'9');
    privateForm.requestSubmit();privateForm.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(privateCalls===1 && privateData.get('Player ages')==='8–9 years' && !privateData.has('Youngest age') && privateData.get('Preferred coach')==='Romeo Dinglis' && privateData.get('Estimate CAD').includes('220') && privateData.get('Format')==='Private Training (1–5 players)' && doc.querySelector('[data-feedback]').textContent.includes('coaching inquiry was submitted'),'Private inquiry accepts essential details without a parent name or availability and preserves coach and quote');
    check(privateData.get('Campaign source (URL tag)')==='local-guide','Private inquiry includes the same valid campaign context after navigation');
    doc=await load('program-private-small-group.html',320);
    const soloForm=doc.querySelector('#private-inquiry');soloForm.elements.namedItem('email').value='test@example.invalid';soloForm.elements.namedItem('Youngest age').value='7';soloForm.elements.namedItem('Oldest age').value='6';
    let soloData;frame.contentWindow.fetch=async(url,options)=>{soloData=options.body;return {ok:true,json:async()=>({success:true})};};
    soloForm.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(soloData?.get('Player ages')==='7 years' && soloData.get('Players')==='1' && soloData.get('Estimate CAD')==='65 per player; 65 group total','Solo inquiry submits one age without requiring or using an oldest age');
    doc=await load('camps.html',320);
    check(!doc.querySelector('form') && !doc.body.textContent.includes('Request free Friday') && doc.querySelectorAll('a[href$="?kind=dropin"]').length===2,'Each camp offers a direct drop-in registration link');
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
    check(doc.querySelector('[data-camp-price]').textContent==='$400 CAD' && doc.querySelector('[data-camp-total]').textContent==='$400 CAD' && camp.querySelector('[name="Booking option"]:checked').value==='week','Christmas registration defaults to the weekly package, with both sessions at $400');
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
    check(campData.get('Campaign name (URL tag)')==='winter2026' && campData.get('Referral source')==='Family / friend','Camp registration carries the campaign without overwriting the parent-reported referral');
    campWin.fetch=async(url,options)=>{campCalls++;campData=options.body;return {ok:true,json:async()=>({success:true})};};
    camp.requestSubmit();camp.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(campCalls===2 && camp.hidden && !doc.querySelector('#camp-receipt').hidden && campData.get('Client reference')===campReference,'Accepted camp request shows a receipt and blocks duplicate submissions with one reference');
    check(doc.querySelector('#camp-receipt').textContent.includes('$400 CAD') && doc.querySelector('#camp-receipt').textContent.includes('noon–12:30 included') && doc.documentElement.scrollWidth<=321,'Package receipt keeps the correct charge and lunch details readable at 320px');
    doc=await load('christmas-camp-registration.html?kind=dropin',390);
    const dropForm=doc.querySelector('#camp-registration'),dropWin=frame.contentWindow;
    check(!doc.querySelector('[data-camp-day-picker]').hidden && doc.querySelector('[data-camp-total]').textContent==='Choose days' && dropForm.querySelector('[type=submit]').disabled,'Drop-in link opens the day picker and requires an explicit day');
    check([...dropForm.querySelectorAll('.camp-day')].every(el=>el.getBoundingClientRect().height>=44 && el.getBoundingClientRect().width>=44) && [...dropForm.querySelectorAll('[name="Camp days"]')].every(el=>el.getAttribute('aria-label').includes('2026')),'Compact day choices retain full dated accessible names and large touch targets');
    for(const date of ['2026-12-21','2026-12-23','2026-12-25'])dropForm.querySelector('[name="Camp days"][value="'+date+'"]').click();
    check(doc.querySelector('[data-camp-total]').textContent==='$120 CAD' && doc.querySelectorAll('#camp-dates li').length===3 && doc.querySelector('[data-camp-discount]').hidden,'Two paid days plus free Christmas Friday total $120 without a package discount');
    dropForm.elements.namedItem('Daily session').value='both';dropForm.elements.namedItem('Daily session').dispatchEvent(new dropWin.Event('change',{bubbles:true}));
    check(doc.querySelector('[data-camp-total]').textContent==='$240 CAD' && doc.querySelector('[data-camp-lunch]').textContent.includes('Supervised lunch included') && doc.documentElement.scrollWidth<=391,'Both-session drop-ins double the paid total and stay readable on mobile');
    check([...dropForm.querySelectorAll('.camp-day')].every(el=>el.querySelector('small').textContent===(el.querySelector('input').value==='2026-12-25'?'Free':'$120')),'Day labels show the actual full-day price and keep Christmas Friday free');
    for(const [name,value] of [['email','test@example.invalid'],['Player name','Test Player'],['Player age','8']])dropForm.elements.namedItem(name).value=value;
    let dropCalls=0,dropData;dropWin.fetch=async(url,options)=>{dropCalls++;dropData=options.body;return {ok:true,json:async()=>({success:true})};};
    dropForm.requestSubmit();dropForm.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(dropCalls===1 && dropData.get('Registration version')==='SS-CAMP-DROPIN-V1' && dropData.get('Camp booking kind')==='dropin' && dropData.get('Price CAD')==='240' && dropData.get('Covered dates')==='2026-12-21, 2026-12-23, 2026-12-25' && dropData.get('Camp session keys').split('; ').length===6,'Drop-in intake sends only the chosen dates, exact slots and canonical price once');
    check(doc.querySelector('#camp-receipt').textContent.includes('$240 CAD') && !doc.querySelector('#camp-receipt').textContent.includes('Dec 22'),'Drop-in receipt lists selected dates and total');
    doc=await load('boxing-camp-registration.html?week=christmas&kind=week&slot=pm&price=1#camp-booking',320);
    check(doc.querySelector('[data-camp-price]').textContent==='$185 CAD' && doc.querySelector('#camp-dates').textContent.includes('Jan 1, 2027'),'Boxing registration keeps its own $185 package despite untrusted week, kind and price parameters');
    check(doc.querySelector('#camp-booking-title').textContent==='Winter Camp — Week 2' && doc.querySelector('[data-camp-standard]').textContent==='$250' && doc.querySelector('[data-camp-saving]').textContent==='$65','Week 2 registration shows the numbered name and $65 savings');
    doc.querySelector('[name="Daily session"]').value='both';doc.querySelector('[name="Daily session"]').dispatchEvent(new frame.contentWindow.Event('change',{bubbles:true}));
    check(doc.querySelector('[data-camp-price]').textContent==='$370 CAD' && doc.querySelector('[data-camp-lunch]').textContent.includes('Supervised lunch included'),'Boxing Week both-session package is $370 with lunch');
    check(doc.querySelector('[data-camp-standard]').textContent==='$500' && doc.querySelector('[data-camp-saving]').textContent==='$130','Week 2 both-session savings scale to $130 against $500');
    check(doc.querySelector('[data-camp-info-price]').textContent==='$370 CAD' && doc.querySelector('[data-camp-info-savings]').textContent==='Standard $500 · Save $130','Week 2 information card shows the selected package and savings');
    doc.querySelector('[name="Booking option"][value="dropin"]').click();
    for(const date of ['2026-12-28','2027-01-01'])doc.querySelector('[name="Camp days"][value="'+date+'"]').click();
    check(doc.querySelector('[data-camp-total]').textContent==='$240 CAD' && doc.querySelector('#camp-dates').textContent.includes('Jan 1, 2027'),'Week 2 drop-ins include New Year’s Day at the normal $60 per slot');
    doc.querySelector('[name="Booking option"][value="week"]').click();
    check(doc.querySelector('[data-camp-day-picker]').hidden && doc.querySelector('[data-camp-total]').textContent==='$370 CAD','Switching back to a package restores its full week and approved price');
    doc=await load('contact.html?program=camps&utm_source=private%40example.invalid#contact-inquiry');
    check(doc.querySelector('[name="Topic"]').value==='Winter camps' && !doc.querySelector('[name="Message"]').value,'Camp inquiry link selects the right topic without writing a message for the parent');
    const contact=doc.querySelector('form');
    check([...contact.querySelectorAll('[required]')].map(el=>el.name).sort().join(',')==='Message,email','Contact only requires email and a message');
    const more=contact.querySelector('[data-optional-fields]');more.querySelector('summary').click();
    check(more.open && more.querySelector('[name="Referral source"]').getClientRects().length && doc.documentElement.scrollWidth<=doc.documentElement.clientWidth+1,'Tell us more opens optional context without overflow');
    contact.elements.namedItem('email').value='test@example.invalid';contact.elements.namedItem('Message').value='Mocked contact test';contact.elements.namedItem('Referral source').value='community';
    contact.elements.namedItem('Name').value='Example Parent';contact.elements.namedItem('Player or session details').value='Age 8, Thursday';
    let contactData;frame.contentWindow.fetch=async(url,options)=>{contactData=options.body;return {ok:true,json:async()=>({success:true})};};
    contact.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(contactData.get('Referral source')==='School / community' && doc.querySelector('[data-feedback]').textContent.includes('message was submitted') && doc.activeElement===doc.querySelector('[data-feedback]'),'Contact inquiry preserves attribution and focuses a truthful submitted message with email next steps');
    check(contactData.get('Name')==='Example Parent' && contactData.get('Topic')==='Winter camps' && contactData.get('Player or session details')==='Age 8, Thursday','Optional name, enquiry topic and player/session context reach the inquiry');
    check(!['Campaign source (URL tag)','Campaign medium (URL tag)','Campaign name (URL tag)'].some(key=>contactData.has(key)),'An invalid personal campaign value clears prior attribution and cannot reach the contact request');
  } catch(error) {
    check(false,error.message);
  } finally {
    document.querySelector('#status').textContent=`Complete: ${passed} passed, ${failed} failed`;
    document.body.dataset.result=failed?'fail':'pass';
  }
})();
