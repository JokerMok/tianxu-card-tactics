export const DECK_MANAGEMENT_SCHEMA_VERSION = 1 as const;
export const MAX_DECK_CARDS = 30 as const;
export const MAX_DECK_NAME_LENGTH = 32 as const;
export const DEFAULT_DECK_ID = 'deck-default' as const;
export const DEFAULT_DECK_NAME = '默认牌组' as const;

export interface DeckCardMetadata {
  readonly id: string;
  readonly cardType: 'UNIT' | 'SKILL';
  readonly copyLimit: number;
}

export interface DeckCardEntry {
  readonly cardId: string;
  readonly count: number;
}

export interface Deck {
  readonly id: string;
  readonly name: string;
  readonly cardEntries: readonly DeckCardEntry[];
}

export interface DeckManagementState {
  readonly schemaVersion: typeof DECK_MANAGEMENT_SCHEMA_VERSION;
  readonly decks: readonly Deck[];
  readonly currentDeckId: string;
}

export interface DeckCreateInput {
  readonly id?: unknown;
  readonly name: unknown;
  readonly cardEntries?: unknown;
}

export interface DeckCopyInput {
  readonly id?: unknown;
  readonly name?: unknown;
}

export interface DeckCardMutationInput {
  readonly deckId?: unknown;
  readonly cardId: unknown;
  readonly count?: unknown;
}

export interface DeckManagementOptions {
  readonly metadata: readonly unknown[] | { readonly cards: readonly unknown[] };
  readonly state?: unknown;
  /** A map, inventory snapshot, or inventory service. Omitted means copyLimit is the available count. */
  readonly availableCards?: unknown;
  readonly availableCardCounts?: unknown;
  readonly cardInventory?: unknown;
  readonly onSave?: (serialized: string) => void;
}

export type DeckManagementErrorCode =
  | 'INVALID_METADATA'
  | 'INVALID_AVAILABILITY'
  | 'INVALID_STATE'
  | 'INVALID_DECK'
  | 'INVALID_DECK_ID'
  | 'INVALID_DECK_NAME'
  | 'DUPLICATE_DECK_ID'
  | 'DUPLICATE_DECK_NAME'
  | 'DECK_NOT_FOUND'
  | 'LAST_DECK_CANNOT_DELETE'
  | 'INVALID_CARD_ENTRY'
  | 'DUPLICATE_CARD_ENTRY'
  | 'UNKNOWN_CARD'
  | 'INVALID_CARD_COUNT'
  | 'CARD_COPY_LIMIT_EXCEEDED'
  | 'CARD_QUANTITY_UNAVAILABLE'
  | 'DECK_CARD_LIMIT_EXCEEDED'
  | 'CARD_NOT_IN_DECK'
  | 'CARD_COUNT_EXCEEDS_DECK'
  | 'PERSISTENCE_FAILED';

const ERROR_MESSAGES: Readonly<Record<DeckManagementErrorCode, string>> = {
  INVALID_METADATA: 'card metadata is invalid',
  INVALID_AVAILABILITY: 'available card quantities are invalid',
  INVALID_STATE: 'saved deck state is invalid',
  INVALID_DECK: 'deck input is invalid',
  INVALID_DECK_ID: 'deck ID is invalid',
  INVALID_DECK_NAME: 'deck name is invalid',
  DUPLICATE_DECK_ID: 'deck ID already exists',
  DUPLICATE_DECK_NAME: 'deck name already exists',
  DECK_NOT_FOUND: 'deck does not exist',
  LAST_DECK_CANNOT_DELETE: 'the last deck cannot be deleted',
  INVALID_CARD_ENTRY: 'card entry is invalid',
  DUPLICATE_CARD_ENTRY: 'card entry is duplicated',
  UNKNOWN_CARD: 'card does not exist or is disabled',
  INVALID_CARD_COUNT: 'card count must be a positive safe integer',
  CARD_COPY_LIMIT_EXCEEDED: 'card copy limit would be exceeded',
  CARD_QUANTITY_UNAVAILABLE: 'available card quantity is insufficient',
  DECK_CARD_LIMIT_EXCEEDED: 'deck cannot contain more than 30 cards',
  CARD_NOT_IN_DECK: 'card is not in the deck',
  CARD_COUNT_EXCEEDS_DECK: 'deck does not contain enough copies to remove',
  PERSISTENCE_FAILED: 'deck state could not be persisted',
};

