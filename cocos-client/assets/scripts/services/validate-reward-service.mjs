import assert from 'node:assert/strict';
import { RewardService } from './RewardService.ts';

const saved = [];
const service = new RewardService(
  { resources: { gold: 10, essence: 2 }, processedRewardKeys: [] },
  (next) => saved.push(next),
);

const first = service.grant('stage:N001:first', { gold: 90, essence: 3 });
assert.equal(first.applied, true);
assert.deepEqual(service.snapshot(), {
  resources: { gold: 100, essence: 5 },
  processedRewardKeys: ['stage:N001:first'],
});
assert.equal(saved.length, 1);
assert.deepEqual(saved[0], service.snapshot());

const duplicate = service.grant('stage:N001:first', { gold: 90, essence: 3 });
assert.equal(duplicate.applied, false);
assert.equal(saved.length, 1);
assert.deepEqual(service.snapshot().resources, { gold: 100, essence: 5 });

const reloadedSaves = [];
const reloaded = new RewardService(saved[0], (next) => reloadedSaves.push(next));
assert.equal(reloaded.grant('stage:N001:first', { gold: 1 }).applied, false);
assert.equal(reloadedSaves.length, 0);
assert.deepEqual(reloaded.snapshot().resources, { gold: 100, essence: 5 });
assert.throws(() => reloaded.grant('stage:N002:first', { silver: 1 }), /unknown reward resource/);
assert.equal(reloadedSaves.length, 0);
assert.deepEqual(reloaded.snapshot().processedRewardKeys, ['stage:N001:first']);

let failSave = true;
let saveAttempts = 0;
const rollback = new RewardService(
  { resources: { gold: 7, essence: 4 }, processedRewardKeys: [] },
  () => {
    saveAttempts += 1;
    if (failSave) throw new Error('disk full');
  },
);
assert.throws(() => rollback.grant('mail:M001', { gold: 5, essence: 6 }), /disk full/);
assert.equal(saveAttempts, 1);
assert.deepEqual(rollback.snapshot(), {
  resources: { gold: 7, essence: 4 },
  processedRewardKeys: [],
});

failSave = false;
assert.equal(rollback.grant('mail:M001', { gold: 5, essence: 6 }).applied, true);
assert.equal(saveAttempts, 2);
assert.deepEqual(rollback.snapshot(), {
  resources: { gold: 12, essence: 10 },
  processedRewardKeys: ['mail:M001'],
});

console.log('T017 reward service PASS: atomic multi-resource save, idempotency and rollback');
