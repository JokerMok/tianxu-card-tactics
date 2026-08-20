export const DUNGEON_DIFFICULTY_SCHEMA_VERSION = 1 as const;
export const DUNGEON_DIFFICULTY_STAGE_COUNT = 3 as const;
export const DUNGEON_DIFFICULTY_IDS = Object.freeze(['NORMAL', 'HARD'] as const);

export type DungeonDifficultyId = (typeof DUNGEON_DIFFICULTY_IDS)[number];
export type DungeonRunOutcome = 'won' | 'lost';

export type DungeonReward = Readonly<{
  id: string;
  quantity: number;
}>;

export type DungeonEnemySpec = Readonly<{
  id: string;
  hp: number;
  attack: number;
  defense: number;
}>;

export type DungeonDifficultyStage = Readonly<{
  id: string;
  enemy: DungeonEnemySpec;
}>;

export type DungeonDifficultyUnlock = Readonly<{
  type: 'always' | 'clearCount';
  difficultyId?: DungeonDifficultyId;
  minimumClears?: number;
}>;

export type DungeonDifficultyDefinition = Readonly<{
  id: DungeonDifficultyId;
  displayName: string;
  attemptLimit: number;
  unlock: DungeonDifficultyUnlock;
  stages: readonly DungeonDifficultyStage[];
  firstClearRewards: readonly DungeonReward[];
  repeatClearRewards: readonly DungeonReward[];
}>;

export type DungeonDifficultyConfig = readonly DungeonDifficultyDefinition[];

export type DungeonDifficultyProgress = Readonly<{
  difficultyId: DungeonDifficultyId;
  unlocked: boolean;
  attemptsUsed: number;
  attemptsRemaining: number;
  clearCount: number;
  lastOutcome: DungeonRunOutcome | null;
  activeRunId: string | null;
}>;

export type DungeonDifficultyRun = Readonly<{
  runId: string;
  difficultyId: DungeonDifficultyId;
  attemptNumber: number;
  stageIndex: number;
  stages: readonly DungeonDifficultyStage[];
}>;

export type DungeonDifficultySnapshot = Readonly<{
  schemaVersion: typeof DUNGEON_DIFFICULTY_SCHEMA_VERSION;
  nextRunNumber: number;
  difficulties: readonly DungeonDifficultyProgress[];
  activeRuns: readonly DungeonDifficultyRun[];
  settledRunIds: readonly string[];
}>;

export type DungeonDifficultySettlement = Readonly<{
  runId: string;
  difficultyId: DungeonDifficultyId;
  outcome: DungeonRunOutcome;
  firstClear: boolean;
  rewards: readonly DungeonReward[];
  attemptsRemaining: number;
  unlocked: boolean;
}>;

export type DungeonDifficultyPersistence = (serialized: string) => void;

export type DungeonDifficultyServiceOptions = Readonly<{
  config?: DungeonDifficultyConfig;
  initialState?: string;
  persist?: DungeonDifficultyPersistence;
}>;

export type DungeonDifficultyErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'UNKNOWN_DIFFICULTY'
  | 'DIFFICULTY_LOCKED'
  | 'ATTEMPTS_EXHAUSTED'
  | 'RUN_ACTIVE'
  | 'RUN_NOT_FOUND'
  | 'RUN_SETTLED'
  | 'INVALID_OUTCOME'
  | 'INVALID_STAGE'
  | 'PERSISTENCE_FAILED';

export class DungeonDifficultyError extends Error {
  readonly code: DungeonDifficultyErrorCode;

  constructor(code: DungeonDifficultyErrorCode, message: string) {
    super(message);
    this.name = 'DungeonDifficultyError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function fail(code: DungeonDifficultyErrorCode, message: string): never {
  throw new DungeonDifficultyError(code, message);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) fail('INVALID_CONFIG', `${path} contains unknown field ${key}`);
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('INVALID_CONFIG', `${path}.${key} is required`);
  }
}

function exactStateKeys(value: Record<string, unknown>, expected: readonly string[], path: string): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) fail('INVALID_STATE', `${path} contains unknown field ${key}`);
  }
  for (const key of expected) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) fail('INVALID_STATE', `${path}.${key} is required`);
  }
}

