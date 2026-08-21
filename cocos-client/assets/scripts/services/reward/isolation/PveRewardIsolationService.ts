import {
  CAMPAIGN_LEVEL_IDS,
  type CampaignLevelId,
} from '../../../meta/campaign/CampaignState.ts';
import {
  DEFAULT_DUNGEON_DIFFICULTY_CONFIG,
  DUNGEON_DIFFICULTY_IDS,
  type DungeonDifficultyId,
} from '../../../pve/dungeon/difficulty/DungeonDifficulty.ts';
import { TOWER_FLOOR_COUNT } from '../../../pve/tower/lifecycle/TowerLifecycle.ts';
import {
  towerCoinDropAtFloor,
  towerShopConfig,
} from '../../../pve/tower/shop/TowerShopConfig.ts';
import {
  loadPveRewardIsolationConfig,
  type PveRewardIsolationConfig,
} from './PveRewardIsolationConfig.ts';

export const PVE_REWARD_ISOLATION_SCHEMA_VERSION = 1 as const;
export const PVE_MODES = Object.freeze(['MAINLINE', 'DUNGEON', 'TOWER', 'BOSS'] as const);

export type PveMode = (typeof PVE_MODES)[number];
export type SettlementOutcome = 'CLEARED' | 'FAILED' | 'WON' | 'LOST';
export type RewardEntry = Readonly<{ id: string; quantity: number }>;
export type RewardBalances = Readonly<Record<string, number>>;
export type ProcessedSettlement = Readonly<{ key: string; fingerprint: string }>;

export interface MainlineLevelProgress {
  readonly levelId: CampaignLevelId;
  readonly unlocked: boolean;
  readonly attemptsUsed: number;
  readonly clearCount: number;
  readonly lastOutcome: 'NONE' | 'FAILED' | 'CLEARED';
}

export interface DungeonDifficultyProgress {
  readonly difficultyId: DungeonDifficultyId;
  readonly unlocked: boolean;
  readonly attemptsUsed: number;
  readonly clearCount: number;
  readonly lastOutcome: 'NONE' | 'LOST' | 'WON';
}

export interface TowerRewardProgress {
  readonly currentFloor: number;
  readonly bestFloor: number;
  readonly clearedFloors: readonly number[];
  readonly attemptsUsed: number;
  readonly lastOutcome: 'NONE' | 'LOST' | 'WON';
}

export interface BossEncounterProgress {
  readonly bossId: string;
  readonly attemptsUsed: number;
  readonly defeated: boolean;
  readonly lastOutcome: 'LOST' | 'WON';
}

export interface PveRewardIsolationState {
  readonly schemaVersion: typeof PVE_REWARD_ISOLATION_SCHEMA_VERSION;
  readonly mainline: Readonly<{
    levels: readonly MainlineLevelProgress[];
    rewards: RewardBalances;
    processedSettlements: readonly ProcessedSettlement[];
  }>;
  readonly dungeon: Readonly<{
    difficulties: readonly DungeonDifficultyProgress[];
    rewards: RewardBalances;
    processedSettlements: readonly ProcessedSettlement[];
  }>;
  readonly tower: Readonly<{
    progress: TowerRewardProgress;
    rewards: RewardBalances;
    processedSettlements: readonly ProcessedSettlement[];
  }>;
  readonly boss: Readonly<{
    encounters: readonly BossEncounterProgress[];
    rewards: RewardBalances;
    processedSettlements: readonly ProcessedSettlement[];
  }>;
}

type MutablePveRewardIsolationState = {
  schemaVersion: typeof PVE_REWARD_ISOLATION_SCHEMA_VERSION;
  mainline: {
    levels: MainlineLevelProgress[];
    rewards: Record<string, number>;
    processedSettlements: ProcessedSettlement[];
  };
  dungeon: {
    difficulties: DungeonDifficultyProgress[];
    rewards: Record<string, number>;
    processedSettlements: ProcessedSettlement[];
  };
  tower: {
    progress: TowerRewardProgress;
    rewards: Record<string, number>;
    processedSettlements: ProcessedSettlement[];
  };
  boss: {
    encounters: BossEncounterProgress[];
    rewards: Record<string, number>;
    processedSettlements: ProcessedSettlement[];
  };
};

export type PveRewardIsolationPersistence = (serialized: string) => void;

export type PveRewardIsolationServiceOptions = Readonly<{
  initialState?: PveRewardIsolationState | string;
  persist?: PveRewardIsolationPersistence;
  config?: PveRewardIsolationConfig;
}>;

export type PveRewardIsolationErrorCode =
  | 'INVALID_STATE'
  | 'INVALID_SETTLEMENT'
  | 'PERSISTENCE_FAILED'
  | 'PERSISTENCE_REENTRANT';

export class PveRewardIsolationError extends Error {
  readonly code: PveRewardIsolationErrorCode;

  constructor(code: PveRewardIsolationErrorCode, message: string) {
    super(message);
    this.name = 'PveRewardIsolationError';
    this.code = code;
  }
}

export type PveRewardIsolationResultCode =
  | 'APPLIED'
  | 'DUPLICATE'
  | 'CONFLICT'
  | 'INVALID'
  | 'PERSIST_FAILED'
  | 'PERSISTENCE_REENTRANT';

