const {test}=require('node:test'),assert=require('node:assert/strict');
const mods=Promise.all([import('../private-attendance/coach-store.mjs'),import('../private-attendance/sqlite-store.mjs'),import('../private-attendance/coach-auth.mjs'),import('../private-attendance/coach-attendance.mjs')]);
const rid=n=>'rec'+String(n).padStart(14,'0');
async function setup(t){const [{createCoachStore,OWNER_EMAIL},{openStore},{createCoachAuth}]=await mods,store=openStore();t.after(()=>store.close());const coaches=createCoachStore({store}),owner=coaches.actor(OWNER_EMAIL);for(const [name,email,role]of [['One','one@example.test','coach'],['Two','two@example.test','coach'],['Admin','admin@example.test','admin']])coaches.saveUser(owner,{name,email,role});const one=coaches.actor('one@example.test'),two=coaches.actor('two@example.test'),admin=coaches.actor('admin@example.test');for(const a of [one,two])coaches.assign(owner,{email:a.email,sessionId:rid(1),assigned:true});coaches.assign(owner,{email:two.email,sessionId:rid(3),assigned:true});return {store,coaches,owner,one,two,admin,auth:createCoachAuth({store,coaches})};}
test('coaches only read their own private notes even when sharing a session; admins read all',async t=>{const {coaches,owner,one,two,admin}=await setup(t);for(const a of [owner,one,two])coaches.saveNote(a,{sessionId:rid(1),playerId:rid(2),body:a.email+' private observation',category:'Technical'});assert.equal(coaches.notes(one).length,1);assert.equal(coaches.notes(two).length,1);assert(coaches.notes(one)[0].body.includes(one.email));assert.equal(coaches.notes(owner).length,3);assert.equal(coaches.notes(admin).length,3);assert.equal(coaches.full({...one,role:'owner'}),false);});
test('coaches cannot edit or archive another coach note or change immutable author/target links',async t=>{const {coaches,one,two,owner}=await setup(t),n=coaches.saveNote(one,{sessionId:rid(1),playerId:rid(2),body:'Private',category:'General'});assert.throws(()=>coaches.saveNote(two,{id:n.id,sessionId:rid(1),playerId:rid(2),body:'Overwrite',category:'General',expectedVersion:1}),/ACCESS_DENIED/);assert.throws(()=>coaches.archiveNote(two,{id:n.id,expectedVersion:1}),/ACCESS_DENIED/);assert.throws(()=>coaches.saveNote(owner,{id:n.id,sessionId:rid(3),playerId:rid(2),body:'Move',expectedVersion:1}),/NOTE_TARGET_CHANGED/);const edited=coaches.saveNote(owner,{id:n.id,sessionId:rid(1),playerId:rid(2),body:'Reviewed',expectedVersion:1});assert.equal(edited.author_email,one.email);assert.equal(edited.version,2);assert.throws(()=>coaches.saveNote(one,{id:n.id,sessionId:rid(1),playerId:rid(2),body:'Stale',expectedVersion:1}),/NOTE_CHANGED/);});
test('session scope and writes enforce explicit assignments; removing assignment revokes access immediately',async t=>{const {coaches,owner,one}=await setup(t);assert.throws(()=>coaches.saveNote(one,{sessionId:rid(3),body:'Forbidden'}),/ACCESS_DENIED/);const data={sessions:[{id:rid(1),players:[{playerId:rid(2),name:'Player',guardianName:'Private guardian',issues:['private contact issue']}],issues:['private']},{id:rid(3),players:[],issues:[]}]};const scoped=coaches.scope(one,data);assert.equal(scoped.sessions.length,1);assert(!JSON.stringify(scoped).includes('Private guardian'));assert(!JSON.stringify(scoped).includes('private contact issue'));coaches.assign(owner,{email:one.email,sessionId:rid(1),assigned:false});assert.equal(coaches.scope(one,data).sessions.length,0);assert.throws(()=>coaches.savePlan(one,{sessionId:rid(1),content:{focus:'No access'},expectedVersion:0}),/ACCESS_DENIED/);});
test('only the owner manages roles; primary owner cannot be demoted or disabled',async t=>{const {coaches,owner,one,admin}=await setup(t);assert.throws(()=>coaches.saveUser(admin,{email:'new@example.test',name:'New',role:'admin'}),/OWNER_ONLY/);assert.throws(()=>coaches.users(one),/OWNER_ONLY/);assert.throws(()=>coaches.saveUser(owner,{email:owner.email,name:'Owner',role:'coach',active:false,expectedVersion:1}),/INVALID_ACCOUNT_CHANGE/);assert.throws(()=>coaches.saveUser(owner,{email:one.email,name:'One',role:'admin',expectedVersion:0}),/ACCOUNT_CHANGED/);coaches.saveUser(owner,{email:one.email,name:'One',role:'admin',expectedVersion:1});assert.equal(coaches.actor(one.email).role,'admin');});
test('shared session plans use conflict versions and remain separate from private notes',async t=>{const {coaches,one,two}=await setup(t);const p=coaches.savePlan(one,{sessionId:rid(1),content:{focus:'First touch',warmup:'Ball mastery'},expectedVersion:0});assert.equal(coaches.plan(two,rid(1)).content.focus,'First touch');assert.equal(coaches.notes(two).length,0);assert.throws(()=>coaches.savePlan(two,{sessionId:rid(1),content:{focus:'Stale'},expectedVersion:0}),/PLAN_CHANGED/);assert.equal(p.version,1);});
test('tasks and audit events respect owner/admin versus coach permissions',async t=>{const {coaches,owner,one,two}=await setup(t);coaches.saveTask(one,{title:'Pack bibs',sessionId:rid(1)});coaches.saveTask(two,{title:'Other coach private follow-up',sessionId:rid(1)});assert.equal(coaches.tasks(one).length,1);assert.equal(coaches.tasks(owner).length,2);assert.throws(()=>coaches.audit(one),/ACCESS_DENIED/);assert(coaches.audit(owner).length>0);});
test('enrollment is invitation-only, single-account, and credential-free owner account cannot be guessed from login',async t=>{const {auth,owner,one}=await setup(t),invite=auth.issueInvite(owner,one.email);assert(invite.url.includes('/workspace#enroll='));assert.throws(()=>auth.issueInvite(one,one.email),/OWNER_ONLY/);assert.throws(()=>auth.issueInvite(owner,'notapproved@example.test'),/ACCOUNT_NOT_ACTIVE/);const options=await auth.loginOptions({address:'notapproved@example.test',browser:'b'.repeat(43)});assert(options.options.challenge);assert.equal(auth.session('x'.repeat(43)),null);});
test('disabled or repermissioned accounts invalidate existing sessions without trusting browser roles',async t=>{const {auth,store,coaches,owner,one}=await setup(t),{createHash}=require('node:crypto'),token='s'.repeat(43);store.run('INSERT INTO staff_sessions VALUES(?,?,?,?,?)',createHash('sha256').update(token).digest('hex'),one.email,1,'c'.repeat(43),Date.now()+10000);assert.equal(auth.session(token).actor.role,'coach');coaches.saveUser(owner,{email:one.email,name:'One',role:'coach',active:false,expectedVersion:1});assert.equal(auth.session(token),null);});
test('actual attendance writes only its physical field, checks identity/date, and recovers uncertain outcomes',async t=>{const {store,coaches,owner,one}=await setup(t),[,,,{createCoachAttendance}]=await mods;let patches=0,record={id:rid(4),fields:{'Attendance status':'Not marked','Player':[rid(2)],'Session':[rid(1)],'Coverage state':'Active','Session date':'2026-10-28','Web session date':['2026-10-28'],'Web session status':['Planned']}};const writer=createCoachAttendance({store,coaches,writesEnabled:true,baseId:'app00000000000000',tableId:'tbl00000000000000',token:'test',clock:()=>new Date('2026-10-29T18:00:00Z'),fetchFn:async(url,init)=>{if(init.method==='PATCH'){const fields=JSON.parse(init.body).fields;assert.deepEqual(Object.keys(fields),['Attendance status']);record.fields={...record.fields,...fields};patches++;}return new Response(JSON.stringify(record));}}),input={commandId:'fictional_command_0001',sessionId:rid(1),attendanceId:rid(4),playerId:rid(2),status:'Present',expectedStatus:'Not marked'},s={id:rid(1),date:'2026-10-28',status:'Planned',players:[{playerId:rid(2),attendanceId:rid(4)}]};assert((await writer.save(one,input,s)).saved);assert((await writer.save(one,input,s)).duplicate);assert.equal(patches,1);assert.equal(coaches.notes(owner).length,0);await assert.rejects(()=>writer.save(one,{...input,commandId:'fictional_command_0002',status:'Absent'},s),/ATTENDANCE_CHANGED/);await assert.rejects(()=>writer.save(one,{...input,sessionId:rid(3)},s),/ACCESS_DENIED/);});

