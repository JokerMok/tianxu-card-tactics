import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { register } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionlessTsLoader = `
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export async function resolve(specifier, context, nextResolve) {
    const leaf = specifier.split('/').pop() || '';
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !leaf.includes('.')) {
        const candidate = new URL(specifier + '.ts', context.parentURL);
        try {
            await stat(fileURLToPath(candidate));
            return nextResolve(candidate.href, context);
        } catch {
            // Keep Node's normal error when no TypeScript sibling exists.
        }
    }
    return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(extensionlessTsLoader)}`, import.meta.url);

const {
    CARD_SHOP_CONFIG,
    CardShopService,
    loadCardShopConfig,
    parseCardShopConfig,
    restoreCardShopService,
    serializeCardShopConfig,
    serializeCardShopSnapshot,
    validateCardShopConfig,
} = await import('../assets/scripts/meta/shop/index.ts');

const toolsRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(toolsRoot, '..');
const allowedPaths = ['assets/scripts/meta/shop/', 'tools/test-card-shop.mjs'];

function clone(value) { return structuredClone(value); }

function businessSnapshot(service) {
    const snapshot = service.snapshot();
    const { processedResults, ...business } = snapshot;
    return business;
}

function assertAtomic(service, action, expectedReason) {
    const beforeBusiness = clone(businessSnapshot(service));
    const beforeProcessedCount = service.snapshot().processedResults.length;
    const result = action();
    assert.equal(result.success, false);
    if (expectedReason) assert.equal(result.reason, expectedReason);
    assert.deepEqual(businessSnapshot(service), beforeBusiness, `failure ${expectedReason ?? ''} must not mutate business state`);
    const expectedProcessedCount = expectedReason === 'REQUEST_ID_REUSED' ? beforeProcessedCount : beforeProcessedCount + 1;
    assert.equal(service.snapshot().processedResults.length, expectedProcessedCount, `failure ${expectedReason ?? ''} persistence must be stable`);
    const afterFirstFailure = service.serialize();
    assert.deepEqual(action(), result, `failure ${expectedReason ?? ''} replay must return the original result`);
    assert.equal(service.serialize(), afterFirstFailure, `failure ${expectedReason ?? ''} replay must not mutate state`);
    return result;
}

function assertContains(errors, fragment) {
    assert.equal(errors.some((error) => error.includes(fragment)), true, `expected validation error containing: ${fragment}`);
}

function checkSkeletonAndDiff() {
    const shopRoot = resolve(projectRoot, 'assets/scripts/meta/shop');
    const required = ['shop-contract.ts', 'shop-config.ts', 'shop-service.ts', 'index.ts'];
    for (const file of required) assert.equal(existsSync(resolve(shopRoot, file)), true, `missing card shop skeleton file: ${file}`);
    const files = readdirSync(shopRoot);
    assert.deepEqual(files.filter((file) => file.endsWith('.meta')), [], 'card shop must not generate Cocos metadata placeholders');
    assert.equal(files.some((file) => /\.(png|jpg|jpeg|webp|glb|prefab|scene)$/i.test(file)), false, 'card shop must not contain generated resources');
    const indexSource = readFileSync(resolve(shopRoot, 'index.ts'), 'utf8');
    assert.match(indexSource, /shop-contract/);
    assert.match(indexSource, /shop-config/);
    assert.match(indexSource, /shop-service/);

    const diffCommit = process.env.T240_DIFF_COMMIT;
    const diffParent = process.env.T240_DIFF_PARENT ?? process.env.T240_DIFF_BASE ?? (diffCommit ? `${diffCommit}^` : null);
    const workingBase = diffCommit ?? 'HEAD';
    const committedDiff = diffCommit && diffParent
        ? execFileSync('git', ['diff', '--name-only', diffParent, diffCommit, '--'], { cwd: projectRoot, encoding: 'utf8' }).split('\n').map((file) => file.trim()).filter(Boolean)
        : [];
    const workingDiff = execFileSync('git', ['diff', '--name-only', workingBase, '--'], { cwd: projectRoot, encoding: 'utf8' })
        .split('\n').map((file) => file.trim()).filter(Boolean);
    const stagedDiff = execFileSync('git', ['diff', '--cached', '--name-only', workingBase, '--'], { cwd: projectRoot, encoding: 'utf8' })
        .split('\n').map((file) => file.trim()).filter(Boolean);
    const trackedDiff = [...new Set([...committedDiff, ...workingDiff, ...stagedDiff])];
    const disallowed = trackedDiff.filter((file) => !allowedPaths.some((allowed) => allowed.endsWith('/') ? file.startsWith(allowed) : file === allowed));
    assert.deepEqual(disallowed, [], `tracked diff contains files outside T240 scope: ${disallowed.join(', ')}`);
}

