import assert from 'node:assert/strict';
import {
  CommerceClientError,
  CommerceClientService,
} from '../assets/scripts/services/commerce/CommerceClientService.ts';
import {
  CommerceError,
  CommerceService,
} from '../../backend/commerce/CommerceService.ts';

const ADMIN_TOKEN = 't263-commerce-admin';
const sessions = new Map([
  ['session-a', 'account-a'],
  ['session-b', 'account-b'],
]);
const paymentRecords = new Map();
const callbackRecords = new Map();
const refundRecords = new Map();
let clock = 10_000;
let orderSequence = 0;

function paymentFor({ accountId, orderId, productId, provider = 'mock-store', transactionId, receiptId, amountMinor = 499, priceCurrency = 'CNY', status = 'PAID', refundId }) {
  return {
    verified: true,
    kind: 'payment',
    status,
    accountId,
    orderId,
    productId,
    provider,
    transactionId,
    receiptId,
    amountMinor,
    priceCurrency,
    ...(refundId === undefined ? {} : { refundId }),
  };
}

function refundFor({ accountId, orderId, productId, provider = 'mock-store', transactionId, refundId, amountMinor = 499, priceCurrency = 'CNY' }) {
  return {
    verified: true,
    kind: 'refund',
    accountId,
    orderId,
    productId,
    provider,
    transactionId,
    refundId,
    amountMinor,
    priceCurrency,
  };
}

const server = new CommerceService({
  now: () => clock++,
  authenticateSession: (token) => sessions.get(token) ?? null,
  products: [
    {
      productId: 'paid-pack',
      provider: 'mock-store',
      priceMinor: 499,
      priceCurrency: 'CNY',
      grant: { freeCurrency: 25, paidCurrency: 1_000 },
    },
    {
      productId: 'free-pack',
      provider: 'mock-store',
      priceMinor: 0,
      priceCurrency: 'CNY',
      grant: { freeCurrency: 50, paidCurrency: 0 },
    },
    {
      productId: 'callback-pack',
      provider: 'mock-store',
      priceMinor: 199,
      priceCurrency: 'CNY',
      grant: { freeCurrency: 2, paidCurrency: 200 },
    },
    {
      productId: 'other-provider-pack',
      provider: 'other-store',
      priceMinor: 499,
      priceCurrency: 'CNY',
      grant: { freeCurrency: 3, paidCurrency: 30 },
    },
  ],
  orderId: () => `order-${++orderSequence}`,
  paymentVerifier: (raw) => paymentRecords.get(raw) ?? null,
  callbackVerifier: (eventId, raw) => {
    if (!raw || raw.signature !== 'provider-signature') return null;
    const record = callbackRecords.get(eventId);
    return record ?? null;
  },
  refundVerifier: (raw) => refundRecords.get(raw) ?? null,
  adminDiagnosticToken: ADMIN_TOKEN,
});

const clientA = new CommerceClientService(server, { sessionToken: 'session-a' });
const clientB = new CommerceClientService(server, { sessionToken: 'session-b' });

function expectCode(label, action, code, ErrorClass = CommerceError) {
  assert.throws(action, (error) => error instanceof ErrorClass && error.code === code, label);
}

function expectClientError(label, action) {
  assert.throws(action, (error) => error instanceof CommerceClientError, label);
}

function registerPayment(receipt, order, overrides = {}) {
  const record = paymentFor({
    accountId: order.accountId,
    orderId: order.orderId,
    productId: order.productId,
    provider: order.provider,
    transactionId: `transaction-${order.orderId}`,
    receiptId: receipt,
    amountMinor: order.priceMinor,
    priceCurrency: order.priceCurrency,
    ...overrides,
  });
  paymentRecords.set(receipt, record);
  return record;
}

assert.deepEqual(server.catalog().map(({ productId }) => productId), ['paid-pack', 'free-pack', 'callback-pack', 'other-provider-pack']);
const catalogProbe = server.catalog();
catalogProbe[0].grant.paidCurrency = 1;
assert.equal(server.catalog()[0].grant.paidCurrency, 1_000, 'catalog must be detached from server state');

expectCode('missing session fails closed', () => server.createOrder({ sessionToken: 'forged', requestId: 'missing-session', productId: 'paid-pack' }), 'UNAUTHENTICATED');
expectClientError('client validates its session locally', () => new CommerceClientService(server, { sessionToken: '' }));

