const CONTENT_SCHEMA_VERSION = 1;
const CONTENT_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const LOCAL_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const RESOURCE_SEGMENT_PATTERN = /^[A-Za-z0-9._-]+$/;
const DANGEROUS_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
const STANDARD_OBJECT_PROTOTYPE_KEYS = new Set(Reflect.ownKeys(Object.prototype));
const ENVIRONMENTS = new Set(['NONE', 'METAL', 'WOOD', 'WATER', 'FIRE', 'EARTH']);
const LEVEL_OBJECTIVES = new Set(['DEFEAT_ENEMY_HERO', 'DESTROY_TARGET', 'PROTECT_TARGET', 'SURVIVE_ROUNDS']);
const LEVEL_REWARDS = new Set(['CARD', 'UNLOCK', 'CHEST', 'FLAG']);
const LEVEL_FAILURES = new Set(['PLAYER_HERO_DEFEATED', 'ROUND_LIMIT_REACHED', 'TARGET_DESTROYED']);
const CHAPTER_LEVEL_ID_PATTERN = /^L(?:0[1-9]|1[0-2])$/;
const TOWER_SPECIAL_RULES = new Set([
  'NONE', 'PRESSURE_LANES', 'ELEMENTAL_SURGE', 'REINFORCED_FRONT', 'SKILL_LOCK',
  'ESCALATING_THREAT', 'NO_SAFE_LANE', 'REVIVAL_WINDOW', 'BOSS_AURA', 'ASCENSION_TEST',
]);

export const CONTENT_TYPES = Object.freeze(['level', 'dungeon', 'tower-floor', 'boss']);
export const TOWER_FLOOR_MIN = 1;
export const TOWER_FLOOR_MAX = 50;

const LEVEL_RULE_SCHEMAS = Object.freeze({
  L01: { key: 'scenarioRules', fields: ['playerHeroHp', 'activeLaneCount', 'playerSummonSlots', 'unlockSecondLaneOnFirstDeployment', 'openingSkillCardsAllowed', 'enemyOpeningCardFilter'] },
  L02: {
    key: 'battleRules',
    fields: ['enemyDeploymentOrder', 'combatPreview', 'forbiddenSceneTargetActions'],
    nested: {
      combatPreview: ['counterMultiplier', 'showDamageBreakdown'],
    },
    objectArrays: {
      enemyDeploymentOrder: ['phase', 'kind', 'cardId', 'unitId'],
      forbiddenSceneTargetActions: ['targetId', 'action'],
    },
  },
  L03: {
    key: 'battleRules',
    fields: ['fastUnitIds', 'guardUnitIds', 'interceptUnitIds', 'movementTrigger', 'temporaryAid', 'requiredResponses'],
    nested: { movementTrigger: ['distance', 'responseUnitId'], temporaryAid: ['targetId', 'mode'] },
    arrays: ['fastUnitIds', 'guardUnitIds', 'interceptUnitIds', 'requiredResponses'],
  },
  L04: {
    key: 'scenarioRules',
    fields: ['playerHeroHp', 'enemyHeroHp', 'laneCount', 'laneLength', 'summonZone', 'deckSize', 'controlModes', 'canToggleAuto', 'roundLimit', 'seed', 'specialRules'],
    nested: { summonZone: ['laneCount', 'depth'] },
    arrays: ['controlModes'],
  },
  L05: {
    key: 'scenarioRules',
    fields: ['enemyFireUnitIds', 'burnStatus', 'waterCounterMultiplier', 'purifyAid', 'allowAlternateResponses', 'preserveControlledBeast'],
    nested: { purifyAid: ['characterId', 'uses'] },
    arrays: ['enemyFireUnitIds', 'allowAlternateResponses'],
  },
  L06: { key: 'scenarioRules', fields: ['rewardPolicy', 'environmentElement', 'sameElementEffectBonusPercent', 'fireEffectPenaltyPercent', 'freezeStatus', 'purifyAvailable', 'preBattleEnvironmentReadRequired', 'alternateSolutions'], arrays: ['alternateSolutions'] },
  L07: {
    key: 'scenarioRules',
    fields: ['environmentElement', 'enemyHeavyUnitIds', 'enemyGiantUnitIds', 'impactCounter', 'pierceCounter', 'knockbackRule', 'temporaryAid', 'alternateSolutions'],
    nested: {
      impactCounter: ['targetDefenseType', 'requiredOffenseType', 'availableUnitIds'],
      pierceCounter: ['targetDefenseType', 'requiredOffenseType', 'availableUnitIds'],
      knockbackRule: ['sourceUnitId', 'distance'],
      temporaryAid: ['characterId', 'mode', 'durationRounds'],
    },
    arrays: ['enemyHeavyUnitIds', 'enemyGiantUnitIds', 'alternateSolutions'],
  },
  L08: { key: 'scenarioRules', fields: ['protectedTargetId', 'roundLimit', 'playerHeroNamingImmune', 'namingTargetPolicy', 'prepareIncrease', 'shortControlDurationRounds', 'professionSkillPolicy', 'professionSkillIdForP001', 'recordProfessionAfterVictory', 'professionSwitchPreview'] },
  L09: {
    key: 'scenarioRules',
    fields: ['enemySpiritUnitIds', 'spiritDefenseType', 'physicalDamageMultiplier', 'spellDamageMultiplier', 'reviveRule', 'temporarySpellAid', 'purifySkillId', 'alternateSolutions'],
    nested: { reviveRule: ['unitIds', 'maxRevives', 'reviveHp', 'trigger'], temporarySpellAid: ['sourceCharacterId', 'cardId', 'uses'] },
    arrays: ['enemySpiritUnitIds', 'alternateSolutions'],
    nestedArrays: { reviveRule: ['unitIds'] },
  },
  L10: {
    key: 'scenarioRules',
    fields: ['sceneId', 'laneCount', 'keyTargetIds', 'laneTargetMapping', 'objectivePolicy', 'failureTargetPolicy', 'heroKillDoesNotEnd', 'outpostUnlockId'],
    objectArrays: { laneTargetMapping: ['lane', 'targetId', 'role'] },
    arrays: ['keyTargetIds'],
  },
  L11: {
    key: 'scenarioRules',
    fields: ['professionSkillPolicy', 'professionSkillIdByProfession', 'nameCheckRule', 'professionAdvantageRules'],
    nested: {
      professionSkillIdByProfession: ['P001', 'P002', 'P003', 'P004'],
      nameCheckRule: ['enemyActionInterval', 'prepareIncrease', 'tieBreak', 'seed'],
      professionAdvantageRules: ['P001', 'P002', 'P003', 'P004'],
    },
    nestedMaps: {
      professionAdvantageRules: {
        P001: ['counterRole', 'targetUnitIds'],
        P002: ['counterDefenseType', 'targetUnitIds'],
        P003: ['counterStatuses', 'targetUnitIds'],
        P004: ['minPrepare', 'targetUnitIds'],
      },
    },
  },
  L12: {
    key: 'scenarioRules',
    fields: ['sceneId', 'bossCharacterId', 'roundLimit', 'pointBookRule', 'phaseTransition', 'victoryPolicy', 'rewardRegistryIds'],
    nested: {
      pointBookRule: ['enemyActionInterval', 'summonUnitId', 'occupiedSlotPolicy', 'overwriteUnits'],
      phaseTransition: ['triggerBossHpPercent', 'bossEntersBattle', 'bossRole', 'nameLockAffects', 'unitCardPreparationNormal'],
    },
    arrays: ['rewardRegistryIds'],
    nestedArrays: { phaseTransition: ['nameLockAffects'] },
  },
});

