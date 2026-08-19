export const CARD_INVENTORY_SCHEMA_VERSION = 1 as const;

export const CARD_QUALITIES = Object.freeze([1, 2, 3, 4, 5, 6]) as readonly [1, 2, 3, 4, 5, 6];
export type CardQuality = (typeof CARD_QUALITIES)[number];

export const CARD_INVENTORY_SOURCES = Object.freeze([
  'STARTER',
  'CAMPAIGN_REWARD',
  'STAGE_REWARD',
  'DUNGEON_REWARD',
  'TOWER_REWARD',
  'SHOP',
  'EVENT',
  'CRAFT',
  'SYNTHESIS',
  'COMPENSATION',
  'MAIL',
  'FIRST_CLEAR',
  'WEIGHTED',
  'PITY',
]) as readonly [
  'STARTER',
  'CAMPAIGN_REWARD',
  'STAGE_REWARD',
  'DUNGEON_REWARD',
  'TOWER_REWARD',
  'SHOP',
  'EVENT',
  'CRAFT',
  'SYNTHESIS',
  'COMPENSATION',
  'MAIL',
  'FIRST_CLEAR',
  'WEIGHTED',
  'PITY',
];
export type CardInventorySource = (typeof CARD_INVENTORY_SOURCES)[number];

export type CardType = 'UNIT' | 'SKILL';
export type CardInventorySortField =
  | 'cardId'
  | 'quantity'
  | 'quality'
  | 'locked'
  | 'source'
  | 'cardType'
  | 'race'
  | 'profession'
  | 'prepare';
export type CardInventorySortDirection = 'asc' | 'desc';

export interface CardMetadata {
  readonly id: string;
  readonly cardType: CardType;
  readonly rarity: CardQuality;
  readonly copyLimit: number;
  readonly unitId?: string;
  readonly skillId?: string;
  readonly race?: string;
  readonly profession?: string;
  readonly prepare?: number;
}

export interface CardInventoryEntry {
  readonly cardId: string;
  readonly quantity: number;
  readonly quality: CardQuality;
  readonly locked: boolean;
  readonly source: CardInventorySource;
}

export interface CardInventoryFilter {
  readonly cardIds?: readonly string[];
  readonly qualities?: readonly CardQuality[];
  readonly sources?: readonly CardInventorySource[];
  readonly locked?: boolean;
  readonly cardTypes?: readonly CardType[];
  readonly races?: readonly string[];
  readonly professions?: readonly string[];
  readonly minQuantity?: number;
  readonly maxQuantity?: number;
}

export interface CardInventorySort {
  readonly field: CardInventorySortField;
  readonly direction: CardInventorySortDirection;
}

export interface CardInventoryState {
  readonly schemaVersion: typeof CARD_INVENTORY_SCHEMA_VERSION;
  readonly entries: readonly CardInventoryEntry[];
  readonly filter: CardInventoryFilter;
  readonly sort: CardInventorySort;
}

export interface CardInventoryOptions {
  readonly metadata: readonly unknown[] | { readonly cards: readonly unknown[] };
  readonly state?: unknown;
  readonly allowedSources?: readonly string[];
  readonly onSave?: (serialized: string) => void;
}

export interface CardInventoryRecordRef {
  readonly cardId: string;
  readonly quality?: CardQuality;
  readonly source?: CardInventorySource;
}

export type CardInventoryErrorCode =
  | 'INVALID_METADATA'
  | 'UNKNOWN_CARD'
  | 'INVALID_ENTRY'
  | 'INVALID_QUANTITY'
  | 'INVALID_QUALITY'
  | 'INVALID_SOURCE'
  | 'INVALID_FILTER'
  | 'INVALID_SORT'
  | 'DUPLICATE_RECORD'
  | 'RECORD_NOT_FOUND'
  | 'AMBIGUOUS_RECORD'
  | 'CARD_LOCKED'
  | 'QUANTITY_EXCEEDED';

