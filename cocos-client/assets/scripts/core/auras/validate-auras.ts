import assert from 'node:assert/strict';
import { createBoardState } from '../board/index.ts';
import { addAura, createAuraState, effectiveUnit, refreshAuras, removeAura } from './index.ts';
import type { Unit } from '../types/index.ts';

function unit(id: string, side: 'player' | 'enemy', lane: number, cell: number, hp = 10): Unit {
  return { id, cardId: id, name: id, side, lane, cell, hp, maxHp: 10, attack: 3, armor: 1, move: 1, range: 1,
    role: 'guard', tags: [], statuses: [], actionsTaken: 0, spawnRound: 1 };
}

const board = createBoardState([unit('source', 'player', 0, 0), unit('ally-in', 'player', 0, 2), unit('ally-out', 'player', 0, 5), unit('enemy', 'enemy', 0, 1)]);
let state = createAuraState(board);
state = addAura(state, { id: 'a1', sourceId: 'source', shape: 'radius', radius: 2, relation: 'friendly', stat: 'attack', value: 2 });
assert.equal(effectiveUnit(state, 'ally-in')?.attack, 5);
assert.equal(effectiveUnit(state, 'ally-out')?.attack, 3);
assert.equal(effectiveUnit(state, 'enemy')?.attack, 3);
state = addAura(state, { id: 'a2', sourceId: 'source', shape: 'global', relation: 'friendly', stat: 'armor', value: 1 });
assert.equal(effectiveUnit(state, 'ally-in')?.armor, 2, 'multiple auras stack');
const movedBoard = { ...state.board, units: state.board.units.map((u) => u.id === 'ally-in' ? { ...u, cell: 5 } : u) };
state = refreshAuras({ ...state, board: movedBoard });
assert.equal(effectiveUnit(state, 'ally-in')?.attack, 3, 'leaving range removes aura');
const deadSource = { ...state.board, units: state.board.units.map((u) => u.id === 'source' ? { ...u, hp: 0 } : u) };
state = refreshAuras({ ...state, board: deadSource });
assert.equal(effectiveUnit(state, 'ally-out')?.armor, 1, 'dead source leaves no residual');
state = removeAura(state, 'a1');
assert.equal(state.auras.length, 1);
assert.throws(() => addAura(state, { id: 'a2', sourceId: 'source', shape: 'global', stat: 'attack', value: 1 }), /already/);
assert.deepEqual(board.units, [board.units[0], board.units[1], board.units[2], board.units[3]], 'refresh is immutable');

console.log('T030 auras PASS: enter/leave, stacking, death refresh and no residual modifiers');
