/* Optional structured goals on the existing private coaching note. No separate storage. */
(() => {
  'use strict';
  const states = new Map(), labels = {planned:'Planned', 'in-progress':'In progress', achieved:'Achieved'};
  const el = (tag, text = '', cls = '') => { const n = document.createElement(tag); n.textContent = text; if (cls) n.className = cls; return n; };
  function mount(prefix, options = {}) {
    const form = options.form || document.getElementById(prefix + '-form'), body = options.body || document.getElementById(prefix + '-body'), category = options.category || document.getElementById(prefix + '-category');
    if (!form || !body || !category || states.get(prefix)?.form === form) return;
    const box = el('fieldset', '', 'coach-goal-fields'); box.hidden = true; box.id = prefix + '-goal-fields';
    box.append(el('legend', 'Development goal'));
    const inputs = {};
    for (const [key, title, tag, max] of [['successMeasure','What would success look like?','textarea',1000], ['status','Progress','select'], ['evidence','Practice evidence · optional','textarea',4000]]) {
      const label = el('label', title), input = el(tag); input.id = prefix + '-goal-' + key; label.htmlFor = input.id;
      if (tag === 'select') for (const [value, name] of Object.entries(labels)) input.append(new Option(name, value));
      else { input.rows = key === 'evidence' ? 3 : 2; input.maxLength = max; input.placeholder = key === 'evidence' ? 'Which drill or practice helped? What did you observe?' : 'For example: receive on the back foot and pass to a teammate in a small-sided game.'; }
      label.append(input); box.append(label); inputs[key] = input;
    }
    box.append(el('p', 'Saved privately with this player’s note and session date. Progress does not change attendance.', 'small'));
    body.closest('label').after(box);
    const player = options.player || (() => document.getElementById(prefix === 'planner-note' ? 'planner-notes-player' : 'note-player')?.value);
    const state = {form, box, category, inputs, player, drillId:null}; states.set(prefix, state);
    category.addEventListener('change', () => sync(prefix));
    if (!options.player) document.getElementById(prefix === 'planner-note' ? 'planner-notes-player' : 'note-player')?.addEventListener('change', () => sync(prefix));
    form.addEventListener('reset', () => queueMicrotask(() => { if (states.get(prefix) === state) reset(prefix); }));
    sync(prefix);
  }
  for (const prefix of ['note', 'planner-note']) mount(prefix);
  function sync(prefix) {
    const s = states.get(prefix); if (!s) return;
    s.box.hidden = s.category.value !== 'Goal' || !s.player();
    for (const input of Object.values(s.inputs)) input.disabled = s.box.hidden || s.category.disabled;
  }
  function read(prefix) {
    const s = states.get(prefix); if (!s) return null; sync(prefix); if (s.box.hidden) return null;
    return {successMeasure:s.inputs.successMeasure.value.trim(), status:s.inputs.status.value, evidence:s.inputs.evidence.value.trim(), ...(s.drillId ? {drillId:s.drillId} : {})};
  }
  function load(prefix, note) {
    const s = states.get(prefix); if (!s) return;
    for (const key of ['successMeasure','evidence']) s.inputs[key].value = note?.goal?.[key] || '';
    s.inputs.status.value = labels[note?.goal?.status] ? note.goal.status : 'planned'; s.drillId = note?.goal?.drillId || null; sync(prefix);
  }
  function reset(prefix) { load(prefix, null); }
  function renderCard(note) {
    if (note.category !== 'Goal' || !note.goal) return null;
    const box = el('div', '', 'coach-goal-summary');
    box.append(el('span', labels[note.goal.status] || 'Planned', 'goal-progress goal-progress-' + (labels[note.goal.status] ? note.goal.status : 'planned')));
    if (note.goal.successMeasure) { box.append(el('strong', 'Success measure'), el('p', note.goal.successMeasure)); }
    if (note.goal.evidence) { box.append(el('strong', 'Practice evidence'), el('p', note.goal.evidence)); }
    return box;
  }
  window.CoachGoals = {mount, unmount:prefix => states.delete(prefix), sync, read, load, reset, renderCard, isDirty: prefix => { const goal = read(prefix); return !!goal && (!!goal.successMeasure || !!goal.evidence || goal.status !== 'planned'); }};
  window.addEventListener('coach:context', event => { for (const prefix of states.keys()) { if (!event.detail?.profile) reset(prefix); sync(prefix); } });
})();
