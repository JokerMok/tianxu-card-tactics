export const REINFORCEMENT_SAVE_SCHEMA_VERSION = 1 as const;

export type ReinforcementProfession = 'COMMANDER' | 'MYSTIC' | 'PACTKEEPER' | 'SHADOW_STRATEGIST';
export type ReinforcementBattleRole = 'GUARD' | 'SCOUT' | 'SUPPORT';
export type ReinforcementStatus = 'ACTIVE' | 'DOWNED' | 'DEFEATED';
export type RecoveryTrigger = 'ROUND_START' | 'MANUAL';
export type ReinforcementActionType = 'REVIVE' | 'HEAL' | 'ATTACK' | 'GUARD' | 'WAIT';
export type ReinforcementTargetPriority =
  | 'DOWNED_ALLY'
  | 'MOST_MISSING_HP_ALLY'
  | 'LOWEST_HP_ALLY'
  | 'BOSS'
  | 'HIGHEST_THREAT_ENEMY'
  | 'LOWEST_HP_ENEMY'
  | 'HIGHEST_ATTACK_ENEMY';

export interface ReinforcementRecoveryConfig {
  readonly trigger: RecoveryTrigger;
  readonly delayRounds: number;
  readonly recoverHp: number;
  readonly maxUses: number;
}

export interface ReinforcementConfig {
  readonly id: string;
  readonly name: string;
  readonly profession: ReinforcementProfession;
  readonly battleRole: ReinforcementBattleRole;
  readonly maxHp: number;
  readonly attackDamage: number;
  readonly healAmount: number;
  readonly healThreshold: number;
  readonly guardDurationRounds: number;
  readonly actionPriority: readonly ReinforcementActionType[];
  readonly targetPriority: readonly ReinforcementTargetPriority[];
  readonly downed: { readonly enabled: boolean; readonly maxOccurrences: number };
  readonly recovery: ReinforcementRecoveryConfig;
}

export interface ReinforcementRosterConfig {
  readonly id: string;
  readonly version: number;
  readonly reinforcements: readonly ReinforcementConfig[];
}

export interface ReinforcementRuntimeState {
  readonly id: string;
  readonly profession: ReinforcementProfession;
  readonly battleRole: ReinforcementBattleRole;
  readonly status: ReinforcementStatus;
  readonly hp: number;
  readonly maxHp: number;
  readonly downCount: number;
  readonly recoveriesUsed: number;
  readonly downedAtRound: number | null;
  readonly recoveryReadyRound: number | null;
}

export type ReinforcementEventType =
  | 'REINFORCEMENT_DAMAGED'
  | 'REINFORCEMENT_DOWNED'
  | 'REINFORCEMENT_DEFEATED'
  | 'REINFORCEMENT_RECOVERED'
  | 'ROUND_ADVANCED'
  | 'ACTION_EXECUTED';

export interface ReinforcementEvent {
  readonly eventId: number;
  readonly round: number;
  readonly type: ReinforcementEventType;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface ReinforcementState {
  readonly schemaVersion: typeof REINFORCEMENT_SAVE_SCHEMA_VERSION;
  readonly configId: string;
  readonly round: number;
  readonly reinforcements: readonly ReinforcementRuntimeState[];
  readonly events: readonly ReinforcementEvent[];
  readonly nextEventId: number;
  readonly processedActionIds: readonly string[];
  readonly nextActionSequence: number;
}

export type ReinforcementTargetKind = 'ALLY' | 'ENEMY' | 'BOSS';

export interface ReinforcementTarget {
  readonly id: string;
  readonly kind: ReinforcementTargetKind;
  readonly status: ReinforcementStatus;
  readonly hp: number;
  readonly maxHp: number;
  readonly threat: number;
  readonly attack: number;
}

export interface ReinforcementDecisionContext {
  readonly allies: readonly ReinforcementTarget[];
  readonly enemies: readonly ReinforcementTarget[];
  readonly boss: ReinforcementTarget | null;
}

export interface ReinforcementAction {
  readonly actionId: string;
  readonly actorId: string;
  readonly type: ReinforcementActionType;
  readonly targetId: string | null;
}

export interface ReinforcementDecision {
  readonly action: ReinforcementAction | null;
  readonly reason: 'REVIVE_DOWNED_ALLY' | 'HEAL_INJURED_ALLY' | 'ATTACK_PRIORITY_TARGET' | 'GUARD' | 'WAIT' | 'NOT_ACTIVE' | 'NO_LEGAL_ACTION';
}

export type ReinforcementEffect =
  | { readonly type: 'REVIVE_TARGET'; readonly targetId: string; readonly hp: number }
  | { readonly type: 'HEAL_TARGET'; readonly targetId: string; readonly amount: number }
  | { readonly type: 'DAMAGE_TARGET'; readonly targetId: string; readonly amount: number }
  | { readonly type: 'GUARD'; readonly targetId: string; readonly durationRounds: number };

export interface ReinforcementActionResult {
  readonly state: ReinforcementState;
  readonly effects: readonly ReinforcementEffect[];
  readonly applied: boolean;
  readonly idempotent: boolean;
}

export class ReinforcementConfigError extends Error {
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(`${configPath}: ${message}`);
    this.name = 'ReinforcementConfigError';
    this.configPath = configPath;
  }
}

export type ReinforcementStateErrorCode = 'INVALID_STATE' | 'INVALID_SAVE' | 'CONFIG_MISMATCH' | 'INVALID_ACTION' | 'ACTOR_NOT_ACTIVE' | 'INVALID_TARGET';

