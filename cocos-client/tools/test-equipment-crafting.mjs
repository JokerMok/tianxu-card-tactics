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
    CRAFTING_CONFIG,
    EquipmentCraftingService,
    craftRequestFingerprint,
    loadCraftingConfig,
    parseCraftingConfig,
    serializeCraftingConfig,
    serializeCraftingSnapshot,
    validateCraftingConfig,
    restoreCraftingService,
} = await import('../assets/scripts/meta/equipment/crafting/index.ts');

const toolsRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(toolsRoot, '..');
const allowedPaths = [
    'assets/scripts/meta/equipment/crafting/',
    'tools/test-equipment-crafting.mjs',
];

function clone(value) { return structuredClone(value); }

function assertContains(errors, fragment) {
    assert.equal(errors.some((error) => error.includes(fragment)), true, `expected validation error containing: ${fragment}`);
}

function makeInventory(equipmentIds, lockedIds = []) {
    return equipmentIds.map((equipmentId, index) => ({
        instanceId: `instance-${index + 1}`,
        equipmentId,
        locked: lockedIds.includes(`instance-${index + 1}`),
    }));
}

function makeService(config, equipmentIds, options = {}) {
    return new EquipmentCraftingService({
        config,
        seed: options.seed ?? 0x233,
        inventory: makeInventory(equipmentIds, options.lockedIds ?? []),
        materials: options.materials ?? { alloy: 10, circuit: 10, core: 10 },
    });
}

function craft(service, requestId, recipeId, inputInstanceIds) {
    return service.craft({ requestId, recipeId, inputInstanceIds });
}

function withRates(rateByRecipe) {
    return loadCraftingConfig({
        ...clone(CRAFTING_CONFIG),
        recipes: CRAFTING_CONFIG.recipes.map((recipe) => ({
            ...clone(recipe),
            successRateBps: rateByRecipe[recipe.id] ?? recipe.successRateBps,
        })),
    });
}

function checkSkeletonAndDiff() {
    const craftingRoot = resolve(projectRoot, 'assets/scripts/meta/equipment/crafting');
    const required = ['crafting-contract.ts', 'crafting-config.ts', 'crafting-service.ts', 'index.ts'];
    for (const file of required) assert.equal(existsSync(resolve(craftingRoot, file)), true, `missing crafting skeleton file: ${file}`);
    const files = readdirSync(craftingRoot);
    assert.deepEqual(files.filter((file) => file.endsWith('.meta')), [], 'crafting must not generate Cocos metadata placeholders');
    assert.equal(files.some((file) => /\.(png|jpg|jpeg|webp|glb|prefab|scene)$/i.test(file)), false, 'crafting must not contain placeholder resources');
    const indexSource = readFileSync(resolve(craftingRoot, 'index.ts'), 'utf8');
    assert.match(indexSource, /crafting-contract/);
    assert.match(indexSource, /crafting-config/);
    assert.match(indexSource, /crafting-service/);

    const trackedDiff = execFileSync('git', ['diff', '--name-only', 'HEAD^', 'HEAD', '--'], { cwd: projectRoot, encoding: 'utf8' })
        .split('\n').map((file) => file.trim()).filter(Boolean);
    const disallowed = trackedDiff.filter((file) => !allowedPaths.some((allowed) => allowed.endsWith('/') ? file.startsWith(allowed) : file === allowed));
    assert.deepEqual(disallowed, [], `tracked diff contains files outside T233 scope: ${disallowed.join(', ')}`);
}

checkSkeletonAndDiff();

const configErrors = validateCraftingConfig(CRAFTING_CONFIG);
assert.deepEqual(configErrors, [], 'default crafting config must be valid');
const serializedConfig = serializeCraftingConfig(CRAFTING_CONFIG);
assert.equal(serializedConfig, serializeCraftingConfig(parseCraftingConfig(serializedConfig)), 'config JSON must round-trip deterministically');
const reorderedConfig = clone(CRAFTING_CONFIG);
reorderedConfig.materials.reverse();
reorderedConfig.equipment.reverse();
reorderedConfig.recipes.reverse();
reorderedConfig.recipes[0].inputEquipmentIds.reverse();
assert.equal(serializedConfig, serializeCraftingConfig(reorderedConfig), 'table and input order must not affect config serialization');

