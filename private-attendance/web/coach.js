(()=>{'use strict';const el=id=>document.getElementById(id);let selected='';
 const text=(tag,value)=>{const e=document.createElement(tag);e.textContent=String(value??'');return e;};
 const when=value=>value?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}).format(new Date(value)):'—';
 async function load(){try{el('error').hidden=true;const r=await fetch('/api/dashboard');if(!r.ok)throw new Error('Unable to read preparation records.');const d=await r.json();
  const sessions=Array.isArray(d)?d:(d.sessions||[]);el('session-choice').replaceChildren(...sessions.map(s=>{const o=text('option',(s.sessionLabel||s.label||s.id)+' · '+when(s.startAt));o.value=s.sessionId||s.id;return o;}));
  const s=sessions.find(s=>(s.sessionId||s.id)===selected)||sessions[0];if(!s){el('session-details').textContent='No approved sessions in this preview.';return;}selected=s.sessionId||s.id;el('session-choice').value=selected;
  el('session-details').textContent=(s.sessionLabel||s.label||'Training')+' · '+when(s.startAt)+' · '+(s.location||'');
  const roster=s.roster||s.players||[],counts=s.counts||s.summary||{};
  const yes=counts.attending??counts.yes??roster.filter(p=>(p.response||p.currentResponse)==='yes').length;
  const no=counts.unavailable??counts.no??roster.filter(p=>(p.response||p.currentResponse)==='no').length;
  const confirmed=counts.registrationConfirmed??counts.confirmedByRegistration??roster.filter(p=>['pass','pass4','camp'].includes(p.kind||p.bookingType)).length;
  const awaiting=counts.awaiting??counts.awaitingResponse??Math.max(0,roster.length-yes-no-confirmed);
  el('totals').replaceChildren(...[['Attending',yes],['Unavailable',no],['Awaiting response',awaiting],['Confirmed by registration',confirmed]].map(([label,n])=>{const card=document.createElement('div');card.className='stat';card.append(text('span',label),text('strong',n));return card;}));
  const reserved=s.capacityUsed??s.reservedCount??s.registered??s.rosterCount??roster.length,capacity=s.capacity??20;el('capacity').textContent=reserved+' / '+capacity+' registered places · Responses do not release or create bookings.';el('capacity').classList.toggle('error',reserved>capacity||s.capacityBlocked===true||s.blocked===true);
  el('roster').replaceChildren(...roster.map(p=>{const row=document.createElement('tr'),response=p.response||p.currentResponse,kind=p.kind||p.bookingType,registration=['pass','pass4','camp'].includes(kind);const badge=text('span',registration?'Confirmed by registration':response==='yes'?'Attending':response==='no'?'Can’t make it':'Awaiting response');badge.className='badge '+(registration||response==='yes'?'yes':response==='no'?'no':'');const cell=document.createElement('td');cell.append(badge);const physical=p.physicalAttendance||p.actualAttendance;row.append(text('td',p.playerName||p.name),text('td',({dropin:'Weekly drop-in',pass:'Four-session pass',pass4:'Four-session pass',camp:'Camp'})[kind]||'Drop-in'),cell,text('td',when(p.updatedAt)),text('td',!physical||physical==='not-marked'?'Not marked':physical));return row;}));
 }catch(e){el('error').hidden=false;el('error').textContent=e.message;}}
 el('session-choice').addEventListener('change',()=>{selected=el('session-choice').value;load();});el('refresh').addEventListener('click',load);load();})();
