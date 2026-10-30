const {test}=require('node:test'),assert=require('node:assert/strict');
const config=`name = "star-soccer-private-attendance"
main = "production-worker.mjs"
workers_dev = false
preview_urls = false
[build]
command = "node build-assets.mjs"
[vars]
COACH_MAIN_ORIGIN = "https://starsoccer.ca"
COACH_MAIN_PATH = "/coachdesk"
COACH_MAIN_SIGNIN_READY = "true"
COACH_DASHBOARD_ENABLED = "true"
ATTENDANCE_MODE = "live"
OWNER_APPROVED = "true"
LIVE_AIRTABLE_WRITES = "true"
LIVE_EMAIL_SENDS = "false"`;
test('release configuration preserves the existing activation and rejects email sending or changed targets',async()=>{
 const {validateReleaseConfig}=await import('../scripts/release-coach-desk.mjs');validateReleaseConfig(config);
 for(const changed of [config.replace('LIVE_EMAIL_SENDS = "false"','LIVE_EMAIL_SENDS = "true"'),config.replace('/coachdesk','/other'),config.replace('star-soccer-private-attendance','new-worker'),config+'\nLIVE_EMAIL_SENDS = "false"',config+'\n[env.production]'])assert.throws(()=>validateReleaseConfig(changed));
});
test('release defaults to build/check only and refuses dirty or divergent source before deployment',async()=>{
 const {release}=await import('../scripts/release-coach-desk.mjs');
 const invoke=({dirty=false,divergent=false,deploy=false}={})=>{const calls=[],run=(name,args)=>{calls.push([name,...args]);if(args[0]==='status')return dirty?'?? untracked.txt':'';if(args[1]==='--git-common-dir')return '.git';if(args[1]==='HEAD^{tree}')return 'tree';if(args[1]==='refs/remotes/origin/main^{tree}')return divergent?'other':'tree';return '';};return {calls,go:()=>release({deploy,run,read:()=>config,lock:(_,work)=>work()})};};
 const check=invoke();check.go();assert(!check.calls.some(row=>row.includes('deploy')));assert(check.calls.some(row=>row.includes('private-attendance/cloudflare/build-assets.mjs')));
 for(const opts of [{dirty:true},{divergent:true}]){const check=invoke({...opts,deploy:true});assert.throws(check.go);assert(!check.calls.some(row=>row.includes('deploy')));}
 const live=invoke({deploy:true});live.go();assert.deepEqual(live.calls.at(-1),['pnpm','dlx','wrangler@4.46.0','deploy','--config','private-attendance/cloudflare/wrangler.live.toml']);
});
test('release lock never removes a lock owned by another invocation',async()=>{
 const {withReleaseLock}=await import('../scripts/release-coach-desk.mjs'),{mkdtempSync,rmdirSync,existsSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path'),folder=mkdtempSync(join(tmpdir(),'coach-release-')),lock=join(folder,'lock');
 try{withReleaseLock(lock,()=>{assert.throws(()=>withReleaseLock(lock,()=>assert.fail('Concurrent release')));assert(existsSync(lock));});assert(!existsSync(lock));}finally{rmdirSync(folder);}
});
