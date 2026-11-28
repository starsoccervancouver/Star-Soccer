/* Coaching-team reads use isolated in-memory SQLite and fictional accounts only. */
const {test}=require('node:test'),assert=require('node:assert/strict');
const mods=Promise.all([import('../private-attendance/coach-store.mjs'),import('../private-attendance/sqlite-store.mjs'),import('../private-attendance/coach-auth.mjs'),import('../private-attendance/coach-http.mjs')]);
const rid=n=>'rec'+String(n).padStart(14,'0');
async function setup(t,contactFixture){
 const [{createCoachStore},{openStore},{createCoachAuth},{createCoachHandler}]=await mods,store=openStore();t.after(()=>store.close());
 const coaches=createCoachStore({store,ownerEmail:'owner@example.test',ownerName:'Fictional Owner'}),owner=coaches.actor('owner@example.test');
 for(const [name,role]of [['one','coach'],['two','coach'],['admin','admin']])coaches.saveUser(owner,{name,email:name+'@example.test',role});
 const one=coaches.actor('one@example.test'),two=coaches.actor('two@example.test'),admin=coaches.actor('admin@example.test');
 coaches.assign(owner,{email:one.email,sessionId:rid(1),assigned:true});
 const ledgerCalls=[],familyLedger={async directory(){ledgerCalls.push('directory');return [];},async detail(id){ledgerCalls.push(id);return {balance:50};}};
 const auth=createCoachAuth({store,coaches}),handler=createCoachHandler({coaches,auth,familyLedger:contactFixture?.ledger||familyLedger,sessionBooks:contactFixture?.sessionBooks,bookingPayments:contactFixture?.bookingPayments,sessionRoster:contactFixture?.sessionRoster,attention:async({kind})=>({kind}),familyFollowups:async preview=>({preview}),cookieKey:'k'.repeat(43),assets:{},overview:contactFixture?.overview|| (async()=>{throw Error('Team reads must not fetch roster');})});
 const request=(actor,path,payload)=>{const session=auth.createVerifiedSession(actor.email),origin='https://attendance.starsoccer.ca';return handler(new Request(origin+'/workspace/api/'+path,{method:payload===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie:'__Host-ss_staff='+session.token,'x-csrf-token':session.csrf},...(payload===undefined?{}:{body:JSON.stringify(payload)})}));};
 return {store,coaches,owner,one,two,admin,request,auth,handler,ledgerCalls};
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
test('family access is owner-granted, checked before reads, and immediately revocable',async t=>{
 const {coaches,owner,admin,one,auth,handler,request,ledgerCalls}=await setup(t);
 const familyId=rid(20), setting={email:admin.email,name:'Admin',role:'super_admin',expectedVersion:1};
 for(const actor of [one,admin]){
  assert.equal((await request(actor,'families')).status,403);
  assert.equal((await request(actor,'family',{familyId})).status,403);
  assert.equal((await request(actor,'users/save',setting)).status,403);
 }
 assert.deepEqual(ledgerCalls,[]);
 assert.equal((await request(owner,'users/save',setting)).status,200);
 const elevated=coaches.actor(admin.email),oldSession=auth.createVerifiedSession(admin.email);
 assert.equal(coaches.full(elevated),true);
 assert.equal((await request(elevated,'users/save',{...setting,email:one.email})).status,403);
 for(const actor of [owner,elevated]){
  assert.equal((await request(actor,'families')).status,200);
  assert.equal((await request(actor,'family',{familyId:'invalid'})).status,400);
  const result=await request(actor,'family',{familyId});assert.equal(result.status,200);
  assert.equal((await result.json()).family.balance,50);
 }
 assert.deepEqual(ledgerCalls,['directory',familyId,'directory',familyId]);
 assert.equal((await request(owner,'users/save',{...setting,role:'admin',expectedVersion:2})).status,200);
 assert.equal((await handler(new Request('https://attendance.starsoccer.ca/workspace/api/families',{headers:{cookie:'__Host-ss_staff='+oldSession.token}}))).status,401);
 assert.equal((await request(admin,'families')).status,403);
 assert.equal((await request(admin,'coaching-team')).status,200);
 assert.throws(()=>coaches.requireFamilyAccess(elevated),/ACCESS_DENIED/);
});
test('Books and Home unpaid require the stored finance grant and select exact-session dues',async t=>{
 let reads=0;
 const contact={guardian:'Books-only guardian',email:'fictional@example.test',phone:'555-0100'};
 const due={scope:'session',status:'due',amountDue:25,contact};
 const rows=[due,{...due,scope:'booking'},{...due,status:'upcoming'},{...due,status:'review'},
  {...due,status:'paid',amountDue:0},{...due,amountDue:null},{...due,amountDue:'25'},{...due,amountDue:-25}];
 const {coaches,owner,admin,one,auth,handler,request}=await setup(t,{
  sessionBooks:async()=>{reads++;return {rows,privateDiagnostic:'internal'};},overview:async()=>({sessions:[]})
 });
 const origin='https://attendance.starsoccer.ca',route=origin+'/workspace/api/session-books';
 assert.equal((await handler(new Request(route))).status,401);
 for(const actor of [one,admin]){
  assert.equal((await (await request(actor,'desk')).json()).booksAvailable,undefined);
  for(const input of [{},{view:'unpaid'},{role:'owner'}])assert.equal((await request(actor,'session-books',input)).status,403);
 }
 for(const input of [{view:'all'},{view:null},{view:['unpaid']},{sessionId:rid(1)},{view:'unpaid',familyAccess:true}])
  assert.equal((await request(owner,'session-books',input)).status,400);
 assert.equal((await request(owner,'session-books')).status,405);
 const ownerSession=auth.createVerifiedSession(owner.email);
 assert.equal((await handler(new Request(route,{method:'POST',headers:{cookie:'__Host-ss_staff='+ownerSession.token},body:'{}'}))).status,403);
 coaches.saveUser(owner,{email:admin.email,name:'Finance admin',role:'super_admin',expectedVersion:1});
 for(const actor of [one,owner,admin]){
  assert.equal((await (await request(actor,'desk')).json()).booksAvailable,actor===one?undefined:true);
  const session=auth.createVerifiedSession(actor.email);
  const bootstrap=await handler(new Request(origin+'/workspace/api/bootstrap',{headers:{cookie:'__Host-ss_staff='+session.token,'X-Coach-Desk':'full'}}));
  for(const response of [bootstrap,await request(actor,'desk'),await request(actor,'refresh',{}),await request(actor,'session',{sessionId:rid(1)})]){
   assert.equal(response.status,200);assert.doesNotMatch(await response.text(),/Books-only|amountDue|privateDiagnostic/);
  }
 }
 assert.equal(reads,0,'Books are fetched exclusively through their authorized route');
 for(const actor of [owner,admin]){
  const full=await request(actor,'session-books',{});assert.equal(full.status,200);
  assert.equal(full.headers.get('cache-control'),'no-store');
  assert.deepEqual(await full.json(),{rows});
  const home=await request(actor,'session-books',{view:'unpaid'});assert.equal(home.status,200);
  assert.deepEqual(await home.json(),{rows:[{scope:'session',status:'due',amountDue:25}]});
 }
 assert.equal(reads,4);
});

