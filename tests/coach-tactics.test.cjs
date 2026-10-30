const {test}=require('node:test'),assert=require('node:assert/strict');
const mods=Promise.all([import('../private-attendance/coach-store.mjs'),import('../private-attendance/sqlite-store.mjs'),import('../private-attendance/coach-auth.mjs'),import('../private-attendance/coach-http.mjs'),import('../private-attendance/tactics-validation.mjs')]);
const rid=n=>'rec'+String(n).padStart(14,'0');
const content=()=>({schemaVersion:1,pitch:'full',items:[{id:'player_1',kind:'home',label:'1'},{id:'ball_1',kind:'ball',label:''}],frames:[{id:'phase_1',title:'Start',duration:3,positions:[{id:'player_1',x:20,y:40},{id:'ball_1',x:25,y:40}]},{id:'phase_2',title:'Move and pass',duration:2.5,positions:[{id:'player_1',x:40,y:50},{id:'ball_1',x:60,y:50}]}]});
async function setup(t){const [{createCoachStore,OWNER_EMAIL},{openStore},{createCoachAuth},{createCoachHandler}]=await mods,store=openStore();t.after(()=>store.close());const coaches=createCoachStore({store}),owner=coaches.actor(OWNER_EMAIL);for(const name of ['one','two','other'])coaches.saveUser(owner,{name,email:name+'@example.test',role:'coach'});coaches.saveUser(owner,{name:'Admin',email:'admin@example.test',role:'admin'});const one=coaches.actor('one@example.test'),two=coaches.actor('two@example.test'),other=coaches.actor('other@example.test'),admin=coaches.actor('admin@example.test');for(const a of [one,two])coaches.assign(owner,{email:a.email,sessionId:rid(1),assigned:true});coaches.assign(owner,{email:other.email,sessionId:rid(2),assigned:true});const auth=createCoachAuth({store,coaches});let overviewCalls=0;const h=createCoachHandler({coaches,auth,cookieKey:'k'.repeat(43),assets:{},overview:async()=>{overviewCalls++;return {sessions:[{id:rid(1)},{id:rid(2)}]};},attendance:{save:()=>{throw Error('Attendance must not be touched');}},updateAttendance:()=>{throw Error('Attendance must not be touched');}});const signed=actor=>{const session=auth.createVerifiedSession(actor.email);return {origin:'https://attendance.starsoccer.ca','content-type':'application/json',cookie:'__Host-ss_staff='+session.token,'x-csrf-token':session.csrf};};return {store,coaches,owner,one,two,other,admin,h,signed,overviewCalls:()=>overviewCalls};}
const input=(extra={})=>({sessionId:rid(1),title:'Give and go',content:content(),expectedVersion:0,...extra});

test('diagrams are shared by assigned coaches and full-access accounts while private notes and plans stay separate',async t=>{
 const {coaches,one,two,owner,admin}=await setup(t),created=coaches.saveDiagram(one,input());
 assert.match(created.id,/^diagram_[A-Za-z0-9_-]{27}$/);assert.equal(created.version,1);assert.equal(created.created_by,one.email);
 for(const actor of [two,owner,admin])assert.deepEqual(coaches.diagrams(actor,rid(1))[0].content,content());
 const edited=coaches.saveDiagram(two,input({id:created.id,title:'Pass then move',expectedVersion:1}));
 assert.equal(edited.version,2);assert.equal(edited.created_by,one.email);assert.equal(edited.updated_by,two.email);
 assert.equal(coaches.notes(owner).length,0);assert.deepEqual(coaches.plan(owner,rid(1)).content,{});
 assert(coaches.audit(owner).some(row=>row.action==='diagram-created'));assert(coaches.audit(owner).some(row=>row.action==='diagram-updated'));
});

test('unassigned, revoked and disabled coaches cannot read, edit or archive diagrams, and targets cannot be moved',async t=>{
 const {coaches,one,other,owner}=await setup(t),diagram=coaches.saveDiagram(one,input());
 for(const call of [()=>coaches.diagrams(other,rid(1)),()=>coaches.saveDiagram(other,input()),()=>coaches.archiveDiagram(other,{id:diagram.id,sessionId:rid(1),expectedVersion:1}),()=>coaches.saveDiagram(other,input({id:diagram.id,sessionId:rid(2),expectedVersion:1})),()=>coaches.archiveDiagram(other,{id:diagram.id,sessionId:rid(2),expectedVersion:1})])assert.throws(call,/ACCESS_DENIED/);
 coaches.assign(owner,{email:one.email,sessionId:rid(1),assigned:false});assert.throws(()=>coaches.diagrams(one,rid(1)),/ACCESS_DENIED/);
 coaches.saveUser(owner,{email:other.email,name:'Other',role:'coach',active:false,expectedVersion:1});assert.throws(()=>coaches.diagrams(other,rid(2)),/ACCOUNT_NOT_ACTIVE/);
 assert.equal(coaches.diagrams(owner,rid(1)).length,1);
});

