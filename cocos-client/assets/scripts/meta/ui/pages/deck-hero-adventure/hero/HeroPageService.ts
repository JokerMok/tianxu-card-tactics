import {
  HERO_PAGE_SCHEMA_VERSION,
  type HeroInteraction,
  type HeroInteractionReason,
  type HeroInteractionResult,
  type HeroPageCardData,
  type HeroPageData,
  type HeroPageDataFactoryOptions,
  type HeroPageDeckData,
  type HeroPageHeroData,
  type HeroPageProfessionData,
  type HeroPageServiceOptions,
  type HeroPageSnapshot,
  type HeroPageValidation,
} from './HeroContracts.ts';
import { createHeroPageComponents, deepFreeze } from './HeroComponents.ts';

export type HeroPageErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_ARGUMENT'
  | 'INVALID_DATA'
  | 'INVALID_ID'
  | 'DUPLICATE_ID'
  | 'PROFESSION_NOT_FOUND'
  | 'INDEX_OUT_OF_RANGE'
  | 'INVALID_SAVE'
  | 'SAVE_VERSION';

export class HeroPageError extends Error {
  readonly code: HeroPageErrorCode;
  readonly reason: HeroPageErrorCode;

  constructor(code: HeroPageErrorCode, message: string) {
    super(message);
    this.name = 'HeroPageError';
    this.code = code;
    this.reason = code;
  }
}

function fail(code: HeroPageErrorCode, message: string): never {
  throw new HeroPageError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) fail('INVALID_ARGUMENT', `${label} must be an object`);
}

function rows(input: unknown, key: string): readonly unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input) && Array.isArray(input[key])) return input[key] as readonly unknown[];
  return [];
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    const missing = allowed.find((key) => !actual.includes(key));
    fail(missing ? 'MISSING_FIELD' : 'INVALID_DATA', `${label} must contain exactly ${expected.join(', ')}`);
  }
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail('INVALID_DATA', `${label} must be a non-empty string`);
}

function safeInteger(value: unknown, label: string, positive = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
    fail('INVALID_DATA', `${label} must be ${positive ? 'a positive' : 'a non-negative'} safe integer`);
  }
}

function cloneData(data: HeroPageData): HeroPageData {
  return {
    schemaVersion: data.schemaVersion,
    title: data.title,
    subtitle: data.subtitle,
    hero: data.hero === null ? null : {
      ...data.hero,
      equipment: data.hero.equipment.map((item) => ({ ...item })),
    },
    professions: data.professions.map((profession) => ({ ...profession, skillIds: [...profession.skillIds] })),
    cards: data.cards.map((card) => ({ ...card })),
    decks: data.decks.map((deck) => ({
      ...deck,
      cardEntries: deck.cardEntries.map((entry) => ({ ...entry })),
    })),
  };
}

function normalizeEquipment(input: unknown): HeroPageHeroData['equipment'] {
  if (input === undefined) return [];
  const values = Array.isArray(input)
    ? input
    : isRecord(input) ? Object.entries(input).map(([slot, item]) => ({ slot, ...(isRecord(item) ? item : {}) })) : [];
  return values.map((raw, index) => {
    assertRecord(raw, `hero equipment[${index}]`);
    nonEmptyString(raw.slot, `hero equipment[${index}].slot`);
    nonEmptyString(raw.name, `hero equipment[${index}].name`);
    safeInteger(raw.level, `hero equipment[${index}].level`, true);
    return { slot: raw.slot, name: raw.name, level: raw.level };
  });
}

function normalizeHero(raw: unknown): HeroPageHeroData | null {
  if (raw === null) return null;
  const input = raw === undefined ? {} : raw;
  assertRecord(input, 'hero');
  const id = input.id ?? 'H001';
  const name = input.name ?? '岳沉戈';
  const level = input.level ?? 8;
  const xp = input.xp ?? 320;
  const power = input.power ?? 1680;
  nonEmptyString(id, 'hero.id');
  nonEmptyString(name, 'hero.name');
  safeInteger(level, 'hero.level', true);
  safeInteger(xp, 'hero.xp');
  safeInteger(power, 'hero.power');
  if (input.professionId !== undefined && input.professionId !== null) nonEmptyString(input.professionId, 'hero.professionId');
  return {
    id, name, level, xp, power,
    professionId: input.professionId ?? null,
    equipment: normalizeEquipment(input.equipment),
  };
}

