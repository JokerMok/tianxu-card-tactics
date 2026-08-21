import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');

function readConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(configRoot, name), 'utf8'));
}

const target = readConfig('builds/P01.json');
const cardsTable = readConfig('cards.json');
const unitsTable = readConfig('units.json');
const skillsTable = readConfig('skills.json');
const professionsTable = readConfig('professions.json');
const decksTable = readConfig('decks.json');

const enabled = (row) => row?.enabled !== false;
const cards = cardsTable.cards.filter(enabled);
const units = unitsTable.units.filter(enabled);
const skills = skillsTable.skills.filter(enabled);
const professions = professionsTable.professions.filter(enabled);
const cardsById = new Map(cards.map((card) => [card.id, card]));
const unitsById = new Map(units.map((unit) => [unit.id, unit]));
const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
const professionsById = new Map(professions.map((profession) => [profession.id, profession]));
const races = new Set(cards.filter((card) => card.cardType === 'UNIT' && card.race !== 'NONE').map((card) => card.race));
const deckContract = decksTable.decks.find((deck) => enabled(deck) && deck.id === 'D001') ?? decksTable.decks.find(enabled);

assert(deckContract, 'real decks.json must expose an enabled deck contract');
assert.equal(deckContract.totalCards, 30, 'the authoritative deck contract must remain thirty cards');
assert.equal(deckContract.minUnitCards, 24, 'the authoritative deck contract must retain the unit floor');
assert.equal(deckContract.maxSkillCards, 6, 'the authoritative deck contract must retain the skill ceiling');

const TOP_LEVEL_KEYS = ['schemaVersion', 'buildGroup', 'professionId', 'evidenceLevel', 'version', 'enabled', 'rules', 'builds'];
const RULE_KEYS = ['totalCards', 'minUnitCards', 'maxSkillCards'];
const BUILD_KEYS = ['id', 'name', 'professionId', 'race', 'purposeTags', 'slots'];
const SLOT_KEYS = ['slot', 'cardId'];