export class CardInventoryError extends Error {
  readonly code: CardInventoryErrorCode;

  constructor(code: CardInventoryErrorCode, message: string) {
    super(message);
    this.name = 'CardInventoryError';
    this.code = code;
  }
}

const CARD_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const CARD_TYPES = Object.freeze(['UNIT', 'SKILL']) as readonly CardType[];
const SORT_FIELDS = Object.freeze([
  'cardId',
  'quantity',
  'quality',
  'locked',
  'source',
  'cardType',
  'race',
  'profession',
  'prepare',
]) as readonly CardInventorySortField[];
const FILTER_KEYS = new Set([
  'cardIds',
  'cardId',
  'qualities',
  'quality',
  'sources',
  'source',
  'locked',
  'cardTypes',
  'cardType',
  'races',
  'race',
  'professions',
  'profession',
  'minQuantity',
  'maxQuantity',
]);
const ENTRY_KEYS = new Set(['cardId', 'quantity', 'quality', 'locked', 'source']);
const STATE_KEYS = new Set(['schemaVersion', 'entries', 'filter', 'sort']);
const SORT_KEYS = new Set(['field', 'direction']);
const REF_KEYS = new Set(['cardId', 'quality', 'source']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(code: CardInventoryErrorCode, message: string): never {
  throw new CardInventoryError(code, message);
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
  code: CardInventoryErrorCode = 'INVALID_ENTRY',
): void {
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
  return typeof value === 'number' && CARD_QUALITIES.includes(value as CardQuality);
}

function validCardType(value: unknown): value is CardType {
  return typeof value === 'string' && CARD_TYPES.includes(value as CardType);
}

function validSource(value: unknown, sources: ReadonlySet<string>): value is CardInventorySource {
  return typeof value === 'string' && sources.has(value);
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail('INVALID_ENTRY', `${label} must be a non-empty trimmed string`);
  }
  return value;
}

function cloneEntry(entry: CardInventoryEntry): CardInventoryEntry {
  return { ...entry };
}

function cloneFilter(filter: CardInventoryFilter): CardInventoryFilter {
  return {
    ...(filter.cardIds === undefined ? {} : { cardIds: [...filter.cardIds] }),
    ...(filter.qualities === undefined ? {} : { qualities: [...filter.qualities] }),
    ...(filter.sources === undefined ? {} : { sources: [...filter.sources] }),
    ...(filter.locked === undefined ? {} : { locked: filter.locked }),
    ...(filter.cardTypes === undefined ? {} : { cardTypes: [...filter.cardTypes] }),
    ...(filter.races === undefined ? {} : { races: [...filter.races] }),
    ...(filter.professions === undefined ? {} : { professions: [...filter.professions] }),
    ...(filter.minQuantity === undefined ? {} : { minQuantity: filter.minQuantity }),
    ...(filter.maxQuantity === undefined ? {} : { maxQuantity: filter.maxQuantity }),
  };
}

function freezeState(state: CardInventoryState): CardInventoryState {
  const entries = Object.freeze(state.entries.map((entry) => Object.freeze(cloneEntry(entry))));
  const filter = Object.freeze({
    ...(state.filter.cardIds === undefined ? {} : { cardIds: Object.freeze([...state.filter.cardIds]) }),
    ...(state.filter.qualities === undefined ? {} : { qualities: Object.freeze([...state.filter.qualities]) }),
    ...(state.filter.sources === undefined ? {} : { sources: Object.freeze([...state.filter.sources]) }),
    ...(state.filter.locked === undefined ? {} : { locked: state.filter.locked }),
    ...(state.filter.cardTypes === undefined ? {} : { cardTypes: Object.freeze([...state.filter.cardTypes]) }),
    ...(state.filter.races === undefined ? {} : { races: Object.freeze([...state.filter.races]) }),
    ...(state.filter.professions === undefined ? {} : { professions: Object.freeze([...state.filter.professions]) }),
    ...(state.filter.minQuantity === undefined ? {} : { minQuantity: state.filter.minQuantity }),
    ...(state.filter.maxQuantity === undefined ? {} : { maxQuantity: state.filter.maxQuantity }),
  });
  const sort = Object.freeze({ ...state.sort });
  return Object.freeze({ schemaVersion: CARD_INVENTORY_SCHEMA_VERSION, entries, filter, sort });
}

