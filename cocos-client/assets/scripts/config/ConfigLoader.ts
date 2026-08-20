import { JsonAsset, resources } from 'cc';
import type { ChapterLevelConfig, ChapterLevelReferences } from './levels/ChapterLevelContract';

export type EvidenceLevel = 'A' | 'B' | 'C';

export interface ConfigManifest {
  schemaVersion: 1;
  id: string;
  evidenceLevel: EvidenceLevel;
  version: number;
  enabled: boolean;
  tables: {
    units: string;
    cards: string;
    skills: string;
    effects: string;
    statuses: string;
    professions: string;
    decks: string;
    strategies: string;
  };
  chapters: {
    chapter01: string;
  };
  idPolicy: {
    scope: string;
    format: string;
    stable: boolean;
    unique: boolean;
  };
  evidenceLevels: EvidenceLevel[];
}

export interface ChapterLevelIndexEntry {
  readonly id: string;
  readonly resource: string;
  readonly prerequisiteLevelId: string | null;
  readonly enemyStrategyId: string;
}

export interface ChapterLevelIndex {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly chapterId: string;
  readonly levels: readonly ChapterLevelIndexEntry[];
  readonly targetIds: readonly string[];
  readonly rewardRegistries: {
    readonly unlockIds: readonly string[];
    readonly chestIds: readonly string[];
    readonly flagIds: readonly string[];
  };
}

export interface EnemyStrategySkillRule {
  readonly skillId: string;
  readonly targetPolicy: string;
  readonly reserveIfNoLegalTarget: boolean;
}

export interface EnemyStrategyTargetSelection {
  readonly enemyUnitOrder: readonly string[];
  readonly enemyLaneOrder: readonly string[];
  readonly allyUnitOrder: readonly string[];
  readonly allyLaneOrder: readonly string[];
  readonly priorityTargetUnitIds: readonly string[];
  readonly noLegalTarget: string;
  readonly tieBreak: string;
}

export interface EnemyStrategyDifficulty {
  readonly tier: string;
  readonly threatMultiplierPercent: number;
  readonly skillReserveTurns: number;
}

export interface EnemyStrategyRuleBoundary {
  readonly maxConsecutiveSameLane: number;
  readonly sameLaneFallback: string;
  readonly reserveSkillWhenNoLegalTarget: boolean;
  readonly openingCardPolicy: string;
  readonly enemyActionInterval: number | null;
  readonly phasePolicy: string;
  readonly specialRule: string;
  readonly maxRounds: number;
}

export interface EnemyStrategy {
  readonly id: string;
  readonly levelId: string;
  readonly deckId: string;
  readonly unitIds: readonly string[];
  readonly skillRules: readonly EnemyStrategySkillRule[];
  readonly environmentElement: string;
  readonly maxCardsPerAction: number;
  readonly lethalWeight: number;
  readonly defendWeight: number;
  readonly emptyLaneWeight: number;
  readonly rangedSupportWeight: number;
  readonly randomness: number;
  readonly actionPriority: readonly string[];
  readonly targetSelection: EnemyStrategyTargetSelection;
  readonly difficulty: EnemyStrategyDifficulty;
  readonly ruleBoundary: EnemyStrategyRuleBoundary;
}

export interface Chapter01Runtime {
  index: ChapterLevelIndex;
  levels: ChapterLevelConfig[];
  strategyByLevelId: ReadonlyMap<string, EnemyStrategy>;
  strategyById: ReadonlyMap<string, EnemyStrategy>;
}

export interface ConfigRuntime {
  manifest: ConfigManifest;
  chapter01: Chapter01Runtime;
}

