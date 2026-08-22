import {
  ReputationCatalog,
  restoreReputationState,
  type ReputationState,
} from '../Reputation.ts';
import { REPUTATION_SHOP_CATALOG_DATA } from './ReputationShopCatalogData.ts';
import {
  createDefaultReputationShopCatalog,
  reputationShopConfig,
} from './ReputationShopCatalogLoader.ts';
import {
  ReputationShopConfigError,
  loadReputationShopConfig,
  type ReputationShopConfig,
  type ReputationShopItem,
  type ReputationShopReward,
} from './ReputationShopConfig.ts';

export type ReputationShopOperationCode =
  | 'APPLIED'
  | 'DUPLICATE'
  | 'CONFLICT'
  | 'INSUFFICIENT_FUNDS'
  | 'LIMIT_REACHED'
  | 'NOT_OFFERED'
  | 'LEVEL_LOCKED';

export type ReputationShopPurchaseLedgerEntry = Readonly<{
  sequence: number;
  purchaseId: string;
  fingerprint: string;
}>;

export type ReputationShopRefreshLedgerEntry = Readonly<{
  sequence: number;
  refreshId: string;
}>;

export type ReputationShopBalanceLedgerEntry = Readonly<{
  sequence: number;
  kind: 'INITIAL' | 'PURCHASE' | 'REFRESH';
  referenceId: string;
  delta: number;
  balanceAfter: number;
}>;

const REPUTATION_SHOP_STATE_SCHEMA_VERSION = 2 as const;
const BALANCE_WITNESS_VERSION = 'v1' as const;
const TRUSTED_STATE_DIGEST_VERSION = 'v1' as const;

export type ReputationShopState = Readonly<{
  schemaVersion: typeof REPUTATION_SHOP_STATE_SCHEMA_VERSION;
  balance: number;
  balanceLedger: readonly ReputationShopBalanceLedgerEntry[];
  balanceWitness: string;
  reputationState: ReputationState;
  inventory: Readonly<Record<string, number>>;
  purchased: Readonly<Record<string, number>>;
  offers: readonly string[];
  refreshCount: number;
  processedPurchases: Readonly<Record<string, string>>;
  purchaseLedger: readonly ReputationShopPurchaseLedgerEntry[];
  purchaseCount: number;
  purchaseSequence: number;
  processedRefreshes: Readonly<Record<string, string>>;
  refreshLedger: readonly ReputationShopRefreshLedgerEntry[];
}>;

// This anchor must come from the caller/server account authority. It is deliberately
// not serialized into the save and must never be reconstructed from the save being restored.
export type ReputationShopTrustedAnchor = Readonly<{
  balanceLedger: readonly ReputationShopBalanceLedgerEntry[];
  expectedStateDigest: string;
}>;

export type ReputationShopPersistence = (serialized: string) => void;

export type ReputationShopOptions = Readonly<{
  config?: ReputationShopConfig;
  catalog?: ReputationCatalog;
  reputationCatalog?: ReputationCatalog;
  balance?: number;
  reputationState?: ReputationState;
  initialState?: string;
  trustedAnchor?: ReputationShopTrustedAnchor;
  persist?: ReputationShopPersistence;
}>;

export type ReputationShopErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_INPUT'
  | 'UNKNOWN_ITEM'
  | 'PERSISTENCE_FAILED';

export class ReputationShopError extends Error {
  readonly code: ReputationShopErrorCode;

  constructor(code: ReputationShopErrorCode, message: string) {
    super(message);
    this.name = 'ReputationShopError';
    this.code = code;
  }
}

export type ReputationShopOperationResult = Readonly<{
  applied: boolean;
  code: ReputationShopOperationCode;
  state: ReputationShopState;
  spent?: number;
  reward?: ReputationShopReward;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, clone(child)])) as T;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code: ReputationShopErrorCode, message: string): never {
  throw new ReputationShopError(code, message);
}

function assertPlainRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) fail('INVALID_STATE', `${path} must be a plain object`);
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Reflect.ownKeys(record);
  if (actual.length !== keys.length || actual.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    fail('INVALID_STATE', `${path} contains unexpected or missing fields`);
  }
  for (const key of keys) if (!Object.prototype.hasOwnProperty.call(record, key)) fail('INVALID_STATE', `${path}.${key} is missing`);
}

