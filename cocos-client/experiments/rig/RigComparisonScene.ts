import {Node,Label,Color,Graphics,director,Director,view,ResolutionPolicy,profiler} from 'cc';
import {CocosUi,Theme} from '../../assets/scripts/game/CocosUi.ts';
import {ArtSkin} from '../../assets/scripts/game/ArtSkin.ts';
import {SampleUnitAnimation} from '../../assets/scripts/game/SampleUnitAnimation.ts';
import {SharedRigAnimation,rigManifest} from './SharedRigAnimation.ts';
import type {RecoveredAnimationStatus,RecoveredAnimationDirection} from '../../assets/scripts/game/RecoveredAnimation.ts';
type Mode='side'|'frames'|'packed'|'rig';
interface Actor {host:Node;animation:SampleUnitAnimation|SharedRigAnimation;label:Label;costume:'guard'|'squire'|'trial';x:number;y:number;cycle:number;playAt:number;cueCount:number}
const summary=(values:number[])=>{const v=[...values].sort((a,b)=>a-b);return v.length?{samples:v.length,min:v[0],p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)],max:v.at(-1)}:null;};
/** Native Cocos diagnostic scene, no account, DB, game rule or gameplay writes. */
export class RigComparisonScene{
 static requested(){return typeof location!=='undefined'&&['localhost','127.0.0.1','[::1]'].includes(location.hostname)&&new URLSearchParams(location.search).get('rigbench')==='1';}
 private ui=new CocosUi();private root:Node;private actors:Actor[]=[];private layer:Node;private toolbar?:HTMLElement;private output?:HTMLOutputElement;private status?:HTMLElement;
 private mode:Mode=(new URLSearchParams(location.search).get('mode')??'side') as Mode;private count=Number(new URLSearchParams(location.search).get('count')??4);private action:RecoveredAnimationStatus='stand';private direction:RecoveredAnimationDirection='east';private auto=false;private elapsed=0;private actionElapsed=0;private stage=-1;private ready=false;private disposed=false;private generation=0;private publish=0;private measuring=false;private runElapsed=0;private frames:number[]=[];private draws:number[]=[];private poseTimes:number[]=[];private textureBytes:number[]=[];private cueRecords:{costume:string;seconds:number;expected:number}[]=[];private lastResult:unknown;private exploded=false;
 private releaseReportFrames=0;
 private afterDraw=()=>{const device=director.root?.device;if(this.measuring&&this.runElapsed>.8&&device){this.draws.push(device.numDrawCalls);this.textureBytes.push(device.memoryStatus.textureSize);}if(this.releaseReportFrames>0&&--this.releaseReportFrames===0)this.emit();};
 constructor(parent:Node){view.setDesignResolutionSize(1200,600,ResolutionPolicy.SHOW_ALL);view.resizeWithBrowserSize(true);profiler.hideStats();this.root=this.ui.node(parent,'RigComparison:Cocos',1200,600);this.layer=this.ui.node(this.root,'ComparedActors',1200,600);this.controls();director.on(Director.EVENT_AFTER_DRAW,this.afterDraw);}
 async load(){await ArtSkin.load(location.origin);const bg=ArtSkin.background('main',1);if(bg){const node=await this.ui.image(this.root,'SameBattlefield1',bg,1200,600);node.setSiblingIndex(0);}await this.rebuild();}
 private controls(){
  const bar=document.createElement('section');bar.setAttribute('aria-label','Cocos部件实验控制');Object.assign(bar.style,{position:'fixed',left:'0',right:'0',bottom:'0',background:'#172420',color:'#efe7cf',padding:'5px',display:'flex',gap:'5px',alignItems:'center',zIndex:'100',font:'13px sans-serif'});document.body.append(bar);this.toolbar=bar;
  const select=document.createElement('select');select.setAttribute('aria-label','比较方案');for(const[value,label]of [['side','逐帧 / 骨架同场'],['frames','现有逐帧'],['packed','合并逐帧图集'],['rig','共享骨架']]){const o=document.createElement('option');o.value=value;o.textContent=label;select.append(o);}select.value=this.mode;select.onchange=()=>{this.mode=select.value as Mode;void this.rebuild();};bar.append(select);
  const count=document.createElement('select');count.setAttribute('aria-label','角色数量');for(const n of[4,12,24]){const o=document.createElement('option');o.value=String(n);o.textContent=n+'个角色';count.append(o);}count.value=String(this.count);count.onchange=()=>{this.count=Number(count.value);void this.rebuild();};bar.append(count);
  const button=(text:string,run:()=>void)=>{const b=document.createElement('button');b.textContent=text;b.onclick=run;bar.append(b);};
  for(const[key,label]of Object.entries({stand:'待机',walk:'移动',atk:'攻击',hit:'受击',die:'死亡'}))button(label,()=>{this.auto=false;this.choose(key as RecoveredAnimationStatus);});
  button('转向',()=>{this.direction=this.direction==='east'?'west':'east';this.choose(this.action);});
  button('连续动作',()=>{this.auto=true;this.elapsed=0;this.stage=-1;});
  button('部件拆分',()=>{this.exploded=!this.exploded;for(const a of this.actors)if(a.animation instanceof SharedRigAnimation)a.animation.setExploded(this.exploded);});
  button('18秒采样',()=>{this.auto=true;this.elapsed=0;this.stage=-1;this.runElapsed=0;this.frames=[];this.draws=[];this.poseTimes=[];this.textureBytes=[];this.cueRecords=[];this.measuring=true;this.lastResult=undefined;});
  button('第三外观演练',()=>{void this.rebuild(true);});
  button('释放样板',()=>{this.measuring=false;this.auto=false;this.releaseActors();this.ready=false;this.releaseReportFrames=3;this.emit();});
  this.status=document.createElement('span');bar.append(this.status);const out=document.createElement('output');out.id='rig-observation';out.hidden=true;document.body.append(out);this.output=out;
 }
 private releaseActors(){for(const a of this.actors){a.animation.destroy();a.host.destroy();}this.actors=[];}
 private async rebuild(trial=false){
  const generation=++this.generation;this.ready=false;this.measuring=false;this.releaseActors();this.count=[4,12,24].includes(this.count)?this.count:4;
  const manifest=await rigManifest(trial),normal=await rigManifest();
  for(let i=0;i<this.count;i++){
   const side=this.mode==='side',costume=trial?'trial':(i%2===0?'guard':'squire'),kind=trial?'rig':side?(i<Math.ceil(this.count/2)?'frames':'rig'):this.mode;
   const row=side&&this.count===4?i%2:Math.floor(i/6),col=side&&this.count===4?(i<2?3:7):(i%6)*1.7+1;
   const x=(col-5.5)*90,y=300-(45+(row+.5)*95);const host=this.ui.node(this.layer,'SameUnit:'+i,1,1,x,y);
   const animation=kind==='rig'?new SharedRigAnimation(host,costume):new SampleUnitAnimation(host,kind==='packed'?location.origin+'/art/rig-experiment/':ArtSkin.unitBase(),kind==='packed'?normal.packed![costume]:ArtSkin.unit('main',costume==='guard'?1:19)!);
   const label=this.ui.label(host,'ComparisonName',`${costume==='guard'?'卫兵':costume==='squire'?'侍从':'外观演练'} · ${kind==='rig'?'骨架':kind==='packed'?'合并图集':'逐帧'}`,0,60,150,22,12,Theme.text);label.enableOutline=true;label.outlineColor=new Color(0,0,0,230);label.outlineWidth=1;
   await animation.load();if(this.disposed||generation!==this.generation){animation.destroy();host.destroy();return;}
   this.actors.push({host,animation,label,costume,x,y,cycle:-1,playAt:0,cueCount:0});
  }
  this.ready=true;this.auto=false;this.choose('stand');this.emit();
 }
 private choose(action:RecoveredAnimationStatus){this.action=action;this.actionElapsed=0;for(const a of this.actors){a.cycle=-1;this.play(a);}}
 private play(a:Actor){a.playAt=this.actionElapsed;const expected=this.action==='atk' ? .25 : 0;a.animation.play(this.action,this.direction,()=>{a.cueCount++;if(this.measuring)this.cueRecords.push({costume:a.costume,seconds:a.animation.getPerformanceStats().playbackElapsedSeconds,expected});});}
 update(dt:number){
  if(!this.ready||this.disposed)return;this.elapsed+=dt;this.actionElapsed+=dt;
  if(this.auto){const index=Math.floor(this.elapsed/3)%6;if(index!==this.stage){this.stage=index;this.choose((['stand','walk','atk','hit','die','stand'] as RecoveredAnimationStatus[])[index]);}}
  const before=performance.now();for(const a of this.actors){
   const period=this.action==='atk'?.8:this.action==='hit'?.6:this.action==='die'?1.1:Infinity;const cycle=Math.floor(this.actionElapsed/period);
   if(Number.isFinite(period)&&cycle!==a.cycle){a.cycle=cycle;this.play(a);}
   const travel=this.action==='walk'?Math.min(90,this.actionElapsed*30)*(this.direction==='east'?1:-1):0;a.host.setPosition(a.x+travel,a.y);
   a.animation.update(dt);
  }
  const poseMs=performance.now()-before;
  if(this.measuring){this.runElapsed+=dt;if(this.runElapsed>.8){this.frames.push(dt*1000);this.poseTimes.push(poseMs);}if(this.runElapsed>=18){this.measuring=false;this.auto=false;this.lastResult={mode:this.mode,count:this.actors.length,seconds:this.runElapsed,frameIntervalMs:summary(this.frames),animationUpdateMs:summary(this.poseTimes),drawCalls:summary(this.draws),engineTextureAllocationBytes:summary(this.textureBytes),cues:this.cueRecords,actors:this.actors.map(a=>a.animation.getPerformanceStats()),scope:'same native Cocos scene, warm interval, engine counters not driver GPU residency; no DB or battle rules'};}}
  this.publish+=dt;if(this.publish>.2){this.publish=0;this.emit();}
 }
 private emit(){let nodes=0;const walk=(n:Node)=>{nodes++;n.children.forEach(walk);};walk(this.root);const d=director.root?.device;
  const value={ready:this.ready,mode:this.mode,action:this.action,direction:this.direction,count:this.actors.length,nodes,measuring:this.measuring,elapsed:this.runElapsed,drawCalls:d?.numDrawCalls,engineTextureAllocationBytes:d?.memoryStatus.textureSize,rigBank:SharedRigAnimation.sharedMetrics(),frameBank:SampleUnitAnimation.atlasMetrics(),actors:this.actors.map(a=>a.animation.getPerformanceStats()),result:this.lastResult};
  this.output?.setAttribute('data-json',JSON.stringify(value));if(this.status)this.status.textContent=!this.ready?'未加载':this.measuring?`采样 ${Math.min(18,this.runElapsed).toFixed(1)}/18s`:`${this.actors.length}角色 · ${nodes}节点 · ${d?.numDrawCalls??'?'}次绘制`;
 }
 destroy(){this.disposed=true;++this.generation;director.off(Director.EVENT_AFTER_DRAW,this.afterDraw);this.releaseActors();this.root.destroy();this.toolbar?.remove();this.output?.remove();}
}
