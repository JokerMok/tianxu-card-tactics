import { TOWER_FLOOR_COUNT } from '../TowerConfig.ts';

export const TOWER_SHOP_SCHEMA_VERSION = 2 as const;

export type TowerShopRewardKind = 'ORNAMENT' | 'ITEM';

export interface TowerShopReward {
  readonly kind: TowerShopRewardKind;
  readonly id: string;
  readonly quantity: number;
}

export interface TowerShopItem {
  readonly id: string;
  readonly cost: number;
  readonly purchaseLimit: number;
  readonly reward: TowerShopReward;
}

export interface TowerCoinDrop {
  readonly floor: number;
  readonly amount: number;
}

export interface TowerShopConfig {
  readonly schemaVersion: typeof TOWER_SHOP_SCHEMA_VERSION;
  readonly towerFloorCount: typeof TOWER_FLOOR_COUNT;
  readonly guaranteedCoinDrops: readonly TowerCoinDrop[];
  readonly refreshCost: number;
  readonly offerCount: number;
  readonly items: readonly TowerShopItem[];
}

const REWARD_KINDS: readonly TowerShopRewardKind[] = ['ORNAMENT', 'ITEM'];
const RESERVED_CONFIG_IDS = new Set(['__proto__', 'constructor', 'prototype']);

const DEFAULT_COIN_DROPS: readonly TowerCoinDrop[] = Object.freeze([
  { floor: 5, amount: 20 },
  { floor: 10, amount: 25 },
  { floor: 15, amount: 30 },
  { floor: 20, amount: 35 },
  { floor: 25, amount: 40 },
  { floor: 30, amount: 45 },
  { floor: 35, amount: 50 },
  { floor: 40, amount: 60 },
  { floor: 45, amount: 70 },
  { floor: 50, amount: 90 },
]);

const DEFAULT_ITEMS: readonly TowerShopItem[] = Object.freeze([
  {
    id: 'TOWER_ORNAMENT_IRON',
    cost: 40,
    purchaseLimit: 2,
    reward: { kind: 'ORNAMENT', id: 'ORNAMENT_IRON_CHARM', quantity: 1 },
  },
  {
    id: 'TOWER_ITEM_REINFORCER',
    cost: 60,
    purchaseLimit: 3,
    reward: { kind: 'ITEM', id: 'TOWER_REINFORCER', quantity: 1 },
  },
  {
    id: 'TOWER_RELIC_EMBLEM',
    cost: 90,
    purchaseLimit: 1,
    reward: { kind: 'ORNAMENT', id: 'TOWER_RELIC_EMBLEM', quantity: 1 },
  },
  {
    id: 'TOWER_MATERIAL_CACHE',
    cost: 25,
    purchaseLimit: 5,
    reward: { kind: 'ITEM', id: 'TOWER_MATERIAL', quantity: 3 },
  },
  {
    id: 'TOWER_ORNAMENT_JADE',
    cost: 120,
    purchaseLimit: 1,
    reward: { kind: 'ORNAMENT', id: 'ORNAMENT_JADE_SEAL', quantity: 1 },
  },
]);

export const TOWER_COIN_DROP_FLOORS = Object.freeze(DEFAULT_COIN_DROPS.map(({ floor }) => floor));
export const TOWER_SHOP_REFRESH_COST = 10;
export const TOWER_SHOP_OFFER_COUNT = 3;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new TowerShopConfigError(`${path}: ${message}`);
}

function assertPlainRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail(path, '必须是普通 object');
  }
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Reflect.ownKeys(record);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail(path, `只允许字段 ${keys.join('、')}`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) fail(`${path}.${key}`, '缺少必需字段');
  }
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) fail(path, '必须是正整数');
  return value as number;
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(path, '必须是非空且无首尾空格的 string');
  return value;
}

function configId(value: unknown, path: string): string {
  const id = stringValue(value, path);
  if (RESERVED_CONFIG_IDS.has(id)) fail(path, '不得使用 JavaScript 保留键');
  return id;
}

function parseReward(value: unknown, path: string): TowerShopReward {
  assertPlainRecord(value, path);
  assertExactKeys(value, ['kind', 'id', 'quantity'], path);
  if (!REWARD_KINDS.includes(value.kind as TowerShopRewardKind)) fail(`${path}.kind`, '奖励类型无效');
  return {
    kind: value.kind as TowerShopRewardKind,
    id: configId(value.id, `${path}.id`),
    quantity: positiveInteger(value.quantity, `${path}.quantity`),
  };
}

