/* Opening or previewing a link never records attendance. */
(()=>{'use strict';
 let token=null,action='rsvp',answer=null,csrfToken='',preview=null,saving=false,submissionKey=null,selectionVersion=0,flowVersion=0;
 const el=id=>document.getElementById(id),buttons=[el('yes'),el('no')];
 const hideCalendar=()=>{el('calendar-actions').hidden=true;el('add-google-calendar').removeAttribute('href');};
 function showCalendar(session){
  const start=new Date(session.startAt),end=new Date(session.endAt);
  if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<=start)return;
  const stamp=value=>value.toISOString().replace(/[-:]|\.\d{3}/g,''),zone=value=>value>=new Date('2026-03-09T00:00:00Z')?'Etc/GMT+7':'America/Vancouver';
  const url=new URL('https://calendar.google.com/calendar/r/eventedit');
  // Only session logistics leave this page, and only when the parent chooses the link.
  url.search=new URLSearchParams({action:'TEMPLATE',text:'Star Soccer training',dates:stamp(start)+'/'+stamp(end),stz:zone(start),etz:zone(end),location:session.location||'',details:'Soccer training with Star Soccer.\nQuestions? starsoccervancouver@gmail.com'}).toString();
  el('add-google-calendar').href=url.href;el('calendar-actions').hidden=false;
 }
 const date=value=>new Intl.DateTimeFormat('en-CA',{timeZone:new Date(value)>=new Date('2026-03-09T00:00:00Z')?'Etc/GMT+7':'America/Vancouver',weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value));
 const showError=(message,retry=false)=>{el('loading').hidden=true;el('error').hidden=false;el('error').textContent=message;el('retry').hidden=!retry;el('error').focus();};
 async function api(path,data){const r=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:JSON.stringify(data)}),value=await r.json();if(!r.ok){const e=new Error(value.message||'Please try again or contact the coaching team.');e.code=value.error;throw e;}return value;}
 async function select(value){
  if(answer!==value)submissionKey=null;answer=value;const ticket=++selectionVersion,flow=flowVersion;
  buttons.forEach(button=>{const chosen=button.id===answer;button.classList.toggle('selected',chosen);button.setAttribute('aria-pressed',String(chosen));});
  el('confirm').disabled=true;if(!preview||!['yes','no'].includes(answer))return;
  if(preview.answer!==answer){try{const fresh=await api('/api/preview',{token,answer,action});if(ticket!==selectionVersion||flow!==flowVersion)return;preview=fresh;el('error').hidden=true;el('retry').hidden=true;el('current').textContent=fresh.currentResponse==='yes'?'Current response: attending.':fresh.currentResponse==='no'?'Current response: can’t make it.':'No response recorded yet.';}catch(e){if(ticket===selectionVersion&&flow===flowVersion)showError(e.message,true);return;}}
  if(ticket===selectionVersion&&!saving)el('confirm').disabled=false;
 }
 async function load(){
  const flow=++flowVersion;hideCalendar();el('error').hidden=true;el('retry').hidden=true;el('loading').hidden=false;el('details').hidden=true;el('change').hidden=true;preview=null;submissionKey=null;selectionVersion++;
  try{
   const b=await fetch('/api/bootstrap',{credentials:'same-origin'});if(!b.ok)throw new Error('Unable to open your attendance link.');const bootstrap=await b.json();if(flow!==flowVersion)return;csrfToken=bootstrap.csrfToken;
   const fresh=await api('/api/preview',{token,answer:action==='rsvp'?(['yes','no'].includes(answer)?answer:'yes'):undefined,action});if(flow!==flowVersion)return;preview=fresh;
   el('loading').hidden=true;el('details').hidden=false;
   el('greeting').textContent=preview.guardianName?'Hi '+preview.guardianName+',':'Hello '+preview.playerName+'’s family,';
   el('player').textContent=preview.playerName;el('session').textContent=preview.sessionLabel;el('when').textContent=date(preview.startAt)+' – '+new Intl.DateTimeFormat('en-CA',{timeZone:new Date(preview.endAt)>=new Date('2026-03-09T00:00:00Z')?'Etc/GMT+7':'America/Vancouver',hour:'numeric',minute:'2-digit'}).format(new Date(preview.endAt))+' (Vancouver)';el('location').textContent=preview.location;
   const current=preview.currentResponse;el('current').textContent=current==='yes'?'Current response: attending.':current==='no'?'Current response: can’t make it.':'No response recorded yet.';
   el('response-options').hidden=action==='optout';el('optout-info').hidden=action!=='optout';el('confirm').hidden=false;el('success').hidden=true;el('change').hidden=true;
   if(action==='optout'){el('title').textContent='Weekly email preferences';el('confirm').textContent='Stop weekly attendance emails';el('confirm').disabled=false;}
   else select(['yes','no'].includes(answer)?answer:current);
  }catch(e){if(flow===flowVersion){showError(e.message,true);el('details').hidden=true;}}
 }
 buttons.forEach(button=>button.addEventListener('click',()=>select(button.id)));
 el('confirm').addEventListener('click',async()=>{
  if(saving||!preview)return;const flow=flowVersion;hideCalendar();saving=true;el('confirm').disabled=true;el('error').hidden=true;
  try{
   const key=submissionKey||(submissionKey=crypto.randomUUID()),result=action==='optout'?await api('/api/optout',{token,challenge:preview.challenge,idempotencyKey:key}):await api('/api/respond',{token,answer,challenge:preview.challenge,expectedVersion:preview.version,idempotencyKey:key});
   if(flow!==flowVersion)return;el('success').textContent=action==='optout'?'Your preference is saved. Recurring weekly attendance emails are stopped. Existing bookings stay unchanged.':result.superseded?'A newer response is already saved. The current response is '+(result.response==='yes'?'attending.':'can’t make it.')+' You can review it before making another change.':result.response==='yes'?'Thank you — your player’s attendance response is saved. We’ll see you on the field!':'Thank you for letting us know. Your player’s unavailable response is saved.';
   el('success').hidden=false;el('success').focus();el('confirm').hidden=true;el('response-options').hidden=true;el('change').hidden=action==='optout';
   if(action==='rsvp')el('current').textContent=result.response==='yes'?'Current response: attending.':'Current response: can’t make it.';
   if(action==='rsvp'&&result.response==='yes'&&!result.superseded)showCalendar(preview);
  }catch(e){if(flow!==flowVersion)return;const code=String(e.code).toUpperCase();showError(e.message,code==='CSRF_FAILED');if(code==='CSRF_FAILED'){preview=null;el('confirm').hidden=true;}else if(['VERSION_CONFLICT','STALE_VERSION','RESPONSE_CHANGED','INVALID_CONFIRMATION'].includes(code)){preview=null;el('change').hidden=false;el('change').textContent='Review latest response';el('confirm').hidden=true;}else el('confirm').disabled=false;}
  finally{if(flow===flowVersion)saving=false;}
 });
 el('change').addEventListener('click',()=>load());
 el('retry').addEventListener('click',()=>load());
 function openLink(){const fragment=new URLSearchParams(location.hash.slice(1));token=fragment.get('token');action=fragment.get('action')==='optout'?'optout':'rsvp';answer=fragment.get('answer');history.replaceState(null,'',location.pathname);flowVersion++;selectionVersion++;preview=null;submissionKey=null;saving=false;hideCalendar();el('details').hidden=true;el('success').hidden=true;el('error').hidden=true;el('loading').hidden=false;el('title').textContent='Confirm attendance';el('confirm').textContent='Confirm response';if(!token){showError('This attendance link is incomplete. Please open the full link from your email.');return;}load();}
 window.addEventListener('hashchange',openLink);openLink();
})();
