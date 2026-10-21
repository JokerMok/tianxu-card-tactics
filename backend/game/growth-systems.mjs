const DAY = 86_400_000;
const HOUR = 3_600_000;

const LOCAL = Object.freeze({
  dailyGrant: { silver: 500, gold: 10, crystal: 100, itemCount: 3 },
  shop: {
    'supply:gem': { label: '强化石补给', currency: 'silver', price: 120, reward: { item: 100, count: 1 } },
    'supply:pet-food': { label: '宠物精华', currency: 'silver', price: 80, reward: { item: 1101, count: 1 } },
    'pack:basic': { label: '基础卡包', currency: 'gold', price: 5, pack: 3 },
    'pack:ten': { label: '十连卡包', currency: 'gold', price: 45, pack: 10 },
    'limited:crystal': { label: '每日晶石包', currency: 'gold', price: 8, reward: { currency: 'crystal', count: 80 }, dailyLimit: 1 },
    'exchange:crystal': { label: '晶石兑换银币', currency: 'crystal', price: 50, reward: { currency: 'silver', count: 500 } }
  },
  titles: [
    { id: 'novice', label: '初阵者', need: 0 },
    { id: 'trusted', label: '声名渐起', need: 2500 },
    { id: 'renowned', label: '大陆名望', need: 10000 }
  ],
  repeatQuests: [
    { id: 'growth-actions', label: '完成 5 次养成操作', counter: 'growthActions', need: 5, reward: { silver: 250 } },
    { id: 'card-craft', label: '完成 1 次卡牌合成', counter: 'cardSynthesis', need: 1, reward: { gold: 3 } },
    { id: 'pet-care', label: '完成 2 次宠物培养', counter: 'petCare', need: 2, reward: { item: 6001, count: 1 } }
  ]
});

export const growthActions = Object.freeze([
  'test.grant', 'test.unlockBattlePass',
  'inventory.use', 'inventory.sell',
  'equipment.equip', 'equipment.unequip', 'equipment.enhance', 'equipment.craft', 'equipment.runeCraft', 'equipment.refine',
  'magic.dismantle', 'magic.synthesize', 'magic.refine', 'magic.enchant', 'magic.point', 'magic.fuse', 'magic.jar',
  'shop.buy', 'shop.openPack', 'shop.openTen', 'shop.buyLimited', 'shop.exchange', 'shop.reputation.buy', 'shop.skill.buy',
  'warehouse.lock', 'warehouse.move',
  'pet.adopt', 'pet.feed', 'pet.upgrade', 'pet.learnSkill',
  'mount.adopt', 'mount.upgrade', 'mount.equip',
  'reputation.claim', 'title.equip', 'profile.update',
  'city.upgrade', 'city.tax',
  'activity.loginClaim', 'activity.checkin', 'activity.chest', 'activity.wheel', 'activity.wish', 'activity.weeklyGrant', 'activity.rewardBonus',
  'quest.returnClaim', 'quest.repeatClaim',
  'battlePass.claim', 'summon.world'
]);

function fail(message) { throw new Error(message); }
function int(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail(`${name} invalid`);
  return n;
}
function text(value, name, max = 40) {
  const s = String(value ?? '').trim();
  if (!s || s.length > max) fail(`${name} invalid`);
  return s;
}
function dayKey(now) { return Math.floor(now / DAY); }
function itemKey(id) { return `main:item:${int(id, 'itemId', 1)}`; }
function cardKey(id) { return `main:card:${int(id, 'cardId', 1)}`; }
function numericId(value, kind) {
  if (typeof value === 'number') return int(value, `${kind}Id`, 1);
  const match = String(value ?? '').match(new RegExp(`^main:${kind}:(\\d+)$`));
  if (!match) fail(`${kind}Id invalid`);
  return int(match[1], `${kind}Id`, 1);
}
function rows(tables, path) { return tables?.[path.toLowerCase()] ?? []; }
function field(row, names, fallback = undefined) {
  for (const name of names) if (row && row[name] !== undefined && row[name] !== '') return row[name];
  return fallback;
}
function numericField(row, names, fallback = 0) {
  const n = Number(field(row, names, fallback));
  return Number.isFinite(n) ? n : fallback;
}
function dataRows(tables, path) { return rows(tables, path).filter(row => row && Object.values(row).some(v => typeof v === 'number')); }
function findBy(tables, path, names, id) { return dataRows(tables, path).find(row => numericField(row, names, -1) === Number(id)); }
function equipmentDef(tables, id) { return findBy(tables, 'embeddata/scp/equipment.xml', ['物品ID\n', '物品ID', 'ID'], id); }
function warrantDef(tables, id) { return findBy(tables, 'embeddata/scp/warrant.xml', ['物品ID', 'ID'], id); }
function medicamentDef(tables, id) { return findBy(tables, 'embeddata/scp/medicament.xml', ['物品ID', 'ID'], id); }
function itemDef(tables, id) { return medicamentDef(tables, id) || warrantDef(tables, id) || equipmentDef(tables, id); }
function cardDef(tables, id) { return findBy(tables, 'embeddata/scp/card.xml', ['ID'], id); }
function monsterDef(tables, id) { return findBy(tables, 'embeddata/scp/monster.xml', ['ID'], id); }
function petDef(tables, id) { return findBy(tables, 'embeddata/scp/pet.xml', ['ID'], id); }
function own(map, key) { return int(map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : 0, 'count'); }
function prefixedField(row, prefix, fallback = 0) {
  const key = Object.keys(row || {}).find(k => k.startsWith(prefix));
  return key ? row[key] : fallback;
}
function medicineParam(row, index) {
  if (index === 1) return Number(prefixedField(row, '作用参数1', 0)) || 0;
  return Number(row?.[`作用参数${index}`] ?? 0) || 0;
}

function avatarOptions(ctx) {
  if (typeof ctx.content?.card !== 'function') return [];
  const assets = ctx.content.catalog?.assets ?? {};
  const options = [];
  const seen = new Set();
  for (const [cardId, count] of Object.entries(ctx.actor.cards ?? {})) {
    if (Number(count) < 1 || !/^main:card:\d+$/.test(cardId)) continue;
    let card;
    try { card = ctx.content.card(cardId); } catch { continue; }
    const assetId = (card.art ?? []).find(id => typeof assets[id]?.path === 'string' && assets[id].path.length > 0);
    if (!assetId || seen.has(assetId)) continue;
    seen.add(assetId);
    options.push({ label: String(card.raw?.Name ?? cardId), value: assetId, assetId, cardId, path: assets[assetId].path });
  }
  return options.sort((a, b) => Number(a.cardId.split(':').at(-1)) - Number(b.cardId.split(':').at(-1)));
}

function avatarProfile(ctx) {
  const profile = ctx.actor.growth.profile, options = avatarOptions(ctx);
  const stored = String(profile.avatarAssetId ?? profile.avatar ?? '');
  const current = options.find(option => option.assetId === stored) ?? options[0] ?? null;
  return { avatarAssetId: current?.assetId ?? null, options, source: 'owned-card-art',
    fallbackApplied: Boolean(stored && current && stored !== current.assetId) };
}

function ensure(ctx) {
  const a = ctx.actor;
  if (!a || !ctx.world || !ctx.tables || !Number.isFinite(ctx.now) || typeof ctx.randomInt !== 'function') fail('growth context invalid');
  a.inventory ||= {};
  a.cards ||= {};
  a.equipment ||= {};
  a.enhancements ||= {};
  a.warehouse ||= {};
  a.economicLog ||= [];
  a.boundItems ||= [];
  a.lockedItems ||= [];
  for (const key of Object.keys(a.inventory)) {
    if (!/^main:item:\d+$/.test(key)) continue;
    const def = itemDef(ctx.tables, numericId(key, 'item'));
    if (numericField(def, ['获取绑定'], 0) === 1 && !a.boundItems.includes(key)) a.boundItems.push(key);
  }
  a.quests ||= {};
  a.growth ||= {};
  const g = a.growth;
  g.version ||= 1;
  g.refinements ||= {};
  g.cardPointing ||= {};
  g.limitedUses ||= {};
  g.dungeonEntries ||= {};
  g.gems ||= 0;
  g.energy ||= 0;
  g.petEssence ||= 0;
  g.towerCoins ||= 0;
  g.advancedTowerCoins ||= 0;
  g.honor ||= 0;
  g.activityPoints ||= 0;
  g.warehouseLocks ||= {};
  for (const key of a.lockedItems) if (/^main:item:\d+$/.test(key)) g.warehouseLocks[key] = true;
  g.pets ||= {};
  g.mounts ||= {};
  g.reputation ||= {};
  g.reputationClaims ||= [];
  g.titles ||= ['novice'];
  g.titleExpiries ||= {};
  if (g.activeTitle && g.titleExpiries[g.activeTitle] && g.titleExpiries[g.activeTitle] <= ctx.now) delete g.activeTitle;
  g.profile ||= { avatar: 'default' };
  g.city ||= { buildings: { castle: { level: 1, readyAt: 0 }, smithy: { level: 1, readyAt: 0 }, alchemy: { level: 1, readyAt: 0 } }, lastTaxDay: -1 };
  g.city.buildings ||= {};
  for (const id of ['castle', 'dock', 'alchemy', 'smithy', 'defense']) g.city.buildings[id] ||= { level: 1, readyAt: 0 };
  g.activities ||= { loginDay: -1, loginStreak: 0, checkinDay: -1, checkins: 0, chests: [], wheelDay: -1, wheelCount: 0, wishDay: -1, weeklyClaims: {}, bonusClaims: {} };
  g.activities.weeklyClaims ||= {};
  g.activities.bonusClaims ||= {};
  g.shopDaily ||= { day: dayKey(ctx.now), counts: {} };
  if (g.shopDaily.day !== dayKey(ctx.now)) g.shopDaily = { day: dayKey(ctx.now), counts: {} };
  g.grants ||= {};
  g.counters ||= { growthActions: 0, cardSynthesis: 0, petCare: 0 };
  for (const key of ['growthActions', 'cardSynthesis', 'petCare']) g.counters[key] = int(g.counters[key] ?? 0, `counter ${key}`);
  g.dailyCounters ||= { day: dayKey(ctx.now), growthActions: 0, cardSynthesis: 0, petCare: 0 };
  if (g.dailyCounters.day !== dayKey(ctx.now)) g.dailyCounters = { day: dayKey(ctx.now), growthActions: 0, cardSynthesis: 0, petCare: 0 };
  for (const key of ['growthActions', 'cardSynthesis', 'petCare']) g.dailyCounters[key] = int(g.dailyCounters[key] ?? 0, `daily counter ${key}`);
  g.repeatClaims ||= {};
  g.battlePass ||= { season: seasonKey(ctx.now), claimed: [], premium: false, ultimate: false, exp: 0, localUnlocks: [] };
  if (g.battlePass.season !== seasonKey(ctx.now)) g.battlePass = { season: seasonKey(ctx.now), claimed: [], premium: false, ultimate: false, exp: 0, localUnlocks: [] };
  g.battlePass.claimed ||= [];
  g.battlePass.localUnlocks ||= [];
  g.battlePass.exp = int(g.battlePass.exp ?? 0, 'battle pass exp');
  g.returnEligible = g.returnEligible === true;
  g.returnClaimed = g.returnClaimed === true;
  return g;
}

