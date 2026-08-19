import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const levelConfig = readJson(path.join(configRoot, 'levels/chapter01/L12.json'));
const previousConfig = readJson(path.join(configRoot, 'levels/chapter01/L11.json'));
const manifest = readJson(path.join(configRoot, 'manifest.json'));
const decks = readJson(path.join(configRoot, 'decks.json'));
const cards = readJson(path.join(configRoot, 'cards.json'));
const units = readJson(path.join(configRoot, 'units.json'));
const skills = readJson(path.join(configRoot, 'skills.json'));
const enumCoverage = readJson(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'));
const characterDoc = fs.readFileSync(path.join(root, '../首发角色视觉设定-v1.0.md'), 'utf8');
const chapterDoc = fs.readFileSync(path.join(root, '../首章剧情关卡-v1.1.md'), 'utf8');
const sceneDoc = fs.readFileSync(path.join(root, '../文档/历史/场景战场UI特效生图提示词库-v1.1.md'), 'utf8');
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
const rewardIds = (type) => new Set(enumCoverage.chapterLevels.flatMap((entry) => entry.rewards.filter((reward) => reward.type === type).map((reward) => reward.id)));
const enumL12 = enumCoverage.chapterLevels.find((entry) => entry.id === 'L12');
const references = {
  chapterLevelIds: new Set([...previousConfig.chapterLevels.map((entry) => entry.id), ...levelConfig.chapterLevels.map((entry) => entry.id)]),
  targetIds: new Set([...unitIds, ...characterIds]),
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

assert.equal(previousLevel.id, 'L11');
assert.equal(level.id, 'L12');
assert.equal(level.objectives[0].type, 'DEFEAT_ENEMY_HERO');
assert.equal(level.failureConditions[1].type, 'ROUND_LIMIT_REACHED');
assert.equal(level.failureConditions[1].rounds, 80);
assert.deepEqual(level.rewards, [
  { type: 'CHEST', id: 'CHAPTER-CHEST', quantity: 1 },
  { type: 'FLAG', id: 'OUTCAST-CAMP', quantity: 1 },
]);
assert.deepEqual(enumL12, {
  id: 'L12',
  prerequisiteLevelId: 'L11',
  enemyDeckId: 'D001',
  environmentElement: 'NONE',
  objectives: [{ type: 'DEFEAT_ENEMY_HERO' }],
  rewards: [
    { type: 'CHEST', id: 'CHAPTER-CHEST', quantity: 1 },
    { type: 'FLAG', id: 'OUTCAST-CAMP', quantity: 1 },
  ],
  failureConditions: [{ type: 'ROUND_LIMIT_REACHED' }],
});
assert.doesNotThrow(() => assertChapterLevelContract(levelConfig, manifest, decks, references, 'config/levels/chapter01/L12'));
assert.equal(characterIds.has('C010'), true);
assert.match(chapterDoc, /每三个敌方回合使用一次“点册”/);
assert.match(chapterDoc, /玄枢失去司籍职分并进入战场/);
assert.match(chapterDoc, /“名锁”只影响技能卡，单位卡正常准备/);
assert.match(chapterDoc, /击败玄枢并保住主角英雄即胜利/);
assert.match(sceneDoc, /### E112 玄枢归序/);
assert.match(sceneDoc, /第一阶段的敌方阵地保留点册召唤槽/);

function assertScenarioRules(rules) {
  assert.equal(rules.sceneId, 'E112');
  assert.equal(characterIds.has(rules.bossCharacterId), true);
  assert.equal(rules.bossCharacterId, 'C010');
  assert.equal(rules.roundLimit, 80);
  assert.deepEqual(rules.pointBookRule, {
    enemyActionInterval: 3,
    summonUnitId: 'U009',
    occupiedSlotPolicy: 'SKIP',
    overwriteUnits: false,
  });
  assert.equal(unitIds.has(rules.pointBookRule.summonUnitId), true);
  assert.deepEqual(rules.phaseTransition, {
    triggerBossHpPercent: 50,
    bossEntersBattle: true,
    bossRole: 'HIGH_HP_ELITE',
    nameLockAffects: ['SKILL_CARD'],
    unitCardPreparationNormal: true,
  });
  assert.equal(rules.victoryPolicy, 'DEFEAT_BOSS_AND_KEEP_PLAYER_HERO_ALIVE');
  assert.deepEqual(rules.rewardRegistryIds, ['CHAPTER-CHEST', 'OUTCAST-CAMP']);
}
assertScenarioRules(level.scenarioRules);
assert.throws(() => assertScenarioRules({}));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, sceneId: 'E999' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, bossCharacterId: 'C999' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, roundLimit: 0 }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, pointBookRule: { ...level.scenarioRules.pointBookRule, enemyActionInterval: 2 } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, pointBookRule: { ...level.scenarioRules.pointBookRule, summonUnitId: 'U999' } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, pointBookRule: { ...level.scenarioRules.pointBookRule, occupiedSlotPolicy: 'OVERWRITE' } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, phaseTransition: { ...level.scenarioRules.phaseTransition, triggerBossHpPercent: 60 } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, phaseTransition: { ...level.scenarioRules.phaseTransition, nameLockAffects: ['UNIT_CARD'] } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, victoryPolicy: 'DEFEAT_BOSS_ONLY' }));

function expectFailure(label, mutate, expectedPath) {
  const candidate = structuredClone(levelConfig);
  mutate(candidate);
  assert.throws(() => assertChapterLevelContract(candidate, manifest, decks, references, 'config/levels/chapter01/L12'), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath);
    return true;
  });
}
expectFailure('invalid prerequisite', (candidate) => { candidate.chapterLevels[0].prerequisiteLevelId = 'L99'; }, 'config/levels/chapter01/L12.chapterLevels[0].prerequisiteLevelId');
expectFailure('unknown deck', (candidate) => { candidate.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels/chapter01/L12.chapterLevels[0].enemyDeckId');
expectFailure('invalid ID', (candidate) => { candidate.chapterLevels[0].id = 'L_12'; }, 'config/levels/chapter01/L12.chapterLevels[0].id');
expectFailure('unknown chest', (candidate) => { candidate.chapterLevels[0].rewards[0].id = 'UNKNOWN-CHEST'; }, 'config/levels/chapter01/L12.chapterLevels[0].rewards[0].id');
expectFailure('unknown flag', (candidate) => { candidate.chapterLevels[0].rewards[1].id = 'UNKNOWN-FLAG'; }, 'config/levels/chapter01/L12.chapterLevels[0].rewards[1].id');
expectFailure('missing failures', (candidate) => { delete candidate.chapterLevels[0].failureConditions; }, 'config/levels/chapter01/L12.chapterLevels[0].failureConditions');

console.log('Chapter 01 L12: real L11 prerequisite, C010 two-phase boss, three-action point-book summon, 80-round limit, chest/flag rewards and negative cases PASS');
