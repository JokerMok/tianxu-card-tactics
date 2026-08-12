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
  /** Absolute single-hit damage at or above which a hit uses HitHeavy. */
  readonly heavyDamageThreshold?: number;
  /** Remaining-health ratio at or below which damage uses Critical. */
  readonly criticalHpRatio?: number;
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

const SIDES: readonly Side[] = ['player', 'enemy'];
const DEFAULT_HERO_ID: Side = 'player';
const DEFAULT_MAX_HP = 30;
const DEFAULT_CRITICAL_HP_RATIO = 0.25;
const COMMAND_EVENT_TYPES = new Set([
  'COMMAND',
  'HERO_COMMAND',
  'COMMANDER_COMMAND',
  'COMMANDER_ORDER',
  'ORDER_ISSUED',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPayload(event: BattleEvent): Record<string, unknown> {
  return isRecord(event.payload) ? event.payload : {};
}

function readEventField(event: BattleEvent, key: string): unknown {
  return (event as unknown as Record<string, unknown>)[key];
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function readSide(value: unknown): Side | undefined {
  return value === 'player' || value === 'enemy' ? value : undefined;
}

function isEventId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function freezeSnapshot(snapshot: HeroActionStateSnapshot): HeroActionStateSnapshot {
  return Object.freeze({ ...snapshot });
}

function validatePositiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive integer`);
  return value;
}

function validateRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new Error('criticalHpRatio must be between 0 and 1');
  return value;
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
 * The configured side is the canonical hero identity in BattleState; the
 * machine never reads or mutates BattleState and owns no animation clock.
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

  constructor(options?: HeroActionStateMachineOptions);
  constructor(side: Side);
  constructor(heroId: string, side: Side, maxHp?: number);
  constructor(
    optionsOrSide: HeroActionStateMachineOptions | Side = DEFAULT_HERO_ID,
    positionalSide?: Side,
    positionalMaxHp = DEFAULT_MAX_HP,
  ) {
    const options: HeroActionStateMachineOptions = typeof optionsOrSide === 'string'
      ? { heroId: optionsOrSide, side: positionalSide ?? optionsOrSide, maxHp: positionalMaxHp }
      : optionsOrSide;
    if (!options || !SIDES.includes(options.side)) throw new Error('hero side must be player or enemy');
    const maxHp = validatePositiveInteger(options.maxHp ?? DEFAULT_MAX_HP, 'maxHp');
    const initialHp = options.initialHp ?? maxHp;
    if (!Number.isSafeInteger(initialHp) || initialHp < 0 || initialHp > maxHp) throw new Error('initialHp is invalid');
    const heavyDamageThreshold = options.heavyDamageThreshold
      ?? Math.max(4, Math.ceil(maxHp * 0.12));
    validatePositiveInteger(heavyDamageThreshold, 'heavyDamageThreshold');
    const criticalHpRatio = validateRatio(options.criticalHpRatio ?? DEFAULT_CRITICAL_HP_RATIO);

    this.heroIdValue = options.heroId ?? options.side;
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
      return this.result(false, 'UNKNOWN_EVENT', isRecord(event) && isEventId(event.eventId) ? event.eventId : null, null);
    }
    if (!isEventId(event.eventId)) return this.result(false, 'INVALID_EVENT', null, null);
    if (this.lastEventIdValue !== null && event.eventId === this.lastEventIdValue) {
      return this.result(false, 'DUPLICATE_EVENT', event.eventId, null);
    }
    if (this.lastEventIdValue !== null && event.eventId < this.lastEventIdValue) {
      return this.result(false, 'OUT_OF_ORDER_EVENT', event.eventId, null);
    }
    if (this.settledValue) return this.result(false, 'TERMINAL_STATE', event.eventId, this.heroIdValue);

    const payload = readPayload(event);
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
    const targetKind = payload.targetKind ?? readEventField(event, 'targetKind');
    if (targetKind !== undefined && targetKind !== 'hero') {
      return this.result(false, 'NOT_HERO_EVENT', event.eventId, null);
    }
    const target = this.resolveHeroTarget(event, payload);
    if (target === 'wrong') return this.result(false, 'WRONG_HERO', event.eventId, null);
    if (target !== true) return this.result(false, 'INVALID_EVENT', event.eventId, null);

    const damage = readNumber(payload.value)
      ?? readNumber(payload.damage)
      ?? readNumber(readEventField(event, 'value'))
      ?? readNumber(readEventField(event, 'damage'));
    if (damage === undefined || !Number.isSafeInteger(damage) || damage <= 0) {
      return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    }
    const explicitHp = readNumber(payload.currentHp)
      ?? readNumber(payload.remainingHp)
      ?? readNumber(payload.hp)
      ?? readNumber(readEventField(event, 'currentHp'))
      ?? readNumber(readEventField(event, 'remainingHp'))
      ?? readNumber(readEventField(event, 'hp'));
    const nextHp = explicitHp === undefined ? Math.max(0, this.hpValue - damage) : explicitHp;
    if (!Number.isSafeInteger(nextHp) || nextHp < 0 || nextHp > this.maxHpValue) {
      return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    }

    this.hpValue = nextHp;
    this.stateValue = stateForDamage(
      damage,
      nextHp,
      this.maxHpValue,
      this.heavyDamageThresholdValue,
      this.criticalHpRatioValue,
    );
    return this.commit(event, this.heroIdValue);
  }

  private applyCommand(event: BattleEvent, payload: Record<string, unknown>): HeroActionTransitionResult {
    const source = this.resolveCommandSource(event, payload);
    if (source === 'wrong') return this.result(false, 'WRONG_HERO', event.eventId, null);
    if (source !== true) return this.result(false, 'INVALID_EVENT', event.eventId, null);
    this.stateValue = HERO_ACTION_STATES.COMMAND;
    return this.commit(event, this.heroIdValue);
  }

  private applyBattleEnd(event: BattleEvent, payload: Record<string, unknown>): HeroActionTransitionResult {
    const status = payload.status ?? readEventField(event, 'status');
    if (status !== 'won' && status !== 'lost' && status !== 'draw') {
      return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    }
    const rawWinner = payload.winner
      ?? readEventField(event, 'winner')
      ?? (status === 'draw' ? undefined : event.side);
    const winner = rawWinner === undefined ? undefined : readSide(rawWinner);
    if (rawWinner !== undefined && !winner) return this.result(false, 'INVALID_EVENT', event.eventId, this.heroIdValue);
    if (status === 'draw') {
      this.stateValue = HERO_ACTION_STATES.IDLE;
    } else {
      const resolvedWinner = winner ?? (status === 'won' ? 'player' : 'enemy');
      this.stateValue = resolvedWinner === this.sideValue
        ? HERO_ACTION_STATES.IDLE
        : HERO_ACTION_STATES.DEFEAT;
    }
    this.settledValue = true;
    return this.commit(event, this.heroIdValue);
  }

  private resolveHeroTarget(event: BattleEvent, payload: Record<string, unknown>): true | 'wrong' | false {
    const identityCandidates = [
      payload.heroId,
      payload.targetId,
      readEventField(event, 'targetId'),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (identityCandidates.length > 0) {
      return identityCandidates.every((value) => value === this.heroIdValue || value === this.sideValue)
        ? true
        : 'wrong';
    }
    const sideCandidates = [payload.side, payload.targetSide, event.side]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (sideCandidates.length === 0) return false;
    return sideCandidates.every((value) => value === this.sideValue) ? true : 'wrong';
  }

  private resolveCommandSource(event: BattleEvent, payload: Record<string, unknown>): true | 'wrong' | false {
    const identityCandidates = [
      payload.heroId,
      payload.commanderId,
      payload.sourceId,
      payload.unitId,
      readEventField(event, 'sourceId'),
    ].filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (identityCandidates.length > 0) {
      return identityCandidates.every((value) => value === this.heroIdValue || value === this.sideValue)
        ? true
        : 'wrong';
    }
    const sideCandidates = [payload.side, event.side]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    if (sideCandidates.length === 0) return false;
    return sideCandidates.every((value) => value === this.sideValue) ? true : 'wrong';
  }

  private commit(event: BattleEvent, heroId: string): HeroActionTransitionResult {
    this.lastEventIdValue = event.eventId;
    this.lastEventTypeValue = event.type;
    this.sequenceValue += 1;
    this.snapshotValue = this.createSnapshot();
    return this.result(true, 'APPLIED', event.eventId, heroId);
  }

  private createSnapshot(): HeroActionStateSnapshot {
    return freezeSnapshot({
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