export function touchActorActivity(ctx, minIntervalMs = 60_000) {
  const g = ensure(ctx);
  minIntervalMs = int(minIntervalMs, 'activity interval');
  const previous = Number.isFinite(g.lastActiveAt)
    ? g.lastActiveAt
    : Number.isFinite(ctx.actor.lastLogin) ? ctx.actor.lastLogin : ctx.now;
  const wasEligible = g.returnEligible;
  if (!g.returnClaimed && !g.returnEligible && ctx.now - previous >= 7 * DAY) g.returnEligible = true;
  const eligibilityChanged = wasEligible !== g.returnEligible;
  const shouldRecord = !Number.isFinite(g.lastActiveAt) || eligibilityChanged || ctx.now - g.lastActiveAt >= minIntervalMs;
  if (shouldRecord) g.lastActiveAt = ctx.now;
  return shouldRecord;
}

function seasonKey(now) { return Math.floor(now / (28 * DAY)); }
function weekKey(now) { return Math.floor(now / (7 * DAY)); }
function log(actor, now, kind, asset, amount, reason) {
  actor.economicLog.push({ at: now, kind, asset, amount, reason });
}
function currency(actor, name) {
  if (!['silver', 'gold', 'crystal'].includes(name)) fail('currency invalid');
  actor.currencies ||= { silver: 0, gold: 0, crystal: 0 };
  return int(actor.currencies[name] ?? 0, name);
}
function debit(ctx, name, amount, reason) {
  amount = int(amount, 'amount', 1);
  if (currency(ctx.actor, name) < amount) fail(`insufficient ${name}`);
  ctx.actor.currencies[name] -= amount;
  log(ctx.actor, ctx.now, 'debit', name, -amount, reason);
}
function grantCurrency(ctx, name, amount, reason) {
  amount = int(amount, 'amount', 1);
  currency(ctx.actor, name);
  ctx.actor.currencies[name] += amount;
  log(ctx.actor, ctx.now, 'grant', name, amount, reason);
}
function takeAsset(ctx, mapName, key, count, reason) {
  count = int(count, 'count', 1);
  if (mapName === 'cards') { const id = numericId(key, 'card'); if (!cardDef(ctx.tables, id)) fail('card definition missing'); }
  else { const id = numericId(key, 'item'); if (!itemDef(ctx.tables, id)) fail('item definition missing'); }
  const map = ctx.actor[mapName];
  if (own(map, key) < count) fail(`insufficient ${key}`);
  map[key] -= count;
  if (!map[key]) delete map[key];
  const transfer = reason === 'equipment-equip' || reason.startsWith('warehouse-');
  if (!transfer && !own(ctx.actor.inventory, key) && !own(ctx.actor.warehouse, key) && !Object.values(ctx.actor.equipment).includes(key)) {
    ctx.actor.boundItems = ctx.actor.boundItems.filter(x => x !== key);
    ctx.actor.lockedItems = ctx.actor.lockedItems.filter(x => x !== key);
    delete ctx.actor.growth?.warehouseLocks?.[key];
  }
  log(ctx.actor, ctx.now, 'debit', key, -count, reason);
}
function addAsset(ctx, mapName, key, count, reason) {
  count = int(count, 'count', 1);
  if (mapName === 'cards') { const id = numericId(key, 'card'); if (!cardDef(ctx.tables, id)) fail('card definition missing'); }
  else { const id = numericId(key, 'item'); if (!itemDef(ctx.tables, id)) fail('item definition missing'); }
  const map = ctx.actor[mapName];
  map[key] = own(map, key) + count;
  if (mapName === 'inventory' && /^main:item:\d+$/.test(key)) {
    const def = itemDef(ctx.tables, numericId(key, 'item'));
    if (numericField(def, ['获取绑定'], 0) === 1 && !ctx.actor.boundItems.includes(key)) ctx.actor.boundItems.push(key);
  }
  log(ctx.actor, ctx.now, 'grant', key, count, reason);
}
function reward(ctx, value, reason) {
  const out = {};
  for (const c of ['silver', 'gold', 'crystal']) if (value?.[c]) { grantCurrency(ctx, c, value[c], reason); out[c] = value[c]; }
  if (value?.item) { addAsset(ctx, 'inventory', itemKey(value.item), value.count ?? 1, reason); out.itemId = itemKey(value.item); out.count = value.count ?? 1; }
  if (value?.card) { addAsset(ctx, 'cards', cardKey(value.card), value.count ?? 1, reason); out.cardId = cardKey(value.card); out.count = value.count ?? 1; }
  return out;
}
function countGrowth(ctx, counter = 'growthActions', amount = 1) {
  const g = ctx.actor.growth;
  g.counters.growthActions += amount;
  g.dailyCounters.growthActions += amount;
  if (counter !== 'growthActions') g.counters[counter] = (g.counters[counter] ?? 0) + amount;
  if (counter !== 'growthActions') g.dailyCounters[counter] = (g.dailyCounters[counter] ?? 0) + amount;
}
function randomChoice(ctx, values) {
  if (!values.length) fail('reward pool unavailable');
  const n = ctx.randomInt(values.length);
  if (!Number.isSafeInteger(n) || n < 0 || n >= values.length) fail('random source invalid');
  return values[n];
}
function candidateCards(ctx, maxQuality = 6) {
  return dataRows(ctx.tables, 'embeddata/scp/card.xml').filter(r => numericField(r, ['ID']) > 0
    && !/废弃/.test(String(r.Name ?? '')) && numericField(r, ['Quality'], 0) <= maxQuality
    && (numericField(r, ['Type']) === 1 ? numericField(r, ['MonsterID']) > 0 && Boolean(monsterDef(ctx.tables, numericField(r, ['MonsterID']))) : numericField(r, ['Type']) === 2 && numericField(r, ['SkillID']) > 0));
}
function drawCards(ctx, count, reason, maxQuality = 6) {
  count = int(count, 'count', 1, 50);
  const pool = candidateCards(ctx, maxQuality);
  const drawn = [];
  for (let i = 0; i < count; i += 1) {
    const row = randomChoice(ctx, pool);
    const id = numericField(row, ['ID']);
    addAsset(ctx, 'cards', cardKey(id), 1, reason);
    drawn.push(cardKey(id));
  }
  return drawn;
}

function drawItems(ctx, count, excludedId, reason) {
  const pool = dataRows(ctx.tables, 'embeddata/scp/medicament.xml').filter(row => {
    const id = numericField(row, ['物品ID', 'ID'], 0);
    return id > 0 && id !== excludedId && Number(prefixedField(row, '作用id', 0)) !== 5 && itemDef(ctx.tables, id);
  });
  const drawn = [];
  for (let i = 0; i < count; i += 1) {
    const id = numericField(randomChoice(ctx, pool), ['物品ID', 'ID']);
    addAsset(ctx, 'inventory', itemKey(id), 1, reason);
    drawn.push(itemKey(id));
  }
  return drawn;
}

function grantConfiguredReward(ctx, type, id, count, reason) {
  count = int(count, 'reward count', 1);
  if (type === 1) return reward(ctx, { silver: count }, reason);
  if (type === 2 && id === 0) return reward(ctx, { gold: count }, reason);
  if (type === 2 || type === 4) return reward(ctx, { item: id, count }, reason);
  if (type === 3) return reward(ctx, { card: id, count }, reason);
  const state = { 5: ['towerCoins', 'towerCoins'], 6: ['activityPoints', 'activityPoints'], 7: ['honor', 'honor'], 10: ['advancedTowerCoins', 'advancedTowerCoins'] }[type];
  if (state) { ctx.actor.growth[state[0]] += count; return { [state[1]]: count }; }
  fail('reward type unsupported');
}

function earnedBattlePassLevel(g) {
  return Math.min(50, Math.max(Math.floor(g.counters.growthActions / 5), Math.floor(g.battlePass.exp / 500)) + 1);
}

function configuredCardRace(ctx, card) {
  if (numericField(card, ['Type'], 0) !== 1) return 0;
  const monster = monsterDef(ctx.tables, numericField(card, ['MonsterID'], 0));
  return numericField(monster, ['Phyle'], numericField(card, ['Race'], 0));
}

function cardFusionRecipe(ctx, first, second) {
  const quality = numericField(first, ['Quality'], -1);
  if (quality !== numericField(second, ['Quality'], -2) || numericField(first, ['Type']) !== 1 || numericField(second, ['Type']) !== 1) return undefined;
  const a = configuredCardRace(ctx, first), b = configuredCardRace(ctx, second);
  return dataRows(ctx.tables, 'embeddata/scp/cardronghe.xml').find(row => numericField(row, ['Quality'], -1) === quality && ((numericField(row, ['Race1']) === a && numericField(row, ['Race2']) === b) || (numericField(row, ['Race1']) === b && numericField(row, ['Race2']) === a)));
}

function refineByRecipe(ctx, p) {
  const target = numericId(p.cardId, 'card'), recipe = findBy(ctx.tables, 'embeddata/scp/ronglianpeifang.xml', ['cardid'], target);
  if (!recipe || !cardDef(ctx.tables, target)) fail('refining recipe missing');
  const materials = [];
  for (let i = 1; i <= 4; i += 1) {
    const id = numericField(recipe, [`goods${i}`], 0), count = numericField(recipe, [`column_${i * 2 + 1}`], 0);
    if (id && count) materials.push({ id, count });
  }
  for (const m of materials) if (own(ctx.actor.inventory, itemKey(m.id)) < m.count) fail(`insufficient ${itemKey(m.id)}`);
  for (const m of materials) takeAsset(ctx, 'inventory', itemKey(m.id), m.count, 'card-refining');
  addAsset(ctx, 'cards', cardKey(target), 1, 'card-refining');
  countGrowth(ctx, 'cardSynthesis');
  return { cardId: cardKey(target), materials: materials.map(m => ({ itemId: itemKey(m.id), count: m.count })) };
}

