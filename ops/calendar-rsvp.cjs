/* Prepared Calendar invitation arguments; this module never sends or creates events. */
const T=require('../training.js');
const E=require('./attendance-emails.cjs');
const C=require('../winter-camps.js');
function wallTime(date,minutes){
  const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:T.catalog.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const midnight=Date.parse(date+'T00:00:00Z');
  for(let h=0;h<48;h++){
    const instant=new Date(midnight+h*3600000+(minutes%60)*60000),p=Object.fromEntries(fmt.formatToParts(instant).map(p=>[p.type,p.value]));
    if(`${p.year}-${p.month}-${p.day}`===date&&Number(p.hour)===Math.floor(minutes/60)&&Number(p.minute)===minutes%60)return instant.toISOString();
  }
  throw new Error('Cannot resolve approved Vancouver training time.');
}
function invitation(sessionId,date,players,ref,parentName=null){
  const message=E.attendanceInquiry(sessionId,date,players,ref,null,parentName),s=T.getSession(sessionId),end=s.time.match(/[–-](\d{1,2}):(\d{2}) (AM|PM)$/);
  if(!end)throw new Error('Review the session end time.');
  const minutes=(Number(end[1])%12)*60+Number(end[2])+(end[3]==='PM'?720:0);
  if(minutes<=s.startMinutes)throw new Error('Review the approved training duration.');
  return {calendar_id:T.catalog.email,title:'Star Soccer · '+s.day+' training | '+ref,description:message.body,start_time:wallTime(date,s.startMinutes),end_time:wallTime(date,minutes),timezone_str:T.catalog.zone,location:T.catalog.locations[s.location].name,visibility:'private',guests_can_modify:false,add_google_meet:false,transparency:'transparent',reminders:{use_default:false}};
}
function response(value){return ({accepted:'Yes',declined:'No',tentative:'Needs clarification',needsAction:'Awaiting response'})[value]||'Needs clarification';}
function campInvitation(weekId,slotId,date,players,ref,parentName=null){
  const week=C.getWeek(weekId),slot=C.catalog.slots[slotId];
  const list=Array.isArray(players)?players.map(p=>String(p).trim()):[];
  if(!week||!slot||!C.dates(weekId).includes(date)||!list.length||list.length>20||list.some(p=>!p||p.length>100||/[\x00-\x1f]/.test(p))||new Set(list.map(p=>p.normalize('NFC').toLowerCase())).size!==list.length||!/^SS-(?:CAMP-)?[A-Z0-9-]{6,40}$/.test(ref))throw new Error('Choose an approved camp date, daily slot and one verified family.');
  return {calendar_id:T.catalog.email,title:'Star Soccer · '+week.name+' attendance | '+ref,description:[E.guardianGreeting(list,parentName),'Players: '+list.join(', '),`Camp session:\n${week.name} · ${T.prettyDate(date)}\n${slot.time}\n${C.catalog.location} · Vancouver time`,'Please RSVP Yes, No or Maybe in this invitation. We’re expecting the listed players unless you decline.','This invitation applies to this dated session only. Declining does not cancel your camp package. Email the team about other package dates.','Bring water, turf shoes and weather-ready layers. Thank you!','Star Soccer\n'+T.catalog.email+'\nReference: '+ref].join('\n\n'),start_time:wallTime(date,slot.startMinutes),end_time:wallTime(date,slot.startMinutes+180),timezone_str:T.catalog.zone,location:C.catalog.location,visibility:'private',guests_can_modify:false,add_google_meet:false,transparency:'transparent',reminders:{use_default:false}};
}
module.exports={invitation,campInvitation,response};
