import {
  TOWER_SHOP_SCHEMA_VERSION,
  loadTowerShopConfig,
  towerCoinDropAtFloor,
  towerShopConfig,
  type TowerShopConfig,
  type TowerShopItem,
  type TowerShopReward,
} from './TowerShopConfig.ts';
import { TOWER_RESET_WEEKDAY, towerCycleKeyAt } from '../lifecycle/TowerLifecycle.ts';

export type TowerShopOperationCode =
  | 'APPLIED'
  | 'DUPLICATE'
  | 'CONFLICT'
  | 'INSUFFICIENT_FUNDS'
  | 'LIMIT_REACHED'
  | 'NOT_OFFERED'
  | 'NOT_REWARD_FLOOR'
  | 'RESET';

export type TowerShopPurchaseLedgerEntry = Readonly<{
  sequence: number;
  purchaseId: string;
  fingerprint: string;
}>;

export type TowerShopRefreshLedgerEntry = Readonly<{
  sequence: number;
  refreshId: string;
}>;

export type TowerShopState = Readonly<{
  schemaVersion: typeof TOWER_SHOP_SCHEMA_VERSION;
  cycleKey: string;
  towerCoins: number;
  inventory: Readonly<Record<string, number>>;
  claimedFloorRewards: readonly number[];
  purchased: Readonly<Record<string, number>>;
  offers: readonly string[];
  refreshCount: number;
  processedPurchases: Readonly<Record<string, string>>;
  purchaseLedger: readonly TowerShopPurchaseLedgerEntry[];
  purchaseCount: number;
  purchaseSequence: number;
  processedRefreshes: Readonly<Record<string, string>>;
  refreshLedger: readonly TowerShopRefreshLedgerEntry[];
}>;

export type TowerShopPersistence = (serialized: string) => void;

export type TowerShopOptions = Readonly<{
  config?: TowerShopConfig;
  cycleKey?: string;
  towerCoins?: number;
  initialState?: string;
  persist?: TowerShopPersistence;
}>;

export type TowerShopErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_INPUT'
  | 'UNKNOWN_ITEM'
  | 'PERSISTENCE_FAILED';

export class TowerShopError extends Error {
  readonly code: TowerShopErrorCode;

  constructor(code: TowerShopErrorCode, message: string) {
    super(message);
    this.name = 'TowerShopError';
    this.code = code;
  }
}

export type TowerShopOperationResult = Readonly<{
  applied: boolean;
  code: TowerShopOperationCode;
  state: TowerShopState;
  amount?: number;
  spent?: number;
  reward?: TowerShopReward;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function fail(code: TowerShopErrorCode, message: string): never {
  throw new TowerShopError(code, message);
}

function assertPlainRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_STATE', `${path} must be a plain object`);
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Reflect.ownKeys(record);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail('INVALID_STATE', `${path} contains unexpected or missing fields`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) fail('INVALID_STATE', `${path}.${key} is missing`);
  }
}

function assertCycleKey(
  value: unknown,
  path: string,
  code: TowerShopErrorCode = 'INVALID_INPUT',
): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(code, `${path} is invalid`);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCDay() !== TOWER_RESET_WEEKDAY
  ) {
    fail(code, `${path} must be a real calendar Monday`);
  }
}

function nextCycleKey(cycleKey: string): string {
  const date = new Date(0);
  date.setUTCFullYear(Number(cycleKey.slice(0, 4)), Number(cycleKey.slice(5, 7)) - 1, Number(cycleKey.slice(8, 10)));
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 7);
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function assertSafeInteger(value: unknown, path: string, code: TowerShopErrorCode = 'INVALID_INPUT'): asserts value is number {
  if (!Number.isSafeInteger(value)) fail(code, `${path} must be a safe integer`);
}

function assertNonNegativeInteger(value: unknown, path: string, code: TowerShopErrorCode = 'INVALID_STATE'): asserts value is number {
  assertSafeInteger(value, path, code);
  if (value < 0) fail(code, `${path} must be non-negative`);
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  assertSafeInteger(value, path);
  if (value <= 0) fail('INVALID_INPUT', `${path} must be positive`);
}