function assertTrimmedString(value: unknown, path: string, code: DungeonDifficultyErrorCode = 'INVALID_CONFIG'): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(code, `${path} must be a trimmed non-empty string`);
}

function assertSafeInteger(value: unknown, path: string, minimum: number, code: DungeonDifficultyErrorCode = 'INVALID_CONFIG'): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) fail(code, `${path} must be a safe integer >= ${minimum}`);
}

type ParsedDungeonRunId = Readonly<{
  difficultyId: DungeonDifficultyId;
  runNumber: number;
}>;

function dungeonRunId(difficultyId: DungeonDifficultyId, runNumber: number): string {
  return `dungeon-${difficultyId.toLowerCase()}-${runNumber}`;
}

function parseDungeonRunId(runId: string, path: string): ParsedDungeonRunId {
  const match = /^dungeon-(normal|hard)-([1-9]\d*)$/.exec(runId);
  if (!match) fail('INVALID_STATE', `${path} must be a generated dungeon run id`);
  const runNumber = Number(match[2]);
  if (!Number.isSafeInteger(runNumber) || String(runNumber) !== match[2]) {
    fail('INVALID_STATE', `${path} must contain a safe run number`);
  }
  return {
    difficultyId: match[1].toUpperCase() as DungeonDifficultyId,
    runNumber,
  };
}

function assertRewardList(value: unknown, path: string): asserts value is readonly DungeonReward[] {
  if (!Array.isArray(value) || value.length === 0) fail('INVALID_CONFIG', `${path} must be a non-empty array`);
  const ids = new Set<string>();
  value.forEach((reward, index) => {
    if (!isRecord(reward)) fail('INVALID_CONFIG', `${path}[${index}] must be an object`);
    exactKeys(reward, ['id', 'quantity'], `${path}[${index}]`);
    assertTrimmedString(reward.id, `${path}[${index}].id`);
    assertSafeInteger(reward.quantity, `${path}[${index}].quantity`, 1);
    if (ids.has(reward.id)) fail('INVALID_CONFIG', `${path} contains duplicate reward id ${reward.id}`);
    ids.add(reward.id);
  });
}

function assertEnemy(value: unknown, path: string): asserts value is DungeonEnemySpec {
  if (!isRecord(value)) fail('INVALID_CONFIG', `${path} must be an object`);
  exactKeys(value, ['id', 'hp', 'attack', 'defense'], path);
  assertTrimmedString(value.id, `${path}.id`);
  assertSafeInteger(value.hp, `${path}.hp`, 1);
  assertSafeInteger(value.attack, `${path}.attack`, 0);
  assertSafeInteger(value.defense, `${path}.defense`, 0);
}

function assertStage(value: unknown, path: string): asserts value is DungeonDifficultyStage {
  if (!isRecord(value)) fail('INVALID_CONFIG', `${path} must be an object`);
  exactKeys(value, ['id', 'enemy'], path);
  assertTrimmedString(value.id, `${path}.id`);
  assertEnemy(value.enemy, `${path}.enemy`);
}

function assertUnlock(value: unknown, path: string): asserts value is DungeonDifficultyUnlock {
  if (!isRecord(value)) fail('INVALID_CONFIG', `${path} must be an object`);
  const type = value.type;
  if (type === 'always') {
    exactKeys(value, ['type'], path);
    return;
  }
  if (type === 'clearCount') {
    exactKeys(value, ['type', 'difficultyId', 'minimumClears'], path);
    if (!DUNGEON_DIFFICULTY_IDS.includes(value.difficultyId as DungeonDifficultyId)) {
      fail('INVALID_CONFIG', `${path}.difficultyId must reference a supported difficulty`);
    }
    assertSafeInteger(value.minimumClears, `${path}.minimumClears`, 1);
    return;
  }
  fail('INVALID_CONFIG', `${path}.type must be always or clearCount`);
}

