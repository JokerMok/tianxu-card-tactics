import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {RecoveredContent} from '../../cocos-client/assets/scripts/game/RecoveredContent.ts';
import {createBattle, applyBattleAction} from '../../cocos-client/assets/scripts/game/BattleKernel.ts';

const content=new RecoveredContent(JSON.parse(readFileSync(new URL('../../cocos-client/assets/resources/recovered/catalog.json',import.meta.url))));
const copy=x=>JSON.parse(JSON.stringify(x));
function battle(units,firstPlayer=0,seed=10){
 return createBattle(content,{id:'chapter1-mechanisms',seed,mapId:1,rows:4,firstPlayer,
  players:[0,1].map(team=>({id:'p'+team,name:'test',team,hp:100,deck:Array(20).fill('1')})),initialUnits:units});
}
const initial=(monsterId,playerId='p0',row=2,col=3)=>({monsterId,playerId,row,col});
const end=s=>applyBattleAction(content,s,s.players[s.activePlayer].id,{type:'end'});
const creatures=s=>s.units.filter(u=>!u.flags.hero);

test('three bone identities reverse exact Type85 config, rebuild abilities and consume the recombine action',()=>{
 for(const [heap,parent] of [[1169,1127],[1187,1145],[1380,1379]]){
  const before=battle([initial(heap),initial(1,'p1',2,5)]),id=creatures(before)[0].id;
  creatures(before).find(u=>u.playerId==='p1').flags.noAct=1; // isolate the next restored action
  const result=end(copy(before)),u=result.units.find(u=>u.id===id);
  assert.equal(u.monsterId,parent);assert.equal(u.playerId,'p0');assert.deepEqual([u.row,u.col],[2,3]);
  assert.equal(u.flags.noMove,undefined);assert.equal(u.flags.noAttack,undefined);
  assert.equal(u.flags.deathProcessed,undefined);assert.equal(u.flags.killHandled,undefined);
  assert.equal(u.flags.skeletonMonster,heap);assert.equal(u.hp,content.data.monsters[parent].HP);
  assert.equal(result.events.filter(e=>e.message==='timed-transform').length,1);
  assert.deepEqual(result,end(before),'serialized recovery is deterministic');
  const again=end(end(copy(result)));
  assert.equal(again.events.filter(e=>e.message==='timed-transform').length,1);
  assert.ok(again.events.some(e=>e.actor===id&&e.type==='attack'),'rebuilt melee/ranged AI can act next turn');
 }
});

test('skeletal death keeps square, owner and original card until heap final death; no duplicate graveyard',()=>{
 let state=battle([initial(1127,'p0',2,4),initial(1,'p1',2,5)],1);
 creatures(state).find(u=>u.monsterId===1127).cardId='main:card:1127';
 state=end(state);const heap=creatures(state).find(u=>u.monsterId===1169);
 assert.ok(heap);assert.deepEqual([heap.playerId,heap.row,heap.col],['p0',2,4]);
 assert.equal(heap.flags.boneSourceMonster,1127);assert.equal(heap.cardId,'main:card:1127');
 assert.deepEqual(state.players[0].graveyard,[]);
 const id=heap.id;state=end(copy(state));assert.equal(state.units.find(u=>u.id===id).monsterId,1127);
 state=end(state);assert.equal(creatures(state).filter(u=>u.monsterId===1169).length,1,'next death has one heap only');
 const heap2=creatures(state).find(u=>u.monsterId===1169);heap2.hp=0;
 state=end(state);assert.equal(state.players[0].graveyard.filter(x=>x==='main:card:1127').length,1);
});

test('old malformed race-transform snapshot repairs from its surviving heap identity',()=>{
 const state=battle([initial(1169)]),u=creatures(state)[0];
 u.monsterId=1001;u.flags.transformed=1;u.cardId='token:1169';
 const rebuilt=creatures(end(copy(state)))[0];assert.equal(rebuilt.monsterId,1127);
 assert.equal(rebuilt.flags.noMove,undefined);assert.equal(rebuilt.flags.noAttack,undefined);
});

test('Blaze Adept wrapper summons exactly once on its own first action, including serialized continuation',()=>{
 let state=battle([initial(12025)]);state=end(state);
 assert.equal(state.events.filter(e=>e.message==='turn-summon').length,1);
 assert.equal(creatures(state).filter(u=>[12001,12015,12032,12022].includes(u.monsterId)).length,1);
 assert.equal(creatures(state).find(u=>u.monsterId===12025).flags['compositeTurns:5027'],0);
 state=end(end(copy(state)));assert.equal(state.events.filter(e=>e.message==='turn-summon').length,1);
});

test('full adjacent slots skip the one-shot summon without backlog or removing occupants',()=>{
 let state=battle([initial(12025),initial(1,'p0',2,2),initial(1,'p0',1,3),initial(1,'p0',3,3)]);
 for(const u of creatures(state))u.flags.noAct=1;
 const ids=creatures(state).map(u=>u.id);state=end(state);
 assert.equal(creatures(state).length,4);assert.ok(ids.every(id=>state.units.some(u=>u.id===id)));
 state.units=state.units.filter(u=>u.col!==2);state=end(end(copy(state)));
 assert.equal(creatures(state).filter(u=>[12001,12015,12032,12022].includes(u.monsterId)).length,0);
});

test('Vermin Song makes a configured rat per owner action, never on the opponent action',()=>{
 let state=battle([initial(11043)]);creatures(state)[0].flags.noMove=1;
 state=end(state);assert.equal(creatures(state).filter(u=>u.monsterId===9038).length,1);
 const rat=creatures(state).find(u=>u.monsterId===9038);assert.equal(rat.playerId,'p0');assert.deepEqual([rat.row,rat.col],[2,2]);
 state=end(copy(state));assert.equal(creatures(state).filter(u=>u.monsterId===9038).length,1);
 state=end(state);assert.equal(state.events.filter(e=>e.type==='summon'&&e.targetView?.monsterId===9038).length,2);
});

test('7702 blocks Skeleton, Reanimate and Soulbound without erasing ordinary graveyard ownership',()=>{
 for(const target of [1127,1001,1085]){
  let normalFound=false;
  for(let seed=0;seed<30;seed++){
   let normal=battle([initial(target,'p0',2,4),initial(1,'p1',2,5)],1,seed);
   const victim=creatures(normal).find(u=>u.monsterId===target);victim.hp=1;victim.cardId='main:card:'+target;
   creatures(normal).find(u=>u.monsterId===1).attack=100; // fixture: force a lethal hit despite armor
   normal=end(normal);
   const activated=normal.events.some(e=>e.message==='resurrect')||creatures(normal).some(u=>u.monsterId===1169)||normal.players[0].hand.some(c=>c.cardId==='main:card:'+target);
   if(!activated)continue;
   normalFound=true;
   let blocked=battle([initial(target,'p0',2,4),initial(21247,'p1',2,5)],1,seed);
   const v=creatures(blocked).find(u=>u.monsterId===target);v.hp=1;v.cardId='main:card:'+target;
   creatures(blocked).find(u=>u.monsterId===21247).attack=100;
   blocked=end(blocked);
   assert.ok(!blocked.events.some(e=>e.message==='resurrect'));
   assert.ok(!creatures(blocked).some(u=>[target,1169].includes(u.monsterId)));
   assert.ok(!blocked.players[0].hand.some(c=>c.cardId==='main:card:'+target));
   assert.equal(blocked.players[0].graveyard.filter(c=>c==='main:card:'+target).length,1);
   break;
  }
  assert.ok(normalFound,'control actually reached its source chance branch for '+target);
 }
});
