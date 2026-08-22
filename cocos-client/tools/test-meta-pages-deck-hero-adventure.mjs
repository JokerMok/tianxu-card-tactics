import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SHELL_NAVIGATION,
  ShellContractError,
  ShellService,
} from '../assets/scripts/meta/ui/shell/index.ts';
import { DeckManagementService } from '../assets/scripts/meta/decks/deck-management.ts';
import {
  DeckPageError,
  DeckPageService,
  createDefaultDeckPageData,
} from '../assets/scripts/meta/ui/pages/deck-hero-adventure/deck/index.ts';
import {
  HeroPageError,
  HeroPageService,
  createHeroPageData,
} from '../assets/scripts/meta/ui/pages/deck-hero-adventure/hero/index.ts';
import {
  AdventurePageError,
  AdventurePageService,
  createDefaultAdventurePageData,
} from '../assets/scripts/meta/ui/pages/deck-hero-adventure/adventure/index.ts';
import { MAINLINE_TASK_DEFINITIONS } from '../assets/scripts/meta/tasks/mainline/index.ts';

const root = path.resolve(import.meta.dirname, '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

function enabledRows(table, key) {
  return table[key].filter((row) => row.enabled !== false);
}

function expectFailure(label, action, ErrorType, code) {
  assert.throws(action, (error) => {
    assert(error instanceof ErrorType, `${label} must use ${ErrorType.name}`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    return true;
  }, label);
}

const cardsTable = readJson('assets/resources/config/cards.json');
const decksTable = readJson('assets/resources/config/decks.json');
const professionsTable = readJson('assets/resources/config/professions.json');
const levelIndex = readJson('assets/resources/config/levels/chapter01/index.json');

const realCards = enabledRows(cardsTable, 'cards');
const realDecks = enabledRows(decksTable, 'decks');
const realProfessions = enabledRows(professionsTable, 'professions');
const realDeck = realDecks.find((deck) => deck.id === 'D001');
assert(realDeck, 'the integration must use the real D001 deck');
assert.equal(realDeck.profession, 'P001');
assert(realCards.length >= 30, 'the integration must use the real enabled card list');
assert(realProfessions.length > 0, 'the integration must use the real profession list');

const availableCards = Object.fromEntries(realCards.map((card) => [card.id, card.copyLimit]));
const deckState = {
  schemaVersion: 1,
  decks: [{
    id: realDeck.id,
    name: realDeck.name ?? realDeck.id,
    cardEntries: realDeck.cardEntries.map(({ cardId, count }) => ({ cardId, count })),
  }],
  currentDeckId: realDeck.id,
};
const deckData = createDefaultDeckPageData({
  metadata: cardsTable,
  decks: decksTable,
  professionId: realDeck.profession,
});
assert.deepEqual(deckData.cards.map(({ id }) => id), realCards.map(({ id }) => id), 'deck list must be projected from cards.json');
assert.deepEqual(
  [deckData.totalCards, deckData.minUnitCards, deckData.maxSkillCards],
  [realDeck.totalCards, realDeck.minUnitCards, realDeck.maxSkillCards],
  'deck limits must be projected from the real deck config',
);
const deckPage = new DeckPageService({
  data: deckData,
  manager: new DeckManagementService({
    metadata: cardsTable,
    availableCards,
    state: deckState,
  }),
  authority: {
    cards: cardsTable.cards,
    decks: decksTable.decks,
    professions: professionsTable.professions,
  },
});
const initialDeckSnapshot = deckPage.snapshot();
assert.equal(initialDeckSnapshot.pageId, 'deck');
assert.equal(initialDeckSnapshot.currentDeckId, realDeck.id);
assert.equal(initialDeckSnapshot.validation.status, 'valid');
assert.equal(initialDeckSnapshot.components.find(({ id }) => id === 'header')?.cardCount, realDeck.totalCards);
assert.equal(initialDeckSnapshot.components.filter(({ kind }) => kind === 'deckCard').length, realDeck.cardEntries.length);

const heroEquipment = [
  { slot: 'weapon', name: '玄铁断刃', level: 5 },
  { slot: 'helmet', name: '边军兜鍪', level: 3 },
];
const heroData = createHeroPageData({
  hero: {
    id: 'H001',
    name: '岳沉戈',
    level: 8,
    xp: 320,
    power: 1680,
    professionId: realDeck.profession,
    equipment: heroEquipment,
  },
  professions: professionsTable,
  cards: cardsTable,
  decks: decksTable,
});
assert.deepEqual(heroData.professions.map(({ id }) => id), realProfessions.map(({ id }) => id), 'hero list must be projected from professions.json');
assert.equal(heroData.decks.find(({ professionId }) => professionId === realDeck.profession)?.id, realDeck.id);
const heroSaves = [];
const heroPage = new HeroPageService({ data: heroData, persist: (serialized) => heroSaves.push(serialized) });
const initialHeroSnapshot = heroPage.snapshot();
assert.equal(initialHeroSnapshot.pageId, 'hero');
assert.equal(initialHeroSnapshot.validation.valid, true);
assert.deepEqual(initialHeroSnapshot.components.find(({ id }) => id === 'profile')?.equipment, heroEquipment);

const modeByLevelId = new Map([
  ['L05', 'dungeon'],
  ['L07', 'tower'],
  ['L09', 'boss'],
]);
const adventureLevels = [...modeByLevelId.keys()].map((levelId) => {
  const levelEntry = levelIndex.levels.find(({ id }) => id === levelId);
  assert(levelEntry, `chapter level ${levelId} must be listed in the real level index`);
  const levelDocument = readJson(`assets/resources/config/levels/chapter01/${levelId}.json`);
  assert.equal(levelDocument.chapterLevels.length, 1, `${levelId} must contain one real level row`);
  assert.equal(levelDocument.chapterLevels[0].id, levelId, `${levelId} must match the real level index`);
  const definition = MAINLINE_TASK_DEFINITIONS.find(({ trigger }) => trigger.levelId === levelId);
  assert(definition, `${levelId} must have a real mainline task definition`);
  return { levelEntry, level: levelDocument.chapterLevels[0], definition };
});
const adventureTasks = adventureLevels.map(({ level, definition }) => ({
  id: definition.id,
  mode: modeByLevelId.get(level.id),
  label: definition.title ?? definition.id,
  title: definition.title ?? definition.id,
  description: `${level.id}:${level.environmentElement}`,
  objective: level.objectives[0].type,
  target: definition.target,
  rewards: level.rewards.map((reward) => ({
    id: reward.id,
    label: `${reward.type}:${reward.id}`,
    quantity: reward.quantity,
    type: reward.type,
  })),
  prerequisiteTaskId: null,
}));
const adventureData = createDefaultAdventurePageData({ tasks: adventureTasks });
assert.deepEqual(adventureData.tasks.map(({ id }) => id), adventureTasks.map(({ id }) => id));
assert.deepEqual(adventureData.tasks.map(({ mode }) => mode), [...modeByLevelId.values()]);
assert.deepEqual(
  adventureData.tasks.map(({ objective }) => objective),
  adventureLevels.map(({ level }) => level.objectives[0].type),
  'adventure objectives must be projected from the real level configs',
);
const adventureSaves = [];
const adventurePage = new AdventurePageService({
  data: adventureData,
  persist: (serialized) => adventureSaves.push(serialized),
});
const initialAdventureSnapshot = adventurePage.snapshot();
assert.equal(initialAdventureSnapshot.pageId, 'adventure');
assert.equal(initialAdventureSnapshot.components.find(({ id }) => id === 'header')?.totalTasks, adventureTasks.length);
assert.deepEqual(
  initialAdventureSnapshot.components.find(({ id }) => id === 'filters')?.modes.map(({ id }) => id),
  [...modeByLevelId.values()],
  'adventure mode options must come from the configured tasks',
);

// The shell and all three page services are real instances. This route map is the
// smallest test-side binding needed to assert that navigation does not recreate or
// silently reset a page's component state.
const pages = { deck: deckPage, hero: heroPage, adventure: adventurePage };
const shellSaves = [];
const shell = new ShellService({ persist: (serialized) => shellSaves.push(serialized) });
assert.deepEqual(
  SHELL_NAVIGATION.filter(({ id }) => pages[id]).map(({ id }) => id),
  ['deck', 'hero', 'adventure'],
  'shell navigation must expose all three componentized pages in order',
);
assert.equal(shell.snapshot().page, 'home');

assert.deepEqual(shell.navigate('deck'), { accepted: true, changed: true, page: 'deck', reason: 'selected' });
assert.deepEqual(shell.snapshot().history, ['home']);
assert.equal(pages[shell.snapshot().page].snapshot().pageId, 'deck');
const selectedCardId = realDeck.cardEntries[0].cardId;
assert.deepEqual(deckPage.selectCard(selectedCardId), {
  accepted: true,
  changed: true,
  reason: 'selected',
  cardId: selectedCardId,
  deckId: realDeck.id,
});
assert.equal(deckPage.snapshot().selectedCardId, selectedCardId);
assert.equal(deckPage.snapshot().components.find(({ id }) => id === `deck-card-${selectedCardId}`)?.selected, true);

assert.deepEqual(shell.navigate('hero'), { accepted: true, changed: true, page: 'hero', reason: 'selected' });
assert.deepEqual(shell.snapshot().history, ['home', 'deck']);
const selectedProfessionId = realProfessions.at(-1).id;
const selectedHeroResult = heroPage.selectProfession(selectedProfessionId);
assert.equal(selectedHeroResult.accepted, true);
assert.equal(selectedHeroResult.professionId, selectedProfessionId);
assert.equal(selectedHeroResult.deckId, heroData.decks.find(({ professionId }) => professionId === selectedProfessionId)?.id);
const selectedHeroSnapshot = heroPage.snapshot();
assert.equal(selectedHeroSnapshot.selectedProfessionId, selectedProfessionId);
assert.equal(selectedHeroSnapshot.components.find(({ id }) => id === 'detail')?.professionId, selectedProfessionId);
assert.deepEqual(
  selectedHeroSnapshot.components.find(({ id }) => id === 'profile')?.equipment,
  heroEquipment,
  'profession selection must not drop the data-driven equipment projection',
);

assert.deepEqual(shell.navigate('adventure'), { accepted: true, changed: true, page: 'adventure', reason: 'selected' });
assert.deepEqual(shell.snapshot().history, ['home', 'deck', 'hero']);
const towerTaskId = adventureTasks.find(({ mode }) => mode === 'tower').id;
const filterResult = adventurePage.setFilter({ mode: 'tower' });
assert.deepEqual(filterResult, {
  accepted: true,
  changed: true,
  reason: 'filtered',
  taskId: towerTaskId,
  mode: 'tower',
  progress: 0,
});
const filteredAdventureSnapshot = adventurePage.snapshot();
assert.deepEqual(filteredAdventureSnapshot.filter, { mode: 'tower', status: 'all', taskIds: [] });
assert.deepEqual(filteredAdventureSnapshot.components.filter(({ kind }) => kind === 'task').map(({ taskId }) => taskId), [towerTaskId]);
assert.equal(filteredAdventureSnapshot.components.find(({ id }) => id === 'filters')?.modes.find(({ id }) => id === 'tower')?.selected, true);
assert.deepEqual(adventurePage.startAdventure(towerTaskId), {
  accepted: true,
  changed: true,
  reason: 'started',
  taskId: towerTaskId,
  mode: 'tower',
  progress: 0,
});
assert.equal(adventurePage.snapshot().activeTaskId, towerTaskId);
assert.equal(adventurePage.snapshot().components.find(({ id }) => id === `task-${towerTaskId}`)?.active, true);
assert.deepEqual(adventurePage.completeAdventure(towerTaskId), {
  accepted: true,
  changed: true,
  reason: 'completed',
  taskId: towerTaskId,
  mode: 'tower',
  progress: adventureTasks.find(({ id }) => id === towerTaskId).target,
});
assert.deepEqual(adventurePage.claimReward(towerTaskId), {
  accepted: true,
  changed: true,
  reason: 'claimed',
  taskId: towerTaskId,
  mode: 'tower',
  progress: adventureTasks.find(({ id }) => id === towerTaskId).target,
});
const claimedAdventureSnapshot = adventurePage.snapshot();
assert.equal(claimedAdventureSnapshot.state.tasks[towerTaskId].status, 'claimed');
assert.equal(claimedAdventureSnapshot.state.tasks[towerTaskId].claimed, true);
assert.equal(claimedAdventureSnapshot.components.find(({ id }) => id === `task-${towerTaskId}`)?.mode, 'tower');

// Back navigation must return to the same service instances and preserve their
// selection/equipment/mode state instead of only changing the shell page id.
assert.deepEqual(shell.back(), { accepted: true, changed: true, page: 'hero', reason: 'back' });
assert.equal(heroPage.snapshot().selectedProfessionId, selectedProfessionId);
assert.deepEqual(heroPage.snapshot().components.find(({ id }) => id === 'profile')?.equipment, heroEquipment);
assert.deepEqual(shell.back(), { accepted: true, changed: true, page: 'deck', reason: 'back' });
assert.equal(deckPage.snapshot().selectedCardId, selectedCardId);
assert.equal(deckPage.snapshot().components.find(({ id }) => id === `deck-card-${selectedCardId}`)?.selected, true);
assert.deepEqual(shell.navigate('adventure'), { accepted: true, changed: true, page: 'adventure', reason: 'selected' });
const returnedAdventureSnapshot = adventurePage.snapshot();
assert.deepEqual(returnedAdventureSnapshot.filter, { mode: 'tower', status: 'all', taskIds: [] });
assert.equal(returnedAdventureSnapshot.state.tasks[towerTaskId].status, 'claimed');
assert.equal(returnedAdventureSnapshot.components.find(({ id }) => id === `task-${towerTaskId}`)?.state, 'claimed');
assert.deepEqual(shell.back(), { accepted: true, changed: true, page: 'deck', reason: 'back' });
assert.deepEqual(shell.back(), { accepted: true, changed: true, page: 'home', reason: 'back' });
assert.deepEqual(shell.snapshot().history, []);
assert(shellSaves.length >= 8, 'shell navigation and back transitions must be persisted');
assert(heroSaves.length >= 1, 'hero selection must remain an observable page transition');
assert(adventureSaves.length >= 4, 'adventure filter and lifecycle transitions must be persisted');

// Integration boundaries must fail through the owning service, not silently reset.
expectFailure('unknown shell page', () => shell.navigate('not-a-page'), ShellContractError, 'PAGE_NOT_FOUND');
expectFailure('unknown selected card', () => deckPage.selectCard('U999'), DeckPageError, 'CARD_NOT_FOUND');
expectFailure('unknown selected profession', () => heroPage.selectProfession('P999'), HeroPageError, 'PROFESSION_NOT_FOUND');
expectFailure('unknown adventure mode', () => adventurePage.setFilter({ mode: 'not-a-mode' }), AdventurePageError, 'FILTER_INVALID');

console.log(`T246 meta page integration PASS: pages=deck,hero,adventure, real-cards=${realCards.length}, professions=${realProfessions.length}, equipment=${heroEquipment.length}, modes=${modeByLevelId.size}, shell-saves=${shellSaves.length}, hero-saves=${heroSaves.length}, adventure-saves=${adventureSaves.length}, navigation/back, data-driven-list/equipment/mode-state, negative-cases=4`);
