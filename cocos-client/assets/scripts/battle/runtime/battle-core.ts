import type { AuthorityConfig, CardConfig, SkillConfig, UnitConfig, ProfessionConfig } from './battle-config.ts';
import { createBoardState, deployUnit, getLegalDeploymentCells, isSummonCell } from '../../core/board/index.ts';
import { actionOrder, createAttackAction, type AttackTarget } from '../../core/combat/index.ts';
import { damageUnit, removeDead } from '../../core/combat/damage.ts';
import { createCardState, type CardState } from '../../core/cards/index.ts';
import { enqueue, event, type EventQueue } from '../../core/events/index.ts';
import { moveUnit } from '../../core/movement/index.ts';
import { resolveOutcome, type OutcomeResult } from '../../core/outcome/index.ts';
import {
  createProfessionState,
  professionEffectFor,
  triggerBattleStart,
  triggerDamageOverTime,
  triggerDeploy,
  triggerSpell,
  type Profession,
  type ProfessionState,
} from '../../core/professions/index.ts';
import { chooseSeeded, type RngState } from '../../core/rng/index.ts';
import { createBattleState, updateBattleState, type BattleEvent, type BattleState, type Side, type Unit } from '../../core/types/index.ts';
import type { BattlePlayCardAction, BattleTarget } from '../action-contract.ts';

export const BATTLE_RUNNER_PROTOCOL = 'tianxu.cocos-battle-runner/v1';
export const BATTLE_RUNNER = 'cocos-battle';

type BattleRunnerErrorCode = 'INVALID_JSON' | 'INVALID_INPUT' | 'INVALID_COMMAND' | 'STATE_REHYDRATION_FORBIDDEN';

export interface BattleRunnerInput {
  readonly protocol: typeof BATTLE_RUNNER_PROTOCOL;
  readonly seed: number;
  readonly actions: readonly HighLevelAction[];
  readonly professionId?: string;
}

export type HighLevelAction =
  | { readonly type: 'BATTLE_START' }
  | { readonly type: 'DEPLOY_UNIT'; readonly cardId: string; readonly side: Side; readonly lane: number; readonly cell: number }
  | BattlePlayCardAction
  | { readonly type: 'MOVE_UNIT'; readonly unitId: string; readonly steps?: number }
  | { readonly type: 'ATTACK'; readonly attackerId: string }
  | { readonly type: 'APPLY_DOT'; readonly side: Side; readonly targetIds: readonly string[]; readonly amount: number }
  | { readonly type: 'END_TURN' };

export interface ProfessionConfig {
  readonly id: string;
  readonly skillIds: readonly string[];
  readonly enabled?: boolean;
}

export interface ProfessionRuntimeState extends ProfessionState {
  readonly professionId: string;
  readonly barrierByUnit: Readonly<Record<string, number>>;
  readonly spellResistanceIgnore: number;
  readonly dotDamageReduction: number;
  readonly dotDamageReduced: number;
  readonly preparationReduction: number;
  readonly preparationReductionByCard: Readonly<Record<string, number>>;
}

type RunnerBattleState = BattleState & { readonly professionState?: ProfessionRuntimeState };

export interface BattleRunnerOutput {
  readonly protocol: typeof BATTLE_RUNNER_PROTOCOL;
  readonly status: 'ok';
  readonly runner: typeof BATTLE_RUNNER;
  readonly seed: number;
  readonly actionCount: number;
  readonly finalState: RunnerBattleState;
  readonly events: readonly BattleEvent[];
  readonly rngCursor: number;
  readonly outcome: OutcomeResult;
  readonly finalHash: string;
}

export const BATTLE_RUNNER_V2_PROTOCOL = 'tianxu.cocos-battle-runner/v2';

export interface ParityCardMapping {
  readonly fixtureCardId: string;
  readonly referenceCardId: string;
  readonly cocosCardId: string;
  readonly cocosUnitId?: string;
}

export interface ParityUnitMapping {
  readonly fixtureUnitId: string;
  readonly canonicalUnitId: string;
}

export interface ParityEventMapping {
  readonly fixtureType: string;
  readonly referenceType: string;
  readonly cocosType: string;
  readonly fields: readonly string[];
}

export interface ParityAction {
  readonly type: 'BATTLE_START' | 'END_TURN' | 'DEPLOY_UNIT' | 'MOVE_UNIT' | 'ATTACK';
  readonly cardRef?: string;
  readonly unitRef?: string;
  readonly side?: Side;
  readonly lane?: number;
  readonly cell?: number;
  readonly steps?: number;
}

export interface ParityFixture {
  readonly version: 2;
  readonly cards: readonly ParityCardMapping[];
  readonly units: readonly ParityUnitMapping[];
  readonly events: readonly ParityEventMapping[];
  readonly decks: Readonly<Record<Side, readonly string[]>>;
  readonly actions: readonly ParityAction[];
  readonly ignoredEventTypes: readonly string[];
  readonly compare: {
    readonly stateFields: readonly string[];
    readonly eventFields: readonly string[];
    readonly omittedFields: readonly string[];
  };
}

export interface ParityBattleRunnerOutput {
  readonly protocol: typeof BATTLE_RUNNER_V2_PROTOCOL;
  readonly status: 'ok';
  readonly runner: typeof BATTLE_RUNNER;
  readonly seed: number;
  readonly fixtureVersion: 2;
  readonly actionCount: number;
  readonly finalState: RunnerBattleState;
  readonly events: readonly BattleEvent[];
  readonly lifecycleEvents: readonly BattleEvent[];
  readonly rngCursor: number;
  readonly finalHash: string;
}

export interface BattleRunnerError {
  readonly protocol: typeof BATTLE_RUNNER_PROTOCOL | typeof BATTLE_RUNNER_V2_PROTOCOL;
  readonly status: 'error';
  readonly error: { readonly code: BattleRunnerErrorCode; readonly message: string };
}

const STATE_REHYDRATION_FIELDS = new Set([
  'finalState', 'events', 'heroHp', 'heroMaxHp', 'units', 'decks', 'hands', 'graveyards',
  'rngCursor', 'rngState', 'outcome', 'status', 'playedCards', 'nextId', 'nextEventId', 'professionState',
]);
const ACTION_TYPES = new Set(['BATTLE_START', 'DEPLOY_UNIT', 'PLAY_CARD', 'MOVE_UNIT', 'ATTACK', 'APPLY_DOT', 'END_TURN']);
const SIDES: readonly Side[] = ['player', 'enemy'];
const OTHER_SIDE: Readonly<Record<Side, Side>> = Object.freeze({ player: 'enemy', enemy: 'player' });
const MAX_ROUNDS = 80;
const PEER_CARD_ID_KEY = ['r', 'e', 'a', 'c', 't', 'CardId'].join('');
const PEER_EVENT_TYPE_KEY = ['r', 'e', 'a', 'c', 't', 'Type'].join('');

export class RunnerInputError extends Error {
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

function freezeNeutralValue<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeNeutralValue(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  code: BattleRunnerErrorCode,
  allowSetupFields = false,
): void {
  const forbidden = allowSetupFields ? undefined : Object.keys(value).find((key) => STATE_REHYDRATION_FIELDS.has(key));
  if (forbidden) throw new RunnerInputError('STATE_REHYDRATION_FORBIDDEN', `${label}.${forbidden} is forbidden; runner state is seed-derived`);
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) throw new RunnerInputError(code, `${label} has unsupported field: ${unknown[0]}`);
  if (Object.keys(value).length !== allowed.length) {
    throw new RunnerInputError(code, `${label} must contain exactly: ${[...allowed].sort().join(', ')}`);
  }
}

