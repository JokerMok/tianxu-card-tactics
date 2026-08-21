import {
  CARDS_EMPTY_MESSAGE,
  CARDS_FILTER_OPTIONS,
  type CardsCardComponent,
  type CardsDetailComponent,
  type CardsEmptyComponent,
  type CardsFilterComponent,
  type CardsHeaderComponent,
  type CardsPageCardData,
  type CardsPageComponent,
  type CardsPageData,
} from './CardsContracts.ts';
import type { CardInventoryEntry, CardInventoryFilter, CardInventorySort } from '../../../../cards/card-inventory.ts';
import { CARD_QUALITIES } from '../../../../cards/card-inventory.ts';

export interface CardsComponentProjection {
  readonly visibleCards: readonly CardsPageCardData[];
  readonly entries: readonly CardInventoryEntry[];
  readonly filter: CardInventoryFilter;
  readonly sort: CardInventorySort;
  readonly selectedCardId: string | null;
  readonly selectedQuality: (typeof CARD_QUALITIES)[number] | null;
}

function entriesFor(entries: readonly CardInventoryEntry[], cardId: string): readonly CardInventoryEntry[] {
  return entries.filter((entry) => entry.cardId === cardId);
}

function cardMatches(card: CardsPageCardData, entries: readonly CardInventoryEntry[], filter: CardInventoryFilter): boolean {
  if (filter.cardIds !== undefined && !filter.cardIds.includes(card.id)) return false;
  if (filter.cardTypes !== undefined && !filter.cardTypes.includes(card.cardType)) return false;
  if (filter.races !== undefined && !filter.races.includes(card.race)) return false;
  if (filter.professions !== undefined && !filter.professions.includes(card.profession)) return false;
  const owned = entriesFor(entries, card.id);
  const entryFilter = filter.qualities !== undefined || filter.sources !== undefined || filter.locked !== undefined
    || filter.minQuantity !== undefined || filter.maxQuantity !== undefined;
  if (!entryFilter) return true;
  return owned.some((entry) => {
    if (filter.qualities !== undefined && !filter.qualities.includes(entry.quality)) return false;
    if (filter.sources !== undefined && !filter.sources.includes(entry.source)) return false;
    if (filter.locked !== undefined && entry.locked !== filter.locked) return false;
    if (filter.minQuantity !== undefined && entry.quantity < filter.minQuantity) return false;
    if (filter.maxQuantity !== undefined && entry.quantity > filter.maxQuantity) return false;
    return true;
  });
}

function aggregate(entries: readonly CardInventoryEntry[], cardId: string): {
  readonly quantity: number;
  readonly locked: boolean;
  readonly qualities: readonly (typeof CARD_QUALITIES)[number][];
} {
  const owned = entriesFor(entries, cardId);
  return {
    quantity: owned.reduce((total, entry) => total + entry.quantity, 0),
    locked: owned.some((entry) => entry.locked),
    qualities: [...new Set(owned.map((entry) => entry.quality))].sort((left, right) => left - right),
  };
}

function sortValue(card: CardsPageCardData, entries: readonly CardInventoryEntry[], field: CardInventorySort['field']): string | number | boolean {
  const summary = aggregate(entries, card.id);
  switch (field) {
    case 'cardId': return card.id;
    case 'quantity': return summary.quantity;
    case 'quality': return card.rarity;
    case 'locked': return summary.locked;
    case 'source': return entriesFor(entries, card.id)[0]?.source ?? '';
    case 'cardType': return card.cardType;
    case 'race': return card.race;
    case 'profession': return card.profession;
    case 'prepare': return card.prepare;
  }
}

function sortedCards(
  cards: readonly CardsPageCardData[],
  entries: readonly CardInventoryEntry[],
  sort: CardInventorySort,
): readonly CardsPageCardData[] {
  return cards
    .map((card, index) => ({ card, index }))
    .sort((left, right) => {
      const leftValue = sortValue(left.card, entries, sort.field);
      const rightValue = sortValue(right.card, entries, sort.field);
      const comparison = leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
      if (comparison !== 0) return sort.direction === 'asc' ? comparison : -comparison;
      return left.index - right.index;
    })
    .map(({ card }) => card);
}

