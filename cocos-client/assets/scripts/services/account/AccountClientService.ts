import { createDefaultSave, validateSave, type SaveData } from '../SaveSchema.ts';

export interface AccountClientTransport {
  createGuest(request: { deviceId: string }): AccountAuthResult;
  bind(request: { sessionToken: string; provider: string; subject: string; proof: string }): AccountAuthResult;
  login(request: { provider: string; subject: string; proof: string; deviceId: string }): AccountAuthResult;
  logout(sessionToken: string): { loggedOut: true };
  deleteAccount(request: { sessionToken: string; requestId: string }): DeleteResult;
  loadCloudSave(sessionToken: string): CloudSaveLoadResult;
  putCloudSave(request: CloudSavePutRequest): CloudSavePutResult;
}

export interface AccountIdentity {
  accountId: string;
  kind: 'guest' | 'bound';
  status: 'active' | 'deleted';
  createdAt: number;
  updatedAt: number;
  bindings: readonly { provider: string; subject: string; boundAt: number }[];
}

export interface Session {
  token: string;
  accountId: string;
  deviceId: string;
  issuedAt: number;
}

export interface AccountAuthResult { account: AccountIdentity; session: Session }
export interface DeleteResult { deleted: true; accountId: string; requestId: string }
export interface CloudSaveRecord {
  accountId: string;
  version: number;
  updatedAt: number;
  payload: Readonly<Record<string, unknown>>;
  payloadHash: string;
}
export interface CloudSaveLoadResult { found: boolean; record: CloudSaveRecord | null }
export interface CloudSavePutRequest {
  sessionToken: string;
  requestId: string;
  expectedVersion: number;
  save: SaveData;
}
export interface CloudSavePutResult {
  accepted: boolean;
  replayed: boolean;
  code?: 'VERSION_CONFLICT';
  record?: CloudSaveRecord;
  current?: CloudSaveRecord | null;
}

export class AccountClientError extends Error {
  constructor(message: string) { super(message); this.name = 'AccountClientError'; }
}

export interface AccountClientOptions {
  deviceId: string;
  now?: () => number;
}

function copy<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) throw new AccountClientError(`${label} is invalid`);
  return value;
}

export class AccountClientService {
  private readonly transport: AccountClientTransport;
  private readonly deviceId: string;
  private readonly clock: () => number;
  private currentAccount: AccountIdentity | null = null;
  private currentSession: Session | null = null;
  private cloudVersion = 0;

  constructor(transport: AccountClientTransport, options: AccountClientOptions) {
    this.transport = transport;
    this.deviceId = requiredText(options.deviceId, 'deviceId');
    this.clock = options.now ?? (() => Date.now());
  }

  guest(): AccountAuthResult {
    return this.acceptAuth(this.transport.createGuest({ deviceId: this.deviceId }));
  }

  bind(provider: string, subject: string, proof: string): AccountAuthResult {
    return this.acceptAuth(this.transport.bind({ sessionToken: this.requireSession(), provider, subject, proof }));
  }

  login(provider: string, subject: string, proof: string): AccountAuthResult {
    return this.acceptAuth(this.transport.login({ provider, subject, proof, deviceId: this.deviceId }));
  }

  logout(): { loggedOut: true } {
    const result = this.transport.logout(this.requireSession());
    this.clearLocalSession();
    return result;
  }

  deleteAccount(requestId: string): DeleteResult {
    const result = this.transport.deleteAccount({ sessionToken: this.requireSession(), requestId });
    this.clearLocalSession();
    return result;
  }

  account(): AccountIdentity | null { return copy(this.currentAccount); }
  session(): Session | null { return copy(this.currentSession); }

  loadCloudSave(): CloudSaveRecord | null {
    const result = this.transport.loadCloudSave(this.requireSession());
    this.cloudVersion = result.record?.version ?? 0;
    return copy(result.record);
  }

  saveCloudSave(save: SaveData, requestId: string, expectedVersion = this.cloudVersion): CloudSavePutResult {
    const validated = validateSave(save);
    const account = this.currentAccount;
    if (account === null || validated.playerId !== account.accountId) throw new AccountClientError('save playerId does not match the authenticated account');
    requiredText(requestId, 'requestId');
    const result = this.transport.putCloudSave({
      sessionToken: this.requireSession(), requestId, expectedVersion, save: validated,
    });
    if (result.accepted && result.record) this.cloudVersion = result.record.version;
    return copy(result);
  }

  newSave(): SaveData {
    const account = this.currentAccount;
    if (account === null) throw new AccountClientError('account is not authenticated');
    return createDefaultSave(account.accountId, this.clock());
  }

  private acceptAuth(result: AccountAuthResult): AccountAuthResult {
    this.currentAccount = copy(result.account);
    this.currentSession = copy(result.session);
    this.cloudVersion = 0;
    return { account: this.account() as AccountIdentity, session: this.session() as Session };
  }

  private requireSession(): string {
    if (this.currentSession === null) throw new AccountClientError('account is not authenticated');
    return this.currentSession.token;
  }

  private clearLocalSession(): void {
    this.currentAccount = null;
    this.currentSession = null;
    this.cloudVersion = 0;
  }
}

export const AccountService = AccountClientService;
export const CloudSaveService = AccountClientService;
