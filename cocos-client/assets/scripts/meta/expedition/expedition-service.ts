import { EXPEDITION_CONFIG } from './expedition-config';
import {
    canonicalJson,
    loadExpeditionConfig,
    type ExpeditionConfig,
    type ExpeditionDestination,
    type ExpeditionReward,
} from './expedition-contract';

export type ExpeditionResources = {
    stamina: number;
    experience: number;
    silver: number;
    crystal: number;
    materials: Readonly<Record<string, number>>;
};

export type ExpeditionRecord = {
    id: string;
    destinationId: string;
    rewardId: string;
    unitIds: readonly string[];
    dispatchedAt: number;
    endsAt: number;
    status: 'active' | 'ready';
};

export type ExpeditionServiceSnapshot = {
    schemaVersion: 1;
    nextExpeditionNumber: number;
    resources: ExpeditionResources;
    expedition: ExpeditionRecord | null;
    claimedExpeditionIds: readonly string[];
};

export type ExpeditionServiceOptions = {
    config?: ExpeditionConfig;
    snapshot?: ExpeditionServiceSnapshot;
    resources?: Partial<ExpeditionResources>;
    nextExpeditionNumber?: number;
};

export type ExpeditionFailureReason =
    | 'INVALID_REQUEST'
    | 'INVALID_TIMESTAMP'
    | 'UNKNOWN_DESTINATION'
    | 'EXPEDITION_IN_PROGRESS'
    | 'INVALID_TEAM'
    | 'TEAM_TOO_SMALL'
    | 'TEAM_TOO_LARGE'
    | 'DUPLICATE_UNIT'
    | 'UNKNOWN_UNIT'
    | 'UNIT_LOCKED'
    | 'INSUFFICIENT_POWER'
    | 'INSUFFICIENT_STAMINA'
    | 'TIME_OVERFLOW'
    | 'EXPEDITION_ID_OVERFLOW'
    | 'NO_EXPEDITION'
    | 'NOT_READY'
    | 'EXPEDITION_MISMATCH'
    | 'ALREADY_CLAIMED'
    | 'REWARD_OVERFLOW';

export type ExpeditionDispatchResult = {
    status: 'success' | 'failure';
    success: boolean;
    expeditionId: string | null;
    reason: ExpeditionFailureReason | null;
    endsAt: number | null;
};

export type ExpeditionSettlementResult = {
    status: 'success' | 'failure';
    success: boolean;
    expeditionId: string | null;
    reason: ExpeditionFailureReason | null;
    ready: boolean;
};

export type ExpeditionClaimResult = {
    status: 'success' | 'failure';
    success: boolean;
    expeditionId: string | null;
    reason: ExpeditionFailureReason | null;
    reward: ExpeditionReward | null;
    resources: ExpeditionResources;
};

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isSafeInteger(value: unknown, min = 0): value is number {
    return Number.isSafeInteger(value) && Number(value) >= min;
}

function validTimestamp(value: unknown): value is number {
    return isSafeInteger(value);
}

function cloneResources(resources: ExpeditionResources): ExpeditionResources {
    return {
        stamina: resources.stamina,
        experience: resources.experience,
        silver: resources.silver,
        crystal: resources.crystal,
        materials: Object.keys(resources.materials).sort().reduce((result, key) => {
            result[key] = resources.materials[key];
            return result;
        }, {} as Record<string, number>),
    };
}

function emptyResources(config: ExpeditionConfig): ExpeditionResources {
    return {
        stamina: 0,
        experience: 0,
        silver: 0,
        crystal: 0,
        materials: Object.fromEntries(config.materials.map((material) => [material.id, 0])),
    };
}

function cloneRecord(record: ExpeditionRecord | null): ExpeditionRecord | null {
    return record === null ? null : { ...record, unitIds: [...record.unitIds] };
}

function failureReason(reason: ExpeditionFailureReason): { status: 'failure'; success: false; reason: ExpeditionFailureReason } {
    return { status: 'failure', success: false, reason };
}

function expeditionId(number: number): string {
    return `expedition-${number}`;
}

function expeditionNumber(id: unknown): number | null {
    if (typeof id !== 'string' || !/^expedition-[1-9]\d*$/.test(id)) return null;
    const number = Number(id.slice('expedition-'.length));
    return Number.isSafeInteger(number) && expeditionId(number) === id ? number : null;
}

