import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPUTATION_SHOP_CATALOG_DATA,
  REPUTATION_SHOP_PRODUCTION_DIGEST,
  ReputationShopConfigError,
  ReputationShopError,
  ReputationShopService,
  assertReputationShopCatalogSkeleton,
  assertReputationShopProductionIntegrity,
  createDefaultReputationShopCatalog,
  diffReputationShopCatalogData,
  loadCustomReputationShopConfig,
  loadReputationShopProduction,
  reputationShopBalanceWitness,
  reputationShopCatalogDigest,
  reputationShopConfig,
  reputationShopStateDigest,
  restoreReputationShop,
  serializeReputationShop,
} from '../assets/scripts/meta/reputation/shop/index.ts';
import { ReputationError } from '../assets/scripts/meta/reputation/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const readConfig = (name) => JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name), 'utf8'));
const units = readConfig('units.json');
const professions = readConfig('professions.json');
const catalog = createDefaultReputationShopCatalog();

function expectError(label, action, ErrorType, code) {
  assert.throws(action, (error) => error instanceof ErrorType && (!code || error.code === code), `${label} must fail`);
}

function trustedAnchorFromAccountAuthority(balanceLedger, expectedState) {
  return Object.freeze({
    balanceLedger: structuredClone(balanceLedger),
    expectedStateDigest: reputationShopStateDigest(expectedState),
  });
}

assert.equal(reputationShopCatalogDigest(REPUTATION_SHOP_CATALOG_DATA), REPUTATION_SHOP_PRODUCTION_DIGEST);
assertReputationShopProductionIntegrity(REPUTATION_SHOP_CATALOG_DATA);
assertReputationShopCatalogSkeleton(reputationShopConfig);
assert.equal(reputationShopConfig.items.length, 44);
assert.equal(reputationShopConfig.offerCount, 4);
assert(Object.isFrozen(reputationShopConfig));
assert(Object.isFrozen(reputationShopConfig.items));
assert(reputationShopConfig.items.every((item) => item.requiredLevel >= 1 && item.requiredLevel <= 4));
assert(reputationShopConfig.items.every((item) => catalog.getTrack(item.trackId).levels[item.requiredLevel - 1].rewardIds.includes(item.reward.id)));

const loaded = loadReputationShopProduction({ units, professions });
assert.equal(loaded.items.length, 44);
assert.equal(JSON.stringify(loaded), JSON.stringify(reputationShopConfig));

const missingRace = structuredClone(units);
missingRace.units = missingRace.units.filter((unit) => unit.race !== '异兽');
expectError('missing reputation race cross-table source', () => loadReputationShopProduction({ units: missingRace, professions }), ReputationError, 'UNKNOWN_SOURCE');

const invalidLevel = structuredClone(REPUTATION_SHOP_CATALOG_DATA);
invalidLevel.items[0].requiredLevel = 5;
expectError('invalid required level', () => loadCustomReputationShopConfig(invalidLevel, catalog), ReputationShopConfigError);

const invalidReward = structuredClone(REPUTATION_SHOP_CATALOG_DATA);
invalidReward.items[0].reward.id = 'FORGED_REWARD';
expectError('cross-table reward binding', () => loadCustomReputationShopConfig(invalidReward, catalog), ReputationShopConfigError);

const changedCost = structuredClone(REPUTATION_SHOP_CATALOG_DATA);
changedCost.items[0].cost += 1;
assert.deepEqual(diffReputationShopCatalogData(REPUTATION_SHOP_CATALOG_DATA, changedCost), {
  added: [],
  removed: [],
  changed: [`item:${REPUTATION_SHOP_CATALOG_DATA.items[0].id}`],
});
const addedItem = structuredClone(REPUTATION_SHOP_CATALOG_DATA);
addedItem.items.push(structuredClone(addedItem.items[0]));
addedItem.items.at(-1).id = 'REP_SHOP_FORGED';
assert.throws(() => assertReputationShopCatalogSkeleton(addedItem), /skeleton mismatch/);