function assertConfigShape(config: unknown): asserts config is DungeonDifficultyConfig {
  if (!Array.isArray(config) || config.length !== DUNGEON_DIFFICULTY_IDS.length) {
    fail('INVALID_CONFIG', `config must contain exactly ${DUNGEON_DIFFICULTY_IDS.length} difficulties`);
  }

  const ids = new Set<string>();
  const enemyIds = new Set<string>();
  const stageIds: string[] = [];
  config.forEach((definition, difficultyIndex) => {
    const path = `config[${difficultyIndex}]`;
    if (!isRecord(definition)) fail('INVALID_CONFIG', `${path} must be an object`);
    exactKeys(definition, ['id', 'displayName', 'attemptLimit', 'unlock', 'stages', 'firstClearRewards', 'repeatClearRewards'], path);
    if (!DUNGEON_DIFFICULTY_IDS.includes(definition.id as DungeonDifficultyId)) {
      fail('INVALID_CONFIG', `${path}.id is not a supported difficulty`);
    }
    if (ids.has(definition.id as string)) fail('INVALID_CONFIG', `config contains duplicate difficulty ${definition.id}`);
    ids.add(definition.id as string);
    assertTrimmedString(definition.displayName, `${path}.displayName`);
    assertSafeInteger(definition.attemptLimit, `${path}.attemptLimit`, 1);
    assertUnlock(definition.unlock, `${path}.unlock`);
    if (!Array.isArray(definition.stages) || definition.stages.length !== DUNGEON_DIFFICULTY_STAGE_COUNT) {
      fail('INVALID_CONFIG', `${path}.stages must contain exactly ${DUNGEON_DIFFICULTY_STAGE_COUNT} stages`);
    }
    const localStageIds = new Set<string>();
    definition.stages.forEach((stage, stageIndex) => {
      assertStage(stage, `${path}.stages[${stageIndex}]`);
      if (localStageIds.has(stage.id)) fail('INVALID_CONFIG', `${path}.stages contains duplicate stage ${stage.id}`);
      localStageIds.add(stage.id);
      if (enemyIds.has(stage.enemy.id)) fail('INVALID_CONFIG', `config contains duplicate enemy id ${stage.enemy.id}`);
      enemyIds.add(stage.enemy.id);
      if (difficultyIndex === 0) stageIds.push(stage.id);
      else if (stage.id !== stageIds[stageIndex]) fail('INVALID_CONFIG', 'difficulty stage ids must match in order');
    });
    assertRewardList(definition.firstClearRewards, `${path}.firstClearRewards`);
    assertRewardList(definition.repeatClearRewards, `${path}.repeatClearRewards`);
  });

  for (const difficultyId of DUNGEON_DIFFICULTY_IDS) {
    if (!ids.has(difficultyId)) fail('INVALID_CONFIG', `config is missing difficulty ${difficultyId}`);
  }
  if (!config.some((definition) => (definition.unlock as DungeonDifficultyUnlock).type === 'always')) {
    fail('INVALID_CONFIG', 'config must contain at least one always-unlocked difficulty');
  }
  config.forEach((definition, index) => {
    const unlock = definition.unlock as DungeonDifficultyUnlock;
    if (unlock.type === 'clearCount' && unlock.difficultyId === definition.id) {
      fail('INVALID_CONFIG', `config[${index}].unlock cannot depend on itself`);
    }
  });
}

function normalizeConfig(config: unknown): DungeonDifficultyConfig {
  assertConfigShape(config);
  return freezeDeep(clone(config));
}

export function validateDungeonDifficultyConfig(config: unknown): asserts config is DungeonDifficultyConfig {
  normalizeConfig(config);
}

