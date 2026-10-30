const { test } = require('node:test'), assert = require('node:assert/strict');
const activity = () => ({ title: 'Receive & turn', duration: 15, stage: 'technical', instructions: 'Receive across the body.', equipment: 'Balls, cones' });
test('activity validation preserves legacy plans, empty sequence and exact multiline content', async () => {
  const { validatePlanContent } = await import('../private-attendance/plan-blocks.mjs');
  const legacy = { focus: 'Touch', warmup: '  Original\nnotes  ' };
  assert.equal(validatePlanContent(legacy), legacy); assert(!Object.hasOwn(legacy, 'activities'));
  const content = { ...legacy, activities: [activity()] }; assert.equal(validatePlanContent(content), content);
  assert.deepEqual(validatePlanContent({ activities: [] }), { activities: [] });
  for (const content of [{ activities: null }, { activities: {} }, { activities: Array(17).fill(activity()) }, { unsupported: '' }, { focus: [] }, { activities: [{ ...activity(), duration: 0 }] }, { activities: [{ ...activity(), duration: 1.5 }] }, { activities: [{ ...activity(), duration: '15' }] }, { activities: [{ ...activity(), stage: 'arbitrary' }] }, { activities: [{ ...activity(), title: ' ' }] }, { activities: [{ ...activity(), equipment: 'x'.repeat(501) }] }, { activities: [{ ...activity(), instructions: '\x00' }] }, { activities: [{ ...activity(), privateNote: 'no' }] }]) assert.throws(() => validatePlanContent(content), { code: 'INVALID_PLAN', status: 400 });
});
test('the existing plan store roundtrips activity order with version and session permissions', async t => {
  const [{ createCoachStore, OWNER_EMAIL }, { openStore }] = await Promise.all([import('../private-attendance/coach-store.mjs'), import('../private-attendance/sqlite-store.mjs')]);
  const store = openStore(); t.after(() => store.close()); const coaches = createCoachStore({ store }), owner = coaches.actor(OWNER_EMAIL), sessionId = 'rec00000000000001';
  coaches.saveUser(owner, { email: 'fixture@example.test', name: 'Fixture Coach', role: 'coach' }); coaches.assign(owner, { email: 'fixture@example.test', sessionId, assigned: true }); const coach = coaches.actor('fixture@example.test');
  const legacy = coaches.savePlan(coach, { sessionId, content: { warmup: 'Original notes' }, expectedVersion: 0 });
  assert(!Object.hasOwn(legacy.content, 'activities'));
  const content = { ...legacy.content, activities: [{ ...activity(), title: 'First' }, { ...activity(), title: 'Second', duration: 20 }] };
  const saved = coaches.savePlan(coach, { sessionId, content, expectedVersion: 1 }); assert.deepEqual(saved.content, content); assert.equal(saved.version, 2);
  assert.deepEqual(coaches.plan(owner, sessionId).content.activities.map(x => x.title), ['First', 'Second']);
  assert.throws(() => coaches.savePlan(coach, { sessionId, content, expectedVersion: 1 }), /PLAN_CHANGED/);
  assert.throws(() => coaches.savePlan(coach, { sessionId: 'rec00000000000002', content, expectedVersion: 0 }), /ACCESS_DENIED/);
  assert.equal(coaches.notes(owner).length, 0);
  assert.deepEqual(coaches.savePlan(coach, { sessionId, content: { ...content, activities: [] }, expectedVersion: 2 }).content, { ...content, activities: [] });
});
