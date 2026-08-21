import {
  CARD_INVENTORY_SOURCES,
  CARD_QUALITIES,
  CardInventoryService,
  type CardInventoryFilter,
  type CardInventorySort,
  type CardMetadata,
  type CardQuality,
} from '../../../../cards/card-inventory.ts';
import { loadCardQualityCatalog, type CardQualityCatalog } from '../../../../cards/quality/index.ts';
import {
  CARDS_PAGE_SCHEMA_VERSION,
  CARDS_DEFAULT_SUBTITLE,
  CARDS_DEFAULT_TITLE,
  createEmptyCardsPageData,
  type CardsInteraction,
  type CardsInteractionReason,
  type CardsInteractionResult,
  type CardsPageCardData,
  type CardsPageData,
  type CardsPageServiceOptions,
  type CardsPageSnapshot,
  type CardsPageState,
} from './CardsContracts.ts';
import { createCardsPageComponents, projectVisibleCards } from './CardsComponents.ts';

export type CardsPageErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_ARGUMENT'
  | 'INVALID_DATA'
  | 'INVALID_ID'
  | 'INVALID_NUMBER'
  | 'INVALID_QUALITY'
  | 'DUPLICATE_ID'
  | 'CARD_NOT_FOUND'
  | 'CARD_NOT_VISIBLE'
  | 'NO_SELECTION'
  | 'STATE_NOT_AVAILABLE'
  | 'INVALID_SAVE'
  | 'SAVE_VERSION'
  | 'PERSISTENCE_FAILED';

export class CardsPageError extends Error {
  readonly code: CardsPageErrorCode;

  constructor(code: CardsPageErrorCode, message: string, cause?: unknown) {
    super(message);
    if (cause !== undefined) this.cause = cause;
    this.name = 'CardsPageError';
    this.code = code;
  }
}

