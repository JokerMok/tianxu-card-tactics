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

assert.equal(config.schemaVersion, 1, 'config schemaVersion must be 1');
assert.equal(config.id, 'CONFIG-MANIFEST', 'config id is required');
assert.equal(typeof config.enabled, 'boolean', 'config enabled is required');
assert.equal(typeof config.idPolicy?.scope, 'string', 'config idPolicy.scope is required');
assert.equal(typeof config.idPolicy?.format, 'string', 'config idPolicy.format is required');
assert.equal(typeof config.idPolicy?.stable, 'boolean', 'config idPolicy.stable is required');
assert.equal(typeof config.idPolicy?.unique, 'boolean', 'config idPolicy.unique is required');
assert.deepEqual(config.evidenceLevels, ['A', 'B', 'C'], 'config evidenceLevels are required');

assert.match(loader, /export interface ConfigManifest/);
assert.match(loader, /export function isConfigManifest\(value: unknown\): value is ConfigManifest/);
assert.match(loader, /export function assertConfigManifest\(/);
assert.match(loader, /resources\.load\(['"]config\/manifest['"]/);
assert.match(loader, /ConfigLoadError/);
assert.match(bootstrap, /loadConfigManifest\(/);
assert.match(bootstrap, /startupBlocked/);
assert.match(bootstrap, /console\.error\(/);

console.log('Config loader contract: PASS');
