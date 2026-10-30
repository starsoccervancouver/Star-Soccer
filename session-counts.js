/* Public aggregate workbook only. Never point this at the private operating ledger.
 * Counts are informational; form acceptance does not atomically reserve a place.
 */
(function(root) {
  'use strict';
  const T=typeof module!=='undefined' && module.exports ? require('./training.js') : root.StarTraining;
  const feed='https://docs.google.com/spreadsheets/d/1xnSKoG20G9P-OcESiUv71IPOSYdEGfU6CLm38xcnSmA/gviz/tq?gid=1408406597&range=A5%3AF155&headers=1&tqx=out%3Ajson';
  const labels=['Date','Group','Players','Capacity','Places remaining','Session status'];
  // The export reconciles unique registrations and owner-reported totals in
  // Airtable. No hardcoded player counts can override later RSVP changes.
  function parse(source) {
    // Parse the known Google response envelope as data; never execute remote code.
    const match=source.match(/^\s*(?:\/\*O_o\*\/\s*)?google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
    if(!match)throw new Error('Invalid count response');
    const data=JSON.parse(match[1]);
    if(data.status!=='ok' || !Array.isArray(data.table?.cols) || !Array.isArray(data.table.rows) || data.table.cols.length!==6 || data.table.cols.some((c,i)=>c.label!==labels[i]))throw new Error('Invalid count columns');
    const records=new Map();
    for(const row of data.table.rows) {
      const cells=row.c?.map(c=>c?.v ?? null);
      if(!cells || cells.every(v=>v===null || v===''))continue;
      const [date,group,players,capacity,remaining,status]=cells;
      const session=T.getSession(group),day=T.isoDate(date);
      if(cells.length!==6 || !session || !day || day.getUTCDay()!==session.weekday || !Number.isSafeInteger(players) || players<0 || capacity!==T.catalog.groupCapacity || !Number.isSafeInteger(remaining) || remaining!==(status==='Cancelled'?0:Math.max(0,capacity-players)) || !['Planning','Scheduled','Cancelled','Completed'].includes(status))throw new Error('Invalid session count');
      const key=group+':'+date;
      if(records.has(key))throw new Error('Duplicate dated session');
      records.set(key,Object.freeze({date,group,players,capacity,remaining,status}));
    }
    if(!records.size)throw new Error('No session counts');
    return records;
  }
  function describe(record) {
    if(!record)return 'Contact us for availability';
    const count=record.players+'/'+record.capacity+' players';
    if(record.status==='Cancelled')return count+' · Cancelled';
    if(record.status==='Completed')return count+' · Completed';
    if(record.players>record.capacity)return count+' · Over capacity — contact us';
    if(record.remaining===0)return count+' · Full — contact us';
    return count+' · '+record.remaining+' places remaining';
  }
  const api={parse,describe,feed};
  if(typeof module!=='undefined' && module.exports) {module.exports=api;return;}
  root.StarSessionCounts=api;
  // Only youth groups use the public youth booking feed. The adult estimate remains coach-reported.
  const rows=[...document.querySelectorAll('.schedule-entry[data-session-day]:not([data-audience="adult"])')],preview=document.querySelector('#booking-dates');
  if(!T || (!rows.length && !preview))return;
  let records=null,busy=false,checkedAt='';
  function renderCount(element,record,session,date) {
    element.replaceChildren();
    const message=describe(record);
    if(!record || record.remaining===0 || record.players>record.capacity || record.status==='Cancelled') {
      const link=document.createElement('a');
      link.href='mailto:'+T.catalog.email+'?subject='+encodeURIComponent('Availability for '+session.day+' training · '+date);
      link.textContent=message;
      link.setAttribute('aria-label',message+' — '+session.day+' '+T.prettyDate(date));
      element.append(link);
    } else element.textContent=message;
  }
  rows.forEach(row=>{
    const count=document.createElement('span');count.className='session-capacity';count.textContent='Checking availability…';
    row.querySelector('.schedule-day').append(count);
  });
  const note=document.createElement('div');note.className='count-feed-note';
  const status=document.createElement('p');status.setAttribute('role','status');
  const help=document.createElement('p');help.textContent='20 players maximum per youth session. Counts may take time to update; the coaching team confirms your place.';
  note.append(status,help);
  if(rows.length)rows[0].closest('.schedule-list')?.after(note);
  else (document.querySelector('#training-registration .quick-assurance')||preview).after(note);
  function render() {
    let missing=false;
    rows.forEach(row=>{
      const session=T.getSession(row.dataset.sessionDay),date=session && T.nextDate(session);
      if(!date)return;
      const next=row.querySelector('.schedule-next');
      if(next)next.textContent='Next: '+T.prettyDate(date);
      const record=records?.get(session.id+':'+date);
      if(!record)missing=true;
      renderCount(row.querySelector('.session-capacity'),record,session,date);
    });
    if(preview)preview.querySelectorAll('li[data-session-date]').forEach(li=>{
      const session=T.getSession(li.dataset.sessionId),date=li.dataset.sessionDate;
      if(!session || !T.isoDate(date))return;
      let count=li.querySelector('.session-capacity');
      if(!count){count=document.createElement('span');count.className='session-capacity';li.append(count);}
      const record=records?.get(session.id+':'+date);
      if(!record)missing=true;
      renderCount(count,record,session,date);
    });
    if(records)status.textContent='Availability checked at '+checkedAt+' (Vancouver).'+(missing?' Counts are not available for every displayed date.':'')+' Refreshes every minute.';
  }
  if(preview)new MutationObserver(render).observe(preview,{childList:true});
  async function update() {
    if(busy)return;
    busy=true;document.documentElement.dataset.countsState='loading';
    if(!records)status.textContent='Checking availability…';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch(feed+'&_='+Math.floor(Date.now()/60000),{signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error('Count feed unavailable');
      const source=await response.text();if(source.length>100000)throw new Error('Count feed too large');
      records=parse(source);
      checkedAt=new Intl.DateTimeFormat('en-CA',{timeZone:T.catalog.zone,hour:'numeric',minute:'2-digit'}).format(new Date());
      document.documentElement.dataset.countsState='ready';
    } catch {
      records=null;
      status.textContent='Live availability is temporarily unavailable. Contact us to check a place.';
      document.documentElement.dataset.countsState='unavailable';
    } finally {clearTimeout(timer);busy=false;render();}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
  setInterval(()=>{if(!document.hidden)update();},60000);
  update();
})(typeof window!=='undefined'?window:globalThis);
