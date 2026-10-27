/* Four essentials. Provider acceptance queues intake; the worker confirms the roster by email. */
(()=>{
  'use strict';
  const T=window.StarTraining,W=window.StarWeeklySignup,form=document.querySelector('#training-registration');
  if(!T||!W||!form)return;
  const params=new URLSearchParams(location.search),feedback=document.querySelector('#registration-status'),receipt=document.querySelector('#receipt'),submit=form.querySelector('[type="submit"]');
  const status=(message,error=false)=>{feedback.hidden=false;feedback.textContent=message;feedback.setAttribute('role',error?'alert':'status');feedback.classList.toggle('is-error',error);};
  let choice,busy=false,reference='';
  try{choice=T.choice(params.get('sessionId'),params.get('type')||'dropin');}
  catch(error){form.hidden=true;document.querySelector('#booking-summary').hidden=true;status(error.message,true);return;}
  const s=choice.session;
  const info=document.querySelector('[data-training-info]');
  if(info){
    info.hidden=false;
    info.querySelector('[data-training-info-option]').textContent=s.day+' · '+choice.label;
    info.querySelector('[data-training-info-venue]').textContent=T.catalog.locations[s.location].name;
    info.querySelector('[data-training-info-time]').textContent=s.time+' · Vancouver time';
    info.querySelector('[data-training-info-ages]').textContent='Ages '+s.minAge+'–'+s.maxAge+' · 20 per session';
    info.querySelector('[data-training-info-coaches]').textContent=s.coaches.map(id=>T.catalog.coaches[id]).join(' & ');
    info.querySelector('[data-training-info-date]').textContent=T.prettyDate(T.nextDate(s));
    info.querySelector('[data-training-info-price]').textContent=T.money(choice.price)+' CAD';
    info.querySelector('[data-training-info-price-label]').textContent=choice.type==='pass4'?'per player · four sessions':'per player · one session';
  }
  document.querySelector('#booking-title').textContent=s.day+' training';
  document.querySelector('#booking-session').textContent=s.time+' · '+T.catalog.locations[s.location].name;
  document.querySelector('#booking-ages').textContent='Ages '+s.minAge+'–'+s.maxAge;
  const age=form.elements.namedItem('Player age');age.min=s.minAge;age.max=s.maxAge;
  document.querySelector('#age-help').textContent='Ages '+s.minAge+'–'+s.maxAge+'.';
  const passSummary=document.querySelector('#quick-pass-summary'),passStart=document.querySelector('#pass-start');
  let passStartChanged=false;
  function updatePass(){
    if(choice.type!=='pass4')return null;
    passStart.min=T.nextDate(s);passStart.setCustomValidity('');
    const p=W.passPlan(s.id,passStartChanged?passStart.value:null);passSummary.hidden=false;
    document.querySelector('#pass-price').textContent=T.money(p.price)+' CAD · 4 sessions';
    passStart.value=p.start;
    document.querySelector('#pass-end').textContent=T.prettyDate(p.end);
    if(info){
      info.querySelector('[data-training-info-date-label]').textContent='Pass starts';
      info.querySelector('[data-training-info-date]').textContent=T.prettyDate(p.start);
      info.querySelector('[data-training-info-end-row]').hidden=false;
      info.querySelector('[data-training-info-end]').textContent=T.prettyDate(p.end);
    }
    return p;
  }
  if(choice.type==='pass4'){
    document.querySelector('#booking-title').textContent=s.day+' 4-week pass';
    submit.textContent='Register for 4-week pass';
    document.querySelector('.quick-assurance').textContent='Your confirmation email includes dates and payment details.';
    passStart.disabled=false;
    passStart.addEventListener('input',()=>passStart.setCustomValidity(''));
    passStart.addEventListener('change',()=>{
      passStartChanged=Boolean(passStart.value);
      try{updatePass();}catch(error){passStart.setCustomValidity(error.message);document.querySelector('#pass-end').textContent='Choose an upcoming '+s.day;if(info){info.querySelector('[data-training-info-date]').textContent='Choose a valid start date';info.querySelector('[data-training-info-end]').textContent='—';}passStart.reportValidity();}
    });
    updatePass();
  }
  submit.disabled=false;
  form.addEventListener('input',event=>event.target.setCustomValidity?.(''));
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    form.elements.namedItem('Player name').setCustomValidity(form.elements.namedItem('Player name').value.trim()?'':'Enter the child’s name.');
    if(!form.reportValidity())return;
    let request;
    try{request=W.request(s.id,choice.type,{name:form.elements.namedItem('Player name').value,email:form.elements.namedItem('email').value,age:age.value,experience:form.elements.namedItem('Experience').value});}
    catch(error){status(error.message,true);return;}
    let pass;
    try{pass=updatePass();}catch(error){passStart.setCustomValidity(error.message);passStart.reportValidity();return;}
    if(form.elements.namedItem('_honey').value){status('Unable to send. Please email '+T.catalog.email+'.',true);return;}
    if(!reference)reference='SS-'+(crypto.randomUUID?crypto.randomUUID().toUpperCase():Date.now().toString(36).toUpperCase());
    const data=new FormData();
    const fields={'Registration version':request.version,'Client reference':reference,'Session ID':s.id,'Training':s.day+' '+s.time,'Location':T.catalog.locations[s.location].name,'Player name':request.name,'Player age':String(request.age),email:request.email,Experience:request.experience,'Requested option':choice.label,'Attendance policy':'Expect next session unless parent declines; no dated choice submitted','Payment status':'Follow up later; no payment collected',_replyto:request.email,_subject:'Star Soccer weekly registration | '+s.day+' | '+reference,_template:'table',_captcha:'false',_honey:''};
    if(pass){
      Object.assign(fields,{'Start date policy':'Selected at registration; defaults to next eligible session','Pass start choice':passStartChanged?'Selected date':'Upcoming session (default)','Pass start date':pass.start,'Expected start date':pass.start,'Expected end date':pass.end,'Covered dates':pass.dates.join(', '),'Price CAD':String(pass.price),'Attendance policy':'Reserve four selected weeks; attendance inquiry only for upcoming-session start','Payment status':'Instructions in confirmation email; no payment collected',_subject:'Star Soccer pass registration | '+s.day+' | '+reference});
    }
    Object.entries(fields).forEach(([key,value])=>data.set(key,value));
    busy=true;submit.disabled=true;form.setAttribute('aria-busy','true');status('Registering…');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('https://formsubmit.co/ajax/'+T.catalog.email,{method:'POST',body:data,headers:{Accept:'application/json'},signal:controller.signal});
      let body;try{body=await response.json();}catch{throw new Error('We couldn’t verify your registration.');}
      if(!T.accepted(response,body))throw new Error('Your registration wasn’t accepted.');
      form.hidden=true;feedback.hidden=true;passSummary.hidden=true;receipt.hidden=false;receipt.replaceChildren();
      const heading=document.createElement('h2');heading.textContent='Thanks — registration received';
      const message=document.createElement('p');message.textContent=pass?'Look out for your pass confirmation with all four dates, payment instructions and a way to change your start. If any session is full, we’ll email you about availability.':'Look out for your registration email and next-session attendance question. Romeo will follow up about payment. If the group is full, we’ll email you about the waitlist.';
      const ref=document.createElement('p');ref.textContent='Your reference: '+reference;
      const back=document.createElement('a');back.href='programs.html#sessions';back.className='flow-text-link';back.textContent='Back to weekly training';
      receipt.append(heading,message);
      if(pass){const details=document.createElement('p');details.textContent=T.money(pass.price)+' CAD · Expected start: '+T.prettyDate(pass.start)+' · Expected end (4th session): '+T.prettyDate(pass.end);receipt.append(details);}
      receipt.append(ref,back);receipt.tabIndex=-1;receipt.focus();
    }catch(error){
      busy=false;submit.disabled=false;
      const message=error.name==='AbortError'?'This took longer than expected. We can’t tell whether it arrived.':error.message;
      status(message+' Your entries are still here. Email the team before trying again. Reference: '+reference,true);
      let recovery=document.querySelector('.registration-recovery');
      if(!recovery){recovery=document.createElement('p');recovery.className='registration-recovery';feedback.after(recovery);}
      recovery.hidden=false;recovery.replaceChildren();
      const link=document.createElement('a');link.className='flow-text-link';link.textContent='Email to check this registration';link.href='mailto:'+T.catalog.email+'?subject='+encodeURIComponent('Check registration | '+reference)+'&body='+encodeURIComponent('Please check registration '+reference+' for '+s.day+' training. The website attempt was not confirmed.');recovery.append(link);
    }finally{clearTimeout(timer);form.removeAttribute('aria-busy');if(form.hidden)document.querySelector('.registration-recovery')?.setAttribute('hidden','');}
  });
})();
