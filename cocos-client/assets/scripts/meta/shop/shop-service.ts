import { CARD_SHOP_CONFIG } from './shop-config';
import {
    CARD_SHOP_SCHEMA_VERSION,
    canonicalJson,
    loadCardShopConfig,
    type CardShopConfig,
    type ShopProduct,
} from './shop-contract';

export type CardShopListing = {
    productId: string;
    remaining: number;
};

export type CardShopRefreshRequest = {
    requestId: string;
};

export type CardShopPurchaseRequest = {
    requestId: string;
    productId: string;
};

export type CardShopFailureReason =
    | 'INVALID_REQUEST'
    | 'REQUEST_ID_REUSED'
    | 'UNKNOWN_PRODUCT'
    | 'PRODUCT_NOT_AVAILABLE'
    | 'ALREADY_PURCHASED'
    | 'INSUFFICIENT_FUNDS'
    | 'INVENTORY_OVERFLOW'
    | 'REFRESH_OVERFLOW';

export type CardShopRefreshResult = {
    operation: 'refresh';
    requestId: string | null;
    status: 'success' | 'failure';
    success: boolean;
    refreshCount: number;
    listings: readonly CardShopListing[];
    reason: CardShopFailureReason | null;
};

export type CardShopPurchaseResult = {
    operation: 'purchase';
    requestId: string | null;
    status: 'success' | 'failure';
    success: boolean;
    productId: string | null;
    cardId: string | null;
    currencyId: string | null;
    price: number | null;
    remaining: number | null;
    reason: CardShopFailureReason | null;
};

export type CardShopResult = CardShopRefreshResult | CardShopPurchaseResult;

export type CardShopProcessedResult = {
    requestId: string;
    requestFingerprint: string;
    result: CardShopResult;
};

export type CardShopServiceSnapshot = {
    schemaVersion: 1;
    seed: number;
    refreshCount: number;
    listings: readonly CardShopListing[];
    balances: Readonly<Record<string, number>>;
    inventory: Readonly<Record<string, number>>;
    processedResults: readonly CardShopProcessedResult[];
};

export type CardShopServiceOptions = {
    config?: CardShopConfig;
    seed?: number;
    refreshCount?: number;
    listings?: readonly CardShopListing[];
    balances?: Readonly<Record<string, number>>;
    inventory?: Readonly<Record<string, number>>;
    processedResults?: readonly CardShopProcessedResult[];
};

const SNAPSHOT_KEYS = new Set(['schemaVersion', 'seed', 'refreshCount', 'listings', 'balances', 'inventory', 'processedResults']);
const LISTING_KEYS = new Set(['productId', 'remaining']);
const PROCESSED_KEYS = new Set(['requestId', 'requestFingerprint', 'result']);
const REFRESH_RESULT_KEYS = new Set(['operation', 'requestId', 'status', 'success', 'refreshCount', 'listings', 'reason']);
const PURCHASE_RESULT_KEYS = new Set(['operation', 'requestId', 'status', 'success', 'productId', 'cardId', 'currencyId', 'price', 'remaining', 'reason']);
const REFRESH_REQUEST_KEYS = new Set(['requestId']);
const PURCHASE_REQUEST_KEYS = new Set(['requestId', 'productId']);
const REQUEST_FINGERPRINT_KEYS = new Set(['operation', 'request']);
const REFRESH_FAILURE_REASONS = new Set<CardShopFailureReason>(['INVALID_REQUEST', 'REFRESH_OVERFLOW']);
const PURCHASE_FAILURE_REASONS = new Set<CardShopFailureReason>(['INVALID_REQUEST', 'UNKNOWN_PRODUCT', 'PRODUCT_NOT_AVAILABLE', 'ALREADY_PURCHASED', 'INSUFFICIENT_FUNDS', 'INVENTORY_OVERFLOW']);

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, any>, allowed: ReadonlySet<string>): boolean {
    return Object.keys(value).every((key) => allowed.has(key));
}

