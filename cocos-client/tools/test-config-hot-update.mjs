import assert from 'node:assert/strict';
import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import {
  CONFIG_UPDATE_ERROR_CODES as BACKEND_CODES,
  ConfigUpdateError as BackendError,
  ConfigUpdateService as BackendConfigUpdateService,
  createConfigSignature,
  stableJson as backendStableJson,
  verifyConfigSignature,
} from '../../backend/config-update/ConfigUpdateService.ts';
import {
  CONFIG_UPDATE_ERROR_CODES as CLIENT_CODES,
  ConfigUpdateError as ClientError,
  ConfigUpdateClientService,
  configBundleSigningBytes as clientSigningBytes,
  rolloutBucket as clientRolloutBucket,
  stableJson as clientStableJson,
} from '../assets/scripts/services/config-update/ConfigUpdateService.ts';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const { privateKey: rsaPrivateKey, publicKey: rsaPublicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
let now = 1_700_000_000_000;
let fetchSessionState = { available: true, blocked: false };
const externalVectorPublicKey = createPublicKey(`-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEA+j6Mwu1QGs+ruukpM+GgH/PQJWzN9vfe5ZNZ1uvyYdY=\n-----END PUBLIC KEY-----`);

function unsigned(overrides = {}) {
  return {
    bundleId: 'bundle-1', tenantId: 'tenant-a', configKey: 'combat.balance', version: '1.0.0', minClientVersion: '1.0.0',
    rolloutPercent: 100, rolloutSalt: 'salt-1', payload: { damageMultiplier: 1.1, source: 'signed' },
    keyId: 'release-ed25519-dynamic-1', createdAt: now, ...overrides,
  };
}
function signed(overrides = {}) { const candidate = unsigned(overrides); return { ...candidate, signature: createConfigSignature(candidate, privateKey) }; }
function expectCode(fn, code) { assert.throws(fn, (error) => error?.code === code, `expected ${code}`); }
function verifySignature(canonical, signature) { return verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, 'base64url')); }

const clientVerifier = { algorithm: 'Ed25519', trustedKeyIds: ['release-ed25519-dynamic-1'], verifyEd25519: verifySignature };
const backend = new BackendConfigUpdateService({
  now: () => now,
  publicKeys: {
    'release-ed25519-dynamic-1': publicKey,
    'release-ed25519-1': externalVectorPublicKey,
  },
  resolveIdentity: (request) => ({
    'auth:tenant-a:player-1': { tenantId: 'tenant-a', subjectId: 'player-1', clientVersion: '1.0.0', ...fetchSessionState },
    'auth:tenant-a:player-2': { tenantId: 'tenant-a', subjectId: 'player-2', clientVersion: '1.0.0', ...fetchSessionState },
    'auth:tenant-a:player-1:v2': { tenantId: 'tenant-a', subjectId: 'player-1', clientVersion: '2.0.0', ...fetchSessionState },
    'auth:tenant-b:player-1': { tenantId: 'tenant-b', subjectId: 'player-1', clientVersion: '1.0.0', ...fetchSessionState },
  })[request.authToken] ?? null,
});
const canonicalA = backendStableJson({ z: 1, a: { y: 2, x: 3 } });
const canonicalB = clientStableJson({ a: { x: 3, y: 2 }, z: 1 });
assert.equal(canonicalA, canonicalB);
const externalVectorUnsigned = {
  allowList: ['player-1'], bundleId: 'external-vector', configKey: 'combat.balance', createdAt: 1_700_000_000_000,
  keyId: 'release-ed25519-1', minClientVersion: '1.0.0', payload: { damageMultiplier: 1.25, source: 'external-vector' },
  rolloutPercent: 100, rolloutSalt: 'salt-external', tenantId: 'tenant-a', version: '2.0.0',
};
const externalVectorCanonical = '{"allowList":["player-1"],"bundleId":"external-vector","configKey":"combat.balance","createdAt":1700000000000,"keyId":"release-ed25519-1","minClientVersion":"1.0.0","payload":{"damageMultiplier":1.25,"source":"external-vector"},"rolloutPercent":100,"rolloutSalt":"salt-external","tenantId":"tenant-a","version":"2.0.0"}';
const externalVector = { ...externalVectorUnsigned, signature: '9fEu2uAjNHaughl6klAdpV9i7G0LN0pjsknBj4RIgXHtpA1RaS4sckN0y6Yo8ypejf-9se4s-v3Ve0VRCVy6CA' };
assert.equal(backendStableJson(externalVectorUnsigned), externalVectorCanonical, 'canonicalization must match the external vector bytes');
assert.equal(verifyConfigSignature(externalVector, externalVectorPublicKey), true, 'fixed external Ed25519 vector must verify');
const externalVectorVerifier = {
  algorithm: 'Ed25519',
  trustedKeyIds: ['release-ed25519-1'],
  verifyEd25519: (canonical, signature) => verify(null, Buffer.from(canonical), externalVectorPublicKey, Buffer.from(signature, 'base64url')),
};
const vectorClient = new ConfigUpdateClientService({ tenantId: 'tenant-a', clientId: 'player-1', clientVersion: '2.0.0', verifySignature: externalVectorVerifier });
assert.deepEqual(vectorClient.apply('external-vector-apply', externalVector), { applied: true, replayed: false, rolledBack: false, configKey: externalVector.configKey, version: externalVector.version }, 'client must verify a fixed external Ed25519 vector without createConfigSignature');
assert.equal(createConfigSignature(externalVectorUnsigned, privateKey).length, 86, 'Ed25519 signatures have the expected encoding length');
const first = signed();
assert.equal(verifyConfigSignature(first, publicKey), true);
expectCode(() => createConfigSignature(first, rsaPrivateKey), BACKEND_CODES.INVALID_REQUEST);
assert.equal(verifyConfigSignature(first, rsaPublicKey), false);
expectCode(() => new BackendConfigUpdateService({ publicKeys: { 'rsa-1': rsaPublicKey } }), BACKEND_CODES.INVALID_REQUEST);
const { signature: _ignoredSignature, ...firstUnsigned } = first;
assert.equal(clientSigningBytes(first), backendStableJson(firstUnsigned));

