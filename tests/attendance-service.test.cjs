const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const browser=()=>randomBytes(32).toString('base64url');
const modules=Promise.all([import('../private-attendance/service.mjs'),import('../private-attendance/sqlite-store.mjs')]);
const at='2026-11-02T18:00:00.000Z';
function snapshot(count=3){return {schemaVersion:1,source:'fictional-demo',snapshotId:'demo_snapshot_1',revision:1,observedAt:at,approved:true,complete:true,sessions:[{id:'demo_session',label:'Wednesday training',startAt:'2026-11-04T15:45:00-07:00',endAt:'2026-11-04T17:15:00-07:00',location:'Connaught Park',capacity:20,status:'scheduled',ownerExpected:0,entries:Array.from({length:count},(_,i)=>({playerId:'demo_player_'+i,familyId:'demo_family_'+i,attendanceId:'demo_attendance_'+i,name:'Player '+i,guardianName:'Guardian '+i,emailVerified:true,kind:i===1?'pass':i===2?'camp':'dropin',reserved:true,eligible:true,reminderPreference:'enabled'}))}]};}
async function setup(t,patch={}){const [{createService}, {openStore}]=await modules;const store=openStore();t.after(()=>store.close());let clock=at;const service=createService({store,clock:()=>new Date(clock),...patch});const input=snapshot();service.importRoster(input);return {store,service,input,setClock:x=>clock=x};}
const issue=service=>service.issueInvitation({playerId:'demo_player_0',sessionId:'demo_session'});
function preview(service,inv,answer='yes',csrfSession=browser()){return {...service.preview({token:inv.token,answer,csrfSession}),csrfSession};}
function respond(service,inv,p,answer='yes',idempotencyKey=browser()){return service.respond({token:inv.token,answer,challenge:p.challenge,csrfSession:p.csrfSession,expectedVersion:p.version,idempotencyKey});}
const error=(fn,code)=>assert.throws(fn,e=>e.code===code,code);

