const {test}=require('node:test'),assert=require('node:assert/strict');
test('public bundles bypass the coordinator; private APIs and parent routes retain their writer',async()=>{
 const [{default:worker},{publicCoachBuilds:builds,coachBuildMetrics:metrics}]=await Promise.all([import('../private-attendance/cloudflare/production-worker.mjs'),import('../private-attendance/cloudflare/assets.generated.mjs')]);
 let calls=0;const env={ATTENDANCE_MODE:'live',LIVE_EMAIL_SENDS:'false',OWNER_APPROVED:'true',ADMIN_KEY:'preview',COOKIE_KEY:'preview',AIRTABLE_TOKEN:'preview',AIRTABLE_CONFIG:'{}',COACH_DASHBOARD_ENABLED:'true',COACH_MAIN_ORIGIN:'https://starsoccer.ca',COACH_MAIN_PATH:'/coachdesk',COACH_MAIN_SIGNIN_READY:'true',ATTENDANCE_COORDINATOR:{idFromName:()=>1,get:()=>({fetch:()=>{calls++;return new Response('private',{headers:{'Cache-Control':'no-store'}});}})}};
 for(const [origin,base]of [['https://starsoccer.ca','/coachdesk'],['https://attendance.starsoccer.ca','/workspace']]){
  const page=await worker.fetch(new Request(origin+base),env);assert.equal(page.status,200);assert.equal(page.headers.get('cache-control'),'no-store');const html=await page.text();assert.equal((html.match(/<script[^>]+src=/g)||[]).length,1);assert.equal((html.match(/rel="stylesheet"/g)||[]).length,1);assert(html.includes(builds[base].jsPath));
  const response=await worker.fetch(new Request(origin+builds[base].jsPath,{headers:{cookie:'__Host-ss_staff=fictional'}}),env);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/immutable/);assert(!response.headers.has('set-cookie'));assert.equal(await response.text(),builds[base].js);
  const conditional=await worker.fetch(new Request(origin+builds[base].jsPath,{headers:{'If-None-Match':response.headers.get('etag')}}),env);assert.equal(conditional.status,304);assert.equal(await conditional.text(),'');
  const compressed=await worker.fetch(new Request(origin+builds[base].jsPath,{headers:{'If-None-Match':'W/'+response.headers.get('etag')}}),env);assert.equal(compressed.status,304);
  assert.equal((await worker.fetch(new Request(origin+builds[base].cssPath,{method:'HEAD'}),env)).status,200);
  const logo=await worker.fetch(new Request(origin+base+'/assets/logo.svg'),env);assert.equal(logo.status,200);assert.match(logo.headers.get('cache-control'),/must-revalidate/);
 }
 assert.equal(calls,0,'No public asset touches the private writer');
 const pending={...env,COACH_MAIN_SIGNIN_READY:'false'};
 const shortcut=await worker.fetch(new Request('https://starsoccer.ca/coachdesk'),pending);assert.equal(shortcut.status,302);assert.equal(shortcut.headers.get('location'),'https://attendance.starsoccer.ca/workspace');assert.equal(shortcut.headers.get('cache-control'),'no-store');
 assert.equal((await worker.fetch(new Request('https://starsoccer.ca/coachdesk/api/bootstrap'),pending)).status,404);assert.equal(calls,0);
 await worker.fetch(new Request('https://starsoccer.ca/coachdesk/api/desk'),env);await worker.fetch(new Request('https://attendance.starsoccer.ca/respond?token=private'),env);assert.equal(calls,2);
 assert.equal((await worker.fetch(new Request('https://starsoccer.ca/coachdesk-unrelated'),env)).status,404);assert.equal((await worker.fetch(new Request('https://evil.test/coachdesk'),env)).status,404);assert.equal((await worker.fetch(new Request('https://attendance.starsoccer.ca/coachdesk'),env)).status,404);
 assert(metrics.bundleBytes<metrics.sourceBytes);assert(metrics.bundleGzipBytes<metrics.sourceGzipBytes);assert.equal(metrics.bundleRequests,2);
});
test('main-site sign-in uses the exact new callback and keeps strict origin/path/CSRF guards',async t=>{
 const [{openStore},{createCoachStore,OWNER_EMAIL},{createCoachAuth},{createCoachHandler},{createCoachGoogleAuth}]=await Promise.all([import('../private-attendance/sqlite-store.mjs'),import('../private-attendance/coach-store.mjs'),import('../private-attendance/coach-auth.mjs'),import('../private-attendance/coach-http.mjs'),import('../private-attendance/coach-google-auth.mjs')]);
 const store=openStore();t.after(()=>store.close());const origin='https://starsoccer.ca',basePath='/coachdesk',coaches=createCoachStore({store}),auth=createCoachAuth({store,coaches,origin,basePath}),google=createCoachGoogleAuth({store,coaches,auth,origin,basePath,clientId:'preview.apps.googleusercontent.com',clientSecret:'fictional-secret',fetchFn:()=>{throw Error('No external requests');}});
 const start=google.start({browser:'b'.repeat(43)});assert.equal(new URL(start.url).searchParams.get('redirect_uri'),origin+basePath+'/api/auth/google/callback');
 const handler=createCoachHandler({coaches,auth,origin,basePath,googleAuth:{start:()=>start,finish:()=>auth.createVerifiedSession(OWNER_EMAIL)},cookieKey:'k'.repeat(43),overview:async()=>({sessions:[]}),assets:{}});
 const bootstrap=await handler(new Request(origin+basePath+'/api/bootstrap')),body=await bootstrap.json();assert.equal(bootstrap.status,200);assert.equal(body.profile,null);assert.equal(bootstrap.headers.get('cache-control'),'no-store');
 const cookie=bootstrap.headers.get('set-cookie').split(';')[0];assert.equal((await handler(new Request(origin+basePath+'/api/auth/google/start',{method:'POST',headers:{origin:'https://attendance.starsoccer.ca',cookie,'x-csrf-token':body.csrfToken,'Content-Type':'application/json'},body:'{}'}))).status,403);
 const callback=await handler(new Request(origin+basePath+'/api/auth/google/callback?code=fixture&state=fixture',{headers:{cookie:'__Host-ss_google_flow='+'b'.repeat(43)}}));assert.equal(callback.status,303);assert.equal(callback.headers.get('location'),basePath);assert(callback.headers.getSetCookie().some(value=>value.includes('__Host-ss_staff=')&&value.includes('HttpOnly; Secure; SameSite=Strict')));
 assert.equal((await handler(new Request(origin+'/workspace/api/bootstrap'))).status,404);assert.equal((await handler(new Request(origin+'/coachdesk-extra/api/bootstrap'))).status,404);assert.equal((await handler(new Request('https://evil.test/coachdesk/api/bootstrap'))).status,404);
 assert.match(auth.issueInvite(coaches.actor(OWNER_EMAIL),OWNER_EMAIL).url,/^https:\/\/starsoccer\.ca\/coachdesk#enroll=/);
});
