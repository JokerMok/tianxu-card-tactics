#!/usr/bin/env node
import {existsSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {GameStore} from '../backend/game/store.mjs';
import {GmService,DEFAULT_PERMISSIONS,DEFAULT_LIMITS,MAX_LIMITS} from '../backend/game/gm-service.mjs';

const [command,...argv]=process.argv.slice(2),options={};
let store;
try {
  if(!['promote-super','grant-gm','revoke','status'].includes(command))throw new Error('命令：promote-super | grant-gm | revoke | status；必须指定 --database 和 --account-id');
  while(argv.length){const key=argv.shift();if(!['--database','--account-id','--reason','--permissions','--limits'].includes(key)||!argv.length)throw new Error('命令参数无效');if(Object.hasOwn(options,key))throw new Error('参数重复');options[key]=argv.shift();}
  const database=options['--database'],accountId=options['--account-id'];
  if(!database||!existsSync(database))throw new Error('请明确指定已存在的游戏数据库，不创建新库');
  if(typeof accountId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(accountId))throw new Error('必须提供现有账号的完整accountId，不接受用户名或角色名');
  store=new GameStore(path.resolve(database));
  // Terminal access administration never needs game content or a second account DB.
  const gm=new GmService(store,null);gm.account(accountId);
  if(command==='status')console.log(JSON.stringify({accountId,access:gm.access(accountId)},null,2));
  else if(command==='promote-super'&&gm.access(accountId).role==='super_admin')console.log(JSON.stringify({accountId,role:'super_admin',unchanged:true}));
  else{
    const role=command==='promote-super'?'super_admin':command==='revoke'?'player':'gm';
    const selected=options['--permissions']?.split(',')??Object.keys(DEFAULT_PERMISSIONS);
    if(selected.some(p=>!Object.hasOwn(DEFAULT_PERMISSIONS,p)))throw new Error('权限名称无效');
    const permissions=Object.fromEntries(Object.keys(DEFAULT_PERMISSIONS).map(k=>[k,selected.includes(k)]));
    const limits=options['--limits']?JSON.parse(options['--limits']):role==='super_admin'?MAX_LIMITS:DEFAULT_LIMITS;
    const result=gm.changeAccess('server-terminal',{operationId:randomUUID(),targetAccountId:accountId,role,permissions,limits,
      reason:options['--reason']??(role==='super_admin'?'服务器终端指定超级管理员':'服务器终端权限维护')},{terminal:true});
    console.log(JSON.stringify({operationId:result.operationId,accountId,role:result.after.role,revision:result.after.revision}));
  }
}catch(e){console.error(String(e.code??'').startsWith('ERR_SQLITE')?'数据库操作失败，原数据未替换':e.message);process.exitCode=1;}
finally{store?.close();}
