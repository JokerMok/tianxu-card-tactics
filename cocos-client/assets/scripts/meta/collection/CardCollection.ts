import { CARD_QUALITY_LEVELS, type CardQuality } from '../cards/quality/CardQuality.ts';

export const CARD_COLLECTION_SCHEMA_VERSION = 1 as const;

export type CardCollectionRewardTrigger = 'FIRST_ACQUISITION' | 'QUALITY_REACHED' | 'COLLECTION_COUNT';

export interface CardCollectionEntry {
  readonly cardId: string;
  readonly quantity: number;
  readonly highestQuality: CardQuality;
}

export interface CardCollectionProgress {
  readonly collectedCount: number;
  readonly totalCount: number;
  readonly percentage: number;
}

export interface CardCollectionRewardDefinition {
  readonly id: string;
  readonly trigger: CardCollectionRewardTrigger;
  readonly cardId?: string;
  readonly quality?: CardQuality;
  readonly count?: number;
  readonly reward: unknown;
}

export interface CardCollectionRewardGrant {
  readonly id: string;
  readonly trigger: CardCollectionRewardTrigger;
  readonly reward: unknown;
}

export interface CardCollectionAcquireInput {
  readonly cardId: unknown;
  readonly quality: unknown;
  readonly quantity: unknown;
}

export interface CardCollectionAcquireResult {
  readonly requestId: string;
  readonly applied: boolean;
  readonly idempotent: boolean;
  readonly firstAcquisition: boolean;
  readonly qualityUpgraded: boolean;
  readonly entry: CardCollectionEntry;
  readonly progress: CardCollectionProgress;
  readonly rewards: readonly CardCollectionRewardGrant[];
}

export interface CardCollectionProcessedRequest {
  readonly requestId: string;
  readonly fingerprint: string;
  readonly result: CardCollectionAcquireResult;
}

export interface CardCollectionState {
  readonly schemaVersion: typeof CARD_COLLECTION_SCHEMA_VERSION;
  readonly cards: readonly CardCollectionEntry[];
  readonly claimedRewards: readonly string[];
  readonly processedRequests: readonly CardCollectionProcessedRequest[];
  readonly initialCards?: readonly CardCollectionEntry[];
  readonly initialClaimedRewards?: readonly string[];
}

export interface CardCollectionOptions {
  readonly metadata: readonly unknown[] | { readonly cards: readonly unknown[] };
  readonly qualityCatalog?: unknown;
  readonly rewards?: readonly unknown[];
  readonly state?: unknown;
  readonly persist?: (serialized: string) => void;
  readonly onSave?: (serialized: string) => void;
}

export type CardCollectionErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_REQUEST_ID'
  | 'INVALID_REQUEST'
  | 'INVALID_CARD_ID'
  | 'UNKNOWN_CARD'
  | 'INVALID_QUALITY'
  | 'INVALID_QUANTITY'
  | 'QUANTITY_EXCEEDED'
  | 'UNKNOWN_REWARD'
  | 'REQUEST_CONFLICT'
  | 'PERSISTENCE_FAILED'
  | 'PERSISTENCE_REENTRANT';

const CARD_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const REQUEST_ID_PATTERN = /^\S(?:.*\S)?$/;
const REWARD_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]*$/;
const CARD_KEYS = new Set(['cardId', 'quantity', 'highestQuality']);
const REQUEST_KEYS = new Set(['cardId', 'quality', 'quantity']);
const REQUEST_ENVELOPE_KEYS = new Set(['requestId', 'cardId', 'quality', 'quantity']);
const REWARD_KEYS = new Set(['id', 'trigger', 'cardId', 'quality', 'count', 'reward']);
const GRANT_KEYS = new Set(['id', 'trigger', 'reward']);
const RESULT_KEYS = new Set([
  'requestId', 'applied', 'idempotent', 'firstAcquisition', 'qualityUpgraded', 'entry', 'progress', 'rewards',
]);
const PROCESSED_REQUEST_KEYS = new Set(['requestId', 'fingerprint', 'result']);
const STATE_KEYS = new Set(['schemaVersion', 'cards', 'claimedRewards', 'processedRequests', 'initialCards', 'initialClaimedRewards']);
const TRIGGERS = new Set<CardCollectionRewardTrigger>([
  'FIRST_ACQUISITION', 'QUALITY_REACHED', 'COLLECTION_COUNT',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

interface CardAuthority {
  readonly id: string;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { readonly [key: string]: JsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(code: CardCollectionErrorCode, message: string): never {
  throw new CardCollectionError(code, message);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string, code: CardCollectionErrorCode): void {
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_KEYS.has(key) || !allowed.has(key)) fail(code, `${label} contains an unknown field: ${key}`);
  }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function validQuality(value: unknown): value is CardQuality {
  return typeof value === 'number' && CARD_QUALITY_LEVELS.includes(value as CardQuality);
}

function normalizeRequestId(value: unknown): string {
  if (typeof value !== 'string' || !REQUEST_ID_PATTERN.test(value)) fail('INVALID_REQUEST_ID', 'request ID must be a non-empty trimmed string');
  return value;
}

function metadataRows(input: readonly unknown[] | { readonly cards: readonly unknown[] }): readonly unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && hasOwn(input, 'cards') && Array.isArray(input.cards)) return input.cards;
  fail('INVALID_CONFIG', 'card metadata must be an array or a cards table');
}

function normalizeMetadata(input: readonly unknown[] | { readonly cards: readonly unknown[] }): ReadonlyMap<string, CardAuthority> {
  const result = new Map<string, CardAuthority>();
  for (const [index, raw] of metadataRows(input).entries()) {
    if (!isRecord(raw)) fail('INVALID_CONFIG', `card metadata row ${index} must be an object`);
    if (hasOwn(raw, 'enabled') && raw.enabled === false) continue;
    if (!hasOwn(raw, 'id') || typeof raw.id !== 'string' || !CARD_ID_PATTERN.test(raw.id) || result.has(raw.id)) {
      fail('INVALID_CONFIG', `card metadata row ${index} has an invalid or duplicate ID`);
    }
    result.set(raw.id, { id: raw.id });
  }
  if (result.size === 0) fail('INVALID_CONFIG', 'card metadata is empty');
  return result;
}

function cloneJson(value: unknown, code: CardCollectionErrorCode, seen = new WeakSet<object>()): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || value === null) fail(code, 'reward payload must be JSON-compatible');
  if (seen.has(value)) fail(code, 'reward payload must not contain cycles');
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => cloneJson(item, code, seen));
    seen.delete(value);
    return Object.freeze(result);
  }
  if (!isRecord(value)) fail(code, 'reward payload contains a non-plain object');
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value).sort()) {
    if (FORBIDDEN_KEYS.has(key)) fail(code, `reward payload contains a forbidden key: ${key}`);
    result[key] = cloneJson(value[key], code, seen);
  }
  seen.delete(value);
  return Object.freeze(result);
}

