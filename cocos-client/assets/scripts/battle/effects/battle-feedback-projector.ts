import type { BattleEvent, Side } from '../../core/types/index.ts';

export const BATTLE_FEEDBACK_TRANSITION_CODES = Object.freeze({
  APPLIED: 'APPLIED', UNKNOWN_EVENT: 'UNKNOWN_EVENT', INVALID_EVENT: 'INVALID_EVENT',
  DUPLICATE_EVENT: 'DUPLICATE_EVENT', OUT_OF_ORDER_EVENT: 'OUT_OF_ORDER_EVENT', TERMINAL_STATE: 'TERMINAL_STATE',
} as const);
export type BattleFeedbackTransitionCode = typeof BATTLE_FEEDBACK_TRANSITION_CODES[keyof typeof BATTLE_FEEDBACK_TRANSITION_CODES];
export interface BattleFeedbackHeroSnapshot { readonly id: string; readonly side: Side; readonly hp: number; readonly maxHp: number; readonly dead: boolean; readonly shield: number; }
export interface BattleFeedbackUnitSnapshot { readonly id: string; readonly side: Side | null; readonly hp: number | null; readonly maxHp: number | null; readonly dead: boolean; readonly shield: number; readonly statuses: readonly string[]; }
export interface BattleFeedbackProjectorSnapshot {
  readonly battleStatus: 'playing' | 'won' | 'lost' | 'draw'; readonly winner: Side | null; readonly reason: string | null; readonly settled: boolean;
  readonly lastEventId: number | null; readonly lastEventType: string | null; readonly sequence: number;
  readonly heroes: Readonly<Record<Side, BattleFeedbackHeroSnapshot>>; readonly units: readonly BattleFeedbackUnitSnapshot[];
}
export interface BattleFeedbackTransitionResult { readonly accepted: boolean; readonly code: BattleFeedbackTransitionCode; readonly eventId: number | null; readonly snapshot: BattleFeedbackProjectorSnapshot; }
export interface BattleFeedbackProjectorOptions { readonly heroIds?: Readonly<Record<Side, string>>; readonly heroMaxHp?: number | Readonly<Record<Side, number>>; readonly heroInitialHp?: number | Readonly<Record<Side, number>>; }

type TargetKind = 'hero' | 'unit';
type EventKind = 'DAMAGE' | 'HERO_DAMAGED' | 'HEAL' | 'STATUS_APPLIED' | 'UNIT_DIED' | 'BATTLE_END';
type HeroState = { hp: number; maxHp: number; shield: number };
type UnitState = { id: string; side: Side | null; hp: number | null; maxHp: number | null; dead: boolean; shield: number; statuses: string[] };
type Field<T> = { present: boolean; value?: T } | null;
const TYPES = new Set<EventKind>(['DAMAGE', 'HERO_DAMAGED', 'HEAL', 'STATUS_APPLIED', 'UNIT_DIED', 'BATTLE_END']);
const SIDES = new Set<Side>(['player', 'enemy']);
const KINDS = new Set<TargetKind>(['hero', 'unit']);
const DEFAULT_IDS: Readonly<Record<Side, string>> = Object.freeze({ player: 'player', enemy: 'enemy' });
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function positive(value: unknown): value is number { return Number.isSafeInteger(value) && value > 0; }
function nonNegative(value: unknown): value is number { return Number.isSafeInteger(value) && value >= 0; }
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }
function eventId(value: unknown): value is number { return Number.isSafeInteger(value) && value > 0; }

/** Runtime-neutral, append-only feedback projection. */
export class BattleFeedbackProjector {
  private readonly heroIds: Readonly<Record<Side, string>>;
  private readonly heroes: Record<Side, HeroState>;
  private readonly units = new Map<string, UnitState>();
  private readonly unitOrder: string[] = [];
  private settled = false;
  private status: 'playing' | 'won' | 'lost' | 'draw' = 'playing';
  private winner: Side | null = null;
  private reason: string | null = null;
  private lastId: number | null = null;
  private lastType: string | null = null;
  private sequence = 0;
  private current: BattleFeedbackProjectorSnapshot;

