import assert from 'node:assert/strict';
import {
  TowerShopConfigError,
  TowerShopError,
  TowerShopService,
  loadTowerShopConfig,
  restoreTowerShop,
  serializeTowerShop,
  towerShopConfig,
} from '../assets/scripts/pve/tower/shop/index.ts';

const rewardFloors = towerShopConfig.guaranteedCoinDrops.map(({ floor }) => floor);
assert.deepEqual(rewardFloors, [5, 10, 15, 20, 25, 30, 35, 40, 45, 50]);
assert.deepEqual(
  towerShopConfig.guaranteedCoinDrops.map(({ floor, amount }) => [floor, amount]),
  [[5, 20], [10, 25], [15, 30], [20, 35], [25, 40], [30, 45], [35, 50], [40, 60], [45, 70], [50, 90]],
  'each configured reward floor must have its exact tower coin amount',
);
assert(towerShopConfig.guaranteedCoinDrops.every(({ amount }) => Number.isSafeInteger(amount) && amount > 0));
assert.equal(towerShopConfig.items.length, 5);
assert.equal(towerShopConfig.offerCount, 3);
assert(towerShopConfig.items.every((item) => item.cost > 0 && item.purchaseLimit > 0 && item.reward.quantity > 0));
assert(Object.isFrozen(towerShopConfig));
assert(Object.isFrozen(towerShopConfig.items));

function expectError(label, action, code) {
  assert.throws(
    action,
    (error) => error instanceof TowerShopError && error.code === code,
    `${label} must fail with ${code}`,
  );
}

function expectConfigError(label, action) {
  assert.throws(action, (error) => error instanceof TowerShopConfigError, `${label} must reject invalid shop config`);
}

const persisted = [];
const service = new TowerShopService({
  cycleKey: '2026-08-17',
  persist: (serialized) => persisted.push(serialized),
});
const initial = service.snapshot();
assert.deepEqual(initial, {
  schemaVersion: 3,
  cycleKey: '2026-08-17',
  towerCoins: 0,
  inventory: {},
  claimedFloorRewards: [],
  purchased: {},
  offers: ['TOWER_ORNAMENT_IRON', 'TOWER_ITEM_REINFORCER', 'TOWER_RELIC_EMBLEM'],
  refreshCount: 0,
  processedPurchases: {},
  purchaseLedger: [],
  purchaseCount: 0,
  purchaseSequence: 0,
  processedRefreshes: {},
  refreshLedger: [],
});
assert(Object.isFrozen(initial));
assert(Object.isFrozen(initial.inventory));

const nonReward = service.claimFloorReward(4);
assert.equal(nonReward.code, 'NOT_REWARD_FLOOR');
assert.equal(nonReward.applied, false);
assert.equal(persisted.length, 0, 'non-reward floors must not persist a fake coin grant');

expectError('floor below range', () => service.claimFloorReward(0), 'INVALID_INPUT');
expectError('floor above range', () => service.claimFloorReward(51), 'INVALID_INPUT');
expectError('fractional floor', () => service.claimFloorReward(5.5), 'INVALID_INPUT');
expectError('string floor', () => service.claimFloorReward('5'), 'INVALID_INPUT');

const floorFive = service.claimFloorReward(5);
assert.equal(floorFive.code, 'APPLIED');
assert.equal(floorFive.amount, 20);
assert.equal(service.snapshot().towerCoins, 20);
assert.deepEqual(service.snapshot().claimedFloorRewards, [5]);
assert.equal(persisted.length, 1);
assert.equal(persisted.at(-1), service.save(), 'persistence must contain the committed floor reward state');

const duplicateFloor = service.grantFloorReward(5);
assert.equal(duplicateFloor.code, 'DUPLICATE');
assert.equal(duplicateFloor.applied, false);
assert.equal(duplicateFloor.amount, 20);
assert.equal(service.snapshot().towerCoins, 20);
assert.equal(persisted.length, 1, 'duplicate floor reward must be idempotent');

const floorTen = service.claimFloorReward(10);
assert.equal(floorTen.code, 'APPLIED');
assert.equal(floorTen.amount, 25);
assert.equal(service.snapshot().towerCoins, 45);
assert.deepEqual(service.snapshot().claimedFloorRewards, [5, 10]);

