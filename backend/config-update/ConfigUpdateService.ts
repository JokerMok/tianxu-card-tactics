import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';

export const CONFIG_UPDATE_ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_BUNDLE: 'INVALID_BUNDLE',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  REQUEST_ID_REUSED: 'REQUEST_ID_REUSED',
  CONFIG_NOT_FOUND: 'CONFIG_NOT_FOUND',
  ROLLBACK_UNAVAILABLE: 'ROLLBACK_UNAVAILABLE',
  AUDIT_LIMIT: 'AUDIT_LIMIT',
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

export type UnsignedConfigBundle = Omit<ConfigBundle, 'signature'>;

export interface PublishConfigRequest {
  requestId: string;
  actorId: string;
  bundle: ConfigBundle;
}

export interface PublishConfigResult {
  accepted: true;
  replayed: boolean;
  bundle: ConfigBundle;
}

export interface FetchConfigRequest {
  requestId: string;
  configKey: string;
  clientId: string;
  clientVersion: string;
  authToken: string;
}

export interface ConfigAuthenticatedIdentity {
  tenantId: string;
  subjectId: string;
  clientVersion: string;
  /** Trusted session state; missing state must fail closed. */
  available: boolean;
  blocked: boolean;
}

export type ConfigIdentityResolver = (request: FetchConfigRequest) => ConfigAuthenticatedIdentity | null;

export type FetchUnavailableReason = 'CONFIG_NOT_FOUND' | 'CLIENT_OUTDATED' | 'NOT_ELIGIBLE' | 'EXPIRED' | 'CLIENT_BLOCKED' | 'SESSION_UNAVAILABLE';
export type ConfigAuditResult = 'accepted' | 'replayed' | 'rejected' | 'unavailable';

export interface FetchConfigResult {
  available: boolean;
  replayed: boolean;
  bundle: ConfigBundle | null;
  reason?: FetchUnavailableReason;
}

export interface RollbackConfigRequest {
  requestId: string;
  actorId: string;
  tenantId: string;
  configKey: string;
  targetVersion?: string;
}

export interface RollbackConfigResult {
  rolledBack: true;
  replayed: boolean;
  bundle: ConfigBundle;
}

export interface ConfigAuditEvent {
  eventId: number;
  event: 'publish' | 'fetch' | 'rollback';
  operation: 'publish' | 'fetch' | 'rollback';
  requestId: string;
  actorId?: string;
  configKey: string;
  version?: string;
  replayed: boolean;
  result: ConfigAuditResult;
  outcome: ConfigAuditResult;
  reason?: string;
  at: number;
}

export interface ConfigUpdateServiceOptions {
  now?: () => number;
  publicKeys?: Readonly<Record<string, string | object>>;
  resolveIdentity?: ConfigIdentityResolver;
  maxAuditEvents?: number;
}

interface StoredRequest {
  operation: ConfigAuditEvent['event'];
  fingerprint: string;
  result: PublishConfigResult | FetchConfigResult | RollbackConfigResult;
}

interface StoredError {
  operation: ConfigAuditEvent['event'];
  fingerprint: string;
  code: ConfigUpdateErrorCode;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

export function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Stable JSON is the byte representation covered by the Ed25519 signature. */
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

export function unsignedBundle(bundle: ConfigBundle): UnsignedConfigBundle {
  const { signature: _signature, ...unsigned } = bundle;
  return unsigned;
}

export function configBundleSigningBytes(bundle: ConfigBundle | UnsignedConfigBundle): string {
  return stableJson('signature' in bundle ? unsignedBundle(bundle as ConfigBundle) : bundle);
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

export function parseVersion(value: unknown): [number, number, number] {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'version must be strict semver');
  }
  const parts = value.split('.').map(Number) as [number, number, number];
  if (parts.some((part) => !Number.isSafeInteger(part))) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'version is out of range');
  }
  return parts;
}

function validText(value: unknown, label: string, max = 128): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, `${label} is invalid`);
  }
  return value;
}

function validConfigKey(value: unknown): string {
  const key = validText(value, 'configKey');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(key)) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, 'configKey contains unsafe characters');
  }
  return key;
}

function validTimestamp(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, `${label} is invalid`);
  }
  return value as number;
}