function assertBusinessKey(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail('INVALID_INPUT', `${path} is invalid`);
}

function assertStateBusinessKey(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail('INVALID_STATE', `${path} is invalid`);
}

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function assertState(value: unknown, config: TowerShopConfig): asserts value is TowerShopState {
  assertPlainRecord(value, 'state');
  assertExactKeys(value, [
    'schemaVersion', 'cycleKey', 'towerCoins', 'inventory', 'claimedFloorRewards', 'purchased', 'offers',
    'refreshCount', 'processedPurchases', 'purchaseLedger', 'purchaseCount', 'purchaseSequence', 'processedRefreshes',
    'refreshLedger',
  ], 'state');
  if (value.schemaVersion !== TOWER_SHOP_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported schemaVersion');
  assertCycleKey(value.cycleKey, 'state.cycleKey', 'INVALID_STATE');
  assertNonNegativeInteger(value.towerCoins, 'state.towerCoins');
  assertNonNegativeInteger(value.refreshCount, 'state.refreshCount');
  assertStringNumberMap(value.inventory, 'state.inventory');
  assertFloorArray(value.claimedFloorRewards, config);
  assertStringNumberMap(value.purchased, 'state.purchased');
  assertProcessedPurchases(value.processedPurchases, config, value.purchased, value.inventory);
  assertNonNegativeInteger(value.purchaseCount, 'state.purchaseCount');
  assertNonNegativeInteger(value.purchaseSequence, 'state.purchaseSequence');
  assertPurchaseLedger(
    value.purchaseLedger,
    config,
    value.processedPurchases,
    value.purchased,
    value.inventory,
    value.purchaseCount,
    value.purchaseSequence,
  );
  if (!Array.isArray(value.offers) || value.offers.length !== config.offerCount) {
    fail('INVALID_STATE', 'state.offers has an invalid count');
  }
  const itemById = new Map(config.items.map((item) => [item.id, item]));
  const rewardIds = new Set(config.items.map((item) => item.reward.id));
  const offerIds = new Set<string>();
  for (const [index, itemId] of value.offers.entries()) {
    if (typeof itemId !== 'string' || itemById.get(itemId) === undefined || offerIds.has(itemId)) {
      fail('INVALID_STATE', `state.offers[${index}] is invalid`);
    }
    offerIds.add(itemId);
  }
  assertProcessedRefreshes(value.processedRefreshes, config, value.refreshCount, value.offers);
  assertRefreshLedger(value.refreshLedger, value.processedRefreshes, value.refreshCount);
  for (const [rewardId, quantity] of Object.entries(value.inventory)) {
    if (!rewardIds.has(rewardId)) fail('INVALID_STATE', `state.inventory.${rewardId} is not a shop reward`);
    if (quantity <= 0) fail('INVALID_STATE', `state.inventory.${rewardId} must be positive when present`);
  }
  for (const [itemId, quantity] of Object.entries(value.purchased)) {
    const item = itemById.get(itemId);
    if (item === undefined || quantity <= 0 || quantity > item.purchaseLimit) {
      fail('INVALID_STATE', `state.purchased.${itemId} exceeds the configured purchase limit`);
    }
  }
}

function assertStringNumberMap(value: unknown, path: string): asserts value is Record<string, number> {
  assertPlainRecord(value, path);
  for (const [key, quantity] of Object.entries(value)) {
    if (key.length === 0 || key.trim() !== key) fail('INVALID_STATE', `${path} contains an invalid key`);
    assertNonNegativeInteger(quantity, `${path}.${key}`);
  }
}

function assertProcessedRefreshes(
  value: unknown,
  config: TowerShopConfig,
  refreshCount: number,
  offers: readonly string[],
): asserts value is Record<string, string> {
  assertPlainRecord(value, 'state.processedRefreshes');
  const refreshIds = Object.keys(value);
  if (new Set(refreshIds).size !== refreshIds.length) {
    fail('INVALID_STATE', 'state.processedRefreshes contains duplicate keys');
  }
  if (refreshIds.length !== refreshCount) {
    fail('INVALID_STATE', 'state.processedRefreshes count must match state.refreshCount');
  }
  for (const refreshId of refreshIds) {
    assertStateBusinessKey(refreshId, `state.processedRefreshes.${refreshId}`);
    if (value[refreshId] !== 'refresh') {
      fail('INVALID_STATE', `state.processedRefreshes.${refreshId} must be refresh`);
    }
  }

  const expectedOffers = selectOffers(config, refreshCount);
  if (offers.some((itemId, index) => itemId !== expectedOffers[index])) {
    fail('INVALID_STATE', 'state.offers does not match state.refreshCount');
  }
}

function assertRefreshLedger(
  value: unknown,
  processedRefreshes: Record<string, string>,
  refreshCount: number,
): asserts value is readonly TowerShopRefreshLedgerEntry[] {
  if (!Array.isArray(value)) fail('INVALID_STATE', 'state.refreshLedger must be an array');
  if (value.length !== refreshCount) fail('INVALID_STATE', 'state.refreshLedger count must match state.refreshCount');

  const ledgerRefreshIds: string[] = [];
  const ledgerRefreshIdSet = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const path = `state.refreshLedger[${index}]`;
    assertPlainRecord(entry, path);
    assertExactKeys(entry, ['sequence', 'refreshId'], path);
    assertSafeInteger(entry.sequence, `${path}.sequence`, 'INVALID_STATE');
    if (entry.sequence !== index + 1) fail('INVALID_STATE', `${path}.sequence must be contiguous`);
    assertStateBusinessKey(entry.refreshId, `${path}.refreshId`);
    if (ledgerRefreshIdSet.has(entry.refreshId)) fail('INVALID_STATE', `${path}.refreshId is duplicated`);
    ledgerRefreshIdSet.add(entry.refreshId);
    ledgerRefreshIds.push(entry.refreshId);
  }

  for (const refreshId of ledgerRefreshIds) {
    if (!hasOwn(processedRefreshes, refreshId) || processedRefreshes[refreshId] !== 'refresh') {
      fail('INVALID_STATE', 'state.processedRefreshes must match the refresh ledger keys and order');
    }
  }

  // Serialization keeps normal-key insertion order but normalizes integer-index keys,
  // so numeric refresh ids remain valid while non-numeric reordering is rejected.
  const expectedProcessedRefreshes = Object.fromEntries(
    ledgerRefreshIds.map((refreshId) => [refreshId, 'refresh']),
  );
  if (JSON.stringify(processedRefreshes) !== JSON.stringify(expectedProcessedRefreshes)) {
    fail('INVALID_STATE', 'state.processedRefreshes must match the refresh ledger keys and order');
  }
}

