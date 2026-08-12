import type { BattleEvent } from '../../core/types/index.ts';

export const UNIT_ACTION_STATES = Object.freeze({
  IDLE: 'Idle',
  MOVE: 'Move',
  ATTACK: 'Attack',
  HIT: 'Hit',
  DEATH: 'Death',
} as const);

export type UnitActionState = typeof UNIT_ACTION_STATES[keyof typeof UNIT_ACTION_STATES];

export type UnitActionTransitionCode =
  | 'APPLIED'
  | 'UNKNOWN_EVENT'
  | 'INVALID_EVENT'
  | 'UNKNOWN_UNIT'
  | 'DUPLICATE_EVENT'
  | 'OUT_OF_ORDER_EVENT'
  | 'DUPLICATE_UNIT'
  | 'TERMINAL_STATE';

export interface UnitActionStateSnapshot {
  readonly unitId: string;
  readonly state: UnitActionState;
  readonly lastEventId: number;
  readonly lastEventType: string;
}

export interface UnitActionSnapshot {
  readonly lastEventId: number | null;
  readonly sequence: number;
  readonly units: readonly UnitActionStateSnapshot[];
}

export interface UnitActionTransitionResult {
  readonly accepted: boolean;
  readonly code: UnitActionTransitionCode;
  readonly eventId: number | null;
  readonly unitId: string | null;
  readonly state: UnitActionState | null;
  readonly snapshot: UnitActionSnapshot;
}

const EVENT_STATE = Object.freeze({
  UNIT_SPAWNED: UNIT_ACTION_STATES.IDLE,
  UNIT_MOVED: UNIT_ACTION_STATES.MOVE,
  ATTACK: UNIT_ACTION_STATES.ATTACK,
  DAMAGE: UNIT_ACTION_STATES.HIT,
  UNIT_DIED: UNIT_ACTION_STATES.DEATH,
} as const);

type ActionEventType = keyof typeof EVENT_STATE;

interface UnitIdResolution {
  readonly valid: boolean;
  readonly unitId: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readPayload(event: BattleEvent): Record<string, unknown> {
  return isRecord(event.payload) ? event.payload : {};
}

function freezeStateSnapshot(snapshot: UnitActionStateSnapshot): UnitActionStateSnapshot {
  return Object.freeze({ ...snapshot });
}

function freezeSnapshot(
  lastEventId: number | null,
  sequence: number,
  units: readonly UnitActionStateSnapshot[],
): UnitActionSnapshot {
  return Object.freeze({
    lastEventId,
    sequence,
    units: Object.freeze(units.map(freezeStateSnapshot)),
  });
}

function stateEventType(type: string): UnitActionState | undefined {
  return Object.prototype.hasOwnProperty.call(EVENT_STATE, type)
    ? EVENT_STATE[type as ActionEventType]
    : undefined;
}

function resolveUnitId(event: BattleEvent, type: ActionEventType): UnitIdResolution {
  const payload = readPayload(event);
  if (type === 'ATTACK') {
    return {
      valid: true,
      unitId: readString(payload.attackerId)
        ?? readString(event.sourceId)
        ?? readString(payload.sourceId),
    };
  }
  if (type === 'DAMAGE') {
    const targetKind = payload.targetKind;
    if (targetKind !== undefined && targetKind !== 'unit') return { valid: false, unitId: undefined };
    return { valid: true, unitId: readString(payload.targetId) ?? readString(event.targetId) };
  }
  return {
    valid: true,
    unitId: readString(payload.unitId)
      ?? readString(payload.id)
      ?? readString(event.targetId),
  };
}

function isEventId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

/**
 * Deterministic, host-neutral projection of core battle events into unit action states.
 * It owns no animation clock and never mutates the core BattleState.
 */
export class UnitActionStateMachine {
  private lastEventIdValue: number | null = null;
  private sequenceValue = 0;
  private readonly units = new Map<string, UnitActionStateSnapshot>();
  private order: string[] = [];
  private snapshotValue = freezeSnapshot(null, 0, []);

  get snapshot(): UnitActionSnapshot {
    return this.snapshotValue;
  }

  get states(): readonly UnitActionStateSnapshot[] {
    return this.snapshotValue.units;
  }

  getState(unitId: string): UnitActionState | undefined {
    return this.units.get(unitId)?.state;
  }

  getUnitSnapshot(unitId: string): UnitActionStateSnapshot | undefined {
    return this.units.get(unitId);
  }

  getSnapshot(): UnitActionSnapshot {
    return this.snapshotValue;
  }

  dispatch(event: BattleEvent): UnitActionTransitionResult {
    const type = isRecord(event) && typeof event.type === 'string' ? event.type : undefined;
    if (!type || stateEventType(type) === undefined) {
      return this.result(false, 'UNKNOWN_EVENT', isRecord(event) && isEventId(event.eventId) ? event.eventId : null, null);
    }
    if (!isEventId(event.eventId)) return this.result(false, 'INVALID_EVENT', null, null);
    if (this.lastEventIdValue !== null && event.eventId === this.lastEventIdValue) {
      return this.result(false, 'DUPLICATE_EVENT', event.eventId, null);
    }
    if (this.lastEventIdValue !== null && event.eventId < this.lastEventIdValue) {
      return this.result(false, 'OUT_OF_ORDER_EVENT', event.eventId, null);
    }

    const resolution = resolveUnitId(event, type as ActionEventType);
    if (!resolution.valid || !resolution.unitId) {
      return this.result(false, 'INVALID_EVENT', event.eventId, resolution.unitId ?? null);
    }
    const current = this.units.get(resolution.unitId);
    if (type === 'UNIT_SPAWNED') {
      if (current) return this.result(false, 'DUPLICATE_UNIT', event.eventId, resolution.unitId);
    } else if (!current) {
      return this.result(false, 'UNKNOWN_UNIT', event.eventId, resolution.unitId);
    } else if (current.state === UNIT_ACTION_STATES.DEATH) {
      return this.result(false, 'TERMINAL_STATE', event.eventId, resolution.unitId);
    }

    const nextState = stateEventType(type);
    const nextSnapshot: UnitActionStateSnapshot = {
      unitId: resolution.unitId,
      state: nextState!,
      lastEventId: event.eventId,
      lastEventType: type,
    };
    if (!current) this.order = [...this.order, resolution.unitId];
    this.units.set(resolution.unitId, freezeStateSnapshot(nextSnapshot));
    this.lastEventIdValue = event.eventId;
    this.sequenceValue += 1;
    this.snapshotValue = freezeSnapshot(
      this.lastEventIdValue,
      this.sequenceValue,
      this.order.map((unitId) => this.units.get(unitId)!),
    );
    return this.result(true, 'APPLIED', event.eventId, resolution.unitId);
  }

  applyEvent(event: BattleEvent): UnitActionTransitionResult {
    return this.dispatch(event);
  }

  applyEvents(events: readonly BattleEvent[]): readonly UnitActionTransitionResult[] {
    return Object.freeze(events.map((event) => this.dispatch(event)));
  }

  private result(
    accepted: boolean,
    code: UnitActionTransitionCode,
    eventId: number | null,
    unitId: string | null,
  ): UnitActionTransitionResult {
    return Object.freeze({
      accepted,
      code,
      eventId,
      unitId,
      state: unitId ? this.getState(unitId) ?? null : null,
      snapshot: this.snapshotValue,
    });
  }
}

export type UnitActionStateMachineSnapshot = UnitActionSnapshot;
