import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerContent } from './content.mjs';
import { combatBonuses, growthActions, growthView, operateGrowth, tickGrowth, touchActorActivity } from './growth-systems.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const recovered = path.resolve(here, '../../cocos-client/assets/resources/recovered');
const catalog = JSON.parse(fs.readFileSync(path.join(recovered, 'catalog.json'), 'utf8'));
const tables = {};
for (const [key, entry] of Object.entries(catalog.tables)) {
  if (!key.startsWith('main:')) continue;
  tables[key.slice(5).toLowerCase()] = JSON.parse(fs.readFileSync(path.join(recovered, entry.path), 'utf8')).rows;
}

const NOW = Date.UTC(2026, 9, 20, 8);
const DAY = 86_400_000;
const MINUTE = 60_000;
const importedContent = new ServerContent(recovered);

function character(overrides = {}) {
  return {
    id: 'c1', accountId: 'a1', name: 'Tester', profession: 1, level: 20, xp: 0,
    currencies: { silver: 20_000, gold: 200, crystal: 50_000 },
    cards: { 'main:card:1': 6 }, deck: [],
    inventory: { 'main:item:100': 5, 'main:item:1001': 1, 'main:item:1101': 5, 'main:item:6001': 5, 'main:item:10001': 1 },
    equipment: {}, enhancements: {}, warehouse: {},
    progress: { sceneId: 1, clearedTriggers: [], unlockedScenes: [1], positionByScene: {} },
    quests: {}, claimed: [], tutorialStep: 0, rating: 1000, wins: 0, losses: 0,
    settings: { music: true, sound: true }, createdAt: NOW - 30 * 86_400_000,
    lastLogin: NOW - 10 * 86_400_000, economicLog: [], ...overrides
  };
}

function setup(overrides) {
  const actor = character(overrides);
  const world = { characters: { [actor.id]: actor }, rooms: {}, battles: {}, guilds: {}, friendRequests: {}, friendships: [], chat: [], mail: {}, auctions: {}, trades: {}, seasons: {} };
  return { world, actor };
}

function context(world, now = NOW, random = 0) {
  return { world, actor: world.characters.c1, content: {}, tables, now, randomInt: max => Math.min(random, max - 1) };
}

// Mirrors the root server boundary: mutate a clone and commit only when the handler succeeds.
function atomic(world, action, payload, now = NOW, random = 0) {
  const working = structuredClone(world);
  const result = operateGrowth(context(working, now, random), action, payload);
  for (const key of Object.keys(world)) delete world[key];
  Object.assign(world, working);
  return result;
}

function importedContext(world) {
  return { ...context(world), content: importedContent, tables: importedContent.tables };
}

function atomicImported(world, action, payload) {
  const working = structuredClone(world);
  const result = operateGrowth(importedContext(working), action, payload);
  for (const key of Object.keys(world)) delete world[key];
  Object.assign(world, working);
  return result;
}

test('exports a complete semantic action contract and renderable view', () => {
  const { world } = setup();
  assert.equal(new Set(growthActions).size, growthActions.length);
  for (const required of ['equipment.enhance', 'magic.fuse', 'shop.openTen', 'shop.reputation.buy', 'shop.skill.buy', 'pet.learnSkill', 'city.tax', 'battlePass.claim', 'summon.world']) {
    assert.ok(growthActions.includes(required));
  }
  const view = growthView(context(world));
  assert.ok(view.sections.length >= 8);
  assert.ok(view.sections.every(section => section.items.every(item => growthActions.includes(item.action))));
  assert.equal(JSON.parse(JSON.stringify(view)).version, 1);
});

test('failed calls roll back the entire world at the atomic boundary', () => {
  const { world } = setup({ currencies: { silver: 10, gold: 0, crystal: 0 } });
  const before = structuredClone(world);
  assert.throws(() => atomic(world, 'shop.openTen', {}), /insufficient gold/);
  assert.deepEqual(world, before);

  assert.throws(() => atomic(world, 'warehouse.move', { itemId: 'main:item:9999', count: 1, to: 'warehouse' }), /definition missing/);
  assert.deepEqual(world, before);
});

