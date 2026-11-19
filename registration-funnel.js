/* Anonymous integration hooks and Google Analytics for accepted registrations and coaching inquiries.
 * Form-service acceptance must never be reported as a confirmed booking. */
(function(root){
  'use strict';
  function event(name,detail={}){
    if(!['program_view','registration_start','submission_accepted'].includes(name)||!['weekly','camp','private','contact'].includes(detail.program))return null;
    const value={event:name,program:detail.program};
    if(['dropin','pass4','week','inquiry'].includes(detail.kind))value.kind=detail.kind;
    return Object.freeze(value);
  }
  if(typeof module!=='undefined'&&module.exports){module.exports={event};return;}
  const queue=[];
  function track(name,detail){
    const value=event(name,detail);
    if(!value)return;
    queue.push(value);
    if(queue.length>100)queue.shift();
    root.dispatchEvent(new CustomEvent('starsoccer:funnel',{detail:value}));
    if(value.event!=='submission_accepted')return;

    // Measurement errors must not affect the form's accepted state.
    try {
      if(value.program==='private' && value.kind==='inquiry'){
        root.gtag?.('event','private_inquiry_accepted',{send_to:'G-RP4ZF0M5LN'});
        return;
      }
      if(!['weekly','camp'].includes(value.program)||!['dropin','pass4','week'].includes(value.kind))return;
      root.gtag?.('event','registration_submission_accepted',{
        send_to:'G-RP4ZF0M5LN',program:value.program,booking_type:value.kind
      });
    } catch {}
  }
  root.StarFunnel=Object.freeze({track,events:()=>queue.slice()});
  const winterWeeks = new Map([
    ['christmas-camp-registration.html', 'christmas'],
    ['boxing-camp-registration.html', 'boxing']
  ]);
  function winterEvent(name, week) {
    try { root.gtag?.('event', name, {send_to:'G-RP4ZF0M5LN',camp_week:week}); } catch {}
  }
  function trackCampLink(event) {
    const link = event.target.closest?.('a[href]');
    if (!link) return;
    const target = new URL(link.href);
    if (target.origin !== location.origin) return;
    const week = winterWeeks.get(target.pathname.slice(1));
    if (week) winterEvent('winter_camp_signup_click', week);
  }
  function setup(){
    const file=location.pathname.split('/').pop();
    const program=({'programs.html':'weekly','registration.html':'weekly','camps.html':'camp','christmas-camp-registration.html':'camp','boxing-camp-registration.html':'camp','program-private-small-group.html':'private','contact.html':'contact'})[file];
    if(!program)return;track('program_view',{program});
    if(file==='camps.html') document.addEventListener('click',trackCampLink);
    const form=document.querySelector('#training-registration,#camp-registration,#private-inquiry,form[data-inquiry]');if(!form)return;
    let started=false;const start=()=>{if(!started){started=true;track('registration_start',{program});
      const week=winterWeeks.get(file);
      if(week) winterEvent('winter_camp_form_start',week);}};
    form.addEventListener('input',start);form.addEventListener('change',start);form.addEventListener('submit',start);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})(typeof window!=='undefined'?window:globalThis);
