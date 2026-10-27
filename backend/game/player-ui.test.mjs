import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ServerContent } from './content.mjs';
import { mainlineTaskCards } from './player-ui.mjs';
const content = new ServerContent(fileURLToPath(new URL('../../cocos-client/assets/resources/recovered/', import.meta.url)));

test('original task contract exposes unlocked chapter claims, not future chapters or event tasks', () => {
  const task = {id:102,name:'Deep Winter Hills',eligible:true,ready:true,claimed:false,
    progress:[{detail:'Conquer Region 2: Deep Winter Hills',value:1,required:1}],
    reward:{silver:500,xp:100,items:[{id:10203,count:1}]}};
  const pve = {groups:[{tasks:[task,{...task,id:103},{...task,id:35306}]},{tasks:[task]}]};
  const actor = {progress:{unlockedScenes:[1,2]}};
  const before = JSON.stringify({actor,pve});
  const cards = mainlineTaskCards(content,actor,pve);
  assert.equal(cards.length,1);
  assert.equal(cards[0].id,'102'); // Existing UI sends this exact source ID to task.claim.
  assert.equal(cards[0].name,'凛冬丘陵');
  assert.match(cards[0].detail,/1\/1/);
  assert.match(cards[0].detail,/100经验/);
  assert.equal(cards[0].reward,500);
  assert.equal(cards[0].ready,true);
  assert.equal(cards[0].claimed,false);
  assert.equal(JSON.stringify({actor,pve}),before);
  task.claimed = true;
  assert.equal(mainlineTaskCards(content,actor,pve)[0].claimed,true);
});
