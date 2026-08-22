import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { register } from 'node:module';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const extensionlessTsLoader = `
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
    const leaf = specifier.split('/').pop() || '';
    if ((specifier.startsWith('./') || specifier.startsWith('../')) && !leaf.includes('.')) {
        const candidate = new URL(specifier + '.ts', context.parentURL);
        try { await stat(fileURLToPath(candidate)); return nextResolve(candidate.href, context); } catch {}
    }
    return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(extensionlessTsLoader)}`, import.meta.url);

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const standaloneGitRoot = resolve(projectRoot, '.git');
const gitRoot = (await stat(standaloneGitRoot).then(() => projectRoot).catch(() => resolve(projectRoot, '..')));
const scopePrefix = gitRoot === projectRoot ? '' : 'cocos-client/';
const {
    ECONOMY_CONFIG,
    ECONOMY_SKELETON,
    EconomyService,
    diffEconomySkeleton,
    loadEconomyConfig,
    serializeEconomyConfig,
    validateEconomyConfig,
} = await import('../assets/scripts/simulation/economy/index.ts');
const { CRAFTING_CONFIG } = await import('../assets/scripts/meta/equipment/crafting/crafting-config.ts');
const { EXPEDITION_CONFIG } = await import('../assets/scripts/meta/expedition/expedition-config.ts');
const { CARD_SHOP_CONFIG } = await import('../assets/scripts/meta/shop/shop-config.ts');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function assertConservation(state, label) {
    for (const [resourceId, balance] of Object.entries(state.balances)) {
        assert.equal(Number.isSafeInteger(balance) && balance >= 0, true, `${label}: ${resourceId} must be non-negative`);
        const ledger = state.ledger;
        assert.equal(ledger.initial[resourceId] + ledger.produced[resourceId] - ledger.consumed[resourceId], balance, `${label}: ${resourceId} ledger drift`);
    }
    assert.equal(Object.values(state.cards).every((value) => Number.isSafeInteger(value) && value >= 0), true, `${label}: card inventory drift`);
    assert.equal(Object.values(state.buildings).every((value) => Number.isSafeInteger(value) && value >= 1), true, `${label}: building level drift`);
}

