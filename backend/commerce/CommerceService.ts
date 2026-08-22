import {
  COMMERCE_SCHEMA_VERSION,
  type CommerceOrder,
  type CommerceProduct,
  type CommerceResultCode,
  type CreateOrderRequest,
  type CreateOrderResult,
  type CurrencyGrant,
  type CurrencyWallet,
  type RefundOrderRequest,
  type RefundResult,
  type RestoreOrdersRequest,
  type RestoreOrdersResult,
  type VerifyOrderRequest,
  type VerifyOrderResult,
  CommerceError,
  cloneCommerce,
} from '../../cocos-client/assets/scripts/services/commerce/commerce-contract.ts';

export { CommerceError } from '../../cocos-client/assets/scripts/services/commerce/commerce-contract.ts';
export type {
  CommerceOrder,
  CommerceOrderStatus,
  CommerceProduct,
  CommerceResultCode,
  CreateOrderRequest,
  CreateOrderResult,
  CurrencyGrant,
  CurrencyWallet,
  RefundOrderRequest,
  RefundResult,
  RestoreOrdersRequest,
  RestoreOrdersResult,
  VerifyOrderRequest,
  VerifyOrderResult,
} from '../../cocos-client/assets/scripts/services/commerce/commerce-contract.ts';

export const DEFAULT_COMMERCE_PRODUCTS: readonly CommerceProduct[] = Object.freeze([
  Object.freeze({
    productId: 'commerce_pack_small',
    provider: 'mock-store',
    priceMinor: 99,
    priceCurrency: 'CNY',
    grant: Object.freeze({ freeCurrency: 100, paidCurrency: 900 }),
  }),
]);

export interface PaymentVerificationContext {
  readonly action: 'verify' | 'restore' | 'callback' | 'refund';
  readonly accountId?: string;
  readonly orderId?: string;
  readonly productId?: string;
  readonly provider?: string;
}

export interface TrustedPaymentVerification {
  readonly verified: true;
  readonly kind?: 'payment';
  readonly status?: 'PAID' | 'REFUNDED';
  readonly accountId: string;
  readonly orderId: string;
  readonly productId: string;
  readonly provider: string;
  readonly transactionId: string;
  readonly receiptId: string;
  readonly amountMinor: number;
  readonly priceCurrency: string;
  readonly refundId?: string;
}

export interface TrustedRefundVerification {
  readonly verified: true;
  readonly kind: 'refund';
  readonly accountId: string;
  readonly orderId: string;
  readonly productId: string;
  readonly provider: string;
  readonly transactionId: string;
  readonly refundId: string;
  readonly amountMinor: number;
  readonly priceCurrency: string;
}

export type TrustedCallbackVerification =
  | (TrustedPaymentVerification & Readonly<{ eventId: string; kind: 'payment' }>)
  | (TrustedRefundVerification & Readonly<{ eventId: string }>);

export type PaymentVerifier = (
  raw: unknown,
  context: PaymentVerificationContext,
) => TrustedPaymentVerification | TrustedRefundVerification | null | undefined;

export type CallbackVerifier = (
  eventId: string,
  raw: unknown,
  context: PaymentVerificationContext,
) => TrustedCallbackVerification | null | undefined;

export interface CommerceServiceOptions {
  readonly products?: readonly CommerceProduct[];
  readonly now?: () => number;
  readonly authenticateSession?: (sessionToken: string) => string | null | undefined;
  readonly sessionAccountId?: (sessionToken: string) => string | null | undefined;
  readonly paymentVerifier?: PaymentVerifier;
  readonly receiptVerifier?: PaymentVerifier;
  readonly callbackVerifier?: CallbackVerifier;
  readonly refundVerifier?: PaymentVerifier;
  readonly orderId?: (sequence: number) => string;
  readonly adminDiagnosticToken?: string;
}

interface StoredLedgerResult {
  readonly kind: 'result';
  readonly fingerprint: string;
  readonly result: unknown;
}

interface StoredLedgerError {
  readonly kind: 'error';
  readonly fingerprint: string;
  readonly code: CommerceResultCode;
  readonly message: string;
}

type StoredLedger = StoredLedgerResult | StoredLedgerError;

interface StoredRestoreSuccess {
  readonly kind: 'success';
  readonly fingerprint: string;
  readonly result: RestoreOrdersResult;
}

interface StoredRestoreFailure {
  readonly kind: 'failure';
  readonly fingerprint: string;
  readonly code: CommerceResultCode;
  readonly message: string;
}

type TrustedCallback = TrustedCallbackVerification;

type CallbackResult = Readonly<{
  accepted: boolean;
  replayed: boolean;
  kind: 'payment' | 'refund';
  code?: CommerceResultCode;
  order: CommerceOrder;
  wallet: CurrencyWallet;
  revoked?: CurrencyGrant;
}>;

interface DeliveryPlan {
  readonly kind: 'deliver' | 'already-paid' | 'blocked-refunded' | 'refund';
  readonly order: CommerceOrder;
  readonly payment: TrustedPaymentVerification;
}

interface CommerceMutationSnapshot {
  readonly orders: ReadonlyMap<string, CommerceOrder>;
  readonly wallets: ReadonlyMap<string, CurrencyWallet>;
  readonly transactions: ReadonlyMap<string, string>;
  readonly restoreLedgers: ReadonlyMap<string, ReadonlyMap<string, StoredRestoreSuccess>>;
  readonly restoreFailureLedgers: ReadonlyMap<string, ReadonlyMap<string, StoredRestoreFailure>>;
}