function assertSafeInteger(value: unknown, path: string, code: ReputationShopErrorCode = 'INVALID_INPUT'): asserts value is number {
  if (!Number.isSafeInteger(value)) fail(code, `${path} must be a safe integer`);
}

function assertNonNegativeInteger(value: unknown, path: string, code: ReputationShopErrorCode = 'INVALID_STATE'): asserts value is number {
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

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function fnv1a(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((child) => canonicalizeJson(child));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value as Record<string, unknown>)
      .sort(compareStrings)
      .map((key) => [key, canonicalizeJson((value as Record<string, unknown>)[key])]));
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalizeJson(value));
}

function publicDigest(value: string): string {
  return [
    fnv1a(value, 0x811c9dc5),
    fnv1a(value, 0x9e3779b9),
    fnv1a(value, 0x85ebca6b),
    fnv1a(value, 0xc2b2ae35),
  ].join('');
}

export type ReputationShopWitnessInput = Pick<ReputationShopState, 'balance' | 'balanceLedger' | 'processedPurchases' | 'purchaseLedger' | 'purchased' | 'inventory' | 'processedRefreshes' | 'refreshLedger'>;

export function reputationShopBalanceWitness(value: ReputationShopWitnessInput): string {
  return `${BALANCE_WITNESS_VERSION}.${publicDigest(canonicalJson({
    version: BALANCE_WITNESS_VERSION,
    balance: value.balance,
    balanceLedger: value.balanceLedger,
    purchaseLedger: value.purchaseLedger,
    refreshLedger: value.refreshLedger,
    processedPurchases: value.processedPurchases,
    processedRefreshes: value.processedRefreshes,
    purchased: value.purchased,
    inventory: value.inventory,
  }))}`;
}

function sealBalanceWitness(value: Omit<ReputationShopState, 'balanceWitness'>): ReputationShopState {
  return { ...value, balanceWitness: reputationShopBalanceWitness(value) };
}

// The digest is public and reproducible. Its trust comes only from the external anchor
// supplied by the caller/server, not from this client-side function or the witness field.
export function reputationShopStateDigest(value: ReputationShopState): string {
  return `${TRUSTED_STATE_DIGEST_VERSION}.${publicDigest(canonicalJson(value))}`;
}

function sortedRecord<T>(value: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([key, child]) => [key, child]));
}

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function itemById(config: ReputationShopConfig, itemId: string): ReputationShopItem {
  const item = config.items.find((candidate) => candidate.id === itemId);
  if (item === undefined) fail('UNKNOWN_ITEM', `unknown reputation shop item: ${itemId}`);
  return item;
}

function selectOffers(config: ReputationShopConfig, refreshCount: number): string[] {
  const start = ((refreshCount % config.items.length) * (config.offerCount % config.items.length)) % config.items.length;
  return Array.from({ length: config.offerCount }, (_unused, index) => config.items[(start + index) % config.items.length].id);
}

function parsePurchaseFingerprint(
  fingerprint: unknown,
  config: ReputationShopConfig,
  path: string,
): { itemId: string; quantity: number; item: ReputationShopItem } {
  if (typeof fingerprint !== 'string') fail('INVALID_STATE', `${path} must be a valid purchase fingerprint`);
  const separator = fingerprint.lastIndexOf(':');
  const itemId = separator > 0 ? fingerprint.slice(0, separator) : '';
  const quantityText = separator > 0 ? fingerprint.slice(separator + 1) : '';
  if (!/^\d+$/.test(quantityText) || quantityText.length === 0) fail('INVALID_STATE', `${path} must encode a positive quantity`);
  const quantity = Number(quantityText);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || String(quantity) !== quantityText) fail('INVALID_STATE', `${path} must encode a safe integer quantity`);
  const item = itemById(config, itemId);
  if (quantity > item.purchaseLimit) fail('INVALID_STATE', `${path} exceeds the configured purchase limit`);
  if (fingerprint !== `${item.id}:${quantity}`) fail('INVALID_STATE', `${path} is not canonical`);
  return { itemId, quantity, item };
}

function addAggregate(map: Map<string, number>, key: string, amount: number, path: string): void {
  const next = (map.get(key) ?? 0) + amount;
  if (!Number.isSafeInteger(next)) fail('INVALID_STATE', `${path} overflows`);
  map.set(key, next);
}

