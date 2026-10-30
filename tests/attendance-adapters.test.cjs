const {test}=require('node:test');
const assert=require('node:assert/strict');
const clone=value=>JSON.parse(JSON.stringify(value));
const ids={baseId:'app'+'B'.repeat(14),tableId:'tbl'+'T'.repeat(14),attendanceId:'rec'+'A'.repeat(14),playerId:'rec'+'P'.repeat(14),sessionId:'rec'+'S'.repeat(14)};
const fields={rsvpStatus:'fld'+'R'.repeat(14),rsvpUpdatedAt:'fld'+'U'.repeat(14),rsvpNotes:'fld'+'N'.repeat(14),player:'fld'+'P'.repeat(14),session:'fld'+'S'.repeat(14)};
const clock=()=>new Date('2026-10-28T22:00:00Z');
const approval={ownerApproved:true,scope:'attendance-rsvp-only',baseId:ids.baseId,tableId:ids.tableId,approvedAt:'2026-10-28T21:00:00Z',expiresAt:'2026-10-29T21:00:00Z',handoffEvidence:'FICTIONAL TEST: exclusive handoff verified'};
const event=(version=1,response='yes')=>({eventId:'demo_event_'+version,playerId:ids.playerId,sessionId:ids.sessionId,attendanceId:ids.attendanceId,response,version,timestamp:'2026-10-28T21:59:00Z',source:'custom-email-rsvp'});
function mockRemote({failAfterPatch=false,alterReadback=false}={}){
 let record={id:ids.attendanceId,fields:{[fields.player]:[ids.playerId],[fields.session]:[ids.sessionId],[fields.rsvpNotes]:'Coach-entered RSVP context',physical_attendance:'Not marked',booking_status:'Accepted'}};
 let patched=false,failed=false;const calls=[];
 return {calls,get record(){return clone(record);},set record(value){record=clone(value);},fetchFn:async(url,options)=>{
  calls.push({url,method:options.method,body:options.body&&JSON.parse(options.body)});
  if(options.method==='PATCH'){Object.assign(record.fields,JSON.parse(options.body).fields);patched=true;if(failAfterPatch&&!failed){failed=true;throw new Error('simulated provider timeout after commit');}}
  const result=clone(record);if(alterReadback&&patched&&options.method==='GET')result.fields[fields.rsvpStatus]='No';
  return {ok:true,json:async()=>result};
 }};
}
async function adapter(options={}){const {createAirtableAdapter}=await import('../private-attendance/airtable-adapter.mjs');return createAirtableAdapter({baseId:ids.baseId,tableId:ids.tableId,fields,clock,...options});}

