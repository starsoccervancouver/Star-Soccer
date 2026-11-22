/* Full Coach Desk settings tests. Fictional accounts and intercepted network only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { openSession, openDestination } = require('./coach-fixture-navigation.cjs');
const origin = 'https://attendance.starsoccer.ca', now = '2026-10-29T18:00:00Z';
const key = 'coach-desk-display-v1', rid = n => 'rec' + String(n).padStart(14, '0');
const sessions = [1, 2].map(n => ({ id: rid(n), date: n === 1 ? '2026-10-29' : '2026-10-30', time: '4:00–5:00 PM', location: 'Fictional practice field', status: 'Scheduled', capacity: 20, capacityUsed: 1, expected: 1, counts: { yes: 0, no: 0, awaiting: 1, confirmed: 0 }, issues: [], players: [{ playerId: rid(100 + n), attendanceId: rid(200 + n), name: 'Fictional player ' + n, kind: 'dropin', status: 'Not yet asked', actualAttendance: 'Not marked', issues: [] }] }));
const sampleFamilies = [
  {id:rid(50), name:'Morgan Sample / Jamie', playerIds:[rid(101),rid(102)]},
  {id:rid(51), name:'Casey Example / Rowan', playerIds:[rid(103)]},
  {id:rid(52), name:'Jordan West / Avery', playerIds:[rid(104)]},
];
const sampleRecord = {
  name:sampleFamilies[0].name, guardian:'Morgan Sample', email:'morgan@example.test', phone:'604-555-0100',
  players:['Jamie','Alex'], playerProfiles:[
    {id:rid(101),name:'Jamie',applied:45,dueNow:0,paymentStatus:'Paid to date',notes:[{body:'Practised looking up before passing.',category:'Development',updatedAt:now}],
      attendance:[{date:'2026-10-28',time:'3:45 PM',label:'Wednesday practice',location:'Connaught Park',status:'Present'}]},
    {id:rid(102),name:'Alex',applied:15,dueNow:15,paymentStatus:'Payment pending',notes:[],attendance:[]}
  ],
  balance:15, dueNow:15, verifiedReceipts:60, bookings:[],
  registrations:[{child:'Alex',program:'Camp'}], payments:[{date:'2026-10-28',amount:60,verification:'Verified',reference:'EXAMPLE-001'}]
};
const assets = {};
for (const [url, file, type] of [['/workspace', 'workspace.html', 'text/html'], ['/workspace/assets/workspace.js', 'workspace.js', 'text/javascript'], ['/workspace/assets/workspace.css', 'workspace.css', 'text/css'], ['/assets/app.css', 'app.css', 'text/css'], ['/assets/logo.svg', 'logo.svg', 'image/svg+xml']]) assets[url] = { body: fs.readFileSync('private-attendance/web/' + file, 'utf8'), type };
assets['/workspace/assets/passkeys.js'] = { body: '', type: 'text/javascript' };
require('./coach-fixture-fonts.cjs')(assets);

(async () => {
  const browser = await chromium.launch(); let checks = 0;
  try {
    async function fixture({ role = 'owner', familyAccess = role === 'owner', stored, hash = '', deniedStorage = false, displayEmail, homeQueues = false, bundleDesk = homeQueues,
      followups = false, roster = sessions, refreshRoster, books = [], families = [{...sampleFamilies[0],playerIds:[rid(101)]}] } = {}) {
      const context = await browser.newContext({ viewport: { width: 1365, height: 950 } });
      let reportCompleted=null;
      const state = { profile: { email: 'fictional-' + role + '@example.test', name: 'Fictional ' + role, role, familyAccess, sessionVersion: 1, ...(displayEmail ? { displayEmail } : {}) } }, requests = [], errors = [];
      await context.addInitScript(({ now, key, stored, deniedStorage }) => {
        const Base = Date; window.Date = class extends Base { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return Base.parse(now); } };
        if (stored !== undefined && !sessionStorage.getItem('fixture-seeded')) { localStorage.setItem(key, stored); sessionStorage.setItem('fixture-seeded', 'true'); }
        if (deniedStorage) { Storage.prototype.getItem = () => { throw new DOMException('Fictional blocked storage', 'SecurityError'); }; Storage.prototype.setItem = () => { throw new DOMException('Fictional blocked storage', 'SecurityError'); }; Storage.prototype.removeItem = () => { throw new DOMException('Fictional blocked storage', 'SecurityError'); }; }
        window.fixtureAnswers = []; window.fixturePrompts = [];
        window.confirm = text => { fixturePrompts.push(text); return fixtureAnswers.shift() === true; };
        Object.defineProperty(navigator, 'clipboard', { value: { writeText: async value => { window.fixtureCopied = value; } }, configurable: true });
      }, { now, key, stored, deniedStorage });
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url()), path = url.pathname;
        if (url.origin !== origin) { errors.push('Unexpected external network ' + url.origin); return route.abort(); }
        if (assets[path]) return route.fulfill({ status: 200, contentType: assets[path].type, body: assets[path].body });
        const payload = request.postData() ? request.postDataJSON() : undefined; requests.push({ path, method: request.method(), payload });
        let value;
        if (path.endsWith('/refresh') && refreshRoster !== undefined) roster = refreshRoster;
        const desk = { profile: state.profile, sessions:roster, notes: [], tasks: [], observedAt: now,
          attentionAvailable: homeQueues && familyAccess, familyFollowupsAvailable: (followups || homeQueues) && role==='owner' };
        const includeDesk = bundleDesk && state.profile && request.headers()['x-coach-desk'] === 'full';
        if (path.endsWith('/bootstrap')) value = { profile: state.profile, csrfToken: 'fictional-settings-csrf', googleEnabled: true, ...(includeDesk ? {desk} : {}) };
        else if (path.endsWith('/desk')) value = desk;
        else if (path.endsWith('/session-books') && state.profile?.familyAccess && ['owner','admin'].includes(state.profile.role)) {
          assert.equal(request.method(),'POST');
          assert.deepEqual(payload,payload.view === 'unpaid' ? {view:'unpaid'} : {});
          value = {rows:payload.view === 'unpaid' ? books.filter(row=>row.scope === 'session' && row.status === 'due' && row.amountDue > 0) : books};
        }
        else if (path.endsWith('/family-followups') && role==='owner' && followups) value = {state:'ready',enabled:true,eligibleBookings:1,checkedAt:now,items:[{label:'Sample booking',confirmationAt:'2026-10-28',bookingUrl:'https://airtable.com/app00000000000001/tbl00000000000002/'+rid(40)}]};
        else if (path.endsWith('/family-followups') && homeQueues && role==='owner') value={state:'ready',checkedAt:now,enabled:true,items:[],eligibleBookings:0};
        else if (path.endsWith('/families') && familyAccess) value = { families };
        else if (path.endsWith('/needs-attention/inquiries') && familyAccess && payload.completionToken==='fixture-row') {reportCompleted=payload.completed;value={completed:reportCompleted};}
        else if (path.includes('/needs-attention/') && familyAccess) {
          const item={key:'sample',completed:reportCompleted===true,reopened:reportCompleted===false,completionToken:'fixture-row',receipt:'fixture-receipt',title:'Session question',date:'2026-10-29',status:'Awaiting reply',href:'https://mail.google.com/mail/u/0/#all/123456789ab'};
          const show=path.endsWith('/inquiries')&&(payload.history?reportCompleted!==null:reportCompleted===null);
          value={items:show?[item]:[],resolved:[],next:null,inbox:'https://mail.google.com/'};
        }
        else if (path.endsWith('/family') && familyAccess && payload.familyId === rid(50)) value = {family:sampleRecord};
        else if (path.endsWith('/family') && familyAccess && payload.familyId === rid(51)) value = {family:{
          name:sampleFamilies[1].name, guardian:'Casey Example', email:'casey@example.test', players:['Rowan'],
          playerProfiles:[{id:rid(103),name:'Rowan',notes:[],attendance:[]}], registrations:[],bookings:[],payments:[]
        }};
        else if (path.endsWith('/session')) value = { plan: { session_id: payload.sessionId, version: 0, content: {} } };
        else if (path.endsWith('/users') && role === 'owner') value = { users: [{ ...state.profile, active: 1, session_version: 1, assignments: [] }], credentials: [] };
        else if (path.endsWith('/audit') && role !== 'coach') value = { events: [{ id: 'fictional-event', action: 'plan-updated', actor_email: state.profile.email, occurred_at: now, detail: '{}' }] };
        else if (path.endsWith('/legacy-notes') && role !== 'coach') value = { notes: [] };
        else if (path.endsWith('/diagrams/list')) value = { diagrams: [] };
        else if (path.endsWith('/drills/list')) value = { drills: [] };
        else if (path.endsWith('/refresh')) value = includeDesk ? desk : { profile: state.profile, sessions:roster, observedAt: now };
        else if (path.endsWith('/logout')) { state.profile = null; value = { signedOut: true }; }
        else { errors.push('Unexpected fixture action: ' + request.method() + ' ' + path); return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"FICTIONAL_FORBIDDEN"}' }); }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(6000); page.on('pageerror', error => errors.push(error.message));
      await page.goto(origin + '/workspace' + hash); await page.locator('#app').waitFor({ state: 'visible' });
      return { page, context, state, requests, errors, answer: value => page.evaluate(value => fixtureAnswers.push(value), value) };
    }
    {
      const f=await fixture({homeQueues:true,roster:[]});
      const inbox=f.page.locator('#home-mail-summary');
      await inbox.getByText('Review inbox · 1 inquiry',{exact:true}).waitFor();
      await inbox.click();
      await f.page.getByRole('button',{name:'Mark complete: Session question'}).click();
      await f.page.getByText('Moved to completed.').waitFor();
      await openDestination(f.page,'home');
      await f.page.waitForLoadState('networkidle');
      assert(await f.page.locator('#home-attention').isHidden());
      assert(await f.page.locator('.home-command-row').isHidden());
      await openDestination(f.page,'attention');
      await f.page.getByRole('button',{name:'Show completed',exact:true}).click();
      await f.page.getByRole('button',{name:'Reopen: Session question'}).click();
      await f.page.getByText('Moved to inbox.').waitFor();
      await openDestination(f.page,'home');
      await inbox.getByText('Review inbox · 1 inquiry',{exact:true}).waitFor();
      assert(await f.page.locator('#home-registration-review').isHidden());
      assert.deepEqual(f.errors,[]); await f.context.close(); checks++;
    }
    const clickSettings = async f => { if (await f.page.locator('body').evaluate(body => body.classList.contains('planner-focus-mode'))) { await f.page.locator('#planner-home').click(); if (await f.page.locator('body').evaluate(body => body.classList.contains('planner-focus-mode'))) return; } await openDestination(f.page, 'settings'); };
    const section = (f, name) => f.page.locator('#settings-navigation [data-settings-tab="' + name + '"]');
    const count = (f, suffix) => f.requests.filter(r => r.path.endsWith(suffix)).length;

    {
      const familyUrl='https://airtable.com/app00000000000001/tbl00000000000003/'+rid(50);
      const roster=[{...sessions[0],issues:[{player:'Jamie',reason:'Parent email missing',action:{label:'Review family contact',href:familyUrl}}]}];
      const f=await fixture({followups:true,roster});
      await f.page.getByRole('button',{name:/Roster details to review/}).click();
      assert.equal(await f.page.getByRole('link',{name:'Review family contact'}).getAttribute('href'),familyUrl);
      await f.page.locator('#report-open').click();
      await f.page.goBack();
      await f.page.getByRole('link',{name:'Review family contact'}).waitFor();
      await openDestination(f.page,'home');
      await f.page.locator('#home-registration-review').click();
      assert.equal(await f.page.locator('#roster-review-type').inputValue(),'registrations');
      assert.equal(await f.page.getByRole('link',{name:'Review booking · Sample booking'}).getAttribute('href'),'https://airtable.com/app00000000000001/tbl00000000000002/'+rid(40));
      assert.equal(await f.page.locator('#report-mail').isVisible(),false);
      assert.deepEqual(f.errors,[]); await f.context.close(); checks++;
    }
    await require('./coach-navigation-load-cases.cjs')(fixture); checks++;
    await require('./coach-books-ui-cases.cjs')(fixture); checks++;

    for (const role of ['owner', 'admin', 'coach']) {
      const f = await fixture({ role }); await clickSettings(f);
      assert.equal(await f.page.locator('#panel-settings').isVisible(), true);
      assert.deepEqual(await f.page.locator('#navigation button[data-tab]').evaluateAll(buttons=>buttons.map(button=>button.dataset.tab)), ['home','plan','profiles','library','coaches','families','books','attention','settings'], 'Main navigation contains only active coaching sections');
      assert.equal(await f.page.locator('#navigation [data-tab="coaches"]').isVisible(), role !== 'coach', 'Coaching team is restricted to full-access roles');
      assert.equal(await f.page.locator('#navigation [data-tab="team"],#navigation [data-tab="activity"],#navigation [data-tab="legacy"]').count(), 0);
      assert.equal(await f.page.locator('#profile-name').innerText(), 'Fictional ' + role);
      assert.equal(await f.page.locator('#profile-email').innerText(), 'fictional-' + role + '@example.test');
      assert.match(await f.page.locator('#profile-role').innerText(), role === 'admin' ? /admin/i : new RegExp(role, 'i'));
      assert(!(await f.page.locator('#profile-role').innerText()).includes('\uFFFD'), 'Role labels have no broken character encoding');
      assert.equal(await f.page.locator('#profile-name input,#profile-email input').count(), 0, 'Identity is not a misleading editable form');
      assert.equal(await f.page.locator('#session-toolbar').isVisible(), false);
      assert.equal(count(f, '/users') + count(f, '/audit') + count(f, '/legacy-notes'), 0, 'Profile does not read administrative data');
      assert.equal(await section(f, 'team').isVisible(), role === 'owner');
      assert.equal(await section(f, 'activity').isVisible(), role !== 'coach');
      assert.equal(await section(f, 'legacy').isVisible(), role !== 'coach');
      if (role === 'owner') {
        await section(f, 'team').click(); await f.page.waitForFunction(() => document.getElementById('user-list').textContent.includes('Fictional owner'));
        assert.equal(await f.page.locator('#panel-team').isVisible(), true); assert.equal(await f.page.locator('#session-toolbar').isVisible(), false); assert.equal(count(f, '/users'), 1);
      } else {
        await section(f, 'team').evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(await f.page.locator('#panel-team').isVisible(), false); assert.equal(count(f, '/users'), 0, 'Hidden owner navigation cannot grant access');
      }
      if (role !== 'coach') {
        await section(f, 'activity').click(); await f.page.waitForFunction(() => document.getElementById('activity-list').textContent.includes('plan updated'));
        assert.equal(await f.page.locator('#session-toolbar').isVisible(), false); assert.equal(count(f, '/audit'), 1);
        await section(f, 'legacy').click(); assert.equal(count(f, '/legacy-notes'), 0, 'Legacy import stays explicitly loaded');
        await f.page.locator('#load-legacy').click(); await f.page.waitForFunction(() => document.getElementById('legacy-list').textContent.includes('No written'));
      } else {
        for (const tab of ['activity', 'legacy']) await section(f, tab).evaluate(button => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
        assert.equal(count(f, '/audit') + count(f, '/legacy-notes'), 0); assert.equal(await f.page.locator('#panel-settings').isVisible(), true);
      }
      assert.deepEqual(f.errors, []); checks++; await f.context.close();
    }

    {
      const base = sessions[0], sibling = sessions[1].players[0];
      const slot = (n,date,extra={}) => ({...base, id:rid(n), date, time:'3:45–5:15 PM', location:'Connaught Park', programId:rid(600), ...extra});
      const roster = [
        slot(1,'2026-11-04',{players:[...base.players,sibling]}), slot(2,'2026-11-11'),
        slot(3,'2026-11-06'), slot(4,'2026-11-08',{time:'9:00–10:30 AM',location:'Kitsilano Turf'}),
        slot(5,'2026-12-21',{label:'Winter Camp',programId:null}), slot(6,'2026-12-22',{label:'Winter Camp',programId:null,players:[sibling]}),
        slot(7,'2026-12-28',{label:'Winter Camp',programId:null,players:[]}),
        slot(8,'2026-11-20',{proD:true,programId:null,location:'Kitsilano Turf',time:'12:00–3:00 PM'})
      ];
      const families = [sampleFamilies[0],{id:rid(51),name:'Unplaced family',playerIds:[]}];
      const f = await fixture({roster,families});
      await openDestination(f.page,'families');
      await f.page.getByRole('button',{name:'By session'}).click();
      const sections = f.page.locator('.family-session');
      await sections.first().waitFor();
      const headings = await sections.locator('summary').allTextContents();
      assert.deepEqual(headings,[
        'Wednesday · 3:45–5:15 PM · Connaught Park1 family','Friday · 3:45–5:15 PM · Connaught Park1 family',
        'Sunday · 9:00–10:30 AM · Kitsilano Turf1 family','Winter Camp — Week 11 family','Winter Camp — Week 20 families',
        'Pro-D Camp · Nov 20, 2026 · Kitsilano Turf1 family','No linked session1 family'
      ]);
      for (const width of [390,320]) {
        await f.page.setViewportSize({width,height:900});
        assert(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (width === 390) {
          await sections.first().locator('summary').click();
          fs.mkdirSync('outputs',{recursive:true});
          await f.page.locator('#family-directory').screenshot({path:'outputs/families-by-session-mobile.png'});
          await sections.first().locator('summary').click();
        }
      }
      for (const idx of [0,1,2,3,5]) {
        await sections.nth(idx).locator('summary').click();
        assert.deepEqual(await sections.nth(idx).locator('.family-choice').allTextContents(),[sampleFamilies[0].name]);
      }
      await sections.nth(4).locator('summary').click();
      assert(await sections.nth(4).getByText('No linked families yet.').isVisible());
      await sections.first().locator('.family-choice').click();
      await f.page.getByText('Alex · Camp').waitFor();
      assert.deepEqual(f.errors,[]); await f.context.close(); checks++;
    }
    for (const [role, familyAccess] of [['coach',false],['admin',false],['admin',true],['owner',true]]) {
      const f = await fixture({ role, familyAccess });
      await openDestination(f.page,'home');
      assert.equal(await f.page.locator('#nav-families').isVisible(),familyAccess);
      assert.equal(await f.page.locator('#panel-families').isVisible(),false);
      assert.equal(count(f,'/families'),0);
      if (familyAccess) {
        await openDestination(f.page,'families');
        assert.equal(await f.page.locator('#page-title').innerText(),'Families');
        assert.equal(await f.page.locator('#nav-families').getAttribute('aria-current'),'page');
        await f.page.locator('.families-grid .family-choice').waitFor();
        await f.page.getByRole('button',{name:'List',exact:true}).click();
        await f.page.locator('.families-list .family-choice').waitFor();
        await f.page.getByRole('button',{name:'By session'}).click();
        await f.page.locator('.family-session summary').click();
        await f.page.locator('.family-session .family-choice').click();
        await f.page.getByText('Alex · Camp').waitFor();
        assert.match(await f.page.locator('#family-results').innerText(), /Verified receipts/);
        await openDestination(f.page,'attention');
        const done=f.page.getByRole('button',{name:'Mark complete: Session question'});
        await done.waitFor();
        assert.equal(await f.page.locator('.report-filter').count(),role==='owner'?5:4);
        await done.click();await f.page.getByText('Moved to completed.').waitFor();
        assert(await f.page.locator('#home-mail-summary').evaluate(button=>button.hidden));
        await f.page.locator('#attention-refresh').click();
        await f.page.getByRole('button',{name:'Show completed',exact:true}).click();
        const reopen=f.page.getByRole('button',{name:'Reopen: Session question'});
        await reopen.waitFor();
        await f.page.getByRole('searchbox').fill('does not match');
        await f.page.getByText('No reports match your search.').waitFor();
        await f.page.getByRole('searchbox').fill('question');
        await reopen.click();await f.page.getByText('Moved to inbox.').waitFor();
        await f.page.locator('#report-open').click();await done.waitFor();
        await f.page.locator('#attention-refresh').click();await done.waitFor();
        assert.equal(await f.page.locator('#home-mail-summary').textContent(),'Review inbox · 1 inquiry');
        await f.page.locator('#logout').click();
        await f.page.locator('#login').waitFor();
        assert.equal(await f.page.locator('#family-results').textContent(),'');
      }
      assert.deepEqual(f.errors,[]); await f.context.close();
      const direct=await fixture({role,familyAccess,hash:'#view=families'});
      if(familyAccess)await direct.page.locator('#family-directory .family-choice').waitFor();
      else await direct.page.waitForFunction(()=>location.hash!=='#view=families' && !document.getElementById('app').hidden);
      assert.equal(await direct.page.locator('#panel-families').isVisible(),familyAccess);
      assert.equal(count(direct,'/families'),familyAccess?1:0);
      assert.deepEqual(direct.errors,[]); await direct.context.close(); checks++;
    }
    {
      const f = await fixture({families:sampleFamilies});
      const page = f.page, directory = page.locator('#family-directory'), profile = page.locator('#family-results');
      await openDestination(page,'families');
      const listMode = page.getByRole('button',{name:'List',exact:true});
      await listMode.click();
      const choices = directory.locator('.families-list .family-choice');
      await choices.first().waitFor();
      assert.deepEqual(await choices.allTextContents(),sampleFamilies.map(family=>family.name));
      for (const width of [1365,390,320]) {
        await page.setViewportSize({width,height:950});
        await choices.first().hover();
        const [first,second,third] = await choices.evaluateAll(nodes=>nodes.map(node=>{
          const {left,top,right,height}=node.getBoundingClientRect();return {left,top,right,height};
        }));
        assert.equal(first.top,second.top,'Two families share the row at '+width);
        assert(second.left>=first.right && third.top>=first.top+first.height,'Rows have no overlap at '+width);
        assert.equal(first.left,third.left);
        assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Family list fits at '+width);
        if(width!==320) {
          fs.mkdirSync('outputs',{recursive:true});
          await page.locator('#panel-families').screenshot({path:'outputs/families-list-'+(width===390?'mobile':'desktop')+'.png'});
        }
      }
      async function contrast(locator) {
        return locator.evaluate(el=>{
          const rgb=value=>value.match(/[\d.]+/g)?.map(Number);
          const luminance=values=>values.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((total,v,i)=>total+v*[.2126,.7152,.0722][i],0);
          const fg=rgb(getComputedStyle(el).color); let bg= [255,255,255];
          for(let ancestor=el;ancestor;ancestor=ancestor.parentElement){
            const parsed=rgb(getComputedStyle(ancestor).backgroundColor);
            if(parsed && (parsed.length===3 || parsed[3]===1)){bg=parsed;break;}
          }
          const values=[luminance(fg),luminance(bg)].sort((a,b)=>b-a);
          return (values[0]+.05)/(values[1]+.05);
        });
      }
      assert(await contrast(choices.first())>=4.5,'Hovered family name remains readable');
      assert(await contrast(listMode)>=4.5,'Selected list control remains readable');
      await page.setViewportSize({width:390,height:950});
      await choices.first().focus();await page.keyboard.press('Enter');
      await profile.getByText('Practised looking up before passing.').waitFor();
      const detailHash=new URL(page.url()).hash;
      assert.equal(detailHash,'#view=families&family='+rid(50));
      assert(await directory.isHidden());
      assert.equal(await page.locator('#page-title').innerText(),sampleFamilies[0].name);
      const cards=profile.locator('.family-player');
      assert.match(await cards.nth(0).innerText(), /45\.00[\s\S]*0\.00[\s\S]*Paid to date/);
      assert.match(await cards.nth(1).innerText(), /15\.00[\s\S]*15\.00[\s\S]*Payment pending/);
      const content=await profile.innerText();
      for(const text of ['Jamie','Alex','Coaching notes','Attendance records','Present','morgan@example.test','Verified receipts','EXAMPLE-001'])assert(content.includes(text),text+' appears on the family page');
      const ordered=['Players','Coaching notes','Attendance records','Contact information','Family records','Payments'];
      assert(ordered.every(title=>content.includes(title)),'Every section is labelled');
      assert.deepEqual(ordered.slice().sort((a,b)=>content.indexOf(a)-content.indexOf(b)),ordered);
      await page.locator('#desk-main').screenshot({path:'outputs/family-profile-mobile.png'});
      await page.setViewportSize({width:1365,height:950});
      await page.locator('#desk-main').screenshot({path:'outputs/family-profile-desktop.png'});
      await page.goBack(); await choices.first().waitFor();
      assert.equal(await listMode.getAttribute('aria-pressed'),'true');
      await choices.nth(1).click(); await profile.getByText('casey@example.test').waitFor();
      assert(!(await profile.innerText()).includes('Practised looking up before passing.'));
      await page.locator('#family-back').click(); await choices.nth(1).waitFor();
      await page.getByRole('button',{name:'Grid',exact:true}).click();
      await directory.getByRole('link',{name:/Morgan Sample/}).click();
      await profile.getByText('morgan@example.test').waitFor();
      await page.reload(); await profile.getByText('morgan@example.test').waitFor();
      assert.deepEqual(f.errors,[]); await f.context.close();
      const denied=await fixture({role:'coach',familyAccess:false,hash:detailHash});
      await denied.page.locator('#panel-home').waitFor();
      assert.equal(count(denied,'/family')+count(denied,'/families'),0);
      assert(await denied.page.locator('#panel-families').isHidden());
      assert.deepEqual(denied.errors,[]); await denied.context.close(); checks++;
    }
    const renamed = await fixture({ displayEmail: 'Renamed@example.test' });
    await clickSettings(renamed);
    assert.equal(await renamed.page.locator('#profile-email').innerText(), 'Renamed@example.test');
    assert.match(await renamed.page.locator('#identity').innerText(), /Renamed@example\.test/);
    await section(renamed, 'team').click();
    await renamed.page.getByText('Renamed@example.test · Owner · Active', { exact: true }).waitFor();
    assert.equal(renamed.state.profile.email, 'fictional-owner@example.test');
    assert.deepEqual(renamed.errors, []); checks++; await renamed.context.close();

    const p = await fixture();
    assert.equal(await p.page.locator('#home-notes,#go-notes').count(), 0, 'Overview no longer includes the recent-notes widget');
    await p.page.locator('#open-profile').click();
    assert.equal(await p.page.locator('#preference-density,#preference-motion').count(), 0);
    const normalSize = await p.page.locator('.preference-preview p').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    await p.page.locator('#preference-text-size').selectOption('large');
    assert(await p.page.locator('.preference-preview p').evaluate(el => parseFloat(getComputedStyle(el).fontSize)) > normalSize, 'Reading size changes rendered text immediately');
    assert.equal(await p.page.locator('#note-body').evaluate(el => getComputedStyle(el).fontSize), '18px', 'The preference changes the actual note editor');
    await p.page.locator('#preference-session-view').selectOption('calendar');
    await p.page.locator('#preference-start').selectOption('plan');
    const stored = await p.page.evaluate(key => JSON.parse(localStorage.getItem(key)), key);
    assert.deepEqual(stored, { start: 'plan', textSize: 'large', sessionView: 'calendar' });
    assert.equal(p.requests.filter(r => r.method === 'POST').length, 0, 'Preferences do not make remote writes');
    await p.page.locator('#navigation [data-tab="home"]').click();
    assert.equal(await p.page.locator('#coaching-hub').getAttribute('data-coach-view'), 'calendar');
    assert.equal(await p.page.locator('#coaching-hub .coach-calendar').isVisible(), true);
    await p.page.locator('#navigation [data-tab="plan"]').click();
    assert.equal(await p.page.locator('#planner-session-browser').getAttribute('data-coach-view'), 'calendar');
    await p.page.reload(); await p.page.locator('#panel-plan').waitFor({ state: 'visible' });
    assert.equal(await p.page.locator('#planner-session-browser').getAttribute('data-coach-view'), 'calendar');
    assert.equal(await p.page.locator('#note-body').evaluate(el => getComputedStyle(el).fontSize), '18px'); checks++;
    await clickSettings(p); await p.page.locator('#preference-session-view').selectOption('list');
    await p.page.locator('#navigation [data-tab="home"]').click(); assert.equal(await p.page.locator('#coaching-hub').getAttribute('data-coach-view'), 'list');
    await p.page.locator('#navigation [data-tab="plan"]').click(); assert.equal(await p.page.locator('#planner-session-browser').getAttribute('data-coach-view'), 'list');
    await clickSettings(p); await p.page.locator('#reset-preferences').click();
    assert.equal(await p.page.locator('#preference-start').inputValue(), 'home');
    assert.equal(await p.page.locator('#preference-text-size').inputValue(), 'standard');
    assert.equal(await p.page.locator('#preference-session-view').inputValue(), 'grid');
    assert.equal(await p.page.locator('#planner-session-browser').getAttribute('data-coach-view'), 'grid');
    assert.equal(await p.page.locator('.preference-preview p').evaluate(el => parseFloat(getComputedStyle(el).fontSize)), normalSize);
    assert.equal(await p.page.evaluate(key => localStorage.getItem(key), key), null);
    await p.page.locator('#copy-workspace-link').click(); assert.equal(await p.page.evaluate(() => fixtureCopied), origin + '/workspace');
    await p.page.goto(origin + '/workspace'); await p.page.locator('#panel-home').waitFor({ state: 'visible' }); assert.deepEqual(p.errors, []); checks++;
    for (const start of ['profiles', 'library']) {
      await clickSettings(p); await p.page.locator('#preference-start').selectOption(start);
      await p.page.goto(origin + '/workspace'); await p.page.locator('#panel-' + start).waitFor({ state: 'visible' });
    }
    assert.deepEqual(p.errors, []); checks++; await p.context.close();

    for (const stored of ['{broken', JSON.stringify({ start: 'team', textSize: 'anything', sessionView: 'all', owner: true })]) {
      const bad = await fixture({ role: 'coach', stored }); assert.equal(await bad.page.locator('#panel-home').isVisible(), true);
      await clickSettings(bad); assert.equal(await bad.page.locator('#preference-text-size').inputValue(), 'standard'); assert.equal(await bad.page.locator('#preference-session-view').inputValue(), 'grid'); assert.deepEqual(bad.errors, []); await bad.context.close();
    }
    const legacy = await fixture({ stored: JSON.stringify({start:'attendance',density:'compact',reduceMotion:true}) });
    assert.equal(await legacy.page.locator('#panel-plan').isVisible(), true, 'Old attendance startup setting migrates to Training groups');
    await clickSettings(legacy); assert.equal(await legacy.page.locator('#preference-start').inputValue(), 'plan'); assert.equal(await legacy.page.locator('#preference-text-size').inputValue(), 'standard'); assert.deepEqual(legacy.errors, []); await legacy.context.close();
    const blocked = await fixture({ deniedStorage: true }); await clickSettings(blocked); await blocked.page.locator('#preference-text-size').selectOption('large');
    assert.equal(await blocked.page.locator('#note-body').evaluate(el => getComputedStyle(el).fontSize), '18px'); assert.match(await blocked.page.locator('#preferences-status').innerText(), /Applied for this visit/); assert.deepEqual(blocked.errors, []); await blocked.context.close(); checks++;

    const d = await fixture(); await openSession(d.page, sessions, rid(1), 'plan'); await d.page.waitForFunction(() => !document.getElementById('plan-focus').disabled);
    await d.page.locator('#plan-focus').fill('Fictional unsaved plan'); await d.answer(false); await clickSettings(d);
    assert.equal(await d.page.locator('#panel-plan').isVisible(), true); assert.equal(await d.page.locator('#plan-focus').inputValue(), 'Fictional unsaved plan');
    await d.answer(true); await clickSettings(d); assert.equal(await d.page.locator('#panel-settings').isVisible(), true);
    await openSession(d.page, sessions, rid(1), 'plan'); await d.page.locator('#planner-open-tools').click(); await d.page.waitForFunction(() => !document.getElementById('tactics-title').disabled);
    await d.page.locator('#tactics-title').fill('Fictional unsaved drill'); await d.page.locator('#planner-close-drawer').click(); await d.answer(false); await clickSettings(d);
    assert.equal(await d.page.locator('#panel-plan').isVisible(), true); assert.equal(await d.page.locator('#tactics-title').inputValue(), 'Fictional unsaved drill');
    await d.answer(true); await clickSettings(d); assert.equal(await d.page.locator('#panel-settings').isVisible(), true); assert.deepEqual(d.errors, []); checks++;

    await d.page.locator('#preference-text-size').selectOption('large');
    for (const width of [1365, 390, 320]) {
      await d.page.setViewportSize({ width, height: 950 });
      if (width < 900) {
        const settings = d.page.locator('#navigation [data-tab="settings"]'), more = d.page.locator('.desk-nav-more');
        // Resizing can finish before the browser dispatches the matchMedia change event.
        await settings.waitFor({ state: 'hidden' }); await more.waitFor({ state: 'visible' });
        assert(await settings.isHidden());
        await more.click(); assert(await settings.isVisible());
        await settings.click(); assert.equal(await more.getAttribute('aria-expanded'), 'false');
      }
      assert(await d.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow at ' + width);
      for (const id of ['open-profile', 'preference-start', 'preference-text-size', 'preference-session-view', 'reset-preferences', 'copy-workspace-link']) {
        const box = await d.page.locator('#' + id).boundingBox(); assert(box && box.height >= 43, id + ' retains a touch target at ' + width);
      }
    }
    const contrast = await d.page.evaluate(() => {
      const luminance = value => { const rgb = value.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]; };
      const background = luminance(getComputedStyle(document.querySelector('.profile-card')).backgroundColor);
      return ['#profile-role', '.profile-help'].map(selector => { const foreground = luminance(getComputedStyle(document.querySelector(selector)).color); return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05); });
    });
    assert(contrast.every(ratio => ratio >= 4.5), 'Small text on the dark profile card stays readable');
    await d.page.setViewportSize({ width: 1365, height: 950 }); await d.page.evaluate(() => window.scrollTo(0, 0)); fs.mkdirSync('outputs', { recursive: true }); await d.page.screenshot({ path: 'outputs/coach-settings-desktop.png', fullPage: true });
    await d.page.setViewportSize({ width: 390, height: 950 }); await d.page.evaluate(() => window.scrollTo(0, 0)); await d.page.screenshot({ path: 'outputs/coach-settings-mobile.png', fullPage: true }); checks++;
    await d.page.locator('#logout').click(); await d.page.locator('#login').waitFor({ state: 'visible' });
    for (const id of ['profile-name', 'profile-email', 'profile-role', 'profile-scope', 'profile-signin']) assert.equal((await d.page.locator('#' + id).textContent()).trim(), '', id + ' clears on sign-out');
    assert.equal(await d.page.locator('#app').isVisible(), false); assert.deepEqual(d.errors, []); checks++;
    await d.context.close();

    const hash = await fixture({ role: 'coach', stored: JSON.stringify({ start: 'plan', density: 'comfortable', reduceMotion: false }), hash: '#view=settings' });
    assert.equal(await hash.page.locator('#panel-settings').isVisible(), true, 'Explicit profile link overrides saved starting view'); assert.equal(count(hash, '/users') + count(hash, '/audit'), 0); assert.deepEqual(hash.errors, []); checks++;
    await hash.context.close();
    console.log('Coach settings UI: ' + checks + ' grouped role, preference, privacy, draft and responsive checks passed. Fictional data only.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
