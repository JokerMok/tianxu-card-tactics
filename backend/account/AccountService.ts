import { createHash, randomBytes } from 'node:crypto';
import { validateSave } from '../../cocos-client/assets/scripts/services/SaveSchema.ts';

export const ACCOUNT_STATUS = {
  ACTIVE: 'active',
  DELETED: 'deleted',
} as const;

export const ACCOUNT_ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  ACCOUNT_DELETED: 'ACCOUNT_DELETED',
  BINDING_CONFLICT: 'BINDING_CONFLICT',
  NO_BINDING: 'NO_BINDING',
  REQUEST_CONFLICT: 'REQUEST_CONFLICT',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  SAVE_INVALID: 'SAVE_INVALID',
  SESSION_REVOKED: 'SESSION_REVOKED',
  AUTH_PROOF_INVALID: 'AUTH_PROOF_INVALID',
} as const;

export type AccountErrorCode = typeof ACCOUNT_ERROR_CODES[keyof typeof ACCOUNT_ERROR_CODES];
export type AccountStatus = typeof ACCOUNT_STATUS[keyof typeof ACCOUNT_STATUS];

export class AccountError extends Error {
  readonly code: AccountErrorCode;

  constructor(code: AccountErrorCode, message = code) {
    super(message);
    this.name = 'AccountError';
    this.code = code;
  }
}

export interface AccountIdentity {
  accountId: string;
  kind: 'guest' | 'bound';
  status: AccountStatus;
  createdAt: number;
  updatedAt: number;
  bindings: readonly AccountBinding[];
}

export interface AccountBinding {
  provider: string;
  subject: string;
  boundAt: number;
}

export interface Session {
  token: string;
  accountId: string;
  deviceId: string;
  issuedAt: number;
}

export interface GuestRequest {
  deviceId: string;
}

export interface LoginRequest {
  provider: string;
  subject: string;
  proof: string;
  deviceId: string;
}

export interface BindRequest {
  sessionToken: string;
  provider: string;
  subject: string;
  proof: string;
}

export interface DeleteRequest {
  sessionToken: string;
  requestId: string;
}

export interface AccountAuthResult {
  account: AccountIdentity;
  session: Session;
}

export interface DeleteResult {
  deleted: true;
  accountId: string;
  requestId: string;
}

export interface CloudSaveRecord {
  accountId: string;
  version: number;
  updatedAt: number;
  payload: Readonly<Record<string, unknown>>;
  payloadHash: string;
}

export interface CloudSaveLoadResult {
  found: boolean;
  record: CloudSaveRecord | null;
}

export interface CloudSavePutRequest {
  sessionToken: string;
  requestId: string;
  expectedVersion: number;
  save: unknown;
}

export interface CloudSavePutSuccess {
  accepted: true;
  replayed: boolean;
  record: CloudSaveRecord;
}

export interface CloudSavePutConflict {
  accepted: false;
  replayed: false;
  code: 'VERSION_CONFLICT';
  current: CloudSaveRecord | null;
}

export type CloudSavePutResult = CloudSavePutSuccess | CloudSavePutConflict;

interface StoredAccount {
  identity: AccountIdentity;
  bindingKeys: Set<string>;
}

interface StoredRequest {
  fingerprint: string;
  result: CloudSavePutSuccess;
}

export interface AccountServiceOptions {
  now?: () => number;
  accountId?: (kind: 'guest' | 'bound') => string;
  sessionToken?: () => string;
  identityVerifier?: (provider: string, subject: string, proof: string) => boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}

function validId(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim() || value.length > 128) {
    throw new AccountError(ACCOUNT_ERROR_CODES.INVALID_REQUEST, `${label} is invalid`);
  }
  return value;
}

function validNow(value: unknown, label = 'now'): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new AccountError(ACCOUNT_ERROR_CODES.INVALID_REQUEST, `${label} is invalid`);
  }
  return value as number;
}

function bindingKey(provider: string, subject: string): string {
  return `${provider}\u0000${subject}`;
}

function publicIdentity(identity: AccountIdentity): AccountIdentity {
  return clone({ ...identity, bindings: identity.bindings.map((binding) => ({ ...binding })) });
}

function publicSession(session: Session): Session {
  return { ...session };
}

function hashSave(save: Readonly<Record<string, unknown>>): string {
  return createHash('sha256').update(stable(save)).digest('hex');
}