const TOWER_ENEMY_POOL_BLUEPRINTS = Object.freeze([
  ['U001', 'U002', 'U003', 'U004', 'U005', 'U006'],
  ['U005', 'U006', 'U007', 'U008', 'U009', 'U010'],
  ['U009', 'U010', 'U011', 'U012', 'U013', 'U014'],
  ['U013', 'U014', 'U015', 'U016', 'U017', 'U018'],
  ['U017', 'U018', 'U019', 'U020', 'U021', 'U022'],
  ['U021', 'U022', 'U023', 'U024', 'U025', 'U026'],
  ['U023', 'U024', 'U025', 'U026', 'U027', 'U028'],
  ['U004', 'U010', 'U012', 'U018', 'U024', 'U027'],
  ['U007', 'U011', 'U015', 'U019', 'U020', 'U028'],
  ['U008', 'U019', 'U020', 'U023', 'U026', 'U028'],
]);

export class ContentTemplateError extends Error {
  constructor(code, configPath, message) {
    super(`${configPath}: ${message}`);
    this.name = 'ContentTemplateError';
    this.code = code;
    this.configPath = configPath;
  }
}

function fail(code, configPath, message) {
  throw new ContentTemplateError(code, configPath, message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSafeObject(value, configPath, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object') return;
  if (seen.has(value)) fail('INVALID_INPUT', configPath, '不得循环引用');
  seen.add(value);
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('INJECTION', `${configPath}.__proto__`, '数组 prototype 不受支持');
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^\d+$/.test(key)) fail('INJECTION', `${configPath}.${String(key)}`, '数组只允许连续索引');
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || descriptor.get || descriptor.set) fail('INJECTION', `${configPath}[${key}]`, '不得使用 getter、setter 或非枚举字段');
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, String(index))) fail('INVALID_INPUT', `${configPath}[${index}]`, '数组不得有空洞');
      assertSafeObject(value[index], `${configPath}[${index}]`, seen);
    }
    seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) fail('INJECTION', `${configPath}.__proto__`, '配置对象 prototype 必须是普通对象');
  const currentPrototypeKeys = Reflect.ownKeys(Object.prototype);
  if (currentPrototypeKeys.length !== STANDARD_OBJECT_PROTOTYPE_KEYS.size || currentPrototypeKeys.some((key) => !STANDARD_OBJECT_PROTOTYPE_KEYS.has(key))) {
    fail('INJECTION', `${configPath}.__proto__`, 'Object.prototype own-key 基线不匹配');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') fail('INJECTION', `${configPath}.${String(key)}`, '不允许 Symbol 字段');
    if (DANGEROUS_KEYS.has(key)) fail('INJECTION', `${configPath}.${key}`, '不允许原型注入字段');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || descriptor.get || descriptor.set) fail('INJECTION', `${configPath}.${key}`, '不得使用 getter、setter 或非枚举字段');
    assertSafeObject(value[key], `${configPath}.${key}`, seen);
  }
  seen.delete(value);
}

function cloneSafe(value, configPath = 'input') {
  assertSafeObject(value, configPath);
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) fail('INVALID_INPUT', configPath, '数字必须是有限值');
    if (value === undefined || typeof value === 'function' || typeof value === 'bigint' || typeof value === 'symbol') {
      fail('INVALID_INPUT', configPath, '只允许 JSON 值');
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => cloneSafe(item, `${configPath}[${index}]`));
  const result = {};
  for (const [key, child] of Object.entries(value)) result[key] = cloneSafe(child, `${configPath}.${key}`);
  return result;
}

function freezeDeep(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value, required, configPath, optional = []) {
  if (!isRecord(value)) fail('INVALID_INPUT', configPath, '必须是 object');
  const allowed = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail('UNKNOWN_FIELD', `${configPath}.${key}`, '不允许未知字段');
  }
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('MISSING_FIELD', `${configPath}.${key}`, '缺少必需字段');
  }
}

function safeString(value, configPath, { local = false } = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail('INVALID_VALUE', configPath, '必须是无首尾空白的非空 string');
  const pattern = local ? LOCAL_ID_PATTERN : CONTENT_ID_PATTERN;
  if (!pattern.test(value)) fail('INVALID_ID', configPath, `必须符合 ${local ? '局部' : '全局'} ID 政策`);
  return value;
}

function contentId(value, configPath) { return safeString(value, configPath); }
function localId(value, configPath) { return safeString(value, configPath, { local: true }); }

function safeResource(value, configPath) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\') || value.includes('\0')) {
    fail('PATH_ESCAPE', configPath, '必须是相对 POSIX 资源路径');
  }
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..' || !RESOURCE_SEGMENT_PATTERN.test(segment))) {
    fail('PATH_ESCAPE', configPath, '不得包含空段、.、.. 或非法路径字符');
  }
  return value;
}

function positiveInteger(value, configPath) {
  if (!Number.isSafeInteger(value) || value < 1) fail('BOUNDARY', configPath, '必须是正的 safe integer');
  return value;
}

function boundedInteger(value, configPath, minimum, maximum) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail('BOUNDARY', configPath, `必须是 ${minimum} 到 ${maximum} 的 safe integer`);
  return value;
}

