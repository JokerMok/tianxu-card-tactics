export const PRIVACY_SCHEMA_VERSION = 1 as const;
export const PRIVACY_POLICY_VERSION = 'privacy-v1' as const;
export const PRIVACY_PURPOSES = Object.freeze(['analytics', 'personalization', 'marketing'] as const);
export type PrivacyPurpose = typeof PRIVACY_PURPOSES[number];
export const PRIVACY_AGE_STATUSES = Object.freeze(['unknown', 'adult', 'minor'] as const);
export type PrivacyAgeStatus = typeof PRIVACY_AGE_STATUSES[number];
export const PRIVACY_CONSENT_SOURCES = Object.freeze(['settings', 'onboarding', 'platform', 'support'] as const);
export type PrivacyConsentSource = typeof PRIVACY_CONSENT_SOURCES[number];

export type PrivacyJson = null | boolean | number | string | PrivacyJson[] | { [key: string]: PrivacyJson };
export type PrivacyJsonObject = { [key: string]: PrivacyJson };

export interface PrivacyDataRecord {
  readonly subjectId: string;
  readonly data: PrivacyJsonObject;
  readonly updatedAt: number;
  readonly retentionUntil: number;
}

export interface PrivacyDataStore {
  read(subjectId: string): PrivacyDataRecord | null;
  replace(record: PrivacyDataRecord): void;
  remove(subjectId: string): PrivacyDataRecord | null | void;
  list(): readonly PrivacyDataRecord[];
  purgeExpired?(now: number): readonly PrivacyDataRecord[];
  withTransaction?<T>(action: () => T): T;
}

export interface PrivacyActorSubject { readonly kind: 'subject'; readonly subjectId: string; }
export interface PrivacyActorOperator { readonly kind: 'operator'; readonly token: string; }
export type PrivacyActor = PrivacyActorSubject | PrivacyActorOperator;

export interface ConsentRecord {
  readonly subjectId: string;
  readonly purpose: PrivacyPurpose;
  readonly granted: boolean;
  readonly policyVersion: string;
  readonly source: PrivacyConsentSource;
  readonly recordedAt: number;
  readonly requestId: string;
}

export interface ConsentRequest {
  readonly subjectId: string;
  readonly purpose: PrivacyPurpose;
  readonly granted: boolean;
  readonly policyVersion: string;
  readonly source: PrivacyConsentSource;
  readonly requestId: string;
}

export interface AgeStatusRecord {
  readonly subjectId: string;
  readonly status: PrivacyAgeStatus;
  readonly guardianVerified: boolean;
  readonly recordedAt: number;
  readonly requestId: string;
}

export interface AgeStatusRequest {
  readonly subjectId: string;
  readonly status: Exclude<PrivacyAgeStatus, 'unknown'>;
  readonly guardianVerified: boolean;
  readonly requestId: string;
}

export interface SubjectRequest {
  readonly subjectId: string;
  readonly requestId: string;
}

export interface CorrectionRequest extends SubjectRequest {
  readonly data: PrivacyJsonObject;
}

export interface PrivacyAccessResult {
  readonly accepted: true;
  readonly replayed: boolean;
  readonly requestId: string;
  readonly subjectId: string;
  readonly data: PrivacyJsonObject;
  readonly updatedAt: number;
  readonly retentionUntil: number;
  readonly sensitiveFieldCount: number;
}

export interface PrivacyExportResult {
  readonly accepted: true;
  readonly replayed: boolean;
  readonly requestId: string;
  readonly subjectId: string;
  readonly format: 'application/json';
  readonly content: string;
}

export interface PrivacyDeleteResult {
  readonly accepted: true;
  readonly replayed: boolean;
  readonly requestId: string;
  readonly subjectId: string;
  readonly deleted: true;
  readonly hadData: boolean;
}

export interface PrivacyCorrectionResult {
  readonly accepted: true;
  readonly replayed: boolean;
  readonly requestId: string;
  readonly subjectId: string;
  readonly corrected: true;
  readonly updatedAt: number;
  readonly retentionUntil: number;
}

export interface PrivacyPurgeResult {
  readonly accepted: true;
  readonly replayed: boolean;
  readonly requestId: string;
  readonly purgedSubjects: number;
  readonly purgedAuditEvents: number;
}

export type PrivacyAuditAction = 'consent' | 'age_status' | 'access' | 'export' | 'correct' | 'delete' | 'retention_purge' | 'store_quarantine';
export interface PrivacyAuditEvent {
  readonly sequence: number;
  readonly action: PrivacyAuditAction;
  readonly subjectKey: string;
  readonly requestId: string;
  readonly occurredAt: number;
  readonly outcome: 'accepted' | 'rejected';
  readonly reasonCode?: string;
  readonly sensitiveFieldCount?: number;
}

export type PrivacyErrorCode =
  | 'INVALID_REQUEST'
  | 'INVALID_INPUT'
  | 'PERMISSION_DENIED'
  | 'REQUEST_ID_REUSED'
  | 'SUBJECT_NOT_FOUND'
  | 'SUBJECT_EXPIRED'
  | 'POLICY_VERSION_MISMATCH'
  | 'STORE_FAILURE';

export class PrivacyComplianceError extends Error {
  readonly code: PrivacyErrorCode;
  readonly recordable: boolean;
  constructor(code: PrivacyErrorCode, message: string, recordable = true) {
    super(message);
    this.name = 'PrivacyComplianceError';
    this.code = code;
    this.recordable = recordable;
  }
}

export interface PrivacyComplianceOptions {
  readonly store: PrivacyDataStore;
  readonly operatorToken: string;
  readonly now?: () => number;
  readonly policyVersion?: string;
  readonly auditRetentionMs?: number;
}

