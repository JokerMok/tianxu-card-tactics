import type {
  HeroDeckCardComponent,
  HeroDeckComponent,
  HeroEmptyComponent,
  HeroHeaderComponent,
  HeroPageComponent,
  HeroPageData,
  HeroPageHeroData,
  HeroPageProfessionData,
  HeroPageValidation,
  HeroProfileComponent,
  HeroProfessionOptionComponent,
  HeroProfessionSelectorComponent,
  HeroDetailComponent,
} from './HeroContracts.ts';

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function emptyComponent(reason: HeroEmptyComponent['reason']): HeroEmptyComponent {
  return Object.freeze({
    id: 'hero-empty',
    kind: 'empty',
    state: 'empty',
    reason,
    message: reason === 'noHero' ? '当前没有可查看的主将。' : '当前没有可用职业。',
  });
}

function profileComponent(
  hero: HeroPageHeroData,
  selectedProfessionId: string | null,
): HeroProfileComponent {
  return deepFreeze({
    ...hero,
    id: 'profile',
    kind: 'profile',
    state: 'ready',
    selectedProfessionId,
    equipment: hero.equipment.map((item) => ({ ...item })),
  });
}

function selectorComponent(
  professions: readonly HeroPageProfessionData[],
  selectedProfessionId: string,
  deckIdByProfession: ReadonlyMap<string, string>,
): HeroProfessionSelectorComponent {
  const options: HeroProfessionOptionComponent[] = professions.map((profession) => Object.freeze({
    id: `profession-${profession.id}` as `profession-${string}`,
    kind: 'profession',
    state: profession.id === selectedProfessionId ? 'selected' : 'ready',
    professionId: profession.id,
    nameKey: profession.nameKey,
    name: profession.name,
    skillIds: Object.freeze([...profession.skillIds]),
    selected: profession.id === selectedProfessionId,
    deckId: deckIdByProfession.get(profession.id) ?? null,
  }));
  return Object.freeze({
    id: 'profession-selector',
    kind: 'professionSelector',
    state: options.length === 0 ? 'empty' : 'ready',
    options: Object.freeze(options),
  });
}

function deckComponent(
  data: HeroPageData,
  selectedProfessionId: string,
  validation: HeroPageValidation,
): HeroDeckComponent {
  const deck = data.decks.find((candidate) => candidate.professionId === selectedProfessionId) ?? null;
  if (deck === null) {
    return Object.freeze({
      id: 'deck', kind: 'deck', state: 'invalid', deckId: null, professionId: selectedProfessionId,
      name: null, totalCards: 0, cardCount: 0, unitCards: 0, skillCards: 0, minUnitCards: 0,
      maxSkillCards: 0, valid: false, errors: Object.freeze(['DECK_PROFESSION_MAPPING_MISSING']), cards: Object.freeze([]),
    });
  }
  const cardById = new Map(data.cards.map((card) => [card.id, card]));
  let cardCount = 0;
  let unitCards = 0;
  let skillCards = 0;
  const cards: HeroDeckCardComponent[] = deck.cardEntries.map((entry) => {
    const card = cardById.get(entry.cardId);
    cardCount += entry.count;
    if (card?.cardType === 'UNIT') unitCards += entry.count;
    if (card?.cardType === 'SKILL') skillCards += entry.count;
    return Object.freeze({
      ...entry,
      id: `deck-card-${entry.cardId}` as `deck-card-${string}`,
      label: card?.label ?? entry.cardId,
      cardType: card?.cardType ?? 'UNKNOWN',
      profession: card?.profession ?? null,
    });
  });
  return deepFreeze({
    id: 'deck', kind: 'deck', state: validation.status === 'invalid' ? 'invalid' : 'ready',
    deckId: deck.id, professionId: deck.professionId, name: deck.name,
    totalCards: deck.totalCards, cardCount, unitCards, skillCards,
    minUnitCards: deck.minUnitCards, maxSkillCards: deck.maxSkillCards,
    valid: validation.valid, errors: [...validation.errors], cards,
  });
}

function detailComponent(
  profession: HeroPageProfessionData,
  selectedProfessionId: string,
  deck: HeroDeckComponent,
): HeroDetailComponent {
  return deepFreeze({
    id: 'detail', kind: 'detail',
    state: deck.state === 'invalid' ? 'invalid' : 'ready',
    professionId: profession.id, nameKey: profession.nameKey, name: profession.name,
    skillIds: [...profession.skillIds], deckId: deck.deckId, deckValid: deck.valid,
  });
}

export function createHeroPageComponents(
  data: HeroPageData,
  selectedProfessionId: string | null = null,
  validation: HeroPageValidation = { status: 'empty', valid: null, errors: [] },
): readonly HeroPageComponent[] {
  if (data.hero === null) return Object.freeze([emptyComponent('noHero')]);
  if (data.professions.length === 0) return Object.freeze([emptyComponent('noProfessions')]);

  const selected = selectedProfessionId ?? data.professions[0]!.id;
  const profession = data.professions.find((candidate) => candidate.id === selected) ?? data.professions[0]!;
  const deckIdByProfession = new Map(data.decks.map((deck) => [deck.professionId, deck.id]));
  const deck = deckComponent(data, profession.id, validation);
  const header: HeroHeaderComponent = Object.freeze({
    id: 'header', kind: 'header', state: validation.status === 'invalid' ? 'invalid' : 'ready',
    title: data.title, subtitle: data.subtitle, heroId: data.hero.id,
    professionCount: data.professions.length, selectedProfessionId: profession.id, valid: validation.valid,
  });
  const profile = profileComponent(data.hero, profession.id);
  const selector = selectorComponent(data.professions, profession.id, deckIdByProfession);
  const detail = detailComponent(profession, profession.id, deck);
  return deepFreeze([header, profile, selector, detail, deck]);
}