test('coach HTTP endpoints reject anonymous data access, cross-origin writes, malformed routes and oversized bodies',async t=>{const {coaches,auth}=await setup(t),{createCoachHandler}=await import('../private-attendance/coach-http.mjs');const h=createCoachHandler({coaches,auth,cookieKey:'x'.repeat(43),overview:async()=>{throw Error('must not read business data');},assets:{}}),origin='https://attendance.starsoccer.ca';for(const path of ['desk','users','audit'])assert.equal((await h(new Request(origin+'/workspace/api/'+path))).status,401);assert.equal((await h(new Request(origin+'/workspace/api/desk?all=true'))).status,404);assert.equal((await h(new Request(origin+'/workspace/api/notes/save',{method:'POST',headers:{origin:'https://evil.test','content-type':'application/json'},body:'{}'}))).status,403);const b=await h(new Request(origin+'/workspace/api/bootstrap')),data=await b.json(),cookie=b.headers.get('set-cookie').split(';')[0];assert.equal(data.profile,null);assert.equal((await h(new Request(origin+'/workspace/api/auth/register-options',{method:'POST',headers:{origin,'content-type':'application/json',cookie,'x-csrf-token':data.csrfToken},body:JSON.stringify({token:'x'.repeat(43)})}))).status,401);assert.equal((await h(new Request(origin+'/workspace/api/auth/register-options',{method:'POST',headers:{origin,'content-type':'application/json',cookie,'x-csrf-token':data.csrfToken},body:JSON.stringify({token:'x'.repeat(65000)})}))).status,413);});


