(()=>{'use strict';
 const $=id=>document.getElementById(id),node=(tag,value='',cls='')=>{const e=document.createElement(tag);e.textContent=String(value??'');if(cls)e.className=cls;return e;};
 const club=window.CoachClub||{name:'Star Soccer',siteUrl:'https://starsoccer.ca/',timeZone:'America/Vancouver',trainingDays:[3,4,5,0]};
 const preferenceKey='coach-desk-display-v1',startViews=['home','attendance','notes','plan','profiles','library'];
 const preferenceDefaults=()=>({start:'home',textSize:'standard',sessionView:'grid'});
 const cleanPreferences=value=>{
  if(!value||typeof value!=='object'||Array.isArray(value)||!Object.keys(value).every(k=>['start','textSize','sessionView','density','reduceMotion'].includes(k))||!startViews.includes(value.start)||value.density!==undefined&&!['comfortable','compact'].includes(value.density)||value.reduceMotion!==undefined&&typeof value.reduceMotion!=='boolean'||value.textSize!==undefined&&!['standard','large'].includes(value.textSize)||value.sessionView!==undefined&&!['grid','list','calendar'].includes(value.sessionView))return preferenceDefaults();
  return {start:value.start==='notes'?'profiles':value.start==='attendance'?'plan':value.start,textSize:value.textSize||'standard',sessionView:value.sessionView||'grid'};
 };
 let preferences=preferenceDefaults();try{preferences=cleanPreferences(JSON.parse(localStorage.getItem(preferenceKey)));}catch{}
 function applyPreferences(){const changed=document.body.dataset.deskSessionView!==preferences.sessionView;document.body.dataset.deskTextSize=preferences.textSize;document.body.dataset.deskSessionView=preferences.sessionView;if(changed)window.CoachViews?.setDefaultView(preferences.sessionView);}
 applyPreferences();
 const settingsTabs=['settings','team','activity','legacy'];
 const fragment=new URLSearchParams(location.hash.slice(1));let googleFailure=location.hash==='#google-error',enrollment=fragment.get('enroll'),googleEnabled=false;window.CoachInitialRoute=fragment.has('view')?location.hash:'';history.replaceState(null,'',location.pathname);
 let hasOpenedGroup=false,workspaceView='plan',noteFolder='',groupSource=null,groupCache=[];
 let generation=0,csrf='',profile=null,data=null,selected='',tab=preferences.start,notes=[],tasks=[],users=[],editingNote=null,editingUser=null,plan={version:0,content:{}},saveBusy=false,loadingDesk=false,planSession=null,planLoad=0,attendanceView='upcoming',attendancePastDay='all',taskView='open';const attendanceCommands=new Map(),attendancePending=new Map(),attendanceErrors=new Map();
 const titles={books:['Coach Desk','Books','Session charges, verified payments and balances in Canadian dollars.'],attention:['Coach Desk','Reports','Review messages and coaching follow-ups.'],families:['Coach Desk','Families','Choose a family to see their players, attendance and payments.'],coaches:['Your coaching team','Coaching team','View coach notes, assigned groups and their players.'],profiles:['Player development','Player profiles','Get to know each player. Review their goals, notes and attendance by training group.'],library:['Your coaching toolkit','Coach resources','Your drills, inspiration and practical coaching guides in one place.'],home:['Coach Desk','Your coaching week',''],attendance:['On the field','Attendance','Parent replies and actual attendance stay separate.'],notes:['Player development','Player notes & goals','Private observations, useful goals and coaching progress.'],plan:['Your training groups','Choose your group','Open a recurring group to see attendance, session plans and each player’s notes.'],tasks:['Follow through','Tasks & follow-ups','Your preparation, equipment and player follow-ups.'],settings:['Your workspace','Settings & profile','Your account, preferences and administrative tools.'],team:['Owner controls','Team & access','Approve accounts, assign sessions and control full access.'],activity:['Accountability','Activity log','Recent attendance, notes, planning and permission updates.'],legacy:['Admin-only history','Existing coaching records','Unattributed Airtable notes stay restricted to full-access accounts.']};
 const clubDateFormat = new Intl.DateTimeFormat('en-CA',{timeZone:club.timeZone,year:'numeric',month:'2-digit',day:'2-digit'});
 const sessionDayFormat = new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',weekday:'short',month:'short',day:'numeric'});
 const timestampFormat = new Intl.DateTimeFormat('en-CA',{timeZone:club.timeZone,month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
 const monthDayFormat = new Intl.DateTimeFormat('en-CA',{timeZone:'UTC',month:'short',day:'numeric'});
 const timeFormat = new Intl.DateTimeFormat('en-CA',{timeZone:club.timeZone,hour:'numeric',minute:'2-digit'});
 const dateWithYearFormat = new Intl.DateTimeFormat('en-CA',{month:'short',day:'numeric',year:'numeric',timeZone:'UTC'});
 const completedDateFormat = new Intl.DateTimeFormat('en-CA',{timeZone:'America/Vancouver',dateStyle:'medium'});
 const today=()=>clubDateFormat.format(new Date()),day=v=>sessionDayFormat.format(new Date(v+'T12:00:00Z')),when=v=>v?timestampFormat.format(new Date(v)):'—';
 const full=()=>['owner','admin'].includes(profile?.role),session=()=>data?.sessions.find(s=>s.id===selected),empty=text=>node('p',text,'empty-state');
 function allGroups(){if(groupSource!==data?.sessions){groupSource=data?.sessions;groupCache=window.CoachGroups?.groups(groupSource||[])||[];}return groupCache;}
 function selectedGroup(){const key=window.CoachGroups?.key(session());return allGroups().find(group=>group.key===key)||null;}
 function groupRows(){const group=selectedGroup();if(group?.verified)return group.sessions;const row=session();if(!row)return EMPTY_ROWS;if(fallbackRow!==row){fallbackRow=row;fallbackRows=[row];}return fallbackRows;}
 const EMPTY_ROWS=Object.freeze([]);let fallbackRow=null,fallbackRows=EMPTY_ROWS;
 function folderNotes(){const ids=new Set(groupRows().map(s=>s.id));return notes.filter(n=>ids.has(n.session_id)&&(n.player_id||'')===noteFolder);}
 function renderWorkspaceView(){const active=tab==='plan'&&!!window.CoachPlanner?.isFocused();$('panel-attendance').hidden=!active||workspaceView!=='attendance';$('panel-notes').hidden=!active||workspaceView!=='notes';$('session-plan-section').hidden=!active||workspaceView!=='plan';$('planner-save').hidden=workspaceView!=='plan';syncSessionPlayerControl(active);document.querySelectorAll('[data-session-view]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.sessionView===workspaceView));b.disabled=saveBusy||loadingDesk||plannerBusy()||tacticsBusy();});}
 function setWorkspaceView(view){if(!['attendance','plan','notes'].includes(view)||saveBusy||loadingDesk||plannerBusy()||tacticsBusy())return false;stopDictation();workspaceView=view;if(view==='attendance')renderAttendance();if(view==='notes')renderNotes();if(view==='plan')loadPlan();renderWorkspaceView();publishCoachContext();document.dispatchEvent(new Event('coach:dictation-state'));return true;}
 function notice(text,error=false){if(!error){$('global-error').hidden=true;$('global-error').textContent='';}const el=error?$('global-error'):$('notice');el.textContent=text;el.hidden=false;if(!error)setTimeout(()=>{el.hidden=true;},5000);}
 async function api(path,body,includeDesk=false,openingOverview=false){
  const flow=generation;
  const headers=includeDesk?{'X-Coach-Desk':'full'}:{};
  if(openingOverview){headers['X-Coach-Overview']='unpaid';headers['X-Coach-Start']='balances-first';}
  const options={credentials:'same-origin',headers};
  if(body!==undefined){
   headers['Content-Type']='application/json';
   headers['X-CSRF-Token']=csrf;
   options.method='POST';
   options.body=JSON.stringify(body);
  }
  const response=await fetch('/workspace/api/'+path,options),v=await response.json();if(!response.ok){if(response.status===401&&flow===generation&&!path.startsWith('auth/'))showLogin();const e=new Error(v.message||'That action could not be completed.');e.code=v.error;if(response.status>=500&&/^[a-f0-9]{32}$/.test(v.requestId||''))e.message+=' Support reference: '+v.requestId;throw e;}if(flow!==generation)throw Error('Your session changed. Please try again.');return v;}
 const plannerDirty=()=>!!window.CoachPlanner?.isDirty()||!!window.CoachLibrary?.isDirty()||!!window.CoachResources?.isDirty()||!!window.CoachProfiles?.isDirty();
 const plannerBusy=()=>!!window.CoachPlanner?.isBusy()||!!window.CoachLibrary?.isBusy()||!!window.CoachResources?.isBusy()||!!window.CoachProfiles?.isBusy();
 const discardPlanner=()=>{window.CoachPlanner?.discard();window.CoachLibrary?.discard();window.CoachResources?.discard();window.CoachProfiles?.discard();};
 const tacticsDirty=()=>!!window.CoachTactics?.isDirty();
 const tacticsBusy=()=>!!window.CoachTactics?.isBusy();
 const discardTactics=()=>window.CoachTactics?.discard();
 // Modules share the authenticated transport. Never expose session tokens or
 // allow a late diagram response to cross account/session boundaries.
 window.addEventListener('coach:tactics-request',async event=>{
  const v=event.detail||{},write=!['list','source-list'].includes(v.operation),sourceRead=v.operation==='source-list';
  if(typeof v.resolve!=='function'||typeof v.reject!=='function')return;
  if(!['list','source-list','save','archive'].includes(v.operation)||!profile||!session()||v.payload?.sessionId!==selected||tab!=='plan'||saveBusy||loadingDesk||write&&session().status==='Cancelled'||sourceRead&&!groupRows().some(s=>s.id===v.payload?.sourceSessionId&&s.id!==selected)){v.reject(new Error('Choose an available session and wait for other changes to finish.'));return;}
  const selectedAtStart=selected,identityAtStart=profile.email,flow=generation;
  const controls=write?[...$('plan-form').querySelectorAll('input,textarea,select,button')].map(control=>[control,control.disabled]):[];
  if(write){stopDictation();saveBusy=true;controls.forEach(([control])=>control.disabled=true);renderAttendanceNavigation();}
  try{const result=await api('diagrams/'+(sourceRead?'list':v.operation),sourceRead?{sessionId:v.payload.sourceSessionId}:v.payload);if(flow!==generation||selected!==selectedAtStart||profile?.email!==identityAtStart)throw Error('Your session changed. Open this board again.');v.resolve(result);}
  catch(error){v.reject(error);}
  finally{if(write){saveBusy=false;if(flow===generation){controls.forEach(([control,disabled])=>control.disabled=disabled);renderAttendanceNavigation();}}}
 });
 function stopDictation(){document.dispatchEvent(new Event('coach:dictation-stop'));}
 window.addEventListener('coach:team-request',async event=>{
  const v=event.detail||{};if(typeof v.resolve!=='function'||typeof v.reject!=='function')return;
  if(!['list','notes'].includes(v.operation)||!profile||!full()||tab!=='coaches'||saveBusy||loadingDesk){v.reject(new Error('Open Coaching team with full access and wait for other changes to finish.'));return;}
  const flow=generation,identityAtStart=[profile.email,profile.role,profile.sessionVersion].join(':');
  try{const result=await api(v.operation==='list'?'coaching-team':'coaching-team/notes',v.operation==='list'?undefined:{email:v.payload?.email});if(flow!==generation||!profile||identityAtStart!==[profile.email,profile.role,profile.sessionVersion].join(':')||tab!=='coaches')throw Error('Your workspace changed. Reopen Coaching team.');v.resolve(result);}catch(error){v.reject(error);}
 });
 window.addEventListener('coach:resources-request',async event=>{
  const v=event.detail||{},write=v.operation!=='list';if(typeof v.resolve!=='function'||typeof v.reject!=='function')return;
  if(!['list','save','archive'].includes(v.operation)||!profile||tab!=='library'||saveBusy||loadingDesk){v.reject(new Error('Open Coach resources and wait for other changes to finish.'));return;}
  const flow=generation,identityAtStart=profile.email;if(write){stopDictation();saveBusy=true;renderAttendanceNavigation();}
  try{const result=await api('resources/'+v.operation,v.payload||{});if(flow!==generation||profile?.email!==identityAtStart)throw Error('Your sign-in changed. Reopen your resources.');v.resolve(result);}
  catch(error){v.reject(error);}finally{if(write){saveBusy=false;if(flow===generation)renderAttendanceNavigation();}}
 });
 window.addEventListener('coach:library-request',async event=>{
  const v=event.detail||{},write=v.operation!=='list';
  if(typeof v.resolve!=='function'||typeof v.reject!=='function')return;
  if(!['list','save','archive'].includes(v.operation)||!profile||!['plan','library'].includes(tab)||tab==='plan'&&!session()||saveBusy||loadingDesk){v.reject(new Error('Open your drill library and wait for other changes to finish.'));return;}
  const flow=generation,selectedAtStart=selected,identityAtStart=profile.email;
  const controls=write?[...$('plan-form').querySelectorAll('input,textarea,select,button')].map(control=>[control,control.disabled]):[];
  if(write){stopDictation();saveBusy=true;controls.forEach(([control])=>control.disabled=true);renderAttendanceNavigation();}
  try{const result=await api('drills/'+v.operation,v.payload||{});if(flow!==generation||selected!==selectedAtStart||profile?.email!==identityAtStart)throw Error('Your session changed. Reopen the drill archive.');v.resolve(result);}
  catch(error){v.reject(error);}
  finally{if(write){saveBusy=false;if(flow===generation){controls.forEach(([control,disabled])=>control.disabled=disabled);renderAttendanceNavigation();}}}
 });
 window.addEventListener('coach:planner-navigate',event=>{
  const v=event.detail||{};if(typeof v.resolve!=='function')return;
  if(!['home','sessions'].includes(v.destination)||tab!=='plan'||saveBusy||loadingDesk||tacticsBusy()||plannerBusy())return v.resolve(false);
  if(v.destination==='home'){go('home');return v.resolve(tab==='home');}
  if((noteDirty()||planDirty()||tacticsDirty()||plannerDirty())&&!confirm('Return to groups and discard unsaved changes?'))return v.resolve(false);
  stopDictation();resetNote();restorePlanDraft();discardTactics();discardPlanner();window.CoachPlanner?.exitFocus();renderWorkspaceView();v.resolve(true);
 });
 let lastCoachContext;
 // Typing changes the unsaved indicator, not the roster or saved plan. Avoid
 // rebuilding all the supporting panels for each subsequent keystroke.
 function publishCoachContext(force=false){const next=data&&profile?{session:session(),sessions:data.sessions,groupSessions:groupRows(),selectedGroup:selectedGroup(),workspaceView,noteFolder,notes,tasks,profile,selected,tab,reportView,reviewFilter,bookTarget,familyId:activeFamilyId,plan,notePlayer:$('note-player').value,planDirty:planDirty(),planReady:planSession===selected&&!$('plan-focus').disabled&&session()?.status!=='Cancelled',busy:saveBusy||loadingDesk}:null;if(!force&&(next===lastCoachContext||next&&lastCoachContext&&Object.keys(next).every(key=>next[key]===lastCoachContext[key])))return;lastCoachContext=next;window.dispatchEvent(new CustomEvent('coach:context',{detail:next}));publishStatus();}
 function openCoachingSession(sessionId,next,view){if(saveBusy||loadingDesk||plannerBusy()||tacticsBusy()||!profile||!data||!['home','attendance','notes','plan'].includes(next))return false;const target=data.sessions.find(item=>item.id===sessionId);if(!target||!allowSessionChange(sessionId))return false;const targetView=view||(['attendance','notes'].includes(next)?next:workspaceView);if(selected!==sessionId){const same=window.CoachGroups?.sameGroup(session(),target);if(!same)noteFolder='';resetNote();resetRosterFilters();}selected=sessionId;workspaceView=targetView;$('show-all').checked=true;go('plan',true);renderAttendance();renderNotes();publishCoachContext();const opened=tab==='plan'&&selected===sessionId;if(opened){hasOpenedGroup=true;window.CoachPlanner?.focusSession(sessionId);renderWorkspaceView();}return opened;}
 window.addEventListener('coach:profile-open',event=>{const v=event.detail||{};if(typeof v.resolve!=='function')return;const target=data?.sessions.find(row=>row.id===v.sessionId);if((tab!=='profiles'&&(tab!=='coaches'||!full()))||!target?.players.some(player=>player.playerId===v.playerId)||!openCoachingSession(v.sessionId,'notes'))return v.resolve(false);noteFolder=v.playerId;resetNote();$('note-search').value='';$('note-category-filter').value='all';$('note-review-filter').checked=false;renderSelector();renderNotes();if(v.goal){$('note-category').value='Goal';window.CoachGoals?.reset('note');$('note-body').focus();}publishCoachContext();v.resolve(true);});
 window.addEventListener('coach:focus-changed',()=>{renderWorkspaceView();document.dispatchEvent(new Event('coach:dictation-state'));});
 window.addEventListener('coach:navigate-route',event=>{const v=event.detail||{};if(typeof v.resolve!=='function')return;if(!profile||!data||saveBusy||loadingDesk||plannerBusy()||tacticsBusy()||!['home','plan','profiles','families','books','attention','library','coaches','settings','team','activity','legacy'].includes(v.view)||v.view==='families'&&!profile.familyAccess||v.view==='books'&&!canViewBooks()||v.view==='team'&&profile.role!=='owner'||['activity','legacy','coaches'].includes(v.view)&&!full())return v.resolve(false);if(v.sessionId){if(v.view!=='plan'||!data.sessions.some(s=>s.id===v.sessionId))return v.resolve(false);return v.resolve(openCoachingSession(v.sessionId,'plan',v.section));}if(v.view==='plan'&&window.CoachPlanner?.isFocused()){if((noteDirty()||planDirty()||tacticsDirty()||plannerDirty())&&!confirm('Return to groups and discard unsaved changes?'))return v.resolve(false);resetNote();restorePlanDraft();discardTactics();discardPlanner();window.CoachPlanner?.exitFocus();}go(v.view,false,v.familyId,v);renderWorkspaceView();v.resolve(tab===v.view&&(tab!=='books'||bookTarget===(v.bookTarget||'')));});
 window.addEventListener('coach:request-context',()=>{if(!data||!profile)return;const next=tab==='plan'&&!selected&&data&&!saveBusy&&!loadingDesk&&window.CoachPlanner?.nextSession(data.sessions);if(next){selected=next.id;$('show-all').checked=true;render();}else publishCoachContext(true);});
 async function saveQuickNote(event){
  const v=event.detail||{},payload=v.payload,fromProfile=event.type==='coach:profile-note-save',targetRow=fromProfile?data?.sessions.find(row=>row.id===payload?.sessionId):session();
  if(typeof v.resolve!=='function'||typeof v.reject!=='function')return;
  if(!profile||tab!==(fromProfile?'profiles':'plan')||!targetRow||targetRow.status==='Cancelled'||saveBusy||loadingDesk||tacticsBusy()||!fromProfile&&payload?.sessionId!==selected||fromProfile&&!payload?.playerId||payload?.playerId&&!targetRow.players.some(p=>p.playerId===payload.playerId)||typeof payload.body!=='string'||!payload.body.trim()||payload.body.length>6000){v.reject(new Error('Choose a player in this session and wait for other changes to finish.'));return;}
  const flow=generation,identity=profile.email,target=targetRow.id,known=new Set(notes.map(n=>n.id));
  const request={id:null,sessionId:target,playerId:payload.playerId||null,category:payload.category,body:payload.body,goal:payload.goal||null,reviewDate:fromProfile?payload.reviewDate||null:null,expectedVersion:0};
  saveBusy=true;stopDictation();renderAttendanceNavigation();publishCoachContext();
  try{
   let result;
   try{result=await api('notes/save',request);}
   catch(error){
    if(error.code)throw error;
    // A lost response must not create a second note when retried.
    try{const readback=await api('desk'),matches=(readback.notes||[]).filter(n=>!known.has(n.id)&&n.session_id===target&&(n.player_id||null)===request.playerId&&n.author_email===identity&&n.body===request.body&&n.category===request.category&&(n.review_date||null)===request.reviewDate&&JSON.stringify(n.goal||null)===JSON.stringify(request.goal?{successMeasure:request.goal.successMeasure||'',status:request.goal.status||'planned',evidence:request.goal.evidence||'',drillId:request.goal.drillId||null}:null));if(matches.length===1)result={note:matches[0]};}catch{}
    if(!result){const uncertain=new Error('The save could not be verified. Close this draft, refresh the roster and review the notes before adding it again.');uncertain.uncertain=true;throw uncertain;}
   }
   if(flow!==generation||profile?.email!==identity||!fromProfile&&selected!==target)throw Error('Your account or session changed. Reload the notes to check the save.');
   notes=[result.note,...notes.filter(n=>n.id!==result.note.id)];renderNotes();renderHome();v.resolve(result.note);
  }catch(error){v.reject(error);}
  finally{saveBusy=false;if(flow===generation){renderAttendanceNavigation();publishCoachContext();}}
 }
 window.addEventListener('coach:planner-note-save',saveQuickNote);
 window.addEventListener('coach:parent-contact',event=>{
  const {sessionId,playerId,resolve,reject}=event.detail;
  if(tab!=='profiles'||!profile)return reject(Error('Reopen the player profile.'));
  api('parent-contact',{sessionId,playerId}).then(resolve,reject);
 });
 window.addEventListener('coach:profile-note-save',saveQuickNote);
 window.addEventListener('coach:open-session',event=>{const v=event.detail||{};const accepted=openCoachingSession(v.sessionId,v.tab,v.workspaceView);if(typeof v.resolve==='function')v.resolve(accepted);});
 window.addEventListener('coach:add-note',event=>{const v=event.detail||{},target=data?.sessions.find(item=>item.id===v.sessionId);if(!target?.players.some(player=>player.playerId===v.playerId))return;if(noteDirty()&&!confirm('Start a new note and discard the current unsaved note?'))return;if(!openCoachingSession(v.sessionId,'notes'))return;noteFolder=v.playerId;resetNote();renderSelector();renderNotes();$('note-player').value=v.playerId;$('note-body').focus();publishCoachContext();});
 window.addEventListener('coach:insert-plan',event=>{
  const v=event.detail||{};if(saveBusy||loadingDesk||tab!=='plan'||planSession!==selected||session()?.status==='Cancelled'||!['warmup','technical','game','equipment'].includes(v.target)||typeof v.text!=='string'||!v.text.trim())return;
  const field=$('plan-'+v.target);if(field.disabled)return;
  if(v.target==='equipment'){const next=field.value.trim()?field.value.trimEnd()+'\n\n'+v.text.trim():v.text.trim();if(next.length>field.maxLength)return notice('Shorten these equipment notes before adding them.',true);stopDictation();field.value=next;field.dispatchEvent(new Event('input',{bubbles:true}));v.inserted=true;return;}
  if(!window.CoachPlanBlocks?.canAddDrill(v))return notice('This activity could not be added. Check the 16-activity limit, duration and instruction length.',true);
  stopDictation();if(!window.CoachPlanBlocks.addDrill(v))return;v.inserted=true;
  notice(v.diagram?'Activity and diagram added. Save the shared plan when ready.':'Activity added to your sequence. Save the shared plan when ready.');
 });
 window.addEventListener('coach:copy-plan',async event=>{const sourceId=event.detail?.sourceSessionId;if(saveBusy||loadingDesk||tab!=='plan'||planSession!==selected||!data?.sessions.some(item=>item.id===sourceId&&item.status!=='Cancelled')||sourceId===selected)return;if(planDirty()&&!confirm('Replace this draft preparation with the selected session plan? The reflection stays unchanged.'))return;stopDictation();const targetId=selected,controls=[...$('plan-form').querySelectorAll('input,textarea,select,button')];saveBusy=true;controls.forEach(control=>control.disabled=true);renderAttendanceNavigation();try{const response=await api('session',{sessionId:sourceId}),content=response.plan?.content||{};if(!planKeys.slice(0,5).some(key=>String(content[key]||'').trim())&&!content.activities?.length)return notice('No saved preparation plan for that session.',true);if(selected!==targetId)return;for(const key of planKeys.slice(0,5))$('plan-'+key).value=String(content[key]||'').slice(0,$('plan-'+key).maxLength);window.CoachPlanBlocks?.copy(content);syncDraftIndicators();notice('Preparation copied to this draft. Review it and save when ready.');}catch(error){notice(error.message,true);}finally{saveBusy=false;controls.forEach(control=>control.disabled=false);renderAttendanceNavigation();}});
 function clearPrivate(){addPlayerSession='';addPlayerBusy=false;resetSessionPlayer();$('session-add-player').hidden=true;resetBooks();$('nav-books').hidden=true;$('home-unpaid').hidden=true;$('panel-books').hidden=true;clearAttention();$('nav-attention').hidden=true;$('panel-attention').hidden=true;$('nav-families').hidden=true;$('panel-families').hidden=true;mailChecked=false;$('gmail-sync-settings').hidden=true;$('gmail-sync-status').textContent='';$('gmail-sync-disconnect').hidden=true;resetFamilyRecords();window.CoachPlanBlocks?.clear();planSaveState='idle';rosterLoadFailed=false;window.dispatchEvent(new CustomEvent('coach:status',{detail:null}));hasOpenedGroup=false;stopDictation();for(const id of ['profile-avatar','profile-name','profile-email','profile-role','profile-scope','profile-signin','preferences-status','identity','role','session','note-player','note-title','plan-updated','roster','note-list','home-followups','user-list','assignments','legacy-list','activity-list','task-list','home-stats','home-priorities','note-results','task-summary','attendance-stats','attendance-days','attendance-slot','attendance-history','attendance-week-range','attendance-freshness','roster-search-count'])$(id).replaceChildren();for(const id of ['note-form','plan-form','task-form','user-form'])$(id).reset();data=null;groupSource=null;groupCache=[];fallbackRow=null;fallbackRows=EMPTY_ROWS;noteFolder='';workspaceView='plan';notes=[];tasks=[];users=[];editingNote=null;noteUncertain=false;editingUser=null;plan={version:0,content:{}};$('note-search').value='';$('note-category-filter').value='all';$('note-review-filter').checked=false;taskView='open';resetRosterFilters();$('roster-search-clear').hidden=true;clearPrintRoster();planSession=null;planLoad++;planPendingSession=null;resetTaskDraft();$('task-search').value='';$('task-scope').value='all';syncDraftIndicators();attendanceCommands.clear();attendancePending.clear();attendanceErrors.clear();saveBusy=false;attendanceView='upcoming';attendancePastDay='all';$('attendance-past-day').value='all';$('settings-navigation').hidden=true;publishCoachContext();}
 const planKeys=['focus','warmup','technical','game','equipment','reflection'];
 const planActivityFingerprint=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
 let planSaveState='idle',rosterLoadFailed=false;
 function publishStatus(){window.dispatchEvent(new CustomEvent('coach:status',{detail:profile&&data?{observedAt:data.observedAt,pendingSync:data.pendingSync||0,pendingAttendance:data.pendingAttendanceSync||0,refreshing:loadingDesk,refreshFailed:rosterLoadFailed,planSaveState,planUpdatedAt:plan.updated_at||null,planVersion:plan.version||0,planReady:planSession===selected,planDirty:planDirty(),planning:tab==='plan'&&workspaceView==='plan'}:null}));}
 let noteUncertain=false;
 function noteDirty(){return noteUncertain||!!$('note-body').value.trim()||!!window.CoachGoals?.isDirty('note');}
 function planDirty(){return planSession===selected&&(planKeys.some(key=>$('plan-'+key).value!==(plan.content[key]||''))||!!window.CoachPlanBlocks?.isDirty());}
 function syncDraftIndicators(){$('note-state').hidden=!noteDirty();$('plan-state').hidden=!planDirty();publishCoachContext();publishStatus();}
 function restorePlanDraft(){stopDictation();for(const key of planKeys)$('plan-'+key).value=plan.content[key]||'';window.CoachPlanBlocks?.load(plan.content,session());planSaveState='idle';syncDraftIndicators();}
 function resetRosterFilters(){$('roster-search').value='';$('roster-status-filter').value='all';}
 function clearPrintRoster(){document.body.classList.remove('printing-roster');$('print-roster-sheet').replaceChildren();}
 function printRoster(){const current=session();if(!current||saveBusy||loadingDesk)return;const sheet=$('print-roster-sheet');sheet.replaceChildren();sheet.append(node('p',club.name.toUpperCase()+' · PRIVATE COACH ROSTER','eyebrow'),node('h1',day(current.date)+' · '+current.date),node('p',current.time+' · '+current.location),node('p','Expected: '+current.expected+' · Reserved: '+current.capacityUsed+' / '+current.capacity+' · Roster read '+when(data.observedAt)));const table=node('table'),head=node('thead'),header=node('tr'),body=node('tbody');for(const label of ['Player','Session preparation','Coach-marked attendance'])header.append(node('th',label));head.append(header);for(const player of current.players){const row=node('tr');row.append(node('td',player.name),node('td',player.status||'Not yet asked'),node('td',player.actualAttendance||'Not marked'));body.append(row);}table.append(head,body);sheet.append(table,node('p','Parent replies help prepare the session. Physical attendance is recorded separately by the coach.','small'));if(!current.players.length)sheet.append(node('p','No named players are recorded for this session.'));document.body.classList.add('printing-roster');try{window.print();}catch{clearPrintRoster();notice('The print dialog could not open. Please try again in your browser.',true);}}
 function showLogin(){generation++;clearPrivate();profile=null;$('app').hidden=true;$('login').hidden=false;$('boot').hidden=true;const enroll=!!enrollment&&!googleEnabled;$('google-signin').hidden=!googleEnabled;$('passkey-options').hidden=false;$('passkey-options').open=!googleEnabled;$('passkey-summary').hidden=!googleEnabled;$('passkey-security-copy').hidden=googleEnabled;$('signin-form').hidden=enroll;$('enroll-options').hidden=!enroll;$('signin-recovery').hidden=true;$('signin-title').textContent=enroll?'Set up your coach sign-in':'Sign in to your workspace';$('signin-copy').textContent=googleEnabled?'Continue with your approved Google account. No setup link, passkey or USB key is needed. Use a normal Chrome, Edge or Safari browser.':enroll?'Choose where to save your passkey. Set up secure sign-in uses this device, or choose your phone below. This setup link only works for the account approved by the owner.':'Use the email approved by '+club.name+' and your registered passkey. Open this page in a normal Edge, Chrome or Safari browser.';if(googleFailure){googleFailure=false;notice('Google sign-in did not finish, or that account is not approved for Coach Desk. Try again with your approved Google account.',true);}}
 function showSignedInRecovery(){$('app').hidden=true;$('login').hidden=false;$('boot').hidden=true;$('google-signin').hidden=true;$('passkey-options').hidden=true;$('signin-form').hidden=true;$('enroll-options').hidden=true;$('signin-recovery').hidden=false;$('passkey-security-copy').hidden=true;$('signin-title').textContent='Your sign-in worked';$('signin-copy').textContent='You are signed in. The roster could not load yet. Retry below to open Coach Desk.';}
 async function signInWithGoogle(){const button=$('google-signin-button');button.disabled=true;$('global-error').hidden=true;try{const b=await api('bootstrap');csrf=b.csrfToken;googleEnabled=!!b.googleEnabled;if(!googleEnabled)throw Error('Google sign-in is not available yet. Please try again shortly.');const result=await api('auth/google/start',{}),url=new URL(result.url);if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth'||url.username||url.password||url.hash)throw Error('The sign-in destination could not be verified. Please try again.');location.assign(url.href);}catch(e){notice(e.message||'Google sign-in could not start. Please try again.',true);button.disabled=false;}}
 function passkeyError(e,method){if(e.name==='NotAllowedError')return method==='phone'?'Your phone did not complete setup. Enable Bluetooth on your phone and computer, then try again in a normal Edge, Chrome or Safari browser. No USB security key is required.':'Your device did not complete sign-in. Try again with your device PIN, fingerprint or face, or choose Use my phone during setup. Open the page in a normal Edge, Chrome or Safari browser.';if(e.name==='NotSupportedError')return 'This browser or device cannot use that passkey option. Try Use my phone, or open the setup link in a normal Edge, Chrome or Safari browser. No USB security key is required.';if(e.name==='InvalidStateError')return 'A passkey may already be set up on this device. Choose Already set up? Sign in instead, or try your registered passkey.';return e.message;}
 async function authenticate(enroll,method='device'){$('global-error').hidden=true;const buttons=[$('enroll-button'),$('enroll-phone-button'),$('signin-button'),$('existing-signin-button')];buttons.forEach(b=>b.disabled=true);try{if(!window.PublicKeyCredential||!window.SimpleWebAuthnBrowser)throw Error('Passkeys need a supported browser. Open this setup link in a normal Edge, Chrome or Safari browser. You can use your device or phone; no USB security key is required.');const bootstrap=await api('bootstrap');csrf=bootstrap.csrfToken;let result;if(enroll){const challenge=await api('auth/register-options',{token:enrollment,method}),response=await SimpleWebAuthnBrowser.startRegistration({optionsJSON:challenge.options});result=await api('auth/register-finish',{challengeId:challenge.challengeId,response},false,opensOverview());enrollment=null;}else{const challenge=await api('auth/login-options',{email:$('signin-email').value.trim()}),response=await SimpleWebAuthnBrowser.startAuthentication({optionsJSON:challenge.options});result=await api('auth/login-finish',{challengeId:challenge.challengeId,response},false,opensOverview());}csrf=result.csrfToken;profile=result.profile;await loadDesk(false,null,result.balanceSnapshot,result.paymentRecordingAvailable);}catch(e){notice(passkeyError(e,enroll?method:null),true);}finally{buttons.forEach(b=>b.disabled=false);}}
 function stat(label,value){const e=node('div','','desk-stat');e.append(node('span',label),node('strong',value));return e;}
 function playerName(id){return data?.sessions.flatMap(s=>s.players).find(p=>p.playerId===id)?.name||'Session observation';}
 function chosenSessions(){return (data?.sessions||[]).filter(s=>s.status!=='Cancelled'&&($('show-all').checked||s.date>=today()&&(s.capacityUsed>0||profile?.role==='coach')));}
 const trainingDays=club.trainingDays.map(number=>({number,label:['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][number]})),weekday=date=>new Date(date+'T12:00:00Z').getUTCDay(),addDate=(date,count)=>{const d=new Date(date+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+count);return d.toISOString().slice(0,10);},monthDay=date=>monthDayFormat.format(new Date(date+'T12:00:00Z'));
 function attendanceSessions(view=attendanceView,pastDay=attendancePastDay){const start=today(),end=addDate(start,6),rows=(data?.sessions||[]).filter(s=>/^\d{4}-\d{2}-\d{2}$/.test(s.date)&&trainingDays.some(d=>d.number===weekday(s.date))&&(view==='past'?s.date<start&&(pastDay==='all'||String(weekday(s.date))===pastDay):s.date>=start&&s.date<=end));return rows.sort((a,b)=>(view==='past'?b.date.localeCompare(a.date):a.date.localeCompare(b.date))||String(a.time||'').localeCompare(String(b.time||''))||a.id.localeCompare(b.id));}
 function attendanceDefault(rows,view=attendanceView){if(rows.some(s=>s.id===selected&&(view==='past'||s.status!=='Cancelled')))return selected;const active=rows.filter(s=>view==='past'||s.status!=='Cancelled');return (view==='past'?active[0]:active.find(s=>s.capacityUsed>0)||active[0])?.id||'';}
 function allowSessionChange(next){if(saveBusy||loadingDesk||tacticsBusy()||plannerBusy())return false;if(next!==selected)stopDictation();if(next!==selected&&(noteDirty()||planDirty()||tacticsDirty()||plannerDirty()||taskDirty())){if(!confirm('Change sessions and discard unsaved notes, plans, tactics or follow-ups?'))return false;resetNote();restorePlanDraft();discardTactics();discardPlanner();resetTaskDraft();}return true;}
 function chooseAttendanceSession(id){if(!attendanceSessions().some(s=>s.id===id)||!allowSessionChange(id))return renderAttendanceNavigation();if(id!==selected){resetNote();resetRosterFilters();}selected=id;render();}
 function setAttendanceView(view,pastDay=attendancePastDay){const rows=attendanceSessions(view,pastDay),next=attendanceDefault(rows,view);if(!allowSessionChange(next)){ $('attendance-past-day').value=attendancePastDay;return;}if(next!==selected){resetNote();resetRosterFilters();}attendanceView=view;attendancePastDay=pastDay;selected=next;render();}
 function renderSelector(){const available=selectedGroup()?.sessions||[];$('session').replaceChildren(...available.map(s=>{const o=node('option',day(s.date)+' · '+s.time+' · '+s.location);o.value=s.id;return o;}));if(!available.length)$('session').append(node('option','No assigned sessions to show'));$('session').value=selected;$('session').disabled=saveBusy;$('show-all').disabled=saveBusy;$('freshness').textContent='Roster read '+when(data.observedAt)+' · manual refresh';const previous=noteFolder;$('note-player').replaceChildren(node('option','Session observation'));$('note-player').options[0].value='';for(const p of session()?.players||[]){const o=node('option',p.name);o.value=p.playerId;$('note-player').append(o);}if(previous&&![...$('note-player').options].some(o=>o.value===previous)){const o=node('option',playerName(previous));o.value=previous;$('note-player').append(o);}$('note-player').value=previous;}
 function renderAttendanceNavigation(){if(!data)return;const past=attendanceView==='past',start=today(),end=addDate(start,6),rows=attendanceSessions();$('attendance-upcoming').setAttribute('aria-pressed',String(!past));$('attendance-past').setAttribute('aria-pressed',String(past));$('attendance-upcoming-wrap').hidden=past;$('attendance-history-wrap').hidden=!past;$('attendance-week-range').textContent=day(start)+' – '+day(end)+' · next 7 days';$('attendance-freshness').textContent='Roster read '+when(data.observedAt);$('attendance-days').replaceChildren(...trainingDays.map(d=>{const date=addDate(start,(d.number-weekday(start)+7)%7),onDate=attendanceSessions('upcoming').filter(s=>s.date===date),active=onDate.filter(s=>s.status!=='Cancelled'),chosen=session(),b=node('button','','attendance-day');b.type='button';b.dataset.weekday=String(d.number);b.dataset.date=date;b.disabled=(saveBusy||loadingDesk)||!active.length;b.setAttribute('aria-pressed',String(!past&&chosen?.date===date));let state;if(!onDate.length)state=profile?.role==='coach'?'No assigned session':'No session recorded';else if(!active.length)state='Cancelled';else{const expected=active.every(s=>Number.isInteger(s.expected)&&s.expected>=0)?active.reduce((n,s)=>n+s.expected,0):null;state=(active.length>1?active.length+' sessions · ':'')+(expected===null?'Check roster':expected+' expected');}b.append(node('strong',d.label),node('span',monthDay(date),'attendance-day-date'),node('span',state,'attendance-day-state'));if(active.length===1)b.append(node('span',active[0].time||'Time to confirm','attendance-day-time'));b.addEventListener('click',()=>{const target=active.find(s=>s.id===selected)||active.find(s=>s.capacityUsed>0)||active[0];if(target)chooseAttendanceSession(target.id);});return b;}));const slots=attendanceSessions('upcoming').filter(s=>s.date===session()?.date);$('attendance-slot-wrap').hidden=past||slots.length<2;$('attendance-slot').replaceChildren(...slots.map(s=>{const o=node('option',s.time+' · '+s.location+(s.status==='Cancelled'?' · Cancelled':''));o.value=s.id;o.disabled=s.status==='Cancelled';return o;}));$('attendance-slot').value=selected;$('attendance-history').replaceChildren(...rows.map(s=>{const o=node('option',day(s.date)+' · '+s.time+' · '+s.location+(s.status==='Cancelled'?' · Cancelled':''));o.value=s.id;return o;}));if(!rows.length){const o=node('option','No past sessions recorded');o.value='';$('attendance-history').append(o);}$('attendance-history').value=selected;$('attendance-past-day').value=attendancePastDay;for(const id of ['attendance-upcoming','attendance-past','attendance-slot','attendance-history','attendance-past-day'])$(id).disabled=(saveBusy||loadingDesk)||(id==='attendance-history'&&!rows.length);document.querySelectorAll('#navigation button,#settings-navigation button,#open-profile').forEach(b=>b.disabled=(saveBusy||loadingDesk));$('refresh').disabled=(saveBusy||loadingDesk);$('session').disabled=(saveBusy||loadingDesk);$('show-all').disabled=(saveBusy||loadingDesk);$('print-roster').disabled=(saveBusy||loadingDesk)||!session();$('logout').disabled=(saveBusy||loadingDesk);document.querySelectorAll('.note-actions button').forEach(button=>button.disabled=saveBusy||loadingDesk);renderWorkspaceView();publishCoachContext();}
 function homeAction(title, detail, action, tone='') {
  const row=node('button','','priority-action '+tone),copy=node('span');row.type='button';row.disabled=saveBusy||loadingDesk;
  copy.append(node('strong',title),node('span',detail,'small'));row.append(copy,node('span','→','priority-arrow'));
  row.addEventListener('click',()=>{if(!saveBusy&&!loadingDesk)action();});return row;
 }
 function reviewDueNote(note){if(saveBusy||loadingDesk)return;if(!note||!openCoachingSession(note.session_id,'notes'))return;noteFolder=note.player_id||'';resetNote();renderSelector();$('note-review-filter').checked=true;$('note-category-filter').value='all';$('note-search').value='';renderNotes();publishCoachContext();
  const card=[...$('note-list').querySelectorAll('.note-card')].find(el=>el.dataset.noteId===note.id);
  if(card){card.tabIndex=-1;card.focus();}}
 function rosterReviews(){
  const date=today(),sessions=new Set(data.sessions.map(s=>s.id));
  return {
   past:attendanceSessions('past','all').filter(s=>s.status!=='Cancelled'&&s.date>=addDate(date,-28)&&s.players.some(p=>!p.actualAttendance||p.actualAttendance==='Not marked')),
   due:notes.filter(n=>n.review_date&&n.review_date<=date&&sessions.has(n.session_id)).sort((a,b)=>a.review_date.localeCompare(b.review_date)),
   groups:full()?allGroups().filter(g=>g.sessions.some(s=>s.issues?.length)):[],
  };
 }
 function openReview(filter){go('attention',false,null,{reportView:'roster',reviewFilter:filter});if(tab==='attention')$('roster-review-type').focus();}
 function updateHomeAttention(){
  $('home-attention').hidden=!$('home-priorities').childElementCount&&$('home-mail-summary').hidden&&$('home-registration-review').hidden&&$('home-unpaid').hidden;
 }
 function renderHome(){
  if(!data)return;const s=session(),date=today(),end=addDate(date,6),week=attendanceSessions('upcoming').filter(s=>s.status!=='Cancelled'),{past,due,groups}=rosterReviews();
  $('home-stats').replaceChildren(stat('Sessions · next 7 days',week.length),stat('Training groups',allGroups().length),stat('Notes to review',due.length));
  $('next-title').textContent=s?day(s.date):'Your next coaching session';
  $('next-details').textContent=s?s.time+' · '+s.location:'Choose a session or ask the owner to assign your coaching dates.';
  $('next-expected').textContent=s?'Prepare for up to '+s.expected+' players · '+s.capacityUsed+' / '+s.capacity+' reserved places.':'Your assigned sessions will appear here.';
  $('go-attendance').disabled=!s||saveBusy||loadingDesk||s.status==='Cancelled'||!trainingDays.some(d=>d.number===weekday(s.date))||s.date>end;
  $('go-plan').disabled=!s||saveBusy||loadingDesk||s.status==='Cancelled';
  const priorities=$('home-priorities');priorities.replaceChildren();
  if(past.length)priorities.append(homeAction('Finish attendance',past.length+' recent session'+(past.length===1?'':'s')+' with unmarked players',()=>openReview('attendance'),'priority-amber'));
  if(due.length)priorities.append(homeAction('Review coaching observations',due.length+' note'+(due.length===1?'':'s')+' with a review date due',()=>openReview('observations')));
  if(groups.length)priorities.append(homeAction('Roster details to review',groups.length+' training group'+(groups.length===1?'':'s'),()=>openReview('details')));
  $('home-followups').replaceChildren();
  updateHomeAttention();

 }
 function renderAttendance(){renderAttendanceNavigation();const s=session(),query=$('roster-search').value.trim().toLocaleLowerCase(),players=s?.players||[],statusFilter=$('roster-status-filter').value,filtered=!!query||statusFilter!=='all',visible=players.filter(p=>(!query||String(p.name||'').toLocaleLowerCase().includes(query))&&(statusFilter==='all'||(p.actualAttendance||'Not marked')===statusFilter||attendancePending.has(s.id+'|'+p.attendanceId)||attendanceErrors.has(s.id+'|'+p.attendanceId)));$('roster-search').disabled=(saveBusy&&!attendancePending.size)||loadingDesk||!players.length;$('roster-status-filter').disabled=(saveBusy&&!attendancePending.size)||loadingDesk||!players.length;$('roster-search-clear').hidden=!query;$('roster-search-clear').disabled=saveBusy&&!attendancePending.size;$('roster-search-count').textContent=filtered?visible.length+' of '+players.length+' players shown':players.length+' '+(players.length===1?'player':'players');$('attendance-stats').hidden=!s;$('attendance-stats').replaceChildren(stat('Expected roster',s?.expected||0),stat('Parent replied Yes',s?.counts.yes||0),stat('Registered pass / camp',s?.counts.confirmed||0),stat('Marked present',s?.players.filter(p=>p.actualAttendance==='Present').length||0),stat('Marked absent',s?.players.filter(p=>p.actualAttendance==='Absent').length||0));$('roster-title').textContent=s?day(s.date)+' roster':attendanceView==='past'?'No past session selected':'No upcoming session recorded';$('roster-details').textContent=s?s.time+' · '+s.location:'';$('marking-help').textContent=s?.status==='Cancelled'?'This session was cancelled. Its attendance record is read-only.':s&&s.date>today()?'Attendance marking opens on the session day. You can prepare notes and the plan now.':'Parent replies help you prepare. Mark Present or Absent only after checking the player is there.';$('roster').replaceChildren(...visible.map(p=>{const rowKey=s.id+'|'+p.attendanceId,pending=attendancePending.has(rowKey);const row=node('div','','roster-row'),info=node('div'),controls=node('div','','attendance-controls');controls.setAttribute('role','group');controls.setAttribute('aria-label','Attendance for '+p.name);info.append(node('strong',p.name),node('span',(p.actualAttendance||'Not marked')+(pending?' · Saving…':''),'attendance-status '+({Present:'status-present',Absent:'status-absent','Not marked':'status-unmarked'}[p.actualAttendance]||'status-unmarked')),node('p',(p.age?'Age '+p.age+' · ':'')+({dropin:'Weekly drop-in',pass:'Four-session pass',camp:'Camp',unknown:'Booking type to review'})[p.kind]+' · '+p.status));for(const [label,status]of [['Present','Present'],['Absent','Absent'],['Not marked','Not marked']]){const b=node('button',label,p.actualAttendance===status?'current'+(status==='Absent'?' absent':status==='Not marked'?' unmarked':''):'');b.type='button';b.disabled=(saveBusy&&!attendancePending.size)||pending||loadingDesk||s.status==='Cancelled'||status!=='Not marked'&&s.date>today();b.setAttribute('aria-pressed',String(p.actualAttendance===status));b.addEventListener('click',()=>markAttendance(p,status));controls.append(b);}row.dataset.attendanceId=p.attendanceId;row.setAttribute('aria-busy',String(pending));if(attendanceErrors.has(rowKey))info.append(node('p','Save not confirmed. Tap a status to retry.','attendance-save-error'));row.append(info,controls);return row;}));if(filtered&&!visible.length)$('roster').append(empty('No players match these filters. Clear the search or choose All players to see the full roster.'));else if(!s?.players.length)$('roster').append(empty(!s?(attendanceView==='past'?'Choose a previous session above to review its attendance.':'The next seven days only appear here. Previous sessions are in Past attendance.'):s.capacityUsed?'Expected players still need individual roster records.':'No named players recorded for this session.'));}
 let addPlayerSession='',addPlayerLoaded=false,addPlayerRequest=0,addPlayerCommand=null,addPlayerBusy=false;
 function resetSessionPlayer(){
  addPlayerRequest++;addPlayerLoaded=false;addPlayerCommand=null;
  $('session-add-player').open=false;$('session-add-player-form').reset();
  $('session-add-player-choice').replaceChildren(new Option('Select player',''));
  $('session-add-player-family').replaceChildren(new Option('No family linked yet',''));
  $('session-add-player-name-label').hidden=true;$('session-add-player-family-label').hidden=true;
  $('session-add-player-name').required=false;$('session-add-player-status').textContent='';
  $('session-add-player-retry').hidden=true;
  $('session-add-player-submit').textContent='Add player';
 }
 function syncSessionPlayerControl(active){
  const available=active&&profile?.role==='owner'&&data?.rosterEditingAvailable===true&&session()?.status!=='Cancelled';
  const current=available?session()?.id||'':'';
  if(current!==addPlayerSession){resetSessionPlayer();addPlayerSession=current;}
  $('session-add-player').hidden=!current;
 }
 function setSessionPlayerFields(disabled){
  for(const field of $('session-add-player-form').elements)field.disabled=disabled;
  if(!disabled&&!$('session-add-player').dataset.recurring)$('session-add-player-mode').querySelector('[value="permanent"]').disabled=true;
 }
 function showNewPlayerFields(){
  const isNew=$('session-add-player-choice').value==='new';
  $('session-add-player-name-label').hidden=!isNew;$('session-add-player-family-label').hidden=!isNew;
  $('session-add-player-name').required=isNew;
  const selectedOption=$('session-add-player-choice').selectedOptions[0];
  const rate=$('session-add-player-rate');
  if($('session-add-player').dataset.defaultRate || !rate.value)rate.value=selectedOption?.dataset.rate??$('session-add-player').dataset.defaultRate??'';
 }
 async function loadSessionPlayers(){
  if(!addPlayerSession||addPlayerLoaded||addPlayerBusy)return;
  const ticket=++addPlayerRequest,flow=generation,id=addPlayerSession;
  setSessionPlayerFields(true);$('session-add-player-retry').hidden=true;$('session-add-player-status').textContent='Loading players…';
  try{
   const result=await api('session-roster/options',{sessionId:id});
   if(ticket!==addPlayerRequest||flow!==generation||id!==addPlayerSession)return;
   const choice=$('session-add-player-choice'),family=$('session-add-player-family');
   const families=new Map(result.families.map(item=>[item.id,item.name]));
   choice.replaceChildren(new Option('Select player',''),...result.players.map(item=>{
    const option=new Option(item.name+(item.familyId&&families.has(item.familyId)?' · '+families.get(item.familyId):''),item.id);
    if(Number.isFinite(item.agreedRate))option.dataset.rate=item.agreedRate.toFixed(2);
    return option;
   }),new Option('Add a new player','new'));
   family.replaceChildren(new Option('No family linked yet',''),...result.families.map(item=>new Option(item.name,item.id)));
   $('session-add-player').dataset.recurring=result.recurring?'yes':'';
   $('session-add-player').dataset.defaultRate=Number.isFinite(result.rate)?result.rate.toFixed(2):'';
   $('session-add-player-rate').readOnly=result.rateLocked===true;
   $('session-add-player-status').textContent=result.recurring?'':'Permanent enrollment is available for repeating weekly sessions.';
   addPlayerLoaded=true;setSessionPlayerFields(false);showNewPlayerFields();
  }catch(error){
   if(ticket===addPlayerRequest&&flow===generation){$('session-add-player-status').textContent=error.message;$('session-add-player-retry').hidden=false;setSessionPlayerFields(false);}
  }
 }
 $('session-add-player').addEventListener('toggle',()=>{if($('session-add-player').open)loadSessionPlayers();});
 $('session-add-player-retry').addEventListener('click',loadSessionPlayers);
 $('session-add-player-choice').addEventListener('change',showNewPlayerFields);
 $('session-add-player-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(addPlayerBusy||!addPlayerLoaded||!addPlayerSession||!session()||saveBusy||loadingDesk)return;
  const form=$('session-add-player-form'),choice=$('session-add-player-choice').value;
  if(!form.reportValidity())return;
  if(!addPlayerCommand){
   const rate=$('session-add-player-rate').valueAsNumber;
   addPlayerCommand={id:crypto.randomUUID(),sessionId:addPlayerSession,mode:$('session-add-player-mode').querySelector('input:checked').value,
    rateCents:Math.round(rate*100),...(choice==='new'?{newName:$('session-add-player-name').value.trim(),...($('session-add-player-family').value?{familyId:$('session-add-player-family').value}:{})}:{playerId:choice})};
  }
  const playerName=choice==='new'?$('session-add-player-name').value.trim():$('session-add-player-choice').selectedOptions[0]?.textContent||'';
  const flow=generation,id=addPlayerSession,button=$('session-add-player-submit');
  addPlayerBusy=true;saveBusy=true;setSessionPlayerFields(true);button.disabled=true;
  $('session-add-player-status').textContent='Adding player…';
  try{
   const result=await api('session-roster/add',addPlayerCommand);
   if(flow!==generation||id!==addPlayerSession)return;
   addPlayerCommand=null;
   let message=result.recurring?'Permanent enrollment saved. Added to '+result.added+' '+(result.added===1?'session':'sessions')+'.':
    result.added?'Player added to this session.':'The player is already on this session.';
   if(result.reviewDates?.length)message+=' Review these dates: '+result.reviewDates.map(day).join(', ')+'.';
   if(result.historicalReview)message+=' The historical session needs a billing review.';
   try{
    const fresh=await api('refresh',{},true);
    if(flow!==generation||id!==addPlayerSession)return;
    data.sessions=fresh.sessions;data.observedAt=fresh.observedAt;
   }catch{message+=' Refresh the roster to see the latest changes.';}
   if(choice==='new'&&result.playerId&&!Array.from($('session-add-player-choice').options).some(option=>option.value===result.playerId)){
    $('session-add-player-choice').add(new Option(playerName,result.playerId));
   }
   form.reset();showNewPlayerFields();button.textContent='Add player';
   $('session-add-player-status').textContent=message;
  }catch(error){
   if(flow!==generation||id!==addPlayerSession)return;
   const retry=!error.code||error.code==='ROSTER_UNAVAILABLE';
   if(!retry)addPlayerCommand=null;
   $('session-add-player-status').textContent=error.message+(retry?' Tap Retry to finish adding this player.':'');
   button.textContent=retry?'Retry':'Add player';
  }finally{
   if(flow===generation&&id===addPlayerSession){
    addPlayerBusy=false;saveBusy=false;
    setSessionPlayerFields(!!addPlayerCommand);button.disabled=false;
    renderAttendance();renderSelector();publishCoachContext();
    if(!addPlayerLoaded&&!addPlayerCommand)loadSessionPlayers();
   }
  }
 });
 async function markAttendance(p,status){
  const selectedSessionId=selected,rowKey=selectedSessionId+'|'+p.attendanceId;
  if(saveBusy&&!attendancePending.size||attendancePending.has(rowKey)||loadingDesk||p.actualAttendance===status||session()?.status==='Cancelled')return;
  const flow=generation,previousStatus=p.actualAttendance,key=rowKey+'|'+status;
  let payload=attendanceCommands.get(key);
  if(!payload){payload={commandId:crypto.randomUUID(),sessionId:selectedSessionId,attendanceId:p.attendanceId,playerId:p.playerId,status,expectedStatus:previousStatus};attendanceCommands.set(key,payload);}
  attendancePending.set(rowKey,payload);attendanceErrors.delete(rowKey);saveBusy=true;p.actualAttendance=status;renderAttendance();renderHome();
  try{
   const r=await api('attendance',payload);if(flow!==generation)return;
   p.actualAttendance=r.status;attendanceCommands.delete(key);
   if(!attendanceErrors.size)notice(r.superseded?p.name+'’s attendance changed after your earlier action. Current status: '+r.status.toLowerCase()+'.':p.name+' marked '+r.status.toLowerCase()+'.');
  }catch(e){
   if(flow!==generation)return;
   p.actualAttendance=previousStatus;attendanceErrors.set(rowKey,e.message);
   if(e.code==='ATTENDANCE_CHANGED')attendanceCommands.delete(key);
   notice(e.message,true);
  }finally{
   if(flow===generation){attendancePending.delete(rowKey);saveBusy=attendancePending.size>0;renderAttendance();renderHome();}
  }
 }

 function renderNoteList(target,list,actions=true){target.replaceChildren(...list.map(n=>{const card=node('article','','note-card'),head=node('div');card.dataset.noteId=n.id;head.append(node('span',n.category,'tag'+(n.category==='Goal'?' goal':'')));if(n.review_date)head.append(node('span','Review '+day(n.review_date),'tag'));card.append(head,node('h3',playerName(n.player_id)),node('p',(n.author_email===profile.email?'Your note':n.author_email)+' · '+when(n.updated_at),'note-meta'),node('p',n.body,'note-body'));const goalCard=window.CoachGoals?.renderCard(n);if(goalCard)card.append(goalCard);if(actions){const buttons=node('div','','note-actions'),edit=node('button','Edit','secondary'),archive=node('button','Archive','secondary');edit.type=archive.type='button';edit.disabled=archive.disabled=saveBusy||loadingDesk;edit.addEventListener('click',()=>{if(saveBusy||loadingDesk)return;if(editingNote?.id===n.id){$('note-body').focus();return;}if(n.session_id!==selected){if(!allowSessionChange(n.session_id))return;}else if(noteDirty()&&!confirm('Edit this note and discard the current unsaved note?'))return;stopDictation();noteUncertain=false;editingNote=n;noteFolder=n.player_id||'';selected=n.session_id;$('show-all').checked=true;renderSelector();$('note-player').value=n.player_id||'';$('note-category').value=n.category;$('note-body').value=n.body;$('note-review').value=n.review_date||'';window.CoachGoals?.load('note',n);$('note-title').textContent=n.author_email===profile.email?'Edit your coaching note':'Edit note by '+n.author_email;$('note-cancel').hidden=false;renderAttendance();loadPlan();renderNotes();publishCoachContext();window.CoachPlanner?.focusSession(selected);renderWorkspaceView();$('note-body').focus();});archive.addEventListener('click',async()=>{if(saveBusy||loadingDesk)return;if(!confirm('Archive this note? It will leave the active notes list.'))return;const archiveControls=[...$('note-form').querySelectorAll('input,select,textarea,button')];stopDictation();saveBusy=true;archiveControls.forEach(c=>c.disabled=true);renderAttendanceNavigation();try{await api('notes/archive',{id:n.id,expectedVersion:n.version});notes=notes.filter(x=>x.id!==n.id);if(editingNote?.id===n.id)resetNote();notice('Note archived.');}catch(e){notice(e.message,true);}finally{saveBusy=false;archiveControls.forEach(c=>c.disabled=false);renderNotes();renderHome();renderAttendanceNavigation();}});buttons.append(edit,archive);card.append(buttons);}return card;}));if(!list.length)target.append(empty('No notes yet. A short observation is a good place to start.'));}
 function renderNotes(){const q=$('note-search').value.trim().toLowerCase(),category=$('note-category-filter').value,review=$('note-review-filter').checked,available=folderNotes();const filtered=available.filter(n=>(!q||(n.body+' '+n.category+' '+n.author_email).toLowerCase().includes(q))&&(category==='all'||n.category===category)&&(!review||n.review_date&&n.review_date<=today())).sort((a,b)=>String(b.updated_at).localeCompare(String(a.updated_at)));const player=noteFolder?playerName(noteFolder):'Group';$('notes-heading').textContent=player+' notes';$('note-results').textContent=filtered.length+' of '+available.length+' notes in this folder'+(notes.length>=200?' · Latest 200 accessible notes loaded.':'');renderNoteList($('note-list'),filtered);const canCompose=!!session()&&session().status!=='Cancelled'&&(!noteFolder||session().players.some(p=>p.playerId===noteFolder));$('note-folder-help').textContent=session()?.status==='Cancelled'?'This cancelled date is read-only. Choose another date to add a note.':canCompose?'Notes stay in this folder for this training group.':'This player is not on the selected date’s roster. Choose one of their recorded dates to add a note.';for(const c of $('note-form').querySelectorAll('input,select,textarea,button'))c.disabled=saveBusy||loadingDesk||!canCompose||noteUncertain&&c.id!=='note-cancel';$('note-player').value=noteFolder;$('note-title').textContent=editingNote?'Edit '+player+' note':'Add '+(noteFolder?'a note for '+player:'a group note');}
 function resetNote(){stopDictation();editingNote=null;noteUncertain=false;$('note-form').reset();window.CoachGoals?.reset('note');$('note-title').textContent='Add a coaching note';$('note-cancel').hidden=true;if($('note-player'))$('note-player').value=noteFolder;syncDraftIndicators();}
 async function saveNote(e){
  e.preventDefault();if(saveBusy||loadingDesk||noteUncertain||session()?.status==='Cancelled')return;
  if(!selected||noteFolder&&!session()?.players.some(p=>p.playerId===noteFolder))return notice('Choose a date where this player is on the roster before adding a note.',true);
  stopDictation();const payload={id:editingNote?.id||null,sessionId:selected,playerId:$('note-player').value||null,category:$('note-category').value,body:$('note-body').value.trim(),goal:window.CoachGoals?.read('note')||null,reviewDate:$('note-review').value||null,expectedVersion:editingNote?.version||0};
  const controls=[...$('note-form').querySelectorAll('input,select,textarea,button')],flow=generation,identity=profile.email,author=editingNote?.author_email||identity,known=new Set(notes.map(note=>note.id));
  saveBusy=true;controls.forEach(control=>control.disabled=true);renderAttendanceNavigation();
  try{
   let result;
   try{result=await api('notes/save',payload);}
   catch(error){
    if(error.code||flow!==generation)throw error;
    // A request can commit even when its response is lost. Read once; never resend a new note automatically.
    const goal=payload.goal?{successMeasure:payload.goal.successMeasure||'',status:payload.goal.status||'planned',evidence:payload.goal.evidence||'',drillId:payload.goal.drillId||null}:null;
    try{const readback=await api('desk'),matches=(readback.notes||[]).filter(note=>(payload.id?note.id===payload.id:!known.has(note.id))&&note.version===payload.expectedVersion+1&&note.session_id===payload.sessionId&&(note.player_id||null)===payload.playerId&&note.author_email===author&&note.body===payload.body&&note.category===payload.category&&(note.review_date||null)===payload.reviewDate&&JSON.stringify(note.goal||null)===JSON.stringify(goal));if(matches.length===1)result={note:matches[0]};}catch{}
    if(!result){const uncertain=new Error('The save could not be verified. Clear this draft, refresh the roster and review the notes before adding it again.');uncertain.uncertain=true;throw uncertain;}
   }
   if(flow!==generation||profile?.email!==identity)return;
   notes=[result.note,...notes.filter(note=>note.id!==result.note.id)];resetNote();renderHome();notice('Private coaching note saved.');
  }catch(error){if(flow===generation){noteUncertain=!!error.uncertain;if(noteUncertain)$('note-cancel').hidden=false;notice(error.message,true);}}
  finally{saveBusy=false;if(flow===generation){renderNotes();renderAttendanceNavigation();syncDraftIndicators();}}
 }
 let planPendingSession=null;
 async function loadPlan(force=false){
  if(planPendingSession===selected&&selected)return;
  if(!force&&planSession===selected&&selected&&!$('plan-focus').disabled)return;
  stopDictation();const requestSession=selected,ticket=++planLoad;planPendingSession=requestSession;
  const controls=[...$('plan-form').querySelectorAll('input,textarea,select,button')];controls.forEach(e=>e.disabled=true);
  plan={version:0,content:{}};planSession=null;planSaveState='idle';window.CoachPlanBlocks?.clear();for(const key of planKeys)$('plan-'+key).value='';$('plan-updated').textContent='';syncDraftIndicators();
  $('plan-retry').hidden=true;$('plan-load-status').hidden=false;$('plan-load-status').textContent=requestSession?'Loading this session’s plan…':'Choose a session to prepare its plan.';publishCoachContext();
  if(!requestSession){planPendingSession=null;return;}let ready=false;
  try{const r=await api('session',{sessionId:requestSession});if(ticket!==planLoad||selected!==requestSession)return;plan=r.plan;planSession=requestSession;window.CoachPlanBlocks?.load(plan.content,session());for(const key of planKeys)$('plan-'+key).value=plan.content[key]||'';$('plan-updated').textContent=plan.updated_at?' Last saved '+when(plan.updated_at)+' by '+plan.updated_by:'';syncDraftIndicators();$('plan-load-status').hidden=true;ready=true;}
  catch(e){if(ticket===planLoad&&selected===requestSession){$('plan-load-status').textContent='This session’s plan could not load. Your saved plan has not changed.';$('plan-retry').hidden=false;}}
  finally{if(ticket===planLoad){planPendingSession=null;controls.forEach(e=>e.disabled=!ready||session()?.status==='Cancelled');if(ready&&session()?.status==='Cancelled'){$('plan-load-status').hidden=false;$('plan-load-status').textContent='This cancelled session’s plan is read-only.';}publishCoachContext();}}
 }
 $('plan-retry').addEventListener('click',()=>{if(!saveBusy&&!loadingDesk)loadPlan();});
 async function savePlan(e){
  e.preventDefault();if(saveBusy||loadingDesk||session()?.status==='Cancelled')return;
  if(!selected||planSession!==selected)return notice('Choose a session and wait for its plan to load.',true);
  const invalid=window.CoachPlanBlocks?.validate();if(invalid)return notice(invalid,true);
  stopDictation();const content={};for(const key of planKeys)content[key]=$('plan-'+key).value;
  const activities=window.CoachPlanBlocks?.content();if(activities!==undefined)content.activities=activities;
  const sessionId=selected,expectedVersion=plan.version,identity=profile.email,flow=generation,payload={sessionId,content,expectedVersion};
  if(new TextEncoder().encode(JSON.stringify(payload)).byteLength>64000)return notice('This plan is too large to save. Shorten instructions or simplify activity diagrams, then try again.',true);
  const controls=[...$('plan-form').querySelectorAll('input,textarea,select,button')];saveBusy=true;planSaveState='saving';controls.forEach(control=>control.disabled=true);renderAttendanceNavigation();publishStatus();
  try{
   let result;
   try{result=await api('plans/save',payload);}catch(error){
    if(flow!==generation)throw error;
    // Resolve an uncertain save by reading its exact version, author and content. Never resend automatically.
    try{const check=await api('session',{sessionId}),saved=check.plan;
     if(saved?.version===expectedVersion+1&&saved.updated_by===identity&&planKeys.every(key=>(saved.content[key]||'')===(content[key]||''))&&planActivityFingerprint(saved.content.activities)===planActivityFingerprint(content.activities))result=check;
    }catch{/* Keep the editable draft; the owner can review the error. */}
    if(!result)throw error;
   }
   if(flow!==generation||selected!==sessionId)return;
   plan=result.plan;planSession=sessionId;window.CoachPlanBlocks?.load(plan.content,session());planSaveState='idle';$('plan-updated').textContent=' Last saved '+when(plan.updated_at);syncDraftIndicators();notice('Shared session plan saved.');
  }catch(error){if(flow===generation){planSaveState='error';notice(error.message+' Your draft is still here.',true);}}
  finally{saveBusy=false;if(flow===generation){controls.forEach(control=>control.disabled=false);renderAttendanceNavigation();publishCoachContext();publishStatus();}}
 }

 let editingTask=null,taskTargetCaptured=false,taskTarget=null,taskUncertain=false;
 function taskDraftSession(){return taskTargetCaptured?taskTarget:selected||null;}
 function taskDirty(){return taskUncertain||Boolean(editingTask?$('task-title').value!==editingTask.title||$('task-due').value!==(editingTask.due_date||''):$('task-title').value.trim()||$('task-due').value);}
 function captureTaskTarget(){if(!taskTargetCaptured){taskTarget=selected||null;taskTargetCaptured=true;}renderTaskEditor();}
 function resetTaskDraft(){$('task-form').reset();editingTask=null;taskTargetCaptured=false;taskTarget=null;taskUncertain=false;$('task-save-status').textContent='';renderTaskEditor();}
 function renderTaskEditor(){
  const target=data?.sessions.find(s=>s.id===taskDraftSession());
  $('task-editor-title').textContent=editingTask?'Edit follow-up':'Add a follow-up';
  $('task-submit').textContent=editingTask?'Save changes':'Add task';
  $('task-cancel').hidden=!editingTask&&!taskDirty()&&!taskUncertain;
  $('task-cancel').textContent=editingTask?'Cancel edit':'Clear draft';
  $('task-target').textContent=(editingTask?'Original session: ':taskTargetCaptured?'Draft for: ':'New task for: ')+(target?day(target.date)+' · '+target.time+' · '+target.location:taskDraftSession()?'Previously linked session':'No session linked')+(editingTask?' · '+(editingTask.status==='done'?'Completed':'Open'):'');
  for(const control of $('task-form').querySelectorAll('input,button'))control.disabled=saveBusy||loadingDesk||taskUncertain&&control.id!=='task-cancel';
 }
 function editTask(task){
  if(saveBusy||loadingDesk||taskUncertain)return;
  if(editingTask?.id===task.id){$('task-title').focus();return;}
  if(taskDirty()&&!confirm('Edit this follow-up and discard the current task draft?'))return;
  editingTask={...task};taskTarget=task.session_id||null;taskTargetCaptured=true;taskUncertain=false;
  $('task-title').value=task.title;$('task-due').value=task.due_date||'';$('task-save-status').textContent='';renderTaskEditor();$('task-title').focus();
 }
 async function persistTask(payload,onSaved){
  if(saveBusy||loadingDesk||taskUncertain)return;
  const flow=generation,identity=profile?.email,known=new Set(tasks.map(t=>t.id)),author=payload.id?tasks.find(t=>t.id===payload.id)?.author_email:identity;
  saveBusy=true;$('task-save-status').textContent='Saving follow-up…';renderTasks();renderAttendanceNavigation();
  try{
   let result;
   try{result=await api('tasks/save',payload);}
   catch(error){
    if(error.code)throw error;
    try{const readback=await api('desk'),matches=(readback.tasks||[]).filter(t=>(payload.id?t.id===payload.id&&t.version>=payload.expectedVersion+1:!known.has(t.id))&&(t.session_id||null)===(payload.sessionId||null)&&t.author_email===author&&t.title===payload.title&&(t.due_date||null)===(payload.dueDate||null)&&t.status===payload.status);if(matches.length===1)result={tasks:readback.tasks};}catch{}
    if(!result){const uncertain=new Error('The save could not be verified. Refresh the roster and review the task list before trying again.');uncertain.uncertain=true;throw uncertain;}
   }
   if(flow!==generation||profile?.email!==identity)return;
   tasks=result.tasks;onSaved();$('task-save-status').textContent='Follow-up saved.';
  }catch(error){if(flow===generation&&profile?.email===identity){taskUncertain=!!error.uncertain;$('task-save-status').textContent=error.message||'Could not save. Your task draft is still here.';notice(error.message,true);}}
  finally{saveBusy=false;if(flow===generation){renderTasks();renderHome();renderAttendanceNavigation();}}
 }
 function renderTasks(){
  if(editingTask&&!taskDirty()){const latest=tasks.find(t=>t.id===editingTask.id);if(latest&&latest.version!==editingTask.version){editingTask={...latest};taskTarget=latest.session_id||null;$('task-title').value=latest.title;$('task-due').value=latest.due_date||'';}}
  const query=$('task-search').value.trim().toLowerCase(),scope=$('task-scope').value;
  const ordered=tasks.filter(t=>(taskView==='all'||t.status===taskView)&&(scope!=='selected'||t.session_id===selected)&&(!query||[t.title,t.author_email,data?.sessions.find(s=>s.id===t.session_id)?.location].filter(Boolean).join(' ').toLowerCase().includes(query))).sort((a,b)=>(a.status==='open'?0:1)-(b.status==='open'?0:1)||(a.due_date||'9999').localeCompare(b.due_date||'9999')||String(a.created_at).localeCompare(String(b.created_at)));
  document.querySelectorAll('[data-task-filter]').forEach(b=>{b.setAttribute('aria-pressed',String(b.dataset.taskFilter===taskView));b.disabled=saveBusy||loadingDesk;});
  $('task-search-clear').hidden=!query;$('task-search-clear').disabled=saveBusy||loadingDesk;
  $('task-summary').textContent=ordered.length+' of '+tasks.length+' follow-ups · '+tasks.filter(t=>t.status==='open').length+' open · '+tasks.filter(t=>t.status==='done').length+' completed';
  renderTaskEditor();
  $('task-list').replaceChildren(...ordered.map(t=>{
   const row=node('div','','task-row '+(t.status==='done'?'done':'')),info=node('div'),actions=node('div','','task-row-actions'),edit=node('button','Edit','secondary'),b=node('button',t.status==='done'?'Reopen':'Mark done','secondary'),linked=data?.sessions.find(s=>s.id===t.session_id);
   info.append(node('strong',t.title),node('p',(t.due_date?(t.status==='open'&&t.due_date<today()?'Overdue · ':'Due ')+day(t.due_date):'No due date')+(full()&&t.author_email!==profile.email?' · '+t.author_email:''),t.status==='open'&&t.due_date&&t.due_date<today()?'task-overdue':''));
   if(linked)info.append(node('span','Session: '+day(linked.date)+' · '+linked.time,'small'));
   edit.type=b.type='button';edit.disabled=saveBusy||loadingDesk||taskUncertain;b.disabled=saveBusy||loadingDesk||taskUncertain||editingTask?.id===t.id;
   edit.addEventListener('click',()=>editTask(t));
   b.addEventListener('click',()=>persistTask({id:t.id,title:t.title,sessionId:t.session_id,dueDate:t.due_date,status:t.status==='done'?'open':'done',expectedVersion:t.version},()=>notice(t.status==='done'?'Follow-up reopened.':'Follow-up completed.')));
   actions.append(edit,b);row.append(info,actions);return row;
  }));
  if(!ordered.length)$('task-list').append(empty(query||scope==='selected'?'No follow-ups match these filters. Try all sessions or clear your search.':taskView==='done'?'No completed follow-ups yet.':taskView==='open'?'No open follow-ups. Add something to prepare above.':'No follow-ups added yet.'));
 }
 async function saveTask(event){
  event.preventDefault();if(saveBusy||loadingDesk||taskUncertain)return;const title=$('task-title').value.trim();if(!title)return;
  captureTaskTarget();const editing=editingTask;
  const payload={...(editing?{id:editing.id}:{}),title,sessionId:taskDraftSession(),dueDate:$('task-due').value||null,status:editing?.status||'open',expectedVersion:editing?.version||0};
  await persistTask(payload,()=>{resetTaskDraft();if(!editing)taskView='open';notice(editing?'Follow-up updated.':'Follow-up saved.');});
 }
 $('task-title').addEventListener('input',captureTaskTarget);$('task-due').addEventListener('input',captureTaskTarget);
 $('task-cancel').addEventListener('click',()=>{if(saveBusy||loadingDesk)return;if(taskDirty()&&!confirm('Discard this unsaved task draft?'))return;resetTaskDraft();renderTasks();});
 $('task-search').addEventListener('input',renderTasks);$('task-scope').addEventListener('change',renderTasks);
 $('task-search-clear').addEventListener('click',()=>{$('task-search').value='';renderTasks();$('task-search').focus();});
 const mailErrors={WRONG_MAILBOX:'Choose the Star Soccer Gmail account.',GMAIL_API_DISABLED:'Enable the Gmail API in the Google Cloud project for this OAuth application, then reconnect.',GOOGLE_RECONNECT:'Reconnect Gmail to renew read access.',CONSENT_EXPIRED:'The approval expired. Start the connection again.',PAYMENT_LABELS_MISSING:'Restore the Payments - Incoming/Deposited Gmail label, then retry.',cancelled:'Google authorization was cancelled.'};
 let mailChecked=false;
 async function mailStatus(){
  if(!data?.gmailSyncAvailable||profile?.role!=='owner')return;
  try{
   const state=await api('gmail-sync/status');
   const issue=state.error||(!state.connected&&fragment.get('gmail'));
   $('gmail-sync-status').textContent=(state.connected?'Connected. '+(state.lastCheck?'Last checked '+when(state.lastCheck)+'.':'First sync pending.'):'Awaiting Google authorization.')+(issue?' '+(mailErrors[issue]||'Sync needs attention: '+issue):'');
   $('gmail-sync-status').textContent+=state.labelFiling?' Verified Gmail labels enabled.'+(state.labelError?' Filing needs attention: '+state.labelError:state.labelCheckedAt?' Last checked '+when(state.labelCheckedAt)+'.':' First check pending.'):'';
   $('gmail-sync-labels').dataset.on=String(!!state.labelFiling);$('gmail-sync-labels').textContent=state.labelFiling?'Pause verified Gmail labels':'Enable verified Gmail labels';
   $('gmail-sync-connect').textContent=state.connected?'Reconnect Gmail':'Connect Star Soccer Gmail';
   $('gmail-sync-disconnect').hidden=!state.connected;
  }catch(e){if(profile)$('gmail-sync-status').textContent=e.message;}
 }
 $('gmail-sync-check').addEventListener('click',mailStatus);
 async function connectMail(action){
  if(!data?.gmailSyncAvailable||profile?.role!=='owner')return;
  try{
   const result=await api('gmail-sync/'+action,{}),url=new URL(result.url);
   if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')throw Error('Invalid Google authorization address.');
   location.assign(url.href);
  }catch(e){notice(e.message,true);}
 }
 $('calendar-sync-connect').addEventListener('click',()=>connectMail('connect-calendar'));
 $('gmail-sync-connect').addEventListener('click',()=>connectMail($('gmail-sync-labels').dataset.on==='true'?'connect-labels':'connect'));
 $('gmail-sync-labels').addEventListener('click',async()=>{
  if($('gmail-sync-labels').dataset.on!=='true')return connectMail('connect-labels');
  try{await api('gmail-sync/stop-labels',{});await mailStatus();}catch(e){notice(e.message,true);}
 });
 $('gmail-sync-disconnect').addEventListener('click',async()=>{
  if(!confirm('Stop syncing and remove this Gmail connection from Coach Desk?'))return;
  try{await api('gmail-sync/disconnect',{});await mailStatus();}catch(e){notice(e.message,true);}
 });
 let familyDirectory=[], familyMode='grid', activeFamilyId=null, familyDirectoryLoaded=false, lastFamilyLink=null;
 function renderFamilyDirectory(){
  const container=$('family-directory');
  container.replaceChildren();
  for(const b of document.querySelectorAll('[data-family-mode]'))b.setAttribute('aria-pressed',String(b.dataset.familyMode===familyMode));
  function collection(families,layout){
   const list=node('ul','','families-'+layout);
   for(const family of families){
    const li=node('li'),link=node('a',family.name,'family-choice');
    link.href='#view=families&family='+encodeURIComponent(family.id);
    if(layout==='grid'&&Array.isArray(family.playerIds))link.append(node('small',family.playerIds.length+' linked '+(family.playerIds.length===1?'player':'players')));
    link.addEventListener('click',event=>{
     if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
     event.preventDefault();lastFamilyLink=link;go('families',false,family.id);
    });
    li.append(link);list.append(li);
   }
   return list;
  }
  if(familyMode!=='session'){container.append(collection(familyDirectory,familyMode));return;}
  const seen=new Set(),byPlayer=new Map();
  for(const family of familyDirectory)for(const pid of family.playerIds||[]){
   if(!byPlayer.has(pid))byPlayer.set(pid,[]);
   byPlayer.get(pid).push(family);
  }
  function group(label,families){
   const details=node('details','','family-session'),summary=node('summary',label);
   summary.append(node('small',families.length+' '+(families.length===1?'family':'families')));
   details.append(summary,families.length?collection(families,'list'):node('p','No linked families yet.','muted'));container.append(details);
  }
  for(const roster of window.CoachGroups.familyGroups(data?.sessions||[])){
   const linked=new Set();
   for(const session of roster.sessions)for(const player of session.players||[]){
    for(const family of byPlayer.get(player.playerId)||[])linked.add(family);
   }
   if(!linked.size && roster.verified===false && !roster.kind)continue;
   linked.forEach(f=>seen.add(f.id));
   group(roster.label,[...linked].sort((a,b)=>a.name.localeCompare(b.name)));
  }
  const unplaced=familyDirectory.filter(f=>!seen.has(f.id));
  if(unplaced.length)group('No linked session',unplaced);
 }
 for(const button of document.querySelectorAll('[data-family-mode]'))button.addEventListener('click',()=>{
  familyMode=button.dataset.familyMode;renderFamilyDirectory();
 });
 let followupRequest=0;
 async function loadOwnerFollowups(check=false){
  if(profile?.role!=='owner'||!data?.familyFollowupsAvailable||!(tab==='home'||tab==='attention'&&reportView==='roster'))return;
  const ticket=++followupRequest,box=$('owner-family-followups'),list=$('family-followup-items'),state=$('family-followup-state'),button=$('family-followup-check');
  const homeButton=$('home-registration-review');
  box.hidden=!(tab==='attention'&&reportView==='roster'&&['all','registrations'].includes(reviewFilter));button.disabled=true;list.replaceChildren();state.textContent='Checking registration follow-ups…';
  try{
   const result=await api('family-followups',check?{}:undefined);
   if(ticket!==followupRequest||profile?.role!=='owner')return;
   if(result.state==='ready'){
    const time=timeFormat.format(new Date(result.checkedAt));
    homeButton.hidden=!result.items.length;
    homeButton.textContent='Review registration follow-ups · '+result.items.length+' to review';
    state.textContent=(result.enabled?'Hourly registration check':'One-off registration preview')+' · '+result.eligibleBookings+' eligible bookings · '+result.items.length+' to review · '+time;
    for(const item of result.items){
     const row=node('div','','priority-row'),link=node('a','Review booking · '+item.label);
     link.href=item.bookingUrl;link.target='_blank';link.rel='noopener noreferrer';
     row.append(link,node('p','Confirmation sent '+item.confirmationAt+' · Vancouver','small'));list.append(row);
    }
   }else{
    homeButton.hidden=result.state!=='unavailable';
    homeButton.textContent='Check registration follow-ups';
    state.textContent=({checking:'Registration check in progress.',off:'Hourly registration check is off.',unavailable:'Registration follow-ups unavailable. Try checking again.'})[result.state];
   }
  }catch{
   if(ticket===followupRequest){homeButton.hidden=false;homeButton.textContent='Check registration follow-ups';state.textContent='Registration follow-ups unavailable. Try checking again.';}
  }finally{if(ticket===followupRequest){button.disabled=false;updateHomeAttention();}}
 }
 $('family-followup-check').addEventListener('click',()=>loadOwnerFollowups(true));
 const categories={inquiries:'Inquiries',registrations:'Registrations',payments:'Payments',other:'Other email'};
 let attentionRequest=0,attentionRunning=false,attentionTime=0,reportView='open',reviewFilter='all',reportKind='all',reportSaved='';
 const reportGroups=new Map(),pendingReports=new Set();
 function clearAttention(keepView=false){
  followupRequest++;$('owner-family-followups').hidden=true;$('family-followup-state').textContent='';$('family-followup-items').replaceChildren();
  attentionRequest++;attentionRunning=false;attentionTime=0;reportGroups.clear();pendingReports.clear();
  if(!keepView){reportView='open';reviewFilter='all';}
  $('home-registration-review').hidden=true;$('home-registration-review').textContent='Review registration follow-ups';$('roster-review-list').replaceChildren();$('roster-review-type').replaceChildren();
  reportKind='all';reportSaved='';$('report-search').value='';
  $('home-mail-summary').hidden=true;$('home-mail-summary').textContent='Review inbox';updateHomeAttention();
  historySearch++;$('automation-history').open=false;$('automation-history').hidden=true;$('automation-history-query').value='';$('automation-history-results').replaceChildren();
  $('owner-workflow-panel').open=false;$('owner-workflow-panel').hidden=true;$('owner-workflow-content').replaceChildren();
  for(const id of ['attention-status','attention-groups','report-filters'])$(id).replaceChildren();
 }
 function renderReports(){
  const completed=reportView==='completed',query=$('report-search').value.trim().toLowerCase();
  const summary=$('home-mail-summary');
  const counts=[];
  for(const [kind,group] of reportGroups){
   if(group.liveOK&&group.historyOK){
    const count=[...group.rows.values()].filter(item=>!item.completed).length;
    const label=count===1?{inquiries:'inquiry',registrations:'registration',payments:'payment',other:'other'}[kind]:kind;
    if(count)counts.push(count+' '+label);
   }else if(group.finished)counts.push(categories[kind]+' unavailable');
  }
  summary.hidden=!counts.length;
  summary.textContent=['Review inbox',...counts].join(' · ');
  updateHomeAttention();
  if(tab!=='attention'||reportView==='roster')return;
  const rows=[],problems=[];
  for(const [kind,group] of reportGroups){
   for(const item of group.rows.values())if(item.completed===completed)rows.push({kind,item});
   if(group.finished&&(!group.historyOK||(!completed&&!group.liveOK)))problems.push(categories[kind]);
  }
  const filters=$('report-filters');filters.replaceChildren();
  for(const [key,label] of [['all','All'],...[...reportGroups.keys()].map(k=>[k,categories[k]])]){
   const b=node('button',label,'report-filter');b.type='button';b.setAttribute('aria-pressed',String(reportKind===key));
   if(key!=='all'){
    const group=reportGroups.get(key),ready=group.historyOK&&(completed||group.liveOK);
    b.append(node('span',ready?String(rows.filter(r=>r.kind===key).length):'—','report-total'));
   }
   b.addEventListener('click',()=>{reportKind=key;renderReports();filters.querySelector('[aria-pressed="true"]').focus();});filters.append(b);
  }
  const visible=rows.filter(({kind,item})=>(reportKind==='all'||reportKind===kind)&&[categories[kind],item.title,item.status,item.date].join(' ').toLowerCase().includes(query));
  const sortDate=item=>completed?(item.completedAt||item.date||''):(item.date||'');
  visible.sort((a,b)=>sortDate(b.item).localeCompare(sortDate(a.item))||a.item.title.localeCompare(b.item.title));
  const list=$('attention-groups');list.replaceChildren();
  for(const {kind,item} of visible){
   const row=node('div','','report-row');
   const action=node('button',completed?'Reopen':'✓','report-action'+(completed?' report-reopen':''));
   action.type='button';action.title=completed?'Reopen':'Mark complete';action.setAttribute('aria-label',action.title+': '+item.title);
   action.disabled=!reportGroups.get(kind).finished||pendingReports.has(item.completionToken);action.addEventListener('click',()=>saveReport(kind,item));
   const info=node('div','','report-info'),category=node('span',categories[kind],'report-tag report-'+kind);
   const link=node('a',item.title,'report-subject');link.href=item.href;if(new URL(link.href).hostname!=='mail.google.com')link.target='_blank';link.rel='noopener noreferrer';
   info.append(link,node('small',item.reopened?'Reopened for review':item.status));
   const date=node('time',item.date||'');
   if(/^\d{4}-\d{2}-\d{2}$/.test(item.date||'')){
    date.dateTime=item.date;date.textContent=dateWithYearFormat.format(new Date(item.date+'T12:00:00Z'));
   }
   if(item.completedAt)date.title='Completed '+completedDateFormat.format(new Date(item.completedAt));
   row.append(action,category,info,date);list.append(row);
  }
  if(!visible.length)list.append(node('p',attentionRunning?'Checking reports…':problems.length?'No matching items in the available results.':query?'No reports match your search.':completed?'No completed reports here yet.':'Nothing to review.','report-empty'));
  $('attention-refresh').disabled=attentionRunning||pendingReports.size>0;
  $('attention-status').textContent=[reportSaved,attentionRunning?'Checking reports…':problems.length?'Could not load every item in '+problems.join(', ')+'. Refresh to retry.':''].filter(Boolean).join(' ');
 }
 async function saveReport(kind,item){
  const request=attentionRequest,token=item.completionToken,completed=!item.completed;
  if(pendingReports.has(token))return;
  pendingReports.add(token);reportSaved='';renderReports();
  try{
   const result=await api('needs-attention/'+kind,{completionToken:token,receipt:item.receipt,completed});
   if(request!==attentionRequest)return;
   Object.assign(item,{completed,reopened:!completed,completedAt:result.completedAt||null});
   reportSaved=completed?'Moved to completed.':'Moved to inbox.';
  }catch(e){if(request===attentionRequest)notice('Could not save that report change. Please try again.',true);}
  finally{if(request===attentionRequest){pendingReports.delete(token);renderReports();if(reportView!=='roster'&&tab==='attention'){const target=$('attention-groups').querySelector('button:not(:disabled)')||$(reportView==='completed'?'report-completed':'report-open');target.focus();}}}
 }
 let workflowLoading=false;
 async function renderOwnerWorkflow(){
  const pane=$('owner-workflow-panel'),content=$('owner-workflow-content');if(!pane.open||profile?.role!=='owner'||workflowLoading)return;
  const seq=generation;workflowLoading=true;content.textContent='Checking the ledger, club mailbox and session roster…';
  try{const data=await api('owner-workflows');if(seq!==generation||profile?.role!=='owner')return;content.replaceChildren();
   for(const name of ['Registrations','Payments','Sessions','Coach pay','Winter camp','Attribution']){
    const detail=document.createElement('details'),head=document.createElement('summary'),items=data.items.filter(i=>i.group===name);head.textContent=name+' · '+items.length+' to review';detail.append(head);
    for(const l of data.lines.filter(i=>i.group===name)){const p=document.createElement('p');p.textContent=l.text;detail.append(p);}
    for(const i of items){const p=document.createElement('p'),a=document.createElement('a');a.href=i.link;a.textContent=i.title;a.target='_blank';a.rel='noopener noreferrer';p.append(a,document.createTextNode(' — '+i.action));detail.append(p);}
    content.append(detail);
   }
  }catch{if(seq===generation)content.textContent='The operations report could not be read. Refresh to retry.';}finally{workflowLoading=false;}
 }
 $('owner-workflow-panel').addEventListener('toggle',renderOwnerWorkflow);
 async function loadAttention(force=false){
  $('owner-workflow-panel').hidden=profile?.role!=='owner';if(force)renderOwnerWorkflow();
  if(!profile?.familyAccess)return;
  if(attentionRunning||pendingReports.size||!force&&Date.now()-attentionTime<90000){
   if(tab==='attention')renderReports();
   return;
  }
  const request=++attentionRequest;attentionRunning=true;reportSaved='';reportGroups.clear();
  for(const kind of Object.keys(categories))if(kind!=='other'||profile.role==='owner')reportGroups.set(kind,{rows:new Map(),liveOK:false,historyOK:false,finished:false});
  renderReports();
  async function readPages(kind,history,collect){
   let cursor='';const seen=new Set();
   do{
    if(seen.has(cursor))throw Error('Repeated report page');seen.add(cursor);
    const page=await api('needs-attention/'+kind,history?{cursor,history:true}:{cursor});
    if(request!==attentionRequest)return;
    collect(page);cursor=page.next;
   }while(cursor);
  }
  await Promise.all([...reportGroups].map(async([kind,group])=>{
   const latest=new Map(),resolved=new Set();
   try{
    await readPages(kind,false,page=>{
     for(const item of page.items){
      const previous=latest.get(item.key);
      if(!previous||String(item.date||'')>String(previous.date||'')||item.date===previous.date&&String(item.messageId)>String(previous.messageId))latest.set(item.key,item);
     }
     for(const key of page.resolved)resolved.add(key);
    });
    if(request!==attentionRequest)return;
    for(const [key,item] of latest)if(!resolved.has(key))group.rows.set(item.completionToken,item);
    group.liveOK=true;
   }catch{}
   if(request!==attentionRequest)return;
   try{
    await readPages(kind,true,page=>{
     for(const record of page.items){
      const live=group.rows.get(record.completionToken);
      group.rows.set(record.completionToken,live?{...live,completed:record.completed,reopened:record.reopened,completedAt:record.completedAt}:record);
     }
    });
    group.historyOK=true;
   }catch{}
   group.finished=true;if(request===attentionRequest)renderReports();
  }));
  if(request===attentionRequest){attentionRunning=false;attentionTime=Date.now();renderReports();}
 }
 function reviewTypes(){
  const options=[['all','All reviews'],['attendance','Unfinished attendance'],['observations','Coaching observations']];
  if(full())options.push(['details','Roster details']);
  if(profile?.role==='owner'&&data?.familyFollowupsAvailable)options.push(['registrations','Registration follow-ups']);
  return options;
 }
 function renderRosterReviews(){
  const select=$('roster-review-type');
  select.replaceChildren(...reviewTypes().map(([key,label])=>new Option(label,key)));select.value=reviewFilter;
  const list=$('roster-review-list');list.replaceChildren();
  const {past,due,groups}=rosterReviews(),show=type=>reviewFilter==='all'||reviewFilter===type;
  const section=label=>{const el=node('section','','roster-review-section');el.append(node('h3',label));list.append(el);return el;};
  const sessionLabel=s=>[day(s.date),s.time,s.location].filter(Boolean).join(' · ');
  if(show('attendance')&&past.length){
   const block=section('Unfinished attendance');
   for(const s of past){
    const unmarked=s.players.filter(p=>!p.actualAttendance||p.actualAttendance==='Not marked').map(p=>p.name);
    block.append(homeAction('Mark attendance · '+sessionLabel(s),unmarked.join(', '),()=>openCoachingSession(s.id,'attendance')));
   }
  }
  if(show('observations')&&due.length){
   const block=section('Coaching observations');
   for(const n of due){
    const s=data.sessions.find(row=>row.id===n.session_id);
    block.append(homeAction('Review observation · '+(n.player_id?playerName(n.player_id):s.label),'Due '+day(n.review_date)+' · '+(n.body||n.category||'Session observation'),()=>reviewDueNote(n)));
   }
  }
  if(show('details'))for(const group of groups){
   const block=section(group.label);
   const items=new Map();
   for(const session of group.sessions)for(const issue of session.issues||[]){
    const action=profile.familyAccess&&/^https:\/\/airtable\.com\/app[A-Za-z0-9]{14}\/tbl[A-Za-z0-9]{14}\/rec[A-Za-z0-9]{14}$/.test(issue.action?.href)?issue.action:null;
    const key=JSON.stringify([issue.reason,issue.player,action?.href||session.id]);
    if(!items.has(key))items.set(key,{issue,action,sessions:[]});
    items.get(key).sessions.push(session);
   }
   for(const {issue,action,sessions} of items.values()){
    const first=sessions[0],row=node('div','','roster-issue'),info=node('div');
    info.append(node('strong',issue.reason),node('p',[issue.player,sessionLabel(first),sessions.length>1?sessions.length+' sessions':''].filter(Boolean).join(' · '),'small'));
    let link;
    if(action){link=node('a',action.label,'button secondary');link.href=action.href;link.target='_blank';link.rel='noopener noreferrer';}
    else{link=node('button','Review roster','secondary');link.type='button';link.addEventListener('click',()=>openCoachingSession(first.id,'attendance'));}
    row.append(info,link);block.append(row);
   }
  }
  const registrations=show('registrations')&&profile.role==='owner'&&data.familyFollowupsAvailable;
  $('owner-family-followups').hidden=!registrations;
  if(!list.children.length&&!registrations)list.append(empty('No items to review here.'));
 }
 let historySearch=0;
 $('automation-history-form').addEventListener('submit',async event=>{
  event.preventDefault();
  if(profile?.role!=='owner')return;
  const seq=++historySearch,identity=generation,out=$('automation-history-results');
  out.textContent='Searching recorded activity…';
  try{
   const result=await api('automation-history',{query:$('automation-history-query').value.trim()});
   if(seq!==historySearch||identity!==generation||profile?.role!=='owner')return;
   out.textContent=result.total?('Showing '+result.results.length+' of '+result.total+' matches.'):'No matching activity recorded.';
   for(const row of result.results){
    const card=document.createElement('article'),heading=document.createElement('h3');heading.textContent=row.title;card.append(heading);
    for(const line of row.lines){const p=document.createElement('p');p.textContent=line;card.append(p);}
    for(const link of row.links){const p=document.createElement('p'),a=document.createElement('a');a.textContent=link.label;a.href='https://mail.google.com/mail/u/?authuser=romeo%40starsoccer.ca#all/'+encodeURIComponent(link.id);a.rel='noopener noreferrer';p.append(a);card.append(p);}
    out.append(card);
   }
  }catch{if(seq===historySearch&&identity===generation)out.textContent='Could not read automation history. Try again.';}
 });
 function renderReportPane(){
  $('automation-history').hidden=profile.role!=='owner';
  const roster=reportView==='roster';
  $('report-open').hidden=$('report-completed').hidden=!profile.familyAccess;
  for(const [id,view] of [['report-open','open'],['report-completed','completed'],['report-roster','roster']])$(id).setAttribute('aria-pressed',String(reportView===view));
  $('report-mail').hidden=roster;$('report-roster-panel').hidden=!roster;
  if(roster)renderRosterReviews();else renderReports();
 }
 for(const [id,view] of [['report-open','open'],['report-completed','completed'],['report-roster','roster']]){
  $(id).addEventListener('click',()=>{reportSaved='';go('attention',false,null,{reportView:view,reviewFilter:'all'});});
 }
 $('roster-review-type').addEventListener('change',event=>openReview(event.target.value));
 $('roster-review-refresh').addEventListener('click',()=>loadDesk(true));
 $('home-registration-review').addEventListener('click',()=>openReview('registrations'));
 $('report-search').addEventListener('input',renderReports);
 $('home-mail-summary').addEventListener('click',()=>{reportKind='all';$('report-search').value='';go('attention',false,null,{reportView:'open',reviewFilter:'all'});});
 $('attention-refresh').addEventListener('click',()=>loadAttention(true));
 let familyRequest = 0;
 const cadFormat=new Intl.NumberFormat('en-CA',{style:'currency',currency:'CAD'});
 const familyMoney = value => Number.isFinite(value) ? cadFormat.format(value) : 'Not recorded';
 const familyDate=value=>value && Number.isFinite(Date.parse(value))?dateWithYearFormat.format(Date.parse(value)):value;
 const booksPageSize=40;
 let bookTarget='',expandPayment=false;
 let unpaidFamilies=[],paymentFamily=null,paymentCommand=null,paymentBusy=false,paymentAmountEdited=false;
 const canRecordPayment=()=>canViewBooks()&&profile.role==='owner'&&(openingView?openingView.canRecord:data?.paymentRecordingAvailable)===true;
 let booksRequest=0,booksRows=null,booksDenied=false,booksLimit=booksPageSize,booksMode='family',homeUnpaidState='idle';
 const canViewBooks=()=>!booksDenied&&(!!openingView||data?.booksAvailable===true)&&(profile?.role==='owner'||(profile?.role==='admin'&&profile.familyAccess===true));
 const sessionDue=row=>(row.scope==='session'||row.scope==='booking'&&(row.pastBookingBalance===true||row.attendanceBilled===true))&&row.status==='due'&&Number.isFinite(row.amountDue)&&row.amountDue>0;
 const bookStatuses={resolved:'Resolved',due:'Payment due',paid:'Paid',upcoming:'Upcoming','no-charge':'No charge',package:'Package',review:'Needs review'};

 function resetBooks(){
  closeOpeningView();
  paymentFamily=null;paymentCommand=null;$('pending-booking-payments').replaceChildren();$('booking-payment-form').reset();$('payment-split').textContent='';$('payment-result').textContent='';$('payment-target').replaceChildren();$('payment-entry').hidden=true;
  unpaidFamilies=[];bookTarget='';expandPayment=false;$('unpaid-bookings').hidden=true;$('books-directory').hidden=false;$('selected-balance').textContent='';$('selected-balance-status').textContent='';$('selected-balance-retry').hidden=true;
  $('unpaid-booking-list').replaceChildren();$('unpaid-bookings-title').textContent='';
  booksRequest++;booksRows=null;booksLimit=booksPageSize;homeUnpaidState='idle';
  $('home-unpaid').hidden=true;$('home-unpaid-label').textContent='Unpaid sessions';updateHomeAttention();
  $('books-search').value='';$('books-more').hidden=true;
  $('home-unpaid').open=true;$('books-filter').value='attention';$('books-refresh').disabled=false;
  setBooksMode('family');clearBookTotals();
  for(const id of ['books-list','home-unpaid-list','books-status','home-unpaid-status'])$(id).replaceChildren();
 }
 function bookContact(contact){
  const box=node('div','','books-contact');
  if(!contact?.guardian&&!contact?.email&&!contact?.phone){box.append(node('small','Parent contact unavailable'));return box;}
  box.append(node('small','Parent contact'));
  if(contact.guardian)box.append(node('span',contact.guardian));
  if(contact.email){
   const email=node('a',contact.email);
   if(/^[^\s@?#]+@[^\s@?#]+$/.test(contact.email))email.href='mailto:'+encodeURIComponent(contact.email).replace('%40','@');
   box.append(email);
  }
  if(contact.phone){
   const phone=node('a',contact.phone),dial=String(contact.phone).replace(/[().\s-]/g,'');
   if(/^\+?\d{7,15}$/.test(dial))phone.href='tel:'+dial;
   box.append(phone);
  }
  return box;
 }
 function bookEntry(row){
  const li=node('li','','books-entry'),description=node('div','','books-session');
  description.append(node('strong',row.playerName||'Player not confirmed'));
  if(row.scope==='session'){
   description.append(node('span',[row.sessionLabel,familyDate(row.date),row.time].filter(Boolean).join(' · ')||'Session to confirm','books-date'));
   if(row.location)description.append(node('span',row.location,'books-venue'));
  }else{
   const bookingLabel=[...new Set([row.bookingType,row.sessionLabel].filter(Boolean))].join(' · ');
   description.append(node('span',bookingLabel||'Booking','books-date'));
   const covered=Array.isArray(row.coveredDates)?row.coveredDates.map(familyDate).join(', '):row.coveredDates;
   if(covered||row.date)description.append(node('span',covered||familyDate(row.date),'books-venue'));
  }
  const balance=node('div','','books-balance');
  if(Number.isFinite(row.amountDue))balance.append(node('strong',familyMoney(row.amountDue)+' owing','books-amount'));
  const amounts=[];
  if(Number.isFinite(row.amountCharged))amounts.push('Charged '+familyMoney(row.amountCharged));
  if(Number.isFinite(row.amountPaid))amounts.push('Applied '+familyMoney(row.amountPaid));
  if(amounts.length)balance.append(node('small',amounts.join(' · ')));
  li.append(description,balance);
  if(Object.hasOwn(row,'contact'))li.append(bookContact(row.contact));
  return li;
 }
 function setBooksMode(mode){
  booksMode=mode;$('books-list').dataset.mode=mode;
  for(const button of $('books-modes').querySelectorAll('button'))button.setAttribute('aria-pressed',String(button.dataset.booksMode===mode));
 }
 function clearBookTotals(){
  $('books-summary').hidden=true;
  for(const id of ['books-outstanding','books-due','books-upcoming','books-review-count'])$(id).textContent='';
 }
 function bookTotals(rows){
  let outstanding=0,due=0,upcoming=0,review=0;
  for(const row of rows){
   if(row.status==='review')review++;
   if(Number.isFinite(row.amountOutstanding))outstanding+=Math.round(row.amountOutstanding*100);
   if(Number.isFinite(row.amountDue))due+=Math.round(row.amountDue*100);
   if(Number.isFinite(row.amountUpcoming))upcoming+=Math.round(row.amountUpcoming*100);
  }
  return {outstanding:outstanding/100,due:due/100,upcoming:upcoming/100,review};
 }
 function showBookTotals(rows){
  const totals=bookTotals(rows);
  $('books-outstanding').textContent=familyMoney(totals.outstanding);
  $('books-due').textContent=familyMoney(totals.due);
  $('books-upcoming').textContent=familyMoney(totals.upcoming);
  $('books-review-count').textContent=String(totals.review);
  $('books-summary').hidden=false;
 }
 function bookFamilyLabel(row){
  return row.familyId?(row.contact?.guardian||row.familyName||'Linked family'):'Parent not linked';
 }
 function bookSessionLabel(row){
  if(row.scope==='family')return 'Family payment';
  const group=row.sessionGroupKey&&row.sessionGroupKey!=='whole-bookings'?row.sessionGroupLabel:null;
  const type=row.scope==='booking'?[group,row.bookingType,row.sessionLabel]:[row.sessionLabel||group];
  const covered=Array.isArray(row.coveredDates)?row.coveredDates:[];
  const dates=covered.length>2?familyDate(covered[0])+' – '+familyDate(covered[covered.length-1])+' ('+covered.length+' dates)':
   covered.length?covered.map(familyDate).join(', '):familyDate(row.date);
  return [...new Set([...type,dates,row.time].filter(Boolean))].join(' · ')||'Session to confirm';
 }
 function bookPaymentLabel(row){
  const amounts=[];
  if(row.amountDue>0)amounts.push(familyMoney(row.amountDue)+' due now');
  if(row.amountUpcoming>0)amounts.push(familyMoney(row.amountUpcoming)+' due later');
  if(!amounts.length&&row.amountOutstanding>0)amounts.push(familyMoney(row.amountOutstanding)+' outstanding');
  if(row.status==='review'){
   if(row.reviewBalance>0)amounts.push(familyMoney(row.reviewBalance)+' to verify');
   if(row.amountUnapplied>0)amounts.push(familyMoney(row.amountUnapplied)+' unapplied');
   amounts.push('Needs review');
  }
  if(!amounts.length&&row.amountOutstanding===0&&row.amountPaid>0)return 'Paid';
  return amounts.join(' · ')||bookStatuses[row.status]||'Needs review';
 }
 function bookRecord(row,groupMode){
  const li=node('li','','books-record'),details=node('details'),summary=node('summary');
  const title=node('span','','book-label'),player=row.playerName||'Player to confirm';
  if(row.scope==='family'){
   title.append(node('strong',groupMode==='family'?'Family payment':bookFamilyLabel(row)),node('small',row.reviewReason||'Payment to review'));
  }else{
   const name=groupMode==='family'?player:bookFamilyLabel(row)+' / '+player;
   title.append(node('strong',name),node('small',bookSessionLabel(row)));
  }
  summary.append(title,node('span',bookPaymentLabel(row),'book-amount'));details.append(summary);li.append(details);
  details.addEventListener('toggle',()=>{
   if(!details.open||details.children.length>1)return;
   const body=node('div','','book-detail'),amounts=[];
   if(Number.isFinite(row.amountCharged))amounts.push('Charged '+familyMoney(row.amountCharged));
   if(Number.isFinite(row.amountPaid))amounts.push('Applied '+familyMoney(row.amountPaid));
   if(amounts.length)body.append(node('span',amounts.join(' · ')));
   if(row.coveredDates?.length>2&&Array.isArray(row.coveredDates))body.append(node('span',row.coveredDates.map(familyDate).join(', ')));
   if(row.location)body.append(node('span',row.location));
   if(row.reviewReason&&row.scope!=='family')body.append(node('span',row.reviewReason));
   if(groupMode!=='family')body.append(bookContact(row.contact));
   if(!body.childElementCount)body.append(node('span',bookStatuses[row.status]||'Needs review'));
   if(row.decision)body.append(node('span','Resolved · '+row.decision));
   details.append(body);
  });
  if(profile?.role==='owner' && (row.canCancel || row.absenceOptions?.length)){
   const controls=node('details','','book-review-actions'),label=node('summary','Resolve'),message=node('span');
   controls.append(label);message.setAttribute('role','status');
   const action=(decision,visit)=>{
    const button=node('button',decision+(visit&&row.absenceOptions.length>1?' · '+familyDate(visit.date)+' '+(visit.time||''):''));
    button.onclick=async()=>{
     const flow=generation;
     for(const b of controls.querySelectorAll('button'))b.disabled=true;
     message.textContent='Saving…';
     try{await api('books-outcome',{decision,bookingId:row.bookingId,...(visit?{attendanceId:visit.id}:{})});
      if(flow===generation&&tab==='books')await loadBooks();
     }catch(error){message.textContent=error.message;for(const b of controls.querySelectorAll('button'))b.disabled=false;}
    };controls.append(button);
   };
   if(row.canCancel)action('Cancelled');
   for(const visit of row.absenceOptions||[])action('Did not attend',visit);
   controls.append(message);li.append(controls);
  }
  if(row.reviewKey&&profile?.role==='owner'){
   const controls=node('div','','book-review-actions'),message=node('span');
   message.setAttribute('role','status');
   const submit=async decision=>{
    const flow=generation;
    for(const button of controls.querySelectorAll('button'))button.disabled=true;
    message.textContent='Saving…';
    try{
     await api('books-review',{key:row.reviewKey,decision});
     if(flow!==generation||tab!=='books'||!booksRows)return;
     booksRows=decision==='Deleted'?booksRows.filter(item=>item.reviewKey!==row.reviewKey):
      booksRows.map(item=>item.reviewKey===row.reviewKey?{...item,status:'resolved',decision}:item);
     showBookTotals(booksRows);renderBooks();
     const status=$('books-status');
     status.textContent=decision==='Deleted'?'Review item deleted.':'Resolved · '+decision;
     if(decision==='Deleted'){
      const undo=node('button','Undo');
      undo.onclick=async()=>{undo.disabled=true;try{await api('books-review',{key:row.reviewKey,decision:row.decision||'Reopen'});if(flow===generation&&tab==='books')await loadBooks();}catch(error){undo.disabled=false;status.prepend(error.message+' ');}};
      status.append(' ',undo);
     }
    }catch(error){message.textContent=error.message;for(const button of controls.querySelectorAll('button'))button.disabled=false;}
   };
   if(row.status==='review')controls.append(node('span','Resolve as'));
   for(const decision of [...(row.status==='review'?['Already handled','Duplicate entry','No further action']:[]),'Deleted']){
    const button=node('button',decision==='Deleted'?'Delete':decision);button.onclick=()=>submit(decision);controls.append(button);
   }
   controls.append(message);li.append(controls);
  }
  return li;
 }
 function groupBookRows(rows,mode){
  const groups=new Map();
  for(const row of rows){
   let key,label;
   if(mode==='family'){
    key=row.familyId?'family:'+row.familyId:row.playerId?'player:'+row.playerId:row;
    label=bookFamilyLabel(row);
   }else{
    key=row.sessionGroupKey||row.sessionId||(row.scope==='family'?'family-payments':'unplaced');
    label=row.sessionGroupLabel||row.sessionLabel||(row.scope==='family'?'Family payments':'No linked session');
    if(key==='unplaced')label='No linked session';
   }
   if(!groups.has(key))groups.set(key,{label,rows:[]});
   groups.get(key).rows.push(row);
  }
  return [...groups.values()].map(group=>({...group,totals:bookTotals(group.rows)})).sort((a,b)=>
   b.totals.due-a.totals.due||b.totals.outstanding-a.totals.outstanding||a.label.localeCompare(b.label));
 }
 function bookGroup(group,mode){
  const li=node('li','','books-group'),details=node('details'),summary=node('summary'),label=node('span','','book-label');
  const {rows,totals}=group,count=rows.length+(rows.length===1?' record':' records');
  if($('books-filter').value==='review')details.open=true;
  const players=[...new Set(rows.map(r=>r.playerName).filter(Boolean))];
  const preview=mode==='family'&&players.length?players.slice(0,2).join(', ')+(players.length>2?' +'+(players.length-2):'')+' · ':'';
  label.append(node('strong',group.label),node('small',preview+count));
  const figures=[];
  if(totals.outstanding>0){
   figures.push(familyMoney(totals.outstanding)+' outstanding');
   if(totals.due===totals.outstanding)figures.push('due now');
   else if(totals.upcoming===totals.outstanding)figures.push('due later');
   else if(totals.due>0)figures.push(familyMoney(totals.due)+' due now');
  }
  if(totals.review)figures.push(totals.review+' to review');
  summary.append(label,node('span',figures.join(' · '),'book-amount'));details.append(summary);li.append(details);
  details.addEventListener('toggle',()=>{
   if(!details.open||details.children.length>1)return;
   if(mode==='family'){
    const familyContact=rows.find(row=>row.familyId&&row.contact)?.contact;
    details.append(bookContact(familyContact));
    const {familyId,playerId}=rows[0];
    if(canRecordPayment()&&(familyId||playerId)){
     const family=unpaidByFamily(booksRows.filter(row=>familyId?row.familyId===familyId:!row.familyId&&row.playerId===playerId))[0];
     if(family){const pay=node('button','Record a payment','secondary');pay.type='button';pay.addEventListener('click',()=>{go('books',false,null,{bookTarget:familyId?'family-'+familyId:'player-'+playerId,expandPayment:true});});details.append(pay);}
    }
   }
   const list=node('ul','','book-members');
   list.append(...rows.map(row=>bookRecord(row,mode)));details.append(list);
  });
  return li;
 }
 function matchesBookFilter(row,filter){
  switch(filter){
   case 'attention':return row.amountOutstanding>0||row.status==='review';
   case 'outstanding':return row.amountOutstanding>0;
   case 'due':return row.amountDue>0;
   case 'upcoming':return row.amountUpcoming>0;
   case 'resolved':return row.status==='resolved';
   case 'review':return row.status==='review';
   case 'paid':return row.status==='paid'||row.amountOutstanding===0&&row.amountPaid>0;
   case 'booking':return row.scope==='booking';
   default:return true;
  }
 }
 function renderBooks(){
  if(!canViewBooks()||tab!=='books'||!booksRows)return;
  const filter=$('books-filter').value,query=$('books-search').value.trim().toLocaleLowerCase();
  const visible=booksRows.filter(row=>matchesBookFilter(row,filter)&&(!query||
   [row.familyName,row.contact?.guardian,row.playerName,row.sessionGroupLabel,bookSessionLabel(row),row.coveredDates,row.date,row.location].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)));
  const grouped=booksMode==='family'||booksMode==='session';
  const groups=groupBookRows(visible,booksMode==='session'?'session':'family');
  if(filter==='attention')for(const group of groups)group.rows.sort((a,b)=>Number(b.amountDue>0)-Number(a.amountDue>0)||Number(b.amountUpcoming>0)-Number(a.amountUpcoming>0));
  const items=grouped?groups:groups.flatMap(group=>group.rows);
  const shown=items.slice(0,booksLimit);
  $('books-list').replaceChildren(...shown.map(item=>grouped?bookGroup(item,booksMode):bookRecord(item,booksMode)));
  $('books-more').hidden=items.length<=booksLimit;
  const displayed=grouped?shown.reduce((n,g)=>n+g.rows.length,0):shown.length;
  $('books-status').textContent=displayed<visible.length?'Showing '+displayed+' of '+visible.length+' records.':visible.length?visible.length+(visible.length===1?' record':' records'):'No matching records.';
 }
 function unpaidByFamily(rows){
  const families=new Map(),bookings=new Set();
  for(const row of rows.filter(sessionDue)){
   if(row.bookingId&&bookings.has(row.bookingId))continue;
   if(row.bookingId)bookings.add(row.bookingId);
   const key=row.familyId||row.playerId||row.bookingId||row;
   if(!families.has(key))families.set(key,{id:row.familyId,name:'',cents:0,rows:[]});
   const family=families.get(key);
   family.cents+=Math.round(row.amountDue*100);family.rows.push(row);
  }
  for(const family of families.values()){
   const name=family.rows.find(row=>row.familyName?.trim())?.familyName.trim();
   const children=[...new Set(family.rows.map(row=>row.playerName?.trim()).filter(Boolean))];
   family.name=name||children.join(' & ')||'Name unconfirmed';
  }
  return [...families.values()].sort((a,b)=>a.name.localeCompare(b.name));
 }
 function renderSelectedBalance(preserveForm=false){
  const [kind,id]=bookTarget.split('-');
  const selected=booksRows.filter(row=>kind==='player'?!row.familyId&&row.playerId===id:(kind==='family'?row.familyId:row.bookingId)===id);
  const [family]=unpaidByFamily(selected);
  const status=$('selected-balance-status');
  if(!family){
   $('unpaid-bookings-title').textContent=selected[0]?.familyName||selected[0]?.playerName||'Outstanding sessions';
   status.textContent='No unpaid sessions remain in this selection.';
   paymentFamily=null;paymentCommand=null;$('selected-balance').textContent='';$('payment-entry').hidden=true;$('unpaid-booking-list').replaceChildren();return;
  }
  status.textContent='';$('selected-balance').textContent=familyMoney(family.cents/100)+' owing';
  $('unpaid-bookings-title').textContent=family.name;
  const entries=family.rows.map(row=>{
   const entry=bookEntry(row);
   const details=[row.bookingType,row.attendanceStatus].filter(Boolean);
   if(details.length)entry.querySelector('.books-session').append(node('small',details.join(' · ')));
   return entry;
  });
  $('unpaid-booking-list').replaceChildren(...entries);
  if(preserveForm&&paymentFamily){
   // If a fresh read confirms the selected charges, keep the coach's open form and receipt.
   const same=family.id===paymentFamily.id&&family.rows.length===paymentFamily.rows.length&&family.rows.every(row=>paymentFamily.rows.some(old=>
    old.bookingId===row.bookingId&&old.amountDue===row.amountDue&&old.date===row.date));
   if(same){paymentFamily=family;return;}
   status.textContent='The balance changed. Review the updated amount before recording a payment.';
  }
  setupPaymentForm(family);
  $('payment-entry').open=expandPayment&&!$('payment-entry').hidden;expandPayment=false;
  $('unpaid-bookings-title').focus();
 }
 function setupPaymentForm(family){
  paymentFamily=family;paymentCommand=null;paymentAmountEdited=false;
  const entry=$('payment-entry');entry.open=false;entry.hidden=!canRecordPayment()||!(family.id||family.rows[0]?.playerId);
  const form=$('booking-payment-form');form.reset();$('payment-result').textContent='';
  if(entry.hidden)return;
  const select=$('payment-target');
  select.replaceChildren(new Option('All unpaid sessions · oldest first',''));
  for(const row of family.rows)select.add(new Option([row.pastBookingBalance?'Earlier camp':familyDate(row.date),row.playerName,familyMoney(row.amountDue)].filter(Boolean).join(' · '),row.bookingId));
  $('payment-target-label').hidden=family.rows.length===1;
  $('payment-date').max=today();$('payment-date').value=today();
  for(const field of form.elements)field.disabled=paymentBusy;
  updatePaymentForm(true);
 }
 function updatePaymentForm(fillAmount=false){
  if(!paymentFamily)return [];
  const transfer=$('payment-method').querySelector('input:checked')?.value==='E-transfer';
  $('payment-ref-label').hidden=!transfer;$('payment-reference').required=transfer;
  const target=$('payment-target').value,amount=$('payment-amount');
  const rows=paymentFamily.rows.filter(r=>!target||r.bookingId===target)
   .sort((a,b)=>String(a.date||'').localeCompare(String(b.date||''))||a.bookingId.localeCompare(b.bookingId));
  const max=rows.reduce((sum,r)=>sum+Math.round(r.amountDue*100),0);
  amount.max=(max/100).toFixed(2);
  if(fillAmount&&!paymentAmountEdited)amount.value=amount.max;
  let left=Math.round(amount.valueAsNumber*100);
  const items=[],lines=[];
  if(left>0&&left<=max)for(const row of rows){
   const dueCents=Math.round(row.amountDue*100),applyCents=Math.min(dueCents,left);
   items.push({bookingId:row.bookingId,applyCents,dueCents});
   lines.push((row.pastBookingBalance?'Earlier camp':familyDate(row.date))+' · '+row.playerName+' · '+familyMoney(applyCents/100));left-=applyCents;
   if(!left)break;
  }
  $('payment-split').textContent=items.length?'Apply to '+lines.join('; '):'Available balance: '+familyMoney(max/100);
  return items;
 }
 $('booking-payment-form').addEventListener('input',event=>{
  if(event.target===$('payment-amount'))paymentAmountEdited=true;
  updatePaymentForm(event.target===$('payment-target'));
 });
 async function submitBookingPayment(command,button){
  if(paymentBusy||!canRecordPayment())return;
  const ticket=generation,form=$('booking-payment-form'),inBooks=tab==='books'||!!openingView?.target;
  paymentBusy=true;button.disabled=true;
  if(inBooks){for(const e of form.elements)e.disabled=true;$('payment-result').textContent='Recording payment…';}
  let saved=false;
  try{
   await api('booking-payment',command);
   if(ticket!==generation)return;
   saved=true;paymentCommand=null;
   if(data){delete data.unpaid;delete data.openingBalanceRead;}
   resetFamilyRecords();notice('Payment recorded in Airtable.');
  }catch(error){
   if(ticket!==generation)return;
   const retrySame=!error.code||['PAYMENT_PENDING','SERVICE_UNAVAILABLE'].includes(error.code);
   if(!retrySame)paymentCommand=null;
   if(inBooks){
    for(const e of form.elements)e.disabled=retrySame;
    $('payment-result').textContent=error.message;
   }else notice(error.message,true);
  }finally{
   paymentBusy=false;
   if(ticket===generation){
    button.disabled=false;
    if(openingView){
     if(openingView.target){if(saved)returnToOpeningOverview(true);}
     else readOpeningBalances(openingView);
    }else if(tab==='home'&&(saved||!inBooks||paymentCommand)){
     homeUnpaidState='idle';await loadBooks(true);
    }else if(saved&&tab==='books'){
     go('home');
     $('home-unpaid').open=true;
    }
   }
  }
 }
 $('booking-payment-form').addEventListener('submit',event=>{
  event.preventDefault();if(!canRecordPayment()||!paymentFamily||paymentBusy)return;
  if(!paymentCommand){
   const items=updatePaymentForm();if(!items.length)return;
   const method=$('payment-method').querySelector('input:checked')?.value||'';
   paymentCommand={id:crypto.randomUUID(),...(paymentFamily.id?{familyId:paymentFamily.id}:{playerId:paymentFamily.rows[0].playerId}),date:$('payment-date').value,method,
    reference:method==='E-transfer'?$('payment-reference').value.trim().toUpperCase():'',items};
  }
  submitBookingPayment(paymentCommand,$('payment-submit'));
 });
 function renderPendingPayments(commands){
  const list=$('pending-booking-payments');list.replaceChildren();
  if(!canRecordPayment())return;
  for(const pending of commands){
   const b=node('button','Finish recording '+familyMoney(pending.amount)+' for '+pending.name,'secondary');b.type='button';
   b.addEventListener('click',()=>submitBookingPayment({id:pending.id},b));list.append(b);
  }
 }
 // The same interactive balance card is shown before and after the roster arrives.
 let openingView=null;
 function closeOpeningView(){
  if(!openingView)return;
  restoreOpeningBooking();
  openingView.marker.replaceWith($('home-attention'));
  $('opening-overview').hidden=true;$('opening-roster-retry').hidden=true;
  openingView=null;
 }
 function startOpeningView(snapshot,canRecord){
  const marker=document.createComment('Overview attention'),card=$('home-attention');
  card.before(marker);
  const state={marker,snapshot,canRecord,target:'',latest:null};
  openingView=state;
  $('opening-overview').append(card);
  $('login').hidden=true;$('boot').hidden=true;$('opening-overview').hidden=false;
  $('opening-roster-status').textContent='Loading roster…';
  if(snapshot){
   showUnpaid(snapshot);
   $('home-unpaid-status').textContent='Last checked '+when(snapshot.checkedAt);
   return state;
  }
  $('home-unpaid-label').textContent='Checking unpaid sessions…';$('home-unpaid').hidden=false;updateHomeAttention();
  readOpeningBalances(state);
  return state;
 }
 function readOpeningBalances(state){
  state.latest=null;
  state.read=api('session-books',{view:'unpaid'}).then(result=>{
   if(!Array.isArray(result.rows))throw Error('Books unavailable.');
   state.latest=result;
   if(openingView===state&&!state.target)showUnpaid(result);
   return {result};
  }).catch(error=>{
   if(openingView===state){
    if(error.code==='ACCESS_DENIED'){resetBooks();$('boot').hidden=false;}
    else $('home-unpaid-status').textContent='Could not update balances.';
   }
   return {error};
  });
 }
 function restoreOpeningBooking(){
  const state=openingView;
  if(!state?.bookingMarker)return;
  state.bookingMarker.replaceWith($('unpaid-bookings'));
  state.bookingMarker=null;
  $('opening-overview').querySelector('h1').textContent='Overview';
  const back=$('unpaid-bookings').querySelector('.books-return');
  back.href='#view=books';back.textContent='← All Books';
 }
 function returnToOpeningOverview(paid=false){
  const state=openingView;
  if(!state?.target||paymentBusy)return;
  booksRequest++;state.target='';bookTarget='';paymentFamily=null;paymentCommand=null;
  restoreOpeningBooking();$('unpaid-bookings').hidden=true;
  history.replaceState(null,'','#view=home');
  if(paid){
   state.snapshot=null;unpaidFamilies=[];renderUnpaidRows();$('pending-booking-payments').replaceChildren();
   $('home-unpaid-label').textContent='Checking unpaid sessions…';$('home-unpaid-status').textContent='Payment recorded.';
   readOpeningBalances(state);
  }
  updateHomeAttention();
 }
 $('unpaid-bookings').querySelector('.books-return').addEventListener('click',event=>{
  if(!openingView?.target)return;
  event.preventDefault();returnToOpeningOverview();
 });
 window.addEventListener('popstate',()=>{
  if(openingView?.target&&location.hash!=='#view=books&balance='+openingView.target){
   if(paymentBusy)history.replaceState(null,'','#view=books&balance='+openingView.target);
   else returnToOpeningOverview();
  }
 });
 $('home-unpaid-list').addEventListener('click',event=>{
  const link=event.target.closest('a');
  if(!openingView||!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  openingView.target=new URLSearchParams(link.hash.slice(1)).get('balance');
  bookTarget=openingView.target;
  const detail=$('unpaid-bookings'),back=detail.querySelector('.books-return');
  openingView.bookingMarker=document.createComment('Selected booking');
  detail.before(openingView.bookingMarker);$('opening-overview').append(detail);
  $('opening-overview').querySelector('h1').textContent='Books';$('home-attention').hidden=true;
  back.href='#view=home';back.textContent='← Overview';
  history.pushState(null,'',link.hash);
  loadBooks(false,unpaidFamilies.flatMap(family=>family.rows));
 });
 function renderUnpaidRows(){
  const list=$('home-unpaid-list');list.replaceChildren();
  if(!$('home-unpaid').open)return;
  for(const family of unpaidFamilies){
   const target=family.rows.length===1?'booking-'+family.rows[0].bookingId:family.id?'family-'+family.id:'player-'+family.rows[0].playerId;
   const action=node('a');action.href='#view=books&balance='+target;
   action.append(node('span',family.name),node('strong',familyMoney(family.cents/100)));
   const item=node('li');item.append(action);list.append(item);
  }
 }
 function showUnpaid(result){
   unpaidFamilies=unpaidByFamily(result.rows);homeUnpaidState='ready';
   renderPendingPayments(result.pendingPayments||[]);
   const pending=$('pending-booking-payments').childElementCount;
   const label=$('home-unpaid-label');
   const count=unpaidFamilies.length;
   label.textContent=count?'Unpaid sessions ('+count+(count===1?' family)':' families)'):'Payment to finish';
   $('home-unpaid').hidden=!unpaidFamilies.length&&!pending;
   updateHomeAttention();renderUnpaidRows();$('home-unpaid-status').textContent='';
 }
 async function loadBooks(unpaid=false,previewRows=null){
  if(!canViewBooks()||(!openingView?.target&&tab!==(unpaid?'home':'books')))return;
  let previous=null;
  if(unpaid&&data?.unpaid){
   previous=data.unpaid;delete data.unpaid;
   showUnpaid(previous);
   if(!previous.refresh)return;
   homeUnpaidState='idle';
  }
  if(unpaid){if(homeUnpaidState==='loading'||homeUnpaidState==='ready')return;homeUnpaidState='loading';
   if(!previous){$('home-unpaid-label').textContent='Checking unpaid sessions…';$('home-unpaid').hidden=false;updateHomeAttention();}
  }
  const ticket=++booksRequest,list=$(unpaid?'home-unpaid-list':'books-list'),status=$(unpaid?'home-unpaid-status':bookTarget?'selected-balance-status':'books-status');
  if(!previous)list.replaceChildren();booksRows=null;
  if(!unpaid){
   $('unpaid-bookings').hidden=!bookTarget;$('books-directory').hidden=!!bookTarget;
   $('unpaid-booking-list').replaceChildren();$('payment-entry').hidden=true;paymentFamily=null;
   $('unpaid-bookings-title').textContent='Outstanding sessions';$('selected-balance').textContent='';$('selected-balance-retry').hidden=true;
  }
  status.textContent=previous?'Last checked '+new Date(previous.checkedAt).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})+' · Updating…':unpaid?'Loading unpaid sessions…':'Loading books…';
  if(!unpaid&&bookTarget&&previewRows?.length){
   booksRows=previewRows;renderSelectedBalance();
  }
  if(!unpaid){clearBookTotals();$('books-refresh').disabled=true;$('books-more').hidden=true;booksLimit=booksPageSize;}
  try{
   const openingRead=unpaid&&data?.openingBalanceRead;
   if(openingRead)delete data.openingBalanceRead;
   const response=openingRead?await openingRead:null;
   if(response?.error)throw response.error;
   const result=response?response.result:await api('session-books',unpaid?{view:'unpaid'}:{});
   if(ticket!==booksRequest||!canViewBooks())return;
   if(!Array.isArray(result.rows))throw Error('Books unavailable.');
   if(!unpaid){if(paymentBusy||paymentCommand)return;booksRows=result.rows;if(bookTarget)renderSelectedBalance(!!previewRows);else{showBookTotals(booksRows);renderBooks();}return;}
   showUnpaid(result);
  }catch(error){
   if(ticket!==booksRequest)return;
   if(error.code==='ACCESS_DENIED'){
    booksDenied=true;resetBooks();if(loadingDesk&&!data)$('boot').hidden=false;$('nav-books').hidden=true;$('home-unpaid').hidden=true;
    if(tab==='books')go('home');
    return;
   }
   if(unpaid&&previous&&previous.rows.length){
    homeUnpaidState='failed';
    status.textContent='Last checked '+when(previous.checkedAt)+' · Could not update. Reopen to retry.';
    return;
   }
   if(unpaid){
    unpaidFamilies=[];renderUnpaidRows();
    homeUnpaidState='failed';$('home-unpaid-label').textContent='Check unpaid sessions';$('home-unpaid').hidden=false;updateHomeAttention();
   }
   if(!unpaid&&bookTarget){
    status.textContent=previewRows?.length?'Showing the last checked booking details.':'This balance could not load.';$('selected-balance-retry').hidden=false;
   }else status.textContent=unpaid?'Unpaid sessions could not load. Close and reopen to retry.':'Books could not load. Refresh to retry.';
  }finally{
   if(ticket===booksRequest&&!unpaid)$('books-refresh').disabled=false;
  }
 }
 $('home-unpaid').addEventListener('toggle',()=>{
  if(tab!=='home')return;
  renderUnpaidRows();
  if($('home-unpaid').open&&homeUnpaidState==='failed')loadBooks(true);
 });
 $('opening-roster-retry').addEventListener('click',()=>loadDesk());
 $('books-refresh').addEventListener('click',()=>loadBooks());
 $('selected-balance-retry').addEventListener('click',()=>loadBooks());
 function filterBooks(){booksLimit=booksPageSize;renderBooks();}
 for(const button of $('books-modes').querySelectorAll('button'))button.addEventListener('click',()=>{setBooksMode(button.dataset.booksMode);filterBooks();});
 $('books-filter').addEventListener('change',filterBooks);
 $('books-search').addEventListener('input',filterBooks);
 $('books-more').addEventListener('click',()=>{booksLimit+=booksPageSize;renderBooks();});
 function resetFamilyRecords() {
  familyRequest++;familyDirectory=[];familyDirectoryLoaded=false;activeFamilyId=null;lastFamilyLink=null;
  $('family-directory').replaceChildren();$('family-results').replaceChildren();
  $('family-status').textContent='';$('family-back').hidden=true;$('family-browse').hidden=false;
  if(tab==='families')$('page-title').textContent=titles.families[1];
 }
 function familySection(title) {
  const section=node('section','','family-record-section');
  section.append(node('h2',title));$('family-results').append(section);return section;
 }
 function familyList(parent,title,rows,format,emptyMessage,level='h3') {
  parent.append(node(level,title));
  if(!rows?.length){parent.append(node('p',emptyMessage,'muted'));return;}
  const list=node('ul','','family-record-list');
  for(const row of rows)list.append(node('li',format(row).filter(Boolean).join(' · ')));
  parent.append(list);
 }
 function familyFields(parent,entries) {
  const fields=node('dl','','profile-details');
  for(const [label,value] of entries){
   const row=node('div');row.append(node('dt',label),node('dd',value||'Not recorded'));fields.append(row);
  }
  parent.append(fields);
 }
 function renderFamilyRecord(family) {
  $('page-title').textContent=family.name;
  const timeline=familySection('Family timeline');
  if(!family.timeline?.length)timeline.append(node('p','No timeline entries available.','muted'));
  for(const event of family.timeline||[]){
   const entry=node('article','','family-player');
   entry.append(node('p',[event.date?.slice(0,10)||'Date unavailable',event.kind].join(' · '),'family-note-date'),node('h3',event.title||event.kind));
   for(const detail of event.details.filter(Boolean))entry.append(node('p',detail));
   if(event.message){
    const link=node('a','Open original email in Gmail');
    link.href='https://mail.google.com/mail/u/?authuser=romeo%40starsoccer.ca#all/'+encodeURIComponent(event.message);
    link.target='_blank';link.rel='noopener noreferrer';entry.append(link);
   }
   timeline.append(entry);
  }
  const players=familySection('Players');
  const profiles=family.playerProfiles??(family.players||[]).map(name=>({name}));
  if(!profiles.length)players.append(node('p','No linked players.','muted'));
  for(const player of profiles){
   const card=node('article','','family-player');card.append(node('h3',player.name));players.append(card);
   familyFields(card,[['Applied to training',familyMoney(player.applied)],['Due now',familyMoney(player.dueNow)]]);
   if(player.paymentStatus)card.append(node('p',player.paymentStatus));
   card.append(node('h4','Coaching notes'));
   if(player.notes?.length){
    for(const note of player.notes){
     card.append(node('p',[note.category,familyDate(note.updatedAt)].filter(Boolean).join(' · '),'family-note-date'),node('p',note.body,'family-note-body'));
    }
   }else card.append(node('p',player.notes?'No coaching notes recorded.':'Coaching notes unavailable.','muted'));
   familyList(card,'Attendance records',player.attendance,a=>[familyDate(a.date),a.status,a.label,a.time,a.location],
    player.attendance?'No attendance marked yet.':'Attendance records unavailable.','h4');
  }
  familyFields(familySection('Contact information'),[['Guardian',family.guardian],['Email',family.email],['Phone',family.phone]]);
  const records=familySection('Family records');
  familyList(records,'Registrations',family.registrations,r=>[r.child,r.program,r.weekday,r.date,r.status,r.reference],'No linked registrations.');
  familyList(records,'Bookings',family.bookings,b=>[(b.players||[]).join(', '),b.type,b.dates,b.status,'Applied: '+familyMoney(b.applied),'Balance: '+familyMoney(b.balance),b.reference],'No linked bookings.');
  const payments=familySection('Payments');
  familyFields(payments,[['Verified receipts',familyMoney(family.verifiedReceipts)],['Balance',familyMoney(family.balance)],['Due now',familyMoney(family.dueNow)]]);
  if(family.balanceStatus)payments.append(node('p',family.balanceStatus));
  if(family.unpricedBookings)payments.append(node('p','Bookings awaiting a price: '+family.unpricedBookings));
  familyList(payments,'Payment history',family.payments,p=>[p.date,p.direction,familyMoney(p.amount),p.method,p.verification||'Verification not recorded',p.reference],'No linked payments.');
 }
 function showFamilyView(id) {
  if(!profile?.familyAccess||tab!=='families')return;
  const previous=activeFamilyId;activeFamilyId=id||null;
  $('family-browse').hidden=!!id;$('family-back').hidden=!id;
  $('family-results').replaceChildren();$('family-status').textContent='';
  const request=++familyRequest;
  if(id){
   $('page-eyebrow').textContent='Families';
   $('page-title').textContent=familyDirectory.find(f=>f.id===id)?.name||'Family profile';
   $('page-copy').textContent='';
   $('page-title').focus();
  }else if(familyDirectoryLoaded){
   if(previous && lastFamilyLink?.isConnected)lastFamilyLink.focus();
   if(!familyDirectory.length)$('family-status').textContent='No families in the ledger.';
   return;
  }
  loadFamilyRecords(id,request);
 }
 async function loadFamilyRecords(id,request) {
  $('family-status').textContent=id?'Loading family record…':'Loading families…';
  try{
   const records=id?await api('family',{familyId:id}):await api('families');
   if(request!==familyRequest||!profile?.familyAccess||tab!=='families')return;
   $('family-status').textContent='';
   if(id)renderFamilyRecord(records.family);
   else{
    familyDirectory=records.families;familyDirectoryLoaded=true;renderFamilyDirectory();
    if(!familyDirectory.length)$('family-status').textContent='No families in the ledger.';
   }
  }catch(error){
   if(request!==familyRequest)return;
   $('family-status').textContent=error.message+' ';
   const retry=node('button','Retry','secondary');retry.type='button';
   retry.addEventListener('click',()=>showFamilyView(id));$('family-status').append(retry);
  }
 }
 $('family-back').addEventListener('click',event=>{
  if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  event.preventDefault();
  if(history.state?.fromFamilyDirectory)history.back();else go('families');
 });
 function renderSettings(){if(!profile)return;if(data?.gmailSyncAvailable&&!mailChecked){mailChecked=true;mailStatus();}const roleNames={owner:'Owner · full access',admin:'Admin',super_admin:'Super admin',coach:'Coach'};
  $('profile-name').textContent=profile.name;$('profile-email').textContent=profile.displayEmail||profile.email;$('profile-role').textContent=roleNames[profile.role==='admin'&&profile.familyAccess?'super_admin':profile.role]||'Approved account';
  $('profile-avatar').textContent=profile.name.trim().split(/\s+/).slice(0,2).map(part=>Array.from(part)[0]||'').join('').toLocaleUpperCase();
  $('profile-scope').textContent=profile.role==='owner'?'All coaching, family registrations, payments and team access controls.':profile.familyAccess?'All coaching, family registrations and payments.':profile.role==='admin'?'All sessions and coaching notes. Account access is managed by the owner.':'Your assigned sessions and private notes. Session plans and tactics are shared with the coaches assigned to that session.';
  $('profile-signin').textContent=googleEnabled?'Google sign-in is available for approved accounts. Existing registered passkeys can also be used.':'Use your registered passkey to sign in. Ask the owner if you need access help.';
  $('preference-start').value=preferences.start;$('preference-text-size').value=preferences.textSize;$('preference-session-view').value=preferences.sessionView;
 }
 function savePreferences(reset=false){if(!profile||saveBusy||loadingDesk)return;preferences=reset?preferenceDefaults():cleanPreferences({start:$('preference-start').value,textSize:$('preference-text-size').value,sessionView:$('preference-session-view').value});applyPreferences();if(reset)window.CoachViews?.setDefaultView(preferences.sessionView);renderSettings();try{if(reset)localStorage.removeItem(preferenceKey);else localStorage.setItem(preferenceKey,JSON.stringify(preferences));$('preferences-status').textContent=reset?'Display preferences restored to defaults.':'Reading size and session view applied. Saved in this browser; your starting page applies next visit.';}catch{$('preferences-status').textContent='Applied for this visit. This browser could not save your preferences.';}}
 async function loadTeam(){if(profile.role!=='owner')return;try{const r=await api('users');users=r.users;renderUsers(r.credentials);}catch(e){notice(e.message,true);}}
 function renderUsers(credentials=[]){
  $('team-signin-help').textContent=googleEnabled?'Approved coaches use Continue with Google. Copy the sign-in link to share; no temporary setup link is needed. New coaches also need to be enabled for Google sign-in before their first visit. No email is sent automatically.':'New accounts receive no email automatically. Copy a private setup link to share yourself.';
  $('user-list').replaceChildren(...users.map(u=>{const row=node('div','','account-row'),info=node('div'),actions=node('div','','account-actions');info.append(node('strong',u.name),node('p',(u.displayEmail||u.email)+' · '+({owner:'Owner',admin:'Admin',super_admin:'Super admin',coach:'Coach'})[u.role]+' · '+(u.active?'Active':'Disabled')));if(u.role!=='owner'){const edit=node('button','Edit access','secondary');edit.type='button';edit.addEventListener('click',()=>{editingUser=u;$('user-name').value=u.name;$('user-email').value=u.email;$('user-email').readOnly=true;$('user-role').value=u.role;$('user-active').checked=!!u.active;$('user-title').textContent='Update account access';$('user-cancel').hidden=false;});actions.append(edit);}if(u.active&&googleEnabled){const link=node('button','Copy sign-in link','secondary');link.type='button';link.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.origin+'/workspace');notice('Sign-in link copied. Approved coaches can choose Continue with Google.');}catch{notice('Open '+location.host+'/workspace and choose Continue with Google.',true);}});actions.append(link);}else if(u.active&&!credentials.some(c=>c.email===u.email&&c.passkeys)){const invite=node('button','Copy setup link','secondary');invite.type='button';invite.addEventListener('click',async()=>{try{const v=await api('users/invite',{email:u.email});await navigator.clipboard.writeText(v.url);notice('Private setup link copied. It expires in 30 minutes. Share it only with '+u.name+'.');}catch(e){notice(e.message,true);}});actions.append(invite);}row.append(info,actions);return row;}));
  $('assignment-session').textContent=session()?day(session().date)+' · '+session().time:'Choose a session';
  $('assignments').replaceChildren(...users.filter(u=>u.role==='coach'&&u.active).map(u=>{
   const l=node('label','','inline-check'),i=document.createElement('input');i.type='checkbox';i.checked=u.assignments.includes(selected);i.disabled=!selected||saveBusy||loadingDesk;
   i.addEventListener('change',async()=>{
    const targetSession=selected,assigned=i.checked,flow=generation;
    if(saveBusy||loadingDesk||!targetSession){i.checked=u.assignments.includes(targetSession);return;}
    const controls=[...document.querySelectorAll('#user-form input,#user-form select,#user-form button,#user-list button,#assignments input')].map(control=>[control,control.disabled]);
    saveBusy=true;stopDictation();controls.forEach(([control])=>control.disabled=true);renderAttendanceNavigation();
    try{
     await api('assign',{email:u.email,sessionId:targetSession,assigned});
     if(flow!==generation)return;
     u.assignments=assigned?[...new Set([...u.assignments,targetSession])]:u.assignments.filter(id=>id!==targetSession);
     notice('Coach assignment saved.');
    }catch(e){if(flow===generation){i.checked=u.assignments.includes(targetSession);notice(e.message,true);}}
    finally{saveBusy=false;if(flow===generation&&profile?.role==='owner'){controls.forEach(([control,disabled])=>control.disabled=disabled);renderUsers(credentials);renderAttendanceNavigation();}}
   });
   l.append(i,node('span',u.name));return l;
  }));
  if(!users.some(u=>u.role==='coach'&&u.active))$('assignments').append(empty('Add a coach account to assign sessions. Your owner account already has full access.'));
 }
 function resetUser(){editingUser=null;$('user-form').reset();$('user-email').readOnly=false;$('user-active').checked=true;$('user-title').textContent='Approve a coach';$('user-cancel').hidden=true;}
 async function saveUser(e){e.preventDefault();if($('user-role').value==='super_admin'&&$('user-active').checked&&(editingUser?.role!=='super_admin'||!editingUser.active)&&!confirm('Give this account access to family registrations, contact details, payments and all coaching records?'))return;if($('user-role').value==='admin'&&$('user-active').checked&&(!editingUser||editingUser.role!=='admin'||!editingUser.active)&&!confirm('Give this account access to every session and every coach’s notes?'))return;if(editingUser?.active&&!$('user-active').checked&&!confirm('Disable this account and sign out its active sessions?'))return;try{await api('users/save',{email:$('user-email').value.trim(),name:$('user-name').value.trim(),role:$('user-role').value,active:$('user-active').checked,expectedVersion:editingUser?.session_version||null});resetUser();await loadTeam();notice('Account permissions saved. No email was sent.');}catch(e){notice(e.message,true);}}
 async function loadActivity(){try{const r=await api('audit');$('activity-list').replaceChildren(...r.events.map(e=>{const row=node('div','','audit-row');row.append(node('strong',e.action.replaceAll('-',' ')),node('p',e.actor_email+' · '+when(e.occurred_at)));return row;}));if(!r.events.length)$('activity-list').append(empty('Changes will appear here as the team uses Coach Desk.'));}catch(e){notice(e.message,true);}}
 async function loadLegacy(){try{const r=await api('legacy-notes',{});$('legacy-list').replaceChildren(...r.notes.map(n=>{const card=node('article','','note-card');card.append(node('h3',n.title||'Existing coaching record'),node('p','Legacy record · original authorship not verified','note-meta'));for(const [label,value]of Object.entries(n.fields||{}))if(value)card.append(node('strong',label),node('p',value,'note-body'));return card;}));if(!r.notes.length)$('legacy-list').append(empty('No written legacy coaching notes were returned.'));}catch(e){notice(e.message,true);}}
 function go(next,preserveSession=false,familyId=null,route=null){if(paymentBusy&&!route?.keepSelection)return;
  const previewRows=tab==='home'&&next==='books'&&route?.bookTarget&&!route.keepSelection?unpaidFamilies.flatMap(family=>family.rows):null;
  if(next==='tasks')return;const shortcut=['attendance','notes'].includes(next),reopenGroup=shortcut&&hasOpenedGroup&&!!session();const requestedView=['attendance','notes'].includes(next)?next:next==='plan'&&!preserveSession?'plan':workspaceView;if(['attendance','notes'].includes(next))next='plan';if(saveBusy||loadingDesk||tacticsBusy()||plannerBusy()||!profile||!titles[next]||next==='families'&&!profile.familyAccess||next==='books'&&!canViewBooks()||next==='team'&&profile.role!=='owner'||['activity','legacy','coaches'].includes(next)&&!full())return;if(next!==tab&&tab==='tasks'&&taskDirty()){if(!confirm('Leave follow-ups and discard your unsaved task changes?'))return;resetTaskDraft();}if(next!==tab&&tab==='library'&&(window.CoachLibrary?.isDirty()||window.CoachResources?.isDirty())){if(!confirm('Leave resources and discard your unsaved draft?'))return;window.CoachLibrary?.discard();window.CoachResources?.discard();}if(next!==tab&&tab==='profiles'&&window.CoachProfiles?.isDirty()){if(!confirm('Leave this profile and discard your unsaved note?'))return;window.CoachProfiles.discard();}if(next!==tab)stopDictation();if(next===tab&&next==='plan'&&planDirty())return;if(tab==='plan'&&next!=='plan'&&(noteDirty()||planDirty()||tacticsDirty()||plannerDirty())){if(!confirm('Leave the planner and discard unsaved changes?'))return;resetNote();restorePlanDraft();discardTactics();discardPlanner();}if(next==='plan'&&tab!=='plan'&&!preserveSession){const target=selected&&session()?selected:window.CoachPlanner?.nextSession(data?.sessions)?.id||'';if(!allowSessionChange(target))return;if(target!==selected){resetNote();resetRosterFilters();}selected=target;$('show-all').checked=true;}if(next==='attendance'){const target=attendanceDefault(attendanceSessions());if(!allowSessionChange(target))return;if(target!==selected){resetNote();resetRosterFilters();}selected=target;}else if(session()&&session().status!=='Cancelled'&&!chosenSessions().some(s=>s.id===selected))$('show-all').checked=true;if(next!==tab&&!route?.keepSelection&&(tab==='home'||tab==='books'))resetBooks();if(tab==='families'&&next!==tab)resetFamilyRecords();if(next==='books'){bookTarget=route?.bookTarget||'';expandPayment=!!route?.expandPayment;}if(next==='attention'){
    reportView=profile.familyAccess?(route?.reportView||reportView):'roster';
    reviewFilter=route?.reviewFilter||reviewFilter;
    if(!reviewTypes().some(([key])=>key===reviewFilter))reviewFilter='all';
   }
   workspaceView=requestedView;tab=next;renderSelector();$('session-toolbar').hidden=true;$('settings-navigation').hidden=!settingsTabs.includes(tab);$('refresh').hidden=settingsTabs.includes(tab)||['families','books','attention'].includes(tab);if(tab==='attendance')renderAttendance();document.querySelectorAll('.tab-panel').forEach(p=>{p.hidden=p.id!=='panel-'+tab;});document.querySelectorAll('#navigation button[data-tab]').forEach(b=>{const active=b.dataset.tab===(tab==='plan'?'plan':tab)||b.dataset.tab==='settings'&&settingsTabs.includes(tab);b.classList.toggle('nav-active',active);if(active)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});document.querySelectorAll('[data-settings-tab]').forEach(b=>{if(b.dataset.settingsTab===tab)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});const t=tab==='plan'&&workspaceView!=='plan'?[titles[workspaceView][0],titles[workspaceView][1],'Choose a training group to open '+(workspaceView==='attendance'?'its attendance.':'its group and player notes.')]:titles[tab];$('page-eyebrow').textContent=t[0];$('page-title').textContent=t[1];$('page-copy').textContent=t[2];if(tab==='home'){renderHome();if(canViewBooks())loadBooks(true);if(data.familyFollowupsAvailable)loadOwnerFollowups();}if(tab==='attention'){renderReportPane();if(reportView==='roster'&&profile.role==='owner'&&data.familyFollowupsAvailable&&['all','registrations'].includes(reviewFilter))loadOwnerFollowups();}if(profile.familyAccess && (tab==='attention'&&reportView!=='roster'||tab==='home'&&data.attentionAvailable))loadAttention();if(tab==='books'&&!route?.keepSelection)loadBooks(false,previewRows);if(tab==='families')showFamilyView(familyId);if(tab==='notes')renderNotes();if(tab==='plan'){if(!preserveSession&&!reopenGroup)window.CoachPlanner?.exitFocus();if(preserveSession||reopenGroup||window.CoachPlanner?.isFocused())loadPlan();renderWorkspaceView();}if(tab==='tasks')renderTasks();if(tab==='settings')renderSettings();if(tab==='team')loadTeam();if(tab==='activity')loadActivity();publishCoachContext();if(reopenGroup){renderAttendance();renderNotes();window.CoachPlanner?.focusSession(selected);}renderWorkspaceView();}
 function render(){if(!data)return;renderSelector();renderHome();renderAttendance();renderNotes();if(tab==='plan'&&!planDirty())loadPlan();if(tab==='team')loadTeam();if(tab==='settings')renderSettings();publishCoachContext();}
 const opensOverview=()=>(fragment.get('view')||tab)==='home';
 async function loadDesk(refresh=false,initialDesk=null,balanceSnapshot=undefined,canRecord=false){
  if(saveBusy||paymentBusy||loadingDesk||tacticsBusy()||plannerBusy())return;
  stopDictation();
  if(refresh&&(noteDirty()||planDirty()||tacticsDirty()||plannerDirty()||taskDirty())){
   if(!confirm('Refresh the roster and discard unsaved notes, plans, tactics or follow-ups?'))return;
   resetNote();restorePlanDraft();discardTactics();discardPlanner();resetTaskDraft();
  }
  loadingDesk=true;rosterLoadFailed=false;
  publishStatus();
  $('desk-main').setAttribute('aria-busy','true');
  $('desk-loading').hidden=!refresh;
  $('refresh').textContent=refresh?'Refreshing…':'Refresh roster';
  $('refresh').disabled=true;
  $('global-error').hidden=true;
  if(data&&tab==='plan'&&workspaceView==='attendance')renderAttendance();
  else for(const button of $('roster').querySelectorAll('.attendance-controls button'))button.disabled=true;
  try{
   const opening=openingView||(balanceSnapshot!==undefined&&!data&&opensOverview()?startOpeningView(balanceSnapshot,canRecord):null);
   if(opening){$('opening-roster-retry').hidden=true;$('opening-roster-status').textContent='Loading roster…';}
   let fresh=initialDesk;
   if(refresh){
    fresh=await api('refresh',{},true);
    planSession=null;
   }
   // Older servers return only a scoped roster on refresh.
   data=fresh?.profile&&Array.isArray(fresh.notes)&&Array.isArray(fresh.tasks)?fresh:await api('desk',undefined,false,(!opening||!!opening.snapshot)&&!refresh&&opensOverview());
   if(opening?.read&&openingView===opening&&data.booksAvailable&&!opening.target){
    if(opening.latest)data.unpaid=opening.latest;
    else {delete data.unpaid;data.openingBalanceRead=opening.read;}
   }
   if(refresh)attendanceErrors.clear();
   if(selected&&!data.sessions.some(s=>s.id===selected)){
    selected='';noteFolder='';planSession=null;planPendingSession=null;planLoad++;resetNote();
   }
   profile=data.profile;
   const refreshedBookTarget=refresh&&tab==='books'?bookTarget:'';
   const keepSelection=!!opening?.target&&opening===openingView&&data.booksAvailable===true&&
    (profile.role==='owner'||profile.role==='admin'&&profile.familyAccess)&&opening.canRecord===(data.paymentRecordingAvailable===true);
   const editing=keepSelection&&$('unpaid-bookings').contains(document.activeElement)?document.activeElement:null;
   clearAttention(refresh);resetFamilyRecords();
   if(keepSelection)closeOpeningView();else resetBooks();
   booksDenied=false;
   $('nav-books').hidden=!canViewBooks();
   if(tab==='books'&&!canViewBooks())tab='home';
   $('nav-attention').hidden=false;
   $('nav-families').hidden=!profile.familyAccess;
   $('gmail-sync-settings').hidden=!data.gmailSyncAvailable;
   notes=data.notes;tasks=data.tasks;
   $('identity').textContent=profile.name+' · '+(profile.displayEmail||profile.email);
   const role=profile.role==='admin'&&profile.familyAccess?'super_admin':profile.role;
   $('role').textContent=({owner:'Owner · full access',admin:'Admin',super_admin:'Super admin',coach:'Coach · assigned sessions'})[role];
   document.querySelectorAll('[data-owner]').forEach(e=>e.hidden=profile.role!=='owner');
   document.querySelectorAll('[data-full]').forEach(e=>e.hidden=!full());
   if(profile.role!=='owner'){
    users=[];resetUser();$('user-list').replaceChildren();$('assignments').replaceChildren();
   }
   if(!full()){$('activity-list').replaceChildren();$('legacy-list').replaceChildren();}
   $('login').hidden=true;$('app').hidden=false;$('boot').hidden=true;loadingDesk=false;
   if(tab==='families'&&!profile.familyAccess)tab='home';
   if(tab==='team'&&profile.role!=='owner'||['activity','legacy','coaches'].includes(tab)&&!full())tab='settings';
   if(tab==='plan'&&!selected){
    selected=window.CoachPlanner?.nextSession(data.sessions)?.id||'';
    $('show-all').checked=true;
   }
   if(refresh){
    // Replace any previously displayed records with the newly authorized roster.
    if(tab!=='home')renderHome();
    renderAttendance();renderNotes();
   }
   const requested=opening?.target&&canViewBooks()?{view:'books',bookTarget:opening.target,keepSelection}:undefined;
   if(!window.CoachNavigation?.openInitial(requested))go(requested?.view||tab,false,null,{bookTarget:requested?.bookTarget||refreshedBookTarget,keepSelection});
   if(editing?.isConnected)editing.focus({preventScroll:true});
  }catch(e){
   rosterLoadFailed=true;
   if(openingView?.target&&profile&&!data&&e.code!=='ACCESS_DENIED'){
    $('opening-roster-status').textContent='Roster unavailable. You can keep working on this booking.';
    $('opening-roster-retry').hidden=false;return;
   }
   if(openingView)resetBooks();
   if(profile&&!data)showSignedInRecovery();
   notice(data?'The roster could not refresh. Showing the last loaded records. '+e.message:e.message,true);
  }finally{
   loadingDesk=false;
   $('desk-main').setAttribute('aria-busy','false');
   $('desk-loading').hidden=true;
   $('refresh').textContent='Refresh roster';$('refresh').disabled=false;
   if(data&&tab==='plan'&&workspaceView==='attendance')renderAttendance();
   publishStatus();
  }
 }
 function exportNotes(){const esc=v=>'"'+String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"',rows=[['Player','Category','Note','Author','Updated','Review date'],...folderNotes().map(n=>[playerName(n.player_id),n.category,n.body,n.author_email,n.updated_at,n.review_date])],url=URL.createObjectURL(new Blob(['\ufeff'+rows.map(r=>r.map(esc).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download=club.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')+'-private-coach-notes.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 document.querySelectorAll('[data-session-view]').forEach(button=>button.addEventListener('click',()=>setWorkspaceView(button.dataset.sessionView)));
 window.addEventListener('coach:workspace-view',event=>setWorkspaceView(event.detail?.view));
 window.addEventListener('coach:note-folder',event=>{const v=event.detail||{};let accepted=false;if(typeof v.resolve!=='function')return;if(saveBusy||loadingDesk||plannerBusy()||tacticsBusy()||tab!=='plan')return v.resolve(false);if(v.playerId!==''&&!groupRows().some(s=>s.players.some(p=>p.playerId===v.playerId)))return v.resolve(false);if(noteDirty()&&!confirm('Change player folders and discard the unsaved note?'))return v.resolve(false);stopDictation();noteFolder=v.playerId;resetNote();$('note-search').value='';$('note-category-filter').value='all';$('note-review-filter').checked=false;renderSelector();renderNotes();publishCoachContext();v.resolve(true);});
 $('google-signin-button').addEventListener('click',signInWithGoogle);document.querySelectorAll('#navigation button[data-tab]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.tab)));$('signin-form').addEventListener('submit',e=>{e.preventDefault();authenticate(false);});$('enroll-button').addEventListener('click',()=>authenticate(true,'device'));$('enroll-phone-button').addEventListener('click',()=>authenticate(true,'phone'));$('existing-signin-button').addEventListener('click',()=>{enrollment=null;showLogin();});$('retry-workspace').addEventListener('click',async()=>{const b=$('retry-workspace');b.disabled=true;try{const bootstrap=await api('bootstrap');csrf=bootstrap.csrfToken;profile=bootstrap.profile;if(profile)await loadDesk();else showLogin();}catch(e){notice(e.message,true);}finally{b.disabled=false;}});$('logout').addEventListener('click',async()=>{if(saveBusy||loadingDesk||tacticsBusy()||plannerBusy())return;if((noteDirty()||planDirty()||tacticsDirty()||plannerDirty()||taskDirty())&&!confirm('Sign out and discard unsaved changes?'))return;stopDictation();try{await api('logout',{});enrollment=null;tab=preferences.start;showLogin();const b=await api('bootstrap');csrf=b.csrfToken;}catch(e){notice(e.message,true);}});$('session').addEventListener('change',()=>{if(!allowSessionChange($('session').value)){$('session').value=selected;return;}selected=$('session').value;resetNote();resetRosterFilters();render();});$('show-all').addEventListener('change',()=>{const before=!$('show-all').checked,next=chosenSessions().some(s=>s.id===selected)?selected:chosenSessions()[0]?.id||'';if(!allowSessionChange(next)){$('show-all').checked=before;return;}if(next!==selected){resetNote();resetRosterFilters();}render();});$('attendance-upcoming').addEventListener('click',()=>setAttendanceView('upcoming'));$('attendance-past').addEventListener('click',()=>setAttendanceView('past'));$('attendance-past-day').addEventListener('change',()=>setAttendanceView('past',$('attendance-past-day').value));$('attendance-slot').addEventListener('change',()=>chooseAttendanceSession($('attendance-slot').value));$('attendance-history').addEventListener('change',()=>chooseAttendanceSession($('attendance-history').value));$('refresh').addEventListener('click',()=>loadDesk(true));$('go-attendance').addEventListener('click',()=>openCoachingSession(selected,'attendance'));$('go-plan').addEventListener('click',()=>openCoachingSession(selected,'plan'));$('note-form').addEventListener('submit',saveNote);$('note-cancel').addEventListener('click',()=>{if(noteUncertain&&!confirm('Clear this unverified draft? Refresh the roster and review the notes before adding it again.'))return;resetNote();renderNotes();});$('note-search').addEventListener('input',renderNotes);$('note-category-filter').addEventListener('change',renderNotes);$('note-review-filter').addEventListener('change',renderNotes);document.querySelectorAll('[data-task-filter]').forEach(b=>b.addEventListener('click',()=>{if(saveBusy||loadingDesk)return;taskView=b.dataset.taskFilter;renderTasks();}));$('roster-search').addEventListener('input',renderAttendance);$('roster-status-filter').addEventListener('change',renderAttendance);$('print-roster').addEventListener('click',printRoster);$('roster-search-clear').addEventListener('click',()=>{$('roster-search').value='';renderAttendance();$('roster-search').focus();});$('plan-form').addEventListener('submit',savePlan);$('task-form').addEventListener('submit',saveTask);$('user-form').addEventListener('submit',saveUser);$('user-cancel').addEventListener('click',resetUser);$('load-legacy').addEventListener('click',loadLegacy);$('export-notes').addEventListener('click',exportNotes);
 document.querySelectorAll('[data-settings-tab]').forEach(button=>button.addEventListener('click',()=>go(button.dataset.settingsTab)));
 $('open-profile').addEventListener('click',()=>{go('settings');if(tab==='settings')$('page-title').scrollIntoView({block:'start',behavior:'auto'});});
 $('preferences-form').addEventListener('submit',event=>event.preventDefault());
 for(const id of ['preference-start','preference-text-size','preference-session-view'])$(id).addEventListener('change',()=>savePreferences());
 $('reset-preferences').addEventListener('click',()=>savePreferences(true));
 $('copy-workspace-link').addEventListener('click',async()=>{if(!profile)return;try{await navigator.clipboard.writeText(location.origin+'/workspace');notice('Coach Desk link copied. Only approved accounts can sign in.');}catch{notice('Coach Desk link: '+location.origin+'/workspace');}});
 $('settings-navigation').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;const buttons=[...$('settings-navigation').querySelectorAll('button')].filter(b=>!b.hidden&&!b.disabled),index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowLeft'?-1:1)+buttons.length)%buttons.length].focus();});
 $('note-player').addEventListener('change',()=>{stopDictation();publishCoachContext();});$('note-form').addEventListener('input',syncDraftIndicators);$('plan-form').addEventListener('input',syncDraftIndicators);window.addEventListener('coach:blocks-changed',syncDraftIndicators);window.addEventListener('coach:request-status',publishStatus);
 window.addEventListener('afterprint',clearPrintRoster);
 window.addEventListener('beforeunload',event=>{if(attendancePending.size||noteDirty()||planDirty()||tacticsDirty()||tacticsBusy()||plannerDirty()||plannerBusy()||taskDirty()){event.preventDefault();event.returnValue='';}});
 $('navigation').addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End'].includes(event.key))return;const buttons=[...$('navigation').querySelectorAll('button')].filter(button=>!button.hidden&&!button.disabled&&button.getClientRects().length),index=buttons.indexOf(document.activeElement);if(index<0)return;event.preventDefault();const target=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(['ArrowLeft','ArrowUp'].includes(event.key)?-1:1)+buttons.length)%buttons.length;buttons[target].focus();buttons[target].scrollIntoView({block:'nearest',inline:'nearest'});});
 const requestedView=fragment.get('view');if([...startViews,'settings'].includes(requestedView))tab=requestedView;
 $('attendance-past-day').replaceChildren(new Option('All days','all'),...trainingDays.map(d=>new Option(d.label,String(d.number))));
 (async()=>{try{const b=await api('bootstrap',undefined,!enrollment,!enrollment&&opensOverview());csrf=b.csrfToken;googleEnabled=!!b.googleEnabled;profile=b.profile;if(profile&&!enrollment)await loadDesk(false,b.desk,b.balanceSnapshot,b.paymentRecordingAvailable);else showLogin();}catch(e){showLogin();notice(e.message,true);}})();
})();