export interface CommerceRestoreAuditRecord {
  readonly accountId: string;
  readonly requestId: string;
  readonly status: 'APPLIED' | 'FAILED';
  readonly code?: CommerceResultCode;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function stable(value: unknown, seen = new Set<object>()): string {
  if (value === undefined) return 'undefined';
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new CommerceError('INVALID_REQUEST', 'fingerprint contains a non-finite number');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object' || seen.has(value)) throw new CommerceError('INVALID_REQUEST', 'request must be JSON data');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((child) => stable(child, seen)).join(',')}]`;
    if (!isPlainRecord(value)) throw new CommerceError('INVALID_REQUEST', 'request must contain plain objects');
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key], seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function validId(value: unknown, label: string, code: CommerceResultCode = 'INVALID_REQUEST'): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || value !== value.trim()) {
    throw new CommerceError(code, `${label} is invalid`);
  }
  return value;
}

function validAmount(value: unknown, label: string, allowZero = true, code: CommerceResultCode = 'INVALID_REQUEST'): number {
  if (!Number.isSafeInteger(value) || (value as number) < (allowZero ? 0 : 1)) {
    throw new CommerceError(code, `${label} must be a ${allowZero ? 'non-negative' : 'positive'} safe integer`);
  }
  return value as number;
}

function validNow(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new CommerceError('INVALID_REQUEST', 'clock must return a non-negative safe integer');
  return value as number;
}

function cloneResult<T>(value: T): T {
  return cloneCommerce(value);
}

function copyOrder(order: CommerceOrder): CommerceOrder {
  return cloneResult(order);
}

function copyWallet(wallet: CurrencyWallet): CurrencyWallet {
  return cloneResult(wallet);
}

function copyProduct(product: CommerceProduct): CommerceProduct {
  return cloneResult(product);
}

function errorFromUnknown(error: unknown, fallback: CommerceResultCode, message: string): CommerceError {
  return error instanceof CommerceError ? error : new CommerceError(fallback, message);
}

function safeSum(left: number, right: number, label: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) throw new CommerceError('CURRENCY_OVERFLOW', `${label} exceeds safe integer range`);
  return result;
}

export interface CommerceSnapshot {
  readonly products: readonly CommerceProduct[];
  readonly orders: readonly CommerceOrder[];
  readonly wallets: readonly CurrencyWallet[];
}

export class CommerceService {
  private readonly clock: () => number;
  private readonly authenticate: (sessionToken: string) => string | null | undefined;
  private readonly verifyPayment: PaymentVerifier | null;
  private readonly verifyCallback: CallbackVerifier | null;
  private readonly verifyRefund: PaymentVerifier | null;
  private readonly makeOrderId: (sequence: number) => string;
  private readonly adminDiagnosticToken: string | null;
  private readonly products = new Map<string, CommerceProduct>();
  private readonly orders = new Map<string, CommerceOrder>();
  private readonly wallets = new Map<string, CurrencyWallet>();
  private readonly transactions = new Map<string, string>();
  private readonly createLedgers = new Map<string, Map<string, StoredLedger>>();
  private readonly verifyLedgers = new Map<string, Map<string, StoredLedger>>();
  private readonly restoreLedgers = new Map<string, Map<string, StoredRestoreSuccess>>();
  private readonly restoreFailureLedgers = new Map<string, Map<string, StoredRestoreFailure>>();
  private readonly refundLedgers = new Map<string, Map<string, StoredLedger>>();
  private readonly callbacks = new Map<string, StoredLedger>();
  private orderSequence = 0;

  constructor(options: CommerceServiceOptions = {}) {
    this.clock = options.now ?? (() => Date.now());
    this.authenticate = options.authenticateSession ?? options.sessionAccountId ?? (() => null);
    this.verifyPayment = options.paymentVerifier ?? options.receiptVerifier ?? null;
    this.verifyCallback = options.callbackVerifier ?? null;
    this.verifyRefund = options.refundVerifier ?? null;
    this.makeOrderId = options.orderId ?? ((sequence) => `order_${sequence}`);
    this.adminDiagnosticToken = options.adminDiagnosticToken === undefined
      ? null
      : validId(options.adminDiagnosticToken, 'adminDiagnosticToken');
    const products = options.products ?? DEFAULT_COMMERCE_PRODUCTS;
    if (!Array.isArray(products) || products.length === 0) throw new CommerceError('INVALID_REQUEST', 'products must be a non-empty array');
    for (const rawProduct of products) {
      const product = this.normalizeProduct(rawProduct);
      if (this.products.has(product.productId)) throw new CommerceError('INVALID_REQUEST', `duplicate product ${product.productId}`);
      this.products.set(product.productId, product);
    }
  }

  catalog(): readonly CommerceProduct[] {
    return Object.freeze([...this.products.values()].map(copyProduct));
  }

  createOrder(request: CreateOrderRequest): CreateOrderResult {
    const accountId = this.requireAccount(request?.sessionToken);
    const requestId = validId(request?.requestId, 'requestId');
    const productId = validId(request?.productId, 'productId');
    const fingerprint = stable({ productId });
    const ledger = this.ledgerFor(this.createLedgers, accountId);
    const replay = this.replay<CreateOrderResult>(ledger, requestId, fingerprint);
    if (replay !== undefined) return replay;
    try {
      const product = this.products.get(productId);
      if (product === undefined) throw new CommerceError('PRODUCT_NOT_FOUND', `product ${productId} was not found`);
      const now = validNow(this.clock());
      const orderId = validId(this.makeOrderId(++this.orderSequence), 'orderId');
      if (this.orders.has(orderId)) throw new CommerceError('INVALID_REQUEST', `orderId ${orderId} already exists`);
      const order: CommerceOrder = {
        schemaVersion: COMMERCE_SCHEMA_VERSION,
        orderId,
        accountId,
        productId: product.productId,
        provider: product.provider,
        priceMinor: product.priceMinor,
        priceCurrency: product.priceCurrency,
        grant: cloneResult(product.grant),
        status: 'CREATED',
        createdAt: now,
        updatedAt: now,
      };
      this.orders.set(orderId, order);
      const result: CreateOrderResult = { accepted: true, replayed: false, order: copyOrder(order) };
      this.storeResult(ledger, requestId, fingerprint, result);
      return cloneResult(result);
    } catch (error) {
      const commerceError = errorFromUnknown(error, 'INVALID_REQUEST', 'order creation failed');
      this.storeError(ledger, requestId, fingerprint, commerceError);
      throw commerceError;
    }
  }

