import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';

export type EnvironmentElement = 'NONE' | 'METAL' | 'WOOD' | 'WATER' | 'FIRE' | 'EARTH';
export type LevelObjectiveType = 'DEFEAT_ENEMY_HERO' | 'DESTROY_TARGET' | 'PROTECT_TARGET' | 'SURVIVE_ROUNDS';
export type LevelRewardType = 'CARD' | 'UNLOCK' | 'CHEST' | 'FLAG';
export type LevelFailureType = 'PLAYER_HERO_DEFEATED' | 'ROUND_LIMIT_REACHED' | 'TARGET_DESTROYED';
export type BattleControlMode = 'MANUAL' | 'AUTO';
export type OpeningSkillRestriction = 'NONE' | 'NO_SKILLS' | 'PLAYER_ONLY' | 'ENEMY_ONLY';
export type EnemyCardFilter = 'ALL' | 'UNITS_ONLY' | 'SKILLS_ONLY';

export interface ChapterBattleRules {
  activeLaneCount?: number;
  summonSlots?: number;
  openingSkillRestriction?: OpeningSkillRestriction;
  enemyCardFilter?: EnemyCardFilter;
  controlMode?: BattleControlMode;
  mirror?: boolean;
  fast?: boolean;
  guard?: boolean;
  intercept?: boolean;
  temporaryAid?: boolean;
}

export interface ChapterLevelObjective {
  type: LevelObjectiveType;
  targetId?: string;
  rounds?: number;
}

export interface ChapterLevelReward {
  type: LevelRewardType;
  id: string;
  quantity: number;
  cardType?: 'UNIT' | 'SKILL';
}

export interface ChapterLevelFailureCondition {
  type: LevelFailureType;
  targetId?: string;
}

export interface ChapterLevelConfig {
  id: string;
  prerequisiteLevelId: string | null;
  enemyDeckId: string;
  environmentElement: EnvironmentElement;
  objectives: ChapterLevelObjective[];
  rewards: ChapterLevelReward[];
  failureConditions: ChapterLevelFailureCondition[];
  battleRules?: ChapterBattleRules;
}

export interface ChapterLevelContract {
  chapterLevels: ChapterLevelConfig[];
}

interface DeckTable {
  decks: Array<{ id: string }>;
}

export interface ChapterLevelCardReference {
  cardType?: 'UNIT' | 'SKILL';
  copyLimit?: number;
}

export interface ChapterLevelReferences {
  chapterLevelIds: ReadonlySet<string>;
  targetIds: ReadonlySet<string>;
  cards: ReadonlyMap<string, ChapterLevelCardReference>;
  unlockIds: ReadonlySet<string>;
  chestIds: ReadonlySet<string>;
  flagIds: ReadonlySet<string>;
}

const CHAPTER_LEVEL_ID = /^L(?:0[1-9]|1[0-2])$/;
const ENVIRONMENT_ELEMENTS: readonly EnvironmentElement[] = ['NONE', 'METAL', 'WOOD', 'WATER', 'FIRE', 'EARTH'];
const OBJECTIVE_TYPES: readonly LevelObjectiveType[] = ['DEFEAT_ENEMY_HERO', 'DESTROY_TARGET', 'PROTECT_TARGET', 'SURVIVE_ROUNDS'];
const REWARD_TYPES: readonly LevelRewardType[] = ['CARD', 'UNLOCK', 'CHEST', 'FLAG'];
const FAILURE_TYPES: readonly LevelFailureType[] = ['PLAYER_HERO_DEFEATED', 'ROUND_LIMIT_REACHED', 'TARGET_DESTROYED'];
const BATTLE_RULE_KEYS = new Set([
  'activeLaneCount',
  'summonSlots',
  'openingSkillRestriction',
  'enemyCardFilter',
  'controlMode',
  'mirror',
  'fast',
  'guard',
  'intercept',
  'temporaryAid',
]);
const OPENING_SKILL_RESTRICTIONS: readonly OpeningSkillRestriction[] = ['NONE', 'NO_SKILLS', 'PLAYER_ONLY', 'ENEMY_ONLY'];
const ENEMY_CARD_FILTERS: readonly EnemyCardFilter[] = ['ALL', 'UNITS_ONLY', 'SKILLS_ONLY'];
const BATTLE_CONTROL_MODES: readonly BattleControlMode[] = ['MANUAL', 'AUTO'];

function isLevelRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function levelRequired(record: Record<string, unknown>, key: string, configPath: string): unknown {
  if (!(key in record)) throw new ConfigLoadError(`${configPath}.${key}`, '缺少必需字段');
  return record[key];
}

function positiveInteger(value: unknown, configPath: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ConfigLoadError(configPath, '必须是正整数');
  }
  return value;
}

function idPattern(manifest: ConfigManifest): RegExp {
  try {
    return new RegExp(manifest.idPolicy.format);
  } catch {
    throw new ConfigLoadError('config/manifest.idPolicy.format', '必须是有效的正则表达式');
  }
}

function assertId(value: unknown, configPath: string, pattern: RegExp): string {
  if (typeof value !== 'string' || value.length === 0 || !pattern.test(value)) {
    throw new ConfigLoadError(configPath, '必须符合 manifest ID 政策');
  }
  return value;
}

function assertChapterLevelId(value: unknown, configPath: string, pattern: RegExp): string {
  const id = assertId(value, configPath, pattern);
  if (!CHAPTER_LEVEL_ID.test(id)) {
    throw new ConfigLoadError(configPath, '仅允许章节内 L01 至 L12');
  }
  return id;
}

function assertTargetId(value: unknown, configPath: string, pattern: RegExp): string {
  return assertId(value, configPath, pattern);
}

function assertRegisteredId(
  value: unknown,
  configPath: string,
  pattern: RegExp,
  registry: ReadonlySet<string>,
  missingMessage: string,
): string {
  const id = assertId(value, configPath, pattern);
  if (!registry.has(id)) throw new ConfigLoadError(configPath, `${missingMessage}: ${id}`);
  return id;
}

function assertObjectives(
  value: unknown,
  configPath: string,
  pattern: RegExp,
  targetIds?: ReadonlySet<string>,
): ChapterLevelObjective[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigLoadError(configPath, '必须是非空 array');
  }
  return value.map((objective, index) => {
    const itemPath = `${configPath}[${index}]`;
    if (!isLevelRecord(objective)) throw new ConfigLoadError(itemPath, '必须是 object');
    const type = levelRequired(objective, 'type', itemPath);
    if (typeof type !== 'string' || !OBJECTIVE_TYPES.includes(type as LevelObjectiveType)) {
      throw new ConfigLoadError(`${itemPath}.type`, `必须是 ${OBJECTIVE_TYPES.join('、')} 之一`);
    }
    if (type === 'DESTROY_TARGET' || type === 'PROTECT_TARGET') {
      const targetPath = `${itemPath}.targetId`;
      if (targetIds) {
        assertRegisteredId(levelRequired(objective, 'targetId', itemPath), targetPath, pattern, targetIds, '缺失目标引用');
      } else {
        assertTargetId(levelRequired(objective, 'targetId', itemPath), targetPath, pattern);
      }
    }
    if (type === 'SURVIVE_ROUNDS') {
      positiveInteger(levelRequired(objective, 'rounds', itemPath), `${itemPath}.rounds`);
    }
    return objective as ChapterLevelObjective;
  });
}