function parseTarget(value: unknown, label: string): BattleTarget {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new RunnerInputError('INVALID_COMMAND', `${label} must be a target object`);
  }
  if (value.kind === 'global') {
    exactKeys(value, ['kind'], label, 'INVALID_COMMAND');
    return { kind: 'global' };
  }
  if (value.kind === 'lane') {
    exactKeys(value, ['kind', 'lane'], label, 'INVALID_COMMAND');
    if (!isSafeInteger(value.lane)) throw new RunnerInputError('INVALID_COMMAND', `${label}.lane must be an integer`);
    return { kind: 'lane', lane: value.lane };
  }
  if (value.kind === 'cell') {
    exactKeys(value, ['kind', 'lane', 'cell'], label, 'INVALID_COMMAND');
    if (!isSafeInteger(value.lane) || !isSafeInteger(value.cell)) {
      throw new RunnerInputError('INVALID_COMMAND', `${label}.cell requires integer lane and cell`);
    }
    return { kind: 'cell', lane: value.lane, cell: value.cell };
  }
  if (value.kind === 'unit') {
    exactKeys(value, ['kind', 'unitId'], label, 'INVALID_COMMAND');
    if (typeof value.unitId !== 'string' || value.unitId.length === 0) {
      throw new RunnerInputError('INVALID_COMMAND', `${label}.unitId must be a non-empty string`);
    }
    return { kind: 'unit', unitId: value.unitId };
  }
  throw new RunnerInputError('INVALID_COMMAND', `${label}.kind is not a supported battle target`);
}

export function parseAction(value: unknown, index: number): HighLevelAction {
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
  if (value.type === 'PLAY_CARD') {
    exactKeys(value, ['type', 'cardId', 'side', 'target'], label, 'INVALID_COMMAND');
    if (typeof value.cardId !== 'string' || typeof value.side !== 'string') {
      throw new RunnerInputError('INVALID_COMMAND', `${label} PLAY_CARD requires cardId and side`);
    }
    return { type: 'PLAY_CARD', cardId: value.cardId, side: value.side as Side, target: parseTarget(value.target, `${label}.target`) };
  }
  if (value.type === 'MOVE_UNIT') {
    exactKeys(value, value.steps === undefined ? ['type', 'unitId'] : ['type', 'unitId', 'steps'], label, 'INVALID_COMMAND');
    if (typeof value.unitId !== 'string' || (value.steps !== undefined && !isSafeInteger(value.steps))) {
      throw new RunnerInputError('INVALID_COMMAND', `${label} MOVE_UNIT requires unitId and optional integer steps`);
    }
    return value as unknown as HighLevelAction;
  }
  if (value.type === 'APPLY_DOT') {
    exactKeys(value, ['type', 'side', 'targetIds', 'amount'], label, 'INVALID_COMMAND');
    if (typeof value.side !== 'string' || !isUnknownArray(value.targetIds) || value.targetIds.length === 0
      || !value.targetIds.every((targetId) => typeof targetId === 'string' && targetId.length > 0)
      || new Set(value.targetIds).size !== value.targetIds.length || !isSafeInteger(value.amount) || value.amount <= 0) {
      throw new RunnerInputError('INVALID_COMMAND', `${label} APPLY_DOT requires a side, unique targetIds and a positive integer amount`);
    }
    return value as unknown as HighLevelAction;
  }
  exactKeys(value, ['type', 'attackerId'], label, 'INVALID_COMMAND');
  if (typeof value.attackerId !== 'string') throw new RunnerInputError('INVALID_COMMAND', `${label}.attackerId must be a string`);
  return value as unknown as HighLevelAction;
}

export interface NeutralBattleOutput {
  readonly seed: number;
  readonly actionCount: number;
  readonly finalState: RunnerBattleState;
  readonly outcome: OutcomeResult;
  readonly rngCursor: number;
  readonly finalHash: string;
}

function parseActions(value: Record<string, unknown>): HighLevelAction[] {
  const rawActions = value.actions;
  if (!isUnknownArray(rawActions)) throw new RunnerInputError('INVALID_INPUT', 'input.actions must be an array');
  return rawActions.map((action, index) => parseAction(action, index));
}

// The CLI composition root supplies these same operations through its adapter.
// Browser consumers use this fixed binding set via createBattleCore.
export const DEFAULT_BATTLE_BINDINGS = Object.freeze({
  createBoardState, moveUnit, createAttackAction, enqueue, resolveOutcome, chooseSeeded,
  isSafeInteger, isUnknownArray, parseActions, heroMaxHp: 30 as const,
});

