import {readFile,writeFile} from 'node:fs/promises';
import {validateClubConfig,clubConfigScript} from '../club-config.mjs';
const files={html:'respond.html',landing:'landing.html',css:'app.css',parentJS:'parent.js',logo:'logo.svg',overview:'overview.html',overviewCSS:'overview.css',overviewJS:'overview.js',emailPreview:'email-preview.html',emailPreviewJS:'email-preview.js',workspace:'workspace.html',workspaceCSS:'workspace.css',workspaceJS:'workspace.js',dictationJS:'workspace-dictation.js',coachingJS:'workspace-coaching.js',coachingCSS:'workspace-coaching.css',sessionJS:'workspace-session.js',sessionCSS:'workspace-session.css',libraryJS:'workspace-library.js',libraryCSS:'workspace-library.css',plannerJS:'workspace-planner.js',tacticsJS:'workspace-tactics.js',tacticsCSS:'workspace-tactics.css'};
let output='// Generated from the reviewed parent UI. Do not edit.\n';
const club=validateClubConfig(JSON.parse(await readFile(new URL('../club-config.json',import.meta.url),'utf8')));
output+='export const clubConfig='+JSON.stringify(club)+';\n';
output+='export const clubJS='+JSON.stringify(clubConfigScript(club))+';\n';
for(const [name,file]of Object.entries(files))output+='export const '+name+'='+JSON.stringify(await readFile(new URL('../web/'+file,import.meta.url),'utf8'))+';\n';
output+='export const passkeysJS='+JSON.stringify(await readFile(new URL('../../node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js',import.meta.url),'utf8'))+';\n';
// Reuse the public site's licensed fonts without requests to a third-party CDN.
for(const [name,file]of Object.entries({workspaceManropeFont:'manrope-normal-latin.woff2',workspaceInstrumentSerifFont:'instrument-serif-italic-latin.woff2'}))output+='export const '+name+'='+JSON.stringify((await readFile(new URL('../../fonts/'+file,import.meta.url))).toString('base64'))+';\n';
for(const [name,file]of Object.entries({workspaceManropeLicense:'manrope-OFL.txt',workspaceInstrumentSerifLicense:'instrumentserif-OFL.txt'}))output+='export const '+name+'='+JSON.stringify(await readFile(new URL('../../fonts/'+file,import.meta.url),'utf8'))+';\n';
await writeFile(new URL('assets.generated.mjs',import.meta.url),output);
