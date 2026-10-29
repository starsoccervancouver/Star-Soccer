const {test}=require('node:test');
const assert=require('node:assert/strict');
const E=require('../ops/attendance-emails.cjs');
const ref=E.reminderKey('recABCDEFGHIJKLMN','wednesday','2026-10-28');
// Resolve test instants by named zone: timezone databases may change future offsets.
function vancouver(date,hour,minute){
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for(let h=0;h<36;h++){
    const instant=new Date(Date.parse(date+'T00:00:00Z')+h*3600000+minute*60000),p=Object.fromEntries(fmt.formatToParts(instant).map(p=>[p.type,p.value]));
    if(`${p.year}-${p.month}-${p.day}`===date&&Number(p.hour)===hour&&Number(p.minute)===minute)return instant;
  }
  throw new Error('Local test instant not found');
}
test('attendance email contains date, location, Calendar RSVP and no payment demand',()=>{
  const m=E.attendanceInquiry('wednesday','2026-10-28',['Example Player'],ref);
  for(const text of ['Wed, Oct 28, 2026','3:45–5:15 PM','Connaught Park','Google Calendar invitation',ref])assert.ok(m.body.includes(text),text);
  assert.match(m.html,/RSVP in your Calendar invitation/);assert.doesNotMatch(m.html,/body=YES|body=NO|Tap Send/);
  assert.doesNotMatch(m.body,/e-transfer|payment|paid|Present/);
  assert.doesNotMatch(m.html,/https?:\/\/|<script|<img/);
  assert.equal(E.reminderKey('recABCDEFGHIJKLMN','wednesday','2026-10-28'),ref);
  assert.notEqual(E.reminderKey('recABCDEFGHIJKLMN','wednesday','2026-11-04'),ref);
});
test('RSVP button uses only an actual Calendar event URL and never opens a YES/NO email',()=>{
  const url='https://www.google.com/calendar/event?eid=EXAMPLE';
  const m=E.attendanceInquiry('wednesday','2026-10-28',['Player'],ref,url);
  assert.ok(m.html.includes('href="'+url+'"'));assert.ok(m.body.includes(url));
  assert.doesNotMatch(m.html,/subject=Re|body=YES|body=NO/);
  for(const url of ['https://evil.invalid/calendar/event?eid=x','javascript:alert(1)','https://www.google.com/search?eid=x','http://calendar.google.com/calendar/event?eid=x'])assert.throws(()=>E.approvedCalendarUrl(url));
});
test('siblings get explicit all-child choices and independently parsed answers',()=>{
  const m=E.attendanceInquiry('friday','2026-10-30',['Child One','Child Two'],ref);
  assert.match(m.body,/Choose Maybe/);assert.match(m.body,/Child One, Child Two/);
  assert.deepEqual(E.parseReply('Child One: YES\nChild Two: NO\n\n> quoted mail',['Child One','Child Two']),[{name:'Child One',answer:'Yes'},{name:'Child Two',answer:'No'}]);
  assert.deepEqual(E.parseReply('YES',['Child One','Child Two']),[{name:'Child One',answer:'Yes'},{name:'Child Two',answer:'Yes'}]);
  assert.deepEqual(E.parseReply('Child One: NO',['Child One','Child Two']),[{name:'Child One',answer:'No'}]);
  for(const body of ['YES\nbut not Child Two','Maybe','Unknown: YES','Child One: YES\nChild One: NO','> YES'])assert.equal(E.parseReply(body,['Child One','Child Two']),null);
});
test('templates escape names and reject ambiguous names, wrong dates and reference injection',()=>{
  const m=E.attendanceInquiry('wednesday','2026-10-28',['<Player & Co>'],ref);
  assert.ok(m.html.includes('&lt;Player &amp; Co&gt;'));assert.ok(!m.html.includes('<Player'));
  assert.throws(()=>E.attendanceInquiry('wednesday','2026-10-29',['Player'],ref));
  assert.throws(()=>E.attendanceInquiry('wednesday','2026-10-28',['Player','player'],ref));
  assert.throws(()=>E.attendanceInquiry('wednesday','2026-10-28',['Player'],ref+'\nBcc: x'));
});
test('reminders open at 9am Vancouver two days before, catch up before training, and stop when it starts',()=>{
  assert.equal(E.reminderDue('wednesday','2026-10-28',new Date('2026-10-26T15:59:00Z')),false);
  assert.equal(E.reminderDue('wednesday','2026-10-28',new Date('2026-10-26T16:00:00Z')),true);
  assert.equal(E.reminderDue('wednesday','2026-10-28',new Date('2026-10-28T22:44:00Z')),true);
  assert.equal(E.reminderDue('wednesday','2026-10-28',new Date('2026-10-28T22:45:00Z')),false);
  assert.equal(E.reminderDue('wednesday','2026-11-11',vancouver('2026-11-09',8,59)),false);
  assert.equal(E.reminderDue('wednesday','2026-11-11',vancouver('2026-11-09',9,0)),true);
});
test('branded confirmation ends with a separate attendance invitation note and future passes defer the inquiry',()=>{
  const m=E.registrationConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Player');
  assert.match(m.body,/Thank you/);assert.match(m.html,/Calendar attendance invitation/);assert.match(m.body,/\$30 CAD/);
  assert.match(m.html,/email-star-soccer-logo\.png/);assert.match(m.html,/email-autumn-field\.jpg/);assert.match(m.html,/Your attendance invitation is coming/);
  assert.doesNotMatch(m.html,/Coming to training\?|RSVP in Google Calendar/);assert.doesNotMatch(m.body,/Attendance:\n/);
  const now=new Date('2026-10-27T03:00:00Z');
  const next=E.passConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Player',now);
  assert.match(next.html,/Calendar attendance invitation/);assert.match(next.body,/e-transfer/);assert.doesNotMatch(next.body,/START/);
  const future=E.passConfirmation('wednesday','2026-11-04','SS-ABCDEF12','Player',now);
  assert.doesNotMatch(future.html,/Coming to training/);assert.doesNotMatch(future.body,/Attendance:\n|Choose Yes/);assert.match(future.body,/No attendance response is needed now/);
});

