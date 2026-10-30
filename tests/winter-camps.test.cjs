const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../winter-camps.js');
const now=new Date('2026-10-26T19:00:00Z');
const choice=(patch={})=>C.quote({week:'christmas',kind:'week',slot:'am',age:5,...patch},now);
test('approved camp dates, ages, capacity and paid four-day Christmas price',()=>{
 assert.equal(choice().price,200);assert.deepEqual(choice().dates,['2026-12-21','2026-12-22','2026-12-23','2026-12-24','2026-12-25']);
 assert.equal(choice().weekName,'Winter Camp — Week 1');assert.equal(choice().standardPrice,250);assert.equal(choice().savings,50);
 assert.equal(choice({age:14,slot:'both'}).price,340);assert.equal(choice({slot:'both'}).sessions.length,10);assert.equal(C.catalog.capacity,20);
 assert.equal(choice({slot:'both'}).separatePrice,400);assert.equal(choice({slot:'both'}).separatePrice-choice({slot:'both'}).price,60);assert.equal(choice().separatePrice,null);
 for(const age of [4,15,5.5,'5.5','x'])assert.throws(()=>choice({age}),/ages/);
});
test('Boxing Week uses the approved $185 weekly package and includes lunch for both slots',()=>{
 const q=choice({week:'boxing'});assert.equal(q.price,185);assert.equal(q.dates.length*3,15);assert.equal(q.dates[4],'2027-01-01');
 assert.equal(q.weekName,'Winter Camp — Week 2');assert.equal(q.standardPrice,250);assert.equal(q.savings,65);
 const both=choice({week:'boxing',slot:'both'});assert.equal(both.price,315);assert.equal(both.lunch,true);assert.equal(both.sessions.length,10);assert.equal(choice({slot:'pm'}).lunch,false);
 assert.equal(both.standardPrice,500);assert.equal(both.savings,185);assert.equal(both.separatePrice,370);assert.equal(both.separatePrice-both.price,55);
 assert.match(C.confirmation(both,'SS-CAMP-ABCDEF12','Test Player').body,/Full-day saving: \$55 CAD/);
});
test('drop-ins are $60 per three-hour slot, Christmas Friday is free including both slots',()=>{
 assert.equal(choice({kind:'dropin',date:'2026-12-22'}).price,60);assert.equal(choice({kind:'dropin',slot:'both',date:'2026-12-22'}).price,120);
 assert.equal(choice({kind:'dropin',date:'2026-12-22'}).standardPrice,null);assert.equal(choice({kind:'dropin',date:'2026-12-22'}).savings,0);
 for(const slot of ['am','pm','both']){const q=choice({kind:'dropin',date:'2026-12-25',slot});assert.equal(q.price,0);assert.equal(q.free,true);}
 assert.equal(choice({week:'boxing',kind:'dropin',date:'2027-01-01'}).price,60);
});
test('rejects unknown choices, wrong dates and sessions that have already started',()=>{
 for(const patch of [{week:'old'},{kind:'pass4'},{slot:'x'},{kind:'dropin',date:'2026-12-26'},{kind:'dropin',date:'2026-12-28'}])assert.throws(()=>choice(patch));
 assert.throws(()=>C.quote({week:'christmas',kind:'week',slot:'am',age:9},new Date('2026-12-21T16:00:00Z')),/started/);
 assert.equal(C.quote({week:'christmas',kind:'dropin',slot:'pm',date:'2026-12-21',age:9},new Date('2026-12-21T16:00:00Z')).price,60);
 assert.throws(()=>C.quote({week:'boxing',kind:'dropin',slot:'pm',date:'2027-01-01',age:9},new Date('2027-01-01T19:30:00Z')),/started/);
});
test('multiple drop-in days are sorted, priced by paid daily slots and explicitly confirmed',()=>{
 const q=choice({kind:'dropin',dates:['2026-12-25','2026-12-21','2026-12-23'],slot:'both'});
 assert.deepEqual(q.dates,['2026-12-21','2026-12-23','2026-12-25']);
 assert.equal(q.price,240);assert.equal(q.sessions.length,6);assert.equal(q.lunch,true);assert.equal(q.standardPrice,null);
 const mail=C.confirmation(q,'SS-CAMP-ABCDEF12','Test Player');
 assert.match(mail.body,/Test Player’s selected camp days come to \$240 CAD/);assert.match(mail.body,/Christmas Friday is free/);
 assert.doesNotMatch(mail.body,/Boxing Week Sale/);
 assert.equal(choice({week:'boxing',kind:'dropin',dates:['2026-12-28','2027-01-01'],slot:'pm'}).price,120);
 for(const dates of [[],['2026-12-21','2026-12-21'],['2026-12-26'],['2027-01-01'],'2026-12-21'])assert.throws(()=>choice({kind:'dropin',dates}));
 assert.throws(()=>C.quote({week:'christmas',kind:'dropin',dates:['2026-12-21','2026-12-23'],slot:'am',age:8},new Date('2026-12-21T16:00:00Z')),/started/);
});

test('cheaper full-week recommendation is optional and only offered before the week starts',()=>{
 const input={week:'christmas',kind:'dropin',slot:'am',age:8,dates:['2026-12-21','2026-12-22','2026-12-23','2026-12-24']};
 assert.equal(C.packageAlternative(input,now).price,200);
 assert.equal(C.packageAlternative(input,now).savings,40);
 assert.equal(C.packageAlternative({...input,slot:'both'},now).savings,140);
 assert.equal(C.packageAlternative({...input,dates:['2026-12-25']},now),null);
 assert.equal(C.packageAlternative({...input,kind:'week'},now),null);
 assert.equal(C.packageAlternative({...input,week:'boxing',dates:['2026-12-29','2026-12-30','2026-12-31','2027-01-01']},new Date('2026-12-29T15:00:00Z')),null);
});