function registry(context, name) {
  const value = context?.[name];
  if (value === undefined) return null;
  if (!Array.isArray(value) && !(value instanceof Set)) fail('INVALID_CONTEXT', `context.${name}`, '必须是 array 或 Set');
  return new Set(value);
}

function objectIdRegistry(context, directName, objectName) {
  const direct = registry(context, directName);
  if (direct) return direct;
  const value = context?.[objectName];
  if (value === undefined) return null;
  if (value instanceof Map) return new Set(value.keys());
  if (Array.isArray(value)) {
    if (value.some((item) => !isRecord(item) || typeof item.id !== 'string')) fail('INVALID_CONTEXT', `context.${objectName}`, '必须是包含 id 的 array');
    return new Set(value.map((item) => item.id));
  }
  fail('INVALID_CONTEXT', `context.${objectName}`, '必须是 array 或 Map');
}

function referenced(value, configPath, context, registryName) {
  const ids = registry(context, registryName);
  if (ids && !ids.has(value)) fail('MISSING_REFERENCE', configPath, `缺失 ${registryName} 引用: ${value}`);
  return value;
}

function uniqueIds(values, configPath, { local = true, allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) fail('INVALID_VALUE', configPath, allowEmpty ? '必须是 array' : '必须是非空 array');
  const seen = new Set();
  values.forEach((value, index) => {
    const id = local ? localId(value, `${configPath}[${index}]`) : contentId(value, `${configPath}[${index}]`);
    if (seen.has(id)) fail('DUPLICATE_ID', `${configPath}[${index}]`, `重复 ID: ${id}`);
    seen.add(id);
  });
  return values;
}

function optionalResource(input, type, id) {
  const defaultResource = type === 'level'
    ? `config/levels/generated/${id}`
    : type === 'dungeon'
      ? `config/dungeons/${id}`
      : type === 'tower-floor'
        ? `config/tower/floors/${id}`
        : `config/bosses/${id}`;
  return safeResource(input.resource === undefined ? defaultResource : input.resource, 'content.resource');
}

function validateLevelRules(config, id, configPath) {
  if (!CHAPTER_LEVEL_ID_PATTERN.test(id)) fail('INVALID_ID', `${configPath}.id`, '仅允许章节内 L01 至 L12');
  const schema = LEVEL_RULE_SCHEMAS[id];
  if (!schema) fail('INVALID_VALUE', `${configPath}.id`, `未知章节关卡规则: ${id}`);
  const ruleKey = schema.key;
  const unexpectedKey = ruleKey === 'scenarioRules' ? 'battleRules' : 'scenarioRules';
  if (Object.prototype.hasOwnProperty.call(config, unexpectedKey)) fail('UNKNOWN_FIELD', `${configPath}.${unexpectedKey}`, `不允许 ${id} 使用该规则容器`);
  if (!Object.prototype.hasOwnProperty.call(config, ruleKey)) fail('MISSING_FIELD', `${configPath}.${ruleKey}`, '缺少必需字段');
  const rulePath = `${configPath}.${ruleKey}`;
  const rules = config[ruleKey];
  exactKeys(rules, [], rulePath, schema.fields);
  for (const key of schema.arrays ?? []) {
    if (Object.prototype.hasOwnProperty.call(rules, key) && !Array.isArray(rules[key])) fail('INVALID_INPUT', `${rulePath}.${key}`, '必须是 array');
  }
  for (const [key, fields] of Object.entries(schema.nested ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(rules, key)) continue;
    exactKeys(rules[key], [], `${rulePath}.${key}`, fields);
  }
  for (const [key, fields] of Object.entries(schema.objectArrays ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(rules, key)) continue;
    if (!Array.isArray(rules[key])) fail('INVALID_INPUT', `${rulePath}.${key}`, '必须是 array');
    rules[key].forEach((item, index) => exactKeys(item, [], `${rulePath}.${key}[${index}]`, fields));
  }
  for (const [key, fields] of Object.entries(schema.nestedArrays ?? {})) {
    const nested = rules[key];
    if (!nested) continue;
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(nested, field) && !Array.isArray(nested[field])) fail('INVALID_INPUT', `${rulePath}.${key}.${field}`, '必须是 array');
    }
  }
  for (const [key, fields] of Object.entries(schema.nestedMaps ?? {})) {
    const mapValue = rules[key];
    if (mapValue === undefined) continue;
    exactKeys(mapValue, [], `${rulePath}.${key}`, Object.keys(fields));
    for (const [mapKey, mapFields] of Object.entries(fields)) {
      if (mapValue[mapKey] !== undefined) exactKeys(mapValue[mapKey], [], `${rulePath}.${key}.${mapKey}`, mapFields);
    }
  }
  return rules;
}

function rewardRegistry(context, type, configPath) {
  const registryName = type === 'UNLOCK' ? 'unlockIds' : type === 'CHEST' ? 'chestIds' : 'flagIds';
  const ids = registry(context, registryName);
  if (ids) return ids;
  if (context?.rewardIds !== undefined) fail('INVALID_CONTEXT', `context.${registryName}`, '奖励引用必须按类型提供，不能只提供无类型 rewardIds');
  return null;
}

function assertRewardTypeReference(context, type, id, configPath) {
  const cardIds = context?.cards instanceof Map ? context.cards : null;
  if (type !== 'CARD' && cardIds?.has(id)) fail('MISMATCHED_REFERENCE', configPath, `不得将卡牌 ID作为 ${type} 奖励: ${id}`);
  for (const otherType of ['UNLOCK', 'CHEST', 'FLAG']) {
    if (otherType === type) continue;
    const otherIds = registry(context, otherType === 'UNLOCK' ? 'unlockIds' : otherType === 'CHEST' ? 'chestIds' : 'flagIds');
    if (otherIds?.has(id)) fail('MISMATCHED_REFERENCE', configPath, `奖励 ID 不得跨类型注册: ${id}`);
  }
}

function cardReference(context, id, configPath) {
  const cards = context?.cards;
  if (cards === undefined) {
    if (context?.rewardIds !== undefined) fail('INVALID_CONTEXT', 'context.cards', 'CARD 奖励必须提供带 cardType/copyLimit 的 cards 注册表');
    return null;
  }
  if (!(cards instanceof Map)) fail('INVALID_CONTEXT', 'context.cards', '必须是 Map');
  const card = cards.get(id);
  if (!isRecord(card)) fail('MISSING_REFERENCE', configPath, `缺失卡牌奖励引用: ${id}`);
  if (card.cardType !== 'UNIT' && card.cardType !== 'SKILL') fail('INVALID_CONTEXT', `context.cards.${id}.cardType`, '必须是 UNIT 或 SKILL');
  positiveInteger(card.copyLimit, `context.cards.${id}.copyLimit`);
  return card;
}