const DEFAULT_CONFIG: DungeonDifficultyConfig = [
  {
    id: 'NORMAL',
    displayName: '普通',
    attemptLimit: 3,
    unlock: { type: 'always' },
    stages: [
      { id: 'DUNGEON-01', enemy: { id: 'normal-forest-scout', hp: 90, attack: 12, defense: 3 } },
      { id: 'DUNGEON-02', enemy: { id: 'normal-ruin-guard', hp: 115, attack: 15, defense: 5 } },
      { id: 'DUNGEON-03', enemy: { id: 'normal-depth-lord', hp: 150, attack: 20, defense: 7 } },
    ],
    firstClearRewards: [
      { id: 'gold', quantity: 180 },
      { id: 'dungeon-token-normal', quantity: 1 },
    ],
    repeatClearRewards: [{ id: 'gold', quantity: 60 }],
  },
  {
    id: 'HARD',
    displayName: '困难',
    attemptLimit: 2,
    unlock: { type: 'clearCount', difficultyId: 'NORMAL', minimumClears: 1 },
    stages: [
      { id: 'DUNGEON-01', enemy: { id: 'hard-forest-stalker', hp: 150, attack: 19, defense: 6 } },
      { id: 'DUNGEON-02', enemy: { id: 'hard-ruin-executor', hp: 190, attack: 24, defense: 9 } },
      { id: 'DUNGEON-03', enemy: { id: 'hard-abyssal-lord', hp: 250, attack: 32, defense: 12 } },
    ],
    firstClearRewards: [
      { id: 'gold', quantity: 420 },
      { id: 'dungeon-token-hard', quantity: 2 },
    ],
    repeatClearRewards: [{ id: 'gold', quantity: 140 }],
  },
];

export const DEFAULT_DUNGEON_DIFFICULTY_CONFIG = freezeDeep(clone(DEFAULT_CONFIG));
export const DUNGEON_DIFFICULTY_CONFIG = DEFAULT_DUNGEON_DIFFICULTY_CONFIG;

type PersistedProgress = Readonly<{
  difficultyId: DungeonDifficultyId;
  attemptsUsed: number;
  clearCount: number;
  lastOutcome: DungeonRunOutcome | null;
  activeRunId: string | null;
}>;

type PersistedRun = Readonly<{
  runId: string;
  difficultyId: DungeonDifficultyId;
  attemptNumber: number;
}>;

type PersistedState = Readonly<{
  schemaVersion: typeof DUNGEON_DIFFICULTY_SCHEMA_VERSION;
  nextRunNumber: number;
  progress: readonly PersistedProgress[];
  activeRuns: readonly PersistedRun[];
  settledRunIds: readonly string[];
}>;

function defaultState(config: DungeonDifficultyConfig): PersistedState {
  return {
    schemaVersion: DUNGEON_DIFFICULTY_SCHEMA_VERSION,
    nextRunNumber: 1,
    progress: config.map(({ id }) => ({
      difficultyId: id,
      attemptsUsed: 0,
      clearCount: 0,
      lastOutcome: null,
      activeRunId: null,
    })),
    activeRuns: [],
    settledRunIds: [],
  };
}

function assertDifficultyId(value: unknown, path: string, code: DungeonDifficultyErrorCode = 'UNKNOWN_DIFFICULTY'): asserts value is DungeonDifficultyId {
  if (!DUNGEON_DIFFICULTY_IDS.includes(value as DungeonDifficultyId)) fail(code, `${path} is not a supported dungeon difficulty`);
}

