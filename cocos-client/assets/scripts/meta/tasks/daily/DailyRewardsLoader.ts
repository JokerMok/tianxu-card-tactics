import { DAILY_REWARDS_CONFIG } from './DailyRewardsData.ts';
import { assertDailyRewardCatalogSkeleton, assertDailyRewardProductionIntegrity } from './DailyRewardsIntegrity.ts';
import { DailyRewardCatalog, DailyRewardError, type DailyRewardCatalogConfig, type DailyRewardMetadataAuthority } from './DailyRewards.ts';

function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function rows(value: unknown, key: string): readonly Record<string, unknown>[] {
  const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value[key]) ? value[key] : null;
  if (!list) throw new DailyRewardError('INVALID_CONFIG', `metadata ${key} must contain an array`);
  if (list.some((item) => !isRecord(item))) throw new DailyRewardError('INVALID_CONFIG', `metadata ${key} contains a non-object row`);
  return list as readonly Record<string, unknown>[];
}

function ids(value: unknown, key: string): Set<string> {
  const primitiveRows = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value[key]) ? value[key] : null;
  if (primitiveRows && primitiveRows.every((row) => typeof row === 'string')) return new Set(primitiveRows as string[]);
  return new Set(rows(value, key).map((row, index) => {
    if (typeof row.id !== 'string' || row.id.length === 0) throw new DailyRewardError('INVALID_CONFIG', `metadata ${key}[${index}].id is invalid`);
    return row.id;
  }));
}

function tableMetadata(metadata: DailyRewardMetadataAuthority, tableName: string): unknown {
  if (metadata.tables && tableName in metadata.tables) return metadata.tables[tableName];
  if (tableName in metadata) return metadata[tableName];
  return undefined;
}

export function validateDailyRewardCrossTable(metadata: DailyRewardMetadataAuthority, data: DailyRewardCatalogConfig = DAILY_REWARDS_CONFIG): void {
  const resourceIds = ids(metadata.resources, 'resources');
  for (const [index, reward] of data.rewards.entries()) if (!resourceIds.has(reward.resourceId)) throw new DailyRewardError('INVALID_CONFIG', `rewards[${index}].resourceId is not registered: ${reward.resourceId}`);
  for (const [index, task] of data.tasks.entries()) {
    if (task.trigger.sourceTable === undefined) continue;
    const table = tableMetadata(metadata, task.trigger.sourceTable);
    if (table === undefined) throw new DailyRewardError('INVALID_CONFIG', `tasks[${index}].trigger source table is missing: ${task.trigger.sourceTable}`);
    if (!ids(table, task.trigger.sourceTable).has(task.trigger.sourceId!)) throw new DailyRewardError('INVALID_CONFIG', `tasks[${index}].trigger source is missing: ${task.trigger.sourceId}`);
  }
}

export function loadDailyRewardCatalog(metadata: DailyRewardMetadataAuthority, data: DailyRewardCatalogConfig = DAILY_REWARDS_CONFIG): DailyRewardCatalog {
  try {
    if (data === DAILY_REWARDS_CONFIG) assertDailyRewardProductionIntegrity(data);
    const catalog = new DailyRewardCatalog(data);
    assertDailyRewardCatalogSkeleton(catalog.config);
    validateDailyRewardCrossTable(metadata, catalog.config);
    return catalog;
  } catch (error) {
    if (error instanceof DailyRewardError) throw error;
    throw new DailyRewardError('INVALID_CONFIG', error instanceof Error ? error.message : String(error), error);
  }
}
