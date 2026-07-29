import assert from 'node:assert/strict';
import { createBoardState } from '../board/index.ts';
import { resolveTargets } from './index.ts';
import type { Unit } from '../types/index.ts';

function unit(id: string, side: 'player' | 'enemy', lane: number, cell: number, hp = 10): Unit {
  return { id, cardId: id, name: id, side, lane, cell, hp, maxHp: 10, attack: 1, armor: 0, move: 1,
    range: 1, role: 'guard', tags: [], statuses: [], actionsTaken: 0, spawnRound: 1 };
}

const state = createBoardState([
  unit('source', 'player', 0, 0), unit('ally-a', 'player', 0, 1), unit('ally-b', 'player', 1, 1),
  unit('enemy-a', 'enemy', 0, 2), unit('enemy-b', 'enemy', 1, 2), unit('enemy-dead', 'enemy', 0, 3, 0),
]);
assert.deepEqual(resolveTargets(state, 'source', { type: 'single', unitId: 'enemy-a' }).map((u) => u.id), ['enemy-a']);
assert.deepEqual(resolveTargets(state, 'source', { type: 'single', unitId: 'ally-a', relation: 'enemy' }), []);
assert.deepEqual(resolveTargets(state, 'source', { type: 'lane', lane: 0 }).map((u) => u.id), ['enemy-a']);
assert.deepEqual(resolveTargets(state, 'source', { type: 'lane', lane: 0, relation: 'friendly' }).map((u) => u.id), ['ally-a']);
assert.deepEqual(resolveTargets(state, 'source', { type: 'rectangle', lane: 0, cell: 2, laneRadius: 1, cellRadius: 1 }).map((u) => u.id), ['enemy-a', 'enemy-b']);
assert.deepEqual(resolveTargets(state, 'source', { type: 'adjacent', unitId: 'ally-a', relation: 'friendly' }).map((u) => u.id), ['ally-b']);
assert.deepEqual(resolveTargets(state, 'source', { type: 'global', relation: 'enemy' }).map((u) => u.id), ['enemy-a', 'enemy-b']);
assert.deepEqual(resolveTargets(state, 'source', { type: 'global', relation: 'enemy', includeDead: true }).map((u) => u.id), ['enemy-a', 'enemy-dead', 'enemy-b']);
assert.deepEqual(resolveTargets(state, 'source', { type: 'lane', lane: 9 }), []);
assert.deepEqual(resolveTargets(state, 'missing', { type: 'global' }), []);

console.log('T027 targeting PASS: single, lane, rectangle, adjacent, global and relation filters');
