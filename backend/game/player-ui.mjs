import { readFileSync } from 'node:fs';
import path from 'node:path';
import { presentationNames } from './presentation.mjs';
import { presentationText } from '../../cocos-client/assets/scripts/game/GameText.ts';
import { stageRewardAllowed, legacyClaimKey } from './stage-policy.mjs';

/** Project existing source chapter tasks into the original task window contract.
 * Readiness, grants and claims remain owned by pve-systems; this adds no rules. */
export function mainlineTaskCards(content, actor, pve) {
  const names = presentationNames(content), seen = new Set();
  return (pve.groups ?? []).flatMap(group => group.tasks).filter(task => {
    const id = Number(task.id), chapter = id - 100;
    const retained = id === 1 || (chapter >= 1 && chapter <= 19 && actor.progress.unlockedScenes.includes(chapter));
    if (!retained || !task.eligible || seen.has(id)) return false;
    seen.add(id); return true;
  }).map(task => {
    const reward = task.reward ?? {}, parts = [];
    const legacy = actor.stageScope?.claims?.[legacyClaimKey('task.claim', {taskId:Number(task.id)})];
    for (const [key, label] of [['xp','经验'], ['gold','金币'], ['crystal','晶石']]) {
      if (Number(reward[key]) > 0) parts.push(`${reward[key]}${label}`);
    }
    if (Number(reward.cardId) > 0 && Number(reward.cardCount) > 0 && (legacy || stageRewardAllowed(content.tables,'card',reward.cardId))) {
      parts.push(`${names['main:card:'+reward.cardId] ?? '卡牌 #'+reward.cardId}×${reward.cardCount}`);
    }
    for (const item of reward.items ?? []) if (Number(item.count) > 0 && (legacy || stageRewardAllowed(content.tables,'item',item.id))) {
      parts.push(`${names['main:item:'+item.id] ?? '物品 #'+item.id}×${item.count}`);
    }
    const objective = task.progress.map(item => `${presentationText(item.detail)} ${Math.min(item.value,item.required)}/${item.required}`).join('\n');
    return {id:String(task.id),name:presentationText(task.name),detail:objective+(parts.length?'\n'+parts.join(' · '):''),
      ready:Boolean(task.ready),claimed:Boolean(task.claimed),reward:Number(reward.silver ?? 0)};
  });
}

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
