const DAY = 86_400_000;
const WEEK = 7 * DAY;
const BEIJING_OFFSET = 8 * 3_600_000;
const RATING_CENTER = 1000;
const RATING_RETAIN = 0.5;

export const leagueActions = Object.freeze([
  'league.reward.claim',
  'clanwar.register',
  'clanwar.reward.claim',
]);

const fail = message => { throw new Error(message); };
const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const table = (tables, name) => tables?.[`embeddata/scp/${name.toLowerCase()}.xml`] ?? [];

function beijingWeek(now) {
  if (!Number.isFinite(now)) fail('联赛时间无效');
  const local = new Date(now + BEIJING_OFFSET);
  const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const daysAfterMonday = (local.getUTCDay() + 6) % 7;
  const startAt = localMidnight - daysAfterMonday * DAY - BEIJING_OFFSET;
  return { key: new Date(startAt + BEIJING_OFFSET).toISOString().slice(0, 10), startAt, endAt: startAt + WEEK };
}

function newSeason(now) {
  const week = beijingWeek(now);
  return {
    ...week,
    ranked: { participants: {} },
    clan: { registrations: {}, standings: {} },
  };
}

function ensureWorld(world, now) {
  if (!world || typeof world !== 'object' || !world.characters || !world.guilds) fail('联赛世界状态无效');
  world.league ??= { version: 1, current: newSeason(now), history: [], controllers: {} };
  world.league.history ??= [];
  world.league.controllers ??= {};
  world.league.current ??= newSeason(now);
  world.league.current.ranked ??= { participants: {} };
  world.league.current.ranked.participants ??= {};
  world.league.current.clan ??= { registrations: {}, standings: {} };
  world.league.current.clan.registrations ??= {};
  world.league.current.clan.standings ??= {};
  return world.league;
}

function ensureActor(actor) {
  if (!actor || typeof actor !== 'object') fail('联赛角色无效');
  actor.currencies ??= { silver: 0, gold: 0, crystal: 0 };
  actor.inventory ??= {};
  actor.cards ??= {};
  actor.economicLog ??= [];
  actor.league ??= { version: 1, pendingRewards: [], claims: [], rankedHistory: [], clanHistory: [] };
  actor.league.pendingRewards ??= [];
  actor.league.claims ??= [];
  actor.league.rankedHistory ??= [];
  actor.league.clanHistory ??= [];
  return actor.league;
}

function ensureContext(ctx) {
  if (!ctx?.world || !ctx.actor || !ctx.tables || !Number.isFinite(ctx.now)) fail('联赛上下文无效');
  ensureWorld(ctx.world, ctx.now);
  ensureActor(ctx.actor);
}

function clanTerritories(tables) {
  return table(tables, 'clanhuodong')
    .filter(row => row?._tag === 'activity' && Number.isSafeInteger(Number(row.id))
      && /battle/i.test(String(row.title ?? '')) && /guild/i.test(String(row.title ?? '')))
    .map(row => ({
      id: `main:clan-activity:${Number(row.id)}`,
      sourceId: Number(row.id),
      name: String(row.title),
      sourcePath: row._path,
    }));
}

function territory(tables, id) {
  const found = clanTerritories(tables).find(candidate => candidate.id === id);
  if (!found) fail('城战领地无效或缺少原版配置');
  return found;
}

function guildFor(world, actor, leader = false) {
  const guild = world.guilds[actor?.guildId];
  if (!guild || !Array.isArray(guild.members) || !guild.members.includes(actor.id)) fail('请先加入有效公会');
  if (leader && guild.leader !== actor.id) fail('城战报名需要会长权限');
  guild.contributions ??= {};
  guild.treasury = number(guild.treasury);
  return guild;
}

function participantIsReal(record, id) {
  const player = Array.isArray(record?.state?.players) ? record.state.players.find(candidate => candidate.id === id) : null;
  return Boolean(player && player.ai !== true);
}

function assertRealPair(world, record) {
  const ids = Array.isArray(record?.participants) ? [...new Set(record.participants)] : [];
  if (ids.length !== 2 || ids.some(id => !world.characters[id] || !participantIsReal(record, id))) {
    fail('联赛必须由两名真实玩家完成');
  }
  const actors = ids.map(id => world.characters[id]);
  if (actors[0].accountId && actors[0].accountId === actors[1].accountId) fail('联赛双方必须来自不同账号');
  return actors;
}

