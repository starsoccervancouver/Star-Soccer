/* Undated weekly interest is reconciled to the next session by the intake worker.
 * Registering never marks a child present or verifies a payment.
 */
(function(root){
  'use strict';
  const T=typeof module!=='undefined'&&module.exports?require('./training.js'):root.StarTraining;
  const experience=Object.freeze({new:'New to soccer',some:'Some experience',regular:'Plays regularly',unsure:'Not sure yet'});
  function request(sessionId,type,values){
    const selected=T.choice(sessionId,type||'dropin'),s=selected.session;
    const name=String(values.name||'').trim(),email=String(values.email||'').trim(),age=String(values.age||'');
    if(!name||name.length>100||/[\r\n\x00-\x1f]/.test(name))throw new Error('Enter the child’s name.');
    if(email.length>254||!/^\S+@[^\s@]+\.[^\s@]+$/.test(email)||/[\r\n,;]/.test(email))throw new Error('Enter one parent email address.');
    if(!/^\d{1,2}$/.test(age)||Number(age)<s.minAge||Number(age)>s.maxAge)throw new Error(`This group is for ages ${s.minAge}–${s.maxAge}.`);
    if(!Object.hasOwn(experience,values.experience))throw new Error('Choose an experience level, or Not sure yet.');
    return {version:selected.type==='pass4'?'SS-PASS-V1':'SS-WEEKLY-V2',sessionId:s.id,type:selected.type,name,email,age:Number(age),experience:experience[values.experience]};
  }
  function passPlan(sessionId,startDate=null,now=new Date()){
    const s=T.getSession(sessionId);if(!s)throw new Error('Choose a current group.');
    const b=T.booking(s.id,'pass4',startDate||T.nextDate(s,now),s.minAge,now);
    return Object.freeze({sessionId:s.id,price:b.price,start:b.dates[0],end:b.dates[3],dates:Object.freeze([...b.dates]),upcoming:b.dates[0]===T.nextDate(s,now)});
  }
  function confirmation(sessionId,date,reference,playerName){
    const s=T.getSession(sessionId),d=T.isoDate(date);
    if(!s||!d||d.getUTCDay()!==s.weekday||!/^SS-[A-Z0-9-]{6,40}$/.test(reference))throw new Error('Invalid registration confirmation.');
    const name=String(playerName||'').trim();
    if(!name||name.length>100||/[\r\n\x00-\x1f]/.test(name))throw new Error('Invalid player name.');
    return {subject:`Star Soccer registration confirmed | ${s.day} | ${reference}`,body:[
      `Thank you, ${name} — you’re registered!`,
      '',`Next session:\n${s.day} training · ${T.prettyDate(date)}\n${s.time}\n${T.catalog.locations[s.location].name} · Vancouver time`,
      '',`Attendance:\nPlease RSVP Yes, No or Maybe in your Google Calendar invitation. We’re expecting ${name} unless you decline.`,
      '',`${name}’s session total is ${T.money(s.dropin)} CAD.`,
      '',T.paymentInstructions(),
      '',`This confirms the next session only; arrange future drop-ins with the team.`,
      '',`See you on the field!`,`Star Soccer`,T.catalog.email,`Reference: ${reference}`
    ].join('\n')};
  }
  function rsvp(body){
    // Interpret only an unambiguous first-line answer, never quoted history.
    const first=String(body||'').trim().split(/\r?\n/)[0].trim();
    return /^yes[.!]?$/i.test(first)?'Yes':/^no[.!]?$/i.test(first)?'No':null;
  }
  function startChange(body){
    const first=String(body||'').trim().split(/\r?\n/)[0].trim();
    return /^START \d{4}-\d{2}-\d{2}$/i.test(first)&&T.isoDate(first.slice(6))?first.slice(6):null;
  }
  function passConfirmation(sessionId,startDate,reference,playerName,now=new Date(),updated=false){
    // Reuse identity/reference validation; derive every date and price from the catalog.
    confirmation(sessionId,startDate,reference,playerName);
    const s=T.getSession(sessionId),p=passPlan(sessionId,startDate,now);
    const name=String(playerName).trim();
    return {subject:`Star Soccer 4-week pass ${updated?'start updated':'confirmed'} | ${s.day} | ${p.start} | ${reference}`,body:[
      `Thank you, ${name} — your four-session pass is ${updated?'updated':'confirmed'}!`,
      '',`Your pass:\n${name}’s four-session pass comes to ${T.money(p.price)} CAD.\nStart: ${T.prettyDate(p.start)}\nEnd (4th session): ${T.prettyDate(p.end)}\n${s.time} · ${T.catalog.locations[s.location].name} · Vancouver time`,
      '',`Your four dates:\n${p.dates.map(T.prettyDate).join('\n')}`,
      ...(p.upcoming?['',`Attendance:\nPlease RSVP Yes, No or Maybe in your Google Calendar invitation for ${T.prettyDate(p.start)}. We’re expecting you unless you decline. Declining this date does not cancel your pass.`]:[]),
      '',T.paymentInstructions(),
      '',`See you on the field!`,`Star Soccer`,T.catalog.email,`Reference: ${reference}`
    ].join('\n')};
  }
  const api=Object.freeze({experience,request,confirmation,rsvp,passPlan,passConfirmation,startChange});
  root.StarWeeklySignup=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
