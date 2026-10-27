import type {RecoveredAnimationStatus} from '../../assets/scripts/game/RecoveredAnimation.ts';
export interface RigTransform {x:number;y:number;angle:number}
export interface RigPose {slots:Record<string,RigTransform>;bowed:boolean;edge:boolean}
/** Shared hierarchy. Render slots are flattened only for deterministic painter order. */
export const HUMANOID_BONES={pelvis:null,torso:'pelvis',head:'torso',swordUpper:'torso',swordFore:'swordUpper',weapon:'swordFore',shieldUpper:'torso',shieldFore:'shieldUpper',shield:'shieldFore',backThigh:'pelvis',backShin:'backThigh',frontThigh:'pelvis',frontShin:'frontThigh'} as const;
const D=Math.PI/180;
const mix=(a:number,b:number,t:number)=>a+(b-a)*t;
const smooth=(x:number)=>{const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t);};
function curve(t:number,keys:number[][]){for(let i=1;i<keys.length;i++)if(t<=keys[i][0]){const a=keys[i-1],b=keys[i];return mix(a[1],b[1],smooth((t-a[0])/(b[0]-a[0])));}return keys.at(-1)![1];}
function down(x:number,y:number,angle:number,length:number){return{x:x+Math.sin(angle*D)*length,y:y-Math.cos(angle*D)*length};}
function rotate(x:number,y:number,angle:number){return{x:x*Math.cos(angle*D)-y*Math.sin(angle*D),y:x*Math.sin(angle*D)+y*Math.cos(angle*D)};}
/** Two-link IK keeps the feet on ground during stance, allowing an actual swing lift. */
function leg(hip:{x:number;y:number},foot:{x:number;y:number}){
 let dx=foot.x-hip.x,dy=foot.y-hip.y;const raw=Math.hypot(dx,dy),d=Math.max(.01,Math.min(33.8,raw));dx*=d/Math.max(.01,raw);dy*=d/Math.max(.01,raw);
 const h=Math.sqrt(Math.max(0,17*17-d*d/4));const knee={x:hip.x+dx/2-dy/d*h,y:hip.y+dy/2+dx/d*h};
 const angle=(x:number,y:number)=>Math.atan2(x,-y)/D;
 return{upper:{...hip,angle:angle(knee.x-hip.x,knee.y-hip.y)},lower:{...knee,angle:angle(hip.x+dx-knee.x,hip.y+dy-knee.y)}};
}

/** One motion graph drives both costumes; no appearance-specific copied tracks. */
export function evaluateRigPose(status:RecoveredAnimationStatus,t:number,gait=t,block=false):RigPose{
 t=Math.max(0,Math.min(1,t));let x=0,y=31,tilt=0,su=-38,sf=32,hu=-25,hf=85,wa=-76,head=0;
 let f={x:14,y:0},b={x:-16,y:0};let bowed=false,edge=false;
 if(status==='stand'){const breath=Math.sin(t*2*Math.PI);y+=breath*.4;su+=breath*1.5;head=breath*.5;}
 if(status==='walk'){
  const phase=gait*2*Math.PI,step=Math.sin(phase);y+=Math.cos(phase*2)*.7;tilt=-4;
  f={x:12+step*10,y:Math.max(0,Math.cos(phase))*5};b={x:-14-step*10,y:Math.max(0,-Math.cos(phase))*5};su+=step*12;sf-=step*9;hu-=step*6;hf+=step*5;
 }
 if(status==='atk'){
  x=curve(t,[[0,0],[.24,-3],[.5,6],[.74,3],[1,0]]);tilt=curve(t,[[0,0],[.24,9],[.5,-13],[.76,-3],[1,0]]);
  su=curve(t,[[0,-38],[.24,-100],[.5,74],[.68,62],[1,-38]]);sf=curve(t,[[0,32],[.24,-130],[.5,88],[.68,64],[1,32]]);
  wa=curve(t,[[0,-76],[.24,-5],[.5,-90],[.68,-110],[1,-76]]);hu=curve(t,[[0,-25],[.28,-10],[.5,10],[1,-25]]);hf=curve(t,[[0,85],[.5,115],[1,85]]);
  f.x+=smooth(t/.5)*4*(1-smooth((t-.5)/.5));edge=t>.25&&t<.7;
 }
 if(status==='hit'){
  const impact=Math.sin(t*Math.PI);x=-impact*3;y-=impact*3;tilt=impact*(block?4:15);head=-impact*8;
  su-=impact*20;sf-=impact*12;hu+=impact*(block?55:20);hf+=impact*35;edge=block;bowed=!block&&impact>.65;
 }
 if(status==='die'){
  const kneel=smooth(t/.45),fall=smooth((t-.35)/.65);y=31-15*kneel-8*fall;x=fall*3;tilt=-80*fall;
  f={x:14+fall*12,y:0};b={x:-16+fall*8,y:0};su=mix(-38,20,fall);sf=mix(32,10,fall);hu=mix(-25,40,fall);hf=mix(85,15,fall);wa=mix(-76,-94,fall);head=-15*kneel;bowed=t>.25;
 }
 const at=(px:number,py:number)=>{const p=rotate(px,py,tilt);return{x:p.x+x,y:p.y+y};};
 const pose:RigPose={slots:{},bowed,edge};const put=(n:string,p:{x:number;y:number},a=tilt)=>pose.slots[n]={...p,angle:a};
 put('pelvis',{x,y});put('cloth',at(0,-1));put('torso',at(0,6));put('head',at(1,29),tilt+head);
 const a=leg(at(-7,-1),b),c=leg(at(7,-1),f);pose.slots.backThigh=a.upper;pose.slots.backShin=a.lower;pose.slots.frontThigh=c.upper;pose.slots.frontShin=c.lower;
 const s=at(-12,23),h=at(12,22);const se=down(s.x,s.y,su+tilt,16),he=down(h.x,h.y,hu+tilt,16);
 const hand=down(se.x,se.y,sf+tilt,14),shieldHand=down(he.x,he.y,hf+tilt,14);
 put('swordUpper',s,su+tilt);put('swordFore',se,sf+tilt);put('weapon',hand,wa+tilt);
 put('shieldUpper',h,hu+tilt);put('shieldFore',he,hf+tilt);put('shield',{x:shieldHand.x,y:shieldHand.y+6},tilt-5+(block?10:0));
 return pose;
}
