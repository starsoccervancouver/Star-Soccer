import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {transform as cssTransform} from 'lightningcss';
import {transform as jsTransform} from 'esbuild';
export const digest=value=>createHash('sha256').update(value).digest('hex').slice(0,20);
export async function buildCoachFrontend({html,assets}){
 const scripts=[...html.matchAll(/<script\b[^>]*src="([^"]+)"[^>]*>\s*<\/script>/g)].map(match=>match[1]);
 const styles=[...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(match=>match[1]);
 for(const path of [...scripts,...styles])if(!assets[path])throw Error('Missing coach build asset: '+path);
 const originalJS=scripts.map(path=>assets[path].body).join('\n;\n'),originalCSS=styles.map(path=>assets[path].body).join('\n');
 const builds={};
 for(const basePath of ['/workspace','/coachdesk']){
  const rewrite=value=>value.replaceAll('/workspace',basePath).replace(/(["'(])\/assets\//g,'$1'+basePath+'/assets/');
  const js=(await jsTransform(rewrite(originalJS),{minify:true,target:['chrome100','firefox100','safari15'],legalComments:'inline'})).code;
  const css=cssTransform({filename:'coach-desk.css',code:Buffer.from(rewrite(originalCSS)),minify:true,targets:{chrome:100<<16,firefox:100<<16,safari:15<<16}}).code.toString();
  const jsPath=basePath+'/assets/desk.'+digest(js)+'.js',cssPath=basePath+'/assets/desk.'+digest(css)+'.css';
  let scriptSeen=false,styleSeen=false;
  let page=html.replace(/<script\b[^>]*src="([^"]+)"[^>]*>\s*<\/script>/g,()=>scriptSeen?'':(scriptSeen=true,'<script src="'+jsPath+'" defer></script>'))
   .replace(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,()=>styleSeen?'':(styleSeen=true,'<link rel="stylesheet" href="'+cssPath+'">'));
  page=rewrite(page);
  builds[basePath]={html:page,js,css,jsPath,cssPath,jsHash:digest(js),cssHash:digest(css)};
 }
 return {builds,hashes:Object.fromEntries(Object.entries(assets).map(([path,file])=>[path,digest(file.body)])),metrics:{sourceRequests:scripts.length+styles.length,bundleRequests:2,sourceBytes:Buffer.byteLength(originalJS)+Buffer.byteLength(originalCSS),bundleBytes:Buffer.byteLength(builds['/coachdesk'].js)+Buffer.byteLength(builds['/coachdesk'].css),sourceGzipBytes:[...scripts,...styles].reduce((sum,path)=>sum+gzipSync(assets[path].body).length,0),bundleGzipBytes:gzipSync(builds['/coachdesk'].js).length+gzipSync(builds['/coachdesk'].css).length}};
}
