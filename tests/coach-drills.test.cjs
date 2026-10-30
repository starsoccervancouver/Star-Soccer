/* Private archive tests use isolated SQLite state and fictional coaches only. */
const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const mods=Promise.all([import('../private-attendance/coach-store.mjs'),import('../private-attendance/sqlite-store.mjs'),import('../private-attendance/coach-auth.mjs'),import('../private-attendance/coach-http.mjs')]);
const rid=n=>'rec'+String(n).padStart(14,'0');
const diagram=()=>({schemaVersion:1,pitch:'half',items:[{id:'player_1',kind:'home',label:'1'}],frames:[{id:'phase_1',title:'Start',duration:3,positions:[{id:'player_1',x:20,y:40}]},{id:'phase_2',title:'Move',duration:4,positions:[{id:'player_1',x:60,y:40}]}]});
const draft=(extra={})=>({requestId:randomUUID(),title:'Passing pairs',skill:'First touch',minutes:12,target:'technical',setup:'Set up two lines of cones.\nPlayers work in pairs.',coaching:'Open your body before receiving.',progression:'Use the other foot.',equipment:'Balls and cones',diagram:null,expectedVersion:0,...extra});
const edit=(row,extra={})=>({id:row.id,title:row.title,skill:row.skill,minutes:row.minutes,target:row.target,setup:row.setup,coaching:row.coaching,progression:row.progression,equipment:row.equipment,diagram:row.diagram,expectedVersion:row.version,...extra});
async function setup(t){
 const [{createCoachStore,OWNER_EMAIL},{openStore},{createCoachAuth},{createCoachHandler}]=await mods,store=openStore();t.after(()=>store.close());
 const coaches=createCoachStore({store,clock:()=>new Date('2026-10-29T19:00:00Z')}),owner=coaches.actor(OWNER_EMAIL);
 for(const [name,role]of [['one','coach'],['two','coach'],['admin','admin']])coaches.saveUser(owner,{name,email:name+'@example.test',role});
 const one=coaches.actor('one@example.test'),two=coaches.actor('two@example.test'),admin=coaches.actor('admin@example.test');
 const auth=createCoachAuth({store,coaches}),h=createCoachHandler({coaches,auth,cookieKey:'k'.repeat(43),assets:{},overview:async()=>{throw Error('Drill routes must not read the roster');},attendance:{save:()=>{throw Error('Attendance must not be touched');}}});
 const signed=actor=>{const session=auth.createVerifiedSession(actor.email);return {origin:'https://attendance.starsoccer.ca','content-type':'application/json',cookie:'__Host-ss_staff='+session.token,'x-csrf-token':session.csrf};};
 const post=(route,payload,headers)=>h(new Request('https://attendance.starsoccer.ca/workspace/api/drills/'+route,{method:'POST',headers,body:JSON.stringify(payload)}));
 return {store,coaches,owner,one,two,admin,h,signed,post};
}

test('drill archive is personal even for coaches sharing a session; full-access accounts retain author attribution',async t=>{
 const {coaches,owner,one,two,admin}=await setup(t);
 for(const actor of [one,two])coaches.assign(owner,{email:actor.email,sessionId:rid(1),assigned:true});
 const first=coaches.saveDrill(one,draft({diagram:diagram()})),second=coaches.saveDrill(two,draft({title:'Another coach’s drill'}));
 assert.match(first.id,/^drill_[A-Za-z0-9_-]{27}$/);assert.equal(first.version,1);assert.equal(first.author_email,one.email);assert.equal(first.updated_by,one.email);
 assert.deepEqual(coaches.drills(one),[first]);assert.deepEqual(coaches.drills(two),[second]);
 for(const actor of [owner,admin])assert.equal(coaches.drills(actor).length,2);
 assert.equal(coaches.drills({...one,role:'owner'}).length,1,'Browser-supplied roles cannot widen archive scope');
 const reviewed=coaches.saveDrill(admin,edit(first,{title:'Reviewed passing pairs'}));
 assert.equal(reviewed.id,first.id);assert.equal(reviewed.version,2);assert.equal(reviewed.author_email,one.email);assert.equal(reviewed.updated_by,admin.email);assert.equal(reviewed.request_id,first.request_id);
 assert.deepEqual(reviewed.diagram,diagram());assert.equal(coaches.drills(one)[0].title,'Reviewed passing pairs');
 assert.throws(()=>coaches.saveDrill(two,edit(reviewed)),/ACCESS_DENIED/);
 assert.throws(()=>coaches.archiveDrill(two,{id:first.id,expectedVersion:2}),/ACCESS_DENIED/);
 assert.equal(coaches.notes(owner).length,0);assert.deepEqual(coaches.plan(owner,rid(1)).content,{});assert.equal(coaches.diagrams(owner,rid(1)).length,0);
});

