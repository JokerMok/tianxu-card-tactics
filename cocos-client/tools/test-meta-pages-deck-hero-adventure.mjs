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
  ADVENTURE_DEFAULT_DATA,
  ADVENTURE_MODE_IDS,
  AdventurePageError,
  AdventurePageService,
  createDefaultAdventurePageData,
  restoreAdventurePageService,
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
let deckPage = new DeckPageService({
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
let heroPage = new HeroPageService({ data: heroData, persist: (serialized) => heroSaves.push(serialized) });
const initialHeroSnapshot = heroPage.snapshot();
assert.equal(initialHeroSnapshot.pageId, 'hero');
assert.equal(initialHeroSnapshot.validation.valid, true);
assert.deepEqual(initialHeroSnapshot.components.find(({ id }) => id === 'profile')?.equipment, heroEquipment);

const productionModeDefinitions = ADVENTURE_DEFAULT_DATA.tasks;
assert.deepEqual(
  productionModeDefinitions.map(({ mode }) => mode),
  [...ADVENTURE_MODE_IDS],
  'adventure modes must come from the production page data and cover the production mode contract',
);
assert.deepEqual(
  productionModeDefinitions.map(({ id }) => id),
  productionModeDefinitions.map(({ mode }) => mode),
  'production adventure mode task ids must remain the mode source, not test-only ids',
);
const adventureLevelIds = ['L05', 'L07', 'L09'];
const adventureLevels = adventureLevelIds.map((levelId) => {
  const levelEntry = levelIndex.levels.find(({ id }) => id === levelId);
  assert(levelEntry, `chapter level ${levelId} must be listed in the real level index`);
  const levelDocument = readJson(`assets/resources/config/levels/chapter01/${levelId}.json`);
  assert.equal(levelDocument.chapterLevels.length, 1, `${levelId} must contain one real level row`);
  assert.equal(levelDocument.chapterLevels[0].id, levelId, `${levelId} must match the real level index`);
  const definition = MAINLINE_TASK_DEFINITIONS.find(({ trigger }) => trigger.levelId === levelId);
  assert(definition, `${levelId} must have a real mainline task definition`);
  return { levelEntry, level: levelDocument.chapterLevels[0], definition };
});
assert.equal(adventureLevels.length, productionModeDefinitions.length, 'real level evidence must cover every production adventure mode');
const adventureTasks = adventureLevels.map(({ level, definition }, index) => ({
  id: definition.id,
  mode: productionModeDefinitions[index].mode,
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
assert.deepEqual(adventureData.tasks.map(({ mode }) => mode), productionModeDefinitions.map(({ mode }) => mode));
assert.deepEqual(
  adventureData.tasks.map(({ objective }) => objective),
  adventureLevels.map(({ level }) => level.objectives[0].type),
  'adventure objectives must be projected from the real level configs',
);
const adventureSaves = [];
let adventurePage = new AdventurePageService({
  data: adventureData,
  persist: (serialized) => adventureSaves.push(serialized),
});
const initialAdventureSnapshot = adventurePage.snapshot();
assert.equal(initialAdventureSnapshot.pageId, 'adventure');
assert.equal(initialAdventureSnapshot.components.find(({ id }) => id === 'header')?.totalTasks, adventureTasks.length);
assert.deepEqual(
  initialAdventureSnapshot.components.find(({ id }) => id === 'filters')?.modes.map(({ id }) => id),
  productionModeDefinitions.map(({ mode }) => mode),
  'adventure mode options must come from the production configured tasks',
);

// The shell and all three page services are real instances. The registry is
// derived from each production service's pageId; it does not restate route ids
// in a test-owned map. The shell contract then proves the derived ids are wired.
function createPageRegistry() {
  const services = [deckPage, heroPage, adventurePage];
  const entries = services.map((service) => {
    const pageId = service.snapshot().pageId;
    assert(SHELL_NAVIGATION.some(({ id }) => id === pageId), `page service ${pageId} must be present in the production shell route contract`);
    return [pageId, service];
  });
  assert.equal(new Set(entries.map(([pageId]) => pageId)).size, services.length, 'componentized page services must expose unique production page ids');
  const routeOrder = SHELL_NAVIGATION
    .filter(({ id }) => entries.some(([pageId]) => pageId === id))
    .map(({ id }) => id);
  assert.deepEqual(routeOrder, entries.map(([pageId]) => pageId), 'componentized page order must follow the production shell route contract');
  return Object.fromEntries(entries);
}

let pages = createPageRegistry();
const shellSaves = [];
const shell = new ShellService({ persist: (serialized) => shellSaves.push(serialized) });
assert.deepEqual(
  SHELL_NAVIGATION.filter(({ id }) => Object.prototype.hasOwnProperty.call(pages, id)).map(({ id }) => id),
  Object.keys(pages),
  'shell navigation must expose all componentized page services in production order',
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

const deckSavePayload = deckPage.save();
const deckSaveData = JSON.parse(deckSavePayload);
assert.equal(deckSaveData.pageId, 'deck');
assert.equal(deckSaveData.selectedCardId, selectedCardId);
const restoredDeckPage = DeckPageService.restore(deckData, JSON.stringify(deckSaveData), {
  authority: {
    cards: cardsTable.cards,
    decks: decksTable.decks,
    professions: professionsTable.professions,
  },
  availableCards,
});
deckPage = restoredDeckPage;
pages = createPageRegistry();
const restoredDeckSnapshot = deckPage.snapshot();
assert.deepEqual(restoredDeckPage.pageData.cards.map(({ id }) => id), realCards.map(({ id }) => id));
assert.deepEqual(
  restoredDeckSnapshot.components.filter(({ kind }) => kind === 'deckCard').map(({ id }) => id.replace(/^deck-card-/, '')),
  realDeck.cardEntries.map(({ cardId }) => cardId),
  'restored deck instance must rebuild the real card list from its saved payload',
);
assert.equal(restoredDeckSnapshot.currentDeckId, realDeck.id);
assert.equal(restoredDeckSnapshot.selectedCardId, selectedCardId);
assert.equal(restoredDeckSnapshot.components.find(({ id }) => id === `deck-card-${selectedCardId}`)?.selected, true);

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
const heroSavePayload = heroPage.save();
const heroSaveData = JSON.parse(heroSavePayload);
assert.equal(heroSaveData.pageId, 'hero');
assert.equal(heroSaveData.selectedProfessionId, selectedProfessionId);
heroPage = HeroPageService.fromSerialized(heroData, JSON.stringify(heroSaveData));
pages = createPageRegistry();
const restoredHeroSnapshot = heroPage.snapshot();
assert.equal(restoredHeroSnapshot.selectedProfessionId, selectedProfessionId);
assert.equal(restoredHeroSnapshot.components.find(({ id }) => id === 'detail')?.professionId, selectedProfessionId);
assert.deepEqual(
  restoredHeroSnapshot.components.find(({ id }) => id === 'profile')?.equipment,
  heroEquipment,
  'restored hero instance must rebuild the profession and equipment state from its saved payload',
);
assert.deepEqual(
  restoredHeroSnapshot.components.find(({ id }) => id === 'profession-selector')?.options.map(({ professionId }) => professionId),
  realProfessions.map(({ id }) => id),
);
assert.equal(
  restoredHeroSnapshot.components.find(({ id }) => id === 'profession-selector')?.options.find(({ selected }) => selected)?.professionId,
  selectedProfessionId,
);

assert.deepEqual(shell.navigate('adventure'), { accepted: true, changed: true, page: 'adventure', reason: 'selected' });
assert.deepEqual(shell.snapshot().history, ['home', 'deck', 'hero']);
const targetAdventureMode = productionModeDefinitions[1].mode;
const targetAdventureTask = adventureTasks.find(({ mode }) => mode === targetAdventureMode);
assert(targetAdventureTask, 'the mode under integration must come from the production adventure mode list');
const towerTaskId = targetAdventureTask.id;
const filterResult = adventurePage.setFilter({ mode: targetAdventureMode });
assert.deepEqual(filterResult, {
  accepted: true,
  changed: true,
  reason: 'filtered',
  taskId: towerTaskId,
  mode: targetAdventureMode,
  progress: 0,
});
const filteredAdventureSnapshot = adventurePage.snapshot();
assert.deepEqual(filteredAdventureSnapshot.filter, { mode: targetAdventureMode, status: 'all', taskIds: [] });
assert.deepEqual(filteredAdventureSnapshot.components.filter(({ kind }) => kind === 'task').map(({ taskId }) => taskId), [towerTaskId]);
assert.equal(filteredAdventureSnapshot.components.find(({ id }) => id === 'filters')?.modes.find(({ id }) => id === targetAdventureMode)?.selected, true);
assert.deepEqual(adventurePage.startAdventure(towerTaskId), {
  accepted: true,
  changed: true,
  reason: 'started',
  taskId: towerTaskId,
  mode: targetAdventureMode,
  progress: 0,
});
assert.equal(adventurePage.snapshot().activeTaskId, towerTaskId);
assert.equal(adventurePage.snapshot().components.find(({ id }) => id === `task-${towerTaskId}`)?.active, true);
assert.deepEqual(adventurePage.completeAdventure(towerTaskId), {
  accepted: true,
  changed: true,
  reason: 'completed',
  taskId: towerTaskId,
  mode: targetAdventureMode,
  progress: adventureTasks.find(({ id }) => id === towerTaskId).target,
});
assert.deepEqual(adventurePage.claimReward(towerTaskId), {
  accepted: true,
  changed: true,
  reason: 'claimed',
  taskId: towerTaskId,
  mode: targetAdventureMode,
  progress: adventureTasks.find(({ id }) => id === towerTaskId).target,
});
const claimedAdventureSnapshot = adventurePage.snapshot();
assert.equal(claimedAdventureSnapshot.state.tasks[towerTaskId].status, 'claimed');
assert.equal(claimedAdventureSnapshot.state.tasks[towerTaskId].claimed, true);
assert.equal(claimedAdventureSnapshot.components.find(({ id }) => id === `task-${towerTaskId}`)?.mode, targetAdventureMode);
const adventureSavePayload = adventurePage.save();
const adventureSaveData = JSON.parse(adventureSavePayload);
assert.equal(adventureSaveData.pageId, 'adventure');
assert.equal(adventureSaveData.filter.mode, targetAdventureMode);
assert.equal(adventureSaveData.tasks[towerTaskId].status, 'claimed');
const restoredAdventurePage = restoreAdventurePageService(adventureData, JSON.stringify(adventureSaveData));
adventurePage = restoredAdventurePage;
pages = createPageRegistry();
const restoredAdventureSnapshot = adventurePage.snapshot();
assert.deepEqual(restoredAdventurePage.pageData.tasks.map(({ id }) => id), adventureData.tasks.map(({ id }) => id));
assert.deepEqual(restoredAdventureSnapshot.components.filter(({ kind }) => kind === 'task').map(({ taskId }) => taskId), [towerTaskId]);
assert.deepEqual(restoredAdventureSnapshot.filter, { mode: targetAdventureMode, status: 'all', taskIds: [] });
assert.equal(restoredAdventureSnapshot.state.tasks[towerTaskId].status, 'claimed');
assert.equal(restoredAdventureSnapshot.components.find(({ id }) => id === `task-${towerTaskId}`)?.state, 'claimed');

const shellSavePayload = shell.save();
const shellSaveData = JSON.parse(shellSavePayload);
assert.equal(shellSaveData.page, 'adventure');
assert.deepEqual(shellSaveData.history, ['home', 'deck', 'hero']);
const restoredShell = ShellService.fromSerialized(JSON.stringify(shellSaveData));
assert.equal(restoredShell.snapshot().page, adventurePage.snapshot().pageId);
assert.deepEqual(restoredShell.snapshot().history, ['home', 'deck', 'hero']);
assert.deepEqual(
  restoredShell.snapshot().navigation.filter(({ selected }) => selected).map(({ id }) => id),
  [adventurePage.snapshot().pageId],
  'restored shell navigation must select the restored adventure page route',
);
assert.deepEqual(restoredShell.back(), { accepted: true, changed: true, page: 'hero', reason: 'back' });

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
assert.deepEqual(returnedAdventureSnapshot.filter, { mode: targetAdventureMode, status: 'all', taskIds: [] });
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

console.log(`T246 meta page integration PASS: pages=${Object.keys(pages).join(',')}, real-cards=${realCards.length}, professions=${realProfessions.length}, equipment=${heroEquipment.length}, modes=${productionModeDefinitions.length}, shell-saves=${shellSaves.length}, hero-saves=${heroSaves.length}, adventure-saves=${adventureSaves.length}, payload-restore=deck/hero/adventure/shell, navigation/back, data-driven-list/equipment/mode-state, negative-cases=4`);
