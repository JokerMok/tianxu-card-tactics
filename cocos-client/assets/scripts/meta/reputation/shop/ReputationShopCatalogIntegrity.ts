import { REPUTATION_SHOP_CATALOG_DATA, type ReputationShopCatalogData } from './ReputationShopCatalogData.ts';
import type { ReputationShopConfig } from './ReputationShopConfig.ts';

export const EXPECTED_REPUTATION_SHOP_ITEM_COUNT = 44 as const;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonical(value: ReputationShopConfig): string {
  return JSON.stringify({
    schemaVersion: value.schemaVersion,
    currencyId: value.currencyId,
    refreshCost: value.refreshCost,
    offerCount: value.offerCount,
    items: [...value.items].map((item) => ({
      id: item.id,
      trackId: item.trackId,
      requiredLevel: item.requiredLevel,
      cost: item.cost,
      purchaseLimit: item.purchaseLimit,
      reward: { ...item.reward },
    })).sort((left, right) => compare(left.id, right.id)),
  });
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function reputationShopCatalogDigest(value: ReputationShopConfig): string {
  return fnv1a(canonical(value));
}

// Literal on purpose: changing the production shop requires an intentional integrity update.
export const REPUTATION_SHOP_PRODUCTION_DIGEST = 'e8855ee2' as const;

export interface ReputationShopSkeleton {
  readonly itemIds: readonly string[];
  readonly bindings: readonly string[];
}

function skeletonOf(value: ReputationShopConfig): ReputationShopSkeleton {
  return {
    itemIds: [...value.items].map(({ id }) => id).sort(compare),
    bindings: [...value.items].map((item) => `${item.id}->${item.trackId}@${item.requiredLevel}:${item.reward.id}`).sort(compare),
  };
}

export const REPUTATION_SHOP_PRODUCTION_SKELETON: ReputationShopSkeleton = Object.freeze(skeletonOf(REPUTATION_SHOP_CATALOG_DATA));

export interface ReputationShopCatalogDiff {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly changed: readonly string[];
}

export function diffReputationShopCatalogData(
  expected: ReputationShopConfig,
  actual: ReputationShopConfig,
): ReputationShopCatalogDiff {
  const expectedSkeleton = skeletonOf(expected);
  const actualSkeleton = skeletonOf(actual);
  const expectedIds = new Set(expectedSkeleton.itemIds);
  const actualIds = new Set(actualSkeleton.itemIds);
  const added = actualSkeleton.itemIds.filter((id) => !expectedIds.has(id));
  const removed = expectedSkeleton.itemIds.filter((id) => !actualIds.has(id));
  const expectedById = new Map(expected.items.map((item) => [item.id, JSON.stringify(item)]));
  const actualById = new Map(actual.items.map((item) => [item.id, JSON.stringify(item)]));
  const changed = expectedSkeleton.itemIds
    .filter((id) => expectedById.has(id) && actualById.has(id) && expectedById.get(id) !== actualById.get(id))
    .map((id) => `item:${id}`);
  if (expected.refreshCost !== actual.refreshCost) changed.push('refreshCost');
  if (expected.offerCount !== actual.offerCount) changed.push('offerCount');
  return Object.freeze({
    added: Object.freeze([...added].sort(compare)),
    removed: Object.freeze([...removed].sort(compare)),
    changed: Object.freeze([...changed].sort(compare)),
  });
}

export function assertReputationShopCatalogSkeleton(value: ReputationShopConfig): void {
  const actual = skeletonOf(value);
  if (JSON.stringify(actual) !== JSON.stringify(REPUTATION_SHOP_PRODUCTION_SKELETON)) {
    const diff = diffReputationShopCatalogData(REPUTATION_SHOP_CATALOG_DATA, value);
    throw new Error(`reputation shop skeleton mismatch: +${diff.added.join(',')} -${diff.removed.join(',')} ~${diff.changed.join(',')}`);
  }
}

export function assertReputationShopProductionIntegrity(data: ReputationShopCatalogData | ReputationShopConfig): void {
  if (data.items.length !== EXPECTED_REPUTATION_SHOP_ITEM_COUNT) throw new Error('reputation shop production item count mismatch');
  if (reputationShopCatalogDigest(data) !== REPUTATION_SHOP_PRODUCTION_DIGEST) {
    throw new Error('reputation shop production catalog integrity digest mismatch');
  }
  assertReputationShopCatalogSkeleton(data);
}
