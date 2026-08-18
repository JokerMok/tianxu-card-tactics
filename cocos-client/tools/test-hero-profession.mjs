import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHeroProfessionRules } from '../assets/scripts/meta/hero/hero-profession.ts';

const root = path.resolve(import.meta.dirname, '..');

function readConfig(name) {
  return JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config', name), 'utf8'));
}

const cardsTable = readConfig('cards.json');
const decksTable = readConfig('decks.json');
const professionsTable = readConfig('professions.json');
const rules = createHeroProfessionRules({
  cards: cardsTable.cards,
  decks: decksTable.decks,
  professions: professionsTable.professions,
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

assert.equal(rules.validateHeroProfile({ name: '临川' }).valid, true, 'profession remains optional metadata');
assert.equal(rules.validateHeroProfile({ name: '临川', professionId: 'P001' }).valid, true);
expectErrors(rules.validateHeroProfile({ name: '   ', professionId: 'P001' }), 'HERO_NAME_REQUIRED');
expectErrors(rules.validateHeroProfile({ name: '临川', professionId: 'P999' }), 'HERO_PROFESSION_UNKNOWN');

for (const profession of professionsTable.professions) {
  assert.equal(rules.validateDeck(validDeck(profession.id)).valid, true, `${profession.id} must accept its real skill set`);
}

const forgedType = validDeck('P001');
forgedType.cardEntries[0] = { ...forgedType.cardEntries[0], cardType: 'SKILL' };
expectErrors(rules.validateDeck(forgedType), 'DECK_CARD_TYPE_FORBIDDEN');

const unknownCard = validDeck('P001');
unknownCard.cardEntries[0] = { ...unknownCard.cardEntries[0], cardId: 'U999' };
expectErrors(rules.validateDeck(unknownCard), 'DECK_CARD_UNKNOWN');

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

console.log('Hero Profession: profile and four profession deck metadata rules PASS');
