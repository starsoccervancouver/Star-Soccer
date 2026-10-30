/* Local, fictional-data demonstration only. Never a production deployment entry point. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes, timingSafeEqual} from 'node:crypto';

const web=new URL('./web/',import.meta.url);
const files=new Map([
 ['/respond',['respond.html','text/html; charset=utf-8']],['/coach',['coach.html','text/html; charset=utf-8']],['/demo',['demo.html','text/html; charset=utf-8']],
 ['/assets/app.css',['app.css','text/css; charset=utf-8']],['/assets/parent.js',['parent.js','text/javascript; charset=utf-8']],['/assets/coach.js',['coach.js','text/javascript; charset=utf-8']],['/assets/demo.js',['demo.js','text/javascript; charset=utf-8']],['/assets/logo.svg',['logo.svg','image/svg+xml']]
]);
const loopback=address=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address);
const equal=(a,b)=>{if(typeof a!=='string'||typeof b!=='string')return false;const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
function fail(code,status=400){const e=new Error(code);e.code=code;e.status=status;return e;}
function message(code){return ({
 invalid_token:'This attendance link is unavailable. Please contact the coaching team.',expired_token:'This attendance link has expired. Please contact the coaching team.',
 token_expired:'This attendance link has expired. Please contact the coaching team.',session_started:'This session has started. Please contact the coaching team.',
 session_cancelled:'This session is cancelled. Please contact the coaching team.',capacity_exceeded:'We need to check this session’s roster before confirming. Please contact the coaching team.',
 roster_stale:'We’re checking the latest roster. Please try again shortly or contact the coaching team.',stale_roster:'We’re checking the latest roster. Please try again shortly or contact the coaching team.',
 version_conflict:'Your response changed in another window. Review the latest response and confirm again.',stale_version:'Your response changed in another window. Review the latest response and confirm again.',response_changed:'Your response changed in another window. Review the latest response and confirm again.',
 invalid_invitation:'This attendance link is unavailable. Please contact the coaching team.',invitation_expired:'This attendance link has expired. Please contact the coaching team.',session_closed:'This session is no longer open for attendance responses. Please contact the coaching team.',capacity_review_required:'We need to check this session’s roster before confirming. Please contact the coaching team.',roster_changed:'This player’s session record has changed. Please contact the coaching team.',invalid_confirmation:'Please review the latest session details and confirm your response again.',
 csrf_failed:'Please reload this page and try again.',rate_limited:'Please wait a minute before trying again.',body_too_large:'This request is too large.',
 invalid_json:'Please reload this page and try again.',invalid_content_type:'Please reload this page and try again.'
 })[String(code).toLowerCase()]||'We could not save this response. Please refresh and try again, or contact the coaching team.';}

export function createServer({service,origin=null,mode='demo',fixtureOnly=true,demoData=()=>({drafts:[]}),clock=()=>new Date(),rateLimit=120,maxBodyBytes=8192}={}){
 if(mode!=='demo'||fixtureOnly!==true||process.env.NODE_ENV==='production')throw new Error('This entry point is restricted to a local fictional-data demo.');
 if(!service)throw new Error('A fictional attendance service is required.');
 const browserSessions=new Map(),ipRates=new Map();
 const now=()=>Date.now();
 let server;
 function canonicalOrigin(){return origin||'http://127.0.0.1:'+server.address().port;}
 function headers(res){
  res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'");
  res.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
 }
 function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
 function rate(req){const key=req.socket.remoteAddress,previous=ipRates.get(key);const entry=previous&&now()-previous.at<60000?previous:{at:now(),count:0};entry.count++;ipRates.set(key,entry);if(entry.count>rateLimit)throw fail('rate_limited',429);}
 function session(req){const raw=String(req.headers.cookie||'').split(';').map(v=>v.trim()).find(v=>v.startsWith('ss_demo_session='))?.slice(16);const value=raw&&browserSessions.get(raw);return value&&value.expires>now()?{id:raw,...value}:null;}
 function csrf(req){
  if(req.headers.origin!==canonicalOrigin()||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']||''))throw fail('csrf_failed',403);
  if(req.headers['sec-fetch-site']&&req.headers['sec-fetch-site']!=='same-origin')throw fail('csrf_failed',403);
  const s=session(req);if(!s||!equal(req.headers['x-csrf-token'],s.csrf))throw fail('csrf_failed',403);return s.id;
 }
 async function body(req){
  if(Number(req.headers['content-length'])>maxBodyBytes)throw fail('body_too_large',413);
  let bytes=0,raw='';for await(const chunk of req){bytes+=chunk.length;if(bytes>maxBodyBytes)throw fail('body_too_large',413);raw+=chunk.toString('utf8');}
  let value;try{value=JSON.parse(raw);}catch{throw fail('invalid_json');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw fail('invalid_json');return value;
 }
 function allowKeys(value,keys){if(Object.keys(value).some(k=>!keys.includes(k)))throw fail('invalid_request');}
 server=http.createServer({maxHeaderSize:8192,requestTimeout:10000,headersTimeout:10000},async(req,res)=>{
  headers(res);
  try{
   if(!loopback(req.socket.remoteAddress))throw fail('local_only',403);
   if(req.headers.host!==new URL(canonicalOrigin()).host)throw fail('invalid_host',403);
   rate(req);
   const url=new URL(req.url,canonicalOrigin()),path=url.pathname;
   if(path!=='/api/dashboard'&&url.search)throw fail('query_not_allowed');
   if(req.method==='GET'&&path==='/'){res.writeHead(302,{Location:'/demo'});res.end();return;}
   if(req.method==='GET'&&path==='/api/bootstrap'){
    let s=session(req);if(!s){const id=randomBytes(32).toString('base64url'),csrfToken=randomBytes(32).toString('base64url');s={id,csrf:csrfToken,expires:now()+30*60000};browserSessions.set(id,s);res.setHeader('Set-Cookie','ss_demo_session='+id+'; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800');}
    for(const [key,value]of browserSessions)if(value.expires<=now())browserSessions.delete(key);
    while(browserSessions.size>1000)browserSessions.delete(browserSessions.keys().next().value);
    json(res,200,{csrfToken:s.csrf,demo:true,clock:new Date(clock()).toISOString()});return;
   }
   if(req.method==='GET'&&path==='/api/dashboard'){
    if([...url.searchParams.keys()].some(k=>k!=='sessionId')||url.searchParams.getAll('sessionId').length>1)throw fail('invalid_request');
    json(res,200,await service.dashboard({sessionId:url.searchParams.get('sessionId')||undefined}));return;
   }
   if(req.method==='GET'&&path==='/api/demo'){json(res,200,await demoData());return;}
   if(req.method==='GET'&&path==='/health'){json(res,200,{mode:'fictional-local-only',service:await service.health()});return;}
   if(req.method==='GET'&&files.has(path)){const [name,type]=files.get(path);res.writeHead(200,{'Content-Type':type});res.end(await readFile(new URL(name,web)));return;}
   if(['/api/preview','/api/respond','/api/optout'].includes(path)){
    if(req.method!=='POST')throw fail('method_not_allowed',405);
    const csrfSession=csrf(req),value=await body(req);
    if(path==='/api/preview'){
     allowKeys(value,['token','answer','action']);json(res,200,await service.preview({...value,csrfSession}));return;
    }
    if(path==='/api/respond'){
     allowKeys(value,['token','answer','challenge','expectedVersion','idempotencyKey']);json(res,200,await service.respond({...value,csrfSession}));return;
    }
    allowKeys(value,['token','challenge','idempotencyKey']);json(res,200,await service.optOut({...value,csrfSession}));return;
   }
   throw fail('not_found',404);
  }catch(error){const code=typeof error.code==='string'?error.code:'internal_error',status=Number.isInteger(error.status)&&error.status>=400&&error.status<=599?error.status:500;json(res,status,{error:code,message:message(code)});}
 });
 const listen=server.listen.bind(server);
 server.listen=(...args)=>{
  if(typeof args[0]==='object'){const options={...args[0]};if(options.host&&!['127.0.0.1','::1','localhost'].includes(options.host))throw new Error('Demo server must bind to loopback.');options.host||='127.0.0.1';return listen(options,...args.slice(1));}
  if(typeof args[1]==='string'){if(!['127.0.0.1','::1','localhost'].includes(args[1]))throw new Error('Demo server must bind to loopback.');return listen(...args);}
  return listen(args[0],'127.0.0.1',...args.slice(1));
 };
 return server;
}
