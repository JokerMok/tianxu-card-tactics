import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createDefaultState } from '../assets/scripts/meta/GameState.ts';
import {
  CITY_BUILDING_IDS,
  CITY_PAGE_SCHEMA_VERSION,
  CityPageError,
  CityPageService,
  createEmptyCityPageData,
} from '../assets/scripts/meta/ui/pages/city-tasks-inventory/city/index.ts';
import {
  TasksPageError,
  TasksPageService,
  createEmptyTasksPageData,
  createTasksPageData,
} from '../assets/scripts/meta/ui/pages/city-tasks-inventory/tasks/index.ts';
import { MAINLINE_TASK_DEFINITIONS } from '../assets/scripts/meta/tasks/mainline/index.ts';
import {
  EQUIPMENT_INVENTORY_SCHEMA_VERSION,
  EquipmentInventoryError,
  EquipmentInventoryService,
} from '../assets/scripts/meta/equipment/index.ts';
import {
  InventoryPageError,
  InventoryPageService,
  createDefaultInventoryPageData,
  createEmptyInventoryPageData,
} from '../assets/scripts/meta/ui/pages/city-tasks-inventory/inventory/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const levelRoot = path.join(root, 'assets/resources/config/levels/chapter01');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function expectError(label, action, ErrorClass, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof ErrorClass, `${label} must throw ${ErrorClass.name}`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}

function item(equipmentId, slot, quality, primaryAttribute, primaryValue, locked = false) {
  return { equipmentId, slot, quality, primaryAttribute, primaryValue, locked };
}

let negativeCaseCount = 0;

// The task definitions and level documents are the production authorities for this group.
const realLevels = MAINLINE_TASK_DEFINITIONS.map(({ trigger }) => {
  const levelId = trigger.levelId;
  const document = readJson(path.join(levelRoot, `${levelId}.json`));
  assert.equal(document.chapterLevels.length, 1, `${levelId} must have one real chapter level`);
  assert.equal(document.chapterLevels[0].id, levelId, `${levelId} must match its production file`);
  return document.chapterLevels[0];
});
assert.equal(realLevels.length, 12, 'integration must use all real chapter levels');

const taskData = createTasksPageData({ taskDefinitions: MAINLINE_TASK_DEFINITIONS });
assert.deepEqual(taskData.tasks.map(({ id }) => id), MAINLINE_TASK_DEFINITIONS.map(({ id }) => id));
assert.deepEqual(taskData.tasks.map(({ trigger }) => trigger.levelId), realLevels.map(({ id }) => id));

// One integration context owns all three production snapshots. City mutates GameState,
// Tasks owns the real mainline state, and Inventory is bound to the real T231 instance.
const gameState = createDefaultState();
const cityPersisted = [];
const city = new CityPageService({
  state: gameState,
  persist: (serialized) => cityPersisted.push(serialized),
});

const t231Inventory = new EquipmentInventoryService({ capacity: 6 });
t231Inventory.add(item('E-T247-WEAPON', 'weapon', 4, 'attack', 12));
t231Inventory.add(item('E-T247-ARMOR', 'armor', 3, 'armor', 18, true));
t231Inventory.add(item('E-T247-CLOAK', 'cloak', 2, 'draw', 1));
t231Inventory.add(item('E-T247-HELMET', 'helmet', 2, 'health', 20));
t231Inventory.equip('E-T247-HELMET');
const inventoryPersisted = [];
const inventory = new InventoryPageService({
  data: createDefaultInventoryPageData({ title: '真实组级行囊', subtitle: 'T231 快照绑定' }),
  inventory: t231Inventory,
  persist: (serialized) => inventoryPersisted.push(serialized),
});

const taskPersisted = [];
const tasks = new TasksPageService({
  data: taskData,
  persist: (serialized) => taskPersisted.push(serialized),
});

function sharedSnapshot() {
  return {
    gameState: city.state,
    mainlineTasks: tasks.state,
    t231Inventory: t231Inventory.snapshot(),
  };
}

