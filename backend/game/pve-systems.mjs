const DAY = 86_400_000;
const HOUR = 3_600_000;
const CST = 8 * 3_600_000;

export const pveActions = Object.freeze([
  'tower.challenge', 'tower.refresh', 'tower.reset',
  'worldBoss.challenge', 'worldBoss.hire', 'worldBoss.reward.claim',
  'forbidden.challenge', 'forbidden.shop.buy', 'forbidden.reward.claim',
  'quest.explore.start', 'quest.explore.claim', 'quest.energy.buy', 'quest.tax.force',
  'quest.marriage.propose', 'quest.marriage.respond', 'quest.marriage.ceremony', 'quest.account.confirm',
  'quest.elitePack.open',
  'petIsland.challenge', 'petIsland.collect', 'pet.synthesize',
  'task.claim'
]);

const table = (tables, name) => tables[`embeddata/scp/${name.toLowerCase()}.xml`] ?? [];
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const rowValues = row => Object.entries(row).filter(([key]) => !key.startsWith('_')).map(([, value]) => value);
const dayKey = now => new Date(now + CST).toISOString().slice(0, 10);
const localSeconds = now => {
  const date = new Date(now + CST);
  return date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
};
const seconds = value => {
  const parts = String(value ?? '').split(':').map(Number);
  return parts.length === 3 && parts.every(Number.isFinite) ? parts[0] * 3600 + parts[1] * 60 + parts[2] : 0;
};
const cleanText = value => String(value ?? '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/\s+\n/g, '\n').trim();
const fail = message => { throw new Error(message); };
function sectionRows(rows, start, offset = 2, sentinelKey) {
  const result = [];
  for (let index = start + offset; index < rows.length; index++) {
    const row = rows[index], sentinel = sentinelKey ? row[sentinelKey] : rowValues(row)[0];
    if (Number(sentinel) === -1) break;
    result.push(row);
  }
  return result;
}

function ensure(ctx) {
  const { world, actor } = ctx;
  world.pve ??= { version: 1, worldBoss: {}, forbidden: {} };
  world.pve.worldBoss ??= {};
  world.pve.forbidden ??= {};
  world.pve.marriages ??= { proposals: {}, unions: {} };
  world.pve.marriages.proposals ??= {};
  world.pve.marriages.unions ??= {};
  actor.pve ??= {
    tower: { nextNormal: 1, nextInfernal: 501, highestNormal: 0, highestInfernal: 500, coins: 0, preview: {} },
    worldBoss: { contributions: {}, hires: {}, rewardClaims: [] },
    forbidden: { score: 0, entries: {}, purchases: {}, rewardClaims: [], onlinePrizeEntitlements: [] },
    tasks: { claimed: [], counters: { pveBattles: 0, pveWins: 0, towerWins: 0, worldBossDamage: 0, forbiddenWins: 0 } }
  };
  actor.pve.tower ??= { nextNormal: 1, nextInfernal: 501, highestNormal: 0, highestInfernal: 500, coins: 0, preview: {} };
  actor.pve.tower.preview ??= {};
  actor.pve.worldBoss ??= { contributions: {}, hires: {}, rewardClaims: [] };
  actor.pve.worldBoss.contributions ??= {};
  actor.pve.worldBoss.hires ??= {};
  actor.pve.worldBoss.rewardClaims ??= [];
  actor.pve.forbidden ??= { score: 0, entries: {}, purchases: {}, rewardClaims: [], onlinePrizeEntitlements: [] };
  actor.pve.forbidden.entries ??= {};
  actor.pve.forbidden.purchases ??= {};
  actor.pve.forbidden.rewardClaims ??= [];
  actor.pve.forbidden.onlinePrizeEntitlements ??= [];
  actor.pve.tasks ??= { claimed: [], counters: {} };
  actor.pve.tasks.claimed ??= [];
  actor.pve.tasks.counters = { pveBattles: 0, pveWins: 0, towerWins: 0, worldBossDamage: 0, forbiddenWins: 0,
    ...(actor.pve.tasks.counters ?? {}) };
  actor.pve.operations ??= { exploration: null, energyPurchases: {}, forcedTaxes: {}, petIsland: { pending: [], collected: {}, sequence: 0 } };
  actor.pve.operations.energyPurchases ??= {};
  actor.pve.operations.forcedTaxes ??= {};
  actor.pve.operations.petIsland ??= { pending: [], collected: {}, sequence: 0 };
  actor.pve.operations.petIsland.pending ??= [];
  actor.pve.operations.petIsland.collected ??= {};
  actor.pve.operations.petIsland.sequence = number(actor.pve.operations.petIsland.sequence);
  actor.pve.operations.marriage ??= { unionId: null };
  actor.currencies ??= { silver: 0, gold: 0, crystal: 0 };
  actor.inventory ??= {};
  actor.cards ??= {};
  actor.economicLog ??= [];
  actor.claimed ??= [];
  actor.stats ??= {};
  actor.progress ??= { clearedTriggers: [] };
  actor.progress.clearedTriggers ??= [];
  return actor.pve;
}

function counterAdd(counters, key, amount = 1, qualifier) {
  amount = number(amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) return 0;
  if (qualifier === undefined) counters[key] = number(counters[key]) + amount;
  else {
    counters[key] ??= {};
    counters[key][String(qualifier)] = number(counters[key][String(qualifier)]) + amount;
  }
  return amount;
}

function debit(actor, asset, amount, reason, now) {
  amount = number(amount);
  if (!Number.isSafeInteger(amount) || amount < 0) fail('费用配置无效');
  if (number(actor.currencies[asset]) < amount) fail(`${asset}不足`);
  actor.currencies[asset] -= amount;
  if (amount) actor.economicLog.push({ kind: 'debit', asset, amount, reason, at: now });
}

function credit(actor, asset, amount, reason, now) {
  amount = number(amount);
  if (!Number.isSafeInteger(amount) || amount < 0) fail('奖励配置无效');
  actor.currencies[asset] = number(actor.currencies[asset]) + amount;
  if (amount) actor.economicLog.push({ kind: 'credit', asset, amount, reason, at: now });
}

function grantXp(ctx, amount) {
  amount = Math.max(0, number(amount));
  if (ctx.content?.grantExperience) ctx.content.grantExperience(ctx.actor, amount);
  else ctx.actor.xp = number(ctx.actor.xp) + amount;
}

function choose(ctx, values) {
  if (!values.length) fail('敌方配置缺失');
  return values[ctx.randomInt(values.length)];
}

function towerRows(ctx) {
  return table(ctx.tables, 'TownLayouts').filter(row => number(row.MinLayout) > 0 && number(row.MaxLayout) >= number(row.MinLayout));
}

function towerRow(ctx, layer) {
  const row = towerRows(ctx).find(candidate => number(candidate.MinLayout) <= layer && number(candidate.MaxLayout) >= layer);
  if (!row) fail('塔层配置缺失');
  return row;
}

let towerPools = new WeakMap();
function towerMonsterPool(ctx) {
  if (towerPools.has(ctx.tables)) return towerPools.get(ctx.tables);
  const pool = table(ctx.tables, 'Monster').filter(row => number(row.ID) > 0 && number(row.Type) === 1
    && number(row.HP) > 0 && number(row.HP) <= 60 && number(row.Attack) >= 0 && number(row.Attack) <= 15)
    .map(row => ({ id: number(row.ID), power: number(row.HP) + number(row.Attack) * 2 }))
    .sort((a, b) => a.power - b.power || a.id - b.id);
  towerPools.set(ctx.tables, pool);
  return pool;
}

function mapTowerEnemy(ctx, sourceId, layer) {
  const pool = towerMonsterPool(ctx), exact = pool.find(candidate => candidate.id === sourceId);
  if (exact) return { sourceId, monsterId: sourceId, mapped: false };
  if (!pool.length) fail('可用塔敌人配置缺失');
  const infernalProgress = Math.max(0, Math.min(1, (layer - 501) / 34));
  const percentile = layer >= 501 ? 0.78 + infernalProgress * 0.2 : Math.max(0, Math.min(0.75, layer / 135));
  const center = Math.round(percentile * (pool.length - 1));
  const spread = Math.max(1, Math.floor(pool.length * 0.015));
  const offset = (Math.abs(sourceId) % (spread * 2 + 1)) - spread;
  const selected = pool[Math.max(0, Math.min(pool.length - 1, center + offset))];
  return { sourceId, monsterId: selected.id, mapped: true };
}

function towerEnemies(ctx, row, layer) {
  return Object.entries(row).filter(([key]) => key === 'Triggers' || key.startsWith('column_'))
    .map(([, value]) => number(value)).filter(value => value > 0).map(sourceId => mapTowerEnemy(ctx, sourceId, layer));
}

function towerChallenge(ctx, payload) {
  const pve = ensure(ctx), infernal = payload.mode === 'infernal';
  if (payload.mode !== undefined && !['normal', 'infernal'].includes(payload.mode)) fail('塔模式无效');
  const field = infernal ? 'nextInfernal' : 'nextNormal';
  const layer = payload.layer === undefined ? pve.tower[field] : number(payload.layer);
  if (!Number.isSafeInteger(layer) || layer !== pve.tower[field]) fail('只能挑战当前塔层');
  const row = towerRow(ctx, layer);
  debit(ctx.actor, 'silver', number(row.EnterPrice), 'tower-entry', ctx.now);
  const previewKey = infernal ? 'infernal' : 'normal';
  const enemy = pve.tower.preview[previewKey]?.layer === layer ? pve.tower.preview[previewKey] : choose(ctx, towerEnemies(ctx, row, layer));
  delete pve.tower.preview[previewKey];
  return {
    message: `通天塔第${layer}层战斗开始`,
    start: { mode: 'tower', mapId: number(row.battleid, 1), enemies: [{ sourceId: enemy.sourceId, monsterId: enemy.monsterId, mapped: enemy.mapped, deckId: enemy.monsterId }],
      pve: { kind: 'tower', layer, infernal, silver: number(row.silverprize), xp: number(row.expprize) } }
  };
}

function towerRefresh(ctx, payload) {
  const pve = ensure(ctx), infernal = payload.mode === 'infernal';
  if (payload.mode !== undefined && !['normal', 'infernal'].includes(payload.mode)) fail('塔模式无效');
  const layer = infernal ? pve.tower.nextInfernal : pve.tower.nextNormal;
  const row = towerRow(ctx, layer);
  if (!number(row.EnableRefresh)) fail('本层不能刷新');
  debit(ctx.actor, 'silver', number(row.RefreshPrice), 'tower-refresh', ctx.now);
  const key = infernal ? 'infernal' : 'normal';
  const previous = pve.tower.preview[key]?.sourceId;
  const pool = towerEnemies(ctx, row, layer).filter((candidate, index, all) => all.findIndex(item => item.sourceId === candidate.sourceId) === index);
  const candidates = pool.filter(candidate => candidate.sourceId !== previous);
  const enemy = choose(ctx, candidates.length ? candidates : pool);
  pve.tower.preview[key] = { layer, ...enemy };
  return { message: '塔层敌人已刷新', layer, ...enemy };
}

function towerReset(ctx, payload) {
  const pve = ensure(ctx), infernal = payload.mode === 'infernal';
  if (payload.mode !== undefined && !['normal', 'infernal'].includes(payload.mode)) fail('塔模式无效');
  const nextField = infernal ? 'nextInfernal' : 'nextNormal';
  const highestField = infernal ? 'highestInfernal' : 'highestNormal';
  const floor = infernal ? 501 : 1;
  if (pve.tower[highestField] < floor) fail('尚无可重置进度');
  const crossed = towerRows(ctx).filter(row => number(row.MinLayout) <= pve.tower[highestField]
    && (infernal ? number(row.MinLayout) >= 501 : number(row.MinLayout) < 501));
  const price = crossed.reduce((sum, row) => sum + (Math.min(number(row.MaxLayout), pve.tower[highestField]) - number(row.MinLayout) + 1) * number(row.ResetPrice), 0);
  debit(ctx.actor, 'silver', price, 'tower-reset', ctx.now);
  pve.tower[nextField] = floor;
  delete pve.tower.preview[infernal ? 'infernal' : 'normal'];
  return { message: '通天塔进度已重置', mode: infernal ? 'infernal' : 'normal', nextLayer: floor, price };
}

function worldBossConfig(ctx) {
  const rows = table(ctx.tables, 'WorldBoss');
  const schedule = rows.filter(row => typeof row.StartTime === 'string' && Number.isInteger(Number(row.BossStatus)))
    .map(row => ({ status: number(row.BossStatus), at: seconds(row.StartTime), messageId: number(row.MsgID),
      closes: number(row.NotOpenTime) === 1, performance: number(row.PerformancesIndex) }));
  const hpMarker = rows.findIndex(row => row.BossStatus === 'BossHP');
  const hp = number(rows[hpMarker + 2]?.BossStatus, 450);
  const statusHeader = rows.findIndex(row => row.BossStatus === 'BossStatus' && row.StartTime === 'BattleMapID');
  const states = sectionRows(rows, statusHeader, 2, 'BossStatus').filter(row => [1, 2, 3, 4].includes(number(row.BossStatus))).map(row => {
    const values = rowValues(row).map(value => number(value));
    return { status: values[0], mapId: values[1], monsterId: values[2], deckIds: values.slice(3, 6), killCount: values[15] };
  });
  const hireHeader = rows.findIndex(row => row.BossStatus === 'MercenaryID');
  const hires = sectionRows(rows, hireHeader, 2, 'BossStatus').filter(row => Number.isInteger(Number(row.BossStatus)) && number(row.StartTime) > 0)
    .map(row => ({ id: number(row.BossStatus), cardId: number(row.StartTime), cost: number(row.MsgID) }));
  const allowMarker = rows.findIndex(row => row.BossStatus === 'AllowInLevel');
  const allowLevel = number(rows[allowMarker + 2]?.BossStatus, 20);
  const refreshMarker = rows.findIndex(row => row.BossStatus === 'RefreshStatusCost');
  const refreshCost = number(rows[refreshMarker + 2]?.BossStatus, 25);
  const prizeHeader = rows.findIndex(row => String(row.BossStatus).startsWith('奖励档次类型'));
  const prizes = sectionRows(rows, prizeHeader, 2, 'BossStatus').filter(row => number(row.BossStatus) > 0)
    .map(row => ({ rankType: number(row.BossStatus), type: number(row.StartTime), id: number(row.MsgID), count: number(row.NotOpenTime) }));
  return { schedule, hp, states, hires, allowLevel, refreshCost, prizes };
}

function activeWorldBoss(ctx) {
  const config = worldBossConfig(ctx), time = localSeconds(ctx.now), day = dayKey(ctx.now);
  const events = config.schedule.filter(event => event.at <= time);
  const latest = events.at(-1);
  if (!latest || latest.status === 0) return { config, day, open: false, status: 0, performance: latest?.performance ?? 0 };
  const key = `${day}:${latest.performance}`;
  const season = ctx.world.pve.worldBoss[key] ??= { key, day, performance: latest.performance, maxHp: config.hp,
    hp: config.hp, status: latest.status, contributions: {}, defeated: false, closed: false };
  season.status = season.defeated ? 0 : latest.status;
  return { config, day, key, season, open: !season.closed && !season.defeated, status: season.status, performance: latest.performance };
}

function worldBossChallenge(ctx) {
  const pve = ensure(ctx), active = activeWorldBoss(ctx);
  if (!active.open) fail('世界Boss当前未开放');
  if (number(ctx.actor.level) < active.config.allowLevel) fail(`需要角色等级${active.config.allowLevel}`);
  const state = active.config.states.find(candidate => candidate.status === active.status);
  if (!state) fail('世界Boss阶段配置缺失');
  const hired = pve.worldBoss.hires[active.key] ?? [];
  return { message: '世界Boss战斗开始', start: { mode: 'world-boss', mapId: state.mapId,
    enemies: [{ monsterId: state.monsterId, deckIds: state.deckIds }], allies: hired.map(cardId => ({ cardId })),
    pve: { kind: 'world-boss', seasonKey: active.key, status: state.status, hpBefore: active.season.hp, killCount: state.killCount } } };
}

function worldBossHire(ctx, payload) {
  const pve = ensure(ctx), active = activeWorldBoss(ctx);
  if (!active.open) fail('世界Boss当前未开放');
  const offer = active.config.hires.find(candidate => candidate.id === number(payload.id));
  if (!offer) fail('佣兵不存在');
  const hired = pve.worldBoss.hires[active.key] ??= [];
  if (hired.includes(offer.cardId)) fail('本场已雇佣该佣兵');
  if (hired.length >= 3) fail('本场最多雇佣三名佣兵');
  debit(ctx.actor, 'gold', offer.cost, 'world-boss-hire', ctx.now);
  hired.push(offer.cardId);
  return { message: '佣兵已加入本场世界Boss战斗', cardId: offer.cardId };
}

function grantConfiguredPrize(ctx, prize, reason) {
  const count = number(prize.count);
  if (!Number.isSafeInteger(count) || count < 1) fail('奖励配置无效');
  if (prize.type === 1) credit(ctx.actor, 'silver', count, reason, ctx.now);
  else if (prize.type === 2) credit(ctx.actor, 'gold', count, reason, ctx.now);
  else if (prize.type === 3) {
    const key = `main:card:${prize.id}`;
    ctx.actor.cards[key] = number(ctx.actor.cards[key]) + count;
  } else if (prize.type === 4) {
    const key = `main:item:${prize.id}`;
    ctx.actor.inventory[key] = number(ctx.actor.inventory[key]) + count;
  } else {
    ctx.actor.growth ??= {};
    const field = ({ 5: 'towerCoins', 6: 'activityPoints', 7: 'honor' })[prize.type];
    if (!field) fail('奖励类型无效');
    ctx.actor.growth[field] = number(ctx.actor.growth[field]) + count;
  }
  return { ...prize };
}

function worldBossRewardClaim(ctx, payload) {
  const pve = ensure(ctx), key = String(payload.seasonKey ?? '');
  const season = ctx.world.pve.worldBoss[key];
  if (!season?.closed || !season.rewardsFinalized) fail('世界Boss奖励尚未结算');
  const claimKey = `${key}:${ctx.actor.id}`;
  if (pve.worldBoss.rewardClaims.includes(claimKey)) fail('世界Boss奖励已领取');
  const prizes = season.rewardEligibility?.[ctx.actor.id] ?? [];
  if (!prizes.length) fail('没有可领取的世界Boss奖励');
  const granted = prizes.map(prize => grantConfiguredPrize(ctx, prize, 'world-boss-season'));
  pve.worldBoss.rewardClaims.push(claimKey);
  season.claimed ??= [];
  season.claimed.push(ctx.actor.id);
  return { message: '世界Boss赛季奖励已领取', seasonKey: key, prizes: granted };
}

function forbiddenConfig(ctx) {
  const rows = table(ctx.tables, 'FiendConfig');
  const schedule = rows.filter(row => typeof row.StartTime === 'string' && Number.isInteger(Number(row.ActStatus)) && [0, 1, 2].includes(Number(row.ActStatus)))
    .map(row => ({ status: number(row.ActStatus), at: seconds(row.StartTime), messageId: number(row.MsgID) }));
  const scalar = marker => {
    const index = rows.findIndex(row => row.ActStatus === marker);
    return number(rows[index + 2]?.ActStatus);
  };
  const list = marker => {
    const index = rows.findIndex(row => row.ActStatus === marker), values = [];
    for (let cursor = index + 2; cursor < rows.length && number(rows[cursor].ActStatus, NaN) !== -1; cursor++) values.push(number(rows[cursor].ActStatus));
    return values;
  };
  const prizeHeader = rows.findIndex(row => row.ActStatus === 'Prize');
  const prizeTiers = sectionRows(rows, prizeHeader, 2, 'ActStatus').filter(row => number(row.ActStatus, -1) >= 0 && number(row.ActStatus, -1) <= 4)
    .map(row => { const values = rowValues(row).map(value => number(value)); return { stonesLeft: values[0], bravePrize: values[1], braveDraws: values[2], fiendPrize: values[3], fiendDraws: values[4] }; });
  const displayHeader = rows.findIndex(row => row.ActStatus === 'Prizes');
  const display = sectionRows(rows, displayHeader, 2, 'ActStatus').filter(row => number(row.ActStatus, -1) >= 0)
    .map(row => ({ stonesLeft: number(row.ActStatus), brave: number(row.StartTime), fiend: number(row.MsgID) }));
  return { schedule, arrangementId: scalar('FiendBaiGuaiID'), deckId: scalar('FiendDeckID'), hpPercent: scalar('FiendHPParam(%)'),
    effects: list('WarriorEffectID'), soulStones: list('SoulStoneMSTID'), entryPrice: scalar('FiendTimePrice'), prizeTiers, display };
}

function activeForbidden(ctx) {
  const config = forbiddenConfig(ctx), time = localSeconds(ctx.now), day = dayKey(ctx.now);
  const elapsed = config.schedule.filter(event => event.at <= time), latest = elapsed.at(-1);
  const status = latest?.status ?? 0;
  const season = ctx.world.pve.forbidden[day] ??= { key: day, day, status, rankings: {}, closed: false };
  season.status = status;
  if (status === 0 && elapsed.some(event => event.status === 2)) season.closed = true;
  return { config, day, season, visible: status >= 1 && !season.closed, open: status === 2 && !season.closed };
}

function forbiddenChallenge(ctx) {
  const pve = ensure(ctx), active = activeForbidden(ctx);
  if (!active.open) fail('禁地比赛当前未开放');
  const entries = number(pve.forbidden.entries[active.day]);
  if (entries > 0) debit(ctx.actor, 'silver', active.config.entryPrice, 'forbidden-entry', ctx.now);
  pve.forbidden.entries[active.day] = entries + 1;
  const monsterId = active.config.deckId;
  return { message: '禁地挑战开始', start: { mode: 'forbidden', mapId: 1, playerEffects: active.config.effects,
    enemies: [{ monsterId, deckId: active.config.deckId, arrangementId: active.config.arrangementId,
      hpMultiplier: active.config.hpPercent / 100 }],
    pve: { kind: 'forbidden', seasonKey: active.day, entry: entries + 1 } } };
}

function forbiddenOffers(config) {
  return config.soulStones.map((itemId, index) => {
    const tier = config.display[index + 1] ?? config.display.at(-1) ?? { brave: (index + 1) * 10 };
    return { id: `soul:${itemId}`, itemId, count: 1, cost: Math.max(1, number(tier.brave, (index + 1) * 10)), limit: 1 };
  });
}

function forbiddenBuy(ctx, payload) {
  const pve = ensure(ctx), config = forbiddenConfig(ctx);
  const offer = forbiddenOffers(config).find(candidate => candidate.id === String(payload.offerId));
  if (!offer) fail('禁地商店商品不存在');
  const bought = number(pve.forbidden.purchases[offer.id]);
  if (bought >= offer.limit) fail('禁地商店商品已售罄');
  if (pve.forbidden.score < offer.cost) fail('禁地积分不足');
  pve.forbidden.score -= offer.cost;
  pve.forbidden.purchases[offer.id] = bought + 1;
  const key = `main:item:${offer.itemId}`;
  ctx.actor.inventory[key] = number(ctx.actor.inventory[key]) + offer.count;
  return { message: '兑换成功', offerId: offer.id, score: pve.forbidden.score };
}

function forbiddenRewardClaim(ctx, payload) {
  const pve = ensure(ctx), key = String(payload.seasonKey ?? '');
  const season = ctx.world.pve.forbidden[key];
  if (!season?.closed || !season.rewardsFinalized) fail('禁地奖励尚未结算');
  const claimKey = `${key}:${ctx.actor.id}`;
  if (pve.forbidden.rewardClaims.includes(claimKey)) fail('禁地奖励已领取');
  const entitlement = season.rewardEligibility?.[ctx.actor.id];
  if (!entitlement) fail('没有可领取的禁地奖励');
  const config = forbiddenConfig(ctx), draws = number(entitlement.draws);
  if (!Number.isSafeInteger(draws) || draws < 1 || !config.soulStones.length) fail('禁地奖励配置无效');
  const granted = [];
  for (let draw = 0; draw < draws; draw++) {
    const offset = Math.abs(number(entitlement.prizeTableId)) + draw + ctx.randomInt(config.soulStones.length);
    const itemId = config.soulStones[offset % config.soulStones.length], itemKey = `main:item:${itemId}`;
    ctx.actor.inventory[itemKey] = number(ctx.actor.inventory[itemKey]) + 1;
    granted.push({ type: 'item', itemId, count: 1 });
  }
  const token = { ...entitlement, seasonKey: key, claimedAt: ctx.now, granted };
  pve.forbidden.onlinePrizeEntitlements.push(token);
  pve.forbidden.rewardClaims.push(claimKey);
  season.claimed ??= [];
  season.claimed.push(ctx.actor.id);
  return { message: '禁地奖励已领取', seasonKey: key, entitlement: token, granted };
}

function vipRow(ctx) {
  const rows = table(ctx.tables, 'VipParams').filter(row => Number.isInteger(Number(row.viplevel)));
  const level = Math.max(0, number(ctx.actor.vipLevel));
  return rows.find(row => number(row.viplevel) === level) ?? rows.filter(row => number(row.viplevel) <= level).at(-1) ?? rows[0];
}

function explorationConfig(ctx) {
  const rows = table(ctx.tables, 'ChuzhengMatou'), islands = [];
  for (const row of rows.filter(candidate => candidate._tag === 'island')) {
    const prefix = `${row._path}/param[`, params = {};
    for (const param of rows.filter(candidate => candidate._tag === 'param' && String(candidate._path).startsWith(prefix))) {
      params[String(param.name)] = { value: number(param.value), star: number(param.star) };
    }
    islands.push({ id: number(row.id), name: String(row.name ?? `岛屿 ${row.id}`), type: number(row.type), needDockLevel: number(row.needMatouLevel),
      needVipLevel: number(row.needVIPLevel), maxHours: Math.max(1, number(row.maxHours, 1)), params });
  }
  const coefficients = rows.filter(row => row._tag === 'levelcoefficient' && number(row.level) > 0)
    .map(row => ({ level: number(row.level), silver: number(row.money), resource: number(row.resource), xp: number(row.exp) }))
    .sort((a, b) => a.level - b.level);
  return { islands, coefficients };
}

function explorationReward(ctx, island, hours) {
  const config = explorationConfig(ctx);
  const coefficient = config.coefficients.filter(row => row.level <= Math.max(1, number(ctx.actor.level))).at(-1) ?? config.coefficients[0]
    ?? { silver: 1, resource: 1, xp: 1 };
  if (island.type === 1) return {
    silver: Math.max(0, coefficient.silver * number(island.params.silver?.star) * hours),
    crystal: Math.max(0, coefficient.resource * number(island.params.crystal?.star) * hours),
    xp: Math.max(0, coefficient.xp * number(island.params.exp?.star) * hours)
  };
  const convertType = number(island.params.convertype?.value), raw = Math.min(number(island.params.maxnum?.value), number(island.params.rate?.value) * hours);
  const amount = Math.max(1, Math.floor(raw / 100));
  if ([3, 5].includes(convertType)) return { silver: 0, crystal: 0, gold: amount, xp: 0 };
  if ([2, 4].includes(convertType)) return { silver: 0, crystal: amount, gold: 0, xp: 0 };
  return { silver: amount, crystal: 0, gold: 0, xp: 0 };
}

function explorationStart(ctx, payload) {
  const pve = ensure(ctx);
  if (pve.operations.exploration) fail('已有远征正在进行');
  const island = explorationConfig(ctx).islands.find(candidate => candidate.id === number(payload.islandId));
  if (!island) fail('远征岛屿不存在');
  const dockLevel = number(ctx.actor.growth?.city?.buildings?.dock?.level ?? ctx.actor.growth?.city?.buildings?.castle?.level);
  if (dockLevel < island.needDockLevel) fail(`码头需要${island.needDockLevel}级`);
  if (number(ctx.actor.vipLevel) < island.needVipLevel) fail(`VIP需要${island.needVipLevel}级`);
  const hours = number(payload.hours, 1);
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > island.maxHours) fail('远征时长无效');
  pve.operations.exploration = { islandId: island.id, islandName: island.name, hours, startedAt: ctx.now, readyAt: ctx.now + hours * HOUR };
  return { message: '远征已开始', exploration: { ...pve.operations.exploration } };
}

