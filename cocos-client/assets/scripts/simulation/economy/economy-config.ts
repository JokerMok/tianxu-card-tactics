import { CRAFTING_CONFIG } from '../../meta/equipment/crafting/crafting-config';
import { EXPEDITION_CONFIG } from '../../meta/expedition/expedition-config';
import { CARD_SHOP_CONFIG } from '../../meta/shop/shop-config';
import { loadEconomyConfig, type EconomyConfig } from './economy-contract';

const cardShopProductIds = CARD_SHOP_CONFIG.products.map((product) => product.id);

export const ECONOMY_CONFIG: EconomyConfig = loadEconomyConfig({
    schemaVersion: 1,
    simulationDays: 30,
    seed: 0x30de_c0de,
    resources: [
        { id: 'alloy', initial: 3 },
        { id: 'circuit', initial: 1 },
        { id: 'coins', initial: 100 },
        { id: 'core', initial: 1 },
        { id: 'credits', initial: 120 },
        { id: 'crystal', initial: 0 },
        { id: 'crystal_shard', initial: 0 },
        { id: 'experience', initial: 0 },
        { id: 'field_ration', initial: 0 },
        { id: 'reputation', initial: 0 },
        { id: 'silver', initial: 0 },
        { id: 'stamina', initial: 18 },
    ],
    buildings: [
        {
            id: 'foundry',
            initialLevel: 1,
            maxLevel: 3,
            dailyYield: { alloy: 1 },
            upgrades: [
                { targetLevel: 2, cost: { credits: 35, alloy: 1 } },
                { targetLevel: 3, cost: { credits: 60, alloy: 2, circuit: 1 } },
            ],
        },
        {
            id: 'relay',
            initialLevel: 1,
            maxLevel: 2,
            dailyYield: { circuit: 1 },
            upgrades: [{ targetLevel: 2, cost: { credits: 50, alloy: 2 } }],
        },
    ],
    reputationTiers: [
        { id: 'trusted', threshold: 10, dailyYield: { credits: 5 } },
        { id: 'venerated', threshold: 25, dailyYield: { credits: 10 } },
    ],
    expeditions: [
        {
            id: 'border_watch',
            durationDays: 1,
            staminaCost: 10,
            rewards: { silver: 240, crystal: 2, alloy: 2, field_ration: 1, experience: 120 },
        },
        {
            id: 'deep_zone',
            durationDays: 2,
            staminaCost: 18,
            rewards: { silver: 520, crystal: 5, alloy: 4, crystal_shard: 2, experience: 260 },
        },
    ],
    dailyTasks: [
        { id: 'daily_income', event: 'income', reward: { reputation: 1 } },
        { id: 'expedition_claim', event: 'expedition', reward: { credits: 10, reputation: 1 } },
        { id: 'shop_refresh', event: 'shop', reward: { reputation: 1 } },
    ],
    shopProducts: CARD_SHOP_CONFIG.products.map((product) => ({
        id: product.id,
        externalProductId: product.id,
        currencyId: product.currencyId === 'crystals' ? 'crystal' : 'coins',
        basePrice: product.price,
        inflationBps: product.currencyId === 'crystals' ? 100 : 200,
    })),
    integrationRefs: {
        equipmentRecipeIds: CRAFTING_CONFIG.recipes.map((recipe) => recipe.id),
        equipmentEnhancementIds: ['enhance-common', 'enhance-rare', 'enhance-epic'],
        buildingIds: ['foundry', 'relay'],
        reputationTierIds: ['trusted', 'venerated'],
        expeditionIds: EXPEDITION_CONFIG.destinations.map((destination) => destination.id),
        dailyTaskIds: ['daily_income', 'expedition_claim', 'shop_refresh'],
        shopProductIds: cardShopProductIds,
    },
    dailyCreditIncome: 60,
    dailyStaminaIncome: 12,
    mandatoryCreditCost: 15,
});