function assertSharedBindings(label) {
  const shared = sharedSnapshot();
  assert.deepEqual(shared.gameState, gameState, `${label}: CITY must expose the attached GameState snapshot`);
  assert.deepEqual(shared.mainlineTasks, tasks.snapshot().state, `${label}: TASKS snapshot must be its live mainline state`);
  assert.deepEqual(
    inventory.snapshot().state?.inventory,
    t231Inventory.save(),
    `${label}: INVENTORY page must expose the live T231 snapshot`,
  );
  assert.equal(shared.gameState.version, 1, `${label}: shared GameState must remain production version 1`);
  assert.equal(shared.t231Inventory.schemaVersion, EQUIPMENT_INVENTORY_SCHEMA_VERSION, `${label}: T231 schema must remain current`);
}

// Baseline: every page projects a real state snapshot, not a placeholder.
const cityInitial = city.snapshot(0);
const taskInitial = tasks.snapshot();
const inventoryInitial = inventory.snapshot();
assert.equal(cityInitial.pageId, 'city');
assert.equal(cityInitial.schemaVersion, CITY_PAGE_SCHEMA_VERSION);
assert.deepEqual(cityInitial.components.map(({ id }) => id), [
  'header', 'building-castle', 'building-alchemy', 'building-forge', 'building-harbor', 'expedition',
]);
assert.deepEqual(cityInitial.components.find(({ id }) => id === 'header').silver, 12800);
assert.deepEqual(cityInitial.components.filter(({ kind }) => kind === 'building').map(({ buildingId }) => buildingId), [...CITY_BUILDING_IDS]);
assert.equal(taskInitial.pageId, 'tasks');
assert.equal(taskInitial.components.find(({ id }) => id === 'header').totalTasks, realLevels.length);
assert.equal(taskInitial.components.find(({ id }) => id === 'task-M4-10-L01').state, 'ready');
assert.equal(taskInitial.components.find(({ id }) => id === 'task-M4-10-L02').state, 'locked');
assert.equal(inventoryInitial.pageId, 'inventory');
assert.equal(inventoryInitial.components.find(({ id }) => id === 'header').totalItems, 3);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'header').equippedItems, 1);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'equipped-slots').slots.helmet.equipmentId, 'E-T247-HELMET');
assert.equal(inventoryInitial.state?.inventory, t231Inventory.save());
assertSharedBindings('initial');

// CITY: real upgrade, timer boundary, expedition claim, and resource guards.
const cityUpgrade = city.upgradeBuilding('forge');
assert.deepEqual(cityUpgrade, { accepted: true, changed: true, reason: 'upgraded', buildingId: 'forge' });
assert.equal(gameState.buildings.forge, 3);
assert.equal(gameState.resources.silver, 10000);
assert.equal(gameState.resources.crystal, 380);
assert.equal(JSON.parse(cityPersisted.at(-1)).buildings.forge, 3);
assert.equal(city.snapshot(0).components.find(({ id }) => id === 'building-forge').level, 3);
assert.equal(city.snapshot(0).components.find(({ id }) => id === 'building-forge').state, 'maxed');

const cityDispatch = city.dispatchExpedition(1000);
assert.deepEqual(cityDispatch, { accepted: true, changed: true, reason: 'dispatched', buildingId: null });
assert.equal(gameState.resources.stamina, 72);
assert.equal(gameState.expedition.endsAt, 61000);
assert.equal(city.snapshot(60999).components.find(({ id }) => id === 'expedition').state, 'active');
assert.deepEqual(city.claimExpedition(60999), { accepted: false, changed: false, reason: 'active', buildingId: null });
assert.deepEqual(city.claimExpedition(61000), { accepted: true, changed: true, reason: 'claimed', buildingId: null });
assert.equal(gameState.resources.silver, 11600);
assert.deepEqual(gameState.expedition, { active: false, endsAt: 0, reward: 0 });
assert.equal(city.snapshot(61000).components.find(({ id }) => id === 'expedition').state, 'idle');
assertSharedBindings('after city mutations');

