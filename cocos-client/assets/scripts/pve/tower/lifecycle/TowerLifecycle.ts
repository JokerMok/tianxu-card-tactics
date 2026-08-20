import { TOWER_FLOOR_COUNT } from '../TowerConfig.ts';
import { TimeService, type Clock } from '../../../services/TimeService.ts';

export { TOWER_FLOOR_COUNT };

export const TOWER_LIFECYCLE_SCHEMA_VERSION = 1 as const;
export const TOWER_RESET_WEEKDAY = 1 as const;
export const TOWER_RESET_HOUR = 5 as const;
export const DEFAULT_TOWER_TICKETS = 3 as const;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CYCLE_KEY_PATTERN = DATE_KEY_PATTERN;

export type TowerLifecycleStatus = 'ready' | 'active' | 'failed' | 'completed';
export type TowerAttemptCost = 'FREE' | 'TICKET';
export type TowerBattleOutcome = 'won' | 'lost';

export type TowerAttempt = Readonly<{
  attemptId: number;
  floor: number;
  cost: TowerAttemptCost;
  startedAt: number;
}>;

export type TowerFailure = Readonly<{
  attemptId: number;
  floor: number;
  cost: TowerAttemptCost;
  failedAt: number;
}>;

export type TowerResetRecord = Readonly<{
  fromCycleKey: string;
  toCycleKey: string;
  at: number;
  compensationTickets: number;
}>;

export type TowerLifecycleState = Readonly<{
  schemaVersion: typeof TOWER_LIFECYCLE_SCHEMA_VERSION;
  cycleKey: string;
  status: TowerLifecycleStatus;
  /** The next floor to enter; after clearing floor 50 it remains 50. */
  floor: number;
  /** Highest floor cleared across weekly resets. */
  bestFloor: number;
  tickets: number;
  /** The calendar day on which the current cycle's daily free entry was used. */
  freeEntryDayKey: string | null;
  attemptCount: number;
  activeAttempt: TowerAttempt | null;
  lastFailure: TowerFailure | null;
  lastReset: TowerResetRecord | null;
}>;

export type TowerLifecyclePersistence = (serialized: string) => void;

export type TowerLifecycleOptions = Readonly<{
  clock?: Clock;
  timezone?: string;
  tickets?: number;
  persist?: TowerLifecyclePersistence;
  initialState?: string;
}>;

export type TowerLifecycleErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_TRANSITION'
  | 'TICKETS_EXHAUSTED'
  | 'TOWER_COMPLETED'
  | 'PERSISTENCE_FAILED';

export class TowerLifecycleError extends Error {
  readonly code: TowerLifecycleErrorCode;

  constructor(code: TowerLifecycleErrorCode, message: string) {
    super(message);
    this.name = 'TowerLifecycleError';
    this.code = code;
  }
}

export type TowerSynchronizeResult = Readonly<{
  state: TowerLifecycleState;
  reset: TowerResetRecord | null;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clone(item)]),
  ) as T;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code: TowerLifecycleErrorCode, message: string): never {
  throw new TowerLifecycleError(code, message);
}

function assertTimestamp(
  value: unknown,
  path: string,
  code: 'INVALID_CONFIG' | 'INVALID_STATE' = 'INVALID_CONFIG',
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(code, `${path} must be a non-negative safe integer timestamp`);
  }
}

function assertNonNegativeInteger(
  value: unknown,
  path: string,
  code: 'INVALID_CONFIG' | 'INVALID_STATE' = 'INVALID_CONFIG',
): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(code, `${path} must be a non-negative safe integer`);
  }
}

function assertDateKey(value: unknown, path: string, pattern = DATE_KEY_PATTERN): asserts value is string {
  if (typeof value !== 'string' || !pattern.test(value)) fail('INVALID_STATE', `${path} is invalid`);
}

function assertPlainRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail('INVALID_STATE', `${path} must be a plain object`);
  }
}

function assertExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Reflect.ownKeys(record);
  if (
    actual.length !== keys.length
    || actual.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    fail('INVALID_STATE', `${path} contains unexpected or missing fields`);
  }
}

function assertStatus(value: unknown, path: string): asserts value is TowerLifecycleStatus {
  if (value !== 'ready' && value !== 'active' && value !== 'failed' && value !== 'completed') {
    fail('INVALID_STATE', `${path} is invalid`);
  }
}

