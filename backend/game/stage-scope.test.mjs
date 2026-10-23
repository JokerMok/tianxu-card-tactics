import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGameServer} from './server.mjs';
import {restoreBackup} from './store.mjs';
import {growthActions,operateGrowth} from './growth-systems.mjs';
import {socialActions} from './social.mjs';
import {pveActions} from './pve-systems.mjs';
import {competitionActions} from './competition-systems.mjs';
import {leagueActions} from './league-systems.mjs';
import {stageActionReason,STAGE_PAUSED} from '../../cocos-client/assets/scripts/game/StageScope.ts';

const NOW=Date.UTC(2026,9,23,8);
const PASSWORD='slim-pve-http-only-password';
const assetState=actor=>structuredClone({currencies:actor.currencies,cards:actor.cards,inventory:actor.inventory,warehouse:actor.warehouse,equipment:actor.equipment});

test('slim PVE real HTTP keeps the ordinary player loop and rejects every registered paused entry without charging',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'tianxu-slim-pve-http-'));
  const database=path.join(folder,'game.sqlite');let app,base,sequence=0;
  async function start(file=database){app=await createGameServer({database:file,scheduler:false,clock:()=>NOW});await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${app.server.address().port}`;}
  async function stop(){if(!app)return;const closing=app;app=null;await closing.close();}
  async function request(route,{method='GET',token,characterId,json}={}){const response=await fetch(base+route,{method,headers:{...(json===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:`Bearer ${token}`}:{ }),...(characterId?{'x-character-id':characterId}:{})},body:json===undefined?undefined:JSON.stringify(json)});return{status:response.status,body:await response.json()};}
  async function expectOk(route,options){const response=await request(route,options);assert.equal(response.status,200,JSON.stringify(response.body));return response.body;}
  async function act(player,action,payload={},requestId=`scope-${++sequence}`){return request('/api/act',{method:'POST',token:player.token,characterId:player.characterId,json:{requestId,action,payload}});}
  async function ok(player,action,payload={},requestId){const response=await act(player,action,payload,requestId);assert.equal(response.status,200,`${action}: ${JSON.stringify(response.body)}`);return response.body;}
  async function state(player){return expectOk('/api/state',{token:player.token,characterId:player.characterId});}
  t.after(async()=>{await stop();await rm(folder,{recursive:true,force:true});});

  await start();
  const anonymousCatalog=await fetch(base+'/api/catalog');assert.equal(anonymousCatalog.status,401);
  const auth=await expectOk('/api/register',{method:'POST',json:{username:'slim_pve_http',password:PASSWORD}});
  const player={...auth,username:'slim_pve_http',password:PASSWORD};
  const catalog=await fetch(base+'/api/catalog',{headers:{authorization:`Bearer ${player.token}`,'accept-encoding':'gzip'}});
  assert.equal(catalog.status,200);assert.equal(catalog.headers.get('content-encoding'),'gzip');const etag=catalog.headers.get('etag');assert.ok(etag);
  const catalogBody=await catalog.text();assert.ok(catalogBody.length>1000);assert.doesNotThrow(()=>JSON.parse(catalogBody));
  const unchangedCatalog=await fetch(base+'/api/catalog',{headers:{authorization:`Bearer ${player.token}`,'if-none-match':etag}});assert.equal(unchangedCatalog.status,304);
  player.characterId=(await ok(player,'character.create',{name:'精简范围验收',profession:1,gender:1})).result.characterId;
  let view=await state(player);
  assert.equal(view.stageScope.id,'slim-pve-20261023');
  assert.equal(view.actor.tutorialReady,true);
  const initialRevision=view.revision,initialInstance=view.serverInstance;
  const conditionalRoute=`/api/state?since=${initialRevision}&instance=${encodeURIComponent(initialInstance)}`;
  const unchangedResponse=await fetch(base+conditionalRoute,{headers:{authorization:`Bearer ${player.token}`,'x-character-id':player.characterId}});
  const unchangedText=await unchangedResponse.text();assert.equal(unchangedResponse.status,200);assert.ok(unchangedText.length<256,`conditional state was ${unchangedText.length} bytes`);
  assert.deepEqual(JSON.parse(unchangedText),{unchanged:true,revision:initialRevision,serverInstance:initialInstance,now:NOW});
  assert.equal((await request(conditionalRoute,{characterId:player.characterId})).status,401);
  await ok(player,'tutorial.advance');
  const changedState=await request(conditionalRoute,{token:player.token,characterId:player.characterId});
  assert.equal(changedState.status,200);assert.notEqual(changedState.body.unchanged,true);assert.ok(changedState.body.actor);assert.notEqual(changedState.body.revision,initialRevision);
  const unmet=await act(player,'tutorial.advance');
  assert.equal(unmet.status,400);assert.match(unmet.body.error,/完成本步引导目标/);
  const original=[...view.actor.deck],reordered=[...original].reverse();
  await ok(player,'deck.save',{cards:reordered,expectedDeck:original});
  await ok(player,'tutorial.advance');
  const silverBeforeTask=(await state(player)).actor.currencies.silver;
  await ok(player,'task.claim',{taskId:'first-deck'});
  assert.equal((await state(player)).actor.currencies.silver,silverBeforeTask+30);
  await ok(player,'activity.loginClaim');
  await ok(player,'activity.checkin');
  await ok(player,'shop.openPack',{offerId:'pack:basic'});
  view=await state(player);
  const skill=view.growth.sections.find(section=>section.id==='profession-skill-shop')?.items.find(item=>!item.disabled);
  assert.ok(skill,'a normal profession skill offer remains available');
  const silverBeforeSkill=view.actor.currencies.silver;
  await ok(player,'shop.skill.buy',skill.payload);
  assert.equal((await state(player)).actor.currencies.silver,silverBeforeSkill-150);
  const freePass=await ok(player,'battlePass.claim',{level:1,track:'free'});
  assert.equal(freePass.result.result.track,'free');
  const assetsBeforeTestAction=assetState(app.store.read().characters[player.characterId]);
  const testGrant=await act(player,'test.grant',{});assert.equal(testGrant.status,403);assert.equal(testGrant.body.code,'TEST_ACTION_DISABLED');
  assert.deepEqual(assetState(app.store.read().characters[player.characterId]),assetsBeforeTestAction);

  const suspendedSkillCard=app.content.tables['embeddata/scp/card.xml'].find(row=>[41105,41107].includes(Number(row.SkillID)));
  const hardDungeon=app.content.tables['embeddata/scp/scene/fubens.xml'].find(row=>Number(row['困难'])>0);
  assert.ok(suspendedSkillCard&&hardDungeon);
  const explicitVariants=[
    ['chat.send',{channel:'private',target:'none',text:'blocked'}],
    ['shop.buy',{offerId:'supply:pet-food'}],['shop.buy',{offerId:'supply:gem'}],
    ['shop.openPack',{offerId:'pack:ten'}],['shop.buyLimited',{offerId:'limited:not-stage'}],['shop.exchange',{offerId:'exchange:not-stage'}],
    ['shop.skill.buy',{cardId:`main:card:${suspendedSkillCard.ID}`}],
    ['activity.chest',{index:1}],['activity.weeklyGrant',{}],['activity.rewardBonus',{}],['quest.returnClaim',{}],['collection.claim',{groupId:1}],
    ['battlePass.claim',{level:1,track:'premium'}],['quest.repeatClaim',{questId:'pet-care'}],
    ['room.ready',{roomId:'new-room',ready:true}],['room.start',{roomId:'new-room'}],
    ['pve.dungeon',{sceneId:Number(hardDungeon['困难'])}],
  ];
  const registered=[...new Set([...growthActions,...socialActions,...pveActions,...competitionActions,...leagueActions,'room.create','room.join','room.invite'])];
  const paused=[...registered.filter(action=>stageActionReason(action,{})),...explicitVariants.map(([action])=>action)];
  assert.ok(paused.length>30,'shared pause guard has broad registered-action coverage');
  for(const action of registered.filter(action=>stageActionReason(action,{}))){
    const before=assetState(app.store.read().characters[player.characterId]);
    const response=await act(player,action,{});
    assert.equal(response.status,409,`${action}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.code,'STAGE_PAUSED',action);
    assert.deepEqual(assetState(app.store.read().characters[player.characterId]),before,`${action} changed assets`);
  }
  for(const [action,payload] of explicitVariants){
    const before=assetState(app.store.read().characters[player.characterId]);
    const response=await act(player,action,payload);
    assert.equal(response.status,409,`${action}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.code,'STAGE_PAUSED',action);
    assert.deepEqual(assetState(app.store.read().characters[player.characterId]),before,`${action} changed assets`);
  }
  assert.equal(stageActionReason('pet.feed',{}),STAGE_PAUSED);

  const idempotencyBefore=assetState(app.store.read().characters[player.characterId]);
  const first=await act(player,'settings.save',{sound:false},'scope-idempotent');
  const replay=await act(player,'settings.save',{sound:false},'scope-idempotent');
  assert.equal(first.status,200);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
  assert.deepEqual(assetState(app.store.read().characters[player.characterId]),idempotencyBefore);
  const otherAuth=await expectOk('/api/register',{method:'POST',json:{username:'slim_pve_other',password:PASSWORD}});
  const other={...otherAuth};other.characterId=(await ok(other,'character.create',{name:'权限隔离角色',profession:2})).result.characterId;
  const foreign=await request('/api/state',{token:player.token,characterId:other.characterId});assert.equal(foreign.status,401);
  const currentBeforeRestart=await state(player);
  const foreignConditional=await request(`/api/state?since=${currentBeforeRestart.revision}&instance=${encodeURIComponent(currentBeforeRestart.serverInstance)}`,{token:player.token,characterId:other.characterId});assert.equal(foreignConditional.status,401);

  await stop();await start();
  const logged=await expectOk('/api/login',{method:'POST',json:{username:player.username,password:player.password}});
  player.token=logged.token;
  const afterRestart=await request(`/api/state?since=${currentBeforeRestart.revision}&instance=${encodeURIComponent(currentBeforeRestart.serverInstance)}`,{token:player.token,characterId:player.characterId});
  assert.equal(afterRestart.status,200);assert.notEqual(afterRestart.body.unchanged,true);assert.ok(afterRestart.body.actor);assert.notEqual(afterRestart.body.serverInstance,currentBeforeRestart.serverInstance);
  view=afterRestart.body;
  assert.deepEqual(view.actor.deck,reordered);
  const backup=path.join(folder,'backup');await app.store.backup(backup);const restored=path.join(folder,'restored.sqlite');restoreBackup(backup,restored);
  await stop();await start(restored);player.token=(await expectOk('/api/login',{method:'POST',json:{username:player.username,password:player.password}})).token;
  assert.deepEqual((await state(player)).actor.deck,reordered);
});

test('legacy-only fixtures remain recoverable while invalid decks and dead resources stay preserved',async t=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),'tianxu-slim-legacy-http-'));const database=path.join(folder,'legacy.sqlite');
  let app,base,sequence=0,now=NOW;
  async function start(){app=await createGameServer({database,scheduler:false,clock:()=>now});await new Promise((resolve,reject)=>{app.server.once('error',reject);app.server.listen(0,'127.0.0.1',resolve);});base=`http://127.0.0.1:${app.server.address().port}`;}
  async function request(route,{method='GET',token,characterId,json}={}){const response=await fetch(base+route,{method,headers:{...(json===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:`Bearer ${token}`}:{ }),...(characterId?{'x-character-id':characterId}:{})},body:json===undefined?undefined:JSON.stringify(json)});return{status:response.status,body:await response.json()};}
  async function act(player,action,payload={},requestId=`legacy-${++sequence}`){return request('/api/act',{method:'POST',token:player.token,characterId:player.characterId,json:{requestId,action,payload}});}
  async function ok(player,action,payload={},requestId){const r=await act(player,action,payload,requestId);assert.equal(r.status,200,`${action}: ${JSON.stringify(r.body)}`);return r.body;}
  async function state(player){const r=await request('/api/state',{token:player.token,characterId:player.characterId});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;}
  t.after(async()=>{await app?.close();await rm(folder,{recursive:true,force:true});});await start();
  const register=await request('/api/register',{method:'POST',json:{username:'slim_legacy',password:PASSWORD}});assert.equal(register.status,200);
  const player={...register.body};player.characterId=(await ok(player,'character.create',{name:'旧数据兼容',profession:1})).result.characterId;
  const initial=await state(player),legalDeck=[...initial.actor.deck];
  await ok(player,'settings.save',{music:true},'legacy-initialize');
  const suspendedRow=app.content.tables['embeddata/scp/card.xml'].find(row=>[41105,41107].includes(Number(row.SkillID)));
  assert.ok(suspendedRow,'fixture needs a source card using a suspended skill');const suspended=`main:card:${suspendedRow.ID}`;
  const equipmentRow=app.content.tables['embeddata/scp/equipment.xml'].find(row=>{const id=Number(row['物品ID\n']??row['物品ID']??row.ID),slot=Number(row['可装备位置1 无效填-1\n']??row['可装备位置1']);return id>0&&id!==1117&&slot>=0&&!/废弃|Abandoned/i.test(String(row['名字']??''));});
  assert.ok(equipmentRow,'fixture needs a valid legacy equipment row');const equipment=`main:item:${Number(equipmentRow['物品ID\n']??equipmentRow['物品ID']??equipmentRow.ID)}`;
  const mailId='legacy-player-mail',auctionId='legacy-expired-auction';
  app.store.scheduled(world=>{const actor=world.characters[player.characterId];
    actor.cards[suspended]=1;actor.deck=[suspended,...legalDeck.slice(1)];actor.inventory['main:item:1101']=2;actor.inventory[equipment]=1;actor.warehouse['main:item:100']=1;
    delete actor.stageScope;actor.growth.dailyCounters.growthActions=999;
    actor.competition={version:1,collectionClaims:[],history:[],tournament:{id:'legacy-registration',status:'active',registeredAt:now-10000,entry:{currency:'silver',amount:120},pool:[],packs:[],deck:[],wins:0,losses:0,matches:0,reward:null}};
    actor.growth.city.buildings.castle={level:1,pendingLevel:2,readyAt:now-1};
    actor.pve.operations.exploration={islandId:1,islandName:'旧远征',hours:1,startedAt:now-7200000,readyAt:now-3600000};
    world.mail[mailId]={id:mailId,from:'legacy-player',to:actor.id,title:'旧玩家附件',text:'迁移前邮件',attachment:{kind:'item',id:'main:item:100',quantity:1},claimed:false,read:false,at:now-1000};
    world.auctions[auctionId]={id:auctionId,seller:actor.id,goods:{kind:'item',id:'main:item:100',quantity:1},minimum:1,buyout:2,bid:0,bidder:null,status:'open',expires:now-1};
    return true;});
  await app.close();app=null;await start();
  let view=await state(player);assert.deepEqual(view.actor.deck,[suspended,...legalDeck.slice(1)]);assert.ok(view.actor.deckIssues.some(issue=>issue.includes(suspended)));
  assert.ok(view.actor.stageScope.unresolved.some(message=>message.includes('暂无可靠退款规则')));
  assert.ok(view.actor.stageScope.claims[JSON.stringify(['activity.chest',null,null,null,null,null,1,null,null,null,null,null])]);
  const legacyDay=Math.floor(view.actor.stageScope.startedAt/86400000);now+=86400000;
  await ok(player,'activity.chest',{index:1});
  assert.ok(app.store.read().characters[player.characterId].growth.activities.chests.includes(`${legacyDay}:1`));
  assert.ok(!app.store.read().characters[player.characterId].growth.activities.chests.includes(`${legacyDay+1}:1`));
  const repeatedOldClaim=await act(player,'activity.chest',{index:1});assert.equal(repeatedOldClaim.status,409);assert.equal(repeatedOldClaim.body.code,'STAGE_PAUSED');
  assert.ok(!view.growth.sections.flatMap(section=>section.items).some(item=>item.payload?.itemId==='main:item:1117'&&item.action==='equipment.equip'));
  assert.ok(view.growth.sections.flatMap(section=>section.items).some(item=>item.payload?.itemId===equipment&&item.action==='equipment.equip'),'owned valid legacy equipment is listed');
  const itemBefore=view.actor.inventory['main:item:1101'],essenceBefore=view.actor.growth.petEssence;
  const deadUse=await act(player,'inventory.use',{itemId:'main:item:1101',count:1});assert.equal(deadUse.status,409);assert.equal(deadUse.body.code,'STAGE_PAUSED');
  view=await state(player);assert.equal(view.actor.inventory['main:item:1101'],itemBefore);assert.equal(view.actor.growth.petEssence,essenceBefore);
  const dismantle=await act(player,'magic.dismantle',{cardId:suspended,count:1});assert.equal(dismantle.status,409);assert.equal((await state(player)).actor.cards[suspended],1);
  const directWorld=app.store.read(),directActor=directWorld.characters[player.characterId],protectedCard=legalDeck[1],protectedBefore=directActor.cards[protectedCard];
  assert.throws(()=>operateGrowth({world:directWorld,actor:directActor,content:app.content,tables:app.content.tables,now,randomInt:()=>0},'magic.dismantle',{cardId:protectedCard,count:1}),/请先从现用卡组移除/);
  assert.equal(directActor.cards[protectedCard],protectedBefore);
  await ok(player,'deck.save',{cards:legalDeck,expectedDeck:[suspended,...legalDeck.slice(1)]});assert.deepEqual((await state(player)).actor.deck,legalDeck);
  await ok(player,'mail.claim',{mailId});
  await ok(player,'warehouse.move',{itemId:'main:item:100',count:1,to:'inventory'});
  await ok(player,'quest.explore.claim');
  app.service.tick();view=await state(player);assert.equal(view.actor.growth.city.buildings.castle.level,2);assert.equal(app.store.read().auctions[auctionId].status,'expired');
  assert.ok(app.store.read().mail[`welcome:${player.characterId}`],'historical system welcome mail remains stored');

  const node=view.scenes.find(scene=>scene.id==='main:scene:1')?.nodes.find(candidate=>{if(!candidate.battle)return false;try{app.content.level(app.store.read().characters[player.characterId],candidate.id);return true;}catch{return false;}});
  assert.ok(node,'fixture needs one accessible ordinary battle');const started=await ok(player,'pve.start',{nodeId:node.id});const battleId=started.result.battleId;
  app.store.scheduled(world=>{world.battles[battleId].mode='tower';return true;});
  view=await state(player);await ok(player,'battle.command',{battleId,revision:view.battle.state.revision,action:{type:'surrender'}});
  view=await state(player);assert.equal(view.battle.settled,true);await ok(player,'battle.dismiss',{battleId});assert.equal((await state(player)).battle,null);
});