function parseState(serialized: string, config: DungeonDifficultyConfig): PersistedState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'dungeon difficulty state is not valid JSON');
  }
  if (!isRecord(parsed)) fail('INVALID_STATE', 'dungeon difficulty state must be an object');
  exactStateKeys(parsed, ['schemaVersion', 'nextRunNumber', 'progress', 'activeRuns', 'settledRunIds'], 'state');
  if (parsed.schemaVersion !== DUNGEON_DIFFICULTY_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported dungeon difficulty schema version');
  assertSafeInteger(parsed.nextRunNumber, 'state.nextRunNumber', 1, 'INVALID_STATE');
  if (!Array.isArray(parsed.progress) || parsed.progress.length !== config.length) fail('INVALID_STATE', 'state.progress must match configured difficulties');
  const ids = new Set<string>();
  parsed.progress.forEach((progress, index) => {
    const path = `state.progress[${index}]`;
    if (!isRecord(progress)) fail('INVALID_STATE', `${path} must be an object`);
    exactStateKeys(progress, ['difficultyId', 'attemptsUsed', 'clearCount', 'lastOutcome', 'activeRunId'], path);
    assertDifficultyId(progress.difficultyId, `${path}.difficultyId`, 'INVALID_STATE');
    if (ids.has(progress.difficultyId)) fail('INVALID_STATE', 'state.progress contains duplicate difficulty');
    ids.add(progress.difficultyId);
    assertSafeInteger(progress.attemptsUsed, `${path}.attemptsUsed`, 0, 'INVALID_STATE');
    assertSafeInteger(progress.clearCount, `${path}.clearCount`, 0, 'INVALID_STATE');
    if (progress.lastOutcome !== null && progress.lastOutcome !== 'won' && progress.lastOutcome !== 'lost') {
      fail('INVALID_STATE', `${path}.lastOutcome is invalid`);
    }
    if (progress.activeRunId !== null) assertTrimmedString(progress.activeRunId, `${path}.activeRunId`, 'INVALID_STATE');
    const definition = config.find(({ id }) => id === progress.difficultyId);
    if (!definition) fail('INVALID_STATE', `${path}.difficultyId is not configured`);
    if (progress.attemptsUsed > definition.attemptLimit) fail('INVALID_STATE', `${path}.attemptsUsed exceeds attemptLimit`);
    if (progress.clearCount > progress.attemptsUsed) fail('INVALID_STATE', `${path}.clearCount exceeds attemptsUsed`);
    if (progress.attemptsUsed === 0 && (progress.clearCount !== 0 || progress.lastOutcome !== null || progress.activeRunId !== null)) {
      fail('INVALID_STATE', `${path} has progress without a consumed attempt`);
    }
    if (progress.activeRunId === null && progress.attemptsUsed > 0 && progress.lastOutcome === null) {
      fail('INVALID_STATE', `${path} is missing the last outcome for settled attempts`);
    }
    if (progress.lastOutcome === 'won' && progress.clearCount === 0) {
      fail('INVALID_STATE', `${path}.lastOutcome won requires a clear`);
    }
  });
  for (const definition of config) if (!ids.has(definition.id)) fail('INVALID_STATE', `state.progress is missing ${definition.id}`);
  if (!Array.isArray(parsed.activeRuns)) fail('INVALID_STATE', 'state.activeRuns must be an array');
  const runIds = new Set<string>();
  const runNumbers = new Set<number>();
  let highestRunNumber = 0;
  parsed.activeRuns.forEach((run, index) => {
    const path = `state.activeRuns[${index}]`;
    if (!isRecord(run)) fail('INVALID_STATE', `${path} must be an object`);
    exactStateKeys(run, ['runId', 'difficultyId', 'attemptNumber'], path);
    assertTrimmedString(run.runId, `${path}.runId`, 'INVALID_STATE');
    const parsedRunId = parseDungeonRunId(run.runId, `${path}.runId`);
    if (runIds.has(run.runId)) fail('INVALID_STATE', `state.activeRuns contains duplicate run ${run.runId}`);
    if (runNumbers.has(parsedRunId.runNumber)) fail('INVALID_STATE', `state contains duplicate run number ${parsedRunId.runNumber}`);
    runIds.add(run.runId);
    runNumbers.add(parsedRunId.runNumber);
    highestRunNumber = Math.max(highestRunNumber, parsedRunId.runNumber);
    assertDifficultyId(run.difficultyId, `${path}.difficultyId`, 'INVALID_STATE');
    if (parsedRunId.difficultyId !== run.difficultyId) fail('INVALID_STATE', `${path}.runId does not match difficultyId`);
    assertSafeInteger(run.attemptNumber, `${path}.attemptNumber`, 1, 'INVALID_STATE');
    if (run.attemptNumber > (config.find(({ id }) => id === run.difficultyId)?.attemptLimit ?? 0)) {
      fail('INVALID_STATE', `${path}.attemptNumber exceeds attemptLimit`);
    }
    const progress = parsed.progress.find((candidate) => (candidate as Record<string, unknown>).difficultyId === run.difficultyId) as Record<string, unknown> | undefined;
    if (!progress || progress.activeRunId !== run.runId) fail('INVALID_STATE', `${path} is not referenced by progress`);
    const definition = config.find(({ id }) => id === run.difficultyId);
    if (!definition || !isUnlocked(definition, parsed as unknown as PersistedState)) {
      fail('INVALID_STATE', `${path} references a locked difficulty`);
    }
    if (progress.attemptsUsed !== run.attemptNumber) fail('INVALID_STATE', `${path}.attemptNumber must match difficulty attemptsUsed`);
  });
  parsed.progress.forEach((progress) => {
    const activeRunId = (progress as Record<string, unknown>).activeRunId;
    if (activeRunId !== null && !runIds.has(activeRunId as string)) fail('INVALID_STATE', 'state progress references a missing active run');
  });
  if (!Array.isArray(parsed.settledRunIds)) fail('INVALID_STATE', 'state.settledRunIds must be an array');
  const settledRunIds = new Set<string>();
  parsed.settledRunIds.forEach((runId, index) => {
    assertTrimmedString(runId, `state.settledRunIds[${index}]`, 'INVALID_STATE');
    const parsedRunId = parseDungeonRunId(runId, `state.settledRunIds[${index}]`);
    if (settledRunIds.has(runId)) fail('INVALID_STATE', `state.settledRunIds contains duplicate run ${runId}`);
    if (runIds.has(runId)) fail('INVALID_STATE', `state run ${runId} cannot be active and settled`);
    if (runNumbers.has(parsedRunId.runNumber)) fail('INVALID_STATE', `state contains duplicate run number ${parsedRunId.runNumber}`);
    settledRunIds.add(runId);
    runNumbers.add(parsedRunId.runNumber);
    highestRunNumber = Math.max(highestRunNumber, parsedRunId.runNumber);
  });
  if (parsed.nextRunNumber <= highestRunNumber) {
    fail('INVALID_STATE', 'state.nextRunNumber must be greater than every historical run number');
  }
  for (const difficultyId of DUNGEON_DIFFICULTY_IDS) {
    const nextRunId = dungeonRunId(difficultyId, parsed.nextRunNumber);
    if (runIds.has(nextRunId) || settledRunIds.has(nextRunId)) {
      fail('INVALID_STATE', `state.nextRunNumber would generate an existing run ${nextRunId}`);
    }
  }
  return freezeDeep(clone(parsed));
}

