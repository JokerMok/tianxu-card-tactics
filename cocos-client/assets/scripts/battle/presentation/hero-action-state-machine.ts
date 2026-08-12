import type { BattleEvent, Side } from '../../core/types/index.ts';

export const HERO_ACTION_STATES = Object.freeze({
  IDLE: 'Idle',
  HIT_LIGHT: 'HitLight',
  HIT_HEAVY: 'HitHeavy',
  COMMAND: 'Command',
  CRITICAL: 'Critical',
  DEFEAT: 'Defeat',
} as const);

export type HeroActionState = typeof HERO_ACTION_STATES[keyof typeof HERO_ACTION_STATES];

export type HeroActionTransitionCode =
  | 'APPLIED'
  | 'UNKNOWN_EVENT'
  | 'INVALID_EVENT'
  | 'NOT_HERO_EVENT'
  | 'WRONG_HERO'
  | 'DUPLICATE_EVENT'
  | 'OUT_OF_ORDER_EVENT'
  | 'TERMINAL_STATE';

export interface HeroActionStateMachineOptions {
  readonly heroId?: string;
  readonly side: Side;
  readonly maxHp?: number;
  readonly initialHp?: number;
  /** Caller-owned absolute single-hit threshold for HitHeavy. */
  readonly heavyDamageThreshold: number;
  /** Caller-owned remaining-health ratio for Critical. */
  readonly criticalHpRatio: number;
}

export interface HeroActionStateSnapshot {
  readonly heroId: string;
  readonly side: Side;
  readonly hp: number;
  readonly maxHp: number;
  readonly state: HeroActionState;
  readonly lastEventId: number | null;
  readonly lastEventType: string | null;
  readonly sequence: number;
}

export interface HeroActionTransitionResult {
  readonly accepted: boolean;
  readonly code: HeroActionTransitionCode;
  readonly eventId: number | null;
  readonly heroId: string | null;
  readonly state: HeroActionState | null;
  readonly snapshot: HeroActionStateSnapshot;
}

type RawField = {
  readonly present: boolean;
  readonly valid: boolean;
  readonly value?: unknown;
};

type IdentityResolution = true | 'wrong' | 'conflict' | false;