export function createBattleRuntime(AUTHORITY: AuthorityConfig, bindings = DEFAULT_BATTLE_BINDINGS) {
  const { createBoardState, moveUnit, createAttackAction, enqueue, resolveOutcome, chooseSeeded,
    isSafeInteger, isUnknownArray, parseActions, heroMaxHp: HERO_MAX_HP } = bindings;
  const NEUTRAL_RUNTIME_STATES = new WeakSet<object>();

  function parseInput(value: unknown): BattleRunnerInput {
    if (!isRecord(value)) throw new RunnerInputError('INVALID_INPUT', 'input must be a JSON object');
    const rootForbidden = Object.keys(value).find((key) => STATE_REHYDRATION_FIELDS.has(key));
    if (rootForbidden) throw new RunnerInputError('STATE_REHYDRATION_FORBIDDEN', `input.${rootForbidden} is forbidden; runner state is seed-derived`);
    const allowedKeys = !Object.hasOwn(value, 'professionId')
      ? ['protocol', 'seed', 'actions']
      : ['protocol', 'seed', 'actions', 'professionId'];
    exactKeys(value, allowedKeys, 'input', 'INVALID_INPUT');
    if (value.protocol !== BATTLE_RUNNER_PROTOCOL) throw new RunnerInputError('INVALID_INPUT', `input.protocol must be ${BATTLE_RUNNER_PROTOCOL}`);
    const seed = value.seed;
    if (!isSafeInteger(seed)) throw new RunnerInputError('INVALID_INPUT', 'input.seed must be a safe integer');
    if (value.professionId !== undefined && (typeof value.professionId !== 'string' || !AUTHORITY.professions.some((profession) => profession.id === value.professionId))) {
      throw new RunnerInputError('INVALID_INPUT', `input.professionId is not an authoritative profession: ${String(value.professionId)}`);
    }
    const actions = parseActions(value);
    return {
      protocol: BATTLE_RUNNER_PROTOCOL,
      seed,
      actions,
      ...(value.professionId === undefined ? {} : { professionId: value.professionId as string }),
    };
  }

  function validateFixtureDeck(deck: readonly string[], side: Side, cards: readonly ParityCardMapping[]): void {
    if (deck.length !== 30) throw new RunnerInputError('INVALID_INPUT', `input.fixture.decks.${side} must contain exactly 30 cards`);
    const mapped = new Map(cards.map((card) => [card.fixtureCardId, card]));
    const counts = new Map<string, number>();
    let unitCount = 0;
    let skillCount = 0;
    for (const ref of deck) {
      if (typeof ref !== 'string') throw new RunnerInputError('INVALID_INPUT', `input.fixture.decks.${side} card references must be strings`);
      const mapping = mapped.get(ref);
      if (!mapping) throw new RunnerInputError('INVALID_INPUT', `input.fixture.decks.${side} references an unmapped card: ${ref}`);
      const card = AUTHORITY.cards.find((candidate) => candidate.id === mapping.cocosCardId);
      if (!card) throw new RunnerInputError('INVALID_INPUT', `input.fixture card is not authoritative: ${mapping.cocosCardId}`);
      const count = (counts.get(card.id) ?? 0) + 1;
      counts.set(card.id, count);
      if (card.copyLimit !== undefined && count > card.copyLimit) throw new RunnerInputError('INVALID_INPUT', `input.fixture.decks.${side} exceeds copy limit for ${card.id}`);
      if (card.cardType === 'UNIT') unitCount += 1;
      else skillCount += 1;
    }
    if (unitCount < 24) throw new RunnerInputError('INVALID_INPUT', `input.fixture.decks.${side} must contain at least 24 unit cards`);
    if (skillCount > 6) throw new RunnerInputError('INVALID_INPUT', `input.fixture.decks.${side} must contain at most 6 skill cards`);
  }

  function parseParityFixture(value: unknown): ParityFixture {
    if (!isRecord(value)) throw new RunnerInputError('INVALID_INPUT', 'input.fixture must be an object');
    exactKeys(value, ['version', 'cards', 'units', 'events', 'decks', 'actions', 'ignoredEventTypes', 'compare'], 'input.fixture', 'INVALID_INPUT', true);
    if (value.version !== 2 || !isUnknownArray(value.cards) || !isUnknownArray(value.units) || !isUnknownArray(value.events)) {
      throw new RunnerInputError('INVALID_INPUT', 'input.fixture version and mapping arrays are invalid');
    }
    const cards: ParityCardMapping[] = value.cards.map((raw, index) => {
      if (!isRecord(raw)) throw new RunnerInputError('INVALID_INPUT', `input.fixture.cards[${index}] must be an object`);
      const allowed = raw.cocosUnitId === undefined
        ? ['fixtureCardId', PEER_CARD_ID_KEY, 'cocosCardId']
        : ['fixtureCardId', PEER_CARD_ID_KEY, 'cocosCardId', 'cocosUnitId'];
      exactKeys(raw, allowed, `input.fixture.cards[${index}]`, 'INVALID_INPUT', true);
      if ([raw.fixtureCardId, raw[PEER_CARD_ID_KEY], raw.cocosCardId].some((field) => typeof field !== 'string')) {
        throw new RunnerInputError('INVALID_INPUT', `input.fixture.cards[${index}] IDs must be strings`);
      }
      if (raw.cocosUnitId !== undefined && typeof raw.cocosUnitId !== 'string') throw new RunnerInputError('INVALID_INPUT', `input.fixture.cards[${index}].cocosUnitId must be a string`);
      const card = AUTHORITY.cards.find((candidate) => candidate.id === raw.cocosCardId);
      if (!card) throw new RunnerInputError('INVALID_INPUT', `input.fixture.cards[${index}] cocos card is not authoritative: ${raw.cocosCardId}`);
      if (card.cardType === 'UNIT' && (!raw.cocosUnitId || raw.cocosUnitId !== card.unitId || !AUTHORITY.units.some((unit) => unit.id === raw.cocosUnitId))) {
        throw new RunnerInputError('INVALID_INPUT', `input.fixture.cards[${index}] unit mapping does not match authority`);
      }
      return {
        fixtureCardId: raw.fixtureCardId,
        referenceCardId: raw[PEER_CARD_ID_KEY] as string,
        cocosCardId: raw.cocosCardId,
        ...(raw.cocosUnitId === undefined ? {} : { cocosUnitId: raw.cocosUnitId }),
      };
    });
    for (const field of ['fixtureCardId', 'referenceCardId', 'cocosCardId'] as const) {
      if (new Set(cards.map((card) => card[field])).size !== cards.length) throw new RunnerInputError('INVALID_INPUT', `input.fixture.cards ${field} values must be unique`);
    }
    const units: ParityUnitMapping[] = value.units.map((raw, index) => {
      if (!isRecord(raw)) throw new RunnerInputError('INVALID_INPUT', `input.fixture.units[${index}] must be an object`);
      exactKeys(raw, ['fixtureUnitId', 'canonicalUnitId'], `input.fixture.units[${index}]`, 'INVALID_INPUT', true);
      if (typeof raw.fixtureUnitId !== 'string' || typeof raw.canonicalUnitId !== 'string') throw new RunnerInputError('INVALID_INPUT', `input.fixture.units[${index}] IDs must be strings`);
      return { fixtureUnitId: raw.fixtureUnitId, canonicalUnitId: raw.canonicalUnitId };
    });
    if (new Set(units.map((unit) => unit.fixtureUnitId)).size !== units.length || new Set(units.map((unit) => unit.canonicalUnitId)).size !== units.length) throw new RunnerInputError('INVALID_INPUT', 'input.fixture.units IDs must be unique');

    const events: ParityEventMapping[] = value.events.map((raw, index) => {
      if (!isRecord(raw)) throw new RunnerInputError('INVALID_INPUT', `input.fixture.events[${index}] must be an object`);
      exactKeys(raw, ['fixtureType', PEER_EVENT_TYPE_KEY, 'cocosType', 'fields'], `input.fixture.events[${index}]`, 'INVALID_INPUT', true);
      if ([raw.fixtureType, raw[PEER_EVENT_TYPE_KEY], raw.cocosType].some((field) => typeof field !== 'string') || !isUnknownArray(raw.fields) || !raw.fields.every((field) => typeof field === 'string')) throw new RunnerInputError('INVALID_INPUT', `input.fixture.events[${index}] is invalid`);
      return { fixtureType: raw.fixtureType, referenceType: raw[PEER_EVENT_TYPE_KEY] as string, cocosType: raw.cocosType, fields: raw.fields as string[] };
    });
    for (const field of ['fixtureType', 'referenceType', 'cocosType'] as const) {
      if (new Set(events.map((eventMapping) => eventMapping[field])).size !== events.length) throw new RunnerInputError('INVALID_INPUT', `input.fixture.events ${field} values must be unique`);
    }
    if (!events.some((eventMapping) => eventMapping.fixtureType === 'BATTLE_END')) throw new RunnerInputError('INVALID_INPUT', 'input.fixture.events must map BATTLE_END');
    if (!isRecord(value.decks) || !isUnknownArray(value.decks.player) || !isUnknownArray(value.decks.enemy)) throw new RunnerInputError('INVALID_INPUT', 'input.fixture.decks must contain player and enemy arrays');
    validateFixtureDeck(value.decks.player as readonly string[], 'player', cards);
    validateFixtureDeck(value.decks.enemy as readonly string[], 'enemy', cards);
    if (!isUnknownArray(value.actions)) throw new RunnerInputError('INVALID_INPUT', 'input.fixture.actions must be an array');
    if (!isUnknownArray(value.ignoredEventTypes) || !value.ignoredEventTypes.every((eventType) => typeof eventType === 'string' && eventType.length > 0)) throw new RunnerInputError('INVALID_INPUT', 'input.fixture.ignoredEventTypes must be a string array');
    const cardRefs = new Set(cards.map((card) => card.fixtureCardId));
    const unitFixtureRefs = new Set(units.map((unit) => unit.fixtureUnitId));
    const actions: ParityAction[] = value.actions.map((raw, index) => {
      if (!isRecord(raw) || typeof raw.type !== 'string') throw new RunnerInputError('INVALID_INPUT', `input.fixture.actions[${index}] must have a type`);
      if (raw.type === 'BATTLE_START' || raw.type === 'END_TURN') {
        exactKeys(raw, ['type'], `input.fixture.actions[${index}]`, 'INVALID_INPUT', true);
        return { type: raw.type } as ParityAction;
      }
      if (raw.type === 'DEPLOY_UNIT') {
        exactKeys(raw, ['type', 'cardRef', 'unitRef', 'side', 'lane', 'cell'], `input.fixture.actions[${index}]`, 'INVALID_INPUT', true);
        if (typeof raw.cardRef !== 'string' || !cardRefs.has(raw.cardRef) || typeof raw.unitRef !== 'string' || !unitFixtureRefs.has(raw.unitRef) || (raw.side !== 'player' && raw.side !== 'enemy') || !isSafeInteger(raw.lane) || !isSafeInteger(raw.cell)) throw new RunnerInputError('INVALID_COMMAND', `input.fixture.actions[${index}] DEPLOY_UNIT is invalid`);
        const mapping = cards.find((card) => card.fixtureCardId === raw.cardRef)!;
        const authorityCard = AUTHORITY.cards.find((card) => card.id === mapping.cocosCardId);
        if (!authorityCard || authorityCard.cardType !== 'UNIT') throw new RunnerInputError('INVALID_COMMAND', `input.fixture.actions[${index}] requires an authoritative unit card`);
        return { type: raw.type, cardRef: raw.cardRef, unitRef: raw.unitRef, side: raw.side, lane: raw.lane, cell: raw.cell };
      }
      if (raw.type === 'MOVE_UNIT' || raw.type === 'ATTACK') {
        const allowed = raw.type === 'MOVE_UNIT' && raw.steps !== undefined ? ['type', 'unitRef', 'steps'] : ['type', 'unitRef'];
        exactKeys(raw, allowed, `input.fixture.actions[${index}]`, 'INVALID_INPUT', true);
        if (typeof raw.unitRef !== 'string' || !unitFixtureRefs.has(raw.unitRef)) throw new RunnerInputError('INVALID_COMMAND', `input.fixture.actions[${index}] unitRef is invalid`);
        if (raw.type === 'MOVE_UNIT' && raw.steps !== undefined && (!isSafeInteger(raw.steps) || raw.steps < 0)) throw new RunnerInputError('INVALID_COMMAND', `input.fixture.actions[${index}] steps is invalid`);
        return raw.type === 'MOVE_UNIT' && raw.steps !== undefined ? { type: raw.type, unitRef: raw.unitRef, steps: raw.steps } : { type: raw.type, unitRef: raw.unitRef };
      }
      throw new RunnerInputError('INVALID_COMMAND', `input.fixture.actions[${index}] type is unsupported`);
    });
    const compare = value.compare;
    if (!isRecord(compare) || !isUnknownArray(compare.stateFields) || !isUnknownArray(compare.eventFields) || !isUnknownArray(compare.omittedFields) || !compare.stateFields.every((field) => typeof field === 'string') || !compare.eventFields.every((field) => typeof field === 'string') || !compare.omittedFields.every((field) => typeof field === 'string')) throw new RunnerInputError('INVALID_INPUT', 'input.fixture.compare is invalid');
    return {
      version: 2,
      cards,
      units,
      events,
      decks: { player: value.decks.player as readonly string[], enemy: value.decks.enemy as readonly string[] },
      actions,
      ignoredEventTypes: value.ignoredEventTypes as string[],
      compare: { stateFields: compare.stateFields as string[], eventFields: compare.eventFields as string[], omittedFields: compare.omittedFields as string[] },
    };
  }

  function parseParityInput(value: unknown): { protocol: typeof BATTLE_RUNNER_V2_PROTOCOL; seed: number; fixture: ParityFixture } {
    if (!isRecord(value)) throw new RunnerInputError('INVALID_INPUT', 'input must be a JSON object');
    const rootForbidden = Object.keys(value).find((key) => STATE_REHYDRATION_FIELDS.has(key));
    if (rootForbidden) throw new RunnerInputError('STATE_REHYDRATION_FORBIDDEN', `input.${rootForbidden} is forbidden; runner state is seed-derived`);
    exactKeys(value, ['protocol', 'seed', 'fixture'], 'input', 'INVALID_INPUT');
    if (value.protocol !== BATTLE_RUNNER_V2_PROTOCOL) throw new RunnerInputError('INVALID_INPUT', `input.protocol must be ${BATTLE_RUNNER_V2_PROTOCOL}`);
    if (!isSafeInteger(value.seed)) throw new RunnerInputError('INVALID_INPUT', 'input.seed must be a safe integer');
    return { protocol: BATTLE_RUNNER_V2_PROTOCOL, seed: value.seed, fixture: parseParityFixture(value.fixture) };
  }

  function unitConfig(cardId: string): { readonly card: CardConfig; readonly unit: UnitConfig } {
    const card = AUTHORITY.cards.find((candidate) => candidate.id === cardId);
    if (!card || card.cardType !== 'UNIT' || !card.unitId) throw new RunnerInputError('INVALID_COMMAND', `cardId is not an enabled unit card: ${cardId}`);
    const unit = AUTHORITY.units.find((candidate) => candidate.id === card.unitId);
    if (!unit) throw new RunnerInputError('INVALID_COMMAND', `unit config is missing for cardId: ${cardId}`);
    return { card, unit };
  }

  interface SkillTargetProfile {
    readonly kind: 'lane' | 'unit' | 'global';
    readonly side?: 'enemy' | 'ally';
  }

  function skillConfig(cardId: string): { readonly card: CardConfig; readonly skill: SkillConfig; readonly target: SkillTargetProfile } {
    const card = AUTHORITY.cards.find((candidate) => candidate.id === cardId);
    if (!card || card.cardType !== 'SKILL' || !card.skillId) {
      throw new RunnerInputError('INVALID_COMMAND', `cardId is not an enabled skill card: ${cardId}`);
    }
    const skill = AUTHORITY.skills.find((candidate) => candidate.id === card.skillId);
    if (!skill) throw new RunnerInputError('INVALID_COMMAND', `skill config is missing for cardId: ${cardId}`);
    // The action carries no sourceUnitId. The input adapter is therefore the
    // only range boundary for skill targets; it applies sourceUnitId/range when
    // the UI definition provides them. Do not infer a source from board state.
    if (skill.targetType === 'ENEMY_UNIT') return { card, skill, target: { kind: 'unit', side: 'enemy' } };
    if (skill.targetType === 'ALLY_UNIT') return { card, skill, target: { kind: 'unit', side: 'ally' } };
    if (skill.targetType === 'ENEMY_LANE') return { card, skill, target: { kind: 'lane', side: 'enemy' } };
    if (skill.targetType === 'ALLY_LANE') return { card, skill, target: { kind: 'lane', side: 'ally' } };
    if (skill.targetType === 'PREPARE_BAR') return { card, skill, target: { kind: 'global' } };
    throw new RunnerInputError('INVALID_COMMAND', `skill target type is not supported by PLAY_CARD: ${skill.targetType}`);
  }

  const PROFESSION_BY_ID: Readonly<Record<string, Profession>> = Object.freeze({
    P001: 'COMMANDER',
    P002: 'ARCANIST',
    P003: 'COVENANT',
    P004: 'TACTICIAN',
  });

  function professionConfig(professionId: string): { readonly config: ProfessionConfig; readonly profession: Profession } {
    const profession = PROFESSION_BY_ID[professionId];
    const config = AUTHORITY.professions.find((candidate) => candidate.id === professionId);
    if (!profession || !config) throw new RunnerInputError('INVALID_INPUT', `professionId is not authoritative: ${professionId}`);
    return { config, profession };
  }

  function professionDeck(professionId: string): readonly string[] {
    const { config } = professionConfig(professionId);
    const skillIds = config.skillIds.map((skillId) => {
      const card = AUTHORITY.cards.find((candidate) => candidate.id === skillId);
      const skill = AUTHORITY.skills.find((candidate) => candidate.id === skillId);
      if (!card || card.cardType !== 'SKILL' || card.skillId !== skillId || !skill) {
        throw new Error(`profession ${professionId} references a non-authoritative skill: ${skillId}`);
      }
      return card.id;
    });
    const requiredUnits = 30 - skillIds.length;
    const unitIds: string[] = [];
    for (const card of AUTHORITY.cards) {
      if (card.cardType !== 'UNIT' || card.profession !== undefined && card.profession !== 'NONE') continue;
      const copyLimit = card.copyLimit ?? 1;
      const copies = Math.min(copyLimit, requiredUnits - unitIds.length);
      for (let index = 0; index < copies; index += 1) unitIds.push(card.id);
      if (unitIds.length === requiredUnits) break;
    }
    if (unitIds.length !== requiredUnits) throw new Error(`profession ${professionId} cannot build an authoritative 30-card deck`);
    return [...unitIds, ...skillIds];
  }

  function createRuntimeProfessionState(professionId: string): ProfessionRuntimeState {
    const { profession } = professionConfig(professionId);
    const state = createProfessionState(profession);
    return {
      ...state,
      professionId,
      barrierByUnit: {},
      spellResistanceIgnore: 0,
      dotDamageReduction: 0,
      dotDamageReduced: 0,
      preparationReduction: 0,
      preparationReductionByCard: {},
    };
  }

  function coreProfessionState(state: ProfessionRuntimeState): ProfessionState {
    return {
      profession: state.profession,
      logs: state.logs,
      laneTriggers: state.laneTriggers,
      roundTriggers: state.roundTriggers,
      actionTriggers: state.actionTriggers,
    };
  }

  function mergeTraitState(state: ProfessionRuntimeState, result: ReturnType<typeof triggerDeploy>): ProfessionRuntimeState {
    return {
      ...state,
      logs: result.state.logs,
      laneTriggers: result.state.laneTriggers,
      roundTriggers: result.state.roundTriggers,
      actionTriggers: result.state.actionTriggers,
    };
  }

  function effectValue(effectIds: readonly string[], operation: 'APPLY_BARRIER' | 'IGNORE_SPELL_RESIST' | 'REDUCE_DOT_DAMAGE' | 'REDUCE_PREPARATION'): number {
    const effect = effectIds.map((effectId) => professionEffectFor(effectId)).find((candidate) => candidate.operation === operation);
    if (!effect) throw new Error(`profession effect operation is missing: ${operation}`);
    return effect.value;
  }

  function initialState(
    seed: number,
    decks: Readonly<Record<Side, readonly string[]>> = { player: AUTHORITY.deck, enemy: AUTHORITY.deck },
    parity = false,
    professionId?: string,
  ): RunnerBattleState {
    const runtimeDecks = professionId
      ? { player: professionDeck(professionId), enemy: decks.enemy }
      : decks;
    const cards: CardState = createCardState({ seed, decks: runtimeDecks, prepareByCardId: AUTHORITY.prepareByCardId });
    const initiative = parity
      ? { value: seed % 2 === 0 ? 'player' as const : 'enemy' as const, state: cards.rng }
      : chooseSeeded(cards.rng, SIDES);
    const rng: RngState = initiative.state;
    const runtimeProfession = professionId ? createRuntimeProfessionState(professionId) : undefined;
    return createBattleState({
      revision: 0,
      seed,
      rngState: rng.rngState,
      rngCursor: rng.rngCursor,
      round: parity ? 1 : 0,
      turn: parity ? 1 : 0,
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
      nextId: parity ? cards.nextId : 1,
      nextEventId: 1,
      ...(runtimeProfession ? { professionState: runtimeProfession } : {}),
    } as unknown as Parameters<typeof createBattleState>[0]) as RunnerBattleState;
  }

  function update(state: RunnerBattleState, patch: Partial<RunnerBattleState>): RunnerBattleState {
    if (NEUTRAL_RUNTIME_STATES.has(state)) {
      if (Object.keys(patch).length === 0) return state;
      const next = { ...state, ...patch, revision: state.revision + 1 };
      freezeNeutralValue(next);
      NEUTRAL_RUNTIME_STATES.add(next);
      return next;
    }
    return updateBattleState(state, patch as Partial<BattleState>) as RunnerBattleState;
  }

  function emit(state: RunnerBattleState, type: string, side: Side, payload: Readonly<Record<string, unknown>> = {}): RunnerBattleState {
    const queue: EventQueue = { nextEventId: state.nextEventId, events: state.events };
    const next = enqueue(queue, { ...event(type, side, payload), round: state.round, turn: state.turn, activeSide: state.activeSide, rngCursor: state.rngCursor });
    return update(state, { events: next.events, nextEventId: next.nextEventId });
  }

  function ensureStarted(state: RunnerBattleState): void {
    if (state.round === 0) throw new RunnerInputError('INVALID_COMMAND', 'battle must start before this action');
    if (state.status !== 'playing') throw new RunnerInputError('INVALID_COMMAND', 'battle has already settled');
  }

  function applyBattleStartProfession(state: RunnerBattleState): RunnerBattleState {
    const professionState = state.professionState;
    if (!professionState) return state;
    const result = triggerBattleStart(coreProfessionState(professionState), state.hands.player, state.round);
    if (!result.triggered) return state;
    const targetId = result.objectIds[0];
    const target = state.hands.player.find((card) => card.instanceId === targetId);
    const targetConfig = target && AUTHORITY.cards.find((card) => card.id === target.cardId);
    if (!target || !targetConfig || targetConfig.cardType !== 'UNIT') {
      throw new RunnerInputError('INVALID_COMMAND', 'TACTICIAN selected a non-authoritative unit card');
    }
    const reduction = effectValue(result.effectIds, 'REDUCE_PREPARATION');
    const after = Math.max(0, target.remainingPreparation - reduction);
    const hands = {
      ...state.hands,
      player: state.hands.player.map((card) => card.instanceId === target.instanceId
        ? { ...card, remainingPreparation: after }
        : card),
    };
    const nextProfessionState = mergeTraitState(professionState, result);
    const next = update(state, {
      hands,
      professionState: {
        ...nextProfessionState,
        preparationReduction: nextProfessionState.preparationReduction + (target.remainingPreparation - after),
        preparationReductionByCard: {
          ...nextProfessionState.preparationReductionByCard,
          [target.instanceId]: (nextProfessionState.preparationReductionByCard[target.instanceId] ?? 0) + (target.remainingPreparation - after),
        },
      },
    });
    return emit(next, 'PROFESSION_TRAIT_APPLIED', 'player', {
      professionId: professionState.professionId,
      traitId: result.state.logs[result.state.logs.length - 1].traitId,
      operation: 'REDUCE_PREPARATION',
      targetId: target.instanceId,
      before: target.remainingPreparation,
      after,
    });
  }

  function startBattle(state: RunnerBattleState): RunnerBattleState {
    if (state.round !== 0) throw new RunnerInputError('INVALID_COMMAND', 'BATTLE_START may only be issued once');
    let next = update(state, { round: 1, turn: 1, activeSide: state.openingInitiative });
    // T040 closes the real input loop at this lifecycle boundary: cards drawn
    // with a preparation value of one become ready on their first active turn.
    // The previous v1 path omitted this existing card-lifecycle transition, so
    // a real PLAY_CARD could never pass its ready check. This is deterministic
    // preparation bookkeeping, not skill-effect resolution.
    next = decrementPreparation(next, next.activeSide);
    next = emit(next, 'BATTLE_START', next.activeSide, { seed: next.seed });
    next = emit(next, 'ROUND_START', next.activeSide, { round: next.round });
    next = emit(next, 'TURN_START', next.activeSide, { turn: next.turn });
    return applyBattleStartProfession(next);
  }

  function applyDeployProfession(state: RunnerBattleState, unitId: string, side: Side, lane: number, actionNumber: number): RunnerBattleState {
    const professionState = state.professionState;
    if (!professionState) return state;
    const unit = state.units.find((candidate) => candidate.id === unitId);
    if (!unit) throw new RunnerInputError('INVALID_COMMAND', `deployed unit does not exist: ${unitId}`);
    const result = triggerDeploy(coreProfessionState(professionState), {
      unit,
      side,
      lane,
      round: state.round,
      action: actionNumber,
    });
    if (!result.triggered) return state;
    const barrier = effectValue(result.effectIds, 'APPLY_BARRIER');
    const nextProfessionState = mergeTraitState(professionState, result);
    const updatedUnit: Unit = {
      ...unit,
      statuses: [
        ...unit.statuses,
        {
          id: `profession-barrier-${unit.id}`,
          kind: 'BARRIER',
          sourceId: 'profession:COMMANDER',
          stacks: 1,
          value: barrier,
        },
      ],
    };
    const next = update(state, {
      units: state.units.map((candidate) => candidate.id === unit.id ? updatedUnit : candidate),
      professionState: {
        ...nextProfessionState,
        barrierByUnit: {
          ...nextProfessionState.barrierByUnit,
          [unit.id]: (nextProfessionState.barrierByUnit[unit.id] ?? 0) + barrier,
        },
      },
    });
    return emit(next, 'PROFESSION_TRAIT_APPLIED', side, {
      professionId: professionState.professionId,
      traitId: result.state.logs[result.state.logs.length - 1].traitId,
      operation: 'APPLY_BARRIER',
      targetId: unit.id,
      value: barrier,
    });
  }

  function applySpellProfession(state: RunnerBattleState, cardInstanceId: string, side: Side, actionNumber: number): RunnerBattleState {
    const professionState = state.professionState;
    if (!professionState) return state;
    const result = triggerSpell(coreProfessionState(professionState), {
      casterId: cardInstanceId,
      side,
      isSpell: true,
      round: state.round,
      action: actionNumber,
    });
    if (!result.triggered) return state;
    const bypass = effectValue(result.effectIds, 'IGNORE_SPELL_RESIST');
    const nextProfessionState = mergeTraitState(professionState, result);
    const next = update(state, {
      professionState: {
        ...nextProfessionState,
        spellResistanceIgnore: nextProfessionState.spellResistanceIgnore + bypass,
      },
    });
    return emit(next, 'PROFESSION_TRAIT_APPLIED', side, {
      professionId: professionState.professionId,
      traitId: result.state.logs[result.state.logs.length - 1].traitId,
      operation: 'IGNORE_SPELL_RESIST',
      targetId: cardInstanceId,
      value: bypass,
    });
  }

  function deploy(
    state: RunnerBattleState,
    action: Extract<HighLevelAction, { type: 'DEPLOY_UNIT' }>,
    canonicalUnitId?: string,
    parity = false,
    actionNumber = 1,
  ): RunnerBattleState {
    ensureStarted(state);
    if (action.side !== 'player' && action.side !== 'enemy') throw new RunnerInputError('INVALID_COMMAND', `DEPLOY_UNIT side is invalid: ${action.side}`);
    if (action.side !== state.activeSide) throw new RunnerInputError('INVALID_COMMAND', `DEPLOY_UNIT side must be active side: ${state.activeSide}`);
    if (!isSummonCell(action.side, action.lane, action.cell)) throw new RunnerInputError('INVALID_COMMAND', 'DEPLOY_UNIT lane/cell is outside the side summon cells');
    const config = unitConfig(action.cardId);
    const handIndex = state.hands[action.side].findIndex((card) => (
      card.cardId === action.cardId && (!parity || card.remainingPreparation === 0)
    ));
    if (handIndex < 0) throw new RunnerInputError('INVALID_COMMAND', `cardId is not in ${action.side} hand: ${action.cardId}`);
    const unitId = canonicalUnitId ?? `unit-${action.side}-${state.nextId}`;
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
      graveyards: parity
        ? { ...state.graveyards, [action.side]: [...state.graveyards[action.side], action.cardId] }
        : state.graveyards,
      nextId: state.nextId + 1,
    });
    next = emit(next, 'CARD_PLAYED', action.side, { cardId: action.cardId });
    next = emit(next, 'UNIT_SPAWNED', action.side, { unitId, cardId: action.cardId, lane: action.lane, cell: action.cell });
    return applyDeployProfession(next, unitId, action.side, action.lane, actionNumber);
  }

  /**
   * Accepts the input-layer skill target contract without pretending to resolve
   * the skill. Skill effects are not part of this runner yet; this event is the
   * executable boundary for a validated target submission and leaves the card
   * in hand until a later effect resolver consumes it.
   */
  function submitCardTarget(state: RunnerBattleState, action: Extract<HighLevelAction, { type: 'PLAY_CARD' }>, actionNumber = 1): RunnerBattleState {
    ensureStarted(state);
    if (action.side !== 'player' && action.side !== 'enemy') {
      throw new RunnerInputError('INVALID_COMMAND', `PLAY_CARD side is invalid: ${action.side}`);
    }
    if (action.side !== state.activeSide) {
      throw new RunnerInputError('INVALID_COMMAND', `PLAY_CARD side must be active side: ${state.activeSide}`);
    }
    const { target: profile } = skillConfig(action.cardId);
    if (state.professionState && action.side === 'player') {
      const profession = professionConfig(state.professionState.professionId).config;
      const card = AUTHORITY.cards.find((candidate) => candidate.id === action.cardId);
      if (!card || !card.skillId || !profession.skillIds.includes(card.skillId)) {
        throw new RunnerInputError('INVALID_COMMAND', `cardId is not in the real profession skill pool: ${action.cardId}`);
      }
    }
    const handIndex = state.hands[action.side].findIndex((candidate) => candidate.cardId === action.cardId);
    if (handIndex < 0) throw new RunnerInputError('INVALID_COMMAND', `cardId is not in ${action.side} hand: ${action.cardId}`);
    if (state.hands[action.side][handIndex].remainingPreparation !== 0) {
      throw new RunnerInputError('INVALID_COMMAND', `cardId is not ready: ${action.cardId}`);
    }
    const target = action.target;
    if (target.kind !== profile.kind) {
      throw new RunnerInputError('INVALID_COMMAND', `PLAY_CARD target kind must be ${profile.kind}`);
    }
    if (target.kind === 'lane') {
      if (target.lane < 0 || target.lane >= state.laneCount) {
        throw new RunnerInputError('INVALID_COMMAND', 'PLAY_CARD target lane is outside the board');
      }
      const expectedSide = profile.side === 'enemy' ? OTHER_SIDE[action.side] : action.side;
      const hasLivingTarget = state.units.some((unit) => unit.hp > 0 && unit.side === expectedSide && unit.lane === target.lane);
      if (!hasLivingTarget) {
        throw new RunnerInputError(
          'INVALID_COMMAND',
          `PLAY_CARD target lane has no living ${profile.side === 'enemy' ? 'enemy' : 'ally'} unit`,
        );
      }
    } else if (target.kind === 'unit') {
      const unit = state.units.find((candidate) => candidate.id === target.unitId && candidate.hp > 0);
      if (!unit) throw new RunnerInputError('INVALID_COMMAND', `PLAY_CARD target unit does not exist: ${target.unitId}`);
      const expectedSide = profile.side === 'enemy' ? OTHER_SIDE[action.side] : action.side;
      if (unit.side !== expectedSide) throw new RunnerInputError('INVALID_COMMAND', 'PLAY_CARD target unit has the wrong side');
    } else if (!state.hands[action.side].some((candidate, index) => index !== handIndex && candidate.remainingPreparation > 0)) {
      throw new RunnerInputError('INVALID_COMMAND', 'PLAY_CARD global target has no prepared card');
    }
    let next = emit(state, 'CARD_TARGET_SUBMITTED', action.side, {
      cardId: action.cardId,
      target,
    });
    const card = next.hands[action.side][handIndex];
    return applySpellProfession(next, card.instanceId, action.side, actionNumber);
  }

  function applyDot(state: RunnerBattleState, action: Extract<HighLevelAction, { type: 'APPLY_DOT' }>, actionNumber = 1): RunnerBattleState {
    ensureStarted(state);
    if (action.side !== 'player' && action.side !== 'enemy') {
      throw new RunnerInputError('INVALID_COMMAND', `APPLY_DOT side is invalid: ${action.side}`);
    }
    if (action.side !== state.activeSide) {
      throw new RunnerInputError('INVALID_COMMAND', `APPLY_DOT side must be active side: ${state.activeSide}`);
    }
    if (action.targetIds.length === 0 || new Set(action.targetIds).size !== action.targetIds.length || !Number.isSafeInteger(action.amount) || action.amount <= 0) {
      throw new RunnerInputError('INVALID_COMMAND', 'APPLY_DOT requires unique targets and a positive amount');
    }
    const targetSide = OTHER_SIDE[action.side];
    const targets = action.targetIds.map((targetId) => state.units.find((unit) => unit.id === targetId));
    if (targets.some((unit) => !unit || unit.hp <= 0 || unit.side !== targetSide)) {
      throw new RunnerInputError('INVALID_COMMAND', 'APPLY_DOT target must be a living unit on the opposite side');
    }
    const professionState = state.professionState;
    let reduction = 0;
    let nextProfessionState = professionState;
    if (professionState) {
      const result = triggerDamageOverTime(coreProfessionState(professionState), {
        targetIds: action.targetIds,
        targetSide,
        isDamageOverTime: true,
        round: state.round,
        action: actionNumber,
      });
      if (result.triggered) {
        reduction = effectValue(result.effectIds, 'REDUCE_DOT_DAMAGE');
        const merged = mergeTraitState(professionState, result);
        nextProfessionState = {
          ...merged,
          dotDamageReduction: merged.dotDamageReduction + reduction,
          dotDamageReduced: merged.dotDamageReduced + Math.min(reduction, action.amount),
        };
      }
    }
    const actualDamage = Math.max(0, action.amount - reduction);
    let board = createBoardState(state.units);
    let totalDamage = 0;
    for (const targetId of action.targetIds) {
      if (actualDamage === 0) continue;
      const damaged = damageUnit(board, targetId, actualDamage, false);
      board = damaged.state;
      totalDamage += damaged.damage;
    }
    board = removeDead(board);
    let next = update(state, {
      units: board.units,
      ...(nextProfessionState ? { professionState: nextProfessionState } : {}),
    });
    next = emit(next, 'DAMAGE_OVER_TIME', targetSide, {
      targetIds: action.targetIds,
      amount: action.amount,
      value: totalDamage,
      reduction,
    });
    if (professionState && nextProfessionState && nextProfessionState.logs.length > professionState.logs.length) {
      next = emit(next, 'PROFESSION_TRAIT_APPLIED', 'player', {
        professionId: professionState.professionId,
        traitId: nextProfessionState.logs[nextProfessionState.logs.length - 1].traitId,
        operation: 'REDUCE_DOT_DAMAGE',
        targetIds: action.targetIds,
        amount: action.amount,
        value: reduction,
      });
    }
    return next;
  }

  function move(state: RunnerBattleState, action: Extract<HighLevelAction, { type: 'MOVE_UNIT' }>, parity = false): RunnerBattleState {
    ensureStarted(state);
    const current = state.units.find((unit) => unit.id === action.unitId);
    if (!current) throw new RunnerInputError('INVALID_COMMAND', `unitId does not exist: ${action.unitId}`);
    if (current.side !== state.activeSide) throw new RunnerInputError('INVALID_COMMAND', `unitId is not controlled by active side: ${action.unitId}`);
    const result = moveUnit(createBoardState(state.units), action.unitId, action.steps);
    const units = parity && result.moved
      ? result.state.units.map((unit) => unit.id === action.unitId ? { ...unit, actionsTaken: Math.max(0, unit.actionsTaken - 1) } : unit)
      : result.state.units;
    let next = update(state, { units });
    if (parity && !result.moved) {
      return emit(next, 'UNIT_MOVED', state.activeSide, {
        unitId: action.unitId,
        requestedSteps: action.steps,
        steps: result.steps,
        moved: result.moved,
        blocked: result.blocked,
      });
    }
    return emit(next, 'UNIT_MOVED', state.activeSide, {
      unitId: action.unitId,
      requestedSteps: action.steps,
      steps: result.steps,
      moved: result.moved,
      blocked: result.blocked,
    });
  }

  function attack(state: RunnerBattleState, action: Extract<HighLevelAction, { type: 'ATTACK' }>, parity = false): RunnerBattleState {
    ensureStarted(state);
    const attacker = state.units.find((unit) => unit.id === action.attackerId && unit.hp > 0);
    if (!attacker) throw new RunnerInputError('INVALID_COMMAND', `attackerId does not exist or is dead: ${action.attackerId}`);
    if (attacker.side !== state.activeSide) throw new RunnerInputError('INVALID_COMMAND', `attackerId is not controlled by active side: ${action.attackerId}`);
    const actionResult = createAttackAction(createBoardState(state.units), action.attackerId);
    if (!actionResult) throw new RunnerInputError('INVALID_COMMAND', `attackerId has no legal target: ${action.attackerId}`);
    if (parity && actionResult.target.kind === 'unit') {
      const target = actionResult.target;
      const damaged = damageUnit(createBoardState(state.units), target.unit.id, actionResult.damage, true);
      const units = damaged.state.units.map((unit) => unit.id === attacker.id ? { ...unit, actionsTaken: unit.actionsTaken + 1 } : unit);
      let next = update(state, { units });
      next = emit(next, 'DAMAGE', target.unit.side, { side: target.unit.side, targetKind: 'unit', targetId: target.unit.id, value: damaged.damage, sourceId: attacker.id });
      next = emit(next, 'ATTACK', attacker.side, {
        attackerId: action.attackerId,
        targetKind: actionResult.target.kind,
        targetId: target.unit.id,
        distance: actionResult.target.distance,
        damage: actionResult.damage,
      });
      next = update(next, { units: removeDead(createBoardState(next.units)).units });
      if (damaged.killed) next = emit(next, 'UNIT_DIED', target.unit.side, { unitId: target.unit.id, cardId: target.unit.cardId });
      return next;
    }
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
    if (damaged.killed) next = emit(next, 'UNIT_DIED', target.unit.side, { unitId: target.unit.id, cardId: target.unit.cardId });
    if (parity || !damaged.killed) return next;
    next = update(next, { graveyards: { ...next.graveyards, [target.unit.side]: [...next.graveyards[target.unit.side], target.unit.cardId] } });
    return next;
  }

  function prepareParityCards(state: RunnerBattleState, side: Side): RunnerBattleState {
    const hand = state.hands[side].map((card) => card.remainingPreparation === 0
      ? { ...card, remainingPreparation: Math.floor((AUTHORITY.prepareByCardId[card.cardId] ?? 0) / 2) }
      : card);
    const [cardId, ...deck] = state.decks[side];
    if (!cardId) return update(state, { hands: { ...state.hands, [side]: hand } });
    const card = AUTHORITY.cards.find((candidate) => candidate.id === cardId);
    if (!card) throw new RunnerInputError('INVALID_INPUT', `input.fixture deck contains unknown card: ${cardId}`);
    return update(state, {
      hands: {
        ...state.hands,
        [side]: [...hand, { instanceId: `card-${state.nextId}`, cardId, remainingPreparation: card.prepare }],
      },
      decks: { ...state.decks, [side]: deck },
      nextId: state.nextId + 1,
    });
  }

  function decrementPreparation(state: RunnerBattleState, side: Side): RunnerBattleState {
    return update(state, {
      hands: {
        ...state.hands,
        [side]: state.hands[side].map((card) => ({
          ...card,
          remainingPreparation: Math.max(0, card.remainingPreparation - 1),
        })),
      },
    });
  }

  function parityMoveCore(state: RunnerBattleState, unitId: string, requestedSteps?: number): RunnerBattleState {
    const result = moveUnit(createBoardState(state.units), unitId, requestedSteps);
    let next = update(state, { units: result.state.units });
    if (!result.moved) return next;
    next = emit(next, 'UNIT_MOVED', state.activeSide, {
      unitId,
      requestedSteps,
      steps: result.steps,
      moved: result.moved,
      blocked: result.blocked,
    });
    return next;
  }

  function parityActUnit(state: RunnerBattleState, unitId: string): RunnerBattleState {
    const before = state.units.find((unit) => unit.id === unitId);
    if (!before || before.hp <= 0 || state.status !== 'playing') return state;
    let next = state;
    const initialAttack = createAttackAction(createBoardState(next.units), unitId);
    if (initialAttack) {
      next = attack(next, { type: 'ATTACK', attackerId: unitId }, true);
    } else {
      next = parityMoveCore(next, unitId);
      if (next.status === 'playing' && createAttackAction(createBoardState(next.units), unitId)) {
        next = attack(next, { type: 'ATTACK', attackerId: unitId }, true);
      }
    }
    const updated = next.units.map((unit) => unit.id === unitId ? { ...unit, actionsTaken: before.actionsTaken + 1 } : unit);
    return update(next, { units: updated });
  }

  function settleParity(state: RunnerBattleState): RunnerBattleState {
    if (state.status !== 'playing') return state;
    const outcome = resolveOutcome({ heroHp: state.heroHp, round: state.round, maxRounds: state.maxRounds, rng: { rngState: state.rngState, rngCursor: state.rngCursor } });
    if (!outcome.settled) return state;
    let next = update(state, { status: outcome.status, rngState: outcome.rng.rngState, rngCursor: outcome.rng.rngCursor });
    return emit(next, 'BATTLE_END', outcome.winner ?? state.activeSide, {
      status: outcome.status,
      winner: outcome.winner,
      reason: outcome.reason,
    });
  }

  function neutralReadyUnit(state: RunnerBattleState): CardConfig | undefined {
    const cardIds = state.hands[state.activeSide]
      .filter((card) => card.remainingPreparation === 0)
      .map((card) => card.cardId)
      .sort();
    return cardIds
      .map((cardId) => AUTHORITY.cards.find((card) => card.id === cardId))
      .find((card) => card?.cardType === 'UNIT');
  }

  function neutralDeploymentCell(state: RunnerBattleState): { readonly lane: number; readonly cell: number } | undefined {
    return getLegalDeploymentCells(createBoardState(state.units), state.activeSide)[0];
  }

  function neutralOutcome(state: RunnerBattleState): OutcomeResult {
    const endEvent = [...state.events].reverse().find((eventItem) => eventItem.type === 'BATTLE_END');
    if (!endEvent || state.status === 'playing') throw new Error('neutral battle did not settle');
    const winner = endEvent.payload.winner;
    const reason = endEvent.payload.reason;
    if ((winner !== 'player' && winner !== 'enemy') || typeof reason !== 'string') {
      throw new Error('neutral battle has an invalid settlement event');
    }
    return {
      status: state.status,
      winner,
      reason: reason as OutcomeResult['reason'],
      round: endEvent.round,
      rng: { rngState: state.rngState, rngCursor: state.rngCursor },
      objectiveIds: [],
      settled: true,
    };
  }

  /**
   * Runs the same seed-derived parity turn loop as the Cocos battle runner.
   * The policy is intentionally identical for both sides; only the authoritative
   * runner state decides whether a deployment, movement, attack, or settlement occurs.
   */
  function runNeutralBattle(seed: number): NeutralBattleOutput {
    if (!Number.isSafeInteger(seed)) throw new Error('neutral battle seed must be a safe integer');
    let state = initialState(seed, undefined, true);
    NEUTRAL_RUNTIME_STATES.add(state);
    state = decrementPreparation(state, state.activeSide);
    state = emit(state, 'BATTLE_START', state.activeSide, { seed: state.seed });
    state = emit(state, 'TURN_START', state.activeSide, { turn: state.turn });
    const actions: HighLevelAction[] = [{ type: 'BATTLE_START' }];

    for (let turn = 0; turn < MAX_ROUNDS * 2 + 4 && state.status === 'playing'; turn += 1) {
      const card = neutralReadyUnit(state);
      const cell = card ? neutralDeploymentCell(state) : undefined;
      if (card && cell) {
        const deployment: HighLevelAction = {
          type: 'DEPLOY_UNIT',
          cardId: card.id,
          side: state.activeSide,
          lane: cell.lane,
          cell: cell.cell,
        };
        actions.push(deployment);
        state = applyAction(state, deployment, undefined, true);
        if (state.status === 'playing') state = settleParity(state);
      }
      if (state.status !== 'playing') break;
      const endTurn: HighLevelAction = { type: 'END_TURN' };
      actions.push(endTurn);
      state = applyAction(state, endTurn, undefined, true);
    }

    const outcome = neutralOutcome(state);
    const finalHash = hash(stable({ seed, actions, finalState: state, events: state.events, outcome }));
    return {
      seed,
      actionCount: actions.length,
      finalState: state,
      outcome,
      rngCursor: state.rngCursor,
      finalHash,
    };
  }

  function projectParityLifecycleEvents(state: RunnerBattleState, fixture: ParityFixture): BattleEvent[] {
    const mappingByCocosType = new Map(fixture.events.map((eventMapping) => [eventMapping.cocosType, eventMapping]));
    return state.events.flatMap((eventItem) => {
      const mapping = mappingByCocosType.get(eventItem.type);
      if (!mapping || mapping.fixtureType !== 'BATTLE_END') return [];
      return [{ ...eventItem, type: mapping.fixtureType }];
    });
  }

  function endTurnParity(state: RunnerBattleState): RunnerBattleState {
    ensureStarted(state);
    const side = state.activeSide;
    let next = prepareParityCards(state, side);
    next = emit(next, 'TURN_END', side, { turn: next.turn });
    for (const unitId of actionOrder(createBoardState(next.units), side)) {
      next = parityActUnit(next, unitId);
      if (next.heroHp.player <= 0 || next.heroHp.enemy <= 0) return settleParity(next);
      if (next.status !== 'playing') return settleParity(next);
    }
    const nextSide: Side = side === 'player' ? 'enemy' : 'player';
    const roundCompleted = nextSide === next.openingInitiative;
    if (roundCompleted && next.round >= next.maxRounds) return settleParity(next);
    const nextRound = roundCompleted ? next.round + 1 : next.round;
    next = update(next, { activeSide: nextSide, round: nextRound, turn: next.turn + 1 });
    next = decrementPreparation(next, nextSide);
    return emit(next, 'TURN_START', nextSide, { turn: next.turn });
  }

  function endTurn(state: RunnerBattleState): RunnerBattleState {
    ensureStarted(state);
    let next = emit(state, 'TURN_END', state.activeSide, { turn: state.turn });
    const nextSide: Side = state.activeSide === 'player' ? 'enemy' : 'player';
    const nextRound = state.activeSide === 'enemy' ? state.round + 1 : state.round;
    next = update(next, { activeSide: nextSide, round: nextRound, turn: state.turn + 1 });
    // Keep v1 preparation state seed-derived and reproducible as each side's
    // turn begins; PLAY_CARD still only records a validated target submission.
    next = decrementPreparation(next, nextSide);
    if (nextRound >= next.maxRounds) return emit(next, 'ROUND_START', nextSide, { round: nextRound });
    if (nextRound !== state.round) next = emit(next, 'ROUND_START', nextSide, { round: nextRound });
    return emit(next, 'TURN_START', nextSide, { turn: next.turn });
  }

  function applyAction(state: RunnerBattleState, action: HighLevelAction, canonicalUnitId?: string, parity = false, actionNumber = 1): RunnerBattleState {
    if (action.type === 'BATTLE_START') return startBattle(state);
    if (action.type === 'DEPLOY_UNIT') return deploy(state, action, canonicalUnitId, parity, actionNumber);
    if (action.type === 'PLAY_CARD') return submitCardTarget(state, action, actionNumber);
    if (action.type === 'APPLY_DOT') return applyDot(state, action, actionNumber);
    if (action.type === 'MOVE_UNIT') return move(state, action, parity);
    if (action.type === 'ATTACK') return attack(state, action, parity);
    if (parity) return endTurnParity(state);
    return endTurn(state);
  }

  function settle(state: RunnerBattleState): { readonly state: RunnerBattleState; readonly outcome: OutcomeResult } {
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

  function runBattleRunner(input: unknown): BattleRunnerOutput {
    const parsed = parseInput(input);
    let state = initialState(parsed.seed, undefined, false, parsed.professionId);
    let outcome = resolveOutcome({ heroHp: state.heroHp, round: state.round, maxRounds: state.maxRounds, rng: { rngState: state.rngState, rngCursor: state.rngCursor } });
    for (const [index, action] of parsed.actions.entries()) {
      state = applyAction(state, action, undefined, false, index + 1);
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

  function runBattleRunnerV2(input: unknown): ParityBattleRunnerOutput {
    const parsed = parseParityInput(input);
    const cardByRef = new Map(parsed.fixture.cards.map((card) => [card.fixtureCardId, card]));
    const unitByRef = new Map(parsed.fixture.units.map((unit) => [unit.fixtureUnitId, unit]));
    const decks = {
      player: parsed.fixture.decks.player.map((ref) => cardByRef.get(ref)!.cocosCardId),
      enemy: parsed.fixture.decks.enemy.map((ref) => cardByRef.get(ref)!.cocosCardId),
    } as const;
    let state = initialState(parsed.seed, decks, true);
    state = decrementPreparation(state, state.activeSide);
    state = emit(state, 'BATTLE_START', state.activeSide, { seed: state.seed });
    state = emit(state, 'TURN_START', state.activeSide, { turn: state.turn });
    for (const [index, action] of parsed.fixture.actions.entries()) {
      if (action.type === 'BATTLE_START') continue;
      let translated: HighLevelAction;
      let canonicalUnitId: string | undefined;
      if (action.type === 'DEPLOY_UNIT') {
        const card = cardByRef.get(action.cardRef!);
        const unit = unitByRef.get(action.unitRef!);
        if (!card || !unit) throw new RunnerInputError('INVALID_COMMAND', 'fixture action mapping is missing');
        translated = { type: action.type, cardId: card.cocosCardId, side: action.side!, lane: action.lane!, cell: action.cell! };
        canonicalUnitId = unit.canonicalUnitId;
      } else if (action.type === 'MOVE_UNIT' || action.type === 'ATTACK') {
        const unit = unitByRef.get(action.unitRef!);
        if (!unit) throw new RunnerInputError('INVALID_COMMAND', 'fixture unit mapping is missing');
        translated = action.type === 'MOVE_UNIT'
          ? (action.steps === undefined ? { type: action.type, unitId: unit.canonicalUnitId } : { type: action.type, unitId: unit.canonicalUnitId, steps: action.steps })
          : { type: action.type, attackerId: unit.canonicalUnitId };
      } else {
        translated = { type: 'END_TURN' };
      }
      state = applyAction(state, translated, canonicalUnitId, true, index + 1);
      if (action.type !== 'END_TURN') state = settleParity(state);
    }
    const lifecycleEvents = projectParityLifecycleEvents(state, parsed.fixture);
    const finalHash = hash(stable({ seed: parsed.seed, fixture: parsed.fixture, finalState: state, events: state.events }));
    return {
      protocol: BATTLE_RUNNER_V2_PROTOCOL,
      status: 'ok',
      runner: BATTLE_RUNNER,
      seed: parsed.seed,
      fixtureVersion: parsed.fixture.version,
      actionCount: parsed.fixture.actions.length,
      finalState: state,
      events: state.events,
      lifecycleEvents,
      rngCursor: state.rngCursor,
      finalHash,
    };
  }

  return Object.freeze({ runBattleRunner, runBattleRunnerV2, runNeutralBattle });
}

export function errorOutput(error: unknown, protocol: typeof BATTLE_RUNNER_PROTOCOL | typeof BATTLE_RUNNER_V2_PROTOCOL = BATTLE_RUNNER_PROTOCOL): BattleRunnerError {
  if (error instanceof RunnerInputError) return { protocol, status: 'error', error: { code: error.code, message: error.message } };
  return { protocol, status: 'error', error: { code: 'INVALID_JSON', message: error instanceof Error ? error.message : String(error) } };
}
