/* Presentation-only views over the authorized group snapshot. No storage or requests. */
(() => {
  'use strict';
  const states = new Map(), mounts = new Map(); let identity = '';
  const defaultMode = () => ['grid','list','calendar'].includes(document.body.dataset.deskSessionView) ? document.body.dataset.deskSessionView : 'grid';
  const make = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = text; el.className = cls; return el; };
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: window.CoachClub?.timeZone || 'America/Vancouver', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date());
  const parsed = date => /^\d{4}-\d{2}-\d{2}$/.test(date || '') && Number.isFinite(Date.parse(date + 'T12:00:00Z')) && new Date(date + 'T12:00:00Z').toISOString().slice(0,10) === date;
  const format = (date, options) => new Intl.DateTimeFormat('en-CA', { timeZone:'UTC', ...options }).format(new Date(date + 'T12:00:00Z'));
  const startMinute = session => { const text=String(session.time||''),first=text.split(/[–—-]/)[0],match=first.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);if(!match)return 1440;const suffix=(match[3]||text.match(/am|pm/gi)?.at(-1)||'').toLowerCase(),hour=Number(match[1]);return (suffix?hour%12+(suffix==='pm'?12:0):hour)*60+Number(match[2]||0); };
  function mount(host, key, options) {
    if (!host) return;
    const { groups, locked = false, onOpen } = options;
    mounts.set(key, {host, key, options});
    const state = states.get(key) || { mode:defaultMode(), date:today(), month:today().slice(0,7) }; states.set(key, state);
    host.querySelectorAll(':scope > [data-coach-views]').forEach(el => el.remove());
    host.dataset.coachView = state.mode;
    const render = focus => { mount(host, key, { groups, locked, onOpen }); if (focus) host.querySelector('[data-view-action="' + focus + '"]')?.focus({ preventScroll:true }); };
    const button = (text, action, run) => { const b = make('button', text, 'secondary'); b.type='button'; b.dataset.viewAction=action; b.disabled=locked; b.addEventListener('click', () => { if (!locked) run(); }); return b; };
    const toolbar = make('div', '', 'coach-view-switch'); toolbar.dataset.coachViews='toolbar'; toolbar.setAttribute('role','group'); toolbar.setAttribute('aria-label','Display view');
    toolbar.append(make('span', 'View', 'coach-view-label'));
    for (const mode of ['calendar','list','grid']) { const b=button(mode[0].toUpperCase()+mode.slice(1), mode, () => { state.mode=mode; render(mode); }); b.setAttribute('aria-pressed', String(state.mode===mode)); toolbar.append(b); }
    const anchor=host.querySelector(':scope > .coaching-agenda, :scope > #planner-days');
    if (anchor) anchor.before(toolbar); else host.append(toolbar);
    if (state.mode !== 'calendar') return;
    const calendar=make('section','','coach-calendar'); calendar.dataset.coachViews='calendar'; calendar.setAttribute('aria-label','Session calendar'); toolbar.after(calendar);
    const unique=new Map(); for(const group of groups) for(const session of group.sessions) if(parsed(session.date)&&!unique.has(session.id)) unique.set(session.id,{session,group});
    const rows=[...unique.values()].sort((a,b)=>a.session.date.localeCompare(b.session.date)||startMinute(a.session)-startMinute(b.session)||a.session.id.localeCompare(b.session.id));
    const monthStart=state.month+'-01', heading=make('div','','coach-calendar-heading');
    heading.append(make('h3',format(monthStart,{month:'long',year:'numeric'})));
    const move = step => { const date=new Date(monthStart+'T12:00:00Z'); date.setUTCMonth(date.getUTCMonth()+step); state.month=date.toISOString().slice(0,7); state.date=rows.find(row=>row.session.date.startsWith(state.month))?.session.date||state.month+'-01'; render(step<0?'previous':'next'); };
    const previous=button('←','previous',()=>move(-1)); previous.setAttribute('aria-label','Previous month');
    const next=button('→','next',()=>move(1)); next.setAttribute('aria-label','Next month');
    heading.append(previous,button('Today','today',()=>{state.date=today();state.month=state.date.slice(0,7);render('today');}),next);calendar.append(heading);
    const grid=make('div','','coach-calendar-grid'); grid.setAttribute('role','group'); grid.setAttribute('aria-label',format(monthStart,{month:'long',year:'numeric'})+' dates');
    for(const day of ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']) grid.append(make('span',day,'coach-calendar-weekday'));
    const start=new Date(monthStart+'T12:00:00Z'),offset=(start.getUTCDay()+6)%7,last=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0,12)).getUTCDate();
    for(let i=0;i<offset;i++){const blank=make('span','','coach-calendar-blank');blank.setAttribute('aria-hidden','true');grid.append(blank);}
    for(let day=1;day<=last;day++) {
      const date=state.month+'-'+String(day).padStart(2,'0'),count=rows.filter(row=>row.session.date===date).length;
      const b=button('',date,()=>{state.date=date;render(date);});b.className='coach-calendar-day';b.dataset.date=date;
      b.setAttribute('aria-label',format(date,{weekday:'long',month:'long',day:'numeric',year:'numeric'})+' · '+count+' session'+(count===1?'':'s'));b.setAttribute('aria-pressed',String(state.date===date));
      if(date===today())b.setAttribute('aria-current','date');b.append(make('strong',String(day)));if(count)b.append(make('span',String(count),'coach-calendar-count'));grid.append(b);
    }
    calendar.append(grid);
    const detail=make('section','','coach-calendar-detail'); detail.setAttribute('aria-live','polite');
    detail.append(make('h3',format(state.date,{weekday:'long',month:'long',day:'numeric'})));
    const selected=rows.filter(row=>row.session.date===state.date);
    for(const {session,group} of selected){const row=make('article','','coach-calendar-session'),copy=make('div');copy.append(make('strong',group.label),make('p',[session.time,session.location,session.status==='Cancelled'?'Cancelled · read only':''].filter(Boolean).join(' · '),'small'));const open=button('Open session','open-'+session.id,()=>onOpen(session.id));open.dataset.sessionId=session.id;row.append(copy,open);detail.append(row);}
    if(!selected.length)detail.append(make('p','No assigned sessions on this date.','empty-state'));calendar.append(detail);
  }
  function setDefaultView(mode) {
    if (!['grid','list','calendar'].includes(mode)) return;
    for (const state of states.values()) state.mode = mode;
    for (const {host, key, options} of [...mounts.values()]) mount(host, key, options);
  }
  window.CoachViews=Object.freeze({mount,setDefaultView});
  window.addEventListener('coach:context',event=>{const profile=event.detail?.profile,key=profile?[profile.email,profile.role,profile.sessionVersion].join(':'):'';if(key===identity)return;identity=key;states.clear();mounts.clear();document.querySelectorAll('[data-coach-views]').forEach(el=>el.remove());document.querySelectorAll('[data-coach-view]').forEach(el=>delete el.dataset.coachView);});
})();
