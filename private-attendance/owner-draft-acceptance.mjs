// One-time, owner-addressed production acceptance check. No synthetic family,
// enrollment, booking or payment is written to the live ledger.
import cases from '../tests/email-draft-fixtures.cjs';
import {confirmation,receipt,renewal} from './draft-rules.mjs';
import {processDraft} from './draft-job.mjs';
import {STAR_SOCCER_OWNER} from './deployment-config.mjs';
const prefix='owner-email-acceptance:20261122:';
const names=['paid','unpaid','partial','siblings','cash','renewed','waiting-renewal','withdraw-renewal'];
export async function ownerDraftAcceptance({db,storage,mail,profile}){
 const at=await storage.get(prefix+'cursor')||0;
 if(at>=names.length)return false;
 const owner=(await profile()).emailAddress?.toLowerCase();
 if(![STAR_SOCCER_OWNER,'romeo@starsoccer.ca'].includes(owner))throw Error('WRONG_MAILBOX');
 const masters=await db.list('templates',['Template','HTML','Version']);
 const d=cases.fixture('',owner);d.templates=masters;
 const title=names[at];
 let c;
 if(at<3)c=confirmation(d,d.bookings[at],cases.today);
 else if(at<5)c=receipt(d,d.payments[at-3],cases.today);
 else{
  const enr=d.enrollments[at===5?1:0];
  if(at===7)enr.fields['Prepaid covered until']='2027-02-12';
  c=renewal(d,enr,cases.date,cases.today);
 }
 if(c.review||c.to&&c.to!==owner)throw Error('TEST_INPUT_REVIEW');
 const key='Test:20261122:'+c.key;const url='https://airtable.com/appnaG94HQpEaRios/tblptlE64qfzG2i01';
 const test={...c,key,source:url,subject:c.subject?'[OWNER TEST '+title+'] '+c.subject:undefined,detail:c.detail||'Owner-only acceptance test.'};
 const lookup=async()=>(await db.list('draftLog',['Email key','Status','Gmail draft ID','Gmail thread ID','Recipient','Review detail','Email kind','Source record'],"{Email key}='"+key+"'"))[0]?.fields||{};
 const old=await lookup();
 // Use the exact isolated test key rather than a real guardian correspondence search.
 const bounded={...mail,prior:async()=>mail.prior({...test,kind:'Test',lookup:null}),create:async candidate=>{
  if(candidate.to!==owner||!candidate.subject.startsWith('[OWNER TEST'))throw Error('TEST_RECIPIENT');
  return mail.create(candidate);
 }};
 for(let pass=0;pass<2;pass++){
  const log=pass===0?old:await lookup();
  if(log.Status!=='Obsolete')await processDraft({c:test,old:log,db,storage,mail:bounded});
 }
 const log=await lookup();
 if(at===5||at===7){if(log.Status!=='Obsolete'||at===5&&log['Gmail draft ID'])throw Error('TEST_RENEWAL');}
 else if(log.Status!=='Draft'||!log['Gmail draft ID']||!(await mail.getDraft(log['Gmail draft ID'])))throw Error('TEST_DRAFT');
 await storage.put(prefix+'cursor',at+1);
 return at+1<names.length;
}