const insufficientCityState = createDefaultState();
insufficientCityState.resources.silver = 100;
insufficientCityState.resources.crystal = 10;
insufficientCityState.resources.stamina = 5;
const insufficientCity = new CityPageService({ state: insufficientCityState });
assert.deepEqual(insufficientCity.upgradeBuilding('alchemy'), { accepted: false, changed: false, reason: 'insufficient', buildingId: 'alchemy' });
assert.deepEqual(insufficientCity.dispatchExpedition(0), { accepted: false, changed: false, reason: 'insufficient', buildingId: null });
assert.equal(insufficientCityState.buildings.alchemy, 2);
assert.equal(insufficientCityState.resources.silver, 100);
assert.equal(insufficientCityState.resources.stamina, 5);

const maxedCityState = createDefaultState();
maxedCityState.buildings.forge = 3;
const maxedCity = new CityPageService({ state: maxedCityState });
assert.deepEqual(maxedCity.upgradeBuilding('forge'), { accepted: false, changed: false, reason: 'maxed', buildingId: 'forge' });
assert.equal(maxedCityState.buildings.forge, 3);

// TASKS: real definitions, progress, duplicate event key, claim/outbox, restore, and failure atomicity.
const advanceL01 = tasks.advanceTask('M4-10-L01', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' });
assert.deepEqual(advanceL01, { accepted: true, changed: true, reason: 'completed', taskId: 'M4-10-L01', progress: 1 });
assert.equal(tasks.state.tasks['M4-10-L01'].completed, true);
assert.equal(tasks.state.features.deck.unlocked, true);
assert.deepEqual(
  tasks.advanceTask('M4-10-L01', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' }),
  { accepted: false, changed: false, reason: 'duplicate', taskId: 'M4-10-L01', progress: 1 },
);
assert.equal(taskPersisted.length, 1, 'duplicate task events must not persist');
const claimL01 = tasks.claimTask('M4-10-L01');
assert.deepEqual(claimL01, { accepted: true, changed: true, reason: 'claimed', taskId: 'M4-10-L01', progress: 1 });
const taskBusinessKey = 'mainline:CHAPTER01:M4-10-L01';
assert.equal(tasks.state.rewardOutbox.entries[taskBusinessKey].status, 'PENDING');
assert.equal(taskPersisted.length, 2, 'successful task claim must persist');
assert.deepEqual(tasks.advanceTask('M4-10-L02', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L02' }), {
  accepted: true, changed: true, reason: 'completed', taskId: 'M4-10-L02', progress: 1,
});
assert.equal(tasks.snapshot().components.find(({ id }) => id === 'task-M4-10-L03').state, 'ready');
const restoredTasks = new TasksPageService({ data: taskData, initialState: tasks.serialize() });
assert.deepEqual(restoredTasks.snapshot().state, tasks.snapshot().state, 'TASKS restore must preserve the real state snapshot');
assert.equal(restoredTasks.serialize(), tasks.serialize(), 'TASKS save must be deterministic');
assertSharedBindings('after tasks mutations');

// INVENTORY: quantity, filtering, locking, equip/sell and T231 live-state binding.
const filterResult = inventory.setFilter({ slot: 'armor', qualities: [3] });
assert.deepEqual(filterResult, { accepted: true, changed: true, reason: 'filtered', equipmentId: 'E-T247-ARMOR' });
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'header').visibleItems, 1);
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'equipment-E-T247-ARMOR').locked, true);
assert.deepEqual(inventory.toggleLock('E-T247-ARMOR', false), {
  accepted: true, changed: true, reason: 'unlocked', equipmentId: 'E-T247-ARMOR',
});
assert.equal(t231Inventory.get('E-T247-ARMOR').locked, false);
assert.deepEqual(inventory.clearFilter(), { accepted: true, changed: true, reason: 'filtered', equipmentId: 'E-T247-ARMOR' });
assert.deepEqual(inventory.equip('E-T247-WEAPON'), {
  accepted: true, changed: true, reason: 'equipped', equipmentId: 'E-T247-WEAPON', slot: 'weapon',
});
assert.equal(t231Inventory.snapshot().equipped.weapon.equipmentId, 'E-T247-WEAPON');
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'header').usedCapacity, 2);
assert.deepEqual(inventory.sell('sell-t247-armor', 'E-T247-ARMOR'), {
  accepted: true, changed: true, reason: 'sold', equipmentId: 'E-T247-ARMOR', totalValue: 3,
});
assert.equal(t231Inventory.snapshot().items.some(({ equipmentId }) => equipmentId === 'E-T247-ARMOR'), false);
const inventorySaveCount = inventoryPersisted.length;
assert.deepEqual(inventory.sell('sell-t247-armor', 'E-T247-ARMOR'), {
  accepted: true, changed: false, reason: 'idempotent', equipmentId: 'E-T247-ARMOR', totalValue: 3,
});
assert.equal(inventoryPersisted.length, inventorySaveCount, 'idempotent sale must not write a second snapshot');
assert.equal(inventory.snapshot().state?.inventory, t231Inventory.save());
assertSharedBindings('after inventory mutations');

