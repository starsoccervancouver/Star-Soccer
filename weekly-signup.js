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
      `You’re registered! We’ve added ${name} to our ${s.day} training list.`,
      '',`Are you joining us on ${T.prettyDate(date)}?`,
      `${s.time} · ${T.catalog.locations[s.location].name} · Vancouver time`,
      '',`We’re expecting ${name} for this next session. Reply YES to confirm, or NO if you can’t make it and we’ll update the roster. If another week suits you better, tell us in your reply.`,
      '',`No payment is needed to register. Romeo will follow up with you about payment and any questions.`,
      '',`This confirms registration and the next session only; future drop-ins are arranged with the team.`,
      '',`See you on the field!`,`Star Soccer`,`starsoccervancouver@gmail.com`,`Reference: ${reference}`
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
    const example=T.addDays(p.start,7),name=String(playerName).trim();
    return {subject:`Star Soccer 4-week pass ${updated?'start updated':'confirmed'} | ${s.day} | ${p.start} | ${reference}`,body:[
      `Thank you for registering ${name} with Star Soccer! Your four-session pass is ${updated?'updated':'confirmed'}.`,
      '',`Price: ${T.money(p.price)} CAD per player for 4 sessions.`,
      `Start date: ${T.prettyDate(p.start)}`,`Expected end date (4th session): ${T.prettyDate(p.end)}`,
      `Your dates: ${p.dates.map(T.prettyDate).join('; ')}`,
      `${s.day} · ${s.time} · ${T.catalog.locations[s.location].name} · Vancouver time`,
      '',`Need a different start? Reply START YYYY-MM-DD, for example START ${example}. We’ll check space and email your revised four dates.`,
      ...(p.upcoming?['',`Will ${name} join us on ${T.prettyDate(p.start)}? Reply YES to confirm, or NO if you can’t attend this date. We’re expecting you unless you tell us otherwise. A NO does not cancel your pass. For a different start, reply START YYYY-MM-DD.`]:[]),
      '',`Payment: e-transfer ${T.money(p.price)} CAD to ${T.catalog.email}. Include ${name} and reference ${reference} in the transfer message.`,
      `If you’ve already paid, reply with the details so Romeo can reconcile it. Please don’t pay twice. This email does not confirm that payment has been received.`,
      '',`Thank you — we look forward to seeing you on the field!`,`Star Soccer`,T.catalog.email,`Reference: ${reference}`
    ].join('\n')};
  }
  const api=Object.freeze({experience,request,confirmation,rsvp,passPlan,passConfirmation,startChange});
  root.StarWeeklySignup=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
