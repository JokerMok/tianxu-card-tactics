// Targeted live localhost verification. Uses only the dedicated mechanics fixture account.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const privateDir='.local/chapter1-mechanics',output='documentation/art-samples/chapter1-production/mechanics/evidence/recovery-and-retries.json';
const credentials=JSON.parse(readFileSync(privateDir+'/fixture-login.json'));
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const base='http://127.0.0.1:7440';
const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:credentials.username,password:credentials.password})});
assert.equal(login.status,200);const auth=await login.json();
async function request(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth.token,'X-Character-Id':credentials.characterId},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};}
const view=async()=>{const r=await request('/api/state');assert.equal(r.status,200);return r.data};
const before=await view();assert.equal(before.battle.settled,false);
const count=state=>({bone:state.units.filter(u=>[1169,1187,1380].includes(u.monsterId)).length,
 rats:state.events.filter(e=>e.type==='summon'&&e.targetView?.monsterId===9038).length,
 dragons:state.events.filter(e=>e.message==='turn-summon').length,
 recombinations:state.events.filter(e=>e.message==='timed-transform').length,
 turn:state.turn,revision:state.revision,events:state.events.length});
if(process.argv[2]==='capture'){
 assert.equal(count(before.battle.state).bone,1);
 writeFileSync(privateDir+'/before-restart.json',JSON.stringify({instance:before.serverInstance,state:before.battle.state,assets:{cards:before.actor.cards,deck:before.actor.deck,currencies:before.actor.currencies}},null,2),{mode:0o600});
 console.log('Captured active heap and clocks, no progression writes.');
}else if(process.argv[2]==='verify'){
 const saved=JSON.parse(readFileSync(privateDir+'/before-restart.json'));
 assert.notEqual(before.serverInstance,saved.instance,'a real process restart must have occurred');
 assert.deepEqual(before.battle.state,saved.state,'same unit identities, timers, RNG, sequence and heap after restart');
 const payload={battleId:before.battle.id,revision:before.battle.state.revision,action:{type:'end'}};
 const operation={requestId:randomUUID(),action:'battle.command',payload,expectedActorRevision:before.actor.commandRevision};
 const first=await request('/api/act',operation);assert.equal(first.status,200,JSON.stringify(first.data));
 const advanced=await view(),digest=hash(advanced.battle.state);
 const retried=await request('/api/act',operation);assert.equal(retried.status,200);assert.equal(retried.data.replayed,true);
 assert.equal(hash((await view()).battle.state),digest,'network retry must not repeat summons or recompose');
 const changed=await request('/api/act',{...operation,payload:{...payload,action:{type:'surrender'}}});assert.equal(changed.status,409);
 const stale=await request('/api/act',{...operation,requestId:randomUUID()});assert.equal(stale.status,409);
 const final=await view();assert.equal(hash(final.battle.state),digest);
 assert.deepEqual(final.actor.cards,saved.assets.cards);assert.deepEqual(final.actor.deck,saved.assets.deck);assert.deepEqual(final.actor.currencies,saved.assets.currencies);
 const counts=count(final.battle.state),old=count(saved.state);
 assert.equal(counts.dragons,old.dragons);assert.equal(counts.rats,old.rats+1);assert.equal(counts.recombinations,old.recombinations+1);
 writeFileSync(output,JSON.stringify({scope:'live localhost isolated mechanics account, not ordinary progression',restart:{newServerInstance:true,stateDigest:hash(saved.state),stateExactlyRestored:true,before:old},request:{accepted:true,replayed:true,changedContentStatus:changed.status,changedContentCode:changed.data.code,staleStatus:stale.status,after:counts,assetsUnchanged:true},credentials:'excluded'},null,2)+'\n');
 console.log('Actual service restart and exact-request retry verified:',counts);
}else throw new Error('Use capture before restarting, then verify after restarting.');
