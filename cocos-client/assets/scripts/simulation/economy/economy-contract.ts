import { CRAFTING_CONFIG } from '../../meta/equipment/crafting/crafting-config';

export const ECONOMY_SCHEMA_VERSION = 1;
export const ECONOMY_SIMULATION_DAYS = 30;
export const ECONOMY_BASIS_POINTS = 10_000;

export type EconomyResource = {
    id: string;
    initial: number;
};

export type EconomyCost = Readonly<Record<string, number>>;

export type EconomyBuildingUpgrade = {
    targetLevel: number;
    cost: EconomyCost;
};

export type EconomyBuilding = {
    id: string;
    initialLevel: number;
    maxLevel: number;
    dailyYield: EconomyCost;
    upgrades: readonly EconomyBuildingUpgrade[];
};

export type EconomyReputationTier = {
    id: string;
    threshold: number;
    dailyYield: EconomyCost;
};

export type EconomyExpedition = {
    id: string;
    durationDays: number;
    staminaCost: number;
    rewards: EconomyCost;
};

export type EconomyDailyTask = {
    id: string;
    event: 'income' | 'expedition' | 'shop' | 'craft' | 'building';
    reward: EconomyCost;
};

export type EconomyShopProduct = {
    id: string;
    externalProductId: string;
    currencyId: 'coins' | 'crystal';
    basePrice: number;
    inflationBps: number;
};

export type EconomyIntegrationRefs = {
    equipmentRecipeIds: readonly string[];
    equipmentEnhancementIds: readonly string[];
    buildingIds: readonly string[];
    reputationTierIds: readonly string[];
    expeditionIds: readonly string[];
    dailyTaskIds: readonly string[];
    shopProductIds: readonly string[];
};

export type EconomyConfig = {
    schemaVersion: 1;
    simulationDays: 30;
    seed: number;
    resources: readonly EconomyResource[];
    buildings: readonly EconomyBuilding[];
    reputationTiers: readonly EconomyReputationTier[];
    expeditions: readonly EconomyExpedition[];
    dailyTasks: readonly EconomyDailyTask[];
    shopProducts: readonly EconomyShopProduct[];
    integrationRefs: EconomyIntegrationRefs;
    dailyCreditIncome: number;
    dailyStaminaIncome: number;
    mandatoryCreditCost: number;
};

export type EconomySkeleton = {
    resources: readonly string[];
    buildings: readonly string[];
    reputationTiers: readonly string[];
    expeditions: readonly string[];
    dailyTasks: readonly string[];
    shopProducts: readonly string[];
};

export const ECONOMY_SKELETON: EconomySkeleton = {
    resources: ['alloy', 'circuit', 'coins', 'core', 'credits', 'crystal', 'crystal_shard', 'experience', 'field_ration', 'reputation', 'silver', 'stamina'],
    buildings: ['foundry', 'relay'],
    reputationTiers: ['trusted', 'venerated'],
    expeditions: ['border_watch', 'deep_zone'],
    dailyTasks: ['daily_income', 'expedition_claim', 'shop_refresh'],
    shopProducts: ['bulwark_coins', 'ember_shot_coins', 'field_medic_coins', 'storm_core_crystals', 'void_lance_coins'],
};

const CONFIG_KEYS = new Set([
    'schemaVersion', 'simulationDays', 'seed', 'resources', 'buildings', 'reputationTiers',
    'expeditions', 'dailyTasks', 'shopProducts', 'integrationRefs', 'dailyCreditIncome',
    'dailyStaminaIncome', 'mandatoryCreditCost',
]);
const RESOURCE_KEYS = new Set(['id', 'initial']);
const BUILDING_KEYS = new Set(['id', 'initialLevel', 'maxLevel', 'dailyYield', 'upgrades']);
const UPGRADE_KEYS = new Set(['targetLevel', 'cost']);
const TIER_KEYS = new Set(['id', 'threshold', 'dailyYield']);
const EXPEDITION_KEYS = new Set(['id', 'durationDays', 'staminaCost', 'rewards']);
const TASK_KEYS = new Set(['id', 'event', 'reward']);
const PRODUCT_KEYS = new Set(['id', 'externalProductId', 'currencyId', 'basePrice', 'inflationBps']);
const INTEGRATION_KEYS = new Set([
    'equipmentRecipeIds', 'equipmentEnhancementIds', 'buildingIds', 'reputationTierIds',
    'expeditionIds', 'dailyTaskIds', 'shopProductIds',
]);

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, any>, allowed: ReadonlySet<string>, path: string): string[] {
    const keys = Object.keys(value);
    return [
        ...keys.filter((key) => !allowed.has(key)).map((key) => `${path}.${key} is not allowed`),
        ...[...allowed].filter((key) => !Object.prototype.hasOwnProperty.call(value, key)).map((key) => `${path}.${key} is required`),
    ];
}