function metadataRows(input: readonly unknown[] | { readonly cards: readonly unknown[] }): readonly unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && Array.isArray(input.cards)) return input.cards;
  fail('INVALID_METADATA', 'card metadata must be an array or a cards table');
}

function normalizeMetadata(input: readonly unknown[] | { readonly cards: readonly unknown[] }): ReadonlyMap<string, CardMetadata> {
  const cards = new Map<string, CardMetadata>();
  for (const [index, raw] of metadataRows(input).entries()) {
    if (!isRecord(raw)) fail('INVALID_METADATA', `card metadata row ${index} must be an object`);
    if (raw.enabled === false) continue;
    const id = raw.id;
    if (typeof id !== 'string' || !CARD_ID_PATTERN.test(id)) {
      fail('INVALID_METADATA', `card metadata row ${index} has an invalid ID`);
    }
    if (cards.has(id)) fail('INVALID_METADATA', `duplicate card metadata ID: ${id}`);
    if (!validCardType(raw.cardType)) fail('INVALID_METADATA', `invalid card type for ${id}`);
    if (!validQuality(raw.rarity)) fail('INVALID_METADATA', `invalid rarity for ${id}`);
    if (!positiveInteger(raw.copyLimit)) fail('INVALID_METADATA', `invalid copy limit for ${id}`);

    const metadata: CardMetadata = {
      id,
      cardType: raw.cardType,
      rarity: raw.rarity,
      copyLimit: raw.copyLimit,
      ...(raw.unitId === undefined ? {} : { unitId: stringValue(raw.unitId, `${id}.unitId`) }),
      ...(raw.skillId === undefined ? {} : { skillId: stringValue(raw.skillId, `${id}.skillId`) }),
      ...(raw.race === undefined ? {} : { race: stringValue(raw.race, `${id}.race`) }),
      ...(raw.profession === undefined ? {} : { profession: stringValue(raw.profession, `${id}.profession`) }),
      ...(raw.prepare === undefined ? {} : { prepare: raw.prepare as number }),
    };
    if (metadata.prepare !== undefined && !nonNegativeInteger(metadata.prepare)) {
      fail('INVALID_METADATA', `invalid prepare for ${id}`);
    }
    if (metadata.cardType === 'UNIT' && metadata.unitId !== undefined && metadata.unitId !== id) {
      fail('INVALID_METADATA', `unit reference mismatch for ${id}`);
    }
    if (metadata.cardType === 'SKILL' && metadata.skillId !== undefined && metadata.skillId !== id) {
      fail('INVALID_METADATA', `skill reference mismatch for ${id}`);
    }
    cards.set(id, Object.freeze(metadata));
  }
  if (cards.size === 0) fail('INVALID_METADATA', 'card metadata is empty');
  return cards;
}

function normalizeSources(input: readonly string[] | undefined): ReadonlySet<string> {
  const values = input ?? CARD_INVENTORY_SOURCES;
  if (!Array.isArray(values) || values.length === 0) fail('INVALID_SOURCE', 'source authority must be non-empty');
  const result = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || result.has(value)) {
      fail('INVALID_SOURCE', 'source authority contains an invalid or duplicate source');
    }
    result.add(value);
  }
  return result;
}

function normalizeSource(value: unknown, sources: ReadonlySet<string>, label: string): CardInventorySource {
  if (!validSource(value, sources)) fail('INVALID_SOURCE', `${label} is invalid: ${String(value)}`);
  return value;
}