const published = backend.publish({ requestId: 'pub-1', actorId: 'ops', bundle: first });
assert.deepEqual(published, { accepted: true, replayed: false, bundle: first });
assert.deepEqual(backend.publish({ requestId: 'pub-1', actorId: 'ops', bundle: first }), { ...published, replayed: true });
let backendReplayAudit = backend.auditLog().findLast((entry) => entry.requestId === 'pub-1');
assert.deepEqual({ operation: backendReplayAudit.operation, requestId: backendReplayAudit.requestId, configKey: backendReplayAudit.configKey, replayed: backendReplayAudit.replayed, result: backendReplayAudit.result, outcome: backendReplayAudit.outcome }, { operation: 'publish', requestId: 'pub-1', configKey: first.configKey, replayed: true, result: 'replayed', outcome: 'replayed' }, 'backend publish replay must be audited');
expectCode(() => backend.publish({ requestId: 'pub-1', actorId: 'ops', bundle: signed({ configKey: 'other-config', bundleId: 'other-config-reuse', version: '1.0.0' }) }), BACKEND_CODES.REQUEST_ID_REUSED);
backendReplayAudit = backend.auditLog().findLast((entry) => entry.requestId === 'pub-1');
assert.deepEqual({ operation: backendReplayAudit.operation, requestId: backendReplayAudit.requestId, configKey: backendReplayAudit.configKey, replayed: backendReplayAudit.replayed, result: backendReplayAudit.result, outcome: backendReplayAudit.outcome }, { operation: 'publish', requestId: 'pub-1', configKey: 'other-config', replayed: true, result: 'rejected', outcome: 'rejected' }, 'backend cross-config replay conflict must be audited');
assert.match(backendReplayAudit.reason, /another request/);
expectCode(() => backend.fetch({ requestId: 'pub-1', configKey: first.configKey, clientId: 'player-1', clientVersion: '1.0.0', authToken: 'auth:tenant-a:player-1' }), BACKEND_CODES.REQUEST_ID_REUSED);
backendReplayAudit = backend.auditLog().findLast((entry) => entry.requestId === 'pub-1');
assert.deepEqual({ operation: backendReplayAudit.operation, requestId: backendReplayAudit.requestId, configKey: backendReplayAudit.configKey, replayed: backendReplayAudit.replayed, result: backendReplayAudit.result, outcome: backendReplayAudit.outcome }, { operation: 'fetch', requestId: 'pub-1', configKey: first.configKey, replayed: true, result: 'rejected', outcome: 'rejected' }, 'backend cross-operation replay conflict must be audited');
assert.match(backendReplayAudit.reason, /another config operation/);
assert.deepEqual(backend.publish({ requestId: 'pub-1', actorId: 'ops', bundle: first }), { ...published, replayed: true }, 'replay conflicts must not overwrite the original backend ledger');
expectCode(() => backend.publish({ requestId: 'pub-1', actorId: 'attacker', bundle: first }), BACKEND_CODES.REQUEST_ID_REUSED);
expectCode(() => backend.publish({ requestId: 'pub-bad-signature', actorId: 'ops', bundle: { ...first, signature: 'tampered' } }), BACKEND_CODES.SIGNATURE_INVALID);
expectCode(() => backend.publish({ requestId: 'pub-old', actorId: 'ops', bundle: signed({ version: '1.0.0', bundleId: 'bundle-old' }) }), BACKEND_CODES.VERSION_CONFLICT);
const historyBeforeMinRegression = backend.snapshot().history.length;
expectCode(() => backend.publish({ requestId: 'pub-min-regression', actorId: 'ops', bundle: signed({ version: '1.1.0', minClientVersion: '0.9.0', bundleId: 'bundle-min-regression' }) }), BACKEND_CODES.VERSION_CONFLICT);
assert.equal(backend.snapshot().history.length, historyBeforeMinRegression, 'version and minimum-client checks must be atomic');
expectCode(() => backend.fetch({ requestId: 'fetch-no-auth', configKey: first.configKey, clientId: 'player-1', clientVersion: '1.0.0', authToken: 'unknown' }), BACKEND_CODES.AUTHENTICATION_REQUIRED);
expectCode(() => backend.fetch({ requestId: 'fetch-missing-auth', configKey: first.configKey, clientId: 'player-1', clientVersion: '1.0.0' }), BACKEND_CODES.AUTHENTICATION_REQUIRED);
expectCode(() => backend.fetch({ requestId: 'fetch-spoofed-allowlist', configKey: first.configKey, clientId: 'player-1', clientVersion: '1.0.0', authToken: 'auth:tenant-a:player-2' }), BACKEND_CODES.AUTHENTICATION_REQUIRED);
const tenantB = signed({ tenantId: 'tenant-b', configKey: 'isolated', bundleId: 'tenant-b-isolated', allowList: ['player-2'] });
backend.publish({ requestId: 'pub-tenant-b', actorId: 'ops', bundle: tenantB });
assert.deepEqual(backend.fetch({ requestId: 'fetch-tenant-b', configKey: 'isolated', clientId: 'player-1', clientVersion: '1.0.0', authToken: 'auth:tenant-b:player-1' }), { available: false, replayed: false, bundle: null, reason: 'NOT_ELIGIBLE' });
for (const [requestId, overrides] of [
  ['bad-key', { configKey: '../secrets' }], ['bad-version', { version: '1.0' }], ['bad-rollout', { rolloutPercent: 101 }],
  ['bad-lists', { allowList: ['player-1'], denyList: ['player-1'] }], ['bad-expiry', { expiresAt: now }],
]) {
  expectCode(() => backend.publish({ requestId, actorId: 'ops', bundle: signed(overrides) }), requestId === 'bad-key' ? BACKEND_CODES.INVALID_REQUEST : BACKEND_CODES.INVALID_BUNDLE);
}
const backendCyclic = signed({ bundleId: 'backend-cyclic', version: '9.0.0' });
backendCyclic.payload.self = backendCyclic.payload;
expectCode(() => backend.publish({ requestId: 'backend-cyclic', actorId: 'ops', bundle: backendCyclic }), BACKEND_CODES.INVALID_BUNDLE);

