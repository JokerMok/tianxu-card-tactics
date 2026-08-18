import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DropRewardService } from '../assets/scripts/services/reward/drops/DropRewardService.ts';

const root = path.resolve(import.meta.dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/drops/drop-pools.json'), 'utf8'));
const [pool] = config.pools;

function initialState() {
  return {
    resources: { gold: 0, essence: 0 },
    processedRewardKeys: [],
    dropPools: {
      [pool.id]: { claims: 0, firstClearClaimed: false, rareMisses: 0 },
    },
  };
}

const saved = [];
let rolls = 0;
const service = new DropRewardService(
  initialState(),
  config.pools,
  () => {
    rolls += 1;
    return 0;
  },
  (next) => saved.push(next),
);

const first = service.claim('drop:stage:N001:1', pool.id);
assert.equal(first.code, 'APPLIED');
assert.equal(first.applied, true);
assert.equal(rolls, 0, 'first clear is fixed');
assert.equal(saved.length, 1);
assert.deepEqual(service.snapshot(), {
  resources: { gold: 100, essence: 0 },
  processedRewardKeys: ['drop:stage:N001:1'],
  dropPools: { [pool.id]: { claims: 1, firstClearClaimed: true, rareMisses: 0 } },
});

const duplicate = service.claim('drop:stage:N001:1', pool.id);
assert.equal(duplicate.code, 'DUPLICATE');
assert.equal(duplicate.applied, false);
assert.equal(rolls, 0, 'duplicate key must not roll or grant again');
assert.equal(saved.length, 1, 'duplicate key must not persist again');

assert.equal(service.claim('drop:stage:N001:2', pool.id).code, 'APPLIED');
assert.equal(service.claim('drop:stage:N001:3', pool.id).code, 'APPLIED');
assert.equal(service.claim('drop:stage:N001:4', pool.id).code, 'APPLIED');
assert.equal(rolls, 2, 'pity grant must not roll RNG');
assert.deepEqual(service.snapshot().resources, { gold: 120, essence: 1 });
assert.equal(service.claim('drop:stage:N001:5', pool.id).code, 'LIMIT_REACHED');
assert.equal(saved.length, 4, 'claim-limit rejection must not persist');
assert.equal(rolls, 2, 'claim-limit rejection must not roll RNG');

let failSave = true;
let saveAttempts = 0;
const rollback = new DropRewardService(
  initialState(),
  config.pools,
  () => 0,
  () => {
    saveAttempts += 1;
    if (failSave) throw new Error('disk full');
  },
);
assert.throws(() => rollback.claim('drop:stage:N001:rollback', pool.id), /disk full/);
assert.equal(saveAttempts, 1);
assert.deepEqual(rollback.snapshot(), initialState(), 'failed persistence must roll back resources, keys and counters');

failSave = false;
assert.equal(rollback.claim('drop:stage:N001:rollback', pool.id).code, 'APPLIED');
assert.equal(saveAttempts, 2);
assert.deepEqual(rollback.snapshot().resources, { gold: 100, essence: 0 });
assert.deepEqual(rollback.snapshot().processedRewardKeys, ['drop:stage:N001:rollback']);

console.log('T208 reward service PASS: idempotency, single-persist atomicity and rollback');
