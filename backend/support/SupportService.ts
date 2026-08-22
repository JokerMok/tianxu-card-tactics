import { createHash } from 'node:crypto';

export const SUPPORT_SCHEMA_VERSION = 1 as const;

export const SUPPORT_ROLES = Object.freeze(['player', 'agent', 'admin'] as const);
export type SupportRole = typeof SUPPORT_ROLES[number];

export const TICKET_STATUSES = Object.freeze(['open', 'pending', 'resolved', 'closed'] as const);
export type TicketStatus = typeof TICKET_STATUSES[number];
export const TICKET_CATEGORIES = Object.freeze(['account', 'billing', 'bug', 'technical', 'other'] as const);
export type TicketCategory = typeof TICKET_CATEGORIES[number];
export const COMPENSATION_STATUSES = Object.freeze(['pending', 'approved', 'rejected'] as const);
export type CompensationStatus = typeof COMPENSATION_STATUSES[number];

export const SUPPORT_ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  REQUEST_ID_REUSED: 'REQUEST_ID_REUSED',
  RATE_LIMITED: 'RATE_LIMITED',
  TICKET_CLOSED: 'TICKET_CLOSED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  COMPENSATION_ALREADY_DECIDED: 'COMPENSATION_ALREADY_DECIDED',
  SELF_APPROVAL: 'SELF_APPROVAL',
  MAIL_EXPIRED: 'MAIL_EXPIRED',
  MAIL_ALREADY_CLAIMED: 'MAIL_ALREADY_CLAIMED',
  PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export type SupportErrorCode = typeof SUPPORT_ERROR_CODES[keyof typeof SUPPORT_ERROR_CODES];

export class SupportError extends Error {
  readonly code: SupportErrorCode;
  readonly retryAfterMs?: number;

