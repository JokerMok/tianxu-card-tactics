export interface CardConfig {
  readonly id: string;
  readonly cardType: string;
  readonly prepare: number;
  readonly unitId?: string;
  readonly skillId?: string;
  readonly profession?: string;
  readonly nameKey?: string;
  readonly tags?: readonly string[];
  readonly copyLimit?: number;
  readonly enabled?: boolean;
}

export interface SkillConfig {
  readonly id: string;
  readonly targetType: string;
  readonly rangeShape: string;
  readonly rangeA: number;
  readonly rangeB: number;
  readonly enabled?: boolean;
}

export interface UnitConfig {
  readonly id: string;
  readonly maxHp: number;
  readonly attack: number;
  readonly armor: number;
  readonly move: number;
  readonly range: number;
  readonly role: string;
  readonly enabled?: boolean;
}

export interface ProfessionConfig {
  readonly id: string;
  readonly skillIds: readonly string[];
  readonly enabled?: boolean;
}

export interface AuthorityConfig {
  readonly cards: readonly CardConfig[];
  readonly skills: readonly SkillConfig[];
  readonly units: readonly UnitConfig[];
  readonly professions: readonly ProfessionConfig[];
  readonly deck: readonly string[];
  readonly prepareByCardId: Readonly<Record<string, number>>;
}


export interface BattleConfig {
  readonly cards: readonly CardConfig[];
  readonly skills: readonly SkillConfig[];
  readonly units: readonly UnitConfig[];
  readonly professions: readonly ProfessionConfig[];
  readonly decks: readonly {
    readonly id: string;
    readonly cardEntries: readonly { readonly cardId: string; readonly count: number }[];
  }[];
}

export interface BattleConfigSelection {
  readonly deckId?: string;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function integer(value: unknown, minimum = 0): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as T;
  if (record(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)])) as T;
  return value;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function table(value: unknown, name: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`authoritative ${name} are missing`);
  const ids = new Set<string>();
  for (const row of value) {
    if (!record(row) || typeof row.id !== 'string' || !row.id || ids.has(row.id)) {
      throw new Error(`authoritative ${name} IDs are invalid or duplicated`);
    }
    if (row.enabled !== undefined && typeof row.enabled !== 'boolean') throw new Error(`authoritative ${name} enabled is invalid`);
    ids.add(row.id);
  }
  return value.filter((row) => row.enabled !== false);
}

/** Copies caller-owned JSON tables before validating and deriving runtime values. */
export function createAuthority(input: unknown, selection: BattleConfigSelection = {}): AuthorityConfig {
  if (!record(input)) throw new Error('authoritative configuration must be an object');
  if (!record(selection) || Object.keys(selection).some((key) => key !== 'deckId')
    || selection.deckId !== undefined && (typeof selection.deckId !== 'string' || !selection.deckId)) {
    throw new Error('authoritative configuration selection is invalid');
  }
  const source = clone(input);
  const cardRows = table(source.cards, 'cards');
  const skillRows = table(source.skills, 'skills');
  const unitRows = table(source.units, 'units');
  const professionRows = table(source.professions, 'professions');
  const deckRows = table(source.decks, 'decks');
  for (const card of cardRows) {
    if (!['UNIT', 'SKILL'].includes(String(card.cardType)) || !integer(card.prepare)
      || (card.copyLimit !== undefined && !integer(card.copyLimit, 1))
      || (card.tags !== undefined && (!Array.isArray(card.tags) || !card.tags.every((tag) => typeof tag === 'string')))) {
      throw new Error(`authoritative card is invalid: ${card.id}`);
    }
  }
  for (const unit of unitRows) {
    if (!integer(unit.maxHp, 1) || !['attack', 'armor', 'move', 'range'].every((key) => integer(unit[key]))
      || typeof unit.role !== 'string' || !unit.role) throw new Error(`authoritative unit is invalid: ${unit.id}`);
  }
  for (const skill of skillRows) {
    if (typeof skill.targetType !== 'string' || !skill.targetType || typeof skill.rangeShape !== 'string'
      || !integer(skill.rangeA) || !integer(skill.rangeB)) throw new Error(`authoritative skill is invalid: ${skill.id}`);
  }
  const cards = cardRows as unknown as readonly CardConfig[];
  const skills = skillRows as unknown as readonly SkillConfig[];
  const units = unitRows as unknown as readonly UnitConfig[];
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  for (const card of cards) {
    if (card.cardType === 'UNIT' && (!card.unitId || !unitsById.has(card.unitId))) throw new Error(`authoritative unit is missing: ${card.id}`);
    if (card.cardType === 'SKILL' && (!card.skillId || !skills.some((skill) => skill.id === card.skillId))) throw new Error(`authoritative skill is missing: ${card.id}`);
  }
  if (professionRows.length !== 4 || !['P001', 'P002', 'P003', 'P004'].every((id) => professionRows.some((row) => row.id === id))) {
    throw new Error('authoritative four professions are missing');
  }
  for (const profession of professionRows) {
    if (!Array.isArray(profession.skillIds) || profession.skillIds.length === 0
      || new Set(profession.skillIds).size !== profession.skillIds.length) throw new Error(`authoritative profession is invalid: ${profession.id}`);
    for (const skillId of profession.skillIds) {
      const card = cardsById.get(skillId);
      if (!card || card.cardType !== 'SKILL' || card.skillId !== skillId || !skills.some((skill) => skill.id === skillId)) {
        throw new Error(`authoritative profession skill is invalid: ${profession.id}/${skillId}`);
      }
    }
  }
  const deckConfig = selection.deckId === undefined
    ? deckRows.find((deck) => deck.id === 'D001') ?? deckRows[0]
    : deckRows.find((deck) => deck.id === selection.deckId);
  if (!deckConfig) throw new Error(`authoritative deck ${selection.deckId ?? 'D001'} is missing`);
  if (!Array.isArray(deckConfig.cardEntries) || deckConfig.cardEntries.length === 0) throw new Error('authoritative deck is empty');
  const deck: string[] = [];
  const counts = new Map<string, number>();
  for (const entry of deckConfig.cardEntries) {
    if (!record(entry) || typeof entry.cardId !== 'string' || !integer(entry.count, 1)) throw new Error('authoritative deck entry is invalid');
    const card = cardsById.get(entry.cardId);
    if (!card) throw new Error(`authoritative card is invalid: ${entry.cardId}`);
    const count = entry.count as number;
    const total = (counts.get(card.id) ?? 0) + count;
    if (deck.length + count > 30 || card.copyLimit !== undefined && total > card.copyLimit) throw new Error(`authoritative deck exceeds card limit: ${card.id}`);
    counts.set(card.id, total);
    for (let index = 0; index < count; index += 1) deck.push(card.id);
  }
  const unitCount = deck.filter((id) => cardsById.get(id)!.cardType === 'UNIT').length;
  if (deck.length !== 30 || unitCount < 24 || deck.length - unitCount > 6) throw new Error('authoritative deck composition is invalid');
  return freeze({
    cards, skills, units, professions: professionRows as unknown as readonly ProfessionConfig[], deck,
    prepareByCardId: Object.fromEntries(cards.map((card) => [card.id, card.prepare])),
  });
}