const handlers = {
  'test.grant'(ctx, p) {
    const g = ctx.actor.growth, key = String(dayKey(ctx.now));
    if (g.grants[key]) fail('daily test grant already claimed');
    const silver = int(p.silver ?? 500, 'silver', 0, LOCAL.dailyGrant.silver);
    const gold = int(p.gold ?? 10, 'gold', 0, LOCAL.dailyGrant.gold);
    const crystal = int(p.crystal ?? 100, 'crystal', 0, LOCAL.dailyGrant.crystal);
    const itemId = p.itemId === undefined ? 100 : numericId(p.itemId, 'item');
    if (!itemDef(ctx.tables, itemId)) fail('test grant item definition missing');
    const count = int(p.count ?? 1, 'count', 0, LOCAL.dailyGrant.itemCount);
    const granted = reward(ctx, { silver, gold, crystal }, 'local-test-grant');
    if (count) Object.assign(granted, reward(ctx, { item: itemId, count }, 'local-test-grant'));
    g.grants[key] = true;
    return { granted, nextAt: (dayKey(ctx.now) + 1) * DAY };
  },
  'test.unlockBattlePass'(ctx, p) {
    const pass = ctx.actor.growth.battlePass;
    const track = p.track === 'ultimate' ? 'ultimate' : p.track === 'premium' ? 'premium' : fail('battle pass track invalid');
    if (pass[track]) fail('battle pass track already active');
    if (pass.localUnlocks.includes(track)) fail('battle pass local unlock already used');
    if (track === 'ultimate') pass.premium = true;
    pass[track] = true;
    pass.localUnlocks.push(track);
    log(ctx.actor, ctx.now, 'unlock', `battle-pass:${track}`, 1, 'local-test-unlock');
    return { track, season: pass.season };
  },
  'inventory.use'(ctx, p) {
    const id = numericId(p.itemId, 'item'), key = itemKey(id), count = int(p.count ?? 1, 'count', 1, 99);
    const def = medicamentDef(ctx.tables, id);
    if (!def) fail('item is not a configured consumable');
    const reaction = Number(prefixedField(def, '作用id', 0));
    const p1 = medicineParam(def, 1), p2 = medicineParam(def, 2);
    let gained = {};
    let consume = count;
    if (reaction === 1) {
      if (count !== 1) fail('class crystal can only be used once');
      const profession = int(p.profession, 'profession', 1, 4);
      if (profession === ctx.actor.profession) fail('profession unchanged');
      ctx.actor.profession = profession;
      gained = { profession };
    } else if (reaction === 2) {
      const amount = p2 * count;
      if (p1 === 1) { grantCurrency(ctx, 'silver', amount, 'inventory-use'); gained.silver = amount; }
      else if (p1 === 2) { grantCurrency(ctx, 'gold', amount, 'inventory-use'); gained.gold = amount; }
      else if (p1 === 3) { ctx.actor.xp = int(ctx.actor.xp ?? 0, 'xp') + amount; gained.xp = amount; }
      else if (p1 === 4) { ctx.actor.growth.energy += amount; gained.energy = amount; }
      else if (p1 === 5) { grantCurrency(ctx, 'crystal', amount, 'inventory-use'); gained.crystal = amount; }
      else if (p1 === 6) {
        const reputationType = int(p2, 'reputation type', 1, 99), reputation = medicineParam(def, 3) * count;
        ctx.actor.growth.reputation[reputationType] = (ctx.actor.growth.reputation[reputationType] ?? 0) + reputation;
        gained = { reputationType, reputation };
      } else if (p1 === 7) { ctx.actor.growth.gems += amount; gained.gems = amount; }
      else if (p1 === 8) {
        const sceneId = int(p2, 'sceneId', 1), entries = medicineParam(def, 3) * count;
        ctx.actor.growth.dungeonEntries[sceneId] = (ctx.actor.growth.dungeonEntries[sceneId] ?? 0) + entries;
        gained = { sceneId, entries };
      } else if (p1 === 9) { ctx.actor.growth.petEssence += amount; gained.petEssence = amount; }
      else if (p1 === 10) { ctx.actor.growth.battlePass.exp += amount; gained.battlePassExp = amount; }
      else fail('numeric consumable effect unsupported');
    } else if (reaction === 3) {
      gained = { items: [] };
      for (let i = 1; i <= 11; i += 2) {
        const rewardId = medicineParam(def, i), rewardCount = medicineParam(def, i + 1) * count;
        if (rewardId && rewardCount) gained.items.push({ item: rewardId, count: rewardCount });
      }
      if (!gained.items.length) fail('consumable reward configuration missing');
    } else if (reaction === 4) {
      gained.cards = [];
      for (let i = 0; i < count; i += 1) gained.cards.push(...drawCards(ctx, 6, 'inventory-card-pack', 5));
    } else if (reaction === 5) {
      gained.drawnItems = drawItems(ctx, count, id, 'inventory-random-pack');
    } else if (reaction === 6) {
      if (count !== 1) fail('limited pack can only be used once at a time');
      const maxUses = int(numericField(def, ['使用次数（0：无限次使用）'], 1), 'limited uses', 1, 10);
      const used = int(ctx.actor.growth.limitedUses[key] ?? 0, 'limited use count', 0, maxUses - 1);
      const price = int(medicineParam(def, 3 + used), 'limited use price');
      if (price) debit(ctx, 'gold', price, 'inventory-limited-pack');
      gained = { cards: drawCards(ctx, 6, 'inventory-limited-pack', 5), use: used + 1, maxUses, gold: -price };
      if (used + 1 < maxUses) { ctx.actor.growth.limitedUses[key] = used + 1; consume = 0; }
      else delete ctx.actor.growth.limitedUses[key];
    } else if (reaction === 7) {
      if (count !== 1) fail('rename card can only be used once');
      const name = text(p.name, 'name', 18);
      if (!/^[\p{L}\p{N}_ -]+$/u.test(name)) fail('name contains unsupported characters');
      if (name === ctx.actor.name) fail('name unchanged');
      ctx.actor.name = name; gained = { name };
    } else if (reaction === 8) {
      if (count !== 1) fail('gender card can only be used once');
      const gender = int(p.gender, 'gender', 1, 2);
      if (ctx.actor.gender === gender) fail('gender unchanged');
      ctx.actor.gender = gender; gained = { gender };
    } else if (reaction === 9) {
      if (count !== 1) fail('transformation item can only be used once');
      ctx.actor.growth.transformation = p1; gained = { transformation: p1 };
    } else if (reaction === 10) {
      const need = int(p1, 'synthesis quantity', 1), batches = int(count, 'count', 1, 99), outputId = int(p2, 'output item', 1);
      consume = need * batches;
      if (!itemDef(ctx.tables, outputId)) fail('synthesis output definition missing');
      gained = { items: [{ item: outputId, count: batches }] };
    } else if (reaction === 11) {
      if (count !== 1) fail('title card can only be used once');
      const titleId = `item-title:${int(p1, 'titleId', 1)}`, duration = int(p2, 'title duration', 0, 3650);
      if (!ctx.actor.growth.titles.includes(titleId)) ctx.actor.growth.titles.push(titleId);
      ctx.actor.growth.titleExpiries ||= {};
      ctx.actor.growth.titleExpiries[titleId] = duration ? ctx.now + duration * DAY : 0;
      gained = { titleId, expiresAt: ctx.actor.growth.titleExpiries[titleId] };
    } else if (reaction === 12 || reaction === 999) {
      if (count !== 1) fail('battle pass token can only be used once');
      const track = reaction === 999 ? 'ultimate' : 'premium';
      if (track === 'ultimate' && !ctx.actor.growth.battlePass.premium) fail('premium battle pass required');
      if (ctx.actor.growth.battlePass[track]) fail('battle pass track already active');
      ctx.actor.growth.battlePass[track] = true; gained = { battlePass: track };
    } else if (reaction === 14) {
      if (count !== 1) fail('selection chest can only be used once');
      const group = int(p1, 'selection group', 1), choiceCount = int(p2, 'selection count', 1, 20);
      const rawChoices = Array.isArray(p.choices) ? p.choices : typeof p.choices === 'string' ? p.choices.split(',') : p.choice === undefined ? [] : [p.choice];
      const choices = rawChoices.map(value => int(value, 'choice', 1));
      if (choices.length !== choiceCount || new Set(choices).size !== choices.length) fail(`selection chest requires ${choiceCount} unique choices`);
      const pool = dataRows(ctx.tables, 'embeddata/scp/selectchestreward.xml').filter(row => numericField(row, ['GroupID'], -1) === group);
      const selected = choices.map(choice => pool.find(row => numericField(row, ['shortID'], -1) === choice));
      if (selected.some(row => !row)) fail('selection chest choice missing');
      gained = selected.map(row => grantConfiguredReward(ctx, numericField(row, ['RewardTYPE']), numericField(row, ['RewardID']), numericField(row, ['RewardNum'], 1), 'inventory-selection-chest'));
    } else fail('item has no directly usable effect');
    if (consume) takeAsset(ctx, 'inventory', key, consume, 'inventory-use');
    for (const x of gained.items ?? []) addAsset(ctx, 'inventory', itemKey(x.item), x.count, 'inventory-use');
    countGrowth(ctx);
    return { consumed: { itemId: key, count: consume }, gained };
  },
  'inventory.sell'(ctx, p) {
    const id = numericId(p.itemId, 'item'), key = itemKey(id), count = int(p.count ?? 1, 'count', 1, 9999);
    if (ctx.actor.growth.warehouseLocks[key]) fail('item locked');
    const def = itemDef(ctx.tables, id);
    if (!def) fail('item definition missing');
    const flags = numericField(def, ['绑定标志位(按位设置0不允许1允许)', '绑定标志位(按位设置0不允许1允许)'], 0);
    if (flags && (flags & 0x40) === 0) fail('item cannot be sold');
    const price = int(Math.max(1, numericField(def, ['卖出基础价格'], 1)), 'sell price', 1);
    takeAsset(ctx, 'inventory', key, count, 'inventory-sell');
    grantCurrency(ctx, 'silver', price * count, 'inventory-sell');
    return { sold: { itemId: key, count }, silver: price * count };
  },
  'equipment.equip'(ctx, p) {
    const id = numericId(p.itemId, 'item'), key = itemKey(id), def = equipmentDef(ctx.tables, id);
    if (!def) fail('equipment definition missing');
    if (!own(ctx.actor.inventory, key)) fail(`insufficient ${key}`);
    const requiredLevel = numericField(def, ['使用等级'], 0) + 1;
    const profession = numericField(def, ['使用职业'], 0);
    if (ctx.actor.level < requiredLevel) fail('equipment level locked');
    if (profession && profession !== ctx.actor.profession) fail('equipment profession locked');
    const slot = String(int(p.slot ?? numericField(def, ['可装备位置1 无效填-1\n', '可装备位置1'], -1), 'slot', 0, 20));
    const previous = ctx.actor.equipment[slot];
    takeAsset(ctx, 'inventory', key, 1, 'equipment-equip');
    if (previous) addAsset(ctx, 'inventory', previous, 1, 'equipment-unequip-swap');
    ctx.actor.equipment[slot] = key;
    countGrowth(ctx);
    return { slot, itemId: key, previous: previous ?? null };
  },
  'equipment.unequip'(ctx, p) {
    const slot = String(int(p.slot, 'slot', 0, 20)), key = ctx.actor.equipment[slot];
    if (!key) fail('equipment slot empty');
    delete ctx.actor.equipment[slot];
    addAsset(ctx, 'inventory', key, 1, 'equipment-unequip');
    return { slot, itemId: key };
  },
  'equipment.enhance'(ctx, p) {
    const id = numericId(p.itemId, 'item'), key = itemKey(id), def = equipmentDef(ctx.tables, id);
    if (!def) fail('equipment definition missing');
    const equipped = Object.values(ctx.actor.equipment).includes(key);
    if (!equipped && !own(ctx.actor.inventory, key)) fail(`insufficient ${key}`);
    const level = int(ctx.actor.enhancements[key] ?? 0, 'enhancement', 0, 20);
    if (level >= 20) fail('equipment enhancement maxed');
    const stoneId = level < 5 ? 100 : level < 10 ? 101 : level < 15 ? 102 : 103;
    const q = findBy(ctx.tables, 'embeddata/scp/qianghua.xml', ['level'], level);
    const chance = int(numericField(q, ['QiangHuaShi1'], Math.max(1500, 8000 - level * 300)), 'chance', 0, 10000);
    takeAsset(ctx, 'inventory', itemKey(stoneId), 1, 'equipment-enhance');
    debit(ctx, 'silver', 50 * (level + 1), 'equipment-enhance');
    const success = ctx.randomInt(10000) < chance;
    if (success) ctx.actor.enhancements[key] = level + 1;
    countGrowth(ctx);
    return { itemId: key, success, chance, level: success ? level + 1 : level };
  },
  'equipment.craft'(ctx, p) {
    const target = numericId(p.itemId, 'item'), targetDef = equipmentDef(ctx.tables, target);
    if (!targetDef) fail('equipment definition missing');
    const source = dataRows(ctx.tables, 'embeddata/scp/equipment.xml').find(r => numericField(r, ['合成装备ID'], 0) === target);
    if (!source) fail('equipment recipe missing');
    const sourceId = numericField(source, ['物品ID\n', '物品ID', 'ID']);
    takeAsset(ctx, 'inventory', itemKey(sourceId), 3, 'equipment-craft');
    debit(ctx, 'silver', 200, 'equipment-craft');
    addAsset(ctx, 'inventory', itemKey(target), 1, 'equipment-craft');
    countGrowth(ctx);
    return { itemId: itemKey(target), consumed: { itemId: itemKey(sourceId), count: 3 } };
  },
  'equipment.runeCraft'(ctx, p) {
    const recipeId = int(p.recipeId, 'recipeId', 1), row = findBy(ctx.tables, 'embeddata/scp/peifang.xml', ['配方公式ID'], recipeId);
    if (!row) fail('rune recipe missing');
    const product = numericField(row, ['符文(产品)ID']), material = numericField(row, ['配方(材料)ID：warrant配方物品']);
    const cost = int(numericField(row, ['消耗水晶'], 0), 'crystal cost', 0);
    takeAsset(ctx, 'inventory', itemKey(material), 1, 'rune-craft');
    if (cost) debit(ctx, 'crystal', cost, 'rune-craft');
    addAsset(ctx, 'inventory', itemKey(product), 1, 'rune-craft');
    countGrowth(ctx);
    return { recipeId, itemId: itemKey(product) };
  },
  'equipment.refine'(ctx, p) {
    const id = numericId(p.itemId, 'item'), key = itemKey(id);
    if (!equipmentDef(ctx.tables, id)) fail('equipment definition missing');
    if (!own(ctx.actor.inventory, key) && !Object.values(ctx.actor.equipment).includes(key)) fail(`insufficient ${key}`);
    const rank = int(ctx.actor.growth.refinements[key] ?? 0, 'refinement', 0, 10);
    if (rank >= 10) fail('equipment refinement maxed');
    debit(ctx, 'silver', 150 * (rank + 1), 'equipment-refine');
    ctx.actor.growth.refinements[key] = rank + 1;
    countGrowth(ctx);
    return { itemId: key, rank: rank + 1 };
  },
  'magic.dismantle'(ctx, p) {
    const id = numericId(p.cardId, 'card'), key = cardKey(id), count = int(p.count ?? 1, 'count', 1, 99), def = cardDef(ctx.tables, id);
    if (!def) fail('card definition missing');
    takeAsset(ctx, 'cards', key, count, 'card-dismantle');
    const quality = int(numericField(def, ['Quality'], 0), 'quality', 0, 6);
    const dust = (quality + 1) * 10 * count;
    grantCurrency(ctx, 'crystal', dust, 'card-dismantle');
    countGrowth(ctx);
    return { cardId: key, count, crystal: dust };
  },
  'magic.synthesize'(ctx, p) {
    const id = numericId(p.cardId, 'card'), def = cardDef(ctx.tables, id), key = cardKey(id);
    if (!def) fail('card definition missing');
    const next = int(numericField(def, ['NextCardID'], 0), 'next card', 1);
    const chance = int(numericField(def, ['heChengRate'], 3500), 'chance', 0, 10000);
    takeAsset(ctx, 'cards', key, 3, 'card-synthesis');
    debit(ctx, 'silver', 100, 'card-synthesis');
    const success = ctx.randomInt(10000) < chance;
    if (success) addAsset(ctx, 'cards', cardKey(next), 1, 'card-synthesis');
    countGrowth(ctx, 'cardSynthesis');
    return { sourceCardId: key, success, chance, cardId: success ? cardKey(next) : null };
  },
  'magic.refine'(ctx, p) { return refineByRecipe(ctx, p); },
  'magic.fuse'(ctx, p) { return refineByRecipe(ctx, p); },
  'magic.enchant'(ctx, p) {
    const firstId = numericId(p.cardId, 'card'), secondId = numericId(p.materialCardId, 'card');
    const first = cardDef(ctx.tables, firstId), second = cardDef(ctx.tables, secondId), recipe = cardFusionRecipe(ctx, first, second);
    if (!first || !second || !recipe) fail('card enchantment recipe missing');
    const alchemy = ctx.actor.growth.city.buildings.alchemy;
    if (alchemy.readyAt > ctx.now) fail('alchemy upgrading');
    if (alchemy.level < numericField(recipe, ['AlchemyLv'], 0)) fail('alchemy level locked');
    const materialId = numericField(recipe, ['NeedGoodsId']), materialCount = numericField(recipe, ['NeedGoodsNum'], 1);
    const neededFirst = firstId === secondId ? 2 : 1;
    if (own(ctx.actor.cards, cardKey(firstId)) < neededFirst || own(ctx.actor.cards, cardKey(secondId)) < 1) fail('insufficient enchantment cards');
    if (own(ctx.actor.inventory, itemKey(materialId)) < materialCount) fail(`insufficient ${itemKey(materialId)}`);
    const group = numericField(recipe, ['ProductId']);
    const outcomes = dataRows(ctx.tables, 'embeddata/scp/cardronghegailv.xml').filter(row => numericField(row, ['RongheId'], -1) === group).sort((a, b) => numericField(a, ['Probability']) - numericField(b, ['Probability']));
    if (!outcomes.length) fail('card enchantment outcomes missing');
    const roll = ctx.randomInt(1_000_000) + 1;
    const selected = outcomes.find(row => roll <= numericField(row, ['Probability'])) ?? outcomes[outcomes.length - 1];
    const resultId = numericField(selected, ['Card']);
    if (!cardDef(ctx.tables, resultId)) fail('card enchantment result missing');
    takeAsset(ctx, 'cards', cardKey(firstId), 1, 'card-enchantment');
    takeAsset(ctx, 'cards', cardKey(secondId), 1, 'card-enchantment');
    takeAsset(ctx, 'inventory', itemKey(materialId), materialCount, 'card-enchantment');
    addAsset(ctx, 'cards', cardKey(resultId), 1, 'card-enchantment');
    countGrowth(ctx, 'cardSynthesis');
    return { sourceCardIds: [cardKey(firstId), cardKey(secondId)], cardId: cardKey(resultId), roll, recipeId: numericField(recipe, ['Id']) };
  },
  'magic.point'(ctx, p) {
    const sourceId = numericId(p.cardId, 'card'), source = cardDef(ctx.tables, sourceId);
    if (!source) fail('card definition missing');
    const quality = numericField(source, ['Quality'], -1), type = numericField(source, ['Type'], 0);
    const monster = type === 1 ? monsterDef(ctx.tables, numericField(source, ['MonsterID'], 0)) : undefined;
    const unique = numericField(monster, ['Unique'], 0), race = numericField(source, ['Race'], 0);
    const rows = dataRows(ctx.tables, 'embeddata/scp/dianhua.xml');
    const recipe = rows.find(row => numericField(row, ['Quality'], -1) === quality && numericField(row, ['Unique'], 0) === unique && numericField(row, ['Phyle'], 0) === race)
      ?? rows.find(row => numericField(row, ['Quality'], -1) === quality && numericField(row, ['Unique'], 0) === unique && numericField(row, ['Phyle'], 0) === 0);
    if (!recipe) fail('card pointing recipe missing');
    const alchemy = ctx.actor.growth.city.buildings.alchemy;
    if (alchemy.readyAt > ctx.now) fail('alchemy upgrading');
    if (alchemy.level < numericField(recipe, ['alchemylvl'], 0)) fail('alchemy level locked');
    const resultQuality = numericField(recipe, ['ResultQuality'], -1);
    let target = source;
    for (let i = 0; i < 8 && numericField(target, ['Quality'], -1) < resultQuality; i += 1) target = cardDef(ctx.tables, numericField(target, ['NextCardID'], 0));
    const resultId = numericField(target, ['ID'], 0);
    if (!resultId || numericField(target, ['Quality'], -1) !== resultQuality) fail('card pointing result missing');
    const materialCards = Array.isArray(p.materialCards) ? p.materialCards : [];
    if (materialCards.length > 20) fail('too many pointing materials');
    const cardNeeds = new Map([[sourceId, 1]]), normalized = [];
    let discount = 0;
    for (const raw of materialCards) {
      if (!raw || typeof raw !== 'object') fail('pointing material invalid');
      const id = numericId(raw.cardId, 'card'), count = int(raw.count ?? 1, 'material count', 1, 20), card = cardDef(ctx.tables, id);
      if (!card) fail('pointing material card missing');
      const materialRecipe = rows.find(row => numericField(row, ['Quality'], -1) === numericField(card, ['Quality'], -2) && numericField(row, ['Unique'], 0) === 0 && numericField(row, ['Phyle'], 0) === 0);
      if (!materialRecipe) fail('pointing material configuration missing');
      cardNeeds.set(id, (cardNeeds.get(id) ?? 0) + count);
      normalized.push({ id, count });
      discount += numericField(materialRecipe, ['ReplaceMoney'], 0) * count;
    }
    for (const [id, count] of cardNeeds) if (own(ctx.actor.cards, cardKey(id)) < count) fail(`insufficient ${cardKey(id)}`);
    const goodsId = numericField(recipe, ['NeedGoodsID']), goodsCount = numericField(recipe, ['NeedGoodsNum'], 1);
    if (own(ctx.actor.inventory, itemKey(goodsId)) < goodsCount) fail(`insufficient ${itemKey(goodsId)}`);
    const base = numericField(recipe, ['NeedMoney'], 0), buildingDiscount = Math.floor(base * alchemy.level * 0.005), silver = Math.max(0, base - discount - buildingDiscount);
    takeAsset(ctx, 'cards', cardKey(sourceId), 1, 'card-pointing');
    for (const material of normalized) takeAsset(ctx, 'cards', cardKey(material.id), material.count, 'card-pointing');
    takeAsset(ctx, 'inventory', itemKey(goodsId), goodsCount, 'card-pointing');
    if (silver) debit(ctx, 'silver', silver, 'card-pointing');
    addAsset(ctx, 'cards', cardKey(resultId), 1, 'card-pointing');
    ctx.actor.growth.cardPointing[cardKey(resultId)] = (ctx.actor.growth.cardPointing[cardKey(resultId)] ?? 0) + 1;
    countGrowth(ctx, 'cardSynthesis');
    return { sourceCardId: cardKey(sourceId), cardId: cardKey(resultId), silver, materialCards: normalized.map(x => ({ cardId: cardKey(x.id), count: x.count })) };
  },
  'magic.jar'(ctx, p) {
    const count = int(p.count ?? 1, 'count', 1, 10), cost = count * 25;
    debit(ctx, 'crystal', cost, 'magic-jar');
    const cards = drawCards(ctx, count, 'magic-jar', 4);
    countGrowth(ctx);
    return { cards, crystal: cost };
  },
  'shop.buy'(ctx, p) { return buyOffer(ctx, p.offerId, 'supply:'); },
  'shop.openPack'(ctx, p) { return buyOffer(ctx, p.offerId ?? 'pack:basic', 'pack:'); },
  'shop.openTen'(ctx) { return buyOffer(ctx, 'pack:ten', 'pack:'); },
  'shop.buyLimited'(ctx, p) { return buyOffer(ctx, p.offerId ?? 'limited:crystal', 'limited:'); },
  'shop.exchange'(ctx, p) { return buyOffer(ctx, p.offerId ?? 'exchange:crystal', 'exchange:'); },
  'shop.reputation.buy'(ctx, p) {
    const id = numericId(p.cardId, 'card'), offer = reputationShopOffers(ctx.tables).find(candidate => candidate.cardId === id);
    if (!offer || !cardDef(ctx.tables, id)) fail('reputation shop offer missing');
    if (reputationLevel(ctx, offer.reputationType) < offer.requiredLevel) fail('reputation shop level locked');
    debit(ctx, 'silver', offer.price, 'reputation-shop');
    addAsset(ctx, 'cards', cardKey(id), 1, 'reputation-shop');
    countGrowth(ctx);
    return { cardId: cardKey(id), reputationType: offer.reputationType, requiredLevel: offer.requiredLevel, silver: offer.price };
  },
  'shop.skill.buy'(ctx, p) {
    const id = numericId(p.cardId, 'card'), offer = professionSkillOffers(ctx).find(candidate => candidate.cardId === id);
    if (!offer) fail('profession skill unavailable');
    const key = cardKey(id);
    if (own(ctx.actor.cards, key) >= 3) fail('profession skill holding limit reached');
    debit(ctx, 'silver', 150, 'profession-skill-shop');
    addAsset(ctx, 'cards', key, 1, 'profession-skill-shop');
    countGrowth(ctx);
    return { cardId: key, silver: 150, owned: own(ctx.actor.cards, key), local: true };
  },
  'warehouse.lock'(ctx, p) {
    const id = numericId(p.itemId, 'item'), key = itemKey(id);
    if (!own(ctx.actor.inventory, key) && !own(ctx.actor.warehouse, key)) fail(`insufficient ${key}`);
    const locked = p.locked !== false;
    if (locked) {
      ctx.actor.growth.warehouseLocks[key] = true;
      if (!ctx.actor.lockedItems.includes(key)) ctx.actor.lockedItems.push(key);
    } else {
      delete ctx.actor.growth.warehouseLocks[key];
      ctx.actor.lockedItems = ctx.actor.lockedItems.filter(x => x !== key);
    }
    return { itemId: key, locked };
  },
  'warehouse.move'(ctx, p) {
    const id = numericId(p.itemId, 'item'), key = itemKey(id), count = int(p.count ?? 1, 'count', 1, 9999), to = p.to;
    if (ctx.actor.growth.warehouseLocks[key]) fail('item locked');
    if (to === 'warehouse') {
      if (!ctx.actor.warehouse[key] && Object.keys(ctx.actor.warehouse).length >= 100) fail('warehouse full');
      takeAsset(ctx, 'inventory', key, count, 'warehouse-deposit'); addAsset(ctx, 'warehouse', key, count, 'warehouse-deposit');
    } else if (to === 'inventory') {
      takeAsset(ctx, 'warehouse', key, count, 'warehouse-withdraw'); addAsset(ctx, 'inventory', key, count, 'warehouse-withdraw');
    } else fail('warehouse destination invalid');
    return { itemId: key, count, to };
  },
  'pet.adopt'(ctx, p) {
    const id = int(p.petId, 'petId', 1), def = petDef(ctx.tables, id);
    if (!def) fail('pet definition missing');
    if (ctx.actor.level < 3) fail('pet feature level locked');
    if (ctx.actor.growth.pets[id]) fail('pet already adopted');
    debit(ctx, 'silver', 300 + numericField(def, ['Quality'], 0) * 200, 'pet-adopt');
    ctx.actor.growth.pets[id] = { level: 1, exp: 0, skills: [numericField(def, ['GiftId'], 0)].filter(Boolean) };
    countGrowth(ctx, 'petCare');
    return { petId: id, pet: ctx.actor.growth.pets[id] };
  },
  'pet.feed'(ctx, p) {
    const id = int(p.petId, 'petId', 1), pet = ctx.actor.growth.pets[id];
    if (!pet) fail('pet not adopted');
    const foodId = p.itemId === undefined ? 1101 : numericId(p.itemId, 'item'), count = int(p.count ?? 1, 'count', 1, 20);
    const food = medicamentDef(ctx.tables, foodId);
    if (!food || Number(prefixedField(food, '作用id', 0)) !== 2 || medicineParam(food, 1) !== 9) fail('item is not pet essence');
    takeAsset(ctx, 'inventory', itemKey(foodId), count, 'pet-feed');
    pet.exp += medicineParam(food, 2) * 10 * count;
    countGrowth(ctx, 'petCare');
    return { petId: id, exp: pet.exp };
  },
  'pet.upgrade'(ctx, p) {
    const id = int(p.petId, 'petId', 1), pet = ctx.actor.growth.pets[id], def = petDef(ctx.tables, id);
    if (!pet || !def) fail('pet not adopted');
    if (pet.level >= 50) fail('pet level maxed');
    const quality = numericField(def, ['Quality'], 0);
    const row = dataRows(ctx.tables, 'embeddata/scp/petexp.xml').find(r => numericField(r, ['Quality'], -1) === quality && numericField(r, ['Grade'], -1) === pet.level + 1);
    const need = int(numericField(row, ['Exp'], 100 + pet.level * 100), 'pet exp', 1);
    if (pet.exp < need) fail('insufficient pet experience');
    pet.exp -= need; pet.level += 1;
    countGrowth(ctx, 'petCare');
    return { petId: id, level: pet.level, exp: pet.exp };
  },
  'pet.learnSkill'(ctx, p) {
    const id = int(p.petId, 'petId', 1), skillId = int(p.skillId, 'skillId', 1), pet = ctx.actor.growth.pets[id], def = petDef(ctx.tables, id);
    if (!pet || !def) fail('pet not adopted');
    const allowed = String(field(def, ['SkillID'], '')).split(',').map(Number).filter(Boolean);
    if (!allowed.includes(skillId)) fail('pet skill unavailable');
    if (pet.skills.includes(skillId)) fail('pet skill already learned');
    if (pet.skills.length >= 4) fail('pet skill slots full');
    debit(ctx, 'gold', 2, 'pet-learn-skill');
    pet.skills.push(skillId);
    countGrowth(ctx, 'petCare');
    return { petId: id, skills: pet.skills };
  },
  'mount.adopt'(ctx, p) {
    const id = numericId(p.itemId, 'item'), def = equipmentDef(ctx.tables, id), key = itemKey(id);
    if (!def || numericField(def, ['物品小类'], -1) !== 12) fail('mount equipment definition missing');
    if (ctx.actor.growth.mounts[id]) fail('mount already adopted');
    takeAsset(ctx, 'inventory', key, 1, 'mount-adopt');
    ctx.actor.growth.mounts[id] = { level: 1 };
    countGrowth(ctx);
    return { mountId: id, mount: ctx.actor.growth.mounts[id] };
  },
  'mount.upgrade'(ctx, p) {
    const id = int(p.mountId, 'mountId', 1), mount = ctx.actor.growth.mounts[id];
    if (!mount) fail('mount not adopted');
    if (mount.level >= 20) fail('mount level maxed');
    debit(ctx, 'silver', mount.level * 200, 'mount-upgrade');
    mount.level += 1; countGrowth(ctx);
    return { mountId: id, level: mount.level };
  },
  'mount.equip'(ctx, p) {
    const id = int(p.mountId, 'mountId', 1);
    if (!ctx.actor.growth.mounts[id]) fail('mount not adopted');
    ctx.actor.growth.activeMount = id;
    return { mountId: id };
  },
  'reputation.claim'(ctx, p) {
    const type = int(p.type, 'type', 1, 99), level = int(p.level, 'level', 1, 99), key = `${type}:${level}`;
    if (ctx.actor.growth.reputationClaims.includes(key)) fail('reputation reward already claimed');
    const row = dataRows(ctx.tables, 'embeddata/scp/reputation.xml').find(r => numericField(r, ['声望类型'], -1) === type && numericField(r, ['声望等级'], -1) === level);
    if (!row) fail('reputation reward missing');
    const need = numericField(row, ['需要声望值'], 0);
    if ((ctx.actor.growth.reputation[type] ?? 0) < need) fail('insufficient reputation');
    const gained = reward(ctx, { silver: 100 * level, gold: level % 5 === 0 ? 2 : 0 }, 'reputation-claim');
    ctx.actor.growth.reputationClaims.push(key);
    return { type, level, gained };
  },
  'title.equip'(ctx, p) {
    const id = text(p.titleId, 'titleId'), title = LOCAL.titles.find(t => t.id === id), g = ctx.actor.growth;
    if (title) {
      const total = Object.values(g.reputation).reduce((a, b) => a + Number(b || 0), 0);
      if (total < title.need) fail('title locked');
      if (!g.titles.includes(id)) g.titles.push(id);
    } else {
      if (!g.titles.includes(id)) fail('title missing');
      const expiresAt = g.titleExpiries?.[id] ?? 0;
      if (expiresAt && expiresAt <= ctx.now) fail('title expired');
    }
    ctx.actor.growth.activeTitle = id;
    return { titleId: id };
  },
  'profile.update'(ctx, p) {
    const result = {};
    const requestedAvatar = p.avatarAssetId !== undefined ? p.avatarAssetId : p.avatar;
    if (requestedAvatar !== undefined) {
      const assetId = text(requestedAvatar, 'avatarAssetId', 80);
      if (!avatarOptions(ctx).some(option => option.assetId === assetId)) fail('avatar asset unavailable');
      ctx.actor.growth.profile.avatarAssetId = assetId;
      result.avatarAssetId = assetId;
    }
    if (p.name !== undefined) {
      const name = text(p.name, 'name', 18);
      if (!/^[\p{L}\p{N}_ -]+$/u.test(name)) fail('name contains unsupported characters');
      if (name !== ctx.actor.name) { debit(ctx, 'gold', 5, 'profile-rename'); ctx.actor.name = name; }
      result.name = ctx.actor.name;
    }
    if (!Object.keys(result).length) fail('profile update empty');
    return result;
  },
  'city.upgrade'(ctx, p) {
    const id = text(p.buildingId, 'buildingId'), building = ctx.actor.growth.city.buildings[id];
    if (!building) fail('building missing');
    if (building.readyAt > ctx.now) fail('building upgrade in progress');
    const maxLevel = 20;
    if (building.level >= maxLevel) fail('building maxed');
    const next = building.level + 1;
    debit(ctx, 'silver', 500 * next, 'city-upgrade');
    building.pendingLevel = next;
    building.readyAt = ctx.now + next * HOUR;
    countGrowth(ctx);
    return { buildingId: id, pendingLevel: next, readyAt: building.readyAt };
  },
  'city.tax'(ctx) {
    const city = ctx.actor.growth.city, day = dayKey(ctx.now);
    if (city.lastTaxDay === day) fail('city tax already collected');
    if (city.buildings.castle.readyAt > ctx.now) fail('castle upgrading');
    const amount = city.buildings.castle.level * 300;
    city.lastTaxDay = day; grantCurrency(ctx, 'silver', amount, 'city-tax');
    return { silver: amount, nextAt: (day + 1) * DAY };
  },
  'activity.loginClaim'(ctx) {
    const a = ctx.actor.growth.activities, day = dayKey(ctx.now);
    if (a.loginDay === day) fail('daily login already claimed');
    a.loginStreak = a.loginDay === day - 1 ? Math.min(7, a.loginStreak + 1) : 1;
    a.loginDay = day;
    const gained = reward(ctx, { silver: 100 * a.loginStreak, gold: a.loginStreak === 7 ? 5 : 0 }, 'daily-login');
    return { streak: a.loginStreak, gained };
  },
  'activity.checkin'(ctx) {
    const a = ctx.actor.growth.activities, day = dayKey(ctx.now);
    if (a.checkinDay === day) fail('daily checkin already claimed');
    a.checkinDay = day; a.checkins += 1;
    const gained = reward(ctx, a.checkins % 7 === 0 ? { item: 6001, count: 2 } : { item: 6001, count: 1 }, 'daily-checkin');
    return { checkins: a.checkins, gained };
  },
  'activity.chest'(ctx, p) {
    const index = int(p.index, 'index', 1, 10), row = dataRows(ctx.tables, 'embeddata/scp/livelyprize.xml')[index - 1];
    if (!row) fail('activity chest missing');
    const key = `${dayKey(ctx.now)}:${index}`;
    if (ctx.actor.growth.activities.chests.includes(key)) fail('activity chest already claimed');
    const need = numericField(row, ['需要活跃度'], index * 20);
    if (ctx.actor.growth.dailyCounters.growthActions < need) fail('insufficient activity');
    const prefix = ['战士', '游侠', '法师', '牧师'][ctx.actor.profession - 1] ?? '战士';
    const type = numericField(row, [`${prefix}奖励1 type 1银币 2金币 3道具`, `${prefix}奖励1 type`], 1);
    const id = numericField(row, [`${prefix}奖励1 ID`], 0), count = numericField(row, [`${prefix}奖励1 数量`], 1);
    const gained = type === 1 ? reward(ctx, { silver: count }, 'activity-chest') : type === 2 ? reward(ctx, { gold: count }, 'activity-chest') : reward(ctx, { item: id, count }, 'activity-chest');
    ctx.actor.growth.activities.chests.push(key);
    return { index, gained };
  },
  'activity.wheel'(ctx) {
    const a = ctx.actor.growth.activities, day = dayKey(ctx.now);
    if (a.wheelDay !== day) { a.wheelDay = day; a.wheelCount = 0; }
    if (a.wheelCount >= 3) fail('daily wheel limit reached');
    debit(ctx, 'silver', 100, 'activity-wheel'); a.wheelCount += 1;
    const prizes = [{ silver: 120 }, { silver: 250 }, { gold: 2 }, { crystal: 20 }, { item: 6001, count: 1 }];
    return { spin: a.wheelCount, gained: reward(ctx, randomChoice(ctx, prizes), 'activity-wheel') };
  },
  'activity.wish'(ctx, p) {
    const group = int(p.group ?? 1, 'group', 1, 2), a = ctx.actor.growth.activities, day = dayKey(ctx.now);
    if (a.wishDay === day) fail('daily wish already made');
    const pool = dataRows(ctx.tables, 'embeddata/scp/makewish.xml').filter(r => numericField(r, ['许愿礼包'], 0) === group);
    if (!pool.length) fail('wish group missing');
    debit(ctx, 'gold', group === 1 ? 2 : 5, 'activity-wish');
    const row = randomChoice(ctx, pool), type = numericField(row, ['column_2']), id = numericField(row, ['column_3']), count = numericField(row, ['column_4'], 1);
    const gained = type === 0 ? reward(ctx, { gold: count }, 'activity-wish') : type === 1 ? reward(ctx, { silver: count }, 'activity-wish') : reward(ctx, { item: id, count }, 'activity-wish');
    a.wishDay = day;
    return { group, gained };
  },
  'activity.weeklyGrant'(ctx) {
    const activities = ctx.actor.growth.activities, week = String(weekKey(ctx.now));
    if (activities.weeklyClaims[week]) fail('weekly local grant already claimed');
    if (ctx.actor.growth.counters.growthActions < 7) fail('weekly local grant locked');
    activities.weeklyClaims[week] = true;
    return { week: Number(week), gained: reward(ctx, { silver: 700, crystal: 70 }, 'weekly-local-grant') };
  },
  'activity.rewardBonus'(ctx) {
    const activities = ctx.actor.growth.activities, week = String(weekKey(ctx.now));
    if (activities.bonusClaims[week]) fail('weekly reward bonus already claimed');
    if (ctx.actor.growth.counters.growthActions < 20) fail('weekly reward bonus locked');
    activities.bonusClaims[week] = true;
    return { week: Number(week), gained: reward(ctx, { gold: 5, item: 6001, count: 2 }, 'weekly-reward-bonus') };
  },
  'quest.returnClaim'(ctx) {
    const g = ctx.actor.growth;
    if (g.returnClaimed) fail('return reward already claimed');
    if (!g.returnEligible) fail('return reward locked');
    g.returnClaimed = true;
    g.returnEligible = false;
    return { gained: reward(ctx, { silver: 1500, gold: 10, item: 6001, count: 3 }, 'return-reward') };
  },
  'quest.repeatClaim'(ctx, p) {
    const id = text(p.questId, 'questId'), q = LOCAL.repeatQuests.find(x => x.id === id), day = dayKey(ctx.now), key = `${day}:${id}`;
    if (!q) fail('repeat quest missing');
    if (ctx.actor.growth.repeatClaims[key]) fail('repeat quest already claimed');
    if ((ctx.actor.growth.dailyCounters[q.counter] ?? 0) < q.need) fail('repeat quest incomplete');
    ctx.actor.growth.repeatClaims[key] = true;
    return { questId: id, gained: reward(ctx, q.reward, 'repeat-quest') };
  },
  'battlePass.claim'(ctx, p) {
    const level = int(p.level, 'level', 1, 50), track = p.track ?? 'free', pass = ctx.actor.growth.battlePass;
    if (!['free', 'premium', 'ultimate'].includes(track)) fail('battle pass track invalid');
    if (track === 'premium' && !pass.premium) fail('premium battle pass locked');
    if (track === 'ultimate' && !pass.ultimate) fail('ultimate battle pass locked');
    const claimKey = `${track}:${level}`;
    if (pass.claimed.includes(claimKey) || (track === 'free' && pass.claimed.includes(level))) fail('battle pass reward already claimed');
    const earnedLevel = earnedBattlePassLevel(ctx.actor.growth);
    if (earnedLevel < level) fail('battle pass level locked');
    const levelRow = dataRows(ctx.tables, 'embeddata/scp/battlepasslevelconfig.xml').find(r => numericField(r, ['level'], -1) === level);
    const rewardGroup = track === 'free' ? numericField(levelRow, ['regular_Id'], 0) : numericField(levelRow, ['advanced_Id'], 0);
    const config = rewardGroup ? dataRows(ctx.tables, 'embeddata/scp/battlepassrewardconfig.xml').filter(r => numericField(r, ['groupId'], -1) === rewardGroup) : [];
    let gained;
    if (track === 'ultimate') {
      gained = [reward(ctx, level % 5 === 0 ? { gold: 2, crystal: 50 } : { crystal: 25 }, 'battle-pass-ultimate')];
    } else if (config.length) {
      gained = [];
      for (const r of config) {
        const type = numericField(r, ['type']), id = numericField(r, ['goodId']), count = numericField(r, ['goodNum'], 1);
        gained.push(type === 0 ? reward(ctx, { gold: count }, 'battle-pass') : reward(ctx, { item: id, count }, 'battle-pass'));
      }
    } else gained = [reward(ctx, level % 5 === 0 ? { gold: 3 } : { silver: 200 }, 'battle-pass')];
    pass.claimed.push(claimKey);
    return { level, track, earnedLevel, gained };
  },
  'summon.world'(ctx, p) {
    const count = int(p.count ?? 1, 'count', 1, 10);
    debit(ctx, 'crystal', count * 30, 'summon-world');
    const cards = drawCards(ctx, count, 'summon-world', 5);
    countGrowth(ctx);
    return { cards };
  }
};