test('stale writes and archive races fail without overwriting or reviving saved diagrams',async t=>{
 const {coaches,one,two,owner}=await setup(t),created=coaches.saveDiagram(one,input()),edited=coaches.saveDiagram(two,input({id:created.id,title:'New title',expectedVersion:1}));
 assert.throws(()=>coaches.saveDiagram(one,input({id:created.id,expectedVersion:1})),/DIAGRAM_CHANGED/);
 assert.throws(()=>coaches.archiveDiagram(one,{id:created.id,sessionId:rid(1),expectedVersion:1}),/DIAGRAM_CHANGED/);
 assert.equal(coaches.diagrams(one,rid(1))[0].title,'New title');
 assert.deepEqual(coaches.archiveDiagram(one,{id:created.id,sessionId:rid(1),expectedVersion:edited.version}),{saved:true});
 assert.deepEqual(coaches.diagrams(two,rid(1)),[]);
 assert.throws(()=>coaches.saveDiagram(one,input({id:created.id,expectedVersion:3})),/DIAGRAM_ARCHIVED/);
 assert.throws(()=>coaches.archiveDiagram(one,{id:created.id,sessionId:rid(1),expectedVersion:3}),/DIAGRAM_ARCHIVED/);
 assert(coaches.audit(owner).some(row=>row.action==='diagram-archived'));
});

test('session diagram limit is checked inside the write transaction and archived space can be reused',async t=>{
 const {coaches,one,two}=await setup(t);for(let i=0;i<19;i++)coaches.saveDiagram(one,input({title:'Drill '+i}));
 const last=coaches.saveDiagram(two,input({title:'Last space'}));assert.equal(coaches.diagrams(one,rid(1)).length,20);
 assert.throws(()=>coaches.saveDiagram(one,input({title:'Concurrent attempt'})),/DIAGRAM_LIMIT/);
 const changed=coaches.saveDiagram(two,input({id:last.id,title:'Edit at full capacity',expectedVersion:1}));assert.equal(changed.version,2);
 coaches.archiveDiagram(one,{id:last.id,sessionId:rid(1),expectedVersion:2});coaches.saveDiagram(two,input());assert.equal(coaches.diagrams(one,rid(1)).length,20);
});

test('validator rejects unknown markup fields, duplicate or missing pieces, invalid coordinates and unsupported values',async()=>{
 const [,,,,{validateDiagram}]=await mods;
 const invalid=[v=>v.svg='<svg/>',v=>v.schemaVersion=2,v=>v.pitch='remote',v=>v.items[0].url='https://example.test',v=>v.items[0].kind='script',v=>v.items[0].id='<img>',v=>v.items[0].label='x'.repeat(13),v=>v.items[0].label='line\nbreak',v=>v.items.push({...v.items[0]}),v=>v.frames[1].id=v.frames[0].id,v=>v.frames[0].positions.pop(),v=>v.frames[0].positions[1].id='missing',v=>v.frames[0].positions[1].id='player_1',v=>v.frames[0].positions[0].x=-1,v=>v.frames[0].positions[0].y=101,v=>v.frames[0].positions[0].x=NaN,v=>v.frames[0].positions[0].x='20',v=>v.frames[0].duration=0.49,v=>v.frames[0].duration=20.01,v=>v.frames[0].duration=Infinity,v=>v.frames[0].title='x'.repeat(81),v=>v.frames=[]];
 for(const mutate of invalid){const v=content();mutate(v);assert.throws(()=>validateDiagram(v),/INVALID_DIAGRAM/);}
 const valid=content();valid.items[0].label=' 1 ';assert.equal(validateDiagram(valid).items[0].label,'1');assert.equal(valid.items[0].label,' 1 ','validation returns independent normalized data');
});

test('bounded empty and maximum-size boards validate while oversized boards fail',async()=>{
 const [,,,,{validateDiagram}]=await mods,empty={schemaVersion:1,pitch:'blank',items:[],frames:[{id:'start',title:'',duration:0.5,positions:[]}]};assert.deepEqual(validateDiagram(empty),empty);
 const max={schemaVersion:1,pitch:'half',items:Array.from({length:40},(_,i)=>({id:'item_'+i,kind:'cone',label:'Cone '+i})),frames:Array.from({length:12},(_,i)=>({id:'frame_'+i,title:'Phase '+i,duration:20,positions:Array.from({length:40},(_,j)=>({id:'item_'+j,x:j,y:100-j}))}))};assert.equal(validateDiagram(max).frames.length,12);
 assert.throws(()=>validateDiagram({...max,frames:[...max.frames,{...max.frames[0],id:'extra'}]}),/INVALID_DIAGRAM/);
 assert.throws(()=>validateDiagram({...max,items:[...max.items,{id:'extra',kind:'home',label:'1'}]}),/INVALID_DIAGRAM/);
});

