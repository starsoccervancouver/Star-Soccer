/* Player folders use only the selected group's authorized context. No browser persistence or writes. */
(() => {
  'use strict';
  const mount = document.getElementById('player-note-folders'); if (!mount) return;
  const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = String(text ?? ''); if (cls) el.className = cls; return el; };
  let context = null, identity = '', epoch = 0, pending = false, previousInputs = null;
  const header = node('div', '', 'note-folders-heading'), heading = node('h2', 'Group & player folders'); heading.id = 'note-folders-title';
  const summary = node('p', '', 'small'); summary.id = 'note-folders-summary';
  header.append(heading, summary);
  const label = node('label', 'Find a player folder', 'note-folders-search'), search = node('input'); search.id = 'note-folders-search'; search.type = 'search'; search.placeholder = 'Player name'; search.autocomplete = 'off'; label.htmlFor = search.id; label.append(search);
  const list = node('div', '', 'note-folders-grid'); list.id = 'note-folders-list'; list.setAttribute('role', 'group'); list.setAttribute('aria-labelledby', heading.id);
  const selected = node('p', '', 'note-folder-selected'); selected.id = 'note-folder-selected'; selected.setAttribute('role', 'status');
  const notice = node('p', '', 'small'); notice.id = 'note-folders-status'; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite');
  mount.append(header, label, list, selected, notice);
  const available = () => !!context?.profile && context.tab === 'plan' && context.workspaceView === 'notes' && !!context.session && Array.isArray(context.groupSessions) && context.groupSessions.some(s => s.id === context.session.id);
  function clear() { search.value = ''; list.replaceChildren(); summary.textContent = selected.textContent = notice.textContent = ''; mount.hidden = true; }
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
    if (!available()) { mount.hidden = true; return; }
    mount.hidden = false;
    const folders = folderData(), query = search.value.trim().toLocaleLowerCase(), visible = folders.filter(folder => !query || folder.name.toLocaleLowerCase().includes(query));
    const current = folders.find(folder => folder.id === (context.noteFolder || ''));
    summary.textContent = (folders.length - 1) + ' player ' + (folders.length === 2 ? 'folder' : 'folders') + ' across this group’s recorded dates. Only notes you can access are counted.';
    list.replaceChildren(...visible.map(folder => {
      const button = node('button', '', 'note-folder-card'); button.type = 'button'; button.dataset.playerFolder = folder.id;
      const active = folder.id === (context.noteFolder || ''); button.setAttribute('aria-pressed', String(active)); button.disabled = pending || !!context.busy;
      button.append(node('span', folder.id ? 'Player folder' : 'Session group', 'note-folder-kind'), node('strong', folder.name), node('span', folder.count + ' ' + (folder.count === 1 ? 'note' : 'notes'), 'note-folder-count'));
      if (folder.id) button.append(node('span', folder.current ? 'On this date’s roster' : 'Previous group player', 'note-folder-roster'));
      button.addEventListener('click', () => open(folder.id)); return button;
    }));
    if (!visible.length) list.append(node('p', 'No player folders match. Clear the search to see the group.', 'empty-state'));
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
    } finally { if (ticket === epoch && identity === started) { pending = false; render(); } }
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