function explorationClaim(ctx) {
  const pve = ensure(ctx), active = pve.operations.exploration;
  if (!active) fail('没有可领取的远征');
  if (ctx.now < active.readyAt) fail('远征尚未完成');
  const island = explorationConfig(ctx).islands.find(candidate => candidate.id === active.islandId);
  if (!island) fail('远征岛屿配置缺失');
  const reward = explorationReward(ctx, island, active.hours);
  credit(ctx.actor, 'silver', reward.silver, 'exploration', ctx.now);
  credit(ctx.actor, 'gold', reward.gold, 'exploration', ctx.now);
  credit(ctx.actor, 'crystal', reward.crystal, 'exploration', ctx.now);
  grantXp(ctx, reward.xp);
  counterAdd(pve.tasks.counters, 'explorations', 1, active.islandId);
  pve.operations.exploration = null;
  return { message: '远征奖励已领取', islandId: island.id, reward };
}

function energyBuy(ctx) {
  const pve = ensure(ctx), row = vipRow(ctx), day = dayKey(ctx.now);
  if (!row) fail('VIP精力配置缺失');
  const used = number(pve.operations.energyPurchases[day]), limit = number(row['每天购买额外精力次数']);
  if (used >= limit) fail('今日精力购买次数已用完');
  const growth = ctx.actor.growth ??= {}, energy = number(growth.energy), cap = 40;
  if (energy >= cap) fail('精力已满');
  const cost = number(row['单价']);
  debit(ctx.actor, 'gold', cost, 'energy-purchase', ctx.now);
  const gained = Math.min(10, cap - energy);
  growth.energy = energy + gained;
  pve.operations.energyPurchases[day] = used + 1;
  counterAdd(pve.tasks.counters, 'energyPurchases');
  return { message: '精力购买成功', energy: growth.energy, gained, cost, purchasesToday: used + 1, dailyLimit: limit };
}

