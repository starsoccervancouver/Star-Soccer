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
    if(!record)return 'Capacity '+T.catalog.groupCapacity+' · Count unavailable';
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
  let records=null,busy=false;
  rows.forEach(row=>{
    const count=document.createElement('span');count.className='session-capacity';count.textContent=describe(null);
    row.querySelector('.schedule-day').append(count);
  });
  const note=document.createElement('div');note.className='count-feed-note';
  const status=document.createElement('p');status.setAttribute('role','status');
  const help=document.createElement('p');help.textContent='20 players maximum per session. Counts include accepted registrations and coach-reported expected players whose contact details may still be pending. Availability is confirmed by the coaching team.';
  note.append(status,help);
  // The training list already carries a count on each session; keep it uncluttered.
  if(!rows.length)preview.after(note);
  function render() {
    rows.forEach(row=>{
      const session=T.getSession(row.dataset.sessionDay),date=session && T.nextDate(session);
      if(!date)return;
      row.querySelector('.schedule-next').textContent='Next: '+T.prettyDate(date);
      row.querySelector('.session-capacity').textContent=describe(records?.get(session.id+':'+date));
    });
    if(preview)preview.querySelectorAll('li[data-session-date]').forEach(li=>{
      let count=li.querySelector('.session-capacity');
      if(!count){count=document.createElement('span');count.className='session-capacity';li.append(count);}
      count.textContent=describe(records?.get(li.dataset.sessionId+':'+li.dataset.sessionDate));
    });
  }
  if(preview)new MutationObserver(render).observe(preview,{childList:true});
  async function update() {
    if(busy)return;
    busy=true;document.documentElement.dataset.countsState='loading';
    if(!records)status.textContent='Checking ledger counts…';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try {
      const response=await fetch(feed+'&_='+Math.floor(Date.now()/60000),{signal:controller.signal,credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error('Count feed unavailable');
      const source=await response.text();if(source.length>100000)throw new Error('Count feed too large');
      records=parse(source);
      const time=new Intl.DateTimeFormat('en-CA',{timeZone:T.catalog.zone,hour:'numeric',minute:'2-digit'}).format(new Date());
      status.textContent='Ledger counts checked at '+time+' (Vancouver). Refreshes every minute while this page is open.';
      document.documentElement.dataset.countsState='ready';
    } catch {
      records=null;
      status.textContent='Live counts are temporarily unavailable. Capacity is 20 players per session; contact us to check a place.';
      document.documentElement.dataset.countsState='unavailable';
    } finally {clearTimeout(timer);busy=false;render();}
  }
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
  setInterval(()=>{if(!document.hidden)update();},60000);
  update();
})(typeof window!=='undefined'?window:globalThis);
