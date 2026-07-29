import assert from 'node:assert/strict';
import { createBoardState } from '../board/index.ts';
import { firstStrikeOrder, knockback, reactionOrder, recall, swapPositions } from './index.ts';
import type { Unit } from '../types/index.ts';

function unit(id: string, side: 'player' | 'enemy', lane: number, cell: number): Unit {
  return { id, cardId: id, name: id, side, lane, cell, hp: 10, maxHp: 10, attack: 1, armor: 0,
    move: 1, range: 1, role: 'guard', tags: [], statuses: [], actionsTaken: 0, spawnRound: 1 };
}

const initial = createBoardState([unit('p1', 'player', 0, 2), unit('e1', 'enemy', 0, 5), unit('e2', 'enemy', 0, 8), unit('p2', 'player', 1, 1)]);
const pushed = knockback(initial, 'p1', 'e1', 2);
assert.equal(pushed.steps, 2);
assert.equal(pushed.state.units.find((u) => u.id === 'e1')?.cell, 7);
assert.equal(initial.units.find((u) => u.id === 'e1')?.cell, 5);
const blocked = knockback(initial, 'p1', 'e1', 3);
assert.equal(blocked.steps, 2, 'knockback stops at occupied cell');
assert.equal(blocked.blocked, 'occupied');
const recalled = recall(initial, 'e1');
assert.equal(recalled.recalledUnitId, 'e1');
assert.equal(recalled.state.units.length, 3);
const swapped = swapPositions(initial, 'p1', 'p2');
assert.equal(swapped.units.find((u) => u.id === 'p1')?.lane, 1);
assert.equal(swapped.units.find((u) => u.id === 'p2')?.cell, 2);
assert.deepEqual(firstStrikeOrder(initial, ['e2', 'p2']), ['e2', 'p2', 'p1', 'e1']);
assert.deepEqual(reactionOrder({ reflectUnitId: 'r', guardUnitId: 'g', counterUnitId: 'c' }), [
  { type: 'GUARD', unitId: 'g' }, { type: 'COUNTER', unitId: 'c' }, { type: 'REFLECT', unitId: 'r' },
]);
assert.strictEqual(recall(initial, 'missing').state, initial);

console.log('T028 abilities PASS: knockback, recall, swap, first strike, guard/counter/reflect order');
