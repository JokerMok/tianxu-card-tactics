import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createBattleState } from '../../core/types/index.ts';
import {
  BattleInputAdapter,
  BATTLE_INPUT_EVENTS,
} from './battle-input-adapter.ts';

const source = fs.readFileSync(new URL('./battle-input-adapter.ts', import.meta.url), 'utf8');
assert.doesNotMatch(
  source,
  /(?:from|require\()\s*["']node:/,
  'input adapter must be runtime-neutral',
);
assert.doesNotMatch(source, /\b(?:window|document|cc)\b/, 'input adapter must not require a host global');

function card(instanceId, cardId, remainingPreparation = 0) {
  return { instanceId, cardId, remainingPreparation };
}

function unit(id, side, lane, cell, hp = 10, maxHp = 10) {
  return {
    id,
    cardId: 'U001',
    name: id,
    side,
    lane,
    cell,
    hp,
    maxHp,
    attack: 2,
    armor: 0,
    move: 1,
    range: 1,
    role: 'guard',
    tags: [],
    statuses: [],
    actionsTaken: 0,
    spawnRound: 1,
  };
}

function makeState(overrides = {}) {
  return createBattleState({
    revision: 1,
    seed: 7,
    rngState: 7,
    rngCursor: 0,
    round: 1,
    turn: 1,
    maxRounds: 80,
    laneCount: 2,
    cellsPerLane: 12,
    summonDepth: 3,
    openingInitiative: 'player',
    activeSide: 'player',
    heroHp: { player: 30, enemy: 30 },
    heroMaxHp: { player: 30, enemy: 30 },
    decks: { player: [], enemy: [] },
    hands: {
      player: [card('u-card', 'U001'), card('lane-card', 'S-LANE'), card('enemy-card', 'S-ENEMY'), card('ally-card', 'S-ALLY')],
      enemy: [],
    },
    graveyards: { player: [], enemy: [] },
    units: [unit('enemy-1', 'enemy', 0, 11)],
    events: [],
    status: 'playing',
    nextId: 2,
    nextEventId: 1,
    ...overrides,
  });
}

const definitions = {
  U001: { kind: 'unit' },
  'S-LANE': { kind: 'skill', targetType: 'lane' },
  'S-ENEMY': { kind: 'skill', targetType: 'enemy-unit' },
  'S-ALLY': { kind: 'skill', targetType: 'ally-unit' },
};

function makeHarness(state = makeState(), nodeFactory, side = 'player') {
  const submitted = [];
  const session = {
    get snapshot() { return { state }; },
    dispatch(action) { submitted.push(action); return { ok: true }; },
  };
  const adapter = new BattleInputAdapter({
    session,
    side,
    resolveCard(cardId) { return definitions[cardId]; },
    ...(nodeFactory ? { nodeFactory } : {}),
  });
  return { adapter, session, submitted };
}

// The player and enemy summon zones each expose exactly 2 x 3 legal cells.
{
  const { adapter } = makeHarness();
  assert.equal(adapter.selectCard('u-card').ok, true);
  assert.deepEqual(adapter.preview.candidates, [
    { kind: 'cell', lane: 0, cell: 0 }, { kind: 'cell', lane: 0, cell: 1 }, { kind: 'cell', lane: 0, cell: 2 },
    { kind: 'cell', lane: 1, cell: 0 }, { kind: 'cell', lane: 1, cell: 1 }, { kind: 'cell', lane: 1, cell: 2 },
  ]);
  const enemy = makeHarness(makeState({
    activeSide: 'enemy',
    hands: { player: [card('u-card', 'U001')], enemy: [card('enemy-u-card', 'U001')] },
    units: [],
  }), undefined, 'enemy').adapter;
  assert.equal(enemy.selectCard('enemy-u-card').ok, true);
  assert.deepEqual(enemy.preview.candidates, [
    { kind: 'cell', lane: 0, cell: 11 }, { kind: 'cell', lane: 0, cell: 10 }, { kind: 'cell', lane: 0, cell: 9 },
    { kind: 'cell', lane: 1, cell: 11 }, { kind: 'cell', lane: 1, cell: 10 }, { kind: 'cell', lane: 1, cell: 9 },
  ]);
}

// Invalid deployment input is explicit and must not mutate selection or submit.
{
  const { adapter, submitted } = makeHarness();
  assert.equal(adapter.selectCard('u-card').ok, true);
  const before = adapter.selection;
  for (const [target, code] of [
    [{ kind: 'cell', lane: 8, cell: 0 }, 'CELL_OUT_OF_BOUNDS'],
    [{ kind: 'cell', lane: 0, cell: 3 }, 'NOT_SUMMON_CELL'],
    [{ kind: 'cell', lane: 0, cell: 11 }, 'ENEMY_DEPLOYMENT_CELL'],
    [{ kind: 'cell', lane: 0, cell: 0 }, ''],
  ]) {
    if (code === '') continue;
    const result = adapter.selectTarget(target);
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    assert.deepEqual(adapter.selection, before);
  }
  assert.equal(adapter.selectTarget({ kind: 'cell', lane: 0, cell: 0 }).ok, true);
  assert.equal(adapter.confirm().ok, true);
  assert.equal(submitted.length, 1);
  assert.deepEqual(submitted[0], { type: 'DEPLOY_UNIT', cardId: 'U001', side: 'player', lane: 0, cell: 0 });
  assert.equal(adapter.confirm().ok, false);
  assert.equal(submitted.length, 1, 'repeated confirm must not submit twice');
}

// Occupied cells are filtered from preview and rejected if tapped directly.
{
  const { adapter } = makeHarness(makeState({ units: [unit('occupied', 'player', 0, 0)] }));
  assert.equal(adapter.selectCard('u-card').ok, true);
  assert.equal(adapter.preview.candidates.some((target) => target.lane === 0 && target.cell === 0), false);
  const result = adapter.selectTarget({ kind: 'cell', lane: 0, cell: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CELL_OCCUPIED');
}

// Skill previews are derived from the immutable state and definition target type.
{
  const { adapter, submitted } = makeHarness();
  assert.equal(adapter.selectCard('lane-card').ok, true);
  assert.deepEqual(adapter.preview.candidates, [{ kind: 'lane', lane: 0 }]);
  assert.equal(adapter.selectTarget({ kind: 'unit', unitId: 'enemy-1' }).code, 'TARGET_TYPE_MISMATCH');
  assert.equal(adapter.selectTarget({ kind: 'lane', lane: 0 }).ok, true);
  assert.equal(adapter.confirm().ok, true);
  assert.deepEqual(submitted[0], { type: 'PLAY_CARD', cardId: 'S-LANE', side: 'player', target: { kind: 'lane', lane: 0 } });

  const enemy = makeHarness(makeState({ units: [unit('enemy-1', 'enemy', 0, 11), unit('ally-1', 'player', 1, 1, 5, 10)] })).adapter;
  assert.equal(enemy.selectCard('enemy-card').ok, true);
  assert.deepEqual(enemy.preview.candidates, [{ kind: 'unit', unitId: 'enemy-1' }]);
  assert.equal(enemy.selectTarget({ kind: 'unit', unitId: 'ally-1' }).code, 'TARGET_SIDE_MISMATCH');
  assert.equal(enemy.selectTarget({ kind: 'unit', unitId: 'enemy-1' }).ok, true);

  const ally = makeHarness(makeState({ units: [unit('enemy-1', 'enemy', 0, 11), unit('ally-1', 'player', 1, 1, 5, 10)] })).adapter;
  assert.equal(ally.selectCard('ally-card').ok, true);
  assert.deepEqual(ally.preview.candidates, [{ kind: 'unit', unitId: 'ally-1' }]);
}

// Select, preview, and cancel never dispatch; cancel is idempotent.
{
  const { adapter, submitted } = makeHarness();
  assert.equal(adapter.selectCard('u-card').ok, true);
  assert.equal(adapter.preview.candidates.length, 6);
  assert.equal(adapter.cancel().ok, true);
  assert.equal(adapter.cancel().ok, true);
  assert.deepEqual(adapter.selection, { cardInstanceId: null, target: null });
  assert.deepEqual(submitted, []);
}

// A rejected or failed commit keeps the staged choice for retry or correction.
for (const [dispatch, expectedCode] of [
  [() => ({ ok: false }), 'COMMIT_REJECTED'],
  [() => { throw new Error('engine unavailable'); }, 'COMMIT_FAILED'],
]) {
  const state = makeState();
  const session = {
    get snapshot() { return { state }; },
    dispatch,
  };
  const adapter = new BattleInputAdapter({
    session,
    side: 'player',
    resolveCard(cardId) { return definitions[cardId]; },
  });
  assert.equal(adapter.selectCard('u-card').ok, true);
  assert.equal(adapter.selectCell(0, 0).ok, true);
  const beforeConfirm = adapter.selection;
  const result = adapter.confirm();
  assert.equal(result.ok, false);
  assert.equal(result.code, expectedCode);
  assert.deepEqual(adapter.selection, beforeConfirm);
}

// Touch/Node-like bridges do not depend on Node.js or browser globals.
{
  const listeners = new Map();
  const node = {
    on(event, callback) { listeners.set(event, callback); },
    off(event) { listeners.delete(event); },
  };
  const { adapter } = makeHarness();
  const dispose = adapter.bindCardNode(node, 'u-card');
  assert.equal(listeners.has(BATTLE_INPUT_EVENTS.TOUCH_END), true);
  listeners.get(BATTLE_INPUT_EVENTS.TOUCH_END)();
  assert.equal(adapter.selection.cardInstanceId, 'u-card');
  dispose();
  assert.equal(listeners.size, 0);
}

console.log('BattleInputAdapter contract PASS');
