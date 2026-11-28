import emails from '../ops/attendance-emails.cjs';
import training from '../training.js';
import {marker} from './draft-rules.mjs';

export function dueSessions(rows,now){
 const clock=training.localClock(now);
 const last=training.addDays(clock.date,clock.minutes>=540?2:1);
 return rows.filter(({fields:f})=>f['Weekly program']?.length===1&&f.Attendance?.length&&
  ['Confirmed','Planned'].includes(f['Session status'])&&f.Date>=clock.date&&f.Date<=last);
}

// The workspace owns the invitation tokens. Save the rendered message in the same
// SQLite transaction as their issuance so an interrupted Gmail call can resume.
export function familyDraft({service,entry,sessionId,date,recipient,invitations}){
 const players=entry.map((p,i)=>({...invitations[i],name:p.name}));
 const context=service.draftContext({sessionId,playerId:entry[0].playerId});
 const format=new Intl.DateTimeFormat('en-CA',{timeZone:date>='2026-03-09'?'Etc/GMT+7':'America/Vancouver',hour:'numeric',minute:'2-digit'});
 const session={...context.session,date,time:format.format(new Date(context.session.startAt))+' – '+format.format(new Date(context.session.endAt))};
 const reference=emails.reminderKey(context.familyId,sessionId,date);
 const draft=emails.weeklyAttendanceDraft({players,session,parentName:context.guardianName,reference,appOrigin:'https://attendance.starsoccer.ca'});
 return {key:reference,to:recipient,subject:draft.subject+' · '+marker(reference),html:draft.html};
}

export async function runWeeklyRsvp({db,refresh,service,store,contacts,writeDraft,now=new Date()}){
 const report={checkedAt:now.toISOString(),sessions:0,drafts:0,needsReview:0};
 store.run('CREATE TABLE IF NOT EXISTS weekly_rsvp_drafts(key TEXT PRIMARY KEY, payload TEXT, draft_id TEXT)');
 const rows=await db.list('sessions',['Weekly program','Attendance','Session status','Date']);
 for(const {id,fields} of dueSessions(rows,now)){
  try{
   const snapshot=await refresh(id),session=snapshot.sessions.find(s=>s.id===id);
   if(Date.parse(session.startAt)<=now.getTime())continue;
   report.sessions++;
   const families=new Map();
   for(const p of session.entries){
    if(p.kind!=='dropin'||!p.reserved||!p.eligible||p.reminderPreference==='disabled')continue;
    if(!p.emailVerified||p.reminderPreference!=='enabled'){report.needsReview++;continue;}
    if(!families.has(p.familyId))families.set(p.familyId,[]);
    families.get(p.familyId).push(p);
   }
   for(const [family,entry] of families){
    try{
     const date=fields.Date,key=emails.reminderKey(family,id,date);
     const existing=store.get('SELECT * FROM weekly_rsvp_drafts WHERE key=?',key);
     if(existing?.draft_id)continue;
     const recipient=contacts[family]?.email;
     const eligible=entry.filter(p=>!store.get('SELECT response FROM responses WHERE session_id=? AND player_id=?',id,p.playerId)?.response&&store.get('SELECT weekly_enabled FROM preferences WHERE family_id=? AND player_id=?',family,p.playerId)?.weekly_enabled!==0);
     if(!eligible.length)continue;
     const ids=eligible.map(p=>p.playerId).sort().join(',');
     const packet=existing?JSON.parse(existing.payload):service.withInvitations(eligible.map(p=>({sessionId:id,playerId:p.playerId})),invitations=>{
      const packet={ids,start:session.startAt,mail:familyDraft({service,entry:eligible,sessionId:id,date,recipient,invitations})};
      store.run('INSERT INTO weekly_rsvp_drafts(key,payload) VALUES(?,?)',key,JSON.stringify(packet));
      return packet;
     });
     if(packet.ids!==ids||packet.start!==session.startAt||packet.mail.to!==recipient){report.needsReview++;continue;}
     const draft=await writeDraft(packet.mail);
     if(!draft?.id)throw Error('GMAIL_DRAFT_UNCONFIRMED');
     store.run('UPDATE weekly_rsvp_drafts SET draft_id=?,payload=NULL WHERE key=?',draft.id,key);
     report.drafts++;
    }catch{report.needsReview++;}
   }
  }catch{report.needsReview++;}
 }
 return report;
}
