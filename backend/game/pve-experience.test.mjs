import test from 'node:test';
import assert from 'node:assert/strict';
import {ServerContent} from './content.mjs';
import {GameService} from './service.mjs';
import {PVE_TACTICS,explorationTasks} from './pve-experience.mjs';
import {createBattle,applyBattleAction,advanceAI,legalPlays} from '../../cocos-client/assets/scripts/game/BattleKernel.ts';
const c=new ServerContent('cocos-client/assets/resources/recovered');
const source=(extra={})=>({id:'p',name:'test',team:0,hp:100,deck:[],...extra});
function battle(v,deck=[]){return createBattle(c,{id:'version-test',seed:7,mapId:1,firstPlayer:0,players:[source({deck}),source({id:'e',team:1})],...(v?{tacticsVersion:2}:{})});}
function endCycle(s){s=applyBattleAction(c,s,'p',{type:'end'});return applyBattleAction(c,s,'e',{type:'end'});}
test('snapshot version preserves legacy fatigue; v2 buffer is symmetric and survives serialization',()=>{
 let old=battle(false),fresh=battle(true);
 for(let n=1;n<=6;n++){old=endCycle(old);fresh=endCycle(JSON.parse(JSON.stringify(fresh)));}
 assert.equal(old.players[0].hp,79);assert.equal(fresh.players[0].hp,99);
 assert.equal(fresh.players[1].hp,99);assert.equal(fresh.events.filter(e=>e.type==='fatigue'&&e.message==='supply-buffer').length,10);
 assert.equal(fresh.events.filter(e=>e.type==='damage'&&e.message==='fatigue').length,2);
});
test('v2 mobile AIType1 advances while explicit movement restrictions remain',()=>{
 const step=version=>{let s=battle(version,['main:card:19']);const p=legalPlays(c,s,'p').find(p=>p.row===1&&p.col===3);s=applyBattleAction(c,s,'p',{type:'play',...p});s=endCycle(s);s=applyBattleAction(c,s,'p',{type:'end'});return s;};
 assert.equal(step(false).units.find(u=>!u.flags.hero).col,3);
 assert.ok(step(true).units.find(u=>!u.flags.hero).col>3);
 let s=step(true);const unit=s.units.find(u=>!u.flags.hero),col=unit.col;unit.flags.noMove=1;s=applyBattleAction(c,s,'e',{type:'end'});s=applyBattleAction(c,s,'p',{type:'end'});assert.equal(s.units.find(u=>u.id===unit.id).col,col);
});
test('three profiles bind valid source cards; unselected encounters retain their compatibility pool',()=>{
 assert.deepEqual(Object.keys(PVE_TACTICS),['107','203','304']);
 for(const [id,profile] of Object.entries(PVE_TACTICS)){const chapter=Math.floor(+id/100);const node=c.graph(chapter).nodes.find(n=>n.originalId===id);const param=c.encounter(node.triggers[0])[0];assert.equal(String(param.deckid),profile.sourceDeckId);const deck=c.enemyDeck(c.data.monsters[param.id],{node,minLevel:chapter===3?10:chapter===2?5:1},7);assert.equal(deck.length,profile.cards.length);for(const card of deck){assert.ok(c.monsterForCard(card));assert.equal(c.card(card).raw.Type,1);}}
 assert.equal(c.enemyDeck(c.data.monsters[60001],{minLevel:1},7).length,4);
 assert.equal(c.enemyDeck(c.data.monsters[60001],{minLevel:5,node:{originalId:'203',id:'main:scene:999:node:203'}},7).length,5);
});
test('exploration counts unique original nodes; rewards are explicit, once only, and leave old progress intact',()=>{
 const a={id:'p',level:7,xp:46,stats:{},claimed:[],currencies:{silver:100,gold:20,crystal:0},economicLog:[],progress:{unlockedScenes:[1,2],clearedNodes:Array.from({length:8},(_,i)=>`main:scene:2:node:${201+i}`),clearedTriggers:['existing']}};
 const service=new GameService(null,c),progress=structuredClone(a.progress);
 assert.equal(explorationTasks({...a,progress:{...a.progress,clearedNodes:Array(30).fill('main:scene:2:node:201')}}).some(t=>t.ready),false);
 // Existing source tasks 1/101 account for 115 XP; no synthetic level setting.
 c.grantExperience(a,115);assert.deepEqual([a.level,a.xp],[8,81]);
 for(const task of explorationTasks(a))service.claimTask(a,{taskId:task.id},0);
 assert.deepEqual([a.level,a.xp],[10,1]);assert.equal(a.currencies.silver,100);assert.deepEqual(a.progress,progress);
 const before=JSON.stringify(a);assert.throws(()=>service.claimTask(a,{taskId:'explore-chapter2-8-v1'},0),/已领取/);assert.equal(JSON.stringify(a),before);
});