function validateRuleRoundLimit(config, configPath) {
  const failure = config.failureConditions.find((condition) => condition.type === 'ROUND_LIMIT_REACHED');
  if (!failure) return;
  const ruleKey = config.scenarioRules ? 'scenarioRules' : 'battleRules';
  const roundLimit = config[ruleKey]?.roundLimit;
  if (roundLimit !== undefined && roundLimit !== failure.rounds) fail('MISMATCHED_REFERENCE', `${configPath}.${ruleKey}.roundLimit`, '必须与 ROUND_LIMIT_REACHED.rounds 一致');
}

function validateLevelConfig(config, context, configPath = 'level.config.chapterLevels[0]') {
  exactKeys(config, ['id', 'prerequisiteLevelId', 'enemyDeckId', 'environmentElement', 'objectives', 'rewards', 'failureConditions'], configPath, ['scenarioRules', 'battleRules']);
  const id = localId(config.id, `${configPath}.id`);
  if (config.prerequisiteLevelId !== null) {
    const prerequisite = localId(config.prerequisiteLevelId, `${configPath}.prerequisiteLevelId`);
    if (prerequisite === id) fail('REFERENCE_CYCLE', `${configPath}.prerequisiteLevelId`, '关卡不得引用自身');
    referenced(prerequisite, `${configPath}.prerequisiteLevelId`, context, 'levelIds');
  }
  referenced(localId(config.enemyDeckId, `${configPath}.enemyDeckId`), `${configPath}.enemyDeckId`, context, 'deckIds');
  if (!ENVIRONMENTS.has(config.environmentElement)) fail('INVALID_VALUE', `${configPath}.environmentElement`, '环境元素不受支持');

  if (!Array.isArray(config.objectives) || config.objectives.length === 0) fail('INVALID_VALUE', `${configPath}.objectives`, '必须是非空 array');
  config.objectives.forEach((objective, index) => {
    const path = `${configPath}.objectives[${index}]`;
    if (!isRecord(objective) || !LEVEL_OBJECTIVES.has(objective.type)) fail('INVALID_VALUE', path, '目标类型不受支持');
    if (objective.type === 'DEFEAT_ENEMY_HERO' && Object.keys(objective).length !== 1) fail('UNKNOWN_FIELD', path, '击败英雄目标不得带额外字段');
    if (objective.type === 'SURVIVE_ROUNDS') {
      exactKeys(objective, ['type', 'rounds'], path);
      positiveInteger(objective.rounds, `${path}.rounds`);
    }
    if (objective.type === 'DESTROY_TARGET' || objective.type === 'PROTECT_TARGET') {
      exactKeys(objective, ['type', 'targetId'], path);
      referenced(localId(objective.targetId, `${path}.targetId`), `${path}.targetId`, context, 'targetIds');
    }
  });

  if (!Array.isArray(config.rewards) || config.rewards.length === 0) fail('INVALID_VALUE', `${configPath}.rewards`, '必须是非空 array');
  config.rewards.forEach((reward, index) => {
    const path = `${configPath}.rewards[${index}]`;
    if (!isRecord(reward) || !LEVEL_REWARDS.has(reward.type)) fail('INVALID_VALUE', path, '奖励类型不受支持');
    exactKeys(reward, ['type', 'id', 'quantity'], path, reward.type === 'CARD' ? ['cardType'] : []);
    const rewardId = localId(reward.id, `${path}.id`);
    positiveInteger(reward.quantity, `${path}.quantity`);
    if (reward.type === 'CARD') {
      const card = cardReference(context, rewardId, `${path}.id`);
      assertRewardTypeReference(context, reward.type, rewardId, `${path}.id`);
      if (reward.cardType !== undefined && reward.cardType !== 'UNIT' && reward.cardType !== 'SKILL') fail('INVALID_VALUE', `${path}.cardType`, '必须是 UNIT 或 SKILL');
      if (card) {
        if (reward.cardType !== undefined && reward.cardType !== card.cardType) fail('MISMATCHED_REFERENCE', `${path}.cardType`, `与卡牌注册表不匹配: ${rewardId}`);
        if (reward.quantity > card.copyLimit) fail('BOUNDARY', `${path}.quantity`, `不得超过卡牌 copyLimit ${card.copyLimit}`);
      }
    } else {
      const ids = rewardRegistry(context, reward.type, `${path}.id`);
      assertRewardTypeReference(context, reward.type, rewardId, `${path}.id`);
      if (ids && !ids.has(rewardId)) fail('MISSING_REFERENCE', `${path}.id`, `缺失 ${reward.type} 奖励引用: ${rewardId}`);
    }
  });

  if (!Array.isArray(config.failureConditions) || config.failureConditions.length === 0) fail('INVALID_VALUE', `${configPath}.failureConditions`, '必须是非空 array');
  config.failureConditions.forEach((condition, index) => {
    const path = `${configPath}.failureConditions[${index}]`;
    if (!isRecord(condition) || !LEVEL_FAILURES.has(condition.type)) fail('INVALID_VALUE', path, '失败条件类型不受支持');
    if (condition.type === 'TARGET_DESTROYED') {
      exactKeys(condition, ['type', 'targetId'], path);
      referenced(localId(condition.targetId, `${path}.targetId`), `${path}.targetId`, context, 'targetIds');
    } else if (condition.type === 'ROUND_LIMIT_REACHED') {
      exactKeys(condition, ['type', 'rounds'], path);
      positiveInteger(condition.rounds, `${path}.rounds`);
    } else if (Object.keys(condition).length !== 1) {
      fail('UNKNOWN_FIELD', path, '该失败条件不得带额外字段');
    }
  });
  validateLevelRules(config, id, configPath);
  validateRuleRoundLimit(config, configPath);
  return id;
}

