import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const levelConfig = readJson(path.join(configRoot, 'levels/chapter01/L08.json'));
const previousConfig = readJson(path.join(configRoot, 'levels/chapter01/L07.json'));
const manifest = readJson(path.join(configRoot, 'manifest.json'));
const decks = readJson(path.join(configRoot, 'decks.json'));
const cards = readJson(path.join(configRoot, 'cards.json'));
const units = readJson(path.join(configRoot, 'units.json'));
const skills = readJson(path.join(configRoot, 'skills.json'));
const professions = readJson(path.join(configRoot, 'professions.json'));
const enumCoverage = readJson(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'));
const characterDoc = fs.readFileSync(path.join(root, '../首发角色视觉设定-v1.0.md'), 'utf8');
const chapterDoc = fs.readFileSync(path.join(root, '../首章剧情关卡-v1.1.md'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'assets/scripts/config/ConfigLoader.ts'), 'utf8');
const contractSource = fs.readFileSync(path.join(root, 'assets/scripts/config/levels/ChapterLevelContract.ts'), 'utf8');
const executable = stripTypeScriptTypes(
  `${loaderSource.replace("import { JsonAsset, resources } from 'cc';", "const JsonAsset=class {}; const resources={load(){throw new Error('not used')}};")}
${contractSource.replace("import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';", '')}`,
  { mode: 'transform' },
);
const { assertChapterLevelContract, ConfigLoadError } = await import(`data:text/javascript;base64,${Buffer.from(executable).toString('base64')}`);

const [level] = levelConfig.chapterLevels;
const previousLevel = previousConfig.chapterLevels[0];
const unitIds = new Set(units.units.filter((row) => row.enabled !== false).map((row) => row.id));
const skillIds = new Set(skills.skills.filter((row) => row.enabled !== false).map((row) => row.id));
const characterIds = new Set([...characterDoc.matchAll(/\|\s*(C\d+)\s*\|/gu)].map((match) => match[1]));
const targetIds = new Set([...unitIds, ...characterIds]);
const profession = professions.professions.find((row) => row.id === 'P001');
const rewardIds = (type) => new Set(enumCoverage.chapterLevels.flatMap((entry) => entry.rewards.filter((reward) => reward.type === type).map((reward) => reward.id)));
const references = {
  chapterLevelIds: new Set([...previousConfig.chapterLevels.map((entry) => entry.id), ...levelConfig.chapterLevels.map((entry) => entry.id)]),
  targetIds,
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

assert.equal(previousLevel.id, 'L07');
assert.equal(level.id, 'L08');
assert.equal(level.objectives[0].targetId, 'C009');
assert.equal(level.objectives[1].rounds, 8);
assert.deepEqual(level.failureConditions[2], { type: 'ROUND_LIMIT_REACHED', rounds: 8 });
assert.deepEqual(level.rewards, [
  { type: 'CARD', id: 'U008', quantity: 1 },
  { type: 'CARD', id: 'S006', quantity: 1, cardType: 'SKILL' },
]);
assert.equal(profession?.skillIds[1], 'S006');
assert.match(chapterDoc, /目标是在规定回合内保护神册载具/);
assert.match(characterDoc, /\| C009 \| 岳沉戈 \|/);
assert.doesNotThrow(() => assertChapterLevelContract(levelConfig, manifest, decks, references, 'config/levels/chapter01/L08'));

function assertScenarioRules(rules) {
  assert.equal(rules.protectedTargetId, 'C009');
  assert.equal(characterIds.has(rules.protectedTargetId), true);
  assert.equal(rules.roundLimit, 8);
  assert.equal(rules.playerHeroNamingImmune, true);
  assert.equal(rules.namingTargetPolicy, 'NON_HERO_UNITS_ONLY');
  assert.equal(rules.prepareIncrease, 1);
  assert.equal(rules.shortControlDurationRounds, 1);
  assert.equal(rules.professionSkillPolicy, 'CURRENT_PROFESSION_SKILL_II');
  assert.equal(rules.professionSkillIdForP001, profession?.skillIds[1]);
  assert.equal(rules.recordProfessionAfterVictory, true);
  assert.equal(rules.professionSwitchPreview, true);
}
assertScenarioRules(level.scenarioRules);
assert.throws(() => assertScenarioRules({}));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, protectedTargetId: 'C999' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, roundLimit: 0 }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, playerHeroNamingImmune: false }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, namingTargetPolicy: 'ALL_UNITS' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, prepareIncrease: 0 }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, shortControlDurationRounds: 2 }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, professionSkillPolicy: 'FIXED_SKILL' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, professionSkillIdForP001: 'S004' }));

function expectFailure(label, mutate, expectedPath) {
  const candidate = structuredClone(levelConfig);
  mutate(candidate);
  assert.throws(() => assertChapterLevelContract(candidate, manifest, decks, references, 'config/levels/chapter01/L08'), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath);
    return true;
  });
}
expectFailure('invalid prerequisite', (candidate) => { candidate.chapterLevels[0].prerequisiteLevelId = 'L99'; }, 'config/levels/chapter01/L08.chapterLevels[0].prerequisiteLevelId');
expectFailure('unknown deck', (candidate) => { candidate.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels/chapter01/L08.chapterLevels[0].enemyDeckId');
expectFailure('invalid ID', (candidate) => { candidate.chapterLevels[0].id = 'L_08'; }, 'config/levels/chapter01/L08.chapterLevels[0].id');
expectFailure('unknown protection target', (candidate) => { candidate.chapterLevels[0].objectives[0].targetId = 'C999'; }, 'config/levels/chapter01/L08.chapterLevels[0].objectives[0].targetId');
expectFailure('unknown failure target', (candidate) => { candidate.chapterLevels[0].failureConditions[1].targetId = 'C999'; }, 'config/levels/chapter01/L08.chapterLevels[0].failureConditions[1].targetId');
expectFailure('round boundary', (candidate) => { candidate.chapterLevels[0].objectives[1].rounds = 0; }, 'config/levels/chapter01/L08.chapterLevels[0].objectives[1].rounds');
expectFailure('skill copy limit', (candidate) => { candidate.chapterLevels[0].rewards[1].quantity = 2; }, 'config/levels/chapter01/L08.chapterLevels[0].rewards[1].quantity');
expectFailure('missing failures', (candidate) => { delete candidate.chapterLevels[0].failureConditions; }, 'config/levels/chapter01/L08.chapterLevels[0].failureConditions');

console.log('Chapter 01 L08: real L07 prerequisite, C009 protected target proxy, eight-round survival, naming immunity, profession skill II and negative cases PASS');
