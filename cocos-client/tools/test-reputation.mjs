import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  REPUTATION_CATALOG_DATA,
  REPUTATION_FACTIONS,
  REPUTATION_PROFESSIONS,
  REPUTATION_RACES,
  REPUTATION_LEVELS,
  ReputationError,
  assertReputationCatalogSkeleton,
  createReputationCatalog,
  diffReputationCatalogData,
  loadReputationCatalog,
  restoreReputationCatalog,
  restoreReputationState,
  serializeReputationState,
  REPUTATION_PRODUCTION_DIGEST,
  reputationCatalogDigest,
} from '../assets/scripts/meta/reputation/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const readConfig = (name) => JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name), 'utf8'));
const units = readConfig('units.json');
const professions = readConfig('professions.json');
const metadata = { units, professions };

function expectCode(label, action, code) {
  assert.throws(action, (error) => error instanceof ReputationError && error.code === code, `${label} must fail with ${code}`);
}

const catalog = loadReputationCatalog(metadata);
assert.equal(catalog.tracks.length, 11, 'seven race and four profession tracks are required');
assert.equal(catalog.relations.length, 49, 'faction relation matrix must be complete');
assert.deepEqual([...catalog.tracks].map((track) => track.id).sort(), [
  'PROFESSION_ARCANIST', 'PROFESSION_COMMANDER', 'PROFESSION_COVENANT', 'PROFESSION_TACTICIAN',
  'RACE_BEAST', 'RACE_CRAFTFOLK', 'RACE_FEATHERFOLK', 'RACE_HUMAN', 'RACE_MOUNTAIN_SPIRIT', 'RACE_SCALEFOLK', 'RACE_UNDEAD',
]);
assert.deepEqual([...new Set(catalog.tracks.filter((track) => track.subjectType === 'RACE').map((track) => track.sourceId))].sort(), [...REPUTATION_RACES].sort());
assert.deepEqual([...new Set(catalog.tracks.filter((track) => track.subjectType === 'PROFESSION').map((track) => track.sourceId))].sort(), [...REPUTATION_PROFESSIONS].sort());
for (const track of catalog.tracks) {
  assert.deepEqual(track.levels.map((level) => level.level), [...REPUTATION_LEVELS]);
  assert.deepEqual(track.levels.map((level) => level.threshold), [0, 100, 300, 700]);
  assert(track.levels.every((level) => level.rewardIds.length > 0));
  assert(track.levels.every((level) => Object.values(level.battleModifier).every((value) => Number.isSafeInteger(value) && value >= 0)));
}

const human = catalog.getTrack('RACE_HUMAN');
assert.equal(catalog.levelFor(human.id, 0), 1, 'zero points starts at contact');
assert.equal(catalog.levelFor(human.id, 99), 1, 'one point below threshold stays at level one');
assert.equal(catalog.levelFor(human.id, 100), 2, 'threshold is inclusive');
assert.equal(catalog.levelFor(human.id, 299), 2);
assert.equal(catalog.levelFor(human.id, 300), 3);
assert.equal(catalog.levelFor(human.id, 699), 3);
assert.equal(catalog.levelFor(human.id, 700), 4);
assert.equal(catalog.levelFor(human.id, Number.MAX_SAFE_INTEGER), 4, 'points cap at the highest configured level');
assert.deepEqual(catalog.progress(human.id, 300), {
  trackId: human.id,
  points: 300,
  level: 3,
  currentThreshold: 300,
  nextThreshold: 700,
  pointsIntoLevel: 0,
  pointsToNextLevel: 400,
  rewardIds: ['REWARD_RACE_HUMAN_L3_ALLIANCE'],
  battleModifier: { attackPercent: 2, defensePercent: 2, healingPercent: 2, prepareDiscount: 1 },
});
assert.deepEqual(catalog.getRelation('无籍行营', '山海诸庭'), {
  sourceFactionId: '无籍行营', targetFactionId: '山海诸庭', relation: 'CONTACT', score: 20,
});
assert.equal(catalog.getRelation('天序神庭', '归墟会').relation, 'ENEMY');
assert.equal(catalog.getRelation('无籍行营', '无籍行营').score, 0);

const initialState = catalog.createState([{ trackId: human.id, points: 99 }]);
const advancedState = catalog.addPoints(initialState, human.id, 1);
assert.equal(catalog.progress(human.id, advancedState.points.find((entry) => entry.trackId === human.id).points).level, 2);
assert.equal(initialState.points.find((entry) => entry.trackId === human.id).points, 99, 'state updates must be immutable');
const stateSerialized = serializeReputationState(catalog, advancedState);
assert.equal(stateSerialized, serializeReputationState(catalog, restoreReputationState(catalog, stateSerialized)), 'state serialization must be deterministic and idempotent');
assert.deepEqual(restoreReputationState(catalog, stateSerialized), advancedState);
assert.equal(catalog.serialize(), restoreReputationCatalog(catalog.serialize()).serialize(), 'catalog serialization must round-trip identically');

