import { DAILY_REWARDS_CONFIG } from './DailyRewardsData.ts';
import type { DailyRewardCatalogConfig } from './DailyRewards.ts';

function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>).sort(compare).map((key) => [key, stableValue((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function canonical(value: DailyRewardCatalogConfig): string {
  return JSON.stringify(stableValue({
    schemaVersion: value.schemaVersion,
    dailySelectionCount: value.dailySelectionCount,
    makeupWindowDays: value.makeupWindowDays,
    makeupCreditsPerWeek: value.makeupCreditsPerWeek,
    tasks: [...value.tasks].sort((a, b) => compare(a.id, b.id)).map(stableValue),
    rewards: [...value.rewards].sort((a, b) => compare(a.id, b.id)).map(stableValue),
    activeRewards: [...value.activeRewards].sort((a, b) => compare(a.id, b.id)).map(stableValue),
    onlineRewards: [...value.onlineRewards].sort((a, b) => compare(a.id, b.id)).map(stableValue),
  }));
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

export function dailyRewardCatalogDigest(value: DailyRewardCatalogConfig): string { return fnv1a(canonical(value)); }

export interface DailyRewardCatalogSkeleton {
  readonly taskIds: readonly string[];
  readonly dailyTaskIds: readonly string[];
  readonly weeklyTaskIds: readonly string[];
  readonly rewardIds: readonly string[];
  readonly activeRewardIds: readonly string[];
  readonly onlineRewardIds: readonly string[];
}

export interface DailyRewardCatalogDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

function skeletonOf(value: DailyRewardCatalogConfig): DailyRewardCatalogSkeleton {
  return {
    taskIds: [...value.tasks].map((task) => task.id).sort(compare),
    dailyTaskIds: [...value.tasks].filter((task) => task.cycle === 'DAILY').map((task) => task.id).sort(compare),
    weeklyTaskIds: [...value.tasks].filter((task) => task.cycle === 'WEEKLY').map((task) => task.id).sort(compare),
    rewardIds: [...value.rewards].map((reward) => reward.id).sort(compare),
    activeRewardIds: [...value.activeRewards].map((reward) => reward.id).sort(compare),
    onlineRewardIds: [...value.onlineRewards].map((reward) => reward.id).sort(compare),
  };
}

export const DAILY_REWARDS_PRODUCTION_SKELETON: DailyRewardCatalogSkeleton = Object.freeze(skeletonOf(DAILY_REWARDS_CONFIG));
export const DAILY_REWARDS_PRODUCTION_DIGEST = '3eb87f24' as const;

function listDiff(expected: readonly string[], actual: readonly string[]): { added: string[]; removed: string[] } {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  return { added: actual.filter((item) => !expectedSet.has(item)), removed: expected.filter((item) => !actualSet.has(item)) };
}

export function diffDailyRewardConfig(expected: DailyRewardCatalogConfig, actual: DailyRewardCatalogConfig): DailyRewardCatalogDiff {
  const expectedSkeleton = skeletonOf(expected);
  const actualSkeleton = skeletonOf(actual);
  const added: string[] = [];
  const removed: string[] = [];
  for (const key of ['taskIds', 'rewardIds', 'activeRewardIds', 'onlineRewardIds'] as const) {
    const diff = listDiff(expectedSkeleton[key], actualSkeleton[key]);
    added.push(...diff.added.map((id) => `${key}:${id}`));
    removed.push(...diff.removed.map((id) => `${key}:${id}`));
  }
  const changed: string[] = [];
  const expectedById = new Map([...expected.tasks, ...expected.rewards, ...expected.activeRewards, ...expected.onlineRewards].map((item) => [item.id, JSON.stringify(stableValue(item))]));
  const actualById = new Map([...actual.tasks, ...actual.rewards, ...actual.activeRewards, ...actual.onlineRewards].map((item) => [item.id, JSON.stringify(stableValue(item))]));
  for (const id of [...expectedById.keys()].sort(compare)) if (expectedById.has(id) && actualById.has(id) && expectedById.get(id) !== actualById.get(id)) changed.push(id);
  return Object.freeze({ added: Object.freeze(added.sort(compare)), removed: Object.freeze(removed.sort(compare)), changed: Object.freeze(changed.sort(compare)) });
}

export function assertDailyRewardCatalogSkeleton(value: DailyRewardCatalogConfig): void {
  if (JSON.stringify(skeletonOf(value)) !== JSON.stringify(DAILY_REWARDS_PRODUCTION_SKELETON)) {
    const diff = diffDailyRewardConfig(DAILY_REWARDS_CONFIG, value);
    throw new Error(`daily reward catalog skeleton mismatch: +${diff.added.join(',')} -${diff.removed.join(',')} ~${diff.changed.join(',')}`);
  }
}

export function assertDailyRewardProductionIntegrity(value: DailyRewardCatalogConfig = DAILY_REWARDS_CONFIG): void {
  if (dailyRewardCatalogDigest(value) !== DAILY_REWARDS_PRODUCTION_DIGEST) throw new Error('daily reward production catalog integrity digest mismatch');
  assertDailyRewardCatalogSkeleton(value);
}
