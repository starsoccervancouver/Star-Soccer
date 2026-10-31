/* Coaching-team reads use isolated in-memory SQLite and fictional accounts only. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const mods=Promise.all([import('../private-attendance/coach-store.mjs'),import('../private-attendance/sqlite-store.mjs'),import('../private-attendance/coach-auth.mjs'),import('../private-attendance/coach-http.mjs')]);
const rid=n=>'rec'+String(n).padStart(14,'0');
async function setup(t){
 const [{createCoachStore},{openStore},{createCoachAuth},{createCoachHandler}]=await mods,store=openStore();t.after(()=>store.close());
 const coaches=createCoachStore({store,ownerEmail:'owner@example.test',ownerName:'Fictional Owner'}),owner=coaches.actor('owner@example.test');
 for(const [name,role]of [['one','coach'],['two','coach'],['admin','admin']])coaches.saveUser(owner,{name,email:name+'@example.test',role});
 const one=coaches.actor('one@example.test'),two=coaches.actor('two@example.test'),admin=coaches.actor('admin@example.test');
 coaches.assign(owner,{email:one.email,sessionId:rid(1),assigned:true});
 const auth=createCoachAuth({store,coaches}),handler=createCoachHandler({coaches,auth,cookieKey:'k'.repeat(43),assets:{},overview:async()=>{throw Error('Team reads must not fetch roster');}});
 const request=(actor,path,payload)=>{const session=auth.createVerifiedSession(actor.email),origin='https://attendance.starsoccer.ca';return handler(new Request(origin+'/workspace/api/'+path,{method:payload===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-ss_staff='+session.token,'x-csrf-token':session.csrf},...(payload===undefined?{}:{body:JSON.stringify(payload)})}));};
 return {store,coaches,owner,one,two,admin,request};
}
test('owners and admins get minimal team fields while account management stays owner-only',async t=>{
 const {coaches,owner,one,admin,request}=await setup(t);
 for(const actor of [owner,admin]){
  const response=await request(actor,'coaching-team');assert.equal(response.status,200);
  const {coaches:team}=await response.json();assert.equal(team.length,4);
  for(const row of team)assert.deepEqual(Object.keys(row).sort(),['active','assignments','email','name','role']);
  assert.deepEqual(team.find(row=>row.email===one.email).assignments,[rid(1)]);
  assert.equal((await request(actor,'coaching-team/notes',{email:one.email})).status,200);
 }
 assert.equal((await request(one,'coaching-team')).status,403);
 assert.equal((await request(one,'coaching-team/notes',{email:one.email})).status,403);
 assert.equal((await request(admin,'users')).status,403);assert.equal((await request(owner,'users')).status,200);
 assert.throws(()=>coaches.coachingTeam({...one,role:'owner'}),/ACCESS_DENIED/);
 coaches.saveUser(owner,{email:admin.email,name:'Downgraded',role:'coach',expectedVersion:1});
 for(const read of [()=>coaches.coachingTeam(admin),()=>coaches.coachingNotes(admin,one.email)])assert.throws(read,/ACCESS_DENIED/);
 coaches.saveUser(owner,{email:one.email,name:'Disabled',role:'coach',active:false,expectedVersion:1});
 for(const read of [()=>coaches.coachingTeam(one),()=>coaches.coachingNotes(one,one.email)])assert.throws(read,/ACCOUNT_NOT_ACTIVE/);
});
test('authored notes include inactive coaches, exclude archived and other authors, and cap newest results at 200',async t=>{
 const {store,coaches,owner,one,two,admin,request}=await setup(t);
 for(let n=0;n<203;n++)store.run('INSERT INTO coach_notes(id,author_email,session_id,category,body,created_at,updated_at,version,archived,goal_json) VALUES(?,?,?,?,?,?,?,1,?,?)','note_'+String(n).padStart(3,'0'),n===202?two.email:one.email,rid(1),'Goal','Fictional authored note','2026-10-01',new Date(Date.UTC(2026,9,1,0,n)).toISOString(),n===201?1:0,JSON.stringify({status:'planned'}));
 coaches.saveUser(owner,{email:one.email,name:'Past Coach',role:'coach',active:false,expectedVersion:1});
 const notes=coaches.coachingNotes(admin,one.email.toUpperCase());assert.equal(notes.length,200);
 assert.equal(notes[0].id,'note_200');assert.equal(notes.at(-1).id,'note_001');
 assert(notes.every(row=>row.author_email===one.email&&!row.archived&&!Object.hasOwn(row,'goal_json')));assert.deepEqual(notes[0].goal,{status:'planned'});
 const response=await request(owner,'coaching-team/notes',{email:one.email});assert.equal(response.status,200);assert.deepEqual((await response.json()).notes,notes);
 assert.equal(coaches.coachingTeam(owner).find(row=>row.email===one.email).active,0);
 for(const email of ['',null,7,'bad email'])assert.equal((await request(admin,'coaching-team/notes',{email})).status,400);
 assert.equal((await request(admin,'coaching-team/notes',{})).status,400);
 assert.equal((await request(admin,'coaching-team/notes',{email:one.email,role:'owner'})).status,400);
 assert.equal((await request(admin,'coaching-team/notes',{email:'missing@example.test'})).status,404);
});