export function restoreDungeonDifficultyState(
  serialized: string,
  config: DungeonDifficultyConfig = DEFAULT_DUNGEON_DIFFICULTY_CONFIG,
): DungeonDifficultySnapshot {
  const normalizedConfig = normalizeConfig(config);
  const state = parseState(serialized, normalizedConfig);
  return snapshotFromState(state, normalizedConfig);
}

function isUnlocked(definition: DungeonDifficultyDefinition, state: PersistedState): boolean {
  if (definition.unlock.type === 'always') return true;
  const source = state.progress.find(({ difficultyId }) => difficultyId === definition.unlock.difficultyId);
  return source !== undefined && source.clearCount >= (definition.unlock.minimumClears ?? Number.POSITIVE_INFINITY);
}

function findDefinition(config: DungeonDifficultyConfig, difficultyId: DungeonDifficultyId): DungeonDifficultyDefinition {
  const definition = config.find((candidate) => candidate.id === difficultyId);
  if (!definition) fail('UNKNOWN_DIFFICULTY', `unknown dungeon difficulty ${difficultyId}`);
  return definition;
}

function findProgress(state: PersistedState, difficultyId: DungeonDifficultyId): PersistedProgress {
  const progress = state.progress.find((candidate) => candidate.difficultyId === difficultyId);
  if (!progress) fail('INVALID_STATE', `missing progress for dungeon difficulty ${difficultyId}`);
  return progress;
}

function runFromState(
  run: PersistedRun,
  state: PersistedState,
  config: DungeonDifficultyConfig,
): DungeonDifficultyRun {
  const definition = findDefinition(config, run.difficultyId);
  return freezeDeep({
    runId: run.runId,
    difficultyId: run.difficultyId,
    attemptNumber: run.attemptNumber,
    stageIndex: 0,
    stages: clone(definition.stages),
  });
}

