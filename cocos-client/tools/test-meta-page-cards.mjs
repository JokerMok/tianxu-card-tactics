import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CARD_QUALITY_CATALOG_DATA,
  CARD_QUALITY_LEVELS,
  CardQualityCatalog,
  loadCardQualityCatalog,
} from '../assets/scripts/meta/cards/quality/index.ts';
import {
  CARD_INVENTORY_SOURCES,
  CardInventoryError,
  CardInventoryService,
} from '../assets/scripts/meta/cards/card-inventory.ts';
import {
  CardsPageError,
  CardsPageService,
  createCardsPageData,
  createEmptyCardsPageData,
} from '../assets/scripts/meta/ui/pages/home-campaign-cards/cards/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const cardsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const cardsRoot = path.join(root, 'assets/scripts/meta/ui/pages/home-campaign-cards/cards');
const targetFiles = ['CardsContracts.ts', 'CardsComponents.ts', 'CardsPageService.ts', 'index.ts'];
const targetSource = new Map(targetFiles.map((file) => [file, fs.readFileSync(path.join(cardsRoot, file), 'utf8')]));

for (const [file, source] of targetSource) {
  assert(source.length > 500, `${file} must contain an implemented module`);
  assert.doesNotMatch(source, /from ['"]cc['"]|require\(['"]cc['"]\)/, `${file} must remain Cocos-adapter friendly`);
  assert.doesNotMatch(source, /UI01|loadSprite|整图/, `${file} must not use artwork text or numeric literals`);
}
assert.match(targetSource.get('CardsComponents.ts'), /createCardsPageComponents/);
assert.match(targetSource.get('CardsPageService.ts'), /CardInventoryService/);
assert.match(targetSource.get('CardsPageService.ts'), /loadCardQualityCatalog/);

const cards = cardsTable.cards.filter((card) => card.enabled !== false);
assert.equal(cards.length, 44, 'the test must use the real 44-card registry');
assert.equal(CARD_QUALITY_CATALOG_DATA.entries.length, 264, 'the test must use the real 264 quality records');
const catalog = loadCardQualityCatalog(cardsTable);
assert(catalog instanceof CardQualityCatalog, 'the real loader must return a CardQualityCatalog');
assert.deepEqual(catalog.cardIds(), cards.map(({ id }) => id).sort(), 'page data must cover the real enabled card IDs');
const productionBacked = new CardsPageService({ metadata: cardsTable });
assert.equal(productionBacked.snapshot().components.find((component) => component.id === 'header')?.totalCards, 44, 'service must load the real metadata and quality catalog');

const pageData = createCardsPageData(cardsTable, catalog);
assert.equal(pageData.cards.length, cards.length, 'page data must be derived from all enabled real cards');
assert.equal(pageData.cards.find(({ id }) => id === 'U001')?.nameKey, 'unit.U001.name');
assert.deepEqual(pageData.cards.find(({ id }) => id === 'U001')?.qualities[5].abilities, catalog.get('U001', 6).abilities);
assert.deepEqual(pageData.cards.find(({ id }) => id === 'S001')?.qualities[0].sources, catalog.get('S001', 1).sources);

const inventoryState = {
  schemaVersion: 1,
  entries: [
    { cardId: 'U001', quantity: 2, quality: 4, locked: true, source: CARD_INVENTORY_SOURCES[0] },
    { cardId: 'U004', quantity: 1, quality: 6, locked: false, source: CARD_INVENTORY_SOURCES[7] },
  ],
  filter: {},
  sort: { field: 'cardId', direction: 'asc' },
};
const inventory = new CardInventoryService({ metadata: cardsTable, state: inventoryState });
const saves = [];
const page = new CardsPageService({
  data: pageData,
  initialState: JSON.stringify({
    schemaVersion: 1,
    selectedCardId: 'U001',
    selectedQuality: 4,
    inventory: inventory.save(),
  }),
  onSave: (serialized) => saves.push(serialized),
});
const initial = page.snapshot();
assert.equal(initial.pageId, 'cards');
assert.equal(initial.state?.inventory, inventory.save());
assert.equal(initial.components.find((component) => component.id === 'header')?.totalCards, 44);
assert.equal(initial.components.find((component) => component.id === 'header')?.visibleCards, 44);
assert.equal(initial.components.find((component) => component.id === 'card-U001')?.ownedQuantity, 2);
assert.equal(initial.components.find((component) => component.id === 'card-U001')?.locked, true);
assert.equal(initial.components.find((component) => component.id === 'detail')?.cardId, 'U001');
assert.equal(initial.components.find((component) => component.id === 'detail')?.selectedQuality, 4);
assert.deepEqual(
  initial.components.find((component) => component.id === 'detail')?.selectedQualityDefinition,
  catalog.get('U001', 4),
  'detail must project real quality abilities and source data',
);

assert(Object.isFrozen(initial), 'page snapshot must be frozen');
assert(Object.isFrozen(initial.components), 'component list must be frozen');
assert(Object.isFrozen(initial.components.find((component) => component.id === 'detail')?.selectedQualityDefinition), 'quality detail must be frozen');
assert(Object.isFrozen(initial.components.find((component) => component.id === 'detail')?.selectedQualityDefinition.abilities), 'nested ability data must be frozen');
assert.throws(() => { initial.components.find((component) => component.id === 'header').visibleCards = 0; }, TypeError);
assert.throws(() => { initial.components.find((component) => component.id === 'detail').selectedQualityDefinition.abilities.attack = 999; }, TypeError);
const freshSnapshot = page.snapshot();
assert.notStrictEqual(freshSnapshot, initial, 'each page snapshot must be a fresh deep copy');
assert.equal(freshSnapshot.components.find((component) => component.id === 'detail').selectedQualityDefinition.abilities.attack, 5);

const mutableData = structuredClone(pageData);
const isolated = new CardsPageService({ data: mutableData });
mutableData.cards[0].nameKey = 'forged.name';
mutableData.cards[0].qualities[0].abilities.attack = 999;
assert.equal(isolated.pageData.cards[0].nameKey, pageData.cards[0].nameKey, 'data input must be detached');
assert.equal(isolated.pageData.cards[0].qualities[0].abilities.attack, pageData.cards[0].qualities[0].abilities.attack, 'nested quality input must be detached');

let negativeCaseCount = 0;
function expectPageFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof CardsPageError, `${label} must use CardsPageError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    return true;
  }, label);
}
function expectInventoryFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof CardInventoryError, `${label} must use CardInventoryError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    return true;
  }, label);
}

