import { CRAFTING_CONFIG } from '../../meta/equipment/crafting/crafting-config';
import { EquipmentCraftingService, type CraftingServiceSnapshot } from '../../meta/equipment/crafting/crafting-service';
import { EXPEDITION_CONFIG } from '../../meta/expedition/expedition-config';
import { ExpeditionService, type ExpeditionServiceSnapshot } from '../../meta/expedition/expedition-service';
import { CARD_SHOP_CONFIG } from '../../meta/shop/shop-config';
import { CardShopService, type CardShopServiceSnapshot } from '../../meta/shop/shop-service';
import { ECONOMY_CONFIG } from './economy-config';
import {
    ECONOMY_BASIS_POINTS,
    ECONOMY_SCHEMA_VERSION,
    canonicalJson,
    diffEconomySkeleton,
    loadEconomyConfig,
    type EconomyConfig,
    type EconomyCost,
} from './economy-contract';

export type EconomyLedger = {
    initial: Readonly<Record<string, number>>;
    produced: Readonly<Record<string, number>>;
    consumed: Readonly<Record<string, number>>;
};

export type EconomyState = {
    schemaVersion: 1;
    seed: number;
    day: number;
    balances: Readonly<Record<string, number>>;
    cards: Readonly<Record<string, number>>;
    buildings: Readonly<Record<string, number>>;
    reputationTierIds: readonly string[];
    taskCounts: Readonly<Record<string, number>>;
    completedTaskIds: readonly string[];
    priceIndex: Readonly<Record<string, number>>;
    ledger: EconomyLedger;
    bankrupt: boolean;
    lastEvents: readonly string[];
    processedCommands: readonly EconomyProcessedCommand[];
    equipmentSnapshot: CraftingServiceSnapshot;
    expeditionSnapshot: ExpeditionServiceSnapshot;
    shopSnapshot: CardShopServiceSnapshot;
};

export type EconomyCommand =
    | { requestId: string; type: 'advance-day'; day: number }
    | { requestId: string; type: 'shop-purchase'; productId: string };

export type EconomyProcessedCommand = {
    requestId: string;
    fingerprint: string;
    result: EconomyCommandResult;
};

export type EconomyCommandResult = {
    status: 'success' | 'failure';
    requestId: string | null;
    type: EconomyCommand['type'] | null;
    day: number;
    events: readonly string[];
    reason: string | null;
};

export type EconomyServiceOptions = {
    config?: EconomyConfig;
    seed?: number;
    snapshot?: EconomyState;
};

const COMMAND_TYPES = new Set<EconomyCommand['type']>(['advance-day', 'shop-purchase']);

function clone<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
    return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function validRequestId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 96
        && value === value.trim() && !['__proto__', 'constructor', 'prototype'].includes(value);
}

function emptyMap(ids: readonly string[], value = 0): Record<string, number> {
    return Object.fromEntries(ids.map((id) => [id, value]));
}

function sortedMap(value: Readonly<Record<string, number>>): Record<string, number> {
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = value[key];
        return result;
    }, {} as Record<string, number>);
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
    const a = [...left].sort();
    const b = [...right].sort();
    return a.length === b.length && a.every((id, index) => id === b[index]);
}

function assertExactKeys(value: Record<string, any>, expected: readonly string[], label: string): void {
    const actual = Object.keys(value);
    if (actual.length !== expected.length || actual.some((key) => !expected.includes(key))) {
        throw new Error(`${label} keys are invalid`);
    }
}

function assertSafeIntegerMap(raw: unknown, ids: readonly string[], label: string): Record<string, number> {
    return validateResourceMap(raw, ids, label);
}

function addSafe(current: number, delta: number): number {
    if (!isSafeInteger(current) || !isSafeInteger(delta) || current > Number.MAX_SAFE_INTEGER - delta) throw new Error('economy resource overflow');
    return current + delta;
}

function multiplySafe(left: number, right: number): number {
    if (!isSafeInteger(left) || !isSafeInteger(right) || left > Math.floor(Number.MAX_SAFE_INTEGER / Math.max(1, right))) throw new Error('economy resource overflow');
    return left * right;
}

function commandFingerprint(command: EconomyCommand): string {
    return command.type === 'advance-day'
        ? canonicalJson({ type: command.type, day: command.day })
        : canonicalJson({ type: command.type, productId: command.productId });
}

function stableHash(value: string): number {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0;
}

function derivedServiceSeed(seed: number, service: 'crafting' | 'shop'): number {
    return stableHash(`economy:${service}:${seed}`);
}

function initialExpeditionNumber(seed: number): number {
    return (seed % 10) + 1;
}

function expectedPriceIndex(config: EconomyConfig, day: number): Record<string, number> {
    return Object.fromEntries(config.shopProducts.map((product) => {
        const price = BigInt(product.basePrice)
            + (BigInt(product.basePrice) * BigInt(product.inflationBps) * BigInt(day)) / BigInt(ECONOMY_BASIS_POINTS);
        if (price > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`economy price overflow: ${product.id}`);
        return [product.id, Number(price)];
    }));
}

function isBankruptBoundary(day: number, balances: Readonly<Record<string, number>>, config: EconomyConfig): boolean {
    return day > 0 && balances.credits < config.mandatoryCreditCost;
}

function currentConfigResourceIds(config: EconomyConfig): string[] {
    return config.resources.map((resource) => resource.id).sort();
}

