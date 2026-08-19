import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const levelPath = path.join(configRoot, 'levels/chapter01/L01.json');
const loaderSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const contractSource = fs.readFileSync(path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts'), 'utf8');
const mockCcSource = `
const mockCc = {
  JsonAsset: class JsonAsset {},
  resources: { load() { throw new Error('not used by chapter level contract'); } },
};
`;
const executableSource = stripTypeScriptTypes(
  `${loaderSource.replace("import { JsonAsset, resources } from 'cc';", `${mockCcSource}\nconst { JsonAsset, resources } = mockCc;`)}\n${contractSource.replace("import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';", '')}`,
  { mode: 'transform' },
);
const { assertChapterLevelContract, ConfigLoadError } = await import(
  `data:text/javascript;base64,${Buffer.from(executableSource).toString('base64')}`,
);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

const levelDocument = readJson(levelPath);
const level = levelDocument.chapterLevels[0];
const manifest = readJson(path.join(configRoot, 'manifest.json'));
const decks = readJson(path.join(configRoot, 'decks.json'));
const cards = readJson(path.join(configRoot, 'cards.json'));
const units = readJson(path.join(configRoot, 'units.json'));
const skills = readJson(path.join(configRoot, 'skills.json'));
const enumCoverage = readJson(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'));
const deckIds = new Set(decks.decks.map(({ id }) => id));
const cardIds = new Set(cards.cards.map(({ id }) => id));
const chapterLevelIds = new Set([level.id]);
const rewardIds = (type) => new Set(enumCoverage.chapterLevels.flatMap((entry) => entry.rewards.filter((reward) => reward.type === type).map((reward) => reward.id)));
const references = {
  chapterLevelIds,
  targetIds: new Set(units.units.filter((unit) => unit.enabled !== false).map((unit) => unit.id)),
  unitIds: new Set(units.units.filter((unit) => unit.enabled !== false).map((unit) => unit.id)),
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

assert.deepEqual(
  Object.keys(level).sort(),
  ['enemyDeckId', 'environmentElement', 'failureConditions', 'id', 'objectives', 'prerequisiteLevelId', 'rewards', 'scenarioRules'],
  'L01 must contain the T331 level fields and scenario rules',
);
assert.equal(level.id, 'L01', 'L01 ID must be the first chapter level');
assert.equal(level.prerequisiteLevelId, null, 'L01 must have no prerequisite');
assert.equal(level.enemyDeckId, 'D001', 'L01 must use the real basic enemy deck');
assert(deckIds.has(level.enemyDeckId), 'L01 enemy deck must exist in decks.json');
assert.equal(level.environmentElement, 'NONE', 'L01 must not add an environment modifier');
assert.deepEqual(level.objectives, [{ type: 'DEFEAT_ENEMY_HERO' }], 'L01 must teach basic deployment against the enemy hero');
assert.deepEqual(
  level.rewards,
  [{ type: 'CARD', id: 'U001', quantity: 4 }],
  'L01 first-clear reward must be four U001 contracts',
);
assert(cardIds.has(level.rewards[0].id), 'L01 reward ID must exist in cards.json');
assert.equal(level.rewards.every(({ type }) => type === 'CARD'), true, 'L01 opening must not grant a skill reward');
assert.deepEqual(
  level.failureConditions,
  [{ type: 'PLAYER_HERO_DEFEATED' }],
  'L01 must fail when the player hero is defeated',
);
assert.deepEqual(level.scenarioRules, {
  playerHeroHp: 30,
  activeLaneCount: 1,
  playerSummonSlots: 3,
  unlockSecondLaneOnFirstDeployment: true,
  openingSkillCardsAllowed: false,
  enemyOpeningCardFilter: 'UNITS_ONLY',
}, 'L01 must encode the one-lane deployment tutorial rules');
function assertL01ScenarioRules(rules) {
  assert.equal(rules.playerHeroHp, 30);
  assert.equal(rules.activeLaneCount, 1);
  assert.equal(rules.playerSummonSlots, 3);
  assert.equal(rules.unlockSecondLaneOnFirstDeployment, true);
  assert.equal(rules.openingSkillCardsAllowed, false);
  assert.equal(rules.enemyOpeningCardFilter, 'UNITS_ONLY');
}
assertL01ScenarioRules(level.scenarioRules);
assert.throws(() => assertL01ScenarioRules({ ...level.scenarioRules, playerHeroHp: 0 }));

assert.doesNotThrow(
  () => assertChapterLevelContract(levelDocument, manifest, decks, references, 'config/levels/chapter01/L01'),
  'real L01 must pass the shared chapter-level contract',
);

function expectFailure(label, mutate, expectedPath) {
  const invalidLevel = structuredClone(level);
  mutate(invalidLevel);
  assert.throws(
    () => assertChapterLevelContract({ chapterLevels: [invalidLevel] }, manifest, decks, references, 'config/levels/chapter01/L01'),
    (error) => {
      assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
      assert.equal(error.configPath, expectedPath, `${label} must report ${expectedPath}`);
      return true;
    },
  );
}

expectFailure(
  'invalid prerequisite',
  (invalidLevel) => { invalidLevel.prerequisiteLevelId = 'C01'; },
  'config/levels/chapter01/L01.chapterLevels[0].prerequisiteLevelId',
);
expectFailure(
  'unknown enemy deck',
  (invalidLevel) => { invalidLevel.enemyDeckId = 'D404'; },
  'config/levels/chapter01/L01.chapterLevels[0].enemyDeckId',
);
expectFailure(
  'invalid level ID',
  (invalidLevel) => { invalidLevel.id = 'L_01'; },
  'config/levels/chapter01/L01.chapterLevels[0].id',
);
expectFailure(
  'missing failure conditions',
  (invalidLevel) => { delete invalidLevel.failureConditions; },
  'config/levels/chapter01/L01.chapterLevels[0].failureConditions',
);
expectFailure(
  'invalid target ID',
  (invalidLevel) => { invalidLevel.objectives = [{ type: 'DESTROY_TARGET', targetId: 'U_001' }]; },
  'config/levels/chapter01/L01.chapterLevels[0].objectives[0].targetId',
);
expectFailure(
  'unknown reward ID',
  (invalidLevel) => { invalidLevel.rewards[0].id = 'D001'; },
  'config/levels/chapter01/L01.chapterLevels[0].rewards[0].id',
);
expectFailure(
  'reward copy limit overflow',
  (invalidLevel) => { invalidLevel.rewards[0].quantity = 5; },
  'config/levels/chapter01/L01.chapterLevels[0].rewards[0].quantity',
);
expectFailure(
  'invalid failure condition type',
  (invalidLevel) => { invalidLevel.failureConditions[0].type = 'UNSUPPORTED'; },
  'config/levels/chapter01/L01.chapterLevels[0].failureConditions[0].type',
);

console.log('Chapter 01 L01 config: real fields and references PASS; invalid prerequisite, unknown enemy deck, invalid ID, missing failure conditions, and invalid target ID FAIL as expected');
