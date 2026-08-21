import { CARD_INVENTORY_SOURCES } from '../card-inventory.ts';

export const CARD_QUALITY_SCHEMA_VERSION = 1 as const;
export const CARD_QUALITY_LEVELS = Object.freeze([1, 2, 3, 4, 5, 6]) as readonly [1, 2, 3, 4, 5, 6];
export const CARD_QUALITIES = CARD_QUALITY_LEVELS;
export const CARD_QUALITY_SOURCES = CARD_INVENTORY_SOURCES;
export type CardQuality = (typeof CARD_QUALITY_LEVELS)[number];
export type CardQualitySource = string;

export interface CardQualityDefinition {
  readonly cardId: string;
  readonly quality: CardQuality;
  readonly abilities: Readonly<Record<string, number>>;
  readonly sources: readonly CardQualitySource[];
  readonly copyLimit: number;
}

export interface CardQualityCatalogState {
  readonly schemaVersion: typeof CARD_QUALITY_SCHEMA_VERSION;
  readonly allowedSources: readonly CardQualitySource[];
  readonly entries: readonly CardQualityDefinition[];
}

export interface CardQualityCatalogOptions {
  readonly metadata: readonly unknown[] | { readonly cards: readonly unknown[] };
  readonly entries: readonly unknown[] | { readonly entries: readonly unknown[] };
  readonly allowedSources?: readonly string[];
}

export interface CardQualityRestoreOptions {
  readonly allowedSources?: readonly string[];
}

export interface CardQualityGrantInput {
  readonly cardId: unknown;
  readonly quality: unknown;
  readonly source: unknown;
  readonly quantity: unknown;
  readonly ownedQuantity?: unknown;
}

export interface CardQualityGrant {
  readonly cardId: string;
  readonly quality: CardQuality;
  readonly source: CardQualitySource;
  readonly quantity: number;
  readonly ownedQuantity: number;
  readonly remainingQuantity: number;
}

export type CardQualityErrorCode =
  | 'INVALID_METADATA'
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_ENTRY'
  | 'INVALID_CARD_ID'
  | 'UNKNOWN_CARD'
  | 'INVALID_QUALITY'
  | 'INVALID_ABILITIES'
  | 'INVALID_SOURCE'
  | 'SOURCE_NOT_ALLOWED'
  | 'INVALID_COPY_LIMIT'
  | 'MISSING_QUALITY'
  | 'DUPLICATE_QUALITY'
  | 'ABILITY_NOT_UNIQUE'
  | 'UNKNOWN_CARD_QUALITY'
  | 'INVALID_GRANT'
  | 'QUANTITY_EXCEEDED';

export class CardQualityError extends Error {
  readonly code: CardQualityErrorCode;

  constructor(code: CardQualityErrorCode, message: string) {
    super(message);
    this.name = 'CardQualityError';
    this.code = code;
  }
}

const CARD_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const ABILITY_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]*$/;
const ENTRY_KEYS = new Set(['cardId', 'quality', 'abilities', 'sources', 'copyLimit']);
const STATE_KEYS = new Set(['schemaVersion', 'allowedSources', 'entries']);
const GRANT_KEYS = new Set(['cardId', 'quality', 'source', 'quantity', 'ownedQuantity']);

interface CardMetadataAuthority {
  readonly copyLimit: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(code: CardQualityErrorCode, message: string): never {
  throw new CardQualityError(code, message);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string, code: CardQualityErrorCode): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, `${label} contains unknown field: ${key}`);
  }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function validQuality(value: unknown): value is CardQuality {
  return typeof value === 'number' && CARD_QUALITY_LEVELS.includes(value as CardQuality);
}

function metadataRows(input: readonly unknown[] | { readonly cards: readonly unknown[] }): readonly unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && Array.isArray(input.cards)) return input.cards;
  fail('INVALID_METADATA', 'card metadata must be an array or a cards table');
}

