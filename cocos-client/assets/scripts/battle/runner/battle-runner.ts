import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { createBoardState, deployUnit, isSummonCell } from '../../core/board/index.ts';
import { createAttackAction, type AttackTarget } from '../../core/combat/index.ts';
import { damageUnit, removeDead } from '../../core/combat/damage.ts';
import { createCardState, type CardState } from '../../core/cards/index.ts';
import { enqueue, event, type EventQueue } from '../../core/events/index.ts';
import { moveUnit } from '../../core/movement/index.ts';
import { resolveOutcome, type OutcomeResult } from '../../core/outcome/index.ts';
import { chooseSeeded, type RngState } from '../../core/rng/index.ts';
import { createBattleState, updateBattleState, type BattleEvent, type BattleState, type Side, type Unit } from '../../core/types/index.ts';

export const BATTLE_RUNNER_PROTOCOL = 'tianxu.cocos-battle-runner/v1';
export const BATTLE_RUNNER = 'cocos-battle';

type BattleRunnerErrorCode = 'INVALID_JSON' | 'INVALID_INPUT' | 'INVALID_COMMAND' | 'STATE_REHYDRATION_FORBIDDEN';

interface BattleRunnerInput {
  readonly protocol: typeof BATTLE_RUNNER_PROTOCOL;
  readonly seed: number;
  readonly actions: readonly HighLevelAction[];
}

export type HighLevelAction =
  | { readonly type: 'BATTLE_START' }
  | { readonly type: 'DEPLOY_UNIT'; readonly cardId: string; readonly side: Side; readonly lane: number; readonly cell: number }
  | { readonly type: 'MOVE_UNIT'; readonly unitId: string; readonly steps?: number }
  | { readonly type: 'ATTACK'; readonly attackerId: string }
  | { readonly type: 'END_TURN' };

export interface BattleRunnerOutput {
  readonly protocol: typeof BATTLE_RUNNER_PROTOCOL;
  readonly status: 'ok';
  readonly runner: typeof BATTLE_RUNNER;
  readonly seed: number;
  readonly actionCount: number;
  readonly finalState: BattleState;
  readonly events: readonly BattleEvent[];
  readonly rngCursor: number;
  readonly outcome: OutcomeResult;
  readonly finalHash: string;
}

interface BattleRunnerError {
  readonly protocol: typeof BATTLE_RUNNER_PROTOCOL;
  readonly status: 'error';
  readonly error: { readonly code: BattleRunnerErrorCode; readonly message: string };
}

interface CardConfig {
  readonly id: string;
  readonly cardType: string;
  readonly prepare: number;
  readonly unitId?: string;
  readonly nameKey?: string;
  readonly tags?: readonly string[];
  readonly enabled?: boolean;
}

interface UnitConfig {
  readonly id: string;
  readonly maxHp: number;
  readonly attack: number;
  readonly armor: number;
  readonly move: number;
  readonly range: number;
  readonly role: string;
  readonly enabled?: boolean;
}

interface AuthorityConfig {
  readonly cards: readonly CardConfig[];
  readonly units: readonly UnitConfig[];
  readonly deck: readonly string[];
  readonly prepareByCardId: Readonly<Record<string, number>>;
}

const STATE_REHYDRATION_FIELDS = new Set([
  'finalState', 'events', 'heroHp', 'heroMaxHp', 'units', 'decks', 'hands', 'graveyards',
  'rngCursor', 'rngState', 'outcome', 'status', 'playedCards', 'nextId', 'nextEventId',
]);
const ACTION_TYPES = new Set(['BATTLE_START', 'DEPLOY_UNIT', 'MOVE_UNIT', 'ATTACK', 'END_TURN']);
const SIDES: readonly Side[] = ['player', 'enemy'];
const HERO_MAX_HP = 30;
const MAX_ROUNDS = 80;

class RunnerInputError extends Error {
  readonly code: BattleRunnerErrorCode;

