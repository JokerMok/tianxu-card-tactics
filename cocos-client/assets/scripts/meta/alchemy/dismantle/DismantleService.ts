import { CARD_INVENTORY_SOURCES, CARD_QUALITIES, type CardInventorySource, type CardQuality } from '../../cards/card-inventory.ts';

export const DISMANTLE_SCHEMA_VERSION = 1 as const;
export const DEFAULT_DISMANTLE_MATERIAL_ID = 'CARD_DUST' as const;

export type DismantleMaterialId = string;

export interface DismantleCardEntry {
  readonly cardId: string;
  readonly quantity: number;
  readonly quality: CardQuality;
  readonly locked: boolean;
  readonly source: CardInventorySource;
}

export type DismantleMaterials = Readonly<Record<string, number>>;

export interface DismantleProcessedRequest {
  readonly requestId: string;
  readonly fingerprint: string;
  readonly removedCards: readonly DismantleCardEntry[];
  readonly materials: DismantleMaterials;
}

export interface DismantleState {
  readonly schemaVersion: typeof DISMANTLE_SCHEMA_VERSION;
  readonly cards: readonly DismantleCardEntry[];
  readonly materials: DismantleMaterials;
  readonly processedRequests: readonly DismantleProcessedRequest[];
}

export interface DismantleRequest {
  readonly cardId: unknown;
  readonly quality: unknown;
  readonly source: unknown;
  readonly quantity: unknown;
}

export interface DismantleResult {
  readonly requestId: string;
  readonly applied: boolean;
  readonly idempotent: boolean;
  readonly removedCards: readonly DismantleCardEntry[];
  readonly materials: DismantleMaterials;
}

export type DismantlePersistence = (serialized: string) => void;

export interface DismantleServiceOptions {
  readonly metadata: readonly unknown[] | { readonly cards: readonly unknown[] };
  readonly state?: unknown;
  readonly persist?: DismantlePersistence;
  readonly onSave?: DismantlePersistence;
  readonly materialYields?: unknown;
  readonly allowedSources?: readonly string[];
}

export type DismantleErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_REQUEST_ID'
  | 'INVALID_REQUEST'
  | 'INVALID_CARD_ID'
  | 'UNKNOWN_CARD'
  | 'INVALID_QUANTITY'
  | 'INVALID_QUALITY'
  | 'INVALID_SOURCE'
  | 'CARD_NOT_OWNED'
  | 'CARD_LOCKED'
  | 'INSUFFICIENT_QUANTITY'
  | 'MATERIAL_OVERFLOW'
  | 'DUPLICATE_REQUEST'
  | 'REQUEST_CONFLICT'
  | 'PERSISTENCE_FAILED'
  | 'PERSISTENCE_REENTRANT';

const ERROR_MESSAGES: Readonly<Record<DismantleErrorCode, string>> = {
  INVALID_CONFIG: 'dismantle configuration is invalid',
  INVALID_STATE: 'saved dismantle state is invalid',
  INVALID_REQUEST_ID: 'dismantle request ID is invalid',
  INVALID_REQUEST: 'dismantle request is invalid',
  INVALID_CARD_ID: 'card ID is invalid',
  UNKNOWN_CARD: 'card does not exist or is disabled',
  INVALID_QUANTITY: 'dismantle quantity must be a positive safe integer',
  INVALID_QUALITY: 'card quality must be an integer from 1 to 6',
  INVALID_SOURCE: 'card source is invalid',
  CARD_NOT_OWNED: 'card is not owned',
  CARD_LOCKED: 'locked card cannot be dismantled',
  INSUFFICIENT_QUANTITY: 'owned card quantity is insufficient',
  MATERIAL_OVERFLOW: 'material quantity exceeds the safe integer limit',
  DUPLICATE_REQUEST: 'dismantle request ID is duplicated',
  REQUEST_CONFLICT: 'dismantle request ID was already used with a different payload',
  PERSISTENCE_FAILED: 'dismantle state could not be persisted',
  PERSISTENCE_REENTRANT: 'dismantle persistence was re-entered',
};