function assertStringNumberMap(value: unknown, path: string): asserts value is Record<string, number> {
  assertPlainRecord(value, path);
  for (const [key, quantity] of Object.entries(value)) {
    if (key.length === 0 || key.trim() !== key) fail('INVALID_STATE', `${path} contains an invalid key`);
    assertNonNegativeInteger(quantity, `${path}.${key}`);
  }
}

function assertAggregatesMatch(
  expected: Map<string, number>,
  actual: Record<string, number>,
  actualPath: string,
  expectedSource: string,
): void {
  for (const [key, quantity] of Object.entries(actual)) if (expected.get(key) !== quantity) fail('INVALID_STATE', `${actualPath}.${key} does not match ${expectedSource}`);
  for (const [key, quantity] of expected) if (actual[key] !== quantity) fail('INVALID_STATE', `${expectedSource} does not match ${actualPath}.${key}`);
}

function assertPurchaseLedger(
  value: unknown,
  config: ReputationShopConfig,
  processedPurchases: Record<string, string>,
  purchased: Record<string, number>,
  inventory: Record<string, number>,
  purchaseCount: number,
  purchaseSequence: number,
): void {
  if (!Array.isArray(value)) fail('INVALID_STATE', 'state.purchaseLedger must be an array');
  if (value.length !== purchaseCount || purchaseSequence !== purchaseCount) fail('INVALID_STATE', 'purchase ledger counters do not match');
  const ledgerByPurchaseId = new Map<string, string>();
  for (const [index, entry] of value.entries()) {
    const path = `state.purchaseLedger[${index}]`;
    assertPlainRecord(entry, path);
    assertExactKeys(entry, ['sequence', 'purchaseId', 'fingerprint'], path);
    assertSafeInteger(entry.sequence, `${path}.sequence`, 'INVALID_STATE');
    if (entry.sequence !== index + 1) fail('INVALID_STATE', `${path}.sequence must be contiguous`);
    assertStateBusinessKey(entry.purchaseId, `${path}.purchaseId`);
    if (ledgerByPurchaseId.has(entry.purchaseId)) fail('INVALID_STATE', `${path}.purchaseId is duplicated`);
    const parsed = parsePurchaseFingerprint(entry.fingerprint, config, `${path}.fingerprint`);
    ledgerByPurchaseId.set(entry.purchaseId, entry.fingerprint);
    if (!hasOwn(processedPurchases, entry.purchaseId) || processedPurchases[entry.purchaseId] !== entry.fingerprint) {
      fail('INVALID_STATE', `${path} does not match state.processedPurchases`);
    }
    if (parsed.quantity <= 0) fail('INVALID_STATE', `${path}.fingerprint quantity is invalid`);
  }
  if (Object.keys(processedPurchases).length !== value.length) fail('INVALID_STATE', 'processed purchase count does not match ledger');
  for (const [purchaseId, fingerprint] of Object.entries(processedPurchases)) {
    if (ledgerByPurchaseId.get(purchaseId) !== fingerprint) fail('INVALID_STATE', `processed purchase ${purchaseId} is missing from ledger`);
  }
  const purchasedTotals = new Map<string, number>();
  const rewardTotals = new Map<string, number>();
  for (const [purchaseId, fingerprint] of ledgerByPurchaseId) {
    const { itemId, quantity, item } = parsePurchaseFingerprint(fingerprint, config, `state.purchaseLedger.${purchaseId}`);
    addAggregate(purchasedTotals, itemId, quantity, `state.purchased.${itemId}`);
    addAggregate(rewardTotals, item.reward.id, item.reward.quantity * quantity, `state.inventory.${item.reward.id}`);
  }
  assertAggregatesMatch(purchasedTotals, purchased, 'state.purchased', 'purchase ledger');
  assertAggregatesMatch(rewardTotals, inventory, 'state.inventory', 'purchase ledger rewards');
}