interface LedgerSuccess { readonly kind: 'success'; readonly operation: string; readonly subjectKey: string; readonly fingerprint: string; readonly result: PrivacyJsonObject; }
interface LedgerFailure { readonly kind: 'failure'; readonly operation: string; readonly subjectKey: string; readonly fingerprint: string; readonly code: PrivacyErrorCode; readonly message: string; }
type LedgerEntry = LedgerSuccess | LedgerFailure;
interface AuditSpec {
  readonly action: PrivacyAuditAction;
  readonly subjectId: string;
  readonly requestId: string;
  readonly outcome: 'accepted' | 'rejected';
  readonly reasonCode?: string;
  readonly sensitiveFieldCount?: number;
  readonly occurredAt?: number;
}

interface PrivacyServiceSnapshot {
  readonly consents: readonly (readonly [string, readonly (readonly [PrivacyPurpose, ConsentRecord])[]])[];
  readonly ages: readonly (readonly [string, AgeStatusRecord])[];
  readonly ledger: readonly (readonly [string, LedgerEntry])[];
  readonly audits: readonly PrivacyAuditEvent[];
  readonly auditSequence: number;
}

const PURPOSE_SET = new Set<string>(PRIVACY_PURPOSES);
const SOURCE_SET = new Set<string>(PRIVACY_CONSENT_SOURCES);
const AGE_STATUS_SET = new Set<string>(PRIVACY_AGE_STATUSES);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9\s().-]{7,}$/;
const SENSITIVE_KEYS = new Set([
  'email', 'emailaddress', 'phone', 'phonenumber', 'mobile', 'mobilenumber', 'address', 'streetaddress', 'name', 'nickname',
  'realname', 'userid', 'accountid', 'playerid', 'deviceid', 'ip', 'advertisingid', 'idfa', 'gaid', 'dob', 'dateofbirth',
  'birthdate', 'socialsecuritynumber', 'ssn', 'creditcard', 'creditcardnumber', 'cardnumber', 'bankaccount', 'bankaccountnumber',
  'health', 'medical', 'biometric', 'location', 'geolocation', 'child', 'minor',
]);
const FORBIDDEN_CREDENTIAL_KEYS = new Set([
  'password', 'passwd', 'token', 'accesstoken', 'refreshtoken', 'secret', 'apikey', 'authorization', 'cookie', 'cvv', 'cvc', 'securitycode',
]);

function fail(code: PrivacyErrorCode, message: string, recordable = true): never { throw new PrivacyComplianceError(code, message, recordable); }
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function normalizedKey(key: string): string { return key.replace(/[^a-z0-9]/gi, '').toLowerCase(); }
function validateText(value: unknown, label: string, maxLength = 160): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value !== value.trim() || CONTROL_CHARACTERS.test(value)) fail('INVALID_INPUT', `${label} is invalid`);
}
function validateSubjectId(value: unknown): asserts value is string {
  validateText(value, 'subjectId', 128);
  if (EMAIL.test(value) || PHONE.test(value)) fail('INVALID_INPUT', 'subjectId must be an opaque identifier');
}
function validateRequestId(value: unknown): asserts value is string {
  validateText(value, 'requestId', 128);
  if (EMAIL.test(value) || PHONE.test(value)) fail('INVALID_INPUT', 'requestId must not contain personal contact data');
}
function validateJson(value: unknown, label: string, depth = 0, seen = new Set<object>()): asserts value is PrivacyJson {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail('INVALID_INPUT', `${label} must be a safe integer`); return; }
  if (typeof value === 'string') { if (value.length > 4096 || CONTROL_CHARACTERS.test(value)) fail('INVALID_INPUT', `${label} is invalid`); return; }
  if (typeof value !== 'object' || seen.has(value)) fail('INVALID_INPUT', `${label} must be acyclic JSON data`);
  if (depth > 8) fail('INVALID_INPUT', `${label} is nested too deeply`);
  seen.add(value);
  try {
    if (Array.isArray(value)) { if (value.length > 256) fail('INVALID_INPUT', `${label} has too many items`); value.forEach((item, index) => validateJson(item, `${label}[${index}]`, depth + 1, seen)); return; }
    if (!isPlainRecord(value)) fail('INVALID_INPUT', `${label} must be a plain object`);
    if (Object.keys(value).length > 256) fail('INVALID_INPUT', `${label} has too many fields`);
    for (const [key, child] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('INVALID_INPUT', `${label}.${key} is not allowed`);
      if (FORBIDDEN_CREDENTIAL_KEYS.has(normalizedKey(key))) fail('INVALID_INPUT', `${label}.${key} must not contain credentials`);
      validateJson(child, `${label}.${key}`, depth + 1, seen);
    }
  } finally { seen.delete(value); }
}
function validateData(value: unknown, label = 'data'): asserts value is PrivacyJsonObject {
  validateJson(value, label);
  if (!isPlainRecord(value)) fail('INVALID_INPUT', `${label} must be a plain object`);
}
function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clone(child)])) as T;
  return value;
}
function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  return value;
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isPlainRecord(value)) return value;
  return Object.keys(value).sort().reduce((result, key) => { result[key] = canonicalize(value[key]); return result; }, Object.create(null) as Record<string, unknown>);
}
export function canonicalPrivacyJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}
function hash(value: string): string {
  let left = 2_166_136_261; let right = 2_654_435_761;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    left = Math.imul(left ^ code, 16_777_619) >>> 0;
    right = Math.imul(right ^ (code + index), 2_246_822_519) >>> 0;
  }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}