function normalizeQuality(value: unknown, label: string): CardQuality {
  if (!validQuality(value)) fail('INVALID_QUALITY', `${label} must be an integer from 1 to 6`);
  return value;
}

function normalizeEntry(
  raw: unknown,
  metadata: ReadonlyMap<string, CardMetadata>,
  sources: ReadonlySet<string>,
  label: string,
): CardInventoryEntry {
  if (!isRecord(raw)) fail('INVALID_ENTRY', `${label} must be an object`);
  assertOnlyKeys(raw, ENTRY_KEYS, label);
  for (const key of ENTRY_KEYS) {
    if (!hasOwn(raw, key)) fail('INVALID_ENTRY', `${label}.${key} is required`);
  }
  const cardId = raw.cardId;
  if (typeof cardId !== 'string' || !metadata.has(cardId)) fail('UNKNOWN_CARD', `${label}.cardId is unknown: ${String(cardId)}`);
  if (!positiveInteger(raw.quantity)) fail('INVALID_QUANTITY', `${label}.quantity must be a positive safe integer`);
  const quality = normalizeQuality(raw.quality, `${label}.quality`);
  if (typeof raw.locked !== 'boolean') fail('INVALID_ENTRY', `${label}.locked must be boolean`);
  const source = normalizeSource(raw.source, sources, `${label}.source`);
  return { cardId, quantity: raw.quantity, quality, locked: raw.locked, source };
}

function recordKey(entry: Pick<CardInventoryEntry, 'cardId' | 'quality' | 'source'>): string {
  return JSON.stringify([entry.cardId, entry.quality, entry.source]);
}

function normalizeEntries(
  rawEntries: unknown,
  metadata: ReadonlyMap<string, CardMetadata>,
  sources: ReadonlySet<string>,
): CardInventoryEntry[] {
  if (!Array.isArray(rawEntries)) fail('INVALID_ENTRY', 'entries must be an array');
  const keys = new Set<string>();
  const entries = rawEntries.map((raw, index) => {
    const entry = normalizeEntry(raw, metadata, sources, `entries[${index}]`);
    const key = recordKey(entry);
    if (keys.has(key)) fail('DUPLICATE_RECORD', `duplicate inventory record: ${key}`);
    keys.add(key);
    return entry;
  });
  return entries;
}

function normalizeList<T>(value: unknown, label: string, validate: (item: unknown) => item is T): T[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !validate(item))) {
    fail('INVALID_FILTER', `${label} must be a non-empty array of valid values`);
  }
  const result = [...value] as T[];
  if (new Set(result).size !== result.length) fail('INVALID_FILTER', `${label} must not contain duplicates`);
  return result;
}

function normalizeSingleOrList<T>(
  input: Record<string, unknown>,
  listKey: string,
  singleKey: string,
  label: string,
  validate: (item: unknown) => item is T,
): T[] | undefined {
  if (hasOwn(input, listKey) && hasOwn(input, singleKey)) {
    fail('INVALID_FILTER', `${label} cannot provide both ${listKey} and ${singleKey}`);
  }
  if (hasOwn(input, listKey)) return normalizeList(input[listKey], `${label}.${listKey}`, validate);
  if (hasOwn(input, singleKey)) {
    if (!validate(input[singleKey])) fail('INVALID_FILTER', `${label}.${singleKey} is invalid`);
    return [input[singleKey] as T];
  }
  return undefined;
}

