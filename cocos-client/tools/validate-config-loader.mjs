import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const configPath = path.join(root, 'assets/resources/config/manifest.json');
const loaderPath = path.join(root, 'assets/scripts/config/ConfigLoader.ts');
const bootstrapPath = path.join(root, 'assets/scripts/a0/BattleA0Bootstrap.ts');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const loaderSource = fs.readFileSync(loaderPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

const requireFromWebPrototype = createRequire(new URL('../../web-prototype/package.json', import.meta.url));
const typescript = requireFromWebPrototype('typescript');
const compiled = typescript.transpileModule(loaderSource, {
  compilerOptions: {
    module: typescript.ModuleKind.CommonJS,
    target: typescript.ScriptTarget.ES2020,
  },
  fileName: loaderPath,
}).outputText;
const module = { exports: {} };
const mockCc = {
  JsonAsset: class JsonAsset {},
  resources: {
    load(_path, _assetType, callback) {
      callback(null, { json: config });
    },
  },
};
const sandbox = {
  console,
  module,
  exports: module.exports,
  require: (specifier) => {
    if (specifier === 'cc') return mockCc;
    throw new Error(`unexpected dependency: ${specifier}`);
  },
};
vm.runInNewContext(`(function (require, module, exports) {\n${compiled}\n})(require, module, exports);`, sandbox, {
  filename: loaderPath,
});
const { assertConfigManifest, ConfigLoadError, loadConfigManifest } = module.exports;
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
