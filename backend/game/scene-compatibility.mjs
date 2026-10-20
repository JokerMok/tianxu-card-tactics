// Explicit local reconstruction for configured dungeon scenes whose XML files are
// absent from the recovered source. Callers append the returned scenes to a
// cloned runtime catalog; this module never mutates recovered catalog or tables.

const TOME_TARGETS = [4603, 4703, 4803, 4903, 5003];

const FESTIVAL_TARGETS = Object.freeze({
  5116: { template: 5124, mapId: 813, monsters: [590039, 590040] },
  5117: { template: 5125, mapId: 813, monsters: [590041, 590042] },
  5118: { template: 5124, mapId: 820, monsters: [590043, 590044] },
  5119: { template: 5125, mapId: 820, monsters: [590045, 590046] },
  5120: { template: 5124, mapId: 821, monsters: [590047, 590048] },
  5121: { template: 5125, mapId: 821, monsters: [590049, 590050] },
  5122: { template: 5124, mapId: 815, monsters: [590051, 590052] },
  5123: { template: 5125, mapId: 815, monsters: [590053, 590054] },
  6402: { template: 5124, mapId: 822, monsters: [590059, 590060] },
  6403: { template: 5125, mapId: 822, monsters: [590061, 590062] },
  6502: { template: 5124, mapId: 823, monsters: [590063, 590064] },
  6503: { template: 5125, mapId: 823, monsters: [590065, 590066] },
  6602: { template: 5124, mapId: 824, monsters: [590067, 590068] },
  6603: { template: 5125, mapId: 824, monsters: [590069, 590070] },
  6702: { template: 5124, mapId: 825, monsters: [590071, 590072] },
  6703: { template: 5125, mapId: 825, monsters: [590073, 590074] },
});

function table(tables, logicalPath) {
  const wanted = logicalPath.toLowerCase();
  for (const [key, value] of Object.entries(tables ?? {})) {
    const normalized = key.replace(/^(main|media):/, '').toLowerCase();
    if (normalized === wanted) return Array.isArray(value) ? value : value?.rows ?? [];
  }
  return [];
}

