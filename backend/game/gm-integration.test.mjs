import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {createGameServer} from './server.mjs';
import {GameStore,restoreBackup} from './store.mjs';
import {GmService,DEFAULT_PERMISSIONS,DEFAULT_LIMITS} from './gm-service.mjs';
import {clientAddress,rateLimiter} from './request-security.mjs';

test('only configured reverse proxy peers can supply the real client address',()=>{
  const r={socket:{remoteAddress:'::ffff:10.238.75.1'},headers:{'x-real-ip':'203.0.113.9','x-forwarded-for':'1.1.1.1'}};
  assert.equal(clientAddress(r,[]),'10.238.75.1');assert.equal(clientAddress(r,['10.238.75.1']),'203.0.113.9');
  r.headers['x-real-ip']='203.0.113.9, 1.1.1.1';assert.equal(clientAddress(r,['10.238.75.1']),'10.238.75.1');
});

test('expired rate buckets release capacity at the exact bound',()=>{
  const limit=rateLimiter();for(let i=0;i<10000;i++)limit('old:'+i,1,10,0);assert.doesNotThrow(()=>limit('new',1,10,11));
});

test('public entry and GM HTTP enforce roles, atomic grants, revocation, replay and persistence',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'tianxu-public-gm-')),database=path.join(dir,'game.sqlite');let app,base;
  async function start(){app=await createGameServer({database,scheduler:false});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;}
  async function req(route,{data,token,characterId,gm,cookie,origin,csrf}={}){
    const headers={...(data?{'content-type':'application/json',origin:origin??base}:{}),...(token?{authorization:'Bearer '+token}:{}),...(characterId?{'x-character-id':characterId}:{}),...(gm?{cookie:gm.cookie,'x-csrf-token':csrf??gm.csrfToken}:{}),...(cookie?{cookie}:{})};
    const r=await fetch(base+route,{method:data?'POST':'GET',headers,body:data?JSON.stringify(data):undefined,redirect:'manual'});const text=await r.text();let value;try{value=JSON.parse(text);}catch{value=text;}return {status:r.status,value,headers:r.headers};
  }
  async function act(p,action,payload){return req('/api/act',{token:p.token,characterId:p.characterId,data:{requestId:randomUUID(),action,payload}});}
  async function register(name){const r=await req('/api/register',{data:{username:name,password:'isolated-test-password'}});assert.equal(r.status,200);return r.value;}
  async function gmLogin(p){const r=await req('/api/gm/login',{data:{username:p.username,password:'isolated-test-password'}});assert.equal(r.status,200,JSON.stringify(r.value));assert.match(r.headers.get('set-cookie'),/Secure; HttpOnly; SameSite=Strict/);return {...r.value,cookie:r.headers.get('set-cookie').split(';')[0]};}
  const terminal=(p,role,permissions=DEFAULT_PERMISSIONS,limits=DEFAULT_LIMITS)=>app.gm.changeAccess('server-terminal',{operationId:randomUUID(),targetAccountId:p.accountId,role,permissions,limits,reason:'隔离验收终端配置'},{terminal:true});
  try{
    await start();assert.equal((await req('/')).status,200);assert.equal((await req('/gm/')).status,200);const legacy=await req('/beta');assert.equal(legacy.status,303);assert.equal(legacy.headers.get('location'),'/');
    const forged=await req('/api/register',{data:{username:'forged_user',password:'isolated-test-password',role:'super_admin'}});assert.equal(forged.status,400);
    const player={username:'gm_player',...await register('gm_player')},admin={username:'gm_admin',...await register('gm_admin')},manager={username:'gm_manager',...await register('gm_manager')};
    assert.equal(app.gm.access(admin.accountId).role,'player');
    player.characterId=(await act(player,'character.create',{name:'目标角色甲',profession:1,gender:1})).value.result.characterId;
    const other=(await act(manager,'character.create',{name:'隔离角色乙',profession:2,gender:1})).value.result.characterId;
    const refused=await req('/api/gm/login',{data:{username:player.username,password:'isolated-test-password'}});assert.equal(refused.status,403);assert.equal(refused.value.accountId,player.accountId);
    for(const route of ['/api/gm/session','/api/gm/players','/api/gm/character','/api/gm/resources','/api/gm/access','/api/gm/logs','/api/gm/operations/abcdefgh'])assert.equal((await req(route,{token:player.token})).status,401);
    for(const route of ['/api/gm/grants','/api/gm/access'])assert.equal((await req(route,{token:player.token,data:{}})).status,401);
    terminal(admin,'super_admin');terminal(manager,'gm',DEFAULT_PERMISSIONS,{...DEFAULT_LIMITS,gold:5,item:3,card:2});
    const root=await gmLogin(admin),gm=await gmLogin(manager);
    const access={operationId:randomUUID(),targetAccountId:manager.accountId,role:'super_admin',permissions:DEFAULT_PERMISSIONS,limits:DEFAULT_LIMITS,reason:'尝试越权'};
    assert.equal((await req('/api/gm/access',{gm,data:access})).status,403);
    assert.equal((await req('/api/gm/access?accountId='+admin.accountId,{gm})).status,403);
    const baseGrant={operationId:randomUUID(),targetAccountId:player.accountId,targetCharacterId:player.characterId,type:'currency',resourceId:'gold',quantity:2,reason:'隔离测试小额发放'};
    assert.equal((await req('/api/gm/grants',{gm,data:baseGrant,origin:'https://evil.example'})).status,403);
    assert.equal((await req('/api/gm/grants',{gm,data:baseGrant,csrf:'forged'})).status,403);
    const snapshot=app.store.read().characters[player.characterId];
    const first=await req('/api/gm/grants',{gm,data:baseGrant});assert.equal(first.status,200,JSON.stringify(first.value));assert.equal(first.value.after-first.value.before,2);
    const replay=await req('/api/gm/grants',{gm,data:baseGrant});assert.equal(replay.value.replayed,true);
    assert.equal((await req('/api/gm/grants',{gm,data:{...baseGrant,quantity:1}})).status,409);
    const current=()=>app.store.read().characters[player.characterId];assert.equal(current().currencies.gold,snapshot.currencies.gold+2);
    for(const data of [{quantity:6},{quantity:0},{quantity:-1},{quantity:1.5},{quantity:Number.MAX_SAFE_INTEGER},{resourceId:'unknown'},{targetCharacterId:other},{targetAccountId:manager.accountId},{operatorAccountId:admin.accountId}]){
      const before=structuredClone(current());const r=await req('/api/gm/grants',{gm,data:{...baseGrant,operationId:randomUUID(),...data}});assert.ok([400,403,404].includes(r.status),JSON.stringify(r.value));assert.deepEqual(current(),before);
    }
    const card=(await req('/api/gm/resources?type=card&pageSize=1',{gm})).value.items[0];assert.ok(card.resourceId.startsWith('main:card:'));
    const cg={...baseGrant,operationId:randomUUID(),type:'card',resourceId:card.resourceId,quantity:1};assert.equal((await req('/api/gm/grants',{gm,data:cg})).status,200);
    const ig={...baseGrant,operationId:randomUUID(),type:'item',resourceId:'main:item:100',quantity:2};assert.equal((await req('/api/gm/grants',{gm,data:ig})).status,200);
    assert.deepEqual(current().deck,snapshot.deck);assert.equal(current().inventory['main:item:100'],(snapshot.inventory['main:item:100']??0)+2);assert.deepEqual(current().pve?.tasks?.counters,snapshot.pve?.tasks?.counters);
    const atomicBefore=structuredClone(current()),faultId=randomUUID();
    app.store.db.exec("CREATE TEMP TRIGGER reject_gm_audit BEFORE INSERT ON gm_audit BEGIN SELECT RAISE(ABORT,'isolated audit failure'); END");
    try{assert.throws(()=>app.gm.grant(manager.accountId,{...baseGrant,operationId:faultId,quantity:1}));assert.deepEqual(current(),atomicBefore);assert.equal(app.store.db.prepare('SELECT count(*) AS n FROM gm_operations WHERE operation_id=?').get(faultId).n,0);}finally{app.store.db.exec('DROP TRIGGER reject_gm_audit');}
    app.store.scheduled(w=>{w.characters[player.characterId].currencies.gold=Number.MAX_SAFE_INTEGER;w.characters[player.characterId].inventory['main:item:100']=9999;return true;});
    assert.equal((await req('/api/gm/grants',{gm,data:{...baseGrant,operationId:randomUUID(),quantity:1}})).value.code,'GM_OVERFLOW');
    assert.equal((await req('/api/gm/grants',{gm,data:{...ig,operationId:randomUUID(),quantity:1}})).value.code,'GM_STACK_LIMIT');
    assert.equal(current().currencies.gold,Number.MAX_SAFE_INTEGER);assert.equal(current().inventory['main:item:100'],9999);
    app.store.scheduled(w=>{w.characters[player.characterId]=structuredClone(atomicBefore);return true;});
    const held=structuredClone(current());assert.equal((await act(player,'deck.save',{cards:current().deck,expectedDeck:current().deck})).status,200);assert.deepEqual(current().cards,held.cards);assert.deepEqual(current().inventory,held.inventory);assert.deepEqual(current().currencies,held.currencies);
    const view=await req('/api/state',{token:player.token,characterId:player.characterId});assert.equal(view.value.actor.currencies.gold,current().currencies.gold);
    assert.equal((await act(player,'test.grant',{})).status,403);assert.equal((await act(player,'gm.grant',baseGrant)).status,400);assert.equal((await act(player,'settings.save',{role:'super_admin'})).status,400);
    const node=view.value.scenes.flatMap(s=>s.nodes).find(n=>n.battle&&n.accessible);assert.equal((await act(player,'pve.start',{nodeId:node.id})).status,200);
    const battleBefore=structuredClone(app.store.read().battles);assert.equal((await req('/api/gm/grants',{gm,data:{...baseGrant,operationId:randomUUID(),quantity:1}})).status,200);assert.deepEqual(app.store.read().battles,battleBefore);
    const logs=(await req('/api/gm/logs?targetCharacterId='+player.characterId,{gm})).value;assert.ok(logs.items.some(x=>x.result==='rejected'));assert.ok(logs.items.some(x=>x.operationId===baseGrant.operationId&&x.before+2===x.after));assert.ok(!JSON.stringify(logs).includes('password_hash'));
    assert.equal((await req('/api/gm/access',{gm:root,data:{...access,operationId:randomUUID(),targetAccountId:admin.accountId,role:'player'}})).status,409);
    const revoke={...access,operationId:randomUUID(),role:'player',reason:'验收后撤销GM'};assert.equal((await req('/api/gm/access',{gm:root,data:revoke})).status,200);
    assert.equal((await req('/api/gm/grants',{gm,data:{...baseGrant,operationId:randomUUID()}})).status,401);
    const after=current();await app.close();await start();assert.equal(app.gm.access(admin.accountId).role,'super_admin');assert.equal(app.gm.access(manager.accountId).role,'player');assert.deepEqual(current().currencies,after.currencies);
    assert.equal((await req('/api/gm/operations/'+baseGrant.operationId,{gm:root})).value.operation.after,first.value.after);
    await app.store.backup(path.join(dir,'backup'));restoreBackup(path.join(dir,'backup'),path.join(dir,'restore.sqlite'));const restored=new GameStore(path.join(dir,'restore.sqlite'));try{assert.equal(new GmService(restored,app.content).access(admin.accountId).role,'super_admin');assert.equal(restored.db.prepare('SELECT count(*) AS n FROM gm_audit').get().n,app.store.db.prepare('SELECT count(*) AS n FROM gm_audit').get().n);}finally{restored.close();}
  }finally{await app?.close();await rm(dir,{recursive:true,force:true});}
});
