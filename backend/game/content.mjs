import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { MISSING_MONSTERS, BOARD_SCENES, FALLBACK_MAP } from './compatibility.mjs';
import { reconstructMissingScenes } from './scene-compatibility.mjs';
import { RecoveredContent, numeric } from '../../cocos-client/assets/scripts/game/RecoveredContent.ts';

export class ServerContent extends RecoveredContent {
  constructor(folder, {localizationFolder=path.join(folder, '../localization')}={}) {
    super(JSON.parse(readFileSync(path.join(folder, 'catalog.json'), 'utf8')));
    this.folder = folder;
    const localization = path.join(localizationFolder,'game-zh.json');
    if (existsSync(localization)) this.catalog.localization=JSON.parse(readFileSync(localization,'utf8'));
    this.tables = {};
    for (const [key, table] of Object.entries(this.catalog.tables)) {
      if (key.startsWith('main:')) this.tables[key.slice(5)] = JSON.parse(readFileSync(path.join(folder, table.path), 'utf8')).rows;
    }
    this.sourceSceneCount = this.data.scenes.filter(scene => !scene.reconstructed).length;
    const reconstructed = reconstructMissingScenes({ catalog: this.catalog, tables: this.tables });
    this.data.scenes.push(...reconstructed.scenes);
    this.runtimeSceneAdaptations = reconstructed.provenance;
    this.catalog.runtimeAdaptations = { scenes: reconstructed.provenance };
    this.descriptions = new Map(this.table('taskdes').map(row => [Number(row.ID), String(row.des ?? '')]));
    this.actorLevels = this.table('actorlevelinfo').filter(row => typeof row.Level === 'number');
    this.maxLevel = Math.max(100, this.actorLevels.length);
    this.lastLevelCost = [...this.actorLevels].reverse().find(row => Number(row.NextLevlExp) > 0)?.NextLevlExp ?? 112300;
    this.sceneLevels = new Map(this.table('scene/scenes').filter(row => typeof row.ID === 'number')
      .map(row => [String(row.ID), Number(row['可进入最小等级(1级开始)'] ?? 1)]));
    this.commonCards = Object.values(this.data.cards).filter(card => numeric(card.raw, 'Type') === 1
      && numeric(card.raw, 'MonsterID') > 0 && !/废弃/.test(String(card.raw.Name)) && numeric(card.raw, 'Quality') === 0 && numeric(card.raw, 'Race') <= 11);
  }
  table(name) { return this.tables[`embeddata/scp/${name.toLowerCase()}.xml`] ?? []; }
  actorStats(actor) {
    const source = this.actorLevels.find(row => row.Level === actor.level - 1);
    if (source && Number(source.NextLevlExp) > 0) return source;
    const last = this.actorLevels.at(-1), extra = Math.max(0, actor.level - this.actorLevels.length);
    return { ...last, Level: actor.level - 1, HP: Number(last.HP) + extra,
      NextLevlExp: actor.level >= this.maxLevel ? 0 : Math.round(Number(this.lastLevelCost) * 1.1 ** extra) };
  }
  validateDeck(actor, deck) {
    const capacity = Number(this.actorStats(actor).DeckCapacity);
    if (!Array.isArray(deck) || deck.length < Math.min(4, capacity) || deck.length > capacity) throw new Error(`卡组需要${Math.min(4, capacity)}至${capacity}张卡牌`);
    const counts = {};
    for (const id of deck) {
      const card = this.card(id);
      const monster = this.monsterForCard(id);
      const type = numeric(card.raw, 'Type');
      if (type === 1 && !monster) throw new Error('特殊英雄卡不能加入卡组');
      if (type !== 1 && type !== 2) throw new Error('此类卡牌不能加入卡组');
      if (type === 2) {
        const skill = this.skill(numeric(card.raw, 'SkillID'));
        const required = numeric(skill.raw, '使用职业');
        if (required > 0 && required !== actor.profession) throw new Error('卡牌职业不符');
      }
      counts[id] = (counts[id] ?? 0) + 1;
      if (counts[id] > (actor.cards[id] ?? 0)) throw new Error('卡牌持有数量不足');
      if (counts[id] > (monster && numeric(monster, 'Unique') ? 1 : 3)) throw new Error('同名卡牌超出允许数量');
    }
    return [...deck];
  }
  sceneSummary(actor) {
    return this.data.scenes.map(scene => {
      const graph = this.graph(scene.id);
      return { id: scene.id, name: String(scene.header.name), minLevel: this.sceneLevels.get(String(scene.header.id)) ?? 1,
        unlocked: actor.progress.unlockedScenes.includes(Number(scene.header.id)),
        nodes: graph.nodes.map(node => ({ id: node.id, originalId: node.originalId,
          name: String(node.triggers[0]?.raw.des ?? (node.id === graph.startNodeId ? '起点' : '道路')),
          story: this.descriptions.get(numeric(node.raw, 'backgrounddesid')) ?? '',
          x: numeric(node.raw, 'x'), y: numeric(node.raw, 'y'),
          cleared: actor.progress.clearedNodes.includes(node.id),
          accessible: this.nodeAccessible(actor, graph, node),
          battle: node.triggers.some(trigger => numeric(trigger.raw, 'type') === 2),
          transitions: node.triggers.filter(trigger => numeric(trigger.raw, 'type') === 3).map(trigger => numeric(trigger.raw, 'nextsenceid')),
          triggers: node.triggers.map(trigger => ({ id: trigger.id, name: String(trigger.raw.des ?? ''), repeat: numeric(trigger.raw, 'repeat') })) })) };
    });
  }
  nodeAccessible(actor, graph, node) {
    if (!actor.progress.unlockedScenes.includes(Number(graph.id.split(':').at(-1)))) return false;
    const reached = new Set([graph.startNodeId, ...actor.progress.clearedNodes]);
    // Paths without triggers can be crossed without inventing a battle/reward.
    for (let pass = 0; pass < graph.nodes.length; pass++) {
      let changed = false;
      for (const candidate of graph.nodes) {
        if (!candidate.triggers.length && candidate.incoming.some(id => reached.has(id)) && !reached.has(candidate.id)) {
          reached.add(candidate.id); changed = true;
        }
      }
      if (!changed) break;
    }
    return reached.has(node.id) || node.incoming.some(id => reached.has(id));
  }
  graph(sceneId) {
    const graph = super.graph(sceneId);
    graph.adaptations = [];
    const start = graph.nodes.find(node => node.id === graph.startNodeId);
    for (const node of graph.nodes) if (node !== start && !node.incoming.length && !node.outgoing.length && node.triggers.some(trigger => numeric(trigger.raw, 'type') === 2)) {
      start.outgoing.push(node.id); node.incoming.push(start.id);
      graph.adaptations.push({ kind: 'optional-orphan-route', from: start.id, to: node.id });
    }
    return graph;
  }
  resolveMonsterId(sourceId) {
    const id = this.data.monsters[String(sourceId)] ? Number(sourceId) : MISSING_MONSTERS[sourceId]?.id;
    if (!id || !this.data.monsters[String(id)]) throw new Error(`敌方配置缺失：${sourceId}`);
    return id;
  }
  encounter(trigger, elite = false) {
    const branch = elite ? trigger.children.find(row => row._tag === 'elite') : null;
    if (elite && !branch) throw new Error('此关没有精英分支');
    return trigger.children.filter(row => row._tag === 'param' && (branch ? row._path?.startsWith(branch._path + '/') : !row._path?.includes('/elite[')))
      .map(row => ({ ...row, sourceMonsterId: numeric(row, 'id'), id: this.resolveMonsterId(numeric(row, 'id')) }));
  }
  level(actor, nodeId, triggerId, allowCleared = false) {
    if (typeof nodeId !== 'string') throw new Error('请选择关卡');
    const sceneId = nodeId.split(':node:')[0];
    const graph = this.graph(sceneId);
    const node = graph.nodes.find(node => node.id === nodeId);
    if (!node || !this.nodeAccessible(actor, graph, node)) throw new Error('请先完成前置关卡');
    const minLevel = this.sceneLevels.get(sceneId.split(':').at(-1)) ?? 1;
    if (actor.level < minLevel) throw new Error(`需要角色等级${minLevel}`);
    const repeats = actor.progress.clearedNodes.includes(nodeId);
    const trigger = triggerId ? node.triggers.find(trigger => trigger.id === triggerId)
      : node.triggers.find(trigger => numeric(trigger.raw, 'type') === 2 && numeric(trigger.raw, 'repeat') === (repeats ? 1 : 0))
        ?? node.triggers.find(trigger => numeric(trigger.raw, 'type') === 2);
    if (!trigger || numeric(trigger.raw, 'type') !== 2) throw new Error('此节点不是战斗关卡');
    if (!allowCleared && actor.progress.clearedTriggers.includes(trigger.id) && numeric(trigger.raw, 'repeat') === 0) throw new Error('此关奖励已领取，请选择重复挑战或重置副本');
    const params = this.encounter(trigger);
    const board = BOARD_SCENES[Number(sceneId.split(':').at(-1))] ?? this.data.scenes.find(scene => scene.id === sceneId)?.board;
    if (!params.length && !board) throw new Error('关卡敌方配置缺失');
    let mapId = numeric(node.raw, 'battleid');
    // Two source map layouts are absent. Explicit compatible map selection stays outside raw data.
    if (!this.data.maps[String(mapId)]?.layoutRows.length) mapId = FALLBACK_MAP;
    return { board, rows: numeric(trigger.raw, 'battleheight') || undefined, sceneId, graph, node, trigger, params, mapId, minLevel };
  }
  enemyDeck(hero, level, seed) {
    const pool = this.commonCards.filter(card => {
      const monster = this.monsterForCard(card.id);
      return numeric(monster, 'Type') === 1 && numeric(monster, 'HP') <= 4 + level.minLevel * 3
        && numeric(monster, 'Attack') <= 1 + Math.floor(level.minLevel / 2)
        && (!numeric(hero, 'Phyle') || numeric(monster, 'Phyle') === numeric(hero, 'Phyle'));
    });
    const available = pool.length ? pool : this.commonCards.filter(card => {
      const monster = this.monsterForCard(card.id);
      return numeric(monster, 'Type') === 1 && numeric(monster, 'HP') <= 4 + level.minLevel * 3
        && numeric(monster, 'Attack') <= 1 + Math.floor(level.minLevel / 2);
    });
    if (!available.length) throw new Error('兼容敌方卡组池为空');
    const size = Math.min(24, 4 + Math.floor(level.minLevel / 3));
    const deck = [];
    let rng = seed >>> 0;
    for (let index = 0; index < size; index++) {
      rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0;
      deck.push(available[rng % available.length].id);
    }
    return deck;
  }
  grantExperience(actor, amount) {
    actor.xp += Math.max(0, amount);
    for (;;) {
      const row = this.actorStats(actor);
      const required = Number(row.NextLevlExp);
      if (!required || actor.xp < required || actor.level >= this.maxLevel) break;
      actor.xp -= required;
      actor.level++;
    }
  }
}
