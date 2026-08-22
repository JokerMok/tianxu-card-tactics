export type TicketCategory = 'account' | 'billing' | 'bug' | 'technical' | 'other';
export type TicketStatus = 'open' | 'pending' | 'resolved' | 'closed';
export type SupportRole = 'player' | 'agent' | 'admin';
export interface SupportMessage { readonly messageId: string; readonly authorId: string; readonly authorRole: SupportRole; readonly body: string; readonly createdAt: number; }
export interface Ticket { readonly ticketId: string; readonly accountId: string; readonly category: TicketCategory; readonly subject: string; readonly messages: readonly SupportMessage[]; readonly status: TicketStatus; readonly assignedTo: string | null; readonly createdAt: number; readonly updatedAt: number; }
export interface ResourceGrant { readonly resourceId: string; readonly amount: number; }
export interface Mail { readonly mailId: string; readonly accountId: string; readonly source: 'support' | 'compensation'; readonly title: string; readonly body: string; readonly attachments: readonly ResourceGrant[]; readonly createdAt: number; readonly expiresAt: number | null; readonly ticketId: string | null; readonly compensationId: string | null; readonly claimedAt: number | null; }
export interface ResourceLedgerEntry { readonly entryId: string; readonly accountId: string; readonly resourceId: string; readonly amount: number; readonly sourceType: 'mail'; readonly sourceId: string; readonly requestId: string; readonly createdAt: number; }
export interface CreateTicketRequest { readonly sessionToken: string; readonly requestId: string; readonly category: TicketCategory; readonly subject: string; readonly body: string; }
export interface GetTicketRequest { readonly sessionToken: string; readonly ticketId: string; }
export interface MailListRequest { readonly sessionToken: string; readonly accountId?: string; readonly includeClaimed?: boolean; readonly limit?: number; readonly cursor?: string; }
export interface MailListResult { readonly mails: readonly Mail[]; readonly nextCursor: string | null; }
export interface TicketListResult { readonly tickets: readonly Ticket[]; readonly nextCursor: string | null; }
export interface ClaimMailResult { readonly mailId: string; readonly claimed: boolean; readonly idempotent: boolean; readonly ledgerEntries: readonly ResourceLedgerEntry[]; }
export interface MutationResult<T> { readonly value: T; readonly replayed: boolean; }

export interface SupportClientTransport {
  createTicket(request: CreateTicketRequest): MutationResult<Ticket>;
  listTickets(request: { sessionToken: string; accountId?: string; status?: TicketStatus; limit?: number; cursor?: string }): TicketListResult;
  getTicket(request: GetTicketRequest): Ticket;
  replyTicket(request: { actorToken: string; requestId: string; ticketId: string; body: string }): MutationResult<Ticket>;
  listMail(request: MailListRequest): MailListResult;
  claimMail(request: { sessionToken: string; requestId: string; mailId: string }): MutationResult<ClaimMailResult>;
  queryResourceLedger(request: { actorToken: string; accountId?: string; resourceId?: string; fromCreatedAt?: number; toCreatedAt?: number; limit?: number; cursor?: string }): { entries: readonly ResourceLedgerEntry[]; totals: Readonly<Record<string, number>>; nextCursor: string | null };
}

export interface SupportClientOptions { readonly sessionToken: string; }
export class SupportClientError extends Error { constructor(message: string) { super(message); this.name = 'SupportClientError'; } }

function copy<T>(value: T): T { return structuredClone(value); }
function requiredText(value: unknown, label: string, max = 256): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || value !== value.trim()) throw new SupportClientError(`${label} is invalid`);
  return value;
}

export class SupportClientService {
  private readonly transport: SupportClientTransport;
  private sessionToken: string;

  constructor(transport: SupportClientTransport, options: SupportClientOptions) {
    this.transport = transport;
    this.sessionToken = requiredText(options.sessionToken, 'sessionToken', 128);
  }
  setSessionToken(sessionToken: string): void { this.sessionToken = requiredText(sessionToken, 'sessionToken', 128); }
  clearSession(): void { this.sessionToken = ''; }
  createTicket(category: TicketCategory, subject: string, body: string, requestId: string): MutationResult<Ticket> {
    requiredText(requestId, 'requestId', 128); requiredText(subject, 'subject', 160); requiredText(body, 'body', 4000);
    return copy(this.transport.createTicket({ sessionToken: this.requireSession(), requestId, category, subject, body }));
  }
  listTickets(options: { status?: TicketStatus; limit?: number; cursor?: string } = {}): TicketListResult {
    return copy(this.transport.listTickets({ sessionToken: this.requireSession(), ...copy(options) }));
  }
  getTicket(ticketId: string): Ticket { return copy(this.transport.getTicket({ sessionToken: this.requireSession(), ticketId: requiredText(ticketId, 'ticketId', 128) })); }
  replyTicket(ticketId: string, body: string, requestId: string): MutationResult<Ticket> {
    requiredText(requestId, 'requestId', 128); requiredText(ticketId, 'ticketId', 128); requiredText(body, 'body', 4000);
    return copy(this.transport.replyTicket({ actorToken: this.requireSession(), requestId, ticketId, body }));
  }
  listMail(options: { includeClaimed?: boolean; limit?: number; cursor?: string } = {}): MailListResult {
    return copy(this.transport.listMail({ sessionToken: this.requireSession(), ...copy(options) }));
  }
  claimMail(mailId: string, requestId: string): MutationResult<ClaimMailResult> {
    requiredText(requestId, 'requestId', 128); requiredText(mailId, 'mailId', 128);
    return copy(this.transport.claimMail({ sessionToken: this.requireSession(), requestId, mailId }));
  }
  queryResourceLedger(options: { resourceId?: string; fromCreatedAt?: number; toCreatedAt?: number; limit?: number; cursor?: string } = {}): { entries: readonly ResourceLedgerEntry[]; totals: Readonly<Record<string, number>>; nextCursor: string | null } {
    return copy(this.transport.queryResourceLedger({ actorToken: this.requireSession(), ...copy(options) }));
  }
  private requireSession(): string { if (this.sessionToken.length === 0) throw new SupportClientError('support session is not authenticated'); return this.sessionToken; }
}

export const SupportService = SupportClientService;
