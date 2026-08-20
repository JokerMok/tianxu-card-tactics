import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const manifest = readJson(path.join(configRoot, 'manifest.json'));
const index = readJson(path.join(configRoot, 'levels/chapter01/index.json'));
const loaderSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const contractSource = fs.readFileSync(path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts'), 'utf8');
const bootstrapSource = fs.readFileSync(path.join(root, 'assets/scripts/a0/BattleA0Bootstrap.ts'), 'utf8');
const executableLoaderSource = loaderSource
  .replace("import type { ChapterLevelConfig, ChapterLevelReferences } from './levels/ChapterLevelContract';", '')
  .replace("const chapterContract = await import('./levels/ChapterLevelContract');", 'const chapterContract = { assertChapterLevelContract };')
  .replace("import { JsonAsset, resources } from 'cc';", '');
const executableContractSource = contractSource.replace(
  "import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';",
  '',
);
let moduleId = 0;
const initialEnemyHelperSource = bootstrapSource.match(
  /export function selectA0InitialEnemyUnit[\s\S]*?\n}\n/,
)?.[0];
assert(initialEnemyHelperSource, 'A0 must expose the strategy-to-initial-enemy selector for the runtime contract test');
const initialEnemyHelper = await import(
  `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(initialEnemyHelperSource, { mode: 'transform' })).toString('base64')}#${moduleId++}`,
);

const tableNames = ['units', 'cards', 'skills', 'effects', 'statuses', 'professions', 'decks', 'strategies'];
function buildResources() {
  const resourcesByPath = {
    'config/manifest': manifest,
    [manifest.chapters.chapter01]: index,
  };
  for (const tableName of tableNames) {
    const resourcePath = manifest.tables[tableName];
    resourcesByPath[resourcePath] = readJson(path.join(configRoot, `${resourcePath.replace('config/', '')}.json`));
  }
  for (const entry of index.levels) {
    resourcesByPath[entry.resource] = readJson(path.join(configRoot, `${entry.resource.replace('config/', '')}.json`));
  }
  return resourcesByPath;
}

async function loadModule(resourcesByPath) {
  const mockCcSource = `
const resourceLoadPaths = [];
const resourcesByPath = new Map(Object.entries(${JSON.stringify(resourcesByPath)}));
const mockCc = {
  JsonAsset: class JsonAsset {},
  resources: {
    load(resourcePath, _assetType, callback) {
      resourceLoadPaths.push(resourcePath);
      const value = resourcesByPath.get(resourcePath);
      if (value === undefined) {
        callback(new Error('Missing resource'));
        return;
      }
      callback(null, { json: value });
    },
  },
};
const { JsonAsset, resources } = mockCc;
export { resourceLoadPaths };
`;
  const source = stripTypeScriptTypes(
    `${mockCcSource}\n${executableLoaderSource}\n${executableContractSource}`,
    { mode: 'transform' },
  );
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}#${moduleId++}`);
}

assert.deepEqual(
  index.levels.map(({ id }) => id),
  ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11', 'L12'],
  'chapter index must enumerate L01-L12 in order',
);
assert.deepEqual(
  index.levels.map(({ prerequisiteLevelId }) => prerequisiteLevelId),
  [null, 'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11'],
  'chapter index must preserve the prerequisite chain',
);
for (const entry of index.levels) {
  assert.equal(entry.resource, `config/levels/chapter01/${entry.id}`);
  assert.equal(entry.enemyStrategyId, `ES_${entry.id}`);
  const document = readJson(path.join(configRoot, `${entry.resource.replace('config/', '')}.json`));
  assert.equal(document.chapterLevels.length, 1, `${entry.id} must contain exactly one level`);
  assert.equal(document.chapterLevels[0].id, entry.id, `${entry.id} file must match its index entry`);
}

