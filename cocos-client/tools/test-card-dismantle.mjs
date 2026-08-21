import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DISMANTLE_MATERIAL_ID,
  DISMANTLE_SCHEMA_VERSION,
  DismantleError,
  DismantleService,
  restoreDismantleService,
} from '../assets/scripts/meta/alchemy/dismantle/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const cardsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const cards = cardsTable.cards.filter((card) => card.enabled !== false);
const cardById = new Map(cards.map((card) => [card.id, card]));
assert(cards.length >= 40, 'dismantle must use the real production cards table');
assert(cardById.has('U001') && cardById.has('U002') && cardById.has('S001'));

const prototypeMaterials = JSON.parse('{"__proto__":7,"constructor":11,"toString":13}');
const prototypeYield = JSON.parse('{"__proto__":1,"constructor":2,"toString":3}');
const singleMaterialDelta = JSON.parse('{"CARD_DUST":2,"__proto__":2,"constructor":4,"toString":6}');
const singleMaterialsAfterCommit = JSON.parse('{"CARD_DUST":2,"__proto__":9,"constructor":15,"toString":19}');
const batchMaterialDelta = JSON.parse('{"CARD_DUST":14,"__proto__":2,"constructor":4,"toString":6}');
const materialYields = {
  1: { ...prototypeYield, [DEFAULT_DISMANTLE_MATERIAL_ID]: 1 },
  2: { [DEFAULT_DISMANTLE_MATERIAL_ID]: 2 },
  3: { [DEFAULT_DISMANTLE_MATERIAL_ID]: 3 },
  4: { [DEFAULT_DISMANTLE_MATERIAL_ID]: 4 },
  5: { [DEFAULT_DISMANTLE_MATERIAL_ID]: 5 },
  6: { [DEFAULT_DISMANTLE_MATERIAL_ID]: 6 },
};

function initialState(cards = [], materials = {}) {
  return {
    schemaVersion: DISMANTLE_SCHEMA_VERSION,
    cards,
    materials,
    processedRequests: [],
  };
}

function entry(cardId, quality, quantity, locked = false, source = 'STARTER') {
  return { cardId, quality, quantity, locked, source };
}

function request(cardId, quality, quantity, source = 'STARTER') {
  return { cardId, quality, quantity, source };
}