export class DeckManagementError extends Error {
  readonly code: DeckManagementErrorCode;
  /** Stable, serializable reason for UI and telemetry. */
  readonly reason: DeckManagementErrorCode;
  readonly cause?: unknown;

  constructor(code: DeckManagementErrorCode, cause?: unknown) {
    super(ERROR_MESSAGES[code]);
    this.name = 'DeckManagementError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }

  toJSON(): { name: string; code: DeckManagementErrorCode; reason: DeckManagementErrorCode; message: string } {
    return { name: this.name, code: this.code, reason: this.reason, message: this.message };
  }
}

const CARD_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const DECK_ID_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
const STATE_KEYS = new Set(['schemaVersion', 'decks', 'currentDeckId']);
const DECK_KEYS = new Set(['id', 'name', 'cardEntries']);
const CARD_ENTRY_KEYS = new Set(['cardId', 'count']);
const CREATE_KEYS = new Set(['id', 'name', 'cardEntries']);
const COPY_KEYS = new Set(['id', 'name']);
const MUTATION_KEYS = new Set(['deckId', 'cardId', 'count']);

interface NormalizedCardMetadata {
  readonly id: string;
  readonly cardType: 'UNIT' | 'SKILL';
  readonly copyLimit: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(code: DeckManagementErrorCode): never {
  throw new DeckManagementError(code);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, code: DeckManagementErrorCode): void {
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(code);
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function metadataRows(input: readonly unknown[] | { readonly cards: readonly unknown[] }): readonly unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && Array.isArray(input.cards)) return input.cards;
  fail('INVALID_METADATA');
}

function normalizeMetadata(input: readonly unknown[] | { readonly cards: readonly unknown[] }): ReadonlyMap<string, NormalizedCardMetadata> {
  const cards = new Map<string, NormalizedCardMetadata>();
  for (const raw of metadataRows(input)) {
    if (!isRecord(raw)) fail('INVALID_METADATA');
    if (raw.enabled === false) continue;
    if (typeof raw.id !== 'string' || !CARD_ID_PATTERN.test(raw.id)
      || (raw.cardType !== 'UNIT' && raw.cardType !== 'SKILL')
      || !positiveInteger(raw.copyLimit)
      || cards.has(raw.id)) {
      fail('INVALID_METADATA');
    }
    cards.set(raw.id, { id: raw.id, cardType: raw.cardType, copyLimit: raw.copyLimit });
  }
  if (cards.size === 0) fail('INVALID_METADATA');
  return cards;
}

function normalizeDeckId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64 || !DECK_ID_PATTERN.test(value)) {
    fail('INVALID_DECK_ID');
  }
  return value;
}

function normalizeDeckName(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value
    || Array.from(value).length > MAX_DECK_NAME_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail('INVALID_DECK_NAME');
  }
  return value;
}

function parseState(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    fail('INVALID_STATE');
  }
}

function cloneEntries(entries: readonly DeckCardEntry[]): DeckCardEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

function freezeDeck(deck: Deck): Deck {
  return Object.freeze({
    id: deck.id,
    name: deck.name,
    cardEntries: Object.freeze(cloneEntries(deck.cardEntries).map((entry) => Object.freeze(entry))),
  });
}

function freezeState(state: DeckManagementState): DeckManagementState {
  return Object.freeze({
    schemaVersion: DECK_MANAGEMENT_SCHEMA_VERSION,
    decks: Object.freeze(state.decks.map((deck) => freezeDeck(deck))),
    currentDeckId: state.currentDeckId,
  });
}

function cloneDeck(deck: Deck): Deck {
  return { id: deck.id, name: deck.name, cardEntries: cloneEntries(deck.cardEntries) };
}

function cardQuantityFromRow(raw: unknown): { cardId: string; quantity: number } | undefined {
  if (!isRecord(raw)) return undefined;
  const cardId = raw.cardId ?? raw.id;
  const quantity = raw.quantity ?? raw.count ?? raw.copies;
  if (typeof cardId !== 'string' || !nonNegativeInteger(quantity)) return undefined;
  return { cardId, quantity };
}

