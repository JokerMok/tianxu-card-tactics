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
const STATE_KEYS = new Set(['schemaVersion', 'cards', 'claimedRewards', 'processedRequests']);
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
  if (isRecord(input) && Array.isArray(input.cards)) return input.cards;
  fail('INVALID_CONFIG', 'card metadata must be an array or a cards table');
}

function normalizeMetadata(input: readonly unknown[] | { readonly cards: readonly unknown[] }): ReadonlyMap<string, CardAuthority> {
  const result = new Map<string, CardAuthority>();
  for (const [index, raw] of metadataRows(input).entries()) {
    if (!isRecord(raw)) fail('INVALID_CONFIG', `card metadata row ${index} must be an object`);
    if (raw.enabled === false) continue;
    if (typeof raw.id !== 'string' || !CARD_ID_PATTERN.test(raw.id) || result.has(raw.id)) {
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
  if (source !== null && typeof source === 'object' && typeof (source as { snapshot?: unknown }).snapshot === 'function') {
    try {
      source = (source as { snapshot: () => unknown }).snapshot();
    } catch (error) {
      fail('INVALID_CONFIG', `quality catalog snapshot failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const entries = Array.isArray(source)
    ? source
    : isRecord(source) && Array.isArray(source.entries) ? source.entries : undefined;
  if (!entries) fail('INVALID_CONFIG', 'quality catalog must expose an entries array');
  for (const [index, raw] of entries.entries()) {
    if (!isRecord(raw) || typeof raw.cardId !== 'string' || !metadata.has(raw.cardId) || !validQuality(raw.quality)) {
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
  if (typeof raw.id !== 'string' || !REWARD_ID_PATTERN.test(raw.id)) fail('INVALID_CONFIG', `rewards[${index}].id is invalid`);
  if (typeof raw.trigger !== 'string' || !TRIGGERS.has(raw.trigger as CardCollectionRewardTrigger)) {
    fail('INVALID_CONFIG', `rewards[${index}].trigger is invalid`);
  }
  if (!hasOwn(raw, 'reward')) fail('INVALID_CONFIG', `rewards[${index}].reward is required`);
  const trigger = raw.trigger as CardCollectionRewardTrigger;
  const cardId = raw.cardId;
  if (cardId !== undefined && (typeof cardId !== 'string' || !CARD_ID_PATTERN.test(cardId) || !metadata.has(cardId))) {
    fail('INVALID_CONFIG', `rewards[${index}].cardId is unknown`);
  }
  if (trigger === 'FIRST_ACQUISITION' && cardId === undefined) fail('INVALID_CONFIG', `rewards[${index}] first reward needs cardId`);
  if (trigger === 'COLLECTION_COUNT' && !positiveInteger(raw.count)) fail('INVALID_CONFIG', `rewards[${index}].count is invalid`);
  if (trigger === 'QUALITY_REACHED' && raw.quality === undefined) fail('INVALID_CONFIG', `rewards[${index}] quality reward needs quality`);
  if (trigger === 'FIRST_ACQUISITION' && (raw.count !== undefined || raw.quality !== undefined)) {
    fail('INVALID_CONFIG', `rewards[${index}] first reward cannot use count or quality`);
  }
  if (trigger === 'QUALITY_REACHED' && raw.count !== undefined) fail('INVALID_CONFIG', `rewards[${index}] quality reward cannot use count`);
  if (trigger === 'COLLECTION_COUNT' && (raw.cardId !== undefined || raw.quality !== undefined)) {
    fail('INVALID_CONFIG', `rewards[${index}] collection reward cannot target a card or quality`);
  }
  if (raw.quality !== undefined) {
    if (!validQuality(raw.quality)) fail('INVALID_CONFIG', `rewards[${index}].quality is invalid`);
    if (cardId !== undefined && !qualityKeys.has(`${cardId}:${raw.quality}`)) fail('INVALID_CONFIG', `rewards[${index}] quality is not configured for card`);
  }
  if (trigger === 'FIRST_ACQUISITION' && raw.quality !== undefined) fail('INVALID_CONFIG', `rewards[${index}] first reward cannot use quality`);
  return Object.freeze({
    id: raw.id,
    trigger,
    ...(cardId === undefined ? {} : { cardId }),
    ...(raw.quality === undefined ? {} : { quality: raw.quality }),
    ...(raw.count === undefined ? {} : { count: raw.count }),
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

function normalizeProgress(value: unknown, metadataCount: number, code: CardCollectionErrorCode): CardCollectionProgress {
  if (!isRecord(value)) fail(code, 'collection progress must be an object');
  const keys = new Set(['collectedCount', 'totalCount', 'percentage']);
  assertOnlyKeys(value, keys, 'collection progress', code);
  if (!Number.isSafeInteger(value.collectedCount) || value.collectedCount < 0
    || value.collectedCount > metadataCount || value.totalCount !== metadataCount
    || typeof value.percentage !== 'number' || value.percentage !== (metadataCount === 0 ? 0 : value.collectedCount / metadataCount)) {
    fail(code, 'collection progress is inconsistent');
  }
  return { collectedCount: value.collectedCount, totalCount: value.totalCount, percentage: value.percentage };
}

function normalizeGrant(value: unknown, rewardsById: ReadonlyMap<string, CardCollectionRewardDefinition>, code: CardCollectionErrorCode): CardCollectionRewardGrant {
  if (!isRecord(value)) fail(code, 'collection reward grant must be an object');
  assertOnlyKeys(value, GRANT_KEYS, 'collection reward grant', code);
  if (typeof value.id !== 'string') fail(code, 'collection reward grant ID is invalid');
  const definition = rewardsById.get(value.id);
  if (!definition || value.trigger !== definition.trigger) fail(code, `unknown collection reward: ${String(value.id)}`);
  if (!hasOwn(value, 'reward')) fail(code, 'collection reward grant payload is required');
  const reward = cloneJson(value.reward, code);
  if (JSON.stringify(reward) !== JSON.stringify(definition.reward)) fail(code, `collection reward payload does not match: ${definition.id}`);
  return Object.freeze({ id: definition.id, trigger: definition.trigger, reward });
}

function normalizeResult(value: unknown, metadataCount: number, metadata: ReadonlyMap<string, CardAuthority>, qualityKeys: ReadonlySet<string>, rewardsById: ReadonlyMap<string, CardCollectionRewardDefinition>, code: CardCollectionErrorCode): CardCollectionAcquireResult {
  if (!isRecord(value)) fail(code, 'processed request result must be an object');
  assertOnlyKeys(value, RESULT_KEYS, 'processed request result', code);
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
  if (parsed.schemaVersion !== CARD_COLLECTION_SCHEMA_VERSION || !Array.isArray(parsed.cards)
    || !Array.isArray(parsed.claimedRewards) || !Array.isArray(parsed.processedRequests)) {
    fail('INVALID_STATE', 'saved collection state is incomplete or unsupported');
  }
  const cards = parsed.cards.map((card) => normalizeCard(card, metadata, qualityKeys, 'INVALID_STATE'));
  const cardIds = new Set<string>();
  for (const card of cards) {
    if (cardIds.has(card.cardId)) fail('INVALID_STATE', `duplicate collection card: ${card.cardId}`);
    cardIds.add(card.cardId);
  }
  cards.sort((left, right) => left.cardId.localeCompare(right.cardId));

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

  const processedRequests = parsed.processedRequests.map((raw) => {
    if (!isRecord(raw)) fail('INVALID_STATE', 'processed request must be an object');
    assertOnlyKeys(raw, PROCESSED_REQUEST_KEYS, 'processed request', 'INVALID_STATE');
    if (typeof raw.requestId !== 'string' || !REQUEST_ID_PATTERN.test(raw.requestId) || typeof raw.fingerprint !== 'string') {
      fail('INVALID_STATE', 'processed request identity is invalid');
    }
    const result = normalizeResult(raw.result, metadata.size, metadata, qualityKeys, rewardsById, 'INVALID_STATE');
    if (result.requestId !== raw.requestId) fail('INVALID_STATE', 'processed request result ID does not match');
    for (const reward of result.rewards) {
      if (!claimed.has(reward.id)) fail('INVALID_STATE', `processed request reward was not claimed: ${reward.id}`);
    }
    return Object.freeze({ requestId: raw.requestId, fingerprint: raw.fingerprint, result });
  });
  const requestIds = new Set<string>();
  for (const request of processedRequests) {
    if (requestIds.has(request.requestId)) fail('INVALID_STATE', `duplicate processed request: ${request.requestId}`);
    requestIds.add(request.requestId);
  }
  return freezeState({ schemaVersion: CARD_COLLECTION_SCHEMA_VERSION, cards, claimedRewards, processedRequests });
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
    if (options.persist !== undefined && options.onSave !== undefined) fail('INVALID_CONFIG', 'persist and onSave cannot both be provided');
    if (options.persist !== undefined && typeof options.persist !== 'function') fail('INVALID_CONFIG', 'persist must be a function');
    if (options.onSave !== undefined && typeof options.onSave !== 'function') fail('INVALID_CONFIG', 'onSave must be a function');
    this.metadata = normalizeMetadata(options.metadata);
    this.qualityKeys = normalizeQualityAuthority(options.qualityCatalog, this.metadata);
    this.rewards = normalizeRewards(options.rewards, this.metadata, this.qualityKeys);
    this.rewardsById = new Map(this.rewards.map((reward) => [reward.id, reward]));
    this.persist = options.persist ?? options.onSave ?? (() => {});
    this.current = normalizeState(options.state ?? {
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
    const requestId = normalizeRequestId(typeof requestIdOrInput === 'string' ? requestIdOrInput : requestIdOrInput.requestId);
    const rawInput = typeof requestIdOrInput === 'string' ? inputValue : requestIdOrInput;
    if (!isRecord(rawInput)) fail('INVALID_REQUEST', 'collection acquisition input must be an object');
    assertOnlyKeys(
      rawInput,
      typeof requestIdOrInput === 'string' ? REQUEST_KEYS : REQUEST_ENVELOPE_KEYS,
      'collection acquisition input',
      'INVALID_REQUEST',
    );
    if (rawInput.cardId === undefined || rawInput.quality === undefined || rawInput.quantity === undefined) {
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

    const currentCard = this.current.cards.find((card) => card.cardId === cardId);
    const nextCard: CardCollectionEntry = currentCard === undefined
      ? { cardId, quantity: rawInput.quantity, highestQuality: rawInput.quality }
      : { cardId, quantity: checkedAdd(currentCard.quantity, rawInput.quantity), highestQuality: Math.max(currentCard.highestQuality, rawInput.quality) as CardQuality };
    const nextCards = this.current.cards.filter((card) => card.cardId !== cardId).concat(nextCard)
      .sort((left, right) => left.cardId.localeCompare(right.cardId));
    const nextProgress = progressFor(nextCards, this.metadata.size);
    const claimed = new Set(this.current.claimedRewards);
    const grantedRewards: CardCollectionRewardGrant[] = [];
    for (const definition of this.rewards) {
      if (!claimed.has(definition.id) && isRewardEligible(definition, nextCards, nextProgress.collectedCount)) {
        claimed.add(definition.id);
        grantedRewards.push({ id: definition.id, trigger: definition.trigger, reward: cloneJsonOutput(definition.reward) });
      }
    }
    const result = freezeResult({
      requestId,
      applied: true,
      idempotent: false,
      firstAcquisition: currentCard === undefined,
      qualityUpgraded: currentCard === undefined || rawInput.quality > currentCard.highestQuality,
      entry: nextCard,
      progress: nextProgress,
      rewards: grantedRewards,
    });
    const next = normalizeState({
      schemaVersion: CARD_COLLECTION_SCHEMA_VERSION,
      cards: nextCards,
      claimedRewards: [...claimed],
      processedRequests: [...this.current.processedRequests, { requestId, fingerprint: requestFingerprint, result }],
    }, this.metadata, this.qualityKeys, this.rewards);
    this.commit(next);
    return cloneResult(result);
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
