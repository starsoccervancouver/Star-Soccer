import {sessionTimes,vancouverInstant} from './airtable-roster.mjs';
import reviewedPrograms from './weekly-programs.json' with {type:'json'};
import {assignmentConflict} from './schedule-conflicts.mjs';
const tables={"Families":"tbldgg7nkOSbisXTA","Dated Attendance (internal)":"tblcJQZMT2JKEUS2B","Bookings":"tblVsKHnBZMlxYavr","Payments":"tblF3FEKz8Bza5CEJ","Website Registrations":"tblxyNOfuxDnUoTtP","Staff":"tblqTiyXVvlsuPh2F"};
const single=a=>a?.length===1?a[0]:null;
const record=(t,id)=>'https://airtable.com/appnaG94HQpEaRios/'+tables[t]+(id?'/'+id:'');
const day=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
const money=n=>new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(n);
const eligible=b=>b&&['Accepted','Completed'].includes(b['Booking status']);
export const fields={
draftLog:['Email key','Email kind','Status','Review detail','Source record'],
registrations:['Reference','Received at','Source Gmail ID','Status','Family','Player','Booking','Next session date','Visit ID','utm_source','Player history at registration','Confirmation Gmail ID'],
bookings:['Booking status','Booking type','Family','Player','Start date','Agreed booked CAD','Due now CAD','Upcoming booked CAD','Charge review','Charge CAD','Attendance-adjusted charge CAD','Balance CAD'],
payments:['Method','Family','Verification','Direction','Source payment ID','Evidence reference','Payment reference','Amount CAD','Training portion CAD','Thank-you gift CAD'],
allocations:['Payment','Booking','Review status','Applied CAD'],
intake:['Message ID','Review','Candidate amount CAD'],
sessions:['Session','Source session ID','Date','Time','Venue','Coach','Calendar series ID','Session status','Expected headcount (owner reported)'],
attendance:['Player','Booking','Session','Session date','Attendance status','Coverage state'],
staff:['Name','Hourly rate CAD'],expenses:['Expense ID','Supplier','Category','Expense status','Amount CAD','Notes','Date'],
attribution:['Registration reference','Visit ID','utm_source']};
export function ownerWorkflows(data,{now,notices,desk,calendar,calendarReason,draftStates=[],draftError}){
 const lines=[],items=[],line=(group,text)=>lines.push({group,text}),item=(group,title,action,link)=>items.push({group,title,action,link});
 for(const s of reviewedPrograms.sessions)line('Weekly programs',s.program+' · '+s.time+' · '+s.venue+' · '+s.capacity+' places · '+money(s.dropin)+' drop-in');
 const by=n=>new Map(data[n].map(r=>[r.id,r.fields]));
 const conflicts=new Set();
 for(const session of data.sessions.filter(r=>r.fields.Date>=day(now)&&r.fields.Date<=day(now+7*86400000))){
  const other=assignmentConflict(session,data.sessions);
  const pair=[session.id,other].sort().join('/');
  if(other&&!conflicts.has(pair)){
   conflicts.add(pair);item('Coaching team',session.fields.Date+' · overlapping coach assignments','Check the two dated sessions and confirm coach coverage.',record('Dated Attendance (internal)',session.id));
  }
 }
 const books=by('bookings'),payments=by('payments'),sessions=by('sessions'),intake=new Map(data.intake.map(r=>[r.fields['Message ID'],r.fields]));
 const active=data.attendance.filter(r=>r.fields['Coverage state']==='Active'),paid=new Map(),applied=new Map(),unknown=new Set();
 for(const {fields:a} of data.allocations){
  const pid=single(a.Payment),bid=single(a.Booking),p=payments.get(pid),b=books.get(bid);
  if(!p||!b||p.Verification!=='Verified'||p.Direction!=='Incoming'||a['Review status']!=='Verified allocation')continue;
  if(!['E-transfer','Cash'].includes(p.Method)||!single(p.Family)||single(p.Family)!==single(b.Family)||!Number.isFinite(a['Applied CAD'])){unknown.add(bid);continue;}
  applied.set(pid,(applied.get(pid)||0)+a['Applied CAD']);paid.set(bid,(paid.get(bid)||0)+a['Applied CAD']);
 }
 for(const {id,fields:r} of data.registrations){if(r.Status==='Declined')continue;const bid=single(r.Booking),b=books.get(bid);
  if(!eligible(b)||!single(r.Player)||single(r.Player)!==single(b.Player)||!single(r.Family)||single(r.Family)!==single(b.Family)||!active.some(a=>single(a.fields.Booking)===bid&&single(a.fields.Player)===single(r.Player)&&a.fields['Session date']&&sessions.get(single(a.fields.Session))?.Date===a.fields['Session date']))
   item('Registrations',r['Next session date']||'Registration needs placement','Match this player to the requested dated session.',record('Website Registrations',id));
 }
 for(const v of draftStates)if(['creating','review'].includes(v.status)&&data.registrations.some(r=>r.id===v.id&&!r.fields['Confirmation Gmail ID']&&r.fields.Status!=='Declined'))item('Registrations','Confirmation draft needs review',v.reason,record('Website Registrations',v.id));
 for(const r of data.draftLog||[]){const f=r.fields;if(!f['Email key']?.startsWith('Test:')&&(['Review','Creating','Obsolete'].includes(f.Status)||f.Status==='Draft'&&f['Review detail']?.startsWith('Amount-only'))){
  const group=f['Email kind']==='Receipt'?'Payments':'Registrations';
  item(group,(f['Email kind']||'Email')+' draft · '+f.Status,f['Review detail'],'https://airtable.com/appnaG94HQpEaRios/tblptlE64qfzG2i01/'+r.id);
 }}
 if(draftError)item('Registrations','Draft check unavailable',draftError,record('Website Registrations'));
 if(notices===null)item('Payments','Deposited mail unavailable','Check the club Gmail connection.','https://starsoccer.ca/coachdesk#view=settings');
 else for(const id of new Set(notices)){const r=intake.get(id);if(['Ignore','Duplicate','Matched'].includes(r?.Review))continue;
  const hits=data.payments.filter(({fields:p})=>['Source payment ID','Evidence reference','Payment reference'].some(k=>String(p[k]||'').toLowerCase().split(/[^a-z0-9]+/).includes(id)));
  if(hits.length!==1)item('Payments','Deposit needs an exact receipt link'+(Number.isFinite(r?.['Candidate amount CAD'])?' · '+money(r['Candidate amount CAD']):''),'Check the transfer reference against Payments and link the original Gmail message.','https://mail.google.com/mail/u/?authuser=starsoccervancouver%40gmail.com#all/'+id);
 }
 let unallocated=0;
 for(const [id,p] of payments){if(p.Verification!=='Verified'||p.Direction!=='Incoming')continue;
  if(!['E-transfer','Cash'].includes(p.Method)){item('Payments','Payment method unknown','Confirm the payment method against its receipt.',record('Payments',id));continue;}
  const amount=p['Training portion CAD']??(Number.isFinite(p['Amount CAD'])?p['Amount CAD']-(p['Thank-you gift CAD']??0):null);
  const left=amount===null?null:amount-(applied.get(id)||0);
  if(left!==0){if(left>0)unallocated+=left;item('Payments',left===null?'Unknown receipt amount':money(left)+' remaining on receipt','Review the allocation across bookings. Keep confirmed historical receipts intact.',record('Payments',id));}
 }
 let due=0,future=0,futureOwed=0,unknownFuture=0,unpriced=0;
 for(const [id,b] of books){if(!eligible(b))continue;
  if(b['Charge review']!=='Agreed'||!Number.isFinite(b['Due now CAD'])||!Number.isFinite(b['Upcoming booked CAD'])){unpriced++;item('Payments','Booking price or due date unresolved','Verify the agreed fee and dates.',record('Bookings',id));continue;}
  due+=b['Due now CAD'];future+=b['Upcoming booked CAD'];
  if(b['Upcoming booked CAD']>0){
   if(Number.isFinite(b['Balance CAD']))futureOwed+=Math.max(0,Math.min(b['Upcoming booked CAD'],b['Balance CAD']-b['Due now CAD']));
   else {unknownFuture++;item('Payments','Upcoming balance unknown','Check the balance on this upcoming booking.',record('Bookings',id));}
  }
  if(b['Due now CAD']>0)item('Payments',money(b['Due now CAD'])+' due now','Review booking and receipt allocations.',record('Bookings',id));
 }
 line('Payments',money(due)+' due now · '+money(futureOwed)+' outstanding on upcoming bookings'+(unknownFuture?' ('+unknownFuture+' balances unknown)':'')+' · '+money(future)+' upcoming booked · '+money(unallocated)+' unallocated · '+unpriced+' incomplete bookings');
 const winter=new Map(['christmas','boxing'].map(w=>[w,{am:new Set(),pm:new Set(),players:new Set()}])),winterBooks=new Set();
 for(const {fields:a} of active){const s=sessions.get(single(a.Session)),bid=single(a.Booking),b=books.get(bid),pid=single(a.Player);
  const m=/^winter-(christmas|boxing)-(am|pm):/.exec(s?.['Source session ID']||'');
  if(!m||!eligible(b)||!pid||single(b.Player)!==pid||s['Session status']==='Cancelled')continue;
  const w=winter.get(m[1]);w[m[2]].add(bid);w.players.add(pid);winterBooks.add(bid);
 }
 for(const [name,w] of winter)line('Winter camp',(name==='christmas'?'Christmas':'Boxing')+' week · '+w.am.size+' morning bookings · '+w.pm.size+' afternoon bookings · '+w.players.size+'/20 unique players');
 let booked=0,collected=0,unpricedCamp=0;
 for(const id of winterBooks){const b=books.get(id);if(b['Charge review']==='Agreed'&&Number.isFinite(b['Agreed booked CAD']))booked+=b['Agreed booked CAD'];else unpricedCamp++;collected+=paid.get(id)||0;}
 line('Winter camp',money(booked)+' booked · '+money(collected)+' collected and allocated · '+money(7000)+' total target'+(unpricedCamp?' · '+unpricedCamp+' unpriced':''));
 sessionReport({sessions,active,books,desk,calendar,calendarReason,now,line,item});
 coachPay(data,now,line,item);
 attributionReport({data,books,paid,unknown,line,item});
 return {lines,items};
}
function sessionReport({sessions,active,books,desk,calendar,calendarReason,now,line,item}){
 const ownerSessions=new Map((desk?.sessions||[]).map(s=>[s.sessionId,s]));
 if(!desk)item('Sessions','Coach Desk read unavailable','Open the owner read-only connection.','https://starsoccer.ca/coachdesk/operations-preview');
 if(!calendar)item('Sessions','Club Calendar comparison unavailable',calendarReason||'Enable read-only Calendar access in Coach Desk Settings.','https://starsoccer.ca/coachdesk#view=settings');
 for(const [id,s] of sessions){
  if(!s.Date||s.Date<day(now-13*86400000)||s.Date>day(now+6*86400000)||s['Session status']==='Cancelled')continue;
  const link=record('Dated Attendance (internal)',id),rows=active.filter(r=>single(r.fields.Session)===id),o=ownerSessions.get(id);
  let past=s.Date<day(now),start,end;
  try{const times=sessionTimes(s.Time);start=vancouverInstant(s.Date,times[0]);end=vancouverInstant(s.Date,times[1]);past=Date.parse(end)<=now;}
  catch{item('Sessions',s.Date+' · session time unresolved','Confirm the start and end times.',link);}
  if(!past&&(!s.Coach||/pending|assign|tbd/i.test(s.Coach)))item('Sessions',s.Date+' · missing coach','Assign a coach before the session.',link);
  if(desk&&(!o||o.players.length!==rows.length||rows.some(r=>!o.players.some(p=>p.attendanceId===r.id&&p.playerId===single(r.fields.Player)))||Number.isFinite(s['Expected headcount (owner reported)'])&&s['Expected headcount (owner reported)']!==rows.length))
   item('Sessions',s.Date+' · roster discrepancy','Compare active attendance and player IDs against Coach Desk.',link);
  if(calendar&&!past){const matches=calendar.filter(e=>{if(e.status==='cancelled'||Date.parse(e.start?.dateTime)!==Date.parse(start))return false;
    if(s['Calendar series ID'])return [e.id,e.recurringEventId,e.iCalUID].includes(s['Calendar series ID']);
    return Date.parse(e.end?.dateTime)===Date.parse(end)&&s.Venue&&String(e.location||'').toLowerCase().includes(s.Venue.toLowerCase())&&/star soccer/i.test(e.summary||'');});
   if(matches.length!==1)item('Sessions',s.Date+' · Calendar match missing or ambiguous','Confirm the calendar event and save its series ID.',link);}
  if(past&&o){let present=0,absent=0,unmarked=0;for(const p of o.players){
   const a=rows.find(r=>r.id===p.attendanceId),b=books.get(single(a?.fields.Booking));
   if(p.attendance==='Present')present++;else if(p.attendance==='Absent'&&/pass|four consecutive/i.test(b?.['Booking type']||''))absent++;else if(!p.attendance||p.attendance==='Not marked')unmarked++;
  }line('Sessions',s.Date+' · '+s.Time+' · '+present+' present · '+absent+' pass-holder absences'+(unmarked?' · '+unmarked+' unmarked':''));
  if(unmarked)item('Sessions',s.Date+' · incomplete attendance','Review the unmarked attendance entries.',link);}
 }

}
function coachPay(data,now,line,item){
 const rate=new Map(data.staff.map(r=>[r.fields.Name,r.fields['Hourly rate CAD']]));
 const base='https://airtable.com/appnaG94HQpEaRios/tblInRQfLnLEMVCpj/';
 const covered=new Set();
 for(const {id,fields:e} of data.expenses){if(e.Category!=='Coaching'||!e.Supplier)continue;
   const sessions=[...new Set((e.Notes||'').match(/rec[A-Za-z0-9]{14}/g)||[])].filter(i=>data.sessions.some(s=>s.id===i));
   if(sessions.length===1)covered.add(sessions[0]+'|'+e.Supplier);
   if(['Paid','Cancelled','Void'].includes(e['Expense status']))continue;
   if(/\bunpaid\b/i.test(e.Notes||'')&&Number.isFinite(e['Amount CAD'])){line('Coach pay',e.Supplier+' · '+money(e['Amount CAD'])+' recorded unpaid · '+e.Date);item('Coach pay',e.Supplier+' · '+money(e['Amount CAD']),'Review the existing unpaid coaching expense.',base+id);}
   else item('Coach pay',e.Supplier+' · payment status to verify','Check the expense and its payment evidence.',base+id);
 }
 for(const {id,fields:s} of data.sessions){
  if(s.Date<day(now-13*86400000)||s.Date>day(now)||s['Session status']==='Cancelled'||!s.Coach)continue;
  let hours;try{const [a,b]=sessionTimes(s.Time).map(t=>Date.parse(vancouverInstant(s.Date,t)));if(b>now)continue;hours=(b-a)/3600000;}catch{continue;}
  for(const name of s.Coach.split(';').map(x=>x.trim())){
   if(covered.has(id+'|'+name)||/pending|assign/i.test(name))continue;
   const hr=rate.get(name);
   item('Coach pay',s.Date+' · '+name,Number.isFinite(hr)?'Confirm hours worked and prior payments. Scheduled gross '+money(hours*hr)+'.':'Verify the coach rate, hours and previous payments.',record('Dated Attendance (internal)',id));
  }
 }
}
function attributionReport({data,books,paid,unknown,line,item}){
 const cohorts=new Map(),seen=new Set();
 for(const {id:registrationId,fields:r} of data.registrations){
  const bid=single(r.Booking),b=books.get(bid);
  if(r.Status==='Declined'||!eligible(b)||!single(r.Family)||single(r.Family)!==single(b.Family)||!single(r.Player)||single(r.Player)!==single(b.Player)||unknown.has(bid)||seen.has(bid)||b['Charge review']!=='Agreed'||!(paid.get(bid)>0)||b['Balance CAD']!==0)continue;
  seen.add(bid);
  const matches=data.attribution.filter(a=>r['Visit ID']&&a.fields['Visit ID']===r['Visit ID']&&a.fields['Registration reference']===r.Reference);
  const sources=new Set([r.utm_source,...matches.map(a=>a.fields.utm_source)].filter(Boolean)),source=sources.size===1?[...sources][0]:'Unknown source';
  const prior=[...books.entries()].some(([id,x])=>id!==bid&&eligible(x)&&single(x.Family)===single(r.Family)&&x['Start date']&&x['Start date']<(r['Received at']||'').slice(0,10));
  const previous=[...books.entries()].filter(([id,x])=>id!==bid&&eligible(x)&&single(x.Family)===single(b.Family));
  const date=r['Received at']?.slice(0,10);const first=r['Player history at registration']==='First-time verified'&&date&&previous.every(([,x])=>x['Start date']&&x['Start date']>=date);
  const history=prior||/returning/i.test(r['Player history at registration']||'')?'Returning family':first?'New family (first recorded booking)':'Unknown family history';
  if(source==='Unknown source'||history==='Unknown family history')item('Attribution','Paid registration · '+source,'Check the original visit tags and prior family bookings. Keep any unsupported source or history unknown.',record('Website Registrations',registrationId));
  const key=source+' · '+history;cohorts.set(key,(cohorts.get(key)||0)+1);
 }
 line('Attribution',seen.size+' fully paid registrations with verified Interac or cash allocations');
 for(const [k,v] of cohorts)line('Attribution',k+' · '+v);
}