function isValidRequestId(value: unknown): value is string {
    return isId(value);
}

function isId(value: unknown): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.length <= 96
        && !['__proto__', 'constructor', 'prototype'].includes(value);
}

function isSafeInteger(value: unknown, min = 0): value is number {
    return Number.isSafeInteger(value) && Number(value) >= min;
}

function cloneListing(listing: CardShopListing): CardShopListing {
    return { productId: listing.productId, remaining: listing.remaining };
}

function cloneListings(listings: readonly CardShopListing[]): CardShopListing[] {
    return [...listings].sort((a, b) => a.productId.localeCompare(b.productId)).map(cloneListing);
}

function cloneBalances(values: Readonly<Record<string, number>>): Record<string, number> {
    return Object.keys(values).sort().reduce((result, key) => {
        result[key] = values[key];
        return result;
    }, {} as Record<string, number>);
}

function cloneResult(result: CardShopResult): CardShopResult {
    return result.operation === 'refresh'
        ? { ...result, listings: cloneListings(result.listings) }
        : { ...result };
}

function cloneProcessedResult(item: CardShopProcessedResult): CardShopProcessedResult {
    return { requestId: item.requestId, requestFingerprint: item.requestFingerprint, result: cloneResult(item.result) };
}

function invalidRequestFingerprint(operation: CardShopResult['operation'], request: Record<string, any>): string {
    try {
        const payload = Object.fromEntries(Object.entries(request).filter(([key]) => key !== 'requestId'));
        return canonicalJson({ operation, request: payload });
    } catch {
        const keys = Object.keys(request).filter((key) => key !== 'requestId').sort();
        return canonicalJson({ operation, request: { unserializable: true, keys } });
    }
}

function validateInvalidRequestFingerprint(value: string, operation: CardShopResult['operation']): boolean {
    try {
        const parsed: any = JSON.parse(value);
        return isRecord(parsed)
            && hasExactKeys(parsed, REQUEST_FINGERPRINT_KEYS)
            && parsed.operation === operation
            && isRecord(parsed.request)
            && !Object.prototype.hasOwnProperty.call(parsed.request, 'requestId')
            && canonicalJson(parsed) === value;
    } catch {
        return false;
    }
}

function productMap(config: CardShopConfig): Map<string, ShopProduct> {
    return new Map(config.products.map((product) => [product.id, product]));
}

function validateMap(raw: unknown, ids: ReadonlySet<string>, label: string): Record<string, number> {
    if (!isRecord(raw)) throw new Error(`card shop ${label} must be an object`);
    const result: Record<string, number> = {};
    for (const [id, quantity] of Object.entries(raw)) {
        if (!ids.has(id)) throw new Error(`unknown card shop ${label} key: ${id}`);
        if (!isSafeInteger(quantity)) throw new Error(`card shop ${label}.${id} must be a safe integer >= 0`);
        result[id] = quantity;
    }
    return result;
}

function validateListings(raw: unknown, config: CardShopConfig): CardShopListing[] {
    if (!Array.isArray(raw)) throw new Error('card shop snapshot listings must be an array');
    const products = productMap(config);
    const seen = new Set<string>();
    const listings = raw.map((value: unknown) => {
        if (!isRecord(value) || !hasExactKeys(value, LISTING_KEYS)) throw new Error('card shop listing has unexpected keys or is not an object');
        if (!isId(value.productId) || !products.has(value.productId)) throw new Error(`unknown card shop listing product: ${value.productId}`);
        if (seen.has(value.productId)) throw new Error(`duplicate card shop listing: ${value.productId}`);
        seen.add(value.productId);
        const product = products.get(value.productId) as ShopProduct;
        if (!isSafeInteger(value.remaining) || value.remaining > product.stock) throw new Error(`invalid remaining stock for ${value.productId}`);
        return { productId: value.productId, remaining: value.remaining };
    });
    if (listings.length > config.slotCount) throw new Error('card shop listings exceed configured slotCount');
    return cloneListings(listings);
}

