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
const executableLoaderSource = loaderSource
  .replace("import type { ChapterLevelConfig, ChapterLevelReferences } from './levels/ChapterLevelContract';", '')
  .replace("const chapterContract = await import('./levels/ChapterLevelContract');", 'const chapterContract = { assertChapterLevelContract };')
  .replace("import { JsonAsset, resources } from 'cc';", '');
const executableContractSource = contractSource.replace(
  "import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';",
  '',
);
let moduleId = 0;

const tableNames = ['units', 'cards', 'skills', 'effects', 'statuses', 'professions', 'decks'];
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
  const document = readJson(path.join(configRoot, `${entry.resource.replace('config/', '')}.json`));
  assert.equal(document.chapterLevels.length, 1, `${entry.id} must contain exactly one level`);
  assert.equal(document.chapterLevels[0].id, entry.id, `${entry.id} file must match its index entry`);
}

const resourcesByPath = buildResources();
const loader = await loadModule(resourcesByPath);
assert.deepEqual(await loader.loadConfigManifest(), manifest, 'real chapter resources must load through the startup loader');
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
  await assert.rejects(candidateLoader.loadConfigManifest(), (error) => {
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
await expectFailure('invalid L08 prerequisite', (candidate) => {
  candidate['config/levels/chapter01/L08'].chapterLevels[0].prerequisiteLevelId = 'L99';
}, 'config/levels/chapter01/L08.chapterLevels[0].prerequisiteLevelId');
await expectFailure('wrong but registered L08 prerequisite', (candidate) => {
  candidate['config/levels/chapter01/L08'].chapterLevels[0].prerequisiteLevelId = 'L06';
}, 'config/levels/chapter01/L08.chapterLevels[0].prerequisiteLevelId');
await expectFailure('unknown L10 deck', (candidate) => {
  candidate['config/levels/chapter01/L10'].chapterLevels[0].enemyDeckId = 'D404';
}, 'config/levels/chapter01/L10.chapterLevels[0].enemyDeckId');
await expectFailure('duplicate unit ID', (candidate) => {
  const rows = candidate['config/units'].units;
  rows.push(structuredClone(rows[0]));
}, 'config/units.units[28].id');
await expectFailure('duplicate chapter target ID', (candidate) => {
  const chapterIndex = candidate[manifest.chapters.chapter01];
  chapterIndex.targetIds.push(chapterIndex.targetIds[0]);
}, `${manifest.chapters.chapter01}.targetIds[10]`);

console.log('Chapter 01 index and loader integration: L01-L12 load PASS; missing index, missing L12, invalid prerequisite, wrong prerequisite, unknown deck, duplicate table ID, and duplicate registry ID FAIL as expected');
