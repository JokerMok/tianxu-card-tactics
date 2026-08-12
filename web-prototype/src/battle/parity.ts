import { getCard } from '../data/cards';
import {
  ENEMY_PROFESSION,
  PLAYER_PROFESSION,
  validateDeck,
} from '../data/decks';
import {
  attackUnitForParity,
  createBattle,
  endTurn,
  moveUnitForParity,
  playCard,
} from './engine';
import type { BattleEvent, BattleState, Side } from './types';

export const PARITY_FIXTURE_VERSION = 2 as const;

export interface ParityCardMapping {
  fixtureCardId: string;
  reactCardId: string;
  cocosCardId: string;
  cocosUnitId?: string;
}

export interface ParityUnitMapping {
  fixtureUnitId: string;
  canonicalUnitId: string;
}

export interface ParityEventMapping {
  fixtureType: string;
  reactType: string;
  cocosType: string;
  fields: string[];
}

export type ParityAction =
  | { type: 'BATTLE_START' }
  | { type: 'DEPLOY_UNIT'; cardRef: string; unitRef: string; side: Side; lane: number; cell: number }
  | { type: 'MOVE_UNIT'; unitRef: string; steps?: number }
  | { type: 'ATTACK'; unitRef: string }
  | { type: 'END_TURN' };

export interface ParityFixture {
  version: typeof PARITY_FIXTURE_VERSION;
  cards: ParityCardMapping[];
  units: ParityUnitMapping[];
  events: ParityEventMapping[];
  decks: { player: string[]; enemy: string[] };
  actions: ParityAction[];
  ignoredEventTypes: string[];
  compare: {
    stateFields: string[];
    eventFields: string[];
    omittedFields: string[];
  };
}

