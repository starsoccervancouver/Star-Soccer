const test=require('node:test');
const assert=require('node:assert/strict');
const validator=import('../private-attendance/tactics-validation.mjs');
const colors=['blue','gold','red','green','purple','white'];
const diagram=()=>({schemaVersion:1,pitch:'full',items:[
 {id:'home',kind:'home',label:'1'},
 {id:'away',kind:'away',label:'2'},
 {id:'ball',kind:'ball',label:''}
],frames:[{id:'phase',title:'Start',duration:2,positions:[
 {id:'home',x:20,y:30},{id:'away',x:60,y:70},{id:'ball',x:25,y:30}
]}]});
const arrow=(id='arrow_1')=>({id,x1:0,y1:100,x2:100,y2:0,color:'charcoal'});
const reject=async mutate=>{
 const {validateDiagram}=await validator,content=diagram();mutate(content);
 assert.throws(()=>validateDiagram(content),{code:'INVALID_DIAGRAM',status:400});
};

test('legacy diagrams round trip without adding annotation fields',async()=>{
 const {validateDiagram}=await validator,content=diagram(),output=validateDiagram(content);
 assert.deepStrictEqual(output,content);
 assert.equal(Object.hasOwn(output.items[0],'color'),false);
 assert.equal(Object.hasOwn(output.frames[0],'arrows'),false);
});

test('all six player colours round trip for both teams',async()=>{
 const {validateDiagram}=await validator;
 for(const color of colors){
  const content=diagram();content.items[0].color=color;content.items[1].color=color;
  assert.deepStrictEqual(validateDiagram(content),content);
 }
});

test('arrows round trip with every supported colour and bounded decimal coordinates',async()=>{
 const {validateDiagram}=await validator,content=diagram();
 content.items[0].color='purple';
 content.frames[0].arrows=[...colors,'charcoal'].map((color,index)=>({...arrow(`arrow_${index}`),color}));
 content.frames[0].arrows[0].x1=12.125;
 const output=validateDiagram(content);
 assert.deepStrictEqual(output,content);
 assert.notStrictEqual(output.frames[0].arrows,content.frames[0].arrows);
 assert.notStrictEqual(output.frames[0].arrows[0],content.frames[0].arrows[0]);
 output.frames[0].arrows[0].x1=90;
 assert.equal(content.frames[0].arrows[0].x1,12.125);
});

test('empty arrows and the 24-arrow boundary round trip, with IDs scoped to each frame',async()=>{
 const {validateDiagram}=await validator,content=diagram();content.frames[0].arrows=[];
 assert.deepStrictEqual(validateDiagram(content),content);
 content.frames[0].arrows=Array.from({length:24},(_,index)=>arrow(`arrow_${index}`));
 content.frames.push({...content.frames[0],id:'second'});
 assert.deepStrictEqual(validateDiagram(content),content);
 await reject(value=>{value.frames[0].arrows=Array.from({length:25},(_,index)=>arrow(`arrow_${index}`));});
});

test('rejects invalid player colours and colour on every non-player kind',async()=>{
 for(const color of ['charcoal','Blue','#fff','red ','',null,undefined,0,true,{},[]]){
  for(const index of [0,1])await reject(content=>{content.items[index].color=color;});
 }
 for(const kind of ['ball','cone','goal','zone'])await reject(content=>{
  content.items[2].kind=kind;content.items[2].color='blue';
  if(kind==='zone')content.items[2].zone={shape:'rect',width:20,height:20,color:'blue'};
 });
});

test('rejects invalid arrow containers, entries and colours',async()=>{
 for(const arrows of [null,undefined,{},'arrows',1,false])await reject(content=>{content.frames[0].arrows=arrows;});
 for(const value of [null,undefined,[],{},'arrow',1,false])await reject(content=>{content.frames[0].arrows=[value];});
 for(const color of ['Charcoal','black','#fff','',null,undefined,1,false,{},[]]){
  await reject(content=>{content.frames[0].arrows=[{...arrow(),color}];});
 }
});

test('rejects invalid or duplicate arrow identifiers within a frame',async()=>{
 for(const id of ['', 'bad id','<svg>','a'.repeat(41),null,undefined,1,{},[]]){
  await reject(content=>{content.frames[0].arrows=[{...arrow(),id}];});
 }
 await reject(content=>{content.frames[0].arrows=[arrow(),arrow()];});
});

test('rejects invalid types and out-of-bounds coordinates at either arrow endpoint',async()=>{
 for(const key of ['x1','y1','x2','y2']){
  for(const value of [-0.01,100.01,NaN,Infinity,-Infinity,null,undefined,'50',true,{},[]]){
   await reject(content=>{content.frames[0].arrows=[{...arrow(),[key]:value}];});
  }
 }
});

test('arrows require exactly the supported fields',async()=>{
 for(const key of Object.keys(arrow()))await reject(content=>{
  const value=arrow();delete value[key];content.frames[0].arrows=[value];
 });
 for(const key of ['html','url','label','width'])await reject(content=>{
  content.frames[0].arrows=[{...arrow(),[key]:'unsupported'}];
 });
 await reject(content=>{content.items[0].colour='blue';});
 await reject(content=>{content.frames[0].arrow=arrow();});
});