function subjectKey(subjectId: string): string { return `sub_${hash(subjectId)}`; }
function countSensitiveFields(value: unknown, seen = new Set<object>()): number {
  if (value === null || typeof value !== 'object' || seen.has(value)) return 0;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.reduce((total, item) => total + countSensitiveFields(item, seen), 0);
    return Object.entries(value).reduce((total, [key, child]) => total + (SENSITIVE_KEYS.has(normalizedKey(key)) ? 1 : 0) + countSensitiveFields(child, seen), 0);
  } finally { seen.delete(value); }
}
function safeRecord(record: unknown): PrivacyDataRecord {
  if (!isPlainRecord(record)) fail('STORE_FAILURE', 'privacy store returned an invalid record', false);
  validateSubjectId(record.subjectId);
  validateData(record.data);
  if (!Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0 || !Number.isSafeInteger(record.retentionUntil) || record.retentionUntil < record.updatedAt) fail('STORE_FAILURE', 'privacy store returned invalid timestamps', false);
  return freeze({ subjectId: record.subjectId, data: clone(record.data), updatedAt: record.updatedAt, retentionUntil: record.retentionUntil });
}
function safeStoreRecord(record: unknown): PrivacyDataRecord {
  try { return safeRecord(record); } catch (error) { if (error instanceof PrivacyComplianceError && error.code === 'STORE_FAILURE') throw error; throw new PrivacyComplianceError('STORE_FAILURE', 'privacy store returned an invalid record', false); }
}
function safeActor(actor: unknown): asserts actor is PrivacyActor {
  if (!isPlainRecord(actor) || (actor.kind !== 'subject' && actor.kind !== 'operator')) fail('PERMISSION_DENIED', 'actor is invalid');
  if (actor.kind === 'subject') validateSubjectId(actor.subjectId);
  else validateText(actor.token, 'operator token', 256);
}

export class InMemoryPrivacyDataStore implements PrivacyDataStore {
  private readonly records = new Map<string, PrivacyDataRecord>();
  constructor(initial: readonly PrivacyDataRecord[] = []) { for (const record of initial) this.replace(record); }
  read(subjectId: string): PrivacyDataRecord | null { const record = this.records.get(subjectId); return record ? clone(record) : null; }
  replace(record: PrivacyDataRecord): void { const safe = safeRecord(record); this.records.set(safe.subjectId, clone(safe)); }
  remove(subjectId: string): PrivacyDataRecord | null { const previous = this.records.get(subjectId); this.records.delete(subjectId); return previous ? clone(previous) : null; }
  list(): readonly PrivacyDataRecord[] { return [...this.records.values()].map((record) => clone(record)); }
  withTransaction<T>(action: () => T): T { return action(); }
  purgeExpired(now: number): readonly PrivacyDataRecord[] {
    const removed: PrivacyDataRecord[] = [];
    for (const record of this.records.values()) if (record.retentionUntil <= now) { removed.push(clone(record)); this.records.delete(record.subjectId); }
    return removed;
  }
}

export class PrivacyComplianceService {
  private readonly store: PrivacyDataStore;
  private readonly operatorToken: string;
  private readonly clock: () => number;
  private readonly policyVersion: string;
  private readonly auditRetentionMs: number;
  private readonly consents = new Map<string, Map<PrivacyPurpose, ConsentRecord>>();
  private readonly ages = new Map<string, AgeStatusRecord>();
  private readonly ledger = new Map<string, LedgerEntry>();
  private readonly audits: PrivacyAuditEvent[] = [];
  private auditSequence = 0;
  private observedNow: number | undefined;
  private quarantined = false;

  constructor(options: PrivacyComplianceOptions) {
    if (!options || !options.store || typeof options.store.read !== 'function' || typeof options.store.replace !== 'function' || typeof options.store.remove !== 'function' || typeof options.store.list !== 'function') fail('STORE_FAILURE', 'privacy store is incomplete', false);
    validateText(options.operatorToken, 'operator token', 256);
    this.store = options.store; this.operatorToken = options.operatorToken; this.clock = options.now ?? (() => Date.now());
    this.policyVersion = options.policyVersion ?? PRIVACY_POLICY_VERSION;
    validateText(this.policyVersion, 'policyVersion', 64);
    this.auditRetentionMs = options.auditRetentionMs ?? 31_536_000_000;
    if (!Number.isSafeInteger(this.auditRetentionMs) || this.auditRetentionMs < 0) fail('INVALID_INPUT', 'auditRetentionMs is invalid');
  }

  recordConsent(actor: PrivacyActor, request: ConsentRequest): ConsentRecord & { readonly accepted: true; readonly replayed: boolean } {
    safeActor(actor); this.validateConsentRequest(request); this.authorize(actor, request.subjectId);
    return this.runRequest('consent', request.requestId, request.subjectId, request, () => {
      const record = freeze({ subjectId: request.subjectId, purpose: request.purpose, granted: request.granted, policyVersion: request.policyVersion, source: request.source, recordedAt: this.now(), requestId: request.requestId });
      const subjectConsents = this.consents.get(request.subjectId) ?? new Map<PrivacyPurpose, ConsentRecord>();
      const previous = subjectConsents.get(request.purpose);
      return this.withAudit({ action: 'consent', subjectId: request.subjectId, requestId: request.requestId, outcome: 'accepted', sensitiveFieldCount: 0 }, () => {
        subjectConsents.set(request.purpose, record); this.consents.set(request.subjectId, subjectConsents);
        return { accepted: true, replayed: false, ...record };
      }, () => {
        if (previous) subjectConsents.set(request.purpose, previous); else subjectConsents.delete(request.purpose);
        if (subjectConsents.size === 0) this.consents.delete(request.subjectId); else this.consents.set(request.subjectId, subjectConsents);
      });
    });
  }

  getConsent(actor: PrivacyActor, subjectId: string, purpose?: PrivacyPurpose): readonly ConsentRecord[] {
    safeActor(actor); validateSubjectId(subjectId); if (purpose !== undefined && !PURPOSE_SET.has(purpose)) fail('INVALID_INPUT', 'purpose is invalid'); this.authorize(actor, subjectId);
    const subjectConsents = this.consents.get(subjectId);
    const records = purpose === undefined ? [...(subjectConsents?.values() ?? [])] : (subjectConsents?.get(purpose) ? [subjectConsents.get(purpose) as ConsentRecord] : []);
    return freeze(records.map((record) => clone(record)));
  }

  canProcess(subjectId: string, purpose: PrivacyPurpose): boolean {
    validateSubjectId(subjectId); if (!PURPOSE_SET.has(purpose)) fail('INVALID_INPUT', 'purpose is invalid');
    const consent = this.consents.get(subjectId)?.get(purpose); if (!consent?.granted) return false;
    const age = this.ages.get(subjectId); if (!age || age.status === 'unknown') return false;
    if (age.status === 'minor') return purpose === 'analytics' && age.guardianVerified;
    return true;
  }