function assertCost(value: unknown, path: string): asserts value is TowerAttemptCost {
  if (value !== 'FREE' && value !== 'TICKET') fail('INVALID_STATE', `${path} is invalid`);
}

function validateAttempt(value: unknown, path: string): asserts value is TowerAttempt {
  if (value === null) return;
  assertPlainRecord(value, path);
  assertExactKeys(value, ['attemptId', 'floor', 'cost', 'startedAt'], path);
  assertNonNegativeInteger(value.attemptId, `${path}.attemptId`, 'INVALID_STATE');
  if (value.attemptId < 1) fail('INVALID_STATE', `${path}.attemptId must be positive`);
  assertFloor(value.floor, `${path}.floor`);
  assertCost(value.cost, `${path}.cost`);
  assertTimestamp(value.startedAt, `${path}.startedAt`, 'INVALID_STATE');
}

function validateFailure(value: unknown, path: string): asserts value is TowerFailure {
  if (value === null) return;
  assertPlainRecord(value, path);
  assertExactKeys(value, ['attemptId', 'floor', 'cost', 'failedAt'], path);
  assertNonNegativeInteger(value.attemptId, `${path}.attemptId`, 'INVALID_STATE');
  if (value.attemptId < 1) fail('INVALID_STATE', `${path}.attemptId must be positive`);
  assertFloor(value.floor, `${path}.floor`);
  assertCost(value.cost, `${path}.cost`);
  assertTimestamp(value.failedAt, `${path}.failedAt`, 'INVALID_STATE');
}

function validateReset(value: unknown, path: string): asserts value is TowerResetRecord {
  if (value === null) return;
  assertPlainRecord(value, path);
  assertExactKeys(value, ['fromCycleKey', 'toCycleKey', 'at', 'compensationTickets'], path);
  assertDateKey(value.fromCycleKey, `${path}.fromCycleKey`, CYCLE_KEY_PATTERN);
  assertDateKey(value.toCycleKey, `${path}.toCycleKey`, CYCLE_KEY_PATTERN);
  assertTimestamp(value.at, `${path}.at`, 'INVALID_STATE');
  assertNonNegativeInteger(value.compensationTickets, `${path}.compensationTickets`, 'INVALID_STATE');
}

function assertFloor(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > TOWER_FLOOR_COUNT) {
    fail('INVALID_STATE', `${path} must be between 1 and ${TOWER_FLOOR_COUNT}`);
  }
}

