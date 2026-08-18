import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { assertDropPoolConfig, resolveDrop } from '../assets/scripts/services/reward/drops/DropPoolService.ts';

const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/drops/drop-pools.json'), 'utf8'));

assert.equal(config.fixtureOnly, true, 'drop values are test fixtures, not economy tuning');
assertDropPoolConfig(config);

const [pool] = config.pools;
const initial = { claims: 0, firstClearClaimed: false, rareMisses: 0 };
const first = resolveDrop(pool, initial, () => {
  throw new Error('first clear must not roll RNG');
});
assert.equal(first.code, 'GRANTED');
assert.equal(first.source, 'FIRST_CLEAR');
assert.deepEqual(first.reward.rewards, { gold: 100 });
assert.deepEqual(initial, { claims: 0, firstClearClaimed: false, rareMisses: 0 }, 'resolution must be pure');

const weightedRare = resolveDrop(pool, first.nextState, () => 0.99);
assert.equal(weightedRare.code, 'GRANTED');
assert.equal(weightedRare.source, 'WEIGHTED');
assert.equal(weightedRare.reward.id, 'stage-n001-rare-essence');
assert.deepEqual(weightedRare.reward.rewards, { essence: 1 });
assert.equal(weightedRare.nextState.rareMisses, 0, 'natural rare draw resets pity');

const repeatedOne = resolveDrop(pool, first.nextState, () => 0);
const repeatedTwo = resolveDrop(pool, repeatedOne.nextState, () => 0);
assert.equal(repeatedOne.reward.id, 'stage-n001-gold');
assert.equal(repeatedTwo.reward.id, 'stage-n001-gold');
assert.equal(repeatedTwo.nextState.rareMisses, 2);

const guaranteedRare = resolveDrop(pool, repeatedTwo.nextState, () => {
  throw new Error('pity reward must not consume RNG');
});
assert.equal(guaranteedRare.code, 'GRANTED');
assert.equal(guaranteedRare.source, 'PITY');
assert.equal(guaranteedRare.reward.id, 'stage-n001-rare-essence');
assert.equal(guaranteedRare.nextState.rareMisses, 0);

const limited = resolveDrop(pool, guaranteedRare.nextState, () => {
  throw new Error('claim limit must not consume RNG');
});
assert.equal(limited.code, 'LIMIT_REACHED');
assert.deepEqual(limited.nextState, guaranteedRare.nextState);

assert.throws(
  () => resolveDrop(pool, { claims: 0, firstClearClaimed: true, rareMisses: 0 }, () => 0),
  /first clear/i,
  'a first-clear flag requires at least one claim',
);

const poolWithoutPity = { ...pool, pity: undefined };
const noPityFirst = resolveDrop(poolWithoutPity, initial, () => {
  throw new Error('first clear must not roll RNG');
});
const noPityRepeatOne = resolveDrop(poolWithoutPity, noPityFirst.nextState, () => 0);
const noPityRepeatTwo = resolveDrop(poolWithoutPity, noPityRepeatOne.nextState, () => 0);
assert.equal(noPityRepeatOne.code, 'GRANTED');
assert.equal(noPityRepeatTwo.code, 'GRANTED', 'a no-pity pool must allow the second repeat claim');
assert.equal(noPityRepeatOne.nextState.rareMisses, 0);
assert.equal(noPityRepeatTwo.nextState.rareMisses, 0);

assert.throws(
  () => resolveDrop(poolWithoutPity, { claims: 1, firstClearClaimed: true, rareMisses: 1 }, () => 0),
  /pity/i,
  'rare misses require a pool with a pity rule',
);

assert.throws(
  () => resolveDrop(pool, { claims: 1, firstClearClaimed: true, rareMisses: 1 }, () => 0),
  /rareMisses/i,
  'rare misses cannot exceed the number of repeat claims',
);

assert.throws(
  () => resolveDrop(pool, { claims: 1, firstClearClaimed: true, rareMisses: Number.MAX_SAFE_INTEGER }, () => 0),
  /rareMisses/i,
  'a rare-miss increment must be rejected before it overflows',
);

console.log('T208 drop pools PASS: fixed first clear, injected weighted RNG, pity counter and claim limit');
