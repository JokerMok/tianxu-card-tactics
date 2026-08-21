import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CARD_QUALITY_LEVELS,
  CARD_QUALITY_SOURCES,
  CardQualityCatalog,
  CardQualityError,
  createCardQualityCatalog,
  restoreCardQualityCatalog,
  serializeCardQualityCatalog,
  validateCardQualityConfig,
} from '../assets/scripts/meta/cards/quality/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const cardsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const unitsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/units.json'), 'utf8'));
const cards = cardsTable.cards.filter((card) => card.enabled !== false);
const unitsById = new Map(unitsTable.units.filter((unit) => unit.enabled !== false).map((unit) => [unit.id, unit]));
const EXPECTED_REAL_CARD_COUNT = 44;
const EXPECTED_TOTAL_ENTRY_COUNT = 264;
const EXPECTED_CARD_KEYS = [
  ['U001', 'unit.U001.name'], ['U002', 'unit.U002.name'], ['U003', 'unit.U003.name'], ['U004', 'unit.U004.name'],
  ['U005', 'unit.U005.name'], ['U006', 'unit.U006.name'], ['U007', 'unit.U007.name'], ['U008', 'unit.U008.name'],
  ['U009', 'unit.U009.name'], ['U010', 'unit.U010.name'], ['U011', 'unit.U011.name'], ['U012', 'unit.U012.name'],
  ['U013', 'unit.U013.name'], ['U014', 'unit.U014.name'], ['U015', 'unit.U015.name'], ['U016', 'unit.U016.name'],
  ['U017', 'unit.U017.name'], ['U018', 'unit.U018.name'], ['U019', 'unit.U019.name'], ['U020', 'unit.U020.name'],
  ['U021', 'unit.U021.name'], ['U022', 'unit.U022.name'], ['U023', 'unit.U023.name'], ['U024', 'unit.U024.name'],
  ['U025', 'unit.U025.name'], ['U026', 'unit.U026.name'], ['U027', 'unit.U027.name'], ['U028', 'unit.U028.name'],
  ['S001', 'skill.S001.name'], ['S002', 'skill.S002.name'], ['S003', 'skill.S003.name'], ['S004', 'skill.S004.name'],
  ['S005', 'skill.S005.name'], ['S006', 'skill.S006.name'], ['S007', 'skill.S007.name'], ['S008', 'skill.S008.name'],
  ['S009', 'skill.S009.name'], ['S010', 'skill.S010.name'], ['S011', 'skill.S011.name'], ['S012', 'skill.S012.name'],
  ['S013', 'skill.S013.name'], ['S014', 'skill.S014.name'], ['S015', 'skill.S015.name'], ['S016', 'skill.S016.name'],
];

assert.equal(cards.length, EXPECTED_REAL_CARD_COUNT, 'the real cards directory must contain exactly 44 enabled cards');
assert.deepEqual(
  cards.map(({ id, nameKey }) => [id, nameKey]),
  EXPECTED_CARD_KEYS,
  'real card IDs and name keys must remain the T226 catalog inputs',
);

assert.equal(CARD_QUALITY_LEVELS.length, 6, 'the quality axis must contain exactly six levels');
assert.deepEqual([...CARD_QUALITY_LEVELS], [1, 2, 3, 4, 5, 6]);
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

function sourcesFor(quality) {
  if (quality <= 2) return ['STARTER', 'CAMPAIGN_REWARD', 'STAGE_REWARD'];
  if (quality <= 4) return ['DUNGEON_REWARD', 'SHOP', 'EVENT'];
  return ['TOWER_REWARD', 'SHOP', 'CRAFT', 'SYNTHESIS'];
}

function abilitiesFor(card, quality) {
  const unit = unitsById.get(card.id);
  if (unit) {
    return {
      maxHp: unit.maxHp + quality - 1,
      attack: unit.attack + quality - 1,
      armor: unit.armor + Math.floor((quality - 1) / 2),
    };
  }
  return {
    effectPower: card.rarity + quality,
    prepare: card.prepare,
    effectTier: quality,
  };
}

function copyLimitFor(card, quality) {
  return Math.max(1, Math.min(card.copyLimit, 7 - quality));
}

const entries = cards.flatMap((card) => CARD_QUALITY_LEVELS.map((quality) => ({
  cardId: card.id,
  quality,
  abilities: abilitiesFor(card, quality),
  sources: sourcesFor(quality),
  copyLimit: copyLimitFor(card, quality),
})));