checkSkeletonAndDiff();

assert.deepEqual(validateCardShopConfig(CARD_SHOP_CONFIG), [], 'default card shop config must be valid');
const serializedConfig = serializeCardShopConfig(CARD_SHOP_CONFIG);
assert.equal(serializedConfig, serializeCardShopConfig(parseCardShopConfig(serializedConfig)), 'config JSON must round-trip deterministically');
const reorderedConfig = clone(CARD_SHOP_CONFIG);
reorderedConfig.currencies.reverse();
reorderedConfig.cards.reverse();
reorderedConfig.products.reverse();
assert.equal(serializedConfig, serializeCardShopConfig(reorderedConfig), 'table order must not affect config serialization');

const badCardReference = clone(CARD_SHOP_CONFIG);
badCardReference.products[0].cardId = 'missing_card';
assertContains(validateCardShopConfig(badCardReference), 'unknown card');
const badCurrencyReference = clone(CARD_SHOP_CONFIG);
badCurrencyReference.products[0].currencyId = 'missing_currency';
assertContains(validateCardShopConfig(badCurrencyReference), 'unknown currency');
const badUnknownKey = clone(CARD_SHOP_CONFIG);
badUnknownKey.products[0].unexpected = true;
assertContains(validateCardShopConfig(badUnknownKey), 'not allowed');
const badSafeInteger = clone(CARD_SHOP_CONFIG);
badSafeInteger.products[0].price = Number.MAX_SAFE_INTEGER + 1;
assertContains(validateCardShopConfig(badSafeInteger), 'safe integer');
assert.throws(() => parseCardShopConfig('{"schemaVersion":1}'), /non-empty array/);

const config = loadCardShopConfig({
    schemaVersion: 1,
    slotCount: 2,
    currencies: [{ id: 'coins' }, { id: 'crystals' }],
    cards: [{ id: 'alpha', rarity: 1 }, { id: 'beta', rarity: 2 }, { id: 'gamma', rarity: 3 }],
    products: [
        { id: 'alpha_offer', cardId: 'alpha', currencyId: 'coins', price: 10, stock: 1 },
        { id: 'beta_offer', cardId: 'beta', currencyId: 'coins', price: 20, stock: 1 },
        { id: 'gamma_offer', cardId: 'gamma', currencyId: 'crystals', price: 1, stock: 1 },
    ],
});

function makeService(options = {}) {
    return new CardShopService({ config, seed: 77, balances: { coins: 50, crystals: 2 }, ...options });
}

const deterministicA = makeService();
const deterministicB = makeService();
const refreshA = deterministicA.refresh({ requestId: 'refresh-1' });
const refreshB = deterministicB.refresh({ requestId: 'refresh-2' });
assert.deepEqual(refreshA.listings, refreshB.listings, 'same seed must select the same listings');
assert.equal(refreshA.refreshCount, 1);
assert.equal(deterministicA.serialize(), deterministicA.serialize(), 'serialization must be stable');

const replayBefore = deterministicA.serialize();
assert.deepEqual(deterministicA.refresh({ requestId: 'refresh-1' }), refreshA, 'same refresh request must replay exactly');
assert.equal(deterministicA.serialize(), replayBefore, 'refresh replay must not mutate state');
assertAtomic(deterministicA, () => deterministicA.refresh({ requestId: 'refresh-1', extra: true }), 'REQUEST_ID_REUSED');

