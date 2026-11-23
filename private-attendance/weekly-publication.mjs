import {createRemoteJWKSet,jwtVerify} from 'jose';
import training from '../training.js';
import offers from './weekly-offers.cjs';
import {assignmentConflict} from './schedule-conflicts.mjs';

const issuer='https://token.actions.githubusercontent.com';
const jwks=createRemoteJWKSet(new URL(issuer+'/.well-known/jwks'));
const repository='starsoccervancouver/Star-Soccer';
export const catalogPath='/coachdesk/api/catalog-preview';
const audience='https://starsoccer.ca'+catalogPath;
const published='https://starsoccer.ca/program-catalog.json';
const columns=['Program','Day','Time','Venue','Capacity','Drop-in CAD','Four dates CAD'];
const response=(body,status)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex'}});

export async function preview(request,env,verify=jwtVerify,fetchFn=fetch) {
  if(request.method!=='GET'||request.url!==audience)return response({error:'Invalid catalog request'},400);
  const auth=request.headers.get('Authorization')||'';
  if(!auth.startsWith('Bearer '))return response({error:'Release identity required'},401);
  try {
    const {payload}=await verify(auth.slice(7),jwks,{issuer,audience,algorithms:['RS256']});
    if(payload.repository!==repository || payload.repository_id!=='1212934215' || payload.ref!=='refs/heads/main' ||
       payload.workflow_ref!==repository+'/.github/workflows/deploy-pages.yml@refs/heads/main' ||
       !['schedule','workflow_dispatch','push'].includes(payload.event_name))return response({error:'Release identity required'},403);
  } catch {return response({error:'Release identity required'},403);}
  let stage='Airtable weekly program read';
  try {
    const url=new URL('https://api.airtable.com/v0/appnaG94HQpEaRios/tblbakKBakPnt0zbU');
    for(const field of columns)url.searchParams.append('fields[]',field);
    const read=await fetchFn(url,{headers:{Authorization:'Bearer '+env.AIRTABLE_TOKEN},redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(!read.ok)throw Error('Ledger unavailable');
    const data=await read.json();
    if(data.offset)throw Error('Unexpected catalog size');
    stage='Weekly program validation';
    const projected=offers.feed(offers.fromLedger(training.catalog,data.records));
    stage='Published catalog comparison';
    const previous=await fetchFn(published,{redirect:'manual',signal:AbortSignal.timeout(10000)});
    if(!previous.ok)throw Error('Cannot compare the current offer');
    const live=await previous.json();
    const changes=new Map();
    for(const next of projected.sessions){
      const old=live.sessions.find(row=>row.id===next.id);
      if(!old)throw Error('Missing published program');
      if(old.time!==next.time||old.capacity!==next.capacity||old.venue!==next.venue){
        changes.set(data.records.find(r=>r.fields.Day===next.day).id,next);
      }
    }
    stage='Future dated session check';
    if(changes.size)await checkDatedSessions(changes,env.AIRTABLE_TOKEN,fetchFn);
    return response(projected,200);
  }catch{return response({error:stage+' failed. Check the weekly programs and linked dated sessions.'},422);}
}

async function checkDatedSessions(changes,token,fetchFn){
  const url=new URL('https://api.airtable.com/v0/appnaG94HQpEaRios/tblcJQZMT2JKEUS2B');
  for(const name of ['Date','Weekly program','Time','Capacity','Venue','Coach','Session status','Attendance','Expected headcount (owner reported)'])url.searchParams.append('fields[]',name);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver'}).format(new Date());
  url.searchParams.set('filterByFormula',`AND({Date}>='${today}',OR({Session status}='Planned',{Session status}='Confirmed'))`);
  const sessions=[],offsets=new Set();
  for(;;){
    const response=await fetchFn(url,{headers:{Authorization:'Bearer '+token},redirect:'manual',signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('Dated session verification failed');
    const page=await response.json();
    sessions.push(...page.records);
    if(!page.offset)break;
    if(offsets.has(page.offset)||offsets.size>=49)throw Error('Incomplete dated sessions');
    offsets.add(page.offset);url.searchParams.set('offset',page.offset);
  }
  for(const row of sessions){
    const fields=row.fields;
    const links=fields['Weekly program']||[],offer=links.map(id=>changes.get(id)).find(Boolean);
    if(!offer)continue;
    const capacity=fields.Capacity;
    if(links.length!==1||!Number.isInteger(capacity)||capacity<=0||capacity>offer.capacity||
       (fields.Attendance?.length||0)>capacity||(fields['Expected headcount (owner reported)']||0)>capacity||
       fields.Venue!==offer.venue||offers.timeRange(fields.Time).time!==offer.time||assignmentConflict(row,sessions))throw Error('Dated session needs review');
  }
}

export function publishedReader(fetchFn=fetch,clock=Date.now) {
  let cached,expires=0;
  return async()=>{
    if(cached&&clock()<expires)return cached;
    const result=await fetchFn(published,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{'Cache-Control':'no-cache'}});
    if(!result.ok)throw Error('Published weekly catalog unavailable');
    const value=await result.json();
    if(value.zone!==training.catalog.zone || !/^[a-f0-9]{64}$/.test(value.version||''))throw Error('Invalid published weekly catalog');
    const catalog=offers.applyOffers(training.catalog,value.sessions);
    for(const s of catalog.sessions){
      const row=value.sessions.find(r=>r.id===s.id);
      if(row.day!==s.day||row.program!==s.program)throw Error('Published weekly program identity changed');
    }
    cached={...catalog,version:value.version};expires=clock()+60000;
    return cached;
  };
}