export class ReinforcementStateError extends Error {
  readonly code: ReinforcementStateErrorCode;

  constructor(code: ReinforcementStateErrorCode, message: string) {
    super(message);
    this.name = 'ReinforcementStateError';
    this.code = code;
  }
}

const PROFESSIONS = new Set<ReinforcementProfession>(['COMMANDER', 'MYSTIC', 'PACTKEEPER', 'SHADOW_STRATEGIST']);
const BATTLE_ROLES = new Set<ReinforcementBattleRole>(['GUARD', 'SCOUT', 'SUPPORT']);
const ACTIONS = new Set<ReinforcementActionType>(['REVIVE', 'HEAL', 'ATTACK', 'GUARD', 'WAIT']);
const TARGET_PRIORITIES = new Set<ReinforcementTargetPriority>([
  'DOWNED_ALLY', 'MOST_MISSING_HP_ALLY', 'LOWEST_HP_ALLY', 'BOSS',
  'HIGHEST_THREAT_ENEMY', 'LOWEST_HP_ENEMY', 'HIGHEST_ATTACK_ENEMY',
]);
const EVENT_TYPES = new Set<ReinforcementEventType>([
  'REINFORCEMENT_DAMAGED', 'REINFORCEMENT_DOWNED', 'REINFORCEMENT_DEFEATED',
  'REINFORCEMENT_RECOVERED', 'ROUND_ADVANCED', 'ACTION_EXECUTED',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], path: string): void {
  const expected = new Set(required);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new ReinforcementConfigError(`${path}.${key}`, '缺少字段');
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new ReinforcementConfigError(`${path}.${key}`, '未知字段');
}

function stateExactKeys(value: Record<string, unknown>, required: readonly string[], path: string): void {
  const expected = new Set(required);
  for (const key of required) if (!Object.hasOwn(value, key)) throw new ReinforcementStateError('INVALID_STATE', `${path}.${key} 缺少字段`);
  for (const key of Object.keys(value)) if (!expected.has(key)) throw new ReinforcementStateError('INVALID_STATE', `${path}.${key} 是未知字段`);
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new ReinforcementConfigError(path, '必须是非空字符串');
  return value;
}

function safeInteger(value: unknown, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new ReinforcementConfigError(path, `必须是大于等于 ${minimum} 的安全整数`);
  return value as number;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new ReinforcementConfigError(path, '必须是 boolean');
  return value;
}

function enumValue<T extends string>(value: unknown, values: ReadonlySet<T>, path: string): T {
  if (typeof value !== 'string' || !values.has(value as T)) throw new ReinforcementConfigError(path, '非法枚举值');
  return value as T;
}

function uniqueEnumArray<T extends string>(value: unknown, values: ReadonlySet<T>, path: string): T[] {
  if (!Array.isArray(value) || value.length === 0) throw new ReinforcementConfigError(path, '必须是非空数组');
  const result = value.map((item, index) => enumValue(item, values, `${path}[${index}]`));
  if (new Set(result).size !== result.length) throw new ReinforcementConfigError(path, '不得包含重复值');
  return result;
}

function cloneDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map((child) => cloneDeep(child)) as T;
  if (isRecord(value)) {
    const copy: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) copy[key] = cloneDeep(child);
    return copy as T;
  }
  return value;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function freezeCopy<T>(value: T): T {
  return freezeDeep(cloneDeep(value));
}

function copyConfig(config: ReinforcementRosterConfig): ReinforcementRosterConfig {
  return freezeCopy({
    id: config.id,
    version: config.version,
    reinforcements: config.reinforcements.map((unit) => ({
      ...unit,
      actionPriority: [...unit.actionPriority],
      targetPriority: [...unit.targetPriority],
      downed: { ...unit.downed },
      recovery: { ...unit.recovery },
    })),
  });
}

