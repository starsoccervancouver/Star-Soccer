const assert = require('node:assert/strict');
const {openDestination} = require('./coach-fixture-navigation.cjs');

// These rows are the browser contract for an already reconciled ledger.
const due = {
  scope:'session', playerName:'Taylor Fictional', sessionLabel:'Friday after-school training',
  date:'2026-10-23', time:'3:45 PM', location:'Fictional west training field',
  bookingType:'Drop-in', status:'due', amountCharged:42, amountPaid:10.50, amountDue:31.50,
  contact:{guardian:'Avery Fictional',email:'sample.household.with.a.long.address@example.test',phone:'604-555-0132'}
};
const paid = {...due, playerName:'Robin Fictional', status:'paid', amountPaid:42, amountDue:0, contact:null};
const review = {...due,scope:'booking', playerName:'Casey Fictional', bookingType:'Winter camp',
  status:'review', amountCharged:null, amountPaid:null, amountDue:null, contact:null};
const books = [due,paid,review];
const reads = fixture => fixture.requests.filter(request=>request.path.endsWith('/session-books'));

async function checkLayout(page, row, width) {
  await page.setViewportSize({width,height:900});
  const layout = await row.evaluate(el=>{
    const luminance = rgb => {
      const components = rgb.match(/[\d.]+/g).slice(0,3).map(Number).map(v=>(v/=255)<=.04045?v/12.92:((v+.055)/1.055)**2.4);
      return .2126*components[0]+.7152*components[1]+.0722*components[2];
    };
    let surface = el;
    while(getComputedStyle(surface).backgroundColor==='rgba(0, 0, 0, 0)' && surface.parentElement) surface=surface.parentElement;
    const background=luminance(getComputedStyle(surface).backgroundColor);
    const ratios=Array.from(el.querySelectorAll('strong,span,small,a'),child=>{
      const foreground=luminance(getComputedStyle(child).color);
      return (Math.max(foreground,background)+.05)/(Math.min(foreground,background)+.05);
    });
    const blocks = Array.from(el.children, child=>{
      const rect = child.getBoundingClientRect();
      return {top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right};
    });
    return {blocks,ratios,listWidth:el.clientWidth,screenWidth:document.documentElement.clientWidth,contentWidth:document.documentElement.scrollWidth};
  });
  assert(layout.contentWidth <= width + 1,'No horizontal page overflow at ' + width);
  assert.equal(layout.blocks.length,3,'Session, balance and contact are all displayed');
  assert(layout.blocks.every(b=>b.left>=0 && b.right<=layout.screenWidth+1 && b.bottom>b.top),'Every field fits at ' + width);
  const [session,balance,contact] = layout.blocks;
  assert(layout.ratios.every(ratio=>ratio>=4.5),'Names, balances, dates and contact details meet minimum text contrast at '+width);
  if(layout.listWidth < 576) {
    assert(session.bottom<=balance.top+1 && balance.bottom<=contact.top+1,'Session, balance and contact stack without overlap on phones');
  } else {
    assert(session.right<=balance.left+1 && balance.right<=contact.left+1,'Desktop columns do not overlap');
  }
  const clipped = await row.locator('*').evaluateAll(elements=>elements.filter(el=>el.clientWidth && el.scrollWidth>el.clientWidth+1).map(el=>el.tagName));
  assert.deepEqual(clipped,[],'Long contact details and payment amounts fit at '+width);
}

