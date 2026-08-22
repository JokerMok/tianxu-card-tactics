export const EXPEDITION_SCHEMA_VERSION = 1;
export const MIN_TEAM_SIZE = 2;
export const MAX_TEAM_SIZE = 4;

export type ExpeditionMaterial = {
    id: string;
};

export type ExpeditionUnit = {
    id: string;
    power: number;
};

export type ExpeditionRewardGrant = {
    materialId: string;
    quantity: number;
};

export type ExpeditionReward = {
    id: string;
    experience: number;
    silver: number;
    crystal: number;
    materials: readonly ExpeditionRewardGrant[];
};

export type ExpeditionDestination = {
    id: string;
    durationMs: number;
    staminaCost: number;
    requiredPower: number;
    minTeamSize: number;
    maxTeamSize: number;
    rewardId: string;
};

export type ExpeditionConfig = {
    schemaVersion: 1;
    materials: readonly ExpeditionMaterial[];
    units: readonly ExpeditionUnit[];
    rewards: readonly ExpeditionReward[];
    destinations: readonly ExpeditionDestination[];
};

const CONFIG_KEYS = new Set(['schemaVersion', 'materials', 'units', 'rewards', 'destinations']);
const MATERIAL_KEYS = new Set(['id']);
const UNIT_KEYS = new Set(['id', 'power']);
const REWARD_KEYS = new Set(['id', 'experience', 'silver', 'crystal', 'materials']);
const GRANT_KEYS = new Set(['materialId', 'quantity']);
const DESTINATION_KEYS = new Set(['id', 'durationMs', 'staminaCost', 'requiredPower', 'minTeamSize', 'maxTeamSize', 'rewardId']);

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function unknownKeys(value: Record<string, any>, allowed: ReadonlySet<string>, path: string): string[] {
    return Object.keys(value).filter((key) => !allowed.has(key)).map((key) => `${path}.${key} is not allowed`);
}

function isId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 96;
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

