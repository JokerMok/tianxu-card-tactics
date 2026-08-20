import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const enemyPath = path.join(configRoot, 'enemy/strategies.json');

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(configRoot, relativePath), 'utf8'));
const enemy = JSON.parse(fs.readFileSync(enemyPath, 'utf8'));
const cards = readJson('cards.json');
const decks = readJson('decks.json');
const skills = readJson('skills.json');
const units = readJson('units.json');

const levels = new Map();
for (let index = 1; index <= 12; index += 1) {
  const levelId = `L${String(index).padStart(2, '0')}`;
  const levelPath = `levels/chapter01/${levelId}.json`;
  const value = readJson(levelPath);
  assert.equal(value.chapterLevels?.length, 1, `${levelPath} must contain one level`);
  assert.equal(value.chapterLevels[0].id, levelId, `${levelPath} must identify ${levelId}`);
  levels.set(levelId, value.chapterLevels[0]);
}

const ENVIRONMENTS = new Set(['NONE', 'METAL', 'WOOD', 'WATER', 'FIRE', 'EARTH']);
const ACTIONS = new Set([
  'DEPLOY_FRONTLINE',
  'PRESS_HIGH_THREAT',
  'FILL_EMPTY_LANE',
  'HOLD_NO_LEGAL_ACTION',
  'SUPPORT_RANGED',
  'DEPLOY_FAST_UNIT',
  'DEFEND_THREATENED_LANE',
  'USE_LETHAL_SKILL',
  'SAVE_CRITICAL_ALLY',
  'USE_CONTROL_SKILL',
  'PROTECT_OBJECTIVE',
  'DEPLOY_ANCHOR',
  'HANDLE_REVIVE',
  'APPLY_PREPARE_PRESSURE',
  'COUNTER_PLAYER_ROLE',
  'HANDLE_PHASE_RULE',
]);
const UNIT_TARGET_POLICIES = new Set(['LETHAL_IF_POSSIBLE', 'LOWEST_HP', 'HIGHEST_ATTACK', 'HIGHEST_VALUE']);
const LANE_TARGET_POLICIES = new Set(['EMPTY_LANE', 'HIGHEST_PRESSURE', 'MOST_UNITS', 'HIGHEST_UNIT_COUNT', 'MOST_DAMAGED_FRONTLINE', 'RANGED_SUPPORT']);
const ALLY_UNIT_TARGET_POLICIES = new Set(['MOST_MISSING_HP', 'LOWEST_HP', 'HIGHEST_VALUE']);
const ALLY_LANE_TARGET_POLICIES = new Set(['MOST_DAMAGED_FRONTLINE', 'HIGHEST_UNIT_COUNT', 'RANGED_SUPPORT']);
const SKILL_POLICIES_BY_TARGET = new Map([
  ['ALLY_UNIT', ALLY_UNIT_TARGET_POLICIES],
  ['ALLY_LANE', ALLY_LANE_TARGET_POLICIES],
  ['ENEMY_UNIT', UNIT_TARGET_POLICIES],
  ['ENEMY_LANE', LANE_TARGET_POLICIES],
  ['ENEMY_AREA', LANE_TARGET_POLICIES],
  ['PREPARE_BAR', new Set(['HIGHEST_VALUE'])],
]);
const DIFFICULTIES = new Set(['TUTORIAL', 'STANDARD', 'CHALLENGE', 'BOSS']);
const NO_LEGAL_TARGET_POLICIES = new Set(['HOLD', 'END_ACTION']);
const TIE_BREAKS = new Set(['SEEDED']);
const LANE_FALLBACKS = new Set(['PRESS_OTHER_LANE', 'SEEDED']);
const OPENING_POLICIES = new Set(['UNITS_ONLY', 'ALL_LEGAL']);
const PHASE_POLICIES = new Set(['NOT_APPLICABLE', 'L12_BOSS_PHASE_TRANSITION']);
const SPECIAL_RULES = new Set(['NOT_APPLICABLE', 'L11_NAME_CHECK', 'L12_POINT_BOOK']);
const ROOT_KEYS = new Set(['schemaVersion', 'table', 'evidenceLevel', 'version', 'enabled', 'strategies']);
const STRATEGY_KEYS = new Set([
  'id', 'levelId', 'deckId', 'unitIds', 'skillRules', 'environmentElement', 'maxCardsPerAction',
  'lethalWeight', 'defendWeight', 'emptyLaneWeight', 'rangedSupportWeight', 'randomness',
  'actionPriority', 'targetSelection', 'difficulty', 'ruleBoundary',
]);
const SKILL_RULE_KEYS = new Set(['skillId', 'targetPolicy', 'reserveIfNoLegalTarget']);
const TARGET_KEYS = new Set(['enemyUnitOrder', 'enemyLaneOrder', 'allyUnitOrder', 'allyLaneOrder', 'priorityTargetUnitIds', 'noLegalTarget', 'tieBreak']);
const DIFFICULTY_KEYS = new Set(['tier', 'threatMultiplierPercent', 'skillReserveTurns']);
const RULE_BOUNDARY_KEYS = new Set([
  'maxConsecutiveSameLane', 'sameLaneFallback', 'reserveSkillWhenNoLegalTarget', 'openingCardPolicy',
  'enemyActionInterval', 'phasePolicy', 'specialRule', 'maxRounds',
]);

