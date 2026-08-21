import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const levelPath = path.join(root, 'assets/resources/config/levels/chapter01/L03.json');
const manifestPath = path.join(root, 'assets/resources/config/manifest.json');
const decksPath = path.join(root, 'assets/resources/config/decks.json');
const cardsPath = path.join(root, 'assets/resources/config/cards.json');
const unitsPath = path.join(root, 'assets/resources/config/units.json');
const skillsPath = path.join(root, 'assets/resources/config/skills.json');
const enumFixturePath = path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json');
const storyPath = path.join(root, '..', '首章剧情关卡-v1.1.md');
const characterPath = path.join(root, '..', '首发角色视觉设定-v1.0.md');

const loaderSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const contractSource = fs.readFileSync(path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts'), 'utf8');
const mockCcSource = `
const mockCc = {
  JsonAsset: class JsonAsset {},
  resources: { load() { throw new Error('not used by chapter 01 L03 contract test'); } },
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
const previousLevelConfig = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/levels/chapter01/L02.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const decks = JSON.parse(fs.readFileSync(decksPath, 'utf8'));
const cards = JSON.parse(fs.readFileSync(cardsPath, 'utf8'));
const units = JSON.parse(fs.readFileSync(unitsPath, 'utf8'));
const skills = JSON.parse(fs.readFileSync(skillsPath, 'utf8'));
const enumCoverage = JSON.parse(fs.readFileSync(enumFixturePath, 'utf8'));
const story = fs.readFileSync(storyPath, 'utf8');
const characterSheet = fs.readFileSync(characterPath, 'utf8');
const unitIds = new Set(units.units.filter((unit) => unit.enabled !== false).map((unit) => unit.id));
const chapterLevelIds = new Set([
  ...previousLevelConfig.chapterLevels.map((entry) => entry.id),
  ...levelConfig.chapterLevels.map((entry) => entry.id),
]);
const characterTargetIds = new Set([...characterSheet.matchAll(/\|\s*(C\d+)\s*\|/gu)].map((match) => match[1]));
const rewardIds = (type) => new Set(enumCoverage.chapterLevels.flatMap((entry) => entry.rewards.filter((reward) => reward.type === type).map((reward) => reward.id)));
const references = {
  chapterLevelIds,
  targetIds: new Set([...unitIds, ...characterTargetIds]),
  unitIds,
  skillIds: new Set(skills.skills.filter((skill) => skill.enabled !== false).map((skill) => skill.id)),
  cards: new Map(cards.cards.filter((card) => card.enabled !== false).map((card) => [card.id, {
    cardType: card.cardType,
    copyLimit: card.copyLimit,
    ...(card.unitId ? { unitId: card.unitId } : {}),
    ...(card.skillId ? { skillId: card.skillId } : {}),
  }])),
  unlockIds: rewardIds('UNLOCK'),
  chestIds: rewardIds('CHEST'),
  flagIds: rewardIds('FLAG'),
};

assert.doesNotThrow(
  () => assertChapterLevelContract(levelConfig, manifest, decks, references, 'config/levels/chapter01/L03.json'),
  'the real L03 config must pass the shared chapter level contract',
);

assert.equal(levelConfig.chapterLevels.length, 1, 'L03 file must contain exactly one level');
const [level] = levelConfig.chapterLevels;
assert.equal(previousLevelConfig.chapterLevels[0].id, 'L02', 'L03 prerequisite must exist in the preceding real level file');
assert.deepEqual(
  {
    id: level.id,
    prerequisiteLevelId: level.prerequisiteLevelId,
    enemyDeckId: level.enemyDeckId,
    environmentElement: level.environmentElement,
  },
  {
    id: 'L03',
    prerequisiteLevelId: 'L02',
    enemyDeckId: 'D001',
    environmentElement: 'NONE',
  },
  'L03 identity, prerequisite, enemy deck, and environment must match the chapter data',
);
assert.deepEqual(
  level.objectives,
  [
    { type: 'DEFEAT_ENEMY_HERO' },
    { type: 'PROTECT_TARGET', targetId: 'C002' },
  ],
  'L03 must defeat the enemy and protect 翎照',
);
assert.deepEqual(
  level.rewards,
  [{ type: 'CARD', id: 'U004', quantity: 4 }],
  'L03 must grant four 岚羽游射手 cards',
);
assert.deepEqual(
  level.failureConditions,
  [
    { type: 'PLAYER_HERO_DEFEATED' },
    { type: 'TARGET_DESTROYED', targetId: 'C002' },
  ],
  'L03 must fail when the player hero or 翎照 is defeated',
);
assert.deepEqual(level.battleRules, {
  fastUnitIds: ['U005'],
  guardUnitIds: ['U001'],
  interceptUnitIds: ['U002'],
  movementTrigger: { distance: 2, responseUnitId: 'U002' },
  temporaryAid: { targetId: 'C002', mode: 'PROTECT' },
  requiredResponses: ['GUARD_BLOCK_FAST', 'INTERCEPT_AFTER_TWO_CELL_MOVE'],
}, 'L03 must encode fast/guard/intercept and temporary aid rules');
function assertL03BattleRules(rules) {
  assert.deepEqual(rules.fastUnitIds, ['U005']);
  assert.deepEqual(rules.guardUnitIds, ['U001']);
  assert.deepEqual(rules.interceptUnitIds, ['U002']);
  for (const id of [...rules.fastUnitIds, ...rules.guardUnitIds, ...rules.interceptUnitIds]) assert.equal(unitIds.has(id), true);
  assert.equal(rules.movementTrigger.distance, 2);
  assert.equal(unitIds.has(rules.movementTrigger.responseUnitId), true);
  assert.deepEqual(rules.temporaryAid, { targetId: 'C002', mode: 'PROTECT' });
  assert.equal(characterTargetIds.has(rules.temporaryAid.targetId), true);
  assert.deepEqual(rules.requiredResponses, ['GUARD_BLOCK_FAST', 'INTERCEPT_AFTER_TWO_CELL_MOVE']);
}
assertL03BattleRules(level.battleRules);
assert.throws(() => assertL03BattleRules({ ...level.battleRules, fastUnitIds: ['U999'] }));
assert.throws(() => assertL03BattleRules({ ...level.battleRules, guardUnitIds: ['U999'] }));
assert.throws(() => assertL03BattleRules({ ...level.battleRules, interceptUnitIds: ['U999'] }));
assert.throws(() => assertL03BattleRules({ ...level.battleRules, movementTrigger: { distance: 1, responseUnitId: 'U002' } }));
assert.throws(() => assertL03BattleRules({ ...level.battleRules, movementTrigger: { distance: 2, responseUnitId: 'U999' } }));
assert.throws(() => assertL03BattleRules({ ...level.battleRules, temporaryAid: { targetId: 'C999', mode: 'PROTECT' } }));
assert.throws(() => assertL03BattleRules({ ...level.battleRules, temporaryAid: { targetId: 'C002', mode: 'ATTACK' } }));
assert.throws(() => assertL03BattleRules({ ...level.battleRules, requiredResponses: ['GUARD_BLOCK_FAST'] }));

assert.equal(decks.decks.some((deck) => deck.id === level.enemyDeckId), true, 'L03 must use a real enemy deck');
assert.equal(cards.cards.some((card) => card.id === 'U004'), true, 'L03 reward U004 must exist in cards.json');
assert.match(story, /\| 1-2 \| 烽台失名 \|/u, 'L02 must be a real preceding chapter node');
assert.match(story, /### 4\.3 1-3 风谷截路/u, 'L03 must be grounded in the chapter story');
assert.match(story, /岚羽游射手军契×4/u, 'the L03 reward quantity must be grounded in the chapter story');
assert.match(characterSheet, /\| C002 \| 翎照 \|/u, 'C002 must be a real documented target');

function expectFailure(label, mutate, expectedPath) {
  const fixture = structuredClone(levelConfig);
  mutate(fixture);
  assert.throws(() => assertChapterLevelContract(fixture, manifest, decks, references, 'config/levels/chapter01/L03.json'), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
    return true;
  });
}

expectFailure(
  'illegal prerequisite',
  (fixture) => { fixture.chapterLevels[0].prerequisiteLevelId = 'L03'; },
  'config/levels/chapter01/L03.json.chapterLevels[0].prerequisiteLevelId',
);
expectFailure(
  'unknown enemy deck',
  (fixture) => { fixture.chapterLevels[0].enemyDeckId = 'D404'; },
  'config/levels/chapter01/L03.json.chapterLevels[0].enemyDeckId',
);
expectFailure(
  'invalid level ID',
  (fixture) => { fixture.chapterLevels[0].id = 'L_03'; },
  'config/levels/chapter01/L03.json.chapterLevels[0].id',
);
expectFailure(
  'missing failure conditions',
  (fixture) => { delete fixture.chapterLevels[0].failureConditions; },
  'config/levels/chapter01/L03.json.chapterLevels[0].failureConditions',
);
expectFailure(
  'empty failure conditions',
  (fixture) => { fixture.chapterLevels[0].failureConditions = []; },
  'config/levels/chapter01/L03.json.chapterLevels[0].failureConditions',
);
expectFailure(
  'invalid environment',
  (fixture) => { fixture.chapterLevels[0].environmentElement = 'VOID'; },
  'config/levels/chapter01/L03.json.chapterLevels[0].environmentElement',
);
expectFailure(
  'unknown objective target',
  (fixture) => { fixture.chapterLevels[0].objectives[1].targetId = 'C404'; },
  'config/levels/chapter01/L03.json.chapterLevels[0].objectives[1].targetId',
);
expectFailure(
  'unknown reward card',
  (fixture) => { fixture.chapterLevels[0].rewards[0].id = 'U999'; },
  'config/levels/chapter01/L03.json.chapterLevels[0].rewards[0].id',
);
expectFailure(
  'invalid failure type',
  (fixture) => { fixture.chapterLevels[0].failureConditions[0].type = 'UNSUPPORTED'; },
  'config/levels/chapter01/L03.json.chapterLevels[0].failureConditions[0].type',
);

console.log('Chapter 01 L03: real config, L02 prerequisite, D001 deck, C002 protection target, U004 x4 reward, and failure conditions PASS; illegal prerequisite, unknown deck, invalid ID, and missing failure conditions FAIL as expected');
