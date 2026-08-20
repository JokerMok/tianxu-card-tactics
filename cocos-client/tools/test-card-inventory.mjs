import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CARD_INVENTORY_SOURCES,
  CardInventoryError,
  CardInventoryService,
} from '../assets/scripts/meta/cards/card-inventory.ts';

const root = path.resolve(import.meta.dirname, '..');
const cardsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const cards = cardsTable.cards.filter((card) => card.enabled !== false);
const metadataById = new Map(cards.map((card) => [card.id, card]));
const card = (id) => metadataById.get(id);
const source = CARD_INVENTORY_SOURCES[0];
const sourceTwo = CARD_INVENTORY_SOURCES[1];

assert(cards.length > 0, 'the inventory test must use real card metadata');
assert(card('U001'), 'real cards.json must contain U001');
assert(card('U002'), 'real cards.json must contain U002');
assert(card('U003'), 'real cards.json must contain U003');
assert.equal(card('U001').unitId, 'U001', 'T212/T331 unit reference must remain real');
assert.equal(card('S001').skillId, 'S001', 'T212/T331 skill reference must remain real');

const saved = [];
const inventory = new CardInventoryService({
  metadata: cardsTable,
  onSave: (serialized) => saved.push(serialized),
  state: {
    schemaVersion: 1,
    entries: [
      { cardId: 'U002', quantity: 2, quality: card('U002').rarity, locked: false, source: sourceTwo },
      { cardId: 'U001', quantity: 4, quality: card('U001').rarity, locked: true, source },
      { cardId: 'U003', quantity: 1, quality: card('U003').rarity, locked: false, source },
    ],
    filter: {},
    sort: { field: 'cardId', direction: 'asc' },
  },
});

const initial = inventory.snapshot();
assert.deepEqual(initial.entries.map(({ cardId }) => cardId), ['U002', 'U001', 'U003']);
assert.equal(initial.entries[1].quality, card('U001').rarity, 'quality must be initialized from real rarity metadata');

const added = inventory.add({ cardId: 'U002', quantity: 3, source: sourceTwo });
assert.equal(added.quantity, 5, 'same card, quality and source must aggregate quantity');
assert.equal(inventory.getRecord({ cardId: 'U002', quality: card('U002').rarity, source: sourceTwo }).quantity, 5);
const removed = inventory.remove({ cardId: 'U002', quality: card('U002').rarity, source: sourceTwo }, 2);
assert.equal(removed.quantity, 3, 'removing a positive quantity must be applied');
assert.equal(inventory.setLocked({ cardId: 'U002', quality: card('U002').rarity, source: sourceTwo }, true).locked, true);
assert.throws(
  () => inventory.remove({ cardId: 'U002', quality: card('U002').rarity, source: sourceTwo }, 1),
  (error) => error instanceof CardInventoryError && error.code === 'CARD_LOCKED',
);
inventory.setLocked({ cardId: 'U002', quality: card('U002').rarity, source: sourceTwo }, false);
inventory.remove({ cardId: 'U002', quality: card('U002').rarity, source: sourceTwo }, 3);
assert.equal(inventory.query().some(({ cardId }) => cardId === 'U002'), false, 'zero quantity removes the record');

inventory.add({ cardId: 'U004', quantity: 2, source, quality: 1 });
inventory.add({ cardId: 'U005', quantity: 2, source, quality: 1 });
const returnedFilter = inventory.setFilter({ qualities: [1], sources: [source], locked: false });
const filterSavePayload = saved.at(-1);
returnedFilter.qualities.push(2);
returnedFilter.sources[0] = sourceTwo;
assert.deepEqual(inventory.query().map(({ cardId }) => cardId), ['U004', 'U005'], 'setFilter must return defensive array copies');
assert.equal(inventory.save(), filterSavePayload, 'mutating a returned filter must not change the saved payload');
assert.equal(saved.at(-1), filterSavePayload, 'mutating a returned filter must not change the onSave payload');
assert.deepEqual(inventory.query().map(({ cardId }) => cardId), ['U004', 'U005'], 'quality/source/lock filters must compose');
inventory.setFilter({ quality: 1, source });
assert.deepEqual(inventory.query().map(({ cardId }) => cardId), ['U004', 'U005'], 'singular quality/source filters must normalize');
inventory.setFilter({});
inventory.setSort({ field: 'quantity', direction: 'asc' });
assert.deepEqual(inventory.query().map(({ cardId }) => cardId), ['U003', 'U004', 'U005', 'U001'], 'equal sort values must preserve insertion order');
inventory.setSort({ field: 'quality', direction: 'desc' });
assert.deepEqual(inventory.query().map(({ cardId }) => cardId), ['U001', 'U003', 'U004', 'U005'], 'descending quality sorting must be deterministic');
inventory.setFilter({ qualities: [1], sources: [source], locked: false });
assert.deepEqual(inventory.query().map(({ cardId }) => cardId), ['U004', 'U005'], 'the persisted view must have a non-empty filter');

const serialized = inventory.save();
const recovered = CardInventoryService.restore(cardsTable, serialized);
assert.deepEqual(recovered.snapshot(), inventory.snapshot(), 'save and restore must preserve records and view state');
assert.deepEqual(recovered.snapshot().sort, { field: 'quality', direction: 'desc' }, 'restored sort must remain explicit');
assert.deepEqual(recovered.snapshot().filter, { qualities: [1], sources: [source], locked: false }, 'restored filter must remain explicit');
assert.deepEqual(
  recovered.query().map(({ cardId }) => cardId),
  ['U004', 'U005'],
  'restored filter and sort must drive the recovered query',
);
assert.deepEqual(
  recovered.getRecord({ cardId: 'U001', quality: card('U001').rarity, source }),
  { cardId: 'U001', quantity: 4, quality: card('U001').rarity, locked: true, source },
  'restored entries must retain quantity, quality, lock and source fields',
);
assert.equal(recovered.save(), serialized, 'the same state must serialize deterministically');
assert.notStrictEqual(recovered.snapshot(), recovered.snapshot(), 'snapshots must be defensive objects');
assert.deepEqual(JSON.parse(saved.at(-1)), JSON.parse(serialized), 'successful mutations must persist the latest state');