const badMaterialReference = clone(CRAFTING_CONFIG);
badMaterialReference.equipment[0].materialId = 'missing_material';
assertContains(validateCraftingConfig(badMaterialReference), 'unknown material');
const badInputReference = clone(CRAFTING_CONFIG);
badInputReference.recipes[0].inputEquipmentIds[0] = 'missing_equipment';
assertContains(validateCraftingConfig(badInputReference), 'unknown input equipment');
const badOutputReference = clone(CRAFTING_CONFIG);
badOutputReference.recipes[0].outputEquipmentId = 'missing_output';
assertContains(validateCraftingConfig(badOutputReference), 'unknown output equipment');
const badInputCount = clone(CRAFTING_CONFIG);
badInputCount.recipes[0].inputEquipmentIds = ['scrap_blade'];
assertContains(validateCraftingConfig(badInputCount), 'contain 2 to 4');
badInputCount.recipes[0].inputEquipmentIds = ['scrap_blade', 'scrap_armor', 'scrap_scope', 'scrap_core', 'pulse_blade'];
assertContains(validateCraftingConfig(badInputCount), 'contain 2 to 4');
const badCostReference = clone(CRAFTING_CONFIG);
badCostReference.recipes[0].materialCosts = [{ materialId: 'alloy', quantity: 1 }, { materialId: 'alloy', quantity: 2 }];
assertContains(validateCraftingConfig(badCostReference), 'duplicate material cost');
const badRate = clone(CRAFTING_CONFIG);
badRate.recipes[0].successRateBps = 10_001;
assertContains(validateCraftingConfig(badRate), 'from 0 to 10000');

const canonicalRequest = { requestId: 'canonical-request', recipeId: 'forge_pair', inputInstanceIds: ['instance-2', 'instance-1'] };
assert.equal(
    craftRequestFingerprint(canonicalRequest),
    craftRequestFingerprint({ ...canonicalRequest, inputInstanceIds: ['instance-1', 'instance-2'] }),
    'request fingerprint must canonicalize input order',
);
assert.notEqual(
    craftRequestFingerprint(canonicalRequest),
    craftRequestFingerprint({ ...canonicalRequest, requestId: 'another-request' }),
    'request fingerprint must bind requestId',
);

const alwaysSuccess = withRates({ forge_pair: 10_000, forge_triad: 10_000, forge_quad: 10_000 });
for (const [recipeId, equipmentIds] of [
    ['forge_pair', ['scrap_blade', 'scrap_armor']],
    ['forge_triad', ['scrap_blade', 'scrap_armor', 'scrap_scope']],
    ['forge_quad', ['scrap_blade', 'scrap_armor', 'scrap_scope', 'scrap_core']],
]) {
    const service = makeService(alwaysSuccess, equipmentIds);
    const result = craft(service, `${recipeId}-success`, recipeId, [...equipmentIds.map((_, index) => `instance-${index + 1}`).reverse()]);
    assert.equal(result.status, 'success', `${recipeId} must succeed at 100%`);
    assert.equal(result.success, true);
    assert.equal(result.consumedInputIds.length, equipmentIds.length, `${recipeId} must consume all 2-4 inputs`);
    assert.deepEqual(result.returnedInputIds, []);
    assert.equal(result.output?.locked, false, `${recipeId} output must be unlocked`);
    assert.equal(service.getInventory().filter((item) => item.locked).length, 0, `${recipeId} must not leave locks behind`);
}

const successReplayService = makeService(alwaysSuccess, ['scrap_blade', 'scrap_armor'], { seed: 700 });
const successRequest = { requestId: 'success-replay', recipeId: 'forge_pair', inputInstanceIds: ['instance-1', 'instance-2'] };
const successResult = successReplayService.craft(successRequest);
const successReplayBefore = successReplayService.serialize();
assert.deepEqual(successReplayService.craft({ ...successRequest, inputInstanceIds: ['instance-2', 'instance-1'] }), successResult, 'successful request replay must return the original result');
assert.equal(successReplayService.serialize(), successReplayBefore, 'successful request replay must not consume again');
assert.throws(() => successReplayService.craft({ ...successRequest, inputInstanceIds: ['instance-1', 'instance-1'] }), /different request/, 'successful request replay must reject duplicate inputs');
assert.throws(() => successReplayService.craft({ ...successRequest, recipeId: 'forge_triad' }), /different request/, 'requestId must be bound to its request fingerprint');

