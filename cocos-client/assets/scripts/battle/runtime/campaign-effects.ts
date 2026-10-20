import type { Unit, Side, BattleState } from '../../core/types/index.ts';
import type { HighLevelAction } from './battle-core.ts';

export interface CampaignSkillEffect { readonly cardId:string; readonly kind:'ATTACK_BUFF'|'ARMOR_BUFF'|'BARRIER'; readonly value:number; readonly duration:number; readonly statusId:string; }
function record(value:unknown):value is Record<string,unknown>{ return !!value && typeof value==='object' && !Array.isArray(value); }
/** D001's three skills use explicit IDs from the card design table, with all values read from effects.json. */
export function campaignEffects(config:unknown):readonly CampaignSkillEffect[]{
  if(!record(config)||!Array.isArray(config.skills)||!Array.isArray(config.effects))throw new Error('campaign skill/effect configuration missing');
  const skills=config.skills, effects=config.effects;
  const kinds = {S004:'ATTACK_BUFF',S006:'BARRIER',S014:'ARMOR_BUFF'} as const;
  return Object.entries(kinds).map(([cardId,kind])=>{
    const skill=skills.find((row:unknown)=>record(row)&&row.id===cardId);
    if(!record(skill)||!Array.isArray(skill.effectIds)||skill.effectIds.length!==1)throw new Error(`unsupported campaign skill ${cardId}`);
    const effectId=skill.effectIds[0];
    const effect=effects.find((row:unknown)=>record(row)&&row.id===effectId);
    if(!record(effect)||effect.enabled===false||effect.effectType!=='STATUS'||typeof effect.statusId!=='string'
      ||typeof effect.value!=='number'||!Number.isSafeInteger(effect.value)||effect.value<0
      ||typeof effect.durationRounds!=='number'||!Number.isSafeInteger(effect.durationRounds)||effect.durationRounds<0)throw new Error(`invalid campaign effect ${cardId}`);
    return Object.freeze({cardId,kind,value:effect.value,duration:effect.durationRounds,statusId:effect.statusId});
  });
}
export function applyCampaignSkill(state:BattleState,action:Extract<HighLevelAction,{type:'PLAY_CARD'}>,effects:readonly CampaignSkillEffect[]):Partial<BattleState>{
  const effect=effects.find(e=>e.cardId===action.cardId);
  if(!effect)throw new Error(`campaign skill effect unsupported: ${action.cardId}`);
  const target=action.target;
  const targets=state.units.filter(u=>u.side===action.side && (target.kind==='lane'?u.lane===target.lane:target.kind==='unit'&&u.id===target.unitId));
  if(!targets.length)throw new Error('skill has no legal target');
  const units=state.units.map(unit=>{
    if(!targets.some(t=>t.id===unit.id))return unit;
    const previous=unit.statuses.find(s=>s.kind===effect.kind);
    const delta=effect.value-(previous?.value??0);
    return {...unit,attack:unit.attack+(effect.kind==='ATTACK_BUFF'?delta:0),armor:unit.armor+(effect.kind==='ARMOR_BUFF'?delta:0),
      statuses:[...unit.statuses.filter(s=>s.kind!==effect.kind),{id:effect.statusId,kind:effect.kind,stacks:1,value:effect.value,
        ...(effect.duration>0?{remainingRounds:Math.max(previous?.remainingRounds??0,effect.duration)}:{})}]};
  });
  const hand=[...state.hands[action.side]];
  const index=hand.findIndex(c=>c.cardId===action.cardId&&c.remainingPreparation===0);
  if(index<0)throw new Error('skill is not ready');
  hand.splice(index,1);
  return {units,hands:{...state.hands,[action.side]:hand},graveyards:{...state.graveyards,[action.side]:[...state.graveyards[action.side],action.cardId]}};
}
export function expireCampaignBuffs(units:readonly Unit[],side:Side):readonly Unit[]{
  return units.map(unit=>{
    if(unit.side!==side)return unit;
    let attack=unit.attack,armor=unit.armor;
    const statuses=unit.statuses.flatMap(s=>{
      if(s.remainingRounds===undefined)return [s];
      if(s.remainingRounds>1)return [{...s,remainingRounds:s.remainingRounds-1}];
      if(s.kind==='ATTACK_BUFF')attack-=s.value??0;
      if(s.kind==='ARMOR_BUFF')armor-=s.value??0;
      return [];
    });
    return {...unit,attack,armor,statuses};
  });
}