export type PveRewardIsolationResult = Readonly<{
  applied: boolean;
  code: PveRewardIsolationResultCode;
  state: PveRewardIsolationState;
}>;

type MainlineSettlement = Readonly<{
  mode: 'MAINLINE';
  settlementKey: string;
  levelId: CampaignLevelId;
  outcome: 'CLEARED' | 'FAILED';
  rewards: readonly RewardEntry[];
}>;

type DungeonSettlement = Readonly<{
  mode: 'DUNGEON';
  settlementKey: string;
  difficultyId: DungeonDifficultyId;
  outcome: 'WON' | 'LOST';
  rewards: readonly RewardEntry[];
}>;

type TowerSettlement = Readonly<{
  mode: 'TOWER';
  settlementKey: string;
  floor: number;
  outcome: 'WON' | 'LOST';
  rewards: readonly RewardEntry[];
}>;

type BossSettlement = Readonly<{
  mode: 'BOSS';
  settlementKey: string;
  bossId: string;
  outcome: 'WON' | 'LOST';
  rewards: readonly RewardEntry[];
}>;

type NormalizedSettlement = MainlineSettlement | DungeonSettlement | TowerSettlement | BossSettlement;

const MAINLINE_LEVEL_ID_SET = new Set<string>(CAMPAIGN_LEVEL_IDS);
const DUNGEON_DIFFICULTY_ID_SET = new Set<string>(DUNGEON_DIFFICULTY_IDS);
const DUNGEON_REWARD_IDS = new Set(
  DEFAULT_DUNGEON_DIFFICULTY_CONFIG.flatMap((definition) => [
    ...definition.firstClearRewards.map(({ id }) => id),
    ...definition.repeatClearRewards.map(({ id }) => id),
  ]),
);
const FOREIGN_REWARD_IDS = new Set([
  ...[...DUNGEON_REWARD_IDS].filter((id) => id !== 'gold'),
  'tower-coin',
  'boss-mark',
]);
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clone(item)]),
  ) as T;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code: PveRewardIsolationErrorCode, message: string): never {
  throw new PveRewardIsolationError(code, message);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== 'string' || !expected.includes(key))
  ) {
    fail('INVALID_STATE', `${path} contains unexpected or missing fields`);
  }
}

function assertSettlementKeys(value: Record<string, unknown>, expected: readonly string[], path: string): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === expected.length
    && actual.every((key) => typeof key === 'string' && expected.includes(key));
}

function assertTrimmedString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail('INVALID_STATE', `${path} must be a trimmed non-empty string`);
  }
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail('INVALID_STATE', `${path} must be a positive safe integer`);
  }
}

function assertNonNegativeInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail('INVALID_STATE', `${path} must be a non-negative safe integer`);
  }
}

function assertDenseArray(value: unknown, path: string): asserts value is readonly unknown[] {
  if (!Array.isArray(value)) fail('INVALID_STATE', `${path} must be an array`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) fail('INVALID_STATE', `${path}[${index}] must not be a hole`);
  }
}

function assertRewardId(mode: PveMode, id: string, path: string): void {
  if (RESERVED_IDS.has(id)) fail('INVALID_STATE', `${path} is reserved`);
  if (mode === 'DUNGEON' && !DUNGEON_REWARD_IDS.has(id)) {
    fail('INVALID_STATE', `${path} is not a configured dungeon reward`);
  }
  if (mode === 'TOWER' && id !== 'tower-coin') {
    fail('INVALID_STATE', `${path} must be tower-coin`);
  }
  if (mode === 'BOSS' && id !== 'boss-mark') {
    fail('INVALID_STATE', `${path} must be boss-mark`);
  }
  if (mode === 'MAINLINE' && FOREIGN_REWARD_IDS.has(id)) {
    fail('INVALID_STATE', `${path} belongs to another PVE reward namespace`);
  }
}

