import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {dirname,resolve,relative,sep,isAbsolute} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateClubConfig} from '../private-attendance/club-config.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
// Explicit source allowlist. Never recurse through the operating workspace.
export const SOURCE_FILES = Object.freeze([
  'package.json','pnpm-lock.yaml',
  ...['airtable-adapter','airtable-roster','airtable-transport','coach-attendance','coach-auth','coach-google-auth','coach-http','coach-store','tactics-validation','club-config','deployment-config','migration','owner-auth','owner-overview','preference-adapter','production-http','schema','service','sqlite-store'].map(name=>'private-attendance/'+name+'.mjs'),
  ...['build-assets','production-worker','storage','worker'].map(name=>'private-attendance/cloudflare/'+name+'.mjs'),
  ...['app.css','coach.html','coach.js','email-preview.html','email-preview.js','landing.html','overview.css','overview.html','overview.js','parent.js','respond.html','workspace.html','workspace.js','workspace.css','workspace-coaching.js','workspace-coaching.css','workspace-dictation.js','workspace-session.js','workspace-session.css','workspace-tactics.js','workspace-tactics.css','workspace-groups.js','workspace-folders.js','workspace-folders.css','workspace-planner.js','workspace-library.js','workspace-library.css'].map(name=>'private-attendance/web/'+name),
  ...['manrope-normal-latin.woff2','instrument-serif-italic-latin.woff2','manrope-OFL.txt','instrumentserif-OFL.txt'].map(name=>'fonts/'+name),
  ...['coach-store.test.cjs','coach-tactics.test.cjs','coach-drills.test.cjs','coach-tactics-ui.cjs','coach-tactics-integration.cjs','coach-settings-ui.cjs','coach-planner-layout-ui.cjs','coach-focus-planner-ui.cjs','coach-library-ui.cjs','coach-audit-safety-ui.cjs','coach-notes-drawer-ui.cjs','coach-tasks-workflow-ui.cjs','coach-reuse-budget-ui.cjs','coach-fixture-fonts.cjs','coach-fixture-navigation.cjs','coach-groups.test.cjs','coach-folders-ui.cjs','coach-group-workspace-ui.cjs','coach-google-auth.test.cjs','coach-google-http.test.cjs','attendance-service.test.cjs','attendance-roster.test.cjs'].map(name=>'tests/'+name),
  'private-attendance/REUSE.md','private-attendance/TACTICS.md'
]);

