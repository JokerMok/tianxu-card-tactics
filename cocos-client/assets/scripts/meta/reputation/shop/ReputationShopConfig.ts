import {
  REPUTATION_LEVELS,
  ReputationCatalog,
  type ReputationCatalogConfig,
  type ReputationLevel,
} from '../Reputation.ts';

export const REPUTATION_SHOP_SCHEMA_VERSION = 1 as const;
export const REPUTATION_SHOP_CURRENCY_ID = 'REPUTATION_TOKEN' as const;
export const REPUTATION_SHOP_REFRESH_COST = 5 as const;
export const REPUTATION_SHOP_OFFER_COUNT = 4 as const;

export type ReputationShopRewardKind = 'REPUTATION_REWARD';

export interface ReputationShopReward {
  readonly kind: ReputationShopRewardKind;
  readonly id: string;
  readonly quantity: number;
}

export interface ReputationShopItem {
  readonly id: string;
  readonly trackId: string;
  readonly requiredLevel: ReputationLevel;
  readonly cost: number;
  readonly purchaseLimit: number;
  readonly reward: ReputationShopReward;
}

export interface ReputationShopConfig {
  readonly schemaVersion: typeof REPUTATION_SHOP_SCHEMA_VERSION;
  readonly currencyId: typeof REPUTATION_SHOP_CURRENCY_ID;
  readonly refreshCost: number;
  readonly offerCount: number;
  readonly items: readonly ReputationShopItem[];
}

export class ReputationShopConfigError extends Error {
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(`声望商店配置无效 [${configPath}] ${message}`);
    this.name = 'ReputationShopConfigError';
    this.configPath = configPath;
  }
}

const CONFIG_KEYS = ['schemaVersion', 'currencyId', 'refreshCost', 'offerCount', 'items'] as const;
const ITEM_KEYS = ['id', 'trackId', 'requiredLevel', 'cost', 'purchaseLimit', 'reward'] as const;
const REWARD_KEYS = ['kind', 'id', 'quantity'] as const;
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new ReputationShopConfigError(path, message);
}

function assertPlainRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(path, '必须是普通 object');
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Reflect.ownKeys(record);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail(path, `只允许字段 ${keys.join('、')}`);
  }
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(record, key)) fail(`${path}.${key}`, '缺少必需字段');
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(path, '必须是正整数');
  return value as number;
}

function idValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(path, '必须是非空且无首尾空格的 string');
  if (RESERVED_IDS.has(value)) fail(path, '不得使用 JavaScript 保留键');
  return value;
}

function parseReward(value: unknown, path: string): ReputationShopReward {
  assertPlainRecord(value, path);
  assertExactKeys(value, REWARD_KEYS, path);
  if (value.kind !== 'REPUTATION_REWARD') fail(`${path}.kind`, '奖励类型无效');
  return {
    kind: 'REPUTATION_REWARD',
    id: idValue(value.id, `${path}.id`),
    quantity: positiveInteger(value.quantity, `${path}.quantity`),
  };
}

function parseItem(value: unknown, index: number): ReputationShopItem {
  const path = `config.items[${index}]`;
  assertPlainRecord(value, path);
  assertExactKeys(value, ITEM_KEYS, path);
  const requiredLevel = value.requiredLevel;
  if (!REPUTATION_LEVELS.includes(requiredLevel as ReputationLevel)) fail(`${path}.requiredLevel`, '声望等级无效');
  return {
    id: idValue(value.id, `${path}.id`),
    trackId: idValue(value.trackId, `${path}.trackId`),
    requiredLevel: requiredLevel as ReputationLevel,
    cost: positiveInteger(value.cost, `${path}.cost`),
    purchaseLimit: positiveInteger(value.purchaseLimit, `${path}.purchaseLimit`),
    reward: parseReward(value.reward, `${path}.reward`),
  };
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

export function loadReputationShopConfig(
  value: unknown,
  catalog: ReputationCatalog,
): ReputationShopConfig {
  assertPlainRecord(value, 'config');
  assertExactKeys(value, CONFIG_KEYS, 'config');
  if (value.schemaVersion !== REPUTATION_SHOP_SCHEMA_VERSION) fail('config.schemaVersion', '版本不支持');
  if (value.currencyId !== REPUTATION_SHOP_CURRENCY_ID) fail('config.currencyId', '货币类型无效');
  const refreshCost = positiveInteger(value.refreshCost, 'config.refreshCost');
  const offerCount = positiveInteger(value.offerCount, 'config.offerCount');
  if (!Array.isArray(value.items) || value.items.length < offerCount) fail('config.items', '商品数量必须不少于展示槽位');
  const items = value.items.map(parseItem);
  const itemIds = new Set<string>();
  for (const item of items) {
    if (itemIds.has(item.id)) fail(`config.items.${item.id}`, '商品 ID 不得重复');
    itemIds.add(item.id);
    let track;
    try {
      track = catalog.getTrack(item.trackId);
    } catch (error) {
      fail(`config.items.${item.id}.trackId`, error instanceof Error ? error.message : String(error));
    }
    const level = track.levels[item.requiredLevel - 1];
    if (level === undefined) fail(`config.items.${item.id}.requiredLevel`, '声望等级不存在');
    if (!level.rewardIds.includes(item.reward.id)) {
      fail(`config.items.${item.id}.reward.id`, '奖励必须来自绑定声望等级');
    }
  }
  return freezeDeep({
    schemaVersion: REPUTATION_SHOP_SCHEMA_VERSION,
    currencyId: REPUTATION_SHOP_CURRENCY_ID,
    refreshCost,
    offerCount,
    items: items.sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  });
}

export function serializeReputationShopConfig(config: ReputationShopConfig): string {
  return JSON.stringify(config);
}

export function restoreReputationShopConfig(serialized: string, catalog: ReputationCatalog): ReputationShopConfig {
  if (typeof serialized !== 'string' || serialized.trim().length === 0) fail('config', '保存内容不能为空');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('config', '保存内容不是合法 JSON');
  }
  return loadReputationShopConfig(parsed, catalog);
}

export function validateReputationShopCrossTable(
  config: ReputationShopConfig,
  catalog: ReputationCatalog | ReputationCatalogConfig,
): void {
  const resolvedCatalog = catalog instanceof ReputationCatalog
    ? catalog
    : new ReputationCatalog(catalog as ReputationCatalogConfig);
  for (const item of config.items) {
    const track = resolvedCatalog.getTrack(item.trackId);
    const level = track.levels[item.requiredLevel - 1];
    if (level === undefined || !level.rewardIds.includes(item.reward.id)) {
      fail(`config.items.${item.id}`, '商品与声望轨道跨表绑定无效');
    }
  }
}