function assertRewards(
  value: unknown,
  configPath: string,
  pattern: RegExp,
  references?: ChapterLevelReferences,
  forbiddenRewardIds?: ReadonlySet<string>,
): ChapterLevelReward[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigLoadError(configPath, '必须是非空 array');
  }
  return value.map((reward, index) => {
    const itemPath = `${configPath}[${index}]`;
    if (!isLevelRecord(reward)) throw new ConfigLoadError(itemPath, '必须是 object');
    const type = levelRequired(reward, 'type', itemPath);
    if (typeof type !== 'string' || !REWARD_TYPES.includes(type as LevelRewardType)) {
      throw new ConfigLoadError(`${itemPath}.type`, `必须是 ${REWARD_TYPES.join('、')} 之一`);
    }
    const idPath = `${itemPath}.id`;
    const id = assertId(levelRequired(reward, 'id', itemPath), idPath, pattern);
    const quantity = positiveInteger(levelRequired(reward, 'quantity', itemPath), `${itemPath}.quantity`);
    if (type === 'CARD' && 'cardType' in reward) {
      const cardType = reward.cardType;
      if (cardType !== 'UNIT' && cardType !== 'SKILL') {
        throw new ConfigLoadError(`${itemPath}.cardType`, '必须是 UNIT 或 SKILL');
      }
    }
    if (references) {
      if (type === 'CARD') {
        const card = references.cards.get(id);
        if (!card) throw new ConfigLoadError(idPath, `缺失卡牌奖励引用: ${id}`);
        if (card.cardType !== undefined && card.cardType !== 'UNIT') {
          throw new ConfigLoadError(idPath, `卡牌奖励必须引用 UNIT 卡: ${id}`);
        }
        if ('cardType' in reward && card.cardType !== undefined && reward.cardType !== card.cardType) {
          throw new ConfigLoadError(`${itemPath}.cardType`, `与卡牌注册表不匹配: ${id}`);
        }
        if (card.copyLimit !== undefined && quantity > card.copyLimit) {
          throw new ConfigLoadError(`${itemPath}.quantity`, `不得超过卡牌 copyLimit ${card.copyLimit}`);
        }
      } else {
        const registry = type === 'UNLOCK'
          ? references.unlockIds
          : type === 'CHEST'
            ? references.chestIds
            : references.flagIds;
        const registryName = type === 'UNLOCK' ? '解锁' : type === 'CHEST' ? '宝箱' : '旗号';
        if (!registry.has(id)) throw new ConfigLoadError(idPath, `缺失${registryName}奖励引用: ${id}`);
        if (forbiddenRewardIds?.has(id)) {
          throw new ConfigLoadError(idPath, `不得将牌组、目标或卡牌 ID作为${registryName}奖励: ${id}`);
        }
      }
    }
    return reward as ChapterLevelReward;
  });
}

function assertFailureConditions(
  value: unknown,
  configPath: string,
  pattern: RegExp,
  targetIds?: ReadonlySet<string>,
): ChapterLevelFailureCondition[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigLoadError(configPath, '必须是非空 array');
  }
  return value.map((condition, index) => {
    const itemPath = `${configPath}[${index}]`;
    if (!isLevelRecord(condition)) throw new ConfigLoadError(itemPath, '必须是 object');
    const type = levelRequired(condition, 'type', itemPath);
    if (typeof type !== 'string' || !FAILURE_TYPES.includes(type as LevelFailureType)) {
      throw new ConfigLoadError(`${itemPath}.type`, `必须是 ${FAILURE_TYPES.join('、')} 之一`);
    }
    if (type === 'TARGET_DESTROYED') {
      const targetPath = `${itemPath}.targetId`;
      if (targetIds) {
        assertRegisteredId(levelRequired(condition, 'targetId', itemPath), targetPath, pattern, targetIds, '缺失目标引用');
      } else {
        assertTargetId(levelRequired(condition, 'targetId', itemPath), targetPath, pattern);
      }
    }
    return condition as ChapterLevelFailureCondition;
  });
}

function deckIds(value: unknown): Set<string> {
  if (!isLevelRecord(value) || !Array.isArray(value.decks) || value.decks.some((deck) => !isLevelRecord(deck) || typeof deck.id !== 'string')) {
    throw new ConfigLoadError('config/decks.decks', '必须是包含 ID 的 array');
  }
  return new Set((value as DeckTable).decks.map((deck) => deck.id));
}

function boundedInteger(value: unknown, configPath: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConfigLoadError(configPath, `必须是 ${minimum} 至 ${maximum} 的整数`);
  }
  return value;
}

function assertBattleRules(value: unknown, configPath: string): ChapterBattleRules | undefined {
  if (value === undefined) return undefined;
  if (!isLevelRecord(value)) throw new ConfigLoadError(configPath, '必须是 object');
  for (const key of Object.keys(value)) {
    if (!BATTLE_RULE_KEYS.has(key)) throw new ConfigLoadError(`${configPath}.${key}`, '不允许未知字段');
  }
  if ('activeLaneCount' in value) boundedInteger(value.activeLaneCount, `${configPath}.activeLaneCount`, 1, 2);
  if ('summonSlots' in value) boundedInteger(value.summonSlots, `${configPath}.summonSlots`, 0, 6);
  if ('openingSkillRestriction' in value && !OPENING_SKILL_RESTRICTIONS.includes(value.openingSkillRestriction as OpeningSkillRestriction)) {
    throw new ConfigLoadError(`${configPath}.openingSkillRestriction`, `必须是 ${OPENING_SKILL_RESTRICTIONS.join('、')} 之一`);
  }
  if ('enemyCardFilter' in value && !ENEMY_CARD_FILTERS.includes(value.enemyCardFilter as EnemyCardFilter)) {
    throw new ConfigLoadError(`${configPath}.enemyCardFilter`, `必须是 ${ENEMY_CARD_FILTERS.join('、')} 之一`);
  }
  if ('controlMode' in value && !BATTLE_CONTROL_MODES.includes(value.controlMode as BattleControlMode)) {
    throw new ConfigLoadError(`${configPath}.controlMode`, `必须是 ${BATTLE_CONTROL_MODES.join('、')} 之一`);
  }
  for (const key of ['mirror', 'fast', 'guard', 'intercept', 'temporaryAid']) {
    if (key in value && typeof value[key] !== 'boolean') throw new ConfigLoadError(`${configPath}.${key}`, '必须是 boolean');
  }
  return value as ChapterBattleRules;
}

