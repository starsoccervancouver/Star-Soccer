const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../registration-funnel.js');
test('conversion hooks expose categories without names, contacts, references or URLs',()=>{
  assert.deepEqual(F.event('submission_accepted',{program:'weekly',kind:'dropin',email:'private@example.invalid',name:'Private child',reference:'SS-PRIVATE',url:'/?age=9'}),{event:'submission_accepted',program:'weekly',kind:'dropin'});
  assert.equal(F.event('booking_confirmed',{program:'weekly'}),null);
  assert.equal(F.event('program_view',{program:'child@example.invalid'}),null);
  assert.deepEqual(F.event('registration_start',{program:'camp',kind:'unknown'}),{event:'registration_start',program:'camp'});
});
