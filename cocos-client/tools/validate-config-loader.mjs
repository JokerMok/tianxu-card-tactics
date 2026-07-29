import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configPath = path.join(root, 'assets/resources/config/manifest.json');
const loaderPath = path.join(root, 'assets/scripts/config/ConfigLoader.ts');
const bootstrapPath = path.join(root, 'assets/scripts/a0/BattleA0Bootstrap.ts');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const loader = fs.readFileSync(loaderPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

class ConfigLoadError extends Error {
  constructor(configPath, message) {
    super(`配置加载失败 [${configPath}]: ${message}`);
    this.name = 'ConfigLoadError';
    this.configPath = configPath;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const required = (record, key, configPath) => {
  if (!(key in record)) throw new ConfigLoadError(`${configPath}.${key}`, '缺少必需字段');
  return record[key];
};
const stringField = (record, key, configPath) => {
  const value = required(record, key, configPath);
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigLoadError(`${configPath}.${key}`, '必须是非空 string');
  }
};
const booleanField = (record, key, configPath) => {
  const value = required(record, key, configPath);
  if (typeof value !== 'boolean') throw new ConfigLoadError(`${configPath}.${key}`, '必须是 boolean');
};
const evidenceLevel = (value, configPath) => {
  if (!['A', 'B', 'C'].includes(value)) throw new ConfigLoadError(configPath, '必须是 A、B 或 C');
};

function assertConfigManifest(value, configPath = 'config/manifest') {
  if (!isRecord(value)) throw new ConfigLoadError(configPath, '根值必须是 JSON object');
  if (required(value, 'schemaVersion', configPath) !== 1) {
    throw new ConfigLoadError(`${configPath}.schemaVersion`, '必须是数字 1');
  }
  stringField(value, 'id', configPath);
  evidenceLevel(required(value, 'evidenceLevel', configPath), `${configPath}.evidenceLevel`);
  const version = required(value, 'version', configPath);
  if (!Number.isInteger(version) || version < 1) {
    throw new ConfigLoadError(`${configPath}.version`, '必须是正整数');
  }
  booleanField(value, 'enabled', configPath);
  const policyPath = `${configPath}.idPolicy`;
  const policy = required(value, 'idPolicy', configPath);
  if (!isRecord(policy)) throw new ConfigLoadError(policyPath, '必须是 object');
  stringField(policy, 'scope', policyPath);
  stringField(policy, 'format', policyPath);
  booleanField(policy, 'stable', policyPath);
  booleanField(policy, 'unique', policyPath);
  const levelsPath = `${configPath}.evidenceLevels`;
  const levels = required(value, 'evidenceLevels', configPath);
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new ConfigLoadError(levelsPath, '必须是非空 array');
  }
  levels.forEach((level, index) => evidenceLevel(level, `${levelsPath}[${index}]`));
  return value;
}

assert.deepEqual(assertConfigManifest(config), config, 'valid manifest must be accepted');

function expectConfigError(label, value, expectedPath) {
  assert.throws(() => assertConfigManifest(value), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    assert.equal(error.message.startsWith(`配置加载失败 [${expectedPath}]`), true, `${label} must include the path`);
    return true;
  });
}

const missingField = structuredClone(config);
delete missingField.idPolicy.format;
expectConfigError('missing field', missingField, 'config/manifest.idPolicy.format');

const wrongType = structuredClone(config);
wrongType.enabled = 'true';
expectConfigError('wrong type', wrongType, 'config/manifest.enabled');

const invalidEvidenceLevel = structuredClone(config);
invalidEvidenceLevel.evidenceLevel = 'D';
expectConfigError('invalid evidenceLevel', invalidEvidenceLevel, 'config/manifest.evidenceLevel');

const invalidVersion = structuredClone(config);
invalidVersion.version = 0;
expectConfigError('invalid version', invalidVersion, 'config/manifest.version');

const invalidNestedEvidenceLevel = structuredClone(config);
invalidNestedEvidenceLevel.evidenceLevels[1] = 'D';
expectConfigError('invalid nested evidenceLevel', invalidNestedEvidenceLevel, 'config/manifest.evidenceLevels[1]');

expectConfigError('invalid root', null, 'config/manifest');

assert.match(loader, /export interface ConfigManifest/);
assert.match(loader, /export function isConfigManifest\(value: unknown\): value is ConfigManifest/);
assert.match(loader, /export function assertConfigManifest\(/);
assert.match(loader, /resources\.load\(['"]config\/manifest['"]/);
assert.match(loader, /ConfigLoadError/);
assert.match(bootstrap, /loadConfigManifest\(/);
assert.match(bootstrap, /startupBlocked/);
assert.match(bootstrap, /console\.error\(/);
assert.match(bootstrap, /startupToken/);
assert.match(bootstrap, /node\.isValid/);
assert.match(bootstrap, /this\.startupToken \+= 1/);
assert.match(bootstrap, /if \(!this\.isStartupActive\(token\)\) return/);

console.log('Config loader contract and error paths: PASS');
