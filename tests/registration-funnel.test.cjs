const test=require('node:test'),assert=require('node:assert/strict');
const F=require('../registration-funnel.js');
test('conversion hooks expose categories without names, contacts, references or URLs',()=>{
  assert.deepEqual(F.event('submission_accepted',{program:'weekly',kind:'dropin',email:'private@example.invalid',name:'Private child',reference:'SS-PRIVATE',url:'/?age=9'}),{event:'submission_accepted',program:'weekly',kind:'dropin'});
  assert.equal(F.event('booking_confirmed',{program:'weekly'}),null);
  assert.equal(F.event('program_view',{program:'child@example.invalid'}),null);
  assert.deepEqual(F.event('registration_start',{program:'camp',kind:'unknown'}),{event:'registration_start',program:'camp'});
});

test('only accepted weekly and camp registrations go to GA4 using category fields',()=>{
  const {readFileSync}=require('node:fs');
  const {runInNewContext}=require('node:vm');
  const calls=[];
  const window={gtag:(...args)=>calls.push(args),dispatchEvent:()=>{}};
  runInNewContext(readFileSync(require.resolve('../registration-funnel.js'),'utf8'),{
    window,document:{readyState:'loading',addEventListener:()=>{}},
    CustomEvent:class {},
  });
  window.StarFunnel.track('program_view',{program:'weekly'});
  window.StarFunnel.track('registration_start',{program:'weekly',kind:'dropin'});
  window.StarFunnel.track('submission_accepted',{program:'contact',kind:'inquiry'});
  window.StarFunnel.track('submission_accepted',{program:'camp',kind:'unknown'});
  assert.equal(calls.length,0);
  window.StarFunnel.track('submission_accepted',{program:'weekly',kind:'pass4',email:'private@example.invalid',reference:'SS-PRIVATE'});
  window.StarFunnel.track('submission_accepted',{program:'camp',kind:'week'});
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[
    ['event','registration_submission_accepted',{send_to:'G-RP4ZF0M5LN',program:'weekly',booking_type:'pass4'}],
    ['event','registration_submission_accepted',{send_to:'G-RP4ZF0M5LN',program:'camp',booking_type:'week'}],
  ]);
  window.gtag=()=>{throw new Error('Analytics unavailable');};
  assert.doesNotThrow(()=>window.StarFunnel.track('submission_accepted',{program:'camp',kind:'dropin'}));
});