function buyOffer(ctx, offerId, prefix) {
  const id = text(offerId, 'offerId'), offer = LOCAL.shop[id];
  if (!offer || !id.startsWith(prefix)) fail('shop offer missing');
  const daily = ctx.actor.growth.shopDaily.counts[id] ?? 0;
  if (offer.dailyLimit && daily >= offer.dailyLimit) fail('shop daily limit reached');
  debit(ctx, offer.currency, offer.price, `shop:${id}`);
  let result;
  if (offer.pack) result = { cards: drawCards(ctx, offer.pack, `shop:${id}`, id === 'pack:ten' ? 5 : 3) };
  else if (offer.reward.currency) { grantCurrency(ctx, offer.reward.currency, offer.reward.count, `shop:${id}`); result = { [offer.reward.currency]: offer.reward.count }; }
  else result = reward(ctx, offer.reward, `shop:${id}`);
  ctx.actor.growth.shopDaily.counts[id] = daily + 1;
  countGrowth(ctx);
  return { offerId: id, received: result, purchasesToday: daily + 1 };
}

function reputationShopOffers(tables) {
  const offers = [];
  let reputationType = 0, requiredLevel = 0;
  for (const row of rows(tables, 'embeddata/scp/reputationshop.xml')) {
    if (row?._tag === 'reputation') reputationType = numericField(row, ['type']);
    else if (row?._tag === 'level') requiredLevel = numericField(row, ['value']);
    else if (row?._tag === 'card' && numericField(row, ['type']) === 1) {
      const cardId = numericField(row, ['id']), price = numericField(row, ['price']);
      if (reputationType > 0 && requiredLevel > 0 && cardId > 0 && price > 0 && cardDef(tables, cardId)) {
        offers.push({ reputationType, requiredLevel, cardId, price });
      }
    }
  }
  return offers;
}

