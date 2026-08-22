import assert from 'node:assert/strict';
import {
  ComplianceService,
  InMemoryPrivacyDataStore,
  PrivacyComplianceError,
  PRIVACY_POLICY_VERSION,
} from '../assets/scripts/services/compliance/index.ts';

const OPERATOR_TOKEN = 't264-operator-token';
const now = () => 1000;
const store = new InMemoryPrivacyDataStore([{ subjectId: 'account-a', data: { email: 'a@example.com', phone: '+86 138 0000 0000', progress: { level: 3 }, settings: { language: 'zh-CN' } }, updatedAt: 900, retentionUntil: 1015 }]);
const service = new ComplianceService({ store, operatorToken: OPERATOR_TOKEN, now, auditRetentionMs: 10_000 });
const subject = { kind: 'subject', subjectId: 'account-a' };
const operator = { kind: 'operator', token: OPERATOR_TOKEN };

function expectCode(label, action, code) {
  assert.throws(action, (error) => error instanceof PrivacyComplianceError && error.code === code, label);
}
function assertQuarantined(service, label) {
  assert(service.auditLog(operator).some((event) => event.action === 'store_quarantine' && event.reasonCode?.startsWith('STORE_QUARANTINED:')), label);
}

assert.deepEqual(service.getConsent(subject, 'account-a'), [], 'optional consent must default to denied');
assert.equal(service.canProcess('account-a', 'analytics'), false, 'unknown age must fail closed');
expectCode('invalid actor cannot access data', () => service.accessData({ kind: 'subject', subjectId: 'account-b' }, { subjectId: 'account-a', requestId: 'access-unauthorized' }), 'PERMISSION_DENIED');
expectCode('wrong operator credential fails closed', () => service.auditLog({ kind: 'operator', token: 'wrong-token' }), 'PERMISSION_DENIED');
expectCode('sensitive subject id is not accepted', () => service.getConsent(subject, 'a@example.com'), 'INVALID_INPUT');
expectCode('personal contact data is not accepted in request IDs', () => service.accessData(subject, { subjectId: 'account-a', requestId: 'a@example.com' }), 'INVALID_INPUT');
expectCode('malformed access request is rejected', () => service.accessData(subject, { subjectId: 'account-a', requestId: ' ' }), 'INVALID_INPUT');

const consent = service.recordConsent(subject, { subjectId: 'account-a', purpose: 'analytics', granted: true, policyVersion: PRIVACY_POLICY_VERSION, source: 'settings', requestId: 'consent-1' });
assert.equal(consent.replayed, false);
assert.equal(service.recordConsent(subject, { subjectId: 'account-a', purpose: 'analytics', granted: true, policyVersion: PRIVACY_POLICY_VERSION, source: 'settings', requestId: 'consent-1' }).replayed, true, 'same consent request must replay');
expectCode('consent request cannot change payload', () => service.recordConsent(subject, { subjectId: 'account-a', purpose: 'analytics', granted: false, policyVersion: PRIVACY_POLICY_VERSION, source: 'settings', requestId: 'consent-1' }), 'REQUEST_ID_REUSED');
expectCode('stale policy version is rejected', () => service.recordConsent(subject, { subjectId: 'account-a', purpose: 'marketing', granted: true, policyVersion: 'old-policy', source: 'settings', requestId: 'consent-old' }), 'POLICY_VERSION_MISMATCH');
const age = service.setAgeStatus(operator, { subjectId: 'account-a', status: 'adult', guardianVerified: false, requestId: 'age-1' });
assert.equal(age.status, 'adult');
assert.equal(service.canProcess('account-a', 'analytics'), true, 'adult with consent may process analytics');
assert.equal(service.canProcess('account-a', 'marketing'), false, 'missing marketing consent must remain denied');
expectCode('subject cannot set verified age status', () => service.setAgeStatus(subject, { subjectId: 'account-a', status: 'adult', guardianVerified: false, requestId: 'age-2' }), 'PERMISSION_DENIED');

const accessed = service.accessData(subject, { subjectId: 'account-a', requestId: 'access-1' });
assert.equal(accessed.data.email, 'a@example.com', 'subject access may return its sensitive data');
assert.equal(accessed.sensitiveFieldCount, 2, 'sensitive fields must be counted without being logged');
const accessReplay = service.accessData(subject, { subjectId: 'account-a', requestId: 'access-1' });
assert.equal(accessReplay.replayed, true);
assert.deepEqual(accessReplay.data, accessed.data, 'access replay must be deterministic');
expectCode('access request cannot become correction', () => service.correctData(subject, { subjectId: 'account-a', requestId: 'access-1', data: { safe: true } }), 'REQUEST_ID_REUSED');

const exported = service.exportData(subject, { subjectId: 'account-a', requestId: 'export-1' });
assert.equal(exported.format, 'application/json');
assert.equal(exported.content, service.exportData(subject, { subjectId: 'account-a', requestId: 'export-1' }).content, 'export must be deterministic');
assert.match(exported.content, /a@example\.com/);
const corrected = service.correctData(subject, { subjectId: 'account-a', requestId: 'correct-1', data: { email: 'new@example.com', progress: { level: 4 } } });
assert.equal(corrected.corrected, true);
assert.equal(service.accessData(subject, { subjectId: 'account-a', requestId: 'access-2' }).data.email, 'new@example.com');
expectCode('correction with credential field is rejected', () => service.correctData(subject, { subjectId: 'account-a', requestId: 'correct-invalid', data: { password: 'never-store' } }), 'INVALID_INPUT');