test('Airtable projection defaults to dry-run and makes no requests or writes',async()=>{
 const remote=mockRemote(),a=await adapter({fetchFn:remote.fetchFn});const result=await a.deliver(event());
 assert.equal(result.status,'dry-run');assert.equal(result.writesAllowed,false);assert.equal(remote.calls.length,0);
 assert.deepEqual(result.permittedWriteFields,[fields.rsvpStatus,fields.rsvpUpdatedAt,fields.rsvpNotes]);
});
test('live projection requires scoped owner approval and exclusive writer evidence',async()=>{
 const remote=mockRemote();
 for(const change of [{approval:null},{exclusiveWriter:false},{approval:{...approval,baseId:'app'+'X'.repeat(14)}},{approval:{...approval,expiresAt:'2026-10-28T21:30:00Z'}},{approval:{...approval,handoffEvidence:''}}]){
  const a=await adapter({dryRun:false,token:'test-only-not-a-credential',fetchFn:remote.fetchFn,approval,exclusiveWriter:true,...change});
  await assert.rejects(a.deliver(event()),{code:'live_mirror_not_approved'});
 }assert.equal(remote.calls.length,0);
});
test('projection writes only RSVP fields, preserves human notes and verifies record identity and readback',async()=>{
 const remote=mockRemote(),a=await adapter({dryRun:false,token:'test-only-not-a-credential',fetchFn:remote.fetchFn,approval,exclusiveWriter:true});
 const result=await a.deliver(event());assert.equal(result.status,'delivered');assert.equal(result.readbackVersion,1);
 assert.deepEqual(remote.calls.map(c=>c.method),['GET','PATCH','GET']);
 assert.deepEqual(Object.keys(remote.calls[1].body.fields).sort(),[fields.rsvpStatus,fields.rsvpUpdatedAt,fields.rsvpNotes].sort());
 assert.equal(remote.record.fields.physical_attendance,'Not marked');assert.equal(remote.record.fields.booking_status,'Accepted');
 assert.ok(remote.record.fields[fields.rsvpNotes].startsWith('Coach-entered RSVP context'));
 assert.ok(remote.calls.every(c=>c.url.startsWith('https://api.airtable.com/v0/'+ids.baseId+'/'+ids.tableId+'/'+ids.attendanceId+'?')));
});
test('uncertain completed writes are recovered by readback without a duplicate PATCH',async()=>{
 const remote=mockRemote({failAfterPatch:true}),a=await adapter({dryRun:false,token:'test-only-not-a-credential',fetchFn:remote.fetchFn,approval,exclusiveWriter:true});
 await assert.rejects(a.deliver(event()),{code:'airtable_write_uncertain',uncertain:true});
 const result=await a.deliver(event());assert.equal(result.recovered,true);assert.equal(remote.calls.filter(c=>c.method==='PATCH').length,1);
});
test('changed responses mirror monotonically and an older concurrent event cannot overwrite a newer response',async()=>{
 const remote=mockRemote(),a=await adapter({dryRun:false,token:'test-only-not-a-credential',fetchFn:remote.fetchFn,approval,exclusiveWriter:true});
 const [newer,older]=await Promise.all([a.deliver(event(2,'no')),a.deliver(event(1,'yes'))]);
 assert.equal(newer.status,'delivered');assert.equal(older.status,'superseded');assert.equal(older.readbackVersion,2);
 assert.equal(remote.record.fields[fields.rsvpStatus],'No');assert.equal(remote.calls.filter(c=>c.method==='PATCH').length,1);
});
test('same-version conflicting events and mismatched player/session links require review',async()=>{
 const remote=mockRemote(),a=await adapter({dryRun:false,token:'test-only-not-a-credential',fetchFn:remote.fetchFn,approval,exclusiveWriter:true});
 await a.deliver(event());await assert.rejects(a.deliver({...event(),eventId:'demo_conflicting_event'}),{code:'remote_version_conflict'});
 const wrong=remote.record;wrong.fields[fields.player]=['rec'+'X'.repeat(14)];remote.record=wrong;
 await assert.rejects(a.deliver(event(2)),{code:'airtable_identity_mismatch'});
});
test('failed readback is never acknowledged as delivered',async()=>{
 const remote=mockRemote({alterReadback:true}),a=await adapter({dryRun:false,token:'test-only-not-a-credential',fetchFn:remote.fetchFn,approval,exclusiveWriter:true});
 await assert.rejects(a.deliver(event()),{code:'airtable_readback_mismatch',uncertain:true});
});
test('mirror refuses arbitrary fields, raw tokens, unknown responses and invalid versions',async()=>{
 const a=await adapter();
 for(const patch of [{token:'secret-token'},{response:'Present'},{version:0},{eventId:undefined},{timestamp:'not-a-date'},{source:'calendar'}])await assert.rejects(a.deliver({...event(),...patch}),{code:'invalid_mirror_event'});
 const {createAirtableAdapter}=await import('../private-attendance/airtable-adapter.mjs');
 assert.throws(()=>createAirtableAdapter({baseId:ids.baseId,tableId:ids.tableId,fields:{...fields,physicalAttendance:'fld'+'X'.repeat(14)}}),{code:'invalid_field_mapping'});
});