const resourcesByPath = buildResources();
const loader = await loadModule(resourcesByPath);
const loadedRuntime = await loader.loadConfigRuntime();
assert.deepEqual(loadedRuntime.manifest, manifest, 'real chapter resources must load through the startup loader');
assert.deepEqual(
  [...loadedRuntime.chapter01.strategyByLevelId.entries()].map(([levelId, strategy]) => [levelId, strategy.id]),
  index.levels.map(({ id, enemyStrategyId }) => [id, enemyStrategyId]),
  'chapter runtime must expose the strategy registry injected by ConfigLoader',
);
const l01Strategy = loadedRuntime.chapter01.strategyByLevelId.get('L01');
assert(l01Strategy, 'L01 runtime strategy must be available to A0');
assert.equal(loadedRuntime.chapter01.strategyById.get('ES_L01'), l01Strategy, 'both readonly indexes must share the same strategy object');
assert(Object.isFrozen(l01Strategy), 'runtime strategy object must be frozen');
assert(Object.isFrozen(l01Strategy.unitIds), 'runtime strategy unitIds must be frozen');
assert(Object.isFrozen(l01Strategy.skillRules), 'runtime strategy skillRules must be frozen');
assert(Object.isFrozen(l01Strategy.targetSelection.enemyUnitOrder), 'nested runtime strategy arrays must be frozen');
const l01Snapshot = structuredClone(l01Strategy);
assert.equal(typeof loadedRuntime.chapter01.strategyByLevelId.set, 'undefined', 'readonly strategy map must not expose set');
assert.throws(() => loadedRuntime.chapter01.strategyByLevelId.set('L99', l01Strategy), TypeError, 'strategy map set must fail');
assert.throws(() => { l01Strategy.unitIds.push('U002'); }, TypeError, 'strategy unitIds push must fail');
assert.throws(() => { l01Strategy.targetSelection.enemyUnitOrder[0] = 'FORGED'; }, TypeError, 'nested strategy array write must fail');
assert.throws(() => { l01Strategy.id = 'FORGED'; }, TypeError, 'strategy field write must fail');
assert.deepEqual(l01Strategy, l01Snapshot, 'failed mutation probes must not change the runtime strategy');

