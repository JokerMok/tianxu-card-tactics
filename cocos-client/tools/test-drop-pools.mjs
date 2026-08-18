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

console.log('T208 drop pools PASS: fixed first clear, injected weighted RNG, pity counter and claim limit');
