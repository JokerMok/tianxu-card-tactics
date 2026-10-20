import { Node, Camera, RenderTexture, SpriteFrame, Sprite, UITransform, MeshRenderer, Material, primitives, utils, Vec3, Color, Layers, Mesh, DirectionalLight, resources, JsonAsset, EffectAsset, tween, Tween } from 'cc';
import type { BattleState, BattleEvent, Unit } from '../../core/types/index.ts';

interface Geometry {group:string;material:string;pivot:number[];positions:number[];normals:number[];indices:number[];}
interface ModelCatalog {materials:Record<string,number[]>;models:Record<string,Geometry[]>;}
interface Figure {root:Node;rig:Node;groups:Map<string,Node>;moving:number;attack:number;hit:number;phase:number;side:'player'|'enemy';}
const MODELS:Record<string,string>={U001:'guard',U002:'soldier',U003:'healer',U004:'archer',U005:'rider',U006:'archer',U007:'hound',U008:'behemoth',U009:'spirit',U010:'spirit',U011:'stone',U012:'stone',U013:'banner',U014:'archer',U015:'guard',U016:'soldier',U017:'healer',U018:'tide',U019:'stone',U020:'stone',U021:'spirit',U022:'spirit',U023:'construct',U024:'engineer',U025:'engineer',U026:'siege',U027:'bird',U028:'rhino'};
/** Authored Blender meshes and semantic joints. Animation never changes combat state. */
export class Role3DLayer {
  private readonly world:Node;
  private readonly texture:RenderTexture;
  private readonly frame:SpriteFrame;
  private readonly figures=new Map<string,Figure>();
  private readonly meshes=new Map<string,Mesh>();
  private readonly materials=new Map<string,Material>();
  private readonly ring=utils.createMesh(primitives.cylinder(.30,.34,.022,{radialSegments:28}));
  private catalog!:ModelCatalog;
  private effect!:EffectAsset;
  private time=0;
  constructor(host:Node){
    this.world=new Node('Campaign3DWorld');this.world.setParent(host.scene);this.world.layer=Layers.Enum.DEFAULT;
    const cameraNode=new Node('Campaign3DCamera');cameraNode.setParent(this.world);cameraNode.setPosition(0,10,14);cameraNode.lookAt(new Vec3(0,0,0));
    const camera=cameraNode.addComponent(Camera);camera.projection=Camera.ProjectionType.ORTHO;camera.orthoHeight=3.14;camera.visibility=Layers.Enum.DEFAULT;
    camera.clearColor=new Color(0,0,0,0);camera.clearFlags=Camera.ClearFlag.SOLID_COLOR;
    this.texture=new RenderTexture();this.texture.reset({width:1660,height:680});camera.targetTexture=this.texture;
    const surface=new Node('Roles3D');surface.layer=Layers.Enum.UI_2D;surface.setParent(host);surface.setPosition(0,-20);
    surface.addComponent(UITransform).setContentSize(1660,680);this.frame=new SpriteFrame();this.frame.texture=this.texture;
    const sprite=surface.addComponent(Sprite);sprite.spriteFrame=this.frame;sprite.sizeMode=Sprite.SizeMode.CUSTOM;
    const sun=new Node('MiniatureKeyLight');sun.setParent(this.world);sun.setRotationFromEuler(-42,-35,0);const light=sun.addComponent(DirectionalLight);light.color=new Color(255,236,200);light.illuminance=38000;
    host.scene.globals.ambient.skyLightingColor=new Color(153,179,190);host.scene.globals.ambient.skyIllum=20000;
  }
  async load():Promise<void>{
    this.effect=await new Promise<EffectAsset>((resolve,reject)=>resources.load('demo/character',EffectAsset,(e,a)=>e?reject(e):resolve(a)));
    this.catalog=await new Promise<ModelCatalog>((resolve,reject)=>resources.load('demo/models/characters',JsonAsset,(e,a)=>e?reject(e):resolve(a.json as ModelCatalog)));
    for(const [model,parts]of Object.entries(this.catalog.models))parts.forEach((part,index)=>this.meshes.set(`${model}:${index}`,utils.createMesh({positions:part.positions,normals:part.normals,uvs:new Array(part.positions.length/3*2).fill(0),indices:part.indices})));
  }
  private material(name:string,side:'player'|'enemy'):Material{
    const key=`${name}:${side}`;const found=this.materials.get(key);if(found)return found;
    const rgb=this.catalog.materials[name]??[.3,.3,.3];const color=name==='cloth'&&side==='enemy'?[.35,.05,.034]:rgb;
    const material=new Material();material.initialize({effectAsset:this.effect});
    material.setProperty('mainColor',new Color(...color.map(v=>Math.round(Math.pow(v,1/2.2)*255)) as [number,number,number]));
    material.setProperty('roughness',['gold','iron'].includes(name)?.38:.7);material.setProperty('metallic',['gold','iron'].includes(name)?.56:0);
    if(name==='jade'||name==='glow')material.setProperty('emissive',new Color(...color.map(v=>Math.round(v*150)) as [number,number,number]));
    this.materials.set(key,material);return material;
  }
  private create(unit:Unit):Figure{
    const root=new Node(unit.id);root.setParent(this.world);root.layer=Layers.Enum.DEFAULT;
    const rig=new Node('ArticulatedCharacter');rig.setParent(root);rig.layer=Layers.Enum.DEFAULT;rig.setRotationFromEuler(0,unit.side==='player'?60:-60,0);
    const groups=new Map<string,Node>();const model=MODELS[unit.cardId]??'soldier';
    const size=['behemoth','rhino','siege'].includes(model)?1.18:model==='hound'?1.28:.97;
    rig.setScale(size,size,size);
    this.catalog.models[model].forEach((part,index)=>{
      let joint=groups.get(part.group);if(!joint){joint=new Node(part.group);joint.setParent(rig);joint.layer=Layers.Enum.DEFAULT;joint.setPosition(...part.pivot as [number,number,number]);groups.set(part.group,joint);}
      const surface=new Node(part.material);surface.setParent(joint);surface.layer=Layers.Enum.DEFAULT;const renderer=surface.addComponent(MeshRenderer);
      renderer.mesh=this.meshes.get(`${model}:${index}`)!;renderer.setMaterial(this.material(part.material,unit.side),0);
    });
    const base=new Node('Team base');base.setParent(root);base.layer=Layers.Enum.DEFAULT;const baseRenderer=base.addComponent(MeshRenderer);baseRenderer.mesh=this.ring;baseRenderer.setMaterial(this.material(unit.side==='player'?'jade':'red',unit.side),0);
    const figure={root,rig,groups,moving:0,attack:0,hit:0,phase:this.figures.size*1.7,side:unit.side};this.figures.set(unit.id,figure);return figure;
  }
  set active(value:boolean){this.world.active=value;}
  static cellPosition(cell:number,lane:number):Vec3{return new Vec3((cell-5.5)*1.27,0,lane===0?-1.8:1.8);}
  sync(state:BattleState,events:readonly BattleEvent[]=[],seconds=.45):void{
    const existing=new Set(state.units.map(u=>u.id));
    for(const [id,figure]of this.figures)if(!existing.has(id)){
      this.figures.delete(id);Tween.stopAllByTarget(figure.root);
      tween(figure.rig).to(seconds*.6,{eulerAngles:new Vec3(0,figure.rig.eulerAngles.y,-80)}).start();
      tween(figure.root).delay(seconds*.55).to(seconds*.45,{scale:new Vec3(0,0,0)}).call(()=>figure.root.destroy()).start();
    }
    for(const unit of state.units){
      let figure=this.figures.get(unit.id);const fresh=!figure;if(!figure)figure=this.create(unit);
      const position=Role3DLayer.cellPosition(unit.cell,unit.lane);
      if(fresh){figure.root.setPosition(position);figure.root.setScale(.01,.01,.01);tween(figure.root).to(.35,{scale:new Vec3(1,1,1)},{easing:'backOut'}).start();}
      else if(!figure.root.position.equals(position,.01)){Tween.stopAllByTarget(figure.root);figure.moving=this.time+seconds;tween(figure.root).to(seconds,{position},{easing:'sineInOut'}).start();}
    }
    for(const event of events){
      const p=event.payload;
      if(event.type==='ATTACK'){const id=String(p.attackerId??p.sourceId??event.sourceId??'');const figure=this.figures.get(id);if(figure)figure.attack=this.time+seconds;}
      if(event.type==='DAMAGE'){const id=String(p.targetId??event.targetId??'');const figure=this.figures.get(id);if(figure)figure.hit=this.time+seconds;}
    }
  }
  update(dt:number):void{
    this.time+=Math.min(dt,.1);if(!this.world.active)return;
    for(const f of this.figures.values()){
      const walking=f.moving>this.time;const attacking=f.attack>this.time;const hit=f.hit>this.time;
      const phase=this.time*(walking?13:1.5)+f.phase;const stride=walking?Math.sin(phase)*24:Math.sin(phase)*1.2;
      f.groups.get('legL')?.setRotationFromEuler(stride,0,0);f.groups.get('legR')?.setRotationFromEuler(-stride,0,0);
      f.groups.get('armL')?.setRotationFromEuler(-stride*.7,0,attacking?-10:0);
      f.groups.get('armR')?.setRotationFromEuler(attacking?-48+Math.sin(this.time*19)*22:stride*.6,0,0);
      f.groups.get('wingL')?.setRotationFromEuler(0,Math.sin(phase)*7,Math.sin(phase)*5);f.groups.get('wingR')?.setRotationFromEuler(0,-Math.sin(phase)*7,-Math.sin(phase)*5);
      f.rig.setPosition(hit?Math.sin(this.time*60)*.035:0,walking?Math.abs(Math.sin(phase))*.025:Math.sin(phase)*.006,attacking?Math.sin(this.time*18)*.065:0);
    }
  }
  clear():void{for(const f of this.figures.values()){Tween.stopAllByTarget(f.root);Tween.stopAllByTarget(f.rig);f.root.destroy();}this.figures.clear();}
  destroy():void{this.clear();this.world.destroy();this.frame.destroy();this.texture.destroy();this.ring.destroy();for(const mesh of this.meshes.values())mesh.destroy();for(const material of this.materials.values())material.destroy();}
}
