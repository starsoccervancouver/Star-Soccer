const test=require('node:test');
const assert=require('node:assert/strict');
const validator=import('../private-attendance/tactics-validation.mjs');
const diagram=()=>({schemaVersion:1,pitch:'full',items:[
 {id:'home',kind:'home',label:'1'},
 {id:'away',kind:'away',label:'2'},
 {id:'ball',kind:'ball',label:''},
 {id:'cone',kind:'cone',label:''}
],frames:[{id:'phase',title:'First phase',duration:2,positions:[
 {id:'home',x:20,y:30},{id:'away',x:60,y:70},{id:'ball',x:25,y:30},{id:'cone',x:50,y:50}
]}]});
const reject=async mutate=>{
 const {validateDiagram}=await validator,content=diagram();mutate(content);
 assert.throws(()=>validateDiagram(content),{code:'INVALID_DIAGRAM',status:400});
};

test('legacy diagrams retain exact output shape and label/title trimming',async()=>{
 const {validateDiagram}=await validator,content=diagram(),expected=diagram();
 content.items[0].label=' 1 ';content.frames[0].title=' First phase ';
 assert.deepStrictEqual(validateDiagram(content),expected);
});

test('motion fields and phase notes round trip, including whitespace and boundary values',async()=>{
 const {validateDiagram}=await validator,content=diagram(),frame=content.frames[0];
 frame.notes='  First line\r\n\tSecond line\n  ';
 frame.positions[0].curve=-50;frame.positions[1].curve=50;
 frame.positions[2].curve=0;frame.positions[2].attachedTo='home';
 assert.deepStrictEqual(validateDiagram(content),content);
 frame.positions[2].attachedTo='away';frame.notes='';
 assert.deepStrictEqual(validateDiagram(content),content);
 delete frame.positions[2].attachedTo;frame.notes='x'.repeat(1000);
 assert.deepStrictEqual(validateDiagram(content),content);
});

test('rejects invalid attachment references, types, and non-ball owners',async()=>{
 for(const value of ['missing','ball','cone','bad id','',null,undefined,1,{},[]]){
  await reject(content=>{content.frames[0].positions[2].attachedTo=value;});
 }
 for(const index of [0,1,3])await reject(content=>{content.frames[0].positions[index].attachedTo='home';});
});

test('rejects invalid curve types and values',async()=>{
 for(const value of [-50.01,50.01,NaN,Infinity,-Infinity,null,undefined,'1',false,{},[]]){
  await reject(content=>{content.frames[0].positions[0].curve=value;});
 }
});

test('rejects oversized or invalid notes while retaining allowed whitespace',async()=>{
 for(const value of ['x'.repeat(1001),null,undefined,1,false,{},[]])await reject(content=>{content.frames[0].notes=value;});
 for(let code=0;code<=31;code++){
  if([9,10,13].includes(code))continue;
  await reject(content=>{content.frames[0].notes=`before${String.fromCharCode(code)}after`;});
 }
 await reject(content=>{content.frames[0].notes='\x7f';});
});

test('rejects unknown keys and missing required fields at every level',async()=>{
 const levels=[content=>content,content=>content.items[0],content=>content.frames[0],content=>content.frames[0].positions[0]];
 for(const level of levels){
  await reject(content=>{level(content).unexpected=true;});
  for(const key of Object.keys(level(diagram())))await reject(content=>{delete level(content)[key];});
 }
});

test('retains total encoded size limit with optional notes',async()=>{
 await reject(content=>{
  content.items=Array.from({length:40},(_,i)=>({id:`player_${i}_${'x'.repeat(25)}`,kind:'home',label:'Player'}));
  content.frames=Array.from({length:12},(_,i)=>({id:`phase_${i}`,title:'Phase',duration:2,notes:'界'.repeat(1000),positions:content.items.map(item=>({id:item.id,x:50,y:50,curve:50}))}));
 });
});

test('drag trajectories and sized zones round trip without changing legacy fields',async()=>{
 const {validateDiagram}=await validator,content=diagram();
 content.items.push({id:'zone',kind:'zone',label:'Press',zone:{shape:'ellipse',width:35,height:25,color:'gold'}});
 content.frames[0].positions.push({id:'zone',x:50,y:50});
 content.frames[0].positions[0].trail=[{x:30,y:10},{x:40,y:15},{x:55,y:40}];
 assert.deepStrictEqual(validateDiagram(content),content);
});

test('rejects unbounded, malformed or equipment trajectories',async()=>{
 for(const value of [null,{},[],Array.from({length:33},()=>({x:10,y:20})),[{x:-1,y:20}],[{x:20,y:101}],[{x:'10',y:20}],[{x:NaN,y:20}],[{x:10,y:20,html:'bad'}]])await reject(c=>{c.frames[0].positions[0].trail=value;});
 await reject(c=>{c.frames[0].positions[3].trail=[{x:10,y:20}];});
});

test('zones require bounded dimensions and supported shape and colour',async()=>{
 const zone={shape:'rect',width:25,height:25,color:'blue'};
 await reject(c=>{c.items[0].zone=zone;});
 for(const value of [undefined,null,{...zone,width:0},{...zone,width:91},{...zone,height:'20'},{...zone,height:Infinity},{...zone,shape:'script'},{...zone,color:'#fff'},{...zone,extra:true}])await reject(c=>{c.items[3]={id:'cone',kind:'zone',label:'Zone',zone:value};});
});