function rankingRanges(tables) {
  const rows = table(tables, 'rankingreward');
  const prefix = '/root[1]/server[1]/pvp[1]/';
  return rows.filter(row => row._tag === 'rankrange' && String(row._path).startsWith(prefix)).map(row => {
    const rewardPrefix = `${row._path}/reward[`;
    const rewards = rows.filter(candidate => candidate._tag === 'reward' && String(candidate._path).startsWith(rewardPrefix))
      .map(candidate => ({ type: number(candidate.type), value: number(candidate.value), count: Math.max(1, number(candidate.num, 1)) }));
    return { min: number(row.min), max: number(row.max), showType: number(row.showtype), rewards };
  }).filter(range => range.min > 0 && range.max >= range.min && range.rewards.length);
}

function rankedReward(tables, rank) {
  const range = rankingRanges(tables).find(candidate => rank >= candidate.min && rank <= candidate.max);
  if (!range) return null;
  const reward = { silver: 0, gold: 0, honor: 0, items: [], cards: [], source: { table: 'RankingReward.xml', range: `${range.min}-${range.max}` } };
  for (const entry of range.rewards) {
    if (entry.type === 1) reward.silver += entry.value;
    else if (entry.type === 2) reward.gold += entry.value;
    else if (entry.type === 3) reward.cards.push({ id: entry.value, count: entry.count });
    else if (entry.type === 4) reward.items.push({ id: entry.value, count: entry.count });
    else if (entry.type === 5) reward.honor += entry.value;
  }
  return reward;
}

function rankLabelContains(label, rank) {
  if (label === 'champion') return rank === 1;
  const match = String(label).match(/^(\d+)-(\d+)$/);
  return Boolean(match && rank >= Number(match[1]) && rank <= Number(match[2]));
}

function clanPrizeRow(tables, rank) {
  return table(tables, 'clanbattleprize').find(row => rankLabelContains(row['名次'], rank)) ?? null;
}

function teamReward(row) {
  if (!row) return null;
  const itemId = number(row['参赛队伍奖励(物品)']);
  return {
    silver: number(row['队伍银币']), crystal: number(row['队伍水晶']), guildContribution: number(row['队伍公会贡献']),
    items: itemId > 0 ? [{ id: itemId, count: Math.max(1, number(row['数量'], 1)) }] : [], cards: [],
    source: { table: 'clanbattleprize.xml', rank: String(row['名次']), kind: 'team' },
  };
}

function memberReward(row) {
  if (!row) return null;
  const itemId = number(row['公会成员物品奖励']);
  return {
    silver: number(row['公会成员银币']), crystal: number(row['公会成员水晶']), guildContribution: number(row['公会成员贡献']),
    items: itemId > 0 ? [{ id: itemId, count: Math.max(1, number(row['公会成员物品数量'], 1)) }] : [], cards: [],
    source: { table: 'clanbattleprize.xml', rank: String(row['名次']), kind: 'member', condition: number(row['公会成员领奖条件']) },
  };
}

function pending(actor, entry) {
  const state = ensureActor(actor);
  if (state.claims.includes(entry.id) || state.pendingRewards.some(candidate => candidate.id === entry.id)) return false;
  state.pendingRewards.push(entry);
  return true;
}

function finalizeRanked(world, season, tables, now) {
  const ranking = Object.keys(season.ranked.participants).map(id => {
    const actor = world.characters[id]; const stats = season.ranked.participants[id];
    return actor ? { id, name: actor.name, rating: number(actor.rating, RATING_CENTER), ...stats } : null;
  }).filter(Boolean).sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.id.localeCompare(b.id));
  ranking.forEach((entry, index) => {
    const actor = world.characters[entry.id]; const rank = index + 1; const reward = rankedReward(tables, rank);
    ensureActor(actor).rankedHistory.push({ seasonKey: season.key, rank, rating: entry.rating, wins: entry.wins, losses: entry.losses, matches: entry.matches, endedAt: season.endAt });
    if (reward) pending(actor, { id: `ranked:${season.key}:${entry.id}`, kind: 'ranked', seasonKey: season.key, rank, reward, createdAt: now });
    actor.rating = Math.max(0, RATING_CENTER + Math.round((entry.rating - RATING_CENTER) * RATING_RETAIN));
  });
  return ranking;
}

