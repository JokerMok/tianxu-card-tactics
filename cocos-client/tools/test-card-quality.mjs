import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CARD_QUALITY_CATALOG_DATA,
  CARD_QUALITY_LEVELS,
  CARD_QUALITY_SOURCES,
  CardQualityCatalog,
  CardQualityError,
  createCardQualityCatalog,
  loadCardQualityCatalog,
  restoreCardQualityCatalog,
  serializeCardQualityCatalog,
  validateCardQualityConfig,
} from '../assets/scripts/meta/cards/quality/index.ts';

const EXPECTED_CARD_COUNT = 44;
const EXPECTED_QUALITY_COUNT = 6;
const EXPECTED_TOTAL_ENTRY_COUNT = 264;
const EXPECTED_QUALITY_LEVELS = [1, 2, 3, 4, 5, 6];
const EXPECTED_LOW_QUALITY_SOURCES = ['CAMPAIGN_REWARD', 'STAGE_REWARD', 'STARTER'];
const EXPECTED_MID_QUALITY_SOURCES = ['DUNGEON_REWARD', 'EVENT', 'SHOP'];
const EXPECTED_HIGH_QUALITY_SOURCES = ['CRAFT', 'SHOP', 'SYNTHESIS', 'TOWER_REWARD'];

const root = path.resolve(import.meta.dirname, '..');
const cardsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const cards = cardsTable.cards.filter((card) => card.enabled !== false);

assert.equal(cards.length, EXPECTED_CARD_COUNT, 'the real cards table must contain exactly 44 enabled cards');
assert.equal(CARD_QUALITY_LEVELS.length, EXPECTED_QUALITY_COUNT, 'the quality axis must contain exactly six levels');
assert.deepEqual([...CARD_QUALITY_LEVELS], EXPECTED_QUALITY_LEVELS);
assert.deepEqual([...CARD_QUALITY_SOURCES], [
  'STARTER',
  'CAMPAIGN_REWARD',
  'STAGE_REWARD',
  'DUNGEON_REWARD',
  'TOWER_REWARD',
  'SHOP',
  'EVENT',
  'CRAFT',
  'SYNTHESIS',
  'COMPENSATION',
  'MAIL',
  'FIRST_CLEAR',
  'WEIGHTED',
  'PITY',
]);

assert.equal(CARD_QUALITY_CATALOG_DATA.entries.length, EXPECTED_TOTAL_ENTRY_COUNT, 'the production catalog must contain exactly 264 records');
assert(Object.isFrozen(CARD_QUALITY_CATALOG_DATA), 'production catalog data must be frozen');
assert(Object.isFrozen(CARD_QUALITY_CATALOG_DATA.allowedSources), 'production source authority must be frozen');
assert(Object.isFrozen(CARD_QUALITY_CATALOG_DATA.entries), 'production catalog entries must be frozen');
for (const entry of CARD_QUALITY_CATALOG_DATA.entries) {
  assert(Object.isFrozen(entry), `${entry.cardId}:${entry.quality} production record must be frozen`);
  assert(Object.isFrozen(entry.abilities), `${entry.cardId}:${entry.quality} abilities must be frozen`);
  assert(Object.isFrozen(entry.sources), `${entry.cardId}:${entry.quality} sources must be frozen`);
}

function cloneEntries() {
  return structuredClone(CARD_QUALITY_CATALOG_DATA.entries);
}

function replaceEntry(cardId, quality, update) {
  const entries = cloneEntries();
  const index = entries.findIndex((entry) => entry.cardId === cardId && entry.quality === quality);
  assert.notEqual(index, -1, `fixture must contain ${cardId}:${quality}`);
  entries[index] = { ...entries[index], ...update(entries[index]) };
  return entries;
}

function dataWithEntries(entries) {
  const data = structuredClone(CARD_QUALITY_CATALOG_DATA);
  data.entries = entries;
  return data;
}

