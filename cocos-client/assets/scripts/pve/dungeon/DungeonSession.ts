export const DUNGEON_SESSION_SCHEMA_VERSION = 1 as const;
export const DUNGEON_STAGE_COUNT = 3 as const;
export const DUNGEON_STAGE_IDS = Object.freeze(['DUNGEON-01', 'DUNGEON-02', 'DUNGEON-03']);

export type DungeonSessionStatus = 'idle' | 'active' | 'lost' | 'won';
export type DungeonStageStatus = 'pending' | 'active' | 'lost' | 'completed';

export type DungeonUnitState = Readonly<{
  id: string;
  hp: number;
  maxHp: number;
}>;

export type DungeonStageState = Readonly<{
  id: string;
  status: DungeonStageStatus;
  heroHp: number;
  units: readonly DungeonUnitState[];
  attempts: number;
}>;

export type DungeonSessionState = Readonly<{
  schemaVersion: typeof DUNGEON_SESSION_SCHEMA_VERSION;
  sessionId: string;
  status: DungeonSessionStatus;
  stageIndex: number;
  lockedDeckId: string | null;
  lockedCardIds: readonly string[];
  stages: readonly DungeonStageState[];
}>;

export type DungeonSessionPersistence = (serialized: string) => void;

export type DungeonBattleResult = Readonly<{
  outcome: 'won' | 'lost';
  heroHp: number;
  units: readonly DungeonUnitState[];
}>;

export type DungeonSessionOptions = Readonly<{
  sessionId?: string;
  stageIds?: readonly string[];
  persist?: DungeonSessionPersistence;
  initialState?: string;
}>;

export type DungeonSessionErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_TRANSITION'
  | 'DECK_LOCKED'
  | 'SESSION_SETTLED'
  | 'PERSISTENCE_FAILED';

export class DungeonSessionError extends Error {
  readonly code: DungeonSessionErrorCode;

  constructor(code: DungeonSessionErrorCode, message: string) {
    super(message);
    this.name = 'DungeonSessionError';
    this.code = code;
  }
}
function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clone(item)])) as T;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code: DungeonSessionErrorCode, message: string): never {
  throw new DungeonSessionError(code, message);
}

function assertTrimmedString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    fail('INVALID_CONFIG', `${path} must be a trimmed non-empty string`);
  }
}

function assertHp(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('INVALID_STATE', `${path} must be a non-negative safe integer`);
}

function assertUnits(units: unknown, path: string): asserts units is readonly DungeonUnitState[] {
  if (!Array.isArray(units)) fail('INVALID_STATE', `${path} must be an array`);
  const ids = new Set<string>();
  units.forEach((unit, index) => {
    if (unit === null || typeof unit !== 'object' || Array.isArray(unit)) fail('INVALID_STATE', `${path}[${index}] must be an object`);
    const candidate = unit as Record<string, unknown>;
    assertTrimmedString(candidate.id, `${path}[${index}].id`);
    if (ids.has(candidate.id)) fail('INVALID_STATE', `${path} contains duplicate unit id ${candidate.id}`);
    ids.add(candidate.id);
    assertHp(candidate.hp, `${path}[${index}].hp`);
    assertHp(candidate.maxHp, `${path}[${index}].maxHp`);
    if ((candidate.hp as number) > (candidate.maxHp as number)) fail('INVALID_STATE', `${path}[${index}].hp exceeds maxHp`);
  });
}

function validateState(state: unknown, expectedStageIds: readonly string[]): asserts state is DungeonSessionState {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) fail('INVALID_STATE', 'session state must be an object');
  const raw = state as Record<string, unknown>;
  if (raw.schemaVersion !== DUNGEON_SESSION_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported dungeon session schema version');
  assertTrimmedString(raw.sessionId, 'sessionId');
  if (!['idle', 'active', 'lost', 'won'].includes(String(raw.status))) fail('INVALID_STATE', 'session status is invalid');
  if (!Number.isSafeInteger(raw.stageIndex) || (raw.stageIndex as number) < 0 || (raw.stageIndex as number) > expectedStageIds.length) {
    fail('INVALID_STATE', 'stageIndex is invalid');
  }
  if (raw.lockedDeckId !== null) assertTrimmedString(raw.lockedDeckId, 'lockedDeckId');
  if (!Array.isArray(raw.lockedCardIds) || raw.lockedCardIds.length === 0 && raw.lockedDeckId !== null) fail('INVALID_STATE', 'lockedCardIds is invalid');
  raw.lockedCardIds.forEach((cardId, index) => assertTrimmedString(cardId, `lockedCardIds[${index}]`));
  if (!Array.isArray(raw.stages) || raw.stages.length !== expectedStageIds.length) fail('INVALID_STATE', 'stages must match configured stage count');
  const stageIds = raw.stages.map((stage) => (stage as Record<string, unknown>).id);
  if (stageIds.some((id, index) => id !== expectedStageIds[index])) fail('INVALID_STATE', 'stage ids do not match configuration');
  raw.stages.forEach((stage, index) => {
    if (stage === null || typeof stage !== 'object' || Array.isArray(stage)) fail('INVALID_STATE', `stages[${index}] is invalid`);
    const candidate = stage as Record<string, unknown>;
    if (!['pending', 'active', 'lost', 'completed'].includes(String(candidate.status))) fail('INVALID_STATE', `stages[${index}].status is invalid`);
    assertHp(candidate.heroHp, `stages[${index}].heroHp`);
    assertUnits(candidate.units, `stages[${index}].units`);
    if (!Number.isSafeInteger(candidate.attempts) || (candidate.attempts as number) < 0) fail('INVALID_STATE', `stages[${index}].attempts is invalid`);
  });
  const activeStages = raw.stages.filter((stage) => (stage as Record<string, unknown>).status === 'active').length;
  if (raw.status === 'active' && activeStages !== 1) fail('INVALID_STATE', 'active session must have exactly one active stage');
  if (raw.status !== 'active' && activeStages !== 0) fail('INVALID_STATE', 'settled or idle session cannot have an active stage');
}

function makeStages(stageIds: readonly string[], heroHp = 0, units: readonly DungeonUnitState[] = []): readonly DungeonStageState[] {
  return stageIds.map((id, index) => ({
    id,
    status: index === 0 && heroHp > 0 ? 'active' : 'pending',
    heroHp,
    units: clone(units),
    attempts: 0,
  }));
}

function defaultState(sessionId: string, stageIds: readonly string[]): DungeonSessionState {
  return freezeDeep({
    schemaVersion: DUNGEON_SESSION_SCHEMA_VERSION,
    sessionId,
    status: 'idle',
    stageIndex: 0,
    lockedDeckId: null,
    lockedCardIds: [],
    stages: makeStages(stageIds),
  });
}

export function serializeDungeonSession(state: DungeonSessionState): string {
  return JSON.stringify(state);
}

export function restoreDungeonSession(serialized: string, stageIds: readonly string[] = DUNGEON_STAGE_IDS): DungeonSessionState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'dungeon session save is not valid JSON');
  }
  validateState(parsed, stageIds);
  return freezeDeep(clone(parsed));
}

export class DungeonSessionService {
  private readonly stageIds: readonly string[];
  private readonly persist: DungeonSessionPersistence;
  private current: DungeonSessionState;

  constructor(options: DungeonSessionOptions = {}) {
    const stageIds = options.stageIds ?? DUNGEON_STAGE_IDS;
    if (stageIds.length !== DUNGEON_STAGE_COUNT || new Set(stageIds).size !== stageIds.length) fail('INVALID_CONFIG', 'dungeon requires three unique stage ids');
    stageIds.forEach((id, index) => assertTrimmedString(id, `stageIds[${index}]`));
    this.stageIds = Object.freeze([...stageIds]);
    this.persist = options.persist ?? (() => {});
    this.current = options.initialState === undefined
      ? defaultState(options.sessionId ?? 'dungeon-session', this.stageIds)
      : restoreDungeonSession(options.initialState, this.stageIds);
  }

  snapshot(): DungeonSessionState {
    return this.current;
  }

  save(): string {
    return serializeDungeonSession(this.current);
  }