function clanStandings(season) {
  const out = {};
  for (const [territoryId, entries] of Object.entries(season.clan.standings)) {
    out[territoryId] = Object.values(entries).map(entry => ({ ...entry, participants: { ...entry.participants } }))
      .sort((a, b) => b.score - a.score || b.wins - a.wins || a.guildId.localeCompare(b.guildId));
  }
  return out;
}

function finalizeClan(world, league, season, tables, now) {
  const standings = clanStandings(season);
  for (const [territoryId, entries] of Object.entries(standings)) {
    if (entries.length) league.controllers[territoryId] = entries[0].guildId;
    entries.forEach((entry, index) => {
      const rank = index + 1; const row = clanPrizeRow(tables, rank); const guild = world.guilds[entry.guildId];
      if (!row || !guild) return;
      guild.treasury = number(guild.treasury) + number(row['公会财富']);
      for (const actorId of Object.keys(entry.participants)) {
        const actor = world.characters[actorId]; if (!actor) continue;
        const reward = teamReward(row);
        pending(actor, { id: `clan-team:${season.key}:${territoryId}:${actorId}`, kind: 'clan', seasonKey: season.key,
          territoryId, guildId: entry.guildId, rank, reward, createdAt: now });
        ensureActor(actor).clanHistory.push({ seasonKey: season.key, territoryId, guildId: entry.guildId, rank,
          score: entry.score, matches: entry.matches, endedAt: season.endAt });
      }
      const threshold = number(row['公会成员领奖条件']);
      for (const actorId of guild.members ?? []) {
        if (entry.participants[actorId] || number(guild.contributions?.[actorId]) < threshold) continue;
        const actor = world.characters[actorId]; if (!actor) continue;
        const reward = memberReward(row);
        pending(actor, { id: `clan-member:${season.key}:${territoryId}:${actorId}`, kind: 'clan', seasonKey: season.key,
          territoryId, guildId: entry.guildId, rank, reward, createdAt: now });
      }
    });
  }
  return standings;
}

function closeSeason(world, tables, now) {
  const league = ensureWorld(world, now); const season = league.current;
  const ranking = finalizeRanked(world, season, tables, now);
  const clan = finalizeClan(world, league, season, tables, now);
  const hasClan = Object.values(clan).some(entries => entries.length);
  const hadRegistrations = Object.values(season.clan.registrations).some(ids => ids.length);
  if (ranking.length || hasClan || hadRegistrations) league.history.push({
    key: season.key, startAt: season.startAt, endAt: season.endAt, ranked: ranking, clan,
    registrations: structuredClone(season.clan.registrations), closedAt: now,
  });
  league.current.closed=true; // Stage pause: settle the existing cycle, never create the next one.
}

function rotate(world, tables, now) {
  const league = ensureWorld(world, now);
  if (league.current.closed||now < league.current.endAt) return false;
  if(Object.values(world.battles??{}).some(b=>!b.settled&&['ranked','clan-war'].includes(b.mode)))return false;
  closeSeason(world, tables, now);
  return true;
}

function registerClan(ctx, payload) {
  rotate(ctx.world, ctx.tables, ctx.now);
  const id = String(payload.territoryId ?? ''); const target = territory(ctx.tables, id);
  const guild = guildFor(ctx.world, ctx.actor, true); const registrations = ctx.world.league.current.clan.registrations;
  registrations[id] ??= [];
  if (!registrations[id].includes(guild.id)) registrations[id].push(guild.id);
  return { message: '公会城战报名成功', territory: target, guildId: guild.id, seasonKey: ctx.world.league.current.key };
}

