/* Private worker helpers. Never included in the public Pages artifact. */
const crypto=require('node:crypto');
const T=require('../training.js');
const W=require('../weekly-signup.js');
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function names(players){
  if(!Array.isArray(players)||!players.length||players.length>20)throw new Error('Choose the confirmed children in one family.');
  const list=players.map(p=>String(p).trim());
  if(list.some(p=>!p||p.length>100||/[\x00-\x1f]/.test(p))||new Set(list.map(p=>p.normalize('NFC').toLowerCase())).size!==list.length)throw new Error('Player names must be clear and unique within the family.');
  return list;
}
function greeting(players,parentName=null){
  if(parentName!==null&&typeof parentName!=='string')throw new Error('Use a verified guardian name.');
  const parent=parentName===null?null:String(parentName).trim();
  if(parent&& (parent.length>100||/[\x00-\x1f]/.test(parent)))throw new Error('Use a verified guardian name.');
  return 'Hi '+(parent||new Intl.ListFormat('en-CA',{style:'long',type:'conjunction'}).format(names(players))+'’s family')+',';
}
function personalized(message,playerName,parentName=null,updated=false){
  const intro=greeting([playerName],parentName)+'\n\n'+(updated?'Here are the updated pass details for '+playerName+'.':'Thank you for registering '+playerName+'!');
  return {...message,body:message.body.replace(/^[^\n]*/,intro)};
}
function reference(value){
  if(typeof value!=='string'||!/^(?:SS-RSVP-[A-F0-9]{20}|RSVP-[A-Z0-9-]{6,64}|SS-[A-Z0-9-]{6,40})$/.test(value))throw new Error('Invalid email reference.');
  return value;
}
function reminderKey(familyId,sessionId,date){
  if(!/^rec[A-Za-z0-9]{14}$/.test(familyId)||!T.getSession(sessionId)||!T.isoDate(date))throw new Error('Invalid reminder identity.');
  return 'SS-RSVP-'+crypto.createHash('sha256').update([familyId,sessionId,date].join('|')).digest('hex').slice(0,20).toUpperCase();
}
function approvedCalendarUrl(value){
  if(value===null||value===undefined)return null;
  const u=new URL(value);
  if(u.protocol!=='https:'||!['calendar.google.com','www.google.com'].includes(u.hostname)||!u.pathname.startsWith('/calendar/')||u.username||u.password||!u.searchParams.get('eid'))throw new Error('Use the actual private Google Calendar event link returned by Calendar.');
  return u.href;
}
function render(message,{title,theme='autumn',calendarUrl=null,kicker='Registration confirmed',visuals=false,followUp=null}={}){
  calendarUrl=approvedCalendarUrl(calendarUrl);
  const accent=theme==='winter'?'#b7e4f3':'#edbf91';
  let body=message.body;
  if(followUp)body+='\n\nAttendance invitation:\n'+followUp;
  if(calendarUrl&&body.includes('Attendance:\n'))body=body.replace(/(Attendance:[\s\S]*?)(?=\n\n|$)/,'$1\nOpen your invitation: '+calendarUrl);
  const blocks=body.split('\n\n').map(part=>{
    const lines=part.split('\n').filter(line=>line!=='Star Soccer'&&line!==T.catalog.email&&!line.startsWith('Reference: ')&&!line.startsWith('Open your invitation: '));
    if(!lines.length||part.startsWith('Attendance invitation:'))return '';
    if(/^(Next session:|Your pass:|Your camp:|Payment received:)/.test(part))return '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px;background:#eef3f7;border-left:3px solid '+accent+'"><tr><td style="padding:16px 18px;font-size:16px;line-height:1.65;color:#18344e"><strong>'+lines.slice(1).map(escape).join('<br>')+'</strong></td></tr></table>';
    if(part.startsWith('Attendance:')){
      const button=calendarUrl?'<a href="'+escape(calendarUrl)+'" style="display:block;padding:14px 16px;background:#173d62;color:#fff;text-decoration:none;text-align:center;font-size:16px;font-weight:700;border-radius:8px">RSVP in Google Calendar</a>':'<span style="display:block;padding:14px 16px;background:#e8eef4;color:#284962;text-align:center;font-size:16px;font-weight:700;border-radius:8px">RSVP in your Calendar invitation</span>';
      return '<h2 style="margin:0 0 8px;font-size:18px;color:#17344e">Coming to training?</h2><p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#344b61">'+lines.slice(1).map(escape).join('<br>')+'</p>'+button+'<p style="margin:8px 0 20px;font-size:12px;line-height:1.5;color:#607286">Choose Yes, No or Maybe in the Google Calendar invitation.</p>';
    }
    return '<p style="margin:0 0 18px;font-size:15px;line-height:1.65;color:#344b61">'+lines.map(escape).join('<br>')+'</p>';
  }).join('');
  const brand=visuals?'<img src="https://starsoccer.ca/email-star-soccer-logo.png?v=20261027-galactic" width="250" height="85" alt="Star Soccer Vancouver" style="display:block;max-width:100%;height:auto;border:0;margin:0 0 14px">':'<p style="margin:0 0 5px;font-size:21px;letter-spacing:2px;font-weight:800;color:'+accent+'">STAR SOCCER</p>';
  const banner=visuals?'<tr><td><img src="https://starsoccer.ca/email-'+theme+'-field.jpg" width="600" height="180" alt="'+(theme==='winter'?'A goal on a snowy soccer field':'A soccer goal and fallen autumn leaves')+'" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>':'';
  const next=followUp?'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:6px 0 22px;background:#eef3f7;border-left:3px solid '+accent+'"><tr><td style="padding:16px 18px;font-size:15px;line-height:1.6;color:#18344e"><strong>Your attendance invitation is coming</strong><br>'+escape(followUp)+'</td></tr></table>':'';
  return {...message,body,html:`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(message.subject)}</title></head><body style="margin:0;background:#eaf0f5;font-family:Arial,sans-serif;overflow-wrap:anywhere;word-break:break-word"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border-radius:14px;overflow:hidden"><tr><td style="padding:24px;background:#08111f;border-top:5px solid ${accent}">${brand}<p style="margin:0 0 20px;font-size:11px;letter-spacing:1.5px;color:#adc2d3">VANCOUVER · ${theme==='winter'?'WINTER CAMPS':'WEEKLY TRAINING'}</p><p style="margin:0 0 7px;font-size:12px;font-weight:700;color:${accent}">${escape(kicker)}</p><h1 style="margin:0;font-size:27px;line-height:1.25;color:#fff">${escape(title)}</h1></td></tr>${banner}<tr><td style="padding:24px">${blocks}${next}<p style="border-top:1px solid #d7e2eb;padding-top:16px;margin:2px 0 0;font-size:12px;line-height:1.6;color:#607286">Star Soccer Vancouver<br><a href="mailto:${T.catalog.email}" style="color:#214f78">${T.catalog.email}</a><br>Reference: ${escape(message.reference)}</p></td></tr></table></td></tr></table></body></html>`};
}
// Legacy historical Calendar recovery only. New check-ins use weeklyAttendanceDraft.
function attendanceInquiry(sessionId,date,players,ref,calendarUrl=null,parentName=null){
  const s=T.getSession(sessionId),d=T.isoDate(date),list=names(players);reference(ref);
  if(!s||!d||d.getUTCDay()!==s.weekday||s.excludedDates.includes(date))throw new Error('Choose an approved weekly session date.');
  const body=[
    greeting(list,parentName),
    'Players: '+list.join(', '),
    `Next session:\n${T.prettyDate(date)}\n${s.time}\n${T.catalog.locations[s.location].name} · Vancouver time`,
    'Attendance:\nPlease RSVP Yes, No or Maybe in your Google Calendar invitation. We’re expecting your listed players unless you decline.',
    ...(list.length>1?['Different plans for siblings? Choose Maybe and add a Calendar note naming who can attend.']:[]),
    'Bring a ball, water and weather-ready layers. Thank you for helping us plan!',
    'Star Soccer\n'+T.catalog.email+'\nReference: '+ref
  ].join('\n\n');
  return {...render({subject:`Star Soccer attendance | ${T.prettyDate(date)} | ${ref}`,body,reference:ref},{title:s.day+' training',kicker:'Attendance check',calendarUrl}),legacyOnly:true,deliveryHold:'legacy-calendar-recovery-only',draftOnly:true};
}
function withoutAttendance(message){
  return {...message,body:message.body.replace(/\n\nAttendance:\n[\s\S]*?(?=\n\n|$)/,'')};
}
function registrationConfirmation(sessionId,date,ref,playerName,parentName=null,attendance=null){
  const s=T.getSession(sessionId),message=personalized(withoutAttendance(W.confirmation(sessionId,date,ref,playerName)),playerName,parentName);
  return attachAttendance(render({...message,reference:ref},{title:s.day+' training',visuals:true}),[playerName],date,attendance);
}
function attachAttendance(message,players,date,attendance){
 if(!attendance)return {...message,attendanceRequired:true,attendanceIncluded:false,deliveryHold:'attendance-links-required',draftOnly:true};
 const expected=names(players),actual=attendance.players?.map(p=>p.name);
 if(attendance.session?.date!==date||!actual||actual.length!==expected.length||actual.some((n,i)=>n!==expected[i]))throw new Error('Attendance must match every confirmed player and the exact session date.');
 const draft=weeklyAttendanceDraft({...attendance,reference:message.reference,mode:'draft'}),marker='<p style="border-top:1px solid #d7e2eb';
 if(!message.html.includes(marker))throw new Error('Confirmation template footer missing.');
 const section='<h2 style="font-size:19px;color:#17344e">Will you be joining us?</h2>'+draft.sectionHTML+'<p style="font-size:12px;color:#607286">Open your choice and press Confirm response. You can change it before training starts.</p>';
 return {...message,html:message.html.replace(marker,section+marker),body:message.body+'\n\nAttendance:\n'+draft.sectionBody,attendanceRequired:true,attendanceIncluded:true,deliveryHold:null,draftOnly:true};
}
function multipleRegistrationConfirmation({sessionId,date,reference:ref,players,parentName=null,attendance=null}){
 const list=names(players);if(list.length<2)throw new Error('Use the individual confirmation for one player.');reference(ref);
 const sample=W.confirmation(sessionId,date,ref,list[0]),details=sample.body.match(/Next session:\n[\s\S]*?(?=\n\n|$)/)?.[0];if(!details)throw new Error('Session details unavailable.');
 const s=T.getSession(sessionId),joined=new Intl.ListFormat('en-CA',{style:'long',type:'conjunction'}).format(list);
 const body=[greeting(list,parentName),'Thanks for registering '+joined+' for training with Star Soccer!',details,'Players: '+joined+'\n$'+s.dropin+' CAD per player\nTotal: $'+s.dropin*list.length+' CAD','You can pay by e-transfer to '+T.catalog.email+', or arrange payment with your coach on the day. Please put your players’ full names in the transfer notes.','Please share a separate attendance response for each player below.','Star Soccer Vancouver'].join('\n\n');
 return attachAttendance(render({subject:'Star Soccer training confirmed | '+joined,body,reference:ref},{title:s.day+' training',visuals:true}),list,date,attendance);
}
function passConfirmation(sessionId,date,ref,playerName,now=new Date(),updated=false,parentName=null){
  const message=personalized(withoutAttendance(W.passConfirmation(sessionId,date,ref,playerName,now,updated)),playerName,parentName,updated);
  return {...render({...message,reference:ref},{title:T.getSession(sessionId).day+' 4-week pass',kicker:updated?'Pass dates updated':'Your pass is confirmed',visuals:true}),attendanceRequired:false,attendanceIncluded:false};
}
function campConfirmation(q,ref,playerName,parentName=null){
  const C=require('../winter-camps.js');
  const message=personalized(C.confirmation(q,ref,playerName),playerName,parentName);
  message.body=message.body.replace('\n\nReply to this email','\n\nYour registration confirms '+(q.kind==='dropin'?'only your selected dates listed above':'every package date listed above')+'.\n\nReply to this email');
  return {...render({...message,reference:ref},{title:q.weekName,theme:'winter',visuals:true}),attendanceRequired:false,attendanceIncluded:false};
}

