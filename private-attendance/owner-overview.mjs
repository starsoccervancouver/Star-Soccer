const ids=v=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:x?.id):[];
function indexLinks(rows, field) {
 const groups=new Map();
 for(const row of rows)for(const id of new Set(ids(row.fields[field]))){
  if(!groups.has(id))groups.set(id,[]);
  groups.get(id).push(row);
 }
 return groups;
}
export function buildOwnerOverview(tables,observedAt,verifiedContacts={},source={}){
 const index=name=>new Map(tables[name].map(r=>[r.id,r.fields])),players=index('players'),families=index('families'),bookings=index('bookings'),registrations=index('registrations');
 const attendanceBySession=indexLinks(tables.attendance,'Session');
 const enrollmentsByPlayer=indexLinks(tables.enrollments.filter(e=>e.fields['Enrollment status']==='Active'),'Player');
 const action=(label,table,id)=>{
  if(!/^app[A-Za-z0-9]{14}$/.test(source.baseId)||!/^tbl[A-Za-z0-9]{14}$/.test(source.tables?.[table])||!/^rec[A-Za-z0-9]{14}$/.test(id))return {};
  return {action:{label,href:'https://airtable.com/'+source.baseId+'/'+source.tables[table]+'/'+id}};
 };
 const sessions=tables.sessions.map(r=>{const s=r.fields,roster=[],issues=[];
  for(const row of attendanceBySession.get(r.id)||[]){const a=row.fields,p=players.get(ids(a.Player)[0]),b=bookings.get(ids(a.Booking)[0]),f=families.get(ids(p?.Family)[0]);
   if(a['Coverage state']!=='Active'||!p||p['Player status']==='Inactive'||['Cancelled'].includes(b?.['Booking status']))continue;
   const registrationKinds=ids(a['Website Registrations']).map(id=>registrations.get(id)?.['Registration kind']);
   const kind=b?.['Booking type']==='Camp package'||registrationKinds.some(k=>['SS-DAY-CAMP-V1','SS-CAMP-V2','SS-CAMP-DROPIN-V1'].includes(k))?'camp':registrationKinds.includes('SS-PASS-V1')||b?.['Booking type']==='Four consecutive sessions'||a['Billing schedule at date']==='Four-session prepaid'?'pass':b?.['Booking type']==='Drop-in'||!ids(a.Booking).length&&ids(a.Enrollment).length?'dropin':'unknown';
   const reasons=[];if(p['Player status']==='Name to confirm')reasons.push('Player name to confirm');if(kind==='unknown')reasons.push(!ids(a.Booking).length&&!ids(a.Enrollment).length?'Booking or enrollment link missing':'Booking type missing');if(!f?.Email)reasons.push('Parent email missing');else{const v=verifiedContacts[ids(p.Family)[0]];if(f['Roster verified email']!==f.Email && (!v?.evidence||v.email!==f.Email))reasons.push('Parent email needs verification');}
   if(kind==='dropin'&&(ids(a['RSVP Reminders']).length||ids(a['RSVP reminder']).length))reasons.push('Legacy Calendar workflow');
   const es=enrollmentsByPlayer.get(ids(a.Player)[0])||[],optedOut=es.some(e=>e.fields['Weekly attendance email preference']==='Opted out');
   if(kind==='dropin'&&!optedOut&&(!es.length||es.some(e=>e.fields['Weekly attendance email preference']!=='Enabled')))reasons.push('Weekly check-in preference needs review');
   const response=a['RSVP status']==='Yes'?'yes':a['RSVP status']==='No'?'no':null;
   const confirmed=['pass','camp'].includes(kind),status=response==='no'?'Unavailable':confirmed?'Confirmed by registration':response==='yes'?'Attending':a['RSVP status']==='Awaiting response'?'Awaiting reply':'Not yet asked';
   const coachUnclassified=!p['Player status']&&String(a['Source coverage key']||'').startsWith('coach:')&&(!b||b['Booking status']==='Accepted');
   if(a['Session preparation status']==='Excluded'&&!coachUnclassified)continue;
   const playerId=ids(a.Player)[0], familyId=ids(p.Family)[0], bookingId=ids(a.Booking)[0], enrollmentId=(es.find(e=>ids(a.Enrollment).includes(e.id)&&e.fields['Weekly attendance email preference']!=='Enabled')||es.find(e=>e.fields['Weekly attendance email preference']!=='Enabled'))?.id;
   for(const reason of reasons){
    let target;
    if(reason==='Player name to confirm')target=action('Review player','players',playerId);
    else if(reason.startsWith('Parent email'))target=f?action('Review family contact','families',familyId):action('Review player’s family link','players',playerId);
    else if(reason==='Booking type missing'&&b)target=action('Review booking','bookings',bookingId);
    else if(reason==='Weekly check-in preference needs review'&&enrollmentId)target=action('Review enrollment','enrollments',enrollmentId);
    else target=action('Review attendance record','attendance',row.id);
    issues.push({player:p.Player,reason,...target});
   }
   roster.push({attendanceId:row.id,age:typeof p.Age==='number'?p.Age:null,playerId:ids(a.Player)[0],name:p.Player,guardianName:f?.['Guardian name']||null,kind,status,response,actualAttendance:a['Attendance status']||'Not marked',updatedAt:a['RSVP updated at']||null,issues:reasons,optedOut});
  }
  const used=Math.max(roster.length,s['Expected headcount (owner reported)']||0),counts={yes:roster.filter(p=>p.status==='Attending').length,no:roster.filter(p=>p.status==='Unavailable').length,confirmed:roster.filter(p=>p.status==='Confirmed by registration').length,awaiting:roster.filter(p=>['Awaiting reply','Not yet asked'].includes(p.status)).length};
  if(used>roster.length)issues.push({player:(used-roster.length)+' owner-reported players',reason:'Names and contact details pending',...action('Review session roster','sessions',r.id)});if(used>s.Capacity)issues.push({player:'Session capacity',reason:'Capacity needs review before any confirmation',...action('Review session capacity','sessions',r.id)});
  const programLinks=ids(s['Weekly program']),programId=programLinks.length===1&&typeof programLinks[0]==='string'&&/^rec[A-Za-z0-9]{14}$/.test(programLinks[0])?programLinks[0]:null;
  const proD=/-PROD$/i.test(s['Source session ID']||'');
  return {id:r.id,label:s.Session,date:s.Date,time:s.Time,location:s.Venue,programId,...(proD?{proD:true}:{}),status:s['Session status'],capacity:s.Capacity,registered:roster.length,capacityUsed:used,expected:Math.max(0,used-counts.no),counts,issues,players:roster};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
 return {observedAt,sessions,draftOnly:true,manualOnly:true,source:'Airtable',pendingSync:0};
}

// Cache the source roster only. Callers apply current account permissions on every request.
export function createOverviewCache(load, clock=Date.now) {
 let current=null, pending=null,version=0;
 function apply(snapshot, updates) {
  if(!updates.size || !snapshot)return;
  for(const session of snapshot.sessions)for(const player of session.players){
   if(updates.has(player.attendanceId))player.actualAttendance=updates.get(player.attendanceId);
  }
 }
 return {
  invalidate(){current=null;pending=null;version++;},
  async read({refresh=false}={}){
   if(!refresh && current && clock()-Date.parse(current.observedAt)<=300000)return current;
   if(!pending){
    const updates=new Map(),started=version,entry={updates};
    entry.result=load().then(snapshot=>{
     apply(snapshot,updates);
     if(started===version)current=snapshot;
     return snapshot;
    }).finally(()=>{if(pending===entry)pending=null;});
    pending=entry;
   }
   return pending.result;
  },
  updateAttendance({attendanceId,status}){
   apply(current,new Map([[attendanceId,status]]));
   pending?.updates.set(attendanceId,status);
  }
 };
}