function validList(value: unknown, label: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 1000) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, `${label} is invalid`);
  }
  const result = value.map((entry) => validText(entry, `${label} entry`));
  if (new Set(result).size !== result.length) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, `${label} contains duplicates`);
  }
  return result;
}

export function validateConfigBundle(value: unknown): ConfigBundle {
  if (!isRecord(value)) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'bundle must be an object');
  const allowedKeys = new Set(['bundleId', 'tenantId', 'configKey', 'version', 'minClientVersion', 'rolloutPercent', 'rolloutSalt', 'allowList', 'denyList', 'payload', 'keyId', 'signature', 'createdAt', 'expiresAt']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'bundle contains unknown fields');
  const configKey = validConfigKey(value.configKey);
  const version = validText(value.version, 'version');
  parseVersion(version);
  const minClientVersion = validText(value.minClientVersion, 'minClientVersion');
  parseVersion(minClientVersion);
  if (!Number.isInteger(value.rolloutPercent) || (value.rolloutPercent as number) < 0 || (value.rolloutPercent as number) > 100) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'rolloutPercent must be an integer from 0 to 100');
  }
  const payload = value.payload;
  if (!isRecord(payload)) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'payload must be an object no larger than 1 MiB');
  }
  try { if (new TextEncoder().encode(stableJson(payload)).byteLength > 1024 * 1024) throw new Error('payload too large'); } catch (error) { throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, `payload is invalid: ${String(error)}`); }
  const createdAt = validTimestamp(value.createdAt, 'createdAt');
  const expiresAt = value.expiresAt === undefined ? undefined : validTimestamp(value.expiresAt, 'expiresAt');
  if (expiresAt !== undefined && expiresAt <= createdAt) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'expiresAt must be after createdAt');
  }
  const allowList = validList(value.allowList, 'allowList');
  const denyList = validList(value.denyList, 'denyList');
  if (allowList?.some((id) => denyList?.includes(id))) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_BUNDLE, 'allowList and denyList overlap');
  }
  return clone({
    bundleId: validText(value.bundleId, 'bundleId'),
    tenantId: validText(value.tenantId, 'tenantId'),
    configKey,
    version,
    minClientVersion,
    rolloutPercent: value.rolloutPercent as number,
    rolloutSalt: validText(value.rolloutSalt, 'rolloutSalt'),
    ...(allowList === undefined ? {} : { allowList }),
    ...(denyList === undefined ? {} : { denyList }),
    payload: clone(payload),
    keyId: validText(value.keyId, 'keyId'),
    signature: validText(value.signature, 'signature', 1024),
    createdAt,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  });
}