const differentInputReplayService = makeService(alwaysSuccess, ['scrap_blade', 'scrap_armor', 'scrap_scope']);
differentInputReplayService.craft({ requestId: 'different-input-replay', recipeId: 'forge_pair', inputInstanceIds: ['instance-1', 'instance-2'] });
const differentInputReplayBefore = differentInputReplayService.serialize();
assert.throws(
    () => differentInputReplayService.craft({ requestId: 'different-input-replay', recipeId: 'forge_pair', inputInstanceIds: ['instance-1', 'instance-3'] }),
    /different request/,
    'same requestId with different inputs must fail closed',
);
assert.equal(differentInputReplayService.serialize(), differentInputReplayBefore, 'rejected request reuse must not mutate state');

const alwaysFail = withRates({ forge_pair: 0, forge_triad: 0, forge_quad: 0 });
const failService = makeService(alwaysFail, ['scrap_blade', 'scrap_armor'], { seed: 99 });
const failBefore = failService.serialize();
const failRequest = { requestId: 'failure-replay', recipeId: 'forge_pair', inputInstanceIds: ['instance-2', 'instance-1'] };
const failResult = failService.craft(failRequest);
assert.equal(failResult.reason, 'CRAFT_FAILED');
assert.equal(failResult.attempt, 0);
assert.equal(failService.snapshot().attempt, 1, 'valid failed craft must advance exactly one attempt');
assert.deepEqual(failResult.returnedInputIds, ['instance-1', 'instance-2']);
assert.deepEqual(failResult.consumedInputIds, []);
assert.equal(failService.getMaterialBalance('alloy'), 10, 'failed craft must not consume materials');
assert.equal(failService.getInventory().every((item) => !item.locked), true, 'failed craft must unlock and return every input');
assert.notEqual(failService.serialize(), failBefore, 'valid craft attempt must advance deterministic attempt state');
const failedReplayBefore = failService.serialize();
assert.deepEqual(failService.craft({ ...failRequest, inputInstanceIds: ['instance-1', 'instance-2'] }), failResult, 'failed request replay must return the original result');
assert.equal(failService.serialize(), failedReplayBefore, 'failed request replay must not advance attempt or mutate state');

const duplicateFailureService = makeService(alwaysSuccess, ['scrap_blade', 'scrap_armor']);
const duplicateFailureRequest = { requestId: 'duplicate-failure-restore', recipeId: 'forge_pair', inputInstanceIds: ['instance-1', 'instance-1'] };
const duplicateFailureResult = duplicateFailureService.craft(duplicateFailureRequest);
const restoredDuplicateFailure = restoreCraftingService(JSON.parse(duplicateFailureService.serialize()), alwaysSuccess);
assert.equal(duplicateFailureResult.reason, 'DUPLICATE_INPUT');
assert.deepEqual(restoredDuplicateFailure.craft(duplicateFailureRequest), duplicateFailureResult, 'failed duplicate-input record must restore and replay');

const deterministicA = makeService(alwaysFail, ['scrap_blade', 'scrap_armor'], { seed: 12345 });
const deterministicB = makeService(alwaysFail, ['scrap_blade', 'scrap_armor'], { seed: 12345 });
const resultA = craft(deterministicA, 'deterministic-replay', 'forge_pair', ['instance-1', 'instance-2']);
const resultB = craft(deterministicB, 'deterministic-replay', 'forge_pair', ['instance-2', 'instance-1']);
assert.deepEqual(resultA, resultB, 'same seed and inputs must produce the same result regardless of order');
assert.equal(deterministicA.serialize(), deterministicB.serialize(), 'same operation must produce the same serialized state');

