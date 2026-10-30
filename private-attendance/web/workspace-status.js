(() => {
  'use strict';
  const node = (tag, text, className) => { const el = document.createElement(tag); el.textContent = text; if (className) el.className = className; return el; };
  const roster = node('p', '', 'workspace-sync-state'); roster.id = 'workspace-sync-state'; roster.setAttribute('role', 'status'); roster.hidden = true;
  const plan = node('p', '', 'workspace-save-state'); plan.id = 'workspace-save-state'; plan.setAttribute('role', 'status'); plan.hidden = true;
  document.querySelector('.planner-focus-heading')?.append(plan);
  const heading = document.getElementById('page-title'); heading?.parentElement.append(roster);
  const date = value => { const at = new Date(value); return Number.isFinite(at.getTime()) ? new Intl.DateTimeFormat('en-CA', { hour: 'numeric', minute: '2-digit', timeZone: window.CoachClub?.timeZone || 'America/Vancouver' }).format(at) : ''; };
  window.addEventListener('coach:status', event => {
    const state = event.detail;
    if (!state) { roster.hidden = plan.hidden = true; roster.textContent = plan.textContent = ''; return; }
    roster.hidden = false;
    const pending = Number.isSafeInteger(state.pendingSync) && state.pendingSync > 0 ? state.pendingSync : 0;
    const at = date(state.observedAt), stale = !at || Date.now() - Date.parse(state.observedAt) > 15 * 60 * 1000;
    roster.classList.toggle('needs-attention', !!state.refreshFailed || !!pending);
    roster.textContent = state.refreshing ? 'Updating roster…' : state.refreshFailed ? 'Refresh failed · last loaded roster' + (at ? ' from ' + at : '') : 'Roster' + (at ? ' checked at ' + at : ' time unavailable') + (stale ? ' · refresh before relying on changes' : '');
    if (pending) roster.textContent += ' · ' + pending + ' update' + (pending === 1 ? '' : 's') + ' awaiting ledger confirmation';
    plan.hidden = !state.planning;
    plan.classList.toggle('needs-attention', state.planSaveState === 'error');
    plan.textContent = state.planSaveState === 'saving' ? 'Saving shared plan…' : state.planSaveState === 'error' ? 'Save not confirmed · your draft is still here' : !state.planReady ? 'Loading saved plan…' : state.planDirty ? 'Unsaved changes · save before running this plan' : state.planVersion ? 'Saved' + (date(state.planUpdatedAt) ? ' at ' + date(state.planUpdatedAt) : '') + ' · version ' + state.planVersion : 'New plan · nothing saved yet';
  });
  window.dispatchEvent(new Event('coach:request-status'));
})();