function cloneJsonOutput(value: unknown): JsonValue {
  return cloneJson(value, 'INVALID_STATE');
}

function normalizeQualityAuthority(value: unknown, metadata: ReadonlyMap<string, CardAuthority>): ReadonlySet<string> {
  const keys = new Set<string>();
  if (value === undefined) {
    for (const cardId of metadata.keys()) for (const quality of CARD_QUALITY_LEVELS) keys.add(`${cardId}:${quality}`);
    return keys;
  }

  let source = value;
  if (source !== null && typeof source === 'object') {
    const sourceObject = source as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(sourceObject);
    const snapshot = hasOwn(sourceObject, 'snapshot')
      ? sourceObject.snapshot
      : prototype !== null && prototype !== Object.prototype && hasOwn(prototype, 'snapshot')
        ? prototype.snapshot
        : undefined;
    if (typeof snapshot === 'function') {
    try {
        source = snapshot.call(sourceObject);
    } catch (error) {
      fail('INVALID_CONFIG', `quality catalog snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    }
  }
  const entries = Array.isArray(source)
    ? source
    : isRecord(source) && hasOwn(source, 'entries') && Array.isArray(source.entries) ? source.entries : undefined;
  if (!entries) fail('INVALID_CONFIG', 'quality catalog must expose an entries array');
  for (const [index, raw] of entries.entries()) {
    if (!isRecord(raw) || !hasOwn(raw, 'cardId') || !hasOwn(raw, 'quality')
      || typeof raw.cardId !== 'string' || !metadata.has(raw.cardId) || !validQuality(raw.quality)) {
      fail('INVALID_CONFIG', `quality catalog entry ${index} is invalid`);
    }
    const key = `${raw.cardId}:${raw.quality}`;
    if (keys.has(key)) fail('INVALID_CONFIG', `quality catalog contains a duplicate entry: ${key}`);
    keys.add(key);
  }
  for (const cardId of metadata.keys()) {
    for (const quality of CARD_QUALITY_LEVELS) {
      if (!keys.has(`${cardId}:${quality}`)) fail('INVALID_CONFIG', `quality catalog is missing ${cardId}:${quality}`);
    }
  }
  return keys;
}

function normalizeReward(raw: unknown, metadata: ReadonlyMap<string, CardAuthority>, qualityKeys: ReadonlySet<string>, index: number): CardCollectionRewardDefinition {
  if (!isRecord(raw)) fail('INVALID_CONFIG', `rewards[${index}] must be an object`);
  assertOnlyKeys(raw, REWARD_KEYS, `rewards[${index}]`, 'INVALID_CONFIG');
  if (!hasOwn(raw, 'id') || typeof raw.id !== 'string' || !REWARD_ID_PATTERN.test(raw.id)) fail('INVALID_CONFIG', `rewards[${index}].id is invalid`);
  if (!hasOwn(raw, 'trigger') || typeof raw.trigger !== 'string' || !TRIGGERS.has(raw.trigger as CardCollectionRewardTrigger)) {
    fail('INVALID_CONFIG', `rewards[${index}].trigger is invalid`);
  }
  if (!hasOwn(raw, 'reward')) fail('INVALID_CONFIG', `rewards[${index}].reward is required`);
  const trigger = raw.trigger as CardCollectionRewardTrigger;
  const cardId = hasOwn(raw, 'cardId') ? raw.cardId : undefined;
  const quality = hasOwn(raw, 'quality') ? raw.quality : undefined;
  const count = hasOwn(raw, 'count') ? raw.count : undefined;
  if (cardId !== undefined && (typeof cardId !== 'string' || !CARD_ID_PATTERN.test(cardId) || !metadata.has(cardId))) {
    fail('INVALID_CONFIG', `rewards[${index}].cardId is unknown`);
  }
  if (trigger === 'FIRST_ACQUISITION' && cardId === undefined) fail('INVALID_CONFIG', `rewards[${index}] first reward needs cardId`);
  if (trigger === 'COLLECTION_COUNT' && !positiveInteger(count)) fail('INVALID_CONFIG', `rewards[${index}].count is invalid`);
  if (trigger === 'QUALITY_REACHED' && quality === undefined) fail('INVALID_CONFIG', `rewards[${index}] quality reward needs quality`);
  if (trigger === 'FIRST_ACQUISITION' && (count !== undefined || quality !== undefined)) {
    fail('INVALID_CONFIG', `rewards[${index}] first reward cannot use count or quality`);
  }
  if (trigger === 'QUALITY_REACHED' && count !== undefined) fail('INVALID_CONFIG', `rewards[${index}] quality reward cannot use count`);
  if (trigger === 'COLLECTION_COUNT' && (cardId !== undefined || quality !== undefined)) {
    fail('INVALID_CONFIG', `rewards[${index}] collection reward cannot target a card or quality`);
  }
  if (quality !== undefined) {
    if (!validQuality(quality)) fail('INVALID_CONFIG', `rewards[${index}].quality is invalid`);
    if (cardId !== undefined && !qualityKeys.has(`${cardId}:${quality}`)) fail('INVALID_CONFIG', `rewards[${index}] quality is not configured for card`);
  }
  if (trigger === 'FIRST_ACQUISITION' && quality !== undefined) fail('INVALID_CONFIG', `rewards[${index}] first reward cannot use quality`);
  return Object.freeze({
    id: raw.id,
    trigger,
    ...(cardId === undefined ? {} : { cardId }),
    ...(quality === undefined ? {} : { quality }),
    ...(count === undefined ? {} : { count }),
    reward: cloneJson(raw.reward, 'INVALID_CONFIG'),
  });
}

function normalizeRewards(input: readonly unknown[] | undefined, metadata: ReadonlyMap<string, CardAuthority>, qualityKeys: ReadonlySet<string>): readonly CardCollectionRewardDefinition[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input)) fail('INVALID_CONFIG', 'rewards must be an array');
  const ids = new Set<string>();
  const rewards = input.map((raw, index) => {
    const reward = normalizeReward(raw, metadata, qualityKeys, index);
    if (ids.has(reward.id)) fail('INVALID_CONFIG', `duplicate collection reward: ${reward.id}`);
    ids.add(reward.id);
    return reward;
  });
  return Object.freeze(rewards.sort((left, right) => left.id.localeCompare(right.id)));
}

function normalizeCard(raw: unknown, metadata: ReadonlyMap<string, CardAuthority>, qualityKeys: ReadonlySet<string>, code: CardCollectionErrorCode): CardCollectionEntry {
  if (!isRecord(raw)) fail(code, 'collection card entry must be an object');
  assertOnlyKeys(raw, CARD_KEYS, 'collection card entry', code);
  for (const key of CARD_KEYS) if (!hasOwn(raw, key)) fail(code, `collection card entry.${key} is required`);
  if (typeof raw.cardId !== 'string' || !CARD_ID_PATTERN.test(raw.cardId)) fail(code, 'collection card ID is invalid');
  if (!metadata.has(raw.cardId)) fail(code, `collection card is unknown: ${raw.cardId}`);
  if (!positiveInteger(raw.quantity)) fail(code, 'collection quantity must be a positive safe integer');
  if (!validQuality(raw.highestQuality)) fail(code, 'collection highest quality must be an integer from 1 to 6');
  if (!qualityKeys.has(`${raw.cardId}:${raw.highestQuality}`)) fail(code, 'collection card quality is not configured');
  return { cardId: raw.cardId, quantity: raw.quantity, highestQuality: raw.highestQuality };
}

function normalizeCards(value: unknown, metadata: ReadonlyMap<string, CardAuthority>, qualityKeys: ReadonlySet<string>, code: CardCollectionErrorCode): CardCollectionEntry[] {
  if (!Array.isArray(value)) fail(code, 'collection cards must be an array');
  const cards = value.map((card) => normalizeCard(card, metadata, qualityKeys, code));
  const cardIds = new Set<string>();
  for (const card of cards) {
    if (cardIds.has(card.cardId)) fail(code, `duplicate collection card: ${card.cardId}`);
    cardIds.add(card.cardId);
  }
  return cards.sort((left, right) => left.cardId.localeCompare(right.cardId));
}

function normalizeClaimedRewards(value: unknown, rewardsById: ReadonlyMap<string, CardCollectionRewardDefinition>): string[] {
  if (!Array.isArray(value)) fail('INVALID_STATE', 'claimed rewards must be an array');
  const claimed: string[] = [];
  const seen = new Set<string>();
  for (const rewardId of value) {
    if (typeof rewardId !== 'string' || !rewardsById.has(rewardId) || seen.has(rewardId)) {
      fail('INVALID_STATE', 'claimed rewards contain an invalid or duplicate ID');
    }
    seen.add(rewardId);
    claimed.push(rewardId);
  }
  return claimed;
}

function normalizeProgress(value: unknown, metadataCount: number, code: CardCollectionErrorCode): CardCollectionProgress {
  if (!isRecord(value)) fail(code, 'collection progress must be an object');
  const keys = new Set(['collectedCount', 'totalCount', 'percentage']);
  assertOnlyKeys(value, keys, 'collection progress', code);
  if (!hasOwn(value, 'collectedCount') || !hasOwn(value, 'totalCount') || !hasOwn(value, 'percentage')) {
    fail(code, 'collection progress is incomplete');
  }
  const collectedCount = value.collectedCount;
  const totalCount = value.totalCount;
  const percentage = value.percentage;
  if (!Number.isSafeInteger(collectedCount) || collectedCount < 0
    || collectedCount > metadataCount || totalCount !== metadataCount
    || typeof percentage !== 'number' || percentage !== (metadataCount === 0 ? 0 : collectedCount / metadataCount)) {
    fail(code, 'collection progress is inconsistent');
  }
  return { collectedCount, totalCount, percentage };
}

function normalizeGrant(value: unknown, rewardsById: ReadonlyMap<string, CardCollectionRewardDefinition>, code: CardCollectionErrorCode): CardCollectionRewardGrant {
  if (!isRecord(value)) fail(code, 'collection reward grant must be an object');
  assertOnlyKeys(value, GRANT_KEYS, 'collection reward grant', code);
  if (!hasOwn(value, 'id') || !hasOwn(value, 'trigger') || typeof value.id !== 'string') fail(code, 'collection reward grant identity is invalid');
  const definition = rewardsById.get(value.id);
  if (!definition || value.trigger !== definition.trigger) fail(code, `unknown collection reward: ${String(value.id)}`);
  if (!hasOwn(value, 'reward')) fail(code, 'collection reward grant payload is required');
  const reward = cloneJson(value.reward, code);
  if (JSON.stringify(reward) !== JSON.stringify(definition.reward)) fail(code, `collection reward payload does not match: ${definition.id}`);
  return Object.freeze({ id: definition.id, trigger: definition.trigger, reward });
}

interface NormalizedProcessedRequest {
  readonly requestId: string;
  readonly fingerprint: string;
  readonly input: CardCollectionAcquireInput;
  readonly result: CardCollectionAcquireResult;
}

interface DerivedAcquireTransition {
  readonly nextCards: readonly CardCollectionEntry[];
  readonly nextClaimedRewards: ReadonlySet<string>;
  readonly result: CardCollectionAcquireResult;
}

function normalizeProcessedFingerprint(
  value: unknown,
  metadata: ReadonlyMap<string, CardAuthority>,
  qualityKeys: ReadonlySet<string>,
): { readonly fingerprint: string; readonly input: CardCollectionAcquireInput } {
  if (typeof value !== 'string') fail('INVALID_STATE', 'processed request fingerprint is invalid');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail('INVALID_STATE', 'processed request fingerprint is not valid JSON');
  }
  if (!isRecord(parsed)) fail('INVALID_STATE', 'processed request fingerprint must be an object');
  assertOnlyKeys(parsed, REQUEST_KEYS, 'processed request fingerprint', 'INVALID_STATE');
  for (const key of REQUEST_KEYS) if (!hasOwn(parsed, key)) fail('INVALID_STATE', `processed request fingerprint.${key} is required`);
  if (typeof parsed.cardId !== 'string' || !CARD_ID_PATTERN.test(parsed.cardId) || !metadata.has(parsed.cardId)) {
    fail('INVALID_STATE', 'processed request fingerprint card ID is invalid');
  }
  if (!validQuality(parsed.quality) || !qualityKeys.has(`${parsed.cardId}:${parsed.quality}`)) {
    fail('INVALID_STATE', 'processed request fingerprint quality is invalid or not configured');
  }
  if (!positiveInteger(parsed.quantity)) fail('INVALID_STATE', 'processed request fingerprint quantity is invalid');
  const input: CardCollectionAcquireInput = {
    cardId: parsed.cardId,
    quality: parsed.quality,
    quantity: parsed.quantity,
  };
  if (value !== fingerprint(input)) fail('INVALID_STATE', 'processed request fingerprint is not canonical');
  return { fingerprint: value, input };
}

function sameEntry(left: CardCollectionEntry, right: CardCollectionEntry): boolean {
  return left.cardId === right.cardId
    && left.quantity === right.quantity
    && left.highestQuality === right.highestQuality;
}

function sameProgress(left: CardCollectionProgress, right: CardCollectionProgress): boolean {
  return left.collectedCount === right.collectedCount
    && left.totalCount === right.totalCount
    && left.percentage === right.percentage;
}

function sameRewards(left: readonly CardCollectionRewardGrant[], right: readonly CardCollectionRewardGrant[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((grant, index) => grant.id === right[index].id
    && grant.trigger === right[index].trigger
    && JSON.stringify(grant.reward) === JSON.stringify(right[index].reward));
}

function stateSafeAdd(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left > Number.MAX_SAFE_INTEGER - right) {
    fail('INVALID_STATE', 'processed request quantities exceed the safe integer limit');
  }
  return left + right;
}

function deriveAcquireTransition(
  requestId: string,
  input: CardCollectionAcquireInput,
  currentCards: readonly CardCollectionEntry[],
  currentClaimedRewards: ReadonlySet<string>,
  totalCount: number,
  rewards: readonly CardCollectionRewardDefinition[],
): DerivedAcquireTransition {
  const currentCard = currentCards.find((card) => card.cardId === input.cardId);
  const nextCard: CardCollectionEntry = currentCard === undefined
    ? { cardId: input.cardId as string, quantity: input.quantity as number, highestQuality: input.quality as CardQuality }
    : {
      cardId: input.cardId as string,
      quantity: checkedAdd(currentCard.quantity, input.quantity as number),
      highestQuality: Math.max(currentCard.highestQuality, input.quality as CardQuality) as CardQuality,
    };
  const nextCards = currentCards.filter((card) => card.cardId !== input.cardId).concat(nextCard)
    .sort((left, right) => left.cardId.localeCompare(right.cardId));
  const nextProgress = progressFor(nextCards, totalCount);
  const claimed = new Set(currentClaimedRewards);
  const grantedRewards: CardCollectionRewardGrant[] = [];
  for (const definition of rewards) {
    if (!claimed.has(definition.id) && isRewardEligible(definition, nextCards, nextProgress.collectedCount)) {
      claimed.add(definition.id);
      grantedRewards.push({ id: definition.id, trigger: definition.trigger, reward: cloneJsonOutput(definition.reward) });
    }
  }
  return {
    nextCards,
    nextClaimedRewards: claimed,
    result: freezeResult({
      requestId,
      applied: true,
      idempotent: false,
      firstAcquisition: currentCard === undefined,
      qualityUpgraded: currentCard === undefined || (input.quality as CardQuality) > currentCard.highestQuality,
      entry: nextCard,
      progress: nextProgress,
      rewards: grantedRewards,
    }),
  };
}

function assertResultMatches(actual: CardCollectionAcquireResult, expected: CardCollectionAcquireResult): void {
  if (actual.requestId !== expected.requestId
    || actual.applied !== expected.applied
    || actual.idempotent !== expected.idempotent
    || actual.firstAcquisition !== expected.firstAcquisition
    || actual.qualityUpgraded !== expected.qualityUpgraded
    || !sameEntry(actual.entry, expected.entry)
    || !sameProgress(actual.progress, expected.progress)
    || !sameRewards(actual.rewards, expected.rewards)) {
    fail('INVALID_STATE', `processed request result is inconsistent: ${actual.requestId}`);
  }
}

function sameCardList(left: readonly CardCollectionEntry[], right: readonly CardCollectionEntry[]): boolean {
  return left.length === right.length && left.every((card, index) => sameEntry(card, right[index]));
}

function sameIdSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

function seedQualityForCard(
  card: CardCollectionEntry,
  requests: readonly NormalizedProcessedRequest[],
  baselineQuantity: number,
): CardQuality | undefined {
  if (baselineQuantity === 0) return undefined;
  for (const baselineQuality of [...CARD_QUALITY_LEVELS].reverse()) {
    let currentCard: CardCollectionEntry = { cardId: card.cardId, quantity: baselineQuantity, highestQuality: baselineQuality };
    let valid = true;
    for (const request of requests) {
      const currentQuality = currentCard.highestQuality;
      const nextCard = {
        cardId: card.cardId,
        quantity: stateSafeAdd(currentCard.quantity, request.input.quantity as number),
        highestQuality: Math.max(currentQuality, request.input.quality as CardQuality) as CardQuality,
      };
      if (request.result.firstAcquisition !== false
        || request.result.qualityUpgraded !== ((request.input.quality as CardQuality) > currentQuality)
        || !sameEntry(request.result.entry, nextCard)) {
        valid = false;
        break;
      }
      currentCard = nextCard;
    }
    if (valid && sameEntry(currentCard, card)) return baselineQuality;
  }
  fail('INVALID_STATE', `processed request entries cannot reconstruct card: ${card.cardId}`);
}

function normalizeResult(value: unknown, metadataCount: number, metadata: ReadonlyMap<string, CardAuthority>, qualityKeys: ReadonlySet<string>, rewardsById: ReadonlyMap<string, CardCollectionRewardDefinition>, code: CardCollectionErrorCode): CardCollectionAcquireResult {
  if (!isRecord(value)) fail(code, 'processed request result must be an object');
  assertOnlyKeys(value, RESULT_KEYS, 'processed request result', code);
  const resultFields = ['requestId', 'applied', 'idempotent', 'firstAcquisition', 'qualityUpgraded', 'entry', 'progress', 'rewards'];
  if (resultFields.some((key) => !hasOwn(value, key))) fail(code, 'processed request result is incomplete');
  if (typeof value.requestId !== 'string' || !REQUEST_ID_PATTERN.test(value.requestId)
    || value.applied !== true || value.idempotent !== false
    || typeof value.firstAcquisition !== 'boolean' || typeof value.qualityUpgraded !== 'boolean') {
    fail(code, 'processed request result flags are invalid');
  }
  const entry = normalizeCard(value.entry, metadata, qualityKeys, code);
  const progress = normalizeProgress(value.progress, metadataCount, code);
  if (!Array.isArray(value.rewards)) fail(code, 'processed request rewards must be an array');
  const rewards = value.rewards.map((reward) => normalizeGrant(reward, rewardsById, code));
  const ids = new Set(rewards.map((reward) => reward.id));
  if (ids.size !== rewards.length) fail(code, 'processed request rewards contain duplicates');
  return Object.freeze({
    requestId: value.requestId,
    applied: true,
    idempotent: false,
    firstAcquisition: value.firstAcquisition,
    qualityUpgraded: value.qualityUpgraded,
    entry,
    progress,
    rewards: Object.freeze(rewards),
  });
}

function normalizeState(value: unknown, metadata: ReadonlyMap<string, CardAuthority>, qualityKeys: ReadonlySet<string>, rewards: readonly CardCollectionRewardDefinition[]): CardCollectionState {
  let parsed = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      fail('INVALID_STATE', 'saved collection state is not valid JSON');
    }
  }
  if (!isRecord(parsed)) fail('INVALID_STATE', 'saved collection state must be an object');
  assertOnlyKeys(parsed, STATE_KEYS, 'saved collection state', 'INVALID_STATE');
  for (const key of ['schemaVersion', 'cards', 'claimedRewards', 'processedRequests']) {
    if (!hasOwn(parsed, key)) fail('INVALID_STATE', `saved collection state.${key} is required`);
  }
  const hasInitialCards = hasOwn(parsed, 'initialCards');
  const hasInitialClaimedRewards = hasOwn(parsed, 'initialClaimedRewards');
  if (hasInitialCards !== hasInitialClaimedRewards) fail('INVALID_STATE', 'saved collection initial baseline is incomplete');
  if (parsed.schemaVersion !== CARD_COLLECTION_SCHEMA_VERSION || !Array.isArray(parsed.cards)
    || !Array.isArray(parsed.claimedRewards) || !Array.isArray(parsed.processedRequests)) {
    fail('INVALID_STATE', 'saved collection state is incomplete or unsupported');
  }
  const cards = normalizeCards(parsed.cards, metadata, qualityKeys, 'INVALID_STATE');

  const rewardsById = new Map(rewards.map((reward) => [reward.id, reward]));
  const claimedRewards: string[] = [];
  const claimed = new Set<string>();
  for (const rewardId of parsed.claimedRewards) {
    if (typeof rewardId !== 'string' || !rewardsById.has(rewardId) || claimed.has(rewardId)) fail('INVALID_STATE', 'claimed rewards contain an invalid or duplicate ID');
    claimed.add(rewardId);
    claimedRewards.push(rewardId);
  }
  const progress = progressFor(cards, metadata.size);
  for (const rewardId of claimedRewards) {
    if (!isRewardEligible(rewardsById.get(rewardId)!, cards, progress.collectedCount)) fail('INVALID_STATE', `claimed reward is not eligible: ${rewardId}`);
  }

  const processedRequests = parsed.processedRequests.map((raw): NormalizedProcessedRequest => {
    if (!isRecord(raw)) fail('INVALID_STATE', 'processed request must be an object');
    assertOnlyKeys(raw, PROCESSED_REQUEST_KEYS, 'processed request', 'INVALID_STATE');
    if (!hasOwn(raw, 'requestId') || !hasOwn(raw, 'fingerprint') || !hasOwn(raw, 'result')
      || typeof raw.requestId !== 'string' || !REQUEST_ID_PATTERN.test(raw.requestId) || typeof raw.fingerprint !== 'string') {
      fail('INVALID_STATE', 'processed request identity is invalid');
    }
    const normalizedFingerprint = normalizeProcessedFingerprint(raw.fingerprint, metadata, qualityKeys);
    const result = normalizeResult(raw.result, metadata.size, metadata, qualityKeys, rewardsById, 'INVALID_STATE');
    if (result.requestId !== raw.requestId) fail('INVALID_STATE', 'processed request result ID does not match');
    for (const reward of result.rewards) {
      if (!claimed.has(reward.id)) fail('INVALID_STATE', `processed request reward was not claimed: ${reward.id}`);
    }
    return Object.freeze({ requestId: raw.requestId, fingerprint: normalizedFingerprint.fingerprint, input: normalizedFingerprint.input, result });
  });
  const requestIds = new Set<string>();
  for (const request of processedRequests) {
    if (requestIds.has(request.requestId)) fail('INVALID_STATE', `duplicate processed request: ${request.requestId}`);
    requestIds.add(request.requestId);
  }

  const initialCards = hasInitialCards ? normalizeCards(parsed.initialCards, metadata, qualityKeys, 'INVALID_STATE') : undefined;
  const initialClaimedRewards = hasInitialClaimedRewards ? normalizeClaimedRewards(parsed.initialClaimedRewards, rewardsById) : undefined;
  if (initialCards !== undefined) {
    const initialProgress = progressFor(initialCards, metadata.size);
    for (const rewardId of initialClaimedRewards!) {
      if (!isRewardEligible(rewardsById.get(rewardId)!, initialCards, initialProgress.collectedCount)) {
        fail('INVALID_STATE', `initial claimed reward is not eligible: ${rewardId}`);
      }
    }
    if (processedRequests.length === 0 && (!sameCardList(initialCards, cards) || !sameIdSet(new Set(initialClaimedRewards!), claimed))) {
      fail('INVALID_STATE', 'initial baseline must match a state without processed requests');
    }
  }

  if (processedRequests.length > 0) {
    const requestsByCard = new Map<string, NormalizedProcessedRequest[]>();
    const requestQuantityByCard = new Map<string, number>();
    for (const request of processedRequests) {
      const cardId = request.input.cardId as string;
      const requestsForCard = requestsByCard.get(cardId) ?? [];
      requestsForCard.push(request);
      requestsByCard.set(cardId, requestsForCard);
      requestQuantityByCard.set(cardId, stateSafeAdd(requestQuantityByCard.get(cardId) ?? 0, request.input.quantity as number));
    }
    const cardsById = new Map(cards.map((card) => [card.cardId, card]));
    for (const cardId of requestsByCard.keys()) {
      if (!cardsById.has(cardId)) fail('INVALID_STATE', `processed request card is missing from collection: ${cardId}`);
    }

    let baselineCards: CardCollectionEntry[];
    let baselineClaimed: ReadonlySet<string>;
    if (initialCards !== undefined) {
      baselineCards = initialCards.map((card) => ({ ...card }));
      baselineClaimed = new Set(initialClaimedRewards!);
    } else {
      baselineCards = [];
      for (const card of cards) {
        const requestsForCard = requestsByCard.get(card.cardId);
        if (!requestsForCard) {
          baselineCards.push(card);
          continue;
        }
        const totalRequested = requestQuantityByCard.get(card.cardId)!;
        if (card.quantity < totalRequested) fail('INVALID_STATE', `processed request quantities exceed card: ${card.cardId}`);
        const baselineQuantity = card.quantity - totalRequested;
        const baselineQuality = seedQualityForCard(card, requestsForCard, baselineQuantity);
        if (baselineQuality !== undefined) baselineCards.push({ cardId: card.cardId, quantity: baselineQuantity, highestQuality: baselineQuality });
      }
      const grantedRewardIds = new Set<string>();
      for (const request of processedRequests) for (const reward of request.result.rewards) grantedRewardIds.add(reward.id);
      baselineClaimed = new Set(claimedRewards.filter((rewardId) => !grantedRewardIds.has(rewardId)));
    }
    const baselineProgress = progressFor(baselineCards, metadata.size);
    for (const rewardId of baselineClaimed) {
      if (!isRewardEligible(rewardsById.get(rewardId)!, baselineCards, baselineProgress.collectedCount)) {
        fail('INVALID_STATE', `claimed reward is not eligible before processed requests: ${rewardId}`);
      }
    }

    let replayCards = baselineCards;
    let replayClaimed: ReadonlySet<string> = baselineClaimed;
    for (const request of processedRequests) {
      const transition = deriveAcquireTransition(request.requestId, request.input, replayCards, replayClaimed, metadata.size, rewards);
      assertResultMatches(request.result, transition.result);
      replayCards = transition.nextCards.map((card) => ({ ...card }));
      replayClaimed = transition.nextClaimedRewards;
    }
    if (!sameCardList(replayCards, cards) || !sameIdSet(replayClaimed, claimed)) {
      fail('INVALID_STATE', 'collection cards or rewards cannot be reconstructed from processed requests');
    }
  }
  return freezeState({
    schemaVersion: CARD_COLLECTION_SCHEMA_VERSION,
    cards,
    claimedRewards,
    processedRequests: processedRequests.map(({ requestId, fingerprint, result }) => ({ requestId, fingerprint, result })),
    ...(initialCards === undefined ? {} : { initialCards, initialClaimedRewards }),
  });
}

function progressFor(cards: readonly CardCollectionEntry[], totalCount: number): CardCollectionProgress {
  const collectedCount = cards.length;
  return Object.freeze({ collectedCount, totalCount, percentage: totalCount === 0 ? 0 : collectedCount / totalCount });
}

function isRewardEligible(definition: CardCollectionRewardDefinition, cards: readonly CardCollectionEntry[], collectedCount: number): boolean {
  if (definition.trigger === 'COLLECTION_COUNT') return collectedCount >= definition.count!;
  if (definition.trigger === 'FIRST_ACQUISITION') return cards.some((card) => card.cardId === definition.cardId);
  return cards.some((card) => (definition.cardId === undefined || card.cardId === definition.cardId)
    && card.highestQuality >= definition.quality!);
}

function freezeState(state: CardCollectionState): CardCollectionState {
  const cards = Object.freeze(state.cards.map((card) => Object.freeze({ ...card })));
  const initialCards = state.initialCards === undefined
    ? undefined
    : Object.freeze(state.initialCards.map((card) => Object.freeze({ ...card })));
  const processedRequests = Object.freeze(state.processedRequests.map((request) => Object.freeze({
    requestId: request.requestId,
    fingerprint: request.fingerprint,
    result: freezeResult(request.result),
  })));
  return Object.freeze({
    schemaVersion: CARD_COLLECTION_SCHEMA_VERSION,
    cards,
    claimedRewards: Object.freeze([...state.claimedRewards].sort()),
    processedRequests,
    ...(initialCards === undefined ? {} : {
      initialCards,
      initialClaimedRewards: Object.freeze([...(state.initialClaimedRewards ?? [])].sort()),
    }),
  });
}

function freezeResult(result: CardCollectionAcquireResult): CardCollectionAcquireResult {
  return Object.freeze({
    requestId: result.requestId,
    applied: result.applied,
    idempotent: result.idempotent,
    firstAcquisition: result.firstAcquisition,
    qualityUpgraded: result.qualityUpgraded,
    entry: Object.freeze({ ...result.entry }),
    progress: Object.freeze({ ...result.progress }),
    rewards: Object.freeze(result.rewards.map((grant) => Object.freeze({
      id: grant.id,
      trigger: grant.trigger,
      reward: cloneJson(grant.reward, 'INVALID_STATE'),
    }))),
  });
}

function cloneResult(result: CardCollectionAcquireResult, idempotent = false): CardCollectionAcquireResult {
  return {
    requestId: result.requestId,
    applied: !idempotent,
    idempotent,
    firstAcquisition: result.firstAcquisition,
    qualityUpgraded: result.qualityUpgraded,
    entry: { ...result.entry },
    progress: { ...result.progress },
    rewards: result.rewards.map((grant) => ({
      id: grant.id,
      trigger: grant.trigger,
      reward: cloneJsonMutable(grant.reward),
    })),
  };
}

function cloneJsonMutable(value: unknown): JsonValue {
  if (value === null || typeof value === 'boolean' || typeof value === 'string' || typeof value === 'number') return value as JsonValue;
  if (Array.isArray(value)) return value.map((item) => cloneJsonMutable(item));
  if (!isRecord(value)) fail('INVALID_STATE', 'stored reward payload is invalid');
  const result: Record<string, JsonValue> = {};
  for (const key of Object.keys(value)) result[key] = cloneJsonMutable(value[key]);
  return result;
}

function fingerprint(input: CardCollectionAcquireInput): string {
  return JSON.stringify({ cardId: input.cardId, quality: input.quality, quantity: input.quantity });
}

function checkedAdd(left: number, right: number): number {
  if (left > Number.MAX_SAFE_INTEGER - right) fail('QUANTITY_EXCEEDED', 'collection quantity exceeds the safe integer limit');
  return left + right;
}

export class CardCollectionError extends Error {
  readonly code: CardCollectionErrorCode;
  readonly reason: CardCollectionErrorCode;

  constructor(code: CardCollectionErrorCode, message: string) {
    super(message);
    this.name = 'CardCollectionError';
    this.code = code;
    this.reason = code;
  }
}

export class CardCollectionService {
  private readonly metadata: ReadonlyMap<string, CardAuthority>;
  private readonly qualityKeys: ReadonlySet<string>;
  private readonly rewards: readonly CardCollectionRewardDefinition[];
  private readonly rewardsById: ReadonlyMap<string, CardCollectionRewardDefinition>;
  private readonly persist: (serialized: string) => void;
  private current: CardCollectionState;
  private committing = false;

  constructor(options: CardCollectionOptions) {
    if (!isRecord(options)) fail('INVALID_CONFIG', 'collection options must be an object');
    if (!hasOwn(options, 'metadata')) fail('INVALID_CONFIG', 'collection metadata is required');
    const persist = hasOwn(options, 'persist') ? options.persist : undefined;
    const onSave = hasOwn(options, 'onSave') ? options.onSave : undefined;
    if (persist !== undefined && onSave !== undefined) fail('INVALID_CONFIG', 'persist and onSave cannot both be provided');
    if (persist !== undefined && typeof persist !== 'function') fail('INVALID_CONFIG', 'persist must be a function');
    if (onSave !== undefined && typeof onSave !== 'function') fail('INVALID_CONFIG', 'onSave must be a function');
    this.metadata = normalizeMetadata(options.metadata);
    this.qualityKeys = normalizeQualityAuthority(hasOwn(options, 'qualityCatalog') ? options.qualityCatalog : undefined, this.metadata);
    this.rewards = normalizeRewards(hasOwn(options, 'rewards') ? options.rewards : undefined, this.metadata, this.qualityKeys);
    this.rewardsById = new Map(this.rewards.map((reward) => [reward.id, reward]));
    this.persist = persist ?? onSave ?? (() => {});
    this.current = normalizeState(hasOwn(options, 'state') ? options.state : {
      schemaVersion: CARD_COLLECTION_SCHEMA_VERSION, cards: [], claimedRewards: [], processedRequests: [],
    }, this.metadata, this.qualityKeys, this.rewards);
  }

  static restore(
    metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
    serialized: string,
    options: Omit<CardCollectionOptions, 'metadata' | 'state'> = {},
  ): CardCollectionService {
    return new CardCollectionService({ ...options, metadata, state: serialized });
  }

  snapshot(): CardCollectionState {
    return normalizeState(this.current, this.metadata, this.qualityKeys, this.rewards);
  }

  save(): string {
    return JSON.stringify(this.snapshot());
  }

  progress(): CardCollectionProgress {
    return progressFor(this.current.cards, this.metadata.size);
  }

  getCollectionProgress(): CardCollectionProgress {
    return this.progress();
  }

  list(): readonly CardCollectionEntry[] {
    return Object.freeze(this.current.cards.map((card) => Object.freeze({ ...card })));
  }

  getCard(cardId: string): CardCollectionEntry | undefined {
    if (typeof cardId !== 'string' || !CARD_ID_PATTERN.test(cardId)) fail('INVALID_CARD_ID', 'collection card ID is invalid');
    if (!this.metadata.has(cardId)) fail('UNKNOWN_CARD', `collection card is unknown: ${cardId}`);
    const card = this.current.cards.find((entry) => entry.cardId === cardId);
    return card === undefined ? undefined : Object.freeze({ ...card });
  }

  acquire(requestId: string, input: CardCollectionAcquireInput): CardCollectionAcquireResult;
  acquire(input: CardCollectionAcquireInput & { readonly requestId: string }): CardCollectionAcquireResult;
  acquire(
    requestIdOrInput: string | (CardCollectionAcquireInput & { readonly requestId: string }),
    inputValue?: CardCollectionAcquireInput,
  ): CardCollectionAcquireResult {
    if (this.committing) fail('PERSISTENCE_REENTRANT', 'collection persistence was re-entered');
    const requestId = normalizeRequestId(typeof requestIdOrInput === 'string'
      ? requestIdOrInput
      : (isRecord(requestIdOrInput) && hasOwn(requestIdOrInput, 'requestId') ? requestIdOrInput.requestId : undefined));
    const rawInput = typeof requestIdOrInput === 'string' ? inputValue : requestIdOrInput;
    if (!isRecord(rawInput)) fail('INVALID_REQUEST', 'collection acquisition input must be an object');
    assertOnlyKeys(
      rawInput,
      typeof requestIdOrInput === 'string' ? REQUEST_KEYS : REQUEST_ENVELOPE_KEYS,
      'collection acquisition input',
      'INVALID_REQUEST',
    );
    if (!hasOwn(rawInput, 'cardId') || !hasOwn(rawInput, 'quality') || !hasOwn(rawInput, 'quantity')) {
      fail('INVALID_REQUEST', 'collection acquisition requires cardId, quality and quantity');
    }
    const cardId = rawInput.cardId;
    if (typeof cardId !== 'string' || !CARD_ID_PATTERN.test(cardId)) fail('INVALID_CARD_ID', 'collection card ID is invalid');
    if (!this.metadata.has(cardId)) fail('UNKNOWN_CARD', `collection card is unknown: ${cardId}`);
    if (!validQuality(rawInput.quality) || !this.qualityKeys.has(`${cardId}:${rawInput.quality}`)) fail('INVALID_QUALITY', 'collection quality is invalid or not configured');
    if (!positiveInteger(rawInput.quantity)) fail('INVALID_QUANTITY', 'collection quantity must be a positive safe integer');
    const request: CardCollectionAcquireInput = { cardId, quality: rawInput.quality, quantity: rawInput.quantity };
    const requestFingerprint = fingerprint(request);
    const previous = this.current.processedRequests.find((entry) => entry.requestId === requestId);
    if (previous) {
      if (previous.fingerprint !== requestFingerprint) fail('REQUEST_CONFLICT', `request ID was already used with different input: ${requestId}`);
      return cloneResult(previous.result, true);
    }

    const transition = deriveAcquireTransition(requestId, request, this.current.cards, new Set(this.current.claimedRewards), this.metadata.size, this.rewards);
    const next = normalizeState({
      schemaVersion: CARD_COLLECTION_SCHEMA_VERSION,
      cards: transition.nextCards,
      claimedRewards: [...transition.nextClaimedRewards],
      processedRequests: [...this.current.processedRequests, { requestId, fingerprint: requestFingerprint, result: transition.result }],
      initialCards: this.current.initialCards ?? this.current.cards,
      initialClaimedRewards: this.current.initialClaimedRewards ?? this.current.claimedRewards,
    }, this.metadata, this.qualityKeys, this.rewards);
    this.commit(next);
    return cloneResult(transition.result);
  }

  acquireCard(requestId: string, input: CardCollectionAcquireInput): CardCollectionAcquireResult {
    return this.acquire(requestId, input);
  }

  private commit(next: CardCollectionState): void {
    this.committing = true;
    try {
      this.persist(JSON.stringify(next));
    } catch (error) {
      if (error instanceof CardCollectionError && error.code === 'PERSISTENCE_REENTRANT') throw error;
      throw new CardCollectionError('PERSISTENCE_FAILED', `collection state persistence failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.committing = false;
    }
    this.current = next;
  }
}

export function createCardCollectionService(options: CardCollectionOptions): CardCollectionService {
  return new CardCollectionService(options);
}

export function restoreCardCollectionService(
  metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
  serialized: string,
  options: Omit<CardCollectionOptions, 'metadata' | 'state'> = {},
): CardCollectionService {
  return CardCollectionService.restore(metadata, serialized, options);
}

export function serializeCardCollectionState(service: CardCollectionService): string {
  return service.save();
}

export const CollectionService = CardCollectionService;
