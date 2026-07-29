import assert from 'node:assert/strict';
import { applyStatus, consumeBarrier, hasStatus, removeStatus, tickStatuses } from './index.ts';
import type { Unit } from '../types/index.ts';

const unit: Unit = { id: 'u1', cardId: 'U001', name: '测试', side: 'player', lane: 0, cell: 0,
  hp: 10, maxHp: 10, attack: 3, armor: 0, move: 1, range: 1, role: 'guard', tags: [], statuses: [], actionsTaken: 0, spawnRound: 1 };
const burn = applyStatus(unit, { id: 's1', kind: 'BURN', stacks: 1, remainingRounds: 2, value: 3 }, { stackRule: 'REFRESH', maxStacks: 3 });
assert.equal(burn.applied, true);
assert(hasStatus(burn.unit, 'BURN'));
assert.equal(tickStatuses(burn.unit, 'ROUND_END').statuses[0].remainingRounds, 1);
assert.equal(tickStatuses(burn.unit, 'ACTION_START', { BURN: { tickTiming: 'ROUND_END' } }).statuses[0].remainingRounds, 2);
const refreshed = applyStatus(tickStatuses(burn.unit, 'ROUND_END'), { id: 's2', kind: 'BURN', remainingRounds: 4, value: 5 }, { stackRule: 'REFRESH', maxStacks: 3 });
assert.equal(refreshed.unit.statuses[0].remainingRounds, 4);
const stacked = applyStatus(refreshed.unit, { id: 's3', kind: 'BURN', stacks: 2 }, { stackRule: 'ADD_VALUE', maxStacks: 3 });
assert.equal(stacked.unit.statuses[0].stacks, 3);
assert.equal(applyStatus(unit, { id: 's6', kind: 'STUN', stacks: 9 }, { maxStacks: 3 }).unit.statuses[0].stacks, 3);
const immune = applyStatus(unit, { id: 's4', kind: 'FREEZE', remainingRounds: 2 }, { immuneKinds: ['FREEZE'] });
assert.equal(immune.applied, false);
const barrier = applyStatus(unit, { id: 's5', kind: 'BARRIER', stacks: 1, value: 5 });
const absorbed = consumeBarrier(barrier.unit, 7);
assert.equal(absorbed.absorbed, 5);
assert.equal(absorbed.remaining, 2);
assert.equal(absorbed.unit.statuses.length, 0);
assert.throws(() => applyStatus(unit, { id: 's7', kind: 'BARRIER', value: -1 }), /value/);
assert.equal(removeStatus(burn.unit, 'BURN').statuses.length, 0);
assert.equal(tickStatuses(tickStatuses(burn.unit, 'ROUND_END'), 'ROUND_END').statuses.length, 0);
assert.deepEqual(unit.statuses, [], 'status updates must not mutate the original unit');

console.log('T026 status PASS: stacks, duration, immunity, refresh, burn/freeze/stun/barrier primitives');