function validateResult(raw: unknown, config: CardShopConfig): CardShopResult {
    if (!isRecord(raw) || typeof raw.operation !== 'string') throw new Error('card shop processed result must be an object');
    const products = productMap(config);
    if (raw.operation === 'refresh') {
        if (!hasExactKeys(raw, REFRESH_RESULT_KEYS)) throw new Error('card shop refresh result has unexpected keys');
        if (!isId(raw.requestId) || !isSafeInteger(raw.refreshCount, 0) || !Array.isArray(raw.listings)) throw new Error('invalid processed card shop refresh result');
        const listings = validateListings(raw.listings, config);
        if (raw.status === 'success' && raw.success === true && raw.reason === null) {
            return { operation: 'refresh', requestId: raw.requestId, status: 'success', success: true, refreshCount: raw.refreshCount, listings, reason: null };
        }
        if (raw.status === 'failure' && raw.success === false && typeof raw.reason === 'string' && REFRESH_FAILURE_REASONS.has(raw.reason as CardShopFailureReason)) {
            return { operation: 'refresh', requestId: raw.requestId, status: 'failure', success: false, refreshCount: raw.refreshCount, listings, reason: raw.reason as CardShopFailureReason };
        }
        throw new Error('invalid processed card shop refresh result payload');
    }
    if (raw.operation === 'purchase') {
        if (!hasExactKeys(raw, PURCHASE_RESULT_KEYS)) throw new Error('card shop purchase result has unexpected keys');
        if (!isId(raw.requestId)) throw new Error('invalid processed card shop purchase result');
        if (raw.status === 'success' && raw.success === true && isId(raw.productId)) {
            const product = products.get(raw.productId);
            if (!product || raw.cardId !== product.cardId || raw.currencyId !== product.currencyId || raw.price !== product.price || !isSafeInteger(raw.remaining) || raw.remaining >= product.stock || raw.reason !== null) {
                throw new Error('invalid processed card shop purchase result payload');
            }
            return { operation: 'purchase', requestId: raw.requestId, status: 'success', success: true, productId: product.id, cardId: product.cardId, currencyId: product.currencyId, price: product.price, remaining: raw.remaining, reason: null };
        }
        if (raw.status !== 'failure' || raw.success !== false || typeof raw.reason !== 'string' || !PURCHASE_FAILURE_REASONS.has(raw.reason as CardShopFailureReason) || (raw.productId !== null && !isId(raw.productId)) || raw.cardId !== null || raw.currencyId !== null || raw.price !== null || raw.remaining !== null) {
            throw new Error('invalid processed card shop purchase result payload');
        }
        if (raw.reason === 'UNKNOWN_PRODUCT' && (!isId(raw.productId) || products.has(raw.productId))) throw new Error('invalid processed card shop purchase result payload');
        if (raw.reason !== 'UNKNOWN_PRODUCT' && raw.reason !== 'INVALID_REQUEST' && (!isId(raw.productId) || !products.has(raw.productId))) throw new Error('invalid processed card shop purchase result payload');
        return { operation: 'purchase', requestId: raw.requestId, status: 'failure', success: false, productId: raw.productId, cardId: null, currencyId: null, price: null, remaining: null, reason: raw.reason as CardShopFailureReason };
    }
    throw new Error('invalid processed card shop result operation');
}

