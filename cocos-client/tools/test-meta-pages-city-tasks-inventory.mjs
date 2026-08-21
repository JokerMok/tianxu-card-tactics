import nodeAssert from 'node:assert/strict';
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

let assertCount = 0;
const assert = new Proxy(nodeAssert, {
  apply(target, thisArg, args) {
    assertCount += 1;
    return Reflect.apply(target, thisArg, args);
  },
  get(target, property, receiver) {
    const value = Reflect.get(target, property, receiver);
    if (typeof value !== 'function') return value;
    return (...args) => {
      assertCount += 1;
      return Reflect.apply(value, target, args);
    };
  },
});

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

class MetaStateContainer {
  constructor() {
    this.schemaVersion = 1;
    this.live = { city: null, tasks: null, inventory: null };
    this.persisted = { city: null, tasks: null, inventory: null };
    this.writes = [];
  }

  persist(page, serialized) {
    this.persisted = { ...this.persisted, [page]: serialized };
    this.writes.push({ page, envelope: this.save() });
  }

  seed(services) {
    this.persisted = {
      city: services.city.serialize(),
      tasks: services.tasks.serialize(),
      inventory: services.inventory.serialize(),
    };
    this.capture(services);
  }

  capture(services) {
    this.live = {
      city: services.city.serialize(),
      tasks: services.tasks.serialize(),
      inventory: services.inventory.serialize(),
    };
    return this.live;
  }

  save() {
    return JSON.stringify({ schemaVersion: this.schemaVersion, pages: this.persisted });
  }

  restoreOptions() {
    const envelope = JSON.parse(this.save());
    return {
      cityState: JSON.parse(envelope.pages.city),
      taskState: envelope.pages.tasks,
      inventoryState: envelope.pages.inventory,
    };
  }
}

// The task definitions and level documents are the production authorities for this group.
const realLevels = MAINLINE_TASK_DEFINITIONS.map(({ trigger }) => {
  const levelId = trigger.levelId;
  const document = readJson(path.join(levelRoot, `${levelId}.json`));
  assert.equal(document.chapterLevels.length, 1, `${levelId} must have one real chapter level`);
  assert.equal(document.chapterLevels[0].id, levelId, `${levelId} must match its production file`);
  return document.chapterLevels[0];
});
assert.equal(realLevels.length, 12, 'integration must use all real chapter levels');
assert.equal(realLevels[0].id, 'L01');
assert.equal(realLevels[1].id, 'L02');
assert.equal(realLevels[2].id, 'L03');
assert.equal(realLevels[3].id, 'L04');
assert.equal(realLevels[4].id, 'L05');
assert.equal(realLevels[5].id, 'L06');
assert.equal(realLevels[6].id, 'L07');
assert.equal(realLevels[7].id, 'L08');
assert.equal(realLevels[8].id, 'L09');
assert.equal(realLevels[9].id, 'L10');
assert.equal(realLevels[10].id, 'L11');
assert.equal(realLevels[11].id, 'L12');
assert.equal(realLevels[0].enemyDeckId, 'D001');
assert.equal(realLevels[11].enemyDeckId, 'D001');
assert.equal(realLevels[0].objectives.length, 1);
assert.equal(realLevels[11].failureConditions.length, 2);

const taskData = createTasksPageData({ taskDefinitions: MAINLINE_TASK_DEFINITIONS });
assert.deepEqual(taskData.tasks.map(({ id }) => id), MAINLINE_TASK_DEFINITIONS.map(({ id }) => id));
assert.deepEqual(taskData.tasks.map(({ trigger }) => trigger.levelId), realLevels.map(({ id }) => id));
assert.equal(taskData.tasks.length, 12);
assert.equal(taskData.tasks[0].id, 'M4-10-L01');
assert.equal(taskData.tasks[1].id, 'M4-10-L02');
assert.equal(taskData.tasks[2].id, 'M4-10-L03');
assert.equal(taskData.tasks[3].id, 'M4-10-L04');
assert.equal(taskData.tasks[4].id, 'M4-10-L05');
assert.equal(taskData.tasks[5].id, 'M4-10-L06');
assert.equal(taskData.tasks[6].id, 'M4-10-L07');
assert.equal(taskData.tasks[7].id, 'M4-10-L08');
assert.equal(taskData.tasks[8].id, 'M4-10-L09');
assert.equal(taskData.tasks[9].id, 'M4-10-L10');
assert.equal(taskData.tasks[10].id, 'M4-10-L11');
assert.equal(taskData.tasks[11].id, 'M4-10-L12');
assert.equal(taskData.tasks[0].target, 1);
assert.equal(taskData.tasks[11].target, 1);
assert.equal(taskData.tasks[0].trigger.levelId, 'L01');
assert.equal(taskData.tasks[11].trigger.levelId, 'L12');

