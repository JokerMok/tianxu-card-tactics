import assert from 'node:assert/strict';
import { createBoardState, deployUnit } from '../board/index.ts';
import { moveUnit } from './index.ts';
import type { Unit } from '../types/index.ts';

function unit(id: string, side: 'player' | 'enemy', cell: number, move: number): Unit {
  return { id, cardId: id, name: id, side, lane: 0, cell, hp: 10, maxHp: 10, attack: 1, armor: 0,
    move, range: 1, role: 'guard', tags: [], statuses: [], actionsTaken: 0, spawnRound: 1 };
}

const player = unit('p1', 'player', 0, 3);
const blocker = unit('p2', 'player', 2, 1);
let state = deployUnit(deployUnit(createBoardState(), player), blocker);
const blocked = moveUnit(state, 'p1');
assert.equal(blocked.steps, 1);
assert.equal(blocked.blocked, 'occupied');
assert.equal(blocked.state.units.find((item) => item.id === 'p1')?.cell, 1);
assert.equal(state.units.find((item) => item.id === 'p1')?.cell, 0);

state = createBoardState([unit('p3', 'player', 10, 5)]);
const edge = moveUnit(state, 'p3');
assert.equal(edge.steps, 1);
assert.equal(edge.blocked, 'boundary');
assert.equal(edge.state.units[0].cell, 11);

const enemyState = createBoardState([unit('e1', 'enemy', 11, 4)]);
const enemyMove = moveUnit(enemyState, 'e1');
assert.equal(enemyMove.steps, 4);
assert.equal(enemyMove.state.units[0].cell, 7);

const noMove = moveUnit(state, 'missing');
assert.strictEqual(noMove.state, state);
assert.throws(() => moveUnit(state, 'p3', -1), /invalid/);

console.log('T022 movement PASS: movement power, direction, blocking, boundary and immutable snapshots');
