// Pure projection. Inputs are a complete read-only snapshot. No IO, timers or write operations.
const HOUR = 3600000;
const ownAddresses = new Set(['romeo@starsoccer.ca','starsoccervancouver@gmail.com']);
const ids = value => (value || []).map(v => typeof v === 'string' ? v : v.id);
const status = value => value?.name || value || '';
const clean = s => String(s || '').trim().toLowerCase();
const words = s => clean(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
const addresses = value => (String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig)||[]).map(clean);
const header = (m,k) => m?.payload?.headers?.find(h=>clean(h.name)===k)?.value || '';
const tags = m => m.label_ids || m.labelIds || [];
const time = m => Number(m.internal_date || m.internalDate);
const has = (row,key,id) => ids(row[key]).includes(id);
const single = (row,key) => ids(row[key]).length===1 ? ids(row[key])[0] : null;
const open = m => !tags(m).some(t=>['DRAFT','SPAM','CHAT'].includes(t));
const thread = m => m?.thread_id || m?.threadId;
const index = rows => new Map(rows.map(r=>[r.id,r]));
const tokens = s => String(s||'').toUpperCase().match(/[A-Z0-9_-]+/g)||[];
function currentText(m){
  // Connected Gmail supplies decoded content. The job adapter must decode Gmail API MIME first.
  const parts=p=>p?[p,...(p.parts||[]).flatMap(parts)]:[];
  const body=type=>parts(m.payload).filter(p=>(p.mime_type||p.mimeType)===type&&!p.filename).map(p=>p.body?.content||'').join('\n');
  const text=body('text/plain')||body('text/html').split(/<blockquote\b|<div[^>]*class=["'][^"']*gmail_quote/i)[0].replace(/<br\s*\/?\s*>|<\/p>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ');
  return text.split(/(?:^|\n)(?:On [^\n]{0,350}wrote:|From: |--+ ?Original Message|>)/i)[0];
}
function mentions(text,refs){
  const keys=new Set(tokens(text));return refs.some(s=>s&&keys.has(s.toUpperCase()));
}
function transfer(m) {
  const trusted=(m.payload?.headers||[]).find(h=>clean(h.name)==='authentication-results'&&/^mx\.google\.com\s*;/i.test(h.value))?.value||'';
  if(!open(m)||tags(m).includes('SENT')||addresses(header(m,'from'))[0]!=='notify@payments.interac.ca'||!/\bdmarc=pass\b[^;]*\bheader\.from=payments\.interac\.ca\b/i.test(trusted))return null;
  const text=currentText(m).replace(/\s+/g,' '),subject=header(m,'subject');
  const invitation=/^(?:Reminder:\s*)?Interac e-Transfer:\s*(.+?) sent you \$([\d,]+(?:\.\d{2})?)/i.exec(subject);
  if(!invitation&&!/reminder.*(?:deposit|transfer)|(?:transfer|payment).*reminder/i.test(subject))return null;
  const memo=text.match(/Message:\s*(.*?)\s*Transfer Details/i)?.[1]||'';
  const ref=text.match(/Reference Number:\s*([a-z0-9]{6,24})\b/i)?.[1]?.toUpperCase();
  return {id:m.id,at:time(m),ref,payer:words(invitation?.[1]),amount:invitation?Number(invitation[2].replaceAll(',','')):undefined,memo};
}
// B.C. kept UTC-7 on March 8, 2026. Older ICU builds still switch in November.
const zone = ms => ms>=Date.UTC(2026,2,8,10)?'Etc/GMT+7':'America/Vancouver';
const vancouver = ms => new Intl.DateTimeFormat('en-CA',{timeZone:zone(ms),dateStyle:'medium',timeStyle:'short'}).format(new Date(ms));
export function followup(snapshot, asOf) {
  if(snapshot.complete!==true || !Number.isFinite(asOf))throw Error('Incomplete snapshot: withhold results and retry.');
  const {registrations,bookings,players,families,attendance,payments,allocations,intake,messages,baseId,bookingTableId}=snapshot;
  const mail=[...index(messages).values()].filter(m=>time(m)<=asOf);
  const byMail=index(mail), byFamily=index(families), byPlayer=index(players), byBooking=index(bookings);
  const notices=mail.map(transfer).filter(Boolean), cases=new Map(), diagnostics=[];
  for(const r of registrations){
    if(['Declined','Cancelled'].includes(status(r.Status))){diagnostics.push('closed registration');continue;}
    const bid=single(r,'Booking'), pid=single(r,'Player'),fid=single(r,'Family'), b=byBooking.get(bid);
    if(!bid||!pid||!fid||!byPlayer.has(pid)||!byFamily.has(fid)||!b||single(b,'Player')!==pid||single(b,'Family')!==fid||single(byPlayer.get(pid),'Family')!==fid){diagnostics.push('unresolved booking identity');continue;}
    if(['Cancelled','Completed','Declined'].includes(status(b['Booking status']))){diagnostics.push('closed booking');continue;}
    if(!cases.has(bid))cases.set(bid,{b,pid,fid,regs:[]});
    cases.get(bid).regs.push(r);
  }
  const incoming=payments.filter(p=>status(p.Direction)==='Incoming'&&p['Amount CAD']>0);
  const claims=incoming.filter(p=>status(p.Verification)==='Verified');
  const destinations=p=>new Set([...ids(p.Booking),...allocations.filter(a=>single(a,'Payment')===p.id&&status(a['Review status'])==='Verified allocation'&&a['Applied CAD']>0).flatMap(a=>ids(a.Booking))]);
  const threadOwners=new Map();
  for(const [bid,c] of cases)for(const r of c.regs){
    const threads=[r['Source Gmail ID'],r['Confirmation Gmail ID'],r['Last reply Gmail ID']].map(id=>thread(byMail.get(id))).concat(intake.filter(e=>e['Message ID']===r['Source Gmail ID']||r.Reference&&e['Web client reference']===r.Reference).map(e=>e['Gmail thread ID']));
    for(const t of threads.filter(Boolean)){
      if(!threadOwners.has(t))threadOwners.set(t,new Set());
      threadOwners.get(t).add(bid);
    }
  }
  const results=[];
  for(const [bid,{b,pid,fid,regs}] of cases){
    const f=byFamily.get(fid), refs=[bid,b['Source booking ID'],b['Booking reference'],...regs.map(r=>r.Reference)].filter(Boolean);
    const contacts=new Set([f.Email,f['Secondary guardian email'],...regs.map(r=>r['Parent email'])].filter(Boolean).map(clean));
    const storedIds=regs.map(r=>r['Confirmation Gmail ID']).filter(Boolean);
    const sent=mail.filter(m=>{
      if(!open(m)||!tags(m).includes('SENT')||!ownAddresses.has(addresses(header(m,'from'))[0])||!addresses(header(m,'to')).some(a=>contacts.has(a)))return false;
      const subject=header(m,'subject'),authored=currentText(m);
      const confirmationSubject=!/^\s*(re|fw|fwd):/i.test(subject)&&/registration confirmed|registration confirmation|pass confirmed|camp confirmation/i.test(subject);
      const confirmationBody=/\b(?:registration confirmed|(?:happy|pleased) to confirm|we[’']re confirming|(?:is|are) confirmed (?:for|in)|go ahead with the single drop-in)\b/i.test(authored);
      if(!confirmationSubject&&!confirmationBody)return false;
      return storedIds.includes(m.id)||mentions(subject+' '+authored,refs);
    }).sort((a,b)=>time(a)-time(b));
    const result={bookingId:bid,bookingUrl:'https://airtable.com/'+baseId+'/'+bookingTableId+'/'+bid};
    results.push(result);
    if(!sent.length){result.outcome='no verified sent confirmation';continue;}
    const first=sent[0],start=time(first);
    Object.assign(result,{sentId:first.id,sentAt:new Date(start).toISOString(),vancouver:vancouver(start)});
    const priorDay=new Intl.DateTimeFormat('en-CA',{timeZone:zone(start),year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(start));
    const priorAttendance=attendance.some(a=>has(a,'Player',pid)&&!has(a,'Booking',bid)&&status(a['Attendance status'])==='Present'&&status(a['Coverage state'])!=='Void'&&a['Session date']&&a['Session date']<priorDay);
    const priorBooking=bookings.some(x=>x.id!==bid&&single(x,'Player')===pid&&['Accepted','Completed'].includes(status(x['Booking status']))&&x['Start date']&&x['Start date']<priorDay&&x['Accepted date']&&x['Accepted date']<priorDay);
    const history=regs.map(r=>status(r['Player history at registration']));
    result.history=priorAttendance||priorBooking||history.includes('Returning')?'returning':history.includes('First-time verified')?'new':'unknown';
    const sourceIds=regs.map(r=>r['Source Gmail ID']).filter(Boolean);
    const threads=new Set([...sent.map(thread),...sourceIds.map(id=>thread(byMail.get(id))),...intake.filter(e=>sourceIds.includes(e['Message ID'])||regs.some(r=>r.Reference&&r.Reference===e['Web client reference'])).map(e=>e['Gmail thread ID'])].filter(Boolean));
    const rfc=new Set(sent.map(m=>header(m,'message-id').trim()).filter(Boolean));
    const lastReplies=regs.map(r=>r['Last reply Gmail ID']).filter(Boolean);
    const replies=mail.filter(m=>open(m)&&!tags(m).includes('SENT')&&time(m)>start&&contacts.has(addresses(header(m,'from'))[0])&&!/auto-(?:replied|generated)/i.test(header(m,'auto-submitted'))&&!header(m,'list-id'));
    let reply,unclearReply;
    for(const m of replies){
      const text=header(m,'subject')+' '+currentText(m);
      if(lastReplies.includes(m.id)||mentions(text,refs)){reply=m;break;}
      if(bookings.some(other=>other.id!==bid&&mentions(text,[other.id,other['Booking reference'],other['Source booking ID']].filter(Boolean))))continue;
      const refIds=header(m,'references').split(/\s+/).concat(header(m,'in-reply-to').trim());
      const referenced=sent.filter(c=>refIds.includes(header(c,'message-id'))&&rfc.has(header(c,'message-id')));
      if(!threads.has(thread(m))&&!referenced.length)continue;
      if([thread(m),...referenced.map(thread)].some(t=>(threadOwners.get(t)?.size||0)>1)){unclearReply=m;continue;}
      reply=m;break;
    }
    const paid=incoming.find(p=>destinations(p).has(bid));
    let exact,possible;
    const receiveDates=regs.map(r=>Date.parse(r['Received at'])||time(byMail.get(r['Source Gmail ID'])||{})).filter(Number.isFinite);
    const received=Math.min(start,...receiveDates);
    for(const n of notices){
      const linked=claims.filter(p=>[n.id,'GMAIL:'+n.id,n.ref&&'INTERAC-'+n.ref,n.ref].filter(Boolean).some(v=>tokens([p['Source payment ID'],p['Evidence reference'],p['Payment reference']].join(' ')).includes(v.toUpperCase())));
      const assigned=new Set(linked.flatMap(p=>[...destinations(p)]));
      const matches=bookings.filter(other=>mentions(n.memo,[other.id,other['Source booking ID'],other['Booking reference'],...registrations.filter(r=>single(r,'Booking')===other.id).map(r=>r.Reference)].filter(Boolean)));
      const matched=matches.some(x=>x.id===bid);
      if(assigned.has(bid)||matched&&matches.length===1&&(!assigned.size||assigned.has(bid))){exact=n;continue;}
      if(matched){possible=n;continue;}
      if(assigned.size||matches.length||n.at<received)continue;
      const guardian=words(f['Guardian name']),child=words(byPlayer.get(pid)?.Player);
      const memo=' '+words(n.memo)+' ';
      if((guardian&&n.payer===guardian)||(child&&memo.includes(' '+child+' '))||linked.some(p=>has(p,'Family',fid))||
         (n.amount>0&&n.amount===b['Agreed booked CAD']&&n.at<=start+7*24*HOUR))possible=n;
    }
    result.reply=reply?.id;result.unclearReply=unclearReply?.id;result.payment=paid?.id;result.transfer=exact?.id;result.possibleTransfer=possible?.id;
    if(result.history==='returning')result.outcome='skip returning';
    else if(result.history!=='new')result.outcome='unverified player history';
    else if(asOf<start+24*HOUR)result.outcome='under 24 hours';
    else if(reply||paid||exact)result.outcome=reply?'family replied':paid?'recorded payment':'matching transfer notice';
    else result.outcome=possible?'manual transfer review':unclearReply?'manual reply review':'follow up';
  }
  const items=results.filter(r=>['follow up','manual transfer review','manual reply review'].includes(r.outcome)).map(r=>({
    key:'new-player-followup:'+r.bookingId,label:r.outcome==='follow up'?'Follow up with family':r.outcome==='manual transfer review'?'Review possible e-transfer':'Review shared family reply',
    bookingUrl:r.bookingUrl,confirmationAt:r.vancouver,timeZone:'America/Vancouver',sentId:r.sentId
  }));
  return {results,items,diagnostics};
}