// One integration context owns all three production snapshots and one durable envelope.
// Each page still uses its production service, but all writes flow through this container.
const gameState = createDefaultState();
const sharedStore = new MetaStateContainer();
const cityPersisted = [];
const city = new CityPageService({
  state: gameState,
  onStateChange: (candidate) => { sharedStore.live.cityCandidate = candidate; },
  persist: (serialized) => {
    cityPersisted.push(serialized);
    sharedStore.persist('city', serialized);
  },
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
  persist: (serialized) => {
    inventoryPersisted.push(serialized);
    sharedStore.persist('inventory', serialized);
  },
});

const taskPersisted = [];
const tasks = new TasksPageService({
  data: taskData,
  persist: (serialized) => {
    taskPersisted.push(serialized);
    sharedStore.persist('tasks', serialized);
  },
});

sharedStore.seed({ city, tasks, inventory });

function assertSharedState(label) {
  const live = sharedStore.capture({ city, tasks, inventory });
  const persisted = JSON.parse(sharedStore.save());
  const restored = sharedStore.restoreOptions();
  assert.equal(persisted.schemaVersion, 1, `${label}: unified envelope schema is stable`);
  assert.equal(typeof persisted.pages.city, 'string', `${label}: unified envelope stores CITY`);
  assert.equal(typeof persisted.pages.tasks, 'string', `${label}: unified envelope stores TASKS`);
  assert.equal(typeof persisted.pages.inventory, 'string', `${label}: unified envelope stores INVENTORY`);
  assert.deepEqual(JSON.parse(live.city), gameState, `${label}: CITY live container equals attached GameState`);
  assert.deepEqual(JSON.parse(live.tasks), tasks.state, `${label}: TASKS live container equals service state`);
  assert.equal(JSON.parse(live.inventory).inventory, t231Inventory.save(), `${label}: INVENTORY live container equals T231 save`);
  assert.deepEqual(JSON.parse(persisted.pages.city), gameState, `${label}: CITY persisted state equals underlying state`);
  assert.deepEqual(JSON.parse(persisted.pages.tasks), tasks.state, `${label}: TASKS persisted state equals underlying state`);
  assert.equal(JSON.parse(persisted.pages.inventory).inventory, t231Inventory.save(), `${label}: INVENTORY persisted state equals underlying state`);
  assert.deepEqual(restored.cityState, gameState, `${label}: CITY reload input matches current state`);
  assert.equal(restored.taskState, tasks.serialize(), `${label}: TASKS reload input matches current state`);
  assert.equal(restored.inventoryState, inventory.serialize(), `${label}: INVENTORY reload input matches current state`);
  const cityReload = new CityPageService({ state: restored.cityState, initialSelectedBuildingId: city.snapshot().selectedBuildingId });
  const taskReload = new TasksPageService({ data: taskData, initialState: restored.taskState });
  const restoredTaskSelection = taskReload.selectTask(tasks.snapshot().selectedTaskId);
  assert.equal(restoredTaskSelection.accepted, true, `${label}: TASKS selection can be restored`);
  assert.equal(taskReload.snapshot().selectedTaskId, tasks.snapshot().selectedTaskId, `${label}: TASKS selection matches the live projection`);
  const inventoryReload = new InventoryPageService({
    data: createDefaultInventoryPageData({ title: '真实组级行囊', subtitle: 'T231 快照绑定' }),
    initialState: restored.inventoryState,
  });
  assert.deepEqual(cityReload.snapshot(61000), city.snapshot(61000), `${label}: CITY projection survives reload`);
  assert.deepEqual(taskReload.snapshot(), tasks.snapshot(), `${label}: TASKS projection survives reload`);
  assert.deepEqual(inventoryReload.snapshot(), inventory.snapshot(), `${label}: INVENTORY projection survives reload`);
  assert.equal(cityReload.state.version, 1, `${label}: reloaded CITY keeps version`);
  assert.equal(taskReload.state.schemaVersion, tasks.state.schemaVersion, `${label}: reloaded TASKS keeps schema`);
  assert.equal(inventoryReload.snapshot().state.inventory, t231Inventory.save(), `${label}: reloaded INVENTORY keeps T231 items`);
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
assert.equal(cityInitial.components.length, 6);
assert.equal(cityInitial.components[0].id, 'header');
assert.equal(cityInitial.components[1].buildingId, 'castle');
assert.equal(cityInitial.components[2].buildingId, 'alchemy');
assert.equal(cityInitial.components[3].buildingId, 'forge');
assert.equal(cityInitial.components[4].buildingId, 'harbor');
assert.equal(cityInitial.components[5].id, 'expedition');
assert.deepEqual(cityInitial.components.find(({ id }) => id === 'header').silver, 12800);
assert.equal(cityInitial.components.find(({ id }) => id === 'header').crystal, 460);
assert.equal(cityInitial.components.find(({ id }) => id === 'header').stamina, 82);
assert.equal(cityInitial.components.find(({ id }) => id === 'header').staminaMax, 100);
assert.equal(cityInitial.components.find(({ id }) => id === 'header').selectedBuildingId, 'castle');
assert.deepEqual(cityInitial.components.filter(({ kind }) => kind === 'building').map(({ buildingId }) => buildingId), [...CITY_BUILDING_IDS]);
assert.equal(cityInitial.components.find(({ id }) => id === 'building-castle').level, 3);
assert.equal(cityInitial.components.find(({ id }) => id === 'building-castle').maxLevel, 4);
assert.equal(cityInitial.components.find(({ id }) => id === 'building-alchemy').level, 2);
assert.equal(cityInitial.components.find(({ id }) => id === 'building-alchemy').maxLevel, 3);
assert.equal(cityInitial.components.find(({ id }) => id === 'building-forge').level, 2);
assert.equal(cityInitial.components.find(({ id }) => id === 'building-forge').maxLevel, 3);
assert.equal(cityInitial.components.find(({ id }) => id === 'building-harbor').level, 1);
assert.equal(cityInitial.components.find(({ id }) => id === 'building-harbor').maxLevel, 3);
assert.equal(cityInitial.components.find(({ id }) => id === 'expedition').state, 'idle');
assert.equal(cityInitial.components.find(({ id }) => id === 'expedition').canDispatch, true);
assert.equal(cityInitial.components.find(({ id }) => id === 'expedition').canClaim, false);
assert.equal(taskInitial.pageId, 'tasks');
assert.equal(taskInitial.components.length, 14);
assert.equal(taskInitial.components[0].id, 'header');
assert.equal(taskInitial.components.at(-1).id, 'detail');
assert.equal(taskInitial.components.find(({ id }) => id === 'header').totalTasks, realLevels.length);
assert.equal(taskInitial.components.find(({ id }) => id === 'header').completedTasks, 0);
assert.equal(taskInitial.components.find(({ id }) => id === 'header').pendingRewardCount, 0);
assert.equal(taskInitial.components.find(({ id }) => id === 'task-M4-10-L01').progress, 0);
assert.equal(taskInitial.components.find(({ id }) => id === 'task-M4-10-L01').target, 1);
assert.equal(taskInitial.components.find(({ id }) => id === 'task-M4-10-L01').triggerLabel, '通关 L01');
assert.equal(taskInitial.components.find(({ id }) => id === 'task-M4-10-L01').state, 'ready');
assert.equal(taskInitial.components.find(({ id }) => id === 'task-M4-10-L02').state, 'locked');
assert.equal(taskInitial.components.find(({ id }) => id === 'detail').taskId, 'M4-10-L01');
assert.equal(taskInitial.components.find(({ id }) => id === 'detail').rewardPoolId, 'chapter01:L01');
assert.equal(inventoryInitial.pageId, 'inventory');
assert.equal(inventoryInitial.components.length, 7);
assert.equal(inventoryInitial.components[0].id, 'header');
assert.equal(inventoryInitial.components[1].id, 'filters');
assert.equal(inventoryInitial.components[2].id, 'equipped-slots');
assert.equal(inventoryInitial.components.find(({ id }) => id === 'header').totalItems, 3);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'header').equippedItems, 1);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'header').visibleItems, 3);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'header').usedCapacity, 3);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'header').capacity, 6);
assert.deepEqual(inventoryInitial.components.find(({ id }) => id === 'filters').filter, {});
assert.equal(inventoryInitial.components.find(({ id }) => id === 'filters').filter.slot, undefined);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'filters').filter.qualities, undefined);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'equipped-slots').slots.helmet.equipmentId, 'E-T247-HELMET');
assert.equal(inventoryInitial.components.find(({ id }) => id === 'equipped-slots').slots.weapon, null);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'equipped-slots').slots.armor, null);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'equipped-slots').slots.cloak, null);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'equipment-E-T247-ARMOR').quality, 3);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'equipment-E-T247-ARMOR').locked, true);
assert.equal(inventoryInitial.components.find(({ id }) => id === 'equipment-E-T247-CLOAK').slot, 'cloak');
assert.equal(inventoryInitial.components.find(({ id }) => id === 'equipment-E-T247-WEAPON').primaryValue, 12);
assert.equal(inventoryInitial.state?.inventory, t231Inventory.save());
assertSharedState('initial');

