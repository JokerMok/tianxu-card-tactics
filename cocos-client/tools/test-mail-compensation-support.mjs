import assert from 'node:assert/strict';
import { SupportClientError, SupportClientService } from '../assets/scripts/services/support/SupportClientService.ts';
import { SupportError, SupportService } from '../../backend/support/SupportService.ts';

const actors = new Map([
  ['player-a-session', { actorId: 'player-a', role: 'player', accountId: 'account-a' }],
  ['player-b-session', { actorId: 'player-b', role: 'player', accountId: 'account-b' }],
  ['agent-session', { actorId: 'agent-1', role: 'agent' }],
  ['admin-session', { actorId: 'admin-1', role: 'admin' }],
  ['admin-2-session', { actorId: 'admin-2', role: 'admin' }],
]);
let now = 1_000;
const server = new SupportService({
  now: () => now,
  actorResolver: (token) => actors.get(token) ?? null,
  idGenerator: (kind, sequence) => `${kind}-deterministic-${sequence}`,
  adminDiagnosticToken: 't262-diagnostic-token',
});

function expectCode(label, action, code) {
  assert.throws(action, (error) => error instanceof SupportError && error.code === code, label);
}
function freshService(options = {}) {
  return new SupportService({
    now: () => now,
    actorResolver: (token) => actors.get(token) ?? null,
    idGenerator: (kind, sequence) => `${kind}-${sequence}`,
    ...options,
  });
}

expectCode('unknown session fails closed', () => server.listTickets({ sessionToken: 'forged' }), 'UNAUTHENTICATED');
expectCode('player cannot list another account', () => server.listTickets({ sessionToken: 'player-a-session', accountId: 'account-b' }), 'FORBIDDEN');
expectCode('agent cannot read audit log', () => server.queryAudit({ actorToken: 'agent-session' }), 'FORBIDDEN');
expectCode('diagnostic snapshot requires its configured token', () => server.snapshot(), 'UNAUTHENTICATED');

const playerA = new SupportClientService(server, { sessionToken: 'player-a-session' });
const playerB = new SupportClientService(server, { sessionToken: 'player-b-session' });
const ticketFirst = playerA.createTicket('technical', '无法进入关卡', '战斗加载后返回大厅。', 'ticket-create-1');
assert.equal(ticketFirst.replayed, false);
assert.equal(ticketFirst.value.accountId, 'account-a');
assert.equal(ticketFirst.value.messages.length, 1);
const ticketReplay = playerA.createTicket('technical', '无法进入关卡', '战斗加载后返回大厅。', 'ticket-create-1');
assert.equal(ticketReplay.replayed, true, 'same ticket request must replay');
assert.deepEqual(ticketReplay.value, ticketFirst.value);
expectCode('changed ticket payload cannot reuse requestId', () => playerA.createTicket('technical', '无法进入关卡', '篡改正文。', 'ticket-create-1'), 'REQUEST_ID_REUSED');
expectCode('player cannot read another player ticket', () => playerB.getTicket(ticketFirst.value.ticketId), 'FORBIDDEN');
expectCode('extra ticket fields are rejected', () => server.createTicket({ sessionToken: 'player-a-session', requestId: 'bad-extra', category: 'other', subject: 'x', body: 'y', extra: true }), 'INVALID_REQUEST');
expectCode('missing ticket subject is rejected', () => server.createTicket({ sessionToken: 'player-a-session', requestId: 'bad-missing', category: 'other', body: 'y' }), 'INVALID_REQUEST');

const agentReply = server.replyTicket({ actorToken: 'agent-session', requestId: 'reply-1', ticketId: ticketFirst.value.ticketId, body: '已转交技术客服。' });
assert.equal(agentReply.value.status, 'pending');
assert.equal(server.listTickets({ sessionToken: 'agent-session', status: 'pending' }).tickets.length, 1);
const statusResolved = server.setTicketStatus({ actorToken: 'agent-session', requestId: 'status-1', ticketId: ticketFirst.value.ticketId, status: 'resolved' });
assert.equal(statusResolved.value.status, 'resolved');
const playerReply = playerA.replyTicket(ticketFirst.value.ticketId, '问题已复现，谢谢。', 'reply-player-1');
assert.equal(playerReply.value.status, 'open', 'player reply reopens a resolved ticket');
const closed = server.setTicketStatus({ actorToken: 'agent-session', requestId: 'status-2', ticketId: ticketFirst.value.ticketId, status: 'closed' });
assert.equal(closed.value.status, 'closed');
expectCode('closed ticket cannot receive a reply', () => playerA.replyTicket(ticketFirst.value.ticketId, '再次回复。', 'reply-after-close'), 'TICKET_CLOSED');

