import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const levelConfig = readJson(path.join(configRoot, 'levels/chapter01/L09.json'));
const previousConfig = readJson(path.join(configRoot, 'levels/chapter01/L08.json'));
const manifest = readJson(path.join(configRoot, 'manifest.json'));
const decks = readJson(path.join(configRoot, 'decks.json'));
const cards = readJson(path.join(configRoot, 'cards.json'));
const units = readJson(path.join(configRoot, 'units.json'));
const skills = readJson(path.join(configRoot, 'skills.json'));
const enumCoverage = readJson(path.join(root, 'assets/scripts/config/levels/chapter-level-enum-coverage.fixture.json'));
const characterDoc = fs.readFileSync(path.join(root, '../首发角色视觉设定-v1.0.md'), 'utf8');
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
const skillRows = skills.skills.filter((row) => row.enabled !== false);
const skillById = new Map(skillRows.map((row) => [row.id, row]));
const skillIds = new Set(skillRows.map((row) => row.id));
const characterIds = new Set([...characterDoc.matchAll(/\|\s*(C\d+)\s*\|/gu)].map((match) => match[1]));
const rewardIds = (type) => new Set(enumCoverage.chapterLevels.flatMap((entry) => entry.rewards.filter((reward) => reward.type === type).map((reward) => reward.id)));
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

assert.equal(previousConfig.chapterLevels[0].id, 'L08');
assert.equal(level.id, 'L09');
assert.deepEqual(level.rewards, [{ type: 'CARD', id: 'U009', quantity: 2 }]);
assert.doesNotThrow(() => assertChapterLevelContract(levelConfig, manifest, decks, references, 'config/levels/chapter01/L09'));
assert.match(chapterDoc, /敌方灵体防型使普通物理攻击效率降低/);
assert.match(chapterDoc, /术法能够取得 1\.25 克制/);
assert.match(chapterDoc, /低生命单位可以复归一次/);
assert.match(chapterDoc, /晏归提供一张临时术法军契/);

function assertScenarioRules(rules) {
  assert.deepEqual(rules.enemySpiritUnitIds, ['U009', 'U010']);
  assert(rules.enemySpiritUnitIds.every((id) => unitById.get(id)?.defenseType === 'SPIRIT'));
  assert.equal(rules.spiritDefenseType, 'SPIRIT');
  assert.equal(rules.physicalDamageMultiplier, 0.75);
  assert.equal(rules.spellDamageMultiplier, 1.25);
  assert.deepEqual(rules.reviveRule.unitIds, ['U009']);
  assert.equal(rules.reviveRule.maxRevives, 1);
  assert.equal(rules.reviveRule.reviveHp, 1);
  assert.equal(rules.reviveRule.trigger, 'DEATH');
  assert.equal(characterIds.has(rules.temporarySpellAid.sourceCharacterId), true);
  assert.equal(rules.temporarySpellAid.sourceCharacterId, 'C001');
  assert.equal(rules.temporarySpellAid.cardId, 'S001');
  assert.equal(cards.cards.find((row) => row.id === rules.temporarySpellAid.cardId)?.cardType, 'SKILL');
  assert.equal(skillById.get(rules.temporarySpellAid.cardId)?.targetType, 'ENEMY_UNIT');
  assert.equal(rules.temporarySpellAid.uses, 1);
  assert.equal(rules.purifySkillId, 'S015');
  assert.equal(skillById.get(rules.purifySkillId)?.targetType, 'ALLY_UNIT');
  assert.deepEqual(rules.alternateSolutions, ['FOCUS_DAMAGE', 'PURIFY_REVIVE_MARK', 'SUPPRESS_REVIVE_POSITION']);
  assert.match(cardDesignDoc, /\| U009 \|[^\n]*复归 1 生命/);
}
assertScenarioRules(level.scenarioRules);
assert.throws(() => assertScenarioRules({}));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, enemySpiritUnitIds: ['U001'] }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, physicalDamageMultiplier: 1 }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, spellDamageMultiplier: 1 }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, reviveRule: { ...level.scenarioRules.reviveRule, maxRevives: 2 } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, reviveRule: { ...level.scenarioRules.reviveRule, reviveHp: 0 } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, temporarySpellAid: { ...level.scenarioRules.temporarySpellAid, cardId: 'S999' } }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, purifySkillId: 'S001' }));
assert.throws(() => assertScenarioRules({ ...level.scenarioRules, alternateSolutions: ['FOCUS_DAMAGE'] }));

function expectFailure(label, mutate, expectedPath) {
  const candidate = structuredClone(levelConfig);
  mutate(candidate);
  assert.throws(() => assertChapterLevelContract(candidate, manifest, decks, references, 'config/levels/chapter01/L09'), (error) => {
    assert(error instanceof ConfigLoadError, `${label} must throw ConfigLoadError`);
    assert.equal(error.configPath, expectedPath);
    return true;
  });
}
expectFailure('invalid prerequisite', (candidate) => { candidate.chapterLevels[0].prerequisiteLevelId = 'L99'; }, 'config/levels/chapter01/L09.chapterLevels[0].prerequisiteLevelId');
expectFailure('unknown deck', (candidate) => { candidate.chapterLevels[0].enemyDeckId = 'D404'; }, 'config/levels/chapter01/L09.chapterLevels[0].enemyDeckId');
expectFailure('invalid ID', (candidate) => { candidate.chapterLevels[0].id = 'L_09'; }, 'config/levels/chapter01/L09.chapterLevels[0].id');
expectFailure('reward copy limit', (candidate) => { candidate.chapterLevels[0].rewards[0].quantity = 4; }, 'config/levels/chapter01/L09.chapterLevels[0].rewards[0].quantity');
expectFailure('unknown reward card', (candidate) => { candidate.chapterLevels[0].rewards[0].id = 'U999'; }, 'config/levels/chapter01/L09.chapterLevels[0].rewards[0].id');
expectFailure('missing failures', (candidate) => { delete candidate.chapterLevels[0].failureConditions; }, 'config/levels/chapter01/L09.chapterLevels[0].failureConditions');

console.log('Chapter 01 L09: real L08 prerequisite, SPIRIT physical/spell counters, one-time U009 revival, C001 temporary S001 aid, U009 reward and negative cases PASS');
