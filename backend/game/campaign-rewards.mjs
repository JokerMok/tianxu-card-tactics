import {stageRewardAllowed,stageCardAllowed,stageItemAllowed} from './stage-policy.mjs';
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const table = (tables, name) => tables?.[`embeddata/scp/${name.toLowerCase()}.xml`] ?? [];
const localId = value => {
  const match = String(value ?? '').match(/(?:^|:)(\d+)$/);
  return match ? Number(match[1]) : number(value, 0);
};

const definitionCache = new WeakMap();
function definitions(tables) {
  let value = definitionCache.get(tables);
  if (value) return value;
  const itemIds = new Set();
  for (const name of ['medicament', 'warrant', 'equipment']) {
    for (const row of table(tables, name)) {
      const id = number(row['物品ID\n'] ?? row['物品ID'] ?? row.ID);
      if (id > 0) itemIds.add(id);
    }
  }
  const monsterIds = new Set(table(tables, 'monster').map(row => number(row.ID)).filter(id => id > 0));
  const cards = new Map(table(tables, 'card').filter(card => number(card.ID) > 0 && !/废弃/.test(String(card.Name ?? ''))
    && number(card.Type) === 1 && number(card.MonsterID) > 0 && monsterIds.has(number(card.MonsterID)))
    .map(card => [number(card.ID), card]));
  value = { itemIds, cards };
  definitionCache.set(tables, value);
  return value;
}

function itemDefinition(tables, id) {
  return definitions(tables).itemIds.has(id);
}

function cardDefinition(tables, id) {
  return definitions(tables).cards.get(id);
}

function ensureActor(actor) {
  actor.currencies ??= { silver: 0, gold: 0, crystal: 0 };
  actor.inventory ??= {};
  actor.cards ??= {};
  actor.economicLog ??= [];
  actor.growth ??= {};
  actor.growth.reputation ??= {};
  actor.growth.towerCoins ??= 0;
  actor.growth.activityPoints ??= 0;
}

function addLog(ctx, asset, amount, reason) {
  ctx.actor.economicLog.push({ at: ctx.now, kind: 'grant', asset, amount, reason });
}

function addReward(ctx, reward, result, reason) {
  const { type, id, count } = reward;
  const kind=type===1?'silver':type===2?'gold':type===3?'card':type===4?'item':'paused';
  if(!ctx.legacyRewards&&!stageRewardAllowed(ctx.tables,kind,id)){(result.withheld??=[]).push({...reward,reason:'stage-paused'});return false;}
  if (!Number.isSafeInteger(count) || count < 1) return false;
  if (type === 1 || type === 2) {
    const asset = type === 1 ? 'silver' : 'gold';
    ctx.actor.currencies[asset] = number(ctx.actor.currencies[asset]) + count;
    result.currencies[asset] = number(result.currencies[asset]) + count;
    addLog(ctx, asset, count, reason);
    return true;
  }
  if (type === 3 && cardDefinition(ctx.tables, id)) {
    const key = `main:card:${id}`;
    ctx.actor.cards[key] = number(ctx.actor.cards[key]) + count;
    result.cards.push({ cardId: key, count });
    addLog(ctx, key, count, reason);
    return true;
  }
  if (type === 4 && itemDefinition(ctx.tables, id)) {
    const key = `main:item:${id}`;
    ctx.actor.inventory[key] = number(ctx.actor.inventory[key]) + count;
    result.items.push({ itemId: key, count });
    addLog(ctx, key, count, reason);
    return true;
  }
  const growth = type === 5 ? 'towerCoins' : type === 6 ? 'activityPoints' : undefined;
  if (growth) {
    ctx.actor.growth[growth] = number(ctx.actor.growth[growth]) + count;
    result.growth[growth] = number(result.growth[growth]) + count;
    addLog(ctx, growth, count, reason);
    return true;
  }
  return false;
}

function addExperience(ctx, amount, result, reason) {
  amount = number(amount);
  if (!Number.isSafeInteger(amount) || amount < 1) return;
  if (ctx.content?.grantExperience) ctx.content.grantExperience(ctx.actor, amount);
  else ctx.actor.xp = number(ctx.actor.xp) + amount;
  result.xp += amount;
  addLog(ctx, 'xp', amount, reason);
}

function addReputation(ctx, raw, result, reason) {
  const type = number(raw?.reputationtype), value = number(raw?.reputationvalue);
  const min = Math.max(0, number(raw?.reputationminlevel));
  const configuredMax = number(raw?.reputationmaxlevel);
  const max = configuredMax > 0 ? configuredMax : Number.POSITIVE_INFINITY;
  const actorLevel = number(ctx.actor.level, 1);
  if (!Number.isSafeInteger(type) || type < 1 || !Number.isSafeInteger(value) || value < 1 || actorLevel < min || actorLevel > max) return;
  ctx.actor.growth.reputation[type] = number(ctx.actor.growth.reputation[type]) + value;
  result.reputation.push({ type, value });
  addLog(ctx, `reputation:${type}`, value, reason);
}

function chineseNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  const digit = { '零': 0, '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9 };
  let tens = 0, units = 0;
  for (const char of value) {
    if (char === '十') { tens = (units || 1) * 10; units = 0; }
    else if (digit[char] !== undefined) units = digit[char];
    else return NaN;
  }
  return tens + units;
}

