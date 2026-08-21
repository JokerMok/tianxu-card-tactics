import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const levelConfig = readJson(path.join(configRoot, 'levels/chapter01/L06.json'));
const previousConfig = readJson(path.join(configRoot, 'levels/chapter01/L05.json'));
const manifest = readJson(path.join(configRoot, 'manifest.json'));
const decks = readJson(path.join(configRoot, 'decks.json'));
const cards = readJson(path.join(configRoot, 'cards.json'));
const units = readJson(path.join(configRoot, 'units.json'));
const skills = readJson(path.join(configRoot, 'skills.json'));
const professions = readJson(path.join(configRoot, 'professions.json'));
const enumCoverage = readJson(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'));
const loaderSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const contractSource = fs.readFileSync(path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts'), 'utf8');
const executable = stripTypeScriptTypes(
  `${loaderSource.replace("import { JsonAsset, resources } from 'cc';", "const JsonAsset=class {}; const resources={load(){throw new Error('not used')}};")}\n${contractSource.replace("import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';", '')}`,
  { mode: 'transform' },
);
const { assertChapterLevelContract, ConfigLoadError } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);
const [level] = levelConfig.chapterLevels;
const unitIds = new Set(units.units.filter((row) => row.enabled !== false).map((row) => row.id));
const skillIds = new Set(skills.skills.filter((row) => row.enabled !== false).map((row) => row.id));
const rewardIds = (type) => new Set(enumCoverage.chapterLevels.flatMap((entry) => entry.rewards.filter((reward) => reward.type === type).map((reward) => reward.id)));
const references = {
  chapterLevelIds: new Set([...previousConfig.chapterLevels.map((entry) => entry.id), ...levelConfig.chapterLevels.map((entry) => entry.id)]),
  targetIds: unitIds,
  unitIds,
  skillIds,
  cards: new Map(cards.cards.filter((row) => row.enabled !== false).map((row) => [row.id, {
    cardType: row.cardType,
    copyLimit: row.copyLimit,
    ...(row.unitId ? { unitId: row.unitId } : {}),
    ...(row.skillId ? { skillId: row.skillId } : {}),
  }])),
  unlockIds: rewardIds('UNLOCK'),
  chestIds: rewardIds('CHEST'),
  flagIds: rewardIds('FLAG'),
};

assert.equal(previousConfig.chapterLevels[0].id, 'L05');
assert.doesNotThrow(() => assertChapterLevelContract(levelConfig, manifest, decks, references, 'config/levels/chapter01/L06'));
assert.deepEqual(
  {
    id: level.id,
    prerequisiteLevelId: level.prerequisiteLevelId,
    enemyDeckId: level.enemyDeckId,
    environmentElement: level.environmentElement,
  },
  {
    id: 'L06',
    prerequisiteLevelId: 'L05',
    enemyDeckId: 'D001',
    environmentElement: 'WATER',
  },
  'L06 must bind the real prerequisite, enemy deck, and environment',
);
assert.deepEqual(level.objectives, [{ type: 'DEFEAT_ENEMY_HERO' }]);
assert.deepEqual(level.rewards, [{ type: 'CARD', id: 'S004', quantity: 1, cardType: 'SKILL' }]);
assert.deepEqual(level.failureConditions, [{ type: 'PLAYER_HERO_DEFEATED' }]);
assert.equal(professions.professions.find((row) => row.id === 'P001')?.skillIds[0], 'S004');

function assertScenarioRules(rules) {
  assert.equal(rules.rewardPolicy, 'CURRENT_PROFESSION_SKILL_I');
  assert.equal(rules.environmentElement, 'WATER');
  assert.equal(rules.sameElementEffectBonusPercent, 10);
  assert.equal(rules.fireEffectPenaltyPercent, -10);
  assert.equal(rules.freezeStatus, 'FREEZE');
  assert.equal(rules.purifyAvailable, true);
  assert.equal(rules.preBattleEnvironmentReadRequired, true);
  assert.deepEqual(rules.alternateSolutions, ['PURIFY', 'SPREAD_DEPLOYMENT', 'LANE_SWAP', 'FIRE_DAMAGE']);
}
assertScenarioRules(level.scenarioRules);
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, rewardPolicy: 'RANDOM_SKILL' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, environmentElement: 'FIRE' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, sameElementEffectBonusPercent: 0 }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, fireEffectPenaltyPercent: 0 }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, freezeStatus: 'BURN' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, purifyAvailable: false }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, preBattleEnvironmentReadRequired: false }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, alternateSolutions: ['PURIFY'] }));

function expectFailure(label, mutate, expectedPath) {
  const candidate = structuredClone(levelConfig);
  mutate(candidate);
  assert.throws(() => assertChapterLevelContract(candidate, manifest, decks, references, 'config/levels/chapter01/L06'), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath);
    return true;
  });
}
expectFailure('invalid prerequisite', (candidate) => { candidate.chapterLevels[0].prerequisiteLevelId = 'L99'; }, 'config/levels/chapter01/L06.chapterLevels[0].prerequisiteLevelId');
expectFailure('unknown deck', (candidate) => { candidate.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels/chapter01/L06.chapterLevels[0].enemyDeckId');
expectFailure('invalid ID', (candidate) => { candidate.chapterLevels[0].id = 'L_06'; }, 'config/levels/chapter01/L06.chapterLevels[0].id');
expectFailure('skill copy limit', (candidate) => { candidate.chapterLevels[0].rewards[0].quantity = 2; }, 'config/levels/chapter01/L06.chapterLevels[0].rewards[0].quantity');
expectFailure('missing failures', (candidate) => { delete candidate.chapterLevels[0].failureConditions; }, 'config/levels/chapter01/L06.chapterLevels[0].failureConditions');
expectFailure('empty failures', (candidate) => { candidate.chapterLevels[0].failureConditions = []; }, 'config/levels/chapter01/L06.chapterLevels[0].failureConditions');

console.log('Chapter 01 L06: real L05 prerequisite, WATER environment, profession skill I, freeze/purify rules, reward limit and negative cases PASS');
