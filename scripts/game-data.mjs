import path from 'node:path';
import {existsSync}from'node:fs';
import {GameStore,restoreBackup} from '../backend/game/store.mjs';
const [command,...args]=process.argv.slice(2);const options=Object.fromEntries(args.reduce((pairs,v,i)=>i%2?pairs:[...pairs,[v,args[i+1]]],[]));
function required(key){if(!options[key])throw new Error('缺少'+key);return path.resolve(options[key]);}
try{
 if(command==='restore')console.log(JSON.stringify(restoreBackup(required('--backup'),required('--target')),null,2));
 else{const database=required('--database');if(!existsSync(database))throw new Error('数据库不存在，禁止因路径拼错创建空库');const store=new GameStore(database);try{if(command==='backup')console.log(JSON.stringify(await store.backup(required('--output')),null,2));else if(command==='maintain')console.log(JSON.stringify(store.maintain(),null,2));else if(command==='metrics')console.log(JSON.stringify(store.metrics(),null,2));else throw new Error('用法: game-data.mjs backup --database DB --output 新目录 | restore --backup 备份目录 --target 新DB | maintain/metrics --database DB');}finally{store.close();}}
}catch(e){console.error(e.message);process.exitCode=1;}
