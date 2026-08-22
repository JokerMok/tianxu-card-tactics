export const CONFIG_UPDATE_ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_BUNDLE: 'INVALID_BUNDLE',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  CLIENT_OUTDATED: 'CLIENT_OUTDATED',
  NOT_ELIGIBLE: 'NOT_ELIGIBLE',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  REQUEST_ID_REUSED: 'REQUEST_ID_REUSED',
  ACTIVATION_FAILED: 'ACTIVATION_FAILED',
  ROLLBACK_UNAVAILABLE: 'ROLLBACK_UNAVAILABLE',
  REENTRANT: 'REENTRANT',
  RUNTIME_INCONSISTENT: 'RUNTIME_INCONSISTENT',
} as const;

export type ConfigUpdateErrorCode = typeof CONFIG_UPDATE_ERROR_CODES[keyof typeof CONFIG_UPDATE_ERROR_CODES];
type ConfigOperation = 'apply' | 'rollback' | 'recover';
type ConfigAuditResult = 'accepted' | 'replayed' | 'rejected' | 'rolled_back' | 'recovered';

export class ConfigUpdateError extends Error {
  readonly code: ConfigUpdateErrorCode;

  constructor(code: ConfigUpdateErrorCode, message = code) {
    super(message);
    this.name = 'ConfigUpdateError';
    this.code = code;
  }
}

class ConfigReplayError extends ConfigUpdateError {
}

export interface ConfigBundle {
  bundleId: string;
  tenantId: string;
  configKey: string;
  version: string;
  minClientVersion: string;
  rolloutPercent: number;
  rolloutSalt: string;
  allowList?: readonly string[];
  denyList?: readonly string[];
  payload: Readonly<Record<string, unknown>>;
  keyId: string;
  signature: string;
  createdAt: number;
  expiresAt?: number;
}

export interface ConfigSignatureVerifier {
  readonly algorithm: 'Ed25519';
  readonly trustedKeyIds: readonly string[];
  verifyEd25519(canonicalUnsignedBundle: string, signature: string, keyId: string): boolean;
}

export interface ConfigActivationContext {
  configKey: string;
  version: string;
  rollback: boolean;
  recovery?: boolean;
}

export interface ConfigUpdateClientOptions {
  tenantId: string;
  clientId: string;
  clientVersion: string;
  verifySignature: ConfigSignatureVerifier;
  validatePayload?: (configKey: string, payload: Readonly<Record<string, unknown>>) => void;
  activate?: (configKey: string, payload: Readonly<Record<string, unknown>> | null, context: ConfigActivationContext) => void;
  now?: () => number;
}

export interface ApplyConfigResult {
  applied: true;
  replayed: boolean;
  rolledBack: false;
  configKey: string;
  version: string;
}

export interface RollbackConfigResult {
  applied: false;
  replayed: boolean;
  rolledBack: true;
  configKey: string;
  version: string;
}

export interface RecoverConfigResult {
  recovered: true;
  replayed: boolean;
  configKey: string;
  version: string;
}

export interface ConfigClientAuditEvent {
  eventId: number;
  event: 'apply' | 'rollback' | 'recover';
  operation: ConfigOperation;
  requestId: string;
  replayed: boolean;
  result: ConfigAuditResult;
  configKey: string;
  version?: string;
  outcome: ConfigAuditResult;
  reason?: string;
  at: number;
}

interface StoredRequest {
  operation: ConfigOperation;
  fingerprint: string;
  result: ApplyConfigResult | RollbackConfigResult | RecoverConfigResult;
}

interface StoredError {
  operation: ConfigOperation;
  fingerprint: string;
  code: ConfigUpdateErrorCode;
  message: string;
}