function normalizeProfessions(input: unknown): HeroPageProfessionData[] {
  const result: HeroPageProfessionData[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rows(input, 'professions').entries()) {
    if (!isRecord(raw) || raw.enabled === false) continue;
    const id = raw.id;
    const nameKey = raw.nameKey ?? raw.id;
    const name = raw.name ?? raw.label ?? raw.displayName ?? nameKey;
    nonEmptyString(id, `professions[${index}].id`);
    nonEmptyString(nameKey, `professions[${index}].nameKey`);
    nonEmptyString(name, `professions[${index}].name`);
    if (!Array.isArray(raw.skillIds) || !raw.skillIds.every((skillId) => typeof skillId === 'string' && skillId.length > 0)) {
      fail('INVALID_DATA', `professions[${index}].skillIds is invalid`);
    }
    if (seen.has(id)) fail('DUPLICATE_ID', `duplicate profession: ${id}`);
    seen.add(id);
    result.push({ id, nameKey, name, skillIds: [...raw.skillIds] });
  }
  return result;
}

function normalizeCards(input: unknown): HeroPageCardData[] {
  const result: HeroPageCardData[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of rows(input, 'cards').entries()) {
    if (!isRecord(raw) || raw.enabled === false) continue;
    const id = raw.id;
    nonEmptyString(id, `cards[${index}].id`);
    if (raw.cardType !== 'UNIT' && raw.cardType !== 'SKILL') fail('INVALID_DATA', `cards[${index}].cardType is invalid`);
    nonEmptyString(raw.profession, `cards[${index}].profession`);
    const label = raw.label ?? raw.name ?? raw.nameKey ?? id;
    nonEmptyString(label, `cards[${index}].label`);
    safeInteger(raw.copyLimit, `cards[${index}].copyLimit`, true);
    if (raw.skillId !== undefined && raw.skillId !== null) nonEmptyString(raw.skillId, `cards[${index}].skillId`);
    if (seen.has(id)) fail('DUPLICATE_ID', `duplicate card: ${id}`);
    seen.add(id);
    result.push({ id, label, cardType: raw.cardType, profession: raw.profession, copyLimit: raw.copyLimit, skillId: raw.skillId ?? null });
  }
  return result;
}

function normalizeDeck(raw: unknown, index: number, fallbackProfessionId?: string): HeroPageDeckData {
  assertRecord(raw, `decks[${index}]`);
  const id = raw.id;
  const professionId = raw.professionId ?? raw.profession ?? fallbackProfessionId;
  const name = raw.name ?? raw.label ?? id;
  nonEmptyString(id, `decks[${index}].id`);
  nonEmptyString(professionId, `decks[${index}].professionId`);
  nonEmptyString(name, `decks[${index}].name`);
  if (!Array.isArray(raw.cardEntries)) fail('INVALID_DATA', `decks[${index}].cardEntries is invalid`);
  const cardEntries = raw.cardEntries.map((entry, entryIndex) => {
    assertRecord(entry, `decks[${index}].cardEntries[${entryIndex}]`);
    exactKeys(entry, ['cardId', 'count'], `decks[${index}].cardEntries[${entryIndex}]`);
    nonEmptyString(entry.cardId, `decks[${index}].cardEntries[${entryIndex}].cardId`);
    safeInteger(entry.count, `decks[${index}].cardEntries[${entryIndex}].count`, true);
    return { cardId: entry.cardId, count: entry.count };
  });
  const totalCards = raw.totalCards ?? cardEntries.reduce((total, entry) => total + entry.count, 0);
  const minUnitCards = raw.minUnitCards ?? 24;
  const maxSkillCards = raw.maxSkillCards ?? 6;
  safeInteger(totalCards, `decks[${index}].totalCards`, true);
  safeInteger(minUnitCards, `decks[${index}].minUnitCards`);
  safeInteger(maxSkillCards, `decks[${index}].maxSkillCards`);
  return { id, name, professionId, cardEntries, totalCards, minUnitCards, maxSkillCards };
}

