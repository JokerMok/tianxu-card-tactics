import { createCampaignCore } from '../runtime/browser-battle-core.ts';
import { BattleSessionController, type BattleSessionAction } from '../session-controller.ts';
import { BattleResultTransactionService, createBattleResultState } from '../../services/BattleResultTransactionService.ts';
import { createDefaultState, type GameState } from '../../meta/GameState.ts';

export const CAMPAIGN_SAVE_KEY='tianxu.pve.save.v2';
export const LEGACY_SAVE_KEY='tianxu.pve.save.v1';
export interface SaveStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;}
export interface CampaignRecord {
  id:string;configVersion:string;levelId:'L01';deckId:string;deck:readonly string[];seed:number;
  actions:readonly BattleSessionAction[];commandCount:number;phase:'active'|'settled'|'exited';finalHash:string;resultDismissed?:boolean;
}
export interface CampaignEnvelope {version:2;game:GameState;campaign?:CampaignRecord;}
const copy=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
export function parseGame(value:unknown):GameState {
  if(!value||typeof value!=='object')throw new Error('存档损坏，已保留原记录');
  const game=value as GameState;
  if(game.version!==1||!game.resources||!game.player||!Array.isArray(game.cards)||!Array.isArray(game.deck)||!game.campaign||!Array.isArray(game.transactions))throw new Error('存档版本或内容无效，已保留原记录');
  if(Object.values(game.resources).some(n=>!Number.isSafeInteger(n)||n<0)||game.cards.some(c=>typeof c.id!=='string'||!Number.isSafeInteger(c.copies)||c.copies<0))throw new Error('存档资源无效，已保留原记录');
  return copy(game);
}
export function readCampaignEnvelope(storage:SaveStorage):CampaignEnvelope {
  const raw=storage.getItem(CAMPAIGN_SAVE_KEY);
  if(raw!==null){const envelope=JSON.parse(raw) as CampaignEnvelope;if(envelope.version!==2)throw new Error('存档版本不兼容，已保留原记录');return {...envelope,game:parseGame(envelope.game)};}
  const legacy=storage.getItem(LEGACY_SAVE_KEY);
  return {version:2,game:legacy===null?createDefaultState():parseGame(JSON.parse(legacy))};
}
export class CampaignSession {
  private envelope:CampaignEnvelope;
  private cachedController?:BattleSessionController;
  private expectedRaw:string|null;
  private readonly config:unknown;
  private readonly level:unknown;
  private readonly storage:SaveStorage;
  private readonly configVersion:string;
  constructor(config:unknown,level:unknown,storage:SaveStorage){
    this.config=copy(config);this.level=copy(level);this.storage=storage;
    this.configVersion=JSON.stringify({config:this.config,level:this.level});
    this.envelope=readCampaignEnvelope(storage);this.expectedRaw=storage.getItem(CAMPAIGN_SAVE_KEY);
    if(this.envelope.campaign){
      const record=this.envelope.campaign;
      if(record.configVersion!==this.configVersion){
        if(record.phase==='active')throw new Error('configuration changed，恢复已暂停，原存档保留');
        // Completed/abandoned sessions may start a new battle after an update.
        // Reading does not rewrite their saved record or rewards.
        return;
      }
      if(!record.id||record.levelId!=='L01'||!['active','settled','exited'].includes(record.phase)||!Number.isSafeInteger(record.commandCount)||record.commandCount<0)throw new Error('会话存档无效');
      const controller=this.replay(record);
      if(controller.snapshot.finalHash!==record.finalHash)throw new Error('会话重放不一致，原存档保留');
      if((record.phase==='active'&&controller.state.status!=='playing')||(record.phase==='settled'&&controller.state.status==='playing'))throw new Error('会话生命周期无效');
      this.cachedController=controller;
    }
  }
  get game():GameState{return copy(this.envelope.game);}
  get record():CampaignRecord|undefined{return this.envelope.campaign&&copy(this.envelope.campaign);}
  get snapshot(){
    if(!this.envelope.campaign||this.envelope.campaign.configVersion!==this.configVersion)return undefined;
    this.cachedController??=this.replay(this.envelope.campaign);return this.cachedController.snapshot;
  }
  private replay(record:CampaignRecord):BattleSessionController{
    const core=createCampaignCore(this.config,this.level,{deckId:record.deckId});
    if(JSON.stringify(core.deck)!==JSON.stringify(record.deck))throw new Error('会话卡组不一致');
    const controller=new BattleSessionController({seed:record.seed,engine:{run:(seed,actions)=>core.run(seed,actions)}});
    if(!Array.isArray(record.actions)||record.actions[0]?.type!=='BATTLE_START')throw new Error('会话命令损坏');
    controller.start();for(const action of record.actions.slice(1))controller.dispatch(action);
    if(record.phase==='exited')controller.end();
    return controller;
  }
  private persist(next:CampaignEnvelope):void{
    if(this.storage.getItem(CAMPAIGN_SAVE_KEY)!==this.expectedRaw)throw new Error('存档已在其他窗口更新，请重新加载');
    const old=this.storage.getItem(LEGACY_SAVE_KEY);
    if(this.expectedRaw===null&&old!==null&&this.storage.getItem(`${LEGACY_SAVE_KEY}.pre-v2`)===null)this.storage.setItem(`${LEGACY_SAVE_KEY}.pre-v2`,old);
    const raw=JSON.stringify(next);this.storage.setItem(CAMPAIGN_SAVE_KEY,raw);
    this.expectedRaw=raw;this.envelope=next;this.cachedController=undefined;
  }
  start(id:string,seed:number,deckId:string):void{
    if(!id||!Number.isSafeInteger(seed))throw new Error('会话编号或种子无效');
    if(this.envelope.game.transactions.includes(`entry:${id}`)){if(this.envelope.campaign?.id===id)return;throw new Error('会话编号已使用');}
    if(this.envelope.campaign?.phase==='active')throw new Error('请先完成或退出当前战斗');
    const core=createCampaignCore(this.config,this.level,{deckId});
    const output=core.run(seed,[{type:'BATTLE_START'}]);
    const game=this.game;
    const transaction=new BattleResultTransactionService(createBattleResultState({...game.resources}),next=>{
      game.resources.stamina=next.resources.stamina;game.transactions.push(`entry:${id}`);
      this.persist({version:2,game,campaign:{id,seed,deckId,deck:[...core.deck],configVersion:this.configVersion,levelId:'L01',actions:[{type:'BATTLE_START'}],commandCount:0,phase:'active',finalHash:output.finalHash}});
    });
    const result=transaction.settle({businessKey:`entry:${id}`,nodeId:'L01',cost:{stamina:6},outcome:'entered',reward:{},progress:{clearedNodes:[],unlockedNodes:[]}});
    if(!result.accepted)throw new Error(`进入战斗失败：${result.code}`);
  }
  command(id:string,sequence:number,action:BattleSessionAction):void{
    const record=this.record;
    if(!record||record.id!==id||record.phase!=='active'||record.commandCount!==sequence)throw new Error('无效或重复战斗命令');
    const controller=this.replay(record);controller.dispatch(action);
    const next={...record,actions:controller.snapshot.actions,commandCount:sequence+1,finalHash:controller.snapshot.finalHash};
    if(controller.state.status==='playing'){this.persist({...this.envelope,campaign:next});return;}
    this.finish(next,controller.state.status==='won');
  }
  exit(id:string):void{
    const record=this.record;if(!record||record.id!==id)throw new Error('无效战斗编号');
    if(record.phase==='settled'){if(!record.resultDismissed)this.persist({...this.envelope,campaign:{...record,resultDismissed:true}});return;}
    if(record.phase!=='active')return;
    this.persist({...this.envelope,campaign:{...record,phase:'exited'}});
  }
  private finish(record:CampaignRecord,won:boolean):void{
    const game=this.game;
    const key=`result:${record.id}`;if(game.transactions.includes(key))throw new Error('战斗结果已提交');
    const transaction=new BattleResultTransactionService(createBattleResultState({...game.resources}),()=>{
      if(won){
        // Rewards are sourced from the selected authoritative level, not an external result flag.
        const level=this.level as {rewards:readonly {type:string;id:string;quantity:number}[]};
        for(const reward of level.rewards){
          if(reward.type!=='CARD'||!Number.isSafeInteger(reward.quantity)||reward.quantity<1)throw new Error('不支持的关卡奖励');
          const card=game.cards.find(c=>c.id===reward.id);if(!card)throw new Error('奖励卡牌不在收藏配置中');card.copies+=reward.quantity;
        }
        game.campaign.stars['1']=Math.max(game.campaign.stars['1']??0,3);
        game.campaign.unlocked=Math.max(game.campaign.unlocked,2);
      }
      game.transactions.push(key);this.persist({version:2,game,campaign:{...record,phase:'settled'}});
    });
    const result=transaction.settle({businessKey:key,nodeId:'L01',cost:{},outcome:won?'won':'lost',reward:{},progress:{clearedNodes:won?['L01']:[],unlockedNodes:won?['L02']:[]}});
    if(!result.accepted)throw new Error(`保存结算失败：${result.code}`);
  }
}