const expiredStore = new InMemoryPrivacyDataStore([{ subjectId: 'account-expired', data: { email: 'expired@example.com' }, updatedAt: 1, retentionUntil: 2 }]);
const expiredService = new ComplianceService({ store: expiredStore, operatorToken: OPERATOR_TOKEN, now: () => 2 });
expectCode('expired data cannot be accessed', () => expiredService.accessData({ kind: 'subject', subjectId: 'account-expired' }, { subjectId: 'account-expired', requestId: 'expired-access' }), 'SUBJECT_EXPIRED');
const purge = expiredService.purgeExpired(operator, 'purge-1');
assert.equal(purge.purgedSubjects, 1);
assert.equal(expiredStore.list().length, 0);
assert.equal(expiredService.purgeExpired(operator, 'purge-1').replayed, true, 'retention request must be idempotent');

const failingStore = {
  read() { throw new Error('offline'); },
  replace() { throw new Error('offline'); },
  remove() { throw new Error('offline'); },
  list() { throw new Error('offline'); },
};
const failingService = new ComplianceService({ store: failingStore, operatorToken: OPERATOR_TOKEN, now: () => 2000 });
expectCode('store read failure fails closed', () => failingService.accessData({ kind: 'subject', subjectId: 'account-a' }, { subjectId: 'account-a', requestId: 'store-failure' }), 'STORE_FAILURE');
expectCode('store failure is retryable and not a false success', () => failingService.accessData({ kind: 'subject', subjectId: 'account-a' }, { subjectId: 'account-a', requestId: 'store-failure' }), 'STORE_FAILURE');
assertQuarantined(failingService, 'store failures must leave an explicit quarantine audit');
const malformedStore = new ComplianceService({ store: { read() { return { subjectId: 'account-a', data: { email: 'a@example.com' }, updatedAt: -1, retentionUntil: 2 }; }, replace() {}, remove() {}, list() { return []; } }, operatorToken: OPERATOR_TOKEN, now: () => 2000 });
expectCode('malformed store records fail closed', () => malformedStore.accessData(subject, { subjectId: 'account-a', requestId: 'malformed-store' }), 'STORE_FAILURE');
assertQuarantined(malformedStore, 'malformed store records must quarantine the service');

const deleteResult = service.deleteData(subject, { subjectId: 'account-a', requestId: 'delete-1' });
assert.equal(deleteResult.deleted, true);
assert.equal(store.read('account-a'), null, 'delete must erase the subject data');
assert.deepEqual(service.getConsent(subject, 'account-a'), [], 'delete must erase consent');
expectCode('deleted subject cannot be accessed', () => service.accessData(subject, { subjectId: 'account-a', requestId: 'access-after-delete' }), 'SUBJECT_NOT_FOUND');
store.replace({ subjectId: 'account-a', data: { email: 'recreated@example.com' }, updatedAt: 1022, retentionUntil: 1030 });
expectCode('a failed access request cannot later become a success', () => service.accessData(subject, { subjectId: 'account-a', requestId: 'access-after-delete' }), 'SUBJECT_NOT_FOUND');
store.remove('account-a');
assert.equal(service.deleteData(subject, { subjectId: 'account-a', requestId: 'delete-1' }).replayed, true, 'delete must replay its receipt');
const audit = service.auditLog(operator);
assert(audit.length > 0, 'authorized operator must read audit records');
assert(audit.every((event) => !JSON.stringify(event).includes('a@example.com') && !JSON.stringify(event).includes('account-a')), 'audit must not expose sensitive fields or raw subject IDs');
assert(audit.every((event) => /^req_[0-9a-f]+$/.test(event.requestId)), 'audit request IDs must be normalized');
assert.equal(JSON.stringify(audit).includes('consent-1'), false, 'audit must not expose raw request IDs');
expectCode('subject cannot read global audit log', () => service.auditLog(subject), 'PERMISSION_DENIED');

const foreignRecord = { subjectId: 'account-b', data: { email: 'b@example.com' }, updatedAt: 1, retentionUntil: 10_000 };
const foreignRecordStore = { read() { return structuredClone(foreignRecord); }, replace() {}, remove() {}, list() { return [structuredClone(foreignRecord)]; } };
const foreignRecordService = new ComplianceService({ store: foreignRecordStore, operatorToken: OPERATOR_TOKEN, now: () => 2 });
expectCode('cross-subject read fails closed when storage returns a foreign record', () => foreignRecordService.accessData(subject, { subjectId: 'account-a', requestId: 'foreign-read' }), 'STORE_FAILURE');
expectCode('cross-subject export fails closed when storage returns a foreign record', () => foreignRecordService.exportData(subject, { subjectId: 'account-a', requestId: 'foreign-export' }), 'STORE_FAILURE');
expectCode('cross-subject delete fails closed before removing a foreign record', () => foreignRecordService.deleteData(subject, { subjectId: 'account-a', requestId: 'foreign-delete' }), 'STORE_FAILURE');
assertQuarantined(foreignRecordService, 'foreign storage records must quarantine the service');