test('profile avatar choices use owned card art, validate updates, and safely present legacy values', () => {
  const { world } = setup({ cards: { 'main:card:1': 2, 'main:card:19': 1 } });
  growthView(importedContext(world));
  world.characters.c1.growth.profile.avatar = 'legacy-arbitrary-value';

  let view = growthView(importedContext(world));
  assert.equal(view.profile.source, 'owned-card-art');
  assert.equal(view.profile.fallbackApplied, true);
  assert.deepEqual(view.profile.options.map(option => option.cardId), ['main:card:1', 'main:card:19']);
  for (const option of view.profile.options) {
    assert.equal(importedContent.catalog.assets[option.assetId].path, option.path);
    assert.equal(fs.existsSync(path.join(recovered, option.path)), true, `${option.path} must be an imported file`);
  }
  assert.equal(world.characters.c1.growth.profile.avatar, 'legacy-arbitrary-value', 'legacy storage is preserved');
  assert.equal(view.profile.avatarAssetId, view.profile.options[0].assetId, 'invalid legacy value falls back to owned art');

  const profileItem = view.sections.find(section => section.id === 'progression').items
    .find(item => item.action === 'profile.update' && item.fields?.some(field => field.key === 'avatarAssetId'));
  const field = profileItem.fields[0];
  assert.equal(field.type, 'select');
  assert.deepEqual(field.options, view.profile.options.map(option => ({ label: option.label, value: option.assetId })));

  const selected = view.profile.options[1];
  const updated = atomicImported(world, 'profile.update', { avatarAssetId: selected.assetId });
  assert.equal(updated.result.avatarAssetId, selected.assetId);
  assert.equal(world.characters.c1.growth.profile.avatarAssetId, selected.assetId);
  view = growthView(importedContext(world));
  assert.equal(view.profile.avatarAssetId, selected.assetId);
  assert.equal(view.profile.fallbackApplied, false);

  const before = structuredClone(world);
  assert.throws(() => atomicImported(world, 'profile.update', { avatarAssetId: 'asset:not-imported' }), /avatar asset unavailable/);
  assert.deepEqual(world, before);
  assert.throws(() => atomicImported(world, 'profile.update', { avatar: 'legacy-free-text-is-not-a-new-choice' }), /avatar asset unavailable/);
  assert.deepEqual(world, before);
  const unowned = importedContent.card('main:card:43').art[0];
  assert.throws(() => atomicImported(world, 'profile.update', { avatarAssetId: unowned }), /avatar asset unavailable/);
  assert.deepEqual(world, before);
});

test('uses extracted equipment and strengthening configuration', () => {
  const { world } = setup();
  atomic(world, 'equipment.equip', { itemId: 'main:item:10001' });
  assert.equal(world.characters.c1.equipment['0'], 'main:item:10001');
  atomic(world, 'equipment.enhance', { itemId: 'main:item:10001' });
  assert.equal(world.characters.c1.enhancements['main:item:10001'], 1);
  assert.equal(world.characters.c1.inventory['main:item:100'], 4);
  assert.ok(world.characters.c1.economicLog.some(x => x.reason === 'equipment-enhance' && x.kind === 'debit'));
  const bonuses = combatBonuses(context(world));
  assert.ok(bonuses.hp > 0);
  assert.ok(bonuses.effects?.includes(50501));
});

test('configured consumables, binding and root social locks stay explicit', () => {
  const { world } = setup();
  atomic(world, 'inventory.use', { itemId: 'main:item:1001', count: 1 });
  assert.equal(world.characters.c1.currencies.silver, 30_000);
  assert.ok(world.characters.c1.boundItems.includes('main:item:6001'));
  atomic(world, 'warehouse.lock', { itemId: 'main:item:6001', locked: true });
  assert.ok(world.characters.c1.lockedItems.includes('main:item:6001'));
  assert.throws(() => atomic(world, 'warehouse.move', { itemId: 'main:item:6001', to: 'warehouse' }), /locked/);
  atomic(world, 'warehouse.lock', { itemId: 'main:item:6001', locked: false });
  assert.ok(!world.characters.c1.lockedItems.includes('main:item:6001'));
});

test('card synthesis consumes three copies and grants configured next card on success', () => {
  const { world } = setup();
  const result = atomic(world, 'magic.synthesize', { cardId: 'main:card:1' });
  assert.equal(result.result.success, true);
  assert.equal(world.characters.c1.cards['main:card:1'], 3);
  assert.equal(world.characters.c1.cards['main:card:2'], 1);
  assert.equal(world.characters.c1.growth.counters.cardSynthesis, 1);
});