function validateUnitConfig(value: unknown, path: string): ReinforcementConfig {
  if (!isRecord(value)) throw new ReinforcementConfigError(path, '必须是对象');
  exactKeys(value, [
    'id', 'name', 'profession', 'battleRole', 'maxHp', 'attackDamage', 'healAmount',
    'healThreshold', 'guardDurationRounds', 'actionPriority', 'targetPriority', 'downed', 'recovery',
  ], path);
  const id = nonEmptyString(value.id, `${path}.id`);
  const name = nonEmptyString(value.name, `${path}.name`);
  const profession = enumValue(value.profession, PROFESSIONS, `${path}.profession`);
  const battleRole = enumValue(value.battleRole, BATTLE_ROLES, `${path}.battleRole`);
  const maxHp = safeInteger(value.maxHp, `${path}.maxHp`, 1);
  const attackDamage = safeInteger(value.attackDamage, `${path}.attackDamage`, 1);
  const healAmount = safeInteger(value.healAmount, `${path}.healAmount`, 1);
  const healThreshold = safeInteger(value.healThreshold, `${path}.healThreshold`, 0);
  const guardDurationRounds = safeInteger(value.guardDurationRounds, `${path}.guardDurationRounds`, 1);
  const actionPriority = uniqueEnumArray(value.actionPriority, ACTIONS, `${path}.actionPriority`);
  const targetPriority = uniqueEnumArray(value.targetPriority, TARGET_PRIORITIES, `${path}.targetPriority`);

  if (!isRecord(value.downed)) throw new ReinforcementConfigError(`${path}.downed`, '必须是对象');
  exactKeys(value.downed, ['enabled', 'maxOccurrences'], `${path}.downed`);
  const downedEnabled = booleanValue(value.downed.enabled, `${path}.downed.enabled`);
  const maxOccurrences = safeInteger(value.downed.maxOccurrences, `${path}.downed.maxOccurrences`, 0);
  if (downedEnabled && maxOccurrences === 0) throw new ReinforcementConfigError(`${path}.downed.maxOccurrences`, '启用倒地时必须至少允许一次');
  if (!downedEnabled && maxOccurrences !== 0) throw new ReinforcementConfigError(`${path}.downed.maxOccurrences`, '禁用倒地时必须为 0');

  if (!isRecord(value.recovery)) throw new ReinforcementConfigError(`${path}.recovery`, '必须是对象');
  exactKeys(value.recovery, ['trigger', 'delayRounds', 'recoverHp', 'maxUses'], `${path}.recovery`);
  const trigger = enumValue(value.recovery.trigger, new Set<RecoveryTrigger>(['ROUND_START', 'MANUAL']), `${path}.recovery.trigger`);
  const delayRounds = safeInteger(value.recovery.delayRounds, `${path}.recovery.delayRounds`, 0);
  const recoverHp = safeInteger(value.recovery.recoverHp, `${path}.recovery.recoverHp`, 1);
  if (recoverHp > maxHp) throw new ReinforcementConfigError(`${path}.recovery.recoverHp`, '不得超过 maxHp');
  const maxUses = safeInteger(value.recovery.maxUses, `${path}.recovery.maxUses`, 0);
  if (maxOccurrences > maxUses) throw new ReinforcementConfigError(`${path}.downed.maxOccurrences`, '不得超过 recovery.maxUses');
  if (!downedEnabled && maxUses !== 0) throw new ReinforcementConfigError(`${path}.recovery.maxUses`, '禁用倒地时恢复次数必须为 0');

  return {
    id, name, profession, battleRole, maxHp, attackDamage, healAmount, healThreshold, guardDurationRounds,
    actionPriority, targetPriority,
    downed: { enabled: downedEnabled, maxOccurrences },
    recovery: { trigger, delayRounds, recoverHp, maxUses },
  };
}

export function validateReinforcementConfig(value: unknown, configPath = 'reinforcements'): ReinforcementRosterConfig {
  if (!isRecord(value)) throw new ReinforcementConfigError(configPath, '必须是对象');
  exactKeys(value, ['id', 'version', 'reinforcements'], configPath);
  const id = nonEmptyString(value.id, `${configPath}.id`);
  const version = safeInteger(value.version, `${configPath}.version`, 1);
  if (!Array.isArray(value.reinforcements) || value.reinforcements.length < 1 || value.reinforcements.length > 3) {
    throw new ReinforcementConfigError(`${configPath}.reinforcements`, '必须包含 1 到 3 名援军');
  }
  const ids = new Set<string>();
  const reinforcements = value.reinforcements.map((unit, index) => {
    const parsed = validateUnitConfig(unit, `${configPath}.reinforcements[${index}]`);
    if (ids.has(parsed.id)) throw new ReinforcementConfigError(`${configPath}.reinforcements[${index}].id`, `重复援军: ${parsed.id}`);
    ids.add(parsed.id);
    return parsed;
  });
  return copyConfig({ id, version, reinforcements });
}

export const DEFAULT_REINFORCEMENT_CONFIG = validateReinforcementConfig({
  id: 'M5-09-BOSS-REINFORCEMENTS',
  version: 1,
  reinforcements: [
    {
      id: 'C001', name: '晏归', profession: 'PACTKEEPER', battleRole: 'SUPPORT', maxHp: 18,
      attackDamage: 3, healAmount: 5, healThreshold: 3, guardDurationRounds: 1,
      actionPriority: ['REVIVE', 'HEAL', 'ATTACK', 'GUARD', 'WAIT'],
      targetPriority: ['DOWNED_ALLY', 'MOST_MISSING_HP_ALLY', 'BOSS', 'HIGHEST_THREAT_ENEMY'],
      downed: { enabled: true, maxOccurrences: 1 },
      recovery: { trigger: 'ROUND_START', delayRounds: 1, recoverHp: 6, maxUses: 1 },
    },
    {
      id: 'C002', name: '翎照', profession: 'SHADOW_STRATEGIST', battleRole: 'SCOUT', maxHp: 14,
      attackDamage: 5, healAmount: 2, healThreshold: 99, guardDurationRounds: 1,
      actionPriority: ['ATTACK', 'GUARD', 'WAIT'],
      targetPriority: ['BOSS', 'HIGHEST_THREAT_ENEMY', 'LOWEST_HP_ENEMY'],
      downed: { enabled: true, maxOccurrences: 1 },
      recovery: { trigger: 'ROUND_START', delayRounds: 2, recoverHp: 4, maxUses: 1 },
    },
    {
      id: 'C003', name: '砺山', profession: 'COMMANDER', battleRole: 'GUARD', maxHp: 24,
      attackDamage: 4, healAmount: 2, healThreshold: 99, guardDurationRounds: 2,
      actionPriority: ['ATTACK', 'GUARD', 'WAIT'],
      targetPriority: ['BOSS', 'HIGHEST_THREAT_ENEMY', 'LOWEST_HP_ENEMY'],
      downed: { enabled: true, maxOccurrences: 1 },
      recovery: { trigger: 'ROUND_START', delayRounds: 2, recoverHp: 8, maxUses: 1 },
    },
  ],
});

export const BOSS_REINFORCEMENT_CONFIG = DEFAULT_REINFORCEMENT_CONFIG;

