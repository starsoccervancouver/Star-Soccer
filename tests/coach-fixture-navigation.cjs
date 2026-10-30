/* Visible group-first navigation for isolated Coach Desk fixtures. */
const assert = require('node:assert/strict');
const focused = page => page.locator('body').evaluate(body => body.classList.contains('planner-focus-mode'));
async function leaveGroup(page) {
  if (await page.locator('#planner-drawer').isVisible()) await page.locator('#planner-close-drawer').click();
  if (await focused(page)) await page.locator('#planner-home').click();
  return !await focused(page);
}
async function openView(page, view, { ready = true } = {}) {
  const button = page.locator('#session-workspace-tabs [data-session-view="' + view + '"]');
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  if (view === 'plan' && ready) await page.waitForFunction(() => !document.getElementById('plan-focus').disabled);
}
async function openSession(page, sessions, id, view = 'attendance', options = {}) {
  if (await page.locator('#planner-drawer').isVisible()) await page.locator('#planner-close-drawer').click();
  const target = sessions.find(session => session.id === id);
  assert(target, 'Fixture session must exist: ' + id);
  const key = await page.evaluate(session => CoachGroups.key(session), target);
  if (await focused(page)) {
    const currentId = await page.locator('#session').inputValue();
    const current = sessions.find(session => session.id === currentId);
    const currentKey = current ? await page.evaluate(session => CoachGroups.key(session), current) : null;
    if (key !== currentKey) {
      await page.locator('#planner-back').click();
      if (await focused(page)) return false; // The coach declined to discard a draft.
    }
  }
  if (!await focused(page)) {
    if (!await page.locator('#panel-plan').isVisible()) await page.locator('#navigation [data-tab="plan"]').click();
    if (!await page.locator('#panel-plan').isVisible()) return false;
    const buttons = page.locator('#planner-days button[data-group-key]');
    const index = await buttons.evaluateAll((nodes, key) => nodes.findIndex(node => node.dataset.groupKey === key), key);
    assert(index >= 0, 'Authorized group must be visible in the chooser');
    await buttons.nth(index).click();
    if (!await focused(page)) return false;
  }
  if (await page.locator('#session').inputValue() !== id) {
    if (!await page.locator('#planner-dates-pane').isVisible()) await page.locator('#planner-focus-date').click();
    await page.locator('[data-session-date-id="'+id+'"]').click();
    if (await page.locator('#session').inputValue() !== id) return false;
  }
  if (await page.locator('#planner-drawer').isVisible()) await page.locator('#planner-close-drawer').click();
  await openView(page, view, options);
  return true;
}
async function openFolder(page, playerId = '') {
  await openView(page, 'notes');
  const buttons = page.locator('#panel-notes [data-player-folder]');
  const index = await buttons.evaluateAll((nodes, id) => nodes.findIndex(node => node.dataset.playerFolder === id), playerId);
  assert(index >= 0, 'Authorized player folder must be visible');
  await buttons.nth(index).click();
}
module.exports = { openSession, openView, openFolder, leaveGroup, focused };