function assertStringRegistry(value: unknown, configPath: string, pattern: RegExp): ReadonlySet<string> {
  if (!(value instanceof Set) || value.size === 0) throw new ConfigLoadError(configPath, '必须是非空 Set');
  for (const id of value) assertId(id, `${configPath}[${id}]`, pattern);
  return value;
}

function assertCardRegistry(value: unknown, configPath: string, pattern: RegExp): ReadonlyMap<string, ChapterLevelCardReference> {
  if (!(value instanceof Map) || value.size === 0) throw new ConfigLoadError(configPath, '必须是非空 Map');
  for (const [id, card] of value) {
    assertId(id, `${configPath}.${id}`, pattern);
    if (!isLevelRecord(card)) throw new ConfigLoadError(`${configPath}.${id}`, '必须是 object');
    if ('cardType' in card && card.cardType !== 'UNIT' && card.cardType !== 'SKILL') {
      throw new ConfigLoadError(`${configPath}.${id}.cardType`, '必须是 UNIT 或 SKILL');
    }
    if ('copyLimit' in card) positiveInteger(card.copyLimit, `${configPath}.${id}.copyLimit`);
  }
  return value;
}

function assertReferences(value: ChapterLevelReferences, configPath: string, pattern: RegExp): ChapterLevelReferences {
  if (!isLevelRecord(value)) throw new ConfigLoadError(configPath, '必须是 object');
  const expectedKeys = ['chapterLevelIds', 'targetIds', 'cards', 'unlockIds', 'chestIds', 'flagIds'];
  for (const key of Object.keys(value)) {
    if (!expectedKeys.includes(key)) throw new ConfigLoadError(`${configPath}.${key}`, '不允许未知字段');
  }
  assertStringRegistry(value.chapterLevelIds, `${configPath}.chapterLevelIds`, pattern);
  for (const id of value.chapterLevelIds) {
    if (!CHAPTER_LEVEL_ID.test(id)) throw new ConfigLoadError(`${configPath}.chapterLevelIds[${id}]`, '仅允许章节内 L01 至 L12');
  }
  assertStringRegistry(value.targetIds, `${configPath}.targetIds`, pattern);
  assertCardRegistry(value.cards, `${configPath}.cards`, pattern);
  assertStringRegistry(value.unlockIds, `${configPath}.unlockIds`, pattern);
  assertStringRegistry(value.chestIds, `${configPath}.chestIds`, pattern);
  assertStringRegistry(value.flagIds, `${configPath}.flagIds`, pattern);
  const rewardRegistries = [
    ['unlockIds', value.unlockIds],
    ['chestIds', value.chestIds],
    ['flagIds', value.flagIds],
  ] as const;
  for (let leftIndex = 0; leftIndex < rewardRegistries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < rewardRegistries.length; rightIndex += 1) {
      const [leftName, leftRegistry] = rewardRegistries[leftIndex];
      const [rightName, rightRegistry] = rewardRegistries[rightIndex];
      for (const id of leftRegistry) {
        if (rightRegistry.has(id)) {
          throw new ConfigLoadError(`${configPath}.${rightName}[${id}]`, `不得与 ${leftName} 重复注册: ${id}`);
        }
      }
    }
  }
  return value;
}

function normalizeArguments(
  referencesOrConfigPath: ChapterLevelReferences | string | undefined,
  configPathOrReferences: ChapterLevelReferences | string | undefined,
): { references?: ChapterLevelReferences; configPath: string } {
  if (typeof referencesOrConfigPath === 'string') {
    return {
      references: typeof configPathOrReferences === 'object' ? configPathOrReferences : undefined,
      configPath: referencesOrConfigPath,
    };
  }
  return {
    references: referencesOrConfigPath,
    configPath: typeof configPathOrReferences === 'string' ? configPathOrReferences : 'config/levels',
  };
}

