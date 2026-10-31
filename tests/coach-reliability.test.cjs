const {test}=require('node:test'),assert=require('node:assert/strict');
const origin='https://attendance.starsoccer.ca',actor={email:'fictional@example.test',role:'owner'},sessionId='rec00000000000001';

test('disabled physical attendance stops before network, roster reads or command storage; reads and sign-in remain available',async t=>{
 const {createCoachAttendance}=await import('../private-attendance/coach-attendance.mjs'),{createCoachHandler}=await import('../private-attendance/coach-http.mjs');
 let reads=0,net=0,writes=0;
 const coaches={requireSession(){},scope:(_,v)=>v,notes:()=>[],tasks:()=>[]};
 const attendance=createCoachAttendance({store:{get(){writes++;},run(){writes++;}},coaches,baseId:'app00000000000000',tableId:'tbl00000000000000',token:'fictional',writesEnabled:false,fetchFn:async()=>{net++;throw Error('Unexpected request');}});
 t.mock.method(console,'warn',()=>{});
 const handler=createCoachHandler({coaches,attendance,auth:{session:()=>({actor,csrf:'csrf'})},cookieKey:'fictional-key',assets:{},overview:async()=>{reads++;return {sessions:[],observedAt:'2026-10-30T18:00:00Z',pendingSync:0};}});
 const response=await handler(new Request(origin+'/workspace/api/attendance',{method:'POST',headers:{origin,'content-type':'application/json','x-csrf-token':'csrf'},body:JSON.stringify({sessionId})}));
 assert.equal(response.status,503);assert.equal((await response.json()).error,'ATTENDANCE_WRITES_DISABLED');assert.equal(reads,0);assert.equal(net,0);assert.equal(writes,0);
 await assert.rejects(attendance.save(actor,{},null),/ATTENDANCE_WRITES_DISABLED/);
 assert.equal((await handler(new Request(origin+'/workspace/api/bootstrap'))).status,200);
 assert.equal((await handler(new Request(origin+'/workspace/api/desk'))).status,200);assert.equal(reads,1);
});

test('GET transport retries 429 and temporary failures inside its queue with bounded backoff',async()=>{
 const {createAirtableTransport}=await import('../private-attendance/airtable-transport.mjs');let now=1000,calls=0;const sleeps=[],order=[];
 const transport=createAirtableTransport({intervalMs:0,clock:()=>now,sleep:async ms=>{sleeps.push(ms);now+=ms;},fetchFn:async url=>{order.push(url);calls++;return calls===1?new Response('',{status:429,headers:{'Retry-After':'1'}}):calls===2?new Response('',{status:503}):new Response('{}');}});
 const results=await Promise.all([transport('first'),transport('second')]);assert(results.every(r=>r.ok));assert.deepEqual(order,['first','first','first','second']);assert.deepEqual(sleeps,[1000,1000]);
 let longCalls=0;const long=createAirtableTransport({intervalMs:0,fetchFn:async()=>{longCalls++;return new Response('',{status:429,headers:{'Retry-After':'30'}});},sleep:async()=>assert.fail('Must not sleep past budget')});
 assert.equal((await long('fictional')).status,429);assert.equal(longCalls,1);
 let attempts=0;const capped=createAirtableTransport({intervalMs:0,fetchFn:async()=>{attempts++;return new Response('',{status:503});},sleep:async()=>{}});assert.equal((await capped('fictional')).status,503);assert.equal(attempts,3);
});

test('transport retries network failures only for GET and never repeats uncertain PATCH',async()=>{
 const {createAirtableTransport}=await import('../private-attendance/airtable-transport.mjs');let attempts=0;
 const transport=createAirtableTransport({intervalMs:0,sleep:async()=>{},fetchFn:async()=>{attempts++;if(attempts===1)throw Error('Connection lost');return new Response('{}');}});
 assert((await transport('fictional')).ok);assert.equal(attempts,2);
 for(const fail of [async()=>{throw Error('Connection lost');},async()=>new Response('',{status:429})]){let patches=0;const patch=createAirtableTransport({intervalMs:0,fetchFn:async()=>{patches++;return fail();},sleep:async()=>assert.fail('PATCH must not retry')});try{await patch('fictional',{method:'PATCH'});}catch{}assert.equal(patches,1);}
});