  verifyOrder(request: VerifyOrderRequest): VerifyOrderResult {
    const accountId = this.requireAccount(request?.sessionToken);
    const requestId = validId(request?.requestId, 'requestId');
    const orderId = validId(request?.orderId, 'orderId');
    const fingerprint = stable({ orderId, receipt: request?.receipt });
    const ledger = this.ledgerFor(this.verifyLedgers, accountId);
    const replay = this.replay<VerifyOrderResult>(ledger, requestId, fingerprint);
    if (replay !== undefined) return replay;
    try {
      const order = this.requireOrderForAccount(orderId, accountId);
      if (order.status === 'REFUNDED') {
        const result = this.blockedVerification(order, accountId);
        this.storeResult(ledger, requestId, fingerprint, result);
        return cloneResult(result);
      }
      const payment = this.requirePaymentVerification(request.receipt, {
        action: 'verify', accountId, orderId, productId: order.productId, provider: order.provider,
      });
      this.assertPaymentMatches(order, payment);
      const result = this.settlePayment(order, payment);
      this.storeResult(ledger, requestId, fingerprint, result);
      return cloneResult(result);
    } catch (error) {
      const commerceError = errorFromUnknown(error, 'PAYMENT_VERIFICATION_FAILED', 'payment verification failed');
      this.storeError(ledger, requestId, fingerprint, commerceError);
      throw commerceError;
    }
  }

  restoreOrders(request: RestoreOrdersRequest): RestoreOrdersResult {
    const accountId = this.requireAccount(request?.sessionToken);
    const requestId = validId(request?.requestId, 'requestId');
    if (!Array.isArray(request?.receipts) || request.receipts.length < 1 || request.receipts.length > 50) {
      throw new CommerceError('INVALID_REQUEST', 'receipts must contain 1..50 entries');
    }
    const fingerprint = stable({ receipts: request.receipts });
    const replay = this.replayRestore(accountId, requestId, fingerprint);
    if (replay !== undefined) return replay;
    const mutationSnapshot = this.captureMutationSnapshot();
    try {
      const payments = request.receipts.map((receipt) => this.requirePaymentVerification(receipt, { action: 'restore', accountId }));
      const plans: Array<DeliveryPlan | { readonly kind: 'duplicate-local'; readonly orderId: string }> = [];
      const localTransactions = new Map<string, { readonly orderId: string; readonly receiptId: string }>();
      const localOrders = new Map<string, CommerceOrder>();
      for (const payment of payments) {
        const order = localOrders.get(payment.orderId) ?? this.requireOrderForAccount(payment.orderId, accountId);
        this.assertPaymentMatches(order, payment);
        const transactionKey = this.transactionKey(payment.provider, payment.transactionId);
        const previousTransaction = localTransactions.get(transactionKey);
        if (previousTransaction !== undefined) {
          if (previousTransaction.orderId !== order.orderId) throw new CommerceError('PAYMENT_ALREADY_USED', 'one transaction was supplied for multiple orders');
          if (payment.status === 'REFUNDED') {
            const refundPlan = this.planPayment(order, payment);
            plans.push(refundPlan);
            if (refundPlan.kind === 'refund') localOrders.set(order.orderId, { ...order, status: 'REFUNDED' });
            continue;
          }
          if (previousTransaction.receiptId !== payment.receiptId && payment.status !== 'REFUNDED') throw new CommerceError('PAYMENT_MISMATCH', 'one transaction was supplied with different receipts');
          plans.push({ kind: 'duplicate-local', orderId: order.orderId });
          continue;
        }
        localTransactions.set(transactionKey, { orderId: order.orderId, receiptId: payment.receiptId });
        const plan = this.planPayment(order, payment);
        plans.push(plan);
        if (plan.kind === 'deliver') {
          localOrders.set(order.orderId, {
            ...order,
            status: 'PAID',
            transactionId: payment.transactionId,
            receiptId: payment.receiptId,
          });
        } else if (plan.kind === 'refund') {
          localOrders.set(order.orderId, { ...order, status: 'REFUNDED' });
        }
      }
      const results: VerifyOrderResult[] = [];
      for (const plan of plans) {
        if (plan.kind === 'duplicate-local') {
          const current = this.requireOrder(plan.orderId);
          results.push(current.status === 'REFUNDED'
            ? this.blockedVerification(current, accountId)
            : this.alreadySettled(current, this.walletFor(accountId)));
        } else {
          results.push(this.applyDeliveryPlan(plan));
        }
      }
      const result: RestoreOrdersResult = { accepted: true, replayed: false, results: Object.freeze(results.map(cloneResult)) };
      this.storeRestoreSuccess(accountId, requestId, fingerprint, result);
      return cloneResult(result);
    } catch (error) {
      const commerceError = errorFromUnknown(error, 'PAYMENT_VERIFICATION_FAILED', 'purchase restore failed');
      this.restoreMutationSnapshot(mutationSnapshot);
      this.storeRestoreFailure(accountId, requestId, fingerprint, commerceError);
      throw commerceError;
    }
  }