function forceTax(ctx) {
  const pve = ensure(ctx), row = vipRow(ctx), day = dayKey(ctx.now), growth = ctx.actor.growth;
  const castle = growth?.city?.buildings?.castle;
  if (!row || !castle) fail('城池或VIP强征配置缺失');
  if (number(castle.readyAt) > ctx.now) fail('城堡升级中');
  const used = number(pve.operations.forcedTaxes[day]), limit = number(row['每天强制征税额外次数']);
  if (used >= limit) fail('今日强制征税次数已用完');
  const cost = 2, silver = Math.max(1, number(castle.level)) * 300;
  debit(ctx.actor, 'gold', cost, 'forced-tax', ctx.now);
  credit(ctx.actor, 'silver', silver, 'forced-tax', ctx.now);
  pve.operations.forcedTaxes[day] = used + 1;
  counterAdd(pve.tasks.counters, 'forcedTaxes');
  return { message: '强制征税成功', silver, cost, claimsToday: used + 1, dailyLimit: limit };
}

function marriageUnion(ctx, actor = ctx.actor) {
  const id = actor.pve?.operations?.marriage?.unionId;
  return id ? ctx.world.pve.marriages.unions[id] : null;
}

function marriagePropose(ctx, payload) {
  ensure(ctx);
  const targetText = String(payload.target ?? '').trim();
  const target = ctx.world.characters?.[targetText] ?? Object.values(ctx.world.characters ?? {}).find(actor => actor.name === targetText);
  if (!target || target.id === ctx.actor.id) fail('求婚对象无效');
  if (ctx.actor.accountId && ctx.actor.accountId === target.accountId) fail('求婚双方必须来自不同账号');
  if (number(ctx.actor.level) < 100 || number(target.level) < 100) fail('求婚双方需要达到100级');
  ensure({ ...ctx, actor: target });
  if (marriageUnion(ctx, ctx.actor) || marriageUnion(ctx, target)) fail('角色已有盟约');
  const pending = Object.values(ctx.world.pve.marriages.proposals).find(proposal => proposal.status === 'pending'
    && [proposal.from, proposal.to].some(id => id === ctx.actor.id || id === target.id));
  if (pending) fail('已有待处理的求婚邀请');
  const id = `proposal:${ctx.actor.id}:${target.id}:${ctx.now}`;
  ctx.world.pve.marriages.proposals[id] = { id, from: ctx.actor.id, to: target.id, status: 'pending', createdAt: ctx.now };
  return { message: '求婚邀请已发出，需要对方角色确认', proposalId: id, targetId: target.id };
}

function marriageRespond(ctx, payload) {
  ensure(ctx);
  const proposal = ctx.world.pve.marriages.proposals[String(payload.proposalId ?? '')];
  if (!proposal || proposal.status !== 'pending' || proposal.to !== ctx.actor.id) fail('求婚邀请不存在');
  const accept = payload.accept === true;
  if (!accept) {
    proposal.status = 'rejected'; proposal.respondedAt = ctx.now;
    return { message: '已拒绝求婚邀请', proposalId: proposal.id, accepted: false };
  }
  const proposer = ctx.world.characters?.[proposal.from];
  if (!proposer || proposer.id === ctx.actor.id || (proposer.accountId && proposer.accountId === ctx.actor.accountId)) fail('求婚双方无效');
  ensure({ ...ctx, actor: proposer });
  if (marriageUnion(ctx, proposer) || marriageUnion(ctx, ctx.actor)) fail('角色已有盟约');
  const members = [proposer.id, ctx.actor.id].sort(), unionId = `union:${members.join(':')}`;
  const union = { id: unionId, members, acceptedAt: ctx.now, proposalId: proposal.id, ceremonyAt: null };
  ctx.world.pve.marriages.unions[unionId] = union;
  proposer.pve.operations.marriage.unionId = unionId;
  ctx.actor.pve.operations.marriage.unionId = unionId;
  proposal.status = 'accepted'; proposal.respondedAt = ctx.now; proposal.unionId = unionId;
  return { message: '双方已同意结成盟约', proposalId: proposal.id, accepted: true, union: { ...union } };
}