test('local-only mode and fictional import gates cannot accept live data',async t=>{
 const [{createService},{openStore}]=await modules;const db=openStore();t.after(()=>db.close());
 error(()=>createService({store:db,mode:'live'}),'LIVE_MODE_NOT_APPROVED');
 error(()=>createService({store:db,origin:'https://attendance.starsoccer.ca'}),'LIVE_MODE_NOT_APPROVED');
 const {service,input}=await setup(t);for(const patch of [{source:'airtable'},{approved:false},{complete:false}])error(()=>service.importRoster({...input,...patch}),patch.source?'FICTIONAL_DATA_ONLY':'ROSTER_NOT_APPROVED');
 const real=structuredClone(input);real.sessions[0].entries[0].playerId='rec12345678901234';error(()=>service.importRoster(real),'FICTIONAL_DATA_ONLY');
 assert.deepEqual(service.health(),{mode:'demo',liveWrites:false,emailSending:false,deploymentApproved:false,storedSessions:1});
});
test('invitation is random, hash-only, purpose-bound and restricted to one approved drop-in session',async t=>{
 const {service,store}=await setup(t),inv=issue(service);assert.match(inv.token,/^[A-Za-z0-9_-]{43}$/);assert.notEqual(inv.token,inv.optOutToken);
 const values=JSON.stringify(store.all('SELECT * FROM invitations'));assert(!values.includes(inv.token));assert(!values.includes(inv.optOutToken));assert.match(values,/[a-f0-9]{64}/);
 error(()=>service.preview({token:inv.optOutToken,answer:'yes',csrfSession:browser()}),'INVALID_INVITATION');
 error(()=>service.preview({token:inv.token,action:'optout',csrfSession:browser()}),'INVALID_INVITATION');
 error(()=>service.preview({token:'a'.repeat(43),answer:'yes',csrfSession:browser()}),'INVALID_INVITATION');
 for(const i of [1,2])error(()=>service.issueInvitation({playerId:'demo_player_'+i,sessionId:'demo_session'}),'REGISTRATION_ALREADY_CONFIRMED');
 error(()=>issue(service),'INVITATION_ALREADY_ISSUED');
});
test('link preview/scanners create no responses, events, outbox entries or preference changes',async t=>{
 const {service,store}=await setup(t),inv=issue(service);
 for(let i=0;i<12;i++)preview(service,inv,i%2?'no':'yes');
 for(const name of ['responses','response_events','outbox','preferences','preference_events'])assert.equal(store.get('SELECT COUNT(*) AS n FROM '+name).n,0,name);
});
test('explicit confirmation records exact identity/time/version but never bookings or physical attendance',async t=>{
 const {service,store}=await setup(t),inv=issue(service),p=preview(service,inv),result=respond(service,inv,p);
 assert.equal(result.response,'yes');assert.equal(result.version,1);assert.equal(result.updatedAt,at);
 const events=store.all('SELECT * FROM response_events');assert.equal(events.length,1);assert.equal(events[0].player_id,'demo_player_0');assert.equal(events[0].session_id,'demo_session');assert.equal(events[0].attendance_id,'demo_attendance_0');assert.equal(events[0].source,'custom-email-rsvp');
 const d=service.dashboard().sessions[0];assert.deepEqual(d.counts,{yes:1,no:0,awaiting:0,registrationConfirmed:2});assert.equal(d.registered,3);assert(d.players.every(p=>p.physicalAttendance==='not-marked'));assert.equal(d.syncPending,1);
});
test('one-use challenge is bound to browser, chosen answer, token and preview version',async t=>{
 const {service}=await setup(t),inv=issue(service),p=preview(service,inv);
 error(()=>respond(service,inv,{...p,csrfSession:browser()}),'INVALID_CONFIRMATION');
 error(()=>respond(service,inv,p,'no'),'INVALID_CONFIRMATION');
 error(()=>respond(service,inv,{...p,version:1}),'INVALID_CONFIRMATION');
 respond(service,inv,p);
 error(()=>respond(service,inv,p),'INVALID_CONFIRMATION');
});
test('transport duplicates return the original result and cannot create duplicate events',async t=>{
 const {service,store}=await setup(t),inv=issue(service),p=preview(service,inv),key=browser();
 const first=respond(service,inv,p,'yes',key),second=respond(service,inv,p,'yes',key);assert.equal(second.duplicate,true);assert.equal(second.version,first.version);assert.equal(second.updatedAt,first.updatedAt);assert.equal(store.get('SELECT COUNT(*) n FROM response_events').n,1);
 error(()=>respond(service,inv,p,'no',key),'IDEMPOTENCY_CONFLICT');
});
test('changed answers preserve full history; same-answer clicks do not advance version/timestamp',async t=>{
 const {service,store,setClock}=await setup(t),inv=issue(service);respond(service,inv,preview(service,inv));
 setClock('2026-11-02T18:01:00Z');const no=respond(service,inv,preview(service,inv,'no'),'no');assert.equal(no.version,2);
 setClock('2026-11-02T18:02:00Z');const again=respond(service,inv,preview(service,inv,'no'),'no');assert.equal(again.version,2);assert.equal(again.noChange,true);assert.equal(again.updatedAt,no.updatedAt);
 const yes=respond(service,inv,preview(service,inv));assert.equal(yes.version,3);
 assert.deepEqual(store.all('SELECT response,previous_response FROM response_events ORDER BY version').map(r=>[r.previous_response,r.response]),[[null,'yes'],['yes','no'],['no','yes']]);
});
test('two browser windows cannot overwrite a newer answer with a stale form',async t=>{
 const {service,store}=await setup(t),inv=issue(service),a=preview(service,inv),b=preview(service,inv,'no');
 respond(service,inv,a);error(()=>respond(service,inv,b,'no'),'RESPONSE_CHANGED');assert.equal(store.get('SELECT response FROM responses').response,'yes');
 assert.equal(respond(service,inv,preview(service,inv,'no'),'no').response,'no');
});
test('delayed retry of an older success acknowledges the current answer rather than a superseded one',async t=>{
 const {service,store}=await setup(t),inv=issue(service),firstPreview=preview(service,inv),key=browser();respond(service,inv,firstPreview,'yes',key);
 respond(service,inv,preview(service,inv,'no'),'no');const retry=respond(service,inv,firstPreview,'yes',key);
 assert.equal(retry.response,'no');assert.equal(retry.version,2);assert.equal(retry.superseded,true);assert.equal(retry.originalVersion,1);assert.equal(store.get('SELECT COUNT(*) n FROM response_events').n,2);
});
test('concurrent duplicate confirmations have one durable outcome',async t=>{
 const {service,store}=await setup(t),inv=issue(service),p=preview(service,inv),key=browser();
 const outcomes=await Promise.all(Array.from({length:24},()=>Promise.resolve().then(()=>respond(service,inv,p,'yes',key))));
 assert.equal(outcomes.filter(r=>!r.duplicate).length,1);assert.equal(store.get('SELECT COUNT(*) n FROM responses').n,1);assert.equal(store.get('SELECT COUNT(*) n FROM outbox').n,1);
});
test('session-start expiry and confirmation expiry are enforced on the server',async t=>{
 const {service,setClock}=await setup(t),inv=issue(service),p=preview(service,inv);
 setClock('2026-11-02T18:10:00Z');error(()=>respond(service,inv,p),'INVALID_CONFIRMATION');
 setClock(inv.expiresAt);error(()=>preview(service,inv),'INVITATION_EXPIRED');
});
test('roster staleness or capacity drift blocks Yes but permits reporting No without releasing places',async t=>{
 const {service,setClock,input}=await setup(t),inv=issue(service),p=preview(service,inv);setClock('2026-11-02T18:16:00Z');error(()=>respond(service,inv,p),'INVALID_CONFIRMATION');
 const fresh=preview(service,inv);error(()=>respond(service,inv,fresh),'ROSTER_STALE');const no=respond(service,inv,preview(service,inv,'no'),'no');assert.equal(no.response,'no');assert.equal(service.dashboard().sessions[0].registered,3);
 input.revision=2;input.observedAt='2026-11-02T18:16:00Z';input.sessions[0].ownerExpected=21;service.importRoster(input);
 const cap=preview(service,inv);error(()=>respond(service,inv,cap),'CAPACITY_REVIEW_REQUIRED');assert.equal(service.dashboard().sessions[0].capacityBlocked,true);
});
test('twenty registered seats include passes/camps; a twenty-first invitation never confirms',async t=>{
 const {service}=await setup(t);const twenty=snapshot(20);twenty.revision=2;service.importRoster(twenty);const inv=issue(service);respond(service,inv,preview(service,inv));assert.equal(service.dashboard().sessions[0].capacityUsed,20);
 const over=snapshot(21);over.revision=3;service.importRoster(over);error(()=>service.issueInvitation({sessionId:'demo_session',playerId:'demo_player_20'}),'CAPACITY_REVIEW_REQUIRED');error(()=>respond(service,inv,preview(service,inv)),'CAPACITY_REVIEW_REQUIRED');
});
test('reissuing rotates tokens; roster removal, cancellation and kind changes invalidate old invitations',async t=>{
 for(const change of ['rotate','remove','cancel','pass']){const {service,input}=await setup(t),inv=issue(service);
  if(change==='rotate')issueWithRotation();else{input.revision=2;if(change==='remove')input.sessions[0].entries.shift();if(change==='cancel')input.sessions[0].status='cancelled';if(change==='pass')input.sessions[0].entries[0].kind='pass';service.importRoster(input);}
  error(()=>preview(service,inv),'INVALID_INVITATION');
  function issueWithRotation(){const other=service.issueInvitation({sessionId:'demo_session',playerId:'demo_player_0',rotate:true});assert.notEqual(other.token,inv.token);}
 }
});
test('opt-out is explicit, purpose-bound, idempotent and does not cancel registration or RSVP',async t=>{
 const {service,store}=await setup(t),inv=issue(service);respond(service,inv,preview(service,inv));const csrfSession=browser();const p=service.preview({token:inv.optOutToken,action:'optout',csrfSession}),key=browser();
 assert.equal(store.get('SELECT COUNT(*) n FROM preferences').n,0);
 const args={token:inv.optOutToken,challenge:p.challenge,csrfSession,idempotencyKey:key};const r=service.optOut(args);assert.equal(r.weeklyEmailsEnabled,false);assert.equal(service.optOut(args).duplicate,true);assert.equal(store.get('SELECT response FROM responses').response,'yes');assert.equal(service.dashboard().sessions[0].registered,3);
 error(()=>service.issueInvitation({playerId:'demo_player_0',sessionId:'demo_session',rotate:true}),'RECURRING_EMAILS_DISABLED');
 assert.equal(respond(service,inv,preview(service,inv,'no'),'no').response,'no');
});
test('missing contacts and unknown recurring-email preference cannot produce reminders',async t=>{
 for(const patch of [{emailVerified:false},{reminderPreference:'unknown'},{reminderPreference:'disabled'}]){const {service,input}=await setup(t);Object.assign(input.sessions[0].entries[0],patch);input.revision=2;service.importRoster(input);error(()=>issue(service),patch.emailVerified===false?'CONTACT_NOT_VERIFIED':'RECURRING_EMAILS_DISABLED');}
});
test('late readers can opt out using a separate expiring preference token after RSVP closes',async t=>{
 const {service,setClock,store}=await setup(t),inv=issue(service);setClock('2026-11-05T18:00:00Z');error(()=>preview(service,inv),'INVITATION_EXPIRED');
 const csrfSession=browser(),p=service.preview({token:inv.optOutToken,action:'optout',csrfSession});assert.equal(service.optOut({token:inv.optOutToken,challenge:p.challenge,csrfSession,idempotencyKey:browser()}).weeklyEmailsEnabled,false);
 assert.equal(store.get('SELECT COUNT(*) n FROM responses').n,0);setClock(inv.optOutExpiresAt);error(()=>service.preview({token:inv.optOutToken,action:'optout',csrfSession}),'INVITATION_EXPIRED');
});

