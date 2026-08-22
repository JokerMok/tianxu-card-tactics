import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { createDefaultState } from '../assets/scripts/meta/GameState.ts';
import { CARD_INVENTORY_SOURCES } from '../assets/scripts/meta/cards/card-inventory.ts';
import {
  CampaignPageService,
  createDefaultCampaignPageData,
} from '../assets/scripts/meta/ui/pages/home-campaign-cards/campaign/index.ts';
import {
  CardsPageService,
  createCardsPageData,
} from '../assets/scripts/meta/ui/pages/home-campaign-cards/cards/index.ts';
import {
  HomePageService,
  createDefaultHomePageData,
} from '../assets/scripts/meta/ui/pages/home-campaign-cards/home/index.ts';
import { ShellService } from '../assets/scripts/meta/ui/shell/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const cardsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const campaignIndex = JSON.parse(fs.readFileSync(
  path.join(root, 'assets/resources/config/levels/chapter01/index.json'),
  'utf8',
));

const pageSourceRoots = [
  'assets/scripts/meta/ui/pages/home-campaign-cards/home',
  'assets/scripts/meta/ui/pages/home-campaign-cards/campaign',
  'assets/scripts/meta/ui/pages/home-campaign-cards/cards',
];
for (const sourceRoot of pageSourceRoots) {
  for (const file of fs.readdirSync(path.join(root, sourceRoot)).filter((entry) => entry.endsWith('.ts'))) {
    const source = fs.readFileSync(path.join(root, sourceRoot, file), 'utf8');
    assert.doesNotMatch(source, /from ['"]cc['"]|require\(['"]cc['"]\)/, `${sourceRoot}/${file} must remain adapter-friendly`);
    assert.doesNotMatch(source, /UI0[123]|loadSprite|整图/, `${sourceRoot}/${file} must not depend on page artwork text or numbers`);
  }
}

function component(snapshot, id) {
  const found = snapshot.components.find((entry) => entry.id === id);
  assert(found, `${snapshot.pageId} must expose component ${id}`);
  return found;
}

function saveCollector(saved, writes, key) {
  return (serialized) => {
    saved.set(key, serialized);
    writes[key].push(serialized);
  };
}

const saved = new Map();
const writes = { shell: [], campaign: [], cards: [] };
const shell = new ShellService({ persist: saveCollector(saved, writes, 'shell') });

const baseHomeData = createDefaultHomePageData();
const homeData = {
  ...baseHomeData,
  player: { ...baseHomeData.player, name: '集成主将', level: 17 },
  mission: {
    ...baseHomeData.mission,
    stage: '9-9',
    title: '动态任务',
    description: '由集成数据驱动的任务说明。',
  },
};
const home = new HomePageService(homeData);

const baseCampaignData = createDefaultCampaignPageData();
const campaignData = {
  ...baseCampaignData,
  title: '集成征战',
  levels: baseCampaignData.levels.map((level, index) => ({
    ...level,
    title: index === 0 ? '动态关卡' : level.title,
    recommendedPower: index === 0 ? 4321 : level.recommendedPower,
    staminaCost: index === 0 ? 9 : level.staminaCost,
    rewards: level.rewards.map((reward, rewardIndex) => ({
      ...reward,
      quantity: index === 0 && rewardIndex === 0 ? 777 : reward.quantity,
    })),
  })),
};

let campaign = new CampaignPageService({
  data: campaignData,
  config: campaignIndex,
  persist: saveCollector(saved, writes, 'campaign'),
});

const cardsPageData = createCardsPageData(cardsTable);
const starterInventory = JSON.stringify({
  schemaVersion: 1,
  entries: [
    { cardId: 'U001', quantity: 2, quality: 4, locked: true, source: CARD_INVENTORY_SOURCES[0] },
  ],
  filter: {},
  sort: { field: 'cardId', direction: 'asc' },
});
const cardsInitialState = JSON.stringify({
  schemaVersion: 1,
  selectedCardId: 'U001',
  selectedQuality: 4,
  inventory: starterInventory,
});
let cards = new CardsPageService({
  data: cardsPageData,
  initialState: cardsInitialState,
  persist: saveCollector(saved, writes, 'cards'),
});

// The shell is the navigation authority; page services own only their page state.
assert.equal(shell.snapshot().page, 'home');
assert.deepEqual(shell.snapshot().history, []);

const gameState = createDefaultState();
const initialResources = shell.snapshot().resources.map(({ id, value, max }) => ({ id, value, max }));
assert.deepEqual(initialResources, [
  { id: 'stamina', value: gameState.resources.stamina, max: gameState.resources.staminaMax },
  { id: 'silver', value: gameState.resources.silver, max: null },
  { id: 'crystal', value: gameState.resources.crystal, max: null },
  { id: 'towerTicket', value: gameState.resources.towerTicket, max: null },
], 'shell resources must come from structured game state');

// HOME: component values and the mission route are data-driven, then handed to the shell.
const homeInitial = home.snapshot();
assert.equal(component(homeInitial, 'hero').title, homeData.player.name);
assert.equal(component(homeInitial, 'hero').value, `Lv.${homeData.player.level}`);
assert.equal(component(homeInitial, 'mission').stage, homeData.mission.stage);
assert.equal(component(homeInitial, 'mission').title, homeData.mission.title);
assert.equal(component(homeInitial, 'mission').target, 'campaign');

const homeMissionResult = home.interact({ type: 'activateMission' });
assert.deepEqual(homeMissionResult, {
  accepted: true,
  changed: true,
  reason: 'navigated',
  target: 'campaign',
});
assert.equal(home.snapshot().selectedComponentId, 'mission');
assert.deepEqual(shell.navigate(homeMissionResult.target), {
  accepted: true,
  changed: true,
  page: 'campaign',
  reason: 'selected',
});
assert.deepEqual(shell.snapshot().history, ['home']);

// CAMPAIGN: selection, active attempt, settlement, unlock, and numeric projection form one state machine.
const campaignInitial = campaign.snapshot();
const campaignInitialDetail = component(campaignInitial, 'detail');
assert.equal(campaignInitial.pageId, 'campaign');
assert.equal(campaignInitial.selectedLevelId, campaignData.levels[0].id);
assert.equal(campaignInitialDetail.title, campaignData.levels[0].title);
assert.equal(campaignInitialDetail.recommendedPower, campaignData.levels[0].recommendedPower);
assert.equal(campaignInitialDetail.staminaCost, campaignData.levels[0].staminaCost);
assert.equal(campaignInitialDetail.rewards[0].quantity, campaignData.levels[0].rewards[0].quantity);
assert.equal(campaignInitialDetail.canStart, true);

assert.deepEqual(campaign.startLevel(), {
  accepted: true,
  changed: true,
  reason: 'started',
  levelId: 'L01',
});
const campaignInProgress = campaign.snapshot();
assert.equal(campaignInProgress.activeLevelId, 'L01');
assert.equal(component(campaignInProgress, 'level-L01').state, 'inProgress');
assert.equal(component(campaignInProgress, 'detail').active, true);
assert.equal(component(campaignInProgress, 'detail').canStart, false);
assert(writes.campaign.length > 0, 'campaign state transition must persist a real save');

assert.deepEqual(campaign.completeLevel(3), {
  accepted: true,
  changed: true,
  reason: 'completed',
  levelId: 'L01',
});
const campaignCleared = campaign.snapshot();
assert.equal(campaignCleared.activeLevelId, null);
assert.equal(campaignCleared.state.levels.L01.firstClear, true);
assert.equal(campaignCleared.state.levels.L01.stars, 3);
assert.equal(campaignCleared.state.levels.L02.unlocked, true);
assert.equal(component(campaignCleared, 'level-L01').state, 'cleared');
assert.equal(component(campaignCleared, 'level-L02').state, 'ready');
assert.equal(component(campaignCleared, 'header').clearedLevels, 1);
assert.equal(component(campaignCleared, 'header').earnedStars, 3);
assert.equal(component(campaignCleared, 'detail').rewards[0].quantity, campaignData.levels[0].rewards[0].quantity);

assert.deepEqual(campaign.interact({ type: 'selectLevel', levelId: 'L02' }), {
  accepted: true,
  changed: true,
  reason: 'selected',
  levelId: 'L02',
});
const campaignBeforeLeave = campaign.snapshot();
assert.equal(campaignBeforeLeave.selectedLevelId, 'L02');
assert.equal(component(campaignBeforeLeave, 'detail').levelId, 'L02');
const campaignSerialized = campaign.serialize();
saved.set('campaign', campaignSerialized);

// CARDS: real registry metadata, ownership, quality detail, and filtering remain structured after navigation.
assert.deepEqual(shell.navigate('cards'), {
  accepted: true,
  changed: true,
  page: 'cards',
  reason: 'selected',
});
assert.deepEqual(shell.snapshot().history, ['home', 'campaign']);

const cardsInitial = cards.snapshot();
const u001 = cardsPageData.cards.find((card) => card.id === 'U001');
const u004 = cardsPageData.cards.find((card) => card.id === 'U004');
assert(u001, 'real card registry must contain U001');
assert(u004, 'real card registry must contain U004');
assert.equal(cardsInitial.components.find((entry) => entry.id === 'header').totalCards, cardsPageData.cards.length);
assert.equal(cardsInitial.components.find((entry) => entry.id === 'header').visibleCards, cardsPageData.cards.length);
assert.equal(component(cardsInitial, 'detail').cardId, u001.id);
assert.equal(component(cardsInitial, 'detail').nameKey, u001.nameKey);
assert.equal(component(cardsInitial, 'detail').ownedQuantity, 2);
assert.equal(component(cardsInitial, 'detail').locked, true);
assert.equal(component(cardsInitial, 'detail').selectedQuality, 4);
assert.deepEqual(
  component(cardsInitial, 'detail').selectedQualityDefinition,
  u001.qualities.find((quality) => quality.quality === 4),
);

assert.deepEqual(cards.selectCard(u004.id), {
  accepted: true,
  changed: true,
  reason: 'selected',
  selectedCardId: u004.id,
});
const u004Quality = u004.qualities.at(-1).quality;
assert.deepEqual(cards.selectQuality(u004Quality), {
  accepted: true,
  changed: true,
  reason: 'selected',
  selectedCardId: u004.id,
});
assert.deepEqual(cards.setFilter({ cardIds: [u004.id] }), {
  accepted: true,
  changed: true,
  reason: 'filtered',
  selectedCardId: u004.id,
});
const cardsBeforeLeave = cards.snapshot();
assert.equal(cardsBeforeLeave.selectedCardId, u004.id);
assert.equal(cardsBeforeLeave.selectedQuality, u004Quality);
assert.equal(component(cardsBeforeLeave, 'header').visibleCards, 1);
assert.equal(component(cardsBeforeLeave, `card-${u004.id}`).state, 'selected');
assert.deepEqual(component(cardsBeforeLeave, 'detail').selectedQualityDefinition, u004.qualities.find((quality) => quality.quality === u004Quality));

const cardsWritesBeforeSameSelection = writes.cards.length;
assert.deepEqual(cards.selectCard(u004.id), {
  accepted: true,
  changed: false,
  reason: 'same',
  selectedCardId: u004.id,
});
assert.equal(writes.cards.length, cardsWritesBeforeSameSelection, 'same card selection must not create a duplicate save');
const cardsSerialized = cards.serialize();
saved.set('cards', cardsSerialized);

// Leave and re-enter pages through the shell, reconstructing each service from the persisted page state.
assert.deepEqual(shell.back(), {
  accepted: true,
  changed: true,
  page: 'campaign',
  reason: 'back',
});
campaign = new CampaignPageService({
  data: campaignData,
  config: campaignIndex,
  initialState: campaignSerialized,
  persist: saveCollector(saved, writes, 'campaign'),
});
assert.deepEqual(campaign.snapshot(), campaignBeforeLeave, 'campaign state must survive cards navigation and restore');

assert.deepEqual(shell.navigate('cards'), {
  accepted: true,
  changed: true,
  page: 'cards',
  reason: 'selected',
});
cards = new CardsPageService({
  data: cardsPageData,
  initialState: cardsSerialized,
  persist: saveCollector(saved, writes, 'cards'),
});
assert.deepEqual(cards.snapshot(), cardsBeforeLeave, 'cards selection, quality, filter, and inventory must survive re-entry');

assert.deepEqual(shell.back(), {
  accepted: true,
  changed: true,
  page: 'campaign',
  reason: 'back',
});
assert.deepEqual(shell.back(), {
  accepted: true,
  changed: true,
  page: 'home',
  reason: 'back',
});
assert.deepEqual(shell.back(), {
  accepted: false,
  changed: false,
  page: 'home',
  reason: 'back',
});
assert.equal(home.snapshot().selectedComponentId, 'mission');
assert.equal(home.snapshot().components.find((entry) => entry.id === 'mission').title, homeData.mission.title);

const shellSerialized = shell.serialize();
const restoredShell = ShellService.fromSerialized(shellSerialized);
assert.deepEqual(restoredShell.snapshot(), shell.snapshot(), 'shell page and resource state must round-trip');
assert.deepEqual(
  shell.snapshot().resources.map(({ id, value, max }) => ({ id, value, max })),
  initialResources,
  'page transitions must not overwrite top-bar resource state',
);

console.log(
  `T245 home-campaign-cards integration PASS: pages=3, campaign-clears=${component(campaignBeforeLeave, 'header').clearedLevels}, `
  + `cards=${cardsPageData.cards.length}, visible-after-filter=${component(cardsBeforeLeave, 'header').visibleCards}, `
  + `shell-history-round-trip=true, page-state-restore=true, resource-state-preserved=true`,
);
