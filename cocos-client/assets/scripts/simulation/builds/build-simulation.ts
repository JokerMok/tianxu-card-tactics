export const BUILD_TARGETS = Object.freeze([
  'P01', 'P02', 'P03', 'P04',
  'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07',
] as const);

export type BuildTarget = (typeof BUILD_TARGETS)[number];
export type BuildSourceFormat = 'slots' | 'cardEntries';

export interface CardDefinition {
  id: string;
  cardType: 'UNIT' | 'SKILL' | string;
  race: string;
  profession?: string;
  unitId?: string;
  skillId?: string;
  prepare: number;
  copyLimit: number;
  enabled?: boolean;
}

export interface UnitDefinition {
  id: string;
  race: string;
  role: string;
  maxHp: number;
  attack: number;
  prepare?: number;
  footprintCells: number;
  enabled?: boolean;
}

export interface SkillDefinition {
  id: string;
  effectIds: readonly string[];
  targetType: string;
  enabled?: boolean;
}

export interface ProfessionDefinition {
  id: string;
  skillIds: readonly string[];
  enabled?: boolean;
}

export interface DeckContract {
  id: string;
  totalCards: number;
  minUnitCards: number;
  maxSkillCards: number;
  enabled?: boolean;
}

export interface BuildContext {
  cards: ReadonlyMap<string, CardDefinition>;
  units: ReadonlyMap<string, UnitDefinition>;
  skills: ReadonlyMap<string, SkillDefinition>;
  professions: ReadonlyMap<string, ProfessionDefinition>;
  decks: ReadonlyMap<string, DeckContract>;
  legalRaces: ReadonlySet<string>;
}

export interface BuildContextInput {
  cards: readonly CardDefinition[];
  units: readonly UnitDefinition[];
  skills: readonly SkillDefinition[];
  professions: readonly ProfessionDefinition[];
  decks: readonly DeckContract[];
}

export interface BuildEntry {
  slot: number;
  cardId: string;
  count: number;
}

export interface NormalizedBuild {
  sourceTarget: BuildTarget;
  sourceFormat: BuildSourceFormat;
  sourceBuildIndex: number;
  id: string;
  name: string;
  professionId: string;
  race: string;
  purposeTags: readonly string[];
  entries: readonly BuildEntry[];
  totalCards: number;
  minUnitCards: number;
  maxSkillCards: number;
}

export interface BuildValidationSummary {
  build: NormalizedBuild;
  unitCards: number;
  skillCards: number;
  slotCount: number;
  uniqueCardCount: number;
  cardCounts: ReadonlyMap<string, number>;
  unitCardIds: readonly string[];
  skillCardIds: readonly string[];
  unitRaces: readonly string[];
  unitRoles: readonly string[];
}

export interface BuildCoverage {
  professionCounts: ReadonlyMap<string, number>;
  raceCounts: ReadonlyMap<string, number>;
  declaredRaceCounts: ReadonlyMap<string, number>;
  targetCounts: ReadonlyMap<BuildTarget, number>;
}

export interface BuildCorpusValidation {
  builds: readonly NormalizedBuild[];
  summaries: readonly BuildValidationSummary[];
  coverage: BuildCoverage;
  professionIds: readonly string[];
  races: readonly string[];
}

export interface BuildDocumentInput {
  target: BuildTarget;
  document: unknown;
}

export interface SimulationOptions {
  seed?: number;
  rounds?: number;
  openingHandSize?: number;
  drawPerRound?: number;
  preparePointsPerRound?: number;
  handLimit?: number;
}

export interface SimulationEvent {
  round: number;
  type: 'DRAW' | 'DEPLOY_UNIT' | 'CAST_SKILL' | 'DISCARD';
  cardId: string;
  remainingPrepare: number;
}

export interface BuildSimulationResult {
  buildId: string;
  seed: number;
  rounds: number;
  deckSize: number;
  drawnCards: number;
  deployedUnits: number;
  castSkills: number;
  totalAttack: number;
  totalMaxHp: number;
  effectApplications: number;
  deployedRaces: readonly string[];
  deployedRoles: readonly string[];
  remainingDeck: number;
  replayHash: string;
  events: readonly SimulationEvent[];
}

