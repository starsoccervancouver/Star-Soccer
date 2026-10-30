import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,rmdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const configPath='private-attendance/cloudflare/wrangler.live.toml';
export function validateReleaseConfig(source){
 const values=new Map();let section='';
 for(const raw of source.split(/\r?\n/)){
  const line=raw.trim();if(!line||line.startsWith('#'))continue;
  if(line.startsWith('[')){section=line;continue;}
  const match=line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);if(!match)continue;
  if(section!==''&&section!=='[vars]'&&section!=='[build]')continue;
  const key=section+match[1];if(values.has(key))throw Error('Duplicate release setting');values.set(key,match[2].replace(/\s+#.*$/,'').trim());
 }
 const expected={name:'"star-soccer-private-attendance"',main:'"production-worker.mjs"',workers_dev:'false',preview_urls:'false','[build]command':'"node build-assets.mjs"','[vars]COACH_MAIN_ORIGIN':'"https://starsoccer.ca"','[vars]COACH_MAIN_PATH':'"/coachdesk"','[vars]COACH_MAIN_SIGNIN_READY':'"true"','[vars]COACH_DASHBOARD_ENABLED':'"true"','[vars]ATTENDANCE_MODE':'"live"','[vars]OWNER_APPROVED':'"true"','[vars]LIVE_AIRTABLE_WRITES':'"true"','[vars]LIVE_EMAIL_SENDS':'"false"'};
 for(const [key,value]of Object.entries(expected))if(values.get(key)!==value)throw Error('Release configuration does not match the approved deployment');
 if(source.includes('[env.')||source.includes('[[env.'))throw Error('Environment overrides require separate review');
}
export function withReleaseLock(folder,action){
 try{mkdirSync(folder);}catch{throw Error('Release lock exists or is unavailable; verify its owner before manual recovery');}
 try{return action();}finally{rmdirSync(folder);}
}
function command(name,args){
 try{
  // All pnpm arguments below are fixed constants. Keep output private, including tool failures.
  return execFileSync(process.platform==='win32'&&name==='pnpm'?'cmd.exe':name,process.platform==='win32'&&name==='pnpm'?['/d','/s','/c','pnpm '+args.join(' ')]:args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
 }catch{throw Error('Release command failed: '+name+' '+args[0]);}
}
export function release({deploy=false,run=command,read=path=>readFileSync(resolve(root,path),'utf8'),lock=withReleaseLock}={}){
 const common=resolve(root,run('git',['rev-parse','--git-common-dir']));
 return lock(resolve(common,'coach-desk-release.lock'),()=>{
  const clean=()=>{if(run('git',['status','--porcelain','--untracked-files=all']))throw Error('Commit all source changes and remove untracked source before release');};
  clean();run('git',['check-ignore',configPath]);const config=read(configPath);validateReleaseConfig(config);
  run('git',['fetch','origin','main']);
  const parity=()=>{if(run('git',['rev-parse','HEAD^{tree}'])!==run('git',['rev-parse','refs/remotes/origin/main^{tree}']))throw Error('Release source must match origin/main exactly');};
  parity();run(process.execPath,['private-attendance/cloudflare/build-assets.mjs']);clean();parity();
  if(read(configPath)!==config)throw Error('Release configuration changed during verification');
  if(deploy)run('pnpm',['dlx','wrangler@4.46.0','deploy','--config',configPath]);
  return deploy?'Deployment command completed. Verify both coach entries before closing the release.':'Release checks passed; no deployment requested.';
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{const args=process.argv.slice(2);if(args.length>1||args.some(arg=>!['--check','--deploy'].includes(arg)))throw Error('Use --check (default) or explicit --deploy');console.log(release({deploy:args[0]==='--deploy'}));}catch(error){console.error(error.message);process.exitCode=1;}
}
