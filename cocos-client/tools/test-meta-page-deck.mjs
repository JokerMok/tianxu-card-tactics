import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  DECK_PAGE_SCHEMA_VERSION,
  DeckPageError,
  DeckPageService,
  createDeckPageComponents,
  createDefaultDeckPageData,
  createEmptyDeckPageData,
} from '../assets/scripts/meta/ui/pages/deck-hero-adventure/deck/index.ts';
import {
  DeckManagementError,
  DeckManagementService,
} from '../assets/scripts/meta/decks/deck-management.ts';

const root = path.resolve(import.meta.dirname, '..');
const deckRoot = path.join(root, 'assets/scripts/meta/ui/pages/deck-hero-adventure/deck');
const targetFiles = ['DeckContracts.ts', 'DeckComponents.ts', 'DeckPageService.ts', 'index.ts'];
const targetSource = new Map(targetFiles.map((file) => [file, fs.readFileSync(path.join(deckRoot, file), 'utf8')]));

for (const [file, source] of targetSource) {
  assert(source.length > 300, `${file} must contain an implemented module`);
  assert.doesNotMatch(source, /from ['"]cc['"]|require\(['"]cc['"]\)/, `${file} must remain Cocos-adapter friendly`);
  assert.doesNotMatch(source, /UI0[1-9]|loadSprite|整图/, `${file} must not depend on page artwork text or numbers`);
}
assert.match(targetSource.get('DeckComponents.ts'), /createDeckPageComponents/);
assert.match(targetSource.get('DeckPageService.ts'), /DeckManagementService/);
assert.match(targetSource.get('DeckPageService.ts'), /createHeroProfessionRules/);

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const cardsTable = readJson(path.join(root, 'assets/resources/config/cards.json'));
const decksTable = readJson(path.join(root, 'assets/resources/config/decks.json'));
const professionsTable = readJson(path.join(root, 'assets/resources/config/professions.json'));
const realCards = cardsTable.cards.filter((card) => card.enabled !== false);
const realDeck = decksTable.decks.find((deck) => deck.id === 'D001');
const authority = {
  cards: cardsTable.cards,
  decks: decksTable.decks,
  professions: professionsTable.professions,
};
const availability = Object.fromEntries(realCards.map((card) => [card.id, card.copyLimit]));
assert(realCards.length >= 30, 'the page must use the real enabled card catalog');
assert(realDeck, 'D001 must be present in the real deck config');
assert.equal(realDeck.totalCards, 30, 'the page must use the configured total-card limit');
assert.equal(realDeck.minUnitCards, 24, 'the page must use the configured unit-card floor');
assert.equal(realDeck.maxSkillCards, 6, 'the page must use the configured skill-card ceiling');

const data = createDefaultDeckPageData({
  metadata: cardsTable,
  decks: decksTable,
  professionId: 'P001',
});
assert.equal(data.schemaVersion, DECK_PAGE_SCHEMA_VERSION);
assert.deepEqual(data.cards.map(({ id }) => id), realCards.map(({ id }) => id), 'page cards must come from real cards.json');
assert.equal(data.totalCards, realDeck.totalCards);
assert.equal(data.minUnitCards, realDeck.minUnitCards);
assert.equal(data.maxSkillCards, realDeck.maxSkillCards);

const validState = {
  schemaVersion: 1,
  decks: [{ id: 'deck-default', name: '默认牌组', cardEntries: realDeck.cardEntries.map(({ cardId, count }) => ({ cardId, count })) }],
  currentDeckId: 'deck-default',
};
const validManager = new DeckManagementService({ metadata: cardsTable, availableCards: availability, state: validState });
const page = new DeckPageService({ data, manager: validManager, authority });
const initial = page.snapshot();
assert.equal(initial.pageId, 'deck');
assert.equal(initial.currentDeckId, 'deck-default');
assert.equal(initial.validation.status, 'valid', 'the real D001 deck must validate for P001');
assert.deepEqual(initial.components.map((component) => component.id).slice(0, 4), [
  'header', 'deck-selector', 'validation', 'card-pool',
]);
assert.equal(initial.components.find((component) => component.id === 'header')?.cardCount, realDeck.totalCards);
assert.equal(initial.components.find((component) => component.id === 'validation')?.unitCards, realDeck.minUnitCards + 3);
assert.equal(initial.components.filter((component) => component.kind === 'deckCard').length, realDeck.cardEntries.length);
assert.equal(initial.components.find((component) => component.id === 'deck-card-U001')?.count, 1);
const initialPool = initial.components.find((component) => component.id === 'card-pool');
assert.equal(initialPool?.cards.find((card) => card.cardId === 'U001')?.permitted, true);
assert.equal(initialPool?.cards.find((card) => card.cardId === 'S001')?.permitted, false, 'skill permission must be evaluated per card');

// Component projection is data-driven and detached from caller mutations.
const mutableData = createDefaultDeckPageData({ metadata: cardsTable, decks: decksTable, professionId: 'P001' });
const isolatedPage = new DeckPageService({ data: mutableData, manager: validManager, authority });
mutableData.cards[0].label = '篡改标签';
assert.notEqual(isolatedPage.pageData.cards[0].label, '篡改标签');
const frozenSnapshot = isolatedPage.snapshot();
assert(Object.isFrozen(frozenSnapshot));
assert(Object.isFrozen(frozenSnapshot.components));
assert(Object.isFrozen(frozenSnapshot.state));
assert(Object.isFrozen(frozenSnapshot.validation.errors));
assert.throws(() => { frozenSnapshot.state.decks[0].cardEntries[0].count = 99; }, TypeError);
const laterSnapshot = isolatedPage.snapshot();
assert.notStrictEqual(laterSnapshot, frozenSnapshot, 'snapshot must be a fresh deep copy');
assert.equal(laterSnapshot.state.decks[0].cardEntries[0].count, 1);

// Selection, drag-over and cancel/drop are explicit UI states, not artwork assumptions.
assert.deepEqual(page.selectCard('U001'), { accepted: true, changed: true, reason: 'selected', cardId: 'U001', deckId: 'deck-default' });
assert.equal(page.snapshot().components.find((component) => component.id === 'deck-card-U001')?.state, 'selected');
assert.deepEqual(page.selectCard('U001'), { accepted: true, changed: false, reason: 'same', cardId: 'U001', deckId: 'deck-default' });
assert.deepEqual(page.beginDrag('U001'), { accepted: true, changed: true, reason: 'dragging', cardId: 'U001', deckId: 'deck-default' });
assert.deepEqual(page.dragOver('U001'), { accepted: true, changed: true, reason: 'dragOver', cardId: 'U001', deckId: 'deck-default' });
assert.equal(page.snapshot().components.find((component) => component.id === 'deck-card-U001')?.state, 'dropTarget');
assert.deepEqual(page.dropCard(), { accepted: true, changed: true, reason: 'dropped', cardId: 'U001', deckId: 'deck-default' });
assert.equal(page.snapshot().draggingCardId, null);

let negativeCaseCount = 0;
function expectPageFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof DeckPageError, `${label} must throw DeckPageError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}
function expectDeckFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof DeckManagementError, `${label} must throw DeckManagementError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    return true;
  }, label);
}

