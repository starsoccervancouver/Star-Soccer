/* Owner-review preview with fictional names/IDs only. No Gmail, Calendar or Airtable clients. */
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {createService} from './service.mjs';
import {openStore} from './sqlite-store.mjs';
import {createServer} from './local-server.mjs';
const require=createRequire(import.meta.url),E=require('../ops/attendance-emails.cjs');
export const demoClock='2026-11-02T18:00:00.000Z';
export function fictionalRoster(){
 const entry=(id,name,guardian,kind='dropin')=>({playerId:'demo_'+id,familyId:'demo_family_'+id,attendanceId:'demo_attendance_'+id,name,guardianName:guardian,emailVerified:true,kind,reserved:true,eligible:true,reminderPreference:'enabled'});
 return {schemaVersion:1,source:'fictional-demo',snapshotId:'fictional-owner-review',revision:1,observedAt:demoClock,complete:true,approved:true,sessions:[
  {id:'demo_wednesday_2026_11_04',label:'Wednesday training',startAt:'2026-11-04T15:45:00-07:00',endAt:'2026-11-04T17:15:00-07:00',location:'Connaught Park',capacity:20,status:'scheduled',ownerExpected:0,entries:[entry('alex','Alex','Jordan'),entry('sam','Sam','Taylor'),entry('rowan','Rowan','Casey','pass')]},
  {id:'demo_camp_2026_12_21_am',label:'Winter Camp — Week 1 morning',startAt:'2026-12-21T09:00:00-07:00',endAt:'2026-12-21T12:00:00-07:00',location:'Kitsilano Turf',capacity:20,status:'scheduled',ownerExpected:0,entries:[entry('avery','Avery','Cameron','camp')]}
 ]};
}
export async function startDemo({port=8785,host='127.0.0.1'}={}){
 if(!Number.isSafeInteger(port)||port<0||port>65535||host!=='127.0.0.1')throw new Error('Use a valid loopback-only local preview port.');
 let service,previewData;const store=openStore(':memory:'),proxy=new Proxy({}, {get:(_,key)=>(...args)=>{if(!service)throw new Error('Preview is initializing.');return service[key](...args);}});
 const server=createServer({service:proxy,clock:()=>new Date(demoClock),demoData:()=>previewData});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 const origin='http://127.0.0.1:'+server.address().port,snapshot=fictionalRoster();
 try{
  service=createService({store,origin,clock:()=>new Date(demoClock),mode:'demo'});service.importRoster(snapshot);
  const weekly=snapshot.sessions[0],drafts=[];
  for(const p of weekly.entries.filter(p=>p.kind==='dropin')){
   const invite=service.issueInvitation({playerId:p.playerId,sessionId:weekly.id});
   const draft=E.weeklyAttendanceDraft({parentName:p.guardianName,players:[{playerId:p.playerId,name:p.name,yesUrl:invite.yesUrl,noUrl:invite.noUrl,optOutUrl:invite.optOutUrl}],session:{id:weekly.id,label:weekly.label,startAt:new Date(weekly.startAt).toISOString(),endAt:new Date(weekly.endAt).toISOString(),date:'2026-11-04',time:'3:45–5:15 PM',location:weekly.location},reference:'SS-RSVP-DEMO'+String(drafts.length+1).padStart(2,'0'),appOrigin:origin,mode:'draft',demo:true});
   drafts.push({...draft,playerId:p.playerId,playerName:p.name,...invite});
  }
  previewData={clock:demoClock,mode:'fictional-local-only',drafts};
  return {server,service,store,origin,snapshot,drafts,close:async()=>{await new Promise(resolve=>server.close(resolve));store.close?.();}};
 }catch(error){await new Promise(resolve=>server.close(resolve));store.close?.();throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const demo=await startDemo({port:Number(process.env.STAR_ATTENDANCE_DEMO_PORT||8785)});
 console.log('Star Soccer fictional attendance preview: '+demo.origin+'/demo');
 console.log('Coach preparation: '+demo.origin+'/coach');
 console.log('No parent messages, live attendance writes or deployment. Fixed fictional clock: '+demoClock);
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>demo.close().then(()=>process.exit(0)));
}