function normalizeMetadata(input: readonly unknown[] | { readonly cards: readonly unknown[] }): ReadonlyMap<string, CardMetadataAuthority> {
  const cards = new Map<string, CardMetadataAuthority>();
  for (const [index, raw] of metadataRows(input).entries()) {
    if (!isRecord(raw)) fail('INVALID_METADATA', `card metadata row ${index} must be an object`);
    if (raw.enabled === false) continue;
    if (typeof raw.id !== 'string' || !CARD_ID_PATTERN.test(raw.id)) {
      fail('INVALID_METADATA', `card metadata row ${index} has an invalid ID`);
    }
    if (cards.has(raw.id)) fail('INVALID_METADATA', `duplicate card metadata ID: ${raw.id}`);
    if (!positiveInteger(raw.copyLimit)) fail('INVALID_METADATA', `invalid copy limit for ${raw.id}`);
    cards.set(raw.id, { copyLimit: raw.copyLimit });
  }
  if (cards.size === 0) fail('INVALID_METADATA', 'card metadata is empty');
  return cards;
}

function normalizeSources(input: readonly string[] | undefined, code: CardQualityErrorCode): readonly string[] {
  const values = input ?? CARD_QUALITY_SOURCES;
  if (!Array.isArray(values) || values.length === 0) fail(code, 'allowed sources must be a non-empty array');
  const result = [...values];
  if (result.some((value) => typeof value !== 'string' || value.length === 0 || value.trim() !== value)) {
    fail(code, 'allowed sources contain an invalid value');
  }
  if (new Set(result).size !== result.length) fail(code, 'allowed sources must not contain duplicates');
  return Object.freeze(result.sort());
}

function normalizeAbilities(value: unknown, label: string, code: CardQualityErrorCode): Readonly<Record<string, number>> {
  if (!isRecord(value) || Object.keys(value).length === 0) fail(code, `${label} must contain at least one ability`);
  const abilities: Record<string, number> = {};
  for (const [key, abilityValue] of Object.entries(value)) {
    if (!ABILITY_KEY_PATTERN.test(key)) fail(code, `${label} contains an invalid ability key: ${key}`);
    if (!nonNegativeInteger(abilityValue)) fail(code, `${label}.${key} must be a non-negative safe integer`);
    abilities[key] = abilityValue;
  }
  return Object.freeze(Object.fromEntries(Object.entries(abilities).sort(([left], [right]) => left.localeCompare(right))));
}

function normalizeEntry(
  raw: unknown,
  metadata: ReadonlyMap<string, CardMetadataAuthority>,
  allowedSources: ReadonlySet<string>,
  index: number,
  errorCode: CardQualityErrorCode,
): CardQualityDefinition {
  const label = `entries[${index}]`;
  if (!isRecord(raw)) fail(errorCode, `${label} must be an object`);
  assertOnlyKeys(raw, ENTRY_KEYS, label, errorCode);
  for (const key of ENTRY_KEYS) {
    if (!hasOwn(raw, key)) fail(errorCode, `${label}.${key} is required`);
  }
  if (typeof raw.cardId !== 'string' || !CARD_ID_PATTERN.test(raw.cardId)) fail('INVALID_CARD_ID', `${label}.cardId is invalid`);
  const card = metadata.get(raw.cardId);
  if (!card) fail('UNKNOWN_CARD', `${label}.cardId is unknown or disabled: ${String(raw.cardId)}`);
  if (!validQuality(raw.quality)) fail('INVALID_QUALITY', `${label}.quality must be one of 1, 2, 3, 4, 5 or 6`);
  const abilities = normalizeAbilities(raw.abilities, `${label}.abilities`, 'INVALID_ABILITIES');
  if (!Array.isArray(raw.sources) || raw.sources.length === 0) fail('INVALID_SOURCE', `${label}.sources must be a non-empty array`);
  const sources = [...raw.sources];
  if (sources.some((source) => typeof source !== 'string' || source.length === 0 || source.trim() !== source)) {
    fail('INVALID_SOURCE', `${label}.sources contain an invalid value`);
  }
  if (new Set(sources).size !== sources.length) fail('INVALID_SOURCE', `${label}.sources must not contain duplicates`);
  for (const source of sources) {
    if (!allowedSources.has(source)) fail('INVALID_SOURCE', `${label}.sources contains an unauthorized source: ${source}`);
  }
  if (!positiveInteger(raw.copyLimit) || raw.copyLimit > card.copyLimit) {
    fail('INVALID_COPY_LIMIT', `${label}.copyLimit must be between 1 and ${card.copyLimit}`);
  }
  return Object.freeze({
    cardId: raw.cardId,
    quality: raw.quality,
    abilities,
    sources: Object.freeze(sources.sort()),
    copyLimit: raw.copyLimit,
  });
}