const notOfferedBeforeRefresh = service.purchase('purchase-cache-before-refresh', 'TOWER_MATERIAL_CACHE');
assert.equal(notOfferedBeforeRefresh.code, 'NOT_OFFERED');
assert.equal(notOfferedBeforeRefresh.applied, false);
assert.equal(persisted.length, 2);
expectError('unknown item', () => service.purchase('purchase-unknown', 'TOWER_UNKNOWN'), 'UNKNOWN_ITEM');
expectError('blank purchase key', () => service.purchase(' ', 'TOWER_ORNAMENT_IRON'), 'INVALID_INPUT');
expectError('zero quantity', () => service.purchase('purchase-zero', 'TOWER_ORNAMENT_IRON', 0), 'INVALID_INPUT');
expectError('fractional quantity', () => service.purchase('purchase-fraction', 'TOWER_ORNAMENT_IRON', 1.5), 'INVALID_INPUT');

const firstPurchase = service.purchase('purchase-iron-1', 'TOWER_ORNAMENT_IRON');
assert.equal(firstPurchase.code, 'APPLIED');
assert.equal(firstPurchase.spent, 40);
assert.deepEqual(firstPurchase.reward, towerShopConfig.items[0].reward);
assert.equal(service.snapshot().towerCoins, 5);
assert.equal(service.snapshot().purchased.TOWER_ORNAMENT_IRON, 1);
assert.equal(service.snapshot().inventory.ORNAMENT_IRON_CHARM, 1);

const duplicatePurchase = service.redeem('purchase-iron-1', 'TOWER_ORNAMENT_IRON');
assert.equal(duplicatePurchase.code, 'DUPLICATE');
assert.equal(duplicatePurchase.applied, false);
assert.equal(service.snapshot().towerCoins, 5);
assert.equal(service.snapshot().inventory.ORNAMENT_IRON_CHARM, 1);
const conflictingPurchase = service.purchase('purchase-iron-1', 'TOWER_ITEM_REINFORCER');
assert.equal(conflictingPurchase.code, 'CONFLICT');
assert.equal(conflictingPurchase.applied, false);
assert.equal(service.snapshot().towerCoins, 5);

const insufficientPurchase = service.purchase('purchase-iron-2-too-early', 'TOWER_ORNAMENT_IRON');
assert.equal(insufficientPurchase.code, 'INSUFFICIENT_FUNDS');
assert.equal(insufficientPurchase.applied, false);
assert.equal(service.snapshot().purchased.TOWER_ORNAMENT_IRON, 1);

let expectedBalance = 5;
for (const [floor, amount] of [[15, 30], [20, 35], [25, 40], [30, 45], [35, 50], [40, 60], [45, 70], [50, 90]]) {
  const result = service.claimFloorReward(floor);
  expectedBalance += amount;
  assert.equal(result.code, 'APPLIED', `floor ${floor} must grant its configured tower coins`);
  assert.equal(result.amount, amount, `floor ${floor} must grant exactly ${amount} tower coins`);
  assert.equal(service.snapshot().towerCoins, expectedBalance, `floor ${floor} balance must be exact`);
}
assert.equal(service.snapshot().towerCoins, 425);

const secondPurchase = service.purchase('purchase-iron-2', 'TOWER_ORNAMENT_IRON');
assert.equal(secondPurchase.code, 'APPLIED');
assert.equal(service.snapshot().purchased.TOWER_ORNAMENT_IRON, 2);
assert.equal(service.snapshot().inventory.ORNAMENT_IRON_CHARM, 2);
const purchaseLimit = service.purchase('purchase-iron-3', 'TOWER_ORNAMENT_IRON');
assert.equal(purchaseLimit.code, 'LIMIT_REACHED');
assert.equal(purchaseLimit.applied, false);
assert.equal(service.snapshot().purchased.TOWER_ORNAMENT_IRON, 2);