function applyReward(ctx, entry) {
  const reward = entry.reward ?? {};
  for (const currency of ['silver', 'gold', 'crystal', 'honor']) {
    const amount = number(reward[currency]);
    if (!amount) continue;
    ctx.actor.currencies[currency] = number(ctx.actor.currencies[currency]) + amount;
    ctx.actor.economicLog.push({ kind: 'grant', asset: currency, amount, reason: entry.id, at: ctx.now });
  }
  for (const item of reward.items ?? []) {
    const key = `main:item:${number(item.id)}`; const amount = Math.max(1, number(item.count, 1));
    ctx.actor.inventory[key] = number(ctx.actor.inventory[key]) + amount;
    ctx.actor.economicLog.push({ kind: 'grant', asset: key, amount, reason: entry.id, at: ctx.now });
  }
  for (const card of reward.cards ?? []) {
    const key = `main:card:${number(card.id)}`; const amount = Math.max(1, number(card.count, 1));
    ctx.actor.cards[key] = number(ctx.actor.cards[key]) + amount;
    ctx.actor.economicLog.push({ kind: 'grant', asset: key, amount, reason: entry.id, at: ctx.now });
  }
  const contribution = number(reward.guildContribution);
  if (contribution) {
    ctx.actor.league.guildContribution = number(ctx.actor.league.guildContribution) + contribution;
    const guild = ctx.world.guilds[entry.guildId];
    if (guild?.members?.includes(ctx.actor.id)) {
      guild.contributions ??= {};
      guild.contributions[ctx.actor.id] = number(guild.contributions[ctx.actor.id]) + contribution;
    }
  }
}

function claim(ctx, payload, kind) {
  rotate(ctx.world, ctx.tables, ctx.now);
  const state = ensureActor(ctx.actor); const requested = payload.rewardId === undefined ? null : String(payload.rewardId);
  const index = state.pendingRewards.findIndex(entry => entry.kind === kind && (!requested || entry.id === requested));
  if (index < 0) fail(kind === 'ranked' ? '没有可领取的天梯奖励' : '没有可领取的城战奖励');
  const [entry] = state.pendingRewards.splice(index, 1);
  if (state.claims.includes(entry.id)) fail('奖励已领取');
  applyReward(ctx, entry); state.claims.push(entry.id); entry.claimedAt = ctx.now;
  return { message: kind === 'ranked' ? '天梯奖励已领取' : '城战奖励已领取', rewardId: entry.id, reward: entry.reward };
}

const handlers = {
  'league.reward.claim': (ctx, payload) => claim(ctx, payload, 'ranked'),
  'clanwar.register': registerClan,
  'clanwar.reward.claim': (ctx, payload) => claim(ctx, payload, 'clan'),
};

export function operateLeague(ctx, action, payload = {}) {
  ensureContext(ctx);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('payload无效');
  const handler = handlers[action];
  if (!handler || !leagueActions.includes(action)) fail('未知联赛操作');
  return handler(ctx, payload);
}

function uiItem(label, detail, action, payload = {}, disabled = false) {
  return { label, detail, action, payload, disabled };
}

export function leagueView(ctx) {
  ensureContext(ctx); rotate(ctx.world, ctx.tables, ctx.now);
  const league = ctx.world.league; const actorState = ensureActor(ctx.actor);
  const ranking = Object.keys(league.current.ranked.participants).map(id => {
    const actor = ctx.world.characters[id]; const stats = league.current.ranked.participants[id];
    return actor ? { id, name: actor.name, rating: number(actor.rating, RATING_CENTER), ...stats } : null;
  }).filter(Boolean).sort((a, b) => b.rating - a.rating || b.wins - a.wins || a.id.localeCompare(b.id));
  const territories = clanTerritories(ctx.tables).map(entry => ({ ...entry,
    controllerGuildId: league.controllers[entry.id] ?? null,
    registeredGuildIds: [...(league.current.clan.registrations[entry.id] ?? [])],
    standings: clanStandings(league.current)[entry.id] ?? [],
  }));
  const rankedClaims = actorState.pendingRewards.filter(entry => entry.kind === 'ranked');
  const clanClaims = actorState.pendingRewards.filter(entry => entry.kind === 'clan');
  const guild = ctx.world.guilds[ctx.actor.guildId];
  const clanItems = territories.map(entry => uiItem(`报名城战：${entry.name}`, `赛季 ${league.current.key}`, 'clanwar.register',
    { territoryId: entry.id }, !guild || guild.leader !== ctx.actor.id || entry.registeredGuildIds.includes(guild.id)));
  clanItems.push(...clanClaims.map(entry => uiItem('领取城战奖励', `${entry.seasonKey} · 第${entry.rank}名`, 'clanwar.reward.claim', { rewardId: entry.id })));
  return {
    version: 1,
    season: { key: league.current.key, startAt: league.current.startAt, endAt: league.current.endAt,
      ratingReset: { center: RATING_CENTER, retain: RATING_RETAIN } },
    sections: [
      { id: 'ranked-season', title: '天梯赛季', items: rankedClaims.map(entry => uiItem('领取天梯奖励', `${entry.seasonKey} · 第${entry.rank}名`, 'league.reward.claim', { rewardId: entry.id })) },
      { id: 'clan-war', title: '公会城战', items: clanItems },
    ],
    ranked: { ranking, history: [...actorState.rankedHistory], pendingRewards: rankedClaims },
    clanWar: { territories, history: [...actorState.clanHistory], pendingRewards: clanClaims },
  };
}