function parsePurchaseFingerprint(
  fingerprint: unknown,
  config: TowerShopConfig,
  path: string,
): { itemId: string; quantity: number; item: TowerShopItem } {
  if (typeof fingerprint !== 'string') fail('INVALID_STATE', `${path} must be a valid purchase fingerprint`);
  const separator = fingerprint.lastIndexOf(':');
  const itemId = separator > 0 ? fingerprint.slice(0, separator) : '';
  const quantityText = separator > 0 ? fingerprint.slice(separator + 1) : '';
  if (!/^\d+$/.test(quantityText) || quantityText.length === 0) {
    fail('INVALID_STATE', `${path} must encode a positive quantity`);
  }
  const quantity = Number(quantityText);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || String(quantity) !== quantityText) {
    fail('INVALID_STATE', `${path} must encode a safe integer quantity`);
  }
  const item = config.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) fail('INVALID_STATE', `${path} references an unknown item`);
  if (quantity > item.purchaseLimit) fail('INVALID_STATE', `${path} exceeds the configured purchase limit`);
  return { itemId, quantity, item };
}

function addAggregate(map: Map<string, number>, key: string, amount: number, path: string): void {
  const next = (map.get(key) ?? 0) + amount;
  if (!Number.isSafeInteger(next)) fail('INVALID_STATE', `${path} overflows`);
  map.set(key, next);
}