const firstRefresh = service.refresh('refresh-1');
assert.equal(firstRefresh.code, 'APPLIED');
assert.equal(firstRefresh.spent, 10);
assert.equal(service.snapshot().towerCoins, 375);
assert.deepEqual(service.snapshot().processedRefreshes, { 'refresh-1': 'refresh' });
assert.deepEqual(service.snapshot().offers, ['TOWER_RELIC_EMBLEM', 'TOWER_MATERIAL_CACHE', 'TOWER_ORNAMENT_JADE']);
assert.equal(service.snapshot().refreshCount, 1);
const duplicateRefresh = service.refresh('refresh-1');
assert.equal(duplicateRefresh.code, 'DUPLICATE');
assert.equal(duplicateRefresh.applied, false);
assert.equal(service.snapshot().towerCoins, 375);
assert.equal(service.snapshot().refreshCount, 1);

const cachePurchase = service.purchase('purchase-cache-1', 'TOWER_MATERIAL_CACHE');
assert.equal(cachePurchase.code, 'APPLIED');
assert.equal(cachePurchase.spent, 25);
assert.equal(cachePurchase.reward.quantity, 3);
assert.equal(service.snapshot().inventory.TOWER_MATERIAL, 3);
assert.equal(service.snapshot().purchased.TOWER_MATERIAL_CACHE, 1);
assert.equal(service.snapshot().towerCoins, 350);
const duplicateCache = service.purchase('purchase-cache-1', 'TOWER_MATERIAL_CACHE');
assert.equal(duplicateCache.code, 'DUPLICATE');
assert.equal(service.snapshot().inventory.TOWER_MATERIAL, 3);

const relicPurchase = service.purchase('purchase-relic-1', 'TOWER_RELIC_EMBLEM');
assert.equal(relicPurchase.code, 'APPLIED');
assert.equal(service.snapshot().purchased.TOWER_RELIC_EMBLEM, 1);
assert.equal(service.snapshot().inventory.TOWER_RELIC_EMBLEM, 1);
const relicLimit = service.purchase('purchase-relic-2', 'TOWER_RELIC_EMBLEM');
assert.equal(relicLimit.code, 'LIMIT_REACHED');
assert.equal(service.snapshot().purchased.TOWER_RELIC_EMBLEM, 1);
assert.equal(service.snapshot().purchaseCount, 4);
assert.equal(service.snapshot().purchaseSequence, 4);
assert.deepEqual(service.snapshot().purchaseLedger.at(-1), {
  sequence: 4,
  purchaseId: 'purchase-relic-1',
  fingerprint: 'TOWER_RELIC_EMBLEM:1',
});

const secondRefresh = service.refresh('refresh-2');
assert.equal(secondRefresh.code, 'APPLIED');
assert.equal(secondRefresh.spent, 10);
assert.deepEqual(service.snapshot().processedRefreshes, {
  'refresh-1': 'refresh',
  'refresh-2': 'refresh',
});
assert.deepEqual(service.snapshot().refreshLedger, [
  { sequence: 1, refreshId: 'refresh-1' },
  { sequence: 2, refreshId: 'refresh-2' },
]);
assert.equal(service.snapshot().refreshCount, 2);

const numericRefreshSaves = [];
const numericRefreshes = new TowerShopService({
  cycleKey: '2026-11-09',
  towerCoins: 20,
  persist: (serialized) => numericRefreshSaves.push(serialized),
});
assert.equal(numericRefreshes.refresh('2').code, 'APPLIED');
assert.equal(numericRefreshes.refresh('1').code, 'APPLIED');
assert.deepEqual(numericRefreshes.snapshot().refreshLedger, [
  { sequence: 1, refreshId: '2' },
  { sequence: 2, refreshId: '1' },
]);
assert.equal(numericRefreshSaves.length, 2, 'numeric refresh ids must commit in reverse numeric order');
const numericRestored = restoreTowerShop(numericRefreshes.save());
assert.deepEqual(numericRestored.refreshLedger, [
  { sequence: 1, refreshId: '2' },
  { sequence: 2, refreshId: '1' },
]);
assert.deepEqual(numericRestored.processedRefreshes, { '1': 'refresh', '2': 'refresh' });