function validateDungeonConfig(config, context, configPath = 'dungeon.config') {
  if (!Array.isArray(config) || config.length !== 2) fail('BOUNDARY', configPath, '必须恰好包含 NORMAL 和 HARD 两种难度');
  const difficultyIds = new Set();
  const stageIds = [];
  const enemyIds = new Set();
  config.forEach((difficulty, difficultyIndex) => {
    const path = `${configPath}[${difficultyIndex}]`;
    exactKeys(difficulty, ['id', 'displayName', 'attemptLimit', 'unlock', 'stages', 'firstClearRewards', 'repeatClearRewards'], path);
    if (difficulty.id !== 'NORMAL' && difficulty.id !== 'HARD') fail('INVALID_VALUE', `${path}.id`, '只允许 NORMAL 或 HARD');
    if (difficultyIds.has(difficulty.id)) fail('DUPLICATE_ID', `${path}.id`, `重复难度: ${difficulty.id}`);
    difficultyIds.add(difficulty.id);
    if (typeof difficulty.displayName !== 'string' || difficulty.displayName.trim() !== difficulty.displayName || difficulty.displayName.length === 0) fail('INVALID_VALUE', `${path}.displayName`, '必须是非空显示名');
    positiveInteger(difficulty.attemptLimit, `${path}.attemptLimit`);
    exactKeys(difficulty.unlock, difficulty.unlock?.type === 'always' ? ['type'] : ['type', 'difficultyId', 'minimumClears'], path + '.unlock');
    if (difficulty.unlock.type === 'clearCount') {
      if (difficulty.unlock.difficultyId !== 'NORMAL' && difficulty.unlock.difficultyId !== 'HARD') fail('MISSING_REFERENCE', `${path}.unlock.difficultyId`, '难度引用不存在');
      if (difficulty.unlock.difficultyId === difficulty.id) fail('REFERENCE_CYCLE', `${path}.unlock.difficultyId`, '难度不得解锁自身');
      positiveInteger(difficulty.unlock.minimumClears, `${path}.unlock.minimumClears`);
    } else if (difficulty.unlock.type !== 'always') {
      fail('INVALID_VALUE', `${path}.unlock.type`, '必须是 always 或 clearCount');
    }
    if (!Array.isArray(difficulty.stages) || difficulty.stages.length !== 3) fail('BOUNDARY', `${path}.stages`, '必须恰好包含三段');
    const localStageIds = new Set();
    difficulty.stages.forEach((stage, stageIndex) => {
      const stagePath = `${path}.stages[${stageIndex}]`;
      exactKeys(stage, ['id', 'enemy'], stagePath);
      const stageId = localId(stage.id, `${stagePath}.id`);
      if (localStageIds.has(stageId)) fail('DUPLICATE_ID', `${stagePath}.id`, `重复阶段: ${stageId}`);
      localStageIds.add(stageId);
      if (difficultyIndex === 0) stageIds.push(stageId);
      else if (stageId !== stageIds[stageIndex]) fail('MISMATCHED_REFERENCE', `${stagePath}.id`, '两种难度必须共享阶段 ID 顺序');
      exactKeys(stage.enemy, ['id', 'hp', 'attack', 'defense'], `${stagePath}.enemy`);
      const enemyId = localId(stage.enemy.id, `${stagePath}.enemy.id`);
      if (enemyIds.has(enemyId)) fail('DUPLICATE_ID', `${stagePath}.enemy.id`, `重复敌人: ${enemyId}`);
      enemyIds.add(enemyId);
      referenced(enemyId, `${stagePath}.enemy.id`, context, 'enemyIds');
      positiveInteger(stage.enemy.hp, `${stagePath}.enemy.hp`);
      boundedInteger(stage.enemy.attack, `${stagePath}.enemy.attack`, 0, Number.MAX_SAFE_INTEGER);
      boundedInteger(stage.enemy.defense, `${stagePath}.enemy.defense`, 0, Number.MAX_SAFE_INTEGER);
    });
    for (const rewardGroup of ['firstClearRewards', 'repeatClearRewards']) {
      const rewards = difficulty[rewardGroup];
      if (!Array.isArray(rewards) || rewards.length === 0) fail('INVALID_VALUE', `${path}.${rewardGroup}`, '必须是非空 array');
      const rewardIds = new Set();
      rewards.forEach((reward, rewardIndex) => {
        const rewardPath = `${path}.${rewardGroup}[${rewardIndex}]`;
        exactKeys(reward, ['id', 'quantity'], rewardPath);
        const rewardId = localId(reward.id, `${rewardPath}.id`);
        if (rewardIds.has(rewardId)) fail('DUPLICATE_ID', `${rewardPath}.id`, `奖励组内重复 ID: ${rewardId}`);
        rewardIds.add(rewardId);
        referenced(rewardId, `${rewardPath}.id`, context, 'rewardIds');
        positiveInteger(reward.quantity, `${rewardPath}.quantity`);
      });
    }
  });
  if (!difficultyIds.has('NORMAL') || !difficultyIds.has('HARD')) fail('MISSING_REFERENCE', configPath, '必须同时包含 NORMAL 和 HARD');
  if (!config.some((difficulty) => difficulty.unlock.type === 'always')) fail('INVALID_VALUE', configPath, '至少一种难度必须 always 解锁');
  return config;
}

function expectedTowerEnemyIds(floor) {
  const floorIndex = floor - 1;
  const pool = TOWER_ENEMY_POOL_BLUEPRINTS[Math.floor(floorIndex / 5)];
  const count = Math.min(6, 2 + Math.floor(floorIndex / 10));
  const offset = floorIndex % pool.length;
  return Array.from({ length: count }, (_item, index) => pool[(offset + index) % pool.length]);
}

