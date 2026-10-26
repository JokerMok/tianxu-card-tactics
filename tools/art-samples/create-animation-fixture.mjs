// Local QA ONLY. Uses the existing authoritative core, not a second combat simulation.
import {GameStore} from '../../backend/game/store.mjs';
import {GameService} from '../../backend/game/service.mjs';
import {ServerContent} from '../../backend/game/content.mjs';
import {createBattle} from '../../cocos-client/assets/scripts/game/BattleKernel.ts';
import {randomUUID,randomBytes} from 'node:crypto';
import {writeFileSync,mkdirSync,readFileSync} from 'node:fs';
import path from 'node:path';
const death=process.argv.includes('--death');
const batchTwo=process.argv.includes('--batch-two');
const chapterThree=process.argv.includes('--chapter-three');
const production=process.argv.includes('--production');
const reverseSides=process.argv.includes('--reverse-sides');
if(reverseSides&&!chapterThree&&!production)throw new Error('--reverse-sides requires a chapter-three or production fixture');
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
 const productionIds=production?[1,19,43,61,5019,60001,60002,60003,60005,...JSON.parse(readFileSync(path.join(root,'art-source/chapter1-production/batch.json'),'utf8')).models.map(m=>m.monsterId)]:[];
 const initialUnits=production?productionIds.map((monsterId,i)=>{const col=[2,4,5,7,9][Math.floor(i/4)];return{monsterId,row:i%4,col,playerId:col<=5?actorId:enemy}}):chapterThree?[
 {monsterId:19,playerId:actorId,row:0,col:3},{monsterId:60001,playerId:enemy,row:0,col:5},
 {monsterId:61,playerId:actorId,row:1,col:4},{monsterId:60003,playerId:enemy,row:1,col:6},{monsterId:5019,playerId:actorId,row:1,col:2},
 {monsterId:1,playerId:actorId,row:2,col:3},{monsterId:60005,playerId:enemy,row:2,col:5},{monsterId:43,playerId:actorId,row:2,col:1},
 {monsterId:12,playerId:actorId,row:3,col:4},{monsterId:60002,playerId:enemy,row:3,col:5}]:batchTwo?[
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
 const positioned=reverseSides?initialUnits.map(unit=>({...unit,col:11-unit.col,playerId:unit.playerId===actorId?enemy:actorId})):initialUnits;
 const entryState=createBattle(content,{id,seed:1024,mapId:1,players,rows:4,firstPlayer:0,initialUnits:positioned});
 world.battles[id]={id,entryState,state:structuredClone(entryState),mode:'pve',pve:{mode:'art-fixture'},participants:[actorId],createdAt:Date.now(),settled:false,rewards:{},dismissed:[]};
 return {message:'Local animation fixture only'};
});
writeFileSync(path.join(folder,'fixture-login.json'),JSON.stringify({username,password,characterId:actorId}),{mode:0o600});
writeFileSync(path.join(folder,production?`evidence/chapter-1-production${reverseSides?'-reverse':''}-fixture-contract.json`:chapterThree?`evidence/chapter-1-batch3${reverseSides?'-reverse':''}-fixture-contract.json`:batchTwo?'evidence/batch-2-fixture-contract.json':death?'evidence/death-fixture-contract.json':'evidence/fixture-contract.json'),JSON.stringify({id,mapId:1,seed:1024,initialUnits:production?19:chapterThree?10:8,initialHeroUnits:2,reverseSides,source:'createBattle using original monster configuration, including chapter-1 IDs. Only starting positions/owners are QA fixtures; normal starter deck opens with real hand cards unless --empty-hand. No stat/rule override.',account:'dedicated local QA account; credentials excluded',liveDatabase:'isolated .local/art-samples/game.sqlite'},null,2));
console.log('Created isolated authoritative animation fixture; private login stored locally.');
} finally{store.close();}