  setAgeStatus(actor: PrivacyActor, request: AgeStatusRequest): AgeStatusRecord & { readonly accepted: true; readonly replayed: boolean } {
    safeActor(actor); this.validateAgeRequest(request); if (actor.kind !== 'operator' || actor.token !== this.operatorToken) fail('PERMISSION_DENIED', 'only an authorized operator may set age status');
    return this.runRequest('age_status', request.requestId, request.subjectId, request, () => {
      const record = freeze({ subjectId: request.subjectId, status: request.status, guardianVerified: request.guardianVerified, recordedAt: this.now(), requestId: request.requestId });
      const previous = this.ages.get(request.subjectId);
      return this.withAudit({ action: 'age_status', subjectId: request.subjectId, requestId: request.requestId, outcome: 'accepted', sensitiveFieldCount: 0 }, () => {
        this.ages.set(request.subjectId, record);
        return { accepted: true, replayed: false, ...record };
      }, () => {
        if (previous) this.ages.set(request.subjectId, previous); else this.ages.delete(request.subjectId);
      });
    });
  }

  getAgeStatus(actor: PrivacyActor, subjectId: string): AgeStatusRecord {
    safeActor(actor); validateSubjectId(subjectId); this.authorize(actor, subjectId);
    return clone(this.ages.get(subjectId) ?? { subjectId, status: 'unknown', guardianVerified: false, recordedAt: 0, requestId: 'none' });
  }

  accessData(actor: PrivacyActor, request: SubjectRequest): PrivacyAccessResult {
    safeActor(actor); this.validateSubjectRequest(request); this.authorize(actor, request.subjectId);
    return this.runRequest('access', request.requestId, request.subjectId, request, () => {
      this.ensureOperational();
      const trustedNow = this.now();
      return this.withStoreBoundary(trustedNow, () => {
        const record = this.readLiveRecord(request.subjectId, trustedNow);
        const result = { accepted: true, replayed: false, requestId: request.requestId, subjectId: record.subjectId, data: clone(record.data), updatedAt: record.updatedAt, retentionUntil: record.retentionUntil, sensitiveFieldCount: countSensitiveFields(record.data) } as const;
        return this.withAudit({ action: 'access', subjectId: request.subjectId, requestId: request.requestId, outcome: 'accepted', sensitiveFieldCount: result.sensitiveFieldCount, occurredAt: trustedNow }, () => result);
      });
    }, () => {
      this.ensureOperational();
      const trustedNow = this.now();
      this.withStoreBoundary(trustedNow, () => { this.readLiveRecord(request.subjectId, trustedNow); });
    });
  }

  exportData(actor: PrivacyActor, request: SubjectRequest): PrivacyExportResult {
    safeActor(actor); this.validateSubjectRequest(request); this.authorize(actor, request.subjectId);
    return this.runRequest('export', request.requestId, request.subjectId, request, () => {
      this.ensureOperational();
      const trustedNow = this.now();
      return this.withStoreBoundary(trustedNow, () => {
        const record = this.readLiveRecord(request.subjectId, trustedNow);
        const content = canonicalPrivacyJson({ schemaVersion: PRIVACY_SCHEMA_VERSION, subjectId: record.subjectId, data: record.data, updatedAt: record.updatedAt, retentionUntil: record.retentionUntil });
        return this.withAudit({ action: 'export', subjectId: request.subjectId, requestId: request.requestId, outcome: 'accepted', sensitiveFieldCount: countSensitiveFields(record.data), occurredAt: trustedNow }, () => ({ accepted: true, replayed: false, requestId: request.requestId, subjectId: request.subjectId, format: 'application/json', content }));
      });
    }, () => {
      this.ensureOperational();
      const trustedNow = this.now();
      this.withStoreBoundary(trustedNow, () => { this.readLiveRecord(request.subjectId, trustedNow); });
    });
  }

  correctData(actor: PrivacyActor, request: CorrectionRequest): PrivacyCorrectionResult {
    safeActor(actor); this.validateCorrectionRequest(request); this.authorize(actor, request.subjectId);
    return this.runRequest('correct', request.requestId, request.subjectId, request, () => {
      this.ensureOperational();
      return this.withMutationBoundary((before, trustedNow) => {
        const current = this.readStoredRecord(request.subjectId);
        this.assertTargetMatchesSnapshot(before, request.subjectId, current, 'correction');
        if (current === null) fail('SUBJECT_NOT_FOUND', 'subject data is not available');
        this.assertStoreSnapshot(before, 'privacy store changed while reading the correction target');
        if (trustedNow >= current.retentionUntil) fail('SUBJECT_EXPIRED', 'subject data retention has expired');
        const updatedAt = trustedNow;
        const result = { accepted: true, replayed: false, requestId: request.requestId, subjectId: request.subjectId, corrected: true, updatedAt, retentionUntil: current.retentionUntil } as const;
        const replacement = { subjectId: request.subjectId, data: clone(request.data), updatedAt, retentionUntil: current.retentionUntil };
        const expected = before.map((record) => record.subjectId === request.subjectId ? replacement : record);
        return this.withAudit({ action: 'correct', subjectId: request.subjectId, requestId: request.requestId, outcome: 'accepted', sensitiveFieldCount: countSensitiveFields(request.data), occurredAt: trustedNow }, () => {
          try { this.store.replace(replacement); } catch { throw new PrivacyComplianceError('STORE_FAILURE', 'privacy store replace failed', false); }
          this.assertStoreSnapshot(expected, 'privacy store replace changed the storage snapshot');
          const stored = this.readStoredRecord(request.subjectId);
          if (!stored || canonicalPrivacyJson(stored) !== canonicalPrivacyJson(replacement)) this.failStore('STORE_SNAPSHOT_MISMATCH', 'privacy store replace was not verified');
          this.assertStoreSnapshot(expected, 'privacy store changed while verifying the correction');
          return result;
        }, () => {
          this.restoreStoreSnapshot(before);
        });
      });
    });
  }