function assertProcessedPurchases(
  value: unknown,
  config: TowerShopConfig,
  purchased: Record<string, number>,
  inventory: Record<string, number>,
): asserts value is Record<string, string> {
  assertPlainRecord(value, 'state.processedPurchases');
  const purchasedTotals = new Map<string, number>();
  const rewardTotals = new Map<string, number>();
  for (const [purchaseId, fingerprint] of Object.entries(value)) {
    assertStateBusinessKey(purchaseId, `state.processedPurchases.${purchaseId}`);
    const { itemId, quantity, item } = parsePurchaseFingerprint(
      fingerprint,
      config,
      `state.processedPurchases.${purchaseId}`,
    );
    addAggregate(purchasedTotals, itemId, quantity, `state.purchased.${itemId}`);
    const rewardQuantity = item.reward.quantity * quantity;
    if (!Number.isSafeInteger(rewardQuantity)) {
      fail('INVALID_STATE', `state.processedPurchases.${purchaseId} reward quantity overflows`);
    }
    addAggregate(rewardTotals, item.reward.id, rewardQuantity, `state.inventory.${item.reward.id}`);
  }

  for (const [itemId, quantity] of Object.entries(purchased)) {
    if (purchasedTotals.get(itemId) !== quantity) {
      fail('INVALID_STATE', `state.purchased.${itemId} does not match processed purchases`);
    }
  }
  for (const [itemId, quantity] of purchasedTotals) {
    if (purchased[itemId] !== quantity) {
      fail('INVALID_STATE', `state.processedPurchases does not match state.purchased.${itemId}`);
    }
  }

  for (const [rewardId, quantity] of Object.entries(inventory)) {
    if (rewardTotals.get(rewardId) !== quantity) {
      fail('INVALID_STATE', `state.inventory.${rewardId} does not match processed purchase rewards`);
    }
  }
  for (const [rewardId, quantity] of rewardTotals) {
    if (inventory[rewardId] !== quantity) {
      fail('INVALID_STATE', `state.processedPurchases does not match state.inventory.${rewardId}`);
    }
  }
}

function assertPurchaseLedger(
  value: unknown,
  config: TowerShopConfig,
  processedPurchases: Record<string, string>,
  purchased: Record<string, number>,
  inventory: Record<string, number>,
  purchaseCount: number,
  purchaseSequence: number,
): asserts value is readonly TowerShopPurchaseLedgerEntry[] {
  if (!Array.isArray(value)) fail('INVALID_STATE', 'state.purchaseLedger must be an array');
  if (value.length !== purchaseCount) fail('INVALID_STATE', 'state.purchaseCount must match purchase ledger length');
  if (purchaseSequence !== purchaseCount) fail('INVALID_STATE', 'state.purchaseSequence must match purchase count');

  const ledgerByPurchaseId = new Map<string, string>();
  for (const [index, entry] of value.entries()) {
    const path = `state.purchaseLedger[${index}]`;
    assertPlainRecord(entry, path);
    assertExactKeys(entry, ['sequence', 'purchaseId', 'fingerprint'], path);
    assertSafeInteger(entry.sequence, `${path}.sequence`, 'INVALID_STATE');
    if (entry.sequence !== index + 1) fail('INVALID_STATE', `${path}.sequence must be contiguous`);
    assertStateBusinessKey(entry.purchaseId, `${path}.purchaseId`);
    if (ledgerByPurchaseId.has(entry.purchaseId)) fail('INVALID_STATE', `${path}.purchaseId is duplicated`);
    ledgerByPurchaseId.set(entry.purchaseId, entry.fingerprint);
    parsePurchaseFingerprint(entry.fingerprint, config, `${path}.fingerprint`);

    if (
      !Object.prototype.hasOwnProperty.call(processedPurchases, entry.purchaseId)
      || processedPurchases[entry.purchaseId] !== entry.fingerprint
    ) {
      fail('INVALID_STATE', `${path} does not match state.processedPurchases`);
    }
  }

  if (Object.keys(processedPurchases).length !== value.length) {
    fail('INVALID_STATE', 'state.processedPurchases must contain exactly the purchase ledger keys');
  }
  for (const [purchaseId, fingerprint] of Object.entries(processedPurchases)) {
    if (ledgerByPurchaseId.get(purchaseId) !== fingerprint) {
      fail('INVALID_STATE', `state.processedPurchases.${purchaseId} is missing from purchase ledger`);
    }
  }

  // Keep the aggregate checks sourced from the ledger as an independent witness.
  const ledgerPurchasedTotals = new Map<string, number>();
  const ledgerRewardTotals = new Map<string, number>();
  for (const [purchaseId, fingerprint] of ledgerByPurchaseId) {
    const { itemId, quantity, item } = parsePurchaseFingerprint(
      fingerprint,
      config,
      `state.purchaseLedger.${purchaseId}`,
    );
    addAggregate(ledgerPurchasedTotals, itemId, quantity, `state.purchased.${itemId}`);
    const rewardQuantity = item.reward.quantity * quantity;
    if (!Number.isSafeInteger(rewardQuantity)) {
      fail('INVALID_STATE', `state.purchaseLedger.${purchaseId} reward quantity overflows`);
    }
    addAggregate(ledgerRewardTotals, item.reward.id, rewardQuantity, `state.inventory.${item.reward.id}`);
  }
  assertAggregatesMatch(ledgerPurchasedTotals, purchased, 'state.purchased', 'purchase ledger');
  assertAggregatesMatch(ledgerRewardTotals, inventory, 'state.inventory', 'purchase ledger rewards');
}