const rolloutZero = signed({ bundleId: 'bundle-2', version: '1.1.0', rolloutPercent: 0 });
backend.publish({ requestId: 'pub-2', actorId: 'ops', bundle: rolloutZero });
assert.deepEqual(backend.fetch({ requestId: 'fetch-zero', configKey: rolloutZero.configKey, clientId: 'player-1', clientVersion: '1.0.0', authToken: 'auth:tenant-a:player-1' }), { available: false, replayed: false, bundle: null, reason: 'NOT_ELIGIBLE' });
const minVersion = signed({ bundleId: 'bundle-3', version: '1.2.0', minClientVersion: '2.0.0', rolloutPercent: 100 });
backend.publish({ requestId: 'pub-3', actorId: 'ops', bundle: minVersion });
assert.deepEqual(backend.fetch({ requestId: 'fetch-old-client', configKey: minVersion.configKey, clientId: 'player-1', clientVersion: '1.0.0', authToken: 'auth:tenant-a:player-1' }), { available: false, replayed: false, bundle: null, reason: 'CLIENT_OUTDATED' });
const release = signed({ bundleId: 'bundle-4', version: '1.3.0', minClientVersion: '2.0.0', rolloutPercent: 100, payload: { damageMultiplier: 1.3, source: 'signed' } });
backend.publish({ requestId: 'pub-4', actorId: 'ops', bundle: release });
const available = backend.fetch({ requestId: 'fetch-release', configKey: release.configKey, clientId: 'player-1', clientVersion: '2.0.0', authToken: 'auth:tenant-a:player-1:v2' });
assert.equal(available.available, true);
assert.equal(available.bundle.version, '1.3.0');
assert.deepEqual(backend.fetch({ requestId: 'fetch-release', configKey: release.configKey, clientId: 'player-1', clientVersion: '2.0.0', authToken: 'auth:tenant-a:player-1:v2' }), { ...available, replayed: true });
backendReplayAudit = backend.auditLog().findLast((entry) => entry.requestId === 'fetch-release');
assert.deepEqual({ operation: backendReplayAudit.operation, requestId: backendReplayAudit.requestId, configKey: backendReplayAudit.configKey, replayed: backendReplayAudit.replayed, result: backendReplayAudit.result, outcome: backendReplayAudit.outcome }, { operation: 'fetch', requestId: 'fetch-release', configKey: release.configKey, replayed: true, result: 'replayed', outcome: 'replayed' }, 'backend fetch replay must be audited');
fetchSessionState = { available: true, blocked: true };
expectCode(() => backend.fetch({ requestId: 'fetch-release', configKey: release.configKey, clientId: 'player-1', clientVersion: '2.0.0', authToken: 'auth:tenant-a:player-1:v2' }), BACKEND_CODES.REQUEST_ID_REUSED, 'quarantined session must not replay an available config');
const blockedFetch = backend.fetch({ requestId: 'fetch-blocked', configKey: release.configKey, clientId: 'player-1', clientVersion: '2.0.0', authToken: 'auth:tenant-a:player-1:v2' });
assert.deepEqual(blockedFetch, { available: false, replayed: false, bundle: null, reason: 'CLIENT_BLOCKED' });
assert.deepEqual(backend.fetch({ requestId: 'fetch-blocked', configKey: release.configKey, clientId: 'player-1', clientVersion: '2.0.0', authToken: 'auth:tenant-a:player-1:v2' }), { ...blockedFetch, replayed: true }, 'blocked fetch must replay the identical result');
expectCode(() => backend.fetch({ requestId: 'fetch-blocked', configKey: 'other-config', clientId: 'player-1', clientVersion: '2.0.0', authToken: 'auth:tenant-a:player-1:v2' }), BACKEND_CODES.REQUEST_ID_REUSED, 'blocked fetch requestId cannot be reused across config keys');
backendReplayAudit = backend.auditLog().findLast((entry) => entry.requestId === 'fetch-blocked');
assert.deepEqual({ operation: backendReplayAudit.operation, requestId: backendReplayAudit.requestId, configKey: backendReplayAudit.configKey, replayed: backendReplayAudit.replayed, result: backendReplayAudit.result, outcome: backendReplayAudit.outcome }, { operation: 'fetch', requestId: 'fetch-blocked', configKey: 'other-config', replayed: true, result: 'rejected', outcome: 'rejected' }, 'backend fetch cross-config replay conflict must be audited');
assert.match(backendReplayAudit.reason, /another request/);
expectCode(() => backend.fetch({ requestId: 'pub-4', configKey: release.configKey, clientId: 'player-1', clientVersion: '2.0.0', authToken: 'auth:tenant-a:player-1:v2' }), BACKEND_CODES.REQUEST_ID_REUSED, 'blocked fetch cannot overwrite a publish request ledger entry');
assert.deepEqual(backend.publish({ requestId: 'pub-4', actorId: 'ops', bundle: release }), { accepted: true, replayed: true, bundle: release });
fetchSessionState = { available: false, blocked: false };
const unavailableFetch = backend.fetch({ requestId: 'fetch-unavailable', configKey: release.configKey, clientId: 'player-1', clientVersion: '2.0.0', authToken: 'auth:tenant-a:player-1:v2' });
assert.deepEqual(unavailableFetch, { available: false, replayed: false, bundle: null, reason: 'SESSION_UNAVAILABLE' });
assert.deepEqual(backend.fetch({ requestId: 'fetch-unavailable', configKey: release.configKey, clientId: 'player-1', clientVersion: '2.0.0', authToken: 'auth:tenant-a:player-1:v2' }), { ...unavailableFetch, replayed: true }, 'unavailable fetch must replay the identical result');
fetchSessionState = undefined;
expectCode(() => backend.fetch({ requestId: 'fetch-missing-state', configKey: release.configKey, clientId: 'player-1', clientVersion: '2.0.0', authToken: 'auth:tenant-a:player-1:v2' }), BACKEND_CODES.AUTHENTICATION_REQUIRED);
fetchSessionState = { available: true, blocked: false };
assert.equal(backend.rollback({ requestId: 'rollback-1', actorId: 'ops', tenantId: 'tenant-a', configKey: release.configKey, targetVersion: '1.2.0' }).bundle.version, '1.2.0');
expectCode(() => backend.rollback({ requestId: 'rollback-none', actorId: 'ops', tenantId: 'tenant-a', configKey: release.configKey, targetVersion: '0.9.0' }), BACKEND_CODES.ROLLBACK_UNAVAILABLE);

