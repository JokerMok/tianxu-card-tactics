import assert from 'node:assert/strict';

import {
  chooseSeeded,
  cloneRngState,
  createRng,
  nextRandom,
  shuffleInPlace,
} from './index.ts';

function referenceNext(state: { rngState: number; rngCursor: number }): number {
  let value = state.rngState | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = value | 0;
  state.rngCursor += 1;
  return (value >>> 0) / 4294967296;
}

const actual = createRng(20260712);
const expected = createRng(20260712);
for (let index = 0; index < 100; index += 1) {
  assert.equal(nextRandom(actual), referenceNext(expected), `random result ${index} must match React`);
}
assert.equal(actual.rngState, expected.rngState);
assert.equal(actual.rngCursor, 100);

const shuffled = ['A', 'B', 'C', 'D', 'E', 'F'];
const shuffleState = createRng(20260712);
shuffleInPlace(shuffleState, shuffled);
const expectedShuffle = ['A', 'B', 'C', 'D', 'E', 'F'];
const referenceShuffleState = createRng(20260712);
for (let index = expectedShuffle.length - 1; index > 0; index -= 1) {
  const swapIndex = Math.floor(referenceNext(referenceShuffleState) * (index + 1));
  [expectedShuffle[index], expectedShuffle[swapIndex]] = [expectedShuffle[swapIndex], expectedShuffle[index]];
}
assert.deepEqual(shuffled, expectedShuffle);
assert.deepEqual(cloneRngState(shuffleState), shuffleState);
assert.equal(chooseSeeded(createRng(1), []), undefined);
assert.notEqual(nextRandom(createRng(1)), nextRandom(createRng(2)));

console.log('T019 seeded RNG and shuffle parity PASS: 100 random values and shuffle match React');
