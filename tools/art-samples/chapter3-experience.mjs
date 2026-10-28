/** Bounded replay of eight existing chapter-two snapshots. No database mutation,
 * altered seed/enemy/deck, or claim that counterfactual play occurred in Cocos. */
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {ServerContent} from '../../backend/game/content.mjs';
import {createBattle,applyBattleAction,advanceAI,legalPlays} from '../../cocos-client/assets/scripts/game/BattleKernel.ts';
const root=process.cwd(),db=new DatabaseSync(root+'/.local/chapter2-normal/game.sqlite',{readOnly:true});
const world=JSON.parse(db.prepare('SELECT json FROM game_world WHERE id=1').get().json);db.close();
const actor=JSON.parse(readFileSync(root+'/.local/chapter3-normal/initial-state.json')).actor.id;
const c=new ServerContent(root+'/cocos-client/assets/resources/recovered/');
const records=[];
for(const battle of Object.values(world.battles).filter(b=>b.participants.includes(actor)&&b.level?.sceneId==='main:scene:2')){
 const outcomes=[];
 for(const policy of ['first-legal','forward-distributed']){
  let s=advanceAI(c,structuredClone(battle.entryState)),commands=0;
  for(;s.status!=='settled'&&commands<180;commands++){
   const choices=legalPlays(c,s,actor);let chosen=choices[0];
   if(policy==='forward-distributed'&&choices.length){
    // Same card priority; choose only among legal placements of that card.
    const options=choices.filter(x=>x.instanceId===choices[0].instanceId);
    chosen=options.toSorted((a,b)=>{
      if(a.targetId||b.targetId){const ua=s.units.find(u=>u.id===a.targetId),ub=s.units.find(u=>u.id===b.targetId);return (ua?.col??20)-(ub?.col??20)||(ub?.attack??0)-(ua?.attack??0);}
      const rowCount=x=>s.units.filter(u=>u.playerId===actor&&!u.flags.hero&&u.row===x.row).length;
      return (b.col??0)-(a.col??0)||rowCount(a)-rowCount(b)||(b.row??0)-(a.row??0);
    })[0];
   }
   s=advanceAI(c,applyBattleAction(c,s,actor,chosen?{type:'play',...chosen}:{type:'end'}));
  }
  const damage=s.events.filter(e=>e.type==='damage'&&e.target?.startsWith('hero:')&&e.targetView?.team===1);
  outcomes.push({policy,status:s.status,winner:s.winner,turn:s.turn,commands,enemyHeroCombatDamage:damage.filter(e=>e.message!=='fatigue').reduce((v,e)=>v+(e.effectiveAmount??e.amount),0),moves:s.events.filter(e=>e.type==='move').length,attacks:s.events.filter(e=>e.type==='attack').length,enemyHeroFatigueDamage:damage.filter(e=>e.message==='fatigue').reduce((v,e)=>v+(e.effectiveAmount??e.amount),0)});
 }
 records.push({id:battle.id,node:battle.level.nodeId,source:'same historical entryState, no reseed or asset changes',outcomes});
}
mkdirSync(root+'/documentation/chapter3-normal/evidence',{recursive:true});
writeFileSync(root+'/documentation/chapter3-normal/evidence/strategy-counterfactual.json',JSON.stringify({scope:'Offline bounded counterfactual, not actual player progression or browser evidence. One heuristic is not optimal manual play or a win-rate estimate.',records},null,2)+'\n');
console.log(JSON.stringify(records.map(r=>({node:r.node.split(':').at(-1),outcomes:r.outcomes})),null,1));

// A single failed third-chapter entry, replayed with the actual saved reward deck.
// This is a causal aid only; the real retries used different random encounters.
const currentDB=new DatabaseSync(root+'/.local/chapter3-normal/game.sqlite',{readOnly:true});
const current=JSON.parse(currentDB.prepare('SELECT json FROM game_world WHERE id=1').get().json);currentDB.close();
const failed=Object.values(current.battles).find(b=>b.participants.includes(actor)&&b.level?.nodeId==='main:scene:3:node:302'&&b.rewards?.[actor]?.won===false);
if(failed){
 const saved=current.characters[actor],results=[];
 for(const deck of [failed.entryState.players.find(p=>p.id===actor).deck,saved.deck]){
  c.validateDeck(saved,deck);
  const spec={id:failed.id,seed:failed.entryState.seed,mapId:failed.entryState.mapId,rows:failed.entryState.rows,firstPlayer:failed.entryState.activePlayer,players:failed.entryState.players.map(p=>p.id===actor?{...p,deck}:p)};
  let state=advanceAI(c,createBattle(c,spec)),commands=0;
  while(state.status!=='settled'&&commands++<180){const play=legalPlays(c,state,actor)[0];state=advanceAI(c,applyBattleAction(c,state,actor,play?{type:'play',...play}:{type:'end'}));}
  results.push({deck:[...deck],turn:state.turn,winner:state.winner,playerHp:state.players.find(p=>p.id===actor).hp,firstPlayerFatigueTurn:state.events.find(e=>e.type==='damage'&&e.message==='fatigue'&&e.target==='hero:'+actor)?.targetView?.flags?.lastHitTurn??null});
 }
 writeFileSync(root+'/documentation/chapter3-normal/evidence/deck-counterfactual.json',JSON.stringify({scope:'Two bounded offline runs from failed 302 seed; same enemy decks and actor stats; deck size also changes shuffle order. Not actual progression, not proof of general win rate.',id:failed.id,results},null,2)+'\n');console.log('302 deck comparison',JSON.stringify(results));
}
