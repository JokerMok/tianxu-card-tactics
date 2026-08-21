import assert from 'node:assert/strict';
import {
  EQUIPMENT_INVENTORY_SCHEMA_VERSION,
  EQUIPMENT_PRIMARY_ATTRIBUTES,
  EQUIPMENT_QUALITY_LEVELS,
  EQUIPMENT_SLOTS,
  EquipmentInventoryError,
  EquipmentInventoryService,
  restoreEquipmentInventory,
} from '../assets/scripts/meta/equipment/index.ts';

assert.deepEqual(EQUIPMENT_SLOTS, ['weapon', 'helmet', 'armor', 'cloak'], 'production equipment must expose exactly four slots');
assert.deepEqual(EQUIPMENT_QUALITY_LEVELS, [1, 2, 3, 4], 'equipment quality must have four ordered levels');
assert(EQUIPMENT_PRIMARY_ATTRIBUTES.includes('attack'));
assert(EQUIPMENT_PRIMARY_ATTRIBUTES.includes('health'));

function item(equipmentId, slot, quality, primaryAttribute, primaryValue, locked = false) {
  return { equipmentId, slot, quality, primaryAttribute, primaryValue, locked };
}

function initialState(capacity, items = [], equipped = { weapon: null, helmet: null, armor: null, cloak: null }, sort = { field: 'equipmentId', direction: 'asc' }, processedRequests = []) {
  return { schemaVersion: EQUIPMENT_INVENTORY_SCHEMA_VERSION, capacity, items, equipped, sort, processedRequests };
}

