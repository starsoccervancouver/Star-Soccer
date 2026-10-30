const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const club={name:'Fictional Field Club',siteUrl:'https://club.example.test/',timeZone:'Europe/London',trainingDays:[2,6],accent:'#c9e4d7'};

test('public club config accepts only presentation fields and rejects unsafe input',async()=>{
  const {validateClubConfig}=await import('../private-attendance/club-config.mjs');
  const c=validateClubConfig(club);assert(Object.isFrozen(c));assert(Object.isFrozen(c.trainingDays));
  for(const bad of [{capacity:999},{ownerEmail:'owner@example.test'},{name:'<script>alert(1)</script>'},{siteUrl:'javascript:alert(1)'},{siteUrl:'https://user:pass@example.test/'},{siteUrl:'https://club.example.test/#token'},{siteUrl:'http://club.example.test/'},{siteUrl:'https://club.example.test/?redirect=other'},{timeZone:'Not/AZone'},{trainingDays:[3,3]},{trainingDays:[8]},{accent:'#000000'},{accent:'#fff;url(https://example.test)'}])assert.throws(()=>validateClubConfig({...club,...bad}));
});

test('branding uses immutable data, text setters and validated URL without HTML interpolation',async()=>{
  const {clubConfigScript}=await import('../private-attendance/club-config.mjs');
  const name={},link={},logo={},style={};const document={querySelectorAll:s=>s==='[data-club-name]'?[name]:s==='a[data-club-site]'?[link]:[logo],documentElement:{style:{setProperty:(key,value)=>style[key]=value}}};const window={};
  vm.runInNewContext(clubConfigScript(club),{window,document});
  assert.equal(name.textContent,club.name);assert.equal(link.href,club.siteUrl);assert.equal(logo.alt,club.name);assert.equal(document.title,'Coach Desk | '+club.name);assert.equal(style['--desk-gold'],club.accent);assert(Object.isFrozen(window.CoachClub));assert(Object.isFrozen(window.CoachClub.trainingDays));assert.equal(name.innerHTML,undefined);
});

test('separate deployment requires a valid HTTPS origin and explicit owner, defaults preserve existing service',async()=>{
  const {deploymentIdentity,validateWorkspaceOrigin}=await import('../private-attendance/deployment-config.mjs');
  assert.deepEqual(deploymentIdentity(),{origin:'https://attendance.starsoccer.ca',ownerEmail:'starsoccervancouver@gmail.com',ownerName:'Star Soccer Owner'});
  assert.throws(()=>deploymentIdentity({COACH_ORIGIN:'https://coach.example.test'}),/EXPLICIT_CLUB_OWNER/);
  const c=deploymentIdentity({COACH_ORIGIN:'https://coach.example.test',COACH_OWNER_EMAIL:'OWNER@EXAMPLE.TEST',COACH_OWNER_NAME:'Club Owner'});assert.equal(c.ownerEmail,'owner@example.test');
  for(const value of ['http://coach.example.test','https://u:p@coach.example.test','https://coach.example.test/path','https://coach.example.test/','https://coach.example.test?x=1','https://coach.example.test#x','https://coach.example.test:9999','javascript:alert(1)'])assert.throws(()=>validateWorkspaceOrigin(value));
});

test('new club bootstraps only its configured owner; changing env cannot take over an existing database',async t=>{
  const [{openStore},{createCoachStore,OWNER_EMAIL},{createCoachAuth}]=await Promise.all([import('../private-attendance/sqlite-store.mjs'),import('../private-attendance/coach-store.mjs'),import('../private-attendance/coach-auth.mjs')]);const store=openStore();t.after(()=>store.close());
  const coaches=createCoachStore({store,ownerEmail:'OWNER@EXAMPLE.TEST',ownerName:'Fictional Owner'}),owner=coaches.actor('owner@example.test');assert.equal(owner.role,'owner');assert.throws(()=>coaches.actor(OWNER_EMAIL),/ACCOUNT_NOT_ACTIVE/);assert.equal(coaches.ownerEmail,'owner@example.test');
  assert.throws(()=>createCoachStore({store,ownerEmail:'other@example.test',ownerName:'Other'}),/OWNER_CONFIGURATION_MISMATCH/);assert.equal(store.get('SELECT COUNT(*) AS n FROM coach_users').n,1);
  assert.throws(()=>coaches.saveUser(owner,{email:owner.email,name:'New',role:'coach'}),/INVALID_ACCOUNT_CHANGE/);
  const auth=createCoachAuth({store,coaches,origin:'https://coach.example.test',rpName:club.name+' Coach Desk'}),invite=auth.bootstrapOwner();assert(invite.url.startsWith('https://coach.example.test/workspace#enroll='));
  const registration=await auth.registrationOptions({token:new URL(invite.url).hash.slice(8),browser:'b'.repeat(43)});assert.equal(registration.options.rp.id,'coach.example.test');assert.equal(registration.options.rp.name,club.name+' Coach Desk');
});