function validateResources(raw: unknown, config: ExpeditionConfig): ExpeditionResources {
    if (!isRecord(raw)) throw new Error('expedition resources must be an object');
    const expected = ['stamina', 'experience', 'silver', 'crystal', 'materials'];
    if (Object.keys(raw).some((key) => !expected.includes(key))) throw new Error('expedition resources contain unknown keys');
    for (const key of ['stamina', 'experience', 'silver', 'crystal']) {
        if (!isSafeInteger(raw[key])) throw new Error(`resources.${key} must be a safe integer >= 0`);
    }
    if (!isRecord(raw.materials)) throw new Error('resources.materials must be an object');
    const materialIds = new Set(config.materials.map((material) => material.id));
    for (const [materialId, quantity] of Object.entries(raw.materials)) {
        if (!materialIds.has(materialId)) throw new Error(`resources reference unknown material: ${materialId}`);
        if (!isSafeInteger(quantity)) throw new Error(`resources.materials.${materialId} must be a safe integer >= 0`);
    }
    const materials = Object.fromEntries(config.materials.map((material) => [material.id, raw.materials[material.id] ?? 0]));
    return { stamina: raw.stamina, experience: raw.experience, silver: raw.silver, crystal: raw.crystal, materials };
}

function validateSnapshot(raw: unknown, config: ExpeditionConfig): ExpeditionServiceSnapshot {
    if (!isRecord(raw)) throw new Error('expedition snapshot must be an object');
    const expected = ['schemaVersion', 'nextExpeditionNumber', 'resources', 'expedition', 'claimedExpeditionIds'];
    if (Object.keys(raw).some((key) => !expected.includes(key))) throw new Error('expedition snapshot contains unknown keys');
    if (raw.schemaVersion !== 1) throw new Error('expedition snapshot schemaVersion is unsupported');
    if (!isSafeInteger(raw.nextExpeditionNumber, 1)) throw new Error('nextExpeditionNumber must be a safe integer >= 1');
    const resources = validateResources(raw.resources, config);
    if (!Array.isArray(raw.claimedExpeditionIds) || raw.claimedExpeditionIds.some((id) => expeditionNumber(id) === null)) {
        throw new Error('claimedExpeditionIds must contain canonical expedition IDs');
    }
    const claimed = [...raw.claimedExpeditionIds].sort();
    if (new Set(claimed).size !== claimed.length) throw new Error('claimedExpeditionIds must be unique');
    const usedIds = new Set(claimed);
    for (const id of claimed) {
        const number = expeditionNumber(id);
        if (number !== null && number > raw.nextExpeditionNumber) {
            throw new Error('claimed expedition ID is ahead of nextExpeditionNumber');
        }
    }
    let expedition: ExpeditionRecord | null = null;
    if (raw.expedition !== null) {
        if (!isRecord(raw.expedition)) throw new Error('expedition must be an object or null');
        const value = raw.expedition;
        const expectedRecord = ['id', 'destinationId', 'rewardId', 'unitIds', 'dispatchedAt', 'endsAt', 'status'];
        if (Object.keys(value).some((key) => !expectedRecord.includes(key))) throw new Error('expedition record contains unknown keys');
        const activeNumber = expeditionNumber(value.id);
        if (activeNumber === null || claimed.includes(value.id)) throw new Error('active expedition id is invalid or already claimed');
        if (activeNumber > raw.nextExpeditionNumber) throw new Error('active expedition ID is ahead of nextExpeditionNumber');
        usedIds.add(value.id);
        const destination = config.destinations.find((item) => item.id === value.destinationId);
        if (!destination) throw new Error(`expedition references unknown destination: ${value.destinationId}`);
        if (value.rewardId !== destination.rewardId) throw new Error('expedition reward does not match destination');
        if (!Array.isArray(value.unitIds) || value.unitIds.some((id: unknown) => typeof id !== 'string')) throw new Error('expedition.unitIds must be an array of strings');
        const unitIds = [...value.unitIds].sort();
        if (new Set(unitIds).size !== unitIds.length) throw new Error('expedition.unitIds must be unique');
        if (unitIds.length < destination.minTeamSize || unitIds.length > destination.maxTeamSize) throw new Error('expedition team size is outside destination bounds');
        const unitPower = new Map(config.units.map((unit) => [unit.id, unit.power]));
        if (unitIds.some((id) => !unitPower.has(id))) throw new Error('expedition references unknown unit');
        if (unitIds.reduce((sum, id) => sum + (unitPower.get(id) ?? 0), 0) < destination.requiredPower) throw new Error('expedition team power is below destination requirement');
        if (!isSafeInteger(value.dispatchedAt) || !isSafeInteger(value.endsAt, 1) || value.endsAt <= value.dispatchedAt) throw new Error('expedition timestamps are invalid');
        if (value.endsAt !== value.dispatchedAt + destination.durationMs) throw new Error('expedition end time does not match destination duration');
        if (value.status !== 'active' && value.status !== 'ready') throw new Error('expedition status is invalid');
        expedition = { id: value.id, destinationId: destination.id, rewardId: value.rewardId, unitIds, dispatchedAt: value.dispatchedAt, endsAt: value.endsAt, status: value.status };
    }
    if (expedition !== null && usedIds.size !== claimed.length + 1) throw new Error('expedition IDs must be unique');
    return { schemaVersion: 1, nextExpeditionNumber: raw.nextExpeditionNumber, resources, expedition, claimedExpeditionIds: claimed };
}