function assertIntegrationContracts(config: EconomyConfig): void {
    if (!sameIds(config.integrationRefs.equipmentRecipeIds, CRAFTING_CONFIG.recipes.map((recipe) => recipe.id))) throw new Error('equipment recipe cross-table mismatch');
    if (!sameIds(config.integrationRefs.equipmentEnhancementIds, ['enhance-common', 'enhance-rare', 'enhance-epic'])) throw new Error('equipment enhancement cross-table mismatch');
    if (!sameIds(config.integrationRefs.expeditionIds, EXPEDITION_CONFIG.destinations.map((destination) => destination.id))) throw new Error('expedition cross-table mismatch');
    if (!sameIds(config.integrationRefs.shopProductIds, CARD_SHOP_CONFIG.products.map((product) => product.id))) throw new Error('shop product cross-table mismatch');
    for (const product of config.shopProducts) {
        const external = CARD_SHOP_CONFIG.products.find((candidate) => candidate.id === product.externalProductId);
        const expectedCurrency = external?.currencyId === 'crystals' ? 'crystal' : 'coins';
        if (!external || external.price !== product.basePrice || product.currencyId !== expectedCurrency) throw new Error(`shop price cross-table mismatch: ${product.id}`);
    }
}

function validateResourceMap(raw: unknown, ids: readonly string[], label: string): Record<string, number> {
    if (!isRecord(raw)) throw new Error(`${label} must be an object`);
    const expected = new Set(ids);
    const keys = Object.keys(raw);
    if (keys.length !== ids.length || keys.some((key) => !expected.has(key))) throw new Error(`${label} keys are invalid`);
    for (const id of ids) if (!isSafeInteger(raw[id])) throw new Error(`${label}.${id} must be a non-negative safe integer`);
    return sortedMap(raw);
}

function validateLedger(raw: unknown, ids: readonly string[]): EconomyLedger {
    if (!isRecord(raw)) throw new Error('economy ledger must be an object');
    assertExactKeys(raw, ['initial', 'produced', 'consumed'], 'economy ledger');
    const initial = validateResourceMap(raw.initial, ids, 'ledger.initial');
    const produced = validateResourceMap(raw.produced, ids, 'ledger.produced');
    const consumed = validateResourceMap(raw.consumed, ids, 'ledger.consumed');
    return { initial, produced, consumed };
}

function assertLedgerInitial(ledger: EconomyLedger, config: EconomyConfig): void {
    for (const resource of config.resources) {
        if (ledger.initial[resource.id] !== resource.initial) {
            throw new Error(`ledger.initial does not match config: ${resource.id}`);
        }
    }
}

function validateCraftingSnapshot(raw: unknown): void {
    if (!isRecord(raw)) throw new Error('crafting snapshot must be an object');
    assertExactKeys(raw, ['schemaVersion', 'seed', 'attempt', 'equipment', 'materials', 'processedResults'], 'crafting snapshot');
    if (raw.schemaVersion !== 1 || !isSafeInteger(raw.seed) || !isSafeInteger(raw.attempt)) throw new Error('crafting snapshot clock is invalid');
    if (!Array.isArray(raw.equipment)) throw new Error('crafting snapshot equipment must be an array');
    const equipmentIds = new Set(CRAFTING_CONFIG.equipment.map((item) => item.id));
    const instanceIds = new Set<string>();
    for (const [index, item] of raw.equipment.entries()) {
        if (!isRecord(item)) throw new Error(`crafting equipment[${index}] must be an object`);
        assertExactKeys(item, ['instanceId', 'equipmentId', 'locked'], `crafting equipment[${index}]`);
        if (!validRequestId(item.instanceId) || instanceIds.has(item.instanceId) || !equipmentIds.has(item.equipmentId) || typeof item.locked !== 'boolean') {
            throw new Error(`crafting equipment[${index}] is invalid`);
        }
        instanceIds.add(item.instanceId);
    }
    assertSafeIntegerMap(raw.materials, CRAFTING_CONFIG.materials.map((item) => item.id), 'crafting materials');
    if (!Array.isArray(raw.processedResults)) throw new Error('crafting snapshot processedResults must be an array');
}

function validateExpeditionSnapshot(raw: unknown): void {
    if (!isRecord(raw)) throw new Error('expedition snapshot must be an object');
    assertExactKeys(raw, ['schemaVersion', 'nextExpeditionNumber', 'resources', 'expedition', 'claimedExpeditionIds'], 'expedition snapshot');
    if (raw.schemaVersion !== 1 || !isSafeInteger(raw.nextExpeditionNumber, 1)) throw new Error('expedition snapshot clock is invalid');
    if (!isRecord(raw.resources)) throw new Error('expedition resources must be an object');
    assertExactKeys(raw.resources, ['stamina', 'experience', 'silver', 'crystal', 'materials'], 'expedition resources');
    for (const key of ['stamina', 'experience', 'silver', 'crystal']) if (!isSafeInteger(raw.resources[key])) throw new Error(`expedition resources.${key} is invalid`);
    assertSafeIntegerMap(raw.resources.materials, EXPEDITION_CONFIG.materials.map((item) => item.id), 'expedition materials');
    if (!Array.isArray(raw.claimedExpeditionIds) || raw.claimedExpeditionIds.some((id) => typeof id !== 'string') || new Set(raw.claimedExpeditionIds).size !== raw.claimedExpeditionIds.length) {
        throw new Error('expedition claimed IDs are invalid');
    }
    if (raw.expedition !== null) {
        if (!isRecord(raw.expedition)) throw new Error('expedition record must be an object or null');
        assertExactKeys(raw.expedition, ['id', 'destinationId', 'rewardId', 'unitIds', 'dispatchedAt', 'endsAt', 'status'], 'expedition record');
        if (!validRequestId(raw.expedition.id) || !validRequestId(raw.expedition.destinationId) || !validRequestId(raw.expedition.rewardId)
            || !Array.isArray(raw.expedition.unitIds) || raw.expedition.unitIds.some((id) => !validRequestId(id))
            || !isSafeInteger(raw.expedition.dispatchedAt) || !isSafeInteger(raw.expedition.endsAt, 1)
            || (raw.expedition.status !== 'active' && raw.expedition.status !== 'ready')) throw new Error('expedition record is invalid');
    }
}

