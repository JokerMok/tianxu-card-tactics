import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  EQUIPMENT_INVENTORY_SCHEMA_VERSION,
  EQUIPMENT_SLOTS,
  EquipmentInventoryError,
  EquipmentInventoryService,
} from '../assets/scripts/meta/equipment/index.ts';
import {
  INVENTORY_PAGE_SCHEMA_VERSION,
  InventoryPageError,
  InventoryPageService,
  createDefaultInventoryPageData,
  createEmptyInventoryPageData,
  createInventoryPageComponents,
} from '../assets/scripts/meta/ui/pages/city-tasks-inventory/inventory/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const inventoryRoot = path.join(root, 'assets/scripts/meta/ui/pages/city-tasks-inventory/inventory');
const targetFiles = ['InventoryContracts.ts', 'InventoryComponents.ts', 'InventoryPageService.ts', 'index.ts'];
const targetSource = new Map(targetFiles.map((file) => [file, fs.readFileSync(path.join(inventoryRoot, file), 'utf8')]));

for (const [file, source] of targetSource) {
  assert(source.length > (file === 'index.ts' ? 100 : 1200), `${file} must contain an implemented module`);
  assert.doesNotMatch(source, /from ['"]cc['"]|require\(['"]cc['"]\)/u, `${file} must remain Cocos-adapter friendly`);
  assert.doesNotMatch(source, /UI09|loadSprite|整图/u, `${file} must not depend on page artwork text or numeric literals`);
}
assert.match(targetSource.get('InventoryComponents.ts'), /createInventoryPageComponents/u);
assert.match(targetSource.get('InventoryPageService.ts'), /EquipmentInventoryService/u);
assert.match(targetSource.get('InventoryPageService.ts'), /PERSISTENCE_FAILED/u);

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const cardsTable = readJson(path.join(root, 'assets/resources/config/cards.json'));
const realCards = cardsTable.cards.filter((card) => card.enabled !== false);
assert(realCards.length >= 30, 'the validator must read the real enabled card catalog');
assert(realCards.some((card) => card.id === 'U001'), 'real card U001 must be present');
assert(realCards.some((card) => card.id === 'U004'), 'real card U004 must be present');
const equipmentSource = fs.readFileSync(path.join(root, 'assets/scripts/meta/equipment/equipment-inventory.ts'), 'utf8');
assert.match(equipmentSource, /EQUIPMENT_SLOTS/u, 'the page must use the production equipment service contract');
assert.deepEqual(EQUIPMENT_SLOTS, ['weapon', 'helmet', 'armor', 'cloak']);

function item(equipmentId, slot, quality, primaryAttribute, primaryValue, locked = false) {
  return { equipmentId, slot, quality, primaryAttribute, primaryValue, locked };
}

function inventoryState(capacity, items = [], equipped = { weapon: null, helmet: null, armor: null, cloak: null }, sort = { field: 'equipmentId', direction: 'asc' }, processedRequests = []) {
  return { schemaVersion: EQUIPMENT_INVENTORY_SCHEMA_VERSION, capacity, items, equipped, sort, processedRequests };
}

function expectPageFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof InventoryPageError, `${label} must use InventoryPageError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}

function expectEquipmentFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof EquipmentInventoryError, `${label} must use EquipmentInventoryError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    return true;
  }, label);
}

function assertDeepFrozen(value, label = 'value', seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert(Object.isFrozen(value), `${label} must be deeply frozen`);
  for (const [key, child] of Object.entries(value)) assertDeepFrozen(child, `${label}.${key}`, seen);
}