function normalizeSave(accountId: string, value: unknown): Readonly<Record<string, unknown>> {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { throw new AccountError(ACCOUNT_ERROR_CODES.SAVE_INVALID, 'save JSON is invalid'); }
  }
  if (!isRecord(parsed)) throw new AccountError(ACCOUNT_ERROR_CODES.SAVE_INVALID, 'save must be an object');
  if (parsed.playerId !== accountId) throw new AccountError(ACCOUNT_ERROR_CODES.SAVE_INVALID, 'save identity is invalid');
  try {
    return clone(validateSave(parsed)) as Readonly<Record<string, unknown>>;
  } catch (error) {
    throw new AccountError(ACCOUNT_ERROR_CODES.SAVE_INVALID, `save is invalid: ${String(error)}`);
  }
}

function copyRecord(record: CloudSaveRecord | null): CloudSaveRecord | null {
  return record === null ? null : clone(record);
}

export class AccountService {
  private readonly clock: () => number;
  private readonly makeAccountId: (kind: 'guest' | 'bound') => string;
  private readonly makeSessionToken: () => string;
  private readonly verifyIdentity: (provider: string, subject: string, proof: string) => boolean;
  private readonly accounts = new Map<string, StoredAccount>();
  private readonly sessions = new Map<string, Session>();
  private readonly bindings = new Map<string, string>();
  private readonly cloudSaves = new Map<string, CloudSaveRecord>();
  private readonly cloudRequests = new Map<string, Map<string, StoredRequest>>();
  private accountSequence = 0;
  private sessionSequence = 0;

  constructor(options: AccountServiceOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.makeAccountId = options.accountId ?? ((kind) => `${kind}_${++this.accountSequence}`);
    this.makeSessionToken = options.sessionToken ?? (() => `session_${++this.sessionSequence}_${randomBytes(12).toString('hex')}`);
    this.verifyIdentity = options.identityVerifier ?? (() => false);
  }

  createGuest(request: GuestRequest): AccountAuthResult {
    const deviceId = validId(request.deviceId, 'deviceId');
    const now = validNow(this.clock());
    const accountId = validId(this.makeAccountId('guest'), 'accountId');
    if (this.accounts.has(accountId)) throw new AccountError(ACCOUNT_ERROR_CODES.INVALID_REQUEST, 'accountId already exists');
    const identity: AccountIdentity = {
      accountId, kind: 'guest', status: ACCOUNT_STATUS.ACTIVE, createdAt: now, updatedAt: now, bindings: [],
    };
    this.accounts.set(accountId, { identity, bindingKeys: new Set() });
    return { account: publicIdentity(identity), session: this.issueSession(accountId, deviceId, now) };
  }

  bind(request: BindRequest): AccountAuthResult {
    const session = this.requireSession(request.sessionToken);
    const provider = validId(request.provider, 'provider').toLowerCase();
    const subject = validId(request.subject, 'subject');
    const proof = validId(request.proof, 'proof');
    if (!this.verifyIdentitySafely(provider, subject, proof)) throw new AccountError(ACCOUNT_ERROR_CODES.AUTH_PROOF_INVALID, 'identity proof is invalid');
    const now = validNow(this.clock());
    const stored = this.requireAccount(session.accountId);
    const key = bindingKey(provider, subject);
    const owner = this.bindings.get(key);
    if (owner !== undefined && owner !== session.accountId) throw new AccountError(ACCOUNT_ERROR_CODES.BINDING_CONFLICT, 'binding already belongs to another account');
    if (stored.bindingKeys.has(key)) return { account: publicIdentity(stored.identity), session: publicSession(session) };
    const bindings = [...stored.identity.bindings, { provider, subject, boundAt: now }];
    stored.identity = { ...stored.identity, kind: 'bound', bindings, updatedAt: now };
    stored.bindingKeys.add(key);
    this.bindings.set(key, session.accountId);
    return { account: publicIdentity(stored.identity), session: publicSession(session) };
  }

  login(request: LoginRequest): AccountAuthResult {
    const provider = validId(request.provider, 'provider').toLowerCase();
    const subject = validId(request.subject, 'subject');
    const proof = validId(request.proof, 'proof');
    const deviceId = validId(request.deviceId, 'deviceId');
    if (!this.verifyIdentitySafely(provider, subject, proof)) throw new AccountError(ACCOUNT_ERROR_CODES.AUTH_PROOF_INVALID, 'identity proof is invalid');
    const now = validNow(this.clock());
    const accountId = this.bindings.get(bindingKey(provider, subject));
    if (accountId === undefined) throw new AccountError(ACCOUNT_ERROR_CODES.NO_BINDING, 'account binding was not found');
    const account = this.requireAccount(accountId);
    return { account: publicIdentity(account.identity), session: this.issueSession(accountId, deviceId, now) };
  }

  logout(sessionToken: string): { loggedOut: true } {
    validId(sessionToken, 'sessionToken');
    if (!this.sessions.delete(sessionToken)) throw new AccountError(ACCOUNT_ERROR_CODES.SESSION_REVOKED, 'session is already revoked');
    return { loggedOut: true };
  }

