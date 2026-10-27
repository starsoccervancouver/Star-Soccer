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
test('camp attendance invitation covers one actual daily slot without cancelling the package',()=>{
 const p=R.campInvitation('boxing','pm','2026-12-28',['Example Player'],'SS-CAMP-EXAMPLE123');
 assert.equal(p.start_time,'2026-12-28T19:30:00.000Z');assert.equal(p.end_time,'2026-12-28T22:30:00.000Z');assert.equal(p.visibility,'private');assert.ok(!('attendees' in p));
 assert.match(p.description,/Declining does not cancel/);assert.match(p.description,/12:30–3:30 PM/);
 for(const args of [['boxing','both','2026-12-28',['Player'],'SS-CAMP-EXAMPLE123'],['boxing','am','2026-12-27',['Player'],'SS-CAMP-EXAMPLE123'],['boxing','am','2026-12-28',['Player','player'],'SS-CAMP-EXAMPLE123']])assert.throws(()=>R.campInvitation(...args));
});
