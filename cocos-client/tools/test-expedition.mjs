import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
    EXPEDITION_CONFIG,
    ExpeditionService,
    canonicalJson,
    loadExpeditionConfig,
    parseExpeditionConfig,
    restoreExpeditionService,
    serializeExpeditionSnapshot,
    serializeExpeditionConfig,
    validateExpeditionConfig,
} = await import('../assets/scripts/meta/expedition/index.ts');

const toolsRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(toolsRoot, '..');
const allowedPaths = ['cocos-client/assets/scripts/meta/expedition/', 'cocos-client/tools/test-expedition.mjs'];

function clone(value) { return structuredClone(value); }

function assertAtomic(service, action, expectedReason) {
    const before = service.serialize();
    const result = action();
    assert.equal(result.success, false);
    if (expectedReason) assert.equal(result.reason, expectedReason);
    assert.equal(service.serialize(), before, `failure ${expectedReason ?? ''} must be atomic`);
    return result;
}

function makeService(options = {}) {
    return new ExpeditionService({
        resources: {
            stamina: 50,
            experience: 0,
            silver: 0,
            crystal: 0,
            materials: { alloy: 0, crystal_shard: 0, field_ration: 0 },
            ...(options.resources ?? {}),
        },
        ...(options.config ? { config: options.config } : {}),
    });
}

function checkSkeletonAndDiff() {
    const expeditionRoot = resolve(projectRoot, 'assets/scripts/meta/expedition');
    const required = ['expedition-contract.ts', 'expedition-config.ts', 'expedition-service.ts', 'index.ts'];
    for (const file of required) assert.equal(existsSync(resolve(expeditionRoot, file)), true, `missing expedition skeleton file: ${file}`);
    const files = readdirSync(expeditionRoot);
    assert.deepEqual(files.filter((file) => file.endsWith('.meta')), [], 'expedition must not generate Cocos metadata placeholders');
    assert.equal(files.some((file) => /\.(png|jpg|jpeg|webp|glb|prefab|scene)$/i.test(file)), false, 'expedition must not contain generated resources');
    const indexSource = readFileSync(resolve(expeditionRoot, 'index.ts'), 'utf8');
    assert.match(indexSource, /expedition-contract/);
    assert.match(indexSource, /expedition-config/);
    assert.match(indexSource, /expedition-service/);

    const diffCommit = process.env.T236_DIFF_COMMIT ?? 'HEAD';
    const diffParent = process.env.T236_DIFF_PARENT ?? process.env.T236_DIFF_BASE ?? `${diffCommit}^`;
    const committedDiff = execFileSync('git', ['diff', '--name-only', diffParent, diffCommit, '--'], { cwd: projectRoot, encoding: 'utf8' })
        .split('\n').map((file) => file.trim()).filter(Boolean);
    const workingDiffBase = process.env.T236_WORKING_DIFF_BASE ?? 'HEAD';
    const workingDiff = execFileSync('git', ['diff', '--name-only', workingDiffBase, '--'], { cwd: projectRoot, encoding: 'utf8' })
        .split('\n').map((file) => file.trim()).filter(Boolean);
    const trackedDiff = [...new Set([...committedDiff, ...workingDiff])];
    const disallowed = trackedDiff.filter((file) => !allowedPaths.some((allowed) => allowed.endsWith('/') ? file.startsWith(allowed) : file === allowed));
    assert.deepEqual(disallowed, [], `tracked diff contains files outside T236 scope: ${disallowed.join(', ')}`);
}

checkSkeletonAndDiff();

assert.deepEqual(validateExpeditionConfig(EXPEDITION_CONFIG), [], 'default expedition config must be valid');
const serializedConfig = serializeExpeditionConfig(EXPEDITION_CONFIG);
assert.equal(serializedConfig, serializeExpeditionConfig(parseExpeditionConfig(serializedConfig)), 'config JSON must round-trip deterministically');
const reorderedConfig = clone(EXPEDITION_CONFIG);
reorderedConfig.materials.reverse();
reorderedConfig.units.reverse();
reorderedConfig.rewards.reverse();
reorderedConfig.destinations.reverse();
reorderedConfig.rewards[0].materials.reverse();
assert.equal(serializedConfig, serializeExpeditionConfig(reorderedConfig), 'table and grant order must not affect config serialization');