export function serializeExpeditionSnapshot(snapshot: ExpeditionServiceSnapshot): string {
    return canonicalJson(snapshot);
}

export function restoreExpeditionService(snapshot: ExpeditionServiceSnapshot, config: ExpeditionConfig = EXPEDITION_CONFIG): ExpeditionService {
    return new ExpeditionService({ config, snapshot });
}

export class ExpeditionService {
    private readonly config: ExpeditionConfig;
    private nextExpeditionNumber: number;
    private resources: ExpeditionResources;
    private expedition: ExpeditionRecord | null;
    private claimedExpeditionIds: string[];

    public constructor(options: ExpeditionServiceOptions = {}) {
        this.config = loadExpeditionConfig(options.config ?? EXPEDITION_CONFIG);
        if (options.snapshot !== undefined) {
            const checked = validateSnapshot(options.snapshot, this.config);
            this.nextExpeditionNumber = checked.nextExpeditionNumber;
            this.resources = cloneResources(checked.resources);
            this.expedition = cloneRecord(checked.expedition);
            this.claimedExpeditionIds = [...checked.claimedExpeditionIds];
            return;
        }
        const defaults = emptyResources(this.config);
        const provided = options.resources ?? {};
        this.resources = validateResources({ ...defaults, ...provided, materials: { ...defaults.materials, ...(provided.materials ?? {}) } }, this.config);
        this.nextExpeditionNumber = options.nextExpeditionNumber ?? 1;
        if (!isSafeInteger(this.nextExpeditionNumber, 1)) throw new Error('nextExpeditionNumber must be a safe integer >= 1');
        this.expedition = null;
        this.claimedExpeditionIds = [];
    }

    public static fromSnapshot(snapshot: ExpeditionServiceSnapshot, config: ExpeditionConfig = EXPEDITION_CONFIG): ExpeditionService {
        return restoreExpeditionService(snapshot, config);
    }

    public getConfig(): ExpeditionConfig { return this.config; }

    public getResources(): ExpeditionResources { return cloneResources(this.resources); }

    public getExpedition(): ExpeditionRecord | null { return cloneRecord(this.expedition); }

    public getLockedUnitIds(): readonly string[] {
        return this.expedition === null ? [] : [...this.expedition.unitIds];
    }

    public isUnitLocked(unitId: string): boolean {
        return this.expedition?.unitIds.includes(unitId) ?? false;
    }

    public snapshot(): ExpeditionServiceSnapshot {
        return {
            schemaVersion: 1,
            nextExpeditionNumber: this.nextExpeditionNumber,
            resources: cloneResources(this.resources),
            expedition: cloneRecord(this.expedition),
            claimedExpeditionIds: [...this.claimedExpeditionIds].sort(),
        };
    }

    public serialize(): string { return serializeExpeditionSnapshot(this.snapshot()); }

    public dispatch(destinationId: string, unitIds: readonly string[], timestamp: number): ExpeditionDispatchResult {
        const destination = this.config.destinations.find((item) => item.id === destinationId);
        if (!destination) return { ...failureReason('UNKNOWN_DESTINATION'), expeditionId: null, endsAt: null };
        if (this.expedition !== null) return { ...failureReason('EXPEDITION_IN_PROGRESS'), expeditionId: null, endsAt: null };
        if (!validTimestamp(timestamp)) return { ...failureReason('INVALID_TIMESTAMP'), expeditionId: null, endsAt: null };
        if (!Array.isArray(unitIds)) return { ...failureReason('INVALID_TEAM'), expeditionId: null, endsAt: null };
        if (unitIds.length < destination.minTeamSize) return { ...failureReason('TEAM_TOO_SMALL'), expeditionId: null, endsAt: null };
        if (unitIds.length > destination.maxTeamSize) return { ...failureReason('TEAM_TOO_LARGE'), expeditionId: null, endsAt: null };
        if (new Set(unitIds).size !== unitIds.length) return { ...failureReason('DUPLICATE_UNIT'), expeditionId: null, endsAt: null };

        const units = unitIds.map((unitId) => this.config.units.find((unit) => unit.id === unitId));
        if (units.some((unit) => !unit)) return { ...failureReason('UNKNOWN_UNIT'), expeditionId: null, endsAt: null };
        const power = units.reduce((sum, unit) => sum + (unit?.power ?? 0), 0);
        if (power < destination.requiredPower) return { ...failureReason('INSUFFICIENT_POWER'), expeditionId: null, endsAt: null };
        if (this.resources.stamina < destination.staminaCost) return { ...failureReason('INSUFFICIENT_STAMINA'), expeditionId: null, endsAt: null };
        if (timestamp > Number.MAX_SAFE_INTEGER - destination.durationMs) return { ...failureReason('TIME_OVERFLOW'), expeditionId: null, endsAt: null };

        const usedIds = new Set(this.claimedExpeditionIds);
        if (this.expedition !== null) usedIds.add(this.expedition.id);
        let candidate = this.nextExpeditionNumber;
        while (candidate < Number.MAX_SAFE_INTEGER && usedIds.has(expeditionId(candidate))) candidate += 1;
        if (candidate >= Number.MAX_SAFE_INTEGER) return { ...failureReason('EXPEDITION_ID_OVERFLOW'), expeditionId: null, endsAt: null };

        const id = expeditionId(candidate);
        const record: ExpeditionRecord = {
            id,
            destinationId: destination.id,
            rewardId: destination.rewardId,
            unitIds: [...unitIds].sort(),
            dispatchedAt: timestamp,
            endsAt: timestamp + destination.durationMs,
            status: 'active',
        };
        this.resources = { ...this.resources, stamina: this.resources.stamina - destination.staminaCost, materials: { ...this.resources.materials } };
        this.expedition = record;
        this.nextExpeditionNumber = candidate + 1;
        return { status: 'success', success: true, expeditionId: id, reason: null, endsAt: record.endsAt };
    }

