const {test}=require('node:test'),assert=require('node:assert/strict');
const R=require('../ops/calendar-rsvp.cjs');
test('Calendar plan uses the approved private family session with Vancouver times',()=>{
 const p=R.invitation('wednesday','2026-10-28',['Example Player'],'SS-EXAMPLE123');
 assert.equal(p.calendar_id,'starsoccervancouver@gmail.com');assert.equal(p.timezone_str,'America/Vancouver');
 assert.equal(p.start_time,'2026-10-28T22:45:00.000Z');assert.equal(p.end_time,'2026-10-29T00:15:00.000Z');
 assert.equal(p.visibility,'private');assert.equal(p.guests_can_modify,false);assert.equal(p.add_google_meet,false);assert.ok(!('attendees' in p));
 assert.match(p.description,/Example Player/);assert.doesNotMatch(p.title,/Example Player/);assert.match(p.description,/Yes, No or Maybe/);
});
test('Calendar planning validates dates and derives each current group duration',()=>{
 for(const [id,date,minutes] of [['thursday','2026-10-29',60],['friday','2026-10-30',75],['sunday','2026-11-01',90]]){
  const p=R.invitation(id,date,['Player'],'SS-EXAMPLE123');assert.equal((Date.parse(p.end_time)-Date.parse(p.start_time))/60000,minutes);
 }
 assert.throws(()=>R.invitation('wednesday','2026-10-29',['Player'],'SS-EXAMPLE123'));
 assert.throws(()=>R.invitation('old','2026-10-28',['Player'],'SS-EXAMPLE123'));
});
test('native RSVP responses never infer actual attendance',()=>{
 assert.equal(R.response('accepted'),'Yes');assert.equal(R.response('declined'),'No');assert.equal(R.response('tentative'),'Needs clarification');assert.equal(R.response('needsAction'),'Awaiting response');assert.equal(R.response('unknown'),'Needs clarification');
});
test('one Calendar confirmation carries drop-in details and price without a second-email handoff',()=>{
 const p=R.registrationInvitation({kind:'dropin',sessionId:'wednesday',date:'2026-10-28',playerName:'Example Player',reference:'SS-EXAMPLE123',now:new Date('2026-10-26T19:00:00Z')});
 assert.match(p.title,/registration confirmed/);assert.match(p.description,/\$30 CAD/);assert.match(p.description,/Connaught Park/);assert.match(p.description,/Yes, No or Maybe on this invitation/);
 assert.doesNotMatch(p.description,/in your Google Calendar invitation|START |change.*start date/i);assert.ok(!('attendees' in p));
});
test('pass confirmation invites only the actual first session and retains all four dates and payment instructions',()=>{
 const args={kind:'pass4',sessionId:'wednesday',date:'2026-10-28',playerName:'Example Player',reference:'SS-EXAMPLE123',now:new Date('2026-10-26T19:00:00Z')};
 const p=R.registrationInvitation(args);
 assert.match(p.description,/\$95 CAD/);assert.match(p.description,/Nov 18/);assert.match(p.description,/e-transfer/);assert.match(p.description,/declining does not cancel your pass/);assert.ok(!('recurrence' in p));
 const future=R.registrationInvitation({...args,date:'2026-11-04'});
 assert.equal(future.start_time,'2026-11-04T22:45:00.000Z');assert.match(future.description,/No attendance response is needed now/);assert.doesNotMatch(future.description,/Attendance:\n/);
 assert.throws(()=>R.registrationInvitation({...args,date:'2026-10-21'}));
});
test('camp confirmation keeps the full package in one first-session invite and rejects drop-ins',()=>{
 const args={kind:'camp',camp:{week:'boxing',kind:'week',slot:'both'},playerName:'Example Player',reference:'SS-CAMP-EXAMPLE789',now:new Date('2026-10-26T19:00:00Z')};
 const p=R.registrationInvitation(args);
 assert.equal(p.start_time,'2026-12-28T16:00:00.000Z');assert.equal(p.end_time,'2026-12-28T19:00:00.000Z');assert.match(p.description,/\$370 CAD/);assert.match(p.description,/Jan 1/);assert.match(p.description,/12:30/);assert.match(p.description,/first morning session only/);assert.match(p.description,/Boxing Week Sale/);
 assert.throws(()=>R.registrationInvitation({...args,camp:{...args.camp,kind:'dropin'}}));
 assert.throws(()=>R.registrationInvitation({...args,reference:'bad'}));
});