test('API diagnostics correlate errors without exposing exception, URL, token or contact details',async t=>{
 const {createCoachHandler}=await import('../private-attendance/coach-http.mjs');const logs=[];t.mock.method(console,'warn',value=>logs.push(value));
 const secret='person@example.test https://example.test/callback?token=fictional-secret',handler=createCoachHandler({coaches:{},auth:{session:()=>({actor})},cookieKey:'fictional-key',assets:{},overview:async()=>{throw Object.assign(Error(secret),{code:'PRIVATE_TOKEN',status:401});}});
 const response=await handler(new Request(origin+'/workspace/api/desk')),body=await response.json();assert.equal(response.status,503);assert.equal(body.error,'SERVICE_UNAVAILABLE');assert.match(body.requestId,/^[a-f0-9]{32}$/);assert.equal(response.headers.get('x-request-id'),body.requestId);assert.equal(JSON.parse(logs[0]).requestId,body.requestId);assert.equal(body.retryable,true);
 assert(!JSON.stringify([body,logs]).includes(secret));assert(!JSON.stringify([body,logs]).includes('PRIVATE_TOKEN'));assert(!JSON.stringify([body,logs]).includes('example.test'));
});

test('shared diagram and plan validation preserve client errors without admitting arbitrary error codes',async()=>{
 const {safeFailure}=await import('../private-attendance/coach-diagnostics.mjs');
 for(const code of ['INVALID_DIAGRAM','INVALID_PLAN'])assert.deepEqual(safeFailure(Object.assign(Error('Private diagnostic text'),{code,status:400})),{code,status:400,retryable:false});
 assert.deepEqual(safeFailure(Object.assign(Error('Private diagnostic text'),{code:'PRIVATE_TOKEN',status:400})),{code:'SERVICE_UNAVAILABLE',status:503,retryable:true});
});

test('uncertain physical attendance is recovered by readback with one physical PATCH',async()=>{
 const {createCoachAttendance}=await import('../private-attendance/coach-attendance.mjs'),commands=new Map();let patches=0,reads=0;
 const attendanceId='rec00000000000002',playerId='rec00000000000003',record={id:attendanceId,fields:{'Attendance status':'Not marked',Player:[playerId],Session:[sessionId],'Coverage state':'Active','Session date':'2026-10-29','Web session date':['2026-10-29'],'Web session status':['Planned']}};
 const store={get:(_,id)=>commands.get(id),run:(sql,...args)=>{if(sql.startsWith('INSERT'))commands.set(args[0],{actor_email:args[1],payload:args[4],state:'pending'});else commands.get(args[0]).state='confirmed';}},coaches={requireSession(){},recordAudit(){}};
 const writer=createCoachAttendance({store,coaches,writesEnabled:true,baseId:'app00000000000000',tableId:'tbl00000000000000',token:'fictional',clock:()=>new Date('2026-10-30T18:00:00Z'),fetchFn:async(_,options)=>{if(options.method==='PATCH'){patches++;Object.assign(record.fields,JSON.parse(options.body).fields);throw Error('Network lost after commit');}reads++;return new Response(JSON.stringify(record));}});
 const input={commandId:'fictional_command_0001',sessionId,attendanceId,playerId,status:'Present',expectedStatus:'Not marked'},session={id:sessionId,date:'2026-10-29',status:'Planned',players:[{playerId,attendanceId}]};
 await assert.rejects(writer.save(actor,input,session),/ATTENDANCE_SYNC_PENDING/);assert.equal(commands.get(input.commandId).state,'pending');assert((await writer.save(actor,input,session)).recovered);assert((await writer.save(actor,input,session)).duplicate);assert.equal(patches,1);assert.equal(reads,3);
 record.fields['Attendance status']='Absent';
 const retry=await writer.save(actor,input,session);assert.equal(retry.status,'Absent');assert.equal(retry.duplicate,true);assert.equal(retry.superseded,true);assert.equal(patches,1,'An old retry must never restore its previous status');
 record.fields['Attendance status']='Unrecognized';await assert.rejects(writer.save(actor,input,session),/ATTENDANCE_CHANGED/);assert.equal(patches,1);
});