test('Books discard financial data when sign-in or grant changes during a read',async t=>{
 for(const change of ['downgrade','sign-out','remove grant','revoked with provider failure']){
  await t.test(change,async t=>{
   let invalidate;
   const {store,coaches,owner,admin,auth,handler}=await setup(t,{sessionBooks:async()=>{
    invalidate();
    if(change==='revoked with provider failure')throw Error('private upstream diagnostic');
    return {rows:[{status:'due',contact:{guardian:'Books-only guardian'}}]};
   }});
   coaches.saveUser(owner,{email:admin.email,name:'Finance admin',role:'super_admin',expectedVersion:1});
   const session=auth.createVerifiedSession(admin.email),origin='https://attendance.starsoccer.ca';
   invalidate=()=>{
    if(change==='remove grant')store.run('UPDATE coach_users SET family_access=0 WHERE email=?',admin.email);
    else if(change==='downgrade')coaches.saveUser(owner,{email:admin.email,name:'Ordinary admin',role:'admin',expectedVersion:2});
    else auth.logout(session.token);
   };
   const response=await handler(new Request(origin+'/workspace/api/session-books',{method:'POST',headers:{
    origin,cookie:'__Host-ss_staff='+session.token,'x-csrf-token':session.csrf,'content-type':'application/json'
   },body:JSON.stringify(change==='remove grant'?{view:'unpaid'}:{})}));
   assert.equal(response.status,change==='remove grant'?403:401);
   assert.doesNotMatch(await response.text(),/Books-only|private upstream diagnostic/);
  });
 }
});

