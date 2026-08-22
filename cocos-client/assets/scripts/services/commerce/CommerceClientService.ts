import {
  CommerceError,
  cloneCommerce,
  type CreateOrderRequest,
  type CreateOrderResult,
  type CurrencyWallet,
  type RefundOrderRequest,
  type RefundResult,
  type RestoreOrdersRequest,
  type RestoreOrdersResult,
  type VerifyOrderRequest,
  type VerifyOrderResult,
  type CommerceOrder,
} from './commerce-contract.ts';

export { CommerceError } from './commerce-contract.ts';
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
} from './commerce-contract.ts';

export interface CommerceClientTransport {
  createOrder(request: CreateOrderRequest): CreateOrderResult;
  verifyOrder(request: VerifyOrderRequest): VerifyOrderResult;
  restoreOrders(request: RestoreOrdersRequest): RestoreOrdersResult;
  refundOrder(request: RefundOrderRequest): RefundResult;
  getWallet(sessionToken: string): CurrencyWallet;
  listOrders(sessionToken: string): readonly CommerceOrder[];
}

export interface CommerceClientOptions {
  readonly sessionToken: string | (() => string);
}

export class CommerceClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommerceClientError';
  }
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128 || value !== value.trim()) {
    throw new CommerceClientError(`${label} is invalid`);
  }
  return value;
}

function clone<T>(value: T): T {
  return cloneCommerce(value);
}

function exactKeys(value: unknown, keys: readonly string[], label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new CommerceClientError(`${label} must be an object`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) throw new CommerceClientError(`${label} contains unsupported fields`);
}

export class CommerceClientService {
  private readonly transport: CommerceClientTransport;
  private readonly sessionToken: string | (() => string);

  constructor(transport: CommerceClientTransport, options: CommerceClientOptions) {
    if (!transport || typeof transport.createOrder !== 'function' || typeof transport.verifyOrder !== 'function'
      || typeof transport.restoreOrders !== 'function' || typeof transport.refundOrder !== 'function'
      || typeof transport.getWallet !== 'function' || typeof transport.listOrders !== 'function') {
      throw new CommerceClientError('commerce transport is required');
    }
    if (typeof options?.sessionToken !== 'string' && typeof options?.sessionToken !== 'function') {
      throw new CommerceClientError('sessionToken is required');
    }
    this.transport = transport;
    this.sessionToken = typeof options.sessionToken === 'string'
      ? requiredText(options.sessionToken, 'sessionToken')
      : options.sessionToken;
  }

  createOrder(productId: string, requestId: string): CreateOrderResult;
  createOrder(request: Readonly<{ productId: string; requestId: string }>): CreateOrderResult;
  createOrder(input: string | Readonly<{ productId: string; requestId: string }>, requestId?: string): CreateOrderResult {
    const request = typeof input === 'string'
      ? { productId: requiredText(input, 'productId'), requestId: requiredText(requestId, 'requestId') }
      : this.createOrderRequest(input);
    return clone(this.transport.createOrder({ sessionToken: this.requireSession(), ...request }));
  }

  verifyOrder(orderId: string, receipt: unknown, requestId: string): VerifyOrderResult;
  verifyOrder(request: Readonly<{ orderId: string; receipt: unknown; requestId: string }>): VerifyOrderResult;
  verifyOrder(input: string | Readonly<{ orderId: string; receipt: unknown; requestId: string }>, receipt?: unknown, requestId?: string): VerifyOrderResult {
    const request = typeof input === 'string'
      ? { orderId: requiredText(input, 'orderId'), receipt, requestId: requiredText(requestId, 'requestId') }
      : this.verifyOrderRequest(input);
    return clone(this.transport.verifyOrder({ sessionToken: this.requireSession(), ...request }));
  }

  verifyReceipt(orderId: string, receipt: unknown, requestId: string): VerifyOrderResult {
    return this.verifyOrder(orderId, receipt, requestId);
  }

