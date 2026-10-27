const {test}=require('node:test');
const assert=require('node:assert/strict');
const W=require('../weekly-signup.js');
const values={name:' Test Player ',email:'parent@example.invalid',age:'10',experience:'new'};
test('weekly sign-up needs only four essentials and has no chosen date or payment',()=>{
  const r=W.request('wednesday','dropin',values);
  assert.equal(r.name,'Test Player');assert.equal(r.experience,'New to soccer');
  assert.equal(r.version,'SS-WEEKLY-V2');assert.ok(!('date' in r));assert.ok(!('price' in r));
  assert.equal(W.request('wednesday','pass4',values).type,'pass4');
  assert.equal(W.request('wednesday','pass4',values).version,'SS-PASS-V1');
});
test('pass defaults to upcoming training and ends on the fourth occurrence, across month and year boundaries',()=>{
  const now=new Date('2026-10-27T03:00:00Z');
  assert.deepEqual(W.passPlan('wednesday',null,now),{sessionId:'wednesday',price:95,start:'2026-10-28',end:'2026-11-18',dates:['2026-10-28','2026-11-04','2026-11-11','2026-11-18'],upcoming:true});
  const later=W.passPlan('friday','2026-12-18',now);
  assert.equal(later.end,'2027-01-08');assert.equal(later.price,80);assert.equal(later.upcoming,false);
  assert.throws(()=>W.passPlan('friday','2026-12-17',now));
  assert.throws(()=>W.passPlan('friday','2026-10-23',now));
});
test('pass email confirms price, four dates, payment, thanks and a structured start-change reply',()=>{
  const now=new Date('2026-10-27T03:00:00Z');
  const mail=W.passConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Test Player',now);
  for(const text of ['$95 CAD','Wed, Oct 28, 2026','Wed, Nov 18, 2026','4th session','Reply START YYYY-MM-DD','e-transfer','starsoccervancouver@gmail.com','Thank you','Reply YES','does not confirm that payment has been received'])assert.ok(mail.body.includes(text),text);
  const future=W.passConfirmation('wednesday','2026-11-04','SS-ABCDEF12','Test Player',now,true);
  assert.match(future.subject,/start updated/);assert.doesNotMatch(future.body,/Reply YES|Will Test Player join/);
});
test('start changes accept only an explicit unambiguous first-line command and valid ISO date',()=>{
  assert.equal(W.startChange('START 2026-11-04\n\n> quoted message'),'2026-11-04');
  for(const text of ['Maybe November 4','START 2026-02-30','YES\nSTART 2026-11-04','> START 2026-11-04','START 2026-11-04 or 2026-11-11'])assert.equal(W.startChange(text),null);
});
test('invalid session, age, experience, blank name and header injection cannot be registered',()=>{
  for(const [session,v] of [['old',values],['wednesday',{...values,age:'8'}],['wednesday',{...values,name:' '}],['wednesday',{...values,experience:'pro'}],['wednesday',{...values,email:'parent@example.invalid\nBcc: other@example.invalid'}],['wednesday',{...values,email:'a@example.invalid,b@example.invalid'}]])assert.throws(()=>W.request(session,'dropin',v));
});
test('confirmation requests next-week attendance without charging or claiming actual attendance',()=>{
  const mail=W.confirmation('wednesday','2026-10-28','SS-ABCDEF12','Test Player');
  assert.match(mail.subject,/registration confirmed/);assert.match(mail.body,/Wed, Oct 28, 2026/);
  assert.match(mail.body,/Reply YES/);assert.match(mail.body,/or NO/);assert.match(mail.body,/No payment is needed/);
  assert.match(mail.body,/next session only/);assert.doesNotMatch(mail.body,/paid|marked present|every Wednesday/);
  assert.throws(()=>W.confirmation('wednesday','2026-10-29','SS-ABCDEF12','Player'));
  assert.throws(()=>W.confirmation('wednesday','2026-10-28','SS-ABCDEF12','Player\nBCC:bad'));
});
test('RSVP parses clear first-line YES and NO only, without acting on quoted or ambiguous answers',()=>{
  assert.equal(W.rsvp('YES\n\nOn Monday someone wrote:\nNO'),'Yes');
  assert.equal(W.rsvp(' No! '),'No');
  for(const body of ['Maybe','Yes, but not this week','> YES','Thanks\nNO','NO for John, YES for Sam',''])assert.equal(W.rsvp(body),null);
});
test('camp confirmation covers the right package and defers payment follow-up',()=>{
  const C=require('../winter-camps.js');
  const q=C.quote({week:'boxing',kind:'week',slot:'both',age:8},new Date('2026-10-27T03:00:00Z'));
  const mail=C.confirmation(q,'SS-CAMP-ABCDEF12','Test Player');
  assert.match(mail.body,/\$370 CAD/);assert.match(mail.body,/Jan 1, 2027/);
  assert.match(mail.body,/Supervised lunch/);assert.match(mail.body,/No payment is needed/);
  assert.match(mail.body,/Boxing Week Sale/);
  assert.throws(()=>C.confirmation(q,'SS-CAMP-ABCDEF12','Bad\nName'));
});