function validateTowerFloor(config, context, configPath = 'tower-floor.config') {
  exactKeys(config, ['floor', 'stageId', 'enemyPoolId', 'enemyIds', 'rules'], configPath);
  boundedInteger(config.floor, `${configPath}.floor`, TOWER_FLOOR_MIN, TOWER_FLOOR_MAX);
  const expectedStageId = `STAGE_${String(Math.floor((config.floor - 1) / 5) + 1).padStart(2, '0')}`;
  const expectedPoolId = `POOL_${String(Math.floor((config.floor - 1) / 5) + 1).padStart(2, '0')}`;
  if (localId(config.stageId, `${configPath}.stageId`) !== expectedStageId) fail('MISMATCHED_REFERENCE', `${configPath}.stageId`, `必须与 floor ${config.floor} 一致: ${expectedStageId}`);
  if (localId(config.enemyPoolId, `${configPath}.enemyPoolId`) !== expectedPoolId) fail('MISMATCHED_REFERENCE', `${configPath}.enemyPoolId`, `必须与 stageId 一致: ${expectedPoolId}`);
  const stageIds = objectIdRegistry(context, 'stageIds', 'stages');
  const poolIds = objectIdRegistry(context, 'enemyPoolIds', 'enemyPools');
  if (stageIds && !stageIds.has(config.stageId)) fail('MISSING_REFERENCE', `${configPath}.stageId`, `缺失 stageIds 引用: ${config.stageId}`);
  if (poolIds && !poolIds.has(config.enemyPoolId)) fail('MISSING_REFERENCE', `${configPath}.enemyPoolId`, `缺失 enemyPoolIds 引用: ${config.enemyPoolId}`);
  const stages = context?.stages;
  if (Array.isArray(stages)) {
    const stage = stages.find((candidate) => isRecord(candidate) && candidate.id === config.stageId);
    if (!stage) fail('MISSING_REFERENCE', `${configPath}.stageId`, `缺失 stages 引用: ${config.stageId}`);
    if (stage.enemyPoolId !== config.enemyPoolId || config.floor < stage.floorStart || config.floor > stage.floorEnd) fail('MISMATCHED_REFERENCE', `${configPath}.stageId`, '楼层、阶段与敌方池引用不一致');
  }
  uniqueIds(config.enemyIds, `${configPath}.enemyIds`);
  if (config.enemyIds.length < 2 || config.enemyIds.length > 6) fail('BOUNDARY', `${configPath}.enemyIds`, '必须是 2 到 6 个敌人');
  config.enemyIds.forEach((enemyId, index) => referenced(enemyId, `${configPath}.enemyIds[${index}]`, context, 'enemyUnitIds'));
  const expectedEnemyIds = expectedTowerEnemyIds(config.floor);
  if (config.enemyIds.length !== expectedEnemyIds.length || config.enemyIds.some((id, index) => id !== expectedEnemyIds[index])) {
    fail('PROGRESSION', `${configPath}.enemyIds`, '楼层敌人必须使用生产配置的固定递进序列；随机种子不受支持');
  }
  const pools = context?.enemyPools;
  if (Array.isArray(pools)) {
    const pool = pools.find((candidate) => isRecord(candidate) && candidate.id === config.enemyPoolId);
    if (!pool) fail('MISSING_REFERENCE', `${configPath}.enemyPoolId`, `缺失 enemyPools 引用: ${config.enemyPoolId}`);
    if (!config.enemyIds.every((enemyId) => Array.isArray(pool.unitIds) && pool.unitIds.includes(enemyId))) fail('MISSING_REFERENCE', `${configPath}.enemyIds`, '敌人必须来自引用的敌方池');
  }
  exactKeys(config.rules, [
    'threatMultiplierPercent', 'maxEnemyUnits', 'enemyActionInterval', 'maxRounds', 'randomness',
    'environmentElement', 'specialRule',
  ], `${configPath}.rules`);
  boundedInteger(config.rules.threatMultiplierPercent, `${configPath}.rules.threatMultiplierPercent`, 100, 500);
  boundedInteger(config.rules.maxEnemyUnits, `${configPath}.rules.maxEnemyUnits`, 2, 6);
  boundedInteger(config.rules.enemyActionInterval, `${configPath}.rules.enemyActionInterval`, 1, 5);
  boundedInteger(config.rules.maxRounds, `${configPath}.rules.maxRounds`, 12, 60);
  boundedInteger(config.rules.randomness, `${configPath}.rules.randomness`, 0, 500);
  if (!ENVIRONMENTS.has(config.rules.environmentElement)) fail('INVALID_VALUE', `${configPath}.rules.environmentElement`, '环境元素不受支持');
  if (!TOWER_SPECIAL_RULES.has(config.rules.specialRule)) fail('INVALID_VALUE', `${configPath}.rules.specialRule`, '特殊规则不受支持');
  if (config.enemyIds.length > config.rules.maxEnemyUnits) fail('BOUNDARY', `${configPath}.enemyIds`, '敌人数不得超过该层上限');
  const previous = context?.previousFloor;
  if (previous) {
    if (!isRecord(previous) || previous.floor >= config.floor) fail('PROGRESSION', `${configPath}.floor`, '当前楼层必须高于 context.previousFloor');
    const { previousFloor: _previousFloor, ...previousContext } = context;
    validateTowerFloor(previous, previousContext, 'context.previousFloor');
    if (config.rules.threatMultiplierPercent <= previous.rules.threatMultiplierPercent) fail('PROGRESSION', `${configPath}.rules.threatMultiplierPercent`, '威胁倍率必须递增');
    if (config.rules.maxEnemyUnits < previous.rules.maxEnemyUnits) fail('PROGRESSION', `${configPath}.rules.maxEnemyUnits`, '敌人数上限不得下降');
    if (config.rules.enemyActionInterval > previous.rules.enemyActionInterval) fail('PROGRESSION', `${configPath}.rules.enemyActionInterval`, '敌方行动间隔不得变慢');
    if (config.rules.maxRounds > previous.rules.maxRounds) fail('PROGRESSION', `${configPath}.rules.maxRounds`, '回合上限不得增加');
    if (config.rules.randomness > previous.rules.randomness) fail('PROGRESSION', `${configPath}.rules.randomness`, '随机性不得增加');
  }
  return config;
}