  refundOrder(request: RefundOrderRequest): RefundResult {
    const accountId = this.requireAccount(request?.sessionToken);
    const requestId = validId(request?.requestId, 'requestId');
    const orderId = validId(request?.orderId, 'orderId');
    const fingerprint = stable({ orderId, proof: request?.proof });
    const ledger = this.ledgerFor(this.refundLedgers, accountId);
    const replay = this.replay<RefundResult>(ledger, requestId, fingerprint);
    if (replay !== undefined) return replay;
    try {
      const order = this.requireOrderForAccount(orderId, accountId);
      if (order.status === 'REFUNDED') {
        const result = this.alreadyRefunded(order, accountId);
        this.storeResult(ledger, requestId, fingerprint, result);
        return cloneResult(result);
      }
      const refund = this.requireRefundVerification(request.proof, {
        action: 'refund', accountId, orderId, productId: order.productId, provider: order.provider,
      });
      this.assertRefundMatches(order, refund);
      const result = this.applyRefund(order, refund, false);
      this.storeResult(ledger, requestId, fingerprint, result);
      return cloneResult(result);
    } catch (error) {
      const commerceError = errorFromUnknown(error, 'REFUND_VERIFICATION_FAILED', 'refund verification failed');
      this.storeError(ledger, requestId, fingerprint, commerceError);
      throw commerceError;
    }
  }

  handleProviderCallback(request: Readonly<{ eventId: string; payload: unknown }>): CallbackResult;
  handleProviderCallback(eventId: string, payload: unknown): CallbackResult;
  handleProviderCallback(eventOrRequest: string | Readonly<{ eventId: string; payload: unknown }>, rawPayload?: unknown): CallbackResult {
    const eventId = typeof eventOrRequest === 'string' ? eventOrRequest : eventOrRequest?.eventId;
    const payload = typeof eventOrRequest === 'string' ? rawPayload : eventOrRequest?.payload;
    const callbackId = validId(eventId, 'eventId');
    const fingerprint = stable({ eventId: callbackId, payload });
    const previous = this.callbacks.get(callbackId);
    if (previous !== undefined) {
      if (previous.fingerprint !== fingerprint) throw new CommerceError('CALLBACK_ID_REUSED', 'eventId was reused with different data');
      return this.replayStored<CallbackResult>(previous);
    }
    try {
      if (this.verifyCallback === null) throw new CommerceError('PAYMENT_VERIFICATION_UNAVAILABLE', 'callback verifier is not configured');
      const callback = this.verifyCallback(callbackId, payload, { action: 'callback' });
      const trusted = this.normalizeCallback(callback, callbackId);
      const order = this.requireOrder(trusted.orderId);
      if (order.accountId !== trusted.accountId) throw new CommerceError('CALLBACK_ORDER_MISMATCH', 'callback account does not own the order');
      if (trusted.kind === 'refund') {
        this.assertRefundMatches(order, trusted);
        const result = this.applyRefund(order, trusted, false);
        const callbackResult: CallbackResult = { ...result, kind: 'refund' };
        this.callbacks.set(callbackId, { kind: 'result', fingerprint, result: cloneResult(callbackResult) });
        return cloneResult(callbackResult);
      }
      this.assertPaymentMatches(order, trusted);
      const result = this.settlePayment(order, trusted);
      const callbackResult: CallbackResult = { ...result, kind: 'payment' };
      this.callbacks.set(callbackId, { kind: 'result', fingerprint, result: cloneResult(callbackResult) });
      return cloneResult(callbackResult);
    } catch (error) {
      const commerceError = errorFromUnknown(error, 'CALLBACK_VERIFICATION_FAILED', 'provider callback verification failed');
      this.callbacks.set(callbackId, { kind: 'error', fingerprint, code: commerceError.code, message: commerceError.message });
      throw commerceError;
    }
  }

  verifyReceipt(request: VerifyOrderRequest): VerifyOrderResult {
    return this.verifyOrder(request);
  }

  restorePurchases(request: RestoreOrdersRequest): RestoreOrdersResult {
    return this.restoreOrders(request);
  }

  requestRefund(request: RefundOrderRequest): RefundResult {
    return this.refundOrder(request);
  }

  processProviderCallback(eventOrRequest: string | Readonly<{ eventId: string; payload: unknown }>, rawPayload?: unknown): CallbackResult {
    return typeof eventOrRequest === 'string'
      ? this.handleProviderCallback(eventOrRequest, rawPayload)
      : this.handleProviderCallback(eventOrRequest);
  }

  getWallet(sessionToken: string): CurrencyWallet {
    const accountId = this.requireAccount(sessionToken);
    return copyWallet(this.walletFor(accountId));
  }

  listOrders(sessionToken: string): readonly CommerceOrder[] {
    const accountId = this.requireAccount(sessionToken);
    return Object.freeze([...this.orders.values()].filter((order) => order.accountId === accountId).map(copyOrder));
  }

  restoreAudit(adminDiagnosticToken?: string): readonly CommerceRestoreAuditRecord[] {
    if (this.adminDiagnosticToken === null || adminDiagnosticToken !== this.adminDiagnosticToken) {
      throw new CommerceError('UNAUTHENTICATED', 'diagnostic restore audit is not authorized');
    }
    const records: CommerceRestoreAuditRecord[] = [];
    for (const [accountId, ledger] of this.restoreLedgers) {
      for (const [requestId, record] of ledger) records.push({ accountId, requestId, status: record.kind === 'success' ? 'APPLIED' : 'FAILED' });
    }
    for (const [accountId, ledger] of this.restoreFailureLedgers) {
      for (const [requestId, record] of ledger) records.push({ accountId, requestId, status: 'FAILED', code: record.code });
    }
    records.sort((left, right) => `${left.accountId}\u0000${left.requestId}\u0000${left.status}`.localeCompare(`${right.accountId}\u0000${right.requestId}\u0000${right.status}`));
    return Object.freeze(records.map((record) => Object.freeze(record)));
  }