const CHAPTER01_INDEX_PATH = 'config/levels/chapter01/index';
const CHAPTER_INDEX_LEVEL_ID = /^L(?:0[1-9]|1[0-2])$/;
const STRATEGY_CONFIG_PATH = 'config/enemy/strategies';
const STRATEGY_LEVEL_ID = /^L(?:0[1-9]|1[0-2])$/;
const STRATEGY_ID = /^ES_L(?:0[1-9]|1[0-2])$/;
const STRATEGY_ENVIRONMENTS = new Set(['NONE', 'METAL', 'WOOD', 'WATER', 'FIRE', 'EARTH']);
const STRATEGY_ACTIONS = new Set([
  'DEPLOY_FRONTLINE', 'PRESS_HIGH_THREAT', 'FILL_EMPTY_LANE', 'HOLD_NO_LEGAL_ACTION',
  'SUPPORT_RANGED', 'DEPLOY_FAST_UNIT', 'DEFEND_THREATENED_LANE', 'USE_LETHAL_SKILL',
  'SAVE_CRITICAL_ALLY', 'USE_CONTROL_SKILL', 'PROTECT_OBJECTIVE', 'DEPLOY_ANCHOR',
  'HANDLE_REVIVE', 'APPLY_PREPARE_PRESSURE', 'COUNTER_PLAYER_ROLE', 'HANDLE_PHASE_RULE',
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
const STRATEGY_ROOT_KEYS = ['schemaVersion', 'table', 'evidenceLevel', 'version', 'enabled', 'strategies'] as const;
const STRATEGY_KEYS = [
  'id', 'levelId', 'deckId', 'unitIds', 'skillRules', 'environmentElement', 'maxCardsPerAction',
  'lethalWeight', 'defendWeight', 'emptyLaneWeight', 'rangedSupportWeight', 'randomness',
  'actionPriority', 'targetSelection', 'difficulty', 'ruleBoundary',
] as const;
const SKILL_RULE_KEYS = ['skillId', 'targetPolicy', 'reserveIfNoLegalTarget'] as const;
const TARGET_SELECTION_KEYS = [
  'enemyUnitOrder', 'enemyLaneOrder', 'allyUnitOrder', 'allyLaneOrder',
  'priorityTargetUnitIds', 'noLegalTarget', 'tieBreak',
] as const;
const DIFFICULTY_KEYS = ['tier', 'threatMultiplierPercent', 'skillReserveTurns'] as const;
const RULE_BOUNDARY_KEYS = [
  'maxConsecutiveSameLane', 'sameLaneFallback', 'reserveSkillWhenNoLegalTarget', 'openingCardPolicy',
  'enemyActionInterval', 'phasePolicy', 'specialRule', 'maxRounds',
] as const;

export class ConfigLoadError extends Error {
  constructor(public readonly configPath: string, message: string, options?: { cause?: unknown }) {
    super(`配置加载失败 [${configPath}]: ${message}`);
    this.name = 'ConfigLoadError';
    if (options?.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function required(record: Record<string, unknown>, key: string, configPath: string): unknown {
  if (!(key in record)) throw new ConfigLoadError(`${configPath}.${key}`, '缺少必需字段');
  return record[key];
}

function booleanField(record: Record<string, unknown>, key: string, configPath: string): boolean {
  const value = required(record, key, configPath);
  if (typeof value !== 'boolean') throw new ConfigLoadError(`${configPath}.${key}`, '必须是 boolean');
  return value;
}

function stringField(record: Record<string, unknown>, key: string, configPath: string): string {
  const value = required(record, key, configPath);
  if (typeof value !== 'string' || value.length === 0) {
    throw new ConfigLoadError(`${configPath}.${key}`, '必须是非空 string');
  }
  return value;
}

function exactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  configPath: string,
): void {
  const allowed = new Set(keys);
  keys.forEach((key) => required(record, key, configPath));
  Object.keys(record).forEach((key) => {
    if (!allowed.has(key)) throw new ConfigLoadError(`${configPath}.${key}`, '不允许未知字段');
  });
}

function strategyRecord(value: unknown, configPath: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ConfigLoadError(configPath, '必须是 object');
  return value;
}

function strategyInteger(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  configPath: string,
): number {
  const value = required(record, key, configPath);
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ConfigLoadError(`${configPath}.${key}`, `必须是 ${min} 到 ${max} 的整数`);
  }
  return value;
}

function strategyEnum(
  record: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>,
  configPath: string,
): string {
  const value = stringField(record, key, configPath);
  if (!allowed.has(value)) throw new ConfigLoadError(`${configPath}.${key}`, '包含非法枚举值');
  return value;
}

function strategyStringArray(
  record: Record<string, unknown>,
  key: string,
  configPath: string,
  minLength = 1,
): string[] {
  const value = required(record, key, configPath);
  if (!Array.isArray(value) || value.length < minLength || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new ConfigLoadError(`${configPath}.${key}`, '必须是非空 string 数组');
  }
  const items = value as string[];
  if (new Set(items).size !== items.length) {
    throw new ConfigLoadError(`${configPath}.${key}`, '不得包含重复 ID 或枚举');
  }
  return items.slice();
}

function strategyNullableInteger(
  record: Record<string, unknown>,
  key: string,
  min: number,
  max: number,
  configPath: string,
): number | null {
  const value = required(record, key, configPath);
  if (value === null) return null;
  return strategyInteger(record, key, min, max, configPath);
}

function assertKnownStrategyIds(
  ids: readonly string[],
  knownIds: ReadonlySet<string>,
  configPath: string,
): void {
  ids.forEach((id, index) => {
    if (!knownIds.has(id)) throw new ConfigLoadError(`${configPath}[${index}]`, `未知引用: ${id}`);
  });
}

function evidenceLevel(value: unknown, configPath: string): EvidenceLevel {
  if (value !== 'A' && value !== 'B' && value !== 'C') {
    throw new ConfigLoadError(configPath, '必须是 A、B 或 C');
  }
  return value;
}

function loadJsonAsset(configPath: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    resources.load(configPath, JsonAsset, (error, asset) => {
      if (error) {
        reject(new ConfigLoadError(configPath, error.message || '资源读取失败', { cause: error }));
        return;
      }
      resolve(asset?.json);
    });
  });
}

function assertTable(value: unknown, tableName: string, configPath: string): Record<string, unknown> {
  if (!isRecord(value)) throw new ConfigLoadError(configPath, '根值必须是 JSON object');
  if (value.table !== tableName) throw new ConfigLoadError(`${configPath}.table`, `必须是 ${tableName}`);
  const rows = value[tableName];
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ConfigLoadError(`${configPath}.${tableName}`, '必须是非空 array');
  }
  const ids = new Set<string>();
  rows.forEach((row, index) => {
    if (!isRecord(row) || typeof row.id !== 'string' || row.id.length === 0) {
      throw new ConfigLoadError(`${configPath}.${tableName}[${index}].id`, '必须是非空 string');
    }
    if (ids.has(row.id)) {
      throw new ConfigLoadError(`${configPath}.${tableName}[${index}].id`, `重复 ID: ${row.id}`);
    }
    ids.add(row.id);
  });
  return value;
}

export function isConfigManifest(value: unknown): value is ConfigManifest {
  try {
    assertConfigManifest(value);
    return true;
  } catch {
    return false;
  }
}

