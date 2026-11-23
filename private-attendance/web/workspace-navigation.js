/* Shareable private workspace locations; access is checked by the authenticated app. */
(() => {
  'use strict';
  const views = new Set(['home','plan','profiles','families','books','attention','library','coaches','settings','team','activity','legacy']);
  const parse = hash => {
    const p = new URLSearchParams(hash.replace(/^#/, '')), view = p.get('view')==='reports'?'attention':p.get('view');
    if (!views.has(view)) return null;
    const sessionId = p.get('session'), section = p.get('section') || 'plan';
    if (p.has('balance')) {
      const bookTarget=p.get('balance');
      if(view!=='books'||p.size!==2||!/^(family|booking|player)-rec[A-Za-z0-9]{14}$/.test(bookTarget))return null;
      return {view,bookTarget};
    }
    if (view==='attention') {
      const pane=p.get('section')||'open', filter=p.get('filter')||'all';
      if(sessionId || p.has('family') || !['open','roster','completed'].includes(pane) ||
        !['all','attendance','observations','details','registrations'].includes(filter) || (pane!=='roster' && p.has('filter'))) return null;
      return {view,reportView:pane,reviewFilter:filter};
    }
    if (sessionId && (view !== 'plan' || !/^rec[a-zA-Z0-9]{14}$/.test(sessionId)) || !['plan','attendance','notes'].includes(section)) return null;
    const familyId = p.get('family');
    if (p.has('family') && (view !== 'families' || !/^rec[a-zA-Z0-9]{14}$/.test(familyId))) return null;
    return {view, sessionId:sessionId || null, familyId, section};
  };
  const hashFor = route => { const p = new URLSearchParams({view:route.view==='attention'?'reports':route.view}); if (route.sessionId) { p.set('session', route.sessionId); p.set('section', route.section); } if (route.view==='attention' && route.reportView!=='open') {
    p.set('section',route.reportView); if(route.reportView==='roster' && route.reviewFilter!=='all') p.set('filter',route.reviewFilter);
  } if(route.view==='books'&&route.bookTarget)p.set('balance',route.bookTarget); if (route.familyId) p.set('family', route.familyId); return '#' + p; };
  let context = null, saved = '', applying = false, pending = parse(window.CoachInitialRoute || '');
  function current() {
    if (!context?.profile) return null;
    return {view:context.tab,bookTarget:context.bookTarget,reportView:context.reportView,reviewFilter:context.reviewFilter,familyId:context.tab === 'families' ? context.familyId : null,sessionId:context.tab === 'plan' && window.CoachPlanner?.isFocused() ? context.session?.id : null,section:context.workspaceView || 'plan'};
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
    openInitial(route = pending) {
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
