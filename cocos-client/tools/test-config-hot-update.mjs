import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
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
let now = 1_700_000_000_000;

function unsigned(overrides = {}) {
  return {
    bundleId: 'bundle-1', configKey: 'combat.balance', version: '1.0.0', minClientVersion: '1.0.0',
    rolloutPercent: 100, rolloutSalt: 'salt-1', payload: { damageMultiplier: 1.1, source: 'signed' },
    keyId: 'release-ed25519-1', createdAt: now, ...overrides,
  };
}
function signed(overrides = {}) { const candidate = unsigned(overrides); return { ...candidate, signature: createConfigSignature(candidate, privateKey) }; }
function expectCode(fn, code) { assert.throws(fn, (error) => error?.code === code, `expected ${code}`); }
function verifySignature(canonical, signature) { return verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, 'base64url')); }

const backend = new BackendConfigUpdateService({ now: () => now, verifySignature });
const canonicalA = backendStableJson({ z: 1, a: { y: 2, x: 3 } });
const canonicalB = clientStableJson({ a: { x: 3, y: 2 }, z: 1 });
assert.equal(canonicalA, canonicalB);
const first = signed();
assert.equal(verifyConfigSignature(first, publicKey), true);
const { signature: _ignoredSignature, ...firstUnsigned } = first;
assert.equal(clientSigningBytes(first), backendStableJson(firstUnsigned));

const published = backend.publish({ requestId: 'pub-1', actorId: 'ops', bundle: first });
assert.deepEqual(published, { accepted: true, replayed: false, bundle: first });
assert.deepEqual(backend.publish({ requestId: 'pub-1', actorId: 'ops', bundle: first }), { ...published, replayed: true });
expectCode(() => backend.publish({ requestId: 'pub-1', actorId: 'attacker', bundle: first }), BACKEND_CODES.REQUEST_ID_REUSED);
expectCode(() => backend.publish({ requestId: 'pub-bad-signature', actorId: 'ops', bundle: { ...first, signature: 'tampered' } }), BACKEND_CODES.SIGNATURE_INVALID);
expectCode(() => backend.publish({ requestId: 'pub-old', actorId: 'ops', bundle: signed({ version: '1.0.0', bundleId: 'bundle-old' }) }), BACKEND_CODES.VERSION_CONFLICT);
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
assert.deepEqual(backend.fetch({ requestId: 'fetch-zero', configKey: rolloutZero.configKey, clientId: 'player-1', clientVersion: '1.0.0' }), { available: false, replayed: false, bundle: null, reason: 'NOT_ELIGIBLE' });
const minVersion = signed({ bundleId: 'bundle-3', version: '1.2.0', minClientVersion: '2.0.0', rolloutPercent: 100 });
backend.publish({ requestId: 'pub-3', actorId: 'ops', bundle: minVersion });
assert.deepEqual(backend.fetch({ requestId: 'fetch-old-client', configKey: minVersion.configKey, clientId: 'player-1', clientVersion: '1.9.9' }), { available: false, replayed: false, bundle: null, reason: 'CLIENT_OUTDATED' });
const release = signed({ bundleId: 'bundle-4', version: '1.3.0', minClientVersion: '1.0.0', rolloutPercent: 100, payload: { damageMultiplier: 1.3, source: 'signed' } });
backend.publish({ requestId: 'pub-4', actorId: 'ops', bundle: release });
const available = backend.fetch({ requestId: 'fetch-release', configKey: release.configKey, clientId: 'player-1', clientVersion: '1.0.0' });
assert.equal(available.available, true);
assert.equal(available.bundle.version, '1.3.0');
assert.deepEqual(backend.fetch({ requestId: 'fetch-release', configKey: release.configKey, clientId: 'player-1', clientVersion: '1.0.0' }), { ...available, replayed: true });
assert.equal(backend.rollback({ requestId: 'rollback-1', actorId: 'ops', configKey: release.configKey, targetVersion: '1.2.0' }).bundle.version, '1.2.0');
expectCode(() => backend.rollback({ requestId: 'rollback-none', actorId: 'ops', configKey: release.configKey, targetVersion: '0.9.0' }), BACKEND_CODES.ROLLBACK_UNAVAILABLE);

