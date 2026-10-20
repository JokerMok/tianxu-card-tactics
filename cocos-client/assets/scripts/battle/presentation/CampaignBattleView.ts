import { Node, resources, JsonAsset, Sprite, SpriteFrame, Rect, Color, Graphics, UIOpacity, UITransform, Vec3, tween, Tween, AudioSource, AudioClip, HorizontalTextAlignment, ImageAsset, Texture2D } from 'cc';
import { CampaignSession, readCampaignEnvelope } from '../campaign/CampaignSession.ts';
import type { BattleSessionAction } from '../session-controller.ts';
import type { BattleState, BattleEvent, Unit } from '../../core/types/index.ts';
import { artwork, panel, label, singleLineLabel, button, uiNode, ruleLine, battleColors as C } from './BattleWidgets';

interface CardRow {id:string;cardType:string;prepare:number;rarity:number;race:string;}
interface UnitRow {id:string;maxHp:number;attack:number;armor:number;move:number;range:number;role:string;}
interface SkillRow {id:string;targetType:string;}
interface Strategy {levelId:string;unitIds:string[];skillRules:{skillId:string}[];}
interface ViewConfig {cards:CardRow[];units:UnitRow[];skills:SkillRow[];strategies:Strategy[];[key:string]:unknown;}
interface Catalog {units:Record<string,string>;skills:Record<string,{name:string;description:string}>;}
type U002Pose='Ready'|'Move'|'Windup'|'Release'|'Impact'|'Recover'|'Hit'|'Death';
type UnitAction='Idle'|'Move'|'Attack'|'Hit'|'Death';
// Align the opaque boot soles, rather than the images' transparent bounds, to the map.
const U002_POSE_Y:Record<U002Pose,number>={Ready:85,Move:82,Windup:85,Release:74,Impact:67,Recover:79,Hit:86,Death:84};
// Size the visible figures against the two broad stone lanes, not PNG bounds.
const SIDE_UNIT_SIZE=195;
const U002_POSE_SIZE=220;
const U002_POSE_SCALE=U002_POSE_SIZE/176;
const u002PoseY=(pose:U002Pose)=>U002_POSE_Y[pose]*U002_POSE_SCALE;
const PREVIEW_UNIT_SCALE=1.25;
const SIDE_COMMANDER_SIZE=270;
// The logical 2x12 grid stays invisible. Units stand on the two paths in the map.
const CELL=137.5;
const laneY=(lane:number)=>lane===0?30:-190;
const xCell=(cell:number)=>(cell-5.5)*CELL;
const ROLES:Record<string,string>={GUARD:'守卫',STRIKER:'突击',HEALER:'医护',RANGED:'远射',FAST:'快速',CONTROL:'控制',SUPPORT:'支援',SUMMONER:'召唤',ANCHOR:'压阵'};
const HUD_GOLD=new Color(219,190,128);
const HUD_ART_PATH='ui/battle/battle-hud-overlay-open';
const HUD_ART_RECT=new Rect(0,14,1672,927);
// These are centers in the ORIGINAL artwork pixels, not guessed screen positions.
// Creator trims transparent borders on import, so the SpriteFrame rect must be
// used when placing live text over the stretched sprites.
const HUD_ART_SOURCE={phaseY:40,controlsY:68,autoX:756,endTurnX:836,speedX:918,playerNameLeft:125,enemyNameLeft:1195,nameY:51,deckIconX:65,deckIconY:853,deckTextX:155,deckHeadingY:831,deckValueY:859,graveyardY:886,footerY:857,footerIconY:840,footerCaptionY:890,combatLogX:1457,menuX:1585} as const;
const CARD_ART_SOURCE={titleY:1160,statsY:1354,badgeY:138} as const;
const BATTLE_TEXT={cardY:-405,selectedCardLift:13,selectionTitleY:-220,selectionHintY:-252} as const;
/** Complete first-level presentation. Every command and reward still comes from CampaignSession. */
export class CampaignBattleView {
  private readonly staticLayer:Node;
  private readonly boardLayer:Node;
  private readonly unitLayer:Node;
  private readonly ui:Node;
  private readonly fx:Node;
  private readonly modal:Node;
  private readonly audio:AudioSource;
  private readonly frames=new Map<string,SpriteFrame>();
  private readonly actionIcons=new Map<'deck'|'report'|'menu'|'deploy',SpriteFrame>();
  private readonly skillArtFrames=new Map<string,SpriteFrame>();
  private readonly sounds=new Map<string,AudioClip>();
  private readonly previewFrames=new Map<string,SpriteFrame>();
  private readonly unitDisplays=new Map<string,{node:Node;visual:Node;cardId:string;pose?:Sprite;action?:UnitAction;dying:boolean;moving:boolean;serial:number}>();
  private readonly pendingImpacts=new Map<string,()=>void>();
  private readonly u002Poses=new Map<U002Pose,SpriteFrame>();
  private readonly commanderNodes:Node[]=[];
  private previewClock=0;
  private config!:ViewConfig;
  private catalog!:Catalog;
  private level!:{rewards:{type:string;id:string;quantity:number}[]};
  private strategy!:Strategy;
  private session?:CampaignSession;
  private selected?:string;
  private selectedInstance?:string;
  private selectedUnit?:string;
  private handPage=0;
  private epoch=0;
  private busy=false;
  private paused=false;
  private auto=false;
  private speed=1;
  private muted=false;
  private error='';
  private toastText='';
  private returnHandler:()=>void=()=>undefined;
  private readonly timers=new Set<ReturnType<typeof setTimeout>>();
  private readonly combatLog:string[]=[];
  constructor(private readonly root:Node){
    this.staticLayer=uiNode(root,'BattleScenery');
    this.boardLayer=uiNode(root,'TacticalGrid');
    this.unitLayer=uiNode(root,'BattleUnits');
    this.ui=uiNode(root,'BattleInterface');this.fx=uiNode(root,'CombatFeedback');this.modal=uiNode(root,'BattleDialogs');
    this.audio=root.addComponent(AudioSource);
  }
  async load():Promise<void>{
    const json=(name:string)=>new Promise<any>((resolve,reject)=>resources.load(name,JsonAsset,(e,a)=>e?reject(e):resolve(a.json)));
    const names=['cards','skills','units','professions','decks','effects'];const tables=await Promise.all(names.map(name=>json(`config/${name}`)));
    this.config=Object.fromEntries(names.map((name,i)=>[name,tables[i][name]])) as unknown as ViewConfig;
    this.level=(await json('config/levels/chapter01/L01')).chapterLevels[0];
    this.config.strategies=(await json('config/enemy/strategies')).strategies;
    const strategy=this.config.strategies.find(s=>s.levelId==='L01');if(!strategy)throw new Error('首关敌方策略缺失');this.strategy=strategy;
    this.catalog=await json('demo/card-catalog');
    const paths=['art/battle/background/E104-TWO-LANE-MERGED','art/battle/heroes/C001/C001-SIDE-READY','art/battle/heroes/C009/C009-SIDE-READY','a0/commanders/C009-BATTLE-SIDESLOT','ui/components/jade-button','ui/components/jade-panel','ui/components/skill-art-atlas',HUD_ART_PATH,'ui/battle/battle-card-frame','ui/battle/battle-hint-plaque','ui/battle/battle-action-icons',...this.config.cards.filter(c=>c.cardType==='UNIT').map(c=>`demo/cards/${c.id}`)];
    await Promise.all(paths.map(path=>new Promise<void>((resolve,reject)=>resources.load(path+'/spriteFrame',SpriteFrame,(e,a)=>{if(e)return reject(e);this.frames.set(path,a);resolve();}))));
    for(const path of ['art/battle/heroes/C001/C001-SIDE-READY','art/battle/heroes/C009/C009-SIDE-READY']){
      const source=this.frames.get(path)!;const frame=new SpriteFrame();frame.texture=source.texture;
      frame.rect=new Rect(0,0,source.texture.width,source.texture.height);this.frames.set(path,frame);
    }
    // Keep the proven HUD coordinates when Creator imports the edited PNG with a different transparent trim.
    const hudSource=this.frames.get(HUD_ART_PATH)!;
    const hudFrame=new SpriteFrame();hudFrame.texture=hudSource.texture;hudFrame.rect=HUD_ART_RECT;
    this.frames.set(HUD_ART_PATH,hudFrame);
    const iconAtlas=this.frames.get('ui/battle/battle-action-icons')!;
    const iconRects:Record<'deck'|'report'|'menu'|'deploy',Rect>={
      deck:new Rect(145,45,510,470),report:new Rect(900,60,500,455),
      menu:new Rect(140,580,500,355),deploy:new Rect(800,520,690,390),
    };
    for(const [name,rect] of Object.entries(iconRects) as [keyof typeof iconRects,Rect][]){
      const frame=new SpriteFrame();frame.texture=iconAtlas.texture;frame.rect=rect;this.actionIcons.set(name,frame);
    }
    const hintSource=this.frames.get('ui/battle/battle-hint-plaque')!;
    const hintFrame=new SpriteFrame();hintFrame.texture=hintSource.texture;
    hintFrame.rect=new Rect(0,450,hintSource.texture.width,210);
    this.frames.set('ui/battle/battle-hint-crop',hintFrame);
    const skillAtlas=this.frames.get('ui/components/skill-art-atlas')!;
    const positions:Record<string,[number,number]>={S001:[0,0],S002:[1,0],S003:[2,0],S004:[0,1],S006:[1,1],S014:[2,1]};
    for(const [id,[column,row]] of Object.entries(positions)){
      const frame=new SpriteFrame();frame.texture=skillAtlas.texture;
      const cellWidth=skillAtlas.texture.width/3,cellHeight=skillAtlas.texture.height/2;
      const cropHeight=cellWidth*100/132;
      frame.rect=new Rect(column*cellWidth,row*cellHeight+(cellHeight-cropHeight)/2,cellWidth,cropHeight);
      this.skillArtFrames.set(id,frame);
    }
    await Promise.all(['button_activate','attack_impact','hit_impact','heal_pulse','spell_resolve','death_release','settlement_reveal'].map(name=>new Promise<void>(resolve=>resources.load(`art/battle/audio/sfx_${name}_v001`,AudioClip,(e,a)=>{if(!e)this.sounds.set(name,a);resolve();}))));
    await this.loadUnitPreviews();await this.loadU002SidePoses();this.drawScenery();this.session=this.openSession();
  }
  private async loadU002SidePoses():Promise<void>{
    const poses:U002Pose[]=['Ready','Move','Windup','Release','Impact','Recover','Hit','Death'];
    await Promise.all(poses.map(pose=>new Promise<void>(resolve=>{
      resources.load(`art/battle/units/U002/side-pose-v2/U002-SIDE-${pose.toUpperCase()}/spriteFrame`,SpriteFrame,(error,frame)=>{
        if(!error&&frame)this.u002Poses.set(pose,frame);
        else console.warn(`[U002 side animation] Missing ${pose} pose; static fallback remains available.`,error);
        resolve();
      });
    })));
  }
  private async loadUnitPreviews():Promise<void>{
    await new Promise<void>((resolve,reject)=>resources.load('art/battle/units/U001/side-pose-v1/U001-SIDE-READY/spriteFrame',SpriteFrame,(error,source)=>{
      if(error||!source)return reject(error??new Error('U001 side-view sprite missing'));
      const frame=new SpriteFrame();frame.texture=source.texture;
      frame.rect=new Rect(0,0,source.texture.width,source.texture.height);
      this.previewFrames.set('U001',frame);resolve();
    }));
    await new Promise<void>(resolve=>resources.load('art/battle/units/U005/U005-POSE-SHEET/spriteFrame',SpriteFrame,(error,source)=>{
      if(!error&&source){
        const frame=new SpriteFrame();frame.texture=source.texture;frame.rect=new Rect(0,80,360,500);
        this.previewFrames.set('U005',frame);
      }
      resolve();
    }));
    await Promise.all((['U002','U008'] as const).map(id=>new Promise<void>(resolve=>{
      resources.load(`a0/units/${id}-ANIMATION-POSES/spriteFrame`,SpriteFrame,(error,source)=>{
        if(!error&&source){
          const image=source.texture instanceof Texture2D?source.texture.image?.data:undefined;
          if(image&&!ArrayBuffer.isView(image)){
            const canvas=document.createElement('canvas');canvas.width=source.texture.width;canvas.height=source.texture.height;
            const context=canvas.getContext('2d',{willReadFrequently:true});
            if(context){
              context.drawImage(image as CanvasImageSource,0,0,canvas.width,canvas.height);
              const pixels=context.getImageData(0,0,canvas.width,canvas.height);const data=pixels.data;
              for(let index=0;index<data.length;index+=4){
                const red=data[index]/255,green=data[index+1]/255,blue=data[index+2]/255;
                const chroma=Math.max(red,green,blue)-Math.min(red,green,blue);
                const luminance=red*.2126+green*.7152+blue*.0722;
                const neutral=1-Math.min(1,Math.max(0,(chroma-.025)/.08));
                const bright=Math.min(1,Math.max(0,(luminance-.50)/.22));
                data[index+3]=Math.round(data[index+3]*(1-neutral*bright));
              }
              context.putImageData(pixels,0,0);
              const texture=new Texture2D(`${id}-battle-preview`);texture.image=new ImageAsset(canvas);
              const cell=Math.floor(texture.width/5);
              const crop=id==='U002'?{x:72,y:215,width:cell-126,height:430}:{x:8,y:230,width:cell-16,height:330};
              const frame=new SpriteFrame();frame.texture=texture;frame.rect=new Rect(crop.x,crop.y,crop.width,crop.height);
              this.previewFrames.set(id,frame);
            }
          }
        }
        resolve();
      });
    })));
  }
  private openSession():CampaignSession{
    const envelope=readCampaignEnvelope(localStorage);
    if(envelope.campaign?.phase==='active'||(envelope.campaign?.phase==='settled'&&!envelope.campaign.resultDismissed)){
      const previous=JSON.parse(envelope.campaign.configVersion) as {config:ViewConfig;level:unknown};
      const {strategies,...legacy}=this.config;
      if(!previous.config.strategies && JSON.stringify(previous.config)===JSON.stringify(legacy) && JSON.stringify(previous.level)===JSON.stringify(this.level))return new CampaignSession(previous.config,previous.level,localStorage);
    }
    return new CampaignSession(this.config,this.level,localStorage);
  }
  setReturnHandler(callback:()=>void):void{this.returnHandler=callback;}
  get rewardLabel():string{return this.level.rewards.map(r=>`${this.name(r.id)} ×${r.quantity}`).join('、');}
  get resumable():boolean{return this.session?.record?.phase==='active';}
  get restorable():boolean{const record=this.session?.record;return record?.phase==='active'||(record?.phase==='settled'&&!record.resultDismissed);}
  update(dt:number):void{
    if(this.paused)return;
    this.previewClock+=Math.min(dt,.1);
    for(const display of this.unitDisplays.values())if(display.visual.isValid&&(!display.pose||display.action==='Idle'))display.visual.setScale(display.visual.scale.x<0?-1:1,1+Math.sin(this.previewClock*2.6)*.009,1);
    for(const node of this.commanderNodes)if(node.isValid)node.setScale(1,1+Math.sin(this.previewClock*1.8)*.008,1);
  }
  private later(callback:()=>void,milliseconds:number):void{
    const epoch=this.epoch;const timer=setTimeout(()=>{this.timers.delete(timer);if(epoch===this.epoch&&this.root.isValid)callback();},milliseconds);this.timers.add(timer);
  }
  private cancel():void{this.epoch++;for(const timer of this.timers)clearTimeout(timer);this.timers.clear();this.pendingImpacts.clear();this.busy=false;}
  private clear(node:Node):void{for(const child of [...node.children]){child.removeFromParent();child.destroy();}}
  enter(forceNew=false):void{
    this.cancel();this.clear(this.modal);this.clear(this.fx);this.clear(this.unitLayer);this.unitDisplays.clear();this.selected=undefined;this.selectedInstance=undefined;this.selectedUnit=undefined;this.error='';this.auto=false;this.paused=false;this.handPage=0;this.combatLog.length=0;
    this.session=forceNew?new CampaignSession(this.config,this.level,localStorage):this.openSession();const restored=this.restorable&&!forceNew;
    // A deterministic opening is available only through an explicit review URL.
    // It leaves the deck, preparation cost and battle rules unchanged.
    const params=typeof location!=='undefined'?new URLSearchParams(location.search):undefined;
    const reviewSeed=params?.get('battleReview')==='two-lanes'?1104:params?.get('animationPilot')==='U002'?27:undefined;
    if(!restored)this.session.start(globalThis.crypto.randomUUID(),reviewSeed??Math.floor(Math.random()*2147483647),'D001');
    this.render();
    if(restored){if(this.state.status==='playing'){this.announce('已恢复战局 · 可以继续作战');this.advance();}}else this.showBriefing();
  }
  exit():void{
    const record=this.session?.record;if(record)this.session!.exit(record.id);
    this.cancel();this.clear(this.modal);this.clear(this.unitLayer);this.unitDisplays.clear();
  }
  private get state():BattleState{return this.session!.snapshot!.state;}
  private name(id:string):string{return this.catalog.units[id]??this.catalog.skills[id]?.name??id;}
  private hudX(sourceX:number):number{
    const rect=this.frames.get(HUD_ART_PATH)!.rect;
    return (sourceX-rect.x)*1920/rect.width-960;
  }
  private hudY(sourceY:number):number{
    const rect=this.frames.get(HUD_ART_PATH)!.rect;
    return 540-(sourceY-rect.y)*1080/rect.height;
  }
  private cardTextY(sourceY:number):number{
    const rect=this.frames.get('ui/battle/battle-card-frame')!.rect;
    return 219/2-(sourceY-rect.y)*219/rect.height;
  }
  private sound(name:string):void{const clip=this.sounds.get(name);if(clip&&!this.muted)this.audio.playOneShot(clip,.4);}
  private jadeButton(parent:Node,name:string,value:string,x:number,y:number,w:number,h:number,action:()=>void,active=true):Node{
    const hit=uiNode(parent,name,x,y,w,h);
    artwork(hit,'JadeSurface',this.frames.get('ui/components/jade-button')!,0,0,w,h*1.9,active?Color.WHITE:new Color(105,115,105));
    singleLineLabel(hit,'Caption',value,0,0,w-12,h-7,Math.min(19,Math.max(16,h*.32)),active?C.bone:C.muted);
    if(active){hit.on(Node.EventType.TOUCH_END,action);hit.on(Node.EventType.MOUSE_ENTER,()=>hit.setScale(1.035,1.035,1));hit.on(Node.EventType.MOUSE_LEAVE,()=>hit.setScale(1,1,1));}
    return hit;
  }
  private quietButton(parent:Node,name:string,value:string,x:number,y:number,w:number,h:number,action:()=>void,active=true,selected=false):Node{
    const hit=uiNode(parent,name,x,y,w,h);
    singleLineLabel(hit,'Caption',value,0,0,w-6,h-4,19,active?(selected?HUD_GOLD:C.bone):C.muted);
    ruleLine(hit,0,-h/2+4,w-16,active?(selected?230:75):35);
    if(active){hit.on(Node.EventType.TOUCH_END,action);hit.on(Node.EventType.MOUSE_ENTER,()=>hit.setScale(1.04,1.04,1));hit.on(Node.EventType.MOUSE_LEAVE,()=>hit.setScale(1,1,1));}
    return hit;
  }
  private hudButton(parent:Node,name:string,value:string,x:number,y:number,w:number,h:number,action:()=>void,active=true,size=19):Node{
    const hit=uiNode(parent,name,x,y,w,h);
    singleLineLabel(hit,'Caption',value,0,0,w-8,h-7,size,active?C.bone:C.muted);
    if(active){hit.on(Node.EventType.TOUCH_END,action);hit.on(Node.EventType.MOUSE_ENTER,()=>hit.setScale(1.045,1.045,1));hit.on(Node.EventType.MOUSE_LEAVE,()=>hit.setScale(1,1,1));}
    return hit;
  }
  private drawScenery():void{
    // This full-screen scene keeps both deployment rows clear and leaves the
    // foreground beneath the hand free of large posts or pennants.
    artwork(this.staticLayer,'TwoLaneArena',this.frames.get('art/battle/background/E104-TWO-LANE-MERGED')!,0,0,1920,1080);
    artwork(this.staticLayer,'BattleHudArt',this.frames.get(HUD_ART_PATH)!,0,0,1920,1080);
    const commanders=[
      {side:'player',x:-830,frame:this.frames.get('art/battle/heroes/C009/C009-SIDE-READY')!},
      {side:'enemy',x:830,frame:this.frames.get('art/battle/heroes/C001/C001-SIDE-READY')!},
    ];
    for(const {side,x,frame} of commanders){
      panel(this.staticLayer,side+'GroundShadow',x,-95,140,14,new Color(3,12,12,115),undefined,7);
      this.commanderNodes.push(artwork(this.staticLayer,side+'Commander',frame,x,34,SIDE_COMMANDER_SIZE,SIDE_COMMANDER_SIZE));
    }
  }
  private render():void{
    this.clear(this.ui);this.clear(this.boardLayer);const s=this.state;
    this.drawHeader(s);this.drawGrid(s);this.drawUnits(s);this.drawHand(s);this.drawControls(s);
    if(s.status!=='playing'&&!this.busy)this.showResult();
  }
  private drawHeader(s:BattleState):void{
    for(const [side,x]of [['player',-625],['enemy',625]] as const){
      const accent=side==='player'?C.jade:C.red;
      const nameLeft=side==='player'?HUD_ART_SOURCE.playerNameLeft:HUD_ART_SOURCE.enemyNameLeft;
      const nameX=this.hudX(nameLeft)+85,hpX=side==='player'?x+230:x+150,barX=side==='player'?x+20:x-20;
      singleLineLabel(this.ui,side+'Hero',side==='player'?'我方指挥官':'敌方统领',nameX,this.hudY(HUD_ART_SOURCE.nameY),170,24,18,C.bone,HorizontalTextAlignment.LEFT);
      singleLineLabel(this.ui,side+'HeroHP',`${s.heroHp[side]} / ${s.heroMaxHp[side]}`,hpX,494,120,26,18,C.bone);
      panel(this.ui,side+'HealthTrack',barX,465,390,8,new Color(3,15,16,225),new Color(121,108,72,160),4);
      const ratio=Math.max(0,s.heroHp[side]/s.heroMaxHp[side]);const fillWidth=390*ratio;
      if(fillWidth>0)panel(this.ui,side+'Health',barX-(390-fillWidth)/2,465,fillWidth,5,accent,undefined,3);
    }
    singleLineLabel(this.ui,'Phase',`第 ${s.round} 回合  ·  ${this.busy?'结算中':s.activeSide==='player'?'我方行动':'敌方行动'}`,0,this.hudY(HUD_ART_SOURCE.phaseY),255,24,15,C.bone);
    this.quietButton(this.ui,'Auto',this.auto?'托管中':'托管',this.hudX(HUD_ART_SOURCE.autoX),this.hudY(HUD_ART_SOURCE.controlsY),70,37,()=>{this.auto=!this.auto;this.render();this.advance();},s.status==='playing',this.auto);
    const canEnd=!this.busy&&!this.paused&&s.activeSide==='player'&&s.status==='playing';
    const end=uiNode(this.ui,'EndTurn',this.hudX(HUD_ART_SOURCE.endTurnX),this.hudY(HUD_ART_SOURCE.controlsY),110,42);
    singleLineLabel(end,'Caption',this.busy?'交战中':s.activeSide==='player'?'结束回合':'敌方回合',0,0,108,37,18,canEnd?HUD_GOLD:C.muted);
    if(canEnd){end.on(Node.EventType.TOUCH_END,()=>this.submit({type:'END_TURN'}));end.on(Node.EventType.MOUSE_ENTER,()=>end.setScale(1.045,1.045,1));end.on(Node.EventType.MOUSE_LEAVE,()=>end.setScale(1,1,1));}
    this.quietButton(this.ui,'Speed',`${this.speed}×`,this.hudX(HUD_ART_SOURCE.speedX),this.hudY(HUD_ART_SOURCE.controlsY),48,37,()=>{this.speed=this.speed===1?2:1;this.render();},!this.busy,this.speed===2);
  }
  private drawGrid(s:BattleState):void{
    for(let lane=0;lane<2;lane++){
      const active=lane<s.laneCount;const y=laneY(lane);
      const selected=this.selected?this.config.cards.find(c=>c.id===this.selected):undefined;
      const ready=!!this.selectedInstance&&s.hands.player.some(c=>c.instanceId===this.selectedInstance&&c.remainingPreparation===0);
      for(let cell=0;cell<12;cell++){
        const x=xCell(cell);const occupied=s.units.some(u=>u.lane===lane&&u.cell===cell);const deploy=active&&cell<3&&!occupied&&ready&&selected?.cardType==='UNIT'&&s.activeSide==='player'&&!this.busy;
        const hit=uiNode(this.boardLayer,`Target-${lane}-${cell}`,x,y+72,CELL-2,150);
        if(deploy){
          const mark=artwork(this.boardLayer,`DeployCue-${lane}-${cell}`,this.actionIcons.get('deploy')!,x,y+10,78,40);
          mark.addComponent(UIOpacity).opacity=180;
        }
        if(active)hit.on(Node.EventType.TOUCH_END,()=>this.targetCell(lane,cell));
      }
    }
  }
  private drawUnits(s:BattleState):void{
    const present=new Set(s.units.map(unit=>unit.id));
    for(const [id,display] of this.unitDisplays)if(!present.has(id)&&!display.dying){display.node.destroy();this.unitDisplays.delete(id);}
    for(const unit of s.units){
      const x=xCell(unit.cell),y=laneY(unit.lane);const accent=unit.side==='player'?C.jade:C.red;
      let display=this.unitDisplays.get(unit.id);
      if(display&&display.cardId!==unit.cardId){display.node.destroy();this.unitDisplays.delete(unit.id);display=undefined;}
      if(!display){
        const token=uiNode(this.unitLayer,'Unit-'+unit.id,x,y,136,220);
        panel(token,'GroundShadow',0,5,110,12,new Color(3,12,12,110),undefined,6);
        let visual:Node,pose:Sprite|undefined;
        if(unit.cardId==='U002'&&this.u002Poses.size===8){
          visual=artwork(token,'U002SidePose',this.u002Poses.get('Ready')!,0,u002PoseY('Ready'),U002_POSE_SIZE,U002_POSE_SIZE);
          visual.setScale(unit.side==='player'?1:-1,1,1);
          pose=visual.getComponent(Sprite)!;
        }else if(unit.cardId==='U001'){
          visual=artwork(token,'U001SidePose',this.previewFrames.get('U001')!,0,98,SIDE_UNIT_SIZE,SIDE_UNIT_SIZE);
          visual.setScale(unit.side==='enemy'?1:-1,1,1);
        }else{
          visual=this.makePreviewVisual(token,unit);
        }
        display={node:token,visual,cardId:unit.cardId,pose,action:pose?'Idle':undefined,dying:false,moving:false,serial:0};
        this.unitDisplays.set(unit.id,display);
      }
      if(!display.moving)display.node.setPosition(x,y,0);
      let info=display.node.getChildByName('UnitInfo');
      if(!info)info=uiNode(display.node,'UnitInfo');
      this.clear(info);
      singleLineLabel(info,'UnitName',this.name(unit.cardId),0,205,136,23,14,C.bone);
      const bar=panel(info,'UnitHealth',0,186,104,7,new Color(4,12,13,225),undefined,3);
      const fill=Math.max(0,88*unit.hp/unit.maxHp);
      if(fill)panel(bar,'Fill',-44+fill/2,0,fill,5,accent,undefined,2);
      if(unit.statuses.some(status=>['BARRIER','ATTACK_BUFF','ARMOR_BUFF'].includes(status.kind)))singleLineLabel(info,'UnitStatus',unit.statuses.some(status=>status.kind==='BARRIER')?'屏障':unit.statuses.some(status=>status.kind==='ATTACK_BUFF')?'攻击↑':'护甲↑',0,168,110,22,13,C.gold);
      const hit=uiNode(info,'Inspect-'+unit.id,0,95,136,190);hit.on(Node.EventType.TOUCH_END,()=>{
        if(this.busy)return;
        if(this.selected&&this.config.cards.find(c=>c.id===this.selected)?.cardType==='SKILL')this.cast(unit.lane,unit);
        else{this.selectedUnit=unit.id;this.selected=undefined;this.selectedInstance=undefined;this.render();}
      });
    }
  }
  private makePreviewVisual(token:Node,unit:Unit):Node{
      const preview=this.previewFrames.get(unit.cardId);
      if(preview){
        const size=unit.cardId==='U008'?{width:112,height:132}:unit.cardId==='U001'?{width:98,height:147}:unit.cardId==='U005'?{width:106,height:146}:{width:108,height:145};
        const art=artwork(token,'UnitVisual',preview,0,75*PREVIEW_UNIT_SCALE,size.width*PREVIEW_UNIT_SCALE,size.height*PREVIEW_UNIT_SCALE);
        if(unit.side==='player')art.setScale(-1,1,1);
        return art;
      }else{
        const definition=this.config.units.find(candidate=>candidate.id===unit.cardId);
        const figure=uiNode(token,'UnitVisualPending',0,73*PREVIEW_UNIT_SCALE,92,140);figure.setScale(PREVIEW_UNIT_SCALE,PREVIEW_UNIT_SCALE,1);const silhouette=figure.addComponent(Graphics);
        const body=unit.side==='player'?new Color(29,56,51):new Color(63,40,37);
        const cloak=unit.side==='player'?new Color(43,81,70):new Color(95,53,44);
        const trim=unit.side==='player'?new Color(176,159,111):new Color(176,123,91);
        const shape=(points:[number,number][],color:Color)=>{
          silhouette.fillColor=color;points.forEach(([px,py],index)=>index?silhouette.lineTo(px,py):silhouette.moveTo(px,py));silhouette.close();silhouette.fill();
        };
        shape([[-21,22],[-39,-59],[-8,-51],[0,-18],[10,-51],[37,-57],[20,22]],cloak);
        shape([[-20,-19],[-4,-19],[-9,-66],[-28,-66]],body);
        shape([[4,-19],[21,-19],[28,-66],[9,-66]],body);
        shape([[-21,19],[21,19],[24,-26],[-24,-26]],body);
        shape([[-27,18],[-17,20],[-31,-28],[-41,-26]],body);
        shape([[17,20],[27,18],[40,-25],[30,-28]],body);
        silhouette.fillColor=new Color(150,125,101);silhouette.circle(0,41,13);silhouette.fill();
        shape([[-16,46],[-9,57],[9,57],[16,46]],body);
        shape([[-23,17],[23,17],[17,10],[-17,10]],trim);
        silhouette.strokeColor=trim;silhouette.lineWidth=3;
        if(definition?.role==='GUARD'||definition?.role==='ANCHOR'){
          shape([[21,5],[41,9],[39,-31],[22,-35]],body);
          silhouette.moveTo(31,3);silhouette.lineTo(31,-28);silhouette.stroke();
        }else{
          silhouette.moveTo(30,39);silhouette.lineTo(40,-58);silhouette.stroke();
        }
      return figure;
      }
  }
  private drawHand(s:BattleState):void{
    const visible=s.hands.player.slice(this.handPage*8,this.handPage*8+8);if(!visible.length&&this.handPage>0){this.handPage=0;return this.drawHand(s);}
    const spread=Math.min(146,1170/Math.max(visible.length,1));
    visible.forEach((card,index)=>{
      const definition=this.config.cards.find(c=>c.id===card.cardId)!;const selected=this.selectedInstance===card.instanceId;const ready=card.remainingPreparation===0;
      const x=(index-(visible.length-1)/2)*spread,y=BATTLE_TEXT.cardY+(selected?BATTLE_TEXT.selectedCardLift:0);
      const n=uiNode(this.ui,'Card-'+card.instanceId,x,y,146,219);
      if(selected)n.setScale(1.045,1.045,1);
      if(definition.cardType==='UNIT')artwork(n,'Portrait',this.frames.get(`demo/cards/${card.cardId}`)!,0,22,128,128,ready?Color.WHITE:new Color(205,211,204));
      else if(this.skillArtFrames.has(card.cardId))artwork(n,'SkillArt',this.skillArtFrames.get(card.cardId)!,0,22,128,128,ready?Color.WHITE:new Color(205,211,204));
      else{
        const g=uiNode(n,'Seal');const ink=g.addComponent(Graphics);ink.strokeColor=C.gold;ink.lineWidth=2;ink.circle(0,29,34);ink.stroke();ink.moveTo(-26,29);ink.lineTo(0,56);ink.lineTo(26,29);ink.lineTo(0,2);ink.close();ink.stroke();
        singleLineLabel(n,'SkillGlyph',card.cardId==='S006'?'守':card.cardId==='S004'?'令':'阵',0,29,76,70,36,C.gold);
        singleLineLabel(n,'SkillType','统御军令',0,76,132,21,13,C.muted);
      }
      artwork(n,'CardFrame',this.frames.get('ui/battle/battle-card-frame')!,0,0,146,219);
      singleLineLabel(n,'CardTitle',this.name(card.cardId),0,this.cardTextY(CARD_ART_SOURCE.titleY),133,27,17,C.bone);
      const unit=this.config.units.find(u=>u.id===card.cardId);
      singleLineLabel(n,'Stats',unit?`${unit.attack} 攻   ${unit.maxHp} 血   ${unit.armor} 甲`:'选择友方目标',0,this.cardTextY(CARD_ART_SOURCE.statsY),133,19,12,ready?C.bone:C.muted);
      singleLineLabel(n,'Preparation',ready?'✓':String(card.remainingPreparation),-56,this.cardTextY(CARD_ART_SOURCE.badgeY),28,28,18,ready?C.bone:C.muted);
      n.on(Node.EventType.TOUCH_END,()=>{if(this.busy||this.paused||s.activeSide!=='player')return;this.sound('button_activate');this.selected=card.cardId;this.selectedInstance=card.instanceId;this.selectedUnit=undefined;this.error=ready?'':`还需准备 ${card.remainingPreparation} 回合，结束回合后继续准备`;this.render();});
    });
    const inspected=this.selected?this.config.cards.find(c=>c.id===this.selected):undefined;
    const unit=this.selectedUnit?s.units.find(u=>u.id===this.selectedUnit):undefined;
    let title='',detail='';
    if(inspected){title=this.name(inspected.id);const stats=this.config.units.find(u=>u.id===inspected.id);detail=stats?`${ROLES[stats.role]??'单位'}  ·  移动 ${stats.move} 格  ·  射程 ${stats.range} 格  ·  选择亮起的格子部署`:this.catalog.skills[inspected.id]?.description??'选择友方目标';}
    else if(unit){title=this.name(unit.cardId);detail=`攻击 ${unit.attack}　生命 ${unit.hp}/${unit.maxHp}　护甲 ${unit.armor}　移动 ${unit.move}　射程 ${unit.range}`;}
    else {title=this.busy?'兵锋已交 · 请稍候':s.activeSide==='player'?'布阵迎敌':'敌方正在调遣役兵';detail=s.units.some(u=>u.side==='player')?'单位会在结束回合后自动推进和攻击':'点击准备完成的卡牌，再点击我方部署区；无可用卡时结束回合';}
    singleLineLabel(this.ui,'SelectionTitle',title,0,BATTLE_TEXT.selectionTitleY,1050,30,21,HUD_GOLD);
    singleLineLabel(this.ui,'SelectionHint',this.error||detail,0,BATTLE_TEXT.selectionHintY,1060,27,16,this.error?new Color(235,162,113):C.bone);
    artwork(this.ui,'DeckIcon',this.actionIcons.get('deck')!,this.hudX(HUD_ART_SOURCE.deckIconX),this.hudY(HUD_ART_SOURCE.deckIconY),70,70);
    singleLineLabel(this.ui,'DeckCount','牌库',this.hudX(HUD_ART_SOURCE.deckTextX),this.hudY(HUD_ART_SOURCE.deckHeadingY),104,24,18,C.bone);
    singleLineLabel(this.ui,'DeckValue',String(s.decks.player.length),this.hudX(HUD_ART_SOURCE.deckTextX),this.hudY(HUD_ART_SOURCE.deckValueY),104,34,29,HUD_GOLD);
    this.hudButton(this.ui,'Graveyard',`墓地 ${s.graveyards.player.length}`,this.hudX(HUD_ART_SOURCE.deckTextX),this.hudY(HUD_ART_SOURCE.graveyardY),104,28,()=>this.showGraveyard(),true,16);
    if(s.hands.player.length>8){
      this.hudButton(this.ui,'PreviousHand','‹',-690,-454,42,56,()=>{this.handPage=Math.max(0,this.handPage-1);this.render();},this.handPage>0);
      this.hudButton(this.ui,'NextHand','›',690,-454,42,56,()=>{this.handPage++;this.render();},(this.handPage+1)*8<s.hands.player.length);
      singleLineLabel(this.ui,'HandPage',`${this.handPage+1} / ${Math.ceil(s.hands.player.length/8)}`,-36,-522,220,23,14,C.muted);
    }
  }
  private drawControls(s:BattleState):void{
    this.iconHudButton('CombatLog','战报','report',HUD_ART_SOURCE.combatLogX,()=>this.showLog());
    this.iconHudButton('Pause','菜单','menu',HUD_ART_SOURCE.menuX,()=>this.showPause(),s.status==='playing'&&!this.busy);
  }
  private iconHudButton(name:string,value:string,icon:'report'|'menu',sourceX:number,action:()=>void,active=true):void{
    const hit=uiNode(this.ui,name,this.hudX(sourceX),this.hudY(HUD_ART_SOURCE.footerY),126,114);
    artwork(hit,'Icon',this.actionIcons.get(icon)!,0,this.hudY(HUD_ART_SOURCE.footerIconY)-this.hudY(HUD_ART_SOURCE.footerY),icon==='menu'?70:65,icon==='menu'?51:63,active?Color.WHITE:new Color(145,150,138));
    singleLineLabel(hit,'Caption',value,0,this.hudY(HUD_ART_SOURCE.footerCaptionY)-this.hudY(HUD_ART_SOURCE.footerY),108,27,19,active?C.bone:C.muted);
    if(active){hit.on(Node.EventType.TOUCH_END,action);hit.on(Node.EventType.MOUSE_ENTER,()=>hit.setScale(1.045,1.045,1));hit.on(Node.EventType.MOUSE_LEAVE,()=>hit.setScale(1,1,1));}
  }
  private targetCell(lane:number,cell:number):void{
    if(this.busy||this.paused||!this.selected||this.state.activeSide!=='player')return;
    if(!this.state.hands.player.some(c=>c.instanceId===this.selectedInstance&&c.remainingPreparation===0)){this.error='该张卡牌尚未准备完成';this.render();return;}
    const card=this.config.cards.find(c=>c.id===this.selected)!;
    if(card.cardType==='SKILL'){this.cast(lane);return;}
    if(cell>=3){this.error='单位只能部署在我方左侧三个召唤格';this.render();return;}
    if(this.state.units.some(u=>u.lane===lane&&u.cell===cell)){this.error='该位置已有单位，请选择空格';this.render();return;}
    this.submit({type:'DEPLOY_UNIT',cardId:this.selected,side:'player',lane,cell});
  }
  private cast(lane:number,unit?:Unit):void{
    if(!this.selected||this.busy||this.paused||this.state.activeSide!=='player')return;
    if(!this.state.hands.player.some(c=>c.instanceId===this.selectedInstance&&c.remainingPreparation===0)){this.error='该张军令尚未准备完成';this.render();return;}
    const skill=this.config.skills.find(s=>s.id===this.selected);if(!skill)return;
    if(skill.targetType==='ALLY_UNIT'&&!unit){this.error='请点击我方单位施放屏障';this.render();return;}
    if(unit?.side==='enemy'){this.error='这张军令需要选择我方目标';this.render();return;}
    this.submit({type:'PLAY_CARD',cardId:this.selected,side:'player',target:skill.targetType==='ALLY_UNIT'?{kind:'unit',unitId:unit!.id}:{kind:'lane',lane}});
  }
  private submit(action:BattleSessionAction):void{
    if(this.busy||this.paused)return;const record=this.session?.record;if(!record||record.phase!=='active')return;
    const previous=this.state;
    try{this.session!.command(record.id,record.commandCount,action);}catch(e){
      this.error=e instanceof Error?e.message:'操作未保存，请重试';if(this.error.includes('ready'))this.error='卡牌尚未准备完成，请先结束回合';this.auto=false;this.render();return;
    }
    const next=this.state;const events=next.events.slice(previous.events.length);this.error='';this.selected=undefined;this.selectedInstance=undefined;this.selectedUnit=undefined;
    for(const event of events)if(event.type==='UNIT_DIED'){
      const display=this.unitDisplays.get(String(event.payload.unitId??''));
      if(display){display.dying=true;const info=display.node.getChildByName('UnitInfo');if(info)this.clear(info);}
    }
    const seconds=(action.type==='END_TURN'?1.05:action.type==='PLAY_CARD'?.72:.52)/this.speed;
    this.busy=true;this.render();this.playUnitMotion(previous,next,events,seconds);this.feedback(previous,next,events,action,seconds);
    this.later(()=>{for(const display of this.unitDisplays.values())display.dying=false;this.busy=false;this.render();if(next.status==='playing')this.advance();},seconds*1000);
  }
  private playUnitAction(id:string,name:UnitAction,duration:number):void{
    const display=this.unitDisplays.get(id);if(!display?.pose)return;
    const serial=++display.serial;
    Tween.stopAllByTarget(display.visual);
    display.action=name;
    display.visual.setScale(display.visual.scale.x<0?-1:1,1,1);
    const direction=display.visual.scale.x<0?-1:1;
    const show=(pose:U002Pose,x=0)=>{
      if(!display.visual.isValid||display.serial!==serial)return;
      display.pose!.spriteFrame=this.u002Poses.get(pose)!;
      display.visual.setPosition(x,u002PoseY(pose),0);
    };
    if(name==='Idle'){show('Ready');return;}
    if(name==='Move'){
      show('Move');
      this.later(()=>show('Ready'),150/this.speed);
      this.later(()=>show('Move'),300/this.speed);
      return;
    }
    if(name==='Attack'){
      show('Windup');
      tween(display.visual)
        .to(.10/this.speed,{position:new Vec3(direction*14*U002_POSE_SCALE,u002PoseY('Windup'),0)},{easing:'sineIn'})
        .call(()=>show('Release',direction*14*U002_POSE_SCALE))
        .to(.11/this.speed,{position:new Vec3(direction*40*U002_POSE_SCALE,u002PoseY('Release'),0)},{easing:'sineIn'})
        .call(()=>{show('Impact',direction*40*U002_POSE_SCALE);if(display.serial===serial)this.flushImpact(id);})
        .to(.12/this.speed,{position:new Vec3(direction*28*U002_POSE_SCALE,u002PoseY('Impact'),0)},{easing:'sineOut'})
        .call(()=>show('Recover',direction*28*U002_POSE_SCALE))
        .to(.22/this.speed,{position:new Vec3(0,u002PoseY('Recover'),0)},{easing:'sineOut'})
        .call(()=>show('Ready'))
        .start();
    }else if(name==='Hit')show('Hit');
    else show('Death');
    if(name!=='Death')this.later(()=>{
      if(display.node.isValid&&!display.dying&&display.serial===serial)this.playUnitAction(id,'Idle',0);
    },duration*1000/this.speed);
  }
  private deferImpact(id:string,callback:()=>void):void{
    const previous=this.pendingImpacts.get(id);
    this.pendingImpacts.set(id,previous?()=>{previous();callback();}:callback);
    this.later(()=>this.flushImpact(id),Math.max(300,560/this.speed));
  }
  private flushImpact(id:string):void{
    const callback=this.pendingImpacts.get(id);if(!callback)return;
    this.pendingImpacts.delete(id);callback();
  }
  private playUnitMotion(before:BattleState,after:BattleState,events:readonly BattleEvent[],seconds:number):void{
    const attacking=new Set(events.filter(e=>e.type==='ATTACK').map(e=>String(e.payload.attackerId??e.sourceId??'')));
    for(const unit of after.units){
      const old=before.units.find(candidate=>candidate.id===unit.id);
      const display=this.unitDisplays.get(unit.id);
      if(!old||!display?.pose||old.lane===unit.lane&&old.cell===unit.cell)continue;
      display.node.setPosition(xCell(old.cell),laneY(old.lane),0);display.moving=true;
      if(!attacking.has(unit.id))this.playUnitAction(unit.id,'Move',0);
      tween(display.node).to(Math.min(.42,seconds*.62),{position:new Vec3(xCell(unit.cell),laneY(unit.lane),0)},{easing:'sineInOut'}).call(()=>{
        display.moving=false;
        if(display.node.isValid&&!attacking.has(unit.id)&&!display.dying)this.playUnitAction(unit.id,'Idle',0);
      }).start();
    }
    for(const id of attacking)this.playUnitAction(id,'Attack',.8);
    const dying=new Set(events.filter(e=>e.type==='UNIT_DIED').map(e=>String(e.payload.unitId??'')));
    for(const event of events)if(event.type==='DAMAGE'){
      const id=String(event.payload.targetId??event.targetId??'');
      if(id&&!dying.has(id))this.later(()=>this.playUnitAction(id,'Hit',.4),attacking.has(id)?Math.min(500,seconds*700):Math.min(220,seconds*320));
    }
    for(const id of dying)this.later(()=>this.playUnitAction(id,'Death',.8),Math.min(250,seconds*260));
  }
  private feedback(before:BattleState,after:BattleState,events:readonly BattleEvent[],action:BattleSessionAction,seconds:number):void{
    if(action.type==='DEPLOY_UNIT'){
      this.sound('button_activate');this.combatLog.push(`${action.side==='player'?'我方':'敌方'}部署 ${this.name(action.cardId)} · ${action.lane===0?'上路':'下路'}`);
      this.ripple(xCell(action.cell),laneY(action.lane),C.gold);
      if(before.laneCount<after.laneCount)this.announce('下路已开启 · 可以分路布阵');
    }
    if(action.type==='PLAY_CARD'){
      this.sound('spell_resolve');this.combatLog.push(`${action.side==='player'?'我方':'敌方'}施放 ${this.name(action.cardId)}`);
      const lane=action.target.kind==='lane'?action.target.lane:after.units.find(u=>action.target.kind==='unit'&&u.id===action.target.unitId)?.lane;
      for(const unit of after.units.filter(u=>u.side===action.side&&u.lane===lane))this.ripple(xCell(unit.cell),laneY(unit.lane)+65,new Color(132,208,191));
    }
    const attacks=events.filter(e=>e.type==='ATTACK');
    const pilotAttackers=new Set(attacks.map(e=>String(e.payload.attackerId??e.sourceId??'')).filter(id=>!!this.unitDisplays.get(id)?.pose));
    if(attacks.length>pilotAttackers.size)this.sound('attack_impact');
    for(const id of pilotAttackers)this.deferImpact(id,()=>this.sound('attack_impact'));
    for(const event of attacks){
      const id=String(event.payload.attackerId??event.sourceId??'');
      if(!pilotAttackers.has(id))continue;
      const attacker=after.units.find(u=>u.id===id)??before.units.find(u=>u.id===id);
      const targetId=String(event.payload.targetId??'');
      const target=after.units.find(u=>u.id===targetId)??before.units.find(u=>u.id===targetId);
      if(attacker&&target)this.deferImpact(id,()=>this.spearTrace(attacker,target));
    }
    for(const event of events){
      const p=event.payload;
      if(event.type==='DAMAGE'){
        const id=String(p.targetId??event.targetId??'');const target=after.units.find(u=>u.id===id)??before.units.find(u=>u.id===id);const damage=Number(p.value??0);
        const showDamage=()=>{
          if(target){this.floating(`−${damage}`,xCell(target.cell),laneY(target.lane)+105,new Color(255,195,143),seconds);this.slash(xCell(target.cell),laneY(target.lane)+75);}
          else if(id==='player'||id==='enemy'){this.floating(`−${damage}`,id==='player'?-520:520,433,new Color(255,162,116),seconds);}
        };
        const sourceId=String(p.sourceId??event.sourceId??'');
        if(pilotAttackers.has(sourceId))this.deferImpact(sourceId,showDamage);else showDamage();
        this.combatLog.push(`${target?this.name(target.cardId):id==='player'?'我方主将':'敌方主将'}受到 ${damage} 点伤害`);
      }
      if(event.type==='UNIT_DIED'){this.sound('death_release');const id=String(p.unitId??'');const dead=before.units.find(u=>u.id===id);if(dead)this.combatLog.push(`${this.name(dead.cardId)}退出战场`);}
    }
    if(action.type==='END_TURN'&&attacks.length===0)this.combatLog.push(`第 ${before.round} 回合 · ${before.activeSide==='player'?'我方':'敌方'}单位推进`);
    if(this.combatLog.length>100)this.combatLog.splice(0,this.combatLog.length-100);
  }
  private floating(text:string,x:number,y:number,color:Color,seconds:number):void{
    const n=label(this.fx,'DamageNumber',text,x,y,180,63,38,color).node;const opacity=n.addComponent(UIOpacity);
    tween(n).by(seconds,{position:new Vec3(0,50,0)},{easing:'sineOut'}).call(()=>n.destroy()).start();tween(opacity).delay(seconds*.5).to(seconds*.5,{opacity:0}).start();
  }
  private spearTrace(attacker:Unit,target:Unit):void{
    const direction=attacker.side==='player'?1:-1;
    const from=xCell(attacker.cell)+direction*77,to=xCell(target.cell)-direction*43;
    if(Math.abs(to-from)<8)return;
    const n=uiNode(this.fx,'SpearTrace');const g=n.addComponent(Graphics);
    g.strokeColor=new Color(241,221,172,205);g.lineWidth=2.5;
    g.moveTo(from,laneY(attacker.lane)+91);g.lineTo(to,laneY(target.lane)+91);g.stroke();
    const opacity=n.addComponent(UIOpacity);
    tween(opacity).to(.18/this.speed,{opacity:0}).call(()=>n.destroy()).start();
  }
  private ripple(x:number,y:number,color:Color):void{
    const n=uiNode(this.fx,'TacticalPulse',x,y);const g=n.addComponent(Graphics);g.strokeColor=color;g.lineWidth=2;g.ellipse(0,0,39,15);g.stroke();const opacity=n.addComponent(UIOpacity);
    tween(n).to(.55/this.speed,{scale:new Vec3(1.7,1.7,1)}).call(()=>n.destroy()).start();tween(opacity).to(.55/this.speed,{opacity:0}).start();
  }
  private slash(x:number,y:number):void{
    const n=uiNode(this.fx,'AttackFlash',x,y);const g=n.addComponent(Graphics);g.strokeColor=new Color(255,221,156);g.lineWidth=4;g.moveTo(-32,-18);g.quadraticCurveTo(0,38,38,28);g.stroke();const opacity=n.addComponent(UIOpacity);tween(opacity).to(.32/this.speed,{opacity:0}).call(()=>n.destroy()).start();
  }
  private announce(text:string):void{
    const n=artwork(this.fx,'Announcement',this.frames.get('ui/battle/battle-hint-crop')!,0,295,870,80);label(n,'Message',text,0,0,800,43,23,C.gold);const opacity=n.addComponent(UIOpacity);tween(opacity).delay(2).to(.4,{opacity:0}).call(()=>n.destroy()).start();
  }
  private advance():void{
    if(this.busy||this.paused||this.state.status!=='playing')return;
    if(this.state.activeSide==='enemy'||this.auto)this.later(()=>{
      if(this.busy||this.paused||this.state.status!=='playing')return;
      if(this.state.activeSide==='player'&&!this.auto)return;
      this.submit(this.chooseAction(this.state.activeSide));
    },380/this.speed);
  }
  private chooseAction(side:'player'|'enemy'):BattleSessionAction{
    const s=this.state;const available=s.hands[side].filter(c=>c.remainingPreparation===0);
    const units=available.filter(c=>this.config.cards.find(d=>d.id===c.cardId)?.cardType==='UNIT'&&(side==='player'||this.strategy.unitIds.includes(c.cardId)));
    for(const card of units){
      const lanes=Array.from({length:s.laneCount},(_,lane)=>lane).sort((a,b)=>{
        const pressure=(lane:number)=>s.units.filter(u=>u.lane===lane).reduce((sum,u)=>sum+(u.side===side?-1:1)*(u.attack*2+u.hp),0);
        return pressure(b)-pressure(a);
      });
      const definition=this.config.units.find(u=>u.id===card.cardId);const cells=side==='player'?(definition&&definition.range>1?[0,1,2]:[2,1,0]):[9,10,11];
      for(const lane of lanes)for(const cell of cells)if(!s.units.some(u=>u.lane===lane&&u.cell===cell))return{type:'DEPLOY_UNIT',cardId:card.cardId,side,lane,cell};
    }
    for(const card of available){
      const skill=this.config.skills.find(k=>k.id===card.cardId);if(!skill||(side==='enemy'&&!this.strategy.skillRules.some(r=>r.skillId===card.cardId)))continue;
      const ally=s.units.filter(u=>u.side===side).sort((a,b)=>(b.maxHp-b.hp)-(a.maxHp-a.hp))[0];if(!ally)continue;
      if(card.cardId==='S006'&&ally.statuses.some(status=>status.kind==='BARRIER'))continue;
      return{type:'PLAY_CARD',cardId:card.cardId,side,target:skill.targetType==='ALLY_UNIT'?{kind:'unit',unitId:ally.id}:{kind:'lane',lane:ally.lane}};
    }
    return{type:'END_TURN'};
  }
  private dialog(title:string,subtitle:string,w=860,h=520):Node{
    this.paused=true;this.clear(this.modal);const shade=panel(this.modal,'ModalShade',0,0,1920,1080,new Color(2,9,11,207),undefined,0);shade.on(Node.EventType.TOUCH_END,()=>undefined);
    const box=artwork(this.modal,'Dialog',this.frames.get('ui/components/jade-panel')!,0,0,w,h);
    label(box,'Title',title,0,h/2-69,w-95,69,40,C.gold);label(box,'Subtitle',subtitle,0,h/2-120,w-80,35,20,C.muted);ruleLine(box,0,h/2-154,w-100);return box;
  }
  private closeDialog():void{this.clear(this.modal);this.paused=false;this.render();this.advance();}
  private showBriefing():void{
    const box=this.dialog('押册出垣','第一章 · 空册入世',990,615);
    artwork(box,'BriefingPortrait',this.frames.get('a0/commanders/C009-BATTLE-SIDESLOT')!,-352,-40,175,417);
    label(box,'Story','山道上，失控役兵挡住了押运队。\n岳沉戈命你接掌前营，先建立阵线，护住封匣。',125,90,610,108,26);
    label(box,'Goals','胜利目标　击破敌方主将\n部署规则　准备归零后，放入我方召唤格\n行动规则　结束回合后，单位自动推进与攻击\n战场变化　首次部署后开放第二条路线',130,-60,620,183,23,C.bone,HorizontalTextAlignment.LEFT);
    this.jadeButton(box,'Begin','建立阵线',130,-232,330,64,()=>{this.sound('button_activate');this.closeDialog();});
  }
  private showHelp():void{
    const box=this.dialog('战场指引','布阵 · 阻挡 · 推进',900,610);
    label(box,'Help','① 准备：卡牌左上角数字归零后才能使用。\n② 部署：先选卡，再点左侧亮起的召唤格。\n③ 交战：结束回合，单位按位置自动移动和攻击。\n④ 军令：选择技能卡，再点我方单位或所在路线。\n⑤ 胜负：主将生命归零时结算；退出不会获得奖励。\n\n每次进入消耗 6 体力；刷新会恢复当前战局。',0,-7,775,300,24,C.bone,HorizontalTextAlignment.LEFT);
    this.jadeButton(box,'HelpClose','返回战场',0,-241,310,59,()=>this.closeDialog());
  }
  private showPause():void{
    const box=this.dialog('战斗菜单','当前战局已保存',690,580);
    this.jadeButton(box,'ContinueBattle','继续战斗',0,45,340,64,()=>this.closeDialog());
    this.quietButton(box,'BattleHelp','玩法说明',0,-40,340,55,()=>this.showHelp());
    this.quietButton(box,'AudioToggle',this.muted?'开启音效':'关闭音效',0,-125,340,55,()=>{this.muted=!this.muted;this.showPause();});
    this.quietButton(box,'LeaveBattle','退出并返回主城',0,-210,340,55,()=>this.confirmExit());
  }
  private confirmExit():void{
    if(this.state.status!=='playing'){this.returnHandler();return;}
    const box=this.dialog('退出本次战斗？','战斗结束后可重新挑战',760,440);
    label(box,'ExitBody','退出不会获得通关奖励，已消耗的体力不退还。\n如果只是暂时离开，可以保留页面，之后继续战局。',0,-12,650,96,23);
    this.jadeButton(box,'CancelExit','继续作战',-169,-142,265,61,()=>this.closeDialog());
    button(box,'ConfirmExit','确认退出',169,-142,265,61,()=>{this.paused=false;this.returnHandler();});
  }
  private showResult():void{
    if(this.modal.children.some(n=>n.name==='ResultShown'))return;
    const s=this.state;const won=s.status==='won';this.sound('settlement_reveal');
    const box=this.dialog(won?'战斗胜利':s.status==='lost'?'战斗失利':'战斗结束','1-1 · 押册出垣',990,710);box.name='ResultShown';
    label(box,'ResultStory',won?'敌兵甲牌上的姓名尚在，他们却已说不出自己的名字。\n晏归低声提醒：名册正在先于现实改写活人。':'前营暂时失守。调整部署位置，利用守卫保护远射单位，\n待军契准备完成后，再次建立阵线。',0,122,850,105,25);
    label(box,'ResultStats',`${s.round} 回合　 ·　 我方主将 ${s.heroHp.player}/${s.heroMaxHp.player}　 ·　 ${s.graveyards.enemy.length} 张敌方卡牌进入墓地`,0,39,870,40,20,C.muted);
    if(won){
      label(box,'RewardsHeading','通关奖励已保存',0,-26,630,35,23,C.gold);
      const reward=this.level.rewards[0];artwork(box,'RewardCard',this.frames.get(`demo/cards/${reward.id}`)!,-100,-143,98,147);
      label(box,'RewardValue',`${this.name(reward.id)}\n× ${reward.quantity}`,65,-141,245,93,28);
    }else label(box,'NoReward','本次无通关奖励',0,-108,600,64,27,C.muted);
    this.jadeButton(box,'ReturnHome','返回主城',-186,-282,310,64,()=>this.returnHandler());
    button(box,'Replay','再次挑战',186,-282,310,64,()=>{try{this.enter(true);}catch(e){label(box,'RetryError',e instanceof Error?e.message:'重新进入失败',0,-226,850,35,20,C.red);}});
  }
  private showGraveyard():void{
    const s=this.state;const box=this.dialog('战场墓地',`我方 ${s.graveyards.player.length} 张 · 敌方 ${s.graveyards.enemy.length} 张`,880,610);
    label(box,'GraveyardText','我方\n'+(s.graveyards.player.map(id=>this.name(id)).join('、')||'暂无')+'\n\n敌方\n'+(s.graveyards.enemy.map(id=>this.name(id)).join('、')||'暂无'),0,-10,760,285,22,C.bone,HorizontalTextAlignment.LEFT);
    this.jadeButton(box,'GraveyardClose','返回战场',0,-242,310,60,()=>this.closeDialog());
  }
  private showLog():void{
    const box=this.dialog('本局战报','最近发生的战斗事件',930,720);
    label(box,'Log',this.combatLog.slice(-13).join('\n')||'尚未发生战斗，选择卡牌开始布阵。',0,-21,805,420,21,C.bone,HorizontalTextAlignment.LEFT);
    this.jadeButton(box,'LogClose','返回战场',0,-301,310,58,()=>this.closeDialog());
  }
  destroy():void{this.cancel();}
}