// Empty page and empty deck are distinct real states.
const emptyPage = new DeckPageService(createEmptyDeckPageData());
assert.deepEqual(emptyPage.snapshot().components.map((component) => component.id), ['deck-empty']);
assert.equal(emptyPage.snapshot().components[0].reason, 'noCards');
assert.deepEqual(emptyPage.selectCard('U001'), { accepted: false, changed: false, reason: 'empty', cardId: null, deckId: null });
expectPageFailure('empty page serialize', () => emptyPage.serialize(), 'STATE_NOT_AVAILABLE');
const emptyManager = new DeckManagementService({ metadata: cardsTable, availableCards: availability });
const emptyDeckPage = new DeckPageService({ data, manager: emptyManager, authority });
assert.equal(emptyDeckPage.snapshot().components.at(-1)?.id, 'deck-empty');
assert.equal(emptyDeckPage.snapshot().components.at(-1)?.reason, 'emptyDeck');
const invalidManager = new DeckManagementService({
  metadata: cardsTable,
  availableCards: availability,
  state: {
    schemaVersion: 1,
    decks: [{ id: 'deck-default', name: '未完成', cardEntries: [{ cardId: 'U001', count: 1 }] }],
    currentDeckId: 'deck-default',
  },
});
const invalidDeckPage = new DeckPageService({ data, manager: invalidManager, authority });
assert.equal(invalidDeckPage.snapshot().validation.status, 'invalid');
assert.equal(invalidDeckPage.snapshot().components.find((component) => component.id === 'header')?.state, 'invalid');
assert(invalidDeckPage.snapshot().validation.errors.includes('DECK_TOTAL_CARD_COUNT'));