  snapshot(adminDiagnosticToken?: string): CommerceSnapshot {
    if (this.adminDiagnosticToken === null || adminDiagnosticToken !== this.adminDiagnosticToken) {
      throw new CommerceError('UNAUTHENTICATED', 'diagnostic snapshot is not authorized');
    }
    return {
      products: this.catalog(),
      orders: Object.freeze([...this.orders.values()].map(copyOrder)),
      wallets: Object.freeze([...this.wallets.values()].map(copyWallet)),
    };
  }

  private normalizeProduct(raw: CommerceProduct): CommerceProduct {
    if (!isPlainRecord(raw)) throw new CommerceError('INVALID_REQUEST', 'product must be a plain object');
    const productId = validId(raw.productId, 'productId');
    const provider = validId(raw.provider, 'provider');
    const priceCurrency = validId(raw.priceCurrency, 'priceCurrency');
    const priceMinor = validAmount(raw.priceMinor, 'priceMinor');
    if (!isPlainRecord(raw.grant)) throw new CommerceError('INVALID_REQUEST', 'product grant must be an object');
    const grant: CurrencyGrant = {
      freeCurrency: validAmount(raw.grant.freeCurrency, 'grant.freeCurrency'),
      paidCurrency: validAmount(raw.grant.paidCurrency, 'grant.paidCurrency'),
    };
    if (grant.freeCurrency === 0 && grant.paidCurrency === 0) throw new CommerceError('INVALID_REQUEST', 'product grant cannot be empty');
    if (priceMinor === 0 && grant.paidCurrency > 0) throw new CommerceError('INVALID_REQUEST', 'a paid grant requires a positive price');
    return cloneResult({ productId, provider, priceMinor, priceCurrency, grant });
  }

  private requireAccount(sessionToken: unknown): string {
    const token = validId(sessionToken, 'sessionToken', 'UNAUTHENTICATED');
    let accountId: string | null | undefined;
    try {
      accountId = this.authenticate(token);
    } catch {
      accountId = null;
    }
    if (typeof accountId !== 'string' || accountId.length === 0 || accountId !== accountId.trim()) {
      throw new CommerceError('UNAUTHENTICATED', 'session is not valid');
    }
    return accountId;
  }

  private requireOrder(orderId: string): CommerceOrder {
    const order = this.orders.get(orderId);
    if (order === undefined) throw new CommerceError('ORDER_NOT_FOUND', `order ${orderId} was not found`);
    return order;
  }

  private requireOrderForAccount(orderId: string, accountId: string): CommerceOrder {
    const order = this.requireOrder(orderId);
    if (order.accountId !== accountId) throw new CommerceError('ORDER_ACCOUNT_MISMATCH', 'order does not belong to the authenticated account');
    return order;
  }

  private walletFor(accountId: string): CurrencyWallet {
    const current = this.wallets.get(accountId);
    if (current !== undefined) return current;
    const wallet: CurrencyWallet = { accountId, freeCurrency: 0, paidCurrency: 0, updatedAt: validNow(this.clock()) };
    this.wallets.set(accountId, wallet);
    return wallet;
  }

  private transactionKey(provider: string, transactionId: string): string {
    return stable([provider, transactionId]);
  }

  private captureMutationSnapshot(): CommerceMutationSnapshot {
    const orders = new Map<string, CommerceOrder>();
    for (const [orderId, order] of this.orders) orders.set(orderId, copyOrder(order));
    const wallets = new Map<string, CurrencyWallet>();
    for (const [accountId, wallet] of this.wallets) wallets.set(accountId, copyWallet(wallet));
    const restoreLedgers = new Map<string, ReadonlyMap<string, StoredRestoreSuccess>>();
    for (const [accountId, ledger] of this.restoreLedgers) {
      const copied = new Map<string, StoredRestoreSuccess>();
      for (const [requestId, record] of ledger) copied.set(requestId, { kind: 'success', fingerprint: record.fingerprint, result: cloneResult(record.result) });
      restoreLedgers.set(accountId, copied);
    }
    const restoreFailureLedgers = new Map<string, ReadonlyMap<string, StoredRestoreFailure>>();
    for (const [accountId, ledger] of this.restoreFailureLedgers) {
      const copied = new Map<string, StoredRestoreFailure>();
      for (const [requestId, record] of ledger) copied.set(requestId, { ...record });
      restoreFailureLedgers.set(accountId, copied);
    }
    return { orders, wallets, transactions: new Map(this.transactions), restoreLedgers, restoreFailureLedgers };
  }

  private restoreMutationSnapshot(snapshot: CommerceMutationSnapshot): void {
    this.orders.clear();
    for (const [orderId, order] of snapshot.orders) this.orders.set(orderId, copyOrder(order));
    this.wallets.clear();
    for (const [accountId, wallet] of snapshot.wallets) this.wallets.set(accountId, copyWallet(wallet));
    this.transactions.clear();
    for (const [key, orderId] of snapshot.transactions) this.transactions.set(key, orderId);
    this.restoreLedgers.clear();
    for (const [accountId, ledger] of snapshot.restoreLedgers) {
      const copied = new Map<string, StoredRestoreSuccess>();
      for (const [requestId, record] of ledger) copied.set(requestId, { kind: 'success', fingerprint: record.fingerprint, result: cloneResult(record.result) });
      this.restoreLedgers.set(accountId, copied);
    }
    this.restoreFailureLedgers.clear();
    for (const [accountId, ledger] of snapshot.restoreFailureLedgers) {
      const copied = new Map<string, StoredRestoreFailure>();
      for (const [requestId, record] of ledger) copied.set(requestId, { ...record });
      this.restoreFailureLedgers.set(accountId, copied);
    }
  }