function normalizeRewards(value: unknown, mode: PveMode, path: string): readonly RewardEntry[] | null {
  if (!Array.isArray(value)) return null;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return null;
  }
  const ids = new Set<string>();
  const rewards: RewardEntry[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const candidate = value[index];
    if (!isRecord(candidate) || !assertSettlementKeys(candidate, ['id', 'quantity'], `${path}[${index}]`)) return null;
    if (typeof candidate.id !== 'string' || candidate.id.length === 0 || candidate.id.trim() !== candidate.id) return null;
    if (ids.has(candidate.id) || RESERVED_IDS.has(candidate.id)) return null;
    if (!Number.isSafeInteger(candidate.quantity) || candidate.quantity <= 0) return null;
    if (mode === 'MAINLINE' && FOREIGN_REWARD_IDS.has(candidate.id)) return null;
    if (mode === 'DUNGEON' && !DUNGEON_REWARD_IDS.has(candidate.id)) return null;
    if (mode === 'TOWER' && candidate.id !== 'tower-coin') return null;
    if (mode === 'BOSS' && candidate.id !== 'boss-mark') return null;
    ids.add(candidate.id);
    rewards.push({ id: candidate.id, quantity: candidate.quantity });
  }
  return Object.freeze(rewards.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

function rewardEntriesEqual(left: readonly RewardEntry[], right: readonly RewardEntry[]): boolean {
  return left.length === right.length && left.every((entry, index) => (
    entry.id === right[index]?.id && entry.quantity === right[index]?.quantity
  ));
}

function normalizeSettlement(value: unknown): NormalizedSettlement | null {
  if (!isRecord(value) || typeof value.mode !== 'string') return null;
  if (value.mode === 'MAINLINE') {
    if (!assertSettlementKeys(value, ['mode', 'settlementKey', 'levelId', 'outcome', 'rewards'], 'settlement')) return null;
    if (typeof value.settlementKey !== 'string' || !/^mainline:[^:]+:[1-9]\d*$/.test(value.settlementKey)) return null;
    if (!Number.isSafeInteger(Number(value.settlementKey.split(':')[2]))) return null;
    if (typeof value.levelId !== 'string' || !MAINLINE_LEVEL_ID_SET.has(value.levelId)) return null;
    const keyLevelId = value.settlementKey.split(':')[1];
    if (keyLevelId !== value.levelId) return null;
    if (value.outcome !== 'CLEARED' && value.outcome !== 'FAILED') return null;
    const rewards = normalizeRewards(value.rewards, 'MAINLINE', 'settlement.rewards');
    if (rewards === null || (value.outcome === 'FAILED' && rewards.length > 0)) return null;
    return { mode: 'MAINLINE', settlementKey: value.settlementKey, levelId: value.levelId as CampaignLevelId, outcome: value.outcome, rewards };
  }
  if (value.mode === 'DUNGEON') {
    if (!assertSettlementKeys(value, ['mode', 'settlementKey', 'difficultyId', 'outcome', 'rewards'], 'settlement')) return null;
    if (typeof value.settlementKey !== 'string' || !/^dungeon-(normal|hard)-[1-9]\d*$/.test(value.settlementKey)) return null;
    if (!Number.isSafeInteger(Number(value.settlementKey.split('-')[2]))) return null;
    if (typeof value.difficultyId !== 'string' || !DUNGEON_DIFFICULTY_ID_SET.has(value.difficultyId)) return null;
    if (value.settlementKey.split('-')[1].toUpperCase() !== value.difficultyId) return null;
    if (value.outcome !== 'WON' && value.outcome !== 'LOST') return null;
    const rewards = normalizeRewards(value.rewards, 'DUNGEON', 'settlement.rewards');
    if (rewards === null || (value.outcome === 'LOST' && rewards.length > 0)) return null;
    return { mode: 'DUNGEON', settlementKey: value.settlementKey, difficultyId: value.difficultyId as DungeonDifficultyId, outcome: value.outcome, rewards };
  }
  if (value.mode === 'TOWER') {
    if (!assertSettlementKeys(value, ['mode', 'settlementKey', 'floor', 'outcome', 'rewards'], 'settlement')) return null;
    if (typeof value.settlementKey !== 'string' || !/^tower:[1-9]\d*:[1-9]\d*$/.test(value.settlementKey)) return null;
    const keyParts = value.settlementKey.split(':');
    if (!Number.isSafeInteger(Number(keyParts[1])) || !Number.isSafeInteger(Number(keyParts[2]))) return null;
    if (!Number.isSafeInteger(value.floor) || value.floor < 1 || value.floor > TOWER_FLOOR_COUNT) return null;
    if (Number(keyParts[1]) !== value.floor || String(Number(keyParts[1])) !== keyParts[1] || String(Number(keyParts[2])) !== keyParts[2]) return null;
    if (value.outcome !== 'WON' && value.outcome !== 'LOST') return null;
    const rewards = normalizeRewards(value.rewards, 'TOWER', 'settlement.rewards');
    if (rewards === null || (value.outcome === 'LOST' && rewards.length > 0)) return null;
    return { mode: 'TOWER', settlementKey: value.settlementKey, floor: value.floor, outcome: value.outcome, rewards };
  }
  if (value.mode === 'BOSS') {
    if (!assertSettlementKeys(value, ['mode', 'settlementKey', 'bossId', 'outcome', 'rewards'], 'settlement')) return null;
    if (typeof value.settlementKey !== 'string' || !/^boss:[^:]+:[1-9]\d*$/.test(value.settlementKey)) return null;
    if (!Number.isSafeInteger(Number(value.settlementKey.split(':')[2]))) return null;
    if (typeof value.bossId !== 'string' || value.bossId.length === 0 || value.bossId.trim() !== value.bossId || value.bossId.includes(':') || RESERVED_IDS.has(value.bossId)) return null;
    if (value.settlementKey.split(':')[1] !== value.bossId) return null;
    if (value.outcome !== 'WON' && value.outcome !== 'LOST') return null;
    const rewards = normalizeRewards(value.rewards, 'BOSS', 'settlement.rewards');
    if (rewards === null || (value.outcome === 'LOST' && rewards.length > 0)) return null;
    return { mode: 'BOSS', settlementKey: value.settlementKey, bossId: value.bossId, outcome: value.outcome, rewards };
  }
  return null;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => canonical(item)).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function isDifficultyUnlocked(difficultyId: DungeonDifficultyId, difficulties: readonly DungeonDifficultyProgress[]): boolean {
  const definition = DEFAULT_DUNGEON_DIFFICULTY_CONFIG.find((candidate) => candidate.id === difficultyId);
  if (definition === undefined) return false;
  if (definition.unlock.type === 'always') return true;
  const source = difficulties.find((candidate) => candidate.difficultyId === definition.unlock.difficultyId);
  return source !== undefined && source.clearCount >= (definition.unlock.minimumClears ?? Number.POSITIVE_INFINITY);
}

function initialDungeonDifficulties(): readonly DungeonDifficultyProgress[] {
  const initial = DUNGEON_DIFFICULTY_IDS.map((difficultyId) => ({
    difficultyId,
    unlocked: difficultyId === DUNGEON_DIFFICULTY_IDS[0],
    attemptsUsed: 0,
    clearCount: 0,
    lastOutcome: null,
  }));
  return Object.freeze(initial);
}

function initialDungeonRewards(): RewardBalances {
  const rewards: Record<string, number> = {};
  for (const rewardId of DUNGEON_REWARD_IDS) rewards[rewardId] = 0;
  return rewards;
}

export function createPveRewardIsolationState(): PveRewardIsolationState {
  return freezeDeep({
    schemaVersion: PVE_REWARD_ISOLATION_SCHEMA_VERSION,
    mainline: {
      levels: CAMPAIGN_LEVEL_IDS.map((levelId, index) => ({
        levelId,
        unlocked: index === 0,
        attemptsUsed: 0,
        clearCount: 0,
        lastOutcome: 'NONE' as const,
      })),
      rewards: {},
      processedSettlements: [],
    },
    dungeon: {
      difficulties: initialDungeonDifficulties(),
      rewards: initialDungeonRewards(),
      processedSettlements: [],
    },
    tower: {
      progress: {
        currentFloor: 1,
        bestFloor: 0,
        clearedFloors: [],
        attemptsUsed: 0,
        lastOutcome: 'NONE' as const,
      },
      rewards: { 'tower-coin': 0 },
      processedSettlements: [],
    },
    boss: {
      encounters: [],
      rewards: { 'boss-mark': 0 },
      processedSettlements: [],
    },
  });
}

function validateProcessedSettlements(value: unknown, path: string, keyPattern: RegExp): asserts value is readonly ProcessedSettlement[] {
  assertDenseArray(value, path);
  const keys = new Set<string>();
  value.forEach((candidate, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(candidate)) fail('INVALID_STATE', `${itemPath} must be an object`);
    assertExactKeys(candidate, ['key', 'fingerprint'], itemPath);
    assertTrimmedString(candidate.key, `${itemPath}.key`);
    assertTrimmedString(candidate.fingerprint, `${itemPath}.fingerprint`);
    if (!keyPattern.test(candidate.key)) fail('INVALID_STATE', `${itemPath}.key is outside its mode namespace`);
    if (keys.has(candidate.key)) fail('INVALID_STATE', `${path} contains duplicate settlement keys`);
    keys.add(candidate.key);
  });
}

