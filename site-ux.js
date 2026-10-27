/* Shared navigation and filtering. Core navigation stays usable without JS. */
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
  const age=document.querySelector('#schedule-age'),day=document.querySelector('#schedule-day'),locationSelect=document.querySelector('#schedule-location');
  if(age && day && locationSelect) {
    const rows=[...document.querySelectorAll('.schedule-entry')];
    const restore=(el,value)=>{if([...el.options].some(o=>o.value===value))el.value=value;};
    const controls=[['age',age],['day',day],['location',locationSelect]];
    const panel=document.querySelector('[data-filter-panel]');
    const restoreFilters=()=>{
      const params=new URLSearchParams(window.location.search);
      controls.forEach(([key,el])=>{el.value='all';restore(el,params.get(key));});
      if(panel)panel.open=controls.some(([,el])=>el.value!=='all');
    };
    restoreFilters();
    const update=(save=false)=>{
      let visible=0;
      rows.forEach(row=>{
        const matches=(age.value==='all'||(Number(age.value)>=Number(row.dataset.minAge)&&Number(age.value)<=Number(row.dataset.maxAge)))&&(day.value==='all'||day.value===row.dataset.sessionDay)&&(locationSelect.value==='all'||locationSelect.value===row.dataset.sessionLocation);
        row.hidden=!matches;if(matches)visible++;
      });
      document.querySelector('#schedule-results').textContent=`Showing ${visible} of ${rows.length} ${rows.length===1?'session':'sessions'}`;
      document.querySelector('#schedule-empty').hidden=visible!==0;
      if(save) {
        const url=new URL(window.location.href);
        controls.forEach(([key,el])=>{if(el.value==='all')url.searchParams.delete(key);else url.searchParams.set(key,el.value);});
        // Replacing avoids filling browser history with every filter selection.
        try {window.history.replaceState(null,'',url);} catch { /* Filtering still works when history is unavailable. */ }
      }
    };
    [age,day,locationSelect].forEach(el=>el.addEventListener('change',()=>update(true)));
    document.querySelector('#schedule-reset').addEventListener('click',()=>{age.value=day.value=locationSelect.value='all';update(true);});
    window.addEventListener('popstate',()=>{restoreFilters();update();});
    const T=window.StarTraining;
    if(T) rows.forEach(row=>{
      const session=T.getSession(row.dataset.sessionDay);
      const date=session && T.nextDate(session);
      if(!date)return;
      const next=document.createElement('span');next.className='schedule-next';next.textContent='Next: '+T.prettyDate(date);
      row.querySelector('.schedule-day').append(next);

    });
    document.querySelector('[data-filter-controls]').hidden=false;
    if(panel)panel.hidden=false;
    update();
  }
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setupSessions,{once:true});
  else setupSessions();
})();
