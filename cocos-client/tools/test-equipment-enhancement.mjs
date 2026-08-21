import assert from 'node:assert/strict';
import {
  EQUIPMENT_INVENTORY_SCHEMA_VERSION,
  EquipmentInventoryService,
} from '../assets/scripts/meta/equipment/index.ts';
import {
  EQUIPMENT_ENHANCEMENT_MATERIAL_ID,
  EQUIPMENT_ENHANCEMENT_MAX_LEVEL,
  EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID,
  EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION,
  EquipmentEnhancementError,
  EquipmentEnhancementService,
  getEquipmentEnhancementCost,
  restoreEquipmentEnhancement,
} from '../assets/scripts/meta/equipment/enhancement/index.ts';

function item(equipmentId, slot, quality, primaryAttribute, primaryValue, locked = false) {
  return { equipmentId, slot, quality, primaryAttribute, primaryValue, locked };
}

function enhancementState(equipment, level, basePrimaryValue, resources, processedRequests = []) {
  return {
    schemaVersion: EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION,
    equipment: [{ equipment, level, basePrimaryValue }],
    resources,
    processedRequests,
  };
}

function expectCode(label, action, code) {
  assert.throws(action, (error) => {
    assert(error instanceof EquipmentEnhancementError, `${label} must throw EquipmentEnhancementError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}

const initialInventory = new EquipmentInventoryService({ capacity: 4 });
initialInventory.add(item('E-REAL-WEAPON', 'weapon', 1, 'attack', 10));
initialInventory.add(item('E-REAL-ARMOR', 'armor', 4, 'armor', 40, true));
const inventoryBeforeEnhancement = initialInventory.save();
const realWeapon = initialInventory.get('E-REAL-WEAPON');

const persisted = [];
const service = new EquipmentEnhancementService({
  equipment: [realWeapon],
  resources: {
    gold: 5000,
    materials: {
      [EQUIPMENT_ENHANCEMENT_MATERIAL_ID]: 50,
      [EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID]: 2,
    },
  },
  persist: (serialized) => persisted.push(serialized),
});

assert.equal(service.snapshot().schemaVersion, EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION);
assert.deepEqual(service.get('E-REAL-WEAPON').equipment, realWeapon, 'initial equipment must use the T231 item contract');
assert.equal(service.get('E-REAL-WEAPON').level, 0);
assert.deepEqual(service.quote('E-REAL-WEAPON').cost, {
  level: 0,
  materialId: EQUIPMENT_ENHANCEMENT_MATERIAL_ID,
  materialQuantity: 1,
  gold: 100,
  successProbability: 1,
});
assert.equal(initialInventory.save(), inventoryBeforeEnhancement, 'enhancement must not mutate the T231 inventory');

const first = service.enhance('enhance-1', { equipmentId: 'E-REAL-WEAPON', roll: 0 });
assert.equal(first.outcome, 'SUCCESS');
assert.equal(first.applied, true);
assert.equal(first.success, true);
assert.equal(first.levelBefore, 0);
assert.equal(first.levelAfter, 1);
assert.equal(first.attributeDelta, 1);
assert.equal(first.equipment.primaryValue, 11);
assert.deepEqual(first.materialsSpent, { [EQUIPMENT_ENHANCEMENT_MATERIAL_ID]: 1 });
assert.equal(first.goldCost, 100);
assert.deepEqual(service.get('E-REAL-WEAPON').equipment, item('E-REAL-WEAPON', 'weapon', 1, 'attack', 11));
assert.equal(service.snapshot().resources.gold, 4900);
assert.equal(service.snapshot().resources.materials[EQUIPMENT_ENHANCEMENT_MATERIAL_ID], 49);
assert.equal(initialInventory.save(), inventoryBeforeEnhancement, 'successful enhancement must leave base inventory untouched');

const saveCountAfterFirst = persisted.length;
const repeated = service.enhance('enhance-1', { equipmentId: 'E-REAL-WEAPON', roll: 0 });
assert.equal(repeated.idempotent, true, 'same request must replay idempotently');
assert.equal(repeated.applied, false);
assert.deepEqual(repeated.equipment, first.equipment);
assert.equal(service.save(), JSON.stringify(service.snapshot()));
assert.equal(persisted.length, saveCountAfterFirst, 'idempotent replay must not persist or spend again');
expectCode('same request ID with different roll', () => service.enhance('enhance-1', { equipmentId: 'E-REAL-WEAPON', roll: 0.5 }), 'REQUEST_CONFLICT');

const second = service.enhance('enhance-2', {
  equipmentId: 'E-REAL-WEAPON',
  materialId: EQUIPMENT_ENHANCEMENT_MATERIAL_ID,
  materialQuantity: 2,
  roll: 0,
});
assert.equal(second.levelAfter, 2);
assert.equal(second.equipment.primaryValue, 12);
assert.equal(second.attributeDelta, 1);
assert.deepEqual(second.materialsSpent, { [EQUIPMENT_ENHANCEMENT_MATERIAL_ID]: 2 });

const beforeInvalidMaterial = service.save();
expectCode('unknown enhancement material', () => service.enhance('invalid-material', {
  equipmentId: 'E-REAL-WEAPON',
  materialId: 'ORE',
  materialQuantity: 3,
}), 'INVALID_MATERIAL');
expectCode('wrong material quantity', () => service.enhance('invalid-quantity', {
  equipmentId: 'E-REAL-WEAPON',
  materials: { [EQUIPMENT_ENHANCEMENT_MATERIAL_ID]: 1 },
}), 'INVALID_MATERIAL_QUANTITY');
assert.equal(service.save(), beforeInvalidMaterial, 'invalid material requests must be fail-closed');

const insufficientGold = new EquipmentEnhancementService({
  equipment: [realWeapon],
  resources: { gold: 99, materials: { [EQUIPMENT_ENHANCEMENT_MATERIAL_ID]: 1 } },
});
const insufficientGoldBefore = insufficientGold.save();
expectCode('insufficient gold', () => insufficientGold.enhance('poor-gold', { equipmentId: realWeapon.equipmentId }), 'INSUFFICIENT_GOLD');
assert.equal(insufficientGold.save(), insufficientGoldBefore);

const insufficientMaterial = new EquipmentEnhancementService({
  equipment: [realWeapon],
  resources: { gold: 100, materials: {} },
});
const insufficientMaterialBefore = insufficientMaterial.save();
expectCode('insufficient enhancement stone', () => insufficientMaterial.enhance('poor-stone', { equipmentId: realWeapon.equipmentId }), 'INSUFFICIENT_MATERIALS');
assert.equal(insufficientMaterial.save(), insufficientMaterialBefore);

const protectedFailure = new EquipmentEnhancementService({
  state: enhancementState(
    item('E-PROTECTED', 'weapon', 1, 'attack', 13),
    3,
    10,
    {
      gold: 1000,
      materials: {
        [EQUIPMENT_ENHANCEMENT_MATERIAL_ID]: 10,
        [EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID]: 1,
      },
    },
  ),
});
const protectedResult = protectedFailure.enhance('protected-failure', {
  equipmentId: 'E-PROTECTED',
  materials: {
    [EQUIPMENT_ENHANCEMENT_MATERIAL_ID]: 4,
    [EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID]: 1,
  },
  roll: 0.99,
});
assert.equal(protectedResult.outcome, 'FAILURE');
assert.equal(protectedResult.successProbability, 0.85);
assert.equal(protectedResult.protected, true);
assert.equal(protectedResult.downgraded, false);
assert.equal(protectedResult.levelAfter, 3, 'protection must prevent downgrade');
assert.equal(protectedResult.attributeDelta, 0);
assert.equal(protectedResult.equipment.primaryValue, 13);
assert.equal(protectedFailure.snapshot().resources.materials[EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID], undefined);

const downgrade = new EquipmentEnhancementService({
  state: enhancementState(
    item('E-DOWNGRADE', 'weapon', 1, 'attack', 13),
    3,
    10,
    { gold: 1000, materials: { [EQUIPMENT_ENHANCEMENT_MATERIAL_ID]: 10 } },
  ),
});
const downgradeResult = downgrade.enhance('ordinary-failure', { equipmentId: 'E-DOWNGRADE', roll: 0.99 });
assert.equal(downgradeResult.outcome, 'FAILURE');
assert.equal(downgradeResult.downgraded, true);
assert.equal(downgradeResult.levelAfter, 2);
assert.equal(downgradeResult.attributeDelta, -1);
assert.equal(downgradeResult.equipment.primaryValue, 12);

const maxEquipment = item('E-MAX', 'weapon', 4, 'attack', 50);
const maxService = new EquipmentEnhancementService({
  state: enhancementState(
    maxEquipment,
    EQUIPMENT_ENHANCEMENT_MAX_LEVEL,
    10,
    { gold: 1, materials: {} },
  ),
});
assert.equal(getEquipmentEnhancementCost(EQUIPMENT_ENHANCEMENT_MAX_LEVEL), null);
const maxBefore = maxService.save();
const maxResult = maxService.enhance({ requestId: 'at-cap', equipmentId: 'E-MAX' });
assert.equal(maxResult.outcome, 'MAX_LEVEL');
assert.equal(maxResult.applied, false);
assert.equal(maxResult.levelAfter, EQUIPMENT_ENHANCEMENT_MAX_LEVEL);
assert.equal(maxResult.equipment.primaryValue, 50);
assert.equal(maxService.save(), maxBefore, 'cap attempt must not spend resources or persist');
expectCode('protection at cap is not a legal cost', () => maxService.enhance('cap-protection', {
  equipmentId: 'E-MAX',
  materials: { [EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID]: 1 },
}), 'INVALID_MATERIAL_QUANTITY');
assert.equal(maxService.save(), maxBefore);
expectCode('illegal level above cap', () => getEquipmentEnhancementCost(EQUIPMENT_ENHANCEMENT_MAX_LEVEL + 1), 'INVALID_LEVEL');
expectCode('illegal negative level', () => getEquipmentEnhancementCost(-1), 'INVALID_LEVEL');
expectCode('malformed level in state', () => new EquipmentEnhancementService({
  state: enhancementState(maxEquipment, EQUIPMENT_ENHANCEMENT_MAX_LEVEL + 1, 10, { gold: 0, materials: {} }),
}), 'INVALID_STATE');

const serialized = service.save();
const restored = restoreEquipmentEnhancement(serialized);
assert.equal(restored.save(), serialized, 'enhancement save must be deterministic');
assert.deepEqual(restored.snapshot(), service.snapshot(), 'enhancement state must round-trip');
const restoredReplay = restored.enhance('enhance-2', {
  equipmentId: 'E-REAL-WEAPON',
  materialId: EQUIPMENT_ENHANCEMENT_MATERIAL_ID,
  materialQuantity: 2,
  roll: 0,
});
assert.equal(restoredReplay.idempotent, true, 'serialized replay must retain request idempotency');
assert.equal(restored.save(), serialized, 'serialized replay must not alter the save');
const tamperedSerialized = JSON.parse(serialized);
tamperedSerialized.processedRequests[0].result.materialCost = {};
expectCode('tampered processed result', () => restoreEquipmentEnhancement(JSON.stringify(tamperedSerialized)), 'INVALID_STATE');

const malformedBefore = service.save();
expectCode('invalid equipment shape', () => service.add({ ...realWeapon, primaryValue: 0 }), 'INVALID_PRIMARY_VALUE');
expectCode('missing equipment', () => service.enhance('missing-equipment', { equipmentId: 'E-NOPE' }), 'EQUIPMENT_NOT_FOUND');
expectCode('invalid roll', () => service.enhance('invalid-roll', { equipmentId: 'E-REAL-WEAPON', roll: 1 }), 'INVALID_ROLL');
assert.equal(service.save(), malformedBefore);

let persistFailure = true;
const rollback = new EquipmentEnhancementService({
  equipment: [realWeapon],
  resources: { gold: 100, materials: { [EQUIPMENT_ENHANCEMENT_MATERIAL_ID]: 1 } },
  persist: () => { if (persistFailure) throw new Error('disk full'); },
});
const rollbackBefore = rollback.save();
expectCode('persistence failure rollback', () => rollback.enhance('persist-failure', { equipmentId: realWeapon.equipmentId }), 'PERSISTENCE_FAILED');
assert.equal(rollback.save(), rollbackBefore);
persistFailure = false;
rollback.enhance('persist-ok', { equipmentId: realWeapon.equipmentId });

const frozen = service.snapshot();
assert(Object.isFrozen(frozen));
assert(Object.isFrozen(frozen.equipment));
assert(Object.isFrozen(frozen.equipment[0]));
assert(Object.isFrozen(frozen.equipment[0].equipment));
assert(Object.isFrozen(frozen.resources.materials));
assert.throws(() => { frozen.equipment.push(frozen.equipment[0]); }, TypeError);
assert.throws(() => { frozen.equipment[0].equipment.primaryValue = 999; }, TypeError);

assert.equal(initialInventory.save(), inventoryBeforeEnhancement, 'all enhancement paths must preserve base inventory');
assert.equal(EQUIPMENT_INVENTORY_SCHEMA_VERSION, 1);
console.log('T232 equipment enhancement PASS: real T231 contract, deterministic costs/probability, stat deltas, failure downgrade/protection, cap, resource guards, illegal input fail-closed, idempotency, serialization replay, persistence rollback');