function configFor(config: ReinforcementRosterConfig, id: string): ReinforcementConfig {
  const unit = config.reinforcements.find((candidate) => candidate.id === id);
  if (!unit) throw new ReinforcementStateError('INVALID_STATE', `unknown reinforcement: ${id}`);
  return unit;
}

function stateError(code: ReinforcementStateErrorCode, message: string): never {
  throw new ReinforcementStateError(code, message);
}

function makeRuntime(config: ReinforcementConfig): ReinforcementRuntimeState {
  return {
    id: config.id, profession: config.profession, battleRole: config.battleRole, status: 'ACTIVE',
    hp: config.maxHp, maxHp: config.maxHp, downCount: 0, recoveriesUsed: 0,
    downedAtRound: null, recoveryReadyRound: null,
  };
}

function addEvent(
  state: ReinforcementState,
  type: ReinforcementEventType,
  payload: Readonly<Record<string, unknown>>,
  patch: Partial<ReinforcementState> = {},
): ReinforcementState {
  if (state.nextEventId >= Number.MAX_SAFE_INTEGER) stateError('INVALID_STATE', 'event id would overflow');
  const event: ReinforcementEvent = {
    eventId: state.nextEventId,
    round: state.round,
    type,
    payload: cloneDeep(payload),
  };
  return freezeCopy({ ...state, ...patch, events: [...state.events, event], nextEventId: state.nextEventId + 1 });
}

function replaceRuntime(state: ReinforcementState, runtime: ReinforcementRuntimeState): ReinforcementState {
  return freezeCopy({ ...state, reinforcements: state.reinforcements.map((item) => item.id === runtime.id ? runtime : item) });
}

function assertSafeStateNumber(value: unknown, path: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) stateError('INVALID_STATE', `${path} must be a safe integer >= ${minimum}`);
  return value as number;
}

function validateRuntime(value: unknown, config: ReinforcementConfig, path: string): ReinforcementRuntimeState {
  if (!isRecord(value)) stateError('INVALID_STATE', `${path} must be an object`);
  stateExactKeys(value, [
    'id', 'profession', 'battleRole', 'status', 'hp', 'maxHp', 'downCount', 'recoveriesUsed', 'downedAtRound', 'recoveryReadyRound',
  ], path);
  if (value.id !== config.id || value.profession !== config.profession || value.battleRole !== config.battleRole) {
    stateError('INVALID_STATE', `${path} identity does not match config`);
  }
  if (value.status !== 'ACTIVE' && value.status !== 'DOWNED' && value.status !== 'DEFEATED') stateError('INVALID_STATE', `${path}.status is invalid`);
  if (value.maxHp !== config.maxHp) stateError('INVALID_STATE', `${path}.maxHp does not match config`);
  const hp = assertSafeStateNumber(value.hp, `${path}.hp`, 0);
  const downCount = assertSafeStateNumber(value.downCount, `${path}.downCount`, 0);
  const recoveriesUsed = assertSafeStateNumber(value.recoveriesUsed, `${path}.recoveriesUsed`, 0);
  if (downCount > config.downed.maxOccurrences || recoveriesUsed > config.recovery.maxUses) stateError('INVALID_STATE', `${path} counters exceed config`);
  if (value.status === 'ACTIVE' && (hp < 1 || hp > config.maxHp)) stateError('INVALID_STATE', `${path}.hp is invalid for ACTIVE`);
  if (value.status !== 'ACTIVE' && hp !== 0) stateError('INVALID_STATE', `${path}.hp must be 0 when not ACTIVE`);
  const downedAtRound = value.downedAtRound === null ? null : assertSafeStateNumber(value.downedAtRound, `${path}.downedAtRound`, 0);
  const recoveryReadyRound = value.recoveryReadyRound === null ? null : assertSafeStateNumber(value.recoveryReadyRound, `${path}.recoveryReadyRound`, 0);
  if (value.status === 'DOWNED' && (downCount === 0 || downedAtRound === null || recoveryReadyRound === null || recoveryReadyRound < downedAtRound)) {
    stateError('INVALID_STATE', `${path} downed metadata is invalid`);
  }
  if (value.status === 'DOWNED' && recoveriesUsed >= config.recovery.maxUses) {
    stateError('INVALID_STATE', `${path} is downed with an exhausted recovery budget`);
  }
  if (value.status === 'ACTIVE' && (downedAtRound !== null || recoveryReadyRound !== null)) stateError('INVALID_STATE', `${path} has stale downed metadata`);
  return {
    id: value.id as string, profession: value.profession as ReinforcementProfession, battleRole: value.battleRole as ReinforcementBattleRole,
    status: value.status as ReinforcementStatus, hp, maxHp: value.maxHp as number, downCount, recoveriesUsed,
    downedAtRound, recoveryReadyRound,
  };
}

function validateEvent(value: unknown, index: number, stateRound: number): ReinforcementEvent {
  if (!isRecord(value)) stateError('INVALID_STATE', `events[${index}] must be an object`);
  stateExactKeys(value, ['eventId', 'round', 'type', 'payload'], `events[${index}]`);
  const eventId = assertSafeStateNumber(value.eventId, `events[${index}].eventId`, 1);
  const round = assertSafeStateNumber(value.round, `events[${index}].round`, 0);
  if (round > stateRound || typeof value.type !== 'string' || !EVENT_TYPES.has(value.type as ReinforcementEventType) || !isRecord(value.payload)) {
    stateError('INVALID_STATE', `events[${index}] has invalid fields`);
  }
  return { eventId, round, type: value.type as ReinforcementEventType, payload: cloneDeep(value.payload) };
}

export function validateReinforcementState(configInput: unknown, value: unknown): ReinforcementState {
  const config = validateReinforcementConfig(configInput);
  if (!isRecord(value)) stateError('INVALID_STATE', 'reinforcement state must be an object');
  stateExactKeys(value, ['schemaVersion', 'configId', 'round', 'reinforcements', 'events', 'nextEventId', 'processedActionIds', 'nextActionSequence'], 'state');
  if (value.schemaVersion !== REINFORCEMENT_SAVE_SCHEMA_VERSION) stateError('INVALID_STATE', 'unsupported reinforcement save version');
  if (value.configId !== config.id) stateError('CONFIG_MISMATCH', `state config mismatch: ${String(value.configId)}`);
  const round = assertSafeStateNumber(value.round, 'state.round', 0);
  if (!Array.isArray(value.reinforcements) || value.reinforcements.length !== config.reinforcements.length) stateError('INVALID_STATE', 'reinforcements count does not match config');
  const reinforcements = config.reinforcements.map((unit, index) => validateRuntime((value.reinforcements as unknown[])[index], unit, `state.reinforcements[${index}]`));
  if (!Array.isArray(value.events)) stateError('INVALID_STATE', 'state.events must be an array');
  const events = value.events.map((event, index) => validateEvent(event, index, round));
  let expectedEventId = 1;
  for (const event of events) {
    if (event.eventId !== expectedEventId) stateError('INVALID_STATE', 'event IDs must be contiguous');
    expectedEventId += 1;
  }
  const nextEventId = assertSafeStateNumber(value.nextEventId, 'state.nextEventId', 1);
  if (nextEventId !== expectedEventId) stateError('INVALID_STATE', 'nextEventId does not follow events');
  if (!Array.isArray(value.processedActionIds) || value.processedActionIds.some((id) => typeof id !== 'string' || id.length === 0)) stateError('INVALID_STATE', 'processedActionIds is invalid');
  const processedActionIds = [...value.processedActionIds] as string[];
  if (new Set(processedActionIds).size !== processedActionIds.length) stateError('INVALID_STATE', 'processedActionIds must be unique');
  const nextActionSequence = assertSafeStateNumber(value.nextActionSequence, 'state.nextActionSequence', 1);
  return freezeCopy({
    schemaVersion: REINFORCEMENT_SAVE_SCHEMA_VERSION, configId: config.id, round, reinforcements, events,
    nextEventId, processedActionIds, nextActionSequence,
  });
}

export interface ReinforcementStateOptions { readonly round?: number }

export function createReinforcementState(configInput: unknown = DEFAULT_REINFORCEMENT_CONFIG, options: ReinforcementStateOptions = {}): ReinforcementState {
  const config = validateReinforcementConfig(configInput);
  const round = options.round ?? 0;
  if (!Number.isSafeInteger(round) || round < 0) throw new ReinforcementStateError('INVALID_STATE', 'initial round is invalid');
  return freezeCopy({
    schemaVersion: REINFORCEMENT_SAVE_SCHEMA_VERSION,
    configId: config.id,
    round,
    reinforcements: config.reinforcements.map(makeRuntime),
    events: [],
    nextEventId: 1,
    processedActionIds: [],
    nextActionSequence: 1,
  });
}

function checkedState(configInput: unknown, state: ReinforcementState): { config: ReinforcementRosterConfig; state: ReinforcementState } {
  const config = validateReinforcementConfig(configInput);
  return { config, state: validateReinforcementState(config, state) };
}

function runtimeById(state: ReinforcementState, id: string): ReinforcementRuntimeState {
  const runtime = state.reinforcements.find((item) => item.id === id);
  if (!runtime) stateError('INVALID_STATE', `unknown reinforcement: ${id}`);
  return runtime;
}

export function damageReinforcement(configInput: unknown, stateInput: ReinforcementState, id: string, amount: number): ReinforcementState {
  const { config, state } = checkedState(configInput, stateInput);
  if (!Number.isSafeInteger(amount) || amount <= 0) stateError('INVALID_STATE', 'damage amount must be a positive safe integer');
  const runtime = runtimeById(state, id);
  if (runtime.status !== 'ACTIVE') return stateInput;
  const unitConfig = configFor(config, id);
  const hp = runtime.hp - amount;
  if (hp > 0) {
    const next = replaceRuntime(state, { ...runtime, hp });
    return addEvent(next, 'REINFORCEMENT_DAMAGED', { id, amount, hp });
  }
  if (
    unitConfig.downed.enabled
    && runtime.downCount < unitConfig.downed.maxOccurrences
    && runtime.recoveriesUsed < unitConfig.recovery.maxUses
  ) {
    if (state.round > Number.MAX_SAFE_INTEGER - unitConfig.recovery.delayRounds) stateError('INVALID_STATE', 'recovery round would overflow');
    const downed = {
      ...runtime, status: 'DOWNED' as const, hp: 0, downCount: runtime.downCount + 1,
      downedAtRound: state.round, recoveryReadyRound: state.round + unitConfig.recovery.delayRounds,
    };
    return addEvent(replaceRuntime(state, downed), 'REINFORCEMENT_DOWNED', {
      id, amount, downCount: downed.downCount, recoveryReadyRound: downed.recoveryReadyRound,
    });
  }
  const defeated = { ...runtime, status: 'DEFEATED' as const, hp: 0, downedAtRound: state.round, recoveryReadyRound: null };
  return addEvent(replaceRuntime(state, defeated), 'REINFORCEMENT_DEFEATED', { id, amount });
}

function recoverInternal(config: ReinforcementConfig, state: ReinforcementState, runtime: ReinforcementRuntimeState): ReinforcementState {
  if (
    runtime.status !== 'DOWNED'
    || runtime.downedAtRound === null
    || runtime.recoveryReadyRound === null
    || state.round <= runtime.downedAtRound
    || state.round < runtime.recoveryReadyRound
  ) return state;
  if (runtime.recoveriesUsed >= config.recovery.maxUses) return state;
  const recovered = {
    ...runtime, status: 'ACTIVE' as const, hp: config.recovery.recoverHp, recoveriesUsed: runtime.recoveriesUsed + 1,
    downedAtRound: null, recoveryReadyRound: null,
  };
  return addEvent(replaceRuntime(state, recovered), 'REINFORCEMENT_RECOVERED', {
    id: runtime.id, hp: recovered.hp, recoveriesUsed: recovered.recoveriesUsed,
  });
}

export function recoverReinforcement(configInput: unknown, stateInput: ReinforcementState, id: string): ReinforcementState {
  const { config, state } = checkedState(configInput, stateInput);
  const unitConfig = configFor(config, id);
  const runtime = runtimeById(state, id);
  const recovered = recoverInternal(unitConfig, state, runtime);
  return recovered === state ? stateInput : recovered;
}

export function advanceReinforcementRound(configInput: unknown, stateInput: ReinforcementState): ReinforcementState {
  const { config, state } = checkedState(configInput, stateInput);
  if (state.round >= Number.MAX_SAFE_INTEGER) stateError('INVALID_STATE', 'round would overflow');
  let next = addEvent(freezeCopy({ ...state, round: state.round + 1 }), 'ROUND_ADVANCED', { round: state.round + 1 });
  for (const unit of config.reinforcements) {
    if (unit.recovery.trigger !== 'ROUND_START') continue;
    next = recoverInternal(unit, next, runtimeById(next, unit.id));
  }
  return next;
}

function assertTarget(value: ReinforcementTarget, path: string): ReinforcementTarget {
  if (!isRecord(value)) stateError('INVALID_TARGET', `${path} must be an object`);
  const expected = ['id', 'kind', 'status', 'hp', 'maxHp', 'threat', 'attack'];
  try { stateExactKeys(value, expected, path); } catch (error) { if (error instanceof ReinforcementStateError) stateError('INVALID_TARGET', error.message); throw error; }
  if (typeof value.id !== 'string' || value.id.length === 0) stateError('INVALID_TARGET', `${path}.id is invalid`);
  if (value.kind !== 'ALLY' && value.kind !== 'ENEMY' && value.kind !== 'BOSS') stateError('INVALID_TARGET', `${path}.kind is invalid`);
  if (value.status !== 'ACTIVE' && value.status !== 'DOWNED' && value.status !== 'DEFEATED') stateError('INVALID_TARGET', `${path}.status is invalid`);
  const hp = value.hp; const maxHp = value.maxHp; const threat = value.threat; const attack = value.attack;
  if (!Number.isSafeInteger(hp) || !Number.isSafeInteger(maxHp) || !Number.isSafeInteger(threat) || !Number.isSafeInteger(attack) || hp < 0 || maxHp <= 0 || hp > maxHp || threat < 0 || attack < 0) stateError('INVALID_TARGET', `${path} numeric fields are invalid`);
  if (value.status === 'ACTIVE' && hp === 0) stateError('INVALID_TARGET', `${path} ACTIVE target must have hp`);
  if (value.status !== 'ACTIVE' && hp !== 0) stateError('INVALID_TARGET', `${path} inactive target must have zero hp`);
  return { id: value.id, kind: value.kind, status: value.status, hp, maxHp, threat, attack } as ReinforcementTarget;
}

function normalizeContext(value: ReinforcementDecisionContext): ReinforcementDecisionContext {
  if (!isRecord(value)) stateError('INVALID_TARGET', 'decision context must be an object');
  const keys = new Set(['allies', 'enemies', 'boss']);
  for (const key of ['allies', 'enemies', 'boss']) if (!Object.hasOwn(value, key)) stateError('INVALID_TARGET', `context.${key} is missing`);
  for (const key of Object.keys(value)) if (!keys.has(key)) stateError('INVALID_TARGET', `context.${key} is unknown`);
  if (!Array.isArray(value.allies) || !Array.isArray(value.enemies)) stateError('INVALID_TARGET', 'context allies/enemies must be arrays');
  const allies = value.allies.map((target, index) => assertTarget(target, `context.allies[${index}]`));
  const enemies = value.enemies.map((target, index) => assertTarget(target, `context.enemies[${index}]`));
  if (allies.some((target) => target.kind !== 'ALLY') || enemies.some((target) => target.kind !== 'ENEMY')) stateError('INVALID_TARGET', 'target kind does not match collection');
  if (new Set([...allies, ...enemies].map((target) => target.id)).size !== allies.length + enemies.length) stateError('INVALID_TARGET', 'duplicate target id');
  const boss = value.boss === null ? null : assertTarget(value.boss, 'context.boss');
  if (boss && boss.kind !== 'BOSS') stateError('INVALID_TARGET', 'boss kind must be BOSS');
  if (boss && [...allies, ...enemies].some((target) => target.id === boss.id)) stateError('INVALID_TARGET', 'duplicate boss id');
  return { allies, enemies, boss };
}