function previewPool(ctx, previewId) {
  const rows = table(ctx.tables, 'scene/fubenprizepreview');
  if (!Number.isSafeInteger(previewId) || previewId < 1 || !rows.length) return [];
  const typeKey = Object.keys(rows[0]).find(key => key.includes('号类型') && chineseNumber(key.split('号')[0]) === previewId);
  if (!typeKey) return [];
  const prefix = typeKey.split('号')[0] + '号';
  return rows.map(row => {
    const entries = Object.entries(row).filter(([key]) => key.startsWith(prefix));
    const find = text => entries.find(([key]) => key.includes(text))?.[1];
    return { type: number(find('类型')), id: number(find('ID')), count: number(find('数量')) };
  }).filter(reward => reward.count > 0 && ((reward.type === 1 || reward.type === 2)
    || (reward.type === 3 && cardDefinition(ctx.tables, reward.id))
    || (reward.type === 4 && itemDefinition(ctx.tables, reward.id))
    || reward.type === 5 || reward.type === 6));
}

function dungeonPreview(ctx, record, node) {
  if (!node || (Array.isArray(node.outgoing) && node.outgoing.length > 0)) return undefined;
  const sceneId = localId(record.level?.sceneId);
  const row = table(ctx.tables, 'scene/fubens').find(candidate => ['简单', '普通', '困难'].some(key => number(candidate[key]) === sceneId));
  if (!row) return undefined;
  const difficulty = ['简单', '普通', '困难'].find(key => number(row[key]) === sceneId);
  const previewId = number(row[`${difficulty}副本奖励预览ID(FubenPrizePreview.xml)`]);
  return previewId > 0 ? { previewId, pool: previewPool(ctx, previewId) } : undefined;
}

function reconstructedPool(ctx, groupId) {
  const tickets = new Set(table(ctx.tables, 'scene/fubens').map(row => number(row['进入消耗道具ID'])).filter(id => id > 0 && itemDefinition(ctx.tables, id)));
  const items = [...tickets].filter(id=>ctx.legacyRewards||stageItemAllowed(ctx.tables,id)).sort((a, b) => a - b).map(id => ({ type: 4, id, count: 1 }));
  for (const name of ['medicament', 'warrant']) {
    for (const row of table(ctx.tables, name)) {
      const id = number(row['物品ID'] ?? row.ID);
      if ((ctx.legacyRewards||stageItemAllowed(ctx.tables,id)) && id > 0 && itemDefinition(ctx.tables, id) && !items.some(value => value.id === id)) items.push({ type: 4, id, count: 1 });
    }
  }
  const qualityCap = Math.max(0, Math.min(6, Math.floor(number(groupId) / 50)));
  const cards = table(ctx.tables, 'card').filter(row => (ctx.legacyRewards||stageCardAllowed(ctx.tables,row.ID)) && number(row.Quality) <= qualityCap && cardDefinition(ctx.tables, number(row.ID)))
    .map(row => ({ type: 3, id: number(row.ID), count: 1 }));
  return [...items, ...cards];
}

function choose(ctx, pool) {
  if (!pool.length) return undefined;
  const index = ctx.randomInt(pool.length);
  return Number.isSafeInteger(index) && index >= 0 && index < pool.length ? pool[index] : undefined;
}

function grantRandomGroup(ctx, raw, result, reason) {
  const groupId = number(raw?.randomgroupprize);
  if (!Number.isSafeInteger(groupId) || groupId < 1) return;
  const reward = choose(ctx, reconstructedPool(ctx, groupId));
  if (reward && addReward(ctx, reward, result, reason)) result.randomGroups.push({ groupId, reconstructed: true, reward });
}

export function grantCampaignExtras(ctx, record, { trigger, node, scene, eligible } = {}) {
  const result = { items: [], cards: [], currencies: {}, reputation: [], growth: {}, xp: 0, randomGroups: [], preview: null };
  if (!ctx?.actor || !ctx.tables || typeof ctx.randomInt !== 'function' || !record?.level || record.state?.winner !== 0) return result;
  if (Array.isArray(record.participants) && !record.participants.includes(ctx.actor.id)) return result;
  record.campaignExtraActors ??= [];
  if (record.campaignExtraActors.includes(ctx.actor.id)) return result;
  // A battle that was settled while this actor was ineligible must never become a deferred claim.
  record.campaignExtraActors.push(ctx.actor.id);
  if (eligible !== true) return result;

  ensureActor(ctx.actor);
  const base = trigger?.raw ?? trigger ?? {};
  addReputation(ctx, base, result, 'campaign-reputation');
  grantRandomGroup(ctx, base, result, 'campaign-random-group');

  if (record.level.elite === true) {
    const elite = trigger?.children?.find(row => row?._tag === 'elite') ?? trigger?.elite?.raw ?? trigger?.elite;
    if (elite) {
      addReward(ctx, { type: 1, id: 0, count: number(elite.silverprize) }, result, 'campaign-elite');
      addReward(ctx, { type: 3, id: number(elite.cardidprize), count: number(elite.cardnumprize) }, result, 'campaign-elite');
      addExperience(ctx, elite.expprize, result, 'campaign-elite');
      addReputation(ctx, elite, result, 'campaign-elite-reputation');
      grantRandomGroup(ctx, elite, result, 'campaign-elite-random-group');
    }
  }

  const preview = dungeonPreview(ctx, record, node, scene);
  if (preview) {
    const reward = choose(ctx, preview.pool);
    if (reward && addReward(ctx, reward, result, 'campaign-dungeon-preview')) result.preview = { previewId: preview.previewId, reward };
  }
  return result;
}