const created = clientA.createOrder('paid-pack', 'create-1');
assert.equal(created.accepted, true);
assert.equal(created.replayed, false);
assert.equal(created.order.status, 'CREATED');
assert.deepEqual(created.order.grant, { freeCurrency: 25, paidCurrency: 1_000 });
assert.equal(created.order.priceMinor, 499);
const createdReplay = clientA.createOrder({ productId: 'paid-pack', requestId: 'create-1' });
assert.equal(createdReplay.replayed, true, 'creating an order twice must replay the original order');
assert.deepEqual(createdReplay.order, created.order);
expectCode('create requestId cannot change product', () => clientA.createOrder('free-pack', 'create-1'), 'REQUEST_ID_REUSED');
expectCode('unknown product is rejected', () => clientA.createOrder('missing-product', 'create-missing'), 'PRODUCT_NOT_FOUND');
expectCode('same invalid create request replays the rejection', () => clientA.createOrder('missing-product', 'create-missing'), 'PRODUCT_NOT_FOUND');
expectClientError('client cannot add a grant to an order request', () => clientA.createOrder({ productId: 'paid-pack', requestId: 'client-grant', grant: { paidCurrency: 999_999 } }));
const tamperedServerOrder = server.createOrder({ sessionToken: 'session-a', requestId: 'server-extra-fields', productId: 'paid-pack', grant: { paidCurrency: 999_999 } });
assert.deepEqual(tamperedServerOrder.order.grant, { freeCurrency: 25, paidCurrency: 1_000 }, 'server must ignore client-supplied grant data');

const firstReceipt = 'receipt:paid-1';
registerPayment(firstReceipt, created.order);
expectCode('forged receipt is rejected', () => clientA.verifyOrder(created.order.orderId, 'forged-receipt', 'verify-forged'), 'PAYMENT_VERIFICATION_FAILED');
expectCode('same forged receipt request replays the rejection', () => clientA.verifyOrder(created.order.orderId, 'forged-receipt', 'verify-forged'), 'PAYMENT_VERIFICATION_FAILED');
expectCode('failed verification requestId cannot become valid', () => clientA.verifyOrder(created.order.orderId, firstReceipt, 'verify-forged'), 'REQUEST_ID_REUSED');
assert.deepEqual(clientA.wallet(), { accountId: 'account-a', freeCurrency: 0, paidCurrency: 0, updatedAt: clientA.wallet().updatedAt }, 'failed verification must not grant currency');

const mismatchedReceipt = 'receipt:mismatched-amount';
registerPayment(mismatchedReceipt, created.order, { amountMinor: 1 });
expectCode('provider amount mismatch is rejected', () => clientA.verifyOrder(created.order.orderId, mismatchedReceipt, 'verify-mismatch'), 'PAYMENT_MISMATCH');
const negativeReceipt = 'receipt:negative-amount';
registerPayment(negativeReceipt, created.order, { amountMinor: -1 });
expectCode('negative provider amount is rejected before settlement', () => clientA.verifyOrder(created.order.orderId, negativeReceipt, 'verify-negative'), 'PAYMENT_VERIFICATION_FAILED');
const valid = clientA.verifyOrder(created.order.orderId, firstReceipt, 'verify-1');
assert.equal(valid.accepted, true);
assert.equal(valid.delivered, true);
assert.equal(valid.order.status, 'PAID');
assert.deepEqual(valid.wallet, { accountId: 'account-a', freeCurrency: 25, paidCurrency: 1_000, updatedAt: valid.wallet.updatedAt });
const validReplay = clientA.verifyOrder(created.order.orderId, firstReceipt, 'verify-1');
assert.equal(validReplay.replayed, true);
assert.deepEqual({ ...validReplay, replayed: false }, valid);
const duplicateVerification = clientA.verifyOrder(created.order.orderId, firstReceipt, 'verify-duplicate');
assert.equal(duplicateVerification.accepted, true);
assert.equal(duplicateVerification.delivered, false, 'a second request for the same transaction must not grant again');
assert.deepEqual(duplicateVerification.wallet, valid.wallet);
const detachedWallet = clientA.wallet();
detachedWallet.paidCurrency = 0;
assert.equal(clientA.wallet().paidCurrency, 1_000, 'client wallet mutations must not mutate the server wallet');
assert.equal(typeof clientA.grantPaidCurrency, 'undefined', 'client must not expose a paid-currency grant operation');

