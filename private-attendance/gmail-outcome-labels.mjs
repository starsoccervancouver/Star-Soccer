const single=links=>Array.isArray(links)&&links.length===1?links[0]:null;
const email=s=>String(s||'').trim().toLowerCase();
const addresses=s=>(email(s).match(/[\w.%+'-]+@[\w.-]+\.[a-z]{2,}/g)||[]);
const header=(m,name)=>m?.payload?.headers?.find(h=>h.name.toLowerCase()===name)?.value||'';
const live=m=>m?.id&&!m.labelIds?.some(l=>['TRASH','DRAFT','SPAM','CHAT'].includes(l));
const mailId=id=>typeof id==='string'&&/^[a-f0-9]{10,32}$/i.test(id);
const targets=['Registrations/Registered','Registrations/Confirmtaions','Registrations/Confirmations','Leads/Converted','Payments - Incoming/Receipts'];
const queue='filing:pending:';
const hour=3600000;

export function outcomePlans(registrations,bookings,leads){
 const booked=new Map(bookings.map(r=>[r.id,r.fields]));
 const plans=[];
 for(const {id,fields:r} of registrations){
  const b=booked.get(single(r.Booking)),family=single(r.Family),player=single(r.Player),contact=email(r['Parent email']);
  if(r.Status!=='Confirmed'||!b||!['Accepted','Completed'].includes(b['Booking status'])||!family||single(b.Family)!==family||!player||single(b.Player)!==player||!contact)continue;
  const source=r['Source Gmail ID'],confirmation=r['Confirmation Gmail ID'];
  if(!mailId(source)||!mailId(confirmation)||source===confirmation)continue;
  const candidates=[];
  for(const {fields:f} of leads){
   if(f.Kind!=='Question'||['Ignore','Duplicate'].includes(f.Review)||['Lost','Closed'].includes(f['Lead stage']))continue;
   if(!mailId(f['Message ID'])||email(f['Parent email']||f.Sender)!==contact||f.Family?.length&&single(f.Family)!==family)continue;
   const referenced=!!r.Reference&&r.Reference===f['Web client reference'];
   const explicit=f['Lead stage']==='Registered'&&single(f.Family)===family;
   candidates.push({id:f['Message ID'],sameOutcome:referenced||explicit});
  }
  // A large family history gets processed in independent bounded chunks.
  for(let i=0;i<Math.max(1,candidates.length);i+=3)plans.push({key:id+'-'+i,source,confirmation,contact,received:r['Received at'],leads:candidates.slice(i,i+3)});
 }
 return plans;
}

export function outcomeFiling({storage,ledger,read,modify,labels,owners,clock}){
 async function add(m,names){
  if(!live(m))return 0;
  if(names.some(n=>!targets.includes(n)||!labels[n]))throw Error('FILING_LABEL_MISSING');
  const ids=names.map(n=>labels[n]).filter(id=>!m.labelIds?.includes(id));
  if(!ids.length)return 0;
  await modify(m.id,ids);return 1;
 }
 function isReceipt(m){
  return !!(live(m)&&m.labelIds?.includes('SENT')&&owners.includes(addresses(header(m,'from'))[0])&&/^(?:Star Soccer )?payment receipt (?:for\b|\|)/i.test(header(m,'subject')));
 }
 async function get(id){
  try{const m=await read('messages/'+id,[['format','metadata'],...['From','To','Subject'].map(h=>['metadataHeaders',h])]);return m.id===id&&live(m)?m:null;}
  catch(e){if(e.message==='GMAIL_404')return null;throw e;}
 }
 async function apply(p){
  const sent=await get(p.confirmation),source=await get(p.source);
  const to=addresses(header(sent,'to'));
  if(!sent?.labelIds?.includes('SENT')||!owners.includes(addresses(header(sent,'from'))[0])||to.length!==1||to[0]!==p.contact||
     !source||source.labelIds?.includes('SENT')||Number(sent.internalDate)<Number(source.internalDate))return {verified:0,changed:0};
  const sender=addresses(header(source,'from'))[0];
  if(sender!==p.contact&&!['noreply@formspree.io','submissions@formsubmit.co','noreply@formsubmit.co'].includes(sender))return {verified:0,changed:0};
  const name=labels['Registrations/Confirmations']?'Registrations/Confirmations':'Registrations/Confirmtaions';
  let changed=await add(sent,[name]);changed+=await add(source,['Registrations/Registered']);
  for(const lead of p.leads){
   const m=await get(lead.id);
   if(!m||m.labelIds?.includes('SENT')||m.labelIds?.includes(labels['Leads/Lost'])||Number(m.internalDate)>Number(sent.internalDate))continue;
   const from=addresses(header(m,'from'))[0];
   if(from!==p.contact&&!['noreply@formspree.io','submissions@formsubmit.co','noreply@formsubmit.co'].includes(from))continue;
   if(lead.sameOutcome||m.threadId===sent.threadId||m.threadId===source.threadId)changed+=await add(m,['Leads/Converted']);
  }
  return {verified:1,changed};
 }
 async function step(){
  let progress=await storage.get('filing:progress');
  if(progress?.retryAt>clock())return false;
  try{
   const receipts=await storage.list({prefix:'filing:receipt:',limit:1});
   if(receipts.size){
    const [[key,id]]=receipts,m=await get(id);if(isReceipt(m))await add(m,['Payments - Incoming/Receipts']);
    await storage.delete(key);return true;
   }
   if(!progress?.running){
    if(progress?.checkedAt&&clock()-progress.checkedAt<hour)return false;
    const regs=await ledger.list('registrations',['Reference','Status','Booking','Family','Player','Parent email','Received at','Source Gmail ID','Confirmation Gmail ID'], "{Status}='Confirmed'");
    const books=await ledger.list('bookings',['Booking status','Family','Player']);
    const leads=await ledger.list('intake',['Message ID','Parent email','Sender','Kind','Review','Family','Lead stage','Web client reference'],"{Kind}='Question'");
    const plans=outcomePlans(regs,books,leads);
    for(const plan of plans)await storage.put(queue+plan.key,plan);
    progress={running:true,changed:0,checkedAt:progress?.checkedAt||null};
    await storage.put('filing:progress',progress);
   }
   const pending=await storage.list({prefix:queue,limit:1});
   if(pending.size){
    const [[key,plan]]=pending,result=await apply(plan);
    await storage.transaction(async tx=>{await tx.delete(key);await tx.put('filing:progress',{...progress,changed:progress.changed+result.changed,error:null,retryAt:0});});
    return true;
   }
   await storage.put('filing:progress',{running:false,checkedAt:clock(),changed:progress.changed,error:null});
  }catch(e){
   const code=/^(FILING_LABEL_MISSING|GMAIL_\d{3}|AIRTABLE_\d{3})$/.test(e.message)?e.message:'FILING_RETRY';
   await storage.put('filing:progress',{...progress,error:code,retryAt:clock()+300000});
  }
  return false;
 }
 return {step,isReceipt};
}