const lockedService = makeService(alwaysSuccess, ['scrap_blade', 'scrap_armor'], { lockedIds: ['instance-1'] });
const lockedBefore = lockedService.serialize();
const lockedResult = craft(lockedService, 'locked-input', 'forge_pair', ['instance-1', 'instance-2']);
assert.equal(lockedResult.reason, 'INPUT_LOCKED');
assert.deepEqual(lockedResult.returnedInputIds, ['instance-2'], 'locked input must not be falsely reported as returned');
const lockedAfter = JSON.parse(lockedService.serialize());
const lockedBeforeSnapshot = JSON.parse(lockedBefore);
assert.deepEqual(lockedAfter.equipment, lockedBeforeSnapshot.equipment, 'locked preflight failure must not mutate inventory');
assert.deepEqual(lockedAfter.materials, lockedBeforeSnapshot.materials, 'locked preflight failure must not consume materials');
assert.equal(lockedAfter.attempt, lockedBeforeSnapshot.attempt, 'locked preflight failure must not advance attempt');

const boundaryService = makeService(alwaysSuccess, ['scrap_blade', 'scrap_armor', 'scrap_scope', 'scrap_core']);
assert.equal(craft(boundaryService, 'boundary-count-low', 'forge_pair', ['instance-1']).reason, 'INVALID_INPUT_COUNT');
assert.equal(craft(boundaryService, 'boundary-count-high', 'forge_quad', ['instance-1', 'instance-2', 'instance-3', 'instance-4', 'instance-1']).reason, 'INVALID_INPUT_COUNT');
assert.equal(craft(boundaryService, 'boundary-duplicate', 'forge_pair', ['instance-1', 'instance-1']).reason, 'DUPLICATE_INPUT');
assert.equal(craft(boundaryService, 'boundary-unknown', 'forge_pair', ['instance-1', 'missing']).reason, 'UNKNOWN_INPUT');
assert.equal(craft(boundaryService, 'boundary-mismatch', 'forge_pair', ['instance-1', 'instance-2', 'instance-3']).reason, 'INPUT_MISMATCH');
const noMaterialService = makeService(alwaysSuccess, ['scrap_blade', 'scrap_armor'], { materials: { alloy: 0 } });
assert.equal(craft(noMaterialService, 'no-material', 'forge_pair', ['instance-1', 'instance-2']).reason, 'INSUFFICIENT_MATERIALS');
assert.equal(noMaterialService.getInventory().every((item) => !item.locked), true);

const serialService = makeService(alwaysSuccess, ['scrap_blade', 'scrap_armor', 'scrap_scope'], { seed: 77 });
serialService.craft({ requestId: 'serialized-replay', recipeId: 'forge_pair', inputInstanceIds: ['instance-1', 'instance-2'] });
const serialPayload = serialService.serialize();
assert.equal(serialPayload, serializeCraftingSnapshot(JSON.parse(serialPayload)), 'service snapshot must be canonical JSON');
assert.equal(JSON.parse(serialPayload).processedResults.length, 1, 'snapshot must persist processed results for replay');
const restored = restoreCraftingService(JSON.parse(serialPayload), alwaysSuccess);
assert.equal(restored.serialize(), serialPayload, 'serialized service state must restore exactly');
const restoredReplayBefore = restored.serialize();
assert.deepEqual(restored.craft({ requestId: 'serialized-replay', recipeId: 'forge_pair', inputInstanceIds: ['instance-2', 'instance-1'] }), serialService.snapshot().processedResults[0].result, 'restored service must replay processed result');
assert.equal(restored.serialize(), restoredReplayBefore, 'restored replay must not mutate state');

const tamperedFingerprintSnapshot = JSON.parse(serialPayload);
tamperedFingerprintSnapshot.processedResults[0].requestFingerprint = 'tampered-fingerprint';
assert.throws(() => restoreCraftingService(tamperedFingerprintSnapshot, alwaysSuccess), /fingerprint mismatch/, 'restore must reject a tampered fingerprint');

const tamperedInputSnapshot = JSON.parse(serialPayload);
tamperedInputSnapshot.processedResults[0].inputInstanceIds = ['instance-1', 'instance-3'];
assert.throws(() => restoreCraftingService(tamperedInputSnapshot, alwaysSuccess), /fingerprint mismatch/, 'restore must reject input tampering');