function validateBossConfig(config, context, configPath = 'boss.config') {
  exactKeys(config, ['id', 'maxHp', 'phases', 'skills', 'summons', 'flags', 'outcome'], configPath);
  contentId(config.id, `${configPath}.id`);
  positiveInteger(config.maxHp, `${configPath}.maxHp`);
  uniqueIds(config.flags, `${configPath}.flags`, { allowEmpty: true });
  const flags = new Set(config.flags);
  if (!Array.isArray(config.summons) || config.summons.length === 0) fail('INVALID_VALUE', `${configPath}.summons`, '必须是非空 array');
  const summonIds = new Set();
  config.summons.forEach((summon, index) => {
    const path = `${configPath}.summons[${index}]`;
    exactKeys(summon, ['id', 'unitId', 'maxHp', 'maxActive'], path);
    const id = localId(summon.id, `${path}.id`);
    if (summonIds.has(id)) fail('DUPLICATE_ID', `${path}.id`, `重复召唤: ${id}`);
    summonIds.add(id);
    referenced(localId(summon.unitId, `${path}.unitId`), `${path}.unitId`, context, 'unitIds');
    positiveInteger(summon.maxHp, `${path}.maxHp`);
    positiveInteger(summon.maxActive, `${path}.maxActive`);
  });
  if (!Array.isArray(config.skills) || config.skills.length === 0) fail('INVALID_VALUE', `${configPath}.skills`, '必须是非空 array');
  const skillIds = new Set();
  config.skills.forEach((skill, index) => {
    const path = `${configPath}.skills[${index}]`;
    exactKeys(skill, ['id', 'effect'], path);
    const id = localId(skill.id, `${path}.id`);
    if (skillIds.has(id)) fail('DUPLICATE_ID', `${path}.id`, `重复技能: ${id}`);
    skillIds.add(id);
    exactKeys(skill.effect, ['type', ...(skill.effect?.type === 'SUMMON' ? ['summonId'] : skill.effect?.type === 'SET_FLAG' ? ['flag', 'value'] : ['amount'])], `${path}.effect`);
    if (skill.effect.type === 'SUMMON') {
      if (!summonIds.has(localId(skill.effect.summonId, `${path}.effect.summonId`))) fail('MISSING_REFERENCE', `${path}.effect.summonId`, '未声明召唤');
    } else if (skill.effect.type === 'SET_FLAG') {
      const flag = localId(skill.effect.flag, `${path}.effect.flag`);
      if (!flags.has(flag)) fail('MISSING_REFERENCE', `${path}.effect.flag`, '未声明旗标');
      if (typeof skill.effect.value !== 'boolean') fail('INVALID_VALUE', `${path}.effect.value`, '必须是 boolean');
    } else if (skill.effect.type === 'DAMAGE_PLAYER_HERO' || skill.effect.type === 'HEAL_BOSS') {
      positiveInteger(skill.effect.amount, `${path}.effect.amount`);
    } else {
      fail('INVALID_VALUE', `${path}.effect.type`, '技能效果不受支持');
    }
  });
  if (!Array.isArray(config.phases) || config.phases.length === 0) fail('INVALID_VALUE', `${configPath}.phases`, '必须是非空 array');
  const phaseIds = new Set();
  let previousThreshold = 101;
  config.phases.forEach((phase, index) => {
    const path = `${configPath}.phases[${index}]`;
    exactKeys(phase, ['id', 'hpPercentAtMost', 'skillIds', 'onEnterSummonIds'], path);
    const id = localId(phase.id, `${path}.id`);
    if (phaseIds.has(id)) fail('DUPLICATE_ID', `${path}.id`, `重复阶段: ${id}`);
    phaseIds.add(id);
    if (typeof phase.hpPercentAtMost !== 'number' || !Number.isFinite(phase.hpPercentAtMost) || phase.hpPercentAtMost < 0 || phase.hpPercentAtMost > 100) fail('BOUNDARY', `${path}.hpPercentAtMost`, '必须是 0 到 100 的有限数字');
    if (index === 0 && phase.hpPercentAtMost !== 100) fail('BOUNDARY', `${path}.hpPercentAtMost`, '第一阶段必须从 100% 生效');
    if (phase.hpPercentAtMost >= previousThreshold) fail('PROGRESSION', `${path}.hpPercentAtMost`, '阶段阈值必须严格递减');
    previousThreshold = phase.hpPercentAtMost;
    uniqueIds(phase.skillIds, `${path}.skillIds`).forEach((skillId, skillIndex) => {
      if (!skillIds.has(skillId)) fail('MISSING_REFERENCE', `${path}.skillIds[${skillIndex}]`, '未声明技能');
    });
    uniqueIds(phase.onEnterSummonIds, `${path}.onEnterSummonIds`, { allowEmpty: true }).forEach((summonId, summonIndex) => {
      if (!summonIds.has(summonId)) fail('MISSING_REFERENCE', `${path}.onEnterSummonIds[${summonIndex}]`, '未声明召唤');
    });
  });
  exactKeys(config.outcome, ['priority', 'win', 'lose'], `${configPath}.outcome`);
  if (config.outcome.priority !== 'WIN' && config.outcome.priority !== 'LOSE') fail('INVALID_VALUE', `${configPath}.outcome.priority`, '必须是 WIN 或 LOSE');
  for (const groupName of ['win', 'lose']) {
    const path = `${configPath}.outcome.${groupName}`;
    exactKeys(config.outcome[groupName], ['mode', 'rules'], path);
    if (config.outcome[groupName].mode !== 'ANY' && config.outcome[groupName].mode !== 'ALL') fail('INVALID_VALUE', `${path}.mode`, '必须是 ANY 或 ALL');
    if (!Array.isArray(config.outcome[groupName].rules) || config.outcome[groupName].rules.length === 0) fail('INVALID_VALUE', `${path}.rules`, '不得为空');
    config.outcome[groupName].rules.forEach((rule, index) => {
      const rulePath = `${path}.rules[${index}]`;
      if (rule.type === 'FLAG_SET') {
        exactKeys(rule, ['type', 'flag'], rulePath);
        if (!flags.has(localId(rule.flag, `${rulePath}.flag`))) fail('MISSING_REFERENCE', `${rulePath}.flag`, '未声明旗标');
      } else {
        exactKeys(rule, ['type', 'value'], rulePath);
        if (!new Set(['BOSS_HP_AT_MOST', 'PLAYER_HERO_HP_AT_MOST', 'ROUND_AT_LEAST', 'ACTIVE_SUMMONS_AT_LEAST', 'ACTIVE_SUMMONS_AT_MOST']).has(rule.type)) fail('INVALID_VALUE', `${rulePath}.type`, '胜负规则不受支持');
        if (rule.type === 'ROUND_AT_LEAST') positiveInteger(rule.value, `${rulePath}.value`);
        else boundedInteger(rule.value, `${rulePath}.value`, 0, Number.MAX_SAFE_INTEGER);
      }
    });
  }
  return config;
}

function makeEntry(type, id, resource, config) {
  return freezeDeep({ schemaVersion: CONTENT_SCHEMA_VERSION, type, id, resource, config });
}

export function generateLevel(input, context = {}) {
  const source = cloneSafe(input, 'level');
  exactKeys(source, ['id', 'prerequisiteLevelId', 'enemyDeckId', 'environmentElement', 'objectives', 'rewards', 'failureConditions'], 'level', ['resource', 'scenarioRules', 'battleRules']);
  const id = contentId(source.id, 'level.id');
  const resource = optionalResource(source, 'level', id);
  const { resource: _resource, ...config } = source;
  validateLevelConfig(config, context);
  return makeEntry('level', id, resource, { chapterLevels: [config] });
}