  constructor(options: BattleFeedbackProjectorOptions = {}) {
    this.heroIds = this.heroIdOptions(options.heroIds);
    const max = this.sideNumbers(options.heroMaxHp, 30);
    const initial = this.sideNumbers(options.heroInitialHp, max);
    this.heroes = {
      player: { hp: Math.min(initial.player, max.player), maxHp: max.player, shield: 0 },
      enemy: { hp: Math.min(initial.enemy, max.enemy), maxHp: max.enemy, shield: 0 },
    };
    this.current = this.snapshotFromState();
  }
  get snapshot(): BattleFeedbackProjectorSnapshot { return this.current; }
  getSnapshot(): BattleFeedbackProjectorSnapshot { return this.current; }
  applyEvent(event: BattleEvent): BattleFeedbackTransitionResult { return this.dispatch(event); }
  applyEvents(events: readonly BattleEvent[]): readonly BattleFeedbackTransitionResult[] { return Object.freeze(events.map((event) => this.dispatch(event))); }

  dispatch(event: BattleEvent): BattleFeedbackTransitionResult {
    if (!record(event) || !eventId(event.eventId)) return this.result(false, 'INVALID_EVENT', null);
    if (this.settled) return this.result(false, 'TERMINAL_STATE', event.eventId);
    if (this.lastId === event.eventId) return this.result(false, 'DUPLICATE_EVENT', event.eventId);
    if (this.lastId !== null && event.eventId < this.lastId) return this.result(false, 'OUT_OF_ORDER_EVENT', event.eventId);
    if (typeof event.type !== 'string' || !TYPES.has(event.type as EventKind)) return this.result(false, 'UNKNOWN_EVENT', event.eventId);
    if (!record(event.payload)) return this.result(false, 'INVALID_EVENT', event.eventId);
    return this.apply(event, event.payload, event.type as EventKind);
  }

  private apply(event: BattleEvent, payload: Record<string, unknown>, type: EventKind): BattleFeedbackTransitionResult {
    if (type === 'BATTLE_END') return this.end(event, payload);
    const target = this.target(event, payload, type, type === 'HERO_DAMAGED');
    const side = this.field(event, payload, ['side'], (value): value is Side => SIDES.has(value as Side));
    if (!target || !side) return this.result(false, 'INVALID_EVENT', event.eventId);
    if (type === 'UNIT_DIED') return target.kind === 'unit' ? this.die(event, target.id, side.value) : this.result(false, 'INVALID_EVENT', event.eventId);
    if (type === 'STATUS_APPLIED') return this.applyStatus(event, payload, target, side.value);
    const amount = this.field(event, payload, ['value', 'amount', 'damage', 'heal'], type === 'HEAL' ? nonNegative : positive);
    if (!amount?.present) return this.result(false, 'INVALID_EVENT', event.eventId);
    return target.kind === 'hero'
      ? this.changeHero(event, payload, target.id, amount.value!, type === 'HEAL')
      : this.changeUnit(event, payload, target.id, side.value, amount.value!, type === 'HEAL');
  }

  private target(event: BattleEvent, payload: Record<string, unknown>, type: EventKind, heroOnly: boolean): { kind: TargetKind; id: string } | null {
    const kind = this.field(event, payload, ['targetKind'], (value): value is TargetKind => KINDS.has(value as TargetKind));
    if (!kind?.present) {
      if (type === 'UNIT_DIED') {
        const fallback = this.field(event, payload, ['unitId'], text);
        if (!fallback?.present) return null;
        return { kind: 'unit', id: fallback.value! };
      }
      return null;
    }
    if (heroOnly && kind.value !== 'hero') return null;
    const identity = this.field(event, payload, kind.value === 'hero' ? ['targetId', 'heroId'] : ['targetId', 'unitId'], text);
    if (!identity?.present || (kind.value === 'hero' && !this.heroSide(identity.value!))) return null;
    return { kind: kind.value!, id: identity.value! };
  }

  private changeHero(event: BattleEvent, payload: Record<string, unknown>, targetId: string, amount: number, heal: boolean): BattleFeedbackTransitionResult {
    const side = this.heroSide(targetId);
    if (!side) return this.result(false, 'INVALID_EVENT', event.eventId);
    const state = this.heroes[side];
    const hp = heal ? Math.min(state.maxHp, state.hp + amount) : Math.max(0, state.hp - amount);
    const hint = this.field(event, payload, ['currentHp', 'remainingHp', 'hp'], nonNegative);
    if (!hint || (hint.present && hint.value !== hp)) return this.result(false, 'INVALID_EVENT', event.eventId);
    state.hp = hp;
    return this.commit(event);
  }