assert.equal(entries.length, EXPECTED_TOTAL_ENTRY_COUNT, 'the real catalog must contain exactly 264 quality definitions');
const metadataBeforeCatalog = structuredClone(cards);
const entriesBeforeCatalog = structuredClone(entries);
const catalog = createCardQualityCatalog({ metadata: cards, entries });
assert.deepEqual(cards, metadataBeforeCatalog, 'catalog construction must not mutate card metadata');
assert.deepEqual(entries, entriesBeforeCatalog, 'catalog construction must not mutate quality entries');
assert(catalog instanceof CardQualityCatalog, 'the test must execute the real catalog implementation');
assert.deepEqual(validateCardQualityConfig(cards, entries), catalog.snapshot().entries, 'the public config validator must normalize the same real rules');
assert.deepEqual(catalog.cardIds(), [...EXPECTED_CARD_KEYS.map(([id]) => id)].sort(), 'all enabled real cards must be represented');
assert.equal(catalog.snapshot().entries.length, EXPECTED_TOTAL_ENTRY_COUNT, 'the loaded catalog must retain all 264 quality definitions');
assert(Object.isFrozen(catalog.snapshot()), 'catalog snapshots must be immutable');
assert(Object.isFrozen(catalog.get('U001', 1)), 'quality definitions must be immutable');
assert(Object.isFrozen(catalog.get('U001', 1).abilities));
assert(Object.isFrozen(catalog.get('U001', 1).sources));

for (const card of cards) {
  const definitions = catalog.qualities(card.id);
  assert.deepEqual(definitions.map(({ quality }) => quality), [1, 2, 3, 4, 5, 6]);
  assert(definitions.every(({ cardId }) => cardId === card.id), `${card.id} quality definitions must retain the real card ID`);
  assert.deepEqual(
    definitions.map(({ abilities }) => abilities),
    CARD_QUALITY_LEVELS.map((quality) => abilitiesFor(card, quality)),
    `${card.id} abilities must follow the real unit/skill quality scaling`,
  );
  assert.deepEqual(
    definitions.map(({ sources }) => sources),
    CARD_QUALITY_LEVELS.map((quality) => sourcesFor(quality).sort()),
    `${card.id} sources must follow the configured quality source bands`,
  );
  assert.deepEqual(
    definitions.map(({ copyLimit }) => copyLimit),
    CARD_QUALITY_LEVELS.map((quality) => copyLimitFor(card, quality)),
    `${card.id} copy limits must follow the real card cap and quality cap`,
  );
  assert.equal(definitions.at(-1).copyLimit, 1, `${card.id} quality 6 must use the configured top-quality cap`);
  assert.equal(new Set(definitions.map(({ abilities }) => JSON.stringify(abilities))).size, 6, `${card.id} must have six ability profiles`);
  assert(definitions.every(({ copyLimit }) => copyLimit >= 1 && copyLimit <= card.copyLimit));
  assert(definitions[0].sources.includes('STARTER'));
  assert(!definitions[0].sources.includes('CRAFT'));
  assert(definitions.at(-1).sources.includes('CRAFT'));
  assert(!definitions.at(-1).sources.includes('STARTER'));
}

const unitQualityOne = catalog.get('U001', 1);
const unitQualitySix = catalog.get('U001', 6);
assert.notDeepEqual(unitQualityOne.abilities, unitQualitySix.abilities, 'same-name cards must change abilities by quality');
assert.deepEqual(unitQualityOne.sources, [...sourcesFor(1)].sort());
assert.deepEqual(unitQualitySix.sources, [...sourcesFor(6)].sort());
assert.equal(catalog.availableCopies('U001', 6), unitQualitySix.copyLimit);
assert.equal(catalog.availableCopies('U001', 6, unitQualitySix.copyLimit), 0);
assert.deepEqual(
  catalog.validateGrant({ cardId: 'U001', quality: 6, source: 'CRAFT', quantity: 1, ownedQuantity: 0 }),
  {
    cardId: 'U001', quality: 6, source: 'CRAFT', quantity: 1, ownedQuantity: 0,
    remainingQuantity: unitQualitySix.copyLimit - 1,
  },
  'grant validation must use the configured quality source and cap',
);
assert.equal(catalog.canGrant({ cardId: 'U001', quality: 6, source: 'CRAFT', quantity: unitQualitySix.copyLimit }), true);
assert.equal(catalog.canGrant({ cardId: 'U001', quality: 6, source: 'CRAFT', quantity: 1, ownedQuantity: unitQualitySix.copyLimit }), false);
assert.equal(catalog.canGrant({ cardId: 'U001', quality: 1, source: 'STARTER', quantity: 1 }), true);
assert.equal(catalog.canGrant({ cardId: 'U001', quality: 1, source: 'CRAFT', quantity: 1 }), false);