export interface ReactParityRun {
  rawFinalState: BattleState;
  rawEvents: readonly BattleEvent[];
  unitAliases: Readonly<Record<string, string>>;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PARITY_FIXTURE_INVALID: ${message}`);
}

function assertString(value: unknown, label: string): asserts value is string {
  assert(typeof value === 'string' && value.length > 0, `${label} must be a non-empty string`);
}

function assertStringArray(value: unknown, label: string): asserts value is string[] {
  assert(Array.isArray(value) && value.every((item) => typeof item === 'string'), `${label} must be a string array`);
}

function unique(values: readonly string[], label: string): void {
  assert(new Set(values).size === values.length, `${label} must be unique`);
}

function mappingByFixture(fixture: ParityFixture): Map<string, ParityCardMapping> {
  return new Map(fixture.cards.map((mapping) => [mapping.fixtureCardId, mapping]));
}

function unitMappingByFixture(fixture: ParityFixture): Map<string, ParityUnitMapping> {
  return new Map(fixture.units.map((mapping) => [mapping.fixtureUnitId, mapping]));
}

export function validateParityFixture(input: unknown): ParityFixture {
  assert(isRecord(input), 'fixture must be an object');
  assert(input.version === PARITY_FIXTURE_VERSION, 'version must be 2');
  assert(Array.isArray(input.cards) && input.cards.length > 0, 'cards must be non-empty');
  assert(Array.isArray(input.units) && input.units.length > 0, 'units must be non-empty');
  assert(Array.isArray(input.events) && input.events.length > 0, 'events must be non-empty');
  assert(isRecord(input.decks), 'decks must be an object');
  const rawDecks = input.decks;
  assertStringArray(rawDecks.player, 'decks.player');
  assertStringArray(rawDecks.enemy, 'decks.enemy');
  assert(rawDecks.player.length === 30 && rawDecks.enemy.length === 30, 'decks must contain 30 cards per side');
  const normalizedDecks = { player: rawDecks.player as string[], enemy: rawDecks.enemy as string[] };
  assert(Array.isArray(input.actions), 'actions must be an array');
  assertStringArray(input.ignoredEventTypes, 'ignoredEventTypes');
  assert(isRecord(input.compare), 'compare must be an object');
  assertStringArray(input.compare.stateFields, 'compare.stateFields');
  assertStringArray(input.compare.eventFields, 'compare.eventFields');
  assertStringArray(input.compare.omittedFields, 'compare.omittedFields');

  const cards = input.cards.map((value, index) => {
    assert(isRecord(value), `cards[${index}] must be an object`);
    assertString(value.fixtureCardId, `cards[${index}].fixtureCardId`);
    assertString(value.reactCardId, `cards[${index}].reactCardId`);
    assertString(value.cocosCardId, `cards[${index}].cocosCardId`);
    if (value.cocosUnitId !== undefined) assertString(value.cocosUnitId, `cards[${index}].cocosUnitId`);
    const card = getCard(value.reactCardId);
    if (card.kind === 'unit') assert(typeof value.cocosUnitId === 'string', `cards[${index}] unit card requires cocosUnitId`);
    return {
      fixtureCardId: value.fixtureCardId,
      reactCardId: value.reactCardId,
      cocosCardId: value.cocosCardId,
      ...(value.cocosUnitId === undefined ? {} : { cocosUnitId: value.cocosUnitId }),
    } as ParityCardMapping;
  });
  unique(cards.map((mapping) => mapping.fixtureCardId), 'card fixture IDs');
  unique(cards.map((mapping) => mapping.reactCardId), 'React card IDs');
  unique(cards.map((mapping) => mapping.cocosCardId), 'Cocos card IDs');
  const cardMap = new Map(cards.map((mapping) => [mapping.fixtureCardId, mapping]));

  const units = input.units.map((value, index) => {
    assert(isRecord(value), `units[${index}] must be an object`);
    assertString(value.fixtureUnitId, `units[${index}].fixtureUnitId`);
    assertString(value.canonicalUnitId, `units[${index}].canonicalUnitId`);
    return { fixtureUnitId: value.fixtureUnitId, canonicalUnitId: value.canonicalUnitId };
  });
  unique(units.map((mapping) => mapping.fixtureUnitId), 'unit fixture IDs');
  unique(units.map((mapping) => mapping.canonicalUnitId), 'canonical unit IDs');
  const unitRefs = new Set(units.map((mapping) => mapping.fixtureUnitId));
  const events = input.events.map((value, index) => {
    assert(isRecord(value), `events[${index}] must be an object`);
    assertString(value.fixtureType, `events[${index}].fixtureType`);
    assertString(value.reactType, `events[${index}].reactType`);
    assertString(value.cocosType, `events[${index}].cocosType`);
    assertStringArray(value.fields, `events[${index}].fields`);
    return { fixtureType: value.fixtureType, reactType: value.reactType, cocosType: value.cocosType, fields: [...value.fields] };
  });
  unique(events.map((mapping) => mapping.fixtureType), 'event fixture types');
  unique(events.map((mapping) => mapping.reactType), 'React event types');
  unique(events.map((mapping) => mapping.cocosType), 'Cocos event types');

  for (const side of ['player', 'enemy'] as const) {
    for (const ref of normalizedDecks[side]) assert(cardMap.has(ref), `decks.${side} references unmapped card ${ref}`);
    const deck = normalizedDecks[side].map((ref) => cardMap.get(ref)!.reactCardId);
    validateDeck(deck, side === 'player' ? PLAYER_PROFESSION : ENEMY_PROFESSION, `${side} parity deck`);
  }

  const actions = input.actions.map((value, index) => {
    assert(isRecord(value) && typeof value.type === 'string', `actions[${index}] must have a type`);
    switch (value.type) {
      case 'BATTLE_START':
      case 'END_TURN':
        assert(Object.keys(value).length === 1, `actions[${index}] has unsupported fields`);
        return { type: value.type } as ParityAction;
      case 'DEPLOY_UNIT':
        assertString(value.cardRef, `actions[${index}].cardRef`);
        assertString(value.unitRef, `actions[${index}].unitRef`);
        assert(value.side === 'player' || value.side === 'enemy', `actions[${index}].side is invalid`);
        assert(Number.isSafeInteger(value.lane) && Number.isSafeInteger(value.cell), `actions[${index}] lane/cell must be integers`);
        assert(cardMap.has(value.cardRef), `actions[${index}] cardRef is unmapped`);
        assert(unitRefs.has(value.unitRef), `actions[${index}] unitRef is unmapped`);
        assert(getCard(cardMap.get(value.cardRef)!.reactCardId).kind === 'unit', `actions[${index}] cardRef must be a unit card`);
        return { type: value.type, cardRef: value.cardRef, unitRef: value.unitRef, side: value.side as Side, lane: value.lane as number, cell: value.cell as number };
      case 'MOVE_UNIT':
      case 'ATTACK':
        assertString(value.unitRef, `actions[${index}].unitRef`);
        assert(unitRefs.has(value.unitRef), `actions[${index}] unitRef is unmapped`);
        if (value.type === 'MOVE_UNIT') {
          if (value.steps !== undefined) assert(typeof value.steps === 'number' && Number.isSafeInteger(value.steps) && value.steps >= 0, `actions[${index}].steps is invalid`);
          return value.steps === undefined ? { type: value.type, unitRef: value.unitRef } : { type: value.type, unitRef: value.unitRef, steps: value.steps as number };
        }
        return { type: value.type, unitRef: value.unitRef };
      default:
        throw new Error(`PARITY_FIXTURE_INVALID: actions[${index}] type is unsupported`);
    }
  });
  assert(actions.filter((action) => action.type === 'BATTLE_START').length <= 1, 'only one BATTLE_START is allowed');
  return {
    version: PARITY_FIXTURE_VERSION,
    cards,
    units,
    events,
    decks: { player: [...normalizedDecks.player], enemy: [...normalizedDecks.enemy] },
    actions,
    ignoredEventTypes: [...input.ignoredEventTypes],
    compare: {
      stateFields: [...input.compare.stateFields],
      eventFields: [...input.compare.eventFields],
      omittedFields: [...input.compare.omittedFields],
    },
  };
}

function cardInstanceId(state: BattleState, side: Side, cardId: string): string {
  const instance = state.hands[side].find((candidate) => candidate.cardId === cardId && candidate.remaining === 0);
  if (!instance) throw new Error(`PARITY_ACTION_INVALID: ready card ${cardId} is not in ${side} hand`);
  return instance.instanceId;
}

export function runReactParityFixture(input: unknown, seed: number): ReactParityRun {
  const fixture = validateParityFixture(input);
  const cardMap = mappingByFixture(fixture);
  const unitMap = unitMappingByFixture(fixture);
  const stateByUnitRef = new Map<string, string>();
  let state = createBattle(seed, {
    decks: {
      player: fixture.decks.player.map((ref) => cardMap.get(ref)!.reactCardId),
      enemy: fixture.decks.enemy.map((ref) => cardMap.get(ref)!.reactCardId),
    },
    openingInitiative: seed % 2 === 0 ? 'player' : 'enemy',
  });

  for (const action of fixture.actions) {
    if (action.type === 'BATTLE_START') continue;
    if (action.type === 'DEPLOY_UNIT') {
      const cardId = cardMap.get(action.cardRef)!.reactCardId;
      const result = playCard(state, action.side, cardInstanceId(state, action.side, cardId), { kind: 'cell', lane: action.lane, cell: action.cell });
      if (!result.played) throw new Error(`PARITY_ACTION_REJECTED: deploy ${action.unitRef}: ${result.reason ?? 'unknown'}`);
      state = result.state;
      const deployed = [...state.units].reverse().find((unit) => unit.side === action.side && unit.cardId === cardId && !stateByUnitRef.has(unit.id));
      if (!deployed) throw new Error(`PARITY_ACTION_INVALID: deployed unit ${action.unitRef} cannot be identified`);
      assert(unitMap.has(action.unitRef), `unitRef ${action.unitRef} is not mapped`);
      stateByUnitRef.set(action.unitRef, deployed.id);
      continue;
    }
    if (action.type === 'MOVE_UNIT') {
      const unitId = stateByUnitRef.get(action.unitRef);
      if (!unitId) throw new Error(`PARITY_ACTION_INVALID: unknown unitRef ${action.unitRef}`);
      state = moveUnitForParity(state, unitId, action.steps);
      continue;
    }
    if (action.type === 'ATTACK') {
      const unitId = stateByUnitRef.get(action.unitRef);
      if (!unitId) throw new Error(`PARITY_ACTION_INVALID: unknown unitRef ${action.unitRef}`);
      state = attackUnitForParity(state, unitId);
      continue;
    }
    state = endTurn(state, state.activeSide);
  }
  const unitAliases: Record<string, string> = {};
  for (const [fixtureUnitId, actualId] of stateByUnitRef) {
    const canonical = unitMap.get(fixtureUnitId)?.canonicalUnitId;
    if (canonical) unitAliases[actualId] = canonical;
  }
  return { rawFinalState: state, rawEvents: state.events, unitAliases };
}

function cardRefMap(mappings: readonly ParityCardMapping[], source: 'react' | 'cocos'): Map<string, string> {
  return new Map(mappings.map((mapping) => [source === 'react' ? mapping.reactCardId : mapping.cocosCardId, mapping.fixtureCardId]));
}

function normalizeStatus(value: unknown): UnknownRecord {
  if (!isRecord(value)) return {};
  if ('burnDamage' in value) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== 0 && item !== undefined));
  }
  const statuses = Array.isArray(value) ? value : [];
  return Object.fromEntries(statuses.map((status) => {
    if (!isRecord(status) || typeof status.kind !== 'string') return ['unknown', status];
    return [status.kind, status.stacks ?? status.value ?? status.remainingRounds ?? 0];
  }));
}

function normalizeUnit(value: unknown, aliases: Readonly<Record<string, string>>, cardRefs: Map<string, string>): UnknownRecord {
  assert(isRecord(value), 'unit state must be an object');
  for (const field of ['id', 'cardId', 'side', 'lane', 'cell', 'hp', 'maxHp', 'attack', 'armor', 'move', 'range', 'role', 'actionsTaken', 'spawnRound']) {
    assert(Object.prototype.hasOwnProperty.call(value, field) && value[field] !== undefined, `unit state is missing ${field}`);
  }
  assert(value.status !== undefined || value.statuses !== undefined, 'unit state is missing status/statuses');
  return {
    id: aliases[String(value.id)] ?? value.id,
    cardId: cardRefs.get(String(value.cardId)) ?? value.cardId,
    side: value.side,
    lane: value.lane,
    cell: value.cell,
    hp: value.hp,
    maxHp: value.maxHp,
    attack: value.attack,
    armor: value.armor,
    move: value.move,
    range: value.range,
    role: value.role,
    actionsTaken: value.actionsTaken,
    spawnRound: value.spawnRound,
    status: normalizeStatus(value.status ?? value.statuses),
  };
}

function normalizeState(source: UnknownRecord, fixture: ParityFixture, sourceKind: 'react' | 'cocos', aliases: Readonly<Record<string, string>>): UnknownRecord {
  const cardRefs = cardRefMap(fixture.cards, sourceKind);
  const sides = ['player', 'enemy'] as const;
  const normalizeCards = (values: unknown, includePreparation: boolean): UnknownRecord[] => (Array.isArray(values) ? values : []).map((value) => {
    if (typeof value === 'string') return { cardId: cardRefs.get(value) ?? value };
    assert(isRecord(value), 'card state must be an object');
    assert(value.instanceId !== undefined && value.cardId !== undefined, 'card instance is missing instanceId/cardId');
    return {
      instanceId: value.instanceId,
      cardId: cardRefs.get(String(value.cardId)) ?? value.cardId,
      ...(includePreparation ? { remainingPreparation: value.remainingPreparation ?? value.remaining } : {}),
    };
  });
  const normalized: UnknownRecord = {};
  for (const field of fixture.compare.stateFields) {
    assert(Object.prototype.hasOwnProperty.call(source, field) && source[field] !== undefined, `${sourceKind} raw finalState is missing ${field}`);
    if (field === 'decks' || field === 'hands' || field === 'graveyards') {
      assert(isRecord(source[field]), `${sourceKind} raw finalState ${field} must be an object`);
      const value = source[field];
      for (const side of sides) assert(Array.isArray(value[side]), `${sourceKind} raw finalState ${field}.${side} must be an array`);
      normalized[field] = Object.fromEntries(sides.map((side) => [side, normalizeCards(value[side], field === 'hands')]));
    } else if (field === 'heroHp' || field === 'heroMaxHp') {
      normalized[field] = source[field];
    } else if (field === 'units') {
      normalized.units = (Array.isArray(source.units) ? source.units : [])
        .map((unit) => normalizeUnit(unit, aliases, cardRefs))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    } else {
      normalized[field] = source[field];
    }
  }
  return normalized;
}

export function projectParityFinalState(rawReactState: BattleState, rawCocosState: unknown, fixture: ParityFixture, unitAliases: Readonly<Record<string, string>> = {}): { react: UnknownRecord; cocos: UnknownRecord } {
  assert(isRecord(rawCocosState), 'Cocos finalState must be an object');
  return {
    react: normalizeState(rawReactState as unknown as UnknownRecord, fixture, 'react', unitAliases),
    cocos: normalizeState(rawCocosState, fixture, 'cocos', {}),
  };
}

function eventPayload(value: UnknownRecord, key: string): unknown {
  const payload = isRecord(value.payload) ? value.payload : {};
  if (key === 'side') return value.side ?? payload.side ?? payload.winner ?? value.activeSide ?? payload.activeSide;
  if (key === 'sourceId') return value.sourceId ?? payload.sourceId ?? payload.attackerId ?? payload.unitId;
  if (key === 'targetId') return value.targetId ?? payload.targetId ?? payload.unitId;
  if (key === 'value') return value.value ?? payload.value ?? payload.damage ?? payload.dealt;
  if (key === 'quantity') return value.quantity ?? payload.quantity ?? payload.steps;
  return value[key] ?? payload[key];
}

function projectEvents(rawEvents: readonly unknown[], mappings: readonly ParityEventMapping[], ignoredEventTypes: readonly string[], sourceKind: 'react' | 'cocos', aliases: Readonly<Record<string, string>>): UnknownRecord[] {
  const byType = new Map(mappings.map((mapping) => [sourceKind === 'react' ? mapping.reactType : mapping.cocosType, mapping]));
  const ignored = new Set(ignoredEventTypes);
  return rawEvents.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    const mapping = byType.get(String(raw.type));
    if (!mapping) {
      if (ignored.has(String(raw.type))) return [];
      throw new Error(`PARITY_EVENT_UNMAPPED: ${sourceKind}:${String(raw.type)}`);
    }
    const projected: UnknownRecord = { type: mapping.fixtureType };
    for (const field of mapping.fields) {
      let value = eventPayload(raw, field);
      if ((field === 'sourceId' || field === 'targetId') && value !== undefined) value = aliases[String(value)] ?? value;
      projected[field] = value;
    }
    return [projected];
  });
}

export function projectParityEvents(rawEvents: readonly BattleEvent[], fixture: ParityFixture, unitAliases: Readonly<Record<string, string>> = {}): UnknownRecord[] {
  return projectEvents(rawEvents, fixture.events, fixture.ignoredEventTypes, 'react', unitAliases);
}

export function projectCocosParityEvents(rawEvents: readonly unknown[], fixture: ParityFixture): UnknownRecord[] {
  return projectEvents(rawEvents, fixture.events, fixture.ignoredEventTypes, 'cocos', {});
}

export function projectParityLifecycle(events: readonly UnknownRecord[]): UnknownRecord[] {
  return events.filter((item) => item.type === 'BATTLE_END');
}