function validateShopSnapshot(raw: unknown): void {
    if (!isRecord(raw)) throw new Error('shop snapshot must be an object');
    assertExactKeys(raw, ['schemaVersion', 'seed', 'refreshCount', 'listings', 'balances', 'inventory', 'processedResults'], 'shop snapshot');
    if (raw.schemaVersion !== 1 || !isSafeInteger(raw.seed) || !isSafeInteger(raw.refreshCount)) throw new Error('shop snapshot clock is invalid');
    const productIds = CARD_SHOP_CONFIG.products.map((product) => product.id);
    if (!Array.isArray(raw.listings)) throw new Error('shop listings must be an array');
    const listingIds = new Set<string>();
    for (const [index, listing] of raw.listings.entries()) {
        if (!isRecord(listing)) throw new Error(`shop listing[${index}] must be an object`);
        assertExactKeys(listing, ['productId', 'remaining'], `shop listing[${index}]`);
        if (!productIds.includes(listing.productId) || listingIds.has(listing.productId) || !isSafeInteger(listing.remaining)) throw new Error(`shop listing[${index}] is invalid`);
        listingIds.add(listing.productId);
    }
    assertSafeIntegerMap(raw.balances, CARD_SHOP_CONFIG.currencies.map((currency) => currency.id), 'shop balances');
    assertSafeIntegerMap(raw.inventory, CARD_SHOP_CONFIG.cards.map((card) => card.id), 'shop inventory');
    if (!Array.isArray(raw.processedResults)) throw new Error('shop processed results must be an array');
    const requestIds = new Set<string>();
    for (const [index, item] of raw.processedResults.entries()) {
        if (!isRecord(item)) throw new Error(`shop processed result[${index}] must be an object`);
        assertExactKeys(item, ['requestId', 'requestFingerprint', 'result'], `shop processed result[${index}]`);
        if (!validRequestId(item.requestId) || typeof item.requestFingerprint !== 'string' || item.requestFingerprint.length === 0 || requestIds.has(item.requestId) || !isRecord(item.result)) throw new Error(`shop processed result[${index}] is invalid`);
        requestIds.add(item.requestId);
        const resultKeys = item.result.operation === 'refresh'
            ? ['operation', 'requestId', 'status', 'success', 'refreshCount', 'listings', 'reason']
            : item.result.operation === 'purchase'
                ? ['operation', 'requestId', 'status', 'success', 'productId', 'cardId', 'currencyId', 'price', 'remaining', 'reason']
                : null;
        if (resultKeys === null) throw new Error(`shop processed result[${index}] operation is invalid`);
        assertExactKeys(item.result, resultKeys, `shop processed result[${index}].result`);
        if (item.result.requestId !== item.requestId || (item.result.operation === 'refresh' && (!isSafeInteger(item.result.refreshCount) || !Array.isArray(item.result.listings)))
            || (item.result.operation === 'purchase' && item.result.price !== null && !isSafeInteger(item.result.price))) throw new Error(`shop processed result[${index}] payload is invalid`);
    }
}

function parseCommand(raw: unknown): EconomyCommand | null {
    if (!isRecord(raw) || !validRequestId(raw.requestId)) return null;
    if (raw.type === 'advance-day') {
        if (Object.keys(raw).length !== 3 || !Object.keys(raw).every((key) => ['requestId', 'type', 'day'].includes(key)) || !isSafeInteger(raw.day, 1)) return null;
        return { requestId: raw.requestId, type: 'advance-day', day: raw.day };
    }
    if (raw.type === 'shop-purchase') {
        if (Object.keys(raw).length !== 3 || !Object.keys(raw).every((key) => ['requestId', 'type', 'productId'].includes(key)) || !validRequestId(raw.productId)) return null;
        return { requestId: raw.requestId, type: 'shop-purchase', productId: raw.productId };
    }
    return null;
}

function invalidCommandResult(raw: unknown, day: number): EconomyCommandResult {
    const record = isRecord(raw) ? raw : null;
    const requestId = record && validRequestId(record.requestId) ? record.requestId : null;
    const type = record && (record.type === 'advance-day' || record.type === 'shop-purchase') ? record.type : null;
    return { status: 'failure', requestId, type, day, events: [], reason: 'INVALID_COMMAND' };
}

function initialEquipment(seed: number): CraftingServiceSnapshot {
    const service = new EquipmentCraftingService({
        config: CRAFTING_CONFIG,
        seed: derivedServiceSeed(seed, 'crafting'),
        inventory: [
            { instanceId: 'starter:blade:1', equipmentId: 'scrap_blade', locked: false },
            { instanceId: 'starter:blade:2', equipmentId: 'scrap_blade', locked: false },
            { instanceId: 'starter:armor:1', equipmentId: 'scrap_armor', locked: false },
            { instanceId: 'starter:armor:2', equipmentId: 'scrap_armor', locked: false },
            { instanceId: 'starter:scope:1', equipmentId: 'scrap_scope', locked: false },
            { instanceId: 'starter:core:1', equipmentId: 'scrap_core', locked: false },
        ],
        materials: { alloy: 3, circuit: 1, core: 1 },
    });
    return service.snapshot();
}