const saved = service.save();
const savedState = JSON.parse(saved);
const deletedWholePurchase = JSON.parse(saved);
delete deletedWholePurchase.processedPurchases['purchase-cache-1'];
delete deletedWholePurchase.purchased.TOWER_MATERIAL_CACHE;
delete deletedWholePurchase.inventory.TOWER_MATERIAL;
expectError(
  'deleting one purchase from processed keys, purchased totals, and inventory must invalidate the save',
  () => new TowerShopService({ initialState: JSON.stringify(deletedWholePurchase) }),
  'INVALID_STATE',
);
const restoredSaves = [];
const restored = new TowerShopService({
  initialState: saved,
  persist: (serialized) => restoredSaves.push(serialized),
});
assert.deepEqual(restored.snapshot(), service.snapshot(), 'a saved shop state must round-trip exactly');
assert.equal(serializeTowerShop(restored.snapshot()), saved);
assert.deepEqual(restoreTowerShop(saved), restored.snapshot());
const duplicateAfterRestore = restored.purchase('purchase-cache-1', 'TOWER_MATERIAL_CACHE');
assert.equal(duplicateAfterRestore.code, 'DUPLICATE', 'purchase idempotency must survive restoring a save');
assert.equal(restoredSaves.length, 0);

const invalidLedgerBase = JSON.parse(saved);
const invalidLedgerSaves = [
  JSON.stringify({ ...invalidLedgerBase, purchaseCount: invalidLedgerBase.purchaseCount - 1 }),
  JSON.stringify({ ...invalidLedgerBase, purchaseSequence: invalidLedgerBase.purchaseSequence - 1 }),
  JSON.stringify({ ...invalidLedgerBase, purchaseLedger: invalidLedgerBase.purchaseLedger.slice(0, -1) }),
  JSON.stringify({
    ...invalidLedgerBase,
    purchaseLedger: invalidLedgerBase.purchaseLedger.map((entry, index) => index === 1 ? { ...entry, sequence: 4 } : entry),
  }),
];
for (const candidate of invalidLedgerSaves) expectError('invalid purchase ledger save', () => restoreTowerShop(candidate), 'INVALID_STATE');

const invalidRefreshSaves = [];
const deletedRefresh = JSON.parse(saved);
delete deletedRefresh.processedRefreshes['refresh-2'];
invalidRefreshSaves.push(JSON.stringify(deletedRefresh));
const alteredRefresh = JSON.parse(saved);
alteredRefresh.processedRefreshes['refresh-1'] = 'not-refresh';
invalidRefreshSaves.push(JSON.stringify(alteredRefresh));
const replacedRefresh = JSON.parse(saved);
delete replacedRefresh.processedRefreshes['refresh-2'];
replacedRefresh.processedRefreshes['refresh-replaced'] = 'refresh';
assert.equal(Object.keys(replacedRefresh.processedRefreshes).length, savedState.refreshCount);
assert.equal(replacedRefresh.refreshCount, savedState.refreshCount);
assert.deepEqual(replacedRefresh.offers, savedState.offers);
invalidRefreshSaves.push(JSON.stringify(replacedRefresh));
const reorderedRefresh = JSON.parse(saved);
reorderedRefresh.processedRefreshes = {
  'refresh-2': 'refresh',
  'refresh-1': 'refresh',
};
invalidRefreshSaves.push(JSON.stringify(reorderedRefresh));
const reorderedRefreshLedger = JSON.parse(saved);
reorderedRefreshLedger.refreshLedger.reverse();
invalidRefreshSaves.push(JSON.stringify(reorderedRefreshLedger));
const missingRefreshLedger = JSON.parse(saved);
delete missingRefreshLedger.refreshLedger;
invalidRefreshSaves.push(JSON.stringify(missingRefreshLedger));
const shortenedRefreshLedger = JSON.parse(saved);
shortenedRefreshLedger.refreshLedger = shortenedRefreshLedger.refreshLedger.slice(0, -1);
invalidRefreshSaves.push(JSON.stringify(shortenedRefreshLedger));
const invalidRefreshKey = JSON.parse(saved);
invalidRefreshKey.processedRefreshes[' '] = 'refresh';
invalidRefreshSaves.push(JSON.stringify(invalidRefreshKey));
const invalidRefreshOffers = JSON.parse(saved);
invalidRefreshOffers.offers = ['TOWER_ORNAMENT_IRON', 'TOWER_ITEM_REINFORCER', 'TOWER_RELIC_EMBLEM'];
invalidRefreshSaves.push(JSON.stringify(invalidRefreshOffers));
for (const candidate of invalidRefreshSaves) expectError('invalid processed refresh save', () => restoreTowerShop(candidate), 'INVALID_STATE');