function reputationLevel(ctx, type) {
  const points = Number(ctx.actor.growth.reputation[type] ?? 0);
  return dataRows(ctx.tables, 'embeddata/scp/reputation.xml').reduce((level, row) => {
    const candidate = numericField(row, ['声望等级']);
    return points >= numericField(row, ['需要声望值'], Number.POSITIVE_INFINITY) ? Math.max(level, candidate) : level;
  }, 0);
}

function professionSkillOffers(ctx) {
  const skills = new Map(dataRows(ctx.tables, 'embeddata/scp/skill.xml').map(row => [numericField(row, ['ID']), row]));
  return dataRows(ctx.tables, 'embeddata/scp/card.xml').filter(row => {
    if (numericField(row, ['Type']) !== 2 || numericField(row, ['Quality'], -1) !== 0 || /废弃/.test(String(field(row, ['Name'], '')))) return false;
    const skill = skills.get(numericField(row, ['SkillID']));
    return skill && numericField(skill, ['使用职业']) === Number(ctx.actor.profession);
  }).map(row => ({ cardId: numericField(row, ['ID']), name: String(field(row, ['Name'], numericField(row, ['ID']))) }));
}

export function operateGrowth(ctx, action, payload = {}) {
  ensure(ctx);
  const handler = handlers[action];
  if (!handler || !growthActions.includes(action)) fail('unknown growth action');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('payload invalid');
  const result = handler(ctx, payload);
  return { action, at: ctx.now, result };
}