const activations = [];
let failActivation = false;
const client = new ConfigUpdateClientService({
  tenantId: 'tenant-a', clientId: 'player-1', clientVersion: '2.0.0', now: () => now,
  verifySignature: clientVerifier,
  validatePayload: (configKey, payload) => { assert.equal(configKey, 'combat.balance'); assert.equal(typeof payload.damageMultiplier, 'number'); },
  activate: (configKey, payload, context) => { activations.push({ configKey, payload, context }); if (failActivation && !context.rollback) throw new Error('simulated runtime failure'); },
});
const clientBase = signed({ bundleId: 'client-base', version: '1.2.0', payload: { damageMultiplier: 1.2, source: 'base' } });
assert.equal(client.apply('apply-base', clientBase).version, '1.2.0');
const clientApplied = client.apply('apply-1', release);
assert.deepEqual(clientApplied, { applied: true, replayed: false, rolledBack: false, configKey: release.configKey, version: release.version });
assert.deepEqual(client.apply('apply-1', release), { ...clientApplied, replayed: true });
const applyReplayAudit = client.auditLog().findLast((entry) => entry.requestId === 'apply-1');
assert.deepEqual({ operation: applyReplayAudit.operation, replayed: applyReplayAudit.replayed, result: applyReplayAudit.result }, { operation: 'apply', replayed: true, result: 'replayed' }, 'client replay must be recorded with operation, requestId and result');
expectCode(() => client.apply('apply-1', signed({ configKey: 'other-config', bundleId: 'client-other-config-reuse', version: '1.0.0', minClientVersion: '1.0.0' })), CLIENT_CODES.REQUEST_ID_REUSED);
const applyCrossConfigReplayAudit = client.auditLog().findLast((entry) => entry.requestId === 'apply-1');
assert.deepEqual({ operation: applyCrossConfigReplayAudit.operation, configKey: applyCrossConfigReplayAudit.configKey, replayed: applyCrossConfigReplayAudit.replayed, result: applyCrossConfigReplayAudit.result }, { operation: 'apply', configKey: 'other-config', replayed: true, result: 'rejected' }, 'client cross-config replay conflict must be audited');
assert.match(applyCrossConfigReplayAudit.reason, /another request/);
expectCode(() => client.apply('apply-1', signed({ bundleId: 'other', version: '1.4.0' })), CLIENT_CODES.REQUEST_ID_REUSED);
expectCode(() => client.apply('client-tamper', { ...release, payload: { damageMultiplier: 999 } }), CLIENT_CODES.SIGNATURE_INVALID);
expectCode(() => client.apply('client-outdated', signed({ bundleId: 'old-client', version: '1.4.0', minClientVersion: '3.0.0' })), CLIENT_CODES.CLIENT_OUTDATED);
expectCode(() => client.apply('client-not-gray', signed({ bundleId: 'gray-off', version: '1.4.0', rolloutPercent: 0 })), CLIENT_CODES.NOT_ELIGIBLE);
const cyclic = signed({ bundleId: 'cyclic', version: '1.4.0' });
cyclic.payload.self = cyclic.payload;
expectCode(() => client.apply('client-cyclic', cyclic), CLIENT_CODES.INVALID_BUNDLE);
const deepPayload = {};
let deepCursor = deepPayload;
for (let depth = 0; depth < 130; depth += 1) { deepCursor.next = {}; deepCursor = deepCursor.next; }
const deepBundle = signed({ bundleId: 'deep', version: '1.4.1' });
deepBundle.payload = deepPayload;
expectCode(() => client.apply('client-deep', deepBundle), CLIENT_CODES.INVALID_BUNDLE);
failActivation = true;
const failed = signed({ bundleId: 'bundle-5', version: '1.4.0', minClientVersion: '2.0.0', payload: { damageMultiplier: 1.4, source: 'new' } });
expectCode(() => client.apply('apply-failed', failed), CLIENT_CODES.RUNTIME_INCONSISTENT);
assert.equal(client.isBlocked(release.configKey), true, 'activation failure must quarantine even when the previous runtime is restored');
expectCode(() => client.active(release.configKey), CLIENT_CODES.RUNTIME_INCONSISTENT);
const activationCountAfterFailure = activations.length;
expectCode(() => client.apply('apply-failed', failed), CLIENT_CODES.RUNTIME_INCONSISTENT);
const failedApplyReplayAudit = client.auditLog().findLast((entry) => entry.requestId === 'apply-failed');
assert.deepEqual({ operation: failedApplyReplayAudit.operation, replayed: failedApplyReplayAudit.replayed, result: failedApplyReplayAudit.result }, { operation: 'apply', replayed: true, result: 'rejected' }, 'a failed apply replay must be audited before the quarantine guard');
assert.deepEqual(client.apply('apply-1', release), { ...clientApplied, replayed: true }, 'a valid apply replay must remain idempotent while quarantined');
assert.equal(activations.length, activationCountAfterFailure);
expectCode(() => client.apply('apply-after-quarantine', signed({ bundleId: 'blocked-follow-up', version: '1.4.1', minClientVersion: '2.0.0' })), CLIENT_CODES.RUNTIME_INCONSISTENT);
assert.equal(activations.at(-1).context.rollback, true);
expectCode(() => client.recover('client-recover-old-version', clientBase), CLIENT_CODES.VERSION_CONFLICT);
expectCode(() => client.recover('client-recover-old-min', signed({ bundleId: 'recover-old-min', version: '1.4.0', minClientVersion: '1.0.0' })), CLIENT_CODES.VERSION_CONFLICT);
expectCode(() => client.recover('apply-1', release), CLIENT_CODES.REQUEST_ID_REUSED);
const recoverApplyCrossReplayAudit = client.auditLog().findLast((entry) => entry.requestId === 'apply-1');
assert.deepEqual({ operation: recoverApplyCrossReplayAudit.operation, replayed: recoverApplyCrossReplayAudit.replayed, result: recoverApplyCrossReplayAudit.result }, { operation: 'recover', replayed: true, result: 'rejected' }, 'quarantined recover cross-replay must be audited before the quarantine guard');
failActivation = false;
assert.deepEqual(client.recover('client-recover', release), { recovered: true, replayed: false, configKey: release.configKey, version: release.version });
assert.deepEqual(client.recover('client-recover', release), { recovered: true, replayed: true, configKey: release.configKey, version: release.version });
const recoverReplayAudit = client.auditLog().findLast((entry) => entry.requestId === 'client-recover');
assert.deepEqual({ operation: recoverReplayAudit.operation, replayed: recoverReplayAudit.replayed, result: recoverReplayAudit.result }, { operation: 'recover', replayed: true, result: 'replayed' }, 'recover replay must remain auditable after quarantine clears');
expectCode(() => client.recover('client-recover', signed({ configKey: 'other-config', bundleId: 'recover-other-config-reuse', version: '1.0.0', minClientVersion: '1.0.0' })), CLIENT_CODES.REQUEST_ID_REUSED);
const recoverCrossConfigReplayAudit = client.auditLog().findLast((entry) => entry.requestId === 'client-recover');
assert.deepEqual({ operation: recoverCrossConfigReplayAudit.operation, configKey: recoverCrossConfigReplayAudit.configKey, replayed: recoverCrossConfigReplayAudit.replayed, result: recoverCrossConfigReplayAudit.result }, { operation: 'recover', configKey: 'other-config', replayed: true, result: 'rejected' }, 'client recover cross-config replay conflict must be audited');
assert.match(recoverCrossConfigReplayAudit.reason, /another request/);
assert.equal(client.isBlocked(release.configKey), false);
assert.equal(client.active(release.configKey).version, release.version);
assert.equal(client.apply('post-recovery-apply', signed({ bundleId: 'post-recovery', version: '1.5.0', minClientVersion: '2.0.0' })).version, '1.5.0');
assert.equal(client.rollback('client-rollback', release.configKey).rolledBack, true);
assert.equal(client.active(release.configKey).version, release.version);
expectCode(() => client.apply('client-min-regression-after-rollback', signed({ bundleId: 'min-regression-after-rollback', version: '1.4.0', minClientVersion: '1.0.0' })), CLIENT_CODES.VERSION_CONFLICT);

