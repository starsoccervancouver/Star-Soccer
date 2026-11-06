/* Formspree transport; acceptance never means a place or email delivery is confirmed. */
(function(root){
  'use strict';
  function endpoint(form){
    const value=String(form?.action||'');
    if(!/^https:\/\/formspree\.io\/f\/[a-z0-9]+$/i.test(value))throw new Error('Online submission is not configured. Please email the coaching team using the details below.');
    return value;
  }
  function payload(source){
    const data=new FormData();
    for(const [name,value] of source.entries())if(!name.startsWith('_')&&name!=='email'&&name!=='subject')data.append(name,value);
    // The browser's signed-in account never supplies a sender or recipient here.
    data.set('email',String(source.get('email')||'').trim());
    data.set('subject',String(source.get('_subject')||source.get('subject')||'Star Soccer website request').replace(/[\r\n]/g,' ').slice(0,200));
    data.set('_gotcha',String(source.get('_honey')||''));
    if(source.get('_url'))data.set('Submission page',String(source.get('_url')));
    return data;
  }
  function normalize(response,value){
    const object=value&&typeof value==='object'&&!Array.isArray(value);
    const errors=object&&(typeof value.error==='string'||Array.isArray(value.errors)&&value.errors.length>0);
    // Formspree's official core client recognizes success by its `next` string.
    // Never navigate to it: retain the site's own receipt and registration rules.
    if(response.ok&&object&&!errors&&typeof value.next==='string')return {success:true};
    const definitive=errors&&(response.ok||response.status>=400&&response.status<500&&response.status!==408);
    return {success:definitive?false:null};
  }
  async function submit(form,source,{signal}={}){
    const response=await root.fetch(endpoint(form),{method:'POST',body:payload(source),headers:{Accept:'application/json'},credentials:'omit',redirect:'error',signal});
    let value;try{value=await response.json();}catch{throw new Error('The submission service returned an unexpected response. Your submission is not confirmed.');}
    return {response,body:normalize(response,value)};
  }
  const api=Object.freeze({endpoint,payload,normalize,submit});root.StarFormService=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
