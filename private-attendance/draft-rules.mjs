import {createHash} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {renderConfirmation} from './confirmation-drafts.mjs';

export const draftFields={
 bookings:['Booking reference','Source booking ID','Booking status','Owner approved confirmation','Player','Family','Charge review','Charge CAD','Verified applied CAD','Start date','Covered dates','Booking type','First session'],
 payments:['Payment reference','Family','Amount CAD','Training portion CAD','Method','Direction','Verification','Payment date'],
 allocations:['Payment','Booking','Applied CAD','Amount CAD','Review status'],
 families:['Email','Secondary guardian email','Contact status','Newsletter status','Marketing consent','Preferred contact method'],
 players:['Player','Family'],registrations:['Child','Parent email','Reference','Status','Player','Booking','Family','Confirmation Gmail ID','Source Gmail ID','Camp session keys'],
 attendance:['Player','Booking','Coverage state','Session date','Session'],sessions:['Session','Date','Time','Venue','Session status','Weekly program','Source session ID'],
 enrollments:['Enrollment status','Billing schedule','Billing approval','Weekly program','Player','Family','Approved coverage expiry','Renewal guidance','Effective from','Effective until','Prepaid covered from','Prepaid covered until','Weekly attendance email preference'],
 programs:['Program'],suppression:['Email','Status'],templates:['Template','HTML','Version'],
 draftLog:['Email key','Email kind','Status','Source record','Gmail draft ID','Gmail thread ID','Sent Gmail ID','Review detail','Recipient']
};
const ids={Confirmation:'tblVsKHnBZMlxYavr',Receipt:'tblF3FEKz8Bza5CEJ',Renewal:'tblhC5PNazPhXy7jG'};
export const localDay=ms=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(ms));
export const coverageDay=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}(?:T00:00:00(?:\.000)?Z)?$/.test(value)?value.slice(0,10):'';
const dayPattern=/^\d{4}-\d{2}-\d{2}$/;
const single=a=>a?.length===1?a[0]:null;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cleanEmail=s=>typeof s==='string'&&/^[\w.%+'-]+@[\w.-]+\.[a-z]{2,}$/i.test(s)?s.toLowerCase():'';
const cents=n=>Number.isFinite(n)?Math.round(100*n):null;
const money=n=>'CAD $'+(n/100).toFixed(2);
const fail=msg=>{throw new Error(msg)};
export function marker(key){return 'SSMAIL-'+createHash('sha256').update(key).digest('hex').slice(0,22);}
const pick=(rows,id)=>rows.find(row=>row.id===id)?.fields;
export const accepted=b=>b['Booking status']==='Accepted'&&(!/^gmail-(camp|weekly):/.test(b['Source booking ID']||'')||b['Owner approved confirmation']===true);
export const verified=p=>p.Verification==='Verified'&&p.Direction==='Incoming'&&['Cash','E-transfer'].includes(p.Method);
function guardian(d,fid,email){
 const f=pick(d.families,fid);if(!f)fail('Link one family to the source record.');
 const primary=cleanEmail(f.Email),secondary=cleanEmail(f['Secondary guardian email']);
 const to=email?cleanEmail(email):(primary||secondary);
 if(!to||![primary,secondary].includes(to))fail('Verify the guardian email against the linked family.');
 if(/do not contact|blocked/i.test(f['Contact status']||''))fail('Review the family contact restriction.');
 return to;
}
function player(d,pid,fid){const p=pick(d.players,pid);if(!p?.Player||single(p.Family)!==fid)fail('Verify the player and their family link.');return p.Player;}
function base(kind,id,expiry=''){return {kind,id,key:[kind,id,expiry].filter(Boolean).join(':'),source:'https://airtable.com/appnaG94HQpEaRios/'+ids[kind]+'/'+id};}
function item(kind,row,build,expiry){
 const b=base(kind,row.id,expiry);
 try{return {...b,...build(b)};}catch(e){return {...b,review:e.message};}
}
function content(key,to,title,html){
 const token=marker(key),subject=title+' | '+token;
 return {to,subject,html:html+'<p style="font-size:11px;color:#677684">Email reference: '+token+'</p>'};
}
function allocation(d,row,pid,fid){
 const a=row.fields,b=pick(d.bookings,single(a.Booking)),p=pick(d.payments,single(a.Payment));
 if(!b||!p||!verified(p)||single(a.Payment)!==pid||single(p.Family)!==fid||single(b.Family)!==fid||
    a['Review status']!=='Verified allocation'||!(cents(a['Applied CAD'])>0)||cents(a['Amount CAD'])!==cents(a['Applied CAD']))return null;
 return {b,amount:cents(a['Applied CAD'])};
}
export function confirmation(d,row,today){
 return item('Confirmation',row,({key})=>{
  const b=row.fields,bid=row.id,fid=single(b.Family),pid=single(b.Player);
  const regs=d.registrations.filter(r=>r.fields.Booking?.includes(bid)&&r.fields.Status!=='Declined');
  if(regs.length>1)fail('Resolve competing registrations on this booking.');
  const reg=regs[0],r=reg?.fields;

  if(!accepted(b))return {obsolete:'Booking is no longer owner-accepted.'};
  const name=player(d,pid,fid),to=guardian(d,fid,r?.['Parent email']);
  if(r?.['Confirmation Gmail ID'])return {existingSent:r['Confirmation Gmail ID'],registration:reg.id,to};
  if(r&&(single(r.Booking)!==bid||single(r.Player)!==pid||single(r.Family)!==fid))fail('Check the booking against the registration links.');
  const slots=d.attendance.filter(a=>a.fields.Booking?.includes(bid)&&a.fields['Coverage state']==='Active').map(({fields:a})=>{
   const s=pick(d.sessions,single(a.Session));
   if(single(a.Booking)!==bid||single(a.Player)!==pid||!s||!['Confirmed','Planned'].includes(s['Session status'])||!s.Session||!s.Time||!s.Venue||a['Session date']!==s.Date)fail('Confirm the player, program, date, time and location for every booked session.');
   return s;
  }).sort((a,b)=>a.Date.localeCompare(b.Date)||a.Time.localeCompare(b.Time));
  const dates=new Set((b['Covered dates']||b['Start date']||'').match(/\d{4}-\d{2}-\d{2}/g)||[]);
  const keys=(r?.['Camp session keys']||'').split(';').map(x=>x.trim()).filter(Boolean);
  if(!slots.length||!dates.size||slots[0].Date!==b['Start date']||slots[0].Date<today||slots.some(s=>!dates.has(s.Date))||[...dates].some(date=>!slots.some(s=>s.Date===date))||keys.length&&(keys.length!==slots.length||keys.some(k=>!slots.some(s=>s['Source session ID']===k))))fail('Verify the complete future booking schedule.');
  const fee=cents(b['Charge CAD']),applied=cents(b['Verified applied CAD']);
  const allocations=d.allocations.filter(a=>a.fields.Booking?.includes(bid));
  const pieces=allocations.map(a=>allocation(d,a,single(a.fields.Payment),fid));
  if(b['Charge review']!=='Agreed'||fee===null||fee<0||applied===null||applied>fee||pieces.some(x=>!x)||pieces.reduce((n,x)=>n+x.amount,0)!==applied)fail('Verify the agreed charge and payment allocations.');
  const balance=fee-applied;
  const pay=!fee?'There is no fee for this booking.':!balance?'Thank you. Your payment of '+money(applied)+' covers this booking in full.':
   (applied?'We have applied '+money(applied)+'. Your remaining balance is ':'The booking fee is ')+money(balance)+'. Please e-transfer to starsoccervancouver@gmail.com with the player name, or arrange cash payment with your coach.';
  const masters=d.templates.filter(t=>t.fields.Template==='Camp Email Master'&&/^REVIEW05\b/.test(t.fields.Version));
  if(masters.length!==1)fail('Check the approved Review 05 template.');
  const ref=r?.Reference||b['Booking reference'];if(!ref)fail('Add a booking reference.');
  const templateReg={Child:name,Reference:ref,'Parent email':to,'Registration kind':/camp/i.test(slots[0].Session)?'CAMP':'Training'};
  const raw=renderConfirmation(masters[0].fields.HTML,templateReg,slots,pay);
  const html=Buffer.from(Buffer.from(raw,'base64url').toString().split('\r\n\r\n')[1],'base64').toString();
  return {...content(key,to,'Star Soccer registration confirmed | '+ref,html),registration:reg?.id,
    lookup:ref,legacySource:r?.['Source Gmail ID'],child:name,acceptedDate:b['Start date']};
 });
}
export function receipt(d,row,today){
 return item('Receipt',row,({key})=>{
  const p=row.fields;if(!verified(p))return {obsolete:'Payment is no longer verified as incoming cash or Interac.'};
  const fid=single(p.Family),to=guardian(d,fid),date=p['Payment date'],amount=cents(p['Amount CAD']);
  if(!dayPattern.test(date)||date>today||!(amount>0))fail('Confirm the actual payment date and positive CAD amount.');
  const entries=d.allocations.filter(a=>a.fields.Payment?.includes(row.id)).map(a=>allocation(d,a,row.id,fid));
  const target=cents(p['Training portion CAD']??p['Amount CAD']);
  const complete=entries.length&&target>0&&target<=amount&&entries.every(x=>x)&&entries.reduce((n,x)=>n+x.amount,0)===target;
  const lines=[];
  if(complete)for(const {b,amount:part} of entries){
   const name=pick(d.players,single(b.Player));if(!name?.Player||single(name.Family)!==fid||!b['Booking reference']){lines.length=0;break;}
   lines.push(esc(name.Player)+' · '+esc(b['Covered dates']||b['Start date']||b['Booking reference'])+' · '+money(part));
  }
  const method=p.Method==='Cash'?'cash':'Interac e-transfer';
  const html='<p>Thank you. Star Soccer received '+money(amount)+' by '+method+' on '+date+'.</p>'+
    (lines.length?'<ul>'+lines.map(l=>'<li>'+l+'</li>').join('')+'</ul>':'')+'<p>Star Soccer Vancouver</p>';
  return {...content(key,to,'Star Soccer payment receipt | '+date,html),lookup:p['Payment reference'],paymentDate:date,paymentAmount:(amount/100).toFixed(2),detail:lines.length?'':'Amount-only receipt. Review the booking allocation.'};
 });
}
export function renewal(d,row,expiry,today){
 return item('Renewal',row,({key})=>{
  const e=row.fields,fid=single(e.Family),pid=single(e.Player),prog=single(e['Weekly program']);
  if(e['Enrollment status']!=='Active'||coverageDay(e['Approved coverage expiry'])!==expiry||expiry<today)return {obsolete:'Coverage changed or the enrollment is no longer eligible.'};
  if(!dayPattern.test(expiry)||e['Billing approval']!=='Approved')fail('Confirm the approved pass expiry and billing approval.');
  const name=player(d,pid,fid),p=pick(d.programs,prog)?.Program,to=guardian(d,fid),family=pick(d.families,fid);
  if(!p)fail('Link the weekly program for this pass.');
  if(e['Billing schedule']==='Per session'||e['Renewal guidance']==='Pay per session')return {obsolete:'Pay-per-session enrollment.'};
  if(e['Weekly attendance email preference']==='Opted out'||/unsubscrib|opted out|do not contact/i.test([family['Newsletter status'],family['Marketing consent'],family['Contact status']].join(' '))||
   /phone only|text only/i.test(family['Preferred contact method']||'')||d.suppression.some(s=>cleanEmail(s.fields.Email)===to&&!/^(removed|resubscribed|inactive)$/i.test(s.fields.Status||'')))return {obsolete:'Family email preference excludes renewal mail.'};
  if(coverageDay(e['Prepaid covered until'])>expiry)return {obsolete:'The pass already has later prepaid coverage.'};
  const other=d.enrollments.filter(x=>x.id!==row.id&&single(x.fields.Player)===pid&&single(x.fields['Weekly program'])===prog&&!/cancel|inactive|ended/i.test(x.fields['Enrollment status']||''));
  if(other.some(({fields:f})=>f['Billing approval']==='Approved'&&[f['Prepaid covered until'],f['Approved coverage expiry'],f['Effective from']].some(v=>coverageDay(v)>expiry)))return {obsolete:'A replacement enrollment already covers this player.'};
  if(other.length)fail('Check overlapping enrollments before reminding this family.');
  const later=d.bookings.filter(({fields:b})=>single(b.Player)===pid&&b['Booking status']==='Accepted'&&/pass|four consecutive/i.test(b['Booking type']||'')&&(b['Start date']>expiry||(b['Covered dates']||'').match(/\d{4}-\d{2}-\d{2}/g)?.some(date=>date>expiry)));
  for(const b of later){const sessions=d.attendance.filter(a=>single(a.fields.Booking)===b.id&&a.fields['Coverage state']==='Active').map(a=>pick(d.sessions,single(a.fields.Session)));
    if(!sessions.length||sessions.some(s=>!single(s?.['Weekly program'])))fail('Verify the program on a possible replacement pass.');
    if(sessions.some(s=>single(s['Weekly program'])===prog))return {obsolete:'A replacement pass is already booked.'};}
  const guidance=e['Renewal guidance'];if(!guidance||/unknown|review|pending/i.test(guidance))fail('Confirm renewal instructions for this pass.');
  return {...content(key,to,'Star Soccer pass renewal | '+name+' | '+expiry,'<p>'+esc(name)+'’s '+esc(p)+' pass covers sessions through '+expiry+'.</p><p>To renew, reply to this email with the dates you would like to book. '+'We’ll confirm availability and your new pass dates.</p><p>Star Soccer Vancouver</p>'),child:name,expiry};
 },expiry);
}