function expectCode(label, action, code) {
  assert.throws(action, (error) => {
    assert(error instanceof DismantleError, `${label} must throw DismantleError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}

for (const invalidKey of ['01', '1.0', '1e0', ' 1', '1 ', '+1']) {
  expectCode(`invalid material-yield key ${JSON.stringify(invalidKey)}`, () => new DismantleService({
    metadata: cardsTable,
    materialYields: { ...materialYields, [invalidKey]: { [DEFAULT_DISMANTLE_MATERIAL_ID]: 99 } },
  }), 'INVALID_CONFIG');
}

const prototypeInvalidKeyYields = Object.assign(
  Object.create({ '1.0': { [DEFAULT_DISMANTLE_MATERIAL_ID]: 99 } }),
  materialYields,
);
expectCode('material-yield prototype invalid key', () => new DismantleService({
  metadata: cardsTable,
  materialYields: prototypeInvalidKeyYields,
}), 'INVALID_CONFIG');

const prototypeCompletesMissingQualityYields = Object.assign(
  Object.create({ 6: materialYields[6] }),
  materialYields,
);
delete prototypeCompletesMissingQualityYields[6];
expectCode('material-yield prototype completes missing quality 6', () => new DismantleService({
  metadata: cardsTable,
  materialYields: prototypeCompletesMissingQualityYields,
}), 'INVALID_CONFIG');

const nonEnumerableInvalidKeyYields = { ...materialYields };
Object.defineProperty(nonEnumerableInvalidKeyYields, '1.0', {
  configurable: true,
  value: { [DEFAULT_DISMANTLE_MATERIAL_ID]: 99 },
});
expectCode('material-yield non-enumerable invalid key', () => new DismantleService({
  metadata: cardsTable,
  materialYields: nonEnumerableInvalidKeyYields,
}), 'INVALID_CONFIG');

const symbolInvalidKeyYields = { ...materialYields };
Object.defineProperty(symbolInvalidKeyYields, Symbol('invalid-quality'), {
  configurable: true,
  value: { [DEFAULT_DISMANTLE_MATERIAL_ID]: 99 },
});
expectCode('material-yield Symbol key', () => new DismantleService({
  metadata: cardsTable,
  materialYields: symbolInvalidKeyYields,
}), 'INVALID_CONFIG');

const saved = [];
const service = new DismantleService({
  metadata: cardsTable,
  state: initialState([
    entry('U001', 1, 3),
    entry('U001', 2, 1, true),
    entry('U002', 6, 2),
    entry('S001', 3, 1),
  ], prototypeMaterials),
  materialYields,
  persist: (serialized) => saved.push(serialized),
});

assert.deepEqual(service.snapshot().cards, [
  entry('U001', 1, 3),
  entry('U001', 2, 1, true),
  entry('U002', 6, 2),
  entry('S001', 3, 1),
]);
assert.equal(Object.prototype.hasOwnProperty.call(service.snapshot().materials, '__proto__'), true);
assert.equal(service.snapshot().materials.__proto__, 7, 'prototype-looking material IDs must remain data');
assert.equal(service.snapshot().materials.constructor, 11);
assert.equal(service.snapshot().materials.toString, 13);

const single = service.dismantle('single-1', request('U001', 1, 2));
assert.deepEqual(single, {
  requestId: 'single-1',
  applied: true,
  idempotent: false,
  removedCards: [entry('U001', 1, 2)],
  materials: singleMaterialDelta,
});
assert.equal(service.snapshot().cards.find((card) => cardKey(card) === cardKey(entry('U001', 1, 1))).quantity, 1);
assert.deepEqual(service.snapshot().materials, singleMaterialsAfterCommit);
assert.equal(saved.length, 1, 'a successful single dismantle must persist exactly once');
assert(Object.isFrozen(service.snapshot()), 'production snapshots must be immutable');

const unchangedAfterSingle = service.save();
expectCode('locked card', () => service.dismantle('locked-1', request('U001', 2, 1)), 'CARD_LOCKED');
expectCode('unowned card', () => service.dismantle('unowned-1', request('U003', 1, 1)), 'CARD_NOT_OWNED');
expectCode('insufficient quantity', () => service.dismantle('short-1', request('U001', 1, 2)), 'INSUFFICIENT_QUANTITY');
assert.equal(service.save(), unchangedAfterSingle, 'rejected single requests must not mutate state');
assert.equal(saved.length, 1, 'rejected single requests must not persist');

const batchFailure = new DismantleService({
  metadata: cardsTable,
  state: initialState([entry('U001', 1, 2), entry('U002', 1, 1)]),
  materialYields,
  persist: () => { throw new Error('disk full'); },
});
const batchBeforePersistenceFailure = batchFailure.save();
expectCode('batch persistence failure', () => batchFailure.dismantleBatch('batch-persist-fail', [
  request('U001', 1, 1),
  request('U002', 1, 1),
]), 'PERSISTENCE_FAILED');
assert.equal(batchFailure.save(), batchBeforePersistenceFailure, 'persist failure must roll back the whole batch');

const midBatch = new DismantleService({
  metadata: cardsTable,
  state: initialState([entry('U001', 1, 2), entry('U002', 1, 1)]),
  materialYields,
});
const midBatchBefore = midBatch.save();
expectCode('batch mid-request failure', () => midBatch.dismantleBatch('batch-mid-fail', [
  request('U001', 1, 1),
  request('U003', 1, 1),
]), 'CARD_NOT_OWNED');
assert.equal(midBatch.save(), midBatchBefore, 'a mid-batch validation failure must roll back every earlier request');

const batchSaves = [];
const batch = new DismantleService({
  metadata: cardsTable,
  state: initialState([entry('U001', 1, 3), entry('U002', 6, 2)]),
  materialYields,
  persist: (serialized) => batchSaves.push(serialized),
});
const batchResult = batch.dismantleBatch('batch-ok', [
  request('U001', 1, 1),
  request('U002', 6, 2),
  request('U001', 1, 1),
]);
assert.deepEqual(batchResult.removedCards, [entry('U001', 1, 2), entry('U002', 6, 2)]);
assert.deepEqual(batchResult.materials, batchMaterialDelta);
assert.deepEqual(batch.snapshot().cards, [entry('U001', 1, 1)]);
assert.equal(batchSaves.length, 1, 'a successful batch must use one atomic persistence call');

const duplicateBefore = batch.save();
const duplicate = batch.dismantleBatch('batch-ok', [
  request('U002', 6, 2),
  request('U001', 1, 1),
  request('U001', 1, 1),
]);
assert.deepEqual(duplicate, { ...batchResult, applied: false, idempotent: true });
assert.equal(batch.save(), duplicateBefore, 'duplicate request must not apply material or card changes');
assert.equal(batchSaves.length, 1, 'duplicate request must not persist again');
expectCode('same request ID with changed payload', () => batch.dismantle('batch-ok', request('U001', 1, 1)), 'REQUEST_CONFLICT');

let failPersistence = true;
const persistenceRollback = new DismantleService({
  metadata: cardsTable,
  state: initialState([entry('S001', 3, 2)]),
  materialYields,
  persist: () => { if (failPersistence) throw new Error('write failed'); },
});
const persistenceBefore = persistenceRollback.save();
expectCode('single persist failure', () => persistenceRollback.dismantle('persist-1', request('S001', 3, 1)), 'PERSISTENCE_FAILED');
assert.equal(persistenceRollback.save(), persistenceBefore, 'persist failure must leave the service state unchanged');
failPersistence = false;
assert.equal(persistenceRollback.dismantle('persist-1', request('S001', 3, 1)).applied, true);

const defaultYield = new DismantleService({
  metadata: cardsTable,
  state: initialState([entry('U002', 6, 1)]),
});
assert.deepEqual(defaultYield.dismantle('default-yield', request('U002', 6, 1)).materials, { CARD_DUST: 13 });

const maxSafe = Number.MAX_SAFE_INTEGER;
const boundary = new DismantleService({
  metadata: cardsTable,
  state: initialState([entry('U001', 1, 2)], { CARD_DUST: maxSafe - 1 }),
  materialYields,
});
boundary.dismantle('max-safe', request('U001', 1, 1));
assert.equal(boundary.snapshot().materials.CARD_DUST, maxSafe, 'exact safe-integer material boundary must be accepted');
expectCode('material overflow', () => boundary.dismantle('overflow', request('U001', 1, 1)), 'MATERIAL_OVERFLOW');
assert.equal(boundary.snapshot().cards.find((card) => card.cardId === 'U001').quantity, 1, 'overflow must not consume the card');

const serialized = batch.save();
const restored = restoreDismantleService(cardsTable, serialized, { materialYields });
assert.deepEqual(restored.snapshot(), batch.snapshot(), 'serialization recovery must preserve cards, materials and idempotency records');
assert.equal(restored.save(), serialized, 'serialization must be deterministic after recovery');
const restoredDuplicate = restored.dismantleBatch('batch-ok', [request('U002', 6, 2), request('U001', 1, 1), request('U001', 1, 1)]);
assert.equal(restoredDuplicate.idempotent, true, 'restored idempotency record must prevent duplicate dismantling');

function cardKey(card) {
  return JSON.stringify([card.cardId, card.quality, card.source]);
}

console.log(`T228 card dismantle PASS: real-cards=${cards.length}, atomic-batches, locked/unowned/quantity guards, idempotency, persistence-rollback, safe-integer-materials, prototype-keys, save-restore`);
