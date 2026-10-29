/** Bounded authoritative-kernel counterfactuals, not browser play or progression. */
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {ServerContent} from '../../backend/game/content.mjs';
import {PVE_TACTICS} from '../../backend/game/pve-experience.mjs';
import {GameService} from '../../backend/game/service.mjs';
import {createBattle,applyBattleAction,advanceAI,legalPlays} from '../../cocos-client/assets/scripts/game/BattleKernel.ts';
const db=new DatabaseSync('.local/chapter3-normal/game.sqlite',{readOnly:true});
const world=JSON.parse(db.prepare('SELECT json FROM game_world WHERE id=1').get().json);db.close();
const actor=world.characters['6136cc1e-c2c1-402f-9e29-134690cc94b5'];
const c=new ServerContent('cocos-client/assets/resources/recovered');
const service=new GameService(null,c);
const alternate=[43,61,61,61,50,50,5061,5061,5001,5117,41001].map(id=>'main:card:'+id);
// Freeze the pre-experiment, actually saved deck: live client saves must not
// silently turn the manual/alternative policies into the same construction.
const baselineDeck=JSON.parse(readFileSync('.local/chapter3-normal/persistence-before.json','utf8')).snapshot.actor.deck;
c.validateDeck(actor,alternate);c.validateDeck(actor,baselineDeck);
if(JSON.stringify(alternate)===JSON.stringify(baselineDeck))throw new Error('Constructed-deck comparison requires distinct decks');
function manual(s, choices) {
 return choices.toSorted((a,b)=>score(s,b)-score(s,a)||a.instanceId.localeCompare(b.instanceId))[0];
}
function score(s,p){
 const hand=s.players.find(p=>p.id===actor.id).hand.find(h=>h.instanceId===p.instanceId),raw=c.card(hand.cardId).raw;
 const target=s.units.find(u=>u.id===p.targetId);
 if(target)return 200+(target.team===0?-100:Math.min(3,target.hp)*5+target.attack*3);
 const monster=c.monsterForCard(hand.cardId),ranged=monster.AttackType>0,preferred=ranged?2:3;
 const allies=s.units.filter(u=>u.team===0&&!u.flags.hero&&u.hp>0&&u.row===p.row);
 const threats=s.units.filter(u=>u.team===1&&!u.flags.hero&&u.hp>0&&u.row===p.row);
 const approach=threats.reduce((n,u)=>n+Math.max(0,7-u.col)*Math.max(1,u.attack),0);
 return 100+monster.Attack*4+monster.HP+approach-allies.length*6-Math.abs(p.col-preferred)*4;
}
const results=[];
for(const nodeId of [107,203,304])for(const seed of [7,41,83]){
 const chapter=Math.floor(nodeId/100),level=c.level(actor,`main:scene:${chapter}:node:${nodeId}`,undefined,true);
 for(const version of ['legacy','candidate'])for(const policy of ['basic-auto','manual-placement','alternate-deck']){
  // Legacy generation intentionally skips node-specific overrides, reproducing
  // the previous pool/size with the exact same seed and current legitimate actor.
  const players=[{...service.playerSpec(world,actor,0),deck:policy==='alternate-deck'?alternate:[...baselineDeck]}];
  for(const [index,p] of level.params.entries()){
   const hero=c.data.monsters[p.id];players.push({id:'enemy:'+index,name:hero.Name,team:1,hp:hero.HP*(p.hpMultiplier??1),attack:hero.Attack,monsterId:p.id,ai:true,
    deck:c.enemyDeck(hero,version==='candidate'?level:{minLevel:level.minLevel},seed+index)});
  }
  let s=advanceAI(c,createBattle(c,{id:`comparison:${nodeId}:${seed}`,seed,mapId:level.mapId,rows:level.rows??4,players,
   ...(version==='candidate'?{tacticsVersion:2}:{})}));let commands=0;
  for(;s.status==='playing'&&commands<220;commands++){
   const plays=legalPlays(c,s,actor.id),play=policy==='basic-auto'?plays[0]:manual(s,plays);
   s=advanceAI(c,applyBattleAction(c,s,actor.id,play?{type:'play',...play}:{type:'end'}));
  }
  const damage=team=>s.events.filter(e=>e.type==='damage'&&e.targetView?.flags.hero===1&&e.targetView.team===team);
  const metric=team=>({combat:damage(team).filter(e=>e.message!=='fatigue').reduce((n,e)=>n+(e.effectiveAmount??e.amount),0),fatigue:damage(team).filter(e=>e.message==='fatigue').reduce((n,e)=>n+(e.effectiveAmount??e.amount),0)});
  results.push({node:nodeId,seed,version,policy,playerDeck:players[0].deck,enemyDeck:players[1].deck,status:s.status,winner:s.winner,turn:s.turn,commands,enemyHeroDamage:metric(1),playerHeroDamage:metric(0),moves:s.events.filter(e=>e.type==='move').length,attacks:s.events.filter(e=>e.type==='attack').length,skills:s.events.filter(e=>e.type==='play'&&e.cardId&&Number(c.card(e.cardId).raw.Type)===2).length,effectiveDamageEvents:s.events.filter(e=>e.type==='damage'&&(e.effectiveAmount??e.amount)>0).length,effects:s.events.filter(e=>e.type==='effect').length});
 }
}
const output={scope:'Offline authoritative-kernel counterfactuals. Same node, seed, actor, and deck within each version/policy pair. Legitimate level-11 ordinary holdings; not a new-player win-rate estimate or real Cocos operations.',profiles:PVE_TACTICS,results};
mkdirSync('documentation/pve-experience/evidence',{recursive:true});writeFileSync('documentation/pve-experience/evidence/strategy-comparison.json',JSON.stringify(output,null,2)+'\n');
for(const node of [107,203,304])for(const version of ['legacy','candidate'])for(const policy of ['basic-auto','manual-placement','alternate-deck']){
 let rows=results.filter(r=>r.node===node&&r.version===version&&r.policy===policy);
 console.log(node,version,policy,JSON.stringify(rows.map(r=>({seed:r.seed,win:r.winner===0,turn:r.turn,combat:r.enemyHeroDamage.combat,fatigue:r.enemyHeroDamage.fatigue,own:r.playerHeroDamage,moves:r.moves,attacks:r.attacks}))));
}
// Guard against testing only a later, richer actor: use the actual first clear
// snapshots from ordinary early progression, without adding holdings or stats.
const earlyDb=new DatabaseSync('.local/chapter2-normal/game.sqlite',{readOnly:true});
const earlyWorld=JSON.parse(earlyDb.prepare('SELECT json FROM game_world WHERE id=1').get().json);earlyDb.close();
const early=[];
for(const node of [107,203]){
 const record=Object.values(earlyWorld.battles).find(b=>b.level?.nodeId===`main:scene:${Math.floor(node/100)}:node:${node}`&&b.state.winner===0&&b.participants.includes(actor.id));
 if(!record)throw new Error('Missing ordinary early snapshot '+node);
 for(const seed of [record.entryState.seed,7,41])for(const policy of ['basic-auto','manual-placement']){
  const players=record.entryState.players.map(p=>p.ai?{...p,deck:c.enemyDeck(c.data.monsters[p.monsterId],{node:{originalId:String(node),id:record.level.nodeId},minLevel:node===107?1:5},seed)}:p);
  let state=advanceAI(c,createBattle(c,{id:'early:'+node,seed,mapId:record.entryState.mapId,players,tacticsVersion:2})),commands=0;
  while(state.status==='playing'&&commands++<220){let ps=legalPlays(c,state,actor.id),p=policy==='basic-auto'?ps[0]:manual(state,ps);state=advanceAI(c,applyBattleAction(c,state,actor.id,p?{type:'play',...p}:{type:'end'}));}
  early.push({node,sourceBattle:record.id,sourcePlayerHp:players[0].hp,sourcePlayerDeck:players[0].deck,seed,policy,winner:state.winner,turn:state.turn});
 }
}
writeFileSync('documentation/pve-experience/evidence/early-progression-counterfactual.json',JSON.stringify({scope:'Offline original ordinary first-clear entry stats and owned decks, no richer late actor substitution. Not new real progression.',results:early},null,2));
console.log('Early ordinary snapshot guard',JSON.stringify(early.map(({node,seed,policy,winner,turn})=>({node,seed,policy,winner,turn}))));
