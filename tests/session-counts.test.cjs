const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../session-counts.js');
const T=require('../training.js');
const labels=['Date','Group','Players','Capacity','Places remaining','Session status'];
const payload=(rows,columns=labels)=>'/*O_o*/\ngoogle.visualization.Query.setResponse('+JSON.stringify({status:'ok',table:{cols:columns.map(label=>({label})),rows:rows.map(c=>({c:c.map(v=>({v}))}))}})+');';
const row=(players=3,status='Planning')=>['2026-10-23','friday',players,20,status==='Cancelled'?0:Math.max(0,20-players),status];
test('zero is a recorded count, missing dates remain unknown',()=>{
  const counts=C.parse(payload([row(0)]));
  assert.equal(C.describe(counts.get('friday:2026-10-23')),'0/20 players · 20 places remaining');
  assert.equal(C.describe(counts.get('friday:2026-10-30')),'Capacity 20 · Count unavailable');
  assert.equal(T.catalog.groupCapacity,20);
});
test('full, over-capacity and cancelled dates never advertise available places',()=>{
  for(const [players,status,expected] of [[20,'Planning','Full'],[21,'Scheduled','Over capacity'],[3,'Cancelled','Cancelled'],[3,'Completed','Completed']]){
    const message=C.describe(C.parse(payload([row(players,status)])).get('friday:2026-10-23'));
    assert(message.includes(expected));assert(!message.includes('places remaining'));
  }
});
test('rejects malformed feeds, duplicate sessions, bad dates and inconsistent totals',()=>{
  for(const rows of [[row(),row()],[['2026-10-22',...row().slice(1)]],[row(-1)],[row(1.5)],[['2026-10-23','friday',3,20,18,'Planning']],[['2026-10-23','friday',3,25,22,'Planning']],[row(3,'unknown')],[]])assert.throws(()=>C.parse(payload(rows)));
  assert.throws(()=>C.parse(payload([row()],labels.concat('Player name'))));
  assert.throws(()=>C.parse('<html>Sign in</html>'));
  assert.throws(()=>C.parse(payload([row()])+'alert(1)'));
});
test('text is parsed as JSON and hostile group strings are rejected',()=>{
  assert.throws(()=>C.parse(payload([['2026-10-23','<script>alert(1)</script>',3,20,17,'Planning']])));
  assert.throws(()=>C.parse('google.visualization.Query.setResponse({"status":"ok", "table":alert(1)});'));
});