function normalizeAvailability(
  input: unknown,
  metadata: ReadonlyMap<string, NormalizedCardMetadata>,
): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  if (input === undefined) {
    for (const [cardId, card] of metadata) result.set(cardId, card.copyLimit);
    return result;
  }
  for (const cardId of metadata.keys()) result.set(cardId, 0);

  let source = input;
  if (isRecord(source) && typeof source.snapshot === 'function') {
    source = source.snapshot();
  }
  if (isRecord(source) && Array.isArray(source.entries)) source = source.entries;
  else if (isRecord(source) && Array.isArray(source.cards)) source = source.cards;

  if (source instanceof Map) {
    for (const [cardId, quantity] of source.entries()) {
      if (typeof cardId !== 'string' || !metadata.has(cardId) || !nonNegativeInteger(quantity)) fail('INVALID_AVAILABILITY');
      result.set(cardId, quantity);
    }
    return result;
  }
  if (Array.isArray(source)) {
    for (const raw of source) {
      const row = cardQuantityFromRow(raw);
      if (!row || !metadata.has(row.cardId)) fail('INVALID_AVAILABILITY');
      result.set(row.cardId, (result.get(row.cardId) ?? 0) + row.quantity);
    }
    return result;
  }
  if (isRecord(source)) {
    for (const [cardId, quantity] of Object.entries(source)) {
      if (!metadata.has(cardId) || !nonNegativeInteger(quantity)) fail('INVALID_AVAILABILITY');
      result.set(cardId, quantity);
    }
    return result;
  }
  fail('INVALID_AVAILABILITY');
}

function normalizeCardEntries(
  rawEntries: unknown,
  metadata: ReadonlyMap<string, NormalizedCardMetadata>,
  available: ReadonlyMap<string, number>,
): DeckCardEntry[] {
  if (!Array.isArray(rawEntries)) fail('INVALID_CARD_ENTRY');
  const seen = new Set<string>();
  let total = 0;
  const entries = rawEntries.map((raw) => {
    if (!isRecord(raw)) fail('INVALID_CARD_ENTRY');
    assertOnlyKeys(raw, CARD_ENTRY_KEYS, 'INVALID_CARD_ENTRY');
    if (typeof raw.cardId !== 'string' || !metadata.has(raw.cardId)) fail('UNKNOWN_CARD');
    if (seen.has(raw.cardId)) fail('DUPLICATE_CARD_ENTRY');
    if (!positiveInteger(raw.count)) fail('INVALID_CARD_COUNT');
    const card = metadata.get(raw.cardId)!;
    if (raw.count > card.copyLimit) fail('CARD_COPY_LIMIT_EXCEEDED');
    if (raw.count > (available.get(raw.cardId) ?? 0)) fail('CARD_QUANTITY_UNAVAILABLE');
    if (total > MAX_DECK_CARDS - raw.count) fail('DECK_CARD_LIMIT_EXCEEDED');
    seen.add(raw.cardId);
    total += raw.count;
    return { cardId: raw.cardId, count: raw.count };
  });
  return entries;
}

function normalizeDeck(
  raw: unknown,
  metadata: ReadonlyMap<string, NormalizedCardMetadata>,
  available: ReadonlyMap<string, number>,
): Deck {
  if (!isRecord(raw)) fail('INVALID_DECK');
  assertOnlyKeys(raw, DECK_KEYS, 'INVALID_DECK');
  if (!hasOwn(raw, 'id') || !hasOwn(raw, 'name') || !hasOwn(raw, 'cardEntries')) fail('INVALID_DECK');
  return {
    id: normalizeDeckId(raw.id),
    name: normalizeDeckName(raw.name),
    cardEntries: normalizeCardEntries(raw.cardEntries, metadata, available),
  };
}

function defaultState(): DeckManagementState {
  return {
    schemaVersion: DECK_MANAGEMENT_SCHEMA_VERSION,
    decks: [{ id: DEFAULT_DECK_ID, name: DEFAULT_DECK_NAME, cardEntries: [] }],
    currentDeckId: DEFAULT_DECK_ID,
  };
}

function assertUniqueDecks(decks: readonly Deck[]): void {
  const ids = new Set<string>();
  const names = new Set<string>();
  for (const deck of decks) {
    if (ids.has(deck.id)) fail('DUPLICATE_DECK_ID');
    if (names.has(deck.name)) fail('DUPLICATE_DECK_NAME');
    ids.add(deck.id);
    names.add(deck.name);
  }
}