function marriageCeremony(ctx) {
  ensure(ctx);
  const union = marriageUnion(ctx);
  if (!union || !union.members.includes(ctx.actor.id)) fail('请先完成双方盟约');
  if (union.ceremonyAt) fail('纪念仪式已举行');
  const cost = 20;
  debit(ctx.actor, 'gold', cost, 'local-marriage-ceremony', ctx.now);
  union.ceremonyAt = ctx.now; union.ceremonyBy = ctx.actor.id;
  ctx.world.mail ??= {};
  for (const actorId of union.members) {
    const otherId = union.members.find(id => id !== actorId), other = ctx.world.characters?.[otherId];
    const id = `marriage:${union.id}:${actorId}`;
    ctx.world.mail[id] = { id, from: 'system', to: actorId, title: '盟约纪念',
      text: `你与${other?.name ?? otherId}已完成双方确认的盟约纪念仪式。`, attachment: null, claimed: true, read: false, at: ctx.now };
  }
  return { message: '盟约纪念仪式已完成，双方已收到纪念邮件', cost: { asset: 'gold', amount: cost }, union: { ...union } };
}

function accountConfirm(ctx) {
  const pve = ensure(ctx), accountId = String(ctx.actor.accountId ?? '').trim(), name = String(ctx.actor.name ?? '').trim();
  if (!accountId || !name) fail('需要已登录账号和有效角色名');
  if (pve.operations.accountConfirmation) fail('本地账号资料已确认');
  pve.operations.accountConfirmation = { accountId, actorName: name, confirmedAt: ctx.now,
    scope: 'local-account-profile-only', documentsCollected: false };
  return { message: '本地账号资料已确认（未采集证件，未联网认证）', confirmation: { ...pve.operations.accountConfirmation } };
}

function elitePackOpen(ctx) {
  ensure(ctx);
  const source = table(ctx.tables, 'kaibao/kaibao').find(row => number(row.id) === 3);
  if (!source) fail('精英包源配置缺失');
  if (number(ctx.actor.level) < number(source.level)) fail(`需要角色等级${number(source.level)}`);
  const cost = number(source.gold);
  const cards = table(ctx.tables, 'Card').filter(row => number(row.ID) > 0 && [1, 2].includes(number(row.Type))
    && number(row.Quality) >= 2 && number(row.Quality) <= 4 && !/废弃/.test(String(row.Name ?? ''))
    && (number(row.Type) !== 1 || number(row.MonsterID) > 0));
  const epic = cards.filter(row => number(row.Quality) >= 3);
  if (!cards.length || !epic.length) fail('精英包卡池缺失');
  debit(ctx.actor, 'gold', cost, 'local-elite-pack', ctx.now);
  const selected = [epic[ctx.randomInt(epic.length)]];
  while (selected.length < 6) selected.push(cards[ctx.randomInt(cards.length)]);
  const granted = selected.map(row => {
    const cardId = number(row.ID), key = `main:card:${cardId}`;
    ctx.actor.cards[key] = number(ctx.actor.cards[key]) + 1;
    return { cardId, quality: number(row.Quality), count: 1 };
  });
  return { message: '本地精英包已开启', sourcePackId: 3, sourceName: String(source.name), cost: { asset: 'gold', amount: cost }, granted };
}

function petIslandRows(ctx) {
  return table(ctx.tables, 'PetIsland').filter(row => Number.isInteger(Number(row.Id)) && number(row.Id) > 0);
}

function petIslandChallenge(ctx, payload) {
  const pve = ensure(ctx), row = petIslandRows(ctx).find(candidate => number(candidate.Id) === number(payload.nodeId ?? 1));
  if (!row) fail('宠物岛节点不存在');
  const growth = ctx.actor.growth ??= {}, energy = number(growth.energy);
  if (energy < 1) fail('精力不足');
  const day = dayKey(ctx.now), collected = number(pve.operations.petIsland.collected[day]);
  const pending = pve.operations.petIsland.pending.filter(node => node.day === day && !node.collected).length;
  if (collected + pending >= number(row.Max)) fail('今日宠物岛采集次数已用完');
  growth.energy = energy - 1;
  return { message: '宠物岛战斗开始', start: { mode: 'pet-island', mapId: number(row.Battleid, 1),
    enemies: [{ monsterId: number(row.MonterId), deckId: number(row.MonterId) }],
    pve: { kind: 'pet-island', nodeId: number(row.Id), day, refreshSeconds: number(row.Time), max: number(row.Max),
      silver: number(row.Silverprize), xp: number(row.ExpPrize) } } };
}

function petIslandCollect(ctx, payload) {
  const pve = ensure(ctx), id = String(payload.collectionId ?? '');
  const node = pve.operations.petIsland.pending.find(candidate => candidate.id === id);
  if (!node || node.collected) fail('宠物岛采集点不存在');
  if (ctx.now < node.readyAt) fail('宠物岛采集点尚未成熟');
  const collected = number(pve.operations.petIsland.collected[node.day]);
  if (collected >= node.max) fail('当日宠物岛采集已达上限');
  const itemId = 1101, itemKey = `main:item:${itemId}`;
  ctx.actor.inventory[itemKey] = number(ctx.actor.inventory[itemKey]) + 1;
  node.collected = true; node.collectedAt = ctx.now;
  pve.operations.petIsland.collected[node.day] = collected + 1;
  counterAdd(pve.tasks.counters, 'petIslandCollections');
  return { message: '宠物岛采集成功', collectionId: id, granted: { itemId, count: 1 } };
}

function petSynthesize(ctx, payload) {
  const pve = ensure(ctx), pets = ctx.actor.growth?.pets;
  if (!pets) fail('宠物系统尚未解锁');
  const sourceIds = Array.isArray(payload.sourcePetIds) ? [...new Set(payload.sourcePetIds.map(number))] : [];
  if (sourceIds.length !== 2 || sourceIds.some(id => !Number.isSafeInteger(id) || !pets[id])) fail('请选择两只不同的已拥有宠物');
  const definitions = sourceIds.map(id => table(ctx.tables, 'Pet').find(row => number(row.ID) === id));
  if (definitions.some(row => !row)) fail('宠物配置缺失');
  const quality = number(definitions[0].Quality);
  if (definitions.some(row => number(row.Quality) !== quality)) fail('只能合成同品质宠物');
  const candidateIds = [...new Set(definitions.flatMap(row => String(row.Reinid ?? '').split('#').map(number).filter(id => id > 0)))];
  const candidates = candidateIds.map(id => table(ctx.tables, 'Pet').find(row => number(row.ID) === id))
    .filter(row => row && number(row.Quality) === quality + 1 && !pets[number(row.ID)]);
  if (!candidates.length) fail('没有可生成的下一品质宠物');
  const result = candidates[ctx.randomInt(candidates.length)], resultId = number(result.ID);
  for (const id of sourceIds) delete pets[id];
  pets[resultId] = { level: 1, exp: 0, skills: [number(result.GiftId)].filter(Boolean) };
  counterAdd(pve.tasks.counters, 'petSyntheses');
  counterAdd(pve.tasks.counters, 'petSynthesisByQuality', 1, number(result.Quality));
  return { message: '宠物合成成功', consumedPetIds: sourceIds, petId: resultId, quality: number(result.Quality), pet: pets[resultId] };
}

let parsedTables = new WeakMap();
function taskCatalog(tables) {
  if (parsedTables.has(tables)) return parsedTables.get(tables);
  const rows = table(tables, 'Task'), descriptions = new Map(table(tables, 'TaskDes')
    .filter(row => number(row.ID) > 0).map(row => [number(row.ID), cleanText(row.des)]));
  const tasks = new Map(), groups = [];
  for (const row of rows) {
    const taskMatch = row._path?.match(/^\/root\[1\]\/tasks\[1\]\/task\[(\d+)\](?:\/(condition|target|prize)\[(\d+)\])?(?:\/(param|fixgoods)\[(\d+)\])?/);
    if (taskMatch) {
      const index = taskMatch[1];
      if (row._tag === 'task') tasks.set(index, { id: number(row.id), name: String(row.name ?? ''), classType: number(row.classtype),
        description: descriptions.get(number(row.desid)) ?? '', conditions: [], targets: [], reward: null });
      const task = tasks.get(index);
      if (!task) continue;
      if (row._tag === 'condition') task.conditions.push({ type: number(row.classtype), params: {} });
      else if (row._tag === 'target') task.targets.push({ type: number(row.classtype), detail: String(row.des ?? ''), params: {} });
      else if (row._tag === 'prize') task.reward = { silver: number(row.silver), gold: number(row.gold), xp: number(row.exp), crystal: number(row.shuijing),
        contribution: number(row.contribution), activity: number(row.huodongpoint), cardId: number(row.cardid), cardCount: number(row.cardnum), items: [] };
      else if (row._tag === 'param') {
        const target = taskMatch[2] === 'condition' ? task.conditions.at(-1) : task.targets.at(-1);
        if (target) {
          const raw = String(row.value ?? '');
          target.params[String(row.name)] = /^-?\d+(?:\.\d+)?$/.test(raw) ? Number(raw) : raw;
        }
      } else if (row._tag === 'fixgoods' && task.reward) task.reward.items.push({ id: number(row.id), count: number(row.num) });
      continue;
    }
    const groupMatch = row._path?.match(/^\/root\[1\]\/groups\[1\]\/group\[(\d+)\](?:\/taskitem\[(\d+)\])?/);
    if (!groupMatch) continue;
    if (row._tag === 'group') groups.push({ index: groupMatch[1], id: number(row.id), classType: number(row.classtype), type: number(row.type),
      dailyActivity: number(row.dailyactivity), taskIds: [] });
    else if (row._tag === 'taskitem') groups.find(group => group.index === groupMatch[1])?.taskIds.push(number(row.id));
  }
  const byId = new Map([...tasks.values()].map(task => [task.id, task]));
  const catalog = { tasks: byId, groups: groups.map(({ index, ...group }) => ({ ...group, tasks: group.taskIds.map(id => byId.get(id)).filter(Boolean) })) };
  parsedTables.set(tables, catalog);
  return catalog;
}

function conditionMet(ctx, condition) {
  const actor = ctx.actor;
  if (condition.type === 1) return number(actor.level) >= number(condition.params.minlevel);
  if (condition.type === 2) return !condition.params.maxlevel || number(actor.level) <= number(condition.params.maxlevel);
  if (condition.type === 3) return number(actor.tutorialStep) >= number(condition.params.teachstep);
  if (condition.type === 4) return actor.pve.tasks.claimed.includes(number(condition.params.taskid))
    || actor.claimed.includes(`source-task:${number(condition.params.taskid)}`);
  return true;
}

function triggerDone(actor, id) {
  return actor.progress.clearedTriggers.some(value => String(value) === String(id) || String(value).endsWith(`:trigger:${id}`));
}

function counterValue(counters, key, qualifier) {
  const value = counters[key];
  if (qualifier === undefined) return number(value);
  if (value && typeof value === 'object') return number(value[String(qualifier)]);
  return number(counters[`${key}:${qualifier}`]);
}

function qualified(params, names) { return names.map(name => params[name] ?? 0).join(':'); }