function initialExpedition(seed: number, balances: Readonly<Record<string, number>>): ExpeditionServiceSnapshot {
    return new ExpeditionService({
        config: EXPEDITION_CONFIG,
        resources: {
            stamina: balances.stamina,
            experience: balances.experience,
            silver: balances.silver,
            crystal: balances.crystal,
            materials: {
                alloy: balances.alloy,
                crystal_shard: balances.crystal_shard,
                field_ration: balances.field_ration,
            },
        },
        nextExpeditionNumber: initialExpeditionNumber(seed),
    }).snapshot();
}

function initialShop(seed: number, balances: Readonly<Record<string, number>>, cards: Readonly<Record<string, number>>): CardShopServiceSnapshot {
    return new CardShopService({
        config: CARD_SHOP_CONFIG,
        seed: derivedServiceSeed(seed, 'shop'),
        balances: { coins: balances.coins, crystals: balances.crystal },
        inventory: cards,
    }).snapshot();
}

function makeInitialState(config: EconomyConfig, seed: number): EconomyState {
    const resourceIds = currentConfigResourceIds(config);
    const balances = emptyMap(resourceIds);
    for (const resource of config.resources) balances[resource.id] = resource.initial;
    const cards = emptyMap(CARD_SHOP_CONFIG.cards.map((card) => card.id));
    const buildings = Object.fromEntries(config.buildings.map((building) => [building.id, building.initialLevel]));
    const initial = sortedMap(balances);
    const zero = emptyMap(resourceIds);
    const state: EconomyState = {
        schemaVersion: ECONOMY_SCHEMA_VERSION,
        seed,
        day: 0,
        balances: initial,
        cards,
        buildings,
        reputationTierIds: [],
        taskCounts: emptyMap(config.dailyTasks.map((task) => task.id)),
        completedTaskIds: [],
        priceIndex: Object.fromEntries(config.shopProducts.map((product) => [product.id, product.basePrice])),
        ledger: { initial, produced: zero, consumed: { ...zero } },
        bankrupt: false,
        lastEvents: [],
        processedCommands: [],
        equipmentSnapshot: initialEquipment(seed),
        expeditionSnapshot: initialExpedition(seed, initial),
        shopSnapshot: initialShop(seed, initial, cards),
    };
    return state;
}