function fail(message) {
  throw new Error(`敌方策略配置无效：${message}`);
}

function record(value, configPath) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${configPath} 必须是 object`);
  return value;
}

function stringField(value, key, configPath) {
  if (typeof value[key] !== 'string' || value[key].length === 0) fail(`${configPath}.${key} 必须是非空 string`);
  return value[key];
}

function integerField(value, key, min, max, configPath) {
  if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) {
    fail(`${configPath}.${key} 必须是 ${min} 到 ${max} 的整数`);
  }
  return value[key];
}

function nullableIntegerField(value, key, min, max, configPath) {
  if (value[key] !== null) integerField(value, key, min, max, configPath);
  return value[key];
}

function booleanField(value, key, configPath) {
  if (typeof value[key] !== 'boolean') fail(`${configPath}.${key} 必须是 boolean`);
  return value[key];
}

function enumField(value, key, allowed, configPath) {
  if (typeof value[key] !== 'string' || !allowed.has(value[key])) {
    fail(`${configPath}.${key} 非法枚举值`);
  }
  return value[key];
}

function uniqueStringArray(value, key, configPath, { minLength = 1 } = {}) {
  const items = value[key];
  if (!Array.isArray(items) || items.length < minLength || items.some((item) => typeof item !== 'string' || item.length === 0)) {
    fail(`${configPath}.${key} 必须是非空 string 数组`);
  }
  if (new Set(items).size !== items.length) fail(`${configPath}.${key} 不得包含重复 ID 或枚举`);
  return items;
}

function assertKnownIds(ids, knownIds, configPath) {
  ids.forEach((id, index) => {
    if (!knownIds.has(id)) fail(`${configPath}[${index}] 未知引用 ${id}`);
  });
}

function assertNoUnknownKeys(value, allowed, configPath) {
  Object.keys(value).forEach((key) => {
    if (!allowed.has(key)) fail(`${configPath}.${key} 是未知字段`);
  });
}

function assertRequiredKeys(value, required, configPath) {
  required.forEach((key) => {
    if (!Object.hasOwn(value, key)) fail(`${configPath}.${key} 缺少必填字段`);
  });
}

function enabledRows(table, key, configPath) {
  record(table, configPath);
  if (!Array.isArray(table[key]) || table[key].length === 0) fail(`${configPath}.${key} 必须是非空数组`);
  const rows = table[key].filter((row) => row.enabled !== false);
  const ids = new Set();
  rows.forEach((row, index) => {
    record(row, `${configPath}.${key}[${index}]`);
    if (typeof row.id !== 'string' || row.id.length === 0 || ids.has(row.id)) fail(`${configPath}.${key}[${index}].id 重复或为空`);
    ids.add(row.id);
  });
  return rows;
}

const cardRows = enabledRows(cards, 'cards', 'config/cards');
const deckRows = enabledRows(decks, 'decks', 'config/decks');
const skillRows = enabledRows(skills, 'skills', 'config/skills');
const unitRows = enabledRows(units, 'units', 'config/units');
const cardById = new Map(cardRows.map((row) => [row.id, row]));
const deckById = new Map(deckRows.map((row) => [row.id, row]));
const skillById = new Map(skillRows.map((row) => [row.id, row]));
const unitById = new Map(unitRows.map((row) => [row.id, row]));

function deckCardIds(deck, cardType) {
  const ids = new Set();
  if (!Array.isArray(deck.cardEntries) || deck.cardEntries.length === 0) fail(`config/decks.decks.${deck.id}.cardEntries 为空`);
  deck.cardEntries.forEach((entry, index) => {
    record(entry, `config/decks.decks.${deck.id}.cardEntries[${index}]`);
    if (typeof entry.cardId !== 'string' || !Number.isInteger(entry.count) || entry.count < 1) fail(`config/decks.decks.${deck.id}.cardEntries[${index}] 非法`);
    const card = cardById.get(entry.cardId);
    if (!card) fail(`config/decks.decks.${deck.id}.cardEntries[${index}].cardId 未知引用 ${entry.cardId}`);
    if (card.cardType === cardType) ids.add(entry.cardId);
  });
  return ids;
}

function assertLevelBoundaries(level, boundary, boundaryPath) {
  const levelPath = `config/levels/chapter01/${level.id}`;
  const scenarioRules = level.scenarioRules === undefined
    ? {}
    : record(level.scenarioRules, `${levelPath}.scenarioRules`);
  const battleRules = level.battleRules === undefined
    ? {}
    : record(level.battleRules, `${levelPath}.battleRules`);
  const roundLimits = [scenarioRules.roundLimit, battleRules.roundLimit].filter((value) => value !== undefined);
  roundLimits.forEach((value) => {
    if (!Number.isInteger(value) || value < 1 || value > 80) fail(`${levelPath} 的 roundLimit 必须是 1 到 80 的整数`);
  });
  if (new Set(roundLimits).size > 1) fail(`${levelPath} 的 scenarioRules/battleRules.roundLimit 不一致`);
  const expectedRoundLimit = roundLimits[0] ?? 80;
  if (boundary.maxRounds !== expectedRoundLimit) {
    fail(`${boundaryPath}.maxRounds 必须遵循真实关卡回合边界 ${expectedRoundLimit}`);
  }

  if (level.id === 'L01') {
    if (typeof scenarioRules.enemyOpeningCardFilter !== 'string') fail(`${levelPath}.scenarioRules.enemyOpeningCardFilter 缺失`);
    if (boundary.openingCardPolicy !== scenarioRules.enemyOpeningCardFilter) {
      fail(`${boundaryPath}.openingCardPolicy 必须遵循 L01 真实开局规则 ${scenarioRules.enemyOpeningCardFilter}`);
    }
  }

  let expectedEnemyActionInterval = null;
  let expectedSpecialRule = 'NOT_APPLICABLE';
  let expectedPhasePolicy = 'NOT_APPLICABLE';
  if (level.id === 'L11') {
    const nameCheckRule = record(scenarioRules.nameCheckRule, `${levelPath}.scenarioRules.nameCheckRule`);
    expectedEnemyActionInterval = integerField(nameCheckRule, 'enemyActionInterval', 1, 80, `${levelPath}.scenarioRules.nameCheckRule`);
    expectedSpecialRule = 'L11_NAME_CHECK';
  }
  if (level.id === 'L12') {
    const pointBookRule = record(scenarioRules.pointBookRule, `${levelPath}.scenarioRules.pointBookRule`);
    expectedEnemyActionInterval = integerField(pointBookRule, 'enemyActionInterval', 1, 80, `${levelPath}.scenarioRules.pointBookRule`);
    const phaseTransition = record(scenarioRules.phaseTransition, `${levelPath}.scenarioRules.phaseTransition`);
    const phaseExpectations = {
      triggerBossHpPercent: 50,
      bossEntersBattle: true,
      bossRole: 'HIGH_HP_ELITE',
      unitCardPreparationNormal: true,
    };
    Object.entries(phaseExpectations).forEach(([key, expected]) => {
      if (phaseTransition[key] !== expected) fail(`${levelPath}.scenarioRules.phaseTransition.${key} 不符合真实阶段规则`);
    });
    if (!Array.isArray(phaseTransition.nameLockAffects) || !phaseTransition.nameLockAffects.includes('SKILL_CARD')) {
      fail(`${levelPath}.scenarioRules.phaseTransition.nameLockAffects 必须包含 SKILL_CARD`);
    }
    expectedSpecialRule = 'L12_POINT_BOOK';
    expectedPhasePolicy = 'L12_BOSS_PHASE_TRANSITION';
  }
  if (boundary.enemyActionInterval !== expectedEnemyActionInterval) {
    fail(`${boundaryPath}.enemyActionInterval 必须匹配真实关卡边界 ${expectedEnemyActionInterval ?? 'NOT_APPLICABLE'}`);
  }
  if (boundary.specialRule !== expectedSpecialRule) {
    fail(`${boundaryPath}.specialRule 必须匹配真实特殊规则 ${expectedSpecialRule}`);
  }
  if (boundary.phasePolicy !== expectedPhasePolicy) {
    fail(`${boundaryPath}.phasePolicy 必须匹配真实阶段规则 ${expectedPhasePolicy}`);
  }
}

function validateStrategy(row, index) {
  const configPath = `config/enemy/strategies.strategies[${index}]`;
  record(row, configPath);
  assertRequiredKeys(row, STRATEGY_KEYS, configPath);
  assertNoUnknownKeys(row, STRATEGY_KEYS, configPath);
  const id = stringField(row, 'id', configPath);
  if (!/^ES_L(?:0[1-9]|1[0-2])$/.test(id)) fail(`${configPath}.id 必须按 ES_L01 至 ES_L12 编号`);
  const levelId = stringField(row, 'levelId', configPath);
  if (!/^L(?:0[1-9]|1[0-2])$/.test(levelId) || !levels.has(levelId)) fail(`${configPath}.levelId 未知章节关卡 ${levelId}`);
  const level = levels.get(levelId);
  if (id !== `ES_${levelId}`) fail(`${configPath}.id 必须与 levelId 一一对应`);

  const deckId = stringField(row, 'deckId', configPath);
  const deck = deckById.get(deckId);
  if (!deck) fail(`${configPath}.deckId 未知或未启用牌组 ${deckId}`);
  if (deckId !== level.enemyDeckId) fail(`${configPath}.deckId 必须使用关卡真实敌方牌组 ${level.enemyDeckId}`);
  const deckUnitIds = deckCardIds(deck, 'UNIT');
  const deckSkillIds = deckCardIds(deck, 'SKILL');

  const unitIds = uniqueStringArray(row, 'unitIds', configPath);
  assertKnownIds(unitIds, new Set(unitById.keys()), `${configPath}.unitIds`);
  unitIds.forEach((unitId, unitIndex) => {
    const card = cardById.get(unitId);
    if (!card || card.cardType !== 'UNIT' || card.unitId !== unitId) fail(`${configPath}.unitIds[${unitIndex}] 缺少同 ID UNIT 卡引用 ${unitId}`);
    if (!deckUnitIds.has(unitId)) fail(`${configPath}.unitIds[${unitIndex}] 不在真实牌组 ${deckId} 中`);
  });

  if (!Array.isArray(row.skillRules) || row.skillRules.length === 0) fail(`${configPath}.skillRules 不得为空`);
  const skillRuleIds = new Set();
  row.skillRules.forEach((rule, ruleIndex) => {
    const rulePath = `${configPath}.skillRules[${ruleIndex}]`;
    record(rule, rulePath);
    assertRequiredKeys(rule, SKILL_RULE_KEYS, rulePath);
    assertNoUnknownKeys(rule, SKILL_RULE_KEYS, rulePath);
    const skillId = stringField(rule, 'skillId', rulePath);
    if (skillRuleIds.has(skillId)) fail(`${rulePath}.skillId 重复 ${skillId}`);
    skillRuleIds.add(skillId);
    const skill = skillById.get(skillId);
    if (!skill) fail(`${rulePath}.skillId 未知或未启用技能 ${skillId}`);
    if (!deckSkillIds.has(skillId)) fail(`${rulePath}.skillId 不在真实牌组 ${deckId} 中`);
    const policies = SKILL_POLICIES_BY_TARGET.get(skill.targetType);
    if (!policies) fail(`${rulePath}.skillId 使用了未支持的技能目标类型 ${skill.targetType}`);
    enumField(rule, 'targetPolicy', policies, rulePath);
    booleanField(rule, 'reserveIfNoLegalTarget', rulePath);
  });

  enumField(row, 'environmentElement', ENVIRONMENTS, configPath);
  if (row.environmentElement !== level.environmentElement) fail(`${configPath}.environmentElement 与真实关卡环境不一致`);
  integerField(row, 'maxCardsPerAction', 0, deck.totalCards, configPath);
  if (row.maxCardsPerAction !== 0) fail(`${configPath}.maxCardsPerAction 必须遵循核心规则 R1=0`);
  ['lethalWeight', 'defendWeight', 'emptyLaneWeight', 'rangedSupportWeight'].forEach((key) => integerField(row, key, 0, 1000, configPath));
  integerField(row, 'randomness', 0, 10000, configPath);
  if (row.lethalWeight + row.defendWeight + row.emptyLaneWeight + row.rangedSupportWeight === 0) fail(`${configPath} 行动权重不得全为 0`);

  const actionPriority = uniqueStringArray(row, 'actionPriority', configPath, { minLength: 2 });
  actionPriority.forEach((action) => { if (!ACTIONS.has(action)) fail(`${configPath}.actionPriority 包含非法枚举 ${action}`); });
  if (actionPriority.at(-1) !== 'HOLD_NO_LEGAL_ACTION') fail(`${configPath}.actionPriority 必须以 HOLD_NO_LEGAL_ACTION 收束`);

  const targetPath = `${configPath}.targetSelection`;
  const targets = record(row.targetSelection, targetPath);
  assertRequiredKeys(targets, TARGET_KEYS, targetPath);
  assertNoUnknownKeys(targets, TARGET_KEYS, targetPath);
  const enemyUnitOrder = uniqueStringArray(targets, 'enemyUnitOrder', targetPath, { minLength: 2 });
  const enemyLaneOrder = uniqueStringArray(targets, 'enemyLaneOrder', targetPath, { minLength: 2 });
  const allyUnitOrder = uniqueStringArray(targets, 'allyUnitOrder', targetPath, { minLength: 2 });
  const allyLaneOrder = uniqueStringArray(targets, 'allyLaneOrder', targetPath, { minLength: 2 });
  enemyUnitOrder.forEach((policy) => { if (!UNIT_TARGET_POLICIES.has(policy)) fail(`${targetPath}.enemyUnitOrder 包含非法枚举 ${policy}`); });
  enemyLaneOrder.forEach((policy) => { if (!LANE_TARGET_POLICIES.has(policy)) fail(`${targetPath}.enemyLaneOrder 包含非法枚举 ${policy}`); });
  allyUnitOrder.forEach((policy) => { if (!ALLY_UNIT_TARGET_POLICIES.has(policy)) fail(`${targetPath}.allyUnitOrder 包含非法枚举 ${policy}`); });
  allyLaneOrder.forEach((policy) => { if (!ALLY_LANE_TARGET_POLICIES.has(policy)) fail(`${targetPath}.allyLaneOrder 包含非法枚举 ${policy}`); });
  const priorityTargetUnitIds = uniqueStringArray(targets, 'priorityTargetUnitIds', targetPath);
  assertKnownIds(priorityTargetUnitIds, new Set(unitById.keys()), `${targetPath}.priorityTargetUnitIds`);
  priorityTargetUnitIds.forEach((unitId, unitIndex) => {
    if (!unitIds.includes(unitId)) fail(`${targetPath}.priorityTargetUnitIds[${unitIndex}] 不在本策略单位 roster ${unitId}`);
    if (!deckUnitIds.has(unitId)) fail(`${targetPath}.priorityTargetUnitIds[${unitIndex}] 不在真实牌组 ${deckId} 中`);
  });
  enumField(targets, 'noLegalTarget', NO_LEGAL_TARGET_POLICIES, targetPath);
  enumField(targets, 'tieBreak', TIE_BREAKS, targetPath);

  const difficultyPath = `${configPath}.difficulty`;
  const difficulty = record(row.difficulty, difficultyPath);
  assertRequiredKeys(difficulty, DIFFICULTY_KEYS, difficultyPath);
  assertNoUnknownKeys(difficulty, DIFFICULTY_KEYS, difficultyPath);
  enumField(difficulty, 'tier', DIFFICULTIES, difficultyPath);
  integerField(difficulty, 'threatMultiplierPercent', 50, 150, difficultyPath);
  integerField(difficulty, 'skillReserveTurns', 0, 3, difficultyPath);

  const boundaryPath = `${configPath}.ruleBoundary`;
  const boundary = record(row.ruleBoundary, boundaryPath);
  assertRequiredKeys(boundary, RULE_BOUNDARY_KEYS, boundaryPath);
  assertNoUnknownKeys(boundary, RULE_BOUNDARY_KEYS, boundaryPath);
  integerField(boundary, 'maxConsecutiveSameLane', 1, 3, boundaryPath);
  enumField(boundary, 'sameLaneFallback', LANE_FALLBACKS, boundaryPath);
  booleanField(boundary, 'reserveSkillWhenNoLegalTarget', boundaryPath);
  enumField(boundary, 'openingCardPolicy', OPENING_POLICIES, boundaryPath);
  nullableIntegerField(boundary, 'enemyActionInterval', 1, 80, boundaryPath);
  enumField(boundary, 'phasePolicy', PHASE_POLICIES, boundaryPath);
  enumField(boundary, 'specialRule', SPECIAL_RULES, boundaryPath);
  integerField(boundary, 'maxRounds', 1, 80, boundaryPath);
  assertLevelBoundaries(level, boundary, boundaryPath);
}

function assertStrategies(value) {
  record(value, 'config/enemy/strategies');
  assertRequiredKeys(value, ROOT_KEYS, 'config/enemy/strategies');
  assertNoUnknownKeys(value, ROOT_KEYS, 'config/enemy/strategies');
  if (value.schemaVersion !== 1 || value.table !== 'strategies' || value.evidenceLevel !== 'C' || value.version !== 1 || value.enabled !== true) {
    fail('根元数据必须是 schemaVersion=1、table=strategies、evidenceLevel=C、version=1、enabled=true');
  }
  if (!Array.isArray(value.strategies) || value.strategies.length !== 12) fail('必须恰好配置 L01-L12 十二条策略');
  const ids = new Set();
  const levelIds = new Set();
  const expected = Array.from({ length: 12 }, (_, index) => `L${String(index + 1).padStart(2, '0')}`);
  value.strategies.forEach((strategy, index) => {
    if (ids.has(strategy.id)) fail(`策略 ID 重复 ${strategy.id}`);
    if (levelIds.has(strategy.levelId)) fail(`策略 levelId 重复 ${strategy.levelId}`);
    if (strategy.levelId !== expected[index]) fail(`策略数组必须按 L01-L12 顺序排列，位置 ${index} 不是 ${expected[index]}`);
    ids.add(strategy.id);
    levelIds.add(strategy.levelId);
    validateStrategy(strategy, index);
  });
  assert.deepEqual([...levelIds].sort(), expected, '策略必须覆盖且只覆盖 L01-L12');
}

assertStrategies(enemy);
enemy.strategies.forEach((strategy) => {
  assert.equal(strategy.maxCardsPerAction, 0, `${strategy.id} 必须遵循核心规则 R1=0`);
});
assert.equal(enemy.strategies[10].ruleBoundary.enemyActionInterval, 3, 'L11 必须映射真实 enemyActionInterval=3');
assert.equal(enemy.strategies[10].ruleBoundary.specialRule, 'L11_NAME_CHECK', 'L11 必须映射真实特殊规则');
assert.equal(enemy.strategies[10].ruleBoundary.phasePolicy, 'NOT_APPLICABLE', 'L11 阶段规则必须明确不适用');
assert.equal(enemy.strategies[11].ruleBoundary.enemyActionInterval, 3, 'L12 必须映射真实 enemyActionInterval=3');
assert.equal(enemy.strategies[11].ruleBoundary.specialRule, 'L12_POINT_BOOK', 'L12 必须映射真实特殊规则');
assert.equal(enemy.strategies[11].ruleBoundary.phasePolicy, 'L12_BOSS_PHASE_TRANSITION', 'L12 必须映射真实阶段规则');

const valid = structuredClone(enemy);
const expectFailure = (label, mutate, matcher) => {
  const fixture = structuredClone(valid);
  mutate(fixture);
  assert.throws(() => assertStrategies(fixture), matcher, `${label} 必须被拒绝`);
};

const negativeCases = [
  ['strategy count', (fixture) => { fixture.strategies.pop(); }, /必须恰好配置 L01-L12 十二条策略/],
  ['unknown deck', (fixture) => { fixture.strategies[0].deckId = 'D404'; }, /未知或未启用牌组/],
  ['unknown unit', (fixture) => { fixture.strategies[0].unitIds[0] = 'U999'; }, /未知引用/],
  ['unit not in deck', (fixture) => { fixture.strategies[0].unitIds[0] = 'U028'; }, /不在真实牌组/],
  ['priority target outside roster', (fixture) => { fixture.strategies[0].targetSelection.priorityTargetUnitIds = ['U002']; }, /不在本策略单位 roster/],
  ['unknown skill', (fixture) => { fixture.strategies[0].skillRules[0].skillId = 'S404'; }, /未知或未启用技能/],
  ['skill not in deck', (fixture) => { fixture.strategies[0].skillRules[0].skillId = 'S001'; }, /不在真实牌组/],
  ['duplicate skill rule', (fixture) => { fixture.strategies[0].skillRules.push({ ...fixture.strategies[0].skillRules[0] }); }, /skillId 重复/],
  ['environment mismatch', (fixture) => { fixture.strategies[0].environmentElement = 'FIRE'; }, /真实关卡环境不一致/],
  ['invalid environment enum', (fixture) => { fixture.strategies[0].environmentElement = 'VOID'; }, /非法枚举值/],
  ['duplicate strategy ID', (fixture) => { fixture.strategies[1].id = fixture.strategies[0].id; }, /策略 ID 重复/],
  ['duplicate level mapping', (fixture) => { fixture.strategies[1].levelId = fixture.strategies[0].levelId; }, /策略 levelId 重复/],
  ['strategy order', (fixture) => { [fixture.strategies[0], fixture.strategies[1]] = [fixture.strategies[1], fixture.strategies[0]]; }, /策略数组必须按 L01-L12 顺序排列/],
  ['invalid action enum', (fixture) => { fixture.strategies[0].actionPriority[0] = 'CAST_UNKNOWN'; }, /非法枚举/],
  ['action priority without terminal hold', (fixture) => { fixture.strategies[0].actionPriority[fixture.strategies[0].actionPriority.length - 1] = 'SUPPORT_RANGED'; }, /必须以 HOLD_NO_LEGAL_ACTION 收束/],
  ['duplicate action priority', (fixture) => { fixture.strategies[0].actionPriority[1] = fixture.strategies[0].actionPriority[0]; }, /不得包含重复 ID 或枚举/],
  ['empty action priority', (fixture) => { fixture.strategies[0].actionPriority = []; }, /非空 string 数组/],
  ['missing required strategy field', (fixture) => { delete fixture.strategies[0].difficulty; }, /difficulty 缺少必填字段/],
  ['unknown strategy field', (fixture) => { fixture.strategies[0].forgedAction = 'DEPLOY'; }, /未知字段/],
  ['unknown target field', (fixture) => { fixture.strategies[0].targetSelection.forgedPolicy = 'RANDOM'; }, /未知字段/],
  ['empty enemy unit order', (fixture) => { fixture.strategies[0].targetSelection.enemyUnitOrder = []; }, /非空 string 数组/],
  ['invalid target policy', (fixture) => { fixture.strategies[0].targetSelection.enemyUnitOrder[0] = 'RANDOM_GUESS'; }, /非法枚举/],
  ['duplicate target policy', (fixture) => { fixture.strategies[0].targetSelection.enemyUnitOrder[1] = fixture.strategies[0].targetSelection.enemyUnitOrder[0]; }, /不得包含重复 ID 或枚举/],
  ['missing target selection', (fixture) => { delete fixture.strategies[0].targetSelection; }, /targetSelection 缺少必填字段/],
  ['invalid skill target policy', (fixture) => { fixture.strategies[0].skillRules[0].targetPolicy = 'RANGED_SUPPORT'; }, /非法枚举值/],
  ['empty skill rules', (fixture) => { fixture.strategies[0].skillRules = []; }, /skillRules 不得为空/],
  ['invalid difficulty enum', (fixture) => { fixture.strategies[0].difficulty.tier = 'NIGHTMARE'; }, /非法枚举值/],
  ['out-of-range difficulty', (fixture) => { fixture.strategies[0].difficulty.threatMultiplierPercent = 151; }, /必须是 50 到 150 的整数/],
  ['missing difficulty field', (fixture) => { delete fixture.strategies[0].difficulty.skillReserveTurns; }, /skillReserveTurns 缺少必填字段/],
  ['non-zero max cards violates R1', (fixture) => { fixture.strategies[0].maxCardsPerAction = 1; }, /maxCardsPerAction 必须遵循核心规则 R1=0/],
  ['negative max cards', (fixture) => { fixture.strategies[0].maxCardsPerAction = -1; }, /必须是 0 到 30 的整数/],
  ['over-limit max cards', (fixture) => { fixture.strategies[0].maxCardsPerAction = 31; }, /必须是 0 到 30 的整数/],
  ['L01 default round boundary', (fixture) => { fixture.strategies[0].ruleBoundary.maxRounds = 79; }, /必须遵循真实关卡回合边界 80/],
  ['L08 round boundary', (fixture) => { fixture.strategies[7].ruleBoundary.maxRounds = 9; }, /必须遵循真实关卡回合边界 8/],
  ['L11 enemy action interval', (fixture) => { fixture.strategies[10].ruleBoundary.enemyActionInterval = 2; }, /enemyActionInterval 必须匹配真实关卡边界 3/],
  ['L12 enemy action interval', (fixture) => { fixture.strategies[11].ruleBoundary.enemyActionInterval = 2; }, /enemyActionInterval 必须匹配真实关卡边界 3/],
  ['L11 phase mismatch', (fixture) => { fixture.strategies[10].ruleBoundary.phasePolicy = 'L12_BOSS_PHASE_TRANSITION'; }, /phasePolicy 必须匹配真实阶段规则 NOT_APPLICABLE/],
  ['L12 phase mismatch', (fixture) => { fixture.strategies[11].ruleBoundary.phasePolicy = 'NOT_APPLICABLE'; }, /phasePolicy 必须匹配真实阶段规则 L12_BOSS_PHASE_TRANSITION/],
  ['L12 special rule mismatch', (fixture) => { fixture.strategies[11].ruleBoundary.specialRule = 'NOT_APPLICABLE'; }, /specialRule 必须匹配真实特殊规则 L12_POINT_BOOK/],
  ['invalid lane fallback', (fixture) => { fixture.strategies[0].ruleBoundary.sameLaneFallback = 'RANDOM'; }, /非法枚举值/],
  ['missing rule boundary field', (fixture) => { delete fixture.strategies[0].ruleBoundary.maxRounds; }, /maxRounds 缺少必填字段/],
  ['empty strategy weights', (fixture) => {
    fixture.strategies[0].lethalWeight = 0;
    fixture.strategies[0].defendWeight = 0;
    fixture.strategies[0].emptyLaneWeight = 0;
    fixture.strategies[0].rangedSupportWeight = 0;
  }, /行动权重不得全为 0/],
  ['invalid no-legal-target policy', (fixture) => { fixture.strategies[0].targetSelection.noLegalTarget = 'SKIP'; }, /非法枚举值/],
  ['missing root field', (fixture) => { delete fixture.schemaVersion; }, /schemaVersion 缺少必填字段/],
  ['unknown root field', (fixture) => { fixture.forgedTable = true; }, /未知字段/],
];

negativeCases.forEach(([label, mutate, matcher]) => expectFailure(label, mutate, matcher));
assert.ok(negativeCases.length >= 16, '负例数量必须至少为 16');
console.log(`Enemy strategy config PASS: L01-L12 configuration-driven mappings, complete fields, real deck/unit/skill/environment references, level boundaries; ${negativeCases.length} negative cases rejected`);