function validateRewardBalances(value: unknown, mode: PveMode, path: string): asserts value is RewardBalances {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_STATE', `${path} must be a plain object`);
  for (const [id, quantity] of Object.entries(value)) {
    assertTrimmedString(id, `${path} reward id`);
    assertNonNegativeInteger(quantity, `${path}.${id}`);
    assertRewardId(mode, id, `${path}.${id}`);
  }
}

function validateMainlineState(value: unknown): asserts value is PveRewardIsolationState['mainline'] {
  if (!isRecord(value)) fail('INVALID_STATE', 'state.mainline must be an object');
  assertExactKeys(value, ['levels', 'rewards', 'processedSettlements'], 'state.mainline');
  assertDenseArray(value.levels, 'state.mainline.levels');
  if (value.levels.length !== CAMPAIGN_LEVEL_IDS.length) fail('INVALID_STATE', 'state.mainline.levels must match campaign levels');
  value.levels.forEach((candidate, index) => {
    const path = `state.mainline.levels[${index}]`;
    if (!isRecord(candidate)) fail('INVALID_STATE', `${path} must be an object`);
    assertExactKeys(candidate, ['levelId', 'unlocked', 'attemptsUsed', 'clearCount', 'lastOutcome'], path);
    if (candidate.levelId !== CAMPAIGN_LEVEL_IDS[index]) fail('INVALID_STATE', `${path}.levelId is out of campaign order`);
    if (typeof candidate.unlocked !== 'boolean') fail('INVALID_STATE', `${path}.unlocked must be boolean`);
    assertNonNegativeInteger(candidate.attemptsUsed, `${path}.attemptsUsed`);
    assertNonNegativeInteger(candidate.clearCount, `${path}.clearCount`);
    if (candidate.clearCount > candidate.attemptsUsed) fail('INVALID_STATE', `${path}.clearCount exceeds attemptsUsed`);
    if (candidate.lastOutcome !== 'NONE' && candidate.lastOutcome !== 'FAILED' && candidate.lastOutcome !== 'CLEARED') fail('INVALID_STATE', `${path}.lastOutcome is invalid`);
    if (candidate.attemptsUsed === 0 && (candidate.clearCount !== 0 || candidate.lastOutcome !== 'NONE')) fail('INVALID_STATE', `${path} has history without an attempt`);
    if (candidate.lastOutcome === 'CLEARED' && candidate.clearCount === 0) fail('INVALID_STATE', `${path}.CLEARED requires a clear`);
    const previous = value.levels[index - 1];
    const expectedUnlocked = index === 0 || (
      isRecord(previous)
      && typeof previous.clearCount === 'number'
      && previous.clearCount > 0
    );
    if (candidate.unlocked !== expectedUnlocked) fail('INVALID_STATE', `${path}.unlocked is not derived from the previous clear`);
  });
  validateRewardBalances(value.rewards, 'MAINLINE', 'state.mainline.rewards');
  validateProcessedSettlements(value.processedSettlements, 'state.mainline.processedSettlements', /^mainline:[^:]+:[1-9]\d*$/);
}

