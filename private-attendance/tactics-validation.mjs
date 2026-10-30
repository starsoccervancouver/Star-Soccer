// Tactics are bounded structured data, never SVG, HTML, external URLs or player records.
const invalid=()=>{throw Object.assign(new Error('INVALID_DIAGRAM'),{code:'INVALID_DIAGRAM',status:400});};
const object=(value,keys)=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key)))invalid();
 return value;
};
const identifier=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(value))invalid();return value;};
const text=(value,max)=>{if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value))invalid();return value.trim();};
const coordinate=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)invalid();return value;};

export function validateDiagram(content){
 object(content,['schemaVersion','pitch','items','frames']);
 if(content.schemaVersion!==1||!['full','half','blank'].includes(content.pitch)||!Array.isArray(content.items)||content.items.length>40||!Array.isArray(content.frames)||!content.frames.length||content.frames.length>12)invalid();
 const itemIds=new Set(),frameIds=new Set();
 const items=content.items.map(item=>{
  object(item,['id','kind','label']);const id=identifier(item.id);
  if(itemIds.has(id)||!['home','away','cone','ball','goal'].includes(item.kind))invalid();
  itemIds.add(id);return {id,kind:item.kind,label:text(item.label,12)};
 });
 const frames=content.frames.map(frame=>{
  object(frame,['id','title','duration','positions']);const id=identifier(frame.id);
  if(frameIds.has(id)||typeof frame.duration!=='number'||!Number.isFinite(frame.duration)||frame.duration<0.5||frame.duration>20||!Array.isArray(frame.positions)||frame.positions.length!==items.length)invalid();
  frameIds.add(id);const seen=new Set();
  const positions=frame.positions.map(position=>{
   object(position,['id','x','y']);const id=identifier(position.id);
   if(!itemIds.has(id)||seen.has(id))invalid();seen.add(id);
   return {id,x:coordinate(position.x),y:coordinate(position.y)};
  });
  return {id,title:text(frame.title,80),duration:frame.duration,positions};
 });
 const result={schemaVersion:1,pitch:content.pitch,items,frames};
 if(new TextEncoder().encode(JSON.stringify(result)).length>56000)invalid();
 return result;
}
