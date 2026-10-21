import { readFileSync } from 'node:fs';
import path from 'node:path';

const cache = new WeakMap();
/** Read-only source presentation metadata; never changes ownership or economic rules. */
export function playerUi(content, ids) {
  let metadata = cache.get(content);
  if (!metadata) {
    try { metadata = JSON.parse(readFileSync(path.join(content.folder, 'item-ui.json'), 'utf8')).items; }
    catch (error) { if (error.code !== 'ENOENT') throw error; metadata = {}; }
    cache.set(content, metadata);
  }
  const items = Object.fromEntries([...ids].filter(id => metadata[id]).map(id => [id, metadata[id]]));
  return { itemUi: items, assetIcons: Object.fromEntries(Object.values(items).filter(item => item.icon).map(item => [item.id, item.icon])) };
}