function expectCode(label, action, code) {
  assert.throws(action, (error) => error instanceof CardQualityError && error.code === code, `${label} must fail with ${code}`);
}

const negativeCases = [
  ['empty metadata', () => createCardQualityCatalog({ metadata: [], entries }), 'INVALID_METADATA'],
  ['missing quality entry', () => createCardQualityCatalog({ metadata: cards, entries: entries.filter((entry) => !(entry.cardId === 'U001' && entry.quality === 6)) }), 'MISSING_QUALITY'],
  ['duplicate quality entry', () => createCardQualityCatalog({ metadata: cards, entries: [...entries, entries[0]] }), 'DUPLICATE_QUALITY'],
  ['unknown card', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, cardId: 'U999' } : entry) }), 'UNKNOWN_CARD'],
  ['quality below range', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, quality: 0 } : entry) }), 'INVALID_QUALITY'],
  ['quality above range', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, quality: 7 } : entry) }), 'INVALID_QUALITY'],
  ['fractional quality', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, quality: 1.5 } : entry) }), 'INVALID_QUALITY'],
  ['empty abilities', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, abilities: {} } : entry) }), 'INVALID_ABILITIES'],
  ['negative ability', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, abilities: { attack: -1 } } : entry) }), 'INVALID_ABILITIES'],
  ['duplicate abilities', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 6 ? { ...entry, abilities: entries.find((candidate) => candidate.cardId === 'U001' && candidate.quality === 1).abilities } : entry) }), 'ABILITY_NOT_UNIQUE'],
  ['empty source list', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, sources: [] } : entry) }), 'INVALID_SOURCE'],
  ['unauthorized source', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, sources: ['NOT_A_REAL_SOURCE'] } : entry) }), 'INVALID_SOURCE'],
  ['copy limit zero', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, copyLimit: 0 } : entry) }), 'INVALID_COPY_LIMIT'],
  ['copy limit exceeds card', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 6 ? { ...entry, copyLimit: cards.find((card) => card.id === 'U001').copyLimit + 1 } : entry) }), 'INVALID_COPY_LIMIT'],
  ['unknown entry field', () => createCardQualityCatalog({ metadata: cards, entries: entries.map((entry) => entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, forged: true } : entry) }), 'INVALID_CONFIG'],
  ['unknown entries wrapper field', () => createCardQualityCatalog({ metadata: cards, entries: { entries, forged: true } }), 'INVALID_CONFIG'],
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
assert.deepEqual(restored.snapshot(), catalog.snapshot(), 'quality config must survive serialization and restoration');
assert.equal(serializeCardQualityCatalog(restored), serialized, 'serialization must be deterministic and idempotent');
assert.equal(restored.canGrant({ cardId: 'U001', quality: 6, source: 'CRAFT', quantity: 1 }), true);
const customSource = 'LIMITED_EVENT';
const customAuthority = [...CARD_QUALITY_SOURCES, customSource];
const customEntries = entries.map((entry) => (
  entry.cardId === 'U001' && entry.quality === 1 ? { ...entry, sources: [customSource] } : entry
));
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

const snapshotBeforeInputMutation = catalog.snapshot();
cards[0].copyLimit = 99;
cards[0].tags.push('MUTATED_AFTER_LOAD');
entries[0].abilities.maxHp = 999;
entries[0].sources[0] = 'CRAFT';
entries[0].sources.push('PITY');
assert.deepEqual(catalog.snapshot(), snapshotBeforeInputMutation, 'mutating original objects and nested arrays must not alter the catalog');
assert.equal(serializeCardQualityCatalog(catalog), serialized, 'input mutations must not change deterministic catalog serialization');

console.log(`T226 card quality PASS: real-cards=${cards.length}, definitions=${entries.length}, negative-cases=${negativeCases.length}, save-restore-idempotent`);
