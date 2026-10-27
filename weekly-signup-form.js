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
  document.querySelector('#booking-title').textContent=s.day+' training';
  document.querySelector('#booking-session').textContent=s.time+' · '+T.catalog.locations[s.location].name;
  document.querySelector('#booking-ages').textContent='Ages '+s.minAge+'–'+s.maxAge;
  const age=form.elements.namedItem('Player age');age.min=s.minAge;age.max=s.maxAge;
  document.querySelector('#age-help').textContent='Ages '+s.minAge+'–'+s.maxAge+'.';
  submit.disabled=false;
  form.addEventListener('input',event=>event.target.setCustomValidity?.(''));
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busy)return;
    form.elements.namedItem('Player name').setCustomValidity(form.elements.namedItem('Player name').value.trim()?'':'Enter the child’s name.');
    if(!form.reportValidity())return;
    let request;
    try{request=W.request(s.id,choice.type,{name:form.elements.namedItem('Player name').value,email:form.elements.namedItem('email').value,age:age.value,experience:form.elements.namedItem('Experience').value});}
    catch(error){status(error.message,true);return;}
    if(form.elements.namedItem('_honey').value){status('Unable to send. Please email '+T.catalog.email+'.',true);return;}
    if(!reference)reference='SS-'+(crypto.randomUUID?crypto.randomUUID().toUpperCase():Date.now().toString(36).toUpperCase());
    const data=new FormData();
    const fields={'Registration version':request.version,'Client reference':reference,'Session ID':s.id,'Training':s.day+' '+s.time,'Location':T.catalog.locations[s.location].name,'Player name':request.name,'Player age':String(request.age),email:request.email,Experience:request.experience,'Requested option':choice.label,'Attendance policy':'Expect next session unless parent declines; no dated choice submitted','Payment status':'Follow up later; no payment collected',_replyto:request.email,_subject:'Star Soccer weekly registration | '+s.day+' | '+reference,_template:'table',_captcha:'false',_honey:''};
    Object.entries(fields).forEach(([key,value])=>data.set(key,value));
    busy=true;submit.disabled=true;form.setAttribute('aria-busy','true');status('Registering…');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('https://formsubmit.co/ajax/'+T.catalog.email,{method:'POST',body:data,headers:{Accept:'application/json'},signal:controller.signal});
      let body;try{body=await response.json();}catch{throw new Error('We couldn’t verify your registration.');}
      if(!T.accepted(response,body))throw new Error('Your registration wasn’t accepted.');
      form.hidden=true;feedback.hidden=true;receipt.hidden=false;receipt.replaceChildren();
      const heading=document.createElement('h2');heading.textContent='Thanks — registration received';
      const message=document.createElement('p');message.textContent='Look out for your registration email and next-session attendance question. Romeo will follow up about payment. If the group is full, we’ll email you about the waitlist.';
      const ref=document.createElement('p');ref.textContent='Your reference: '+reference;
      const back=document.createElement('a');back.href='programs.html#sessions';back.className='flow-text-link';back.textContent='Back to weekly training';
      receipt.append(heading,message,ref,back);receipt.tabIndex=-1;receipt.focus();
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
