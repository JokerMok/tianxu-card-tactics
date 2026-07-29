import assert from 'node:assert/strict';
import { createBoardState, deployUnit, getLegalDeploymentCells, isSummonCell, type BoardState } from './index.ts';
import type { Unit } from '../types/index.ts';

function unit(id: string, side: 'player' | 'enemy', lane: number, cell: number): Unit {
  return {
    id, cardId: `U${id}`, name: id, side, lane, cell, hp: 10, maxHp: 10, attack: 1, armor: 0,
    move: 1, range: 1, role: 'guard', tags: [], statuses: [], actionsTaken: 0, spawnRound: 1,
  };
}

const empty = createBoardState();
assert.equal(empty.laneCount, 2);
assert.equal(empty.cellsPerLane, 12);
assert.equal(getLegalDeploymentCells(empty, 'player').length, 6);
assert.equal(getLegalDeploymentCells(empty, 'enemy').length, 6);
assert(isSummonCell('player', 0, 0));
assert(isSummonCell('player', 1, 2));
assert(isSummonCell('enemy', 0, 11));
assert(!isSummonCell('player', 0, 3));
assert(!isSummonCell('enemy', 0, 8));
assert(!isSummonCell('player', -1, 0));
assert(!isSummonCell('player', 2, 0));
assert(!isSummonCell('spectator' as 'player', 0, 11));

const deployed = deployUnit(empty, unit('p1', 'player', 0, 0));
assert.equal(deployed.units.length, 1);
assert.equal(empty.units.length, 0);
assert.equal(getLegalDeploymentCells(deployed, 'player').length, 5);
assert.throws(() => deployUnit(deployed, unit('p2', 'player', 0, 0)), /occupied/);
assert.throws(() => deployUnit(empty, unit('bad', 'player', 0, 3)), /invalid/);
assert.throws(() => deployUnit(empty, unit('bad-side', 'spectator' as 'player', 0, 11)), /invalid/);
assert.throws(() => deployUnit(deployed, unit('p1', 'player', 0, 1)), /already exists/);

const dead = deployUnit(empty, unit('dead', 'player', 0, 0));
const deadBoard: BoardState = { ...dead, units: [{ ...dead.units[0], hp: 0 }] };
assert.equal(getLegalDeploymentCells(deadBoard, 'player').length, 6, 'dead units do not block a cell');

console.log('T021 board PASS: 2x12 board, 2x3 summon zones, occupancy and boundary rejection');
