import assert from 'node:assert/strict';
import { AccountService as BackendAccountService, AccountError } from '../../backend/account/AccountService.ts';
import { AccountClientError, AccountClientService } from '../assets/scripts/services/account/AccountClientService.ts';
import { createDefaultSave } from '../assets/scripts/services/SaveSchema.ts';

const times = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 1015];
const ADMIN_DIAGNOSTIC_TOKEN = 't259-admin-diagnostic-token';
let timeIndex = 0;
const server = new BackendAccountService({
  now: () => times[Math.min(timeIndex++, times.length - 1)],
  accountId: (() => { let sequence = 0; return (kind) => `${kind}-deterministic-${++sequence}`; })(),
  sessionToken: (() => { let sequence = 0; return () => `token-${++sequence}`; })(),
  identityVerifier: (provider, subject, proof) => proof === `proof:${provider}:${subject}`,
  adminDiagnosticToken: ADMIN_DIAGNOSTIC_TOKEN,
});

function expectCode(label, action, code) {
  assert.throws(action, (error) => error instanceof AccountError && error.code === code, label);
}

const failClosedServer = new BackendAccountService({ accountId: () => 'fail-closed-guest', sessionToken: () => 'fail-closed-token' });
const failClosedGuest = failClosedServer.createGuest({ deviceId: 'fail-closed-device' });
expectCode('missing identity verifier fails closed', () => failClosedServer.bind({
  sessionToken: failClosedGuest.session.token,
  provider: 'apple',
  subject: 'user-1',
  proof: 'proof:apple:user-1',
}), 'AUTH_PROOF_INVALID');
expectCode('snapshot without configured admin token fails closed', () => failClosedServer.snapshot(), 'UNAUTHENTICATED');

const deviceA = new AccountClientService(server, { deviceId: 'device-a', now: () => 2000 });
const guest = deviceA.guest();
assert.equal(guest.account.kind, 'guest');
assert.equal(guest.account.bindings.length, 0);
const accountId = guest.account.accountId;
const save = deviceA.newSave();
assert.equal(save.playerId, accountId);

expectCode('invalid provider is rejected', () => deviceA.bind(' Apple ', 'should-fail', 'proof:apple:should-fail'), 'INVALID_REQUEST');
expectCode('unverified identity cannot bind', () => deviceA.bind('Apple', 'user-1', 'forged-proof'), 'AUTH_PROOF_INVALID');
const bound = deviceA.bind('Apple', 'user-1', 'proof:apple:user-1');
assert.equal(bound.account.kind, 'bound');
assert.equal(bound.account.bindings.length, 1);
assert.deepEqual(deviceA.bind('Apple', 'user-1', 'proof:apple:user-1').account.bindings, bound.account.bindings, 'repeated bind is idempotent');

const deviceB = new AccountClientService(server, { deviceId: 'device-b', now: () => 2001 });
expectCode('unverified identity cannot log in', () => deviceB.login('apple', 'user-1', 'forged-proof'), 'AUTH_PROOF_INVALID');
const loggedIn = deviceB.login('apple', 'user-1', 'proof:apple:user-1');
assert.equal(loggedIn.account.accountId, accountId, 'binding login must return the same account');
assert.notEqual(loggedIn.session.token, guest.session.token, 'each device must receive its own session');

const firstWrite = deviceA.saveCloudSave(save, 'save-1', 0);
assert.equal(firstWrite.accepted, true);
assert.equal(firstWrite.record.version, 1);
assert.equal(deviceB.loadCloudSave().version, 1, 'a second device reads the cloud version');

const saveV2 = structuredClone(save);
saveV2.progress.clearedNodes.push('N001');
saveV2.updatedAt = 2001;
const secondWrite = deviceA.saveCloudSave(saveV2, 'save-2');
assert.equal(secondWrite.record.version, 2);
assert.equal(secondWrite.record.stateRevision, 2);
expectCode('snapshot without admin token fails closed', () => server.snapshot(), 'UNAUTHENTICATED');
expectCode('ordinary session cannot read diagnostic snapshot', () => server.snapshot(deviceA.session().token), 'UNAUTHENTICATED');
assert.equal(server.snapshot(ADMIN_DIAGNOSTIC_TOKEN).cloudSaves.length, 1, 'authorized diagnostic snapshot may read cloud state');
const beforeStale = JSON.stringify(server.snapshot(ADMIN_DIAGNOSTIC_TOKEN));
const stale = deviceB.saveCloudSave(save, 'save-stale', 1);
assert.deepEqual(stale, { accepted: false, replayed: false, code: 'VERSION_CONFLICT', current: secondWrite.record }, 'stale devices must receive a conflict');
const staleReplay = deviceB.saveCloudSave(save, 'save-stale', 1);
assert.deepEqual(staleReplay, { accepted: false, replayed: true, code: 'VERSION_CONFLICT', current: secondWrite.record }, 'a version conflict must be replayed from the request ledger');
expectCode('conflict requestId cannot become a success', () => deviceB.saveCloudSave(saveV2, 'save-stale', 2), 'REQUEST_ID_REUSED');
assert.equal(JSON.stringify(server.snapshot(ADMIN_DIAGNOSTIC_TOKEN)), beforeStale, 'a version conflict must not mutate the server');