function validateDungeonState(value: unknown): asserts value is PveRewardIsolationState['dungeon'] {
  if (!isRecord(value)) fail('INVALID_STATE', 'state.dungeon must be an object');
  assertExactKeys(value, ['difficulties', 'rewards', 'processedSettlements'], 'state.dungeon');
  assertDenseArray(value.difficulties, 'state.dungeon.difficulties');
  if (value.difficulties.length !== DUNGEON_DIFFICULTY_IDS.length) fail('INVALID_STATE', 'state.dungeon.difficulties must match configured difficulties');
  value.difficulties.forEach((candidate, index) => {
    const path = `state.dungeon.difficulties[${index}]`;
    if (!isRecord(candidate)) fail('INVALID_STATE', `${path} must be an object`);
    assertExactKeys(candidate, ['difficultyId', 'unlocked', 'attemptsUsed', 'clearCount', 'lastOutcome'], path);
    if (candidate.difficultyId !== DUNGEON_DIFFICULTY_IDS[index]) fail('INVALID_STATE', `${path}.difficultyId is out of config order`);
    if (typeof candidate.unlocked !== 'boolean') fail('INVALID_STATE', `${path}.unlocked must be boolean`);
    assertNonNegativeInteger(candidate.attemptsUsed, `${path}.attemptsUsed`);
    assertNonNegativeInteger(candidate.clearCount, `${path}.clearCount`);
    const definition = DEFAULT_DUNGEON_DIFFICULTY_CONFIG[index];
    if (candidate.attemptsUsed > definition.attemptLimit) fail('INVALID_STATE', `${path}.attemptsUsed exceeds attemptLimit`);
    if (candidate.clearCount > candidate.attemptsUsed) fail('INVALID_STATE', `${path}.clearCount exceeds attemptsUsed`);
    if (candidate.lastOutcome !== null && candidate.lastOutcome !== 'LOST' && candidate.lastOutcome !== 'WON') fail('INVALID_STATE', `${path}.lastOutcome is invalid`);
    if (candidate.attemptsUsed === 0 && (candidate.clearCount !== 0 || candidate.lastOutcome !== null)) fail('INVALID_STATE', `${path} has history without an attempt`);
    if (candidate.lastOutcome === 'WON' && candidate.clearCount === 0) fail('INVALID_STATE', `${path}.WON requires a clear`);
    const expectedUnlocked = isDifficultyUnlocked(candidate.difficultyId as DungeonDifficultyId, value.difficulties as unknown as readonly DungeonDifficultyProgress[]);
    if (candidate.unlocked !== expectedUnlocked) fail('INVALID_STATE', `${path}.unlocked is not derived from dungeon clear history`);
  });
  validateRewardBalances(value.rewards, 'DUNGEON', 'state.dungeon.rewards');
  validateProcessedSettlements(value.processedSettlements, 'state.dungeon.processedSettlements', /^dungeon-(normal|hard)-[1-9]\d*$/);
}

function validateTowerState(value: unknown): asserts value is PveRewardIsolationState['tower'] {
  if (!isRecord(value)) fail('INVALID_STATE', 'state.tower must be an object');
  assertExactKeys(value, ['progress', 'rewards', 'processedSettlements'], 'state.tower');
  if (!isRecord(value.progress)) fail('INVALID_STATE', 'state.tower.progress must be an object');
  assertExactKeys(value.progress, ['currentFloor', 'bestFloor', 'clearedFloors', 'attemptsUsed', 'lastOutcome'], 'state.tower.progress');
  assertPositiveInteger(value.progress.currentFloor, 'state.tower.progress.currentFloor');
  assertNonNegativeInteger(value.progress.bestFloor, 'state.tower.progress.bestFloor');
  if (value.progress.currentFloor > TOWER_FLOOR_COUNT || value.progress.bestFloor > TOWER_FLOOR_COUNT) fail('INVALID_STATE', 'tower floor exceeds configured floor count');
  if (value.progress.currentFloor !== Math.min(TOWER_FLOOR_COUNT, value.progress.bestFloor + 1)) fail('INVALID_STATE', 'tower current floor is not derived from its best floor');
  assertDenseArray(value.progress.clearedFloors, 'state.tower.progress.clearedFloors');
  value.progress.clearedFloors.forEach((floor, index) => {
    assertPositiveInteger(floor, `state.tower.progress.clearedFloors[${index}]`);
    if (floor > TOWER_FLOOR_COUNT || floor !== index + 1) fail('INVALID_STATE', 'tower cleared floors must be contiguous');
  });
  if (value.progress.bestFloor !== value.progress.clearedFloors.length) fail('INVALID_STATE', 'tower best floor must match cleared floors');
  assertNonNegativeInteger(value.progress.attemptsUsed, 'state.tower.progress.attemptsUsed');
  if (value.progress.lastOutcome !== 'NONE' && value.progress.lastOutcome !== 'LOST' && value.progress.lastOutcome !== 'WON') fail('INVALID_STATE', 'state.tower.progress.lastOutcome is invalid');
  if (value.progress.attemptsUsed === 0 && value.progress.lastOutcome !== 'NONE') fail('INVALID_STATE', 'tower has an outcome without an attempt');
  if (value.progress.lastOutcome === 'WON' && value.progress.bestFloor === 0) fail('INVALID_STATE', 'tower WON requires a cleared floor');
  validateRewardBalances(value.rewards, 'TOWER', 'state.tower.rewards');
  validateProcessedSettlements(value.processedSettlements, 'state.tower.processedSettlements', /^tower:[1-9]\d*:[1-9]\d*$/);
}