function validateProcessedResults(raw: unknown, config: CardShopConfig): CardShopProcessedResult[] {
    if (!Array.isArray(raw)) throw new Error('card shop snapshot processedResults must be an array');
    const seen = new Set<string>();
    return raw.map((value: unknown) => {
        if (!isRecord(value) || !hasExactKeys(value, PROCESSED_KEYS)) throw new Error('card shop processed result has unexpected keys');
        if (!isId(value.requestId) || typeof value.requestFingerprint !== 'string' || value.requestFingerprint.length === 0) throw new Error('invalid card shop processed request');
        if (seen.has(value.requestId)) throw new Error(`duplicate card shop requestId: ${value.requestId}`);
        seen.add(value.requestId);
        const result = validateResult(value.result, config);
        if (result.requestId !== value.requestId) throw new Error(`card shop requestId mismatch: ${value.requestId}`);
        const expectedFingerprint = result.operation === 'refresh'
            ? cardShopRefreshFingerprint()
            : cardShopPurchaseFingerprint({ productId: result.productId as string });
        const validFingerprint = result.reason === 'INVALID_REQUEST'
            ? validateInvalidRequestFingerprint(value.requestFingerprint, result.operation)
            : value.requestFingerprint === expectedFingerprint;
        if (!validFingerprint) throw new Error(`card shop request fingerprint mismatch: ${value.requestId}`);
        return { requestId: value.requestId, requestFingerprint: value.requestFingerprint, result };
    });
}

function validateSnapshot(snapshot: unknown, config: CardShopConfig): CardShopServiceSnapshot {
    if (!isRecord(snapshot) || !hasExactKeys(snapshot, SNAPSHOT_KEYS)) throw new Error('card shop snapshot has unexpected keys or is not an object');
    if (snapshot.schemaVersion !== CARD_SHOP_SCHEMA_VERSION) throw new Error('card shop snapshot schemaVersion is unsupported');
    if (!isSafeInteger(snapshot.seed) || !isSafeInteger(snapshot.refreshCount)) throw new Error('card shop snapshot seed and refreshCount must be safe integers >= 0');
    const cards = new Set(config.cards.map((card) => card.id));
    const currencies = new Set(config.currencies.map((currency) => currency.id));
    const balances = validateMap(snapshot.balances, currencies, 'balances');
    const inventory = validateMap(snapshot.inventory, cards, 'inventory');
    return {
        schemaVersion: CARD_SHOP_SCHEMA_VERSION,
        seed: snapshot.seed,
        refreshCount: snapshot.refreshCount,
        listings: validateListings(snapshot.listings, config),
        balances: cloneBalances(Object.fromEntries(config.currencies.map((currency) => [currency.id, balances[currency.id] ?? 0]))),
        inventory: cloneBalances(Object.fromEntries(config.cards.map((card) => [card.id, inventory[card.id] ?? 0]))),
        processedResults: validateProcessedResults(snapshot.processedResults, config),
    };
}

export function serializeCardShopSnapshot(snapshot: CardShopServiceSnapshot): string {
    return canonicalJson(snapshot);
}

export function cardShopRefreshFingerprint(): string {
    return canonicalJson({ operation: 'refresh' });
}

export function cardShopPurchaseFingerprint(request: Pick<CardShopPurchaseRequest, 'productId'>): string {
    return canonicalJson({ operation: 'purchase', productId: request.productId });
}

function stableHash(value: string): number {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0;
}

function refreshFailure(requestId: string | null, reason: CardShopFailureReason, refreshCount: number, listings: readonly CardShopListing[]): CardShopRefreshResult {
    return { operation: 'refresh', requestId, status: 'failure', success: false, refreshCount, listings: cloneListings(listings), reason };
}

function purchaseFailure(requestId: string | null, reason: CardShopFailureReason, productId: string | null): CardShopPurchaseResult {
    return { operation: 'purchase', requestId, status: 'failure', success: false, productId, cardId: null, currencyId: null, price: null, remaining: null, reason };
}

export class CardShopService {
    private readonly config: CardShopConfig;
    private readonly seed: number;
    private refreshCount: number;
    private readonly listings = new Map<string, number>();
    private readonly balances = new Map<string, number>();
    private readonly inventory = new Map<string, number>();
    private readonly processedResults = new Map<string, CardShopProcessedResult>();