const cardsTableBeforeLoad = structuredClone(cardsTable);
const catalog = loadCardQualityCatalog(cardsTable);
assert(catalog instanceof CardQualityCatalog, 'production loader must create a CardQualityCatalog');
assert.deepEqual(cardsTable, cardsTableBeforeLoad, 'loader must not mutate the real cards.json registry input');
const snapshot = catalog.snapshot();
assert.equal(catalog.cardIds().length, EXPECTED_CARD_COUNT);
assert.deepEqual(catalog.cardIds(), cards.map(({ id }) => id).sort(), 'all enabled real cards must be represented');
assert.equal(snapshot.entries.length, EXPECTED_TOTAL_ENTRY_COUNT);
assert(Object.isFrozen(snapshot), 'catalog snapshots must be immutable');
assert(Object.isFrozen(snapshot.entries), 'catalog snapshot entries must be immutable');
assert(Object.isFrozen(catalog.get('U001', 1)), 'quality definitions must be immutable');
assert(Object.isFrozen(catalog.get('U001', 1).abilities));
assert(Object.isFrozen(catalog.get('U001', 1).sources));

const inputData = structuredClone(CARD_QUALITY_CATALOG_DATA);
const inputDataBeforeLoad = structuredClone(inputData);
const loadedFromInput = loadCardQualityCatalog(cardsTable, inputData);
assert.deepEqual(inputData, inputDataBeforeLoad, 'loader must not mutate catalog input data');
const inputEntries = cloneEntries();
const inputEntriesBeforeCreate = structuredClone(inputEntries);
createCardQualityCatalog({ metadata: cardsTable, entries: inputEntries });
assert.deepEqual(inputEntries, inputEntriesBeforeCreate, 'catalog construction must not mutate quality entries');

for (const card of cards) {
  const definitions = catalog.qualities(card.id);
  assert.equal(definitions.length, EXPECTED_QUALITY_COUNT, `${card.id} must have six quality records`);
  assert.deepEqual(definitions.map(({ quality }) => quality), EXPECTED_QUALITY_LEVELS);
  assert(definitions.every(({ cardId }) => cardId === card.id));
  assert.equal(new Set(definitions.map(({ abilities }) => JSON.stringify(abilities))).size, EXPECTED_QUALITY_COUNT, `${card.id} must have six ability profiles`);
  assert(definitions.every(({ copyLimit }) => copyLimit >= 1 && copyLimit <= card.copyLimit));
  assert(definitions.every((definition, index) => index === 0 || definitions[index - 1].copyLimit >= definition.copyLimit), `${card.id} copy limits must not increase with quality`);
  assert.equal(definitions.at(-1).copyLimit, 1, `${card.id} quality 6 must use the top-quality cap`);
  assert(definitions[0].sources.includes('STARTER'));
  assert(!definitions[0].sources.includes('CRAFT'));
  assert.deepEqual(definitions[2].sources, EXPECTED_MID_QUALITY_SOURCES);
  assert(definitions.at(-1).sources.includes('CRAFT'));
  assert(!definitions.at(-1).sources.includes('STARTER'));
}

const unitQualityOne = catalog.get('U001', 1);
const unitQualitySix = catalog.get('U001', 6);
assert.deepEqual(unitQualityOne.abilities, { maxHp: 8, attack: 2, armor: 2 });
assert.deepEqual(unitQualitySix.abilities, { maxHp: 13, attack: 7, armor: 4 });
assert.notDeepEqual(unitQualityOne.abilities, unitQualitySix.abilities, 'same-name cards must change abilities by quality');
assert.deepEqual(unitQualityOne.sources, EXPECTED_LOW_QUALITY_SOURCES);
assert.deepEqual(catalog.get('U001', 3).sources, EXPECTED_MID_QUALITY_SOURCES);
assert.deepEqual(unitQualitySix.sources, EXPECTED_HIGH_QUALITY_SOURCES);
assert.deepEqual([1, 2, 3, 4, 5, 6].map((quality) => catalog.get('U001', quality).copyLimit), [4, 4, 4, 3, 2, 1]);

const skillQualityOne = catalog.get('S001', 1);
const skillQualitySix = catalog.get('S001', 6);
assert.deepEqual(skillQualityOne.abilities, { effectPower: 2, effectTier: 1, prepare: 1 });
assert.deepEqual(skillQualitySix.abilities, { effectPower: 7, effectTier: 6, prepare: 1 });