async function finishReadAfterExit({page,context}, exit) {
  const endpoint = '**/workspace/api/session-books';
  let finishRead;
  const delayed = route=>new Promise(resolve=>{
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
  for(const selector of ['#home-unpaid-list','#books-list']) assert.equal((await page.locator(selector).textContent()).trim(),'');
  assert(!(await page.locator('body').textContent()).includes(due.contact.email));
}

module.exports = async function checkBooks(fixture) {
  const f = await fixture({books});
  try {
    const {page} = f;
    const unpaid = page.locator('#home-unpaid');
    assert.equal(reads(f).length,0,'Opening Overview alone does not read the books');
    await unpaid.locator('summary').click();
    const homeRow = unpaid.locator('.books-entry');
    await homeRow.getByText(due.playerName,{exact:true}).waitFor();
    assert.equal(await homeRow.count(),1,'Overview only shows sessions with an amount owing');
    assert.deepEqual(reads(f).map(r=>r.payload),[{view:'unpaid'}]);
    for (const value of [due.contact.guardian,due.contact.email,due.contact.phone,due.time,'31.50'])
      assert((await homeRow.innerText()).includes(value),'Unpaid session shows '+value);
    for(const width of [320,390,1365]) await checkLayout(page,homeRow,width);
    await page.setViewportSize({width:320,height:900});
    assert.equal(await unpaid.locator('summary').evaluate(el=>el.clientHeight>=44),true);
    await page.locator('#home-open-books').click();
    const list = page.locator('#books-list');
    const row = list.locator('.books-entry').filter({hasText:due.playerName});
    await row.waitFor();
    assert.equal(await page.locator('#books-filter').inputValue(),'all','Open Books defaults to all records');
    await list.getByText(review.playerName,{exact:true}).waitFor();
    assert.equal(await list.locator('.books-entry').count(),3);
    for(const value of [due.sessionLabel,due.location,due.time,due.contact.guardian,due.contact.email,due.contact.phone,'42.00','10.50','31.50'])
      assert((await row.innerText()).includes(value),'Ledger shows '+value);
    assert.equal(await row.getByRole('link',{name:due.contact.email}).getAttribute('href'),'mailto:'+due.contact.email);
    assert.equal(await row.getByRole('link',{name:due.contact.phone}).getAttribute('href'),'tel:6045550132');
    for(const width of [320,390,1365]) await checkLayout(page,row,width);
    await page.locator('#books-filter').selectOption('due');
    await list.getByText(due.playerName,{exact:true}).waitFor();
    assert.equal(await list.locator('.books-entry').count(),1);
    await page.locator('#books-filter').selectOption('paid');
    await list.getByText(paid.playerName,{exact:true}).waitFor();
    assert.equal(await list.locator('.books-entry').count(),1);
    assert((await list.innerText()).includes('Parent contact unavailable'));
    await page.locator('#books-filter').selectOption('review');
    await list.getByText(review.playerName,{exact:true}).waitFor();
    assert(!/\$0\.00/.test(await list.innerText()),'Unknown values stay distinct from an actual zero');
    await page.locator('#books-filter').selectOption('booking');
    await list.getByText(review.playerName,{exact:true}).waitFor();
    assert.equal(await list.locator('.books-entry').count(),1);
    assert.deepEqual(reads(f).map(r=>r.payload),[{view:'unpaid'},{}],'Filters work with the same ledger read');
    await page.locator('#books-filter').selectOption('all');

    await finishReadAfterExit(f,async()=>{await openDestination(page,'home');await page.locator('#panel-home').waitFor();});
    await openDestination(page,'books');
    await row.waitFor();
    await finishReadAfterExit(f,async()=>{await page.locator('#logout').click();await page.locator('#login').waitFor();});
    assert.deepEqual(f.errors,[]);
  } finally { await f.context.close(); }

  for(const [role,familyAccess] of [['admin',true],['admin',false],['coach',false],['coach',true]]) {
    const f = await fixture({role,familyAccess,hash:'#view=books',books:[]});
    try {
      if(role==='admin' && familyAccess) {
        await f.page.locator('#panel-books').waitFor();
        await f.page.waitForLoadState('networkidle');
        assert.equal(reads(f).length,1);
        assert.equal(await f.page.locator('#books-list .books-entry').count(),0);
        assert((await f.page.locator('#panel-books').innerText()).match(/no .*(sessions|entries|records|bookings|results)/i),'Empty books gives a readable status');
        await f.page.setViewportSize({width:390,height:900});
        await openDestination(f.page,'home');
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

  const more = await fixture({hash:'#view=books',books:Array.from({length:43},(_,i)=>({...due,playerName:'Example Player '+(i+1)}))});
  try {
    const {page} = more, list=page.locator('#books-list'), search=page.locator('#books-search');
    await page.setViewportSize({width:320,height:900});
    await list.getByText('Example Player 40',{exact:true}).waitFor();
    assert.equal(await list.locator('.books-entry').count(),40);
    await page.locator('#books-more').focus();
    await page.keyboard.press('Enter');
    await list.getByText('Example Player 43',{exact:true}).waitFor();
    assert(await page.locator('#books-more').isHidden());
    await search.fill('E Player 43');
    assert.equal(await list.locator('.books-entry').count(),1);
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
};