    public constructor(options: CardShopServiceOptions = {}) {
        this.config = loadCardShopConfig(options.config ?? CARD_SHOP_CONFIG);
        const initial = validateSnapshot({
            schemaVersion: CARD_SHOP_SCHEMA_VERSION,
            seed: options.seed ?? 0,
            refreshCount: options.refreshCount ?? 0,
            listings: options.listings ?? [],
            balances: options.balances ?? {},
            inventory: options.inventory ?? {},
            processedResults: options.processedResults ?? [],
        }, this.config);
        this.seed = initial.seed;
        this.refreshCount = initial.refreshCount;
        for (const listing of initial.listings) this.listings.set(listing.productId, listing.remaining);
        for (const [currencyId, balance] of Object.entries(initial.balances)) this.balances.set(currencyId, balance);
        for (const [cardId, quantity] of Object.entries(initial.inventory)) this.inventory.set(cardId, quantity);
        for (const processed of initial.processedResults) this.processedResults.set(processed.requestId, processed);
    }

    public static fromSnapshot(snapshot: CardShopServiceSnapshot, config: CardShopConfig = CARD_SHOP_CONFIG): CardShopService {
        const checkedConfig = loadCardShopConfig(config);
        const checked = validateSnapshot(snapshot, checkedConfig);
        return new CardShopService({ config: checkedConfig, seed: checked.seed, refreshCount: checked.refreshCount, listings: checked.listings, balances: checked.balances, inventory: checked.inventory, processedResults: checked.processedResults });
    }

    public getConfig(): CardShopConfig { return this.config; }

    public getListings(): readonly CardShopListing[] {
        return cloneListings([...this.listings].map(([productId, remaining]) => ({ productId, remaining })));
    }

    public getBalance(currencyId: string): number { return this.balances.get(currencyId) ?? 0; }

    public getBalances(): Readonly<Record<string, number>> { return cloneBalances(Object.fromEntries(this.balances)); }

    public getCardInventory(cardId: string): number { return this.inventory.get(cardId) ?? 0; }

    public getInventory(): Readonly<Record<string, number>> { return cloneBalances(Object.fromEntries(this.inventory)); }

    public snapshot(): CardShopServiceSnapshot {
        return {
            schemaVersion: CARD_SHOP_SCHEMA_VERSION,
            seed: this.seed,
            refreshCount: this.refreshCount,
            listings: this.getListings(),
            balances: this.getBalances(),
            inventory: this.getInventory(),
            processedResults: [...this.processedResults.values()].sort((a, b) => a.requestId.localeCompare(b.requestId)).map(cloneProcessedResult),
        };
    }

    public serialize(): string { return serializeCardShopSnapshot(this.snapshot()); }

    private rememberResult<T extends CardShopResult>(requestId: string, requestFingerprint: string, result: T): T {
        this.processedResults.set(requestId, { requestId, requestFingerprint, result: cloneResult(result) });
        return cloneResult(result) as T;
    }

    public refresh(request: CardShopRefreshRequest): CardShopRefreshResult {
        const requestId = isRecord(request) && isValidRequestId(request.requestId) ? request.requestId : null;
        if (requestId === null) return refreshFailure(null, 'INVALID_REQUEST', this.refreshCount, this.getListings());
        const validRequest = isRecord(request) && hasExactKeys(request, REFRESH_REQUEST_KEYS);
        const fingerprint = validRequest ? cardShopRefreshFingerprint() : invalidRequestFingerprint('refresh', request);
        const existing = this.processedResults.get(requestId);
        if (existing) {
            if (existing.requestFingerprint !== fingerprint) return refreshFailure(requestId, 'REQUEST_ID_REUSED', this.refreshCount, this.getListings());
            return cloneResult(existing.result) as CardShopRefreshResult;
        }
        if (!validRequest) return this.rememberResult(requestId, fingerprint, refreshFailure(requestId, 'INVALID_REQUEST', this.refreshCount, this.getListings()));
        if (this.refreshCount >= Number.MAX_SAFE_INTEGER) return this.rememberResult(requestId, fingerprint, refreshFailure(requestId, 'REFRESH_OVERFLOW', this.refreshCount, this.getListings()));

        const products = [...this.config.products].sort((a, b) => {
            const left = stableHash(`${this.seed}|${this.refreshCount}|${a.id}`);
            const right = stableHash(`${this.seed}|${this.refreshCount}|${b.id}`);
            return left - right || a.id.localeCompare(b.id);
        });
        const selected = products.slice(0, this.config.slotCount).map((product) => ({ productId: product.id, remaining: product.stock }));
        this.refreshCount += 1;
        this.listings.clear();
        for (const listing of selected) this.listings.set(listing.productId, listing.remaining);
        const result: CardShopRefreshResult = { operation: 'refresh', requestId, status: 'success', success: true, refreshCount: this.refreshCount, listings: cloneListings(selected), reason: null };
        return this.rememberResult(requestId, fingerprint, result);
    }