function uiItem(label, detail, action, payload = {}, disabled = false, fields = undefined) {
  const item = { label, detail, action, payload };
  if (disabled) item.disabled = true;
  if (fields) item.fields = fields;
  return item;
}

function consumableFields(def, actor) {
  const reaction = Number(prefixedField(def, '作用id', 0)), fields = [];
  if (numericField(def, ['是否能批量使用（1是，0否）'], 0) === 1 || [2, 3, 4, 5, 10].includes(reaction)) fields.push({ key: 'count', label: '使用数量', type: 'number', value: 1 });
  if (reaction === 1) fields.push({ key: 'profession', label: '新职业（1-4）', type: 'number', value: actor.profession === 4 ? 1 : actor.profession + 1 });
  if (reaction === 7) fields.push({ key: 'name', label: '新角色名', type: 'text', value: actor.name });
  if (reaction === 8) fields.push({ key: 'gender', label: '性别（1 或 2）', type: 'number', value: actor.gender === 1 ? 2 : 1 });
  if (reaction === 14) {
    const count = int(medicineParam(def, 2), 'selection count', 1, 20);
    if (count === 1) fields.push({ key: 'choice', label: '奖励序号', type: 'number', value: 1 });
    else fields.push({ key: 'choices', label: `选择 ${count} 个不重复序号，用逗号分隔`, type: 'text', value: Array.from({ length: count }, (_, i) => i + 1).join(',') });
  }
  return fields.length ? fields : undefined;
}