function unitEntriesFor(
  cards: readonly HeroPageCardData[],
  base: HeroPageDeckData | null,
  count: number,
): Array<{ cardId: string; count: number }> {
  const allowed = new Map(cards.filter((card) => card.cardType === 'UNIT').map((card) => [card.id, card]));
  const candidates = base?.cardEntries.filter((entry) => allowed.has(entry.cardId)) ?? [];
  for (const card of cards) if (card.cardType === 'UNIT' && !candidates.some((entry) => entry.cardId === card.id)) candidates.push({ cardId: card.id, count: 1 });
  const entries: Array<{ cardId: string; count: number }> = [];
  let remaining = count;
  for (const candidate of candidates) {
    if (remaining === 0) break;
    const limit = allowed.get(candidate.cardId)?.copyLimit ?? candidate.count;
    const amount = Math.min(candidate.count, limit, remaining);
    if (amount > 0) {
      entries.push({ cardId: candidate.cardId, count: amount });
      remaining -= amount;
    }
  }
  return entries;
}

function createDeckMappings(
  professions: readonly HeroPageProfessionData[],
  cards: readonly HeroPageCardData[],
  input: unknown,
): HeroPageDeckData[] {
  const direct = rows(input, 'decks').map((raw, index) => normalizeDeck(raw, index));
  const base = direct.find((deck) => deck.id === 'D001') ?? direct[0] ?? null;
  const result: HeroPageDeckData[] = [];
  for (const profession of professions) {
    const existing = direct.find((deck) => deck.professionId === profession.id);
    if (existing) {
      result.push(existing);
      continue;
    }
    const skillEntries = profession.skillIds.map((cardId) => ({ cardId, count: 1 }));
    const totalCards = base?.totalCards ?? 30;
    const units = unitEntriesFor(cards, base, Math.max(0, totalCards - skillEntries.length));
    result.push({
      id: base ? `${base.id}-${profession.id}` : `deck-${profession.id}`,
      name: `${base?.name ?? '主将编队'}·${profession.name}`,
      professionId: profession.id,
      cardEntries: [...units, ...skillEntries],
      totalCards,
      minUnitCards: base?.minUnitCards ?? 24,
      maxSkillCards: base?.maxSkillCards ?? 6,
    });
  }
  return result;
}

function normalizeData(input: HeroPageData): HeroPageData {
  assertRecord(input, 'hero page data');
  exactKeys(input, ['schemaVersion', 'title', 'subtitle', 'hero', 'professions', 'cards', 'decks'], 'hero page data');
  if (input.schemaVersion !== HERO_PAGE_SCHEMA_VERSION) fail('INVALID_DATA', 'unsupported hero page schema version');
  nonEmptyString(input.title, 'hero page title');
  nonEmptyString(input.subtitle, 'hero page subtitle');
  if (!Array.isArray(input.professions) || !Array.isArray(input.cards) || !Array.isArray(input.decks)) fail('INVALID_ARGUMENT', 'hero page collections must be arrays');
  const professions = normalizeProfessions(input.professions);
  const cards = normalizeCards(input.cards);
  const decks = input.decks.map((raw, index) => normalizeDeck(raw, index));
  const deckIds = new Set<string>();
  const deckProfessions = new Set<string>();
  for (const deck of decks) {
    if (deckIds.has(deck.id)) fail('DUPLICATE_ID', `duplicate deck: ${deck.id}`);
    if (deckProfessions.has(deck.professionId)) fail('DUPLICATE_ID', `duplicate deck mapping: ${deck.professionId}`);
    deckIds.add(deck.id);
    deckProfessions.add(deck.professionId);
  }
  const hero = normalizeHero(input.hero);
  if (hero?.professionId !== null && hero?.professionId !== undefined && !professions.some((profession) => profession.id === hero.professionId)) {
    fail('INVALID_ID', `unknown hero profession: ${hero.professionId}`);
  }
  return { schemaVersion: HERO_PAGE_SCHEMA_VERSION, title: input.title, subtitle: input.subtitle, hero, professions, cards, decks };
}