function assertState(raw: unknown, config: EconomyConfig): EconomyState {
    if (!isRecord(raw) || raw.schemaVersion !== ECONOMY_SCHEMA_VERSION) throw new Error('economy snapshot schemaVersion is unsupported');
    assertExactKeys(raw, ['schemaVersion', 'seed', 'day', 'balances', 'cards', 'buildings', 'reputationTierIds', 'taskCounts', 'completedTaskIds', 'priceIndex', 'ledger', 'bankrupt', 'lastEvents', 'processedCommands', 'equipmentSnapshot', 'expeditionSnapshot', 'shopSnapshot'], 'economy snapshot');
    const resourceIds = currentConfigResourceIds(config);
    const balances = validateResourceMap(raw.balances, resourceIds, 'economy balances');
    const ledger = validateLedger(raw.ledger, resourceIds);
    if (!isSafeInteger(raw.seed) || !isSafeInteger(raw.day) || raw.day > config.simulationDays) throw new Error('economy snapshot clock is invalid');
    assertLedgerInitial(ledger, config);
    const expectedBankrupt = isBankruptBoundary(raw.day, balances, config);
    if (raw.bankrupt !== expectedBankrupt) throw new Error('bankruptcy state does not match the current credit boundary');
    const cards = validateResourceMap(raw.cards, CARD_SHOP_CONFIG.cards.map((card) => card.id), 'economy cards');
    const expectedBuildings = new Set(config.buildings.map((building) => building.id));
    if (!isRecord(raw.buildings) || Object.keys(raw.buildings).length !== expectedBuildings.size || Object.keys(raw.buildings).some((id) => !expectedBuildings.has(id))) throw new Error('economy snapshot buildings are invalid');
    for (const building of config.buildings) if (!isSafeInteger(raw.buildings[building.id], building.initialLevel) || raw.buildings[building.id] > building.maxLevel) throw new Error(`economy building level is invalid: ${building.id}`);
    if (!Array.isArray(raw.reputationTierIds) || raw.reputationTierIds.some((id) => !config.reputationTiers.some((tier) => tier.id === id)) || new Set(raw.reputationTierIds).size !== raw.reputationTierIds.length) throw new Error('economy reputation tiers are invalid');
    const taskCounts = validateResourceMap(raw.taskCounts, config.dailyTasks.map((task) => task.id), 'economy task counts');
    if (!Array.isArray(raw.completedTaskIds) || raw.completedTaskIds.some((id) => typeof id !== 'string') || new Set(raw.completedTaskIds).size !== raw.completedTaskIds.length) throw new Error('economy completed tasks are invalid');
    const completedCounts = new Map(config.dailyTasks.map((task) => [task.id, 0]));
    for (const completionId of raw.completedTaskIds) {
        const separator = completionId.lastIndexOf(':');
        const taskId = completionId.slice(0, separator);
        const day = Number(completionId.slice(separator + 1));
        if (!config.dailyTasks.some((task) => task.id === taskId) || !isSafeInteger(day) || day < 1 || day > raw.day) throw new Error('economy completed task ID is invalid');
        completedCounts.set(taskId, (completedCounts.get(taskId) ?? 0) + 1);
    }
    for (const [taskId, count] of completedCounts) if (taskCounts[taskId] !== count) throw new Error(`economy task count mismatch: ${taskId}`);
    const priceIndex = assertSafeIntegerMap(raw.priceIndex, config.shopProducts.map((product) => product.id), 'economy price index');
    const expectedPrices = expectedPriceIndex(config, raw.day);
    for (const product of config.shopProducts) if (priceIndex[product.id] !== expectedPrices[product.id]) throw new Error(`economy price index does not match day: ${product.id}`);
    if (typeof raw.bankrupt !== 'boolean' || !Array.isArray(raw.lastEvents) || raw.lastEvents.some((event) => typeof event !== 'string')) throw new Error('economy status is invalid');
    if (!Array.isArray(raw.processedCommands)) throw new Error('economy processed commands are invalid');
    const commandIds = new Set<string>();
    for (const item of raw.processedCommands) {
        if (!isRecord(item)) throw new Error('economy processed command is invalid');
        assertExactKeys(item, ['requestId', 'fingerprint', 'result'], 'economy processed command');
        if (!validRequestId(item.requestId) || typeof item.fingerprint !== 'string' || item.fingerprint.length === 0 || !isRecord(item.result) || commandIds.has(item.requestId)) throw new Error('economy processed command is invalid');
        assertExactKeys(item.result, ['status', 'requestId', 'type', 'day', 'events', 'reason'], 'economy processed command result');
        if (!COMMAND_TYPES.has(item.result.type) || item.result.requestId !== item.requestId || (item.result.status !== 'success' && item.result.status !== 'failure')
            || !isSafeInteger(item.result.day) || item.result.day > config.simulationDays || !Array.isArray(item.result.events) || item.result.events.some((event: unknown) => typeof event !== 'string')
            || (item.result.status === 'success' && item.result.reason !== null) || (item.result.status === 'failure' && typeof item.result.reason !== 'string')) throw new Error('economy processed command result is invalid');
        let fingerprint: unknown;
        try { fingerprint = JSON.parse(item.fingerprint); } catch { throw new Error('economy processed command fingerprint is invalid'); }
        if (!isRecord(fingerprint) || canonicalJson(fingerprint) !== item.fingerprint) throw new Error('economy processed command fingerprint is invalid');
        if (item.result.type === 'advance-day') {
            assertExactKeys(fingerprint, ['day', 'type'], 'economy advance-day fingerprint');
            if (fingerprint.type !== 'advance-day' || !isSafeInteger(fingerprint.day, 1)) throw new Error('economy advance-day fingerprint is invalid');
        } else {
            assertExactKeys(fingerprint, ['productId', 'type'], 'economy shop-purchase fingerprint');
            if (fingerprint.type !== 'shop-purchase' || !validRequestId(fingerprint.productId)) throw new Error('economy shop-purchase fingerprint is invalid');
        }
        commandIds.add(item.requestId);
    }
    validateCraftingSnapshot(raw.equipmentSnapshot);
    validateExpeditionSnapshot(raw.expeditionSnapshot);
    validateShopSnapshot(raw.shopSnapshot);
    if (raw.equipmentSnapshot.seed !== derivedServiceSeed(raw.seed, 'crafting')) throw new Error('crafting seed does not match top-level economy seed');
    if (raw.shopSnapshot.seed !== derivedServiceSeed(raw.seed, 'shop')) throw new Error('shop seed does not match top-level economy seed');
    const initialExpedition = initialExpeditionNumber(raw.seed);
    const claimedExpeditionNumbers = raw.expeditionSnapshot.claimedExpeditionIds
        .map((id: string) => Number(id.slice('expedition-'.length)))
        .sort((left: number, right: number) => left - right);
    const activeExpeditionNumbers = raw.expeditionSnapshot.expedition === null
        ? []
        : [Number(raw.expeditionSnapshot.expedition.id.slice('expedition-'.length))];
    const expeditionNumbers = [...claimedExpeditionNumbers, ...activeExpeditionNumbers].sort((left, right) => left - right);
    const dispatchCount = expeditionNumbers.length;
    if (raw.expeditionSnapshot.nextExpeditionNumber !== initialExpedition + dispatchCount) {
        throw new Error('expedition nextExpeditionNumber does not match top-level dispatch history');
    }
    for (let index = 0; index < expeditionNumbers.length; index += 1) {
        if (expeditionNumbers[index] !== initialExpedition + index) throw new Error('expedition dispatch history is not contiguous');
    }
    const successfulAdvances = raw.processedCommands
        .filter((item: any) => item.result.type === 'advance-day' && item.result.status === 'success')
        .sort((left: any, right: any) => left.result.day - right.result.day);
    const successfulAdvanceDays = new Set<number>();
    for (const item of successfulAdvances) {
        if (!isSafeInteger(item.result.day, 1) || item.result.day > raw.day || successfulAdvanceDays.has(item.result.day)) {
            throw new Error('advance-day history contains a duplicate or out-of-range success');
        }
        successfulAdvanceDays.add(item.result.day);
    }
    if (successfulAdvanceDays.size !== raw.day || [...successfulAdvanceDays].some((day, index) => day !== index + 1)) {
        throw new Error('advance-day history is not contiguous');
    }
    const historyDispatchCount = successfulAdvances.reduce((count: number, item: any) => (
        count + (item.result.events.includes('expedition:claimed') ? 1 : 0)
    ), 0);
    if (historyDispatchCount !== claimedExpeditionNumbers.length) throw new Error('expedition dispatch history does not match processed commands');
    if (taskCounts.expedition_claim !== claimedExpeditionNumbers.length) throw new Error('expedition dispatch history does not match task history');
    const latestAdvance = successfulAdvances[successfulAdvances.length - 1];
    if (raw.day === 0) {
        if (raw.lastEvents.length !== 0 || latestAdvance !== undefined) throw new Error('bankruptcy state is invalid at day 0');
    } else {
        if (latestAdvance === undefined || latestAdvance.result.day !== raw.day || canonicalJson(raw.lastEvents) !== canonicalJson(latestAdvance.result.events)) {
            throw new Error('bankruptcy state does not match the latest economy history');
        }
        const mandatoryCostEvent = `consume:credits:${config.mandatoryCreditCost}`;
        const paidMandatoryCost = raw.lastEvents.includes(mandatoryCostEvent);
        if (paidMandatoryCost && ledger.consumed.credits < config.mandatoryCreditCost) {
            throw new Error('bankruptcy state is inconsistent with the credit ledger');
        }
    }
    const equipment = EquipmentCraftingService.fromSnapshot(raw.equipmentSnapshot as CraftingServiceSnapshot, CRAFTING_CONFIG);
    const expedition = new ExpeditionService({ config: EXPEDITION_CONFIG, snapshot: raw.expeditionSnapshot as ExpeditionServiceSnapshot });
    const shop = new CardShopService({ config: CARD_SHOP_CONFIG, ...(raw.shopSnapshot as CardShopServiceSnapshot) as any });
    if (!equipment || !expedition || !shop) throw new Error('economy integrations could not be restored');
    for (const material of CRAFTING_CONFIG.materials) {
        if (equipment.getMaterialBalance(material.id) !== balances[material.id]) throw new Error(`equipment resource alignment failed for ${material.id}`);
    }
    const expeditionResources = expedition.getResources();
    for (const resourceId of ['stamina', 'experience', 'silver', 'crystal']) {
        if (expeditionResources[resourceId] !== balances[resourceId]) throw new Error(`expedition resource alignment failed for ${resourceId}`);
    }
    for (const material of EXPEDITION_CONFIG.materials) {
        if (expeditionResources.materials[material.id] !== balances[material.id]) throw new Error(`expedition material alignment failed for ${material.id}`);
    }
    const shopBalances = shop.getBalances();
    if (shopBalances.coins !== balances.coins || shopBalances.crystals !== balances.crystal) throw new Error('shop currency alignment failed');
    if (!sameIds(Object.keys(shop.getInventory()), Object.keys(raw.cards))) throw new Error('shop card alignment keys failed');
    for (const cardId of Object.keys(raw.cards)) if (shop.getCardInventory(cardId) !== raw.cards[cardId]) throw new Error(`shop card alignment failed for ${cardId}`);
    const actual = Object.fromEntries(resourceIds.map((id) => [id, balances[id]]));
    for (const id of resourceIds) {
        const expected = ledger.initial[id] + ledger.produced[id] - ledger.consumed[id];
        if (expected !== actual[id]) throw new Error(`economy ledger conservation failed for ${id}`);
    }
    return {
        ...(clone(raw) as EconomyState),
        balances,
        cards,
        taskCounts,
        priceIndex,
    };
}