/** FNV-1a gives a stable, dependency-free bucket; it is not used as a security primitive. */
export function rolloutBucket(configKey: string, subject: string, salt: string): number {
  const input = `${configKey}\u0000${subject}\u0000${salt}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash % 100;
}

export function isRolloutEligible(bundle: ConfigBundle, subject: string): boolean {
  if (bundle.denyList?.includes(subject)) return false;
  if (bundle.allowList?.includes(subject)) return true;
  if (bundle.allowList !== undefined) return false;
  return rolloutBucket(bundle.configKey, subject, bundle.rolloutSalt) < bundle.rolloutPercent;
}

function scopeKey(tenantId: string, configKey: string): string {
  return `${tenantId}\u0000${configKey}`;
}

function fingerprint(value: unknown): string { return stableJson(value); }

export function createConfigSignature(bundle: ConfigBundle | UnsignedConfigBundle, privateKey: string | object): string {
  try {
    const key = typeof privateKey === 'string' ? createPrivateKey(privateKey) : privateKey;
    if (key.asymmetricKeyType !== 'ed25519') throw new Error('only Ed25519 signing keys are supported');
    return sign(null, Buffer.from(configBundleSigningBytes(bundle), 'utf8'), key).toString('base64url');
  } catch (error) {
    throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, error instanceof Error ? error.message : 'invalid Ed25519 private key');
  }
}

export function verifyConfigSignature(bundle: ConfigBundle, publicKey: string | object): boolean {
  try {
    const key = typeof publicKey === 'string' ? createPublicKey(publicKey) : publicKey;
    if (key.asymmetricKeyType !== 'ed25519') return false;
    const signature = Buffer.from(bundle.signature, 'base64url');
    if (signature.length !== 64) return false;
    return verify(null, Buffer.from(configBundleSigningBytes(bundle), 'utf8'), key, signature);
  } catch {
    return false;
  }
}

export class ConfigUpdateService {
  private readonly clock: () => number;
  private readonly publicKeys: ReadonlyMap<string, ReturnType<typeof createPublicKey>>;
  private readonly resolveIdentity?: ConfigIdentityResolver;
  private readonly maxAuditEvents: number;
  private readonly history = new Map<string, ConfigBundle[]>();
  private readonly active = new Map<string, ConfigBundle>();
  private readonly requests = new Map<string, StoredRequest>();
  private readonly failedRequests = new Map<string, StoredError>();
  private readonly audit: ConfigAuditEvent[] = [];
  private auditSequence = 0;

  constructor(options: ConfigUpdateServiceOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.resolveIdentity = options.resolveIdentity;
    const keys = new Map<string, ReturnType<typeof createPublicKey>>();
    if (options.publicKeys !== undefined) {
      if (Object.getPrototypeOf(options.publicKeys) !== Object.prototype && Object.getPrototypeOf(options.publicKeys) !== null) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, 'publicKeys must be a plain object');
      for (const [keyId, value] of Object.entries(options.publicKeys)) {
        const validKeyId = validText(keyId, 'keyId');
        try {
          const key = typeof value === 'string' ? createPublicKey(value) : value;
          if (key.asymmetricKeyType !== 'ed25519') throw new Error('only Ed25519 public keys are supported');
          keys.set(validKeyId, key);
        } catch (error) {
          throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, error instanceof Error ? error.message : 'invalid Ed25519 public key');
        }
      }
    }
    this.publicKeys = keys;
    this.maxAuditEvents = options.maxAuditEvents ?? 10_000;
    if (!Number.isSafeInteger(this.maxAuditEvents) || this.maxAuditEvents < 1 || this.maxAuditEvents > 100_000) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.INVALID_REQUEST, 'maxAuditEvents is invalid');
  }

  publish(request: PublishConfigRequest): PublishConfigResult {
    const requestId = validText(request?.requestId, 'requestId');
    const actorId = validText(request?.actorId, 'actorId');
    const bundle = validateConfigBundle(request?.bundle);
    const requestFingerprint = fingerprint({ actorId, bundle });
    const replay = this.replay<PublishConfigResult>(requestId, requestFingerprint, 'publish', bundle.configKey);
    if (replay) return replay;
    try {
      const publicKey = this.publicKeys.get(bundle.keyId);
      if (!publicKey || !verifyConfigSignature(bundle, publicKey)) {
        throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.SIGNATURE_INVALID, 'bundle signature is invalid');
      }
      const scope = scopeKey(bundle.tenantId, bundle.configKey);
      const versions = this.history.get(scope) ?? [];
      const latest = versions.at(-1);
      if (latest && (compareVersions(bundle.version, latest.version) <= 0 || compareVersions(bundle.minClientVersion, latest.minClientVersion) < 0)) {
        throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.VERSION_CONFLICT, 'version and minClientVersion must increase monotonically');
      }
      this.ensureAuditCapacity();
      versions.push(bundle);
      this.history.set(scope, versions);
      this.active.set(scope, bundle);
      const result: PublishConfigResult = { accepted: true, replayed: false, bundle: clone(bundle) };
      this.requests.set(requestId, { operation: 'publish', fingerprint: requestFingerprint, result });
      this.recordAudit({ event: 'publish', requestId, actorId, configKey: bundle.configKey, version: bundle.version, outcome: 'accepted' });
      return clone(result);
    } catch (error) {
      if (error instanceof ConfigUpdateError) this.failedRequests.set(requestId, { operation: 'publish', fingerprint: requestFingerprint, code: error.code, message: error.message });
      this.recordAudit({ event: 'publish', requestId, actorId, configKey: bundle.configKey, version: bundle.version, outcome: 'rejected', reason: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  fetch(request: FetchConfigRequest): FetchConfigResult {
    const requestId = validText(request?.requestId, 'requestId');
    const configKey = validConfigKey(request?.configKey);
    const clientId = validText(request?.clientId, 'clientId');
    const clientVersion = validText(request?.clientVersion, 'clientVersion');
    parseVersion(clientVersion);
    try { validText(request?.authToken, 'authToken'); } catch {
      throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.AUTHENTICATION_REQUIRED, 'authenticated identity is required');
    }
    let identity: ConfigAuthenticatedIdentity | null = null;
    try { identity = this.resolveIdentity?.(request) ?? null; } catch { identity = null; }
    if (!identity) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.AUTHENTICATION_REQUIRED, 'authenticated identity is required');
    let tenantId: string;
    let subjectId: string;
    let resolvedClientVersion: string;
    try {
      tenantId = validText(identity.tenantId, 'tenantId');
      subjectId = validText(identity.subjectId, 'subjectId');
      resolvedClientVersion = validText(identity.clientVersion, 'clientVersion');
      parseVersion(resolvedClientVersion);
      if (typeof identity.available !== 'boolean' || typeof identity.blocked !== 'boolean') throw new Error('trusted session state is missing');
    } catch {
      throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.AUTHENTICATION_REQUIRED, 'authenticated identity is invalid');
    }
    if (clientId !== subjectId || clientVersion !== resolvedClientVersion) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.AUTHENTICATION_REQUIRED, 'request identity does not match authenticated identity');
    const requestFingerprint = fingerprint({ configKey, tenantId, subjectId, clientVersion: resolvedClientVersion, available: identity.available, blocked: identity.blocked });
    const replay = this.replay<FetchConfigResult>(requestId, requestFingerprint, 'fetch', configKey);
    if (replay) return replay;
    if (identity.blocked) return this.storeFetch(requestId, requestFingerprint, { available: false, replayed: false, bundle: null, reason: 'CLIENT_BLOCKED' }, configKey, 'CLIENT_BLOCKED');
    if (!identity.available) return this.storeFetch(requestId, requestFingerprint, { available: false, replayed: false, bundle: null, reason: 'SESSION_UNAVAILABLE' }, configKey, 'SESSION_UNAVAILABLE');
    const scope = scopeKey(tenantId, configKey);
    const bundle = this.active.get(scope);
    if (!bundle) return this.storeFetch(requestId, requestFingerprint, { available: false, replayed: false, bundle: null, reason: 'CONFIG_NOT_FOUND' }, configKey, 'CONFIG_NOT_FOUND');
    const now = validTimestamp(this.clock(), 'now');
    let result: FetchConfigResult;
    let reason: FetchUnavailableReason | undefined;
    if (compareVersions(resolvedClientVersion, bundle.minClientVersion) < 0) reason = 'CLIENT_OUTDATED';
    else if (bundle.expiresAt !== undefined && now >= bundle.expiresAt) reason = 'EXPIRED';
    else if (!isRolloutEligible(bundle, subjectId)) reason = 'NOT_ELIGIBLE';
    if (reason) result = { available: false, replayed: false, bundle: null, reason };
    else result = { available: true, replayed: false, bundle: clone(bundle) };
    return this.storeFetch(requestId, requestFingerprint, result, configKey, reason);
  }

  rollback(request: RollbackConfigRequest): RollbackConfigResult {
    const requestId = validText(request?.requestId, 'requestId');
    const actorId = validText(request?.actorId, 'actorId');
    const tenantId = validText(request?.tenantId, 'tenantId');
    const configKey = validConfigKey(request?.configKey);
    const targetVersion = request?.targetVersion === undefined ? undefined : validText(request.targetVersion, 'targetVersion');
    if (targetVersion !== undefined) parseVersion(targetVersion);
    const requestFingerprint = fingerprint({ actorId, tenantId, configKey, targetVersion });
    const replay = this.replay<RollbackConfigResult>(requestId, requestFingerprint, 'rollback', configKey);
    if (replay) return replay;
    const scope = scopeKey(tenantId, configKey);
    const versions = this.history.get(scope) ?? [];
    const current = this.active.get(scope);
    const target = targetVersion === undefined
      ? versions.filter((bundle) => current === undefined || compareVersions(bundle.version, current.version) < 0).at(-1)
      : versions.find((bundle) => bundle.version === targetVersion);
    if (!current || !target || compareVersions(target.version, current.version) >= 0) {
      const error = new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.ROLLBACK_UNAVAILABLE, 'rollback target is unavailable');
      this.failedRequests.set(requestId, { operation: 'rollback', fingerprint: requestFingerprint, code: error.code, message: error.message });
      this.recordAudit({ event: 'rollback', requestId, actorId, configKey, outcome: 'rejected', reason: error.message });
      throw error;
    }
    this.ensureAuditCapacity();
    this.active.set(scope, target);
    const result: RollbackConfigResult = { rolledBack: true, replayed: false, bundle: clone(target) };
    this.requests.set(requestId, { operation: 'rollback', fingerprint: requestFingerprint, result });
    this.recordAudit({ event: 'rollback', requestId, actorId, configKey, version: target.version, outcome: 'accepted' });
    return clone(result);
  }

  auditLog(): readonly ConfigAuditEvent[] { return Object.freeze(this.audit.map((entry) => Object.freeze(clone(entry)))); }

  snapshot(): { active: ConfigBundle[]; history: ConfigBundle[] } {
    return clone({ active: [...this.active.values()], history: [...this.history.values()].flat() });
  }

  private storeFetch(requestId: string, requestFingerprint: string, result: FetchConfigResult, configKey: string, reason?: string): FetchConfigResult {
    this.requests.set(requestId, { operation: 'fetch', fingerprint: requestFingerprint, result });
    this.recordAudit({ event: 'fetch', requestId, configKey, outcome: result.available ? 'accepted' : 'unavailable', ...(reason ? { reason } : {}) });
    return clone(result);
  }

  private replay<T extends PublishConfigResult | FetchConfigResult | RollbackConfigResult>(requestId: string, requestFingerprint: string, event: ConfigAuditEvent['event'], configKey: string): T | null {
    const stored = this.requests.get(requestId);
    const failed = this.failedRequests.get(requestId);
    if (stored || failed) {
      const operation = stored?.operation ?? failed?.operation;
      if (operation !== event) {
        const error = new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.REQUEST_ID_REUSED, 'requestId was already used by another config operation');
        this.recordAudit({ event, requestId, configKey, replayed: true, result: 'rejected', outcome: 'rejected', reason: error.message });
        throw error;
      }
      const fingerprintValue = stored?.fingerprint ?? failed?.fingerprint;
      if (fingerprintValue !== requestFingerprint) {
        const error = new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.REQUEST_ID_REUSED, 'requestId was already used for another request');
        this.recordAudit({ event, requestId, configKey, replayed: true, result: 'rejected', outcome: 'rejected', reason: error.message });
        throw error;
      }
      if (failed) {
        const error = new ConfigUpdateError(failed.code, failed.message);
        this.recordAudit({ event, requestId, configKey, replayed: true, result: 'rejected', outcome: 'rejected', reason: error.message });
        throw error;
      }
      this.recordAudit({ event, requestId, configKey, replayed: true, result: 'replayed', outcome: 'replayed' });
      return clone({ ...stored.result, replayed: true }) as T;
    }
    return null;
  }

  private recordAudit(event: Omit<ConfigAuditEvent, 'eventId' | 'at' | 'operation' | 'replayed' | 'result'> & Partial<Pick<ConfigAuditEvent, 'operation' | 'replayed' | 'result'>>): void {
    this.ensureAuditCapacity();
    const operation = event.operation ?? event.event;
    const result = event.result ?? event.outcome;
    this.audit.push(Object.freeze({
      eventId: ++this.auditSequence,
      at: validTimestamp(this.clock(), 'now'),
      ...event,
      operation,
      replayed: event.replayed ?? result === 'replayed',
      result,
    }));
  }

  private ensureAuditCapacity(): void {
    if (this.audit.length >= this.maxAuditEvents) throw new ConfigUpdateError(CONFIG_UPDATE_ERROR_CODES.AUDIT_LIMIT, 'audit event limit reached');
  }
}

export { ConfigUpdateService as ConfigUpdateBackendService };