interface ConfigState {
  active: ConfigBundle;
  previous: ConfigBundle | null;
  revision: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

export function stableJson(value: unknown): string {
  const seen = new Set<object>();
  let nodeCount = 0;
  const encode = (entry: unknown, depth = 0): string => {
    if (depth > 128 || ++nodeCount > 100_000) throw new Error('value is too deeply nested or large');
    if (entry === null) return 'null';
    if (typeof entry === 'string' || typeof entry === 'boolean') return JSON.stringify(entry);
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) throw new Error('value is not finite'); return JSON.stringify(entry); }
    if (typeof entry !== 'object' || entry === undefined) throw new Error('value is not JSON');
    if (seen.has(entry)) throw new Error('value is cyclic');
    seen.add(entry);
    try {
      if (Array.isArray(entry)) return `[${entry.map((item) => encode(item, depth + 1)).join(',')}]`;
      const object = entry as Record<string, unknown>;
      if (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null) throw new Error('object must be plain');
      return `{${Object.keys(object).sort().map((key) => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`unsafe key ${key}`);
        return `${JSON.stringify(key)}:${encode(object[key], depth + 1)}`;
      }).join(',')}}`;
    } finally { seen.delete(entry); }
  };
  return encode(value);
}

export function configBundleSigningBytes(bundle: ConfigBundle): string {
  const { signature: _signature, ...unsigned } = bundle;
  return stableJson(unsigned);
}

function validText(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, `${label} is invalid`);
  }
  return value;
}

function validConfigKey(value: unknown): string {
  const key = validText(value, 'configKey');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, 'configKey contains unsafe characters');
  return key;
}

function requestConfigKeyHint(value: unknown): string {
  if (typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) return value;
  return '<invalid-config-key>';
}

function parseVersion(value: unknown): [number, number, number] {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'version must be strict semver');
  }
  const parts = value.split('.').map(Number) as [number, number, number];
  if (parts.some((part) => !Number.isSafeInteger(part))) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'version is out of range');
  return parts;
}

function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  return 0;
}

