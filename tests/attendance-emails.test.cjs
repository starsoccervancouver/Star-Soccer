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
test('attendance email contains date, location, YES/NO replies and no payment demand',()=>{
  const m=E.attendanceInquiry('wednesday','2026-10-28',['Example Player'],ref);
  for(const text of ['Wed, Oct 28, 2026','3:45–5:15 PM','Connaught Park','Reply YES','or NO',ref])assert.ok(m.body.includes(text),text);
  assert.match(m.html,/YES, coming/);assert.match(m.html,/Buttons open an email reply/);
  assert.doesNotMatch(m.body,/e-transfer|payment|paid|Present/);
  assert.doesNotMatch(m.html,/https?:\/\/|<script|<img/);
  assert.equal(E.reminderKey('recABCDEFGHIJKLMN','wednesday','2026-10-28'),ref);
  assert.notEqual(E.reminderKey('recABCDEFGHIJKLMN','wednesday','2026-11-04'),ref);
});
test('email buttons draft an exact YES/NO only to the business, with the message reference',()=>{
  const html=E.attendanceInquiry('wednesday','2026-10-28',['Player'],ref).html;
  const links=[...html.matchAll(/href="([^"]+)"/g)].map(m=>m[1].replaceAll('&amp;','&')).filter(s=>s.includes('subject='));
  assert.equal(links.length,2);
  for(const [i,link] of links.entries()){
    const u=new URL(link);assert.equal(u.protocol,'mailto:');assert.equal(u.pathname,'starsoccervancouver@gmail.com');
    assert.ok(u.searchParams.get('subject').includes(ref));assert.equal(u.searchParams.get('body'),['YES','NO'][i]);
  }
});
test('siblings get explicit all-child choices and independently parsed answers',()=>{
  const m=E.attendanceInquiry('friday','2026-10-30',['Child One','Child Two'],ref);
  assert.match(m.body,/if everyone is coming/);assert.match(m.body,/Child One: YES or NO/);
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
test('registration confirmation includes attendance; a future pass omits the immediate attendance inquiry',()=>{
  const m=E.registrationConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Player');
  assert.match(m.body,/Thank you for registering/);assert.match(m.html,/YES, coming/);
  const now=new Date('2026-10-27T03:00:00Z');
  const next=E.passConfirmation('wednesday','2026-10-28','SS-ABCDEF12','Player',now);
  assert.match(next.html,/YES, coming/);assert.match(next.body,/e-transfer/);
  const future=E.passConfirmation('wednesday','2026-11-04','SS-ABCDEF12','Player',now);
  assert.doesNotMatch(future.html,/YES, coming/);assert.doesNotMatch(future.body,/Reply YES/);
});