const badMaterialReference = clone(EXPEDITION_CONFIG);
badMaterialReference.rewards[0].materials[0].materialId = 'missing_material';
assert.equal(validateExpeditionConfig(badMaterialReference).some((error) => error.includes('unknown material')), true);
const badRewardReference = clone(EXPEDITION_CONFIG);
badRewardReference.destinations[0].rewardId = 'missing_reward';
assert.equal(validateExpeditionConfig(badRewardReference).some((error) => error.includes('unknown reward')), true);
const badDuration = clone(EXPEDITION_CONFIG);
badDuration.destinations[0].durationMs = 0;
assert.equal(validateExpeditionConfig(badDuration).some((error) => error.includes('durationMs')), true);
const badTeamBounds = clone(EXPEDITION_CONFIG);
badTeamBounds.destinations[0].maxTeamSize = 1;
assert.equal(validateExpeditionConfig(badTeamBounds).some((error) => error.includes('maxTeamSize')), true);

const service = makeService();
const dispatch = service.dispatch('border_watch', ['warden', 'scout'], 10_000);
assert.deepEqual(dispatch, {
    status: 'success', success: true, expeditionId: 'expedition-1', reason: null, endsAt: 70_000,
}, 'dispatch must use only the supplied deterministic timestamp');
assert.deepEqual(service.getExpedition(), {
    id: 'expedition-1', destinationId: 'border_watch', rewardId: 'frontier_cache',
    unitIds: ['scout', 'warden'], dispatchedAt: 10_000, endsAt: 70_000, status: 'active',
});
assert.deepEqual(service.getLockedUnitIds(), ['scout', 'warden']);
assert.equal(service.isUnitLocked('scout'), true);
assert.equal(service.isUnitLocked('mystic'), false);
assert.equal(service.getResources().stamina, 40, 'dispatch must consume stamina exactly once');

assertAtomic(service, () => service.dispatch('border_watch', ['vanguard', 'mystic'], 10_001), 'EXPEDITION_IN_PROGRESS');
assertAtomic(service, () => service.dispatch('missing', ['vanguard', 'mystic'], 10_001), 'UNKNOWN_DESTINATION');
assertAtomic(service, () => service.dispatch('border_watch', ['vanguard'], 10_001), 'EXPEDITION_IN_PROGRESS');

const readyBeforeBoundary = service.serialize();
assert.deepEqual(service.settle(69_999), { status: 'failure', success: false, expeditionId: 'expedition-1', reason: 'NOT_READY', ready: false });
assert.equal(service.serialize(), readyBeforeBoundary, 'settlement before end must not mutate');
assert.deepEqual(service.settle(70_000), { status: 'success', success: true, expeditionId: 'expedition-1', reason: null, ready: true });
assert.equal(service.getExpedition()?.status, 'ready', 'timestamp equal to endsAt must settle');
assert.deepEqual(service.settle(70_000), { status: 'success', success: true, expeditionId: 'expedition-1', reason: null, ready: true });

const claim = service.claim(70_000, 'expedition-1');
assert.equal(claim.success, true);
assert.deepEqual(claim.reward, EXPEDITION_CONFIG.rewards.find((reward) => reward.id === 'frontier_cache'));
assert.deepEqual(service.getResources(), {
    stamina: 40, experience: 120, silver: 240, crystal: 2,
    materials: { alloy: 2, crystal_shard: 0, field_ration: 1 },
});
assert.equal(service.getExpedition(), null, 'successful claim must release the expedition slot and team');
assert.deepEqual(service.getLockedUnitIds(), []);
assert.equal(service.isUnitLocked('scout'), false);
const claimedState = service.serialize();
assert.equal(service.claim(70_000, 'expedition-1').reason, 'ALREADY_CLAIMED', 'claiming the same expedition twice must be rejected');
assert.equal(service.serialize(), claimedState, 'duplicate claim must not mutate resources');

