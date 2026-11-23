// Called in the disposable Pages build checkout, before staging the public artifact.
const fs=require('node:fs');
const {applyOffers,feed}=require('../private-attendance/weekly-offers.cjs');
const programPage=require('./render-weekly-cards.cjs');
const training=require('../training.js');
const endpoint='https://starsoccer.ca/coachdesk/api/catalog-preview';
const escape=text=>String(text).replaceAll('&','&amp;').replaceAll('<','&lt;');
const cash=training.money;

function range(values){
  const minimum=Math.min(...values),maximum=Math.max(...values);
  return minimum===maximum?cash(minimum):cash(minimum)+'–'+cash(maximum);
}
function sidebarPrices(html,oldCatalog,next) {
  const ranges=c=>['dropin','pass4'].map(k=>range(c.sessions.filter(s=>s.audience!=='women').map(s=>s[k])));
  const [oldDrop,oldPass]=ranges(oldCatalog),[nextDrop,nextPass]=ranges(next);
  const was=oldCatalog.sessions.find(s=>s.id==='tuesday'),now=next.sessions.find(s=>s.id==='tuesday');
  const venueNames=c=>[...new Set(c.sessions.filter(s=>s.audience!=='women').map(s=>c.locations[s.location].name))];
  const list=new Intl.ListFormat('en-CA',{type:'conjunction'});
  const venueLink=(c,id)=>'<a href="locations.html#'+id+'">'+escape(c.locations[id].name)+'</a>';
  const linked=(c,type)=>new Intl.ListFormat('en-CA',{type}).format([...new Set(c.sessions.filter(s=>s.audience!=='women').map(s=>s.location))].map(id=>venueLink(c,id)));
  const subs=[[oldDrop,nextDrop],[oldPass,nextPass],[cash(was.dropin)+' per session',cash(now.dropin)+' per session'],
    [cash(was.dropin)+' per drop-in',cash(now.dropin)+' per drop-in'],
    ['Beginners welcome at '+list.format(venueNames(oldCatalog)),'Beginners welcome at '+list.format(venueNames(next))],
    ['Our weekly groups train at '+list.format(venueNames(oldCatalog)),'Our weekly groups train at '+list.format(venueNames(next))],
    ['Choose a group by age and day at '+linked(oldCatalog,'disjunction'),'Choose a group by age and day at '+linked(next,'disjunction')],
    ['Youth weekly sessions use '+linked(oldCatalog,'conjunction')+'; Tuesday women’s soccer runs at '+venueLink(oldCatalog,was.location),'Youth weekly sessions use '+linked(next,'conjunction')+'; Tuesday women’s soccer runs at '+venueLink(next,now.location)],
    ['Tuesdays, '+was.time+' at '+oldCatalog.locations[was.location].name,'Tuesdays, '+now.time+' at '+next.locations[now.location].name]];
  const substitutions=new Map(subs);
  const pattern=Array.from(substitutions.keys(),s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|');
  return html.replace(new RegExp(pattern,'g'),match=>substitutions.get(match));
}
function artifacts(value,read=name=>fs.readFileSync(name,'utf8')) {
  const previous=training.catalog,catalog=applyOffers(previous,value.sessions);
  const normalized=feed(catalog);
  if(value.zone!==normalized.zone || value.version!==normalized.version ||
     JSON.stringify(value.sessions)!==JSON.stringify(normalized.sessions))throw Error('The released catalog and the validated source must agree');
  const source=read('training.js'),start=source.indexOf('  const catalog = '),end=source.indexOf('  function freeze(',start);
  if(start<0||end<start)throw Error('Training module changed');
  const tuesday=catalog.sessions.find(s=>s.id==='tuesday');
  const weekly=programPage(catalog,read('programs.html')).replace(/currently has (\d+) of \d+ players \(coach-reported\)/,(text,count)=>Number(count)<=tuesday.capacity?'currently has '+count+' of '+tuesday.capacity+' players (coach-reported)':'has a capacity of '+tuesday.capacity+' players');
  const venues=new Set();
  const locations=read('locations.html').replace(/<section\b[^>]*\bid="(connaught|kits|fen-burdett)"[^>]*>[\s\S]*?<\/section>/g,(section,key)=>{
    venues.add(key);
    const list=catalog.sessions.filter(s=>s.location===key).map(s=>{
      const coach=s.coaches.map(c=>escape(catalog.coaches[c])).join(' &amp; ');
      return '<li><strong>'+s.day+' '+s.time+'</strong> · '+escape(training.ageDescription(s))+' · '+
        (s.audience==='women'?cash(s.dropin)+' per session · Coach: ':'')+coach+'</li>';
    }).join('');
    const pattern=/<ul class="venue-sessions">[\s\S]*?<\/ul>/;
    if(!pattern.test(section))throw Error('Venue schedule layout changed');
    let result=section.replace(pattern,()=>'<ul class="venue-sessions">'+list+'</ul>');
    if(previous.sessions.some(s=>(s.location===key)!==(catalog.sessions.find(n=>n.id===s.id).location===key))){
      result=result.replace(/<a class="button" href="(?:programs|registration)\.html[^"]*">[^<]*<\/a>/,
        '<a class="button" href="programs.html#sessions">See weekly training sessions</a>');
    }
    return result;
  });
  if(venues.size!==3)throw Error('Public venue schedule is incomplete');
  return {'training.js':source.slice(0,start)+'  const catalog = '+JSON.stringify(catalog,null,2)+';\n'+source.slice(end),
    'programs.html':sidebarPrices(weekly,previous,catalog),'index.html':sidebarPrices(read('index.html'),previous,catalog),
    'locations.html':locations,'program-catalog.json':JSON.stringify(normalized,null,2)};
}
async function loadPreview() {
  const idURL=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if(idURL.protocol!=='https:')throw Error('GitHub release identity unavailable');
  idURL.searchParams.set('audience',endpoint);
  const get=async(url,token)=>{
    const response=await fetch(url,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Weekly publication stopped, HTTP '+response.status+' from '+new URL(url).hostname);
    return response.json();
  };
  const identity=await get(idURL,process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
  if(!identity.value)throw Error('Missing release identity');
  return get(endpoint,identity.value);
}
module.exports={artifacts};
if(require.main===module)(async()=>{
  const files=artifacts(await loadPreview());
  for(const [name,contents] of Object.entries(files))fs.writeFileSync(name,contents);
  console.log('Validated and rendered five weekly programs for this Pages build.');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
