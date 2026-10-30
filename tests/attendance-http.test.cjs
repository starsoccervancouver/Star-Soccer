const {test}=require('node:test'),assert=require('node:assert/strict');
const modules=()=>import('../private-attendance/local-server.mjs');
async function fixture(options={}){
 const calls={preview:[],respond:[],optOut:[]},service={
  health:()=>({mode:'demo'}),dashboard:()=>({sessions:[]}),
  preview:args=>{calls.preview.push(args);return {challenge:'fixture-challenge',version:0,playerName:'Alex',guardianName:'Jordan',sessionLabel:'Wednesday training',startAt:'2026-11-04T15:45:00-07:00',location:'Connaught Park'};},
  respond:args=>{calls.respond.push(args);return {response:args.answer,version:1,updatedAt:'2026-11-02T18:00:00Z'};},optOut:args=>{calls.optOut.push(args);return {optedOut:true};}
 };
 const {createServer}=await modules(),server=createServer({service,...options});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 const close=()=>new Promise(resolve=>server.close(resolve));
 const bootstrap=await fetch(origin+'/api/bootstrap'),cookie=bootstrap.headers.get('set-cookie').split(';')[0],csrf=(await bootstrap.json()).csrfToken;
 const headers={'Content-Type':'application/json',Origin:origin,Cookie:cookie,'X-CSRF-Token':csrf};
 const post=(path,value,extra={})=>fetch(origin+path,{method:'POST',headers:{...headers,...extra},body:JSON.stringify(value)});
 return {server,origin,service,calls,close,headers,post};
}
test('attendance GETs and link previews cannot record responses; fragments are never sent to the server',async t=>{
 const f=await fixture();t.after(f.close);
 const page=await fetch(f.origin+'/respond#token=fixture-token&answer=yes');assert.equal(page.status,200);assert.match(await page.text(),/Confirm response/);
 assert.equal((await fetch(f.origin+'/api/respond')).status,405);assert.equal((await fetch(f.origin+'/respond?token=secret')).status,400);
 const preview=await f.post('/api/preview',{token:'fixture-token',answer:'yes',action:'response'});assert.equal(preview.status,200);assert.equal(f.calls.preview.length,1);assert.equal(f.calls.respond.length,0);assert.equal(f.calls.optOut.length,0);
 assert.ok(f.calls.preview[0].csrfSession);assert.ok(!page.headers.has('Access-Control-Allow-Origin'));assert.equal(page.headers.get('referrer-policy'),'no-referrer');assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});
test('response writes require a browser session, correct origin, JSON and a matching CSRF header',async t=>{
 const f=await fixture();t.after(f.close);const data={token:'fixture-token',answer:'yes',challenge:'challenge',expectedVersion:0,idempotencyKey:'fixture-key'};
 for(const extra of [{Origin:'https://evil.invalid'},{Cookie:''},{'X-CSRF-Token':'wrong'},{'Content-Type':'text/plain'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await f.post('/api/respond',data,extra)).status,403);
 assert.equal(f.calls.respond.length,0);assert.equal((await f.post('/api/respond',{...data,playerId:'forged'})).status,400);assert.equal(f.calls.respond.length,0);
 const saved=await f.post('/api/respond',data);assert.equal(saved.status,200);assert.equal((await saved.json()).response,'yes');assert.equal(f.calls.respond.length,1);assert.equal(f.calls.respond[0].expectedVersion,0);
});
test('opt-out is explicit, purpose-routed and not performed by an email scanner GET',async t=>{
 const f=await fixture();t.after(f.close);assert.equal((await fetch(f.origin+'/api/optout')).status,405);assert.equal(f.calls.optOut.length,0);
 assert.equal((await f.post('/api/optout',{token:'optout-token',challenge:'challenge',idempotencyKey:'fixture-key'})).status,200);assert.equal(f.calls.optOut.length,1);assert.equal(f.calls.respond.length,0);
});
test('oversized bodies, incorrect methods and unexpected routes fail without business writes',async t=>{
 const f=await fixture({maxBodyBytes:200});t.after(f.close);assert.equal((await f.post('/api/respond',{token:'x'.repeat(300)})).status,413);assert.equal((await fetch(f.origin+'/assets/../service.mjs')).status,404);assert.equal(f.calls.respond.length,0);
 const broken=await fetch(f.origin+'/api/preview',{method:'POST',headers:f.headers,body:'{broken'});assert.equal(broken.status,400);
});
test('private demo cannot bind publicly or start in a production/non-fictional mode',async()=>{
 const {createServer}=await modules(),service={};assert.throws(()=>createServer({service,mode:'live'}),/fictional/);assert.throws(()=>createServer({service,fixtureOnly:false}),/fictional/);
 const server=createServer({service});assert.throws(()=>server.listen(8788,'0.0.0.0'),/loopback/);assert.throws(()=>server.listen({port:8788,host:'::'}),/loopback/);
});
test('request rate limits stop repeated requests and expose no raw service errors',async t=>{
 const f=await fixture({rateLimit:3});t.after(f.close);f.service.preview=()=>{const e=new Error('private-secret-details');e.code='unknown_internal_code';e.status=500;throw e;};
 const bad=await f.post('/api/preview',{token:'test'});assert.equal(bad.status,500);assert.ok(!(await bad.text()).includes('private-secret-details'));
 await fetch(f.origin+'/health');assert.equal((await fetch(f.origin+'/health')).status,429);assert.equal(f.calls.respond.length,0);
});
