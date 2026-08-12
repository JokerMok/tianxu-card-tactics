import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  UNIT_ACTION_STATES,
  UnitActionStateMachine,
} from './unit-action-state-machine.ts';

const source = fs.readFileSync(new URL('./unit-action-state-machine.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /(?:from|require\()\s*["']node:/, 'presentation must be runtime-neutral');
assert.doesNotMatch(source, /\b(?:window|document|cc|React)\b/, 'presentation must not require a host runtime');
assert.match(source, /UNIT_SPAWNED/);
assert.match(source, /UNIT_MOVED/);
assert.match(source, /ATTACK/);
assert.match(source, /DAMAGE/);
assert.match(source, /UNIT_DIED/);
assert.match(source, /Object\.freeze/);

function event(eventId, type, payload = {}, overrides = {}) {
  return {
    eventId,
    round: 1,
    turn: eventId,
    activeSide: 'player',
    rngCursor: eventId,
    type,
    payload,
    ...overrides,
  };
}

function snapshot(machine) {
  return machine.snapshot;
}

function stateOf(machine, unitId = 'u1') {
  return machine.getState(unitId);
}

assert.deepEqual(UNIT_ACTION_STATES, {
  IDLE: 'Idle',
  MOVE: 'Move',
  ATTACK: 'Attack',
  HIT: 'Hit',
  DEATH: 'Death',
});

// The initial snapshot is deterministic and immutable.
{
  const machine = new UnitActionStateMachine();
  assert.deepEqual(snapshot(machine), { lastEventId: null, sequence: 0, units: [] });
  assert.equal(Object.isFrozen(snapshot(machine)), true);
  assert.equal(Object.isFrozen(snapshot(machine).units), true);
}

// Unknown events are rejected without changing the committed snapshot.
{
  const machine = new UnitActionStateMachine();
  const before = snapshot(machine);
  const result = machine.dispatch(event(1, 'ROUND_START', { round: 1 }));
  assert.equal(result.accepted, false);
  assert.equal(result.code, 'UNKNOWN_EVENT');
  assert.strictEqual(snapshot(machine), before);
}

// Known events cannot address an unspawned unit, and malformed unit damage is rejected.
{
  const machine = new UnitActionStateMachine();
  assert.equal(machine.dispatch(event(1, 'UNIT_MOVED', { unitId: 'missing' })).code, 'UNKNOWN_UNIT');
  assert.equal(machine.dispatch(event(2, 'DAMAGE', { targetKind: 'hero', targetId: 'player', value: 1 })).code, 'INVALID_EVENT');
  assert.deepEqual(snapshot(machine), { lastEventId: null, sequence: 0, units: [] });
}

const sequence = [
  event(1, 'UNIT_SPAWNED', { unitId: 'u1', cardId: 'U001', lane: 0, cell: 0 }),
  event(2, 'UNIT_MOVED', { unitId: 'u1', steps: 1 }),
  event(3, 'ATTACK', { attackerId: 'u1', targetKind: 'unit', targetId: 'u2' }),
  event(4, 'DAMAGE', { targetKind: 'unit', targetId: 'u1', value: 2, sourceId: 'u2' }),
  event(5, 'UNIT_DIED', { unitId: 'u1', cardId: 'U001' }),
];

// Every accepted core event maps to exactly one action state in event order.
{
  const machine = new UnitActionStateMachine();
  const results = machine.applyEvents(sequence);
  assert.deepEqual(results.map((result) => [result.code, result.state]), [
    ['APPLIED', 'Idle'],
    ['APPLIED', 'Move'],
    ['APPLIED', 'Attack'],
    ['APPLIED', 'Hit'],
    ['APPLIED', 'Death'],
  ]);
  assert.equal(stateOf(machine), 'Death');
  assert.deepEqual(snapshot(machine), {
    lastEventId: 5,
    sequence: 5,
    units: [{ unitId: 'u1', state: 'Death', lastEventId: 5, lastEventType: 'UNIT_DIED' }],
  });
}

// Duplicate events, out-of-order events, and duplicate spawns do not mutate state.
{
  const machine = new UnitActionStateMachine();
  machine.dispatch(sequence[0]);
  machine.dispatch(sequence[1]);
  const beforeDuplicate = snapshot(machine);
  assert.equal(machine.dispatch(sequence[1]).code, 'DUPLICATE_EVENT');
  assert.strictEqual(snapshot(machine), beforeDuplicate);
  assert.equal(machine.dispatch(event(1, 'UNIT_MOVED', { unitId: 'u1' })).code, 'OUT_OF_ORDER_EVENT');
  assert.strictEqual(snapshot(machine), beforeDuplicate);
  assert.equal(machine.dispatch(event(3, 'UNIT_SPAWNED', { unitId: 'u1' })).code, 'DUPLICATE_UNIT');
  assert.strictEqual(snapshot(machine), beforeDuplicate);
}

// Death is terminal, including against later valid events and repeated death events.
{
  const machine = new UnitActionStateMachine();
  machine.applyEvents(sequence);
  const beforeTerminal = snapshot(machine);
  assert.equal(machine.dispatch(event(6, 'UNIT_MOVED', { unitId: 'u1' })).code, 'TERMINAL_STATE');
  assert.strictEqual(snapshot(machine), beforeTerminal);
  assert.equal(machine.dispatch(event(7, 'UNIT_DIED', { unitId: 'u1' })).code, 'TERMINAL_STATE');
  assert.strictEqual(snapshot(machine), beforeTerminal);
}

// The same event sequence produces byte-for-byte equivalent snapshots.
{
  const first = new UnitActionStateMachine();
  const second = new UnitActionStateMachine();
  first.applyEvents(sequence);
  second.applyEvents(sequence);
  assert.deepEqual(snapshot(first), snapshot(second));
  assert.equal(Object.isFrozen(snapshot(first).units[0]), true);
}

console.log('UnitActionStateMachine contract PASS');
