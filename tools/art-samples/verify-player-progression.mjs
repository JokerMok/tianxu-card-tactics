// Continue the previously documented NORMAL character in a dedicated DB clone.
// No asset grants, GM, fixture battles, level edits, clock advances or seed overrides.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {GameStore} from '../../backend/game/store.mjs';
const root=path.resolve(import.meta.dirname,'../..'),folder=path.join(root,'.local/player-experience');
const origin='http://127.0.0.1:7467';
const actorId=JSON.parse(readFileSync(path.join(root,'documentation/art-samples/chapter1-production/mechanics/evidence/normal-107-result.json'))).player;
const store=new GameStore(path.join(folder,'data/game.sqlite'));
const original=store.read().characters[actorId];if(!original)throw Error('Documented normal-progress clone missing');
// A private test session for this cloned account; password, role and assets unchanged.
const session=store.issueSession(original.accountId,Date.now());store.close();
writeFileSync(path.join(folder,'progress-session.json'),JSON.stringify({...session,characterId:actorId}),{mode:0o600});
const headers={Authorization:'Bearer '+session.token,'X-Character-Id':actorId,'Content-Type':'application/json'};
const request=async(route,payload)=>{const r=await fetch(origin+route,{headers,...(payload?{method:'POST',body:JSON.stringify(payload)}:{})});const v=await r.json();if(!r.ok)throw Error(v.code+': '+v.error);return v;};
let s=await request('/api/state');
const summary=()=>({level:s.actor.level,xp:s.actor.xp,scene:s.actor.progress.sceneId,pveWins:s.actor.stats.pveWins,silver:s.actor.currencies.silver});
const result={scope:'ordinary107 progress resumed in a consistent isolated database clone; normal HTTP actions only. Private session issued to the cloned account, not a login/password test.',before:summary(),tasks:[],battles:[],commands:0};
const act=async(action,payload={})=>{const r=await request('/api/act',{requestId:randomUUID(),action,payload,expectedActorRevision:s.actor.commandRevision});s=await request('/api/state');return r;};
if(s.battle?.settled)await act('battle.dismiss',{battleId:s.battle.id});
try{await act('pve.transition',{nodeId:'main:scene:1:node:108'});}catch(error){result.initialChapterGate=error.message;}
for(const id of['first-deck','first-battle','three-wins']){const t=s.tasks.find(t=>t.id===id);if(t?.ready&&!t.claimed){await act('task.claim',{taskId:id});result.tasks.push({id,after:summary()});}}
for(let attempts=0;s.actor.level<5&&attempts<8;attempts++){
 await act('pve.start',{nodeId:'main:scene:1:node:101'});const id=s.battle.id;let steps=0;
 while(!s.battle.settled&&steps++<180){
  const b=s.battle,p=b.state.players[b.state.activePlayer];
  if(p.id!==actorId){await new Promise(r=>setTimeout(r,50));s=await request('/api/state');continue;}
  const legal=[...b.legalPlays].sort((a,b)=>((b.col===5?100:0)+b.row)-((a.col===5?100:0)+a.row));
  await act('battle.command',{battleId:id,revision:b.state.revision,action:legal[0]?{type:'play',...legal[0]}:{type:'end'}});result.commands++;
 }
 if(!s.battle.settled)throw Error('Bounded normal attempt did not finish');
 result.battles.push({id,node:101,turn:s.battle.state.turn,reward:s.battle.rewards,after:summary()});await act('battle.dismiss',{battleId:id});
}
if(s.actor.level>=5&&s.actor.progress.sceneId===1){await act('pve.transition',{nodeId:'main:scene:1:node:108'});result.transition='accepted';}
result.after=summary();result.complete=s.actor.level>=5&&s.actor.progress.sceneId===2;
const out=path.join(root,'documentation/player-experience/evidence');mkdirSync(out,{recursive:true});writeFileSync(path.join(out,'normal-level5.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({before:result.before,after:result.after,tasks:result.tasks.length,battles:result.battles.length,complete:result.complete}));
