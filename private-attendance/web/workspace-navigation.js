/* Shareable private workspace locations; access is checked by the authenticated app. */
(() => {
  'use strict';
  const views = new Set(['home','plan','profiles','families','attention','library','coaches','settings','team','activity','legacy']);
  const parse = hash => {
    const p = new URLSearchParams(hash.replace(/^#/, '')), view = p.get('view')==='reports'?'attention':p.get('view');
    if (!views.has(view)) return null;
    const sessionId = p.get('session'), section = p.get('section') || 'plan';
    if (sessionId && (view !== 'plan' || !/^rec[a-zA-Z0-9]{14}$/.test(sessionId)) || !['plan','attendance','notes'].includes(section)) return null;
    const familyId = p.get('family');
    if (p.has('family') && (view !== 'families' || !/^rec[a-zA-Z0-9]{14}$/.test(familyId))) return null;
    return {view, sessionId:sessionId || null, familyId, section};
  };
  const hashFor = route => { const p = new URLSearchParams({view:route.view==='attention'?'reports':route.view}); if (route.sessionId) { p.set('session', route.sessionId); p.set('section', route.section); } if (route.familyId) p.set('family', route.familyId); return '#' + p; };
  let context = null, saved = '', applying = false, pending = parse(window.CoachInitialRoute || '');
  function current() {
    if (!context?.profile) return null;
    return {view:context.tab,familyId:context.tab === 'families' ? context.familyId : null,sessionId:context.tab === 'plan' && window.CoachPlanner?.isFocused() ? context.session?.id : null,section:context.workspaceView || 'plan'};
  }
  function remember(replace = false) {
    const route = current(); if (!route || !views.has(route.view) || applying) return;
    const hash = hashFor(route); if (hash === saved) return;
    const state = replace ? history.state : {fromFamilyDirectory:!!route.familyId && saved === '#view=families'};
    history[replace || !saved ? 'replaceState' : 'pushState'](state, '', location.pathname + location.search + hash); saved = hash;
  }
  function apply(route, initial = false) {
    if (!route || applying || (!initial && !context?.profile)) return false;
    let opened = false;
    applying = true;
    window.dispatchEvent(new CustomEvent('coach:navigate-route', {detail:{...route, resolve:accepted => {
      applying = false;
      opened = accepted;
      if (!accepted && saved) history.replaceState(null, '', location.pathname + location.search + saved);
      else { saved = ''; remember(true); }
    }}}));
    return opened;
  }
  window.CoachNavigation = {
    openInitial() {
      const route = pending;
      pending = null;
      return apply(route, true);
    }
  };
  window.addEventListener('coach:context', event => {
    context = event.detail;
    if (!context?.profile) { saved = ''; return; }
    remember();
  });
  window.addEventListener('coach:focus-changed', () => remember());
  window.addEventListener('popstate', () => { if (!context?.profile) return; const route = parse(location.hash); if (route) apply(route); else if (saved) history.replaceState(null, '', location.pathname + location.search + saved); });
  window.addEventListener('hashchange', () => { if (!context?.profile || location.hash === saved || applying) return; const route = parse(location.hash); if (route) apply(route); else if (saved) history.replaceState(null, '', location.pathname + location.search + saved); });
})();
