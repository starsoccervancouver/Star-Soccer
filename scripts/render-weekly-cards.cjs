function programPage(catalog,html) {
  const seen=new Set();
  const result=html.replace(/<article\b[^>]*\bdata-session-day="([^"]+)"[^>]*>[\s\S]*?<\/article>/g,(original,id)=>{
    const s=catalog.sessions.find(s=>s.id===id);
    if(!s||seen.has(id))throw Error('Unknown program card');
    seen.add(id);
    const esc=v=>String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
    const location=catalog.locations[s.location];
    const directions=s.coaches.map(k=>catalog.coaches[k]).join(' & ');
    const headingId=id==='tuesday'?'':' id="session-'+id+'-title"';
    const attendanceNote=original.match(/Up to \d+ players expected this week · /)?.[0] || '';
    const card='<div class="schedule-entry-main"><span class="schedule-day"><strong'+headingId+'>'+s.day+'</strong><span>'+s.time+'</span></span>'+
      '<span class="schedule-detail"><strong>'+esc(s.ageLabel||('Ages '+s.minAge+'–'+s.maxAge))+' · '+esc(location.name)+'</strong><span>'+esc(directions)+'</span></span>'+
      '<span class="schedule-price"><strong>$'+s.dropin+' drop-in</strong><span>'+(s.pass4===null?attendanceNote+s.capacity+' maximum':'$'+s.pass4+' · 4 consecutive sessions')+'</span>'+
      (s.pass4!==null && s.dropin*4>s.pass4?'<span data-pass-value>Save $'+(s.dropin*4-s.pass4)+' vs 4 drop-ins</span>':'')+'</span></div>';
    const section=/<div class="schedule-entry-main">[\s\S]*?<\/div>/;
    if(!section.test(original))throw Error('Program card structure changed');
    let out=original.replace(section,()=>card).replace(/data-session-location="[^"]+"/,'data-session-location="'+s.location+'"');
    if(s.maxAge!=null)out=out.replace(/data-min-age="\d+"/,'data-min-age="'+s.minAge+'"').replace(/data-max-age="\d+"/,'data-max-age="'+s.maxAge+'"');
    if((s.pass4!==null)!==out.includes('type=pass4'))throw Error('Review booking links for '+s.day);
    return out;
  });
  if(seen.size!==catalog.sessions.length)throw Error('Program cards incomplete');
  return result;
}
module.exports=programPage;
