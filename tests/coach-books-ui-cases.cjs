const assert = require('node:assert/strict');
const {openDestination} = require('./coach-fixture-navigation.cjs');
const recordId = n => 'rec'+String(n).padStart(14,'0');

// These rows are the browser contract for an already reconciled ledger.
const due = {
  playerId:recordId(101),familyId:recordId(51),familyName:'Avery Fictional',
  bookingId:recordId(201),sessionId:recordId(301),attendanceId:recordId(401),
  sessionGroupKey:'friday-pm',sessionGroupLabel:'Friday after-school training',
  bookingUrl:'https://airtable.com/app00000000000001/tbl00000000000002/'+recordId(201),
  scope:'session', playerName:'Taylor Fictional', sessionLabel:'Friday after-school training',
  date:'2026-10-23', time:'3:45 PM', location:'Fictional west training field',
  bookingType:'Drop-in', attendanceStatus:'Present', status:'due', amountCharged:42, amountPaid:10.50, amountDue:31.50,amountOutstanding:31.50,amountUpcoming:0,
  contact:{guardian:'Avery Fictional',email:'sample.household.with.a.long.address@example.test',phone:'604-555-0132'}
};
const paid = {...due, playerId:recordId(102),bookingId:recordId(202),attendanceId:recordId(402),playerName:'Robin Fictional', status:'paid', amountPaid:42, amountDue:0,amountOutstanding:0,contact:null};
const review = {...due,scope:'booking', playerId:recordId(103),playerName:'Casey Fictional', bookingType:'Winter camp',
  familyId:null,familyName:null,bookingId:recordId(203),attendanceId:null,sessionId:null,
  sessionGroupKey:'winter-1',sessionGroupLabel:'Winter camp Week 1',sessionLabel:'Unplaced booking',
  status:'review', amountCharged:null, amountPaid:null, amountDue:null,amountOutstanding:null,amountUpcoming:null,reviewBalance:null,contact:null};
const books = [due,paid,review];
const siblingPackage = {...due,scope:'booking',bookingId:recordId(204),attendanceId:null,sessionId:null,
  playerId:recordId(104),playerName:'Jordan Fictional',sessionGroupKey:'winter-1',sessionGroupLabel:'Winter camp Week 1',
  sessionLabel:'Winter camp Week 1',bookingType:'Winter week',date:'2026-12-21',coveredDates:['2026-12-21','2026-12-22'],
  amountCharged:125.25,amountPaid:30,amountDue:0,amountUpcoming:95.25,amountOutstanding:95.25,status:'package'};
const otherParent = {...due,bookingId:recordId(205),attendanceId:recordId(405),sessionId:recordId(305),
  playerId:recordId(105),playerName:'Morgan Fictional',familyId:recordId(52),date:'2026-10-16',
  amountCharged:25,amountPaid:.5,amountDue:24.50,amountOutstanding:24.50,
  contact:{guardian:due.contact.guardian,email:'different.household@example.test',phone:null}};
const noParent = {...due,bookingId:recordId(206),attendanceId:recordId(406),sessionId:recordId(306),
  playerId:recordId(106),playerName:'Sam Example',familyId:null,familyName:null,contact:null,
  sessionGroupKey:'sun-am',sessionGroupLabel:'Sunday 9 AM',sessionLabel:'Sunday 9 AM',
  status:'upcoming',date:'2026-11-01',time:'9 AM',amountCharged:15,amountPaid:0,amountDue:0,amountOutstanding:15,amountUpcoming:15};
const unresolved = {...review,bookingId:recordId(207),playerId:recordId(107),playerName:noParent.playerName,
  bookingType:'Pro-D camp',sessionGroupKey:'pro-d',sessionGroupLabel:'Pro-D camp',sessionLabel:'Pro-D camp',reviewBalance:11.25};
const receiptReview = {scope:'family',status:'review',bookingId:null,playerId:null,sessionId:null,date:null,
  familyId:otherParent.familyId,familyName:otherParent.familyName,contact:otherParent.contact,
  sessionGroupKey:'payment-review',sessionGroupLabel:'Family payment reviews',reviewReason:'Verified receipt awaits booking allocation.',
  amountUnapplied:19.75,amountCharged:null,amountPaid:null,amountOutstanding:null,amountDue:null,amountUpcoming:null};
const allBooks = [due,paid,siblingPackage,otherParent,noParent,review,unresolved,receiptReview];
const reads = fixture => fixture.requests.filter(request=>request.path.endsWith('/session-books'));

async function checkWholeLedger(page) {
  for(const [id,amount] of [['outstanding','$166.25'],['due','$56.00'],['upcoming','$110.25']]){
    assert((await page.locator('#books-'+id).innerText()).includes(amount),'Whole-ledger '+id+' equals '+amount);
  }
  assert.match(await page.locator('#books-review-count').innerText(),/\b3\b/,'Unresolved charges and a receipt allocation are counted as review work');
}