function normalizeFilter(
  raw: unknown,
  metadata: ReadonlyMap<string, CardMetadata>,
  sources: ReadonlySet<string>,
): CardInventoryFilter {
  if (!isRecord(raw)) fail('INVALID_FILTER', 'filter must be an object');
  assertOnlyKeys(raw, FILTER_KEYS, 'filter', 'INVALID_FILTER');
  const cardIds = normalizeSingleOrList(raw, 'cardIds', 'cardId', 'filter', (value): value is string => {
    return typeof value === 'string' && metadata.has(value);
  });
  const qualities = normalizeSingleOrList(raw, 'qualities', 'quality', 'filter', (value): value is CardQuality => validQuality(value));
  const filterSources = normalizeSingleOrList(raw, 'sources', 'source', 'filter', (value): value is CardInventorySource => validSource(value, sources));
  const cardTypes = normalizeSingleOrList(raw, 'cardTypes', 'cardType', 'filter', (value): value is CardType => validCardType(value));
  const races = normalizeSingleOrList(raw, 'races', 'race', 'filter', (value): value is string => {
    return typeof value === 'string' && [...metadata.values()].some((card) => card.race === value);
  });
  const professions = normalizeSingleOrList(raw, 'professions', 'profession', 'filter', (value): value is string => {
    return typeof value === 'string' && [...metadata.values()].some((card) => card.profession === value);
  });

  if (hasOwn(raw, 'locked') && typeof raw.locked !== 'boolean') fail('INVALID_FILTER', 'filter.locked must be boolean');
  if (hasOwn(raw, 'minQuantity') && !nonNegativeInteger(raw.minQuantity)) fail('INVALID_FILTER', 'filter.minQuantity is invalid');
  if (hasOwn(raw, 'maxQuantity') && !nonNegativeInteger(raw.maxQuantity)) fail('INVALID_FILTER', 'filter.maxQuantity is invalid');
  if (raw.minQuantity !== undefined && raw.maxQuantity !== undefined && raw.minQuantity > raw.maxQuantity) {
    fail('INVALID_FILTER', 'filter quantity bounds are inverted');
  }

  return {
    ...(cardIds === undefined ? {} : { cardIds: [...cardIds].sort() }),
    ...(qualities === undefined ? {} : { qualities: [...qualities].sort((left, right) => left - right) }),
    ...(filterSources === undefined ? {} : { sources: [...filterSources].sort() }),
    ...(raw.locked === undefined ? {} : { locked: raw.locked }),
    ...(cardTypes === undefined ? {} : { cardTypes: [...cardTypes].sort() }),
    ...(races === undefined ? {} : { races: [...races].sort() }),
    ...(professions === undefined ? {} : { professions: [...professions].sort() }),
    ...(raw.minQuantity === undefined ? {} : { minQuantity: raw.minQuantity }),
    ...(raw.maxQuantity === undefined ? {} : { maxQuantity: raw.maxQuantity }),
  };
}

function normalizeSort(raw: unknown): CardInventorySort {
  if (!isRecord(raw)) fail('INVALID_SORT', 'sort must be an object');
  assertOnlyKeys(raw, SORT_KEYS, 'sort', 'INVALID_SORT');
  if (!SORT_FIELDS.includes(raw.field as CardInventorySortField)) fail('INVALID_SORT', `sort.field is invalid: ${String(raw.field)}`);
  if (raw.direction !== 'asc' && raw.direction !== 'desc') fail('INVALID_SORT', 'sort.direction must be asc or desc');
  return { field: raw.field as CardInventorySortField, direction: raw.direction };
}

