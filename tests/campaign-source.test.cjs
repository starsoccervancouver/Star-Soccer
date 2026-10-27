const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const C=require('../campaign-source.js');
const now=1793134800000;
const clock=()=>now;
const stored=(values,patch={})=>JSON.stringify({version:1,capturedAt:now,values,...patch});
function memory(raw) {
  const values=new Map(raw===undefined?[]:[[C.storageKey,raw]]);
  return {values,getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
}
const payload=campaign=>Object.fromEntries(campaign.append(new FormData()));

test('campaign slugs use the entire explicit 1–60 character ASCII allowlist',()=>{
  for(const value of ['a','Google','winter-camps_2026','0','x'.repeat(60)])assert.equal(C.slug(value),value);
  for(const value of ['',null,4,'x'.repeat(61),'google.com','parent@example.com','https://example.com','John Smith',' lead','trail ','a+b','a/b','a%20b','a\n','a\r','a\t','café','足球'])assert.equal(C.slug(value),null,String(value));
});

test('only the three explicit campaign parameters are read; invalid or duplicate tags reject the whole group',()=>{
  assert.deepEqual(C.parseSearch('?utm_source=google&utm_medium=organic&utm_campaign=winter_2026&email=parent%40example.com&name=Child&sessionId=friday'),{present:true,values:{utm_source:'google',utm_medium:'organic',utm_campaign:'winter_2026'}});
  assert.deepEqual(C.parseSearch('?email=parent%40example.com&name=Child&utm_term=football'),{present:false,values:null});
  for(const query of ['?utm_source=','?utm_source=valid&utm_campaign=','?utm_source=valid&utm_medium=bad.value','?utm_source=valid&utm_source=valid','?utm_source=valid&utm_source=parent%40example.com','?utm_source=hello+there','?utm_source=hello%20there','?utm_source=%2Fpath','?utm_campaign=hello%0A'])assert.deepEqual(C.parseSearch(query),{present:true,values:null},query);
});

test('per-tab storage contains only approved campaign values, version and capture time and carries them on untagged pages',()=>{
  const storage=memory();
  C.create('?utm_source=school&utm_medium=flyer&utm_campaign=winter&name=Child&email=parent%40example.com&url=https%3A%2F%2Fexample.com',storage,clock);
  assert.deepEqual([...storage.values.keys()],[C.storageKey]);
  const raw=storage.getItem(C.storageKey);
  assert.deepEqual(JSON.parse(raw),{version:1,capturedAt:now,values:{utm_source:'school',utm_medium:'flyer',utm_campaign:'winter'}});
  assert.doesNotMatch(raw,/Child|parent|example|https|email|name/);
  assert.deepEqual(payload(C.create('?sessionId=friday',storage,clock)),{'Campaign source (URL tag)':'school','Campaign medium (URL tag)':'flyer','Campaign name (URL tag)':'winter'});
});

test('new campaign context replaces the previous group and never inherits missing fields',()=>{
  const storage=memory(stored({utm_source:'old',utm_medium:'old',utm_campaign:'old'}));
  const next=C.create('?utm_campaign=new-camp',storage,clock);
  assert.deepEqual(payload(next),{'Campaign name (URL tag)':'new-camp'});
  assert.deepEqual(JSON.parse(storage.getItem(C.storageKey)).values,{utm_campaign:'new-camp'});
  assert.deepEqual(payload(C.create('',storage,clock)),{'Campaign name (URL tag)':'new-camp'});
});

test('an invalid incoming campaign clears old context instead of falling back to it',()=>{
  const storage=memory(stored({utm_source:'old',utm_campaign:'old'}));
  assert.deepEqual(payload(C.create('?utm_source=valid&utm_campaign=parent%40example.com',storage,clock)),{});
  assert.equal(storage.getItem(C.storageKey),null);
  assert.deepEqual(payload(C.create('',storage,clock)),{});
});

test('stored campaign context is rejected when malformed, stale, from the future or carrying unexpected properties',()=>{
  assert.deepEqual(C.readStored(stored({utm_source:'google'}),now).values,{utm_source:'google'});
  const invalid=[null,'','{',JSON.stringify([]),stored({}),stored({utm_source:'parent@example.com'}),stored({utm_source:'google',email:'private'}),stored({utm_source:123}),stored({utm_source:'google'},{version:2}),stored({utm_source:'google'},{capturedAt:'yesterday'}),stored({utm_source:'google'},{capturedAt:now+1}),stored({utm_source:'google'},{capturedAt:now-C.maxAge}),stored({utm_source:'google'},{capturedAt:now-C.maxAge-1}),stored({utm_source:'google'},{capturedAt:-1}),stored({utm_source:'google'},{url:'https://private.example/'}),'x'.repeat(1001)];
  for(const raw of invalid) {
    assert.equal(C.readStored(raw,now),null,String(raw));
    const storage=memory(raw);
    assert.deepEqual(payload(C.create('',storage,clock)),{});
    if(raw)assert.equal(storage.getItem(C.storageKey),null);
  }
});

test('storage read, write and removal denial never blocks form payloads or revives an invalid incoming group',()=>{
  const denied={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');},removeItem(){throw new Error('denied');}};
  assert.deepEqual(payload(C.create('?utm_source=flyer',denied,clock)),{'Campaign source (URL tag)':'flyer'});
  assert.deepEqual(payload(C.create('',denied,clock)),{});
  const oldButCannotClear={getItem:()=>stored({utm_source:'old'}),setItem(){throw new Error('denied');},removeItem(){throw new Error('denied');}};
  assert.deepEqual(payload(C.create('?utm_source=bad.value',oldButCannotClear,clock)),{});
  const writableRemoval=memory(stored({utm_source:'old'}));
  writableRemoval.setItem=()=>{throw new Error('write denied');};
  assert.deepEqual(payload(C.create('?utm_campaign=new',writableRemoval,clock)),{'Campaign name (URL tag)':'new'});
  assert.equal(writableRemoval.getItem(C.storageKey),null);
});

test('appending owns only campaign fields, preserves self-reported referral and form entries, and is idempotent',()=>{
  const data=new FormData();
  data.set('email','parent@example.invalid');data.set('Referral source','Family / friend');data.set('Player name','Test Player');data.set('_subject','Request');
  data.append('Campaign source (URL tag)','untrusted');data.append('Campaign source (URL tag)','duplicate');data.set('Campaign medium (URL tag)','stale');
  const campaign=C.create('?utm_source=school&utm_campaign=autumn',null,clock);
  assert.equal(campaign.append(data),data);campaign.append(data);
  assert.deepEqual(data.getAll('Campaign source (URL tag)'),['school']);
  assert.equal(data.has('Campaign medium (URL tag)'),false);
  assert.deepEqual(Object.fromEntries(data),{email:'parent@example.invalid','Referral source':'Family / friend','Player name':'Test Player',_subject:'Request','Campaign source (URL tag)':'school','Campaign name (URL tag)':'autumn'});
  C.append(data,{utm_source:'not.valid'});
  assert.equal(data.has('Campaign source (URL tag)'),false);
  assert.equal(data.get('Referral source'),'Family / friend');
});

test('an overnight-open document stops emitting campaign context at the 24-hour expiry',()=>{
  let time=now;
  const storage=memory(),campaign=C.create('?utm_source=school',storage,()=>time);
  time=now+C.maxAge-1;assert.equal(payload(campaign)['Campaign source (URL tag)'],'school');
  time=now+C.maxAge;assert.deepEqual(payload(campaign),{});assert.equal(storage.getItem(C.storageKey),null);
});

test('browser initialization survives a denied sessionStorage getter without reading referrers or making requests',()=>{
  let requests=0;
  const window={location:{search:'?utm_source=school&email=parent%40example.com'},fetch(){requests++;}};
  Object.defineProperty(window,'sessionStorage',{get(){throw new Error('getter denied');}});
  Object.defineProperty(window,'document',{get(){throw new Error('must not read document/referrer');}});
  vm.runInNewContext(fs.readFileSync(require.resolve('../campaign-source.js'),'utf8'),{window,URLSearchParams});
  assert.deepEqual(Object.fromEntries(window.StarCampaignSource.append(new FormData())),{'Campaign source (URL tag)':'school'});
  assert.equal(requests,0);
});