const historicalFloorClient = new ConfigUpdateClientService({ tenantId: 'tenant-a', clientId: 'player-1', clientVersion: '2.0.0', verifySignature: clientVerifier });
historicalFloorClient.apply('historical-floor-apply', signed({ bundleId: 'historical-floor', version: '4.0.0', minClientVersion: '2.0.0' }));
historicalFloorClient.blocked.set('combat.balance', 'test quarantine');
historicalFloorClient.states.set('combat.balance', { active: null, previous: null, revision: historicalFloorClient.revisionByConfig.get('combat.balance') });
expectCode(() => historicalFloorClient.recover('historical-floor-recover', signed({ bundleId: 'historical-floor-low', version: '3.0.0', minClientVersion: '2.0.0' })), CLIENT_CODES.VERSION_CONFLICT);

let firstActivationMode = 'fail';
const firstActivationClient = new ConfigUpdateClientService({
  tenantId: 'tenant-a', clientId: 'player-1', clientVersion: '2.0.0', verifySignature: clientVerifier,
  activate: (_configKey, _payload, context) => {
    if (firstActivationMode === 'fail') throw new Error(context.recovery ? 'trusted recovery failed' : 'first activation failed');
  },
});
const firstActivationBundle = signed({ bundleId: 'first-activation', version: '3.0.0', minClientVersion: '2.0.0' });
expectCode(() => firstActivationClient.apply('first-activation-apply', firstActivationBundle), CLIENT_CODES.RUNTIME_INCONSISTENT);
assert.equal(firstActivationClient.isBlocked(firstActivationBundle.configKey), true);
expectCode(() => firstActivationClient.active(firstActivationBundle.configKey), CLIENT_CODES.RUNTIME_INCONSISTENT);
expectCode(() => firstActivationClient.apply('first-activation-follow-up', signed({ bundleId: 'first-activation-follow-up', version: '3.1.0', minClientVersion: '2.0.0' })), CLIENT_CODES.RUNTIME_INCONSISTENT);
expectCode(() => firstActivationClient.recover('first-activation-apply', firstActivationBundle), CLIENT_CODES.REQUEST_ID_REUSED);
const applyRecoverCrossReplayAudit = firstActivationClient.auditLog().findLast((entry) => entry.requestId === 'first-activation-apply');
assert.deepEqual({ operation: applyRecoverCrossReplayAudit.operation, replayed: applyRecoverCrossReplayAudit.replayed, result: applyRecoverCrossReplayAudit.result }, { operation: 'recover', replayed: true, result: 'rejected' }, 'quarantined apply cross-replay must be audited before the quarantine guard');
expectCode(() => firstActivationClient.recover('first-activation-recovery-failed', signed({ bundleId: 'trusted-recovery', version: '2.0.0', minClientVersion: '2.0.0' })), CLIENT_CODES.RUNTIME_INCONSISTENT);
expectCode(() => firstActivationClient.apply('first-activation-recovery-failed', signed({ bundleId: 'trusted-recovery-reuse', version: '3.1.0', minClientVersion: '2.0.0' })), CLIENT_CODES.REQUEST_ID_REUSED);
const failedRecoverApplyCrossReplayAudit = firstActivationClient.auditLog().findLast((entry) => entry.requestId === 'first-activation-recovery-failed');
assert.deepEqual({ operation: failedRecoverApplyCrossReplayAudit.operation, replayed: failedRecoverApplyCrossReplayAudit.replayed, result: failedRecoverApplyCrossReplayAudit.result }, { operation: 'apply', replayed: true, result: 'rejected' }, 'a failed recover requestId reused by apply must remain a replay conflict while quarantined');
assert.equal(firstActivationClient.isBlocked(firstActivationBundle.configKey), true);
firstActivationMode = 'ok';
const successfulRecovery = signed({ bundleId: 'trusted-recovery', version: '2.0.0', minClientVersion: '2.0.0' });
assert.deepEqual(firstActivationClient.recover('first-activation-recovery', successfulRecovery), { recovered: true, replayed: false, configKey: firstActivationBundle.configKey, version: '2.0.0' });
assert.equal(firstActivationClient.isBlocked(firstActivationBundle.configKey), false);
assert.equal(firstActivationClient.active(firstActivationBundle.configKey).version, '2.0.0');
firstActivationClient.blocked.set(firstActivationBundle.configKey, 'test quarantine for successful recovery replay');
expectCode(() => firstActivationClient.apply('first-activation-recovery', successfulRecovery), CLIENT_CODES.REQUEST_ID_REUSED);
const successfulRecoverApplyCrossReplayAudit = firstActivationClient.auditLog().findLast((entry) => entry.requestId === 'first-activation-recovery');
assert.deepEqual({ operation: successfulRecoverApplyCrossReplayAudit.operation, replayed: successfulRecoverApplyCrossReplayAudit.replayed, result: successfulRecoverApplyCrossReplayAudit.result }, { operation: 'apply', replayed: true, result: 'rejected' }, 'a successful recover requestId reused by apply must remain a replay conflict while quarantined');
const firstActivationAudit = firstActivationClient.auditLog();
assert.ok(firstActivationAudit.some((entry) => entry.event === 'apply' && entry.outcome === 'rejected' && entry.reason.includes('no confirmed active config')));
assert.ok(firstActivationAudit.some((entry) => entry.event === 'recover' && entry.outcome === 'rejected' && entry.reason.includes('trusted recovery failed')));
assert.ok(firstActivationAudit.some((entry) => entry.event === 'apply' && entry.requestId === 'first-activation-follow-up' && entry.reason.includes('quarantined')));