test('Books recheck authorization after reading the request and before starting financial reads',async t=>{
 let reads=0,controller;
 const {coaches,owner,admin,auth,handler}=await setup(t,{sessionBooks:async()=>{reads++;return {rows:[]};}});
 coaches.saveUser(owner,{email:admin.email,name:'Finance admin',role:'super_admin',expectedVersion:1});
 const session=auth.createVerifiedSession(admin.email),origin='https://attendance.starsoccer.ca';
 const body=new ReadableStream({start(stream){controller=stream;}});
 const pending=handler(new Request(origin+'/workspace/api/session-books',{method:'POST',duplex:'half',body,headers:{
  origin,cookie:'__Host-ss_staff='+session.token,'x-csrf-token':session.csrf,'content-type':'application/json'
 }}));
 auth.logout(session.token);
 controller.enqueue(new TextEncoder().encode('{}'));controller.close();
 assert.equal((await pending).status,401);assert.equal(reads,0);
});

test('directory shares recent verified links, expires and refreshes without caching failed reads',async()=>{
 const {createFamilyLedger}=await import('../private-attendance/family-ledger.mjs');
 const family=rid(1),player=rid(2),recent={reuseRecent:true};
 let reads=0,now=0,linked=true,fail=false;
 const ledger=createFamilyLedger(async table=>{
  reads++;
  if(fail && table==='players')throw new Error('read failed');
  return table==='families'?[{id:family,fields:{'Guardian name':'Guardian',Players:[player]}}]:
   [{id:player,fields:{Player:'Child',Family:linked?[family]:[]}}];
 },{clock:()=>now});
 const [first,second]=await Promise.all([ledger.directory(recent),ledger.directory(recent)]);
 assert.deepEqual(first,second);assert.equal(first[0].name,'Guardian / Child');assert.equal(reads,2);
 linked=false;now=29999;await ledger.directory(recent);assert.equal(reads,2);
 now=30000;assert.deepEqual((await ledger.directory(recent))[0].playerIds,[]);assert.equal(reads,4);
 ledger.invalidateDirectory();fail=true;await assert.rejects(()=>ledger.directory(recent),/read failed/);
 fail=false;linked=true;assert.deepEqual((await ledger.directory(recent))[0].playerIds,[player]);assert.equal(reads,8);
});
test('family detail batches linked history at the Airtable page limit and rechecks payments on each visit',async()=>{
 const {createFamilyLedger}=await import('../private-attendance/family-ledger.mjs');
 const id=rid(1),paymentIds=Array.from({length:101},(_,i)=>rid(100+i));
 let amount=50,duplicate=false;const calls=[];
 const ledger=createFamilyLedger(async(table,fields,ids)=>{
  calls.push([table,ids.length]);
  if(table==='families')return [{id,fields:{Payments:paymentIds}}];
  return ids.map((key,i)=>({id:duplicate&&i===1?ids[0]:key,fields:{Family:[id],'Amount CAD':amount}}));
 });
 const first=await ledger.detail(id);
 assert.equal(first.payments.length,101);assert.equal(first.payments[0].amount,50);
 assert.deepEqual(calls,[['families',1],['payments',100],['payments',1]]);
 amount=65;assert.equal((await ledger.detail(id)).payments[0].amount,65);assert.equal(calls.length,6);
 duplicate=true;await assert.rejects(()=>ledger.detail(id),/INCONSISTENT_FAMILY_LINK/);
});
test('family ledger keeps sibling bookings and a shared transfer separate and preserves unknown amounts',async()=>{
 const {createFamilyLedger}=await import('../private-attendance/family-ledger.mjs');
 const id=rid(1),row=(n,fields)=>({id:rid(n),fields});
 const tables={families:[row(1,{Family:'Example family','Guardian name':'Example Guardian',Players:[rid(2),rid(3)],Bookings:[rid(4),rid(5)],Payments:[rid(6)],'Verified family receipts CAD':90,'Balance CAD':0})],
  players:[row(3,{Player:'Child B',Family:[id]}),row(2,{Player:'Child A',Family:[id],'Verified applied total CAD':60,'Outstanding CAD':0,'Payment status':'Paid to date'})],
  bookings:[row(4,{Family:[id],Player:[rid(2)],'Verified applied CAD':60}),row(5,{Family:[id],Player:[rid(3)],'Verified applied CAD':30})],
  payments:[row(6,{Family:[id],'Amount CAD':90,Verification:'Verified'})]};
 const ledger=createFamilyLedger(async(table,fields,ids)=>tables[table].filter(r=>!ids||ids.includes(r.id)));
 const family=await ledger.detail(id);
 assert.deepEqual(family.players,['Child A','Child B']);assert.equal(family.payments.length,1);
 assert.deepEqual(family.bookings.map(b=>b.applied),[60,30]);assert.equal(family.balance,0);assert.equal(family.dueNow,null);
 assert.equal(family.name,'Example Guardian / Child A');assert.deepEqual(family.playerProfiles,[{id:rid(2),name:'Child A',applied:60,dueNow:0,paymentStatus:'Paid to date'},{id:rid(3),name:'Child B',applied:null,dueNow:null,paymentStatus:undefined}]);
 assert.equal(await ledger.detail(rid(9)),null);assert.deepEqual(await ledger.directory(),[{id,name:family.name,playerIds:[rid(2),rid(3)]}]);
 tables.families[0].fields.Players.unshift(rid(10));
 tables.players.push(row(10,{Player:'Different family child',Family:[rid(8)]}));
 assert.deepEqual(await ledger.directory(),[{id,name:family.name,playerIds:[rid(2),rid(3)]}]);
 await assert.rejects(()=>ledger.detail(id),/INCONSISTENT_FAMILY_LINK/);
 tables.families[0].fields.Players.shift();
 tables.payments[0].fields.Family=[rid(9)];
 await assert.rejects(()=>ledger.detail(id),/INCONSISTENT_FAMILY_LINK/);
});

