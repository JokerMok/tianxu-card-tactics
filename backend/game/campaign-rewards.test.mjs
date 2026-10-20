import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { grantCampaignExtras } from './campaign-rewards.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const recovered = path.resolve(here, '../../cocos-client/assets/resources/recovered');
const catalog = JSON.parse(fs.readFileSync(path.join(recovered, 'catalog.json'), 'utf8'));
const tables = {};
for (const [key, entry] of Object.entries(catalog.tables)) {
  if (key.startsWith('main:')) tables[key.slice(5).toLowerCase()] = JSON.parse(fs.readFileSync(path.join(recovered, entry.path), 'utf8')).rows;
}

function setup(id = 'a', randomInt = () => 0) {
  const actor = { id, level: 20, xp: 0, currencies: { silver: 0, gold: 0, crystal: 0 }, inventory: {}, cards: {}, economicLog: [], growth: { reputation: {} } };
  return { actor, ctx: { actor, tables, now: 1_700_000_000_000, randomInt, content: { grantExperience(target, amount) { target.xp += amount; } } } };
}
const won = (actorId = 'a', sceneId = 'main:scene:2501') => ({ level: { sceneId, nodeId: `${sceneId}:node:end`, triggerId: 't', elite: false }, participants: [actorId], state: { winner: 0 } });
const finalNode = { outgoing: [] };

test('grants source reputation and the no-blue dungeon 2501 preview into real balances', () => {
  const { ctx, actor } = setup();
  const record = won();
  const result = grantCampaignExtras(ctx, record, { eligible: true, node: finalNode,
    trigger: { raw: { reputationtype: 2, reputationvalue: 7, reputationminlevel: 10, reputationmaxlevel: 30 } } });
  assert.deepEqual(result.reputation, [{ type: 2, value: 7 }]);
  assert.equal(actor.growth.reputation[2], 7);
  assert.equal(result.preview.previewId, 31);
  assert.equal(result.items[0].itemId, 'main:item:3313');
  assert.equal(actor.inventory['main:item:3313'], 1);
  assert.ok(actor.economicLog.some(entry => entry.asset === 'reputation:2'));
});

test('supports no-blue preview 35 and 36 mappings from recovered source columns', () => {
  for (const [sceneId, previewId, itemId] of [[2502, 35, 30001], [2503, 36, 32001]]) {
    const { ctx, actor } = setup();
    const result = grantCampaignExtras(ctx, won('a', `main:scene:${sceneId}`), { eligible: true, node: finalNode, trigger: { raw: {} } });
    assert.equal(result.preview.previewId, previewId);
    assert.equal(actor.inventory[`main:item:${itemId}`], 1);
  }
});

test('is idempotent and failed or ineligible settlements never grant later', () => {
  const { ctx, actor } = setup();
  const record = won();
  grantCampaignExtras(ctx, record, { eligible: true, node: finalNode, trigger: { raw: { reputationtype: 1, reputationvalue: 5 } } });
  grantCampaignExtras(ctx, record, { eligible: true, node: finalNode, trigger: { raw: { reputationtype: 1, reputationvalue: 5 } } });
  assert.equal(actor.growth.reputation[1], 5);

  const failed = won(); failed.state.winner = 1;
  grantCampaignExtras(ctx, failed, { eligible: true, node: finalNode, trigger: { raw: { reputationtype: 1, reputationvalue: 5 } } });
  assert.equal(actor.growth.reputation[1], 5);

  const deferred = won();
  grantCampaignExtras(ctx, deferred, { eligible: false, node: finalNode, trigger: { raw: { reputationtype: 1, reputationvalue: 5 } } });
  grantCampaignExtras(ctx, deferred, { eligible: true, node: finalNode, trigger: { raw: { reputationtype: 1, reputationvalue: 5 } } });
  assert.equal(actor.growth.reputation[1], 5);
});

test('tracks the same source battle independently for actors with different settlement eligibility', () => {
  const first = setup('a'), second = setup('b');
  const record = won('a'); record.participants.push('b');
  grantCampaignExtras(first.ctx, record, { eligible: true, node: finalNode, trigger: { raw: { reputationtype: 3, reputationvalue: 9 } } });
  grantCampaignExtras(second.ctx, record, { eligible: false, node: finalNode, trigger: { raw: { reputationtype: 3, reputationvalue: 9 } } });
  assert.equal(first.actor.growth.reputation[3], 9);
  assert.equal(second.actor.growth.reputation[3], undefined);
  assert.deepEqual(record.campaignExtraActors, ['a', 'b']);
});

test('filters invalid source preview entries before uniform selection', () => {
  const { ctx, actor } = setup('a', length => length - 1);
  ctx.tables = { ...tables, 'embeddata/scp/scene/fubens.xml': [{ 简单: 9901, '简单副本奖励预览ID(FubenPrizePreview.xml)': 1 }],
    'embeddata/scp/scene/fubenprizepreview.xml': [
      { '一号类型(1银币2金币3卡片4道具5塔币6活动点）': 3, '一号ID（卡片ID 道具ID 其他填0)': 999999, '一号数量（货币数量 道具数量)': 1 },
      { '一号类型(1银币2金币3卡片4道具5塔币6活动点）': 4, '一号ID（卡片ID 道具ID 其他填0)': 999999, '一号数量（货币数量 道具数量)': 1 },
      { '一号类型(1银币2金币3卡片4道具5塔币6活动点）': 3, '一号ID（卡片ID 道具ID 其他填0)': 3044, '一号数量（货币数量 道具数量)': 1 }
    ] };
  const result = grantCampaignExtras(ctx, won('a', 'main:scene:9901'), { eligible: true, node: finalNode, trigger: { raw: {} } });
  assert.deepEqual(result.cards, [{ cardId: 'main:card:3044', count: 1 }]);
  assert.equal(actor.cards['main:card:3044'], 1);
  assert.equal(actor.cards['main:card:999999'], undefined);
  assert.equal(actor.inventory['main:item:999999'], undefined);
});

test('elite rewards add to base random group and reputation level gates apply', () => {
  const { ctx, actor } = setup();
  const record = won('a', 'main:scene:1'); record.level.elite = true;
  const trigger = { raw: { randomgroupprize: 10, reputationtype: 4, reputationvalue: 3, reputationminlevel: 21, reputationmaxlevel: 30 },
    children: [{ _tag: 'elite', silverprize: 11, expprize: 4, randomgroupprize: 250, reputationtype: 5, reputationvalue: 6, reputationminlevel: 1, reputationmaxlevel: 20 }] };
  const result = grantCampaignExtras(ctx, record, { eligible: true, node: { outgoing: ['next'] }, trigger });
  assert.equal(result.randomGroups.length, 2);
  assert.equal(result.currencies.silver, 11);
  assert.equal(actor.currencies.silver, 11);
  assert.equal(actor.xp, 4);
  assert.deepEqual(result.reputation, [{ type: 5, value: 6 }]);
  assert.ok(Object.keys(actor.inventory).some(key => actor.inventory[key] > 0));
});
