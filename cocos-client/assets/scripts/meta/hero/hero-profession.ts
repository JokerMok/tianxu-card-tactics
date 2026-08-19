export type HeroProfessionError =
  | 'HERO_INPUT_INVALID'
  | 'HERO_NAME_REQUIRED'
  | 'HERO_PROFESSION_UNKNOWN'
  | 'DECK_INPUT_INVALID'
  | 'DECK_PROFESSION_UNKNOWN'
  | 'DECK_CARD_ENTRIES_INVALID'
  | 'DECK_CARD_ENTRY_INVALID'
  | 'DECK_CARD_TYPE_FORBIDDEN'
  | 'DECK_CARD_UNKNOWN'
  | 'DECK_CARD_COPY_LIMIT'
  | 'DECK_CARD_PROFESSION_FORBIDDEN'
  | 'DECK_SKILL_PROFESSION_FORBIDDEN'
  | 'DECK_CARD_TYPE_UNSUPPORTED'
  | 'DECK_TOTAL_CARD_COUNT'
  | 'DECK_UNIT_CARD_MINIMUM'
  | 'DECK_SKILL_CARD_MAXIMUM';

export interface HeroProfileInput {
  readonly name?: unknown;
  readonly professionId?: unknown;
}

export interface ProfessionDeckInput {
  readonly professionId?: unknown;
  readonly cardEntries?: unknown;
}

export interface HeroProfessionValidationResult {
  readonly valid: boolean;
  readonly errors: readonly HeroProfessionError[];
}

export interface HeroProfessionAuthority {
  readonly cards: readonly unknown[];
  readonly decks: readonly unknown[];
  readonly professions: readonly unknown[];
}

interface CardDefinition {
  readonly id: string;
  readonly cardType: 'UNIT' | 'SKILL';
  readonly profession: string;
  readonly skillId?: string;
  readonly copyLimit: number;
}

interface ProfessionDefinition {
  readonly id: string;
  readonly skillIds: readonly string[];
}

interface DeckLimits {
  readonly totalCards: number;
  readonly minUnitCards: number;
  readonly maxSkillCards: number;
}