const CARD_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const REQUEST_ID_PATTERN = /^\S(?:.*\S)?$/;
const ENTRY_KEYS = new Set(['cardId', 'quantity', 'quality', 'locked', 'source']);
const REQUEST_KEYS = new Set(['cardId', 'quality', 'source', 'quantity']);
const STATE_KEYS = new Set(['schemaVersion', 'cards', 'materials', 'processedRequests']);
const PROCESSED_REQUEST_KEYS = new Set(['requestId', 'fingerprint', 'removedCards', 'materials']);

const DEFAULT_MATERIAL_YIELDS = Object.freeze({
  1: Object.freeze({ [DEFAULT_DISMANTLE_MATERIAL_ID]: 1 }),
  2: Object.freeze({ [DEFAULT_DISMANTLE_MATERIAL_ID]: 2 }),
  3: Object.freeze({ [DEFAULT_DISMANTLE_MATERIAL_ID]: 3 }),
  4: Object.freeze({ [DEFAULT_DISMANTLE_MATERIAL_ID]: 5 }),
  5: Object.freeze({ [DEFAULT_DISMANTLE_MATERIAL_ID]: 8 }),
  6: Object.freeze({ [DEFAULT_DISMANTLE_MATERIAL_ID]: 13 }),
});
const DECIMAL_INTEGER_KEY_PATTERN = /^(?:0|[1-9]\d*)$/;
const CARD_QUALITY_KEYS = new Set(CARD_QUALITIES.map(String));

interface CardAuthority {
  readonly copyLimit: number;
}

type MaterialMap = Map<string, number>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(code: DismantleErrorCode, cause?: unknown): never {
  throw new DismantleError(code, cause);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function assertOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, code: DismantleErrorCode): void {
  if (Object.keys(value).some((key) => !keys.has(key))) fail(code);
}

function metadataRows(input: readonly unknown[] | { readonly cards: readonly unknown[] }): readonly unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && Array.isArray(input.cards)) return input.cards;
  fail('INVALID_CONFIG');
}

function normalizeMetadata(input: readonly unknown[] | { readonly cards: readonly unknown[] }): ReadonlyMap<string, CardAuthority> {
  const metadata = new Map<string, CardAuthority>();
  for (const raw of metadataRows(input)) {
    if (!isRecord(raw) || raw.enabled === false || !text(raw.id) || !CARD_ID_PATTERN.test(raw.id)
      || !positiveInteger(raw.copyLimit) || metadata.has(raw.id)) {
      if (isRecord(raw) && raw.enabled === false) continue;
      fail('INVALID_CONFIG');
    }
    metadata.set(raw.id, { copyLimit: raw.copyLimit });
  }
  if (metadata.size === 0) fail('INVALID_CONFIG');
  return metadata;
}

function normalizeSources(input: readonly string[] | undefined): ReadonlySet<string> {
  const values = input ?? CARD_INVENTORY_SOURCES;
  if (!Array.isArray(values) || values.length === 0) fail('INVALID_CONFIG');
  const sources = new Set<string>();
  for (const value of values) {
    if (!text(value) || sources.has(value)) fail('INVALID_CONFIG');
    sources.add(value);
  }
  return sources;
}

function normalizeCardId(value: unknown, metadata: ReadonlyMap<string, CardAuthority>): string {
  if (!text(value) || !CARD_ID_PATTERN.test(value)) fail('INVALID_CARD_ID');
  if (!metadata.has(value)) fail('UNKNOWN_CARD');
  return value;
}

function normalizeQuality(value: unknown): CardQuality {
  if (!CARD_QUALITIES.includes(value as CardQuality)) fail('INVALID_QUALITY');
  return value as CardQuality;
}

