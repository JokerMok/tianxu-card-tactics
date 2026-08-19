import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const levelConfig = readJson(path.join(configRoot, 'levels/chapter01/L10.json'));
const previousConfig = readJson(path.join(configRoot, 'levels/chapter01/L09.json'));
const manifest = readJson(path.join(configRoot, 'manifest.json'));
const decks = readJson(path.join(configRoot, 'decks.json'));
const cards = readJson(path.join(configRoot, 'cards.json'));
const units = readJson(path.join(configRoot, 'units.json'));
const skills = readJson(path.join(configRoot, 'skills.json'));
const enumCoverage = readJson(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'));
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
const unitIds = new Set(units.units.filter((row) => row.enabled !== false).map((row) => row.id));
const skillIds = new Set(skills.skills.filter((row) => row.enabled !== false).map((row) => row.id));
const enumL10 = enumCoverage.chapterLevels.find((entry) => entry.id === 'L10');
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

assert.equal(previousConfig.chapterLevels[0].id, 'L09');
assert.equal(level.id, 'L10');
assert.equal(level.enemyDeckId, 'D001');
assert.deepEqual(enumL10, {
  id: 'L10',
  prerequisiteLevelId: 'L09',
  enemyDeckId: 'D001',
  environmentElement: 'NONE',
  objectives: [{ type: 'DESTROY_TARGET', targetId: 'U001' }],
  rewards: [{ type: 'UNLOCK', id: 'OUTPOST', quantity: 1 }],
  failureConditions: [{ type: 'PLAYER_HERO_DEFEATED' }],
});
assert.deepEqual(level.rewards, [{ type: 'UNLOCK', id: 'OUTPOST', quantity: 1 }]);
assert.doesNotThrow(() => assertChapterLevelContract(levelConfig, manifest, decks, references, 'config/levels/chapter01/L10'));
assert.match(chapterDoc, /两路分别承担守住信标与阻挡援军的目标/);
assert.match(chapterDoc, /任一路关键目标被摧毁即失败/);
assert.match(sceneDoc, /### E110 夺回末烽/);
assert.match(sceneDoc, /上路通向需要守住的赤金信标平台，下路经过陡坡军门并承担阻挡援军的功能/);

function assertScenarioRules(rules) {
  assert.equal(rules.sceneId, 'E110');
  assert.equal(rules.laneCount, 2);
  assert.deepEqual(rules.keyTargetIds, ['U001', 'U004']);
  assert.deepEqual(rules.laneTargetMapping, [
    { lane: 1, targetId: 'U001', role: 'SIGNAL_BEACON' },
    { lane: 2, targetId: 'U004', role: 'REINFORCEMENT_GATE' },
  ]);
  assert(rules.keyTargetIds.every((id) => unitIds.has(id)));
  assert.equal(rules.objectivePolicy, 'DESTROY_ALL_KEY_TARGETS');
  assert.equal(rules.failureTargetPolicy, 'ANY_KEY_TARGET_DESTROYED');
  assert.equal(rules.heroKillDoesNotEnd, true);
  assert.equal(rules.outpostUnlockId, 'OUTPOST');
}
assertScenarioRules(level.scenarioRules);
assert.throws(() => assertScenarioRules({}));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, sceneId: 'E999' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, laneCount: 1 }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, keyTargetIds: ['U001'] }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, laneTargetMapping: [{ lane: 1, targetId: 'U999', role: 'SIGNAL_BEACON' }, level.scenarioRules.laneTargetMapping[1]] }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, objectivePolicy: 'DEFEAT_ENEMY_HERO' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, failureTargetPolicy: 'PLAYER_HERO_ONLY' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, heroKillDoesNotEnd: false }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, outpostUnlockId: 'CHAPTER-CHEST' }));

function expectFailure(label, mutate, expectedPath) {
  const candidate = structuredClone(levelConfig);
  mutate(candidate);
  assert.throws(() => assertChapterLevelContract(candidate, manifest, decks, references, 'config/levels/chapter01/L10'), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath);
    return true;
  });
}
expectFailure('invalid prerequisite', (candidate) => { candidate.chapterLevels[0].prerequisiteLevelId = 'L99'; }, 'config/levels/chapter01/L10.chapterLevels[0].prerequisiteLevelId');
expectFailure('unknown deck', (candidate) => { candidate.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels/chapter01/L10.chapterLevels[0].enemyDeckId');
expectFailure('invalid ID', (candidate) => { candidate.chapterLevels[0].id = 'L_10'; }, 'config/levels/chapter01/L10.chapterLevels[0].id');
expectFailure('unknown target', (candidate) => { candidate.chapterLevels[0].objectives[0].targetId = 'U999'; }, 'config/levels/chapter01/L10.chapterLevels[0].objectives[0].targetId');
expectFailure('unknown unlock', (candidate) => { candidate.chapterLevels[0].rewards[0].id = 'UNKNOWN-UNLOCK'; }, 'config/levels/chapter01/L10.chapterLevels[0].rewards[0].id');
expectFailure('missing failures', (candidate) => { delete candidate.chapterLevels[0].failureConditions; }, 'config/levels/chapter01/L10.chapterLevels[0].failureConditions');

console.log('Chapter 01 L10: real L09 prerequisite, E110 two-lane objectives, OUTPOST unlock, any-key-target failure, hero-kill non-terminal rule and negative cases PASS');