function assertRefreshLedger(
  value: unknown,
  processedRefreshes: Record<string, string>,
  refreshCount: number,
): void {
  if (!Array.isArray(value) || value.length !== refreshCount) fail('INVALID_STATE', 'refresh ledger does not match refresh count');
  const ledgerIds = new Set<string>();
  for (const [index, entry] of value.entries()) {
    const path = `state.refreshLedger[${index}]`;
    assertPlainRecord(entry, path);
    assertExactKeys(entry, ['sequence', 'refreshId'], path);
    assertSafeInteger(entry.sequence, `${path}.sequence`, 'INVALID_STATE');
    if (entry.sequence !== index + 1) fail('INVALID_STATE', `${path}.sequence must be contiguous`);
    assertStateBusinessKey(entry.refreshId, `${path}.refreshId`);
    if (ledgerIds.has(entry.refreshId) || processedRefreshes[entry.refreshId] !== 'refresh') fail('INVALID_STATE', `${path}.refreshId is invalid`);
    ledgerIds.add(entry.refreshId);
  }
  if (Object.keys(processedRefreshes).length !== value.length) fail('INVALID_STATE', 'processed refresh count does not match ledger');
  for (const [refreshId, value] of Object.entries(processedRefreshes)) {
    assertStateBusinessKey(refreshId, `state.processedRefreshes.${refreshId}`);
    if (value !== 'refresh' || !ledgerIds.has(refreshId)) fail('INVALID_STATE', `state.processedRefreshes.${refreshId} is invalid`);
  }
}

function assertBalanceLedger(
  value: unknown,
  config: ReputationShopConfig,
  balance: number,
  purchaseLedger: readonly ReputationShopPurchaseLedgerEntry[],
  refreshLedger: readonly ReputationShopRefreshLedgerEntry[],
  processedPurchases: Readonly<Record<string, string>>,
  processedRefreshes: Readonly<Record<string, string>>,
  purchased: Readonly<Record<string, number>>,
  inventory: Readonly<Record<string, number>>,
  balanceWitnessValue: unknown,
): void {
  if (!Array.isArray(value) || value.length !== purchaseLedger.length + refreshLedger.length + 1) {
    fail('INVALID_STATE', 'balance ledger does not cover all account events');
  }
  const purchaseIds = new Set(purchaseLedger.map((entry) => entry.purchaseId));
  const refreshIds = new Set(refreshLedger.map((entry) => entry.refreshId));
  const seenPurchases = new Set<string>();
  const seenRefreshes = new Set<string>();
  let runningBalance = 0;
  for (const [index, entry] of value.entries()) {
    const path = `state.balanceLedger[${index}]`;
    assertPlainRecord(entry, path);
    assertExactKeys(entry, ['sequence', 'kind', 'referenceId', 'delta', 'balanceAfter'], path);
    assertSafeInteger(entry.sequence, `${path}.sequence`, 'INVALID_STATE');
    if (entry.sequence !== index) fail('INVALID_STATE', `${path}.sequence must be contiguous`);
    assertSafeInteger(entry.delta, `${path}.delta`, 'INVALID_STATE');
    assertNonNegativeInteger(entry.balanceAfter, `${path}.balanceAfter`);
    if (index === 0) {
      if (entry.kind !== 'INITIAL' || entry.referenceId !== 'INITIAL' || entry.delta < 0) {
        fail('INVALID_STATE', 'balance ledger must start with the witnessed initial balance');
      }
    } else if (entry.kind === 'PURCHASE') {
      assertStateBusinessKey(entry.referenceId, `${path}.referenceId`);
      if (!purchaseIds.has(entry.referenceId) || seenPurchases.has(entry.referenceId)) fail('INVALID_STATE', `${path}.referenceId is invalid`);
      const purchase = purchaseLedger.find((candidate) => candidate.purchaseId === entry.referenceId);
      if (purchase === undefined) fail('INVALID_STATE', `${path}.referenceId is missing from purchase ledger`);
      const { item, quantity } = parsePurchaseFingerprint(purchase.fingerprint, config, `${path}.purchase`);
      const spent = item.cost * quantity;
      if (!Number.isSafeInteger(spent) || entry.delta !== -spent) fail('INVALID_STATE', `${path}.delta does not match purchase cost`);
      if (!hasOwn(processedPurchases, entry.referenceId)) fail('INVALID_STATE', `${path}.referenceId is missing from processed purchases`);
      seenPurchases.add(entry.referenceId);
    } else if (entry.kind === 'REFRESH') {
      assertStateBusinessKey(entry.referenceId, `${path}.referenceId`);
      if (!refreshIds.has(entry.referenceId) || seenRefreshes.has(entry.referenceId)) fail('INVALID_STATE', `${path}.referenceId is invalid`);
      if (entry.delta !== -config.refreshCost) fail('INVALID_STATE', `${path}.delta does not match refresh cost`);
      if (!hasOwn(processedRefreshes, entry.referenceId)) fail('INVALID_STATE', `${path}.referenceId is missing from processed refreshes`);
      seenRefreshes.add(entry.referenceId);
    } else {
      if (entry.kind !== 'INITIAL' || index !== 0 || entry.referenceId !== 'INITIAL') fail('INVALID_STATE', `${path}.kind is invalid`);
    }
    runningBalance += entry.delta;
    if (!Number.isSafeInteger(runningBalance) || runningBalance < 0 || entry.balanceAfter !== runningBalance) {
      fail('INVALID_STATE', `${path} breaks balance conservation`);
    }
  }
  const initial = value[0];
  if (initial.balanceAfter !== initial.delta) {
    fail('INVALID_STATE', 'initial balance witness is inconsistent');
  }
  if (runningBalance !== balance || seenPurchases.size !== purchaseLedger.length || seenRefreshes.size !== refreshLedger.length) {
    fail('INVALID_STATE', 'balance ledger does not match account state');
  }
  assertStateBusinessKey(balanceWitnessValue, 'state.balanceWitness');
  const expectedWitness = reputationShopBalanceWitness({
    balance,
    balanceLedger: value,
    processedPurchases,
    purchaseLedger,
    purchased,
    inventory,
    processedRefreshes,
    refreshLedger,
  });
  if (balanceWitnessValue !== expectedWitness) fail('INVALID_STATE', 'balance witness mismatch');
}