function assertAggregatesMatch(
  expected: Map<string, number>,
  actual: Record<string, number>,
  actualPath: string,
  expectedSource: string,
): void {
  for (const [key, quantity] of Object.entries(actual)) {
    if (expected.get(key) !== quantity) fail('INVALID_STATE', `${actualPath}.${key} does not match ${expectedSource}`);
  }
  for (const [key, quantity] of expected) {
    if (actual[key] !== quantity) fail('INVALID_STATE', `${expectedSource} does not match ${actualPath}.${key}`);
  }
}

function assertFloorArray(value: unknown, config: TowerShopConfig): asserts value is readonly number[] {
  if (!Array.isArray(value)) fail('INVALID_STATE', 'state.claimedFloorRewards must be an array');
  let previous = 0;
  for (const [index, floor] of value.entries()) {
    assertSafeInteger(floor, `state.claimedFloorRewards[${index}]`, 'INVALID_STATE');
    if (floor <= previous || towerCoinDropAtFloor(config, floor) === null) {
      fail('INVALID_STATE', `state.claimedFloorRewards[${index}] is not an ordered reward floor`);
    }
    previous = floor;
  }
}

function itemById(config: TowerShopConfig, itemId: string): TowerShopItem {
  const item = config.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) fail('UNKNOWN_ITEM', `unknown tower shop item: ${itemId}`);
  return item;
}

function selectOffers(config: TowerShopConfig, refreshCount: number): string[] {
  const start = (refreshCount * 2) % config.items.length;
  return Array.from({ length: config.offerCount }, (_unused, index) => config.items[(start + index) % config.items.length].id);
}

function initialState(config: TowerShopConfig, cycleKey: string, towerCoins: number): TowerShopState {
  return freezeDeep({
    schemaVersion: TOWER_SHOP_SCHEMA_VERSION,
    cycleKey,
    towerCoins,
    inventory: {},
    claimedFloorRewards: [],
    purchased: {},
    offers: selectOffers(config, 0),
    refreshCount: 0,
    processedPurchases: {},
    purchaseLedger: [],
    purchaseCount: 0,
    purchaseSequence: 0,
    processedRefreshes: {},
    refreshLedger: [],
  });
}

function copyState(value: TowerShopState): TowerShopState {
  return freezeDeep(clone(value));
}

function operation(
  state: TowerShopState,
  code: TowerShopOperationCode,
  applied: boolean,
  details: Partial<Omit<TowerShopOperationResult, 'state' | 'code' | 'applied'>> = {},
): TowerShopOperationResult {
  return { applied, code, state: copyState(state), ...details };
}

export function serializeTowerShop(state: TowerShopState, config: TowerShopConfig = towerShopConfig): string {
  assertState(state, config);
  return JSON.stringify(state);
}

