const assert = require('node:assert/strict');

// A fresh signed-in browser for every entry. The caller supplies the same
// intercepted backend used by the role and navigation tests.
module.exports = async function checkNavigation(fixture, {benchmarkOnly = false} = {}) {
  const rid = n => 'rec' + String(n).padStart(14, '0');
  const samples = {};
  async function visit(name, options, checkReady, interact) {
    const start = performance.now();
    const f = await fixture({homeQueues:true, ...options});
    try {
      await checkReady(f.page);
      const readyMs = Math.round(performance.now() - start);
      if (interact) await interact(f.page);
      await f.page.waitForLoadState('networkidle');
      assert.deepEqual(f.errors, [], name);
      const counts = {};
      for (const r of f.requests) {
        let operation = r.path.split('/api/').pop();
        if (operation === 'session') operation += '/' + r.payload.sessionId;
        if (operation.startsWith('needs-attention/')) operation += r.payload?.history ? '/history' : '/live';
        counts[operation] = (counts[operation] || 0) + 1;
      }
      samples[name] = {readyMs, counts};
      return counts;
    } finally {
      await f.context.close();
    }
  }
  const directory = await visit('family-directory', {hash:'#view=families'},
    page => page.locator('#family-directory .family-choice').first().waitFor(), async page => {
      await page.locator('#family-directory .family-choice').first().click();
      await page.locator('#family-results').getByText('Practised looking up before passing.').waitFor();
      await page.locator('#family-back').click();
      await page.locator('#family-directory .family-choice').first().waitFor();
    });
  const detail = await visit('direct-family', {hash:'#view=families&family='+rid(50)},
    page => page.locator('#family-results').getByText('morgan@example.test').waitFor());
  const reports = await visit('reports', {hash:'#view=reports'},
    page => page.getByRole('link',{name:'Session question'}).waitFor());
  const chooser = await visit('training-groups', {hash:'#view=plan'},
    page => page.locator('#planner-days [data-group-key]').first().waitFor());
  const chosen = await visit('direct-training-session', {hash:'#view=plan&session='+rid(2)+'&section=attendance'},
    async page => {
      await page.locator('#session-workspace-tabs').waitFor();
      await page.locator('#roster').getByText('Fictional player 2',{exact:true}).waitFor();
      assert.equal(await page.locator('#session').inputValue(),rid(2));
    });
  const restricted = await visit('restricted-reports', {hash:'#view=reports',role:'coach',familyAccess:false},
    async page => {
      await page.locator('#panel-home').waitFor();
      assert(await page.locator('#panel-attention').isHidden());
    });
  const fallback = await visit('bootstrap-fallback', {hash:'#view=families',bundleDesk:false},
    page => page.locator('#family-directory .family-choice').first().waitFor());
  if (benchmarkOnly) return samples;
  const home = await visit('owner-home', {hash:'#view=home'}, async page => {
    await page.locator('#family-followup-state').getByText(/0 eligible bookings/).waitFor();
    await page.locator('#home-mail-summary').getByText(/1 inquiries/).waitFor();
  });
  const refresh = await visit('refresh-groups', {hash:'#view=plan',refreshRoster:[]},
    page => page.locator('#planner-days [data-group-key]').first().waitFor(), async page => {
      await page.getByRole('button',{name:'Refresh roster',exact:true}).click();
      await page.locator('#planner-days').getByText('No assigned training groups yet.').waitFor();
    });
  assert.equal(home['family-followups'],1,'The actual owner Home still displays registration follow-ups');
  assert.equal(refresh.refresh,1,'One refresh displays the newly scoped roster');
  assert.equal(directory.families,1,'Returning from a profile reuses the directory');
  assert.equal(directory.family,1);
  assert.equal(detail.family,1);
  assert(!detail.families,'Direct family profiles need no directory lookup');
  assert(!Object.keys(chooser).some(key=>key.startsWith('session/')),'The group chooser does not open a dated plan');
  assert(!Object.keys(chosen).some(key=>key.startsWith('session/') && key!=='session/'+rid(2)),'A deep link must only load its selected session');
  for (const counts of [directory,detail,chooser,chosen,restricted,fallback,refresh]) {
    assert(!Object.keys(counts).some(key=>key.startsWith('needs-attention/')),'Only Reports or eligible Home navigation may fetch reports');
    assert(!counts['family-followups'],'No owner Home follow-ups on another destination or for a restricted coach');
  }
  assert(!reports['family-followups']);
  for (const counts of [reports,home]) {
    for (const category of ['inquiries','registrations','payments','other']) {
      for (const source of ['live','history']) {
        assert.equal(counts['needs-attention/' + category + '/' + source],1,'An authorized owner sees current and saved reports');
      }
    }
  }
  assert(!Object.keys(restricted).some(key=>/family|families/.test(key)));
  for (const [name,{counts}] of Object.entries(samples)) {
    assert.equal(counts.bootstrap,1);
    assert.equal(counts.desk || 0,name === 'bootstrap-fallback' ? 1 : 0,'Use the bundled desk when present and recover when absent');
    assert(Object.values(counts).every(n=>n===1),'No duplicate calls for a destination');
  }
  return samples;
};