function expectCode(label, action, code) {
  assert.throws(action, (error) => {
    assert(error instanceof EquipmentInventoryError, `${label} must throw EquipmentInventoryError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}

function assertDeepFrozen(value, label = 'value', seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert(Object.isFrozen(value), `${label} must be deeply frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${label}.${key}`, seen);
}

const saved = [];
const service = new EquipmentInventoryService({
  capacity: 8,
  persist: (serialized) => saved.push(serialized),
  state: initialState(8, [
    item('__proto__', 'weapon', 4, 'attack', 40),
    item('constructor', 'helmet', 2, 'health', 20),
    item('toString', 'armor', 3, 'armor', 30, true),
  ]),
});

assert.deepEqual(service.list(), [
  item('__proto__', 'weapon', 4, 'attack', 40),
  item('constructor', 'helmet', 2, 'health', 20),
  item('toString', 'armor', 3, 'armor', 30, true),
], 'prototype-looking equipment IDs must remain ordinary data');
assert.equal(Object.prototype.polluted, undefined, 'prototype-looking IDs must not pollute Object.prototype');
assert.equal(service.get('__proto__').primaryValue, 40);
assert.equal(service.get('constructor').slot, 'helmet');
assert.equal(service.get('toString').locked, true);

const source = item('E001', 'weapon', 1, 'attack', 10);
const returned = service.add(source);
source.primaryValue = 999;
source.locked = true;
assert.deepEqual(returned, item('E001', 'weapon', 1, 'attack', 10), 'add must return an isolated copy');
assert.deepEqual(service.get('E001'), item('E001', 'weapon', 1, 'attack', 10), 'input mutation must not leak into state');

for (const [id, slot, quality, attribute] of [
  ['E002', 'helmet', 2, 'health'],
  ['E003', 'armor', 3, 'armor'],
  ['E004', 'cloak', 4, 'energy'],
]) service.add(item(id, slot, quality, attribute, quality * 10));
assert.equal(service.snapshot().items.length, 7, 'capacity must count only un-equipped equipment');
expectCode('duplicate equipment', () => service.add(item('E001', 'weapon', 1, 'attack', 10)), 'DUPLICATE_EQUIPMENT');

const beforeCapacity = service.save();
service.add(item('E005', 'weapon', 1, 'attack', 11));
assert.equal(service.snapshot().items.length, 8);
expectCode('capacity boundary', () => service.add(item('E006', 'cloak', 1, 'draw', 12)), 'CAPACITY_EXCEEDED');
assert.equal(service.save(), service.save(), 'capacity rejection must leave deterministic state');
assert.notEqual(service.save(), beforeCapacity, 'the exact capacity boundary must be accepted');

service.setSort({ field: 'quality', direction: 'asc' });
assert.deepEqual(service.query().map(({ equipmentId }) => equipmentId), [
  'E001', 'E005', 'constructor', 'E002', 'toString', 'E003', '__proto__', 'E004',
], 'quality sorting must be deterministic');
const stable = new EquipmentInventoryService({ capacity: 4 });
stable.add(item('B', 'weapon', 2, 'attack', 10));
stable.add(item('A', 'weapon', 2, 'health', 10));
stable.add(item('C', 'weapon', 1, 'armor', 10));
stable.setSort({ field: 'primaryValue', direction: 'asc' });
assert.deepEqual(stable.query().map(({ equipmentId }) => equipmentId), ['B', 'A', 'C'], 'equal sort values must preserve insertion order');

expectCode('invalid slot', () => service.add(item('bad-slot', 'ring', 1, 'attack', 1)), 'INVALID_SLOT');
expectCode('invalid quality', () => service.add(item('bad-quality', 'weapon', 5, 'attack', 1)), 'INVALID_QUALITY');
expectCode('invalid primary attribute', () => service.add(item('bad-attribute', 'weapon', 1, 'mana', 1)), 'INVALID_PRIMARY_ATTRIBUTE');
expectCode('invalid primary value', () => service.add(item('bad-value', 'weapon', 1, 'attack', 0)), 'INVALID_PRIMARY_VALUE');
expectCode('invalid slot state', () => new EquipmentInventoryService({ state: initialState(2, [], { weapon: item('E1', 'helmet', 1, 'attack', 1), helmet: null, armor: null, cloak: null }) }), 'INVALID_STATE');
expectCode('invalid sort', () => service.setSort({ field: 'random', direction: 'asc' }), 'INVALID_SORT');

service.setLocked('E001', true);
const beforeLockedSale = service.save();
expectCode('locked equipment cannot sell', () => service.sell('locked-1', 'E001'), 'EQUIPMENT_LOCKED');
assert.equal(service.save(), beforeLockedSale);
service.unlock('E001');

const beforeMidBatch = service.save();
const savesBeforeMidBatch = saved.length;
expectCode('mid-batch sale rolls back', () => service.sellBatch('batch-mid', ['E001', '__missing__', 'E002']), 'EQUIPMENT_NOT_FOUND');
assert.equal(service.save(), beforeMidBatch, 'a failed sale must roll back every earlier removal');
assert.equal(saved.length, savesBeforeMidBatch, 'a failed batch must not persist');

const batchResult = service.sellBatch('batch-ok', ['E001', 'E002', 'E001'].slice(0, 2));
assert.equal(batchResult.applied, true);
assert.equal(batchResult.idempotent, false);
assert.deepEqual(batchResult.sold.map(({ equipmentId }) => equipmentId), ['E001', 'E002']);
const afterBatch = service.save();
const saveCountAfterBatch = saved.length;
const duplicateBatch = service.sellBatch('batch-ok', ['E002', 'E001']);
assert.deepEqual(duplicateBatch, { ...batchResult, applied: false, idempotent: true }, 'repeated sale must be idempotent');
assert.equal(service.save(), afterBatch);
assert.equal(saved.length, saveCountAfterBatch, 'idempotent sale must not persist again');
expectCode('changed idempotent payload', () => service.sellBatch('batch-ok', ['E003']), 'REQUEST_CONFLICT');
expectCode('duplicate IDs in batch', () => service.sellBatch('batch-duplicate', ['E003', 'E003']), 'DUPLICATE_EQUIPMENT');

const equipService = new EquipmentInventoryService({
  capacity: 4,
  persist: (serialized) => saved.push(serialized),
  state: initialState(4, [
    item('W1', 'weapon', 1, 'attack', 10),
    item('W2', 'weapon', 2, 'spellPower', 20),
    item('H1', 'helmet', 3, 'health', 30),
  ]),
});
const equipSaves = saved.length;
assert.deepEqual(equipService.equip('W1'), item('W1', 'weapon', 1, 'attack', 10));
assert.equal(equipService.snapshot().equipped.weapon.equipmentId, 'W1');
assert.equal(equipService.snapshot().items.some(({ equipmentId }) => equipmentId === 'W1'), false);
assert.equal(saved.length, equipSaves + 1);
assert.deepEqual(equipService.equip('W1'), item('W1', 'weapon', 1, 'attack', 10), 'equipping an equipped item is idempotent');
assert.equal(saved.length, equipSaves + 1);
equipService.equip('W2');
assert.equal(equipService.snapshot().equipped.weapon.equipmentId, 'W2');
assert.equal(equipService.get('W1').equipmentId, 'W1', 'equipping same slot must return previous equipment to the bag');
equipService.setLocked('W2', true);
expectCode('equipped equipment cannot sell', () => equipService.sell('equipped-sale', 'W2'), 'EQUIPMENT_EQUIPPED');
assert.equal(equipService.unequip('weapon').equipmentId, 'W2');
assert.equal(equipService.snapshot().equipped.weapon, null);
assert.equal(equipService.unequip('weapon'), undefined, 'empty slot removal is idempotent');
expectCode('invalid unequip slot', () => equipService.unequip('ring'), 'INVALID_SLOT');

const fullBag = new EquipmentInventoryService({
  capacity: 1,
  state: initialState(1, [item('B1', 'helmet', 1, 'health', 10)], { weapon: item('W1', 'weapon', 1, 'attack', 10), helmet: null, armor: null, cloak: null }),
});
expectCode('unequip full bag', () => fullBag.unequip('weapon'), 'CAPACITY_EXCEEDED');
assert.equal(fullBag.snapshot().equipped.weapon.equipmentId, 'W1', 'failed unequip must be atomic');

let failPersist = true;
const rollback = new EquipmentInventoryService({ capacity: 2, persist: () => { if (failPersist) throw new Error('disk full'); } });
const rollbackBefore = rollback.save();
expectCode('persist failure rollback', () => rollback.add(item('P1', 'weapon', 1, 'attack', 1)), 'PERSISTENCE_FAILED');
assert.equal(rollback.save(), rollbackBefore, 'persist failure must not commit an add');
failPersist = false;
rollback.add(item('P1', 'weapon', 1, 'attack', 1));

let reentrant;
reentrant = new EquipmentInventoryService({
  capacity: 2,
  persist: () => reentrant.add(item('inner', 'cloak', 1, 'draw', 1)),
});
const reentrantBefore = reentrant.save();
expectCode('reentrant persistence rollback', () => reentrant.add(item('outer', 'weapon', 1, 'attack', 1)), 'PERSISTENCE_FAILED');
assert.equal(reentrant.save(), reentrantBefore);

const serialized = equipService.save();
const restored = restoreEquipmentInventory(serialized, { capacity: 4 });
assert.deepEqual(restored.snapshot(), equipService.snapshot(), 'save and restore must preserve bag, equipped slots, sort and requests');
assert.equal(restored.save(), serialized, 'restore must serialize deterministically');
assert.equal(restored.get('W1').equipmentId, 'W1', 'restored service must retain detached bag records');

const persistedBatch = service.save();
const recoveredBatch = restoreEquipmentInventory(persistedBatch, { capacity: 8 });
const recoveredDuplicate = recoveredBatch.sellBatch('batch-ok', ['E002', 'E001']);
assert.equal(recoveredDuplicate.idempotent, true, 'restored idempotency records must prevent duplicate sale');

const frozen = service.snapshot();
assertDeepFrozen(frozen, 'snapshot');
assertDeepFrozen(service.query(), 'query');
assert.throws(() => { frozen.items.push(item('mutate', 'cloak', 1, 'draw', 1)); }, TypeError);
assert.throws(() => { frozen.equipped.weapon = null; }, TypeError);
const exposed = service.query();
assert.throws(() => { exposed[0].locked = !exposed[0].locked; }, TypeError, 'query records must be deeply frozen');
assert.equal(exposed[0].locked, service.query()[0].locked, 'query records must not mutate service state');

expectCode('malformed save', () => restoreEquipmentInventory('{bad-json'), 'INVALID_STATE');
expectCode('unsupported save schema', () => restoreEquipmentInventory(JSON.stringify({ ...initialState(1), schemaVersion: 2 })), 'INVALID_STATE');
expectCode('negative capacity', () => new EquipmentInventoryService({ capacity: 0 }), 'INVALID_CAPACITY');

console.log(`T231 equipment inventory PASS: four-slots, quality/primary validation, capacity, stable-sort, lock/sell, atomic-batch, equip/unequip, idempotency, save-restore, prototype-keys, input-isolation, deep-freeze`);
