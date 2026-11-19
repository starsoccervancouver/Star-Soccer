import {normalize} from './gmail-message.mjs';

const defaults = {families:'Families',players:'Players',bookings:'Bookings',payments:'Payments',allocations:'Payment Allocations',intake:'Email Intake',registrations:'Website Registrations'};
const quote = s => "'" + String(s).replaceAll('\\','\\\\').replaceAll("'","\\'") + "'";
const exact = (field,value) => '{'+field+'}='+quote(value);
const compact = fields => Object.fromEntries(Object.entries(fields).filter(([,v])=>v!==undefined && v!==null && v!==''));
const cents = value => Number.isFinite(value) ? Math.round(value*100) : null;
const words = (source,term) => !!term && (' '+normalize(source)+' ').includes(' '+normalize(term)+' ');
export function airtableClient(config, token, fetchFn=fetch) {
  async function request(url,options={}) {
    const res=await fetchFn(url,{...options,redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
    if(!res.ok) throw Error('AIRTABLE_'+res.status);
    return res.json();
  }
  const urlFor = name=>new URL('https://api.airtable.com/v0/'+config.baseId+'/'+encodeURIComponent(config.tables[name]||defaults[name]));
  return {
    async list(name,fields,filter) {
      const url=urlFor(name),rows=[],seen=new Set();
      fields.forEach(f=>url.searchParams.append('fields[]',f));
      if(filter)url.searchParams.set('filterByFormula',filter);
      do {
        const page=await request(url);
        if(!Array.isArray(page.records))throw Error('AIRTABLE_PAGE');
        rows.push(...page.records);
        if(!page.offset)return rows;
        if(seen.has(page.offset)||rows.length>10000)throw Error('AIRTABLE_PAGE_LIMIT');
        seen.add(page.offset);url.searchParams.set('offset',page.offset);
      }while(true);
    },
    async save(name,fields,{key,id}={}) {
      const data=await request(urlFor(name),{method:'PATCH',body:JSON.stringify({records:[{...(id?{id}:{}),fields:compact(fields)}],...(!id?{performUpsert:{fieldsToMergeOn:[key]}}:{})})});
      if(data.records?.length!==1)throw Error('AIRTABLE_WRITE_UNCERTAIN');
      return data.records[0];
    }
  };
}
export async function syncLedgerEvent(db,event) {
  if(!event)return;
  const e=event;
  const existingIntake=(await db.list('intake',['Review','Kind','Next action','Family'],exact('Message ID',e.id)))[0];
  async function intake(kind,review,next,extras={}) {
    const fields={'Message ID':e.id,Source:'Star Soccer Gmail',Sender:e.sender,Subject:e.subject,'Received date':e.received.slice(0,10),Kind:kind,Review:review,'Gmail thread ID':e.thread,'Original message link':'https://mail.google.com/mail/u/?authuser=starsoccervancouver%40gmail.com#all/'+e.id,'Next action':next,...extras};
    if(existingIntake){
      if(e.type!=='payment'||existingIntake.fields.Review==='Matched')return;
      // Keep historical instructions and annotations. Add the current finding once.
      const old=existingIntake.fields['Next action']||'';
      fields['Next action']=old.includes(next)?old:[old,next].filter(Boolean).join('\n');
      return db.save('intake',{'Next action':fields['Next action'],Review:review,...extras},{id:existingIntake.id});
    }
    return db.save('intake',fields,{key:'Message ID'});
  }
  if(e.type==='payment')return payment(db,e,intake,existingIntake);
  const families=e.contact?await db.list('families',['Email','Secondary guardian email','Guardian name'], 'OR('+exact('Email',e.contact)+','+exact('Secondary guardian email',e.contact)+')'):[];
  let family=families.length===1?families[0]:null;
  const summary={'Parent email':e.contact,'Parent name':e.guardian,'Player name':e.child,'Requested training':e.option,'Web client reference':e.reference,'Body excerpt':e.excerpt,...(family?{Family:[family.id]}:{})};
  if(e.type==='inquiry')return intake('Question','New','Review the parent inquiry.',summary);
  if(!e.form||!e.contact||!e.child||!/^SS-[A-Z0-9-]{4,100}$/i.test(e.reference||''))return intake('Registration candidate','Needs clarification','Review this registration message and match it to a child and program.',summary);
  const matches=await db.list('registrations',['Reference','Source Gmail ID','Parent email','Family','Child'], 'OR('+exact('Source Gmail ID',e.id)+','+exact('Reference',e.reference)+')');
  if(matches.length>1||matches.some(r=>(r.fields.Child&&normalize(r.fields.Child)!==normalize(e.child))||(r.fields['Parent email']&&r.fields['Parent email'].toLowerCase()!==e.contact)))return intake('Registration candidate','Needs clarification','Conflicting registration reference or identity. Review the existing entries.',summary);
  if(!matches.length){
    if(!family&&!families.length&&e.guardian){
      family=await db.save('families',{Family:e.guardian+' family',Email:e.contact,'Guardian name':e.guardian,'Contact status':'New'},{key:'Email'});
    }
    const players=family?await db.list('players',['Player','Family'],exact('Player',e.child)):[];
    const children=players.filter(p=>p.fields.Family?.length===1&&p.fields.Family[0]===family.id);
    await db.save('registrations',compact({Reference:e.reference,'Source Gmail ID':e.id,'Received at':e.received,'Parent email':e.contact,Child:e.child,
      Age:/^\d{1,2}$/.test(e.age||'')?Number(e.age):undefined,Experience:e.experience,'Requested option':e.option,Weekday:e.training,'Next session date':e.dates?.match(/\d{4}-\d{2}-\d{2}/)?.[0],
      'Registration kind':e.version,'Referral source':e.referral,Status:'Needs review',...(family?{Family:[family.id]}:{}),...(children.length===1?{Player:[children[0].id]}:{})}),{key:'Reference'});
  }
  return intake('Registration candidate',family?'Matched':'Needs clarification','Registration captured. Review placement and availability.',{...summary,...(family?{Family:[family.id]}:{})});
}

async function payment(db,e,intake,existingIntake) {
  const review = (reason,family) => intake('Payment claim','Needs clarification',reason,{'Candidate amount CAD':e.amount,...(family?{Family:[family.id]}:{})});
  if(!e.verified)return review('Deposited label present. Verify notification source, transfer reference and CAD amount.');
  const source='INTERAC-'+e.ref, amount=cents(e.amount);
  const holds=existingIntake?.fields;
  const receipts=await db.list('payments',['Family','Amount CAD','Payment reference','Verification','Source payment ID','Evidence reference','Allocation requested CAD','Verified signed CAD','Payment context','Payment Allocations']);
  const identified=receipts.filter(p=>[source,e.id,'gmail:'+e.id].includes(p.fields['Source payment ID'])||[e.id,e.ref].some(k=>(p.fields['Evidence reference']||'').includes(k)));
  if(identified.length>1 || identified.some(p=>cents(p.fields['Amount CAD'])!==amount))return review('Conflicting receipt evidence. Review the existing payment records.');
  let receipt=identified[0];
  if(receipt && receipt.fields.Verification==='Verified' && !(receipt.fields['Payment context']||'').startsWith('Cloud Gmail intake.')){
    return intake('Payment claim','Matched','Deposited label reconciled with the existing verified receipt. Existing allocations retained.');
  }
  const fams=await db.list('families',['Family','Guardian name','Players']);
  const players=await db.list('players',['Player','Family']);
  const namedChildren=players.filter(p=>words(e.memo,p.fields.Player));
  let candidates=fams.filter(f=>normalize(f.fields['Guardian name'])===normalize(e.payer));
  if(namedChildren.length)candidates=candidates.filter(f=>namedChildren.some(p=>p.fields.Family?.length===1&&p.fields.Family[0]===f.id));
  if(receipt?.fields.Family?.length===1)candidates=candidates.filter(f=>f.id===receipt.fields.Family[0]);
  if(holds?.Review==='Needs clarification' && !holds.Family?.length && !namedChildren.length)return review('Deposit confirmed by owner label. The existing family or booking match still needs review.');
  if(candidates.length!==1)return review('Deposit confirmed by owner label. Match payer and transfer memo to one family.');
  const family=candidates[0];
  if(!receipt && receipts.some(p=>p.fields.Family?.includes(family.id)&&cents(p.fields['Amount CAD'])===amount&&!/^INTERAC-/i.test(p.fields['Source payment ID']||'')))return review('Possible earlier receipt of the same amount. Reconcile it before adding another payment.',family);
  if(receipt && receipt.fields.Verification!=='Verified'){
    if(receipt.fields.Family?.length!==1||receipt.fields.Family[0]!==family.id||receipt.fields['Payment Allocations']?.length)return review('Existing receipt needs family and allocation review before verification.',family);
    receipt=await db.save('payments',{Verification:'Verified','Verified by':'Star Soccer owner via Gmail Deposited label',
      'Evidence reference':[receipt.fields['Evidence reference'],'Gmail '+e.id+'; Interac '+e.ref].filter(Boolean).join('\n')},{id:receipt.id});
  }
  if(!receipt)receipt=await db.save('payments',{'Payment reference':source,'Source payment ID':source,'Amount CAD':e.amount,Direction:'Incoming',Method:'E-transfer',Verification:'Verified',
    Family:[family.id],'Verified by':'Star Soccer owner via Gmail Deposited label','Evidence reference':'Gmail '+e.id+'; Interac '+e.ref,
    'Payment context':'Cloud Gmail intake. Sender: '+e.payer+'. Notice dated '+e.received.slice(0,10)+'. '+(e.memo||'')},{key:'Source payment ID'});
  const matched = () => intake('Payment claim','Matched','Verified receipt reconciled with its booking allocation.',{Family:[family.id],'Candidate amount CAD':e.amount});
  if(receipt.fields['Payment Allocations']?.length){
    const existing=await db.list('allocations',['Payment','Applied CAD','Review status']);
    const posted=existing.filter(a=>a.fields.Payment?.length===1&&a.fields.Payment[0]===receipt.id);
    if(posted.length&&posted.every(a=>a.fields['Review status']==='Verified allocation')&&posted.reduce((total,a)=>total+(cents(a.fields['Applied CAD'])||0),0)===amount)return matched();
    return review('Verified receipt has existing allocations. Review the applied amounts before making changes.',family);
  }
  const bookings=await db.list('bookings',['Booking reference','Family','Player','Booking status','Charge review','Balance CAD','Covered dates','Start date','Accepted date']);
  const registrations=await db.list('registrations',['Family','Reference','Booking']);
  const linked=new Set(registrations.filter(r=>r.fields.Family?.includes(family.id)&&words(e.memo,r.fields.Reference)).flatMap(r=>r.fields.Booking||[]));
  const own=bookings.filter(b=>b.fields.Family?.length===1&&b.fields.Family[0]===family.id);
  const explicit=own.filter(b=>linked.has(b.id)||words(e.memo,b.fields['Booking reference']));
  const outstanding=own.filter(b=>b.fields['Booking status']==='Accepted'&&(b.fields['Charge review']!=='Agreed'||cents(b.fields['Balance CAD'])===null||cents(b.fields['Balance CAD'])>0));
  const only=outstanding.length===1?outstanding[0]:null;
  const uniqueExact=!e.memo&&only&&only.fields['Accepted date']&&only.fields['Accepted date']<=e.received.slice(0,10)&&cents(only.fields['Balance CAD'])===amount;
  const b=explicit.length===1?explicit[0]:!explicit.length&&uniqueExact?only:null;
  if(!b)return review('Verified family receipt. Select the booking or sibling split to apply the payment.',family);
  const allocationId=source+'-'+b.id;
  const allocations=await db.list('allocations',['Payment','Booking','Amount CAD','Applied CAD','Allocation ID'],exact('Allocation ID',allocationId));
  if(allocations.length===1&&allocations[0].fields.Payment?.[0]===receipt.id&&allocations[0].fields.Booking?.[0]===b.id&&cents(allocations[0].fields['Applied CAD'])===amount)return matched();
  if(allocations.length||receipt.fields['Payment Allocations']?.length||b.fields['Booking status']!=='Accepted'||b.fields['Charge review']!=='Agreed'||cents(b.fields['Balance CAD'])<amount)return review('Verified receipt. Review the charge, balance and existing allocations.',family);
  const allocation=await db.save('allocations',{'Allocation ID':allocationId,Payment:[receipt.id],Booking:[b.id],'Amount CAD':e.amount,'Review status':'Verified allocation'},{key:'Allocation ID'});
  const check=await db.list('allocations',['Applied CAD'],exact('Allocation ID',allocationId));
  if(check.length!==1||check[0].id!==allocation.id||cents(check[0].fields['Applied CAD'])!==amount)return review('Allocation saved. Check the Airtable applied amount before treating the booking as settled.',family);
  return matched();
}