let negativeCaseCount = 0;
const productionInventory = new EquipmentInventoryService({ capacity: 4 });
const realEquipment = [
  productionInventory.add({ equipmentId: 'E-REAL-WEAPON', slot: 'weapon', quality: 4, primaryAttribute: 'attack', primaryValue: 12 }),
  productionInventory.add({ equipmentId: 'E-REAL-ARMOR', slot: 'armor', quality: 3, primaryAttribute: 'armor', primaryValue: 18, locked: true }),
  productionInventory.add({ equipmentId: 'E-REAL-CLOAK', slot: 'cloak', quality: 2, primaryAttribute: 'draw', primaryValue: 1 }),
];
productionInventory.add({ equipmentId: 'E-REAL-HELMET', slot: 'helmet', quality: 2, primaryAttribute: 'health', primaryValue: 20 });
productionInventory.equip('E-REAL-HELMET');
assert.equal(productionInventory.get('E-REAL-HELMET').equipmentId, 'E-REAL-HELMET');
for (const equipment of realEquipment) assert.deepEqual(productionInventory.get(equipment.equipmentId), equipment);
assert.deepEqual(productionInventory.snapshot().items.map(({ equipmentId }) => equipmentId), [
  'E-REAL-WEAPON', 'E-REAL-ARMOR', 'E-REAL-CLOAK',
]);
const initialState = JSON.parse(productionInventory.save());
const saves = [];
const page = new InventoryPageService({
  data: createDefaultInventoryPageData({ title: '真实行囊', subtitle: '来自装备背包服务' }),
  inventory: productionInventory,
  persist: (serialized) => saves.push(serialized),
});

const initial = page.snapshot();
assert.equal(initial.pageId, 'inventory');
assert.equal(initial.schemaVersion, INVENTORY_PAGE_SCHEMA_VERSION);
assert.equal(initial.components.find((component) => component.id === 'header')?.capacity, 4);
assert.equal(initial.components.find((component) => component.id === 'header')?.usedCapacity, 3);
assert.equal(initial.components.find((component) => component.id === 'header')?.visibleItems, 3);
assert.equal(initial.components.find((component) => component.id === 'equipped-slots')?.slots.helmet?.equipmentId, 'E-REAL-HELMET');
assert.equal(initial.components.find((component) => component.id === 'equipment-E-REAL-ARMOR')?.locked, true);
assert.equal(initial.components.find((component) => component.id === 'detail')?.equipmentId, 'E-REAL-ARMOR');
assert.equal(initial.components.find((component) => component.id === 'detail')?.location, 'bag');
assert.equal(initial.state?.inventory, productionInventory.save(), 'page must bind to the T231 production inventory state');
const exposedInventory = page.inventoryService;
assert(exposedInventory, 'inventory getter must expose a controlled facade');
assert.notEqual(exposedInventory, productionInventory, 'inventory getter must not expose the mutable T231 instance');
assert.equal('current' in exposedInventory, false, 'inventory facade must not expose T231 internal state');
assert.deepEqual(exposedInventory.snapshot(), productionInventory.snapshot(), 'inventory facade must read the live T231 state');

const frozen = page.snapshot();
assertDeepFrozen(frozen, 'inventory snapshot');
assert.throws(() => { frozen.components.push({}); }, TypeError);
assert.throws(() => { frozen.components.find((component) => component.id === 'header').capacity = 999; }, TypeError);

const mutableData = createDefaultInventoryPageData();
const isolated = new InventoryPageService({ data: mutableData, inventory: new EquipmentInventoryService({ state: initialState }) });
mutableData.title = '篡改标题';
assert.equal(isolated.pageData.title, '行囊');

