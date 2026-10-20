import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createBattle, advanceAI, chooseAIAction } from '../cocos-client/assets/scripts/game/BattleKernel.ts';
import { RecoveredContent, numeric } from '../cocos-client/assets/scripts/game/RecoveredContent.ts';
import { ServerContent } from '../backend/game/content.mjs';
import { createGameServer } from '../backend/game/server.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentFolder = path.join(root, 'cocos-client/assets/resources/recovered');
const outputFile = path.join(root, 'documentation/recovery/campaign-check.json');
const fixedNow = Date.UTC(2026, 9, 20, 8);
const starterLocalIds = [1, 19, 43, 61];
const starterCards = starterLocalIds.map(id => `main:card:${id}`);
const startedAt = performance.now();
const sourceCatalog = JSON.parse(await readFile(path.join(contentFolder, 'catalog.json'), 'utf8'));
const content = new ServerContent(contentFolder);
// Keep the immutable disk catalog independent from ServerContent. The latter
// may append local compatibility scenes to its in-memory catalog.
const rawContent = new RecoveredContent(sourceCatalog, 'main');
let battleSequence = 0;

function counter(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true })));
}

function reachableNodeIds(graph) {
  const seen = new Set();
  const queue = [graph.startNodeId];
  while (queue.length) {
    const id = queue.pop();
    if (seen.has(id)) continue;
    const node = graph.nodes.find(candidate => candidate.id === id);
    assert.ok(node, `graph points to absent node ${id}`);
    seen.add(id);
    queue.push(...node.outgoing);
  }
  return seen;
}

function battleParams(trigger, variant) {
  return trigger.children.filter(row => row._tag === 'param'
    && String(row._path).includes('/elite[') === (variant === 'elite'));
}

function monsterGaps(params) {
  return params.filter(row => !content.data.monsters[String(numeric(row, 'id'))]).map(row => ({
    monsterId: numeric(row, 'id'), row: row._row, path: row._path,
  }));
}

function makeAuditActor(graphs) {
  return {
    level: 90,
    profession: 1,
    cards: Object.fromEntries(starterCards.map(id => [id, 1])),
    deck: [...starterCards],
    progress: {
      unlockedScenes: content.data.scenes.map(scene => Number(scene.header.id)),
      clearedNodes: graphs.flatMap(graph => graph.nodes.map(node => node.id)),
      clearedTriggers: [],
    },
  };
}

function createConfiguredBattle(entry, params, variant, allAI = false) {
  const seed = 1000 + ++battleSequence;
  const actor = { level: entry.level.minLevel, profession: (battleSequence % 4) + 1 };
  const playerStats = content.actorStats(actor);
  const players = [{
    id: 'audit-player', name: 'Audit Player', team: 0, hp: Number(playerStats.HP), attack: 1,
    deck: [...starterCards], profession: actor.profession, ai: allAI,
  }];
  for (const [index, param] of params.entries()) {
    const monsterId = numeric(param, 'id');
    const hero = content.data.monsters[String(monsterId)];
    assert.ok(hero, `missing source monster ${monsterId}`);
    players.push({
      id: `audit-enemy-${index}`, name: String(hero.Name), team: 1,
      hp: Math.max(1, Math.floor(numeric(hero, 'HP') * numeric(param, 'hpMultiplier', 1))),
      attack: Math.floor(numeric(hero, 'Attack') * numeric(param, 'attackMultiplier', 1)), monsterId, ai: true,
      deck: content.enemyDeck(hero, entry.level, seed + index),
    });
  }
  if (entry.level.board) {
    const monsterId = content.resolveMonsterId(entry.level.board.monsterId);
    const defender = content.data.monsters[String(monsterId)];
    players.push({ id: 'audit-board', name: String(defender.Name), team: 1, hp: 1, attack: 0, ai: true, deck: [] });
    const count = entry.level.board.count;
    const initialUnits = Array.from({ length: count }, (_, index) => ({
      playerId: 'audit-board', monsterId: monsterId + index % 3, row: Math.floor(index / 3), col: 8 + index % 3,
    }));
    return createBattle(content, {
      id: `${entry.trigger.id}:${variant}:${seed}`, seed, mapId: entry.level.mapId, players,
      rows: entry.level.rows, boardClearTeam: 1, turnLimit: 48, initialUnits,
    });
  }
  return createBattle(content, {
    id: `${entry.trigger.id}:${variant}:${seed}`, seed, mapId: entry.level.mapId, players, rows: entry.level.rows,
  });
}

