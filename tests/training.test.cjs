const {test}=require('node:test');
const assert=require('node:assert/strict');
const T=require('../training.js');
const now=new Date('2026-10-16T09:00:00Z');
test('approved catalog and prices',()=>{
 assert.deepEqual(T.catalog.sessions.map(s=>[s.id,s.minAge,s.maxAge,s.dropin,s.pass4]),[['wednesday',9,14,30,95],['thursday',6,9,25,80],['friday',6,12,25,80],['sunday',6,9,30,95]]);
});
test('unknown, expired camp and absent IDs are rejected',()=>{for(const id of [null,'monday','camp-u4-u6','__proto__',''])assert.throws(()=>T.choice(id,'dropin'));assert.throws(()=>T.choice('wednesday','invalid'));});
test('URL-style untrusted prices are not inputs to catalog lookup',()=>{assert.equal(T.choice('wednesday','pass4').price,95);assert.equal(T.choice('friday','dropin').price,25);});
test('actual date, weekday, cutoff and invalid dates',()=>{
 const wed=T.getSession('wednesday');assert(T.eligibleDate(wed,'2026-10-21',now));
 for(const date of ['2026-10-15','2026-10-20','2026-02-30','no','2026-13-01']) assert.equal(T.eligibleDate(wed,date,now),false);
 const fri=T.getSession('friday');assert(T.eligibleDate(fri,'2026-10-16',new Date('2026-10-16T22:44:00Z')));
 assert.equal(T.eligibleDate(fri,'2026-10-16',new Date('2026-10-16T22:45:00Z')),false);
 assert.equal(T.eligibleDate({...fri,excludedDates:['2026-10-16']},'2026-10-16',now),false);
});
test('Vancouver day does not accidentally use UTC tomorrow',()=>{assert.equal(T.localClock(new Date('2026-10-17T02:00:00Z')).date,'2026-10-16');});
test('date arithmetic handles DST and leap years',()=>{assert.equal(T.addDays('2028-02-28',1),'2028-02-29');assert.equal(T.addDays('2028-02-29',1),'2028-03-01');assert.deepEqual(T.booking('sunday','pass4','2026-10-25','6',now).dates,['2026-10-25','2026-11-01','2026-11-08','2026-11-15']);});
test('whole-number age and correct session ranges',()=>{
 for(const age of ['not an age','6.5','',0,8,15])assert.throws(()=>T.booking('wednesday','dropin','2026-10-21',age,now));
 assert.equal(T.booking('wednesday','dropin','2026-10-21','9',now).price,30);
 assert.equal(T.booking('friday','pass4','2026-10-16','12',now).dates.length,4);
});
test('private first-hour rates stay unchanged',()=>{
 const counts=[1,2,3,4,5,6,7,10],expected=[60,45,40,35,30,25,25,25];
 counts.forEach((n,i)=>{const q=T.privateQuote(n,60);assert.equal(q.perPlayer,expected[i]);assert.equal(q.total,expected[i]*n);});
});
test('90-minute rates keep the existing extra-half-hour discount',()=>{
 const counts=[1,2,3,4,5,6,7,10],expected=[85,65,60,50,45,35,35,35];
 counts.forEach((n,i)=>{const q=T.privateQuote(n,90);assert.equal(q.perPlayer,expected[i]);assert.equal(q.total,expected[i]*n);});
});
test('two hours discount only the second hour by 20 percent then round per player',()=>{
 const counts=[1,2,3,4,5,6,7,10],expected=[110,80,70,65,55,45,45,45];
 counts.forEach((n,i)=>{
  const q=T.privateQuote(n,120);
  assert.equal(q.perPlayer,expected[i]);
  assert.equal(q.perPlayer,Math.round((q.base+q.base*0.8)/5)*5);
  assert.equal(q.total,expected[i]*n);
  assert.equal(q.duration,120);assert.equal(q.count,n);
 });
 assert.equal(T.privateQuote('2','120').total,160);
});
test('invalid private requests and custom durations still require a quote',()=>{
 for(const count of [0,-1,1.5,NaN,Infinity,'',null,'bad'])assert.equal(T.privateQuote(count,60),null);
 for(const duration of ['other',0,30,75,150,180,NaN,Infinity])assert.equal(T.privateQuote(2,duration),null);
});
test('transport success alone never confirms acceptance',()=>{
 for(const body of [null,{}, {success:false},{success:'false'},{success:1},{success:'yes'}])assert.equal(T.accepted({ok:true},body),false);
 assert.equal(T.accepted({ok:false},{success:true}),false);assert(T.accepted({ok:true},{success:true}));assert(T.accepted({ok:true},{success:'true'}));
});
test('coach aliases preserve old links without trusting arbitrary names',()=>{assert.equal(T.coachId('Valentino Dinglis'),'valentinos');assert.equal(T.coachId('Evan Lycos'),'evan');assert.equal(T.coachId('<script>'),'');assert.equal(T.coachId('__proto__'),'');});
