/* Shared navigation and weekly session details. Core navigation stays usable without JS. */
(() => {
  'use strict';
  const nav=document.querySelector('#primary-navigation');
  if(nav && !document.querySelector('.mobile-nav-toggle')) {
    const toggle=document.createElement('button');toggle.type='button';toggle.className='mobile-nav-toggle';toggle.textContent='Menu';toggle.setAttribute('aria-controls',nav.id);toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation menu');
    nav.before(toggle);nav.closest('header').setAttribute('data-nav-ready','true');
    const setOpen=(open,focus=false)=>{nav.classList.toggle('mobile-nav-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close navigation menu':'Open navigation menu');toggle.textContent=open?'Close':'Menu';if(focus)toggle.focus();};
    toggle.addEventListener('click',()=>setOpen(toggle.getAttribute('aria-expanded')!=='true'));
    nav.addEventListener('click',event=>{
      const link=event.target.closest('a');
      if(!link || toggle.getAttribute('aria-expanded')!=='true')return;
      setOpen(false);
      // Same-page links must not leave keyboard focus in the collapsed menu.
      const url=new URL(link.href);
      if(url.pathname===location.pathname && url.hash) {
        const target=document.getElementById(decodeURIComponent(url.hash.slice(1)));
        if(target){target.tabIndex=-1;target.focus({preventScroll:true});}
      } else toggle.focus({preventScroll:true});
    });
    document.addEventListener('keydown',event=>{if(event.key==='Escape' && toggle.getAttribute('aria-expanded')==='true')setOpen(false,true);});
    document.addEventListener('click',event=>{if(!nav.contains(event.target) && !toggle.contains(event.target))setOpen(false);});
    const media=window.matchMedia('(max-width: 900px)');media.addEventListener('change',()=>setOpen(false));
  }
  // Header setup runs before the next content is parsed, preventing the
  // expanded fallback menu from painting and then collapsing on phones.
  // Session controls still wait until the document is available.
  function setupSessions() {
    const rows=[...document.querySelectorAll('.schedule-entry[data-session-day]')];
    if(!rows.length)return;
    const T=window.StarTraining;
    if(T) rows.forEach(row=>{
      const session=T.getSession(row.dataset.sessionDay);
      const date=session && T.nextDate(session);
      if(!date)return;
      const price=row.querySelector('.schedule-price'),dropin=price?.querySelector('strong'),pass=price?.querySelector('span:not([data-pass-value])'),value=price?.querySelector('[data-pass-value]');
      if(dropin)dropin.textContent=T.money(session.dropin)+' drop-in';
      const hasPass=Number.isFinite(session.pass4)&&session.pass4>0;
      if(pass&&hasPass)pass.textContent=T.money(session.pass4)+' · 4 consecutive sessions';
      if(value){const saving=hasPass?session.dropin*4-session.pass4:0;value.hidden=saving<=0;value.textContent=saving>0?'Save '+T.money(saving)+' vs 4 drop-ins':'';}
      const next=document.createElement('span');next.className='schedule-next';next.textContent='Next: '+T.prettyDate(date);
      row.querySelector('.schedule-day').append(next);

    });
    // Keep older day/audience/location links useful without hiding any groups.
    const focusLinkedSession=()=>{
      const params=new URLSearchParams(window.location.search);
      const day=params.get('day'),audience=params.get('age'),venue=params.get('location');
      const target=rows.find(r=>r.dataset.sessionDay===day)
        || (audience==='adult'?rows.find(r=>r.dataset.audience==='adult'):null)
        || rows.find(r=>r.dataset.sessionLocation===venue)
        || (audience==='youth'?rows.find(r=>r.dataset.audience!=='adult'):null);
      rows.forEach(row=>row.classList.toggle('schedule-entry-target',row===target));
      if(target)requestAnimationFrame(()=>requestAnimationFrame(()=>target.scrollIntoView({block:'start'})));
    };
    focusLinkedSession();
    window.addEventListener('popstate',focusLinkedSession);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setupSessions,{once:true});
  else setupSessions();
})();

/* Enhance number fields consistently without loading form UI on other pages. */
(() => {
  'use strict';
  const source = document.currentScript;
  const base = new URL('.', source && source.src ? source.src : document.baseURI);
  function loadNumberControls() {
    if (!document.querySelector('input[type="number"]:not([data-native-number])') || document.getElementById('ss-number-controls-js')) return;
    const script = document.createElement('script');
    script.id = 'ss-number-controls-js';
    script.src = new URL('number-controls.js?v=20261027', base).href;
    document.head.append(script);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', loadNumberControls, {once: true});
  else loadNumberControls();
})();
