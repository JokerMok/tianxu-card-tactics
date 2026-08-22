export const CRAFTING_SCHEMA_VERSION = 1;
export const MIN_CRAFTING_INPUTS = 2;
export const MAX_CRAFTING_INPUTS = 4;
export const BASIS_POINTS = 10_000;

export type MaterialDefinition = {
    id: string;
    rarity: number;
};

export type EquipmentDefinition = {
    id: string;
    slot: string;
    materialId: string;
    power: number;
};

export type MaterialCost = {
    materialId: string;
    quantity: number;
};

export type CraftingRecipe = {
    id: string;
    inputEquipmentIds: readonly string[];
    outputEquipmentId: string;
    successRateBps: number;
    materialCosts: readonly MaterialCost[];
};

export type EquipmentCraftingConfig = {
    schemaVersion: 1;
    materials: readonly MaterialDefinition[];
    equipment: readonly EquipmentDefinition[];
    recipes: readonly CraftingRecipe[];
};

const CONFIG_KEYS = new Set(['schemaVersion', 'materials', 'equipment', 'recipes']);
const MATERIAL_KEYS = new Set(['id', 'rarity']);
const EQUIPMENT_KEYS = new Set(['id', 'slot', 'materialId', 'power']);
const RECIPE_KEYS = new Set(['id', 'inputEquipmentIds', 'outputEquipmentId', 'successRateBps', 'materialCosts']);
const COST_KEYS = new Set(['materialId', 'quantity']);

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unknownKeys(value: Record<string, any>, allowed: ReadonlySet<string>, path: string): string[] {
    return Object.keys(value).filter((key) => !allowed.has(key)).map((key) => `${path}.${key} is not allowed`);
}

function isId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 96;
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

function validateNonNegativeInteger(value: unknown, path: string): string[] {
    return Number.isSafeInteger(value) && Number(value) >= 0 ? [] : [`${path} must be a non-negative integer`];
}

function validatePositiveInteger(value: unknown, path: string): string[] {
    return Number.isSafeInteger(value) && Number(value) > 0 ? [] : [`${path} must be a positive integer`];
}