const activations = [];
let failActivation = false;
const client = new ConfigUpdateClientService({
  clientId: 'player-1', clientVersion: '1.0.0', now: () => now,
  verifySignature: (canonical, signature, keyId) => keyId === 'release-ed25519-1' && verifySignature(canonical, signature),
  validatePayload: (configKey, payload) => { assert.equal(configKey, 'combat.balance'); assert.equal(typeof payload.damageMultiplier, 'number'); },
  activate: (configKey, payload, context) => { activations.push({ configKey, payload, context }); if (failActivation && !context.rollback) throw new Error('simulated runtime failure'); },
});
const clientBase = signed({ bundleId: 'client-base', version: '1.2.0', payload: { damageMultiplier: 1.2, source: 'base' } });
assert.equal(client.apply('apply-base', clientBase).version, '1.2.0');
const clientApplied = client.apply('apply-1', release);
assert.deepEqual(clientApplied, { applied: true, replayed: false, rolledBack: false, configKey: release.configKey, version: release.version });
assert.deepEqual(client.apply('apply-1', release), { ...clientApplied, replayed: true });
expectCode(() => client.apply('apply-1', signed({ bundleId: 'other', version: '1.4.0' })), CLIENT_CODES.REQUEST_ID_REUSED);
expectCode(() => client.apply('client-tamper', { ...release, payload: { damageMultiplier: 999 } }), CLIENT_CODES.SIGNATURE_INVALID);
expectCode(() => client.apply('client-outdated', signed({ bundleId: 'old-client', version: '1.4.0', minClientVersion: '2.0.0' })), CLIENT_CODES.CLIENT_OUTDATED);
expectCode(() => client.apply('client-not-gray', signed({ bundleId: 'gray-off', version: '1.4.0', rolloutPercent: 0 })), CLIENT_CODES.NOT_ELIGIBLE);
const cyclic = signed({ bundleId: 'cyclic', version: '1.4.0' });
cyclic.payload.self = cyclic.payload;
expectCode(() => client.apply('client-cyclic', cyclic), CLIENT_CODES.INVALID_BUNDLE);
failActivation = true;
const failed = signed({ bundleId: 'bundle-5', version: '1.4.0', payload: { damageMultiplier: 1.4, source: 'new' } });
expectCode(() => client.apply('apply-failed', failed), CLIENT_CODES.ACTIVATION_FAILED);
const activationCountAfterFailure = activations.length;
expectCode(() => client.apply('apply-failed', failed), CLIENT_CODES.ACTIVATION_FAILED);
assert.equal(activations.length, activationCountAfterFailure);
assert.equal(client.active(release.configKey).version, release.version);
assert.equal(activations.at(-1).context.rollback, true);
failActivation = false;
assert.equal(client.rollback('client-rollback', release.configKey).rolledBack, true);
assert.equal(client.active(release.configKey).version, clientBase.version);

const backendAudit = backend.auditLog();
const clientAudit = client.auditLog();
assert.ok(backendAudit.length >= 8);
assert.ok(clientAudit.length >= 6);
assert.deepEqual(backendAudit, backend.auditLog());
assert.equal(JSON.stringify(backendAudit).includes('damageMultiplier'), false);
assert.equal(JSON.stringify(backendAudit).includes(first.signature), false);
assert.equal(rolloutBucketForRegression(), clientRolloutBucket('combat.balance', 'player-1', 'salt-1'));
function rolloutBucketForRegression() { return 4; }
assert.equal(new BackendError(BACKEND_CODES.INVALID_REQUEST).name, 'ConfigUpdateError');
assert.equal(new ClientError(CLIENT_CODES.INVALID_REQUEST).name, 'ConfigUpdateError');
console.log('PASS config hot update: signature/version/gray/min-version/rollback/idempotency/audit/boundaries');
