import { STAGE_SCOPE, stageError, initializeStage, stageActionGuard, stageFilterSections, stageDeckIssues, stageDungeonAllowed, stageSceneAllowed, stageCardAllowed, stageItemAllowed, legacyClaimKey } from './stage-policy.mjs';
import { randomInt, randomUUID } from 'node:crypto';
import { createBattle, applyBattleAction, legalPlays, advanceAI, publicBattle } from '../../cocos-client/assets/scripts/game/BattleKernel.ts';
import { numeric } from '../../cocos-client/assets/scripts/game/RecoveredContent.ts';
import { growthActions, growthView, operateGrowth, tickGrowth, combatBonuses, touchActorActivity } from './growth-systems.mjs';
import { socialActions, socialView, operateSocial, tickSocial } from './social.mjs';
import { pveActions, operatePve, pveView, tickPve, onPveBattleSettled, pveActionSnapshot, onPveAction } from './pve-systems.mjs';
import { competitionActions, operateCompetition, competitionView, tournamentDeck, onCompetitionSettled } from './competition-systems.mjs';
import { leagueActions, operateLeague, leagueView, tickLeague, validateLeagueRoom, onLeagueSettled } from './league-systems.mjs';
import { grantCampaignExtras } from './campaign-rewards.mjs';
import { presentationNames, presentSections } from './presentation.mjs';
import { playerUi, mainlineTaskCards } from './player-ui.mjs';
import { requireText, requireCount, conflict, stable } from './store.mjs';
import { tacticsForNode, explorationTasks } from './pve-experience.mjs';

