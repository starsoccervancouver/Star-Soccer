import {Buffer} from 'node:buffer';

export const normalize = text => String(text || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const emailOf = text => String(text || '').match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0]?.toLowerCase();
const limit = value => String(value ?? '').trim().slice(0, 1200);
function contents(part, plain, html) {
  if (part.filename) return;
  if (part.body?.data && ['text/plain','text/html'].includes(part.mimeType)) {
    const value = Buffer.from(part.body.data, 'base64url').toString('utf8').slice(0, 200000);
    (part.mimeType === 'text/plain' ? plain : html).push(value);
  }
  for (const child of part.parts || []) contents(child, plain, html);
}
function htmlText(html) {
  return html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(td|tr|p|div)>|<br\s*\/?>/gi,'\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&zwnj;|[\u200c\xa0]/gi, ' ').replace(/&amp;/g,'&').replace(/&#39;|&apos;/g,"'").replace(/&quot;/g,'"');
}
function formFields(body) {
  const fields = {};
  const lines = body.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (let i=0; i<lines.length; i++) {
    const pair = /^([A-Za-z][A-Za-z0-9 ()_/-]{0,50}):\s*(.*)$/.exec(lines[i]);
    if (pair) fields[pair[1].toLowerCase()] ??= limit(pair[2] || (/^[^:]+:$/.test(lines[i+1] || '') ? '' : lines[i+1]));
  }
  return fields;
}
export function classifyMessage(message, labels, ownerEmail, confirmationMailbox) {
  const ids = new Set(message.labelIds);
  if (['DRAFT','SPAM','TRASH','CHAT'].some(id => ids.has(id))) return null;
  const headers = message.payload.headers || [];
  const header = name => headers.find(h => h.name.toLowerCase() === name)?.value || '';
  const auth = headers.find(h => h.name.toLowerCase()==='authentication-results' && /^mx\.google\.com\s*;/i.test(h.value))?.value || '';
  const sender = emailOf(header('from')), subject = limit(header('subject'));
  const meta = {id:message.id,thread:message.threadId,received:new Date(Number(message.internalDate)).toISOString(),sender,subject};
  if(ids.has('SENT')){
    if(!confirmationMailbox || ![confirmationMailbox,ownerEmail].includes(sender)) return null;
    const reference=/^Star Soccer camp registration confirmed\s*\|\s*(?:[^|]+\|\s*)?(SS-(?:CAMP|DAY)-[A-Z0-9-]{4,90})$/i.exec(subject)?.[1]?.toUpperCase();
    const to=header('to'), contact=emailOf(to);
    if(reference && contact && to.split('@').length===2 && !header('cc') && !header('bcc')){
      return {...meta,type:'camp-confirmation',reference,contact};
    }
    return null;
  }
  const plain=[], html=[]; contents(message.payload,plain,html);
  const body = plain.join('\n') || htmlText(html.join('\n'));
  const flat = body.replace(/\s+/g, ' ');
  const fields = formFields(body);
  const has = name => !!labels[name] && ids.has(labels[name]);
  if (sender === 'notify@payments.interac.ca' || has('Payments - Incoming') || has('Deposited')) {
    if (!has('Deposited') || (!has('Payments - Incoming') && sender!=='notify@payments.interac.ca')) return null;
    const verified = sender==='notify@payments.interac.ca' && /\bdmarc=pass\b[^;]*\bheader\.from=payments\.interac\.ca\b/i.test(auth);
    const ref = flat.match(/Reference Number:\s*([A-Za-z0-9]{6,24})\b/i)?.[1];
    const match = subject.match(/^(?:Interac e-Transfer:\s*)(.+?) sent you \$([\d,]+\.\d{2})[. !]/i);
    const bodyAmount = flat.match(/Amount:\s*\$([\d,]+\.\d{2})\s*\(CAD\)/i);
    const amount = match && Number(match[2].replaceAll(',',''));
    const memo = flat.match(/Message:\s*(.*?)\s*Transfer Details/i)?.[1] || '';
    return {...meta,type:'payment',payer:match?.[1],memo,ref,amount,verified:!!(verified&&ref&&amount>0&&Number.isFinite(amount)&&bodyAmount&&Number(bodyAmount[1].replaceAll(',',''))===amount)};
  }
  const authDomain = auth.match(/\bdmarc=pass\b[^;]*\bheader\.from=([\w.-]+)/i)?.[1]?.toLowerCase();
  const provider = ['noreply@formspree.io','submissions@formsubmit.co','noreply@formsubmit.co'].includes(sender) && authDomain===sender.split('@')[1];
  const version = fields['registration version'] || fields['intake version'] || '';
  const child = fields['player name'] || fields['child name'];
  const reference = fields['player reference'] || fields['registration reference'] || fields['client reference'];
  const isForm = provider && /star\s?soccer|starsoccer\.ca/i.test(subject+' '+flat.slice(0,500));
  const known = /^SS-(?:WEEKLY-V2|PASS-V1|CAMP-V2|CAMP-DROPIN-V1|DAY-CAMP-V1)$/.test(version);
  const registration = has('Registrations') || (isForm && (/registration|camp request/i.test(subject) || known));
  if (sender===ownerEmail || ((!registration&&!has('Leads')&&!isForm) && (header('list-unsubscribe') || /^(?:auto-generated|auto-replied)/i.test(header('auto-submitted')) || !/\b(soccer|private (?:coaching|lesson|training)|camp|register|registration|soccer lessons?)\b/i.test(subject+' '+flat.slice(0,300)) || /no-?reply|notifications?@/i.test(sender||'')))) return null;
  if (!sender) return null;
  const contact = isForm ? emailOf(fields['parent email'] || fields['guardian email'] || fields.email || header('reply-to')) : sender;
  return {...meta,type:registration?'registration':'inquiry',form:isForm&&known,contact,guardian:fields['parent name']||fields['guardian name'],child,reference,
    version,age:fields['player age'],experience:fields.experience,option:fields['requested option']||fields['booking type']||fields.camp||fields.training,
    campId:fields['camp id'],campWeek:fields['camp week id'],campSlot:fields['camp slot'],campKeys:fields['camp session keys'],
    training:fields.training||fields.camp,dates:fields['covered dates']||fields['session date']||fields['expected start date'],referral:fields['referral source'],
    excerpt:limit(fields.message || fields['your message'] || (isForm?'':flat)).slice(0,360)};
}
