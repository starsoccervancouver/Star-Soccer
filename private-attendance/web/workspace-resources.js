/* Coach Resources: private bookmarks and reusable coaching references. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id), host = $('coach-resources'); if (!host) return;
  const node = (tag, text = '', cls = '') => { const el = document.createElement(tag); el.textContent = String(text ?? ''); if (cls) el.className = cls; return el; };
  const button = (text, handler, cls = 'secondary') => { const el = node('button', text, cls); el.type = 'button'; el.addEventListener('click', handler); return el; };
  const label = (text, input) => { const el = node('label', text); el.htmlFor = input.id; el.append(input); return el; };
  const select = (id, options) => { const el = node('select'); el.id = id; for (const [value, text] of options) el.append(new Option(text, value)); return el; };
  const kinds = {video:'Video',article:'Article',document:'Document',podcast:'Podcast',tool:'Tool',other:'Other'};
  const fields = ['title','url','kind','topic','notes','favourite'], blank = () => ({title:'',url:'',kind:'video',topic:'',notes:'',favourite:false});
  const signature = value => JSON.stringify(fields.map(key => value[key]));
  function safeUrl(raw) { try { const url = new URL(raw); return url.protocol === 'https:' && url.hostname && !url.username && !url.password ? url.href : null; } catch { return null; } }
  let context = null, identity = '', epoch = 0, active = 'drills', records = [], loaded = false, loading = false, writing = false, recovery = null, record = null, baseline = signature(blank()), limit = 9;
  const allowed = row => context?.profile && (['owner','admin'].includes(context.profile.role) || row.author_email === context.profile.email);
  const ready = () => !!context?.profile && context.tab === 'library';
  const locked = () => !ready() || context.busy || loading || writing;
  const values = () => Object.fromEntries(fields.map(key => [key, key === 'favourite' ? $('resource-' + key).checked : $('resource-' + key).value.trim()]));
  const dirty = () => !!identity && (!!recovery || signature(values()) !== baseline);
  const request = (operation, payload = {}) => new Promise((resolve,reject) => window.dispatchEvent(new CustomEvent('coach:resources-request',{detail:{operation,payload,resolve,reject}})));
  const pane = $('resource-pane-inspiration'), status = node('p', '', 'resource-status'); status.id = 'resources-status'; status.setAttribute('role','status'); status.setAttribute('aria-live','polite'); pane.append(status);
  const notify = (message,error=false) => { status.textContent = message; status.setAttribute('role',error?'alert':'status'); };
  const toolbar = node('div', '', 'resource-toolbar'), search = node('input'); search.id = 'resources-search'; search.type = 'search'; search.placeholder = 'Title, topic or notes'; search.autocomplete = 'off';
  const filter = select('resources-kind', [['','All types'],...Object.entries(kinds)]), favourite = node('input'); favourite.id = 'resources-favourites'; favourite.type = 'checkbox';
  const favouriteLabel = label('Favourites only', favourite); favouriteLabel.className = 'resource-check';
  const add = button('Save a link', () => { if (locked() || recovery) return; if (dirty() && !confirm('Start a new link and discard this unsaved draft?')) return; reset(); editor.hidden = false; $('resource-title').focus(); }, 'button'); add.id = 'resource-add';
  const reload = button('Refresh links', () => load()); reload.id = 'resources-reload';
  toolbar.append(label('Find inspiration',search),label('Resource type',filter),favouriteLabel,add,reload); pane.append(toolbar);
  const editor = node('form', '', 'resource-editor'); editor.id = 'resource-form'; editor.hidden = true; editor.append(node('h3','Save inspiration'));
  const editorGrid = node('div', '', 'resource-editor-grid');
  for (const [key,title,max,type,required] of [['title','Title',120,'text',true],['url','Link',2048,'url',true],['topic','Topic (optional)',80,'text',false]]) {
    const input = node('input'); input.id = 'resource-'+key; input.type = type; input.maxLength = max; input.required = required; input.autocomplete = 'off'; if (key==='url') input.placeholder = 'https://…'; editorGrid.append(label(title,input));
  }
  editorGrid.append(label('Type',select('resource-kind',Object.entries(kinds)))); editor.append(editorGrid);
  const notes = node('textarea'); notes.id = 'resource-notes'; notes.maxLength = 2000; notes.rows = 3; notes.placeholder = 'What would you try or adapt?'; editor.append(label('Why save this? (optional)',notes));
  const star = node('input'); star.id = 'resource-favourite'; star.type = 'checkbox'; const starLabel = label('Mark as a favourite',star); starLabel.className = 'resource-check'; editor.append(starLabel);
  const actions = node('div', '', 'resource-actions'), save = node('button','Save link','button'); save.type = 'submit'; save.id = 'resource-save';
  const cancel = button('Cancel',()=>{if(locked())return;if(dirty()&&!confirm('Discard this unsaved link?'))return;reset();notify('');}); cancel.id='resource-cancel';
  actions.append(save,cancel);editor.append(actions);pane.append(editor);
  const recoveryBox=node('div','','resource-recovery'), retry=button('Retry same action',()=>{if(recovery&&!locked())persist(recovery);});retry.id='resources-retry';
  recoveryBox.append(node('p','The previous result is uncertain. Refresh to check it, or retry the same action.'),retry);recoveryBox.hidden=true;pane.append(recoveryBox);
  const count=node('p','','small');count.id='resources-count';count.setAttribute('role','status');
  const list=node('div','','resource-grid');list.id='resources-list';
  const more=button('Show more links',()=>{limit+=9;renderList();});more.id='resources-more';more.hidden=true;pane.append(count,list,more);
  pane.append(node('p','Your saved links are private to you and approved full-access coaches. Links open on their original websites; videos are not loaded automatically.','small'));
  function reset(next=null){record=next;const value=next||blank();for(const key of fields){if(key==='favourite')$('resource-'+key).checked=value[key];else $('resource-'+key).value=value[key];}baseline=signature(values());recovery=null;editor.hidden=true;editor.querySelector('h3').textContent=next?'Edit saved link':'Save inspiration';renderState();}
  function discard(){if(writing)return;reset();notify('');}
  window.CoachResources=Object.freeze({isDirty:dirty,isBusy:()=>writing,discard});
  function renderState(){
    for(const el of editor.querySelectorAll('input,select,textarea,button'))el.disabled=locked()||!!recovery;
    cancel.disabled=locked();add.disabled=locked()||!!recovery;reload.disabled=locked();reload.textContent=loading?'Loading…':'Refresh links';
    search.disabled=filter.disabled=favourite.disabled=locked();recoveryBox.hidden=!recovery;retry.disabled=locked();save.textContent=writing?'Saving…':record?'Save changes':'Save link';
    for(const el of list.querySelectorAll('button'))el.disabled=locked()||!!recovery;
    for(const el of host.querySelectorAll('[data-resource-tab]'))el.disabled=writing||!!context?.busy||!!window.CoachLibrary?.isBusy();
  }
  function edit(row){if(locked()||recovery||!allowed(row))return;if(dirty()&&!confirm('Edit this link and discard the unsaved draft?'))return;reset(row);editor.hidden=false;$('resource-title').focus();}
  const payloadFor=row=>({id:row.id,...Object.fromEntries(fields.map(key=>[key,row[key]])),expectedVersion:row.version});
  function renderList(){
    const query=search.value.trim().toLowerCase(),matching=records.filter(allowed).filter(row=>(!filter.value||row.kind===filter.value)&&(!favourite.checked||row.favourite)&&(!query||[row.title,row.url,row.topic,row.notes].join(' ').toLowerCase().includes(query))).sort((a,b)=>Number(b.favourite)-Number(a.favourite)||b.updated_at.localeCompare(a.updated_at));
    list.replaceChildren();count.textContent=loaded?Math.min(limit,matching.length)+' of '+matching.length+' saved links':'Your collection will appear here.';
    for(const row of matching.slice(0,limit)){
      const card=node('article','','resource-card');card.dataset.resourceId=row.id;
      card.append(node('p',[kinds[row.kind],row.topic].filter(Boolean).join(' · '),'resource-kind'));
      const heading=node('h3'),link=node('a',row.title+' ↗');link.href=safeUrl(row.url);link.target='_blank';link.rel='noopener noreferrer';heading.append(link);card.append(heading,node('p',new URL(row.url).hostname,'small'));
      if(row.notes)card.append(node('p',row.notes,'resource-description'));
      if(row.author_email!==context.profile.email)card.append(node('p','Saved by '+row.author_email,'small'));
      const controls=node('div','','resource-actions'),star=button(row.favourite?'★ Favourite':'☆ Favourite',()=>{if(dirty())return notify('Save or cancel your draft before changing a favourite.',true);persist({operation:'save',payload:{...payloadFor(row),favourite:!row.favourite}});});star.setAttribute('aria-pressed',String(row.favourite));
      controls.append(star,button('Edit',()=>edit(row)),button('Archive',()=>{if(dirty())return notify('Save or cancel your draft before archiving.',true);if(confirm('Archive this saved link?'))persist({operation:'archive',payload:{id:row.id,expectedVersion:row.version}});}));card.append(controls);list.append(card);
    }
    if(loaded&&!matching.length)list.append(node('p',records.length?'No links match. Try another search or filter.':'Start with a useful video, article or coaching document. Save a link above.','empty-state'));
    more.hidden=matching.length<=limit;renderState();
  }
  function verified(rows){if(!Array.isArray(rows)||new Set(rows.map(row=>row?.id)).size!==rows.length||rows.some(row=>!row||typeof row.id!=='string'||!Number.isSafeInteger(row.version)||row.version<1||typeof row.author_email!=='string'||typeof row.updated_at!=='string'||typeof row.request_id!=='string'||!Object.hasOwn(kinds,row.kind)||typeof row.favourite!=='boolean'||!['title','url','topic','notes'].every(key=>typeof row[key]==='string')||!safeUrl(row.url)))throw Error('Saved links could not be verified. Refresh and try again.');return rows.filter(allowed);}
  const matches=(row,payload)=>row&&(!payload.id?row.request_id===payload.requestId:row.id===payload.id)&&row.version===payload.expectedVersion+1&&signature(row)===signature(payload);
  async function load(){
    if(!ready()||locked())return;const ticket=++epoch,started=identity;loading=true;renderState();
    try{const result=await request('list');if(ticket!==epoch||started!==identity)return;records=verified(result.resources);loaded=true;
      if(recovery){const done=recovery.operation==='archive'?!records.some(row=>row.id===recovery.payload.id):records.some(row=>matches(row,recovery.payload));if(done){reset();notify('Your previous action is verified.');}else notify('The previous action is not verified yet. Retry the same action or review before discarding.',true);}
      else notify('Saved links are up to date.');renderList();
    }catch(error){if(ticket===epoch&&started===identity)notify(error.message||'Links could not load. Try Refresh links.',true);}
    finally{if(ticket===epoch&&started===identity){loading=false;renderState();}}
  }
  async function persist(attempt){
    if(locked()||!ready())return;const ticket=++epoch,started=identity;writing=true;recovery=null;renderState();notify('Saving…');
    try{const result=await request(attempt.operation,attempt.payload);if(ticket!==epoch||started!==identity)return;
      if(attempt.operation==='save'){const saved=verified([result.resource])[0];if(!matches(saved,attempt.payload))throw Error('Save readback mismatch');records=[saved,...records.filter(row=>row.id!==saved.id)];}
      else{if(result.saved!==true)throw Error('Archive readback mismatch');records=records.filter(row=>row.id!==attempt.payload.id);}
      reset();loaded=true;notify(attempt.operation==='save'?'Link saved to your collection.':'Link archived.');renderList();
    }catch(error){if(ticket!==epoch||started!==identity)return;if(!error.code)recovery=attempt;notify(error.code?error.message:'The result is uncertain. Your draft is kept; refresh or retry the same action.',true);}
    finally{if(ticket===epoch&&started===identity){writing=false;renderState();}}
  }
  editor.addEventListener('submit',event=>{event.preventDefault();if(locked()||recovery||!editor.reportValidity())return;const value=values(),url=safeUrl(value.url);if(!url)return notify('Use a full HTTPS link without a username or password.',true);value.url=url;const payload={...value,expectedVersion:record?.version||0,...(record?{id:record.id}:{requestId:crypto.randomUUID()})};persist({operation:'save',payload});});
  for(const el of editor.querySelectorAll('input,textarea,select'))el.addEventListener('input',renderState);
  search.addEventListener('input',()=>{limit=9;renderList();});filter.addEventListener('change',()=>{limit=9;renderList();});favourite.addEventListener('change',()=>{limit=9;renderList();});
  function selectPane(next,focus=false){
    if(!['drills','inspiration','guides'].includes(next)||!ready()||writing||context.busy||window.CoachLibrary?.isBusy())return;
    if(next!==active&&((active==='drills'&&window.CoachLibrary?.isDirty())||(active==='inspiration'&&dirty()))){if(!confirm('Switch resources and discard the unsaved draft?'))return;if(active==='drills')window.CoachLibrary.discard();else discard();}
    active=next;for(const tab of host.querySelectorAll('[data-resource-tab]')){const selected=tab.dataset.resourceTab===active;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus();}
    for(const section of host.querySelectorAll('[data-resource-pane]'))section.hidden=section.dataset.resourcePane!==active;
    if(active==='inspiration'&&!loaded&&!loading)load();
  }
  const tabs=[...host.querySelectorAll('[data-resource-tab]')];for(const tab of tabs){tab.addEventListener('click',()=>selectPane(tab.dataset.resourceTab));tab.addEventListener('keydown',event=>{const index=tabs.indexOf(tab),next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;if(next>=0){event.preventDefault();selectPane(tabs[next].dataset.resourceTab,true);}});}
  const guides=[
    ['Build a session','A repeatable outline you can adapt to your group.',['Focus: one skill or decision to practise.','Arrival: a simple activity with a ball.','Warm-up: movement and touches that introduce the focus.','Practice: clear instructions, short rounds and a progression.','Game: give players chances to apply the focus.','Review: what worked, and what to revisit next time.']],
    ['Adapt a drill','Keep the goal; adjust the challenge.',['Space: widen or narrow the playing area.','Numbers: change team sizes or add a supporting player.','Rules: adjust touches, targets or scoring.','Time: change work and rest intervals to suit the group.','Support: demonstrate, simplify or offer another way to take part.','Observe: change one thing, then see how players respond.']],
    ['Capture a useful observation','Make notes clear enough to use next week.',['Notice: describe the action you saw.','Context: note the activity or situation.','Progress: what improved or worked well?','Next step: choose one practical thing to try.','Keep player details in their private profile, not in reusable resources.']]
  ];
  const guideHost=$('resource-guides'),guideStatus=node('p','','small');guideStatus.setAttribute('role','status');guideHost.append(guideStatus);
  for(const [title,description,steps]of guides){const card=node('article','','resource-guide');card.append(node('h3',title),node('p',description,'small'));const list=node('ol');for(const text of steps)list.append(node('li',text));card.append(list);card.append(button('Copy outline',async()=>{const text=title+'\n\n'+steps.map((step,i)=>(i+1)+'. '+step).join('\n');try{await navigator.clipboard.writeText(text);guideStatus.textContent='Outline copied. Paste it into your session plan or notes.';}catch{guideStatus.textContent='Select and copy the outline below.';let field=card.querySelector('textarea');if(!field){field=node('textarea');field.readOnly=true;field.setAttribute('aria-label','Outline to copy');card.append(field);}field.value=text;field.focus();field.select();}}));guideHost.append(card);}
  const kit=node('article','','resource-guide');kit.append(node('h3','Session kit'),node('p','A reusable checklist for this visit. Checks reset at sign-out.','small'));
  for(const [index,text]of ['Balls and pump','Cones or markers','Bibs for teams','Goals or targets','Session plan and player roster','Water and weather-appropriate gear'].entries()){const input=node('input');input.type='checkbox';input.id='resource-kit-'+index;const item=label(text,input);item.className='resource-check';kit.append(item);}
  kit.append(button('Reset checklist',()=>kit.querySelectorAll('input').forEach(input=>input.checked=false)));guideHost.append(kit);
  window.addEventListener('coach:context',event=>{
    const next=event.detail,key=next?.profile?[next.profile.email,next.profile.role,next.profile.sessionVersion].join(':'):'';
    if(key!==identity){epoch++;identity=key;context=next;records=[];loaded=loading=writing=false;active='drills';search.value=filter.value='';favourite.checked=false;limit=9;reset();notify('');list.replaceChildren();count.textContent='';kit.querySelectorAll('input').forEach(input=>input.checked=false);guideStatus.textContent='';guideHost.querySelectorAll('textarea').forEach(el=>el.remove());}
    else context=next;
    if(!next?.profile)return;
    if(ready())selectPane(active);renderState();
  });
  reset();window.dispatchEvent(new CustomEvent('coach:request-context'));
})();