const emptyMail = server.createMail({ actorToken: 'agent-session', requestId: 'mail-text-only', accountId: 'account-a', title: '客服通知', body: '这是没有资源附件的通知。', attachments: [], expiresAt: null, ticketId: ticketFirst.value.ticketId });
assert.equal(emptyMail.value.attachments.length, 0);
assert.equal(playerA.listMail().mails.length, 1);
const compensationFirst = server.createCompensation({ actorToken: 'agent-session', requestId: 'comp-create-1', accountId: 'account-a', ticketId: ticketFirst.value.ticketId, reason: '关卡加载故障补偿', resources: [{ resourceId: 'gold', amount: 100 }, { resourceId: 'essence', amount: 2 }] });
assert.equal(compensationFirst.value.status, 'pending');
assert.equal(server.createCompensation({ actorToken: 'agent-session', requestId: 'comp-create-1', accountId: 'account-a', ticketId: ticketFirst.value.ticketId, reason: '关卡加载故障补偿', resources: [{ resourceId: 'gold', amount: 100 }, { resourceId: 'essence', amount: 2 }] }).replayed, true);
expectCode('agent cannot approve compensation', () => server.approveCompensation({ actorToken: 'agent-session', requestId: 'comp-approve-agent', compensationId: compensationFirst.value.compensationId }), 'FORBIDDEN');
const approved = server.approveCompensation({ actorToken: 'admin-session', requestId: 'comp-approve-1', compensationId: compensationFirst.value.compensationId });
assert.equal(approved.value.status, 'approved');
assert.ok(approved.value.mailId);
assert.equal(server.getCompensation({ actorToken: 'agent-session', compensationId: compensationFirst.value.compensationId }).mailId, approved.value.mailId);
expectCode('player cannot inspect compensation records', () => server.getCompensation({ actorToken: 'player-a-session', compensationId: compensationFirst.value.compensationId }), 'FORBIDDEN');
assert.equal(server.approveCompensation({ actorToken: 'admin-session', requestId: 'comp-approve-1', compensationId: compensationFirst.value.compensationId }).replayed, true);
expectCode('approved compensation cannot be decided again', () => server.rejectCompensation({ actorToken: 'admin-session', requestId: 'comp-reject-after', compensationId: compensationFirst.value.compensationId }), 'COMPENSATION_ALREADY_DECIDED');
const compensationMail = playerA.listMail().mails.find((mail) => mail.mailId === approved.value.mailId);
assert.ok(compensationMail, 'approved compensation must arrive as a mail');
const claim = playerA.claimMail(compensationMail.mailId, 'claim-1');
assert.equal(claim.value.claimed, true);
assert.equal(claim.value.ledgerEntries.length, 2);
const claimReplay = playerA.claimMail(compensationMail.mailId, 'claim-1');
assert.equal(claimReplay.replayed, true);
assert.deepEqual(claimReplay.value.ledgerEntries, claim.value.ledgerEntries);
const claimWithNewRequest = playerA.claimMail(compensationMail.mailId, 'claim-2');
assert.equal(claimWithNewRequest.value.idempotent, true, 'a different retry must not grant resources twice');
assert.equal(server.queryResourceLedger({ actorToken: 'player-a-session' }).entries.length, 2);
assert.deepEqual(server.queryResourceLedger({ actorToken: 'player-a-session' }).totals, { gold: 100, essence: 2 });
assert.equal(server.queryResourceLedger({ actorToken: 'agent-session', accountId: 'account-a' }).entries.length, 2);
expectCode('player cannot query another ledger', () => server.queryResourceLedger({ actorToken: 'player-a-session', accountId: 'account-b' }), 'FORBIDDEN');

now = 2_000;
const expiring = server.createMail({ actorToken: 'agent-session', requestId: 'mail-expiring', accountId: 'account-a', title: '限时附件', body: '过期边界测试。', attachments: [{ resourceId: 'gold', amount: 1 }], expiresAt: 2_010, ticketId: null });
now = 2_010;
expectCode('mail is expired at the exact boundary', () => playerA.claimMail(expiring.value.mailId, 'claim-expired'), 'MAIL_EXPIRED');
expectCode('expired claim rejection is idempotent', () => playerA.claimMail(expiring.value.mailId, 'claim-expired'), 'MAIL_EXPIRED');
assert.equal(playerA.listMail().mails.some((mail) => mail.mailId === expiring.value.mailId), true, 'unclaimed expired mail remains queryable');

