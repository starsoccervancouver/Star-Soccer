/* Prepared Calendar invitation arguments; this module never sends or creates events. */
const T=require('../training.js');
const E=require('./attendance-emails.cjs');
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
module.exports={invitation,response};