const freeCreated = clientA.createOrder('free-pack', 'create-free');
const freeReceipt = 'receipt:free-1';
registerPayment(freeReceipt, freeCreated.order, { transactionId: 'transaction-free-1', receiptId: freeReceipt, amountMinor: 0 });
const freeResult = clientA.verifyOrder(freeCreated.order.orderId, freeReceipt, 'verify-free');
assert.equal(freeResult.delivered, true);
assert.equal(freeResult.wallet.freeCurrency, 75, 'free currency must be credited to its own balance');
assert.equal(freeResult.wallet.paidCurrency, 1_000, 'free grants must never alter paid currency');

const otherProviderCreated = clientA.createOrder('other-provider-pack', 'create-other-provider');
registerPayment('receipt:other-provider', otherProviderCreated.order, {
  provider: 'other-store',
  transactionId: valid.order.transactionId,
  receiptId: 'receipt:other-provider',
});
const otherProviderResult = clientA.verifyOrder(otherProviderCreated.order.orderId, 'receipt:other-provider', 'verify-other-provider');
assert.equal(otherProviderResult.delivered, true, 'the same transactionId may be used by a different provider');
assert.equal(otherProviderResult.wallet.paidCurrency, 1_030);

const restoreCreated = clientA.createOrder('paid-pack', 'create-restore');
const restoreReceipt = 'receipt:restore-1';
registerPayment(restoreReceipt, restoreCreated.order, { transactionId: 'transaction-restore-1', receiptId: restoreReceipt });
const restored = clientA.restoreOrders([restoreReceipt], 'restore-1');
assert.equal(restored.accepted, true);
assert.equal(restored.results[0].delivered, true, 'restore must deliver a previously unfulfilled order');
const paidAfterRestore = restored.results[0].wallet.paidCurrency;
const restoredReplay = clientA.restoreOrders([restoreReceipt], 'restore-1');
assert.equal(restoredReplay.replayed, true);
assert.equal(restoredReplay.results[0].delivered, true);
const restoredAgain = clientA.restorePurchases([restoreReceipt], 'restore-2');
assert.equal(restoredAgain.results[0].delivered, false, 'restore of a paid transaction must be idempotent');
assert.equal(restoredAgain.results[0].wallet.paidCurrency, paidAfterRestore);

const duplicateRestoreCreated = clientA.createOrder('paid-pack', 'create-duplicate-restore');
const duplicateRestoreReceipt = 'receipt:duplicate-restore';
registerPayment(duplicateRestoreReceipt, duplicateRestoreCreated.order, { transactionId: 'transaction-duplicate-restore', receiptId: duplicateRestoreReceipt });
const duplicateRestore = clientA.restoreOrders([duplicateRestoreReceipt, duplicateRestoreReceipt], 'restore-duplicate-list');
assert.equal(duplicateRestore.results[0].delivered, true);
assert.equal(duplicateRestore.results[1].delivered, false, 'duplicate receipts in one restore request must not double grant');

const conflictingBatchCreated = clientA.createOrder('paid-pack', 'create-conflicting-batch');
registerPayment('receipt:conflicting-batch-a', conflictingBatchCreated.order, { transactionId: 'transaction-conflicting-batch-a', receiptId: 'receipt:conflicting-batch-a' });
registerPayment('receipt:conflicting-batch-b', conflictingBatchCreated.order, { transactionId: 'transaction-conflicting-batch-b', receiptId: 'receipt:conflicting-batch-b' });
const paidBeforeConflictingBatch = clientA.wallet().paidCurrency;
expectCode('one restore batch cannot plan two transactions for one order', () => clientA.restoreOrders(['receipt:conflicting-batch-a', 'receipt:conflicting-batch-b'], 'restore-conflicting-batch'), 'PAYMENT_MISMATCH');
assert.equal(clientA.wallet().paidCurrency, paidBeforeConflictingBatch, 'a rejected restore batch must not partially grant currency');
assert.equal(clientA.orders().find((order) => order.orderId === conflictingBatchCreated.order.orderId).status, 'CREATED');