    public refreshShop(request: CardShopRefreshRequest): CardShopRefreshResult { return this.refresh(request); }

    public purchase(request: CardShopPurchaseRequest): CardShopPurchaseResult {
        const requestId = isRecord(request) && isValidRequestId(request.requestId) ? request.requestId : null;
        const productId = isRecord(request) && isId(request.productId) ? request.productId : null;
        if (requestId === null) return purchaseFailure(null, 'INVALID_REQUEST', productId);
        const validRequest = isRecord(request) && hasExactKeys(request, PURCHASE_REQUEST_KEYS) && productId !== null;
        const fingerprint = validRequest
            ? cardShopPurchaseFingerprint({ productId: productId as string })
            : invalidRequestFingerprint('purchase', request);
        const existing = this.processedResults.get(requestId);
        if (existing) {
            if (existing.requestFingerprint !== fingerprint) return purchaseFailure(requestId, 'REQUEST_ID_REUSED', productId);
            return cloneResult(existing.result) as CardShopPurchaseResult;
        }
        if (!validRequest) return this.rememberResult(requestId, fingerprint, purchaseFailure(requestId, 'INVALID_REQUEST', productId));
        const product = this.config.products.find((candidate) => candidate.id === productId);
        if (!product) return this.rememberResult(requestId, fingerprint, purchaseFailure(requestId, 'UNKNOWN_PRODUCT', productId));
        const remaining = this.listings.get(product.id);
        if (remaining === undefined) return this.rememberResult(requestId, fingerprint, purchaseFailure(requestId, 'PRODUCT_NOT_AVAILABLE', product.id));
        if (remaining === 0) return this.rememberResult(requestId, fingerprint, purchaseFailure(requestId, 'ALREADY_PURCHASED', product.id));
        const balance = this.balances.get(product.currencyId) ?? 0;
        if (balance < product.price) return this.rememberResult(requestId, fingerprint, purchaseFailure(requestId, 'INSUFFICIENT_FUNDS', product.id));
        const cardQuantity = this.inventory.get(product.cardId) ?? 0;
        if (cardQuantity >= Number.MAX_SAFE_INTEGER) return this.rememberResult(requestId, fingerprint, purchaseFailure(requestId, 'INVENTORY_OVERFLOW', product.id));

        const nextRemaining = remaining - 1;
        const result: CardShopPurchaseResult = {
            operation: 'purchase', requestId, status: 'success', success: true, productId: product.id,
            cardId: product.cardId, currencyId: product.currencyId, price: product.price, remaining: nextRemaining, reason: null,
        };
        this.balances.set(product.currencyId, balance - product.price);
        this.inventory.set(product.cardId, cardQuantity + 1);
        this.listings.set(product.id, nextRemaining);
        return this.rememberResult(requestId, fingerprint, result);
    }

    public buy(request: CardShopPurchaseRequest): CardShopPurchaseResult { return this.purchase(request); }
}

export function restoreCardShopService(snapshot: CardShopServiceSnapshot, config: CardShopConfig = CARD_SHOP_CONFIG): CardShopService {
    return CardShopService.fromSnapshot(snapshot, config);
}

export function productById(config: CardShopConfig, productId: string): ShopProduct | undefined {
    return config.products.find((product) => product.id === productId);
}