// The real service enforces duplicate entries, copy limits, total limits and malformed saves.
expectDeckFailure('duplicate card entries in saved state', () => new DeckManagementService({
  metadata: cardsTable,
  availableCards: availability,
  state: {
    schemaVersion: 1,
    decks: [{ id: 'deck-default', name: '重复卡', cardEntries: [{ cardId: 'U001', count: 1 }, { cardId: 'U001', count: 1 }] }],
    currentDeckId: 'deck-default',
  },
}), 'DUPLICATE_CARD_ENTRY');
expectDeckFailure('copy limit', () => emptyManager.addCardToDeck('deck-default', 'U001', 5), 'CARD_COPY_LIMIT_EXCEEDED');
const fullManager = new DeckManagementService({ metadata: cardsTable, availableCards: availability, state: validState });
expectDeckFailure('deck total limit', () => fullManager.addCardToDeck('deck-default', 'U001', 1), 'DECK_CARD_LIMIT_EXCEEDED');
expectPageFailure('forbidden skill', () => emptyDeckPage.addCard('S001'), 'SKILL_PROFESSION_FORBIDDEN');
expectPageFailure('unknown selected card', () => emptyDeckPage.selectCard('U999'), 'CARD_NOT_FOUND');
expectPageFailure('drag over without drag', () => emptyDeckPage.dragOver('U001'), 'NO_ACTIVE_DRAG');
expectPageFailure('invalid interaction type', () => emptyDeckPage.interact({ type: 'not-an-interaction' }), 'INVALID_ARGUMENT');
const missingField = { ...data };
delete missingField.cards;
expectPageFailure('missing cards field', () => new DeckPageService(missingField), 'MISSING_FIELD');
expectPageFailure('empty page with manager', () => new DeckPageService({ data: createEmptyDeckPageData(), manager: emptyManager }), 'STATE_DATA_MISMATCH');

// Add/remove uses the actual DeckManagementService and persistence callback.
const saves = [];
const editable = new DeckPageService({ data, authority, availableCards: availability, persist: (serialized) => saves.push(serialized) });
assert.deepEqual(editable.addCard('U001'), { accepted: true, changed: true, reason: 'added', cardId: 'U001', deckId: 'deck-default' });
assert.equal(editable.snapshot().state.decks[0].cardEntries[0].count, 1);
assert.deepEqual(editable.removeCard('U001'), { accepted: true, changed: true, reason: 'removed', cardId: 'U001', deckId: 'deck-default' });
assert.equal(editable.snapshot().state.decks[0].cardEntries.length, 0);
assert(saves.length >= 2, 'real manager mutations must call the persistence callback');

// Page save/restore is deterministic, detached and idempotent.
editable.addCard('U002');
editable.selectCard('U002');
const serialized = editable.serialize();
const restored = DeckPageService.restore(data, serialized, { authority, availableCards: availability });
assert.equal(restored.serialize(), serialized);
assert.deepEqual(restored.snapshot().state, editable.snapshot().state);
assert.equal(restored.snapshot().selectedCardId, 'U002');
const restoredAgain = restored.restore(serialized);
assert.deepEqual(restoredAgain, restored.snapshot(), 'restoring the same save must be idempotent');

assert.equal(negativeCaseCount, 10, 'all malformed and boundary cases must execute');
console.log(`T309 deck page PASS: real-cards=${realCards.length}, components=${initial.components.length}, saves=${saves.length}, negative-cases=${negativeCaseCount}, normal/empty/invalid, selection/drag, deep-freeze, save-restore-idempotent`);
