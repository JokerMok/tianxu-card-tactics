/** Local-version encounter design, not recovered original server decks.
 * Source card IDs/stats/effects and fixed heroes are unchanged. Only these three
 * ordinary nodes opt in; their actual decks/rules are persisted in entryState. */
export const PVE_TACTICS = Object.freeze({
  107: { theme: '哥布林弓手与前排推进', sourceDeckId: '107001', cards: [3001,3019,3037,3037] },
  203: { theme: '巨魔防线与重装推进', sourceDeckId: '203001', cards: [4001,4019,4019,4103,4001] },
  304: { theme: '亡灵重组与灵体输出', sourceDeckId: '304001', cards: [1001,1001,1019,1019,1127,1127,1379,1379,1103,1103,1001,1019] },
});
export function tacticsForNode(node) {
  const id = Number(node?.originalId);
  return node?.id === `main:scene:${Math.floor(id / 100)}:node:${id}` ? PVE_TACTICS[id] : undefined;
}

// New version exploration milestones, explicitly claimable for existing saves.
// Distinct cleared nodes count; repeating a single node cannot advance them.
export function explorationTasks(actor) {
  const nodes = [201,202,203,204,205,206,207,208];
  const cleared = nodes.filter(id => actor.progress.clearedNodes.includes(`main:scene:2:node:${id}`)).length;
  return [ [3,30], [6,45], [8,65] ].map(([count,xp]) => ({
    id: `explore-chapter2-${count}-v1`, name: `山道探索·${count}处`,
    detail: `完成第二章${count}个不同主线节点 ${Math.min(count,cleared)}/${count}`,
    ready: cleared >= count, reward: 0, xp,
  })).filter(task => actor.progress.unlockedScenes.includes(2));
}
