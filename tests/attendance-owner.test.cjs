const {test}=require('node:test'),assert=require('node:assert/strict');
const modules=Promise.all([import('../private-attendance/owner-auth.mjs'),import('../private-attendance/sqlite-store.mjs'),import('../private-attendance/production-http.mjs')]);
const origin='https://attendance.starsoccer.ca';
async function setup(t){const [{createOwnerAuth},{openStore},{createProductionHandler}]=await modules,store=openStore();t.after(()=>store.close());let now=Date.now(),reads=0;const auth=createOwnerAuth({store,clock:()=>now}),handler=createProductionHandler({service:{},origin,adminKey:'a'.repeat(43),cookieKey:'b'.repeat(43),assets:{},refreshRoster:async()=>{},flush:async()=>({pending:0}),ownerAuth:auth,ownerData:async()=>{reads++;return {sessions:[{players:[{name:'Fictional Alex'}]}]};},clock:()=>now});return {auth,handler,setClock:v=>now=v,get reads(){return reads;}};}
test('owner data requires an owner cookie, not an ordinary parent session or bearer-less request',async t=>{const c=await setup(t);assert.equal((await c.handler(new Request(origin+'/api/owner-dashboard'))).status,401);const b=await c.handler(new Request(origin+'/api/bootstrap'));assert.equal((await c.handler(new Request(origin+'/api/owner-dashboard',{headers:{Cookie:b.headers.get('set-cookie').split(';')[0]}}))).status,401);assert.equal(c.reads,0);});
test('owner unlock is admin-only, one-use, origin-bound and sets a scoped Secure HttpOnly cookie',async t=>{const c=await setup(t);assert.equal((await c.handler(new Request(origin+'/admin/owner-session',{method:'POST'}))).status,404);const ticket=c.auth.issue();const cross=await c.handler(new Request(origin+'/api/owner-session',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:JSON.stringify({token:ticket.token})}));assert.equal(cross.status,403);const redeem=()=>c.handler(new Request(origin+'/api/owner-session',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:ticket.token})}));const r=await redeem();assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/HttpOnly; Secure; SameSite=Strict/);assert.equal((await redeem()).status,401);const cookie=r.headers.get('set-cookie').split(';')[0];const data=await c.handler(new Request(origin+'/api/owner-dashboard',{headers:{Cookie:cookie}}));assert.equal(data.status,200);assert.equal((await data.json()).sessions[0].players[0].name,'Fictional Alex');assert.equal((await c.handler(new Request(origin+'/api/owner-dashboard',{headers:{Cookie:cookie+'x'}}))).status,401);});
test('expired owner tickets cannot open the private overview',async t=>{const c=await setup(t),ticket=c.auth.issue();c.setClock(Date.now()+301000);assert.equal(c.auth.redeem(ticket.token),false);});
test('owner overview never returns guardian email addresses or treats RSVP as physical attendance',async()=>{const {buildOwnerOverview}=await import('../private-attendance/owner-overview.mjs');const row=(id,fields)=>({id,fields}),t={sessions:[row('s',{Session:'Wednesday',Date:'2026-11-04',Time:'3:45 pm – 5:15 pm',Venue:'Connaught Park',Capacity:20,'Session status':'Planned'})],players:[row('p',{Player:'Alex','Player status':'Active',Family:['f']})],families:[row('f',{'Guardian name':'Jordan',Email:'private@example.com'})],bookings:[row('b',{'Booking type':'Drop-in','Booking status':'Accepted'})],enrollments:[],registrations:[],attendance:[row('a',{Session:['s'],Player:['p'],Booking:['b'],'Coverage state':'Active','RSVP status':'Yes','Attendance status':'Not marked'})]};const result=buildOwnerOverview(t,new Date().toISOString());assert(!JSON.stringify(result).includes('private@example.com'));assert.equal(result.sessions[0].players[0].actualAttendance,'Not marked');assert.equal(result.sessions[0].counts.yes,1);assert(result.sessions[0].issues.some(i=>i.reason.includes('verification')));});
test('weekly confirmation requires verified individual attendance links, while passes and camps do not',()=>{const E=require('../ops/attendance-emails.cjs'),token=c=>c.repeat(43),player=(name,c)=>({playerId:'rec'+c.repeat(14),name,yesUrl:origin+'/respond#token='+token(c)+'&answer=yes',noUrl:origin+'/respond#token='+token(c)+'&answer=no',optOutUrl:origin+'/respond#token='+token(c.toUpperCase())+'&action=optout'}),packet={appOrigin:origin,players:[player('Alex','a')],session:{id:'rec00000000000001',date:'2026-11-04',label:'Wednesday training',time:'3:45–5:15 PM',location:'Connaught Park',startAt:'2026-11-04T22:45:00Z',endAt:'2026-11-05T00:15:00Z'}};
const held=E.registrationConfirmation('wednesday','2026-11-04','SS-REVIEWLINKS01','Alex','Jordan');assert.equal(held.deliveryHold,'attendance-links-required');const ready=E.registrationConfirmation('wednesday','2026-11-04','SS-REVIEWLINKS01','Alex','Jordan',packet);assert.equal(ready.attendanceIncluded,true);assert(ready.html.includes('Yes, attending'));assert(ready.html.includes('Can’t make it'));assert(!ready.html.includes('calendar.google.com'));assert.throws(()=>E.registrationConfirmation('wednesday','2026-11-04','SS-REVIEWLINKS01','Someone else','Jordan',packet));packet.players.push(player('Sam','b'));const multi=E.multipleRegistrationConfirmation({sessionId:'wednesday',date:'2026-11-04',reference:'SS-REVIEWLINKS02',players:['Alex','Sam'],parentName:'Jordan',attendance:packet});assert.equal(multi.attendanceIncluded,true);assert(multi.body.includes('Total: $60 CAD'));assert.equal((multi.html.match(/Yes, attending/g)||[]).length,2);});
test('coalesced roster reads retain confirmed marks across refresh, expire, and recover after failed reads',async()=>{
 const {createOverviewCache}=await import('../private-attendance/owner-overview.mjs');
 let now=Date.parse('2026-11-19T12:00:00Z');
 const reads=[];
 const cache=createOverviewCache(()=>new Promise((resolve,reject)=>reads.push({resolve,reject})),()=>now);
 const snapshot=()=>({observedAt:new Date(now).toISOString(),sessions:[{players:[
  {attendanceId:'a',actualAttendance:'Not marked'},{attendanceId:'b',actualAttendance:'Not marked'}
 ]}]});
 const marks=s=>s.sessions[0].players.map(p=>p.actualAttendance);
 const first=cache.read(),alsoFirst=cache.read(),refresh=cache.read({refresh:true});
 assert.equal(reads.length,1);
 cache.updateAttendance({attendanceId:'a',status:'Present'});
 reads[0].resolve(snapshot());
 for(const result of await Promise.all([first,alsoFirst,refresh]))assert.deepEqual(marks(result),['Present','Not marked']);
 const second=cache.read({refresh:true});
 cache.updateAttendance({attendanceId:'a',status:'Absent'});
 cache.updateAttendance({attendanceId:'b',status:'Present'});
 assert.deepEqual(marks(await cache.read()),['Absent','Present']);
 reads[1].resolve(snapshot());
 assert.deepEqual(marks(await second),['Absent','Present']);
 now+=300001;
 const expired=cache.read(),sharedError=cache.read();
 assert.equal(reads.length,3);
 reads[2].reject(Error('AIRTABLE_READ_FAILED'));
 const failures=await Promise.allSettled([expired,sharedError]);
 assert(failures.every(r=>r.status==='rejected'&&r.reason.message==='AIRTABLE_READ_FAILED'));
 const retry=cache.read();assert.equal(reads.length,4);
 reads[3].resolve(snapshot());
 assert.deepEqual(marks(await retry),['Not marked','Not marked']);
});
test('roster invalidation keeps an older in-flight read from replacing newer data',async()=>{
 const {createOverviewCache}=await import('../private-attendance/owner-overview.mjs');
 const reads=[],cache=createOverviewCache(()=>new Promise(resolve=>reads.push(resolve)));
 const old=cache.read();cache.invalidate();const fresh=cache.read();
 reads[1]({observedAt:new Date().toISOString(),sessions:[{id:'new',players:[]}]});
 await fresh;
 reads[0]({observedAt:new Date().toISOString(),sessions:[{id:'old',players:[]}]});
 await old;
 assert.equal((await cache.read()).sessions[0].id,'new');
});
test('Coach Desk additions appear when the player profile has no status',async()=>{
 const {buildOwnerOverview}=await import('../private-attendance/owner-overview.mjs');
 const row=(id,fields)=>({id,fields});
 const tables={
  sessions:[row('s',{Session:'Friday',Date:'2026-11-27',Time:'4 PM',Venue:'Field',Capacity:20,'Session status':'Planned'})],
  players:[row('p',{Player:'Fictional Player'})],families:[],
  bookings:[row('b',{'Booking type':'Drop-in','Booking status':'Accepted'})],
  attendance:[row('a',{Session:['s'],Player:['p'],Booking:['b'],'Coverage state':'Active',
   'Source coverage key':'coach:s:p','Session preparation status':'Excluded'})],
  enrollments:[],registrations:[]
 };
 assert.equal(buildOwnerOverview(tables,new Date().toISOString()).sessions[0].players.length,1);
 tables.attendance[0].fields['Source coverage key']='legacy';
 assert.equal(buildOwnerOverview(tables,new Date().toISOString()).sessions[0].players.length,0);
});
