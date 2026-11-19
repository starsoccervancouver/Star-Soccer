/* Only validated campaign tags and a recognized public entry path are retained. */
(function(root) {
  'use strict';
  const storageKey='star-soccer-campaign-v1',maxAge=24*60*60*1000;
  const fields=Object.freeze({utm_source:'Campaign source (URL tag)',utm_medium:'Campaign medium (URL tag)',utm_campaign:'Campaign name (URL tag)'});
  const keys=Object.keys(fields);
  const slug=value=>typeof value==='string' && /^[A-Za-z0-9_-]{1,60}$/.test(value)?value:null;
  function cleanValues(value) {
    if(!value || typeof value!=='object' || Array.isArray(value))return null;
    const present=Object.keys(value);
    if(!present.length || present.some(key=>!keys.includes(key) || !slug(value[key])))return null;
    return Object.freeze(Object.fromEntries(present.map(key=>[key,value[key]])));
  }
  function parseSearch(search) {
    const params=new URLSearchParams(search),values={};
    let present=false;
    for(const key of keys) {
      const entries=params.getAll(key);
      if(!entries.length)continue;
      present=true;
      // Reject the whole incoming group, including duplicate or empty tags.
      if(entries.length!==1 || !slug(entries[0]))return {present:true,values:null};
      values[key]=entries[0];
    }
    return {present,values:present?Object.freeze(values):null};
  }
  function validRecord(record,now) {
    if(!record || typeof record!=='object' || Array.isArray(record) || Object.keys(record).sort().join(',')!=='capturedAt,values,version')return null;
    if(record.version!==1 || !Number.isSafeInteger(record.capturedAt) || record.capturedAt<0 || !Number.isFinite(now) || now-record.capturedAt<0 || now-record.capturedAt>=maxAge)return null;
    const values=cleanValues(record.values);
    return values?{version:1,capturedAt:record.capturedAt,values}:null;
  }
  function readStored(raw,now) {
    if(typeof raw!=='string' || raw.length>1000)return null;
    try{return validRecord(JSON.parse(raw),now);}catch{return null;}
  }
  function append(data,values) {
    const clean=cleanValues(values);
    // Own only these three metadata fields; referral and all form entries stay independent.
    for(const key of keys) {
      if(clean && Object.hasOwn(clean,key))data.set(fields[key],clean[key]);
      else data.delete(fields[key]);
    }
    return data;
  }
  function create(search,storage,clock=Date.now) {
    const incoming=parseSearch(search),now=clock();
    let record=null;
    const clear=()=>{try{storage?.removeItem(storageKey);}catch{/* Forms work without storage. */}};
    if(incoming.present) {
      // Remove the previous group first so a denied write cannot leave mixed/stale tags.
      clear();
      if(incoming.values) {
        record=validRecord({version:1,capturedAt:now,values:incoming.values},now);
        try{if(record)storage?.setItem(storageKey,JSON.stringify(record));}catch{/* Keep only this document's explicit tags. */}
      }
    } else {
      try {
        const raw=storage?.getItem(storageKey);
        record=readStored(raw,now);
        if(raw && !record)clear();
      } catch {/* Storage denial means no carried attribution. */}
    }
    return Object.freeze({append(data) {
      const current=validRecord(record,clock());
      if(record && !current){record=null;clear();}
      return append(data,current?.values);
    }});
  }
  const api=Object.freeze({slug,parseSearch,readStored,append,create,storageKey,maxAge,fields});
  if(typeof module!=='undefined' && module.exports){module.exports=api;return;}
  let storage;
  try{storage=root.sessionStorage;}catch{/* The getter can also be denied. */}
  const campaign=create(root.location.search,storage);
  const landingKey='star-soccer-landing-v1';
  const publicPaths=new Set([
    '/', '/index.html', '/programs.html', '/camps.html', '/coach.html',
    '/contact.html', '/locations.html', '/methodology.html', '/privacy.html',
    '/registration.html', '/pro-d-camp-registration.html', '/selectivo.html',
    '/boxing-camp-registration.html', '/christmas-camp-registration.html',
    '/program-private-small-group.html'
  ]);
  function readLanding(now) {
    try {
      const raw=storage?.getItem(landingKey);
      if(raw) {
        const record=JSON.parse(raw);
        if(Number.isSafeInteger(record?.time) && record.time<=now && now-record.time<maxAge)
          return record;
      }
      const pathname=root.location.pathname;
      const record={path:publicPaths.has(pathname)?pathname:null,time:now};
      storage?.setItem(landingKey,JSON.stringify(record));
      return storage?record:null;
    } catch { return null; }
  }
  const landing=readLanding(Date.now());
  root.StarCampaignSource=Object.freeze({append(data) {
    campaign.append(data);
    const age=landing?Date.now()-landing.time:maxAge;
    if(landing && age>=0 && age<maxAge && publicPaths.has(landing.path))
      data.set('Landing page path',landing.path);
    else data.delete('Landing page path');
    return data;
  }});
})(typeof window!=='undefined'?window:globalThis);
