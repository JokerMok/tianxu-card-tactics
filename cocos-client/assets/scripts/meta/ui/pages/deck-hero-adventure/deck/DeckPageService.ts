import {
  DeckManagementError,
  DeckManagementService,
  type Deck,
  type DeckManagementState,
} from '../../../../decks/deck-management.ts';
import {
  createHeroProfessionRules,
  type HeroProfessionRules,
  type HeroProfessionValidationResult,
} from '../../../../hero/hero-profession.ts';
import { createDeckPageComponents, deepFreeze } from './DeckComponents.ts';
import {
  DECK_PAGE_SCHEMA_VERSION,
  type DeckInteraction,
  type DeckInteractionReason,
  type DeckInteractionResult,
  type DeckPageCardData,
  type DeckPageData,
  type DeckPageDataFactoryOptions,
  type DeckPageInteractionState,
  type DeckPageServiceOptions,
  type DeckPageSnapshot,
  type DeckPageValidation,
} from './DeckContracts.ts';

export type DeckPageErrorCode =
  | 'INVALID_ARGUMENT'
  | 'MISSING_FIELD'
  | 'INVALID_DATA'
  | 'INVALID_STATE'
  | 'STATE_NOT_AVAILABLE'
  | 'STATE_DATA_MISMATCH'
  | 'CARD_NOT_FOUND'
  | 'DECK_NOT_FOUND'
  | 'PROFESSION_REQUIRED'
  | 'CARD_PROFESSION_FORBIDDEN'
  | 'SKILL_PROFESSION_FORBIDDEN'
  | 'NO_ACTIVE_DRAG'
  | 'INVALID_DROP_TARGET';

const PAGE_STATE_KEYS = new Set([
  'schemaVersion', 'pageId', 'deckState', 'selectedCardId', 'draggingCardId', 'dropTargetCardId',
]);

export class DeckPageError extends Error {
  readonly code: DeckPageErrorCode;
  readonly reason: DeckPageErrorCode;

  constructor(code: DeckPageErrorCode, message: string) {
    super(message);
    this.name = 'DeckPageError';
    this.code = code;
    this.reason = code;
  }

  toJSON(): { name: string; code: DeckPageErrorCode; reason: DeckPageErrorCode; message: string } {
    return { name: this.name, code: this.code, reason: this.reason, message: this.message };
  }
}

function fail(code: DeckPageErrorCode, message: string): never {
  throw new DeckPageError(code, message);
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
  if (!isPlainRecord(value)) fail('INVALID_ARGUMENT', `${label} must be a plain object`);
}

function assertKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    const missing = allowed.find((key) => !actual.includes(key));
    fail(missing ? 'MISSING_FIELD' : 'INVALID_DATA', `${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) fail('INVALID_DATA', `${label} contains unsupported field: ${unknown}`);
}

function safeInteger(value: unknown, label: string, positive = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
    fail('INVALID_DATA', `${label} must be ${positive ? 'a positive' : 'a non-negative'} safe integer`);
  }
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail('INVALID_DATA', `${label} must be a non-empty string`);
}

function rows(input: unknown, key: string): readonly unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && Array.isArray(input[key])) return input[key] as readonly unknown[];
  return [];
}

function cloneCard(card: DeckPageCardData): DeckPageCardData {
  return { ...card };
}

function cloneData(data: DeckPageData): DeckPageData {
  return {
    schemaVersion: data.schemaVersion,
    title: data.title,
    subtitle: data.subtitle,
    professionId: data.professionId,
    totalCards: data.totalCards,
    minUnitCards: data.minUnitCards,
    maxSkillCards: data.maxSkillCards,
    cards: data.cards.map(cloneCard),
  };
}

function normalizeCard(raw: unknown, index: number): DeckPageCardData {
  assertRecord(raw, `deck cards[${index}]`);
  nonEmptyString(raw.id, `deck cards[${index}].id`);
  if (raw.enabled === false) fail('INVALID_DATA', `deck cards[${index}] must not be disabled in page data`);
  if (raw.cardType !== 'UNIT' && raw.cardType !== 'SKILL') fail('INVALID_DATA', `deck cards[${index}].cardType is invalid`);
  nonEmptyString(raw.profession, `deck cards[${index}].profession`);
  safeInteger(raw.copyLimit, `deck cards[${index}].copyLimit`, true);
  const label = raw.label ?? raw.nameKey ?? raw.id;
  nonEmptyString(label, `deck cards[${index}].label`);
  if (raw.skillId !== undefined && raw.skillId !== null) nonEmptyString(raw.skillId, `deck cards[${index}].skillId`);
  return {
    id: raw.id,
    label,
    cardType: raw.cardType,
    profession: raw.profession,
    copyLimit: raw.copyLimit,
    skillId: raw.skillId ?? null,
  };
}

function normalizeCards(input: readonly unknown[] | { readonly cards: readonly unknown[] }): DeckPageCardData[] {
  const result: DeckPageCardData[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rows(input, 'cards').entries()) {
    if (!isRecord(raw) || raw.enabled === false) continue;
    const card = normalizeCard(raw, index);
    if (seen.has(card.id)) fail('INVALID_DATA', `duplicate deck card: ${card.id}`);
    seen.add(card.id);
    result.push(card);
  }
  return result;
}

function normalizeData(input: DeckPageData): DeckPageData {
  assertRecord(input, 'deck page data');
  assertKeys(input, [
    'schemaVersion', 'title', 'subtitle', 'professionId', 'totalCards', 'minUnitCards', 'maxSkillCards', 'cards',
  ], 'deck page data');
  if (input.schemaVersion !== DECK_PAGE_SCHEMA_VERSION) fail('INVALID_DATA', 'unsupported deck page schema version');
  nonEmptyString(input.title, 'deck page title');
  nonEmptyString(input.subtitle, 'deck page subtitle');
  if (input.professionId !== null) nonEmptyString(input.professionId, 'deck page professionId');
  safeInteger(input.totalCards, 'deck page totalCards', true);
  safeInteger(input.minUnitCards, 'deck page minUnitCards');
  safeInteger(input.maxSkillCards, 'deck page maxSkillCards');
  if (input.minUnitCards > input.totalCards || input.maxSkillCards > input.totalCards
    || input.minUnitCards + input.maxSkillCards < input.totalCards) {
    fail('INVALID_DATA', 'deck page limits are inconsistent');
  }
  if (!Array.isArray(input.cards)) fail('INVALID_ARGUMENT', 'deck page cards must be an array');
  const cards = normalizeCards(input.cards);
  return {
    schemaVersion: DECK_PAGE_SCHEMA_VERSION,
    title: input.title,
    subtitle: input.subtitle,
    professionId: input.professionId,
    totalCards: input.totalCards,
    minUnitCards: input.minUnitCards,
    maxSkillCards: input.maxSkillCards,
    cards,
  };
}

function deckLimits(input: unknown): { totalCards: number; minUnitCards: number; maxSkillCards: number } {
  const configured = rows(input, 'decks').find((raw) => isRecord(raw) && raw.id === 'D001');
  if (!configured || !isRecord(configured)) return { totalCards: 30, minUnitCards: 24, maxSkillCards: 6 };
  safeInteger(configured.totalCards, 'decks.D001.totalCards', true);
  safeInteger(configured.minUnitCards, 'decks.D001.minUnitCards');
  safeInteger(configured.maxSkillCards, 'decks.D001.maxSkillCards');
  return {
    totalCards: configured.totalCards,
    minUnitCards: configured.minUnitCards,
    maxSkillCards: configured.maxSkillCards,
  };
}

export function createDeckPageData(options: DeckPageDataFactoryOptions = {}): DeckPageData {
  const rawCards = options.metadata ?? options.cards ?? [];
  const cards = normalizeCards(Array.isArray(rawCards) ? rawCards : rawCards);
  const limits = deckLimits(options.decks);
  const configuredDeck = rows(options.decks, 'decks').find((raw) => isRecord(raw) && raw.id === 'D001');
  const professionId = options.professionId
    ?? (isRecord(configuredDeck) && typeof configuredDeck.profession === 'string' ? configuredDeck.profession : null);
  return normalizeData({
    schemaVersion: DECK_PAGE_SCHEMA_VERSION,
    title: options.title ?? '编队',
    subtitle: options.subtitle ?? '配置出战卡组',
    professionId,
    ...limits,
    cards,
  });
}

export function createDefaultDeckPageData(options: DeckPageDataFactoryOptions = {}): DeckPageData {
  return createDeckPageData(options);
}

export function createEmptyDeckPageData(): DeckPageData {
  return {
    schemaVersion: DECK_PAGE_SCHEMA_VERSION,
    title: '编队',
    subtitle: '暂无可用卡牌',
    professionId: null,
    totalCards: 30,
    minUnitCards: 24,
    maxSkillCards: 6,
    cards: [],
  };
}

function cardRowsForManager(data: DeckPageData): readonly unknown[] {
  return data.cards.map((card) => ({
    id: card.id,
    cardType: card.cardType,
    profession: card.profession,
    copyLimit: card.copyLimit,
    ...(card.skillId === null ? {} : { skillId: card.skillId }),
  }));
}

function cloneState(state: DeckManagementState): DeckManagementState {
  return {
    schemaVersion: state.schemaVersion,
    currentDeckId: state.currentDeckId,
    decks: state.decks.map((deck) => ({
      id: deck.id,
      name: deck.name,
      cardEntries: deck.cardEntries.map((entry) => ({ ...entry })),
    })),
  };
}

function cloneValidation(validation: DeckPageValidation): DeckPageValidation {
  return {
    status: validation.status,
    valid: validation.valid,
    errors: [...validation.errors],
    result: validation.result === null ? null : {
      valid: validation.result.valid,
      errors: [...validation.result.errors],
    },
  };
}

function interactionResult(
  accepted: boolean,
  changed: boolean,
  reason: DeckInteractionReason,
  cardId: string | null,
  deckId: string | null,
): DeckInteractionResult {
  return Object.freeze({ accepted, changed, reason, cardId, deckId });
}

function parseSavedPage(value: unknown): {
  deckState: unknown;
  selectedCardId: string | null;
  draggingCardId: string | null;
  dropTargetCardId: string | null;
} {
  if (typeof value !== 'string') fail('INVALID_STATE', 'deck page save must be a string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    fail('INVALID_STATE', 'deck page save is not valid JSON');
  }
  assertRecord(parsed, 'deck page save');
  assertKeys(parsed, [...PAGE_STATE_KEYS], 'deck page save');
  if (parsed.schemaVersion !== DECK_PAGE_SCHEMA_VERSION || parsed.pageId !== 'deck') fail('INVALID_STATE', 'deck page save schema is invalid');
  for (const key of ['selectedCardId', 'draggingCardId', 'dropTargetCardId']) {
    const candidate = parsed[key];
    if (candidate !== null && typeof candidate !== 'string') fail('INVALID_STATE', `deck page save ${key} is invalid`);
  }
  if (!isRecord(parsed.deckState)) fail('INVALID_STATE', 'deck page save deckState is invalid');
  return {
    deckState: parsed.deckState,
    selectedCardId: parsed.selectedCardId as string | null,
    draggingCardId: parsed.draggingCardId as string | null,
    dropTargetCardId: parsed.dropTargetCardId as string | null,
  };
}

export class DeckPageService {
  private readonly data: DeckPageData;
  private readonly metadata: readonly unknown[];
  private readonly availableInput: unknown;
  private readonly professionId: string | null;
  private readonly rules: HeroProfessionRules | null;
  private readonly onSave?: (serialized: string) => void;
  private manager: DeckManagementService | null;
  private selectedCardIdValue: string | null = null;
  private draggingCardIdValue: string | null = null;
  private dropTargetCardIdValue: string | null = null;

  constructor(input: DeckPageData | DeckPageServiceOptions = {}) {
    const options: DeckPageServiceOptions = isPageData(input) ? { data: input } : input;
    this.data = normalizeData(options.data ?? createDeckPageData({
      metadata: options.metadata ?? options.cards ?? [],
      decks: options.decks,
      professionId: options.professionId,
    }));
    this.professionId = options.professionId === undefined ? this.data.professionId : options.professionId;
    this.metadata = cardRowsForManager(this.data);
    this.availableInput = options.availableCards ?? options.availableCardCounts ?? options.cardInventory;
    this.rules = options.rules ?? buildRules(this.data, options);
    this.onSave = options.onSave ?? options.persist;
    const supplied = options.manager ?? options.deckService ?? options.deck;
    if (this.data.cards.length === 0) {
      if (supplied !== undefined || options.initialState !== undefined) fail('STATE_DATA_MISMATCH', 'empty deck page cannot have a deck state');
      this.manager = null;
      return;
    }
    this.manager = supplied ?? new DeckManagementService({
      metadata: this.metadata,
      availableCards: this.availableInput,
      state: options.initialState,
      onSave: this.onSave,
    });
    this.assertDataCoversState(this.manager.snapshot());
  }

  static restore(
    data: DeckPageData,
    serialized: string,
    options: Omit<DeckPageServiceOptions, 'data' | 'initialState'> = {},
  ): DeckPageService {
    const page = new DeckPageService({ ...options, data, initialState: parseSavedPage(serialized).deckState });
    page.restore(serialized);
    return page;
  }

  get pageData(): DeckPageData {
    return cloneData(this.data);
  }

  get deckService(): DeckManagementService | null {
    return this.manager;
  }

  snapshot(): DeckPageSnapshot {
    const state = this.manager?.snapshot() ?? null;
    const validation = this.validation(state);
    const interaction: DeckPageInteractionState = {
      selectedCardId: this.selectedCardIdValue,
      draggingCardId: this.draggingCardIdValue,
      dropTargetCardId: this.dropTargetCardIdValue,
    };
    return deepFreeze({
      schemaVersion: DECK_PAGE_SCHEMA_VERSION,
      pageId: 'deck',
      currentDeckId: state?.currentDeckId ?? null,
      selectedCardId: this.selectedCardIdValue,
      draggingCardId: this.draggingCardIdValue,
      dropTargetCardId: this.dropTargetCardIdValue,
      state: state === null ? null : cloneState(state),
      validation: cloneValidation(validation),
      components: createDeckPageComponents(this.data, state, interaction, {
        availableById: state === null ? undefined : this.availableByIdForManager(),
        permittedById: this.permittedById(state),
        validation,
      }),
    }) as DeckPageSnapshot;
  }

  interact(action: DeckInteraction): DeckInteractionResult {
    if (!isRecord(action) || typeof action.type !== 'string') fail('INVALID_ARGUMENT', 'deck interaction must contain a type');
    switch (action.type) {
      case 'selectCard': return this.selectCard(action.cardId);
      case 'beginDrag': return this.beginDrag(action.cardId);
      case 'dragOver': return this.dragOver(action.cardId);
      case 'dropCard': return this.dropCard(action.cardId);
      case 'cancelDrag': return this.cancelDrag();
      case 'addCard': return this.addCard(action.cardId, action.count);
      case 'removeCard': return this.removeCard(action.cardId, action.count);
      case 'switchDeck': return this.switchDeck(action.deckId);
      default: fail('INVALID_ARGUMENT', `unknown deck interaction: ${action.type}`);
    }
  }

  selectCard(cardId: string | null): DeckInteractionResult {
    if (this.manager === null) return interactionResult(false, false, 'empty', null, null);
    if (cardId !== null) this.assertCard(cardId);
    const changed = this.selectedCardIdValue !== cardId;
    this.selectedCardIdValue = cardId;
    return interactionResult(true, changed, changed ? 'selected' : 'same', cardId, this.manager.currentDeckId);
  }

  beginDrag(cardId: string): DeckInteractionResult {
    if (this.manager === null) return interactionResult(false, false, 'empty', null, null);
    this.assertCard(cardId);
    const changed = this.draggingCardIdValue !== cardId || this.dropTargetCardIdValue !== null;
    this.selectedCardIdValue = cardId;
    this.draggingCardIdValue = cardId;
    this.dropTargetCardIdValue = null;
    return interactionResult(true, changed, changed ? 'dragging' : 'same', cardId, this.manager.currentDeckId);
  }

  dragOver(cardId: string | null): DeckInteractionResult {
    if (this.manager === null) return interactionResult(false, false, 'empty', null, null);
    if (this.draggingCardIdValue === null) fail('NO_ACTIVE_DRAG', 'cannot drag over without an active drag');
    if (cardId !== null) this.assertCard(cardId);
    const changed = this.dropTargetCardIdValue !== cardId;
    this.dropTargetCardIdValue = cardId;
    return interactionResult(true, changed, changed ? 'dragOver' : 'same', cardId, this.manager.currentDeckId);
  }

  dropCard(targetCardId?: string): DeckInteractionResult {
    if (this.manager === null) return interactionResult(false, false, 'empty', null, null);
    const sourceCardId = this.draggingCardIdValue;
    if (sourceCardId === null) fail('NO_ACTIVE_DRAG', 'cannot drop without an active drag');
    const target = targetCardId ?? this.dropTargetCardIdValue;
    if (target !== undefined && target !== null) this.assertCard(target);
    if (this.isInCurrentDeck(sourceCardId) && target !== null && target !== undefined && target !== sourceCardId) {
      fail('INVALID_DROP_TARGET', 'existing deck cards can only be dropped on themselves');
    }
    const sourceInDeck = this.isInCurrentDeck(sourceCardId);
    const before = this.snapshot().state?.decks.find((deck) => deck.id === this.manager!.currentDeckId)?.cardEntries;
    if (!sourceInDeck) this.addCard(sourceCardId, 1);
    this.draggingCardIdValue = null;
    this.dropTargetCardIdValue = null;
    return interactionResult(true, !sourceInDeck || before !== undefined, 'dropped', sourceCardId, this.manager.currentDeckId);
  }

  addCard(cardId: string, count = 1): DeckInteractionResult {
    if (this.manager === null) return interactionResult(false, false, 'empty', null, null);
    this.assertCard(cardId);
    this.assertProfessionAllowed(cardId, count);
    this.manager.addCardToDeck(this.manager.currentDeckId, cardId, count);
    return interactionResult(true, true, 'added', cardId, this.manager.currentDeckId);
  }

  removeCard(cardId: string, count = 1): DeckInteractionResult {
    if (this.manager === null) return interactionResult(false, false, 'empty', null, null);
    this.assertCard(cardId);
    this.manager.removeCardFromDeck(this.manager.currentDeckId, cardId, count);
    return interactionResult(true, true, 'removed', cardId, this.manager.currentDeckId);
  }

  switchDeck(deckId: string): DeckInteractionResult {
    if (this.manager === null) return interactionResult(false, false, 'empty', null, null);
    if (this.manager.currentDeckId === deckId) return interactionResult(true, false, 'same', null, deckId);
    try {
      this.manager.switchDeck(deckId);
    } catch (error) {
      if (error instanceof DeckManagementError && error.code === 'DECK_NOT_FOUND') fail('DECK_NOT_FOUND', 'deck does not exist');
      throw error;
    }
    this.selectedCardIdValue = null;
    this.draggingCardIdValue = null;
    this.dropTargetCardIdValue = null;
    return interactionResult(true, true, 'switched', null, deckId);
  }

  cancelDrag(): DeckInteractionResult {
    if (this.manager === null) return interactionResult(false, false, 'empty', null, null);
    const changed = this.draggingCardIdValue !== null || this.dropTargetCardIdValue !== null;
    const cardId = this.draggingCardIdValue;
    this.draggingCardIdValue = null;
    this.dropTargetCardIdValue = null;
    return interactionResult(true, changed, changed ? 'cancelled' : 'same', cardId, this.manager.currentDeckId);
  }

  serialize(): string {
    if (this.manager === null) fail('STATE_NOT_AVAILABLE', 'deck state is not available for an empty page');
    return JSON.stringify({
      schemaVersion: DECK_PAGE_SCHEMA_VERSION,
      pageId: 'deck',
      deckState: JSON.parse(this.manager.save()),
      selectedCardId: this.selectedCardIdValue,
      draggingCardId: this.draggingCardIdValue,
      dropTargetCardId: this.dropTargetCardIdValue,
    });
  }

  save(): string {
    return this.serialize();
  }

  restore(serialized: string): DeckPageSnapshot {
    if (this.manager === null) fail('STATE_NOT_AVAILABLE', 'deck state is not available for an empty page');
    const saved = parseSavedPage(serialized);
    const restored = DeckManagementService.restore(this.metadata, JSON.stringify(saved.deckState), {
      availableCards: this.availableByIdForManager(),
      onSave: this.onSave,
    });
    this.assertDataCoversState(restored.snapshot());
    this.manager = restored;
    this.selectedCardIdValue = this.optionalCard(saved.selectedCardId);
    this.draggingCardIdValue = this.optionalCard(saved.draggingCardId);
    this.dropTargetCardIdValue = this.optionalCard(saved.dropTargetCardId);
    if (this.draggingCardIdValue === null) this.dropTargetCardIdValue = null;
    return this.snapshot();
  }

  private validation(state: DeckManagementState | null): DeckPageValidation {
    if (state === null) return { status: 'empty', valid: null, errors: [], result: null };
    const deck = state.decks.find((candidate) => candidate.id === state.currentDeckId);
    if (!deck) return { status: 'empty', valid: null, errors: [], result: null };
    if (this.rules === null || this.professionId === null) return { status: 'unvalidated', valid: null, errors: [], result: null };
    const result = this.rules.validateDeck({ professionId: this.professionId, cardEntries: deck.cardEntries });
    return {
      status: result.valid ? 'valid' : 'invalid',
      valid: result.valid,
      errors: [...result.errors],
      result,
    };
  }

  private permittedById(state: DeckManagementState | null): ReadonlyMap<string, boolean> | undefined {
    if (state === null || this.rules === null || this.professionId === null) return undefined;
    const deck = state.decks.find((candidate) => candidate.id === state.currentDeckId);
    if (!deck) return undefined;
    const permitted = new Map<string, boolean>();
    for (const card of this.data.cards) {
      const currentCount = deck.cardEntries.find((entry) => entry.cardId === card.id)?.count ?? 0;
      const entries = deck.cardEntries
        .filter((entry) => entry.cardId !== card.id)
        .map((entry) => ({ ...entry }));
      entries.push({ cardId: card.id, count: currentCount + 1 });
      const result = this.rules.validateDeck({ professionId: this.professionId, cardEntries: entries });
      permitted.set(card.id, !result.errors.includes('DECK_CARD_PROFESSION_FORBIDDEN')
        && !result.errors.includes('DECK_SKILL_PROFESSION_FORBIDDEN'));
    }
    return permitted;
  }

  private assertDataCoversState(state: DeckManagementState): void {
    const cardIds = new Set(this.data.cards.map((card) => card.id));
    for (const deck of state.decks) {
      for (const entry of deck.cardEntries) {
        if (!cardIds.has(entry.cardId)) fail('STATE_DATA_MISMATCH', `deck card is not in page data: ${entry.cardId}`);
      }
    }
  }

  private assertCard(cardId: string): void {
    if (typeof cardId !== 'string' || !this.data.cards.some((card) => card.id === cardId)) fail('CARD_NOT_FOUND', `card does not exist: ${String(cardId)}`);
  }

  private optionalCard(cardId: string | null): string | null {
    if (cardId === null) return null;
    this.assertCard(cardId);
    return cardId;
  }

  private isInCurrentDeck(cardId: string): boolean {
    return this.manager?.getCurrentDeck().cardEntries.some((entry) => entry.cardId === cardId) ?? false;
  }

  private availableByIdForManager(): ReadonlyMap<string, number> {
    if (this.manager === null) return new Map();
    return new Map(this.data.cards.map((card) => [card.id, this.manager!.getAvailableCardCount(card.id)]));
  }

  private assertProfessionAllowed(cardId: string, count: number): void {
    if (this.rules === null || this.professionId === null) return;
    const current = this.manager!.getCurrentDeck();
    const currentCount = current.cardEntries.find((entry) => entry.cardId === cardId)?.count ?? 0;
    const entries = current.cardEntries
      .filter((entry) => entry.cardId !== cardId)
      .map((entry) => ({ ...entry }));
    entries.push({ cardId, count: currentCount + count });
    const result = this.rules.validateDeck({ professionId: this.professionId, cardEntries: entries });
    if (result.errors.includes('DECK_CARD_PROFESSION_FORBIDDEN')) fail('CARD_PROFESSION_FORBIDDEN', `card is forbidden for profession: ${cardId}`);
    if (result.errors.includes('DECK_SKILL_PROFESSION_FORBIDDEN')) fail('SKILL_PROFESSION_FORBIDDEN', `skill is forbidden for profession: ${cardId}`);
  }
}

function isPageData(input: DeckPageData | DeckPageServiceOptions): input is DeckPageData {
  return isRecord(input) && 'schemaVersion' in input && !('data' in input);
}

function buildRules(data: DeckPageData, options: DeckPageServiceOptions): HeroProfessionRules | null {
  const authority = options.authority;
  const professionRows = rows(options.professions, 'professions');
  const deckRows = rows(options.decks, 'decks');
  if (authority !== undefined) return createHeroProfessionRules(authority);
  if (professionRows.length === 0 || deckRows.length === 0) return null;
  return createHeroProfessionRules({
    cards: options.metadata ? rows(options.metadata, 'cards') : cardRowsForManager(data),
    decks: deckRows,
    professions: professionRows,
  });
}

export function createDeckPageService(input: DeckPageData | DeckPageServiceOptions = {}): DeckPageService {
  return new DeckPageService(input);
}

export function restoreDeckPageService(
  data: DeckPageData,
  serialized: string,
  options: Omit<DeckPageServiceOptions, 'data' | 'initialState'> = {},
): DeckPageService {
  const saved = parseSavedPage(serialized);
  const page = new DeckPageService({ ...options, data, initialState: saved.deckState });
  page.restore(serialized);
  return page;
}
