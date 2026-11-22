import {Buffer} from 'node:buffer';

const single = a => a?.length === 1 ? a[0] : null;
const vancouver = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'});
const escape = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const bookingKey = id => 'confirmation:booking:'+id;
const mailId = id => /^[a-f0-9]{10,32}$/i.test(id||'');
const safeEmail = value => /^[\w.%+'-]+@[\w.-]+\.[a-z]{2,}$/i.test(value||'');
const registrations = ['Received at','Reference','Parent email','Child','Family','Player','Booking','Source Gmail ID','Confirmation Gmail ID','Status','Registration kind','Next session date','Camp session keys','Pass dates'];

export function confirmationCandidate(r,b,today) {
  return b && !r['Confirmation Gmail ID'] && ['Confirmed','Expected'].includes(r.Status) &&
    b['Booking status']==='Accepted' && b['Start date']>=today && single(r.Family) && single(r.Family)===single(b.Family) &&
    single(r.Player) && single(r.Player)===single(b.Player) && r.Child && safeEmail(r['Parent email']) &&
    /^SS-[A-Z0-9-]{4,100}$/.test(r.Reference||'') && mailId(r['Source Gmail ID']);
}

export function renderConfirmation(template,r,slots,paymentText='') {
  if (!slots.length || slots.some(s=>!s.Date||!s.Time||!s.Venue||!s.Session)) throw Error('Check the dated sessions, venue and times.');
  const title=r['Registration kind']?.includes('CAMP')?'Star Soccer camp':'Star Soccer training';
  const schedule=slots.map(s=>[s.Session,s.Date,s.Time,s.Venue].map(escape).join(' · ')).join('<br>');
  // Keep the approved layout and replace only the variable paragraphs.
  const start=template.indexOf('Thanks for registering!'),end=template.indexOf('</p>',start);
  const price=template.indexOf('The fee is {{PRICE_PER_PLAYER}}'),priceEnd=template.indexOf('</p>',price);
  if(start<0||end<0||price<end||priceEnd<price)throw Error('Review the saved Review 05 template.');
  let html=template.slice(0,start)+'Thanks for registering! '+escape(r.Child)+' is confirmed for '+escape(title)+'.<br>'+schedule+
    template.slice(end,price)+'Booking reference: '+escape(r.Reference)+'.'+(paymentText?'<br>'+escape(paymentText):'')+template.slice(priceEnd);
  html=html.replace('PRO-D CAMPS',title.includes('camp')?'CAMPS':'TRAINING').replaceAll('{{CAMP_TITLE}}',title)
    .replaceAll('{{PLAYER_NAMES}}',escape(r.Child)).replaceAll(' {{SESSION_DAY_REFERENCE}}','');
  if (/{{|}}/.test(html)) throw Error('Review the unfilled template fields.');
  const subject=(title.includes('camp')?'Star Soccer camp':'Star Soccer')+' registration confirmed'+' | '+r.Reference;
  return Buffer.from(['To: '+r['Parent email'],'Subject: '+subject,'MIME-Version: 1.0','Content-Type: text/html; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(html).toString('base64').match(/.{1,76}/g).join('\r\n')].join('\r\n')).toString('base64url');
}

export async function checkConfirmationDrafts({db,storage,search,read,create,now}) {
  const today=vancouver.format(new Date(now)), all=await db.list('registrations',registrations);
  const pending=all.filter(({fields:r})=>!r['Confirmation Gmail ID']&&single(r.Booking)&&['Confirmed','Expected'].includes(r.Status));
  if(!pending.length)return;
  const bookings=await db.list('bookings',['Player','Family','Booking status','Start date','First session','Attendance','Covered dates','Booking reference']);
  const active=pending.filter(({fields:r})=>confirmationCandidate(r,bookings.find(b=>b.id===single(r.Booking))?.fields,today));
  if(!active.length)return;
  const intake=await db.list('intake',['Message ID','Gmail draft ID','Reply workflow','Review']);
  const sessions=await db.list('sessions',['Session','Source session ID','Date','Time','Venue','Session status']);
  const roster=await db.list('attendance',['Session','Session date','Player','Booking','Coverage state']);
  const templates=await db.list('templates',['Template','HTML','Version']);
  for(const {id,fields:r} of active){
    const bid=single(r.Booking),key=bookingKey(bid),prior=await storage.get(key);
    if(prior?.status==='draft'||prior?.status==='existing')continue;
    const review=reason=>storage.put(key,{status:'review',id,reason});
    if(prior?.status==='creating')continue;
    if(all.filter(row=>row.fields.Status!=='Declined'&&row.fields.Booking?.includes(bid)).length!==1){await review('Resolve competing registrations for this booking.');continue;}
    const source=await read(r['Source Gmail ID']);
    const linked=intake.filter(x=>x.fields['Message ID']===r['Source Gmail ID']);
    if(linked.some(x=>x.fields['Gmail draft ID']||['Ignore','Duplicate'].includes(x.fields.Review)||['Sent - confirmed','No reply needed'].includes(x.fields['Reply workflow']))){await review('Review the existing intake decision or linked draft before preparing mail.');continue;}
    if(source?.id!==r['Source Gmail ID']||source.reference!==r.Reference||source.contact?.toLowerCase()!==r['Parent email'].toLowerCase()||source.labelIds?.some(l=>['SPAM','TRASH','DRAFT','SENT'].includes(l))){await review('Check the original registration in Gmail.');continue;}
    const book=bookings.find(b=>b.id===bid).fields, rows=roster.filter(a=>a.fields.Booking?.includes(bid)&&a.fields['Coverage state']!=='Void');
    const slots=rows.map(a=>sessions.find(s=>s.id===single(a.fields.Session))?.fields);
    const dates=new Set((book['Covered dates']||book['Start date']).match(/\d{4}-\d{2}-\d{2}/g)||[]);
    const requested=(r['Camp session keys']||'').split(';').map(k=>k.trim()).filter(Boolean);
    if(!slots.length||slots.some((s,i)=>!s||!['Planned','Confirmed'].includes(s['Session status'])||single(rows[i].fields.Player)!==single(r.Player)||single(rows[i].fields.Booking)!==bid||rows[i].fields['Session date']!==s.Date)||new Set(rows.map(a=>single(a.fields.Session))).size!==slots.length||
       [...dates].some(d=>!slots.some(s=>s.Date===d))||slots.some(s=>!dates.has(s.Date))||
       (requested.length&&(requested.length!==slots.length||requested.some(k=>!slots.some(s=>s['Source session ID']===k))))){
      await review('Match the player and every requested date to a dated session.');continue;
    }
    const exact=await search('in:anywhere {in:drafts in:sent} to:'+r['Parent email']+' "'+r.Reference+'"');
    if(exact.length){await review('Check the existing Gmail correspondence before preparing a confirmation.');continue;}
    const since=(r['Received at']||'').slice(0,10).replaceAll('-','/');
    const other=await search('{in:drafts in:sent} to:'+r['Parent email']+(since?' after:'+since:'')+' {subject:confirm subject:registration} "'+r.Child.replace(/[^\p{L}\p{N} -]/gu,' ')+'"');
    if(other.length){await review('Check earlier confirmation mail for this family before drafting.');continue;}
    const master=templates.filter(t=>t.fields.Template==='Camp Email Master'&&/^REVIEW05\b/.test(t.fields.Version));
    if(master.length!==1){await review('Select the approved Review 05 master.');continue;}
    let raw;try{raw=renderConfirmation(master[0].fields.HTML,r,slots.sort((a,b)=>a.Date.localeCompare(b.Date)||a.Time.localeCompare(b.Time)));}catch(e){await review(e.message);continue;}
    // Gmail cannot upsert drafts. Persist intent before POST, including on timeouts.
    const acquired=await storage.transaction(async tx=>{const seen=await tx.get(key);if(seen&&seen.status!=='review')return false;await tx.put(key,{status:'creating',id,reason:'Check Drafts before retrying this confirmation.'});return true;});
    if(!acquired)continue;
    const draft=await create(raw);
    if(!draft?.id)throw Error('Draft creation needs review.');
    await storage.put(key,{status:'draft',id,draftId:draft.id});
  }
}
