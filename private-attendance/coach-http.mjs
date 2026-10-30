import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {deny} from './coach-store.mjs';
import {validateWorkspaceOrigin} from './deployment-config.mjs';
const random=()=>randomBytes(32).toString('base64url');
const same=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
const cookie=(request,name)=>request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
const headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','X-Robots-Tag':'noindex, nofollow','Strict-Transport-Security':'max-age=31536000','Content-Security-Policy':"default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",'Permissions-Policy':'publickey-credentials-create=(self), publickey-credentials-get=(self), camera=(), microphone=(self), geolocation=()'};
export function createCoachHandler({coaches,auth,cookieKey,overview,attendance,origin='https://attendance.starsoccer.ca',googleAuth=null,updateAttendance=()=>{},legacyNotes=async()=>[],assets,clock=()=>Date.now()}){
 origin=validateWorkspaceOrigin(origin);
 const sign=v=>createHmac('sha256',cookieKey).update(v).digest('base64url'),rates=new Map();
 const json=(status,body,extra={})=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json',...extra}});
 function anon(request){const raw=cookie(request,'__Host-ss_coach_browser');if(!raw)return null;const p=raw.split('.');if(p.length!==3||!/^\d{13}$/.test(p[1])||+p[1]<=clock()||+p[1]>clock()+1800000||!/^[A-Za-z0-9_-]{43}$/.test(p[0])||!same(p[2],sign('staff-browser:'+p[0]+'.'+p[1])))return null;return {browser:p[0],csrf:sign('staff-csrf:'+raw)};}
 async function body(request,allowed){if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')||''))deny('INVALID_CONTENT_TYPE',415);const reader=request.body?.getReader();if(!reader)deny('INVALID_REQUEST',400);const parts=[];let size=0;for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>64000){await reader.cancel();deny('REQUEST_TOO_LARGE',413);}parts.push(value);}let v;try{v=JSON.parse(Buffer.concat(parts).toString('utf8'));}catch{deny('INVALID_JSON',400);}if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))deny('INVALID_REQUEST',400);return v;}
 return async request=>{try{
  const url=new URL(request.url),path=url.pathname,isGoogleCallback=path==='/workspace/api/auth/google/callback';if(url.origin!==origin||url.search&&!isGoogleCallback)deny('NOT_FOUND',404);
  const ip=request.headers.get('CF-Connecting-IP')||'unknown',now=clock(),old=rates.get(ip),rate=old&&now-old.at<60000?old:{at:now,count:0};rate.count++;if(path.startsWith('/workspace/api/auth/'))rate.auth=(rate.auth||0)+1;rates.set(ip,rate);for(const [key,r]of rates)if(now-r.at>=60000)rates.delete(key);if(rate.count>100||(rate.auth||0)>20||rates.size>5000)deny('RATE_LIMITED',429);
  if(isGoogleCallback){
   if(!googleAuth||request.method!=='GET')deny('NOT_FOUND',404);
   const cleared='__Host-ss_google_flow=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
   try{const allowed=['state','code','scope','authuser','prompt','hd','error','error_description','iss'];if([...url.searchParams.keys()].some(k=>!allowed.includes(k)||url.searchParams.getAll(k).length!==1)||url.search.length>16000||url.searchParams.has('error'))deny('GOOGLE_CALLBACK_QUERY_REJECTED',401);const result=await googleAuth.finish({code:url.searchParams.get('code'),state:url.searchParams.get('state'),browser:cookie(request,'__Host-ss_google_flow')});const h=new Headers({...headers,Location:'/workspace'});h.append('Set-Cookie',cleared);h.append('Set-Cookie','__Host-ss_staff='+result.token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200');return new Response(null,{status:303,headers:h});}catch(e){console.warn('coach_google_signin_failed',/^[A-Z_]{1,60}$/.test(e.code||e.message||'')?e.code||e.message:'GOOGLE_UNEXPECTED_FAILURE');const h=new Headers({...headers,Location:'/workspace#google-error'});h.append('Set-Cookie',cleared);return new Response(null,{status:303,headers:h});}
  }
  if(request.method==='GET'&&assets[path])return new Response(assets[path].body,{headers:{...headers,'Content-Type':assets[path].type}});
  if(!path.startsWith('/workspace/api/'))deny('NOT_FOUND',404);
  const raw=cookie(request,'__Host-ss_staff'),signed=auth.session(raw),a=anon(request);
  if(path==='/workspace/api/bootstrap'&&request.method==='GET'){
   let browser=a,extra={};if(!browser){const payload=random()+'.'+(clock()+1800000),value=payload+'.'+sign('staff-browser:'+payload);browser={browser:payload.split('.')[0],csrf:sign('staff-csrf:'+value)};extra={'Set-Cookie':'__Host-ss_coach_browser='+value+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=1800'};}
   return json(200,{profile:signed?.actor||null,csrfToken:signed?.csrf||browser.csrf,googleEnabled:!!googleAuth,draftOnly:true},extra);
  }
  if(request.method==='POST'){
   if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')&&request.headers.get('sec-fetch-site')!=='same-origin'||!signed&&!a||!same(request.headers.get('x-csrf-token'),signed?.csrf||a?.csrf))deny('CSRF_FAILED',403);
  }
  if(path.startsWith('/workspace/api/auth/')){
   if(!a)deny('SIGN_IN_EXPIRED',401);
   if(request.method!=='POST')deny('METHOD_NOT_ALLOWED',405);let result;
   if(path==='/workspace/api/auth/google/start'){if(!googleAuth)deny('GOOGLE_UNAVAILABLE',503);await body(request,[]);const browser=random(),v=await googleAuth.start({browser});return json(200,{url:v.url},{'Set-Cookie':'__Host-ss_google_flow='+browser+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600'});}
   if(path.endsWith('/register-options')){const v=await body(request,['token','method']);return json(200,await auth.registrationOptions({...v,browser:a.browser}));}
   if(path.endsWith('/register-finish')){const v=await body(request,['challengeId','response']);result=await auth.verifyRegistration({...v,browser:a.browser});}
   else if(path.endsWith('/login-options')){const v=await body(request,['email']);return json(200,await auth.loginOptions({address:v.email,browser:a.browser}));}
   else if(path.endsWith('/login-finish')){const v=await body(request,['challengeId','response']);result=await auth.verifyLogin({...v,browser:a.browser});}
   else deny('NOT_FOUND',404);
   return json(200,{profile:result.profile,csrfToken:result.csrf},{'Set-Cookie':'__Host-ss_staff='+result.token+'; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200'});
  }
  if(!signed)deny('SIGN_IN_REQUIRED',401);const actor=signed.actor;
  if(path==='/workspace/api/desk'&&request.method==='GET'){const data=coaches.scope(actor,await overview({}));return json(200,{...data,notes:coaches.notes(actor),tasks:coaches.tasks(actor)});}
  if(path==='/workspace/api/audit'&&request.method==='GET')return json(200,{events:coaches.audit(actor)});
  if(path==='/workspace/api/users'&&request.method==='GET')return json(200,{users:coaches.users(actor),credentials:auth.credentialSummary(actor)});
  if(request.method!=='POST')deny('NOT_FOUND',404);
  if(path==='/workspace/api/logout'){await body(request,[]);auth.logout(raw);return json(200,{signedOut:true},{'Set-Cookie':'__Host-ss_staff=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0'});}
  if(path==='/workspace/api/refresh'){await body(request,[]);return json(200,coaches.scope(actor,await overview({refresh:true})));}
  if(path==='/workspace/api/session'){const v=await body(request,['sessionId']);coaches.requireSession(actor,v.sessionId);return json(200,{plan:coaches.plan(actor,v.sessionId),notes:coaches.notes(actor,{sessionId:v.sessionId})});}
  if(path==='/workspace/api/notes/save'){
   const v=await body(request,['id','playerId','sessionId','category','body','reviewDate','expectedVersion']);coaches.requireSession(actor,v.sessionId);const data=await overview({}),s=data.sessions.find(s=>s.id===v.sessionId);if(!s||!v.id&&v.playerId&&!s.players.some(p=>p.playerId===v.playerId))deny('PLAYER_NOT_IN_SESSION',403);return json(200,{note:coaches.saveNote(actor,v)});
  }
  if(path==='/workspace/api/notes/archive'){const v=await body(request,['id','expectedVersion']);return json(200,coaches.archiveNote(actor,v));}
  if(path==='/workspace/api/plans/save'){const v=await body(request,['sessionId','content','expectedVersion']);coaches.requireSession(actor,v.sessionId);const data=await overview({});if(!data.sessions.some(s=>s.id===v.sessionId))deny('SESSION_NOT_FOUND',404);return json(200,{plan:coaches.savePlan(actor,v)});}
  if(['/workspace/api/diagrams/list','/workspace/api/diagrams/save','/workspace/api/diagrams/archive'].includes(path)){
   const allowed=path.endsWith('/list')?['sessionId']:path.endsWith('/save')?['id','sessionId','title','content','expectedVersion']:['id','sessionId','expectedVersion'];
   const v=await body(request,allowed);coaches.requireSession(actor,v.sessionId);const data=await overview({});if(!data.sessions.some(s=>s.id===v.sessionId))deny('SESSION_NOT_FOUND',404);
   if(path.endsWith('/list'))return json(200,{diagrams:coaches.diagrams(actor,v.sessionId)});
   if(path.endsWith('/save'))return json(200,{diagram:coaches.saveDiagram(actor,v)});
   return json(200,coaches.archiveDiagram(actor,v));
  }
  if(path==='/workspace/api/tasks/save'){const v=await body(request,['id','title','sessionId','dueDate','status','expectedVersion']);return json(200,{tasks:coaches.saveTask(actor,v)});}
  if(path==='/workspace/api/resources/list'){await body(request,[]);return json(200,{resources:coaches.resources(actor)});}
  if(path==='/workspace/api/resources/save'){const v=await body(request,['id','requestId','title','url','kind','topic','notes','favourite','expectedVersion']);return json(200,{resource:coaches.saveResource(actor,v)});}
  if(path==='/workspace/api/resources/archive'){const v=await body(request,['id','expectedVersion']);return json(200,coaches.archiveResource(actor,v));}
  if(path==='/workspace/api/drills/list'){await body(request,[]);return json(200,{drills:coaches.drills(actor)});}
  if(path==='/workspace/api/drills/save'){
   const v=await body(request,['id','requestId','title','skill','minutes','target','setup','coaching','progression','equipment','diagram','expectedVersion']);
   return json(200,{drill:coaches.saveDrill(actor,v)});
  }
  if(path==='/workspace/api/drills/archive'){const v=await body(request,['id','expectedVersion']);return json(200,coaches.archiveDrill(actor,v));}
  if(path==='/workspace/api/users/save'){const v=await body(request,['email','name','role','active','expectedVersion']);return json(200,{users:coaches.saveUser(actor,v)});}
  if(path==='/workspace/api/users/invite'){const v=await body(request,['email']);return json(200,auth.issueInvite(actor,v.email));}
  if(path==='/workspace/api/assign'){const v=await body(request,['email','sessionId','assigned']);coaches.requireSession(actor,v.sessionId);const data=await overview({});if(!data.sessions.some(s=>s.id===v.sessionId))deny('SESSION_NOT_FOUND',404);return json(200,coaches.assign(actor,v));}
  if(path==='/workspace/api/legacy-notes'){await body(request,[]);if(!coaches.full(actor))deny();return json(200,{notes:await legacyNotes()});}
  if(path==='/workspace/api/attendance'){
   const v=await body(request,['commandId','sessionId','attendanceId','playerId','status','expectedStatus']);coaches.requireSession(actor,v.sessionId);const data=await overview({}),s=data.sessions.find(s=>s.id===v.sessionId);const result=await attendance.save(actor,v,s);updateAttendance({attendanceId:v.attendanceId,status:result.status});return json(200,result);
  }
  deny('NOT_FOUND',404);
 }catch(e){const code=/^[A-Z_]{1,60}$/.test(e.code||e.message||'')?e.code||e.message:'SERVICE_UNAVAILABLE',status=e.status>=400&&e.status<=599?e.status:503;return json(status,{error:code,message:({SIGN_IN_REQUIRED:'Sign in to open your coach workspace.',ACCESS_DENIED:'Your account does not have permission for this record.',OWNER_ONLY:'Only the owner can manage account access.',NOTE_CHANGED:'This note changed. Reload it before saving.',PLAN_CHANGED:'Another coach updated this plan. Reload before saving.',DIAGRAM_CHANGED:'Another coach updated this diagram. Reload it before saving.',DIAGRAM_ARCHIVED:'This diagram was archived. Reload the session diagrams.',DIAGRAM_LIMIT:'This session already has 20 diagrams. Archive an unused diagram before adding another.',INVALID_DIAGRAM:'Check the diagram title, pieces and phases before saving.',INVALID_RESOURCE_URL:'Use a full HTTPS link without a username or password.',INVALID_RESOURCE:'Check the title, link and resource details.',RESOURCE_CHANGED:'This link changed. Refresh before editing.',RESOURCE_ARCHIVED:'This link was archived. Refresh your collection.',RESOURCE_REQUEST_REUSED:'This save could not be repeated. Refresh to review the saved link.',RESOURCE_URL_EXISTS:'You already saved this link. Find it in your collection to edit it.',RESOURCE_LIMIT:'Your collection has 300 links. Archive an unused link first.',DRILL_CHANGED:'This saved drill changed. Reload your archive before saving.',DRILL_ARCHIVED:'This drill was archived. Reload your archive.',DRILL_REQUEST_REUSED:'This save reference was already used for a different drill draft. Reload the archive before continuing.',DRILL_LIMIT:'Your archive has 200 active drills. Archive an unused drill before adding another.',INVALID_DRILL:'Check the title, setup, stage and a whole-number duration from 1 to 120 minutes.',ATTENDANCE_CHANGED:'Attendance changed. Refresh the roster before marking it again.',ATTENDANCE_SYNC_PENDING:'The attendance update is pending verification. Refresh before retrying.',INVITE_EXPIRED:'This setup link has expired or was already used. Ask the owner for a new link.',SESSION_NOT_STARTED:'Actual attendance can be marked on the session day.',SIGN_IN_FAILED:'Sign-in could not be verified. Use your registered passkey and approved email.',PASSKEY_VERIFICATION_FAILED:'Your device did not verify the passkey. Try again.',ACCOUNT_ALREADY_ENROLLED:'This account already has a passkey. Please sign in.'})[code]||'We could not complete that action. Refresh and try again.'});}};
}
