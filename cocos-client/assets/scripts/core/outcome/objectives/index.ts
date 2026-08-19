export const OBJECTIVE_SCHEMA_VERSION = 1 as const;

export type ObjectiveType = 'KILL' | 'DEFEND' | 'TIMED' | 'SURVIVE';
export type ObjectiveLifecycle = 'not_started' | 'active' | 'won' | 'lost';
export type ObjectiveProgressStatus = 'pending' | 'completed' | 'failed';
export type ObjectiveSide = 'player' | 'enemy';

export type ObjectiveErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_EVENT'
  | 'INVALID_TIMING'
  | 'NEGATIVE_TIME'
  | 'STATE_SETTLED';

export class ObjectiveError extends Error {
  readonly code: ObjectiveErrorCode;
  readonly reason: ObjectiveErrorCode;

  constructor(code: ObjectiveErrorCode, message: string) {
    super(message);
    this.name = 'ObjectiveError';
    this.code = code;
    this.reason = code;
  }

  toJSON(): Readonly<Record<string, string>> {
    return { name: this.name, code: this.code, reason: this.reason, message: this.message };
  }
}

export interface ObjectiveConfigBase {
  readonly id: string;
  readonly type: ObjectiveType;
  readonly targetId?: string;
  readonly targetSide?: ObjectiveSide;
  readonly label?: string;
  readonly description?: string;
}

export interface KillObjectiveConfig extends ObjectiveConfigBase {
  readonly type: 'KILL';
  readonly count: number;
}

export interface DefendObjectiveConfig extends ObjectiveConfigBase {
  readonly type: 'DEFEND';
  readonly targetId: string;
  readonly minHp: number;
}

export interface TimedObjectiveConfig extends ObjectiveConfigBase {
  readonly type: 'TIMED';
  readonly count: number;
  readonly timeLimitMs: number;
}

export interface SurviveObjectiveConfig extends ObjectiveConfigBase {
  readonly type: 'SURVIVE';
  readonly durationMs: number;
}

export type ObjectiveConfig =
  | KillObjectiveConfig
  | DefendObjectiveConfig
  | TimedObjectiveConfig
  | SurviveObjectiveConfig;

export type ObjectiveConfigInput =
  | ObjectiveConfig
  | (Omit<KillObjectiveConfig, 'type'> & { readonly type?: 'KILL'; readonly kind?: 'KILL' })
  | (Omit<DefendObjectiveConfig, 'type'> & { readonly type?: 'DEFEND'; readonly kind?: 'DEFEND' })
  | (Omit<TimedObjectiveConfig, 'type'> & { readonly type?: 'TIMED'; readonly kind?: 'TIMED' })
  | (Omit<SurviveObjectiveConfig, 'type'> & { readonly type?: 'SURVIVE'; readonly kind?: 'SURVIVE' });

export interface ObjectiveProgress {
  readonly id: string;
  readonly type: ObjectiveType;
  readonly status: ObjectiveProgressStatus;
  readonly current: number;
  readonly target: number;
  readonly targetId?: string;
  readonly targetSide?: ObjectiveSide;
  readonly minHp?: number;
  readonly currentHp: number | null;
  readonly timeLimitMs?: number;
  readonly durationMs?: number;
}

export type ObjectiveSettlementReason =
  | 'OBJECTIVES_COMPLETE'
  | 'TARGET_DESTROYED'
  | 'TIMED_OUT'
  | 'BATTLE_ENDED'
  | 'OBJECTIVE_INCOMPLETE';

export interface ObjectiveSettlement {
  readonly status: 'won' | 'lost';
  readonly reason: ObjectiveSettlementReason;
  readonly eventId: string;
  readonly elapsedMs: number;
}

export interface ObjectiveState {
  readonly schemaVersion: typeof OBJECTIVE_SCHEMA_VERSION;
  readonly lifecycle: ObjectiveLifecycle;
  readonly settled: boolean;
  readonly startedAtMs: number | null;
  readonly elapsedMs: number;
  readonly objectives: readonly ObjectiveProgress[];
  readonly eventCounts: Readonly<Record<string, number>>;
  readonly events: readonly ObjectiveEventRecord[];
  readonly processedEventIds: readonly string[];
  readonly settlement: ObjectiveSettlement | null;
}

export type ObjectiveEvent =
  | {
      readonly id?: string;
      readonly eventId?: string | number;
      readonly type: 'BATTLE_STARTED';
      readonly atMs?: number;
      readonly targetHp?: Readonly<Record<string, number>>;
    }
  | {
      readonly id?: string;
      readonly eventId?: string | number;
      readonly type: 'UNIT_DEFEATED';
      readonly unitId: string;
      readonly side: ObjectiveSide;
      readonly atMs?: number;
    }
  | {
      readonly id?: string;
      readonly eventId?: string | number;
      readonly type: 'TARGET_HEALTH';
      readonly targetId: string;
      readonly hp: number;
      readonly atMs?: number;
    }
  | {
      readonly id?: string;
      readonly eventId?: string | number;
      readonly type: 'TIME_ADVANCED';
      readonly deltaMs: number;
      readonly atMs?: number;
    }
  | {
      readonly id?: string;
      readonly eventId?: string | number;
      readonly type: 'BATTLE_ENDED';
      readonly outcome: 'won' | 'lost' | 'draw';
      readonly atMs?: number;
    };

export type ObjectiveEventRecord =
  | {
      readonly id: string;
      readonly type: 'BATTLE_STARTED';
      readonly atMs?: number;
      readonly targetHp?: Readonly<Record<string, number>>;
    }
  | {
      readonly id: string;
      readonly type: 'UNIT_DEFEATED';
      readonly unitId: string;
      readonly side: ObjectiveSide;
      readonly atMs?: number;
    }
  | {
      readonly id: string;
      readonly type: 'TARGET_HEALTH';
      readonly targetId: string;
      readonly hp: number;
      readonly atMs?: number;
    }
  | {
      readonly id: string;
      readonly type: 'TIME_ADVANCED';
      readonly deltaMs: number;
      readonly atMs?: number;
    }
  | {
      readonly id: string;
      readonly type: 'BATTLE_ENDED';
      readonly outcome: 'won' | 'lost' | 'draw';
      readonly atMs?: number;
    };

