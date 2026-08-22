import { CRAFTING_CONFIG } from './crafting-config';
import {
    BASIS_POINTS,
    canonicalJson,
    loadCraftingConfig,
    type EquipmentCraftingConfig,
    type CraftingRecipe,
} from './crafting-contract';

export type CraftingEquipmentInstance = {
    instanceId: string;
    equipmentId: string;
    locked: boolean;
};

export type CraftingServiceSnapshot = {
    schemaVersion: 1;
    seed: number;
    attempt: number;
    equipment: readonly CraftingEquipmentInstance[];
    materials: Readonly<Record<string, number>>;
    processedResults: readonly CraftingProcessedResult[];
};

export type CraftRequest = {
    requestId: string;
    recipeId: string;
    inputInstanceIds: readonly string[];
};

export type CraftFailureReason =
    | 'UNKNOWN_RECIPE'
    | 'INVALID_INPUT_COUNT'
    | 'DUPLICATE_INPUT'
    | 'UNKNOWN_INPUT'
    | 'INPUT_LOCKED'
    | 'INPUT_MISMATCH'
    | 'INSUFFICIENT_MATERIALS'
    | 'CRAFT_FAILED'
    | 'OUTPUT_ID_COLLISION';

export type CraftResult = {
    requestId: string;
    status: 'success' | 'failure';
    success: boolean;
    recipeId: string;
    attempt: number | null;
    roll: number | null;
    consumedInputIds: readonly string[];
    returnedInputIds: readonly string[];
    consumedMaterials: Readonly<Record<string, number>>;
    output: CraftingEquipmentInstance | null;
    reason: CraftFailureReason | null;
};

export type CraftingProcessedResult = {
    requestId: string;
    requestFingerprint: string;
    inputInstanceIds: readonly string[];
    result: CraftResult;
};

export type EquipmentCraftingServiceOptions = {
    config?: EquipmentCraftingConfig;
    seed?: number;
    attempt?: number;
    inventory?: readonly CraftingEquipmentInstance[];
    materials?: Readonly<Record<string, number>>;
    processedResults?: readonly CraftingProcessedResult[];
};

function assertFiniteInteger(value: unknown, label: string, min = 0): number {
    if (!Number.isSafeInteger(value) || Number(value) < min) throw new Error(`${label} must be a safe integer >= ${min}`);
    return Number(value);
}