const beforeCycleReset = restored.snapshot();
const cycleReset = restored.synchronizeCycle('2026-08-24');
assert.equal(cycleReset.code, 'RESET');
assert.equal(cycleReset.applied, true);
assert.equal(restored.snapshot().cycleKey, '2026-08-24');
assert.equal(restored.snapshot().towerCoins, beforeCycleReset.towerCoins, 'tower coins persist across a tower cycle reset');
assert.deepEqual(restored.snapshot().inventory, {}, 'current-cycle reward inventory resets with the redemption ledger');
assert.deepEqual(restored.snapshot().claimedFloorRewards, []);
assert.deepEqual(restored.snapshot().purchased, {});
assert.deepEqual(restored.snapshot().processedPurchases, {});
assert.deepEqual(restored.snapshot().purchaseLedger, []);
assert.equal(restored.snapshot().purchaseCount, 0);
assert.equal(restored.snapshot().purchaseSequence, 0);
assert.deepEqual(restored.snapshot().processedRefreshes, {});
assert.deepEqual(restored.snapshot().refreshLedger, []);
assert.deepEqual(restored.snapshot().offers, ['TOWER_ORNAMENT_IRON', 'TOWER_ITEM_REINFORCER', 'TOWER_RELIC_EMBLEM']);
assert.equal(restored.snapshot().refreshCount, 0);
assert.equal(restored.synchronizeCycle('2026-08-24').code, 'DUPLICATE');
assert.equal(restoredSaves.length, 1, 'repeating the same cycle reset must be idempotent');
assert.equal(restored.claimFloorReward(5).code, 'APPLIED', 'a new cycle may claim the same configured reward floor once');
assert.equal(restored.purchase('purchase-iron-1', 'TOWER_ORNAMENT_IRON').code, 'APPLIED', 'purchase ids are scoped to a cycle save');

const beforeInvalidCycle = restored.snapshot();
const invalidCyclePersistCount = restoredSaves.length;
for (const invalidCycle of ['garbage', '2026-02-30', '2026-08-30', '2026-08-17', '2099-01-05']) {
  expectError(`invalid or stale cycle ${invalidCycle}`, () => restored.synchronizeCycle(invalidCycle), 'INVALID_INPUT');
  assert.deepEqual(restored.snapshot(), beforeInvalidCycle, `rejected cycle ${invalidCycle} must not mutate state`);
  assert.equal(restoredSaves.length, invalidCyclePersistCount, `rejected cycle ${invalidCycle} must not persist`);
}
const futureCycle = restored.synchronizeCycle('2026-08-31');
assert.equal(futureCycle.code, 'RESET');
assert.equal(restored.snapshot().cycleKey, '2026-08-31');
assert.deepEqual(restored.snapshot().processedPurchases, {});
assert.equal(
  restored.purchase('purchase-iron-1', 'TOWER_ORNAMENT_IRON').code,
  'APPLIED',
  'the same purchase id is reusable in a later cycle',
);
expectError('cycle cannot return to an older cycle after a future reset', () => restored.synchronizeCycle('2026-08-24'), 'INVALID_INPUT');

const outOfOrderRewards = new TowerShopService({ cycleKey: '2026-11-02' });
assert.equal(outOfOrderRewards.claimFloorReward(10).code, 'APPLIED');
assert.equal(outOfOrderRewards.claimFloorReward(5).code, 'APPLIED');
assert.deepEqual(outOfOrderRewards.snapshot().claimedFloorRewards, [5, 10], 'claimed floors must remain canonically sorted');
assert.equal(outOfOrderRewards.claimFloorReward(10).code, 'DUPLICATE');
assert.deepEqual(restoreTowerShop(outOfOrderRewards.save()).claimedFloorRewards, [5, 10]);

