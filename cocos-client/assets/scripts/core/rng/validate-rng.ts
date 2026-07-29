import assert from 'node:assert/strict';

import {
  cloneRngState,
  createRng,
  nextRandom,
  shuffle,
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

let actual = createRng(20260712);
const expected = createRng(20260712);
for (let index = 0; index < 100; index += 1) {
  const result = nextRandom(actual);
  assert.equal(result.value, referenceNext(expected), `random result ${index} must match React`);
  actual = result.state;
}
assert.equal(actual.rngState, expected.rngState);
assert.equal(actual.rngCursor, 100);

const shuffled = ['A', 'B', 'C', 'D', 'E', 'F'];
const shuffleResult = shuffle(createRng(20260712), shuffled);
const expectedShuffle = ['A', 'B', 'C', 'D', 'E', 'F'];
const referenceShuffleState = createRng(20260712);
for (let index = expectedShuffle.length - 1; index > 0; index -= 1) {
  const swapIndex = Math.floor(referenceNext(referenceShuffleState) * (index + 1));
  [expectedShuffle[index], expectedShuffle[swapIndex]] = [expectedShuffle[swapIndex], expectedShuffle[index]];
}
assert.deepEqual(shuffleResult.values, expectedShuffle);
assert.deepEqual(cloneRngState(shuffleResult.state), shuffleResult.state);
assert.equal(nextRandom(createRng(1)).value === nextRandom(createRng(2)).value, false);

console.log('T019 seeded RNG and shuffle parity PASS: 100 random values and shuffle match React');