  restoreOrders(receipts: readonly unknown[], requestId: string): RestoreOrdersResult;
  restoreOrders(request: Readonly<{ receipts: readonly unknown[]; requestId: string }>): RestoreOrdersResult;
  restoreOrders(input: readonly unknown[] | Readonly<{ receipts: readonly unknown[]; requestId: string }>, requestId?: string): RestoreOrdersResult {
    const request = Array.isArray(input)
      ? { receipts: clone(input), requestId: requiredText(requestId, 'requestId') }
      : this.restoreOrdersRequest(input);
    return clone(this.transport.restoreOrders({ sessionToken: this.requireSession(), ...request }));
  }

  restorePurchases(receipts: readonly unknown[], requestId: string): RestoreOrdersResult {
    return this.restoreOrders(receipts, requestId);
  }

  refundOrder(orderId: string, requestId: string, proof?: unknown): RefundResult;
  refundOrder(request: Readonly<{ orderId: string; requestId: string; proof?: unknown }>): RefundResult;
  refundOrder(input: string | Readonly<{ orderId: string; requestId: string; proof?: unknown }>, requestId?: string, proof?: unknown): RefundResult {
    const request = typeof input === 'string'
      ? { orderId: requiredText(input, 'orderId'), requestId: requiredText(requestId, 'requestId'), ...(proof === undefined ? {} : { proof: clone(proof) }) }
      : this.refundOrderRequest(input);
    return clone(this.transport.refundOrder({ sessionToken: this.requireSession(), ...request }));
  }

  requestRefund(orderId: string, requestId: string, proof?: unknown): RefundResult {
    return this.refundOrder(orderId, requestId, proof);
  }

  wallet(): CurrencyWallet {
    return clone(this.transport.getWallet(this.requireSession()));
  }

  orders(): readonly CommerceOrder[] {
    return Object.freeze(this.transport.listOrders(this.requireSession()).map(clone));
  }

  private createOrderRequest(input: Readonly<{ productId: string; requestId: string }>): { productId: string; requestId: string } {
    exactKeys(input, ['productId', 'requestId'], 'createOrder');
    return { productId: requiredText(input.productId, 'productId'), requestId: requiredText(input.requestId, 'requestId') };
  }

  private verifyOrderRequest(input: Readonly<{ orderId: string; receipt: unknown; requestId: string }>): { orderId: string; receipt: unknown; requestId: string } {
    exactKeys(input, ['orderId', 'receipt', 'requestId'], 'verifyOrder');
    return { orderId: requiredText(input.orderId, 'orderId'), receipt: clone(input.receipt), requestId: requiredText(input.requestId, 'requestId') };
  }

  private restoreOrdersRequest(input: Readonly<{ receipts: readonly unknown[]; requestId: string }>): { receipts: readonly unknown[]; requestId: string } {
    exactKeys(input, ['receipts', 'requestId'], 'restoreOrders');
    if (!Array.isArray(input.receipts)) throw new CommerceClientError('receipts must be an array');
    return { receipts: clone(input.receipts), requestId: requiredText(input.requestId, 'requestId') };
  }

  private refundOrderRequest(input: Readonly<{ orderId: string; requestId: string; proof?: unknown }>): { orderId: string; requestId: string; proof?: unknown } {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new CommerceClientError('refundOrder must be an object');
    const keys = Object.keys(input);
    if (keys.some((key) => !['orderId', 'requestId', 'proof'].includes(key)) || !keys.includes('orderId') || !keys.includes('requestId')) {
      throw new CommerceClientError('refundOrder contains unsupported fields');
    }
    return {
      orderId: requiredText(input.orderId, 'orderId'),
      requestId: requiredText(input.requestId, 'requestId'),
      ...(input.proof === undefined ? {} : { proof: clone(input.proof) }),
    };
  }

  private requireSession(): string {
    const token = typeof this.sessionToken === 'function' ? this.sessionToken() : this.sessionToken;
    return requiredText(token, 'sessionToken');
  }
}

export const CommerceService = CommerceClientService;
export const ClientCommerceService = CommerceClientService;
