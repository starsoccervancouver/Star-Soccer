/* Intake checks every dated camp slot before emailing a confirmation. */
(()=>{
  'use strict';
  const T=window.StarTraining,C=window.StarWinterCamps,form=document.querySelector('#camp-registration');if(!T||!C||!form)return;
  const week=form.dataset.campWeek,slot=form.elements.namedItem('Daily session'),age=form.elements.namedItem('Player age');
  const submit=form.querySelector('[type="submit"]'),feedback=document.querySelector('#camp-status'),receipt=document.querySelector('#camp-receipt'),summary=document.querySelector('#camp-quote'),datesList=document.querySelector('#camp-dates');
  const params=new URLSearchParams(location.search);let busy=false,reference='';
  function restore(input,key){const value=params.get(key);if([...input.options].some(o=>o.value===value))input.value=value;}
  restore(slot,'slot');
  function value(){return {week,kind:'week',slot:slot.value,age:age.value};}
  function status(message,error=false){feedback.hidden=false;feedback.textContent=message;feedback.classList.toggle('is-error',error);feedback.setAttribute('role',error?'alert':'status');}
  function update(){
    datesList.replaceChildren();
    try{
      const q=C.quote({...value(),age:C.catalog.minAge});summary.querySelector('[data-camp-price]').textContent=T.money(q.price)+' CAD';form.querySelector('[data-camp-total]').textContent=T.money(q.price)+' CAD';
      form.querySelector('[data-camp-standard]').textContent=T.money(q.standardPrice);
      form.querySelector('[data-camp-saving]').textContent=T.money(q.savings);
      form.querySelector('[data-camp-discount]').hidden=false;
      const info=document.querySelector('[data-camp-info]');
      if(info){
        info.hidden=false;
        info.querySelector('[data-camp-info-time]').textContent=q.time;
        info.querySelector('[data-camp-info-price]').textContent=T.money(q.price)+' CAD';
        info.querySelector('[data-camp-info-package]').textContent=q.label;
        info.querySelector('[data-camp-info-savings]').textContent='Standard '+T.money(q.standardPrice)+' · Save '+T.money(q.savings);
        info.querySelector('[data-camp-info-lunch]').textContent=q.lunch?'Supervised lunch included from noon–12:30. Bring a packed lunch.':'Supervised lunch is included when booking both daily sessions.';
      }
      summary.querySelector('[data-camp-time]').textContent=q.time;
      const quickTime=form.querySelector('[data-quick-camp-time]');
      if(quickTime)quickTime.textContent=q.time+(q.lunch?' · Supervised lunch included':'');
      summary.querySelector('[data-camp-lunch]').textContent=q.lunch?'Supervised lunch included, noon–12:30. Bring a packed lunch.':'Lunch supervision is included when a player books both daily sessions.';
      q.dates.forEach(d=>{const li=document.createElement('li');li.textContent=T.prettyDate(d)+' · '+q.time;datesList.append(li);});
      summary.querySelector('[data-camp-payment]').textContent=q.price===0?'This Christmas Friday booking is free. No payment is due. Your place still needs coach confirmation.':'After the team confirms your place, e-transfer '+T.catalog.email+'. Include the player name and booking reference. If you have already paid, ask the team to reconcile it before paying again.';
      submit.disabled=false;
    }catch(error){
      form.querySelector('[data-camp-discount]').hidden=true;
      const info=document.querySelector('[data-camp-info]');if(info)info.hidden=true;
      summary.querySelector('[data-camp-price]').textContent='Choose a valid option';form.querySelector('[data-camp-total]').textContent='Choose a valid date and option';
      summary.querySelector('[data-camp-time]').textContent='9 AM–noon or 12:30–3:30 PM';summary.querySelector('[data-camp-lunch]').textContent='Supervised lunch is included when booking both sessions.';
      summary.querySelector('[data-camp-payment]').textContent='The coaching team confirms places before payment.';
      submit.disabled=true;
    }
  }
  slot.addEventListener('change',update);
  form.addEventListener('input',e=>{if(e.target.setCustomValidity)e.target.setCustomValidity('');});update();
  function receiptText(q){return ['Star Soccer winter camp registration request','Reference: '+reference,'Camp: '+q.weekName,'Option: '+q.label,'Dates: '+q.dates.map(T.prettyDate).join('; '),'Time: '+q.time,'Location: Kitsilano Turf','Ages: 5–14','Booking total: '+T.money(q.price)+' CAD',q.lunch?'Supervised lunch: noon–12:30 included. Bring a packed lunch.':'', 'A place is confirmed by the coaching team; form-service acceptance is not a reservation.',q.price===0?'This Christmas Friday option is free; no payment is due.':'After coach confirmation, e-transfer '+T.catalog.email+' with player name and reference.','If already paid, ask the team to reconcile it before paying again.'].filter(Boolean).join('\n');}
  function showReceipt(q){
    receipt.hidden=false;receipt.replaceChildren();
    const h=document.createElement('h2');h.textContent='Camp registration received';
    const lead=document.createElement('p');lead.textContent='Your registration was received. Look out for your confirmation email after we check space in every camp session. Romeo will follow up about payment. If the package is full, we’ll email you about the waitlist.';
    const details=document.createElement('pre');details.className='camp-receipt-details';details.textContent=receiptText(q);
    const actions=document.createElement('div');actions.className='flow-actions';
    const print=document.createElement('button');print.type='button';print.className='button';print.textContent='Print / save details';print.addEventListener('click',()=>window.print());
    const download=document.createElement('button');download.type='button';download.className='button button-ghost';download.textContent='Download camp & payment details';download.addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([receiptText(q)],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='star-soccer-'+reference+'.txt';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    const email=document.createElement('a');email.className='flow-text-link';email.href='mailto:'+T.catalog.email;email.textContent='Contact the coaching team';
    actions.append(print,download);receipt.append(h,lead,details,actions,email);receipt.tabIndex=-1;receipt.focus();
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    form.querySelectorAll('input[type="text"][required]').forEach(el=>el.setCustomValidity(el.value.trim()?'':'Please enter a value.'));
    update();if(!form.reportValidity())return;
    let q;try{q=C.quote(value());}catch(error){status(error.message,true);return;}
    if(form.elements.namedItem('_honey').value){status('Unable to send. Please email the coaching team.',true);return;}
    if(!reference)reference='SS-CAMP-'+(crypto.randomUUID?crypto.randomUUID().slice(0,8).toUpperCase():Date.now().toString(36).toUpperCase());
    const data=new FormData(form);const fields={'_subject':'Star Soccer winter camp request | '+q.weekName,'_template':'table','_captcha':'false','_replyto':data.get('email'),'Training':'Winter camps · '+q.weekName+' · '+q.time,'Booking type':q.label,'Covered dates':q.dates.join(', '),'Camp session keys':q.sessions.map(s=>s.key).join('; '),'Location':q.location,'Price CAD':String(q.price),'Lunch supervision':q.lunch?'Included noon–12:30':'Not required for one daily session','Client reference':reference,'Catalog version':C.catalog.version};
    fields._subject='Star Soccer camp registration | '+q.weekName+' | '+reference;
    fields['Registration version']='SS-CAMP-V2';fields['Camp week ID']=q.week;fields['Camp slot']=q.slot;
    Object.entries(fields).forEach(([k,v])=>data.set(k,v));data.set('Camp week',q.weekName);data.set('Referral source',T.referralSource(form.elements.namedItem('Referral source').value));
    window.StarCampaignSource?.append(data);
    busy=true;submit.disabled=true;form.setAttribute('aria-busy','true');status('Sending camp request…');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('https://formsubmit.co/ajax/'+T.catalog.email,{method:'POST',body:data,headers:{Accept:'application/json'},signal:controller.signal});
      const body=await response.json();if(!T.accepted(response,body))throw new Error('The service did not accept this request.');
      form.hidden=true;summary.hidden=true;feedback.hidden=true;showReceipt(q);
    }catch(error){
      busy=false;submit.disabled=false;status((error.name==='AbortError'?'The request timed out.':'We could not confirm this request.')+' Your entries are still here. Email '+T.catalog.email+' with reference '+reference+' before trying or paying again.',true);
    }finally{clearTimeout(timer);form.removeAttribute('aria-busy');}
  });
})();
