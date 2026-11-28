import test from 'node:test';
import assert from 'node:assert/strict';
import {openStore} from '../private-attendance/sqlite-store.mjs';
import {createService} from '../private-attendance/service.mjs';
import {runWeeklyRsvp} from '../private-attendance/weekly-rsvp.mjs';

test('one branded draft for eligible siblings, scoped response links and safe retry after interruption',async()=>{
 const now=new Date('2026-11-02T19:00:00Z'),date='2026-11-04';
 const store=openStore(),id=n=>'rec'+String(n).padStart(14,'0'),sessionId=id(1),familyId=id(2);
 const service=createService({store,origin:'https://attendance.starsoccer.ca',mode:'live',clock:()=>now,activation:{ownerApproved:true,exclusiveWriter:true,draftOnly:true,handoffEvidence:'isolated fixture'}});
 const entries=['First','Second','Pass holder','Opted out'].map((name,i)=>({name,playerId:id(10+i),familyId,attendanceId:id(20+i),kind:i===2?'pass':'dropin',emailVerified:true,reserved:true,eligible:true,reminderPreference:i===3?'disabled':'enabled'}));
 const snapshot={schemaVersion:1,source:'airtable-verified',snapshotId:'fixture',revision:1,observedAt:now.toISOString(),complete:true,approved:true,sessions:[{id:sessionId,label:'Weekly training',startAt:date+'T23:30:00Z',endAt:'2026-11-05T00:30:00Z',location:'Connaught',status:'scheduled',ownerExpected:4,entries,capacity:20}]};
 service.importRoster(snapshot);
 let attempts=0,packet;
 const args={store,service,now,contacts:{[familyId]:{email:'romeo@starsoccer.ca'}},db:{list:async()=>[{id:sessionId,fields:{Date:date,'Weekly program':[id(3)],Attendance:[id(20)],'Session status':'Confirmed'}}]},refresh:async()=>snapshot,writeDraft:async mail=>{
  attempts++;if(!packet){packet=mail;throw Error('interrupted');}
  assert.deepEqual(mail,packet);return {id:'gmail-draft'};
 }};
 assert.equal((await runWeeklyRsvp(args)).needsReview,1);
 assert.equal((await runWeeklyRsvp(args)).drafts,1);
 assert.equal((await runWeeklyRsvp(args)).drafts,0);
 assert.equal(attempts,2);
 assert.equal(packet.to,'romeo@starsoccer.ca');
 assert.doesNotMatch(packet.html,/Pass holder|Opted out/);
 const links=[...packet.html.matchAll(/#token=([a-zA-Z0-9_-]+)&amp;answer=yes/g)];
 assert.equal(links.length,2);
 for(const [,token] of links)assert.ok(service.preview({token,answer:'yes',csrfSession:'s'.repeat(43)}).challenge);
 store.close();
});
