import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ServerContent } from './content.mjs';
import { presentationNames, presentSections } from './presentation.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const content = new ServerContent(path.resolve(here, '../../cocos-client/assets/resources/recovered'));

test('source asset names cover all item id key variants and cards and are cached', () => {
  const names = presentationNames(content);
  assert.equal(names['main:item:2'], 'Class Selection Crystal', 'medicament uses 物品ID');
  assert.equal(names['main:item:60'], 'Halfblood Soul Fragment', 'warrant uses 物品ID');
  assert.equal(names['main:item:10001'], 'Crown of Trials', 'equipment uses the newline-suffixed 物品ID key');
  assert.equal(names['main:card:1'], 'Guard');
  assert.ok(Object.keys(names).length > 1_000);
  assert.equal(presentationNames(content), names, 'the same content instance reuses its source-name map');
});

test('section presentation replaces object names without changing actions, parameters, or amounts', () => {
  const sections = [{
    id: 'presentation-fixture',
    title: '展示适配',
    items: [
      {
        label: '出售 main:item:60',
        detail: '出售 1 件换取 60 银币',
        action: 'inventory.sell',
        payload: { itemId: 'main:item:60', count: 1 },
        disabled: false,
      },
      {
        label: '制造装备 10001，手续费 3 银币',
        detail: '消耗 3 件，价格 10001 银币',
        action: 'equipment.craft',
        payload: { itemId: 'main:item:10001', count: 3 },
      },
      {
        label: '合成 main:card:1',
        detail: '持有 3 张，消耗 3 张',
        action: 'magic.synthesize',
        payload: { cardId: 'main:card:1', count: 3 },
        fields: [{
          key: 'materialCardId', label: '材料卡 ID', type: 'text', value: 'main:card:1',
          options: [
            { label: 'main:card:1 · 品质0', value: 'main:card:1', cardId: 'main:card:1', quality: 0 },
            { label: '1 · 品质0', value: 'main:card:1', cardId: 'main:card:1', quality: 0 },
          ],
        }],
      },
      { label: '升级 castle', detail: 'castle 等级 1', action: 'city.upgrade', payload: { buildingId: 'castle' } },
      { label: '升级 dock', detail: '等级 1', action: 'city.upgrade', payload: { buildingId: 'dock' } },
      { label: '升级 alchemy', detail: '等级 1', action: 'city.upgrade', payload: { buildingId: 'alchemy' } },
      { label: '升级 smithy', detail: '等级 1', action: 'city.upgrade', payload: { buildingId: 'smithy' } },
      { label: '升级 defense', detail: '等级 1', action: 'city.upgrade', payload: { buildingId: 'defense' } },
      { label: '出售 main:item:999999', detail: '持有 2', action: 'inventory.sell', payload: { itemId: 'main:item:999999', count: 1 } },
      { label: '购买礼包，价格 60 银币', detail: '价格展示', action: 'shop.buy', payload: { itemId: 'main:item:60', count: 1 } },
    ],
  }];
  const original = structuredClone(sections);
  const presented = presentSections(content, sections);
  const items = presented[0].items;

  assert.equal(items[0].label, '出售 Halfblood Soul Fragment');
  assert.equal(items[0].detail, '出售 1 件换取 60 银币', 'an amount equal to the asset id is not renamed');
  assert.equal(items[1].label, '制造装备 Crown of Trials，手续费 3 银币');
  assert.equal(items[1].detail, '消耗 3 件，价格 10001 银币', 'prices and quantities remain literal numbers');
  assert.equal(items[2].label, '合成 Guard');
  assert.deepEqual(items[2].fields[0].options.map(option => option.label), ['Guard · 品质0', 'Guard · 品质0']);
  assert.deepEqual(items.slice(3, 8).map(item => item.label), ['升级 城堡', '升级 码头', '升级 炼金房', '升级 铁匠铺', '升级 城防']);
  assert.equal(items[3].detail, '城堡 等级 1');
  assert.equal(items[8].label, '出售 物品 #999999');
  assert.equal(items[9].label, '购买礼包，价格 60 银币', 'a payload id does not turn an unrelated price into an asset name');

  assert.deepEqual(sections, original, 'presentation does not mutate the service view');
  assert.deepEqual(items.map(item => item.action), original[0].items.map(item => item.action));
  assert.deepEqual(items.map(item => item.payload), original[0].items.map(item => item.payload));
  assert.equal(items[2].fields[0].value, original[0].items[2].fields[0].value);
  assert.deepEqual(
    items[2].fields[0].options.map(({ value, cardId, quality }) => ({ value, cardId, quality })),
    original[0].items[2].fields[0].options.map(({ value, cardId, quality }) => ({ value, cardId, quality })),
  );
});