export class EconomyService {
    private readonly config: EconomyConfig;
    private state: EconomyState;

    public constructor(options: EconomyServiceOptions = {}) {
        this.config = loadEconomyConfig(options.config ?? ECONOMY_CONFIG);
        assertIntegrationContracts(this.config);
        if (diffEconomySkeleton(this.config).length > 0) throw new Error('economy config skeleton does not match the approved contract');
        if (options.seed !== undefined && !isSafeInteger(options.seed)) throw new Error('economy seed must be a non-negative safe integer');
        const seed = options.seed ?? this.config.seed;
        this.state = options.snapshot === undefined ? makeInitialState(this.config, seed) : assertState(options.snapshot, this.config);
        if (this.state.seed !== seed && options.snapshot === undefined) throw new Error('economy seed initialization failed');
        assertState(this.state, this.config);
    }

    public static fromSnapshot(snapshot: EconomyState, config: EconomyConfig = ECONOMY_CONFIG): EconomyService {
        const checked = assertState(snapshot, loadEconomyConfig(config));
        return new EconomyService({ config, seed: checked.seed, snapshot: checked });
    }

    public getConfig(): EconomyConfig { return this.config; }
    public snapshot(): EconomyState { return clone(this.state); }
    public getState(): EconomyState { return this.snapshot(); }
    public serialize(): string { return canonicalJson(this.state); }

    public rollback(serialized: string): void {
        if (typeof serialized !== 'string') throw new Error('economy rollback payload must be a string');
        const restored = JSON.parse(serialized) as EconomyState;
        this.state = assertState(restored, this.config);
    }

    public apply(command: unknown): EconomyCommandResult {
        const parsed = parseCommand(command);
        if (parsed === null) return invalidCommandResult(command, this.state.day);
        const requestId = parsed.requestId;
        const fallback: EconomyCommandResult = { status: 'failure', requestId, type: parsed.type, day: this.state.day, events: [], reason: 'INVALID_REQUEST' };
        const fingerprint = commandFingerprint(parsed);
        const existing = this.state.processedCommands.find((item) => item.requestId === requestId);
        if (existing) return existing.fingerprint === fingerprint ? clone(existing.result) : { ...fallback, reason: 'REQUEST_ID_REUSED' };
        const before = this.serialize();
        let result: EconomyCommandResult;
        try {
            result = parsed.type === 'advance-day' ? this.executeAdvanceDay(parsed) : this.executeShopPurchase(parsed);
        } catch (error) {
            this.rollback(before);
            result = { ...fallback, reason: error instanceof Error ? error.message : 'COMMAND_FAILED' };
        }
        const processed = { requestId, fingerprint, result: clone(result) };
        this.state.processedCommands = [...this.state.processedCommands, processed].sort((left, right) => left.requestId.localeCompare(right.requestId));
        assertState(this.state, this.config);
        return clone(result);
    }

