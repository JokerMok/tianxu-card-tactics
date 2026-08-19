import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configPath = path.join(root, 'assets/resources/config/manifest.json');
const loaderPath = path.join(root, 'assets/scripts/config/ConfigLoader.ts');
const contractPath = path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts');
const bootstrapPath = path.join(root, 'assets/scripts/a0/BattleA0Bootstrap.ts');
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
const loaderSource = fs.readFileSync(loaderPath, 'utf8');
const contractSource = fs.readFileSync(contractPath, 'utf8');
const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');
const chapterIndex = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/levels/chapter01/index.json'), 'utf8'));

const tableNames = ['units', 'cards', 'skills', 'effects', 'statuses', 'professions', 'decks'];
const resourceByPath = {
  'config/manifest': config,
  ...Object.fromEntries(
    tableNames.map((tableName) => {
      const tablePath = config.tables[tableName];
      const tableFile = path.join(root, 'assets/resources', `${tablePath}.json`);
      return [tablePath, JSON.parse(fs.readFileSync(tableFile, 'utf8'))];
    }),
  ),
  [config.chapters.chapter01]: chapterIndex,
  ...Object.fromEntries(
    chapterIndex.levels.map((entry) => [
      entry.resource,
      JSON.parse(fs.readFileSync(path.join(root, 'assets/resources', `${entry.resource}.json`), 'utf8')),
    ]),
  ),
};

const expectedResourceLoadPaths = [
  'config/manifest',
  ...tableNames.map((tableName) => config.tables[tableName]),
  config.chapters.chapter01,
  ...chapterIndex.levels.map((entry) => entry.resource),
];
let nextModuleId = 0;

async function loadConfigLoader(resourcesByPath = resourceByPath, source = loaderSource) {
  const mockCcSource = `
const resourceLoadPaths = [];
const tableByPath = new Map(Object.entries(${JSON.stringify(resourcesByPath)}));
const mockCc = {
  JsonAsset: class JsonAsset {},
  resources: {
    load(resourcePath, _assetType, callback) {
      resourceLoadPaths.push(resourcePath);
      const table = tableByPath.get(resourcePath);
      if (table === undefined) {
        callback(new Error('Missing resource'));
        return;
      }
      callback(null, { json: table });
    },
  },
};
export { resourceLoadPaths };
`;
  const sourceWithoutChapterContractImport = source.replace(
    "import type { ChapterLevelConfig, ChapterLevelReferences } from './levels/ChapterLevelContract';",
    '',
  );
  const sourceWithMockCc = sourceWithoutChapterContractImport.replace(
    "import { JsonAsset, resources } from 'cc';",
    `${mockCcSource}\nconst { JsonAsset, resources } = mockCc;`,
  );
  assert.notEqual(sourceWithMockCc, sourceWithoutChapterContractImport, 'the loader must have the expected sole cc import');
  const executableSource = stripTypeScriptTypes(
    `${sourceWithMockCc.replace(
      "const chapterContract = await import('./levels/ChapterLevelContract');",
      'const chapterContract = { assertChapterLevelContract };',
    )}\n${contractSource.replace("import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';", '')}`,
    { mode: 'transform' },
  );
  return import(
    `data:text/javascript;base64,${Buffer.from(executableSource).toString('base64')}#${nextModuleId++}`,
  );
}

function expectConfigError(label, value, expectedPath) {
  assert.throws(() => assertConfigManifest(value), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    assert.equal(error.message.startsWith(`配置加载失败 [${expectedPath}]`), true, `${label} must include the path`);
    return true;
  });
}

async function expectLoadConfigError(label, resourcesByPath, expectedPath) {
  const { ConfigLoadError: LoadConfigError, loadConfigManifest: loadConfig } = await loadConfigLoader(resourcesByPath);
  await assert.rejects(loadConfig(), (error) => {
    assert(error instanceof LoadConfigError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    assert.equal(error.message.startsWith(`配置加载失败 [${expectedPath}]`), true, `${label} must include the path`);
    return true;
  });
}

const loaderModule = await loadConfigLoader();
const { assertConfigManifest, ConfigLoadError, loadConfigManifest } = loaderModule;
assert.equal(typeof assertConfigManifest, 'function', 'must execute real assertConfigManifest export');
assert.equal(typeof ConfigLoadError, 'function', 'must execute real ConfigLoadError export');
assert.deepEqual(assertConfigManifest(config), undefined, 'valid manifest must be accepted');
assert.deepEqual(await loadConfigManifest(), config, 'real resource loader must return validated config');
assert.deepEqual(
  loaderModule.resourceLoadPaths,
  expectedResourceLoadPaths,
  'successful loading must request the manifest and every declared table exactly once',
);

const tableNamesDeclaration = "const tableNames = ['units', 'cards', 'skills', 'effects', 'statuses', 'professions', 'decks'] as const;";
const skippedDeckLoaderSource = loaderSource.replace(
  tableNamesDeclaration,
  "const tableNames = ['units', 'cards', 'skills', 'effects', 'statuses', 'professions'] as const;",
);
assert.notEqual(skippedDeckLoaderSource, loaderSource, 'the skipped-deck regression source must be created');
const skippedDeckLoader = await loadConfigLoader(resourceByPath, skippedDeckLoaderSource);
await assert.rejects(
  skippedDeckLoader.loadConfigManifest(),
  (error) => error?.name === 'ConfigLoadError' && error.configPath === 'config/decks',
  'the chapter loader must reject a loader that skips decks',
);

const missingDeckResource = structuredClone(resourceByPath);
delete missingDeckResource['config/decks'];
await expectLoadConfigError('missing table resource', missingDeckResource, 'config/decks');

const unknownDeckTableName = structuredClone(resourceByPath);
unknownDeckTableName['config/decks'].table = 'unknown';
await expectLoadConfigError('unknown table name', unknownDeckTableName, 'config/decks.table');

const invalidDeckPath = structuredClone(resourceByPath);
invalidDeckPath['config/manifest'].tables.decks = 'config/unknown';
await expectLoadConfigError('invalid table path', invalidDeckPath, 'config/manifest.tables.decks');

const missingChapterIndex = structuredClone(resourceByPath);
delete missingChapterIndex[config.chapters.chapter01];
await expectLoadConfigError('missing chapter index', missingChapterIndex, config.chapters.chapter01);

const missingChapterLevel = structuredClone(resourceByPath);
delete missingChapterLevel['config/levels/chapter01/L12'];
await expectLoadConfigError('missing chapter level', missingChapterLevel, 'config/levels/chapter01/L12');

const invalidChapterPrerequisite = structuredClone(resourceByPath);
invalidChapterPrerequisite['config/levels/chapter01/L08'].chapterLevels[0].prerequisiteLevelId = 'L99';
await expectLoadConfigError(
  'invalid chapter prerequisite',
  invalidChapterPrerequisite,
  'config/levels/chapter01/L08.chapterLevels[0].prerequisiteLevelId',
);

const unknownChapterDeck = structuredClone(resourceByPath);
unknownChapterDeck['config/levels/chapter01/L10'].chapterLevels[0].enemyDeckId = 'D404';
await expectLoadConfigError(
  'unknown chapter deck',
  unknownChapterDeck,
  'config/levels/chapter01/L10.chapterLevels[0].enemyDeckId',
);

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
assert.match(loaderSource, /loadChapter01Levels\(/);
assert.match(loaderSource, /chapter01: string/);
assert.match(loaderSource, /config\/levels\/chapter01\/index/);
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
