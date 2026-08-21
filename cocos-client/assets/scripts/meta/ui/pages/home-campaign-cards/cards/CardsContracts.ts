import {
  CARD_QUALITIES,
  CARD_INVENTORY_SOURCES,
  type CardInventoryFilter,
  type CardInventorySort,
  type CardType,
} from '../../../../cards/card-inventory.ts';
import type { CardQualityDefinition } from '../../../../cards/quality/CardQuality.ts';

export const CARDS_PAGE_SCHEMA_VERSION = 1 as const;

export interface CardsPageCardData {
  readonly id: string;
  readonly nameKey: string;
  readonly descriptionKey: string;
  readonly cardType: CardType;
  readonly race: string;
  readonly profession: string;
  readonly rarity: (typeof CARD_QUALITIES)[number];
  readonly copyLimit: number;
  readonly prepare: number;
  readonly qualities: readonly CardQualityDefinition[];
}

export interface CardsPageData {
  readonly schemaVersion: typeof CARDS_PAGE_SCHEMA_VERSION;
  readonly title: string;
  readonly subtitle: string;
  readonly cards: readonly CardsPageCardData[];
}

export type CardsComponentState = 'ready' | 'selected' | 'empty';

export interface CardsHeaderComponent {
  readonly id: 'header';
  readonly kind: 'header';
  readonly state: 'ready';
  readonly title: string;
  readonly subtitle: string;
  readonly totalCards: number;
  readonly visibleCards: number;
  readonly ownedCards: number;
  readonly selectedCardId: string | null;
}

export interface CardsFilterComponent {
  readonly id: 'filters';
  readonly kind: 'filters';
  readonly state: 'ready';
  readonly filter: CardInventoryFilter;
  readonly sort: CardInventorySort;
  readonly qualities: readonly (typeof CARD_QUALITIES)[number][];
  readonly sources: readonly string[];
  readonly cardTypes: readonly CardType[];
  readonly races: readonly string[];
  readonly professions: readonly string[];
}

export interface CardsCardComponent extends Omit<CardsPageCardData, 'id' | 'qualities'> {
  readonly id: `card-${string}`;
  readonly kind: 'card';
  readonly state: 'ready' | 'selected';
  readonly cardId: string;
  readonly selected: boolean;
  readonly ownedQuantity: number;
  readonly locked: boolean;
  readonly ownedQualities: readonly (typeof CARD_QUALITIES)[number][];
}

export interface CardsDetailComponent extends Omit<CardsPageCardData, 'id'> {
  readonly id: 'detail';
  readonly kind: 'detail';
  readonly state: 'ready';
  readonly cardId: string;
  readonly selected: true;
  readonly ownedQuantity: number;
  readonly locked: boolean;
  readonly selectedQuality: (typeof CARD_QUALITIES)[number];
  readonly selectedQualityDefinition: CardQualityDefinition;
}

export interface CardsEmptyComponent {
  readonly id: 'cards-empty';
  readonly kind: 'empty';
  readonly state: 'empty';
  readonly message: string;
}

export type CardsPageComponent =
  | CardsHeaderComponent
  | CardsFilterComponent
  | CardsCardComponent
  | CardsDetailComponent
  | CardsEmptyComponent;

export interface CardsPageState {
  readonly schemaVersion: typeof CARDS_PAGE_SCHEMA_VERSION;
  readonly selectedCardId: string | null;
  readonly selectedQuality: (typeof CARD_QUALITIES)[number] | null;
  readonly inventory: string;
}

export interface CardsPageSnapshot {
  readonly schemaVersion: typeof CARDS_PAGE_SCHEMA_VERSION;
  readonly pageId: 'cards';
  readonly selectedCardId: string | null;
  readonly selectedQuality: (typeof CARD_QUALITIES)[number] | null;
  readonly state: CardsPageState | null;
  readonly components: readonly CardsPageComponent[];
}

export type CardsInteraction =
  | { readonly type: 'selectCard'; readonly cardId: string }
  | { readonly type: 'selectQuality'; readonly quality: unknown }
  | { readonly type: 'setFilter'; readonly filter: unknown }
  | { readonly type: 'clearFilter' }
  | { readonly type: 'setSort'; readonly sort: unknown };

export type CardsInteractionReason = 'selected' | 'same' | 'filtered' | 'empty';

export interface CardsInteractionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason: CardsInteractionReason;
  readonly selectedCardId: string | null;
}

export interface CardsPageServiceOptions {
  readonly data?: CardsPageData;
  readonly metadata?: readonly unknown[] | { readonly cards: readonly unknown[] };
  readonly qualityCatalog?: unknown;
  readonly inventory?: unknown;
  readonly initialState?: unknown;
  readonly onSave?: (serialized: string) => void;
  readonly persist?: (serialized: string) => void;
}

export const CARDS_DEFAULT_TITLE = '卡库';
export const CARDS_DEFAULT_SUBTITLE = '查看卡牌品质、能力与收集进度';
export const CARDS_EMPTY_MESSAGE = '当前没有符合条件的卡牌。';

export function createEmptyCardsPageData(): CardsPageData {
  return {
    schemaVersion: CARDS_PAGE_SCHEMA_VERSION,
    title: CARDS_DEFAULT_TITLE,
    subtitle: '暂无已配置卡牌',
    cards: [],
  };
}

export const CARDS_FILTER_OPTIONS = Object.freeze({
  qualities: Object.freeze([...CARD_QUALITIES]),
  sources: CARD_INVENTORY_SOURCES,
  cardTypes: Object.freeze(['UNIT', 'SKILL'] as const),
});
