// Execute the current presenter against a small clock/tween adapter. Not visual acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile}from'node:fs/promises';
import {stripTypeScriptTypes}from'node:module';
const source=await readFile(new URL('../../cocos-client/assets/scripts/game/BattleSceneView.ts',import.meta.url),'utf8');
const observerSource=await readFile(new URL('./observe.js',import.meta.url),'utf8');
class UIOpacity{opacity=255}
class FakeNode{
 constructor(parent){this.parent=parent;this.isValid=true;this.components=new Map();this.children=[];if(parent)parent.children.push(this)}
 addChild(n){n.parent=this;this.children.push(n)}
 getComponent(T){return this.components.get(T)}
 addComponent(T){const c=new T();this.components.set(T,c);return c}
 destroy(){this.isValid=false;for(const c of this.children)c.destroy()}
 get visibleAlpha(){return(this.getComponent(UIOpacity)?.opacity??255)/255*(this.parent?.visibleAlpha??1)}
}
const tweens=[];
function tween(target){let seconds=0,values;return{to(n,v){seconds=n;values=v;return this},start(){tweens.push({target,seconds,values})}}}
const Label={Overflow:{CLAMP:1}};
const transpiled=stripTypeScriptTypes(source.replace(/^import .*;\s*$/gm,''),{mode:'transform'}).replace('export class BattleSceneView','class BattleSceneView')+'\nreturn {BattleSceneView,unitNameLane};';
const exports=new Function('instantiate','tween','UIOpacity','Label','ArtSkin','Theme','Color',transpiled)(()=>new FakeNode(),tween,UIOpacity,Label,{image:()=>undefined,url:()=>undefined},{gold:'gold',text:'white'},class Color{});
const {BattleSceneView,unitNameLane}=exports;
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve()};
function actor(){const node=new FakeNode();const art=new FakeNode(node),name=new FakeNode(node),hpNode=new FakeNode(node);let finish;let destroyed=false;const completion=new Promise(r=>finish=r);return{node,generation:0,dying:false,ready:Promise.resolve(),hp:{node:hpNode,string:'3'},name:{node:name},animation:{node:art,play(){return{hasNativeState:true,completion}},destroy(){destroyed=true}},finish,get destroyed(){return destroyed}}}
function presenter(display){const view=Object.create(BattleSceneView.prototype);Object.assign(view,{disposed:false,speed:1,clocks:[],displays:new Map([['unit:7',display]]),syncDisplays(){}});return view}
async function advance(view,dt){for(const t of [...tweens]){t.seconds-=dt;if(t.seconds<=1e-9){Object.assign(t.target,t.values);tweens.splice(tweens.indexOf(t),1)}}const pending=view.clocks;view.clocks=[];for(const c of pending){c.remaining-=dt;if(c.remaining<=1e-9)c.done();else view.clocks.push(c)}await flush()}
test('actual death presenter finishes pose then fades art and labels together before release',async()=>{
 tweens.length=0;const d=actor(),v=presenter(d),other=actor();v.displays.set('unit:8',other);
 const done=v.perform({kind:'death',actorId:'unit:7'});await flush();assert.equal(d.node.visibleAlpha,1);assert.equal(tweens.length,0,'native death must finish before any fade');
 await advance(v,.8);d.finish();await flush();assert.equal(tweens.length,1);assert.equal(tweens[0].target,d.node.getComponent(UIOpacity),'the whole stable unit owns fade');
 await advance(v,.6);assert.equal(d.animation.node.visibleAlpha,0);assert.equal(d.hp.node.visibleAlpha,0);assert.equal(d.name.node.visibleAlpha,0);assert.equal(d.node.isValid,true,'two second lifetime retained, without isolated text');assert.equal(other.node.visibleAlpha,1);
 await advance(v,.6);await done;assert.equal(v.displays.has('unit:7'),false);assert.equal(d.destroyed,true);assert.equal(d.node.isValid,false);assert.equal(v.displays.get('unit:8'),other);
});
test('actual delayed death completion cannot fade or release a replacement with the same unitId',async()=>{
 tweens.length=0;const old=actor(),v=presenter(old),done=v.perform({kind:'death',actorId:'unit:7'});await flush();const fresh=actor();v.displays.set('unit:7',fresh);old.finish();await flush();assert.equal(tweens.length,0);await advance(v,2);await done;assert.equal(v.displays.get('unit:7'),fresh);assert.equal(fresh.node.visibleAlpha,1);assert.equal(fresh.destroyed,false);
});
test('adjacent lower-row names use a safe reveal lane while non-colliding names stay visible',()=>{
 const upper={x:0,y:100,z:0};
 assert.deepEqual(unitNameLane({x:495,y:207.5,z:0},65.5,[]),{suppressed:true,offsetY:38},'upper-right unit name must not sit below battle toolbar');
 assert.deepEqual(unitNameLane({x:0,y:5,z:0},68,[upper]),{suppressed:true,offsetY:38},
  'mounted lower-row name must not cover upper-row attack/health');
 assert.deepEqual(unitNameLane({x:180,y:5,z:0},68,[upper]),{suppressed:false,offsetY:68},
  'a separate column keeps its source-derived head label');
 assert.deepEqual(unitNameLane({x:0,y:5,z:0},38,[upper]),{suppressed:false,offsetY:38},
  'the hover/touch reveal lane is outside the adjacent stats bounds');
});
test('annotation input stays within one board cell and observer keeps ambiguous zero-hp blanks separate',()=>{
 assert.match(source,/ui\.node\(node, 'NameHitRegion', 84, 90, 0, 10\)/);
 const annotationBlock=source.slice(source.indexOf("const nameHit ="),source.indexOf('void ready.then'));
 assert.doesNotMatch(annotationBlock,/(?:^|\s)node\.on\(Node\.EventType\.(?:MOUSE_ENTER|MOUSE_LEAVE|TOUCH_END)/,
  'the overlapping 170x170 visual root must not own annotation input');
 assert.equal((annotationBlock.match(/nameHit\.on\(Node\.EventType\.(?:MOUSE_ENTER|MOUSE_LEAVE|TOUCH_END)/g)??[]).length,3);
 const classifierSource=observerSource.slice(0,observerSource.indexOf('\nif('));
 const classify=new Function(`${classifierSource};return classifyAnimationBlank;`)();
 assert.equal(classify(false,0,'5'),'expectedOpacityZero');
 assert.equal(classify(false,1,'0'),'zeroHpSourceEmpty');
 assert.equal(classify(false,1,'5'),'unexpectedEmpty');
 assert.equal(classify(false,1,'5',false),'initialUnrendered');
 assert.equal(classify(true,0,'0'),'rendered');
});
test('actual HUD render places bounded fixed-font global information above upper unit names',()=>{
 const labels=[];const v=Object.create(BattleSceneView.prototype);const state={revision:1,turn:123,players:[{id:'me',name:'这是一个需要明确截断的超长角色名称ABC',ai:false,hand:[],drawPile:[],graveyard:[]}],activePlayer:0,terrains:[],events:[]};
 Object.assign(v,{presentation:{visibleState:state,locked:false,settledReady:false},disposed:false,processing:false,me:'me',parent:new FakeNode(),original:{catalog:{skins:{}}},latest:{settled:false,legalPlays:[]},selectedHandPositions:new Map(),skinButton(){},ui:{node:()=>new FakeNode(),panel(){},label(parent,name,text,x,y,w,h,size){const l={name,string:text,x,y,w,h,fontSize:size};labels.push(l);return l}}});
 v.renderHud();const globals=labels.filter(x=>['Round','TurnName'].includes(x.name));assert.equal(globals.length,2);for(const l of globals){assert.ok(300-l.y-l.h/2>=0);assert.ok(300-l.y+l.h/2<=16);assert.equal(l.fontSize,12);assert.equal(l.enableWrapText,false);assert.equal(l.overflow,Label.Overflow.CLAMP)}assert.ok(globals[1].string.includes('…'));assert.ok(globals[1].string.length<=13);assert.ok(!globals.some(x=>x.string.includes('战斗进行中')));
});