function isId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= 96 && value === value.trim()
        && !['__proto__', 'constructor', 'prototype'].includes(value);
}

function isSafeInteger(value: unknown, minimum = 0): boolean {
    return Number.isSafeInteger(value) && Number(value) >= minimum;
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

function validateCost(value: unknown, resourceIds: ReadonlySet<string>, path: string, allowEmpty = false): string[] {
    if (!isRecord(value)) return [`${path} must be an object`];
    if (!allowEmpty && Object.keys(value).length === 0) return [`${path} must not be empty`];
    const errors: string[] = [];
    for (const [resourceId, quantity] of Object.entries(value)) {
        if (!resourceIds.has(resourceId)) errors.push(`${path}.${resourceId} references unknown resource`);
        if (!isSafeInteger(quantity, 1)) errors.push(`${path}.${resourceId} must be a positive safe integer`);
    }
    return errors;
}

function validateIds(value: unknown, path: string, expected: ReadonlySet<string>): string[] {
    if (!Array.isArray(value)) return [`${path} must be an array`];
    const errors: string[] = [];
    const seen = new Set<string>();
    for (const id of value) {
        if (!isId(id)) errors.push(`${path} contains an invalid id`);
        else if (seen.has(id)) errors.push(`${path} contains duplicate id: ${id}`);
        else if (!expected.has(id)) errors.push(`${path} references unknown id: ${id}`);
        seen.add(id as string);
    }
    return errors;
}

function validateCompleteIds(value: unknown, path: string, expected: ReadonlySet<string>): string[] {
    const errors = validateIds(value, path, expected);
    if (!Array.isArray(value)) return errors;
    for (const id of expected) if (!value.includes(id)) errors.push(`${path} is missing id: ${id}`);
    return errors;
}

export function validateEconomyConfig(raw: unknown): string[] {
    if (!isRecord(raw)) return ['economy config must be an object'];
    const errors = exactKeys(raw, CONFIG_KEYS, 'config');
    if (raw.schemaVersion !== ECONOMY_SCHEMA_VERSION) errors.push('config.schemaVersion is unsupported');
    if (raw.simulationDays !== ECONOMY_SIMULATION_DAYS) errors.push(`config.simulationDays must be ${ECONOMY_SIMULATION_DAYS}`);
    for (const [key, minimum] of [['seed', 0], ['dailyCreditIncome', 1], ['dailyStaminaIncome', 1], ['mandatoryCreditCost', 1] ] as const) {
        if (!isSafeInteger(raw[key], minimum)) errors.push(`config.${key} must be a safe integer >= ${minimum}`);
    }
    for (const key of ['resources', 'buildings', 'reputationTiers', 'expeditions', 'dailyTasks', 'shopProducts']) {
        if (!Array.isArray(raw[key]) || raw[key].length === 0) errors.push(`config.${key} must be a non-empty array`);
    }
    if (!isRecord(raw.integrationRefs)) errors.push('config.integrationRefs must be an object');
    else errors.push(...exactKeys(raw.integrationRefs, INTEGRATION_KEYS, 'config.integrationRefs'));
    if (!Array.isArray(raw.resources) || !Array.isArray(raw.buildings) || !Array.isArray(raw.reputationTiers)
        || !Array.isArray(raw.expeditions) || !Array.isArray(raw.dailyTasks) || !Array.isArray(raw.shopProducts)) return [...new Set(errors)];

    errors.push(...duplicateIds(raw.resources, 'resource'), ...duplicateIds(raw.buildings, 'building'),
        ...duplicateIds(raw.reputationTiers, 'reputation tier'), ...duplicateIds(raw.expeditions, 'expedition'),
        ...duplicateIds(raw.dailyTasks, 'daily task'), ...duplicateIds(raw.shopProducts, 'shop product'));
    const resourceIds = new Set<string>();
    raw.resources.forEach((value: any, index: number) => {
        const path = `resources[${index}]`;
        if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
        errors.push(...exactKeys(value, RESOURCE_KEYS, path));
        if (!isId(value.id)) errors.push(`${path}.id is required`); else resourceIds.add(value.id);
        if (!isSafeInteger(value.initial)) errors.push(`${path}.initial must be a safe integer >= 0`);
    });
    const buildingIds = new Set<string>(raw.buildings.filter(isRecord).map((value: any) => value.id).filter(isId));
    raw.buildings.forEach((value: any, index: number) => {
        const path = `buildings[${index}]`;
        if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
        errors.push(...exactKeys(value, BUILDING_KEYS, path));
        if (!isId(value.id)) errors.push(`${path}.id is required`);
        if (!isSafeInteger(value.initialLevel, 1) || !isSafeInteger(value.maxLevel, 1) || value.initialLevel > value.maxLevel) errors.push(`${path} levels are invalid`);
        errors.push(...validateCost(value.dailyYield, resourceIds, `${path}.dailyYield`));
        if (!Array.isArray(value.upgrades) || value.upgrades.length !== value.maxLevel - value.initialLevel) errors.push(`${path}.upgrades must cover each next level`);
        else value.upgrades.forEach((upgrade: any, upgradeIndex: number) => {
            const upgradePath = `${path}.upgrades[${upgradeIndex}]`;
            if (!isRecord(upgrade)) { errors.push(`${upgradePath} must be an object`); return; }
            errors.push(...exactKeys(upgrade, UPGRADE_KEYS, upgradePath));
            if (upgrade.targetLevel !== value.initialLevel + upgradeIndex + 1) errors.push(`${upgradePath}.targetLevel is not sequential`);
            errors.push(...validateCost(upgrade.cost, resourceIds, `${upgradePath}.cost`));
        });
    });
    const tierIds = new Set<string>();
    let previousThreshold = -1;
    raw.reputationTiers.forEach((value: any, index: number) => {
        const path = `reputationTiers[${index}]`;
        if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
        errors.push(...exactKeys(value, TIER_KEYS, path));
        if (!isId(value.id)) errors.push(`${path}.id is required`); else tierIds.add(value.id);
        if (!isSafeInteger(value.threshold) || value.threshold <= previousThreshold) errors.push(`${path}.threshold must be strictly increasing`);
        previousThreshold = Number(value.threshold);
        errors.push(...validateCost(value.dailyYield, resourceIds, `${path}.dailyYield`));
    });
    const expeditionIds = new Set<string>();
    raw.expeditions.forEach((value: any, index: number) => {
        const path = `expeditions[${index}]`;
        if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
        errors.push(...exactKeys(value, EXPEDITION_KEYS, path));
        if (!isId(value.id)) errors.push(`${path}.id is required`); else expeditionIds.add(value.id);
        if (!isSafeInteger(value.durationDays, 1) || !isSafeInteger(value.staminaCost, 1)) errors.push(`${path} timing/cost is invalid`);
        errors.push(...validateCost(value.rewards, resourceIds, `${path}.rewards`));
    });
    const taskIds = new Set<string>();
    raw.dailyTasks.forEach((value: any, index: number) => {
        const path = `dailyTasks[${index}]`;
        if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
        errors.push(...exactKeys(value, TASK_KEYS, path));
        if (!isId(value.id)) errors.push(`${path}.id is required`); else taskIds.add(value.id);
        if (!['income', 'expedition', 'shop', 'craft', 'building'].includes(value.event)) errors.push(`${path}.event is invalid`);
        errors.push(...validateCost(value.reward, resourceIds, `${path}.reward`));
    });
    const productIds = new Set<string>();
    raw.shopProducts.forEach((value: any, index: number) => {
        const path = `shopProducts[${index}]`;
        if (!isRecord(value)) { errors.push(`${path} must be an object`); return; }
        errors.push(...exactKeys(value, PRODUCT_KEYS, path));
        if (!isId(value.id)) errors.push(`${path}.id is required`); else productIds.add(value.id);
        if (!isId(value.externalProductId)) errors.push(`${path}.externalProductId is required`);
        if (value.currencyId !== 'coins' && value.currencyId !== 'crystal') errors.push(`${path}.currencyId is invalid`);
        if (!isSafeInteger(value.basePrice, 1) || !isSafeInteger(value.inflationBps, 0) || value.inflationBps > ECONOMY_BASIS_POINTS) errors.push(`${path} price is invalid`);
    });
    if (isRecord(raw.integrationRefs)) {
        errors.push(...validateCompleteIds(raw.integrationRefs.buildingIds, 'integrationRefs.buildingIds', buildingIds));
        errors.push(...validateCompleteIds(raw.integrationRefs.reputationTierIds, 'integrationRefs.reputationTierIds', tierIds));
        errors.push(...validateCompleteIds(raw.integrationRefs.expeditionIds, 'integrationRefs.expeditionIds', expeditionIds));
        errors.push(...validateCompleteIds(raw.integrationRefs.dailyTaskIds, 'integrationRefs.dailyTaskIds', taskIds));
        errors.push(...validateCompleteIds(raw.integrationRefs.shopProductIds, 'integrationRefs.shopProductIds', productIds));
        errors.push(...validateCompleteIds(raw.integrationRefs.equipmentRecipeIds, 'integrationRefs.equipmentRecipeIds', new Set(CRAFTING_CONFIG.recipes.map((recipe) => recipe.id))));
        errors.push(...validateCompleteIds(raw.integrationRefs.equipmentEnhancementIds, 'integrationRefs.equipmentEnhancementIds', new Set(['enhance-common', 'enhance-rare', 'enhance-epic'])));
    }
    return [...new Set(errors)];
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isRecord(value)) return value;
    return Object.keys(value).sort().reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
    }, {} as Record<string, unknown>);
}