const bookMode=(page,mode)=>page.locator('#books-modes [data-books-mode="'+mode+'"]');
async function selectMode(page,mode) {
  const button=bookMode(page,mode);
  await button.click();
  assert.equal(await button.getAttribute('aria-pressed'),'true');
  assert.equal(await page.locator('#books-list').getAttribute('data-mode'),mode);
}

async function expandAllGroups(list) {
  for(const group of await list.locator('.books-group').all()){
    const summary=group.locator('summary').first();
    if(!await summary.evaluate(el=>el.parentElement.open)) await summary.click();
    await group.locator('.books-record').first().waitFor();
  }
}

async function checkBookContrast(container,width) {
  const failures = await container.evaluate(list=>{
    const rgba=css=>{
      if(!/^rgba?\(/.test(css))throw Error('Unexpected computed colour: '+css);
      const [r,g,b,a=1]=css.match(/[\d.]+/g).map(Number);
      return [r,g,b,a];
    };
    const blend=(surface,paint)=>surface.map((channel,i)=>channel+(paint[i]-channel)*paint[3]);
    const luminance=color=>{
      const [r,g,b]=color.map(channel=>channel/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4);
      return .2126*r+.7152*g+.0722*b;
    };
    const contrast=el=>{
      const paints=[];
      for(let ancestor=el;ancestor;ancestor=ancestor.parentElement){
        const color=rgba(getComputedStyle(ancestor).backgroundColor);
        if(color[3]>0)paints.push(color);
        if(color[3]===1)break;
      }
      const surface=paints.reverse().reduce(blend,[255,255,255]);
      const foreground=getComputedStyle(el).color;
      const bg=luminance(surface),fg=luminance(blend(surface,rgba(foreground)));
      const ratio=(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
      return {element:el.tagName,foreground,background:surface.map(Math.round),paints,ratio};
    };
    return Array.from(list.querySelectorAll('a,strong,small,.book-amount,.books-amount,.books-date,.books-venue')).filter(el=>el.getClientRects().length).map(contrast).filter(result=>result.ratio<4.5);
  });
  assert.deepEqual(failures,[],'Names, session details, balances and contacts have readable text contrast at '+width+'px');
}

async function checkLayout(page, row, width) {
  await page.setViewportSize({width,height:900});
  const layout = await row.evaluate(el=>{
    const blocks = Array.from(el.children, child=>{
      const rect = child.getBoundingClientRect();
      return {top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right};
    });
    return {blocks,listWidth:el.clientWidth,screenWidth:document.documentElement.clientWidth,contentWidth:document.documentElement.scrollWidth};
  });
  assert(layout.contentWidth <= width + 1,'No horizontal page overflow at ' + width);
  assert.equal(layout.blocks.length,3,'Session, balance and contact are all displayed');
  assert(layout.blocks.every(b=>b.left>=0 && b.right<=layout.screenWidth+1 && b.bottom>b.top),'Every field fits at ' + width);
  const [session,balance,contact] = layout.blocks;
  await checkBookContrast(row,width);
  if(layout.listWidth < 576) {
    assert(session.bottom<=balance.top+1 && balance.bottom<=contact.top+1,'Session, balance and contact stack without overlap on phones');
  } else {
    assert(session.right<=balance.left+1 && balance.right<=contact.left+1,'Desktop columns do not overlap');
  }
  const clipped = await row.locator('*').evaluateAll(elements=>elements.filter(el=>el.clientWidth && el.scrollWidth>el.clientWidth+1).map(el=>el.tagName));
  assert.deepEqual(clipped,[],'Long contact details and payment amounts fit at '+width);
}

async function checkCompactLayout(page,mode,width) {
  await page.setViewportSize({width,height:900});
  if(mode==='family'){
    const summary=page.locator('#books-list > .books-group > details > summary').first();
    await summary.focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    await summary.hover();
    assert(await summary.evaluate(el=>el.matches(':hover:focus-visible')),'Measure the family summary with keyboard focus and hover');
  }
  const layout=await page.locator('#books-list').evaluate(list=>{
    const bounds=el=>{const {x,y,width,height}=el.getBoundingClientRect();return {x,y,width,height};};
    return {
      viewport:document.documentElement.clientWidth,
      content:document.documentElement.scrollWidth,
      rows:Array.from(list.children,bounds),
      clipped:Array.from(list.querySelectorAll('*')).filter(el=>el.getClientRects().length && el.clientWidth && el.scrollWidth>el.clientWidth+1).map(el=>el.className||el.tagName),
    };
  });
  assert(layout.content<=width+1,mode+' fits a '+width+'px screen');
  assert.deepEqual(layout.clipped,[],mode+' text and amounts fit at '+width+'px');
  await checkBookContrast(page.locator('#books-list'),width);
  assert(layout.rows.length>=2);
  for(const rect of layout.rows) assert(rect.x>=0 && rect.x+rect.width<=layout.viewport+1 && rect.height>0);
  const [first,second]=layout.rows;
  if(mode==='grid' && width===1365) {
    assert(Math.abs(first.y-second.y)<=1 && first.x+first.width<=second.x+1,'Desktop Grid shows adjacent records');
  } else if(mode==='list'||mode==='family'||mode==='session') {
    assert(first.y+first.height<=second.y+1,mode+' keeps entries in separate compact rows');
  }
}

async function finishReadAfterExit({page,context}, exit) {
  const endpoint = '**/workspace/api/session-books';
  let finishRead;
  const delayed = route=>route.request().postDataJSON().view==='unpaid'?route.fallback():new Promise(resolve=>{
    finishRead=async()=>{await route.fulfill({json:{rows:books}});resolve();};
  });
  await context.route(endpoint,delayed);
  const started = page.waitForRequest(endpoint);
  await page.locator('#books-refresh').click();
  await started;
  await exit();
  const finished = page.waitForResponse(endpoint);
  await finishRead();
  await (await finished).finished();
  await page.waitForLoadState('networkidle');
  await context.unroute(endpoint,delayed);
  for(const selector of await page.locator('#panel-home').isVisible()?['#books-list']:['#home-unpaid-list','#books-list']) assert.equal((await page.locator(selector).textContent()).trim(),'');
  for(const id of ['books-outstanding','books-due','books-upcoming','books-review-count'])
    assert.equal(await page.locator('#'+id).textContent(),'','No private balance or count survives leaving Books');
  assert(!(await page.locator('body').textContent()).includes(due.contact.email));
}

module.exports = async function checkBooks(fixture) {
  const emptyHome = {homeQueues:true,roster:[],openInquiry:false};
  for (const warm of [true,false]) {
    let openRoster,openBooks;
    const deskGate=new Promise(resolve=>{openRoster=resolve;}),booksGate=new Promise(resolve=>{openBooks=resolve;});
    const f=await fixture({...emptyHome,books,priorityStart:true,openingUnpaid:warm,deskGate,booksGate});
    try {
      await f.page.setViewportSize({width:390,height:844});
      const family=f.page.locator('#home-unpaid-list').getByRole('link',{name:/Avery Fictional.*31.50/});
      if(!warm)openBooks();
      await family.waitFor();
      assert(await f.page.locator('#app').isHidden(),'Balances are visible while the roster is still pending');
      if(warm){
        await family.click();openRoster();
        await f.page.locator('#selected-balance').getByText(/31.50/).first().waitFor();
        openBooks();
      }else{
        openRoster();await f.page.locator('#app').waitFor();
        await f.page.locator('#panel-home #home-unpaid-list').getByRole('link',{name:/Avery Fictional.*31.50/}).waitFor();
      }
      await f.page.waitForLoadState('networkidle');
      assert.equal(reads(f).filter(r=>r.payload.view==='unpaid').length,warm?0:1);
      assert.deepEqual(f.errors,[]);
    }finally{openBooks();openRoster();await f.context.close();}
  }
  for(const handoff of ['after-payment','during-entry','during-payment']){
    let openRoster,openDetails;
    const deskGate=new Promise(resolve=>{openRoster=resolve;}),detailGate=new Promise(resolve=>{openDetails=resolve;});
    const rows=[{...due}],f=await fixture({...emptyHome,books:rows,priorityStart:true,openingUnpaid:true,paymentRecording:true,deskGate,detailGate});
    try{
      const {page}=f;await page.setViewportSize({width:390,height:844});
      let writes=0,finishPayment;
      const paymentGate=new Promise(resolve=>{finishPayment=resolve;});
      await f.context.route('**/workspace/api/booking-payment',async route=>{
        const payment=route.request().postDataJSON();writes++;
        assert.equal(payment.familyId,due.familyId);assert.equal(payment.items[0].bookingId,due.bookingId);
        assert.equal(payment.items[0].applyCents,3150);if(handoff==='during-payment')await paymentGate;rows.splice(0);
        await route.fulfill({json:{ok:true}});
      });
      await page.locator('#home-unpaid-list a').first().click();
      await page.locator('#unpaid-booking-list').getByText(due.playerName).waitFor();
      assert((await page.locator('#unpaid-booking-list').innerText()).includes(due.sessionLabel));
      await page.locator('#payment-entry summary').click();
      await page.locator('#payment-amount').fill('31.50');await page.locator('#payment-method').selectOption('Cash');
      assert(await page.locator('#app').isHidden());
      if(handoff==='during-entry'){
        openRoster();await page.locator('#app').waitFor();openDetails();await page.waitForLoadState('networkidle');
        assert.equal(await page.locator('#payment-amount').inputValue(),'31.50');
        assert.equal(await page.locator('#payment-method').inputValue(),'Cash');
      }
      await page.locator('#payment-submit').click();
      if(handoff==='during-payment'){
        await page.locator('#payment-result').getByText('Recording payment…').waitFor();
        openRoster();await page.locator('#app').waitFor();
        assert(await page.locator('#panel-books #payment-submit').isDisabled());
        finishPayment();
      }
      await page.waitForFunction(()=>document.querySelector('#home-unpaid').hidden&&!document.querySelector('#opening-overview #unpaid-bookings'));
      openDetails();openRoster();await page.locator('#app').waitFor();await page.waitForLoadState('networkidle');
      assert.equal(writes,1);assert(await page.locator('#home-unpaid').isHidden());assert.equal(new URL(page.url()).hash,'#view=home');
      assert.deepEqual(f.errors,[]);
    }finally{openRoster();openDetails();await f.context.close();}
  }
  const opening = await fixture({...emptyHome,books,openingUnpaid:true});
  try {
    await opening.page.locator('#home-unpaid-list').getByRole('link',{name:/Avery Fictional.*31.50/}).waitFor();
    await opening.page.waitForLoadState('networkidle');
    assert.equal(reads(opening).length,0,'Opening balances render without a second lookup');
  } finally { await opening.context.close(); }
  const empty = await fixture({...emptyHome,books:[]});
  try {
    await empty.page.waitForLoadState('networkidle');
    assert.deepEqual(reads(empty).map(r=>r.payload),[{view:'unpaid'}]);
    for(const selector of ['#home-unpaid','#home-attention','.home-command-row']) assert(await empty.page.locator(selector).isHidden(),selector+' stays hidden on an empty Overview');
    assert.deepEqual(empty.errors,[]);
  } finally { await empty.context.close(); }

  const f = await fixture({...emptyHome,books});
  try {
    const {page} = f;
    const unpaid = page.locator('#home-unpaid');
    await unpaid.locator(':scope > summary').getByText('Unpaid sessions (1 family)',{exact:true}).waitFor();
    await page.waitForLoadState('networkidle');
    assert(await page.locator('#home-attention').isVisible(),'One unpaid session keeps the otherwise-empty attention card visible');
    assert(await page.locator('#home-mail-summary').isHidden());
    assert(await page.locator('#home-registration-review').isHidden());
    assert.equal(await page.locator('#home-priorities').evaluate(el=>el.childElementCount),0);
    assert.equal(await unpaid.evaluate(el=>el.open),true);
    assert.equal(await unpaid.locator('#home-unpaid-list > li').count(),1,'The outstanding amount is visible on opening');
    assert.deepEqual(reads(f).map(r=>r.payload),[{view:'unpaid'}]);
    const homeRow=unpaid.locator('#home-unpaid-list li');
    const booking=homeRow.getByRole('link');
    await booking.waitFor();
    assert.equal(await homeRow.count(),1);
    assert.deepEqual(await booking.locator(':scope > *').allTextContents(),[due.familyName,'$31.50']);
    const details=page.locator('#panel-books #unpaid-bookings');
    await booking.click();
    const entry=details.locator('.books-entry');
    for(const value of [due.playerName,due.sessionLabel,due.time,due.location,due.bookingType,due.attendanceStatus,due.contact.guardian,'42.00','10.50','31.50']){
      assert((await entry.innerText()).includes(value),'In-app details show '+value);
    }
    assert.equal(await details.locator('a[href^="http"]').count(),0);
    for(const width of [320,390,1365])await checkLayout(page,entry,width);
    assert.equal(new URL(page.url()).hash,'#view=books&balance=booking-'+due.bookingId);
    assert.equal(await page.getByRole('dialog').count(),0);
    await page.reload();await entry.waitFor();
    assert.equal(await entry.locator('.books-session strong').innerText(),due.playerName);
    await details.getByRole('link',{name:/All Books/}).click();
    const list = page.locator('#books-list');
    await list.locator('.books-group').first().waitFor();
    assert.equal(await page.locator('#books-filter').inputValue(),'attention','Open Books starts with outstanding balances and review work');
    assert.equal(await list.getAttribute('data-mode'),'family','Open Books starts with parents');
    await selectMode(page,'list');
    const row = list.locator('.books-record').filter({hasText:due.playerName});
    await row.locator('summary').click();
    await row.getByRole('link',{name:due.contact.email}).waitFor();
    assert.equal(await row.locator('a[href^="http"]').count(),0,'Expanded Books details stay inside Coach Desk');
    for(const value of [due.sessionLabel,due.location,due.time,due.contact.guardian,due.contact.email,due.contact.phone,'42.00','10.50','31.50'])
      assert((await row.innerText()).includes(value),'Ledger shows '+value);
    assert.equal(await row.getByRole('link',{name:due.contact.email}).getAttribute('href'),'mailto:'+due.contact.email);
    assert.equal(await row.getByRole('link',{name:due.contact.phone}).getAttribute('href'),'tel:6045550132');
    await page.locator('#books-filter').selectOption('due');
    assert.equal(await list.locator('.books-record').count(),1);
    assert.match(await list.innerText(),/Taylor Fictional/);
    await page.locator('#books-filter').selectOption('paid');
    assert.equal(await list.locator('.books-record').count(),1);
    assert.match(await list.innerText(),/Robin Fictional/);
    await page.locator('#books-filter').selectOption('review');
    assert.match(await list.innerText(),/Casey Fictional/);
    assert(!/\$0\.00/.test(await list.innerText()),'Unknown values stay distinct from an actual zero');
    await page.locator('#books-filter').selectOption('booking');
    assert.match(await list.innerText(),/Casey Fictional/);
    assert.equal(await list.locator('.books-record').count(),1);
    assert.deepEqual(reads(f).map(r=>r.payload),[{view:'unpaid'},{},{},{}],'Filters reuse the directory read');
    await page.locator('#books-filter').selectOption('all');

    await finishReadAfterExit(f,async()=>{await openDestination(page,'home');await page.locator('#panel-home').waitFor();});
    await openDestination(page,'books');
    await list.locator('.books-group').first().waitFor();
    await finishReadAfterExit(f,async()=>{await page.locator('#logout').click();await page.locator('#login').waitFor();});
    assert.deepEqual(f.errors,[]);
  } finally { await f.context.close(); }

  const grouped=await fixture({hash:'#view=books',books:allBooks});
  try {
    const {page}=grouped,list=page.locator('#books-list'),filter=page.locator('#books-filter'),search=page.locator('#books-search');
    await list.locator('.books-group').first().waitFor();
    await page.getByRole('heading',{name:'Needs attention',exact:true}).waitFor();
    assert.equal(await list.getAttribute('data-mode'),'family');
    assert.equal(await filter.inputValue(),'attention');
    await checkWholeLedger(page);
    assert.equal(await list.locator('.books-group').count(),5,'Two verified families and three independently unlinked players stay distinct');
    assert.equal(await list.locator('details[open]').count(),0,'The parent list starts compact');
    for(const width of [320,390,1365]) await checkCompactLayout(page,'family',width);
    const firstSummary=list.locator('summary').first();
    await firstSummary.focus();
    await page.keyboard.press('Enter');
    await list.locator('.books-group .books-record').first().waitFor();
    await page.keyboard.press('Enter');
    assert.equal(await list.locator('details[open]').count(),0,'Parents can be expanded and collapsed from the keyboard');
    await expandAllGroups(list);
    const firstFamily=list.locator('.books-group').filter({hasText:siblingPackage.playerName});
    assert.equal(await firstFamily.count(),1);
    const household=await firstFamily.innerText();
    assert(household.includes(due.playerName),'Siblings share one verified household');
    assert(!household.includes(otherParent.playerName),'Another household with the same guardian name stays separate');
    assert.equal(await firstFamily.getByRole('link',{name:due.contact.email}).count(),1,'Parent contact is shown once for siblings');
    for(const width of [320,390]) await checkCompactLayout(page,'family',width);
    assert.equal(await list.locator('.books-group').filter({hasText:noParent.playerName}).count(),2,'Unlinked same-name children stay separate');
    assert(!(await list.innerText()).includes(paid.playerName),'A settled sibling is omitted from the attention queue');
    await filter.selectOption('all');
    await expandAllGroups(list);
    assert((await list.innerText()).includes(paid.playerName),'All records includes the settled sibling');
    await search.fill(due.contact.guardian.toUpperCase());
    assert.equal(await list.locator('.books-group').count(),2,'Parent search honours both independent matching households');
    await checkWholeLedger(page);
    await search.fill(siblingPackage.playerName);
    assert.equal(await list.locator('.books-group').count(),1);
    await search.fill('');
    await selectMode(page,'session');
    for(const width of [320,390,1365]) await checkCompactLayout(page,'session',width);
    await expandAllGroups(list);
    const weeklyGroup=list.locator('.books-group').filter({hasText:due.playerName});
    assert.equal(await weeklyGroup.count(),1);
    assert((await weeklyGroup.innerText()).includes(otherParent.playerName),'Friday on different dates shares its regular training slot');
    assert(!(await weeklyGroup.innerText()).includes(noParent.playerName),'Sunday bookings have a separate slot');
    const winterGroup=list.locator('.books-group').filter({hasText:siblingPackage.playerName});
    assert((await winterGroup.innerText()).includes(siblingPackage.sessionGroupLabel));
    assert(!(await winterGroup.innerText()).includes(unresolved.sessionGroupLabel),'Pro-D is distinct from a week of camp');
    await search.fill('sunday 9');
    assert.equal(await list.locator('.books-group').count(),1,'Session search finds a slot');
    await search.fill('');
    for(const mode of ['grid','list']){
      await selectMode(page,mode);
      assert.equal(await list.locator('.books-record').count(),allBooks.length);
      assert.equal(await list.locator('details[open]').count(),0);
      for(const width of [320,390,1365]) await checkCompactLayout(page,mode,width);
      for(const [value,count] of [['attention',7],['outstanding',4],['due',2],['upcoming',2],['review',3],['paid',1],['booking',3]]){
        await filter.selectOption(value);
        assert.equal(await list.locator('.books-record').count(),count,mode+' includes every '+value+' record exactly once');
        await checkWholeLedger(page);
      }
      await filter.selectOption('review');
      let item=list.locator('.books-record').filter({hasText:unresolved.playerName});
      await item.locator('summary').click();
      assert((await item.innerText()).includes('$11.25'),'Known disputed amount is visible for review');
      assert.match(await item.innerText(),/review|unconfirmed|to confirm/i);
      const receipt=list.locator('.books-record').filter({hasText:otherParent.contact.guardian});
      await receipt.locator('summary').click();
      await receipt.getByText(receiptReview.reviewReason,{exact:true}).waitFor();
      assert((await receipt.innerText()).includes('$19.75'),'The unapplied receipt is available for matching');
      assert(!/\$19\.75 (outstanding|due|owing)|Player to confirm|Session to confirm/i.test(await receipt.innerText()),'An unapplied receipt is never presented as a debt, player or session');
      await filter.selectOption('all');
    }
    assert.deepEqual(reads(grouped).map(r=>r.payload),[{}],'All layouts, totals, groups and filters share the single full ledger read');
    assert.deepEqual(grouped.errors,[]);
  } finally { await grouped.context.close(); }

  for(const [role,familyAccess,booksAvailable] of [['admin',true,true],['admin',false,false],['coach',false,false],['coach',true,true],['owner',true,false]]) {
    const f = await fixture({role,familyAccess,booksAvailable,hash:role==='admin'&&familyAccess?'#view=books':'#view=books&balance=booking-'+due.bookingId,books:[]});
    try {
      if(role==='admin' && familyAccess) {
        await f.page.locator('#panel-books').waitFor();
        await f.page.waitForLoadState('networkidle');
        assert.equal(reads(f).length,1);
        assert.equal(await f.page.locator('#books-list').evaluate(list=>list.childElementCount),0);
        assert((await f.page.locator('#panel-books').innerText()).match(/no .*(sessions|entries|records|bookings|results)/i),'Empty books gives a readable status');
        await f.page.setViewportSize({width:390,height:900});
        await openDestination(f.page,'home');
        await f.page.waitForLoadState('networkidle');
        assert.deepEqual(reads(f).map(r=>r.payload),[{}, {view:'unpaid'}],'A super admin gets the same due-only Overview check');
        await openDestination(f.page,'books');
        assert(await f.page.locator('#panel-books').isVisible(),'Books opens from the mobile More menu');
      } else {
        await f.page.locator('#panel-home').waitFor();
        assert(await f.page.locator('#nav-books').isHidden());
        assert(await f.page.locator('#home-unpaid').isHidden());
        assert(await f.page.locator('#panel-books').isHidden());
        assert.equal(await f.page.locator('#home-unpaid-list, #books-list').evaluateAll(els=>els.map(el=>el.textContent).join('').trim()),'');
        assert.equal(reads(f).length,0,'Restricted accounts cannot trigger books reads by direct link');
      }
      assert.deepEqual(f.errors,[]);
    } finally { await f.context.close(); }
  }

  const secondId='rec00000000000003',second={...due,playerName:'Sibling Example',amountDue:12.25,
    bookingId:secondId,bookingUrl:due.bookingUrl.replace(due.bookingId,secondId)};
  const otherId='rec00000000000004',other={...due,familyId:'rec00000000000005',bookingId:otherId,bookingUrl:due.bookingUrl.replace(due.bookingId,otherId)};
  const homeFamilies=await fixture({...emptyHome,books:[due,second,other,second]});
  try{
    const {page}=homeFamilies;
    const unpaid=page.locator('#home-unpaid');
    await unpaid.getByText('Unpaid sessions (2 families)',{exact:true}).waitFor();
    const rows=unpaid.locator('#home-unpaid-list > li');
    await rows.nth(1).waitFor();
    assert.equal(await rows.count(),2,'Same-name households remain separate');
    const household=rows.getByRole('link',{name:/43\.75/});
    assert.deepEqual(await household.locator(':scope > *').allTextContents(),[due.familyName,'$43.75']);
    await household.click();
    const chooser=page.locator('#panel-books #unpaid-bookings');await chooser.locator('.books-entry').first().waitFor();
    assert.deepEqual(await chooser.locator('.books-session strong').allTextContents(),[due.playerName,second.playerName]);
    assert.deepEqual(await chooser.locator('.books-amount').allTextContents(),['$31.50 owing','$12.25 owing']);
    assert.equal(await chooser.locator('a[href^="http"]').count(),0);
    await page.goBack();
    await rows.getByRole('link',{name:/31\.50/}).click();await chooser.locator('.books-entry').first().waitFor();
    assert.equal(await chooser.locator('.books-entry').count(),1);
    assert.equal(await page.context().pages().length,1);
    assert.deepEqual(homeFamilies.errors,[]);
  }finally{await homeFamilies.context.close();}

  const unnamed=await fixture({...emptyHome,books:[{...due,familyName:null,familyId:null}]});
  try{

    const link=unnamed.page.locator('#home-unpaid-list').getByRole('link',{name:/Taylor Fictional/});
    await link.click();
    await unnamed.page.locator('#unpaid-bookings-title').getByText(due.playerName,{exact:true}).waitFor();
    assert.equal(new URL(unnamed.page.url()).hash,'#view=books&balance=booking-'+due.bookingId);
    assert(await unnamed.page.locator('#payment-entry').isHidden());
  }finally{await unnamed.context.close();}

  const walkIn={...due,familyId:null,familyName:null,amountDue:60,amountOutstanding:60};
  const past={...walkIn,scope:'booking',bookingId:recordId(999),date:null,sessionLabel:'Earlier camp · date unrecorded',pastBookingBalance:true,amountDue:50,amountOutstanding:50};
  const carryover=await fixture({...emptyHome,books:[walkIn,past],paymentRecording:true});
  try{
    const {page}=carryover;
    await carryover.context.route('**/workspace/api/booking-payment',async route=>{
      const cmd=route.request().postDataJSON();
      assert.equal(cmd.familyId,undefined);assert.equal(cmd.playerId,walkIn.playerId);
      assert.deepEqual(cmd.items,[{bookingId:past.bookingId,applyCents:5000,dueCents:5000},{bookingId:walkIn.bookingId,applyCents:1000,dueCents:6000}]);
      Object.assign(past,{status:'paid',amountDue:0,amountOutstanding:0});
      Object.assign(walkIn,{amountDue:50,amountOutstanding:50});
      await route.fulfill({json:{saved:true}});
    });
    await page.getByText('Unpaid sessions (1 family)',{exact:true}).waitFor();
    await page.locator('#home-unpaid-list a').getByText('$110.00').click();
    await page.locator('#selected-balance').getByText('$110.00 owing').waitFor();
    assert.equal(await page.locator('#unpaid-booking-list .books-entry').count(),2);
    await page.locator('#payment-entry summary').click();
    await page.locator('#payment-amount').fill('60');await page.locator('#payment-method').selectOption('Cash');
    await page.locator('#payment-submit').click();
    await page.locator('#home-unpaid-list a').getByText('$50.00',{exact:true}).waitFor();
    assert.equal(new URL(page.url()).hash,'#view=home');
  }finally{await carryover.context.close();}

  const accountingRows=[{...due},otherParent];
  const payment=await fixture({...emptyHome,books:accountingRows,paymentRecording:true});
  try{
    const {page}=payment;let submissions=0;
    await payment.context.route('**/workspace/api/booking-payment',async route=>{
      const data=route.request().postDataJSON();submissions++;
      assert.equal(data.familyId,due.familyId);
      if(submissions===1){
        assert.equal(data.method,'Cash');
        assert.deepEqual(data.items,[{bookingId:due.bookingId,applyCents:1000,dueCents:3150}]);
        Object.assign(accountingRows[0],{amountDue:21.5,amountOutstanding:21.5,amountPaid:20.5});
      }else{
        assert.equal(data.method,'E-transfer');assert.equal(data.reference,'EXAMPLE123');
        assert.deepEqual(data.items,[{bookingId:due.bookingId,applyCents:2150,dueCents:2150}]);
        Object.assign(accountingRows[0],{amountDue:0,amountOutstanding:0,amountPaid:42,status:'paid'});
      }
      await route.fulfill({json:{saved:true}});
    });
    await page.getByText('Unpaid sessions (2 families)',{exact:true}).waitFor();
    const family=page.locator('#home-unpaid-list a[href$="'+due.bookingId+'"]');
    await family.click();
    await page.locator('#payment-entry summary').click();
    await page.locator('#payment-amount').fill('10');
    await page.locator('#payment-method').selectOption('Cash');
    await page.locator('#payment-submit').click();
    await family.getByText('$21.50',{exact:true}).waitFor();
    assert.equal(await page.locator('#home-unpaid-label').innerText(),'Unpaid sessions (2 families)');
    assert.equal(new URL(page.url()).hash,'#view=home');
    await family.click();
    await page.locator('#payment-entry summary').click();
    await page.locator('#payment-amount').fill('21.50');await page.locator('#payment-method').selectOption('E-transfer');
    await page.locator('#payment-reference').fill('example123');await page.locator('#payment-submit').click();
    await page.locator('#home-unpaid-list a').getByText('$24.50',{exact:true}).waitFor();
    assert.equal(new URL(page.url()).hash,'#view=home');
    assert.equal(await family.count(),0);
    assert.equal(await page.locator('#home-unpaid-label').innerText(),'Unpaid sessions (1 family)');
    assert.equal(await page.locator('#home-unpaid-list a').count(),1);
    assert.equal(submissions,2);assert.deepEqual(payment.errors,[]);
  }finally{await payment.context.close();}

  const retry = await fixture({...emptyHome,hash:'#view=settings',books:[due]});
  try {
    const {page} = retry;
    await page.waitForLoadState('networkidle');
    assert.equal(reads(retry).length,0,'Opening Settings does not look up unpaid sessions');
    const endpoint='**/workspace/api/session-books';
    await retry.context.route(endpoint,route=>route.fulfill({status:503,json:{error:'SESSION_BOOKS_UNAVAILABLE'}}),{times:1});
    await openDestination(page,'home');
    const unpaid=page.locator('#home-unpaid');
    await unpaid.getByText('Check unpaid sessions',{exact:true}).waitFor();
    assert(await page.locator('#home-attention').isVisible(),'A failed lookup cannot mark an otherwise empty Overview as clear');
    if(await unpaid.evaluate(el=>el.open))await unpaid.locator(':scope > summary').click();
    await unpaid.locator(':scope > summary').click();
    await unpaid.getByText(due.familyName,{exact:true}).waitFor();
    assert.deepEqual(reads(retry).map(r=>r.payload),[{view:'unpaid'}],'After a failed lookup, expanding retries the due-only read');
    assert.deepEqual(retry.errors,[]);
  } finally { await retry.context.close(); }

  const more = await fixture({hash:'#view=books',books:Array.from({length:43},(_,i)=>({...due,playerName:'Example Player '+(i+1),
    playerId:recordId(1000+i),bookingId:recordId(2000+i),attendanceId:recordId(3000+i)}))});
  try {
    const {page} = more, list=page.locator('#books-list'), search=page.locator('#books-search');
    await page.setViewportSize({width:320,height:900});
    await list.locator('.books-group').waitFor();
    assert.match(await list.innerText(),/1,354\.50/,'The first family page includes all 43 charges in its total');
    await expandAllGroups(list);
    assert.match(await list.innerText(),/Example Player 43/,'A household is never split across ledger pages');
    assert(await page.locator('#books-more').isHidden());
    await selectMode(page,'list');
    assert.equal(await list.locator('.books-record').count(),40);
    await page.locator('#books-more').focus();
    await page.keyboard.press('Enter');
    assert.match(await list.innerText(),/Example Player 43/);
    assert(await page.locator('#books-more').isHidden());
    await search.fill('E Player 43');
    assert.equal(await list.locator('.books-record').count(),1);
    assert((await list.innerText()).includes('Example Player 43'));
    await page.keyboard.press('Tab');
    assert(await page.locator('#books-filter').evaluate(el=>el===document.activeElement),'Search and filter follow keyboard reading order');
    assert.equal(reads(more).length,1,'Search and paging reuse the loaded records');
    await more.context.route('**/workspace/api/session-books',route=>route.fulfill({status:403,json:{error:'ACCESS_DENIED'}}));
    await page.locator('#books-refresh').click();
    await page.locator('#panel-home').waitFor();
    assert(await page.locator('#nav-books').isHidden());
    assert(await page.locator('#home-unpaid').isHidden());
    assert.equal(await list.textContent(),'');
    assert.deepEqual(more.errors,[]);
  } finally { await more.context.close(); }

  const manyFamilies = await fixture({hash:'#view=books',books:Array.from({length:41},(_,i)=>({...due,
    playerId:recordId(1000+i),bookingId:recordId(2000+i),attendanceId:recordId(3000+i),familyId:recordId(4000+i),
    familyName:'Household '+String(i+1).padStart(2,'0'),playerName:'Player '+(i+1),contact:null}))});
  try {
    const {page}=manyFamilies,list=page.locator('#books-list');
    await list.locator('.books-group').first().waitFor();
    assert.equal(await list.locator('.books-group').count(),40);
    assert.equal(await page.locator('#books-outstanding').innerText(),'$1,291.50','Header includes balances beyond the visible families');
    await page.locator('#books-more').click();
    assert.equal(await list.locator('.books-group').count(),41);
    assert.match(await list.innerText(),/Household 41/);
    assert(await page.locator('#books-more').isHidden());
    assert.equal(reads(manyFamilies).length,1);
    assert.deepEqual(manyFamilies.errors,[]);
  } finally { await manyFamilies.context.close(); }
};
