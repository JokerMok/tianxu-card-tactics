import { randomUUID } from 'node:crypto';

const DRAFT_SIZE = 30;
const DECK_SIZE = 10;
const ENTRY_SILVER = 120;
const WIN_LIMIT = 3;
const LOSS_LIMIT = 3;

export const competitionActions = Object.freeze([
  'tournament.register',
  'tournament.deck.save',
  'tournament.claim',
  'collection.claim',
]);

const fail = message => { throw new Error(message); };
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const table = (tables, name) => tables?.[`embeddata/scp/${name.toLowerCase()}.xml`] ?? [];
const cardKey = id => `main:card:${number(id)}`;

function ensure(ctx) {
  if (!ctx?.world || !ctx.actor || !ctx.tables || !Number.isFinite(ctx.now) || typeof ctx.randomInt !== 'function') fail('competition context invalid');
  ctx.actor.cards ??= {};
  ctx.actor.inventory ??= {};
  ctx.actor.currencies ??= { silver: 0, gold: 0, crystal: 0 };
  ctx.actor.economicLog ??= [];
  ctx.actor.competition ??= { version: 1, collectionClaims: [], history: [], tournament: null };
  ctx.actor.competition.collectionClaims ??= [];
  ctx.actor.competition.history ??= [];
  ctx.actor.competition.tournament ??= null;
  return ctx.actor.competition;
}

function sourceCardRows(ctx) {
  return table(ctx.tables, 'card').filter(row => Number.isSafeInteger(Number(row.ID)) && Number(row.ID) > 0);
}

function sourceCardMap(ctx) {
  return new Map(sourceCardRows(ctx).map(row => [number(row.ID), row]));
}

function usableCard(ctx, row) {
  const id = number(row.ID), type = number(row.Type);
  if (id <= 0 || /废弃/.test(String(row.Name ?? '')) || ![1, 2].includes(type)) return false;
  try {
    const card = ctx.content?.card ? ctx.content.card(id) : { raw: row };
    if (type === 1) return number(card.raw.MonsterID) > 0 && (!ctx.content?.monsterForCard || Boolean(ctx.content.monsterForCard(card.id)));
    if (number(card.raw.SkillID) <= 0) return false;
    const skill = ctx.content?.skill ? ctx.content.skill(number(card.raw.SkillID)) : null;
    const profession = number(skill?.raw?.['使用职业']);
    return !profession || profession === number(ctx.actor.profession);
  } catch {
    return false;
  }
}

function draftCatalog(ctx) {
  return sourceCardRows(ctx).filter(row => usableCard(ctx, row)).map(row => ({
    id: cardKey(row.ID),
    name: String(row.Name ?? row.ID),
    type: number(row.Type),
    quality: number(row.Quality),
    race: number(row.Race),
  }));
}

function drawDraft(ctx) {
  const candidates = draftCatalog(ctx);
  if (candidates.length < DRAFT_SIZE) fail('可用竞技赛卡池不足');
  const pool = [];
  for (let index = 0; index < DRAFT_SIZE; index += 1) {
    const selected = ctx.randomInt(candidates.length);
    if (!Number.isSafeInteger(selected) || selected < 0 || selected >= candidates.length) fail('竞技赛随机数无效');
    pool.push(candidates.splice(selected, 1)[0]);
  }
  return pool;
}

function assertDraftDeck(tournament, cards) {
  if (!Array.isArray(cards) || cards.length !== DECK_SIZE || cards.some(id => typeof id !== 'string')) fail(`竞技赛卡组必须为${DECK_SIZE}张`);
  const available = new Map();
  for (const card of tournament.pool) available.set(card.id, (available.get(card.id) ?? 0) + 1);
  for (const id of cards) {
    const count = available.get(id) ?? 0;
    if (count < 1) fail('竞技赛卡组包含未开出的卡牌');
    available.set(id, count - 1);
  }
  return [...cards];
}

