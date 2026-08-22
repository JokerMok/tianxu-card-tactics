import { loadExpeditionConfig, type ExpeditionConfig } from './expedition-contract';

/** Deterministic starter tables. Runtime and presentation assets are intentionally separate. */
export const EXPEDITION_CONFIG: ExpeditionConfig = loadExpeditionConfig({
    schemaVersion: 1,
    materials: [
        { id: 'alloy' },
        { id: 'crystal_shard' },
        { id: 'field_ration' },
    ],
    units: [
        { id: 'vanguard', power: 8 },
        { id: 'scout', power: 6 },
        { id: 'mystic', power: 7 },
        { id: 'warden', power: 9 },
        { id: 'ranger', power: 5 },
    ],
    rewards: [
        {
            id: 'frontier_cache',
            experience: 120,
            silver: 240,
            crystal: 2,
            materials: [{ materialId: 'alloy', quantity: 2 }, { materialId: 'field_ration', quantity: 1 }],
        },
        {
            id: 'deep_zone_cache',
            experience: 260,
            silver: 520,
            crystal: 5,
            materials: [{ materialId: 'alloy', quantity: 4 }, { materialId: 'crystal_shard', quantity: 2 }],
        },
    ],
    destinations: [
        {
            id: 'border_watch',
            durationMs: 60_000,
            staminaCost: 10,
            requiredPower: 12,
            minTeamSize: 2,
            maxTeamSize: 3,
            rewardId: 'frontier_cache',
        },
        {
            id: 'deep_zone',
            durationMs: 120_000,
            staminaCost: 18,
            requiredPower: 24,
            minTeamSize: 3,
            maxTeamSize: 4,
            rewardId: 'deep_zone_cache',
        },
    ],
});
