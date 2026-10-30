/* Public UI files bypass the serialized roster writer. APIs and private data never enter this cache. */
import * as files from './assets.generated.mjs';
const security={'Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','X-Robots-Tag':'noindex, nofollow','Strict-Transport-Security':'max-age=31536000','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",'Permissions-Policy':'publickey-credentials-create=(self), publickey-credentials-get=(self), camera=(), microphone=(self), geolocation=()'};
const decode=value=>Uint8Array.from(atob(value),char=>char.charCodeAt(0));
export function createCoachAssetServer(assets,builds,hashes){
 return request=>{
  const url=new URL(request.url);if(!['GET','HEAD'].includes(request.method)||url.search)return null;
  const base=url.pathname==='/coachdesk'||url.pathname.startsWith('/coachdesk/')?'/coachdesk':'/workspace',build=builds[base];
  let file,hash,immutable=false;
  if(url.pathname===base||url.pathname===base+'/')file={body:build.html,type:'text/html; charset=utf-8'};
  else if(url.pathname===build.jsPath){file={body:build.js,type:'text/javascript; charset=utf-8'};hash=build.jsHash;immutable=true;}
  else if(url.pathname===build.cssPath){file={body:build.css,type:'text/css; charset=utf-8'};hash=build.cssHash;immutable=true;}
  else{
   let path=url.pathname;
   if(base==='/coachdesk')path='/workspace'+path.slice(base.length);
   if(path==='/workspace/assets/app.css')path='/assets/app.css';if(path==='/workspace/assets/logo.svg')path='/assets/logo.svg';
   file=assets[path];hash=hashes[path];
   // Old, unbundled entry points stay usable while an already-open tab finishes loading.
   if(file&&base==='/coachdesk'&&typeof file.body==='string')file={...file,body:file.body.replaceAll('/workspace','/coachdesk').replace(/(["'(])\/assets\//g,'$1/coachdesk/assets/')};
  }
  if(!file)return null;
  const etag=hash?'"'+base.slice(1)+'-'+hash+'"':null,headers={...security,'Content-Type':file.type,'Cache-Control':hash?(immutable?'public, max-age=31536000, immutable':'public, max-age=0, must-revalidate'):'no-store',...(etag?{ETag:etag}:{})};
  // Cloudflare may weaken ETags while compressing responses. GET/HEAD use weak comparison.
  if(etag&&request.headers.get('if-none-match')?.split(',').some(value=>value.trim()==='*'||value.trim().replace(/^W\//,'')===etag))return new Response(null,{status:304,headers});
  return new Response(request.method==='HEAD'?null:file.body,{headers});
 };
}
const staticFiles={};
for(const [path,key,type]of files.coachAssetEntries)staticFiles[path]={body:type.startsWith('font/')?decode(files[key]):files[key],type};
export const serveCoachAssets=createCoachAssetServer(staticFiles,files.publicCoachBuilds,files.coachAssetHashes);
