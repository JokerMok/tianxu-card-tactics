import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const levelConfig = readJson(path.join(configRoot, 'levels/chapter01/L05.json'));
const previousConfig = readJson(path.join(configRoot, 'levels/chapter01/L04.json'));
const manifest = readJson(path.join(configRoot, 'manifest.json'));
const decks = readJson(path.join(configRoot, 'decks.json'));
const cards = readJson(path.join(configRoot, 'cards.json'));
const units = readJson(path.join(configRoot, 'units.json'));
const skills = readJson(path.join(configRoot, 'skills.json'));
const enumCoverage = readJson(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'));
const characterDoc = fs.readFileSync(path.join(root, '../首发角色视觉设定-v1.0.md'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const contractSource = fs.readFileSync(path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts'), 'utf8');
const mockCc = `const mockCc={JsonAsset:class JsonAsset{},resources:{load(){throw new Error('not used')}}}; const {JsonAsset,resources}=mockCc;`;
const executable = stripTypeScriptTypes(
  `${loaderSource.replace("import { JsonAsset, resources } from 'cc';", mockCc)}\n${contractSource.replace("import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';", '')}`,
  { mode: 'transform' },
);
const { assertChapterLevelContract, ConfigLoadError } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);

const [level] = levelConfig.chapterLevels;
const unitRows = units.units.filter((row) => row.enabled !== false);
const skillRows = skills.skills.filter((row) => row.enabled !== false);
const unitIds = new Set(unitRows.map((row) => row.id));
const characterIds = new Set([...characterDoc.matchAll(/\|\s*(C\d+)\s*\|/gu)].map((match) => match[1]));
const rewardIds = (type) => new Set(enumCoverage.chapterLevels.flatMap((entry) => entry.rewards.filter((reward) => reward.type === type).map((reward) => reward.id)));
const references = {
  chapterLevelIds: new Set([...previousConfig.chapterLevels.map((entry) => entry.id), ...levelConfig.chapterLevels.map((entry) => entry.id)]),
  targetIds: new Set([...unitIds, ...characterIds]),
  unitIds,
  skillIds: new Set(skillRows.map((row) => row.id)),
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

assert.equal(previousConfig.chapterLevels[0].id, 'L04');
assert.equal(level.id, 'L05');
assert.equal(level.environmentElement, 'FIRE');
assert.deepEqual(level.rewards, [
  { type: 'CARD', id: 'U007', quantity: 2 },
  { type: 'CARD', id: 'U003', quantity: 3 },
]);
assert.doesNotThrow(() => assertChapterLevelContract(levelConfig, manifest, decks, references, 'config/levels/chapter01/L05'));

function assertScenarioRules(rules) {
  assert.deepEqual(rules.enemyFireUnitIds, ['U007']);
  assert.equal(unitRows.find((row) => row.id === rules.enemyFireUnitIds[0])?.element, 'FIRE');
  assert.equal(rules.burnStatus, 'BURN');
  assert.equal(rules.waterCounterMultiplier, 1.25);
  assert.equal(characterIds.has(rules.purifyAid.characterId), true);
  assert.equal(rules.purifyAid.uses, 1);
  assert.deepEqual(rules.allowAlternateResponses, ['HEAL', 'GUARD_BLOCK', 'EARLY_KILL']);
  assert.equal(rules.preserveControlledBeast, true);
}
assertScenarioRules(level.scenarioRules);
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, enemyFireUnitIds: ['U001'] }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, burnStatus: 'FREEZE' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, waterCounterMultiplier: 1 }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, purifyAid: { characterId: 'C999', uses: 1 } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, purifyAid: { characterId: 'C001', uses: 0 } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, allowAlternateResponses: ['HEAL'] }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, preserveControlledBeast: false }));

function expectFailure(label, mutate, expectedPath) {
  const candidate = structuredClone(levelConfig);
  mutate(candidate);
  assert.throws(() => assertChapterLevelContract(candidate, manifest, decks, references, 'config/levels/chapter01/L05'), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath);
    return true;
  });
}
expectFailure('invalid prerequisite', (candidate) => { candidate.chapterLevels[0].prerequisiteLevelId = 'L99'; }, 'config/levels/chapter01/L05.chapterLevels[0].prerequisiteLevelId');
expectFailure('unknown deck', (candidate) => { candidate.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels/chapter01/L05.chapterLevels[0].enemyDeckId');
expectFailure('invalid ID', (candidate) => { candidate.chapterLevels[0].id = 'L_05'; }, 'config/levels/chapter01/L05.chapterLevels[0].id');
expectFailure('reward copy limit', (candidate) => { candidate.chapterLevels[0].rewards[0].quantity = 5; }, 'config/levels/chapter01/L05.chapterLevels[0].rewards[0].quantity');
expectFailure('missing failures', (candidate) => { delete candidate.chapterLevels[0].failureConditions; }, 'config/levels/chapter01/L05.chapterLevels[0].failureConditions');

console.log('Chapter 01 L05: real L04 prerequisite, FIRE rules, U007/U003 rewards, copy limits, scenario rules and negative cases PASS');