function progress(value, required = 1, met = undefined) {
  value = number(value); required = Math.max(1, number(required, 1));
  return { value, required, supported: true, met: met ?? value >= required };
}

function unsupported(required = 1) { return { value: 0, required: Math.max(1, number(required, 1)), supported: false, met: false }; }

function targetProgress(ctx, target, task) {
  const { actor } = ctx, counters = actor.pve.tasks.counters, growth = actor.growth ?? {}, params = target.params;
  switch (target.type) {
    case 0: {
      if (/Siege and Defense|City Hall/i.test(target.detail)) return progress(counterValue(counters, 'cityBattles'), 1);
      if (task?.id === 3004) {
        const union = marriageUnion(ctx), proposal = union && ctx.world.pve.marriages.proposals[union.proposalId];
        return progress(proposal?.from === actor.id ? 1 : 0, 1);
      }
      if (task?.id === 3005) return progress(marriageUnion(ctx)?.ceremonyAt ? 1 : 0, 1);
      if (/Shuffle Deck/i.test(target.detail)) return progress(counterValue(counters, 'pvpDeckShuffles'), 1);
      return unsupported(1);
    }
    case 1: return progress(actor.level, params.level);
    case 2: return progress(Math.max(counterValue(counters, 'triggers', params.triggerid), triggerDone(actor, params.triggerid) ? 1 : 0), 1);
    case 3: return progress(Math.max(counterValue(counters, 'triggers', params.triggerid), triggerDone(actor, params.triggerid) ? 1 : 0), params.num);
    case 4: {
      const ids = String(params.triggerid ?? '').split(',').map(Number).filter(Number.isFinite);
      const value = ids.reduce((sum, id) => sum + Math.max(counterValue(counters, 'triggers', id), triggerDone(actor, id) ? 1 : 0), 0);
      return progress(value, params.num);
    }
    case 5: {
      if (![1, 2, 3, 12, 15].includes(number(params.mode))) return unsupported(params.num);
      const key = qualified(params, ['mode', 'sameguild']);
      const value = number(params.win) > 0 ? counterValue(counters, 'pvpWins', key) : counterValue(counters, 'pvpMatches', key);
      return progress(value || (number(params.mode) === 15 ? number(params.win) > 0 ? actor.wins : actor.stats.pvpMatches : 0), params.num);
    }
    case 6: return progress(Math.max(0, ...Object.values(actor.enhancements ?? {}).map(number)), params.num);
    case 7: return progress(counterValue(counters, 'cardSynthesisByQuality', params.quality), params.num);
    case 8: return progress(counterValue(counters, 'dungeonWins', qualified(params, ['mode', 'fubenid', 'sameguild'])), params.num);
    case 9: return [1, 2, 3].includes(number(params.baoid)) ? progress(counterValue(counters, 'packs', params.baoid), 1) : unsupported(1);
    case 10: return progress(counterValue(counters, 'taxClaims'), params.num);
    case 11: {
      const building = ({ 1: 'castle', 2: 'dock', 3: 'alchemy', 4: 'smithy', 5: 'defense' })[number(params.type)] ?? String(params.type);
      return progress(growth.city?.buildings?.[building]?.level, params.level);
    }
    case 12: return progress(counterValue(counters, 'explorations', params.islandid), params.num);
    case 13: return progress([1, 2, 3, 4].includes(number(actor.profession)) ? 1 : 0, 1);
    case 14: return progress(actor.rating, params.score);
    case 15: return progress(counterValue(counters, 'dailyRandom'), 1);
    case 16: return progress((ctx.world.friendships ?? []).some(pair => String(pair).includes(actor.id)) ? 1 : 0, 1);
    case 17: return progress(counterValue(counters, 'donations'), 1);
    case 18: return progress(counterValue(counters, 'equipmentCraftByQuality', params.quality), params.num);
    case 19: return progress(counterValue(counters, 'cardDismantleByQuality', params.quality), params.num);
    case 20: return progress(counterValue(counters, 'cardFuseByQuality', params.quality), params.num);
    case 21: return progress(actor.guildId ? 1 : 0, 1);
    case 22: return progress(counterValue(counters, 'energyPurchases'), 1);
    case 23: return progress(counterValue(counters, 'forcedTaxes'), params.num || 1);
    case 24: {
      const have1 = number(actor.inventory[`main:item:${number(params.goodid1)}`]);
      const have2 = params.goodid2 ? number(actor.inventory[`main:item:${number(params.goodid2)}`]) : 1;
      const need1 = number(params.goodid1num, 1), need2 = params.goodid2 ? number(params.goodid2num, 1) : 1;
      return progress(Math.min(have1 / need1, have2 / need2), 1);
    }
    case 25: return progress(actor.pve.tower.highestNormal, params.level);
    case 26: return progress(growth.reputationClaims?.length, 1);
    case 27: return progress(counterValue(counters, 'localGrantedGold'), params.targetgold);
    case 28: return progress(actor.pve.operations.accountConfirmation ? 1 : 0, 1);
    case 29: return progress(counterValue(counters, 'openedCardsByQuality', params.rank), params.num || 1);
    case 30: return progress(counterValue(counters, 'monsterKills', params.monsterid), params.num);
    case 31: return progress(counterValue(counters, 'dungeonMonsterKills', qualified(params, ['mode', 'fubenid', 'monsterid', 'sameguild'])), params.monsternum);
    case 32: {
      if (!params.turns) return progress(counterValue(counters, 'dungeonWins', qualified(params, ['mode', 'fubenid', 'sameguild'])), params.num);
      const best = counterValue(counters, 'dungeonBestTurns', qualified(params, ['mode', 'fubenid', 'sameguild']));
      const limit = number(params.turns, 1);
      return progress(best ? Math.max(0, limit - best + 1) : 0, 1, best > 0 && best <= limit);
    }
    case 33: return progress(counterValue(counters, number(params.win) > 0 ? 'cityAttackWins' : 'cityAttacks'), params.num);
    case 34: return progress(counterValue(counters, number(params.win) > 0 ? 'athleticsWins' : 'athleticsMatches'), params.num);
    case 35: return progress(counterValue(counters, 'petFeeds'), params.num);
    case 36: {
      const pets = Object.values(growth.pets ?? {}), level = number(params.petid) < 0 ? Math.max(0, ...pets.map(pet => number(pet.level))) : number(growth.pets?.[params.petid]?.level);
      return progress(level, params.level);
    }
    case 37: return progress(counterValue(counters, 'petSyntheses'), params.num);
    case 38: return progress(actor.pve.tower.highestInfernal, params.level);
    case 39: return progress(counterValue(counters, 'petIslandCollections'), params.num);
    case 40: return progress(Math.max(counterValue(counters, 'loopQuests'), Object.keys(growth.repeatClaims ?? {}).length), params.num);
    case 41: {
      const levels = counters.helperDungeonWinsByLevel ?? {};
      const value = Object.entries(levels).filter(([level]) => number(level) >= number(params.minlevel) && number(level) <= number(params.maxlevel))
        .reduce((sum, [, count]) => sum + number(count), 0);
      return progress(value, params.num);
    }
    default: return progress(counterValue(counters, `targetType${target.type}`), params.num || 1);
  }
}

function taskView(ctx, task) {
  const progress = task.targets.map(target => ({ detail: target.detail, type: target.type, ...targetProgress(ctx, target, task) }));
  const eligible = task.conditions.every(condition => conditionMet(ctx, condition));
  const claimed = ctx.actor.pve.tasks.claimed.includes(task.id);
  const ready = eligible && progress.length > 0 && progress.every(item => item.supported && item.met);
  return { id: task.id, name: task.name, description: task.description, eligible, ready, claimed, progress, reward: task.reward };
}

function claimTask(ctx, payload) {
  ensure(ctx);
  const task = taskCatalog(ctx.tables).tasks.get(number(payload.taskId));
  if (!task) fail('任务不存在');
  const view = taskView(ctx, task);
  if (!view.eligible || !view.ready || view.claimed) fail('任务未完成或已领取');
  const reward = task.reward ?? {};
  credit(ctx.actor, 'silver', number(reward.silver), 'source-task', ctx.now);
  credit(ctx.actor, 'gold', number(reward.gold), 'source-task', ctx.now);
  credit(ctx.actor, 'crystal', number(reward.crystal), 'source-task', ctx.now);
  grantXp(ctx, reward.xp);
  if (number(reward.cardId) > 0 && number(reward.cardCount) > 0) {
    const key = `main:card:${reward.cardId}`;
    ctx.actor.cards[key] = number(ctx.actor.cards[key]) + number(reward.cardCount);
  }
  for (const item of reward.items ?? []) {
    const key = `main:item:${item.id}`;
    ctx.actor.inventory[key] = number(ctx.actor.inventory[key]) + item.count;
  }
  ctx.actor.pve.tasks.contribution = number(ctx.actor.pve.tasks.contribution) + number(reward.contribution);
  ctx.actor.pve.tasks.activity = number(ctx.actor.pve.tasks.activity) + number(reward.activity);
  ctx.actor.pve.tasks.claimed.push(task.id);
  ctx.actor.claimed.push(`source-task:${task.id}`);
  return { message: '任务奖励已领取', taskId: task.id, reward };
}

const handlers = {
  'tower.challenge': towerChallenge, 'tower.refresh': towerRefresh, 'tower.reset': towerReset,
  'worldBoss.challenge': worldBossChallenge, 'worldBoss.hire': worldBossHire, 'worldBoss.reward.claim': worldBossRewardClaim,
  'forbidden.challenge': forbiddenChallenge, 'forbidden.shop.buy': forbiddenBuy, 'forbidden.reward.claim': forbiddenRewardClaim,
  'quest.explore.start': explorationStart, 'quest.explore.claim': explorationClaim,
  'quest.energy.buy': energyBuy, 'quest.tax.force': forceTax,
  'quest.marriage.propose': marriagePropose, 'quest.marriage.respond': marriageRespond,
  'quest.marriage.ceremony': marriageCeremony, 'quest.account.confirm': accountConfirm,
  'quest.elitePack.open': elitePackOpen,
  'petIsland.challenge': petIslandChallenge, 'petIsland.collect': petIslandCollect, 'pet.synthesize': petSynthesize,
  'task.claim': claimTask
};

export function operatePve(ctx, action, payload = {}) {
  ensure(ctx);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('payload无效');
  const handler = handlers[action];
  if (!handler || !pveActions.includes(action)) fail('未知PVE操作');
  const result = handler(ctx, payload);
  const response = { action, at: ctx.now, result: Object.fromEntries(Object.entries(result).filter(([key]) => key !== 'start')) };
  return result.start ? { response, start: result.start } : response;
}

function copyNumbers(value) {
  return Object.fromEntries(Object.entries(value ?? {}).map(([key, amount]) => [key, number(amount)]));
}

function copyPets(value) {
  return Object.fromEntries(Object.entries(value ?? {}).map(([key, pet]) => [key, { level: number(pet?.level), exp: number(pet?.exp) }]));
}

function actorFriendCount(world, actorId) {
  return (world.friendships ?? []).filter(pair => String(pair).split(':').includes(String(actorId))).length;
}

