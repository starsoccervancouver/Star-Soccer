/* Provider acceptance queues intake; only the coaching team confirms a place. */
(()=>{
  'use strict';
  const T=window.StarTraining,W=window.StarWeeklySignup,F=window.StarFamilyRegistration,form=document.querySelector('#training-registration');
  if(!T||!W||!F||!form)return;
  const params=new URLSearchParams(location.search),feedback=document.querySelector('#registration-status'),receipt=document.querySelector('#receipt'),submit=form.querySelector('[type="submit"]');
  const status=(message,error=false)=>{feedback.hidden=false;feedback.textContent=message;feedback.setAttribute('role',error?'alert':'status');feedback.classList.toggle('is-error',error);};
  let choice,busy=false;
  try{choice=T.choice(params.get('sessionId'),params.get('type')||'dropin');}
  catch(error){form.hidden=true;document.querySelector('#booking-summary').hidden=true;status(error.message,true);return;}
  const s=choice.session,info=document.querySelector('[data-training-info]'),datesList=document.querySelector('#booking-dates');
  let dropinDate=T.nextDate(s);
  if(info){
    info.hidden=false;
    info.querySelector('[data-training-info-option]').textContent=s.day+' · '+choice.label;
    info.querySelector('[data-training-info-venue]').textContent=T.catalog.locations[s.location].name;
    info.querySelector('[data-training-info-time]').textContent=s.time+' · Vancouver time';
    info.querySelector('[data-training-info-ages]').textContent='Ages '+s.minAge+'–'+s.maxAge+' · 20 per session';
    info.querySelector('[data-training-info-coaches]').textContent=s.coaches.map(id=>T.catalog.coaches[id]).join(' & ');
    info.querySelector('[data-training-info-date]').textContent=T.prettyDate(dropinDate);
    info.querySelector('[data-training-info-price]').textContent=T.money(choice.price)+' CAD';
    info.querySelector('[data-training-info-price-label]').textContent=choice.type==='pass4'?'per player · four sessions':'per player · one session';
  }
  document.querySelector('#booking-title').textContent=s.day+' training';
  document.querySelector('#booking-session').textContent=s.time+' · '+T.catalog.locations[s.location].name;
  document.querySelector('#booking-ages').textContent='Ages '+s.minAge+'–'+s.maxAge;
  const dropinSummary=document.querySelector('#quick-dropin-summary');
  if(choice.type==='dropin'&&dropinSummary){dropinSummary.hidden=false;dropinSummary.querySelector('strong').textContent=T.money(choice.price)+' CAD · one session';}
  const age=form.elements.namedItem('Player age');age.min=s.minAge;age.max=s.maxAge;
  document.querySelector('#age-help').textContent='Ages '+s.minAge+'–'+s.maxAge+'.';
  const passSummary=document.querySelector('#quick-pass-summary'),passStart=document.querySelector('#pass-start');
  let passStartChanged=false,passCalendar=null;
  function renderDates(dates){
    datesList.replaceChildren();
    dates.forEach(date=>{const li=document.createElement('li');li.dataset.sessionId=s.id;li.dataset.sessionDate=date;li.textContent=T.prettyDate(date);datesList.append(li);});
  }
  function updatePass(){
    if(choice.type!=='pass4')return null;
    passStart.min=T.nextDate(s);passStart.setCustomValidity('');
    const p=W.passPlan(s.id,passStartChanged?passStart.value:null);passSummary.hidden=false;
    document.querySelector('#pass-price').textContent=T.money(p.price)+' CAD · 4 sessions';
    passStart.value=p.start;passCalendar?.sync();
    document.querySelector('#pass-end').textContent=T.prettyDate(p.end);renderDates(p.dates);
    if(info){info.querySelector('[data-training-info-date-label]').textContent='Pass starts';info.querySelector('[data-training-info-date]').textContent=T.prettyDate(p.start);info.querySelector('[data-training-info-end-row]').hidden=false;info.querySelector('[data-training-info-end]').textContent=T.prettyDate(p.end);}
    return p;
  }
  if(choice.type==='pass4'){
    document.querySelector('#booking-title').textContent=s.day+' 4-week pass';
    submit.textContent='Register for 4-week pass';
    document.querySelector('.quick-assurance').textContent='We’ll check space for all four dates and email your pass confirmation with payment instructions. Submitting does not reserve a place.';
    passStart.disabled=false;
    passStart.addEventListener('input',()=>passStart.setCustomValidity(''));
    passStart.addEventListener('change',()=>{
      passStartChanged=Boolean(passStart.value);
      try{updatePass();}catch(error){passStart.setCustomValidity(error.message);document.querySelector('#pass-end').textContent='Choose an upcoming '+s.day;datesList.replaceChildren();if(info){info.querySelector('[data-training-info-date]').textContent='Choose a valid start date';info.querySelector('[data-training-info-end]').textContent='—';}passStart.reportValidity();}
    });
    updatePass();passCalendar=window.StarPassCalendar?.(passStart,s);
  }else renderDates([dropinDate]);
  const family=F.mount(form,{minAge:s.minAge,maxAge:s.maxAge,experience:true,onChange:updateTotal});
  function updateTotal(){const count=family.count(),total=document.querySelector('#family-total');total.hidden=count===1;total.textContent='Requested total: '+T.money(choice.price*count)+' CAD'+(count>1?' · '+count+' players × '+T.money(choice.price):' · 1 player');}
  updateTotal();submit.disabled=false;
  form.addEventListener('input',event=>event.target.setCustomValidity?.(''));
  function resultsList(){
    const list=document.createElement('ul');list.className='family-result';
    family.players().forEach(p=>{const li=document.createElement('li');li.textContent=p.name+' — '+({accepted:'request received',rejected:'not accepted by the form service',unconfirmed:'receipt not confirmed',pending:'not sent'}[p.state])+(p.reference?' · '+p.reference:'');list.append(li);});return list;
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    if(!family.validate())return;
    const players=family.players(),displayedPassStart=passStart.value;let requests,pass;
    try{requests=players.map(p=>({...p,request:W.request(s.id,choice.type,{name:p.name,email:form.elements.namedItem('email').value,age:p.age,experience:p.experience})}));pass=updatePass();}
    catch(error){status(error.message,true);return;}
    if(pass&&pass.start!==displayedPassStart){status('The previous pass start has passed. Review the four updated dates above, then register.');return;}
    if(!pass&&T.nextDate(s)!==dropinDate){dropinDate=T.nextDate(s);renderDates([dropinDate]);if(info)info.querySelector('[data-training-info-date]').textContent=T.prettyDate(dropinDate);status('The previous session has started. Review the new date above, then register.');return;}
    if(form.elements.namedItem('_honey').value){status('Unable to send. Please email '+T.catalog.email+'.',true);return;}
    const parentName=form.elements.namedItem('Parent name').value.trim(),referral=T.referralSource(form.elements.namedItem('Referral source').value);
    const familyReference=family.reference(players[0].key);
    const payloads=requests.map(p=>{
      const request=p.request,reference=family.reference(p.key),data=new FormData();
      const fields={'Registration version':request.version,'Client reference':reference,'Session ID':s.id,'Training':s.day+' '+s.time,'Location':T.catalog.locations[s.location].name,'Player name':request.name,'Player age':String(request.age),email:request.email,Experience:request.experience,'Requested option':choice.label,'Expected start date':dropinDate,'Covered dates':dropinDate,'Price CAD':String(choice.price),'Attendance policy':'Upcoming session shown at registration; use attendance buttons in confirmation email','Payment status':'Instructions in confirmation email; no payment collected','Parent name':parentName,Notes:p.notes,'Referral source':referral,_replyto:request.email,_subject:'Star Soccer weekly registration | '+s.day+' | '+reference,_template:'table',_captcha:'false',_honey:''};
      if(players.length>1)Object.assign(fields,{'Family reference':familyReference,'Players in family request':String(players.length),'Family requested total CAD':String(choice.price*players.length)});
      if(pass)Object.assign(fields,{'Start date policy':'Selected at registration; defaults to next eligible session','Pass start choice':passStartChanged?'Selected date':'Upcoming session (default)','Pass start date':pass.start,'Expected start date':pass.start,'Expected end date':pass.end,'Covered dates':pass.dates.join(', '),'Price CAD':String(pass.price),'Attendance policy':'Four requested dates; confirmed by the coaching team',_subject:'Star Soccer pass registration | '+s.day+' | '+reference});
      Object.entries(fields).forEach(([key,value])=>data.set(key,value));window.StarCampaignSource?.append(data);return {player:p,data};
    });
    busy=true;submit.disabled=true;family.lock();const calendarTrigger=document.querySelector('#pass-calendar-trigger');if(calendarTrigger)calendarTrigger.disabled=true;form.setAttribute('aria-busy','true');status('Sending registration'+(players.length>1?'s':'')+'…');
    let failed=false;
    for(const {player,data} of payloads){
      if(player.state==='accepted')continue;
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      try{
        const response=await fetch('https://formsubmit.co/ajax/'+T.catalog.email,{method:'POST',body:data,headers:{Accept:'application/json'},signal:controller.signal});
        let body;try{body=await response.json();}catch{throw new Error('Unconfirmed response');}
        if(!T.accepted(response,body)){
          if(response.ok&&body&&(body.success===false||body.success==='false'))family.setState(player.key,'rejected');
          else family.setState(player.key,'unconfirmed');
          failed=true;break;
        }
        family.setState(player.key,'accepted');window.StarFunnel?.track('submission_accepted',{program:'weekly',kind:choice.type});
      }catch{family.setState(player.key,'unconfirmed');failed=true;break;}
      finally{clearTimeout(timer);}
    }
    form.removeAttribute('aria-busy');busy=false;
    if(!failed){
      form.hidden=true;feedback.hidden=true;passSummary.hidden=true;receipt.hidden=false;receipt.replaceChildren();
      const heading=document.createElement('h2');heading.textContent='Thanks — registration'+(players.length>1?'s':'')+' received';
      const message=document.createElement('p');message.textContent=pass?'Look out for your pass confirmation with all four dates and payment instructions. The coaching team checks space before confirming each player’s place.':'The coaching team will check space and email your confirmation with payment instructions and attendance buttons. Open your choice and press Confirm response to save your answer. Your place is confirmed by the team.';
      const details=document.createElement('p');details.textContent=T.money(choice.price*players.length)+' CAD requested total · '+(pass?'Expected start: '+T.prettyDate(pass.start)+' · Expected end (4th session): '+T.prettyDate(pass.end):T.prettyDate(dropinDate)+' · '+s.time);
      const back=document.createElement('a');back.href='programs.html#sessions';back.className='flow-text-link';back.textContent='Back to weekly training';
      receipt.append(heading,message,details,resultsList(),back);receipt.tabIndex=-1;receipt.focus();document.querySelector('.registration-recovery')?.setAttribute('hidden','');return;
    }
    const canRetry=family.unlock();busy=!canRetry;submit.disabled=!canRetry;if(calendarTrigger)calendarTrigger.disabled=!canRetry;
    status(canRetry?'The form service did not accept this request. Your entries are still here. You can retry or email the team.':'Some requests need checking. Your entries are preserved. Email the team with the references below before sending another request; received players will not be submitted again.',true);
    let recovery=document.querySelector('.registration-recovery');if(!recovery){recovery=document.createElement('div');recovery.className='registration-recovery';feedback.after(recovery);}recovery.hidden=false;recovery.replaceChildren(resultsList());
    const link=document.createElement('a');link.className='flow-text-link';link.textContent='Email to check this registration';
    const references=family.players().filter(p=>p.reference).map(p=>p.reference+' ('+p.state+')').join('; ');
    link.href='mailto:'+T.catalog.email+'?subject='+encodeURIComponent('Check registration | '+familyReference)+'&body='+encodeURIComponent('Please check registration '+references+' for '+s.day+' training. The website attempt was not confirmed for every player.');recovery.append(link);
  });
})();
