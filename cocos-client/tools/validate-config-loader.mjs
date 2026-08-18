import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configPath = path.join(root, 'assets/resources/config/manifest.json');
const loaderPath = path.join(root, 'assets/scripts/config/ConfigLoader.ts');
const bootstrapPath = path.join(root, 'assets/scripts/a0/BattleA0Bootstrap.ts');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const loaderSource = fs.readFileSync(loaderPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

const tableByPath = {
  'config/manifest': config,
  ...Object.fromEntries(
    ['units', 'cards', 'skills', 'effects', 'statuses', 'professions', 'decks'].map((tableName) => {
      const tablePath = config.tables[tableName];
      const tableFile = path.join(root, 'assets/resources', `${tablePath}.json`);
      return [tablePath, JSON.parse(fs.readFileSync(tableFile, 'utf8'))];
    }),
  ),
};

const mockCcSource = `
const manifest = ${JSON.stringify(config)};
const mockCc = {
  JsonAsset: class JsonAsset {},
  resources: {
    load(_path, _assetType, callback) {
      const tableByPath = new Map(Object.entries(${JSON.stringify(tableByPath)}));
      const table = tableByPath.get(_path);
      if (table === undefined) {
        callback(new Error('Missing resource'));
        return;
      }
      callback(null, { json: table });
    },
  },
};
`;
const sourceWithMockCc = loaderSource.replace(
  "import { JsonAsset, resources } from 'cc';",
  `${mockCcSource}\nconst { JsonAsset, resources } = mockCc;`,
);
assert.notEqual(sourceWithMockCc, loaderSource, 'the loader must have the expected sole cc import');
const executableSource = stripTypeScriptTypes(sourceWithMockCc, { mode: 'transform' });
const loaderModule = await import(`data:text/javascript;base64,${Buffer.from(executableSource).toString('base64')}`);
const { assertConfigManifest, ConfigLoadError, loadConfigManifest } = loaderModule;
assert.equal(typeof assertConfigManifest, 'function', 'must execute real assertConfigManifest export');
assert.equal(typeof ConfigLoadError, 'function', 'must execute real ConfigLoadError export');
assert.deepEqual(assertConfigManifest(config), undefined, 'valid manifest must be accepted');
assert.deepEqual(await loadConfigManifest(), config, 'real resource loader must return validated config');

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

assert.match(loaderSource, /export interface ConfigManifest/);
assert.match(loaderSource, /export function isConfigManifest\(value: unknown\): value is ConfigManifest/);
assert.match(loaderSource, /export function assertConfigManifest\(/);
assert.match(loaderSource, /resources\.load\(['"]config\/manifest['"]/);
assert.match(loaderSource, /ConfigLoadError/);
assert.match(bootstrap, /loadConfigManifest\(/);
assert.match(bootstrap, /startupBlocked/);
assert.match(bootstrap, /console\.error\(/);
assert.match(bootstrap, /startupToken/);
assert.match(bootstrap, /node\.isValid/);
assert.match(bootstrap, /this\.startupToken \+= 1/);
assert.match(bootstrap, /if \(!this\.isStartupActive\(token\)\) return/);
assert.match(bootstrap, /void this\.loadRuntimeArt\(token\)/);
assert.match(bootstrap, /private async loadRuntimeArt\(token: number\)/);

console.log('Config loader contract and error paths: PASS');
