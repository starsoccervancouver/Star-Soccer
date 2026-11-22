import {createHash} from 'node:crypto';
import {normalize} from './gmail-message.mjs';
import {campRequest, campVersions, placeCampRegistration,weeklyRequest} from './camp-placement.mjs';

const defaults = {families:'Families',players:'Players',bookings:'Bookings',payments:'Payments',allocations:'Payment Allocations',intake:'Email Intake',registrations:'Website Registrations',templates:'Email Templates',staff:'Staff',expenses:'Business Expenses',attribution:'Registration Attribution'};
const quote = s => "'" + String(s).replaceAll('\\','\\\\').replaceAll("'","\\'") + "'";
const exact = (field,value) => '{'+field+'}='+quote(value);
const compact = fields => Object.fromEntries(Object.entries(fields).filter(([,v])=>v!==undefined && v!==null && v!==''));
const cents = value => Number.isFinite(value) ? Math.round(value*100) : null;
const words = (source,term) => !!term && (' '+normalize(source)+' ').includes(' '+normalize(term)+' ');
const one = (links,id) => links?.length===1&&links[0]===id;
const depositedBy = 'Star Soccer owner via Gmail Deposited label';
const afterCutover = (received,since) => typeof since==='string'&&Date.parse(received)>=Date.parse(since);
const registrationFields=['Reference','Source Gmail ID','Received at','Parent email','Family','Child','Player','Booking','Status','Age','Registration kind','Camp session keys','Confirmation Gmail ID','Player history at registration'];
export function airtableClient(config, token, fetchFn=fetch) {
  async function request(url,options={}) {
    const res=await fetchFn(url,{...options,redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
    if(!res.ok) throw Error('AIRTABLE_'+res.status);
    return res.json();
  }
  const urlFor = name=>new URL('https://api.airtable.com/v0/'+config.baseId+'/'+encodeURIComponent(config.tables[name]||defaults[name]));
  async function saveMany(name, fields, {key, id} = {}) {
    const records = fields.map(fields => ({...(id ? {id} : {}), fields:compact(fields)}));
    const data = await request(urlFor(name), {method:'PATCH',body:JSON.stringify({
      records,...(!id?{performUpsert:{fieldsToMergeOn:[key]}}:{})
    })});
    if(data.records?.length!==records.length)throw Error('AIRTABLE_WRITE_UNCERTAIN');
    return data.records;
  }
  return {
    async listPage(name,fields,filter,offset){
      const url=urlFor(name);
      fields.forEach(f=>url.searchParams.append('fields[]',f));
      if(filter)url.searchParams.set('filterByFormula',filter);
      if(offset)url.searchParams.set('offset',offset);
      return request(url);
    },
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
    saveMany,
    async save(name,fields,{key,id}={}) {
      const [row] = await saveMany(name,[fields],{key,id});
      return row;
    }
  };
}
export async function syncLedgerEvent(db,event,{campPlacementSince,confirmedDraftFlow=false,trackConfirmation=false,now=new Date()}={}) {
  if(!event)return;
  const e=event;
  if(['camp-confirmation','registration-confirmation'].includes(e.type)){
    if(e.type==='camp-confirmation'&&afterCutover(e.received,campPlacementSince))await recordCampConfirmation(db,e,campPlacementSince,now);
    if(trackConfirmation&&!(e.type==='camp-confirmation'&&afterCutover(e.received,campPlacementSince))){
      const matches=await db.list('registrations',['Reference','Parent email','Received at','Player history at registration','Confirmation Gmail ID','Status'],exact('Reference',e.reference));
      const r=matches[0],f=r?.fields;
      if(matches.length===1&&f.Reference===e.reference&&f['Player history at registration']&&!f['Confirmation Gmail ID']&&f.Status!=='Declined'&&f['Parent email']?.trim().toLowerCase()===e.contact&&Date.parse(e.received)>=Date.parse(f['Received at'])){
        await db.save('registrations',{'Confirmation Gmail ID':e.id},{id:r.id});
      }
    }
    return;
  }
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
  if(e.type==='payment' && (['Ignore','Duplicate'].includes(existingIntake?.fields.Review)||existingIntake?.fields.Kind==='Payment claim'&&existingIntake.fields.Review==='Matched'))return;
  if(e.type==='payment'){
    // These migration holds predate live intake and require individual reconciliation.
    if(existingIntake?.fields.Review==='Needs clarification'&&/^Historical notice\. Verify settlement/im.test(existingIntake.fields['Next action']||''))return;
    return payment(db,e,intake,existingIntake);
  }
  const families=e.contact?await db.list('families',['Email','Secondary guardian email','Guardian name'], 'OR('+exact('Email',e.contact)+','+exact('Secondary guardian email',e.contact)+')'):[];
  let family=families.length===1?families[0]:null;
  const summary={'Parent email':e.contact,'Parent name':e.guardian,'Player name':e.child,'Requested training':e.option,'Web client reference':e.reference,'Body excerpt':e.excerpt,...(family?{Family:[family.id]}:{})};
  if(e.type==='inquiry')return intake('Question','New','Review the parent inquiry.',summary);
  if(!e.form||!e.contact||!e.child||!/^SS-[A-Z0-9-]{4,100}$/i.test(e.reference||''))return intake('Registration candidate','Needs clarification','Review this registration message and match it to a child and program.',summary);
  const matches=await db.list('registrations',registrationFields, 'OR('+exact('Source Gmail ID',e.id)+','+exact('Reference',e.reference)+')');
  if(matches.length>1||matches.some(r=>(r.fields.Child&&normalize(r.fields.Child)!==normalize(e.child))||(r.fields['Parent email']&&r.fields['Parent email'].toLowerCase()!==e.contact)))return intake('Registration candidate','Needs clarification','Conflicting registration reference or identity. Review the existing entries.',summary);
  let registration=matches[0], children=[];
  if(registration&&registration.fields['Source Gmail ID']===e.id&&e.playerHistory&&!registration.fields['Player history at registration'])await db.save('registrations',{'Player history at registration':e.playerHistory},{id:registration.id});
  const weekly=confirmedDraftFlow?weeklyRequest(e):null;
  const campFlow=afterCutover(e.received,campPlacementSince)&&(campVersions.includes(e.version)||!!weekly);
  const request=weekly||(campFlow?campRequest(e,new Date(e.received)):null);
  const awaitingPlacement=!registration||['Needs review','Processing'].includes(registration.fields.Status)&&!registration.fields.Booking?.length;
  if(!registration || campFlow&&awaitingPlacement){
    if(!family&&!families.length&&e.guardian){
      family=await db.save('families',{Family:e.guardian+' family',Email:e.contact,'Guardian name':e.guardian,'Contact status':'New'},{key:'Email'});
    }
    const players=family?await db.list('players',['Player','Family','Player status'],campFlow?undefined:exact('Player',e.child)):[];
    children=players.filter(p=>family&&p.fields.Family?.includes(family.id)&&normalize(p.fields.Player)===normalize(e.child));
    if(request&&family&&children.length===0&&!registration?.fields.Player?.length&&
       e.child.length<=100&&normalize(e.child).includes(' ')&&!/[\r\n]/.test(e.child)){
      const key=createHash('sha256').update(family.id+'\n'+normalize(e.child)).digest('hex');
      const player=await db.save('players',{Player:e.child,Family:[family.id],Age:Number(e.age),
        'Player status':'Active','Source player ID':'gmail-player:'+key},{key:'Source player ID'});
      children=[player];
    }
  }
  const player=children.length===1&&one(children[0].fields.Family,family?.id)?children[0]:null;
  if(!registration){
    registration=await db.save('registrations',compact({Reference:e.reference,'Source Gmail ID':e.id,'Received at':e.received,'Parent email':e.contact,Child:e.child,
      Age:/^\d{1,2}$/.test(e.age||'')?Number(e.age):undefined,Experience:e.experience,'Requested option':e.option,Weekday:e.training,'Next session date':e.dates?.match(/\d{4}-\d{2}-\d{2}/)?.[0],
      'Registration kind':e.version,'Player history at registration':e.playerHistory,'Referral source':e.referral,Status:'Needs review',...(family?{Family:[family.id]}:{}),...(player?{Player:[player.id]}:{}),...e.attribution}),{key:'Reference'});
  }
  if(campFlow&&awaitingPlacement&&registration.fields['Source Gmail ID']===e.id){
    if(!request||!player||player.fields['Player status']!=='Active'||
       registration.fields.Family?.length&&!one(registration.fields.Family,family?.id)||
       registration.fields.Player?.length&&!one(registration.fields.Player,player.id)){
      return intake('Registration candidate','Needs clarification','Review the player, family and camp request before confirming.',summary);
    }
    if(!confirmedDraftFlow&&!await hasVerifiedDeposit(db,player.id,family.id)){
      await db.save('registrations',{Status:'Processing',Family:[family.id],Player:[player.id],
        'Camp session keys':request.slots.map(slot=>slot.key).join('; '),
        'Processing notes':'Pending owner confirmation. Check availability, then send to the registration email with the subject Star Soccer camp registration confirmed | '+e.reference},{id:registration.id});
      return intake('Registration candidate','Matched','Player linked. Check capacity and send the first camp confirmation.',{...summary,Family:[family.id]});
    }
    const placement=await placeCampRegistration(db,{event:e,registration,family,player,now,weekly});
    return intake('Registration candidate',placement.placed?'Matched':'Needs clarification',placement.message,{...summary,...(family?{Family:[family.id]}:{})});
  }
  return intake('Registration candidate',family?'Matched':'Needs clarification','Registration captured. Review placement and availability.',{...summary,...(family?{Family:[family.id]}:{})});
}

async function hasVerifiedDeposit(db,playerId,familyId) {
  const bookings=await db.list('bookings',['Player','Family','Payment Allocations']);
  const ids=new Set(bookings.filter(({fields:f})=>one(f.Player,playerId)&&one(f.Family,familyId))
    .flatMap(({fields:f})=>f['Payment Allocations']||[]));
  if(!ids.size)return false;
  const allocations=await db.list('allocations',['Booking','Payment','Applied CAD','Review status']);
  const bookingIds=new Set(bookings.filter(({fields:f})=>one(f.Player,playerId)&&one(f.Family,familyId)).map(row=>row.id));
  const paymentIds=new Set(allocations.filter(({id,fields:f})=>ids.has(id)&&f.Booking?.length===1&&bookingIds.has(f.Booking[0])&&
    f.Payment?.length===1&&f['Review status']==='Verified allocation'&&cents(f['Applied CAD'])>0).map(({fields:f})=>f.Payment[0]));
  if(!paymentIds.size)return false;
  const payments=await db.list('payments',['Family','Direction','Method','Verification','Verified by','Source payment ID']);
  return payments.some(({id,fields:f})=>paymentIds.has(id)&&one(f.Family,familyId)&&f.Direction==='Incoming'&&f.Method==='E-transfer'&&
    f.Verification==='Verified'&&f['Verified by']===depositedBy&&/^INTERAC-/.test(f['Source payment ID']||''));
}

async function recordCampConfirmation(db,confirmation,since,now) {
  const records=await db.list('registrations',registrationFields,exact('Reference',confirmation.reference));
  const row=records[0], f=row?.fields;
  if(records.length!==1||!afterCutover(f['Received at'],since)||Date.parse(confirmation.received)<Date.parse(f['Received at'])||
     f['Parent email']?.toLowerCase()!==confirmation.contact||!campVersions.includes(f['Registration kind'])||
     f['Confirmation Gmail ID']||!['Processing','Expected'].includes(f.Status)||f.Family?.length!==1||f.Player?.length!==1)return;
  if(f.Status==='Expected'&&f.Booking?.length===1){
    await db.save('registrations',{Status:'Confirmed','Confirmation Gmail ID':confirmation.id,
      'Processing notes':'Owner confirmation recorded from Gmail. Payment is recorded separately.'},{id:row.id});
    return;
  }
  const keys=(f['Camp session keys']||'').split('; ').filter(Boolean);
  const dates=[...new Set(keys.map(key=>key.split(':')[1]).filter(Boolean))];
  const slots=new Set(keys.map(key=>key.split(':')[0].split('-').at(-1)));
  const event={id:f['Source Gmail ID'],reference:f.Reference,received:f['Received at'],version:f['Registration kind'],
    age:String(f.Age),campId:keys.length===1&&keys[0]==='SS-20261120-KITS-PROD'?'pro-d-2026-11-20':undefined,
    dates:f['Registration kind']==='SS-DAY-CAMP-V1'?'2026-11-20':dates.join(', '),campKeys:keys.join('; '),
    campWeek:keys[0]?.split('-')[1],campSlot:slots.size===2?'both':[...slots][0]};
  const players=await db.list('players',['Player','Player status','Family'],'RECORD_ID()='+quote(f.Player[0]));
  const player=players.find(({id,fields:p})=>id===f.Player[0]&&one(p.Family,f.Family[0])&&p['Player status']==='Active'&&normalize(p.Player)===normalize(f.Child));
  const result=await placeCampRegistration(db,{event,registration:row,family:{id:f.Family[0]},player,now,confirmationId:confirmation.id});
  if(!result.placed)await db.save('registrations',{'Processing notes':result.message},{id:row.id});
}

async function payment(db,e,intake,existingIntake) {
  const review = (reason,family) => intake('Payment claim','Needs clarification',reason,{'Candidate amount CAD':e.amount,...(family?{Family:[family.id]}:{})});
  if(!e.verified)return review('Deposited label present. Verify notification source, transfer reference and CAD amount.');
  const ref=e.ref.toUpperCase(),source='INTERAC-'+ref, amount=cents(e.amount);
  const holds=existingIntake?.fields;
  const receipts=await db.list('payments',['Family','Family reference','Amount CAD','Payment reference','Direction','Verification','Source payment ID','Evidence reference','Allocation requested CAD','Verified signed CAD','Payment context','Payment Allocations']);
  const sourceKeys=new Set([source,ref,e.id.toUpperCase(),'GMAIL:'+e.id.toUpperCase()]);
  const identified=receipts.filter(({fields:f})=>{
    const evidence=String(f['Evidence reference']||'').toUpperCase().match(/[A-Z0-9]+/g)||[];
    return [f['Source payment ID'],f['Payment reference']].some(k=>sourceKeys.has(String(k||'').trim().toUpperCase()))||evidence.includes(ref)||evidence.includes(e.id.toUpperCase());
  });
  if(identified.length>1 || identified.some(p=>cents(p.fields['Amount CAD'])!==amount||p.fields.Direction&&p.fields.Direction!=='Incoming'))return review('Conflicting receipt evidence. Review the existing payment records.');
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
    receipt=await db.save('payments',{Verification:'Verified','Verified by':depositedBy,
      'Evidence reference':[receipt.fields['Evidence reference'],'Gmail '+e.id+'; Interac '+e.ref].filter(Boolean).join('\n')},{id:receipt.id});
  }
  if(!receipt)receipt=await db.save('payments',{'Payment reference':source,'Source payment ID':source,'Amount CAD':e.amount,Direction:'Incoming',Method:'E-transfer',Verification:'Verified',
    Family:[family.id],'Verified by':depositedBy,'Evidence reference':'Gmail '+e.id+'; Interac '+e.ref,'Payment date':e.received.slice(0,10),
    'Payment context':'Cloud Gmail intake. Sender: '+e.payer+'. Notice dated '+e.received.slice(0,10)+'. '+(e.memo||'')},{key:'Source payment ID'});
  const matched = () => intake('Payment claim','Matched','Verified receipt reconciled with its booking allocation.',{Family:[family.id],'Candidate amount CAD':e.amount});
  const existing=await db.list('allocations',['Payment','Applied CAD','Review status']);
  const posted=existing.filter(a=>a.fields.Payment?.includes(receipt.id));
  if(receipt.fields['Payment Allocations']?.length||posted.length){
    if(posted.length&&posted.every(a=>a.fields.Payment.length===1&&a.fields['Review status']==='Verified allocation')&&posted.reduce((total,a)=>total+(cents(a.fields['Applied CAD'])||0),0)===amount)return matched();
    return review('Verified receipt has existing allocations. Review the applied amounts before making changes.',family);
  }
  const bookings=await db.list('bookings',['Booking reference','Family','Family reference','Payment Allocations','Player','Booking status','Charge review','Balance CAD','Covered dates','Start date','Accepted date']);
  const registrations=await db.list('registrations',['Family','Reference','Booking']);
  const linked=new Set(registrations.filter(r=>r.fields.Family?.includes(family.id)&&words(e.memo,r.fields.Reference)).flatMap(r=>r.fields.Booking||[]));
  const own=bookings.filter(b=>b.fields.Family?.length===1&&b.fields.Family[0]===family.id);
  const explicit=own.filter(b=>linked.has(b.id)||words(e.memo,b.fields['Booking reference']));
  const outstanding=own.filter(b=>b.fields['Booking status']==='Accepted'&&(b.fields['Charge review']!=='Agreed'||cents(b.fields['Balance CAD'])===null||cents(b.fields['Balance CAD'])>0));
  const named=namedChildren.length===1&&one(namedChildren[0].fields.Family,family.id)?namedChildren[0].id:null;
  const relevant=named?outstanding.filter(({fields})=>one(fields.Player,named)):outstanding;
  const only=relevant.length===1?relevant[0]:null;
  const uniqueExact=(!e.memo||named)&&only&&only.fields['Accepted date']&&only.fields['Accepted date']<=e.received.slice(0,10)&&cents(only.fields['Balance CAD'])===amount;
  const b=explicit.length===1?explicit[0]:!explicit.length&&uniqueExact?only:null;
  if(!b)return review('Verified family receipt. Select the booking or sibling split to apply the payment.',family);
  const allocationId=source+'-'+b.id;
  const allocations=await db.list('allocations',['Payment','Booking','Amount CAD','Applied CAD','Allocation ID'],exact('Allocation ID',allocationId));
  if(allocations.length===1&&allocations[0].fields.Payment?.[0]===receipt.id&&allocations[0].fields.Booking?.[0]===b.id&&cents(allocations[0].fields['Applied CAD'])===amount)return matched();
  if(allocations.length||receipt.fields['Payment Allocations']?.length||b.fields['Booking status']!=='Accepted'||b.fields['Charge review']!=='Agreed'||cents(b.fields['Balance CAD'])<amount)return review('Verified receipt. Review the charge, balance and existing allocations.',family);
  // The Applied CAD formula compares the text references as well as using the linked records.
  const paymentFamily=receipt.fields['Family reference'];
  const bookingFamily=b.fields['Family reference'];
  if(receipt.fields.Family?.length!==1||receipt.fields.Family[0]!==family.id||
     (bookingFamily&&paymentFamily&&bookingFamily!==paymentFamily)||
     (!bookingFamily&&b.fields['Payment Allocations']?.length)){
    return review('Review the family references on the receipt and booking before applying this payment.',family);
  }
  const reference=bookingFamily||paymentFamily||family.fields.Family||family.id;
  if(!bookingFamily)await db.save('bookings',{'Family reference':reference},{id:b.id});
  if(!paymentFamily)await db.save('payments',{'Family reference':reference},{id:receipt.id});
  const allocation=await db.save('allocations',{'Allocation ID':allocationId,Payment:[receipt.id],Booking:[b.id],'Amount CAD':e.amount,'Review status':'Verified allocation'},{key:'Allocation ID'});
  const check=await db.list('allocations',['Applied CAD'],exact('Allocation ID',allocationId));
  if(check.length!==1||check[0].id!==allocation.id||cents(check[0].fields['Applied CAD'])!==amount)return review('Allocation saved. Check the Airtable applied amount before treating the booking as settled.',family);
  return matched();
}