let exportNow = 10;
const replayExportStore = new InMemoryPrivacyDataStore([{ subjectId: 'export-subject', data: { safe: true }, updatedAt: 1, retentionUntil: 20 }]);
const replayExportService = new ComplianceService({ store: replayExportStore, operatorToken: OPERATOR_TOKEN, now: () => exportNow });
const replayExportActor = { kind: 'subject', subjectId: 'export-subject' };
replayExportService.exportData(replayExportActor, { subjectId: 'export-subject', requestId: 'export-replay-retention' });
exportNow = 20;
expectCode('expired export replay cannot return a prior export', () => replayExportService.exportData(replayExportActor, { subjectId: 'export-subject', requestId: 'export-replay-retention' }), 'SUBJECT_EXPIRED');

let residualRecord = { subjectId: 'delete-subject', data: { safe: true }, updatedAt: 1, retentionUntil: 10_000 };
const residualStore = {
  read() { return structuredClone(residualRecord); },
  replace(record) { residualRecord = structuredClone(record); },
  remove() {},
  list() { return [structuredClone(residualRecord)]; },
};
const residualService = new ComplianceService({ store: residualStore, operatorToken: OPERATOR_TOKEN, now: () => 2 });
expectCode('delete fails closed when remove leaves residual data', () => residualService.deleteData({ kind: 'subject', subjectId: 'delete-subject' }, { subjectId: 'delete-subject', requestId: 'delete-residual' }), 'STORE_FAILURE');
assert.deepEqual(residualStore.read(), residualRecord, 'failed delete must leave the original record intact');
assertQuarantined(residualService, 'failed delete must quarantine the service');

const sortRecords = (records) => [...records].sort((left, right) => left.subjectId.localeCompare(right.subjectId));
const assertStoreSnapshot = (store, expected, message) => assert.deepEqual(sortRecords(store.list()), sortRecords(expected), message);

class WrongSubjectDeleteStore extends InMemoryPrivacyDataStore {
  constructor(initial, mode) {
    super();
    this.mode = mode;
    this.injected = false;
    for (const record of initial) super.replace(record);
  }
  remove(subjectId) {
    if (subjectId === 'delete-target' && !this.injected) {
      this.injected = true;
      if (this.mode === 'wrong-subject') { super.remove('delete-other'); return; }
      super.remove(subjectId);
      super.replace({ subjectId: 'delete-injected', data: { injected: true }, updatedAt: 1, retentionUntil: 10_000 });
      return;
    }
    super.remove(subjectId);
  }
}

for (const mode of ['wrong-subject', 'unknown-addition']) {
  const deleteBefore = [
    { subjectId: 'delete-target', data: { value: 1 }, updatedAt: 1, retentionUntil: 10_000 },
    { subjectId: 'delete-other', data: { value: 2 }, updatedAt: 1, retentionUntil: 10_000 },
  ];
  const faultyDeleteStore = new WrongSubjectDeleteStore(deleteBefore, mode);
  const faultyDeleteService = new ComplianceService({ store: faultyDeleteStore, operatorToken: OPERATOR_TOKEN, now: () => 2 });
  expectCode(`delete fails closed on ${mode}`, () => faultyDeleteService.deleteData({ kind: 'subject', subjectId: 'delete-target' }, { subjectId: 'delete-target', requestId: `delete-global-${mode}` }), 'STORE_FAILURE');
  assertStoreSnapshot(faultyDeleteStore, deleteBefore, `failed delete on ${mode} must restore the complete store snapshot`);
  assertQuarantined(faultyDeleteService, `failed delete on ${mode} must quarantine the service`);
}

const removeFailureStore = {
  read() { return { subjectId: 'delete-failure', data: { safe: true }, updatedAt: 1, retentionUntil: 10_000 }; },
  replace() {},
  remove() { throw new Error('remove failed'); },
  list() { return []; },
};
const removeFailureService = new ComplianceService({ store: removeFailureStore, operatorToken: OPERATOR_TOKEN, now: () => 2 });
expectCode('delete fails closed when remove throws', () => removeFailureService.deleteData({ kind: 'subject', subjectId: 'delete-failure' }, { subjectId: 'delete-failure', requestId: 'delete-error' }), 'STORE_FAILURE');
assertQuarantined(removeFailureService, 'remove failure must quarantine the service');

class CorruptingCorrectionStore extends InMemoryPrivacyDataStore {
  constructor(initial, mode) {
    super();
    this.mode = mode;
    this.injected = false;
    for (const record of initial) super.replace(record);
  }
  replace(record) {
    if (record.subjectId === 'correct-target' && !this.injected) {
      this.injected = true;
      if (this.mode === 'delete-other') super.remove('correct-other');
      if (this.mode === 'change-other') super.replace({ subjectId: 'correct-other', data: { value: 99 }, updatedAt: 1, retentionUntil: 10_000 });
      if (this.mode === 'unknown-addition') super.replace({ subjectId: 'correct-injected', data: { injected: true }, updatedAt: 1, retentionUntil: 10_000 });
    }
    super.replace(record);
  }
}

for (const mode of ['delete-other', 'change-other', 'unknown-addition']) {
  const correctionBefore = [
    { subjectId: 'correct-target', data: { value: 1 }, updatedAt: 1, retentionUntil: 10_000 },
    { subjectId: 'correct-other', data: { value: 2 }, updatedAt: 1, retentionUntil: 10_000 },
  ];
  const faultyCorrectionStore = new CorruptingCorrectionStore(correctionBefore, mode);
  const faultyCorrectionService = new ComplianceService({ store: faultyCorrectionStore, operatorToken: OPERATOR_TOKEN, now: () => 2 });
  expectCode(`correction fails closed on ${mode}`, () => faultyCorrectionService.correctData({ kind: 'subject', subjectId: 'correct-target' }, { subjectId: 'correct-target', requestId: `correct-global-${mode}`, data: { value: 3 } }), 'STORE_FAILURE');
  assertStoreSnapshot(faultyCorrectionStore, correctionBefore, `failed correction on ${mode} must restore the complete store snapshot`);
  assertQuarantined(faultyCorrectionService, `failed correction on ${mode} must quarantine the service`);
}