function definitionSignature(definition: CardQualityDefinition): string {
  return JSON.stringify(definition.abilities);
}

function unwrapEntries(input: unknown, errorCode: CardQualityErrorCode): readonly unknown[] {
  if (Array.isArray(input)) return input;
  if (!isRecord(input)) fail(errorCode, 'quality entries must be an array or an entries object');
  assertOnlyKeys(input, new Set(['schemaVersion', 'entries']), 'quality entries', errorCode);
  if (hasOwn(input, 'schemaVersion') && input.schemaVersion !== CARD_QUALITY_SCHEMA_VERSION) {
    fail(errorCode, 'unsupported card quality schema version');
  }
  if (!Array.isArray(input.entries)) fail(errorCode, 'quality entries object must contain an entries array');
  return input.entries;
}

function normalizeEntries(
  input: unknown,
  metadata: ReadonlyMap<string, CardMetadataAuthority>,
  allowedSources: readonly string[],
  errorCode: CardQualityErrorCode,
): readonly CardQualityDefinition[] {
  const rawEntries = unwrapEntries(input, errorCode);
  const sourceSet = new Set(allowedSources);
  const entries = rawEntries.map((raw, index) => normalizeEntry(raw, metadata, sourceSet, index, errorCode));
  const keys = new Set<string>();
  const byCard = new Map<string, CardQualityDefinition[]>();
  for (const entry of entries) {
    const key = `${entry.cardId}:${entry.quality}`;
    if (keys.has(key)) fail('DUPLICATE_QUALITY', `duplicate quality definition: ${key}`);
    keys.add(key);
    const group = byCard.get(entry.cardId) ?? [];
    group.push(entry);
    byCard.set(entry.cardId, group);
  }

  for (const cardId of metadata.keys()) {
    const group = byCard.get(cardId) ?? [];
    if (group.length !== CARD_QUALITY_LEVELS.length) fail('MISSING_QUALITY', `${cardId} must define all six quality levels`);
    const qualities = new Set(group.map(({ quality }) => quality));
    if (qualities.size !== CARD_QUALITY_LEVELS.length) fail('DUPLICATE_QUALITY', `${cardId} must define six distinct quality levels`);
    for (const quality of CARD_QUALITY_LEVELS) {
      if (!qualities.has(quality)) fail('MISSING_QUALITY', `${cardId} is missing quality ${quality}`);
    }
    const abilitySignatures = new Set(group.map(definitionSignature));
    if (abilitySignatures.size !== CARD_QUALITY_LEVELS.length) {
      fail('ABILITY_NOT_UNIQUE', `${cardId} must have different abilities for all six quality levels`);
    }
  }
  for (const cardId of byCard.keys()) {
    if (!metadata.has(cardId)) fail('UNKNOWN_CARD', `quality definitions contain an unknown card: ${cardId}`);
  }
  return Object.freeze([...entries].sort((left, right) => left.cardId.localeCompare(right.cardId) || left.quality - right.quality));
}

function freezeState(state: CardQualityCatalogState): CardQualityCatalogState {
  const entries = Object.freeze(state.entries.map((entry) => Object.freeze({
    cardId: entry.cardId,
    quality: entry.quality,
    abilities: Object.freeze({ ...entry.abilities }),
    sources: Object.freeze([...entry.sources]),
    copyLimit: entry.copyLimit,
  })));
  return Object.freeze({
    schemaVersion: CARD_QUALITY_SCHEMA_VERSION,
    allowedSources: Object.freeze([...state.allowedSources]),
    entries,
  });
}

