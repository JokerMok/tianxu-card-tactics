import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { ServerContent } from './content.mjs';
const content = new ServerContent(fileURLToPath(new URL('../../cocos-client/assets/resources/recovered/', import.meta.url)));

test('source level cap extends to enabled level-100 goals without altering recovered rows', () => {
  const raw = JSON.stringify(content.actorLevels);
  const actor = { level: 95, xp: 0 };
  assert.ok(content.actorStats(actor).NextLevlExp > 0);
  content.grantExperience(actor, 10_000_000);
  assert.equal(actor.level, 100);
  assert.equal(content.actorStats(actor).NextLevlExp, 0);
  assert.equal(content.actorStats(actor).HP, Number(content.actorLevels.at(-1).HP) + 5);
  assert.equal(JSON.stringify(content.actorLevels), raw);
});

test('explicit missing enemy adapters and optional source orphan routes retain original identity', () => {
  assert.equal(content.resolveMonsterId(61152), 60152);
  assert.equal(content.resolveMonsterId(5901010), 590110);
  const graph = content.graph('main:scene:703');
  const node = graph.nodes.find(node => node.originalId === '70301');
  assert.ok(node.incoming.includes(graph.startNodeId));
  assert.ok(graph.adaptations.some(item => item.to === node.id));
  const raw = content.data.scenes.find(scene => scene.id === graph.id);
  assert.equal(raw.nodes.some(row => row._tag === 'GraphEdge' && row.to === '70301'), false);
});

test('chapter-two story display keeps raw configuration and rejects stale source translations', () => {
  const graph = content.graph('main:scene:2');
  const before = JSON.stringify(graph);
  const nodes = graph.nodes.filter(node => node.triggers.some(trigger => Number(trigger.raw.type) === 2));
  assert.equal(nodes.length, 8);
  for (const node of nodes) {
    assert.match(content.sceneStory(node), /[\u4e00-\u9fff]/);
    const translation = content.catalog.localization.stories[node.id];
    const original = content.descriptions.get(Number(node.raw.backgrounddesid));
    assert.equal(translation.originalText, original);
    assert.equal(translation.status, 'candidate-translation');
  }
  const node = nodes[0], translation = content.catalog.localization.stories[node.id];
  const source = translation.originalText;
  try {
    translation.originalText = 'different source';
    assert.equal(content.sceneStory(node), source);
  } finally { translation.originalText = source; }
  assert.equal(JSON.stringify(graph), before);
});

 test('chapter-three display stories preserve source and use existing identity terms', () => {
  const graph = content.graph(3), raw = JSON.stringify(graph);
  const nodes = graph.nodes.filter(n => n.triggers.some(t => Number(t.raw.type) === 2));
  assert.equal(nodes.length, 8);
  for (const node of nodes) {
    const translation = content.catalog.localization.stories[node.id];
    assert.equal(translation.originalText, content.descriptions.get(Number(node.raw.backgrounddesid)));
    assert.match(content.sceneStory(node), /[\u4e00-\u9fff]/);
    assert.equal(translation.status, 'candidate-translation');
  }
  assert.match(content.sceneStory(nodes[0]), /半精灵/);
  assert.match(content.sceneStory(nodes[6]), /萨里亚/);
  assert.equal(JSON.stringify(graph), raw);
});

test('multi-encounter nodes expose remaining one-time source rewards before repeat play', () => {
  const graph = content.graph(3), node = graph.nodes.find(n => n.originalId === '301');
  const actor = {level:10, progress:{unlockedScenes:[3],clearedNodes:[],clearedTriggers:[]}};
  const first=content.level(actor,node.id);
  assert.equal(first.trigger.raw.id,'301001');
  actor.progress.clearedNodes.push(node.id);actor.progress.clearedTriggers.push(first.trigger.id);
  const second=content.level(actor,node.id);
  assert.equal(second.trigger.raw.id,'301002');
  assert.equal(second.trigger.raw.cardidprize,'5061');
  assert.equal(second.trigger.raw.cardnumprize,'4');
  actor.progress.clearedTriggers.push(second.trigger.id);
  assert.equal(content.level(actor,node.id).trigger.raw.id,'301003');
  assert.throws(()=>content.level(actor,node.id,first.trigger.id),/此关奖励已领取/);
  assert.throws(()=>content.level({...actor,level:9},node.id),/需要角色等级10/);
  const other=content.graph(2).nodes.find(n=>n.originalId==='201');
  actor.progress.unlockedScenes.push(2);actor.progress.clearedNodes.push(other.id);
  actor.progress.clearedTriggers.push(other.triggers[0].id);
  assert.equal(content.level(actor,other.id).trigger.raw.id,'201002');
});