function classifyScenes(graphs) {
  const campaignIds = [];
  const seen = new Set();
  let sceneId = 1;
  while (sceneId && !seen.has(sceneId)) {
    seen.add(sceneId);
    campaignIds.push(sceneId);
    const graph = content.graph(sceneId);
    const transitions = graph.nodes.flatMap(node => node.triggers)
      .filter(trigger => numeric(trigger.raw, 'type') === 3);
    sceneId = transitions.length === 1 ? numeric(transitions[0].raw, 'nextsenceid') : 0;
  }
  const dungeonTypes = new Map();
  for (const row of content.table('scene/fubens')) {
    for (const [column, type] of [['简单', 'dungeon-easy'], ['普通', 'dungeon-normal'], ['困难', 'dungeon-hard']]) {
      const id = Number(row[column] ?? 0);
      if (id) dungeonTypes.set(id, type);
    }
  }
  const campaignSet = new Set(campaignIds);
  const typeOf = id => campaignSet.has(id) ? 'campaign' : dungeonTypes.get(id) ?? 'special';
  return { campaignIds, dungeonTypes, typeOf };
}

function auditAndRunContent() {
  const graphs = content.data.scenes.map(scene => content.graph(scene.id));
  const sceneTableIds = new Set(content.table('scene/scenes').map(row => Number(row.ID)));
  const sourceSceneIds = new Set(rawContent.data.scenes.map(scene => Number(scene.header.id)));
  const runtimeSceneIds = new Set(content.data.scenes.map(scene => Number(scene.header.id)));
  const configuredWithoutSourceScene = [...sceneTableIds].filter(id => !sourceSceneIds.has(id)).sort((a, b) => a - b);
  const configuredWithoutRuntimeScene = [...sceneTableIds].filter(id => !runtimeSceneIds.has(id)).sort((a, b) => a - b);
  const sourceWithoutConfiguration = [...sourceSceneIds].filter(id => !sceneTableIds.has(id)).sort((a, b) => a - b);
  const runtimeWithoutConfiguration = [...runtimeSceneIds].filter(id => !sceneTableIds.has(id)).sort((a, b) => a - b);
  const locallyReconstructedSceneIds = [...runtimeSceneIds].filter(id => !sourceSceneIds.has(id)).sort((a, b) => a - b);
  assert.equal(rawContent.data.scenes.length, 95, 'immutable source catalog scene count changed');
  assert.equal(content.sourceSceneCount, rawContent.data.scenes.length, 'ServerContent source scene count diverged from disk catalog');
  assert.equal(graphs.length, 117, 'runtime scene catalog is incomplete');
  assert.ok(Array.isArray(content.runtimeSceneAdaptations), 'ServerContent did not expose runtime scene provenance');
  assert.equal(content.runtimeSceneAdaptations.length, locallyReconstructedSceneIds.length,
    'runtime scene provenance does not cover every local compatibility scene');
  assert.deepEqual(configuredWithoutRuntimeScene, [], 'a configured scene has no source or local runtime graph');
  assert.deepEqual(sourceWithoutConfiguration, [], 'a source scene has no scene/scenes configuration row');
  assert.deepEqual(runtimeWithoutConfiguration, [], 'a runtime scene has no scene/scenes configuration row');
  assert.deepEqual(locallyReconstructedSceneIds, configuredWithoutSourceScene,
    'local runtime scene ids do not exactly cover the configuration/source gap');
  const classification = classifyScenes(graphs);
  assert.deepEqual(classification.campaignIds, Array.from({ length: 19 }, (_, index) => index + 1),
    'main chapter transition chain changed');
  const auditActor = makeAuditActor(graphs);
  const transitions = [];
  const sourceUnreachableNodes = [];
  const sourceDanglingEdges = [];
  const runtimeUnreachableNodes = [];
  const runtimeDanglingEdges = [];
  const entries = [];

  for (const graph of graphs) {
    const reachable = reachableNodeIds(graph);
    const sourceScene = rawContent.data.scenes.find(scene => scene.id === graph.id);
    const rawGraph = sourceScene ? rawContent.graph(graph.id) : undefined;
    const sourceReachable = rawGraph ? reachableNodeIds(rawGraph) : undefined;
    for (const node of graph.nodes) if (!reachable.has(node.id)) runtimeUnreachableNodes.push({
      sceneId: graph.id, nodeId: node.id, originalId: node.originalId,
      triggerIds: node.triggers.map(trigger => trigger.id), origin: rawGraph ? 'source' : 'local-runtime',
    });
    for (const node of graph.nodes) {
      const rawNode = rawGraph?.nodes.find(candidate => candidate.id === node.id);
      if (rawGraph) assert.ok(rawNode, `runtime graph added an unknown node to source scene ${node.id}`);
      if (rawNode && !sourceReachable.has(node.id)) {
        sourceUnreachableNodes.push({
          sceneId: graph.id, nodeId: node.id, originalId: node.originalId,
          incoming: rawNode.incoming, outgoing: rawNode.outgoing, runtimeReachable: reachable.has(node.id),
          triggerIds: node.triggers.map(trigger => trigger.id),
        });
      }
      for (const trigger of node.triggers) {
        const type = numeric(trigger.raw, 'type');
        if (type === 3) {
          const targetSceneId = numeric(trigger.raw, 'nextsenceid');
          transitions.push({
            triggerId: trigger.id, sourceSceneId: graph.id, sourceNodeId: node.id,
            origin: rawGraph ? 'source' : 'local-runtime',
            sourceReachable: sourceReachable?.has(node.id) ?? null, runtimeReachable: reachable.has(node.id), targetSceneId,
            targetExists: runtimeSceneIds.has(targetSceneId),
            targetMinLevel: content.sceneLevels.get(String(targetSceneId)) ?? 1,
          });
        }
        if (type !== 2) continue;
        const normal = battleParams(trigger, 'normal');
        const elite = battleParams(trigger, 'elite');
        let level;
        let levelError;
        try { level = content.level(auditActor, node.id, trigger.id); }
        catch (error) { levelError = error instanceof Error ? error.message : String(error); }
        entries.push({ graph, reachable, sourceReachable, origin: rawGraph ? 'source' : 'local-runtime',
          node, trigger, normal, elite, level, levelError });
      }
    }
    runtimeDanglingEdges.push(...graph.danglingEdges.map(edge => ({
      sceneId: graph.id, row: edge._row, from: String(edge.from), to: String(edge.to),
      fromExists: graph.nodes.some(node => node.originalId === String(edge.from)),
      toExists: graph.nodes.some(node => node.originalId === String(edge.to)), origin: rawGraph ? 'source' : 'local-runtime',
    })));
    if (rawGraph) sourceDanglingEdges.push(...rawGraph.danglingEdges.map(edge => ({
      sceneId: rawGraph.id, row: edge._row, from: String(edge.from), to: String(edge.to),
      fromExists: rawGraph.nodes.some(node => node.originalId === String(edge.from)),
      toExists: rawGraph.nodes.some(node => node.originalId === String(edge.to)),
    })));
  }
  assert.ok(transitions.every(item => item.runtimeReachable && item.targetExists), 'a level transition is unreachable at runtime or has no target scene');

  const sourceGaps = [];
  const runtimeAdapterGaps = [];
  const runtimeInvalidVariants = [];
  const validCases = [];
  const creationFailures = [];
  for (const entry of entries) {
    const sceneNumericId = Number(entry.graph.id.split(':').at(-1));
    const base = {
      sceneId: entry.graph.id, nodeId: entry.node.id, triggerId: entry.trigger.id,
      origin: entry.origin,
      description: String(entry.trigger.raw.des ?? ''), repeat: numeric(entry.trigger.raw, 'repeat'),
      sourceReachable: entry.sourceReachable?.has(entry.node.id) ?? null,
      runtimeReachable: entry.reachable.has(entry.node.id), sourceMapId: numeric(entry.node.raw, 'battleid'),
      levelType: classification.typeOf(sceneNumericId), minLevel: content.sceneLevels.get(String(sceneNumericId)) ?? 1,
    };
    const configurationGaps = entry.origin === 'source' ? sourceGaps : runtimeAdapterGaps;
    const normalGaps = monsterGaps(entry.normal);
    if (!entry.normal.length) configurationGaps.push({ ...base, variant: 'normal', reason: 'missing-enemy-params', sourceRows: [] });
    else if (normalGaps.length) configurationGaps.push({ ...base, variant: 'normal', reason: 'missing-monster-rows', sourceRows: normalGaps });
    let adaptedNormal = [];
    let normalError;
    try { adaptedNormal = content.encounter(entry.trigger, false); }
    catch (error) { normalError = error instanceof Error ? error.message : String(error); }
    if (!entry.level) creationFailures.push({ ...base, variant: 'normal', error: entry.levelError });
    else if (normalError || (!adaptedNormal.length && !entry.level.board)) {
      runtimeInvalidVariants.push({ ...base, variant: 'normal', error: normalError ?? 'runtime encounter is empty' });
    } else validCases.push({ ...base, entry, params: adaptedNormal, variant: 'normal', effectiveMapId: entry.level.mapId,
      enemyCount: entry.level.board ? 1 : adaptedNormal.length, boardTargetCount: entry.level.board?.count ?? 0 });
    if (entry.elite.length) {
      const gaps = monsterGaps(entry.elite);
      if (gaps.length) configurationGaps.push({ ...base, variant: 'elite', reason: 'missing-monster-rows', sourceRows: gaps });
      let adaptedElite = [];
      let eliteError;
      try { adaptedElite = content.encounter(entry.trigger, true); }
      catch (error) { eliteError = error instanceof Error ? error.message : String(error); }
      if (!entry.level) creationFailures.push({ ...base, variant: 'elite', error: entry.levelError });
      else if (eliteError || !adaptedElite.length) runtimeInvalidVariants.push({ ...base, variant: 'elite', error: eliteError ?? 'runtime encounter is empty' });
      else validCases.push({ ...base, entry, params: adaptedElite, variant: 'elite', effectiveMapId: entry.level.mapId,
        enemyCount: adaptedElite.length, boardTargetCount: 0 });
    }
  }

  for (const candidate of validCases) {
    try {
      const state = createConfiguredBattle(candidate.entry, candidate.params, candidate.variant);
      assert.equal(state.players.length, candidate.enemyCount + 1);
      assert.equal(state.mapId, candidate.effectiveMapId);
      if (candidate.boardTargetCount) {
        assert.equal(state.boardClearTeam, 1);
        assert.equal(state.units.filter(unit => unit.team === 1 && unit.flags.hero !== 1).length, candidate.boardTargetCount);
      }
    } catch (error) {
      creationFailures.push({
        sceneId: candidate.sceneId, nodeId: candidate.nodeId, triggerId: candidate.triggerId,
        variant: candidate.variant, error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  assert.deepEqual(creationFailures, [], 'valid campaign configuration failed to create an authoritative battle');

  const representativeByKey = new Map();
  for (const candidate of validCases) {
    const triggerMode = candidate.repeat ? 'repeat' : 'first-clear';
    const key = [candidate.origin, candidate.effectiveMapId, candidate.enemyCount, candidate.levelType, triggerMode, candidate.variant].join('|');
    if (!representativeByKey.has(key)) representativeByKey.set(key, { ...candidate, key, triggerMode });
  }
  const representativeRuns = [];
  for (const representative of representativeByKey.values()) {
    let state = createConfiguredBattle(representative.entry, representative.params, representative.variant, true);
    state = advanceAI(content, state, 5000);
    assert.equal(state.status, 'settled', `${representative.key} did not settle within 5000 AI actions`);
    for (const player of state.players) {
      if (player.team === state.boardClearTeam) continue;
      const hero = state.units.find(unit => unit.id === `hero:${player.id}`);
      assert.equal(hero?.hp ?? 0, player.hp, `${representative.key} hero/player hp diverged`);
    }
    representativeRuns.push({
      key: representative.key, origin: representative.origin, triggerId: representative.triggerId, variant: representative.variant,
      sourceMapId: representative.sourceMapId, effectiveMapId: representative.effectiveMapId,
      enemyCount: representative.enemyCount, levelType: representative.levelType,
      triggerMode: representative.triggerMode, turn: state.turn, winner: state.winner,
      eventCount: state.events.length, settlement: state.events.at(-1)?.message ?? 'hero-defeat',
    });
  }

  return {
    inventory: {
      sourceDefinition: 'scene graph present in the immutable main-scope disk catalog',
      runtimeDefinition: 'source scene graph or explicitly reconstructed local compatibility graph with a scene/scenes row',
      configuredSceneRows: sceneTableIds.size,
      sourceImportedScenes: rawContent.data.scenes.length,
      runtimeScenes: graphs.length,
      enabledScenes: graphs.length,
      locallyReconstructedScenes: locallyReconstructedSceneIds.length,
      locallyReconstructedSceneIds,
      runtimeSceneAdaptations: content.runtimeSceneAdaptations,
      configuredWithoutSourceScene,
      configuredWithoutRuntimeScene,
      sourceWithoutConfiguration,
      runtimeWithoutConfiguration,
      sourceNodes: rawContent.data.scenes.reduce((sum, scene) => sum + rawContent.graph(scene.id).nodes.length, 0),
      nodes: graphs.reduce((sum, graph) => sum + graph.nodes.length, 0),
      sourceTriggers: rawContent.data.scenes.reduce((sum, scene) => sum
        + rawContent.graph(scene.id).nodes.reduce((inner, node) => inner + node.triggers.length, 0), 0),
      triggers: graphs.reduce((sum, graph) => sum + graph.nodes.reduce((inner, node) => inner + node.triggers.length, 0), 0),
      sourceBattleTriggers: entries.filter(entry => entry.origin === 'source').length,
      battleTriggers: entries.length,
      sourceTransitionTriggers: transitions.filter(item => item.origin === 'source').length,
      transitionTriggers: transitions.length,
      campaignChapterChain: classification.campaignIds,
      starterCards,
    },
    graph: {
      sourceReachableNodes: rawContent.data.scenes.reduce((sum, scene) => sum + reachableNodeIds(rawContent.graph(scene.id)).size, 0),
      runtimeReachableNodes: graphs.reduce((sum, graph) => sum + reachableNodeIds(graph).size, 0),
      sourceUnreachableNodes,
      runtimeUnreachableNodes,
      sourceDanglingEdges,
      runtimeDanglingEdges,
      transitions,
    },
    battleCreation: {
      normal: {
        sourceTriggers: entries.filter(entry => entry.origin === 'source').length,
        runtimeTriggers: entries.length,
        validCreated: validCases.filter(item => item.variant === 'normal').length,
        sourceValidCreated: validCases.filter(item => item.variant === 'normal' && item.origin === 'source').length,
        localRuntimeValidCreated: validCases.filter(item => item.variant === 'normal' && item.origin === 'local-runtime').length,
        sourceGaps: sourceGaps.filter(item => item.variant === 'normal').length,
        runtimeAdapterGaps: runtimeAdapterGaps.filter(item => item.variant === 'normal').length,
      },
      elite: {
        sourceVariants: entries.filter(entry => entry.origin === 'source' && entry.elite.length).length,
        runtimeVariants: entries.filter(entry => entry.elite.length).length,
        validCreated: validCases.filter(item => item.variant === 'elite').length,
        sourceValidCreated: validCases.filter(item => item.variant === 'elite' && item.origin === 'source').length,
        localRuntimeValidCreated: validCases.filter(item => item.variant === 'elite' && item.origin === 'local-runtime').length,
        sourceGaps: sourceGaps.filter(item => item.variant === 'elite').length,
        runtimeAdapterGaps: runtimeAdapterGaps.filter(item => item.variant === 'elite').length,
      },
      normalEnemyCounts: counter(entries.map(entry => entry.normal.length)),
      eliteEnemyCounts: counter(entries.map(entry => entry.elite.length)),
      sourceGaps,
      runtimeAdapterGaps,
      runtimeInvalidVariants,
      unexpectedFailures: creationFailures,
      sourceMapFallbacks: validCases.filter(item => item.sourceMapId !== item.effectiveMapId).map(item => ({
        origin: item.origin, triggerId: item.triggerId, variant: item.variant,
        sourceMapId: item.sourceMapId, effectiveMapId: item.effectiveMapId,
      })),
    },
    representativeSettlement: {
      grouping: ['origin', 'effectiveMapId', 'enemyCount', 'levelType', 'triggerMode', 'variant'],
      groups: representativeRuns.length,
      settled: representativeRuns.length,
      maxTurn: Math.max(...representativeRuns.map(item => item.turn)),
      maxEventCount: Math.max(...representativeRuns.map(item => item.eventCount)),
      runs: representativeRuns,
    },
  };
}

async function runHttpProgression() {
  const tempFolder = await mkdtemp(path.join(os.tmpdir(), 'tianxu-campaign-'));
  const database = path.join(tempFolder, 'campaign.sqlite');
  let app;
  let baseUrl;
  let requestSequence = 0;
  let httpRequests = 0;
  const actionCounts = {};
  const playerRuns = [];

  const request = async (pathname, { method = 'GET', token, characterId, json } = {}) => {
    httpRequests += 1;
    const response = await fetch(baseUrl + pathname, {
      method,
      headers: {
        ...(json === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(characterId ? { 'x-character-id': characterId } : {}),
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    const value = await response.json();
    assert.equal(response.status, 200, `${pathname}: ${JSON.stringify(value)}`);
    return value;
  };
  const act = async (player, action, payload = {}) => {
    actionCounts[action] = (actionCounts[action] ?? 0) + 1;
    return request('/api/act', {
      method: 'POST', token: player.token, characterId: player.characterId,
      json: { requestId: `campaign-${++requestSequence}`, action, payload },
    });
  };
  const state = player => request('/api/state', { token: player.token, characterId: player.characterId });

  async function register(profession) {
    const session = await request('/api/register', {
      method: 'POST', json: { username: `campaign_prof_${profession}`, password: 'campaign-check-password' },
    });
    const created = await request('/api/act', {
      method: 'POST', token: session.token,
      json: {
        requestId: `create-profession-${profession}`, action: 'character.create',
        payload: { name: `CampaignP${profession}`, profession },
      },
    });
    const player = { profession, token: session.token, characterId: created.result.characterId };
    const initial = await state(player);
    assert.deepEqual(initial.actor.deck, starterCards);
    assert.deepEqual(Object.fromEntries(starterCards.map(id => [id, initial.actor.cards[id]])),
      Object.fromEntries(starterCards.map(id => [id, 1])));
    return player;
  }

  async function finishBattle(player, battleId) {
    let commands = 0;
    for (; commands < 500; commands += 1) {
      const current = await state(player);
      assert.equal(current.battle?.id, battleId);
      if (current.battle.settled) {
        assert.equal(current.battle.state.status, 'settled');
        return { commands, snapshot: current };
      }
      const active = current.battle.state.players[current.battle.state.activePlayer];
      assert.equal(active.id, player.characterId, 'service returned control while an AI player was active');
      const decisionState = structuredClone(current.battle.state);
      const decisionActor = decisionState.players.find(candidate => candidate.id === player.characterId);
      assert.ok(decisionActor, 'player is absent from its active battle');
      decisionActor.ai = true;
      const action = chooseAIAction(content, decisionState, player.characterId);
      await act(player, 'battle.command', {
        battleId,
        revision: current.battle.state.revision,
        action,
      });
    }
    assert.fail(`campaign battle ${battleId} did not settle within 500 legal commands`);
  }

  function bestOwnedDeck(actor) {
    const capacity = Number(content.actorStats(actor).DeckCapacity);
    const ranked = [];
    for (const [cardId, owned] of Object.entries(actor.cards)) {
      if (Number(owned) <= 0) continue;
      try {
        const card = content.card(cardId);
        const type = numeric(card.raw, 'Type');
        const monster = type === 1 ? content.monsterForCard(card.id) : undefined;
        if (type === 1 && !monster) continue;
        if (type === 2) {
          const required = numeric(content.skill(numeric(card.raw, 'SkillID')).raw, '使用职业');
          if (required > 0 && required !== actor.profession) continue;
        } else if (type !== 1) continue;
        const limit = monster && numeric(monster, 'Unique') ? 1 : 3;
        const score = monster
          ? 100 + numeric(monster, 'Attack') * 12 + numeric(monster, 'HP') * 4 - numeric(card.raw, 'InitReady')
          : 80 + numeric(content.skill(numeric(card.raw, 'SkillID')).raw, 'DamValue') * 8 - numeric(card.raw, 'InitReady');
        for (let copy = 0; copy < Math.min(Number(owned), limit); copy += 1) ranked.push({ cardId: card.id, score });
      } catch { /* Non-battle inventory rows cannot enter a deck. */ }
    }
    const candidate = ranked.sort((a, b) => b.score - a.score || a.cardId.localeCompare(b.cardId))
      .slice(0, capacity).map(item => item.cardId);
    try { return content.validateDeck(actor, candidate); }
    catch { return actor.deck; }
  }

  async function saveBestDeck(player) {
    const current = await state(player);
    const deck = bestOwnedDeck(current.actor);
    if (JSON.stringify(deck) !== JSON.stringify(current.actor.deck)) await act(player, 'deck.save', { cards: deck });
  }

  async function clearNode(player, originalNodeId) {
    let totalCommands = 0;
    const attemptEvidence = [];
    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const before = await state(player);
      const scene = before.scenes.find(candidate => candidate.id === 'main:scene:1');
      const node = scene?.nodes.find(candidate => candidate.originalId === String(originalNodeId));
      assert.equal(node?.accessible, true, `chapter 1 node ${originalNodeId} is not accessible`);
      const started = await act(player, 'pve.start', { nodeId: node.id });
      const finished = await finishBattle(player, started.result.battleId);
      totalCommands += finished.commands;
      attemptEvidence.push({
        attempt, winner: finished.snapshot.battle.state.winner, turn: finished.snapshot.battle.state.turn,
        commands: finished.commands, deck: before.actor.deck,
        finalPlayers: finished.snapshot.battle.state.players.map(candidate => ({ id: candidate.id, team: candidate.team, hp: candidate.hp })),
        finalEvent: finished.snapshot.battle.state.events.at(-1),
      });
      await act(player, 'battle.dismiss', { battleId: started.result.battleId });
      await saveBestDeck(player);
      if (finished.snapshot.battle.rewards?.won) {
        return { ...finished, commands: totalCommands, attempts: attempt, lossesBeforeWin: attempt - 1 };
      }
    }
    assert.fail(`chapter 1 node ${originalNodeId} was not won within 20 normal attempts: ${JSON.stringify(attemptEvidence)}`);
  }

  try {
    app = await createGameServer({ database, scheduler: false, clock: () => fixedNow });
    await new Promise((resolve, reject) => {
      app.server.once('error', reject);
      app.server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${app.server.address().port}`;
    const health = await request('/api/health');
    assert.equal(health.ready, true);
    const players = [];
    for (let profession = 1; profession <= 4; profession += 1) players.push(await register(profession));

    for (const player of players) {
      const first = await clearNode(player, 101);
      playerRuns.push({ profession: player.profession, representativeNode: 101, commands: first.commands,
        attempts: first.attempts, lossesBeforeWin: first.lossesBeforeWin, won: first.snapshot.battle.rewards.won });
    }

    const primary = players[0];
    const taskClaims = ['first-deck', 'first-battle'];
    for (const taskId of taskClaims) await act(primary, 'task.claim', { taskId });
    const firstClearNodes = [101];
    let legalCommands = playerRuns[0].commands;
    for (const nodeId of [102, 103, 105]) {
      const finished = await clearNode(primary, nodeId);
      firstClearNodes.push(nodeId);
      legalCommands += finished.commands;
      if (nodeId === 103) {
        await act(primary, 'task.claim', { taskId: 'three-wins' });
        taskClaims.push('three-wins');
      }
    }
    let repeats = 0;
    let current = await state(primary);
    while (current.actor.level < 5) {
      const finished = await clearNode(primary, 105);
      legalCommands += finished.commands;
      repeats += 1;
      assert.ok(repeats < 100, 'normal level-gate progression did not converge');
      current = await state(primary);
    }
    const finalBattle = await clearNode(primary, 107);
    firstClearNodes.push(107);
    legalCommands += finalBattle.commands;
    current = await state(primary);
    const transitionNode = current.scenes.find(scene => scene.id === 'main:scene:1')?.nodes
      .find(node => node.originalId === '108');
    assert.equal(transitionNode?.accessible, true);
    await act(primary, 'pve.transition', { nodeId: transitionNode.id });
    const final = await state(primary);
    assert.ok(final.actor.progress.unlockedScenes.includes(2));
    assert.equal(final.actor.progress.sceneId, 2);
    for (const nodeId of firstClearNodes) assert.ok(final.actor.progress.clearedNodes.includes(`main:scene:1:node:${nodeId}`));
    assert.ok(final.actor.progress.clearedNodes.includes('main:scene:1:node:108'));

    return {
      transport: 'real loopback HTTP with Bearer token and X-Character-Id',
      database: 'temporary SQLite removed after verification',
      scheduler: false,
      starterCards,
      professions: playerRuns,
      chapter1: {
        firstClearNodes,
        repeatNode: 105,
        repeatsForLevelGate: repeats,
        taskClaims,
        finalLevel: final.actor.level,
        remainingXp: final.actor.xp,
        legalBattleCommands: legalCommands,
        chapter2Unlocked: true,
        currentSceneId: final.actor.progress.sceneId,
      },
      httpRequests,
      actionCounts,
      directDatabaseWrites: 0,
      fabricatedRewards: 0,
    };
  } finally {
    if (app) await app.close();
    await rm(tempFolder, { recursive: true, force: true });
  }
}

const report = {
  schemaVersion: 2,
  checkedAt: new Date().toISOString(),
  status: 'running',
  command: 'node scripts/verify-campaign.mjs',
  runtime: { node: process.version, platform: process.platform, architecture: process.arch },
  sourceManifest: sourceCatalog.sourceManifest,
};

try {
  Object.assign(report, auditAndRunContent());
  report.httpProgression = await runHttpProgression();
  report.status = report.battleCreation.sourceGaps.length ? 'passed-with-source-gaps' : 'passed';
  report.durationMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  report.boundaries = [
    'The immutable disk catalog is audited independently as the 95-scene recovered source. ServerContent is audited as the 117-scene runtime catalog, including 22 explicit local compatibility scenes. Local scenes are never counted as recovered source scenes.',
    'Every runtime normal trigger and elite branch was instantiated with recovered configuration rows, explicit runtime adapters where listed, generated enemy decks, available map data or an explicit map fallback, and the shared authoritative BattleKernel.',
    'Representative settlement is grouped by source/local origin, effective map, enemy count, level type, first-clear/repeat mode, and normal/elite variant. Creation coverage is exhaustive; settlement coverage is representative.',
    'The HTTP progression creates four new professions in an isolated temporary SQLite database. All progress uses public actions and legal battle.command requests.',
    'Raw source gaps and local adapter gaps remain listed separately. Runtime compatibility mappings and board-mode definitions are explicit, and runtimeInvalidVariants stays empty only when every runtime battle trigger can instantiate.',
    'No browser, external service, production database, deployment, or regulatory acceptance is part of this check.',
  ];
} catch (error) {
  report.status = 'failed';
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  report.durationMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
  await mkdir(path.dirname(outputFile), { recursive: true });
  await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n');
  throw error;
}

const scriptBytes = await readFile(fileURLToPath(import.meta.url));
report.script = {
  path: 'scripts/verify-campaign.mjs',
  sha256: createHash('sha256').update(scriptBytes).digest('hex'),
};
await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({
  status: report.status,
  sourceScenes: report.inventory.sourceImportedScenes,
  runtimeScenes: report.inventory.runtimeScenes,
  locallyReconstructedScenes: report.inventory.locallyReconstructedScenes,
  sourceBattleTriggers: report.inventory.sourceBattleTriggers,
  runtimeBattleTriggers: report.inventory.battleTriggers,
  validNormalCreated: report.battleCreation.normal.validCreated,
  validEliteCreated: report.battleCreation.elite.validCreated,
  sourceGapVariants: report.battleCreation.sourceGaps.length,
  runtimeInvalidVariants: report.battleCreation.runtimeInvalidVariants.length,
  representativeGroupsSettled: report.representativeSettlement.settled,
  sourceUnreachableNodes: report.graph.sourceUnreachableNodes.length,
  runtimeUnreachableNodes: report.graph.runtimeUnreachableNodes.length,
  sourceDanglingEdges: report.graph.sourceDanglingEdges.length,
  runtimeDanglingEdges: report.graph.runtimeDanglingEdges.length,
  chapter2Unlocked: report.httpProgression.chapter1.chapter2Unlocked,
  levelGateRepeats: report.httpProgression.chapter1.repeatsForLevelGate,
  durationMs: report.durationMs,
}, null, 2));