function assertScope() {
    const diffCommit = process.env.T241_DIFF_COMMIT ?? 'HEAD';
    const diffParent = process.env.T241_DIFF_PARENT ?? `${diffCommit}^`;
    const committed = execFileSync('git', ['diff', '--name-only', diffParent, diffCommit, '--'], { cwd: gitRoot, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const working = execFileSync('git', ['diff', '--name-only', diffCommit, '--'], { cwd: gitRoot, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const staged = execFileSync('git', ['diff', '--cached', '--name-only', diffCommit, '--'], { cwd: gitRoot, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    const changed = [...new Set([...committed, ...working, ...staged])];
    const allowed = (path) => path.startsWith(`${scopePrefix}assets/scripts/simulation/economy/`) || path === `${scopePrefix}tools/test-economy-30d.mjs`;
    assert.deepEqual(changed.filter((path) => !allowed(path)), [], `scope violation: ${changed.filter((path) => !allowed(path)).join(', ')}`);
    assert.equal(changed.includes(`${scopePrefix}tools/test-economy-30d.mjs`), true, 'economy harness must be part of the change');
    assert.equal(changed.some((path) => path.startsWith(`${scopePrefix}assets/scripts/simulation/economy/`)), true, 'economy module must be part of the change');
}

function assertConfiguration() {
    assert.deepEqual(validateEconomyConfig(ECONOMY_CONFIG), []);
    assert.deepEqual(diffEconomySkeleton(ECONOMY_CONFIG, ECONOMY_SKELETON), []);
    assert.deepEqual([...ECONOMY_CONFIG.integrationRefs.equipmentRecipeIds].sort(), CRAFTING_CONFIG.recipes.map((recipe) => recipe.id).sort());
    assert.deepEqual([...ECONOMY_CONFIG.integrationRefs.expeditionIds].sort(), EXPEDITION_CONFIG.destinations.map((destination) => destination.id).sort());
    assert.deepEqual([...ECONOMY_CONFIG.integrationRefs.shopProductIds].sort(), CARD_SHOP_CONFIG.products.map((product) => product.id).sort());
    assert.equal(serializeEconomyConfig(ECONOMY_CONFIG), serializeEconomyConfig(loadEconomyConfig(JSON.parse(serializeEconomyConfig(ECONOMY_CONFIG)))));

    const malformed = clone(ECONOMY_CONFIG);
    malformed.buildings[0].dailyYield = { missing_resource: 1 };
    assert.equal(validateEconomyConfig(malformed).some((error) => error.includes('unknown resource')), true);
    assert.equal(diffEconomySkeleton({ ...ECONOMY_CONFIG, buildings: [...ECONOMY_CONFIG.buildings, { ...ECONOMY_CONFIG.buildings[0], id: 'rogue' }] }).some((error) => error.includes('unexpected: rogue')), true);

    const missingCrossTableRef = clone(ECONOMY_CONFIG);
    missingCrossTableRef.integrationRefs.dailyTaskIds.pop();
    assert.equal(validateEconomyConfig(missingCrossTableRef).some((error) => error.includes('dailyTaskIds is missing id')), true, 'missing cross-table refs must be rejected');
    const orphanCrossTableRef = clone(ECONOMY_CONFIG);
    orphanCrossTableRef.integrationRefs.buildingIds[0] = 'orphan-building';
    assert.equal(validateEconomyConfig(orphanCrossTableRef).some((error) => error.includes('references unknown id')), true, 'orphan cross-table refs must be rejected');
}

function simulate(seed) {
    const service = new EconomyService({ seed });
    const traces = [];
    let previousPrice = 0;
    assertConservation(service.snapshot(), 'day 0');
    for (let day = 1; day <= 30; day += 1) {
        const result = service.advanceDay(day);
        assert.equal(result.status, 'success', `day ${day} must advance`);
        assert.equal(result.day, day);
        traces.push(result);
        const state = service.snapshot();
        assertConservation(state, `day ${day}`);
        assert.equal(state.bankrupt, false, `day ${day} must remain solvent under baseline income`);
        assert.equal(state.priceIndex.bulwark_coins >= previousPrice, true, `day ${day}: shop price must not deflate`);
        previousPrice = state.priceIndex.bulwark_coins;
    }
    return { service, traces };
}

function assertDeterminismAndRecovery() {
    const left = simulate(0x51eed);
    const right = simulate(0x51eed);
    assert.equal(left.service.serialize(), right.service.serialize(), 'same seed must produce byte-identical 30-day state');
    assert.deepEqual(left.traces, right.traces, 'same seed must produce byte-identical daily trace');

    const checkpointService = new EconomyService({ seed: 0xabc123 });
    for (let day = 1; day <= 15; day += 1) checkpointService.advanceDay(day);
    const checkpoint = checkpointService.serialize();
    const restored = EconomyService.fromSnapshot(checkpointService.snapshot());
    for (let day = 16; day <= 30; day += 1) checkpointService.advanceDay(day);
    for (let day = 16; day <= 30; day += 1) restored.advanceDay(day);
    assert.equal(checkpointService.serialize(), restored.serialize(), 'restored state must resume deterministically');

    const rollbackTarget = new EconomyService({ seed: 0xabc123 });
    for (let day = 1; day <= 15; day += 1) rollbackTarget.advanceDay(day);
    rollbackTarget.rollback(checkpoint);
    for (let day = 16; day <= 30; day += 1) rollbackTarget.advanceDay(day);
    assert.equal(rollbackTarget.serialize(), checkpointService.serialize(), 'rollback and replay must converge');

    const tampered = clone(checkpointService.snapshot());
    tampered.balances.alloy += 1;
    tampered.ledger.produced.alloy += 1;
    assert.throws(() => EconomyService.fromSnapshot(tampered), /alignment|conservation/, 'restore must reject cross-service drift');
    const negative = clone(checkpointService.snapshot());
    negative.balances.credits = -1;
    assert.throws(() => EconomyService.fromSnapshot(negative), /non-negative/, 'restore must reject negative resources');
}

function assertIdempotency() {
    const service = new EconomyService({ seed: 0x12345 });
    for (let day = 1; day <= 10; day += 1) service.advanceDay(day);
    const result = service.advanceDay(11, 'fixed-request');
    const afterFirst = service.serialize();
    assert.deepEqual(service.advanceDay(11, 'fixed-request'), result, 'replayed day command must return the original result');
    assert.equal(service.serialize(), afterFirst, 'replayed day command must not mutate state');
    const reused = service.apply({ requestId: 'fixed-request', type: 'advance-day', day: 12 });
    assert.equal(reused.status, 'failure');
    assert.equal(reused.reason, 'REQUEST_ID_REUSED');
    assert.equal(service.serialize(), afterFirst, 'request id reuse must not mutate state');

    const purchase = service.apply({ requestId: 'optional-shop-buy', type: 'shop-purchase', productId: 'bulwark_coins' });
    const purchaseReplay = service.apply({ requestId: 'optional-shop-buy', type: 'shop-purchase', productId: 'bulwark_coins' });
    assert.deepEqual(purchaseReplay, purchase, 'optional purchase result must be idempotent');
    assertConservation(service.snapshot(), 'idempotency state');

    const low = service.snapshot();
    const available = low.shopSnapshot.listings.find((listing) => listing.remaining > 0);
    assert.ok(available, 'a refreshed shop must expose an optional listing');
    const lowBalances = { ...low.balances, coins: 0, crystal: 0, credits: 0 };
    const lowConsumed = {
        ...low.ledger.consumed,
        coins: low.ledger.consumed.coins + low.balances.coins,
        crystal: low.ledger.consumed.crystal + low.balances.crystal,
        credits: low.ledger.consumed.credits + low.balances.credits,
    };
    const lowSnapshot = {
        ...low,
        balances: lowBalances,
        ledger: { ...low.ledger, consumed: lowConsumed },
        expeditionSnapshot: { ...low.expeditionSnapshot, resources: { ...low.expeditionSnapshot.resources, crystal: 0 } },
        shopSnapshot: { ...low.shopSnapshot, balances: { coins: 0, crystals: 0 } },
    };
    const noPaywall = EconomyService.fromSnapshot(lowSnapshot);
    const beforeOptional = noPaywall.snapshot();
    const blockedOptional = noPaywall.apply({ requestId: 'no-paywall', type: 'shop-purchase', productId: available.productId });
    assert.equal(blockedOptional.status, 'failure');
    assert.equal(blockedOptional.reason, 'INSUFFICIENT_FUNDS');
    assertConservation(noPaywall.snapshot(), 'bankruptcy boundary');
    assert.equal(noPaywall.snapshot().balances.coins, beforeOptional.balances.coins);
    const recovered = noPaywall.advanceDay(noPaywall.snapshot().day + 1, 'bankruptcy-recovery');
    assert.equal(recovered.status, 'success');
    assert.equal(recovered.events.includes('bankruptcy-boundary'), true, 'opening liquidity shortfall must be observable');
    assert.equal(noPaywall.snapshot().bankrupt, false, 'daily free income must recover the boundary without a paywall');
    assertConservation(noPaywall.snapshot(), 'bankruptcy recovery');
}

function assertAdversarialBoundaries() {
    const service = new EconomyService({ seed: 0xdecafbad });
    const beforeInvalid = service.serialize();
    const invalidType = service.apply({ requestId: 'unknown-command', type: 'future-command', payload: { day: 1 } });
    assert.equal(invalidType.status, 'failure');
    assert.equal(invalidType.reason, 'INVALID_COMMAND');
    assert.equal(invalidType.type, null);
    assert.equal(service.serialize(), beforeInvalid, 'unknown command must not mutate state');
    assert.equal(service.snapshot().processedCommands.length, 0, 'unknown command must not be processed');

    const malformedCommand = service.apply({ requestId: 'unsafe-day', type: 'advance-day', day: Number.MAX_SAFE_INTEGER + 1 });
    assert.equal(malformedCommand.reason, 'INVALID_COMMAND');
    assert.equal(service.snapshot().processedCommands.length, 0, 'malformed command must not be processed');

    service.advanceDay(1);
    const checkpoint = service.snapshot();
    const tamperedPrice = clone(checkpoint);
    tamperedPrice.priceIndex.bulwark_coins += 1;
    assert.throws(() => EconomyService.fromSnapshot(tamperedPrice), /price index does not match day/, 'restore must recompute price from day and reject tampering');

    const tamperedCraftingSeed = clone(checkpoint);
    tamperedCraftingSeed.equipmentSnapshot.seed += 1;
    assert.throws(() => EconomyService.fromSnapshot(tamperedCraftingSeed), /crafting seed does not match/, 'restore must bind crafting seed to the top-level seed');

    const tamperedShopSeed = clone(checkpoint);
    tamperedShopSeed.shopSnapshot.seed += 1;
    assert.throws(() => EconomyService.fromSnapshot(tamperedShopSeed), /shop seed does not match/, 'restore must bind shop seed to the top-level seed');

    const tamperedExpeditionClock = clone(checkpoint);
    tamperedExpeditionClock.expeditionSnapshot.nextExpeditionNumber += 1;
    assert.throws(() => EconomyService.fromSnapshot(tamperedExpeditionClock), /nextExpeditionNumber does not match/, 'restore must bind expedition numbering to dispatch history');

    const duplicateAdvance = clone(checkpoint);
    const originalAdvance = duplicateAdvance.processedCommands.find((item) => item.result.type === 'advance-day');
    const duplicateAdvanceCommand = clone(originalAdvance);
    duplicateAdvanceCommand.requestId = 'duplicate-day-1';
    duplicateAdvanceCommand.result.requestId = 'duplicate-day-1';
    duplicateAdvance.processedCommands.push(duplicateAdvanceCommand);
    assert.throws(() => EconomyService.fromSnapshot(duplicateAdvance), /duplicate or out-of-range success/, 'same-day successful replay must not add an expedition dispatch');

    const failedDay = service.apply({ requestId: 'failed-day', type: 'advance-day', day: 3 });
    assert.equal(failedDay.status, 'failure');
    assert.doesNotThrow(() => EconomyService.fromSnapshot(service.snapshot()), 'failed advance-day commands must not affect dispatch history');

    const tamperedLedgerInitial = clone(checkpoint);
    tamperedLedgerInitial.ledger.initial.credits += 1;
    tamperedLedgerInitial.ledger.produced.credits -= 1;
    assert.throws(() => EconomyService.fromSnapshot(tamperedLedgerInitial), /ledger\.initial does not match config/, 'restore must bind ledger initial balances to config');

    const tamperedSolventBankruptcy = clone(checkpoint);
    tamperedSolventBankruptcy.bankrupt = true;
    assert.throws(() => EconomyService.fromSnapshot(tamperedSolventBankruptcy), /bankruptcy state/, 'restore must reject a forged solvent bankruptcy flag');

    const tamperedNested = clone(checkpoint);
    tamperedNested.shopSnapshot.listings[0].unexpected = true;
    assert.throws(() => EconomyService.fromSnapshot(tamperedNested), /shop listing.*keys are invalid/, 'nested snapshot objects must use exact keys');

    assert.throws(() => new EconomyService({ seed: Number.NaN }), /seed must be/, 'NaN seed must be rejected');
    assert.throws(() => new EconomyService({ seed: Number.MAX_SAFE_INTEGER + 1 }), /seed must be/, 'unsafe seed must be rejected');

    const bankruptConfig = clone(ECONOMY_CONFIG);
    bankruptConfig.resources = bankruptConfig.resources.map((resource) => resource.id === 'credits' ? { ...resource, initial: 0 } : resource);
    bankruptConfig.dailyCreditIncome = 1;
    const bankruptService = new EconomyService({ config: bankruptConfig, seed: 7 });
    const bankruptResult = bankruptService.advanceDay(1, 'real-bankruptcy');
    assert.equal(bankruptResult.status, 'success');
    assert.equal(bankruptService.snapshot().bankrupt, true, 'low-income configuration must reach real bankruptcy');
    assert.equal(bankruptService.snapshot().balances.credits >= 0, true, 'bankruptcy must preserve non-negative credits');
    assert.equal(bankruptService.snapshot().balances.credits < bankruptConfig.mandatoryCreditCost, true, 'bankruptcy boundary must remain below mandatory cost');
    assertConservation(bankruptService.snapshot(), 'real bankruptcy');
    const restoredBankrupt = EconomyService.fromSnapshot(bankruptService.snapshot(), bankruptConfig);
    assert.equal(restoredBankrupt.snapshot().bankrupt, true, 'real bankruptcy must survive fromSnapshot and its internal re-assert');
    const constructorRestoredBankrupt = new EconomyService({ config: bankruptConfig, snapshot: bankruptService.snapshot() });
    assert.equal(constructorRestoredBankrupt.snapshot().bankrupt, true, 'real bankruptcy must survive constructor restore and its second assert');
    const tamperedBankruptcy = bankruptService.snapshot();
    tamperedBankruptcy.bankrupt = false;
    assert.throws(() => EconomyService.fromSnapshot(tamperedBankruptcy, bankruptConfig), /bankruptcy state/, 'restore must reject a forged bankrupt recovery flag');
}

assertScope();
assertConfiguration();
assertDeterminismAndRecovery();
assertIdempotency();
assertAdversarialBoundaries();

console.log(JSON.stringify({
    task: 'T241',
    status: 'passed',
    days: 30,
    checks: ['determinism', 'resource-conservation', 'non-negative-boundary', 'inflation', 'save-restore', 'rollback', 'idempotency', 'config-cross-table', 'skeleton-diff', 'invalid-command', 'snapshot-exact-keys', 'derived-seed-rejection', 'expedition-history-rejection', 'ledger-initial-rejection', 'bankruptcy-history-rejection', 'seed-rejection', 'real-bankruptcy', 'scope'],
}));