function assertTrustedAnchorShape(value: unknown): asserts value is ReputationShopTrustedAnchor {
  assertPlainRecord(value, 'trustedAnchor');
  assertExactKeys(value, ['balanceLedger', 'expectedStateDigest'], 'trustedAnchor');
  if (!Array.isArray(value.balanceLedger)) fail('INVALID_STATE', 'trustedAnchor.balanceLedger must be an array');
  for (const [index, entry] of value.balanceLedger.entries()) {
    const path = `trustedAnchor.balanceLedger[${index}]`;
    assertPlainRecord(entry, path);
    assertExactKeys(entry, ['sequence', 'kind', 'referenceId', 'delta', 'balanceAfter'], path);
    assertSafeInteger(entry.sequence, `${path}.sequence`, 'INVALID_STATE');
    assertSafeInteger(entry.delta, `${path}.delta`, 'INVALID_STATE');
    assertNonNegativeInteger(entry.balanceAfter, `${path}.balanceAfter`);
    if (entry.kind !== 'INITIAL' && entry.kind !== 'PURCHASE' && entry.kind !== 'REFRESH') {
      fail('INVALID_STATE', `${path}.kind is invalid`);
    }
    if (typeof entry.referenceId !== 'string' || entry.referenceId.length === 0 || entry.referenceId.trim() !== entry.referenceId) {
      fail('INVALID_STATE', `${path}.referenceId is invalid`);
    }
  }
  assertStateBusinessKey(value.expectedStateDigest, 'trustedAnchor.expectedStateDigest');
}

function assertTrustedAnchorMatches(state: ReputationShopState, anchor: ReputationShopTrustedAnchor): void {
  if (canonicalJson(anchor.balanceLedger) !== canonicalJson(state.balanceLedger)) {
    fail('INVALID_STATE', 'trusted anchor balance ledger mismatch');
  }
  if (anchor.expectedStateDigest !== reputationShopStateDigest(state)) {
    fail('INVALID_STATE', 'trusted anchor state digest mismatch');
  }
}

