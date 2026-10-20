import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCampaignCore } from '../assets/scripts/battle/runtime/browser-battle-core.ts';
import { CampaignSession } from '../assets/scripts/battle/campaign/CampaignSession.ts';
const config=Object.fromEntries(['cards','skills','units','professions','decks','effects'].map(k=>[k,JSON.parse(fs.readFileSync(new URL(`../assets/resources/config/${k}.json`,import.meta.url)))[k]]));
config.strategies=JSON.parse(fs.readFileSync(new URL('../assets/resources/config/enemy/strategies.json',import.meta.url))).strategies;
const level=JSON.parse(fs.readFileSync(new URL('../assets/resources/config/levels/chapter01/L01.json',import.meta.url))).chapterLevels[0];
const values=new Map();let fail=false;const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('quota');values.set(k,v);}};
const session=new CampaignSession(config,level,storage);const before=session.game.resources.stamina;
fail=true;assert.throws(()=>session.start('one',0,'D001'));assert.equal(session.game.resources.stamina,before);
fail=false;session.start('one',0,'D001');assert.equal(session.game.resources.stamina,before-6);
session.start('one',0,'D001');assert.equal(session.game.resources.stamina,before-6);
const saved=JSON.stringify(session.snapshot);
fail=true;assert.throws(()=>session.command('one',0,{type:'END_TURN'}));assert.equal(JSON.stringify(session.snapshot),saved);
fail=false;session.command('one',0,{type:'END_TURN'});
assert.throws(()=>session.command('one',0,{type:'END_TURN'}));
const restored=new CampaignSession(config,level,storage);assert.deepEqual(restored.snapshot,session.snapshot);
assert.equal(restored.game.resources.stamina,before-6);
restored.exit('one');assert.equal(restored.record.phase,'exited');
assert.throws(()=>restored.command('one',1,{type:'END_TURN'}));
restored.start('two',1,'D001');assert.equal(restored.game.resources.stamina,before-12);
const raw=[...values];const changed=structuredClone(config);changed.units[0].attack++;
assert.throws(()=>new CampaignSession(changed,level,storage),/configuration/);assert.deepEqual([...values],raw);
console.log('Campaign session atomic entry/commands, duplicate rejection, replay, exit and config mismatch PASS');
// Both outcomes must be earned by commands; settlement failure must be retriable.
for(const aggressive of [false,true]){
 const mem=new Map();let blocked=false;const store={getItem:k=>mem.get(k)??null,setItem:(k,v)=>{if(blocked)throw Error('quota');mem.set(k,v);}};
 let game=new CampaignSession(config,level,store);const copiesBefore=game.game.cards.find(c=>c.id==='U001').copies;game.start('outcome',3,'D001');
 const engine=createCampaignCore(config,level,{deckId:'D001'});let testedSettlementFailure=false;
 for(let i=0;i<300 && game.record.phase==='active';i++){
  const s=game.snapshot.state;let action={type:'END_TURN'};
  if(s.activeSide==='enemy'||aggressive){
   for(const card of s.hands[s.activeSide]){
    if(card.remainingPreparation||config.cards.find(c=>c.id===card.cardId).cardType!=='UNIT')continue;
    const strategy=JSON.parse(fs.readFileSync(new URL('../assets/resources/config/enemy/strategies.json',import.meta.url))).strategies.find(s=>s.levelId==='L01');
    if(s.activeSide==='enemy'&&!strategy.unitIds.includes(card.cardId))continue;
    const cells=Array.from({length:s.laneCount},(_,lane)=>Array.from({length:3},(_,i)=>({lane,cell:s.activeSide==='player'?i:11-i}))).flat();
    const free=cells.find(p=>!s.units.some(u=>u.lane===p.lane&&u.cell===p.cell));
    if(free){action={type:'DEPLOY_UNIT',cardId:card.cardId,side:s.activeSide,...free};break;}
   }
  }
  const wouldFinish=engine.run(3,[...game.record.actions,action]).finalState.status!=='playing';
  if(wouldFinish){
   const unchanged=[...mem];const sequence=game.record.commandCount;blocked=true;
   assert.throws(()=>game.command('outcome',sequence,action),/PERSIST_FAILED/);
   assert.equal(game.record.phase,'active');assert.equal(game.record.commandCount,sequence);assert.deepEqual([...mem],unchanged);
   blocked=false;testedSettlementFailure=true;
  }
  game.command('outcome',game.record.commandCount,action);
 }
 assert.equal(game.record.phase,'settled');assert(testedSettlementFailure);
 const final=game.snapshot.state.status;assert.equal(final,aggressive?'won':'lost');
 const balance=game.game.cards.find(c=>c.id==='U001').copies;assert.equal(balance,copiesBefore+(aggressive?level.rewards[0].quantity:0));
 const recovered=new CampaignSession(config,level,store);
 assert.equal(recovered.game.cards.find(c=>c.id==='U001').copies,balance);
 assert.throws(()=>recovered.command('outcome',recovered.record.commandCount,{type:'END_TURN'}));
 recovered.exit('outcome');const dismissed=new CampaignSession(config,level,store);assert.equal(dismissed.record.resultDismissed,true);assert.equal(dismissed.game.cards.find(c=>c.id==='U001').copies,balance);
 console.log(`Campaign earned ${final}, failed settlement retry, exact reward, result restoration and dismissal PASS`);
}
