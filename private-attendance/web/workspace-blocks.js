/* Activity drafts live in memory and save only through the existing shared-plan form. */
(() => {
  'use strict';
  const mount = document.getElementById('plan-activities');
  if (!mount) return;
  const stages = { warmup: 'Warm-up', technical: 'Technical', game: 'Game / application', other: 'Break / other' };
  const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = text; if (cls) el.className = cls; return el; };
  const clone = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  let saved, draft, session = null, context = null, loadedSessionId = null, enabled = false;
  const originals = new Map();
  for (const key of ['warmup', 'technical', 'game']) { const label = document.getElementById('plan-' + key)?.closest('label'); const text = label && [...label.childNodes].find(child => child.nodeType === 3 && child.textContent.trim()); if (text) originals.set(key, { text, value: text.textContent }); }
  function recordedMinutes(value) {
    if (!value) return null;
    const start = Date.parse(value.startAt), end = Date.parse(value.endAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 86400000) return (end - start) / 60000;
    const parts = String(value.time || '').toLowerCase().replace(/\b(?:12(?::00)?\s*)?noon\b/g, '12:00 pm').split(/[–—-]/);
    const parse = s => { const m = s?.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/); return m && +m[1] <= (m[3] ? 12 : 23) && (!m[3] || +m[1] > 0) && +(m[2] || 0) < 60 ? { h: +m[1], m: +(m[2] || 0), p: m[3] || '' } : null; };
    if (parts.length !== 2) return null;
    const from = parse(parts[0]), to = parse(parts[1]); if (!from || !to) return null;
    const inherited = !from.p && !!to.p && from.h >= 1 && from.h <= 12; if (inherited) from.p = to.p;
    const mins = v => (v.p ? v.h % 12 + (v.p === 'pm' ? 12 : 0) : v.h) * 60 + v.m;
    let first = mins(from), last = mins(to); if (inherited && first > last && to.p === 'pm') first -= 720;
    return last > first && last - first <= 720 ? last - first : null;
  }
  function budget() {
    const total = (draft || []).reduce((sum, block) => sum + (Number(block.duration) || 0), 0), slot = recordedMinutes(session), el = mount.querySelector('.plan-block-budget');
    if (!el) return;
    el.hidden = !draft?.length;
    el.textContent = total + ' minutes planned' + (slot === null ? ' · Session length not recorded.' : ' / ' + slot + '-minute session · ' + (total > slot ? (total - slot) + ' minutes over.' : total < slot ? (slot - total) + ' minutes available for transitions.' : 'Fits the session.'));
    el.classList.toggle('is-over-budget', slot !== null && total > slot);
  }
  function labels() {
    for (const [key, value] of originals) value.text.textContent = ({ warmup: 'Warm-up notes', technical: 'Technical notes', game: 'Game notes' })[key];
    const summary = document.querySelector('#plan-supporting-notes > summary');
    if (summary) {
      const count = ['warmup', 'technical', 'game'].filter(key => document.getElementById('plan-' + key)?.value.trim()).length;
      summary.textContent = 'Supporting coaching notes' + (count ? ' · ' + count + ' filled' : '');
    }
  }
  function changed(message) {
    labels(); budget();
    const status = mount.querySelector('.plan-block-status'); if (status && message !== undefined) status.textContent = message;
    window.dispatchEvent(new CustomEvent('coach:blocks-changed'));
  }
  function button(text, action, label) { const el = node('button', text, 'secondary'); el.type = 'button'; if (label) el.setAttribute('aria-label', label); el.addEventListener('click', () => { if (enabled && !el.disabled && el.dataset.boundary !== 'true') action(); }); return el; }
  function setEnabled(value) {
    enabled = !!value;
    mount.querySelectorAll('input,textarea,select,button').forEach(el => { el.disabled = !enabled || el.dataset.boundary === 'true'; });
  }
  function render(focusIndex = -1, message = '') {
    mount.replaceChildren();
    const heading = node('div', '', 'plan-blocks-heading'); heading.append(node('h3', 'Activity sequence'), node('span', draft?.length ? draft.length + ' / 16 activities' : 'Timed running order', 'small'));
    mount.append(heading);
    const tools = node('div', '', 'plan-blocks-tools');
    const add = button('Add activity', () => { draft = [...(draft || []), { title: '', duration: 10, stage: 'warmup', instructions: '', equipment: '' }]; render(draft.length - 1, 'Activity added to your draft. Save the shared plan when ready.'); changed(); }); add.id = 'plan-add-activity'; add.dataset.boundary = String((draft?.length || 0) >= 16); tools.append(add);
    if (!draft?.length) for (const [key, title] of [['touch', 'First-touch starter'], ['passing', 'Passing starter']]) tools.append(button(title, () => { draft = starter(key); render(0, 'Starter added to your draft. Adapt it for your group, then save the shared plan.'); changed(); }));
    mount.append(tools);
    const total = node('p', '', 'plan-block-budget'); total.setAttribute('role', 'status'); mount.append(total);
    const list = node('ol', '', 'plan-block-list');
    (draft || []).forEach((block, index) => {
      const item = node('li', '', 'plan-block'), head = node('div', '', 'plan-block-head'), actions = node('div', '', 'plan-block-actions'); item.dataset.blockIndex = String(index);
      head.append(node('h4', 'Activity ' + (index + 1)));
      for (const [text, offset] of [['Move up', -1], ['Move down', 1]]) { const move = button(text, () => { const target = index + offset; [draft[index], draft[target]] = [draft[target], draft[index]]; render(target, 'Activity moved to position ' + (target + 1) + '.'); changed(); }, text + ' activity ' + (index + 1)); move.dataset.boundary = String(index + offset < 0 || index + offset >= draft.length); actions.append(move); }
      actions.append(button('Remove', () => { if ((block.title.trim() || block.instructions.trim() || block.equipment.trim()) && !confirm('Remove this activity from your draft? This takes effect when you save the shared plan.')) return; draft.splice(index, 1); render(Math.min(index, draft.length - 1), 'Activity removed from your draft.'); changed(); if (!draft.length) document.getElementById('plan-add-activity').focus(); }, 'Remove activity ' + (index + 1)));
      head.append(actions); item.append(head);
      const fields = node('div', '', 'plan-block-fields');
      for (const [key, title, tag, max] of [['title', 'Activity title', 'input', 120], ['duration', 'Minutes', 'input', 120], ['stage', 'Stage', 'select', 0], ['instructions', 'Setup, coaching points & progressions', 'textarea', 2000], ['equipment', 'Equipment for this activity', 'input', 500]]) {
        const label = node('label', title, ['stage', 'instructions', 'equipment'].includes(key) ? 'plan-block-wide' : ''), field = node(tag); field.id = 'plan-block-' + index + '-' + key; field.dataset.blockField = key; label.htmlFor = field.id;
        if (tag === 'select') for (const [value, title] of Object.entries(stages)) { const option = node('option', title); option.value = value; field.append(option); }
        else if (key === 'duration') { field.type = 'number'; field.min = '1'; field.max = '120'; field.step = '1'; field.inputMode = 'numeric'; field.required = true; }
        else { field.maxLength = max; if (key === 'title') field.required = true; if (tag === 'textarea') field.rows = 3; }
        field.value = block[key]; field.addEventListener('input', () => { if (!enabled) return; block[key] = key === 'duration' ? (field.value === '' ? '' : Number(field.value)) : field.value; changed(); });
        label.append(field); fields.append(label);
      }
      item.append(fields); list.append(item);
    });
    mount.append(list);
    if (!draft?.length) mount.append(node('p', 'Add an activity or choose a starter. Existing written plans are in Supporting coaching notes.', 'plan-block-empty'));
    const status = node('p', message, 'plan-block-status small'); status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); mount.append(status);
    labels(); budget(); setEnabled(enabled);
    if (focusIndex >= 0) document.getElementById('plan-block-' + focusIndex + '-title')?.focus();
  }
  function starter(kind) {
    const touch = kind === 'touch';
    return [
      { title: 'Ball mastery & movement', duration: 10, stage: 'warmup', instructions: 'One ball per player in a marked area. Dribble into space; on a signal, change direction. Encourage small touches and looking up.', equipment: 'Balls, cones' },
      { title: touch ? 'Receive into space' : 'Pass & move through gates', duration: 20, stage: 'technical', instructions: touch ? 'Pairs pass through a gate. Receive with the back foot into space before returning the pass. Progress by changing the receiving angle.' : 'Pairs pass through cone gates, then find a new gate. Ask players to scan before receiving and move after each pass.', equipment: 'Balls, cone gates' },
      { title: 'Small-sided game', duration: 20, stage: 'game', instructions: touch ? 'Play small-sided games. Look for a first touch away from pressure. Pause briefly to praise a useful receiving angle.' : 'Play small-sided games. Encourage support angles and movement after the pass. Adjust numbers and space to suit the group.', equipment: 'Bibs, balls, goals' },
      { title: 'Review & water', duration: 5, stage: 'other', instructions: 'Ask players what helped today and invite one example. Allow time for water and transitions.', equipment: '' },
    ];
  }
  function load(content = {}, nextSession = null) { saved = clone(content.activities); draft = clone(saved); session = nextSession; loadedSessionId = nextSession?.id || null; render(); }
  // Diagrams have their own existing tactics draft and save action. The activity
  // schema intentionally holds only text, timing, stage and equipment.
  function drillBlock(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const { target, text, title, minutes } = value;
    if (!enabled || !context?.profile || context.tab !== 'plan' || !context.planReady || context.busy || !session?.id || context.selected !== session.id || loadedSessionId !== session.id || String(session.status).toLowerCase() === 'cancelled' || (draft?.length || 0) >= 16) return null;
    if (!Object.hasOwn(stages, target) || typeof text !== 'string' || !text.trim() || text.length > 2000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return null;
    const activityTitle = title === undefined ? text.split(/\r?\n/, 1)[0].replace(/\s*\(\d+ min(?: starting point)?\)\s*$/, '').trim() : title;
    const duration = minutes === undefined ? 10 : minutes;
    if (typeof activityTitle !== 'string' || !activityTitle.trim() || activityTitle.length > 120 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(activityTitle) || !Number.isInteger(duration) || duration < 1 || duration > 120) return null;
    return { title: activityTitle, duration, stage: target, instructions: text, equipment: '' };
  }
  function addDrill(value = {}) {
    const block = drillBlock(value);
    if (!block) return false;
    draft = [...(draft || []), block];
    render(draft.length - 1, 'Activity added to the sequence. Save the shared plan when ready.');
    changed();
    return true;
  }
  window.CoachPlanBlocks = {
    load, addDrill, canAddDrill: value => !!drillBlock(value), content: () => clone(draft), isDirty: () => JSON.stringify(draft) !== JSON.stringify(saved),
    discard: () => { draft = clone(saved); render(); }, copy: content => { draft = clone(content?.activities); render(-1, 'Activity sequence copied to your draft.'); },
    clear: () => { enabled = false; load(); }, setEnabled, recordedMinutes,
    validate: () => { for (const [index, block] of (draft || []).entries()) { if (!block.title.trim()) return 'Add a title for activity ' + (index + 1) + '.'; if (!Number.isInteger(block.duration) || block.duration < 1 || block.duration > 120) return 'Choose 1 to 120 whole minutes for activity ' + (index + 1) + '.'; } return ''; },
  };
  window.addEventListener('coach:context', event => { context = event.detail; if (!context?.profile) return window.CoachPlanBlocks.clear(); session = context.session; setEnabled(context.tab === 'plan' && context.planReady && !context.busy && !!session?.id && context.selected === session.id && loadedSessionId === session.id && String(session.status).toLowerCase() !== 'cancelled'); labels(); budget(); });
  for (const key of ['warmup', 'technical', 'game']) document.getElementById('plan-' + key)?.addEventListener('input', labels);
  render();
})();
