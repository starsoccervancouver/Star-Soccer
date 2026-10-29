/* Shared form handling. Form-service acceptance is distinct from email delivery.
 * Public ledger counts are informational, with no atomic capacity reservation on GitHub Pages.
 */
(() => {
  'use strict';
  const T=window.StarTraining;
  if(!T) return;
  const params=new URLSearchParams(window.location.search);
  const receiptKey='star-soccer-receipt-v1';
  const text=(selector,value)=>{const el=document.querySelector(selector);if(el)el.textContent=value;};
  function status(el,message,error=false) {el.hidden=false;el.textContent=message;el.classList.toggle('is-error',error);el.setAttribute('role',error?'alert':'status');}
  function validForm(form) {
    form.querySelectorAll('input[type="text"][required],textarea[required]').forEach(el=>el.setCustomValidity(el.value.trim()?'':'Please enter a value.'));
    return form.reportValidity();
  }
  document.querySelectorAll('form[data-inquiry],#training-registration').forEach(form=>form.addEventListener('input',e=>{if(e.target.setCustomValidity)e.target.setCustomValidity('');}));
  async function send(formData) {
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
    try {
      const response=await fetch('https://formsubmit.co/ajax/'+T.catalog.email,{method:'POST',body:formData,headers:{Accept:'application/json'},signal:controller.signal});
      let body;
      try {body=await response.json();} catch {throw new Error('The submission service returned an unexpected response. Your submission is not confirmed.');}
      if(!T.accepted(response,body)) throw new Error('The submission service did not accept this request. Your submission is not confirmed.');
    } catch(error) {
      if(error.name==='AbortError') throw new Error('The request timed out. We cannot tell whether it arrived; email us before trying again.');
      if(error instanceof TypeError) throw new Error('We could not verify the submission. Check your connection or contact us before trying again.');
      throw error;
    } finally {clearTimeout(timer);}
  }
  function configuredData(form,subject) {
    const data=new FormData(form);
    data.set('Referral source',T.referralSource(form.elements.namedItem('Referral source')?.value));
    data.set('_subject',subject);data.set('_template','table');data.set('_captcha','false');
    data.set('_replyto',String(data.get('email')||''));
    data.delete('_autoresponse');data.delete('_cc');
    window.StarCampaignSource?.append(data);
    return data;
  }
  // Optional, parent-reported attribution travels with the inquiry, not to a tracker.
  document.querySelectorAll('form[data-inquiry],#training-registration').forEach(form=>{
    const label=document.createElement('label');label.className='referral-source';label.textContent='How did you hear about us? (optional)';
    const select=document.createElement('select');select.name='Referral source';
    const blank=document.createElement('option');blank.value='';blank.textContent='Choose or leave blank';select.append(blank);
    Object.entries(T.referralSources).forEach(([value,name])=>{const option=document.createElement('option');option.value=value;option.textContent=name;select.append(option);});
    const help=document.createElement('small');help.textContent='Helps our team understand how families find training.';
    label.append(select,help);
    const extras=form.querySelector('[data-optional-fields] .quick-extras');
    if(extras)extras.append(label);else form.querySelector('.form-privacy').before(label);
  });
  function showReceipt(container,receipt) {
    container.hidden=false; container.replaceChildren();
    const heading=document.createElement('h2');heading.textContent='Registration received';container.append(heading);
    const lead=document.createElement('p');lead.textContent='Your registration request was accepted by our form service. The coaching team will confirm a place for the sessions below before payment. If you have already paid, the team will reconcile it.';container.append(lead);
    const dl=document.createElement('dl');dl.className='flow-summary';
    const values=[['Your reference',receipt.reference],['Training',receipt.sessionName],['Dates',receipt.dates.map(T.prettyDate).join('; ')],['Location',receipt.location],['Coaches',receipt.coaches],['Booking',receipt.label],['Booking total',T.money(receipt.price)+' CAD']];
    values.forEach(([label,value])=>{const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;row.append(dt,dd);dl.append(row);});container.append(dl);
    const payment=document.createElement('p');payment.textContent='After coach confirmation, e-transfer '+T.catalog.email+'. Include the player name, date and your reference with payment.';container.append(payment);
    const help=document.createElement('p');help.textContent='Save or print these details. Email delivery is not verified by this page. Contact the coaching team about attendance or weather changes.';container.append(help);
    const actions=document.createElement('div');actions.className='flow-actions';
    const print=document.createElement('button');print.type='button';print.className='button';print.textContent='Print / save confirmation';print.addEventListener('click',()=>window.print());
    const download=document.createElement('button');download.type='button';download.className='button button-ghost';download.textContent='Download booking & payment details';
    download.addEventListener('click',()=>{
      const url=URL.createObjectURL(new Blob([T.receiptText(receipt)],{type:'text/plain;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download='star-soccer-'+(receipt.reference.replace(/[^a-z0-9-]/gi,'')||'booking')+'.txt';
      document.body.append(a);a.click();a.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    const back=document.createElement('a');back.href='programs.html';back.className='button button-ghost';back.textContent='Back to weekly training';actions.append(print,download,back);container.append(actions);
    container.tabIndex=-1;container.focus();
  }
  function readReceipt() {
    try {const r=JSON.parse(sessionStorage.getItem(receiptKey)||'null');return r && r.accepted===true && typeof r.reference==='string' && typeof r.sessionName==='string' && Array.isArray(r.dates) && r.dates.every(d=>T.isoDate(d)) && Number.isFinite(r.price) && Date.now()-r.acceptedAt>=0 && Date.now()-r.acceptedAt<86400000 ? r:null;} catch {return null;}
  }
  const receiptPanel=document.querySelector('#receipt');
  if(document.body.dataset.page==='confirmation' && receiptPanel) {
    const receipt=readReceipt();
    if(receipt) {document.querySelector('#no-receipt').hidden=true;showReceipt(receiptPanel,receipt);}
  }
  const form=document.querySelector('#training-registration');
  if(form) {
    const button=form.querySelector('[type="submit"]'),feedback=document.querySelector('#registration-status');
    const age=form.elements.namedItem('Player age'),date=form.elements.namedItem('Start date');
    let selected,busy=false,reference='';
    const recovery=document.createElement('div');recovery.className='registration-recovery';recovery.hidden=true;feedback.after(recovery);
    try {selected=T.choice(params.get('sessionId'),params.get('type'));}
    catch(error) {form.hidden=true;document.querySelector('#booking-summary').hidden=true;document.querySelector('.quick-booking-details')?.setAttribute('hidden','');status(feedback,error.message,true);return;}
    const {session:s,type,label,price}=selected;
    age.min=s.minAge;age.max=s.maxAge;age.step='1';date.min=T.nextDate(s);
    text('#booking-title',s.day+' training');text('#booking-session',s.day+' · '+s.time);
    text('#booking-ages','Ages '+s.minAge+'–'+s.maxAge);text('#age-help','This session accepts ages '+s.minAge+'–'+s.maxAge+'.');
    text('#booking-location',T.catalog.locations[s.location].name);
    text('#booking-coaches',s.coaches.map(c=>T.catalog.coaches[c]).join(' & '));
    text('#booking-type',label);text('#booking-price',T.money(price)+' CAD');
    text('#date-label',type==='pass4'?'First session date':'Session date');
    text('#date-help','Choose an upcoming '+s.day+'. All times are Vancouver time.');
    const datePreview=document.querySelector('#booking-dates');
    function updateDate() {
      date.setCustomValidity('');datePreview.replaceChildren();
      if(!date.value) {const li=document.createElement('li');li.textContent='Select a date to review '+(type==='pass4'?'all four sessions.':'your session.');datePreview.append(li);return;}
      try {T.booking(s.id,type,date.value,s.minAge).dates.forEach(d=>{const li=document.createElement('li');li.dataset.sessionDate=d;li.dataset.sessionId=s.id;li.textContent=T.prettyDate(d)+' · '+s.time;datePreview.append(li);});}
      catch(error) {date.setCustomValidity(error.message);const li=document.createElement('li');li.textContent=error.message;datePreview.append(li);}
    }
    date.addEventListener('change',updateDate);updateDate();button.disabled=false;
    // An explicit shortcut avoids navigating a date picker on small screens.
    // Calculate on click so an overnight-open tab never selects yesterday.
    const nextDate=document.createElement('button');nextDate.type='button';
    nextDate.className='button button-ghost booking-next-date';
    nextDate.textContent=form.closest('.quick-flow')?'Next date':'Use next '+s.day+' · '+T.prettyDate(T.nextDate(s));
    nextDate.setAttribute('aria-label','Use next '+s.day+' · '+T.prettyDate(T.nextDate(s)));
    nextDate.addEventListener('click',()=>{date.min=T.nextDate(s);date.value=date.min;updateDate();});
    const dateRow=form.querySelector('.quick-date-row');
    if(dateRow)dateRow.append(nextDate);else date.closest('label').after(nextDate);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy) return;
      updateDate();if(!validForm(form)) return;
      let booking;
      try {booking=T.booking(s.id,type,date.value,age.value);}
      catch(error) {status(feedback,error.message,true);return;}
      if(form.elements.namedItem('_honey').value) {status(feedback,'Unable to send this registration. Please email the coaching team.',true);return;}
      busy=true;button.disabled=true;form.setAttribute('aria-busy','true');status(feedback,'Submitting registration…');
      if(!reference)reference='SS-'+(window.crypto?.randomUUID ? window.crypto.randomUUID().slice(0,8).toUpperCase():Date.now().toString(36).toUpperCase());
      recovery.hidden=true;
      const data=configuredData(form,`Star Soccer registration | ${s.day} | ${date.value}`);
      const fields={'Session ID':s.id,'Training':s.day+' '+s.time,'Booking type':label,'Covered dates':booking.dates.join(', '),'Location':booking.location,'Coaches':booking.coaches,'Price CAD':String(price),'Catalog version':T.catalog.version,'Client reference':reference};
      Object.entries(fields).forEach(([key,value])=>data.set(key,value));
      try {
        await send(data);
        const receipt={accepted:true,acceptedAt:Date.now(),reference,sessionName:s.day+' · '+s.time,dates:booking.dates,location:booking.location,coaches:booking.coaches,label,price};
        let saved=false;try {sessionStorage.setItem(receiptKey,JSON.stringify(receipt));saved=true;}catch { /* Keep the on-page receipt if storage is unavailable. */ }
        form.hidden=true;feedback.hidden=true;document.querySelector('.quick-booking-details')?.setAttribute('hidden','');showReceipt(receiptPanel,receipt);
        if(saved) {const a=document.createElement('a');a.href='registration-thank-you.html';a.textContent='Open confirmation page';a.className='flow-text-link';receiptPanel.append(a);}
      } catch(error) {
        busy=false;button.disabled=false;status(feedback,error.message+' Your entries are still here. Contact '+T.catalog.email+' for help.',true);
        recovery.replaceChildren();
        const lead=document.createElement('p');lead.textContent='Check with the team before registering or paying again. Your reference is '+reference+'.';
        const email=document.createElement('a');email.className='button button-ghost';email.href=T.registrationHelp(booking,reference);email.textContent='Email to check this registration';
        const note=document.createElement('p');note.textContent='The email draft includes your session details and reference. Add your name and player name before sending.';
        recovery.append(lead,email,note);recovery.hidden=false;
      }
      finally {form.removeAttribute('aria-busy');}
    });
  }
  const privateForm=document.querySelector('#private-inquiry');
  if(privateForm) {
    const youngest=privateForm.elements.namedItem('Youngest age'),oldest=privateForm.elements.namedItem('Oldest age');
    const validateAges=()=>{
      const group=Number(privateForm.elements.namedItem('Players').value)>1;
      const label=group?'Youngest age':'Player age';
      document.querySelector('.private-age-end').hidden=!group;
      document.querySelector('.private-age-range').classList.toggle('is-single',!group);
      text('#private-age-label',label);youngest.setAttribute('aria-label',label);
      text('.private-age-range legend',group?'Player age range in years':'Player age in years');
      text('#private-age-help',group?'Choose the youngest and oldest player ages in whole years, starting at five.':'Choose the player’s age in whole years, starting at five.');
      youngest.closest('.ss-number-stepper')?.querySelectorAll('[data-direction]').forEach(button=>button.setAttribute('aria-label',(button.dataset.direction==='1'?'Increase ':'Decrease ')+label.toLowerCase()));
      oldest.disabled=!group;oldest.required=group;
      const lower=Number(youngest.value);
      oldest.min=String(Number.isSafeInteger(lower)&&lower>=5&&lower<=99?lower:5);
      oldest.setCustomValidity(group && youngest.value && oldest.value && lower>Number(oldest.value)?'The oldest age must be the same as or above the youngest age.':'');
    };
    privateForm.addEventListener('input',validateAges);
    privateForm.addEventListener('change',validateAges);
    validateAges();
    const coach=privateForm.elements.namedItem('Preferred coach');coach.value=T.coachId(params.get('coach'));
    const coachLabel=document.querySelector('#quick-private-coach');
    const updateCoach=()=>{
      if(coachLabel){coachLabel.hidden=!coach.value;coachLabel.textContent=coach.value?'Preferred coach: '+T.catalog.coaches[coach.value]:'';}
      text('#private-info-coach',T.catalog.coaches[coach.value]||'No preference');
    };
    coach.addEventListener('change',updateCoach);updateCoach();
    const players=privateForm.elements.namedItem('Players'),duration=privateForm.elements.namedItem('Minutes');
    const formats=[...privateForm.querySelectorAll('[name="Training format"]')];
    const smallGroup=()=>formats.some(el=>el.checked && el.value==='smallgroup');
    const applyFormat=()=>{
      const group=smallGroup(),min=group?6:1,max=group?18:5;
      players.min=String(min);players.max=String(max);
      if(!Number.isSafeInteger(Number(players.value)) || Number(players.value)<min || Number(players.value)>max)players.value=String(min);
      // Let the shared number stepper refresh its boundary buttons as well.
      players.dispatchEvent(new Event('input',{bubbles:true}));
    };
    const estimate=document.querySelector('#private-estimate');
    const updateQuote=()=>{
      const validCount=players.validity.valid;
      const q=validCount?T.privateQuote(players.value,duration.value):null;
      const group=smallGroup();
      text('#private-summary-title',group?'Small Group Training':'Private Training');
      const submit=privateForm.querySelector('[type="submit"]');
      if(!privateForm.hasAttribute('aria-busy') && submit.textContent!=='Inquiry submitted')submit.textContent=group?'Send small group inquiry':'Send private inquiry';
      estimate.textContent=q?`${T.money(q.perPlayer)} per player · ${T.money(q.total)} total (CAD)`:validCount?'We’ll confirm a price for your requested duration.':`Choose ${group?'6–18':'1–5'} players for this training.`;
      const durationText=duration.value==='other'?'Custom duration':duration.value+' minutes';
      text('#private-info-duration',durationText);
      const count=Number(players.value);
      text('#private-info-players',Number.isSafeInteger(count)&&count>0?count+' '+(count===1?'player':'players'):'Choose players');
      text('#private-info-price',q?T.money(q.perPlayer)+' CAD':'Quote required');
      text('#private-info-price-label',q?'Per player · '+durationText:'We will confirm your rate');
      text('#private-info-total',q?T.money(q.total)+' group total':'Contact our coaching team for a custom estimate');
    };
    [players,duration].forEach(el=>el.addEventListener('change',updateQuote));players.addEventListener('input',updateQuote);
    formats.forEach(el=>el.addEventListener('change',applyFormat));
    const initialFormat=params.get('format')==='smallgroup'?'smallgroup':'private';
    formats.forEach(el=>{el.checked=el.value===initialFormat;});applyFormat();
  }
  document.querySelectorAll('form[data-inquiry]').forEach(inquiry=>{
    let busy=false;
    const submit=inquiry.querySelector('[type="submit"]'),feedback=inquiry.querySelector('[data-feedback]');submit.disabled=false;
    inquiry.addEventListener('submit',async event=>{
      event.preventDefault();if(busy || !validForm(inquiry))return;
      const isPrivate=inquiry===privateForm;
      if(isPrivate) {
        const youngest=inquiry.elements.namedItem('Youngest age'),oldest=inquiry.elements.namedItem('Oldest age');
        if(Number(inquiry.elements.namedItem('Players').value)>1 && Number(youngest.value)>Number(oldest.value)) {oldest.setCustomValidity('The oldest age must be the same as or above the youngest age.');oldest.reportValidity();return;}
      }
      if(inquiry.elements.namedItem('_honey').value) {status(feedback,'Unable to send this request. Please email the coaching team.',true);return;}
      const data=configuredData(inquiry,isPrivate?'Star Soccer private coaching inquiry':'Star Soccer inquiry');
      if(isPrivate) {
        const n=inquiry.elements.namedItem('Players').value,minutes=inquiry.elements.namedItem('Minutes').value;
        const quote=T.privateQuote(n,minutes),coach=inquiry.elements.namedItem('Preferred coach').value;
        const youngest=inquiry.elements.namedItem('Youngest age').value,oldest=Number(n)===1?youngest:inquiry.elements.namedItem('Oldest age').value;
        data.set('Player ages',youngest===oldest?`${youngest} years`:`${youngest}–${oldest} years`);
        data.delete('Youngest age');data.delete('Oldest age');
        data.set('Format',Number(n)<=5?'Private Training (1–5 players)':'Small Group Training (6–18 players)');data.set('Preferred coach',T.catalog.coaches[coach]||'No preference');
        data.set('Estimate CAD',quote?`${quote.perPlayer} per player; ${quote.total} group total`:'Quote to be arranged');
      }
      busy=true;submit.disabled=true;inquiry.setAttribute('aria-busy','true');status(feedback,'Sending inquiry…');
      try {await send(data);status(feedback,isPrivate?'Your coaching inquiry was submitted. We’ll reply by email to arrange a coach, time and location. The coaching team confirms your appointment.':'Your message was submitted. The Star Soccer team will reply by email.');submit.textContent=isPrivate?'Inquiry submitted':'Message submitted';feedback.tabIndex=-1;feedback.focus();}
      catch(error) {busy=false;submit.disabled=false;status(feedback,error.message+' Your entries have been kept. Email '+T.catalog.email+' for help.',true);}
      finally {inquiry.removeAttribute('aria-busy');}
    });
  });
  if(document.body.dataset.page==='contact') {
    const coach=T.coachId(params.get('coach'));
    if(coach || params.get('program')==='private-training') {
      window.location.replace('program-private-small-group.html'+(coach?'?coach='+encodeURIComponent(coach):'')+'#private-form');
    }
    const topic=document.querySelector('[name="Topic"]');
    if(topic && params.get('program')==='selectivo') topic.value='Selectivo updates';
    if(topic && params.get('program')==='camps') topic.value='Winter camps';
    if(topic && params.get('topic')==='adult-women') {
      topic.value="Tuesday women's soccer";
      const extras=topic.closest('details');
      if(extras) extras.open=true;
    }
  }
})();