export function assertConfigManifest(value: unknown, configPath = 'config/manifest'): asserts value is ConfigManifest {
  if (!isRecord(value)) throw new ConfigLoadError(configPath, '根值必须是 JSON object');
  exactKeys(
    value,
    ['schemaVersion', 'id', 'evidenceLevel', 'version', 'enabled', 'tables', 'chapters', 'idPolicy', 'evidenceLevels'],
    configPath,
  );

  const schemaVersion = required(value, 'schemaVersion', configPath);
  if (schemaVersion !== 1) throw new ConfigLoadError(`${configPath}.schemaVersion`, '必须是数字 1');
  stringField(value, 'id', configPath);
  evidenceLevel(required(value, 'evidenceLevel', configPath), `${configPath}.evidenceLevel`);
  const version = required(value, 'version', configPath);
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new ConfigLoadError(`${configPath}.version`, '必须是正整数');
  }
  booleanField(value, 'enabled', configPath);

  const tablesPath = `${configPath}.tables`;
  const tables = required(value, 'tables', configPath);
  if (!isRecord(tables)) throw new ConfigLoadError(tablesPath, '必须是 object');
  const expectedTables = ['units', 'cards', 'skills', 'effects', 'statuses', 'professions', 'decks', 'strategies'] as const;
  exactKeys(tables, expectedTables, tablesPath);
  const expectedTablePaths: Record<(typeof expectedTables)[number], string> = {
    units: 'config/units',
    cards: 'config/cards',
    skills: 'config/skills',
    effects: 'config/effects',
    statuses: 'config/statuses',
    professions: 'config/professions',
    decks: 'config/decks',
    strategies: STRATEGY_CONFIG_PATH,
  };
  for (const tableName of expectedTables) {
    const tablePath = stringField(tables, tableName, tablesPath);
    if (tablePath !== expectedTablePaths[tableName]) {
      throw new ConfigLoadError(`${tablesPath}.${tableName}`, `只允许加载 ${expectedTablePaths[tableName]}`);
    }
  }

  const chaptersPath = `${configPath}.chapters`;
  const chapters = required(value, 'chapters', configPath);
  if (!isRecord(chapters)) throw new ConfigLoadError(chaptersPath, '必须是 object');
  exactKeys(chapters, ['chapter01'], chaptersPath);
  const chapter01Path = stringField(chapters, 'chapter01', chaptersPath);
  if (chapter01Path !== CHAPTER01_INDEX_PATH) {
    throw new ConfigLoadError(`${chaptersPath}.chapter01`, `只允许加载 ${CHAPTER01_INDEX_PATH}`);
  }

  const policyPath = `${configPath}.idPolicy`;
  const policy = required(value, 'idPolicy', configPath);
  if (!isRecord(policy)) throw new ConfigLoadError(policyPath, '必须是 object');
  exactKeys(policy, ['scope', 'format', 'stable', 'unique'], policyPath);
  stringField(policy, 'scope', policyPath);
  stringField(policy, 'format', policyPath);
  booleanField(policy, 'stable', policyPath);
  booleanField(policy, 'unique', policyPath);

  const levelsPath = `${configPath}.evidenceLevels`;
  const levels = required(value, 'evidenceLevels', configPath);
  if (!Array.isArray(levels) || levels.length === 0) {
    throw new ConfigLoadError(levelsPath, '必须是非空 array');
  }
  levels.forEach((level, index) => evidenceLevel(level, `${levelsPath}[${index}]`));
}

function assertIndexStringArray(value: unknown, configPath: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new ConfigLoadError(configPath, '必须是非空 string 数组');
  }
  const ids = new Set<string>();
  value.forEach((item, index) => {
    if (ids.has(item)) throw new ConfigLoadError(`${configPath}[${index}]`, `重复 ID: ${item}`);
    ids.add(item);
  });
  return value as string[];
}

