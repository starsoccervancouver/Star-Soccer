const { test } = require('node:test'), assert = require('node:assert/strict');
const activity = () => ({ title: 'Receive & turn', duration: 15, stage: 'technical', instructions: 'Receive across the body.', equipment: 'Balls, cones' });
const diagram = () => ({ schemaVersion: 1, pitch: 'half', items: [{ id: 'player_1', kind: 'home', label: ' 1 ' }], frames: [{ id: 'phase_1', title: ' Start ', duration: 3, positions: [{ id: 'player_1', x: 20, y: 40 }] }, { id: 'phase_2', title: 'Move', duration: 4, notes: 'Keep the first touch close.\nThen accelerate.', positions: [{ id: 'player_1', x: 60, y: 40, trail: [{ x: 25, y: 45 }, { x: 45, y: 45 }] }] }] });
test('activity validation preserves legacy plans, empty sequence and exact multiline content', async () => {
  const { validatePlanContent } = await import('../private-attendance/plan-blocks.mjs');
  const legacy = { focus: 'Touch', warmup: '  Original\nnotes  ' };
  assert.equal(validatePlanContent(legacy), legacy); assert(!Object.hasOwn(legacy, 'activities'));
  const content = { ...legacy, activities: [activity()] }; assert.equal(validatePlanContent(content), content);
  assert.deepEqual(validatePlanContent({ activities: [] }), { activities: [] });
  for (const content of [{ activities: null }, { activities: {} }, { activities: Array(17).fill(activity()) }, { unsupported: '' }, { focus: [] }, { activities: [{ ...activity(), duration: 0 }] }, { activities: [{ ...activity(), duration: 1.5 }] }, { activities: [{ ...activity(), duration: '15' }] }, { activities: [{ ...activity(), stage: 'arbitrary' }] }, { activities: [{ ...activity(), title: ' ' }] }, { activities: [{ ...activity(), equipment: 'x'.repeat(501) }] }, { activities: [{ ...activity(), instructions: '\x00' }] }, { activities: [{ ...activity(), privateNote: 'no' }] }]) assert.throws(() => validatePlanContent(content), { code: 'INVALID_PLAN', status: 400 });
});

test('optional activity diagrams validate existing tactics while preserving exact snapshots and legacy keys', async () => {
  const { validatePlanContent } = await import('../private-attendance/plan-blocks.mjs');
  const oldActivity = activity(), snapshot = diagram(), content = { activities: [oldActivity, { ...activity(), diagram: snapshot }] }, before = JSON.stringify(content);
  assert.equal(validatePlanContent(content), content); assert.equal(content.activities[1].diagram, snapshot); assert.equal(JSON.stringify(content), before);
  assert.deepEqual(Object.keys(oldActivity), ['title', 'duration', 'stage', 'instructions', 'equipment']); assert(!Object.hasOwn(oldActivity, 'diagram'));
  const outsidePitch = diagram(); outsidePitch.frames[0].positions[0].x = 101;
  const duplicatePiece = diagram(); duplicatePiece.items.push({ ...duplicatePiece.items[0] });
  const externalContent = diagram(); externalContent.url = 'https://example.test/diagram.svg';
  for (const value of [null, undefined, [], {}, outsidePitch, duplicatePiece, externalContent]) assert.throws(() => validatePlanContent({ activities: [{ ...activity(), diagram: value }] }), { code: 'INVALID_PLAN', status: 400 });
  const missingKey = { ...activity(), diagram: snapshot }; delete missingKey.equipment;
  assert.throws(() => validatePlanContent({ activities: [missingKey] }), { code: 'INVALID_PLAN', status: 400 });
  assert.throws(() => validatePlanContent({ activities: [{ ...activity(), diagram: snapshot, diagramId: 'separate-record' }] }), { code: 'INVALID_PLAN', status: 400 });
});