function reject(code: CardsPageErrorCode, message: string): never {
  throw new CardsPageError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) reject('INVALID_ARGUMENT', `${label} must be a plain object`);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    const missing = allowed.find((key) => !actual.includes(key));
    reject(missing ? 'MISSING_FIELD' : 'INVALID_DATA', `${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) reject('INVALID_DATA', `${label} must be a non-empty string`);
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) reject('INVALID_NUMBER', `${label} must be a safe integer`);
}

function cloneAndFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((child) => cloneAndFreeze(child))) as T;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) copy[key] = cloneAndFreeze(child);
  return Object.freeze(copy) as T;
}

function cloneCard(card: CardsPageCardData): CardsPageCardData {
  return {
    ...card,
    qualities: card.qualities.map((quality) => ({ ...quality, abilities: { ...quality.abilities }, sources: [...quality.sources] })),
  };
}

function cloneData(data: CardsPageData): CardsPageData {
  return { ...data, cards: data.cards.map(cloneCard) };
}

function validateQuality(raw: unknown, label: string): CardQuality {
  if (!CARD_QUALITIES.includes(raw as CardQuality)) reject('INVALID_QUALITY', `${label} must be one of the configured qualities`);
  return raw as CardQuality;
}

function validateData(input: CardsPageData): CardsPageData {
  assertRecord(input, 'cards page data');
  assertExactKeys(input, ['schemaVersion', 'title', 'subtitle', 'cards'], 'cards page data');
  if (input.schemaVersion !== CARDS_PAGE_SCHEMA_VERSION) reject('INVALID_DATA', 'unsupported cards page schema version');
  assertNonEmptyString(input.title, 'cards page title');
  assertNonEmptyString(input.subtitle, 'cards page subtitle');
  if (!Array.isArray(input.cards)) reject('INVALID_ARGUMENT', 'cards page cards must be an array');
  const ids = new Set<string>();
  input.cards.forEach((card, index) => {
    assertRecord(card, `cards page cards[${index}]`);
    assertExactKeys(card, ['id', 'nameKey', 'descriptionKey', 'cardType', 'race', 'profession', 'rarity', 'copyLimit', 'prepare', 'qualities'], `cards page cards[${index}]`);
    assertNonEmptyString(card.id, `cards page cards[${index}].id`);
    if (ids.has(card.id)) reject('DUPLICATE_ID', `duplicate card: ${card.id}`);
    ids.add(card.id);
    assertNonEmptyString(card.nameKey, `cards page cards[${index}].nameKey`);
    assertNonEmptyString(card.descriptionKey, `cards page cards[${index}].descriptionKey`);
    if (card.cardType !== 'UNIT' && card.cardType !== 'SKILL') reject('INVALID_DATA', `invalid card type: ${String(card.cardType)}`);
    assertNonEmptyString(card.race, `cards page cards[${index}].race`);
    assertNonEmptyString(card.profession, `cards page cards[${index}].profession`);
    validateQuality(card.rarity, `cards page cards[${index}].rarity`);
    assertSafeInteger(card.copyLimit, `cards page cards[${index}].copyLimit`);
    assertSafeInteger(card.prepare, `cards page cards[${index}].prepare`);
    if (card.copyLimit <= 0 || card.prepare < 0) reject('INVALID_DATA', `invalid card limits: ${card.id}`);
    if (!Array.isArray(card.qualities) || card.qualities.length !== CARD_QUALITIES.length) reject('INVALID_DATA', `${card.id} must have six quality definitions`);
    const qualities = new Set<number>();
    card.qualities.forEach((definition, qualityIndex) => {
      assertRecord(definition, `${card.id}.qualities[${qualityIndex}]`);
      assertExactKeys(definition, ['cardId', 'quality', 'abilities', 'sources', 'copyLimit'], `${card.id}.qualities[${qualityIndex}]`);
      if (definition.cardId !== card.id) reject('INVALID_DATA', `quality card mismatch: ${card.id}`);
      const quality = validateQuality(definition.quality, `${card.id}.qualities[${qualityIndex}].quality`);
      if (qualities.has(quality)) reject('DUPLICATE_ID', `duplicate quality: ${card.id}:${quality}`);
      qualities.add(quality);
      assertRecord(definition.abilities, `${card.id}.qualities[${qualityIndex}].abilities`);
      if (Object.keys(definition.abilities).length === 0) reject('INVALID_DATA', `${card.id}:${quality} abilities cannot be empty`);
      Object.values(definition.abilities).forEach((value) => {
        if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) reject('INVALID_NUMBER', `${card.id}:${quality} ability must be non-negative`);
      });
      if (!Array.isArray(definition.sources) || definition.sources.length === 0 || definition.sources.some((source) => !CARD_INVENTORY_SOURCES.includes(source as never))) {
        reject('INVALID_DATA', `${card.id}:${quality} sources are invalid`);
      }
      assertSafeInteger(definition.copyLimit, `${card.id}:${quality}.copyLimit`);
      if (definition.copyLimit <= 0 || definition.copyLimit > card.copyLimit) reject('INVALID_DATA', `${card.id}:${quality} copy limit is invalid`);
    });
  });
  return cloneData(input);
}

function metadataRows(input: readonly unknown[] | { readonly cards: readonly unknown[] }): readonly unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && Array.isArray(input.cards)) return input.cards;
  reject('INVALID_ARGUMENT', 'card metadata must be an array or a cards table');
}

function createPageData(
  metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
  catalog: CardQualityCatalog,
): CardsPageData {
  const cards: CardsPageCardData[] = [];
  for (const [index, raw] of metadataRows(metadata).entries()) {
    assertRecord(raw, `card metadata row ${index}`);
    if (raw.enabled === false) continue;
    for (const key of ['id', 'nameKey', 'descriptionKey', 'cardType', 'race', 'profession', 'rarity', 'copyLimit', 'prepare']) {
      if (!Object.prototype.hasOwnProperty.call(raw, key)) reject('MISSING_FIELD', `card metadata row ${index} is missing ${key}`);
    }
    assertNonEmptyString(raw.id, `card metadata row ${index}.id`);
    assertNonEmptyString(raw.nameKey, `${raw.id}.nameKey`);
    assertNonEmptyString(raw.descriptionKey, `${raw.id}.descriptionKey`);
    if (raw.cardType !== 'UNIT' && raw.cardType !== 'SKILL') reject('INVALID_DATA', `${raw.id}.cardType is invalid`);
    assertNonEmptyString(raw.race, `${raw.id}.race`);
    assertNonEmptyString(raw.profession, `${raw.id}.profession`);
    const rarity = validateQuality(raw.rarity, `${raw.id}.rarity`);
    assertSafeInteger(raw.copyLimit, `${raw.id}.copyLimit`);
    assertSafeInteger(raw.prepare, `${raw.id}.prepare`);
    cards.push({
      id: raw.id,
      nameKey: raw.nameKey,
      descriptionKey: raw.descriptionKey,
      cardType: raw.cardType,
      race: raw.race,
      profession: raw.profession,
      rarity,
      copyLimit: raw.copyLimit,
      prepare: raw.prepare,
      qualities: catalog.qualities(raw.id),
    });
  }
  return validateData({
    schemaVersion: CARDS_PAGE_SCHEMA_VERSION,
    title: CARDS_DEFAULT_TITLE,
    subtitle: CARDS_DEFAULT_SUBTITLE,
    cards,
  });
}

function metadataFor(data: CardsPageData): { cards: readonly CardMetadata[] } {
  return {
    cards: data.cards.map((card) => ({
      id: card.id,
      cardType: card.cardType,
      rarity: card.rarity,
      copyLimit: card.copyLimit,
      race: card.race,
      profession: card.profession,
      prepare: card.prepare,
    })),
  };
}

function interactionResult(accepted: boolean, changed: boolean, reason: CardsInteractionReason, selectedCardId: string | null): CardsInteractionResult {
  return Object.freeze({ accepted, changed, reason, selectedCardId });
}

interface ParsedSave {
  readonly selectedCardId: string | null;
  readonly selectedQuality: CardQuality | null;
  readonly inventory: string;
}

function parseSave(serialized: unknown): ParsedSave {
  if (typeof serialized !== 'string' || serialized.length === 0) reject('INVALID_SAVE', 'cards page save must be a non-empty string');
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { reject('INVALID_SAVE', 'cards page save is not valid JSON'); }
  assertRecord(parsed, 'cards page save');
  assertExactKeys(parsed, ['schemaVersion', 'selectedCardId', 'selectedQuality', 'inventory'], 'cards page save');
  if (parsed.schemaVersion !== CARDS_PAGE_SCHEMA_VERSION) reject('SAVE_VERSION', 'unsupported cards page save version');
  if (parsed.selectedCardId !== null && typeof parsed.selectedCardId !== 'string') reject('INVALID_ID', 'saved selected card must be a string or null');
  const selectedQuality = parsed.selectedQuality === null ? null : validateQuality(parsed.selectedQuality, 'saved selected quality');
  if (typeof parsed.inventory !== 'string') reject('INVALID_SAVE', 'saved inventory must be serialized JSON');
  return { selectedCardId: parsed.selectedCardId as string | null, selectedQuality, inventory: parsed.inventory };
}

export class CardsPageService {
  private readonly data: CardsPageData;
  private inventory: CardInventoryService | null;
  private selectedCardId: string | null;
  private selectedQuality: CardQuality | null;
  private readonly persist?: (serialized: string) => void;

  constructor(input: CardsPageData | CardsPageServiceOptions = {}) {
    const options: CardsPageServiceOptions = isRecord(input) && Object.prototype.hasOwnProperty.call(input, 'schemaVersion')
      ? { data: input as CardsPageData }
      : input as CardsPageServiceOptions;
    assertRecord(options, 'cards page options');
    const allowed = ['data', 'metadata', 'qualityCatalog', 'inventory', 'initialState', 'onSave', 'persist'];
    if (Object.keys(options).some((key) => !allowed.includes(key))) reject('INVALID_ARGUMENT', 'cards page options contain an unknown field');
    if (options.onSave !== undefined && options.persist !== undefined) reject('INVALID_ARGUMENT', 'onSave and persist cannot both be provided');
    if (options.onSave !== undefined && typeof options.onSave !== 'function') reject('INVALID_ARGUMENT', 'onSave must be a function');
    if (options.persist !== undefined && typeof options.persist !== 'function') reject('INVALID_ARGUMENT', 'persist must be a function');
    this.persist = options.persist ?? options.onSave;
    if (options.data !== undefined && (options.metadata !== undefined || options.qualityCatalog !== undefined)) {
      reject('INVALID_ARGUMENT', 'cards page data cannot be combined with metadata or qualityCatalog');
    }
    if (options.data === undefined && options.metadata === undefined) {
      reject('INVALID_ARGUMENT', 'cards page service requires data or real card metadata');
    }
    if (options.qualityCatalog !== undefined && !(options.qualityCatalog instanceof CardQualityCatalog)) {
      reject('INVALID_ARGUMENT', 'qualityCatalog must be a CardQualityCatalog');
    }
    this.data = options.data === undefined
      ? createPageData(options.metadata as readonly unknown[] | { readonly cards: readonly unknown[] }, options.qualityCatalog === undefined
        ? loadCardQualityCatalog(options.metadata as readonly unknown[] | { readonly cards: readonly unknown[] })
        : options.qualityCatalog as CardQualityCatalog)
      : validateData(options.data);
    if (this.data.cards.length === 0) {
      if (options.inventory !== undefined || options.initialState !== undefined || this.persist !== undefined) reject('STATE_NOT_AVAILABLE', 'an empty cards page has no inventory-backed state');
      this.inventory = null;
      this.selectedCardId = null;
      this.selectedQuality = null;
      return;
    }
    const save = options.initialState === undefined ? null : parseSave(options.initialState);
    if (save?.selectedCardId !== null && save?.selectedCardId !== undefined && !this.data.cards.some((card) => card.id === save.selectedCardId)) {
      reject('CARD_NOT_FOUND', `saved selected card is not present in page data: ${save.selectedCardId}`);
    }
    if (options.inventory !== undefined && save !== null) reject('INVALID_ARGUMENT', 'inventory cannot be combined with initialState');
    if (options.inventory !== undefined && !(options.inventory instanceof CardInventoryService)) reject('INVALID_ARGUMENT', 'inventory must be a CardInventoryService');
    this.inventory = options.inventory instanceof CardInventoryService
      ? CardInventoryService.restore(metadataFor(this.data), options.inventory.save())
      : new CardInventoryService({ metadata: metadataFor(this.data), state: save?.inventory });
    this.assertInventoryMatchesData();
    this.selectedCardId = save?.selectedCardId ?? this.firstVisibleCardId();
    this.selectedQuality = save?.selectedQuality ?? this.defaultQuality(this.selectedCardId);
    this.normalizeSelection();
  }

  get pageData(): CardsPageData { return cloneData(this.data); }
  get inventoryService(): CardInventoryService | null { return this.inventory; }

  snapshot(): CardsPageSnapshot {
    if (!this.inventory) {
      return cloneAndFreeze({
        schemaVersion: CARDS_PAGE_SCHEMA_VERSION,
        pageId: 'cards',
        selectedCardId: null,
        selectedQuality: null,
        state: null,
        components: createCardsPageComponents(this.data, { visibleCards: [], entries: [], filter: {}, sort: { field: 'cardId', direction: 'asc' }, selectedCardId: null, selectedQuality: null }),
      }) as CardsPageSnapshot;
    }
    const inventory = this.inventory.snapshot();
    const visibleCards = projectVisibleCards(this.data, inventory.entries, inventory.filter, inventory.sort);
    return cloneAndFreeze({
      schemaVersion: CARDS_PAGE_SCHEMA_VERSION,
      pageId: 'cards',
      selectedCardId: this.selectedCardId,
      selectedQuality: this.selectedQuality,
      state: {
        schemaVersion: CARDS_PAGE_SCHEMA_VERSION,
        selectedCardId: this.selectedCardId,
        selectedQuality: this.selectedQuality,
        inventory: this.inventory.save(),
      },
      components: createCardsPageComponents(this.data, {
        visibleCards,
        entries: inventory.entries,
        filter: inventory.filter,
        sort: inventory.sort,
        selectedCardId: this.selectedCardId,
        selectedQuality: this.selectedQuality,
      }),
    }) as CardsPageSnapshot;
  }

  interact(action: CardsInteraction): CardsInteractionResult {
    if (!isRecord(action) || typeof action.type !== 'string') reject('INVALID_ARGUMENT', 'cards interaction must contain a type');
    switch (action.type) {
      case 'selectCard': return this.selectCard(action.cardId);
      case 'selectQuality': return this.selectQuality(action.quality);
      case 'setFilter': return this.setFilter(action.filter);
      case 'clearFilter': return this.clearFilter();
      case 'setSort': return this.setSort(action.sort);
      default: reject('INVALID_ARGUMENT', `unknown cards interaction: ${action.type}`);
    }
  }

  selectCard(cardId: string): CardsInteractionResult {
    if (!this.inventory) return interactionResult(false, false, 'empty', null);
    this.assertCard(cardId);
    if (!this.visibleCardIds().includes(cardId)) reject('CARD_NOT_VISIBLE', `card is not visible under the current filter: ${cardId}`);
    if (this.selectedCardId === cardId) return interactionResult(true, false, 'same', cardId);
    return this.mutate(() => {
      this.selectedCardId = cardId;
      this.selectedQuality = this.defaultQuality(cardId);
      return interactionResult(true, true, 'selected', cardId);
    });
  }

  selectQuality(quality: unknown): CardsInteractionResult {
    if (!this.selectedCardId) return interactionResult(false, false, 'empty', null);
    const nextQuality = validateQuality(quality, 'cards selected quality');
    if (this.selectedQuality === nextQuality) return interactionResult(true, false, 'same', this.selectedCardId);
    return this.mutate(() => {
      this.selectedQuality = nextQuality;
      return interactionResult(true, true, 'selected', this.selectedCardId);
    });
  }

  setFilter(filter: unknown): CardsInteractionResult {
    if (!this.inventory) return interactionResult(false, false, 'empty', null);
    const before = this.inventory.save();
    return this.mutate(() => {
      this.inventory!.setFilter(filter);
      this.normalizeSelection();
      const changed = before !== this.inventory!.save();
      return interactionResult(true, changed, changed ? 'filtered' : 'same', this.selectedCardId);
    });
  }

  clearFilter(): CardsInteractionResult { return this.setFilter({}); }

  setSort(sort: unknown): CardsInteractionResult {
    if (!this.inventory) return interactionResult(false, false, 'empty', null);
    const before = this.inventory.save();
    return this.mutate(() => {
      this.inventory!.setSort(sort);
      const changed = before !== this.inventory!.save();
      return interactionResult(true, changed, changed ? 'filtered' : 'same', this.selectedCardId);
    });
  }

  serialize(): string {
    if (!this.inventory) reject('STATE_NOT_AVAILABLE', 'empty cards page has no state to serialize');
    return JSON.stringify({
      schemaVersion: CARDS_PAGE_SCHEMA_VERSION,
      selectedCardId: this.selectedCardId,
      selectedQuality: this.selectedQuality,
      inventory: this.inventory.save(),
    });
  }

  save(): string {
    const serialized = this.serialize();
    this.persistSafely(serialized);
    return serialized;
  }

  restore(serialized: string): CardsPageSnapshot {
    if (!this.inventory) reject('STATE_NOT_AVAILABLE', 'empty cards page has no state to restore');
    const parsed = parseSave(serialized);
    if (parsed.selectedCardId !== null) this.assertCard(parsed.selectedCardId);
    const restoredInventory = CardInventoryService.restore(metadataFor(this.data), parsed.inventory);
    const before = this.serialize();
    const beforeSelected = this.selectedCardId;
    const beforeQuality = this.selectedQuality;
    try {
      this.inventory = restoredInventory;
      this.selectedCardId = parsed.selectedCardId;
      this.selectedQuality = parsed.selectedQuality;
      this.normalizeSelection();
      const next = this.serialize();
      if (next !== before) this.persistSafely(next);
      return this.snapshot();
    } catch (error) {
      this.inventory = CardInventoryService.restore(metadataFor(this.data), JSON.parse(before).inventory);
      this.selectedCardId = beforeSelected;
      this.selectedQuality = beforeQuality;
      throw error;
    }
  }

  private mutate<T>(action: () => T): T {
    if (!this.inventory) return action();
    const before = this.serialize();
    try {
      const result = action();
      const next = this.serialize();
      if (next !== before) this.persistSafely(next);
      return result;
    } catch (error) {
      const saved = parseSave(before);
      this.inventory = CardInventoryService.restore(metadataFor(this.data), saved.inventory);
      this.selectedCardId = saved.selectedCardId;
      this.selectedQuality = saved.selectedQuality;
      if (error instanceof CardsPageError) throw error;
      throw error;
    }
  }

  private persistSafely(serialized: string): void {
    if (!this.persist) return;
    try { this.persist(serialized); } catch (error) { throw new CardsPageError('PERSISTENCE_FAILED', 'cards page state persistence failed', error); }
  }

  private assertCard(cardId: unknown): asserts cardId is string {
    if (typeof cardId !== 'string' || cardId.trim().length === 0) reject('INVALID_ID', 'card id must be a non-empty string');
    if (!this.data.cards.some((card) => card.id === cardId)) reject('CARD_NOT_FOUND', `unknown cards page card: ${cardId}`);
  }

  private assertInventoryMatchesData(): void {
    if (!this.inventory) return;
    const pageIds = new Set(this.data.cards.map((card) => card.id));
    for (const card of this.data.cards) {
      try { this.inventory.getMetadata(card.id); } catch { reject('INVALID_DATA', `inventory metadata does not contain ${card.id}`); }
    }
    if (this.inventory.snapshot().entries.some((entry) => !pageIds.has(entry.cardId))) {
      reject('INVALID_DATA', 'inventory contains a card outside page data');
    }
  }

  private visibleCardIds(): readonly string[] {
    if (!this.inventory) return [];
    const state = this.inventory.snapshot();
    return projectVisibleCards(this.data, state.entries, state.filter, state.sort).map((card) => card.id);
  }

  private firstVisibleCardId(): string | null { return this.visibleCardIds()[0] ?? null; }

  private defaultQuality(cardId: string | null): CardQuality | null {
    if (!cardId) return null;
    return this.data.cards.find((card) => card.id === cardId)?.rarity ?? null;
  }

  private normalizeSelection(): void {
    const visible = this.visibleCardIds();
    if (visible.length === 0) {
      this.selectedCardId = null;
      this.selectedQuality = null;
      return;
    }
    if (!this.selectedCardId || !visible.includes(this.selectedCardId)) this.selectedCardId = visible[0]!;
    if (this.selectedQuality === null || !CARD_QUALITIES.includes(this.selectedQuality)) this.selectedQuality = this.defaultQuality(this.selectedCardId);
  }
}

export function createCardsPageService(input: CardsPageData | CardsPageServiceOptions = {}): CardsPageService {
  return new CardsPageService(input);
}

export function createCardsPageData(
  metadata: readonly unknown[] | { readonly cards: readonly unknown[] },
  qualityCatalog?: CardQualityCatalog,
): CardsPageData {
  return createPageData(metadata, qualityCatalog ?? loadCardQualityCatalog(metadata));
}

export { createEmptyCardsPageData };
