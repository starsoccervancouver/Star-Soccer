// Tactics are bounded structured data, never SVG, HTML, external URLs or player records.
const invalid=()=>{throw Object.assign(new Error('INVALID_DIAGRAM'),{code:'INVALID_DIAGRAM',status:400});};
const object=(value,keys,optional=[])=>{
 if(!value||typeof value!=='object'||Array.isArray(value)||keys.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!keys.includes(key)&&!optional.includes(key)))invalid();
 return value;
};
const identifier=value=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,40}$/.test(value))invalid();return value;};
const text=(value,max)=>{if(typeof value!=='string'||value.length>max||/[\x00-\x1f\x7f]/.test(value))invalid();return value.trim();};
const coordinate=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)invalid();return value;};
const notes=value=>{if(typeof value!=='string'||value.length>1000||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))invalid();return value;};
const curve=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value< -50||value>50)invalid();return value;};
const playerColors=['blue','gold','red','green','purple','white'];

export function validateDiagram(content){
 object(content,['schemaVersion','pitch','items','frames'],['purpose']);
 if(Object.hasOwn(content,'purpose')&&!['drill','team-pattern'].includes(content.purpose))invalid();
 if(content.schemaVersion!==1||!['full','half','blank','facing-goal','away-from-goal'].includes(content.pitch)||!Array.isArray(content.items)||content.items.length>40||!Array.isArray(content.frames)||!content.frames.length||content.frames.length>12)invalid();
 const itemIds=new Set(),frameIds=new Set();
 const items=content.items.map(item=>{
  object(item,['id','kind','label'],['zone','color']);const id=identifier(item.id);
  if(itemIds.has(id)||!['home','away','cone','ball','goal','zone'].includes(item.kind))invalid();
  itemIds.add(id);const result={id,kind:item.kind,label:text(item.label,12)};
  if(Object.hasOwn(item,'color')){
   if(!['home','away'].includes(item.kind)||!playerColors.includes(item.color))invalid();
   result.color=item.color;
  }
  if(item.kind==='zone'){
   const zone=object(item.zone,['shape','width','height','color']);
   if(!['rect','ellipse'].includes(zone.shape)||!['blue','gold','green'].includes(zone.color)||typeof zone.width!=='number'||!Number.isFinite(zone.width)||zone.width<5||zone.width>90||typeof zone.height!=='number'||!Number.isFinite(zone.height)||zone.height<5||zone.height>90)invalid();
   result.zone={shape:zone.shape,width:zone.width,height:zone.height,color:zone.color};
  }else if(Object.hasOwn(item,'zone'))invalid();
  return result;
 });
 const itemKinds=new Map(items.map(item=>[item.id,item.kind]));
 const frames=content.frames.map(frame=>{
  object(frame,['id','title','duration','positions'],['notes','arrows']);const id=identifier(frame.id);
  if(frameIds.has(id)||typeof frame.duration!=='number'||!Number.isFinite(frame.duration)||frame.duration<0.5||frame.duration>20||!Array.isArray(frame.positions)||frame.positions.length!==items.length)invalid();
  frameIds.add(id);const seen=new Set();
  const positions=frame.positions.map(position=>{
   object(position,['id','x','y'],['curve','attachedTo','trail','rotation','facing','shadow']);const id=identifier(position.id);
   if(!itemIds.has(id)||seen.has(id))invalid();seen.add(id);
   const result={id,x:coordinate(position.x),y:coordinate(position.y)};
   if(Object.hasOwn(position,'shadow')){
    if(!['home','away'].includes(itemKinds.get(id)))invalid();
    const shadow=object(position.shadow,['length','width']);
    for(const value of [shadow.length,shadow.width])if(typeof value!=='number'||!Number.isFinite(value)||value<5||value>60)invalid();
    result.shadow={length:shadow.length,width:shadow.width};
   }
   if(Object.hasOwn(position,'facing')){
    if(!['home','away'].includes(itemKinds.get(id))||typeof position.facing!=='number'||!Number.isFinite(position.facing)||position.facing<0||position.facing>=360)invalid();
    result.facing=position.facing;
   }
   if(Object.hasOwn(position,'rotation')){
    if(itemKinds.get(id)!=='goal'||typeof position.rotation!=='number'||!Number.isFinite(position.rotation)||position.rotation<0||position.rotation>=360)invalid();
    result.rotation=position.rotation;
   }
   if(Object.hasOwn(position,'curve'))result.curve=curve(position.curve);
   if(Object.hasOwn(position,'trail')){
    if(!['home','away','ball'].includes(itemKinds.get(id))||!Array.isArray(position.trail)||!position.trail.length||position.trail.length>32)invalid();
    result.trail=position.trail.map(point=>{object(point,['x','y']);return {x:coordinate(point.x),y:coordinate(point.y)};});
   }
   if(Object.hasOwn(position,'attachedTo')){
    const attachedTo=identifier(position.attachedTo);
    if(itemKinds.get(id)!=='ball'||!['home','away'].includes(itemKinds.get(attachedTo)))invalid();
    result.attachedTo=attachedTo;
   }
   return result;
  });
  const result={id,title:text(frame.title,80),duration:frame.duration,positions};
  if(Object.hasOwn(frame,'notes'))result.notes=notes(frame.notes);
  if(Object.hasOwn(frame,'arrows')){
   if(!Array.isArray(frame.arrows)||frame.arrows.length>24)invalid();
   const arrowIds=new Set();
   result.arrows=frame.arrows.map(arrow=>{
    object(arrow,['id','x1','y1','x2','y2','color'],['points']);const id=identifier(arrow.id);
    if(arrowIds.has(id)||![...playerColors,'charcoal'].includes(arrow.color))invalid();
    arrowIds.add(id);
    const result={id,x1:coordinate(arrow.x1),y1:coordinate(arrow.y1),x2:coordinate(arrow.x2),y2:coordinate(arrow.y2),color:arrow.color};
    if(Object.hasOwn(arrow,'points')){
     if(!Array.isArray(arrow.points)||!arrow.points.length||arrow.points.length>32)invalid();
     result.points=arrow.points.map(point=>{object(point,['x','y']);return {x:coordinate(point.x),y:coordinate(point.y)};});
    }
    return result;
   });
  }
  return result;
 });
 const result={schemaVersion:1,pitch:content.pitch,items,frames};
 if(Object.hasOwn(content,'purpose'))result.purpose=content.purpose;
 if(new TextEncoder().encode(JSON.stringify(result)).length>56000)invalid();
 return result;
}
