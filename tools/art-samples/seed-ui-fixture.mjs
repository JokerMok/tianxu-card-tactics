// Extra real card records for typography/scroll QA, never ordinary acquisition proof.
import {GameStore}from'../../backend/game/store.mjs';import{ServerContent}from'../../backend/game/content.mjs';import{stageCardAllowed}from'../../backend/game/stage-policy.mjs';import{cardDisplay}from'../../cocos-client/assets/scripts/game/GameText.ts';import{readFileSync,writeFileSync}from'node:fs';import path from'node:path';
const root=path.resolve(import.meta.dirname,'../..'),folder=path.join(root,'.local/art-samples'),login=JSON.parse(readFileSync(path.join(folder,'fixture-login.json')));
if(!login.username.startsWith('art_motion_'))throw new Error('Requires dedicated art fixture account');
const s=new GameStore(path.join(folder,'game.sqlite'));
try{const content=new ServerContent(path.join(root,'cocos-client/assets/resources/recovered'));
const available=Object.values(content.data.cards).filter(c=>stageCardAllowed(content.tables,c.id)&&!/(abandon|废弃)/i.test(c.raw.Name));
const names=new Set(),selected=[];for(const c of available){if(names.has(c.raw.Name))continue;names.add(c.raw.Name);selected.push(c);if(selected.length===17)break;}
for(const id of ['main:card:40','main:card:4044','main:card:9447']){const c=available.find(c=>c.id===id);if(c)selected.push(c);}
const a=s.read().characters[login.characterId];if(!a||!a.name.startsWith('动作验收'))throw new Error('Requires isolated art fixture character');
s.transaction(a.accountId,'art-ui-seed-v1','local.ui-fixture',selected.map(c=>c.id),world=>{const actor=world.characters[a.id];for(const c of selected)actor.cards[c.id]=Math.max(1,actor.cards[c.id]??0);return {message:'UI fixture only'};});
writeFileSync(path.join(folder,'evidence/ui-card-fixture.json'),JSON.stringify({source:'isolated QA cards only; no ordinary acquisition claim',cards:selected.map(c=>{const d=cardDisplay(content.catalog,c,'');return{id:c.id,name:d.name,abilities:d.abilities.length,nameStatus:d.nameStatus};})},null,2));console.log('Seeded isolated UI card fixture:',selected.length);
}finally{s.close();}