function validateBossState(value: unknown): asserts value is PveRewardIsolationState['boss'] {
  if (!isRecord(value)) fail('INVALID_STATE', 'state.boss must be an object');
  assertExactKeys(value, ['encounters', 'rewards', 'processedSettlements'], 'state.boss');
  assertDenseArray(value.encounters, 'state.boss.encounters');
  const ids = new Set<string>();
  value.encounters.forEach((candidate, index) => {
    const path = `state.boss.encounters[${index}]`;
    if (!isRecord(candidate)) fail('INVALID_STATE', `${path} must be an object`);
    assertExactKeys(candidate, ['bossId', 'attemptsUsed', 'defeated', 'lastOutcome'], path);
    assertTrimmedString(candidate.bossId, `${path}.bossId`);
    if (RESERVED_IDS.has(candidate.bossId)) fail('INVALID_STATE', `${path}.bossId is reserved`);
    if (ids.has(candidate.bossId)) fail('INVALID_STATE', 'state.boss.encounters contains duplicate boss ids');
    ids.add(candidate.bossId);
    assertPositiveInteger(candidate.attemptsUsed, `${path}.attemptsUsed`);
    if (typeof candidate.defeated !== 'boolean') fail('INVALID_STATE', `${path}.defeated must be boolean`);
    if (candidate.lastOutcome !== 'LOST' && candidate.lastOutcome !== 'WON') fail('INVALID_STATE', `${path}.lastOutcome is invalid`);
    if (candidate.defeated !== (candidate.lastOutcome === 'WON')) fail('INVALID_STATE', `${path}.defeated does not match last outcome`);
  });
  validateRewardBalances(value.rewards, 'BOSS', 'state.boss.rewards');
  validateProcessedSettlements(value.processedSettlements, 'state.boss.processedSettlements', /^boss:[^:]+:[1-9]\d*$/);
}