assert.deepEqual(page.selectEquipment('E-REAL-WEAPON'), { accepted: true, changed: true, reason: 'selected', equipmentId: 'E-REAL-WEAPON' });
assert.deepEqual(page.selectEquipment('E-REAL-ARMOR'), { accepted: true, changed: true, reason: 'selected', equipmentId: 'E-REAL-ARMOR' });
assert.deepEqual(page.selectEquipment('E-REAL-ARMOR'), { accepted: true, changed: false, reason: 'same', equipmentId: 'E-REAL-ARMOR' });
assert.deepEqual(page.interact({ type: 'toggleLock', equipmentId: 'E-REAL-ARMOR' }), { accepted: true, changed: true, reason: 'unlocked', equipmentId: 'E-REAL-ARMOR' });
assert.equal(productionInventory.get('E-REAL-ARMOR').locked, false, 'direct page write must update the external T231 instance');
assert.deepEqual(page.interact({ type: 'toggleLock', equipmentId: 'E-REAL-ARMOR', locked: true }), { accepted: true, changed: true, reason: 'locked', equipmentId: 'E-REAL-ARMOR' });
assert.deepEqual(page.setFilter({ slot: 'armor', qualities: [3] }), { accepted: true, changed: true, reason: 'filtered', equipmentId: 'E-REAL-ARMOR' });
assert.equal(page.snapshot().components.find((component) => component.id === 'header')?.visibleItems, 1);
assert.deepEqual(page.clearFilter(), { accepted: true, changed: true, reason: 'filtered', equipmentId: 'E-REAL-ARMOR' });
assert.deepEqual(page.toggleLock('E-REAL-ARMOR', false), { accepted: true, changed: true, reason: 'unlocked', equipmentId: 'E-REAL-ARMOR' });
assert.equal(page.snapshot().components.find((component) => component.id === 'equipment-E-REAL-ARMOR')?.canSell, true);

assert.deepEqual(page.equip('E-REAL-WEAPON'), { accepted: true, changed: true, reason: 'equipped', equipmentId: 'E-REAL-WEAPON', slot: 'weapon' });
assert.equal(page.snapshot().components.find((component) => component.id === 'equipped-slots')?.slots.weapon?.state, 'equipped');
assert.equal(page.snapshot().components.find((component) => component.id === 'detail')?.location, 'equipped');
assert.equal(page.snapshot().components.find((component) => component.id === 'header')?.usedCapacity, 2);
assert.deepEqual(page.unequip('weapon'), { accepted: true, changed: true, reason: 'unequipped', equipmentId: 'E-REAL-WEAPON', slot: 'weapon' });
assert.equal(page.snapshot().components.find((component) => component.id === 'header')?.usedCapacity, 3);

const beforeSale = page.serialize();
const saveCountBeforeSale = saves.length;
assert.deepEqual(page.sell('sale-real-armor', 'E-REAL-ARMOR'), {
  accepted: true,
  changed: true,
  reason: 'sold',
  equipmentId: 'E-REAL-ARMOR',
  totalValue: 3,
});
assert.notEqual(page.serialize(), beforeSale);
const afterSale = page.serialize();
assert.equal(saves.length, saveCountBeforeSale + 1);
assert.deepEqual(page.sell('sale-real-armor', 'E-REAL-ARMOR'), {
  accepted: true,
  changed: false,
  reason: 'idempotent',
  equipmentId: 'E-REAL-ARMOR',
  totalValue: 3,
});
assert.equal(page.serialize(), afterSale);
assert.equal(saves.length, saveCountBeforeSale + 1, 'idempotent sale must not persist twice');

const externallyAdded = productionInventory.add({ equipmentId: 'E-EXTERNAL', slot: 'cloak', quality: 1, primaryAttribute: 'draw', primaryValue: 2 });
assert.deepEqual(page.inventoryService?.get('E-EXTERNAL'), externallyAdded, 'page getter must follow external T231 additions');
assert(page.snapshot().components.some((component) => component.id === 'equipment-E-EXTERNAL'), 'external T231 addition must enter the page projection');
productionInventory.equip('E-EXTERNAL');
assert.equal(page.snapshot().components.find((component) => component.id === 'equipped-slots')?.slots.cloak?.equipmentId, 'E-EXTERNAL', 'external T231 equip must enter the page projection');

const serialized = page.serialize();
const restored = new InventoryPageService({ data: createDefaultInventoryPageData(), initialState: serialized });
assert.equal(restored.serialize(), serialized, 'page save and restore must be deterministic');
assert.deepEqual(restored.snapshot().state, page.snapshot().state);

