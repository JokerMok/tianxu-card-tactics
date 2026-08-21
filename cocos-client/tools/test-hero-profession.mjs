import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHeroProfessionRules } from '../assets/scripts/meta/hero/hero-profession.ts';

const root = path.resolve(import.meta.dirname, '..');

function readConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name), 'utf8'));
}

const cardsTable = readConfig('cards.json');
const skillsTable = readConfig('skills.json');
const decksTable = readConfig('decks.json');
const professionsTable = readConfig('professions.json');
const authority = {
  cards: cardsTable.cards.map((card) => ({ ...card })),
  decks: decksTable.decks.map((deck) => ({ ...deck, cardEntries: [...deck.cardEntries] })),
  professions: professionsTable.professions.map((profession) => ({ ...profession, skillIds: [...profession.skillIds] })),
};
const rules = createHeroProfessionRules({
  cards: authority.cards,
  decks: authority.decks,
  professions: authority.professions,
});

function expectErrors(result, ...codes) {
  assert.equal(result.valid, false, `expected validation to fail: ${codes.join(', ')}`);
  for (const code of codes) assert(result.errors.includes(code), `expected ${code}, got ${result.errors.join(', ')}`);
}

function unitEntries(total) {
  let remaining = total;
  const entries = [];
  for (const card of cardsTable.cards.filter((card) => card.enabled !== false && card.cardType === 'UNIT')) {
    if (remaining === 0) break;
    const count = Math.min(card.copyLimit, remaining);
    entries.push({ cardId: card.id, count });
    remaining -= count;
  }
  assert.equal(remaining, 0, 'cards config must provide enough unit copies for the test deck');
  return entries;
}

function validDeck(professionId) {
  const profession = professionsTable.professions.find((candidate) => candidate.id === professionId);
  assert(profession, `missing profession fixture: ${professionId}`);
  return {
    professionId,
    cardEntries: [
      ...unitEntries(30 - profession.skillIds.length),
      ...profession.skillIds.map((cardId) => ({ cardId, count: 1 })),
    ],
  };
}

const enabledSkillIds = new Set(skillsTable.skills.filter((skill) => skill.enabled !== false).map((skill) => skill.id));
for (const profession of professionsTable.professions.filter((candidate) => candidate.enabled !== false)) {
  for (const skillId of profession.skillIds) {
    const card = cardsTable.cards.find((candidate) => candidate.id === skillId && candidate.enabled !== false);
    assert(enabledSkillIds.has(skillId), `${skillId} must exist in the real skills table`);
    assert.equal(card?.cardType, 'SKILL', `${skillId} must be a real skill card`);
    assert.equal(card?.skillId, skillId, `${skillId} card must point to the same real skill`);
  }
}

assert.equal(rules.validateHeroProfile({}).valid, true, 'empty hero metadata remains valid');
assert.equal(rules.validateHeroProfile({ name: undefined, professionId: undefined }).valid, true, 'undefined metadata remains optional');
assert.equal(rules.validateHeroProfile({ name: '临川' }).valid, true, 'profession remains optional metadata');
assert.equal(rules.validateHeroProfile({ name: '临川', professionId: 'P001' }).valid, true);
expectErrors(rules.validateHeroProfile(null), 'HERO_INPUT_INVALID');
expectErrors(rules.validateHeroProfile({ name: '   ', professionId: 'P001' }), 'HERO_NAME_REQUIRED');
expectErrors(rules.validateHeroProfile({ name: 1 }), 'HERO_NAME_REQUIRED');
expectErrors(rules.validateHeroProfile({ name: '临川', professionId: 'P999' }), 'HERO_PROFESSION_UNKNOWN');

for (const profession of professionsTable.professions) {
  assert.equal(rules.validateDeck(validDeck(profession.id)).valid, true, `${profession.id} must accept its real skill set`);
}

const configuredDeck = decksTable.decks.find((deck) => deck.id === 'D001');
assert(configuredDeck, 'D001 must remain the authoritative deck limit fixture');
assert.equal(
  validDeck('P001').cardEntries.reduce((total, entry) => total + entry.count, 0),
  configuredDeck.totalCards,
  'test deck must use the configured total-card limit',
);

const snapshotDeck = validDeck('P001');
authority.cards.find((card) => card.id === 'U001').cardType = 'SKILL';
authority.professions.find((profession) => profession.id === 'P001').skillIds[0] = 'S001';
authority.decks.find((deck) => deck.id === 'D001').totalCards = 1;
assert.equal(rules.validateDeck(snapshotDeck).valid, true, 'rules must keep an immutable authority snapshot');