test('session and roster lifecycle updates revoke RSVP without breaking the 30-day opt-out link',async t=>{
 for(const change of ['completed','cancelled','rescheduled','removed','pass','unverified']){
  const {service,input,store,setClock}=await setup(t),inv=issue(service);input.revision=2;
  if(['completed','cancelled'].includes(change))input.sessions[0].status=change;
  else if(change==='rescheduled'){input.sessions[0].startAt='2026-11-04T16:00:00-07:00';input.sessions[0].endAt='2026-11-04T17:30:00-07:00';}
  else if(change==='removed')input.sessions[0].entries.shift();
  else if(change==='pass')input.sessions[0].entries[0].kind='pass';
  else input.sessions[0].entries[0].emailVerified=false;
  service.importRoster(input);error(()=>preview(service,inv),'INVALID_INVITATION');
  const csrfSession=browser(),p=service.preview({token:inv.optOutToken,action:'optout',csrfSession});
  assert.equal(service.optOut({token:inv.optOutToken,challenge:p.challenge,csrfSession,idempotencyKey:browser()}).weeklyEmailsEnabled,false,change);
  assert.equal(store.get('SELECT COUNT(*) n FROM responses').n,0);assert.equal(store.get('SELECT COUNT(*) n FROM preferences').n,1);
  input.revision=3;service.importRoster(input);assert.equal(store.get('SELECT weekly_enabled FROM preferences').weekly_enabled,0);
  setClock(inv.optOutExpiresAt);error(()=>service.preview({token:inv.optOutToken,action:'optout',csrfSession}),'INVITATION_EXPIRED');
 }
});