expectError('garbage cycle at initialization', () => new TowerShopService({ cycleKey: 'garbage' }), 'INVALID_INPUT');
expectError('non-Monday cycle at initialization', () => new TowerShopService({ cycleKey: '2026-08-30' }), 'INVALID_INPUT');
expectError('impossible date at initialization', () => new TowerShopService({ cycleKey: '2026-02-30' }), 'INVALID_INPUT');

const exactRefreshFunds = new TowerShopService({ cycleKey: '2026-09-07', towerCoins: towerShopConfig.refreshCost });
const exactRefresh = exactRefreshFunds.refresh('refresh-exact-funds');
assert.equal(exactRefresh.code, 'APPLIED');
assert.equal(exactRefresh.spent, towerShopConfig.refreshCost);
assert.equal(exactRefreshFunds.snapshot().towerCoins, 0, 'refreshing with exactly the fee must leave zero balance');
assert.equal(exactRefreshFunds.refresh('refresh-after-zero').code, 'INSUFFICIENT_FUNDS');

const noFunds = new TowerShopService({ cycleKey: '2026-09-14', towerCoins: 0 });
assert.equal(noFunds.refresh('refresh-no-funds').code, 'INSUFFICIENT_FUNDS');
assert.equal(noFunds.purchase('purchase-no-funds', 'TOWER_ORNAMENT_IRON').code, 'INSUFFICIENT_FUNDS');
assert.deepEqual(noFunds.snapshot(), new TowerShopService({ cycleKey: '2026-09-14', towerCoins: 0 }).snapshot());

const limitBoundary = new TowerShopService({ cycleKey: '2026-09-21', towerCoins: 80 });
const exactLimitPurchase = limitBoundary.purchase('purchase-limit-exact', 'TOWER_ORNAMENT_IRON', 2);
assert.equal(exactLimitPurchase.code, 'APPLIED', 'purchase quantity equal to the limit must be accepted');
assert.equal(limitBoundary.snapshot().purchased.TOWER_ORNAMENT_IRON, 2);
assert.equal(limitBoundary.snapshot().inventory.ORNAMENT_IRON_CHARM, 2);
assert.equal(limitBoundary.purchase('purchase-limit-over', 'TOWER_ORNAMENT_IRON', 1).code, 'LIMIT_REACHED');

const persistenceFailure = new TowerShopService({
  cycleKey: '2026-09-28',
  persist: () => { throw new Error('disk full'); },
});
const beforeFailure = persistenceFailure.snapshot();
expectError('persistence failure', () => persistenceFailure.claimFloorReward(5), 'PERSISTENCE_FAILED');
assert.deepEqual(persistenceFailure.snapshot(), beforeFailure, 'a failed save must not mutate in-memory shop state');

let nestedError;
let reentrant;
reentrant = new TowerShopService({
  cycleKey: '2026-10-05',
  persist: () => {
    try {
      reentrant.claimFloorReward(10);
    } catch (error) {
      nestedError = error;
      throw error;
    }
  },
});
expectError('reentrant persistence', () => reentrant.claimFloorReward(5), 'PERSISTENCE_FAILED');
assert(nestedError instanceof TowerShopError && nestedError.code === 'PERSISTENCE_FAILED');
assert.deepEqual(reentrant.snapshot().claimedFloorRewards, []);

