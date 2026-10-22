import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync, existsSync, chmodSync, readFileSync, writeFileSync, renameSync, unlinkSync, copyFileSync, constants, rmSync, linkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import path from 'node:path';

export const freshWorld = () => ({ version: 1, revision: 0, characters: {}, rooms: {}, battles: {},
  guilds: {}, friendRequests: {}, friendships: [], chat: [], mail: {}, auctions: {}, trades: {}, seasons: {} });
export const digest = value => createHash('sha256').update(value).digest('hex');
export function stable(value) {
  if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + stable(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export function requireText(value, label, max = 80) {
  if (typeof value !== 'string' || value.trim().length < 1 || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw new Error(`${label}无效`);
  return value.trim();
}
export function requireCount(value, label = '数量', max = 1000000) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${label}无效`);
  return value;
}

export class GameStore {
  constructor(filename) {
    this.filename=filename;this.inTransaction=false;this.performance={reads:0,writes:0,readMs:0,writeMs:0,lastWorldBytes:0};
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    // Reject foreign/unsupported databases before any PRAGMA or DDL can write them.
    if(filename!==':memory:'&&existsSync(filename)){
      const existing=new DatabaseSync(filename,{readOnly:true});try{
        const tables=new Set(existing.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
        if(!['schema_version','game_world','accounts','requests','sessions'].every(t=>tables.has(t)))throw new Error('不是天墟存档，拒绝修改数据库');
        const version=existing.prepare('SELECT version FROM schema_version').get()?.version,app=existing.prepare('PRAGMA application_id').get().application_id;
        if(![1,2].includes(version)||(app!==0&&app!==0x54584354))throw new Error('数据库身份或版本不兼容，原数据已保留');
        const world=JSON.parse(existing.prepare('SELECT json FROM game_world WHERE id=1').get()?.json??'null');
        if(!world||!world.characters||!world.battles||!world.rooms)throw new Error('存档结构无效，拒绝修改数据库');
      }finally{existing.close();}
    }
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
      INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM schema_version);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS game_world(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(principal TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(principal,request_id));`);
    const schema = this.db.prepare('SELECT version FROM schema_version').get();
    if (![1,2].includes(schema.version)) { this.db.close();throw new Error('数据库版本不兼容，原数据已保留'); }
    this.db.prepare('INSERT OR IGNORE INTO game_world VALUES(1,0,?)').run(JSON.stringify(freshWorld()));
    this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS request_tombstones(principal TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(principal,request_id));
      CREATE TABLE IF NOT EXISTS request_archive(principal TEXT NOT NULL,request_id TEXT NOT NULL,result BLOB NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(principal,request_id));
      CREATE TABLE IF NOT EXISTS settlements(battle_id TEXT NOT NULL,actor_id TEXT NOT NULL,reward TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(battle_id,actor_id));
      CREATE TABLE IF NOT EXISTS operation_audit(id TEXT PRIMARY KEY,principal TEXT NOT NULL,request_id TEXT NOT NULL,action TEXT NOT NULL,revision INTEGER NOT NULL,summary TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS battle_archive(id TEXT PRIMARY KEY,json BLOB NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit_archive(id TEXT PRIMARY KEY,json BLOB NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS economic_archive(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,json BLOB NOT NULL,created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS requests_created ON requests(created);
      CREATE INDEX IF NOT EXISTS operation_audit_created ON operation_audit(created);
      INSERT OR IGNORE INTO request_tombstones SELECT principal,request_id,fingerprint,created FROM requests;`);
    try {
      if(schema.version===1){
        const world=this.read();world.version=2;
        for(const a of Object.values(world.characters))a.commandRevision??=0;
        for(const b of Object.values(world.battles))if(b.settled)for(const id of b.participants)this.db.prepare('INSERT OR IGNORE INTO settlements VALUES(?,?,?,?)').run(b.id,id,JSON.stringify(b.rewards?.[id]??{}),b.settledAt??b.createdAt??Date.now());
        this.db.prepare('UPDATE game_world SET json=? WHERE id=1').run(JSON.stringify(world));
        this.db.prepare('UPDATE schema_version SET version=2').run();
      }
      this.db.exec('PRAGMA application_id=0x54584354; PRAGMA user_version=2; COMMIT');
    }catch(error){this.db.exec('ROLLBACK');this.db.close();throw error;}
    if(filename!==':memory:')chmodSync(filename,0o600);
  }
  register(username, password, now = Date.now()) {
    username = requireText(username, '账号', 32).toLowerCase();
    if (!/^[a-z0-9_\-\u4e00-\u9fff]{3,32}$/.test(username)) throw new Error('账号需为3至32位汉字、字母、数字或下划线');
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) throw new Error('密码需为6至128位');
    const salt = randomBytes(16).toString('hex');
    const id = randomUUID();
    try { this.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?)').run(id, username, salt, scryptSync(password, salt, 64).toString('hex'), now); }
    catch (error) { if (this.db.prepare('SELECT id FROM accounts WHERE username=?').get(username)) throw new Error('账号已存在'); throw error; }
    return this.issueSession(id, now);
  }
  login(username, password, now = Date.now()) {
    username = requireText(username, '账号', 32).toLowerCase();
    if (typeof password !== 'string' || password.length > 128) throw new Error('账号或密码错误');
    const account = this.db.prepare('SELECT * FROM accounts WHERE username=?').get(username);
    const actual = scryptSync(password, account?.salt ?? 'missing-account', 64);
    const expected = account ? Buffer.from(account.password_hash, 'hex') : Buffer.alloc(64);
    if (!account || !timingSafeEqual(actual, expected)) throw new Error('账号或密码错误');
    return this.issueSession(account.id, now);
  }
  issueSession(accountId, now) {
    const token = randomBytes(32).toString('base64url');
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(digest(token), accountId, now + 30 * 86400000);
    return { token, accountId };
  }
  authenticate(token, now = Date.now()) {
    if (typeof token !== 'string' || token.length > 200) throw new Error('请先登录');
    const session = this.db.prepare('SELECT account_id,expires FROM sessions WHERE token_hash=?').get(digest(token));
    if (!session || session.expires <= now) throw new Error('登录已过期，请重新登录');
    return session.account_id;
  }
  logout(token) { this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(token)); }
  read() { const start=performance.now();const text=this.db.prepare('SELECT json FROM game_world WHERE id=1').get().json;const world=JSON.parse(text);this.performance.reads++;this.performance.readMs+=performance.now()-start;this.performance.lastWorldBytes=Buffer.byteLength(text);return world; }
  write(world){const start=performance.now();const text=JSON.stringify(world);this.db.prepare('UPDATE game_world SET revision=?,json=? WHERE id=1').run(world.revision,text);this.performance.writes++;this.performance.writeMs+=performance.now()-start;this.performance.lastWorldBytes=Buffer.byteLength(text);}
  reserveSettlement(battleId,actorId,now){if(!this.inTransaction)throw new Error('结算必须在存档事务内执行');return this.db.prepare('INSERT OR IGNORE INTO settlements VALUES(?,?,?,?)').run(battleId,actorId,'{}',now).changes===1;}
  settlement(battleId,actorId){const row=this.db.prepare('SELECT reward FROM settlements WHERE battle_id=? AND actor_id=?').get(battleId,actorId);return row?JSON.parse(row.reward):undefined;}
  finishSettlement(battleId,actorId,reward){this.db.prepare('UPDATE settlements SET reward=? WHERE battle_id=? AND actor_id=?').run(JSON.stringify(reward),battleId,actorId);}
  metrics(){return {...this.performance,schemaVersion:this.db.prepare('SELECT version FROM schema_version').get().version,receipts:this.db.prepare('SELECT count(*) AS n FROM requests').get().n,tombstones:this.db.prepare('SELECT count(*) AS n FROM request_tombstones').get().n,settlements:this.db.prepare('SELECT count(*) AS n FROM settlements').get().n};}
  async backup(target){
    if(this.inTransaction||existsSync(target))throw new Error('备份目标必须是未存在的新目录');mkdirSync(path.dirname(target),{recursive:true});
    const temp=target+'.partial-'+randomUUID();mkdirSync(temp,{mode:0o700});const file=path.join(temp,'database.sqlite');
    try{this.db.prepare('VACUUM INTO ?').run(file);const check=new DatabaseSync(file,{readOnly:true});try{if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('备份完整性校验失败');}finally{check.close();}chmodSync(file,0o600);
      const bytes=readFileSync(file),manifest={version:1,schema:2,createdAt:Date.now(),file:'database.sqlite',sha256:digest(bytes),bytes:bytes.length};
      writeFileSync(path.join(temp,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600,flag:'wx',flush:true});
      renameSync(temp,target);return manifest;
    }catch(e){rmSync(temp,{recursive:true,force:true});throw e;}
  }
  maintain({now=Date.now(),retryWindowMs=7*86400000,archiveWindowMs=90*86400000,battleRetentionMs=30*86400000}={}){
    if(retryWindowMs<7*86400000||archiveWindowMs<retryWindowMs||battleRetentionMs<86400000)throw new Error('保留期不得短于约定重试窗口');
    const counts={receipts:0,expiredReceipts:0,battles:0,economics:0,audits:0};
    this.scheduled(world=>{for(const row of this.db.prepare('SELECT * FROM requests WHERE created<?').all(now-retryWindowMs)){this.db.prepare('INSERT OR IGNORE INTO request_archive VALUES(?,?,?,?)').run(row.principal,row.request_id,gzipSync(row.result),row.created);this.db.prepare('DELETE FROM requests WHERE principal=? AND request_id=?').run(row.principal,row.request_id);counts.receipts++;}
      counts.expiredReceipts=this.db.prepare('DELETE FROM request_archive WHERE created<?').run(now-archiveWindowMs).changes;
      for(const row of this.db.prepare('SELECT * FROM operation_audit WHERE created<?').all(now-archiveWindowMs)){this.db.prepare('INSERT OR IGNORE INTO audit_archive VALUES(?,?,?)').run(row.id,gzipSync(JSON.stringify(row)),row.created);this.db.prepare('DELETE FROM operation_audit WHERE id=?').run(row.id);counts.audits++;}
      for(const [id,b]of Object.entries(world.battles))if(b.settled&&(b.settledAt??b.createdAt)<now-battleRetentionMs&&b.participants.every(id=>b.dismissed?.includes(id))){this.db.prepare('INSERT OR IGNORE INTO battle_archive VALUES(?,?,?)').run(id,gzipSync(JSON.stringify(b)),now);delete world.battles[id];counts.battles++;}
      for(const a of Object.values(world.characters)){const old=(a.economicLog??[]).filter(e=>Number(e.at)<now-battleRetentionMs);if(old.length){const text=JSON.stringify(old);this.db.prepare('INSERT OR IGNORE INTO economic_archive VALUES(?,?,?,?)').run(digest(a.id+text),a.id,gzipSync(text),now);a.economicLog=a.economicLog.filter(e=>!(Number(e.at)<now-battleRetentionMs));counts.economics+=old.length;}}
      return counts.battles>0||counts.economics>0;
    });return counts;
  }
  transaction(principal, requestId, action, payload, fn, now = Date.now()) {
    requireText(requestId, '请求编号', 100);
    requireText(action,'操作',80);
    const fingerprint = digest(stable({ action, payload }));
    this.db.exec('BEGIN IMMEDIATE');this.inTransaction=true;
    try {
      const old = this.db.prepare('SELECT fingerprint,result FROM requests WHERE principal=? AND request_id=?').get(principal, requestId);
      if (old) {
        if (old.fingerprint !== fingerprint) throw conflict('请求编号已用于不同操作','REQUEST_REUSE');
        this.db.exec('COMMIT');
        return { ...JSON.parse(old.result), replayed: true };
      }
      const tomb=this.db.prepare('SELECT fingerprint FROM request_tombstones WHERE principal=? AND request_id=?').get(principal,requestId);
      if(tomb){if(tomb.fingerprint!==fingerprint)throw conflict('请求编号已用于不同操作','REQUEST_REUSE');const archived=this.db.prepare('SELECT result FROM request_archive WHERE principal=? AND request_id=?').get(principal,requestId);if(!archived)throw conflict('请求已超过回执保留期，操作不会再次执行，请同步当前状态','REQUEST_EXPIRED');this.db.exec('COMMIT');return {...JSON.parse(gunzipSync(archived.result).toString()),replayed:true};}
      const world = this.read();
      const before=Object.fromEntries(Object.entries(world.characters).map(([id,a])=>[id,JSON.parse(JSON.stringify({currencies:a.currencies??{},cards:a.cards??{},inventory:a.inventory??{}}))]));
      const result = fn(world);
      if (result && typeof result.then === 'function') throw new Error('事务内不允许异步操作');
      world.revision++;
      const response = { result: result ?? null, revision: world.revision, replayed: false };
      this.write(world);
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(principal, requestId, fingerprint, JSON.stringify(response), now);
      this.db.prepare('INSERT INTO request_tombstones VALUES(?,?,?,?)').run(principal,requestId,fingerprint,now);
      const assetChanges=[];
      for(const [actorId,actor] of Object.entries(world.characters)) {
        const previous=before[actorId]??{};const change={actorId};
        for(const group of ['currencies','cards','inventory']) {
          const old=previous[group]??{},current=actor[group]??{},delta={};
          for(const id of new Set([...Object.keys(old),...Object.keys(current)])) {
            const amount=Number(current[id]??0)-Number(old[id]??0);if(amount)delta[id]=amount;
          }
          if(Object.keys(delta).length)change[group]=delta;
        }
        if(Object.keys(change).length>1)assetChanges.push(change);
      }
      this.db.prepare('INSERT INTO operation_audit VALUES(?,?,?,?,?,?,?)').run(randomUUID(),principal,requestId,action,world.revision,JSON.stringify({assetChanges}),now);
      this.db.exec('COMMIT');
      return response;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; } finally {this.inTransaction=false;}
  }
  scheduled(fn) {
    this.db.exec('BEGIN IMMEDIATE');this.inTransaction=true;
    try {
      const world = this.read();
      const changed = fn(world);
      if (changed) {
        world.revision++;
        this.write(world);
      }
      this.db.exec('COMMIT');
      return changed;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; } finally {this.inTransaction=false;}
  }
  close() { this.db.close(); }
}

export function conflict(message,code='REVISION_CONFLICT',details={}){return Object.assign(new Error(message),{status:409,code,details});}
export function restoreBackup(source,target){
 const manifest=JSON.parse(readFileSync(path.join(source,'manifest.json'),'utf8'));if(manifest.file!=='database.sqlite')throw new Error('不支持的备份清单');
 const sourceFile=path.join(source,manifest.file),bytes=readFileSync(sourceFile);if(digest(bytes)!==manifest.sha256)throw new Error('备份哈希不符，未修改目标');
 if(path.resolve(sourceFile)===path.resolve(target))throw new Error('恢复目标必须与备份分离');
 if(existsSync(target)){if(digest(readFileSync(target))===manifest.sha256)return {alreadyRestored:true};throw new Error('目标已存在且内容不同，禁止覆盖运行库');}
 mkdirSync(path.dirname(target),{recursive:true});const partial=target+'.restore-'+randomUUID();
 try{copyFileSync(sourceFile,partial,constants.COPYFILE_EXCL);const db=new DatabaseSync(partial,{readOnly:true});try{if(db.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error('恢复库校验失败');const v=db.prepare('SELECT version FROM schema_version').get()?.version;if(![1,2].includes(v))throw new Error('不支持的备份版本');}finally{db.close();}
   chmodSync(partial,0o600);const fd=openSync(partial,'r');try{fsyncSync(fd);}finally{closeSync(fd);}linkSync(partial,target);return {alreadyRestored:false};
 }finally{if(existsSync(partial))unlinkSync(partial);}
}
