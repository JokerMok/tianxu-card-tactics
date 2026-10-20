import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { RecoveredContent } from '../../cocos-client/assets/scripts/game/RecoveredContent.ts';
import { reconstructMissingScenes } from './scene-compatibility.mjs';

const folder = path.resolve('cocos-client/assets/resources/recovered');
const catalog = JSON.parse(readFileSync(path.join(folder, 'catalog.json'), 'utf8'));
const tables = {};
for (const [key, entry] of Object.entries(catalog.tables)) {
  if (key.startsWith('main:')) tables[key.slice(5)] = JSON.parse(readFileSync(path.join(folder, entry.path), 'utf8')).rows;
}

const missing = [4603, 4703, 4803, 4903, 5003, 5116, 5117, 5118, 5119, 5120, 5121, 5122, 5123, 6301,
  6402, 6403, 6502, 6503, 6602, 6603, 6702, 6703];

test('reconstructs every configured dungeon scene gap as an isolated runnable graph', () => {
  const originalSceneCount = catalog.scopes.main.scenes.length;
  const originalIds = catalog.scopes.main.scenes.map(scene => scene.id);
  const { scenes, provenance } = reconstructMissingScenes({ catalog, tables });

  assert.equal(catalog.scopes.main.scenes.length, originalSceneCount);
  assert.deepEqual(catalog.scopes.main.scenes.map(scene => scene.id), originalIds);
  assert.deepEqual(scenes.map(scene => Number(scene.header.id)).sort((a, b) => a - b), [...missing].sort((a, b) => a - b));
  assert.equal(provenance.length, 22);
  assert.equal(new Set(scenes.map(scene => scene.id)).size, 22);

  const runtimeCatalog = structuredClone(catalog);
  runtimeCatalog.scopes.main.scenes.push(...structuredClone(scenes));
  const content = new RecoveredContent(runtimeCatalog);
  const sourceMonsters = runtimeCatalog.scopes.main.monsters;

  for (const scene of scenes) {
    assert.equal(scene.reconstructed, true);
    assert.match(scene.sourceTemplateSceneId, /^main:scene:\d+$/);
    assert.ok(scene.reconstructionReason.startsWith('LOCAL:'));
    assert.ok(scene.nodes.every(row => row._row.startsWith(`reconstructed_row:${scene.header.id}:`)));
    assert.ok(scene.nodes.every(row => !row._path || row._path.startsWith(`/Scene[${scene.header.id}]`)));

    const graph = content.graph(scene.id);
    assert.ok(graph.nodes.some(node => node.id === graph.startNodeId));
    const battle = graph.nodes.flatMap(node => node.triggers.map(trigger => ({ node, trigger })))
      .find(({ trigger }) => Number(trigger.raw.type) === 2);
    assert.ok(battle, `${scene.id} has a battle trigger`);
    const params = battle.trigger.children.filter(row => row._tag === 'param');
    if (scene.board) {
      assert.equal(scene.id, 'main:scene:6301');
      assert.equal(params.length, 0);
      assert.ok(sourceMonsters[String(scene.board.monsterId)]);
    } else {
      assert.equal(params.length, 2);
      assert.ok(params.every(row => sourceMonsters[String(row.id)]), `${scene.id} uses recovered monsters`);
    }
    const mapId = Number(battle.node.raw.battleid);
    assert.ok(runtimeCatalog.scopes.main.maps[String(mapId)]?.layoutRows.length, `${scene.id} uses a recovered map`);
  }
});

test('uses source dungeon reward entries and preserves the two recovered progressions', () => {
  const { scenes } = reconstructMissingScenes({ catalog, tables });
  const byId = new Map(scenes.map(scene => [Number(scene.header.id), scene]));
  const fubens = tables['embeddata/scp/scene/fubens.xml'];

  for (const sceneId of missing) {
    const scene = byId.get(sceneId);
    const entry = fubens.find(row => ['简单', '普通', '困难'].some(key => Number(row[key]) === sceneId));
    const difficulty = ['简单', '普通', '困难'].find(key => Number(entry[key]) === sceneId);
    assert.equal(scene.rewardPreviewId, Number(entry[`${difficulty}副本奖励预览ID(FubenPrizePreview.xml)`]));
    const trigger = scene.nodes.find(row => row._tag === 'Trigger' && Number(row.type) === 2);
    assert.equal(Number(trigger.sourceRewardPreviewId), scene.rewardPreviewId);
  }

  let previousSilver = 740;
  for (let index = 0; index < 5; index++) {
    const scene = byId.get(4603 + index * 100);
    const trigger = scene.nodes.find(row => row._tag === 'Trigger' && Number(row.type) === 2);
    const params = scene.nodes.filter(row => row._tag === 'param').map(row => Number(row.id));
    assert.deepEqual(params, [68410 + index * 2, 68411 + index * 2]);
    assert.ok(Number(trigger.silverprize) > previousSilver);
    assert.equal(Number(trigger.randomgroupprize), 394 + index);
    const multiplier = Number((1.15 ** (index + 1)).toFixed(4));
    assert.deepEqual(scene.combatScaling, { hpMultiplier: multiplier, attackMultiplier: multiplier,
      sourceBaselineSceneId: 'main:scene:4503' });
    assert.ok(scene.nodes.filter(row => row._tag === 'param')
      .every(row => Number(row.hpMultiplier) === multiplier && Number(row.attackMultiplier) === multiplier));
    previousSilver = Number(trigger.silverprize);
  }

  assert.deepEqual(byId.get(5116).nodes.filter(row => row._tag === 'param').map(row => Number(row.id)), [590039, 590040]);
  assert.deepEqual(byId.get(6703).nodes.filter(row => row._tag === 'param').map(row => Number(row.id)), [590073, 590074]);
  assert.equal(byId.get(5116).sourceTemplateSceneId, 'main:scene:5124');
  assert.equal(byId.get(5117).sourceTemplateSceneId, 'main:scene:5125');
});

test('is idempotent when the runtime catalog already contains every reconstruction', () => {
  const runtimeCatalog = structuredClone(catalog);
  const first = reconstructMissingScenes({ catalog: runtimeCatalog, tables });
  runtimeCatalog.scopes.main.scenes.push(...first.scenes);
  const snapshot = structuredClone(runtimeCatalog.scopes.main.scenes);
  const second = reconstructMissingScenes({ catalog: runtimeCatalog, tables });
  assert.deepEqual(second, { scenes: [], provenance: [] });
  assert.deepEqual(runtimeCatalog.scopes.main.scenes, snapshot);
});