function deepFreeze<T>(value: T): T {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    return value;
}

export function normalizeEconomyConfig(raw: unknown): EconomyConfig {
    const errors = validateEconomyConfig(raw);
    if (errors.length > 0) throw new Error(`Invalid economy config: ${errors.join('; ')}`);
    const config = raw as EconomyConfig;
    return deepFreeze({
        schemaVersion: ECONOMY_SCHEMA_VERSION,
        simulationDays: ECONOMY_SIMULATION_DAYS,
        seed: config.seed,
        resources: config.resources.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
        buildings: config.buildings.map((item) => ({
            ...item, dailyYield: { ...item.dailyYield },
            upgrades: item.upgrades.map((upgrade) => ({ ...upgrade, cost: { ...upgrade.cost } })),
        })).sort((a, b) => a.id.localeCompare(b.id)),
        reputationTiers: config.reputationTiers.map((item) => ({ ...item, dailyYield: { ...item.dailyYield } })),
        expeditions: config.expeditions.map((item) => ({ ...item, rewards: { ...item.rewards } })).sort((a, b) => a.id.localeCompare(b.id)),
        dailyTasks: config.dailyTasks.map((item) => ({ ...item, reward: { ...item.reward } })).sort((a, b) => a.id.localeCompare(b.id)),
        shopProducts: config.shopProducts.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
        integrationRefs: {
            equipmentRecipeIds: [...config.integrationRefs.equipmentRecipeIds].sort(),
            equipmentEnhancementIds: [...config.integrationRefs.equipmentEnhancementIds].sort(),
            buildingIds: [...config.integrationRefs.buildingIds].sort(),
            reputationTierIds: [...config.integrationRefs.reputationTierIds].sort(),
            expeditionIds: [...config.integrationRefs.expeditionIds].sort(),
            dailyTaskIds: [...config.integrationRefs.dailyTaskIds].sort(),
            shopProductIds: [...config.integrationRefs.shopProductIds].sort(),
        },
        dailyCreditIncome: config.dailyCreditIncome,
        dailyStaminaIncome: config.dailyStaminaIncome,
        mandatoryCreditCost: config.mandatoryCreditCost,
    });
}