function candidatesForPriority(priority: ReinforcementTargetPriority, context: ReinforcementDecisionContext): ReinforcementTarget[] {
  if (priority === 'DOWNED_ALLY') return context.allies.filter((target) => target.status === 'DOWNED');
  if (priority === 'MOST_MISSING_HP_ALLY' || priority === 'LOWEST_HP_ALLY') return context.allies.filter((target) => target.status === 'ACTIVE' && target.hp < target.maxHp);
  if (priority === 'BOSS') return context.boss && context.boss.status === 'ACTIVE' ? [context.boss] : [];
  if (priority === 'HIGHEST_THREAT_ENEMY' || priority === 'LOWEST_HP_ENEMY' || priority === 'HIGHEST_ATTACK_ENEMY') return context.enemies.filter((target) => target.status === 'ACTIVE');
  return [];
}

function chooseTarget(action: ReinforcementActionType, config: ReinforcementConfig, context: ReinforcementDecisionContext): ReinforcementTarget | null {
  for (const priority of config.targetPriority) {
    const candidates = candidatesForPriority(priority, context).filter((target) => {
      if (action === 'REVIVE') return priority === 'DOWNED_ALLY' && target.status === 'DOWNED';
      if (action === 'HEAL') return (priority === 'MOST_MISSING_HP_ALLY' || priority === 'LOWEST_HP_ALLY') && target.status === 'ACTIVE' && target.maxHp - target.hp >= config.healThreshold;
      if (action === 'ATTACK') return priority === 'BOSS' || priority.endsWith('_ENEMY');
      return false;
    });
    if (candidates.length === 0) continue;
    return [...candidates].sort((a, b) => {
      if (priority === 'DOWNED_ALLY') return a.id.localeCompare(b.id);
      if (priority === 'MOST_MISSING_HP_ALLY') return (b.maxHp - b.hp) - (a.maxHp - a.hp) || a.id.localeCompare(b.id);
      if (priority === 'LOWEST_HP_ALLY' || priority === 'LOWEST_HP_ENEMY') return a.hp - b.hp || a.id.localeCompare(b.id);
      if (priority === 'HIGHEST_ATTACK_ENEMY') return b.attack - a.attack || a.id.localeCompare(b.id);
      return b.threat - a.threat || a.id.localeCompare(b.id);
    })[0];
  }
  return null;
}

function makeAction(state: ReinforcementState, actorId: string, type: ReinforcementActionType, targetId: string | null): ReinforcementAction {
  return { actionId: `${actorId}:round-${state.round}:action-${state.nextActionSequence}`, actorId, type, targetId };
}

export function planReinforcementAction(configInput: unknown, stateInput: ReinforcementState, actorId: string, contextInput: ReinforcementDecisionContext): ReinforcementDecision {
  const { config, state } = checkedState(configInput, stateInput);
  const context = normalizeContext(contextInput);
  const runtime = runtimeById(state, actorId);
  if (runtime.status !== 'ACTIVE') return { action: null, reason: 'NOT_ACTIVE' };
  const unitConfig = configFor(config, actorId);
  for (const type of unitConfig.actionPriority) {
    if (type === 'REVIVE' || type === 'HEAL' || type === 'ATTACK') {
      const target = chooseTarget(type, unitConfig, context);
      if (target) return {
        action: makeAction(state, actorId, type, target.id),
        reason: type === 'REVIVE' ? 'REVIVE_DOWNED_ALLY' : type === 'HEAL' ? 'HEAL_INJURED_ALLY' : 'ATTACK_PRIORITY_TARGET',
      };
    } else if (type === 'GUARD') {
      return { action: makeAction(state, actorId, type, null), reason: 'GUARD' };
    } else if (type === 'WAIT') {
      return { action: makeAction(state, actorId, type, null), reason: 'WAIT' };
    }
  }
  return { action: null, reason: 'NO_LEGAL_ACTION' };
}

function actionTarget(context: ReinforcementDecisionContext, action: ReinforcementAction): ReinforcementTarget | null {
  if (action.targetId === null) return null;
  return [...context.allies, ...context.enemies, ...(context.boss ? [context.boss] : [])].find((target) => target.id === action.targetId) ?? null;
}