test('family profile joins notes and marked attendance by player identity across sessions',async t=>{
 const child=rid(22),sibling=rid(23),unrelated=rid(42);
 const detail=()=>({playerProfiles:[{id:child,name:'Alex'},{id:sibling,name:'Jo'}]});
 const entry=(playerId,actualAttendance)=>({playerId,actualAttendance});
 const session=(date,players)=>({id:rid(1),date,label:'Friday class',time:'3:45 PM',location:'Field',players});
 const sessions=[
  session('2025-10-03',[entry(child,'Present'),entry(sibling,'Not marked'),entry(unrelated,'Absent')]),
  session('2025-10-10',[entry(child,'Absent'),entry(sibling,'Present')]),
  session('2099-10-09',[entry(child,'Present')])
 ];
 const {request,owner,coaches,one}=await setup(t,{ledger:{detail},overview:async()=>({sessions})});
 const save=(playerId,body)=>coaches.saveNote(owner,{sessionId:rid(1),playerId,body});
 save(child,'Scanning before receiving');save(sibling,'Working on first touch');save(unrelated,'Other player');save(null,'Whole class');
 const archived=save(child,'Archived note');coaches.archiveNote(owner,{id:archived.id,expectedVersion:archived.version});
 assert.equal((await request(one,'family',{familyId:rid(20)})).status,403);
 const result=await request(owner,'family',{familyId:rid(20)});assert.equal(result.status,200);
 const [a,b]=(await result.json()).family.playerProfiles;
 assert.deepEqual(a.notes.map(n=>n.body),['Scanning before receiving']);
 assert.deepEqual(b.notes.map(n=>n.body),['Working on first touch']);
 assert.deepEqual(a.attendance.map(s=>[s.date,s.status]),[['2025-10-10','Absent'],['2025-10-03','Present']]);
 assert.deepEqual(b.attendance.map(s=>[s.date,s.status]),[['2025-10-10','Present']]);
});

