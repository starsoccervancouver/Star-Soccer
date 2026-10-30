/* Personal coaching bookmarks. Uses the existing authenticated Coach Desk store. */
import {randomBytes} from 'node:crypto';
const keys=['title','url','kind','topic','notes','favourite'];
const snapshot=value=>JSON.stringify(keys.map(key=>value[key]));
export function createCoachResources({store,coaches,deny,audit,clock}){
 store.run(`CREATE TABLE IF NOT EXISTS coach_resources(id TEXT PRIMARY KEY,author_email TEXT NOT NULL REFERENCES coach_users(email),request_id TEXT NOT NULL,title TEXT NOT NULL,url TEXT NOT NULL,kind TEXT NOT NULL,topic TEXT NOT NULL,notes TEXT NOT NULL,favourite INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,updated_by TEXT NOT NULL REFERENCES coach_users(email),version INTEGER NOT NULL,archived INTEGER NOT NULL DEFAULT 0,UNIQUE(author_email,request_id));
 CREATE INDEX IF NOT EXISTS coach_resources_author ON coach_resources(author_email,archived,updated_at);`);
 const stamp=()=>clock().toISOString(),row=value=>{if(!value)return null;const {archived,...rest}=value;return {...rest,favourite:!!value.favourite};};
 const text=(value,max,required=false)=>{if(typeof value!=='string'||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)||required&&!value.trim())deny('INVALID_RESOURCE',400);return value.trim();};
 function fields(input){
  const title=text(input.title,120,true),raw=text(input.url,2048,true),topic=text(input.topic??'',80),notes=text(input.notes??'',2000);
  let url;try{url=new URL(raw);}catch{deny('INVALID_RESOURCE_URL',400);}
  if(url.protocol!=='https:'||!url.hostname||url.username||url.password)deny('INVALID_RESOURCE_URL',400);
  if(!['video','article','document','podcast','tool','other'].includes(input.kind)||typeof input.favourite!=='boolean')deny('INVALID_RESOURCE',400);
  return {title,url:url.href,kind:input.kind,topic,notes,favourite:input.favourite};
 }
 const validId=id=>{if(typeof id!=='string'||!/^resource_[A-Za-z0-9_-]{27}$/.test(id))deny('INVALID_RESOURCE',400);};
 const freshActor=actor=>{const fresh=coaches.actor(actor.email);return {fresh,full:['owner','admin'].includes(fresh.role)};};
 return {
  resources(actor){const {fresh,full}=freshActor(actor);return store.all('SELECT * FROM coach_resources WHERE archived=0'+(full?'':' AND author_email=?')+' ORDER BY updated_at DESC,id',...(full?[]:[fresh.email])).map(row);},
  saveResource(actor,{id=null,requestId,expectedVersion=0,...input}){
   const {fresh,full}=freshActor(actor),value=fields(input);
   if(!Number.isSafeInteger(expectedVersion)||expectedVersion<0)deny('INVALID_RESOURCE',400);
   if(id!==null){validId(id);if(requestId!==undefined)deny('INVALID_RESOURCE',400);}
   else if(expectedVersion!==0||typeof requestId!=='string'||!/^[A-Za-z0-9_-]{16,100}$/.test(requestId))deny('INVALID_RESOURCE',400);
   return store.transaction(()=>{
    const old=id?store.get('SELECT * FROM coach_resources WHERE id=?',id):store.get('SELECT * FROM coach_resources WHERE author_email=? AND request_id=?',fresh.email,requestId);
    if(id&&(!old||!full&&old.author_email!==fresh.email))deny();
    if(old?.archived)deny('RESOURCE_ARCHIVED',409);
    if(old&&old.version===expectedVersion+1&&snapshot(row(old))===snapshot(value)&&(!id||old.updated_by===fresh.email))return row(old);
    if(!id&&old)deny('RESOURCE_REQUEST_REUSED',409);
    if((old?.version||0)!==expectedVersion)deny('RESOURCE_CHANGED',409);
    const author=old?.author_email||fresh.email;
    const duplicate=store.get('SELECT id FROM coach_resources WHERE author_email=? AND url=? AND archived=0 AND id<>?',author,value.url,id||'');
    if(duplicate)deny('RESOURCE_URL_EXISTS',409);
    if(!old&&store.get('SELECT COUNT(*) AS count FROM coach_resources WHERE author_email=? AND archived=0',author).count>=300)deny('RESOURCE_LIMIT',409);
    const at=stamp();
    if(old)store.run('UPDATE coach_resources SET title=?,url=?,kind=?,topic=?,notes=?,favourite=?,updated_at=?,updated_by=?,version=version+1 WHERE id=?',value.title,value.url,value.kind,value.topic,value.notes,value.favourite?1:0,at,fresh.email,id);
    else{id='resource_'+randomBytes(20).toString('base64url');store.run('INSERT INTO coach_resources(id,author_email,request_id,title,url,kind,topic,notes,favourite,created_at,updated_at,updated_by,version,archived) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,1,0)',id,fresh.email,requestId,value.title,value.url,value.kind,value.topic,value.notes,value.favourite?1:0,at,at,fresh.email);}
    audit(fresh,old?'resource-updated':'resource-created',id,{author,version:(old?.version||0)+1});
    return row(store.get('SELECT * FROM coach_resources WHERE id=?',id));
   });
  },
  archiveResource(actor,{id,expectedVersion}){
   const {fresh,full}=freshActor(actor);validId(id);if(!Number.isSafeInteger(expectedVersion)||expectedVersion<1)deny('INVALID_RESOURCE',400);
   return store.transaction(()=>{
    const old=store.get('SELECT * FROM coach_resources WHERE id=?',id);if(!old||!full&&old.author_email!==fresh.email)deny();
    if(old.archived&&old.version===expectedVersion+1&&old.updated_by===fresh.email)return {saved:true};
    if(old.archived||old.version!==expectedVersion)deny('RESOURCE_CHANGED',409);
    store.run('UPDATE coach_resources SET archived=1,updated_by=?,updated_at=?,version=version+1 WHERE id=?',fresh.email,stamp(),id);
    audit(fresh,'resource-archived',id,{author:old.author_email,version:old.version+1});return {saved:true};
   });
  }
 };
}
