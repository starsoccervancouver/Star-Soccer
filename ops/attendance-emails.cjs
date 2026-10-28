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
  return render({subject:`Star Soccer attendance | ${T.prettyDate(date)} | ${ref}`,body,reference:ref},{title:s.day+' training',kicker:'Attendance check',calendarUrl});
}
function withoutAttendance(message){
  return {...message,body:message.body.replace(/\n\nAttendance:\n[\s\S]*?(?=\n\n|$)/,'')};
}
function registrationConfirmation(sessionId,date,ref,playerName,parentName=null){
  const s=T.getSession(sessionId),message=personalized(withoutAttendance(W.confirmation(sessionId,date,ref,playerName)),playerName,parentName);
  return render({...message,reference:ref},{title:s.day+' training',visuals:true,followUp:'A separate Google Calendar attendance invitation will follow for your next session. Please choose Yes, No or Maybe there to let us know if you’re coming. We’re expecting your player unless you decline.'});
}
function passConfirmation(sessionId,date,ref,playerName,now=new Date(),updated=false,parentName=null){
  const message=personalized(withoutAttendance(W.passConfirmation(sessionId,date,ref,playerName,now,updated)),playerName,parentName,updated),upcoming=W.passPlan(sessionId,date,now).upcoming;
  return render({...message,reference:ref},{title:T.getSession(sessionId).day+' 4-week pass',kicker:updated?'Pass dates updated':'Your pass is confirmed',visuals:true,followUp:upcoming?'A separate Google Calendar attendance invitation will follow for your first session. Choose Yes, No or Maybe there. Declining that date does not cancel your pass.':'Before your first session, we’ll send a separate Google Calendar attendance invitation. No attendance response is needed now.'});
}
function campConfirmation(q,ref,playerName,parentName=null){
  const C=require('../winter-camps.js');
  return render({...personalized(C.confirmation(q,ref,playerName),playerName,parentName),reference:ref},{title:q.weekName,theme:'winter',visuals:true,followUp:'Before camp starts, we’ll send a separate Google Calendar attendance invitation for your first session. Your registration covers '+(q.kind==='dropin'?'only your selected dates listed above':'every package date listed above')+'; RSVP applies only to the invited session.'});
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
module.exports={attendanceInquiry,registrationConfirmation,passConfirmation,campConfirmation,paymentThankYou,guardianGreeting:greeting,reminderDue,parseReply,reminderKey,approvedCalendarUrl};