  deleteData(actor: PrivacyActor, request: SubjectRequest): PrivacyDeleteResult {
    safeActor(actor); this.validateSubjectRequest(request); this.authorize(actor, request.subjectId);
    return this.runRequest('delete', request.requestId, request.subjectId, request, () => {
      this.ensureOperational();
      return this.withGlobalStoreSnapshot((before) => {
        const current = this.readStoredRecord(request.subjectId);
        this.assertTargetMatchesSnapshot(before, request.subjectId, current, 'deletion');
        this.assertStoreSnapshot(before, 'privacy store changed while reading the deletion target');
        const hadData = current !== null;
        const previousConsent = this.consents.get(request.subjectId); const previousAge = this.ages.get(request.subjectId); const previousLedger = [...this.ledger.entries()];
        const result = { accepted: true, replayed: false, requestId: request.requestId, subjectId: request.subjectId, deleted: true, hadData } as const;
        return this.withAudit({ action: 'delete', subjectId: request.subjectId, requestId: request.requestId, outcome: 'accepted', sensitiveFieldCount: 0 }, () => {
          try { this.store.remove(request.subjectId); } catch { throw new PrivacyComplianceError('STORE_FAILURE', 'privacy store remove failed', false); }
          const expected = before.filter((record) => record.subjectId !== request.subjectId);
          this.assertStoreSnapshot(expected, 'privacy store remove changed the storage snapshot');
          if (this.readStoredRecord(request.subjectId) !== null) this.failStore('STORE_SNAPSHOT_MISMATCH', 'privacy store remove was not verified');
          this.assertStoreSnapshot(expected, 'privacy store changed while verifying the deletion');
          this.consents.delete(request.subjectId); this.ages.delete(request.subjectId); this.removeReplayableSubjectResults(request.subjectId);
          return result;
        }, () => {
          this.restoreStoreSnapshot(before);
          if (previousConsent) this.consents.set(request.subjectId, previousConsent); else this.consents.delete(request.subjectId);
          if (previousAge) this.ages.set(request.subjectId, previousAge); else this.ages.delete(request.subjectId);
          this.ledger.clear(); for (const [requestId, entry] of previousLedger) this.ledger.set(requestId, entry);
        });
      });
    });
  }

  purgeExpired(actor: PrivacyActor, requestId: string): PrivacyPurgeResult {
    safeActor(actor); validateRequestId(requestId); if (actor.kind !== 'operator' || actor.token !== this.operatorToken) fail('PERMISSION_DENIED', 'only an authorized operator may purge retention data');
    return this.runRequest('retention_purge', requestId, '__retention__', { requestId }, () => {
      this.ensureOperational();
      return this.withMutationBoundary((records, now) => {
        const expired = records.filter((record) => record.retentionUntil <= now);
        const unexpired = records.filter((record) => record.retentionUntil > now);
        const expiredBySubject = new Map(expired.map((record) => [record.subjectId, record] as const));
        const previousConsents = new Map(expired.map((record) => [record.subjectId, this.consents.get(record.subjectId)] as const));
        const previousAges = new Map(expired.map((record) => [record.subjectId, this.ages.get(record.subjectId)] as const));
        const previousLedger = [...this.ledger.entries()];
        const specs = expired.map((record) => ({ action: 'retention_purge' as const, subjectId: record.subjectId, requestId, outcome: 'accepted' as const, sensitiveFieldCount: 0, occurredAt: now }));
        return this.withAudits(specs, () => {
          try {
            if (this.store.purgeExpired) {
              const removed = this.store.purgeExpired(now);
              if (!Array.isArray(removed)) this.failStore('STORE_PURGE_INVALID', 'privacy retention purge returned an invalid result');
              let removedRecords: PrivacyDataRecord[];
              try { removedRecords = removed.map(safeStoreRecord); } catch { this.failStore('STORE_PURGE_INVALID', 'privacy retention purge returned invalid records'); }
              const expiredKeys = new Set(expired.map((record) => record.subjectId));
              const removedKeys = new Set<string>();
              for (const record of removedRecords) {
                const expected = expiredBySubject.get(record.subjectId);
                if (!expected || removedKeys.has(record.subjectId) || canonicalPrivacyJson(record) !== canonicalPrivacyJson(expected)) this.failStore('STORE_SNAPSHOT_MISMATCH', 'privacy retention purge returned a changed or unexpected record');
                removedKeys.add(record.subjectId);
              }
              if (removedKeys.size !== expiredKeys.size) this.failStore('STORE_SNAPSHOT_MISMATCH', 'privacy retention purge did not return the complete expired snapshot');
            } else {
              for (const record of expired) {
                const current = this.readStoredRecord(record.subjectId);
                if (!current || canonicalPrivacyJson(current) !== canonicalPrivacyJson(record)) this.failStore('STORE_SNAPSHOT_MISMATCH', 'privacy retention purge changed an expired record before deletion');
                let removed: PrivacyDataRecord | null | void;
                try { removed = this.store.remove(record.subjectId); } catch { throw new PrivacyComplianceError('STORE_FAILURE', 'privacy store remove failed', false); }
                if (removed === undefined) this.failStore('STORE_PURGE_UNVERIFIABLE', 'privacy retention purge could not verify the removed record');
                const removedRecord = removed === null ? null : safeStoreRecord(removed);
                if (!removedRecord || canonicalPrivacyJson(removedRecord) !== canonicalPrivacyJson(record)) this.failStore('STORE_SNAPSHOT_MISMATCH', 'privacy retention purge removed a changed or unexpected record');
              }
            }
            const expected = unexpired;
            this.assertStoreSnapshot(expected, 'privacy retention purge changed the storage snapshot');
            for (const record of unexpired) {
              const readBack = this.readStoredRecord(record.subjectId);
              if (!readBack || readBack.subjectId !== record.subjectId || canonicalPrivacyJson(readBack) !== canonicalPrivacyJson(record)) this.failStore('STORE_SNAPSHOT_MISMATCH', 'privacy retention purge failed to preserve unexpired data');
              this.assertStoreSnapshot(expected, 'privacy retention purge changed the storage snapshot while verifying unexpired data');
            }
            for (const record of expired) if (this.readStoredRecord(record.subjectId) !== null) this.failStore('STORE_SNAPSHOT_MISMATCH', 'privacy retention purge was not verified');
            this.assertStoreSnapshot(expected, 'privacy retention purge changed the storage snapshot while verifying expired data');
          } catch { throw new PrivacyComplianceError('STORE_FAILURE', 'privacy retention purge failed', false); }
          for (const record of expired) { this.consents.delete(record.subjectId); this.ages.delete(record.subjectId); this.removeReplayableSubjectResults(record.subjectId); }
          const purgedAuditEvents = this.pruneAudits(now); return { accepted: true, replayed: false, requestId, purgedSubjects: expired.length, purgedAuditEvents };
        }, () => {
          this.restoreStoreSnapshot(records);
          for (const record of expired) {
            const consent = previousConsents.get(record.subjectId); const age = previousAges.get(record.subjectId);
            if (consent) this.consents.set(record.subjectId, consent); else this.consents.delete(record.subjectId);
            if (age) this.ages.set(record.subjectId, age); else this.ages.delete(record.subjectId);
          }
          this.ledger.clear(); for (const [ledgerRequestId, entry] of previousLedger) this.ledger.set(ledgerRequestId, entry);
        });
      });
    });
  }