test('only authorized family staff can read work queues and the owner can review general mailbox subjects',async t=>{
 const {coaches,owner,admin,one,request}=await setup(t);
 const completion={completionToken:'a'.repeat(43)+'.'+'b'.repeat(43),completed:true};
 assert.equal((await request(one,'needs-attention/payments',completion)).status,403);
 assert.equal((await request(owner,'needs-attention/other',{completed:true})).status,400);
 assert.equal((await request(owner,'needs-attention/other',completion)).status,200);
 assert.equal((await request(one,'needs-attention/payments',{})).status,403);
 assert.equal((await request(admin,'needs-attention/inquiries',{})).status,403);
 assert.equal((await request(owner,'needs-attention/other',{})).status,200);
 coaches.saveUser(owner,{email:admin.email,name:'Elevated',role:'super_admin',expectedVersion:1});
 assert.equal((await request(admin,'needs-attention/registrations',{})).status,200);
 assert.equal((await request(admin,'needs-attention/other',{})).status,403);
 assert.equal((await request(admin,'needs-attention/other',completion)).status,403);
 assert.equal((await request(admin,'needs-attention/payments',completion)).status,200);
});

test('parent contact reads are limited to the assigned roster and select email only for administrative roles',async t=>{
 const {createFamilyLedger}=await import('../private-attendance/family-ledger.mjs');
 let links=[rid(50)];
 const reads=[];
 const ledger=createFamilyLedger(async(table,fields,ids)=>{
  reads.push({table,fields,ids});
  if(table==='players')return [{id:rid(4),fields:{Family:links,'Player status':'Active'}}];
  return [{id:rid(50),fields:{Phone:'604-555-0123',Email:'parent@example.test'}}];
 });
 const overview=async()=>({sessions:[{id:rid(1),players:[{playerId:rid(4)}]}]});
 const {owner,admin,one,two,request}=await setup(t,{ledger,overview});
 const payload={sessionId:rid(1),playerId:rid(4)};
 assert.equal((await request(two,'parent-contact',payload)).status,403);
 assert.equal((await request(one,'parent-contact',{...payload,playerId:rid(9)})).status,403);
 assert.equal((await request(one,'parent-contact',{...payload,includeEmail:true})).status,400);
 assert.equal(reads.length,0);
 assert.deepEqual(await (await request(one,'parent-contact',payload)).json(),{contact:{phone:'604-555-0123'}});
 assert.deepEqual(reads.at(-1).fields,['Phone']);
 for(const actor of [admin,owner]){
  assert.deepEqual(await (await request(actor,'parent-contact',payload)).json(),{contact:{phone:'604-555-0123',email:'parent@example.test'}});
 }
 links=[rid(50),rid(51)];
 assert.deepEqual(await (await request(admin,'parent-contact',payload)).json(),{contact:null});
 assert.equal(reads.at(-1).table,'players');
});

test('registration follow-up reports and manual checks require the signed-in owner',async t=>{
 const {owner,admin,one,coaches,request}=await setup(t);
 assert.equal((await request(admin,'family-followups')).status,403);
 coaches.saveUser(owner,{email:admin.email,name:'Super admin',role:'super_admin',expectedVersion:1});
 for(const actor of [admin,one])assert.equal((await request(actor,'family-followups',{})).status,403);
 assert.deepEqual(await (await request(owner,'family-followups')).json(),{preview:false});
 assert.deepEqual(await (await request(owner,'family-followups',{})).json(),{preview:true});
});

test('only a signed-in owner can submit a booking payment',async t=>{
 const calls=[];
 const {coaches,owner,one,admin,request}=await setup(t,{bookingPayments:async (op,payload)=>{calls.push([op,payload]);return {saved:true};}});
 coaches.saveUser(owner,{email:admin.email,name:'Test admin',role:'super_admin',expectedVersion:1});
 for(const actor of [one,admin])assert.equal((await request(actor,'booking-payment',{id:'test'})).status,403);
 assert.equal((await request(owner,'booking-payment')).status,405);assert.equal(calls.length,0);
 assert.equal((await request(owner,'booking-payment',{id:'test'})).status,200);
 assert.deepEqual(calls,[['record-booking-payment',{actor:owner.email,input:{id:'test'}}]]);
});