function exactKeysWithOptional(
  record: Record<string, unknown>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  configPath: string,
): void {
  requiredKeys.forEach((key) => required(record, key, configPath));
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  Object.keys(record).forEach((key) => {
    if (!allowed.has(key)) throw new ConfigLoadError(`${configPath}.${key}`, '不允许未知字段');
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || Object.isFrozen(value)) return value;
  Object.getOwnPropertyNames(value).forEach((key) => {
    deepFreeze((value as Record<string, unknown>)[key]);
  });
  Object.getOwnPropertySymbols(value).forEach((symbol) => {
    deepFreeze((value as Record<symbol, unknown>)[symbol]);
  });
  return Object.freeze(value);
}

function createReadonlyMap<K, V>(entries: readonly (readonly [K, V])[]): ReadonlyMap<K, V> {
  const map = new Map(entries);
  const view: ReadonlyMap<K, V> = {
    get size(): number { return map.size; },
    get: (key) => map.get(key),
    has: (key) => map.has(key),
    entries: () => map.entries(),
    keys: () => map.keys(),
    values: () => map.values(),
    forEach: (callback, thisArg) => map.forEach((value, key) => callback.call(thisArg, value, key, view)),
    [Symbol.iterator]: () => map[Symbol.iterator](),
  };
  return Object.freeze(view);
}

function assertChapterLevelIndex(value: unknown, configPath = CHAPTER01_INDEX_PATH): ChapterLevelIndex {
  if (!isRecord(value)) throw new ConfigLoadError(configPath, '根值必须是 JSON object');
  exactKeys(value, ['schemaVersion', 'id', 'chapterId', 'levels', 'targetIds', 'rewardRegistries'], configPath);
  if (required(value, 'schemaVersion', configPath) !== 1) {
    throw new ConfigLoadError(`${configPath}.schemaVersion`, '必须是数字 1');
  }
  if (stringField(value, 'id', configPath) !== 'CHAPTER01-LEVEL-INDEX') {
    throw new ConfigLoadError(`${configPath}.id`, '必须是 CHAPTER01-LEVEL-INDEX');
  }
  if (stringField(value, 'chapterId', configPath) !== 'CHAPTER01') {
    throw new ConfigLoadError(`${configPath}.chapterId`, '必须是 CHAPTER01');
  }

  const levelsPath = `${configPath}.levels`;
  const levels = required(value, 'levels', configPath);
  if (!Array.isArray(levels) || levels.length !== 12) {
    throw new ConfigLoadError(levelsPath, '必须按 L01 至 L12 提供 12 个关卡');
  }
  const ids = new Set<string>();
  levels.forEach((entry, index) => {
    const entryPath = `${levelsPath}[${index}]`;
    if (!isRecord(entry)) throw new ConfigLoadError(entryPath, '必须是 object');
    exactKeys(entry, ['id', 'resource', 'prerequisiteLevelId', 'enemyStrategyId'], entryPath);
    const expectedId = `L${String(index + 1).padStart(2, '0')}`;
    const id = stringField(entry, 'id', entryPath);
    if (id !== expectedId || !CHAPTER_INDEX_LEVEL_ID.test(id)) {
      throw new ConfigLoadError(`${entryPath}.id`, `必须按顺序为 ${expectedId}`);
    }
    if (ids.has(id)) throw new ConfigLoadError(`${entryPath}.id`, `重复 ID: ${id}`);
    ids.add(id);
    const resource = stringField(entry, 'resource', entryPath);
    const expectedResource = `config/levels/chapter01/${id}`;
    if (resource !== expectedResource) {
      throw new ConfigLoadError(`${entryPath}.resource`, `必须是 ${expectedResource}`);
    }
    const prerequisite = required(entry, 'prerequisiteLevelId', entryPath);
    const expectedPrerequisite = index === 0 ? null : `L${String(index).padStart(2, '0')}`;
    if (prerequisite !== expectedPrerequisite) {
      throw new ConfigLoadError(`${entryPath}.prerequisiteLevelId`, `必须是 ${expectedPrerequisite ?? 'null'}`);
    }
    const enemyStrategyId = stringField(entry, 'enemyStrategyId', entryPath);
    if (enemyStrategyId !== `ES_${id}`) {
      throw new ConfigLoadError(`${entryPath}.enemyStrategyId`, `必须是 ES_${id}`);
    }
  });

  const targetIds = assertIndexStringArray(required(value, 'targetIds', configPath), `${configPath}.targetIds`);
  const rewardPath = `${configPath}.rewardRegistries`;
  const rewardRegistries = required(value, 'rewardRegistries', configPath);
  if (!isRecord(rewardRegistries)) throw new ConfigLoadError(rewardPath, '必须是 object');
  exactKeys(rewardRegistries, ['unlockIds', 'chestIds', 'flagIds'], rewardPath);
  const unlockIds = assertIndexStringArray(required(rewardRegistries, 'unlockIds', rewardPath), `${rewardPath}.unlockIds`);
  const chestIds = assertIndexStringArray(required(rewardRegistries, 'chestIds', rewardPath), `${rewardPath}.chestIds`);
  const flagIds = assertIndexStringArray(required(rewardRegistries, 'flagIds', rewardPath), `${rewardPath}.flagIds`);
  return {
    schemaVersion: 1,
    id: 'CHAPTER01-LEVEL-INDEX',
    chapterId: 'CHAPTER01',
    levels: levels as ChapterLevelIndexEntry[],
    targetIds,
    rewardRegistries: { unlockIds, chestIds, flagIds },
  };
}

function tableRows(value: Record<string, unknown>, tableName: string, configPath: string): Record<string, unknown>[] {
  const rows = value[tableName];
  if (!Array.isArray(rows)) throw new ConfigLoadError(`${configPath}.${tableName}`, '必须是 array');
  return rows.filter((row): row is Record<string, unknown> => isRecord(row) && row.enabled !== false);
}

function buildChapterLevelReferences(
  index: ChapterLevelIndex,
  tables: ReadonlyMap<string, Record<string, unknown>>,
): ChapterLevelReferences {
  const units = tableRows(tables.get('units')!, 'units', 'config/units');
  const skills = tableRows(tables.get('skills')!, 'skills', 'config/skills');
  const cards = tableRows(tables.get('cards')!, 'cards', 'config/cards');
  const unitIds = new Set(units.map((row) => row.id as string));
  const skillIds = new Set(skills.map((row) => row.id as string));
  const cardReferences = new Map<string, {
    cardType: 'UNIT' | 'SKILL';
    copyLimit: number;
    unitId?: string;
    skillId?: string;
  }>();
  cards.forEach((card) => {
    cardReferences.set(card.id as string, {
      cardType: card.cardType as 'UNIT' | 'SKILL',
      copyLimit: card.copyLimit as number,
      ...(typeof card.unitId === 'string' ? { unitId: card.unitId } : {}),
      ...(typeof card.skillId === 'string' ? { skillId: card.skillId } : {}),
    });
  });
  return {
    chapterLevelIds: new Set(index.levels.map((entry) => entry.id)),
    targetIds: new Set([...unitIds, ...index.targetIds]),
    unitIds,
    skillIds,
    cards: cardReferences,
    unlockIds: new Set(index.rewardRegistries.unlockIds),
    chestIds: new Set(index.rewardRegistries.chestIds),
    flagIds: new Set(index.rewardRegistries.flagIds),
  };
}

interface EnemyStrategyValidationTables {
  units: ReadonlyMap<string, Record<string, unknown>>;
  cards: ReadonlyMap<string, Record<string, unknown>>;
  skills: ReadonlyMap<string, Record<string, unknown>>;
  decks: ReadonlyMap<string, Record<string, unknown>>;
}

function enabledRowsById(
  value: Record<string, unknown>,
  tableName: string,
  configPath: string,
): ReadonlyMap<string, Record<string, unknown>> {
  return new Map(tableRows(value, tableName, configPath).map((row) => [row.id as string, row]));
}

function deckCardIds(
  deck: Record<string, unknown>,
  cardById: ReadonlyMap<string, Record<string, unknown>>,
  cardType: 'UNIT' | 'SKILL',
  configPath: string,
): ReadonlySet<string> {
  const entries = required(deck, 'cardEntries', configPath);
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new ConfigLoadError(`${configPath}.cardEntries`, '必须是非空 array');
  }
  const ids = new Set<string>();
  entries.forEach((entry, index) => {
    const entryPath = `${configPath}.cardEntries[${index}]`;
    const record = strategyRecord(entry, entryPath);
    exactKeys(record, ['cardId', 'count'], entryPath);
    const cardId = stringField(record, 'cardId', entryPath);
    strategyInteger(record, 'count', 1, 9999, entryPath);
    const card = cardById.get(cardId);
    if (!card) throw new ConfigLoadError(`${entryPath}.cardId`, `未知卡牌引用: ${cardId}`);
    if (card.cardType === cardType) ids.add(cardId);
  });
  return ids;
}