test('personal templates do not require a session assignment and disabled or downgraded actors are checked afresh',async t=>{
 const {coaches,owner,one,admin}=await setup(t),saved=coaches.saveDrill(one,draft());
 assert.equal(coaches.drills(one).length,1);
 coaches.saveUser(owner,{email:admin.email,name:'Admin downgraded',role:'coach',expectedVersion:1});
 assert.equal(coaches.drills(admin).length,0);assert.throws(()=>coaches.saveDrill(admin,edit(saved)),/ACCESS_DENIED/);
 coaches.saveUser(owner,{email:one.email,name:'One disabled',role:'coach',active:false,expectedVersion:1});
 for(const action of [()=>coaches.drills(one),()=>coaches.saveDrill(one,draft()),()=>coaches.archiveDrill(one,{id:saved.id,expectedVersion:1})])assert.throws(action,/ACCOUNT_NOT_ACTIVE/);
 assert.equal(coaches.drills(owner).length,1);
});

test('create request IDs deduplicate exact retries and can be read back without widening author scope',async t=>{
 const {coaches,owner,one,two}=await setup(t),input=draft({title:'  Passing pairs  ',diagram:diagram()}),first=coaches.saveDrill(one,input);
 assert.equal(first.title,'Passing pairs');assert.equal(first.request_id,input.requestId);
 assert.deepEqual(coaches.saveDrill(one,input),first);assert.deepEqual(coaches.drills(one).find(row=>row.request_id===input.requestId),first);
 assert.equal(coaches.audit(owner).filter(row=>row.action==='drill-created').length,1);
 assert.throws(()=>coaches.saveDrill(one,{...input,minutes:15}),/DRILL_REQUEST_REUSED/);
 const separate=coaches.saveDrill(two,input);assert.notEqual(separate.id,first.id);assert.equal(separate.author_email,two.email);
 const changed=coaches.saveDrill(one,edit(first,{setup:'Updated setup'}));
 assert.throws(()=>coaches.saveDrill(one,input),/DRILL_CHANGED/);assert.equal(coaches.drills(one).length,1);
 assert.equal(changed.version,2);
});

test('stale versions cannot overwrite an edited drill; repeated archive is safe and archived drills cannot revive',async t=>{
 const {coaches,owner,one,admin}=await setup(t),input=draft(),first=coaches.saveDrill(one,input),second=coaches.saveDrill(admin,edit(first,{minutes:15}));
 assert.throws(()=>coaches.saveDrill(one,edit(first,{title:'Stale edit'})),/DRILL_CHANGED/);
 assert.throws(()=>coaches.archiveDrill(one,{id:first.id,expectedVersion:1}),/DRILL_CHANGED/);
 assert.equal(coaches.drills(one)[0].minutes,15);
 for(let i=0;i<2;i++)assert.deepEqual(coaches.archiveDrill(one,{id:first.id,expectedVersion:2}),{saved:true});
 assert.deepEqual(coaches.drills(owner),[]);
 assert.equal(coaches.audit(owner).filter(row=>row.action==='drill-archived').length,1);
 assert.throws(()=>coaches.saveDrill(one,edit(second,{expectedVersion:3})),/DRILL_ARCHIVED/);
 assert.throws(()=>coaches.saveDrill(one,input),/DRILL_ARCHIVED/);
 assert.throws(()=>coaches.archiveDrill(one,{id:first.id,expectedVersion:3}),/DRILL_ARCHIVED/);
});