const overflowReceipts = new Map();
let overflowOrderSequence = 0;
const overflowServer = new CommerceService({
  now: () => 1,
  authenticateSession: (token) => token === 'overflow-session' ? 'overflow-account' : null,
  orderId: () => `overflow-order-${++overflowOrderSequence}`,
  products: [
    { productId: 'overflow-first', provider: 'overflow-store', priceMinor: 1, priceCurrency: 'CNY', grant: { freeCurrency: 1, paidCurrency: 1 } },
    { productId: 'overflow-second', provider: 'overflow-store', priceMinor: 2, priceCurrency: 'CNY', grant: { freeCurrency: Number.MAX_SAFE_INTEGER, paidCurrency: 0 } },
  ],
  paymentVerifier: (raw) => overflowReceipts.get(raw) ?? null,
  adminDiagnosticToken: 'overflow-admin',
});
const overflowClient = new CommerceClientService(overflowServer, { sessionToken: 'overflow-session' });
const overflowFirst = overflowClient.createOrder('overflow-first', 'overflow-create-first');
const overflowSecond = overflowClient.createOrder('overflow-second', 'overflow-create-second');
overflowReceipts.set('overflow-receipt-first', paymentFor({
  accountId: 'overflow-account', orderId: overflowFirst.order.orderId, productId: overflowFirst.order.productId,
  provider: 'overflow-store', transactionId: 'overflow-transaction-first', receiptId: 'overflow-receipt-first', amountMinor: 1,
}));
overflowReceipts.set('overflow-receipt-second', paymentFor({
  accountId: 'overflow-account', orderId: overflowSecond.order.orderId, productId: overflowSecond.order.productId,
  provider: 'overflow-store', transactionId: 'overflow-transaction-second', receiptId: 'overflow-receipt-second', amountMinor: 2,
}));
const overflowBefore = overflowServer.snapshot('overflow-admin');
expectCode('restore overflow must abort the entire batch', () => overflowClient.restoreOrders(['overflow-receipt-first', 'overflow-receipt-second'], 'overflow-restore'), 'CURRENCY_OVERFLOW');
assert.deepEqual(overflowServer.snapshot('overflow-admin'), overflowBefore, 'restore overflow must roll back orders, wallet and transaction state');
const overflowOtherOrder = overflowClient.createOrder('overflow-first', 'overflow-create-other');
overflowReceipts.set('overflow-receipt-other', paymentFor({
  accountId: 'overflow-account', orderId: overflowOtherOrder.order.orderId, productId: overflowOtherOrder.order.productId,
  provider: 'overflow-store', transactionId: 'overflow-transaction-first', receiptId: 'overflow-receipt-other', amountMinor: 1,
}));
assert.equal(overflowClient.verifyOrder(overflowOtherOrder.order.orderId, 'overflow-receipt-other', 'overflow-verify-other').delivered, true, 'failed restore must not retain a partial transaction reservation');
assert.equal(overflowClient.orders().find((order) => order.orderId === overflowFirst.order.orderId).status, 'CREATED');
assert.equal(overflowClient.orders().find((order) => order.orderId === overflowSecond.order.orderId).status, 'CREATED');

const callbackCreated = clientA.createOrder('callback-pack', 'create-callback');
const callbackPayment = paymentFor({
  accountId: callbackCreated.order.accountId,
  orderId: callbackCreated.order.orderId,
  productId: callbackCreated.order.productId,
  provider: callbackCreated.order.provider,
  transactionId: 'transaction-callback-1',
  receiptId: 'receipt:callback-1',
  amountMinor: callbackCreated.order.priceMinor,
  priceCurrency: callbackCreated.order.priceCurrency,
});
callbackRecords.set('callback-payment-1', { ...callbackPayment, eventId: 'callback-payment-1', kind: 'payment' });
expectCode('forged callback signature is rejected', () => server.handleProviderCallback('callback-forged', { signature: 'forged' }), 'CALLBACK_VERIFICATION_FAILED');
expectCode('same forged callback replays its rejection', () => server.handleProviderCallback('callback-forged', { signature: 'forged' }), 'CALLBACK_VERIFICATION_FAILED');
expectCode('callback eventId cannot be reused with another payload', () => server.handleProviderCallback('callback-forged', { signature: 'provider-signature', changed: true }), 'CALLBACK_ID_REUSED');
const callbackPaid = server.handleProviderCallback('callback-payment-1', { signature: 'provider-signature' });
assert.equal(callbackPaid.kind, 'payment');
assert.equal(callbackPaid.order.status, 'PAID');
const callbackPaidReplay = server.handleProviderCallback('callback-payment-1', { signature: 'provider-signature' });
assert.equal(callbackPaidReplay.replayed, true);
paymentRecords.set('receipt:callback-refunded-by-provider', {
  ...callbackPayment,
  status: 'REFUNDED',
  refundId: 'refund-callback-by-provider',
});
const paidBeforeProviderRefund = clientA.wallet().paidCurrency;
const providerRefundViaReceipt = clientA.verifyOrder(callbackCreated.order.orderId, 'receipt:callback-refunded-by-provider', 'verify-provider-refund');
assert.equal(providerRefundViaReceipt.accepted, false);
assert.equal(providerRefundViaReceipt.code, 'ORDER_REFUNDED');
assert.equal(providerRefundViaReceipt.wallet.paidCurrency, paidBeforeProviderRefund - callbackCreated.order.grant.paidCurrency, 'a provider refund status must reverse a paid order exactly once');