export function validateLeagueRoom(ctx, opponent) {
  ensureContext(ctx); rotate(ctx.world, ctx.tables, ctx.now);
  const mode = ctx.mode ?? ctx.room?.mode;
  if (!['ranked', 'clan-war'].includes(mode)) return true;
  if (!opponent || opponent.id === ctx.actor.id || !ctx.world.characters[opponent.id]
    || opponent.ai === true || (ctx.actor.accountId && ctx.actor.accountId === opponent.accountId)) fail('联赛需要两名不同账号的真实玩家');
  if (mode === 'ranked') return true;
  const actorGuild = guildFor(ctx.world, ctx.actor); const opponentGuild = guildFor(ctx.world, opponent);
  if (actorGuild.id === opponentGuild.id) fail('城战需要不同公会的成员');
  const territoryId = String(ctx.territoryId ?? ctx.room?.territoryId ?? '');
  territory(ctx.tables, territoryId);
  const registered = ctx.world.league.current.clan.registrations[territoryId] ?? [];
  if (!registered.includes(actorGuild.id) || !registered.includes(opponentGuild.id)) fail('双方公会尚未报名此领地');
  return true;
}

export function onLeagueSettled(ctx, record, won) {
  if (!['ranked', 'clan-war'].includes(record?.mode)) return;
  ensureContext(ctx); rotate(ctx.world, ctx.tables, ctx.now);
  const actors = assertRealPair(ctx.world, record);
  if (record.mode === 'ranked') {
    record.leagueRankedSettledActors ??= [];
    if (record.leagueRankedSettledActors.includes(ctx.actor.id)) return;
    if (!actors.some(actor => actor.id === ctx.actor.id)) fail('角色不属于本场天梯');
    record.leagueRankedSettledActors.push(ctx.actor.id);
    const participants = ctx.world.league.current.ranked.participants;
    participants[ctx.actor.id] ??= { matches: 0, wins: 0, losses: 0 };
    participants[ctx.actor.id].matches += 1;
    if (won) participants[ctx.actor.id].wins += 1; else participants[ctx.actor.id].losses += 1;
    return;
  }
  if (record.leagueClanSettled) return;
  const territoryId = String(record.territoryId ?? ''); territory(ctx.tables, territoryId);
  const guilds = actors.map(actor => guildFor(ctx.world, actor));
  if (guilds[0].id === guilds[1].id) fail('城战需要不同公会的成员');
  const registered = ctx.world.league.current.clan.registrations[territoryId] ?? [];
  if (guilds.some(guild => !registered.includes(guild.id))) fail('双方公会尚未报名此领地');
  const players = actors.map(actor => record.state.players.find(player => player.id === actor.id));
  const winnerTeam = record.state.winner;
  if (record.state.status && record.state.status !== 'settled') fail('城战尚未结算');
  if (winnerTeam !== null && (winnerTeam === undefined || !players.some(player => player.team === winnerTeam))) fail('城战胜者无效');
  const entries = ctx.world.league.current.clan.standings[territoryId] ??= {};
  actors.forEach((actor, index) => {
    const guild = guilds[index]; const didWin = players[index].team === winnerTeam;
    entries[guild.id] ??= { guildId: guild.id, guildName: guild.name, score: 0, wins: 0, losses: 0, matches: 0, participants: {} };
    const entry = entries[guild.id]; entry.score += didWin ? 3 : 1; entry.matches += 1;
    if (didWin) entry.wins += 1; else entry.losses += 1;
    entry.participants[actor.id] = number(entry.participants[actor.id]) + 1;
  });
  const ordered = Object.values(entries).sort((a, b) => b.score - a.score || b.wins - a.wins || a.guildId.localeCompare(b.guildId));
  ctx.world.league.controllers[territoryId] = ordered[0].guildId;
  record.leagueClanSettled = true;
}

export function tickLeague(world, tables, now) {
  const existed = Boolean(world?.league);
  ensureWorld(world, now);
  return rotate(world, tables, now) || !existed;
}
