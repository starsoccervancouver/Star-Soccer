/* Shared navigation and filtering. Core navigation stays usable without JS. */
(() => {
  'use strict';
  const nav=document.querySelector('#primary-navigation');
  if(nav && !document.querySelector('.mobile-nav-toggle')) {
    const toggle=document.createElement('button');toggle.type='button';toggle.className='mobile-nav-toggle';toggle.textContent='Menu';toggle.setAttribute('aria-controls',nav.id);toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-label','Open navigation');
    nav.before(toggle);nav.closest('header').setAttribute('data-nav-ready','true');
    const setOpen=(open,focus=false)=>{nav.classList.toggle('mobile-nav-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');if(focus)toggle.focus();};
    toggle.addEventListener('click',()=>setOpen(toggle.getAttribute('aria-expanded')!=='true'));
    nav.addEventListener('click',event=>{if(event.target.closest('a'))setOpen(false);});
    document.addEventListener('keydown',event=>{if(event.key==='Escape' && toggle.getAttribute('aria-expanded')==='true')setOpen(false,true);});
    document.addEventListener('click',event=>{if(!nav.contains(event.target) && !toggle.contains(event.target))setOpen(false);});
    const media=window.matchMedia('(max-width: 900px)');media.addEventListener('change',()=>setOpen(false));
  }
  const age=document.querySelector('#schedule-age'),day=document.querySelector('#schedule-day'),locationSelect=document.querySelector('#schedule-location');
  if(age && day && locationSelect) {
    const rows=[...document.querySelectorAll('.schedule-entry')];
    const params=new URLSearchParams(window.location.search);
    const restore=(el,value)=>{if([...el.options].some(o=>o.value===value))el.value=value;};
    restore(age,params.get('age'));restore(day,params.get('day'));restore(locationSelect,params.get('location'));
    const update=()=>{
      let visible=0;
      rows.forEach(row=>{
        const matches=(age.value==='all'||(Number(age.value)>=Number(row.dataset.minAge)&&Number(age.value)<=Number(row.dataset.maxAge)))&&(day.value==='all'||day.value===row.dataset.sessionDay)&&(locationSelect.value==='all'||locationSelect.value===row.dataset.sessionLocation);
        row.hidden=!matches;if(!matches)row.open=false;else visible++;
      });
      document.querySelector('#schedule-results').textContent=`Showing ${visible} of ${rows.length} ${rows.length===1?'session':'sessions'}`;
      document.querySelector('#schedule-empty').hidden=visible!==0;
    };
    [age,day,locationSelect].forEach(el=>el.addEventListener('change',update));
    document.querySelector('#schedule-reset').addEventListener('click',()=>{age.value=day.value=locationSelect.value='all';update();});
    document.querySelector('[data-filter-controls]').hidden=false;update();
  }
})();
