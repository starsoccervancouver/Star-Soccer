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
    return {version:'SS-WEEKLY-V2',sessionId:s.id,type:selected.type,name,email,age:Number(age),experience:experience[values.experience]};
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
  const api=Object.freeze({experience,request,confirmation,rsvp});
  root.StarWeeklySignup=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