function snapshotFromState(state: PersistedState, config: DungeonDifficultyConfig): DungeonDifficultySnapshot {
  const difficulties = config.map((definition) => {
    const progress = findProgress(state, definition.id);
    return {
      difficultyId: definition.id,
      unlocked: isUnlocked(definition, state),
      attemptsUsed: progress.attemptsUsed,
      attemptsRemaining: definition.attemptLimit - progress.attemptsUsed,
      clearCount: progress.clearCount,
      lastOutcome: progress.lastOutcome,
      activeRunId: progress.activeRunId,
    };
  });
  const activeRuns = state.activeRuns.map((run) => runFromState(run, state, config));
  return freezeDeep({
    schemaVersion: DUNGEON_DIFFICULTY_SCHEMA_VERSION,
    nextRunNumber: state.nextRunNumber,
    difficulties,
    activeRuns,
    settledRunIds: [...state.settledRunIds],
  });
}

export function serializeDungeonDifficultyState(state: DungeonDifficultySnapshot): string {
  return JSON.stringify({
    schemaVersion: state.schemaVersion,
    nextRunNumber: state.nextRunNumber,
    progress: state.difficulties.map(({ difficultyId, attemptsUsed, clearCount, lastOutcome, activeRunId }) => ({
      difficultyId,
      attemptsUsed,
      clearCount,
      lastOutcome,
      activeRunId,
    })),
    activeRuns: state.activeRuns.map(({ runId, difficultyId, attemptNumber }) => ({ runId, difficultyId, attemptNumber })),
    settledRunIds: [...state.settledRunIds],
  });
}

export class DungeonDifficultyService {
  private readonly config: DungeonDifficultyConfig;
  private readonly persist: DungeonDifficultyPersistence;
  private current: PersistedState;

  constructor(options: DungeonDifficultyServiceOptions = {}) {
    this.config = normalizeConfig(options.config ?? DEFAULT_DUNGEON_DIFFICULTY_CONFIG);
    this.persist = options.persist ?? (() => {});
    this.current = options.initialState === undefined
      ? freezeDeep(defaultState(this.config))
      : parseState(options.initialState, this.config);
  }

  snapshot(): DungeonDifficultySnapshot {
    return snapshotFromState(this.current, this.config);
  }

  save(): string {
    return JSON.stringify(this.current);
  }

  definition(difficultyId: DungeonDifficultyId): DungeonDifficultyDefinition {
    assertDifficultyId(difficultyId, 'difficultyId');
    return findDefinition(this.config, difficultyId);
  }

  stage(difficultyId: DungeonDifficultyId, stageIndex: number): DungeonDifficultyStage {
    const definition = this.definition(difficultyId);
    if (!Number.isSafeInteger(stageIndex) || stageIndex < 0 || stageIndex >= definition.stages.length) {
      fail('INVALID_STAGE', `stageIndex must be between 0 and ${definition.stages.length - 1}`);
    }
    return definition.stages[stageIndex];
  }

  progress(difficultyId: DungeonDifficultyId): DungeonDifficultyProgress {
    assertDifficultyId(difficultyId, 'difficultyId');
    const progress = this.snapshot().difficulties.find((candidate) => candidate.difficultyId === difficultyId);
    if (!progress) fail('INVALID_STATE', `missing progress for dungeon difficulty ${difficultyId}`);
    return progress;
  }

  private commit(next: PersistedState): void {
    const validated = parseState(JSON.stringify(next), this.config);
    const serialized = JSON.stringify(validated);
    try {
      this.persist(serialized);
    } catch (error) {
      fail('PERSISTENCE_FAILED', error instanceof Error ? error.message : String(error));
    }
    this.current = validated;
  }