// Empty projections are real contract states and reject writes without inventing data.
const emptyCity = new CityPageService(createEmptyCityPageData());
assert.deepEqual(emptyCity.snapshot(0).components.map(({ id }) => id), ['city-empty']);
assert.deepEqual(emptyCity.selectBuildingAt(0), { accepted: false, changed: false, reason: 'empty', buildingId: null });
assert.deepEqual(emptyCity.dispatchExpedition(0), { accepted: false, changed: false, reason: 'empty', buildingId: null });
const emptyTasks = new TasksPageService(createEmptyTasksPageData());
assert.deepEqual(emptyTasks.snapshot().components.map(({ id }) => id), ['tasks-empty']);
assert.deepEqual(emptyTasks.selectTask('M4-10-L01'), { accepted: false, changed: false, reason: 'empty', taskId: null, progress: null });
assert.deepEqual(emptyTasks.claimTask(), { accepted: false, changed: false, reason: 'empty', taskId: null, progress: null });
const emptyInventory = new InventoryPageService({ data: createDefaultInventoryPageData(), capacity: 2 });
assert.deepEqual(emptyInventory.snapshot().components.map(({ id }) => id), ['header', 'filters', 'equipped-slots', 'inventory-empty']);
assert.equal(emptyInventory.snapshot().components.at(-1).reason, 'noItems');
assert.deepEqual(emptyInventory.selectEquipment('E-NOPE'), { accepted: false, changed: false, reason: 'empty', equipmentId: null });
const unavailableInventory = new InventoryPageService(createEmptyInventoryPageData());
assert.deepEqual(unavailableInventory.snapshot().components.map(({ id }) => id), ['inventory-empty']);
assert.equal(unavailableInventory.snapshot().state, null);

// Fail-closed反例：缺失、非法、越界和持久化失败均不得留下半个状态。
expectError('CITY missing resources', () => {
  const invalid = createDefaultState();
  delete invalid.resources;
  return new CityPageService({ state: invalid });
}, CityPageError, 'MISSING_FIELD');
expectError('CITY unknown building', () => city.selectBuilding('unknown'), CityPageError, 'INVALID_ID');
expectError('CITY building index overflow', () => city.selectBuildingAt(99), CityPageError, 'INDEX_OUT_OF_RANGE');
expectError('CITY fractional time', () => city.dispatchExpedition(0.5), CityPageError, 'INVALID_NUMBER');
expectError('CITY unsupported interaction field', () => city.interact({ type: 'dispatchExpedition', unexpected: true }), CityPageError, 'INVALID_DATA');
expectError('TASKS unknown task', () => tasks.selectTask('M4-10-NOPE'), TasksPageError, 'TASK_NOT_FOUND');
expectError('TASKS future event before active task', () => {
  const fresh = new TasksPageService({ data: taskData });
  return fresh.advanceTask('M4-10-L01', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'NOPE' });
}, TasksPageError, 'TASK_NOT_READY');
expectError('TASKS duplicate definitions', () => createTasksPageData({ tasks: [taskData.tasks[0], taskData.tasks[0]] }), TasksPageError, 'DUPLICATE_ID');
expectError('TASKS malformed save', () => new TasksPageService({ data: taskData, initialState: '{bad-json' }), TasksPageError, 'INVALID_SAVE');
expectError('INVENTORY unknown equipment', () => inventory.selectEquipment('E-T247-NOPE'), InventoryPageError, 'EQUIPMENT_NOT_FOUND');
expectError('INVENTORY index overflow', () => inventory.selectEquipmentAt(99), InventoryPageError, 'INDEX_OUT_OF_RANGE');
expectError('INVENTORY invalid filter', () => inventory.setFilter({ qualities: [99] }), InventoryPageError, 'INVALID_FILTER');
expectError('INVENTORY invalid sort', () => inventory.setSort({ field: 'not-a-field', direction: 'asc' }), InventoryPageError, 'INVALID_SORT');
expectError('INVENTORY malformed interaction', () => inventory.interact({ type: 'clearFilter', unexpected: true }), InventoryPageError, 'INVALID_ARGUMENT');
expectError('INVENTORY empty page persistence', () => new InventoryPageService({ data: createEmptyInventoryPageData(), persist: () => {} }), InventoryPageError, 'STATE_NOT_AVAILABLE');
expectError('T231 malformed snapshot', () => EquipmentInventoryService.restore(JSON.stringify({ schemaVersion: 1, capacity: 0, items: [], equipped: { weapon: null, helmet: null, armor: null, cloak: null }, sort: { field: 'equipmentId', direction: 'asc' }, processedRequests: [] })), EquipmentInventoryError, 'INVALID_STATE');