assert.deepEqual(
  validateCardQualityConfig(cards, cloneEntries()),
  snapshot.entries,
  'the public config validator must normalize the same production rules',
);
assert.equal(catalog.availableCopies('U001', 6), unitQualitySix.copyLimit);
assert.equal(catalog.availableCopies('U001', 6, unitQualitySix.copyLimit), 0);
assert.deepEqual(
  catalog.validateGrant({ cardId: 'U001', quality: 6, source: 'CRAFT', quantity: 1, ownedQuantity: 0 }),
  {
    cardId: 'U001', quality: 6, source: 'CRAFT', quantity: 1, ownedQuantity: 0,
    remainingQuantity: unitQualitySix.copyLimit - 1,
  },
  'grant validation must use the production quality source and cap',
);
assert.equal(catalog.canGrant({ cardId: 'U001', quality: 6, source: 'CRAFT', quantity: unitQualitySix.copyLimit }), true);
assert.equal(catalog.canGrant({ cardId: 'U001', quality: 6, source: 'CRAFT', quantity: 1, ownedQuantity: unitQualitySix.copyLimit }), false);
assert.equal(catalog.canGrant({ cardId: 'U001', quality: 1, source: 'STARTER', quantity: 1 }), true);
assert.equal(catalog.canGrant({ cardId: 'U001', quality: 1, source: 'CRAFT', quantity: 1 }), false);

function expectCode(label, action, code) {
  assert.throws(action, (error) => error instanceof CardQualityError && error.code === code, `${label} must fail with ${code}`);
}

const baseEntries = cloneEntries();
const negativeCases = [
  ['empty metadata', () => createCardQualityCatalog({ metadata: [], entries: baseEntries }), 'INVALID_METADATA'],
  ['deleted production record', () => loadCardQualityCatalog(cardsTable, dataWithEntries(baseEntries.filter((entry) => !(entry.cardId === 'U001' && entry.quality === 6)))), 'INVALID_CONFIG'],
  ['duplicate quality entry', () => createCardQualityCatalog({ metadata: cards, entries: [...baseEntries, baseEntries[0]] }), 'DUPLICATE_QUALITY'],
  ['unknown card', () => createCardQualityCatalog({ metadata: cards, entries: replaceEntry('U001', 1, () => ({ cardId: 'U999' })) }), 'UNKNOWN_CARD'],
  ['quality below range', () => createCardQualityCatalog({ metadata: cards, entries: replaceEntry('U001', 1, () => ({ quality: 0 })) }), 'INVALID_QUALITY'],
  ['quality above range', () => createCardQualityCatalog({ metadata: cards, entries: replaceEntry('U001', 1, () => ({ quality: 7 })) }), 'INVALID_QUALITY'],
  ['fractional quality', () => createCardQualityCatalog({ metadata: cards, entries: replaceEntry('U001', 1, () => ({ quality: 1.5 })) }), 'INVALID_QUALITY'],
  ['empty abilities', () => createCardQualityCatalog({ metadata: cards, entries: replaceEntry('U001', 1, () => ({ abilities: {} })) }), 'INVALID_ABILITIES'],
  ['catalog attack tamper', () => loadCardQualityCatalog(cardsTable, dataWithEntries(replaceEntry('U002', 1, (entry) => ({ abilities: { ...entry.abilities, attack: 4 } })))), 'INVALID_CONFIG'],
  ['duplicate abilities through catalog constructor', () => createCardQualityCatalog({ metadata: cards, entries: replaceEntry('U001', 6, () => ({ abilities: structuredClone(baseEntries.find((entry) => entry.cardId === 'U001' && entry.quality === 1).abilities) })) }), 'ABILITY_NOT_UNIQUE'],
  ['empty source list', () => createCardQualityCatalog({ metadata: cards, entries: replaceEntry('U001', 1, () => ({ sources: [] })) }), 'INVALID_SOURCE'],
  ['unauthorized source', () => createCardQualityCatalog({ metadata: cards, entries: replaceEntry('U001', 1, () => ({ sources: ['NOT_A_REAL_SOURCE'] })) }), 'INVALID_SOURCE'],
  ['copy limit zero', () => createCardQualityCatalog({ metadata: cards, entries: replaceEntry('U001', 1, () => ({ copyLimit: 0 })) }), 'INVALID_COPY_LIMIT'],
  ['registry copyLimit tamper', () => {
    const forgedRegistry = structuredClone(cardsTable);
    forgedRegistry.cards.find((card) => card.id === 'U001').copyLimit = 5;
    return loadCardQualityCatalog(forgedRegistry);
  }, 'INVALID_METADATA'],
  ['forged.name', () => {
    const forgedRegistry = structuredClone(cardsTable);
    forgedRegistry.cards.find((card) => card.id === 'U001').name = 'forged';
    return loadCardQualityCatalog(forgedRegistry);
  }, 'INVALID_METADATA'],
  ['unknown entries wrapper field', () => createCardQualityCatalog({ metadata: cards, entries: { entries: baseEntries, forged: true } }), 'INVALID_CONFIG'],
  ['unknown grant source', () => catalog.validateGrant({ cardId: 'U001', quality: 6, source: 'NOT_A_REAL_SOURCE', quantity: 1 }), 'INVALID_SOURCE'],
  ['quality source mismatch', () => catalog.validateGrant({ cardId: 'U001', quality: 1, source: 'CRAFT', quantity: 1 }), 'SOURCE_NOT_ALLOWED'],
  ['zero grant quantity', () => catalog.validateGrant({ cardId: 'U001', quality: 1, source: 'STARTER', quantity: 0 }), 'INVALID_GRANT'],
  ['grant over cap', () => catalog.validateGrant({ cardId: 'U001', quality: 6, source: 'CRAFT', quantity: unitQualitySix.copyLimit + 1 }), 'QUANTITY_EXCEEDED'],
  ['owned quantity over cap', () => catalog.availableCopies('U001', 6, unitQualitySix.copyLimit + 1), 'QUANTITY_EXCEEDED'],
  ['unknown card lookup', () => catalog.get('U999', 1), 'UNKNOWN_CARD'],
  ['invalid quality lookup', () => catalog.get('U001', 7), 'INVALID_QUALITY'],
];
for (const [label, action, code] of negativeCases) expectCode(label, action, code);
assert.equal(negativeCases.length, 23, 'negative-case coverage must retain all configured cases');

