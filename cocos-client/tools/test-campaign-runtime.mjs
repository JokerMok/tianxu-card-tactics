import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCampaignCore } from '../assets/scripts/battle/runtime/browser-battle-core.ts';
const config = Object.fromEntries(['cards','skills','units','professions','decks','effects'].map(k => [k, JSON.parse(fs.readFileSync(new URL(`../assets/resources/config/${k}.json`, import.meta.url)))[k]]));
const level = JSON.parse(fs.readFileSync(new URL('../assets/resources/config/levels/chapter01/L01.json', import.meta.url))).chapterLevels[0];
const core = createCampaignCore(config, level, {deckId:'D001'});
const actions = [{type:'BATTLE_START'}];
let state = core.run(0, actions).finalState;
assert.equal(state.laneCount, 1);
assert.equal(state.heroHp.player, level.scenarioRules.playerHeroHp);
assert(state.hands.player.every(c=>config.cards.find(r=>r.id===c.cardId).cardType==='UNIT'));
assert(state.hands.enemy.every(c=>config.cards.find(r=>r.id===c.cardId).cardType==='UNIT'));
const side=state.activeSide;
const unready=state.hands[side].find(c=>c.remainingPreparation>0);
assert(unready);
assert.throws(()=>core.run(0,[...actions,{type:'DEPLOY_UNIT',cardId:unready.cardId,side,lane:0,cell:side==='player'?0:11}]),/ready/);
while(!state.hands[state.activeSide].some(c=>c.remainingPreparation===0 && config.cards.find(r=>r.id===c.cardId).cardType==='UNIT')){
 actions.push({type:'END_TURN'}); state=core.run(0,actions).finalState;
}
const ready=state.hands[state.activeSide].find(c=>c.remainingPreparation===0 && config.cards.find(r=>r.id===c.cardId).cardType==='UNIT');
const deploy={type:'DEPLOY_UNIT',cardId:ready.cardId,side:state.activeSide,lane:0,cell:state.activeSide==='player'?0:11};
assert.throws(()=>core.run(0,[...actions,{...deploy,lane:1}]),/lane/);
actions.push(deploy);state=core.run(0,actions).finalState;
assert.equal(state.laneCount,2);
const unit=state.units[0];
actions.push({type:'END_TURN'});state=core.run(0,actions).finalState;
assert(state.units.find(u=>u.id===unit.id).cell!==unit.cell,'end turn advances units');
assert.deepEqual(core.run(0,actions),core.run(0,actions));
assert.throws(()=>createCampaignCore(config,{...level,id:'L02'}),/L01/);
console.log('Campaign runtime opening, preparation, lanes, automatic turn and replay PASS');
// Effects must consume the actual card and use configuration values, not display-only events.
const effectsCore=createCampaignCore(config,level,{deckId:'D001'});
const skillActions=[{type:'BATTLE_START'}];let cast=false;
for(let step=0;step<100&&!cast;step++){
 const s=effectsCore.run(3,skillActions).finalState;
 const skill=s.hands[s.activeSide].find(c=>c.remainingPreparation===0&&['S004','S006','S014'].includes(c.cardId));
 const ally=s.units.find(u=>u.side===s.activeSide);
 if(skill&&ally){
  const definition=config.skills.find(c=>c.id===skill.cardId);
  const effect=config.effects.find(e=>e.id===definition.effectIds[0]);
  const target=definition.targetType==='ALLY_UNIT'?{kind:'unit',unitId:ally.id}:{kind:'lane',lane:ally.lane};
  const after=effectsCore.run(3,[...skillActions,{type:'PLAY_CARD',cardId:skill.cardId,side:s.activeSide,target}]).finalState;
  assert.equal(after.hands[s.activeSide].length,s.hands[s.activeSide].length-1);
  const modified=after.units.find(u=>u.id===ally.id);
  assert(modified.statuses.some(status=>status.id===effect.statusId&&status.value===effect.value));
  assert(after.graveyards[s.activeSide].includes(skill.cardId));cast=true;break;
 }
 const card=s.hands[s.activeSide].find(c=>c.remainingPreparation===0&&config.cards.find(r=>r.id===c.cardId).cardType==='UNIT');
 const cell=s.activeSide==='player'?0:11;
 if(card&&!s.units.some(u=>u.lane===0&&u.cell===cell))skillActions.push({type:'DEPLOY_UNIT',cardId:card.cardId,side:s.activeSide,lane:0,cell});
 else skillActions.push({type:'END_TURN'});
}
assert(cast,'a legal campaign skill must resolve');
console.log('Campaign configured skill consumption and status effect PASS');

// Enemy opening may reorder cards, never add/remove cards or alter player RNG.
const strategies=JSON.parse(fs.readFileSync(new URL('../assets/resources/config/enemy/strategies.json',import.meta.url))).strategies;
const configuredCore=createCampaignCore({...config,strategies},level,{deckId:'D001'});
for(const seed of [0,3,17,20260712]){
 const original=core.run(seed,[{type:'BATTLE_START'}]).finalState;
 const opening=configuredCore.run(seed,[{type:'BATTLE_START'}]).finalState;
 assert(opening.hands.enemy.some(c=>c.cardId==='U001'));
 assert.deepEqual(opening.hands.player,original.hands.player);
 assert.deepEqual([...opening.hands.enemy.map(c=>c.cardId),...opening.decks.enemy].sort(),[...original.hands.enemy.map(c=>c.cardId),...original.decks.enemy].sort());
 assert.equal(opening.rngState,original.rngState);
}
console.log('L01 playable enemy opening; unchanged card quantities, player opening and RNG PASS');
