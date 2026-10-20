import { assertConfigManifest, ConfigLoadError, type ConfigManifest } from '../ConfigLoader';

export type EnvironmentElement = 'NONE' | 'METAL' | 'WOOD' | 'WATER' | 'FIRE' | 'EARTH';
export type LevelObjectiveType = 'DEFEAT_ENEMY_HERO' | 'DESTROY_TARGET' | 'PROTECT_TARGET' | 'SURVIVE_ROUNDS';
export type LevelRewardType = 'CARD' | 'UNLOCK' | 'CHEST' | 'FLAG';
export type LevelFailureType = 'PLAYER_HERO_DEFEATED' | 'ROUND_LIMIT_REACHED' | 'TARGET_DESTROYED';
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
}

export interface ChapterLevelContract {
  chapterLevels: ChapterLevelConfig[];
}

interface DeckTable {
  decks: Array<{ id: string }>;
}

export interface ChapterLevelCardReference {
  cardType: 'UNIT' | 'SKILL';
  copyLimit: number;
  unitId?: string;
  skillId?: string;
}

export interface ChapterLevelReferences {
  chapterLevelIds: ReadonlySet<string>;
  targetIds: ReadonlySet<string>;
  unitIds: ReadonlySet<string>;
  skillIds: ReadonlySet<string>;
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
const MAX_REGISTRY_ITERATOR_STEPS = 1024;
const iteratorSnapshotCache = new WeakMap<object, readonly unknown[]>();
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
    return { ...objective, type: type as LevelObjectiveType };
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
        if ('cardType' in reward && reward.cardType !== card.cardType) {
          throw new ConfigLoadError(`${itemPath}.cardType`, `与卡牌注册表不匹配: ${id}`);
        }
        if (quantity > card.copyLimit) {
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
    return { ...reward, type: type as LevelRewardType, id, quantity };
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
    return { ...condition, type: type as LevelFailureType };
  });
}

function deckIds(value: unknown): Set<string> {
  if (!isLevelRecord(value) || !Array.isArray(value.decks) || value.decks.some((deck) => !isLevelRecord(deck) || typeof deck.id !== 'string')) {
    throw new ConfigLoadError('config/decks.decks', '必须是包含 ID 的 array');
  }
  return new Set(value.decks.map((deck: unknown) => {
    if (!isLevelRecord(deck) || typeof deck.id !== 'string') throw new ConfigLoadError('config/decks.decks', '卡组 ID 无效');
    return deck.id;
  }));
}

function isIterator(value: unknown): value is Iterator<unknown> {
  return isLevelRecord(value) && typeof value.next === 'function';
}

function normalizeStringRegistry(value: unknown, configPath: string, pattern: RegExp): ReadonlySet<string> {
  if (!(value instanceof Set) || value.size === 0) throw new ConfigLoadError(configPath, '必须是非空 Set');
  const normalized = new Set<string>();
  const activeCollections = new Set<object>();
  let iteratorSteps = 0;

  const visitCollection = (collection: Set<unknown> | unknown[] | Iterator<unknown>, collectionPath: string): void => {
    if (activeCollections.has(collection)) throw new ConfigLoadError(collectionPath, '注册表集合不得循环引用');
    activeCollections.add(collection);
    let count = 0;
    const visit = (candidate: unknown, candidatePath: string): void => {
      if (candidate instanceof Set || Array.isArray(candidate) || isIterator(candidate)) {
        visitCollection(candidate, candidatePath);
        return;
      }
      normalized.add(assertId(candidate, candidatePath, pattern));
    };
    try {
      if (collection instanceof Set || Array.isArray(collection)) {
        collection.forEach((candidate) => {
          visit(candidate, `${collectionPath}[${count}]`);
          count += 1;
        });
      } else {
        let snapshot = iteratorSnapshotCache.get(collection);
        if (!snapshot) {
          const values: unknown[] = [];
          while (true) {
            iteratorSteps += 1;
            if (iteratorSteps > MAX_REGISTRY_ITERATOR_STEPS) {
              throw new ConfigLoadError(collectionPath, 'Iterator 遍历超过安全上限');
            }
            let step: IteratorResult<unknown>;
            try {
              step = collection.next();
            } catch (error) {
              if (error instanceof ConfigLoadError) throw error;
              const reason = error instanceof Error ? error.message : String(error);
              throw new ConfigLoadError(collectionPath, `Iterator.next() 失败: ${reason}`, { cause: error });
            }
            if (!isLevelRecord(step) || typeof step.done !== 'boolean') {
              throw new ConfigLoadError(collectionPath, '必须是有效 Iterator');
            }
            if (step.done) break;
            values.push(step.value);
          }
          snapshot = Object.freeze(values);
          iteratorSnapshotCache.set(collection, snapshot);
        }
        snapshot.forEach((candidate) => {
          visit(candidate, `${collectionPath}[${count}]`);
          count += 1;
        });
      }
      if (count === 0) throw new ConfigLoadError(collectionPath, '必须是非空注册表集合');
    } finally {
      activeCollections.delete(collection);
    }
  };

  visitCollection(value, configPath);
  if (normalized.size === 0) throw new ConfigLoadError(configPath, '必须是非空 Set');
  return normalized;
}

function addRegistry(target: Set<string>, registry: ReadonlySet<string>): void {
  registry.forEach((id) => target.add(id));
}