export function growthView(ctx) {
  const g = ensure(ctx), actor = ctx.actor;
  const profile = avatarProfile(ctx);
  const inventory = Object.entries(actor.inventory).filter(([, n]) => n > 0);
  const cards = Object.entries(actor.cards).filter(([, n]) => n > 0);
  const pets = Object.entries(g.pets);
  const equipment = dataRows(ctx.tables, 'embeddata/scp/equipment.xml');
  const recipes = dataRows(ctx.tables, 'embeddata/scp/peifang.xml');
  const petCatalog = dataRows(ctx.tables, 'embeddata/scp/pet.xml');
  const fusionRecipes = dataRows(ctx.tables, 'embeddata/scp/ronglianpeifang.xml');
  const activityChests = dataRows(ctx.tables, 'embeddata/scp/livelyprize.xml').slice(0, 10);
  const reputationLevels = dataRows(ctx.tables, 'embeddata/scp/reputation.xml').filter(r => numericField(r, ['声望类型'], 0) > 0);
  const sourceTitles = dataRows(ctx.tables, 'embeddata/scp/appell.xml').filter(r => numericField(r, ['ID'], 0) > 0);
  const warehouse = Object.entries(actor.warehouse).filter(([, n]) => n > 0);
  const equipped = Object.entries(actor.equipment).slice(0, 20);
  const mountCandidates = inventory.filter(([id]) => {
    const def = equipmentDef(ctx.tables, numericId(id, 'item'));
    return def && numericField(def, ['物品小类'], -1) === 12;
  });
  const earnedPassLevel = earnedBattlePassLevel(g);
  const passTracks = [
    { id: 'free', label: '免费', unlocked: true },
    { id: 'premium', label: '进阶', unlocked: g.battlePass.premium },
    { id: 'ultimate', label: '终极', unlocked: g.battlePass.ultimate },
  ];
  const battlePassItems = Array.from({ length: earnedPassLevel }, (_, index) => index + 1).flatMap(level =>
    passTracks.filter(track => !g.battlePass.claimed.includes(`${track.id}:${level}`)
      && !(track.id === 'free' && g.battlePass.claimed.includes(level)))
      .map(track => uiItem(`领取${level}级${track.label}战令`, `已达到 ${earnedPassLevel} 级`, 'battlePass.claim',
        { level, track: track.id }, !track.unlocked)));
  const reputationShopItems = reputationShopOffers(ctx.tables).map(offer => {
    const card = cardDef(ctx.tables, offer.cardId), unlocked = reputationLevel(ctx, offer.reputationType) >= offer.requiredLevel;
    return uiItem(String(field(card, ['Name'], offer.cardId)), `${offer.price} 银币`, 'shop.reputation.buy',
      { cardId: cardKey(offer.cardId) }, !unlocked);
  });
  const skillShopItems = professionSkillOffers(ctx).map(offer => uiItem(offer.name, '150 银币', 'shop.skill.buy',
    { cardId: cardKey(offer.cardId) }, own(actor.cards, cardKey(offer.cardId)) >= 3));
  const sections = [
    { id: 'inventory', title: '背包与仓库', items: inventory.flatMap(([id, count]) => {
      const def = medicamentDef(ctx.tables, numericId(id, 'item')), reaction = Number(prefixedField(def, '作用id', 0));
      return [
      ...(def && reaction > 0 ? [uiItem(`使用 ${id}`, `持有 ${count}`, 'inventory.use', { itemId: id, count: 1 }, false, consumableFields(def, actor))] : []),
      uiItem(`出售 ${id}`, '出售 1 件换取银币', 'inventory.sell', { itemId: id, count: 1 }),
      uiItem(`存入 ${id}`, '移动 1 件到仓库', 'warehouse.move', { itemId: id, count: 1, to: 'warehouse' }),
      uiItem(`${g.warehouseLocks[id] ? '解锁' : '锁定'} ${id}`, '锁定后不可出售或移动', 'warehouse.lock', { itemId: id, locked: !g.warehouseLocks[id] })
    ]; }).concat(warehouse.flatMap(([id, count]) => [
      uiItem(`取出 ${id}`, `仓库持有 ${count}`, 'warehouse.move', { itemId: id, count: 1, to: 'inventory' }, Boolean(g.warehouseLocks[id])),
      uiItem(`${g.warehouseLocks[id] ? '解锁' : '锁定'}仓库 ${id}`, '切换资产锁', 'warehouse.lock', { itemId: id, locked: !g.warehouseLocks[id] })
    ])) },
    { id: 'equipment', title: '装备与铁匠', items: equipment.map(r => {
      const id = numericField(r, ['物品ID\n', '物品ID', 'ID']);
      return uiItem(`装备 ${field(r, ['名字'], id)}`, `需求等级 ${numericField(r, ['使用等级'], 0) + 1}`, 'equipment.equip', { itemId: itemKey(id) }, !own(actor.inventory, itemKey(id)));
    }).concat(equipped.flatMap(([slot, id]) => [
      uiItem(`卸下 ${id}`, `槽位 ${slot}`, 'equipment.unequip', { slot: Number(slot) }),
      uiItem(`强化 ${id}`, `当前 +${actor.enhancements[id] ?? 0}`, 'equipment.enhance', { itemId: id }),
      uiItem(`精炼 ${id}`, `当前 ${g.refinements[id] ?? 0} 阶`, 'equipment.refine', { itemId: id })
    ]), equipment.filter(r => numericField(r, ['合成装备ID'], 0) > 0).map(r => {
      const target = numericField(r, ['合成装备ID']);
      return uiItem(`制造装备 ${target}`, `消耗 3 件 ${numericField(r, ['物品ID\n', '物品ID', 'ID'])}`, 'equipment.craft', { itemId: itemKey(target) });
    }), recipes.map(r => uiItem(`制造符文 ${numericField(r, ['符文(产品)ID'])}`, `配方 ${numericField(r, ['配方公式ID'])}`, 'equipment.runeCraft', { recipeId: numericField(r, ['配方公式ID']) }))) },
    { id: 'cards', title: '卡牌加工', items: cards.flatMap(([id, count]) => [
      uiItem(`分解 ${id}`, `持有 ${count}`, 'magic.dismantle', { cardId: id, count: 1 }),
      uiItem(`合成 ${id}`, '消耗 3 张尝试进阶', 'magic.synthesize', { cardId: id }, count < 3),
      uiItem(`融合 ${id}`, '与同品质兼容种族卡融合', 'magic.enchant', { cardId: id, materialCardId: id }, count < 2, [{ key: 'materialCardId', label: '材料卡 ID', type: 'text', value: id }]),
      uiItem(`点化 ${id}`, '按炼金房等级与点化表升品', 'magic.point', { cardId: id })
    ]).concat(fusionRecipes.map(r => uiItem(`炼制卡牌 ${numericField(r, ['cardid'])}`, '按炼制配方消耗全部材料', 'magic.refine', { cardId: cardKey(numericField(r, ['cardid'])) })), [uiItem('开启魔法罐', '每次 25 晶石', 'magic.jar', { count: 1 }, false, [{ key: 'count', label: '次数', type: 'number', value: 1 }])]) },
    { id: 'shop', title: '商城与抽取', items: Object.entries(LOCAL.shop).map(([id, o]) => uiItem(o.label, `${o.price} ${o.currency}`, id.startsWith('pack:ten') ? 'shop.openTen' : id.startsWith('pack:') ? 'shop.openPack' : id.startsWith('limited:') ? 'shop.buyLimited' : id.startsWith('exchange:') ? 'shop.exchange' : 'shop.buy', { offerId: id })) },
    { id: 'reputation-shop', title: '声望商店', items: reputationShopItems },
    { id: 'profession-skill-shop', title: '职业技能商店', items: skillShopItems },
    { id: 'pets', title: '宠物与坐骑', items: petCatalog.map(r => {
      const id = numericField(r, ['ID']), quality = numericField(r, ['Quality'], 0), price = 300 + quality * 200;
      return uiItem(`领养 ${field(r, ['Name'], id)}`, `品质 ${quality} · ${price} 银币 · 3级开放`, 'pet.adopt', { petId: id },
        Boolean(g.pets[id]) || actor.level < 3 || actor.currencies.silver < price);
    }).concat(pets.flatMap(([id, pet]) => [
      uiItem(`喂养宠物 ${id}`, `等级 ${pet.level}，经验 ${pet.exp}`, 'pet.feed', { petId: Number(id), itemId: itemKey(1101), count: 1 }),
      uiItem(`升级宠物 ${id}`, '经验达到配置要求后升级', 'pet.upgrade', { petId: Number(id) })
    ])).concat(pets.flatMap(([id, pet]) => {
      const def = petDef(ctx.tables, Number(id));
      const skills = String(field(def, ['SkillID'], '')).split(',').map(Number).filter(Boolean);
      return skills.filter(skillId => !pet.skills.includes(skillId)).map(skillId => uiItem(`宠物 ${id} 学习技能 ${skillId}`, '消耗 2 金币', 'pet.learnSkill', { petId: Number(id), skillId }, pet.skills.length >= 4));
    }), mountCandidates.map(([id]) => uiItem(`领养坐骑装备 ${id}`, '消耗背包中的坐骑装备', 'mount.adopt', { itemId: id })), Object.entries(g.mounts).flatMap(([id, mount]) => [
      uiItem(`升级坐骑 ${id}`, `等级 ${mount.level}`, 'mount.upgrade', { mountId: Number(id) }, mount.level >= 20),
      uiItem(`骑乘 ${id}`, '设为当前坐骑', 'mount.equip', { mountId: Number(id) }, g.activeMount === Number(id))
    ])) },
    { id: 'city', title: '城池', items: Object.entries(g.city.buildings).map(([id, b]) => uiItem(`升级 ${id}`, `等级 ${b.level}${b.readyAt > ctx.now ? '，升级中' : ''}`, 'city.upgrade', { buildingId: id }, b.readyAt > ctx.now || b.level >= 20)).concat([uiItem('征收税金', '每日一次', 'city.tax', {}, g.city.lastTaxDay === dayKey(ctx.now))]) },
    { id: 'activities', title: '每日活动', items: [
      uiItem('领取登录奖励', `连续 ${g.activities.loginStreak} 天`, 'activity.loginClaim', {}, g.activities.loginDay === dayKey(ctx.now)),
      uiItem('每日签到', `累计 ${g.activities.checkins} 次`, 'activity.checkin', {}, g.activities.checkinDay === dayKey(ctx.now)),
      ...activityChests.map((r, index) => uiItem(`活跃宝箱 ${index + 1}`, `需要 ${numericField(r, ['需要活跃度'], (index + 1) * 20)} 当日活跃度`, 'activity.chest', { index: index + 1 }, g.activities.chests.includes(`${dayKey(ctx.now)}:${index + 1}`))),
      uiItem('幸运轮盘', '100 银币，每日 3 次', 'activity.wheel', {}, g.activities.wheelDay === dayKey(ctx.now) && g.activities.wheelCount >= 3),
      uiItem('每日许愿', '填写 1 使用 7 日奖池，填写 2 使用 30 日奖池', 'activity.wish', { group: 1 }, g.activities.wishDay === dayKey(ctx.now), [{ key: 'group', label: '奖池编号（1 或 2）', type: 'number', value: 1 }]),
      uiItem('领取周度本地补给', '累计 7 次养成操作，每周一次', 'activity.weeklyGrant', {}, Boolean(g.activities.weeklyClaims[String(weekKey(ctx.now))]) || g.counters.growthActions < 7),
      uiItem('领取周度额外奖励', '累计 20 次养成操作，每周一次', 'activity.rewardBonus', {}, Boolean(g.activities.bonusClaims[String(weekKey(ctx.now))]) || g.counters.growthActions < 20)
    ] },
    { id: 'progression', title: '声望、任务与战令', items: reputationLevels.map(r => {
      const type = numericField(r, ['声望类型']), level = numericField(r, ['声望等级']);
      return uiItem(`领取声望 ${type} 等级 ${level}`, `需要 ${numericField(r, ['需要声望值'])}`, 'reputation.claim', { type, level }, g.reputationClaims.includes(`${type}:${level}`));
    }).concat(LOCAL.titles.map(t => uiItem(`装备称号：${t.label}`, `总声望需要 ${t.need}`, 'title.equip', { titleId: t.id })), sourceTitles.map(row => {
      const id = `item-title:${numericField(row, ['ID'])}`, expiresAt = g.titleExpiries[id] ?? 0;
      const effects = [1, 2, 3, 4].map(index => numericField(row, [`Ability${index}`], 0)).filter(Boolean);
      const detail = `${field(row, ['Descript'], '')}${effects.length ? `；战斗特效 ${effects.join('、')}` : ''}${expiresAt ? `；到期时间 ${expiresAt}` : ''}`;
      return uiItem(`装备原版称号：${field(row, ['Name'], id)}`, detail, 'title.equip', { titleId: id },
        !g.titles.includes(id) || Boolean(expiresAt && expiresAt <= ctx.now));
    }), LOCAL.repeatQuests.map(q => uiItem(q.label, `${g.dailyCounters[q.counter] ?? 0}/${q.need}`, 'quest.repeatClaim', { questId: q.id }, (g.dailyCounters[q.counter] ?? 0) < q.need)), battlePassItems, [
      uiItem('领取回归奖励', '离线至少 7 天且仅可领取一次', 'quest.returnClaim', {}, !g.returnEligible || g.returnClaimed),
      uiItem('修改头像', profile.avatarAssetId ? `当前 ${profile.options.find(option => option.assetId === profile.avatarAssetId)?.label}` : '暂无可用卡牌原画',
        'profile.update', { avatarAssetId: profile.avatarAssetId }, !profile.options.length,
        [{ key: 'avatarAssetId', label: '选择持有卡牌原画', type: 'select', value: profile.avatarAssetId,
          options: profile.options.map(option => ({ label: option.label, value: option.assetId })) }]),
      uiItem('修改角色名', `当前 ${actor.name}，消耗 5 金币`, 'profile.update', { name: actor.name }, false, [{ key: 'name', label: '新角色名', type: 'text', value: actor.name }])
    ]) },
    { id: 'summon', title: '召唤世界', items: [uiItem('召唤 1 次', '消耗 30 晶石', 'summon.world', { count: 1 }), uiItem('召唤 10 次', '消耗 300 晶石', 'summon.world', { count: 10 })] },
    { id: 'local-tools', title: '本地测试补给', items: [
      uiItem('领取每日测试补给', '每日限领一次，资源有上限，不连接支付', 'test.grant', {}, Boolean(g.grants[String(dayKey(ctx.now))])),
      uiItem('解锁本季进阶战令', '本地测试解锁，每季一次', 'test.unlockBattlePass', { track: 'premium' }, g.battlePass.premium || g.battlePass.localUnlocks.includes('premium')),
      uiItem('解锁本季终极战令', '本地测试解锁，每季一次', 'test.unlockBattlePass', { track: 'ultimate' }, g.battlePass.ultimate || g.battlePass.localUnlocks.includes('ultimate'))
    ] }
  ];
  return {
    version: 1,
    generatedAt: ctx.now,
    profile,
    summary: { currencies: { ...actor.currencies }, energy: g.energy, gems: g.gems, petEssence: g.petEssence, towerCoins: g.towerCoins, advancedTowerCoins: g.advancedTowerCoins, honor: g.honor, activityPoints: g.activityPoints, inventorySlots: Object.keys(actor.inventory).length, cardKinds: Object.keys(actor.cards).length, growthCounters: { ...g.counters } },
    pagination: { sourceComplete: true, cappedCollections: [] },
    sections
  };
}

