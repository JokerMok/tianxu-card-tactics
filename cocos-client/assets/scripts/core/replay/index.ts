import { createRng, nextRandom, type RngState } from '../rng/index.ts';

export interface ReplayCommand {
  readonly type: string;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export interface ReplayEvent {
  readonly sequence: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly rngCursor: number;
  readonly state: ReplayState;
}

export interface ReplayState {
  readonly round: number;
  readonly heroHp: Readonly<Record<'player' | 'enemy', number>>;
  readonly units: readonly Readonly<Record<string, unknown>>[];
  readonly playedCards: readonly string[];
  readonly status: 'playing' | 'won' | 'lost' | 'draw';
}

export interface ReplayTrace {
  readonly seed: number;
  readonly commands: readonly ReplayCommand[];
  readonly events: readonly ReplayEvent[];
  readonly finalHash: string;
}

export interface ReplayVerification {
  readonly valid: boolean;
  readonly expectedHash: string;
  readonly actualHash: string;
  readonly eventsMatch: boolean;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function hash(value: string): string {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193) >>> 0;
  }
  return result.toString(16).padStart(8, '0');
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

const COMMAND_TYPES = new Set([
  'BATTLE_START', 'ROUND_START', 'CARD_READY', 'CARD_PLAYED', 'UNIT_SPAWNED', 'UNIT_MOVED',
  'ATTACK', 'DAMAGE', 'HEAL', 'STATUS_APPLIED', 'UNIT_DIED', 'HERO_DAMAGED', 'BATTLE_END', 'END_TURN',
]);

function validateCommand(command: ReplayCommand, index: number): void {
  if (!command || typeof command.type !== 'string' || command.type.trim().length === 0) throw new Error(`invalid replay command at ${index}`);
  if (!COMMAND_TYPES.has(command.type)) throw new Error(`unknown replay command at ${index}: ${command.type}`);
  if (command.payload !== undefined && (command.payload === null || Array.isArray(command.payload) || typeof command.payload !== 'object')) throw new Error(`invalid replay payload at ${index}`);
}

export function replayCommands(seed: number, commands: readonly ReplayCommand[]): ReplayTrace {
  if (!Number.isSafeInteger(seed)) throw new Error('replay seed must be a safe integer');
  let rng: RngState = createRng(seed);
  let state: ReplayState = { round: 0, heroHp: { player: 0, enemy: 0 }, units: [], playedCards: [], status: 'playing' };
  const normalized = commands.map((command, index) => {
    validateCommand(command, index);
    const payload = command.payload ? JSON.parse(stable(command.payload)) as Readonly<Record<string, unknown>> : {};
    const random = nextRandom(rng);
    rng = random.state;
    state = applyCommand(state, command.type, payload);
    return { command: { type: command.type, payload }, random: random.value, rngCursor: rng.rngCursor, state };
  });
  const events = normalized.map((entry, index): ReplayEvent => ({
    sequence: index + 1,
    type: entry.command.type,
    payload: { ...entry.command.payload, replayRandom: entry.random },
    rngCursor: entry.rngCursor,
    state: entry.state,
  }));
  const commandsCopy = normalized.map((entry) => entry.command);
  const finalHash = hash(stable({ seed, commands: commandsCopy, events }));
  return freeze({ seed, commands: commandsCopy, events, finalHash });
}

function applyCommand(state: ReplayState, type: string, payload: Readonly<Record<string, unknown>>): ReplayState {
  if (type === 'ROUND_START') return { ...state, round: typeof payload.round === 'number' ? payload.round : state.round + 1 };
  if (type === 'HERO_DAMAGED' || type === 'DAMAGE') {
    const side = payload.side === 'enemy' ? 'enemy' : 'player';
    const value = typeof payload.value === 'number' ? Math.max(0, payload.value) : 0;
    return { ...state, heroHp: { ...state.heroHp, [side]: Math.max(0, state.heroHp[side] - value) } };
  }
  if (type === 'HEAL') {
    const side = payload.side === 'enemy' ? 'enemy' : 'player';
    const value = typeof payload.value === 'number' ? Math.max(0, payload.value) : 0;
    return { ...state, heroHp: { ...state.heroHp, [side]: state.heroHp[side] + value } };
  }
  if (type === 'CARD_PLAYED' && typeof payload.cardId === 'string') return { ...state, playedCards: [...state.playedCards, payload.cardId] };
  if (type === 'UNIT_SPAWNED' && typeof payload.id === 'string') return { ...state, units: [...state.units, { ...payload }] };
  if (type === 'UNIT_DIED' && typeof payload.id === 'string') return { ...state, units: state.units.filter((unit) => unit.id !== payload.id) };
  if (type === 'BATTLE_END') return { ...state, status: payload.status === 'won' || payload.status === 'lost' || payload.status === 'draw' ? payload.status : 'playing' };
  return state;
}

export function verifyReplay(trace: ReplayTrace): ReplayVerification {
  const replayed = replayCommands(trace.seed, trace.commands);
  const eventsMatch = stable(replayed.events) === stable(trace.events);
  return { valid: eventsMatch && replayed.finalHash === trace.finalHash, expectedHash: trace.finalHash, actualHash: replayed.finalHash, eventsMatch };
}

export function replayHash(seed: number, commands: readonly ReplayCommand[]): string {
  return replayCommands(seed, commands).finalHash;
}

export function keyReplayEvents(trace: ReplayTrace, types: readonly string[]): readonly ReplayEvent[] {
  const accepted = new Set(types);
  return trace.events.filter((event) => accepted.has(event.type));
}
