const test=require('node:test'),assert=require('node:assert/strict');
const service=require('../form-service.js');
test('Formspree endpoints use a form ID, never a browser identity or arbitrary destination',()=>{
  assert.equal(service.endpoint({action:'https://formspree.io/f/testform'}),'https://formspree.io/f/testform');
  for(const action of ['', 'https://formspree.io/parent@example.invalid','https://evil.example/f/testform','https://formspree.io/f/testform?email=other@example.invalid','https://formspree.io/f/CONFIGURE_ME','https://formspree.io/f/testform#other'])assert.throws(()=>service.endpoint({action}));
});
test('wire payload preserves the entered email and intake fields without legacy delivery controls',()=>{
  const source=new FormData();for(const [key,value] of Object.entries({email:' entered@example.invalid ','Player name':'Alex','Client reference':'SS-TEST','Covered dates':'2026-11-06, 2026-11-13',_subject:'Star Soccer pass registration',_replyto:'wrong@example.invalid',_captcha:'false',_template:'table',_url:'https://starsoccer.ca/registration.html',_honey:'',_cc:'wrong@example.invalid',_autoresponse:'Do not send'}))source.set(key,value);
  const data=service.payload(source);assert.equal(data.get('email'),'entered@example.invalid');assert.equal(data.getAll('email').length,1);assert.equal(data.get('subject'),'Star Soccer pass registration');assert.equal(data.get('Client reference'),'SS-TEST');assert.equal(data.get('Covered dates'),'2026-11-06, 2026-11-13');assert.equal(data.get('Submission page'),'https://starsoccer.ca/registration.html');assert.equal(data.get('_gotcha'),'');assert.equal([...data.keys()].filter(key=>key.startsWith('_')).join(','),'_gotcha');assert.equal(source.get('_replyto'),'wrong@example.invalid');
});
test('acceptance requires documented JSON success; server errors and timeouts stay uncertain',()=>{
  const response=status=>({ok:status>=200&&status<300,status});
  assert.deepEqual(service.normalize(response(200),{next:'https://formspree.io/thanks',ok:true}),{success:true});
  for(const body of [null,[],{}, {ok:true}, {success:true}, {errors:[{message:'Rejected'}],next:'https://formspree.io/thanks'}])assert.notEqual(service.normalize(response(200),body).success,true);
  for(const status of [200,400,422,429])assert.equal(service.normalize(response(status),{errors:[{message:'Rejected'}]}).success,false);
  for(const status of [408,500,503])assert.equal(service.normalize(response(status),{errors:[{message:'Unknown'}]}).success,null);
  assert.equal(service.normalize(response(429),{next:'https://formspree.io/thanks'}).success,null);
});