export function assertChapterLevelContract(
  value: unknown,
  manifest: ConfigManifest,
  decks: unknown,
  referencesOrConfigPath?: ChapterLevelReferences | string,
  configPathOrReferences?: ChapterLevelReferences | string,
): asserts value is ChapterLevelContract {
  assertConfigManifest(manifest);
  const pattern = idPattern(manifest);
  const { references, configPath } = normalizeArguments(referencesOrConfigPath, configPathOrReferences);
  const registeredReferences = references ? assertReferences(references, `${configPath}.references`, pattern) : undefined;
  const validDeckIds = deckIds(decks);
  const forbiddenRewardIds = registeredReferences
    ? new Set([...validDeckIds, ...registeredReferences.targetIds, ...registeredReferences.cards.keys()])
    : undefined;
  if (!isLevelRecord(value)) throw new ConfigLoadError(configPath, '根值必须是 JSON object');
  const levelValues = levelRequired(value, 'chapterLevels', configPath);
  if (!Array.isArray(levelValues) || levelValues.length === 0) {
    throw new ConfigLoadError(`${configPath}.chapterLevels`, '必须是非空 array');
  }

  const ids = new Set<string>();
  levelValues.forEach((level, index) => {
    const levelPath = `${configPath}.chapterLevels[${index}]`;
    if (!isLevelRecord(level)) throw new ConfigLoadError(levelPath, '必须是 object');

    const id = assertChapterLevelId(levelRequired(level, 'id', levelPath), `${levelPath}.id`, pattern);
    if (ids.has(id)) throw new ConfigLoadError(`${levelPath}.id`, `重复 ID: ${id}`);
    ids.add(id);

    const prerequisite = levelRequired(level, 'prerequisiteLevelId', levelPath);
    if (prerequisite !== null) {
      const prerequisiteId = assertChapterLevelId(prerequisite, `${levelPath}.prerequisiteLevelId`, pattern);
      if (prerequisiteId === id) {
        throw new ConfigLoadError(`${levelPath}.prerequisiteLevelId`, '不得引用自身');
      }
      if (registeredReferences && !registeredReferences.chapterLevelIds.has(prerequisiteId)) {
        throw new ConfigLoadError(`${levelPath}.prerequisiteLevelId`, `缺失章节前置引用: ${prerequisiteId}`);
      }
    }

    const enemyDeckId = assertId(levelRequired(level, 'enemyDeckId', levelPath), `${levelPath}.enemyDeckId`, pattern);
    if (!validDeckIds.has(enemyDeckId)) {
      throw new ConfigLoadError(`${levelPath}.enemyDeckId`, `缺失敌方牌组引用: ${enemyDeckId}`);
    }

    const environmentElement = levelRequired(level, 'environmentElement', levelPath);
    if (typeof environmentElement !== 'string' || !ENVIRONMENT_ELEMENTS.includes(environmentElement as EnvironmentElement)) {
      throw new ConfigLoadError(`${levelPath}.environmentElement`, `必须是 ${ENVIRONMENT_ELEMENTS.join('、')} 之一`);
    }

    assertObjectives(levelRequired(level, 'objectives', levelPath), `${levelPath}.objectives`, pattern, registeredReferences?.targetIds);
    assertRewards(
      levelRequired(level, 'rewards', levelPath),
      `${levelPath}.rewards`,
      pattern,
      registeredReferences,
      forbiddenRewardIds,
    );
    assertFailureConditions(
      levelRequired(level, 'failureConditions', levelPath),
      `${levelPath}.failureConditions`,
      pattern,
      registeredReferences?.targetIds,
    );
    assertBattleRules(level.battleRules, `${levelPath}.battleRules`);
  });
}

export function isChapterLevelContract(
  value: unknown,
  manifest: ConfigManifest,
  decks: unknown,
  referencesOrConfigPath?: ChapterLevelReferences | string,
  configPathOrReferences?: ChapterLevelReferences | string,
): value is ChapterLevelContract {
  try {
    assertChapterLevelContract(value, manifest, decks, referencesOrConfigPath, configPathOrReferences);
    return true;
  } catch {
    return false;
  }
}
