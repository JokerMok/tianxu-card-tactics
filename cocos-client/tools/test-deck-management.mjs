import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_DECK_ID,
  DEFAULT_DECK_NAME,
  DECK_MANAGEMENT_SCHEMA_VERSION,
  DeckManagementError,
  DeckManagementService,
  MAX_DECK_CARDS,
  MAX_DECK_NAME_LENGTH,
} from '../assets/scripts/meta/decks/deck-management.ts';

const root = path.resolve(import.meta.dirname, '..');
const cardsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const cards = cardsTable.cards.filter((card) => card.enabled !== false);
const metadataById = new Map(cards.map((card) => [card.id, card]));
const availability = Object.fromEntries(cards.map((card) => [card.id, card.copyLimit]));
const card = (id) => metadataById.get(id);

assert(cards.length >= 30, 'the deck test must use at least 30 real enabled cards');
assert(card('U001'), 'real cards.json must contain U001');
assert(card('U002'), 'real cards.json must contain U002');
assert(card('S001'), 'real cards.json must contain S001');
assert.equal(card('U001').unitId, 'U001', 'unit metadata must remain real');
assert.equal(card('S001').skillId, 'S001', 'skill metadata must remain real');

const saved = [];
const manager = new DeckManagementService({
  metadata: cardsTable,
  availableCards: availability,
  onSave: (serialized) => saved.push(serialized),
});

assert.deepEqual(manager.snapshot(), {
  schemaVersion: DECK_MANAGEMENT_SCHEMA_VERSION,
  decks: [{ id: DEFAULT_DECK_ID, name: DEFAULT_DECK_NAME, cardEntries: [] }],
  currentDeckId: DEFAULT_DECK_ID,
}, 'a new manager must start with one empty default deck');
assert.equal(manager.getCurrentDeck().cardEntries.length, 0, 'empty decks must be supported');

const first = manager.createDeck('主力');
const second = manager.createDeck({ name: '备用', id: 'backup-deck' });
const boundaryNameDeck = manager.createDeck('a'.repeat(MAX_DECK_NAME_LENGTH));
assert.equal(boundaryNameDeck.name.length, MAX_DECK_NAME_LENGTH, 'the maximum deck name length must be accepted');
manager.deleteDeck(boundaryNameDeck.id);
assert.deepEqual(manager.listDecks().map(({ id, name }) => ({ id, name })), [
  { id: DEFAULT_DECK_ID, name: DEFAULT_DECK_NAME },
  { id: first.id, name: '主力' },
  { id: second.id, name: '备用' },
]);
assert.equal(manager.renameDeck(first.id, '主力改名').name, '主力改名');
assert.equal(manager.switchDeck(first.id).id, first.id);
assert.equal(manager.currentDeckId, first.id);

manager.addCard({ deckId: first.id, cardId: 'U001', count: 2 });
manager.addCard(first.id, 'S001', 1);
assert.deepEqual(manager.getDeck(first.id).cardEntries, [
  { cardId: 'U001', count: 2 },
  { cardId: 'S001', count: 1 },
], 'addCard must use real card metadata and preserve insertion order');
manager.removeCardFromDeck(first.id, 'U001', 1);
assert.equal(manager.getDeck(first.id).cardEntries[0].count, 1);

const copy = manager.copyDeck(first.id);
assert.equal(copy.name, '主力改名 副本');
assert.deepEqual(copy.cardEntries, manager.getDeck(first.id).cardEntries, 'copy must preserve card entries');
assert.notStrictEqual(copy.cardEntries, manager.getDeck(first.id).cardEntries, 'copy must deep clone card entries');
manager.addCard(copy.id, 'U002', 1);
assert.equal(manager.getDeck(first.id).cardEntries.some(({ cardId }) => cardId === 'U002'), false, 'copy mutation must not mutate source');

const externalSnapshot = manager.snapshot();
assert(Object.isFrozen(externalSnapshot) && Object.isFrozen(externalSnapshot.decks[0]), 'snapshots must be frozen');
assert.throws(() => { externalSnapshot.decks[0].cardEntries.push({ cardId: 'U002', count: 1 }); }, TypeError);
assert.equal(manager.getDeck(DEFAULT_DECK_ID).cardEntries.length, 0, 'external snapshot must not bypass internal state');

const fullDeckEntries = cards.slice(0, MAX_DECK_CARDS).map(({ id }) => ({ cardId: id, count: 1 }));
const full = manager.createDeck({ name: '三十张', id: 'full-deck', cardEntries: fullDeckEntries });
assert.equal(full.cardEntries.reduce((sum, entry) => sum + entry.count, 0), MAX_DECK_CARDS);