test('title, stage, duration, text and request IDs are bounded before any record or audit is written',async t=>{
 const {coaches,owner,one}=await setup(t),before=coaches.audit(owner).length;
 const invalid=[{title:''},{title:'x'.repeat(81)},{title:'Title\nNew line'},{skill:'x'.repeat(81)},{minutes:0},{minutes:121},{minutes:1.5},{minutes:'12'},{target:'reflection'},{setup:''},{setup:'x'.repeat(2001)},{coaching:'x'.repeat(2001)},{progression:7},{equipment:'bad\u0000text'},{requestId:null},{requestId:'short'},{requestId:'../'.repeat(9)},{expectedVersion:-1},{expectedVersion:'0'},{expectedVersion:1.5},{id:'other'}];
 for(const values of invalid)assert.throws(()=>coaches.saveDrill(one,draft(values)),/INVALID_DRILL/);
 assert.deepEqual(coaches.drills(one),[]);assert.equal(coaches.audit(owner).length,before);
 const minimal=coaches.saveDrill(one,{requestId:randomUUID(),title:'Simple setup',minutes:1,target:'warmup',setup:'One ball each'});
 for(const name of ['skill','coaching','progression','equipment'])assert.equal(minimal[name],'');assert.equal(minimal.diagram,null);
 assert.equal(coaches.saveDrill(one,edit(minimal,{minutes:120,target:'game'})).minutes,120);
 assert.throws(()=>coaches.saveDrill(one,edit(minimal,{requestId:randomUUID()})),/INVALID_DRILL/);
});

test('optional diagrams use the existing strict validation and never contain fetched content or player records',async t=>{
 const {coaches,one}=await setup(t),bad=diagram();bad.remoteUrl='https://example.test/board.svg';
 assert.throws(()=>coaches.saveDrill(one,draft({diagram:bad})),/INVALID_DIAGRAM/);
 const wrong=diagram();wrong.frames[0].positions[0].x=101;assert.throws(()=>coaches.saveDrill(one,draft({diagram:wrong})),/INVALID_DIAGRAM/);
 const input=draft({diagram:diagram()}),saved=coaches.saveDrill(one,input);input.diagram.items[0].label='Changed';
 assert.equal(saved.diagram.items[0].label,'1');assert.deepEqual(coaches.drills(one)[0].diagram,diagram());
 const detached=coaches.drills(one)[0];detached.diagram.frames[0].positions[0].x=99;
 assert.equal(coaches.drills(one)[0].diagram.frames[0].positions[0].x,20,'Readback returns independent structured content');
});

test('archive limits apply per author while allowing edits, retry recovery and reuse of archived space',async t=>{
 const {coaches,one,two}=await setup(t);let last,input;
 for(let i=0;i<200;i++){input=draft({title:'Template '+i});last=coaches.saveDrill(one,input);}
 assert.equal(coaches.drills(one).length,200);assert.deepEqual(coaches.saveDrill(one,input),last);
 assert.throws(()=>coaches.saveDrill(one,draft()),/DRILL_LIMIT/);
 const edited=coaches.saveDrill(one,edit(last,{title:'Updated at archive limit'}));assert.equal(edited.version,2);
 assert(coaches.saveDrill(two,draft()).id);
 coaches.archiveDrill(one,{id:last.id,expectedVersion:2});coaches.saveDrill(one,draft());assert.equal(coaches.drills(one).length,200);
});