const emptyBag = new InventoryPageService({ data: createDefaultInventoryPageData(), inventory: new EquipmentInventoryService({ capacity: 2 }) });
assert.deepEqual(emptyBag.snapshot().components.map((component) => component.id), ['header', 'filters', 'equipped-slots', 'inventory-empty']);
assert.equal(emptyBag.snapshot().components.at(-1)?.reason, 'noItems');
assert.deepEqual(emptyBag.selectEquipment('U001'), { accepted: false, changed: false, reason: 'empty', equipmentId: null });
const unavailable = new InventoryPageService(createEmptyInventoryPageData());
assert.deepEqual(unavailable.snapshot().components.map((component) => component.id), ['inventory-empty']);
assert.equal(unavailable.snapshot().state, null);
assert.deepEqual(unavailable.selectEquipment('E-REAL-WEAPON'), { accepted: false, changed: false, reason: 'empty', equipmentId: null });

const fullBag = new InventoryPageService({
  data: createDefaultInventoryPageData(),
  inventory: new EquipmentInventoryService({
    state: inventoryState(1, [item('E-FULL-BAG', 'armor', 1, 'armor', 2)], { weapon: item('E-FULL-EQUIPPED', 'weapon', 1, 'attack', 2), helmet: null, armor: null, cloak: null }),
  }),
});
expectPageFailure('unequip into a full bag', () => fullBag.unequip('weapon'), 'CAPACITY_EXCEEDED');
assert.equal(fullBag.snapshot().components.find((component) => component.id === 'equipped-slots')?.slots.weapon?.equipmentId, 'E-FULL-EQUIPPED');

const lockedPage = new InventoryPageService({
  data: createDefaultInventoryPageData(),
  inventory: new EquipmentInventoryService({ state: inventoryState(2, [item('E-LOCKED', 'weapon', 1, 'attack', 2, true)]) }),
});
expectPageFailure('locked equipment cannot sell', () => lockedPage.sell('sale-locked', 'E-LOCKED'), 'EQUIPMENT_LOCKED');
expectPageFailure('unknown equipment id', () => page.selectEquipment('E-NOPE'), 'EQUIPMENT_NOT_FOUND');
expectPageFailure('empty equipment id', () => page.selectEquipment(''), 'INVALID_ID');
expectPageFailure('filtered equipment cannot be selected', () => {
  page.setFilter({ slot: 'cloak' });
  page.selectEquipment('E-REAL-WEAPON');
}, 'EQUIPMENT_NOT_VISIBLE');
page.clearFilter();
expectPageFailure('out-of-range equipment index', () => page.selectEquipmentAt(99), 'INDEX_OUT_OF_RANGE');
expectPageFailure('fractional equipment index', () => page.selectEquipmentAt(0.5), 'INVALID_NUMBER');
expectPageFailure('invalid filter quality', () => page.setFilter({ qualities: [99] }), 'INVALID_FILTER');
expectPageFailure('invalid filter field', () => page.setFilter({ source: 'SHOP' }), 'INVALID_FILTER');
const hiddenFilterField = {};
Object.defineProperty(hiddenFilterField, 'source', { value: 'SHOP', enumerable: false });
expectPageFailure('non-enumerable invalid filter field', () => page.setFilter(hiddenFilterField), 'INVALID_FILTER');
expectPageFailure('symbol invalid filter field', () => page.setFilter({ [Symbol('source')]: 'SHOP' }), 'INVALID_FILTER');
expectPageFailure('invalid sort', () => page.setSort({ field: 'random', direction: 'asc' }), 'INVALID_SORT');
expectPageFailure('unknown interaction', () => page.interact({ type: 'not-supported' }), 'INVALID_ARGUMENT');
expectPageFailure('extra interaction field', () => page.interact({ type: 'clearFilter', unexpected: true }), 'INVALID_ARGUMENT');
expectPageFailure('missing save field', () => new InventoryPageService({ data: createDefaultInventoryPageData(), initialState: JSON.stringify({ schemaVersion: 1, selectedEquipmentId: null, filter: {} }) }), 'MISSING_FIELD');
expectPageFailure('malformed save', () => restored.restore('{bad-json'), 'INVALID_SAVE');
expectEquipmentFailure('malformed production inventory state', () => EquipmentInventoryService.restore(JSON.stringify({ ...inventoryState(1), capacity: 0 })), 'INVALID_STATE');
expectPageFailure('empty page serialize', () => unavailable.serialize(), 'STATE_NOT_AVAILABLE');
expectPageFailure('empty page persistence', () => new InventoryPageService({ data: createEmptyInventoryPageData(), persist: () => {} }), 'STATE_NOT_AVAILABLE');