    public settle(timestamp: number): ExpeditionSettlementResult {
        if (!validTimestamp(timestamp)) return { ...failureReason('INVALID_TIMESTAMP'), expeditionId: null, ready: false };
        if (this.expedition === null) return { ...failureReason('NO_EXPEDITION'), expeditionId: null, ready: false };
        if (this.expedition.status === 'ready') return { status: 'success', success: true, expeditionId: this.expedition.id, reason: null, ready: true };
        if (timestamp < this.expedition.endsAt) return { ...failureReason('NOT_READY'), expeditionId: this.expedition.id, ready: false };
        this.expedition = { ...this.expedition, status: 'ready' };
        return { status: 'success', success: true, expeditionId: this.expedition.id, reason: null, ready: true };
    }

    public claim(timestamp: number, expeditionId?: string): ExpeditionClaimResult {
        const resources = this.getResources();
        if (!validTimestamp(timestamp)) return { ...failureReason('INVALID_TIMESTAMP'), expeditionId: this.expedition?.id ?? expeditionId ?? null, reward: null, resources };
        if (this.expedition === null) {
            const reason = expeditionId && this.claimedExpeditionIds.includes(expeditionId) ? 'ALREADY_CLAIMED' : 'NO_EXPEDITION';
            return { ...failureReason(reason), expeditionId: expeditionId ?? null, reward: null, resources };
        }
        if (expeditionId !== undefined && expeditionId !== this.expedition.id) return { ...failureReason('EXPEDITION_MISMATCH'), expeditionId: this.expedition.id, reward: null, resources };
        if (this.expedition.status === 'active' && timestamp < this.expedition.endsAt) return { ...failureReason('NOT_READY'), expeditionId: this.expedition.id, reward: null, resources };
        const reward = this.config.rewards.find((item) => item.id === this.expedition?.rewardId);
        if (!reward) throw new Error('expedition reward configuration disappeared');
        const nextResources = this.calculateRewardedResources(reward);
        if (nextResources === null) return { ...failureReason('REWARD_OVERFLOW'), expeditionId: this.expedition.id, reward: null, resources };
        const claimedId = this.expedition.id;
        this.resources = nextResources;
        this.expedition = null;
        this.claimedExpeditionIds = [...this.claimedExpeditionIds, claimedId].sort();
        return { status: 'success', success: true, expeditionId: claimedId, reason: null, reward, resources: this.getResources() };
    }

    public claimReward(timestamp: number, expeditionId?: string): ExpeditionClaimResult {
        return this.claim(timestamp, expeditionId);
    }

    private calculateRewardedResources(reward: ExpeditionReward): ExpeditionResources | null {
        const add = (current: number, amount: number): number | null => current > Number.MAX_SAFE_INTEGER - amount ? null : current + amount;
        const experience = add(this.resources.experience, reward.experience);
        const silver = add(this.resources.silver, reward.silver);
        const crystal = add(this.resources.crystal, reward.crystal);
        if (experience === null || silver === null || crystal === null) return null;
        const materials = { ...this.resources.materials };
        for (const grant of reward.materials) {
            const current = materials[grant.materialId] ?? 0;
            const next = add(current, grant.quantity);
            if (next === null) return null;
            materials[grant.materialId] = next;
        }
        return { stamina: this.resources.stamina, experience, silver, crystal, materials };
    }
}