class MutatingExpiredDuringPurgeStore extends InMemoryPrivacyDataStore {
  purgeExpired(now) {
    const expired = super.read('purge-mutated-expired');
    super.replace({ ...expired, data: { value: 99 }, updatedAt: 2, retentionUntil: 100 });
    return super.purgeExpired(now);
  }
}

const purgeMutationBefore = [
  { subjectId: 'purge-mutated-expired', data: { value: 1 }, updatedAt: 1, retentionUntil: 100 },
  { subjectId: 'purge-mutated-live', data: { value: 2 }, updatedAt: 1, retentionUntil: 200 },
];
const purgeMutationStore = new MutatingExpiredDuringPurgeStore(purgeMutationBefore);
const purgeMutationService = new ComplianceService({ store: purgeMutationStore, operatorToken: OPERATOR_TOKEN, now: () => 100 });
expectCode('purge must compare the complete content of removed expired records', () => purgeMutationService.purgeExpired(operator, 'purge-mutated-content'), 'STORE_FAILURE');
assertStoreSnapshot(purgeMutationStore, purgeMutationBefore, 'failed purge must restore the complete snapshot after an expired record mutation');
assertQuarantined(purgeMutationService, 'expired record mutation during purge must quarantine the service');

const unverifiablePurgeStore = {
  records: new Map([['purge-unverifiable', { subjectId: 'purge-unverifiable', data: { value: 1 }, updatedAt: 1, retentionUntil: 100 }]]),
  read(subjectId) { const record = this.records.get(subjectId); return record ? { ...record, data: { ...record.data } } : null; },
  replace(record) { this.records.set(record.subjectId, { ...record, data: { ...record.data } }); },
  remove(subjectId) { this.records.delete(subjectId); },
  list() { return [...this.records.values()].map((record) => ({ ...record, data: { ...record.data } })); },
};
const unverifiablePurgeService = new ComplianceService({ store: unverifiablePurgeStore, operatorToken: OPERATOR_TOKEN, now: () => 100 });
expectCode('purge must fail closed when fallback removal has no removed snapshot', () => unverifiablePurgeService.purgeExpired(operator, 'purge-unverifiable'), 'STORE_FAILURE');
assert.deepEqual(unverifiablePurgeStore.read('purge-unverifiable'), { subjectId: 'purge-unverifiable', data: { value: 1 }, updatedAt: 1, retentionUntil: 100 }, 'unverifiable fallback purge must restore the original record');
assertQuarantined(unverifiablePurgeService, 'unverifiable fallback purge must quarantine the service');

class MutatingOtherDuringTargetReadStore extends InMemoryPrivacyDataStore {
  mutated = false;
  read(subjectId) {
    if (subjectId === 'read-target' && !this.mutated) {
      this.mutated = true;
      super.replace({ subjectId: 'read-other', data: { value: 99 }, updatedAt: 1, retentionUntil: 10_000 });
    }
    return super.read(subjectId);
  }
}

const targetReadBefore = [
  { subjectId: 'read-target', data: { value: 1 }, updatedAt: 1, retentionUntil: 10_000 },
  { subjectId: 'read-other', data: { value: 2 }, updatedAt: 1, retentionUntil: 10_000 },
];
for (const operation of ['deleteData', 'correctData']) {
  const targetReadStore = new MutatingOtherDuringTargetReadStore(targetReadBefore);
  const targetReadService = new ComplianceService({ store: targetReadStore, operatorToken: OPERATOR_TOKEN, now: () => 2 });
  const request = operation === 'deleteData'
    ? { subjectId: 'read-target', requestId: 'target-read-delete' }
    : { subjectId: 'read-target', requestId: 'target-read-correct', data: { value: 3 } };
  const actor = operation === 'deleteData' ? operator : { kind: 'subject', subjectId: 'read-target' };
  expectCode(`${operation} must fail when another subject changes during target read`, () => targetReadService[operation](actor, request), 'STORE_FAILURE');
  assert.equal(targetReadStore.read('read-target')?.data.value, 1, `${operation} must not mutate the target after a concurrent target-read change`);
  assert.equal(targetReadStore.read('read-other')?.data.value, 2, `${operation} must restore the complete snapshot after a target-read race`);
  assertQuarantined(targetReadService, `${operation} target-read race must quarantine the service`);
}

class ThrowAfterTransactionStore extends InMemoryPrivacyDataStore {
  withTransaction(action) {
    const result = action();
    throw new Error('adapter failed after transaction callback');
  }
}