function parseState(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail('INVALID_ENTRY', `saved inventory is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function normalizeState(
  raw: unknown,
  metadata: ReadonlyMap<string, CardMetadata>,
  sources: ReadonlySet<string>,
): CardInventoryState {
  const value = parseState(raw);
  if (!isRecord(value)) fail('INVALID_ENTRY', 'saved inventory must be an object');
  assertOnlyKeys(value, STATE_KEYS, 'saved inventory');
  if (value.schemaVersion !== CARD_INVENTORY_SCHEMA_VERSION) fail('INVALID_ENTRY', 'unsupported inventory schema version');
  if (!hasOwn(value, 'entries') || !hasOwn(value, 'filter') || !hasOwn(value, 'sort')) {
    fail('INVALID_ENTRY', 'saved inventory must contain entries, filter and sort');
  }
  const entries = normalizeEntries(value.entries, metadata, sources);
  const filter = normalizeFilter(value.filter, metadata, sources);
  const sort = normalizeSort(value.sort);
  return { schemaVersion: CARD_INVENTORY_SCHEMA_VERSION, entries, filter, sort };
}

function defaultState(): CardInventoryState {
  return {
    schemaVersion: CARD_INVENTORY_SCHEMA_VERSION,
    entries: [],
    filter: {},
    sort: { field: 'cardId', direction: 'asc' },
  };
}

export class CardInventoryService {
  private readonly metadataById: ReadonlyMap<string, CardMetadata>;
  private readonly sources: ReadonlySet<string>;
  private readonly onSave?: (serialized: string) => void;
  private entries: CardInventoryEntry[];
  private filter: CardInventoryFilter;
  private sort: CardInventorySort;

  constructor(options: CardInventoryOptions) {
    this.metadataById = normalizeMetadata(options.metadata);
    this.sources = normalizeSources(options.allowedSources);
    this.onSave = options.onSave;
    const state = normalizeState(options.state ?? defaultState(), this.metadataById, this.sources);
    this.entries = state.entries;
    this.filter = state.filter;
    this.sort = state.sort;
  }

  static restore(
    metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
    serialized: string,
    options: Omit<CardInventoryOptions, 'metadata' | 'state'> = {},
  ): CardInventoryService {
    return new CardInventoryService({ ...options, metadata, state: serialized });
  }

  snapshot(): CardInventoryState {
    return freezeState({
      schemaVersion: CARD_INVENTORY_SCHEMA_VERSION,
      entries: this.entries,
      filter: this.filter,
      sort: this.sort,
    });
  }

  save(): string {
    return JSON.stringify(this.snapshot());
  }

  getMetadata(cardId: string): CardMetadata {
    const metadata = this.metadataById.get(cardId);
    if (!metadata) fail('UNKNOWN_CARD', `unknown card: ${cardId}`);
    return { ...metadata };
  }

  getRecord(reference: CardInventoryRecordRef | string): CardInventoryEntry {
    return cloneEntry(this.resolveRecord(reference));
  }

  query(): readonly CardInventoryEntry[] {
    const filtered = this.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => this.matchesFilter(entry));
    filtered.sort((left, right) => {
      const comparison = this.compareEntries(left.entry, right.entry);
      if (comparison !== 0) return this.sort.direction === 'asc' ? comparison : -comparison;
      return left.index - right.index;
    });
    return Object.freeze(filtered.map(({ entry }) => Object.freeze(cloneEntry(entry))));
  }

  list(): readonly CardInventoryEntry[] {
    return this.query();
  }

  add(input: unknown): CardInventoryEntry {
    return this.transact(() => {
      if (!isRecord(input)) fail('INVALID_ENTRY', 'add input must be an object');
      assertOnlyKeys(input, new Set(['cardId', 'quantity', 'quality', 'source', 'locked']), 'add input');
      const cardId = input.cardId;
      const metadata = typeof cardId === 'string' ? this.metadataById.get(cardId) : undefined;
      if (!metadata) fail('UNKNOWN_CARD', `unknown card: ${String(cardId)}`);
      if (!positiveInteger(input.quantity)) fail('INVALID_QUANTITY', 'add quantity must be a positive safe integer');
      const quality = normalizeQuality(input.quality === undefined ? metadata.rarity : input.quality, 'add quality');
      const source = normalizeSource(input.source, this.sources, 'add source');
      if (input.locked !== undefined && typeof input.locked !== 'boolean') fail('INVALID_ENTRY', 'add locked must be boolean');
      const key = recordKey({ cardId, quality, source });
      const index = this.entries.findIndex((entry) => recordKey(entry) === key);
      if (index === -1) {
        const entry = { cardId, quantity: input.quantity, quality, locked: input.locked ?? false, source };
        this.entries.push(entry);
        return cloneEntry(entry);
      }
      const current = this.entries[index];
      if (current.quantity > Number.MAX_SAFE_INTEGER - input.quantity) {
        fail('QUANTITY_EXCEEDED', 'inventory quantity exceeds the safe integer limit');
      }
      const updated = { ...current, quantity: current.quantity + input.quantity };
      this.entries[index] = updated;
      return cloneEntry(updated);
    });
  }

  addCard(cardId: string, quantity: number, source: CardInventorySource, quality?: CardQuality): CardInventoryEntry {
    return this.add({ cardId, quantity, source, ...(quality === undefined ? {} : { quality }) });
  }

  remove(reference: CardInventoryRecordRef | string, quantity: number): CardInventoryEntry | undefined {
    return this.transact(() => {
      if (!positiveInteger(quantity)) fail('INVALID_QUANTITY', 'remove quantity must be a positive safe integer');
      const index = this.resolveIndex(reference);
      const current = this.entries[index];
      if (current.locked) fail('CARD_LOCKED', `locked card cannot be removed: ${current.cardId}`);
      if (quantity > current.quantity) fail('INVALID_QUANTITY', 'remove quantity exceeds inventory quantity');
      if (quantity === current.quantity) {
        this.entries.splice(index, 1);
        return undefined;
      }
      const updated = { ...current, quantity: current.quantity - quantity };
      this.entries[index] = updated;
      return cloneEntry(updated);
    });
  }

  removeCard(cardId: string, quantity: number, quality?: CardQuality, source?: CardInventorySource): CardInventoryEntry | undefined {
    return this.remove({ cardId, ...(quality === undefined ? {} : { quality }), ...(source === undefined ? {} : { source }) }, quantity);
  }

  setLocked(reference: CardInventoryRecordRef | string, locked: boolean): CardInventoryEntry {
    return this.transact(() => {
      if (typeof locked !== 'boolean') fail('INVALID_ENTRY', 'locked must be boolean');
      const index = this.resolveIndex(reference);
      const updated = { ...this.entries[index], locked };
      this.entries[index] = updated;
      return cloneEntry(updated);
    });
  }

  setCardLocked(cardId: string, locked: boolean, quality?: CardQuality, source?: CardInventorySource): CardInventoryEntry {
    return this.setLocked({ cardId, ...(quality === undefined ? {} : { quality }), ...(source === undefined ? {} : { source }) }, locked);
  }

  setFilter(filter: unknown): CardInventoryFilter {
    return this.transact(() => {
      this.filter = normalizeFilter(filter, this.metadataById, this.sources);
      return cloneFilter(this.filter);
    });
  }

  clearFilter(): CardInventoryFilter {
    return this.setFilter({});
  }

  setSort(sort: unknown): CardInventorySort {
    return this.transact(() => {
      this.sort = normalizeSort(sort);
      return { ...this.sort };
    });
  }

  private transact<T>(action: () => T): T {
    const before = this.save();
    try {
      const result = action();
      if (this.onSave) this.onSave(this.save());
      return result;
    } catch (error) {
      const restored = normalizeState(before, this.metadataById, this.sources);
      this.entries = restored.entries;
      this.filter = restored.filter;
      this.sort = restored.sort;
      throw error;
    }
  }

  private resolveIndex(reference: CardInventoryRecordRef | string): number {
    const normalized = this.normalizeReference(reference);
    const matches = this.entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        return entry.cardId === normalized.cardId
          && (normalized.quality === undefined || entry.quality === normalized.quality)
          && (normalized.source === undefined || entry.source === normalized.source);
      });
    if (matches.length === 0) fail('RECORD_NOT_FOUND', `inventory record not found: ${normalized.cardId}`);
    if (matches.length > 1) fail('AMBIGUOUS_RECORD', `inventory record is ambiguous: ${normalized.cardId}; quality and source are required`);
    return matches[0].index;
  }

  private resolveRecord(reference: CardInventoryRecordRef | string): CardInventoryEntry {
    return this.entries[this.resolveIndex(reference)];
  }

  private normalizeReference(reference: CardInventoryRecordRef | string): CardInventoryRecordRef {
    if (typeof reference === 'string') {
      if (!this.metadataById.has(reference)) fail('UNKNOWN_CARD', `unknown card: ${reference}`);
      return { cardId: reference };
    }
    if (!isRecord(reference)) fail('INVALID_ENTRY', 'record reference must be an object or card ID');
    assertOnlyKeys(reference, REF_KEYS, 'record reference');
    if (typeof reference.cardId !== 'string' || !this.metadataById.has(reference.cardId)) {
      fail('UNKNOWN_CARD', `unknown card: ${String(reference.cardId)}`);
    }
    if (reference.quality !== undefined) normalizeQuality(reference.quality, 'record reference quality');
    if (reference.source !== undefined) normalizeSource(reference.source, this.sources, 'record reference source');
    return {
      cardId: reference.cardId,
      ...(reference.quality === undefined ? {} : { quality: reference.quality }),
      ...(reference.source === undefined ? {} : { source: reference.source }),
    };
  }

  private matchesFilter(entry: CardInventoryEntry): boolean {
    const metadata = this.metadataById.get(entry.cardId)!;
    const filter = this.filter;
    if (filter.cardIds !== undefined && !filter.cardIds.includes(entry.cardId)) return false;
    if (filter.qualities !== undefined && !filter.qualities.includes(entry.quality)) return false;
    if (filter.sources !== undefined && !filter.sources.includes(entry.source)) return false;
    if (filter.locked !== undefined && filter.locked !== entry.locked) return false;
    if (filter.cardTypes !== undefined && !filter.cardTypes.includes(metadata.cardType)) return false;
    if (filter.races !== undefined && !filter.races.includes(metadata.race ?? '')) return false;
    if (filter.professions !== undefined && !filter.professions.includes(metadata.profession ?? '')) return false;
    if (filter.minQuantity !== undefined && entry.quantity < filter.minQuantity) return false;
    if (filter.maxQuantity !== undefined && entry.quantity > filter.maxQuantity) return false;
    return true;
  }

  private compareEntries(left: CardInventoryEntry, right: CardInventoryEntry): number {
    const leftMetadata = this.metadataById.get(left.cardId)!;
    const rightMetadata = this.metadataById.get(right.cardId)!;
    let leftValue: string | number | boolean;
    let rightValue: string | number | boolean;
    switch (this.sort.field) {
      case 'cardId':
        leftValue = left.cardId;
        rightValue = right.cardId;
        break;
      case 'quantity':
        leftValue = left.quantity;
        rightValue = right.quantity;
        break;
      case 'quality':
        leftValue = left.quality;
        rightValue = right.quality;
        break;
      case 'locked':
        leftValue = left.locked;
        rightValue = right.locked;
        break;
      case 'source':
        leftValue = left.source;
        rightValue = right.source;
        break;
      case 'cardType':
        leftValue = leftMetadata.cardType;
        rightValue = rightMetadata.cardType;
        break;
      case 'race':
        leftValue = leftMetadata.race ?? '';
        rightValue = rightMetadata.race ?? '';
        break;
      case 'profession':
        leftValue = leftMetadata.profession ?? '';
        rightValue = rightMetadata.profession ?? '';
        break;
      case 'prepare':
        leftValue = leftMetadata.prepare ?? 0;
        rightValue = rightMetadata.prepare ?? 0;
        break;
      default:
        fail('INVALID_SORT', `sort.field is invalid: ${String(this.sort.field)}`);
    }
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -1 : 1;
  }
}

export function createCardInventory(options: CardInventoryOptions): CardInventoryService {
  return new CardInventoryService(options);
}

export function restoreCardInventory(
  metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
  serialized: string,
  options: Omit<CardInventoryOptions, 'metadata' | 'state'> = {},
): CardInventoryService {
  return CardInventoryService.restore(metadata, serialized, options);
}
