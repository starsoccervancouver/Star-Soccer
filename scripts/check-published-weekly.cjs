const assert=require('node:assert/strict');
const fs=require('node:fs');
const training=require('../training.js');
const catalog=require('../program-catalog.json');
const {feed}=require('../private-attendance/weekly-offers.cjs');
assert.deepEqual(catalog,feed(training.catalog));
const page=fs.readFileSync('programs.html','utf8');
for(const row of catalog.sessions){
  const card=page.match(new RegExp('<article[^>]+data-session-day="'+row.id+'"[^>]*>[\\s\\S]*?</article>'))?.[0];
  assert(card && card.includes(row.time) && card.includes(row.venue) && card.includes('$'+row.dropin+' drop-in'),'Public program card disagrees with '+row.id);
  const session=training.getSession(row.id);
  const now=new Date(),date=training.nextDate(session,now);
  for(const option of ['dropin','pass4']){
    if(row[option]===null){assert.throws(()=>training.choice(row.id,option));continue;}
    const quote=training.booking(row.id,option,date,session.minAge??25,now);
    assert.equal(quote.price,row[option]);assert.equal(quote.location,row.venue);
    assert.equal(quote.dates.length,option==='pass4'?4:1);
  }
}
console.log('Five public cards, registration quotes, pass dates and the Search HQ feed agree.');