export function createHeroPageData(options: HeroPageDataFactoryOptions = {}): HeroPageData {
  const professions = normalizeProfessions(options.professions ?? []);
  const cards = normalizeCards(options.cards ?? []);
  return normalizeData({
    schemaVersion: HERO_PAGE_SCHEMA_VERSION,
    title: options.title ?? '主将与职业',
    subtitle: options.subtitle ?? '查看主将成长，并选择当前职业与对应编队。',
    hero: normalizeHero(options.hero),
    professions,
    cards,
    decks: createDeckMappings(professions, cards, options.decks ?? []),
  });
}

export function createDefaultHeroPageData(): HeroPageData {
  const professions = [
    { id: 'P001', nameKey: 'profession.commander.name', skillIds: ['S004', 'S006', 'S014'] },
    { id: 'P002', nameKey: 'profession.arcanist.name', skillIds: ['S001', 'S002', 'S003', 'S013'] },
    { id: 'P003', nameKey: 'profession.pact.name', skillIds: ['S007', 'S008', 'S015', 'S016'] },
    { id: 'P004', nameKey: 'profession.shadow.name', skillIds: ['S005', 'S009', 'S010', 'S011', 'S012'] },
  ];
  const units = Array.from({ length: 27 }, (_, index) => {
    const id = `U${String(index + 1).padStart(3, '0')}`;
    return { id, label: id, cardType: 'UNIT', profession: 'NONE', copyLimit: 1 };
  });
  const skills = professions.flatMap((profession) => profession.skillIds.map((id) => ({
    id, label: id, cardType: 'SKILL', profession: profession.id, skillId: id, copyLimit: 1,
  })));
  return createHeroPageData({
    hero: { id: 'H001', name: '岳沉戈', level: 8, xp: 320, power: 1680, professionId: 'P001' },
    professions,
    cards: [...units, ...skills],
    decks: [{
      id: 'D001',
      profession: 'P001',
      cardEntries: [...units.map(({ id }) => ({ cardId: id, count: 1 })), ...professions[0]!.skillIds.map((cardId) => ({ cardId, count: 1 }))],
      totalCards: 30,
      minUnitCards: 24,
      maxSkillCards: 6,
    }],
  });
}

export function createEmptyHeroPageData(): HeroPageData {
  return {
    schemaVersion: HERO_PAGE_SCHEMA_VERSION,
    title: '主将与职业',
    subtitle: '暂无主将数据',
    hero: null,
    professions: [],
    cards: [],
    decks: [],
  };
}

function cloneValidation(validation: HeroPageValidation): HeroPageValidation {
  return { status: validation.status, valid: validation.valid, errors: [...validation.errors] };
}

function interactionResult(
  accepted: boolean,
  changed: boolean,
  reason: HeroInteractionReason,
  professionId: string | null,
  deckId: string | null,
): HeroInteractionResult {
  return Object.freeze({ accepted, changed, reason, professionId, deckId });
}

function selectedDeck(data: HeroPageData, professionId: string | null): HeroPageDeckData | null {
  return data.decks.find((deck) => deck.professionId === professionId) ?? null;
}