const initialDetail = page.snapshot().components.find((component) => component.id === 'detail');
assert.deepEqual(page.selectCard('U004'), { accepted: true, changed: true, reason: 'selected', selectedCardId: 'U004' });
assert.deepEqual(page.selectCard('U004'), { accepted: true, changed: false, reason: 'same', selectedCardId: 'U004' });
assert.deepEqual(page.selectQuality(6), { accepted: true, changed: true, reason: 'selected', selectedCardId: 'U004' });
assert.deepEqual(page.selectQuality(6), { accepted: true, changed: false, reason: 'same', selectedCardId: 'U004' });
const selectedDetail = page.snapshot().components.find((component) => component.id === 'detail');
assert.notStrictEqual(selectedDetail, initialDetail, 'selection must project a fresh detail component');
assert.deepEqual(selectedDetail?.selectedQualityDefinition, catalog.get('U004', 6));

const savesBeforeSameFilter = saves.length;
assert.deepEqual(page.setFilter({ cardIds: ['U004'] }), { accepted: true, changed: true, reason: 'filtered', selectedCardId: 'U004' });
assert.equal(page.snapshot().components.find((component) => component.id === 'header')?.visibleCards, 1);
assert.equal(saves.length, savesBeforeSameFilter + 1, 'changed filter must persist once');
const savesBeforeSameSelection = saves.length;
assert.deepEqual(page.selectCard('U004'), { accepted: true, changed: false, reason: 'same', selectedCardId: 'U004' });
assert.equal(saves.length, savesBeforeSameSelection, 'same selection must not persist');
assert.deepEqual(page.setFilter({ cardIds: ['U004'] }), { accepted: true, changed: false, reason: 'same', selectedCardId: 'U004' });
assert.equal(saves.length, savesBeforeSameSelection, 'same filter must not persist');