const cityFailureState = createDefaultState();
const cityFailureBefore = JSON.stringify(cityFailureState);
const failingCity = new CityPageService({ state: cityFailureState, persist: () => { throw new Error('city store unavailable'); } });
expectError('CITY persistence failure rollback', () => failingCity.upgradeBuilding('forge'), CityPageError, 'PERSISTENCE_FAILED');
assert.equal(JSON.stringify(cityFailureState), cityFailureBefore);
assert.equal(failingCity.state.buildings.forge, 2);

const failingTasks = new TasksPageService({ data: taskData, persist: () => { throw new Error('task store unavailable'); } });
const failingTasksBefore = failingTasks.serialize();
expectError('TASKS persistence failure rollback', () => failingTasks.advanceTask('M4-10-L01', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' }), TasksPageError, 'PERSISTENCE_FAILED');
assert.equal(failingTasks.serialize(), failingTasksBefore);
assert.equal(failingTasks.state.tasks['M4-10-L01'].progress, 0);

const failingInventoryService = new EquipmentInventoryService({
  capacity: 2,
  state: {
    schemaVersion: EQUIPMENT_INVENTORY_SCHEMA_VERSION,
    capacity: 2,
    items: [item('E-T247-FAIL', 'cloak', 1, 'draw', 1)],
    equipped: { weapon: null, helmet: null, armor: null, cloak: null },
    sort: { field: 'equipmentId', direction: 'asc' },
    processedRequests: [],
  },
});
const failingInventory = new InventoryPageService({
  data: createDefaultInventoryPageData(),
  inventory: failingInventoryService,
  persist: () => { throw new Error('inventory store unavailable'); },
});
const failingInventoryBefore = failingInventory.serialize();
expectError('INVENTORY persistence failure rollback', () => failingInventory.toggleLock('E-T247-FAIL', true), InventoryPageError, 'PERSISTENCE_FAILED');
assert.equal(failingInventory.serialize(), failingInventoryBefore);
assert.equal(failingInventoryService.get('E-T247-FAIL').locked, false);

assert(cityPersisted.length >= 3, 'CITY success transitions must persist upgrade, dispatch and claim');
assert(taskPersisted.length >= 3, 'TASKS progress and claims must persist real snapshots');
assert(inventoryPersisted.length >= 4, 'INVENTORY filter/lock/equip/sell transitions must persist real snapshots');
assert(negativeCaseCount >= 15, 'integration must execute missing, invalid, out-of-range and failure counterexamples');
assertSharedBindings('final');

console.log(`T247 CITY/TASKS/INVENTORY integration PASS: real-levels=${realLevels.length}, city-saves=${cityPersisted.length}, task-saves=${taskPersisted.length}, inventory-saves=${inventoryPersisted.length}, negative-cases=${negativeCaseCount}, shared-state/empty/fail-closed`);