function validationFor(data: HeroPageData, professionId: string | null): HeroPageValidation {
  if (data.hero === null || data.professions.length === 0 || professionId === null) return { status: 'empty', valid: null, errors: [] };
  const profession = data.professions.find((candidate) => candidate.id === professionId);
  if (!profession) return { status: 'invalid', valid: false, errors: ['PROFESSION_NOT_FOUND'] };
  const deck = selectedDeck(data, professionId);
  if (!deck) return { status: 'invalid', valid: false, errors: ['DECK_PROFESSION_MAPPING_MISSING'] };
  const cards = new Map(data.cards.map((card) => [card.id, card]));
  const errors: string[] = [];
  let total = 0;
  let units = 0;
  let skills = 0;
  for (const entry of deck.cardEntries) {
    total += entry.count;
    const card = cards.get(entry.cardId);
    if (!card) {
      errors.push('DECK_CARD_UNKNOWN');
      continue;
    }
    if (entry.count > card.copyLimit) errors.push('DECK_CARD_COPY_LIMIT');
    if (card.cardType === 'UNIT') {
      units += entry.count;
      if (card.profession !== 'NONE' && card.profession !== professionId) errors.push('DECK_CARD_PROFESSION_FORBIDDEN');
    } else {
      skills += entry.count;
      if (card.profession !== 'NONE' && card.profession !== professionId) errors.push('DECK_CARD_PROFESSION_FORBIDDEN');
      if (!profession.skillIds.includes(card.skillId ?? card.id)) errors.push('DECK_SKILL_PROFESSION_FORBIDDEN');
    }
  }
  if (total !== deck.totalCards) errors.push('DECK_TOTAL_CARD_COUNT');
  if (units < deck.minUnitCards) errors.push('DECK_UNIT_CARD_MINIMUM');
  if (skills > deck.maxSkillCards) errors.push('DECK_SKILL_CARD_MAXIMUM');
  const unique = [...new Set(errors)];
  return { status: unique.length === 0 ? 'valid' : 'invalid', valid: unique.length === 0, errors: unique };
}

function parseSaved(value: unknown): string | null {
  if (typeof value !== 'string') fail('INVALID_SAVE', 'hero page save must be a string');
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { fail('INVALID_SAVE', 'hero page save is not valid JSON'); }
  assertRecord(parsed, 'hero page save');
  exactKeys(parsed, ['schemaVersion', 'pageId', 'selectedProfessionId'], 'hero page save');
  if (parsed.schemaVersion !== HERO_PAGE_SCHEMA_VERSION) fail('SAVE_VERSION', 'unsupported hero page save version');
  if (parsed.pageId !== 'hero') fail('INVALID_SAVE', 'hero page save pageId is invalid');
  if (parsed.selectedProfessionId !== null && typeof parsed.selectedProfessionId !== 'string') fail('INVALID_SAVE', 'hero page save profession is invalid');
  return parsed.selectedProfessionId as string | null;
}

function isPageData(input: HeroPageData | HeroPageServiceOptions): input is HeroPageData {
  return isRecord(input) && !('data' in input)
    && ('schemaVersion' in input || 'title' in input || 'subtitle' in input
      || ('professions' in input && 'cards' in input && 'decks' in input));
}

export class HeroPageService {
  private readonly data: HeroPageData;
  private readonly onSave?: (serialized: string) => void;
  private selectedProfessionIdValue: string | null;

  constructor(input: HeroPageData | HeroPageServiceOptions = {}) {
    const options: HeroPageServiceOptions = isPageData(input) ? { data: input } : input;
    this.data = normalizeData(options.data ?? createHeroPageData({
      hero: options.hero,
      professions: options.professions,
      cards: options.cards,
      decks: options.decks,
    }));
    this.onSave = options.onSave ?? options.persist;
    const initial = options.initialProfessionId ?? this.data.hero?.professionId ?? this.data.professions[0]?.id ?? null;
    if (initial !== null && !this.data.professions.some((profession) => profession.id === initial)) fail('PROFESSION_NOT_FOUND', `unknown hero profession: ${initial}`);
    this.selectedProfessionIdValue = initial;
  }

  static restore(data: HeroPageData, serialized: string, options: Omit<HeroPageServiceOptions, 'data' | 'initialProfessionId'> = {}): HeroPageService {
    const selectedProfessionId = parseSaved(serialized);
    return new HeroPageService({ ...options, data, initialProfessionId: selectedProfessionId });
  }

