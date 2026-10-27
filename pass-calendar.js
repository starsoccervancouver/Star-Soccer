/* Progressive enhancement: the native date field remains a fallback. No booking is made here. */
(()=>{
  'use strict';
  window.StarPassCalendar=(input,session)=>{
    const T=window.StarTraining,W=window.StarWeeklySignup;
    if(!T||!W||typeof HTMLDialogElement==='undefined'||!HTMLDialogElement.prototype.showModal)return null;
    const make=(tag,cls,text)=>{const el=document.createElement(tag);if(cls)el.className=cls;if(text)el.textContent=text;return el;};
    const button=(cls,text,label)=>{const el=make('button',cls,text);el.type='button';if(label)el.setAttribute('aria-label',label);return el;};
    const firstOf=date=>date.slice(0,7)+'-01';
    const offsetMonth=(date,amount)=>{const d=T.isoDate(firstOf(date));d.setUTCMonth(d.getUTCMonth()+amount);return d.toISOString().slice(0,10);};
    const eligible=date=>{try{W.passPlan(session.id,date);return true;}catch{return false;}};
    const fullDate=date=>new Intl.DateTimeFormat('en-CA',{weekday:'long',month:'long',day:'numeric',year:'numeric',timeZone:'UTC'}).format(T.isoDate(date));
    const trigger=button('pass-calendar-trigger','','Change pass start date');
    trigger.id='pass-calendar-trigger';trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-controls','pass-calendar');trigger.setAttribute('aria-expanded','false');
    const label=make('span'),icon=make('span','pass-calendar-icon');icon.setAttribute('aria-hidden','true');
    icon.innerHTML='<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h2m3 0h2m3 0h1m-11 3h2m3 0h2"/></svg>';
    trigger.append(label,icon);
    const dialog=make('dialog','pass-calendar');dialog.id='pass-calendar';dialog.setAttribute('aria-labelledby','pass-calendar-title');dialog.setAttribute('aria-describedby','pass-calendar-help');
    const head=make('div','pass-calendar-head'),copy=make('div'),eyebrow=make('p','pass-calendar-eyebrow','Four-session pass'),title=make('h2',null,'Choose your start date');title.id='pass-calendar-title';
    const close=button('pass-calendar-close','×','Close calendar');copy.append(eyebrow,title);head.append(copy,close);
    const help=make('p','pass-calendar-help',session.day+' training · Vancouver time. Choose a highlighted date.');help.id='pass-calendar-help';
    const nav=make('div','pass-calendar-nav'),prev=button('pass-calendar-arrow','‹','Previous month'),next=button('pass-calendar-arrow','›','Next month'),monthTitle=make('h3');monthTitle.id='pass-calendar-month';monthTitle.setAttribute('aria-live','polite');nav.append(prev,monthTitle,next);
    const grid=make('div','pass-calendar-grid');grid.setAttribute('role','grid');grid.setAttribute('aria-labelledby',monthTitle.id);
    const foot=make('div','pass-calendar-footer'),upcoming=button('pass-calendar-upcoming','Use next session'),cancel=button('pass-calendar-cancel','Cancel');foot.append(upcoming,cancel);
    dialog.append(head,help,nav,grid,foot);document.body.append(dialog);input.after(trigger);input.hidden=true;
    let month=firstOf(input.value),focusDate=input.value;
    const sync=()=>{label.textContent=T.prettyDate(input.value);trigger.setAttribute('aria-label','Change pass start date: '+label.textContent);};
    function render(focus=false){
      monthTitle.textContent=new Intl.DateTimeFormat('en-CA',{month:'long',year:'numeric',timeZone:'UTC'}).format(T.isoDate(month));
      prev.disabled=month<=firstOf(T.nextDate(session));grid.replaceChildren();
      const heading=make('div','pass-calendar-week');heading.setAttribute('role','row');
      ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].forEach(day=>{const el=make('span',null,day);el.setAttribute('role','columnheader');heading.append(el);});grid.append(heading);
      const start=T.addDays(month,-T.isoDate(month).getUTCDay()),today=T.localClock().date;
      const days=Array.from({length:42},(_,i)=>T.addDays(start,i));
      const valid=days.filter(date=>date.slice(0,7)===month.slice(0,7)&&eligible(date));
      if(!valid.includes(focusDate))focusDate=valid.includes(input.value)?input.value:valid[0];
      for(let week=0;week<6;week++){
        const row=make('div','pass-calendar-week');row.setAttribute('role','row');
        for(const date of days.slice(week*7,week*7+7)){
          const cell=make('span','pass-calendar-cell');cell.setAttribute('role','gridcell');
          if(date.slice(0,7)!==month.slice(0,7)){cell.setAttribute('aria-disabled','true');row.append(cell);continue;}
          const day=button('pass-calendar-day',String(T.isoDate(date).getUTCDate()),fullDate(date));day.dataset.date=date;day.disabled=!valid.includes(date);day.tabIndex=date===focusDate?0:-1;
          if(date===input.value){cell.setAttribute('aria-selected','true');day.classList.add('is-selected');}
          if(date===today)day.setAttribute('aria-current','date');
          day.addEventListener('click',()=>select(date));cell.append(day);row.append(cell);
        }
        grid.append(row);
      }
      if(focus){const target=grid.querySelector('[tabindex="0"]');(target||next).focus();}
    }
    function select(date){
      if(!eligible(date)){render(true);return;}
      input.value=date;input.dispatchEvent(new Event('change',{bubbles:true}));sync();dialog.close();
    }
    function moveMonth(amount){month=offsetMonth(month,amount);render(true);}
    trigger.addEventListener('click',()=>{month=firstOf(eligible(input.value)?input.value:T.nextDate(session));focusDate=input.value;render();dialog.showModal();trigger.setAttribute('aria-expanded','true');(grid.querySelector('[tabindex="0"]')||close).focus();});
    close.addEventListener('click',()=>dialog.close());cancel.addEventListener('click',()=>dialog.close());upcoming.addEventListener('click',()=>select(T.nextDate(session)));
    dialog.addEventListener('close',()=>{trigger.setAttribute('aria-expanded','false');trigger.focus();});
    dialog.addEventListener('cancel',event=>{event.preventDefault();dialog.close();});
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();});
    prev.addEventListener('click',()=>moveMonth(-1));next.addEventListener('click',()=>moveMonth(1));
    grid.addEventListener('keydown',event=>{
      const date=event.target.dataset.date;if(!date)return;
      const direction={ArrowLeft:-1,ArrowUp:-1,ArrowRight:1,ArrowDown:1}[event.key];
      if(direction){
        event.preventDefault();let candidate=date;
        for(let i=0;i<104;i++){candidate=T.addDays(candidate,direction*7);if(candidate<T.nextDate(session))return;if(eligible(candidate)){focusDate=candidate;month=firstOf(candidate);render(true);return;}}
      }else if(event.key==='Home'||event.key==='End'){
        event.preventDefault();const dates=[...grid.querySelectorAll('button:not(:disabled)')];const target=event.key==='Home'?dates[0]:dates.at(-1);if(target){focusDate=target.dataset.date;render(true);}
      }else if(event.key==='PageUp'||event.key==='PageDown'){
        event.preventDefault();if(event.key==='PageUp'&&prev.disabled)return;moveMonth(event.key==='PageUp'?-1:1);
      }
    });
    input.addEventListener('change',sync);sync();return {sync};
  };
})();
