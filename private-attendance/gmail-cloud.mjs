import {randomBytes,createHash,createCipheriv,createDecipheriv} from 'node:crypto';
import {Buffer} from 'node:buffer';
import {createFollowupJob} from './registration-followup-job.mjs';
import {ownerWorkflows,fields as reportFields} from './owner-workflows.mjs';
import {checkConfirmationDrafts} from './confirmation-drafts.mjs';
import {outcomeFiling} from './gmail-outcome-labels.mjs';
import {reportCompletions} from './report-completions.mjs';
import {attentionPage,filterReportItems} from './attention-inbox.mjs';
import {classifyMessage,depositLabel} from './gmail-message.mjs';
import {airtableClient,syncLedgerEvent} from './gmail-ledger.mjs';
import {createAirtableTransport} from './airtable-transport.mjs';
import {STAR_SOCCER_OWNER} from './deployment-config.mjs';

const scope='https://www.googleapis.com/auth/gmail.readonly';
const calendarScope='https://www.googleapis.com/auth/calendar.events.readonly';
const labelScope='https://www.googleapis.com/auth/gmail.modify';
const root='https://gmail.googleapis.com/gmail/v1/users/me/';
const pollInterval=120000, retryDelay=300000, googleToken='https://oauth2.googleapis.com/token';
const random=()=>randomBytes(32).toString('base64url');
const hash=s=>createHash('sha256').update(s).digest('base64url');
const redirect='https://starsoccer.ca/coachdesk/api/auth/google/callback';
export const gmailHost='gmail-sync.internal';
function seal(value, secret) {
  const iv=randomBytes(12),key=createHash('sha256').update('gmail-offline-v1:'+secret).digest();
  const cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),data].map(v=>v.toString('base64url')).join('.');
}
function open(value,secret) {
  const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64url'));
  const key=createHash('sha256').update('gmail-offline-v1:'+secret).digest();
  const cipher=createDecipheriv('aes-256-gcm',key,iv);cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');
}
export function createCloudMail(storage,env,{fetchFn=fetch,clock=Date.now}={}) {
  const config=JSON.parse(env.AIRTABLE_CONFIG);
  const ledger=airtableClient(config,env.AIRTABLE_TOKEN,createAirtableTransport({fetchFn}));
  const campPlacementSince=config.exclusiveWriter===true&&config.tables.sessions&&config.tables.attendance
    ? env.CAMP_AUTO_PLACE_SINCE : undefined;
  async function token(grant){
    const res=await fetchFn(googleToken,{method:'POST',redirect:'manual',headers:{'Content-Type':'application/x-www-form-urlencoded'},signal:AbortSignal.timeout(15000),body:new URLSearchParams({...grant,client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET}).toString()});
    const data=await res.json().catch(()=>({}));
    if(!res.ok||!data.access_token)throw Error(data.error==='invalid_grant'?'GOOGLE_RECONNECT':'GOOGLE_TOKEN_FAILED');
    return data;
  }
  async function gmail(access,path,params=[]) {
    const url=new URL(path,root); for(const [key,value] of params)url.searchParams.append(key,value);
    const r=await fetchFn(url,{redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+access}});
    if(!r.ok){
      if(r.status===403){const data=await r.json().catch(()=>({}));if((data.error?.details||[]).some(d=>d.reason==='SERVICE_DISABLED')||data.error?.errors?.some(d=>d.reason==='accessNotConfigured'))throw Error('GMAIL_API_DISABLED');}
      throw Error('GMAIL_'+r.status);
    }
    return r.json();
  }
  async function bootstrap(access,prior,allowedAddress,checkRename=false) {
    const profile=await gmail(access,'profile');
    const address=profile.emailAddress?.toLowerCase();
    if(!address||![STAR_SOCCER_OWNER,allowedAddress].includes(address)||!profile.historyId)throw Error('WRONG_MAILBOX');
    if(checkRename&&address!==STAR_SOCCER_OWNER){
      // A Workspace rename can preserve this owner's Google identity. Confirm
      // that the account still holds an actual registration from this ledger.
      const rows=await ledger.list('registrations',['Source Gmail ID']);
      const ids=[...new Set(rows.map(row=>row.fields['Source Gmail ID']).filter(id=>/^[a-f0-9]{12,32}$/i.test(id)))].slice(-5);
      let found=false;
      for(const id of ids){
        try{if((await gmail(access,'messages/'+id,[['format','minimal']])).id===id){found=true;break;}}
        catch(error){if(error.message!=='GMAIL_404')throw error;}
      }
      if(!found)throw Error('WRONG_MAILBOX');
    }
    return {phase:'recent',start:prior?.lastScan||prior?.start||clock()-86400000,history:profile.historyId};
  }
  async function readLabels(access){
    const data=await gmail(access,'labels');
    return Object.fromEntries(data.labels.map(l=>[l.name,l.id]));
  }
  async function ensureLabels(access){
    const labels=await readLabels(access);
    if(!labels[depositLabel])throw Error('PAYMENT_LABELS_MISSING');
    return labels;
  }
  async function enqueue(ids,scan){
    await storage.transaction(async tx=>{
      for(const id of new Set(ids))if(/^[a-zA-Z0-9_-]{1,100}$/.test(id))await tx.put('q:'+id,true);
      await tx.put('scan',scan);
    });
  }
  async function scanPage(access,scan,labels){
    const params=[['maxResults','50']];if(scan.page)params.push(['pageToken',scan.page]);
    if(scan.phase!=='history'){
      if(scan.phase==='recent'){
        const incoming=followupEnabled?'{-in:sent (in:sent subject:confirmed)}':campPlacementSince?'{-in:sent (in:sent subject:"Star Soccer camp registration confirmed")}':'-in:sent';
        params.push(['q','after:'+Math.floor((scan.start-300000)/1000)+' '+incoming+' -in:drafts -in:spam -in:trash']);
      }
      else params.push(['labelIds',labels[depositLabel]]);
      const data=await gmail(access,'messages',params);
      const next={...scan,page:data.nextPageToken||''};
      if(!data.nextPageToken)next.phase=scan.phase==='recent'?'deposits':'history';
      await enqueue((data.messages||[]).map(m=>m.id),next);return;
    }
    let data;
    try{data=await gmail(access,'history',[...params,['startHistoryId',scan.history],['historyTypes','messageAdded'],['historyTypes','labelAdded']]);}
    catch(err){if(err.message!=='GMAIL_404')throw err;await storage.put('scan',await bootstrap(access,scan,await storage.get('ownerAddress')));return;}
    const relevant=new Set([depositLabel,'Payments - Incoming','Leads','Registrations'].map(k=>labels[k]).filter(Boolean));
    const ids=[];
    for(const change of data.history||[]){
      for(const added of change.messagesAdded||[])ids.push(added.message.id);
      for(const add of change.labelsAdded||[])if(add.labelIds.some(id=>relevant.has(id)))ids.push(add.message.id);
    }
    if(!data.historyId)throw Error('GMAIL_HISTORY_INCOMPLETE');
    await enqueue(ids,data.nextPageToken?{...scan,page:data.nextPageToken}:{phase:'history',history:data.historyId,lastScan:clock()});
  }
  const followupEnabled=env.FOLLOWUP_24H_ENABLED==='true';
  async function checkFollowups(access,force=false){
    return createFollowupJob({storage,ledger,read:(path,params)=>gmail(access,path,params),config,clock}).step({force});
  }
  async function cycle(){
    const encrypted=await storage.get('refresh');if(!encrypted)return;
    // Schedule before external calls so a Worker interruption cannot stop the loop.
    await storage.setAlarm(clock()+pollInterval);
    try{
      const credentials=await token({grant_type:'refresh_token',refresh_token:open(encrypted,env.COOKIE_KEY)});
      if(credentials.refresh_token)await storage.put('refresh',seal(credentials.refresh_token,env.COOKIE_KEY));
      const access=credentials.access_token,labels=await ensureLabels(access);
      const filing=await storage.get('filing:enabled')?outcomeFiling({storage,ledger,labels,clock,owners:[STAR_SOCCER_OWNER,await storage.get('ownerAddress')],read:(path,params)=>gmail(access,path,params),modify:async(id,addLabelIds)=>{
       const r=await fetchFn(new URL('messages/'+id+'/modify',root),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({addLabelIds})});
       if(!r.ok)throw Error('GMAIL_'+r.status);
      }}):null;
      let pending=await storage.list({prefix:'q:',limit:1});
      if(!pending.size){
        const scan=await storage.get('scan')||await bootstrap(access,null,await storage.get('ownerAddress'));
        await scanPage(access,scan,labels);
        pending=await storage.list({prefix:'q:',limit:1});
      }
      for(const key of pending.keys()){
        let message;
        try{message=await gmail(access,'messages/'+key.slice(2),[['format','full']]);}
        catch(err){if(err.message!=='GMAIL_404')throw err;}
        if(message){
          if(filing?.isReceipt(message))await storage.put('filing:receipt:'+message.id,message.id);
          try{
            const mailbox=campPlacementSince||followupEnabled?(await storage.get('ownerAddress')||STAR_SOCCER_OWNER):undefined;
            await syncLedgerEvent(ledger,classifyMessage(message,labels,STAR_SOCCER_OWNER,mailbox,followupEnabled),{campPlacementSince,trackConfirmation:followupEnabled,now:new Date(clock())});
          }
          catch(err){
            if(!/^AIRTABLE_/.test(err.message))throw err;
            const id=key.slice(2);
            await storage.transaction(async tx=>{
              await tx.put('retry:'+id,{after:clock()+retryDelay,error:/^AIRTABLE_\d{3}$/.test(err.message)?err.message:'AIRTABLE_RETRY'});
              await tx.delete(key);
            });
            continue;
          }
        }
        await storage.delete([key,'retry:'+key.slice(2)]);
      }
      const state=await storage.get('scan');
      const retries=await storage.list({prefix:'retry:'});
      for(const [key,retry] of retries)if(retry.after<=clock())await storage.put('q:'+key.slice(6),true);
      await storage.put('report',{lastCheck:new Date(clock()).toISOString(),error:retries.size?retries.values().next().value.error:null,pendingRetries:retries.size});
      const follow=followupEnabled?await checkFollowups(access).catch(()=>({state:'unavailable'})):null;
      const filingPending=filing?await filing.step():false;
      if(filing && !filingPending && clock()-(await storage.get('confirmation:last')||0)>=3600000){
        try{
          await checkConfirmationDrafts({db:ledger,storage,now:clock(),read:id=>gmail(access,'messages/'+id,[['format','minimal']]),search:async q=>(await gmail(access,'messages',[['q',q],['maxResults','1']])).messages||[],create:async raw=>{
            const response=await fetchFn(new URL('drafts',root),{method:'POST',redirect:'manual',signal:AbortSignal.timeout(15000),headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({message:{raw}})});
            if(!response.ok)throw Error('GMAIL_'+response.status);return response.json();
          }});
          await storage.put('confirmation:last',clock());await storage.delete('confirmation:error');
        }catch{await storage.put('confirmation:error','Check the Gmail draft workflow and the saved template.');}
      }
      if(filingPending||pending.size||state?.phase!=='history'||state.page||follow?.state==='checking')await storage.setAlarm(clock()+3000);
    }catch(err){
      const allowed=/^(AIRTABLE_\d{3}|GMAIL_\d{3}|GMAIL_API_DISABLED|PAYMENT_LABELS_MISSING|GOOGLE_RECONNECT|GOOGLE_TOKEN_FAILED)$/;
      const report=await storage.get('report')||{};
      await storage.setAlarm(clock()+retryDelay);
      await storage.put('report',{...report,error:allowed.test(err.message)?err.message:'SYNC_RETRY'});
    }
  }
  const attentionCache=new Map();
  const completions=reportCompletions(storage,env.COOKIE_KEY);
  async function handle(op,payload){
    if(op==='owner-workflows'){
      if(config.baseId!=='appnaG94HQpEaRios')throw Error('WRONG_LEDGER');
      const data={};for(const [name,columns] of Object.entries(reportFields))data[name]=await ledger.list(name,columns);
      let notices=null,calendar=null;
      const encrypted=await storage.get('refresh');
      if(encrypted){
       try{
        const {access_token:access}=await token({grant_type:'refresh_token',refresh_token:open(encrypted,env.COOKIE_KEY)});
        const labels=await readLabels(access),label=labels[depositLabel];if(!label)throw Error('PAYMENT_LABELS_MISSING');
        let page,ids=[];do{const q=[['labelIds',label],['q','from:notify@payments.interac.ca'],['maxResults','500']];if(page)q.push(['pageToken',page]);const batch=await gmail(access,'messages',q);ids.push(...(batch.messages||[]).map(m=>m.id));page=batch.nextPageToken;}while(page);notices=ids;
        if(await storage.get('calendar:enabled')){
          const events=[];let cursor;do{const url=new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');url.search=new URLSearchParams({timeMin:new Date(clock()-86400000).toISOString(),timeMax:new Date(clock()+8*86400000).toISOString(),singleEvents:'true',maxResults:'250',fields:'nextPageToken,items(id,recurringEventId,iCalUID,status,start,end,location,summary)',...(cursor?{pageToken:cursor}:{})});
          const res=await fetchFn(url,{headers:{Authorization:'Bearer '+access},signal:AbortSignal.timeout(12000)});if(!res.ok)throw Error('CALENDAR_UNAVAILABLE');const batch=await res.json();events.push(...(batch.items||[]));cursor=batch.nextPageToken;}while(cursor);calendar=events;
        }
       }catch{/* Surface unavailable reads in the report. */}
      }
      const drafts=await storage.list({prefix:'confirmation:booking:'});
      return ownerWorkflows(data,{now:clock(),notices,desk:payload.desk,calendar,draftStates:[...drafts.values()],draftError:await storage.get('confirmation:error')});
    }
    if(op==='family-followups'||op==='preview-family-followups'){
      const encrypted=await storage.get('refresh');
      if(!encrypted)return {enabled:followupEnabled,state:'unavailable'};
      if(op==='preview-family-followups'){
        const grant=await token({grant_type:'refresh_token',refresh_token:open(encrypted,env.COOKIE_KEY)});
        const report=await checkFollowups(grant.access_token,true);
        return {enabled:followupEnabled,...report};
      }
      if(!followupEnabled)return {enabled:false,state:'off'};
      const report=await storage.get('rf:report');
      if(await storage.get('rf:start'))return {enabled:true,state:'checking'};
      if(!report||(report.state==='ready'&&report.lastScheduledAt==null))return {enabled:true,state:'checking'};
      if(report.state!=='ready'||clock()-report.checkedAt>3900000)return {enabled:true,state:'unavailable'};
      return {enabled:true,...report};
    }
    if(op==='attention'){
      if(!payload.history&&payload.completionToken!==undefined)return completions.set(payload.kind,payload.completionToken,payload.completed,payload.receipt);
      // Cap archived metadata reads per request and advance by the underlying storage cursor.
      const history=payload.history?await completions.history(payload.kind,payload.cursor,12):null;
      if(history&&!history.items.length)return history;
      const key=payload.kind+'|'+(payload.cursor||'');
      for(const [id,entry] of attentionCache)if(entry.until<=clock())attentionCache.delete(id);
      if(!history&&attentionCache.has(key))return completions.include(payload.kind,attentionCache.get(key).value);
      const encrypted=await storage.get('refresh');
      if(!encrypted)throw Error('GOOGLE_RECONNECT');
      const {access_token:access}=await token({grant_type:'refresh_token',refresh_token:open(encrypted,env.COOKIE_KEY)});
      const labels=await readLabels(access);
      const read=(path,params)=>gmail(access,path,params);
      if(history)return filterReportItems(history,payload.kind,{read,labels});
      const value=await attentionPage({ledger,read,labels,mailbox:await storage.get('ownerAddress')||STAR_SOCCER_OWNER,now:clock()},payload.kind,payload.cursor);
      if(attentionCache.size<128)attentionCache.set(key,{until:clock()+30000,value});
      return completions.include(payload.kind,value);
    }
    if(op==='status'){
      const report=await storage.get('report')||{};
      const scan=await storage.get('scan'),pending=await storage.list({prefix:'q:',limit:1});
      const filing=await storage.get('filing:progress');
      return {connected:!!await storage.get('refresh'),labelFiling:!!await storage.get('filing:enabled'),labelCheckedAt:filing?.checkedAt?new Date(filing.checkedAt).toISOString():null,labelError:filing?.error||null,...report,historyCheckedAt:scan?.lastScan?new Date(scan.lastScan).toISOString():null,caughtUp:!!scan?.lastScan&&scan.phase==='history'&&!scan.page&&!pending.size&&!report.pendingRetries&&!report.error};
    }
    if(op==='stop-labels'){await storage.put('filing:enabled',false);return {labelFiling:false};}
    if(op==='start'){
      const state='ledger.'+random(),browser=random(),verifier=random();
      const ownerAddress=payload.ownerAddress?.toLowerCase()||STAR_SOCCER_OWNER;
      const requested=payload.calendar===true?labelScope+' '+calendarScope:payload.labelFiling===true?labelScope:scope;
      await storage.put('consent',{state:hash(state),browser:hash(browser),verifier,ownerAddress,requested,expires:clock()+600000});
      const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:requested,state,code_challenge:hash(verifier),code_challenge_method:'S256',access_type:'offline',prompt:'consent',login_hint:ownerAddress}).toString();
      return {url:url.href,browser};
    }
    if(op==='finish'){
      const pending=await storage.get('consent');
      if(!pending||pending.expires<clock()||!payload.code||pending.state!==hash(payload.state||'')||pending.browser!==hash(payload.browser||''))throw Error('CONSENT_EXPIRED');
      await storage.delete('consent');
      const grant=await token({grant_type:'authorization_code',code:payload.code,code_verifier:pending.verifier,redirect_uri:redirect});
      if(!grant.refresh_token||!(pending.requested||scope).split(' ').every(s=>grant.scope?.split(' ').includes(s)))throw Error('GOOGLE_RECONNECT');
      const initial=await bootstrap(grant.access_token,await storage.get('scan'),pending.ownerAddress,true);
      await ensureLabels(grant.access_token);
      await storage.transaction(async tx=>{
        await tx.put('refresh',seal(grant.refresh_token,env.COOKIE_KEY));
        await tx.put('ownerAddress',pending.ownerAddress);
        await tx.put('filing:enabled',(pending.requested||scope).split(' ').includes(labelScope));
        await tx.put('calendar:enabled',(pending.requested||scope).split(' ').includes(calendarScope));
        if(!await tx.get('scan'))await tx.put('scan',initial);
        await tx.put('report',{error:null});
        await tx.setAlarm(clock()+1000);
      });
      attentionCache.clear();return {connected:true};
    }
    if(op==='disconnect'){
      attentionCache.clear();
      await storage.delete(['refresh','consent','filing:enabled']);await storage.deleteAlarm();
      await storage.delete('report');return {connected:false};
    }
    throw Error('INVALID_ACTION');
  }
  return {cycle,handle};
}