function assertCardRegistry(
  value: unknown,
  configPath: string,
  pattern: RegExp,
  unitIds: ReadonlySet<string>,
  skillIds: ReadonlySet<string>,
): ReadonlyMap<string, ChapterLevelCardReference> {
  if (!(value instanceof Map) || value.size === 0) throw new ConfigLoadError(configPath, '必须是非空 Map');
  for (const [id, card] of value) {
    assertId(id, `${configPath}.${id}`, pattern);
    if (!isLevelRecord(card)) throw new ConfigLoadError(`${configPath}.${id}`, '必须是 object');
    if (card.cardType !== 'UNIT' && card.cardType !== 'SKILL') {
      throw new ConfigLoadError(`${configPath}.${id}.cardType`, '必须是 UNIT 或 SKILL');
    }
    positiveInteger(card.copyLimit, `${configPath}.${id}.copyLimit`);
    const referencedId = card.cardType === 'UNIT' ? card.unitId : card.skillId;
    const registry = card.cardType === 'UNIT' ? unitIds : skillIds;
    const referencePath = `${configPath}.${id}.${card.cardType === 'UNIT' ? 'unitId' : 'skillId'}`;
    if (typeof referencedId !== 'string' || !registry.has(referencedId)) {
      throw new ConfigLoadError(referencePath, `缺失${card.cardType === 'UNIT' ? '单位' : '技能'}注册引用`);
    }
  }
  return value;
}

function assertReferences(value: ChapterLevelReferences, configPath: string, pattern: RegExp): ChapterLevelReferences {
  if (!isLevelRecord(value)) throw new ConfigLoadError(configPath, '必须是 object');
  const expectedKeys = ['chapterLevelIds', 'targetIds', 'unitIds', 'skillIds', 'cards', 'unlockIds', 'chestIds', 'flagIds'];
  for (const key of Object.keys(value)) {
    if (!expectedKeys.includes(key)) throw new ConfigLoadError(`${configPath}.${key}`, '不允许未知字段');
  }
  const chapterLevelIds = normalizeStringRegistry(value.chapterLevelIds, `${configPath}.chapterLevelIds`, pattern);
  for (const id of chapterLevelIds) {
    if (!CHAPTER_LEVEL_ID.test(id)) throw new ConfigLoadError(`${configPath}.chapterLevelIds[${id}]`, '仅允许章节内 L01 至 L12');
  }
  const targetIds = normalizeStringRegistry(value.targetIds, `${configPath}.targetIds`, pattern);
  const unitIds = normalizeStringRegistry(value.unitIds, `${configPath}.unitIds`, pattern);
  const skillIds = normalizeStringRegistry(value.skillIds, `${configPath}.skillIds`, pattern);
  const cards = assertCardRegistry(value.cards, `${configPath}.cards`, pattern, unitIds, skillIds);
  const unlockIds = normalizeStringRegistry(value.unlockIds, `${configPath}.unlockIds`, pattern);
  const chestIds = normalizeStringRegistry(value.chestIds, `${configPath}.chestIds`, pattern);
  const flagIds = normalizeStringRegistry(value.flagIds, `${configPath}.flagIds`, pattern);
  const rewardRegistries = [
    ['unlockIds', unlockIds],
    ['chestIds', chestIds],
    ['flagIds', flagIds],
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
  const cardIds = new Set<string>();
  cards.forEach((_card, id) => cardIds.add(id));
  const protectedRegistries = [
    ['chapterLevelIds', chapterLevelIds],
    ['targetIds', targetIds],
    ['cards', cardIds],
  ] as const;
  for (const [rewardName, rewardRegistry] of rewardRegistries) {
    for (const [protectedName, protectedRegistry] of protectedRegistries) {
      for (const id of rewardRegistry) {
        if (protectedRegistry.has(id)) {
          throw new ConfigLoadError(`${configPath}.${rewardName}[${id}]`, `不得与 ${protectedName} 重复注册: ${id}`);
        }
      }
    }
  }
  return {
    ...value,
    chapterLevelIds,
    targetIds,
    unitIds,
    skillIds,
    cards,
    unlockIds,
    chestIds,
    flagIds,
  };
}

export function assertChapterLevelContract(
  value: unknown,
  manifest: ConfigManifest,
  decks: unknown,
  references: ChapterLevelReferences,
  configPath = 'config/levels',
): asserts value is ChapterLevelContract {
  assertConfigManifest(manifest);
  const pattern = idPattern(manifest);
  const registeredReferences = assertReferences(references, `${configPath}.references`, pattern);
  const validDeckIds = deckIds(decks);
  const forbiddenRewardIds = new Set<string>();
  addRegistry(forbiddenRewardIds, validDeckIds);
  addRegistry(forbiddenRewardIds, registeredReferences.targetIds);
  registeredReferences.cards.forEach((_card, id) => forbiddenRewardIds.add(id));
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
    if (!registeredReferences.chapterLevelIds.has(id)) {
      throw new ConfigLoadError(`${levelPath}.id`, `缺失章节关卡引用: ${id}`);
    }
    ids.add(id);

    const prerequisite = levelRequired(level, 'prerequisiteLevelId', levelPath);
    if (prerequisite !== null) {
      const prerequisiteId = assertChapterLevelId(prerequisite, `${levelPath}.prerequisiteLevelId`, pattern);
      if (prerequisiteId === id) {
        throw new ConfigLoadError(`${levelPath}.prerequisiteLevelId`, '不得引用自身');
      }
      if (!registeredReferences.chapterLevelIds.has(prerequisiteId)) {
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

    assertObjectives(levelRequired(level, 'objectives', levelPath), `${levelPath}.objectives`, pattern, registeredReferences.targetIds);
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
      registeredReferences.targetIds,
    );
  });
}

export function isChapterLevelContract(
  value: unknown,
  manifest: ConfigManifest,
  decks: unknown,
  references: ChapterLevelReferences,
  configPath = 'config/levels',
): value is ChapterLevelContract {
  try {
    assertChapterLevelContract(value, manifest, decks, references, configPath);
    return true;
  } catch {
    return false;
  }
}