const initialReputation = catalog.createState([{ trackId: 'PROFESSION_ARCANIST', points: 0 }]);
const persisted = [];
const service = new ReputationShopService({
  catalog,
  config: reputationShopConfig,
  balance: 100,
  reputationState: initialReputation,
  persist: (serialized) => persisted.push(serialized),
});
assert.deepEqual(service.snapshot().offers, reputationShopConfig.items.slice(0, 4).map(({ id }) => id));
assert.equal(service.snapshot().balance, 100);
assert.deepEqual(service.snapshot().balanceLedger, [{
  sequence: 0,
  kind: 'INITIAL',
  referenceId: 'INITIAL',
  delta: 100,
  balanceAfter: 100,
}]);
assert(Object.isFrozen(service.snapshot()));

const levelTwoItem = reputationShopConfig.items.find((item) => item.trackId === 'PROFESSION_ARCANIST' && item.requiredLevel === 2);
const levelOneItem = reputationShopConfig.items.find((item) => item.trackId === 'PROFESSION_ARCANIST' && item.requiredLevel === 1);
assert(levelTwoItem && levelOneItem);
const locked = service.purchase('purchase-locked', levelTwoItem.id);
assert.equal(locked.code, 'LEVEL_LOCKED');
assert.equal(locked.applied, false);
assert.equal(service.snapshot().balance, 100);

const first = service.purchase('purchase-level-one', levelOneItem.id);
assert.equal(first.code, 'APPLIED');
assert.equal(first.spent, levelOneItem.cost);
assert.equal(service.snapshot().balance, 90);
assert.equal(service.snapshot().purchased[levelOneItem.id], 1);
assert.equal(service.snapshot().inventory[levelOneItem.reward.id], 1);
assert.equal(persisted.length, 1);
assert.equal(persisted.at(-1), service.save());

const duplicate = service.redeem('purchase-level-one', levelOneItem.id);
assert.equal(duplicate.code, 'DUPLICATE');
assert.equal(duplicate.applied, false);
assert.equal(service.snapshot().balance, 90);
assert.equal(service.snapshot().inventory[levelOneItem.reward.id], 1);
const conflict = service.purchase('purchase-level-one', levelTwoItem.id);
assert.equal(conflict.code, 'CONFLICT');
assert.equal(service.snapshot().balance, 90);

const limit = service.purchase('purchase-level-one-again', levelOneItem.id);
assert.equal(limit.code, 'LIMIT_REACHED');
assert.equal(limit.applied, false);

assert.equal(service.refresh('refresh-for-canonical').code, 'APPLIED');
const secondLevelOneItem = reputationShopConfig.items.find((item) => item.requiredLevel === 1
  && item.id !== levelOneItem.id && service.snapshot().offers.includes(item.id));
assert(secondLevelOneItem);
assert.equal(service.purchase('purchase-level-one-second', secondLevelOneItem.id).code, 'APPLIED');

const poor = new ReputationShopService({ catalog, config: reputationShopConfig, balance: 0 });
assert.equal(poor.purchase('purchase-poor', levelOneItem.id).code, 'INSUFFICIENT_FUNDS');
assert.equal(poor.refresh('refresh-poor').code, 'INSUFFICIENT_FUNDS');
expectError('fractional purchase quantity', () => service.purchase('purchase-fraction', levelOneItem.id, 1.5), ReputationShopError, 'INVALID_INPUT');
expectError('blank refresh key', () => service.refresh(' '), ReputationShopError, 'INVALID_INPUT');
expectError('unknown item', () => service.purchase('purchase-unknown', 'REP_SHOP_UNKNOWN'), ReputationShopError, 'UNKNOWN_ITEM');

const levelTwoReputation = catalog.createState([{ trackId: 'PROFESSION_ARCANIST', points: 100 }]);
const unlocked = new ReputationShopService({ catalog, config: reputationShopConfig, balance: 20, reputationState: levelTwoReputation });
assert.equal(unlocked.purchase('purchase-level-two', levelTwoItem.id).code, 'APPLIED');
assert.equal(unlocked.snapshot().balance, 0);