export function pveActionSnapshot(ctx) {
  ensure(ctx);
  const growth = ctx.actor.growth ?? {}, guild = ctx.world.guilds?.[ctx.actor.guildId];
  return {
    currencies: copyNumbers(ctx.actor.currencies),
    inventory: copyNumbers(ctx.actor.inventory),
    cards: copyNumbers(ctx.actor.cards),
    deck: [...(ctx.actor.deck ?? [])],
    enhancements: copyNumbers(ctx.actor.enhancements),
    growth: {
      cityLastTaxDay: growth.city?.lastTaxDay ?? null,
      reputationClaims: [...(growth.reputationClaims ?? [])],
      repeatClaims: Object.keys(growth.repeatClaims ?? {}).sort(),
      pets: copyPets(growth.pets),
      wheelDay: growth.activities?.wheelDay ?? null,
      wheelCount: number(growth.activities?.wheelCount)
    },
    guildContribution: number(guild?.contributions?.[ctx.actor.id]),
    friendshipCount: actorFriendCount(ctx.world, ctx.actor.id)
  };
}

function positiveDeltas(after, before) {
  const result = [];
  for (const [key, value] of Object.entries(after ?? {})) {
    const delta = number(value) - number(before?.[key]);
    if (delta > 0) result.push([key, delta]);
  }
  return result;
}

function negativeTotal(after, before) {
  return Object.keys({ ...(before ?? {}), ...(after ?? {}) }).reduce((sum, key) => sum + Math.max(0, number(before?.[key]) - number(after?.[key])), 0);
}

function numericAssetId(key, kind) {
  if (Number.isSafeInteger(Number(key)) && Number(key) > 0) return Number(key);
  const match = String(key).match(new RegExp(`^main:${kind}:(\\d+)$`));
  return match ? Number(match[1]) : 0;
}

function configuredQuality(ctx, kind, id) {
  const name = kind === 'card' ? 'Card' : 'Equipment', idFields = kind === 'card' ? ['ID'] : ['物品ID\n', '物品ID', 'ID'];
  const row = table(ctx.tables, name).find(candidate => idFields.some(field => number(candidate[field]) === id));
  return row ? number(kind === 'card' ? row.Quality : row['品质']) : -1;
}

export function onPveAction(ctx, action, payload = {}, response = undefined, before = undefined) {
  if (!before || typeof before !== 'object') fail('PVE任务钩子缺少操作前快照');
  const pve = ensure(ctx), after = pveActionSnapshot(ctx), counters = pve.tasks.counters, counted = {};
  const add = (key, amount = 1, qualifier) => {
    const value = counterAdd(counters, key, amount, qualifier);
    if (value) counted[qualifier === undefined ? key : `${key}:${qualifier}`] = value;
  };
  if (['test.grant', 'activity.weeklyGrant', 'activity.rewardBonus'].includes(action)) {
    const gold = Math.max(0, number(after.currencies.gold) - number(before.currencies?.gold));
    add('localGrantedGold', gold);
  } else if (action === 'deck.save' && payload.openingShuffle === true) {
    const previous = [...(before.deck ?? [])], current = [...after.deck];
    const sameCards = previous.length === current.length
      && [...previous].sort().every((card, index) => card === [...current].sort()[index]);
    if (sameCards && previous.some((card, index) => card !== current[index])) {
      debit(ctx.actor, 'gold', 1, 'local-pvp-opening-shuffle', ctx.now);
      pve.operations.pendingPvpShuffle = { deck: current, savedAt: ctx.now };
      if (response && typeof response === 'object') response.message = '卡组已保存，已消耗1金币登记下一场PvP开局洗牌';
    }
  } else if (action === 'room.start' && pve.operations.pendingPvpShuffle) {
    const record = ctx.world.battles?.[response?.battleId], battle = realCompetitiveBattle(ctx, record);
    const player = record?.state?.players?.find(candidate => candidate.id === ctx.actor.id);
    const actuallyStarted = battle && ['pvp', 'ranked'].includes(record.mode) && player
      && ((player.hand?.length ?? 0) + (player.drawPile?.length ?? 0) > 0);
    if (actuallyStarted) {
      add('pvpDeckShuffles');
      delete pve.operations.pendingPvpShuffle;
    }
  } else if (action === 'quest.elitePack.open') {
    const received = positiveDeltas(after.cards, before.cards);
    if (received.length && number(after.currencies.gold) < number(before.currencies?.gold)) {
      add('packs', 1, 3);
      for (const [key, amount] of received) {
        const quality = configuredQuality(ctx, 'card', numericAssetId(key, 'card'));
        if (quality >= 0) add('openedCardsByQuality', amount, quality);
      }
    }
  } else if (action === 'city.tax' && before.growth?.cityLastTaxDay !== after.growth.cityLastTaxDay
      && number(after.currencies.silver) > number(before.currencies?.silver)) add('taxClaims');
  else if (action === 'guild.donate' && after.guildContribution > number(before.guildContribution)) add('donations');
  else if (action === 'friend.accept' && after.friendshipCount > number(before.friendshipCount)) add('friendAccepts');
  else if (action === 'quest.repeatClaim') {
    const delta = after.growth.repeatClaims.filter(key => !(before.growth?.repeatClaims ?? []).includes(key)).length;
    add('loopQuests', delta);
  } else if (action === 'activity.wheel' && (after.growth.wheelDay !== before.growth?.wheelDay
      || after.growth.wheelCount > number(before.growth?.wheelCount))) add('dailyRandom');
  else if (action === 'pet.feed') {
    const exp = Object.keys({ ...(before.growth?.pets ?? {}), ...after.growth.pets }).reduce((sum, id) =>
      sum + Math.max(0, number(after.growth.pets[id]?.exp) - number(before.growth?.pets?.[id]?.exp)), 0);
    const consumed = negativeTotal(after.inventory, before.inventory);
    if (exp > 0 && consumed > 0) add('petFeeds', Math.min(consumed, Math.max(1, number(payload.count, 1))));
  } else if (action === 'magic.dismantle') {
    const id = numericAssetId(payload.cardId, 'card'), quality = configuredQuality(ctx, 'card', id);
    const consumed = Math.max(0, number(before.cards?.[`main:card:${id}`]) - number(after.cards[`main:card:${id}`]));
    if (quality >= 0) add('cardDismantleByQuality', consumed, quality);
  } else if (action === 'magic.synthesize') {
    for (const [key, amount] of positiveDeltas(after.cards, before.cards)) {
      const quality = configuredQuality(ctx, 'card', numericAssetId(key, 'card'));
      if (quality >= 0) add('cardSynthesisByQuality', amount, quality);
    }
  } else if (['magic.refine', 'magic.fuse', 'magic.enchant'].includes(action)) {
    for (const [key, amount] of positiveDeltas(after.cards, before.cards)) {
      const quality = configuredQuality(ctx, 'card', numericAssetId(key, 'card'));
      if (quality >= 0) add('cardFuseByQuality', amount, quality);
    }
  } else if (action === 'equipment.craft') {
    for (const [key, amount] of positiveDeltas(after.inventory, before.inventory)) {
      const quality = configuredQuality(ctx, 'equipment', numericAssetId(key, 'item'));
      if (quality >= 0) add('equipmentCraftByQuality', amount, quality);
    }
  } else if (['shop.openPack', 'shop.openTen'].includes(action)) {
    const received = positiveDeltas(after.cards, before.cards).reduce((sum, [, amount]) => sum + amount, 0);
    if (received > 0 && number(after.currencies.gold) < number(before.currencies?.gold)) {
      const packId = action === 'shop.openTen' ? 2 : String(payload.offerId ?? 'pack:basic') === 'pack:basic' ? 1 : 0;
      if (packId) add('packs', 1, packId);
    }
  }
  return { action, counted, response };
}

function uiItem(label, detail, action, payload = {}, disabled = false, fields = undefined) {
  const item = { label, detail, action, payload, disabled };
  if (fields) item.fields = fields;
  return item;
}

