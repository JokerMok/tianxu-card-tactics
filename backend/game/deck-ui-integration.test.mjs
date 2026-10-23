import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createGameServer} from './server.mjs';
test('real deck endpoint confirms exact deck; idempotent replay survives restart and character separation',async()=>{const dir=await mkdtemp(path.join(os.tmpdir(),'tianxu-deck-ui-'));let app;let base;async function start(){app=await createGameServer({database:path.join(dir,'test.sqlite'),scheduler:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${app.server.address().port}`;}try{await start();const auth=app.store.register('ui_integration','test-only-password');const account=app.store.authenticate(auth.token);let seq=0;const act=(characterId,action,payload,requestId=`req-${++seq}`)=>fetch(base+'/api/act',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${auth.token}`,'X-Character-Id':characterId},body:JSON.stringify({requestId,action,payload})});
 const one=(await(await act('','character.create',{name:'集成角色甲',profession:1,gender:1})).json()).result.characterId;const two=(await(await act('','character.create',{name:'集成角色乙',profession:2,gender:2})).json()).result.characterId;
 const assetsBefore=structuredClone(app.store.read().characters[one].currencies);
 for(const action of ['test.grant','test.unlockBattlePass']){const denied=await act(one,action,{});assert.equal(denied.status,403);assert.equal((await denied.json()).code,'TEST_ACTION_DISABLED');}
 assert.deepEqual(app.store.read().characters[one].currencies,assetsBefore);
 const exposed=await(await fetch(base+'/api/state',{headers:{Authorization:`Bearer ${auth.token}`,'X-Character-Id':one}})).json();assert.ok(!exposed.growth.sections.some(s=>s.id==='local-tools'||s.items.some(i=>i.action?.startsWith('test.'))));
 const original=app.store.read().characters[one].deck;const reordered=[...original].reverse();const first=await(await act(one,'deck.save',{cards:reordered},'deck-stable')).json();assert.deepEqual(first.result.cards,reordered);assert.equal(first.replayed,false);const edits=app.store.read().characters[one].stats.deckEdits;
 const rejected=await act(one,'deck.save',{cards:[...reordered,...reordered]},'deck-rejected');assert.equal(rejected.status,400);assert.deepEqual(app.store.read().characters[one].deck,reordered);
 await app.close();await start();const replay=await(await act(one,'deck.save',{cards:reordered},'deck-stable')).json();assert.equal(replay.replayed,true);assert.deepEqual(replay.result.cards,reordered);assert.equal(app.store.read().characters[one].stats.deckEdits,edits);assert.deepEqual(app.store.read().characters[two].deck,original);const state=app.service.view(account,one);assert.equal(state.actor.deckCapacity,4);assert.deepEqual(state.actor.deck,reordered);
}finally{if(app)await app.close();await rm(dir,{recursive:true,force:true});}});
