/* Owner-approved winter camp dates and pricing; no payment or seat is reserved here. */
(function(root){
  'use strict';
  const T=typeof module!=='undefined'&&module.exports?require('./training.js'):root.StarTraining;
  const catalog=Object.freeze({version:'20261026-register',zone:'America/Vancouver',minAge:5,maxAge:14,capacity:20,location:'Kitsilano Turf',
    weeks:Object.freeze({christmas:Object.freeze({id:'christmas',name:'Christmas week',start:'2026-12-21',end:'2026-12-25',price:200,freeDate:'2026-12-25'}),boxing:Object.freeze({id:'boxing',name:'Boxing Week',start:'2026-12-28',end:'2027-01-01',price:185,freeDate:null})}),
    slots:Object.freeze({am:Object.freeze({id:'am',name:'Morning',time:'9 AM–noon',startMinutes:540}),pm:Object.freeze({id:'pm',name:'Afternoon',time:'12:30–3:30 PM',startMinutes:750})})});
  function getWeek(id){return Object.hasOwn(catalog.weeks,id)?catalog.weeks[id]:null;}
  function dates(id){const w=getWeek(id);if(!w)throw new Error('Choose a camp week.');return Array.from({length:5},(_,i)=>T.addDays(w.start,i));}
  function selectedSlots(id){if(id==='both')return [catalog.slots.am,catalog.slots.pm];if(Object.hasOwn(catalog.slots,id))return [catalog.slots[id]];throw new Error('Choose a morning, afternoon or both sessions.');}
  function quote({week,kind,slot,date,age},now=new Date()){
    const w=getWeek(week);if(!w)throw new Error('Choose a camp week.');
    if(!['week','dropin'].includes(kind))throw new Error('Choose a weekly package or a drop-in.');
    const slots=selectedSlots(slot),allDates=dates(week),clock=T.localClock(now);
    if(!/^\d{1,2}$/.test(String(age))||Number(age)<5||Number(age)>14)throw new Error('Winter camps are for ages 5–14. Enter a whole-number age in that range.');
    const covered=kind==='week'?allDates:[date];
    if(covered.some(d=>!allDates.includes(d)))throw new Error('Choose a date within your selected camp week.');
    if(covered[0]<clock.date||(covered[0]===clock.date&&clock.minutes>=slots[0].startMinutes))throw new Error('This option has already started. Choose an upcoming date or session.');
    const free=kind==='dropin'&&date===w.freeDate;
    const price=(kind==='week'?w.price:free?0:60)*slots.length;
    const sessions=covered.flatMap(d=>slots.map(s=>Object.freeze({key:'winter-'+week+'-'+s.id+':'+d,date:d,slot:s.id,time:s.time,capacity:20})));
    return Object.freeze({week:w.id,weekName:w.name,kind,slot,dates:Object.freeze(covered),sessions:Object.freeze(sessions),price,free,
      label:kind==='week'?'Five-day '+(slot==='both'?'morning + afternoon package':slots[0].name.toLowerCase()+' package'):(free?'Free Christmas Friday': 'Drop-in')+' · '+(slot==='both'?'morning + afternoon':slots[0].name),
      time:slot==='both'?'9 AM–noon & 12:30–3:30 PM':slots[0].time,lunch:slot==='both',location:catalog.location});
  }
  const api=Object.freeze({catalog,getWeek,dates,selectedSlots,quote});root.StarWinterCamps=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
