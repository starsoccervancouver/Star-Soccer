const ids=v=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:x?.id):[];
export function buildOwnerOverview(tables,observedAt,verifiedContacts={}){
 const index=name=>new Map(tables[name].map(r=>[r.id,r.fields])),players=index('players'),families=index('families'),bookings=index('bookings'),enrollments=index('enrollments'),registrations=index('registrations');
 const sessions=tables.sessions.map(r=>{const s=r.fields,roster=[];
  for(const row of tables.attendance.filter(a=>ids(a.fields.Session).includes(r.id))){const a=row.fields,p=players.get(ids(a.Player)[0]),b=bookings.get(ids(a.Booking)[0]),f=families.get(ids(p?.Family)[0]);
   if(a['Coverage state']!=='Active'||!p||p['Player status']==='Inactive'||['Cancelled'].includes(b?.['Booking status']))continue;
   const registrationKinds=ids(a['Website Registrations']).map(id=>registrations.get(id)?.['Registration kind']);
   const kind=registrationKinds.some(k=>['SS-CAMP-V2','SS-CAMP-DROPIN-V1'].includes(k))?'camp':registrationKinds.includes('SS-PASS-V1')||b?.['Booking type']==='Four consecutive sessions'||a['Billing schedule at date']==='Four-session prepaid'?'pass':b?.['Booking type']==='Drop-in'||!ids(a.Booking).length&&ids(a.Enrollment).length?'dropin':'unknown';
   const issues=[];if(p['Player status']==='Name to confirm')issues.push('Player name to confirm');if(kind==='unknown')issues.push('Booking type missing');if(!f?.Email)issues.push('Parent email missing');else{const v=verifiedContacts[ids(p.Family)[0]];if(!v?.evidence||v.email!==f.Email)issues.push('Parent email needs verification');}
   if(kind==='dropin'&&(ids(a['RSVP Reminders']).length||ids(a['RSVP reminder']).length))issues.push('Legacy Calendar workflow');
   const es=[...enrollments.values()].filter(e=>ids(e.Player).includes(ids(a.Player)[0])&&e['Enrollment status']==='Active'),optedOut=es.some(e=>e['Weekly attendance email preference']==='Opted out');
   if(kind==='dropin'&&!optedOut&&(!es.length||es.some(e=>e['Weekly attendance email preference']!=='Enabled')))issues.push('Weekly check-in preference needs review');
   const response=a['RSVP status']==='Yes'?'yes':a['RSVP status']==='No'?'no':null;
   const confirmed=['pass','camp'].includes(kind),status=response==='no'?'Unavailable':confirmed?'Confirmed by registration':response==='yes'?'Attending':a['RSVP status']==='Awaiting response'?'Awaiting reply':'Not yet asked';
   if(a['Session preparation status']==='Excluded')continue;
   roster.push({attendanceId:row.id,age:typeof p.Age==='number'?p.Age:null,playerId:ids(a.Player)[0],name:p.Player,guardianName:f?.['Guardian name']||null,kind,status,response,actualAttendance:a['Attendance status']||'Not marked',updatedAt:a['RSVP updated at']||null,issues,optedOut});
  }
  const used=Math.max(roster.length,s['Expected headcount (owner reported)']||0),counts={yes:roster.filter(p=>p.status==='Attending').length,no:roster.filter(p=>p.status==='Unavailable').length,confirmed:roster.filter(p=>p.status==='Confirmed by registration').length,awaiting:roster.filter(p=>['Awaiting reply','Not yet asked'].includes(p.status)).length};
  const issues=roster.flatMap(p=>p.issues.map(reason=>({player:p.name,reason})));if(used>roster.length)issues.push({player:(used-roster.length)+' owner-reported players',reason:'Names and contact details pending'});if(used>s.Capacity)issues.push({player:'Session capacity',reason:'Capacity needs review before any confirmation'});
  const programLinks=ids(s['Weekly program']),programId=programLinks.length===1&&typeof programLinks[0]==='string'&&/^rec[A-Za-z0-9]{14}$/.test(programLinks[0])?programLinks[0]:null;
  return {id:r.id,label:s.Session,date:s.Date,time:s.Time,location:s.Venue,programId,status:s['Session status'],capacity:s.Capacity,registered:roster.length,capacityUsed:used,expected:Math.max(0,used-counts.no),counts,issues,players:roster};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
 return {observedAt,sessions,draftOnly:true,manualOnly:true,source:'Airtable',pendingSync:0};
}