const nowDay = now => new Date(now + 8 * 3600000).toISOString().slice(0, 10);
function grantSilver(actor, amount, reason, now) {
  if (!Number.isSafeInteger(amount) || actor.currencies.silver + amount < 0) throw new Error('银币不足');
  actor.currencies.silver += amount;
  actor.economicLog.push({ id: randomUUID(), currency: 'silver', amount, reason, at: now });
}
export class GameService {
  constructor(store, content, { clock = () => Date.now() } = {}) { this.store = store; this.content = content; this.clock = clock;this.instanceId=randomUUID(); }
  characters(accountId) {
    return Object.values(this.store.read().characters).filter(char => char.accountId === accountId)
      .map(char => ({ id: char.id, name: char.name, profession: char.profession, level: char.level }));
  }
  actor(world, accountId, characterId) {
    const actor = world.characters[characterId];
    if (!actor || actor.accountId !== accountId) throw new Error('角色不存在或不属于当前账号');
    return actor;
  }
  act(accountId, characterId, requestId, action, payload = {}, {expectedActorRevision} = {}) {
    const now = this.clock();
    return this.store.transaction(`${accountId}:${characterId ?? 'new'}`, requestId, action, expectedActorRevision===undefined?payload:{payload,expectedActorRevision}, world => {
      if (action === 'character.create') return this.createCharacter(world, accountId, payload, now);
      tickLeague(world, this.content.tables, now);
      const actor = this.actor(world, accountId, characterId);
      if(expectedActorRevision!==undefined&&(!Number.isSafeInteger(expectedActorRevision)||expectedActorRevision!==(actor.commandRevision??0)))throw conflict('角色已被另一页面更新，请同步后重新操作','ACTOR_CONFLICT',{actorRevision:actor.commandRevision??0});
      const ctx = { world, actor, content: this.content, tables: this.content.tables, now, randomInt,
        makePlayer: (candidate, team) => this.playerSpec(world, candidate, team) };
      this.ensureStage(ctx);
      stageActionGuard(ctx,action,payload);
      touchActorActivity(ctx);
      const before = pveActionSnapshot(ctx);
      const result = (() => {
      if (action === 'battle.command') return this.battleCommand(world, actor, payload, now);
      const active = this.activeBattle(world, actor.id);
      const locked = ['deck.save', 'pve.start', 'room.create', 'room.join', ...growthActions, ...competitionActions, ...leagueActions, 'guild.leave', 'guild.transfer', ...pveActions.filter(name => name !== 'task.claim'), ...socialActions.filter(name => ['trade.', 'auction.', 'mail.send'].some(prefix => name.startsWith(prefix)))];
      if (active && locked.includes(action)) throw new Error('请先结束当前战斗');
      if (pveActions.includes(action) && (action !== 'task.claim' || !this.tasks(actor,true).some(task => task.id === payload.taskId))) {
        const result = operatePve(ctx, action, payload);
        if (result.start) {
          const record = this.startSpecialPve(world, actor, result.start, now);
          return { ...(result.response?.result ?? {}), battleId: record.id };
        }
        return result.result ?? result;
      }
      if (leagueActions.includes(action)) return operateLeague(ctx, action, payload);
      if (competitionActions.includes(action)) return operateCompetition(ctx, action, payload);
      if (growthActions.includes(action)) {
        const result = operateGrowth(ctx, action, payload);
        if (Object.values(world.characters).some(other => other.id !== actor.id && other.name === actor.name)) throw new Error('角色名称已存在');
        return result;
      }
      if (socialActions.includes(action)) return operateSocial(ctx, action, payload);
      if (action === 'deck.save') {
        if(payload.expectedDeck!==undefined&&stable(payload.expectedDeck)!==stable(actor.deck))throw conflict('卡组已被另一页面更新。草稿已保留，请核对后再次保存','DECK_CONFLICT',{currentDeck:[...actor.deck]});
        actor.deck = this.content.validateDeck(actor, payload.cards);
        actor.stats.deckEdits++; return { message: '卡组已保存', cards: [...actor.deck] };
      }
      if (action === 'settings.save') {
        const allowed = ['music', 'sound', 'rejectPrivate', 'rejectInvites'];
        for (const key of allowed) if (Object.hasOwn(payload, key)) {
          if (typeof payload[key] !== 'boolean') throw new Error('设置格式错误'); actor.settings[key] = payload[key];
        }
        return { message: '设置已保存' };
      }
      if (action === 'tutorial.advance') {
        const step = actor.tutorialStep;
        const requirements = [true, actor.stats.deckEdits > 0, actor.stats.battles > 0, actor.stats.pveWins > 0];
        if (step >= requirements.length || !requirements[step]) throw new Error('请先完成本步引导目标');
        actor.tutorialStep++; grantSilver(actor, 20, '新手引导', now); return { message: '引导完成，获得20银币' };
      }
      if (action === 'task.claim'&&this.tasks(actor,true).some(task=>task.id===payload.taskId)) return this.claimTask(actor, payload, now);
      if (action === 'pve.enterScene') {
        const sceneId = Number(payload.sceneId);
        if(!stageSceneAllowed(this.content.tables,sceneId))throw stageError('该扩展场景本阶段暂缓，主线章节继续保留。');
        if (!actor.progress.unlockedScenes.includes(sceneId)) throw new Error('场景尚未解锁');
        this.content.graph(sceneId); actor.progress.sceneId = sceneId; return { message: '已进入场景' };
      }
      if (action === 'pve.transition') {
        const graph = this.content.graph(actor.progress.sceneId);
        const node = graph.nodes.find(node => node.id === payload.nodeId);
        if (!node || !this.content.nodeAccessible(actor, graph, node)) throw new Error('请先通关前置关卡');
        const next = node.triggers.find(trigger => numeric(trigger.raw, 'type') === 3);
        if (!next) throw new Error('此处没有场景通道');
        const sceneId = numeric(next.raw, 'nextsenceid');if(!stageSceneAllowed(this.content.tables,sceneId))throw stageError(); this.content.graph(sceneId);
        const minLevel = this.content.sceneLevels.get(String(sceneId)) ?? 1;
        if (actor.level < minLevel) throw new Error(`需要等级${minLevel}`);
        if (!actor.progress.unlockedScenes.includes(sceneId)) actor.progress.unlockedScenes.push(sceneId);
        actor.progress.clearedNodes.push(node.id); actor.progress.sceneId = sceneId; return { message: '新章节已解锁' };
      }
      if (action === 'pve.dungeon') {
        const id = Number(payload.sceneId);
        const entry = this.content.table('scene/fubens').find(row => ['简单', '普通', '困难'].some(key => Number(row[key]) === id));
        if (!entry) throw new Error('副本不存在');
        if (!stageDungeonAllowed(this.content.tables,id)) throw stageError('本阶段仅开放普通副本；已有进度与在途战斗保留。');
        const minLevel = this.content.sceneLevels.get(String(id)) ?? 1;
        if (actor.level < minLevel) throw new Error(`需要等级${minLevel}`);
        const gold = Number(entry['进入消耗金币'] ?? 0);
        if (actor.currencies.gold < gold) throw new Error('金币不足');
        actor.currencies.gold -= gold;
        if (gold) actor.economicLog.push({ currency: 'gold', amount: -gold, reason: '副本进入', at: now });
        actor.progress.dungeonEntries ??= {};
        const entryKey = `${nowDay(now)}:${entry['副本ID']}`;
        const limit = Number(entry['每天副本通关次数'] ?? 0);
        if (limit > 0 && (actor.progress.dungeonEntries[entryKey] ?? 0) >= limit) throw new Error('今日副本次数已用完');
        actor.progress.dungeonEntries[entryKey] = (actor.progress.dungeonEntries[entryKey] ?? 0) + 1;
        const ticket = Number(entry['进入消耗道具ID'] ?? 0);
        if (ticket > 0) {
          const key = `main:item:${ticket}`;
          if (!(actor.inventory[key] > 0)) throw new Error('缺少副本门票'); actor.inventory[key]--;
        }
        const graph = this.content.graph(id);
        const allIds = new Set(graph.nodes.map(node => node.id));
        actor.progress.clearedNodes = actor.progress.clearedNodes.filter(key => !allIds.has(key));
        actor.progress.clearedTriggers = actor.progress.clearedTriggers.filter(key => !key.startsWith(graph.id + ':node:'));
        if (!actor.progress.unlockedScenes.includes(id)) actor.progress.unlockedScenes.push(id);
        actor.progress.sceneId = id; return { message: '副本挑战已开启' };
      }
      if (action === 'pve.start') {
        const issues=stageDeckIssues(actor,this.content.tables);if(issues.length)throw new Error(issues.join('\n'));
        if(!stageSceneAllowed(this.content.tables,String(payload.nodeId).split(':node:')[0]))throw stageError();
        const level = this.content.level(actor, payload.nodeId, payload.triggerId);
        const battle = this.startPve(world, [actor], level, now, 'pve');
        return { message: '战斗开始', battleId: battle.id };
      }
      if (action === 'room.invite') {
        const room = world.rooms[payload.roomId];
        const target = world.characters[payload.target] ?? Object.values(world.characters).find(char => char.name === payload.target);
        if (!room?.members.includes(actor.id) || room.status !== 'waiting') throw new Error('房间不可邀请');
        if (!target || target.id === actor.id || target.settings?.rejectInvites) throw new Error('对方不存在或已关闭邀请');
        world.roomInvites ??= {};
        const id = `${room.id}:${target.id}`; world.roomInvites[id] = { id, roomId: room.id, from: actor.id, to: target.id, expires: now + 300000 };
        return { message: '房间邀请已发送' };
      }
      if (action === 'room.create') return this.createRoom(world, actor, payload, now);
      if (action === 'room.join') return this.joinRoom(world, actor, payload);
      if (action === 'room.ready') {
        const room = world.rooms[payload.roomId];
        if (!room?.members.includes(actor.id) || room.status !== 'waiting') throw new Error('房间不可准备');
        room.ready[actor.id] = payload.ready !== false; return { message: room.ready[actor.id] ? '已准备' : '已取消准备' };
      }
      if (action === 'room.leave') return this.leaveRoom(world, actor, payload.roomId);
      if (action === 'room.start') return this.startRoom(world, actor, payload.roomId, now);
      if (action === 'battle.dismiss') {
        const record = world.battles[payload.battleId];
        if (!record?.participants.includes(actor.id) || !record.settled) throw new Error('结算尚未完成');
        record.dismissed ??= []; if (!record.dismissed.includes(actor.id)) record.dismissed.push(actor.id);
        return { message: '已返回主城' };
      }
      throw new Error('操作不存在');
      })();
      actor.name = requireText(actor.name, '角色名称', 14);
      onPveAction(ctx, action, payload, result, before);
      delete actor.stageScope?.claims?.[legacyClaimKey(action,payload)];
      if(action==='inventory.use'&&ctx.legacyRewards){const key=String(payload.itemId).includes(':')?payload.itemId:`main:item:${payload.itemId}`;actor.stageScope.inventory[key]=Math.max(0,(actor.stageScope.inventory[key]??0)-Number(payload.count??1));}
      actor.commandRevision=(actor.commandRevision??0)+1;
      return {...result,commandRevision:actor.commandRevision};
    }, now);
  }
  createCharacter(world, accountId, payload, now) {
    const name = requireText(payload.name, '角色名称', 14); const profession = Number(payload.profession);
    const gender = payload.gender === undefined ? 1 : Number(payload.gender);
    if (![1, 2].includes(gender)) throw new Error('性别无效');
    if (![1, 2, 3, 4].includes(profession)) throw new Error('职业无效');
    if (Object.values(world.characters).some(char => char.name === name)) throw new Error('角色名称已存在');
    if (Object.values(world.characters).filter(char => char.accountId === accountId).length >= 4) throw new Error('每个账号最多4个角色');
    const id = randomUUID(); const deck = [1, 19, 43, 61].map(key => this.content.card(key).id);
    const actor = { id, accountId, name, profession, gender, level: 1, xp: 0, commandRevision:0,
      currencies: { silver: 300, gold: 20, crystal: 0 }, cards: Object.fromEntries(deck.map(id => [id, 1])),
      deck, inventory: {}, equipment: {}, enhancements: {}, warehouse: {},
      progress: { sceneId: 1, clearedNodes: [], clearedTriggers: [], unlockedScenes: [1], positionByScene: {} },
      quests: {}, claimed: [], tutorialStep: 0, rating: 1000, wins: 0, losses: 0,
      stats: { battles: 0, pveWins: 0, coopWins: 0, pvpMatches: 0, deckEdits: 0 },
      settings: { music: true, sound: true }, createdAt: now, lastLogin: now, economicLog: [] };
    this.content.validateDeck(actor, deck);
    actor.stageScope={id:STAGE_SCOPE.id,startedAt:now,claims:{},inventory:{},battles:[],rooms:[],unresolved:[]};
    world.characters[id] = actor;
    world.mail[`welcome:${id}`] = { id: `welcome:${id}`, from: 'system', to: id, title: '欢迎来到天墟',
      text: '初始卡组已准备。先保存编队，再从世界地图出征。卡牌准备值归零后可部署。', attachment: null, claimed: true, read: false, at: now };
    return { message: '角色已创建', characterId: id };
  }
  tasks(actor, includePaused=false) {
    return [
      { id: 'first-deck', name: '整备卡组', detail: '保存一次合法卡组', ready: actor.stats.deckEdits > 0, reward: 30 },
      { id: 'first-battle', name: '踏上征途', detail: '完成一场战斗', ready: actor.stats.battles > 0, reward: 30 },
      { id: 'three-wins', name: '主线先锋', detail: '取得三场PVE胜利', ready: actor.stats.pveWins >= 3, reward: 100 },
      { id: 'cooperation', name: '并肩作战', detail: '与真实玩家合作取胜', ready: actor.stats.coopWins > 0, reward: 100 },
      { id: 'arena', name: '竞技新秀', detail: '完成一场真实PVP', ready: actor.stats.pvpMatches > 0, reward: 100 },
      ...explorationTasks(actor),
    ].filter(task=>includePaused||!['cooperation','arena'].includes(task.id)).map(task => ({ ...task, claimed: actor.claimed.includes('task:' + task.id) }));
  }
  claimTask(actor, payload, now) {
    const task = this.tasks(actor,true).find(task => task.id === payload.taskId);
    if(['cooperation','arena'].includes(payload.taskId)&&!actor.stageScope?.claims?.[legacyClaimKey('task.claim',payload)])throw stageError();
    if (!task || !task.ready || task.claimed) throw new Error('任务未完成或已领取');
    actor.claimed.push('task:' + task.id);
    if (task.reward > 0) grantSilver(actor, task.reward, '任务奖励', now);
    const xp = task.xp ?? 10;
    this.content.grantExperience(actor, xp); return { message: `领取${task.reward > 0 ? task.reward + '银币与' : ''}${xp}经验` };
  }
  activeBattle(world, actorId) { return Object.values(world.battles).find(record => record.participants.includes(actorId) && !record.settled); }
  playerSpec(world, actor, team) {
    const stats = this.content.actorStats(actor); const guild = world.guilds[actor.guildId];
    const bonus = combatBonuses({ world, actor, content: this.content, tables: this.content.tables, now: this.clock(), randomInt });
    const guildHp = Number(guild?.skills?.vitality ?? 0);
    const equipmentCards = (bonus.cards ?? []).filter(id => {
      try { const card = this.content.card(id); return Number(card.raw.Type) === 2; } catch { return false; }
    });
    return { id: actor.id, name: actor.name, team, hp: Number(stats.HP) + guildHp + bonus.hp, attack: 1 + bonus.attack,
      effects: bonus.effects ?? [], deck: [...this.content.validateDeck(actor, actor.deck), ...equipmentCards], profession: actor.profession, sex: actor.gender === 2 ? 0 : 1, ai: false };
  }
  startPve(world, actors, level, now, mode, roomId) {
    const id = randomUUID(); const seed = randomInt(1, 0x7fffffff);
    const players = actors.map(actor => this.playerSpec(world, actor, 0));
    const elite = false; // New elite branches are deferred; persisted battles keep their original encounter.
    const encounterParams = elite ? this.content.encounter(level.trigger, true) : level.params;
    for (const [index, param] of encounterParams.entries()) {
      const monsterId = numeric(param, 'id'); const hero = this.content.data.monsters[String(monsterId)];
      if (!hero) throw new Error('敌方英雄配置缺失');
      players.push({ id: `ai:${id}:${index}`, name: String(hero.Name), team: 1, hp: Math.max(1, Math.floor(numeric(hero, 'HP') * numeric(param, 'hpMultiplier', 1))),
        attack: Math.floor(numeric(hero, 'Attack') * numeric(param, 'attackMultiplier', 1)), monsterId, ai: true,
        deck: this.content.enemyDeck(hero, mode === 'pve' ? level : { minLevel: level.minLevel }, seed + index) });
    }
    const initialUnits = [];
    if (level.board) {
      const defenderId = `board:${id}`;
      players.push({ id: defenderId, name: '遗迹守卫', team: 1, hp: 1, attack: 0, ai: true, deck: [] });
      const cells = Array.from({ length: 12 }, (_, index) => ({ row: Math.floor(index / 3), col: 8 + index % 3 }));
      let cursor = seed;
      for (let index = 0; index < level.board.count; index++) {
        cursor = (Math.imul(cursor, 1664525) + 1013904223) >>> 0;
        const cell = cells.splice(cursor % cells.length, 1)[0];
        initialUnits.push({ playerId: defenderId, monsterId: level.board.monsterId + index % 3, ...cell });
      }
    }
    const tactics = mode === 'pve' && tacticsForNode(level.node);
    const entryState = createBattle(this.content, { id, seed, mapId: level.mapId, players, ...(tactics ? {tacticsVersion: 2} : {}), firstPlayer: numeric(level.trigger.raw, 'firstteam') === 1 ? 0 : undefined, rows: Math.max(level.rows ?? 4, ...[0, 1].map(team => players.filter(player => player.team === team).length)),
      ...(level.board ? { boardClearTeam: 1, turnLimit: 48, initialUnits } : {}) });
    const state = advanceAI(this.content, entryState);
    const record = { id, entryState, state, mode, roomId, participants: actors.map(actor => actor.id),
      level: { sceneId: level.sceneId, nodeId: level.node.id, triggerId: level.trigger.id, elite },
      createdAt: now, settled: false, rewards: {}, dismissed: [] };
    world.battles[id] = record;
    this.settle(world, record, now); return record;
  }
  startSpecialPve(world, actor, setup, now) {
    const id = randomUUID(); const seed = randomInt(1, 0x7fffffff);
    const players = [this.playerSpec(world, actor, 0)];
    players[0].effects.push(...(setup.playerEffects ?? []));
    const difficulty = Math.max(1, actor.level, Math.floor(Number(setup.pve?.layer ?? 1) / 5));
    for (const [index, enemy] of setup.enemies.entries()) {
      const monsterId = this.content.resolveMonsterId(Number(enemy.monsterId)); const raw = this.content.data.monsters[String(monsterId)];
      if (!raw) throw new Error(`兼容敌方模型缺失：${monsterId}`);
      players.push({ id: `ai:${id}:${index}`, name: String(raw.Name), team: 1, hp: Math.max(1, Math.floor(numeric(raw, 'HP') * (enemy.hpMultiplier ?? 1))),
        attack: numeric(raw, 'Attack'), monsterId, ai: true,
        deck: (enemy.deckIds?.length ? enemy.deckIds : [enemy.deckId ?? monsterId]).flatMap((deckId, stack) =>
          this.content.enemyDeck(raw, { minLevel: difficulty }, (seed + Number(deckId) + index + stack) >>> 0)) });
    }
    for (const [index, ally] of (setup.allies ?? []).entries()) {
      const card = this.content.card(ally.cardId); const raw = this.content.monsterForCard(card.id);
      if (!raw) throw new Error('佣兵生物配置缺失');
      players.push({ id: `ally:${id}:${index}`, name: String(raw.Name), team: 0, hp: Math.max(1, numeric(raw, 'HP')),
        attack: numeric(raw, 'Attack'), monsterId: numeric(card.raw, 'MonsterID'), ai: true, deck: [card.id, card.id] });
    }
    let mapId = Number(setup.mapId); if (!this.content.data.maps[String(mapId)]?.layoutRows.length) mapId = 1;
    const entryState = createBattle(this.content, { id, seed, mapId, players });
    const state = advanceAI(this.content, entryState);
    const record = { id, entryState, state, mode: setup.mode, pve: setup.pve, participants: [actor.id], createdAt: now,
      settled: false, rewards: {}, dismissed: [] };
    world.battles[id] = record; this.settle(world, record, now); return record;
  }
  battleCommand(world, actor, payload, now) {
    const record = world.battles[payload.battleId];
    if (!record?.participants.includes(actor.id) || record.settled) throw new Error('战斗不存在或已结束');
    if (!Number.isSafeInteger(payload.revision) || payload.revision !== record.state.revision) throw conflict('战斗已更新，请重新同步','BATTLE_CONFLICT',{battleRevision:record.state.revision});
    try{record.state = advanceAI(this.content, applyBattleAction(this.content, record.state, actor.id, payload.action));}catch(e){const message=String(e.message);if(/not the active player/.test(message))throw new Error('当前不是你的回合');if(/Unsupported persistent/.test(message))throw new Error('本版本尚不支持这张持续地形牌，卡牌未消耗');if(/Illegal/.test(message))throw new Error('此卡牌当前没有合法落点或目标');throw e;}
    this.settle(world, record, now);
    return { message: record.settled ? '战斗结束' : '操作已确认', battleId: record.id };
  }
  settle(world, record, now) {
    if (record.settled || record.state.status !== 'settled') return;
    record.settled = true; record.settledAt = now;
    const ownership = new Map(record.state.players.flatMap(player => [[player.id, player.id], [`hero:${player.id}`, player.id]]));
    const team = new Map(record.state.players.map(player => [player.id, player.team]));
    record.damageDealt = Object.fromEntries(record.participants.map(id => [id, 0]));
    record.killedMonsters = Object.fromEntries(record.participants.map(id => [id, {}]));
    const lastDamager = new Map();
    for (const event of record.state.events) {
      if (event.type === 'summon' && event.target) ownership.set(event.target, ownership.get(event.actor) ?? event.actor);
      if (event.type === 'damage' && event.target && event.amount > 0) lastDamager.set(event.target, ownership.get(event.actor));
      if (event.type === 'death') {
        const killer = lastDamager.get(event.actor); const card = this.content.data.cards[event.cardId?.split(':').at(-1)];
        const monsterId = event.cardId?.startsWith('token:') ? Number(event.cardId.slice(6)) : Number(card?.raw.MonsterID ?? 0);
        if (monsterId && record.participants.includes(killer) && team.get(killer) !== team.get(ownership.get(event.actor))) {
          record.killedMonsters[killer][monsterId] = (record.killedMonsters[killer][monsterId] ?? 0) + 1;
        }
      }
      if (event.type === 'damage' && event.target?.startsWith('hero:') && event.amount > 0) {
        const source = ownership.get(event.actor); const target = ownership.get(event.target);
        if (record.participants.includes(source) && team.get(source) !== team.get(target)) record.damageDealt[source] += Number(event.effectiveAmount ?? event.amount);
      }
    }
    if (record.roomId && world.rooms[record.roomId]) world.rooms[record.roomId].status = 'settled';
    for (const id of record.participants) {
      if(!this.store.reserveSettlement(record.id,id,now)){record.rewards[id]=this.store.settlement(record.id,id)??{};continue;}
      const actor = world.characters[id]; const player = record.state.players.find(player => player.id === id);
      const won = record.state.winner === player.team; actor.stats.battles++;
      let silver = 0; let xp = 0; const cards = [];
      if (record.level && won) {
        const scene = this.content.data.scenes.find(scene => scene.id === record.level.sceneId);
        const graph = this.content.graph(scene.id); const node = graph.nodes.find(node => node.id === record.level.nodeId);
        const trigger = node.triggers.find(trigger => trigger.id === record.level.triggerId);
        const repeatReward = numeric(trigger.raw, 'repeat') === 0 && actor.progress.clearedTriggers.includes(trigger.id)
          ? node.triggers.find(candidate => numeric(candidate.raw, 'type') === 2 && numeric(candidate.raw, 'repeat') === 1) : trigger;
        const rewardRaw = repeatReward?.raw ?? {};
        silver = numeric(rewardRaw, 'silverprize'); xp = numeric(rewardRaw, 'expprize');
        const cardId = numeric(rewardRaw, 'cardidprize'); const count = numeric(rewardRaw, 'cardnumprize');
        if (cardId > 0 && count > 0) {
          const card = this.content.card(cardId); if(stageCardAllowed(this.content.tables,card.id)||actor.stageScope?.battles?.includes(record.id)){actor.cards[card.id] = (actor.cards[card.id] ?? 0) + count;
          cards.push({ id: card.id, count });}
        }
        const extras = grantCampaignExtras({ world, actor, content: this.content, tables: this.content.tables, now, randomInt, legacyRewards:actor.stageScope?.battles?.includes(record.id) }, record,
          { trigger: repeatReward, node, scene, eligible: Boolean(repeatReward) });
        cards.push(...extras.cards.map(card => ({ id: card.cardId, count: card.count })));
        record.campaignExtras ??= {}; record.campaignExtras[id] = extras;
        if (!actor.progress.clearedNodes.includes(node.id)) actor.progress.clearedNodes.push(node.id);
        if (!actor.progress.clearedTriggers.includes(trigger.id)) actor.progress.clearedTriggers.push(trigger.id);
        actor.stats.pveWins++; if (record.mode === 'coop') actor.stats.coopWins++;
        for (const prize of this.content.table('teachprize').filter(row => Number(row['地图关卡id']) === Number(trigger.raw.id))) {
          const key = 'teach:' + prize._row;
          if (!actor.claimed.includes(key)) {
            const type = Number(prize['道具类型(1银币2金币3卡片4道具5塔币）']);
            const item = Number(prize['（道具ID 其他填0)']); const amount = Number(prize['数量']);
            if (type === 1) silver += amount;
            else if (type === 2) actor.currencies.gold += amount;
            else if (type === 4 && (stageItemAllowed(this.content.tables,item)||actor.stageScope?.battles?.includes(record.id))) actor.inventory[`main:item:${item}`] = (actor.inventory[`main:item:${item}`] ?? 0) + amount;
            actor.claimed.push(key);
          }
        }
      } else if (!record.level && !record.pve) {
        actor.stats.pvpMatches++; if (won) actor.wins++; else actor.losses++;
        silver = won ? 30 : 10; xp = won ? 6 : 3;
        if (record.mode === 'ranked' && record.state.winner !== null) {
          const opponent = record.participants.find(other => other !== id);
          const opponentRating = record.startRatings[opponent];
          const delta = Math.round(32 * ((won ? 1 : 0) - 1 / (1 + 10 ** ((opponentRating - record.startRatings[id]) / 400))));
          actor.rating = Math.max(0, actor.rating + delta);
        }
      }
      const guild = world.guilds[actor.guildId]; if (silver && guild) silver += Math.floor(silver * (guild.skills.income ?? 0) / 100);
      grantSilver(actor, silver, `战斗结算:${record.id}`, now); this.content.grantExperience(actor, xp);
      record.rewards[id] = { won, silver: silver + Number(record.campaignExtras?.[id]?.currencies?.silver ?? 0), xp: xp + Number(record.campaignExtras?.[id]?.xp ?? 0), cards, extras: record.campaignExtras?.[id] };
      const balanceBefore = actor.currencies.silver; const xpBefore = actor.xp;
      onPveBattleSettled({ world, actor, content: this.content, tables: this.content.tables, now, randomInt, legacyRewards:actor.stageScope?.battles?.includes(record.id) }, record, won);
      onCompetitionSettled({ world, actor, content: this.content, tables: this.content.tables, now, randomInt, legacyRewards:actor.stageScope?.battles?.includes(record.id) }, record, won);
      onLeagueSettled({ world, actor, content: this.content, tables: this.content.tables, now, randomInt, legacyRewards:actor.stageScope?.battles?.includes(record.id) }, record, won);
      if (record.pve) {
        if (won) actor.stats.pveWins++;
        record.rewards[id] = { won, silver: actor.currencies.silver - balanceBefore,
          xp: Number(record.pveReward?.xp ?? Math.max(0, actor.xp - xpBefore)), cards, special: record.pveReward };
      }
      this.store.finishSettlement(record.id,id,record.rewards[id]);
    }
  }
  createRoom(world, actor, payload, now) {
    if (Object.values(world.rooms).some(room => room.status === 'waiting' && room.members.includes(actor.id))) throw new Error('请先离开当前房间');
    const mode = payload.mode;
    if (!['coop', 'pvp', 'ranked', 'clan-war', 'tournament'].includes(mode)) throw new Error('房间类型无效');
    const teamSize = mode === 'pvp' ? Number(payload.teamSize ?? 1) : 1;
    if (![1, 2, 4].includes(teamSize)) throw new Error('竞技队伍人数无效');
    let level = null;
    if (mode === 'coop') level = this.content.level(actor, payload.nodeId, payload.triggerId, true);
    if (mode === 'tournament') tournamentDeck({ world, actor, tables: this.content.tables, content: this.content, now, randomInt });
    if (mode === 'clan-war') {
      const league = leagueView({ world, actor, content: this.content, tables: this.content.tables, now, randomInt });
      const territory = league.clanWar.territories.find(entry => entry.id === payload.territoryId);
      if (!actor.guildId || !territory?.registeredGuildIds.includes(actor.guildId)) throw new Error('请先报名城战领地');
    }
    const id = randomUUID(); world.rooms[id] = { id, teamSize, capacity: mode === 'coop' ? 4 : teamSize * 2, territoryId: mode === 'clan-war' ? payload.territoryId : null, host: actor.id, mode, members: [actor.id], ready: { [actor.id]: true },
      level: level ? { nodeId: level.node.id, triggerId: level.trigger.id } : null, status: 'waiting', createdAt: now };
    return { message: '房间已创建，等待另一位玩家', roomId: id };
  }
  joinRoom(world, actor, payload) {
    const room = world.rooms[payload.roomId];
    if (!room || room.status !== 'waiting' || room.members.length >= (room.capacity ?? 2)) throw new Error('房间不可加入');
    if (Object.values(world.rooms).some(candidate => candidate.status === 'waiting' && candidate.members.includes(actor.id))) throw new Error('已经在房间中');
    validateLeagueRoom({ world, actor, tables: this.content.tables, now: this.clock(), room }, world.characters[room.host]);
    if (room.mode === 'clan-war' && (!actor.guildId || actor.guildId === world.characters[room.host].guildId)) throw new Error('城战需要不同公会的成员');
    if (room.mode === 'tournament') tournamentDeck({ world, actor, tables: this.content.tables, content: this.content, now: this.clock(), randomInt });
    if (room.mode !== 'coop' && room.members.some(id => actor.accountId === world.characters[id].accountId)) throw new Error('竞技对战需要两个独立账号');
    if (room.level) this.content.level(actor, room.level.nodeId, room.level.triggerId, true);
    room.members.push(actor.id); room.ready[actor.id] = false; return { message: '已加入房间' };
  }
  leaveRoom(world, actor, roomId) {
    const room = world.rooms[roomId]; if (!room?.members.includes(actor.id) || room.status !== 'waiting') throw new Error('房间不可离开');
    room.members = room.members.filter(id => id !== actor.id); delete room.ready[actor.id];
    if (!room.members.length) delete world.rooms[room.id]; else if (room.host === actor.id) room.host = room.members[0];
    return { message: '已离开房间' };
  }
  startRoom(world, actor, roomId, now) {
    const room = world.rooms[roomId];
    if (!room || room.host !== actor.id || room.status !== 'waiting' || room.members.length < 2 || (room.mode !== 'coop' && room.members.length !== (room.capacity ?? 2)) || room.members.length > (room.capacity ?? 2) || room.members.some(id => !room.ready[id])) throw new Error('需要房主和至少两位已准备玩家');
    if (room.members.some(id => this.activeBattle(world, id))) throw new Error('成员正在其他战斗');
    const actors = room.members.map(id => world.characters[id]); let record;
    validateLeagueRoom({ world, actor, tables: this.content.tables, now, room }, actors.find(other => other.id !== actor.id));
    if (room.mode !== 'coop' && new Set(actors.map(other => other.accountId)).size !== actors.length) throw new Error('竞技对战需要两个独立账号');
    if (room.level) {
      const level = this.content.level(actor, room.level.nodeId, room.level.triggerId, true);
      record = this.startPve(world, actors, level, now, room.mode, room.id);
    } else {
      const id = randomUUID(); const seed = randomInt(1, 0x7fffffff);
      const players = actors.map((actor, index) => {
        const spec = this.playerSpec(world, actor, Math.floor(index / (room.teamSize ?? 1)));
        if (room.mode === 'tournament') spec.deck = tournamentDeck({ world, actor, tables: this.content.tables, content: this.content, now, randomInt });
        return spec;
      });
      const state = createBattle(this.content, { id, seed, mapId: 1, players });
      record = { id, state, mode: room.mode, teamSize: room.teamSize ?? 1, territoryId: room.territoryId, roomId: room.id, participants: [...room.members], createdAt: now,
        startRatings: Object.fromEntries(actors.map(actor => [actor.id, actor.rating])), settled: false, rewards: {}, dismissed: [] };
      world.battles[id] = record;
    }
    room.status = 'battle'; room.battleId = record.id;
    return { message: '联机战斗开始', battleId: record.id };
  }
  ensureStage(ctx) {
    if(ctx.actor.stageScope?.id===STAGE_SCOPE.id)return false;
    touchActorActivity(ctx,0);
    const sections=[...growthView(ctx).sections,...pveView(ctx).sections,...competitionView(ctx).sections,...leagueView(ctx).sections];
    sections.push({id:'old-milestones',items:this.tasks(ctx.actor,true).filter(t=>['cooperation','arena'].includes(t.id)&&t.ready&&!t.claimed).map(t=>({label:t.name,action:'task.claim',payload:{taskId:t.id}}))});
    return initializeStage(ctx,sections);
  }
  view(accountId, characterId) {
    let world = this.store.read(); let actor = this.actor(world, accountId, characterId);
    const now = this.clock();
    if(actor.stageScope?.id!==STAGE_SCOPE.id){this.store.scheduled(current=>this.ensureStage({world:current,actor:this.actor(current,accountId,characterId),content:this.content,tables:this.content.tables,now,randomInt}));world=this.store.read();actor=this.actor(world,accountId,characterId);}
    if (!Number.isFinite(actor.growth?.lastActiveAt) || now - actor.growth.lastActiveAt >= 60000) {
      const changed = this.store.scheduled(current => touchActorActivity({ world: current, actor: this.actor(current, accountId, characterId), content: this.content, tables: this.content.tables, now, randomInt }));
      if (changed) { world = this.store.read(); actor = this.actor(world, accountId, characterId); }
    }
    const ctx = { world, actor, content: this.content, tables: this.content.tables, now, randomInt };
    const record = this.activeBattle(world, actor.id) ?? Object.values(world.battles)
      .filter(record => record.participants.includes(actor.id) && !record.dismissed.includes(actor.id)).at(-1);
    let battle = null;
    if (record) {
      const state = publicBattle(record.state, actor.id);
      const entryState = record.entryState ? publicBattle(record.entryState, actor.id) : undefined;
      battle = { id: record.id, mode: record.mode, state, ...(entryState ? { entryState } : {}), settled: record.settled, rewards: record.rewards[actor.id],
        legalPlays: record.settled ? [] : legalPlays(this.content, record.state, actor.id) };
    }
    const growth = growthView(ctx); const pve = pveView(ctx); const competition = competitionView(ctx); const league = leagueView(ctx);
    const actorLevel = this.content.actorStats(actor), shownBonus = combatBonuses(ctx);
    growth.characterStats = { level: actor.level, xp: actor.xp, nextLevelXp: Number(actorLevel.NextLevlExp),
      hp: Number(actorLevel.HP) + Number(world.guilds[actor.guildId]?.skills?.vitality ?? 0) + shownBonus.hp,
      attack: 1 + shownBonus.attack, critical: null, soldierBlock: null, soldierAttack: null };
    growth.sections.push(...pve.sections, ...competition.sections, ...league.sections);
    for (const territory of league.clanWar.territories) if (actor.guildId && territory.registeredGuildIds.includes(actor.guildId)) {
      growth.sections.find(section => section.id === 'clan-war').items.push({ label: `出征：${territory.name}`,
        detail: `当前领主：${world.guilds[territory.controllerGuildId]?.name ?? '尚无'}`, action: 'room.create', payload: { mode: 'clan-war', territoryId: territory.id } });
    }
    growth.sections.find(section => section.id === 'tournament')?.items.push({ label: '创建竞技赛房间', action: 'room.create', payload: { mode: 'tournament' }, disabled: competition.tournament?.status !== 'active' });
    const social = socialView(world, actor);
    growth.sections=presentSections(this.content,stageFilterSections({...ctx,social},growth.sections));
    const names = presentationNames(this.content);
    const assets = new Set([...Object.keys(actor.inventory), ...Object.keys(actor.cards), ...Object.keys(actor.warehouse ?? {}), ...Object.values(actor.equipment ?? {}),
      ...social.trades.map(row => row.goods?.id), ...social.auctions.map(row => row.goods?.id), ...social.mail.map(row => row.attachment?.id)].filter(Boolean));
    const assetNames = Object.fromEntries(Array.from(assets, id => [id, names[id] ?? (id.includes(':item:') ? `物品 #${id.split(':').at(-1)}` : `卡牌 #${id.split(':').at(-1)}`)]));
    return { stageScope:STAGE_SCOPE,serverInstance:this.instanceId,revision: world.revision, now: this.clock(), day: nowDay(this.clock()), actor: { ...actor, tutorialReady:[true,actor.stats.deckEdits>0,actor.stats.battles>0,actor.stats.pveWins>0][actor.tutorialStep]===true,deckIssues:stageDeckIssues(actor,this.content.tables), deckCapacity: Number(actorLevel.DeckCapacity) }, battle, league, assetNames, ...playerUi(this.content, assets),
      story: String(this.content.table('stringres').find(row => row.ID === 10100)?.des ?? ''),
      scenes: this.content.sceneSummary(actor).filter(scene=>stageSceneAllowed(this.content.tables,scene.id)), tasks: [...this.tasks(actor),...mainlineTaskCards(this.content,actor,pve)], growth, pve, social,
      roomInvites: Object.values(world.roomInvites ?? {}).filter(invite => invite.to === actor.id && invite.expires > this.clock() && world.rooms[invite.roomId]?.status === 'waiting'),
      rooms: Object.values(world.rooms).filter(room => room.status === 'waiting' || (room.members.includes(actor.id) && !world.battles[room.battleId]?.dismissed.includes(actor.id))),
      rankings: Object.values(world.characters).map(char => ({ id: char.id, name: char.name, level: char.level, rating: char.rating, wins: char.wins, losses: char.losses }))
        .sort((a, b) => b.rating - a.rating),
      dungeons: this.content.table('scene/fubens').filter(row => typeof row['副本ID'] === 'number'&&(stageDungeonAllowed(this.content.tables,row['简单'])||stageDungeonAllowed(this.content.tables,row['普通']))).map(row => ({
        id: row['副本ID'], name: row['名称'], easy: row['简单'], normal: row['普通'], hard: null })) };
  }
  tick() {
    const now = this.clock();
    return this.store.scheduled(world => {
      const social = tickSocial(world, now); const growth = tickGrowth(world, this.content.tables, now);
      const pve = tickPve(world, this.content.tables, now); const league = tickLeague(world, this.content.tables, now);
      let battles = false;
      for (const record of Object.values(world.battles)) if (!record.settled && record.state.players[record.state.activePlayer]?.ai) {
        record.state = advanceAI(this.content, record.state); this.settle(world, record, now); battles = true;
      }
      return social || growth || pve || league || battles;
    });
  }
}