test('explicit invitation rotation still revokes both the previous RSVP and opt-out capabilities',async t=>{
 const {service}=await setup(t),first=issue(service),next=service.issueInvitation({playerId:'demo_player_0',sessionId:'demo_session',rotate:true});
 error(()=>preview(service,first),'INVALID_INVITATION');
 error(()=>service.preview({token:first.optOutToken,action:'optout',csrfSession:browser()}),'INVALID_INVITATION');
 assert.equal(preview(service,next).currentResponse,null);
 const csrfSession=browser(),p=service.preview({token:next.optOutToken,action:'optout',csrfSession});
 assert.equal(service.optOut({token:next.optOutToken,challenge:p.challenge,csrfSession,idempotencyKey:browser()}).weeklyEmailsEnabled,false);
});

test('a retained opt-out link does not block issuing the replacement RSVP for a rescheduled session',async t=>{
 const {service,input}=await setup(t),first=issue(service);input.revision=2;input.sessions[0].startAt='2026-11-04T16:00:00-07:00';service.importRoster(input);
 const replacement=issue(service);assert.notEqual(replacement.token,first.token);assert.equal(preview(service,replacement).startAt,'2026-11-04T23:00:00.000Z');
 error(()=>service.preview({token:first.optOutToken,action:'optout',csrfSession:browser()}),'INVALID_INVITATION');
 error(()=>issue(service),'INVITATION_ALREADY_ISSUED');
});
test('roster imports reject duplicates, identity changes and stale revisions atomically',async t=>{
 const {service,input}=await setup(t);const dup=structuredClone(input);dup.revision=2;dup.sessions[0].entries.push(dup.sessions[0].entries[0]);error(()=>service.importRoster(dup),'DUPLICATE_PLAYER_SESSION');
 const changed=structuredClone(input);changed.sessions[0].label='Changed';error(()=>service.importRoster(changed),'ROSTER_VERSION_CONFLICT');
 changed.revision=2;changed.sessions[0].entries[0].attendanceId='demo_wrong_attendance';error(()=>service.importRoster(changed),'ROSTER_IDENTITY_CONFLICT');assert.equal(service.dashboard().sessions[0].label,'Wednesday training');assert.equal(service.dashboard().sessions[0].rosterRevision,1);
});
test('impossible dates, times and timezone offsets cannot silently become different sessions',async t=>{
 const {service,input}=await setup(t);
 for(const value of ['2026-02-30T15:45:00Z','2026-11-04T24:45:00Z','2026-11-04T15:60:00Z','2026-11-04T15:45:00+14:30','2026-13-04T15:45:00Z']){const copy=structuredClone(input);copy.revision=2;copy.sessions[0].startAt=value;error(()=>service.importRoster(copy),'INVALID_TIMESTAMP');}
 assert.equal(service.dashboard().sessions[0].startAt,'2026-11-04T22:45:00.000Z');
});
test('response, history, challenge use and mirror event roll back together if durable staging fails',async t=>{
 const [{createService},{openStore}]=await modules;const real=openStore();t.after(()=>real.close());let inject=false;
 const faultStore={...real,run(sql,...args){if(inject&&sql.startsWith('INSERT INTO outbox'))throw new Error('Simulated disk failure');return real.run(sql,...args);}};
 const service=createService({store:faultStore,clock:()=>new Date(at)});service.importRoster(snapshot());const inv=issue(service),p=preview(service,inv);inject=true;
 assert.throws(()=>respond(service,inv,p),/Simulated disk failure/);
 for(const table of ['responses','response_events','outbox','requests'])assert.equal(real.get('SELECT COUNT(*) n FROM '+table).n,0,table);
 assert.equal(real.get('SELECT used FROM challenges').used,0);inject=false;assert.equal(respond(service,inv,p).version,1);
});
test('outbox survives failures and requires versioned readback before marking delivered',async t=>{
 const {service}=await setup(t),inv=issue(service);respond(service,inv,preview(service,inv));const [item]=service.listOutbox();assert.equal(item.payload.attendanceId,'demo_attendance_0');assert.equal(item.payload.response,'yes');
 service.recordOutboxFailure({eventId:item.event_id,code:'AIRTABLE_UNAVAILABLE'});assert.equal(service.listOutbox()[0].attempts,1);
 error(()=>service.markOutboxDelivered({eventId:item.event_id,readbackVersion:0}),'READBACK_REQUIRED');
 service.markOutboxDelivered({eventId:item.event_id,readbackVersion:1});assert.equal(service.listOutbox().length,0);assert.equal(service.dashboard().sessions[0].syncPending,0);
});
test('response history and pending mirror events survive a local SQLite process-store restart',async t=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');const [{createService},{openStore}]=await modules;
 const file=path.join(os.tmpdir(),'star-attendance-fictional-test-'+randomUUID()+'.sqlite');let store;
 t.after(()=>{store?.close();store=null;for(const suffix of ['', '-wal','-shm'])if(fs.existsSync(file+suffix))fs.unlinkSync(file+suffix);});
 store=openStore(file);let service=createService({store,clock:()=>new Date(at)});service.importRoster(snapshot());const inv=issue(service);respond(service,inv,preview(service,inv));store.close();store=null;
 store=openStore(file);service=createService({store,clock:()=>new Date(at)});assert.equal(service.dashboard().sessions[0].counts.yes,1);assert.equal(service.listOutbox().length,1);assert.equal(service.preview({token:inv.token,answer:'no',csrfSession:browser()}).version,1);
 assert(!JSON.stringify(store.all('SELECT * FROM invitations')).includes(inv.token));
});