export function restoreTowerShop(serialized: string, config: TowerShopConfig = towerShopConfig): TowerShopState {
  if (typeof serialized !== 'string' || serialized.trim().length === 0) fail('INVALID_STATE', 'tower shop save must be a non-empty string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'tower shop save is not valid JSON');
  }
  assertState(parsed, config);
  return copyState(parsed);
}

export class TowerShopService {
  private readonly config: TowerShopConfig;
  private readonly persist: TowerShopPersistence;
  private current: TowerShopState;
  private committing = false;

  constructor(options: TowerShopOptions = {}) {
    this.config = options.config ?? towerShopConfig;
    try {
      // Re-validate injected configuration instead of trusting structural typing at runtime.
      this.config = loadTowerShopConfig(options.config ?? towerShopConfig);
    } catch (error) {
      fail('INVALID_CONFIG', error instanceof Error ? error.message : String(error));
    }
    this.persist = options.persist ?? (() => {});
    if (typeof this.persist !== 'function') fail('INVALID_CONFIG', 'persist must be a function');

    if (options.initialState !== undefined) {
      this.current = restoreTowerShop(options.initialState, this.config);
    } else {
      const cycleKey = options.cycleKey ?? towerCycleKeyAt(Date.now());
      assertCycleKey(cycleKey, 'cycleKey');
      const towerCoins = options.towerCoins ?? 0;
      assertNonNegativeInteger(towerCoins, 'towerCoins', 'INVALID_CONFIG');
      this.current = initialState(this.config, cycleKey, towerCoins);
    }
  }

  snapshot(): TowerShopState {
    return copyState(this.current);
  }

  save(): string {
    return serializeTowerShop(this.current, this.config);
  }

  claimFloorReward(floor: number): TowerShopOperationResult {
    assertSafeInteger(floor, 'floor');
    if (floor < 1 || floor > this.config.towerFloorCount) fail('INVALID_INPUT', `floor must be between 1 and ${this.config.towerFloorCount}`);
    const drop = towerCoinDropAtFloor(this.config, floor);
    if (drop === null) return operation(this.current, 'NOT_REWARD_FLOOR', false);
    if (this.current.claimedFloorRewards.includes(floor)) return operation(this.current, 'DUPLICATE', false, { amount: drop.amount });
    const towerCoins = this.current.towerCoins + drop.amount;
    if (!Number.isSafeInteger(towerCoins)) fail('INVALID_STATE', 'tower coin balance would overflow');
    const next: TowerShopState = {
      ...this.current,
      towerCoins,
      claimedFloorRewards: [...this.current.claimedFloorRewards, floor].sort((left, right) => left - right),
    };
    this.commit(next);
    return operation(this.current, 'APPLIED', true, { amount: drop.amount });
  }

  /** Alias for callers that model floor rewards as grants rather than claims. */
  grantFloorReward(floor: number): TowerShopOperationResult {
    return this.claimFloorReward(floor);
  }

  refresh(refreshId: string): TowerShopOperationResult {
    assertBusinessKey(refreshId, 'refreshId');
    const previous = hasOwn(this.current.processedRefreshes, refreshId)
      ? this.current.processedRefreshes[refreshId]
      : undefined;
    if (previous !== undefined) return operation(this.current, previous === 'refresh' ? 'DUPLICATE' : 'CONFLICT', false);
    if (this.current.towerCoins < this.config.refreshCost) return operation(this.current, 'INSUFFICIENT_FUNDS', false);
    if (this.current.refreshCount === Number.MAX_SAFE_INTEGER) fail('INVALID_STATE', 'refresh count would overflow');
    const nextRefreshCount = this.current.refreshCount + 1;
    const next: TowerShopState = {
      ...this.current,
      towerCoins: this.current.towerCoins - this.config.refreshCost,
      offers: selectOffers(this.config, nextRefreshCount),
      refreshCount: nextRefreshCount,
      processedRefreshes: { ...this.current.processedRefreshes, [refreshId]: 'refresh' },
      refreshLedger: [
        ...this.current.refreshLedger,
        { sequence: nextRefreshCount, refreshId },
      ],
    };
    this.commit(next);
    return operation(this.current, 'APPLIED', true, { spent: this.config.refreshCost });
  }