const replay = deviceA.saveCloudSave(saveV2, 'save-2', 1);
assert.equal(replay.accepted, true);
assert.equal(replay.replayed, true, 'same request and payload must replay the original receipt');
assert.deepEqual(replay.record, secondWrite.record, 'replay must return the original version');
expectCode('reused requestId with changed payload is rejected', () => deviceA.saveCloudSave(save, 'save-2', 1), 'REQUEST_ID_REUSED');

const semanticStale = structuredClone(save);
semanticStale.resources.gold = 1;
const semanticStaleResult = deviceA.saveCloudSave(semanticStale, 'semantic-stale', 2);
assert.deepEqual(semanticStaleResult, { accepted: false, replayed: false, code: 'SAVE_STALE', current: secondWrite.record }, 'old semantic state must be rejected even with the current expected version');
const semanticStaleReplay = deviceA.saveCloudSave(semanticStale, 'semantic-stale', 2);
assert.deepEqual(semanticStaleReplay, { accepted: false, replayed: true, code: 'SAVE_STALE', current: secondWrite.record }, 'semantic stale rejection must be idempotent');
expectCode('semantic stale requestId cannot become a success', () => deviceA.saveCloudSave(saveV2, 'semantic-stale', 2), 'REQUEST_ID_REUSED');

const malformed = structuredClone(saveV2);
malformed.schemaVersion = 99;
expectCode('unsupported cloud save schema is rejected', () => server.putCloudSave({
  sessionToken: deviceA.session().token,
  requestId: 'malformed',
  expectedVersion: 2,
  save: malformed,
}), 'SAVE_INVALID');
expectCode('same invalid requestId replays the same rejection', () => server.putCloudSave({
  sessionToken: deviceA.session().token,
  requestId: 'malformed',
  expectedVersion: 2,
  save: malformed,
}), 'SAVE_INVALID');
expectCode('invalid requestId cannot become a success', () => server.putCloudSave({
  sessionToken: deviceA.session().token,
  requestId: 'malformed',
  expectedVersion: 2,
  save: saveV2,
}), 'REQUEST_ID_REUSED');
const malformedResource = structuredClone(saveV2);
malformedResource.resources.gold = -1;
expectCode('invalid nested save state is rejected', () => server.putCloudSave({
  sessionToken: deviceA.session().token,
  requestId: 'malformed-resource',
  expectedVersion: 2,
  save: malformedResource,
}), 'SAVE_INVALID');
expectCode('invalid expectedVersion is recorded', () => server.putCloudSave({
  sessionToken: deviceA.session().token,
  requestId: 'invalid-version',
  expectedVersion: -1,
  save: saveV2,
}), 'INVALID_REQUEST');
expectCode('same invalid expectedVersion replays the same rejection', () => server.putCloudSave({
  sessionToken: deviceA.session().token,
  requestId: 'invalid-version',
  expectedVersion: -1,
  save: saveV2,
}), 'INVALID_REQUEST');
expectCode('invalid expectedVersion requestId cannot become a success', () => server.putCloudSave({
  sessionToken: deviceA.session().token,
  requestId: 'invalid-version',
  expectedVersion: 2,
  save: saveV2,
}), 'REQUEST_ID_REUSED');
assert.equal(server.loadCloudSave(deviceA.session().token).record.version, 2, 'invalid saves must leave the prior record intact');

const canonicalReplay = structuredClone(saveV2);
canonicalReplay.resources = { essence: 0, gold: 0 };
const canonicalSave = structuredClone(saveV2);
canonicalSave.resources = { gold: 0, essence: 0 };
const canonicalWrite = deviceA.saveCloudSave(canonicalSave, 'canonical', 2);
assert.equal(canonicalWrite.replayed, true, 'equivalent payload must not create a new semantic revision');
assert.equal(canonicalWrite.record.version, 2);
const canonicalDuplicate = deviceA.saveCloudSave(canonicalReplay, 'canonical', 2);
assert.equal(canonicalDuplicate.replayed, true, 'object key order must not change an idempotency fingerprint');
assert.deepEqual(canonicalDuplicate.record, canonicalWrite.record);

