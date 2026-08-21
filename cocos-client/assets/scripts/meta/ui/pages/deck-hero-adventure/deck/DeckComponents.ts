import {
  MAX_DECK_CARDS,
  type Deck,
  type DeckManagementState,
} from '../../../../decks/deck-management.ts';
import {
  type DeckEntryComponent,
  type DeckEmptyComponent,
  type DeckHeaderComponent,
  type DeckPageCardData,
  type DeckPageComponent,
  type DeckPageData,
  type DeckPageInteractionState,
  type DeckPageValidation,
  type DeckPoolCardComponent,
  type DeckPoolComponent,
  type DeckSelectorComponent,
  type DeckValidationComponent,
} from './DeckContracts.ts';

export interface DeckPageComponentProjection {
  readonly availableById?: ReadonlyMap<string, number>;
  readonly permittedById?: ReadonlyMap<string, boolean>;
  readonly validation?: DeckPageValidation;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function emptyComponent(reason: DeckEmptyComponent['reason']): DeckEmptyComponent {
  const message = reason === 'noCards'
    ? '当前没有可用卡牌。'
    : reason === 'noDeck'
      ? '当前没有可编辑的编队。'
      : '当前编队为空，请从卡牌列表选择卡牌加入。';
  return Object.freeze({ id: 'deck-empty', kind: 'empty', state: 'empty', reason, message });
}

function cloneCard(card: DeckPageCardData): DeckPageCardData {
  return { ...card };
}

function counts(deck: Deck, cardById: ReadonlyMap<string, DeckPageCardData> = new Map()): { total: number; units: number; skills: number } {
  return deck.cardEntries.reduce((result, entry) => {
    result.total += entry.count;
    const card = cardById.get(entry.cardId);
    if (card?.cardType === 'UNIT') result.units += entry.count;
    if (card?.cardType === 'SKILL') result.skills += entry.count;
    return result;
  }, { total: 0, units: 0, skills: 0 });
}

function validationForEmpty(data: DeckPageData): DeckPageValidation {
  return { status: 'empty', valid: null, errors: [], result: null };
}

function defaultValidation(data: DeckPageData, deck: Deck): DeckPageValidation {
  const cardById = new Map(data.cards.map((card) => [card.id, card]));
  const computed = counts(deck, cardById);
  const errors: string[] = [];
  if (computed.total !== data.totalCards) errors.push('DECK_TOTAL_CARD_COUNT');
  if (computed.units < data.minUnitCards) errors.push('DECK_UNIT_CARD_MINIMUM');
  if (computed.skills > data.maxSkillCards) errors.push('DECK_SKILL_CARD_MAXIMUM');
  for (const entry of deck.cardEntries) {
    const card = cardById.get(entry.cardId);
    if (!card) errors.push('DECK_CARD_UNKNOWN');
    else if (entry.count > card.copyLimit) errors.push('DECK_CARD_COPY_LIMIT');
  }
  return {
    status: errors.length === 0 ? 'valid' : 'invalid',
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    result: null,
  };
}

function cardPermitted(
  card: DeckPageCardData,
  validation: DeckPageValidation,
  permittedById?: ReadonlyMap<string, boolean>,
): boolean | null {
  if (permittedById?.has(card.id)) return permittedById.get(card.id)!;
  if (validation.status === 'unvalidated' || validation.status === 'empty') return null;
  if (card.cardType === 'UNIT' && validation.errors.includes('DECK_CARD_PROFESSION_FORBIDDEN')) return false;
  if (card.cardType === 'SKILL' && validation.errors.includes('DECK_SKILL_PROFESSION_FORBIDDEN')) return false;
  return true;
}

function selectorComponent(state: DeckManagementState): DeckSelectorComponent {
  return Object.freeze({
    id: 'deck-selector',
    kind: 'deckSelector',
    state: 'ready',
    currentDeckId: state.currentDeckId,
    decks: Object.freeze(state.decks.map((deck) => Object.freeze({
      id: deck.id,
      name: deck.name,
      selected: deck.id === state.currentDeckId,
    }))),
  });
}

function poolComponent(
  data: DeckPageData,
  deck: Deck,
  interaction: DeckPageInteractionState,
  projection: DeckPageComponentProjection,
  validation: DeckPageValidation,
): DeckPoolComponent {
  const inDeck = new Map(deck.cardEntries.map((entry) => [entry.cardId, entry.count]));
  const cards: DeckPoolCardComponent[] = data.cards.map((card) => Object.freeze({
    id: `pool-card-${card.id}`,
    cardId: card.id,
    label: card.label,
    cardType: card.cardType,
    profession: card.profession,
    availableCount: projection.availableById?.get(card.id) ?? card.copyLimit,
    inDeckCount: inDeck.get(card.id) ?? 0,
    copyLimit: card.copyLimit,
    selected: interaction.selectedCardId === card.id,
    permitted: cardPermitted(card, validation, projection.permittedById),
  }));
  return Object.freeze({
    id: 'card-pool',
    kind: 'cardPool',
    state: cards.length === 0 ? 'empty' : 'ready',
    cards: Object.freeze(cards),
  });
}

function entryComponent(
  card: DeckPageCardData,
  count: number,
  availableCount: number,
  totalCount: number,
  totalCapacity: number,
  interaction: DeckPageInteractionState,
): DeckEntryComponent {
  const selected = interaction.selectedCardId === card.id;
  const dragging = interaction.draggingCardId === card.id;
  const dropTarget = interaction.dropTargetCardId === card.id;
  return Object.freeze({
    ...cloneCard(card),
    id: `deck-card-${card.id}` as `deck-card-${string}`,
    kind: 'deckCard',
    state: dropTarget ? 'dropTarget' : dragging ? 'dragging' : selected ? 'selected' : 'ready',
    count,
    availableCount,
    selected,
    dragging,
    dropTarget,
    canAdd: count < card.copyLimit && count < availableCount && totalCount < totalCapacity,
    canRemove: count > 0,
  });
}

function validationComponent(
  data: DeckPageData,
  deck: Deck | null,
  validation: DeckPageValidation,
): DeckValidationComponent {
  const computed = deck === null ? { total: 0, units: 0, skills: 0 } : counts(deck, new Map(data.cards.map((card) => [card.id, card])));
  return Object.freeze({
    id: 'validation',
    kind: 'validation',
    state: validation.status === 'empty' ? 'empty' : validation.status === 'invalid' ? 'invalid' : 'ready',
    status: validation.status,
    errors: Object.freeze([...validation.errors]),
    cardCount: computed.total,
    totalCards: data.totalCards,
    unitCards: computed.units,
    minUnitCards: data.minUnitCards,
    skillCards: computed.skills,
    maxSkillCards: data.maxSkillCards,
  });
}

export function createDeckPageComponents(
  data: DeckPageData,
  state: DeckManagementState | null = null,
  interaction: DeckPageInteractionState = {
    selectedCardId: null,
    draggingCardId: null,
    dropTargetCardId: null,
  },
  projection: DeckPageComponentProjection = {},
): readonly DeckPageComponent[] {
  if (data.cards.length === 0) return Object.freeze([emptyComponent('noCards')]);
  if (state === null || state.decks.length === 0) return Object.freeze([emptyComponent('noDeck')]);

  const deck = state.decks.find((candidate) => candidate.id === state.currentDeckId);
  if (!deck) return Object.freeze([emptyComponent('noDeck')]);
  const validation = projection.validation ?? defaultValidation(data, deck);
  const cardById = new Map(data.cards.map((card) => [card.id, card]));
  const computed = counts(deck, cardById);
  const totalCapacity = Math.min(data.totalCards, MAX_DECK_CARDS);
  const header: DeckHeaderComponent = Object.freeze({
    id: 'header',
    kind: 'header',
    state: validation.status === 'invalid' ? 'invalid' : 'ready',
    title: data.title,
    subtitle: data.subtitle,
    currentDeckId: state.currentDeckId,
    deckCount: state.decks.length,
    cardCount: computed.total,
    totalCards: data.totalCards,
    unitCards: computed.units,
    skillCards: computed.skills,
    valid: validation.valid,
  });
  const entries = deck.cardEntries.map((entry) => {
    const card = cardById.get(entry.cardId);
    if (!card) return null;
    return entryComponent(
      card,
      entry.count,
      projection.availableById?.get(card.id) ?? card.copyLimit,
      computed.total,
      totalCapacity,
      interaction,
    );
  }).filter((entry): entry is DeckEntryComponent => entry !== null);
  const components: DeckPageComponent[] = [
    header,
    selectorComponent(state),
    validationComponent(data, deck, validation),
    poolComponent(data, deck, interaction, projection, validation),
  ];
  if (entries.length === 0) components.push(emptyComponent('emptyDeck'));
  else components.push(...entries);
  return deepFreeze(Object.freeze(components));
}

export { deepFreeze };