const ownCompensation = server.createCompensation({ actorToken: 'admin-session', requestId: 'comp-self-create', accountId: 'account-b', reason: '管理员自建补偿', resources: [{ resourceId: 'gold', amount: 1 }] });
expectCode('compensation creator cannot approve own request', () => server.approveCompensation({ actorToken: 'admin-session', requestId: 'comp-self-approve', compensationId: ownCompensation.value.compensationId }), 'SELF_APPROVAL');
const rejected = server.rejectCompensation({ actorToken: 'admin-2-session', requestId: 'comp-reject-1', compensationId: ownCompensation.value.compensationId });
assert.equal(rejected.value.status, 'rejected');

const rateLimited = freshService({ rateLimits: { createTicket: { max: 2, windowMs: 100 } } });
for (const requestId of ['rate-1', 'rate-2']) rateLimited.createTicket({ sessionToken: 'player-a-session', requestId, category: 'other', subject: requestId, body: 'rate test' });
expectCode('new ticket requests are rate limited', () => rateLimited.createTicket({ sessionToken: 'player-a-session', requestId: 'rate-3', category: 'other', subject: 'rate-3', body: 'rate test' }), 'RATE_LIMITED');
assert.equal(rateLimited.createTicket({ sessionToken: 'player-a-session', requestId: 'rate-1', category: 'other', subject: 'rate-1', body: 'rate test' }).replayed, true, 'idempotent replay is allowed after rate limit');
now += 101;
expectCode('the rate-limited request keeps its original rejection', () => rateLimited.createTicket({ sessionToken: 'player-a-session', requestId: 'rate-3', category: 'other', subject: 'rate-3', body: 'rate test' }), 'RATE_LIMITED');
assert.equal(rateLimited.createTicket({ sessionToken: 'player-a-session', requestId: 'rate-4', category: 'other', subject: 'rate-4', body: 'rate test' }).replayed, false);

let failWrites = true;
const rollback = freshService({ persist: () => { if (failWrites) throw new Error('disk full'); } });
expectCode('persistence failure is surfaced', () => rollback.createTicket({ sessionToken: 'player-a-session', requestId: 'rollback-1', category: 'bug', subject: 'rollback', body: 'must not persist' }), 'PERSISTENCE_FAILED');
assert.equal(rollback.listTickets({ sessionToken: 'player-a-session' }).tickets.length, 0, 'failed transaction must roll back business state');
failWrites = false;
const rollbackAccepted = rollback.createTicket({ sessionToken: 'player-a-session', requestId: 'rollback-1', category: 'bug', subject: 'rollback', body: 'retry after storage recovery' });
assert.equal(rollbackAccepted.replayed, false, 'failed persistence must not reserve the requestId');

const audit = server.queryAudit({ actorToken: 'admin-session', targetType: 'compensation', targetId: compensationFirst.value.compensationId });
assert.ok(audit.events.some((event) => event.outcome === 'accepted' && event.action === 'approveCompensation'));
assert.ok(audit.events.every((event) => event.requestId === null || !event.requestId.includes('session')));
const snapshot = server.snapshot('t262-diagnostic-token');
assert.equal(snapshot.schemaVersion, 1);
assert.equal(JSON.stringify(snapshot).includes('player-a-session'), false, 'snapshots must not retain session tokens');

function deterministicRun() {
  let clock = 500;
  const isolated = freshService({ now: () => clock++, adminDiagnosticToken: 'deterministic-token' });
  const client = new SupportClientService(isolated, { sessionToken: 'player-a-session' });
  client.createTicket('other', '确定性', '固定输入。', 'deterministic-ticket');
  return isolated;
}
assert.deepEqual(deterministicRun().snapshot('deterministic-token'), deterministicRun().snapshot('deterministic-token'));

const clearedClient = new SupportClientService(server, { sessionToken: 'player-a-session' });
clearedClient.clearSession();
assert.throws(() => clearedClient.listTickets(), (error) => error instanceof SupportClientError);
console.log('T262 support PASS: ticket permissions/status, mail expiry, compensation approval, attachment claim idempotency, ledger query, rate limiting, audit redaction, rollback, deterministic replay');
