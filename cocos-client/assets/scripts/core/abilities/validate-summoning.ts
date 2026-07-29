import assert from 'node:assert/strict';
import { createBoardState } from '../board/index.ts';
import { createSummonState, killUnit, reclaimGraveyard, reviveUnit, summonUnit } from './summoning.ts';
import type { Unit } from '../types/index.ts';

function unit(id: string, side: 'player' | 'enemy', cell: number, hp = 10): Unit {
  return { id, cardId: `CARD-${id}`, name: id, side, lane: 0, cell, hp, maxHp: 10, attack: 1, armor: 0,
    move: 1, range: 1, role: 'guard', tags: [], statuses: [], actionsTaken: 0, spawnRound: 1 };
}

let state = createSummonState(createBoardState(), { player: 1, enemy: 1 });
state = summonUnit(state, unit('p1', 'player', 0));
assert.throws(() => summonUnit(state, unit('p2', 'player', 1)), /limit/);
assert.throws(() => summonUnit(state, unit('e1', 'enemy', 8)), /invalid/);
const killed = killUnit(state, 'p1');
assert.equal(killed.board.units.length, 0);
assert.equal(killed.graveyard.player.length, 1);
assert.equal(state.board.units.length, 1, 'kill must not mutate previous state');
const revived = reviveUnit(killed, 'p1', 0, 1);
assert.equal(revived.board.units[0].hp, 10);
assert.equal(revived.graveyard.player.length, 0);
const reclaimed = reclaimGraveyard(killed, 'p1');
assert.equal(reclaimed.cardId, 'CARD-p1');
assert.equal(reclaimed.state.graveyard.player.length, 0);
assert.strictEqual(reclaimGraveyard(state, 'missing').state, state);
assert.throws(() => reviveUnit(killed, 'p1', 0, 12), /invalid/);

console.log('T029 summoning PASS: limits, ownership, death, resurrection, reclaim and immutable state');