    public advanceDay(day = this.state.day + 1, requestId = `advance:${day}`): EconomyCommandResult {
        return this.apply({ requestId, type: 'advance-day', day });
    }

    private balance(resourceId: string): number {
        if (!Object.prototype.hasOwnProperty.call(this.state.balances, resourceId)) throw new Error(`unknown economy resource: ${resourceId}`);
        return this.state.balances[resourceId];
    }

    private change(resourceId: string, delta: number): void {
        if (!Number.isSafeInteger(delta)) throw new Error(`invalid economy delta: ${resourceId}`);
        const current = this.balance(resourceId);
        if (delta < 0 && current < -delta) throw new Error(`INSUFFICIENT_${resourceId.toUpperCase()}`);
        const next = delta >= 0 ? addSafe(current, delta) : current + delta;
        if (next < 0) throw new Error(`NEGATIVE_${resourceId.toUpperCase()}`);
        const balances = { ...this.state.balances, [resourceId]: next };
        const ledger = {
            initial: { ...this.state.ledger.initial },
            produced: { ...this.state.ledger.produced },
            consumed: { ...this.state.ledger.consumed },
        };
        if (delta >= 0) ledger.produced[resourceId] = addSafe(ledger.produced[resourceId], delta);
        else ledger.consumed[resourceId] = addSafe(ledger.consumed[resourceId], -delta);
        this.state.balances = sortedMap(balances);
        this.state.ledger = ledger;
    }

    private produce(cost: EconomyCost, events: string[]): void {
        for (const [resourceId, quantity] of Object.entries(cost)) { this.change(resourceId, quantity); events.push(`produce:${resourceId}:${quantity}`); }
    }

    private consume(cost: EconomyCost, events: string[], optional = false): boolean {
        if (Object.entries(cost).some(([resourceId, quantity]) => this.balance(resourceId) < quantity)) return false;
        for (const [resourceId, quantity] of Object.entries(cost)) { this.change(resourceId, -quantity); events.push(`${optional ? 'optional-consume' : 'consume'}:${resourceId}:${quantity}`); }
        return true;
    }

    private completeTask(taskId: string, day: number, events: string[]): boolean {
        const task = this.config.dailyTasks.find((item) => item.id === taskId);
        if (!task) return false;
        const completionId = `${task.id}:${day}`;
        if (this.state.completedTaskIds.includes(completionId)) return false;
        const counts = { ...this.state.taskCounts, [task.id]: (this.state.taskCounts[task.id] ?? 0) + 1 };
        this.state.taskCounts = counts;
        this.state.completedTaskIds = [...this.state.completedTaskIds, completionId].sort();
        this.produce(task.reward, events);
        events.push(`task:${task.id}`);
        return true;
    }

    private syncExpeditionService(): ExpeditionService {
        const snapshot = this.state.expeditionSnapshot;
        const resources = {
            ...snapshot.resources,
            stamina: this.balance('stamina'),
            experience: this.balance('experience'),
            silver: this.balance('silver'),
            crystal: this.balance('crystal'),
            materials: Object.fromEntries(EXPEDITION_CONFIG.materials.map((material) => [material.id, this.balance(material.id)])),
        };
        return new ExpeditionService({ config: EXPEDITION_CONFIG, snapshot: { ...snapshot, resources } });
    }

    private syncExpeditionResult(service: ExpeditionService): void {
        const resources = service.getResources();
        for (const resourceId of ['stamina', 'experience', 'silver', 'crystal']) this.change(resourceId, resources[resourceId] - this.balance(resourceId));
        for (const material of EXPEDITION_CONFIG.materials) this.change(material.id, resources.materials[material.id] - this.balance(material.id));
        this.state.expeditionSnapshot = service.snapshot();
    }

    private syncCraftingService(): EquipmentCraftingService {
        const snapshot = this.state.equipmentSnapshot;
        return EquipmentCraftingService.fromSnapshot({
            ...snapshot,
            materials: Object.fromEntries(CRAFTING_CONFIG.materials.map((material) => [material.id, this.balance(material.id)])),
        }, CRAFTING_CONFIG);
    }

    private syncCraftingResult(service: EquipmentCraftingService): void {
        const materials = service.snapshot().materials;
        for (const material of CRAFTING_CONFIG.materials) this.change(material.id, materials[material.id] - this.balance(material.id));
        this.state.equipmentSnapshot = service.snapshot();
    }

    private syncShopService(): CardShopService {
        const snapshot = this.state.shopSnapshot;
        return new CardShopService({
            config: CARD_SHOP_CONFIG,
            seed: snapshot.seed,
            refreshCount: snapshot.refreshCount,
            listings: snapshot.listings,
            balances: { coins: this.balance('coins'), crystals: this.balance('crystal') },
            inventory: this.state.cards,
            processedResults: snapshot.processedResults,
        });
    }

    private syncShopResult(service: CardShopService): void {
        const balances = service.getBalances();
        this.change('coins', balances.coins - this.balance('coins'));
        this.change('crystal', (balances.crystals ?? 0) - this.balance('crystal'));
        this.state.cards = service.getInventory();
        this.state.shopSnapshot = service.snapshot();
    }

