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
test('hourly prices cover private 1–5 and small group 6–18',()=>{
 const counts=[1,2,3,4,5,6,7,10,18],expected=[65,55,45,40,35,30,30,30,30];
 counts.forEach((n,i)=>{const q=T.privateQuote(n,60);assert.equal(q.perPlayer,expected[i]);assert.equal(q.total,expected[i]*n);});
});
test('payment directions use full names in transfer notes with no reference-code request',()=>{
 const one=T.paymentInstructions(),many=T.paymentInstructions(2);
 assert.match(one,/e-transfer to starsoccervancouver@gmail.com/);
 assert.match(one,/arrange payment with your coach on the day/);
 assert.match(one,/player’s full name in the transfer notes/);
 assert.match(many,/players’ full names in the transfer notes/);
 assert.doesNotMatch(one,/reference|session date|No payment|Already paid|follow up/);
 for(const value of [0,-1,1.5,NaN])assert.throws(()=>T.paymentInstructions(value));
});
test('90-minute prices apply the hourly rate without rounding away revenue',()=>{
 const counts=[1,2,3,4,5,6,7,10,18],expected=[97.5,82.5,67.5,60,52.5,45,45,45,45];
 counts.forEach((n,i)=>{const q=T.privateQuote(n,90);assert.equal(q.perPlayer,expected[i]);assert.equal(q.total,expected[i]*n);});
});
test('two-hour prices preserve the hourly return',()=>{
 const counts=[1,2,3,4,5,6,7,10,18],expected=[130,110,90,80,70,60,60,60,60];
 counts.forEach((n,i)=>{
  const q=T.privateQuote(n,120);
  assert.equal(q.perPlayer,expected[i]);
  assert.equal(q.perPlayer,q.base*2);
  assert.equal(q.total,expected[i]*n);
  assert.equal(q.duration,120);assert.equal(q.count,n);
 });
 assert.equal(T.privateQuote('2','120').total,220);
});
test('format boundaries and increasing headcount cannot lower total revenue',()=>{
 for(const duration of [60,90,120]){
  let previous=0;
  for(let n=1;n<=18;n++){
   const q=T.privateQuote(n,duration);
   assert.equal(q.format,n<=5?'private':'smallgroup');
   assert(q.total>previous);previous=q.total;
   assert.equal(q.total/(duration/60),T.privateQuote(n,60).total);
  }
 }
});
test('invalid private requests and custom durations still require a quote',()=>{
 for(const count of [0,-1,1.5,19,100,NaN,Infinity,'',null,'bad'])assert.equal(T.privateQuote(count,60),null);
 for(const duration of ['other',0,30,75,150,180,NaN,Infinity])assert.equal(T.privateQuote(2,duration),null);
});
test('transport success alone never confirms acceptance',()=>{
 for(const body of [null,{}, {success:false},{success:'false'},{success:1},{success:'yes'}])assert.equal(T.accepted({ok:true},body),false);
 assert.equal(T.accepted({ok:false},{success:true}),false);assert(T.accepted({ok:true},{success:true}));assert(T.accepted({ok:true},{success:'true'}));
});
test('coach aliases preserve old links without trusting arbitrary names',()=>{assert.equal(T.coachId('Valentino Dinglis'),'valentinos');assert.equal(T.coachId('Evan Lycos'),'evan');assert.equal(T.coachId('<script>'),'');assert.equal(T.coachId('__proto__'),'');});

test('session sharing uses approved groups and a clean public destination',()=>{
 for(const s of T.catalog.sessions)assert.equal(T.sessionLink(s.id),'https://starsoccer.ca/programs.html?day='+s.id+'#sessions');
 for(const id of ['camp-u4-u6','__proto__','friday&email=private@example.invalid'])assert.throws(()=>T.sessionLink(id));
});

test('referral source accepts only optional parent-reported choices',()=>{
 assert.equal(T.referralSource('referral'),'Family / friend');
 assert.equal(T.referralSource('instagram'),'Instagram');
 for(const value of ['',null,undefined,'__proto__','private@example.invalid','<script>'])assert.equal(T.referralSource(value),'Not specified');
});

test('registration recovery includes public booking context without personal form values or payment confirmation',()=>{
 const b=T.booking('wednesday','pass4','2026-10-21',10,now);
 b.playerName='Private Player';b.email='private@example.invalid';b.notes='Private notes';
 const url=new URL(T.registrationHelp(b,'SS-TEST'));
 assert.equal(url.protocol,'mailto:');assert.equal(url.pathname,T.catalog.email);
 const body=url.searchParams.get('body');
 for(const expected of ['SS-TEST','Oct 21','Oct 28','Nov 4','Nov 11','$95 CAD','not confirmed','Please check whether my registration arrived.'])assert(body.includes(expected),expected);
 for(const privateValue of [b.playerName,b.email,b.notes])assert(!body.includes(privateValue));
 assert(!body.includes('Registration confirmed'));
});

test('saved booking details keep dates, total and payment destination together without personal form data',()=>{
 const receipt={reference:'SS-TEST',sessionName:'Wednesday · 3:45–5:15 PM',dates:['2026-10-21','2026-10-28','2026-11-04','2026-11-11'],location:'Connaught Park',label:'Four-session pass',price:95,email:'private@example.invalid',playerName:'Private Test Name'};
 const text=T.receiptText(receipt);
 for(const expected of ['SS-TEST','Oct 21','Oct 28','Nov 4','Nov 11','$95 CAD','starsoccervancouver@gmail.com','Your place is confirmed by the coaching team','player’s full name in the transfer notes','arrange payment with your coach on the day'])assert(text.includes(expected),expected);
 assert.doesNotMatch(text,/pay twice|pay again|another payment|already paid|Include .+reference/i);
 assert(!text.includes('cash'));
 assert(!text.includes(receipt.email));assert(!text.includes(receipt.playerName));
});
