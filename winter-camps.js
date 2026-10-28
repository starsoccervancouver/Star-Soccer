/* Owner-approved winter camp dates and pricing; no payment or seat is reserved here. */
(function(root){
  'use strict';
  const T=typeof module!=='undefined'&&module.exports?require('./training.js'):root.StarTraining;
  const catalog=Object.freeze({version:'20261028-full-day-value',zone:'America/Vancouver',minAge:5,maxAge:14,capacity:20,location:'Kitsilano Turf',dropin:Object.freeze({halfDay:60,fullDay:100}),
    weeks:Object.freeze({christmas:Object.freeze({id:'christmas',name:'Winter Camp — Week 1',start:'2026-12-21',end:'2026-12-25',price:200,fullDayPrice:350,standardPrice:250,freeDate:'2026-12-25'}),boxing:Object.freeze({id:'boxing',name:'Winter Camp — Week 2',start:'2026-12-28',end:'2027-01-01',price:185,fullDayPrice:325,standardPrice:250,freeDate:null})}),
    slots:Object.freeze({am:Object.freeze({id:'am',name:'Morning',time:'9 AM–noon',startMinutes:540}),pm:Object.freeze({id:'pm',name:'Afternoon',time:'12:30–3:30 PM',startMinutes:750})})});
  function getWeek(id){return Object.hasOwn(catalog.weeks,id)?catalog.weeks[id]:null;}
  function dates(id){const w=getWeek(id);if(!w)throw new Error('Choose a camp week.');return Array.from({length:5},(_,i)=>T.addDays(w.start,i));}
  function selectedSlots(id){if(id==='both')return [catalog.slots.am,catalog.slots.pm];if(Object.hasOwn(catalog.slots,id))return [catalog.slots[id]];throw new Error('Choose a morning, afternoon or both sessions.');}
  function quote({week,kind,slot,date,dates:chosenDates,age},now=new Date()){
    const w=getWeek(week);if(!w)throw new Error('Choose a camp week.');
    if(!['week','dropin'].includes(kind))throw new Error('Choose a weekly package or a drop-in.');
    const slots=selectedSlots(slot),allDates=dates(week),clock=T.localClock(now);
    if(!/^\d{1,2}$/.test(String(age))||Number(age)<5||Number(age)>14)throw new Error('Winter camps are for ages 5–14. Enter a whole-number age in that range.');
    if(kind==='dropin'&&chosenDates!==undefined&&!Array.isArray(chosenDates))throw new Error('Choose your camp days.');
    const covered=kind==='week'?allDates:chosenDates===undefined?[date]:[...chosenDates].sort();
    if(!covered.length)throw new Error('Choose at least one camp day.');
    if(new Set(covered).size!==covered.length)throw new Error('Choose each camp day only once.');
    if(covered.some(d=>!allDates.includes(d)))throw new Error('Choose a date within your selected camp week.');
    if(covered[0]<clock.date||(covered[0]===clock.date&&clock.minutes>=slots[0].startMinutes))throw new Error('This option has already started. Choose an upcoming date or session.');
    const paidDays=covered.filter(d=>d!==w.freeDate).length;
    const free=kind==='dropin'&&paidDays===0;
    const price=kind==='week'?(slot==='both'?w.fullDayPrice:w.price):paidDays*(slot==='both'?catalog.dropin.fullDay:catalog.dropin.halfDay);
    const sessions=covered.flatMap(d=>slots.map(s=>Object.freeze({key:'winter-'+week+'-'+s.id+':'+d,date:d,slot:s.id,time:s.time,capacity:20})));
    const standardPrice=kind==='week'?w.standardPrice*slots.length:null;
    return Object.freeze({week:w.id,weekName:w.name,kind,slot,dates:Object.freeze(covered),sessions:Object.freeze(sessions),price,standardPrice,savings:standardPrice===null?0:standardPrice-price,free,
      label:kind==='week'?'Five-day '+(slot==='both'?'morning + afternoon package':slots[0].name.toLowerCase()+' package'):(free?'Free Christmas Friday': 'Drop-in · '+covered.length+(covered.length===1?' day':' days'))+' · '+(slot==='both'?'morning + afternoon':slots[0].name),
      time:slot==='both'?'9 AM–noon & 12:30–3:30 PM':slots[0].time,lunch:slot==='both',location:catalog.location});
  }
  function confirmation(q,reference,name){
    name=String(name||'').trim();
    if(!['week','dropin'].includes(q.kind)||!getWeek(q.week)||!/^SS-CAMP-[A-Z0-9-]{6,40}$/.test(reference)||!name||name.length>100||/[\r\n\x00-\x1f]/.test(name))throw new Error('Invalid camp confirmation.');
    return {subject:'Star Soccer camp registration confirmed | '+q.weekName+' | '+reference,body:[
      'Thank you, '+name+' — you’re registered!',
      '', 'Your camp:\n'+q.weekName+'\n'+q.label+'\n'+q.time+'\nKitsilano Turf · Vancouver time',
      '', 'Your dates:\n'+q.dates.map(T.prettyDate).join('\n'),
      q.lunch?'Supervised lunch is included from noon–12:30. Bring a packed lunch.':'',
      '', q.kind==='week'?`${name}’s camp package total is ${T.money(q.price)} CAD.`:`${name}’s selected camp days come to ${T.money(q.price)} CAD.`,
      ...(q.price>0?['',T.paymentInstructions()]:[]),
      q.week==='christmas'&&q.dates.includes('2026-12-25')?'Christmas Friday is free — our gift to you.':q.kind==='week'&&q.week==='boxing'?'Your package includes the Boxing Week Sale.':'',
      '', 'Reply to this email if your attendance plans change or you have a question.',
      '', 'See you on the field!','Star Soccer','starsoccervancouver@gmail.com','Reference: '+reference
    ].filter((line,i,all)=>line!==''||all[i-1]!=='').join('\n')};
  }
  const api=Object.freeze({catalog,getWeek,dates,selectedSlots,quote,confirmation});root.StarWinterCamps=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