export function rolloutBucket(configKey: string, subject: string, salt: string): number {
  const input = `${configKey}\u0000${subject}\u0000${salt}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 100;
}

function rolloutEligible(bundle: ConfigBundle, subject: string): boolean {
  if (bundle.denyList?.includes(subject)) return false;
  if (bundle.allowList?.includes(subject)) return true;
  if (bundle.allowList !== undefined) return false;
  return rolloutBucket(bundle.configKey, subject, bundle.rolloutSalt) < bundle.rolloutPercent;
}

function validateBundle(value: unknown): ConfigBundle {
  if (!isRecord(value)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'bundle must be an object');
  const allowedKeys = new Set(['bundleId', 'tenantId', 'configKey', 'version', 'minClientVersion', 'rolloutPercent', 'rolloutSalt', 'allowList', 'denyList', 'payload', 'keyId', 'signature', 'createdAt', 'expiresAt']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'bundle contains unknown fields');
  const version = validText(value.version, 'version');
  parseVersion(version);
  const minClientVersion = validText(value.minClientVersion, 'minClientVersion');
  parseVersion(minClientVersion);
  if (!Number.isInteger(value.rolloutPercent) || (value.rolloutPercent as number) < 0 || (value.rolloutPercent as number) > 100) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'rolloutPercent is invalid');
  if (!isRecord(value.payload)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'payload is invalid');
  try { if (new TextEncoder().encode(stableJson(value.payload)).byteLength > 1024 * 1024) throw new Error('payload too large'); } catch (error) { throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, `payload is invalid: ${String(error)}`); }
  if (!Number.isSafeInteger(value.createdAt) || (value.createdAt as number) < 0) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'createdAt is invalid');
  if (value.expiresAt !== undefined && (!Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) <= (value.createdAt as number))) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'expiresAt is invalid');
  const allowList = value.allowList === undefined ? undefined : value.allowList;
  const denyList = value.denyList === undefined ? undefined : value.denyList;
  for (const [label, list] of [['allowList', allowList], ['denyList', denyList]] as const) {
    if (list !== undefined && (!Array.isArray(list) || list.some((item) => typeof item !== 'string' || item.length === 0 || item !== item.trim()))) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, `${label} is invalid`);
    if (list !== undefined && new Set(list).size !== list.length) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, `${label} contains duplicates`);
  }
  if (allowList?.some((id) => denyList?.includes(id))) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'allowList and denyList overlap');
  return clone({
    bundleId: validText(value.bundleId, 'bundleId'), tenantId: validText(value.tenantId, 'tenantId'), configKey: validConfigKey(value.configKey), version, minClientVersion,
    rolloutPercent: value.rolloutPercent as number, rolloutSalt: validText(value.rolloutSalt, 'rolloutSalt'),
    ...(allowList === undefined ? {} : { allowList: clone(allowList) }), ...(denyList === undefined ? {} : { denyList: clone(denyList) }),
    payload: clone(value.payload), keyId: validText(value.keyId, 'keyId'), signature: validText(value.signature, 'signature', 1024),
    createdAt: value.createdAt as number, ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt as number }),
  });
}

function fingerprint(value: unknown): string { return stableJson(value); }

function safeFingerprint(value: unknown): string {
  try { return fingerprint(value); } catch { return '<unserializable-request>'; }
}

export class ConfigUpdateClientService {
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientVersion: string;
  private readonly verifySignature: ConfigSignatureVerifier;
  private readonly validatePayload: (configKey: string, payload: Readonly<Record<string, unknown>>) => void;
  private readonly activate: (configKey: string, payload: Readonly<Record<string, unknown>> | null, context: ConfigActivationContext) => void;
  private readonly clock: () => number;
  private readonly states = new Map<string, ConfigState>();
  private readonly requests = new Map<string, StoredRequest>();
  private readonly failedRequests = new Map<string, StoredError>();
  private readonly requestOperations = new Map<string, ConfigOperation>();
  private readonly requestConfigKeys = new Map<string, string>();
  private readonly activationLocks = new Set<string>();
  private readonly blocked = new Map<string, string>();
  private readonly revisionByConfig = new Map<string, number>();
  private readonly maxAcceptedVersionByConfig = new Map<string, string>();
  private readonly maxMinClientVersionByConfig = new Map<string, string>();
  private readonly acceptedBundlesByConfig = new Map<string, Map<string, ConfigBundle>>();
  private readonly audit: ConfigClientAuditEvent[] = [];
  private auditSequence = 0;

  constructor(options: ConfigUpdateClientOptions) {
    this.tenantId = validText(options?.tenantId, 'tenantId');
    this.clientId = validText(options?.clientId, 'clientId');
    this.clientVersion = validText(options?.clientVersion, 'clientVersion');
    parseVersion(this.clientVersion);
    if (!options?.verifySignature || options.verifySignature.algorithm !== 'Ed25519' || !Array.isArray(options.verifySignature.trustedKeyIds) || typeof options.verifySignature.verifyEd25519 !== 'function') throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, 'an Ed25519 verifier with an explicit key policy is required');
    this.verifySignature = options.verifySignature;
    this.validatePayload = options.validatePayload ?? (() => undefined);
    this.activate = options.activate ?? (() => undefined);
    this.clock = options.now ?? (() => Date.now());
  }

  apply(requestId: string, value: unknown): ApplyConfigResult {
    const id = validText(requestId, 'requestId');
    const configKeyHint = requestConfigKeyHint((value as { configKey?: unknown } | null | undefined)?.configKey);
    this.beginOperation('apply', id, configKeyHint);
    const replay = this.replay<ApplyConfigResult>('apply', id, safeFingerprint({ operation: 'apply', configKey: (value as { configKey?: unknown } | null | undefined)?.configKey, bundle: value }), configKeyHint);
    if (replay) return replay;
    const bundle = validateBundle(value);
    const requestFingerprint = fingerprint({ operation: 'apply', configKey: bundle.configKey, bundle });
    try {
      this.assertUsable(bundle.configKey);
      this.validateCommon(bundle);
      const current = this.states.get(bundle.configKey)?.active ?? null;
      if (current && compareVersions(bundle.version, current.version) < 0) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.VERSION_CONFLICT, 'version cannot move backwards without rollback');
      if (current && compareVersions(bundle.version, current.version) === 0) {
        if (stableJson(current) !== stableJson(bundle)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.VERSION_CONFLICT, 'same version has different content');
        const result: ApplyConfigResult = { applied: true, replayed: true, rolledBack: false, configKey: bundle.configKey, version: bundle.version };
        this.storeRequest('apply', id, requestFingerprint, result);
        this.recordAudit({ event: 'apply', requestId: id, configKey: bundle.configKey, version: bundle.version, outcome: 'replayed' });
        return clone(result);
      }
      const minClientVersionFloor = this.maxMinClientVersionByConfig.get(bundle.configKey) ?? current?.minClientVersion;
      if (minClientVersionFloor && compareVersions(bundle.minClientVersion, minClientVersionFloor) < 0) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.VERSION_CONFLICT, 'minClientVersion cannot move backwards');
      const expectedRevision = this.revisions(bundle.configKey);
      this.beginActivation(bundle.configKey);
      let activationStarted = false;
      let validationComplete = false;
      try {
        this.assertRevision(bundle.configKey, expectedRevision);
        this.validatePayload(bundle.configKey, bundle.payload);
        validationComplete = true;
        activationStarted = true;
        this.activate(bundle.configKey, clone(bundle.payload), { configKey: bundle.configKey, version: bundle.version, rollback: false });
      } catch (error) {
        const activationMessage = error instanceof Error ? error.message : 'config activation failed';
        if (!validationComplete && !activationStarted) {
          if (!(error instanceof ConfigUpdateError && error.code === CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT)) {
            this.endActivation(bundle.configKey);
            throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.ACTIVATION_FAILED, activationMessage);
          }
          this.quarantine(bundle.configKey, `runtime state changed before activation: ${activationMessage}`);
          this.endActivation(bundle.configKey);
          throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, this.blocked.get(bundle.configKey));
        }
        if (activationStarted && current) {
          try {
            this.assertRevision(bundle.configKey, expectedRevision);
            this.activate(bundle.configKey, clone(current.payload), { configKey: bundle.configKey, version: current.version, rollback: true });
          } catch (rollbackError) {
            this.quarantine(bundle.configKey, `activation failed: ${activationMessage}; recovery failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
            this.endActivation(bundle.configKey);
            throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, this.blocked.get(bundle.configKey));
          }
          this.quarantine(bundle.configKey, `activation failed: ${activationMessage}; previous active was restored but runtime updates remain blocked`);
        } else {
          this.quarantine(bundle.configKey, `activation failed: ${activationMessage}; no confirmed active config is available`);
        }
        this.endActivation(bundle.configKey);
        throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, this.blocked.get(bundle.configKey));
      }
      try {
        this.assertRevision(bundle.configKey, expectedRevision);
        this.states.set(bundle.configKey, { active: clone(bundle), previous: current ? clone(current) : null, revision: expectedRevision + 1 });
        this.revisionByConfig.set(bundle.configKey, expectedRevision + 1);
        this.recordAcceptedBundle(bundle);
      } catch (error) {
        if (current) {
          try { this.activate(bundle.configKey, clone(current.payload), { configKey: bundle.configKey, version: current.version, rollback: true }); } catch (rollbackError) {
            this.quarantine(bundle.configKey, `commit CAS failed: ${error instanceof Error ? error.message : String(error)}; recovery failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
            throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, this.blocked.get(bundle.configKey));
          }
          this.quarantine(bundle.configKey, `commit CAS failed: ${error instanceof Error ? error.message : String(error)}; runtime state cannot be confirmed`);
        } else {
          this.quarantine(bundle.configKey, `commit CAS failed: ${error instanceof Error ? error.message : String(error)}`);
          throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, this.blocked.get(bundle.configKey));
        }
        throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, this.blocked.get(bundle.configKey));
      } finally {
        this.endActivation(bundle.configKey);
      }
      const result: ApplyConfigResult = { applied: true, replayed: false, rolledBack: false, configKey: bundle.configKey, version: bundle.version };
      this.storeRequest('apply', id, requestFingerprint, result);
      this.recordAudit({ event: 'apply', requestId: id, configKey: bundle.configKey, version: bundle.version, outcome: 'accepted' });
      return clone(result);
    } catch (error) {
      if (error instanceof ConfigUpdateError && !(error instanceof ConfigReplayError)) this.storeFailure('apply', id, requestFingerprint, error);
      if (!(error instanceof ConfigReplayError)) {
        this.recordAudit({ event: 'apply', requestId: id, configKey: bundle.configKey, version: bundle.version, outcome: 'rejected', reason: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  rollback(requestId: string, configKeyInput: string): RollbackConfigResult {
    const requestIdValue = validText(requestId, 'requestId');
    const configKeyHint = requestConfigKeyHint(configKeyInput);
    this.beginOperation('rollback', requestIdValue, configKeyHint);
    const replay = this.replay<RollbackConfigResult>('rollback', requestIdValue, safeFingerprint({ operation: 'rollback', configKey: configKeyInput }), configKeyHint);
    if (replay) return replay;
    const configKey = validConfigKey(configKeyInput);
    const requestFingerprint = fingerprint({ operation: 'rollback', configKey });
    this.assertUsable(configKey);
    const state = this.states.get(configKey);
    if (!state?.previous) {
      const error = new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.ROLLBACK_UNAVAILABLE, 'no previous config is available');
      this.storeFailure('rollback', requestIdValue, requestFingerprint, error);
      this.recordAudit({ event: 'rollback', requestId: requestIdValue, configKey, outcome: 'rejected', reason: error.message });
      throw error;
    }
    const target = state.previous;
    const expectedRevision = state.revision;
    this.beginActivation(configKey);
    try {
      this.assertRevision(configKey, expectedRevision);
      this.activate(configKey, clone(target.payload), { configKey, version: target.version, rollback: true });
    } catch (error) {
      const rollbackMessage = error instanceof Error ? error.message : 'rollback activation failed';
      try {
        this.assertRevision(configKey, expectedRevision);
        this.activate(configKey, clone(state.active.payload), { configKey, version: state.active.version, rollback: false });
      } catch (recoveryError) {
        const recoveryMessage = recoveryError instanceof Error ? recoveryError.message : String(recoveryError);
        this.quarantine(configKey, `rollback activation failed: ${rollbackMessage}; recovery failed: ${recoveryMessage}`);
      }
      if (!this.isBlocked(configKey)) {
        this.quarantine(configKey, `rollback activation failed: ${rollbackMessage}; previous active was restored but runtime updates remain blocked`);
      }
      const inconsistent = new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, this.blocked.get(configKey));
      this.storeFailure('rollback', requestIdValue, requestFingerprint, inconsistent);
      this.recordAudit({ event: 'rollback', requestId: requestIdValue, configKey, version: target.version, outcome: 'rejected', reason: inconsistent.message });
      this.endActivation(configKey);
      throw inconsistent;
    }
    try {
      this.assertRevision(configKey, expectedRevision);
      this.states.set(configKey, { active: clone(target), previous: null, revision: expectedRevision + 1 });
      this.revisionByConfig.set(configKey, expectedRevision + 1);
    } catch (error) {
      try {
        this.activate(configKey, clone(state.active.payload), { configKey, version: state.active.version, rollback: false });
      } catch (recoveryError) {
        this.quarantine(configKey, `rollback commit CAS failed: ${error instanceof Error ? error.message : String(error)}; recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
      }
      if (!this.isBlocked(configKey)) {
        this.quarantine(configKey, `rollback commit CAS failed: ${error instanceof Error ? error.message : String(error)}; runtime state cannot be confirmed`);
      }
      const inconsistent = new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, this.blocked.get(configKey));
      this.storeFailure('rollback', requestIdValue, requestFingerprint, inconsistent);
      this.recordAudit({ event: 'rollback', requestId: requestIdValue, configKey, version: target.version, outcome: 'rejected', reason: inconsistent.message });
      this.endActivation(configKey);
      throw inconsistent;
    }
    this.endActivation(configKey);
    const result: RollbackConfigResult = { applied: false, replayed: false, rolledBack: true, configKey, version: target.version };
    this.storeRequest('rollback', requestIdValue, requestFingerprint, result);
    this.recordAudit({ event: 'rollback', requestId: requestIdValue, configKey, version: target.version, outcome: 'rolled_back' });
    return clone(result);
  }

  recover(requestId: string, value: unknown): RecoverConfigResult {
    const id = validText(requestId, 'requestId');
    const configKeyHint = requestConfigKeyHint((value as { configKey?: unknown } | null | undefined)?.configKey);
    this.beginOperation('recover', id, configKeyHint);
    const replay = this.replay<RecoverConfigResult>('recover', id, safeFingerprint({ operation: 'recover', configKey: (value as { configKey?: unknown } | null | undefined)?.configKey, bundle: value }), configKeyHint);
    if (replay) return replay;
    const bundle = validateBundle(value);
    const requestFingerprint = fingerprint({ operation: 'recover', configKey: bundle.configKey, bundle });
    try {
      if (!this.isBlocked(bundle.configKey)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, 'config is not quarantined and cannot use recovery path');
      this.validateCommon(bundle);
      const current = this.states.get(bundle.configKey)?.active ?? null;
      const historicalVersionFloor = this.maxAcceptedVersionByConfig.get(bundle.configKey);
      const versionFloor = historicalVersionFloor === undefined ? current?.version
        : current === null ? historicalVersionFloor
          : compareVersions(current.version, historicalVersionFloor) > 0 ? current.version : historicalVersionFloor;
      if (versionFloor && compareVersions(bundle.version, versionFloor) < 0) {
        throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.VERSION_CONFLICT, 'version cannot move backwards during recovery');
      }
      if (current && compareVersions(bundle.version, current.version) === 0 && stableJson(current) !== stableJson(bundle)) {
        throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.VERSION_CONFLICT, 'same version has different content');
      }
      const historicalBundle = this.acceptedBundlesByConfig.get(bundle.configKey)?.get(bundle.version);
      if (historicalBundle && stableJson(historicalBundle) !== stableJson(bundle)) {
        throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.VERSION_CONFLICT, 'same version has different content');
      }
      const historicalMinClientVersionFloor = this.maxMinClientVersionByConfig.get(bundle.configKey);
      const minClientVersionFloor = historicalMinClientVersionFloor === undefined ? current?.minClientVersion
        : current === null ? historicalMinClientVersionFloor
          : compareVersions(current.minClientVersion, historicalMinClientVersionFloor) > 0 ? current.minClientVersion : historicalMinClientVersionFloor;
      if (minClientVersionFloor && compareVersions(bundle.minClientVersion, minClientVersionFloor) < 0) {
        throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.VERSION_CONFLICT, 'minClientVersion cannot move backwards');
      }
      const expectedRevision = this.revisions(bundle.configKey);
      this.beginActivation(bundle.configKey);
      try {
        this.assertRevision(bundle.configKey, expectedRevision);
        this.validatePayload(bundle.configKey, bundle.payload);
        this.activate(bundle.configKey, clone(bundle.payload), { configKey: bundle.configKey, version: bundle.version, rollback: false, recovery: true });
        this.assertRevision(bundle.configKey, expectedRevision);
      } catch (error) {
        this.quarantine(bundle.configKey, `trusted recovery failed: ${error instanceof Error ? error.message : String(error)}; runtime remains blocked`);
        throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, this.blocked.get(bundle.configKey));
      } finally {
        this.endActivation(bundle.configKey);
      }
      this.states.set(bundle.configKey, { active: clone(bundle), previous: null, revision: expectedRevision + 1 });
      this.revisionByConfig.set(bundle.configKey, expectedRevision + 1);
      this.recordAcceptedBundle(bundle);
      this.blocked.delete(bundle.configKey);
      const result: RecoverConfigResult = { recovered: true, replayed: false, configKey: bundle.configKey, version: bundle.version };
      this.storeRequest('recover', id, requestFingerprint, result);
      this.recordAudit({ event: 'recover', requestId: id, configKey: bundle.configKey, version: bundle.version, outcome: 'recovered' });
      return clone(result);
    } catch (error) {
      if (error instanceof ConfigUpdateError && !(error instanceof ConfigReplayError)) this.storeFailure('recover', id, requestFingerprint, error);
      if (!(error instanceof ConfigReplayError)) {
        this.recordAudit({ event: 'recover', requestId: id, configKey: bundle.configKey, version: bundle.version, outcome: 'rejected', reason: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
  }

  active(configKeyInput: string): ConfigBundle | null {
    const configKey = validConfigKey(configKeyInput);
    this.assertUsable(configKey);
    return clone(this.states.get(configKey)?.active ?? null);
  }

  isBlocked(configKeyInput: string): boolean { return this.blocked.has(validConfigKey(configKeyInput)); }

  auditLog(): readonly ConfigClientAuditEvent[] { return Object.freeze(this.audit.map((entry) => Object.freeze(clone(entry)))); }

  private validateCommon(bundle: ConfigBundle): void {
    if (!this.verifySignature.trustedKeyIds.includes(bundle.keyId)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.SIGNATURE_INVALID, 'bundle keyId is not trusted');
    let verified = false;
    try { verified = this.verifySignature.verifyEd25519(configBundleSigningBytes(bundle), bundle.signature, bundle.keyId); } catch { verified = false; }
    if (!verified) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.SIGNATURE_INVALID, 'bundle signature is invalid');
    if (bundle.tenantId !== this.tenantId) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'bundle tenant does not match client tenant');
    if (compareVersions(this.clientVersion, bundle.minClientVersion) < 0) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.CLIENT_OUTDATED, 'client version is below minimum');
    if (bundle.expiresAt !== undefined && this.clock() >= bundle.expiresAt) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'bundle has expired');
    if (!rolloutEligible(bundle, this.clientId)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.NOT_ELIGIBLE, 'client is outside the rollout');
  }

  private revisions(configKey: string): number { return this.revisionByConfig.get(configKey) ?? 0; }

  private assertRevision(configKey: string, expected: number): void {
    if (this.revisions(configKey) !== expected) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, 'config state changed during activation');
  }

  private beginActivation(configKey: string): void {
    if (this.activationLocks.has(configKey)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.REENTRANT, 'nested config activation is rejected');
    this.activationLocks.add(configKey);
  }

  private endActivation(configKey: string): void { this.activationLocks.delete(configKey); }

  private quarantine(configKey: string, reason: string): void {
    this.blocked.set(configKey, `config runtime is quarantined/blocked and cannot continue: ${reason}`);
  }

  private assertUsable(configKey: string): void {
    const reason = this.blocked.get(configKey);
    if (reason) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.RUNTIME_INCONSISTENT, reason);
  }

  private requestNamespace(operation: ConfigOperation, requestId: string): string { return `${operation}\u0000${requestId}`; }

  private beginOperation(operation: ConfigOperation, requestId: string, configKey: string): void {
    const existing = this.requestOperations.get(requestId);
    if (existing !== undefined) {
      const existingConfigKey = this.requestConfigKeys.get(requestId);
      if (existing !== operation || existingConfigKey !== configKey || (!this.requests.has(this.requestNamespace(operation, requestId)) && !this.failedRequests.has(this.requestNamespace(operation, requestId)))) {
        const reason = existing !== operation
          ? 'requestId was already used by another config operation'
          : existingConfigKey !== configKey
            ? 'requestId was already used for another request (config key conflict)'
            : 'requestId is already claimed by another config request';
        const error = new ConfigReplayError(CONFIG_UPDATE_ERROR_CODES.REQUEST_ID_REUSED, reason);
        this.recordAudit({ event: operation, operation, requestId, configKey, replayed: true, result: 'rejected', outcome: 'rejected', reason });
        throw error;
      }
      return;
    }
    this.requestOperations.set(requestId, operation);
    this.requestConfigKeys.set(requestId, configKey);
  }

  private claimOperation(operation: ConfigOperation, requestId: string, configKey: string): void {
    const existing = this.requestOperations.get(requestId);
    if (existing !== undefined && (existing !== operation || this.requestConfigKeys.get(requestId) !== configKey)) {
      throw new ConfigReplayError(CONFIG_UPDATE_ERROR_CODES.REQUEST_ID_REUSED, 'requestId was already used by another config operation');
    }
    this.requestOperations.set(requestId, operation);
    this.requestConfigKeys.set(requestId, configKey);
  }

  private storeRequest(operation: ConfigOperation, requestId: string, requestFingerprint: string, result: ApplyConfigResult | RollbackConfigResult | RecoverConfigResult): void {
    this.claimOperation(operation, requestId, result.configKey);
    this.requests.set(this.requestNamespace(operation, requestId), { operation, fingerprint: requestFingerprint, result });
  }

  private storeFailure(operation: ConfigOperation, requestId: string, requestFingerprint: string, error: ConfigUpdateError): void {
    const existing = this.requestOperations.get(requestId);
    if (existing !== undefined && existing !== operation) return;
    this.claimOperation(operation, requestId, this.requestConfigKeys.get(requestId) ?? '<invalid-config-key>');
    this.failedRequests.set(this.requestNamespace(operation, requestId), { operation, fingerprint: requestFingerprint, code: error.code, message: error.message });
  }

  private replay<T extends ApplyConfigResult | RollbackConfigResult | RecoverConfigResult>(operation: ConfigOperation, requestId: string, requestFingerprint: string, configKey: string): T | null {
    const existingOperation = this.requestOperations.get(requestId);
    if (existingOperation !== undefined && existingOperation !== operation) {
      const error = new ConfigReplayError(CONFIG_UPDATE_ERROR_CODES.REQUEST_ID_REUSED, 'requestId was already used by another config operation');
      this.recordAudit({ event: operation, operation, requestId, configKey, replayed: true, result: 'rejected', outcome: 'rejected', reason: error.message });
      throw error;
    }
    const namespace = this.requestNamespace(operation, requestId);
    const stored = this.requests.get(namespace);
    const failed = this.failedRequests.get(namespace);
    if (!stored && !failed) return null;
    if ((stored !== undefined && stored.operation !== operation) || (failed !== undefined && failed.operation !== operation)
      || (stored?.fingerprint ?? failed?.fingerprint) !== requestFingerprint) {
      const error = new ConfigReplayError(CONFIG_UPDATE_ERROR_CODES.REQUEST_ID_REUSED, 'requestId was already used for another request');
      this.recordAudit({ event: operation, operation, requestId, configKey, replayed: true, result: 'rejected', outcome: 'rejected', reason: error.message });
      throw error;
    }
    if (failed) {
      const error = new ConfigReplayError(failed.code, failed.message);
      this.recordAudit({ event: operation, operation, requestId, configKey, replayed: true, result: 'rejected', outcome: 'rejected', reason: error.message });
      throw error;
    }
    const result = clone({ ...stored.result, replayed: true }) as T;
    this.recordAudit({ event: operation, operation, requestId, configKey, version: result.version, replayed: true, result: 'replayed', outcome: 'replayed' });
    return result;
  }

  private recordAcceptedBundle(bundle: ConfigBundle): void {
    const existingVersion = this.maxAcceptedVersionByConfig.get(bundle.configKey);
    if (existingVersion === undefined || compareVersions(bundle.version, existingVersion) > 0) this.maxAcceptedVersionByConfig.set(bundle.configKey, bundle.version);
    const existingMinClientVersion = this.maxMinClientVersionByConfig.get(bundle.configKey);
    if (existingMinClientVersion === undefined || compareVersions(bundle.minClientVersion, existingMinClientVersion) > 0) this.maxMinClientVersionByConfig.set(bundle.configKey, bundle.minClientVersion);
    const accepted = this.acceptedBundlesByConfig.get(bundle.configKey) ?? new Map<string, ConfigBundle>();
    accepted.set(bundle.version, clone(bundle));
    this.acceptedBundlesByConfig.set(bundle.configKey, accepted);
  }

  private recordAudit(event: Omit<ConfigClientAuditEvent, 'eventId' | 'at' | 'operation' | 'replayed' | 'result'> & Partial<Pick<ConfigClientAuditEvent, 'operation' | 'replayed' | 'result'>>): void {
    const operation = event.operation ?? event.event;
    const result = event.result ?? event.outcome;
    this.audit.push(Object.freeze({ eventId: ++this.auditSequence, at: this.clock(), ...event, operation, replayed: event.replayed ?? result === 'replayed', result }));
  }
}

export { ConfigUpdateClientService as ConfigUpdateService };
