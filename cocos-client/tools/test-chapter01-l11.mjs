import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const levelConfig = readJson(path.join(configRoot, 'levels/chapter01/L11.json'));
const previousConfig = readJson(path.join(configRoot, 'levels/chapter01/L10.json'));
const manifest = readJson(path.join(configRoot, 'manifest.json'));
const decks = readJson(path.join(configRoot, 'decks.json'));
const cards = readJson(path.join(configRoot, 'cards.json'));
const units = readJson(path.join(configRoot, 'units.json'));
const skills = readJson(path.join(configRoot, 'skills.json'));
const professions = readJson(path.join(configRoot, 'professions.json'));
const enumCoverage = readJson(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'));
const chapterDoc = fs.readFileSync(path.join(root, '../首章剧情关卡-v1.1.md'), 'utf8');
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
const cardById = new Map(cards.cards.filter((row) => row.enabled !== false).map((row) => [row.id, row]));
const skillRows = skills.skills.filter((row) => row.enabled !== false);
const skillById = new Map(skillRows.map((row) => [row.id, row]));
const skillIds = new Set(skillRows.map((row) => row.id));
const professionRows = professions.professions.filter((row) => row.enabled !== false);
const professionById = new Map(professionRows.map((row) => [row.id, row]));
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

assert.equal(previousConfig.chapterLevels[0].id, 'L10');
assert.equal(level.id, 'L11');
assert.deepEqual(level.rewards, [{ type: 'CARD', id: 'S014', quantity: 1, cardType: 'SKILL' }]);
assert.equal(cards.cards.find((row) => row.id === 'S014')?.cardType, 'SKILL');
assert.equal(professionById.get('P001')?.skillIds[2], 'S014');
assert.doesNotThrow(() => assertChapterLevelContract(levelConfig, manifest, decks, references, 'config/levels/chapter01/L11'));
assert.match(chapterDoc, /敌方混合人族守卫、羽民远射、册奴和神庭技能/);
assert.match(chapterDoc, /每隔三个敌方行动回合/);
assert.match(chapterDoc, /当前准备值最高的一张牌增加一点准备值/);
assert.match(cardDesignDoc, /\| S014 \| 固阵令 \|/);
assert.match(cardDesignDoc, /\| U007 \|[^\n]*灼烧 1/);
assert.match(cardDesignDoc, /\| U009 \|[^\n]*复归 1 生命/);

function assertScenarioRules(rules) {
  assert.equal(rules.professionSkillPolicy, 'CURRENT_PROFESSION_SKILL_III');
  const expectedSkillMap = { P001: 'S014', P002: 'S003', P003: 'S015', P004: 'S010' };
  assert.deepEqual(rules.professionSkillIdByProfession, expectedSkillMap);
  for (const [professionId, skillId] of Object.entries(expectedSkillMap)) {
    assert.equal(professionById.has(professionId), true);
    assert.equal(professionById.get(professionId)?.skillIds[2], skillId);
    assert.equal(skillById.has(skillId), true);
  }
  assert.deepEqual(rules.nameCheckRule, {
    enemyActionInterval: 3,
    prepareIncrease: 1,
    tieBreak: 'SEEDED',
    seed: 20260712,
  });
  assert.deepEqual(rules.professionAdvantageRules.P001.targetUnitIds, ['U005', 'U006']);
  assert(rules.professionAdvantageRules.P001.targetUnitIds.every((id) => unitById.get(id)?.role === 'FAST'));
  assert.equal(rules.professionAdvantageRules.P001.counterRole, 'FAST');
  assert.deepEqual(rules.professionAdvantageRules.P002.targetUnitIds, ['U001', 'U013', 'U019']);
  assert(rules.professionAdvantageRules.P002.targetUnitIds.every((id) => unitById.get(id)?.defenseType === 'HEAVY'));
  assert.equal(rules.professionAdvantageRules.P002.counterDefenseType, 'HEAVY');
  assert.deepEqual(rules.professionAdvantageRules.P003.targetUnitIds, ['U007', 'U009']);
  assert.equal(unitById.get('U007')?.abilityIds[0], 'A007');
  assert.equal(unitById.get('U009')?.abilityIds[0], 'A009');
  assert.deepEqual(rules.professionAdvantageRules.P003.counterStatuses, ['BURN', 'REVIVE']);
  assert.deepEqual(rules.professionAdvantageRules.P004.targetUnitIds, ['U008']);
  assert.equal(cardById.get('U008')?.prepare, 5);
  assert.equal(rules.professionAdvantageRules.P004.minPrepare, 5);
}
assertScenarioRules(level.scenarioRules);
assert.throws(() => assertScenarioRules({}));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, professionSkillPolicy: 'CURRENT_PROFESSION_SKILL_II' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, professionSkillIdByProfession: { ...level.scenarioRules.professionSkillIdByProfession, P001: 'S006' } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, nameCheckRule: { ...level.scenarioRules.nameCheckRule, enemyActionInterval: 2 } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, nameCheckRule: { ...level.scenarioRules.nameCheckRule, prepareIncrease: 0 } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, nameCheckRule: { ...level.scenarioRules.nameCheckRule, tieBreak: 'RANDOM' } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, nameCheckRule: { ...level.scenarioRules.nameCheckRule, seed: 0 } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, professionAdvantageRules: { ...level.scenarioRules.professionAdvantageRules, P002: { counterDefenseType: 'LIGHT', targetUnitIds: ['U004'] } } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, professionAdvantageRules: { ...level.scenarioRules.professionAdvantageRules, P004: { minPrepare: 4, targetUnitIds: ['U008'] } } }));

function expectFailure(label, mutate, expectedPath) {
  const candidate = structuredClone(levelConfig);
  mutate(candidate);
  assert.throws(() => assertChapterLevelContract(candidate, manifest, decks, references, 'config/levels/chapter01/L11'), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath);
    return true;
  });
}
expectFailure('invalid prerequisite', (candidate) => { candidate.chapterLevels[0].prerequisiteLevelId = 'L99'; }, 'config/levels/chapter01/L11.chapterLevels[0].prerequisiteLevelId');
expectFailure('unknown deck', (candidate) => { candidate.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels/chapter01/L11.chapterLevels[0].enemyDeckId');
expectFailure('invalid ID', (candidate) => { candidate.chapterLevels[0].id = 'L_11'; }, 'config/levels/chapter01/L11.chapterLevels[0].id');
expectFailure('skill card type mismatch', (candidate) => { candidate.chapterLevels[0].rewards[0].cardType = 'UNIT'; }, 'config/levels/chapter01/L11.chapterLevels[0].rewards[0].cardType');
expectFailure('skill copy limit', (candidate) => { candidate.chapterLevels[0].rewards[0].quantity = 2; }, 'config/levels/chapter01/L11.chapterLevels[0].rewards[0].quantity');
expectFailure('unknown reward', (candidate) => { candidate.chapterLevels[0].rewards[0].id = 'S999'; }, 'config/levels/chapter01/L11.chapterLevels[0].rewards[0].id');
expectFailure('missing failures', (candidate) => { delete candidate.chapterLevels[0].failureConditions; }, 'config/levels/chapter01/L11.chapterLevels[0].failureConditions');

console.log('Chapter 01 L11: real L10 prerequisite, profession skill III mapping, three-action seeded prepare penalty, four profession advantage rules and negative cases PASS');
