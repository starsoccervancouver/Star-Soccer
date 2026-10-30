/* Player folders use only the selected group's authorized context. No browser persistence or writes. */
(() => {
  'use strict';
  const mount = document.getElementById('player-note-folders'), workspaceHeading = document.getElementById('notes-workspace-heading'); if (!mount || !workspaceHeading) return;
  const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = String(text ?? ''); if (cls) el.className = cls; return el; };
  let context = null, identity = '', epoch = 0, pending = false, previousInputs = null;
  const header = node('div', '', 'note-folders-heading'), heading = node('h2', 'Players'); heading.id = 'note-folders-title';
  const summary = node('p', '', 'small'); summary.id = 'note-folders-summary';
  header.append(heading, summary);
  const label = node('label', 'Find a player', 'note-folders-search'), search = node('input'); search.id = 'note-folders-search'; search.type = 'search'; search.placeholder = 'Player name'; search.autocomplete = 'off'; label.htmlFor = search.id; label.append(search);
  const list = node('div', '', 'note-folders-grid'); list.id = 'note-folders-list'; list.setAttribute('role', 'group'); list.setAttribute('aria-labelledby', heading.id);
  const selected = node('p', '', 'note-folder-selected'); selected.id = 'note-folder-selected'; selected.setAttribute('role', 'status');
  const notice = node('p', '', 'small'); notice.id = 'note-folders-status'; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  const title = node('h2', 'Group notes'); title.id = 'note-folder-title'; title.tabIndex = -1;
  const detail = node('div'); detail.append(title, selected);
  const groupButton = node('button', '', 'notes-group-button secondary'); groupButton.type = 'button'; groupButton.id = 'notes-open-group'; groupButton.dataset.playerFolder = ''; groupButton.setAttribute('aria-controls', 'note-list');
  groupButton.addEventListener('click', () => open(''));
  workspaceHeading.append(detail, groupButton);
  mount.append(header, label, list, notice);
  const available = () => !!context?.profile && context.tab === 'plan' && context.workspaceView === 'notes' && !!context.session && Array.isArray(context.groupSessions) && context.groupSessions.some(s => s.id === context.session.id);
  function clear() { search.value = ''; list.replaceChildren(); summary.textContent = selected.textContent = notice.textContent = title.textContent = ''; groupButton.replaceChildren(); mount.hidden = workspaceHeading.hidden = true; }
  function folderData() {
    const sessions = context.groupSessions, ids = new Set(sessions.map(s => s.id)), players = new Map();
    for (const session of sessions) for (const player of session.players || []) if (typeof player.playerId === 'string' && player.playerId && !players.has(player.playerId)) players.set(player.playerId, { id: player.playerId, name: String(player.name || 'Named player') });
    const current = new Set((context.session.players || []).map(p => p.playerId));
    const counts = new Map();
    for (const note of context.notes || []) {
      if (!ids.has(note.session_id)) continue;
      const id = note.player_id || ''; if (id && !players.has(id)) continue;
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [{ id: '', name: 'Group notes', count: counts.get('') || 0, current: true }, ...[...players.values()].sort((a, b) => a.name.localeCompare(b.name)).map(player => ({ ...player, count: counts.get(player.id) || 0, current: current.has(player.id) }))];
  }
  function render() {
    if (!available()) { mount.hidden = workspaceHeading.hidden = true; return; }
    mount.hidden = workspaceHeading.hidden = false;
    const folders = folderData(), query = search.value.trim().toLocaleLowerCase(), visible = folders.filter(folder => folder.id && (!query || folder.name.toLocaleLowerCase().includes(query)));
    const current = folders.find(folder => folder.id === (context.noteFolder || ''));
    summary.textContent = (folders.length - 1) + ' player' + (folders.length === 2 ? '' : 's') + ' across this group’s recorded dates.';
    title.textContent = current?.id ? current.name + '’s notes' : 'Group notes';
    groupButton.setAttribute('aria-pressed', String(!context.noteFolder)); groupButton.disabled = pending || !!context.busy;
    groupButton.replaceChildren(node('strong', 'Group notes'), node('span', folders[0].count + ' accessible ' + (folders[0].count === 1 ? 'note' : 'notes')));
    list.replaceChildren(...visible.map(folder => {
      const button = node('button', '', 'note-folder-card'); button.type = 'button'; button.dataset.playerFolder = folder.id;
      const active = folder.id === (context.noteFolder || ''); button.setAttribute('aria-pressed', String(active)); button.setAttribute('aria-controls', 'note-list'); button.disabled = pending || !!context.busy;
      button.append(node('strong', folder.name), node('span', folder.count + ' ' + (folder.count === 1 ? 'note' : 'notes'), 'note-folder-count'));
      if (!folder.current) button.append(node('span', 'Previous group player', 'note-folder-roster'));
      button.addEventListener('click', () => open(folder.id)); return button;
    }));
    if (!visible.length) list.append(node('p', query ? 'No players match this name.' : 'No players recorded for this group yet.', 'empty-state'));
    selected.textContent = !current ? 'Choose a folder to view its notes.' : current.id && !current.current ? current.name + ' is not on this date’s roster. Choose a date where they are listed before adding a new note. Their recorded notes remain available below.' : (current.id ? current.name + '’s notes' : 'Group notes') + ' · Showing only this group’s recorded dates.';
    selected.classList.toggle('note-folder-history', !!current?.id && !current.current);
    search.disabled = !!context.busy || pending;
  }
  async function open(playerId) {
    if (!available() || context.busy || pending || !folderData().some(folder => folder.id === playerId)) return;
    if (playerId === (context.noteFolder || '')) return;
    const started = identity, ticket = ++epoch; pending = true; notice.textContent = ''; render();
    try {
      const accepted = await new Promise(resolve => window.dispatchEvent(new CustomEvent('coach:note-folder', { detail: { playerId, resolve } })));
      if (ticket !== epoch || identity !== started) return;
      notice.textContent = accepted === true ? '' : 'Kept the current folder and its unsaved note.';
    } finally { if (ticket === epoch && identity === started) { pending = false; render(); if (context.noteFolder === playerId) title.focus(); else (playerId ? [...list.querySelectorAll('button')].find(button => button.dataset.playerFolder === playerId) : groupButton)?.focus({ preventScroll: true }); } }
  }
  search.addEventListener('input', render);
  window.addEventListener('coach:context', event => {
    const next = event.detail || null;
    const group = Array.isArray(next?.groupSessions) ? next.groupSessions.map(s => s.id).sort().join('|') : '';
    const nextIdentity = next?.profile ? [next.profile.email, next.profile.role, next.profile.sessionVersion, group].join(':') : '';
    if (nextIdentity !== identity) { epoch++; pending = false; previousInputs = null; clear(); }
    else if (next?.session?.id !== context?.session?.id) { epoch++; pending = false; notice.textContent = ''; }
    identity = nextIdentity; context = next;
    if (!next?.profile) { clear(); return; }
    const inputs = [next.groupSessions, next.notes, next.session, next.noteFolder, next.workspaceView, next.tab, next.busy];
    if (previousInputs && inputs.every((value, index) => value === previousInputs[index])) return;
    previousInputs = inputs; render();
  });
  clear(); window.dispatchEvent(new CustomEvent('coach:request-context'));
})();
