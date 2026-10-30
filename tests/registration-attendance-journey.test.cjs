const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');

// Starts after staff have accepted the booking. Every identity and remote record is fictional.
// This test does not assert FormSubmit delivery, registration intake or a sent email.
test('accepted sibling roster produces scoped confirmation buttons and saves one RSVP with verified mock readback',async t=>{
  const [{normalizeAirtableRoster},{openStore},{createService},{createProductionHandler},{createAirtableAdapter,projectOutbox},{attendanceArguments}]=await Promise.all([
    import('../private-attendance/airtable-roster.mjs'),import('../private-attendance/sqlite-store.mjs'),
    import('../private-attendance/service.mjs'),import('../private-attendance/production-http.mjs'),
    import('../private-attendance/airtable-adapter.mjs'),import('../private-attendance/prepare-draft.mjs')
  ]);
  const E=require('../ops/attendance-emails.cjs'),id=n=>'rec'+String(n).padStart(14,'0'),row=(n,fields)=>({id:id(n),fields});
  const origin='https://attendance.starsoccer.ca',at='2026-11-02T18:00:00.000Z',clock=()=>new Date(at);
  const fixture={observedAt:at,revision:1,verifiedContacts:{[id(3)]:{email:'fixture@example.invalid',evidence:'Fictional verified contact for isolated test'}},tables:{
    sessions:[row(1,{Session:'Wednesday',Date:'2026-11-04',Time:'3:45 pm – 5:15 pm',Venue:'Connaught Park',Capacity:20,'Session status':'Planned','Weekly program':[id(9)],Attendance:[id(4),id(14)]})],
    families:[row(3,{'Guardian name':'Fixture Parent',Email:'fixture@example.invalid'})],
    players:[row(2,{Player:'Fixture Player One','Player status':'Active',Family:[id(3)]}),row(12,{Player:'Fixture Player Two','Player status':'Active',Family:[id(3)]})],
    bookings:[row(5,{'Booking type':'Drop-in','Booking status':'Accepted',Player:[id(2)],Family:[id(3)],'Covered dates':'2026-11-04'}),row(15,{'Booking type':'Drop-in','Booking status':'Accepted',Player:[id(12)],Family:[id(3)],'Covered dates':'2026-11-04'})],
    attendance:[row(4,{Player:[id(2)],Session:[id(1)],Booking:[id(5)],'Coverage state':'Active','Session date':'2026-11-04','Attendance status':'Not marked','RSVP status':'Not requested'}),row(14,{Player:[id(12)],Session:[id(1)],Booking:[id(15)],'Coverage state':'Active','Session date':'2026-11-04','Attendance status':'Not marked','RSVP status':'Not requested'})],
    enrollments:[row(6,{Player:[id(2)],Family:[id(3)],'Enrollment status':'Active','Weekly attendance email preference':'Enabled'}),row(16,{Player:[id(12)],Family:[id(3)],'Enrollment status':'Active','Weekly attendance email preference':'Enabled'})],registrations:[]
  }};
  const normalized=normalizeAirtableRoster(fixture),store=openStore();t.after(()=>store.close());
  const service=createService({store,origin,mode:'live',clock,activation:{ownerApproved:true,exclusiveWriter:true,draftOnly:true,handoffEvidence:'Fictional isolated integration fixture'}});
  service.importRoster(normalized.snapshot);service.seedHistory(normalized.history);
  const invitations=[2,12].map(player=>{const target={playerId:id(player),sessionId:id(1)};return {...service.issueInvitation(target),context:service.draftContext(target)};});
  const args=invitations.map(attendanceArguments);
  const draft=E.multipleRegistrationConfirmation({sessionId:'wednesday',date:'2026-11-04',reference:'SS-FIXTURE-123456',players:args.map(a=>a.players[0].name),parentName:'Fixture Parent',attendance:{...args[0],players:args.flatMap(a=>a.players)}});
  assert.equal(draft.draftOnly,true);assert.equal(draft.attendanceIncluded,true);
  assert.match(draft.body,/Hi Fixture Parent,/);assert.match(draft.body,/Total: \$60 CAD/);assert.match(draft.body,/e-transfer/);
  for(const invite of invitations){assert(draft.html.includes(invite.yesUrl.replaceAll('&','&amp;')));assert(draft.html.includes(invite.noUrl.replaceAll('&','&amp;')));}
  assert(!draft.html.includes('calendar.google.com'));assert.equal(service.listOutbox().length,0);

  const fields={rsvpStatus:'fld00000000000001',rsvpUpdatedAt:'fld00000000000002',rsvpNotes:'fld00000000000003',player:'fld00000000000004',session:'fld00000000000005'};
  const remote={id:id(4),fields:{[fields.player]:[id(2)],[fields.session]:[id(1)],[fields.rsvpNotes]:'Coach-entered context','Attendance status':'Not marked','Booking status':'Accepted'}};
  const calls=[],baseId='app00000000000000',tableId='tbl00000000000000';
  const adapter=createAirtableAdapter({baseId,tableId,fields,clock,dryRun:false,exclusiveWriter:true,token:'fictional-fixture',approval:{ownerApproved:true,scope:'attendance-rsvp-only',baseId,tableId,approvedAt:at,expiresAt:'2026-11-03T18:00:00.000Z',handoffEvidence:'Fictional fixture only'},fetchFn:async(url,options)=>{
    calls.push(options.method);
    assert(url.includes('/'+id(4)+'?'));
    if(options.method==='PATCH')Object.assign(remote.fields,JSON.parse(options.body).fields);
    return new Response(JSON.stringify(remote));
  }});
  const handler=createProductionHandler({service,origin,adminKey:'a'.repeat(43),cookieKey:'b'.repeat(43),clock:()=>Date.parse(at),assets:{'/respond':{body:'Fixture response page',type:'text/html'}},refreshRoster:async()=>{},flush:async()=>{await projectOutbox({service,adapter});return {pending:service.listOutbox().length};}});
  // Email scanners and page previews cannot mark either sibling as attending.
  assert.equal((await handler(new Request(invitations[0].yesUrl))).status,200);
  assert.equal(calls.length,0);assert.equal(service.listOutbox().length,0);
  const bootstrap=await handler(new Request(origin+'/api/bootstrap')),cookie=bootstrap.headers.get('set-cookie').split(';')[0],csrf=(await bootstrap.json()).csrfToken;
  const post=(path,body)=>handler(new Request(origin+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie,'x-csrf-token':csrf},body:JSON.stringify(body)}));
  const preview=await (await post('/api/preview',{token:invitations[0].token,answer:'yes'})).json();
  const command={token:invitations[0].token,answer:'yes',challenge:preview.challenge,expectedVersion:preview.version,idempotencyKey:randomBytes(20).toString('hex')};
  const response=await post('/api/respond',command);assert.equal(response.status,200);assert.equal((await response.json()).syncPending,false);
  assert.deepEqual(calls,['GET','PATCH','GET']);assert.equal(service.listOutbox().length,0);
  assert.equal(remote.fields[fields.rsvpStatus],'Yes');assert.equal(remote.fields['Attendance status'],'Not marked');assert.equal(remote.fields['Booking status'],'Accepted');
  const players=service.dashboard().sessions[0].players;
  assert.equal(players.find(p=>p.playerId===id(2)).response,'yes');assert.equal(players.find(p=>p.playerId===id(12)).response,null);
  assert.equal((await post('/api/respond',command)).status,200);assert.equal(calls.filter(x=>x==='PATCH').length,1);
});
