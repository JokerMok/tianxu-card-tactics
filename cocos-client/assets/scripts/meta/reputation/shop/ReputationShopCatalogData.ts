import { REPUTATION_CATALOG_DATA } from '../ReputationCatalogData.ts';
import {
  REPUTATION_SHOP_CURRENCY_ID,
  REPUTATION_SHOP_OFFER_COUNT,
  REPUTATION_SHOP_REFRESH_COST,
  REPUTATION_SHOP_SCHEMA_VERSION,
  type ReputationShopConfig,
} from './ReputationShopConfig.ts';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const LEVEL_COSTS = [10, 20, 40, 80] as const;

const items = REPUTATION_CATALOG_DATA.tracks.flatMap((track) => track.levels.map((level) => ({
  id: `REP_SHOP_${track.id}_L${level.level}`,
  trackId: track.id,
  requiredLevel: level.level,
  cost: LEVEL_COSTS[level.level - 1],
  purchaseLimit: 1,
  reward: {
    kind: 'REPUTATION_REWARD' as const,
    id: level.rewardIds[0],
    quantity: 1,
  },
})));

export const REPUTATION_SHOP_CATALOG_DATA: ReputationShopConfig = deepFreeze({
  schemaVersion: REPUTATION_SHOP_SCHEMA_VERSION,
  currencyId: REPUTATION_SHOP_CURRENCY_ID,
  refreshCost: REPUTATION_SHOP_REFRESH_COST,
  offerCount: REPUTATION_SHOP_OFFER_COUNT,
  items,
});

export type ReputationShopCatalogData = typeof REPUTATION_SHOP_CATALOG_DATA;
