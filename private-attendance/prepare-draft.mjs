/* Manual draft export only. This module has no Gmail-send or Calendar client. */
import {createRequire} from 'node:module';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const E=createRequire(import.meta.url)('../ops/attendance-emails.cjs');
export function attendanceArguments(invitation){
 if(invitation?.draftOnly!==true||!invitation.context||invitation.context.playerId!==invitation.playerId||invitation.context.session.id!==invitation.sessionId)throw new Error('VERIFIED_DRAFT_CONTEXT_REQUIRED');
 const c=invitation.context,zone=new Date(c.session.startAt)>=new Date('2026-03-09')?'Etc/GMT+7':'America/Vancouver';
 const date=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(c.session.startAt));
 const fmt=new Intl.DateTimeFormat('en-CA',{timeZone:zone,hour:'numeric',minute:'2-digit'});
 return {parentName:c.guardianName,players:[{playerId:c.playerId,name:c.playerName,yesUrl:invitation.yesUrl,noUrl:invitation.noUrl,optOutUrl:invitation.optOutUrl}],session:{...c.session,date,time:fmt.format(new Date(c.session.startAt))+' – '+fmt.format(new Date(c.session.endAt))},reference:'SS-RSVP-'+c.playerId.toUpperCase()+'-'+date.replaceAll('-',''),appOrigin:'https://attendance.starsoccer.ca',mode:'draft'};
}
export function renderAttendanceDraft(invitation){return E.weeklyAttendanceDraft(attendanceArguments(invitation));}
export function renderRegistrationDraft(invitation,weeklySessionId,reference){const args=attendanceArguments(invitation);return E.registrationConfirmation(weeklySessionId,args.session.date,reference,args.players[0].name,args.parentName,args);}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [input,folder]=process.argv.slice(2);if(!input||!folder)throw new Error('Usage: node private-attendance/prepare-draft.mjs PRIVATE_INVITATION_JSON PRIVATE_OUTPUT_FOLDER');
 const target=resolve(folder),privateRoot=resolve(fileURLToPath(new URL('./data/',import.meta.url)));
 if(target!==privateRoot&&!target.startsWith(privateRoot+'\\')&&!target.startsWith(privateRoot+'/'))throw new Error('Draft exports must stay in private-attendance/data/.');
 const source=JSON.parse(await readFile(resolve(input),'utf8')),draft=renderAttendanceDraft(source);await mkdir(target,{recursive:true});
 // Do not print link capabilities, player details, HTML or recipients to the console.
 await writeFile(join(target,'attendance-draft.html'),draft.html,{mode:0o600,flag:'wx'});await writeFile(join(target,'attendance-draft.txt'),draft.body,{mode:0o600,flag:'wx'});
 console.log('Personalized draft saved privately. No email sent.');
}
