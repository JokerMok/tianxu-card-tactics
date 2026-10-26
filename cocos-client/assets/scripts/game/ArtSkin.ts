import {assetManager,ImageAsset,Texture2D,SpriteFrame,Sprite,Node} from 'cc';
import {SampleUnitAnimation,type SampleUnitSpec} from './SampleUnitAnimation.ts';
interface ImageSpec {file:string;size:[number,number];insets?:[number,number,number,number]}
interface Manifest {version:1|2;id:string;images:Record<string,ImageSpec>;maps:Record<string,string>;units:Record<string,SampleUnitSpec>;models?:Record<string,string>}
type State='normal'|'selected'|'pressed'|'disabled';
export type ButtonKind='primary'|'secondary'|'compact';
const images=new Map<string,Promise<{image:ImageAsset;texture:Texture2D;frame:SpriteFrame}>>();
const requests=new WeakMap<Node,string>();
let manifest:Manifest|undefined,base='',disposed=false;
const stats={loads:0,failures:0,maxPrepareMs:0};
/** Presentation-only, keyed by stable scoped IDs. No database or gameplay references. */
export class ArtSkin {
 static enabled(kind:'ui'|'unit'|'background'){
  if(typeof location==='undefined')return false;
  const q=new URLSearchParams(location.search);if(q.get('skin')==='original')return false;
  return !q.has('art')||q.get('art')!.split(',').includes(kind);
 }
 static async load(origin:string){
  if(!['ui','unit','background'].some(k=>this.enabled(k as 'ui'|'unit'|'background')))return;
  if(manifest)return;const requested=typeof location==='undefined'?'sample':new URLSearchParams(location.search).get('skin')??'sample';
  const version=requested==='sample-v1'?'v1':requested==='sample-r2'?'v2':requested==='sample-batch2'?'v3':requested==='sample-batch3'?'v4':'v5';base=origin.replace(/\/$/,'')+'/art/'+version+'/';disposed=false;
  const res=await fetch(base+'manifest.json');if(!res.ok)throw new Error('美术样板清单载入失败，请检查本机资源目录。');
  const value=await res.json();if(![1,2].includes(value.version)||!value.images||!value.units||!value.maps)throw new Error('美术样板清单格式错误。');manifest=value;
  // Prepare all four states before the first real press, rather than loading a pressed image after release.
  try { if(this.enabled('ui'))await Promise.all(['normal','selected','pressed','disabled'].map(state=>this.acquire('button-'+state,value.images['button-'+state]))); } catch(error) { manifest=undefined;throw error; }
 }
 static image(key:string){return this.enabled('ui')?manifest?.images[key]:undefined;}
 static background(scope:string,id:number){const key=this.enabled('background')?manifest?.maps[`${scope}:map:${id}`]:undefined;return key?base+manifest!.images[key].file:undefined;}
 static unit(scope:string,id:number,modelId?:string){
  if(!this.enabled('unit')||!manifest)return undefined;
  const exact=manifest.units[`${scope}:monster:${id}`];if(exact)return exact;
  const shared=modelId?manifest.models?.[`${scope}:${modelId}`]:undefined;
  return shared?manifest.units[shared]:undefined;
 }
 static unitBase(){return base;}
 static url(key:string){const image=this.image(key);return image?base+image.file:undefined;}
 static async paint(node:Node,key:string){
  const item=manifest?.images[key];if(!item)throw new Error('未找到样板图像映射：'+key);
  requests.set(node,key);
  const sprite=node.getComponent(Sprite)??node.addComponent(Sprite);sprite.sizeMode=Sprite.SizeMode.CUSTOM;
  const asset=await this.acquire(key,item);if(!node.isValid||disposed||requests.get(node)!==key)return;
  sprite.spriteFrame=asset.frame;sprite.type=item.insets?Sprite.Type.SLICED:Sprite.Type.SIMPLE;
 }
 static button(node:Node,disabled:boolean,selected=false,kind:ButtonKind='secondary'){
  let state:State=disabled?'disabled':selected?'selected':'normal';
  const paint=()=>{const preferred=`button-${kind}-${state}`,key=manifest?.images[preferred]?preferred:'button-'+state;void this.paint(node,key).catch(e=>console.warn('Art skin button',String(e)));};paint();
  if(disabled)return;
  node.on(Node.EventType.MOUSE_ENTER,()=>{state='selected';paint();});
  const reset=()=>{state=selected?'selected':'normal';paint();};
  node.on(Node.EventType.MOUSE_LEAVE,reset);node.on(Node.EventType.TOUCH_START,()=>{state='pressed';paint();});
  node.on(Node.EventType.TOUCH_END,reset);node.on(Node.EventType.TOUCH_CANCEL,reset);
 }
 static sourceKey(skin:string){
  if(!this.enabled('ui')||!manifest)return undefined;
  if(/^(renleikuang|wanglingkuang|yeshoukuang|dijingkuang|jumokuang|jinglingkuang|shourenkuang|yijiekuang|longzukuang|tianshikuang|emokuang|jineng)$|^ronghekuang_/.test(skin))return 'card-frame';
  if(['kpglk_1','zdjm_1'].includes(skin))return 'panel';
  return undefined;
 }
 static qualityFrame(quality:number){
  if(!this.enabled('ui')||!manifest)return undefined;
  const key='quality-frame-'+Math.max(0,Math.min(6,Math.round(quality)));
  return manifest.images[key]?key:(manifest.images['card-frame']?'card-frame':undefined);
 }
 private static acquire(key:string,item:ImageSpec){
  let pending=images.get(key);if(pending)return pending;
  // Both packs have finite manifests. V2 adds quality frames, button tiers and HUD icons.
  if(images.size>=40)throw new Error('美术样板图像缓存已达到上限。');const at=Date.now();stats.loads++;
  pending=new Promise<{image:ImageAsset;texture:Texture2D;frame:SpriteFrame}>((resolve,reject)=>assetManager.loadRemote<ImageAsset>(base+item.file,{ext:item.file.endsWith('.jpg')?'.jpg':'.png'},(error,image)=>{
   if(error){stats.failures++;images.delete(key);reject(error);return;}
   if(disposed){assetManager.releaseAsset(image);reject(new Error('样板皮肤已释放。'));return;}
   const texture=new Texture2D();texture.image=image;const frame=new SpriteFrame();frame.texture=texture;
   if(item.insets)[frame.insetLeft,frame.insetRight,frame.insetTop,frame.insetBottom]=item.insets;
   stats.maxPrepareMs=Math.max(stats.maxPrepareMs,Date.now()-at);resolve({image,texture,frame});}));images.set(key,pending);return pending;
 }
 static metrics(){return {pack:manifest?.id??'original',uiTextures:images.size,...stats,unitAtlases:SampleUnitAnimation.atlasMetrics()};}
 static dispose(){disposed=true;for(const p of images.values())void p.then(a=>{a.frame.destroy();a.texture.destroy();assetManager.releaseAsset(a.image);}).catch(()=>{});images.clear();manifest=undefined;}
}