test('camp confirmation uses the winter brand and keeps the package details',()=>{
  const C=require('../winter-camps.js'),q=C.quote({week:'boxing',kind:'week',slot:'pm',age:8},new Date('2026-10-27T03:00:00Z'));
  const m=E.campConfirmation(q,'SS-CAMP-EXAMPLE123','Player');
  assert.match(m.html,/WINTER CAMPS/);assert.match(m.body,/Winter Camp — Week 2|\$185 CAD/);assert.doesNotMatch(m.html,/subject=Re|body=YES/);
  assert.match(m.html,/email-winter-field\.jpg/);assert.match(m.body,/Before camp starts/);
});
test('camp drop-in confirmation personalizes only the chosen dates and exact total',()=>{
 const C=require('../winter-camps.js'),q=C.quote({week:'christmas',kind:'dropin',slot:'am',dates:['2026-12-21','2026-12-25'],age:8},new Date('2026-10-27T03:00:00Z'));
 const m=E.campConfirmation(q,'SS-CAMP-EXAMPLE123','Example Player','Example Parent');
 assert.match(m.body,/^Hi Example Parent,/);assert.match(m.body,/Thank you for registering Example Player/);
 assert.match(m.body,/selected camp days come to \$60 CAD/);assert.match(m.body,/only your selected dates/);
 assert.doesNotMatch(m.body,/Dec 22|every package date|Boxing Week Sale/);
});
test('confirmations address the known guardian and child without inventing a missing parent name',()=>{
 const now=new Date('2026-10-26T19:00:00Z'),C=require('../winter-camps.js');
 const drop=E.registrationConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Example Player','Example Parent');
 const pass=E.passConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Example Player',now,false,'Example Parent');
 const camp=E.campConfirmation(C.quote({week:'boxing',kind:'week',slot:'pm',age:8},now),'SS-CAMP-EXAMPLE123','Example Player','Example Parent');
 for(const m of [drop,pass,camp]){assert.match(m.body,/^Hi Example Parent,/);assert.match(m.body,/Thank you for registering Example Player/);}
 assert.match(E.registrationConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Example Player').body,/^Hi Example Player’s family,/);
 assert.throws(()=>E.registrationConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Example Player','Parent\nBcc: x'));
});
test('payment thank-you requires verified receipt, preserves cents and personalizes every listed player',()=>{
 const args={parentName:'Example Parent',players:['Player One','Player Two'],amountCents:9750,reference:'SS-PAY-EXAMPLE123',confirmedReceived:true};
 const m=E.paymentThankYou(args);
 assert.match(m.body,/^Hi Example Parent,/);assert.match(m.body,/Player One and Player Two/);assert.match(m.body,/\$97\.50 CAD/);assert.match(m.html,/email-star-soccer-logo/);
 assert.doesNotMatch(m.body,/fully paid|balance|^Received:|attendance invitation/im);
 for(const bad of [{confirmedReceived:false},{amountCents:97.5},{amountCents:0},{reference:'bad'},{receivedDate:'2026-02-30'},{players:['Player','player']}])assert.throws(()=>E.paymentThankYou({...args,...bad}));
 const escaped=E.paymentThankYou({...args,parentName:'<Parent & Co>'});assert.match(escaped.html,/&lt;Parent &amp; Co&gt;/);assert.ok(!escaped.html.includes('<Parent'));
});