  startRun(difficultyId: DungeonDifficultyId): DungeonDifficultyRun {
    assertDifficultyId(difficultyId, 'difficultyId');
    const definition = findDefinition(this.config, difficultyId);
    const progress = findProgress(this.current, difficultyId);
    if (!isUnlocked(definition, this.current)) fail('DIFFICULTY_LOCKED', `${difficultyId} dungeon difficulty is locked`);
    if (progress.attemptsUsed >= definition.attemptLimit) fail('ATTEMPTS_EXHAUSTED', `${difficultyId} dungeon attempts are exhausted`);
    if (progress.activeRunId !== null) fail('RUN_ACTIVE', `${difficultyId} dungeon already has an active run`);
    if (this.current.nextRunNumber === Number.MAX_SAFE_INTEGER) fail('INVALID_STATE', 'state.nextRunNumber cannot allocate another run');

    const runId = dungeonRunId(difficultyId, this.current.nextRunNumber);
    if (this.current.activeRuns.some((candidate) => candidate.runId === runId) || this.current.settledRunIds.includes(runId)) {
      fail('INVALID_STATE', `generated run id ${runId} already exists`);
    }
    const run: PersistedRun = {
      runId,
      difficultyId,
      attemptNumber: progress.attemptsUsed + 1,
    };
    const nextProgress: PersistedProgress = {
      ...progress,
      attemptsUsed: progress.attemptsUsed + 1,
      activeRunId: runId,
    };
    const next: PersistedState = {
      ...this.current,
      nextRunNumber: this.current.nextRunNumber + 1,
      progress: this.current.progress.map((candidate) => candidate.difficultyId === difficultyId ? nextProgress : candidate),
      activeRuns: [...this.current.activeRuns, run],
    };
    this.commit(next);
    return runFromState(run, this.current, this.config);
  }

  activeRun(runId: string): DungeonDifficultyRun {
    assertTrimmedString(runId, 'runId', 'RUN_NOT_FOUND');
    const run = this.current.activeRuns.find((candidate) => candidate.runId === runId);
    if (!run) fail('RUN_NOT_FOUND', `active dungeon run ${runId} was not found`);
    return runFromState(run, this.current, this.config);
  }

  settleRun(runId: string, outcome: DungeonRunOutcome): DungeonDifficultySettlement {
    assertTrimmedString(runId, 'runId', 'RUN_NOT_FOUND');
    if (outcome !== 'won' && outcome !== 'lost') fail('INVALID_OUTCOME', 'dungeon run outcome must be won or lost');
    const run = this.current.activeRuns.find((candidate) => candidate.runId === runId);
    if (!run) {
      fail(this.current.settledRunIds.includes(runId) ? 'RUN_SETTLED' : 'RUN_NOT_FOUND', `dungeon run ${runId} is not active`);
    }
    const definition = findDefinition(this.config, run.difficultyId);
    const progress = findProgress(this.current, run.difficultyId);
    if (progress.activeRunId !== runId) fail('INVALID_STATE', `dungeon run ${runId} is not linked to its difficulty progress`);
    const firstClear = outcome === 'won' && progress.clearCount === 0;
    const nextProgress: PersistedProgress = {
      ...progress,
      clearCount: outcome === 'won' ? progress.clearCount + 1 : progress.clearCount,
      lastOutcome: outcome,
      activeRunId: null,
    };
    const next: PersistedState = {
      ...this.current,
      progress: this.current.progress.map((candidate) => candidate.difficultyId === run.difficultyId ? nextProgress : candidate),
      activeRuns: this.current.activeRuns.filter((candidate) => candidate.runId !== runId),
      settledRunIds: [...this.current.settledRunIds, runId],
    };
    this.commit(next);
    const nextSnapshot = this.snapshot();
    const nextDifficulty = nextSnapshot.difficulties.find((candidate) => candidate.difficultyId === run.difficultyId);
    if (!nextDifficulty) fail('INVALID_STATE', `missing progress after settling ${runId}`);
    return freezeDeep({
      runId,
      difficultyId: run.difficultyId,
      outcome,
      firstClear,
      rewards: clone(outcome === 'won' ? (firstClear ? definition.firstClearRewards : definition.repeatClearRewards) : []),
      attemptsRemaining: nextDifficulty.attemptsRemaining,
      unlocked: nextDifficulty.unlocked,
    });
  }
}