export function pveView(ctx) {
  const pve = ensure(ctx), boss = activeWorldBoss(ctx), forbidden = activeForbidden(ctx), tasks = taskCatalog(ctx.tables);
  const bossClaims = Object.values(ctx.world.pve.worldBoss).filter(season => season.rewardsFinalized
    && season.rewardEligibility?.[ctx.actor.id]?.length && !pve.worldBoss.rewardClaims.includes(`${season.key}:${ctx.actor.id}`));
  const forbiddenClaims = Object.values(ctx.world.pve.forbidden).filter(season => season.rewardsFinalized
    && season.rewardEligibility?.[ctx.actor.id] && !pve.forbidden.rewardClaims.includes(`${season.key}:${ctx.actor.id}`));
  const groups = tasks.groups.map(group => ({ id: group.id, type: group.type, classType: group.classType, dailyActivity: group.dailyActivity,
    tasks: group.tasks.map(task => taskView(ctx, task)) }));
  const layouts = towerRows(ctx), normalMax = Math.max(...layouts.filter(row => number(row.MaxLayout) < 501).map(row => number(row.MaxLayout))),
    infernalMax = Math.max(...layouts.filter(row => number(row.MinLayout) >= 501).map(row => number(row.MaxLayout))),
    normalComplete = pve.tower.nextNormal > normalMax, infernalComplete = pve.tower.nextInfernal > infernalMax,
    normal = towerRow(ctx, Math.min(pve.tower.nextNormal, normalMax)), infernal = towerRow(ctx, Math.min(pve.tower.nextInfernal, infernalMax));
  const rankings = Object.values(ctx.world.characters ?? {}).map(actor => ({ id: actor.id, name: actor.name,
    score: number(actor.pve?.forbidden?.score) })).sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  const explorations = explorationConfig(ctx), activeExploration = pve.operations.exploration, vip = vipRow(ctx), today = dayKey(ctx.now);
  const energyUsed = number(pve.operations.energyPurchases[today]), energyLimit = number(vip?.['每天购买额外精力次数']);
  const taxUsed = number(pve.operations.forcedTaxes[today]), taxLimit = number(vip?.['每天强制征税额外次数']);
  const ownedPets = Object.keys(ctx.actor.growth?.pets ?? {}).map(Number).filter(Number.isSafeInteger);
  const petDefinitions = new Map(table(ctx.tables, 'Pet').filter(row => number(row.ID) > 0).map(row => [number(row.ID), row]));
  const synthesisPairs = [];
  for (const quality of [...new Set(ownedPets.map(id => number(petDefinitions.get(id)?.Quality)))]) {
    const pair = ownedPets.filter(id => number(petDefinitions.get(id)?.Quality) === quality).slice(0, 2);
    if (pair.length === 2) synthesisPairs.push(pair);
  }
  const union = marriageUnion(ctx), pendingMarriage = Object.values(ctx.world.pve.marriages.proposals)
    .find(proposal => proposal.status === 'pending' && (proposal.from === ctx.actor.id || proposal.to === ctx.actor.id));
  const incomingMarriage = Object.values(ctx.world.pve.marriages.proposals)
    .find(proposal => proposal.status === 'pending' && proposal.to === ctx.actor.id);
  const elitePack = table(ctx.tables, 'kaibao/kaibao').find(row => number(row.id) === 3);
  const operationItems = [
    uiItem('购买 10 点精力', `${number(vip?.['单价'])} 金币，今日 ${energyUsed}/${energyLimit}`, 'quest.energy.buy', {}, energyUsed >= energyLimit || number(ctx.actor.growth?.energy) >= 40),
    uiItem('强制征税', `2 金币，今日 ${taxUsed}/${taxLimit}`, 'quest.tax.force', {}, taxUsed >= taxLimit || !ctx.actor.growth?.city?.buildings?.castle),
    ...(activeExploration
      ? [uiItem(`领取远征：${activeExploration.islandName}`, ctx.now >= activeExploration.readyAt ? '已完成' : `完成时间 ${activeExploration.readyAt}`,
        'quest.explore.claim', {}, ctx.now < activeExploration.readyAt)]
      : explorations.islands.map(island => {
        const dock = number(ctx.actor.growth?.city?.buildings?.dock?.level ?? ctx.actor.growth?.city?.buildings?.castle?.level);
        const disabled = dock < island.needDockLevel || number(ctx.actor.vipLevel) < island.needVipLevel;
        return uiItem(`远征：${island.name}`, `1小时，最长 ${island.maxHours}小时`, 'quest.explore.start', { islandId: island.id, hours: 1 }, disabled,
          [{ key: 'hours', label: '远征小时', type: 'number', value: 1 }]);
      })),
    uiItem('本地账号资料确认', pve.operations.accountConfirmation ? '已确认；仅核对本地账号与角色名，不采集证件、不联网认证' : '仅核对本地账号与角色名，不采集证件、不联网认证',
      'quest.account.confirm', {}, Boolean(pve.operations.accountConfirmation)),
    uiItem('开启本地精英卡包', `${number(elitePack?.gold)} 金币；至少获得一张品质3以上有效卡牌`, 'quest.elitePack.open', {},
      !elitePack || number(ctx.actor.level) < number(elitePack?.level) || number(ctx.actor.currencies.gold) < number(elitePack?.gold)),
    uiItem('发起本地盟约', '需要双方达到100级并由对方账号确认', 'quest.marriage.propose', { target: '' },
      number(ctx.actor.level) < 100 || Boolean(union) || Boolean(pendingMarriage),
      [{ key: 'target', label: '对方角色名或ID', type: 'text', value: '' }]),
    ...(incomingMarriage ? [
      uiItem('接受盟约邀请', `来自 ${ctx.world.characters?.[incomingMarriage.from]?.name ?? incomingMarriage.from}`, 'quest.marriage.respond',
        { proposalId: incomingMarriage.id, accept: true }),
      uiItem('拒绝盟约邀请', `来自 ${ctx.world.characters?.[incomingMarriage.from]?.name ?? incomingMarriage.from}`, 'quest.marriage.respond',
        { proposalId: incomingMarriage.id, accept: false })
    ] : []),
    ...(union && !union.ceremonyAt ? [uiItem('举行盟约纪念仪式', '消耗 20 金币，双方收到纪念邮件', 'quest.marriage.ceremony', {},
      number(ctx.actor.currencies.gold) < 20)] : []),
    ...petIslandRows(ctx).map(row => uiItem(`挑战宠物岛节点 ${row.Id}`, `消耗 1 精力，${row.Time}秒后可采集`, 'petIsland.challenge', { nodeId: number(row.Id) }, number(ctx.actor.growth?.energy) < 1)),
    ...pve.operations.petIsland.pending.filter(node => !node.collected).map(node => uiItem(`采集宠物岛节点 ${node.nodeId}`,
      ctx.now >= node.readyAt ? '已成熟' : `成熟时间 ${node.readyAt}`, 'petIsland.collect', { collectionId: node.id }, ctx.now < node.readyAt)),
    ...synthesisPairs.map(pair => uiItem(`合成宠物 ${pair.join(' + ')}`, '消耗两只同品质宠物', 'pet.synthesize', { sourcePetIds: pair }))
  ];
  return { version: 1, state: pve, schedules: { worldBoss: boss.config.schedule, forbidden: forbidden.config.schedule }, groups,
    rankings, sections: [
      { id: 'tower', title: '通天塔', items: [
        uiItem(normalComplete ? '普通塔已通关' : `挑战普通第 ${pve.tower.nextNormal} 层`, `入场 ${number(normal.EnterPrice)} 银币`, 'tower.challenge', { mode: 'normal' }, normalComplete),
        uiItem('刷新普通层敌人', `消耗 ${number(normal.RefreshPrice)} 银币`, 'tower.refresh', { mode: 'normal' }, normalComplete || !number(normal.EnableRefresh)),
        uiItem('重置普通塔', '回到第 1 层', 'tower.reset', { mode: 'normal' }, pve.tower.highestNormal < 1),
        uiItem(infernalComplete ? '地狱塔已通关' : `挑战地狱第 ${pve.tower.nextInfernal} 层`, `入场 ${number(infernal.EnterPrice)} 银币`, 'tower.challenge', { mode: 'infernal' }, infernalComplete),
        uiItem('刷新地狱层敌人', `消耗 ${number(infernal.RefreshPrice)} 银币`, 'tower.refresh', { mode: 'infernal' }, infernalComplete || !number(infernal.EnableRefresh)),
        uiItem('重置地狱塔', '回到第 501 层', 'tower.reset', { mode: 'infernal' }, pve.tower.highestInfernal < 501)
      ] },
      { id: 'world-boss', title: '世界Boss', items: [
        uiItem('挑战世界Boss', boss.open ? `剩余生命 ${boss.season.hp}/${boss.season.maxHp}` : '当前未开放', 'worldBoss.challenge', {}, !boss.open),
        ...boss.config.hires.map(hire => {
          const hired = pve.worldBoss.hires[boss.key] ?? [];
          return uiItem(`雇佣佣兵 ${hire.id}`, `${hire.cost} 金币`, 'worldBoss.hire', { id: hire.id },
            !boss.open || hired.includes(hire.cardId) || hired.length >= 3);
        }),
        ...bossClaims.map(season => uiItem(`领取世界Boss ${season.key} 奖励`, `${season.rewardEligibility[ctx.actor.id].length} 项`,
          'worldBoss.reward.claim', { seasonKey: season.key }))
      ] },
      { id: 'forbidden', title: '禁地', items: [
        uiItem('挑战禁地', `当前积分 ${pve.forbidden.score}`, 'forbidden.challenge', {}, !forbidden.open),
        ...forbiddenOffers(forbidden.config).map(offer => uiItem(`兑换灵魂石 ${offer.itemId}`, `${offer.cost} 积分`, 'forbidden.shop.buy', { offerId: offer.id }, pve.forbidden.score < offer.cost)),
        ...forbiddenClaims.map(season => uiItem(`领取禁地 ${season.key} 奖励`, `排名 ${season.rewardEligibility[ctx.actor.id].rank}`,
          'forbidden.reward.claim', { seasonKey: season.key }))
      ] },
      { id: 'quest-operations', title: '任务行动', items: operationItems },
      { id: 'tasks', title: '任务', items: groups.flatMap(group => group.tasks).filter(task => task.eligible && !task.claimed)
        .map(task => uiItem(task.name, task.progress.map(item => `${item.detail} ${item.value}/${item.required}`).join('；'),
          'task.claim', { taskId: task.id }, !task.ready)) }
    ] };
}

function milestoneReward(ctx, layer, infernal) {
  if ((infernal ? layer - 500 : layer) % 5 !== 0) return null;
  const index = (infernal ? layer - 500 : layer) / 5;
  const row = table(ctx.tables, 'TownGoldPrize').find(candidate => number(candidate['层数/5']) === index && number(candidate['类型']) === (infernal ? 1 : 0));
  if (!row) return null;
  const type = number(row['类型 1金币2银币3塔币']), amount = number(row['数量']);
  if (type === 1) credit(ctx.actor, 'gold', amount, 'tower-milestone', ctx.now);
  else if (type === 2) credit(ctx.actor, 'silver', amount, 'tower-milestone', ctx.now);
  else ctx.actor.pve.tower.coins += amount;
  return { type, amount };
}

function damageFrom(record, actorId, hp) {
  const explicit = record.pve?.damageDealt ?? record.damageDealt?.[actorId];
  if (explicit !== undefined && number(explicit) >= 0) return Math.min(hp, number(explicit));
  const stats = record.state?.stats?.damageByActor;
  if (stats && stats[actorId] !== undefined && number(stats[actorId]) >= 0) return Math.min(hp, number(stats[actorId]));
  return 0;
}

function countKilledMonsters(counters, killed) {
  counters.monsterKills ??= {};
  const counted = {};
  if (Array.isArray(killed)) {
    for (const entry of killed) {
      const id = number(typeof entry === 'object' ? entry.monsterId : entry), count = number(typeof entry === 'object' ? entry.count : 1, 1);
      if (id > 0 && count > 0) { counters.monsterKills[id] = number(counters.monsterKills[id]) + count; counted[id] = number(counted[id]) + count; }
    }
  } else if (killed && typeof killed === 'object') {
    for (const [id, count] of Object.entries(killed)) if (number(id) > 0 && number(count) > 0) {
      counters.monsterKills[number(id)] = number(counters.monsterKills[number(id)]) + number(count);
      counted[number(id)] = number(counted[number(id)]) + number(count);
    }
  }
  return counted;
}

