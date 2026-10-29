/* Intake checks every dated camp slot before emailing a confirmation. */
(()=>{
  'use strict';
  const T=window.StarTraining,C=window.StarWinterCamps,form=document.querySelector('#camp-registration');if(!T||!C||!form)return;
  const week=form.dataset.campWeek,slot=form.elements.namedItem('Daily session'),age=form.elements.namedItem('Player age');
  const submit=form.querySelector('[type="submit"]'),feedback=document.querySelector('#camp-status'),receipt=document.querySelector('#camp-receipt'),summary=document.querySelector('#camp-quote'),datesList=document.querySelector('#camp-dates');
  const params=new URLSearchParams(location.search);let busy=false,reference='';
  const days=form.querySelector('[data-camp-day-picker]'),dayGrid=form.querySelector('[data-camp-day-grid]');
  const kindInputs=[...form.querySelectorAll('[name="Booking option"]')];
  function restore(input,key){const value=params.get(key);if([...input.options].some(o=>o.value===value))input.value=value;}
  restore(slot,'slot');
  if(params.get('kind')==='dropin')kindInputs.find(el=>el.value==='dropin').checked=true;
  function kind(){return kindInputs.find(el=>el.checked).value;}
  C.dates(week).forEach(date=>{
    const label=document.createElement('label');label.className='camp-day';
    const input=document.createElement('input');input.type='checkbox';input.name='Camp days';input.value=date;
    const text=document.createElement('span');
    const weekday=document.createElement('b');weekday.textContent=new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',weekday:'short'}).format(T.isoDate(date));
    const day=document.createElement('span');day.textContent=String(T.isoDate(date).getUTCDate());
    text.append(weekday,day);
    const price=document.createElement('small');
    label.append(input,text,price);dayGrid.append(label);
  });
  function value(){return {week,kind:kind(),slot:slot.value,age:age.value,dates:[...dayGrid.querySelectorAll('input:checked')].map(el=>el.value)};}
  function status(message,error=false){feedback.hidden=false;feedback.textContent=message;feedback.classList.toggle('is-error',error);feedback.setAttribute('role',error?'alert':'status');}
  function update(){
    const dropin=kind()==='dropin';days.hidden=!dropin;
    document.body.classList.toggle('camp-dropin-mode',dropin);
    days.querySelector('p').textContent=(slot.value==='both'?'$120 per day for both sessions.':'$60 per 3-hour session.')+(C.getWeek(week).freeDate?' Christmas Day is free.':'');
    dayGrid.querySelectorAll('input').forEach(el=>{
      const free=el.value===C.getWeek(week).freeDate,price=free?0:slot.value==='both'?120:60;
      el.setAttribute('aria-label',T.prettyDate(el.value)+' · '+(free?'Christmas gift, free':T.money(price)+' for '+(slot.value==='both'?'both sessions':'one session')));
      el.closest('label').querySelector('small').textContent=free?'Free':T.money(price);
      try{C.quote({week,kind:'dropin',slot:slot.value,date:el.value,age:C.catalog.minAge});el.disabled=false;}catch{el.disabled=true;el.checked=false;}
    });
    form.querySelector('[data-camp-price-unit]').textContent=dropin?'per player':'per player / week';
    datesList.replaceChildren();
    try{
      const q=C.quote({...value(),age:C.catalog.minAge});summary.querySelector('[data-camp-price]').textContent=T.money(q.price)+' CAD';form.querySelector('[data-camp-total]').textContent=T.money(q.price)+' CAD';
      form.querySelector('[data-camp-standard]').textContent=q.standardPrice===null?'':T.money(q.standardPrice);
      form.querySelector('[data-camp-saving]').textContent=q.standardPrice===null?'':T.money(q.savings);
      form.querySelector('[data-camp-discount]').hidden=dropin;
      const info=document.querySelector('[data-camp-info]');
      if(info){
        info.hidden=false;
        info.querySelector('[data-camp-info-time]').textContent=q.time;
        info.querySelector('[data-camp-info-price]').textContent=T.money(q.price)+' CAD';
        info.querySelector('[data-camp-info-package]').textContent=q.label;
        info.querySelector('[data-camp-info-savings]').textContent=dropin?q.sessions.filter(s=>s.date!==C.getWeek(week).freeDate).length+' paid sessions × $60'+(q.dates.includes(C.getWeek(week).freeDate)?' · Christmas Friday free':''):'Standard '+T.money(q.standardPrice)+' · Save '+T.money(q.savings);
        info.querySelector('[data-camp-info-lunch]').textContent=q.lunch?'Supervised lunch included from noon–12:30. Bring a packed lunch.':'Supervised lunch is included when booking both daily sessions.';
      }
      summary.querySelector('[data-camp-time]').textContent=q.time;
      const quickTime=form.querySelector('[data-quick-camp-time]');
      if(quickTime)quickTime.textContent=q.time+(q.lunch?' · Supervised lunch included':'');
      summary.querySelector('[data-camp-lunch]').textContent=q.lunch?'Supervised lunch included, noon–12:30. Bring a packed lunch.':'Lunch supervision is included when a player books both daily sessions.';
      q.dates.forEach(d=>{const li=document.createElement('li');li.textContent=T.prettyDate(d)+' · '+q.time;datesList.append(li);});
      summary.querySelector('[data-camp-payment]').textContent=q.price===0?'This Christmas Friday booking is free. Your place still needs coach confirmation.':T.paymentInstructions();
      submit.disabled=false;
      feedback.hidden=true;
    }catch(error){
      form.querySelector('[data-camp-discount]').hidden=true;
      const info=document.querySelector('[data-camp-info]');
      if(info){
        info.hidden=!dropin;
        if(dropin){
          info.querySelector('[data-camp-info-price]').textContent='Choose days';
          info.querySelector('[data-camp-info-package]').textContent='Your total covers only the days you choose.';
          info.querySelector('[data-camp-info-savings]').textContent='$60 per 3-hour session'+(C.getWeek(week).freeDate?' · Christmas Friday free':'');
        }
      }
      summary.querySelector('[data-camp-price]').textContent='Choose a valid option';form.querySelector('[data-camp-total]').textContent='Choose a valid date and option';
      summary.querySelector('[data-camp-time]').textContent='9 AM–noon or 12:30–3:30 PM';summary.querySelector('[data-camp-lunch]').textContent='Supervised lunch is included when booking both sessions.';
      summary.querySelector('[data-camp-payment]').textContent='The coaching team confirms places before payment.';
      submit.disabled=true;
      if(dropin){
        form.querySelector('[data-camp-total]').textContent='Choose days';
        summary.querySelector('[data-camp-price]').textContent='Choose days';
        const li=document.createElement('li');li.textContent='Choose one or more days to see your dates and total.';datesList.append(li);
      }
    }
  }
  slot.addEventListener('change',update);
  kindInputs.forEach(input=>input.addEventListener('change',()=>{reference='';update();}));
  dayGrid.addEventListener('change',()=>{reference='';update();});
  slot.addEventListener('change',()=>{reference='';});
  form.addEventListener('input',e=>{if(e.target.setCustomValidity)e.target.setCustomValidity('');});update();
  function receiptText(q){return ['Star Soccer winter camp registration request','Reference: '+reference,'Camp: '+q.weekName,'Option: '+q.label,'Dates: '+q.dates.map(T.prettyDate).join('; '),'Time: '+q.time,'Location: Kitsilano Turf','Ages: 5–14','Booking total: '+T.money(q.price)+' CAD',q.lunch?'Supervised lunch: noon–12:30 included. Bring a packed lunch.':'', 'A place is confirmed by the coaching team; form-service acceptance is not a reservation.',q.price===0?'This Christmas Friday option is free.':T.paymentInstructions()].filter(Boolean).join('\n');}
  function showReceipt(q){
    receipt.hidden=false;receipt.replaceChildren();
    const h=document.createElement('h2');h.textContent='Camp registration submitted';
    const lead=document.createElement('p');lead.textContent='Your request was submitted. We’ll check space and email your confirmation. Romeo will follow up about payment. If a session is full, we’ll email you about the waitlist.';
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
    fields['Registration version']=q.kind==='dropin'?'SS-CAMP-DROPIN-V1':'SS-CAMP-V2';fields['Camp week ID']=q.week;fields['Camp slot']=q.slot;fields['Camp booking kind']=q.kind;
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