  private changeUnit(event: BattleEvent, payload: Record<string, unknown>, targetId: string, side: Side | undefined, amount: number, heal: boolean): BattleFeedbackTransitionResult {
    const known = this.units.get(targetId);
    if (known?.side && side && known.side !== side) return this.result(false, 'INVALID_EVENT', event.eventId);
    const state = known ?? { id: targetId, side: side ?? null, hp: null, maxHp: null, dead: false, shield: 0, statuses: [] };
    const hp = state.hp === null ? (heal ? amount : 0) : (heal ? Math.min(state.maxHp ?? state.hp, state.hp + amount) : Math.max(0, state.hp - amount));
    const hint = this.field(event, payload, ['currentHp', 'remainingHp', 'hp'], nonNegative);
    if (!hint || (hint.present && hint.value !== hp)) return this.result(false, 'INVALID_EVENT', event.eventId);
    if (!known) { this.units.set(targetId, state); this.unitOrder.push(targetId); }
    if (!state.side && side) state.side = side;
    state.hp = hp; if (state.maxHp === null && hp > 0) state.maxHp = hp; if (hp === 0) state.dead = true;
    return this.commit(event);
  }

  private applyStatus(event: BattleEvent, payload: Record<string, unknown>, target: { kind: TargetKind; id: string }, side: Side | undefined): BattleFeedbackTransitionResult {
    const status = this.field(event, payload, ['kind', 'status', 'statusKind'], text);
    if (!status?.present) return this.result(false, 'INVALID_EVENT', event.eventId);
    if (status.value === 'SHIELD' || status.value === 'ARMOR') {
      const amount = this.field(event, payload, ['value', 'shield', 'armor', 'amount'], nonNegative);
      if (!amount?.present) return this.result(false, 'INVALID_EVENT', event.eventId);
      if (target.kind === 'hero') {
        const hero = this.heroState(target.id);
        if (hero === null) return this.result(false, 'INVALID_EVENT', event.eventId);
        hero.shield += amount.value!;
        return this.commit(event);
      }
      const unitState = this.unit(target.id, side);
      if (!unitState) return this.result(false, 'INVALID_EVENT', event.eventId);
      unitState.shield += amount.value!;
      return this.commit(event);
    }
    if (target.kind === 'hero') return this.commit(event);
    const known = this.units.get(target.id);
    if (known?.side && side && known.side !== side) return this.result(false, 'INVALID_EVENT', event.eventId);
    const state = known ?? { id: target.id, side: side ?? null, hp: null, maxHp: null, dead: false, shield: 0, statuses: [] };
    if (!known) { this.units.set(target.id, state); this.unitOrder.push(target.id); }
    if (!state.side && side) state.side = side;
    if (!state.statuses.includes(status.value!)) state.statuses.push(status.value!);
    return this.commit(event);
  }

  private heroState(identity: string): HeroState | null {
    if (identity === this.heroIds.player) return this.heroes.player;
    if (identity === this.heroIds.enemy) return this.heroes.enemy;
    return null;
  }

  private unit(targetId: string, side: Side | undefined): UnitState {
    const existing = this.units.get(targetId);
    if (existing) return existing;
    const state: UnitState = { id: targetId, side: side ?? null, hp: null, maxHp: null, dead: false, shield: 0, statuses: [] };
    this.units.set(targetId, state);
    this.unitOrder.push(targetId);
    return state;
  }

  private die(event: BattleEvent, targetId: string, side: Side | undefined): BattleFeedbackTransitionResult {
    const known = this.units.get(targetId);
    if (known?.side && side && known.side !== side) return this.result(false, 'INVALID_EVENT', event.eventId);
    const state = known ?? { id: targetId, side: side ?? null, hp: null, maxHp: null, dead: false, shield: 0, statuses: [] };
    if (!known) { this.units.set(targetId, state); this.unitOrder.push(targetId); }
    if (!state.side && side) state.side = side;
    state.dead = true; state.hp = 0;
    return this.commit(event);
  }

