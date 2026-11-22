const test=require('node:test');
const assert=require('node:assert/strict');

test('each linked sibling gets one unsent draft, including after a retry',async()=>{
 const {checkConfirmationDrafts}=await import('../private-attendance/confirmation-drafts.mjs');
 const {weeklyRequest}=await import('../private-attendance/camp-placement.mjs');
 const now=Date.parse('2026-11-22T10:00:00Z'),date='2026-11-25';
 const event={version:'SS-WEEKLY-V2',sessionId:'wednesday',age:10,received:new Date(now).toISOString(),dates:date,quotedPrice:'30',option:'Drop-in'};
 assert.equal(weeklyRequest(event).slots[0].key,'SS-20261125-WE');
 assert.equal(weeklyRequest({...event,quotedPrice:'25'}),undefined);
 const registrations=[1,2].map(i=>({id:'r'+i,fields:{Reference:'SS-READY-'+i,'Received at':event.received,Status:'Expected',Child:'Player '+i,'Parent email':'parent@example.org',Family:['family'],Player:['p'+i],Booking:['b'+i],'Source Gmail ID':'10000000000'+i}}));
 const bookings=[1,2].map(i=>({id:'b'+i,fields:{'Booking status':'Accepted','Start date':date,Family:['family'],Player:['p'+i]}}));
 const attendance=[1,2].map(i=>({fields:{Booking:['b'+i],Player:['p'+i],Session:['s'],'Session date':date,'Coverage state':'Active'}}));
 const sessions=[{id:'s',fields:{Date:date,Time:'3:45–5:15 PM',Venue:'Connaught Park',Session:'Wednesday training','Session status':'Planned'}}];
 const html='<p>Thanks for registering! {{PLAYER_NAMES}}</p><p>The fee is {{PRICE_PER_PLAYER}}</p>';
 const tables={registrations,bookings,attendance,sessions,intake:[],templates:[{fields:{Template:'Camp Email Master',Version:'REVIEW05 / Pro-D',HTML:html}}]};
 const db={list:async n=>tables[n]},map=new Map(),storage={get:k=>map.get(k),put:(k,v)=>map.set(k,v),transaction:f=>f(storage)};
 let count=0;const opts={db,storage,now,read:async id=>({id,reference:registrations.find(r=>r.fields['Source Gmail ID']===id).fields.Reference,contact:'parent@example.org',labelIds:[]}),search:async()=>[],create:async()=>({id:'draft'+ ++count})};
 await checkConfirmationDrafts(opts);await checkConfirmationDrafts(opts);assert.equal(count,2);
 map.clear();let attempts=0;const uncertain={...opts,create:async()=>{attempts++;throw Error('uncertain')}};
 await assert.rejects(checkConfirmationDrafts(uncertain));await assert.rejects(checkConfirmationDrafts(uncertain));await checkConfirmationDrafts(uncertain);assert.equal(attempts,2);
});
