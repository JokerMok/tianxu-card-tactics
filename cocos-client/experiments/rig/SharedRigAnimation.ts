import {assetManager,ImageAsset,Texture2D,SpriteFrame,Sprite,Node,UITransform,Layers,Rect,Size,Graphics,Color} from 'cc';
import type {RecoveredAnimationStatus,RecoveredAnimationDirection,RecoveredPlaybackHandle} from '../../assets/scripts/game/RecoveredAnimation.ts';
import {evaluateRigPose} from './SharedRigMotion.ts';
import type {SampleUnitSpec} from '../../assets/scripts/game/SampleUnitAnimation.ts';
interface Part {rect:[number,number,number,number];size:[number,number];anchor:[number,number]}
interface Costume {parts:Record<string,Part>;origin:[number,number];nameOffsetY:number;height:number;clips:SampleUnitSpec['clips'];reactions?:SampleUnitSpec['reactions']}
interface RigManifest {atlas:string;atlasSize:[number,number];costumes:Record<string,Costume>;packed?:Record<string,SampleUnitSpec>}
interface Bank {refs:number;image:ImageAsset;texture:Texture2D;frames:Map<string,SpriteFrame>;bytes:number;url:string}
let manifestPromise:Promise<RigManifest>|undefined,trialPromise:Promise<RigManifest>|undefined;
const banks=new Map<string,Promise<Bank>>();
const references=new Map<string,number>();
const base=()=>location.origin+'/art/rig-experiment/';
export function rigExperimentMode(){if(typeof location==='undefined'||!['127.0.0.1','localhost','[::1]'].includes(location.hostname))return'';return new URLSearchParams(location.search).get('rig')??'';}
export async function rigManifest(trial=false){
 const load=async()=>{const r=await fetch(base()+(trial?'trial.json':'manifest.json'));if(!r.ok)throw new Error('部件实验清单未就绪');return await r.json() as RigManifest;};
 return trial?(trialPromise??=load()):(manifestPromise??=load());
}
async function acquire(manifest:RigManifest){
 const url=base()+manifest.atlas;references.set(url,(references.get(url)??0)+1);let pending=banks.get(url);
 if(!pending){pending=new Promise<Bank>((resolve,reject)=>assetManager.loadRemote<ImageAsset>(url,{ext:'.webp'},(error,image)=>{
  if(error||!image){banks.delete(url);reject(new Error('部件图集加载失败'));return;}
  const texture=new Texture2D();texture.image=image;const frames=new Map<string,SpriteFrame>();
  for(const[name,costume]of Object.entries(manifest.costumes))for(const[slot,part]of Object.entries(costume.parts)){
   const frame=new SpriteFrame();frame.texture=texture;frame.rect=new Rect(...part.rect);frame.originalSize=new Size(part.rect[2],part.rect[3]);frames.set(name+':'+slot,frame);
  }
  resolve({refs:0,image,texture,frames,bytes:image.width*image.height*4,url});
 }));banks.set(url,pending);}
 try{return await pending;}catch(error){references.set(url,Math.max(0,(references.get(url)??1)-1));throw error;}
}
function release(bank:Bank){const left=Math.max(0,(references.get(bank.url)??1)-1);references.set(bank.url,left);if(left>0)return;for(const frame of bank.frames.values())frame.destroy();bank.texture.destroy();assetManager.releaseAsset(bank.image);banks.delete(bank.url);references.delete(bank.url);}
const ORDER=['backThigh','backShin','frontThigh','frontShin','cloth','pelvis','torso','head','shieldUpper','shieldFore','swordUpper','swordFore','weapon','shield'];
interface Playback{status:RecoveredAnimationStatus;generation:number;elapsed:number;duration:number;loop:boolean;cue:number|null;fired:boolean;finished:boolean;resolve():void;onAttack?:()=>void;onComplete?:()=>void;block:boolean}
/** Opt-in experiment only: ordinary game/default skin remains the existing player. */
export class SharedRigAnimation{
 static sharedMetrics(){return{atlases:banks.size,references:Array.from(references.values()).reduce((a,b)=>a+b,0)};}
 readonly node:Node;readonly mountNode:Node;
 private slots=new Map<string,{node:Node;sprite:Sprite}>();private bank?:Bank;private costume?:Costume;private playback?:Playback;private disposed=false;private direction:RecoveredAnimationDirection='east';private generation=0;private gait=0;private lastX?:number;private plays=0;private cues=0;private lastPoseMs=0;private exploded=false;
 constructor(parent:Node,private readonly name:'guard'|'squire'|'trial'){
  this.node=new Node('SharedRigAnimation');this.node.layer=Layers.Enum.UI_2D;parent.addChild(this.node);this.node.setPosition(0,-32);this.node.addComponent(UITransform);
  const shadow=new Node('ContactShadow');shadow.layer=Layers.Enum.UI_2D;this.node.addChild(shadow);shadow.addComponent(UITransform);const g=shadow.addComponent(Graphics);g.fillColor=new Color(31,34,24,42);g.ellipse(0,0,13,2.2);g.fill();
  this.mountNode=new Node('SharedRigMount');this.node.addChild(this.mountNode);
 }
 async load(){
  const manifest=await rigManifest(this.name==='trial'),bank=await acquire(manifest);
  if(this.disposed){release(bank);return;}this.bank=bank;this.costume=manifest.costumes[this.name];
  for(const slot of ORDER){const part=this.costume.parts[slot],node=new Node('RigSlot:'+slot);node.layer=Layers.Enum.UI_2D;this.node.addChild(node);const t=node.addComponent(UITransform);t.setContentSize(...part.size);t.setAnchorPoint(...part.anchor);const sprite=node.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;sprite.spriteFrame=bank.frames.get(this.name+':'+slot)!;this.slots.set(slot,{node,sprite});}
  this.play('stand','east');
 }
 play(status:RecoveredAnimationStatus,direction:RecoveredAnimationDirection,onAttack?:()=>void,onComplete?:()=>void,block=false):RecoveredPlaybackHandle{
  this.cancel();const generation=++this.generation,clip=this.costume?.clips[status];
  if(this.disposed||!clip)return{generation,status,statusName:null,durationSeconds:0,cueSeconds:null,hasNativeState:false,completion:Promise.resolve(),cancel(){}};
  let resolve!:()=>void;const completion=new Promise<void>(done=>resolve=done);const duration=block ? .2 : clip.count/clip.fps,cue=clip.cueFrame===undefined?null:clip.cueFrame/clip.fps;
  this.direction=direction;this.node.setScale(direction==='west'?-1:1,1,1);this.lastX=undefined;this.plays++;
  this.playback={status,generation,elapsed:0,duration,loop:block?false:clip.loop,cue,fired:false,finished:false,resolve,onAttack,onComplete,block};this.pose();
  return{generation,status,statusName:block?'block':status,durationSeconds:duration,cueSeconds:cue,hasNativeState:true,completion,cancel:()=>{if(this.playback?.generation===generation)this.cancel();}};
 }
 playBlock(direction:RecoveredAnimationDirection){return this.costume?.reactions?.block?this.play('hit',direction,undefined,undefined,true):null;}
 setExploded(value:boolean){this.exploded=value;this.pose();}
 update(dt:number){const p=this.playback;if(!p||p.finished||this.disposed||dt<=0||!Number.isFinite(dt))return;
  p.elapsed+=dt;
  if(p.status==='walk'){
   const x=this.node.worldPosition.x,scale=Math.abs(this.node.worldScale.x)||1;
   if(this.lastX!==undefined)this.gait+=Math.abs(x-this.lastX)/scale/28;this.lastX=x;
  }
  if(!p.fired&&p.cue!==null&&p.elapsed>=p.cue){p.fired=true;this.cues++;p.onAttack?.();if(this.playback!==p)return;}
  this.pose();if(!p.loop&&p.elapsed>=p.duration){p.finished=true;p.resolve();p.onComplete?.();}
 }
 private pose(){const p=this.playback;if(!p||!this.bank||!this.costume)return;const start=performance.now(),t=p.loop?(p.elapsed/p.duration)%1:Math.min(1,p.elapsed/p.duration);const pose=evaluateRigPose(p.status,t,this.gait,p.block);
  let i=0;for(const[slot,display]of this.slots){const part=pose.slots[slot];if(this.exploded){display.node.setPosition((i%4-1.5)*38,100-Math.floor(i/4)*40);display.node.angle=0;i++;}else{display.node.setPosition(part.x,part.y);display.node.angle=part.angle;}
   display.sprite.spriteFrame=this.bank.frames.get(this.name+':'+(slot==='head'&&pose.bowed?'bowedHead':slot==='shield'&&pose.edge?'shieldEdge':slot))!;
  }
  this.mountNode.setPosition(pose.slots.weapon.x,pose.slots.weapon.y);this.lastPoseMs=performance.now()-start;
 }
 private cancel(){const p=this.playback;if(p&&!p.finished){p.finished=true;p.resolve();}this.playback=undefined;}
 destroy(){if(this.disposed)return;this.disposed=true;this.cancel();for(const d of this.slots.values())d.sprite.spriteFrame=null;this.slots.clear();this.node.destroy();if(this.bank)release(this.bank);this.bank=undefined;}
 getSourceLayoutMetrics(direction=this.direction){return{nominalWidth:129,nominalHeight:104,anchorX:direction==='west'?79:50,anchorY:98,nameOffsetY:56};}
 getPerformanceStats(){return{kind:'shared-rig',costume:this.name,slots:this.slots.size,nodeCount:this.node.children.length+1,sharedAtlasRefs:this.bank?references.get(this.bank.url)??0:0,sharedAtlasFrames:this.bank?.frames.size??0,decodedBytes:this.bank?.bytes??0,playbackElapsedSeconds:this.playback?.elapsed??0,plays:this.plays,cues:this.cues,lastPoseMs:this.lastPoseMs,instanceLoaded:!!this.bank,instancePlaying:!!this.playback&&!this.playback.finished};}
}
