import { loadCardShopConfig, type CardShopConfig } from './shop-contract';

/** Small deterministic table used by the runtime and pure contract tests. */
export const CARD_SHOP_CONFIG: CardShopConfig = loadCardShopConfig({
    schemaVersion: 1,
    slotCount: 3,
    currencies: [
        { id: 'coins' },
        { id: 'crystals' },
    ],
    cards: [
        { id: 'bulwark', rarity: 1 },
        { id: 'ember_shot', rarity: 2 },
        { id: 'field_medic', rarity: 1 },
        { id: 'storm_core', rarity: 3 },
        { id: 'void_lance', rarity: 2 },
    ],
    products: [
        { id: 'bulwark_coins', cardId: 'bulwark', currencyId: 'coins', price: 40, stock: 1 },
        { id: 'ember_shot_coins', cardId: 'ember_shot', currencyId: 'coins', price: 80, stock: 1 },
        { id: 'field_medic_coins', cardId: 'field_medic', currencyId: 'coins', price: 60, stock: 1 },
        { id: 'storm_core_crystals', cardId: 'storm_core', currencyId: 'crystals', price: 2, stock: 1 },
        { id: 'void_lance_coins', cardId: 'void_lance', currencyId: 'coins', price: 100, stock: 1 },
    ],
});