  private commit(next: DungeonSessionState): void {
    try {
      this.persist(serializeDungeonSession(next));
    } catch (error) {
      fail('PERSISTENCE_FAILED', error instanceof Error ? error.message : String(error));
    }
    this.current = freezeDeep(clone(next));
  }

  start(deckId: string, cardIds: readonly string[], heroHp = 30, units: readonly DungeonUnitState[] = []): DungeonSessionState {
    if (this.current.status !== 'idle') fail('INVALID_TRANSITION', 'dungeon session has already started');
    assertTrimmedString(deckId, 'deckId');
    if (!Array.isArray(cardIds) || cardIds.length === 0) fail('INVALID_CONFIG', 'locked deck must contain cards');
    cardIds.forEach((cardId, index) => assertTrimmedString(cardId, `cardIds[${index}]`));
    assertHp(heroHp, 'heroHp');
    if (heroHp === 0) fail('INVALID_CONFIG', 'heroHp must be positive when starting a session');
    assertUnits(units, 'units');
    const next: DungeonSessionState = {
      ...this.current,
      status: 'active',
      lockedDeckId: deckId,
      lockedCardIds: [...cardIds],
      stages: makeStages(this.stageIds, heroHp, units),
    };
    this.commit(next);
    return this.current;
  }

  replaceDeck(deckId: string, cardIds: readonly string[]): never {
    if (this.current.lockedDeckId !== null) fail('DECK_LOCKED', 'dungeon deck is locked for the whole session');
    return this.start(deckId, cardIds);
  }

  completeBattle(result: DungeonBattleResult): DungeonSessionState {
    if (this.current.status !== 'active') fail(this.current.status === 'won' || this.current.status === 'lost' ? 'SESSION_SETTLED' : 'INVALID_TRANSITION', 'dungeon session is not in an active battle');
    if (result.outcome !== 'won' && result.outcome !== 'lost') fail('INVALID_CONFIG', 'battle outcome is invalid');
    assertHp(result.heroHp, 'result.heroHp');
    assertUnits(result.units, 'result.units');
    const stages = this.current.stages.map((stage) => ({ ...stage, units: [...stage.units] }));
    const currentStage = stages[this.current.stageIndex];
    if (!currentStage || currentStage.status !== 'active') fail('INVALID_STATE', 'current dungeon stage is not active');
    const updatedStage = { ...currentStage, heroHp: result.heroHp, units: clone(result.units), attempts: currentStage.attempts + 1, status: result.outcome === 'won' ? 'completed' : 'lost' } as DungeonStageState;
    stages[this.current.stageIndex] = updatedStage;
    if (result.outcome === 'lost') {
      this.commit({ ...this.current, status: 'lost', stages });
      return this.current;
    }
    const nextIndex = this.current.stageIndex + 1;
    if (nextIndex >= this.stageIds.length) {
      this.commit({ ...this.current, status: 'won', stageIndex: this.stageIds.length, stages });
      return this.current;
    }
    const nextStage = stages[nextIndex];
    stages[nextIndex] = { ...nextStage, status: 'active', heroHp: result.heroHp, units: clone(result.units) };
    this.commit({ ...this.current, stageIndex: nextIndex, stages });
    return this.current;
  }

  retry(): DungeonSessionState {
    if (this.current.status !== 'lost') fail('INVALID_TRANSITION', 'only a lost dungeon can be retried');
    const retryIndex = this.current.stageIndex;
    const previous = retryIndex > 0 ? this.current.stages[retryIndex - 1] : undefined;
    const retryStage = this.current.stages[retryIndex];
    const heroHp = previous?.heroHp ?? retryStage.heroHp;
    const units = previous?.units ?? retryStage.units;
    const stages = this.current.stages.map((stage, index) => ({
      ...stage,
      status: index < retryIndex ? stage.status : index === retryIndex ? 'active' : 'pending',
      heroHp: index === retryIndex ? heroHp : stage.heroHp,
      units: index === retryIndex ? clone(units) : stage.units,
    }));
    this.commit({ ...this.current, status: 'active', stages });
    return this.current;
  }
}