const boundaryService = makeService();
assertAtomic(boundaryService, () => boundaryService.dispatch('border_watch', ['vanguard'], 0), 'TEAM_TOO_SMALL');
assertAtomic(boundaryService, () => boundaryService.dispatch('border_watch', ['vanguard', 'vanguard'], 0), 'DUPLICATE_UNIT');
assertAtomic(boundaryService, () => boundaryService.dispatch('border_watch', ['vanguard', 'missing'], 0), 'UNKNOWN_UNIT');
assertAtomic(boundaryService, () => boundaryService.dispatch('deep_zone', ['vanguard', 'warden'], 0), 'TEAM_TOO_SMALL');
assertAtomic(boundaryService, () => boundaryService.dispatch('deep_zone', ['vanguard', 'warden', 'mystic', 'scout', 'ranger'], 0), 'TEAM_TOO_LARGE');
assertAtomic(boundaryService, () => boundaryService.dispatch('deep_zone', ['ranger', 'scout', 'mystic'], 0), 'INSUFFICIENT_POWER');

const invalidTimestampService = makeService();
for (const timestamp of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    assertAtomic(invalidTimestampService, () => invalidTimestampService.dispatch('border_watch', ['vanguard', 'mystic'], timestamp), 'INVALID_TIMESTAMP');
}
const insufficientStamina = makeService({ resources: { stamina: 9 } });
assertAtomic(insufficientStamina, () => insufficientStamina.dispatch('border_watch', ['vanguard', 'mystic'], 0), 'INSUFFICIENT_STAMINA');
const timeOverflow = makeService();
assertAtomic(timeOverflow, () => timeOverflow.dispatch('border_watch', ['vanguard', 'mystic'], Number.MAX_SAFE_INTEGER - 59_999), 'TIME_OVERFLOW');

const notReadyService = makeService();
notReadyService.dispatch('border_watch', ['vanguard', 'mystic'], 0);
assertAtomic(notReadyService, () => notReadyService.claim(59_999), 'NOT_READY');
assertAtomic(notReadyService, () => notReadyService.claim(60_000, 'wrong-id'), 'EXPEDITION_MISMATCH');
assertAtomic(notReadyService, () => notReadyService.claim(Number.NaN), 'INVALID_TIMESTAMP');

const overflowService = makeService({ resources: { silver: Number.MAX_SAFE_INTEGER - 239 } });
overflowService.dispatch('border_watch', ['vanguard', 'mystic'], 0);
assertAtomic(overflowService, () => overflowService.claim(60_000), 'REWARD_OVERFLOW');
assert.equal(overflowService.getExpedition()?.status, 'active', 'reward overflow must preserve the unclaimed expedition');

function baseSnapshot(overrides = {}) {
    return {
        schemaVersion: 1,
        nextExpeditionNumber: 1,
        resources: { stamina: 50, experience: 0, silver: 0, crystal: 0, materials: { alloy: 0, crystal_shard: 0, field_ration: 0 } },
        expedition: null,
        claimedExpeditionIds: [],
        ...overrides,
    };
}

for (const [snapshot, message] of [
    [baseSnapshot({ nextExpeditionNumber: 0 }), 'nextExpeditionNumber'],
    [baseSnapshot({ claimedExpeditionIds: ['expedition-01'] }), 'canonical expedition IDs'],
    [baseSnapshot({ claimedExpeditionIds: ['expedition-1', 'expedition-1'] }), 'unique'],
    [baseSnapshot({ nextExpeditionNumber: 1, claimedExpeditionIds: ['expedition-2'] }), 'ahead of nextExpeditionNumber'],
    [baseSnapshot({ nextExpeditionNumber: 2, claimedExpeditionIds: ['expedition-1'], expedition: { id: 'expedition-1', destinationId: 'border_watch', rewardId: 'frontier_cache', unitIds: ['vanguard', 'mystic'], dispatchedAt: 0, endsAt: 60_000, status: 'active' } }), 'already claimed'],
]) {
    assert.throws(() => restoreExpeditionService(snapshot), new RegExp(message), `malicious snapshot must be rejected: ${message}`);
}

