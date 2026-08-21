import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readConfig(relativePath) {
  const absolutePath = path.join(projectRoot, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function rowsById(config, key) {
  assert(Array.isArray(config[key]) && config[key].length > 0, `${key} must be a non-empty real table`);
  return new Map(config[key].map((row) => [row.id, row]));
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value, keys, label) {
  assert(isRecord(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} has unexpected or missing fields`);
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validateBuild(build, context) {
  const { cards, units, skills, professions, contract, expectedProfession } = context;
  exactKeys(build, ['id', 'profession', 'race', 'cardEntries', 'totalCards', 'minUnitCards', 'maxSkillCards', 'purposeTags'], 'build');
  assert(typeof build.id === 'string' && build.id.length > 0, 'build id is required');
  assert(build.profession === expectedProfession, `build profession must be ${expectedProfession}`);
  assert(professions.has(build.profession), `unknown profession: ${build.profession}`);

  const legalRaces = new Set([...units.values()].filter((unit) => unit.enabled !== false).map((unit) => unit.race));
  assert(legalRaces.has(build.race) && build.race !== 'NONE', `unknown race: ${build.race}`);
  assert(Array.isArray(build.cardEntries) && build.cardEntries.length > 0, 'cardEntries must not be empty');
  assert(build.totalCards === contract.totalCards, 'build totalCards must match the real build contract');
  assert(build.minUnitCards === contract.minUnitCards, 'build minUnitCards must match the real build contract');
  assert(build.maxSkillCards === contract.maxSkillCards, 'build maxSkillCards must match the real build contract');
  assert(Array.isArray(build.purposeTags) && build.purposeTags.length > 0, 'purposeTags must not be empty');

  const seenSlots = new Set();
  const seenCards = new Set();
  const counts = new Map();
  let unitCards = 0;
  let skillCards = 0;
  for (const [index, entry] of build.cardEntries.entries()) {
    exactKeys(entry, ['slot', 'cardId', 'count'], `cardEntries[${index}]`);
    assert(positiveInteger(entry.slot), `cardEntries[${index}].slot must be a positive integer`);
    assert(!seenSlots.has(entry.slot), `duplicate slot: ${entry.slot}`);
    seenSlots.add(entry.slot);
    assert(typeof entry.cardId === 'string' && cards.has(entry.cardId), `unknown or disabled card: ${entry.cardId}`);
    assert(!seenCards.has(entry.cardId), `duplicate card entry: ${entry.cardId}`);
    seenCards.add(entry.cardId);
    assert(positiveInteger(entry.count), `cardEntries[${index}].count must be a positive integer`);

    const card = cards.get(entry.cardId);
    assert(card.enabled !== false, `disabled card: ${entry.cardId}`);
    assert(entry.count <= card.copyLimit, `${entry.cardId} exceeds copyLimit ${card.copyLimit}`);
    counts.set(entry.cardId, entry.count);
    if (card.cardType === 'UNIT') {
      assert(card.unitId === entry.cardId && units.has(card.unitId), `${entry.cardId} must reference a real unit`);
      const unit = units.get(card.unitId);
      assert(unit.enabled !== false && unit.footprintCells === 1, `${entry.cardId} is not deployable from a build`);
      assert(unit.race === card.race, `${entry.cardId} race must match its real unit`);
      unitCards += entry.count;
    } else if (card.cardType === 'SKILL') {
      assert(card.skillId === entry.cardId && skills.has(card.skillId), `${entry.cardId} must reference a real skill`);
      assert(professions.get(build.profession).skillIds.includes(card.skillId), `${entry.cardId} is not allowed for ${build.profession}`);
      skillCards += entry.count;
    } else {
      assert.fail(`unsupported card type: ${card.cardType}`);
    }
  }

  assert.equal(unitCards + skillCards, build.totalCards, 'card counts must equal totalCards');
  assert(unitCards >= contract.minUnitCards, `unit cards must be at least ${contract.minUnitCards}`);
  assert(skillCards <= contract.maxSkillCards, `skill cards must be at most ${contract.maxSkillCards}`);
  assert([...seenSlots].sort((a, b) => a - b).every((slot, index) => slot === index + 1), 'slots must be contiguous from 1');
  assert([...counts.values()].every((count) => count > 0), 'all card counts must be positive');
  assert([...build.cardEntries].some((entry) => cards.get(entry.cardId).cardType === 'UNIT' && units.get(cards.get(entry.cardId).unitId).race === build.race), `build must contain its declared race ${build.race}`);

  return { unitCards, skillCards, slots: seenSlots.size };
}

const data = readConfig('assets/resources/config/builds/P02.json');
const cards = rowsById(readConfig('assets/resources/config/cards.json'), 'cards');
const units = rowsById(readConfig('assets/resources/config/units.json'), 'units');
const skills = rowsById(readConfig('assets/resources/config/skills.json'), 'skills');
const professions = rowsById(readConfig('assets/resources/config/professions.json'), 'professions');
const decks = rowsById(readConfig('assets/resources/config/decks.json'), 'decks');

exactKeys(data, ['schemaVersion', 'table', 'evidenceLevel', 'version', 'enabled', 'buildTarget', 'contractDeckId', 'builds'], 'P02 config');
assert.equal(data.schemaVersion, 1);
assert.equal(data.table, 'builds');
assert.equal(data.enabled, true);
assert.equal(data.buildTarget, 'P02');
assert(Array.isArray(data.builds) && data.builds.length >= 2, 'P02 must contain at least two builds');
assert.equal(new Set(data.builds.map((build) => build.id)).size, data.builds.length, 'build IDs must be unique');

const contract = decks.get(data.contractDeckId);
assert(contract && contract.enabled !== false, `missing real contract deck: ${data.contractDeckId}`);
for (const field of ['totalCards', 'minUnitCards', 'maxSkillCards']) {
  assert(positiveInteger(contract[field]), `real build contract field ${field} is invalid`);
}
const expectedProfession = `P${data.buildTarget.slice(1).padStart(3, '0')}`;
assert(professions.has(expectedProfession), `missing real profession for ${data.buildTarget}: ${expectedProfession}`);
const context = { cards, units, skills, professions, contract, expectedProfession };
const summaries = data.builds.map((build) => validateBuild(build, context));

function cloneBuild(index) {
  return structuredClone(data.builds[index]);
}

function expectRejected(label, mutate, pattern) {
  const candidate = cloneBuild(0);
  mutate(candidate);
  assert.throws(() => validateBuild(candidate, context), pattern, `${label} must be rejected`);
}

expectRejected('missing profession', (build) => { delete build.profession; }, /profession/);
expectRejected('illegal profession', (build) => { build.profession = 'P999'; }, /profession/);
expectRejected('illegal race', (build) => { build.race = '不存在种族'; }, /race/);
expectRejected('illegal skill for profession', (build) => { build.cardEntries[10].cardId = 'S004'; }, /not allowed/);
expectRejected('card copy limit', (build) => { build.cardEntries[7].count = 2; }, /copyLimit/);
expectRejected('duplicate slot', (build) => { build.cardEntries[1].slot = build.cardEntries[0].slot; }, /duplicate slot/);

console.log(`T316 P02 build validation PASS: ${data.builds.length} builds, ${summaries.map(({ unitCards, skillCards, slots }) => `${unitCards}U/${skillCards}S/${slots}slots`).join(', ')}, real cards=${cards.size}, professions=${professions.size}, races=${new Set([...units.values()].map((unit) => unit.race)).size}, skills=${skills.size}`);