export function combatBonuses(ctx) {
  const actor = ctx?.actor, tables = ctx?.tables;
  if (!actor || !tables) fail('combat bonus context invalid');
  let hp = 0, attack = 0;
  const effects = new Set(), cards = new Set();
  const enhancements = actor.enhancements || {};
  const refinements = actor.growth?.refinements || {};

  for (const [rawSlot, key] of Object.entries(actor.equipment || {})) {
    if (!/^main:item:\d+$/.test(key)) continue;
    const id = numericId(key, 'item'), def = equipmentDef(tables, id);
    if (!def) continue;
    const slot = Number(rawSlot), enhanced = own(enhancements, key), refined = own(refinements, key);
    if (slot === 2) attack += 1 + enhanced + refined;
    else hp += 2 + enhanced * 2 + refined;
    for (let i = 1; i <= 5; i += 1) {
      const effect = numericField(def, [`效果${i}`], 0);
      if (effect > 0) effects.add(effect);
    }
    const grantedCard = numericField(def, ['装备技能卡牌ID'], 0);
    if (grantedCard > 0 && cardDef(tables, grantedCard)) cards.add(cardKey(grantedCard));
  }

  const pets = Object.entries(actor.growth?.pets || {}).filter(([id, pet]) => /^\d+$/.test(id) && pet && Number.isSafeInteger(pet.level));
  pets.sort((a, b) => b[1].level - a[1].level || Number(a[0]) - Number(b[0]));
  if (pets.length) {
    const [petId, pet] = pets[0];
    for (const row of dataRows(tables, 'embeddata/scp/petupattr.xml')) {
      if (numericField(row, ['PetId'], -1) !== Number(petId) || numericField(row, ['Grade'], 99) > pet.level) continue;
      const type = numericField(row, ['Type']), value = numericField(row, ['Value']);
      if (type === 1) attack += value;
      if (type === 2) hp += Math.max(1, Math.floor(value / 10));
    }
    const skills = Array.isArray(pet.skills) ? pet.skills : [];
    for (const skillId of skills) {
      const skill = findBy(tables, 'embeddata/scp/petskill.xml', ['ID'], skillId);
      const effect = numericField(skill, ['EffectId'], 0);
      if (effect > 0) effects.add(effect);
    }
  }

  const activeMount = Number(actor.growth?.activeMount || 0);
  const mount = activeMount && actor.growth?.mounts?.[activeMount];
  if (mount && Number.isSafeInteger(mount.level) && mount.level > 0) {
    hp += mount.level * 2;
    attack += Math.ceil(mount.level / 3);
  }
  const activeTitle = String(actor.growth?.activeTitle ?? '');
  const sourceTitleId = Number(activeTitle.match(/^item-title:(\d+)$/)?.[1] ?? 0);
  const titleOwned = actor.growth?.titles?.includes(activeTitle);
  const titleExpiry = actor.growth?.titleExpiries?.[activeTitle] ?? 0;
  if (sourceTitleId > 0 && titleOwned && (!titleExpiry || titleExpiry > (ctx.now ?? Date.now()))) {
    const title = findBy(tables, 'embeddata/scp/appell.xml', ['ID'], sourceTitleId);
    for (let index = 1; index <= 4; index += 1) {
      const effect = numericField(title, [`Ability${index}`], 0);
      if (effect > 0) effects.add(effect);
    }
  }
  const result = { hp, attack };
  if (effects.size) result.effects = [...effects];
  if (cards.size) result.cards = [...cards];
  return result;
}

export function tickGrowth(world, tables, now) {
  if (!world?.characters || !Number.isFinite(now)) fail('growth tick context invalid');
  let changed = false;
  for (const actor of Object.values(world.characters)) {
    const buildings = actor?.growth?.city?.buildings;
    if (!buildings) continue;
    for (const building of Object.values(buildings)) {
      if (building.pendingLevel && building.readyAt > 0 && building.readyAt <= now) {
        building.level = building.pendingLevel;
        delete building.pendingLevel;
        building.readyAt = 0;
        actor.economicLog ||= [];
        log(actor, now, 'mature', 'city-building', building.level, 'city-upgrade-complete');
        changed = true;
      }
    }
  }
  return changed;
}