function parseCoinDrops(value: unknown): TowerCoinDrop[] {
  if (!Array.isArray(value) || value.length === 0) fail('config.guaranteedCoinDrops', '必须是非空数组');
  const drops = value.map((entry, index) => {
    const path = `config.guaranteedCoinDrops[${index}]`;
    assertPlainRecord(entry, path);
    assertExactKeys(entry, ['floor', 'amount'], path);
    return {
      floor: positiveInteger(entry.floor, `${path}.floor`),
      amount: positiveInteger(entry.amount, `${path}.amount`),
    };
  });
  for (let index = 0; index < drops.length; index += 1) {
    const drop = drops[index];
    if (drop.floor > TOWER_FLOOR_COUNT) fail(`config.guaranteedCoinDrops[${index}].floor`, '超出塔楼层范围');
    if (index > 0 && drop.floor <= drops[index - 1].floor) fail('config.guaranteedCoinDrops', '楼层必须严格递增');
  }
  if (new Set(drops.map(({ floor }) => floor)).size !== drops.length) fail('config.guaranteedCoinDrops', '不得包含重复楼层');
  return drops;
}

function parseItems(value: unknown): TowerShopItem[] {
  if (!Array.isArray(value) || value.length < TOWER_SHOP_OFFER_COUNT) fail('config.items', `至少需要 ${TOWER_SHOP_OFFER_COUNT} 个商品`);
  const ids = new Set<string>();
  return value.map((entry, index) => {
    const path = `config.items[${index}]`;
    assertPlainRecord(entry, path);
    assertExactKeys(entry, ['id', 'cost', 'purchaseLimit', 'reward'], path);
    const id = configId(entry.id, `${path}.id`);
    if (ids.has(id)) fail(`${path}.id`, '商品 ID 不得重复');
    ids.add(id);
    return {
      id,
      cost: positiveInteger(entry.cost, `${path}.cost`),
      purchaseLimit: positiveInteger(entry.purchaseLimit, `${path}.purchaseLimit`),
      reward: parseReward(entry.reward, `${path}.reward`),
    };
  });
}

export class TowerShopConfigError extends Error {
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(`塔商店配置无效 [${configPath}] ${message}`);
    this.name = 'TowerShopConfigError';
    this.configPath = configPath;
  }
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
  }
  return value;
}

export function loadTowerShopConfig(value: unknown): TowerShopConfig {
  assertPlainRecord(value, 'config');
  assertExactKeys(value, [
    'schemaVersion', 'towerFloorCount', 'guaranteedCoinDrops', 'refreshCost', 'offerCount', 'items',
  ], 'config');
  if (value.schemaVersion !== TOWER_SHOP_SCHEMA_VERSION) fail('config.schemaVersion', '版本不支持');
  if (value.towerFloorCount !== TOWER_FLOOR_COUNT) fail('config.towerFloorCount', `必须是 ${TOWER_FLOOR_COUNT}`);
  const guaranteedCoinDrops = parseCoinDrops(value.guaranteedCoinDrops);
  const refreshCost = positiveInteger(value.refreshCost, 'config.refreshCost');
  const offerCount = positiveInteger(value.offerCount, 'config.offerCount');
  const items = parseItems(value.items);
  if (offerCount > items.length) fail('config.offerCount', '不得超过商品数量');
  return freezeDeep({
    schemaVersion: TOWER_SHOP_SCHEMA_VERSION,
    towerFloorCount: TOWER_FLOOR_COUNT,
    guaranteedCoinDrops,
    refreshCost,
    offerCount,
    items,
  });
}

export const towerShopConfig = loadTowerShopConfig({
  schemaVersion: TOWER_SHOP_SCHEMA_VERSION,
  towerFloorCount: TOWER_FLOOR_COUNT,
  guaranteedCoinDrops: DEFAULT_COIN_DROPS,
  refreshCost: TOWER_SHOP_REFRESH_COST,
  offerCount: TOWER_SHOP_OFFER_COUNT,
  items: DEFAULT_ITEMS,
});

export function towerCoinDropAtFloor(config: TowerShopConfig, floor: number): TowerCoinDrop | null {
  return config.guaranteedCoinDrops.find((drop) => drop.floor === floor) ?? null;
}