// CITY: real upgrade, timer boundary, expedition claim, and resource guards.
const cityUpgrade = city.upgradeBuilding('forge');
assert.deepEqual(cityUpgrade, { accepted: true, changed: true, reason: 'upgraded', buildingId: 'forge' });
assert.equal(gameState.buildings.forge, 3);
assert.equal(gameState.resources.silver, 10000);
assert.equal(gameState.resources.crystal, 380);
assert.equal(JSON.parse(cityPersisted.at(-1)).buildings.forge, 3);
assert.equal(JSON.parse(cityPersisted.at(-1)).resources.silver, 10000);
assert.equal(JSON.parse(cityPersisted.at(-1)).resources.crystal, 380);
assert.equal(city.snapshot(0).components.find(({ id }) => id === 'building-forge').level, 3);
assert.equal(city.snapshot(0).components.find(({ id }) => id === 'building-forge').state, 'maxed');
assert.equal(city.snapshot(0).components.find(({ id }) => id === 'building-forge').canUpgrade, false);
assert.equal(city.snapshot(0).selectedBuildingId, 'forge');

const cityDispatch = city.dispatchExpedition(1000);
assert.deepEqual(cityDispatch, { accepted: true, changed: true, reason: 'dispatched', buildingId: null });
assert.equal(gameState.resources.stamina, 72);
assert.equal(JSON.parse(cityPersisted.at(-1)).resources.stamina, 72);
assert.equal(gameState.expedition.endsAt, 61000);
assert.equal(JSON.parse(cityPersisted.at(-1)).expedition.active, true);
assert.equal(JSON.parse(cityPersisted.at(-1)).expedition.reward, 1600);
assert.equal(city.snapshot(60999).components.find(({ id }) => id === 'expedition').state, 'active');
assert.equal(city.snapshot(60999).components.find(({ id }) => id === 'expedition').canDispatch, false);
assert.equal(city.snapshot(60999).components.find(({ id }) => id === 'expedition').canClaim, false);
assert.deepEqual(city.claimExpedition(60999), { accepted: false, changed: false, reason: 'active', buildingId: null });
assert.deepEqual(city.claimExpedition(61000), { accepted: true, changed: true, reason: 'claimed', buildingId: null });
assert.equal(gameState.resources.silver, 11600);
assert.equal(JSON.parse(cityPersisted.at(-1)).resources.silver, 11600);
assert.deepEqual(gameState.expedition, { active: false, endsAt: 0, reward: 0 });
assert.equal(city.snapshot(61000).components.find(({ id }) => id === 'expedition').state, 'idle');
assert.equal(city.snapshot(61000).components.find(({ id }) => id === 'expedition').canDispatch, true);
assert.equal(city.snapshot(61000).components.find(({ id }) => id === 'expedition').canClaim, false);
assert.equal(sharedStore.writes.at(-1).page, 'city');
assertSharedState('after city mutations');

