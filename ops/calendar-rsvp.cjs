/* Prepared Calendar invitation arguments; this module never sends or creates events. */
const T=require('../training.js');
const E=require('./attendance-emails.cjs');
const W=require('../weekly-signup.js');
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
function invitation(sessionId,date,players,ref){
  const message=E.attendanceInquiry(sessionId,date,players,ref),s=T.getSession(sessionId),end=s.time.match(/[–-](\d{1,2}):(\d{2}) (AM|PM)$/);
  if(!end)throw new Error('Review the session end time.');
  const minutes=(Number(end[1])%12)*60+Number(end[2])+(end[3]==='PM'?720:0);
  if(minutes<=s.startMinutes)throw new Error('Review the approved training duration.');
  return {calendar_id:T.catalog.email,title:'Star Soccer · '+s.day+' training | '+ref,description:message.body,start_time:wallTime(date,s.startMinutes),end_time:wallTime(date,minutes),timezone_str:T.catalog.zone,location:T.catalog.locations[s.location].name,visibility:'private',guests_can_modify:false,add_google_meet:false,transparency:'transparent',reminders:{use_default:false}};
}
function response(value){return ({accepted:'Yes',declined:'No',tentative:'Needs clarification',needsAction:'Awaiting response'})[value]||'Needs clarification';}
/* One native invitation is the registration confirmation. No separate Gmail send.
 * Capacity, verified guardian identity and delivery deduplication are worker gates.
 * For packages the timed event is only the first session, never the whole package.
 */
function registrationInvitation({kind,sessionId,date,playerName,reference,now=new Date(),camp=null}){
  let plan,message,scope;
  if(kind==='dropin'||kind==='pass4'){
    const s=T.getSession(sessionId);
    if(!s||!T.eligibleDate(s,date,now))throw new Error('Choose an upcoming approved session.');
    plan=invitation(sessionId,date,[playerName],reference);
    message=kind==='pass4'?W.passConfirmation(sessionId,date,reference,playerName,now):W.confirmation(sessionId,date,reference,playerName);
    if(kind==='dropin')message.body=message.body.replace('No payment is needed to register.',`Session price: ${T.money(s.dropin)} CAD per player. No payment is needed to register.`);
    scope=kind==='pass4'?'This calendar entry is your first session only. Your pass covers all four dates below. RSVP applies to this date only; declining does not cancel your pass.':'This calendar entry is your next session. RSVP applies to this date only.';
    if(kind==='pass4'&&!W.passPlan(sessionId,date,now).upcoming)scope+=' No attendance response is needed now; we’ll check in before your start date.';
  }else if(kind==='camp'){
    if(!camp||camp.kind!=='week')throw new Error('Choose a full camp package.');
    const q=C.quote({week:camp.week,kind:'week',slot:camp.slot,age:C.catalog.minAge},now);
    message=C.confirmation(q,reference,playerName);
    const first=q.sessions[0],slot=C.catalog.slots[first.slot];
    plan={calendar_id:T.catalog.email,start_time:wallTime(first.date,slot.startMinutes),end_time:wallTime(first.date,slot.startMinutes+180),timezone_str:T.catalog.zone,location:q.location,visibility:'private',guests_can_modify:false,add_google_meet:false,transparency:'transparent',reminders:{use_default:false}};
    scope='This calendar entry is the first '+slot.name.toLowerCase()+' session only. Your registration covers every date and daily session listed below. RSVP applies to this first session only; declining does not cancel your package.';
    message.body=message.body.replace('Reply to this email if your attendance plans change or you have a question.','Use Yes, No or Maybe on this invitation for the first session. Email '+T.catalog.email+' about other dates or questions.');
  }else throw new Error('Choose a supported registration type.');
  const body=message.body.replace(/Please RSVP Yes, No or Maybe in your Google Calendar invitation/g,'Please choose Yes, No or Maybe on this invitation');
  return {...plan,title:message.subject,description:'REGISTRATION CONFIRMED · STAR SOCCER\n\n'+scope+'\n\n'+body};
}
module.exports={invitation,registrationInvitation,response};