let nestedCode;
let reentrantClient;
reentrantClient = new ConfigUpdateClientService({
  tenantId: 'tenant-a', clientId: 'player-1', clientVersion: '2.0.0', verifySignature: clientVerifier,
  activate: (configKey, payload, context) => {
    if (!context.rollback && nestedCode === undefined) {
      try { reentrantClient.apply('nested-apply', signed({ bundleId: 'nested', version: '1.6.0', minClientVersion: '2.0.0' })); } catch (error) { nestedCode = error.code; }
    }
  },
});
reentrantClient.apply('outer-apply', signed({ bundleId: 'outer', version: '1.5.0', minClientVersion: '2.0.0' }));
assert.equal(nestedCode, CLIENT_CODES.REENTRANT, 'nested apply must be rejected while the outer activation owns the lock');
assert.equal(reentrantClient.active('combat.balance').version, '1.5.0', 'nested apply must not let an outer commit overwrite a newer state');
expectCode(() => new ConfigUpdateClientService({ tenantId: 'tenant-a', clientId: 'player-1', clientVersion: '1.0.0', verifySignature: verifySignature }), CLIENT_CODES.INVALID_REQUEST);
expectCode(() => new ConfigUpdateClientService({ tenantId: 'tenant-a', clientId: 'player-1', clientVersion: '1.0.0', verifySignature: { algorithm: 'RSA', trustedKeyIds: ['release-ed25519-dynamic-1'], verifyEd25519: verifySignature } }), CLIENT_CODES.INVALID_REQUEST);