/** Validate table shape and all equipment/material/recipe cross-table references. */
export function validateCraftingConfig(raw: unknown): string[] {
    if (!isRecord(raw)) return ['crafting config must be an object'];
    const errors = unknownKeys(raw, CONFIG_KEYS, 'config');
    if (raw.schemaVersion !== CRAFTING_SCHEMA_VERSION) errors.push('config.schemaVersion is unsupported');
    if (!Array.isArray(raw.materials) || raw.materials.length === 0) errors.push('config.materials must be a non-empty array');
    if (!Array.isArray(raw.equipment) || raw.equipment.length === 0) errors.push('config.equipment must be a non-empty array');
    if (!Array.isArray(raw.recipes) || raw.recipes.length === 0) errors.push('config.recipes must be a non-empty array');
    if (!Array.isArray(raw.materials) || !Array.isArray(raw.equipment) || !Array.isArray(raw.recipes)) return [...new Set(errors)];

    const materials = raw.materials as any[];
    const equipment = raw.equipment as any[];
    const recipes = raw.recipes as any[];
    errors.push(...duplicateIds(materials, 'material'), ...duplicateIds(equipment, 'equipment'), ...duplicateIds(recipes, 'recipe'));
    const materialIds = new Set<string>();
    for (let index = 0; index < materials.length; index += 1) {
        const material = materials[index];
        const path = `materials[${index}]`;
        if (!isRecord(material)) { errors.push(`${path} must be an object`); continue; }
        errors.push(...unknownKeys(material, MATERIAL_KEYS, path));
        if (!isId(material.id)) errors.push(`${path}.id is required`); else materialIds.add(material.id);
        errors.push(...validatePositiveInteger(material.rarity, `${path}.rarity`));
    }

    const equipmentIds = new Set<string>();
    for (let index = 0; index < equipment.length; index += 1) {
        const item = equipment[index];
        const path = `equipment[${index}]`;
        if (!isRecord(item)) { errors.push(`${path} must be an object`); continue; }
        errors.push(...unknownKeys(item, EQUIPMENT_KEYS, path));
        if (!isId(item.id)) errors.push(`${path}.id is required`); else equipmentIds.add(item.id);
        if (!isId(item.slot)) errors.push(`${path}.slot is required`);
        if (!isId(item.materialId)) errors.push(`${path}.materialId is required`);
        else if (!materialIds.has(item.materialId)) errors.push(`${item.id || path} references unknown material: ${item.materialId}`);
        errors.push(...validateNonNegativeInteger(item.power, `${path}.power`));
    }

    for (let index = 0; index < recipes.length; index += 1) {
        const recipe = recipes[index];
        const path = `recipes[${index}]`;
        if (!isRecord(recipe)) { errors.push(`${path} must be an object`); continue; }
        errors.push(...unknownKeys(recipe, RECIPE_KEYS, path));
        if (!isId(recipe.id)) errors.push(`${path}.id is required`);
        if (!Array.isArray(recipe.inputEquipmentIds)) errors.push(`${path}.inputEquipmentIds must be an array`);
        else {
            if (recipe.inputEquipmentIds.length < MIN_CRAFTING_INPUTS || recipe.inputEquipmentIds.length > MAX_CRAFTING_INPUTS) {
                errors.push(`${recipe.id || path}.inputEquipmentIds must contain 2 to 4 items`);
            }
            const seen = new Set<string>();
            for (const inputId of recipe.inputEquipmentIds) {
                if (!isId(inputId)) errors.push(`${recipe.id || path} has an invalid input equipment id`);
                else {
                    if (seen.has(inputId)) errors.push(`${recipe.id || path} has duplicate input equipment: ${inputId}`);
                    seen.add(inputId);
                    if (!equipmentIds.has(inputId)) errors.push(`${recipe.id || path} references unknown input equipment: ${inputId}`);
                }
            }
        }
        if (!isId(recipe.outputEquipmentId)) errors.push(`${path}.outputEquipmentId is required`);
        else if (!equipmentIds.has(recipe.outputEquipmentId)) errors.push(`${recipe.id || path} references unknown output equipment: ${recipe.outputEquipmentId}`);
        if (!Number.isSafeInteger(recipe.successRateBps) || recipe.successRateBps < 0 || recipe.successRateBps > BASIS_POINTS) {
            errors.push(`${recipe.id || path}.successRateBps must be an integer from 0 to ${BASIS_POINTS}`);
        }
        if (!Array.isArray(recipe.materialCosts)) errors.push(`${path}.materialCosts must be an array`);
        else {
            const seenCosts = new Set<string>();
            for (const cost of recipe.materialCosts) {
                if (!isRecord(cost)) { errors.push(`${recipe.id || path} material cost must be an object`); continue; }
                errors.push(...unknownKeys(cost, COST_KEYS, `${recipe.id || path}.materialCosts`));
                if (!isId(cost.materialId)) errors.push(`${recipe.id || path} has an invalid material cost id`);
                else {
                    if (seenCosts.has(cost.materialId)) errors.push(`${recipe.id || path} has duplicate material cost: ${cost.materialId}`);
                    seenCosts.add(cost.materialId);
                    if (!materialIds.has(cost.materialId)) errors.push(`${recipe.id || path} references unknown cost material: ${cost.materialId}`);
                }
                errors.push(...validatePositiveInteger(cost.quantity, `${recipe.id || path}.materialCosts.quantity`));
            }
        }
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

/** Return a stable JSON payload with table rows sorted by their semantic ids. */
export function serializeCraftingConfig(config: EquipmentCraftingConfig): string {
    return JSON.stringify(canonicalize(normalizeCraftingConfig(config)));
}

export function normalizeCraftingConfig(raw: unknown): EquipmentCraftingConfig {
    const errors = validateCraftingConfig(raw);
    if (errors.length > 0) throw new Error(`Invalid crafting config: ${errors.join('; ')}`);
    const config = raw as EquipmentCraftingConfig;
    return deepFreeze({
        schemaVersion: CRAFTING_SCHEMA_VERSION,
        materials: config.materials.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
        equipment: config.equipment.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
        recipes: config.recipes.map((recipe) => ({
            ...recipe,
            inputEquipmentIds: [...recipe.inputEquipmentIds].sort(),
            materialCosts: recipe.materialCosts.map((cost) => ({ ...cost })).sort((a, b) => a.materialId.localeCompare(b.materialId)),
        })).sort((a, b) => a.id.localeCompare(b.id)),
    });
}

export function loadCraftingConfig(raw: unknown): EquipmentCraftingConfig {
    return normalizeCraftingConfig(raw);
}

export function parseCraftingConfig(payload: string): EquipmentCraftingConfig {
    if (typeof payload !== 'string') throw new Error('Crafting config payload must be a string');
    try {
        return loadCraftingConfig(JSON.parse(payload));
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`Invalid crafting config JSON: ${error.message}`);
        throw error;
    }
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}