const invalidSave = JSON.parse(saved);
const invalidSaves = [
  '',
  '{',
  JSON.stringify({ ...invalidSave, schemaVersion: 1 }),
  JSON.stringify({ ...invalidSave, schemaVersion: 2 }),
  JSON.stringify({ ...invalidSave, extra: true }),
  JSON.stringify({ ...invalidSave, towerCoins: -1 }),
  JSON.stringify({ ...invalidSave, cycleKey: '' }),
  JSON.stringify({ ...invalidSave, claimedFloorRewards: [4] }),
  JSON.stringify({ ...invalidSave, offers: ['TOWER_RELIC_EMBLEM', 'TOWER_RELIC_EMBLEM', 'TOWER_ORNAMENT_JADE'] }),
  JSON.stringify({ ...invalidSave, purchased: { TOWER_UNKNOWN: 1 } }),
  JSON.stringify({ ...invalidSave, inventory: { TOWER_UNKNOWN_REWARD: 1 } }),
  JSON.stringify({ ...invalidSave, processedPurchases: { ' ': 'x' } }),
  JSON.stringify({ ...invalidSave, processedPurchases: { ...invalidSave.processedPurchases, 'purchase-cache-1': undefined } }),
  JSON.stringify({ ...invalidSave, processedPurchases: { ...invalidSave.processedPurchases, 'purchase-cache-1': 'TOWER_UNKNOWN:1' } }),
  JSON.stringify({ ...invalidSave, processedPurchases: { ...invalidSave.processedPurchases, 'purchase-cache-1': 'TOWER_MATERIAL_CACHE:0' } }),
  JSON.stringify({
    ...invalidSave,
    processedPurchases: Object.fromEntries(Object.entries(invalidSave.processedPurchases).filter(([id]) => id !== 'purchase-cache-1')),
  }),
  JSON.stringify({
    ...invalidSave,
    purchased: { ...invalidSave.purchased, TOWER_ORNAMENT_IRON: invalidSave.purchased.TOWER_ORNAMENT_IRON - 1 },
  }),
  JSON.stringify({
    ...invalidSave,
    inventory: { ...invalidSave.inventory, ORNAMENT_IRON_CHARM: invalidSave.inventory.ORNAMENT_IRON_CHARM - 1 },
  }),
];
for (const candidate of invalidSaves) expectError('invalid shop save', () => restoreTowerShop(candidate), 'INVALID_STATE');

const invalidConfig = structuredClone(towerShopConfig);
invalidConfig.items[1].id = invalidConfig.items[0].id;
expectConfigError('duplicate item id', () => loadTowerShopConfig(invalidConfig));
const invalidOfferCount = structuredClone(towerShopConfig);
invalidOfferCount.offerCount = invalidOfferCount.items.length + 1;
expectConfigError('offer count larger than catalog', () => loadTowerShopConfig(invalidOfferCount));
const invalidReward = structuredClone(towerShopConfig);
invalidReward.items[0].reward.quantity = 0;
expectConfigError('zero reward quantity', () => loadTowerShopConfig(invalidReward));
for (const reservedId of ['__proto__', 'constructor', 'prototype']) {
  const reservedItemId = structuredClone(towerShopConfig);
  reservedItemId.items[0].id = reservedId;
  expectConfigError(`reserved item id ${reservedId}`, () => loadTowerShopConfig(reservedItemId));

  const reservedRewardId = structuredClone(towerShopConfig);
  reservedRewardId.items[0].reward.id = reservedId;
  expectConfigError(`reserved reward id ${reservedId}`, () => loadTowerShopConfig(reservedRewardId));
}

const customConfig = structuredClone(towerShopConfig);
customConfig.refreshCost = 999;
const custom = new TowerShopService({ config: loadTowerShopConfig(customConfig), cycleKey: '2026-10-12', towerCoins: 1000 });
const customRefresh = custom.refresh('custom-refresh');
assert.equal(customRefresh.spent, 999, 'configured refresh cost must drive the real transaction');
assert.equal(custom.snapshot().towerCoins, 1, 'refresh must deduct exactly the configured refresh cost');
assert.equal(custom.snapshot().refreshCount, 1);
assert.deepEqual(custom.snapshot().processedRefreshes, { 'custom-refresh': 'refresh' });
assert.deepEqual(custom.snapshot().refreshLedger, [{ sequence: 1, refreshId: 'custom-refresh' }]);
assert.deepEqual(custom.snapshot().offers, ['TOWER_RELIC_EMBLEM', 'TOWER_MATERIAL_CACHE', 'TOWER_ORNAMENT_JADE']);

console.log(`T221 tower shop verified: ${persisted.length + restoredSaves.length} persisted commits, ${towerShopConfig.guaranteedCoinDrops.length} guaranteed floors`);
