import assert from 'node:assert/strict';
import { createBoardState } from '../board/index.ts';
import { actionOrder, createAttackAction, findTarget } from './index.ts';
import type { Unit } from '../types/index.ts';

function unit(id: string, side: 'player' | 'enemy', lane: number, cell: number, range = 1, hp = 10): Unit {
  return { id, cardId: id, name: id, side, lane, cell, hp, maxHp: 10, attack: 4, armor: 0,
    move: 1, range, role: 'guard', tags: [], statuses: [], actionsTaken: 0, spawnRound: 1 };
}

const state = createBoardState([
  unit('p-near', 'player', 0, 4, 5),
  unit('p-far', 'player', 0, 1, 5),
  unit('e-low', 'enemy', 0, 6, 1, 3),
  unit('e-near', 'enemy', 0, 6, 1, 10),
]);
const target = findTarget(state, 'p-far');
assert.equal(target?.kind, 'unit');
assert.equal(target?.kind === 'unit' ? target.unit.id : '', 'e-low', 'nearest target tie-breaks by lower hp');
assert.equal(findTarget(state, 'p-near')?.kind, 'unit');
assert.equal(createAttackAction(state, 'p-near')?.damage, 4);

const hero = createBoardState([unit('p-ranged', 'player', 0, 10, 2)]);
const heroTarget = findTarget(hero, 'p-ranged');
assert.equal(heroTarget?.kind, 'hero');
assert.equal(heroTarget?.kind === 'hero' ? heroTarget.side : '', 'enemy');
assert.equal(findTarget(createBoardState([unit('p-short', 'player', 0, 0, 1)]), 'p-short'), undefined);

const order = actionOrder(createBoardState([
  unit('p2', 'player', 1, 1), unit('p1', 'player', 0, 8), unit('p3', 'player', 0, 2),
]), 'player');
assert.deepEqual(order, ['p1', 'p3', 'p2']);
assert.equal(findTarget(createBoardState([{ ...unit('dead', 'player', 0, 0), hp: 0 }, unit('enemy', 'enemy', 0, 1)]), 'dead'), undefined);

console.log('T023 combat PASS: nearest target, range, hero attack and action order');
