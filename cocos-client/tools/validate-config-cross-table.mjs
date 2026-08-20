import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const loaderSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const validatorSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigValidator.ts'), 'utf8');
const mockCcSource = `
const mockCc = {
  JsonAsset: class JsonAsset {},
  resources: { load() { throw new Error('not used by cross-table validator'); } },
};
`;
const executableSource = stripTypeScriptTypes(
  `${loaderSource
    .replace("import type { ChapterLevelConfig, ChapterLevelReferences } from './levels/ChapterLevelContract';", '')
    .replace("import { JsonAsset, resources } from 'cc';", `${mockCcSource}\nconst { JsonAsset, resources } = mockCc;`)}\n${validatorSource.replace("import { ConfigLoadError } from './ConfigLoader';", '')}`,
  { mode: 'transform' },
);
const module = await import(`data:text/javascript;base64,${Buffer.from(executableSource).toString('base64')}`);
const { assertConfigTables, ConfigLoadError } = module;

const fixtureRoot = path.join(root, 'tools/fixtures/config-cross-table');
const readFixture = (name) => JSON.parse(fs.readFileSync(path.join(fixtureRoot, name), 'utf8'));

if (process.argv[2]) {
  try {
    assertConfigTables(JSON.parse(fs.readFileSync(path.resolve(process.argv[2]), 'utf8')));
    console.log(`Config fixture PASS: ${process.argv[2]}`);
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    console.error(message);
    process.exit(1);
  }
}

const valid = readFixture('valid.json');

assert.doesNotThrow(() => assertConfigTables(valid), 'valid fixture must pass');

function expectFailure(label, name, expectedPath) {
  const fixture = path.join(fixtureRoot, name);
  const result = spawnSync(process.execPath, [import.meta.filename, fixture], { encoding: 'utf8' });
  assert.notEqual(result.status, 0, `${label} fixture must exit non-zero`);
  assert.equal(`${result.stdout}${result.stderr}`.includes(expectedPath), true, `${label} must report ${expectedPath}`);
}

function expectInProcessFailure(label, mutate, expectedPath) {
  const fixture = structuredClone(valid);
  mutate(fixture);
  assert.throws(() => assertConfigTables(fixture), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    return true;
  });
}

expectFailure('missing reference', 'missing-reference.json', 'config/tables.units[0].effects[0]');
expectFailure('duplicate ID', 'duplicate-id.json', 'config/tables.effects[1].id');
expectFailure('invalid enum', 'invalid-enum.json', 'config/tables.effects[0].type');
expectFailure('cyclic effects', 'cyclic-effects.json', 'config/tables.effects.effect-1');
expectFailure('out-of-range value', 'out-of-range.json', 'config/tables.effects[0].value');

expectInProcessFailure('missing reference', (fixture) => { fixture.tables.units[0].effects[0] = 'effect-missing'; }, 'config/tables.units[0].effects[0]');

console.log('Cross-table config contract: valid PASS; missing reference, duplicate ID, invalid enum, cyclic effects, out-of-range value FAIL as expected');