test('old guild leader can transfer before leaving and old marriage requests can only be declined', async()=>{
  const {stageFilterSections,stageActionGuard}=await import('./stage-policy.mjs');
  const {operateSocial}=await import('./social.mjs');
  const actor={id:'old-leader',guildId:'old-guild',stageScope:{claims:{}}};
  const member={id:'old-member',name:'原成员',guildId:'old-guild'};
  const world={characters:{[actor.id]:actor,[member.id]:member},guilds:{'old-guild':{id:'old-guild',leader:actor.id,members:[actor.id,member.id],applications:[]}},rooms:{}};
  const ctx={actor,world,tables:{},social:{},now:NOW};
  const transfer=stageFilterSections(ctx,[]).find(s=>s.id==='legacy').items.find(i=>i.action==='guild.transfer');
  assert.deepEqual(transfer.fields[0].options,[{value:member.id,label:'原成员'}]);
  stageActionGuard(ctx,'guild.transfer',{target:member.id});operateSocial(ctx,'guild.transfer',{target:member.id});
  stageActionGuard(ctx,'guild.leave',{});operateSocial(ctx,'guild.leave',{});
  assert.deepEqual(world.guilds['old-guild'].members,[member.id]);assert.equal(world.guilds['old-guild'].leader,member.id);assert.equal(actor.guildId,null);
  assert.equal(stageActionReason('quest.marriage.respond',{accept:false}),null);
  assert.equal(stageActionReason('quest.marriage.respond',{accept:true}),STAGE_PAUSED);
});
