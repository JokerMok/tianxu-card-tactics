import {
  createReputationCatalog,
  type ReputationCatalog,
} from '../Reputation.ts';
import {
  loadReputationCatalog,
  type ReputationMetadataAuthority,
} from '../ReputationCatalogLoader.ts';
import { REPUTATION_CATALOG_DATA } from '../ReputationCatalogData.ts';
import { REPUTATION_SHOP_CATALOG_DATA, type ReputationShopCatalogData } from './ReputationShopCatalogData.ts';
import {
  assertReputationShopCatalogSkeleton,
  assertReputationShopProductionIntegrity,
} from './ReputationShopCatalogIntegrity.ts';
import {
  loadReputationShopConfig,
  type ReputationShopConfig,
} from './ReputationShopConfig.ts';

export interface ReputationShopMetadataAuthority extends ReputationMetadataAuthority {}

export function loadReputationShopProduction(
  metadata: ReputationShopMetadataAuthority,
  data: ReputationShopCatalogData = REPUTATION_SHOP_CATALOG_DATA,
): ReputationShopConfig {
  const reputationCatalog = loadReputationCatalog(metadata, REPUTATION_CATALOG_DATA);
  assertReputationShopProductionIntegrity(data);
  const config = loadReputationShopConfig(data, reputationCatalog);
  assertReputationShopCatalogSkeleton(config);
  return config;
}

export function createDefaultReputationShopCatalog(): ReputationCatalog {
  return createReputationCatalog(REPUTATION_CATALOG_DATA);
}

export const reputationShopConfig = loadReputationShopConfig(
  REPUTATION_SHOP_CATALOG_DATA,
  createDefaultReputationShopCatalog(),
);

export function loadCustomReputationShopConfig(
  value: unknown,
  catalog: ReputationCatalog = createDefaultReputationShopCatalog(),
): ReputationShopConfig {
  return loadReputationShopConfig(value, catalog);
}