test('outbox runner never acknowledges a dry-run or uncertain projection as delivered',async()=>{
 const {projectOutbox,MirrorError}=await import('../private-attendance/airtable-adapter.mjs');const acknowledged=[],failures=[];
 const service={listOutbox:()=>[{payload:event()}],markOutboxDelivered:r=>acknowledged.push(r),recordOutboxFailure:r=>failures.push(r)};
 const dry=await projectOutbox({service,adapter:await adapter()});assert.equal(dry.results[0].status,'dry-run');assert.equal(acknowledged.length,0);
 const uncertain=await projectOutbox({service,adapter:{dryRun:false,deliver:async()=>{throw new MirrorError('airtable_write_uncertain',{uncertain:true});}}});
 assert.equal(uncertain.results[0].status,'pending');assert.deepEqual(failures,[{eventId:event().eventId,code:'AIRTABLE_WRITE_UNCERTAIN'}]);assert.equal(acknowledged.length,0);
 const success=await projectOutbox({service,adapter:{dryRun:false,deliver:async()=>({status:'delivered',readbackVersion:1})}});
 assert.equal(success.results[0].status,'delivered');assert.deepEqual(acknowledged,[{eventId:event().eventId,readbackVersion:1}]);
});

function migrationInput(){return {
 observedAt:'2026-10-28T22:00:00Z',snapshotId:'demo_migration',revision:1,
 sessions:[{id:'demo_session',date:'2026-10-30',label:'Fictional Friday training',startAt:'2026-10-30T16:00:00-07:00',endAt:'2026-10-30T17:00:00-07:00',location:'Fictional field',capacity:20,status:'scheduled',ownerExpected:1}],
 players:[{id:'demo_player',name:'Example Player',familyId:'demo_family',status:'active'}],
 families:[{id:'demo_family',guardianName:'Example Parent',emailVerified:true,reminderPreference:'enabled'}],
 bookings:[{id:'demo_booking',playerId:'demo_player',familyId:'demo_family',status:'accepted',kind:'dropin',coveredSessionIds:['demo_session']}],
 enrollments:[],attendance:[{id:'demo_attendance',playerId:'demo_player',sessionId:'demo_session',bookingId:'demo_booking',coverageState:'active'}]
};}
test('migration is a read-only candidate report preserving legacy Attendance IDs and physical attendance',async()=>{
 const {planMigration}=await import('../private-attendance/migration.mjs'),input=migrationInput(),before=clone(input),report=planMigration(input);
 assert.deepEqual(input,before);assert.equal(report.remoteWrites,0);assert.equal(report.readOnly,true);assert.equal(report.readyForOwnerReview,true);
 assert.deepEqual(report.preserveAttendanceIds,['demo_attendance']);assert.deepEqual(report.legacyCoverageKeyIds,['demo_attendance']);
 assert.equal(report.physicalAttendancePreserved,true);assert.equal(report.candidateSnapshot.source,'airtable-candidate');assert.equal(report.candidateSnapshot.approved,false);assert.equal(report.candidateSnapshot.complete,false);
 assert.equal(report.candidateSnapshot.sessions[0].entries[0].attendanceId,'demo_attendance');
});
test('migration does not infer verified contacts or recurring reminders from registration or marketing consent',async()=>{
 const {planMigration}=await import('../private-attendance/migration.mjs'),input=migrationInput();
 input.families[0]={id:'demo_family',marketingConsent:true,calendarApproved:true};const report=planMigration(input),p=report.candidateSnapshot.sessions[0].entries[0];
 assert.equal(p.emailVerified,false);assert.equal(p.reminderPreference,'unknown');assert.ok(report.warnings.some(w=>w.code==='contact_or_reminder_preference_hold'));
});
test('pass and camp candidates remain registration-confirmed and never subscribe to weekly enquiries',async()=>{
 const {planMigration}=await import('../private-attendance/migration.mjs');
 for(const kind of ['pass','camp']){const input=migrationInput();input.bookings[0].kind=kind;const entry=planMigration(input).candidateSnapshot.sessions[0].entries[0];assert.equal(entry.kind,kind);assert.equal(entry.reminderPreference,'disabled');}
});
test('legacy rows without booking links need an exact approved active enrollment, not a guessed match',async()=>{
 const {planMigration}=await import('../private-attendance/migration.mjs'),input=migrationInput();
 delete input.attendance[0].bookingId;input.attendance[0].enrollmentId='demo_enrollment';
 input.enrollments=[{id:'demo_enrollment',playerId:'demo_player',familyId:'demo_family',status:'active',approved:true,kind:'dropin',sessionIds:['demo_session']}];
 assert.equal(planMigration(input).readyForOwnerReview,true);input.enrollments[0].approved=false;
 assert.ok(planMigration(input).blockingIssues.some(x=>x.code==='unverified_approved_coverage'));
});
test('duplicate identities and coverage keys block migration without deleting the original rows',async()=>{
 const {planMigration}=await import('../private-attendance/migration.mjs'),input=migrationInput();
 input.attendance[0].sourceCoverageKey='demo_source';input.attendance.push({...input.attendance[0],id:'demo_attendance_duplicate'});
 const report=planMigration(input);assert.equal(report.readyForOwnerReview,false);assert.equal(report.preserveAttendanceIds.length,2);
 assert.ok(report.blockingIssues.some(x=>x.code==='duplicate_player_session_requires_review'));assert.ok(report.blockingIssues.some(x=>x.code==='duplicate_source_coverage_key'));
});
test('wrong family, cancelled booking, unknown coverage and over-capacity sessions fail migration review',async()=>{
 const {planMigration}=await import('../private-attendance/migration.mjs');
 for(const mutate of [x=>x.bookings[0].familyId='demo_other',x=>x.bookings[0].status='cancelled',x=>x.attendance[0].coverageState='unknown',x=>x.sessions[0].capacity=21,x=>x.sessions[0].ownerExpected=21,x=>x.players[0].name=123,x=>x.families[0].guardianName='Parent\nBcc: attacker']){
  const input=migrationInput();mutate(input);assert.equal(planMigration(input).readyForOwnerReview,false);
 }
});
test('booking date coverage is bound to the authoritative linked session date, never the row’s claimed date',async()=>{
 const {planMigration}=await import('../private-attendance/migration.mjs'),input=migrationInput();
 delete input.bookings[0].coveredSessionIds;input.bookings[0].coveredDates=['2026-10-28'];input.attendance[0].sessionDate='2026-10-28';
 let report=planMigration(input);assert.equal(report.readyForOwnerReview,false);assert.ok(report.blockingIssues.some(x=>x.code==='coverage_session_date_conflict'));
 input.attendance[0].sessionDate='2026-10-30';report=planMigration(input);assert.ok(report.blockingIssues.some(x=>x.code==='unverified_approved_coverage'));
 input.bookings[0].coveredDates=['2026-10-30'];assert.equal(planMigration(input).readyForOwnerReview,true);
 input.bookings[0].coveredSessionIds=['demo_session'];input.attendance[0].sessionDate='2026-10-28';assert.ok(planMigration(input).blockingIssues.some(x=>x.code==='coverage_session_date_conflict'));
});
test('migration and mirror event validation reject impossible calendar dates and normalized 24:00 instants',async()=>{
 const {planMigration}=await import('../private-attendance/migration.mjs');
 for(const value of ['2026-02-30T22:00:00Z','2026-10-28T24:00:00Z','2026-10-28T22:99:00Z']){
  assert.throws(()=>planMigration({...migrationInput(),observedAt:value}));
  await assert.rejects((await adapter()).deliver({...event(),timestamp:value}),{code:'invalid_mirror_event'});
 }
 const input=migrationInput();input.sessions[0].date='2026-02-30';assert.equal(planMigration(input).readyForOwnerReview,false);
});
test('Cloudflare scaffold cannot be activated by environment flags and performs no storage writes',async()=>{
 const {default:worker,AttendanceCoordinator}=await import('../private-attendance/cloudflare/worker.mjs');let writes=0;
 const response=await worker.fetch(new Request('https://example.invalid/respond'),{ATTENDANCE_MODE:'live',LIVE_AIRTABLE_WRITES:'true'});assert.equal(response.status,503);
 const coordinator=new AttendanceCoordinator({storage:{sql:{exec(){writes++;return {toArray:()=>[]};}},transactionSync:fn=>fn()}},{});
 assert.equal((await coordinator.fetch(new Request('https://example.invalid/respond'))).status,503);assert.equal(writes,0);
});