export async function exportCoachDesk({destination, config}) {
  const club = validateClubConfig(config), target = resolve(destination), root = await realpath(repository);
  const rel = relative(root, target);
  if (!rel || !rel.startsWith('..'+sep) && rel !== '..' && !isAbsolute(rel)) throw Error('EXPORT_MUST_BE_OUTSIDE_SOURCE');
  // Refuse any existing destination, including symlinks; no overwrites or deletes.
  try { await lstat(target); throw Error('EXPORT_DESTINATION_EXISTS'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parent = await realpath(dirname(target));
  if (parent !== dirname(target)) throw Error('EXPORT_PARENT_MUST_BE_REAL_DIRECTORY');
  const prepared=[];
  for (const path of SOURCE_FILES) {
    const source=resolve(root,path),stat=await lstat(source);
    if(!stat.isFile()||stat.isSymbolicLink()||await realpath(source)!==source)throw Error('EXPORT_REQUIRES_REGULAR_SOURCE_FILES');
    let body=await readFile(source);
    if(!path.endsWith('.woff2')){
      let text=body.toString('utf8').replaceAll('https://attendance.starsoccer.ca','https://coach.example.invalid').replaceAll('starsoccervancouver@gmail.com','owner@example.invalid').replaceAll('https://starsoccer.ca','https://club.example.invalid').replaceAll('Star Soccer','Community Club');
      if(path==='private-attendance/deployment-config.mjs')text=text.replace('export function deploymentIdentity(env = {}) {',"export function deploymentIdentity(env = {}) {\n  if (!env.COACH_ORIGIN || !env.COACH_OWNER_EMAIL || !env.COACH_OWNER_NAME || env.COACH_ORIGIN.includes('example.invalid') || env.COACH_OWNER_EMAIL.endsWith('@example.invalid')) throw Error('EXPLICIT_CLUB_IDENTITY_REQUIRED');");
      // Generic owner fixtures use a verified hosted-domain claim. Keep the test
      // for unsupported third-party mailbox claims unchanged, and never relax auth.
      if(path==='tests/coach-google-auth.test.cjs')text=text.replace('email:OWNER_EMAIL,email_verified:true,...overrides',"email:OWNER_EMAIL,email_verified:true,...(!overrides.email?{hd:'example.invalid'}:{}),...overrides");
      if(path==='private-attendance/cloudflare/production-worker.mjs')text=text.replace("this.coachOnly=origin!==STAR_SOCCER_ORIGIN||env.COACH_DESK_ONLY==='true';","this.coachOnly=true;");
      if(path==='package.json'){const pkg=JSON.parse(text);pkg.name='coach-desk-club-starter';pkg.scripts={test:'node --test tests/*.test.cjs','test:tactics:browser':'node tests/coach-tactics-ui.cjs && node tests/coach-tactics-integration.cjs','test:settings:browser':'node tests/coach-settings-ui.cjs','test:planner:browser':'node tests/coach-planner-layout-ui.cjs && node tests/coach-focus-planner-ui.cjs && node tests/coach-library-ui.cjs','test:audit:browser':'node tests/coach-audit-safety-ui.cjs && node tests/coach-notes-drawer-ui.cjs && node tests/coach-tasks-workflow-ui.cjs && node tests/coach-reuse-budget-ui.cjs',build:'node private-attendance/cloudflare/build-assets.mjs'};text=JSON.stringify(pkg,null,2)+'\n';}
      body=Buffer.from(text);
    }
    prepared.push({path,body});
  }
  prepared.push({path:'private-attendance/club-config.json',body:Buffer.from(JSON.stringify(club,null,2)+'\n')});
  prepared.push({path:'private-attendance/web/logo.svg',body:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 60"><rect width="160" height="60" rx="10" fill="#10263d"/><text x="80" y="37" text-anchor="middle" font-family="sans-serif" font-size="22" fill="#e7c59a">Coach Desk</text></svg>\n')});
  const workerName='coach-desk-new-club-'+createHash('sha256').update(target).digest('hex').slice(0,8);
  prepared.push({path:'private-attendance/cloudflare/wrangler.club.toml',body:Buffer.from(`name = "${workerName}"\nmain = "production-worker.mjs"\ncompatibility_date = "2026-10-28"\ncompatibility_flags = ["nodejs_compat"]\nworkers_dev = false\npreview_urls = false\n\n[build]\ncommand = "node build-assets.mjs"\n\n[vars]\nATTENDANCE_MODE = "disabled"\nOWNER_APPROVED = "false"\nLIVE_EMAIL_SENDS = "false"\nLIVE_AIRTABLE_WRITES = "false"\nCOACH_DASHBOARD_ENABLED = "false"\nCOACH_DESK_ONLY = "true"\n# Set COACH_ORIGIN, COACH_OWNER_EMAIL and COACH_OWNER_NAME after reviewing REUSE.md.\n\n[[durable_objects.bindings]]\nname = "ATTENDANCE_COORDINATOR"\nclass_name = "AttendanceCoordinator"\n\n[[migrations]]\ntag = "v1-new-club"\nnew_sqlite_classes = ["AttendanceCoordinator"]\n`) });
  prepared.push({path:'.gitignore',body:Buffer.from('node_modules/\noutputs/\n.env*\n*.dpapi\n*.pending\nprivate-attendance/data/\nprivate-attendance/.state/\nprivate-attendance/**/*.sqlite*\nprivate-attendance/**/*.db\nprivate-attendance/cloudflare/.wrangler/\nprivate-attendance/cloudflare/.dev.vars*\nprivate-attendance/cloudflare/assets.generated.mjs\nprivate-attendance/cloudflare/wrangler.live.toml\n')});
  prepared.push({path:'README.md',body:Buffer.from('# Coach Desk club starter\n\nThis is a source-only, disabled starter with no player records, users, credentials, live domain, or email integration. Read [the reuse guide](private-attendance/REUSE.md) before setup.\n\nRun `pnpm install --frozen-lockfile`, `pnpm test`, then `pnpm build`. Deploy only after independently provisioning the new club’s private connections and reviewing the isolated configuration. Parent response routes are disabled in this starter.\n')});
  await mkdir(target);
  for(const file of prepared){const output=resolve(target,file.path);await mkdir(dirname(output),{recursive:true});await writeFile(output,file.body,{flag:'wx'});}
  const manifest=prepared.map(file=>({path:file.path,sha256:createHash('sha256').update(file.body).digest('hex')}));
  await writeFile(resolve(target,'source-manifest.json'),JSON.stringify({schemaVersion:1,containsPrivateData:false,automaticDeployment:false,files:manifest},null,2)+'\n',{flag:'wx'});
  return {directory:target,files:prepared.length+1,deployable:false};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [destination,configPath,...rest]=process.argv.slice(2);
  if(!destination||!configPath||rest.length)throw Error('Usage: node scripts/export-coach-desk.mjs NEW_DIRECTORY PUBLIC_CLUB_CONFIG_JSON');
  const result=await exportCoachDesk({destination,config:JSON.parse(await readFile(resolve(configPath),'utf8'))});
  console.log('Prepared '+result.files+' source files in a new, disabled club starter. No records, credentials or deployment copied.');
}