const refresher = new ReputationShopService({ catalog, config: reputationShopConfig, balance: 10 });
const beforeRefresh = refresher.snapshot();
const refresh = refresher.refresh('refresh-1');
assert.equal(refresh.code, 'APPLIED');
assert.equal(refresh.spent, reputationShopConfig.refreshCost);
assert.deepEqual(refresher.snapshot().offers, reputationShopConfig.items.slice(4, 8).map(({ id }) => id));
assert.equal(refresher.snapshot().refreshCount, 1);
assert.equal(refresher.snapshot().balance, 5);
const duplicateRefresh = refresher.refresh('refresh-1');
assert.equal(duplicateRefresh.code, 'DUPLICATE');
assert.equal(refresher.snapshot().balance, 5);
assert.deepEqual(beforeRefresh.refreshLedger, []);

const saved = service.save();
const savedState = service.snapshot();
const trustedServiceAnchor = trustedAnchorFromAccountAuthority(savedState.balanceLedger, savedState);
const restoredState = restoreReputationShop(saved, reputationShopConfig, catalog, trustedServiceAnchor);
assert.deepEqual(restoredState, service.snapshot());
assert.equal(saved, serializeReputationShop(restoredState, reputationShopConfig, catalog));
expectError('missing trusted anchor', () => restoreReputationShop(saved, reputationShopConfig, catalog), ReputationShopError, 'INVALID_STATE');
expectError('service missing trusted anchor', () => new ReputationShopService({
  catalog,
  config: reputationShopConfig,
  initialState: saved,
}), ReputationShopError, 'INVALID_STATE');
const restored = new ReputationShopService({
  catalog,
  config: reputationShopConfig,
  initialState: saved,
  trustedAnchor: trustedServiceAnchor,
});
assert.deepEqual(restored.snapshot(), service.snapshot());
assert.equal(restored.purchase('purchase-level-one', levelOneItem.id).code, 'DUPLICATE');

const tamperedBalance = JSON.parse(saved);
tamperedBalance.balance += 1;
expectError('balance tamper', () => restoreReputationShop(JSON.stringify(tamperedBalance), reputationShopConfig, catalog, trustedServiceAnchor), ReputationShopError, 'INVALID_STATE');

const tamperedInitialIncome = JSON.parse(saved);
tamperedInitialIncome.balance += 1;
tamperedInitialIncome.balanceLedger[0].delta += 1;
tamperedInitialIncome.balanceLedger[0].balanceAfter += 1;
expectError('initial balance witness tamper', () => restoreReputationShop(JSON.stringify(tamperedInitialIncome), reputationShopConfig, catalog, trustedServiceAnchor), ReputationShopError, 'INVALID_STATE');

const tamperedLedger = JSON.parse(saved);
tamperedLedger.balance += 1;
tamperedLedger.balanceLedger[1].delta += 1;
tamperedLedger.balanceLedger[1].balanceAfter += 1;
expectError('balance ledger tamper', () => restoreReputationShop(JSON.stringify(tamperedLedger), reputationShopConfig, catalog, trustedServiceAnchor), ReputationShopError, 'INVALID_STATE');

const tamperedWitness = JSON.parse(saved);
tamperedWitness.balance += 1;
tamperedWitness.balanceLedger[0].delta += 1;
for (const entry of tamperedWitness.balanceLedger) entry.balanceAfter += 1;
tamperedWitness.balanceWitness = reputationShopBalanceWitness(tamperedWitness);
assert.notEqual(tamperedWitness.balanceWitness, savedState.balanceWitness);
expectError('recomputed public witness tamper', () => restoreReputationShop(JSON.stringify(tamperedWitness), reputationShopConfig, catalog, trustedServiceAnchor), ReputationShopError, 'INVALID_STATE');