test('extracted fusion recipe checks all materials before mutation', () => {
  const { world } = setup();
  const before = structuredClone(world);
  assert.throws(() => atomic(world, 'magic.fuse', { cardId: 'main:card:41001' }), /insufficient main:item:11/);
  assert.deepEqual(world, before);

  world.characters.c1.inventory['main:item:11'] = 18;
  world.characters.c1.inventory['main:item:12'] = 9;
  atomic(world, 'magic.fuse', { cardId: 'main:card:41001' });
  assert.equal(world.characters.c1.cards['main:card:41001'], 1);
  assert.equal(world.characters.c1.inventory['main:item:11'], undefined);
});

test('pet growth uses extracted pet and experience tables', () => {
  const { world } = setup();
  atomic(world, 'pet.adopt', { petId: 1001 });
  atomic(world, 'pet.feed', { petId: 1001, itemId: 'main:item:1101', count: 2 });
  atomic(world, 'pet.upgrade', { petId: 1001 });
  assert.equal(world.characters.c1.growth.pets[1001].level, 2);
  assert.equal(world.characters.c1.growth.pets[1001].exp, 50);
});

test('battle pass maps level to the extracted regular reward group', () => {
  const { world } = setup();
  growthView(context(world));
  const result = atomic(world, 'battlePass.claim', { level: 1 });
  assert.equal(result.result.level, 1);
  assert.equal(world.characters.c1.inventory['main:item:1001'], 2);
});

test('battle pass view keeps every earned unclaimed level reachable across all tracks', () => {
  const { world } = setup();
  growthView(context(world));
  const pass = world.characters.c1.growth.battlePass;
  world.characters.c1.growth.counters.growthActions = 25;
  pass.premium = true;
  pass.claimed = ['free:2', 'premium:4', 'ultimate:6'];

  const progression = growthView(context(world)).sections.find(section => section.id === 'progression');
  const items = progression.items.filter(item => item.action === 'battlePass.claim');
  const byTrack = track => items.filter(item => item.payload.track === track).map(item => item.payload.level);
  assert.deepEqual(byTrack('free'), [1, 3, 4, 5, 6]);
  assert.deepEqual(byTrack('premium'), [1, 2, 3, 5, 6]);
  assert.deepEqual(byTrack('ultimate'), [1, 2, 3, 4, 5]);
  assert.ok(items.filter(item => item.payload.track === 'premium').every(item => !item.disabled));
  assert.ok(items.filter(item => item.payload.track === 'ultimate').every(item => item.disabled));

  atomic(world, 'battlePass.claim', { level: 1, track: 'free' });
  const refreshed = growthView(context(world)).sections.find(section => section.id === 'progression').items;
  assert.ok(!refreshed.some(item => item.action === 'battlePass.claim'
    && item.payload.track === 'free' && item.payload.level === 1));
});

test('daily schedules reject duplicates and reopen on a new day', () => {
  const { world } = setup();
  atomic(world, 'activity.loginClaim', {});
  const afterFirst = structuredClone(world);
  assert.throws(() => atomic(world, 'activity.loginClaim', {}), /already claimed/);
  assert.deepEqual(world, afterFirst);
  atomic(world, 'activity.loginClaim', {}, NOW + 86_400_000);
  assert.equal(world.characters.c1.growth.activities.loginStreak, 2);

  atomic(world, 'test.grant', {}, NOW);
  assert.throws(() => atomic(world, 'test.grant', {}, NOW), /already claimed/);
});

test('return eligibility follows explicit actor activity and survives views until claimed', () => {
  const { world } = setup({ lastLogin: NOW - DAY });
  assert.equal(touchActorActivity(context(world, NOW)), true);
  assert.equal(world.characters.c1.growth.lastActiveAt, NOW);
  assert.equal(world.characters.c1.growth.returnEligible, false);

  growthView(context(world, NOW + 8 * DAY));
  tickGrowth(world, tables, NOW + 8 * DAY);
  assert.equal(world.characters.c1.growth.lastActiveAt, NOW, 'view and tick do not count as actor activity');
  assert.equal(world.characters.c1.growth.returnEligible, false, 'view and tick do not fabricate a return gap');

  assert.equal(touchActorActivity(context(world, NOW + 8 * DAY)), true);
  assert.equal(world.characters.c1.growth.returnEligible, true);
  touchActorActivity(context(world, NOW + 8 * DAY + 1));
  assert.equal(world.characters.c1.growth.returnEligible, true, 'eligibility remains pending across later activity');

  atomic(world, 'quest.returnClaim', {}, NOW + 8 * DAY + 2);
  assert.equal(world.characters.c1.growth.returnEligible, false);
  assert.equal(world.characters.c1.growth.returnClaimed, true);
  touchActorActivity(context(world, NOW + 30 * DAY));
  assert.equal(world.characters.c1.growth.returnEligible, false, 'one-time reward does not reopen');
  assert.throws(() => atomic(world, 'quest.returnClaim', {}, NOW + 30 * DAY), /already claimed/);
});

