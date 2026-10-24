const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../session-counts.js');

test('Sunday expected player counts include the two Rodriguez drop-ins once',()=>{
  const registered={date:'2026-10-25',group:'sunday',players:2,capacity:20,remaining:18,status:'Planning'};
  const count=C.withReportedCounts(registered,'sunday','2026-10-25');
  assert.equal(C.describe(count),'6/20 players · 14 places remaining');
  assert.equal(C.withReportedCounts({...registered,players:6,remaining:14},'sunday','2026-10-25').players,6);
  assert.equal(C.withReportedCounts({...registered,players:8,remaining:12},'sunday','2026-10-25').players,8);
});
test('owner-reported four-player Sunday baseline is only for known future dates',()=>{
  const record={date:'2026-11-01',group:'sunday',players:0,capacity:20,remaining:20,status:'Planning'};
  assert.equal(C.withReportedCounts(record,'sunday','2026-11-01').players,4);
  assert.equal(C.withReportedCounts(record,'sunday','2026-11-08').players,4);
  assert.strictEqual(C.withReportedCounts(record,'sunday','2026-11-15'),record);
  assert.strictEqual(C.withReportedCounts(record,'wednesday','2026-11-01'),record);
});
test('cancelled or completed events cannot advertise coach-reported places',()=>{
  for(const status of ['Cancelled','Completed']){
    const record={date:'2026-10-25',group:'sunday',players:0,capacity:20,remaining:status==='Cancelled'?0:20,status};
    assert.strictEqual(C.withReportedCounts(record,'sunday','2026-10-25'),record);
  }
  assert.equal(C.withReportedCounts(undefined,'sunday','2026-10-25'),undefined);
});