test('Overview opens with verified balances for finance users and reuses the saved summary',async t=>{
 const row={scope:'session',status:'due',amountDue:25,familyName:'Example',date:'2026-11-20',sessionLabel:'Friday training',contact:{phone:'private'}};
 let calls=0,snapshot=null;
 const sessionBooks=Object.assign(async()=>{calls++;return {rows:[row]};},{lastUnpaid:()=>snapshot});
 const {owner,one,auth,handler}=await setup(t,{sessionBooks,overview:async()=>({sessions:[]})});
 async function open(actor){
  const session=auth.createVerifiedSession(actor.email);
  const response=await handler(new Request('https://attendance.starsoccer.ca/workspace/api/bootstrap',{headers:{
   cookie:'__Host-ss_staff='+session.token,'X-Coach-Desk':'full','X-Coach-Overview':'unpaid'
  }}));
  assert.equal(response.status,200);
  return (await response.json()).desk;
 }
 assert.equal((await open(one)).unpaid,undefined);
 assert.equal(calls,0);
 const {unpaid}=await open(owner);
 assert.equal(unpaid.rows[0].amountDue,25);assert.equal(unpaid.rows[0].contact,undefined);
 assert.equal(unpaid.rows[0].date,'2026-11-20');assert.equal(unpaid.rows[0].sessionLabel,'Friday training');
 assert.equal(unpaid.refresh,false);assert.equal(calls,1);
 snapshot={rows:unpaid.rows,checkedAt:Date.now()-60000};
 assert.equal((await open(owner)).unpaid.refresh,true);assert.equal(calls,1);
});

test('finance sign-in can return balance snapshots before reading the roster',async t=>{
 let reads=0;
 const snapshot={rows:[],checkedAt:Date.now()};
 const sessionBooks=Object.assign(async()=>({rows:[]}),{lastUnpaid:()=>snapshot});
 const {owner,one,auth,handler}=await setup(t,{sessionBooks,overview:async()=>{reads++;return {sessions:[]};}});
 async function open(actor){
  const session=auth.createVerifiedSession(actor.email);
  const res=await handler(new Request('https://attendance.starsoccer.ca/workspace/api/bootstrap',{headers:{
   cookie:'__Host-ss_staff='+session.token,'X-Coach-Desk':'full','X-Coach-Overview':'unpaid','X-Coach-Start':'balances-first'
  }}));
  assert.equal(res.status,200);return res.json();
 }
 const finance=await open(owner);assert.equal(finance.paymentRecordingAvailable,false);assert.deepEqual(finance.balanceSnapshot,snapshot);assert.equal(reads,0);
 assert.equal(finance.desk,undefined);
 const coach=await open(one);assert.equal(coach.balanceSnapshot,undefined);assert.ok(coach.desk);assert.equal(reads,1);
});

test('session roster changes require the owner and an authenticated session',async t=>{
 const calls=[];
 const sessionRoster=async(operation,payload)=>{
  calls.push({operation,payload});
  return operation==='coach-roster-options'?{players:[],families:[],recurring:true,rate:30}:{saved:true,playerId:rid(22),added:1,recurring:false};
 };
 const {owner,one,admin,request}=await setup(t,{sessionRoster});
 for(const actor of [one,admin]){
  const denied=await request(actor,'session-roster/options',{sessionId:rid(1)});
  assert.equal(denied.status,403);
 }
 const options=await request(owner,'session-roster/options',{sessionId:rid(1)});
 assert.equal(options.status,200);assert.equal((await options.json()).rate,30);
 const saved=await request(owner,'session-roster/add',{id:'00000000-0000-4000-8000-000000000001',sessionId:rid(1),playerId:rid(22),mode:'dropin',rateCents:3000});
 assert.equal(saved.status,200);
 assert.deepEqual(calls.map(call=>call.operation),['coach-roster-options','coach-roster-add']);
 assert.equal(calls[1].payload.actor,owner.email);
});
test('Books retains owner review decisions and resurfaces changed discrepancies',async t=>{
 const row={scope:'booking',status:'review',bookingId:rid(70),reviewBalance:25,reviewReason:'Check receipt'};
 const {owner,admin,request}=await setup(t,{sessionBooks:async()=>({rows:[row]})});
 const read=async()=> (await (await request(owner,'session-books',{})).json()).rows;
 const [{reviewKey:key}]=await read();
 const decide=(actor,decision)=>request(actor,'books-review',{key,decision});
 assert.equal((await decide(admin,'Deleted')).status,403);
 assert.equal((await decide(owner,'Already handled')).status,200);
 assert.equal((await read())[0].status,'resolved');
 assert.equal((await decide(owner,'Deleted')).status,200);
 assert.deepEqual(await read(),[]);
 row.reviewBalance=35;
 assert.equal((await read())[0].status,'review');
 assert.equal((await decide(owner,'Deleted')).status,409);
});