const insufficientCityState = createDefaultState();
insufficientCityState.resources.silver = 100;
insufficientCityState.resources.crystal = 10;
insufficientCityState.resources.stamina = 5;
const insufficientCity = new CityPageService({ state: insufficientCityState });
assert.deepEqual(insufficientCity.upgradeBuilding('alchemy'), { accepted: false, changed: false, reason: 'insufficient', buildingId: 'alchemy' });
assert.deepEqual(insufficientCity.dispatchExpedition(0), { accepted: false, changed: false, reason: 'insufficient', buildingId: null });
assert.equal(insufficientCityState.buildings.alchemy, 2);
assert.equal(insufficientCityState.resources.silver, 100);
assert.equal(insufficientCityState.resources.crystal, 10);
assert.equal(insufficientCityState.resources.stamina, 5);
assert.equal(insufficientCity.snapshot(0).components.find(({ id }) => id === 'building-alchemy').state, 'insufficient');
assert.equal(insufficientCity.snapshot(0).components.find(({ id }) => id === 'expedition').canDispatch, false);

const maxedCityState = createDefaultState();
maxedCityState.buildings.forge = 3;
const maxedCity = new CityPageService({ state: maxedCityState });
assert.deepEqual(maxedCity.upgradeBuilding('forge'), { accepted: false, changed: false, reason: 'maxed', buildingId: 'forge' });
assert.equal(maxedCityState.buildings.forge, 3);
assert.equal(maxedCity.snapshot(0).components.find(({ id }) => id === 'building-forge').state, 'maxed');
assert.equal(maxedCity.snapshot(0).components.find(({ id }) => id === 'building-forge').canUpgrade, false);