function numeric(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function rewritePrefixed(value, from, to) {
  if (typeof value !== 'string' && typeof value !== 'number') return value;
  const text = String(value), prefix = String(from);
  if (!text.startsWith(prefix) || !/^\d+$/.test(text)) return value;
  const rewritten = `${to}${text.slice(prefix.length)}`;
  return typeof value === 'number' ? Number(rewritten) : rewritten;
}

function cloneScene(template, targetId, { logicalPath, name, reason }) {
  const sourceId = numeric(template.header.id);
  const rows = template.nodes.map((source, index) => {
    const row = structuredClone(source);
    for (const key of ['id', 'startid', 'keyid', 'from', 'to', 'deckid', 'baiguaiid']) {
      if (row[key] !== undefined) row[key] = rewritePrefixed(row[key], sourceId, targetId);
    }
    if (typeof row._path === 'string') row._path = row._path.replace(/^\/Scene\[1\]/, `/Scene[${targetId}]`);
    row._row = `reconstructed_row:${targetId}:${index}`;
    return row;
  });
  const header = rows.find(row => row._tag === 'Scene');
  header.id = String(targetId);
  header.name = name;
  return {
    id: `main:scene:${targetId}`,
    logicalPath,
    header,
    nodes: rows,
    reconstructed: true,
    sourceTemplateSceneId: template.id,
    reconstructionReason: reason,
  };
}

function dungeonDescriptor(fubens, sceneId) {
  for (const row of fubens) {
    for (const difficulty of ['简单', '普通', '困难']) {
      if (numeric(row[difficulty]) !== sceneId) continue;
      const rewardPreviewId = numeric(row[`${difficulty}副本奖励预览ID(FubenPrizePreview.xml)`]);
      return { row, difficulty, rewardPreviewId };
    }
  }
  throw new Error(`Configured dungeon entry is absent for reconstructed scene ${sceneId}`);
}

function replaceEncounter(scene, { mapId, monsters, rewardPreviewId }) {
  const battleNode = scene.nodes.find(row => row._tag === 'pathpoint' && numeric(row.battleid) > 0);
  const trigger = scene.nodes.find(row => row._tag === 'Trigger' && numeric(row.type) === 2);
  if (!battleNode || !trigger) throw new Error(`Template cannot create a battle for ${scene.id}`);
  battleNode.battleid = String(mapId);
  // Preview 75..95 and recovered random groups 713..733 have a stable +638
  // relation, anchored by the source-complete scenes 5124/5125 (83/84 -> 721/722).
  if (rewardPreviewId > 0) trigger.randomgroupprize = String(rewardPreviewId + 638);
  trigger.sourceRewardPreviewId = rewardPreviewId;

  const oldParams = scene.nodes.filter(row => row._tag === 'param' && String(row._path).startsWith(`${trigger._path}/`));
  scene.nodes = scene.nodes.filter(row => !oldParams.includes(row));
  monsters.forEach((monsterId, index) => scene.nodes.push({
    id: String(monsterId),
    deckid: `${scene.header.id}01${String(index + 1).padStart(3, '0')}`,
    _row: `reconstructed_row:${scene.header.id}:param:${index}`,
    _tag: 'param',
    _path: `${trigger._path}/param[${index + 1}]`,
  }));
}

function nameFor(descriptor) {
  const suffix = descriptor.difficulty === '普通' ? '（普通）' : descriptor.difficulty === '困难' ? '（困难）' : '（简单）';
  return `${descriptor.row['名称']}${suffix}`;
}

export function reconstructMissingScenes({ catalog, tables, scope = 'main' }) {
  if (scope !== 'main') return { scenes: [], provenance: [] };
  const sourceScenes = catalog?.scopes?.main?.scenes;
  if (!Array.isArray(sourceScenes)) throw new Error('Main recovered scenes are unavailable');
  const sceneRows = table(tables, 'embeddata/scp/scene/scenes.xml');
  const fubens = table(tables, 'embeddata/scp/scene/fubens.xml');
  const configured = new Map(sceneRows.map(row => [numeric(row.ID), row]));
  const byId = new Map(sourceScenes.map(scene => [numeric(scene.header.id), scene]));
  const scenes = [], provenance = [];

  const add = (targetId, templateId, options, reason) => {
    if (byId.has(targetId)) return null;
    const template = byId.get(templateId);
    const config = configured.get(targetId);
    if (!template || !config) throw new Error(`Cannot reconstruct scene ${targetId}: template or scene configuration is absent`);
    const descriptor = dungeonDescriptor(fubens, targetId);
    const logicalPath = `embeddata/scp/scene/${String(config['场景文件']).toLowerCase()}`;
    const scene = cloneScene(template, targetId, { logicalPath, name: nameFor(descriptor), reason });
    replaceEncounter(scene, { ...options, rewardPreviewId: descriptor.rewardPreviewId });
    scene.rewardPreviewId = descriptor.rewardPreviewId;
    scene.difficulty = descriptor.difficulty;
    scenes.push(scene);
    provenance.push({ sceneId: scene.id, sourceTemplateSceneId: template.id, reconstructed: true,
      reconstructionReason: reason, rewardPreviewId: descriptor.rewardPreviewId, sourceSceneFile: config['场景文件'] });
    return scene;
  };

  TOME_TARGETS.forEach((targetId, index) => {
    const step = index + 1;
    const scene = add(targetId, 4503, {
      mapId: 98,
      monsters: [68410 + index * 2, 68411 + index * 2],
    }, `LOCAL: Tome Hall ${step + 5} extends source-complete Tome Hall 5 with the next two recovered 684xx encounter rows.`);
    if (!scene) return;
    const trigger = scene.nodes.find(row => row._tag === 'Trigger' && numeric(row.type) === 2);
    trigger.randomgroupprize = String(394 + index);
    trigger.silverprize = String(820 + index * 80);
    trigger.expprize = String(151 + index * 15);
    const multiplier = Number((1.15 ** step).toFixed(4));
    scene.combatScaling = { hpMultiplier: multiplier, attackMultiplier: multiplier, sourceBaselineSceneId: 'main:scene:4503' };
    for (const param of scene.nodes.filter(row => row._tag === 'param')) {
      param.hpMultiplier = String(multiplier);
      param.attackMultiplier = String(multiplier);
    }
    provenance.at(-1).combatScaling = structuredClone(scene.combatScaling);
  });

  for (const [target, options] of Object.entries(FESTIVAL_TARGETS)) {
    add(Number(target), options.template, options,
      'LOCAL: missing seasonal XML inherits the source-complete 2026 festival graph for the same difficulty; map, encounter rows, and reward preview come from recovered adjacent configuration.');
  }

  // Fubens type 2 is explicitly “no blue side”, matching the source-complete
  // board-clear scene family. Preserve that topology and expose its board rule
  // so the runtime can instantiate it without inventing a conventional hero.
  const boardScene = add(6301, 2501, { mapId: 28, monsters: [] },
    'LOCAL: Fubens marks Eternal Continent as type 2 (no blue side), so it uses the source-complete board-clear topology from scene 2501.');
  if (boardScene) {
    boardScene.board = { monsterId: 9119, count: 9, sourceTemplateSceneId: 'main:scene:2501', sourceSemantics: 'fubens-type-2-no-blue-side' };
    provenance.at(-1).board = structuredClone(boardScene.board);
  }

  return { scenes, provenance };
}