assert.equal(reputationCatalogDigest(REPUTATION_CATALOG_DATA), REPUTATION_PRODUCTION_DIGEST, 'production digest must match the literal integrity lock');
const reorderedCatalog = createReputationCatalog({
  ...structuredClone(REPUTATION_CATALOG_DATA),
  tracks: structuredClone(REPUTATION_CATALOG_DATA.tracks).reverse(),
  relations: structuredClone(REPUTATION_CATALOG_DATA.relations).reverse(),
});
assert.equal(reorderedCatalog.serialize(), catalog.serialize(), 'record ordering must not change serialized output');
const changed = structuredClone(REPUTATION_CATALOG_DATA);
changed.tracks[0].levels[1].threshold = 101;
assert.deepEqual(diffReputationCatalogData(REPUTATION_CATALOG_DATA, changed), { added: [], removed: [], changed: ['track:RACE_HUMAN'] });
expectCode('production digest drift', () => loadReputationCatalog(metadata, changed), 'INVALID_CONFIG');
const added = structuredClone(REPUTATION_CATALOG_DATA);
added.tracks.push(structuredClone(added.tracks[0]));
added.tracks.at(-1).id = 'RACE_FORGED';
assert.throws(() => assertReputationCatalogSkeleton(added), /skeleton mismatch/);

expectCode('unknown track lookup', () => catalog.getTrack('RACE_UNKNOWN'), 'UNKNOWN_TRACK');
expectCode('negative points', () => catalog.levelFor(human.id, -1), 'INVALID_POINTS');
expectCode('fractional points', () => catalog.levelFor(human.id, 1.5), 'INVALID_POINTS');
expectCode('unknown relation', () => catalog.getRelation('unknown', '无籍行营'), 'UNKNOWN_FACTION');
expectCode('malformed catalog save', () => restoreReputationCatalog('{'), 'INVALID_STATE');
expectCode('malformed state save', () => restoreReputationState(catalog, '{'), 'INVALID_STATE');
expectCode('unknown state track', () => restoreReputationState(catalog, JSON.stringify({ schemaVersion: 1, points: [{ trackId: 'RACE_UNKNOWN', points: 0 }] })), 'UNKNOWN_TRACK');
expectCode('incomplete state', () => restoreReputationState(catalog, JSON.stringify({ schemaVersion: 1, points: [] })), 'INVALID_STATE');
expectCode('invalid threshold order', () => createReputationCatalog({
  ...structuredClone(REPUTATION_CATALOG_DATA),
  tracks: structuredClone(REPUTATION_CATALOG_DATA.tracks).map((track, index) => index === 0
    ? { ...track, levels: track.levels.map((level, levelIndex) => levelIndex === 1 ? { ...level, threshold: 0 } : level) }
    : track),
}), 'INVALID_THRESHOLD');
expectCode('unknown faction relation', () => createReputationCatalog({
  ...structuredClone(REPUTATION_CATALOG_DATA),
  relations: structuredClone(REPUTATION_CATALOG_DATA.relations).map((relation, index) => index === 0
    ? { ...relation, targetFactionId: 'FORGED' }
    : relation),
}), 'UNKNOWN_FACTION');
expectCode('missing relation matrix cell', () => createReputationCatalog({
  ...structuredClone(REPUTATION_CATALOG_DATA),
  relations: structuredClone(REPUTATION_CATALOG_DATA.relations).slice(1),
}), 'INVALID_RELATION');

const missingRace = structuredClone(units);
missingRace.units = missingRace.units.filter((unit) => unit.race !== '异兽');
expectCode('missing race cross-table source', () => loadReputationCatalog({ units: missingRace, professions }), 'UNKNOWN_SOURCE');
const forgedPoliticalFaction = structuredClone(units);
forgedPoliticalFaction.units[0].politicalFaction = 'FORGED';
expectCode('unknown political faction cross-table source', () => loadReputationCatalog({ units: forgedPoliticalFaction, professions }), 'INVALID_METADATA');
const missingProfession = structuredClone(professions);
missingProfession.professions = missingProfession.professions.filter((profession) => profession.id !== 'P004');
expectCode('missing profession cross-table source', () => loadReputationCatalog({ units, professions: missingProfession }), 'UNKNOWN_SOURCE');
const disabledUnit = structuredClone(units);
disabledUnit.units.filter((unit) => unit.race === '人族').forEach((unit) => { unit.enabled = false; });
expectCode('disabled metadata row must not satisfy source', () => loadReputationCatalog({ units: disabledUnit, professions }), 'UNKNOWN_SOURCE');

assert.equal(REPUTATION_FACTIONS.length, 7);
console.log('T237 reputation PASS: tracks=11, levels=44, relations=49, boundaries=7, negative-cases=14, serialization-idempotent, skeleton-diff-checked');
