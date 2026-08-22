export const COMMERCE_SCHEMA_VERSION = 1 as const;

export const COMMERCE_ORDER_STATUS = Object.freeze(['CREATED', 'PAID', 'REFUNDED'] as const);
export type CommerceOrderStatus = typeof COMMERCE_ORDER_STATUS[number];

export const COMMERCE_CURRENCIES = Object.freeze(['freeCurrency', 'paidCurrency'] as const);
export type CommerceCurrency = typeof COMMERCE_CURRENCIES[number];

export type CurrencyGrant = Readonly<{
  freeCurrency: number;
  paidCurrency: number;
}>;

export type CurrencyWallet = Readonly<{
  accountId: string;
  freeCurrency: number;
  paidCurrency: number;
  updatedAt: number;
}>;

export type CommerceProduct = Readonly<{
  productId: string;
  provider: string;
  priceMinor: number;
  priceCurrency: string;
  grant: CurrencyGrant;
}>;

export type CommerceOrder = Readonly<{
  schemaVersion: typeof COMMERCE_SCHEMA_VERSION;
  orderId: string;
  accountId: string;
  productId: string;
  provider: string;
  priceMinor: number;
  priceCurrency: string;
  grant: CurrencyGrant;
  status: CommerceOrderStatus;
  createdAt: number;
  updatedAt: number;
  transactionId?: string;
  receiptId?: string;
  verifiedAt?: number;
  refundId?: string;
  refundedAt?: number;
}>;

export type CreateOrderRequest = Readonly<{
  sessionToken: string;
  requestId: string;
  productId: string;
}>;

export type CreateOrderResult = Readonly<{
  accepted: true;
  replayed: boolean;
  order: CommerceOrder;
}>;

export type VerifyOrderRequest = Readonly<{
  sessionToken: string;
  requestId: string;
  orderId: string;
  receipt: unknown;
}>;

export type VerifyOrderResult = Readonly<{
  accepted: boolean;
  delivered: boolean;
  replayed: boolean;
  code?: CommerceResultCode;
  order: CommerceOrder;
  wallet: CurrencyWallet;
}>;

export type RestoreOrdersRequest = Readonly<{
  sessionToken: string;
  requestId: string;
  receipts: readonly unknown[];
}>;

export type RestoreOrdersResult = Readonly<{
  accepted: true;
  replayed: boolean;
  results: readonly VerifyOrderResult[];
}>;

export type RefundOrderRequest = Readonly<{
  sessionToken: string;
  requestId: string;
  orderId: string;
  proof?: unknown;
}>;

export type RefundResult = Readonly<{
  accepted: boolean;
  refunded: boolean;
  replayed: boolean;
  code?: CommerceResultCode;
  order: CommerceOrder;
  wallet: CurrencyWallet;
  revoked: CurrencyGrant;
}>;

export type ProviderCallbackRequest = Readonly<{
  eventId: string;
  payload: unknown;
}>;

export type CommerceResultCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'PRODUCT_NOT_FOUND'
  | 'REQUEST_ID_REUSED'
  | 'ORDER_NOT_FOUND'
  | 'ORDER_ACCOUNT_MISMATCH'
  | 'ORDER_REFUNDED'
  | 'PAYMENT_VERIFICATION_UNAVAILABLE'
  | 'PAYMENT_VERIFICATION_FAILED'
  | 'PAYMENT_MISMATCH'
  | 'PAYMENT_ALREADY_USED'
  | 'REFUND_VERIFICATION_UNAVAILABLE'
  | 'REFUND_VERIFICATION_FAILED'
  | 'REFUND_MISMATCH'
  | 'CALLBACK_ID_REUSED'
  | 'CALLBACK_VERIFICATION_FAILED'
  | 'CALLBACK_ORDER_MISMATCH'
  | 'CURRENCY_OVERFLOW';

export class CommerceError extends Error {
  readonly code: CommerceResultCode;

  constructor(code: CommerceResultCode, message = code) {
    super(message);
    this.name = 'CommerceError';
    this.code = code;
  }
}

export function cloneCommerce<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}

export function freezeCommerce<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) freezeCommerce(child);
  return value;
}