const OBJECTIVE_TYPES = new Set<ObjectiveType>(['KILL', 'DEFEND', 'TIMED', 'SURVIVE']);
const OBJECTIVE_EVENT_TYPES = new Set(['BATTLE_STARTED', 'UNIT_DEFEATED', 'TARGET_HEALTH', 'TIME_ADVANCED', 'BATTLE_ENDED']);
const COMMON_CONFIG_KEYS = ['id', 'type', 'kind', 'targetId', 'targetSide', 'side', 'label', 'description'] as const;
const STATE_KEYS = ['schemaVersion', 'lifecycle', 'settled', 'startedAtMs', 'elapsedMs', 'objectives', 'eventCounts', 'events', 'processedEventIds', 'settlement'] as const;
const SETTLEMENT_KEYS = ['status', 'reason', 'eventId', 'elapsedMs'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function trimmedNonEmptyString(value: unknown): value is string {
  return nonEmptyString(value) && value === value.trim();
}

function exactKeys(raw: Record<string, unknown>, allowed: readonly string[], path: string, code: ObjectiveErrorCode): void {
  const allowedKeys = new Set(allowed);
  for (const key of Reflect.ownKeys(raw)) {
    if (typeof key !== 'string' || !allowedKeys.has(key)) fail(code, `${path} has unknown field: ${String(key)}`);
  }
}

function stableJson(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}

function fail(code: ObjectiveErrorCode, message: string): never {
  throw new ObjectiveError(code, message);
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function readSide(value: unknown, path: string): ObjectiveSide | undefined {
  if (value === undefined) return undefined;
  if (value !== 'player' && value !== 'enemy') fail('INVALID_CONFIG', `${path} must be player or enemy`);
  return value;
}

function readEventId(raw: Record<string, unknown>): string {
  if (raw.id === undefined && raw.eventId === undefined) fail('INVALID_EVENT', 'event id is required');
  if (raw.id !== undefined && raw.eventId !== undefined && raw.id !== raw.eventId) {
    fail('INVALID_EVENT', 'id and eventId must agree');
  }
  const value = raw.id ?? raw.eventId;
  if (trimmedNonEmptyString(value)) return value;
  if (isSafeInteger(value) && value >= 0) return String(value);
  fail('INVALID_EVENT', 'event id must be a non-empty string or non-negative integer');
}

function validateConfigKeys(raw: Record<string, unknown>, type: ObjectiveType): void {
  const typeKeys: Readonly<Record<ObjectiveType, readonly string[]>> = {
    KILL: [...COMMON_CONFIG_KEYS, 'count'],
    DEFEND: [...COMMON_CONFIG_KEYS, 'minHp'],
    TIMED: [...COMMON_CONFIG_KEYS, 'count', 'timeLimitMs'],
    SURVIVE: ['id', 'type', 'kind', 'label', 'description', 'durationMs'],
  };
  exactKeys(raw, typeKeys[type], 'objective config', 'INVALID_CONFIG');
}

function canonicalType(raw: Record<string, unknown>): ObjectiveType {
  const type = raw.type ?? raw.kind;
  if (!OBJECTIVE_TYPES.has(type as ObjectiveType)) fail('INVALID_CONFIG', 'objective type must be KILL, DEFEND, TIMED, or SURVIVE');
  if (raw.type !== undefined && raw.kind !== undefined && raw.type !== raw.kind) {
    fail('INVALID_CONFIG', 'objective type and kind must agree');
  }
  return type as ObjectiveType;
}

function readTarget(raw: Record<string, unknown>, path: string): { targetId?: string; targetSide?: ObjectiveSide } {
  if (raw.targetId !== undefined && !nonEmptyString(raw.targetId)) fail('INVALID_CONFIG', `${path}.targetId is invalid`);
  if (raw.targetId !== undefined && raw.targetId !== String(raw.targetId).trim()) fail('INVALID_CONFIG', `${path}.targetId must not have surrounding whitespace`);
  const targetSide = readSide(raw.targetSide ?? raw.side, `${path}.targetSide`);
  if (raw.targetSide !== undefined && raw.side !== undefined && raw.targetSide !== raw.side) {
    fail('INVALID_CONFIG', `${path}.targetSide and side must agree`);
  }
  if (raw.targetId === undefined && targetSide === undefined) fail('INVALID_CONFIG', `${path} needs targetId or targetSide`);
  return {
    ...(raw.targetId === undefined ? {} : { targetId: raw.targetId as string }),
    ...(targetSide === undefined ? {} : { targetSide }),
  };
}

export function normalizeObjectiveConfig(raw: ObjectiveConfigInput): ObjectiveConfig {
  if (!isRecord(raw)) fail('INVALID_CONFIG', 'objective config must be an object');
  const type = canonicalType(raw);
  validateConfigKeys(raw, type);
  if (!nonEmptyString(raw.id) || raw.id !== raw.id.trim()) fail('INVALID_CONFIG', 'objective id must be a trimmed non-empty string');
  const label = raw.label === undefined ? undefined : (nonEmptyString(raw.label) ? raw.label : fail('INVALID_CONFIG', `${raw.id}.label is invalid`));
  const description = raw.description === undefined
    ? undefined
    : (typeof raw.description === 'string' ? raw.description : fail('INVALID_CONFIG', `${raw.id}.description is invalid`));
  const target = type === 'SURVIVE' ? {} : readTarget(raw, raw.id as string);

  if (type === 'KILL') {
    if (!isPositiveInteger(raw.count)) fail('INVALID_CONFIG', `${raw.id}.count must be a positive integer`);
    return freezeDeep({ id: raw.id, type, count: raw.count, ...target, ...(label === undefined ? {} : { label }), ...(description === undefined ? {} : { description }) });
  }
  if (type === 'DEFEND') {
    if (!nonEmptyString(raw.targetId)) fail('INVALID_CONFIG', `${raw.id}.targetId is required for DEFEND`);
    if (!isPositiveInteger(raw.minHp)) fail('INVALID_CONFIG', `${raw.id}.minHp must be a positive integer`);
    return freezeDeep({ id: raw.id, type, targetId: raw.targetId, minHp: raw.minHp, ...(raw.targetSide === undefined && raw.side === undefined ? {} : { targetSide: target.targetSide }), ...(label === undefined ? {} : { label }), ...(description === undefined ? {} : { description }) });
  }
  if (type === 'TIMED') {
    if (!isPositiveInteger(raw.count)) fail('INVALID_CONFIG', `${raw.id}.count must be a positive integer`);
    if (!isPositiveInteger(raw.timeLimitMs)) fail('INVALID_CONFIG', `${raw.id}.timeLimitMs must be a positive integer`);
    return freezeDeep({ id: raw.id, type, count: raw.count, timeLimitMs: raw.timeLimitMs, ...target, ...(label === undefined ? {} : { label }), ...(description === undefined ? {} : { description }) });
  }
  if (!isPositiveInteger(raw.durationMs)) fail('INVALID_CONFIG', `${raw.id}.durationMs must be a positive integer`);
  return freezeDeep({ id: raw.id, type, durationMs: raw.durationMs, ...(label === undefined ? {} : { label }), ...(description === undefined ? {} : { description }) });
}

export function normalizeObjectiveConfigs(raw: readonly ObjectiveConfigInput[]): readonly ObjectiveConfig[] {
  if (!Array.isArray(raw) || raw.length === 0) fail('INVALID_CONFIG', 'at least one objective config is required');
  const ids = new Set<string>();
  const configs = raw.map((candidate) => {
    const config = normalizeObjectiveConfig(candidate);
    if (ids.has(config.id)) fail('INVALID_CONFIG', `duplicate objective id: ${config.id}`);
    ids.add(config.id);
    return config;
  });
  return freezeDeep(configs);
}

function progressFor(config: ObjectiveConfig): ObjectiveProgress {
  const target = config.type === 'DEFEND' ? config.minHp : config.type === 'TIMED' ? config.count : config.type === 'KILL' ? config.count : config.durationMs;
  return {
    id: config.id,
    type: config.type,
    status: 'pending',
    current: 0,
    target,
    ...(config.targetId === undefined ? {} : { targetId: config.targetId }),
    ...(config.targetSide === undefined ? {} : { targetSide: config.targetSide }),
    ...(config.minHp === undefined ? {} : { minHp: config.minHp }),
    currentHp: null,
    ...(config.timeLimitMs === undefined ? {} : { timeLimitMs: config.timeLimitMs }),
    ...(config.durationMs === undefined ? {} : { durationMs: config.durationMs }),
  };
}

export function createObjectiveState(configs: readonly ObjectiveConfigInput[]): ObjectiveState {
  const normalized = normalizeObjectiveConfigs(configs);
  return freezeDeep({
    schemaVersion: OBJECTIVE_SCHEMA_VERSION,
    lifecycle: 'not_started',
    settled: false,
    startedAtMs: null,
    elapsedMs: 0,
    objectives: normalized.map(progressFor),
    eventCounts: Object.fromEntries(normalized.map((config) => [config.id, 0])),
    events: [],
    processedEventIds: [],
    settlement: null,
  });
}

function assertProgress(progress: unknown, path: string): asserts progress is ObjectiveProgress {
  if (!isRecord(progress) || !trimmedNonEmptyString(progress.id) || !OBJECTIVE_TYPES.has(progress.type as ObjectiveType)
    || !['pending', 'completed', 'failed'].includes(progress.status as string)
    || !isNonNegativeInteger(progress.current) || !isPositiveInteger(progress.target)
    || !Object.prototype.hasOwnProperty.call(progress, 'currentHp')
    || (progress.currentHp !== null && !isNonNegativeInteger(progress.currentHp))) {
    fail('INVALID_STATE', `${path} is invalid`);
  }
  const commonKeys = ['id', 'type', 'status', 'current', 'target', 'currentHp'];
  const optionalTargetKeys = ['targetId', 'targetSide'];
  const allowed = progress.type === 'SURVIVE'
    ? [...commonKeys, 'durationMs']
    : progress.type === 'DEFEND'
      ? [...commonKeys, ...optionalTargetKeys, 'minHp']
      : progress.type === 'TIMED'
        ? [...commonKeys, ...optionalTargetKeys, 'timeLimitMs']
        : [...commonKeys, ...optionalTargetKeys];
  exactKeys(progress, allowed, path, 'INVALID_STATE');
  if (progress.current > progress.target) fail('INVALID_STATE', `${path}.current exceeds target`);
  if (progress.targetId !== undefined && !trimmedNonEmptyString(progress.targetId)) fail('INVALID_STATE', `${path}.targetId is invalid`);
  if (progress.targetSide !== undefined && progress.targetSide !== 'player' && progress.targetSide !== 'enemy') fail('INVALID_STATE', `${path}.targetSide is invalid`);
  if (progress.type === 'DEFEND') {
    if (!nonEmptyString(progress.targetId) || !isPositiveInteger(progress.minHp) || progress.target !== progress.minHp) {
      fail('INVALID_STATE', `${path} has invalid DEFEND parameters`);
    }
    if (progress.timeLimitMs !== undefined || progress.durationMs !== undefined) {
      fail('INVALID_STATE', `${path} has invalid DEFEND fields`);
    }
    if ((progress.status === 'completed' && progress.current !== progress.target)
      || (progress.status !== 'completed' && progress.current !== 0)) {
      fail('INVALID_STATE', `${path}.current is invalid for DEFEND`);
    }
    if (progress.currentHp !== null && progress.currentHp < progress.minHp && progress.status !== 'failed') {
      fail('INVALID_STATE', `${path} must fail below its minimum HP`);
    }
    if (progress.status === 'completed' && (progress.currentHp === null || progress.currentHp < progress.minHp)) {
      fail('INVALID_STATE', `${path} is completed without a protected target`);
    }
  } else if (progress.type === 'SURVIVE') {
    if (!isPositiveInteger(progress.durationMs) || progress.target !== progress.durationMs || progress.targetId !== undefined || progress.targetSide !== undefined || progress.minHp !== undefined || progress.timeLimitMs !== undefined) {
      fail('INVALID_STATE', `${path} has invalid SURVIVE parameters`);
    }
  } else {
    if ((progress.targetId === undefined && progress.targetSide === undefined) || progress.minHp !== undefined || progress.durationMs !== undefined || progress.currentHp !== null) {
      fail('INVALID_STATE', `${path} has invalid target parameters`);
    }
    if (progress.type === 'TIMED' && !isPositiveInteger(progress.timeLimitMs)) fail('INVALID_STATE', `${path}.timeLimitMs is invalid`);
    if (progress.type === 'KILL' && progress.timeLimitMs !== undefined) fail('INVALID_STATE', `${path} has an unexpected time limit`);
  }
  if (progress.type !== 'DEFEND' && ((progress.status === 'completed' && progress.current !== progress.target)
    || (progress.status !== 'completed' && progress.current === progress.target))) {
    fail('INVALID_STATE', `${path}.status does not match its current progress`);
  }
  if (progress.status === 'failed' && progress.type !== 'DEFEND' && progress.current >= progress.target) {
    fail('INVALID_STATE', `${path} cannot fail after reaching its target`);
  }
}

function canonicalObjectiveEvent(raw: ObjectiveEvent, eventId: string): ObjectiveEventRecord {
  if (raw.type === 'BATTLE_STARTED') {
    return {
      id: eventId,
      type: raw.type,
      ...(raw.atMs === undefined ? {} : { atMs: raw.atMs }),
      ...(raw.targetHp === undefined ? {} : { targetHp: { ...raw.targetHp } }),
    };
  }
  if (raw.type === 'UNIT_DEFEATED') {
    return {
      id: eventId,
      type: raw.type,
      unitId: raw.unitId,
      side: raw.side,
      ...(raw.atMs === undefined ? {} : { atMs: raw.atMs }),
    };
  }
  if (raw.type === 'TARGET_HEALTH') {
    return {
      id: eventId,
      type: raw.type,
      targetId: raw.targetId,
      hp: raw.hp,
      ...(raw.atMs === undefined ? {} : { atMs: raw.atMs }),
    };
  }
  if (raw.type === 'TIME_ADVANCED') {
    return {
      id: eventId,
      type: raw.type,
      deltaMs: raw.deltaMs,
      ...(raw.atMs === undefined ? {} : { atMs: raw.atMs }),
    };
  }
  return {
    id: eventId,
    type: raw.type,
    outcome: raw.outcome,
    ...(raw.atMs === undefined ? {} : { atMs: raw.atMs }),
  };
}

function assertEventRecord(event: unknown, path: string): asserts event is ObjectiveEventRecord {
  if (!isRecord(event)) fail('INVALID_STATE', `${path} is invalid`);
  validateObjectiveEvent(event);
  if (!trimmedNonEmptyString(event.id) || event.eventId !== undefined) fail('INVALID_STATE', `${path} must use a canonical id`);
  const canonical = canonicalObjectiveEvent(event, event.id);
  if (stableJson(event) !== stableJson(canonical)) fail('INVALID_STATE', `${path} is not canonical`);
}

function assertState(state: unknown): asserts state is ObjectiveState {
  if (!isRecord(state) || state.schemaVersion !== OBJECTIVE_SCHEMA_VERSION
    || !['not_started', 'active', 'won', 'lost'].includes(state.lifecycle as string)
    || typeof state.settled !== 'boolean' || !isNonNegativeInteger(state.elapsedMs)
    || (state.startedAtMs !== null && !isNonNegativeInteger(state.startedAtMs))
    || !Array.isArray(state.objectives) || state.objectives.length === 0
    || !isRecord(state.eventCounts) || !Array.isArray(state.events) || !Array.isArray(state.processedEventIds)
    || !state.processedEventIds.every(trimmedNonEmptyString) || new Set(state.processedEventIds).size !== state.processedEventIds.length
    || (state.settlement !== null && !isRecord(state.settlement))) {
    fail('INVALID_STATE', 'objective state is invalid');
  }
  exactKeys(state, STATE_KEYS, 'objective state', 'INVALID_STATE');
  state.objectives.forEach((progress, index) => assertProgress(progress, `objectives[${index}]`));
  state.events.forEach((event, index) => assertEventRecord(event, `events[${index}]`));
  const objectiveIds = state.objectives.map(({ id }) => id);
  exactKeys(state.eventCounts, objectiveIds, 'objective state.eventCounts', 'INVALID_STATE');
  if (objectiveIds.length !== new Set(objectiveIds).size
    || objectiveIds.some((id) => !isNonNegativeInteger(state.eventCounts[id]))) {
    fail('INVALID_STATE', 'objective event counts are invalid');
  }
  if (state.startedAtMs !== null && !Number.isSafeInteger(state.startedAtMs + state.elapsedMs)) {
    fail('INVALID_STATE', 'objective clock overflow');
  }
  if (state.events.length !== state.processedEventIds.length
    || state.events.some((event, index) => event.id !== state.processedEventIds[index])) {
    fail('INVALID_STATE', 'objective event sequence ids are inconsistent');
  }
  if (state.events.length > 0 && state.events[0].type !== 'BATTLE_STARTED') {
    fail('INVALID_STATE', 'objective event sequence must begin with BATTLE_STARTED');
  }
  if (state.lifecycle === 'not_started' && (state.startedAtMs !== null || state.elapsedMs !== 0 || state.settled
    || state.events.length !== 0 || state.processedEventIds.length !== 0 || state.settlement !== null
    || state.objectives.some(({ status, current, currentHp }) => status !== 'pending' || current !== 0 || currentHp !== null)
    || objectiveIds.some((id) => state.eventCounts[id] !== 0))) {
    fail('INVALID_STATE', 'not_started state has runtime data');
  }
  if (state.lifecycle !== 'not_started' && state.events.length === 0) fail('INVALID_STATE', 'started state has no events');
  if (state.events.length > 0) {
    const startAtMs = state.events[0].atMs ?? 0;
    if (state.startedAtMs !== startAtMs) fail('INVALID_STATE', 'startedAtMs does not match BATTLE_STARTED');
  }
  if (state.lifecycle === 'active' && (state.startedAtMs === null || state.settled || state.settlement !== null)) fail('INVALID_STATE', 'active state has invalid settlement data');
  if ((state.lifecycle === 'won' || state.lifecycle === 'lost') && (!state.settled || state.startedAtMs === null || state.settlement === null)) fail('INVALID_STATE', 'settled state is missing settlement data');
  if (state.lifecycle === 'active' && state.objectives.some(({ status }) => status === 'failed')) fail('INVALID_STATE', 'active state has failed objectives');
  if (state.lifecycle === 'active' && allCompleted(state.objectives)) fail('INVALID_STATE', 'active state has no remaining objective');
  if (state.lifecycle === 'won' && !allCompleted(state.objectives)) fail('INVALID_STATE', 'won state has incomplete objectives');
  if (state.lifecycle === 'lost' && !state.objectives.some(({ status }) => status === 'failed')) fail('INVALID_STATE', 'lost state has no failed objective');
  if (state.settled !== (state.lifecycle === 'won' || state.lifecycle === 'lost')) fail('INVALID_STATE', 'settled flag does not match lifecycle');
  for (const progress of state.objectives) {
    const count = state.eventCounts[progress.id];
    if (progress.type === 'KILL' || progress.type === 'TIMED') {
      if (count !== progress.current) fail('INVALID_STATE', `${progress.id} event count does not match current progress`);
      if (progress.type === 'TIMED' && progress.status === 'pending' && progress.timeLimitMs !== undefined && state.elapsedMs > progress.timeLimitMs) {
        fail('INVALID_STATE', `${progress.id} is pending after its time limit`);
      }
    } else if (count !== 0) {
      fail('INVALID_STATE', `${progress.id} has an event count for an inapplicable objective type`);
    }
    if (progress.type === 'SURVIVE') {
      const expectedCurrent = Math.min(state.elapsedMs, progress.target);
      if (progress.current !== expectedCurrent) fail('INVALID_STATE', `${progress.id} current does not match elapsed time`);
      if ((state.elapsedMs >= progress.target) !== (progress.status === 'completed')) fail('INVALID_STATE', `${progress.id} status does not match elapsed time`);
    }
  }
  if (state.settlement !== null) {
    exactKeys(state.settlement, SETTLEMENT_KEYS, 'objective state.settlement', 'INVALID_STATE');
    if ((state.settlement.status !== 'won' && state.settlement.status !== 'lost')
      || !['OBJECTIVES_COMPLETE', 'TARGET_DESTROYED', 'TIMED_OUT', 'BATTLE_ENDED', 'OBJECTIVE_INCOMPLETE'].includes(state.settlement.reason)
      || !trimmedNonEmptyString(state.settlement.eventId) || !isNonNegativeInteger(state.settlement.elapsedMs)
      || state.settlement.elapsedMs !== state.elapsedMs || state.settlement.status !== state.lifecycle) {
      fail('INVALID_STATE', 'settlement is invalid');
    }
    if (state.processedEventIds.at(-1) !== state.settlement.eventId) fail('INVALID_STATE', 'settlement event must be the last processed event');
    assertSettlementMapping(state);
  }
}

function assertSettlementMapping(state: ObjectiveState): void {
  const settlement = state.settlement;
  if (settlement === null) return;
  if (settlement.reason === 'OBJECTIVES_COMPLETE') {
    if (state.lifecycle !== 'won' || settlement.status !== 'won' || !allCompleted(state.objectives)) {
      fail('INVALID_STATE', 'OBJECTIVES_COMPLETE requires won lifecycle and completed objectives');
    }
    return;
  }
  if (state.lifecycle !== 'lost' || settlement.status !== 'lost') {
    fail('INVALID_STATE', `${settlement.reason} requires lost lifecycle and status`);
  }
  if (settlement.reason === 'TARGET_DESTROYED'
    && !state.objectives.some((progress) => progress.type === 'DEFEND' && progress.status === 'failed' && progress.currentHp !== null && progress.minHp !== undefined && progress.currentHp < progress.minHp)) {
    fail('INVALID_STATE', 'target-destroyed settlement has no destroyed target');
  }
  if (settlement.reason === 'TIMED_OUT'
    && !state.objectives.some((progress) => progress.type === 'TIMED' && progress.status === 'failed' && progress.timeLimitMs !== undefined && state.elapsedMs > progress.timeLimitMs)) {
    fail('INVALID_STATE', 'timed-out settlement has no expired objective');
  }
  if (settlement.reason === 'BATTLE_ENDED') {
    fail('INVALID_STATE', 'BATTLE_ENDED is not a reachable settlement reason');
  }
  if (settlement.reason === 'OBJECTIVE_INCOMPLETE' && allCompleted(state.objectives)) {
    fail('INVALID_STATE', 'OBJECTIVE_INCOMPLETE requires incomplete objectives');
  }
}

function stateWith(state: ObjectiveState, patch: Partial<ObjectiveState>): ObjectiveState {
  return freezeDeep({ ...state, ...patch });
}

function eventIds(state: ObjectiveState, eventId: string): readonly string[] {
  return [...state.processedEventIds, eventId];
}

function settlement(state: ObjectiveState, lifecycle: 'won' | 'lost', reason: ObjectiveSettlementReason, eventId: string, objectives = state.objectives): ObjectiveState {
  return stateWith(state, {
    lifecycle,
    settled: true,
    objectives,
    settlement: { status: lifecycle, reason, eventId, elapsedMs: state.elapsedMs },
  });
}

function matching(progress: ObjectiveProgress, event: { readonly targetId?: string; readonly side?: ObjectiveSide }): boolean {
  return (progress.targetId === undefined || progress.targetId === event.targetId)
    && (progress.targetSide === undefined || progress.targetSide === event.side);
}

function allCompleted(objectives: readonly ObjectiveProgress[]): boolean {
  return objectives.every(({ status }) => status === 'completed');
}

function updateSurvivalAndTimeout(state: ObjectiveState, elapsedMs: number, eventId: string): ObjectiveState {
  const updated = state.objectives.map((progress) => {
    if (progress.type === 'SURVIVE' && progress.status === 'pending') {
      const current = Math.min(elapsedMs, progress.target);
      return current >= progress.target ? { ...progress, current, status: 'completed' as const } : { ...progress, current };
    }
    if (progress.type === 'TIMED' && progress.status === 'pending' && progress.timeLimitMs !== undefined && elapsedMs > progress.timeLimitMs) {
      return { ...progress, status: 'failed' as const };
    }
    return progress;
  });
  const next = stateWith(state, { elapsedMs, objectives: updated });
  if (updated.some(({ status }) => status === 'failed')) return settlement(next, 'lost', 'TIMED_OUT', eventId);
  if (allCompleted(updated)) return settlement(next, 'won', 'OBJECTIVES_COMPLETE', eventId);
  return next;
}

function checkEventAtCurrentTime(state: ObjectiveState, raw: Record<string, unknown>): void {
  if (raw.atMs === undefined) return;
  if (!isNonNegativeInteger(raw.atMs)) fail('INVALID_EVENT', 'event atMs must be a non-negative integer');
  const currentAtMs = (state.startedAtMs as number) + state.elapsedMs;
  if (raw.atMs !== currentAtMs) fail('INVALID_TIMING', `event must occur at current time ${currentAtMs}`);
}

function appendEvent(state: ObjectiveState, event: ObjectiveEventRecord): ObjectiveState {
  return stateWith(state, {
    events: [...state.events, event],
    processedEventIds: eventIds(state, event.id),
  });
}

function sameProgressDefinition(left: ObjectiveProgress, right: ObjectiveProgress): boolean {
  return left.id === right.id
    && left.type === right.type
    && left.target === right.target
    && left.targetId === right.targetId
    && left.targetSide === right.targetSide
    && left.minHp === right.minHp
    && left.timeLimitMs === right.timeLimitMs
    && left.durationMs === right.durationMs;
}

function assertStateMatchesConfigs(state: ObjectiveState, configs: readonly ObjectiveConfig[]): void {
  const expected = configs.map(progressFor);
  if (state.objectives.length !== expected.length || state.objectives.some((progress, index) => !sameProgressDefinition(progress, expected[index]))) {
    fail('INVALID_STATE', 'objective state does not match configuration');
  }
}

function configsFromState(state: ObjectiveState): readonly ObjectiveConfig[] {
  return normalizeObjectiveConfigs(state.objectives.map((progress) => {
    const target = progress.targetId === undefined ? {} : { targetId: progress.targetId };
    const side = progress.targetSide === undefined ? {} : { targetSide: progress.targetSide };
    if (progress.type === 'KILL') return { id: progress.id, type: progress.type, count: progress.target, ...target, ...side };
    if (progress.type === 'DEFEND') return { id: progress.id, type: progress.type, targetId: progress.targetId as string, minHp: progress.minHp as number, ...side };
    if (progress.type === 'TIMED') return { id: progress.id, type: progress.type, count: progress.target, timeLimitMs: progress.timeLimitMs as number, ...target, ...side };
    return { id: progress.id, type: progress.type, durationMs: progress.durationMs as number };
  }));
}

function assertReachableState(state: ObjectiveState, configs: readonly ObjectiveConfig[]): void {
  let replayed = createObjectiveState(configs);
  try {
    for (const event of state.events) replayed = applyObjectiveEvent(replayed, event);
  } catch (error) {
    const detail = error instanceof ObjectiveError ? error.message : 'unknown replay error';
    fail('INVALID_STATE', `objective event sequence is not reachable: ${detail}`);
  }
  if (stableJson(replayed) !== stableJson(state)) fail('INVALID_STATE', 'objective state does not match its event sequence');
}

export function validateObjectiveState(
  state: unknown,
  configs?: readonly ObjectiveConfigInput[],
): asserts state is ObjectiveState {
  assertState(state);
  const normalized = configs === undefined ? configsFromState(state) : normalizeObjectiveConfigs(configs);
  assertStateMatchesConfigs(state, normalized);
  assertReachableState(state, normalized);
}

function applyBattleStart(state: ObjectiveState, event: Extract<ObjectiveEventRecord, { type: 'BATTLE_STARTED' }>): ObjectiveState {
  if (state.lifecycle !== 'not_started') fail('INVALID_TIMING', 'BATTLE_STARTED is only valid before the first event');
  const atMs = event.atMs === undefined ? 0 : event.atMs;
  if (!isNonNegativeInteger(atMs)) fail('NEGATIVE_TIME', 'battle start time must be non-negative');
  const targetHp = event.targetHp === undefined ? {} : event.targetHp;
  if (!isRecord(targetHp)) fail('INVALID_EVENT', 'targetHp must be a record');
  for (const [targetId, hp] of Object.entries(targetHp)) {
    if (!nonEmptyString(targetId) || !isNonNegativeInteger(hp)) fail('INVALID_EVENT', 'targetHp values must be non-negative integers');
  }
  const started = appendEvent(stateWith(state, { lifecycle: 'active', startedAtMs: atMs, elapsedMs: 0 }), event);
  const updated = started.objectives.map((progress) => {
    if (progress.type !== 'DEFEND' || progress.targetId === undefined || targetHp[progress.targetId] === undefined) return progress;
    const currentHp = targetHp[progress.targetId];
    return currentHp < (progress.minHp as number)
      ? { ...progress, currentHp, status: 'failed' as const }
      : { ...progress, currentHp };
  });
  const damaged = updated.find((progress) => progress.type === 'DEFEND' && progress.currentHp !== null && progress.minHp !== undefined && progress.currentHp < progress.minHp);
  if (damaged) return settlement(stateWith(started, { objectives: updated }), 'lost', 'TARGET_DESTROYED', event.id);
  return stateWith(started, { objectives: updated });
}

function applyUnitDefeated(state: ObjectiveState, event: Extract<ObjectiveEventRecord, { type: 'UNIT_DEFEATED' }>): ObjectiveState {
  if (!nonEmptyString(event.unitId) || (event.side !== 'player' && event.side !== 'enemy')) fail('INVALID_EVENT', 'UNIT_DEFEATED needs unitId and side');
  const eventCounts = { ...state.eventCounts };
  const updated = state.objectives.map((progress) => {
    if ((progress.type !== 'KILL' && progress.type !== 'TIMED') || progress.status !== 'pending' || !matching(progress, { targetId: event.unitId, side: event.side })) return progress;
    const current = Math.min(progress.target, progress.current + 1);
    eventCounts[progress.id] = current;
    return current >= progress.target ? { ...progress, current, status: 'completed' as const } : { ...progress, current };
  });
  const next = appendEvent(stateWith(state, { objectives: updated, eventCounts }), event);
  if (updated.some(({ status }) => status === 'failed')) return settlement(next, 'lost', 'TIMED_OUT', event.id);
  if (allCompleted(updated)) return settlement(next, 'won', 'OBJECTIVES_COMPLETE', event.id);
  return next;
}

function applyTargetHealth(state: ObjectiveState, event: Extract<ObjectiveEventRecord, { type: 'TARGET_HEALTH' }>): ObjectiveState {
  if (!nonEmptyString(event.targetId) || !isNonNegativeInteger(event.hp)) fail('INVALID_EVENT', 'TARGET_HEALTH needs targetId and non-negative hp');
  const updated = state.objectives.map((progress) => {
    if (progress.type !== 'DEFEND' || progress.targetId !== event.targetId) return progress;
    return event.hp < (progress.minHp as number)
      ? { ...progress, currentHp: event.hp, status: 'failed' as const }
      : { ...progress, currentHp: event.hp };
  });
  const next = appendEvent(stateWith(state, { objectives: updated }), event);
  const destroyed = updated.find((progress) => progress.type === 'DEFEND' && progress.currentHp !== null && progress.minHp !== undefined && progress.currentHp < progress.minHp);
  if (destroyed) return settlement(next, 'lost', 'TARGET_DESTROYED', event.id);
  return next;
}

function applyBattleEnd(state: ObjectiveState, event: Extract<ObjectiveEventRecord, { type: 'BATTLE_ENDED' }>): ObjectiveState {
  if (event.outcome !== 'won' && event.outcome !== 'lost' && event.outcome !== 'draw') fail('INVALID_EVENT', 'BATTLE_ENDED outcome is invalid');
  let objectives = state.objectives;
  if (event.outcome === 'won') {
    objectives = state.objectives.map((progress) => {
      if (progress.status !== 'pending') return progress;
      if (progress.type === 'DEFEND' && progress.currentHp !== null && progress.minHp !== undefined && progress.currentHp >= progress.minHp) {
        return { ...progress, status: 'completed' as const, current: progress.minHp };
      }
      return { ...progress, status: 'failed' as const };
    });
  } else {
    objectives = state.objectives.map((progress) => progress.status === 'pending' ? { ...progress, status: 'failed' as const } : progress);
  }
  const next = appendEvent(stateWith(state, { objectives }), event);
  return allCompleted(objectives)
    ? settlement(next, 'won', 'OBJECTIVES_COMPLETE', event.id)
    : settlement(next, 'lost', 'OBJECTIVE_INCOMPLETE', event.id);
}

function validateEventKeys(raw: Record<string, unknown>, type: string): void {
  const common = ['id', 'eventId', 'type', 'atMs'];
  const allowed: Readonly<Record<string, readonly string[]>> = {
    BATTLE_STARTED: [...common, 'targetHp'],
    UNIT_DEFEATED: [...common, 'unitId', 'side'],
    TARGET_HEALTH: [...common, 'targetId', 'hp'],
    TIME_ADVANCED: [...common, 'deltaMs'],
    BATTLE_ENDED: [...common, 'outcome'],
  };
  exactKeys(raw, allowed[type] ?? common, 'objective event', 'INVALID_EVENT');
}

function validateTargetHp(targetHp: unknown): void {
  if (!isRecord(targetHp)) fail('INVALID_EVENT', 'targetHp must be a record');
  for (const key of Reflect.ownKeys(targetHp)) {
    if (typeof key !== 'string' || !trimmedNonEmptyString(key) || !isNonNegativeInteger(targetHp[key])) {
      fail('INVALID_EVENT', 'targetHp values must be non-negative integers with trimmed ids');
    }
  }
}

function validateObjectiveEvent(event: unknown): asserts event is ObjectiveEvent {
  if (!isRecord(event)) fail('INVALID_EVENT', 'objective event must be an object');
  const type = event.type as string;
  if (!OBJECTIVE_EVENT_TYPES.has(type)) fail('INVALID_EVENT', `unknown objective event type: ${String(event.type)}`);
  validateEventKeys(event, type);
  readEventId(event);
  if (event.atMs !== undefined && !isNonNegativeInteger(event.atMs)) fail('NEGATIVE_TIME', 'event atMs must be a non-negative integer');
  if (type === 'BATTLE_STARTED') {
    if (event.targetHp !== undefined) validateTargetHp(event.targetHp);
  } else if (type === 'UNIT_DEFEATED') {
    if (!trimmedNonEmptyString(event.unitId) || (event.side !== 'player' && event.side !== 'enemy')) fail('INVALID_EVENT', 'UNIT_DEFEATED needs unitId and side');
  } else if (type === 'TARGET_HEALTH') {
    if (!trimmedNonEmptyString(event.targetId) || !isNonNegativeInteger(event.hp)) fail('INVALID_EVENT', 'TARGET_HEALTH needs targetId and non-negative hp');
  } else if (type === 'TIME_ADVANCED') {
    if (!isSafeInteger(event.deltaMs)) fail('INVALID_EVENT', 'deltaMs must be an integer');
    if (event.deltaMs < 0) fail('NEGATIVE_TIME', 'deltaMs cannot be negative');
  } else if (event.outcome !== 'won' && event.outcome !== 'lost' && event.outcome !== 'draw') {
    fail('INVALID_EVENT', 'BATTLE_ENDED outcome is invalid');
  }
}

export function applyObjectiveEvent(state: ObjectiveState, event: ObjectiveEvent): ObjectiveState {
  assertState(state);
  validateObjectiveEvent(event);
  const eventId = readEventId(event);
  if (state.processedEventIds.includes(eventId)) return state;
  const recordedEvent = canonicalObjectiveEvent(event, eventId);
  if (event.type === 'BATTLE_STARTED') return applyBattleStart(state, recordedEvent);
  if (state.lifecycle === 'not_started') fail('INVALID_TIMING', `${event.type} requires BATTLE_STARTED`);
  if (state.settled) fail('STATE_SETTLED', `${event.type} cannot be applied after settlement`);
  checkEventAtCurrentTime(state, event);
  if (event.type === 'TIME_ADVANCED') {
    if (!Number.isSafeInteger(state.elapsedMs + event.deltaMs)) fail('INVALID_EVENT', 'elapsedMs overflow');
    return updateSurvivalAndTimeout(appendEvent(state, recordedEvent), state.elapsedMs + event.deltaMs, eventId);
  }
  if (event.type === 'UNIT_DEFEATED') return applyUnitDefeated(state, recordedEvent);
  if (event.type === 'TARGET_HEALTH') return applyTargetHealth(state, recordedEvent);
  return applyBattleEnd(state, recordedEvent);
}

export function startObjectives(state: ObjectiveState, atMs = 0, targetHp: Readonly<Record<string, number>> = {}): ObjectiveState {
  return applyObjectiveEvent(state, { id: 'battle-start', type: 'BATTLE_STARTED', atMs, targetHp });
}

export function settleObjectives(state: ObjectiveState, outcome: 'won' | 'lost' | 'draw', eventId = 'battle-end'): ObjectiveState {
  assertState(state);
  if (state.settled) return state;
  return applyObjectiveEvent(state, { id: eventId, type: 'BATTLE_ENDED', outcome });
}

export function serializeObjectiveState(state: ObjectiveState): string {
  validateObjectiveState(state);
  return JSON.stringify(state);
}

export function deserializeObjectiveState(serialized: string, configs: readonly ObjectiveConfigInput[]): ObjectiveState {
  if (typeof serialized !== 'string') fail('INVALID_STATE', 'serialized objective state must be a string');
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'serialized objective state is not valid JSON');
  }
  const expected = createObjectiveState(configs);
  if (!isRecord(raw)) fail('INVALID_STATE', 'serialized objective state must be an object');
  validateObjectiveState(raw, configs);
  if (raw.objectives.length !== expected.objectives.length || raw.objectives.some((progress, index) => !sameProgressDefinition(progress, expected.objectives[index]))) {
    fail('INVALID_STATE', 'serialized objective state does not match configuration');
  }
  return freezeDeep({
    ...raw,
    objectives: raw.objectives.map((progress) => ({ ...progress })),
    eventCounts: { ...raw.eventCounts },
    events: raw.events.map((event) => ({
      ...event,
      ...(event.type === 'BATTLE_STARTED' && event.targetHp === undefined ? {} : event.type === 'BATTLE_STARTED' ? { targetHp: { ...event.targetHp } } : {}),
    })),
    processedEventIds: [...raw.processedEventIds],
    settlement: raw.settlement === null ? null : { ...raw.settlement },
  }) as ObjectiveState;
}