const postCallbackCases = [
  {
    operation: 'delete',
    subjectId: 'post-callback-delete',
    before: [{ subjectId: 'post-callback-delete', data: { value: 1 }, updatedAt: 1, retentionUntil: 10_000 }],
    requestId: 'post-callback-delete',
    invoke(service) { return service.deleteData(operator, { subjectId: this.subjectId, requestId: this.requestId }); },
  },
  {
    operation: 'correct',
    subjectId: 'post-callback-correct',
    before: [{ subjectId: 'post-callback-correct', data: { value: 1 }, updatedAt: 1, retentionUntil: 10_000 }],
    requestId: 'post-callback-correct',
    invoke(service) { return service.correctData({ kind: 'subject', subjectId: this.subjectId }, { subjectId: this.subjectId, requestId: this.requestId, data: { value: 2 } }); },
  },
  {
    operation: 'purge',
    subjectId: 'post-callback-purge',
    before: [{ subjectId: 'post-callback-purge', data: { value: 1 }, updatedAt: 1, retentionUntil: 100 }],
    requestId: 'post-callback-purge',
    invoke(service) { return service.purgeExpired(operator, this.requestId); },
  },
];

for (const testCase of postCallbackCases) {
  const postCallbackStore = new ThrowAfterTransactionStore(testCase.before);
  const postCallbackService = new ComplianceService({ store: postCallbackStore, operatorToken: OPERATOR_TOKEN, now: () => 100 });
  postCallbackService.recordConsent({ kind: 'subject', subjectId: testCase.subjectId }, { subjectId: testCase.subjectId, purpose: 'analytics', granted: true, policyVersion: PRIVACY_POLICY_VERSION, source: 'settings', requestId: `${testCase.requestId}-consent` });
  postCallbackService.setAgeStatus(operator, { subjectId: testCase.subjectId, status: 'adult', guardianVerified: false, requestId: `${testCase.requestId}-age` });
  expectCode(`${testCase.operation} must rollback when the adapter throws after callback completion`, () => testCase.invoke(postCallbackService), 'STORE_FAILURE');
  assertStoreSnapshot(postCallbackStore, testCase.before, `${testCase.operation} post-callback failure must restore the complete store snapshot`);
  assert.equal(postCallbackService.getConsent({ kind: 'subject', subjectId: testCase.subjectId }, testCase.subjectId, 'analytics').length, 1, `${testCase.operation} post-callback failure must restore consent state`);
  assert.equal(postCallbackService.getAgeStatus(operator, testCase.subjectId).status, 'adult', `${testCase.operation} post-callback failure must restore age state`);
  assert.equal(postCallbackService.auditLog(operator).some((event) => event.action === testCase.operation && event.outcome === 'accepted'), false, `${testCase.operation} post-callback failure must remove its accepted audit`);
  assertQuarantined(postCallbackService, `${testCase.operation} post-callback failure must quarantine the service`);
  expectCode(`${testCase.operation} post-callback failure must not leave a replayable success`, () => testCase.invoke(postCallbackService), 'STORE_FAILURE');
}

class ClockChangingAfterTransactionStore extends InMemoryPrivacyDataStore {
  constructor(initial, afterTransaction) {
    super(initial);
    this.afterTransaction = afterTransaction;
  }
  withTransaction(action) {
    const result = action();
    this.afterTransaction();
    return result;
  }
}

for (const [label, transactionTick] of [['rollback', 99], ['forward', 101]]) {
  for (const operation of ['correct', 'purge']) {
    let tick = 100;
    const clockBefore = [{ subjectId: `post-return-clock-${operation}`, data: { safe: true }, updatedAt: 1, retentionUntil: operation === 'correct' ? 1_000 : 100 }];
    const postReturnClockStore = new ClockChangingAfterTransactionStore(clockBefore, () => { tick = transactionTick; });
    const postReturnClockService = new ComplianceService({ store: postReturnClockStore, operatorToken: OPERATOR_TOKEN, now: () => tick });
    expectCode(`${operation} must check the clock after the transaction adapter returns (${label})`, () => operation === 'correct'
      ? postReturnClockService.correctData({ kind: 'subject', subjectId: clockBefore[0].subjectId }, { subjectId: clockBefore[0].subjectId, requestId: `post-return-clock-${operation}-${label}`, data: { safe: false } })
      : postReturnClockService.purgeExpired(operator, `post-return-clock-${operation}-${label}`), 'STORE_FAILURE');
    assertStoreSnapshot(postReturnClockStore, clockBefore, `${operation} post-return clock failure must restore the complete snapshot (${label})`);
    assertQuarantined(postReturnClockService, `${operation} post-return clock failure must quarantine (${label})`);
  }
}

let purgeClockShouldFail = true;
const purgeClockStore = new InMemoryPrivacyDataStore([{ subjectId: 'purge-clock', data: { safe: true }, updatedAt: 1, retentionUntil: 10 }]);
const purgeClockFailureService = new ComplianceService({ store: purgeClockStore, operatorToken: OPERATOR_TOKEN, now: () => {
  if (purgeClockShouldFail) throw new Error('purge clock offline');
  return 10;
} });
expectCode('purge clock exceptions are normalized to store failure', () => purgeClockFailureService.purgeExpired(operator, 'purge-clock-failure'), 'STORE_FAILURE');
assertQuarantined(purgeClockFailureService, 'clock read failure must quarantine the service');
purgeClockShouldFail = false;
expectCode('quarantined clock failure must reject retry', () => purgeClockFailureService.purgeExpired(operator, 'purge-clock-failure'), 'STORE_FAILURE');