function sourceTriggerId(value) {
  const match = String(value ?? '').match(/(?:^|:trigger:)(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function dungeonDescriptor(ctx, sceneId) {
  for (const row of table(ctx.tables, 'scene/fubens')) {
    const id = number(row['副本ID']);
    if (!id) continue;
    for (const [column, mode] of [['简单', 1], ['普通', 2], ['困难', 4]]) if (number(row[column]) === number(sceneId)) return { id, mode };
  }
  return null;
}

function countCampaignDungeon(ctx, record, killed) {
  if (!record.level || !record.state) return;
  const dungeon = dungeonDescriptor(ctx, String(record.level.sceneId).split(':').at(-1));
  if (!dungeon) return;
  const counters = ctx.actor.pve.tasks.counters;
  counters.dungeonWins ??= {}; counters.dungeonMonsterKills ??= {}; counters.dungeonBestTurns ??= {};
  const keys = [`${dungeon.mode}:${dungeon.id}:0`];
  const others = (record.participants ?? []).filter(id => id !== ctx.actor.id).map(id => ctx.world.characters?.[id]).filter(Boolean);
  const sameGuild = ctx.actor.guildId && others.some(actor => actor.guildId === ctx.actor.guildId);
  if (sameGuild) keys.push(`${dungeon.mode}:${dungeon.id}:1`);
  for (const key of keys) {
    counters.dungeonWins[key] = number(counters.dungeonWins[key]) + 1;
    const turns = number(record.state.turn);
    if (turns > 0 && (!number(counters.dungeonBestTurns[key]) || turns < number(counters.dungeonBestTurns[key]))) counters.dungeonBestTurns[key] = turns;
    for (const [monsterId, count] of Object.entries(killed)) {
      const monsterKey = `${dungeon.mode}:${dungeon.id}:${monsterId}:${key.endsWith(':1') ? 1 : 0}`;
      counters.dungeonMonsterKills[monsterKey] = number(counters.dungeonMonsterKills[monsterKey]) + number(count);
    }
  }
  if (record.mode === 'coop') {
    counters.helperDungeonWinsByLevel ??= {};
    for (const other of others) counters.helperDungeonWinsByLevel[other.level] = number(counters.helperDungeonWinsByLevel[other.level]) + 1;
  }
}

function realCompetitiveBattle(ctx, record) {
  const ids = Array.isArray(record?.participants) ? [...new Set(record.participants)] : [];
  const pvpSize = record?.mode === 'pvp' && [2, 4, 8].includes(ids.length);
  const duelSize = ['ranked', 'clan-war', 'tournament'].includes(record?.mode) && ids.length === 2;
  if ((!pvpSize && !duelSize) || !ids.includes(ctx.actor.id)) return null;
  const players = Array.isArray(record.state?.players) ? record.state.players : [];
  if (ids.some(id => !ctx.world.characters?.[id] || players.find(player => player.id === id)?.ai !== false)) return null;
  const actors = ids.map(id => ctx.world.characters[id]);
  const accounts = actors.map(actor => String(actor.accountId ?? '').trim());
  if (accounts.some(accountId => !accountId) || new Set(accounts).size !== actors.length) return null;
  const teamSize = ids.length / 2;
  if (record.teamSize !== undefined && number(record.teamSize) !== teamSize) return null;
  const participantPlayers = ids.map(id => players.find(player => player.id === id));
  const teams = [...new Set(participantPlayers.map(player => number(player.team)))];
  if (teams.length !== 2 || teams.some(team => participantPlayers.filter(player => number(player.team) === team).length !== teamSize)) return null;
  const actorPlayer = participantPlayers.find(player => player.id === ctx.actor.id), actorTeam = number(actorPlayer.team);
  return { actors, players: participantPlayers, teamSize, actorTeam,
    teammates: actors.filter(actor => actor.id !== ctx.actor.id
      && number(participantPlayers.find(player => player.id === actor.id)?.team) === actorTeam) };
}

function countCompetitiveBattle(ctx, record, won) {
  if (!['pvp', 'ranked', 'clan-war', 'tournament'].includes(record?.mode)) return false;
  const battle = realCompetitiveBattle(ctx, record);
  if (!battle) return false;
  const counters = ctx.actor.pve.tasks.counters;
  if (record.mode === 'pvp' || record.mode === 'ranked') {
    const actualBit = battle.teamSize;
    const sameGuildTeam = battle.teammates.length > 0 && Boolean(ctx.actor.guildId)
      && battle.teammates.every(actor => actor.guildId === ctx.actor.guildId);
    for (const mode of [1, 2, 3, 12, 15].filter(mask => (mask & actualBit) !== 0)) {
      counterAdd(counters, 'pvpMatches', 1, `${mode}:0`);
      if (won) counterAdd(counters, 'pvpWins', 1, `${mode}:0`);
      if (sameGuildTeam) {
        counterAdd(counters, 'pvpMatches', 1, `${mode}:1`);
        if (won) counterAdd(counters, 'pvpWins', 1, `${mode}:1`);
      }
    }
    if (record.mode === 'ranked') {
      counterAdd(counters, 'rankedMatches');
      if (won) counterAdd(counters, 'rankedWins');
    }
  } else if (record.mode === 'clan-war') {
    counterAdd(counters, 'cityAttacks');
    counterAdd(counters, 'cityBattles');
    if (won) counterAdd(counters, 'cityAttackWins');
  } else {
    counterAdd(counters, 'athleticsMatches');
    if (won) counterAdd(counters, 'athleticsWins');
  }
  return true;
}

export function onPveBattleSettled(ctx, record, won) {
  const pve = ensure(ctx);
  if (['pvp', 'ranked', 'clan-war', 'tournament'].includes(record?.mode)) {
    record.pveSettledActors ??= [];
    if (record.pveSettledActors.includes(ctx.actor.id)) return false;
    if (!countCompetitiveBattle(ctx, record, won)) return false;
    record.pveSettledActors.push(ctx.actor.id);
    return true;
  }
  const meta = record?.pve?.kind ? record.pve : record?.level && ['pve', 'coop'].includes(record.mode)
    ? { kind: 'campaign', triggerId: record.level.triggerId, sceneId: record.level.sceneId } : null;
  if (!meta?.kind) return false;
  record.pveSettledActors ??= [];
  if (record.pveSettledActors.includes(ctx.actor.id)) return false;
  record.pveSettledActors.push(ctx.actor.id);
  pve.tasks.counters.pveBattles++;
  if (won) pve.tasks.counters.pveWins++;
  const killed = countKilledMonsters(pve.tasks.counters, record.killedMonsters?.[ctx.actor.id]);
  if (meta.kind === 'campaign') {
    if (won) {
      const triggerId = sourceTriggerId(meta.triggerId);
      if (triggerId > 0) {
        pve.tasks.counters.triggers ??= {};
        pve.tasks.counters.triggers[triggerId] = number(pve.tasks.counters.triggers[triggerId]) + 1;
      }
      countCampaignDungeon(ctx, record, killed);
    }
    return true;
  }
  if (meta.kind === 'tower') {
    if (!won) return true;
    const infernal = Boolean(meta.infernal), nextField = infernal ? 'nextInfernal' : 'nextNormal', highestField = infernal ? 'highestInfernal' : 'highestNormal';
    if (pve.tower[nextField] !== number(meta.layer)) return true;
    credit(ctx.actor, 'silver', number(meta.silver), 'tower-clear', ctx.now);
    grantXp(ctx, meta.xp);
    pve.tower[highestField] = Math.max(pve.tower[highestField], number(meta.layer));
    pve.tower[nextField] = number(meta.layer) + 1;
    pve.tasks.counters.towerWins++;
    record.pveReward = { silver: number(meta.silver), xp: number(meta.xp), milestone: milestoneReward(ctx, number(meta.layer), infernal) };
    return true;
  }
  if (meta.kind === 'pet-island') {
    if (!won) return true;
    const island = petIslandRows(ctx).find(row => number(row.Id) === number(meta.nodeId));
    if (!island) return true;
    const state = pve.operations.petIsland, day = String(meta.day ?? dayKey(ctx.now));
    const used = number(state.collected[day]) + state.pending.filter(node => node.day === day && !node.collected).length;
    if (used >= number(meta.max, island.Max)) return true;
    state.sequence += 1;
    const collection = { id: `${day}:${number(meta.nodeId)}:${state.sequence}`, day, nodeId: number(meta.nodeId),
      readyAt: ctx.now + number(meta.refreshSeconds, island.Time) * 1000, max: number(meta.max, island.Max), collected: false };
    state.pending.push(collection);
    credit(ctx.actor, 'silver', number(meta.silver), 'pet-island-battle', ctx.now);
    grantXp(ctx, meta.xp);
    record.pveReward = { silver: number(meta.silver), xp: number(meta.xp), collection: { ...collection } };
    return true;
  }
  if (meta.kind === 'world-boss') {
    const season = ctx.world.pve.worldBoss[meta.seasonKey];
    if (!season || season.closed || season.defeated) return true;
    const damage = damageFrom(record, ctx.actor.id, season.hp);
    season.hp = Math.max(0, season.hp - damage);
    if (damage > 0) {
      season.contributions[ctx.actor.id] = number(season.contributions[ctx.actor.id]) + damage;
      pve.worldBoss.contributions[meta.seasonKey] = number(pve.worldBoss.contributions[meta.seasonKey]) + damage;
      pve.tasks.counters.worldBossDamage += damage;
    }
    season.defeated = season.hp === 0;
    if (season.defeated) season.killer = ctx.actor.id;
    record.pveReward = { damage, contribution: season.contributions[ctx.actor.id], defeated: season.defeated };
    return true;
  }
  if (meta.kind === 'forbidden') {
    const season = ctx.world.pve.forbidden[meta.seasonKey];
    if (!season) return true;
    const configuredScores = forbiddenConfig(ctx).display.map(row => number(row.brave)).filter(value => value > 0);
    const score = won ? Math.max(0, ...configuredScores) : 0;
    pve.forbidden.score += score;
    season.rankings[ctx.actor.id] = number(season.rankings[ctx.actor.id]) + score;
    if (won) pve.tasks.counters.forbiddenWins++;
    record.pveReward = { score, totalScore: pve.forbidden.score };
    return true;
  }
  return false;
}

function finalizeWorldBoss(world, config, season) {
  if (season.rewardsFinalized) return false;
  const ranking = Object.entries(season.contributions ?? {}).filter(([, value]) => number(value) > 0)
    .sort((a, b) => number(b[1]) - number(a[1]) || String(a[0]).localeCompare(String(b[0])));
  season.rankings = ranking.map(([actorId, contribution], index) => ({ actorId, contribution: number(contribution), rank: index + 1 }));
  season.rewardEligibility = {};
  const prize = rankType => config.prizes.find(candidate => candidate.rankType === rankType);
  for (const [index, [actorId]] of ranking.entries()) {
    const candidates = [season.defeated ? prize(4) : prize(6)];
    if (index === 0) candidates.push(prize(1));
    if (season.killer === actorId) candidates.push(prize(5));
    season.rewardEligibility[actorId] = candidates.filter(Boolean).filter((item, itemIndex, all) =>
      all.findIndex(other => other.rankType === item.rankType) === itemIndex);
  }
  season.claimed ??= [];
  season.rewardsFinalized = true;
  return true;
}

function finalizeForbidden(config, season) {
  if (season.rewardsFinalized) return false;
  const ranking = Object.entries(season.rankings ?? {}).filter(([, value]) => number(value) > 0)
    .sort((a, b) => number(b[1]) - number(a[1]) || String(a[0]).localeCompare(String(b[0])));
  season.ranking = ranking.map(([actorId, score], index) => ({ actorId, score: number(score), rank: index + 1 }));
  season.rewardEligibility = {};
  for (const [index, [actorId]] of ranking.entries()) {
    const tier = config.prizeTiers[Math.min(index, config.prizeTiers.length - 1)];
    if (tier) season.rewardEligibility[actorId] = { rank: index + 1, role: 'brave', prizeTableId: tier.bravePrize,
      draws: tier.braveDraws, sourceStonesLeftTier: tier.stonesLeft };
  }
  season.claimed ??= [];
  season.rewardsFinalized = true;
  return true;
}

export function tickPve(world, tables, now) {
  let changed = false;
  world.pve ??= { version: 1, worldBoss: {}, forbidden: {} };
  world.pve.worldBoss ??= {}; world.pve.forbidden ??= {};
  const ctx = { world, actor: Object.values(world.characters ?? {})[0] ?? { pve: {}, currencies: {}, inventory: {}, cards: {}, progress: {}, stats: {} }, tables, now,
    randomInt: max => Math.floor(Math.random() * max), content: {} };
  const bossConfig = worldBossConfig(ctx), time = localSeconds(now), today = dayKey(now);
  for (const event of bossConfig.schedule.filter(item => item.closes && item.at <= time)) {
    const key = `${today}:${event.performance}`, season = world.pve.worldBoss[key];
    if (season && !season.closed) { season.closed = true; season.status = 0; changed = true; }
    if (season) changed = finalizeWorldBoss(world, bossConfig, season) || changed;
  }
  const forbidden = world.pve.forbidden[today];
  const forbiddenCfg = forbiddenConfig(ctx), forbiddenClosed = forbiddenCfg.schedule.some(event => event.status === 0 && event.at <= time);
  if (forbidden && forbiddenClosed && !forbidden.closed) { forbidden.closed = true; forbidden.status = 0; changed = true; }
  if (forbidden?.closed) changed = finalizeForbidden(forbiddenCfg, forbidden) || changed;
  for (const [key, season] of Object.entries(world.pve.worldBoss)) if (season.day < today) {
    if (!season.closed) { season.closed = true; season.status = 0; changed = true; }
    changed = finalizeWorldBoss(world, bossConfig, season) || changed;
  }
  for (const [key, season] of Object.entries(world.pve.forbidden)) if (key < today) {
    if (!season.closed) { season.closed = true; season.status = 0; changed = true; }
    changed = finalizeForbidden(forbiddenCfg, season) || changed;
  }
  return changed;
}
