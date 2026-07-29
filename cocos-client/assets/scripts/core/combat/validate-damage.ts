import assert from 'node:assert/strict';
import { createBoardState } from '../board/index.ts';
import { damageUnit, healUnit, removeDead } from './damage.ts';
import type { Unit } from '../types/index.ts';

const unit: Unit = { id: 'u1', cardId: 'U001', name: '测试', side: 'player', lane: 0, cell: 0,
  hp: 10, maxHp: 12, attack: 3, armor: 2, move: 1, range: 1, role: 'guard', tags: [], statuses: [], actionsTaken: 0, spawnRound: 1 };
const initial = createBoardState([unit]);
const hit = damageUnit(initial, 'u1', 5, true);
assert.equal(hit.damage, 3);
assert.equal(hit.state.units[0].hp, 7);
assert.equal(initial.units[0].hp, 10);
assert.equal(damageUnit(initial, 'u1', 5, false).damage, 5);
assert.equal(damageUnit(initial, 'u1', 0, true).damage, 1, 'physical damage has a minimum of one');

const healed = healUnit(hit.state, 'u1', 99);
assert.equal(healed.healed, 5);
assert.equal(healed.state.units[0].hp, 12);
assert.equal(healUnit(healed.state, 'u1', 1).healed, 0);

const killed = damageUnit(initial, 'u1', 99, false);
assert.equal(killed.killed, true);
assert.equal(killed.state.units[0].hp, 0);
assert.equal(removeDead(killed.state).units.length, 0);
assert.strictEqual(removeDead(initial), initial);
assert.throws(() => damageUnit(initial, 'u1', -1), /invalid/);
assert.throws(() => healUnit(initial, 'u1', -1), /invalid/);

console.log('T024 damage PASS: armor, minimum damage, capped healing, death removal and immutable snapshots');