test('additive archive initialization preserves existing private notes, plans and diagram records',async t=>{
 const {store,coaches,owner,one}=await setup(t),[{createCoachStore}]=await mods;
 coaches.assign(owner,{email:one.email,sessionId:rid(1),assigned:true});
 const note=coaches.saveNote(one,{sessionId:rid(1),body:'Private player observation'}),plan=coaches.savePlan(one,{sessionId:rid(1),content:{focus:'Existing plan'},expectedVersion:0}),board=coaches.saveDiagram(one,{sessionId:rid(1),title:'Existing board',content:diagram()}),saved=coaches.saveDrill(one,draft());
 const reopened=createCoachStore({store});assert.deepEqual(reopened.drills(one),[saved]);assert.deepEqual(reopened.notes(one),[note]);assert.deepEqual(reopened.plan(one,rid(1)),plan);assert.deepEqual(reopened.diagrams(one,rid(1)),[board]);
 assert.equal(reopened.notes(reopened.actor('two@example.test')).length,0,'Archive access never widens private notes');
});

test('saved templates and create dedupe keys survive database close and reopen',async t=>{
 const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
 const folder=mkdtempSync(join(tmpdir(),'coach-drill-archive-test-'));t.after(()=>rmSync(folder,{recursive:true,force:true}));
 const [{createCoachStore,OWNER_EMAIL},{openStore}]=await mods,file=join(folder,'fictional.sqlite'),input=draft({diagram:diagram()});
 let store=openStore(file),saved;
 try{const coaches=createCoachStore({store});saved=coaches.saveDrill(coaches.actor(OWNER_EMAIL),input);}finally{store.close();}
 store=openStore(file);
 try{const coaches=createCoachStore({store}),owner=coaches.actor(OWNER_EMAIL);assert.deepEqual(coaches.drills(owner),[saved]);assert.deepEqual(coaches.saveDrill(owner,input),saved);assert.equal(coaches.drills(owner).length,1);}finally{store.close();}
});

test('HTTP archive routes enforce sign-in, exact fields, CSRF and private author scope without reading the roster',async t=>{
 const {post,h,signed,coaches,one,two,owner}=await setup(t),headers=signed(one);
 assert.equal((await h(new Request('https://attendance.starsoccer.ca/workspace/api/drills/list'))).status,401);
 assert.equal((await post('list',{}, {...headers,origin:'https://evil.test'})).status,403);
 assert.equal((await post('save',draft({author_email:owner.email}),headers)).status,400);
 assert.equal((await post('list',{authorEmail:owner.email},headers)).status,400);
 assert.equal((await post('save',draft({sessionId:rid(1)}),headers)).status,400);
 const response=await post('save',draft(),headers);assert.equal(response.status,200);const {drill}=await response.json();
 const read=await post('list',{},headers);assert.equal(read.status,200);assert.equal(read.headers.get('cache-control'),'no-store');assert.equal(read.headers.get('x-robots-tag'),'noindex, nofollow');assert.deepEqual((await read.json()).drills,[drill]);
 assert.deepEqual((await (await post('list',{},signed(two))).json()).drills,[]);
 assert.equal((await post('save',edit(drill,{title:'Not mine'}),signed(two))).status,403);
 assert.equal((await post('archive',{id:drill.id,expectedVersion:1},signed(two))).status,403);
 assert.equal((await post('save',edit(drill,{expectedVersion:0}),headers)).status,409);
 assert.equal((await post('archive',{id:drill.id,expectedVersion:1},headers)).status,200);
 assert.equal(coaches.drills(owner).length,0);
});

test('HTTP rejects unknown archive fields, query strings, malformed diagrams and oversized payloads',async t=>{
 const {post,h,signed,one}=await setup(t),headers=signed(one);
 assert.equal((await post('archive',{id:'fake',expectedVersion:1,archived:false},headers)).status,400);
 assert.equal((await post('save',draft({diagram:{url:'https://example.test'}}),headers)).status,400);
 assert.equal((await post('save',draft({setup:'x'.repeat(64000)}),headers)).status,413);
 assert.equal((await h(new Request('https://attendance.starsoccer.ca/workspace/api/drills/list?all=true',{method:'POST',headers,body:'{}'}))).status,404);
 const invalid=await post('save',draft({minutes:0}),headers);assert.equal(invalid.status,400);assert.match((await invalid.json()).message,/1 to 120/);
});