function validateState(value: unknown): asserts value is TowerLifecycleState {
  assertPlainRecord(value, 'state');
  assertExactKeys(value, [
    'schemaVersion', 'cycleKey', 'status', 'floor', 'bestFloor', 'tickets', 'freeEntryDayKey',
    'attemptCount', 'activeAttempt', 'lastFailure', 'lastReset',
  ], 'state');
  if (value.schemaVersion !== TOWER_LIFECYCLE_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported schema version');
  assertDateKey(value.cycleKey, 'state.cycleKey', CYCLE_KEY_PATTERN);
  assertStatus(value.status, 'state.status');
  assertFloor(value.floor, 'state.floor');
  assertNonNegativeInteger(value.bestFloor, 'state.bestFloor', 'INVALID_STATE');
  if (value.bestFloor > TOWER_FLOOR_COUNT) fail('INVALID_STATE', 'state.bestFloor exceeds tower floor count');
  if (value.floor > value.bestFloor + 1) fail('INVALID_STATE', 'state.floor is ahead of the best floor');
  assertNonNegativeInteger(value.tickets, 'state.tickets', 'INVALID_STATE');
  if (value.freeEntryDayKey !== null) assertDateKey(value.freeEntryDayKey, 'state.freeEntryDayKey');
  assertNonNegativeInteger(value.attemptCount, 'state.attemptCount', 'INVALID_STATE');
  validateAttempt(value.activeAttempt, 'state.activeAttempt');
  validateFailure(value.lastFailure, 'state.lastFailure');
  validateReset(value.lastReset, 'state.lastReset');

  if (value.status === 'active' && value.activeAttempt === null) fail('INVALID_STATE', 'active state requires an active attempt');
  if (value.status !== 'active' && value.activeAttempt !== null) fail('INVALID_STATE', 'only active state may have an active attempt');
  if (value.status === 'failed' && value.lastFailure === null) fail('INVALID_STATE', 'failed state requires a last failure');
  if (value.status !== 'failed' && value.lastFailure !== null) fail('INVALID_STATE', 'only failed state may have a last failure');
  if (value.status === 'completed' && (value.floor !== TOWER_FLOOR_COUNT || value.bestFloor !== TOWER_FLOOR_COUNT)) {
    fail('INVALID_STATE', 'completed state must represent the final floor');
  }
  if (value.activeAttempt !== null && value.activeAttempt.floor !== value.floor) {
    fail('INVALID_STATE', 'active attempt floor must match state.floor');
  }
  if (value.lastFailure !== null && value.lastFailure.floor !== value.floor) {
    fail('INVALID_STATE', 'last failure floor must match state.floor');
  }
  if (value.activeAttempt !== null && value.activeAttempt.attemptId > value.attemptCount) {
    fail('INVALID_STATE', 'active attempt id exceeds attempt count');
  }
  if (value.lastFailure !== null && value.lastFailure.attemptId > value.attemptCount) {
    fail('INVALID_STATE', 'last failure id exceeds attempt count');
  }
  if (value.lastReset !== null && value.lastReset.toCycleKey !== value.cycleKey) {
    fail('INVALID_STATE', 'last reset must point to the current cycle');
  }
}

function assertTickets(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail('INVALID_CONFIG', `${path} must be non-negative`);
}

function formatDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Returns the weekly tower cycle that contains the supplied timestamp. */
export function towerCycleKeyAt(at: number, timezone = 'Asia/Shanghai'): string {
  assertTimestamp(at, 'at');
  let parts;
  try {
    parts = new TimeService({ now: () => at }, timezone).localParts(at);
  } catch (error) {
    fail('INVALID_CONFIG', `timezone or timestamp is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }

  const localDate = Date.UTC(parts.year, parts.month - 1, parts.day);
  const weekday = new Date(localDate).getUTCDay() || 7;
  const monday = localDate - (weekday - TOWER_RESET_WEEKDAY) * DAY_MS;
  const beforeMondayReset = weekday === TOWER_RESET_WEEKDAY && parts.hour < TOWER_RESET_HOUR;
  const cycleStart = beforeMondayReset ? monday - 7 * DAY_MS : monday;
  const date = new Date(cycleStart);
  return formatDateKey(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function dayKeyAt(at: number, timezone: string): string {
  assertTimestamp(at, 'at');
  try {
    const parts = new TimeService({ now: () => at }, timezone).localParts(at);
    return formatDateKey(parts.year, parts.month, parts.day);
  } catch (error) {
    fail('INVALID_CONFIG', `timezone or timestamp is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function defaultState(cycleKey: string, tickets: number): TowerLifecycleState {
  return {
    schemaVersion: TOWER_LIFECYCLE_SCHEMA_VERSION,
    cycleKey,
    status: 'ready',
    floor: 1,
    bestFloor: 0,
    tickets,
    freeEntryDayKey: null,
    attemptCount: 0,
    activeAttempt: null,
    lastFailure: null,
    lastReset: null,
  };
}

function resetStateAt(
  current: TowerLifecycleState,
  cycleKey: string,
  at: number,
): { next: TowerLifecycleState; reset: TowerResetRecord } {
  const paidAttempt = current.status === 'active'
    ? current.activeAttempt?.cost === 'TICKET'
    : current.status === 'failed' && current.lastFailure?.cost === 'TICKET';
  const compensationTickets = paidAttempt ? 1 : 0;
  if (current.tickets > Number.MAX_SAFE_INTEGER - compensationTickets) {
    fail('INVALID_STATE', 'ticket compensation would overflow the safe integer range');
  }
  const reset = {
    fromCycleKey: current.cycleKey,
    toCycleKey: cycleKey,
    at,
    compensationTickets,
  } satisfies TowerResetRecord;
  const next: TowerLifecycleState = {
    ...current,
    cycleKey,
    status: 'ready',
    floor: 1,
    tickets: current.tickets + compensationTickets,
    freeEntryDayKey: null,
    activeAttempt: null,
    lastFailure: null,
    lastReset: reset,
  };
  return { next, reset };
}

function validateBattleResult(result: unknown): asserts result is { readonly outcome: TowerBattleOutcome; readonly attemptId?: number } {
  if (!isRecord(result) || (result.outcome !== 'won' && result.outcome !== 'lost')) {
    fail('INVALID_CONFIG', 'battle result must contain outcome won or lost');
  }
  if (result.attemptId !== undefined) {
    assertNonNegativeInteger(result.attemptId, 'result.attemptId');
    if (result.attemptId < 1) fail('INVALID_CONFIG', 'result.attemptId must be positive');
  }
}

/**
 * Owns the tower entry, retry and weekly reset rules. Battle simulation stays outside;
 * this service accepts only the settled outcome and commits the progression atomically.
 */
export class TowerLifecycleService {
  private readonly clock: Clock;
  private readonly timezone: string;
  private readonly persist: TowerLifecyclePersistence;
  private current: TowerLifecycleState;
  private committing = false;

  constructor(options: TowerLifecycleOptions = {}) {
    this.clock = options.clock === undefined ? { now: () => Date.now() } : options.clock;
    if (!this.clock || typeof this.clock.now !== 'function') fail('INVALID_CONFIG', 'clock.now is required');
    this.timezone = options.timezone === undefined ? 'Asia/Shanghai' : options.timezone;
    if (typeof this.timezone !== 'string' || this.timezone.trim().length === 0) fail('INVALID_CONFIG', 'timezone is required');
    this.persist = options.persist === undefined ? (() => {}) : options.persist;
    if (typeof this.persist !== 'function') fail('INVALID_CONFIG', 'persist must be a function');

    const now = this.now();
    if (options.initialState === undefined) {
      const tickets = options.tickets === undefined ? DEFAULT_TOWER_TICKETS : options.tickets;
      assertTickets(tickets, 'tickets');
      this.current = freezeDeep(clone(defaultState(towerCycleKeyAt(now, this.timezone), tickets)));
    } else {
      this.current = restoreTowerLifecycle(options.initialState);
    }

    const prepared = this.prepare(now);
    if (prepared.reset !== null) this.commit(prepared.state);
  }

  snapshot(): TowerLifecycleState {
    return this.current;
  }

  save(): string {
    return serializeTowerLifecycle(this.current);
  }

  synchronize(at = this.now()): TowerSynchronizeResult {
    assertTimestamp(at, 'at');
    this.ensureNotCommitting();
    const prepared = this.prepare(at);
    if (prepared.reset === null) return { state: this.current, reset: null };
    this.commit(prepared.state);
    return { state: this.current, reset: prepared.reset };
  }

  startChallenge(at = this.now()): TowerLifecycleState {
    assertTimestamp(at, 'at');
    this.ensureNotCommitting();
    const prepared = this.prepare(at);
    const current = prepared.state;
    if (current.status === 'active') fail('INVALID_TRANSITION', 'tower challenge is already active');
    if (current.status === 'failed') fail('INVALID_TRANSITION', 'failed challenge must continue or await the next cycle');
    if (current.status === 'completed') fail('TOWER_COMPLETED', 'tower has already been cleared this cycle');

    const dayKey = dayKeyAt(at, this.timezone);
    const cost: TowerAttemptCost = current.freeEntryDayKey === dayKey ? 'TICKET' : 'FREE';
    const tickets = cost === 'TICKET' ? current.tickets - 1 : current.tickets;
    if (cost === 'TICKET' && current.tickets < 1) fail('TICKETS_EXHAUSTED', 'a ticket is required for this challenge');

    const activeAttempt: TowerAttempt = {
      attemptId: current.attemptCount + 1,
      floor: current.floor,
      cost,
      startedAt: at,
    };
    this.commit({
      ...current,
      status: 'active',
      tickets,
      freeEntryDayKey: cost === 'FREE' ? dayKey : current.freeEntryDayKey,
      attemptCount: activeAttempt.attemptId,
      activeAttempt,
      lastFailure: null,
    });
    return this.current;
  }

  continueChallenge(at = this.now()): TowerLifecycleState {
    assertTimestamp(at, 'at');
    this.ensureNotCommitting();
    const prepared = this.prepare(at);
    const current = prepared.state;
    if (current.status !== 'failed' || current.lastFailure === null) {
      fail('INVALID_TRANSITION', 'only a failed challenge can be continued');
    }
    if (current.tickets < 1) fail('TICKETS_EXHAUSTED', 'a ticket is required to continue the failed challenge');

    const activeAttempt: TowerAttempt = {
      attemptId: current.attemptCount + 1,
      floor: current.floor,
      cost: 'TICKET',
      startedAt: at,
    };
    this.commit({
      ...current,
      status: 'active',
      tickets: current.tickets - 1,
      attemptCount: activeAttempt.attemptId,
      activeAttempt,
      lastFailure: null,
    });
    return this.current;
  }

  /** Alias kept explicit for callers that use retry terminology. */
  retry(at = this.now()): TowerLifecycleState {
    return this.continueChallenge(at);
  }

  completeBattle(result: { readonly outcome: TowerBattleOutcome; readonly attemptId?: number }, at = this.now()): TowerLifecycleState {
    validateBattleResult(result);
    assertTimestamp(at, 'at');
    this.ensureNotCommitting();
    const prepared = this.prepare(at);
    const current = prepared.state;
    if (current.status !== 'active' || current.activeAttempt === null) {
      if (current.status === 'completed') fail('TOWER_COMPLETED', 'tower has already been cleared this cycle');
      fail('INVALID_TRANSITION', 'there is no active tower challenge to settle');
    }
    if (result.attemptId !== undefined && result.attemptId !== current.activeAttempt.attemptId) {
      fail('INVALID_TRANSITION', 'battle result belongs to a different attempt');
    }

    if (result.outcome === 'lost') {
      const lastFailure: TowerFailure = {
        attemptId: current.activeAttempt.attemptId,
        floor: current.floor,
        cost: current.activeAttempt.cost,
        failedAt: at,
      };
      this.commit({ ...current, status: 'failed', activeAttempt: null, lastFailure });
      return this.current;
    }

    const clearedFloor = current.floor;
    const finalFloor = clearedFloor === TOWER_FLOOR_COUNT;
    this.commit({
      ...current,
      status: finalFloor ? 'completed' : 'ready',
      floor: finalFloor ? TOWER_FLOOR_COUNT : clearedFloor + 1,
      bestFloor: Math.max(current.bestFloor, clearedFloor),
      activeAttempt: null,
      lastFailure: null,
    });
    return this.current;
  }

  settle(outcome: TowerBattleOutcome, at = this.now()): TowerLifecycleState {
    return this.completeBattle({ outcome }, at);
  }

  private now(): number {
    const value = this.clock.now();
    assertTimestamp(value, 'clock.now()');
    return value;
  }

  private prepare(at: number): { state: TowerLifecycleState; reset: TowerResetRecord | null } {
    const cycleKey = towerCycleKeyAt(at, this.timezone);
    if (cycleKey === this.current.cycleKey) return { state: this.current, reset: null };
    const result = resetStateAt(this.current, cycleKey, at);
    return { state: result.next, reset: result.reset };
  }

  private ensureNotCommitting(): void {
    if (this.committing) fail('PERSISTENCE_FAILED', 'tower lifecycle persistence is reentrant');
  }

  private commit(next: TowerLifecycleState): void {
    validateState(next);
    this.ensureNotCommitting();
    this.committing = true;
    try {
      this.persist(serializeTowerLifecycle(next));
    } catch (error) {
      throw new TowerLifecycleError('PERSISTENCE_FAILED', error instanceof Error ? error.message : String(error));
    } finally {
      this.committing = false;
    }
    this.current = freezeDeep(clone(next));
  }
}

export function serializeTowerLifecycle(state: TowerLifecycleState): string {
  validateState(state);
  return JSON.stringify(state);
}

export function restoreTowerLifecycle(serialized: string): TowerLifecycleState {
  if (typeof serialized !== 'string' || serialized.trim().length === 0) fail('INVALID_STATE', 'tower lifecycle save must be a non-empty string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'tower lifecycle save is not valid JSON');
  }
  validateState(parsed);
  return freezeDeep(clone(parsed));
}
