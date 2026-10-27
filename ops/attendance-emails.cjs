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
function reference(value){
  if(typeof value!=='string'||!/^(?:SS-RSVP-[A-F0-9]{20}|RSVP-[A-Z0-9-]{6,64}|SS-[A-Z0-9-]{6,40})$/.test(value))throw new Error('Invalid email reference.');
  return value;
}
function reminderKey(familyId,sessionId,date){
  if(!/^rec[A-Za-z0-9]{14}$/.test(familyId)||!T.getSession(sessionId)||!T.isoDate(date))throw new Error('Invalid reminder identity.');
  return 'SS-RSVP-'+crypto.createHash('sha256').update([familyId,sessionId,date].join('|')).digest('hex').slice(0,20).toUpperCase();
}
function replyLinks(subject){
  const link=answer=>'mailto:'+T.catalog.email+'?subject='+encodeURIComponent('Re: '+subject)+'&body='+answer;
  return {yes:link('YES'),no:link('NO')};
}
function render(message,{title,inquiry=false}={}){
  const links=replyLinks(message.subject);
  let inserted=false;
  const paragraphs=message.body.split('\n\n').map(part=>{
    const lines=part.split('\n').filter(line=>line!=='Star Soccer'&&line!==T.catalog.email&&!line.startsWith('Reference: '));
    if(!lines.length)return '';
    let html='<p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#223449">'+lines.map(escape).join('<br>')+'</p>';
    if(inquiry&&!inserted&&part.includes('Reply YES')){
      inserted=true;
      html+='<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:4px 0 10px"><tr><td width="50%" style="padding:0 5px 0 0"><a href="'+escape(links.yes)+'" style="display:block;background:#235ecb;color:#fff;text-decoration:none;text-align:center;font:700 16px/48px Arial,sans-serif;border-radius:8px">YES, coming</a></td><td width="50%" style="padding:0 0 0 5px"><a href="'+escape(links.no)+'" style="display:block;background:#e7edf5;color:#19334d;text-decoration:none;text-align:center;font:700 16px/48px Arial,sans-serif;border-radius:8px">NO, can’t go</a></td></tr></table><p style="margin:0 0 22px;font-size:12px;line-height:1.5;color:#516579">Buttons open an email reply. Tap Send to return your answer, or simply reply YES or NO.</p>';
    }
    return html;
  }).join('');
  return {...message,html:'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+escape(message.subject)+'</title></head><body style="margin:0;background:#edf2f7;font-family:Arial,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="width:100%;max-width:600px;background:#fff;border-radius:14px;overflow:hidden"><tr><td style="padding:24px;background:#0c2139;color:#fff"><p style="margin:0 0 8px;color:#edc980;font-size:12px;font-weight:700;letter-spacing:2px">STAR SOCCER · VANCOUVER</p><h1 style="margin:0;font-size:26px;line-height:1.25;color:#fff">'+escape(title||'See you on the field!')+'</h1></td></tr><tr><td style="padding:24px">'+paragraphs+'<p style="border-top:1px solid #d7e1eb;padding-top:18px;margin:6px 0 0;font-size:12px;line-height:1.6;color:#516579">Star Soccer<br><a href="mailto:'+T.catalog.email+'" style="color:#235ecb">'+T.catalog.email+'</a><br>Reference: '+escape(message.reference)+'</p></td></tr></table></td></tr></table></body></html>'};
}
function attendanceInquiry(sessionId,date,players,ref){
  const s=T.getSession(sessionId),d=T.isoDate(date),list=names(players);reference(ref);
  if(!s||!d||d.getUTCDay()!==s.weekday||s.excludedDates.includes(date))throw new Error('Choose an approved weekly session date.');
  const family=list.length===1?list[0]:list.slice(0,-1).join(', ')+' and '+list.at(-1);
  const body=[
    'Hi there!',`Can ${family} join us for training?`,
    `${T.prettyDate(date)}\n${s.time} · ${T.catalog.locations[s.location].name}\nVancouver time`,
    `Reply YES ${list.length>1?'if everyone is coming':'to confirm'}, or NO ${list.length>1?'if no one can make it':'if you can’t make it'}. We’re planning for ${list.length>1?'your players':list[0]} unless you let us know otherwise.`,
    ...(list.length>1?[`Different plans for each child? Reply on separate lines:\n${list.map(p=>p+': YES or NO').join('\n')}`]:[]),
    'Thanks for helping us plan a great session. Bring a ball, water and weather-ready layers.',
    'See you on the field!\nStar Soccer\n'+T.catalog.email+'\nReference: '+ref
  ].join('\n\n');
  return render({subject:`Star Soccer attendance | ${T.prettyDate(date)} | ${ref}`,body,reference:ref},{title:'Coming to training?',inquiry:true});
}
function registrationConfirmation(sessionId,date,ref,playerName){
  const message=W.confirmation(sessionId,date,ref,playerName);
  message.body=message.body.replace('You’re registered!','Thank you for registering — you’re on the list!');
  return render({...message,reference:ref},{title:'You’re registered!',inquiry:true});
}
function passConfirmation(sessionId,date,ref,playerName,now=new Date(),updated=false){
  return render({...W.passConfirmation(sessionId,date,ref,playerName,now,updated),reference:ref},{title:updated?'Your pass dates are updated':'Your 4-week pass is confirmed',inquiry:W.passPlan(sessionId,date,now).upcoming});
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
module.exports={attendanceInquiry,registrationConfirmation,passConfirmation,reminderDue,parseReply,reminderKey};
