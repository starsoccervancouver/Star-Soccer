const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../winter-camps.js');
const now=new Date('2026-10-26T19:00:00Z');
const choice=(patch={})=>C.quote({week:'christmas',kind:'week',slot:'am',age:5,...patch},now);
test('approved camp dates, ages, capacity and paid four-day Christmas price',()=>{
 assert.equal(choice().price,200);assert.deepEqual(choice().dates,['2026-12-21','2026-12-22','2026-12-23','2026-12-24','2026-12-25']);
 assert.equal(choice({age:14,slot:'both'}).price,400);assert.equal(choice({slot:'both'}).sessions.length,10);assert.equal(C.catalog.capacity,20);
 for(const age of [4,15,5.5,'5.5','x'])assert.throws(()=>choice({age}),/ages/);
});
test('Boxing Week is $10 per training hour, both slots include supervised lunch',()=>{
 const q=choice({week:'boxing'});assert.equal(q.price,150);assert.equal(q.price/(q.dates.length*3),10);assert.equal(q.dates[4],'2027-01-01');
 const both=choice({week:'boxing',slot:'both'});assert.equal(both.price,300);assert.equal(both.lunch,true);assert.equal(both.sessions.length,10);assert.equal(choice({slot:'pm'}).lunch,false);
});
test('drop-ins are $60 per three-hour slot, Christmas Friday is free including both slots',()=>{
 assert.equal(choice({kind:'dropin',date:'2026-12-22'}).price,60);assert.equal(choice({kind:'dropin',slot:'both',date:'2026-12-22'}).price,120);
 for(const slot of ['am','pm','both']){const q=choice({kind:'dropin',date:'2026-12-25',slot});assert.equal(q.price,0);assert.equal(q.free,true);}
 assert.equal(choice({week:'boxing',kind:'dropin',date:'2027-01-01'}).price,60);
});
test('rejects unknown choices, wrong dates and sessions that have already started',()=>{
 for(const patch of [{week:'old'},{kind:'pass4'},{slot:'x'},{kind:'dropin',date:'2026-12-26'},{kind:'dropin',date:'2026-12-28'}])assert.throws(()=>choice(patch));
 assert.throws(()=>C.quote({week:'christmas',kind:'week',slot:'am',age:9},new Date('2026-12-21T16:00:00Z')),/started/);
 assert.equal(C.quote({week:'christmas',kind:'dropin',slot:'pm',date:'2026-12-21',age:9},new Date('2026-12-21T16:00:00Z')).price,60);
 assert.throws(()=>C.quote({week:'boxing',kind:'dropin',slot:'pm',date:'2027-01-01',age:9},new Date('2027-01-01T19:30:00Z')),/started/);
});