  constructor(code: SupportErrorCode, message = code, retryAfterMs?: number) {
    super(message);
    this.name = 'SupportError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

export interface SupportActor {
  readonly actorId: string;
  readonly role: SupportRole;
  readonly accountId?: string;
}

export interface SupportMessage {
  readonly messageId: string;
  readonly authorId: string;
  readonly authorRole: SupportRole;
  readonly body: string;
  readonly createdAt: number;
}

export interface Ticket {
  readonly ticketId: string;
  readonly accountId: string;
  readonly category: TicketCategory;
  readonly subject: string;
  readonly messages: readonly SupportMessage[];
  readonly status: TicketStatus;
  readonly assignedTo: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface ResourceGrant {
  readonly resourceId: string;
  readonly amount: number;
}

export interface Mail {
  readonly mailId: string;
  readonly accountId: string;
  readonly source: 'support' | 'compensation';
  readonly title: string;
  readonly body: string;
  readonly attachments: readonly ResourceGrant[];
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly ticketId: string | null;
  readonly compensationId: string | null;
  readonly claimedAt: number | null;
}

export interface Compensation {
  readonly compensationId: string;
  readonly accountId: string;
  readonly ticketId: string | null;
  readonly reason: string;
  readonly resources: readonly ResourceGrant[];
  readonly status: CompensationStatus;
  readonly createdBy: string;
  readonly approvedBy: string | null;
  readonly rejectedBy: string | null;
  readonly mailId: string | null;
  readonly createdAt: number;
  readonly decidedAt: number | null;
}

export interface ResourceLedgerEntry {
  readonly entryId: string;
  readonly accountId: string;
  readonly resourceId: string;
  readonly amount: number;
  readonly sourceType: 'mail';
  readonly sourceId: string;
  readonly requestId: string;
  readonly createdAt: number;
}

export interface AuditEvent {
  readonly auditId: string;
  readonly actorId: string;
  readonly actorRole: SupportRole;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly requestId: string | null;
  readonly outcome: 'accepted' | 'replayed' | 'rejected';
  readonly reasonCode: SupportErrorCode | null;
  readonly createdAt: number;
}

export interface CreateTicketRequest {
  readonly sessionToken: string;
  readonly requestId: string;
  readonly category: TicketCategory;
  readonly subject: string;
  readonly body: string;
}
export interface TicketListRequest {
  readonly sessionToken: string;
  readonly accountId?: string;
  readonly status?: TicketStatus;
  readonly limit?: number;
  readonly cursor?: string;
}
export interface GetTicketRequest { readonly sessionToken: string; readonly ticketId: string; }
export interface ReplyTicketRequest {
  readonly actorToken: string;
  readonly requestId: string;
  readonly ticketId: string;
  readonly body: string;
}
export interface SetTicketStatusRequest {
  readonly actorToken: string;
  readonly requestId: string;
  readonly ticketId: string;
  readonly status: TicketStatus;
  readonly assignedTo?: string | null;
}
export interface CreateMailRequest {
  readonly actorToken: string;
  readonly requestId: string;
  readonly accountId: string;
  readonly title: string;
  readonly body: string;
  readonly attachments: readonly ResourceGrant[];
  readonly expiresAt: number | null;
  readonly ticketId?: string | null;
}
export interface MailListRequest {
  readonly sessionToken: string;
  readonly accountId?: string;
  readonly includeClaimed?: boolean;
  readonly limit?: number;
  readonly cursor?: string;
}
export interface ClaimMailRequest { readonly sessionToken: string; readonly requestId: string; readonly mailId: string; }
export interface CreateCompensationRequest {
  readonly actorToken: string;
  readonly requestId: string;
  readonly accountId: string;
  readonly ticketId?: string | null;
  readonly reason: string;
  readonly resources: readonly ResourceGrant[];
}
export interface DecideCompensationRequest {
  readonly actorToken: string;
  readonly requestId: string;
  readonly compensationId: string;
}
export interface GetCompensationRequest { readonly actorToken: string; readonly compensationId: string; }
export interface LedgerQueryRequest {
  readonly actorToken: string;
  readonly accountId?: string;
  readonly resourceId?: string;
  readonly fromCreatedAt?: number;
  readonly toCreatedAt?: number;
  readonly limit?: number;
  readonly cursor?: string;
}
export interface AuditQueryRequest {
  readonly actorToken: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly limit?: number;
  readonly cursor?: string;
}

export interface MutationResult<T> { readonly value: T; readonly replayed: boolean; }
export interface TicketListResult { readonly tickets: readonly Ticket[]; readonly nextCursor: string | null; }
export interface MailListResult { readonly mails: readonly Mail[]; readonly nextCursor: string | null; }
export interface ClaimMailResult {
  readonly mailId: string;
  readonly claimed: boolean;
  readonly idempotent: boolean;
  readonly ledgerEntries: readonly ResourceLedgerEntry[];
}
export interface LedgerQueryResult {
  readonly entries: readonly ResourceLedgerEntry[];
  readonly totals: Readonly<Record<string, number>>;
  readonly nextCursor: string | null;
}
export interface AuditQueryResult { readonly events: readonly AuditEvent[]; readonly nextCursor: string | null; }

export interface SupportSnapshot {
  readonly schemaVersion: typeof SUPPORT_SCHEMA_VERSION;
  readonly tickets: readonly Ticket[];
  readonly mails: readonly Mail[];
  readonly compensations: readonly Compensation[];
  readonly ledger: readonly ResourceLedgerEntry[];
  readonly audit: readonly AuditEvent[];
}

export interface RateLimitRule { readonly max: number; readonly windowMs: number; }
export interface SupportServiceOptions {
  readonly now?: () => number;
  readonly actorResolver?: (token: string) => SupportActor | null;
  readonly idGenerator?: (kind: string, sequence: number) => string;
  readonly adminDiagnosticToken?: string;
  readonly persist?: (snapshot: SupportSnapshot) => void;
  readonly rateLimits?: Partial<Record<MutationName, RateLimitRule>>;
}

type MutationName = 'createTicket' | 'replyTicket' | 'setTicketStatus' | 'createMail' | 'claimMail' | 'createCompensation' | 'approveCompensation' | 'rejectCompensation';
type StoredRequest = { readonly fingerprint: string; readonly result?: unknown; readonly error?: { readonly code: SupportErrorCode; readonly message: string; readonly retryAfterMs?: number } };

const DEFAULT_RATE_LIMITS: Readonly<Record<MutationName, RateLimitRule>> = Object.freeze({
  createTicket: Object.freeze({ max: 3, windowMs: 60 * 60 * 1000 }),
  replyTicket: Object.freeze({ max: 20, windowMs: 60 * 60 * 1000 }),
  setTicketStatus: Object.freeze({ max: 60, windowMs: 60 * 60 * 1000 }),
  createMail: Object.freeze({ max: 100, windowMs: 60 * 60 * 1000 }),
  claimMail: Object.freeze({ max: 20, windowMs: 10 * 60 * 1000 }),
  createCompensation: Object.freeze({ max: 20, windowMs: 60 * 60 * 1000 }),
  approveCompensation: Object.freeze({ max: 100, windowMs: 60 * 60 * 1000 }),
  rejectCompensation: Object.freeze({ max: 100, windowMs: 60 * 60 * 1000 }),
});
const MAX_PAGE_SIZE = 100;
const MAX_RESOURCE_AMOUNT = 1_000_000_000;
const COMPENSATION_MAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}
function clone<T>(value: T): T { return structuredClone(value); }
function fail(code: SupportErrorCode, message = code): never { throw new SupportError(code, message); }
function assertKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `${label}.${key} is not allowed`);
}
function text(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value !== value.trim() || CONTROL_CHARS.test(value)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `${label} is invalid`);
  return value;
}
function identifier(value: unknown, label: string): string { return text(value, label, 128); }
function safeTime(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `${label} is invalid`);
  return value as number;
}
function nonNegativeInteger(value: unknown, label: string, max = MAX_RESOURCE_AMOUNT): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `${label} is invalid`);
  return value as number;
}
function resourceId(value: unknown): string {
  const id = identifier(value, 'resourceId');
  if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(id)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'resourceId is invalid');
  if (id in Object.prototype) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'resourceId is reserved');
  return id;
}
function actor(value: unknown): SupportActor {
  if (!isPlainRecord(value)) fail(SUPPORT_ERROR_CODES.UNAUTHENTICATED, 'actor is invalid');
  assertKeys(value, ['actorId', 'role', 'accountId'], 'actor');
  const actorId = identifier(value.actorId, 'actorId');
  if (!SUPPORT_ROLES.includes(value.role as SupportRole)) fail(SUPPORT_ERROR_CODES.UNAUTHENTICATED, 'actor role is invalid');
  const result: SupportActor = { actorId, role: value.role as SupportRole };
  if (value.accountId !== undefined) return { ...result, accountId: identifier(value.accountId, 'accountId') };
  return result;
}
function grants(value: unknown, label: string, minimum = 1): readonly ResourceGrant[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 20) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `${label} is invalid`);
  const seen = new Set<string>();
  return value.map((raw, index) => {
    if (!isPlainRecord(raw)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `${label}[${index}] is invalid`);
    assertKeys(raw, ['resourceId', 'amount'], `${label}[${index}]`);
    const id = resourceId(raw.resourceId);
    if (seen.has(id)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `${label} contains duplicate resourceId`);
    seen.add(id);
    const amount = nonNegativeInteger(raw.amount, `${label}[${index}].amount`);
    if (amount < 1) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `${label}[${index}].amount is invalid`);
    return Object.freeze({ resourceId: id, amount });
  });
}
function optionalNullableTime(value: unknown, label: string): number | null {
  if (value === null) return null;
  return safeTime(value, label);
}
function stable(value: unknown, seen = new Set<object>()): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
    if (typeof value === 'number' && !Number.isFinite(value)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'request contains a non-finite value');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || seen.has(value)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'request must be acyclic JSON data');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((child) => stable(child, seen)).join(',')}]`;
    if (!isPlainRecord(value)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'request must contain plain objects');
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key], seen)}`).join(',')}}`;
  } finally { seen.delete(value); }
}
function fingerprint(input: unknown, secretKey: 'sessionToken' | 'actorToken'): string {
  if (!isPlainRecord(input)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'request must be a plain object');
  const copyInput = { ...input };
  delete copyInput[secretKey];
  return createHash('sha256').update(stable(copyInput)).digest('hex');
}
function page(value: unknown, label: string): number {
  if (value === undefined) return 50;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > MAX_PAGE_SIZE) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `${label} is invalid`);
  return value as number;
}
function cursor(value: unknown, label: string): string | undefined { return value === undefined ? undefined : identifier(value, label); }
function copyTicket(ticket: Ticket): Ticket { return clone(ticket); }
function copyMail(mail: Mail): Mail { return clone(mail); }
function copyCompensation(compensation: Compensation): Compensation { return clone(compensation); }

interface InternalSnapshot {
  tickets: Ticket[]; mails: Mail[]; compensations: Compensation[]; ledger: ResourceLedgerEntry[]; audit: AuditEvent[];
  requests: [string, StoredRequest][]; rates: [string, number[]][]; sequences: Record<string, number>;
}

export class SupportService {
  private readonly clock: () => number;
  private readonly resolveActor: (token: string) => SupportActor | null;
  private readonly makeId: (kind: string, sequence: number) => string;
  private readonly adminDiagnosticToken: string | null;
  private readonly persist?: (snapshot: SupportSnapshot) => void;
  private readonly rateLimits: Readonly<Record<MutationName, RateLimitRule>>;
  private readonly tickets = new Map<string, Ticket>();
  private readonly mails = new Map<string, Mail>();
  private readonly compensations = new Map<string, Compensation>();
  private readonly ledger: ResourceLedgerEntry[] = [];
  private readonly audit: AuditEvent[] = [];
  private readonly requests = new Map<string, StoredRequest>();
  private readonly rates = new Map<string, number[]>();
  private sequences: Record<string, number> = Object.create(null) as Record<string, number>;
  private persistenceInProgress = false;

  constructor(options: SupportServiceOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.resolveActor = options.actorResolver ?? (() => null);
    this.makeId = options.idGenerator ?? ((kind, sequence) => `${kind}_${sequence}`);
    this.adminDiagnosticToken = options.adminDiagnosticToken === undefined ? null : identifier(options.adminDiagnosticToken, 'adminDiagnosticToken');
    this.persist = options.persist;
    const configured = options.rateLimits ?? {};
    const all = {} as Record<MutationName, RateLimitRule>;
    for (const name of Object.keys(DEFAULT_RATE_LIMITS) as MutationName[]) {
      const rule = configured[name] ?? DEFAULT_RATE_LIMITS[name];
      if (!Number.isSafeInteger(rule.max) || rule.max < 1 || !Number.isSafeInteger(rule.windowMs) || rule.windowMs < 1) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `rate limit ${name} is invalid`);
      all[name] = Object.freeze({ max: rule.max, windowMs: rule.windowMs });
    }
    this.rateLimits = Object.freeze(all);
  }

  createTicket(request: CreateTicketRequest): MutationResult<Ticket> {
    const input = this.prepare(request, 'sessionToken', ['sessionToken', 'requestId', 'category', 'subject', 'body'], ['sessionToken', 'requestId', 'category', 'subject', 'body']);
    const current = this.requirePlayer(input.sessionToken);
    const id = identifier(input.requestId, 'requestId');
    return this.mutate(current, 'createTicket', id, fingerprint(input, 'sessionToken'), () => {
      const category = input.category as unknown;
      if (!TICKET_CATEGORIES.includes(category as TicketCategory)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'category is invalid');
      const subject = text(input.subject, 'subject', 160); const body = text(input.body, 'body', 4000); const now = this.now();
      this.consumeRate(current, 'createTicket', now);
      const ticketId = this.nextId('ticket'); const messageId = this.nextId('message');
      const ticket: Ticket = { ticketId, accountId: current.accountId as string, category: category as TicketCategory, subject,
        messages: [{ messageId, authorId: current.actorId, authorRole: 'player', body, createdAt: now }], status: 'open', assignedTo: null, createdAt: now, updatedAt: now };
      this.tickets.set(ticketId, ticket); return ticket;
    }, 'ticket', (ticket) => ticket.ticketId);
  }

  listTickets(request: TicketListRequest): TicketListResult {
    const input = this.prepare(request, 'sessionToken', ['sessionToken', 'accountId', 'status', 'limit', 'cursor'], ['sessionToken']);
    const current = this.requireActor(input.sessionToken);
    const accountId = current.role === 'player' ? current.accountId : input.accountId === undefined ? undefined : identifier(input.accountId, 'accountId');
    if (current.role === 'player' && input.accountId !== undefined && input.accountId !== current.accountId) fail(SUPPORT_ERROR_CODES.FORBIDDEN, 'player cannot query another account');
    if (current.role === 'player' && accountId === undefined) fail(SUPPORT_ERROR_CODES.UNAUTHENTICATED, 'player account is missing');
    if (current.role === 'player' ? false : current.role !== 'agent' && current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    const status = input.status === undefined ? undefined : input.status as TicketStatus;
    if (status !== undefined && !TICKET_STATUSES.includes(status)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'status is invalid');
    return this.pageTickets(this.ticketsFor(accountId, status), page(input.limit, 'limit'), cursor(input.cursor, 'cursor'));
  }

  getTicket(request: GetTicketRequest): Ticket {
    const input = this.prepare(request, 'sessionToken', ['sessionToken', 'ticketId'], ['sessionToken', 'ticketId']); const current = this.requireActor(input.sessionToken);
    const ticket = this.tickets.get(identifier(input.ticketId, 'ticketId')); if (!ticket) fail(SUPPORT_ERROR_CODES.NOT_FOUND, 'ticket was not found');
    if (current.role === 'player' && ticket.accountId !== current.accountId) fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    if (current.role !== 'player' && current.role !== 'agent' && current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    return copyTicket(ticket);
  }

  replyTicket(request: ReplyTicketRequest): MutationResult<Ticket> {
    const input = this.prepare(request, 'actorToken', ['actorToken', 'requestId', 'ticketId', 'body'], ['actorToken', 'requestId', 'ticketId', 'body']); const current = this.requireActor(input.actorToken);
    const id = identifier(input.requestId, 'requestId'); const ticketId = identifier(input.ticketId, 'ticketId');
    return this.mutate(current, 'replyTicket', id, fingerprint(input, 'actorToken'), () => {
      const ticket = this.tickets.get(ticketId); if (!ticket) fail(SUPPORT_ERROR_CODES.NOT_FOUND, 'ticket was not found');
      if (current.role === 'player' && ticket.accountId !== current.accountId) fail(SUPPORT_ERROR_CODES.FORBIDDEN);
      if (current.role !== 'player' && current.role !== 'agent' && current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
      if (ticket.status === 'closed') fail(SUPPORT_ERROR_CODES.TICKET_CLOSED);
      const body = text(input.body, 'body', 4000); const now = this.now(); this.consumeRate(current, 'replyTicket', now);
      const message: SupportMessage = { messageId: this.nextId('message'), authorId: current.actorId, authorRole: current.role, body, createdAt: now };
      const nextStatus: TicketStatus = current.role === 'player' ? 'open' : ticket.status === 'open' ? 'pending' : ticket.status;
      const next: Ticket = { ...ticket, messages: [...ticket.messages, message], status: nextStatus, updatedAt: now };
      this.tickets.set(ticketId, next); return next;
    }, 'ticket', ticketId);
  }

  setTicketStatus(request: SetTicketStatusRequest): MutationResult<Ticket> {
    const input = this.prepare(request, 'actorToken', ['actorToken', 'requestId', 'ticketId', 'status', 'assignedTo'], ['actorToken', 'requestId', 'ticketId', 'status']); const current = this.requireActor(input.actorToken);
    if (current.role !== 'agent' && current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    const id = identifier(input.requestId, 'requestId'); const ticketId = identifier(input.ticketId, 'ticketId');
    return this.mutate(current, 'setTicketStatus', id, fingerprint(input, 'actorToken'), () => {
      const ticket = this.tickets.get(ticketId); if (!ticket) fail(SUPPORT_ERROR_CODES.NOT_FOUND, 'ticket was not found');
      const status = input.status as TicketStatus; if (!TICKET_STATUSES.includes(status)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'status is invalid');
      if (ticket.status === 'closed' && status !== 'closed') fail(SUPPORT_ERROR_CODES.INVALID_TRANSITION, 'closed ticket cannot be reopened');
      const assignedTo = input.assignedTo === undefined ? ticket.assignedTo : input.assignedTo === null ? null : identifier(input.assignedTo, 'assignedTo');
      const now = this.now(); this.consumeRate(current, 'setTicketStatus', now);
      const next: Ticket = { ...ticket, status, assignedTo, updatedAt: now }; this.tickets.set(ticketId, next); return next;
    }, 'ticket', ticketId);
  }

  createMail(request: CreateMailRequest): MutationResult<Mail> {
    const input = this.prepare(request, 'actorToken', ['actorToken', 'requestId', 'accountId', 'title', 'body', 'attachments', 'expiresAt', 'ticketId'], ['actorToken', 'requestId', 'accountId', 'title', 'body', 'attachments', 'expiresAt']); const current = this.requireActor(input.actorToken);
    if (current.role !== 'agent' && current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    const id = identifier(input.requestId, 'requestId');
    return this.mutate(current, 'createMail', id, fingerprint(input, 'actorToken'), () => {
      const accountId = identifier(input.accountId, 'accountId'); const title = text(input.title, 'title', 160); const body = text(input.body, 'body', 4000);
      const attachments = grants(input.attachments, 'attachments', 0); const expiresAt = optionalNullableTime(input.expiresAt, 'expiresAt'); const now = this.now();
      if (expiresAt !== null && expiresAt <= now) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'expiresAt must be in the future');
      const ticketId = input.ticketId === undefined || input.ticketId === null ? null : identifier(input.ticketId, 'ticketId');
      if (ticketId !== null && !this.tickets.has(ticketId)) fail(SUPPORT_ERROR_CODES.NOT_FOUND, 'ticket was not found');
      this.consumeRate(current, 'createMail', now); const mail: Mail = { mailId: this.nextId('mail'), accountId, source: 'support', title, body, attachments, createdAt: now, expiresAt, ticketId, compensationId: null, claimedAt: null };
      this.mails.set(mail.mailId, mail); return mail;
    }, 'mail', (mail) => mail.mailId);
  }

  listMail(request: MailListRequest): MailListResult {
    const input = this.prepare(request, 'sessionToken', ['sessionToken', 'accountId', 'includeClaimed', 'limit', 'cursor'], ['sessionToken']); const current = this.requireActor(input.sessionToken);
    const accountId = current.role === 'player' ? current.accountId : input.accountId === undefined ? undefined : identifier(input.accountId, 'accountId');
    if (current.role === 'player' && input.accountId !== undefined && input.accountId !== current.accountId) fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    if (current.role === 'player' && accountId === undefined) fail(SUPPORT_ERROR_CODES.UNAUTHENTICATED, 'player account is missing');
    if (current.role !== 'player' && current.role !== 'agent' && current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    const includeClaimed = input.includeClaimed === undefined ? false : input.includeClaimed;
    if (typeof includeClaimed !== 'boolean') fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'includeClaimed is invalid');
    const mails = [...this.mails.values()].filter((mail) => (accountId === undefined || mail.accountId === accountId) && (includeClaimed || mail.claimedAt === null)).sort((a, b) => a.createdAt - b.createdAt || a.mailId.localeCompare(b.mailId));
    return this.pageMails(mails, page(input.limit, 'limit'), cursor(input.cursor, 'cursor'));
  }

  claimMail(request: ClaimMailRequest): MutationResult<ClaimMailResult> {
    const input = this.prepare(request, 'sessionToken', ['sessionToken', 'requestId', 'mailId'], ['sessionToken', 'requestId', 'mailId']); const current = this.requirePlayer(input.sessionToken);
    const id = identifier(input.requestId, 'requestId'); const mailId = identifier(input.mailId, 'mailId');
    return this.mutate(current, 'claimMail', id, fingerprint(input, 'sessionToken'), () => {
      const mail = this.mails.get(mailId); if (!mail) fail(SUPPORT_ERROR_CODES.NOT_FOUND, 'mail was not found');
      if (mail.accountId !== current.accountId) fail(SUPPORT_ERROR_CODES.FORBIDDEN);
      if (mail.claimedAt !== null) return { mailId, claimed: false, idempotent: true, ledgerEntries: this.ledger.filter((entry) => entry.sourceId === mailId).map(clone) };
      const now = this.now(); if (mail.expiresAt !== null && now >= mail.expiresAt) fail(SUPPORT_ERROR_CODES.MAIL_EXPIRED, 'mail has expired');
      this.consumeRate(current, 'claimMail', now);
      const entries = mail.attachments.map((grant) => ({ entryId: this.nextId('ledger'), accountId: mail.accountId, resourceId: grant.resourceId, amount: grant.amount, sourceType: 'mail' as const, sourceId: mail.mailId, requestId: id, createdAt: now }));
      this.ledger.push(...entries); this.mails.set(mailId, { ...mail, claimedAt: now });
      return { mailId, claimed: true, idempotent: false, ledgerEntries: entries };
    }, 'mail', mailId);
  }

  createCompensation(request: CreateCompensationRequest): MutationResult<Compensation> {
    const input = this.prepare(request, 'actorToken', ['actorToken', 'requestId', 'accountId', 'ticketId', 'reason', 'resources'], ['actorToken', 'requestId', 'accountId', 'reason', 'resources']); const current = this.requireActor(input.actorToken);
    if (current.role !== 'agent' && current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    const id = identifier(input.requestId, 'requestId');
    return this.mutate(current, 'createCompensation', id, fingerprint(input, 'actorToken'), () => {
      const accountId = identifier(input.accountId, 'accountId'); const ticketId = input.ticketId === undefined || input.ticketId === null ? null : identifier(input.ticketId, 'ticketId');
      if (ticketId !== null && !this.tickets.has(ticketId)) fail(SUPPORT_ERROR_CODES.NOT_FOUND, 'ticket was not found');
      const reason = text(input.reason, 'reason', 1000); const resources = grants(input.resources, 'resources'); const now = this.now(); this.consumeRate(current, 'createCompensation', now);
      const compensation: Compensation = { compensationId: this.nextId('compensation'), accountId, ticketId, reason, resources, status: 'pending', createdBy: current.actorId, approvedBy: null, rejectedBy: null, mailId: null, createdAt: now, decidedAt: null };
      this.compensations.set(compensation.compensationId, compensation); return compensation;
    }, 'compensation', (compensation) => compensation.compensationId);
  }

  approveCompensation(request: DecideCompensationRequest): MutationResult<Compensation> {
    return this.decideCompensation(request, 'approve');
  }
  rejectCompensation(request: DecideCompensationRequest): MutationResult<Compensation> {
    return this.decideCompensation(request, 'reject');
  }

  getCompensation(request: GetCompensationRequest): Compensation {
    const input = this.prepare(request, 'actorToken', ['actorToken', 'compensationId'], ['actorToken', 'compensationId']);
    const current = this.requireActor(input.actorToken);
    if (current.role !== 'agent' && current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    const compensation = this.compensations.get(identifier(input.compensationId, 'compensationId'));
    if (compensation === undefined) fail(SUPPORT_ERROR_CODES.NOT_FOUND, 'compensation was not found');
    return copyCompensation(compensation);
  }

  queryResourceLedger(request: LedgerQueryRequest): LedgerQueryResult {
    const input = this.prepare(request, 'actorToken', ['actorToken', 'accountId', 'resourceId', 'fromCreatedAt', 'toCreatedAt', 'limit', 'cursor'], ['actorToken']); const current = this.requireActor(input.actorToken);
    const requestedAccount = input.accountId === undefined ? undefined : identifier(input.accountId, 'accountId');
    const accountId = current.role === 'player' ? current.accountId : requestedAccount;
    if (current.role === 'player' && requestedAccount !== undefined && requestedAccount !== current.accountId) fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    if (current.role === 'player' && accountId === undefined) fail(SUPPORT_ERROR_CODES.UNAUTHENTICATED, 'player account is missing');
    if (current.role !== 'player' && current.role !== 'agent' && current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    const resource = input.resourceId === undefined ? undefined : resourceId(input.resourceId); const from = input.fromCreatedAt === undefined ? undefined : safeTime(input.fromCreatedAt, 'fromCreatedAt'); const to = input.toCreatedAt === undefined ? undefined : safeTime(input.toCreatedAt, 'toCreatedAt');
    if (from !== undefined && to !== undefined && from > to) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'time range is inverted');
    const entries = this.ledger.filter((entry) => (accountId === undefined || entry.accountId === accountId) && (resource === undefined || entry.resourceId === resource) && (from === undefined || entry.createdAt >= from) && (to === undefined || entry.createdAt <= to)).sort((a, b) => a.createdAt - b.createdAt || a.entryId.localeCompare(b.entryId));
    const result = this.pageLedger(entries, page(input.limit, 'limit'), cursor(input.cursor, 'cursor')); const totals = Object.create(null) as Record<string, number>;
    for (const entry of result.entries) totals[entry.resourceId] = (totals[entry.resourceId] ?? 0) + entry.amount;
    return { ...result, totals: Object.freeze(totals) };
  }

  queryAudit(request: AuditQueryRequest): AuditQueryResult {
    const input = this.prepare(request, 'actorToken', ['actorToken', 'targetType', 'targetId', 'limit', 'cursor'], ['actorToken']); const current = this.requireActor(input.actorToken); if (current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    const targetType = input.targetType === undefined ? undefined : text(input.targetType, 'targetType', 64); const targetId = input.targetId === undefined ? undefined : identifier(input.targetId, 'targetId');
    const events = this.audit.filter((event) => (targetType === undefined || event.targetType === targetType) && (targetId === undefined || event.targetId === targetId));
    return this.pageAudit(events, page(input.limit, 'limit'), cursor(input.cursor, 'cursor'));
  }

  snapshot(adminDiagnosticToken?: string): SupportSnapshot {
    if (this.adminDiagnosticToken === null || adminDiagnosticToken !== this.adminDiagnosticToken) fail(SUPPORT_ERROR_CODES.UNAUTHENTICATED, 'diagnostic snapshot is not authorized');
    return this.publicSnapshot();
  }

  private decideCompensation(request: DecideCompensationRequest, decision: 'approve' | 'reject'): MutationResult<Compensation> {
    const input = this.prepare(request, 'actorToken', ['actorToken', 'requestId', 'compensationId'], ['actorToken', 'requestId', 'compensationId']); const current = this.requireActor(input.actorToken); if (current.role !== 'admin') fail(SUPPORT_ERROR_CODES.FORBIDDEN);
    const id = identifier(input.requestId, 'requestId'); const compensationId = identifier(input.compensationId, 'compensationId'); const name = decision === 'approve' ? 'approveCompensation' : 'rejectCompensation';
    return this.mutate(current, name, id, fingerprint(input, 'actorToken'), () => {
      const compensation = this.compensations.get(compensationId); if (!compensation) fail(SUPPORT_ERROR_CODES.NOT_FOUND, 'compensation was not found');
      if (compensation.status !== 'pending') fail(SUPPORT_ERROR_CODES.COMPENSATION_ALREADY_DECIDED);
      if (compensation.createdBy === current.actorId) fail(SUPPORT_ERROR_CODES.SELF_APPROVAL, 'creator cannot decide own compensation');
      const now = this.now(); this.consumeRate(current, name, now);
      if (decision === 'reject') { const rejected = { ...compensation, status: 'rejected' as const, rejectedBy: current.actorId, decidedAt: now }; this.compensations.set(compensationId, rejected); return rejected; }
      if (now > Number.MAX_SAFE_INTEGER - COMPENSATION_MAIL_TTL_MS) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'compensation expiry exceeds supported time range');
      const mailId = this.nextId('mail'); const mail: Mail = { mailId, accountId: compensation.accountId, source: 'compensation', title: '客服补偿', body: compensation.reason, attachments: compensation.resources, createdAt: now, expiresAt: now + COMPENSATION_MAIL_TTL_MS, ticketId: compensation.ticketId, compensationId, claimedAt: null };
      this.mails.set(mailId, mail); const approved = { ...compensation, status: 'approved' as const, approvedBy: current.actorId, mailId, decidedAt: now }; this.compensations.set(compensationId, approved); return approved;
    }, 'compensation', compensationId);
  }

  private prepare(request: unknown, secretKey: 'sessionToken' | 'actorToken', keys: readonly string[], requiredKeys: readonly string[]): Record<string, unknown> {
    if (!isPlainRecord(request)) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'request must be a plain object');
    assertKeys(request, keys, 'request');
    for (const key of requiredKeys) if (request[key] === undefined) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, `${key} is required`);
    identifier(request[secretKey], secretKey);
    return request;
  }
  private requireActor(token: unknown): SupportActor {
    const value = identifier(token, 'sessionToken'); let resolved: SupportActor | null = null; try { resolved = this.resolveActor(value); } catch { resolved = null; }
    if (resolved === null) fail(SUPPORT_ERROR_CODES.UNAUTHENTICATED, 'session is not valid');
    return actor(resolved);
  }
  private requirePlayer(token: unknown): SupportActor { const current = this.requireActor(token); if (current.role !== 'player' || current.accountId === undefined) fail(SUPPORT_ERROR_CODES.FORBIDDEN, 'player session is required'); return current; }
  private now(): number { return safeTime(this.clock(), 'now'); }
  private nextId(kind: string): string { const next = (this.sequences[kind] ?? 0) + 1; const id = identifier(this.makeId(kind, next), `${kind}Id`); if ([...this.tickets.keys(), ...this.mails.keys(), ...this.compensations.keys(), ...this.ledger.map((entry) => entry.entryId), ...this.audit.map((entry) => entry.auditId)].includes(id)) fail(SUPPORT_ERROR_CODES.INTERNAL_ERROR, `${kind} id collided`); this.sequences[kind] = next; return id; }
  private requestKey(actorValue: SupportActor, name: MutationName, requestId: string): string { return `${actorValue.accountId ?? actorValue.actorId}\u0000${name}\u0000${requestId}`; }
  private mutate<T>(current: SupportActor, name: MutationName, requestId: string, requestFingerprint: string, action: () => T, targetType: string, targetId: string | ((value: T) => string)): MutationResult<T> {
    if (this.persistenceInProgress) fail(SUPPORT_ERROR_CODES.PERSISTENCE_FAILED, 'support persistence is locked');
    const key = this.requestKey(current, name, requestId); const previous = this.requests.get(key);
    if (previous !== undefined) {
      if (previous.fingerprint !== requestFingerprint) fail(SUPPORT_ERROR_CODES.REQUEST_ID_REUSED, 'requestId was reused with different data');
      if (previous.error) throw new SupportError(previous.error.code, previous.error.message, previous.error.retryAfterMs);
      this.appendReplayAudit(current, name, targetType, this.resolveTargetId(targetId, previous.result as T, requestId), requestId);
      return { value: clone(previous.result as T), replayed: true };
    }
    const checkpoint = this.capture();
    try {
      const value = action();
      this.requests.set(key, { fingerprint: requestFingerprint, result: clone(value) });
      this.appendAudit(current, name, targetType, this.resolveTargetId(targetId, value, requestId), requestId, 'accepted', null);
      this.persistTransaction(checkpoint);
      return { value: clone(value), replayed: false };
    } catch (error) {
      if (error instanceof SupportError && error.code === SUPPORT_ERROR_CODES.PERSISTENCE_FAILED) { this.restore(checkpoint); throw error; }
      this.restore(checkpoint);
      const supportError = error instanceof SupportError ? error : new SupportError(SUPPORT_ERROR_CODES.INTERNAL_ERROR, 'support operation failed');
      const errorRecord: StoredRequest = { fingerprint: requestFingerprint, error: { code: supportError.code, message: supportError.message, retryAfterMs: supportError.retryAfterMs } };
      this.requests.set(key, errorRecord); this.appendAudit(current, name, targetType, this.resolveTargetId(targetId, undefined as T, requestId), requestId, 'rejected', supportError.code);
      this.persistTransaction(checkpoint);
      throw supportError;
    }
  }
  private consumeRate(current: SupportActor, name: MutationName, now: number): void {
    const rule = this.rateLimits[name]; const key = `${current.accountId ?? current.actorId}\u0000${name}`; const values = (this.rates.get(key) ?? []).filter((at) => at > now - rule.windowMs);
    if (values.length >= rule.max) { const retryAfterMs = Math.max(1, values[0] + rule.windowMs - now); throw new SupportError(SUPPORT_ERROR_CODES.RATE_LIMITED, `${name} rate limit exceeded`, retryAfterMs); }
    values.push(now); this.rates.set(key, values);
  }
  private appendAudit(current: SupportActor, action: string, targetType: string, targetId: string, requestId: string | null, outcome: AuditEvent['outcome'], reasonCode: SupportErrorCode | null): void {
    this.audit.push({ auditId: this.nextId('audit'), actorId: current.actorId, actorRole: current.role, action, targetType, targetId, requestId, outcome, reasonCode, createdAt: this.now() });
  }
  private appendReplayAudit(current: SupportActor, action: string, targetType: string, targetId: string, requestId: string): void {
    const checkpoint = this.capture();
    try { this.appendAudit(current, action, targetType, targetId, requestId, 'replayed', null); this.persistTransaction(checkpoint); }
    catch (error) {
      this.restore(checkpoint);
      if (error instanceof SupportError && error.code === SUPPORT_ERROR_CODES.PERSISTENCE_FAILED) throw error;
      throw new SupportError(SUPPORT_ERROR_CODES.PERSISTENCE_FAILED, 'support state could not be persisted');
    }
  }
  private resolveTargetId<T>(targetId: string | ((value: T) => string), value: T, fallback: string): string {
    return typeof targetId === 'function' ? value === undefined ? fallback : targetId(value) : targetId;
  }
  private persistTransaction(checkpoint: InternalSnapshot): void {
    try { this.persistState(); }
    catch {
      this.restore(checkpoint);
      try { this.persistState(); } catch { /* Keep memory at the checkpoint; the caller receives a closed failure. */ }
      throw new SupportError(SUPPORT_ERROR_CODES.PERSISTENCE_FAILED, 'support state could not be persisted');
    }
  }
  private persistState(): void {
    if (!this.persist) return;
    this.persistenceInProgress = true;
    try { this.persist(this.publicSnapshot()); }
    finally { this.persistenceInProgress = false; }
  }
  private publicSnapshot(): SupportSnapshot { return { schemaVersion: SUPPORT_SCHEMA_VERSION, tickets: [...this.tickets.values()].map(copyTicket), mails: [...this.mails.values()].map(copyMail), compensations: [...this.compensations.values()].map(copyCompensation), ledger: clone(this.ledger), audit: clone(this.audit) }; }
  private capture(): InternalSnapshot { return { tickets: [...this.tickets.values()].map(copyTicket), mails: [...this.mails.values()].map(copyMail), compensations: [...this.compensations.values()].map(copyCompensation), ledger: clone(this.ledger), audit: clone(this.audit), requests: [...this.requests.entries()].map(([key, value]) => [key, clone(value)]), rates: [...this.rates.entries()].map(([key, value]) => [key, [...value]]), sequences: { ...this.sequences } }; }
  private restore(snapshot: InternalSnapshot): void { this.tickets.clear(); snapshot.tickets.forEach((value) => this.tickets.set(value.ticketId, value)); this.mails.clear(); snapshot.mails.forEach((value) => this.mails.set(value.mailId, value)); this.compensations.clear(); snapshot.compensations.forEach((value) => this.compensations.set(value.compensationId, value)); this.ledger.splice(0, this.ledger.length, ...snapshot.ledger); this.audit.splice(0, this.audit.length, ...snapshot.audit); this.requests.clear(); snapshot.requests.forEach(([key, value]) => this.requests.set(key, value)); this.rates.clear(); snapshot.rates.forEach(([key, value]) => this.rates.set(key, value)); this.sequences = { ...snapshot.sequences }; }
  private ticketsFor(accountId: string | undefined, status: TicketStatus | undefined): Ticket[] { return [...this.tickets.values()].filter((ticket) => (accountId === undefined || ticket.accountId === accountId) && (status === undefined || ticket.status === status)).sort((a, b) => a.createdAt - b.createdAt || a.ticketId.localeCompare(b.ticketId)); }
  private pageTickets(values: Ticket[], limit: number, after?: string): TicketListResult { const start = this.pageStart(values.map((value) => value.ticketId), after); const result = values.slice(start, start + limit); return { tickets: result.map(copyTicket), nextCursor: start + limit < values.length ? result[result.length - 1].ticketId : null }; }
  private pageMails(values: Mail[], limit: number, after?: string): MailListResult { const start = this.pageStart(values.map((value) => value.mailId), after); const result = values.slice(start, start + limit); return { mails: result.map(copyMail), nextCursor: start + limit < values.length ? result[result.length - 1].mailId : null }; }
  private pageLedger(values: ResourceLedgerEntry[], limit: number, after?: string): { entries: readonly ResourceLedgerEntry[]; nextCursor: string | null } { const start = this.pageStart(values.map((value) => value.entryId), after); const result = values.slice(start, start + limit); return { entries: clone(result), nextCursor: start + limit < values.length ? result[result.length - 1].entryId : null }; }
  private pageAudit(values: AuditEvent[], limit: number, after?: string): AuditQueryResult { const start = this.pageStart(values.map((value) => value.auditId), after); const result = values.slice(start, start + limit); return { events: clone(result), nextCursor: start + limit < values.length ? result[result.length - 1].auditId : null }; }
  private pageStart(ids: readonly string[], after?: string): number { if (after === undefined) return 0; const index = ids.indexOf(after); if (index < 0) fail(SUPPORT_ERROR_CODES.INVALID_REQUEST, 'cursor was not found'); return index + 1; }
}

export const SupportBackendService = SupportService;