function normalizeState(
  raw: unknown,
  metadata: ReadonlyMap<string, NormalizedCardMetadata>,
  available: ReadonlyMap<string, number>,
): DeckManagementState {
  const value = parseState(raw);
  if (!isRecord(value)) fail('INVALID_STATE');
  assertOnlyKeys(value, STATE_KEYS, 'INVALID_STATE');
  if (value.schemaVersion !== DECK_MANAGEMENT_SCHEMA_VERSION || !Array.isArray(value.decks)
    || typeof value.currentDeckId !== 'string') fail('INVALID_STATE');
  const decks = value.decks.map((rawDeck) => normalizeDeck(rawDeck, metadata, available));
  if (decks.length === 0) fail('INVALID_STATE');
  assertUniqueDecks(decks);
  if (!decks.some((deck) => deck.id === value.currentDeckId)) fail('DECK_NOT_FOUND');
  return { schemaVersion: DECK_MANAGEMENT_SCHEMA_VERSION, decks, currentDeckId: value.currentDeckId };
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function truncateName(value: string, maxLength: number): string {
  return Array.from(value).slice(0, maxLength).join('');
}

export class DeckManagementService {
  private readonly metadataById: ReadonlyMap<string, NormalizedCardMetadata>;
  private readonly availableById: ReadonlyMap<string, number>;
  private readonly onSave?: (serialized: string) => void;
  private decks: Deck[];
  private currentDeckIdValue: string;

  constructor(options: DeckManagementOptions) {
    this.metadataById = normalizeMetadata(options.metadata);
    const availabilityInput = options.availableCards ?? options.availableCardCounts ?? options.cardInventory;
    this.availableById = normalizeAvailability(availabilityInput, this.metadataById);
    const state = normalizeState(options.state ?? defaultState(), this.metadataById, this.availableById);
    this.decks = state.decks.map(cloneDeck);
    this.currentDeckIdValue = state.currentDeckId;
    this.onSave = options.onSave;
  }

  static restore(
    metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
    serialized: string,
    options: Omit<DeckManagementOptions, 'metadata' | 'state'> = {},
  ): DeckManagementService {
    return new DeckManagementService({ ...options, metadata, state: serialized });
  }

  get currentDeckId(): string {
    return this.currentDeckIdValue;
  }

  snapshot(): DeckManagementState {
    return freezeState({
      schemaVersion: DECK_MANAGEMENT_SCHEMA_VERSION,
      decks: this.decks,
      currentDeckId: this.currentDeckIdValue,
    });
  }

  save(): string {
    return JSON.stringify(this.snapshot());
  }

  listDecks(): readonly Deck[] {
    return this.snapshot().decks;
  }

  getDeck(deckId: string): Deck {
    return freezeDeck(cloneDeck(this.getDeckInternal(deckId)));
  }

  getCurrentDeck(): Deck {
    return this.getDeck(this.currentDeckIdValue);
  }

  getAvailableCardCount(cardId: string): number {
    this.getCardMetadata(cardId);
    return this.availableById.get(cardId)!;
  }

  createDeck(input: string | DeckCreateInput, id?: string): Deck {
    return this.transact(() => {
      const parsed = this.parseCreateInput(input, id);
      const deckId = parsed.id === undefined ? this.nextDeckId() : normalizeDeckId(parsed.id);
      if (this.decks.some((deck) => deck.id === deckId)) fail('DUPLICATE_DECK_ID');
      const name = normalizeDeckName(parsed.name);
      this.assertUniqueName(name);
      const deck: Deck = {
        id: deckId,
        name,
        cardEntries: normalizeCardEntries(parsed.cardEntries ?? [], this.metadataById, this.availableById),
      };
      this.decks.push(deck);
      return cloneDeck(deck);
    });
  }

  newDeck(input: string | DeckCreateInput, id?: string): Deck {
    return this.createDeck(input, id);
  }

  renameDeck(deckId: string, name: unknown): Deck {
    return this.transact(() => {
      const index = this.getDeckIndex(deckId);
      const normalizedName = normalizeDeckName(name);
      this.assertUniqueName(normalizedName, deckId);
      this.decks[index] = { ...this.decks[index], name: normalizedName };
      return cloneDeck(this.decks[index]);
    });
  }

  copyDeck(sourceDeckId: string, input?: string | DeckCopyInput): Deck {
    return this.transact(() => {
      const source = this.getDeckInternal(sourceDeckId);
      const parsed = this.parseCopyInput(input);
      const deckId = parsed.id === undefined ? this.nextDeckId() : normalizeDeckId(parsed.id);
      if (this.decks.some((deck) => deck.id === deckId)) fail('DUPLICATE_DECK_ID');
      const name = parsed.name === undefined ? this.nextCopyName(source.name) : normalizeDeckName(parsed.name);
      this.assertUniqueName(name);
      const copy: Deck = { id: deckId, name, cardEntries: cloneEntries(source.cardEntries) };
      this.decks.push(copy);
      return cloneDeck(copy);
    });
  }

  deleteDeck(deckId: string): DeckManagementState {
    return this.transact(() => {
      const index = this.getDeckIndex(deckId);
      if (this.decks.length === 1) fail('LAST_DECK_CANNOT_DELETE');
      const wasCurrent = this.currentDeckIdValue === deckId;
      this.decks.splice(index, 1);
      if (wasCurrent) {
        const fallbackIndex = index < this.decks.length ? index : this.decks.length - 1;
        this.currentDeckIdValue = this.decks[fallbackIndex].id;
      }
      return this.snapshot();
    });
  }

  switchDeck(deckId: string): Deck {
    return this.transact(() => {
      this.getDeckIndex(deckId);
      this.currentDeckIdValue = deckId;
      return cloneDeck(this.getDeckInternal(deckId));
    });
  }

  addCard(input: DeckCardMutationInput | string, countOrCardId?: unknown, deckIdOrCount?: unknown): Deck {
    return this.mutateCard('add', input, countOrCardId, deckIdOrCount);
  }

  addCardToDeck(deckId: string, cardId: string, count = 1): Deck {
    return this.addCard({ deckId, cardId, count });
  }

  removeCard(input: DeckCardMutationInput | string, countOrCardId?: unknown, deckIdOrCount?: unknown): Deck {
    return this.mutateCard('remove', input, countOrCardId, deckIdOrCount);
  }

  removeCardFromDeck(deckId: string, cardId: string, count = 1): Deck {
    return this.removeCard({ deckId, cardId, count });
  }

  private mutateCard(
    operation: 'add' | 'remove',
    input: DeckCardMutationInput | string,
    countOrCardId?: unknown,
    deckIdOrCount?: unknown,
  ): Deck {
    return this.transact(() => {
      const parsed = this.parseMutationInput(input, countOrCardId, deckIdOrCount);
      const deckIndex = this.getDeckIndex(parsed.deckId);
      const card = this.getCardMetadata(parsed.cardId);
      if (!positiveInteger(parsed.count)) fail('INVALID_CARD_COUNT');
      const deck = this.decks[deckIndex];
      const entryIndex = deck.cardEntries.findIndex((entry) => entry.cardId === card.id);
      if (operation === 'remove') {
        if (entryIndex === -1) fail('CARD_NOT_IN_DECK');
        const current = deck.cardEntries[entryIndex];
        if (parsed.count > current.count) fail('CARD_COUNT_EXCEEDS_DECK');
        const nextEntries = [...deck.cardEntries];
        if (parsed.count === current.count) nextEntries.splice(entryIndex, 1);
        else nextEntries[entryIndex] = { cardId: card.id, count: current.count - parsed.count };
        this.decks[deckIndex] = { ...deck, cardEntries: nextEntries };
        return cloneDeck(this.decks[deckIndex]);
      }

      const currentCount = entryIndex === -1 ? 0 : deck.cardEntries[entryIndex].count;
      if (currentCount > card.copyLimit - parsed.count) fail('CARD_COPY_LIMIT_EXCEEDED');
      if (currentCount > (this.availableById.get(card.id) ?? 0) - parsed.count) fail('CARD_QUANTITY_UNAVAILABLE');
      const total = deck.cardEntries.reduce((sum, entry) => sum + entry.count, 0);
      if (total > MAX_DECK_CARDS - parsed.count) fail('DECK_CARD_LIMIT_EXCEEDED');
      const nextEntries = [...deck.cardEntries];
      if (entryIndex === -1) nextEntries.push({ cardId: card.id, count: parsed.count });
      else nextEntries[entryIndex] = { cardId: card.id, count: currentCount + parsed.count };
      this.decks[deckIndex] = { ...deck, cardEntries: nextEntries };
      return cloneDeck(this.decks[deckIndex]);
    });
  }

  private parseCreateInput(input: string | DeckCreateInput, id?: string): { id?: unknown; name: unknown; cardEntries?: unknown } {
    if (typeof input === 'string') return { id, name: input };
    if (!isRecord(input)) fail('INVALID_DECK');
    assertOnlyKeys(input, CREATE_KEYS, 'INVALID_DECK');
    if (!hasOwn(input, 'name')) fail('INVALID_DECK');
    return { id: input.id, name: input.name, cardEntries: input.cardEntries };
  }

  private parseCopyInput(input?: string | DeckCopyInput): { id?: unknown; name?: unknown } {
    if (input === undefined) return {};
    if (typeof input === 'string') return { name: input };
    if (!isRecord(input)) fail('INVALID_DECK');
    assertOnlyKeys(input, COPY_KEYS, 'INVALID_DECK');
    return { id: input.id, name: input.name };
  }

  private parseMutationInput(
    input: DeckCardMutationInput | string,
    countOrCardId?: unknown,
    deckIdOrCount?: unknown,
  ): { deckId: string; cardId: string; count: unknown } {
    if (isRecord(input)) {
      assertOnlyKeys(input, MUTATION_KEYS, 'INVALID_CARD_ENTRY');
      if (typeof input.cardId !== 'string') fail('UNKNOWN_CARD');
      return {
        deckId: input.deckId === undefined ? this.currentDeckIdValue : this.requireDeckId(input.deckId),
        cardId: input.cardId,
        count: input.count === undefined ? 1 : input.count,
      };
    }
    if (typeof input !== 'string') fail('UNKNOWN_CARD');
    if (typeof countOrCardId === 'string') {
      return {
        deckId: this.requireDeckId(input),
        cardId: countOrCardId,
        count: deckIdOrCount === undefined ? 1 : deckIdOrCount,
      };
    }
    return {
      deckId: deckIdOrCount === undefined ? this.currentDeckIdValue : this.requireDeckId(deckIdOrCount),
      cardId: input,
      count: countOrCardId === undefined ? 1 : countOrCardId,
    };
  }

  private getCardMetadata(cardId: string): NormalizedCardMetadata {
    const card = this.metadataById.get(cardId);
    if (!card) fail('UNKNOWN_CARD');
    return card;
  }

  private requireDeckId(deckId: unknown): string {
    return normalizeDeckId(deckId);
  }

  private getDeckIndex(deckId: string): number {
    const normalized = this.requireDeckId(deckId);
    const index = this.decks.findIndex((deck) => deck.id === normalized);
    if (index === -1) fail('DECK_NOT_FOUND');
    return index;
  }

  private getDeckInternal(deckId: string): Deck {
    return this.decks[this.getDeckIndex(deckId)];
  }

  private assertUniqueName(name: string, exceptDeckId?: string): void {
    if (this.decks.some((deck) => deck.id !== exceptDeckId && deck.name === name)) fail('DUPLICATE_DECK_NAME');
  }

  private nextDeckId(): string {
    for (let index = 1; index < Number.MAX_SAFE_INTEGER; index += 1) {
      const candidate = `deck-${index}`;
      if (!this.decks.some((deck) => deck.id === candidate)) return candidate;
    }
    fail('DUPLICATE_DECK_ID');
  }

  private nextCopyName(sourceName: string): string {
    const suffix = ' 副本';
    const base = unicodeLength(sourceName) + unicodeLength(suffix) <= MAX_DECK_NAME_LENGTH
      ? `${sourceName}${suffix}`
      : `${truncateName(sourceName, MAX_DECK_NAME_LENGTH - unicodeLength(suffix))}${suffix}`;
    if (!this.decks.some((deck) => deck.name === base)) return base;
    for (let index = 2; index < Number.MAX_SAFE_INTEGER; index += 1) {
      const numberedSuffix = ` ${index}`;
      const candidate = `${truncateName(base, MAX_DECK_NAME_LENGTH - unicodeLength(numberedSuffix))}${numberedSuffix}`;
      if (!this.decks.some((deck) => deck.name === candidate)) return candidate;
    }
    fail('DUPLICATE_DECK_NAME');
  }

  private transact<T>(action: () => T): T {
    const before = this.save();
    let result: T;
    try {
      result = action();
    } catch (error) {
      this.applyState(normalizeState(before, this.metadataById, this.availableById));
      throw error;
    }
    const serialized = this.save();
    if (this.onSave) {
      try {
        this.onSave(serialized);
      } catch (error) {
        this.applyState(normalizeState(before, this.metadataById, this.availableById));
        throw new DeckManagementError('PERSISTENCE_FAILED', error);
      }
    }
    return result;
  }

  private applyState(state: DeckManagementState): void {
    this.decks = state.decks.map(cloneDeck);
    this.currentDeckIdValue = state.currentDeckId;
  }
}

export function createDeckManagement(options: DeckManagementOptions): DeckManagementService {
  return new DeckManagementService(options);
}

export function restoreDeckManagement(
  metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
  serialized: string,
  options: Omit<DeckManagementOptions, 'metadata' | 'state'> = {},
): DeckManagementService {
  return DeckManagementService.restore(metadata, serialized, options);
}
