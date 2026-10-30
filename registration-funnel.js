/* Anonymous integration hooks: no network, cookies or persistent storage.
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
  function track(name,detail){const value=event(name,detail);if(!value)return;queue.push(value);if(queue.length>100)queue.shift();root.dispatchEvent(new CustomEvent('starsoccer:funnel',{detail:value}));}
  root.StarFunnel=Object.freeze({track,events:()=>queue.slice()});
  function setup(){
    const file=location.pathname.split('/').pop();
    const program=({'programs.html':'weekly','registration.html':'weekly','camps.html':'camp','christmas-camp-registration.html':'camp','boxing-camp-registration.html':'camp','program-private-small-group.html':'private','contact.html':'contact'})[file];
    if(!program)return;track('program_view',{program});
    const form=document.querySelector('#training-registration,#camp-registration,#private-inquiry,form[data-inquiry]');if(!form)return;
    let started=false;const start=()=>{if(!started){started=true;track('registration_start',{program});}};
    form.addEventListener('input',start);form.addEventListener('change',start);form.addEventListener('submit',start);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup,{once:true});else setup();
})(typeof window!=='undefined'?window:globalThis);
