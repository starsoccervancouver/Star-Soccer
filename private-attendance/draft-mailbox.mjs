import {Buffer} from 'node:buffer';
import {marker} from './draft-rules.mjs';
const root='https://gmail.googleapis.com/gmail/v1/users/me/';
const quote=s=>'"'+String(s||'').replace(/["\\\r\n]/g,' ')+'"';
const header=(m,n)=>m.payload?.headers?.find(h=>h.name.toLowerCase()===n)?.value||'';
const addr=(m,n)=>header(m,n).trim().toLowerCase().replace(/^.*<([^>]+)>.*$/,'$1');
const encoded=s=>'=?UTF-8?B?'+Buffer.from(s).toString('base64')+'?=';
export function mime(c,to=c.to){
 const body=Buffer.from(c.html).toString('base64').match(/.{1,76}/g).join('\r\n');
 return Buffer.from(['To: '+to,'Subject: '+encoded(c.subject),'Message-ID: <'+marker(c.key)+'@starsoccer.ca>',
  'MIME-Version: 1.0','Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',body].join('\r\n')).toString('base64url');
}
export function draftMailbox({read,fetchFn,access,owner}){
 async function write(path,method,message){
  const r=await fetchFn(new URL(path,root),{method,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({message})});
  if(!r.ok)throw Error('GMAIL_'+r.status);
  return r.json();
 }
 const info=async id=>read('messages/'+encodeURIComponent(id),[['format','metadata']]);
 const search=async q=>(await read('messages',[['q',q],['maxResults','10']])).messages||[];
 async function getDraft(id){try{return await read('drafts/'+encodeURIComponent(id),[['format','minimal']]);}catch(e){if(e.message==='GMAIL_404')return null;throw e;}}
 return {
  getDraft,
  async findManagedDraft(key,to){
   const ref=marker(key), messageId='<'+ref+'@starsoccer.ca>';
   const page=await read('drafts',[['q','in:drafts rfc822msgid:'+ref+'@starsoccer.ca'],['maxResults','2']]);
   if(page.nextPageToken||page.drafts?.length!==1)return null;
   const d=await read('drafts/'+encodeURIComponent(page.drafts[0].id),[['format','metadata']]);
   const m=d.message;
   if(!m?.labelIds?.includes('DRAFT')||m.labelIds.includes('TRASH')||addr(m,'to')!==to ||
      header(m,'message-id')!==messageId||!header(m,'subject').includes(ref)||
      header(m,'cc')||header(m,'bcc')||header(m,'to').includes(','))return null;
   return d;
  },
  async sent(id,to){const m=await info(id);return m.labelIds?.includes('SENT')&&!m.labelIds.includes('DRAFT')&&(!to||addr(m,'to')===to)?m.id:null;},
  async prior(c){
   const q='in:anywhere {in:sent in:drafts} to:'+c.to+' ';
   if(await search(q+quote(marker(c.key))).then(x=>x.length))return true;
   const queries=[];
   if(c.lookup)queries.push(quote(c.lookup));
   if(c.kind==='Confirmation'){
    const since=Date.parse(c.registeredAt);
    queries.push('{subject:confirm subject:registration} '+quote(c.child)+' '+(Number.isFinite(since)?'after:'+Math.floor((since-86400000)/1000):quote(c.acceptedDate)));
   }
   if(c.kind==='Receipt')queries.push('subject:receipt '+quote(c.paymentAmount)+' after:'+String(Math.floor(Date.parse(c.paymentDate)/1000)-86400));
   if(c.kind==='Renewal')queries.push('subject:renew '+quote(c.child)+' after:'+Math.floor(Date.parse(c.expiry)/1000-21*86400));
   for(const extra of queries){
    for(const hit of await search(q+extra)){
     const m=await info(hit.id),tag=header(m,'subject').match(/SSMAIL-[a-f0-9]{22}/i)?.[0];
     if(!tag||tag.toLowerCase()===marker(c.key).toLowerCase())return true;
    }
   }
   return false;
  },
  async findSent(key,log){
   const to=log.Recipient;
   const valid=m=>m.labelIds?.includes('SENT')&&!m.labelIds.includes('DRAFT')&&addr(m,'to')===to;
   const ref=marker(key);
   const results=await search('in:sent {rfc822msgid:'+ref+'@starsoccer.ca "'+ref+'"}');
   const hits=[];for(const {id} of results){const m=await info(id);if(valid(m))hits.push(m.id);}
   if(hits.length===1)return hits[0];
   if(!hits.length&&log['Gmail thread ID']){
    let t;try{t=await read('threads/'+encodeURIComponent(log['Gmail thread ID']),[['format','metadata']]);}catch(e){if(e.message!=='GMAIL_404')throw e;}
    const sent=(t?.messages||[]).filter(valid);if(sent.length===1)return sent[0].id;
   }
   return null;
  },
  create:c=>write('drafts','POST',{raw:mime(c)}),
  async reviseReceipt(id,c,state,signature,beforeWrite){
   const section=c.receiptAnchor+c.allocationHtml;
   const previousSignature=list=>signature({...c,html:c.html.replace(section,()=>c.receiptAnchor+list)});
   // Only allocation changes may update a receipt already addressed to a family.
   if(state.allocationHtml!==undefined && previousSignature(state.allocationHtml)!==state.signature)return 'changed';
   const path='drafts/'+encodeURIComponent(id);
   const {message}=await read(path,[['format','raw']]);
   if(!message?.raw)throw Error('GMAIL_DRAFT_UNAVAILABLE');
   const raw=Buffer.from(message.raw,'base64url').toString('latin1');
   const boundary=/\r?\n\r?\n/.exec(raw);
   if(!boundary)return 'review';
   const headers=raw.slice(0,boundary.index);
   const unfolded=headers.replace(/\r?\n[ \t]+/g,' ');
   const to=unfolded.match(/^To:[^\r\n]+/gim)||[];
   if(to.length!==1||to[0].split('@').length!==2||to[0].slice(3).trim().toLowerCase().replace(/^.*<([^>]+)>$/,'$1')!==c.to||
      /^(?:Cc|Bcc|Resent-To|Resent-Cc|Resent-Bcc|Content-Length):/im.test(headers)||
      !/^Content-Type:\s*text\/html\s*;\s*charset=["']?utf-8\b/im.test(headers)||
      !/^Content-Transfer-Encoding:[ \t]*base64[ \t]*\r?$/im.test(headers))return 'review';
   const offset=boundary.index+boundary[0].length;
   const html=Buffer.from(raw.slice(offset),'base64').toString('utf8');
   const start=html.indexOf(c.receiptAnchor);
   if(start<0||start!==html.lastIndexOf(c.receiptAnchor))return state.allocationHtml===undefined?'changed':'review';
   const end=start+c.receiptAnchor.length,tail=html.slice(end);
   const oldList=/^<ul>(?:<li>[^<]*<\/li>)+<\/ul>/.exec(tail)?.[0]||'';
   if(!oldList && /^\s*<(?:ul|ol)\b/i.test(tail))return 'review';
   if(state.allocationHtml===undefined && previousSignature(oldList)!==state.signature &&
      !(oldList===c.allocationHtml && html===c.html))return 'changed';
   if(oldList===c.allocationHtml)return 'updated'; // A previous PUT may have succeeded before its checkpoint.
   if(state.allocationHtml!==undefined && oldList!==state.allocationHtml && oldList!==state.pendingAllocationHtml)return 'review';
   const revised=html.slice(0,end)+c.allocationHtml+tail.slice(oldList.length);
   const body=Buffer.from(revised).toString('base64').match(/.{1,76}/g).join('\r\n');
   await beforeWrite(oldList);
   const result=await write(path,'PUT',{threadId:message.threadId,raw:Buffer.from(raw.slice(0,offset)+body,'latin1').toString('base64url')});
   if(result.id!==id)throw Error('GMAIL_DRAFT_UNCERTAIN');
   return 'updated';
  },
  async obsolete(id,key,reason){
   const path='drafts/'+encodeURIComponent(id),original=await read(path,[['format','raw']]);
   if(!original.message?.raw)throw Error('GMAIL_DRAFT_UNAVAILABLE');
   const bytes=Buffer.from(original.message.raw,'base64url').toString('latin1');
   const split=/\r?\n\r?\n/.exec(bytes);
   if(!split)throw Error('GMAIL_DRAFT_UNAVAILABLE');
   const fields=bytes.slice(0,split.index).split(/\r?\n(?![ \t])/);
   // Preserve the owner's edited MIME body and attachments. Remove every delivery recipient.
   const keep=fields.filter(h=>! /^(?:(?:Resent-)?(?:To|Cc|Bcc)|Subject):/i.test(h));
   const updated=['To: '+owner,'Subject: '+encoded('Obsolete Star Soccer draft | '+marker(key)),...keep].join('\r\n')+'\r\n\r\n'+bytes.slice(split.index+split[0].length);
   return write(path,'PUT',{raw:Buffer.from(updated,'latin1').toString('base64url')});
  }
 };
}
