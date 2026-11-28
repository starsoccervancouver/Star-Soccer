import {addressedToCoach} from './coach-mailboxes.mjs';
// Reads the connected mailbox and ledger only when an authorized staff member opens the queue.
import {transferNotice,messageText} from './gmail-message.mjs';

const pageSize = 12;
const mailId = id => typeof id === 'string' && /^[a-f0-9]{10,32}$/i.test(id);
const header = (message, name) => message?.payload?.headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
const live = m => !m.labelIds?.some(s => ['DRAFT','TRASH','SPAM','CHAT'].includes(s));
const sent = m => m.labelIds?.includes('SENT');
const metadata = [['format','metadata'],['metadataHeaders','Subject'],['metadataHeaders','From']];
// Keep Gmail reads bounded within one Worker request and preserve report order.
async function readInBatches(rows,read) {
  const results=[];
  for(let i=0;i<rows.length;i+=3)results.push(...await Promise.all(rows.slice(i,i+3).map(read)));
  return results;
}
// A mailbox flag is a reason to inspect a message. Only coaching-related mail belongs in Reports.
function inboxPolicy(labels) {
  const labelIds = pattern => new Set(Object.entries(labels).filter(([name])=>pattern.test(name)).map(([,id])=>id));
  const admin = labelIds(/^(?:admin|business|payments - outgoing|newsletters|social media)(?:\/|$)/i);
  const family = labelIds(/^(?:leads|registrations|payments - incoming)(?:\/|$)/i);
  // Saved rows can outlive the source email. Use distinctive service subjects when only the title survives.
  const isAdminSubject = subject => /\b(?:payroll|vendor invoice|merchant payout|stripe payout|domain renewal|workspace licen[cs](?:e|ing)|search console|google analytics|software subscription)\b/i.test(subject)
    || /\bpayout (?:for|to) star\s*soccer\b/i.test(subject)
    || /\b(?:google workspace|business plus trial)\b.*\blicen[cs](?:es?|ing)\b/i.test(subject)
    || /\[[\w.-]+\/[\w.-]+\]\s*run (?:failed|cancelled|canceled):/i.test(subject)
    || /\bairtable authentication (?:failed|error|expired)\b/i.test(subject);
  function administrative(message, fallback='') {
    const subject = header(message,'Subject') || fallback;
    const sender = header(message,'From').match(/[\w.+-]+@[\w.-]+/i)?.[0].toLowerCase() || '';
    return !!message?.labelIds?.some(id=>admin.has(id)) || isAdminSubject(subject)
      || /^(?:no-?reply@accounts\.google\.com|sc-noreply@google\.com|workspace-?support@google\.com|notifications@github\.com|hi@mailing\.windsor\.ai)$/.test(sender)
      || sender==='notifications@stripe.com' && /\bpayout\b/i.test(subject)
      || /@(?:[\w-]+\.)?(?:openai\.com|googleworkspace\.com)$/.test(sender) && /\b(?:invoice|billing|receipt|support|licen[cs]e)\b/i.test(subject);
  }
  function coaching(message, title) {
    return !!message?.labelIds?.some(id=>family.has(id)) || /\b(?:camp|camps|soccer|training|coaching|lesson[s]?|class(?:es)?|player[s]?|registration|practice|pickup|drop-in|tournament)\b/i.test(title.replace(/star[\s-]*soccer/gi,''));
  }
  return {administrative, coaching};
}
// Reapply the current filing to ledger-backed entries and previously saved report snapshots.
export async function filterReportItems(page,kind,{read,labels},known=new Map()) {
  const policy=inboxPolicy(labels), items=[];
  const candidates=page.items.filter(item=>!policy.administrative(null,item.title));
  const missing=new Set(candidates.map(item=>item.messageId).filter(id=>mailId(id)&&!known.has(id)));
  await readInBatches([...missing],async id=>{
    try{known.set(id,await read('messages/'+id,metadata));}
    catch(error){if(error.message!=='GMAIL_404')throw error;known.set(id,null);}
  });
  for(const item of candidates) {
    const message=known.get(item.messageId);
    if(policy.administrative(message,item.title))continue;
    if(kind==='other' && item.status==='Review in Gmail' && !policy.coaching(message,item.title))continue;
    items.push(item);
  }
  return {...page,items};
}
const day = time => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(time));
const intakeFields = ['Message ID','Gmail thread ID','Kind','Review','Reply workflow','Lead stage','Subject','Received date'];
const regFields = ['Source Gmail ID','Confirmation Gmail ID','Reference','Received at','Status','Next session date','Parent email'];
const ignored = f => ['Duplicate','Ignore'].includes(f.Review);
const settled = f => ['Confirmed','Declined'].includes(f.Status) || !!f['Confirmation Gmail ID'];
const noReply = f => ['No reply needed','Sent - confirmed'].includes(f['Reply workflow']) || ['Registered','Closed','Contacted','Trial booked','Trial completed'].includes(f['Lead stage']);
const sourceId = f => f['Source Gmail ID'] || f['Message ID'];
function slicePage(items, cursor) {
  const offset = Number(cursor || 0);
  if (!Number.isSafeInteger(offset) || offset < 0) throw Error('INVALID_CURSOR');
  return {items:items.slice(offset,offset+pageSize),next:items.length>offset+pageSize?String(offset+pageSize):null};
}
// Search only this recipient and independently verify the To header before returning any text.
export async function coachInquiryPage({ledger,read,labels},mailbox,cursor='') {
  const params=[['q','to:'+mailbox+' -in:sent -in:drafts -in:spam -in:trash'],['maxResults',String(pageSize)]];
  if(cursor)params.push(['pageToken',cursor]);
  const page=await read('messages',params);
  const questions=new Set((await ledger.list('intake',intakeFields))
    .map(row=>row.fields).filter(f=>f.Kind==='Question'&&!ignored(f)&&!noReply(f)).map(sourceId));
  const policy=inboxPolicy(labels);
  const items=await readInBatches((page.messages||[]).filter(m=>questions.has(m.id)),async({id})=>{
    let m;
    try{m=await read('messages/'+id,[['format','full']]);}
    catch(error){if(error.message==='GMAIL_404')return null;throw error;}
    if(!live(m)||sent(m)||!addressedToCoach(header(m,'To'),mailbox)||policy.administrative(m))return null;
    return {key:id,title:header(m,'Subject')||'Parent inquiry',status:messageText(m.payload).trim()||m.snippet||'Parent inquiry',date:day(Number(m.internalDate))};
  });
  return {items:items.filter(Boolean),resolved:[],next:page.nextPageToken||null};
}
export async function attentionPage({ledger,read,labels,mailbox,now}, kind, cursor='') {
  const root='https://mail.google.com/mail/u/?authuser='+encodeURIComponent(mailbox);
  const result={items:[],resolved:[],next:null,inbox:root+'#inbox'};
  const known=new Map(), policy=inboxPolicy(labels);
  function add(key,title,status,id,date) {
    result.items.push({key,title,status,date,messageId:id||'',href:mailId(id)?root+'#all/'+id:result.inbox});
  }
  async function thread(id) {
    if(!mailId(id))return null;
    try{
      const value=await read('threads/'+id,metadata);
      for(const m of value.messages||[])known.set(m.id,m);
      return value;
    }
    catch(e){if(e.message==='GMAIL_404')return null;throw e;}
  }
  async function search(type,q) {
    const params=[['q',q],['maxResults',String(pageSize)]];
    if(cursor)params.push(['pageToken',cursor]);
    const page=await read(type,params);
    result.next=page.nextPageToken||null;
    return page[type]||[];
  }
  const intake=async()=> (await ledger.list('intake',intakeFields)).map(r=>({...r.fields,intakeId:r.id}));
  const registrations=async()=> (await ledger.list('registrations',regFields)).map(r=>({...r.fields,id:r.id}));
  if(kind==='registrations'){
    const [regs,mail]=await Promise.all([registrations(),intake()]);
    const origins=new Set(regs.map(sourceId).filter(Boolean));
    const suppressed=new Set(mail.filter(ignored).map(sourceId));
    const open=regs.filter(r=>!settled(r)&&!suppressed.has(sourceId(r))&&(!r['Next session date']||r['Next session date']>=day(now)));
    const manual=mail.filter(f=>f.Kind==='Registration candidate'&&!origins.has(sourceId(f))&&!ignored(f)&&!noReply(f)&&f.Review!=='Matched');
    const page=slicePage([...open.sort((a,b)=>a.id.localeCompare(b.id)),...manual],cursor);
    result.next=page.next;
    const confirmed=await readInBatches(page.items,async r=>{
      if(r.Kind==='Registration candidate')return false;
      const contact=r['Parent email']?.trim().toLowerCase();
      if(/^SS-[A-Z0-9-]{4,100}$/i.test(r.Reference||'')&&/^[a-z0-9._%+-]+@[a-z0-9.-]+$/i.test(contact||'')){
        const q='in:sent -in:drafts to:'+contact+' subject:confirmed subject:"'+r.Reference+'"';
        const found=await read('messages',[['q',q],['maxResults','5']]);
        for(const {id} of found.messages||[]){
          const m=await read('messages/'+id,[['format','metadata'],['metadataHeaders','Subject'],['metadataHeaders','To']]);
          const subject=header(m,'subject').trim(),to=header(m,'to').toLowerCase().trim();
          if(live(m)&&sent(m)&&/registration confirmed\s*\|/i.test(subject)&&subject.toUpperCase().endsWith('| '+r.Reference.toUpperCase())&&(to===contact||to.endsWith('<'+contact+'>')))return true;
        }
      }
      return false;
    });
    for(const [index,r] of page.items.entries()){
      if(confirmed[index])continue;
      if(r.Kind==='Registration candidate')add(sourceId(r)||r.intakeId,r.Subject||'Registration request','Registration needs review',sourceId(r),r['Received date']);
      else add(r.id,r.Reference||'Website registration','No confirmation recorded',sourceId(r),r['Received at']?.slice(0,10));
    }
  }else if(kind==='inquiries'){
    const candidates=new Map();
    for(const f of await intake()){
      if(f.Kind!=='Question'||ignored(f))continue;
      const key=f['Gmail thread ID']||sourceId(f);
      if(!key)continue;
      const old=candidates.get(key);
      if(!old || (f['Received date']||'')+(sourceId(f)||'')>(old['Received date']||'')+(sourceId(old)||''))candidates.set(key,f);
    }
    const page=slicePage([...candidates].sort(([a],[b])=>a.localeCompare(b)),cursor);
    result.next=page.next;
    const conversations=await readInBatches(page.items,([key])=>thread(key));
    for(const [index,[key,f]] of page.items.entries()){
      const value=conversations[index];
      const msgs=(value?.messages||[]).filter(m=>live(m)&&!policy.administrative(m)).sort((a,b)=>Number(b.internalDate)-Number(a.internalDate));
      if(value&&!msgs.length||msgs[0]&&sent(msgs[0]))continue;
      const latest=msgs[0], id=latest?.id||sourceId(f);
      if(noReply(f)&&(!latest||id===sourceId(f)))continue;
      add(key,header(latest,'subject')||f.Subject||'Parent inquiry',latest?'Awaiting reply':'Check reply in Gmail',id,latest?day(Number(latest.internalDate)):f['Received date']);
    }
  }else if(kind==='payments'){
    const depositLabels=[labels.Deposited,labels['Payments - Incoming/Deposited']].filter(Boolean);
    if(!depositLabels.length)throw Error('PAYMENT_LABELS_MISSING');
    const receipts=await ledger.list('payments',['Source payment ID','Direction','Verification','Evidence reference']);
    const verified=new Set(receipts.filter(r=>r.fields.Verification==='Verified'&&r.fields.Direction==='Incoming').flatMap(({fields:f})=>[f['Source payment ID'],...String(f['Evidence reference']||'').split(/[^a-zA-Z0-9_-]+/)]).filter(Boolean));
    const matches=await search('messages','newer_than:30d from:notify@payments.interac.ca');
    const messages=await readInBatches(matches,({id})=>read('messages/'+id,[['format','full']]));
    for(const [index,{id}] of matches.entries()){
      const msg=messages[index];
      known.set(id,msg);
      const note=transferNotice(msg);
      if(!note)continue;
      const key=note.ref?'INTERAC-'+note.ref:msg.threadId||id;
      if(depositLabels.some(label=>msg.labelIds?.includes(label))||note.closed||[key,id,'gmail:'+id,note.ref].some(value=>verified.has(value))){result.resolved.push(key);continue;}
      if(note.incoming)add(key,note.subject,'Awaiting deposit verification',id,day(Number(msg.internalDate)));
    }
  }else if(kind==='other'){
    const [mail,regs]=await Promise.all([intake(),registrations()]);
    const manualItems=[];
    for(const f of mail){
      if(ignored(f)||f.Review==='Matched'||noReply(f))continue;
      const depositReview=f.Kind==='Payment claim'&&f.Review==='Needs clarification';
      const manual=f.Kind==='Other'&&(f.Review==='Needs clarification'||f['Lead stage']==='Follow-up needed'||['Needs review','Awaiting approval','Changes requested','Blocked'].includes(f['Reply workflow']));
      if(depositReview||manual)manualItems.push({f,status:depositReview?'Review the payment match':'Follow-up requested'});
    }
    if(!cursor||/^intake_\d+$/.test(cursor)){
      const page=slicePage(manualItems.sort((a,b)=>a.f.intakeId.localeCompare(b.f.intakeId)),cursor.slice(7));
      for(const {f,status} of page.items)add(f['Gmail thread ID']||sourceId(f)||f.intakeId,f.Subject||'Email follow-up',status,sourceId(f),f['Received date']);
      if(page.next){
        result.next='intake_'+page.next;
        return filterReportItems(result,kind,{read,labels},known);
      }
      cursor='';
    }
    const tracked=new Set([...mail.filter(f=>f.Kind!=='Other'||ignored(f)||noReply(f)||f.Review==='Matched').flatMap(f=>[f['Gmail thread ID'],sourceId(f)]),...regs.map(sourceId)].filter(Boolean));
    for(const {f} of manualItems)for(const id of [f['Gmail thread ID'],sourceId(f)])if(id)tracked.add(id);
    const inboxThreads=await search('threads','in:inbox newer_than:30d {is:starred is:important} -category:promotions -category:social -category:forums -from:notify@payments.interac.ca');
    const matches=inboxThreads.filter(({id})=>!tracked.has(id));
    const conversations=await readInBatches(matches,({id})=>thread(id));
    for(const [index,{id}] of matches.entries()){
      const t=conversations[index];
      const msgs=(t?.messages||[]).filter(live).sort((a,b)=>Number(b.internalDate)-Number(a.internalDate));
      const m=msgs[0];
      if(!m||sent(m)||msgs.some(m=>tracked.has(m.id))||!m.labelIds?.includes('INBOX')||!m.labelIds.some(l=>['STARRED','IMPORTANT'].includes(l)))continue;
      add(id,header(m,'subject')||'Important email','Review in Gmail',m.id,day(Number(m.internalDate)));
    }
  }else throw Error('INVALID_ACTION');
  return filterReportItems(result,kind,{read,labels},known);
}