assert.equal(initialEnemyHelper.selectA0InitialEnemyUnit({ unitIds: ['U001'] }), 'U001');
assert.equal(initialEnemyHelper.selectA0InitialEnemyUnit({ unitIds: ['U008'] }), 'U008');
assert.notEqual(
  initialEnemyHelper.selectA0InitialEnemyUnit({ unitIds: ['U001'] }),
  initialEnemyHelper.selectA0InitialEnemyUnit({ unitIds: ['U008'] }),
  'changing the L01 strategy roster must change the A0 initial enemy input and displayed unit label',
);
assert.match(bootstrapSource, /strategyByLevelId\.get\('L01'\)/, 'A0 initialization must read the L01 runtime strategy');
assert.match(bootstrapSource, /selectA0InitialEnemyUnit\(strategy\)/, 'A0 initialization must select from strategy.unitIds');
assert.match(bootstrapSource, /spawnUnit\(0, 9, 'enemy', enemyUnitId\)/, 'A0 must pass the configured unit ID into actual enemy spawning');
assert.match(bootstrapSource, /createLabel\(unit, 'UnitName', name/, 'the configured enemy unit ID must reach the displayed unit label');
assert.deepEqual(
  loader.resourceLoadPaths,
  [
    'config/manifest',
    ...tableNames.map((tableName) => manifest.tables[tableName]),
    manifest.chapters.chapter01,
    ...index.levels.map(({ resource }) => resource),
  ],
  'startup loading must request the index and all twelve level resources exactly once',
);

async function expectFailure(label, mutate, expectedPath) {
  const candidate = structuredClone(resourcesByPath);
  mutate(candidate);
  const candidateLoader = await loadModule(candidate);
  await assert.rejects(candidateLoader.loadConfigRuntime(), (error) => {
    assert.equal(error?.name, 'ConfigLoadError', `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report the exact resource path`);
    return true;
  });
}

await expectFailure('missing index', (candidate) => {
  delete candidate[manifest.chapters.chapter01];
}, manifest.chapters.chapter01);
await expectFailure('missing L12', (candidate) => {
  delete candidate['config/levels/chapter01/L12'];
}, 'config/levels/chapter01/L12');
await expectFailure('missing ES_L12', (candidate) => {
  candidate[manifest.tables.strategies].strategies.pop();
}, `${manifest.tables.strategies}.strategies`);
await expectFailure('wrong strategy mapping', (candidate) => {
  candidate[manifest.tables.strategies].strategies[0].levelId = 'L02';
}, `${manifest.tables.strategies}.strategies[0].levelId`);
await expectFailure('strategy deck mismatch', (candidate) => {
  const decks = candidate[manifest.tables.decks].decks;
  const alternateDeck = structuredClone(decks[0]);
  alternateDeck.id = 'D002';
  decks.push(alternateDeck);
  candidate['config/levels/chapter01/L01'].chapterLevels[0].enemyDeckId = 'D002';
}, `${manifest.tables.strategies}.strategies[0].deckId`);
await expectFailure('unknown strategy field', (candidate) => {
  candidate[manifest.tables.strategies].strategies[0].forgedAction = 'DEPLOY_FRONTLINE';
}, `${manifest.tables.strategies}.strategies[0].forgedAction`);
await expectFailure('illegal strategy reference', (candidate) => {
  candidate[manifest.tables.strategies].strategies[0].unitIds[0] = 'U999';
}, `${manifest.tables.strategies}.strategies[0].unitIds[0]`);
await expectFailure('invalid L08 prerequisite', (candidate) => {
  candidate['config/levels/chapter01/L08'].chapterLevels[0].prerequisiteLevelId = 'L99';
}, 'config/levels/chapter01/L08.chapterLevels[0].prerequisiteLevelId');
await expectFailure('wrong but registered L08 prerequisite', (candidate) => {
  candidate['config/levels/chapter01/L08'].chapterLevels[0].prerequisiteLevelId = 'L06';
}, 'config/levels/chapter01/L08.chapterLevels[0].prerequisiteLevelId');
await expectFailure('unknown L10 deck', (candidate) => {
  candidate['config/levels/chapter01/L10'].chapterLevels[0].enemyDeckId = 'D404';
}, 'config/levels/chapter01/L10.chapterLevels[0].enemyDeckId');
await expectFailure('unknown reward registry field', (candidate) => {
  candidate[manifest.chapters.chapter01].rewardRegistries.forged = ['FORGED'];
}, `${manifest.chapters.chapter01}.rewardRegistries.forged`);
await expectFailure('unknown level field', (candidate) => {
  candidate['config/levels/chapter01/L01'].chapterLevels[0].forged = true;
}, 'config/levels/chapter01/L01.chapterLevels[0].forged');
await expectFailure('unknown level reward field', (candidate) => {
  candidate['config/levels/chapter01/L01'].chapterLevels[0].rewards[0].forged = true;
}, 'config/levels/chapter01/L01.chapterLevels[0].rewards[0].forged');
await expectFailure('duplicate unit ID', (candidate) => {
  const rows = candidate['config/units'].units;
  rows.push(structuredClone(rows[0]));
}, 'config/units.units[28].id');
await expectFailure('duplicate chapter target ID', (candidate) => {
  const chapterIndex = candidate[manifest.chapters.chapter01];
  chapterIndex.targetIds.push(chapterIndex.targetIds[0]);
}, `${manifest.chapters.chapter01}.targetIds[10]`);

console.log('Chapter 01 runtime integration: strategy-driven A0 input/display, readonly strategy indexes, L01-L12 registry load PASS; deck mismatch, unknown reward/level field, missing strategy, wrong mapping, illegal reference, missing index/L12, invalid prerequisite, unknown deck, duplicate table ID, and duplicate registry ID FAIL as expected');