class OverPurgingStore extends InMemoryPrivacyDataStore {
  purgeCalls = 0;
  purgeExpired(now) {
    this.purgeCalls += 1;
    const records = this.list();
    for (const record of records) this.remove(record.subjectId);
    return records;
  }
}
const unsafePurgeStore = new OverPurgingStore([
  { subjectId: 'purge-live', data: { safe: true }, updatedAt: 1, retentionUntil: 200 },
  { subjectId: 'purge-expired', data: { safe: true }, updatedAt: 1, retentionUntil: 100 },
]);
const unsafePurgeService = new ComplianceService({ store: unsafePurgeStore, operatorToken: OPERATOR_TOKEN, now: () => 100 });
expectCode('purge must fail closed when the store deletes an unexpired subject', () => unsafePurgeService.purgeExpired(operator, 'purge-overreach'), 'STORE_FAILURE');
assert.deepEqual(unsafePurgeStore.read('purge-live'), { subjectId: 'purge-live', data: { safe: true }, updatedAt: 1, retentionUntil: 200 }, 'over-deletion must be restored where possible');
assert.deepEqual(unsafePurgeStore.read('purge-expired'), { subjectId: 'purge-expired', data: { safe: true }, updatedAt: 1, retentionUntil: 100 }, 'failed purge must restore the expired snapshot too');
assertQuarantined(unsafePurgeService, 'over-deletion must quarantine the service');
expectCode('over-deletion must not become a false-success replay', () => unsafePurgeService.purgeExpired(operator, 'purge-overreach'), 'STORE_FAILURE');
assert.equal(unsafePurgeStore.purgeCalls, 1, 'quarantined purge requests must not touch storage again');

class PurgeAddingUnknownStore extends InMemoryPrivacyDataStore {
  constructor(initial, failUnknownRemoval = false) {
    super();
    this.failUnknownRemoval = failUnknownRemoval;
    for (const record of initial) super.replace(record);
  }
  purgeExpired(now) {
    const removed = super.purgeExpired(now);
    super.replace({ subjectId: 'purge-unknown', data: { injected: true }, updatedAt: 1, retentionUntil: 10_000 });
    return removed;
  }
  remove(subjectId) {
    if (this.failUnknownRemoval && subjectId === 'purge-unknown') throw new Error('unknown subject is quarantined');
    super.remove(subjectId);
  }
}

const purgeUnknownBefore = [
  { subjectId: 'purge-unknown-live', data: { safe: true }, updatedAt: 1, retentionUntil: 200 },
  { subjectId: 'purge-unknown-expired', data: { safe: true }, updatedAt: 1, retentionUntil: 100 },
];
const purgeUnknownStore = new PurgeAddingUnknownStore(purgeUnknownBefore);
const purgeUnknownService = new ComplianceService({ store: purgeUnknownStore, operatorToken: OPERATOR_TOKEN, now: () => 100 });
expectCode('purge fails closed when the store adds an unknown subject', () => purgeUnknownService.purgeExpired(operator, 'purge-unknown-addition'), 'STORE_FAILURE');
assertStoreSnapshot(purgeUnknownStore, purgeUnknownBefore, 'failed purge must remove unknown additions and restore the exact original snapshot');
assertQuarantined(purgeUnknownService, 'unknown purge additions must quarantine the service');

const unrecoverablePurgeStore = new PurgeAddingUnknownStore(purgeUnknownBefore, true);
const unrecoverablePurgeService = new ComplianceService({ store: unrecoverablePurgeStore, operatorToken: OPERATOR_TOKEN, now: () => 100 });
expectCode('purge rollback failure must remain an explicit store failure', () => unrecoverablePurgeService.purgeExpired(operator, 'purge-rollback-failure'), 'STORE_FAILURE');
assertQuarantined(unrecoverablePurgeService, 'unrecoverable purge rollback must quarantine the service');

class CountingPurgeStore extends InMemoryPrivacyDataStore {
  purgeCalls = 0;
  purgeExpired(now) {
    this.purgeCalls += 1;
    return super.purgeExpired(now);
  }
}
const legalPurgeStore = new CountingPurgeStore([
  { subjectId: 'legal-live', data: { safe: true }, updatedAt: 1, retentionUntil: 200 },
  { subjectId: 'legal-expired', data: { safe: true }, updatedAt: 1, retentionUntil: 100 },
]);
const legalPurgeService = new ComplianceService({ store: legalPurgeStore, operatorToken: OPERATOR_TOKEN, now: () => 100 });
assert.equal(legalPurgeService.purgeExpired(operator, 'purge-legal').purgedSubjects, 1, 'legal expired cleanup must remove only expired subjects');
assert.deepEqual(legalPurgeStore.read('legal-live'), { subjectId: 'legal-live', data: { safe: true }, updatedAt: 1, retentionUntil: 200 }, 'legal purge must preserve unexpired data');
assert.equal(legalPurgeService.purgeExpired(operator, 'purge-legal').replayed, true, 'legal purge must be idempotent');
assert.equal(legalPurgeStore.purgeCalls, 1, 'idempotent purge replay must not call the time-dependent store operation again');

let auditClockCalls = 0;
const auditClockStore = new InMemoryPrivacyDataStore([{ subjectId: 'audit-clock', data: { value: 1 }, updatedAt: 1, retentionUntil: 10_000 }]);
const auditClockFailureService = new ComplianceService({ store: auditClockStore, operatorToken: OPERATOR_TOKEN, now: () => { auditClockCalls += 1; if (auditClockCalls === 2) throw new Error('audit clock offline'); return 100 + auditClockCalls; } });
expectCode('audit clock failure prevents correction side effects', () => auditClockFailureService.correctData({ kind: 'subject', subjectId: 'audit-clock' }, { subjectId: 'audit-clock', requestId: 'audit-clock-correction', data: { value: 2 } }), 'STORE_FAILURE');
assert.deepEqual(auditClockStore.read('audit-clock').data, { value: 1 }, 'audit clock failure must not write corrected data');
assertQuarantined(auditClockFailureService, 'audit clock failure must quarantine the service');

