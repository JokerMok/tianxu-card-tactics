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