const transactionReuseCreated = clientA.createOrder('paid-pack', 'create-transaction-reuse');
paymentRecords.set('receipt:transaction-reuse', paymentFor({
  accountId: transactionReuseCreated.order.accountId,
  orderId: transactionReuseCreated.order.orderId,
  productId: transactionReuseCreated.order.productId,
  transactionId: valid.order.transactionId,
  receiptId: 'receipt:transaction-reuse',
}));
expectCode('one provider transaction cannot settle two orders', () => clientA.verifyOrder(transactionReuseCreated.order.orderId, 'receipt:transaction-reuse', 'verify-transaction-reuse'), 'PAYMENT_ALREADY_USED');

const refundProof = 'refund-proof:paid-1';
refundRecords.set(refundProof, refundFor({
  accountId: created.order.accountId,
  orderId: created.order.orderId,
  productId: created.order.productId,
  transactionId: valid.order.transactionId,
  refundId: 'refund-1',
}));
expectCode('forged refund proof is rejected', () => clientA.refundOrder(created.order.orderId, 'refund-forged', 'forged-refund'), 'REFUND_VERIFICATION_FAILED');
const paidBeforeRefund = clientA.wallet().paidCurrency;
const refunded = clientA.refundOrder(created.order.orderId, 'refund-1', refundProof);
assert.equal(refunded.refunded, true);
assert.deepEqual(refunded.revoked, { freeCurrency: 25, paidCurrency: 1_000 });
assert.equal(refunded.wallet.paidCurrency, paidBeforeRefund - 1_000, 'refund must only reverse the refunded order grant');
const refundReplay = clientA.refundOrder(created.order.orderId, 'refund-1', refundProof);
assert.equal(refundReplay.replayed, true);
const secondRefund = clientA.refundOrder(created.order.orderId, 'refund-2', refundProof);
assert.equal(secondRefund.refunded, false);
assert.equal(secondRefund.code, 'ORDER_REFUNDED');
assert.equal(secondRefund.wallet.paidCurrency, refunded.wallet.paidCurrency);
const verificationAfterRefund = clientA.verifyOrder(created.order.orderId, firstReceipt, 'verify-after-refund');
assert.equal(verificationAfterRefund.accepted, false);
assert.equal(verificationAfterRefund.code, 'ORDER_REFUNDED');
assert.equal(verificationAfterRefund.wallet.paidCurrency, refunded.wallet.paidCurrency, 'verification after refund must not regrant paid currency');
const restoreAfterRefund = clientA.restoreOrders([firstReceipt], 'restore-after-refund');
assert.equal(restoreAfterRefund.results[0].accepted, false);
assert.equal(restoreAfterRefund.results[0].code, 'ORDER_REFUNDED');
assert.equal(restoreAfterRefund.results[0].wallet.paidCurrency, refunded.wallet.paidCurrency);