function normalizeSeed(value: unknown): number {
    if (!Number.isSafeInteger(value)) throw new Error('seed must be a safe integer');
    return Number(value) >>> 0;
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertExactKeys(value: Record<string, any>, allowed: ReadonlySet<string>, label: string): void {
    const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
    if (unexpected.length > 0) throw new Error(`${label} has unexpected keys: ${unexpected.join(', ')}`);
}

function isRequestId(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 96;
}

const SNAPSHOT_KEYS = new Set(['schemaVersion', 'seed', 'attempt', 'equipment', 'materials', 'processedResults']);
const INSTANCE_KEYS = new Set(['instanceId', 'equipmentId', 'locked']);
const RESULT_KEYS = new Set(['requestId', 'status', 'success', 'recipeId', 'attempt', 'roll', 'consumedInputIds', 'returnedInputIds', 'consumedMaterials', 'output', 'reason']);
const PROCESSED_RESULT_KEYS = new Set(['requestId', 'requestFingerprint', 'inputInstanceIds', 'result']);
const FAILURE_REASONS = new Set<CraftFailureReason>([
    'UNKNOWN_RECIPE', 'INVALID_INPUT_COUNT', 'DUPLICATE_INPUT', 'UNKNOWN_INPUT', 'INPUT_LOCKED',
    'INPUT_MISMATCH', 'INSUFFICIENT_MATERIALS', 'CRAFT_FAILED', 'OUTPUT_ID_COLLISION',
]);

function sortedUnique(values: readonly string[]): string[] {
    return [...values].sort();
}

function sortedInputIds(values: readonly string[]): string[] {
    return [...values].sort();
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
    const a = sortedUnique(left);
    const b = sortedUnique(right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function sameInputIds(left: readonly string[], right: readonly string[]): boolean {
    const a = sortedInputIds(left);
    const b = sortedInputIds(right);
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function stableHash(value: string): number {
    let hash = 2_166_136_261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16_777_619);
    }
    return hash >>> 0;
}

function cloneInstance(item: CraftingEquipmentInstance): CraftingEquipmentInstance {
    return { instanceId: item.instanceId, equipmentId: item.equipmentId, locked: item.locked };
}

function cloneResult(result: CraftResult): CraftResult {
    return {
        ...result,
        consumedInputIds: [...result.consumedInputIds],
        returnedInputIds: [...result.returnedInputIds],
        consumedMaterials: cloneMaterials(result.consumedMaterials),
        output: result.output ? cloneInstance(result.output) : null,
    };
}

function cloneProcessedResult(processed: CraftingProcessedResult): CraftingProcessedResult {
    return {
        requestId: processed.requestId,
        requestFingerprint: processed.requestFingerprint,
        inputInstanceIds: [...processed.inputInstanceIds],
        result: cloneResult(processed.result),
    };
}

function cloneMaterials(materials: Readonly<Record<string, number>>): Record<string, number> {
    return Object.keys(materials).sort().reduce((result, key) => {
        result[key] = materials[key];
        return result;
    }, {} as Record<string, number>);
}

function validateSnapshot(snapshot: unknown, config: EquipmentCraftingConfig): CraftingServiceSnapshot {
    if (!isRecord(snapshot)) throw new Error('crafting snapshot must be an object');
    const value = snapshot as Record<string, any>;
    assertExactKeys(value, SNAPSHOT_KEYS, 'crafting snapshot');
    if (value.schemaVersion !== 1) throw new Error('crafting snapshot schemaVersion is unsupported');
    const seed = normalizeSeed(value.seed);
    const attempt = assertFiniteInteger(value.attempt, 'attempt');
    if (!Array.isArray(value.equipment)) throw new Error('crafting snapshot equipment must be an array');
    const equipmentIds = new Set(config.equipment.map((item) => item.id));
    const seen = new Set<string>();
    const equipment = value.equipment.map((item: any) => {
        if (!isRecord(item)) throw new Error('crafting equipment instance must be an object');
        assertExactKeys(item, INSTANCE_KEYS, 'crafting equipment instance');
        if (typeof item.instanceId !== 'string' || item.instanceId.length === 0) throw new Error('equipment instanceId is required');
        if (seen.has(item.instanceId)) throw new Error(`duplicate equipment instanceId: ${item.instanceId}`);
        seen.add(item.instanceId);
        if (!equipmentIds.has(item.equipmentId)) throw new Error(`unknown equipment instance type: ${item.equipmentId}`);
        if (typeof item.locked !== 'boolean') throw new Error(`equipment ${item.instanceId}.locked must be boolean`);
        return cloneInstance(item);
    });
    if (!value.materials || typeof value.materials !== 'object' || Array.isArray(value.materials)) throw new Error('crafting snapshot materials must be an object');
    const materialIds = new Set(config.materials.map((item) => item.id));
    const materials: Record<string, number> = {};
    for (const [materialId, quantity] of Object.entries(value.materials)) {
        if (!materialIds.has(materialId)) throw new Error(`unknown material balance: ${materialId}`);
        materials[materialId] = assertFiniteInteger(quantity, `materials.${materialId}`);
    }
    const processedResults = validateProcessedResults(value.processedResults ?? [], config);
    return { schemaVersion: 1, seed, attempt, equipment, materials: cloneMaterials(materials), processedResults };
}

function validateProcessedResults(raw: unknown, config: EquipmentCraftingConfig): CraftingProcessedResult[] {
    if (!Array.isArray(raw)) throw new Error('crafting snapshot processedResults must be an array');
    const requestIds = new Set<string>();
    return raw.map((item: any) => {
        if (!isRecord(item)) throw new Error('crafting processed result must be an object');
        assertExactKeys(item, PROCESSED_RESULT_KEYS, 'crafting processed result');
        if (!isRequestId(item.requestId)) throw new Error('crafting processed result requestId is required');
        if (requestIds.has(item.requestId)) throw new Error(`duplicate processed requestId: ${item.requestId}`);
        requestIds.add(item.requestId);
        if (typeof item.requestFingerprint !== 'string' || item.requestFingerprint.length === 0) throw new Error(`processed request ${item.requestId} fingerprint is required`);
        if (!Array.isArray(item.inputInstanceIds) || item.inputInstanceIds.some((value: unknown) => typeof value !== 'string')) {
            throw new Error(`processed request ${item.requestId} inputInstanceIds is invalid`);
        }
        const inputInstanceIds = sortedInputIds(item.inputInstanceIds);
        const result = validateResult(item.result, config);
        if (result.requestId !== item.requestId) throw new Error(`processed request ${item.requestId} result requestId mismatch`);
        const expectedFingerprint = craftRequestFingerprint({
            requestId: item.requestId,
            recipeId: result.recipeId,
            inputInstanceIds,
        });
        if (item.requestFingerprint !== expectedFingerprint) throw new Error(`processed request ${item.requestId} fingerprint mismatch`);
        if (result.status === 'success') {
            if (new Set(inputInstanceIds).size !== inputInstanceIds.length) {
                throw new Error(`processed request ${item.requestId} successful result inputInstanceIds must be unique`);
            }
            if (!sameInputIds(result.consumedInputIds, inputInstanceIds)) {
                throw new Error(`processed request ${item.requestId} successful result input mismatch`);
            }
        }
        return { requestId: item.requestId, requestFingerprint: item.requestFingerprint, inputInstanceIds, result };
    });
}

function validateResult(raw: unknown, config: EquipmentCraftingConfig): CraftResult {
    if (!isRecord(raw)) throw new Error('crafting result must be an object');
    assertExactKeys(raw, RESULT_KEYS, 'crafting result');
    if (!isRequestId(raw.requestId)) throw new Error('crafting result requestId is required');
    if (raw.status !== 'success' && raw.status !== 'failure') throw new Error('crafting result status is invalid');
    if (typeof raw.success !== 'boolean' || raw.success !== (raw.status === 'success')) throw new Error('crafting result success is inconsistent');
    if (typeof raw.recipeId !== 'string') throw new Error('crafting result recipeId is required');
    if (raw.attempt !== null && (!Number.isSafeInteger(raw.attempt) || raw.attempt < 0)) throw new Error('crafting result attempt is invalid');
    if (raw.roll !== null && (!Number.isSafeInteger(raw.roll) || raw.roll < 0 || raw.roll >= BASIS_POINTS)) throw new Error('crafting result roll is invalid');
    for (const [label, values] of [['consumedInputIds', raw.consumedInputIds], ['returnedInputIds', raw.returnedInputIds]] as const) {
        if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) throw new Error(`crafting result ${label} is invalid`);
    }
    if (!isRecord(raw.consumedMaterials)) throw new Error('crafting result consumedMaterials is invalid');
    const materialIds = new Set(config.materials.map((item) => item.id));
    const consumedMaterials: Record<string, number> = {};
    for (const [materialId, quantity] of Object.entries(raw.consumedMaterials)) {
        if (!materialIds.has(materialId)) throw new Error(`unknown consumed material: ${materialId}`);
        consumedMaterials[materialId] = assertFiniteInteger(quantity, `consumedMaterials.${materialId}`);
    }
    if (raw.reason !== null && !FAILURE_REASONS.has(raw.reason)) throw new Error('crafting result reason is invalid');
    let output: CraftingEquipmentInstance | null = null;
    if (raw.output !== null) {
        if (!isRecord(raw.output)) throw new Error('crafting result output is invalid');
        assertExactKeys(raw.output, INSTANCE_KEYS, 'crafting result output');
        if (typeof raw.output.instanceId !== 'string' || raw.output.instanceId.length === 0) throw new Error('crafting result output instanceId is required');
        if (!new Set(config.equipment.map((item) => item.id)).has(raw.output.equipmentId)) throw new Error(`unknown crafting result output type: ${raw.output.equipmentId}`);
        if (typeof raw.output.locked !== 'boolean') throw new Error('crafting result output locked must be boolean');
        output = cloneInstance(raw.output);
    }
    return {
        requestId: raw.requestId,
        status: raw.status,
        success: raw.success,
        recipeId: raw.recipeId,
        attempt: raw.attempt,
        roll: raw.roll,
        consumedInputIds: [...raw.consumedInputIds],
        returnedInputIds: [...raw.returnedInputIds],
        consumedMaterials: cloneMaterials(consumedMaterials),
        output,
        reason: raw.reason,
    };
}

/** Canonical request identity; input order is presentation-only. */
export function craftRequestFingerprint(request: Pick<CraftRequest, 'requestId' | 'recipeId' | 'inputInstanceIds'>): string {
    return canonicalJson({
        requestId: request.requestId,
        recipeId: request.recipeId,
        inputInstanceIds: sortedInputIds(request.inputInstanceIds),
    });
}

export function serializeCraftingSnapshot(snapshot: CraftingServiceSnapshot): string {
    return canonicalJson(snapshot);
}

export class EquipmentCraftingService {
    private readonly config: EquipmentCraftingConfig;
    private readonly seed: number;
    private attempt: number;
    private readonly equipment = new Map<string, CraftingEquipmentInstance>();
    private readonly materials = new Map<string, number>();
    private readonly processedResults = new Map<string, CraftingProcessedResult>();

    public constructor(options: EquipmentCraftingServiceOptions = {}) {
        this.config = loadCraftingConfig(options.config ?? CRAFTING_CONFIG);
        this.seed = normalizeSeed(options.seed ?? 0);
        this.attempt = assertFiniteInteger(options.attempt ?? 0, 'attempt');
        const initial = validateSnapshot({
            schemaVersion: 1,
            seed: this.seed,
            attempt: this.attempt,
            equipment: options.inventory ?? [],
            materials: options.materials ?? {},
            processedResults: options.processedResults ?? [],
        }, this.config);
        for (const item of initial.equipment) this.equipment.set(item.instanceId, item);
        for (const [materialId, quantity] of Object.entries(initial.materials)) this.materials.set(materialId, quantity);
        for (const processed of initial.processedResults) this.processedResults.set(processed.requestId, processed);
    }

    public static fromSnapshot(snapshot: CraftingServiceSnapshot, config: EquipmentCraftingConfig = CRAFTING_CONFIG): EquipmentCraftingService {
        const checked = validateSnapshot(snapshot, loadCraftingConfig(config));
        return new EquipmentCraftingService({
            config,
            seed: checked.seed,
            attempt: checked.attempt,
            inventory: checked.equipment,
            materials: checked.materials,
            processedResults: checked.processedResults,
        });
    }

    public getConfig(): EquipmentCraftingConfig { return this.config; }

    public getInventory(): readonly CraftingEquipmentInstance[] {
        return this.snapshot().equipment;
    }

    public getMaterialBalance(materialId: string): number { return this.materials.get(materialId) ?? 0; }

    public snapshot(): CraftingServiceSnapshot {
        return {
            schemaVersion: 1,
            seed: this.seed,
            attempt: this.attempt,
            equipment: [...this.equipment.values()].sort((a, b) => a.instanceId.localeCompare(b.instanceId)).map(cloneInstance),
            materials: cloneMaterials(Object.fromEntries(this.materials)),
            processedResults: [...this.processedResults.values()]
                .sort((a, b) => a.requestId.localeCompare(b.requestId))
                .map(cloneProcessedResult),
        };
    }

    public serialize(): string { return serializeCraftingSnapshot(this.snapshot()); }

    public craft(request: CraftRequest): CraftResult {
        if (!isRequestId(request?.requestId)) throw new Error('craft requestId is required');
        const requestId = request.requestId;
        const inputIds = Array.isArray(request?.inputInstanceIds) ? [...request.inputInstanceIds] : [];
        const recipeId = typeof request?.recipeId === 'string' ? request.recipeId : '';
        const requestFingerprint = craftRequestFingerprint({ requestId, recipeId, inputInstanceIds: inputIds });
        const processed = this.processedResults.get(requestId);
        if (processed) {
            if (
                processed.requestId !== requestId
                || processed.result.requestId !== requestId
                || processed.requestFingerprint !== requestFingerprint
                || !sameInputIds(processed.inputInstanceIds, inputIds)
            ) {
                throw new Error(`requestId ${requestId} was reused with a different request`);
            }
            return cloneResult(processed.result);
        }

        const recipe = this.config.recipes.find((candidate) => candidate.id === recipeId);
        if (!recipe) return this.process(requestId, requestFingerprint, inputIds, this.failure(requestId, recipeId, 'UNKNOWN_RECIPE', inputIds));
        if (inputIds.length < 2 || inputIds.length > 4) return this.process(requestId, requestFingerprint, inputIds, this.failure(requestId, recipe.id, 'INVALID_INPUT_COUNT', inputIds));
        if (new Set(inputIds).size !== inputIds.length) return this.process(requestId, requestFingerprint, inputIds, this.failure(requestId, recipe.id, 'DUPLICATE_INPUT', inputIds));

        const selected = inputIds.map((instanceId) => this.equipment.get(instanceId));
        if (selected.some((item) => !item)) return this.process(requestId, requestFingerprint, inputIds, this.failure(requestId, recipe.id, 'UNKNOWN_INPUT', inputIds));
        const selectedItems = selected as CraftingEquipmentInstance[];
        if (selectedItems.some((item) => item.locked)) return this.process(requestId, requestFingerprint, inputIds, this.failure(requestId, recipe.id, 'INPUT_LOCKED', inputIds));
        if (!sameIds(selectedItems.map((item) => item.equipmentId), recipe.inputEquipmentIds)) return this.process(requestId, requestFingerprint, inputIds, this.failure(requestId, recipe.id, 'INPUT_MISMATCH', inputIds));
        for (const cost of recipe.materialCosts) {
            if ((this.materials.get(cost.materialId) ?? 0) < cost.quantity) return this.process(requestId, requestFingerprint, inputIds, this.failure(requestId, recipe.id, 'INSUFFICIENT_MATERIALS', inputIds));
        }

        const attempt = this.attempt;
        if (!Number.isSafeInteger(attempt + 1)) throw new Error('attempt cannot advance beyond a safe integer');
        this.attempt += 1;
        const roll = stableHash(`${this.seed}|${attempt}|${recipe.id}|${sortedUnique(inputIds).join(',')}`) % BASIS_POINTS;
        for (const item of selectedItems) item.locked = true;
        const outputInstanceId = `crafted:${attempt}:${recipe.id}`;
        if (this.equipment.has(outputInstanceId)) {
            for (const item of selectedItems) item.locked = false;
            return this.process(requestId, requestFingerprint, inputIds, this.failure(requestId, recipe.id, 'OUTPUT_ID_COLLISION', inputIds, attempt, roll));
        }
        const success = roll < recipe.successRateBps;
        if (!success) {
            for (const item of selectedItems) item.locked = false;
            return this.process(requestId, requestFingerprint, inputIds, {
                requestId, status: 'failure', success: false, recipeId: recipe.id, attempt, roll,
                consumedInputIds: [], returnedInputIds: sortedUnique(inputIds), consumedMaterials: {}, output: null,
                reason: 'CRAFT_FAILED',
            });
        }

        for (const item of selectedItems) this.equipment.delete(item.instanceId);
        const consumedMaterials: Record<string, number> = {};
        for (const cost of recipe.materialCosts) {
            this.materials.set(cost.materialId, (this.materials.get(cost.materialId) ?? 0) - cost.quantity);
            consumedMaterials[cost.materialId] = cost.quantity;
        }
        const output = { instanceId: outputInstanceId, equipmentId: recipe.outputEquipmentId, locked: false };
        this.equipment.set(output.instanceId, output);
        return this.process(requestId, requestFingerprint, inputIds, {
            requestId, status: 'success', success: true, recipeId: recipe.id, attempt, roll,
            consumedInputIds: sortedUnique(inputIds), returnedInputIds: [], consumedMaterials: cloneMaterials(consumedMaterials), output: cloneInstance(output), reason: null,
        });
    }

    private process(requestId: string, requestFingerprint: string, inputInstanceIds: readonly string[], result: CraftResult): CraftResult {
        const stored = { requestId, requestFingerprint, inputInstanceIds: sortedInputIds(inputInstanceIds), result: cloneResult(result) };
        this.processedResults.set(requestId, stored);
        return cloneResult(stored.result);
    }

    private failure(requestId: string, recipeId: string, reason: CraftFailureReason, inputIds: readonly string[], attempt: number | null = null, roll: number | null = null): CraftResult {
        const knownUnlocked = sortedUnique(inputIds.filter((id) => this.equipment.get(id) && !this.equipment.get(id)?.locked));
        return {
            requestId, status: 'failure', success: false, recipeId, attempt, roll, consumedInputIds: [], returnedInputIds: knownUnlocked,
            consumedMaterials: {}, output: null, reason,
        };
    }
}

export function restoreCraftingService(snapshot: CraftingServiceSnapshot, config: EquipmentCraftingConfig = CRAFTING_CONFIG): EquipmentCraftingService {
    return EquipmentCraftingService.fromSnapshot(snapshot, config);
}

export function recipeById(config: EquipmentCraftingConfig, recipeId: string): CraftingRecipe | undefined {
    return config.recipes.find((recipe) => recipe.id === recipeId);
}
