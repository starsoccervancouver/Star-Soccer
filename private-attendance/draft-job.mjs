import {createHash} from 'node:crypto';
import {accepted,verified,localDay,coverageDay,confirmation,receipt,renewal,draftFields} from './draft-rules.mjs';
const snapshot=c=>createHash('sha256').update(JSON.stringify([c.to,c.subject,c.html])).digest('hex');
const sourceKey='mail-drafts:baseline:v1';
const mailKey=k=>'mail-drafts:lock:'+k;
const actionable=new Set(['Draft','Creating','Review']);
export async function runDraftJob({db,storage,mail,now}){
 const data={};
 // Airtable transport rate limits calls; read just trigger tables until there is work.
 for(const name of ['bookings','payments','enrollments','draftLog'])data[name]=await db.list(name,draftFields[name]);
 const today=localDay(now),first=await storage.get(sourceKey);
 const baseline=first||{at:new Date(now).toISOString(),bookings:data.bookings.filter(x=>accepted(x.fields)).map(x=>x.id),payments:data.payments.filter(x=>verified(x.fields)).map(x=>x.id)};
 if(!first)await storage.put(sourceKey,baseline);
 const logs=new Map(data.draftLog.map(r=>[r.fields['Email key'],r]));
 const candidates=[];
 const open=(kind,id)=>{const r=logs.get(kind+':'+id);return r&&actionable.has(r.fields.Status);};
 for(const r of data.bookings){
  if(open('Confirmation',r.id)||accepted(r.fields)&&!baseline.bookings.includes(r.id)&&!logs.has('Confirmation:'+r.id))candidates.push(['Confirmation',r]);
 }
 for(const r of data.payments){
  if(open('Receipt',r.id)||verified(r.fields)&&!baseline.payments.includes(r.id)&&!logs.has('Receipt:'+r.id))candidates.push(['Receipt',r]);
 }
 // Once a grandfathered record becomes ineligible, a later acceptance/verification is new activity.
 const stillAccepted=new Set(data.bookings.filter(x=>accepted(x.fields)).map(x=>x.id));
 const stillVerified=new Set(data.payments.filter(x=>verified(x.fields)).map(x=>x.id));
 const remaining={...baseline,bookings:baseline.bookings.filter(id=>stillAccepted.has(id)),payments:baseline.payments.filter(id=>stillVerified.has(id))};
 if(remaining.bookings.length!==baseline.bookings.length||remaining.payments.length!==baseline.payments.length)await storage.put(sourceKey,remaining);
 for(const [key,log] of logs){
  const [kind,id]=String(key).split(':');
  if(!['Confirmation','Receipt'].includes(kind)||!actionable.has(log.fields.Status))continue;
  const rows=kind==='Confirmation'?data.bookings:data.payments;
  if(!rows.some(r=>r.id===id))candidates.push([kind,{id,fields:{}}]);
 }
 const daily=await storage.get('mail-drafts:renewal-day')!==today;
 const end=new Date(Date.parse(today)+7*86400000).toISOString().slice(0,10);
 for(const r of data.enrollments){
  const e=r.fields,expiry=coverageDay(e['Approved coverage expiry']);
  if(daily&&e['Enrollment status']==='Active'&&e['Billing schedule']!=='Per session'&&e['Renewal guidance']!=='Pay per session'&&(!expiry||expiry>=today&&expiry<=end))
   candidates.push(['Renewal',r,expiry||'unknown']);
 }
 for(const [key,row] of logs){
  if(!key?.startsWith('Renewal:')||!actionable.has(row.fields.Status)||row.fields.Status==='Obsolete')continue;
  const [,id,expiry]=key.split(':'),r=data.enrollments.find(e=>e.id===id)||{id,fields:{}};
  if(!candidates.some(([k,x,v])=>k==='Renewal'&&x.id===id&&expiry===v))candidates.push(['Renewal',r,expiry]);
 }
 if(candidates.length){
  for(const name of Object.keys(draftFields))if(!data[name])data[name]=await db.list(name,draftFields[name]);
  let firstError;
  for(const [kind,r,expiry] of candidates){
   let c;
   if(kind==='Confirmation')c=confirmation(data,r,today);
   if(kind==='Receipt')c=receipt(data,r,today);
   if(kind==='Renewal')c=renewal(data,r,expiry,today);
   if(kind==='Renewal'&&expiry==='unknown'&&!coverageDay(r.fields['Approved coverage expiry'])){c.review='Confirm the approved coverage expiry.';delete c.obsolete;}
   const old=logs.get(c.key)?.fields||{};
   if(old.Status==='Sent'||old.Status==='Obsolete')continue;
   try{await processDraft({c,old,db,storage,mail});}catch(error){firstError??=error;}
  }
  if(firstError)throw firstError;
 }
 if(daily)await storage.put('mail-drafts:renewal-day',today);
 const waitingRenewal=candidates.some(([kind,r,expiry])=>kind==='Renewal'&&coverageDay(r.fields['Approved coverage expiry'])===expiry&&expiry>=today&&!['Sent','Obsolete'].includes(logs.get('Renewal:'+r.id+':'+expiry)?.fields.Status));
 return {activated:baseline.at,checked:new Date(now).toISOString(),renewals:today,waitingRenewal};
}
export async function processDraft({c,old,db,storage,mail}){
 const lock=mailKey(c.key),state=await storage.get(lock);
 async function save(status,detail='',extra={}){
  const values={'Email key':c.key,'Email kind':c.kind,'Source record':c.source,Status:status,'Review detail':detail||'—',...extra};
  if(Object.entries(values).every(([k,v])=>old[k]===v))return;
  await db.save('draftLog',values,{key:'Email key'});
 }
 async function sent(id){
  if(c.registration){
   const rows=await db.list('registrations',['Confirmation Gmail ID'],"RECORD_ID()='"+c.registration+"'");
   const f=rows.find(r=>r.id===c.registration)?.fields;
   if(!f||f['Confirmation Gmail ID']&&f['Confirmation Gmail ID']!==id)return save('Review','The registration links a different sent message.');
   if(!f['Confirmation Gmail ID'])await db.save('registrations',{'Confirmation Gmail ID':id},{id:c.registration});
  }
  return save('Sent','Verified in Star Soccer Gmail Sent.',{'Sent Gmail ID':id});
 }
 const draftId=old['Gmail draft ID']||state?.draftId;
 if(c.existingSent&&!draftId){
  try{if(await mail.sent(c.existingSent,c.to))return sent(c.existingSent);}catch(e){if(e.message!=='GMAIL_404')throw e;}
  return save('Review','Check the existing Confirmation Gmail ID in Gmail Sent.');
 }
 if(draftId){
  const extra={'Gmail draft ID':draftId,Recipient:old.Recipient||state.to};
  const draft=await mail.getDraft(draftId);
  if(!draft){
   const found=await mail.findSent(c.key,{...old,...extra,'Gmail thread ID':old['Gmail thread ID']||state?.thread});
   if(found)return sent(found);
   return save('Review','Draft is missing and a sent copy could not be verified. Check Gmail before taking action.',extra);
  }
  if(draft.message?.threadId)extra['Gmail thread ID']=draft.message.threadId;
  const withdrawn=c.obsolete||c.review||(c.existingSent?'A sent confirmation already exists.':'')||(state?.signature&&c.html&&state.signature!==snapshot(c)?'Booking, payment or recipient details changed. Review before sending.':'');
  if(withdrawn){
   await mail.obsolete(draftId,c.key,withdrawn);
   if(c.existingSent&&await mail.sent(c.existingSent,c.to))return sent(c.existingSent);
   return save('Obsolete',withdrawn,extra);
  }
  return save('Draft',c.detail,extra);
 }
 if(c.obsolete){if(old.Status||c.kind==='Renewal')return save('Obsolete',c.obsolete);return;}
 if(c.review)return save('Review',c.review);
 if(state||old.Status==='Creating'){
  const found=await mail.findSent(c.key,{...old,Recipient:old.Recipient||c.to});
  return found?sent(found):save('Review','Draft creation outcome is uncertain. Check Gmail. Automatic retry is held.');
 }
 if(c.kind==='Confirmation'){
  const legacy=await storage.get('confirmation:booking:'+c.id);
  if(legacy&&legacy.status!=='review')return save('Review','Check the existing Coach Desk confirmation draft before creating another.');
 }
 if(c.legacySource){
  const intake=await db.list('intake',['Message ID','Gmail draft ID','Reply workflow','Review'],"{Message ID}='"+String(c.legacySource).replace(/[^a-zA-Z0-9]/g,'')+"'");
  if(intake.some(x=>x.fields['Gmail draft ID']||['Ignore','Duplicate'].includes(x.fields.Review)||['Sent - confirmed','No reply needed'].includes(x.fields['Reply workflow'])))return save('Review','Check the existing intake draft or owner decision.');
 }
 if(await mail.prior(c))return save('Review','Related drafts or sent messages already exist. Check Gmail for the original.');
 const acquired=await storage.transaction(async tx=>{if(await tx.get(lock))return false;await tx.put(lock,{to:c.to,signature:snapshot(c)});return true;});
 if(!acquired)return;
 await save('Creating','Checking Gmail for the new draft.',{Recipient:c.to});
 const d=await mail.create(c);if(!d?.id)throw Error('GMAIL_DRAFT_UNCERTAIN');
 await storage.put(lock,{to:c.to,draftId:d.id,thread:d.message?.threadId,signature:snapshot(c)});
 await save('Draft',c.detail,{Recipient:c.to,'Gmail draft ID':d.id,...(d.message?.threadId?{'Gmail thread ID':d.message.threadId}:{})});
}