const wrongPlayer = createDefaultSave('another-account', 2021);
assert.throws(() => deviceA.saveCloudSave(wrongPlayer, 'wrong-player'), (error) => error instanceof AccountClientError);
expectCode('unknown session fails closed', () => server.loadCloudSave('forged-session'), 'UNAUTHENTICATED');

assert.deepEqual(deviceB.logout(), { loggedOut: true });
assert.throws(() => deviceB.loadCloudSave(), (error) => error instanceof AccountClientError, 'logged out device cannot read cloud save');
assert.throws(() => deviceB.logout(), (error) => error instanceof AccountClientError, 'second logout is local authentication failure');

const deviceC = new AccountClientService(server, { deviceId: 'device-c', now: () => 2002 });
deviceC.guest();
expectCode('same external identity cannot bind two accounts', () => deviceC.bind('apple', 'user-1', 'proof:apple:user-1'), 'BINDING_CONFLICT');

const deletion = deviceA.deleteAccount('delete-1');
assert.deepEqual(deletion, { deleted: true, accountId, requestId: 'delete-1' });
const deletedSnapshot = server.snapshot(ADMIN_DIAGNOSTIC_TOKEN);
assert.equal(deletedSnapshot.cloudSaves.length, 0, 'deletion must purge the cloud save');
assert.deepEqual(deletedSnapshot.accounts.find((account) => account.accountId === accountId).bindings, [], 'deletion must clear provider/subject bindings from the tombstone');
assert.equal(JSON.stringify(deletedSnapshot).includes('user-1'), false, 'deleted subject must not be exposed by diagnostic snapshot');
expectCode('deleted session is revoked', () => server.loadCloudSave(guest.session.token), 'UNAUTHENTICATED');
expectCode('deleted account cannot log in', () => server.login({ provider: 'apple', subject: 'user-1', proof: 'proof:apple:user-1', deviceId: 'device-d', now: 2030 }), 'NO_BINDING');

const ledgerProbe = new BackendAccountService({ accountId: () => 'ledger-probe', sessionToken: () => 'ledger-probe-token', now: () => 10 });
const ledgerProbeGuest = ledgerProbe.createGuest({ deviceId: 'ledger-probe-device' });
const ledgerProbeSave = createDefaultSave('ledger-probe', 1);
const ledgerProbeNext = structuredClone(ledgerProbeSave);
ledgerProbeNext.updatedAt = 2;
ledgerProbeNext.resources.gold = 1;
const ledgerProbeFirst = ledgerProbe.putCloudSave({ sessionToken: ledgerProbeGuest.session.token, requestId: 'first', expectedVersion: 0, save: ledgerProbeSave });
const ledgerProbeConflict = ledgerProbe.putCloudSave({ sessionToken: ledgerProbeGuest.session.token, requestId: 'conflict', expectedVersion: 0, save: ledgerProbeNext });
assert.equal(ledgerProbeConflict.code, 'VERSION_CONFLICT');
const ledgerProbeLatest = ledgerProbe.putCloudSave({ sessionToken: ledgerProbeGuest.session.token, requestId: 'latest', expectedVersion: 1, save: ledgerProbeNext });
assert.equal(ledgerProbeLatest.record.version, 2);
const ledgerProbeReplay = ledgerProbe.putCloudSave({ sessionToken: ledgerProbeGuest.session.token, requestId: 'conflict', expectedVersion: 0, save: ledgerProbeNext });
assert.deepEqual(ledgerProbeReplay.current, ledgerProbeFirst.record, 'a conflict replay must return its original receipt after the account advances');

function deterministicRun() {
  let clock = 3000;
  let accountSequence = 0;
  let tokenSequence = 0;
  const isolated = new BackendAccountService({
    now: () => clock++,
    accountId: (kind) => `${kind}-${++accountSequence}`,
    sessionToken: () => `session-${++tokenSequence}`,
    identityVerifier: (provider, subject, proof) => proof === `proof:${provider}:${subject}`,
    adminDiagnosticToken: ADMIN_DIAGNOSTIC_TOKEN,
  });
  const client = new AccountClientService(isolated, { deviceId: 'fixed-device', now: () => 4000 });
  client.guest();
  client.bind('apple', 'deterministic-user', 'proof:apple:deterministic-user');
  client.saveCloudSave(client.newSave(), 'fixed-request', 0);
  return isolated.snapshot(ADMIN_DIAGNOSTIC_TOKEN);
}

assert.deepEqual(deterministicRun(), deterministicRun(), 'fixed inputs must produce a deterministic account/cloud snapshot');
console.log('T259 M8-06 account/cloud save PASS: guest, binding, login, multi-device version conflict, idempotent replay, schema/fingerprint fail-closed, logout, deletion purge, deterministic');