let negativeCaseCount = 0;
function expectFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof DeckManagementError, `${label} must use DeckManagementError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    assert.deepEqual(JSON.parse(JSON.stringify(error)), {
      name: 'DeckManagementError',
      code,
      reason: code,
      message: error.message,
    }, `${label} reason must serialize deterministically`);
    return true;
  }, label);
}

const negativeCases = [
  ['empty name', () => manager.createDeck(''), 'INVALID_DECK_NAME'],
  ['whitespace name', () => manager.createDeck('   '), 'INVALID_DECK_NAME'],
  ['leading whitespace name', () => manager.createDeck(' 主力'), 'INVALID_DECK_NAME'],
  ['name over boundary', () => manager.createDeck('a'.repeat(MAX_DECK_NAME_LENGTH + 1)), 'INVALID_DECK_NAME'],
  ['duplicate name', () => manager.createDeck('备用'), 'DUPLICATE_DECK_NAME'],
  ['duplicate id', () => manager.createDeck({ name: '另一个', id: second.id }), 'DUPLICATE_DECK_ID'],
  ['invalid id', () => manager.createDeck({ name: '坏 ID', id: 'bad id' }), 'INVALID_DECK_ID'],
  ['unknown card', () => manager.addCard(first.id, 'U999', 1), 'UNKNOWN_CARD'],
  ['disabled or unknown card', () => manager.addCard(first.id, 'S999', 1), 'UNKNOWN_CARD'],
  ['zero card count', () => manager.addCard(first.id, 'U001', 0), 'INVALID_CARD_COUNT'],
  ['fractional card count', () => manager.addCard(first.id, 'U001', 1.5), 'INVALID_CARD_COUNT'],
  ['insufficient available quantity', () => {
    const constrained = new DeckManagementService({ metadata: cardsTable, availableCards: { U001: 1 } });
    constrained.addCard('U001', 2);
  }, 'CARD_QUANTITY_UNAVAILABLE'],
  ['card omitted from explicit availability', () => {
    const constrained = new DeckManagementService({ metadata: cardsTable, availableCards: { U001: 1 } });
    constrained.addCard('U002', 1);
  }, 'CARD_QUANTITY_UNAVAILABLE'],
  ['copy limit exceeded', () => manager.addCard(first.id, 'U001', card('U001').copyLimit), 'CARD_COPY_LIMIT_EXCEEDED'],
  ['more than 30 cards', () => manager.addCard(full.id, 'U001', 1), 'DECK_CARD_LIMIT_EXCEEDED'],
  ['duplicate card entries in state', () => new DeckManagementService({
    metadata: cardsTable,
    availableCards: availability,
    state: {
      schemaVersion: 1,
      decks: [{ id: 'deck-one', name: '重复卡', cardEntries: [
        { cardId: 'U001', count: 1 },
        { cardId: 'U001', count: 1 },
      ] }],
      currentDeckId: 'deck-one',
    },
  }), 'DUPLICATE_CARD_ENTRY'],
  ['switch unknown deck', () => manager.switchDeck('missing-deck'), 'DECK_NOT_FOUND'],
  ['rename unknown deck', () => manager.renameDeck('missing-deck', '新名字'), 'DECK_NOT_FOUND'],
  ['copy unknown deck', () => manager.copyDeck('missing-deck'), 'DECK_NOT_FOUND'],
  ['remove absent card', () => manager.removeCard(first.id, 'U003', 1), 'CARD_NOT_IN_DECK'],
  ['remove too many cards', () => manager.removeCard(first.id, 'U001', 3), 'CARD_COUNT_EXCEEDS_DECK'],
  ['malformed saved state', () => DeckManagementService.restore(cardsTable, '{bad-json', { availableCards: availability }), 'INVALID_STATE'],
  ['wrong saved schema', () => DeckManagementService.restore(cardsTable, JSON.stringify({ schemaVersion: 2 }), { availableCards: availability }), 'INVALID_STATE'],
  ['unknown saved card', () => DeckManagementService.restore(cardsTable, JSON.stringify({
    schemaVersion: 1,
    decks: [{ id: 'deck-one', name: '未知卡', cardEntries: [{ cardId: 'U999', count: 1 }] }],
    currentDeckId: 'deck-one',
  }), { availableCards: availability }), 'UNKNOWN_CARD'],
  ['last deck delete', () => {
    const single = new DeckManagementService({ metadata: cardsTable, availableCards: availability });
    single.deleteDeck(DEFAULT_DECK_ID);
  }, 'LAST_DECK_CANNOT_DELETE'],
];

for (const [label, action, code] of negativeCases) expectFailure(label, action, code);

const currentBeforeDelete = manager.currentDeckId;
manager.deleteDeck(currentBeforeDelete);
assert.notEqual(manager.currentDeckId, currentBeforeDelete, 'deleting the current deck must select a stable fallback');
assert.equal(manager.listDecks().some(({ id }) => id === currentBeforeDelete), false);
manager.deleteDeck(full.id);
assert.equal(manager.listDecks().some(({ id }) => id === full.id), false, 'non-current deletion must work');

const serialized = manager.save();
const recovered = DeckManagementService.restore(cardsTable, serialized, { availableCards: availability });
assert.deepEqual(recovered.snapshot(), manager.snapshot(), 'save and restore must preserve the exact state');
assert.equal(recovered.save(), serialized, 'save and restore must be deterministic');
assert.notStrictEqual(recovered.snapshot(), recovered.snapshot(), 'snapshots must be defensive objects');

let failSave = true;
const rollback = new DeckManagementService({
  metadata: cardsTable,
  availableCards: availability,
  onSave: () => { if (failSave) throw new Error('disk full'); },
});
assert.throws(() => rollback.createDeck('不会保存'), (error) => {
  assert(error instanceof DeckManagementError);
  assert.equal(error.code, 'PERSISTENCE_FAILED');
  assert.equal(error.reason, 'PERSISTENCE_FAILED');
  assert.match(String(error.cause?.message), /disk full/);
  return true;
});
assert.deepEqual(rollback.snapshot().decks.map(({ id, name }) => ({ id, name })), [
  { id: DEFAULT_DECK_ID, name: DEFAULT_DECK_NAME },
], 'failed persistence must roll back the deck mutation');
failSave = false;
rollback.createDeck('保存成功');
assert.equal(rollback.listDecks().length, 2, 'service must remain usable after persistence failure');

assert(saved.length >= 10, 'successful mutations must exercise persistence');
assert.equal(negativeCaseCount, negativeCases.length, 'every listed negative case must execute exactly once');
assert(negativeCaseCount >= 20, 'T211 must retain 20+ negative cases');
console.log(`T211 deck management PASS: real cards=${cards.length}, decks=${manager.listDecks().length}, saves=${saved.length}, negative-cases=${negativeCaseCount}, save-restore, rollback`);
