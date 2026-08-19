import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const levelConfig = readJson(path.join(configRoot, 'levels/chapter01/L07.json'));
const previousConfig = readJson(path.join(configRoot, 'levels/chapter01/L06.json'));
const manifest = readJson(path.join(configRoot, 'manifest.json'));
const decks = readJson(path.join(configRoot, 'decks.json'));
const cards = readJson(path.join(configRoot, 'cards.json'));
const units = readJson(path.join(configRoot, 'units.json'));
const skills = readJson(path.join(configRoot, 'skills.json'));
const enumCoverage = readJson(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'));
const characterDoc = fs.readFileSync(path.join(root, '../首发角色视觉设定-v1.0.md'), 'utf8');
const cardDesignDoc = fs.readFileSync(path.join(root, '../第一批卡牌设计表.md'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const contractSource = fs.readFileSync(path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts'), 'utf8');
const executable = stripTypeScriptTypes(
  `${loaderSource.replace("import { JsonAsset, resources } from 'cc';", "const JsonAsset=class {}; const resources={load(){throw new Error('not used')}};")}
${contractSource.replace("import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';", '')}`,
  { mode: 'transform' },
);
const { assertChapterLevelContract, ConfigLoadError } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);

const [level] = levelConfig.chapterLevels;
const unitRows = units.units.filter((row) => row.enabled !== false);
const unitById = new Map(unitRows.map((row) => [row.id, row]));
const unitIds = new Set(unitRows.map((row) => row.id));
const skillIds = new Set(skills.skills.filter((row) => row.enabled !== false).map((row) => row.id));
const characterIds = new Set([...characterDoc.matchAll(/\|\s*(C\d+)\s*\|/gu)].map((match) => match[1]));
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

assert.equal(previousConfig.chapterLevels[0].id, 'L06');
assert.equal(level.id, 'L07');
assert.equal(level.environmentElement, 'EARTH');
assert.deepEqual(level.rewards, [
  { type: 'CARD', id: 'U012', quantity: 2 },
  { type: 'CARD', id: 'U011', quantity: 2 },
]);
assert.doesNotThrow(() => assertChapterLevelContract(levelConfig, manifest, decks, references, 'config/levels/chapter01/L07'));

function assertScenarioRules(rules) {
  assert.equal(rules.environmentElement, 'EARTH');
  assert.deepEqual(rules.enemyHeavyUnitIds, ['U001']);
  assert.equal(unitById.get(rules.enemyHeavyUnitIds[0])?.defenseType, 'HEAVY');
  assert.deepEqual(rules.enemyGiantUnitIds, ['U012']);
  assert.equal(unitById.get(rules.enemyGiantUnitIds[0])?.defenseType, 'GIANT');
  assert.equal(rules.impactCounter.targetDefenseType, 'HEAVY');
  assert.equal(rules.impactCounter.requiredOffenseType, 'IMPACT');
  assert.deepEqual(rules.impactCounter.availableUnitIds, ['U011', 'U012']);
  assert(rules.impactCounter.availableUnitIds.every((id) => unitById.get(id)?.offenseType === 'IMPACT'));
  assert.equal(rules.pierceCounter.targetDefenseType, 'GIANT');
  assert.equal(rules.pierceCounter.requiredOffenseType, 'PIERCE');
  assert.deepEqual(rules.pierceCounter.availableUnitIds, ['U002']);
  assert(rules.pierceCounter.availableUnitIds.every((id) => unitById.get(id)?.offenseType === 'PIERCE'));
  assert.equal(rules.knockbackRule.sourceUnitId, 'U012');
  assert.equal(rules.knockbackRule.distance, 1);
  assert.equal(characterIds.has(rules.temporaryAid.characterId), true);
  assert.equal(rules.temporaryAid.mode, 'RULE_ALLY');
  assert.equal(rules.temporaryAid.durationRounds, 2);
  assert.deepEqual(rules.alternateSolutions, ['SPELL_BYPASS_ARMOR', 'PIERCE_COUNTER', 'KNOCKBACK_CONTROL']);
  assert.match(cardDesignDoc, /\| U012 \|[^\n]*击退 1/);
}
assertScenarioRules(level.scenarioRules);
assert.throws(() => assertScenarioRules({}));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, environmentElement: 'FIRE' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, enemyHeavyUnitIds: ['U012'] }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, enemyGiantUnitIds: ['U001'] }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, impactCounter: { ...level.scenarioRules.impactCounter, requiredOffenseType: 'SLASH' } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, pierceCounter: { ...level.scenarioRules.pierceCounter, availableUnitIds: ['U001'] } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, knockbackRule: { ...level.scenarioRules.knockbackRule, distance: 0 } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, temporaryAid: { ...level.scenarioRules.temporaryAid, characterId: 'C999' } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, alternateSolutions: ['SPELL_BYPASS_ARMOR'] }));

function expectFailure(label, mutate, expectedPath) {
  const candidate = structuredClone(levelConfig);
  mutate(candidate);
  assert.throws(() => assertChapterLevelContract(candidate, manifest, decks, references, 'config/levels/chapter01/L07'), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath);
    return true;
  });
}
expectFailure('invalid prerequisite', (candidate) => { candidate.chapterLevels[0].prerequisiteLevelId = 'L99'; }, 'config/levels/chapter01/L07.chapterLevels[0].prerequisiteLevelId');
expectFailure('unknown deck', (candidate) => { candidate.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels/chapter01/L07.chapterLevels[0].enemyDeckId');
expectFailure('invalid ID', (candidate) => { candidate.chapterLevels[0].id = 'L_07'; }, 'config/levels/chapter01/L07.chapterLevels[0].id');
expectFailure('unit reward copy limit', (candidate) => { candidate.chapterLevels[0].rewards[0].quantity = 3; }, 'config/levels/chapter01/L07.chapterLevels[0].rewards[0].quantity');
expectFailure('unknown reward card', (candidate) => { candidate.chapterLevels[0].rewards[0].id = 'U999'; }, 'config/levels/chapter01/L07.chapterLevels[0].rewards[0].id');
expectFailure('missing failures', (candidate) => { delete candidate.chapterLevels[0].failureConditions; }, 'config/levels/chapter01/L07.chapterLevels[0].failureConditions');

console.log('Chapter 01 L07: real L06 prerequisite, EARTH heavy/giant counters, impact/pierce/knockback rules, C003 two-round aid, rewards and negative cases PASS');