  static fromSerialized(data: HeroPageData, serialized: string, options: Omit<HeroPageServiceOptions, 'data' | 'initialProfessionId'> = {}): HeroPageService {
    return HeroPageService.restore(data, serialized, options);
  }

  get pageData(): HeroPageData {
    return cloneData(this.data);
  }

  snapshot(): HeroPageSnapshot {
    const validation = validationFor(this.data, this.selectedProfessionIdValue);
    return deepFreeze({
      schemaVersion: HERO_PAGE_SCHEMA_VERSION,
      pageId: 'hero',
      selectedProfessionId: this.selectedProfessionIdValue,
      validation: cloneValidation(validation),
      components: createHeroPageComponents(this.data, this.selectedProfessionIdValue, validation),
    });
  }

  interact(action: HeroInteraction): HeroInteractionResult {
    if (!isRecord(action) || typeof action.type !== 'string') fail('INVALID_ARGUMENT', 'hero interaction must contain a type');
    switch (action.type) {
      case 'selectProfession': return this.selectProfession(action.professionId);
      case 'selectProfessionAt': return this.selectProfessionAt(action.index);
      default: fail('INVALID_ARGUMENT', `unknown hero interaction: ${action.type}`);
    }
  }

  selectProfession(professionId: string): HeroInteractionResult {
    if (this.data.hero === null || this.data.professions.length === 0) return interactionResult(false, false, 'empty', null, null);
    nonEmptyString(professionId, 'hero profession id');
    const profession = this.data.professions.find((candidate) => candidate.id === professionId);
    if (!profession) fail('PROFESSION_NOT_FOUND', `unknown hero profession: ${professionId}`);
    const changed = this.selectedProfessionIdValue !== profession.id;
    const previous = this.selectedProfessionIdValue;
    if (changed) {
      this.selectedProfessionIdValue = profession.id;
      try {
        if (this.onSave) this.onSave(this.serialize());
      } catch (error) {
        this.selectedProfessionIdValue = previous;
        throw error;
      }
    }
    return interactionResult(true, changed, changed ? 'selected' : 'same', profession.id, selectedDeck(this.data, profession.id)?.id ?? null);
  }

  selectProfessionAt(index: number): HeroInteractionResult {
    if (this.data.hero === null || this.data.professions.length === 0) return interactionResult(false, false, 'empty', null, null);
    if (typeof index !== 'number' || !Number.isSafeInteger(index)) fail('INVALID_DATA', 'hero profession index must be a safe integer');
    if (index < 0 || index >= this.data.professions.length) fail('INDEX_OUT_OF_RANGE', `hero profession index ${index} is outside the data range`);
    return this.selectProfession(this.data.professions[index]!.id);
  }

  serialize(): string {
    return JSON.stringify({
      schemaVersion: HERO_PAGE_SCHEMA_VERSION,
      pageId: 'hero',
      selectedProfessionId: this.selectedProfessionIdValue,
    });
  }

  save(): string { return this.serialize(); }

  restore(serialized: string): HeroPageSnapshot {
    const selectedProfessionId = parseSaved(serialized);
    if (selectedProfessionId !== null && !this.data.professions.some((profession) => profession.id === selectedProfessionId)) {
      fail('PROFESSION_NOT_FOUND', `unknown hero profession in save: ${selectedProfessionId}`);
    }
    this.selectedProfessionIdValue = selectedProfessionId;
    return this.snapshot();
  }
}

export function createHeroPageService(input: HeroPageData | HeroPageServiceOptions = {}): HeroPageService {
  return new HeroPageService(input);
}

export function restoreHeroPageService(
  data: HeroPageData,
  serialized: string,
  options: Omit<HeroPageServiceOptions, 'data' | 'initialProfessionId'> = {},
): HeroPageService {
  return HeroPageService.restore(data, serialized, options);
}