export function validatePveRewardIsolationState(value: unknown): asserts value is PveRewardIsolationState {
  if (!isRecord(value)) fail('INVALID_STATE', 'PVE reward isolation state must be an object');
  assertExactKeys(value, ['schemaVersion', 'mainline', 'dungeon', 'tower', 'boss'], 'state');
  if (value.schemaVersion !== PVE_REWARD_ISOLATION_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported PVE reward isolation schema version');
  validateMainlineState(value.mainline);
  validateDungeonState(value.dungeon);
  validateTowerState(value.tower);
  validateBossState(value.boss);
}

export function serializePveRewardIsolationState(state: PveRewardIsolationState): string {
  validatePveRewardIsolationState(state);
  return JSON.stringify(state);
}

export function restorePveRewardIsolationState(serialized: string): PveRewardIsolationState {
  if (typeof serialized !== 'string' || serialized.trim().length === 0) fail('INVALID_STATE', 'PVE reward isolation save must be a non-empty string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'PVE reward isolation save is not valid JSON');
  }
  validatePveRewardIsolationState(parsed);
  return freezeDeep(clone(parsed));
}

function addRewards(balances: Record<string, number>, rewards: readonly RewardEntry[]): void {
  for (const reward of rewards) {
    const current = balances[reward.id] ?? 0;
    const next = current + reward.quantity;
    if (!Number.isSafeInteger(next)) fail('INVALID_SETTLEMENT', `reward ${reward.id} would overflow`);
    balances[reward.id] = next;
  }
}

function findProcessed(state: PveRewardIsolationState, mode: PveMode, key: string): ProcessedSettlement | undefined {
  if (mode === 'MAINLINE') return state.mainline.processedSettlements.find((entry) => entry.key === key);
  if (mode === 'DUNGEON') return state.dungeon.processedSettlements.find((entry) => entry.key === key);
  if (mode === 'TOWER') return state.tower.processedSettlements.find((entry) => entry.key === key);
  return state.boss.processedSettlements.find((entry) => entry.key === key);
}

function withProcessed(state: MutablePveRewardIsolationState, mode: PveMode, entry: ProcessedSettlement): void {
  if (mode === 'MAINLINE') state.mainline.processedSettlements.push(entry);
  else if (mode === 'DUNGEON') state.dungeon.processedSettlements.push(entry);
  else if (mode === 'TOWER') state.tower.processedSettlements.push(entry);
  else state.boss.processedSettlements.push(entry);
}

function rewardListsEqual(left: readonly RewardEntry[], right: readonly RewardEntry[]): boolean {
  return rewardEntriesEqual(
    [...left].sort((a, b) => a.id.localeCompare(b.id)),
    [...right].sort((a, b) => a.id.localeCompare(b.id)),
  );
}

function applySettlement(
  state: MutablePveRewardIsolationState,
  settlement: NormalizedSettlement,
  config: PveRewardIsolationConfig,
): void {
  if (settlement.mode === 'MAINLINE') {
    const index = state.mainline.levels.findIndex(({ levelId }) => levelId === settlement.levelId);
    const level = state.mainline.levels[index];
    if (index < 0 || level === undefined || !level.unlocked) fail('INVALID_SETTLEMENT', `mainline level ${settlement.levelId} is not unlocked`);
    const attemptNumber = Number(settlement.settlementKey.split(':')[2]);
    if (attemptNumber !== level.attemptsUsed + 1) fail('INVALID_SETTLEMENT', `mainline settlement attempt ${attemptNumber} is not the next attempt`);
    const configuredRewards = config.mainlineRewards[settlement.levelId];
    if (configuredRewards === undefined) fail('INVALID_SETTLEMENT', `mainline level ${settlement.levelId} has no reward configuration`);
    const expectedRewards = settlement.outcome === 'CLEARED' ? configuredRewards : [];
    if (!rewardListsEqual(settlement.rewards, expectedRewards)) fail('INVALID_SETTLEMENT', `mainline ${settlement.levelId} rewards do not match configuration`);
    if (level.attemptsUsed >= Number.MAX_SAFE_INTEGER) fail('INVALID_SETTLEMENT', 'mainline attempt counter would overflow');
    const nextLevel = {
      ...level,
      attemptsUsed: level.attemptsUsed + 1,
      clearCount: settlement.outcome === 'CLEARED' ? level.clearCount + 1 : level.clearCount,
      lastOutcome: settlement.outcome,
    };
    if (!Number.isSafeInteger(nextLevel.clearCount)) fail('INVALID_SETTLEMENT', 'mainline clear counter would overflow');
    state.mainline.levels[index] = nextLevel;
    if (settlement.outcome === 'CLEARED' && state.mainline.levels[index + 1] !== undefined) {
      state.mainline.levels[index + 1] = { ...state.mainline.levels[index + 1], unlocked: true };
    }
    addRewards(state.mainline.rewards, settlement.rewards);
    return;
  }

  if (settlement.mode === 'DUNGEON') {
    const index = state.dungeon.difficulties.findIndex(({ difficultyId }) => difficultyId === settlement.difficultyId);
    const difficulty = state.dungeon.difficulties[index];
    if (index < 0 || difficulty === undefined || !difficulty.unlocked) fail('INVALID_SETTLEMENT', `dungeon difficulty ${settlement.difficultyId} is not unlocked`);
    const attemptNumber = Number(settlement.settlementKey.split('-')[2]);
    if (attemptNumber !== difficulty.attemptsUsed + 1) fail('INVALID_SETTLEMENT', `dungeon settlement attempt ${attemptNumber} is not the next attempt`);
    const definition = DEFAULT_DUNGEON_DIFFICULTY_CONFIG[index];
    const expectedRewards = settlement.outcome === 'LOST'
      ? []
      : (difficulty.clearCount === 0 ? definition.firstClearRewards : definition.repeatClearRewards);
    const expected = expectedRewards.map(({ id, quantity }) => ({ id, quantity })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
    if (!rewardEntriesEqual(settlement.rewards, expected)) fail('INVALID_SETTLEMENT', `dungeon ${settlement.difficultyId} rewards do not match configuration`);
    if (difficulty.attemptsUsed >= definition.attemptLimit) fail('INVALID_SETTLEMENT', `dungeon ${settlement.difficultyId} attempts are exhausted`);
    state.dungeon.difficulties[index] = {
      ...difficulty,
      attemptsUsed: difficulty.attemptsUsed + 1,
      clearCount: settlement.outcome === 'WON' ? difficulty.clearCount + 1 : difficulty.clearCount,
      lastOutcome: settlement.outcome,
    };
    if (settlement.outcome === 'WON' && state.dungeon.difficulties[index + 1] !== undefined) {
      const nextDifficulty = state.dungeon.difficulties[index + 1];
      if (nextDifficulty.difficultyId === 'HARD') state.dungeon.difficulties[index + 1] = { ...nextDifficulty, unlocked: true };
    }
    addRewards(state.dungeon.rewards, settlement.rewards);
    return;
  }

  if (settlement.mode === 'TOWER') {
    const progress = state.tower.progress;
    const attemptNumber = Number(settlement.settlementKey.split(':')[2]);
    if (attemptNumber !== progress.attemptsUsed + 1) fail('INVALID_SETTLEMENT', `tower settlement attempt ${attemptNumber} is not the next attempt`);
    if (settlement.floor !== progress.currentFloor) fail('INVALID_SETTLEMENT', `tower floor ${settlement.floor} is not the current floor`);
    const coinDrop = settlement.outcome === 'WON' ? towerCoinDropAtFloor(towerShopConfig, settlement.floor) : null;
    const expected = coinDrop === null ? [] : [{ id: 'tower-coin', quantity: coinDrop.amount }];
    if (!rewardEntriesEqual(settlement.rewards, expected)) fail('INVALID_SETTLEMENT', 'tower rewards do not match the configured floor drop');
    if (progress.attemptsUsed >= Number.MAX_SAFE_INTEGER) fail('INVALID_SETTLEMENT', 'tower attempt counter would overflow');
    const nextClearedFloors = settlement.outcome === 'WON'
      ? [...progress.clearedFloors, settlement.floor]
      : [...progress.clearedFloors];
    state.tower.progress = {
      currentFloor: settlement.outcome === 'WON' ? Math.min(TOWER_FLOOR_COUNT, settlement.floor + 1) : settlement.floor,
      bestFloor: settlement.outcome === 'WON' ? Math.max(progress.bestFloor, settlement.floor) : progress.bestFloor,
      clearedFloors: nextClearedFloors,
      attemptsUsed: progress.attemptsUsed + 1,
      lastOutcome: settlement.outcome,
    };
    addRewards(state.tower.rewards, settlement.rewards);
    return;
  }

  const bossDefinition = config.bosses.find(({ config: candidate }) => candidate.id === settlement.bossId);
  if (bossDefinition === undefined) fail('INVALID_SETTLEMENT', `boss ${settlement.bossId} is not configured`);
  const attemptNumber = Number(settlement.settlementKey.split(':')[2]);
  const existing = state.boss.encounters.find(({ bossId }) => bossId === settlement.bossId);
  if (existing?.defeated === true) fail('INVALID_SETTLEMENT', `boss ${settlement.bossId} is already defeated`);
  if (existing !== undefined && attemptNumber !== existing.attemptsUsed + 1) fail('INVALID_SETTLEMENT', `boss settlement attempt ${attemptNumber} is not the next attempt`);
  const expectedBossRewards = settlement.outcome === 'WON' ? bossDefinition.rewards : [];
  if (!rewardListsEqual(settlement.rewards, expectedBossRewards)) fail('INVALID_SETTLEMENT', `boss ${settlement.bossId} rewards do not match configuration`);
  if (existing === undefined) {
    state.boss.encounters.push({
      bossId: settlement.bossId,
      attemptsUsed: 1,
      defeated: settlement.outcome === 'WON',
      lastOutcome: settlement.outcome,
    });
  } else {
    const index = state.boss.encounters.indexOf(existing);
    state.boss.encounters[index] = {
      ...existing,
      attemptsUsed: existing.attemptsUsed + 1,
      defeated: settlement.outcome === 'WON',
      lastOutcome: settlement.outcome,
    };
  }
  addRewards(state.boss.rewards, settlement.rewards);
}

function result(service: PveRewardIsolationService, code: PveRewardIsolationResultCode, applied: boolean): PveRewardIsolationResult {
  return Object.freeze({ applied, code, state: service.snapshot() });
}

export class PveRewardIsolationService {
  private current: PveRewardIsolationState;
  private readonly persist: PveRewardIsolationPersistence;
  private readonly config: PveRewardIsolationConfig;
  private committing = false;

  constructor(
    initialState: PveRewardIsolationState | string = createPveRewardIsolationState(),
    persist: PveRewardIsolationPersistence = () => {},
    config?: PveRewardIsolationConfig,
  ) {
    if (typeof persist !== 'function') fail('INVALID_STATE', 'PVE reward isolation persistence must be a function');
    if (config === undefined) fail('INVALID_STATE', 'PVE reward isolation config is required');
    this.config = loadPveRewardIsolationConfig(config);
    if (typeof initialState === 'string') this.current = restorePveRewardIsolationState(initialState);
    else {
      validatePveRewardIsolationState(initialState);
      this.current = freezeDeep(clone(initialState));
    }
    this.persist = persist;
  }

  snapshot(): PveRewardIsolationState {
    return this.current;
  }

  save(): string {
    return serializePveRewardIsolationState(this.current);
  }

  restore(serialized: string): PveRewardIsolationState {
    const next = restorePveRewardIsolationState(serialized);
    this.current = next;
    return this.current;
  }

  settle(candidate: unknown): PveRewardIsolationResult {
    if (this.committing) return result(this, 'PERSISTENCE_REENTRANT', false);
    const settlement = normalizeSettlement(candidate);
    if (settlement === null) return result(this, 'INVALID', false);
    const fingerprint = canonical(settlement);
    const processed = findProcessed(this.current, settlement.mode, settlement.settlementKey);
    if (processed !== undefined) {
      return result(this, processed.fingerprint === fingerprint ? 'DUPLICATE' : 'CONFLICT', false);
    }

    const mutable = clone(this.current) as unknown as MutablePveRewardIsolationState;
    try {
      applySettlement(mutable, settlement, this.config);
      withProcessed(mutable, settlement.mode, { key: settlement.settlementKey, fingerprint });
      validatePveRewardIsolationState(mutable);
    } catch (error) {
      if (error instanceof PveRewardIsolationError && error.code === 'INVALID_SETTLEMENT') return result(this, 'INVALID', false);
      return result(this, 'INVALID', false);
    }
    const next = freezeDeep(mutable);
    this.committing = true;
    try {
      this.persist(serializePveRewardIsolationState(next));
    } catch {
      return result(this, 'PERSIST_FAILED', false);
    } finally {
      this.committing = false;
    }
    this.current = next;
    return result(this, 'APPLIED', true);
  }
}

export const DEFAULT_PVE_REWARD_ISOLATION_STATE = createPveRewardIsolationState();
