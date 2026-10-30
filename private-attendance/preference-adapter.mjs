/* Only existing recurring-enrollment preferences; never registrations or attendance. */
export function createPreferenceAdapter({baseId,tableId,fields,token,fetchFn=fetch,enabled=false}={}){
 const valid=(v,p)=>typeof v==='string'&&new RegExp('^'+p+'[A-Za-z0-9]{14}$').test(v);
 if(!valid(baseId,'app')||!valid(tableId,'tbl')||!fields||['player','family','preference','updatedAt'].some(k=>!valid(fields[k],'fld'))||new Set(Object.values(fields)).size!==4)throw new Error('INVALID_PREFERENCE_MAPPING');
 const links=v=>Array.isArray(v)?v.map(x=>typeof x==='string'?x:x.id):[];
 async function request(id,method='GET',body){const r=await fetchFn('https://api.airtable.com/v0/'+baseId+'/'+tableId+'/'+id+'?returnFieldsByFieldId=true',{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},redirect:'manual',signal:AbortSignal.timeout(10000),...(body?{body:JSON.stringify(body)}:{})});if(!r.ok)throw new Error('PREFERENCE_SYNC_PENDING');return r.json();}
 return {async deliver(event,targets){if(!enabled||!token)return {delivered:false};const ids=[...new Set(targets.filter(t=>t.playerId===event.player_id&&t.familyId===event.family_id).map(t=>t.enrollmentId))];if(!ids.length)throw new Error('PREFERENCE_TARGET_REQUIRES_REVIEW');
  for(const id of ids){if(!valid(id,'rec'))throw new Error('INVALID_PREFERENCE_TARGET');let r=await request(id);const verify=r=>{if(r.id!==id||links(r.fields?.[fields.player]).length!==1||links(r.fields?.[fields.family]).length!==1||links(r.fields[fields.player])[0]!==event.player_id||links(r.fields[fields.family])[0]!==event.family_id)throw new Error('PREFERENCE_IDENTITY_CONFLICT');};verify(r);
   if(r.fields[fields.preference]!=='Opted out'){await request(id,'PATCH',{fields:{[fields.preference]:'Opted out',[fields.updatedAt]:event.occurred_at}});r=await request(id);verify(r);}
   if(r.fields[fields.preference]!=='Opted out')throw new Error('PREFERENCE_READBACK_REQUIRED');
  }return {delivered:true};
 }};
}