  private planPayment(order: CommerceOrder, payment: TrustedPaymentVerification): DeliveryPlan {
    if (order.status === 'REFUNDED') return { kind: 'blocked-refunded', order, payment };
    const usedBy = this.transactions.get(this.transactionKey(payment.provider, payment.transactionId));
    if (usedBy !== undefined && usedBy !== order.orderId) throw new CommerceError('PAYMENT_ALREADY_USED', 'transaction was already used by another order');
    if (order.status === 'PAID') {
      if (payment.status === 'REFUNDED') {
        if (order.transactionId !== payment.transactionId) throw new CommerceError('PAYMENT_MISMATCH', 'refund transaction does not match the paid order');
        return { kind: 'refund', order, payment };
      }
      if (order.transactionId !== payment.transactionId || order.receiptId !== payment.receiptId) throw new CommerceError('PAYMENT_MISMATCH', 'paid order was presented with a different transaction');
      return { kind: 'already-paid', order, payment };
    }
    if (payment.status === 'REFUNDED') return { kind: 'refund', order, payment };
    return { kind: 'deliver', order, payment };
  }

  private applyDeliveryPlan(plan: DeliveryPlan): VerifyOrderResult {
    if (plan.kind === 'blocked-refunded') return this.blockedVerification(plan.order, plan.order.accountId);
    if (plan.kind === 'already-paid') return this.alreadySettled(plan.order, this.walletFor(plan.order.accountId));
    if (plan.kind === 'refund') {
      const refund = plan.payment;
      if (refund.refundId === undefined) throw new CommerceError('PAYMENT_VERIFICATION_FAILED', 'refunded payment is missing refundId');
      const result = this.applyRefund(plan.order, {
        verified: true,
        kind: 'refund',
        accountId: refund.accountId,
        orderId: refund.orderId,
        productId: refund.productId,
        provider: refund.provider,
        transactionId: refund.transactionId,
        refundId: refund.refundId,
        amountMinor: refund.amountMinor,
        priceCurrency: refund.priceCurrency,
      }, false);
      return {
        accepted: false,
        delivered: false,
        replayed: result.replayed,
        code: 'ORDER_REFUNDED',
        order: result.order,
        wallet: result.wallet,
      };
    }
    return this.deliver(plan.order, plan.payment, false);
  }

  private settlePayment(order: CommerceOrder, payment: TrustedPaymentVerification): VerifyOrderResult {
    return this.applyDeliveryPlan(this.planPayment(order, payment));
  }

  private deliver(order: CommerceOrder, payment: TrustedPaymentVerification, replayed: boolean): VerifyOrderResult {
    if (order.status === 'REFUNDED') return this.blockedVerification(order, order.accountId);
    const now = validNow(this.clock());
    const wallet = this.walletFor(order.accountId);
    const nextWallet: CurrencyWallet = {
      ...wallet,
      freeCurrency: safeSum(wallet.freeCurrency, order.grant.freeCurrency, 'freeCurrency'),
      paidCurrency: safeSum(wallet.paidCurrency, order.grant.paidCurrency, 'paidCurrency'),
      updatedAt: Math.max(now, wallet.updatedAt),
    };
    const nextOrder: CommerceOrder = {
      ...order,
      status: 'PAID',
      transactionId: payment.transactionId,
      receiptId: payment.receiptId,
      verifiedAt: now,
      updatedAt: Math.max(now, order.updatedAt),
    };
    this.transactions.set(this.transactionKey(payment.provider, payment.transactionId), order.orderId);
    this.wallets.set(order.accountId, nextWallet);
    this.orders.set(order.orderId, nextOrder);
    return { accepted: true, delivered: true, replayed, order: copyOrder(nextOrder), wallet: copyWallet(nextWallet) };
  }

  private alreadySettled(order: CommerceOrder, wallet: CurrencyWallet): VerifyOrderResult {
    return { accepted: true, delivered: false, replayed: false, order: copyOrder(order), wallet: copyWallet(wallet) };
  }

  private blockedVerification(order: CommerceOrder, accountId: string): VerifyOrderResult {
    return { accepted: false, delivered: false, replayed: false, code: 'ORDER_REFUNDED', order: copyOrder(order), wallet: copyWallet(this.walletFor(accountId)) };
  }

  private applyRefund(order: CommerceOrder, refund: TrustedRefundVerification, replayed: boolean): RefundResult {
    if (order.status === 'REFUNDED') return this.alreadyRefunded(order, order.accountId);
    const usedBy = this.transactions.get(this.transactionKey(refund.provider, refund.transactionId));
    if (usedBy !== undefined && usedBy !== order.orderId) throw new CommerceError('PAYMENT_ALREADY_USED', 'refund transaction was already used by another order');
    const now = validNow(this.clock());
    const wallet = this.walletFor(order.accountId);
    const revoked: CurrencyGrant = {
      freeCurrency: Math.min(wallet.freeCurrency, order.grant.freeCurrency),
      paidCurrency: Math.min(wallet.paidCurrency, order.grant.paidCurrency),
    };
    const nextWallet: CurrencyWallet = {
      ...wallet,
      freeCurrency: wallet.freeCurrency - revoked.freeCurrency,
      paidCurrency: wallet.paidCurrency - revoked.paidCurrency,
      updatedAt: Math.max(now, wallet.updatedAt),
    };
    const nextOrder: CommerceOrder = {
      ...order,
      status: 'REFUNDED',
      refundId: refund.refundId,
      refundedAt: now,
      updatedAt: Math.max(now, order.updatedAt),
    };
    this.transactions.set(this.transactionKey(refund.provider, refund.transactionId), order.orderId);
    this.wallets.set(order.accountId, nextWallet);
    this.orders.set(order.orderId, nextOrder);
    return { accepted: true, refunded: true, replayed, order: copyOrder(nextOrder), wallet: copyWallet(nextWallet), revoked: cloneResult(revoked) };
  }