export function projectVisibleCards(
  data: CardsPageData,
  entries: readonly CardInventoryEntry[],
  filter: CardInventoryFilter,
  sort: CardInventorySort,
): readonly CardsPageCardData[] {
  return sortedCards(data.cards.filter((card) => cardMatches(card, entries, filter)), entries, sort);
}

function headerComponent(data: CardsPageData, projection: CardsComponentProjection): CardsHeaderComponent {
  const ownedCards = projection.entries.reduce((ids, entry) => ids.add(entry.cardId), new Set()).size;
  return Object.freeze({
    id: 'header',
    kind: 'header',
    state: 'ready',
    title: data.title,
    subtitle: data.subtitle,
    totalCards: data.cards.length,
    visibleCards: projection.visibleCards.length,
    ownedCards,
    selectedCardId: projection.selectedCardId,
  });
}

function filtersComponent(projection: CardsComponentProjection, data: CardsPageData): CardsFilterComponent {
  return Object.freeze({
    id: 'filters',
    kind: 'filters',
    state: 'ready',
    filter: projection.filter,
    sort: projection.sort,
    qualities: CARDS_FILTER_OPTIONS.qualities,
    sources: CARDS_FILTER_OPTIONS.sources,
    cardTypes: CARDS_FILTER_OPTIONS.cardTypes,
    races: Object.freeze([...new Set(data.cards.map((card) => card.race))].sort()),
    professions: Object.freeze([...new Set(data.cards.map((card) => card.profession))].sort()),
  });
}

function cardComponent(card: CardsPageCardData, projection: CardsComponentProjection): CardsCardComponent {
  const summary = aggregate(projection.entries, card.id);
  const selected = projection.selectedCardId === card.id;
  return Object.freeze({
    id: `card-${card.id}` as `card-${string}`,
    kind: 'card',
    state: selected ? 'selected' : 'ready',
    cardId: card.id,
    selected,
    nameKey: card.nameKey,
    descriptionKey: card.descriptionKey,
    cardType: card.cardType,
    race: card.race,
    profession: card.profession,
    rarity: card.rarity,
    copyLimit: card.copyLimit,
    prepare: card.prepare,
    ownedQuantity: summary.quantity,
    locked: summary.locked,
    ownedQualities: Object.freeze([...summary.qualities]),
  });
}

function detailComponent(card: CardsPageCardData, projection: CardsComponentProjection): CardsDetailComponent {
  const summary = aggregate(projection.entries, card.id);
  const quality = projection.selectedQuality ?? card.rarity;
  return Object.freeze({
    id: 'detail',
    kind: 'detail',
    state: 'ready',
    cardId: card.id,
    selected: true,
    nameKey: card.nameKey,
    descriptionKey: card.descriptionKey,
    cardType: card.cardType,
    race: card.race,
    profession: card.profession,
    rarity: card.rarity,
    copyLimit: card.copyLimit,
    prepare: card.prepare,
    qualities: card.qualities,
    ownedQuantity: summary.quantity,
    locked: summary.locked,
    selectedQuality: quality,
    selectedQualityDefinition: card.qualities.find((definition) => definition.quality === quality)!,
  });
}

export function createCardsPageComponents(
  data: CardsPageData,
  projection: CardsComponentProjection,
): readonly CardsPageComponent[] {
  const components: CardsPageComponent[] = [headerComponent(data, projection), filtersComponent(projection, data)];
  components.push(...projection.visibleCards.map((card) => cardComponent(card, projection)));
  const selected = projection.visibleCards.find((card) => card.id === projection.selectedCardId);
  if (selected) components.push(detailComponent(selected, projection));
  if (projection.visibleCards.length === 0) {
    components.push(Object.freeze({ id: 'cards-empty', kind: 'empty', state: 'empty', message: CARDS_EMPTY_MESSAGE }) as CardsEmptyComponent);
  }
  return Object.freeze(components);
}