test('configured Google redirect is exact in consent and exchange; staff routes remain origin-bound',async t=>{
  const [{openStore},{createCoachStore},{createCoachAuth},{createCoachGoogleAuth},{createCoachHandler}]=await Promise.all([import('../private-attendance/sqlite-store.mjs'),import('../private-attendance/coach-store.mjs'),import('../private-attendance/coach-auth.mjs'),import('../private-attendance/coach-google-auth.mjs'),import('../private-attendance/coach-http.mjs')]);const store=openStore();t.after(()=>store.close());const origin='https://coach.example.test',coaches=createCoachStore({store,ownerEmail:'owner@gmail.com',ownerName:'Fictional Owner'}),auth=createCoachAuth({store,coaches,origin});let exchange;
  const google=createCoachGoogleAuth({store,coaches,auth,origin,clientId:'test.apps.googleusercontent.com',clientSecret:'fictional-test-secret',keyResolver:async()=>{},fetchFn:async(url,request)=>{exchange=new URLSearchParams(request.body);return new Response('{}');}}),flow=google.start({browser:'b'.repeat(43)});
  assert.equal(new URL(flow.url).searchParams.get('redirect_uri'),origin+'/workspace/api/auth/google/callback');await assert.rejects(()=>google.finish({code:'fictional-code',state:flow.state,browser:'b'.repeat(43)}));assert.equal(exchange.get('redirect_uri'),origin+'/workspace/api/auth/google/callback');
  const handler=createCoachHandler({coaches,auth,origin,cookieKey:'k'.repeat(43),overview:async()=>{throw Error('No business reads expected');},assets:{}});
  assert.equal((await handler(new Request(origin+'/workspace/api/desk'))).status,401);assert.equal((await handler(new Request('https://attendance.starsoccer.ca/workspace/api/bootstrap'))).status,404);assert.equal((await handler(new Request(origin+'/workspace/api/bootstrap'))).status,200);
});

test('session UTC conversion follows club timezone while preserving existing Vancouver behavior',async()=>{
  const {sessionInstant,vancouverInstant}=await import('../private-attendance/airtable-roster.mjs');
  assert.equal(sessionInstant('2026-10-29','9:00 am','Europe/London'),'2026-10-29T09:00:00.000Z');assert.equal(sessionInstant('2026-07-01','9:00 am','Europe/London'),'2026-07-01T08:00:00.000Z');assert.equal(vancouverInstant('2026-11-04','9:00 am'),'2026-11-04T16:00:00.000Z');
  assert.throws(()=>sessionInstant('2026-03-29','1:30 am','Europe/London'),/INVALID_SESSION_TIME/);
});

test('source-only export excludes private state and old identity, refuses overwrite, and remains disabled',async t=>{
  const {exportCoachDesk,SOURCE_FILES}=await import('../scripts/export-coach-desk.mjs');const parent=await fs.mkdtemp(path.join(os.tmpdir(),'coach-source-only-'));t.after(async()=>{const resolved=await fs.realpath(parent),temp=await fs.realpath(os.tmpdir());assert.equal(path.dirname(resolved),temp);assert(path.basename(resolved).startsWith('coach-source-only-'));await fs.rm(resolved,{recursive:true,force:true});});const destination=path.join(parent,'fresh-club'),result=await exportCoachDesk({destination,config:club});assert.equal(result.deployable,false);
  const manifest=JSON.parse(await fs.readFile(path.join(destination,'source-manifest.json'),'utf8'));assert.equal(manifest.containsPrivateData,false);assert.equal(manifest.automaticDeployment,false);
  for(const entry of manifest.files){assert(!/(\.wrangler|\.dpapi|\.pending|wrangler\.live|PRODUCTION\.md|(^|\/)data\/|(^|\/)outputs\/|assets\.generated|node_modules)/i.test(entry.path));if(!entry.path.endsWith('.woff2')){const contents=await fs.readFile(path.join(destination,entry.path),'utf8');assert(!contents.includes('starsoccervancouver@gmail.com'),entry.path);assert(!contents.includes('https://attendance.starsoccer.ca'),entry.path);}}
  assert(!SOURCE_FILES.includes('private-attendance/prepare-draft.mjs'));
  const wrangler=await fs.readFile(path.join(destination,'private-attendance/cloudflare/wrangler.club.toml'),'utf8');assert.match(wrangler,/ATTENDANCE_MODE = "disabled"/);assert.match(wrangler,/LIVE_AIRTABLE_WRITES = "false"/);assert(!wrangler.includes('script_name'));assert(!wrangler.includes('account_id'));assert(!wrangler.includes('star-soccer-private-attendance'));
  const deploy=await import(require('node:url').pathToFileURL(path.join(destination,'private-attendance/deployment-config.mjs')).href);assert.throws(()=>deploy.deploymentIdentity(),/EXPLICIT_CLUB_IDENTITY_REQUIRED/);
  const worker=await fs.readFile(path.join(destination,'private-attendance/cloudflare/production-worker.mjs'),'utf8');assert(worker.includes('this.coachOnly=true;'));
  await assert.rejects(()=>exportCoachDesk({destination,config:club}),/DESTINATION_EXISTS/);
  await assert.rejects(()=>exportCoachDesk({destination:path.join(__dirname,'../outputs/forbidden-clone'),config:club}),/OUTSIDE_SOURCE/);
});