const serialized = serializeCardQualityCatalog(catalog);
const restored = restoreCardQualityCatalog(cards, serialized);
assert.deepEqual(restored.snapshot(), snapshot, 'quality config must survive serialization and restoration');
assert.equal(serializeCardQualityCatalog(restored), serialized, 'serialization must be deterministic and idempotent');
assert.equal(restored.canGrant({ cardId: 'U001', quality: 6, source: 'CRAFT', quantity: 1 }), true);

const customSource = 'LIMITED_EVENT';
const customAuthority = [...CARD_QUALITY_SOURCES, customSource];
const customEntries = replaceEntry('U001', 1, () => ({ sources: [customSource] }));
const customCatalog = createCardQualityCatalog({ metadata: cards, entries: customEntries, allowedSources: customAuthority });
assert.equal(customCatalog.canGrant({ cardId: 'U001', quality: 1, source: customSource, quantity: 1 }), true);
const customSerialized = customCatalog.save();
expectCode('custom source authority must be explicit on restore', () => restoreCardQualityCatalog(cards, customSerialized), 'INVALID_STATE');
const customRestored = restoreCardQualityCatalog(cards, customSerialized, { allowedSources: customAuthority });
assert.deepEqual(customRestored.get('U001', 1).sources, [customSource]);

const forgedSave = JSON.parse(serialized);
forgedSave.schemaVersion = 99;
expectCode('unsupported save schema', () => restoreCardQualityCatalog(cards, JSON.stringify(forgedSave)), 'INVALID_STATE');
expectCode('malformed save', () => restoreCardQualityCatalog(cards, '{'), 'INVALID_STATE');
forgedSave.schemaVersion = 1;
forgedSave.allowedSources = ['FORGED_SOURCE'];
expectCode('forged source authority', () => restoreCardQualityCatalog(cards, JSON.stringify(forgedSave)), 'INVALID_STATE');
forgedSave.allowedSources = [...CARD_QUALITY_SOURCES].sort();
forgedSave.entries = forgedSave.entries.filter((entry) => !(entry.cardId === 'U001' && entry.quality === 6));
expectCode('incomplete saved config', () => restoreCardQualityCatalog(cards, JSON.stringify(forgedSave)), 'INVALID_STATE');

assert.deepEqual(loadedFromInput.snapshot(), snapshot, 'input-loaded catalog must match the immutable production catalog');
assert.equal(serializeCardQualityCatalog(catalog), serialized, 'input mutations must not change deterministic catalog serialization');

console.log(`T226 card quality PASS: real-cards=${cards.length}, definitions=${snapshot.entries.length}, negative-cases=${negativeCases.length}, save-restore-idempotent`);
