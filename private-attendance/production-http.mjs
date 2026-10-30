import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {validateWorkspaceOrigin} from './deployment-config.mjs';
const random=()=>randomBytes(32).toString('base64url');
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
const security={
 'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff',
 'X-Robots-Tag':'noindex, nofollow, noarchive','X-Frame-Options':'DENY',
 'Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
 'Strict-Transport-Security':'max-age=31536000','Permissions-Policy':'camera=(), microphone=(), geolocation=()'
};
const fail=(code,status=400)=>{const e=new Error(code);e.code=code;e.status=status;throw e;};
export function createProductionHandler({service,origin,adminKey,cookieKey,assets,refreshRoster,flush,ownerAuth=null,ownerData=null,coachBootstrap=null,legacyOwnerEnabled=true,clock=()=>Date.now()}={}){
 origin=validateWorkspaceOrigin(origin);
 if(!service||typeof refreshRoster!=='function'||typeof flush!=='function'||!assets||!adminKey||adminKey.length<43||!cookieKey||cookieKey.length<43)throw new Error('Complete private production configuration required.');
 const sign=s=>createHmac('sha256',cookieKey).update(s).digest('base64url');
 const rates=new Map();
 function owner(request){const prefix='__Host-ss_owner=',v=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(prefix))?.slice(prefix.length);if(!v)return null;const p=v.split('.');if(p.length!==3||!/^[A-Za-z0-9_-]{43}$/.test(p[0])||!/^\d{13}$/.test(p[1])||+p[1]<=clock()||+p[1]>clock()+28800000||!equal(p[2],sign('owner:'+p[0]+'.'+p[1])))return null;return {csrf:sign('owner-csrf:'+v)};}
 function rate(request){const key=request.headers.get('CF-Connecting-IP')||'unknown',now=clock(),old=rates.get(key),r=old&&now-old.start<60000?old:{start:now,count:0};r.count++;rates.set(key,r);for(const [k,v]of rates)if(now-v.start>=60000)rates.delete(k);if(r.count>60||rates.size>5000)fail('RATE_LIMITED',429);}
 function browser(request){const cookie=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith('__Host-ss_attendance='))?.slice(21);if(!cookie)return null;const parts=cookie.split('.');if(parts.length!==3||!/^\d{13}$/.test(parts[1])||Number(parts[1])<=clock()||Number(parts[1])>clock()+1800000||!equal(parts[2],sign(parts[0]+'.'+parts[1]))||!/^[A-Za-z0-9_-]{43}$/.test(parts[0]))return null;return {id:parts[0],csrf:sign('csrf:'+cookie)};}
 async function body(request,allowed){if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||''))fail('INVALID_CONTENT_TYPE',415);const reader=request.body?.getReader();if(!reader)fail('INVALID_JSON');const chunks=[];let size=0;for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();fail('BODY_TOO_LARGE',413);}chunks.push(value);}let v;try{v=JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));}catch{fail('INVALID_JSON');}if(!v||Array.isArray(v)||typeof v!=='object'||Object.keys(v).some(k=>!allowed.includes(k)))fail('INVALID_REQUEST');return v;}
 const json=(status,v,extra={})=>new Response(JSON.stringify(v),{status,headers:{...security,'Content-Type':'application/json',...extra}});
 return async request=>{
  try{
   const u=new URL(request.url);if(u.origin!==origin||u.search)fail('NOT_FOUND',404);rate(request);
   if(!legacyOwnerEnabled&&u.pathname==='/overview'&&request.method==='GET')return new Response(null,{status:302,headers:{...security,Location:'/workspace'}});
   if(!legacyOwnerEnabled&&u.pathname.startsWith('/api/owner-'))fail('SIGN_IN_REQUIRED',401);
   if(request.method==='GET'&&u.pathname==='/health')return json(200,{status:'ready',emailSending:false});
   if(ownerAuth&&u.pathname==='/api/owner-bootstrap'&&request.method==='GET'){const o=owner(request);return json(200,{authenticated:!!o,...(o?{csrfToken:o.csrf}:{})});}
   if(ownerAuth&&u.pathname==='/api/owner-session'&&request.method==='POST'){
    if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin')fail('CSRF_FAILED',403);
    const v=await body(request,['token']);if(!ownerAuth.redeem(v.token))fail('OWNER_ACCESS_EXPIRED',401);const payload=random()+'.'+(clock()+28800000),value=payload+'.'+sign('owner:'+payload);
    return json(200,{authenticated:true},{'Set-Cookie':'__Host-ss_owner='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=28800'});
   }
   if(ownerData&&u.pathname==='/api/owner-dashboard'){
    const o=owner(request);if(!o)fail('OWNER_SIGN_IN_REQUIRED',401);
    if(!['GET','POST'].includes(request.method))fail('METHOD_NOT_ALLOWED',405);
    if(request.method==='POST'){if(request.headers.get('origin')!==origin||!equal(request.headers.get('x-csrf-token'),o.csrf))fail('CSRF_FAILED',403);await body(request,[]);}
    return json(200,await ownerData({refresh:request.method==='POST'}));
   }
   if(request.method==='GET'&&u.pathname==='/api/bootstrap'){
    let s=browser(request),cookie;
    if(!s){const id=random(),payload=id+'.'+(clock()+1800000);cookie=payload+'.'+sign(payload);s={id,csrf:sign('csrf:'+cookie)};}
    return json(200,{csrfToken:s.csrf,demo:false},cookie?{'Set-Cookie':'__Host-ss_attendance='+cookie+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800'}:{});
   }
   if(u.pathname.startsWith('/admin/')){
    if(request.method!=='POST'||!equal(request.headers.get('authorization'),'Bearer '+adminKey))fail('NOT_FOUND',404);
    if(u.pathname==='/admin/coach-enrollment'&&coachBootstrap){await body(request,[]);return json(200,coachBootstrap());}
    if(u.pathname==='/admin/owner-session'&&ownerAuth&&legacyOwnerEnabled){await body(request,[]);const t=ownerAuth.issue();return json(200,{url:origin+'/overview#access='+t.token,expiresAt:t.expiresAt});}
    if(u.pathname==='/admin/recover'){await body(request,[]);return json(200,await flush());}
    if(u.pathname==='/admin/draft-invitation'){const v=await body(request,['playerId','sessionId','rotate']);if(!/^rec[A-Za-z0-9]{14}$/.test(v.sessionId||''))fail('INVALID_REQUEST');await refreshRoster(v.sessionId);return json(200,{...service.issueInvitation(v),context:service.draftContext(v),draftOnly:true});}
    fail('NOT_FOUND',404);
   }
   if(['/api/preview','/api/respond','/api/optout'].includes(u.pathname)){
    if(request.method!=='POST')fail('METHOD_NOT_ALLOWED',405);
    const s=browser(request);if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'||!s||!equal(request.headers.get('x-csrf-token'),s.csrf))fail('CSRF_FAILED',403);
    const keys=u.pathname==='/api/preview'?['token','answer','action']:u.pathname==='/api/respond'?['token','answer','challenge','expectedVersion','idempotencyKey']:['token','challenge','idempotencyKey'];
    const v=await body(request,keys);
    // Authenticate the capability before spending Airtable API calls. Preview creates no response.
    if(u.pathname==='/api/preview')return json(200,service.preview({...v,csrfSession:s.id}));
    if(u.pathname==='/api/respond'){
     const p=service.preview({token:v.token,answer:v.answer,csrfSession:s.id});
     await refreshRoster(p.sessionId);const result=service.respond({...v,csrfSession:s.id});const synced=await flush();return json(200,{...result,syncPending:synced.pending>0});
    }
    const result=service.optOut({...v,csrfSession:s.id});const synced=await flush();return json(200,{...result,syncPending:synced.pending>0});
   }
   const file=assets[u.pathname];if(request.method==='GET'&&file)return new Response(file.body,{headers:{...security,'Content-Type':file.type}});
   fail('NOT_FOUND',404);
  }catch(e){const code=typeof e.code==='string'?e.code:/^[A-Z_]{1,60}$/.test(e.message||'')?e.message:'SERVICE_UNAVAILABLE',status=e.status>=400&&e.status<=599?e.status:503;return json(status,{error:code,message:code==='CAPACITY_REVIEW_REQUIRED'?'We need to check this session’s roster. Please contact the coaching team.':code==='ROSTER_STALE'?'We’re checking the latest roster. Please try again shortly.':'Please review your link and try again, or contact the coaching team.'});}
 };
}