function assertStrategyLevelBoundaries(
  level: Record<string, unknown>,
  levelId: string,
  boundary: Record<string, unknown>,
  boundaryPath: string,
): void {
  const levelPath = `config/levels/chapter01/${levelId}`;
  const scenarioRules = level.scenarioRules === undefined
    ? {}
    : strategyRecord(level.scenarioRules, `${levelPath}.scenarioRules`);
  const battleRules = level.battleRules === undefined
    ? {}
    : strategyRecord(level.battleRules, `${levelPath}.battleRules`);
  const roundLimits = [scenarioRules.roundLimit, battleRules.roundLimit].filter((value) => value !== undefined);
  roundLimits.forEach((value) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 80) {
      throw new ConfigLoadError(levelPath, 'roundLimit 必须是 1 到 80 的整数');
    }
  });
  if (new Set(roundLimits).size > 1) {
    throw new ConfigLoadError(levelPath, 'scenarioRules/battleRules.roundLimit 不一致');
  }
  const expectedRoundLimit = (roundLimits[0] as number | undefined) ?? 80;
  if (boundary.maxRounds !== expectedRoundLimit) {
    throw new ConfigLoadError(`${boundaryPath}.maxRounds`, `必须遵循真实关卡回合边界 ${expectedRoundLimit}`);
  }

  if (levelId === 'L01') {
    if (typeof scenarioRules.enemyOpeningCardFilter !== 'string') {
      throw new ConfigLoadError(`${levelPath}.scenarioRules.enemyOpeningCardFilter`, '缺少真实关卡开局规则');
    }
    if (boundary.openingCardPolicy !== scenarioRules.enemyOpeningCardFilter) {
      throw new ConfigLoadError(
        `${boundaryPath}.openingCardPolicy`,
        `必须遵循 L01 真实开局规则 ${scenarioRules.enemyOpeningCardFilter}`,
      );
    }
  }

  let expectedEnemyActionInterval: number | null = null;
  let expectedSpecialRule = 'NOT_APPLICABLE';
  let expectedPhasePolicy = 'NOT_APPLICABLE';
  if (levelId === 'L11') {
    const nameCheckRule = strategyRecord(scenarioRules.nameCheckRule, `${levelPath}.scenarioRules.nameCheckRule`);
    expectedEnemyActionInterval = strategyInteger(
      nameCheckRule,
      'enemyActionInterval',
      1,
      80,
      `${levelPath}.scenarioRules.nameCheckRule`,
    );
    expectedSpecialRule = 'L11_NAME_CHECK';
  }
  if (levelId === 'L12') {
    const pointBookRule = strategyRecord(scenarioRules.pointBookRule, `${levelPath}.scenarioRules.pointBookRule`);
    expectedEnemyActionInterval = strategyInteger(
      pointBookRule,
      'enemyActionInterval',
      1,
      80,
      `${levelPath}.scenarioRules.pointBookRule`,
    );
    const phaseTransition = strategyRecord(scenarioRules.phaseTransition, `${levelPath}.scenarioRules.phaseTransition`);
    const phaseExpectations: Record<string, unknown> = {
      triggerBossHpPercent: 50,
      bossEntersBattle: true,
      bossRole: 'HIGH_HP_ELITE',
      unitCardPreparationNormal: true,
    };
    Object.entries(phaseExpectations).forEach(([key, expected]) => {
      if (phaseTransition[key] !== expected) {
        throw new ConfigLoadError(`${levelPath}.scenarioRules.phaseTransition.${key}`, '不符合真实阶段规则');
      }
    });
    const nameLockAffects = phaseTransition.nameLockAffects;
    if (!Array.isArray(nameLockAffects) || !nameLockAffects.includes('SKILL_CARD')) {
      throw new ConfigLoadError(
        `${levelPath}.scenarioRules.phaseTransition.nameLockAffects`,
        '必须包含 SKILL_CARD',
      );
    }
    expectedSpecialRule = 'L12_POINT_BOOK';
    expectedPhasePolicy = 'L12_BOSS_PHASE_TRANSITION';
  }
  if (boundary.enemyActionInterval !== expectedEnemyActionInterval) {
    throw new ConfigLoadError(
      `${boundaryPath}.enemyActionInterval`,
      `必须匹配真实关卡边界 ${expectedEnemyActionInterval ?? 'NOT_APPLICABLE'}`,
    );
  }
  if (boundary.specialRule !== expectedSpecialRule) {
    throw new ConfigLoadError(`${boundaryPath}.specialRule`, `必须匹配真实特殊规则 ${expectedSpecialRule}`);
  }
  if (boundary.phasePolicy !== expectedPhasePolicy) {
    throw new ConfigLoadError(`${boundaryPath}.phasePolicy`, `必须匹配真实阶段规则 ${expectedPhasePolicy}`);
  }
}