function privateAttendanceOrigin(value,demo){
  const u=new URL(value);
  if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||u.origin!==value)throw new Error('Use the approved attendance origin.');
  if(u.origin==='https://attendance.starsoccer.ca')return u.origin;
  if(demo===true&&u.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(u.hostname))return u.origin;
  throw new Error('Use the approved attendance origin; loopback previews require demo mode.');
}
function privateAttendanceUrl(value,origin,kind){
  if(typeof value!=='string'||value.length>2048||/[\r\n\x00-\x1f]/.test(value))throw new Error('Use a valid attendance link.');
  const u=new URL(value),p=new URLSearchParams(u.hash.slice(1));
  const keys=kind==='optout'?['token','action']:['token','answer'];
  if(u.origin!==origin||u.pathname!=='/respond'||u.search||u.username||u.password||p.size!==2||keys.some(k=>p.getAll(k).length!==1)||!Array.from(p.keys()).every(k=>keys.includes(k))||!/^[A-Za-z0-9_-]{43}$/.test(p.get('token')||'')||(kind==='optout'?p.get('action')!=='optout':p.get('answer')!==kind))throw new Error('Use a scoped attendance link for the correct action.');
  return {url:u.href,token:p.get('token')};
}
function utcInstant(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)&&T.isoDate(value.slice(0,10))&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().replace('.000Z','Z')===value.replace('.000Z','Z');
}
// Pure draft generation: this helper has no Gmail client or sending capability.
function weeklyAttendanceDraft({parentName=null,players,session,reference:ref,appOrigin,mode='draft',demo=false}){
  if(mode!=='draft')throw new Error('Attendance communication remains draft-only.');
  reference(ref);
  const origin=privateAttendanceOrigin(appOrigin,demo);
  if(!Array.isArray(players)||players.some(p=>!p||typeof p!=='object'))throw new Error('Choose the actual players in this family.');
  const list=names(players.map(p=>p.name)),identity=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/;
  if(players.some(p=>!identity.test(p.playerId||''))||new Set(players.map(p=>p.playerId)).size!==players.length)throw new Error('Use distinct actual player identities.');
  if(!session||!identity.test(session.id||'')||!T.isoDate(session.date)||!['label','time','location'].every(k=>typeof session[k]==='string'&&session[k].trim()&&session[k].length<=180&&!/[\r\n\x00-\x1f]/.test(session[k]))||!utcInstant(session.startAt)||!utcInstant(session.endAt)||Date.parse(session.endAt)<=Date.parse(session.startAt))throw new Error('Use the actual dated session details.');
  const scoped=players.map((p,i)=>{
    const yes=privateAttendanceUrl(p.yesUrl,origin,'yes'),no=privateAttendanceUrl(p.noUrl,origin,'no'),out=privateAttendanceUrl(p.optOutUrl,origin,'optout');
    if(yes.token!==no.token||out.token===yes.token)throw new Error('Use one session response token and a separate opt-out token for each player.');
    return {name:list[i],yesUrl:yes.url,noUrl:no.url,optOutUrl:out.url,token:yes.token,optOutToken:out.token};
  });
  if(new Set(scoped.map(p=>p.token)).size!==scoped.length)throw new Error('Each player needs their own session response token.');
  if(new Set(scoped.flatMap(p=>[p.token,p.optOutToken])).size!==scoped.length*2)throw new Error('Each player needs a separate scoped opt-out token.');
  const subject='Star Soccer · '+session.label+' attendance · '+T.prettyDate(session.date);
  const details=session.label+'\n'+T.prettyDate(session.date)+'\n'+session.time+'\n'+session.location+' · Vancouver time';
  const intro=greeting(list,parentName);
  const body=[intro,'Can '+new Intl.ListFormat('en-CA',{style:'long',type:'conjunction'}).format(list)+' join us for training?',details,
    ...scoped.map(p=>p.name+'\nYes, attending: '+p.yesUrl+'\nCan’t make it: '+p.noUrl),
    'Please confirm your choice on the page that opens. You can change your answer before the session starts. No login is needed.',
    'Thanks for helping us prepare the session!',
    ...scoped.map(p=>'Stop weekly attendance emails for '+p.name+': '+p.optOutUrl),
    'Your existing registrations stay in place.',
    'Star Soccer Vancouver\n'+T.catalog.email
  ].join('\n\n');
  const buttons=scoped.map(p=>'<section style="padding:18px 0;border-top:1px solid #d7e2eb"><h2 style="font-size:19px;color:#17344e;margin:0 0 14px">'+escape(p.name)+'</h2><a aria-label="'+escape('Yes, '+p.name+' is attending')+'" href="'+escape(p.yesUrl)+'" style="display:block;text-align:center;padding:15px 18px;margin:0 0 10px;border-radius:8px;background:#173d62;color:#fff;text-decoration:none;font-size:16px;font-weight:700">Yes, attending</a><a aria-label="'+escape(p.name+' can’t make it')+'" href="'+escape(p.noUrl)+'" style="display:block;text-align:center;padding:15px 18px;border-radius:8px;border:1px solid #a8b8c6;color:#173d62;text-decoration:none;font-size:16px;font-weight:700">Can’t make it</a></section>').join('');
  const optOut=scoped.map(p=>'<p style="margin:8px 0;font-size:12px;line-height:1.5"><a href="'+escape(p.optOutUrl)+'" style="color:#42627e">Stop weekly attendance emails for '+escape(p.name)+'</a></p>').join('');
  const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(subject)+'</title></head><body style="margin:0;background:#eaf0f5;font-family:Arial,sans-serif;overflow-wrap:anywhere"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border-radius:14px;overflow:hidden"><tr><td style="padding:24px;background:#08111f;border-top:5px solid #edbf91"><img src="https://starsoccer.ca/email-star-soccer-logo.png?v=20261027-galactic" width="250" height="85" alt="Star Soccer Vancouver" style="display:block;max-width:100%;height:auto;border:0;margin:0 0 14px"><p style="margin:0 0 7px;color:#edbf91;font-size:12px;font-weight:700">WEEKLY TRAINING</p><h1 style="margin:0;color:#fff;font-size:27px;line-height:1.25">Coming to training?</h1></td></tr><tr><td style="padding:24px;color:#344b61;font-size:16px;line-height:1.6"><p>'+escape(intro)+'</p><p>Can '+escape(new Intl.ListFormat('en-CA',{style:'long',type:'conjunction'}).format(list))+' join us for training?</p><p style="padding:16px 18px;background:#eef3f7;border-left:3px solid #edbf91;color:#18344e">'+escape(details).replaceAll('\n','<br>')+'</p>'+buttons+'<p>Please confirm your choice on the page that opens. You can change your answer before the session starts. No login is needed.</p><p>Thanks for helping us prepare the session!</p><p>Star Soccer Vancouver<br><a href="mailto:'+T.catalog.email+'" style="color:#214f78">'+T.catalog.email+'</a></p><div style="border-top:1px solid #d7e2eb;padding-top:12px">'+optOut+'<p style="font-size:12px;line-height:1.5;color:#607286">Your existing registrations stay in place.</p></div></td></tr></table></td></tr></table></body></html>';
  return {subject,body,html,reference:ref,draftOnly:true,attendanceRequired:true,attendanceIncluded:true,sectionHTML:buttons+optOut,sectionBody:scoped.map(p=>p.name+'\nYes, attending: '+p.yesUrl+'\nCan’t make it: '+p.noUrl+'\nStop weekly attendance emails: '+p.optOutUrl).join('\n\n')};
}
function paymentThankYou({parentName=null,players,amountCents,reference:ref,confirmedReceived=false,receivedDate=null,theme='autumn'}){
  const list=names(players);
  if(confirmedReceived!==true)throw new Error('Confirm actual receipt before preparing a received-payment message.');
  if(!Number.isSafeInteger(amountCents)||amountCents<=0||amountCents>1000000000||!/^SS-PAY-[A-Z0-9-]{6,50}$/.test(ref)||!['autumn','winter'].includes(theme)||(receivedDate!==null&&!T.isoDate(receivedDate)))throw new Error('Use the verified amount, receipt reference and actual received date.');
  const playerList=new Intl.ListFormat('en-CA',{style:'long',type:'conjunction'}).format(list),amount=new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'}).format(amountCents/100)+' CAD';
  const body=[greeting(list,parentName),'Thank you for your payment for '+playerList+' — we’ve received your e-transfer.',`Payment received:\n${amount}\nPlayers: ${playerList}`+(receivedDate?'\nReceived: '+T.prettyDate(receivedDate):''),'We appreciate your support. If you have any questions, just reply to this email.','See you on the field!\nRomeo\nStar Soccer\n'+T.catalog.email+'\nReference: '+ref].join('\n\n');
  return render({subject:'Star Soccer payment received | '+playerList+' | '+ref,body,reference:ref},{title:'Thank you for your payment',theme,visuals:true,kicker:'Payment received'});
}
function reminderDue(sessionId,date,now=new Date()){
  const s=T.getSession(sessionId),d=T.isoDate(date),clock=T.localClock(now);
  if(!s||!d||d.getUTCDay()!==s.weekday||s.excludedDates.includes(date)||!T.eligibleDate(s,date,now))return false;
  const sendDate=T.addDays(date,-2);
  return clock.date>sendDate||(clock.date===sendDate&&clock.minutes>=540);
}
function parseReply(body,players){
  const list=names(players),lines=[];
  for(const raw of String(body||'').split(/\r?\n/)){
    const line=raw.trim();if(/^>|^On .+wrote:|^From:|^--$/i.test(line))break;
    if(line)lines.push(line);
  }
  const one=lines.length===1?W.rsvp(lines[0]):null;
  if(one)return list.map(name=>({name,answer:one}));
  const responses=[],seen=new Set();
  for(const line of lines){
    const colon=line.lastIndexOf(':');if(colon<1)return null;
    const key=line.slice(0,colon).trim().normalize('NFC').toLowerCase(),answer=W.rsvp(line.slice(colon+1));
    const name=list.find(name=>name.normalize('NFC').toLowerCase()===key);
    if(!name||!answer||seen.has(key))return null;
    seen.add(key);responses.push({name,answer});
  }
  return responses.length?responses:null;
}
module.exports={attendanceInquiry,legacyAttendanceInquiry:attendanceInquiry,weeklyAttendanceDraft,registrationConfirmation,multipleRegistrationConfirmation,passConfirmation,campConfirmation,paymentThankYou,guardianGreeting:greeting,reminderDue,parseReply,reminderKey,approvedCalendarUrl};