test('recent activity advances the return eligibility baseline', () => {
  const { world } = setup({ lastLogin: NOW - 30 * DAY });
  touchActorActivity(context(world, NOW));
  assert.equal(world.characters.c1.growth.returnEligible, true, 'legacy lastLogin can establish initial eligibility');

  const recent = setup({ lastLogin: NOW - DAY }).world;
  touchActorActivity(context(recent, NOW));
  touchActorActivity(context(recent, NOW + 6 * DAY));
  touchActorActivity(context(recent, NOW + 12 * DAY));
  assert.equal(recent.characters.c1.growth.returnEligible, false, 'activity inside seven days prevents a false return');
  touchActorActivity(context(recent, NOW + 19 * DAY));
  assert.equal(recent.characters.c1.growth.returnEligible, true, 'seven inactive days unlock the reward');
});

test('actor activity writes at minute precision and unlocks at the seven-day boundary', () => {
  const { world } = setup({ lastLogin: NOW - DAY });
  touchActorActivity(context(world, NOW));
  assert.equal(touchActorActivity(context(world, NOW + MINUTE - 1)), false);
  assert.equal(world.characters.c1.growth.lastActiveAt, NOW);
  assert.equal(touchActorActivity(context(world, NOW + MINUTE)), true);
  assert.equal(world.characters.c1.growth.lastActiveAt, NOW + MINUTE);

  const boundary = setup({ lastLogin: NOW - DAY }).world;
  touchActorActivity(context(boundary, NOW));
  assert.equal(touchActorActivity(context(boundary, NOW + 7 * DAY - 1)), true);
  assert.equal(boundary.characters.c1.growth.returnEligible, false);
  assert.equal(touchActorActivity(context(boundary, NOW + 14 * DAY - 1)), true);
  assert.equal(boundary.characters.c1.growth.returnEligible, true);
});

test('city upgrade matures only after authoritative tick time', () => {
  const { world } = setup();
  const result = atomic(world, 'city.upgrade', { buildingId: 'castle' });
  const readyAt = result.result.readyAt;
  assert.equal(tickGrowth(world, tables, readyAt - 1), false);
  assert.equal(world.characters.c1.growth.city.buildings.castle.level, 1);
  assert.equal(tickGrowth(world, tables, readyAt), true);
  assert.equal(world.characters.c1.growth.city.buildings.castle.level, 2);
  assert.equal(tickGrowth(world, tables, readyAt + 1), false);
});

test('all five source task buildings exist and can mature to level 20', () => {
  const { world } = setup({ currencies: { silver: 100_000, gold: 0, crystal: 0 } });
  growthView(context(world));
  const buildings = world.characters.c1.growth.city.buildings;
  assert.deepEqual(Object.keys(buildings).sort(), ['alchemy', 'castle', 'defense', 'dock', 'smithy']);
  for (const id of Object.keys(buildings)) buildings[id] = { level: 19, readyAt: 0 };
  let readyAt = 0;
  for (const id of Object.keys(buildings)) readyAt = atomic(world, 'city.upgrade', { buildingId: id }).result.readyAt;
  assert.equal(tickGrowth(world, tables, readyAt), true);
  for (const id of Object.keys(buildings)) {
    assert.equal(world.characters.c1.growth.city.buildings[id].level, 20);
    assert.throws(() => atomic(world, 'city.upgrade', { buildingId: id }), /building maxed/);
  }
});

test('pack draw, recurring wish and world summon use server randomInt and real card pool', () => {
  const { world } = setup();
  const pack = atomic(world, 'shop.openPack', { offerId: 'pack:basic' });
  assert.equal(pack.result.received.cards.length, 3);
  const wish = atomic(world, 'activity.wish', { group: 1 });
  assert.ok(wish.result.gained);
  const summon = atomic(world, 'summon.world', { count: 10 });
  assert.equal(summon.result.cards.length, 10);
  assert.ok(world.characters.c1.economicLog.some(x => x.reason === 'summon-world' && x.asset === 'crystal'));
});

