/* Pure validation fixtures; no database or network. */
const test=require('node:test'),assert=require('node:assert/strict');
const validator=import('../private-attendance/tactics-validation.mjs');
const diagram=()=>({schemaVersion:1,pitch:'full',items:[
 {id:'home',kind:'home',label:'1'},{id:'away',kind:'away',label:'2'},
 {id:'ball',kind:'ball',label:''},{id:'cone',kind:'cone',label:''},{id:'goal',kind:'goal',label:''},
 {id:'zone',kind:'zone',label:'',zone:{shape:'rect',width:25,height:25,color:'blue'}}
],frames:[{id:'phase',title:'Fictional first phase',duration:2,positions:[
 {id:'home',x:20,y:30},{id:'away',x:60,y:70},{id:'ball',x:25,y:30},
 {id:'cone',x:50,y:50},{id:'goal',x:90,y:50},{id:'zone',x:50,y:50}
]}]});
const reject=async mutate=>{const {validateDiagram}=await validator,content=diagram();mutate(content);assert.throws(()=>validateDiagram(content),{code:'INVALID_DIAGRAM',status:400});};

test('legacy schema 1 diagrams retain exact output without adding optional defaults',async()=>{
 const {validateDiagram}=await validator,content=diagram();
 assert.deepStrictEqual(validateDiagram(content),content);
 assert.equal(JSON.stringify(validateDiagram(content)),JSON.stringify(content));
});
test('purpose and player facing round trip exactly, independently for each phase',async()=>{
 const {validateDiagram}=await validator;
 for(const purpose of ['drill','team-pattern'])for(const facing of [0,-0,0.001,90,180,359.999]){
  const content=diagram();content.purpose=purpose;
  content.frames[0].positions[0].facing=facing;content.frames[0].positions[1].facing=45;
  content.frames[0].positions[0].curve=25;content.frames[0].positions[0].trail=[{x:25,y:35}];
  content.frames[0].positions[2].attachedTo='home';content.frames[0].positions[4].rotation=90;
  content.frames.push({...diagram().frames[0],id:'next'});
  assert.deepStrictEqual(validateDiagram(content),content);
 }
});
test('purpose rejects invalid enum values and types',async()=>{
 for(const purpose of ['','team','team-pattern ','DRILL',null,undefined,true,1,{},[]])await reject(content=>{content.purpose=purpose;});
});

test('optional goal size round trips while legacy goals keep their original data',async()=>{
 const {validateDiagram}=await validator;
 for(const scale of [.5,1,1.75,4]){
  const content=diagram();content.items[4].scale=scale;content.frames[0].positions[4].rotation=270;
  assert.deepStrictEqual(validateDiagram(content),content);
 }
 for(const scale of [.499,4.001,NaN,Infinity,-Infinity,null,undefined,'1',true,{},[]])await reject(content=>{content.items[4].scale=scale;});
 for(const index of [0,1,2,3,5])await reject(content=>{content.items[index].scale=1;});
 await reject(content=>{content.frames[0].positions[4].scale=1;});
});
test('facing rejects invalid types, bounds, and every non-player kind',async()=>{
 for(const facing of [-0.001,360,361,NaN,Infinity,-Infinity,null,undefined,'90',true,{},[]])await reject(content=>{content.frames[0].positions[0].facing=facing;});
 for(const index of [2,3,4,5])await reject(content=>{content.frames[0].positions[index].facing=90;});
});
test('player tools do not admit unsafe extra fields or misplaced properties',async()=>{
 await reject(content=>{content.html='<script>unsafe</script>';});
 await reject(content=>{content.items[0].facing=90;});
 await reject(content=>{content.frames[0].purpose='drill';});
 await reject(content=>{content.frames[0].positions[0].svg='<svg onload="unsafe()"/>';});
 await reject(content=>{content.frames[0].positions[0].purpose='team-pattern';});
});

test('player cover shadows round trip boundaries and fractions with purpose and facing',async()=>{
 const {validateDiagram}=await validator;
 for(const length of [5,17.25,60])for(const width of [5,23.75,60]){
  const content=diagram();content.purpose='team-pattern';
  for(const index of [0,1])Object.assign(content.frames[0].positions[index],{facing:90,shadow:{length,width}});
  assert.deepStrictEqual(validateDiagram(content),content);
 }
});
test('cover shadows reject malformed dimensions, unsupported owners, and extra fields',async()=>{
 for(const shadow of [true,false,null,undefined,5,'shadow',[],{},{length:5},{width:5},{length:5,width:5,html:'unsafe'}])await reject(content=>{content.frames[0].positions[0].shadow=shadow;});
 for(const key of ['length','width'])for(const value of [4.999,60.001,NaN,Infinity,-Infinity,null,undefined,true,'10',{},[]])await reject(content=>{content.frames[0].positions[0].shadow={length:5,width:60,[key]:value};});
 for(const index of [2,3,4,5])await reject(content=>{content.frames[0].positions[index].shadow={length:5,width:60};});
 await reject(content=>{content.items[0].shadow={length:5,width:60};});
});


test('vision and additional shapes round trip with bounded settings',async()=>{
 const {validateDiagram}=await validator;
 for(const shape of ['triangle','diamond'])for(const angle of [20,90,180]){
  const content=diagram();content.items[5].zone.shape=shape;
  content.frames[0].positions[0].vision={angle,length:60};
  assert.deepEqual(validateDiagram(content),content);
 }
 for(const angle of [0,181,NaN,'90',null])await reject(c=>{c.frames[0].positions[0].vision={angle,length:20};});
 for(const length of [0,61,Infinity,'20',null])await reject(c=>{c.frames[0].positions[0].vision={angle:90,length};});
 for(const index of [2,3,4,5])await reject(c=>{c.frames[0].positions[index].vision={angle:90,length:20};});
});
