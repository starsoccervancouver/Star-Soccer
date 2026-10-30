import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {jwtVerify,createRemoteJWKSet,customFetch} from 'jose';
import {email,deny} from './coach-store.mjs';

const origin='https://attendance.starsoccer.ca';
export const GOOGLE_COACH_REDIRECT=origin+'/workspace/api/auth/google/callback';
const authEndpoint='https://accounts.google.com/o/oauth2/v2/auth';
const tokenEndpoint='https://oauth2.googleapis.com/token';
const jwksEndpoint='https://www.googleapis.com/oauth2/v3/certs';
const random=()=>randomBytes(32).toString('base64url');
const hash=v=>createHash('sha256').update(v).digest('hex');
const same=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&timingSafeEqual(x,y);};
const browserHash=browser=>{if(typeof browser!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(browser))deny('GOOGLE_SIGN_IN_EXPIRED',401);return hash(browser);};

/** Google authenticates identity only. Existing coach_users remains the sole permission authority. */
export function createCoachGoogleAuth({store,coaches,auth,clientId,clientSecret,fetchFn=fetch,clock=()=>Date.now(),keyResolver=null}){
 if(typeof clientId!=='string'||!/^[A-Za-z0-9._-]+\.apps\.googleusercontent\.com$/.test(clientId)||typeof clientSecret!=='string'||clientSecret.length<10||clientSecret.length>4096)throw Error('INVALID_GOOGLE_COACH_CONFIG');
 const resolveKey=keyResolver||createRemoteJWKSet(new URL(jwksEndpoint),{[customFetch]:fetchFn,timeoutDuration:10000,cooldownDuration:30000,cacheMaxAge:3600000});
 store.run(`CREATE TABLE IF NOT EXISTS staff_google_flows(state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,nonce_hash TEXT NOT NULL,verifier TEXT NOT NULL,expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS staff_google_accounts(email TEXT PRIMARY KEY REFERENCES coach_users(email),subject TEXT NOT NULL UNIQUE,linked_at TEXT NOT NULL);`);
 return {
  start({browser}){
   const binding=browserHash(browser),state=random(),nonce=random(),verifier=random(),expires=clock()+600000;
   store.run('DELETE FROM staff_google_flows WHERE expires_at<=?',clock());
   store.run('DELETE FROM staff_google_flows WHERE browser_hash=?',binding);
   store.run('INSERT INTO staff_google_flows VALUES(?,?,?,?,?)',hash(state),binding,hash(nonce),verifier,expires);
   const url=new URL(authEndpoint);for(const [key,value]of Object.entries({client_id:clientId,response_type:'code',redirect_uri:GOOGLE_COACH_REDIRECT,scope:'openid email',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',access_type:'online',prompt:'select_account'}))url.searchParams.set(key,value);
   return {url:url.href,state};
  },
  async finish({code,state,browser}){
   if(typeof state!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(state)||typeof code!=='string'||!code||code.length>4096||/[\x00-\x20\x7f]/.test(code))deny('GOOGLE_SIGN_IN_FAILED',401);
   const binding=browserHash(browser),flow=store.transaction(()=>{const row=store.get('SELECT * FROM staff_google_flows WHERE state_hash=?',hash(state));if(!row||row.expires_at<=clock()||!same(row.browser_hash,binding))deny('GOOGLE_SIGN_IN_EXPIRED',401);store.run('DELETE FROM staff_google_flows WHERE state_hash=?',hash(state));return row;});
   let idToken;
   try{
    const response=await fetchFn(tokenEndpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','Accept':'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000),body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:GOOGLE_COACH_REDIRECT,grant_type:'authorization_code',code_verifier:flow.verifier}).toString()});
    if(!response.ok){let reason='UNKNOWN';try{const d=await response.json();if(['invalid_client','invalid_grant','unauthorized_client','invalid_request','redirect_uri_mismatch'].includes(d.error))reason=d.error.toUpperCase();}catch{}console.warn('coach_google_signin_failed','GOOGLE_TOKEN_'+reason);deny('GOOGLE_SIGN_IN_FAILED',401);}
    const raw=await response.text();if(raw.length>64000)deny('GOOGLE_SIGN_IN_FAILED',401);const result=JSON.parse(raw);idToken=result.id_token;if(typeof idToken!=='string'||idToken.length>20000)deny('GOOGLE_SIGN_IN_FAILED',401);
   }catch{console.warn('coach_google_signin_failed','GOOGLE_TOKEN_NETWORK_OR_PARSE');deny('GOOGLE_SIGN_IN_FAILED',401);}
   let payload;
   try{({payload}=await jwtVerify(idToken,resolveKey,{algorithms:['RS256'],issuer:['https://accounts.google.com','accounts.google.com'],audience:clientId,currentDate:new Date(clock()),clockTolerance:60,requiredClaims:['iss','sub','aud','exp','iat','nonce','email','email_verified']}));}catch(e){console.warn('coach_google_signin_failed','GOOGLE_JWT_'+(/^[A-Z_]{1,60}$/.test(e.code||'')?e.code:'VERIFY_FAILED'));deny('GOOGLE_SIGN_IN_FAILED',401);}
   const seconds=clock()/1000;
   const flags={AUDIENCE:payload.aud===clientId,AUTHORIZED_PARTY:payload.azp===undefined||payload.azp===clientId,ISSUED_AT:typeof payload.iat==='number'&&payload.iat<=seconds+60&&payload.iat>=seconds-600,EXPIRY:typeof payload.exp==='number'&&payload.exp>seconds,EMAIL_VERIFIED:payload.email_verified===true,NONCE:typeof payload.nonce==='string'&&same(hash(payload.nonce),flow.nonce_hash),SUBJECT:typeof payload.sub==='string'&&!!payload.sub&&payload.sub.length<=255};for(const [k,v]of Object.entries(flags))if(!v)console.warn('coach_google_signin_failed','GOOGLE_CLAIM_'+k);
   if(payload.aud!==clientId||payload.azp!==undefined&&payload.azp!==clientId||typeof payload.iat!=='number'||payload.iat>seconds+60||payload.iat<seconds-600||typeof payload.exp!=='number'||payload.exp<=seconds||payload.email_verified!==true||typeof payload.nonce!=='string'||!same(hash(payload.nonce),flow.nonce_hash)||typeof payload.sub!=='string'||!payload.sub||payload.sub.length>255)deny('GOOGLE_SIGN_IN_FAILED',401);
   let address;try{address=email(payload.email);}catch{deny('GOOGLE_SIGN_IN_FAILED',401);}
   const domain=address.slice(address.lastIndexOf('@')+1),hosted=typeof payload.hd==='string'&&/^[A-Za-z0-9.-]+\.[A-Za-z]{2,63}$/.test(payload.hd);
   // A verified non-Google third-party email alone does not prove continuing mailbox ownership.
   if(!['gmail.com','googlemail.com'].includes(domain)&&!hosted)deny('GOOGLE_ACCOUNT_NOT_SUPPORTED',403);
   return store.transaction(()=>{
    const actor=coaches.actor(address),linked=store.get('SELECT * FROM staff_google_accounts WHERE email=?',address),subjectOwner=store.get('SELECT email FROM staff_google_accounts WHERE subject=?',payload.sub);
    if(linked&&linked.subject!==payload.sub||subjectOwner&&subjectOwner.email!==address)deny('GOOGLE_ACCOUNT_CHANGED',403);
    if(!linked)store.run('INSERT INTO staff_google_accounts VALUES(?,?,?)',address,payload.sub,new Date(clock()).toISOString());
    coaches.recordAudit(actor,'google-sign-in',address,{});
    return auth.createVerifiedSession(address);
   });
  }
 };
}
