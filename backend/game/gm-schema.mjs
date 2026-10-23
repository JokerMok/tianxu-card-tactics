import {createHash} from 'node:crypto';

// Additive feature migration. The world remains schema 2, so the previous game
// can read new player progress while simply ignoring the GM feature tables.
const SQL = `
CREATE TABLE IF NOT EXISTS gm_access(
 account_id TEXT PRIMARY KEY REFERENCES accounts(id),role TEXT NOT NULL CHECK(role IN ('player','gm','super_admin')),
 permissions TEXT NOT NULL,limits TEXT NOT NULL,revision INTEGER NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gm_sessions(
 token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
 account_id TEXT NOT NULL REFERENCES accounts(id),access_revision INTEGER NOT NULL,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gm_operations(
 operation_id TEXT PRIMARY KEY,operator_id TEXT NOT NULL,fingerprint TEXT NOT NULL,response TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS gm_audit(
 id TEXT PRIMARY KEY,operation_id TEXT,operator_id TEXT NOT NULL,target_account_id TEXT,target_character_id TEXT,
 action TEXT NOT NULL,type TEXT,resource_id TEXT,quantity INTEGER,before_json TEXT,after_json TEXT,
 reason TEXT NOT NULL,created INTEGER NOT NULL,result TEXT NOT NULL,error_code TEXT);
CREATE INDEX IF NOT EXISTS gm_audit_created ON gm_audit(created);
CREATE INDEX IF NOT EXISTS gm_audit_target ON gm_audit(target_account_id,target_character_id);
CREATE INDEX IF NOT EXISTS gm_audit_operator ON gm_audit(operator_id);
CREATE TABLE IF NOT EXISTS feature_migrations(name TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied INTEGER NOT NULL);
`;
export function migrateGm(db, now = Date.now()) {
  const checksum = createHash('sha256').update(SQL).digest('hex');
  db.exec(SQL);
  const old = db.prepare('SELECT checksum FROM feature_migrations WHERE name=?').get('gm-v1');
  if (old && old.checksum !== checksum) throw new Error('GM迁移校验不一致，已保留原库');
  db.prepare('INSERT OR IGNORE INTO feature_migrations VALUES(?,?,?)').run('gm-v1',checksum,now);
}
