const {test}=require('node:test');
const assert=require('node:assert/strict');
const training=require('../training.js');
const offers=require('../private-attendance/weekly-offers.cjs');
const published=require('../program-catalog.json');
test('published terms change the quote without modifying existing terms',async()=>{
  const {weeklyRequest}=await import('../private-attendance/camp-placement.mjs');
  const rows=structuredClone(published.sessions),wed=rows.find(s=>s.id==='wednesday');
  Object.assign(wed,{dropin:31,time:'4:00–5:30 PM',capacity:14,venue:'Kitsilano Turf'});
  const next=offers.applyOffers(training.catalog,rows);
  const event={version:'SS-WEEKLY-V2',sessionId:'wednesday',age:'10',dates:'2026-12-02',received:'2026-11-27T17:00:00Z',option:'Drop-in',quotedPrice:'31'};
  const quote=weeklyRequest(event,next);
  assert.equal(quote.price,31);assert.equal(quote.capacity,14);assert.equal(quote.venue,'Kitsilano Turf');assert.equal(quote.slots[0].time,'4:00–5:30 PM');
  assert.equal(weeklyRequest({...event,quotedPrice:'30'},next),undefined);
  assert.equal(training.getSession('wednesday').dropin,30);
  assert.throws(()=>offers.applyOffers(training.catalog,rows.slice(1)));
  assert.throws(()=>offers.applyOffers(training.catalog,rows.map(s=>({...s,venue:'Unreviewed venue'}))));
  assert.equal(offers.applyOffers(training.catalog,published.sessions).version,published.version);
});
test('only the release workflow can read the validated projection',async()=>{
  const {preview,catalogPath}=await import('../private-attendance/weekly-publication.mjs');
  const request=new Request('https://starsoccer.ca'+catalogPath,{headers:{Authorization:'Bearer demo'}});
  const repo='starsoccervancouver/Star-Soccer';
  const identity={repository:repo,repository_id:'1212934215',ref:'refs/heads/main',workflow_ref:repo+'/.github/workflows/deploy-pages.yml@refs/heads/main',event_name:'schedule'};
  let reads=0;
  const read=async()=>{reads++;return Response.json({records:[]})};
  assert.equal((await preview(request,{},async()=>({payload:{...identity,ref:'refs/heads/other'}}),read)).status,403);
  assert.equal(reads,0);
  assert.equal((await preview(request,{},async()=>({payload:identity}),read)).status,422);
  assert.equal(reads,1);
});
test('a venue move updates the card, home and locations while an unpublished price stays out of quotes',()=>{
  const {artifacts}=require('../scripts/publish-weekly-catalog.cjs');
  const rows=structuredClone(published.sessions);
  for(const row of rows.filter(r=>r.id!=='tuesday'))row.venue='Fen Burdett Stadium';
  rows.find(r=>r.id==='wednesday').dropin=31;
  const candidate=offers.feed(offers.applyOffers(training.catalog,rows));
  const files=artifacts(candidate);
  assert(files['index.html'].includes('Beginners welcome at Fen Burdett Stadium.'));
  assert(files['programs.html'].includes('Our weekly groups train at Fen Burdett Stadium.'));
  assert(files['locations.html'].includes('<strong>Wednesday '+rows[1].time+'</strong>'));
  assert.equal(JSON.parse(files['program-catalog.json']).sessions[1].dropin,31);
  assert.deepEqual(files,artifacts(candidate));
});

test('the November turf move preserves historical terms and checks current dated quotes',async()=>{
  const {weeklyRequest}=await import('../private-attendance/camp-placement.mjs');
  const dropin=(sessionId,dates,received)=>({version:'SS-WEEKLY-V2',option:'Drop-in',sessionId,age:'10',dates,received,quotedPrice:sessionId==='wednesday'?'30':'25'});
  const old=dropin('wednesday','2026-11-25','2026-11-23T17:00:00Z');
  const friday=dropin('friday','2026-11-27','2026-11-26T17:00:00Z');
  const wed=dropin('wednesday','2026-12-02','2026-11-27T17:00:00Z');
  assert.equal(weeklyRequest(old,training.catalog).venue,'Connaught Park');
  assert.equal(weeklyRequest(old).slots[0].time,'3:45–5:15 PM');
  assert.equal(weeklyRequest(friday).venue,'Kitsilano Turf');
  assert.equal(weeklyRequest(wed).slots[0].time,'4:00–5:15 PM');
  assert.equal(weeklyRequest({...old,version:'SS-PASS-V1',option:'Four-session pass',quotedPrice:'95',dates:'2026-11-25, 2026-12-02, 2026-12-09, 2026-12-16'},training.catalog),undefined);
});