  private alreadyRefunded(order: CommerceOrder, accountId: string): RefundResult {
    return {
      accepted: false,
      refunded: false,
      replayed: false,
      code: 'ORDER_REFUNDED',
      order: copyOrder(order),
      wallet: copyWallet(this.walletFor(accountId)),
      revoked: { freeCurrency: 0, paidCurrency: 0 },
    };
  }

  private assertPaymentMatches(order: CommerceOrder, payment: TrustedPaymentVerification): void {
    if (payment.status === 'REFUNDED') {
      validId(payment.refundId, 'refundId', 'PAYMENT_VERIFICATION_FAILED');
    } else if (payment.status !== undefined && payment.status !== 'PAID') {
      throw new CommerceError('PAYMENT_VERIFICATION_FAILED', 'payment is not paid');
    }
    if (payment.verified !== true || payment.accountId !== order.accountId || payment.orderId !== order.orderId
      || payment.productId !== order.productId || payment.provider !== order.provider
      || payment.amountMinor !== order.priceMinor || payment.priceCurrency !== order.priceCurrency) {
      throw new CommerceError('PAYMENT_MISMATCH', 'verified payment does not match the server order');
    }
    validId(payment.transactionId, 'transactionId', 'PAYMENT_VERIFICATION_FAILED');
    validId(payment.receiptId, 'receiptId', 'PAYMENT_VERIFICATION_FAILED');
  }

  private assertRefundMatches(order: CommerceOrder, refund: TrustedRefundVerification): void {
    if (refund.verified !== true || refund.kind !== 'refund' || refund.accountId !== order.accountId || refund.orderId !== order.orderId
      || refund.productId !== order.productId || refund.provider !== order.provider || refund.amountMinor !== order.priceMinor
      || refund.priceCurrency !== order.priceCurrency || (order.transactionId !== undefined && refund.transactionId !== order.transactionId)) {
      throw new CommerceError('REFUND_MISMATCH', 'verified refund does not match the server order');
    }
    validId(refund.transactionId, 'transactionId', 'REFUND_VERIFICATION_FAILED');
    validId(refund.refundId, 'refundId', 'REFUND_VERIFICATION_FAILED');
  }

  private requirePaymentVerification(raw: unknown, context: PaymentVerificationContext): TrustedPaymentVerification {
    if (this.verifyPayment === null) throw new CommerceError('PAYMENT_VERIFICATION_UNAVAILABLE', 'payment verifier is not configured');
    let result: TrustedPaymentVerification | TrustedRefundVerification | null | undefined;
    try {
      result = this.verifyPayment(raw, context);
    } catch {
      throw new CommerceError('PAYMENT_VERIFICATION_FAILED', 'payment verifier rejected the receipt');
    }
    if (result === null || result === undefined || result.verified !== true || result.kind === 'refund') {
      throw new CommerceError('PAYMENT_VERIFICATION_FAILED', 'receipt was not verified by the payment provider');
    }
    return this.normalizePayment(result);
  }

  private requireRefundVerification(raw: unknown, context: PaymentVerificationContext): TrustedRefundVerification {
    if (this.verifyRefund === null) throw new CommerceError('REFUND_VERIFICATION_UNAVAILABLE', 'refund verifier is not configured');
    let result: TrustedPaymentVerification | TrustedRefundVerification | null | undefined;
    try {
      result = this.verifyRefund(raw, context);
    } catch {
      throw new CommerceError('REFUND_VERIFICATION_FAILED', 'refund verifier rejected the proof');
    }
    if (result === null || result === undefined || result.verified !== true || result.kind !== 'refund') {
      throw new CommerceError('REFUND_VERIFICATION_FAILED', 'refund was not verified by the payment provider');
    }
    return this.normalizeRefund(result);
  }

  private normalizePayment(value: TrustedPaymentVerification): TrustedPaymentVerification {
    if (!isPlainRecord(value)) throw new CommerceError('PAYMENT_VERIFICATION_FAILED', 'payment verification result is invalid');
    return {
      verified: true,
      kind: 'payment',
      status: value.status ?? 'PAID',
      accountId: validId(value.accountId, 'accountId', 'PAYMENT_VERIFICATION_FAILED'),
      orderId: validId(value.orderId, 'orderId', 'PAYMENT_VERIFICATION_FAILED'),
      productId: validId(value.productId, 'productId', 'PAYMENT_VERIFICATION_FAILED'),
      provider: validId(value.provider, 'provider', 'PAYMENT_VERIFICATION_FAILED'),
      transactionId: validId(value.transactionId, 'transactionId', 'PAYMENT_VERIFICATION_FAILED'),
      receiptId: validId(value.receiptId, 'receiptId', 'PAYMENT_VERIFICATION_FAILED'),
      amountMinor: validAmount(value.amountMinor, 'amountMinor', true, 'PAYMENT_VERIFICATION_FAILED'),
      priceCurrency: validId(value.priceCurrency, 'priceCurrency', 'PAYMENT_VERIFICATION_FAILED'),
      ...(value.refundId === undefined ? {} : { refundId: validId(value.refundId, 'refundId', 'PAYMENT_VERIFICATION_FAILED') }),
    };
  }

