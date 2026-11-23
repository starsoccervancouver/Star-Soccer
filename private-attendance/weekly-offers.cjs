// Validate the four mutable public terms for the five approved weekly programs.
const {createHash} = require('node:crypto');
const rowsById = new Map(Object.entries({
  rec2dr5blWfbUeKRJ:'friday', recBRLXGi3g2PQoYH:'wednesday', recNjQKMyCzF9ZEht:'thursday',
  recOz7gTPK1ktkwYE:'tuesday', recn6TfY6xqogcjjZ:'sunday'
}));
function minutes(hour, minute, period) {
  if (+hour<1 || +hour>12 || +minute>59) throw Error('Invalid weekly program time');
  return (+hour%12)*60 + +minute + (period.toUpperCase()==='PM'?720:0);
}
function timeRange(value) {
  const match=/^(\d{1,2}):(\d{2})\s*(AM|PM)?\s*[–-]\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(value).replaceAll('.','').trim());
  if (!match) throw Error('Invalid weekly program time');
  const start=minutes(match[1],match[2],match[3]||match[6]), end=minutes(match[4],match[5],match[6]);
  if(end<=start) throw Error('Invalid weekly program duration');
  const clock=n=>(Math.floor(n/60)%12||12)+':'+String(n%60).padStart(2,'0');
  return {startMinutes:start,endMinutes:end,time:clock(start)+(start<720&&end>=720?' AM':'')+'–'+clock(end)+(end<720?' AM':' PM')};
}
function price(value) {
  if (!Number.isFinite(value)||value<=0||!Number.isSafeInteger(Math.round(value*100))||Math.abs(value*100-Math.round(value*100))>1e-7) throw Error('Invalid weekly program price');
  return value;
}
function applyOffers(baseline, rows) {
  if(!Array.isArray(rows)||rows.length!==baseline.sessions.length||new Set(rows.map(row=>row.id)).size!==rows.length) throw Error('Incomplete weekly catalog');
  const catalog=structuredClone(baseline);
  for(const session of catalog.sessions) {
    const row=rows.find(r=>r.id===session.id);
    if(!row||!Number.isInteger(row.capacity)||row.capacity<1||row.capacity>catalog.groupCapacity) throw Error('Invalid weekly capacity');
    const location=Object.keys(catalog.locations).find(id=>catalog.locations[id].name===row.venue);
    if(!location)throw Error('Unknown weekly venue');
    if((row.pass4===null)!==(session.pass4===null))throw Error('A change to pass availability needs review');
    Object.assign(session,timeRange(row.time),{location,capacity:row.capacity,dropin:price(row.dropin),pass4:row.pass4===null?null:price(row.pass4)});
  }
  delete catalog.version;
  catalog.version=createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
  return catalog;
}
function fromLedger(baseline, records) {
  const rows=records.map(({id,fields})=>{
    const session=baseline.sessions.find(s=>s.id===rowsById.get(id));
    if(!session||fields.Day!==session.day||fields.Program!==session.program)throw Error('Weekly program identity changed');
    return {id:session.id,time:fields.Time,venue:fields.Venue==='Fen Burdett Stadium, North Vancouver'?'Fen Burdett Stadium':fields.Venue,
      capacity:fields.Capacity,dropin:fields['Drop-in CAD'],pass4:fields['Four dates CAD']??null};
  });
  return applyOffers(baseline,rows);
}
function feed(catalog){
  return {version:catalog.version,zone:catalog.zone,sessions:catalog.sessions.map(s=>({id:s.id,program:s.program,day:s.day,time:s.time,venue:catalog.locations[s.location].name,capacity:s.capacity,dropin:s.dropin,pass4:s.pass4}))};
}
module.exports={applyOffers,fromLedger,feed,timeRange};