const reusedCursorSnapshot = baseSnapshot({ nextExpeditionNumber: 1, claimedExpeditionIds: ['expedition-1'] });
const reusedCursorService = restoreExpeditionService(reusedCursorSnapshot);
assert.equal(reusedCursorService.dispatch('border_watch', ['vanguard', 'mystic'], 0).expeditionId, 'expedition-2', 'dispatch must skip a used cursor ID');

const idOverflowService = new ExpeditionService({
    nextExpeditionNumber: Number.MAX_SAFE_INTEGER,
    resources: { stamina: 50, experience: 0, silver: 0, crystal: 0, materials: { alloy: 0, crystal_shard: 0, field_ration: 0 } },
});
assertAtomic(idOverflowService, () => idOverflowService.dispatch('border_watch', ['vanguard', 'mystic'], 0), 'EXPEDITION_ID_OVERFLOW');
const maxIssuedService = new ExpeditionService({
    nextExpeditionNumber: Number.MAX_SAFE_INTEGER - 1,
    resources: { stamina: 50, experience: 0, silver: 0, crystal: 0, materials: { alloy: 0, crystal_shard: 0, field_ration: 0 } },
});
assert.equal(maxIssuedService.dispatch('border_watch', ['vanguard', 'mystic'], 0).expeditionId, `expedition-${Number.MAX_SAFE_INTEGER - 1}`);
assert.equal(maxIssuedService.snapshot().nextExpeditionNumber, Number.MAX_SAFE_INTEGER, 'next ID cursor must remain safe after the last representable increment');
assertAtomic(maxIssuedService, () => maxIssuedService.dispatch('border_watch', ['vanguard', 'mystic'], 60_000), 'EXPEDITION_IN_PROGRESS');
maxIssuedService.claim(60_000);
assertAtomic(maxIssuedService, () => maxIssuedService.dispatch('border_watch', ['vanguard', 'mystic'], 60_000), 'EXPEDITION_ID_OVERFLOW');

const deterministicA = makeService();
const deterministicB = makeService();
deterministicA.dispatch('border_watch', ['mystic', 'vanguard'], 1234);
deterministicB.dispatch('border_watch', ['vanguard', 'mystic'], 1234);
assert.equal(deterministicA.serialize(), deterministicB.serialize(), 'team input order must not affect serialized state');
const restored = restoreExpeditionService(JSON.parse(deterministicA.serialize()));
assert.equal(restored.serialize(), deterministicA.serialize(), 'snapshot restore must be lossless');
assert.equal(deterministicA.serialize(), serializeExpeditionSnapshot(JSON.parse(deterministicA.serialize())));
assert.equal(canonicalJson(JSON.parse(deterministicA.serialize())), deterministicA.serialize(), 'snapshot JSON must use canonical key order');

const claimedRestored = restoreExpeditionService(JSON.parse(claimedState));
assert.equal(claimedRestored.serialize(), claimedState, 'claimed history must survive serialization and restore');
assert.equal(claimedRestored.claim(70_000, 'expedition-1').reason, 'ALREADY_CLAIMED');

const noExpeditionService = makeService();
assertAtomic(noExpeditionService, () => noExpeditionService.settle(0), 'NO_EXPEDITION');
assertAtomic(noExpeditionService, () => noExpeditionService.claim(0), 'NO_EXPEDITION');
assert.equal(noExpeditionService.dispatch('border_watch', ['vanguard', 'mystic'], 0).success, true, 'released units must be dispatchable again');

console.log(JSON.stringify({
    task: 'T236',
    status: 'passed',
    assertions: 'config-load-cross-table-serialization, dispatch-team-validation, deterministic-time-boundary, atomic-failures, claim-idempotency, overflow, skeleton-diff',
    files: ['assets/scripts/meta/expedition/', 'tools/test-expedition.mjs'],
}, null, 2));
