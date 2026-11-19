const {test}=require('node:test');
const assert=require('node:assert/strict');

test('only the preview cookie reads the limited Owner projection, for thirty minutes',async()=>{
 const {createCoachHandler}=await import('../private-attendance/coach-http.mjs');
 const {createFamilyLedger}=await import('../private-attendance/family-ledger.mjs');
 const origin='https://starsoccer.ca',basePath='/coachdesk',prefix=origin+basePath;
 const owner={email:'owner@example.test',role:'owner',sessionVersion:3};
 let now=Date.parse('2026-11-20T01:00:00Z'),reads=0;
 const coaches={owner:a=>assert.equal(a.role,'owner'),actor:()=>owner,scope:(_,v)=>v};
 const familyLedger=createFamilyLedger(async(table,fields)=>{
   assert.deepEqual(fields,['Balance CAD','Due now total CAD','Verified family receipts CAD']);
   return [{id:'family-1',fields:{'Due now total CAD':0}}];
 });
 const handler=createCoachHandler({origin,basePath,coaches,familyLedger,auth:{session:()=>null},assets:{},
   clock:()=>now,cookieKey:'test-only-cookie-key',googleAuth:{finish:()=>({previewOwner:owner})},
   overview:async()=>{reads++;return {observedAt:new Date(now).toISOString(),sessions:[
     {id:'included',date:'2026-11-06',players:[{playerId:'p',name:'private name',attendanceId:'a'}]},
     {id:'later',date:'2026-11-26',players:[]}
   ]};}});
 const page=prefix+'/operations-preview';
 const request=(url,cookie,method='GET')=>handler(new Request(url,{method,headers:cookie?{cookie}:{}}));
 assert.equal((await request(page)).status,401);
 const callback=await request(prefix+'/api/auth/google/callback?state=preview.'+'s'.repeat(43)+'&code=code');
 const cookies=callback.headers.getSetCookie();
 assert.equal(callback.status,303);
 assert.equal(cookies.some(c=>c.startsWith('__Host-ss_staff=')),false);
 const cookie=cookies.find(c=>c.startsWith('__Host-ss_operations_read=')).split(';')[0];
 assert.equal((await request(page,cookie,'POST')).status,405);
 assert.equal((await request(prefix+'/api/families',cookie)).status,401);
 const response=await request(page,cookie);
 assert.equal(response.status,200);
 const data=await response.json();
 assert.equal(data.permission,'operations:read');
 assert.deepEqual(data.sessionWindow,{start:'2026-11-06',end:'2026-11-25'});
 assert.deepEqual(data.sessions.map(s=>s.sessionId),['included']);
 assert.equal(data.sessions[0].players[0].name,undefined);
 assert.deepEqual(data.balances,[{familyId:'family-1',balance:null,dueNow:0,verifiedReceipts:null}]);
 now+=30*60*1000;
 assert.equal((await request(page,cookie)).status,401);
 assert.equal(reads,1);
});