// TASKS: real definitions, progress, duplicate event key, claim/outbox, restore, and failure atomicity.
const advanceL01 = tasks.advanceTask('M4-10-L01', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' });
assert.deepEqual(advanceL01, { accepted: true, changed: true, reason: 'completed', taskId: 'M4-10-L01', progress: 1 });
assert.equal(tasks.state.tasks['M4-10-L01'].completed, true);
assert.equal(tasks.state.features.deck.unlocked, true);
assert.equal(tasks.state.tasks['M4-10-L01'].progress, 1);
assert.equal(tasks.state.tasks['M4-10-L01'].target, 1);
assert.deepEqual(tasks.state.tasks['M4-10-L01'].eventKeys, ['CAMPAIGN_LEVEL_CLEARED:L01']);
assert.equal(tasks.snapshot().components.find(({ id }) => id === 'task-M4-10-L01').state, 'completed');
assert.equal(tasks.snapshot().components.find(({ id }) => id === 'task-M4-10-L02').state, 'ready');
assert.deepEqual(
  tasks.advanceTask('M4-10-L01', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' }),
  { accepted: false, changed: false, reason: 'duplicate', taskId: 'M4-10-L01', progress: 1 },
);
assert.equal(taskPersisted.length, 1, 'duplicate task events must not persist');
assert.equal(tasks.state.tasks['M4-10-L01'].eventKeys.length, 1);
const claimL01 = tasks.claimTask('M4-10-L01');
assert.deepEqual(claimL01, { accepted: true, changed: true, reason: 'claimed', taskId: 'M4-10-L01', progress: 1 });
const taskBusinessKey = 'mainline:CHAPTER01:M4-10-L01';
assert.equal(tasks.state.rewardOutbox.entries[taskBusinessKey].status, 'PENDING');
assert.equal(tasks.state.tasks['M4-10-L01'].claimed, true);
assert.equal(tasks.snapshot().components.find(({ id }) => id === 'header').completedTasks, 1);
assert.equal(tasks.snapshot().components.find(({ id }) => id === 'header').pendingRewardCount, 1);
assert.equal(taskPersisted.length, 2, 'successful task claim must persist');
assert.deepEqual(tasks.advanceTask('M4-10-L02', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L02' }), {
  accepted: true, changed: true, reason: 'completed', taskId: 'M4-10-L02', progress: 1,
});
assert.equal(tasks.snapshot().components.find(({ id }) => id === 'task-M4-10-L03').state, 'ready');
assert.equal(tasks.state.tasks['M4-10-L02'].progress, 1);
assert.equal(tasks.state.tasks['M4-10-L02'].completed, true);
assert.equal(tasks.state.tasks['M4-10-L02'].eventKeys[0], 'CAMPAIGN_LEVEL_CLEARED:L02');
assert.equal(sharedStore.writes.at(-1).page, 'tasks');
const restoredTasks = new TasksPageService({ data: taskData, initialState: tasks.serialize() });
assert.deepEqual(restoredTasks.snapshot().state, tasks.snapshot().state, 'TASKS restore must preserve the real state snapshot');
assert.equal(restoredTasks.serialize(), tasks.serialize(), 'TASKS save must be deterministic');
assert.equal(restoredTasks.snapshot().components.find(({ id }) => id === 'task-M4-10-L01').state, 'claimed');
assert.equal(restoredTasks.snapshot().components.find(({ id }) => id === 'task-M4-10-L03').state, 'ready');
assertSharedState('after tasks mutations');

// Incremental progress must count distinct stages exactly once and ignore replayed events.
const incrementalTasks = new TasksPageService({ data: createTasksPageData({ tasks: [{
  id: 'incremental-deck',
  title: '增量阶段去重',
  target: 3,
  trigger: { type: 'DECK_UPDATED' },
  unlocks: [],
  rewardPoolId: null,
}] }) });
const incrementalStepOne = incrementalTasks.advanceTask(undefined, { type: 'DECK_UPDATED', key: 'phase-1' });
assert.deepEqual(incrementalStepOne, { accepted: true, changed: true, reason: 'progressed', taskId: 'incremental-deck', progress: 1 });
assert.equal(incrementalTasks.state.tasks['incremental-deck'].progress, 1);
assert.equal(incrementalTasks.state.tasks['incremental-deck'].completed, false);
assert.deepEqual(incrementalTasks.state.tasks['incremental-deck'].eventKeys, ['DECK_UPDATED:phase-1']);
const incrementalAfterOne = incrementalTasks.serialize();
const incrementalDuplicate = incrementalTasks.advanceTask(undefined, { type: 'DECK_UPDATED', key: 'phase-1' });
assert.deepEqual(incrementalDuplicate, { accepted: false, changed: false, reason: 'duplicate', taskId: 'incremental-deck', progress: 1 });
assert.equal(incrementalTasks.serialize(), incrementalAfterOne);
assert.equal(incrementalTasks.state.tasks['incremental-deck'].eventKeys.length, 1);
const incrementalStepTwo = incrementalTasks.advanceTask(undefined, { type: 'DECK_UPDATED', key: 'phase-2' });
assert.deepEqual(incrementalStepTwo, { accepted: true, changed: true, reason: 'progressed', taskId: 'incremental-deck', progress: 2 });
assert.equal(incrementalTasks.state.tasks['incremental-deck'].progress, 2);
assert.equal(incrementalTasks.state.tasks['incremental-deck'].completed, false);
assert.equal(incrementalTasks.state.tasks['incremental-deck'].eventKeys[1], 'DECK_UPDATED:phase-2');
const incrementalAfterTwo = incrementalTasks.serialize();
assert.deepEqual(incrementalTasks.advanceTask(undefined, { type: 'DECK_UPDATED', key: 'phase-2' }), { accepted: false, changed: false, reason: 'duplicate', taskId: 'incremental-deck', progress: 2 });
assert.equal(incrementalTasks.serialize(), incrementalAfterTwo);
const incrementalStepThree = incrementalTasks.advanceTask(undefined, { type: 'DECK_UPDATED', key: 'phase-3' });
assert.deepEqual(incrementalStepThree, { accepted: true, changed: true, reason: 'completed', taskId: 'incremental-deck', progress: 3 });
assert.equal(incrementalTasks.state.tasks['incremental-deck'].progress, 3);
assert.equal(incrementalTasks.state.tasks['incremental-deck'].completed, true);
assert.equal(incrementalTasks.state.tasks['incremental-deck'].eventKeys.length, 3);
assert.equal(new TasksPageService({ data: incrementalTasks.pageData, initialState: incrementalTasks.serialize() }).serialize(), incrementalTasks.serialize());

// INVENTORY: quantity, filtering, locking, equip/sell and T231 live-state binding.
const filterResult = inventory.setFilter({ slot: 'armor', qualities: [3] });
assert.deepEqual(filterResult, { accepted: true, changed: true, reason: 'filtered', equipmentId: 'E-T247-ARMOR' });
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'header').visibleItems, 1);
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'header').totalItems, 3);
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'filters').filter.slot, 'armor');
assert.deepEqual(inventory.snapshot().components.find(({ id }) => id === 'filters').filter.qualities, [3]);
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'equipment-E-T247-ARMOR').slot, 'armor');
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'equipment-E-T247-ARMOR').locked, true);
const lockedArmorBeforeSale = inventory.serialize();
expectError('INVENTORY locked equipment cannot be sold', () => inventory.sell('sell-locked-armor', 'E-T247-ARMOR'), InventoryPageError, 'EQUIPMENT_LOCKED');
assert.equal(inventory.serialize(), lockedArmorBeforeSale);
assert.equal(t231Inventory.get('E-T247-ARMOR').locked, true);
assert.deepEqual(inventory.toggleLock('E-T247-ARMOR', false), {
  accepted: true, changed: true, reason: 'unlocked', equipmentId: 'E-T247-ARMOR',
});
assert.equal(t231Inventory.get('E-T247-ARMOR').locked, false);
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'equipment-E-T247-ARMOR').locked, false);
assert.deepEqual(inventory.clearFilter(), { accepted: true, changed: true, reason: 'filtered', equipmentId: 'E-T247-ARMOR' });
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'filters').filter.slot, undefined);
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'filters').filter.qualities, undefined);
assert.deepEqual(inventory.equip('E-T247-WEAPON'), {
  accepted: true, changed: true, reason: 'equipped', equipmentId: 'E-T247-WEAPON', slot: 'weapon',
});
assert.equal(t231Inventory.snapshot().equipped.weapon.equipmentId, 'E-T247-WEAPON');
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'equipped-slots').slots.weapon.equipmentId, 'E-T247-WEAPON');
assert.equal(inventory.snapshot().selectedEquipmentId, 'E-T247-WEAPON');
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'header').usedCapacity, 2);
assert.equal(inventory.snapshot().components.find(({ id }) => id === 'header').equippedItems, 2);
assert.deepEqual(inventory.sell('sell-t247-armor', 'E-T247-ARMOR'), {
  accepted: true, changed: true, reason: 'sold', equipmentId: 'E-T247-ARMOR', totalValue: 3,
});
assert.equal(t231Inventory.snapshot().items.some(({ equipmentId }) => equipmentId === 'E-T247-ARMOR'), false);
assert.equal(t231Inventory.snapshot().items.length, 1);
assert.equal(t231Inventory.snapshot().equipped.helmet.equipmentId, 'E-T247-HELMET');
assert.equal(t231Inventory.snapshot().equipped.weapon.equipmentId, 'E-T247-WEAPON');
assert.equal(inventory.snapshot().components.some(({ id }) => id === 'equipment-E-T247-ARMOR'), false);
assert.equal(sharedStore.writes.at(-1).page, 'inventory');
const inventorySaveCount = inventoryPersisted.length;
assert.deepEqual(inventory.sell('sell-t247-armor', 'E-T247-ARMOR'), {
  accepted: true, changed: false, reason: 'idempotent', equipmentId: 'E-T247-ARMOR', totalValue: 3,
});
assert.equal(inventoryPersisted.length, inventorySaveCount, 'idempotent sale must not write a second snapshot');
assert.equal(t231Inventory.snapshot().processedRequests.length, 1);
assert.equal(t231Inventory.snapshot().processedRequests[0].requestId, 'sell-t247-armor');
assert.equal(inventory.snapshot().state?.inventory, t231Inventory.save());
assertSharedState('after inventory mutations');