    private executeShopPurchase(command: Extract<EconomyCommand, { type: 'shop-purchase' }>): EconomyCommandResult {
        const events: string[] = [];
        const service = this.syncShopService();
        const result = service.purchase({ requestId: `economy:${command.requestId}`, productId: command.productId });
        this.syncShopResult(service);
        if (!result.success) return { status: 'failure', requestId: command.requestId, type: command.type, day: this.state.day, events, reason: result.reason ?? 'PURCHASE_FAILED' };
        events.push(`shop-purchase:${result.productId}`);
        return { status: 'success', requestId: command.requestId, type: command.type, day: this.state.day, events, reason: null };
    }

    private executeAdvanceDay(command: Extract<EconomyCommand, { type: 'advance-day' }>): EconomyCommandResult {
        if (!isSafeInteger(command.day, 1) || command.day !== this.state.day + 1 || command.day > this.config.simulationDays) {
            return { status: 'failure', requestId: command.requestId, type: command.type, day: this.state.day, events: [], reason: 'INVALID_DAY' };
        }
        const events: string[] = [];
        this.state.day = command.day;
        this.state.priceIndex = expectedPriceIndex(this.config, command.day);
        const openingCreditShortfall = this.balance('credits') < this.config.mandatoryCreditCost;
        this.produce({ credits: this.config.dailyCreditIncome, stamina: this.config.dailyStaminaIncome }, events);
        if (openingCreditShortfall) events.push('bankruptcy-boundary');
        this.consume({ credits: this.config.mandatoryCreditCost }, events);
        for (const building of this.config.buildings) {
            const level = this.state.buildings[building.id];
            const scaledYield = Object.fromEntries(Object.entries(building.dailyYield).map(([id, quantity]) => [id, multiplySafe(quantity, level)]));
            this.produce(scaledYield, events);
        }
        this.completeTask('daily_income', command.day, events);

        const expedition = this.syncExpeditionService();
        const dispatch = expedition.dispatch('border_watch', ['scout', 'vanguard'], command.day * 86_400_000);
        if (dispatch.success) {
            expedition.settle(dispatch.endsAt as number);
            const claim = expedition.claim(dispatch.endsAt as number, dispatch.expeditionId as string);
            if (claim.success) this.completeTask('expedition_claim', command.day, events);
            events.push(`expedition:${claim.success ? 'claimed' : claim.reason}`);
        } else events.push(`expedition:skipped:${dispatch.reason}`);
        this.syncExpeditionResult(expedition);

        if (command.day === 6 || command.day === 16 || command.day === 26) {
            const building = this.config.buildings.find((item) => item.id === (command.day === 16 ? 'relay' : 'foundry')) as typeof this.config.buildings[number];
            const currentLevel = this.state.buildings[building.id];
            const upgrade = building.upgrades.find((item) => item.targetLevel === currentLevel + 1);
            if (upgrade && this.consume(upgrade.cost, events, true)) {
                this.state.buildings = { ...this.state.buildings, [building.id]: currentLevel + 1 };
                events.push(`building:${building.id}:${currentLevel + 1}`);
                this.completeTask('shop_refresh', command.day, events);
            }
        }

        if (command.day === 3 || command.day === 9) {
            const crafting = this.syncCraftingService();
            const recipe = command.day === 3 ? 'forge_pair' : 'forge_triad';
            const input = command.day === 3
                ? ['starter:blade:1', 'starter:armor:1']
                : ['starter:blade:2', 'starter:armor:2', 'starter:scope:1'];
            const result = crafting.craft({
                requestId: `economy:craft:${command.day}`,
                recipeId: recipe,
                inputInstanceIds: input,
            } as Parameters<typeof crafting.craft>[0]);
            this.syncCraftingResult(crafting);
            events.push(`craft:${result.success ? 'success' : result.reason}`);
            if (result.success) this.completeTask('shop_refresh', command.day, events);
        }

        const shop = this.syncShopService();
        const refresh = shop.refresh({ requestId: `refresh:${command.day}` });
        if (refresh.success) {
            this.completeTask('shop_refresh', command.day, events);
            if (command.day === 1 && refresh.listings.length > 0) {
                const product = refresh.listings[0].productId;
                const purchase = shop.purchase({ requestId: `purchase:${command.day}`, productId: product });
                events.push(`shop:${purchase.success ? 'purchase' : purchase.reason}`);
            }
        }
        this.syncShopResult(shop);

        for (const tier of this.config.reputationTiers) {
            if (this.balance('reputation') >= tier.threshold && !this.state.reputationTierIds.includes(tier.id)) {
                this.state.reputationTierIds = [...this.state.reputationTierIds, tier.id].sort();
                this.produce(tier.dailyYield, events);
                events.push(`reputation:${tier.id}`);
            }
        }
        // Keep persisted upstream snapshots aligned even on days without a craft.
        this.state.equipmentSnapshot = this.syncCraftingService().snapshot();
        this.state.expeditionSnapshot = this.syncExpeditionService().snapshot();
        this.state.shopSnapshot = this.syncShopService().snapshot();
        this.state.bankrupt = isBankruptBoundary(this.state.day, this.state.balances, this.config);
        this.state.lastEvents = events;
        return { status: 'success', requestId: command.requestId, type: command.type, day: this.state.day, events, reason: null };
    }
}

export function restoreEconomyService(snapshot: EconomyState, config: EconomyConfig = ECONOMY_CONFIG): EconomyService {
    return EconomyService.fromSnapshot(snapshot, config);
}
