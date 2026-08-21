import type {
  Deck,
  DeckManagementService,
  DeckManagementState,
} from '../../../../decks/deck-management.ts';
import type {
  HeroProfessionRules,
  HeroProfessionValidationResult,
} from '../../../../hero/hero-profession.ts';

export const DECK_PAGE_SCHEMA_VERSION = 1 as const;

export type DeckPageCardType = 'UNIT' | 'SKILL';

export interface DeckPageCardData {
  readonly id: string;
  readonly label: string;
  readonly cardType: DeckPageCardType;
  readonly profession: string;
  readonly copyLimit: number;
  readonly skillId: string | null;
}

export interface DeckPageData {
  readonly schemaVersion: typeof DECK_PAGE_SCHEMA_VERSION;
  readonly title: string;
  readonly subtitle: string;
  readonly professionId: string | null;
  readonly totalCards: number;
  readonly minUnitCards: number;
  readonly maxSkillCards: number;
  readonly cards: readonly DeckPageCardData[];
}

export type DeckComponentState = 'ready' | 'selected' | 'dragging' | 'dropTarget' | 'invalid' | 'empty';

export interface DeckHeaderComponent {
  readonly id: 'header';
  readonly kind: 'header';
  readonly state: 'ready' | 'invalid';
  readonly title: string;
  readonly subtitle: string;
  readonly currentDeckId: string | null;
  readonly deckCount: number;
  readonly cardCount: number;
  readonly totalCards: number;
  readonly unitCards: number;
  readonly skillCards: number;
  readonly valid: boolean | null;
}

export interface DeckSelectorComponent {
  readonly id: 'deck-selector';
  readonly kind: 'deckSelector';
  readonly state: 'ready';
  readonly currentDeckId: string;
  readonly decks: readonly { readonly id: string; readonly name: string; readonly selected: boolean }[];
}

export interface DeckPoolCardComponent {
  readonly id: string;
  readonly cardId: string;
  readonly label: string;
  readonly cardType: DeckPageCardType;
  readonly profession: string;
  readonly availableCount: number;
  readonly inDeckCount: number;
  readonly copyLimit: number;
  readonly selected: boolean;
  readonly permitted: boolean | null;
}

export interface DeckPoolComponent {
  readonly id: 'card-pool';
  readonly kind: 'cardPool';
  readonly state: 'ready' | 'empty';
  readonly cards: readonly DeckPoolCardComponent[];
}

export interface DeckEntryComponent extends DeckPageCardData {
  readonly id: `deck-card-${string}`;
  readonly kind: 'deckCard';
  readonly state: Exclude<DeckComponentState, 'empty'>;
  readonly count: number;
  readonly availableCount: number;
  readonly selected: boolean;
  readonly dragging: boolean;
  readonly dropTarget: boolean;
  readonly canAdd: boolean;
  readonly canRemove: boolean;
}

export interface DeckValidationComponent {
  readonly id: 'validation';
  readonly kind: 'validation';
  readonly state: 'ready' | 'invalid' | 'empty';
  readonly status: 'valid' | 'invalid' | 'unvalidated' | 'empty';
  readonly errors: readonly string[];
  readonly cardCount: number;
  readonly totalCards: number;
  readonly unitCards: number;
  readonly minUnitCards: number;
  readonly skillCards: number;
  readonly maxSkillCards: number;
}

export interface DeckEmptyComponent {
  readonly id: 'deck-empty';
  readonly kind: 'empty';
  readonly state: 'empty';
  readonly reason: 'noDeck' | 'emptyDeck' | 'noCards';
  readonly message: string;
}

export type DeckPageComponent =
  | DeckHeaderComponent
  | DeckSelectorComponent
  | DeckPoolComponent
  | DeckEntryComponent
  | DeckValidationComponent
  | DeckEmptyComponent;

export interface DeckPageValidation {
  readonly status: 'valid' | 'invalid' | 'unvalidated' | 'empty';
  readonly valid: boolean | null;
  readonly errors: readonly string[];
  readonly result: HeroProfessionValidationResult | null;
}

export interface DeckPageInteractionState {
  readonly selectedCardId: string | null;
  readonly draggingCardId: string | null;
  readonly dropTargetCardId: string | null;
}

export interface DeckPageSnapshot {
  readonly schemaVersion: typeof DECK_PAGE_SCHEMA_VERSION;
  readonly pageId: 'deck';
  readonly currentDeckId: string | null;
  readonly selectedCardId: string | null;
  readonly draggingCardId: string | null;
  readonly dropTargetCardId: string | null;
  readonly state: DeckManagementState | null;
  readonly validation: DeckPageValidation;
  readonly components: readonly DeckPageComponent[];
}

export type DeckInteraction =
  | { readonly type: 'selectCard'; readonly cardId: string | null }
  | { readonly type: 'beginDrag'; readonly cardId: string }
  | { readonly type: 'dragOver'; readonly cardId: string | null }
  | { readonly type: 'dropCard'; readonly cardId?: string }
  | { readonly type: 'cancelDrag' }
  | { readonly type: 'addCard'; readonly cardId: string; readonly count?: number }
  | { readonly type: 'removeCard'; readonly cardId: string; readonly count?: number }
  | { readonly type: 'switchDeck'; readonly deckId: string };

export type DeckInteractionReason =
  | 'selected'
  | 'same'
  | 'dragging'
  | 'dragOver'
  | 'dropped'
  | 'cancelled'
  | 'added'
  | 'removed'
  | 'switched'
  | 'empty';

export interface DeckInteractionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason: DeckInteractionReason;
  readonly cardId: string | null;
  readonly deckId: string | null;
}

export interface DeckPageServiceOptions {
  readonly data?: DeckPageData;
  readonly metadata?: readonly unknown[] | { readonly cards: readonly unknown[] };
  readonly cards?: readonly unknown[];
  readonly decks?: readonly unknown[] | { readonly decks: readonly unknown[] };
  readonly professions?: readonly unknown[] | { readonly professions: readonly unknown[] };
  readonly authority?: {
    readonly cards: readonly unknown[];
    readonly decks: readonly unknown[];
    readonly professions: readonly unknown[];
  };
  readonly professionId?: string | null;
  readonly availableCards?: unknown;
  readonly availableCardCounts?: unknown;
  readonly cardInventory?: unknown;
  readonly manager?: DeckManagementService;
  readonly deckService?: DeckManagementService;
  readonly deck?: DeckManagementService;
  readonly rules?: HeroProfessionRules;
  readonly initialState?: unknown;
  readonly onSave?: (serialized: string) => void;
  readonly persist?: (serialized: string) => void;
}

export interface DeckPageDataFactoryOptions {
  readonly metadata?: readonly unknown[] | { readonly cards: readonly unknown[] };
  readonly cards?: readonly unknown[];
  readonly decks?: readonly unknown[] | { readonly decks: readonly unknown[] };
  readonly professionId?: string | null;
  readonly title?: string;
  readonly subtitle?: string;
}
