import {
  CAMPAIGN_LEVEL_IDS,
  type CampaignLevelId,
} from '../../../meta/campaign/CampaignState.ts';
import {
  validateBossConfig,
  type BossConfig,
} from '../../../core/boss/index.ts';
import type { RewardEntry } from './PveRewardIsolationService.ts';

export const PVE_REWARD_ISOLATION_CONFIG_SCHEMA_VERSION = 1 as const;

export interface PveBossRewardDefinition {
  readonly config: BossConfig;
  readonly rewards: readonly RewardEntry[];
}

export interface PveRewardIsolationConfig {
  readonly schemaVersion: typeof PVE_REWARD_ISOLATION_CONFIG_SCHEMA_VERSION;
  readonly mainlineRewards: Readonly<Record<CampaignLevelId, readonly RewardEntry[]>>;
  readonly bosses: readonly PveBossRewardDefinition[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(`invalid PVE reward isolation config: ${message}`);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
    fail(`${path} contains unexpected or missing fields`);
  }
}

function trimmedString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(`${path} must be a trimmed non-empty string`);
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(`${path} must be a positive safe integer`);
  return value as number;
}

function rewardList(value: unknown, path: string): readonly RewardEntry[] {
  if (!Array.isArray(value)) fail(`${path} must be an array`);
  const ids = new Set<string>();
  return Object.freeze(value.map((candidate, index) => {
    const itemPath = `${path}[${index}]`;
    if (!isRecord(candidate)) fail(`${itemPath} must be an object`);
    exactKeys(candidate, ['id', 'quantity'], itemPath);
    const id = trimmedString(candidate.id, `${itemPath}.id`);
    if (ids.has(id)) fail(`${path} contains duplicate reward id ${id}`);
    ids.add(id);
    return Object.freeze({ id, quantity: positiveInteger(candidate.quantity, `${itemPath}.quantity`) });
  }));
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clone(item)])) as T;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

export function loadPveRewardIsolationConfig(value: unknown): PveRewardIsolationConfig {
  if (!isRecord(value)) fail('root must be an object');
  exactKeys(value, ['schemaVersion', 'mainlineRewards', 'bosses'], 'config');
  if (value.schemaVersion !== PVE_REWARD_ISOLATION_CONFIG_SCHEMA_VERSION) fail('unsupported schemaVersion');

  if (!isRecord(value.mainlineRewards)) fail('config.mainlineRewards must be an object');
  exactKeys(value.mainlineRewards, [...CAMPAIGN_LEVEL_IDS], 'config.mainlineRewards');
  const mainlineRewards = Object.fromEntries(CAMPAIGN_LEVEL_IDS.map((levelId) => [
    levelId,
    rewardList(value.mainlineRewards?.[levelId], `config.mainlineRewards.${levelId}`),
  ])) as Record<CampaignLevelId, readonly RewardEntry[]>;

  if (!Array.isArray(value.bosses)) fail('config.bosses must be an array');
  const bossIds = new Set<string>();
  const bosses = value.bosses.map((candidate, index) => {
    const path = `config.bosses[${index}]`;
    if (!isRecord(candidate)) fail(`${path} must be an object`);
    exactKeys(candidate, ['config', 'rewards'], path);
    const config = validateBossConfig(candidate.config, `${path}.config`);
    if (bossIds.has(config.id)) fail(`${path}.config.id is duplicated`);
    bossIds.add(config.id);
    return { config, rewards: rewardList(candidate.rewards, `${path}.rewards`) };
  });

  return freezeDeep({
    schemaVersion: PVE_REWARD_ISOLATION_CONFIG_SCHEMA_VERSION,
    mainlineRewards: clone(mainlineRewards),
    bosses,
  });
}
