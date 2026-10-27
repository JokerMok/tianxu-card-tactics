import assert from 'node:assert/strict';
import{readFileSync}from'node:fs';
import{stripTypeScriptTypes}from'node:module';
import{evaluateRigPose,HUMANOID_BONES}from'../../cocos-client/experiments/rig/SharedRigMotion.ts';
const manifest=JSON.parse(readFileSync('cocos-client/experiments/rig/resources/manifest.json'));
const source=readFileSync('cocos-client/experiments/rig/SharedRigAnimation.ts','utf8');
let code=stripTypeScriptTypes(source,{mode:'transform'}).replace(/^import .*;\n/gm,'').replaceAll('export ','');
const pending=[],metrics={textures:0,frames:0,released:0};
class Node{constructor(name=''){this.name=name;this.children=[];this.position={x:0,y:0};this.worldPosition={x:0,y:0};this.worldScale={x:1,y:1};this.isValid=true;}addChild(n){this.children.push(n);n.parent=this;}setPosition(x,y){this.position={x,y};}setScale(){}addComponent(C){return new C();}destroy(){this.isValid=false;this.children.forEach(n=>n.destroy());}}
class UITransform{setContentSize(){}setAnchorPoint(){}}
class Sprite{static SizeMode={CUSTOM:1};}
class Graphics{ellipse(){}fill(){}}
class Texture2D{constructor(){metrics.textures++;}destroy(){metrics.textures--;}}
class SpriteFrame{constructor(){metrics.frames++;}destroy(){metrics.frames--;}}
class Rect{constructor(...values){this.values=values;}}
class Size extends Rect{}class Color extends Rect{}class ImageAsset{}
const assetManager={loadRemote(url,options,callback){pending.push(callback);},releaseAsset(){metrics.released++;}};
const create=new Function('Node','UITransform','Sprite','Graphics','Color','Texture2D','SpriteFrame','Rect','Size','ImageAsset','assetManager','Layers','evaluateRigPose','location','fetch',code+';return SharedRigAnimation;');
const Rig=create(Node,UITransform,Sprite,Graphics,Color,Texture2D,SpriteFrame,Rect,Size,ImageAsset,assetManager,{Enum:{UI_2D:1}},evaluateRigPose,{origin:'http://localhost',hostname:'localhost',search:''},async()=>({ok:true,json:async()=>manifest}));
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const a=new Rig(new Node(),'guard'),b=new Rig(new Node(),'squire');let pa=a.load(),pb=b.load();await flush();assert.equal(pending.length,1,'two costumes share one pending texture');pending.shift()(null,{width:1024,height:512});await Promise.all([pa,pb]);
assert.equal(metrics.textures,1);assert.equal(metrics.frames,32);assert.equal(a.getPerformanceStats().sharedAtlasRefs,2);
assert.ok(a.playBlock('east'),'guard retains its source block reaction');assert.equal(b.playBlock('east'),null,'squire cannot gain a block reaction from its shield artwork');
let cues=0;const attack=a.play('atk','east',()=>cues++);assert.equal(attack.cueSeconds,.25);a.update(.249);assert.equal(cues,0);a.update(.001);assert.equal(cues,1);a.update(1);assert.equal(cues,1);await attack.completion;
const interrupted=a.play('atk','west',()=>cues++);interrupted.cancel();a.update(1);assert.equal(cues,1);await interrupted.completion;
a.destroy();assert.equal(metrics.textures,1,'active peer retains texture');b.destroy();assert.equal(metrics.textures,0);assert.equal(metrics.frames,0);
const dead=new Rig(new Node(),'guard'),live=new Rig(new Node(),'squire');pa=dead.load();pb=live.load();await flush();dead.destroy();pending.shift()(null,{width:1024,height:512});await Promise.all([pa,pb]);assert.equal(dead.node.isValid,false);assert.equal(live.getPerformanceStats().instanceLoaded,true);assert.equal(metrics.textures,1);live.destroy();assert.equal(metrics.textures,0);
for(const status of['stand','walk','atk','hit','die'])for(let i=0;i<=20;i++){
 const pose=evaluateRigPose(status,i/20,i/20);assert.equal(Object.keys(pose.slots).length,14);for(const value of Object.values(pose.slots))assert.ok(Object.values(value).every(Number.isFinite));
}
assert.equal(Object.keys(HUMANOID_BONES).length,13);
assert.notDeepEqual(evaluateRigPose('die',.2).slots.frontThigh,evaluateRigPose('die',.9).slots.frontThigh,'death articulates joints, not only a root rotation');
for(const label of['guard','squire'])assert.equal(manifest.packed[label].clips.atk.cueFrame/manifest.packed[label].clips.atk.fps,.25);
console.log('PASS: actual rig adapter shared load/refcounts, canceled/late-load lifecycle, .25s cue, five articulated poses and packed cue invariants. Mock does not assess visuals or GPU performance.');