  deleteAccount(request: DeleteRequest): DeleteResult {
    const session = this.requireSession(request.sessionToken);
    const requestId = validId(request.requestId, 'requestId');
    const now = validNow(this.clock());
    const account = this.requireAccount(session.accountId);
    const deletedIdentity: AccountIdentity = { ...account.identity, status: ACCOUNT_STATUS.DELETED, updatedAt: now };
    account.identity = deletedIdentity;
    for (const key of account.bindingKeys) this.bindings.delete(key);
    for (const [token, candidate] of this.sessions) if (candidate.accountId === session.accountId) this.sessions.delete(token);
    this.cloudSaves.delete(session.accountId);
    this.cloudRequests.delete(session.accountId);
    return { deleted: true, accountId: session.accountId, requestId };
  }

  loadCloudSave(sessionToken: string): CloudSaveLoadResult {
    const session = this.requireSession(sessionToken);
    return { found: this.cloudSaves.has(session.accountId), record: copyRecord(this.cloudSaves.get(session.accountId) ?? null) };
  }

  putCloudSave(request: CloudSavePutRequest): CloudSavePutResult {
    const session = this.requireSession(request.sessionToken);
    const requestId = validId(request.requestId, 'requestId');
    if (!Number.isSafeInteger(request.expectedVersion) || request.expectedVersion < 0) {
      throw new AccountError(ACCOUNT_ERROR_CODES.INVALID_REQUEST, 'expectedVersion is invalid');
    }
    const payload = normalizeSave(session.accountId, request.save);
    const now = validNow(this.clock());
    const fingerprint = stable({ expectedVersion: request.expectedVersion, payload });
    const requestLedger = this.cloudRequests.get(session.accountId) ?? new Map<string, StoredRequest>();
    const previous = requestLedger.get(requestId);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) throw new AccountError(ACCOUNT_ERROR_CODES.REQUEST_CONFLICT, 'requestId was reused with different data');
      return { ...clone(previous.result), replayed: true, record: copyRecord(previous.result.record) as CloudSaveRecord };
    }
    const current = this.cloudSaves.get(session.accountId) ?? null;
    const currentVersion = current?.version ?? 0;
    if (request.expectedVersion !== currentVersion) {
      return { accepted: false, replayed: false, code: 'VERSION_CONFLICT', current: copyRecord(current) };
    }
    const record: CloudSaveRecord = {
      accountId: session.accountId,
      version: currentVersion + 1,
      updatedAt: now,
      payload,
      payloadHash: hashSave(payload),
    };
    const result: CloudSavePutSuccess = { accepted: true, replayed: false, record };
    this.cloudSaves.set(session.accountId, record);
    requestLedger.set(requestId, { fingerprint, result: clone(result) });
    this.cloudRequests.set(session.accountId, requestLedger);
    return clone(result);
  }

  snapshot(): { accounts: AccountIdentity[]; cloudSaves: CloudSaveRecord[] } {
    return {
      accounts: [...this.accounts.values()].map(({ identity }) => publicIdentity(identity)),
      cloudSaves: [...this.cloudSaves.values()].map((record) => clone(record)),
    };
  }

  private issueSession(accountId: string, deviceId: string, issuedAt: number): Session {
    const token = validId(this.makeSessionToken(), 'sessionToken');
    if (this.sessions.has(token)) throw new AccountError(ACCOUNT_ERROR_CODES.INVALID_REQUEST, 'session token collision');
    const session: Session = { token, accountId, deviceId, issuedAt };
    this.sessions.set(token, session);
    return publicSession(session);
  }

  private requireSession(token: unknown): Session {
    const sessionToken = validId(token, 'sessionToken');
    const session = this.sessions.get(sessionToken);
    if (session === undefined) throw new AccountError(ACCOUNT_ERROR_CODES.UNAUTHENTICATED, 'session is not valid');
    this.requireAccount(session.accountId);
    return session;
  }

  private verifyIdentitySafely(provider: string, subject: string, proof: string): boolean {
    try { return this.verifyIdentity(provider, subject, proof) === true; } catch { return false; }
  }

  private requireAccount(accountId: string): StoredAccount {
    const account = this.accounts.get(accountId);
    if (account === undefined) throw new AccountError(ACCOUNT_ERROR_CODES.UNAUTHENTICATED, 'account is not valid');
    if (account.identity.status !== ACCOUNT_STATUS.ACTIVE) throw new AccountError(ACCOUNT_ERROR_CODES.ACCOUNT_DELETED, 'account is deleted');
    return account;
  }
}

export const AccountCloudService = AccountService;
export const CloudSaveService = AccountService;