function normalizeState(
  value: unknown,
  config: ReputationShopConfig,
  catalog: ReputationCatalog,
): ReputationShopState {
  assertPlainRecord(value, 'state');
  assertExactKeys(value, [
    'schemaVersion', 'balance', 'balanceLedger', 'balanceWitness', 'reputationState', 'inventory', 'purchased', 'offers', 'refreshCount',
    'processedPurchases', 'purchaseLedger', 'purchaseCount', 'purchaseSequence', 'processedRefreshes', 'refreshLedger',
  ], 'state');
  if (value.schemaVersion !== REPUTATION_SHOP_STATE_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported schemaVersion');
  assertNonNegativeInteger(value.balance, 'state.balance');
  let reputationState: ReputationState;
  try {
    reputationState = restoreReputationState(catalog, JSON.stringify(value.reputationState));
  } catch (error) {
    fail('INVALID_STATE', error instanceof Error ? error.message : String(error));
  }
  assertStringNumberMap(value.inventory, 'state.inventory');
  assertStringNumberMap(value.purchased, 'state.purchased');
  assertNonNegativeInteger(value.refreshCount, 'state.refreshCount');
  assertNonNegativeInteger(value.purchaseCount, 'state.purchaseCount');
  assertNonNegativeInteger(value.purchaseSequence, 'state.purchaseSequence');
  const itemIds = new Set(config.items.map((item) => item.id));
  const rewardIds = new Set(config.items.map((item) => item.reward.id));
  for (const [itemId, quantity] of Object.entries(value.purchased)) {
    const item = config.items.find((candidate) => candidate.id === itemId);
    if (!itemIds.has(itemId) || item === undefined || quantity <= 0 || quantity > item.purchaseLimit) fail('INVALID_STATE', `state.purchased.${itemId} exceeds the configured purchase limit`);
  }
  for (const [rewardId, quantity] of Object.entries(value.inventory)) {
    if (!rewardIds.has(rewardId) || quantity <= 0) fail('INVALID_STATE', `state.inventory.${rewardId} is invalid`);
  }
  if (!Array.isArray(value.offers) || value.offers.length !== config.offerCount) fail('INVALID_STATE', 'state.offers has an invalid count');
  const offerIds = new Set<string>();
  for (const [index, itemId] of value.offers.entries()) {
    if (typeof itemId !== 'string' || !itemIds.has(itemId) || offerIds.has(itemId)) fail('INVALID_STATE', `state.offers[${index}] is invalid`);
    offerIds.add(itemId);
  }
  const expectedOffers = selectOffers(config, value.refreshCount);
  if (value.offers.some((itemId, index) => itemId !== expectedOffers[index])) fail('INVALID_STATE', 'state.offers do not match refreshCount');
  assertPlainRecord(value.processedPurchases, 'state.processedPurchases');
  for (const [purchaseId, fingerprint] of Object.entries(value.processedPurchases)) assertStateBusinessKey(purchaseId, `state.processedPurchases.${purchaseId}`), parsePurchaseFingerprint(fingerprint, config, `state.processedPurchases.${purchaseId}`);
  assertPurchaseLedger(value.purchaseLedger, config, value.processedPurchases, value.purchased, value.inventory, value.purchaseCount, value.purchaseSequence);
  assertPlainRecord(value.processedRefreshes, 'state.processedRefreshes');
  assertRefreshLedger(value.refreshLedger, value.processedRefreshes, value.refreshCount);
  assertBalanceLedger(
    value.balanceLedger,
    config,
    value.balance,
    value.purchaseLedger,
    value.refreshLedger,
    value.processedPurchases,
    value.processedRefreshes,
    value.purchased,
    value.inventory,
    value.balanceWitness,
  );
  return freezeDeep({
    schemaVersion: REPUTATION_SHOP_STATE_SCHEMA_VERSION,
    balance: value.balance,
    balanceLedger: value.balanceLedger.map((entry) => ({ ...entry })),
    balanceWitness: value.balanceWitness,
    reputationState,
    inventory: sortedRecord(value.inventory),
    purchased: sortedRecord(value.purchased),
    offers: [...value.offers],
    refreshCount: value.refreshCount,
    processedPurchases: sortedRecord(value.processedPurchases),
    purchaseLedger: value.purchaseLedger.map((entry) => ({ ...entry })),
    purchaseCount: value.purchaseCount,
    purchaseSequence: value.purchaseSequence,
    processedRefreshes: sortedRecord(value.processedRefreshes),
    refreshLedger: value.refreshLedger.map((entry) => ({ ...entry })),
  });
}

function initialState(config: ReputationShopConfig, catalog: ReputationCatalog, balance: number, reputationState?: ReputationState): ReputationShopState {
  let normalizedReputation: ReputationState;
  try {
    normalizedReputation = reputationState === undefined
      ? catalog.createState()
      : restoreReputationState(catalog, JSON.stringify(reputationState));
  } catch (error) {
    fail('INVALID_CONFIG', error instanceof Error ? error.message : String(error));
  }
  const balanceLedger: ReputationShopBalanceLedgerEntry[] = [{
    sequence: 0,
    kind: 'INITIAL',
    referenceId: 'INITIAL',
    delta: balance,
    balanceAfter: balance,
  }];
  return freezeDeep(sealBalanceWitness({
    schemaVersion: REPUTATION_SHOP_STATE_SCHEMA_VERSION,
    balance,
    balanceLedger,
    reputationState: normalizedReputation,
    inventory: {},
    purchased: {},
    offers: selectOffers(config, 0),
    refreshCount: 0,
    processedPurchases: {},
    purchaseLedger: [],
    purchaseCount: 0,
    purchaseSequence: 0,
    processedRefreshes: {},
    refreshLedger: [],
  }));
}

function copyState(value: ReputationShopState): ReputationShopState {
  return freezeDeep(clone(value));
}

function operation(
  state: ReputationShopState,
  code: ReputationShopOperationCode,
  applied: boolean,
  details: Partial<Omit<ReputationShopOperationResult, 'state' | 'code' | 'applied'>> = {},
): ReputationShopOperationResult {
  return { applied, code, state: copyState(state), ...details };
}

export function serializeReputationShop(
  state: ReputationShopState,
  config: ReputationShopConfig = reputationShopConfig,
  catalog: ReputationCatalog = createDefaultReputationShopCatalog(),
): string {
  return canonicalJson(normalizeState(state, config, catalog));
}

export function restoreReputationShop(
  serialized: string,
  config: ReputationShopConfig = reputationShopConfig,
  catalog: ReputationCatalog = createDefaultReputationShopCatalog(),
  trustedAnchor?: ReputationShopTrustedAnchor,
): ReputationShopState {
  assertTrustedAnchorShape(trustedAnchor);
  if (typeof serialized !== 'string' || serialized.trim().length === 0) fail('INVALID_STATE', 'reputation shop save must be a non-empty string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'reputation shop save is not valid JSON');
  }
  const state = normalizeState(parsed, config, catalog);
  assertTrustedAnchorMatches(state, trustedAnchor);
  return state;
}

export class ReputationShopService {
  private readonly config: ReputationShopConfig;
  private readonly catalog: ReputationCatalog;
  private readonly persist: ReputationShopPersistence;
  private current: ReputationShopState;
  private committing = false;

  constructor(options: ReputationShopOptions = {}) {
    this.catalog = options.catalog ?? options.reputationCatalog ?? createDefaultReputationShopCatalog();
    try {
      this.config = loadReputationShopConfig(options.config ?? REPUTATION_SHOP_CATALOG_DATA, this.catalog);
    } catch (error) {
      if (error instanceof ReputationShopConfigError) fail('INVALID_CONFIG', error.message);
      fail('INVALID_CONFIG', error instanceof Error ? error.message : String(error));
    }
    this.persist = options.persist ?? (() => {});
    if (typeof this.persist !== 'function') fail('INVALID_CONFIG', 'persist must be a function');
    if (options.initialState !== undefined) {
      this.current = restoreReputationShop(options.initialState, this.config, this.catalog, options.trustedAnchor);
    } else {
      const balance = options.balance ?? 0;
      assertNonNegativeInteger(balance, 'balance', 'INVALID_CONFIG');
      this.current = initialState(this.config, this.catalog, balance, options.reputationState);
    }
  }

  snapshot(): ReputationShopState {
    return copyState(this.current);
  }

  save(): string {
    return serializeReputationShop(this.current, this.config, this.catalog);
  }

  purchase(purchaseId: string, itemId: string, quantity = 1): ReputationShopOperationResult {
    assertBusinessKey(purchaseId, 'purchaseId');
    assertBusinessKey(itemId, 'itemId');
    assertPositiveInteger(quantity, 'quantity');
    const fingerprint = `${itemId}:${quantity}`;
    const previous = hasOwn(this.current.processedPurchases, purchaseId)
      ? this.current.processedPurchases[purchaseId]
      : undefined;
    if (previous !== undefined) return operation(this.current, previous === fingerprint ? 'DUPLICATE' : 'CONFLICT', false);
    const item = itemById(this.config, itemId);
    if (!this.current.offers.includes(item.id)) return operation(this.current, 'NOT_OFFERED', false);
    const reputationEntry = this.current.reputationState.points.find((entry) => entry.trackId === item.trackId);
    if (reputationEntry === undefined) fail('INVALID_STATE', `missing reputation track: ${item.trackId}`);
    const level = this.catalog.levelFor(item.trackId, reputationEntry.points);
    if (level < item.requiredLevel) return operation(this.current, 'LEVEL_LOCKED', false);
    const purchased = this.current.purchased[item.id] ?? 0;
    if (quantity > item.purchaseLimit - purchased) return operation(this.current, 'LIMIT_REACHED', false);
    if (quantity > Math.floor(Number.MAX_SAFE_INTEGER / item.cost)) fail('INVALID_INPUT', 'purchase cost would overflow');
    const spent = item.cost * quantity;
    if (spent > this.current.balance) return operation(this.current, 'INSUFFICIENT_FUNDS', false);
    const rewardQuantity = item.reward.quantity * quantity;
    if (!Number.isSafeInteger(rewardQuantity)) fail('INVALID_INPUT', 'reward quantity would overflow');
    const nextInventory = { ...this.current.inventory, [item.reward.id]: (this.current.inventory[item.reward.id] ?? 0) + rewardQuantity };
    if (!Number.isSafeInteger(nextInventory[item.reward.id])) fail('INVALID_STATE', 'inventory quantity would overflow');
    if (this.current.purchaseCount === Number.MAX_SAFE_INTEGER) fail('INVALID_STATE', 'purchase count would overflow');
    if (this.current.purchaseSequence === Number.MAX_SAFE_INTEGER) fail('INVALID_STATE', 'purchase sequence would overflow');
    const nextPurchaseSequence = this.current.purchaseSequence + 1;
    const next = sealBalanceWitness({
      ...this.current,
      balance: this.current.balance - spent,
      balanceLedger: [...this.current.balanceLedger, {
        sequence: this.current.balanceLedger.length,
        kind: 'PURCHASE',
        referenceId: purchaseId,
        delta: -spent,
        balanceAfter: this.current.balance - spent,
      }],
      inventory: nextInventory,
      purchased: { ...this.current.purchased, [item.id]: purchased + quantity },
      processedPurchases: { ...this.current.processedPurchases, [purchaseId]: fingerprint },
      purchaseLedger: [...this.current.purchaseLedger, { sequence: nextPurchaseSequence, purchaseId, fingerprint }],
      purchaseCount: this.current.purchaseCount + 1,
      purchaseSequence: nextPurchaseSequence,
    });
    this.commit(next);
    return operation(this.current, 'APPLIED', true, { spent, reward: item.reward });
  }

  redeem(purchaseId: string, itemId: string, quantity = 1): ReputationShopOperationResult {
    return this.purchase(purchaseId, itemId, quantity);
  }

  refresh(refreshId: string): ReputationShopOperationResult {
    assertBusinessKey(refreshId, 'refreshId');
    if (hasOwn(this.current.processedRefreshes, refreshId)) return operation(this.current, 'DUPLICATE', false);
    if (this.current.balance < this.config.refreshCost) return operation(this.current, 'INSUFFICIENT_FUNDS', false);
    if (this.current.refreshCount === Number.MAX_SAFE_INTEGER) fail('INVALID_STATE', 'refresh count would overflow');
    const nextRefreshCount = this.current.refreshCount + 1;
    const next = sealBalanceWitness({
      ...this.current,
      balance: this.current.balance - this.config.refreshCost,
      balanceLedger: [...this.current.balanceLedger, {
        sequence: this.current.balanceLedger.length,
        kind: 'REFRESH',
        referenceId: refreshId,
        delta: -this.config.refreshCost,
        balanceAfter: this.current.balance - this.config.refreshCost,
      }],
      offers: selectOffers(this.config, nextRefreshCount),
      refreshCount: nextRefreshCount,
      processedRefreshes: { ...this.current.processedRefreshes, [refreshId]: 'refresh' },
      refreshLedger: [...this.current.refreshLedger, { sequence: nextRefreshCount, refreshId }],
    });
    this.commit(next);
    return operation(this.current, 'APPLIED', true, { spent: this.config.refreshCost });
  }

  private commit(next: ReputationShopState): void {
    const normalized = normalizeState(next, this.config, this.catalog);
    if (this.committing) fail('PERSISTENCE_FAILED', 'reputation shop persistence is reentrant');
    this.committing = true;
    try {
      this.persist(serializeReputationShop(normalized, this.config, this.catalog));
    } catch (error) {
      throw new ReputationShopError('PERSISTENCE_FAILED', error instanceof Error ? error.message : String(error));
    } finally {
      this.committing = false;
    }
    this.current = copyState(normalized);
  }
}