let negativeCaseCount = 0;
function expectFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof CardInventoryError, `${label} must use CardInventoryError`);
    if (code) assert.equal(error.code, code, `${label} must report ${code}`);
    return true;
  }, label);
}

const stateWithQuantity = (quantity) => JSON.stringify({
  schemaVersion: 1,
  entries: [{ cardId: 'U001', quantity, quality: card('U001').rarity, locked: false, source }],
  filter: {},
  sort: { field: 'cardId', direction: 'asc' },
});
const saturatedInventory = CardInventoryService.restore(cardsTable, stateWithQuantity(Number.MAX_SAFE_INTEGER));
inventory.add({ cardId: 'U001', quantity: 1, source: sourceTwo });

const negativeCases = [
  ['unknown card', () => inventory.add({ cardId: 'U999', quantity: 1, source }), 'UNKNOWN_CARD'],
  ['negative quantity', () => inventory.add({ cardId: 'U001', quantity: -1, source }), 'INVALID_QUANTITY'],
  ['zero add quantity', () => inventory.add({ cardId: 'U001', quantity: 0, source }), 'INVALID_QUANTITY'],
  ['fractional quantity', () => inventory.add({ cardId: 'U001', quantity: 1.5, source }), 'INVALID_QUANTITY'],
  ['invalid quality', () => inventory.add({ cardId: 'U001', quantity: 1, source, quality: 7 }), 'INVALID_QUALITY'],
  ['invalid source', () => inventory.add({ cardId: 'U001', quantity: 1, source: 'HACKED' }), 'INVALID_SOURCE'],
  ['restore zero quantity', () => CardInventoryService.restore(cardsTable, stateWithQuantity(0)), 'INVALID_QUANTITY'],
  ['restore fractional quantity', () => CardInventoryService.restore(cardsTable, stateWithQuantity(1.5)), 'INVALID_QUANTITY'],
  ['restore unsafe quantity', () => CardInventoryService.restore(cardsTable, stateWithQuantity(Number.MAX_SAFE_INTEGER + 1)), 'INVALID_QUANTITY'],
  ['aggregate quantity overflow', () => saturatedInventory.add({ cardId: 'U001', quantity: 1, source }), 'QUANTITY_EXCEEDED'],
  ['duplicate record', () => new CardInventoryService({
    metadata: cardsTable,
    state: {
      schemaVersion: 1,
      entries: [
        { cardId: 'U001', quantity: 1, quality: 4, locked: false, source },
        { cardId: 'U001', quantity: 2, quality: 4, locked: true, source },
      ],
      filter: {},
      sort: { field: 'cardId', direction: 'asc' },
    },
  }), 'DUPLICATE_RECORD'],
  ['unknown filter field', () => inventory.setFilter({ rarity: [1] }), 'INVALID_FILTER'],
  ['unknown filter card', () => inventory.setFilter({ cardIds: ['U999'] }), 'INVALID_FILTER'],
  ['invalid filter value', () => inventory.setFilter({ qualities: [7] }), 'INVALID_FILTER'],
  ['invalid sort field', () => inventory.setSort({ field: 'random', direction: 'asc' }), 'INVALID_SORT'],
  ['invalid sort direction', () => inventory.setSort({ field: 'cardId', direction: 'random' }), 'INVALID_SORT'],
  ['ambiguous record reference', () => inventory.getRecord('U001'), 'AMBIGUOUS_RECORD'],
  ['remove too much', () => inventory.remove({ cardId: 'U003', quality: card('U003').rarity, source }, 2), 'INVALID_QUANTITY'],
  ['malformed save', () => CardInventoryService.restore(cardsTable, '{bad-json'), 'INVALID_ENTRY'],
  ['invalid save schema', () => CardInventoryService.restore(cardsTable, JSON.stringify({ schemaVersion: 2 })), 'INVALID_ENTRY'],
];

for (const [label, action, code] of negativeCases) expectFailure(label, action, code);

let failSave = true;
const rollbackInventory = new CardInventoryService({
  metadata: cardsTable,
  onSave: () => {
    if (failSave) throw new Error('disk full');
  },
});
assert.throws(() => rollbackInventory.add({ cardId: 'U001', quantity: 1, source }), /disk full/);
assert.deepEqual(rollbackInventory.snapshot().entries, [], 'failed persistence must roll back the inventory mutation');
failSave = false;
rollbackInventory.add({ cardId: 'U001', quantity: 1, source });
assert.equal(rollbackInventory.snapshot().entries[0].quantity, 1, 'the service must remain usable after a persistence failure');

assert(saved.length >= 8, 'mutations must exercise the persistence callback');
assert.equal(negativeCaseCount, negativeCases.length, 'every listed negative case must execute exactly once');
assert.equal(negativeCaseCount, 20, 'negative-case coverage must retain all 20 cases');
console.log(`T210 card inventory PASS: real cards=${cards.length}, saves=${saved.length}, negative-cases=${negativeCaseCount}, stable-sort, save-restore`);