export function executeReinforcementAction(configInput: unknown, stateInput: ReinforcementState, actionInput: ReinforcementAction, contextInput: ReinforcementDecisionContext): ReinforcementActionResult {
  const { config, state } = checkedState(configInput, stateInput);
  const context = normalizeContext(contextInput);
  if (!isRecord(actionInput)) stateError('INVALID_ACTION', 'action must be an object');
  stateExactKeys(actionInput, ['actionId', 'actorId', 'type', 'targetId'], 'action');
  if (typeof actionInput.actionId !== 'string' || actionInput.actionId.length === 0 || typeof actionInput.actorId !== 'string' || actionInput.actorId.length === 0) stateError('INVALID_ACTION', 'action identity is invalid');
  if (!ACTIONS.has(actionInput.type as ReinforcementActionType) || typeof actionInput.targetId !== 'string' && actionInput.targetId !== null) stateError('INVALID_ACTION', 'action fields are invalid');
  const action = actionInput as ReinforcementAction;
  if (state.processedActionIds.includes(action.actionId)) return { state: stateInput, effects: [], applied: false, idempotent: true };
  const runtime = runtimeById(state, action.actorId);
  if (runtime.status !== 'ACTIVE') stateError('ACTOR_NOT_ACTIVE', `actor is ${runtime.status}`);
  const unitConfig = configFor(config, action.actorId);
  if (!unitConfig.actionPriority.includes(action.type)) stateError('INVALID_ACTION', `${action.type} is not configured for ${action.actorId}`);
  const target = actionTarget(context, action);
  let effect: ReinforcementEffect | undefined;
  if (action.type === 'ATTACK') {
    if (!target || target.status !== 'ACTIVE' || (target.kind !== 'ENEMY' && target.kind !== 'BOSS')) stateError('INVALID_TARGET', 'attack target is not active enemy/boss');
    const plannedTarget = chooseTarget(action.type, unitConfig, context);
    if (!plannedTarget || plannedTarget.id !== target.id) stateError('INVALID_TARGET', 'attack target does not match configured priority');
    effect = { type: 'DAMAGE_TARGET', targetId: target.id, amount: unitConfig.attackDamage };
  } else if (action.type === 'HEAL') {
    if (!target || target.kind !== 'ALLY' || target.status !== 'ACTIVE' || target.maxHp - target.hp < unitConfig.healThreshold) stateError('INVALID_TARGET', 'heal target is not a legal injured ally');
    const plannedTarget = chooseTarget(action.type, unitConfig, context);
    if (!plannedTarget || plannedTarget.id !== target.id) stateError('INVALID_TARGET', 'heal target does not match configured priority');
    effect = { type: 'HEAL_TARGET', targetId: target.id, amount: Math.min(unitConfig.healAmount, target.maxHp - target.hp) };
  } else if (action.type === 'REVIVE') {
    if (!target || target.kind !== 'ALLY' || target.status !== 'DOWNED') stateError('INVALID_TARGET', 'revive target is not a downed ally');
    const plannedTarget = chooseTarget(action.type, unitConfig, context);
    if (!plannedTarget || plannedTarget.id !== target.id) stateError('INVALID_TARGET', 'revive target does not match configured priority');
    effect = { type: 'REVIVE_TARGET', targetId: target.id, hp: unitConfig.recovery.recoverHp };
  } else if ((action.type === 'GUARD' || action.type === 'WAIT') && action.targetId !== null) {
    stateError('INVALID_TARGET', `${action.type} cannot have a target`);
  } else if (action.type === 'GUARD') {
    effect = { type: 'GUARD', targetId: action.actorId, durationRounds: unitConfig.guardDurationRounds };
  }
  if (state.nextActionSequence >= Number.MAX_SAFE_INTEGER) stateError('INVALID_STATE', 'action sequence would overflow');
  const processedActionIds = [...state.processedActionIds, action.actionId];
  const actionState = freezeCopy({ ...state, processedActionIds, nextActionSequence: state.nextActionSequence + 1 });
  const next = addEvent(actionState, 'ACTION_EXECUTED', { actionId: action.actionId, actorId: action.actorId, type: action.type, targetId: action.targetId });
  return { state: next, effects: effect ? [effect] : [], applied: true, idempotent: false };
}

function validateSerializableState(value: unknown): ReinforcementState {
  if (!isRecord(value)) stateError('INVALID_STATE', 'reinforcement state must be an object');
  stateExactKeys(value, ['schemaVersion', 'configId', 'round', 'reinforcements', 'events', 'nextEventId', 'processedActionIds', 'nextActionSequence'], 'state');
  if (value.schemaVersion !== REINFORCEMENT_SAVE_SCHEMA_VERSION || typeof value.configId !== 'string' || value.configId.length === 0) stateError('INVALID_STATE', 'save header is invalid');
  const round = assertSafeStateNumber(value.round, 'state.round', 0);
  if (!Array.isArray(value.reinforcements) || !Array.isArray(value.events) || !Array.isArray(value.processedActionIds)) stateError('INVALID_STATE', 'save arrays are invalid');
  const reinforcements = value.reinforcements.map((item, index) => {
    if (!isRecord(item)) stateError('INVALID_STATE', `state.reinforcements[${index}] must be an object`);
    return { ...item } as ReinforcementRuntimeState;
  });
  const events = value.events.map((event, index) => validateEvent(event, index, round));
  let expectedEventId = 1;
  for (const event of events) {
    if (event.eventId !== expectedEventId) stateError('INVALID_STATE', 'event IDs must be contiguous');
    expectedEventId += 1;
  }
  const nextEventId = assertSafeStateNumber(value.nextEventId, 'state.nextEventId', 1);
  if (nextEventId !== expectedEventId) stateError('INVALID_STATE', 'nextEventId does not follow events');
  const processedActionIds = [...value.processedActionIds] as string[];
  if (processedActionIds.some((id) => typeof id !== 'string' || id.length === 0) || new Set(processedActionIds).size !== processedActionIds.length) stateError('INVALID_STATE', 'processedActionIds is invalid');
  const nextActionSequence = assertSafeStateNumber(value.nextActionSequence, 'state.nextActionSequence', 1);
  return freezeCopy({ schemaVersion: REINFORCEMENT_SAVE_SCHEMA_VERSION, configId: value.configId, round, reinforcements, events, nextEventId, processedActionIds, nextActionSequence } as ReinforcementState);
}

export function serializeReinforcementState(state: ReinforcementState): string {
  return JSON.stringify(validateSerializableState(state));
}

export function restoreReinforcementState(configInput: unknown, serialized: string | unknown): ReinforcementState {
  let value: unknown = serialized;
  if (typeof serialized === 'string') {
    try { value = JSON.parse(serialized); } catch { throw new ReinforcementStateError('INVALID_SAVE', 'save is not valid JSON'); }
  }
  try { return validateReinforcementState(configInput, value); }
  catch (error) {
    if (error instanceof ReinforcementStateError) {
      if (error.code === 'CONFIG_MISMATCH') throw error;
      throw new ReinforcementStateError('INVALID_SAVE', error.message);
    }
    throw error;
  }
}
