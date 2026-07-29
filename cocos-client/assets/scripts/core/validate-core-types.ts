import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createBattleState,
  updateBattleState,
  type BattleStateInput,
} from './types/index.ts';

const fixture: BattleStateInput = {
  revision: 0,
  seed: 20260712,
  rngState: 20260712,
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
  decks: { player: ['U001'], enemy: ['U002'] },
  hands: {
    player: [{ instanceId: 'card-1', cardId: 'U001', remainingPreparation: 0 }],
    enemy: [{ instanceId: 'card-2', cardId: 'U002', remainingPreparation: 1 }],
  },
  graveyards: { player: [], enemy: [] },
  units: [
    {
      id: 'unit-1',
      cardId: 'U001',
      name: '测试单位',
      side: 'player',
      lane: 0,
      cell: 0,
      hp: 8,
      maxHp: 8,
      attack: 3,
      armor: 1,
      move: 1,
      range: 1,
      role: 'guard',
      tags: ['infantry'],
      statuses: [
        {
          id: 'status-1',
          kind: 'BARRIER',
          sourceId: 'unit-1',
          stacks: 1,
          remainingRounds: 2,
          value: 2,
        },
      ],
      actionsTaken: 0,
      spawnRound: 1,
    },
  ],
  events: [
    {
      id: 1,
      round: 1,
      turn: 1,
      rngCursor: 0,
      type: 'BATTLE_START',
      message: '战斗开始',
    },
  ],
  status: 'playing',
  nextId: 3,
  nextEventId: 2,
};

const initial = createBattleState(fixture);

assert(Object.isFrozen(initial), 'BattleState must be frozen');
assert(Object.isFrozen(initial.heroHp), 'nested records must be frozen');
assert(Object.isFrozen(initial.units), 'unit collection must be frozen');
assert(Object.isFrozen(initial.units[0]), 'Unit must be frozen');
assert(Object.isFrozen(initial.units[0].statuses[0]), 'Status must be frozen');
assert(Object.isFrozen(initial.hands.player[0]), 'CardInstance must be frozen');
assert(Object.isFrozen(initial.events[0]), 'Event must be frozen');

assert.throws(
  () => (initial.units as unknown as Array<unknown>).push({}),
  TypeError,
  'frozen collections must reject mutation',
);

const unchanged = updateBattleState(initial, {});
assert.strictEqual(unchanged, initial, 'empty updates must retain snapshot identity');

const updated = updateBattleState(initial, (state) => ({
  heroHp: { ...state.heroHp, enemy: state.heroHp.enemy - 3 },
  events: [
    ...state.events,
    {
      id: state.nextEventId,
      round: state.round,
      turn: state.turn,
      rngCursor: state.rngCursor,
      type: 'HERO_DAMAGED',
      message: '敌方主将受到 3 点伤害',
      side: 'enemy',
      value: 3,
    },
  ],
  nextEventId: state.nextEventId + 1,
}));

assert.notStrictEqual(updated, initial, 'a change must create a new snapshot');
assert.equal(initial.heroHp.enemy, 30, 'the previous snapshot must remain unchanged');
assert.equal(initial.events.length, 1, 'the previous event list must remain unchanged');
assert.equal(updated.heroHp.enemy, 27);
assert.equal(updated.events.length, 2);
assert.equal(updated.revision, 1, 'state revision must advance exactly once');
assert(Object.isFrozen(updated.events[1]), 'new nested values must be frozen');

const typesDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'types');
const sourceFiles = fs
  .readdirSync(typesDirectory, { recursive: true })
  .filter((entry): entry is string => typeof entry === 'string' && entry.endsWith('.ts'));

for (const sourceFile of sourceFiles) {
  const source = fs.readFileSync(path.join(typesDirectory, sourceFile), 'utf8');
  assert.doesNotMatch(source, /\bfrom\s+['"]cc['"]|\brequire\s*\(\s*['"]cc['"]\s*\)/);
}

console.log('Core types and immutable BattleState contract: PASS');