interface RulesAuthority {
  readonly cardsById: ReadonlyMap<string, CardDefinition>;
  readonly professionsById: ReadonlyMap<string, ProfessionDefinition>;
  readonly limits: DeckLimits;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isEnabled(value: Record<string, unknown>): boolean {
  return value.enabled !== false;
}

function result(errors: readonly HeroProfessionError[]): HeroProfessionValidationResult {
  return { valid: errors.length === 0, errors: [...new Set(errors)] };
}

function parseCards(rawCards: readonly unknown[]): ReadonlyMap<string, CardDefinition> {
  const cards = new Map<string, CardDefinition>();
  for (const rawCard of rawCards) {
    if (!isRecord(rawCard) || !isEnabled(rawCard)) continue;
    const { id, cardType, profession, skillId, copyLimit } = rawCard;
    if (typeof id !== 'string' || id.length === 0 || (cardType !== 'UNIT' && cardType !== 'SKILL')
      || typeof profession !== 'string' || profession.length === 0 || !isPositiveInteger(copyLimit) || cards.has(id)
      || (skillId !== undefined && (typeof skillId !== 'string' || skillId.length === 0))) {
      throw new Error('hero profession cards config is invalid');
    }
    cards.set(id, {
      id,
      cardType,
      profession,
      ...(skillId === undefined ? {} : { skillId }),
      copyLimit,
    });
  }
  if (cards.size === 0) throw new Error('hero profession cards config is empty');
  return cards;
}

function parseProfessions(rawProfessions: readonly unknown[]): ReadonlyMap<string, ProfessionDefinition> {
  const professions = new Map<string, ProfessionDefinition>();
  for (const rawProfession of rawProfessions) {
    if (!isRecord(rawProfession) || !isEnabled(rawProfession)) continue;
    const { id, skillIds } = rawProfession;
    if (typeof id !== 'string' || id.length === 0 || !Array.isArray(skillIds)
      || !skillIds.every((skillId) => typeof skillId === 'string' && skillId.length > 0)
      || new Set(skillIds).size !== skillIds.length || professions.has(id)) {
      throw new Error('hero profession config is invalid');
    }
    professions.set(id, { id, skillIds: [...skillIds] });
  }
  if (professions.size === 0) throw new Error('hero profession config is empty');
  return professions;
}

function parseDeckLimits(rawDecks: readonly unknown[]): DeckLimits {
  const rawDeck = rawDecks.find((candidate) => isRecord(candidate)
    && candidate.id === 'D001' && isEnabled(candidate));
  if (!rawDeck || !isRecord(rawDeck)
    || !isPositiveInteger(rawDeck.totalCards)
    || !isPositiveInteger(rawDeck.minUnitCards)
    || !isPositiveInteger(rawDeck.maxSkillCards)
    || rawDeck.minUnitCards > rawDeck.totalCards
    || rawDeck.maxSkillCards > rawDeck.totalCards
    || rawDeck.minUnitCards + rawDeck.maxSkillCards < rawDeck.totalCards) {
    throw new Error('hero profession deck limits config is invalid');
  }
  return {
    totalCards: rawDeck.totalCards,
    minUnitCards: rawDeck.minUnitCards,
    maxSkillCards: rawDeck.maxSkillCards,
  };
}

function parseAuthority(authority: HeroProfessionAuthority): RulesAuthority {
  if (!authority || !Array.isArray(authority.cards) || !Array.isArray(authority.decks) || !Array.isArray(authority.professions)) {
    throw new Error('hero profession authority is invalid');
  }
  const cardsById = parseCards(authority.cards);
  const professionsById = parseProfessions(authority.professions);
  for (const profession of professionsById.values()) {
    for (const skillId of profession.skillIds) {
      const card = cardsById.get(skillId);
      if (!card || card.cardType !== 'SKILL' || (card.skillId ?? card.id) !== skillId) {
        throw new Error('hero profession skill references are invalid');
      }
    }
  }
  return {
    cardsById,
    professionsById,
    limits: parseDeckLimits(authority.decks),
  };
}

function isNeutralOrOwned(card: CardDefinition, professionId: string): boolean {
  return card.profession === 'NONE' || card.profession === professionId;
}

export interface HeroProfessionRules {
  validateHeroProfile(input: unknown): HeroProfessionValidationResult;
  validateDeck(input: unknown): HeroProfessionValidationResult;
}

export function createHeroProfessionRules(authority: HeroProfessionAuthority): HeroProfessionRules {
  const parsedAuthority = parseAuthority(authority);

  function validateHeroProfile(input: unknown): HeroProfessionValidationResult {
    if (!isRecord(input)) return result(['HERO_INPUT_INVALID']);
    const errors: HeroProfessionError[] = [];
    if (input.name !== undefined && (typeof input.name !== 'string' || input.name.trim().length === 0)) {
      errors.push('HERO_NAME_REQUIRED');
    }
    if (input.professionId !== undefined
      && (typeof input.professionId !== 'string' || !parsedAuthority.professionsById.has(input.professionId))) {
      errors.push('HERO_PROFESSION_UNKNOWN');
    }
    return result(errors);
  }

  function validateDeck(input: unknown): HeroProfessionValidationResult {
    if (!isRecord(input)) return result(['DECK_INPUT_INVALID']);
    const errors: HeroProfessionError[] = [];
    if (typeof input.professionId !== 'string' || !parsedAuthority.professionsById.has(input.professionId)) {
      return result(['DECK_PROFESSION_UNKNOWN']);
    }
    if (!Array.isArray(input.cardEntries)) return result(['DECK_CARD_ENTRIES_INVALID']);

    const profession = parsedAuthority.professionsById.get(input.professionId)!;
    const counts = new Map<string, number>();
    let totalCards = 0;
    let unitCards = 0;
    let skillCards = 0;

    for (const entry of input.cardEntries) {
      if (!isRecord(entry) || typeof entry.cardId !== 'string' || !isPositiveInteger(entry.count)) {
        errors.push('DECK_CARD_ENTRY_INVALID');
        continue;
      }
      if ('cardType' in entry) errors.push('DECK_CARD_TYPE_FORBIDDEN');
      if (Object.keys(entry).some((key) => key !== 'cardId' && key !== 'count' && key !== 'cardType')) {
        errors.push('DECK_CARD_ENTRY_INVALID');
      }

      totalCards += entry.count;
      const card = parsedAuthority.cardsById.get(entry.cardId);
      if (!card) {
        errors.push('DECK_CARD_UNKNOWN');
        continue;
      }
      counts.set(card.id, (counts.get(card.id) ?? 0) + entry.count);
      if (card.cardType === 'UNIT') {
        unitCards += entry.count;
        if (!isNeutralOrOwned(card, profession.id)) errors.push('DECK_CARD_PROFESSION_FORBIDDEN');
        continue;
      }
      if (card.cardType === 'SKILL') {
        skillCards += entry.count;
        if (!isNeutralOrOwned(card, profession.id)) errors.push('DECK_CARD_PROFESSION_FORBIDDEN');
        if (!profession.skillIds.includes(card.skillId ?? card.id)) errors.push('DECK_SKILL_PROFESSION_FORBIDDEN');
        continue;
      }
      errors.push('DECK_CARD_TYPE_UNSUPPORTED');
    }

    for (const [cardId, count] of counts) {
      if (count > parsedAuthority.cardsById.get(cardId)!.copyLimit) errors.push('DECK_CARD_COPY_LIMIT');
    }
    if (totalCards !== parsedAuthority.limits.totalCards) errors.push('DECK_TOTAL_CARD_COUNT');
    if (unitCards < parsedAuthority.limits.minUnitCards) errors.push('DECK_UNIT_CARD_MINIMUM');
    if (skillCards > parsedAuthority.limits.maxSkillCards) errors.push('DECK_SKILL_CARD_MAXIMUM');
    return result(errors);
  }

  return { validateHeroProfile, validateDeck };
}