test('reputation shop uses source reputation level, silver price and server-owned offer data', () => {
  const { world } = setup({ currencies: { silver: 1_000, gold: 0, crystal: 0 } });
  growthView(context(world));
  world.characters.c1.growth.reputation[11] = 12_600;
  const shopItem = growthView(context(world)).sections.find(section => section.id === 'reputation-shop').items
    .find(item => item.payload.cardId === 'main:card:19');
  assert.equal(shopItem.label, 'Squire');
  assert.equal(shopItem.detail, '100 银币');
  assert.equal(shopItem.disabled, undefined);
  const bought = atomic(world, 'shop.reputation.buy', { cardId: 'main:card:19', price: 1, reputationType: 99 });
  assert.equal(bought.result.silver, 100);
  assert.equal(bought.result.reputationType, 11);
  assert.equal(world.characters.c1.currencies.silver, 900);
  assert.equal(world.characters.c1.cards['main:card:19'], 1);
  assert.ok(world.characters.c1.economicLog.some(entry => entry.reason === 'reputation-shop' && entry.kind === 'debit' && entry.amount === -100));
  assert.ok(world.characters.c1.economicLog.some(entry => entry.reason === 'reputation-shop' && entry.kind === 'grant' && entry.asset === 'main:card:19'));

  const locked = setup({ currencies: { silver: 1_000, gold: 0, crystal: 0 } }).world;
  growthView(context(locked));
  locked.characters.c1.growth.reputation[11] = 12_599;
  assert.throws(() => atomic(locked, 'shop.reputation.buy', { cardId: 19 }), /level locked/);
  locked.characters.c1.growth.reputation[11] = 12_600;
  locked.characters.c1.currencies.silver = 99;
  assert.throws(() => atomic(locked, 'shop.reputation.buy', { cardId: 19 }), /insufficient silver/);
});

test('profession skill shop enforces source profession, balance and three-copy limit', () => {
  const { world } = setup({ currencies: { silver: 500, gold: 0, crystal: 0 } });
  const view = growthView(context(world));
  const section = view.sections.find(candidate => candidate.id === 'profession-skill-shop');
  assert.ok(section.items.some(item => item.label === 'Slash' && item.detail === '150 银币' && item.action === 'shop.skill.buy'));
  assert.ok(!section.items.some(item => item.label === 'Fireball'));

  atomic(world, 'shop.skill.buy', { cardId: 41001, price: 1 });
  assert.equal(world.characters.c1.currencies.silver, 350);
  assert.equal(world.characters.c1.cards['main:card:41001'], 1);
  assert.throws(() => atomic(world, 'shop.skill.buy', { cardId: 43001 }), /unavailable/);
  world.characters.c1.cards['main:card:41001'] = 3;
  assert.throws(() => atomic(world, 'shop.skill.buy', { cardId: 41001 }), /holding limit/);
  world.characters.c1.cards['main:card:41001'] = 0;
  world.characters.c1.currencies.silver = 149;
  assert.throws(() => atomic(world, 'shop.skill.buy', { cardId: 41001 }), /insufficient silver/);
});

test('all configured consumable reaction families produce persistent local effects', () => {
  const ids = [2, 4, 8, 9, 92, 588, 598, 600, 1010, 1015, 1020, 1030, 1032, 1040, 2001, 3010, 4001, 8001, 8002, 8003, 40000];
  const inventory = { ...character().inventory, ...Object.fromEntries(ids.map(id => [`main:item:${id}`, id === 92 ? 99 : 1])) };
  inventory['main:item:40000'] = 2;
  const { world } = setup({ inventory, gender: 1 });

  atomic(world, 'inventory.use', { itemId: 2, profession: 2 });
  atomic(world, 'inventory.use', { itemId: 1010 });
  atomic(world, 'inventory.use', { itemId: 1020 });
  atomic(world, 'inventory.use', { itemId: 1030 });
  atomic(world, 'inventory.use', { itemId: 1040 });
  atomic(world, 'inventory.use', { itemId: 2001 });
  atomic(world, 'inventory.use', { itemId: 1015 });
  atomic(world, 'inventory.use', { itemId: 4 });
  atomic(world, 'inventory.use', { itemId: 8002 });
  atomic(world, 'inventory.use', { itemId: 588 });
  atomic(world, 'inventory.use', { itemId: 4001 });
  atomic(world, 'inventory.use', { itemId: 598 });
  atomic(world, 'inventory.use', { itemId: 3010 });
  atomic(world, 'inventory.use', { itemId: 8, name: 'Renamed' });
  atomic(world, 'inventory.use', { itemId: 9, gender: 2 });
  atomic(world, 'inventory.use', { itemId: 1032 });
  atomic(world, 'inventory.use', { itemId: 92 });
  atomic(world, 'inventory.use', { itemId: 600 });
  atomic(world, 'inventory.use', { itemId: 8001 });
  atomic(world, 'inventory.use', { itemId: 8003 });
  atomic(world, 'inventory.use', { itemId: 40000, choices: '1,2,3,4,5' });
  atomic(world, 'inventory.use', { itemId: 40000, choices: [4, 5, 6, 7, 8] });

  const actor = world.characters.c1, growth = actor.growth;
  assert.equal(actor.profession, 2);
  assert.equal(actor.name, 'Renamed');
  assert.equal(actor.gender, 2);
  assert.equal(growth.energy, 1);
  assert.equal(growth.gems, 88);
  assert.equal(growth.reputation[1], 5000);
  assert.equal(growth.dungeonEntries[9], 1);
  assert.equal(growth.transformation, 1);
  assert.equal(growth.battlePass.premium, true);
  assert.equal(growth.battlePass.ultimate, true);
  assert.equal(growth.limitedUses['main:item:3010'], 1);
  assert.equal(growth.towerCoins, 120);
  assert.equal(growth.activityPoints, 70);
  assert.equal(growth.honor, 80);
  assert.equal(growth.advancedTowerCoins, 300);
  assert.equal(actor.inventory['main:item:3010'], 1);
  assert.equal(actor.inventory['main:item:24'], 1);
  assert.ok(growth.titles.includes('item-title:1'));
});