// Empty projections are real contract states and reject writes without inventing data.
const emptyCity = new CityPageService(createEmptyCityPageData());
assert.deepEqual(emptyCity.snapshot(0).components.map(({ id }) => id), ['city-empty']);
assert.equal(emptyCity.snapshot(0).pageId, 'city');
assert.equal(emptyCity.snapshot(0).components[0].state, 'empty');
assert.deepEqual(emptyCity.selectBuildingAt(0), { accepted: false, changed: false, reason: 'empty', buildingId: null });
assert.deepEqual(emptyCity.dispatchExpedition(0), { accepted: false, changed: false, reason: 'empty', buildingId: null });
const emptyTasks = new TasksPageService(createEmptyTasksPageData());
assert.deepEqual(emptyTasks.snapshot().components.map(({ id }) => id), ['tasks-empty']);
assert.equal(emptyTasks.snapshot().pageId, 'tasks');
assert.equal(emptyTasks.snapshot().state, null);
assert.deepEqual(emptyTasks.selectTask('M4-10-L01'), { accepted: false, changed: false, reason: 'empty', taskId: null, progress: null });
assert.deepEqual(emptyTasks.claimTask(), { accepted: false, changed: false, reason: 'empty', taskId: null, progress: null });
const emptyInventory = new InventoryPageService({ data: createDefaultInventoryPageData(), capacity: 2 });
assert.deepEqual(emptyInventory.snapshot().components.map(({ id }) => id), ['header', 'filters', 'equipped-slots', 'inventory-empty']);
assert.equal(emptyInventory.snapshot().pageId, 'inventory');
assert.equal(emptyInventory.snapshot().state.inventory.includes('"capacity":2'), true);
assert.equal(emptyInventory.snapshot().components.at(-1).reason, 'noItems');
assert.deepEqual(emptyInventory.selectEquipment('E-NOPE'), { accepted: false, changed: false, reason: 'empty', equipmentId: null });
const unavailableInventory = new InventoryPageService(createEmptyInventoryPageData());
assert.deepEqual(unavailableInventory.snapshot().components.map(({ id }) => id), ['inventory-empty']);
assert.equal(unavailableInventory.snapshot().state, null);
assert.equal(unavailableInventory.snapshot().components[0].reason, 'unavailable');

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
assert.equal(failingCity.state.resources.silver, 12800);
assert.equal(failingCity.state.resources.crystal, 460);

