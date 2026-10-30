import {randomBytes,createHash} from 'node:crypto';
import {validateWorkspaceOrigin} from './deployment-config.mjs';
const hash=value=>createHash('sha256').update(value).digest('hex');
const random=()=>randomBytes(32).toString('base64url');
const tokenPattern=/^[A-Za-z0-9_-]{43}$/;
const idPattern=/^[A-Za-z0-9][A-Za-z0-9:_-]{0,99}$/;
const ms=value=>Date.parse(value);
export class AttendanceError extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
const fail=(code,status=400)=>{throw new AttendanceError(code,status);};
function text(value,max=100,nullable=false){if(nullable&&value===null)return null;if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f]/.test(value))fail('INVALID_ROSTER');return value.trim();}
function instant(value){
 const parts=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/);
 if(!parts)fail('INVALID_TIMESTAMP');const [year,month,day,hour,minute,second]=parts.slice(1,7).map(Number),date=new Date(0);date.setUTCFullYear(year,month-1,day);date.setUTCHours(hour,minute,second,0);
 if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day||date.getUTCHours()!==hour||date.getUTCMinutes()!==minute||date.getUTCSeconds()!==second||Number(parts[8]??0)>14||Number(parts[9]??0)>59||(Number(parts[8])===14&&Number(parts[9])!==0)||!Number.isFinite(ms(value)))fail('INVALID_TIMESTAMP');
 return new Date(value).toISOString();
}
function id(value){if(typeof value!=='string'||!idPattern.test(value)||!value.startsWith('demo_'))fail('FICTIONAL_DATA_ONLY');return value;}
function bool(value){if(typeof value!=='boolean')fail('INVALID_ROSTER');return Number(value);}
function normalizeSnapshot(input,now,mode='demo'){
 const id=value=>{if(mode==='demo'){if(typeof value!=='string'||!idPattern.test(value)||!value.startsWith('demo_'))fail('FICTIONAL_DATA_ONLY');}else if(typeof value!=='string'||!/^rec[A-Za-z0-9]{14}$/.test(value))fail('INVALID_LIVE_IDENTITY');return value;};
 if(!input||input.schemaVersion!==1||input.source!==(mode==='demo'?'fictional-demo':'airtable-verified'))fail('FICTIONAL_DATA_ONLY');
 if(input.complete!==true||input.approved!==true)fail('ROSTER_NOT_APPROVED',409);
 if(!Number.isSafeInteger(input.revision)||input.revision<1||!Array.isArray(input.sessions)||!input.sessions.length||input.sessions.length>200)fail('INVALID_ROSTER');
 const observedAt=instant(input.observedAt),snapshotId=text(input.snapshotId,150);
 if(ms(observedAt)>now+60000)fail('ROSTER_FROM_FUTURE',409);
 const sessionIds=new Set(),attendanceIds=new Set();
 const sessions=input.sessions.map(s=>{
  id(s.id);if(sessionIds.has(s.id))fail('DUPLICATE_SESSION');sessionIds.add(s.id);
  const startAt=instant(s.startAt),endAt=instant(s.endAt);
  if(ms(endAt)<=ms(startAt)||s.capacity!==20||!['scheduled','cancelled','completed'].includes(s.status)||!Number.isSafeInteger(s.ownerExpected)||s.ownerExpected<0||!Array.isArray(s.entries)||s.entries.length>200)fail('INVALID_ROSTER');
  const players=new Set();const entries=s.entries.map(p=>{
   id(p.playerId);id(p.familyId);id(p.attendanceId);
   if(players.has(p.playerId)||attendanceIds.has(p.attendanceId))fail('DUPLICATE_PLAYER_SESSION');players.add(p.playerId);attendanceIds.add(p.attendanceId);
   if(!['dropin','pass','camp'].includes(p.kind)||!['enabled','disabled','unknown'].includes(p.reminderPreference))fail('INVALID_ROSTER');
   return {playerId:p.playerId,familyId:p.familyId,attendanceId:p.attendanceId,name:text(p.name),guardianName:text(p.guardianName??null,100,true),emailVerified:bool(p.emailVerified),kind:p.kind,reserved:bool(p.reserved),eligible:bool(p.eligible),reminderPreference:p.reminderPreference};
  });
  return {id:s.id,label:text(s.label,150),startAt,endAt,location:text(s.location,200),capacity:20,status:s.status,ownerExpected:s.ownerExpected,entries};
 });return {revision:input.revision,observedAt,snapshotId,sessions};
}
export function createService({store,origin='http://127.0.0.1:8785',approvedOrigin='https://attendance.starsoccer.ca',clock=()=>new Date(),rosterMaxAgeMs=15*60000,mode='demo',activation=null}={}){
 const live=mode==='live'&&activation?.ownerApproved===true&&activation?.exclusiveWriter===true&&activation?.draftOnly===true&&activation?.handoffEvidence?.length>0;
 if(!store||(!live&&mode!=='demo'))fail('LIVE_MODE_NOT_APPROVED',503);
 const u=new URL(origin);if(u.origin!==origin||(live?origin!==validateWorkspaceOrigin(approvedOrigin):u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)))fail('LIVE_MODE_NOT_APPROVED',503);
 if(!Number.isSafeInteger(rosterMaxAgeMs)||rosterMaxAgeMs<1000||rosterMaxAgeMs>3600000)fail('INVALID_FRESHNESS_WINDOW');
 const now=()=>{const n=clock();const value=n instanceof Date?n.getTime():ms(n);if(!Number.isFinite(value))fail('INVALID_CLOCK',503);return value;};
 const stamp=()=>new Date(now()).toISOString();
 const session=sessionId=>{const s=store.get('SELECT * FROM sessions WHERE id=?',sessionId);if(!s)fail('INVALID_INVITATION',404);return s;};
 const subject=(sessionId,playerId)=>{const p=store.get('SELECT * FROM roster WHERE session_id=? AND player_id=?',sessionId,playerId);if(!p||!p.active||!p.eligible||!p.reserved)fail('ROSTER_CHANGED',409);return p;};
 const current=(sessionId,playerId)=>store.get('SELECT * FROM responses WHERE session_id=? AND player_id=?',sessionId,playerId);
 function ready(s){if(!s.complete||!s.approved||now()-ms(s.observed_at)>rosterMaxAgeMs||now()<ms(s.observed_at)-60000)fail('ROSTER_STALE',503);if(s.status!=='scheduled'||now()>=ms(s.start_at))fail('SESSION_CLOSED',410);}
 function capacity(s){const n=store.get('SELECT COUNT(*) AS total FROM roster WHERE session_id=? AND active=1 AND eligible=1 AND reserved=1',s.id).total;return {registered:n,used:Math.max(n,s.owner_expected),blocked:Math.max(n,s.owner_expected)>20};}
 function invitation(token,purpose){
  if(typeof token!=='string'||!tokenPattern.test(token))fail('INVALID_INVITATION',404);
  const inv=store.get('SELECT * FROM invitations WHERE token_hash=?',hash(token));if(!inv||inv.purpose!==purpose||inv.revoked)fail('INVALID_INVITATION',404);
  if(now()>=ms(inv.expires_at))fail('INVITATION_EXPIRED',410);
  const s=session(inv.session_id),p=purpose==='rsvp'?subject(inv.session_id,inv.player_id):store.get('SELECT * FROM roster WHERE session_id=? AND player_id=?',inv.session_id,inv.player_id);
  if(!p||(purpose==='rsvp'&&(p.kind!=='dropin'||!p.email_verified)))fail('ROSTER_CHANGED',409);
  if(purpose==='rsvp'&&(s.status!=='scheduled'||now()>=ms(s.start_at)))fail('SESSION_CLOSED',410);
  return {inv,s,p};
 }
 function browser(csrfSession){if(typeof csrfSession!=='string'||!tokenPattern.test(csrfSession))fail('INVALID_BROWSER_SESSION',403);return hash(csrfSession);}
 function priorRequest(tokenHash,key,payload){if(typeof key!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(key))fail('INVALID_REQUEST_KEY');const payloadHash=hash(JSON.stringify(payload)),saved=store.get('SELECT * FROM requests WHERE token_hash=? AND idempotency_key=?',tokenHash,key);if(saved&&saved.payload_hash!==payloadHash)fail('IDEMPOTENCY_CONFLICT',409);return {saved,payloadHash};}
 function consumeChallenge({challenge,csrfSession,tokenHash,action,answer,expectedVersion}){
  const csrfHash=browser(csrfSession);if(typeof challenge!=='string'||!tokenPattern.test(challenge))fail('INVALID_CONFIRMATION',403);
  const c=store.get('SELECT * FROM challenges WHERE challenge_hash=?',hash(challenge));
  if(!c||c.used||c.token_hash!==tokenHash||c.csrf_hash!==csrfHash||c.action!==action||(c.answer??null)!==(answer??null)||c.expected_version!==expectedVersion||now()>=ms(c.expires_at))fail('INVALID_CONFIRMATION',403);
  return c;
 }
 const api={
  importRoster(input){const snap=normalizeSnapshot(input,now(),mode);return store.transaction(()=>{
   for(const s of snap.sessions){const fingerprint=hash(JSON.stringify(s)),old=store.get('SELECT * FROM sessions WHERE id=?',s.id);
    if(old&&(snap.revision<old.revision||(snap.revision===old.revision&&(old.fingerprint!==fingerprint||old.observed_at!==snap.observedAt))))fail('ROSTER_VERSION_CONFLICT',409);
    store.run(`INSERT INTO sessions(id,label,start_at,end_at,location,capacity,status,owner_expected,revision,observed_at,snapshot_id,fingerprint,approved,complete) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,1)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label,start_at=excluded.start_at,end_at=excluded.end_at,location=excluded.location,status=excluded.status,owner_expected=excluded.owner_expected,revision=excluded.revision,observed_at=excluded.observed_at,snapshot_id=excluded.snapshot_id,fingerprint=excluded.fingerprint,approved=1,complete=1`,s.id,s.label,s.startAt,s.endAt,s.location,20,s.status,s.ownerExpected,snap.revision,snap.observedAt,snap.snapshotId,fingerprint);
    if(old&&(old.start_at!==s.startAt||old.status!==s.status))store.run('UPDATE invitations SET revoked=1 WHERE session_id=?',s.id);
    store.run('UPDATE roster SET active=0 WHERE session_id=?',s.id);
    for(const p of s.entries){const was=store.get('SELECT * FROM roster WHERE session_id=? AND player_id=?',s.id,p.playerId);if(was&&(was.family_id!==p.familyId||was.attendance_id!==p.attendanceId))fail('ROSTER_IDENTITY_CONFLICT',409);
     store.run(`INSERT INTO roster(session_id,player_id,family_id,attendance_id,name,guardian_name,email_verified,kind,reserved,eligible,reminder_preference,active) VALUES(?,?,?,?,?,?,?,?,?,?,?,1)
       ON CONFLICT(session_id,player_id) DO UPDATE SET name=excluded.name,guardian_name=excluded.guardian_name,email_verified=excluded.email_verified,kind=excluded.kind,reserved=excluded.reserved,eligible=excluded.eligible,reminder_preference=excluded.reminder_preference,active=1`,s.id,p.playerId,p.familyId,p.attendanceId,p.name,p.guardianName,p.emailVerified,p.kind,p.reserved,p.eligible,p.reminderPreference);
    }
    store.run(`UPDATE invitations SET revoked=1 WHERE session_id=? AND player_id IN (SELECT player_id FROM roster WHERE session_id=? AND (active=0 OR eligible=0 OR reserved=0 OR email_verified=0 OR kind!='dropin'))`,s.id,s.id);
   }return {imported:snap.sessions.length,revision:snap.revision,source:input.source,businessWrites:0};
  });},
  issueInvitation({playerId,sessionId,rotate=false}){return store.transaction(()=>{
   const s=session(sessionId),p=subject(sessionId,playerId);ready(s);if(p.kind!=='dropin')fail('REGISTRATION_ALREADY_CONFIRMED',409);if(!p.email_verified)fail('CONTACT_NOT_VERIFIED',409);
   const pref=store.get('SELECT * FROM preferences WHERE family_id=? AND player_id=?',p.family_id,p.player_id);if(p.reminder_preference!=='enabled'||pref?.weekly_enabled===0)fail('RECURRING_EMAILS_DISABLED',409);
   if(capacity(s).blocked)fail('CAPACITY_REVIEW_REQUIRED',409);
   if(ms(s.start_at)-now()>7*86400000)fail('INVITATION_TOO_EARLY',409);
   const active=store.get('SELECT token_hash FROM invitations WHERE session_id=? AND player_id=? AND revoked=0 AND expires_at>? LIMIT 1',sessionId,playerId,stamp());
   if(active&&!rotate)fail('INVITATION_ALREADY_ISSUED',409);
   store.run('UPDATE invitations SET revoked=1 WHERE session_id=? AND player_id=?',sessionId,playerId);
   const token=random(),optOutToken=random(),issuedAt=stamp();
   const optOutExpiresAt=new Date(now()+30*86400000).toISOString();
   for(const [value,purpose,expires]of [[token,'rsvp',s.start_at],[optOutToken,'optout',optOutExpiresAt]])store.run('INSERT INTO invitations(token_hash,purpose,session_id,player_id,expires_at,issued_at) VALUES(?,?,?,?,?,?)',hash(value),purpose,sessionId,playerId,expires,issuedAt);
   return {token,optOutToken,expiresAt:s.start_at,optOutExpiresAt,playerId,sessionId,yesUrl:origin+'/respond#token='+token+'&answer=yes',noUrl:origin+'/respond#token='+token+'&answer=no',optOutUrl:origin+'/respond#token='+optOutToken+'&action=optout',draftOnly:true};
  });},
  preview({token,answer,action='rsvp',csrfSession}){if(!['rsvp','optout'].includes(action)||(action==='rsvp'&&!['yes','no'].includes(answer))||(action==='optout'&&answer!==undefined))fail('INVALID_RESPONSE');return store.transaction(()=>{
   const {inv,s,p}=invitation(token,action),version=current(s.id,p.player_id)?.version??0,challenge=random(),created=now();
   store.run('INSERT INTO challenges(challenge_hash,token_hash,csrf_hash,action,answer,expected_version,expires_at) VALUES(?,?,?,?,?,?,?)',hash(challenge),inv.token_hash,browser(csrfSession),action,answer??null,version,new Date(Math.min(created+10*60000,ms(inv.expires_at))).toISOString());
   return {challenge,version,playerName:p.name,guardianName:p.guardian_name,sessionId:s.id,sessionLabel:s.label,startAt:s.start_at,endAt:s.end_at,location:s.location,currentResponse:current(s.id,p.player_id)?.response??null,action,answer,expiresAt:inv.expires_at,weeklyEmailsEnabled:!(store.get('SELECT weekly_enabled FROM preferences WHERE family_id=? AND player_id=?',p.family_id,p.player_id)?.weekly_enabled===0),mode};
  });},
  respond({token,answer,challenge,csrfSession,expectedVersion,idempotencyKey}){
   if(!['yes','no'].includes(answer)||!Number.isSafeInteger(expectedVersion)||expectedVersion<0)fail('INVALID_RESPONSE');
   return store.transaction(()=>{const {inv,s,p}=invitation(token,'rsvp');browser(csrfSession);
    const req=priorRequest(inv.token_hash,idempotencyKey,{answer,expectedVersion,challenge});if(req.saved){const saved=JSON.parse(req.saved.result),latest=current(s.id,p.player_id);return latest&&latest.version>saved.version?{...saved,response:latest.response,version:latest.version,updatedAt:latest.updated_at,duplicate:true,superseded:true,originalVersion:saved.version}:{...saved,duplicate:true};}
    const c=consumeChallenge({challenge,csrfSession,tokenHash:inv.token_hash,action:'rsvp',answer,expectedVersion});
    const previous=current(s.id,p.player_id);if((previous?.version??0)!==expectedVersion)fail('RESPONSE_CHANGED',409);
    if(answer==='yes'){ready(s);if(capacity(s).blocked)fail('CAPACITY_REVIEW_REQUIRED',409);}
    const timestamp=stamp(),changed=previous?.response!==answer,version=changed?(previous?.version??0)+1:previous.version;
    const result={response:answer,version,updatedAt:changed?timestamp:previous.updated_at,duplicate:false,noChange:!changed,mode};
    if(changed){const eventId='rsvp_'+random();const payload={eventId,playerId:p.player_id,sessionId:s.id,attendanceId:p.attendance_id,response:answer,version,timestamp,source:'custom-email-rsvp'};
     store.run('INSERT INTO responses(session_id,player_id,response,version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(session_id,player_id) DO UPDATE SET response=excluded.response,version=excluded.version,updated_at=excluded.updated_at',s.id,p.player_id,answer,version,timestamp);
     store.run('INSERT INTO response_events(event_id,session_id,player_id,attendance_id,previous_response,response,version,occurred_at,roster_revision,source) VALUES(?,?,?,?,?,?,?,?,?,?)',eventId,s.id,p.player_id,p.attendance_id,previous?.response??null,answer,version,timestamp,s.revision,'custom-email-rsvp');
     store.run('INSERT INTO outbox(event_id,session_id,player_id,attendance_id,response,version,occurred_at,payload) VALUES(?,?,?,?,?,?,?,?)',eventId,s.id,p.player_id,p.attendance_id,answer,version,timestamp,JSON.stringify(payload));
    }
    store.run('UPDATE challenges SET used=1 WHERE challenge_hash=?',c.challenge_hash);
    store.run('INSERT INTO requests(token_hash,idempotency_key,payload_hash,result) VALUES(?,?,?,?)',inv.token_hash,idempotencyKey,req.payloadHash,JSON.stringify(result));return result;
   });
  },
  optOut({token,challenge,csrfSession,idempotencyKey}){return store.transaction(()=>{
   const {inv,s,p}=invitation(token,'optout');browser(csrfSession);const version=current(s.id,p.player_id)?.version??0;
   const req=priorRequest(inv.token_hash,idempotencyKey,{action:'optout',challenge});if(req.saved)return {...JSON.parse(req.saved.result),duplicate:true};
   const c=store.get('SELECT expected_version FROM challenges WHERE challenge_hash=?',hash(String(challenge)));consumeChallenge({challenge,csrfSession,tokenHash:inv.token_hash,action:'optout',expectedVersion:c?.expected_version,answer:undefined});
   const previous=store.get('SELECT * FROM preferences WHERE family_id=? AND player_id=?',p.family_id,p.player_id),timestamp=previous?.weekly_enabled===0?previous.updated_at:stamp();
   if(previous?.weekly_enabled!==0){store.run('INSERT INTO preferences(family_id,player_id,weekly_enabled,updated_at) VALUES(?,?,0,?) ON CONFLICT(family_id,player_id) DO UPDATE SET weekly_enabled=0,updated_at=excluded.updated_at',p.family_id,p.player_id,timestamp);store.run('INSERT INTO preference_events(event_id,family_id,player_id,session_id,action,occurred_at) VALUES(?,?,?,?,?,?)','pref_'+random(),p.family_id,p.player_id,s.id,'weekly-optout',timestamp);}
   store.run('UPDATE challenges SET used=1 WHERE challenge_hash=?',hash(challenge));const result={weeklyEmailsEnabled:false,updatedAt:timestamp,version,duplicate:false,registrationUnchanged:true,mode};store.run('INSERT INTO requests(token_hash,idempotency_key,payload_hash,result) VALUES(?,?,?,?)',inv.token_hash,idempotencyKey,req.payloadHash,JSON.stringify(result));return result;
  });},
  dashboard({sessionId}={}){const sessions=store.all('SELECT * FROM sessions'+(sessionId?' WHERE id=?':'')+' ORDER BY start_at',...(sessionId?[sessionId]:[]));return {mode,generatedAt:stamp(),sessions:sessions.map(s=>{const cap=capacity(s);const players=store.all(`SELECT r.*,p.response,p.version,p.updated_at,f.weekly_enabled FROM roster r LEFT JOIN responses p ON p.session_id=r.session_id AND p.player_id=r.player_id LEFT JOIN preferences f ON f.family_id=r.family_id AND f.player_id=r.player_id WHERE r.session_id=? AND r.active=1 AND r.reserved=1 AND r.eligible=1 ORDER BY r.name`,s.id).map(p=>({playerId:p.player_id,name:p.name,kind:p.kind,response:p.kind==='dropin'?(p.response??null):null,version:p.version??0,updatedAt:p.updated_at??null,registrationConfirmed:p.kind!=='dropin',physicalAttendance:live?(store.get('SELECT physical_attendance FROM roster_metadata WHERE attendance_id=?',p.attendance_id)?.physical_attendance??'Not marked'):'not-marked',reminderPreference:p.weekly_enabled===0?'disabled':p.reminder_preference}));return {id:s.id,label:s.label,startAt:s.start_at,endAt:s.end_at,location:s.location,capacity:20,registered:cap.registered,ownerExpected:s.owner_expected,capacityUsed:cap.used,capacityBlocked:cap.blocked,rosterRevision:s.revision,observedAt:s.observed_at,rosterStale:now()-ms(s.observed_at)>rosterMaxAgeMs,counts:{yes:players.filter(p=>p.kind==='dropin'&&p.response==='yes').length,no:players.filter(p=>p.kind==='dropin'&&p.response==='no').length,awaiting:players.filter(p=>p.kind==='dropin'&&!p.response).length,registrationConfirmed:players.filter(p=>p.registrationConfirmed).length},players,syncPending:store.get("SELECT COUNT(*) AS total FROM outbox WHERE session_id=? AND state!='delivered'",s.id).total};})};},
  draftContext({playerId,sessionId}){const p=subject(sessionId,playerId),s=session(sessionId);return {playerId:p.player_id,familyId:p.family_id,playerName:p.name,guardianName:p.guardian_name,session:{id:s.id,label:s.label,startAt:s.start_at,endAt:s.end_at,location:s.location}};},
  seedHistory(rows){if(!live||!Array.isArray(rows)||rows.length>10000)fail('INVALID_HISTORY');return store.transaction(()=>{for(const r of rows){const p=store.get('SELECT * FROM roster WHERE attendance_id=?',r.attendanceId);if(!p)fail('INVALID_HISTORY');if(!['Not marked','Present','Absent'].includes(r.physicalAttendance))fail('INVALID_HISTORY');store.run('INSERT INTO roster_metadata VALUES(?,?) ON CONFLICT(attendance_id) DO UPDATE SET physical_attendance=excluded.physical_attendance',r.attendanceId,r.physicalAttendance);if(r.response){if(!['yes','no'].includes(r.response)||!Number.isSafeInteger(r.version)||r.version<1)fail('INVALID_HISTORY');const saved=current(p.session_id,p.player_id);if(saved&&saved.version===r.version&&saved.response!==r.response)fail('RSVP_HISTORY_CONFLICT',409);store.run('INSERT INTO responses(session_id,player_id,response,version,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(session_id,player_id) DO UPDATE SET response=excluded.response,version=excluded.version,updated_at=excluded.updated_at WHERE excluded.version>responses.version',p.session_id,p.player_id,r.response,r.version,instant(r.updatedAt));}}return {seeded:rows.length,remoteWrites:0};});},
  listPreferences(){return store.all("SELECT e.* FROM preference_events e LEFT JOIN preference_deliveries d ON d.event_id=e.event_id WHERE d.state IS NULL OR d.state!='delivered' ORDER BY e.occurred_at");},
  markPreferenceDelivered(eventId){if(!store.get('SELECT event_id FROM preference_events WHERE event_id=?',eventId))fail('INVALID_PREFERENCE_EVENT');store.run("INSERT INTO preference_deliveries(event_id,state) VALUES(?,'delivered') ON CONFLICT(event_id) DO UPDATE SET state='delivered',last_error=NULL",eventId);},
  listOutbox(){return store.all("SELECT * FROM outbox WHERE state!='delivered' ORDER BY occurred_at,event_id").map(e=>({...e,payload:JSON.parse(e.payload)}));},
  markOutboxDelivered({eventId,readbackVersion}){return store.transaction(()=>{const e=store.get('SELECT * FROM outbox WHERE event_id=?',eventId);if(!e||!Number.isSafeInteger(readbackVersion)||readbackVersion<e.version)fail('READBACK_REQUIRED',409);store.run("UPDATE outbox SET state='delivered',last_error=NULL WHERE event_id=?",eventId);return {delivered:true};});},
  recordOutboxFailure({eventId,code}){if(typeof code!=='string'||!/^[A-Z_]{1,60}$/.test(code))fail('SAFE_ERROR_CODE_REQUIRED');store.run("UPDATE outbox SET attempts=attempts+1,last_error=? WHERE event_id=? AND state!='delivered'",code,eventId);return {pending:true};},
  health(){return {mode,liveWrites:live,emailSending:false,deploymentApproved:live,storedSessions:store.get('SELECT COUNT(*) AS total FROM sessions').total};}
 };return Object.freeze(api);
}