const SIDES: readonly Side[] = ['player', 'enemy'];
const DEFAULT_MAX_HP = 30;
const COMMAND_EVENT_TYPES = new Set([
  'COMMAND',
  'HERO_COMMAND',
  'COMMANDER_COMMAND',
  'COMMANDER_ORDER',
  'ORDER',
  'ORDER_ISSUED',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function readPayload(event: BattleEvent): Record<string, unknown> | undefined {
  return isRecord(event.payload) ? event.payload : undefined;
}

function readEventField(event: BattleEvent, key: string): unknown {
  return (event as unknown as Record<string, unknown>)[key];
}

function readRawField(event: BattleEvent, payload: Record<string, unknown>, key: string): RawField {
  const payloadHas = hasOwn(payload, key);
  const eventRecord = event as unknown as Record<string, unknown>;
  const eventHas = hasOwn(eventRecord, key);
  if (!payloadHas && !eventHas) return { present: false, valid: true };
  if (payloadHas && eventHas && !Object.is(payload[key], eventRecord[key])) {
    return { present: true, valid: false };
  }
  const value = payloadHas ? payload[key] : eventRecord[key];
  return { present: true, valid: value !== undefined, value };
}

function readOptionalUndefinedField(
  event: BattleEvent,
  payload: Record<string, unknown>,
  key: string,
): RawField {
  const payloadHas = hasOwn(payload, key);
  const eventRecord = event as unknown as Record<string, unknown>;
  const eventHas = hasOwn(eventRecord, key);
  if (!payloadHas && !eventHas) return { present: false, valid: true };
  const values = [
    ...(payloadHas ? [payload[key]] : []),
    ...(eventHas ? [eventRecord[key]] : []),
  ].filter((value) => value !== undefined);
  if (values.length > 1 && !values.every((value) => Object.is(value, values[0]))) {
    return { present: true, valid: false };
  }
  if (values.length === 0) return { present: false, valid: true };
  return { present: true, valid: true, value: values[0] };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSide(value: unknown): value is Side {
  return value === 'player' || value === 'enemy';
}

function isSafePositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSafeNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validatePositiveInteger(value: unknown, label: string): number {
  if (!isSafePositiveInteger(value)) throw new Error(`${label} must be a positive safe integer`);
  return value;
}

function validateRatio(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error('criticalHpRatio must be between 0 and 1');
  }
  return value;
}

function readValidatedString(
  event: BattleEvent,
  payload: Record<string, unknown>,
  key: string,
): RawField & { readonly value?: string } {
  const raw = readRawField(event, payload, key);
  return { ...raw, valid: raw.valid && (!raw.present || isNonEmptyString(raw.value)), value: raw.value as string | undefined };
}

function readValidatedSide(
  event: BattleEvent,
  payload: Record<string, unknown>,
  key: string,
): RawField & { readonly value?: Side } {
  const raw = readRawField(event, payload, key);
  return { ...raw, valid: raw.valid && (!raw.present || isSide(raw.value)), value: raw.value as Side | undefined };
}

function readValidatedInteger(
  event: BattleEvent,
  payload: Record<string, unknown>,
  key: string,
  predicate: (value: unknown) => value is number,
): RawField & { readonly value?: number } {
  const raw = readRawField(event, payload, key);
  return { ...raw, valid: raw.valid && (!raw.present || predicate(raw.value)), value: raw.value as number | undefined };
}

function readAliasStrings(
  event: BattleEvent,
  payload: Record<string, unknown>,
  keys: readonly string[],
): { readonly valid: boolean; readonly present: boolean; readonly value?: string } {
  const fields = keys.map((key) => readValidatedString(event, payload, key));
  if (fields.some((field) => !field.valid)) return { valid: false, present: true };
  const values = fields.filter((field): field is typeof field & { readonly value: string } => field.present).map((field) => field.value);
  if (values.length > 1 && !values.every((value) => value === values[0])) return { valid: false, present: true };
  return { valid: true, present: values.length > 0, value: values[0] };
}

function readAliasIntegers(
  event: BattleEvent,
  payload: Record<string, unknown>,
  keys: readonly string[],
  predicate: (value: unknown) => value is number,
): { readonly valid: boolean; readonly present: boolean; readonly value?: number } {
  const fields = keys.map((key) => readValidatedInteger(event, payload, key, predicate));
  if (fields.some((field) => !field.valid)) return { valid: false, present: true };
  const values = fields.filter((field): field is typeof field & { readonly value: number } => field.present).map((field) => field.value);
  if (values.length > 1 && !values.every((value) => value === values[0])) return { valid: false, present: true };
  return { valid: true, present: values.length > 0, value: values[0] };
}

function stateForDamage(
  damage: number,
  hp: number,
  maxHp: number,
  heavyDamageThreshold: number,
  criticalHpRatio: number,
): HeroActionState {
  if (hp <= maxHp * criticalHpRatio) return HERO_ACTION_STATES.CRITICAL;
  return damage >= heavyDamageThreshold ? HERO_ACTION_STATES.HIT_HEAVY : HERO_ACTION_STATES.HIT_LIGHT;
}

/**
 * Deterministic, host-neutral projection of hero-facing core events.
 * Thresholds are presentation policy supplied by the caller; this machine
 * never reads or mutates BattleState and owns no animation clock.
 */
export class HeroActionStateMachine {
  private readonly heroIdValue: string;
  private readonly sideValue: Side;
  private readonly maxHpValue: number;
  private readonly heavyDamageThresholdValue: number;
  private readonly criticalHpRatioValue: number;
  private hpValue: number;
  private stateValue: HeroActionState = HERO_ACTION_STATES.IDLE;
  private lastEventIdValue: number | null = null;
  private lastEventTypeValue: string | null = null;
  private sequenceValue = 0;
  private settledValue = false;
  private snapshotValue: HeroActionStateSnapshot;

  constructor(options: HeroActionStateMachineOptions) {
    if (!options || !isSide(options.side)) throw new Error('hero side must be player or enemy');
    const maxHp = validatePositiveInteger(options.maxHp ?? DEFAULT_MAX_HP, 'maxHp');
    const initialHp = options.initialHp ?? maxHp;
    if (!isSafeNonNegativeInteger(initialHp) || initialHp > maxHp) throw new Error('initialHp is invalid');
    const heroId = options.heroId ?? options.side;
    if (!isNonEmptyString(heroId)) throw new Error('heroId must be a non-empty string');
    const heavyDamageThreshold = validatePositiveInteger(options.heavyDamageThreshold, 'heavyDamageThreshold');
    const criticalHpRatio = validateRatio(options.criticalHpRatio);

    this.heroIdValue = heroId;
    this.sideValue = options.side;
    this.maxHpValue = maxHp;
    this.hpValue = initialHp;
    this.heavyDamageThresholdValue = heavyDamageThreshold;
    this.criticalHpRatioValue = criticalHpRatio;
    this.snapshotValue = this.createSnapshot();
  }

  get heroId(): string {
    return this.heroIdValue;
  }

  get side(): Side {
    return this.sideValue;
  }

  get state(): HeroActionState {
    return this.stateValue;
  }

  get snapshot(): HeroActionStateSnapshot {
    return this.snapshotValue;
  }

  getSnapshot(): HeroActionStateSnapshot {
    return this.snapshotValue;
  }

  getState(): HeroActionState {
    return this.stateValue;
  }

  dispatch(event: BattleEvent): HeroActionTransitionResult {
    const type = isRecord(event) && typeof event.type === 'string' ? event.type : undefined;
    if (!type || !this.isSupportedEvent(type)) {
      return this.result(false, 'UNKNOWN_EVENT', isRecord(event) && isSafeNonNegativeInteger(event.eventId) && event.eventId > 0 ? event.eventId : null, null);
    }
    if (!isRecord(event) || !isSafePositiveInteger(event.eventId)) return this.result(false, 'INVALID_EVENT', null, null);
    if (this.lastEventIdValue !== null && event.eventId === this.lastEventIdValue) {
      return this.result(false, 'DUPLICATE_EVENT', event.eventId, null);
    }
    if (this.lastEventIdValue !== null && event.eventId < this.lastEventIdValue) {
      return this.result(false, 'OUT_OF_ORDER_EVENT', event.eventId, null);
    }
    if (this.settledValue) return this.result(false, 'TERMINAL_STATE', event.eventId, this.heroIdValue);

    const payload = readPayload(event);
    if (!payload) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    const side = readValidatedSide(event, payload, 'side');
    if (!side.valid) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    const source = readAliasStrings(event, payload, ['sourceId', 'attackerId']);
    if (!source.valid) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);

    if (type === 'BATTLE_END') return this.applyBattleEnd(event, payload);
    if (COMMAND_EVENT_TYPES.has(type)) return this.applyCommand(event, payload);
    return this.applyDamage(event, type, payload);
  }

  applyEvent(event: BattleEvent): HeroActionTransitionResult {
    return this.dispatch(event);
  }

  applyEvents(events: readonly BattleEvent[]): readonly HeroActionTransitionResult[] {
    return Object.freeze(events.map((event) => this.dispatch(event)));
  }

  private isSupportedEvent(type: string): boolean {
    return type === 'DAMAGE' || type === 'HERO_DAMAGED' || type === 'BATTLE_END' || COMMAND_EVENT_TYPES.has(type);
  }

  private applyDamage(
    event: BattleEvent,
    type: 'DAMAGE' | 'HERO_DAMAGED',
    payload: Record<string, unknown>,
  ): HeroActionTransitionResult {
    const targetKind = readValidatedString(event, payload, 'targetKind');
    if (!targetKind.valid) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    if (targetKind.present && targetKind.value !== 'hero') return this.result(false, 'NOT_HERO_EVENT', event.eventId, null);
    if (type === 'DAMAGE' && (!targetKind.present || targetKind.value !== 'hero')) {
      return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    }

    const targetId = readValidatedString(event, payload, 'targetId');
    const heroId = readValidatedString(event, payload, 'heroId');
    const side = readValidatedSide(event, payload, 'side');
    if (!targetId.valid || !heroId.valid) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    if (!side.valid) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    if (type === 'DAMAGE' && !targetId.present) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);

    const identity = type === 'DAMAGE'
      ? this.resolveSingleIdentity(targetId.value, targetId.present, side.present ? side.value : undefined)
      : this.resolveHeroIdentity(payload, event, targetId, heroId);
    if (identity === 'wrong') return this.result(false, 'WRONG_HERO', event.eventId, null);
    if (identity !== true) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    if (type === 'DAMAGE' && heroId.present) {
      const extraIdentity = this.resolveSingleIdentity(heroId.value, true, side.present ? side.value : undefined);
      if (extraIdentity === 'wrong') return this.result(false, 'WRONG_HERO', event.eventId, null);
      if (extraIdentity !== true) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    }

    const damage = readAliasIntegers(event, payload, ['value', 'damage'], isSafePositiveInteger);
    if (!damage.valid || !damage.present) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);

    const hp = readAliasIntegers(event, payload, ['currentHp', 'remainingHp', 'hp'], (value): value is number => (
      isSafeNonNegativeInteger(value) && value <= this.maxHpValue
    ));
    if (!hp.valid) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    const nextHp = Math.max(0, this.hpValue - damage.value!);
    if (hp.present && hp.value !== nextHp) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);

    this.hpValue = nextHp;
    this.stateValue = stateForDamage(
      damage.value!,
      nextHp,
      this.maxHpValue,
      this.heavyDamageThresholdValue,
      this.criticalHpRatioValue,
    );
    return this.commit(event, this.heroIdValue);
  }

  private applyCommand(event: BattleEvent, payload: Record<string, unknown>): HeroActionTransitionResult {
    const source = readAliasStrings(event, payload, ['sourceId', 'attackerId', 'heroId', 'commanderId', 'unitId']);
    if (!source.valid || !source.present) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    const side = readValidatedSide(event, payload, 'side');
    if (!side.valid) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    const identity = this.resolveSingleIdentity(source.value, true, side.present ? side.value : undefined);
    if (identity !== true) return this.result(false, identity === 'wrong' ? 'WRONG_HERO' : 'INVALID_EVENT', event.eventId, null);
    this.stateValue = HERO_ACTION_STATES.COMMAND;
    return this.commit(event, this.heroIdValue);
  }

  private applyBattleEnd(event: BattleEvent, payload: Record<string, unknown>): HeroActionTransitionResult {
    const status = readValidatedString(event, payload, 'status');
    const reason = readValidatedString(event, payload, 'reason');
    const winner = readOptionalUndefinedField(event, payload, 'winner');
    if (!status.valid || !status.present || (status.value !== 'won' && status.value !== 'lost' && status.value !== 'draw')) {
      return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    }
    if (!reason.valid || !reason.present || !isNonEmptyString(reason.value)) {
      return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    }
    if (!winner.valid) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    if (winner.present && !isSide(winner.value)) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    if (status.value === 'draw') {
      if (winner.present) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
      this.stateValue = HERO_ACTION_STATES.IDLE;
    } else {
      if (!winner.present) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
      const expectedWinner: Side = status.value === 'won' ? 'player' : 'enemy';
      if (winner.value !== expectedWinner) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
      this.stateValue = winner.value === this.sideValue
        ? HERO_ACTION_STATES.IDLE
        : HERO_ACTION_STATES.DEFEAT;
    }
    this.settledValue = true;
    return this.commit(event, this.heroIdValue);
  }

  private resolveSingleIdentity(value: string | undefined, present: boolean, declaredSide?: Side): IdentityResolution {
    if (!present || !value) return false;
    const identitySide = value === 'player' || value === 'enemy'
      ? value
      : value === this.heroIdValue
        ? this.sideValue
        : undefined;
    if (declaredSide && identitySide && declaredSide !== identitySide) return 'conflict';
    return identitySide === this.sideValue ? true : 'wrong';
  }

  private resolveHeroIdentity(
    payload: Record<string, unknown>,
    event: BattleEvent,
    targetId: RawField & { readonly value?: string },
    heroId: RawField & { readonly value?: string },
  ): IdentityResolution {
    const side = readValidatedSide(event, payload, 'side');
    if (!side.valid) return false;
    const identities: Array<{ readonly value: string; readonly knownSide?: Side }> = [];
    if (side.present) identities.push({ value: side.value!, knownSide: side.value });
    for (const field of [heroId, targetId]) {
      if (field.present) {
        const value = field.value!;
        identities.push({
          value,
          knownSide: value === 'player' || value === 'enemy'
            ? value
            : value === this.heroIdValue
              ? this.sideValue
              : undefined,
        });
      }
    }
    if (identities.length === 0) return false;
    const knownSides = identities.map((identity) => identity.knownSide).filter((value): value is Side => value !== undefined);
    if (new Set(knownSides).size > 1) return 'conflict';
    if (knownSides.length === 0) return 'wrong';
    if (identities.some((identity) => identity.knownSide === undefined)) return 'conflict';
    return knownSides[0] === this.sideValue ? true : 'wrong';
  }

  private commit(event: BattleEvent, heroId: string): HeroActionTransitionResult {
    this.lastEventIdValue = event.eventId;
    this.lastEventTypeValue = event.type;
    this.sequenceValue += 1;
    this.snapshotValue = this.createSnapshot();
    return this.result(true, 'APPLIED', event.eventId, heroId);
  }

  private createSnapshot(): HeroActionStateSnapshot {
    return Object.freeze({
      heroId: this.heroIdValue,
      side: this.sideValue,
      hp: this.hpValue,
      maxHp: this.maxHpValue,
      state: this.stateValue,
      lastEventId: this.lastEventIdValue,
      lastEventType: this.lastEventTypeValue,
      sequence: this.sequenceValue,
    });
  }

  private result(
    accepted: boolean,
    code: HeroActionTransitionCode,
    eventId: number | null,
    heroId: string | null,
  ): HeroActionTransitionResult {
    return Object.freeze({
      accepted,
      code,
      eventId,
      heroId,
      state: heroId ? this.stateValue : null,
      snapshot: this.snapshotValue,
    });
  }
}

export type HeroActionStateMachineSnapshot = HeroActionStateSnapshot;

export {
  HERO_ACTION_STATES as COMMANDER_ACTION_STATES,
  HeroActionStateMachine as CommanderActionStateMachine,
};