function hasExactKeys(value, keys, label, errors) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label}:OBJECT_REQUIRED`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.join('|') !== expected.join('|')) errors.push(`${label}:FIELDS_INVALID`);
  for (const key of keys) if (!Object.hasOwn(value, key)) errors.push(`${label}.${key}:MISSING`);
  return actual.join('|') === expected.join('|');
}

function validateBuildDocument(document) {
  const errors = [];
  if (!hasExactKeys(document, TOP_LEVEL_KEYS, 'document', errors)) return { valid: false, errors };
  if (document.schemaVersion !== 1) errors.push('document.schemaVersion:INVALID');
  if (document.buildGroup !== 'P01') errors.push('document.buildGroup:INVALID');
  const expectedProfessionId = document.buildGroup === 'P01' ? 'P001' : null;
  if (document.professionId !== expectedProfessionId || !professionsById.has(document.professionId)) {
    errors.push('document.professionId:INVALID');
  }
  if (document.evidenceLevel !== 'C' || !Number.isSafeInteger(document.version) || document.version < 1 || document.enabled !== true) {
    errors.push('document.metadata:INVALID');
  }

  if (hasExactKeys(document.rules, RULE_KEYS, 'document.rules', errors)) {
    for (const key of RULE_KEYS) {
      if (document.rules[key] !== deckContract[key]) errors.push(`document.rules.${key}:MISMATCH`);
    }
  }

  if (!Array.isArray(document.builds) || document.builds.length < 2) {
    errors.push('document.builds:AT_LEAST_TWO_REQUIRED');
    return { valid: false, errors };
  }

  const buildIds = new Set();
  for (const [buildIndex, build] of document.builds.entries()) {
    const label = `builds[${buildIndex}]`;
    if (!hasExactKeys(build, BUILD_KEYS, label, errors)) continue;
    if (typeof build.id !== 'string' || build.id.length === 0 || buildIds.has(build.id)) errors.push(`${label}.id:INVALID_OR_DUPLICATE`);
    buildIds.add(build.id);
    if (typeof build.name !== 'string' || build.name.trim().length === 0) errors.push(`${label}.name:MISSING`);
    if (build.professionId !== document.professionId || !professionsById.has(build.professionId)) errors.push(`${label}.professionId:INVALID`);
    if (typeof build.race !== 'string' || !races.has(build.race)) errors.push(`${label}.race:INVALID`);
    if (!Array.isArray(build.purposeTags) || build.purposeTags.length === 0 || build.purposeTags.some((tag) => typeof tag !== 'string' || tag.trim() === '')) {
      errors.push(`${label}.purposeTags:INVALID`);
    }
    if (!Array.isArray(build.slots) || build.slots.length !== deckContract.totalCards) {
      errors.push(`${label}.slots:COUNT_INVALID`);
      continue;
    }

    const slotIds = new Set();
    const cardCounts = new Map();
    let unitCards = 0;
    let skillCards = 0;
    let focusRaceCards = 0;
    for (const [slotIndex, slot] of build.slots.entries()) {
      const slotLabel = `${label}.slots[${slotIndex}]`;
      if (!hasExactKeys(slot, SLOT_KEYS, slotLabel, errors)) continue;
      if (!Number.isSafeInteger(slot.slot) || slot.slot < 1 || slot.slot > deckContract.totalCards || slotIds.has(slot.slot)) {
        errors.push(`${slotLabel}.slot:DUPLICATE_OR_OUT_OF_RANGE`);
      }
      slotIds.add(slot.slot);
      const card = typeof slot.cardId === 'string' ? cardsById.get(slot.cardId) : undefined;
      if (!card) {
        errors.push(`${slotLabel}.cardId:UNKNOWN_OR_MISSING`);
        continue;
      }
      const count = (cardCounts.get(card.id) ?? 0) + 1;
      cardCounts.set(card.id, count);
      if (count > card.copyLimit) errors.push(`${label}.cardId:${card.id}:COPY_LIMIT`);
      if (card.cardType === 'UNIT') {
        unitCards += 1;
        if (card.unitId !== card.id || !unitsById.has(card.unitId)) errors.push(`${label}.cardId:${card.id}:UNIT_REFERENCE`);
        if (card.race === build.race) focusRaceCards += 1;
      } else if (card.cardType === 'SKILL') {
        skillCards += 1;
        if (card.skillId !== card.id || !skillsById.has(card.skillId)) errors.push(`${label}.cardId:${card.id}:SKILL_REFERENCE`);
        const profession = professionsById.get(build.professionId);
        if (!profession?.skillIds.includes(card.id)) errors.push(`${label}.cardId:${card.id}:PROFESSION_FORBIDDEN`);
      } else {
        errors.push(`${label}.cardId:${card.id}:CARD_TYPE_INVALID`);
      }
    }
    if (slotIds.size !== deckContract.totalCards || [...Array(deckContract.totalCards)].some((_, index) => !slotIds.has(index + 1))) {
      errors.push(`${label}.slots:NOT_CONTIGUOUS`);
    }
    if (unitCards < deckContract.minUnitCards) errors.push(`${label}.cards:UNIT_MINIMUM`);
    if (skillCards > deckContract.maxSkillCards) errors.push(`${label}.cards:SKILL_MAXIMUM`);
    if (focusRaceCards === 0) errors.push(`${label}.race:NO_MATCHING_UNIT`);
  }
  return { valid: errors.length === 0, errors };
}

function cloneTarget() {
  return structuredClone(target);
}

function expectRejected(label, mutate, expectedCode) {
  const candidate = cloneTarget();
  mutate(candidate);
  const result = validateBuildDocument(candidate);
  assert.equal(result.valid, false, `${label} must be rejected`);
  assert(result.errors.some((error) => error.includes(expectedCode)), `${label} must report ${expectedCode}, got ${result.errors.join(', ')}`);
}

const validResult = validateBuildDocument(target);
assert.equal(validResult.valid, true, `real P01 builds must validate: ${validResult.errors.join(', ')}`);
assert.equal(target.builds.length >= 2, true, 'P01 must expose at least two builds');
assert.equal(new Set(target.builds.map((build) => build.race)).size, 2, 'P01 builds must exercise two real races');
assert(target.builds.every((build) => build.professionId === 'P001'), 'P01 must remain the P001 profession batch');

expectRejected('illegal profession', (candidate) => { candidate.builds[0].professionId = 'P002'; }, 'professionId:INVALID');
expectRejected('illegal race', (candidate) => { candidate.builds[0].race = '不存在种族'; }, 'race:INVALID');
expectRejected('copy-limit violation', (candidate) => { candidate.builds[0].slots[29].cardId = 'U001'; }, 'COPY_LIMIT');
expectRejected('cross-profession skill', (candidate) => { candidate.builds[0].slots[27].cardId = 'S001'; }, 'PROFESSION_FORBIDDEN');
expectRejected('duplicate slot', (candidate) => { candidate.builds[0].slots[1].slot = 1; }, 'DUPLICATE_OR_OUT_OF_RANGE');
expectRejected('missing field', (candidate) => { delete candidate.builds[0].slots[0].cardId; }, 'cardId:MISSING');

const brokenRules = cloneTarget();
brokenRules.rules.totalCards = deckContract.totalCards - 1;
const brokenRulesResult = validateBuildDocument(brokenRules);
assert.equal(brokenRulesResult.valid, false, 'a build contract mismatch must be rejected');
assert(brokenRulesResult.errors.includes('document.rules.totalCards:MISMATCH'));

console.log(`T315 P01 builds PASS: real cards=${cards.length}, professions=${professions.length}, races=${races.size}, skills=${skills.length}, builds=${target.builds.length}, slots=${deckContract.totalCards}, negative-cases=7`);
