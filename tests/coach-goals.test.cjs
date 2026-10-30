/* Goal persistence uses isolated SQLite fixtures and fictional coaches only. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const mods=Promise.all([import('../private-attendance/coach-store.mjs'),import('../private-attendance/sqlite-store.mjs'),import('../private-attendance/coach-auth.mjs'),import('../private-attendance/coach-http.mjs')]);
const rid=n=>'rec'+String(n).padStart(14,'0');
const goal=(extra={})=>({successMeasure:'Receive across the body on 4 of 5 passes',status:'planned',evidence:'',...extra});
const draft=(extra={})=>({sessionId:rid(1),playerId:rid(2),category:'Goal',body:'Improve first touch',reviewDate:'2026-11-05',goal:goal(),...extra});
const edit=(note,extra={})=>({id:note.id,sessionId:note.session_id,playerId:note.player_id,category:note.category,body:note.body,reviewDate:note.review_date,expectedVersion:note.version,...extra});
async function setup(t){
 const [{createCoachStore,OWNER_EMAIL},{openStore},{createCoachAuth},{createCoachHandler}]=await mods,store=openStore();t.after(()=>store.close());
 const coaches=createCoachStore({store}),owner=coaches.actor(OWNER_EMAIL);
 for(const name of ['one','two']){coaches.saveUser(owner,{email:name+'@example.test',name,role:'coach'});coaches.assign(owner,{email:name+'@example.test',sessionId:rid(1),assigned:true});}
 const one=coaches.actor('one@example.test'),two=coaches.actor('two@example.test'),auth=createCoachAuth({store,coaches});
 const h=createCoachHandler({coaches,auth,cookieKey:'k'.repeat(43),assets:{},overview:async()=>({sessions:[{id:rid(1),players:[{playerId:rid(2)}]}]})});
 const post=(actor,payload)=>{const session=auth.createVerifiedSession(actor.email),origin='https://attendance.starsoccer.ca';return h(new Request(origin+'/workspace/api/notes/save',{method:'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-ss_staff='+session.token,'x-csrf-token':session.csrf},body:JSON.stringify(payload)}));};
 return {store,coaches,owner,one,two,post};
}

for(const adapter of ['local','durable'])test('legacy notes migrate additively and repeatedly through the '+adapter+' SQLite adapter',async t=>{
 const [{createCoachStore,OWNER_EMAIL},{openStore}]=await mods;
 let store;
 if(adapter==='local'){store=openStore();t.after(()=>store.close());}
 else{
  const {DatabaseSync}=require('node:sqlite'),{durableSqliteStore}=await import('../private-attendance/cloudflare/storage.mjs'),db=new DatabaseSync(':memory:');t.after(()=>db.close());
  store=durableSqliteStore({sql:{exec(query,...params){let rows=[],written=0;if(!params.length&&query.includes(';'))db.exec(query);else{const statement=db.prepare(query);if(statement.columns().length)rows=statement.all(...params);else written=Number(statement.run(...params).changes);}return {toArray:()=>rows,rowsWritten:written};}},transactionSync(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(error){db.exec('ROLLBACK');throw error;}}});
 }
 store.run("CREATE TABLE coach_users(email TEXT PRIMARY KEY,name TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN('owner','admin','coach')),active INTEGER NOT NULL DEFAULT 1,session_version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL); CREATE TABLE coach_notes(id TEXT PRIMARY KEY,author_email TEXT NOT NULL REFERENCES coach_users(email),player_id TEXT,session_id TEXT,category TEXT NOT NULL,body TEXT NOT NULL,review_date TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,version INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0);");
 store.run('INSERT INTO coach_users(email,name,role,created_at) VALUES(?,?,?,?)',OWNER_EMAIL,'Owner','owner','2026-10-01T00:00:00Z');
 store.run('INSERT INTO coach_notes VALUES(?,?,?,?,?,?,?,?,?,?,?)','note_legacy',OWNER_EMAIL,null,rid(1),'Goal','Existing freeform goal','2026-11-01','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z',7,0);
 const before={...store.get('SELECT * FROM coach_notes WHERE id=?','note_legacy')};
 for(let i=0;i<2;i++){
  const coaches=createCoachStore({store}),owner=coaches.actor(OWNER_EMAIL),{goal:details,...after}=coaches.notes(owner)[0];
  assert.deepEqual(after,before);assert.equal(details,null);assert.equal(store.all('PRAGMA table_info(coach_notes)').filter(row=>row.name==='goal_json').length,1);
 }
 const coaches=createCoachStore({store}),owner=coaches.actor(OWNER_EMAIL),saved=coaches.saveNote(owner,draft());
 assert.deepEqual(coaches.notes(owner,{playerId:rid(2)})[0],saved);assert.equal(saved.goal.status,'planned');
});

test('player goals roundtrip through the existing note API and retain metadata for legacy edits',async t=>{
 const {store,coaches,one,post}=await setup(t),response=await post(one,draft());assert.equal(response.status,200);
 const first=(await response.json()).note;assert.deepEqual(first.goal,{...goal(),drillId:null});assert.equal(first.body,'Improve first touch');assert.equal(first.review_date,'2026-11-05');assert.equal(first.author_email,one.email);assert.equal(first.version,1);assert(!Object.hasOwn(first,'goal_json'));
 const second=coaches.saveNote(one,edit(first,{goal:goal({status:'in-progress',evidence:'Four controlled receives in the passing practice'})}));
 assert.equal(second.goal.status,'in-progress');assert.equal(second.version,2);
 const legacyEdit=coaches.saveNote(one,edit(second,{body:'Improve first touch on both feet'}));assert.deepEqual(legacyEdit.goal,second.goal);
 const [{createCoachStore}]=await mods,reopened=createCoachStore({store});assert.deepEqual(reopened.notes(one,{playerId:rid(2)})[0],legacyEdit);
 const detached=reopened.notes(one)[0];detached.goal.evidence='Changed locally';assert.equal(reopened.notes(one)[0].goal.evidence,second.goal.evidence);
 const achieved=reopened.saveNote(one,edit(legacyEdit,{goal:goal({status:'achieved',evidence:'Five successful receives in the session'})}));assert.equal(achieved.goal.status,'achieved');
 const cleared=reopened.saveNote(one,edit(achieved,{goal:null}));assert.equal(cleared.goal,null);
 const restored=reopened.saveNote(one,edit(cleared,{goal:{}}));assert.deepEqual(restored.goal,{successMeasure:'',status:'planned',evidence:'',drillId:null});
 assert.equal(reopened.saveNote(one,edit(restored,{category:'Technical'})).goal,null);
 assert.equal(reopened.saveNote(one,draft({playerId:null,goal:undefined})).goal,null,'Group goals remain ordinary freeform notes');
});

test('structured goals retain author privacy, immutable targets, conflict checks and session assignments',async t=>{
 const {coaches,owner,one,two}=await setup(t),first=coaches.saveNote(one,draft());
 assert.equal(coaches.notes(two).length,0);assert.equal(coaches.notes(owner)[0].id,first.id);
 assert.throws(()=>coaches.saveNote(two,edit(first,{goal:goal({status:'achieved'})})),/ACCESS_DENIED/);
 assert.throws(()=>coaches.archiveNote(two,{id:first.id,expectedVersion:1}),/ACCESS_DENIED/);
 assert.throws(()=>coaches.saveNote(owner,edit(first,{playerId:rid(3)})),/NOTE_TARGET_CHANGED/);
 assert.throws(()=>coaches.saveNote(owner,edit(first,{sessionId:rid(3)})),/NOTE_TARGET_CHANGED/);
 const changed=coaches.saveNote(owner,edit(first,{goal:goal({status:'in-progress'})}));assert.equal(changed.author_email,one.email);
 assert.throws(()=>coaches.saveNote(one,edit(first,{goal:goal({status:'achieved'})})),/NOTE_CHANGED/);
 coaches.assign(owner,{email:one.email,sessionId:rid(1),assigned:false});
 assert.throws(()=>coaches.saveNote(one,edit(changed)),/ACCESS_DENIED/);assert.throws(()=>coaches.archiveNote(one,{id:first.id,expectedVersion:2}),/ACCESS_DENIED/);
});

test('goal fields are bounded and unknown fields, malformed values or inappropriate targets never write',async t=>{
 const {coaches,owner,one,post}=await setup(t),before=coaches.audit(owner).length;
 const invalid=[[],true,'goal',{status:'done'},{status:null},{successMeasure:7},{successMeasure:'x'.repeat(1001)},{evidence:'x'.repeat(4001)},{evidence:'bad\u0000text'},{successMeasure:'bad\u007ftext'},{drillId:'invalid'},{author_email:one.email}];
 for(const value of invalid)assert.throws(()=>coaches.saveNote(one,draft({goal:value})),/INVALID_GOAL/);
 assert.throws(()=>coaches.saveNote(one,draft({category:'Technical'})),/INVALID_GOAL/);assert.throws(()=>coaches.saveNote(one,draft({playerId:null})),/INVALID_GOAL/);
 assert.throws(()=>coaches.saveNote(one,draft({reviewDate:'2026-02-30'})),/INVALID_DATE/);
 assert.equal((await post(one,draft({playerId:rid(9)}))).status,403);assert.equal((await post(one,draft({sessionId:rid(9)}))).status,403);
 const bad=await post(one,draft({goal:{unexpected:'field'}}));assert.equal(bad.status,400);assert.equal((await bad.json()).error,'INVALID_GOAL');
 assert.equal(coaches.notes(owner).length,0);assert.equal(coaches.audit(owner).length,before);
});

test('optional practice links require a visible active drill and preserve historical archived references',async t=>{
 const {coaches,one,two}=await setup(t),drill=actor=>coaches.saveDrill(actor,{requestId:randomUUID(),title:'Passing pairs',minutes:10,target:'technical',setup:'Players pass in pairs.'}),own=drill(one),other=drill(two);
 for(const drillId of [other.id,'drill_'+'x'.repeat(27)])assert.throws(()=>coaches.saveNote(one,draft({goal:goal({drillId})})),/INVALID_GOAL_DRILL/);
 const saved=coaches.saveNote(one,draft({goal:goal({drillId:own.id})}));assert.equal(saved.goal.drillId,own.id);
 coaches.archiveDrill(one,{id:own.id,expectedVersion:1});
 assert.throws(()=>coaches.saveNote(one,draft({goal:goal({drillId:own.id})})),/INVALID_GOAL_DRILL/);
 const updated=coaches.saveNote(one,edit(saved,{goal:{...saved.goal,status:'achieved'}}));assert.equal(updated.goal.drillId,own.id);assert.equal(updated.goal.status,'achieved');
});