const auditPersistenceService = new ComplianceService({ store: new InMemoryPrivacyDataStore([{ subjectId: 'audit-persistence', data: { value: 1 }, updatedAt: 1, retentionUntil: 10_000 }]), operatorToken: OPERATOR_TOKEN, now: () => 100 });
auditPersistenceService.audits.push = () => { throw new Error('audit persistence offline'); };
expectCode('audit persistence failure prevents correction side effects', () => auditPersistenceService.correctData({ kind: 'subject', subjectId: 'audit-persistence' }, { subjectId: 'audit-persistence', requestId: 'audit-persistence-correction', data: { value: 2 } }), 'STORE_FAILURE');
assert.deepEqual(auditPersistenceService.store.read('audit-persistence').data, { value: 1 }, 'audit persistence failure must not write corrected data');

const rollbackStore = new InMemoryPrivacyDataStore([{ subjectId: 'clock-rollback', data: { safe: true }, updatedAt: 1, retentionUntil: 1_000 }]);
let rollbackTick = 100;
const rollbackService = new ComplianceService({ store: rollbackStore, operatorToken: OPERATOR_TOKEN, now: () => rollbackTick });
assert.equal(rollbackService.accessData({ kind: 'subject', subjectId: 'clock-rollback' }, { subjectId: 'clock-rollback', requestId: 'clock-forward' }).data.safe, true);
rollbackTick = 99;
expectCode('clock rollback must fail closed', () => rollbackService.accessData({ kind: 'subject', subjectId: 'clock-rollback' }, { subjectId: 'clock-rollback', requestId: 'clock-backward' }), 'STORE_FAILURE');
assertQuarantined(rollbackService, 'clock rollback must be audited as quarantine');

let toctouTick = 99;
const toctouStore = {
  read(subjectId) { return subjectId === 'time-of-check' ? { subjectId, data: { safe: true }, updatedAt: 1, retentionUntil: 100 } : null; },
  replace() {}, remove() {}, list() { return [{ subjectId: 'time-of-check', data: { safe: true }, updatedAt: 1, retentionUntil: 100 }]; },
};
const toctouService = new ComplianceService({ store: toctouStore, operatorToken: OPERATOR_TOKEN, now: () => toctouTick++ });
expectCode('time-forward TOCTOU must not return data', () => toctouService.accessData({ kind: 'subject', subjectId: 'time-of-check' }, { subjectId: 'time-of-check', requestId: 'time-forward-toctou' }), 'STORE_FAILURE');
assertQuarantined(toctouService, 'time-forward TOCTOU must quarantine the service');

class TransactionClockStore extends InMemoryPrivacyDataStore {
  constructor(initial, nextTick) {
    super(initial);
    this.nextTick = nextTick;
  }
  read(subjectId) {
    const result = super.read(subjectId);
    this.nextTick();
    return result;
  }
  withTransaction(action) {
    return action();
  }
}

for (const [label, transactionTick] of [['rollback', 99], ['forward', 101]]) {
  for (const operation of ['accessData', 'exportData']) {
    let tick = 100;
    const transactionStore = new TransactionClockStore([{ subjectId: 'transaction-clock', data: { safe: true }, updatedAt: 1, retentionUntil: 1_000 }], () => { tick = transactionTick; });
    const transactionService = new ComplianceService({ store: transactionStore, operatorToken: OPERATOR_TOKEN, now: () => tick });
    const transactionSubject = { kind: 'subject', subjectId: 'transaction-clock' };
    const request = { subjectId: 'transaction-clock', requestId: `transaction-${operation}-${label}` };
    expectCode(`withTransaction clock ${label} must fail closed for ${operation}`, () => transactionService[operation](transactionSubject, request), 'STORE_FAILURE');
    assertQuarantined(transactionService, `withTransaction clock ${label} must quarantine ${operation}`);
    const quarantine = transactionService.auditLog(operator).find((event) => event.action === 'store_quarantine');
    assert.equal(quarantine?.occurredAt, transactionTick === 99 ? 100 : 101, `withTransaction clock ${label} must preserve the monotonic observedNow watermark`);
    expectCode(`quarantined ${operation} must not return a transaction result`, () => transactionService[operation](transactionSubject, { ...request, requestId: `${request.requestId}-retry` }), 'STORE_FAILURE');
  }
}