  purchase(purchaseId: string, itemId: string, quantity = 1): TowerShopOperationResult {
    assertBusinessKey(purchaseId, 'purchaseId');
    assertBusinessKey(itemId, 'itemId');
    assertPositiveInteger(quantity, 'quantity');
    const fingerprint = `${itemId}:${quantity}`;
    const previous = hasOwn(this.current.processedPurchases, purchaseId)
      ? this.current.processedPurchases[purchaseId]
      : undefined;
    if (previous !== undefined) {
      return operation(this.current, previous === fingerprint ? 'DUPLICATE' : 'CONFLICT', false);
    }

    const item = itemById(this.config, itemId);
    if (!this.current.offers.includes(item.id)) return operation(this.current, 'NOT_OFFERED', false);
    const purchased = this.current.purchased[item.id] ?? 0;
    if (quantity > item.purchaseLimit - purchased) return operation(this.current, 'LIMIT_REACHED', false);
    if (quantity > Math.floor(Number.MAX_SAFE_INTEGER / item.cost)) fail('INVALID_INPUT', 'purchase cost would overflow');
    const spent = item.cost * quantity;
    if (spent > this.current.towerCoins) return operation(this.current, 'INSUFFICIENT_FUNDS', false);
    const rewardQuantity = item.reward.quantity * quantity;
    if (!Number.isSafeInteger(rewardQuantity)) fail('INVALID_INPUT', 'reward quantity would overflow');
    if (this.current.purchaseCount === Number.MAX_SAFE_INTEGER) fail('INVALID_STATE', 'purchase count would overflow');
    if (this.current.purchaseSequence === Number.MAX_SAFE_INTEGER) fail('INVALID_STATE', 'purchase sequence would overflow');
    const nextPurchaseCount = this.current.purchaseCount + 1;
    const nextPurchaseSequence = this.current.purchaseSequence + 1;
    const nextInventory = { ...this.current.inventory, [item.reward.id]: (this.current.inventory[item.reward.id] ?? 0) + rewardQuantity };
    if (!Number.isSafeInteger(nextInventory[item.reward.id])) fail('INVALID_STATE', 'inventory quantity would overflow');
    const next: TowerShopState = {
      ...this.current,
      towerCoins: this.current.towerCoins - spent,
      inventory: nextInventory,
      purchased: { ...this.current.purchased, [item.id]: purchased + quantity },
      processedPurchases: { ...this.current.processedPurchases, [purchaseId]: fingerprint },
      purchaseLedger: [
        ...this.current.purchaseLedger,
        { sequence: nextPurchaseSequence, purchaseId, fingerprint },
      ],
      purchaseCount: nextPurchaseCount,
      purchaseSequence: nextPurchaseSequence,
    };
    this.commit(next);
    return operation(this.current, 'APPLIED', true, { spent, reward: item.reward });
  }

  /** Domain name used by UI callers; purchase remains the canonical transaction method. */
  redeem(purchaseId: string, itemId: string, quantity = 1): TowerShopOperationResult {
    return this.purchase(purchaseId, itemId, quantity);
  }

  synchronizeCycle(cycleKey: string): TowerShopOperationResult {
    assertCycleKey(cycleKey, 'cycleKey');
    if (cycleKey === this.current.cycleKey) return operation(this.current, 'DUPLICATE', false);
    const expectedNextCycleKey = nextCycleKey(this.current.cycleKey);
    if (cycleKey !== expectedNextCycleKey) {
      fail('INVALID_INPUT', `cycleKey must advance exactly one week to ${expectedNextCycleKey}`);
    }
    const next: TowerShopState = {
      ...initialState(this.config, cycleKey, this.current.towerCoins),
    };
    this.commit(next);
    return operation(this.current, 'RESET', true);
  }

  private commit(next: TowerShopState): void {
    assertState(next, this.config);
    if (this.committing) fail('PERSISTENCE_FAILED', 'tower shop persistence is reentrant');
    this.committing = true;
    try {
      this.persist(serializeTowerShop(next, this.config));
    } catch (error) {
      throw new TowerShopError('PERSISTENCE_FAILED', error instanceof Error ? error.message : String(error));
    } finally {
      this.committing = false;
    }
    this.current = copyState(next);
  }
}
