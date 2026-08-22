import { loadCraftingConfig, type EquipmentCraftingConfig } from './crafting-contract';

/** Runtime-safe starter tables; art and UI assets are intentionally not part of this contract. */
export const CRAFTING_CONFIG: EquipmentCraftingConfig = loadCraftingConfig({
    schemaVersion: 1,
    materials: [
        { id: 'alloy', rarity: 1 },
        { id: 'circuit', rarity: 2 },
        { id: 'core', rarity: 3 },
    ],
    equipment: [
        { id: 'scrap_armor', slot: 'armor', materialId: 'alloy', power: 2 },
        { id: 'scrap_blade', slot: 'weapon', materialId: 'alloy', power: 2 },
        { id: 'scrap_core', slot: 'core', materialId: 'core', power: 2 },
        { id: 'scrap_scope', slot: 'module', materialId: 'circuit', power: 2 },
        { id: 'pulse_blade', slot: 'weapon', materialId: 'alloy', power: 8 },
        { id: 'arc_armor', slot: 'armor', materialId: 'circuit', power: 10 },
        { id: 'singularity_core', slot: 'core', materialId: 'core', power: 14 },
    ],
    recipes: [
        {
            id: 'forge_pair',
            inputEquipmentIds: ['scrap_blade', 'scrap_armor'],
            outputEquipmentId: 'pulse_blade',
            successRateBps: 10_000,
            materialCosts: [{ materialId: 'alloy', quantity: 1 }],
        },
        {
            id: 'forge_triad',
            inputEquipmentIds: ['scrap_blade', 'scrap_armor', 'scrap_scope'],
            outputEquipmentId: 'arc_armor',
            successRateBps: 6_500,
            materialCosts: [{ materialId: 'circuit', quantity: 1 }],
        },
        {
            id: 'forge_quad',
            inputEquipmentIds: ['scrap_blade', 'scrap_armor', 'scrap_scope', 'scrap_core'],
            outputEquipmentId: 'singularity_core',
            successRateBps: 4_000,
            materialCosts: [{ materialId: 'circuit', quantity: 1 }, { materialId: 'core', quantity: 1 }],
        },
    ],
});
