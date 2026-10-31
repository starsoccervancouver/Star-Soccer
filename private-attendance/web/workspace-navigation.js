/* Shareable private workspace locations; access is checked by the authenticated app. */
(() => {
  'use strict';
  const views = new Set(['home','plan','profiles','library','coaches','settings','team','activity','legacy']);
  const parse = hash => {
    const p = new URLSearchParams(hash.replace(/^#/, '')), view = p.get('view');
    if (!views.has(view)) return null;
    const sessionId = p.get('session'), section = p.get('section') || 'plan';
    if (sessionId && (view !== 'plan' || !/^rec[a-zA-Z0-9]{14}$/.test(sessionId)) || !['plan','attendance','notes'].includes(section)) return null;
    return {view, sessionId:sessionId || null, section};
  };
  const hashFor = route => { const p = new URLSearchParams({view:route.view}); if (route.sessionId) { p.set('session', route.sessionId); p.set('section', route.section); } return '#' + p; };
  let context = null, saved = '', applying = false, initialized = false, pending = parse(window.CoachInitialRoute || '');
  function current() {
    if (!context?.profile) return null;
    return {view:context.tab,sessionId:context.tab === 'plan' && window.CoachPlanner?.isFocused() ? context.session?.id : null,section:context.workspaceView || 'plan'};
  }
  function remember(replace = false) {
    const route = current(); if (!route || !views.has(route.view) || applying) return;
    const hash = hashFor(route); if (hash === saved) return;
    history[replace || !saved ? 'replaceState' : 'pushState'](null, '', location.pathname + location.search + hash); saved = hash;
  }
  function apply(route) {
    if (!route || applying || !context?.profile) return;
    applying = true;
    window.dispatchEvent(new CustomEvent('coach:navigate-route', {detail:{...route, resolve:accepted => {
      applying = false;
      if (!accepted && saved) history.replaceState(null, '', location.pathname + location.search + saved);
      else { saved = ''; remember(true); }
    }}}));
  }
  window.addEventListener('coach:context', event => {
    context = event.detail;
    if (!context?.profile) { initialized = false; saved = ''; return; }
    if (!initialized) { initialized = true; if (pending) { const next = pending; pending = null; queueMicrotask(() => apply(next)); return; } }
    remember();
  });
  window.addEventListener('coach:focus-changed', () => remember());
  window.addEventListener('popstate', () => { if (!context?.profile) return; const route = parse(location.hash); if (route) apply(route); else if (saved) history.replaceState(null, '', location.pathname + location.search + saved); });
  window.addEventListener('hashchange', () => { if (!context?.profile || location.hash === saved || applying) return; const route = parse(location.hash); if (route) apply(route); else if (saved) history.replaceState(null, '', location.pathname + location.search + saved); });
})();
