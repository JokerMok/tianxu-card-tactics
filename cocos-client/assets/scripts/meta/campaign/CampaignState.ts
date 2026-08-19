export const CAMPAIGN_STATE_SCHEMA_VERSION = 1 as const;
export const CAMPAIGN_CHAPTER_ID = 'CHAPTER01' as const;
export const CAMPAIGN_LEVEL_IDS = Object.freeze([
  'L01', 'L02', 'L03', 'L04', 'L05', 'L06',
  'L07', 'L08', 'L09', 'L10', 'L11', 'L12',
] as const);

export type CampaignLevelId = typeof CAMPAIGN_LEVEL_IDS[number];
export type CampaignLastOutcome = 'NONE' | 'IN_PROGRESS' | 'FAILED' | 'CLEARED';

export interface CampaignLevelDefinition {
  readonly id: string;
  readonly prerequisiteLevelId: string | null;
}

export interface CampaignDefinition {
  readonly chapterId?: string;
  readonly levels: readonly CampaignLevelDefinition[];
}

export interface CampaignLevelProgress {
  readonly levelId: CampaignLevelId;
  readonly unlocked: boolean;
  readonly stars: number;
  readonly firstClear: boolean;
  readonly clearCount: number;
  readonly replayCount: number;
  readonly failureCount: number;
  readonly failed: boolean;
  readonly lastOutcome: CampaignLastOutcome;
}

export interface CampaignState {
  readonly schemaVersion: typeof CAMPAIGN_STATE_SCHEMA_VERSION;
  readonly chapterId: typeof CAMPAIGN_CHAPTER_ID;
  readonly selectedLevelId: CampaignLevelId;
  readonly activeLevelId: CampaignLevelId | null;
  readonly levels: Readonly<Record<CampaignLevelId, CampaignLevelProgress>>;
}

export type CampaignPersistence = (serialized: string) => void;

export interface CampaignServiceOptions {
  readonly config?: CampaignDefinition | readonly CampaignLevelDefinition[];
  readonly index?: CampaignDefinition | readonly CampaignLevelDefinition[];
  readonly levels?: readonly CampaignLevelDefinition[];
  readonly levelConfigs?: readonly CampaignLevelDefinition[];
  readonly chapterId?: string;
  readonly initialState?: CampaignState | string;
  readonly state?: CampaignState | string;
  readonly onSave?: CampaignPersistence;
  readonly persist?: CampaignPersistence;
}

export type CampaignErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_CONFIG'
  | 'INVALID_LEVEL_ID'
  | 'INVALID_STARS'
  | 'INVALID_STATE'
  | 'INVALID_SAVE'
  | 'SAVE_VERSION'
  | 'CHAPTER_MISMATCH'
  | 'LEVEL_LOCKED'
  | 'INVALID_ORDER'
  | 'NO_ACTIVE_LEVEL'
  | 'ACTIVE_LEVEL_MISMATCH'
  | 'REENTRANT'
  | 'PERSISTENCE_FAILED';

export class CampaignStateError extends Error {
  readonly code: CampaignErrorCode;
  readonly reason: CampaignErrorCode;
  readonly cause?: unknown;

  constructor(code: CampaignErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'CampaignStateError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }
}

interface MutableLevelProgress {
  levelId: CampaignLevelId;
  unlocked: boolean;
  stars: number;
  firstClear: boolean;
  clearCount: number;
  replayCount: number;
  failureCount: number;
  failed: boolean;
  lastOutcome: CampaignLastOutcome;
}

interface MutableCampaignState {
  schemaVersion: typeof CAMPAIGN_STATE_SCHEMA_VERSION;
  chapterId: typeof CAMPAIGN_CHAPTER_ID;
  selectedLevelId: CampaignLevelId;
  activeLevelId: CampaignLevelId | null;
  levels: Record<CampaignLevelId, MutableLevelProgress>;
}

type RuntimeOptions = Omit<CampaignServiceOptions, 'config' | 'index' | 'levels' | 'levelConfigs' | 'chapterId'>;

function reject(code: CampaignErrorCode, message: string, cause?: unknown): never {
  throw new CampaignStateError(code, message, cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) reject('INVALID_ARGUMENT', `${label} must be a plain object`);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    reject('INVALID_STATE', `${label} contains unexpected or missing fields`);
  }
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    reject('INVALID_STATE', `${label} must be a safe integer`);
  }
}