export function loadEconomyConfig(raw: unknown): EconomyConfig { return normalizeEconomyConfig(raw); }

export function serializeEconomyConfig(config: EconomyConfig): string {
    return JSON.stringify(canonicalize(normalizeEconomyConfig(config)));
}

export function parseEconomyConfig(payload: string): EconomyConfig {
    if (typeof payload !== 'string') throw new Error('Economy config payload must be a string');
    try { return loadEconomyConfig(JSON.parse(payload)); }
    catch (error) {
        if (error instanceof SyntaxError) throw new Error(`Invalid economy config JSON: ${error.message}`);
        throw error;
    }
}

function idDiff(actual: readonly string[], expected: readonly string[], path: string): string[] {
    const actualSet = new Set(actual);
    const expectedSet = new Set(expected);
    return [
        ...expected.filter((id) => !actualSet.has(id)).map((id) => `${path} missing: ${id}`),
        ...actual.filter((id) => !expectedSet.has(id)).map((id) => `${path} unexpected: ${id}`),
    ];
}

export function diffEconomySkeleton(config: EconomyConfig, skeleton: EconomySkeleton = ECONOMY_SKELETON): string[] {
    return [
        ...idDiff(config.resources.map((item) => item.id), skeleton.resources, 'resources'),
        ...idDiff(config.buildings.map((item) => item.id), skeleton.buildings, 'buildings'),
        ...idDiff(config.reputationTiers.map((item) => item.id), skeleton.reputationTiers, 'reputationTiers'),
        ...idDiff(config.expeditions.map((item) => item.id), skeleton.expeditions, 'expeditions'),
        ...idDiff(config.dailyTasks.map((item) => item.id), skeleton.dailyTasks, 'dailyTasks'),
        ...idDiff(config.shopProducts.map((item) => item.id), skeleton.shopProducts, 'shopProducts'),
    ];
}

export function canonicalJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }
