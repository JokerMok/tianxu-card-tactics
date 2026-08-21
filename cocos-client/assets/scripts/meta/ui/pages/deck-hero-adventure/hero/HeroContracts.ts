export const HERO_PAGE_SCHEMA_VERSION = 1 as const;

export interface HeroEquipmentData {
  readonly slot: string;
  readonly name: string;
  readonly level: number;
}

export interface HeroPageHeroData {
  readonly id: string;
  readonly name: string;
  readonly level: number;
  readonly xp: number;
  readonly power: number;
  readonly professionId: string | null;
  readonly equipment: readonly HeroEquipmentData[];
}

export interface HeroPageProfessionData {
  readonly id: string;
  readonly nameKey: string;
  readonly name: string;
  readonly skillIds: readonly string[];
}

export type HeroPageCardType = 'UNIT' | 'SKILL';

export interface HeroPageCardData {
  readonly id: string;
  readonly label: string;
  readonly cardType: HeroPageCardType;
  readonly profession: string;
  readonly copyLimit: number;
  readonly skillId: string | null;
}

export interface HeroPageCardEntry {
  readonly cardId: string;
  readonly count: number;
}

export interface HeroPageDeckData {
  readonly id: string;
  readonly name: string;
  readonly professionId: string;
  readonly cardEntries: readonly HeroPageCardEntry[];
  readonly totalCards: number;
  readonly minUnitCards: number;
  readonly maxSkillCards: number;
}

export interface HeroPageData {
  readonly schemaVersion: typeof HERO_PAGE_SCHEMA_VERSION;
  readonly title: string;
  readonly subtitle: string;
  readonly hero: HeroPageHeroData | null;
  readonly professions: readonly HeroPageProfessionData[];
  readonly cards: readonly HeroPageCardData[];
  readonly decks: readonly HeroPageDeckData[];
}

export type HeroComponentState = 'ready' | 'selected' | 'invalid' | 'empty';

export interface HeroHeaderComponent {
  readonly id: 'header';
  readonly kind: 'header';
  readonly state: 'ready' | 'invalid';
  readonly title: string;
  readonly subtitle: string;
  readonly heroId: string | null;
  readonly professionCount: number;
  readonly selectedProfessionId: string | null;
  readonly valid: boolean | null;
}

export interface HeroProfileComponent extends HeroPageHeroData {
  readonly id: 'profile';
  readonly kind: 'profile';
  readonly state: 'ready' | 'empty';
  readonly selectedProfessionId: string | null;
}

export interface HeroProfessionOptionComponent {
  readonly id: `profession-${string}`;
  readonly kind: 'profession';
  readonly state: 'ready' | 'selected';
  readonly professionId: string;
  readonly nameKey: string;
  readonly name: string;
  readonly skillIds: readonly string[];
  readonly selected: boolean;
  readonly deckId: string | null;
}

export interface HeroProfessionSelectorComponent {
  readonly id: 'profession-selector';
  readonly kind: 'professionSelector';
  readonly state: 'ready' | 'empty';
  readonly options: readonly HeroProfessionOptionComponent[];
}

export interface HeroDeckCardComponent extends HeroPageCardEntry {
  readonly id: `deck-card-${string}`;
  readonly label: string;
  readonly cardType: HeroPageCardType | 'UNKNOWN';
  readonly profession: string | null;
}

export interface HeroDeckComponent {
  readonly id: 'deck';
  readonly kind: 'deck';
  readonly state: 'ready' | 'invalid' | 'empty';
  readonly deckId: string | null;
  readonly professionId: string | null;
  readonly name: string | null;
  readonly totalCards: number;
  readonly cardCount: number;
  readonly unitCards: number;
  readonly skillCards: number;
  readonly minUnitCards: number;
  readonly maxSkillCards: number;
  readonly valid: boolean | null;
  readonly errors: readonly string[];
  readonly cards: readonly HeroDeckCardComponent[];
}

export interface HeroDetailComponent {
  readonly id: 'detail';
  readonly kind: 'detail';
  readonly state: 'ready' | 'invalid';
  readonly professionId: string;
  readonly nameKey: string;
  readonly name: string;
  readonly skillIds: readonly string[];
  readonly deckId: string | null;
  readonly deckValid: boolean | null;
}

export interface HeroEmptyComponent {
  readonly id: 'hero-empty';
  readonly kind: 'empty';
  readonly state: 'empty';
  readonly reason: 'noHero' | 'noProfessions';
  readonly message: string;
}

export type HeroPageComponent =
  | HeroHeaderComponent
  | HeroProfileComponent
  | HeroProfessionSelectorComponent
  | HeroDetailComponent
  | HeroDeckComponent
  | HeroEmptyComponent;

export interface HeroPageValidation {
  readonly status: 'valid' | 'invalid' | 'empty';
  readonly valid: boolean | null;
  readonly errors: readonly string[];
}

export interface HeroPageSnapshot {
  readonly schemaVersion: typeof HERO_PAGE_SCHEMA_VERSION;
  readonly pageId: 'hero';
  readonly selectedProfessionId: string | null;
  readonly validation: HeroPageValidation;
  readonly components: readonly HeroPageComponent[];
}

export type HeroInteraction =
  | { readonly type: 'selectProfession'; readonly professionId: string }
  | { readonly type: 'selectProfessionAt'; readonly index: number };

export type HeroInteractionReason = 'selected' | 'same' | 'empty';

export interface HeroInteractionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason: HeroInteractionReason;
  readonly professionId: string | null;
  readonly deckId: string | null;
}

export interface HeroPageDataFactoryOptions {
  readonly hero?: unknown;
  readonly professions?: readonly unknown[] | { readonly professions: readonly unknown[] };
  readonly cards?: readonly unknown[] | { readonly cards: readonly unknown[] };
  readonly decks?: readonly unknown[] | { readonly decks: readonly unknown[] };
  readonly title?: string;
  readonly subtitle?: string;
}

export interface HeroPageServiceOptions {
  readonly data?: HeroPageData;
  readonly hero?: unknown;
  readonly professions?: readonly unknown[] | { readonly professions: readonly unknown[] };
  readonly cards?: readonly unknown[] | { readonly cards: readonly unknown[] };
  readonly decks?: readonly unknown[] | { readonly decks: readonly unknown[] };
  readonly initialProfessionId?: string | null;
  readonly onSave?: (serialized: string) => void;
  readonly persist?: (serialized: string) => void;
}
