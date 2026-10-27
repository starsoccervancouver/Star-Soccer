const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../session-counts.js');
test('Sunday counts follow the current ledger export, including declines to zero',()=>{
 const columns=['Date','Group','Players','Capacity','Places remaining','Session status'];
 for(const players of [6,4,1,0]){
  const data={status:'ok',table:{cols:columns.map(label=>({label})),rows:[{c:['2026-11-01','sunday',players,20,20-players,'Planning'].map(v=>({v}))}]}};
  const record=C.parse('google.visualization.Query.setResponse('+JSON.stringify(data)+');').get('sunday:2026-11-01');
  assert.equal(record.players,players);assert.ok(C.describe(record).startsWith(players+'/20 players'));
 }
 assert.equal(C.describe(undefined),'Capacity 20 · Count unavailable');
});
