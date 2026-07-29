import assert from 'node:assert/strict';
import { createCardState, decrementPreparation, endCardTurn } from './index.ts';

const deck = Array.from({ length: 30 }, (_, index) => `C${String(index + 1).padStart(3, '0')}`);
const prepareByCardId = Object.fromEntries(deck.map((id, index) => [id, (index % 4) + 1]));
const state = createCardState({ seed: 20260712, decks: { player: deck, enemy: deck }, prepareByCardId });

assert.equal(state.hands.player.length, 5);
assert.equal(state.hands.enemy.length, 5);
assert.equal(state.decks.player.length, 25);
assert.equal(state.decks.enemy.length, 25);
assert.equal(new Set([...state.hands.player, ...state.hands.enemy].map((card) => card.instanceId)).size, 10);

let ready = state;
for (let index = 0; index < 5; index += 1) ready = decrementPreparation(ready, 'player');
assert(ready.hands.player.every((card) => card.remainingPreparation === 0));
const refilled = endCardTurn(ready, 'player');
assert.equal(refilled.hands.player.length, 6);
assert(refilled.hands.player.slice(0, 5).every((card) => card.remainingPreparation >= 0));
assert.equal(refilled.nextId, state.nextId + 1);
assert.deepEqual(state.hands.player, state.hands.player, 'card state updates must be immutable');
assert.deepEqual(createCardState({ seed: 20260712, decks: { player: deck, enemy: deck }, prepareByCardId }), state);
assert.notDeepEqual(createCardState({ seed: 20260713, decks: { player: deck, enemy: deck }, prepareByCardId }).decks, state.decks);

console.log('T020 cards PASS: 30-card decks, 5-card opening hands, preparation decrement and refill');