const purchasedProduct = refreshA.listings[0].productId;
const product = config.products.find((item) => item.id === purchasedProduct);
const purchase = deterministicA.purchase({ requestId: 'purchase-1', productId: purchasedProduct });
assert.equal(purchase.success, true);
assert.equal(deterministicA.getBalance(product.currencyId), ({ coins: 50, crystals: 2 }[product.currencyId] - product.price));
assert.equal(deterministicA.getCardInventory(product.cardId), 1);
const purchaseReplayBefore = deterministicA.serialize();
assert.deepEqual(deterministicA.buy({ requestId: 'purchase-1', productId: purchasedProduct }), purchase, 'same purchase request must replay exactly');
assert.equal(deterministicA.serialize(), purchaseReplayBefore, 'purchase replay must not mutate state');
assertAtomic(deterministicA, () => deterministicA.purchase({ requestId: 'purchase-1', productId: refreshA.listings[1].productId }), 'REQUEST_ID_REUSED');
assertAtomic(deterministicA, () => deterministicA.purchase({ requestId: 'purchase-2', productId: purchasedProduct }), 'ALREADY_PURCHASED');

const poorService = makeService({ balances: { coins: 0, crystals: 0 } });
const poorRefresh = poorService.refresh({ requestId: 'refresh-poor' });
const poorProduct = poorRefresh.listings.find((listing) => config.products.find((item) => item.id === listing.productId).currencyId === 'coins')?.productId;
assert.ok(poorProduct, 'test config must expose a coins listing');
const poorFailure = assertAtomic(poorService, () => poorService.purchase({ requestId: 'buy-poor', productId: poorProduct }), 'INSUFFICIENT_FUNDS');
const poorSnapshot = JSON.parse(poorService.serialize());
poorSnapshot.balances.coins = 50;
const poorRestored = restoreCardShopService(poorSnapshot, config);
assert.deepEqual(poorRestored.purchase({ requestId: 'buy-poor', productId: poorProduct }), poorFailure, 'insufficient-funds failure must survive balance recovery');
assert.equal(poorRestored.getBalance('coins'), 50, 'restored balance must remain available after failed replay');
const retargetProduct = poorProduct === 'alpha_offer' ? 'beta_offer' : 'alpha_offer';
assert.equal(poorRestored.purchase({ requestId: 'buy-poor', productId: retargetProduct }).reason, 'REQUEST_ID_REUSED', 'failed requestId cannot be retargeted into a purchase');
assertAtomic(poorService, () => poorService.purchase({ requestId: 'buy-missing', productId: 'missing' }), 'UNKNOWN_PRODUCT');
assertAtomic(poorService, () => poorService.purchase({ requestId: 'bad', productId: poorProduct, extra: true }), 'INVALID_REQUEST');

const unavailableService = makeService();
const unavailableFailure = assertAtomic(unavailableService, () => unavailableService.purchase({ requestId: 'buy-unavailable', productId: 'alpha_offer' }), 'PRODUCT_NOT_AVAILABLE');
const unavailableSnapshot = JSON.parse(unavailableService.serialize());
unavailableSnapshot.listings = [{ productId: 'alpha_offer', remaining: 1 }];
const unavailableRestored = restoreCardShopService(unavailableSnapshot, config);
assert.deepEqual(unavailableRestored.purchase({ requestId: 'buy-unavailable', productId: 'alpha_offer' }), unavailableFailure, 'unavailable failure must survive listing recovery');

const duplicateService = makeService({ listings: [{ productId: 'alpha_offer', remaining: 1 }] });
assert.equal(duplicateService.purchase({ requestId: 'buy-first', productId: 'alpha_offer' }).success, true);
const duplicateFailure = assertAtomic(duplicateService, () => duplicateService.purchase({ requestId: 'buy-duplicate', productId: 'alpha_offer' }), 'ALREADY_PURCHASED');
const duplicateSnapshot = JSON.parse(duplicateService.serialize());
duplicateSnapshot.listings = [{ productId: 'alpha_offer', remaining: 1 }];
duplicateSnapshot.balances.coins = 50;
const duplicateRestored = restoreCardShopService(duplicateSnapshot, config);
assert.deepEqual(duplicateRestored.purchase({ requestId: 'buy-duplicate', productId: 'alpha_offer' }), duplicateFailure, 'duplicate-purchase failure must survive stock recovery');

