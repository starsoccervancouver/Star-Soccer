const test=require('node:test'),assert=require('node:assert/strict');
let followup;test.before(async()=>({followup}=await import('../private-attendance/registration-followup.mjs')));
const start=Date.parse('2026-11-17T17:18:29Z'), day=86400000;
function msg(id,labels,from,to,subject,at=start,thread='t1',body='',headers={}){
  return {id,thread_id:thread,label_ids:labels,internal_date:String(at),payload:{mime_type:'text/plain',body:{content:body},
    headers:Object.entries({from,to,subject,'message-id':'<'+id+'@example.test>',...headers}).map(([name,value])=>({name,value}))}};
}
const mail='romeo@starsoccer.ca',parent='family@example.test';
function fixture(){
  return {complete:true,baseId:'base',bookingTableId:'bookings',registrations:[{id:'r1',Reference:'SS-REG-001',Player:['p1'],Family:['f1'],Booking:['b1'],'Parent email':parent,'Confirmation Gmail ID':'confirm','Player history at registration':'First-time verified'}],
    bookings:[{id:'b1',Player:['p1'],Family:['f1'],'Booking reference':'SS-BOOK-001','Agreed booked CAD':60,'Booking status':'Accepted'}],
    players:[{id:'p1',Family:['f1'],Player:'Example Child'}],families:[{id:'f1',Email:parent,'Guardian name':'Example Payer'}],attendance:[],payments:[],allocations:[],intake:[],
    messages:[msg('confirm',['SENT'],mail,parent,'Registration confirmed | SS-REG-001')]};
}
const run=(s,at=start+day)=>followup(s,at);
function notice(s,memo){s.messages.push(msg('notice',['INBOX'],'notify@payments.interac.ca',mail,'Interac e-Transfer: Example Payer sent you $60.00.',start+7000,'bank',
  'Reference Number: CN123456 Message: '+memo+' Transfer Details',{'authentication-results':'mx.google.com; dmarc=pass header.from=payments.interac.ca'}));}
test('first-time player becomes due at exactly 24 hours, in Vancouver, once per booking across retries and repeat confirmations',()=>{
 const s=fixture();assert.equal(run(s,start+day-1).items.length,0);
 s.registrations.push({...s.registrations[0],id:'r2','Confirmation Gmail ID':'resend'});
 s.messages.push(msg('resend',['SENT'],mail,parent,'Registration confirmed | SS-REG-001',start+10000));
 const first=run(s);assert.equal(first.items.length,1);assert.equal(first.items[0].key,'new-player-followup:b1');
 assert.equal(first.items[0].bookingUrl,'https://airtable.com/base/bookings/b1');
 assert.match(first.items[0].confirmationAt,/10:18/);assert.deepEqual(run(s),first);
});
test('returning, unknown, drafts, incoming mail and the wrong recipient never start an outreach item',()=>{
 const s=fixture();s.attendance.push({Player:['p1'],Booking:['unrelated'],'Attendance status':'Present','Session date':'2026-11-01'});
 assert.equal(run(s).results[0].outcome,'skip returning');
 s.attendance=[];delete s.registrations[0]['Player history at registration'];assert.equal(run(s).results[0].outcome,'unverified player history');
 for(const [labels,from,to] of [[['DRAFT','SENT'],mail,parent],[['INBOX'],parent,mail],[['SENT'],mail,'other@example.test']]){
  s.messages=[msg('confirm',labels,from,to,'Registration confirmed | SS-REG-001')];assert.equal(run(s).results[0].outcome,'no verified sent confirmation');
 }
});
test('late family reply in a separately linked conversation clears an existing item',()=>{
 const s=fixture();assert.equal(run(s).items.length,1);
 s.messages.push(msg('old',['INBOX'],parent,mail,'Earlier',start-1),msg('unrelated',['INBOX'],parent,mail,'A different program',start+1,'other'),
   msg('auto',['INBOX'],parent,mail,'Automatic reply',start+1,'t1','',{'auto-submitted':'auto-replied'}));
 assert.equal(run(s).items.length,1);
 s.messages.push(msg('reply',['INBOX'],parent,mail,'Question',start+day+1,'separate','',{'in-reply-to':'<confirm@example.test>'}));
 assert.equal(run(s,start+day+2).results[0].outcome,'family replied');assert.deepEqual(run(s,start+day+2).items,[]);
});
test('matching transfer notice clears an item without a deposit label or a ledger payment',()=>{
 const s=fixture();notice(s,'SS-BOOK-001');assert.equal(run(s).results[0].outcome,'matching transfer notice');assert.deepEqual(s.payments,[]);
});
test('a possible transfer becomes a manual review with the same booking key, then a recorded payment clears it',()=>{
 const s=fixture(),key=run(s).items[0].key;notice(s,'Soccer');
 const review=run(s);assert.equal(review.items[0].label,'Review possible e-transfer');assert.equal(review.items[0].key,key);
 s.payments.push({id:'pay1',Direction:'Incoming',Verification:'Verified','Amount CAD':60,Booking:['b1']});assert.deepEqual(run(s).items,[]);
});
test('ambiguous sibling reply does not silently resolve both bookings',()=>{
 const s=fixture();s.registrations.push({...s.registrations[0],Reference:'SS-REG-002',Booking:['b2'],Player:['p2']});
 s.players.push({id:'p2',Family:['f1']});s.bookings.push({id:'b2',Player:['p2'],Family:['f1'],'Booking reference':'SS-BOOK-002'});
 s.messages.push(msg('shared',['INBOX'],parent,mail,'Question',start+10));
 assert.deepEqual(run(s).items.map(i=>i.label),['Review shared family reply','Review shared family reply']);
});