function normalizeSource(value: unknown, sources: ReadonlySet<string>): CardInventorySource {
  if (!text(value) || !sources.has(value)) fail('INVALID_SOURCE');
  return value as CardInventorySource;
}

function objectFromMaterials(materials: MaterialMap): DismantleMaterials {
  const result: Record<string, number> = {};
  for (const [key, quantity] of [...materials.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: quantity,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function materialsFromUnknown(value: unknown, code: DismantleErrorCode): MaterialMap {
  if (!isRecord(value)) fail(code);
  const result = new Map<string, number>();
  for (const key of Object.keys(value)) {
    if (!text(key) || !nonNegativeInteger(value[key])) fail(code);
    result.set(key, value[key] as number);
  }
  return result;
}

function normalizeMaterials(value: unknown, code: DismantleErrorCode): MaterialMap {
  return materialsFromUnknown(value, code);
}

function normalizeCardEntry(
  value: unknown,
  metadata: ReadonlyMap<string, CardAuthority>,
  sources: ReadonlySet<string>,
  code: DismantleErrorCode,
): DismantleCardEntry {
  if (!isRecord(value)) fail(code);
  assertOnlyKeys(value, ENTRY_KEYS, code);
  for (const key of ENTRY_KEYS) if (!hasOwn(value, key)) fail(code);
  const cardId = normalizeCardId(value.cardId, metadata);
  if (!positiveInteger(value.quantity)) fail('INVALID_QUANTITY');
  const quality = normalizeQuality(value.quality);
  const source = normalizeSource(value.source, sources);
  if (typeof value.locked !== 'boolean') fail(code);
  return { cardId, quantity: value.quantity, quality, locked: value.locked, source };
}

function cardKey(card: Pick<DismantleCardEntry, 'cardId' | 'quality' | 'source'>): string {
  return JSON.stringify([card.cardId, card.quality, card.source]);
}

function normalizeCards(
  value: unknown,
  metadata: ReadonlyMap<string, CardAuthority>,
  sources: ReadonlySet<string>,
  code: DismantleErrorCode,
): DismantleCardEntry[] {
  if (!Array.isArray(value)) fail(code);
  const keys = new Set<string>();
  const cards = value.map((entry) => normalizeCardEntry(entry, metadata, sources, code));
  for (const card of cards) {
    const key = cardKey(card);
    if (keys.has(key)) fail(code);
    keys.add(key);
  }
  return cards;
}

function normalizeRequest(
  value: unknown,
  metadata: ReadonlyMap<string, CardAuthority>,
  sources: ReadonlySet<string>,
): DismantleRequest & { readonly cardId: string; readonly quality: CardQuality; readonly source: CardInventorySource; readonly quantity: number } {
  if (!isRecord(value)) fail('INVALID_REQUEST');
  assertOnlyKeys(value, REQUEST_KEYS, 'INVALID_REQUEST');
  for (const key of REQUEST_KEYS) if (!hasOwn(value, key)) fail('INVALID_REQUEST');
  const cardId = normalizeCardId(value.cardId, metadata);
  const quality = normalizeQuality(value.quality);
  const source = normalizeSource(value.source, sources);
  if (!positiveInteger(value.quantity)) fail('INVALID_QUANTITY');
  return { cardId, quality, source, quantity: value.quantity };
}

function normalizeRequestId(value: unknown): string {
  if (!text(value) || !REQUEST_ID_PATTERN.test(value)) fail('INVALID_REQUEST_ID');
  return value;
}

function normalizeYields(value: unknown): ReadonlyMap<CardQuality, MaterialMap> {
  const input = value === undefined ? DEFAULT_MATERIAL_YIELDS : value;
  if (!isRecord(input)) fail('INVALID_CONFIG');
  if (Object.keys(input).some((key) => !DECIMAL_INTEGER_KEY_PATTERN.test(key) || !CARD_QUALITY_KEYS.has(key))) {
    fail('INVALID_CONFIG');
  }
  const result = new Map<CardQuality, MaterialMap>();
  for (const quality of CARD_QUALITIES) {
    const row = input[String(quality)];
    const materials = materialsFromUnknown(row, 'INVALID_CONFIG');
    if ([...materials.values()].some((quantity) => !positiveInteger(quantity))) fail('INVALID_CONFIG');
    result.set(quality, materials);
  }
  return result;
}

function parseState(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    fail('INVALID_STATE', error);
  }
}

function normalizeProcessedRequest(
  value: unknown,
  metadata: ReadonlyMap<string, CardAuthority>,
  sources: ReadonlySet<string>,
): DismantleProcessedRequest {
  if (!isRecord(value)) fail('INVALID_STATE');
  assertOnlyKeys(value, PROCESSED_REQUEST_KEYS, 'INVALID_STATE');
  if (!text(value.requestId) || !text(value.fingerprint) || !Array.isArray(value.removedCards)) fail('INVALID_STATE');
  return {
    requestId: normalizeRequestId(value.requestId),
    fingerprint: value.fingerprint,
    removedCards: normalizeCards(value.removedCards, metadata, sources, 'INVALID_STATE'),
    materials: objectFromMaterials(normalizeMaterials(value.materials, 'INVALID_STATE')),
  };
}

function normalizeState(
  value: unknown,
  metadata: ReadonlyMap<string, CardAuthority>,
  sources: ReadonlySet<string>,
): DismantleState {
  const parsed = parseState(value);
  if (!isRecord(parsed)) fail('INVALID_STATE');
  assertOnlyKeys(parsed, STATE_KEYS, 'INVALID_STATE');
  if (parsed.schemaVersion !== DISMANTLE_SCHEMA_VERSION || !hasOwn(parsed, 'cards')
    || !hasOwn(parsed, 'materials') || !hasOwn(parsed, 'processedRequests')) fail('INVALID_STATE');
  if (!Array.isArray(parsed.processedRequests)) fail('INVALID_STATE');
  const cards = normalizeCards(parsed.cards, metadata, sources, 'INVALID_STATE');
  const materials = objectFromMaterials(normalizeMaterials(parsed.materials, 'INVALID_STATE'));
  const processedRequests = parsed.processedRequests.map((request) => normalizeProcessedRequest(request, metadata, sources));
  const requestIds = new Set<string>();
  for (const request of processedRequests) {
    if (requestIds.has(request.requestId)) fail('INVALID_STATE');
    requestIds.add(request.requestId);
  }
  return freezeState({ schemaVersion: DISMANTLE_SCHEMA_VERSION, cards, materials, processedRequests });
}

function emptyState(): DismantleState {
  return freezeState({ schemaVersion: DISMANTLE_SCHEMA_VERSION, cards: [], materials: {}, processedRequests: [] });
}

function freezeCards(cards: readonly DismantleCardEntry[]): readonly DismantleCardEntry[] {
  return Object.freeze(cards.map((card) => Object.freeze({ ...card })));
}

function freezeProcessedRequests(requests: readonly DismantleProcessedRequest[]): readonly DismantleProcessedRequest[] {
  return Object.freeze(requests.map((request) => Object.freeze({
    requestId: request.requestId,
    fingerprint: request.fingerprint,
    removedCards: freezeCards(request.removedCards),
    materials: objectFromMaterials(materialsFromUnknown(request.materials, 'INVALID_STATE')),
  })));
}

function freezeState(value: DismantleState): DismantleState {
  return Object.freeze({
    schemaVersion: DISMANTLE_SCHEMA_VERSION,
    cards: freezeCards(value.cards),
    materials: objectFromMaterials(materialsFromUnknown(value.materials, 'INVALID_STATE')),
    processedRequests: freezeProcessedRequests(value.processedRequests),
  });
}

function fingerprint(requests: readonly DismantleRequest[]): string {
  return JSON.stringify([...requests].map((request) => ({
    cardId: request.cardId,
    quality: request.quality,
    source: request.source,
    quantity: request.quantity,
  })).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

function cloneResult(result: Omit<DismantleResult, 'materials'> & { readonly materials: DismantleMaterials | MaterialMap }): DismantleResult {
  return Object.freeze({
    requestId: result.requestId,
    applied: result.applied,
    idempotent: result.idempotent,
    removedCards: freezeCards(result.removedCards),
    materials: result.materials instanceof Map
      ? objectFromMaterials(result.materials)
      : objectFromMaterials(materialsFromUnknown(result.materials, 'INVALID_STATE')),
  });
}

export class DismantleError extends Error {
  readonly code: DismantleErrorCode;
  readonly reason: DismantleErrorCode;
  readonly cause?: unknown;

  constructor(code: DismantleErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES[code]);
    this.name = 'DismantleError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class DismantleService {
  private readonly metadata: ReadonlyMap<string, CardAuthority>;
  private readonly sources: ReadonlySet<string>;
  private readonly yields: ReadonlyMap<CardQuality, MaterialMap>;
  private readonly persist: DismantlePersistence;
  private current: DismantleState;
  private committing = false;

  constructor(options: DismantleServiceOptions) {
    if (!isRecord(options)) fail('INVALID_CONFIG');
    this.metadata = normalizeMetadata(options.metadata);
    this.sources = normalizeSources(options.allowedSources);
    this.yields = normalizeYields(options.materialYields);
    if (options.persist !== undefined && options.onSave !== undefined) fail('INVALID_CONFIG');
    this.persist = options.persist ?? options.onSave ?? (() => {});
    if (typeof this.persist !== 'function') fail('INVALID_CONFIG');
    this.current = normalizeState(options.state ?? emptyState(), this.metadata, this.sources);
  }

  static restore(
    metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
    serialized: string,
    options: Omit<DismantleServiceOptions, 'metadata' | 'state'> = {},
  ): DismantleService {
    return new DismantleService({ ...options, metadata, state: serialized });
  }

  snapshot(): DismantleState {
    return normalizeState(this.current, this.metadata, this.sources);
  }

  save(): string {
    return JSON.stringify(this.snapshot());
  }

  getCard(cardId: string, quality: CardQuality, source: CardInventorySource): DismantleCardEntry {
    const key = cardKey({ cardId, quality, source });
    const entry = this.current.cards.find((card) => cardKey(card) === key);
    if (!entry) fail('CARD_NOT_OWNED');
    return { ...entry };
  }

  dismantle(requestId: string, request: DismantleRequest): DismantleResult;
  dismantle(request: DismantleRequest & { readonly requestId: string }): DismantleResult;
  dismantle(
    requestIdOrRequest: string | (DismantleRequest & { readonly requestId: string }),
    requestValue?: DismantleRequest,
  ): DismantleResult {
    const requestId = typeof requestIdOrRequest === 'string' ? requestIdOrRequest : requestIdOrRequest.requestId;
    const request = typeof requestIdOrRequest === 'string' ? requestValue : requestIdOrRequest;
    return this.dismantleBatch(requestId, request === undefined ? [] : [request]);
  }

  dismantleCard(requestId: string, request: DismantleRequest): DismantleResult {
    return this.dismantle(requestId, request);
  }

  dismantleBatch(requestId: string, requests: readonly DismantleRequest[]): DismantleResult {
    if (this.committing) fail('PERSISTENCE_REENTRANT');
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!Array.isArray(requests) || requests.length === 0) fail('INVALID_REQUEST');
    const normalizedRequests = requests.map((request) => normalizeRequest(request, this.metadata, this.sources));
    const requestFingerprint = fingerprint(normalizedRequests);
    const previous = this.current.processedRequests.find((entry) => entry.requestId === normalizedRequestId);
    if (previous) {
      if (previous.fingerprint !== requestFingerprint) fail('REQUEST_CONFLICT');
      return cloneResult({
        requestId: normalizedRequestId,
        applied: false,
        idempotent: true,
        removedCards: previous.removedCards,
        materials: previous.materials,
      });
    }
    if (this.current.processedRequests.some((entry) => entry.requestId === normalizedRequestId)) fail('DUPLICATE_REQUEST');

    const cards = this.current.cards.map((card) => ({ ...card }));
    const materials = materialsFromUnknown(this.current.materials, 'INVALID_STATE');
    const totals = new Map<string, number>();
    for (const request of normalizedRequests) {
      const key = cardKey(request);
      const currentTotal = totals.get(key) ?? 0;
      totals.set(key, checkedAdd(currentTotal, request.quantity, 'INSUFFICIENT_QUANTITY'));
    }

    const removedCards: DismantleCardEntry[] = [];
    const materialDelta = new Map<string, number>();
    for (const [key, quantity] of totals) {
      const index = cards.findIndex((card) => cardKey(card) === key);
      if (index === -1) fail('CARD_NOT_OWNED');
      const current = cards[index];
      if (current.locked) fail('CARD_LOCKED');
      if (quantity > current.quantity) fail('INSUFFICIENT_QUANTITY');
      removedCards.push({ ...current, quantity });
      const yieldRow = this.yields.get(current.quality)!;
      for (const [materialId, perCard] of yieldRow) {
        const delta = checkedMultiply(perCard, quantity);
        materialDelta.set(materialId, checkedAdd(materialDelta.get(materialId) ?? 0, delta, 'MATERIAL_OVERFLOW'));
      }
      const remainder = current.quantity - quantity;
      if (remainder === 0) cards.splice(index, 1);
      else cards[index] = { ...current, quantity: remainder };
    }
    for (const [materialId, delta] of materialDelta) {
      materials.set(materialId, checkedAdd(materials.get(materialId) ?? 0, delta, 'MATERIAL_OVERFLOW'));
    }
    const processed: DismantleProcessedRequest = {
      requestId: normalizedRequestId,
      fingerprint: requestFingerprint,
      removedCards: freezeCards(removedCards),
      materials: objectFromMaterials(materialDelta),
    };
    const next = normalizeState({
      schemaVersion: DISMANTLE_SCHEMA_VERSION,
      cards,
      materials: objectFromMaterials(materials),
      processedRequests: [...this.current.processedRequests, processed],
    }, this.metadata, this.sources);
    this.commit(next);
    return cloneResult({
      requestId: normalizedRequestId,
      applied: true,
      idempotent: false,
      removedCards,
      materials: materialDelta,
    });
  }

  dismantleBatchCards(requestId: string, requests: readonly DismantleRequest[]): DismantleResult {
    return this.dismantleBatch(requestId, requests);
  }

  private commit(next: DismantleState): void {
    this.committing = true;
    try {
      this.persist(JSON.stringify(next));
    } catch (error) {
      throw new DismantleError('PERSISTENCE_FAILED', error);
    } finally {
      this.committing = false;
    }
    this.current = next;
  }
}

function checkedAdd(left: number, right: number, errorCode: DismantleErrorCode): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left > Number.MAX_SAFE_INTEGER - right) fail(errorCode);
  return left + right;
}

function checkedMultiply(left: number, right: number): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left !== 0 && right > Math.floor(Number.MAX_SAFE_INTEGER / left)) {
    fail('MATERIAL_OVERFLOW');
  }
  return left * right;
}

export const DEFAULT_DISMANTLE_MATERIAL_YIELDS = DEFAULT_MATERIAL_YIELDS;

export function createDismantleService(options: DismantleServiceOptions): DismantleService {
  return new DismantleService(options);
}

export function restoreDismantleService(
  metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
  serialized: string,
  options: Omit<DismantleServiceOptions, 'metadata' | 'state'> = {},
): DismantleService {
  return DismantleService.restore(metadata, serialized, options);
}

export function serializeDismantleState(service: DismantleService): string {
  return service.save();
}