function parseEnemyStrategy(
  value: unknown,
  index: number,
  chapterIndex: ChapterLevelIndex,
  levelsById: ReadonlyMap<string, Record<string, unknown>>,
  tables: EnemyStrategyValidationTables,
): EnemyStrategy {
  const configPath = `${STRATEGY_CONFIG_PATH}.strategies[${index}]`;
  const row = strategyRecord(value, configPath);
  exactKeys(row, STRATEGY_KEYS, configPath);

  const id = stringField(row, 'id', configPath);
  if (!STRATEGY_ID.test(id)) throw new ConfigLoadError(`${configPath}.id`, '必须按 ES_L01 至 ES_L12 编号');
  const levelId = stringField(row, 'levelId', configPath);
  if (!STRATEGY_LEVEL_ID.test(levelId) || !levelsById.has(levelId)) {
    throw new ConfigLoadError(`${configPath}.levelId`, `未知章节关卡: ${levelId}`);
  }
  const indexEntry = chapterIndex.levels.find((entry) => entry.id === levelId);
  if (!indexEntry) throw new ConfigLoadError(`${configPath}.levelId`, `缺失章节索引映射: ${levelId}`);
  if (id !== indexEntry.enemyStrategyId || id !== `ES_${levelId}`) {
    throw new ConfigLoadError(`${configPath}.id`, `必须与 ${levelId} 一一对应: ES_${levelId}`);
  }

  const level = levelsById.get(levelId)!;
  const deckId = stringField(row, 'deckId', configPath);
  const deck = tables.decks.get(deckId);
  if (!deck) throw new ConfigLoadError(`${configPath}.deckId`, `未知或未启用牌组: ${deckId}`);
  if (deckId !== level.enemyDeckId) {
    throw new ConfigLoadError(`${configPath}.deckId`, `必须使用关卡真实敌方牌组 ${level.enemyDeckId}`);
  }
  const deckPath = `config/decks.decks.${deckId}`;
  const deckUnitIds = deckCardIds(deck, tables.cards, 'UNIT', deckPath);
  const deckSkillIds = deckCardIds(deck, tables.cards, 'SKILL', deckPath);
  const totalCards = strategyInteger(deck, 'totalCards', 0, 9999, deckPath);

  const unitIds = strategyStringArray(row, 'unitIds', configPath);
  assertKnownStrategyIds(unitIds, new Set(tables.units.keys()), `${configPath}.unitIds`);
  unitIds.forEach((unitId, unitIndex) => {
    const card = tables.cards.get(unitId);
    if (!card || card.cardType !== 'UNIT' || card.unitId !== unitId) {
      throw new ConfigLoadError(
        `${configPath}.unitIds[${unitIndex}]`,
        `缺少同 ID UNIT 卡引用: ${unitId}`,
      );
    }
    if (!deckUnitIds.has(unitId)) {
      throw new ConfigLoadError(`${configPath}.unitIds[${unitIndex}]`, `不在真实牌组 ${deckId} 中`);
    }
  });

  const skillRulesValue = required(row, 'skillRules', configPath);
  if (!Array.isArray(skillRulesValue) || skillRulesValue.length === 0) {
    throw new ConfigLoadError(`${configPath}.skillRules`, '不得为空');
  }
  const skillRuleIds = new Set<string>();
  const skillRules = skillRulesValue.map((value, ruleIndex) => {
    const rulePath = `${configPath}.skillRules[${ruleIndex}]`;
    const rule = strategyRecord(value, rulePath);
    exactKeys(rule, SKILL_RULE_KEYS, rulePath);
    const skillId = stringField(rule, 'skillId', rulePath);
    if (skillRuleIds.has(skillId)) throw new ConfigLoadError(`${rulePath}.skillId`, `重复技能规则: ${skillId}`);
    skillRuleIds.add(skillId);
    const skill = tables.skills.get(skillId);
    if (!skill) throw new ConfigLoadError(`${rulePath}.skillId`, `未知或未启用技能: ${skillId}`);
    if (!deckSkillIds.has(skillId)) {
      throw new ConfigLoadError(`${rulePath}.skillId`, `不在真实牌组 ${deckId} 中`);
    }
    const policies = typeof skill.targetType === 'string' ? SKILL_POLICIES_BY_TARGET.get(skill.targetType) : undefined;
    if (!policies) throw new ConfigLoadError(`${rulePath}.skillId`, `使用了未支持的技能目标类型: ${skill.targetType}`);
    const targetPolicy = strategyEnum(rule, 'targetPolicy', policies, rulePath);
    const reserveIfNoLegalTarget = booleanField(rule, 'reserveIfNoLegalTarget', rulePath);
    return { skillId, targetPolicy, reserveIfNoLegalTarget };
  });

  const environmentElement = strategyEnum(row, 'environmentElement', STRATEGY_ENVIRONMENTS, configPath);
  if (environmentElement !== level.environmentElement) {
    throw new ConfigLoadError(`${configPath}.environmentElement`, '与真实关卡环境不一致');
  }
  const maxCardsPerAction = strategyInteger(row, 'maxCardsPerAction', 0, totalCards, configPath);
  if (maxCardsPerAction !== 0) {
    throw new ConfigLoadError(`${configPath}.maxCardsPerAction`, '必须遵循核心规则 R1=0');
  }
  const lethalWeight = strategyInteger(row, 'lethalWeight', 0, 1000, configPath);
  const defendWeight = strategyInteger(row, 'defendWeight', 0, 1000, configPath);
  const emptyLaneWeight = strategyInteger(row, 'emptyLaneWeight', 0, 1000, configPath);
  const rangedSupportWeight = strategyInteger(row, 'rangedSupportWeight', 0, 1000, configPath);
  const randomness = strategyInteger(row, 'randomness', 0, 10000, configPath);
  if (lethalWeight + defendWeight + emptyLaneWeight + rangedSupportWeight === 0) {
    throw new ConfigLoadError(configPath, '行动权重不得全为 0');
  }

  const actionPriority = strategyStringArray(row, 'actionPriority', configPath, 2);
  actionPriority.forEach((action, actionIndex) => {
    if (!STRATEGY_ACTIONS.has(action)) {
      throw new ConfigLoadError(`${configPath}.actionPriority[${actionIndex}]`, `包含非法枚举: ${action}`);
    }
  });
  if (actionPriority[actionPriority.length - 1] !== 'HOLD_NO_LEGAL_ACTION') {
    throw new ConfigLoadError(`${configPath}.actionPriority`, '必须以 HOLD_NO_LEGAL_ACTION 收束');
  }

  const targetPath = `${configPath}.targetSelection`;
  const targetSelectionValue = strategyRecord(row.targetSelection, targetPath);
  exactKeys(targetSelectionValue, TARGET_SELECTION_KEYS, targetPath);
  const enemyUnitOrder = strategyStringArray(targetSelectionValue, 'enemyUnitOrder', targetPath, 2);
  const enemyLaneOrder = strategyStringArray(targetSelectionValue, 'enemyLaneOrder', targetPath, 2);
  const allyUnitOrder = strategyStringArray(targetSelectionValue, 'allyUnitOrder', targetPath, 2);
  const allyLaneOrder = strategyStringArray(targetSelectionValue, 'allyLaneOrder', targetPath, 2);
  enemyUnitOrder.forEach((policy) => { if (!UNIT_TARGET_POLICIES.has(policy)) throw new ConfigLoadError(targetPath, `包含非法 enemyUnitOrder: ${policy}`); });
  enemyLaneOrder.forEach((policy) => { if (!LANE_TARGET_POLICIES.has(policy)) throw new ConfigLoadError(targetPath, `包含非法 enemyLaneOrder: ${policy}`); });
  allyUnitOrder.forEach((policy) => { if (!ALLY_UNIT_TARGET_POLICIES.has(policy)) throw new ConfigLoadError(targetPath, `包含非法 allyUnitOrder: ${policy}`); });
  allyLaneOrder.forEach((policy) => { if (!ALLY_LANE_TARGET_POLICIES.has(policy)) throw new ConfigLoadError(targetPath, `包含非法 allyLaneOrder: ${policy}`); });
  const priorityTargetUnitIds = strategyStringArray(targetSelectionValue, 'priorityTargetUnitIds', targetPath);
  assertKnownStrategyIds(priorityTargetUnitIds, new Set(tables.units.keys()), `${targetPath}.priorityTargetUnitIds`);
  priorityTargetUnitIds.forEach((unitId, unitIndex) => {
    if (!unitIds.includes(unitId)) throw new ConfigLoadError(`${targetPath}.priorityTargetUnitIds[${unitIndex}]`, `不在本策略单位 roster: ${unitId}`);
    if (!deckUnitIds.has(unitId)) throw new ConfigLoadError(`${targetPath}.priorityTargetUnitIds[${unitIndex}]`, `不在真实牌组 ${deckId} 中`);
  });
  const noLegalTarget = strategyEnum(targetSelectionValue, 'noLegalTarget', NO_LEGAL_TARGET_POLICIES, targetPath);
  const tieBreak = strategyEnum(targetSelectionValue, 'tieBreak', TIE_BREAKS, targetPath);

  const difficultyPath = `${configPath}.difficulty`;
  const difficultyValue = strategyRecord(row.difficulty, difficultyPath);
  exactKeys(difficultyValue, DIFFICULTY_KEYS, difficultyPath);
  const tier = strategyEnum(difficultyValue, 'tier', DIFFICULTIES, difficultyPath);
  const threatMultiplierPercent = strategyInteger(difficultyValue, 'threatMultiplierPercent', 50, 150, difficultyPath);
  const skillReserveTurns = strategyInteger(difficultyValue, 'skillReserveTurns', 0, 3, difficultyPath);

  const boundaryPath = `${configPath}.ruleBoundary`;
  const boundaryValue = strategyRecord(row.ruleBoundary, boundaryPath);
  exactKeys(boundaryValue, RULE_BOUNDARY_KEYS, boundaryPath);
  const maxConsecutiveSameLane = strategyInteger(boundaryValue, 'maxConsecutiveSameLane', 1, 3, boundaryPath);
  const sameLaneFallback = strategyEnum(boundaryValue, 'sameLaneFallback', LANE_FALLBACKS, boundaryPath);
  const reserveSkillWhenNoLegalTarget = booleanField(boundaryValue, 'reserveSkillWhenNoLegalTarget', boundaryPath);
  const openingCardPolicy = strategyEnum(boundaryValue, 'openingCardPolicy', OPENING_POLICIES, boundaryPath);
  const enemyActionInterval = strategyNullableInteger(boundaryValue, 'enemyActionInterval', 1, 80, boundaryPath);
  const phasePolicy = strategyEnum(boundaryValue, 'phasePolicy', PHASE_POLICIES, boundaryPath);
  const specialRule = strategyEnum(boundaryValue, 'specialRule', SPECIAL_RULES, boundaryPath);
  const maxRounds = strategyInteger(boundaryValue, 'maxRounds', 1, 80, boundaryPath);
  assertStrategyLevelBoundaries(level, levelId, boundaryValue, boundaryPath);

  return {
    id,
    levelId,
    deckId,
    unitIds,
    skillRules,
    environmentElement,
    maxCardsPerAction,
    lethalWeight,
    defendWeight,
    emptyLaneWeight,
    rangedSupportWeight,
    randomness,
    actionPriority,
    targetSelection: {
      enemyUnitOrder,
      enemyLaneOrder,
      allyUnitOrder,
      allyLaneOrder,
      priorityTargetUnitIds,
      noLegalTarget,
      tieBreak,
    },
    difficulty: { tier, threatMultiplierPercent, skillReserveTurns },
    ruleBoundary: {
      maxConsecutiveSameLane,
      sameLaneFallback,
      reserveSkillWhenNoLegalTarget,
      openingCardPolicy,
      enemyActionInterval,
      phasePolicy,
      specialRule,
      maxRounds,
    },
  };
}