export interface MultiSeedSimulationResult {
  buildId: string;
  runs: readonly BuildSimulationResult[];
  deterministic: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function fail(message: string): never {
  throw new Error(message);
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function exactKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  expect(isRecord(value), `${label} fields invalid`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  expect(actual.length === expected.length && actual.every((key, index) => key === expected[index]), `${label} fields invalid`);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function rowsById<T extends { id: string }>(rows: readonly T[], label: string): Map<string, T> {
  expect(rows.length > 0, `${label} must be a non-empty real table`);
  const result = new Map<string, T>();
  for (const row of rows) {
    expect(isRecord(row) && nonEmptyString(row.id), `${label} contains a row without an id`);
    expect(!result.has(row.id), `${label} contains duplicate id ${row.id}`);
    result.set(row.id, row);
  }
  return result;
}

export function createBuildContext(input: BuildContextInput): BuildContext {
  const cards = rowsById(input.cards, 'cards');
  const units = rowsById(input.units, 'units');
  const skills = rowsById(input.skills, 'skills');
  const professions = rowsById(input.professions, 'professions');
  const decks = rowsById(input.decks, 'decks');
  const legalRaces = new Set(
    [...units.values()]
      .filter((unit) => unit.enabled !== false && nonEmptyString(unit.race) && unit.race !== 'NONE')
      .map((unit) => unit.race),
  );
  expect(legalRaces.size > 0, 'real units table must expose at least one legal race');
  return { cards, units, skills, professions, decks, legalRaces };
}

function getTargetDocumentKeys(target: BuildTarget): readonly string[] {
  if (target === 'P01') {
    return ['schemaVersion', 'buildGroup', 'professionId', 'evidenceLevel', 'version', 'enabled', 'rules', 'builds'];
  }
  return ['schemaVersion', 'table', 'evidenceLevel', 'version', 'enabled', 'buildTarget', 'contractDeckId', 'builds'];
}

function expectedProfessionForTarget(target: BuildTarget): string | undefined {
  if (!target.startsWith('P')) return undefined;
  return `P${target.slice(1).padStart(3, '0')}`;
}

function normalizeContract(
  value: unknown,
  label: string,
  exact = true,
): Pick<NormalizedBuild, 'totalCards' | 'minUnitCards' | 'maxSkillCards'> {
  expect(isRecord(value), `${label} fields invalid`);
  if (exact) exactKeys(value, ['totalCards', 'minUnitCards', 'maxSkillCards'], label);
  expect(positiveInteger(value.totalCards), `${label}.totalCards must be a positive integer`);
  expect(positiveInteger(value.minUnitCards), `${label}.minUnitCards must be a positive integer`);
  expect(positiveInteger(value.maxSkillCards), `${label}.maxSkillCards must be a positive integer`);
  expect(value.minUnitCards <= value.totalCards, `${label}.minUnitCards exceeds totalCards`);
  expect(value.maxSkillCards <= value.totalCards, `${label}.maxSkillCards exceeds totalCards`);
  return {
    totalCards: value.totalCards,
    minUnitCards: value.minUnitCards,
    maxSkillCards: value.maxSkillCards,
  };
}

function normalizePurposeTags(value: unknown, label: string): readonly string[] {
  expect(Array.isArray(value) && value.length > 0, `${label}.purposeTags must not be empty`);
  expect(value.every((tag) => nonEmptyString(tag)), `${label}.purposeTags must contain non-empty strings`);
  return value as string[];
}

function normalizeBuildRow(
  target: BuildTarget,
  row: unknown,
  index: number,
  professionId: string | undefined,
  contract: Pick<NormalizedBuild, 'totalCards' | 'minUnitCards' | 'maxSkillCards'>,
): NormalizedBuild {
  const label = `${target}.builds[${index}]`;
  if (target === 'P01') {
    exactKeys(row, ['id', 'name', 'professionId', 'race', 'purposeTags', 'slots'], label);
    expect(nonEmptyString(row.id), `${label}.id is required`);
    expect(nonEmptyString(row.name), `${label}.name is required`);
    expect(row.professionId === professionId, `${label}.professionId must match the real P01 profession`);
    expect(nonEmptyString(row.race), `${label}.race is required`);
    expect(Array.isArray(row.slots) && row.slots.length === contract.totalCards, `${label}.slots must contain the real deck size`);
    const slots = row.slots as unknown[];
    const entries = slots.map((slot, slotIndex) => {
      const slotLabel = `${label}.slots[${slotIndex}]`;
      exactKeys(slot, ['slot', 'cardId'], slotLabel);
      expect(slot.slot === slotIndex + 1, `${slotLabel}.slot must be contiguous from 1`);
      expect(nonEmptyString(slot.cardId), `${slotLabel}.cardId is required`);
      return { slot: slot.slot, cardId: slot.cardId, count: 1 };
    });
    return {
      sourceTarget: target,
      sourceFormat: 'slots',
      sourceBuildIndex: index,
      id: row.id,
      name: row.name,
      professionId,
      race: row.race,
      purposeTags: normalizePurposeTags(row.purposeTags, label),
      entries,
      ...contract,
    };
  }

  exactKeys(row, ['id', 'profession', 'race', 'cardEntries', 'totalCards', 'minUnitCards', 'maxSkillCards', 'purposeTags'], label);
  expect(nonEmptyString(row.id), `${label}.id is required`);
  expect(nonEmptyString(row.profession), `${label}.profession is required`);
  if (professionId) expect(row.profession === professionId, `${label}.profession must match the expected profession for ${target}`);
  expect(nonEmptyString(row.race), `${label}.race is required`);
  expect(Array.isArray(row.cardEntries) && row.cardEntries.length > 0, `${label}.cardEntries must not be empty`);
  expect(row.totalCards === contract.totalCards, `${label}.totalCards must match the real deck contract`);
  expect(row.minUnitCards === contract.minUnitCards, `${label}.minUnitCards must match the real deck contract`);
  expect(row.maxSkillCards === contract.maxSkillCards, `${label}.maxSkillCards must match the real deck contract`);
  const cardEntries = row.cardEntries as unknown[];
  const entries = cardEntries.map((entry, entryIndex) => {
    const entryLabel = `${label}.cardEntries[${entryIndex}]`;
    exactKeys(entry, ['slot', 'cardId', 'count'], entryLabel);
    expect(entry.slot === entryIndex + 1, `${entryLabel}.slot must be contiguous from 1`);
    expect(nonEmptyString(entry.cardId), `${entryLabel}.cardId is required`);
    expect(positiveInteger(entry.count), `${entryLabel}.count must be a positive integer`);
    return { slot: entry.slot, cardId: entry.cardId, count: entry.count };
  });
  return {
    sourceTarget: target,
    sourceFormat: 'cardEntries',
    sourceBuildIndex: index,
    id: row.id,
    name: row.id,
    professionId: professionId ?? row.profession,
    race: row.race,
    purposeTags: normalizePurposeTags(row.purposeTags, label),
    entries,
    ...contract,
  };
}

export function normalizeBuildDocument(target: BuildTarget, document: unknown, context: BuildContext): readonly NormalizedBuild[] {
  expect((BUILD_TARGETS as readonly string[]).includes(target), `unsupported build target ${target}`);
  exactKeys(document, getTargetDocumentKeys(target), `${target} config`);
  expect(document.schemaVersion === 1, `${target}.schemaVersion must be 1`);
  expect(document.evidenceLevel === 'C', `${target}.evidenceLevel must be C`);
  expect(document.enabled === true, `${target} config must be enabled`);
  expect(positiveInteger(document.version), `${target}.version must be a positive integer`);
  expect(Array.isArray(document.builds) && document.builds.length >= 2, `${target} must contain at least two builds`);

  let professionId: string | undefined;
  let contract: Pick<NormalizedBuild, 'totalCards' | 'minUnitCards' | 'maxSkillCards'>;
  if (target === 'P01') {
    expect(document.buildGroup === target, 'P01.buildGroup must be P01');
    expect(nonEmptyString(document.professionId), 'P01.professionId is required');
    professionId = document.professionId;
    contract = normalizeContract(document.rules, 'P01.rules');
  } else {
    expect(document.table === 'builds', `${target}.table must be builds`);
    expect(document.buildTarget === target, `${target}.buildTarget must match the file target`);
    expect(nonEmptyString(document.contractDeckId), `${target}.contractDeckId is required`);
    const contractDeckId = document.contractDeckId as string;
    const deck = context.decks.get(contractDeckId);
    expect(deck && deck.enabled !== false, `${target} references a missing or disabled deck contract ${document.contractDeckId}`);
    contract = normalizeContract(deck, `${target}.${document.contractDeckId}`, false);
    professionId = expectedProfessionForTarget(target);
  }

  if (professionId) expect(context.professions.has(professionId), `${target} references a missing profession ${professionId}`);
  const buildRows = document.builds as unknown[];
  const builds = buildRows.map((row, index) => normalizeBuildRow(target, row, index, professionId, contract));
  expect(new Set(builds.map((build) => build.id)).size === builds.length, `${target} build IDs must be unique`);
  return builds;
}

export function validateBuild(build: NormalizedBuild, context: BuildContext): BuildValidationSummary {
  exactKeys(build, [
    'sourceTarget', 'sourceFormat', 'sourceBuildIndex', 'id', 'name', 'professionId', 'race',
    'purposeTags', 'entries', 'totalCards', 'minUnitCards', 'maxSkillCards',
  ], 'normalized build');
  expect((BUILD_TARGETS as readonly string[]).includes(build.sourceTarget), `unknown build target ${build.sourceTarget}`);
  expect(build.sourceFormat === 'slots' || build.sourceFormat === 'cardEntries', 'normalized build source format is invalid');
  expect(Number.isSafeInteger(build.sourceBuildIndex) && build.sourceBuildIndex >= 0, 'normalized build source index is invalid');
  if (build.sourceTarget === 'P01') expect(build.sourceFormat === 'slots', 'P01 builds must use slot format');
  if (build.sourceTarget !== 'P01') expect(build.sourceFormat === 'cardEntries', `${build.sourceTarget} builds must use cardEntries format`);
  expect(nonEmptyString(build.id), 'build id is required');
  expect(nonEmptyString(build.name), 'build name is required');
  expect(context.professions.has(build.professionId), `unknown or disabled profession: ${build.professionId}`);
  const profession = context.professions.get(build.professionId)!;
  expect(profession.enabled !== false, `disabled profession: ${build.professionId}`);
  expect(nonEmptyString(build.race) && context.legalRaces.has(build.race), `unknown race: ${build.race}`);
  expect(Array.isArray(build.purposeTags) && build.purposeTags.length > 0 && build.purposeTags.every((tag) => nonEmptyString(tag)), 'purposeTags must not be empty');
  expect(Array.isArray(build.entries) && build.entries.length > 0, 'build entries must not be empty');
  expect(positiveInteger(build.totalCards), 'build totalCards must be a positive integer');
  expect(positiveInteger(build.minUnitCards), 'build minUnitCards must be a positive integer');
  expect(positiveInteger(build.maxSkillCards), 'build maxSkillCards must be a positive integer');
  const canonicalContract = context.decks.get('D001');
  expect(canonicalContract && canonicalContract.enabled !== false, 'real D001 deck contract is required for build validation');
  expect(build.totalCards === canonicalContract.totalCards, 'build totalCards must match the real D001 contract');
  expect(build.minUnitCards === canonicalContract.minUnitCards, 'build minUnitCards must match the real D001 contract');
  expect(build.maxSkillCards === canonicalContract.maxSkillCards, 'build maxSkillCards must match the real D001 contract');

  const expectedProfession = expectedProfessionForTarget(build.sourceTarget);
  if (expectedProfession) expect(build.professionId === expectedProfession, `${build.sourceTarget} must use ${expectedProfession}`);

  const seenSlots = new Set<number>();
  const cardCounts = new Map<string, number>();
  const unitCardIds = new Set<string>();
  const skillCardIds = new Set<string>();
  const unitRaces = new Set<string>();
  const unitRoles = new Set<string>();
  let unitCards = 0;
  let skillCards = 0;

  for (const [index, entry] of build.entries.entries()) {
    const label = `${build.id}.entries[${index}]`;
    exactKeys(entry, ['slot', 'cardId', 'count'], label);
    expect(entry.slot === index + 1, `${label}.slot must be contiguous from 1`);
    expect(!seenSlots.has(entry.slot), `duplicate slot: ${entry.slot}`);
    seenSlots.add(entry.slot);
    expect(nonEmptyString(entry.cardId), `${label}.cardId is required`);
    expect(positiveInteger(entry.count), `${label}.count must be a positive integer`);
    if (build.sourceFormat === 'slots') expect(entry.count === 1, `${label}.count must be 1 for a slot-based build`);
    if (build.sourceFormat === 'cardEntries') expect(!cardCounts.has(entry.cardId), `duplicate card entry: ${entry.cardId}`);

    const card = context.cards.get(entry.cardId);
    expect(card && card.enabled !== false, `unknown or disabled card: ${entry.cardId}`);
    expect(positiveInteger(card.copyLimit), `${entry.cardId} has an invalid copyLimit`);
    expect(positiveInteger(card.prepare), `${entry.cardId} has an invalid prepare value`);
    const nextCount = (cardCounts.get(entry.cardId) ?? 0) + entry.count;
    expect(nextCount <= card.copyLimit, `${entry.cardId} exceeds copyLimit ${card.copyLimit}`);
    cardCounts.set(entry.cardId, nextCount);

    if (card.cardType === 'UNIT') {
      expect(card.unitId === card.id, `${entry.cardId} must reference its real unit id`);
      const unit = context.units.get(card.unitId);
      expect(unit && unit.enabled !== false, `${entry.cardId} references a missing or disabled unit`);
      expect(unit.footprintCells === 1, `${entry.cardId} is not deployable from a build`);
      expect(unit.race === card.race && unit.race !== 'NONE', `${entry.cardId} race must match its real unit`);
      expect(positiveInteger(unit.maxHp) && unit.attack >= 0, `${entry.cardId} has invalid combat attributes`);
      unitCards += entry.count;
      unitCardIds.add(entry.cardId);
      unitRaces.add(unit.race);
      unitRoles.add(unit.role);
    } else if (card.cardType === 'SKILL') {
      expect(card.skillId === card.id, `${entry.cardId} must reference its real skill id`);
      expect(card.race === 'NONE', `${entry.cardId} skill cards must not declare a race`);
      const skill = context.skills.get(card.skillId);
      expect(skill && skill.enabled !== false, `${entry.cardId} references a missing or disabled skill`);
      expect(Array.isArray(skill.effectIds) && skill.effectIds.length > 0, `${entry.cardId} must expose real effects`);
      expect(profession.skillIds.includes(skill.id), `${entry.cardId} is not allowed for ${build.professionId}`);
      skillCards += entry.count;
      skillCardIds.add(entry.cardId);
    } else {
      fail(`unsupported card type: ${card.cardType}`);
    }
  }

  expect(unitCards + skillCards === build.totalCards, `${build.id} card counts must equal totalCards`);
  expect(unitCards >= build.minUnitCards, `${build.id} unit cards must be at least ${build.minUnitCards}`);
  expect(skillCards <= build.maxSkillCards, `${build.id} skill cards must be at most ${build.maxSkillCards}`);
  expect(unitRaces.has(build.race), `${build.id} must contain its declared race ${build.race}`);
  expect(seenSlots.size === build.entries.length, `${build.id} contains duplicate slots`);

  return {
    build,
    unitCards,
    skillCards,
    slotCount: seenSlots.size,
    uniqueCardCount: cardCounts.size,
    cardCounts,
    unitCardIds: [...unitCardIds].sort(),
    skillCardIds: [...skillCardIds].sort(),
    unitRaces: [...unitRaces].sort(),
    unitRoles: [...unitRoles].sort(),
  };
}

function increment(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export function validateBuildCorpus(input: { documents: readonly BuildDocumentInput[]; context: BuildContext }): BuildCorpusValidation {
  const { documents, context } = input;
  expect(documents.length === BUILD_TARGETS.length, `expected ${BUILD_TARGETS.length} build target documents`);
  const targets = new Set<BuildTarget>();
  const builds: NormalizedBuild[] = [];
  for (const item of documents) {
    expect(!targets.has(item.target), `duplicate build target ${item.target}`);
    targets.add(item.target);
    builds.push(...normalizeBuildDocument(item.target, item.document, context));
  }
  for (const target of BUILD_TARGETS) expect(targets.has(target), `missing build target ${target}`);

  const ids = new Set<string>();
  const summaries = builds.map((build) => {
    expect(!ids.has(build.id), `duplicate build id across real build tables: ${build.id}`);
    ids.add(build.id);
    return validateBuild(build, context);
  });

  const professionCounts = new Map<string, number>();
  const raceCounts = new Map<string, number>();
  const declaredRaceCounts = new Map<string, number>();
  const targetCounts = new Map<BuildTarget, number>();
  for (const [index, build] of builds.entries()) {
    const summary = summaries[index];
    increment(professionCounts, build.professionId);
    increment(declaredRaceCounts, build.race);
    for (const race of summary.unitRaces) increment(raceCounts, race);
    increment(targetCounts, build.sourceTarget);
  }
  const professionIds = [...context.professions.values()]
    .filter((profession) => profession.enabled !== false)
    .map((profession) => profession.id)
    .sort();
  const races = [...context.legalRaces].sort();
  expect(professionIds.length === 4, `expected four enabled professions, got ${professionIds.length}`);
  expect(races.length === 7, `expected seven legal races, got ${races.length}`);
  for (const professionId of professionIds) expect((professionCounts.get(professionId) ?? 0) >= 2, `${professionId} must have at least two valid builds`);
  for (const race of races) expect((raceCounts.get(race) ?? 0) >= 2, `${race} must have at least two valid builds`);
  for (const target of BUILD_TARGETS) expect((targetCounts.get(target) ?? 0) >= 2, `${target} must contain at least two valid builds`);

  return {
    builds,
    summaries,
    coverage: { professionCounts, raceCounts, declaredRaceCounts, targetCounts },
    professionIds,
    races,
  };
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function nextRandom(state: { value: number }): number {
  state.value = (state.value + 0x6D2B79F5) | 0;
  let value = Math.imul(state.value ^ (state.value >>> 15), 1 | state.value);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function shuffled<T>(values: readonly T[], seed: number, buildId: string): T[] {
  const result = [...values];
  const state = { value: hashString(`${seed}:${buildId}`) | 0 };
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextRandom(state) * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function replayHash(events: readonly SimulationEvent[]): string {
  return hashString(JSON.stringify(events)).toString(16).padStart(8, '0');
}

function playScore(card: CardDefinition, context: BuildContext, declaredRace: string): number {
  if (card.cardType === 'UNIT') {
    const unit = context.units.get(card.unitId!);
    if (!unit) return -1;
    const raceBonus = unit.race === declaredRace ? 100 : 0;
    return 1000 + raceBonus + unit.attack * 10 + unit.maxHp - card.prepare;
  }
  const skill = context.skills.get(card.skillId!);
  return 500 + (skill?.effectIds.length ?? 0) * 10 - card.prepare;
}

export function simulateBuild(build: NormalizedBuild, context: BuildContext, options: SimulationOptions = {}): BuildSimulationResult {
  const summary = validateBuild(build, context);
  const rounds = options.rounds ?? 8;
  const openingHandSize = options.openingHandSize ?? 5;
  const drawPerRound = options.drawPerRound ?? 1;
  const preparePointsPerRound = options.preparePointsPerRound ?? 4;
  const handLimit = options.handLimit ?? 7;
  const seed = options.seed ?? 1;
  expect(positiveInteger(rounds), 'simulation rounds must be a positive integer');
  expect(positiveInteger(openingHandSize), 'simulation openingHandSize must be a positive integer');
  expect(positiveInteger(drawPerRound), 'simulation drawPerRound must be a positive integer');
  expect(positiveInteger(preparePointsPerRound), 'simulation preparePointsPerRound must be a positive integer');
  expect(positiveInteger(handLimit), 'simulation handLimit must be a positive integer');
  expect(Number.isSafeInteger(seed), 'simulation seed must be an integer');

  const deck = build.entries.flatMap((entry) => Array.from({ length: entry.count }, () => entry.cardId));
  const shuffledDeck = shuffled(deck, seed, build.id);
  const hand: string[] = [];
  const events: SimulationEvent[] = [];
  const deployedRaces = new Set<string>();
  const deployedRoles = new Set<string>();
  let deckIndex = 0;
  let drawnCards = 0;
  let deployedUnits = 0;
  let castSkills = 0;
  let totalAttack = 0;
  let totalMaxHp = 0;
  let effectApplications = 0;

  function draw(round: number, count: number): void {
    for (let drawIndex = 0; drawIndex < count && deckIndex < shuffledDeck.length; drawIndex += 1) {
      const cardId = shuffledDeck[deckIndex];
      deckIndex += 1;
      drawnCards += 1;
      hand.push(cardId);
      events.push({ round, type: 'DRAW', cardId, remainingPrepare: 0 });
    }
  }

  draw(0, openingHandSize);
  for (let round = 1; round <= rounds; round += 1) {
    draw(round, drawPerRound);
    while (hand.length > handLimit) {
      const discarded = hand.shift()!;
      events.push({ round, type: 'DISCARD', cardId: discarded, remainingPrepare: 0 });
    }

    let remainingPrepare = preparePointsPerRound;
    while (remainingPrepare > 0) {
      const playable = hand
        .map((cardId, index) => ({ cardId, index, card: context.cards.get(cardId)! }))
        .filter(({ card }) => card.prepare <= remainingPrepare)
        .sort((left, right) => playScore(right.card, context, build.race) - playScore(left.card, context, build.race));
      const selected = playable[0];
      if (!selected) break;
      hand.splice(selected.index, 1);
      remainingPrepare -= selected.card.prepare;
      if (selected.card.cardType === 'UNIT') {
        const unit = context.units.get(selected.card.unitId!)!;
        deployedUnits += 1;
        totalAttack += unit.attack;
        totalMaxHp += unit.maxHp;
        deployedRaces.add(unit.race);
        deployedRoles.add(unit.role);
        events.push({ round, type: 'DEPLOY_UNIT', cardId: selected.cardId, remainingPrepare });
      } else {
        const skill = context.skills.get(selected.card.skillId!)!;
        castSkills += 1;
        effectApplications += skill.effectIds.length;
        events.push({ round, type: 'CAST_SKILL', cardId: selected.cardId, remainingPrepare });
      }
    }
  }

  expect(drawnCards <= deck.length, `${build.id} simulation drew more cards than its real deck`);
  expect(deployedUnits <= summary.unitCards, `${build.id} simulation deployed more units than its real deck`);
  expect(castSkills <= summary.skillCards, `${build.id} simulation cast more skills than its real deck`);
  return {
    buildId: build.id,
    seed,
    rounds,
    deckSize: deck.length,
    drawnCards,
    deployedUnits,
    castSkills,
    totalAttack,
    totalMaxHp,
    effectApplications,
    deployedRaces: [...deployedRaces].sort(),
    deployedRoles: [...deployedRoles].sort(),
    remainingDeck: deck.length - deckIndex,
    replayHash: replayHash(events),
    events,
  };
}

export function simulateBuildAcrossSeeds(
  build: NormalizedBuild,
  context: BuildContext,
  seeds: readonly number[] = [11, 29, 47],
  options: Omit<SimulationOptions, 'seed'> = {},
): MultiSeedSimulationResult {
  expect(seeds.length > 0, 'at least one simulation seed is required');
  const runs = seeds.map((seed) => simulateBuild(build, context, { ...options, seed }));
  const rerun = seeds.map((seed) => simulateBuild(build, context, { ...options, seed }));
  const deterministic = runs.every((run, index) => JSON.stringify(run) === JSON.stringify(rerun[index]));
  expect(deterministic, `${build.id} simulation is not deterministic for the same seed`);
  return { buildId: build.id, runs, deterministic };
}