let runtimeMode = 'ok';
const inconsistentClient = new ConfigUpdateClientService({
  tenantId: 'tenant-a', clientId: 'player-1', clientVersion: '2.0.0', verifySignature: clientVerifier,
  activate: (configKey, payload, context) => {
    if (runtimeMode === 'fail-both') throw new Error(context.rollback ? 'runtime recovery failed' : 'candidate activation failed');
  },
});
inconsistentClient.apply('inconsistent-base', signed({ bundleId: 'inconsistent-base', version: '1.0.0', minClientVersion: '1.0.0' }));
runtimeMode = 'fail-both';
expectCode(() => inconsistentClient.apply('inconsistent-update', signed({ bundleId: 'inconsistent-update', version: '1.1.0', minClientVersion: '1.0.0' })), CLIENT_CODES.RUNTIME_INCONSISTENT);
assert.equal(inconsistentClient.isBlocked('combat.balance'), true);
expectCode(() => inconsistentClient.active('combat.balance'), CLIENT_CODES.RUNTIME_INCONSISTENT);
assert.ok(inconsistentClient.auditLog().some((entry) => entry.reason?.includes('recovery failed')));

const backendAudit = backend.auditLog();
const clientAudit = client.auditLog();
assert.ok(backendAudit.length >= 8);
assert.ok(clientAudit.length >= 6);
assert.equal(Object.isFrozen(backendAudit), true);
assert.equal(Object.isFrozen(backendAudit.at(-1)), true);
assert.deepEqual(backendAudit, backend.auditLog());
assert.equal(JSON.stringify(backendAudit).includes('damageMultiplier'), false);
assert.equal(JSON.stringify(backendAudit).includes(first.signature), false);
assert.equal(rolloutBucketForRegression(), clientRolloutBucket('combat.balance', 'player-1', 'salt-1'));
function rolloutBucketForRegression() { return 4; }
assert.equal(new BackendError(BACKEND_CODES.INVALID_REQUEST).name, 'ConfigUpdateError');
assert.equal(new ClientError(CLIENT_CODES.INVALID_REQUEST).name, 'ConfigUpdateError');
expectCode(() => new ConfigUpdateClientService({ tenantId: 'tenant-a', clientId: 'player-1\nlog-injection', clientVersion: '1.0.0', verifySignature: clientVerifier }), CLIENT_CODES.INVALID_REQUEST);
const limited = new BackendConfigUpdateService({ now: () => now, publicKeys: { 'release-ed25519-dynamic-1': publicKey }, maxAuditEvents: 1 });
limited.publish({ requestId: 'limited-1', actorId: 'ops', bundle: signed({ configKey: 'limited', bundleId: 'limited-1', version: '1.0.0' }) });
expectCode(() => limited.publish({ requestId: 'limited-2', actorId: 'ops', bundle: signed({ configKey: 'limited', bundleId: 'limited-2', version: '1.1.0' }) }), BACKEND_CODES.AUDIT_LIMIT);
assert.equal(limited.snapshot().history.flat().length, 1, 'audit exhaustion must not partially publish a bundle');
console.log('PASS config hot update: signature/version/gray/min-version/rollback/idempotency/audit/boundaries');