test('setup offers device or phone passkeys without requiring a USB key, while keeping verification mandatory',async t=>{const {auth,owner,one}=await setup(t),invite=auth.issueInvite(owner,one.email),token=new URL(invite.url).hash.slice(8),browser='b'.repeat(43);const device=await auth.registrationOptions({token,browser});assert.equal(device.options.authenticatorSelection.authenticatorAttachment,'platform');assert.deepEqual(device.options.hints,['client-device']);assert.equal(device.options.authenticatorSelection.userVerification,'required');assert.equal(device.options.authenticatorSelection.residentKey,'required');const phone=await auth.registrationOptions({token,browser,method:'phone'});assert.deepEqual(phone.options.hints,['hybrid']);assert.equal(phone.options.authenticatorSelection.userVerification,'required');await assert.rejects(()=>auth.registrationOptions({token,browser,method:'bypass'}),/INVALID_SIGN_IN_METHOD/);});
test('scoping uses constant reads and respects grants, revocation and role changes on cached rosters',async t=>{
 const {store,coaches,owner,one,admin}=await setup(t);
 const sessions=Array.from({length:110},(_,i)=>({id:rid(i+1),issues:['guardian record'],players:[{playerId:rid(800),name:'Example',guardianName:'Private'}]}));
 const reads=[];
 for(const method of ['get','all']){
  const original=store[method];
  store[method]=function(sql,...args){reads.push(sql);return original.call(this,sql,...args);};
 }
 function scope(actor){
  reads.length=0;return coaches.scope(actor,{sessions});
 }
 let allowed=scope({...one,role:'owner'});
 assert.deepEqual(allowed.sessions.map(s=>s.id),[rid(1)]);
 assert.equal(reads.length,2);assert(!JSON.stringify(allowed).includes('Private'));
 assert.equal(scope(admin).sessions.length,110);assert.equal(reads.length,1);
 coaches.assign(owner,{email:one.email,sessionId:rid(1),assigned:false});
 coaches.assign(owner,{email:one.email,sessionId:rid(110),assigned:true});
 assert.deepEqual(scope(one).sessions.map(s=>s.id),[rid(110)]);assert.equal(reads.length,2);
 coaches.saveUser(owner,{email:one.email,name:one.name,role:'admin',expectedVersion:1});
 allowed=scope(one);assert.equal(allowed.sessions.length,110);assert.equal(allowed.sessions[0].players[0].guardianName,'Private');
 coaches.saveUser(owner,{email:one.email,name:one.name,role:'coach',expectedVersion:2});
 allowed=scope(one);assert.deepEqual(allowed.sessions.map(s=>s.id),[rid(110)]);
 coaches.saveUser(owner,{email:one.email,name:one.name,role:'coach',active:false,expectedVersion:3});
 assert.throws(()=>scope(one),/ACCOUNT_NOT_ACTIVE/);
});
test('signed bootstrap and refresh can return the full authorized desk in one request',async t=>{
 const {coaches,auth,owner,admin,one}=await setup(t);
 const {createCoachHandler}=await import('../private-attendance/coach-http.mjs');
 const origin='https://attendance.starsoccer.ca',reads=[];
 const roster={sessions:[{id:rid(1),players:[]},{id:rid(3),players:[{guardianName:'Other guardian'}]}]};
 let overview=async({refresh})=>{reads.push(refresh);return roster;};
 const handler=createCoachHandler({coaches,auth,overview:options=>overview(options),assets:{},cookieKey:'x'.repeat(43),attention:()=>{},gmailSync:()=>{},familyFollowups:()=>{}});
 const call=(route,ticket,full=true,csrf=ticket?.csrf)=>handler(new Request(origin+'/workspace/api/'+route,{
  method:route==='refresh'?'POST':'GET',headers:{...(ticket?{cookie:'__Host-ss_staff='+ticket.token}:{}),...(full?{'X-Coach-Desk':'full'}:{}),
   ...(route==='refresh'?{origin,'content-type':'application/json','x-csrf-token':csrf}:{})},
  ...(route==='refresh'?{body:'{}'}:{})
 }));
 const anonymous=await (await call('bootstrap')).json();
 assert.equal(anonymous.profile,null);assert(!('desk' in anonymous));assert.equal(reads.length,0);
 for(const actor of [one,admin,owner]){
  const ticket=auth.createVerifiedSession(actor.email);
  const before=reads.length;
  assert(!('desk' in await (await call('bootstrap',ticket,false)).json()));
  assert.equal(reads.length,before);
  const bootstrap=await (await call('bootstrap',ticket)).json();
  assert.equal(bootstrap.csrfToken,ticket.csrf);
  assert.deepEqual(bootstrap.profile,bootstrap.desk.profile);
  assert.deepEqual(bootstrap.desk,await (await call('desk',ticket,false)).json());
  assert.deepEqual(bootstrap.desk,await (await call('refresh',ticket)).json());
  assert.equal(bootstrap.desk.sessions.length,actor===one?1:2);
  assert.equal(!!bootstrap.desk.gmailSyncAvailable,actor===owner);
  assert.equal(!!bootstrap.desk.attentionAvailable,!!actor.familyAccess);
  assert.equal(!!bootstrap.desk.familyFollowupsAvailable,actor===owner);
  assert.deepEqual(bootstrap.desk.notes,[]);assert.deepEqual(bootstrap.desk.tasks,[]);
  assert(!('notes' in await (await call('refresh',ticket,false)).json()));
  assert.equal((await call('refresh',ticket,true,'bad-csrf')).status,403);
  assert.deepEqual(reads.slice(before),[false,false,true,true]);
 }
 const ticket=auth.createVerifiedSession(one.email);
 overview=async()=>{throw Error('AIRTABLE_READ_FAILED');};
 const fallback=await (await call('bootstrap',ticket)).json();
 assert.equal(fallback.profile.email,one.email);assert(!('desk' in fallback));
 for(const route of ['bootstrap','desk','refresh']){
  const expiring=auth.createVerifiedSession(one.email);
  overview=async()=>{auth.logout(expiring.token);return roster;};
  const rejected=await call(route,expiring);assert.equal(rejected.status,401);
  assert(!('sessions' in await rejected.json()));
 }
 for(const route of ['bootstrap','desk','refresh']){
  const expiring=auth.createVerifiedSession(one.email);
  overview=async()=>{auth.logout(expiring.token);throw Error('AIRTABLE_READ_FAILED');};
  assert.equal((await call(route,expiring)).status,401);
 }
});
