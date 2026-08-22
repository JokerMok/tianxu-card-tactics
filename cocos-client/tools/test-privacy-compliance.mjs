import assert from 'node:assert/strict';
import {
  ComplianceService,
  InMemoryPrivacyDataStore,
  PrivacyComplianceError,
  PRIVACY_POLICY_VERSION,
} from '../assets/scripts/services/compliance/index.ts';

const OPERATOR_TOKEN = 't264-operator-token';
const ticks = [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 1012, 1013, 1014, 1015, 1016, 1017, 1018, 1019, 1020, 1021, 1022];
let tickIndex = 0;
const now = () => ticks[Math.min(tickIndex++, ticks.length - 1)];
const store = new InMemoryPrivacyDataStore([{ subjectId: 'account-a', data: { email: 'a@example.com', phone: '+86 138 0000 0000', progress: { level: 3 }, settings: { language: 'zh-CN' } }, updatedAt: 900, retentionUntil: 1015 }]);
const service = new ComplianceService({ store, operatorToken: OPERATOR_TOKEN, now, auditRetentionMs: 10_000 });
const subject = { kind: 'subject', subjectId: 'account-a' };
const operator = { kind: 'operator', token: OPERATOR_TOKEN };

function expectCode(label, action, code) {
  assert.throws(action, (error) => error instanceof PrivacyComplianceError && error.code === code, label);
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
assert.equal(failingService.auditLog(operator).length, 0, 'store failures must not write success or misleading audit records');
const malformedStore = new ComplianceService({ store: { read() { return { subjectId: 'account-a', data: { email: 'a@example.com' }, updatedAt: -1, retentionUntil: 2 }; }, replace() {}, remove() {}, list() { return []; } }, operatorToken: OPERATOR_TOKEN, now: () => 2000 });
expectCode('malformed store records fail closed', () => malformedStore.accessData(subject, { subjectId: 'account-a', requestId: 'malformed-store' }), 'STORE_FAILURE');
assert.equal(malformedStore.auditLog(operator).length, 0, 'malformed store records must not be recorded as request failures');

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
assert.equal(foreignRecordService.auditLog(operator).length, 0, 'foreign storage records must not create misleading audit events');

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
assert.equal(residualService.auditLog(operator).length, 0, 'failed delete must not leave an accepted audit event');

const removeFailureStore = {
  read() { return { subjectId: 'delete-failure', data: { safe: true }, updatedAt: 1, retentionUntil: 10_000 }; },
  replace() {},
  remove() { throw new Error('remove failed'); },
  list() { return []; },
};
const removeFailureService = new ComplianceService({ store: removeFailureStore, operatorToken: OPERATOR_TOKEN, now: () => 2 });
expectCode('delete fails closed when remove throws', () => removeFailureService.deleteData({ kind: 'subject', subjectId: 'delete-failure' }, { subjectId: 'delete-failure', requestId: 'delete-error' }), 'STORE_FAILURE');
assert.equal(removeFailureService.auditLog(operator).length, 0, 'remove failure must not leave an accepted audit event');

let auditClockCalls = 0;
const auditClockStore = new InMemoryPrivacyDataStore([{ subjectId: 'audit-clock', data: { value: 1 }, updatedAt: 1, retentionUntil: 10_000 }]);
const auditClockFailureService = new ComplianceService({ store: auditClockStore, operatorToken: OPERATOR_TOKEN, now: () => { auditClockCalls += 1; if (auditClockCalls === 3) throw new Error('audit clock offline'); return 100 + auditClockCalls; } });
expectCode('audit clock failure prevents correction side effects', () => auditClockFailureService.correctData({ kind: 'subject', subjectId: 'audit-clock' }, { subjectId: 'audit-clock', requestId: 'audit-clock-correction', data: { value: 2 } }), 'STORE_FAILURE');
assert.deepEqual(auditClockStore.read('audit-clock').data, { value: 1 }, 'audit clock failure must not write corrected data');
assert.equal(auditClockFailureService.auditLog(operator).length, 0, 'audit clock failure must not persist an audit event');

const auditPersistenceService = new ComplianceService({ store: new InMemoryPrivacyDataStore([{ subjectId: 'audit-persistence', data: { value: 1 }, updatedAt: 1, retentionUntil: 10_000 }]), operatorToken: OPERATOR_TOKEN, now: () => 100 });
auditPersistenceService.audits.push = () => { throw new Error('audit persistence offline'); };
expectCode('audit persistence failure prevents correction side effects', () => auditPersistenceService.correctData({ kind: 'subject', subjectId: 'audit-persistence' }, { subjectId: 'audit-persistence', requestId: 'audit-persistence-correction', data: { value: 2 } }), 'STORE_FAILURE');
assert.deepEqual(auditPersistenceService.store.read('audit-persistence').data, { value: 1 }, 'audit persistence failure must not write corrected data');

let purgeNow = 9;
const changingPurgeStore = new InMemoryPrivacyDataStore([{ subjectId: 'purge-changing-time', data: { safe: true }, updatedAt: 1, retentionUntil: 10 }]);
const changingPurgeService = new ComplianceService({ store: changingPurgeStore, operatorToken: OPERATOR_TOKEN, now: () => purgeNow });
assert.equal(changingPurgeService.purgeExpired(operator, 'purge-changing-time').purgedSubjects, 0);
purgeNow = 10;
assert.equal(changingPurgeService.purgeExpired(operator, 'purge-changing-time').replayed, true, 'purge replay must remain idempotent when time changes');
assert.equal(changingPurgeStore.list().length, 1, 'stable purge replay must not apply a second time-dependent purge');

console.log(`T264 privacy compliance PASS: consent, age-gate, access, deterministic-export, correction, deletion, retention, audit-redaction, permission-isolation, sensitive-fields, idempotency, invalid-input and fail-closed=${audit.length}`);
