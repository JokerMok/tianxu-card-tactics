// Local QA ONLY. Uses the existing authoritative core, not a second combat simulation.
import {GameStore} from '../../backend/game/store.mjs';
import {GameService} from '../../backend/game/service.mjs';
import {ServerContent} from '../../backend/game/content.mjs';
import {createBattle} from '../../cocos-client/assets/scripts/game/BattleKernel.ts';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
const death=process.argv.includes('--death');
const batchTwo=process.argv.includes('--batch-two');
const emptyHand=process.argv.includes('--empty-hand');
const root=path.resolve(import.meta.dirname,'../..');
const folder=path.join(root,'.local/art-samples');mkdirSync(folder,{recursive:true});
// No database CLI override: impossible to point this fixture at a personal/production DB.
const store=new GameStore(path.join(folder,'game.sqlite'));
try {
const content=new ServerContent(path.join(root,'cocos-client/assets/resources/recovered')),service=new GameService(store,content);
const username='art_motion_'+Date.now(),password=randomBytes(12).toString('hex');
const session=store.register(username,password),accountId=store.authenticate(session.token);
const res=service.act(accountId,'',randomUUID(),'character.create',{name:'动作验收'+Date.now().toString().slice(-5),profession:1,gender:1});
const actorId=res.result.characterId,id=randomUUID(),enemy='ai:'+id;
store.transaction(accountId,randomUUID(),'local.art-fixture',{id},world=>{
 const actor=world.characters[actorId];
 const playerSpec=service.playerSpec(world,actor,0);
 const deck=emptyHand?[]:playerSpec.deck;
 const players=[{...playerSpec,deck},{id:enemy,name:'隔离动作对照',team:1,hp:8,attack:1,ai:true,profession:1,deck:[...deck]}];
 const initialUnits=batchTwo?[
 {monsterId:19,playerId:actorId,row:0,col:3},{monsterId:43,playerId:enemy,row:0,col:5},
 {monsterId:43,playerId:actorId,row:1,col:4},{monsterId:61,playerId:enemy,row:1,col:6},
 {monsterId:1,playerId:actorId,row:2,col:3},{monsterId:12,playerId:enemy,row:2,col:5},
 {monsterId:12,playerId:actorId,row:3,col:4},{monsterId:19,playerId:enemy,row:3,col:5}]:death?[
 {monsterId:1,playerId:actorId,row:0,col:5},{monsterId:12,playerId:enemy,row:0,col:6},
 {monsterId:12,playerId:actorId,row:1,col:4},{monsterId:1,playerId:enemy,row:1,col:5},
 {monsterId:1,playerId:actorId,row:2,col:2},{monsterId:12,playerId:enemy,row:2,col:6},
 {monsterId:19,playerId:actorId,row:3,col:3},{monsterId:1,playerId:enemy,row:3,col:5}]:[
 {monsterId:1,playerId:actorId,row:0,col:3},{monsterId:43,playerId:enemy,row:0,col:5},
 {monsterId:43,playerId:actorId,row:1,col:4},{monsterId:1,playerId:enemy,row:1,col:6},
 {monsterId:1,playerId:actorId,row:2,col:2},{monsterId:1,playerId:enemy,row:2,col:7},
 {monsterId:19,playerId:actorId,row:3,col:3},{monsterId:1,playerId:enemy,row:3,col:6}];
 const entryState=createBattle(content,{id,seed:1024,mapId:1,players,rows:4,firstPlayer:0,initialUnits});
 world.battles[id]={id,entryState,state:structuredClone(entryState),mode:'pve',pve:{mode:'art-fixture'},participants:[actorId],createdAt:Date.now(),settled:false,rewards:{},dismissed:[]};
 return {message:'Local animation fixture only'};
});
writeFileSync(path.join(folder,'fixture-login.json'),JSON.stringify({username,password,characterId:actorId}),{mode:0o600});
writeFileSync(path.join(folder,batchTwo?'evidence/batch-2-fixture-contract.json':death?'evidence/death-fixture-contract.json':'evidence/fixture-contract.json'),JSON.stringify({id,mapId:1,seed:1024,initialUnits:8,initialHeroUnits:2,source:'createBattle using original monster 1/12/19/43/61 configuration. Only starting positions are QA fixtures; normal starter deck opens with real hand cards unless --empty-hand. No stat/rule override.',account:'dedicated local QA account; credentials excluded',liveDatabase:'isolated .local/art-samples/game.sqlite'},null,2));
console.log('Created isolated 10-unit authoritative animation fixture. Private login stored locally.');
} finally{store.close();}
