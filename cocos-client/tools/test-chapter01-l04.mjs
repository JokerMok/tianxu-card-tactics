import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const projectRoot = path.resolve(root, '..');
const levelPath = path.join(root, 'assets/resources/config/levels/chapter01/L04.json');
const manifestPath = path.join(root, 'assets/resources/config/manifest.json');
const decksPath = path.join(root, 'assets/resources/config/decks.json');
const cardsPath = path.join(root, 'assets/resources/config/cards.json');
const contractPath = path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts');
const loaderPath = path.join(root, 'assets/scripts/config/ConfigLoader.ts');

const loaderSource = fs.readFileSync(loaderPath, 'utf8');
const contractSource = fs.readFileSync(contractPath, 'utf8');
const mockCcSource = `
const mockCc = {
  JsonAsset: class JsonAsset {},
  resources: { load() { throw new Error('not used by chapter level config test'); } },
};
`;
const executableSource = stripTypeScriptTypes(
  `${loaderSource.replace("import { JsonAsset, resources } from 'cc';", `${mockCcSource}\nconst { JsonAsset, resources } = mockCc;`)}\n${contractSource.replace("import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';", '')}`,
  { mode: 'transform' },
);
const { assertChapterLevelContract, ConfigLoadError } = await import(
  `data:text/javascript;base64,${Buffer.from(executableSource).toString('base64')}`,
);

const levelConfig = JSON.parse(fs.readFileSync(levelPath, 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const decks = JSON.parse(fs.readFileSync(decksPath, 'utf8'));
const cards = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));

assert.doesNotThrow(
  () => assertChapterLevelContract(levelConfig, manifest, decks, 'config/levels/chapter01/L04'),
  'L04 must pass the shared chapter level contract',
);
assert.equal(levelConfig.chapterLevels.length, 1, 'L04 must contain exactly one chapter level');

const [level] = levelConfig.chapterLevels;
assert.deepEqual(
  {
    id: level.id,
    prerequisiteLevelId: level.prerequisiteLevelId,
    enemyDeckId: level.enemyDeckId,
    environmentElement: level.environmentElement,
  },
  {
    id: 'L04',
    prerequisiteLevelId: 'L03',
    enemyDeckId: 'D001',
    environmentElement: 'NONE',
  },
  'L04 must use the documented chapter sequence, real enemy deck, and neutral environment',
);
assert.deepEqual(level.objectives, [{ type: 'DEFEAT_ENEMY_HERO' }], 'L04 must use the R1 mirror victory objective');
assert.deepEqual(
  level.rewards,
  [
    { type: 'CARD', id: 'U005', quantity: 3 },
    { type: 'CARD', id: 'U006', quantity: 2 },
  ],
  'L04 rewards must match the documented first-clear rewards',
);
assert.deepEqual(
  level.failureConditions,
  [{ type: 'PLAYER_HERO_DEFEATED' }],
  'L04 must retain the documented R1 hero-defeat failure condition without turning timeout into unconditional defeat',
);

const deck = decks.decks.find(({ id }) => id === level.enemyDeckId);
assert(deck, 'L04 must reference a real deck record');
assert.equal(deck.totalCards, 30, 'L04 enemy deck must mirror the R1 thirty-card deck');
assert.equal(deck.minUnitCards, 24, 'L04 enemy deck must retain the R1 unit-card floor');
assert.equal(deck.maxSkillCards, 6, 'L04 enemy deck must retain the R1 skill-card ceiling');
const cardIds = new Set(cards.cards.map(({ id }) => id));
for (const reward of level.rewards) {
  assert.equal(cardIds.has(reward.id), true, `L04 reward must reference real card ${reward.id}`);
}

const storySource = fs.readFileSync(path.join(projectRoot, '首章剧情关卡-v1.1.md'), 'utf8');
const r1Source = fs.readFileSync(path.join(projectRoot, '第一章关卡与敌方规则.md'), 'utf8');
assert.match(storySource, /### 4\.4 1-4 双线交锋/);
assert.match(storySource, /完整两路战斗与托管/);
assert.match(storySource, /流光驭手军契×3、风迹侦猎者军契×2/);
assert.match(r1Source, /\| 玩家英雄生命 \| 30 \|/);
assert.match(r1Source, /\| 敌方英雄生命 \| 30 \|/);
assert.match(r1Source, /\| 战场 \| 两路十二格；双方 `2×3` 召唤区 \|/);
assert.match(r1Source, /\| 回合上限 \| 80 \|/);
assert.match(r1Source, /\| 玩家行动窗口 \| 手动结束；可开启完整自动托管并随时关闭接管 \|/);
assert.match(r1Source, /\| 默认种子 \| 20260712 \|/);

function expectFailure(label, mutate, expectedPath) {
  const fixture = structuredClone(levelConfig);
  mutate(fixture);
  assert.throws(() => assertChapterLevelContract(fixture, manifest, decks, 'config/levels/chapter01/L04'), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    return true;
  });
}

expectFailure(
  'invalid prerequisite',
  (fixture) => { fixture.chapterLevels[0].prerequisiteLevelId = 'C01'; },
  'config/levels/chapter01/L04.chapterLevels[0].prerequisiteLevelId',
);
expectFailure(
  'unknown enemy deck',
  (fixture) => { fixture.chapterLevels[0].enemyDeckId = 'D404'; },
  'config/levels/chapter01/L04.chapterLevels[0].enemyDeckId',
);
expectFailure(
  'invalid ID',
  (fixture) => { fixture.chapterLevels[0].id = 'L_04'; },
  'config/levels/chapter01/L04.chapterLevels[0].id',
);
expectFailure(
  'missing failure conditions',
  (fixture) => { delete fixture.chapterLevels[0].failureConditions; },
  'config/levels/chapter01/L04.chapterLevels[0].failureConditions',
);
expectFailure(
  'invalid reward ID',
  (fixture) => { fixture.chapterLevels[0].rewards[0].id = 'U_005'; },
  'config/levels/chapter01/L04.chapterLevels[0].rewards[0].id',
);

console.log('L04 chapter config: real file, shared contract, L03 prerequisite, D001 deck, U005/U006 rewards, two-lane R1/manual/auto evidence, and invalid prerequisite/deck/ID/failure cases PASS');