const forgedType = validDeck('P001');
forgedType.cardEntries[0] = { ...forgedType.cardEntries[0], cardType: 'SKILL' };
expectErrors(rules.validateDeck(forgedType), 'DECK_CARD_TYPE_FORBIDDEN');

const unknownCard = validDeck('P001');
unknownCard.cardEntries[0] = { ...unknownCard.cardEntries[0], cardId: 'U999' };
expectErrors(rules.validateDeck(unknownCard), 'DECK_CARD_UNKNOWN');

const malformedEntry = validDeck('P001');
malformedEntry.cardEntries[0] = { ...malformedEntry.cardEntries[0], count: 0 };
expectErrors(rules.validateDeck(malformedEntry), 'DECK_CARD_ENTRY_INVALID');

const extraEntryField = validDeck('P001');
extraEntryField.cardEntries[0] = { ...extraEntryField.cardEntries[0], rarity: 4 };
expectErrors(rules.validateDeck(extraEntryField), 'DECK_CARD_ENTRY_INVALID');

const copyLimitViolation = validDeck('P001');
const singleCopyIndex = copyLimitViolation.cardEntries.findIndex((entry) => entry.count === 1);
assert.notEqual(singleCopyIndex, -1, 'real unit cards must provide a one-copy entry for the copy-limit counterexample');
copyLimitViolation.cardEntries.splice(singleCopyIndex, 1);
copyLimitViolation.cardEntries[0] = {
  ...copyLimitViolation.cardEntries[0],
  count: copyLimitViolation.cardEntries[0].count + 1,
};
expectErrors(rules.validateDeck(copyLimitViolation), 'DECK_CARD_COPY_LIMIT');

const crossProfessionSkill = validDeck('P001');
crossProfessionSkill.cardEntries.push({ cardId: 'S001', count: 1 });
crossProfessionSkill.cardEntries[0] = { ...crossProfessionSkill.cardEntries[0], count: crossProfessionSkill.cardEntries[0].count - 1 };
expectErrors(rules.validateDeck(crossProfessionSkill), 'DECK_SKILL_PROFESSION_FORBIDDEN');

const tooFewCards = validDeck('P001');
tooFewCards.cardEntries[0] = { ...tooFewCards.cardEntries[0], count: tooFewCards.cardEntries[0].count - 1 };
expectErrors(rules.validateDeck(tooFewCards), 'DECK_TOTAL_CARD_COUNT');

const tooManyCards = validDeck('P001');
tooManyCards.cardEntries[0] = { ...tooManyCards.cardEntries[0], count: tooManyCards.cardEntries[0].count + 1 };
expectErrors(rules.validateDeck(tooManyCards), 'DECK_TOTAL_CARD_COUNT');

const tooManySkills = {
  professionId: 'P001',
  cardEntries: [
    ...unitEntries(23),
    { cardId: 'S004', count: 5 },
    { cardId: 'S006', count: 1 },
    { cardId: 'S014', count: 1 },
  ],
};
expectErrors(rules.validateDeck(tooManySkills), 'DECK_UNIT_CARD_MINIMUM', 'DECK_SKILL_CARD_MAXIMUM');

expectErrors(rules.validateDeck(null), 'DECK_INPUT_INVALID');
assert.throws(
  () => createHeroProfessionRules({
    cards: cardsTable.cards,
    decks: decksTable.decks,
    professions: [{ ...professionsTable.professions[0], skillIds: ['U001'] }],
  }),
  /skill references/i,
  'profession skill pools must reference real skill cards',
);
assert.throws(
  () => createHeroProfessionRules({
    cards: cardsTable.cards.map((card) => card.id === 'U001' ? { ...card, skillId: 'S001' } : { ...card }),
    decks: decksTable.decks,
    professions: professionsTable.professions,
  }),
  /cards config/i,
  'unit cards must not carry skill metadata',
);
assert.throws(
  () => createHeroProfessionRules({
    cards: cardsTable.cards.map((card) => {
      if (card.id !== 'S004') return { ...card };
      const copy = { ...card };
      delete copy.skillId;
      return copy;
    }),
    decks: decksTable.decks,
    professions: professionsTable.professions,
  }),
  /cards config/i,
  'skill cards must carry an explicit skillId',
);
assert.throws(
  () => createHeroProfessionRules({
    cards: cardsTable.cards,
    decks: [{ ...configuredDeck, enabled: false }],
    professions: professionsTable.professions,
  }),
  /deck limits/i,
  'disabled deck limits must not become authoritative',
);

console.log('Hero Profession: profile and four profession deck metadata rules PASS');