export function assertEnemyStrategyTable(
  value: unknown,
  chapterIndex: ChapterLevelIndex,
  levels: ReadonlyMap<string, Record<string, unknown>>,
  sourceTables: ReadonlyMap<string, Record<string, unknown>>,
  configPath = STRATEGY_CONFIG_PATH,
): EnemyStrategy[] {
  const root = strategyRecord(value, configPath);
  exactKeys(root, STRATEGY_ROOT_KEYS, configPath);
  if (root.schemaVersion !== 1) throw new ConfigLoadError(`${configPath}.schemaVersion`, '必须是数字 1');
  if (root.table !== 'strategies') throw new ConfigLoadError(`${configPath}.table`, '必须是 strategies');
  if (root.evidenceLevel !== 'C') throw new ConfigLoadError(`${configPath}.evidenceLevel`, '必须是 C');
  if (root.version !== 1) throw new ConfigLoadError(`${configPath}.version`, '必须是数字 1');
  if (root.enabled !== true) throw new ConfigLoadError(`${configPath}.enabled`, '必须是 true');
  const strategiesValue = root.strategies;
  if (!Array.isArray(strategiesValue) || strategiesValue.length !== chapterIndex.levels.length) {
    throw new ConfigLoadError(`${configPath}.strategies`, '必须按章节索引提供恰好十二条策略');
  }
  const tables: EnemyStrategyValidationTables = {
    units: enabledRowsById(sourceTables.get('units')!, 'units', 'config/units'),
    cards: enabledRowsById(sourceTables.get('cards')!, 'cards', 'config/cards'),
    skills: enabledRowsById(sourceTables.get('skills')!, 'skills', 'config/skills'),
    decks: enabledRowsById(sourceTables.get('decks')!, 'decks', 'config/decks'),
  };
  const expectedLevelIds = chapterIndex.levels.map((entry) => entry.id);
  const strategies = strategiesValue.map((strategy, index) => {
    const strategyPath = `${configPath}.strategies[${index}]`;
    const row = strategyRecord(strategy, strategyPath);
    const expectedLevelId = expectedLevelIds[index];
    if (row.levelId !== expectedLevelId) {
      throw new ConfigLoadError(`${strategyPath}.levelId`, `必须映射 ${expectedLevelId}`);
    }
    return parseEnemyStrategy(strategy, index, chapterIndex, levels, tables);
  });
  const strategyIds = new Set<string>();
  const strategyLevelIds = new Set<string>();
  strategies.forEach((strategy, index) => {
    if (strategyIds.has(strategy.id)) throw new ConfigLoadError(`${configPath}.strategies[${index}].id`, `重复策略 ID: ${strategy.id}`);
    if (strategyLevelIds.has(strategy.levelId)) throw new ConfigLoadError(`${configPath}.strategies[${index}].levelId`, `重复策略 levelId: ${strategy.levelId}`);
    strategyIds.add(strategy.id);
    strategyLevelIds.add(strategy.levelId);
  });
  return strategies;
}

