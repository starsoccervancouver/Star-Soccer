import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {followup} from './registration-followup.mjs';
import {STAR_SOCCER_OWNER} from './deployment-config.mjs';

const HOUR=3600000, prefix='rf:work:', more=Symbol('continue');
const digest=value=>createHash('sha256').update(value).digest('hex');
const eligible="AND({Player history at registration}='First-time verified',{Booking}!='',{Status}!='Declined',{Status}!='Cancelled')";
const fields={
  registrations:['Reference','Received at','Parent email','Player','Booking','Family','Source Gmail ID','Confirmation Gmail ID','Last reply Gmail ID','Status','Player history at registration'],
  bookings:['Booking reference','Source booking ID','Player','Family','Booking status','Start date','Accepted date','Agreed booked CAD'],
  players:['Player','Family'],families:['Guardian name','Email','Secondary guardian email'],
  attendance:['Player','Booking','Session date','Attendance status','Coverage state'],
  payments:['Payment reference','Booking','Family','Source payment ID','Evidence reference','Verification','Direction','Amount CAD'],
  allocations:['Payment','Booking','Review status','Applied CAD'],intake:['Message ID','Gmail thread ID','Web client reference']
};
const mailId=id=>typeof id==='string'&&/^[a-f0-9]{10,32}$/i.test(id);
const single=v=>Array.isArray(v)&&v.length===1?v[0]:null;
const safeHeader=new Set(['from','to','subject','message-id','references','in-reply-to','authentication-results','auto-submitted','list-id']);
function message(m){
  if(!mailId(m.id)||!mailId(m.threadId)||!Array.isArray(m.labelIds)||!Number.isFinite(Number(m.internalDate))||!m.payload?.headers)throw Error('Incomplete Gmail message');
  const parts=p=>p.filename?[]:[p,...(p.parts||[]).flatMap(parts)];
  const bodies=parts(m.payload).filter(p=>['text/plain','text/html'].includes(p.mimeType));
  if(bodies.some(p=>p.body?.attachmentId&&!p.body.data))throw Error('Incomplete message body');
  const type=bodies.some(p=>p.mimeType==='text/plain')?'text/plain':'text/html';
  const content=bodies.filter(p=>p.mimeType===type).map(p=>Buffer.from(p.body?.data||'','base64url').toString('utf8')).join('\n');
  return {id:m.id,thread_id:m.threadId,internal_date:m.internalDate,label_ids:m.labelIds,
    payload:{headers:m.payload.headers.filter(h=>safeHeader.has(h.name.toLowerCase())),mime_type:type,body:{content}}};
}
// Chunk by bytes so a larger roster page or thread fits Durable Object value limits.
async function putValue(storage,key,value){
  const bytes=Buffer.from(JSON.stringify(value)),size=48000,n=Math.ceil(bytes.length/size);
  for(let i=0;i<n;i++)await storage.put(key+':'+i,new Uint8Array(bytes.subarray(i*size,(i+1)*size)));
  await storage.put(key,n);
}
async function valueOf(storage,key){
  const n=await storage.get(key);if(n===undefined)return undefined;
  const pieces=[];for(let i=0;i<n;i++)pieces.push(Buffer.from(await storage.get(key+':'+i)));
  return JSON.parse(Buffer.concat(pieces).toString('utf8'));
}
async function clear(storage,p){
  for(;;){const rows=await storage.list({prefix:p,limit:100});if(!rows.size)return;await storage.delete([...rows.keys()]);}
}
export function createFollowupJob({storage,ledger,read,config,clock=Date.now}){
  async function build(cached){
    const page=(table,selected,filter,offset)=>cached(['table',table,filter||'',offset||''],()=>ledger.listPage(table,selected,filter,offset));
    const shortlist=await page('registrations',['Booking'],eligible);
    if(!Array.isArray(shortlist.records))throw Error('Incomplete eligibility page');
    const profile=await cached(['profile'],()=>read('profile',[]));
    const owner=await storage.get('ownerAddress')||STAR_SOCCER_OWNER;
    if(!profile.historyId||![owner,STAR_SOCCER_OWNER].includes(profile.emailAddress?.toLowerCase()))throw Error('Wrong mailbox');
    if(!shortlist.records.length&&!shortlist.offset)return {items:[],eligibleBookings:0};
    const snap={baseId:config.baseId,bookingTableId:config.tables.bookings,messages:[],complete:true};
    for(const [table,selected] of Object.entries(fields)){
      let offset;const seen=new Set();snap[table]=[];
      do{
        const part=await page(table,selected,null,offset);
        if(!Array.isArray(part.records)||seen.has(offset))throw Error('Incomplete ledger page');
        seen.add(offset);snap[table].push(...part.records.map(r=>({id:r.id,...r.fields})));offset=part.offset;
      }while(offset);
    }
    const booked=new Map(snap.bookings.map(r=>[r.id,r])), families=new Map(snap.families.map(r=>[r.id,r]));
    const active=snap.registrations.filter(r=>r['Player history at registration']==='First-time verified'&&!['Declined','Cancelled'].includes(r.Status)&&booked.has(single(r.Booking))&&!['Cancelled','Completed','Declined'].includes(booked.get(single(r.Booking))['Booking status']));
    if(!active.length)return {items:[],eligibleBookings:0};
    const fingerprint=digest(profile.historyId+JSON.stringify(snap));
    const previous=await storage.get('rf:evidence');
    if(previous?.fingerprint===fingerprint&&(!previous.nextDue||clock()<previous.nextDue))return previous.result;
    const targetBookings=new Set(active.map(r=>single(r.Booking))),threadIds=new Set(),knownIds=new Set(),terms=new Set();
    for(const r of snap.registrations.filter(r=>targetBookings.has(single(r.Booking)))){
      const b=booked.get(single(r.Booking)),f=families.get(single(r.Family));
      for(const k of [r.Reference,b.id,b['Booking reference'],b['Source booking ID']])if(k)terms.add('"'+String(k).replace(/["\\\r\n]/g,' ')+'"');
      for(const addr of [r['Parent email'],f?.Email,f?.['Secondary guardian email']]){
        if(!addr)continue;
        if(!/^[\w.%+'-]+@[\w.-]+$/.test(addr))throw Error('Unresolved contact address');
        terms.add('to:'+addr);terms.add('from:'+addr);
      }
      for(const id of [r['Source Gmail ID'],r['Confirmation Gmail ID'],r['Last reply Gmail ID']].filter(Boolean)){
        if(!mailId(id))throw Error('Unresolved Gmail ID');knownIds.add(id);
      }
      for(const e of snap.intake)if(((r.Reference&&r.Reference===e['Web client reference'])||(r['Source Gmail ID']&&r['Source Gmail ID']===e['Message ID']))&&mailId(e['Gmail thread ID']))threadIds.add(e['Gmail thread ID']);
    }
    const queries=['in:anywhere -in:spam from:notify@payments.interac.ca'],keys=[...terms].sort();
    for(let i=0;i<keys.length;i+=6)queries.push('in:anywhere -in:spam {'+keys.slice(i,i+6).join(' ')+'}');
    for(const q of queries){
      let token;const seen=new Set();
      do{
        const list=await cached(['search',q,token||''],()=>read('threads',[['q',q],['maxResults','100'],...(token?[['pageToken',token]]:[])]));
        if(seen.has(token))throw Error('Repeated Gmail page');seen.add(token);
        for(const t of list.threads||[])threadIds.add(t.id);token=list.nextPageToken;
      }while(token);
    }
    for(const id of knownIds){
      const m=await cached(['id',id],()=>read('messages/'+id,[['format','minimal'],['fields','id,threadId']]));
      if(m.id!==id||!mailId(m.threadId))throw Error('Unresolved Gmail ID');threadIds.add(m.threadId);
    }
    for(const id of [...threadIds].sort()){
      if(!mailId(id))throw Error('Invalid thread');
      const msgs=await cached(['thread',id],async()=>{
        const t=await read('threads/'+id,[['format','full']]);
        if(t.id!==id||!t.messages?.length)throw Error('Missing thread');
        return t.messages.map(message);
      });
      snap.messages.push(...msgs);
    }
    const end=await read('profile',[]);
    if(end.historyId!==profile.historyId)throw Error('Mailbox changed during check');
    const {items,results}=followup(snap,clock());
    const due=results.filter(r=>r.outcome==='under 24 hours').map(r=>Date.parse(r.sentAt)+24*HOUR);
    const result={items,eligibleBookings:targetBookings.size};
    await storage.put('rf:evidence',{fingerprint,result,nextDue:due.length?Math.min(...due):null});
    return result;
  }
  async function step({force=false}={}){
    const now=clock(),report=await storage.get('rf:report'),started=await storage.get('rf:start');
    if(!force&&!started&&report&&now<(report.retryAt||report.checkedAt+HOUR))return report;
    if(!started||now-started>HOUR){
      await clear(storage,prefix);await storage.put('rf:start',now);
    }
    let remaining=5;
    async function cached(parts,fetchValue){
      const key=prefix+digest(JSON.stringify(parts)),saved=await valueOf(storage,key);
      if(saved!==undefined)return saved;
      if(!remaining--)throw more;
      const value=await fetchValue();await putValue(storage,key,value);return value;
    }
    try{
      const result=await build(cached),next={...result,checkedAt:clock(),state:'ready'};
      await storage.put('rf:report',next);await storage.delete('rf:start');await clear(storage,prefix);return next;
    }catch(e){
      if(e===more)return {state:'checking'};
      const next={...report,state:'unavailable',retryAt:now+300000};await storage.put('rf:report',next);
      await storage.delete('rf:start');await clear(storage,prefix);return {state:'unavailable'};
    }
  }
  return {step};
}