for (const [label, transactionTick] of [['rollback', 99], ['forward', 101]]) {
  for (const operation of ['correct', 'purge']) {
    let clockCalls = 0;
    const mutationStore = operation === 'correct'
      ? new InMemoryPrivacyDataStore([{ subjectId: 'mutation-clock', data: { safe: true }, updatedAt: 1, retentionUntil: 1_000 }])
      : new InMemoryPrivacyDataStore([{ subjectId: 'mutation-clock', data: { safe: true }, updatedAt: 1, retentionUntil: 100 }]);
    const mutationService = new ComplianceService({
      store: mutationStore,
      operatorToken: OPERATOR_TOKEN,
      now: () => { clockCalls += 1; return clockCalls === 1 ? 100 : transactionTick; },
    });
    expectCode(`mutation ${operation} must fail on ${label} during final clock check`, () => operation === 'correct'
      ? mutationService.correctData({ kind: 'subject', subjectId: 'mutation-clock' }, { subjectId: 'mutation-clock', requestId: `mutation-clock-${operation}-${label}`, data: { safe: false } })
      : mutationService.purgeExpired(operator, `mutation-clock-${operation}-${label}`), 'STORE_FAILURE');
    assert.deepEqual(mutationStore.read('mutation-clock'), { subjectId: 'mutation-clock', data: { safe: true }, updatedAt: 1, retentionUntil: operation === 'correct' ? 1_000 : 100 }, `failed ${operation} on ${label} must restore its store snapshot`);
    assertQuarantined(mutationService, `failed ${operation} on ${label} must quarantine the service`);
  }
}

for (const [label, action] of [
  ['quarantined read', () => unrecoverablePurgeService.accessData(operator, { subjectId: 'purge-unknown-live', requestId: 'quarantine-read' })],
  ['quarantined export', () => unrecoverablePurgeService.exportData(operator, { subjectId: 'purge-unknown-live', requestId: 'quarantine-export' })],
  ['quarantined delete', () => unrecoverablePurgeService.deleteData(operator, { subjectId: 'purge-unknown-live', requestId: 'quarantine-delete' })],
  ['quarantined correction', () => unrecoverablePurgeService.correctData(operator, { subjectId: 'purge-unknown-live', requestId: 'quarantine-correct', data: { safe: false } })],
  ['quarantined purge', () => unrecoverablePurgeService.purgeExpired(operator, 'quarantine-purge')],
]) expectCode(`${label} must fail closed`, action, 'STORE_FAILURE');
assert.notEqual(unrecoverablePurgeStore.read('purge-unknown'), null, 'the fixture retains the unknown residual to prove quarantine blocks access');

let purgeNow = 9;
const changingPurgeStore = new InMemoryPrivacyDataStore([{ subjectId: 'purge-changing-time', data: { safe: true }, updatedAt: 1, retentionUntil: 10 }]);
const changingPurgeService = new ComplianceService({ store: changingPurgeStore, operatorToken: OPERATOR_TOKEN, now: () => purgeNow });
assert.equal(changingPurgeService.purgeExpired(operator, 'purge-changing-time').purgedSubjects, 0);
purgeNow = 10;
assert.equal(changingPurgeService.purgeExpired(operator, 'purge-changing-time').replayed, true, 'purge replay must remain idempotent when time changes');
assert.equal(changingPurgeStore.list().length, 1, 'stable purge replay must not apply a second time-dependent purge');

class QuarantineAfterSuccessStore extends InMemoryPrivacyDataStore {
  invalidList = false;
  list() {
    if (this.invalidList) return [{ subjectId: 'invalid-store-record', data: { safe: true }, updatedAt: 2, retentionUntil: 1 }];
    return super.list();
  }
}

const replayAfterQuarantineCases = [
  {
    operation: 'delete',
    store: new QuarantineAfterSuccessStore([{ subjectId: 'replay-delete', data: { safe: true }, updatedAt: 1, retentionUntil: 1_000 }]),
    run(service) { return service.deleteData({ kind: 'subject', subjectId: 'replay-delete' }, { subjectId: 'replay-delete', requestId: 'delete-success-before-quarantine' }); },
    replay(service) { return service.deleteData({ kind: 'subject', subjectId: 'replay-delete' }, { subjectId: 'replay-delete', requestId: 'delete-success-before-quarantine' }); },
  },
  {
    operation: 'correct',
    store: new QuarantineAfterSuccessStore([{ subjectId: 'replay-correct', data: { safe: true }, updatedAt: 1, retentionUntil: 1_000 }]),
    run(service) { return service.correctData({ kind: 'subject', subjectId: 'replay-correct' }, { subjectId: 'replay-correct', requestId: 'correct-success-before-quarantine', data: { safe: false } }); },
    replay(service) { return service.correctData({ kind: 'subject', subjectId: 'replay-correct' }, { subjectId: 'replay-correct', requestId: 'correct-success-before-quarantine', data: { safe: false } }); },
  },
  {
    operation: 'purge',
    store: new QuarantineAfterSuccessStore([{ subjectId: 'replay-purge', data: { safe: true }, updatedAt: 1, retentionUntil: 100 }]),
    run(service) { return service.purgeExpired(operator, 'purge-success-before-quarantine'); },
    replay(service) { return service.purgeExpired(operator, 'purge-success-before-quarantine'); },
  },
];

for (const testCase of replayAfterQuarantineCases) {
  const service = new ComplianceService({ store: testCase.store, operatorToken: OPERATOR_TOKEN, now: () => 100 });
  assert.equal(testCase.run(service).replayed, false, `${testCase.operation} must first commit a success receipt`);
  testCase.store.invalidList = true;
  expectCode(`${testCase.operation} quarantine trigger must fail closed`, () => service.purgeExpired(operator, `quarantine-trigger-${testCase.operation}`), 'STORE_FAILURE');
  expectCode(`${testCase.operation} success receipt must not replay after quarantine`, () => testCase.replay(service), 'STORE_FAILURE');
}

console.log(`T264 privacy compliance PASS: consent, age-gate, access, deterministic-export, correction, deletion, retention, audit-redaction, permission-isolation, sensitive-fields, idempotency, invalid-input and fail-closed=${audit.length}`);