  constructor(code: BattleRunnerErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isUnknownArray(value: unknown): value is readonly unknown[] {
  return Array.isArray(value);
}

function readJson<T>(configRoot: string, name: string): T {
  return JSON.parse(fs.readFileSync(path.join(configRoot, name), 'utf8')) as T;
}

function loadAuthority(): AuthorityConfig {
  const configRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../resources/config');
  const cardsTable = readJson<{ cards: readonly CardConfig[] }>(configRoot, 'cards.json');
  const unitsTable = readJson<{ units: readonly UnitConfig[] }>(configRoot, 'units.json');
  const decksTable = readJson<{ decks: readonly { id: string; cardEntries: readonly { cardId: string; count: number }[] }[] }>(configRoot, 'decks.json');
  const deckConfig = decksTable.decks.find((deck) => deck.id === 'D001') ?? decksTable.decks[0];
  if (!deckConfig) throw new Error('authoritative deck D001 is missing');
  const cards = cardsTable.cards.filter((card) => card.enabled !== false);
  const units = unitsTable.units.filter((unit) => unit.enabled !== false);
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  const unitsById = new Map(units.map((unit) => [unit.id, unit]));
  const deck = deckConfig.cardEntries.flatMap((entry) => Array.from({ length: entry.count }, () => entry.cardId));
  for (const cardId of deck) {
    const card = cardsById.get(cardId);
    if (!card || !Number.isSafeInteger(card.prepare) || card.prepare < 0) throw new Error(`authoritative card is invalid: ${cardId}`);
    if (card.cardType === 'UNIT' && (!card.unitId || !unitsById.has(card.unitId))) throw new Error(`authoritative unit is missing: ${cardId}`);
  }
  return {
    cards,
    units,
    deck,
    prepareByCardId: Object.fromEntries(cards.map((card) => [card.id, card.prepare])),
  };
}

const AUTHORITY = loadAuthority();

function exactKeys(value: Record<string, unknown>, allowed: readonly string[], label: string, code: BattleRunnerErrorCode): void {
  const forbidden = Object.keys(value).find((key) => STATE_REHYDRATION_FIELDS.has(key));
  if (forbidden) throw new RunnerInputError('STATE_REHYDRATION_FORBIDDEN', `${label}.${forbidden} is forbidden; runner state is seed-derived`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new RunnerInputError(code, `${label} has unsupported field: ${unknown[0]}`);
  if (Object.keys(value).length !== allowed.length) {
    throw new RunnerInputError(code, `${label} must contain exactly: ${[...allowed].sort().join(', ')}`);
  }
}

function parseAction(value: unknown, index: number): HighLevelAction {
  if (!isRecord(value)) throw new RunnerInputError('INVALID_COMMAND', `input.actions[${index}] must be an object`);
  if (typeof value.type !== 'string' || !ACTION_TYPES.has(value.type)) {
    throw new RunnerInputError('INVALID_COMMAND', `input.actions[${index}].type is not a supported high-level action`);
  }
  const label = `input.actions[${index}]`;
  if (value.type === 'BATTLE_START' || value.type === 'END_TURN') {
    exactKeys(value, ['type'], label, 'INVALID_COMMAND');
    return value as unknown as HighLevelAction;
  }
  if (value.type === 'DEPLOY_UNIT') {
    exactKeys(value, ['type', 'cardId', 'side', 'lane', 'cell'], label, 'INVALID_COMMAND');
    if (typeof value.cardId !== 'string' || typeof value.side !== 'string' || !isSafeInteger(value.lane) || !isSafeInteger(value.cell)) {
      throw new RunnerInputError('INVALID_COMMAND', `${label} DEPLOY_UNIT requires cardId, side, integer lane and integer cell`);
    }
    return value as unknown as HighLevelAction;
  }
  if (value.type === 'MOVE_UNIT') {
    exactKeys(value, value.steps === undefined ? ['type', 'unitId'] : ['type', 'unitId', 'steps'], label, 'INVALID_COMMAND');
    if (typeof value.unitId !== 'string' || (value.steps !== undefined && !isSafeInteger(value.steps))) {
      throw new RunnerInputError('INVALID_COMMAND', `${label} MOVE_UNIT requires unitId and optional integer steps`);
    }
    return value as unknown as HighLevelAction;
  }
  exactKeys(value, ['type', 'attackerId'], label, 'INVALID_COMMAND');
  if (typeof value.attackerId !== 'string') throw new RunnerInputError('INVALID_COMMAND', `${label}.attackerId must be a string`);
  return value as unknown as HighLevelAction;
}

function parseInput(value: unknown): BattleRunnerInput {
  if (!isRecord(value)) throw new RunnerInputError('INVALID_INPUT', 'input must be a JSON object');
  const rootForbidden = Object.keys(value).find((key) => STATE_REHYDRATION_FIELDS.has(key));
  if (rootForbidden) throw new RunnerInputError('STATE_REHYDRATION_FORBIDDEN', `input.${rootForbidden} is forbidden; runner state is seed-derived`);
  exactKeys(value, ['protocol', 'seed', 'actions'], 'input', 'INVALID_INPUT');
  if (value.protocol !== BATTLE_RUNNER_PROTOCOL) throw new RunnerInputError('INVALID_INPUT', `input.protocol must be ${BATTLE_RUNNER_PROTOCOL}`);
  const seed = value.seed;
  if (!isSafeInteger(seed)) throw new RunnerInputError('INVALID_INPUT', 'input.seed must be a safe integer');
  const rawActions = value.actions;
  if (!isUnknownArray(rawActions)) throw new RunnerInputError('INVALID_INPUT', 'input.actions must be an array');
  const actions: HighLevelAction[] = rawActions.map((action, index) => parseAction(action, index));
  return { protocol: BATTLE_RUNNER_PROTOCOL, seed, actions };
}

function unitConfig(cardId: string): { readonly card: CardConfig; readonly unit: UnitConfig } {
  const card = AUTHORITY.cards.find((candidate) => candidate.id === cardId);
  if (!card || card.cardType !== 'UNIT' || !card.unitId) throw new RunnerInputError('INVALID_COMMAND', `cardId is not an enabled unit card: ${cardId}`);
  const unit = AUTHORITY.units.find((candidate) => candidate.id === card.unitId);
  if (!unit) throw new RunnerInputError('INVALID_COMMAND', `unit config is missing for cardId: ${cardId}`);
  return { card, unit };
}

function initialState(seed: number): BattleState {
  const cards: CardState = createCardState({ seed, decks: { player: AUTHORITY.deck, enemy: AUTHORITY.deck }, prepareByCardId: AUTHORITY.prepareByCardId });
  const initiative = chooseSeeded(cards.rng, SIDES);
  const rng: RngState = initiative.state;
  return createBattleState({
    revision: 0,
    seed,
    rngState: rng.rngState,
    rngCursor: rng.rngCursor,
    round: 0,
    turn: 0,
    maxRounds: MAX_ROUNDS,
    laneCount: 2,
    cellsPerLane: 12,
    summonDepth: 3,
    openingInitiative: initiative.value ?? 'player',
    activeSide: initiative.value ?? 'player',
    heroHp: { player: HERO_MAX_HP, enemy: HERO_MAX_HP },
    heroMaxHp: { player: HERO_MAX_HP, enemy: HERO_MAX_HP },
    decks: cards.decks,
    hands: cards.hands,
    graveyards: { player: [], enemy: [] },
    units: [],
    events: [],
    status: 'playing',
    nextId: 1,
    nextEventId: 1,
  });
}

function update(state: BattleState, patch: Partial<BattleState>): BattleState {
  return updateBattleState(state, patch);
}

function emit(state: BattleState, type: string, side: Side, payload: Readonly<Record<string, unknown>> = {}): BattleState {
  const queue: EventQueue = { nextEventId: state.nextEventId, events: state.events };
  const next = enqueue(queue, { ...event(type, side, payload), round: state.round, turn: state.turn, activeSide: state.activeSide, rngCursor: state.rngCursor });
  return update(state, { events: next.events, nextEventId: next.nextEventId });
}

function ensureStarted(state: BattleState): void {
  if (state.round === 0) throw new RunnerInputError('INVALID_COMMAND', 'battle must start before this action');
  if (state.status !== 'playing') throw new RunnerInputError('INVALID_COMMAND', 'battle has already settled');
}

function startBattle(state: BattleState): BattleState {
  if (state.round !== 0) throw new RunnerInputError('INVALID_COMMAND', 'BATTLE_START may only be issued once');
  let next = update(state, { round: 1, turn: 1, activeSide: state.openingInitiative });
  next = emit(next, 'BATTLE_START', next.activeSide, { seed: next.seed });
  next = emit(next, 'ROUND_START', next.activeSide, { round: next.round });
  return emit(next, 'TURN_START', next.activeSide, { turn: next.turn });
}

function deploy(state: BattleState, action: Extract<HighLevelAction, { type: 'DEPLOY_UNIT' }>): BattleState {
  ensureStarted(state);
  if (action.side !== 'player' && action.side !== 'enemy') throw new RunnerInputError('INVALID_COMMAND', `DEPLOY_UNIT side is invalid: ${action.side}`);
  if (action.side !== state.activeSide) throw new RunnerInputError('INVALID_COMMAND', `DEPLOY_UNIT side must be active side: ${state.activeSide}`);
  if (!isSummonCell(action.side, action.lane, action.cell)) throw new RunnerInputError('INVALID_COMMAND', 'DEPLOY_UNIT lane/cell is outside the side summon cells');
  const config = unitConfig(action.cardId);
  const handIndex = state.hands[action.side].findIndex((card) => card.cardId === action.cardId);
  if (handIndex < 0) throw new RunnerInputError('INVALID_COMMAND', `cardId is not in ${action.side} hand: ${action.cardId}`);
  const unitId = `unit-${action.side}-${state.nextId}`;
  const unit: Unit = {
    id: unitId,
    cardId: action.cardId,
    name: config.card.nameKey ?? action.cardId,
    side: action.side,
    lane: action.lane,
    cell: action.cell,
    hp: config.unit.maxHp,
    maxHp: config.unit.maxHp,
    attack: config.unit.attack,
    armor: config.unit.armor,
    move: config.unit.move,
    range: config.unit.range,
    role: config.unit.role.toLowerCase() as Unit['role'],
    tags: config.card.tags ?? [],
    statuses: [],
    actionsTaken: 0,
    spawnRound: state.round,
  };
  const board = deployUnit(createBoardState(state.units), unit);
  const hand = [...state.hands[action.side]];
  hand.splice(handIndex, 1);
  let next = update(state, {
    units: board.units,
    hands: { ...state.hands, [action.side]: hand },
    nextId: state.nextId + 1,
  });
  next = emit(next, 'CARD_PLAYED', action.side, { cardId: action.cardId });
  return emit(next, 'UNIT_SPAWNED', action.side, { unitId, cardId: action.cardId, lane: action.lane, cell: action.cell });
}

function move(state: BattleState, action: Extract<HighLevelAction, { type: 'MOVE_UNIT' }>): BattleState {
  ensureStarted(state);
  const current = state.units.find((unit) => unit.id === action.unitId);
  if (!current) throw new RunnerInputError('INVALID_COMMAND', `unitId does not exist: ${action.unitId}`);
  if (current.side !== state.activeSide) throw new RunnerInputError('INVALID_COMMAND', `unitId is not controlled by active side: ${action.unitId}`);
  const result = moveUnit(createBoardState(state.units), action.unitId, action.steps);
  let next = update(state, { units: result.state.units });
  return emit(next, 'UNIT_MOVED', state.activeSide, {
    unitId: action.unitId,
    requestedSteps: action.steps,
    steps: result.steps,
    moved: result.moved,
    blocked: result.blocked,
  });
}

function attack(state: BattleState, action: Extract<HighLevelAction, { type: 'ATTACK' }>): BattleState {
  ensureStarted(state);
  const attacker = state.units.find((unit) => unit.id === action.attackerId && unit.hp > 0);
  if (!attacker) throw new RunnerInputError('INVALID_COMMAND', `attackerId does not exist or is dead: ${action.attackerId}`);
  if (attacker.side !== state.activeSide) throw new RunnerInputError('INVALID_COMMAND', `attackerId is not controlled by active side: ${action.attackerId}`);
  const actionResult = createAttackAction(createBoardState(state.units), action.attackerId);
  if (!actionResult) throw new RunnerInputError('INVALID_COMMAND', `attackerId has no legal target: ${action.attackerId}`);
  let next = emit(state, 'ATTACK', attacker.side, {
    attackerId: action.attackerId,
    targetKind: actionResult.target.kind,
    targetId: actionResult.target.kind === 'unit' ? actionResult.target.unit.id : actionResult.target.side,
    distance: actionResult.target.distance,
    damage: actionResult.damage,
  });
  if (actionResult.target.kind === 'hero') {
    const targetSide = actionResult.target.side;
    const dealt = actionResult.damage;
    next = update(next, {
      heroHp: { ...next.heroHp, [targetSide]: Math.max(0, next.heroHp[targetSide] - dealt) },
      units: next.units.map((unit) => unit.id === attacker.id ? { ...unit, actionsTaken: unit.actionsTaken + 1 } : unit),
    });
    return emit(next, 'DAMAGE', targetSide, { targetKind: 'hero', targetId: targetSide, value: dealt, sourceId: attacker.id });
  }
  const target = actionResult.target as Extract<AttackTarget, { kind: 'unit' }>;
  const damaged = damageUnit(createBoardState(next.units), target.unit.id, actionResult.damage, true);
  const cleaned = removeDead(damaged.state);
  const units = cleaned.units.map((unit) => unit.id === attacker.id ? { ...unit, actionsTaken: unit.actionsTaken + 1 } : unit);
  next = update(next, { units });
  next = emit(next, 'DAMAGE', target.unit.side, { targetKind: 'unit', targetId: target.unit.id, value: damaged.damage, sourceId: attacker.id });
  if (!damaged.killed) return next;
  next = update(next, { graveyards: { ...next.graveyards, [target.unit.side]: [...next.graveyards[target.unit.side], target.unit.cardId] } });
  return emit(next, 'UNIT_DIED', target.unit.side, { unitId: target.unit.id, cardId: target.unit.cardId });
}

function endTurn(state: BattleState): BattleState {
  ensureStarted(state);
  let next = emit(state, 'TURN_END', state.activeSide, { turn: state.turn });
  const nextSide: Side = state.activeSide === 'player' ? 'enemy' : 'player';
  const nextRound = state.activeSide === 'enemy' ? state.round + 1 : state.round;
  next = update(next, { activeSide: nextSide, round: nextRound, turn: state.turn + 1 });
  if (nextRound >= next.maxRounds) return emit(next, 'ROUND_START', nextSide, { round: nextRound });
  if (nextRound !== state.round) next = emit(next, 'ROUND_START', nextSide, { round: nextRound });
  return emit(next, 'TURN_START', nextSide, { turn: next.turn });
}

function applyAction(state: BattleState, action: HighLevelAction): BattleState {
  if (action.type === 'BATTLE_START') return startBattle(state);
  if (action.type === 'DEPLOY_UNIT') return deploy(state, action);
  if (action.type === 'MOVE_UNIT') return move(state, action);
  if (action.type === 'ATTACK') return attack(state, action);
  return endTurn(state);
}

function settle(state: BattleState): { readonly state: BattleState; readonly outcome: OutcomeResult } {
  const outcome = resolveOutcome({ heroHp: state.heroHp, round: state.round, maxRounds: state.maxRounds, rng: { rngState: state.rngState, rngCursor: state.rngCursor } });
  if (!outcome.settled) return { state, outcome };
  let next = update(state, { status: outcome.status, rngState: outcome.rng.rngState, rngCursor: outcome.rng.rngCursor });
  next = emit(next, 'BATTLE_END', outcome.winner ?? state.activeSide, {
    status: outcome.status,
    winner: outcome.winner,
    reason: outcome.reason,
  });
  return { state: next, outcome };
}

function stable(value: unknown): string {
  if (value === undefined) return 'undefined';
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

export function runBattleRunner(input: unknown): BattleRunnerOutput {
  const parsed = parseInput(input);
  let state = initialState(parsed.seed);
  let outcome = resolveOutcome({ heroHp: state.heroHp, round: state.round, maxRounds: state.maxRounds, rng: { rngState: state.rngState, rngCursor: state.rngCursor } });
  for (const action of parsed.actions) {
    state = applyAction(state, action);
    const settled = settle(state);
    state = settled.state;
    outcome = settled.outcome;
  }
  const finalHash = hash(stable({ seed: parsed.seed, actions: parsed.actions, finalState: state, events: state.events, outcome }));
  return {
    protocol: BATTLE_RUNNER_PROTOCOL,
    status: 'ok',
    runner: BATTLE_RUNNER,
    seed: parsed.seed,
    actionCount: parsed.actions.length,
    finalState: state,
    events: state.events,
    rngCursor: state.rngCursor,
    outcome,
    finalHash,
  };
}

function errorOutput(error: unknown): BattleRunnerError {
  if (error instanceof RunnerInputError) return { protocol: BATTLE_RUNNER_PROTOCOL, status: 'error', error: { code: error.code, message: error.message } };
  return { protocol: BATTLE_RUNNER_PROTOCOL, status: 'error', error: { code: 'INVALID_JSON', message: error instanceof Error ? error.message : String(error) } };
}

async function main(): Promise<void> {
  let output: BattleRunnerOutput | BattleRunnerError;
  try {
    let raw = '';
    process.stdin.setEncoding('utf8');
    for await (const chunk of process.stdin) raw += chunk;
    output = runBattleRunner(JSON.parse(raw));
  } catch (error) {
    output = errorOutput(error);
    process.exitCode = 1;
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