test('invalid versions and titles never mutate saved data',async t=>{
 const {coaches,one}=await setup(t);for(const expectedVersion of [-1,1.5,'0',null,Infinity])assert.throws(()=>coaches.saveDiagram(one,input({expectedVersion})),/INVALID_DIAGRAM/);
 for(const title of ['', ' '.repeat(5),'x'.repeat(81)])assert.throws(()=>coaches.saveDiagram(one,input({title})),/INVALID_TEXT/);
 assert.equal(coaches.diagrams(one,rid(1)).length,0);
});

test('additive initialization preserves existing diagrams, plans and author history across restarts',async t=>{
 const {store,coaches,one,owner}=await setup(t),[{createCoachStore}]=await mods;coaches.savePlan(one,{sessionId:rid(1),content:{focus:'Keep existing plan'},expectedVersion:0});const diagram=coaches.saveDiagram(one,input());
 const reloaded=createCoachStore({store});assert.deepEqual(reloaded.diagrams(owner,rid(1))[0],diagram);assert.equal(reloaded.plan(owner,rid(1)).content.focus,'Keep existing plan');
});

test('saved diagrams survive a closed database and a new store connection',async t=>{
 const {mkdtempSync,rmSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),folder=mkdtempSync(join(tmpdir(),'coach-tactics-test-'));
 t.after(()=>rmSync(folder,{recursive:true,force:true}));const [{createCoachStore,OWNER_EMAIL},{openStore}]=await mods,path=join(folder,'fictional.sqlite');
 let store=openStore(path),coaches=createCoachStore({store}),diagram;
 try{diagram=coaches.saveDiagram(coaches.actor(OWNER_EMAIL),input());}finally{store.close();}
 store=openStore(path);try{coaches=createCoachStore({store});assert.deepEqual(coaches.diagrams(coaches.actor(OWNER_EMAIL),rid(1))[0],diagram);}finally{store.close();}
});

test('HTTP diagrams enforce sign-in, CSRF, exact route fields and known sessions before writing',async t=>{
 const {h,signed,one,other,owner,coaches,overviewCalls}=await setup(t),origin='https://attendance.starsoccer.ca',headers=signed(one);
 const request=(route,payload,custom=headers)=>h(new Request(origin+'/workspace/api/diagrams/'+route,{method:'POST',headers:custom,body:JSON.stringify(payload)}));
 assert.equal((await h(new Request(origin+'/workspace/api/diagrams/list'))).status,401);
 assert.equal((await request('list',{sessionId:rid(1)},{...headers,origin:'https://evil.test'})).status,403);
 assert.equal((await request('save',{...input(),role:'owner'})).status,400);
 assert.equal((await request('save',input({sessionId:rid(3)}),signed(owner))).status,404);
 const before=overviewCalls();assert.equal((await request('list',{sessionId:rid(1)},signed(other))).status,403);assert.equal(overviewCalls(),before,'unauthorized scope must not fetch roster');
 const r=await request('save',input());assert.equal(r.status,200);const {diagram}=await r.json();assert.equal(diagram.session_id,rid(1));
 const listed=await request('list',{sessionId:rid(1)});assert.equal(listed.status,200);assert.equal((await listed.json()).diagrams.length,1);
 assert.equal((await request('save',input({id:diagram.id,expectedVersion:0}))).status,409);
 assert.equal((await request('archive',{id:diagram.id,sessionId:rid(1),expectedVersion:1})).status,200);assert.equal(coaches.diagrams(owner,rid(1)).length,0);
});

test('HTTP rejects oversized diagram payload and never accepts query or unknown fields for archive',async t=>{
 const {h,signed,one}=await setup(t),origin='https://attendance.starsoccer.ca',headers=signed(one);
 const oversized=await h(new Request(origin+'/workspace/api/diagrams/save',{method:'POST',headers,body:JSON.stringify(input({title:'x'.repeat(64000)}))}));assert.equal(oversized.status,413);
 const query=await h(new Request(origin+'/workspace/api/diagrams/list?sessionId='+rid(1),{method:'POST',headers,body:JSON.stringify({sessionId:rid(1)})}));assert.equal(query.status,404);
 const extra=await h(new Request(origin+'/workspace/api/diagrams/archive',{method:'POST',headers,body:JSON.stringify({sessionId:rid(1),id:'fake',expectedVersion:1,archived:false})}));assert.equal(extra.status,400);
});
