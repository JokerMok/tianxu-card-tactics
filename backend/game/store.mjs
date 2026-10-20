import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
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
    if (filename !== ':memory:') mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS schema_version(version INTEGER NOT NULL);
      INSERT INTO schema_version SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM schema_version);
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES accounts(id),expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS game_world(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS requests(principal TEXT NOT NULL,request_id TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL,PRIMARY KEY(principal,request_id));`);
    const schema = this.db.prepare('SELECT version FROM schema_version').get();
    if (schema.version !== 1) throw new Error('数据库版本不兼容，原数据已保留');
    this.db.prepare('INSERT OR IGNORE INTO game_world VALUES(1,0,?)').run(JSON.stringify(freshWorld()));
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
  read() { return JSON.parse(this.db.prepare('SELECT json FROM game_world WHERE id=1').get().json); }
  transaction(principal, requestId, action, payload, fn, now = Date.now()) {
    requireText(requestId, '请求编号', 100);
    const fingerprint = digest(stable({ action, payload }));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old = this.db.prepare('SELECT fingerprint,result FROM requests WHERE principal=? AND request_id=?').get(principal, requestId);
      if (old) {
        if (old.fingerprint !== fingerprint) throw new Error('请求编号已用于不同操作');
        this.db.exec('COMMIT');
        return { ...JSON.parse(old.result), replayed: true };
      }
      const world = this.read();
      const result = fn(world);
      if (result && typeof result.then === 'function') throw new Error('事务内不允许异步操作');
      world.revision++;
      const response = { result: result ?? null, revision: world.revision, replayed: false };
      this.db.prepare('UPDATE game_world SET revision=?,json=? WHERE id=1').run(world.revision, JSON.stringify(world));
      this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?)').run(principal, requestId, fingerprint, JSON.stringify(response), now);
      this.db.exec('COMMIT');
      return response;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  scheduled(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const world = this.read();
      const changed = fn(world);
      if (changed) {
        world.revision++;
        this.db.prepare('UPDATE game_world SET revision=?,json=? WHERE id=1').run(world.revision, JSON.stringify(world));
      }
      this.db.exec('COMMIT');
      return changed;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