const callbackRefundCreated = clientA.createOrder('callback-pack', 'create-callback-refund');
const callbackRefund = refundFor({
  accountId: callbackRefundCreated.order.accountId,
  orderId: callbackRefundCreated.order.orderId,
  productId: callbackRefundCreated.order.productId,
  transactionId: 'transaction-callback-refund',
  refundId: 'refund-callback-1',
  amountMinor: callbackRefundCreated.order.priceMinor,
});
callbackRecords.set('callback-refund-before-payment', {
  ...callbackRefund,
  eventId: 'callback-refund-before-payment',
  kind: 'refund',
  receiptId: 'unused-receipt-field',
  status: 'PAID',
});
const refundBeforeDelivery = server.handleProviderCallback('callback-refund-before-payment', { signature: 'provider-signature' });
assert.equal(refundBeforeDelivery.kind, 'refund');
assert.equal(refundBeforeDelivery.order.status, 'REFUNDED');
const paymentAfterRefund = 'receipt:callback-refund-after';
registerPayment(paymentAfterRefund, callbackRefundCreated.order, {
  transactionId: 'transaction-callback-refund',
  receiptId: paymentAfterRefund,
});
const noGrantAfterRefund = clientA.verifyOrder(callbackRefundCreated.order.orderId, paymentAfterRefund, 'verify-refunded-order');
assert.equal(noGrantAfterRefund.accepted, false);
assert.equal(noGrantAfterRefund.code, 'ORDER_REFUNDED');

const accountBOrder = clientB.createOrder('paid-pack', 'account-b-order');
registerPayment('receipt:account-b', accountBOrder.order, { transactionId: 'transaction-account-b', receiptId: 'receipt:account-b' });
expectCode('another account cannot read an order', () => clientA.verifyOrder(accountBOrder.order.orderId, 'receipt:account-b', 'cross-account'), 'ORDER_ACCOUNT_MISMATCH');
const foreignReceipt = 'receipt:foreign-payment';
paymentRecords.set(foreignReceipt, paymentFor({
  accountId: 'account-b',
  orderId: transactionReuseCreated.order.orderId,
  productId: transactionReuseCreated.order.productId,
  transactionId: 'transaction-foreign',
  receiptId: foreignReceipt,
}));
expectCode('receipt account cannot be forged', () => clientA.verifyOrder(transactionReuseCreated.order.orderId, foreignReceipt, 'foreign-receipt'), 'PAYMENT_MISMATCH');

expectCode('negative grant product is rejected', () => new CommerceService({
  authenticateSession: () => 'account-a',
  products: [{ productId: 'bad', provider: 'mock-store', priceMinor: 1, priceCurrency: 'CNY', grant: { freeCurrency: -1, paidCurrency: 1 } }],
}), 'INVALID_REQUEST');
expectCode('negative price product is rejected', () => new CommerceService({
  authenticateSession: () => 'account-a',
  products: [{ productId: 'bad', provider: 'mock-store', priceMinor: -1, priceCurrency: 'CNY', grant: { freeCurrency: 1, paidCurrency: 0 } }],
}), 'INVALID_REQUEST');
expectCode('restore rejects an empty receipt list', () => clientA.restoreOrders([], 'restore-empty'), 'INVALID_REQUEST');
expectCode('diagnostic snapshot fails without the admin token', () => server.snapshot(), 'UNAUTHENTICATED');
const snapshot = server.snapshot(ADMIN_TOKEN);
assert(snapshot.orders.every((order) => order.status === 'CREATED' || order.status === 'PAID' || order.status === 'REFUNDED'), 'snapshot order states must be explicit');
assert(snapshot.wallets.every((wallet) => wallet.freeCurrency >= 0 && wallet.paidCurrency >= 0), 'wallet balances must never become negative');
assert(snapshot.orders.find((order) => order.orderId === created.order.orderId).status === 'REFUNDED');

const spyRequests = [];
const spyTransport = {
  createOrder(request) { spyRequests.push(request); return created; },
  verifyOrder: () => valid,
  restoreOrders: () => restored,
  refundOrder: () => refunded,
  getWallet: () => valid.wallet,
  listOrders: () => [created.order],
};
new CommerceClientService(spyTransport, { sessionToken: 'session-a' }).createOrder('paid-pack', 'client-boundary');
assert.equal(Object.hasOwn(spyRequests[0], 'grant'), false, 'client transport must never send a client-selected grant');
assert.equal(Object.hasOwn(spyRequests[0], 'paidCurrency'), false, 'client transport must never send a paid-currency amount');

console.log('T263 M8-10 commerce/payment PASS: server catalog authority, order state machine, receipt verification, restore, callback authentication, idempotent replay, refund, post-refund no-regrant, free/paid ledger isolation, transaction reuse, account boundary, malformed/negative input guards');