test('card enchantment and pointing use extracted recipes and alchemy gates', () => {
  const { world } = setup({
    currencies: { silver: 100_000, gold: 200, crystal: 50_000 },
    cards: { 'main:card:1': 2, 'main:card:21247': 1 },
    inventory: { ...character().inventory, 'main:item:21': 1, 'main:item:35': 1 }
  });
  growthView(context(world));
  world.characters.c1.growth.city.buildings.alchemy.level = 7;
  const enchanted = atomic(world, 'magic.enchant', { cardId: 1, materialCardId: 21247 });
  assert.equal(enchanted.result.cardId, 'main:card:15001');
  assert.equal(world.characters.c1.inventory['main:item:35'], undefined);

  const pointed = atomic(world, 'magic.point', { cardId: 1 });
  assert.equal(pointed.result.cardId, 'main:card:4');
  assert.equal(world.characters.c1.inventory['main:item:21'], undefined);
  assert.equal(world.characters.c1.growth.cardPointing['main:card:4'], 1);
});

test('battle pass tracks and former payment activities have bounded local replacements', () => {
  const { world } = setup();
  growthView(context(world));
  world.characters.c1.growth.counters.growthActions = 20;
  atomic(world, 'test.unlockBattlePass', { track: 'premium' });
  const premium = atomic(world, 'battlePass.claim', { level: 1, track: 'premium' });
  assert.equal(premium.result.track, 'premium');
  atomic(world, 'test.unlockBattlePass', { track: 'ultimate' });
  const ultimate = atomic(world, 'battlePass.claim', { level: 1, track: 'ultimate' });
  assert.equal(ultimate.result.track, 'ultimate');
  atomic(world, 'activity.weeklyGrant', {});
  atomic(world, 'activity.rewardBonus', {});
  assert.throws(() => atomic(world, 'activity.weeklyGrant', {}), /already claimed/);
  assert.throws(() => atomic(world, 'test.unlockBattlePass', { track: 'premium' }), /already active/);
});

test('growth view returns complete collections and economic log is not locally truncated', () => {
  const medicaments = tables['embeddata/scp/medicament.xml'].filter(row => Number(row['物品ID']) > 0).slice(0, 60);
  const inventory = Object.fromEntries(medicaments.map(row => [`main:item:${row['物品ID']}`, 1]));
  inventory['main:item:1001'] = 1;
  const economicLog = Array.from({ length: 510 }, (_, i) => ({ at: i, kind: 'grant', asset: 'silver', amount: 1, reason: 'history' }));
  const { world } = setup({ inventory, economicLog });
  const view = growthView(context(world));
  const inventorySection = view.sections.find(section => section.id === 'inventory');
  assert.equal(inventorySection.items.filter(item => item.action === 'warehouse.move' && item.payload.to === 'warehouse').length, Object.keys(inventory).length);
  assert.equal(view.pagination.sourceComplete, true);
  assert.deepEqual(view.pagination.cappedCollections, []);
  atomic(world, 'inventory.use', { itemId: 1001 });
  assert.ok(world.characters.c1.economicLog.length > 510);
});
