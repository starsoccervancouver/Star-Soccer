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
test('explicit legacy attendance helper preserves historical Calendar recovery without sending',()=>{
  assert.equal(E.legacyAttendanceInquiry,E.attendanceInquiry);
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
test('new branded confirmations avoid Calendar and keep pass attendance confirmed through registration',()=>{
  const m=E.registrationConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Player');
  assert.match(m.body,/Thank you/);assert.match(m.body,/\$30 CAD/);
  assert.match(m.html,/email-star-soccer-logo\.png/);assert.match(m.html,/email-autumn-field\.jpg/);
  assert.doesNotMatch(m.html,/Coming to training\?|RSVP in Google Calendar|attendance invitation|Calendar/);assert.doesNotMatch(m.body,/Attendance:\n/);
  const now=new Date('2026-10-27T03:00:00Z');
  const next=E.passConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Player',now);
  assert.match(next.body,/e-transfer/);assert.doesNotMatch(next.body,/START|Calendar|attendance invitation|Choose Yes/);
  const future=E.passConfirmation('wednesday','2026-11-04','SS-ABCDEF12','Player',now);
  assert.doesNotMatch(future.html,/Coming to training/);assert.doesNotMatch(future.body,/Attendance:\n|Choose Yes|Calendar|attendance invitation/);
});

test('camp confirmation uses the winter brand and keeps the package details',()=>{
  const C=require('../winter-camps.js'),q=C.quote({week:'boxing',kind:'week',slot:'pm',age:8},new Date('2026-10-27T03:00:00Z'));
  const m=E.campConfirmation(q,'SS-CAMP-EXAMPLE123','Player');
  assert.match(m.html,/WINTER CAMPS/);assert.match(m.body,/Winter Camp — Week 2|\$185 CAD/);assert.doesNotMatch(m.html,/subject=Re|body=YES/);
  assert.match(m.html,/email-winter-field\.jpg/);assert.match(m.body,/registration confirms every package date/);assert.doesNotMatch(m.body,/Calendar|attendance invitation|RSVP/);
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

test('full-day confirmations preserve the authoritative catalog total in both HTML and plain text',()=>{
 const C=require('../winter-camps.js'),now=new Date('2026-10-28T19:00:00Z');
 for(const [week,kind,dates] of [
  ['christmas','week',undefined],['boxing','week',undefined],
  ['christmas','dropin',['2026-12-21']],['boxing','dropin',['2026-12-28','2027-01-01']],
  ['christmas','dropin',['2026-12-25']]
 ]){
  const q=C.quote({week,kind,slot:'both',dates,age:8},now),m=E.campConfirmation(q,'SS-CAMP-FULLDAY01','Alex','Jordan');
  const total=q.price;assert.equal(q.lunch,true);
  for(const content of [m.body,m.html]){assert.ok(content.includes('$'+total+' CAD'));assert.ok(content.includes('Alex'));assert.ok(content.includes('Bring a packed lunch'));assert.doesNotMatch(content,/per player|pay twice|another payment/);}
  if(total===0)assert.doesNotMatch(m.body,/You can pay|transfer notes/);
 }
});

const attendanceOrigin='https://attendance.starsoccer.ca';
function attendanceDraftArgs(){
 const token='A'.repeat(43),out='B'.repeat(43);
 return {parentName:'Jordan',players:[{playerId:'fictional-alex',name:'Alex',yesUrl:attendanceOrigin+'/respond#token='+token+'&answer=yes',noUrl:attendanceOrigin+'/respond#token='+token+'&answer=no',optOutUrl:attendanceOrigin+'/respond#token='+out+'&action=optout'}],session:{id:'fictional-wednesday-2026-11-04',label:'Wednesday training',date:'2026-11-04',time:'3:45–5:15 PM',location:'Connaught Park',startAt:'2026-11-04T22:45:00.000Z',endAt:'2026-11-05T00:15:00.000Z'},reference:'SS-RSVP-EXAMPLE123',appOrigin:attendanceOrigin,mode:'draft'};
}
test('private attendance draft is personalized with explicit confirmation links and no Calendar or payment request',()=>{
 const args=attendanceDraftArgs(),m=E.weeklyAttendanceDraft(args);
 assert.equal(m.draftOnly,true);assert.match(m.body,/^Hi Jordan,/);assert.match(m.body,/Can Alex join us/);
 assert.match(m.body,/Wed, Nov 4, 2026/);assert.match(m.body,/Connaught Park/);
 for(const value of ['Yes, attending','Can’t make it','confirm your choice on the page','change your answer before the session starts','No login is needed','Stop weekly attendance emails for Alex'])assert.ok(m.body.includes(value),value);
 assert.match(m.html,/href="https:\/\/attendance\.starsoccer\.ca\/respond#token=/);
 assert.doesNotMatch(m.body,/Calendar|RSVP Yes|e-transfer|payment|\$|marked present/);
 assert.doesNotMatch(m.html,/<script|onload=|fetch\(/i);
 assert.ok(!m.body.includes('fictional-alex'));assert.ok(!m.html.includes('fictional-alex'));
 assert.equal(E.weeklyAttendanceDraft({...args,parentName:null}).body.startsWith('Hi Alex’s family,'),true);
 assert.throws(()=>E.weeklyAttendanceDraft({...args,mode:'send'}),/draft-only/);
});
test('each sibling has independent response links, escaped names and an opt-out for their own check-ins',()=>{
 const args=attendanceDraftArgs(),first=args.players[0],token='C'.repeat(43),out='D'.repeat(43);
 args.parentName='<Jordan & Co>';args.players[0].name='<Alex & Co>';
 args.players.push({playerId:'fictional-robin',name:'Robin',yesUrl:attendanceOrigin+'/respond#token='+token+'&answer=yes',noUrl:attendanceOrigin+'/respond#token='+token+'&answer=no',optOutUrl:attendanceOrigin+'/respond#token='+out+'&action=optout'});
 const m=E.weeklyAttendanceDraft(args);
 assert.match(m.html,/&lt;Jordan &amp; Co&gt;/);assert.match(m.html,/&lt;Alex &amp; Co&gt;/);assert.ok(!m.html.includes('<Alex'));
 for(const p of args.players){assert.ok(m.body.includes(p.yesUrl));assert.ok(m.body.includes(p.noUrl));assert.ok(m.body.includes(p.optOutUrl));}
 assert.match(m.body,/Stop weekly attendance emails for Robin/);
 assert.throws(()=>E.weeklyAttendanceDraft({...args,players:[first,{...args.players[1],playerId:first.playerId}]}),/distinct actual player/);
 assert.throws(()=>E.weeklyAttendanceDraft({...args,players:[first,{...args.players[1],yesUrl:first.yesUrl,noUrl:first.noUrl}]}),/own session response token/);
  assert.throws(()=>E.weeklyAttendanceDraft({...args,players:[first,{...args.players[1],optOutUrl:first.optOutUrl}]}),/separate scoped opt-out/);
});
test('attendance drafts reject unapproved origins, header injection, malformed actions and ambiguous tokens',()=>{
 const args=attendanceDraftArgs(),p=args.players[0];
 for(const origin of ['https://evil.invalid','https://attendance.starsoccer.ca.evil.invalid','http://attendance.starsoccer.ca','https://attendance.starsoccer.ca/path','https://user@attendance.starsoccer.ca','http://127.0.0.1:8788'])assert.throws(()=>E.weeklyAttendanceDraft({...args,appOrigin:origin}));
 for(const yesUrl of [p.yesUrl.replace('https:','http:'),p.yesUrl.replace('/respond','/redirect'),p.yesUrl.replace('#token=','?token='),p.yesUrl+'&extra=1',p.yesUrl+'&token='+'A'.repeat(43),p.noUrl,p.yesUrl.replace('A'.repeat(43),'short'),p.yesUrl.replace('attendance.starsoccer.ca','evil.invalid')])assert.throws(()=>E.weeklyAttendanceDraft({...args,players:[{...p,yesUrl}]}));
 assert.throws(()=>E.weeklyAttendanceDraft({...args,players:[{...p,noUrl:p.noUrl.replace('A'.repeat(43),'C'.repeat(43))}]}),/one session response token/);
 assert.throws(()=>E.weeklyAttendanceDraft({...args,players:[{...p,optOutUrl:p.yesUrl}]}));
 assert.throws(()=>E.weeklyAttendanceDraft({...args,players:[{...p,name:'Alex\nBcc: hidden'}]}));
 assert.throws(()=>E.weeklyAttendanceDraft({...args,session:{...args.session,label:'Wednesday\nBcc: hidden'}}));
 assert.throws(()=>E.weeklyAttendanceDraft({...args,session:{...args.session,date:'2026-02-30'}}));
 assert.throws(()=>E.weeklyAttendanceDraft({...args,session:{...args.session,endAt:args.session.startAt}}));
 assert.throws(()=>E.weeklyAttendanceDraft({...args,session:{...args.session,startAt:'2026-11-04'}}));
 assert.throws(()=>E.weeklyAttendanceDraft({...args,session:{...args.session,startAt:'2026-02-30T22:45:00Z'}}));
});
test('loopback-only attendance previews require explicit demo mode and preserve scoped links',()=>{
 const args=attendanceDraftArgs(),origin='http://127.0.0.1:8788';
 args.demo=true;args.appOrigin=origin;args.players=args.players.map(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,typeof v==='string'?v.replace(attendanceOrigin,origin):v])));
 const draft=E.weeklyAttendanceDraft(args);assert.equal(draft.draftOnly,true);assert.ok(draft.body.includes(origin+'/respond#token='));
 assert.throws(()=>E.weeklyAttendanceDraft({...args,demo:false}));
 assert.throws(()=>E.weeklyAttendanceDraft({...args,appOrigin:'http://192.168.1.10:8788'}));
});
