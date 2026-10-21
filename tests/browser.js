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
    return doc;
  }
  const change=(doc,id,value)=>{const el=doc.getElementById(id);el.value=value;el.dispatchEvent(new frame.contentWindow.Event('change',{bubbles:true}));};
  try {
    const pages=['index.html','programs.html','program-private-small-group.html','methodology.html','locations.html','contact.html','camps.html','selectivo.html','registration.html?sessionId=wednesday&type=pass4','registration-thank-you.html'];
    for(const width of [375,900,1024,1440]) {
      for(const page of pages) {
        const doc=await load(page,width);
        const overflow=doc.documentElement.scrollWidth-doc.documentElement.clientWidth;
        const oversized=[...doc.body.querySelectorAll('*')].filter(el=>el.getBoundingClientRect().right>doc.documentElement.clientWidth+1).slice(0,4).map(el=>el.className).join(', ');
        check(overflow<=1,`${page} at ${width}px has no horizontal overflow${overflow>1?' ('+overflow+'px; '+oversized+')':''}`);
      }
    }
    let doc=await load('programs.html?age=14&day=sunday&source=test#sessions');
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
    check(toggle.getAttribute('aria-expanded')==='true' && frame.contentWindow.getComputedStyle(doc.querySelector('nav')).display!=='none','Mobile menu opens');
    doc.dispatchEvent(new frame.contentWindow.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    check(toggle.getAttribute('aria-expanded')==='false' && doc.activeElement===toggle,'Escape closes menu and returns focus');
    toggle.click();doc.querySelector('.header-program-cta').click();
    check(doc.activeElement===doc.querySelector('#sessions') && toggle.getAttribute('aria-expanded')==='false','Same-page menu link moves focus to sessions');
    doc=await load('registration.html?sessionId=camp-u4-u6&type=dropin');
    check(doc.querySelector('#training-registration').hidden && doc.querySelector('#registration-status').textContent.includes('no longer available'),'Retired camp registration is rejected');
    doc=await load('registration.html?sessionId=wednesday&type=pass4');
    const win=frame.contentWindow,form=doc.querySelector('form'),T=win.StarTraining;
    form.elements.namedItem('Start date').value=T.nextDate(T.getSession('wednesday'));
    for(const [name,value] of [['Parent name','Website Test'],['email','test@example.invalid'],['Player name','Test Player'],['Player age','10']])form.elements.namedItem(name).value=value;
    let calls=0;
    win.fetch=async()=>{calls++;return {ok:true,json:async()=>({success:false})};};
    form.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(calls===1 && doc.querySelector('#receipt').hidden && !form.hidden && form.elements.namedItem('Player name').value==='Test Player','Service rejection retains entries and cannot show a receipt');
    win.fetch=async()=>{calls++;return {ok:true,json:async()=>({success:true})};};
    form.requestSubmit();form.requestSubmit();await new Promise(resolve=>setTimeout(resolve,30));
    check(calls===2 && form.hidden && !doc.querySelector('#receipt').hidden,'Accepted registration shows receipt and blocks duplicate submission');
    check(doc.querySelector('#receipt').textContent.includes('$95') && doc.querySelector('#booking-dates').children.length===4,'Four-session receipt keeps the approved price and dates');
    doc=await load('program-private-small-group.html?coach=romeo');
    check(doc.querySelector('[name="Preferred coach"]').value==='romeo','Coach preference survives the inquiry link');
    doc.querySelector('[name="Players"]').value='2';
    const duration=doc.querySelector('[name="Minutes"]');duration.value='120';duration.dispatchEvent(new frame.contentWindow.Event('change',{bubbles:true}));
    check(doc.querySelector('#private-estimate').textContent.includes('$80 per player') && doc.querySelector('#private-estimate').textContent.includes('$160 total'),'Private two-hour group quote keeps approved rounding');
  } catch(error) {
    check(false,error.message);
  } finally {
    document.querySelector('#status').textContent=`Complete: ${passed} passed, ${failed} failed`;
    document.body.dataset.result=failed?'fail':'pass';
  }
})();