export function restoreObjectiveState(configs: readonly ObjectiveConfigInput[], serialized: string): ObjectiveState {
  return deserializeObjectiveState(serialized, configs);
}

export function objectiveIsComplete(state: ObjectiveState, objectiveId: string): boolean {
  assertState(state);
  return state.objectives.some((progress) => progress.id === objectiveId && progress.status === 'completed');
}

export function getObjectiveProgress(state: ObjectiveState, objectiveId: string): ObjectiveProgress | undefined {
  assertState(state);
  return state.objectives.find((progress) => progress.id === objectiveId);
}

export function runObjectiveValidation(): void {
  const state = createObjectiveState([
    { id: 'kill', type: 'KILL', targetSide: 'enemy', count: 2 },
    { id: 'defend', type: 'DEFEND', targetId: 'gate', minHp: 5 },
    { id: 'timed', type: 'TIMED', targetId: 'boss', count: 1, timeLimitMs: 1000 },
    { id: 'survive', type: 'SURVIVE', durationMs: 2000 },
  ]);
  const started = startObjectives(state, 100, { gate: 10 });
  const progressed = applyObjectiveEvent(started, { id: 'clock', type: 'TIME_ADVANCED', deltaMs: 1000 });
  const defeated = applyObjectiveEvent(progressed, { id: 'boss-dead', type: 'UNIT_DEFEATED', unitId: 'boss', side: 'enemy' });
  const final = applyObjectiveEvent(defeated, { id: 'last-kill', type: 'UNIT_DEFEATED', unitId: 'minion-2', side: 'enemy' });
  if (final.lifecycle !== 'active' || final.elapsedMs !== 1000) throw new Error('objective validation setup failed');
}
