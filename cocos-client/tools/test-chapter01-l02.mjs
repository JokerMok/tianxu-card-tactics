import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const levelPath = path.join(configRoot, 'levels/chapter01/L02.json');
const manifestPath = path.join(configRoot, 'manifest.json');
const decksPath = path.join(configRoot, 'decks.json');
const cardsPath = path.join(configRoot, 'cards.json');
const unitsPath = path.join(configRoot, 'units.json');
const storyPath = path.resolve(root, '../首章剧情关卡-v1.1.md');
const sceneDocPath = path.resolve(root, '../场景战场UI特效生图提示词库-v1.2.md');

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const readText = (filePath) => fs.readFileSync(filePath, 'utf8');

const loaderSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const contractSource = fs.readFileSync(path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts'), 'utf8');
const mockCcSource = `
const mockCc = {
  JsonAsset: class JsonAsset {},
  resources: { load() { throw new Error('not used by chapter 01 L02 contract'); } },
};
`;
const executableSource = stripTypeScriptTypes(
  `${loaderSource.replace("import { JsonAsset, resources } from 'cc';", `${mockCcSource}\nconst { JsonAsset, resources } = mockCc;`)}\n${contractSource.replace("import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';", '')}`,
  { mode: 'transform' },
);
const { assertChapterLevelContract, ConfigLoadError } = await import(
  `data:text/javascript;base64,${Buffer.from(executableSource).toString('base64')}`,
);

const level = readJson(levelPath);
const manifest = readJson(manifestPath);
const decks = readJson(decksPath);
const cards = readJson(cardsPath);
const units = readJson(unitsPath);
const story = readText(storyPath);
const sceneDoc = readText(sceneDocPath);
const cardIds = new Set(cards.cards.map(({ id }) => id));
const unitIds = new Set(units.units.map(({ id }) => id));
const deck = decks.decks.find(({ id }) => id === 'D001');
const deckCardIds = new Set(deck.cardEntries.map(({ cardId }) => cardId));

assert.doesNotThrow(
  () => assertChapterLevelContract(level, manifest, decks),
  'the real L02 file must satisfy the shared chapter-level contract',
);
assert.deepEqual(level.chapterLevels, [{
  id: 'L02',
  prerequisiteLevelId: 'L01',
  enemyDeckId: 'D001',
  environmentElement: 'NONE',
  objectives: [
    { type: 'DESTROY_TARGET', targetId: 'U013' },
    { type: 'PROTECT_TARGET', targetId: 'E102' },
  ],
  rewards: [{ type: 'CARD', id: 'U002', quantity: 4 }],
  failureConditions: [
    { type: 'PLAYER_HERO_DEFEATED' },
    { type: 'TARGET_DESTROYED', targetId: 'E102' },
  ],
}], 'L02 must retain the frozen field values');
assert.equal(cardIds.has('U002'), true, 'the L02 reward must reference the existing U002 card');
assert.equal(unitIds.has('U013'), true, 'the L02 command target must reference the existing U013 unit');
assert.equal(deckCardIds.has('U001'), true, 'D001 must contain the frontline teaching card U001');
assert.equal(deckCardIds.has('U004'), true, 'D001 must contain the ranged teaching card U004');
assert.match(story, /### 4\.2 1-2 烽台失名/);
assert.match(story, /敌方先部署轻装役兵，再部署远射单位/);
assert.match(story, /折锋枪兵军契×4/);
assert.match(sceneDoc, /### E102 烽台失名/);

function expectFailure(label, mutate, expectedPath) {
  const candidate = structuredClone(level);
  mutate(candidate);
  assert.throws(() => assertChapterLevelContract(candidate, manifest, decks), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    return true;
  });
}

expectFailure(
  'invalid prerequisite',
  (candidate) => { candidate.chapterLevels[0].prerequisiteLevelId = 'L99'; },
  'config/levels.chapterLevels[0].prerequisiteLevelId',
);
expectFailure(
  'unknown enemy deck',
  (candidate) => { candidate.chapterLevels[0].enemyDeckId = 'D404'; },
  'config/levels.chapterLevels[0].enemyDeckId',
);
expectFailure(
  'invalid ID',
  (candidate) => { candidate.chapterLevels[0].id = 'L_02'; },
  'config/levels.chapterLevels[0].id',
);
expectFailure(
  'missing failure conditions',
  (candidate) => { delete candidate.chapterLevels[0].failureConditions; },
  'config/levels.chapterLevels[0].failureConditions',
);

console.log('Chapter 01 L02: real file and shared contract PASS; frontline/ranged references, story reward, invalid prerequisite, unknown deck, invalid ID, and missing failure conditions covered');
