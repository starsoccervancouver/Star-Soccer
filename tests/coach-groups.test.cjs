const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const groups=require('../private-attendance/web/workspace-groups.js');
const rid=n=>'rec'+String(n).padStart(14,'0');
const row=(n,date,extra={})=>({id:rid(n),date,time:'4:00–5:00 PM',location:'Fictional West Field',programId:rid(100),status:'Scheduled',...extra});

test('winter camps have two browsing groups across days and slots, without merging records',()=>{
 const sessions=[row(1,'2026-12-21',{label:'Christmas AM'}),row(2,'2026-12-22',{label:'Christmas PM',time:'12:30–3:30 PM'}),row(3,'2026-12-28',{label:'Boxing Week AM'}),row(4,'2027-01-01',{label:'Winter Camp Week 2'})];
 const result=groups.groups(sessions);assert.equal(result.length,2);assert.deepEqual(result.map(g=>g.label),['Winter Camp — Week 1','Winter Camp — Week 2']);
 assert.deepEqual(result.map(g=>g.sessionIds),[[rid(1),rid(2)],[rid(3),rid(4)]]);assert.equal(groups.sameGroup(sessions[0],sessions[1]),false);
 assert.equal(groups.groups([row(5,'2026-12-23',{label:'Wednesday training'})])[0].kind,undefined);
 assert.equal(groups.groups([row(6,'2027-12-21',{label:'Winter Camp'})])[0].kind,undefined);
 assert.equal(groups.groups([row(7,'2026-12-23',{players:[{kind:'camp'}]})])[0].kind,'camp');
});

test('verified recurring programs use actual weekday, slot and venue identity',()=>{
 const a=row(1,'2026-10-29'),b=row(2,'2026-11-05');
 assert.equal(groups.key(a),groups.key(b));assert(groups.sameGroup(a,b));
 for(const other of [row(3,'2026-10-30'),row(4,'2026-11-05',{time:'6:00–7:00 PM'}),row(5,'2026-11-05',{location:'Fictional East Field'}),row(6,'2026-11-05',{programId:rid(101)})]){assert.notEqual(groups.key(a),groups.key(other));assert.equal(groups.sameGroup(a,other),false);}
 assert.equal(groups.sameGroup(a,{...a}),true);
 assert.equal(groups.key(a),groups.key({...b,time:' 4:00 - 5:00 pm ',location:' fictional   WEST field '}));
});

test('unmapped browsing buckets never establish shared coaching history',()=>{
 const a=row(1,'2026-10-29',{programId:null}),b=row(2,'2026-11-05',{programId:null}),mapped=row(3,'2026-11-05');
 assert.equal(groups.key(a),groups.key(b),'Unmapped dates share a browsing bucket');assert.equal(groups.sameGroup(a,b),false,'Browsing is not a recurrence claim');assert(groups.sameGroup(a,a));
 const result=groups.groups([a,b,mapped]);assert.equal(result.length,2);const other=result.find(group=>!group.verified);assert.match(other.label,/Other sessions/);assert.deepEqual(other.sessionIds,[a.id,b.id]);assert.equal(other.programId,null);assert.equal(groups.sameGroup(a,mapped),false);
 assert.equal(groups.groups([row(4,'2026-11-05',{programId:'unverified-string'})])[0].verified,false);
});

test('distinct same-slot programs remain separate with distinguishable labels',()=>{
 const a=row(1,'2026-10-29'),b=row(2,'2026-10-29',{programId:rid(101)}),result=groups.groups([b,a]);
 assert.equal(result.length,2);assert.notEqual(result[0].key,result[1].key);assert.notEqual(result[0].label,result[1].label);assert.match(result[0].label,/Group 1$/);assert.match(result[1].label,/Group 2$/);
 assert.deepEqual(groups.groups([a,b]).map(group=>[group.key,group.label]),result.map(group=>[group.key,group.label]));
});

test('members are chronological and group construction does not mutate records',()=>{
 const first=Object.freeze(row(1,'2026-10-29')),past=Object.freeze(row(2,'2026-10-22',{status:'Completed'})),cancelled=Object.freeze(row(3,'2026-11-05',{status:'Cancelled'}));
 const rows=Object.freeze([cancelled,first,past]),before=JSON.stringify(rows),result=groups.groups(rows);
 assert.equal(result.length,1);assert.deepEqual(result[0].sessionIds,[past.id,first.id,cancelled.id]);assert.deepEqual(groups.members(rows,result[0].id),[past,first,cancelled]);assert.equal(JSON.stringify(rows),before);assert.equal(groups.label(result[0]),result[0].label);
 assert.deepEqual(groups.members(rows,'unknown'),[]);assert.deepEqual(groups.groups(null),[]);assert.equal(groups.key(null),null);assert.equal(groups.key({date:'2026-10-29'}),null);
});

test('invalid date or missing slot stays unverified and cannot create recurrence',()=>{
 const a=row(1,'2026-02-30'),b=row(2,'2026-02-30');assert.equal(groups.sameGroup(a,b),false);assert.equal(groups.groups([a,b])[0].verified,false);
 assert.equal(groups.groups([row(3,'2026-10-29',{time:''})])[0].verified,false);assert.equal(groups.groups([row(4,'2026-10-29',{location:''})])[0].verified,false);
});

test('scoped input yields only its permitted sessions and browser UMD uses no state',()=>{
 const a=row(1,'2026-10-29'),b=row(2,'2026-11-05');assert.deepEqual(groups.groups([a])[0].sessionIds,[a.id]);assert(!groups.groups([a])[0].sessionIds.includes(b.id));
 const sandbox={};vm.runInNewContext(fs.readFileSync(require.resolve('../private-attendance/web/workspace-groups.js'),'utf8'),sandbox);
 assert.equal(sandbox.CoachGroups.key(a),groups.key(a));assert.equal(Object.keys(sandbox).join(','),'CoachGroups');
});

test('overview exposes exactly one well-formed existing Weekly program link',async()=>{
 const {buildOwnerOverview}=await import('../private-attendance/owner-overview.mjs');
 const links=[[rid(100)],[{id:rid(101)}],[],[rid(100),rid(101)],['invalid'],[null],undefined];
 const tables={players:[],families:[],bookings:[],enrollments:[],registrations:[],attendance:[],sessions:links.map((value,i)=>({id:rid(i+1),fields:{Session:'Fictional session',Date:'2026-10-29',Time:'4:00–5:00 PM',Venue:'Fictional West Field','Session status':'Planned',Capacity:20,'Weekly program':value}}))};
 const before=JSON.stringify(tables),overview=buildOwnerOverview(tables,'2026-10-29T18:00:00Z');
 assert.deepEqual(overview.sessions.map(session=>session.programId),[rid(100),rid(101),null,null,null,null,null]);assert.equal(JSON.stringify(tables),before);assert.equal(overview.manualOnly,true);assert.equal(overview.draftOnly,true);
});