function athleticsRows(ctx) {
  return table(ctx.tables, 'athleticsprize').filter(row => Number.isSafeInteger(Number(row.WinTime))
    && number(row.WinTime) >= 0 && Number.isSafeInteger(Number(row.BaoID)) && number(row.BaoID) > 0
    && number(row.BaoNum) > 0);
}

function tournamentReward(ctx, wins) {
  const row = athleticsRows(ctx).find(candidate => number(candidate.WinTime) === wins);
  if (!row) fail('竞技赛奖励配置缺失');
  const rawQuantity = number(row.BaoNum);
  const quantity = Number.isSafeInteger(rawQuantity) && rawQuantity > 0 ? rawQuantity : 1;
  return {
    itemId: number(row.BaoID),
    quantity,
    onlinePrizeTableGroup: number(row.OnlinePrizeTableGroup),
    flips: number(row.FanPaiNum),
    tier: number(row.prize, 1),
    sourceWinTime: number(row.WinTime),
  };
}

function showTime(row) {
  const entry = Object.entries(row).find(([key]) => key.startsWith('展示时间'))?.[1];
  if (!entry) return 0;
  const timestamp = Date.parse(String(entry).trim().replace(' ', 'T') + '+08:00');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function collectionGroups(ctx) {
  const validCards = sourceCardMap(ctx);
  const groupRows = table(ctx.tables, 'cardmanualindex').filter(row => Number.isSafeInteger(Number(row.ID)) && number(row['奖励ID']) > 0);
  const memberships = table(ctx.tables, 'cardmanualitem').filter(row => {
    const id = number(row['卡牌ID']), owner = number(row['所属ID']);
    return id > 0 && owner > 0 && validCards.has(id) && showTime(row) <= ctx.now;
  });
  return groupRows.map(row => {
    const id = number(row.ID), threshold = Math.max(1, Math.min(100, number(row['百分比'], 100)));
    const cards = memberships.filter(item => Math.floor(number(item['所属ID']) / 100) * 100 === id)
      .map(item => number(item['卡牌ID'])).filter((cardId, index, all) => all.indexOf(cardId) === index)
      .map(cardId => ({ id: cardKey(cardId), name: String(validCards.get(cardId)?.Name ?? cardId),
        quality: number(validCards.get(cardId)?.Quality), owned: number(ctx.actor.cards[cardKey(cardId)]) > 0 }));
    const rewardCards = [1, 2, 3, 4].map(index => number(row[`卡牌ID${index}`])).filter(cardId => cardId > 0 && validCards.has(cardId))
      .filter((cardId, index, all) => all.indexOf(cardId) === index).map(cardKey);
    const owned = cards.filter(card => card.owned).length;
    const percent = cards.length ? Math.floor(owned * 100 / cards.length) : 0;
    const claimed = ctx.actor.competition.collectionClaims.includes(id);
    const compatibilityReward = rewardCards.length ? null : { silver: Math.max(50, number(row['奖励ID']) * 25) };
    return { id, title: String(row['标题'] ?? id), rewardId: number(row['奖励ID']), threshold,
      owned, total: cards.length, percent, ready: cards.length > 0 && percent >= threshold, claimed,
      reward: rewardCards.length ? { cards: rewardCards } : compatibilityReward, cards };
  });
}

function register(ctx) {
  const state = ensure(ctx), previous = state.tournament;
  if (previous && previous.status !== 'claimed') fail('请先完成并领取当前竞技赛奖励');
  if (number(ctx.actor.currencies.silver) < ENTRY_SILVER) fail('银币不足');
  const pool = drawDraft(ctx);
  ctx.actor.currencies.silver -= ENTRY_SILVER;
  ctx.actor.economicLog.push({ kind: 'debit', asset: 'silver', amount: ENTRY_SILVER, reason: 'tournament-entry', at: ctx.now });
  state.tournament = {
    id: randomUUID(), status: 'active', registeredAt: ctx.now,
    entry: { currency: 'silver', amount: ENTRY_SILVER },
    pool, packs: [pool.slice(0, 10).map(card => card.id), pool.slice(10, 20).map(card => card.id), pool.slice(20, 30).map(card => card.id)],
    deck: pool.slice(0, DECK_SIZE).map(card => card.id),
    wins: 0, losses: 0, matches: 0, reward: null,
  };
  return { message: '竞技赛报名成功，已开启三包选牌', tournamentId: state.tournament.id,
    entry: state.tournament.entry, packs: state.tournament.packs, deck: [...state.tournament.deck] };
}

function saveDeck(ctx, payload) {
  const tournament = ensure(ctx).tournament;
  if (!tournament || tournament.status !== 'active') fail('当前没有可构筑的竞技赛');
  if (tournament.matches > 0) fail('首场比赛开始后不能修改竞技赛卡组');
  tournament.deck = assertDraftDeck(tournament, payload.cards);
  return { message: '竞技赛卡组已保存', deck: [...tournament.deck] };
}

function claimTournament(ctx) {
  const state = ensure(ctx), tournament = state.tournament;
  if (!tournament || tournament.status !== 'claimable' || !tournament.reward) fail('竞技赛奖励尚不可领取');
  const key = `main:item:${tournament.reward.itemId}`;
  tournament.reward.quantity = Math.max(1, number(tournament.reward.quantity, 1));
  ctx.actor.inventory[key] = number(ctx.actor.inventory[key]) + tournament.reward.quantity;
  ctx.actor.economicLog.push({ kind: 'grant', asset: key, amount: tournament.reward.quantity, reason: 'tournament-prize', at: ctx.now });
  tournament.status = 'claimed';
  tournament.claimedAt = ctx.now;
  state.history.push({ id: tournament.id, wins: tournament.wins, losses: tournament.losses,
    reward: { ...tournament.reward }, registeredAt: tournament.registeredAt, claimedAt: ctx.now });
  return { message: '竞技赛奖励已领取', reward: { ...tournament.reward } };
}

function claimCollection(ctx, payload) {
  const state = ensure(ctx), groupId = number(payload.groupId);
  if (!Number.isSafeInteger(groupId) || groupId < 1) fail('图鉴分组无效');
  const group = collectionGroups(ctx).find(candidate => candidate.id === groupId);
  if (!group || !group.ready || group.claimed) fail('图鉴奖励未达成或已领取');
  if (group.reward.cards) {
    for (const id of group.reward.cards) ctx.actor.cards[id] = number(ctx.actor.cards[id]) + 1;
  } else {
    ctx.actor.currencies.silver = number(ctx.actor.currencies.silver) + group.reward.silver;
  }
  state.collectionClaims.push(group.id);
  ctx.actor.economicLog.push({ kind: 'grant', asset: group.reward.cards ? 'cards' : 'silver',
    amount: group.reward.cards?.length ?? group.reward.silver, reason: `collection:${group.id}`, at: ctx.now });
  return { message: '图鉴奖励已领取', groupId: group.id, reward: group.reward };
}

const handlers = {
  'tournament.register': register,
  'tournament.deck.save': saveDeck,
  'tournament.claim': claimTournament,
  'collection.claim': claimCollection,
};

export function operateCompetition(ctx, action, payload = {}) {
  ensure(ctx);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('payload无效');
  const handler = handlers[action];
  if (!handler || !competitionActions.includes(action)) fail('未知竞技操作');
  return handler(ctx, payload);
}

function uiItem(label, detail, action, payload = {}, disabled = false, fields = undefined) {
  return { label, detail, action, payload, disabled, ...(fields ? { fields } : {}) };
}

export function competitionView(ctx) {
  const state = ensure(ctx), tournament = state.tournament, groups = collectionGroups(ctx);
  const draftField = tournament?.status === 'active' ? [{
    key: 'cards', label: `选择${DECK_SIZE}张竞技赛卡牌`, type: 'card-multiselect', min: DECK_SIZE, max: DECK_SIZE,
    value: [...tournament.deck], options: tournament.pool.map(card => ({ label: `${card.name} · 品质${card.quality}`, value: card.id,
      cardId: card.id, name: card.name, type: card.type, quality: card.quality, race: card.race })),
  }] : undefined;
  const tournamentItems = [uiItem('报名普通竞技赛', `消耗 ${ENTRY_SILVER} 银币，三胜或三负结束`, 'tournament.register', {}, Boolean(tournament && tournament.status !== 'claimed'))];
  if (tournament?.status === 'active') tournamentItems.push(uiItem('保存竞技赛卡组', `${tournament.deck.length}/${DECK_SIZE}，首场比赛后锁定`,
    'tournament.deck.save', { cards: [...tournament.deck] }, tournament.matches > 0, draftField));
  if (tournament?.status === 'claimable') tournamentItems.push(uiItem('领取竞技赛奖励', `${tournament.wins}胜${tournament.losses}负`, 'tournament.claim'));
  const collectionItems = groups.map(group => uiItem(`领取图鉴：${group.title}`, `${group.owned}/${group.total}（${group.percent}% / ${group.threshold}%）`,
    'collection.claim', { groupId: group.id }, !group.ready || group.claimed));
  return {
    version: 1,
    sections: [
      { id: 'tournament', title: '竞技赛', items: tournamentItems },
      { id: 'collection', title: '图鉴奖励', items: collectionItems },
    ],
    tournament: tournament ? { ...tournament, pool: tournament.pool.map(card => ({ ...card })), deck: [...tournament.deck],
      draftStats: tournament.pool.reduce((stats, card) => {
        stats.total += 1; stats.byQuality[card.quality] = (stats.byQuality[card.quality] ?? 0) + 1;
        stats.byType[card.type] = (stats.byType[card.type] ?? 0) + 1; return stats;
      }, { total: 0, byQuality: {}, byType: {} }) } : null,
    collection: { sourceComplete: true, groups, totalGroups: groups.length,
      totalCards: groups.reduce((sum, group) => sum + group.cards.length, 0) },
  };
}

export function tournamentDeck(ctx) {
  const tournament = ensure(ctx).tournament;
  if (!tournament || tournament.status !== 'active') fail('当前没有可参赛的竞技赛');
  return assertDraftDeck(tournament, tournament.deck);
}

export function onCompetitionSettled(ctx, record, won) {
  if (record?.mode !== 'tournament') return;
  const tournament = ensure(ctx).tournament;
  if (!tournament || tournament.status !== 'active') fail('竞技赛报名状态无效');
  if (record.tournamentId && record.tournamentId !== tournament.id) fail('竞技赛场次不属于当前报名');
  const participants = Array.isArray(record.participants) ? record.participants : [];
  const players = Array.isArray(record.state?.players) ? record.state.players : [];
  const opponentId = participants.find(id => id !== ctx.actor.id);
  const opponent = players.find(player => player.id === opponentId);
  if (ctx.world.characters[opponentId]?.accountId && ctx.world.characters[opponentId].accountId === ctx.actor.accountId) fail('竞技赛需要两个独立账号');
  if (participants.length !== 2 || !opponent || opponent.ai) fail('竞技赛必须由两名真实玩家完成');
  record.competitionSettledActors ??= [];
  if (record.competitionSettledActors.includes(ctx.actor.id)) return;
  record.competitionSettledActors.push(ctx.actor.id);
  tournament.matches += 1;
  if (won) tournament.wins += 1;
  else tournament.losses += 1;
  if (tournament.wins >= WIN_LIMIT || tournament.losses >= LOSS_LIMIT) {
    tournament.status = 'claimable';
    tournament.completedAt = ctx.now;
    tournament.reward = tournamentReward(ctx, tournament.wins);
  }
}