const overflowService = makeService({ refreshCount: Number.MAX_SAFE_INTEGER });
assertAtomic(overflowService, () => overflowService.refresh({ requestId: 'refresh-overflow' }), 'REFRESH_OVERFLOW');
const lastRefreshService = makeService({ refreshCount: Number.MAX_SAFE_INTEGER - 1 });
assert.equal(lastRefreshService.refresh({ requestId: 'refresh-last' }).refreshCount, Number.MAX_SAFE_INTEGER);
assertAtomic(lastRefreshService, () => lastRefreshService.refresh({ requestId: 'refresh-after-last' }), 'REFRESH_OVERFLOW');

const inventoryOverflowService = makeService({
    listings: [{ productId: 'alpha_offer', remaining: 1 }],
    inventory: { alpha: Number.MAX_SAFE_INTEGER },
});
const inventoryOverflowFailure = assertAtomic(inventoryOverflowService, () => inventoryOverflowService.purchase({ requestId: 'buy-inventory-overflow', productId: 'alpha_offer' }), 'INVENTORY_OVERFLOW');
const inventoryRecovered = JSON.parse(inventoryOverflowService.serialize());
inventoryRecovered.inventory.alpha = 0;
const inventoryRestored = restoreCardShopService(inventoryRecovered, config);
assert.deepEqual(inventoryRestored.purchase({ requestId: 'buy-inventory-overflow', productId: 'alpha_offer' }), inventoryOverflowFailure, 'inventory-overflow failure must survive inventory recovery');

const refreshOverflowService = makeService({ refreshCount: Number.MAX_SAFE_INTEGER });
const refreshOverflowFailure = assertAtomic(refreshOverflowService, () => refreshOverflowService.refresh({ requestId: 'refresh-overflow' }), 'REFRESH_OVERFLOW');
const refreshRecovered = JSON.parse(refreshOverflowService.serialize());
refreshRecovered.refreshCount = 0;
const refreshRestored = restoreCardShopService(refreshRecovered, config);
assert.deepEqual(refreshRestored.refresh({ requestId: 'refresh-overflow' }), refreshOverflowFailure, 'refresh-overflow failure must survive refresh-count recovery');

const serialService = makeService();
const serialRefresh = serialService.refresh({ requestId: 'refresh-serial' });
serialService.purchase({ requestId: 'buy-serial', productId: serialRefresh.listings[0].productId });
const serialPayload = serialService.serialize();
assert.equal(serialPayload, serializeCardShopSnapshot(JSON.parse(serialPayload)), 'snapshot JSON must use canonical key order');
const restored = restoreCardShopService(JSON.parse(serialPayload), config);
assert.equal(restored.serialize(), serialPayload, 'serialized service state must restore exactly');
assert.deepEqual(restored.purchase({ requestId: 'buy-serial', productId: serialRefresh.listings[0].productId }), serialService.purchase({ requestId: 'buy-serial', productId: serialRefresh.listings[0].productId }), 'processed request must survive restore');

const unsafeSnapshot = JSON.parse(serialPayload);
unsafeSnapshot.extra = true;
assert.throws(() => restoreCardShopService(unsafeSnapshot, config), /unexpected keys/);
const unknownBalanceSnapshot = JSON.parse(serialPayload);
unknownBalanceSnapshot.balances.unknown = 1;
assert.throws(() => restoreCardShopService(unknownBalanceSnapshot, config), /unknown card shop balances key/);
const unsafeSeedSnapshot = JSON.parse(serialPayload);
unsafeSeedSnapshot.seed = Number.MAX_SAFE_INTEGER + 1;
assert.throws(() => restoreCardShopService(unsafeSeedSnapshot, config), /safe integers/);

const unsafeFailureSnapshot = JSON.parse(poorService.serialize());
unsafeFailureSnapshot.processedResults[0].result.success = true;
assert.throws(() => restoreCardShopService(unsafeFailureSnapshot, config), /invalid processed card shop purchase result payload/);

console.log(JSON.stringify({
    task: 'T240',
    status: 'passed',
    assertions: 'config-load-cross-table-serialization, deterministic-refresh, purchase-currency-inventory, requestId-idempotency, insufficient-balance, duplicate-purchase, refresh-boundary, atomic-failures, exact-key-safe-integer-fail-closed, skeleton-diff',
    files: ['assets/scripts/meta/shop/', 'tools/test-card-shop.mjs'],
}, null, 2));
