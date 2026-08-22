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
} as const;

export type ConfigUpdateErrorCode = typeof CONFIG_UPDATE_ERROR_CODES[keyof typeof CONFIG_UPDATE_ERROR_CODES];

export class ConfigUpdateError extends Error {
  readonly code: ConfigUpdateErrorCode;

  constructor(code: ConfigUpdateErrorCode, message = code) {
    super(message);
    this.name = 'ConfigUpdateError';
    this.code = code;
  }
}

export interface ConfigBundle {
  bundleId: string;
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
  (canonicalUnsignedBundle: string, signature: string, keyId: string): boolean;
}

export interface ConfigActivationContext {
  configKey: string;
  version: string;
  rollback: boolean;
}

export interface ConfigUpdateClientOptions {
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

export interface ConfigClientAuditEvent {
  eventId: number;
  event: 'apply' | 'rollback';
  requestId: string;
  configKey: string;
  version?: string;
  outcome: 'accepted' | 'replayed' | 'rejected' | 'rolled_back';
  reason?: string;
  at: number;
}

interface StoredRequest {
  fingerprint: string;
  result: ApplyConfigResult | RollbackConfigResult;
}

interface StoredError {
  fingerprint: string;
  code: ConfigUpdateErrorCode;
  message: string;
}

interface ConfigState {
  active: ConfigBundle;
  previous: ConfigBundle | null;
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
  const encode = (entry: unknown): string => {
    if (entry === null) return 'null';
    if (typeof entry === 'string' || typeof entry === 'boolean') return JSON.stringify(entry);
    if (typeof entry === 'number') { if (!Number.isFinite(entry)) throw new Error('value is not finite'); return JSON.stringify(entry); }
    if (typeof entry !== 'object' || entry === undefined) throw new Error('value is not JSON');
    if (seen.has(entry)) throw new Error('value is cyclic');
    seen.add(entry);
    try {
      if (Array.isArray(entry)) return `[${entry.map(encode).join(',')}]`;
      const object = entry as Record<string, unknown>;
      if (Object.getPrototypeOf(object) !== Object.prototype && Object.getPrototypeOf(object) !== null) throw new Error('object must be plain');
      return `{${Object.keys(object).sort().map((key) => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') throw new Error(`unsafe key ${key}`);
        return `${JSON.stringify(key)}:${encode(object[key])}`;
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
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > max) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, `${label} is invalid`);
  }
  return value;
}

function validConfigKey(value: unknown): string {
  const key = validText(value, 'configKey');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, 'configKey contains unsafe characters');
  return key;
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
  const allowedKeys = new Set(['bundleId', 'configKey', 'version', 'minClientVersion', 'rolloutPercent', 'rolloutSalt', 'allowList', 'denyList', 'payload', 'keyId', 'signature', 'createdAt', 'expiresAt']);
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
    bundleId: validText(value.bundleId, 'bundleId'), configKey: validConfigKey(value.configKey), version, minClientVersion,
    rolloutPercent: value.rolloutPercent as number, rolloutSalt: validText(value.rolloutSalt, 'rolloutSalt'),
    ...(allowList === undefined ? {} : { allowList: clone(allowList) }), ...(denyList === undefined ? {} : { denyList: clone(denyList) }),
    payload: clone(value.payload), keyId: validText(value.keyId, 'keyId'), signature: validText(value.signature, 'signature', 1024),
    createdAt: value.createdAt as number, ...(value.expiresAt === undefined ? {} : { expiresAt: value.expiresAt as number }),
  });
}

function fingerprint(value: unknown): string { return stableJson(value); }

export class ConfigUpdateClientService {
  private readonly clientId: string;
  private readonly clientVersion: string;
  private readonly verifySignature: ConfigSignatureVerifier;
  private readonly validatePayload: (configKey: string, payload: Readonly<Record<string, unknown>>) => void;
  private readonly activate: (configKey: string, payload: Readonly<Record<string, unknown>> | null, context: ConfigActivationContext) => void;
  private readonly clock: () => number;
  private readonly states = new Map<string, ConfigState>();
  private readonly requests = new Map<string, StoredRequest>();
  private readonly failedRequests = new Map<string, StoredError>();
  private readonly audit: ConfigClientAuditEvent[] = [];
  private auditSequence = 0;

  constructor(options: ConfigUpdateClientOptions) {
    this.clientId = validText(options?.clientId, 'clientId');
    this.clientVersion = validText(options?.clientVersion, 'clientVersion');
    parseVersion(this.clientVersion);
    if (typeof options?.verifySignature !== 'function') throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, 'verifySignature is required');
    this.verifySignature = options.verifySignature;
    this.validatePayload = options.validatePayload ?? (() => undefined);
    this.activate = options.activate ?? (() => undefined);
    this.clock = options.now ?? (() => Date.now());
  }

  apply(requestId: string, value: unknown): ApplyConfigResult {
    const id = validText(requestId, 'requestId');
    const bundle = validateBundle(value);
    const requestFingerprint = fingerprint({ configKey: bundle.configKey, bundle });
    const replay = this.replay<ApplyConfigResult>(id, requestFingerprint);
    if (replay) return replay;
    try {
      this.validateCommon(bundle);
      const current = this.states.get(bundle.configKey)?.active ?? null;
      if (current && compareVersions(bundle.version, current.version) < 0) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.VERSION_CONFLICT, 'version cannot move backwards without rollback');
      if (current && compareVersions(bundle.version, current.version) === 0) {
        if (stableJson(current) !== stableJson(bundle)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.VERSION_CONFLICT, 'same version has different content');
        const result: ApplyConfigResult = { applied: true, replayed: true, rolledBack: false, configKey: bundle.configKey, version: bundle.version };
        this.storeRequest(id, requestFingerprint, result);
        this.recordAudit({ event: 'apply', requestId: id, configKey: bundle.configKey, version: bundle.version, outcome: 'replayed' });
        return clone(result);
      }
      try {
        this.validatePayload(bundle.configKey, bundle.payload);
        this.activate(bundle.configKey, clone(bundle.payload), { configKey: bundle.configKey, version: bundle.version, rollback: false });
      } catch (error) {
        if (current) {
          try { this.activate(bundle.configKey, clone(current.payload), { configKey: bundle.configKey, version: current.version, rollback: true }); } catch { /* preserve original failure and state */ }
        }
        throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.ACTIVATION_FAILED, error instanceof Error ? error.message : 'config activation failed');
      }
      this.states.set(bundle.configKey, { active: clone(bundle), previous: current ? clone(current) : null });
      const result: ApplyConfigResult = { applied: true, replayed: false, rolledBack: false, configKey: bundle.configKey, version: bundle.version };
      this.storeRequest(id, requestFingerprint, result);
      this.recordAudit({ event: 'apply', requestId: id, configKey: bundle.configKey, version: bundle.version, outcome: 'accepted' });
      return clone(result);
    } catch (error) {
      if (error instanceof ConfigUpdateError) this.failedRequests.set(id, { fingerprint: requestFingerprint, code: error.code, message: error.message });
      this.recordAudit({ event: 'apply', requestId: id, configKey: bundle.configKey, version: bundle.version, outcome: 'rejected', reason: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  rollback(requestId: string, configKeyInput: string): RollbackConfigResult {
    const requestIdValue = validText(requestId, 'requestId');
    const configKey = validConfigKey(configKeyInput);
    const state = this.states.get(configKey);
    const requestFingerprint = fingerprint({ configKey });
    const replay = this.replay<RollbackConfigResult>(requestIdValue, requestFingerprint);
    if (replay) return replay;
    if (!state?.previous) {
      const error = new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.ROLLBACK_UNAVAILABLE, 'no previous config is available');
      this.failedRequests.set(requestIdValue, { fingerprint: requestFingerprint, code: error.code, message: error.message });
      this.recordAudit({ event: 'rollback', requestId: requestIdValue, configKey, outcome: 'rejected', reason: error.message });
      throw error;
    }
    const target = state.previous;
    try {
      this.activate(configKey, clone(target.payload), { configKey, version: target.version, rollback: true });
    } catch (error) {
      const failure = new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.ACTIVATION_FAILED, error instanceof Error ? error.message : 'rollback activation failed');
      this.failedRequests.set(requestIdValue, { fingerprint: requestFingerprint, code: failure.code, message: failure.message });
      this.recordAudit({ event: 'rollback', requestId: requestIdValue, configKey, version: target.version, outcome: 'rejected', reason: failure.message });
      throw failure;
    }
    this.states.set(configKey, { active: clone(target), previous: null });
    const result: RollbackConfigResult = { applied: false, replayed: false, rolledBack: true, configKey, version: target.version };
    this.storeRequest(requestIdValue, requestFingerprint, result);
    this.recordAudit({ event: 'rollback', requestId: requestIdValue, configKey, version: target.version, outcome: 'rolled_back' });
    return clone(result);
  }

  active(configKeyInput: string): ConfigBundle | null {
    return clone(this.states.get(validConfigKey(configKeyInput))?.active ?? null);
  }

  auditLog(): readonly ConfigClientAuditEvent[] { return Object.freeze(this.audit.map((entry) => Object.freeze(clone(entry)))); }

  private validateCommon(bundle: ConfigBundle): void {
    let verified = false;
    try { verified = this.verifySignature(configBundleSigningBytes(bundle), bundle.signature, bundle.keyId); } catch { verified = false; }
    if (!verified) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.SIGNATURE_INVALID, 'bundle signature is invalid');
    if (compareVersions(this.clientVersion, bundle.minClientVersion) < 0) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.CLIENT_OUTDATED, 'client version is below minimum');
    if (bundle.expiresAt !== undefined && this.clock() >= bundle.expiresAt) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'bundle has expired');
    if (!rolloutEligible(bundle, this.clientId)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.NOT_ELIGIBLE, 'client is outside the rollout');
  }

  private storeRequest(requestId: string, requestFingerprint: string, result: ApplyConfigResult | RollbackConfigResult): void {
    this.requests.set(requestId, { fingerprint: requestFingerprint, result });
  }

  private replay<T extends ApplyConfigResult | RollbackConfigResult>(requestId: string, requestFingerprint: string): T | null {
    const stored = this.requests.get(requestId);
    const failed = this.failedRequests.get(requestId);
    if (!stored && !failed) return null;
    if ((stored?.fingerprint ?? failed?.fingerprint) !== requestFingerprint) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.REQUEST_ID_REUSED, 'requestId was already used for another request');
    if (failed) throw new ConfigUpdateError(failed.code, failed.message);
    return clone({ ...stored.result, replayed: true }) as T;
  }

  private recordAudit(event: Omit<ConfigClientAuditEvent, 'eventId' | 'at'>): void {
    this.audit.push({ eventId: ++this.auditSequence, at: this.clock(), ...event });
  }
}

export { ConfigUpdateClientService as ConfigUpdateService };