test('the aggregate plan budget measures serialized UTF-8 bytes including all diagram snapshots', async () => {
  const { validatePlanContent, MAX_PLAN_CONTENT_BYTES } = await import('../private-attendance/plan-blocks.mjs');
  assert.equal(MAX_PLAN_CONTENT_BYTES, 62000);
  const ascii = { activities: Array.from({ length: 16 }, () => ({ ...activity(), instructions: 'x'.repeat(2000), equipment: 'x'.repeat(500) })) };
  assert.equal(validatePlanContent(ascii), ascii);
  const unicode = { activities: ascii.activities.map(block => ({ ...block, instructions: '界'.repeat(2000) })) };
  assert(JSON.stringify(unicode).length < MAX_PLAN_CONTENT_BYTES, 'Character length alone would wrongly accept the Unicode plan');
  assert(Buffer.byteLength(JSON.stringify(unicode), 'utf8') > MAX_PLAN_CONTENT_BYTES);
  assert.throws(() => validatePlanContent(unicode), { code: 'INVALID_PLAN', status: 400 });
  const large = diagram(); large.frames = Array.from({ length: 12 }, (_, i) => ({ id: 'phase_' + i, title: 'Practice', duration: 3, notes: 'x'.repeat(1000), positions: [{ id: 'player_1', x: 20, y: 40 }] }));
  const four = { activities: Array.from({ length: 4 }, () => ({ ...activity(), diagram: large })) }; assert.equal(validatePlanContent(four), four);
  const five = { activities: [...four.activities, { ...activity(), diagram: large }] };
  assert.throws(() => validatePlanContent(five), { code: 'INVALID_PLAN', status: 400 });
});
test('the existing plan store roundtrips activity order with version and session permissions', async t => {
  const [{ createCoachStore, OWNER_EMAIL }, { openStore }] = await Promise.all([import('../private-attendance/coach-store.mjs'), import('../private-attendance/sqlite-store.mjs')]);
  const store = openStore(); t.after(() => store.close()); const coaches = createCoachStore({ store }), owner = coaches.actor(OWNER_EMAIL), sessionId = 'rec00000000000001';
  coaches.saveUser(owner, { email: 'fixture@example.test', name: 'Fixture Coach', role: 'coach' }); coaches.assign(owner, { email: 'fixture@example.test', sessionId, assigned: true }); const coach = coaches.actor('fixture@example.test');
  const legacy = coaches.savePlan(coach, { sessionId, content: { warmup: 'Original notes' }, expectedVersion: 0 });
  assert(!Object.hasOwn(legacy.content, 'activities'));
  const content = { ...legacy.content, activities: [{ ...activity(), title: 'First' }, { ...activity(), title: 'Second', duration: 20, diagram: diagram() }] };
  const saved = coaches.savePlan(coach, { sessionId, content, expectedVersion: 1 }); assert.deepEqual(saved.content, content); assert.equal(saved.version, 2);
  assert.deepEqual(coaches.plan(owner, sessionId).content.activities.map(x => x.title), ['First', 'Second']);
  assert(!Object.hasOwn(saved.content.activities[0], 'diagram')); assert.deepEqual(saved.content.activities[1].diagram, content.activities[1].diagram);
  saved.content.activities[1].diagram.frames[0].positions[0].x = 90;
  assert.equal(coaches.plan(owner, sessionId).content.activities[1].diagram.frames[0].positions[0].x, 20, 'Readback cannot mutate the stored snapshot');
  assert.throws(() => coaches.savePlan(coach, { sessionId, content, expectedVersion: 1 }), /PLAN_CHANGED/);
  assert.throws(() => coaches.savePlan(coach, { sessionId: 'rec00000000000002', content, expectedVersion: 0 }), /ACCESS_DENIED/);
  assert.equal(coaches.notes(owner).length, 0);
  assert.deepEqual(coaches.savePlan(coach, { sessionId, content: { ...content, activities: [] }, expectedVersion: 2 }).content, { ...content, activities: [] });
});