export async function loadChapter01Runtime(
  manifest: ConfigManifest,
  tables: ReadonlyMap<string, Record<string, unknown>>,
): Promise<Chapter01Runtime> {
  const index = assertChapterLevelIndex(await loadJsonAsset(manifest.chapters.chapter01));
  const references = buildChapterLevelReferences(index, tables);
  const decks = tables.get('decks');
  if (!decks) throw new ConfigLoadError('config/decks', '牌组资源未加载');
  const chapterContract = await import('./levels/ChapterLevelContract');
  const levels = await Promise.all(index.levels.map(async (entry) => {
    const value = await loadJsonAsset(entry.resource);
    if (!isRecord(value)) {
      throw new ConfigLoadError(entry.resource, '根值必须是 JSON object');
    }
    exactKeys(value, ['chapterLevels'], entry.resource);
    if (!Array.isArray(value.chapterLevels) || value.chapterLevels.length !== 1) {
      throw new ConfigLoadError(entry.resource, '必须包含恰好一个 chapterLevels 条目');
    }
    const levelValue = value.chapterLevels[0];
    const levelPath = `${entry.resource}.chapterLevels[0]`;
    if (!isRecord(levelValue)) {
      throw new ConfigLoadError(levelPath, '必须是 object');
    }
    exactKeysWithOptional(
      levelValue,
      ['id', 'prerequisiteLevelId', 'enemyDeckId', 'environmentElement', 'objectives', 'rewards', 'failureConditions'],
      ['scenarioRules', 'battleRules'],
      levelPath,
    );
    const objectives = levelValue.objectives;
    if (Array.isArray(objectives)) {
      objectives.forEach((objective, index) => {
        const objectivePath = `${levelPath}.objectives[${index}]`;
        if (!isRecord(objective)) throw new ConfigLoadError(objectivePath, '必须是 object');
        exactKeysWithOptional(objective, ['type'], ['targetId', 'rounds'], objectivePath);
      });
    }
    const rewards = levelValue.rewards;
    if (Array.isArray(rewards)) {
      rewards.forEach((reward, index) => {
        const rewardItemPath = `${levelPath}.rewards[${index}]`;
        if (!isRecord(reward)) throw new ConfigLoadError(rewardItemPath, '必须是 object');
        exactKeysWithOptional(reward, ['type', 'id', 'quantity'], ['cardType'], rewardItemPath);
        if ('cardType' in reward) {
          const cardType = reward.cardType;
          if (cardType !== 'UNIT' && cardType !== 'SKILL') {
            throw new ConfigLoadError(`${rewardItemPath}.cardType`, '必须是 UNIT 或 SKILL');
          }
        }
      });
    }
    const failureConditions = levelValue.failureConditions;
    if (Array.isArray(failureConditions)) {
      failureConditions.forEach((condition, index) => {
        const conditionPath = `${levelPath}.failureConditions[${index}]`;
        if (!isRecord(condition)) throw new ConfigLoadError(conditionPath, '必须是 object');
        exactKeysWithOptional(condition, ['type'], ['targetId', 'rounds'], conditionPath);
      });
    }
    if (levelValue.id !== entry.id) {
      throw new ConfigLoadError(`${entry.resource}.chapterLevels[0].id`, `必须与索引一致: ${entry.id}`);
    }
    if (levelValue.prerequisiteLevelId !== entry.prerequisiteLevelId) {
      throw new ConfigLoadError(
        `${entry.resource}.chapterLevels[0].prerequisiteLevelId`,
        `必须与章节索引一致: ${entry.prerequisiteLevelId ?? 'null'}`,
      );
    }
    chapterContract.assertChapterLevelContract(value, manifest, decks, references, entry.resource);
    return value.chapterLevels[0] as ChapterLevelConfig;
  }));
  const levelsById = new Map(levels.map((level) => [level.id, level as unknown as Record<string, unknown>]));
  const strategiesValue = tables.get('strategies');
  if (!strategiesValue) throw new ConfigLoadError(STRATEGY_CONFIG_PATH, '敌方策略资源未加载');
  const strategies = assertEnemyStrategyTable(strategiesValue, index, levelsById, tables);
  const frozenStrategies = strategies.map((strategy) => deepFreeze(strategy));
  return {
    index,
    levels,
    strategyByLevelId: createReadonlyMap(frozenStrategies.map((strategy) => [strategy.levelId, strategy] as const)),
    strategyById: createReadonlyMap(frozenStrategies.map((strategy) => [strategy.id, strategy] as const)),
  };
}

export async function loadChapter01Levels(
  manifest: ConfigManifest,
  tables: ReadonlyMap<string, Record<string, unknown>>,
): Promise<ChapterLevelConfig[]> {
  return (await loadChapter01Runtime(manifest, tables)).levels;
}

export function loadConfigRuntime(): Promise<ConfigRuntime> {
  return new Promise((resolve, reject) => {
    resources.load('config/manifest', JsonAsset, (error, asset) => {
      if (error) {
        reject(new ConfigLoadError('config/manifest', error.message || '资源读取失败', { cause: error }));
        return;
      }
      try {
        assertConfigManifest(asset?.json);
        const manifest = asset.json;
        const tableNames = ['units', 'cards', 'skills', 'effects', 'statuses', 'professions', 'decks', 'strategies'] as const;
        const tableLoads = tableNames.map((tableName) =>
          loadJsonAsset(manifest.tables[tableName]).then((table) => assertTable(table, tableName, manifest.tables[tableName]))
        );
        void Promise.all(tableLoads).then(async (tableValues) => {
          const tables = new Map(tableNames.map((tableName, index) => [tableName, tableValues[index]]));
          const chapter01 = await loadChapter01Runtime(manifest, tables);
          resolve({ manifest, chapter01 });
        }).catch(reject);
      } catch (validationError) {
        reject(validationError);
      }
    });
  });
}

export function loadConfigManifest(): Promise<ConfigManifest> {
  return loadConfigRuntime().then(({ manifest }) => manifest);
}