function parseState(serialized: string): { readonly allowedSources: readonly string[]; readonly entries: readonly unknown[] } {
  if (typeof serialized !== 'string' || serialized.trim().length === 0) fail('INVALID_STATE', 'card quality save must be a non-empty string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'card quality save is not valid JSON');
  }
  if (!isRecord(parsed)) fail('INVALID_STATE', 'card quality save must be an object');
  assertOnlyKeys(parsed, STATE_KEYS, 'card quality save', 'INVALID_STATE');
  if (parsed.schemaVersion !== CARD_QUALITY_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported card quality save schema version');
  if (!Array.isArray(parsed.allowedSources)) fail('INVALID_STATE', 'card quality save allowedSources must be an array');
  if (!Array.isArray(parsed.entries)) fail('INVALID_STATE', 'card quality save entries must be an array');
  return { allowedSources: normalizeSources(parsed.allowedSources, 'INVALID_STATE'), entries: parsed.entries };
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function normalizeGrantInput(input: unknown): CardQualityGrantInput {
  if (!isRecord(input)) fail('INVALID_GRANT', 'card quality grant must be an object');
  assertOnlyKeys(input, GRANT_KEYS, 'card quality grant', 'INVALID_GRANT');
  for (const key of ['cardId', 'quality', 'source', 'quantity']) {
    if (!hasOwn(input, key)) fail('INVALID_GRANT', `card quality grant.${key} is required`);
  }
  return input as CardQualityGrantInput;
}

export class CardQualityCatalog {
  private readonly metadata: ReadonlyMap<string, CardMetadataAuthority>;
  private readonly allowedSourceSet: ReadonlySet<string>;
  private readonly state: CardQualityCatalogState;
  private readonly byKey: ReadonlyMap<string, CardQualityDefinition>;

  constructor(options: CardQualityCatalogOptions) {
    if (!isRecord(options)) fail('INVALID_CONFIG', 'card quality catalog options must be an object');
    if (!hasOwn(options, 'metadata') || !hasOwn(options, 'entries')) fail('INVALID_CONFIG', 'card quality catalog requires metadata and entries');
    assertOnlyKeys(options, new Set(['metadata', 'entries', 'allowedSources']), 'card quality catalog options', 'INVALID_CONFIG');
    this.metadata = normalizeMetadata(options.metadata as CardQualityCatalogOptions['metadata']);
    const allowedSources = normalizeSources(options.allowedSources, 'INVALID_CONFIG');
    const entries = normalizeEntries(options.entries, this.metadata, allowedSources, 'INVALID_CONFIG');
    this.allowedSourceSet = new Set(allowedSources);
    this.state = freezeState({ schemaVersion: CARD_QUALITY_SCHEMA_VERSION, allowedSources, entries });
    this.byKey = new Map(entries.map((entry) => [`${entry.cardId}:${entry.quality}`, entry]));
  }

  static restore(
    metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
    serialized: string,
    options: CardQualityRestoreOptions = {},
  ): CardQualityCatalog {
    if (!isRecord(options)) fail('INVALID_STATE', 'card quality restore options must be an object');
    assertOnlyKeys(options, new Set(['allowedSources']), 'card quality restore options', 'INVALID_STATE');
    const state = parseState(serialized);
    const allowedSources = normalizeSources(options.allowedSources, 'INVALID_STATE');
    if (!sameStrings(state.allowedSources, allowedSources)) {
      fail('INVALID_STATE', 'saved card quality source authority does not match the restore authority');
    }
    try {
      return new CardQualityCatalog({ metadata, entries: state.entries, allowedSources });
    } catch (error) {
      if (error instanceof CardQualityError && error.code === 'INVALID_METADATA') throw error;
      fail('INVALID_STATE', error instanceof Error ? error.message : String(error));
    }
  }

  snapshot(): CardQualityCatalogState {
    return freezeState(this.state);
  }

  save(): string {
    return JSON.stringify(this.state);
  }

  cardIds(): readonly string[] {
    return Object.freeze([...this.metadata.keys()].sort());
  }

  qualities(cardId: unknown): readonly CardQualityDefinition[] {
    if (typeof cardId !== 'string' || !this.metadata.has(cardId)) fail('UNKNOWN_CARD', `unknown card: ${String(cardId)}`);
    return Object.freeze(CARD_QUALITY_LEVELS.map((quality) => this.get(cardId, quality)));
  }

  get(cardId: unknown, quality: unknown): CardQualityDefinition {
    if (typeof cardId !== 'string' || !this.metadata.has(cardId)) fail('UNKNOWN_CARD', `unknown card: ${String(cardId)}`);
    if (!validQuality(quality)) fail('INVALID_QUALITY', `quality must be one of 1, 2, 3, 4, 5 or 6`);
    const definition = this.byKey.get(`${cardId}:${quality}`);
    if (!definition) fail('UNKNOWN_CARD_QUALITY', `missing quality definition: ${cardId}:${quality}`);
    return definition;
  }

  availableCopies(cardId: unknown, quality: unknown, ownedQuantity: unknown = 0): number {
    const definition = this.get(cardId, quality);
    if (!nonNegativeInteger(ownedQuantity) || ownedQuantity > definition.copyLimit) {
      fail('QUANTITY_EXCEEDED', 'owned quantity is outside the configured copy limit');
    }
    return definition.copyLimit - ownedQuantity;
  }

  validateGrant(input: unknown): CardQualityGrant {
    const grant = normalizeGrantInput(input);
    const definition = this.get(grant.cardId, grant.quality);
    if (typeof grant.source !== 'string' || !this.allowedSourceSet.has(grant.source)) {
      fail('INVALID_SOURCE', `grant source is not authorized: ${String(grant.source)}`);
    }
    if (!definition.sources.includes(grant.source)) {
      fail('SOURCE_NOT_ALLOWED', `${definition.cardId}:${definition.quality} cannot be granted from ${grant.source}`);
    }
    const ownedQuantity = grant.ownedQuantity === undefined ? 0 : grant.ownedQuantity;
    if (!nonNegativeInteger(ownedQuantity) || !positiveInteger(grant.quantity)) {
      fail('INVALID_GRANT', 'grant quantity must be positive and ownedQuantity must be non-negative safe integers');
    }
    if (ownedQuantity > definition.copyLimit || grant.quantity > definition.copyLimit - ownedQuantity) {
      fail('QUANTITY_EXCEEDED', `${definition.cardId}:${definition.quality} copy limit is ${definition.copyLimit}`);
    }
    return Object.freeze({
      cardId: definition.cardId,
      quality: definition.quality,
      source: grant.source,
      quantity: grant.quantity,
      ownedQuantity,
      remainingQuantity: definition.copyLimit - ownedQuantity - grant.quantity,
    });
  }

  canGrant(input: unknown): boolean {
    try {
      this.validateGrant(input);
      return true;
    } catch (error) {
      if (error instanceof CardQualityError) return false;
      throw error;
    }
  }
}

export function createCardQualityCatalog(options: CardQualityCatalogOptions): CardQualityCatalog {
  return new CardQualityCatalog(options);
}

export function validateCardQualityConfig(
  metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
  entries: readonly unknown[] | { readonly entries: readonly unknown[] },
  allowedSources: readonly string[] = CARD_QUALITY_SOURCES,
): readonly CardQualityDefinition[] {
  const normalizedMetadata = normalizeMetadata(metadata);
  const normalizedSources = normalizeSources(allowedSources, 'INVALID_CONFIG');
  return normalizeEntries(entries, normalizedMetadata, normalizedSources, 'INVALID_CONFIG');
}

export function serializeCardQualityCatalog(catalog: CardQualityCatalog): string {
  if (!(catalog instanceof CardQualityCatalog)) fail('INVALID_STATE', 'serialize requires a CardQualityCatalog');
  return catalog.save();
}

export function restoreCardQualityCatalog(
  metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
  serialized: string,
  options: CardQualityRestoreOptions = {},
): CardQualityCatalog {
  return CardQualityCatalog.restore(metadata, serialized, options);
}
