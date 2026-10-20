import { strict as assert } from 'node:assert';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { RecoveredContent, numeric } from '../cocos-client/assets/scripts/game/RecoveredContent.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const folder = path.join(root, 'cocos-client/assets/resources/recovered');
const bytes = await readFile(path.join(folder, 'catalog.json'));
const report = JSON.parse(await readFile(path.join(folder, 'import-report.json'), 'utf8'));
assert.equal(createHash('sha256').update(bytes).digest('hex'), report.catalogHash, 'catalog/import report mismatch');
const catalog = JSON.parse(bytes);
const output = { sourceManifest: catalog.sourceManifest, scopes: {}, tableFilesVerified: 0,
  metadataChecksPassed: false, assetsRuntimeValidated: false, gameplayValidated: false };
for (const [key, table] of Object.entries(catalog.tables)) {
  assert(!table.path.includes('..') && !path.isAbsolute(table.path), `unsafe table path ${key}`);
  const raw = await readFile(path.join(folder, table.path));
  assert.equal(createHash('sha256').update(raw).digest('hex'), table.sha256, `table changed: ${key}`);
  const data = JSON.parse(raw);
  assert.equal(data.rows.length, table.rows, `table row count ${key}`);
  assert.equal(data.scope, key.split(':')[0], `table scope ${key}`);
  output.tableFilesVerified++;
}
for (const scope of ['main', 'media']) {
  const content = new RecoveredContent(catalog, scope);
  const stats = { cards: Object.keys(content.data.cards).length, monsters: Object.keys(content.data.monsters).length,
    skills: Object.keys(content.data.skills).length, maps: Object.keys(content.data.maps).length,
    scenes: content.data.scenes.length, nodes: 0, triggers: 0, unreachableNodes: [],
    danglingEdges: [], missingCardMonsterRows: [], missingCardSkillRows: [],
    unmatchedCardArt: 0, unmatchedCardModels: 0, cardsWithoutModelReference: 0,
    sourceUnmatchedCardModels: 0, sourceCardsWithoutModelReference: 0, missingMapLayouts: [] };
  for (const card of Object.values(content.data.cards)) {
    assert.equal(content.card(card.id), card);
    assert.throws(() => content.card(card.id.replace(`${scope}:`, `${scope === 'main' ? 'media' : 'main'}:`)));
    const type = numeric(card.raw, 'Type');
    if (type === 1 && numeric(card.raw, 'MonsterID') > 0 && !content.monsterForCard(card.id)) stats.missingCardMonsterRows.push(card.id);
    if (type === 2 && !content.data.skills[String(numeric(card.raw, 'SkillID'))]?.raw) stats.missingCardSkillRows.push(card.id);
    if (card.artResolution !== 'matched') stats.unmatchedCardArt++;
    if (card.modelResolution === 'unmatched') stats.unmatchedCardModels++;
    if (card.modelResolution === 'no_reference') stats.cardsWithoutModelReference++;
    if (card.sourceModelResolution === 'unmatched') stats.sourceUnmatchedCardModels++;
    if (card.sourceModelResolution === 'no_reference') stats.sourceCardsWithoutModelReference++;
  }
  for (const scene of content.data.scenes) {
    const graph = content.graph(scene.id);
    stats.nodes += graph.nodes.length;
    stats.triggers += graph.nodes.reduce((count, node) => count + node.triggers.length, 0);
    stats.danglingEdges.push(...graph.danglingEdges.map(edge => ({ scene: graph.id, row: edge._row,
      from: String(edge.from), to: String(edge.to) })));
    const seen = new Set();
    const queue = [graph.startNodeId];
    while (queue.length) {
      const next = queue.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      const node = graph.nodes.find(item => item.id === next);
      assert(node, `missing graph node ${next}`);
      queue.push(...node.outgoing);
    }
    stats.unreachableNodes.push(...graph.nodes.filter(node => !seen.has(node.id)).map(node => node.id));
  }
  for (const map of Object.values(content.data.maps)) {
    if (!map.layoutRows.length) { stats.missingMapLayouts.push(map.id); continue; }
    const grid = content.mapGrid(map.map_id);
    assert(grid.tileWidth > 0 && grid.tileHeight > 0);
    assert.equal(grid.columns, 12);
    assert.equal(grid.rows, 4);
  }
  assert.deepEqual(stats.missingCardMonsterRows, [], 'import lost monster rows');
  assert.deepEqual(stats.missingCardSkillRows, [], 'import lost card skill rows');
  output.scopes[scope] = stats;
}
assert.deepEqual(new RecoveredContent(catalog).mapGrid(1), {
  columns: 12, rows: 4, tileWidth: 90, tileHeight: 95, originX: 60, originY: 45,
});
assert.equal(report.unresolved.length, 0, 'importer reported file failures');
output.metadataChecksPassed = true;
await mkdir(path.join(root, 'documentation/recovery'), { recursive: true });
await writeFile(path.join(root, 'documentation/recovery/content-check.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ metadataChecksPassed: true, tableFilesVerified: output.tableFilesVerified,
  scopes: Object.fromEntries(Object.entries(output.scopes).map(([key, value]) => [key,
    Object.fromEntries(Object.entries(value).map(([name, item]) => [name, Array.isArray(item) ? item.length : item]))])),
  assetsRuntimeValidated: false, gameplayValidated: false }, null, 2));