  private end(event: BattleEvent, payload: Record<string, unknown>): BattleFeedbackTransitionResult {
    const status = this.field(event, payload, ['status'], (value): value is 'won' | 'lost' | 'draw' => value === 'won' || value === 'lost' || value === 'draw');
    const reason = this.field(event, payload, ['reason'], text);
    const winner = this.field(event, payload, ['winner'], (value): value is Side => SIDES.has(value as Side));
    const side = this.field(event, payload, ['side'], (value): value is Side => SIDES.has(value as Side));
    if (!status?.present || !reason?.present || !winner || !side) return this.result(false, 'INVALID_EVENT', event.eventId);
    const expected = status.value === 'won' ? 'player' : status.value === 'lost' ? 'enemy' : undefined;
    if ((expected === undefined && winner.present) || (expected !== undefined && (!winner.present || winner.value !== expected))) return this.result(false, 'INVALID_EVENT', event.eventId);
    this.status = status.value!; this.winner = expected ?? null; this.reason = reason.value!; this.settled = true;
    return this.commit(event);
  }

  private field<T>(event: BattleEvent, payload: Record<string, unknown>, keys: readonly string[], check: (value: unknown) => value is T): Field<T> {
    const values: unknown[] = [];
    const top = event as unknown as Record<string, unknown>;
    for (const key of keys) {
      const inPayload = Object.prototype.hasOwnProperty.call(payload, key);
      const inEvent = Object.prototype.hasOwnProperty.call(top, key);
      if (inPayload && inEvent && !Object.is(payload[key], top[key])) return null;
      if (inPayload) values.push(payload[key]); else if (inEvent) values.push(top[key]);
    }
    if (values.length === 0) return { present: false };
    if (!values.every((value) => check(value)) || !values.every((value) => Object.is(value, values[0]))) return null;
    return { present: true, value: values[0] as T };
  }

  private heroSide(identity: string): Side | null {
    if (identity === this.heroIds.player) return 'player';
    if (identity === this.heroIds.enemy) return 'enemy';
    return null;
  }
  private commit(event: BattleEvent): BattleFeedbackTransitionResult { this.lastId = event.eventId; this.lastType = event.type; this.sequence += 1; this.current = this.snapshotFromState(); return this.result(true, 'APPLIED', event.eventId); }
  private result(accepted: boolean, code: BattleFeedbackTransitionCode, id: number | null): BattleFeedbackTransitionResult { return Object.freeze({ accepted, code, eventId: id, snapshot: this.current }); }
  private snapshotFromState(): BattleFeedbackProjectorSnapshot {
    const hero = (side: Side): BattleFeedbackHeroSnapshot => Object.freeze({ id: this.heroIds[side], side, hp: this.heroes[side].hp, maxHp: this.heroes[side].maxHp, dead: this.heroes[side].hp === 0, shield: this.heroes[side].shield });
    const unit = (state: UnitState): BattleFeedbackUnitSnapshot => Object.freeze({ ...state, statuses: Object.freeze([...state.statuses]) });
    return Object.freeze({ battleStatus: this.status, winner: this.winner, reason: this.reason, settled: this.settled, lastEventId: this.lastId, lastEventType: this.lastType, sequence: this.sequence, heroes: Object.freeze({ player: hero('player'), enemy: hero('enemy') }), units: Object.freeze(this.unitOrder.map((key) => unit(this.units.get(key)!))) });
  }
  private heroIdOptions(value: BattleFeedbackProjectorOptions['heroIds']): Readonly<Record<Side, string>> { return Object.freeze({ player: text(value?.player) ? value.player : DEFAULT_IDS.player, enemy: text(value?.enemy) ? value.enemy : DEFAULT_IDS.enemy }); }
  private sideNumbers(value: number | Readonly<Record<Side, number>> | undefined, fallback: number | Readonly<Record<Side, number>>): Readonly<Record<Side, number>> {
    const base = typeof fallback === 'number' ? { player: fallback, enemy: fallback } : fallback;
    if (positive(value)) return Object.freeze({ player: value, enemy: value });
    return Object.freeze({ player: record(value) && positive(value.player) ? value.player : base.player, enemy: record(value) && positive(value.enemy) ? value.enemy : base.enemy });
  }
}
