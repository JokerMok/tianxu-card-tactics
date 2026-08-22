export const CARD_SHOP_SCHEMA_VERSION = 1;

export type ShopCurrency = {
    id: string;
};

export type ShopCard = {
    id: string;
    rarity: number;
};

export type ShopProduct = {
    id: string;
    cardId: string;
    currencyId: string;
    price: number;
    stock: number;
};

export type CardShopConfig = {
    schemaVersion: 1;
    slotCount: number;
    currencies: readonly ShopCurrency[];
    cards: readonly ShopCard[];
    products: readonly ShopProduct[];
};

const CONFIG_KEYS = new Set(['schemaVersion', 'slotCount', 'currencies', 'cards', 'products']);
const CURRENCY_KEYS = new Set(['id']);
const CARD_KEYS = new Set(['id', 'rarity']);
const PRODUCT_KEYS = new Set(['id', 'cardId', 'currencyId', 'price', 'stock']);

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unknownKeys(value: Record<string, any>, allowed: ReadonlySet<string>, path: string): string[] {
    return Object.keys(value).filter((key) => !allowed.has(key)).map((key) => `${path}.${key} is not allowed`);
}

function isId(value: unknown): value is string {
    return typeof value === 'string'
        && value.trim().length > 0
        && value.length <= 96
        && !['__proto__', 'constructor', 'prototype'].includes(value);
}

function validateSafeInteger(value: unknown, path: string, min: number): string[] {
    return Number.isSafeInteger(value) && Number(value) >= min
        ? []
        : [`${path} must be a safe integer >= ${min}`];
}

function duplicateIds(values: readonly { id?: unknown }[], label: string): string[] {
    const seen = new Set<string>();
    const errors: string[] = [];
    for (const value of values) {
        if (!isId(value?.id)) continue;
        if (seen.has(value.id)) errors.push(`duplicate ${label} id: ${value.id}`);
        seen.add(value.id);
    }
    return errors;
}

/** Validate the card shop tables and every product -> card/currency reference. */
export function validateCardShopConfig(raw: unknown): string[] {
    if (!isRecord(raw)) return ['card shop config must be an object'];
    const errors = unknownKeys(raw, CONFIG_KEYS, 'config');
    if (raw.schemaVersion !== CARD_SHOP_SCHEMA_VERSION) errors.push('config.schemaVersion is unsupported');
    errors.push(...validateSafeInteger(raw.slotCount, 'config.slotCount', 1));
    for (const key of ['currencies', 'cards', 'products']) {
        if (!Array.isArray(raw[key]) || raw[key].length === 0) errors.push(`config.${key} must be a non-empty array`);
    }
    if (!Array.isArray(raw.currencies) || !Array.isArray(raw.cards) || !Array.isArray(raw.products)) return [...new Set(errors)];
    if (Number.isSafeInteger(raw.slotCount) && raw.slotCount > raw.products.length) errors.push('config.slotCount must not exceed product count');

    const currencies = raw.currencies as any[];
    const cards = raw.cards as any[];
    const products = raw.products as any[];
    errors.push(...duplicateIds(currencies, 'currency'), ...duplicateIds(cards, 'card'), ...duplicateIds(products, 'product'));

    const currencyIds = new Set<string>();
    for (let index = 0; index < currencies.length; index += 1) {
        const currency = currencies[index];
        const path = `currencies[${index}]`;
        if (!isRecord(currency)) { errors.push(`${path} must be an object`); continue; }
        errors.push(...unknownKeys(currency, CURRENCY_KEYS, path));
        if (!isId(currency.id)) errors.push(`${path}.id is required`); else currencyIds.add(currency.id);
    }

    const cardIds = new Set<string>();
    for (let index = 0; index < cards.length; index += 1) {
        const card = cards[index];
        const path = `cards[${index}]`;
        if (!isRecord(card)) { errors.push(`${path} must be an object`); continue; }
        errors.push(...unknownKeys(card, CARD_KEYS, path));
        if (!isId(card.id)) errors.push(`${path}.id is required`); else cardIds.add(card.id);
        errors.push(...validateSafeInteger(card.rarity, `${path}.rarity`, 1));
    }

    for (let index = 0; index < products.length; index += 1) {
        const product = products[index];
        const path = `products[${index}]`;
        if (!isRecord(product)) { errors.push(`${path} must be an object`); continue; }
        errors.push(...unknownKeys(product, PRODUCT_KEYS, path));
        if (!isId(product.id)) errors.push(`${path}.id is required`);
        if (!isId(product.cardId)) errors.push(`${path}.cardId is required`);
        else if (!cardIds.has(product.cardId)) errors.push(`${product.id || path} references unknown card: ${product.cardId}`);
        if (!isId(product.currencyId)) errors.push(`${path}.currencyId is required`);
        else if (!currencyIds.has(product.currencyId)) errors.push(`${product.id || path} references unknown currency: ${product.currencyId}`);
        errors.push(...validateSafeInteger(product.price, `${path}.price`, 1));
        errors.push(...validateSafeInteger(product.stock, `${path}.stock`, 1));
    }
    return [...new Set(errors)];
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isRecord(value)) return value;
    return Object.keys(value).sort().reduce((result, key) => {
        Object.defineProperty(result, key, { value: canonicalize(value[key]), enumerable: true, writable: true, configurable: true });
        return result;
    }, Object.create(null) as Record<string, unknown>);
}

function deepFreeze<T>(value: T): T {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    return value;
}

export function normalizeCardShopConfig(raw: unknown): CardShopConfig {
    const errors = validateCardShopConfig(raw);
    if (errors.length > 0) throw new Error(`Invalid card shop config: ${errors.join('; ')}`);
    const config = raw as CardShopConfig;
    return deepFreeze({
        schemaVersion: CARD_SHOP_SCHEMA_VERSION,
        slotCount: config.slotCount,
        currencies: config.currencies.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
        cards: config.cards.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
        products: config.products.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
    });
}

export function loadCardShopConfig(raw: unknown): CardShopConfig {
    return normalizeCardShopConfig(raw);
}

export function parseCardShopConfig(payload: string): CardShopConfig {
    if (typeof payload !== 'string') throw new Error('Card shop config payload must be a string');
    try {
        return loadCardShopConfig(JSON.parse(payload));
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`Invalid card shop config JSON: ${error.message}`);
        throw error;
    }
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}

export function serializeCardShopConfig(config: CardShopConfig): string {
    return canonicalJson(normalizeCardShopConfig(config));
}