const tamperedInputAndFingerprintSnapshot = JSON.parse(serialPayload);
tamperedInputAndFingerprintSnapshot.processedResults[0].inputInstanceIds = ['instance-1', 'instance-3'];
tamperedInputAndFingerprintSnapshot.processedResults[0].requestFingerprint = craftRequestFingerprint({
    requestId: tamperedInputAndFingerprintSnapshot.processedResults[0].requestId,
    recipeId: tamperedInputAndFingerprintSnapshot.processedResults[0].result.recipeId,
    inputInstanceIds: tamperedInputAndFingerprintSnapshot.processedResults[0].inputInstanceIds,
});
assert.throws(() => restoreCraftingService(tamperedInputAndFingerprintSnapshot, alwaysSuccess), /successful result input mismatch/, 'restore must reject input tampering even with a replacement fingerprint');

const duplicateSuccessSnapshot = JSON.parse(serialPayload);
duplicateSuccessSnapshot.processedResults[0].inputInstanceIds = ['instance-1', 'instance-1'];
duplicateSuccessSnapshot.processedResults[0].result.consumedInputIds = ['instance-1', 'instance-1'];
duplicateSuccessSnapshot.processedResults[0].requestFingerprint = craftRequestFingerprint({
    requestId: duplicateSuccessSnapshot.processedResults[0].requestId,
    recipeId: duplicateSuccessSnapshot.processedResults[0].result.recipeId,
    inputInstanceIds: duplicateSuccessSnapshot.processedResults[0].inputInstanceIds,
});
assert.throws(
    () => restoreCraftingService(duplicateSuccessSnapshot, alwaysSuccess),
    /successful result inputInstanceIds must be unique/,
    'restore must reject duplicate inputInstanceIds in successful records',
);

const tamperedRequestIdSnapshot = JSON.parse(serialPayload);
tamperedRequestIdSnapshot.processedResults[0].requestId = 'tampered-request-id';
assert.throws(() => restoreCraftingService(tamperedRequestIdSnapshot, alwaysSuccess), /result requestId mismatch/, 'restore must reject a requestId mismatch');

const extraSnapshotKey = JSON.parse(serialPayload);
extraSnapshotKey.unexpected = true;
assert.throws(() => restoreCraftingService(extraSnapshotKey, alwaysSuccess), /unexpected keys/, 'snapshot must reject unknown top-level keys');
const extraInstanceKey = JSON.parse(serialPayload);
extraInstanceKey.equipment[0].unexpected = true;
assert.throws(() => restoreCraftingService(extraInstanceKey, alwaysSuccess), /unexpected keys/, 'equipment instance must reject unknown keys');
const unsafeSnapshotSeed = JSON.parse(serialPayload);
unsafeSnapshotSeed.seed = Number.MAX_SAFE_INTEGER + 1;
assert.throws(() => restoreCraftingService(unsafeSnapshotSeed, alwaysSuccess), /safe integer/, 'snapshot seed must be a safe integer');
const unsafeSnapshotAttempt = JSON.parse(serialPayload);
unsafeSnapshotAttempt.attempt = Number.MAX_SAFE_INTEGER + 1;
assert.throws(() => restoreCraftingService(unsafeSnapshotAttempt, alwaysSuccess), /safe integer/, 'snapshot attempt must be a safe integer');
assert.throws(() => new EquipmentCraftingService({ seed: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/, 'seed must be a safe integer');
assert.throws(() => new EquipmentCraftingService({ attempt: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/, 'attempt must be a safe integer');

console.log(JSON.stringify({
    task: 'T233',
    status: 'passed',
    assertions: 'config-load-cross-table-serialization, success-2-4, canonical-fingerprint-binding, idempotent-replay, duplicate-input-replay-and-snapshot-guard, failure-refund, lock-rollback, deterministic-replay, exact-keys-safe-integers, boundaries, skeleton-diff',
    files: ['assets/scripts/meta/equipment/crafting/', 'tools/test-equipment-crafting.mjs'],
}, null, 2));