const persistenceFailureInventory = new EquipmentInventoryService({ state: inventoryState(2, [item('E-PERSIST', 'cloak', 1, 'draw', 1)]) });
const persistenceFailure = new InventoryPageService({
  data: createDefaultInventoryPageData(),
  inventory: persistenceFailureInventory,
  persist: () => { throw new Error('disk full'); },
});
const beforePersistenceFailure = persistenceFailure.serialize();
expectPageFailure('page persistence failure is atomic', () => persistenceFailure.toggleLock('E-PERSIST', true), 'PERSISTENCE_FAILED');
assert.equal(persistenceFailure.serialize(), beforePersistenceFailure);
assert.equal(persistenceFailureInventory.save(), JSON.parse(beforePersistenceFailure).inventory, 'failed page write must roll back the external T231 instance');

const reentrantSaves = [];
let reentrantPage;
let nestedFailure;
reentrantPage = new InventoryPageService({
  data: createDefaultInventoryPageData(),
  inventory: new EquipmentInventoryService({ state: inventoryState(2, [item('E-REENTRANT', 'cloak', 1, 'draw', 1)]) }),
  onSave: (serialized) => {
    try {
      reentrantPage.inventoryService.add({ equipmentId: 'E-REENTRANT-ADD', slot: 'weapon', quality: 1, primaryAttribute: 'attack', primaryValue: 1 });
    } catch (error) {
      nestedFailure = error;
    }
    try {
      reentrantPage.inventoryService.equip('E-REENTRANT');
    } catch (error) {
      assert.equal(error.code, 'PERSISTENCE_REENTRANT', 'facade equip re-entry must be rejected explicitly');
    }
    reentrantSaves.push(serialized);
  },
});
const reentrantResult = reentrantPage.toggleLock('E-REENTRANT', true);
assert.deepEqual(reentrantResult, { accepted: true, changed: true, reason: 'locked', equipmentId: 'E-REENTRANT' });
assert(nestedFailure instanceof InventoryPageError);
assert.equal(nestedFailure.code, 'PERSISTENCE_REENTRANT');
assert.equal(reentrantSaves.length, 1, 'reentrant page mutation must not create a nested persistence record');
assert.equal(reentrantSaves[0], reentrantPage.serialize(), 'persisted and committed page state must match');
assert.equal(reentrantPage.snapshot().components.find((component) => component.id === 'equipment-E-REENTRANT')?.locked, true);
assert.throws(() => reentrantPage.inventoryService?.get('E-REENTRANT-ADD'), /EQUIPMENT_NOT_FOUND/, 'reentrant facade add must not split the inventory state');

assert.equal(negativeCaseCount >= 15, true, 'missing, invalid, out-of-range and atomicity cases must execute');
assert(saves.length >= 6, 'real page transitions must invoke persistence');
console.log(`T314 inventory page: real-cards=${realCards.length}, visible=${initial.components.filter((component) => component.kind === 'equipment').length}, saves=${saves.length}, negative-cases=${negativeCaseCount}, normal/empty/invalid, filter/lock/sell/equip/restore/deep-freeze`);
