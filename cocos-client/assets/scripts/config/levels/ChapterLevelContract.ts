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

const CHAPTER_LEVEL_ID = /^L(?:0[1-9]|1[0-2])$/;
const ENVIRONMENT_ELEMENTS: readonly EnvironmentElement[] = ['NONE', 'METAL', 'WOOD', 'WATER', 'FIRE', 'EARTH'];
const OBJECTIVE_TYPES: readonly LevelObjectiveType[] = ['DEFEAT_ENEMY_HERO', 'DESTROY_TARGET', 'PROTECT_TARGET', 'SURVIVE_ROUNDS'];
const REWARD_TYPES: readonly LevelRewardType[] = ['CARD', 'UNLOCK', 'CHEST', 'FLAG'];
const FAILURE_TYPES: readonly LevelFailureType[] = ['PLAYER_HERO_DEFEATED', 'ROUND_LIMIT_REACHED', 'TARGET_DESTROYED'];

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

function assertObjectives(value: unknown, configPath: string, pattern: RegExp): ChapterLevelObjective[] {
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
      assertTargetId(levelRequired(objective, 'targetId', itemPath), `${itemPath}.targetId`, pattern);
    }
    if (type === 'SURVIVE_ROUNDS') {
      positiveInteger(levelRequired(objective, 'rounds', itemPath), `${itemPath}.rounds`);
    }
    return objective as ChapterLevelObjective;
  });
}

function assertRewards(value: unknown, configPath: string, pattern: RegExp): ChapterLevelReward[] {
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
    assertId(levelRequired(reward, 'id', itemPath), `${itemPath}.id`, pattern);
    positiveInteger(levelRequired(reward, 'quantity', itemPath), `${itemPath}.quantity`);
    return reward as ChapterLevelReward;
  });
}

function assertFailureConditions(value: unknown, configPath: string, pattern: RegExp): ChapterLevelFailureCondition[] {
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
      assertTargetId(levelRequired(condition, 'targetId', itemPath), `${itemPath}.targetId`, pattern);
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

export function assertChapterLevelContract(
  value: unknown,
  manifest: ConfigManifest,
  decks: unknown,
  configPath = 'config/levels',
): asserts value is ChapterLevelContract {
  assertConfigManifest(manifest);
  const pattern = idPattern(manifest);
  const validDeckIds = deckIds(decks);
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
    }

    const enemyDeckId = assertId(levelRequired(level, 'enemyDeckId', levelPath), `${levelPath}.enemyDeckId`, pattern);
    if (!validDeckIds.has(enemyDeckId)) {
      throw new ConfigLoadError(`${levelPath}.enemyDeckId`, `缺失敌方牌组引用: ${enemyDeckId}`);
    }

    const environmentElement = levelRequired(level, 'environmentElement', levelPath);
    if (typeof environmentElement !== 'string' || !ENVIRONMENT_ELEMENTS.includes(environmentElement as EnvironmentElement)) {
      throw new ConfigLoadError(`${levelPath}.environmentElement`, `必须是 ${ENVIRONMENT_ELEMENTS.join('、')} 之一`);
    }

    assertObjectives(levelRequired(level, 'objectives', levelPath), `${levelPath}.objectives`, pattern);
    assertRewards(levelRequired(level, 'rewards', levelPath), `${levelPath}.rewards`, pattern);
    assertFailureConditions(levelRequired(level, 'failureConditions', levelPath), `${levelPath}.failureConditions`, pattern);
  });
}

export function isChapterLevelContract(value: unknown, manifest: ConfigManifest, decks: unknown): value is ChapterLevelContract {
  try {
    assertChapterLevelContract(value, manifest, decks);
    return true;
  } catch {
    return false;
  }
}