  private normalizeRefund(value: TrustedRefundVerification): TrustedRefundVerification {
    if (!isPlainRecord(value)) throw new CommerceError('REFUND_VERIFICATION_FAILED', 'refund verification result is invalid');
    return {
      verified: true,
      kind: 'refund',
      accountId: validId(value.accountId, 'accountId', 'REFUND_VERIFICATION_FAILED'),
      orderId: validId(value.orderId, 'orderId', 'REFUND_VERIFICATION_FAILED'),
      productId: validId(value.productId, 'productId', 'REFUND_VERIFICATION_FAILED'),
      provider: validId(value.provider, 'provider', 'REFUND_VERIFICATION_FAILED'),
      transactionId: validId(value.transactionId, 'transactionId', 'REFUND_VERIFICATION_FAILED'),
      refundId: validId(value.refundId, 'refundId', 'REFUND_VERIFICATION_FAILED'),
      amountMinor: validAmount(value.amountMinor, 'amountMinor', true, 'REFUND_VERIFICATION_FAILED'),
      priceCurrency: validId(value.priceCurrency, 'priceCurrency', 'REFUND_VERIFICATION_FAILED'),
    };
  }

  private normalizeCallback(value: TrustedCallbackVerification | null | undefined, eventId: string): TrustedCallback {
    if (value === null || value === undefined || value.verified !== true || value.eventId !== eventId
      || (value.kind !== 'payment' && value.kind !== 'refund')) {
      throw new CommerceError('CALLBACK_VERIFICATION_FAILED', 'callback was not verified by the payment provider');
    }
    if (value.kind === 'refund') return { ...this.normalizeRefund(value), eventId, kind: 'refund' } as TrustedCallback;
    return { ...this.normalizePayment(value), eventId, kind: 'payment' } as TrustedCallback;
  }

  private restoreLedgerFor(accountId: string): Map<string, StoredRestoreSuccess> {
    const existing = this.restoreLedgers.get(accountId);
    if (existing !== undefined) return existing;
    const created = new Map<string, StoredRestoreSuccess>();
    this.restoreLedgers.set(accountId, created);
    return created;
  }

  private restoreFailureLedgerFor(accountId: string): Map<string, StoredRestoreFailure> {
    const existing = this.restoreFailureLedgers.get(accountId);
    if (existing !== undefined) return existing;
    const created = new Map<string, StoredRestoreFailure>();
    this.restoreFailureLedgers.set(accountId, created);
    return created;
  }

  private replayRestore(accountId: string, requestId: string, fingerprint: string): RestoreOrdersResult | undefined {
    const success = this.restoreLedgers.get(accountId)?.get(requestId);
    const failure = this.restoreFailureLedgers.get(accountId)?.get(requestId);
    if (success !== undefined && failure !== undefined) throw new CommerceError('INVALID_REQUEST', 'restore success and failure ledgers conflict');
    if (success !== undefined) {
      if (success.fingerprint !== fingerprint) throw new CommerceError('REQUEST_ID_REUSED', 'requestId was reused with different data');
      return { ...cloneResult(success.result), replayed: true };
    }
    if (failure !== undefined) {
      if (failure.fingerprint !== fingerprint) throw new CommerceError('REQUEST_ID_REUSED', 'requestId was reused with different data');
      throw new CommerceError(failure.code, failure.message);
    }
    return undefined;
  }

  private storeRestoreSuccess(accountId: string, requestId: string, fingerprint: string, result: RestoreOrdersResult): void {
    this.restoreLedgerFor(accountId).set(requestId, { kind: 'success', fingerprint, result: cloneResult(result) });
  }

  private storeRestoreFailure(accountId: string, requestId: string, fingerprint: string, error: CommerceError): void {
    this.restoreFailureLedgerFor(accountId).set(requestId, {
      kind: 'failure', fingerprint, code: error.code, message: error.message,
    });
  }

  private ledgerFor(collection: Map<string, Map<string, StoredLedger>>, accountId: string): Map<string, StoredLedger> {
    const existing = collection.get(accountId);
    if (existing !== undefined) return existing;
    const created = new Map<string, StoredLedger>();
    collection.set(accountId, created);
    return created;
  }

  private replay<T>(ledger: Map<string, StoredLedger>, requestId: string, fingerprint: string): T | undefined {
    const previous = ledger.get(requestId);
    if (previous === undefined) return undefined;
    if (previous.fingerprint !== fingerprint) throw new CommerceError('REQUEST_ID_REUSED', 'requestId was reused with different data');
    return this.replayStored<T>(previous);
  }

  private replayStored<T>(previous: StoredLedger): T {
    if (previous.kind === 'error') throw new CommerceError(previous.code, previous.message);
    const result = cloneResult(previous.result) as T;
    if (isPlainRecord(result) && 'replayed' in result) return { ...result, replayed: true } as T;
    return result;
  }

  private storeResult(ledger: Map<string, StoredLedger>, requestId: string, fingerprint: string, result: unknown): void {
    ledger.set(requestId, { kind: 'result', fingerprint, result: cloneResult(result) });
  }

  private storeError(ledger: Map<string, StoredLedger>, requestId: string, fingerprint: string, error: CommerceError): void {
    ledger.set(requestId, { kind: 'error', fingerprint, code: error.code, message: error.message });
  }
}

export const BackendCommerceService = CommerceService;
export const CommerceBackendService = CommerceService;