function incrementCount(value: number, label: string): number {
  if (value >= Number.MAX_SAFE_INTEGER) reject('INVALID_STATE', `${label} would overflow`);
  return value + 1;
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') reject('INVALID_STATE', `${label} must be boolean`);
}

function assertLevelId(value: unknown, label = 'level id'): asserts value is CampaignLevelId {
  if (typeof value !== 'string' || !CAMPAIGN_LEVEL_IDS.includes(value as CampaignLevelId)) {
    reject('INVALID_LEVEL_ID', `${label} is not a valid chapter level: ${String(value)}`);
  }
}

function assertChapterId(value: unknown, label: string): asserts value is typeof CAMPAIGN_CHAPTER_ID {
  if (value !== CAMPAIGN_CHAPTER_ID) reject('CHAPTER_MISMATCH', `${label} must be ${CAMPAIGN_CHAPTER_ID}`);
}

function assertStars(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 3) {
    reject('INVALID_STARS', 'stars must be an integer from 1 to 3');
  }
}

function definitionRecord(value: unknown, index: number): CampaignLevelDefinition {
  assertPlainRecord(value, `levels[${index}]`);
  if (typeof value.id !== 'string' || value.id !== CAMPAIGN_LEVEL_IDS[index]) {
    reject('INVALID_CONFIG', `levels[${index}].id must be ${CAMPAIGN_LEVEL_IDS[index]}`);
  }
  const expectedPrerequisite = index === 0 ? null : CAMPAIGN_LEVEL_IDS[index - 1];
  if (value.prerequisiteLevelId !== expectedPrerequisite) {
    reject('INVALID_CONFIG', `levels[${index}].prerequisiteLevelId must be ${expectedPrerequisite ?? 'null'}`);
  }
  return { id: value.id, prerequisiteLevelId: value.prerequisiteLevelId };
}

function normalizeDefinition(input: CampaignDefinition | readonly CampaignLevelDefinition[]): {
  chapterId: typeof CAMPAIGN_CHAPTER_ID;
  levels: readonly CampaignLevelDefinition[];
} {
  const candidate = Array.isArray(input) ? { levels: input } : input;
  assertPlainRecord(candidate, 'campaign config');
  if (candidate.chapterId !== undefined) assertChapterId(candidate.chapterId, 'campaign config chapterId');
  if (!Array.isArray(candidate.levels) || candidate.levels.length !== CAMPAIGN_LEVEL_IDS.length) {
    reject('INVALID_CONFIG', 'campaign config must contain exactly L01-L12');
  }
  const levels = candidate.levels.map((level, index) => definitionRecord(level, index));
  return { chapterId: CAMPAIGN_CHAPTER_ID, levels: Object.freeze(levels) };
}

function defaultState(): MutableCampaignState {
  const levels = {} as Record<CampaignLevelId, MutableLevelProgress>;
  CAMPAIGN_LEVEL_IDS.forEach((levelId, index) => {
    levels[levelId] = {
      levelId,
      unlocked: index === 0,
      stars: 0,
      firstClear: false,
      clearCount: 0,
      replayCount: 0,
      failureCount: 0,
      failed: false,
      lastOutcome: 'NONE',
    };
  });
  return {
    schemaVersion: CAMPAIGN_STATE_SCHEMA_VERSION,
    chapterId: CAMPAIGN_CHAPTER_ID,
    selectedLevelId: 'L01',
    activeLevelId: null,
    levels,
  };
}