assert.deepEqual(page.clearFilter(), { accepted: true, changed: true, reason: 'filtered', selectedCardId: 'U004' });
assert.deepEqual(page.setSort({ field: 'prepare', direction: 'desc' }), { accepted: true, changed: true, reason: 'filtered', selectedCardId: 'U004' });
assert.equal(page.snapshot().components.find((component) => component.id === 'filters')?.sort.field, 'prepare');
assert.deepEqual(inventory.save(), JSON.stringify(inventoryState), 'page mutations must isolate an injected inventory service');
expectPageFailure('unknown card selection', () => page.selectCard('U999'), 'CARD_NOT_FOUND');
expectPageFailure('blank card selection', () => page.selectCard(''), 'INVALID_ID');
expectPageFailure('out-of-range quality selection', () => page.selectQuality(7), 'INVALID_QUALITY');
expectPageFailure('fractional quality selection', () => page.selectQuality(1.5), 'INVALID_QUALITY');
expectPageFailure('unknown interaction', () => page.interact({ type: 'unknown' }), 'INVALID_ARGUMENT');
expectInventoryFailure('unknown filter card', () => page.setFilter({ cardIds: ['U999'] }), 'INVALID_FILTER');
expectInventoryFailure('invalid filter quality', () => page.setFilter({ qualities: [7] }), 'INVALID_FILTER');
expectInventoryFailure('invalid sort field', () => page.setSort({ field: 'random', direction: 'asc' }), 'INVALID_SORT');
assert.equal(page.snapshot().components.find((component) => component.id === 'header')?.visibleCards, 44, 'invalid mutations must preserve the previous view');

const empty = new CardsPageService({ data: createEmptyCardsPageData() });
const emptySnapshot = empty.snapshot();
assert.deepEqual(emptySnapshot.components.map((component) => component.id), ['header', 'filters', 'cards-empty']);
assert.equal(emptySnapshot.state, null, 'empty page must not invent an inventory state');
assert.deepEqual(empty.selectCard('U001'), { accepted: false, changed: false, reason: 'empty', selectedCardId: null });
assert.deepEqual(empty.selectQuality(1), { accepted: false, changed: false, reason: 'empty', selectedCardId: null });
expectPageFailure('empty page serialize', () => empty.serialize(), 'STATE_NOT_AVAILABLE');
expectPageFailure('empty page persistence', () => new CardsPageService({ data: createEmptyCardsPageData(), onSave: () => {} }), 'STATE_NOT_AVAILABLE');

const serialized = page.serialize();
const restored = new CardsPageService({ data: pageData, initialState: serialized });
assert.deepEqual(restored.snapshot(), page.snapshot(), 'save and restore must preserve page components and state');
assert.equal(restored.serialize(), serialized, 'save serialization must be deterministic');
assert.deepEqual(restored.restore(serialized), page.snapshot(), 'restoring the same save must be idempotent');
const restoredInput = JSON.parse(serialized);
restoredInput.selectedCardId = 'U001';
restoredInput.selectedQuality = 4;
restoredInput.inventory = inventory.save();
const restoredDifferent = restored.restore(JSON.stringify(restoredInput));
assert.equal(restoredDifferent.selectedCardId, 'U001');
assert.equal(restoredDifferent.components.find((component) => component.id === 'detail')?.selectedQuality, 4);
expectPageFailure('malformed page save', () => restored.restore('{bad-json'), 'INVALID_SAVE');
expectPageFailure('unsupported page save', () => restored.restore(serialized.replace('"schemaVersion":1', '"schemaVersion":2')), 'SAVE_VERSION');
expectPageFailure('unknown saved card', () => restored.restore(serialized.replace('"selectedCardId":"U004"', '"selectedCardId":"U999"')), 'CARD_NOT_FOUND');

let persistenceFailure = true;
const failing = new CardsPageService({
  data: pageData,
  inventory: new CardInventoryService({ metadata: cardsTable, state: inventoryState }),
  persist: () => { if (persistenceFailure) throw new Error('disk full'); },
});
const beforePersistenceFailure = failing.snapshot();
expectPageFailure('persistence failure is atomic', () => failing.selectCard('U004'), 'PERSISTENCE_FAILED');
assert.deepEqual(failing.snapshot(), beforePersistenceFailure, 'failed persistence must not commit selection');
persistenceFailure = false;
assert.deepEqual(failing.selectCard('U004'), { accepted: true, changed: true, reason: 'selected', selectedCardId: 'U004' });

assert(negativeCaseCount >= 14, 'negative coverage must include invalid, empty, selection, filter and save boundaries');
console.log(`T308 cards page PASS: real-cards=${cards.length}, quality-definitions=${CARD_QUALITY_CATALOG_DATA.entries.length}, visible=${initial.components.find((component) => component.id === 'header')?.visibleCards}, empty-components=${emptySnapshot.components.length}, saves=${saves.length}, negative-cases=${negativeCaseCount}, deep-freeze/input-isolation/save-restore-idempotent=true`);