/** Validate table shape and every materials -> rewards -> destinations reference. */
export function validateExpeditionConfig(raw: unknown): string[] {
    if (!isRecord(raw)) return ['expedition config must be an object'];
    const errors = unknownKeys(raw, CONFIG_KEYS, 'config');
    if (raw.schemaVersion !== EXPEDITION_SCHEMA_VERSION) errors.push('config.schemaVersion is unsupported');
    for (const key of ['materials', 'units', 'rewards', 'destinations']) {
        if (!Array.isArray(raw[key]) || raw[key].length === 0) errors.push(`config.${key} must be a non-empty array`);
    }
    if (!Array.isArray(raw.materials) || !Array.isArray(raw.units) || !Array.isArray(raw.rewards) || !Array.isArray(raw.destinations)) {
        return [...new Set(errors)];
    }

    const materials = raw.materials as any[];
    const units = raw.units as any[];
    const rewards = raw.rewards as any[];
    const destinations = raw.destinations as any[];
    errors.push(
        ...duplicateIds(materials, 'material'),
        ...duplicateIds(units, 'unit'),
        ...duplicateIds(rewards, 'reward'),
        ...duplicateIds(destinations, 'destination'),
    );

    const materialIds = new Set<string>();
    for (let index = 0; index < materials.length; index += 1) {
        const material = materials[index];
        const path = `materials[${index}]`;
        if (!isRecord(material)) { errors.push(`${path} must be an object`); continue; }
        errors.push(...unknownKeys(material, MATERIAL_KEYS, path));
        if (!isId(material.id)) errors.push(`${path}.id is required`); else materialIds.add(material.id);
    }

    const unitIds = new Set<string>();
    for (let index = 0; index < units.length; index += 1) {
        const unit = units[index];
        const path = `units[${index}]`;
        if (!isRecord(unit)) { errors.push(`${path} must be an object`); continue; }
        errors.push(...unknownKeys(unit, UNIT_KEYS, path));
        if (!isId(unit.id)) errors.push(`${path}.id is required`); else unitIds.add(unit.id);
        errors.push(...validateSafeInteger(unit.power, `${path}.power`, 1));
    }

    const rewardIds = new Set<string>();
    for (let index = 0; index < rewards.length; index += 1) {
        const reward = rewards[index];
        const path = `rewards[${index}]`;
        if (!isRecord(reward)) { errors.push(`${path} must be an object`); continue; }
        errors.push(...unknownKeys(reward, REWARD_KEYS, path));
        if (!isId(reward.id)) errors.push(`${path}.id is required`); else rewardIds.add(reward.id);
        for (const key of ['experience', 'silver', 'crystal']) errors.push(...validateSafeInteger(reward[key], `${path}.${key}`, 0));
        if (!Array.isArray(reward.materials)) {
            errors.push(`${path}.materials must be an array`);
        } else {
            const seenMaterials = new Set<string>();
            for (let grantIndex = 0; grantIndex < reward.materials.length; grantIndex += 1) {
                const grant = reward.materials[grantIndex];
                const grantPath = `${path}.materials[${grantIndex}]`;
                if (!isRecord(grant)) { errors.push(`${grantPath} must be an object`); continue; }
                errors.push(...unknownKeys(grant, GRANT_KEYS, grantPath));
                if (!isId(grant.materialId)) errors.push(`${grantPath}.materialId is required`);
                else {
                    if (!materialIds.has(grant.materialId)) errors.push(`${path} references unknown material: ${grant.materialId}`);
                    if (seenMaterials.has(grant.materialId)) errors.push(`${path} has duplicate material grant: ${grant.materialId}`);
                    seenMaterials.add(grant.materialId);
                }
                errors.push(...validateSafeInteger(grant.quantity, `${grantPath}.quantity`, 1));
            }
        }
        if (reward.experience === 0 && reward.silver === 0 && reward.crystal === 0 && Array.isArray(reward.materials) && reward.materials.length === 0) {
            errors.push(`${path} must grant at least one reward`);
        }
    }

    for (let index = 0; index < destinations.length; index += 1) {
        const destination = destinations[index];
        const path = `destinations[${index}]`;
        if (!isRecord(destination)) { errors.push(`${path} must be an object`); continue; }
        errors.push(...unknownKeys(destination, DESTINATION_KEYS, path));
        if (!isId(destination.id)) errors.push(`${path}.id is required`);
        errors.push(...validateSafeInteger(destination.durationMs, `${path}.durationMs`, 1));
        errors.push(...validateSafeInteger(destination.staminaCost, `${path}.staminaCost`, 1));
        errors.push(...validateSafeInteger(destination.requiredPower, `${path}.requiredPower`, 0));
        errors.push(...validateSafeInteger(destination.minTeamSize, `${path}.minTeamSize`, MIN_TEAM_SIZE));
        errors.push(...validateSafeInteger(destination.maxTeamSize, `${path}.maxTeamSize`, MIN_TEAM_SIZE));
        if (Number.isSafeInteger(destination.minTeamSize) && Number.isSafeInteger(destination.maxTeamSize) && destination.maxTeamSize < destination.minTeamSize) {
            errors.push(`${path}.maxTeamSize must be >= minTeamSize`);
        }
        if (Number.isSafeInteger(destination.minTeamSize) && destination.minTeamSize > MAX_TEAM_SIZE) errors.push(`${path}.minTeamSize exceeds ${MAX_TEAM_SIZE}`);
        if (Number.isSafeInteger(destination.maxTeamSize) && destination.maxTeamSize > MAX_TEAM_SIZE) errors.push(`${path}.maxTeamSize exceeds ${MAX_TEAM_SIZE}`);
        if (!isId(destination.rewardId)) errors.push(`${path}.rewardId is required`);
        else if (!rewardIds.has(destination.rewardId)) errors.push(`${destination.id || path} references unknown reward: ${destination.rewardId}`);
    }
    return [...new Set(errors)];
}

function isObject(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!isObject(value)) return value;
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

export function normalizeExpeditionConfig(raw: unknown): ExpeditionConfig {
    const errors = validateExpeditionConfig(raw);
    if (errors.length > 0) throw new Error(`Invalid expedition config: ${errors.join('; ')}`);
    const config = raw as ExpeditionConfig;
    return deepFreeze({
        schemaVersion: EXPEDITION_SCHEMA_VERSION,
        materials: config.materials.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
        units: config.units.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
        rewards: config.rewards.map((item) => ({
            ...item,
            materials: item.materials.map((grant) => ({ ...grant })).sort((a, b) => a.materialId.localeCompare(b.materialId)),
        })).sort((a, b) => a.id.localeCompare(b.id)),
        destinations: config.destinations.map((item) => ({ ...item })).sort((a, b) => a.id.localeCompare(b.id)),
    });
}

export function loadExpeditionConfig(raw: unknown): ExpeditionConfig {
    return normalizeExpeditionConfig(raw);
}

export function parseExpeditionConfig(payload: string): ExpeditionConfig {
    if (typeof payload !== 'string') throw new Error('Expedition config payload must be a string');
    try {
        return loadExpeditionConfig(JSON.parse(payload));
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`Invalid expedition config JSON: ${error.message}`);
        throw error;
    }
}

export function serializeExpeditionConfig(config: ExpeditionConfig): string {
    return canonicalJson(normalizeExpeditionConfig(config));
}

export function canonicalJson(value: unknown): string {
    return JSON.stringify(canonicalize(value));
}