function copyMutableState(state: CampaignState): MutableCampaignState {
  const levels = {} as Record<CampaignLevelId, MutableLevelProgress>;
  for (const levelId of CAMPAIGN_LEVEL_IDS) levels[levelId] = { ...state.levels[levelId] };
  return {
    schemaVersion: state.schemaVersion,
    chapterId: state.chapterId,
    selectedLevelId: state.selectedLevelId,
    activeLevelId: state.activeLevelId,
    levels,
  };
}

function freezeState(state: MutableCampaignState): CampaignState {
  const levels = {} as Record<CampaignLevelId, CampaignLevelProgress>;
  for (const levelId of CAMPAIGN_LEVEL_IDS) levels[levelId] = Object.freeze({ ...state.levels[levelId] });
  return Object.freeze({
    schemaVersion: CAMPAIGN_STATE_SCHEMA_VERSION,
    chapterId: CAMPAIGN_CHAPTER_ID,
    selectedLevelId: state.selectedLevelId,
    activeLevelId: state.activeLevelId,
    levels: Object.freeze(levels),
  });
}

function validateState(state: unknown): CampaignState {
  assertPlainRecord(state, 'campaign state');
  assertExactKeys(state, ['schemaVersion', 'chapterId', 'selectedLevelId', 'activeLevelId', 'levels'], 'campaign state');
  if (state.schemaVersion !== CAMPAIGN_STATE_SCHEMA_VERSION) reject('SAVE_VERSION', 'unsupported campaign save version');
  assertChapterId(state.chapterId, 'campaign state chapterId');
  assertLevelId(state.selectedLevelId, 'campaign state selectedLevelId');
  if (state.activeLevelId !== null) assertLevelId(state.activeLevelId, 'campaign state activeLevelId');
  assertPlainRecord(state.levels, 'campaign state levels');
  assertExactKeys(state.levels, [...CAMPAIGN_LEVEL_IDS], 'campaign state levels');

  const levels = {} as Record<CampaignLevelId, MutableLevelProgress>;
  CAMPAIGN_LEVEL_IDS.forEach((levelId, index) => {
    const value = state.levels[levelId];
    assertPlainRecord(value, `campaign state levels.${levelId}`);
    assertExactKeys(value, [
      'levelId', 'unlocked', 'stars', 'firstClear', 'clearCount',
      'replayCount', 'failureCount', 'failed', 'lastOutcome',
    ], `campaign state levels.${levelId}`);
    assertLevelId(value.levelId, `campaign state levels.${levelId}.levelId`);
    if (value.levelId !== levelId) reject('INVALID_STATE', `campaign state level key mismatch: ${levelId}`);
    assertBoolean(value.unlocked, `campaign state levels.${levelId}.unlocked`);
    assertSafeInteger(value.stars, `campaign state levels.${levelId}.stars`);
    if (value.stars < 0 || value.stars > 3) reject('INVALID_STARS', `campaign state levels.${levelId}.stars must be 0-3`);
    assertBoolean(value.firstClear, `campaign state levels.${levelId}.firstClear`);
    assertSafeInteger(value.clearCount, `campaign state levels.${levelId}.clearCount`);
    assertSafeInteger(value.replayCount, `campaign state levels.${levelId}.replayCount`);
    assertSafeInteger(value.failureCount, `campaign state levels.${levelId}.failureCount`);
    if (value.clearCount < 0 || value.replayCount < 0 || value.failureCount < 0) {
      reject('INVALID_STATE', `campaign state levels.${levelId} counts cannot be negative`);
    }
    assertBoolean(value.failed, `campaign state levels.${levelId}.failed`);
    if (!['NONE', 'IN_PROGRESS', 'FAILED', 'CLEARED'].includes(value.lastOutcome as string)) {
      reject('INVALID_STATE', `campaign state levels.${levelId}.lastOutcome is invalid`);
    }
    if (value.firstClear !== (value.clearCount > 0)) {
      reject('INVALID_STATE', `campaign state levels.${levelId} first clear does not match clear count`);
    }
    if (!value.firstClear && (value.stars !== 0 || value.replayCount !== 0)) {
      reject('INVALID_STATE', `campaign state levels.${levelId} has progress before first clear`);
    }
    if (value.replayCount > 0 && !value.firstClear) {
      reject('INVALID_STATE', `campaign state levels.${levelId} replay requires first clear`);
    }
    if (value.clearCount > value.replayCount + 1) {
      reject('INVALID_STATE', `campaign state levels.${levelId} clear count exceeds replay attempts`);
    }
    if (value.firstClear && value.stars < 1) {
      reject('INVALID_STATE', `campaign state levels.${levelId} first clear requires stars`);
    }
    if (value.failed !== (value.lastOutcome === 'FAILED')) {
      reject('INVALID_STATE', `campaign state levels.${levelId} failed flag does not match last outcome`);
    }
    if (value.lastOutcome === 'NONE' && (value.firstClear || value.failureCount !== 0)) {
      reject('INVALID_STATE', `campaign state levels.${levelId} NONE outcome has history`);
    }
    if (value.lastOutcome === 'CLEARED' && !value.firstClear) {
      reject('INVALID_STATE', `campaign state levels.${levelId} CLEARED outcome lacks first clear`);
    }
    if (value.lastOutcome === 'IN_PROGRESS' && state.activeLevelId !== levelId) {
      reject('INVALID_STATE', `campaign state levels.${levelId} is in progress without active level`);
    }
    if (value.failed && value.failureCount === 0) {
      reject('INVALID_STATE', `campaign state levels.${levelId} failed without a failure count`);
    }
    switch (value.lastOutcome) {
      case 'NONE':
        if (value.firstClear || value.clearCount !== 0 || value.replayCount !== 0 || value.failureCount !== 0) {
          reject('INVALID_STATE', `campaign state levels.${levelId} NONE outcome is not reachable`);
        }
        break;
      case 'IN_PROGRESS':
      case 'FAILED':
        if (!value.firstClear) {
          if (value.clearCount !== 0 || value.replayCount !== 0) {
            reject('INVALID_STATE', `campaign state levels.${levelId} pre-clear ${value.lastOutcome} has replay or clear history`);
          }
        } else {
          const replaySuccessCount = value.clearCount - 1;
          const replayFailureCount = value.replayCount - replaySuccessCount;
          const terminalReplayFailureCount = value.lastOutcome === 'IN_PROGRESS'
            ? replayFailureCount - 1
            : replayFailureCount;
          if (terminalReplayFailureCount < 0 || terminalReplayFailureCount > value.failureCount) {
            reject('INVALID_STATE', `campaign state levels.${levelId} post-clear ${value.lastOutcome} replay history is not reachable`);
          }
          if (value.lastOutcome === 'FAILED' && terminalReplayFailureCount < 1) {
            reject('INVALID_STATE', `campaign state levels.${levelId} post-clear failure lacks a replay failure`);
          }
        }
        break;
      case 'CLEARED':
        {
          const replaySuccessCount = value.clearCount - 1;
          const replayFailureCount = value.replayCount - replaySuccessCount;
          if (
            replayFailureCount < 0
            || replayFailureCount > value.failureCount
            || (value.replayCount > 0 && replaySuccessCount < 1)
          ) {
            reject('INVALID_STATE', `campaign state levels.${levelId} cleared replay history is not reachable`);
          }
        }
        break;
      default:
        break;
    }
    levels[levelId] = {
      levelId,
      unlocked: value.unlocked,
      stars: value.stars,
      firstClear: value.firstClear,
      clearCount: value.clearCount,
      replayCount: value.replayCount,
      failureCount: value.failureCount,
      failed: value.failed,
      lastOutcome: value.lastOutcome as CampaignLastOutcome,
    };
    if (index > 0 && value.unlocked !== levels[CAMPAIGN_LEVEL_IDS[index - 1]].firstClear) {
      reject('INVALID_ORDER', `campaign state unlock order is invalid at ${levelId}`);
    }
  });
  if (!levels.L01.unlocked) reject('INVALID_ORDER', 'L01 must always be unlocked');
  if (state.activeLevelId !== null) {
    if (state.selectedLevelId !== state.activeLevelId) reject('INVALID_ORDER', 'active level must be selected');
    if (levels[state.activeLevelId].lastOutcome !== 'IN_PROGRESS') {
      reject('INVALID_STATE', 'active level must be in progress');
    }
  }
  if (!levels[state.selectedLevelId].unlocked) reject('LEVEL_LOCKED', 'selected level is locked');
  return freezeState({
    schemaVersion: CAMPAIGN_STATE_SCHEMA_VERSION,
    chapterId: CAMPAIGN_CHAPTER_ID,
    selectedLevelId: state.selectedLevelId,
    activeLevelId: state.activeLevelId,
    levels,
  });
}

function serializeState(state: CampaignState): string {
  return JSON.stringify({
    schemaVersion: state.schemaVersion,
    chapterId: state.chapterId,
    selectedLevelId: state.selectedLevelId,
    activeLevelId: state.activeLevelId,
    levels: Object.fromEntries(CAMPAIGN_LEVEL_IDS.map((levelId) => [levelId, state.levels[levelId]])),
  });
}

function parseSerialized(serialized: string): unknown {
  if (typeof serialized !== 'string' || serialized.length === 0) reject('INVALID_SAVE', 'campaign save must be a non-empty string');
  try {
    return JSON.parse(serialized);
  } catch {
    reject('INVALID_SAVE', 'campaign save is not valid JSON');
  }
}

function resolveDefinition(
  input: CampaignDefinition | readonly CampaignLevelDefinition[] | CampaignServiceOptions,
  options: CampaignServiceOptions | RuntimeOptions | undefined,
): { definition: CampaignDefinition | readonly CampaignLevelDefinition[]; runtime: RuntimeOptions } {
  if (Array.isArray(input)) return { definition: input, runtime: (options ?? {}) as RuntimeOptions };
  assertPlainRecord(input, 'campaign service input');
  const optionKeys = ['config', 'index', 'levels', 'levelConfigs', 'chapterId', 'initialState', 'state', 'onSave', 'persist'];
  const isOptions = optionKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key));
  if (!isOptions && Array.isArray(input.levels)) return { definition: input as unknown as CampaignDefinition, runtime: (options ?? {}) as RuntimeOptions };
  const config = input.config ?? input.index ?? (input.levels ? { chapterId: input.chapterId, levels: input.levels } : undefined);
  const levelConfigs = input.levelConfigs ?? input.levels;
  if (config === undefined && levelConfigs === undefined) reject('INVALID_ARGUMENT', 'campaign levels are required');
  const mergedRuntime = { ...input, ...(options ?? {}) } as CampaignServiceOptions;
  return {
    definition: config ?? levelConfigs!,
    runtime: {
      ...mergedRuntime,
      initialState: mergedRuntime.initialState ?? mergedRuntime.state,
    } as RuntimeOptions,
  };
}

function persistCallback(runtime: RuntimeOptions): CampaignPersistence | undefined {
  if (runtime.onSave !== undefined && runtime.persist !== undefined && runtime.onSave !== runtime.persist) {
    reject('INVALID_ARGUMENT', 'onSave and persist cannot both be provided');
  }
  const callback = runtime.persist ?? runtime.onSave;
  if (callback !== undefined && typeof callback !== 'function') reject('INVALID_ARGUMENT', 'campaign persistence must be a function');
  return callback;
}

export function createCampaignState(
  config: CampaignDefinition | readonly CampaignLevelDefinition[],
): CampaignState {
  normalizeDefinition(config);
  return freezeState(defaultState());
}

export function serializeCampaignState(state: CampaignState): string {
  return serializeState(validateState(state));
}

export function restoreCampaignState(
  config: CampaignDefinition | readonly CampaignLevelDefinition[],
  serialized: string,
): CampaignState {
  normalizeDefinition(config);
  return validateState(parseSerialized(serialized));
}

export class CampaignStateService {
  private current: CampaignState;
  private readonly persist?: CampaignPersistence;
  private persistenceActive = false;

  constructor(
    input: CampaignDefinition | readonly CampaignLevelDefinition[] | CampaignServiceOptions,
    options?: CampaignServiceOptions | RuntimeOptions,
  ) {
    const resolved = resolveDefinition(input, options);
    normalizeDefinition(resolved.definition);
    this.persist = persistCallback(resolved.runtime);
    const initial = resolved.runtime.initialState;
    this.current = initial === undefined
      ? freezeState(defaultState())
      : typeof initial === 'string'
        ? restoreCampaignState(resolved.definition, initial)
        : validateState(initial);
  }

  static fromSave(
    config: CampaignDefinition | readonly CampaignLevelDefinition[],
    serialized: string,
    options: RuntimeOptions = {},
  ): CampaignStateService {
    return new CampaignStateService(config, { ...options, initialState: serialized });
  }

  static restore(
    config: CampaignDefinition | readonly CampaignLevelDefinition[],
    serialized: string,
    options: RuntimeOptions = {},
  ): CampaignStateService {
    return CampaignStateService.fromSave(config, serialized, options);
  }

  snapshot(): CampaignState {
    return this.current;
  }

  serialize(): string {
    return serializeState(this.current);
  }

  save(): string {
    this.assertNotReentrant();
    const serialized = this.serialize();
    this.persistTransaction(serialized);
    return serialized;
  }

  restore(serialized: string): CampaignState {
    this.assertNotReentrant();
    const next = restoreCampaignState(this.definition(), serialized);
    this.commit(next);
    return this.current;
  }

  get selectedLevelId(): CampaignLevelId {
    return this.current.selectedLevelId;
  }

  get activeLevelId(): CampaignLevelId | null {
    return this.current.activeLevelId;
  }

  getLevel(levelId: string): CampaignLevelProgress {
    const id = this.validLevel(levelId);
    return this.current.levels[id];
  }

  isUnlocked(levelId: string): boolean {
    return this.getLevel(levelId).unlocked;
  }

  selectLevel(levelId: string): CampaignState {
    const id = this.validLevel(levelId);
    this.assertNotReentrant();
    if (this.current.activeLevelId !== null) reject('REENTRANT', 'cannot select a level during an active attempt');
    if (!this.current.levels[id].unlocked) reject('LEVEL_LOCKED', `level is locked: ${id}`);
    if (this.current.selectedLevelId === id) return this.current;
    const next = copyMutableState(this.current);
    next.selectedLevelId = id;
    this.commit(freezeState(next));
    return this.current;
  }

  select(levelId: string): CampaignState {
    return this.selectLevel(levelId);
  }

  startLevel(levelId?: string): CampaignState {
    this.assertNotReentrant();
    if (this.current.activeLevelId !== null) reject('REENTRANT', 'an attempt is already in progress');
    const id = levelId === undefined ? this.current.selectedLevelId : this.validLevel(levelId);
    if (!this.current.levels[id].unlocked) reject('LEVEL_LOCKED', `level is locked: ${id}`);
    if (id !== this.current.selectedLevelId) reject('INVALID_ORDER', `level must be selected before start: ${id}`);
    const next = copyMutableState(this.current);
    const level = next.levels[id];
    if (level.firstClear) level.replayCount = incrementCount(level.replayCount, `${id}.replayCount`);
    level.failed = false;
    level.lastOutcome = 'IN_PROGRESS';
    next.activeLevelId = id;
    this.commit(freezeState(next));
    return this.current;
  }

  beginLevel(levelId?: string): CampaignState {
    return this.startLevel(levelId);
  }

  completeLevel(levelIdOrStars: string | number, starsArgument?: number): CampaignState {
    const levelId = typeof levelIdOrStars === 'string' ? this.validLevel(levelIdOrStars) : this.current.activeLevelId;
    if (levelId === null) reject('NO_ACTIVE_LEVEL', 'there is no active campaign level');
    const stars = typeof levelIdOrStars === 'number' ? levelIdOrStars : starsArgument;
    assertStars(stars);
    this.assertNotReentrant();
    if (this.current.activeLevelId === null) reject('NO_ACTIVE_LEVEL', 'there is no active campaign level');
    if (this.current.activeLevelId !== levelId) reject('ACTIVE_LEVEL_MISMATCH', 'settlement level does not match active level');

    const next = copyMutableState(this.current);
    const level = next.levels[levelId];
    if (level.lastOutcome !== 'IN_PROGRESS') reject('REENTRANT', 'active campaign level has already settled');
    level.stars = Math.max(level.stars, stars);
    level.firstClear = true;
    level.clearCount = incrementCount(level.clearCount, `${levelId}.clearCount`);
    level.failed = false;
    level.lastOutcome = 'CLEARED';
    next.activeLevelId = null;
    const index = CAMPAIGN_LEVEL_IDS.indexOf(levelId);
    if (index < CAMPAIGN_LEVEL_IDS.length - 1) next.levels[CAMPAIGN_LEVEL_IDS[index + 1]].unlocked = true;
    this.commit(freezeState(next));
    return this.current;
  }

  recordVictory(levelIdOrStars: string | number, starsArgument?: number): CampaignState {
    return this.completeLevel(levelIdOrStars, starsArgument);
  }

  failLevel(levelId?: string): CampaignState {
    const id = levelId === undefined ? this.current.activeLevelId : this.validLevel(levelId);
    if (id === null) reject('NO_ACTIVE_LEVEL', 'there is no active campaign level');
    this.assertNotReentrant();
    if (this.current.activeLevelId === null) reject('NO_ACTIVE_LEVEL', 'there is no active campaign level');
    if (this.current.activeLevelId !== id) reject('ACTIVE_LEVEL_MISMATCH', 'failure level does not match active level');
    const next = copyMutableState(this.current);
    const level = next.levels[id];
    if (level.lastOutcome !== 'IN_PROGRESS') reject('REENTRANT', 'active campaign level has already settled');
    level.failureCount = incrementCount(level.failureCount, `${id}.failureCount`);
    level.failed = true;
    level.lastOutcome = 'FAILED';
    next.activeLevelId = null;
    this.commit(freezeState(next));
    return this.current;
  }

  recordFailure(levelId?: string): CampaignState {
    return this.failLevel(levelId);
  }

  settleLevel(levelId: string, result: { readonly won: boolean; readonly stars?: number }): CampaignState {
    const id = this.validLevel(levelId);
    assertPlainRecord(result, 'campaign settlement');
    assertBoolean(result.won, 'campaign settlement.won');
    if (result.won) return this.completeLevel(id, result.stars as number);
    return this.failLevel(id);
  }

  private definition(): CampaignDefinition {
    return { chapterId: CAMPAIGN_CHAPTER_ID, levels: CAMPAIGN_LEVEL_IDS.map((id, index) => ({
      id,
      prerequisiteLevelId: index === 0 ? null : CAMPAIGN_LEVEL_IDS[index - 1],
    })) };
  }

  private validLevel(levelId: string): CampaignLevelId {
    assertLevelId(levelId);
    return levelId;
  }

  private assertNotReentrant(): void {
    if (this.persistenceActive) reject('REENTRANT', 'campaign state mutation cannot re-enter persistence');
  }

  private commit(next: CampaignState): void {
    this.assertNotReentrant();
    const validated = validateState(next);
    this.persistTransaction(serializeState(validated), validated);
  }

  private persistTransaction(serialized: string, next?: CampaignState): void {
    if (this.persist === undefined) {
      if (next !== undefined) this.current = next;
      return;
    }
    this.persistenceActive = true;
    try {
      this.persist(serialized);
    } catch (error) {
      if (error instanceof CampaignStateError && error.code === 'REENTRANT') throw error;
      throw new CampaignStateError('PERSISTENCE_FAILED', 'campaign state persistence failed', error);
    } finally {
      this.persistenceActive = false;
    }
    if (next !== undefined) this.current = next;
  }
}

export { CampaignStateService as CampaignStateMachine, CampaignStateService as CampaignService };
