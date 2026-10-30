/* Actual production Worker initialization against in-memory SQLite; external fetch is blocked. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');

test('production Worker migrates legacy goals once without changing notes or nesting transactions',async t=>{
 // The test command builds assets before starting parallel tests. Never rewrite
 // their shared generated module while another test process may be importing it.
 const [{durableSqliteStore},{createCoachStore,OWNER_EMAIL},{AttendanceCoordinator}]=await Promise.all([
  import('../private-attendance/cloudflare/storage.mjs'),import('../private-attendance/coach-store.mjs'),import('../private-attendance/cloudflare/production-worker.mjs')
 ]);
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let transactionDepth=0,network=0;
 const storage={
  sql:{exec(query,...params){
   let rows=[],written=0;
   if(!params.length&&query.includes(';'))db.exec(query);
   else{const statement=db.prepare(query);if(statement.columns().length)rows=statement.all(...params);else written=Number(statement.run(...params).changes);}
   return {toArray:()=>rows,rowsWritten:written};
  }},
  transactionSync(fn){
   assert.equal(transactionDepth,0,'Worker initialization must not nest transactions');transactionDepth++;db.exec('BEGIN IMMEDIATE');
   try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}finally{transactionDepth--;}
  }
 };
 const store=durableSqliteStore(storage),coaches=createCoachStore({store});
 coaches.saveNote(coaches.actor(OWNER_EMAIL),{sessionId:'rec00000000000001',body:'Fictional pre-migration goal',category:'Goal'});
 store.run('ALTER TABLE coach_notes DROP COLUMN goal_json');
 const before={...store.all('SELECT * FROM coach_notes')[0]},field=n=>'fld'+String(n).padStart(14,'0');
 const config={baseId:'app00000000000000',tables:Object.fromEntries(['attendance','enrollments','sessions','players','families','bookings','registrations'].map((key,n)=>[key,'tbl'+String(n).padStart(14,'0')])),rsvpFields:{rsvpStatus:field(1),rsvpUpdatedAt:field(2),rsvpNotes:field(3),player:field(4),session:field(5)},preferenceFields:{player:field(6),family:field(7),preference:field(8),updatedAt:field(9)},exclusiveWriter:true,handoffEvidence:'fictional fixture only'};
 const env={ATTENDANCE_MODE:'live',LIVE_EMAIL_SENDS:'false',OWNER_APPROVED:'true',LIVE_AIRTABLE_WRITES:'false',ADMIN_KEY:'a'.repeat(43),COOKIE_KEY:'b'.repeat(43),AIRTABLE_TOKEN:'fictional-only',AIRTABLE_CONFIG:JSON.stringify(config),COACH_DASHBOARD_ENABLED:'true'};
 const originalFetch=globalThis.fetch;globalThis.fetch=()=>{network++;throw Error('External network blocked in migration test');};t.after(()=>{globalThis.fetch=originalFetch;});
 const coordinator=new AttendanceCoordinator({storage},env);
 assert(!store.all('PRAGMA table_info(coach_notes)').some(row=>row.name==='goal_json'),'Constructing the coordinator performs no schema writes');
 const request=()=>new Request('https://attendance.starsoccer.ca/workspace/api/bootstrap');
 const responses=await Promise.all([coordinator.fetch(request()),coordinator.fetch(request())]);
 assert.deepEqual(responses.map(response=>response.status),[200,200],'First requests serialize initialization');
 const {goal_json,...after}=store.all('SELECT * FROM coach_notes')[0];assert.deepEqual(after,before);assert.equal(goal_json,null);
 const recreated=new AttendanceCoordinator({storage},env);assert.equal((await recreated.fetch(request())).status,200);
 assert.equal(store.all('PRAGMA table_info(coach_notes)').filter(row=>row.name==='goal_json').length,1);
 assert.equal(transactionDepth,0);assert.equal(network,0,'Bootstrapping and migrating never request a roster or external service');
});