export function generateDungeon(input, context = {}) {
  const source = cloneSafe(input, 'dungeon');
  exactKeys(source, ['id', 'difficulties'], 'dungeon', ['resource']);
  const id = contentId(source.id, 'dungeon.id');
  const resource = optionalResource(source, 'dungeon', id);
  validateDungeonConfig(source.difficulties, context);
  return makeEntry('dungeon', id, resource, source.difficulties);
}

export function generateTowerFloor(input, context = {}) {
  const source = cloneSafe(input, 'tower-floor');
  exactKeys(source, ['id', 'floor', 'stageId', 'enemyPoolId', 'enemyIds', 'rules'], 'tower-floor', ['resource']);
  const id = contentId(source.id, 'tower-floor.id');
  const resource = optionalResource(source, 'tower-floor', id);
  if (!Array.isArray(source.enemyIds)) fail('INVALID_VALUE', 'tower-floor.enemyIds', '必须是显式 array；不支持 enemyPoolUnitIds/enemyCount/seed 随机采样');
  const config = {
    floor: source.floor,
    stageId: source.stageId,
    enemyPoolId: source.enemyPoolId,
    enemyIds: source.enemyIds,
    rules: source.rules,
  };
  validateTowerFloor(config, context);
  return makeEntry('tower-floor', id, resource, config);
}

export function generateBoss(input, context = {}) {
  const source = cloneSafe(input, 'boss');
  exactKeys(source, ['id', 'maxHp', 'phases', 'skills', 'summons', 'flags', 'outcome'], 'boss', ['resource']);
  const id = contentId(source.id, 'boss.id');
  const resource = optionalResource(source, 'boss', id);
  const { resource: _resource, ...config } = source;
  validateBossConfig(config, context);
  return makeEntry('boss', id, resource, config);
}

export function generateContent(type, input, context = {}) {
  if (type === 'level') return generateLevel(input, context);
  if (type === 'dungeon') return generateDungeon(input, context);
  if (type === 'tower-floor') return generateTowerFloor(input, context);
  if (type === 'boss') return generateBoss(input, context);
  fail('INVALID_VALUE', 'content.type', `不支持的内容类型: ${String(type)}`);
}

export function generateContentPack(entries, context = {}) {
  const source = cloneSafe(entries, 'pack.entries');
  if (!Array.isArray(source) || source.length === 0) fail('INVALID_VALUE', 'pack.entries', '必须是非空 array');
  const generated = source.map((entry, index) => {
    if (!isRecord(entry) || !CONTENT_TYPES.includes(entry.type)) fail('INVALID_VALUE', `pack.entries[${index}].type`, '内容类型不受支持');
    exactKeys(entry, ['type', 'input'], `pack.entries[${index}]`);
    return generateContent(entry.type, entry.input, context);
  });
  const ids = new Set();
  const resources = new Set();
  generated.forEach((entry, index) => {
    if (ids.has(entry.id)) fail('DUPLICATE_ID', `pack.entries[${index}].id`, `重复内容 ID: ${entry.id}`);
    if (resources.has(entry.resource)) fail('DUPLICATE_RESOURCE', `pack.entries[${index}].resource`, `重复资源路径: ${entry.resource}`);
    ids.add(entry.id);
    resources.add(entry.resource);
  });
  generated.sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
  return freezeDeep({ schemaVersion: CONTENT_SCHEMA_VERSION, entries: generated });
}

export function canonicalJson(value) {
  const source = cloneSafe(value, 'canonical');
  const sort = (candidate) => {
    if (Array.isArray(candidate)) return candidate.map(sort);
    if (!isRecord(candidate)) return candidate;
    return Object.fromEntries(Object.keys(candidate).sort().map((key) => [key, sort(candidate[key])]));
  };
  return JSON.stringify(sort(source));
}

export function validateContentEntry(entry, context = {}) {
  const source = cloneSafe(entry, 'entry');
  exactKeys(source, ['schemaVersion', 'type', 'id', 'resource', 'config'], 'entry');
  if (source.schemaVersion !== CONTENT_SCHEMA_VERSION) fail('INVALID_VALUE', 'entry.schemaVersion', `必须是 ${CONTENT_SCHEMA_VERSION}`);
  if (!CONTENT_TYPES.includes(source.type)) fail('INVALID_VALUE', 'entry.type', '内容类型不受支持');
  contentId(source.id, 'entry.id');
  safeResource(source.resource, 'entry.resource');
  if (source.type === 'level') {
    exactKeys(source.config, ['chapterLevels'], 'entry.config');
    if (!Array.isArray(source.config.chapterLevels) || source.config.chapterLevels.length !== 1) fail('BOUNDARY', 'entry.config.chapterLevels', '必须恰好包含一个关卡');
    if (source.config.chapterLevels[0]?.id !== source.id) fail('MISMATCHED_REFERENCE', 'entry.config.chapterLevels[0].id', '必须与 entry.id 一致');
    validateLevelConfig(source.config.chapterLevels[0], context, 'entry.config.chapterLevels[0]');
  }
  if (source.type === 'dungeon') validateDungeonConfig(source.config, context, 'entry.config');
  if (source.type === 'tower-floor') validateTowerFloor(source.config, context, 'entry.config');
  if (source.type === 'boss') {
    if (source.config?.id !== source.id) fail('MISMATCHED_REFERENCE', 'entry.config.id', '必须与 entry.id 一致');
    validateBossConfig(source.config, context, 'entry.config');
  }
  return true;
}

export function validateContentPack(pack, context = {}) {
  const source = cloneSafe(pack, 'pack');
  exactKeys(source, ['schemaVersion', 'entries'], 'pack');
  if (source.schemaVersion !== CONTENT_SCHEMA_VERSION) fail('INVALID_VALUE', 'pack.schemaVersion', `必须是 ${CONTENT_SCHEMA_VERSION}`);
  if (!Array.isArray(source.entries) || source.entries.length === 0) fail('INVALID_VALUE', 'pack.entries', '必须是非空 array');
  const ids = new Set();
  const resources = new Set();
  source.entries.forEach((entry, index) => {
    validateContentEntry(entry, context);
    if (ids.has(entry.id)) fail('DUPLICATE_ID', `pack.entries[${index}].id`, `重复内容 ID: ${entry.id}`);
    if (resources.has(entry.resource)) fail('DUPLICATE_RESOURCE', `pack.entries[${index}].resource`, `重复资源路径: ${entry.resource}`);
    ids.add(entry.id);
    resources.add(entry.resource);
  });
  return true;
}