let cityClaimFailureWrites = 0;
const cityClaimFailureState = createDefaultState();
const cityClaimFailure = new CityPageService({
  state: cityClaimFailureState,
  persist: () => {
    cityClaimFailureWrites += 1;
    if (cityClaimFailureWrites === 2) throw new Error('expedition reward store unavailable');
  },
});
assert.deepEqual(cityClaimFailure.dispatchExpedition(0), { accepted: true, changed: true, reason: 'dispatched', buildingId: null });
const cityClaimFailureBefore = JSON.stringify(cityClaimFailureState);
expectError('CITY expedition claim persistence failure rollback', () => cityClaimFailure.claimExpedition(60000), CityPageError, 'PERSISTENCE_FAILED');
assert.equal(JSON.stringify(cityClaimFailureState), cityClaimFailureBefore);
assert.equal(cityClaimFailure.state.expedition.active, true);
assert.equal(cityClaimFailure.state.expedition.endsAt, 60000);
assert.equal(cityClaimFailure.state.resources.silver, 12800);
assert.equal(cityClaimFailure.state.resources.stamina, 72);
assert.equal(cityClaimFailureWrites, 3);

const failingTasks = new TasksPageService({ data: taskData, persist: () => { throw new Error('task store unavailable'); } });
const failingTasksBefore = failingTasks.serialize();
expectError('TASKS persistence failure rollback', () => failingTasks.advanceTask('M4-10-L01', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' }), TasksPageError, 'PERSISTENCE_FAILED');
assert.equal(failingTasks.serialize(), failingTasksBefore);
assert.equal(failingTasks.state.tasks['M4-10-L01'].progress, 0);
assert.equal(failingTasks.state.tasks['M4-10-L01'].completed, false);
assert.equal(failingTasks.state.tasks['M4-10-L01'].eventKeys.length, 0);

let taskClaimFailureWrites = 0;
const taskClaimFailure = new TasksPageService({ data: taskData, persist: () => {
  taskClaimFailureWrites += 1;
  if (taskClaimFailureWrites === 2) throw new Error('task reward store unavailable');
} });
assert.deepEqual(taskClaimFailure.advanceTask('M4-10-L01', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' }), {
  accepted: true, changed: true, reason: 'completed', taskId: 'M4-10-L01', progress: 1,
});
const taskClaimFailureBefore = taskClaimFailure.serialize();
expectError('TASKS claim persistence failure rollback', () => taskClaimFailure.claimTask('M4-10-L01'), TasksPageError, 'PERSISTENCE_FAILED');
assert.equal(taskClaimFailure.serialize(), taskClaimFailureBefore);
assert.equal(taskClaimFailure.state.tasks['M4-10-L01'].claimed, false);
assert.equal(taskClaimFailure.state.rewardOutbox.entries['mainline:CHAPTER01:M4-10-L01'], undefined);
assert.equal(taskClaimFailureWrites, 2);

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
assert.equal(failingInventoryService.snapshot().items.length, 1);
assert.equal(failingInventoryService.snapshot().equipped.cloak, null);

const failingEquipService = new EquipmentInventoryService({
  capacity: 2,
  state: {
    schemaVersion: EQUIPMENT_INVENTORY_SCHEMA_VERSION,
    capacity: 2,
    items: [item('E-T247-EQUIP-FAIL', 'weapon', 2, 'attack', 8)],
    equipped: { weapon: null, helmet: null, armor: null, cloak: null },
    sort: { field: 'equipmentId', direction: 'asc' },
    processedRequests: [],
  },
});
const failingEquipPage = new InventoryPageService({ data: createDefaultInventoryPageData(), inventory: failingEquipService, persist: () => { throw new Error('equip store unavailable'); } });
const failingEquipBefore = failingEquipPage.serialize();
expectError('INVENTORY equip persistence failure rollback', () => failingEquipPage.equip('E-T247-EQUIP-FAIL'), InventoryPageError, 'PERSISTENCE_FAILED');
assert.equal(failingEquipPage.serialize(), failingEquipBefore);
assert.equal(failingEquipService.get('E-T247-EQUIP-FAIL').equipmentId, 'E-T247-EQUIP-FAIL');
assert.equal(failingEquipService.snapshot().equipped.weapon, null);
assert.equal(failingEquipService.snapshot().items.length, 1);

const failingSellService = new EquipmentInventoryService({
  capacity: 2,
  state: {
    schemaVersion: EQUIPMENT_INVENTORY_SCHEMA_VERSION,
    capacity: 2,
    items: [item('E-T247-SELL-FAIL', 'cloak', 2, 'draw', 2)],
    equipped: { weapon: null, helmet: null, armor: null, cloak: null },
    sort: { field: 'equipmentId', direction: 'asc' },
    processedRequests: [],
  },
});
const failingSellPage = new InventoryPageService({ data: createDefaultInventoryPageData(), inventory: failingSellService, persist: () => { throw new Error('sell store unavailable'); } });
const failingSellBefore = failingSellPage.serialize();
expectError('INVENTORY sell persistence failure rollback', () => failingSellPage.sell('sell-t247-fail', 'E-T247-SELL-FAIL'), InventoryPageError, 'PERSISTENCE_FAILED');
assert.equal(failingSellPage.serialize(), failingSellBefore);
assert.equal(failingSellService.get('E-T247-SELL-FAIL').equipmentId, 'E-T247-SELL-FAIL');
assert.equal(failingSellService.snapshot().processedRequests.length, 0);
assert.equal(failingSellService.snapshot().items.length, 1);

assert(cityPersisted.length >= 3, 'CITY success transitions must persist upgrade, dispatch and claim');
assert(taskPersisted.length >= 3, 'TASKS progress and claims must persist real snapshots');
assert(inventoryPersisted.length >= 4, 'INVENTORY filter/lock/equip/sell transitions must persist real snapshots');
assert.equal(cityPersisted[0] !== cityPersisted[1], true);
assert.equal(taskPersisted[0] !== taskPersisted[1], true);
assert.equal(inventoryPersisted[0] !== inventoryPersisted.at(-1), true);
assert(sharedStore.writes.length >= 9, 'unified persistence must record CITY -> TASKS -> INVENTORY writes');
assert(negativeCaseCount >= 19, 'integration must execute at least 19 real negative counterexamples');
assertSharedState('final');
assert(assertCount >= 212, `integration must execute at least 212 assertions; actual=${assertCount}`);

console.log(`T247 CITY/TASKS/INVENTORY integration PASS: assertCount=${assertCount}, real-levels=${realLevels.length}, real-tasks=${taskData.tasks.length}, buildings=${CITY_BUILDING_IDS.length}, city-saves=${cityPersisted.length}, task-saves=${taskPersisted.length}, inventory-saves=${inventoryPersisted.length}, unified-writes=${sharedStore.writes.length}, negative-cases=${negativeCaseCount}, shared-state/reload/rollback/empty/fail-closed`);