const tamperedTrustedAnchor = {
  ...trustedServiceAnchor,
  expectedStateDigest: `${trustedServiceAnchor.expectedStateDigest.slice(0, -1)}${trustedServiceAnchor.expectedStateDigest.endsWith('0') ? '1' : '0'}`,
};
expectError('trusted anchor tamper', () => restoreReputationShop(saved, reputationShopConfig, catalog, tamperedTrustedAnchor), ReputationShopError, 'INVALID_STATE');
const tamperedTrustedLedger = {
  ...trustedServiceAnchor,
  balanceLedger: structuredClone(trustedServiceAnchor.balanceLedger),
};
tamperedTrustedLedger.balanceLedger[0].delta += 1;
expectError('trusted anchor ledger tamper', () => restoreReputationShop(saved, reputationShopConfig, catalog, tamperedTrustedLedger), ReputationShopError, 'INVALID_STATE');

const reverseRecord = (record) => Object.fromEntries(Object.entries(record).reverse());
const reorderedKeys = JSON.parse(saved);
reorderedKeys.processedPurchases = reverseRecord(reorderedKeys.processedPurchases);
reorderedKeys.purchased = reverseRecord(reorderedKeys.purchased);
reorderedKeys.inventory = reverseRecord(reorderedKeys.inventory);
reorderedKeys.processedRefreshes = reverseRecord(reorderedKeys.processedRefreshes);
reorderedKeys.balanceLedger = reorderedKeys.balanceLedger.map((entry) => reverseRecord(entry));
reorderedKeys.purchaseLedger = reorderedKeys.purchaseLedger.map((entry) => reverseRecord(entry));
const reorderedSerialized = JSON.stringify(reorderedKeys);
const restoredReordered = restoreReputationShop(reorderedSerialized, reputationShopConfig, catalog, trustedServiceAnchor);
assert.deepEqual(restoredReordered, savedState);
assert.equal(serializeReputationShop(restoredReordered, reputationShopConfig, catalog), saved);

const sameCostItem = reputationShopConfig.items.find((item) => item.id !== levelOneItem.id && item.cost === levelOneItem.cost);
assert(sameCostItem);
const tamperedConsumption = JSON.parse(saved);
tamperedConsumption.purchaseLedger[0].fingerprint = `${sameCostItem.id}:1`;
tamperedConsumption.processedPurchases['purchase-level-one'] = `${sameCostItem.id}:1`;
tamperedConsumption.purchased = { [sameCostItem.id]: 1 };
tamperedConsumption.inventory = { [sameCostItem.reward.id]: 1 };
expectError('consumption record tamper', () => restoreReputationShop(JSON.stringify(tamperedConsumption), reputationShopConfig, catalog, trustedServiceAnchor), ReputationShopError, 'INVALID_STATE');

const refreshedSaved = refresher.save();
const refreshedState = refresher.snapshot();
const trustedRefresherAnchor = trustedAnchorFromAccountAuthority(refreshedState.balanceLedger, refreshedState);
const restoredRefresher = restoreReputationShop(refreshedSaved, reputationShopConfig, catalog, trustedRefresherAnchor);
assert.deepEqual(restoredRefresher, refresher.snapshot());
assert.equal(restoredRefresher.balance, 5);
assert.deepEqual(restoredRefresher.balanceLedger.at(-1), {
  sequence: 1,
  kind: 'REFRESH',
  referenceId: 'refresh-1',
  delta: -5,
  balanceAfter: 5,
});

const malformed = JSON.parse(saved);
delete malformed.processedPurchases['purchase-level-one'];
delete malformed.purchased[levelOneItem.id];
delete malformed.inventory[levelOneItem.reward.id];
expectError('purchase ledger witness deletion', () => restoreReputationShop(JSON.stringify(malformed), reputationShopConfig, catalog, trustedServiceAnchor), ReputationShopError, 'INVALID_STATE');

const invalidOffers = JSON.parse(saved);
invalidOffers.offers.reverse();
expectError('non-deterministic offer order', () => restoreReputationShop(JSON.stringify(invalidOffers), reputationShopConfig, catalog, trustedServiceAnchor), ReputationShopError, 'INVALID_STATE');

console.log('T238 reputation shop PASS: level-gates, deterministic-refresh, balance/limit/inventory, idempotent-purchases, serialization, config-cross-table, skeleton-diff');