  auditLog(actor: PrivacyActor): readonly PrivacyAuditEvent[] {
    safeActor(actor); if (actor.kind !== 'operator' || actor.token !== this.operatorToken) fail('PERMISSION_DENIED', 'only an authorized operator may read the audit log');
    return freeze(this.audits.map((event) => clone(event)));
  }

  private now(): number {
    this.ensureOperational();
    let value: unknown;
    try { value = this.clock(); } catch { return this.failStore('CLOCK_UNAVAILABLE', 'trusted clock read failed'); }
    if (!Number.isSafeInteger(value) || value < 0) return this.failStore('CLOCK_INVALID', 'trusted clock returned an invalid timestamp');
    if (this.observedNow !== undefined && value < this.observedNow) this.failStore('CLOCK_ROLLBACK', 'trusted clock moved backwards');
    this.observedNow = value;
    return value;
  }
  private ensureOperational(): void {
    if (this.quarantined) fail('STORE_FAILURE', 'privacy service is quarantined', false);
  }
  private failStore(reason: string, message: string): never {
    if (!this.quarantined) {
      this.quarantined = true;
      try {
        this.appendAudit({ action: 'store_quarantine', subjectId: '__service__', requestId: `quarantine-${reason}`, outcome: 'rejected', reasonCode: `STORE_QUARANTINED:${reason}`, occurredAt: this.observedNow ?? 0 });
      } catch { /* quarantine remains fail-closed even if audit persistence is unavailable */ }
    }
    throw new PrivacyComplianceError('STORE_FAILURE', message, false);
  }
  private withStoreBoundary<T>(trustedNow: number, action: () => T): T {
    const transaction = this.store.withTransaction;
    let result!: T;
    try {
      result = typeof transaction === 'function' ? transaction.call(this.store, action) : action();
    } finally {
      const afterNow = this.now();
      if (afterNow !== trustedNow) this.failStore('CLOCK_CHANGED_DURING_OPERATION', 'trusted time changed during privacy read');
    }
    return result;
  }
  private withGlobalStoreSnapshot<T>(action: (before: readonly PrivacyDataRecord[]) => T, afterTransaction: () => void = () => undefined): T {
    const serviceBefore = this.captureServiceSnapshot();
    let before: readonly PrivacyDataRecord[] | undefined;
    const execute = () => {
      before = this.listStoredRecords();
      return action(before);
    };
    try {
      const transaction = this.store.withTransaction;
      const result = typeof transaction === 'function' ? transaction.call(this.store, execute) : execute();
      afterTransaction();
      return result;
    } catch (error) {
      let rollbackFailure: unknown;
      if (before) try { this.restoreStoreSnapshot(before); } catch (failure) { rollbackFailure = failure; }
      try { this.restoreServiceSnapshot(serviceBefore); } catch (failure) { rollbackFailure ??= failure; }
      if (rollbackFailure) this.failStore('STORE_ROLLBACK_FAILED', 'privacy transaction rollback failed; store is quarantined');
      if (error instanceof PrivacyComplianceError) throw error;
      this.failStore('STORE_TRANSACTION_FAILED', 'privacy store transaction failed');
    }
  }
  private withMutationBoundary<T>(action: (before: readonly PrivacyDataRecord[], trustedNow: number) => T): T {
    const trustedNow = this.now();
    return this.withGlobalStoreSnapshot((before) => action(before, trustedNow), () => {
      const afterNow = this.now();
      if (afterNow !== trustedNow) this.failStore('CLOCK_CHANGED_DURING_MUTATION', 'trusted time changed while finalizing privacy mutation');
    });
  }
  private assertTargetMatchesSnapshot(snapshot: readonly PrivacyDataRecord[], subjectId: string, current: PrivacyDataRecord | null, operation: string): void {
    const expected = snapshot.find((record) => record.subjectId === subjectId);
    if ((expected === undefined) !== (current === null) || (expected && current && canonicalPrivacyJson(expected) !== canonicalPrivacyJson(current))) this.failStore('STORE_SNAPSHOT_MISMATCH', `privacy store changed while reading the ${operation} target`);
  }
  private assertStoreSnapshot(expected: readonly PrivacyDataRecord[], message: string): void {
    const actual = this.listStoredRecords();
    if (!this.sameStoreSnapshot(actual, expected)) this.failStore('STORE_SNAPSHOT_MISMATCH', message);
  }
  private authorize(actor: PrivacyActor, subjectId: string): void {
    if (actor.kind === 'subject' && actor.subjectId !== subjectId) fail('PERMISSION_DENIED', 'subject may access only its own data');
    if (actor.kind === 'operator' && actor.token !== this.operatorToken) fail('PERMISSION_DENIED', 'operator credential is invalid');
  }
  private readStoredRecord(subjectId: string): PrivacyDataRecord | null {
    let raw: PrivacyDataRecord | null;
    try { raw = this.store.read(subjectId); } catch { return this.failStore('STORE_READ_FAILED', 'privacy store read failed'); }
    if (raw === null) return null;
    let record: PrivacyDataRecord;
    try { record = safeStoreRecord(raw); } catch { return this.failStore('STORE_RECORD_INVALID', 'privacy store returned an invalid record'); }
    if (record.subjectId !== subjectId) return this.failStore('STORE_SUBJECT_MISMATCH', 'privacy store returned a record for another subject');
    return record;
  }
  private listStoredRecords(): readonly PrivacyDataRecord[] {
    let raw: unknown;
    try { raw = this.store.list(); } catch { return this.failStore('STORE_LIST_FAILED', 'privacy retention listing failed'); }
    if (!Array.isArray(raw)) return this.failStore('STORE_LIST_INVALID', 'privacy retention listing returned an invalid result');
    try {
      const records = raw.map(safeStoreRecord);
      const subjects = new Set<string>();
      for (const record of records) {
        if (subjects.has(record.subjectId)) fail('STORE_FAILURE', 'privacy store returned duplicate subjects', false);
        subjects.add(record.subjectId);
      }
      return records;
    } catch { return this.failStore('STORE_LIST_INVALID', 'privacy retention listing returned invalid records'); }
  }
  private sameStoreSnapshot(left: readonly PrivacyDataRecord[], right: readonly PrivacyDataRecord[]): boolean {
    if (left.length !== right.length) return false;
    const rightBySubject = new Map(right.map((record) => [record.subjectId, canonicalPrivacyJson(record)] as const));
    return left.every((record) => rightBySubject.get(record.subjectId) === canonicalPrivacyJson(record));
  }
  private captureServiceSnapshot(): PrivacyServiceSnapshot {
    return {
      consents: [...this.consents.entries()].map(([subjectId, subjectConsents]) => [subjectId, [...subjectConsents.entries()].map(([purpose, record]) => [purpose, clone(record)] as const)] as const),
      ages: [...this.ages.entries()].map(([subjectId, record]) => [subjectId, clone(record)] as const),
      ledger: [...this.ledger.entries()].map(([requestId, entry]) => [requestId, clone(entry)] as const),
      audits: this.audits.slice(),
      auditSequence: this.auditSequence,
    };
  }
  private restoreServiceSnapshot(snapshot: PrivacyServiceSnapshot): void {
    const quarantineEvents = this.audits.filter((event) => event.action === 'store_quarantine' && !snapshot.audits.includes(event));
    this.consents.clear();
    for (const [subjectId, entries] of snapshot.consents) this.consents.set(subjectId, new Map(entries.map(([purpose, record]) => [purpose, clone(record)] as const)));
    this.ages.clear();
    for (const [subjectId, record] of snapshot.ages) this.ages.set(subjectId, clone(record));
    this.ledger.clear();
    for (const [requestId, entry] of snapshot.ledger) this.ledger.set(requestId, clone(entry));
    this.audits.splice(0, this.audits.length, ...snapshot.audits);
    this.auditSequence = snapshot.auditSequence;
    for (const event of quarantineEvents) {
      const restored = freeze({ ...event, sequence: this.auditSequence + 1 });
      this.audits.push(restored);
      this.auditSequence = restored.sequence;
    }
  }
  private restoreStoreSnapshot(snapshot: readonly PrivacyDataRecord[]): void {
    let failure: unknown;
    let current: readonly PrivacyDataRecord[] = [];
    try { current = this.listStoredRecords(); } catch (error) { failure = error; }
    const expectedSubjects = new Set(snapshot.map((record) => record.subjectId));
    for (const record of current) {
      if (expectedSubjects.has(record.subjectId)) continue;
      try { this.store.remove(record.subjectId); } catch (error) { failure ??= error; }
    }
    for (const record of snapshot) {
      try { this.store.replace(record); } catch (error) { failure ??= error; }
    }
    try {
      const restored = this.listStoredRecords();
      if (!this.sameStoreSnapshot(restored, snapshot)) failure ??= new Error('privacy store snapshot could not be restored');
    } catch (error) { failure ??= error; }
    if (failure) this.failStore('STORE_ROLLBACK_FAILED', 'privacy store rollback failed; store is quarantined');
  }
  private readLiveRecord(subjectId: string, trustedNow = this.now()): PrivacyDataRecord {
    const record = this.readStoredRecord(subjectId); if (record === null) fail('SUBJECT_NOT_FOUND', 'subject data is not available');
    if (record.retentionUntil <= trustedNow) fail('SUBJECT_EXPIRED', 'subject data retention has expired'); return record;
  }
  private validateConsentRequest(request: unknown): asserts request is ConsentRequest {
    if (!isPlainRecord(request)) fail('INVALID_INPUT', 'consent request is invalid'); validateSubjectId(request.subjectId); validateRequestId(request.requestId);
    if (typeof request.purpose !== 'string' || !PURPOSE_SET.has(request.purpose)) fail('INVALID_INPUT', 'purpose is invalid');
    if (typeof request.granted !== 'boolean') fail('INVALID_INPUT', 'granted is invalid');
    if (typeof request.policyVersion !== 'string' || !this.policyVersion || request.policyVersion !== this.policyVersion) fail('POLICY_VERSION_MISMATCH', 'policy version is not current');
    if (typeof request.source !== 'string' || !SOURCE_SET.has(request.source)) fail('INVALID_INPUT', 'consent source is invalid');
  }
  private validateAgeRequest(request: unknown): asserts request is AgeStatusRequest {
    if (!isPlainRecord(request)) fail('INVALID_INPUT', 'age status request is invalid'); validateSubjectId(request.subjectId); validateRequestId(request.requestId);
    if (typeof request.status !== 'string' || !AGE_STATUS_SET.has(request.status) || request.status === 'unknown') fail('INVALID_INPUT', 'age status is invalid');
    if (typeof request.guardianVerified !== 'boolean') fail('INVALID_INPUT', 'guardianVerified is invalid');
    if (request.status === 'adult' && request.guardianVerified) fail('INVALID_INPUT', 'adult status cannot use guardian verification');
    if (request.status === 'minor' && !request.guardianVerified) fail('INVALID_INPUT', 'minor status requires guardian verification');
  }
  private validateSubjectRequest(request: unknown): asserts request is SubjectRequest { if (!isPlainRecord(request)) fail('INVALID_INPUT', 'subject request is invalid'); validateSubjectId(request.subjectId); validateRequestId(request.requestId); }
  private validateCorrectionRequest(request: unknown): asserts request is CorrectionRequest { this.validateSubjectRequest(request); validateData(request.data); }
  private runRequest<T extends PrivacyJsonObject>(operation: string, requestId: string, subjectId: string, payload: unknown, action: () => T, validateReplay?: () => void): T {
    this.ensureOperational();
    const fingerprint = hash(canonicalPrivacyJson({ operation, subjectId: subjectKey(subjectId), payload })); const existing = this.ledger.get(requestId);
    if (existing) {
      if (existing.operation !== operation || existing.subjectKey !== subjectKey(subjectId) || existing.fingerprint !== fingerprint) fail('REQUEST_ID_REUSED', 'requestId is already assigned to another request');
      if (existing.kind === 'failure') fail(existing.code, existing.message);
      validateReplay?.();
      return clone({ ...existing.result, replayed: true }) as T;
    }
    try {
      const result = action(); this.ledger.set(requestId, { kind: 'success', operation, subjectKey: subjectKey(subjectId), fingerprint, result: clone(result) }); return clone(result);
    } catch (error) {
      if (error instanceof PrivacyComplianceError && error.recordable) {
        this.audit(this.auditAction(operation), subjectId, requestId, 'rejected', error.code);
        this.ledger.set(requestId, { kind: 'failure', operation, subjectKey: subjectKey(subjectId), fingerprint, code: error.code, message: error.message });
      }
      if (error instanceof PrivacyComplianceError) throw error;
      throw new PrivacyComplianceError('STORE_FAILURE', 'privacy operation failed', false);
    }
  }
  private auditAction(operation: string): PrivacyAuditAction { return operation as PrivacyAuditAction; }
  private audit(action: PrivacyAuditAction, subjectId: string, requestId: string, outcome: 'accepted' | 'rejected', reasonCode?: string, sensitiveFieldCount?: number): PrivacyAuditEvent {
    return this.appendAudit({ action, subjectId, requestId, outcome, ...(reasonCode ? { reasonCode } : {}), ...(sensitiveFieldCount === undefined ? {} : { sensitiveFieldCount }) });
  }
  private appendAudit(spec: AuditSpec): PrivacyAuditEvent {
    const previousSequence = this.auditSequence;
    const event = freeze({ sequence: previousSequence + 1, action: spec.action, subjectKey: subjectKey(spec.subjectId), requestId: `req_${hash(spec.requestId)}`, occurredAt: spec.occurredAt ?? this.now(), outcome: spec.outcome, ...(spec.reasonCode ? { reasonCode: spec.reasonCode } : {}), ...(spec.sensitiveFieldCount === undefined ? {} : { sensitiveFieldCount: spec.sensitiveFieldCount }) });
    try { this.audits.push(event); this.auditSequence = event.sequence; return event; } catch {
      try { const index = this.audits.lastIndexOf(event); if (index >= 0) this.audits.splice(index, 1); } catch { /* preserve the fail-closed result */ }
      this.auditSequence = previousSequence;
      throw new PrivacyComplianceError('STORE_FAILURE', 'privacy audit persistence failed', false);
    }
  }
  private withAudit<T>(spec: AuditSpec, action: () => T, rollback: () => void = () => undefined): T {
    const event = this.appendAudit(spec); let started = false;
    try { started = true; return action(); } catch (error) {
      let rollbackError: unknown;
      if (started) try { rollback(); } catch (rollbackFailure) { rollbackError = rollbackFailure; }
      try { this.removeAudit(event); } catch (auditRollbackFailure) { rollbackError ??= auditRollbackFailure; }
      if (rollbackError) throw rollbackError;
      throw error;
    }
  }
  private withAudits<T>(specs: readonly AuditSpec[], action: () => T, rollback: () => void): T {
    const events: PrivacyAuditEvent[] = []; let started = false;
    try { for (const spec of specs) events.push(this.appendAudit(spec)); started = true; return action(); } catch (error) {
      let rollbackError: unknown;
      if (started) try { rollback(); } catch (rollbackFailure) { rollbackError = rollbackFailure; }
      for (const event of events.reverse()) try { this.removeAudit(event); } catch (auditRollbackFailure) { rollbackError ??= auditRollbackFailure; }
      if (rollbackError) throw rollbackError;
      throw error;
    }
  }
  private removeAudit(event: PrivacyAuditEvent): void {
    try {
      const index = this.audits.lastIndexOf(event); if (index < 0) throw new Error('audit event is missing');
      this.audits.splice(index, 1); if (this.auditSequence === event.sequence) this.auditSequence -= 1;
    } catch { throw new PrivacyComplianceError('STORE_FAILURE', 'privacy audit rollback failed', false); }
  }
  private pruneAudits(now: number): number {
    const before = this.audits.length; const kept = this.audits.filter((event) => event.occurredAt + this.auditRetentionMs > now); this.audits.splice(0, this.audits.length, ...kept); return before - kept.length;
  }
  private removeReplayableSubjectResults(subjectId: string): void {
    const key = subjectKey(subjectId); for (const [requestId, entry] of this.ledger) if (entry.subjectKey === key && entry.operation !== 'delete') this.ledger.delete(requestId);
  }
}

export const PrivacyService = PrivacyComplianceService;
export const ComplianceService = PrivacyComplianceService;
