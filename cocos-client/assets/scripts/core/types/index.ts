export type Side = 'player' | 'enemy';
export type BattleStatus = 'playing' | 'won' | 'lost' | 'draw';
export type UnitRole = 'guard' | 'striker' | 'support' | 'control';

export interface Status {
  readonly id: string;
  readonly kind: string;
  readonly sourceId?: string;
  readonly stacks: number;
  readonly remainingRounds?: number;
  readonly value?: number;
}

export interface Unit {
  readonly id: string;
  readonly cardId: string;
  readonly name: string;
  readonly side: Side;
  readonly lane: number;
  readonly cell: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly attack: number;
  readonly armor: number;
  readonly move: number;
  readonly range: number;
  readonly role: UnitRole;
  readonly tags: readonly string[];
  readonly statuses: readonly Status[];
  readonly actionsTaken: number;
  readonly spawnRound: number;
}

export interface CardInstance {
  readonly instanceId: string;
  readonly cardId: string;
  readonly remainingPreparation: number;
}

export interface BattleEvent {
  readonly eventId: number;
  readonly round: number;
  readonly turn: number;
  readonly activeSide: Side;
  readonly rngCursor: number;
  readonly type: string;
  readonly side?: Side;
  readonly sourceId?: string;
  readonly targetId?: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface BattleState {
  readonly revision: number;
  readonly seed: number;
  readonly rngState: number;
  readonly rngCursor: number;
  readonly round: number;
  readonly turn: number;
  readonly maxRounds: number;
  readonly laneCount: number;
  readonly cellsPerLane: number;
  readonly summonDepth: number;
  readonly openingInitiative: Side;
  readonly activeSide: Side;
  readonly heroHp: Readonly<Record<Side, number>>;
  readonly heroMaxHp: Readonly<Record<Side, number>>;
  readonly decks: Readonly<Record<Side, readonly string[]>>;
  readonly hands: Readonly<Record<Side, readonly CardInstance[]>>;
  readonly graveyards: Readonly<Record<Side, readonly string[]>>;
  readonly units: readonly Unit[];
  readonly events: readonly BattleEvent[];
  readonly status: BattleStatus;
  readonly nextId: number;
  readonly nextEventId: number;
}

export type BattleStateInput = Omit<BattleState, never>;
export type BattleStateUpdate = Partial<BattleState>;
export type BattleStateUpdater = BattleStateUpdate | ((state: BattleState) => BattleStateUpdate);

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) return value.map(cloneValue) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, cloneValue(child)]),
    ) as T;
  }
  return value;
}

function normalize<T extends BattleStateInput>(input: T): BattleState {
  return {
    ...cloneValue(input),
    heroHp: cloneValue(input.heroHp),
    heroMaxHp: cloneValue(input.heroMaxHp),
    decks: cloneValue(input.decks),
    hands: cloneValue(input.hands),
    graveyards: cloneValue(input.graveyards),
    units: cloneValue(input.units),
    events: cloneValue(input.events),
  } as BattleState;
}

export function createBattleState(input: BattleStateInput): BattleState {
  return freeze(normalize(input));
}

export function updateBattleState(state: BattleState, update: BattleStateUpdater): BattleState {
  const patch = typeof update === 'function' ? update(state) : update;
  if (Object.keys(patch).length === 0) return state;
  return createBattleState({ ...state, ...cloneValue(patch), revision: state.revision + 1 });
}
