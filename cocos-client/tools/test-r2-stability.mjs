import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  BATTLE_RUNNER_PROTOCOL,
  runBattleRunner,
} from '../assets/scripts/battle/runner/battle-runner.ts';
import {
  ObjectiveError,
  applyObjectiveEvent,
  createObjectiveState,
  deserializeObjectiveState,
  serializeObjectiveState,
  settleObjectives,
  startObjectives,
} from '../assets/scripts/core/outcome/objectives/index.ts';
import {
  CAMPAIGN_LEVEL_IDS,
  CampaignStateError,
  CampaignStateService,
} from '../assets/scripts/meta/campaign/CampaignState.ts';
import {
  CHAPTER01_STORY_NODE_IDS,
  Chapter01StoryError,
  createChapter01Story,
  restoreChapter01Story,
} from '../assets/scripts/meta/story/Chapter01Story.ts';
import {
  MAINLINE_FEATURE_IDS,
  MAINLINE_TASK_DEFINITIONS,
  MainlineTaskError,
  MainlineTaskService,
} from '../assets/scripts/meta/tasks/mainline/MainlineTasks.ts';
import {
  DEFAULT_PROFILE_RULES,
  ProfileService,
  createProfile,
} from '../assets/scripts/meta/profile/index.ts';
import {
  DeckManagementError,
  DeckManagementService,
} from '../assets/scripts/meta/decks/deck-management.ts';
import {
  ShellContractError,
  ShellService,
} from '../assets/scripts/meta/ui/shell/index.ts';
import { RewardService } from '../assets/scripts/services/RewardService.ts';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG_ROOT = path.join(PROJECT_ROOT, 'assets', 'resources', 'config');
const TICK_COUNT = 1_800;
const TICK_MS = 1_000;
const SIMULATION_DURATION_MS = TICK_COUNT * TICK_MS;
const BATTLE_INTERVAL_TICKS = 30;
const BATTLE_COUNT = TICK_COUNT / BATTLE_INTERVAL_TICKS;

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const chapterIndex = readJson(path.join(CONFIG_ROOT, 'levels/chapter01/index.json'));
const levelConfigs = chapterIndex.levels.map(({ id }) => readJson(path.join(CONFIG_ROOT, `levels/chapter01/${id}.json`)).chapterLevels[0]);
const cardsTable = readJson(path.join(CONFIG_ROOT, 'cards.json'));
const enabledCards = cardsTable.cards.filter((card) => card.enabled !== false);
const availableCards = Object.fromEntries(enabledCards.map((card) => [card.id, card.copyLimit ?? 1]));
const campaignConfig = { config: chapterIndex, levelConfigs };
const storyTaskDefinitions = CHAPTER01_STORY_NODE_IDS.map((nodeId, index) => ({
  id: `STORY-T215-${String(index + 1).padStart(2, '0')}`,
  target: 1,
  trigger: { type: 'STORY_NODE_READ', nodeId },
  unlocks: [],
}));
const storyTaskOptions = { definitions: storyTaskDefinitions, initialFeatures: [] };

const stats = {
  ticks: 0,
  battles: 0,
  battleEvents: 0,
  objectiveBattles: 0,
  objectiveEvents: 0,
  checkpoints: 0,
  restoredServices: 0,
  saves: 0,
  rollbackChecks: 0,
  recoveredExceptions: 0,
  duplicateRewards: 0,
  negativeCases: 0,
};

function expectCode(label, action, code, ErrorClass) {
  stats.negativeCases += 1;
  assert.throws(action, (error) => {
    if (ErrorClass !== undefined) assert(error instanceof ErrorClass, `${label} must throw ${ErrorClass.name}`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    return true;
  }, label);
}

function expectMessage(label, action, pattern) {
  stats.negativeCases += 1;
  assert.throws(action, (error) => {
    assert.match(String(error?.message ?? error), pattern, `${label} must match ${pattern}`);
    return true;
  }, label);
}

function assertNonNegativeResources(label, resources) {
  for (const [resource, value] of Object.entries(resources)) {
    assert(Number.isSafeInteger(value) && value >= 0, `${label}.${resource} must remain non-negative`);
  }
}

function assertFrozenBoundary(label, value) {
  assert(Object.isFrozen(value), `${label} must be frozen`);
}

function roundLimitActions() {
  return [
    { type: 'BATTLE_START' },
    ...Array.from({ length: 158 }, () => ({ type: 'END_TURN' })),
  ];
}

function heroDeathActions() {
  return [
    { type: 'BATTLE_START' },
    { type: 'DEPLOY_UNIT', cardId: 'U002', side: 'player', lane: 0, cell: 0 },
    { type: 'MOVE_UNIT', unitId: 'unit-player-1', steps: 11 },
    ...Array.from({ length: 10 }, () => ({ type: 'ATTACK', attackerId: 'unit-player-1' })),
  ];
}

function assertBattleResult(result, label) {
  assert.equal(result.status, 'ok', `${label} must return ok`);
  assert.equal(result.outcome.status, 'won', `${label} must settle as a win`);
  assert.equal(result.finalState.status, 'won', `${label} final state must be won`);
  assert.equal(result.events.filter(({ type }) => type === 'BATTLE_END').length, 1, `${label} must settle exactly once`);
  assert.equal(result.rngCursor, result.finalState.rngCursor, `${label} rng cursor must be state-derived`);
  assert.equal(typeof result.finalHash, 'string');
  for (const side of ['player', 'enemy']) {
    assert(result.finalState.heroHp[side] >= 0, `${label} ${side} hero HP must be non-negative`);
  }
  for (const unit of result.finalState.units) assert(unit.hp >= 0, `${label} unit HP must be non-negative`);
}

function runObjectiveBattle(battleNumber, atMs) {
  const configs = [
    { id: 'kill-boss', type: 'KILL', targetId: 'boss', targetSide: 'enemy', count: 1 },
    { id: 'protect-gate', type: 'DEFEND', targetId: 'gate', minHp: 5 },
    { id: 'timed-boss', type: 'TIMED', targetId: 'boss', targetSide: 'enemy', count: 1, timeLimitMs: 1_000 },
    { id: 'survive-turn', type: 'SURVIVE', durationMs: 1_000 },
  ];
  let state = startObjectives(createObjectiveState(configs), atMs, { gate: 10 });
  state = applyObjectiveEvent(state, { id: `gate-${battleNumber}`, type: 'TARGET_HEALTH', targetId: 'gate', hp: 10 });
  state = applyObjectiveEvent(state, { id: `boss-${battleNumber}`, type: 'UNIT_DEFEATED', unitId: 'boss', side: 'enemy' });
  state = applyObjectiveEvent(state, { id: `clock-${battleNumber}`, type: 'TIME_ADVANCED', deltaMs: 1_000 });
  state = settleObjectives(state, 'won', `battle-end-${battleNumber}`);
  assert.equal(state.lifecycle, 'won', `battle ${battleNumber} objectives must win`);
  assert.equal(state.settlement?.reason, 'OBJECTIVES_COMPLETE');
  const serialized = serializeObjectiveState(state);
  assert.deepEqual(deserializeObjectiveState(serialized, configs), state, 'objective save must restore exactly');
  if (battleNumber === 1) {
    assert.strictEqual(
      applyObjectiveEvent(state, { id: 'boss-1', type: 'UNIT_DEFEATED', unitId: 'boss', side: 'enemy' }),
      state,
      'duplicate objective event must be idempotent',
    );
    assertFrozenBoundary('objective state', state);
  }
  stats.objectiveBattles += 1;
  stats.objectiveEvents += state.events.length;
  return state;
}

function readAndSyncStory(story, storyTasks) {
  assert.equal(story.skipCurrent(), true, 'story node must advance once');
  storyTasks.syncStory(story.snapshot());
}

function buildServices() {
  const campaignSaves = [];
  const mainlineSaves = [];
  const storySaves = [];
  const storyTaskSaves = [];
  const profileSaves = [];
  const deckSaves = [];
  const shellSaves = [];
  let campaignPersistenceFailure = false;
  const campaignPersist = (serialized) => {
    if (campaignPersistenceFailure) throw new Error('campaign disk full');
    campaignSaves.push(serialized);
  };
  const campaign = new CampaignStateService({ ...campaignConfig, persist: campaignPersist });
  const mainline = new MainlineTaskService({
    definitions: MAINLINE_TASK_DEFINITIONS,
    initialFeatures: ['campaign', 'tasks'],
    persist: (serialized) => mainlineSaves.push(serialized),
  });
  const story = createChapter01Story({ persist: (serialized) => storySaves.push(serialized) });
  const storyTasks = new MainlineTaskService({ ...storyTaskOptions, persist: (serialized) => storyTaskSaves.push(serialized) });
  const profile = new ProfileService(
    createProfile({ level: 1, xp: 0, stamina: 100, staminaMax: 100, lastStaminaAt: 0 }),
    DEFAULT_PROFILE_RULES,
    (serialized) => profileSaves.push(serialized),
  );
  const deck = new DeckManagementService({
    metadata: cardsTable,
    availableCards,
    onSave: (serialized) => deckSaves.push(serialized),
  });
  const shell = new ShellService({
    initial: {
      page: 'home',
      enabledPages: ['home', 'campaign', 'deck', 'tasks'],
      resources: {
        silver: 5,
        crystal: 0,
        stamina: { value: 10, max: 10 },
      },
    },
    persist: (serialized) => shellSaves.push(serialized),
  });
  const reward = new RewardService(
    { resources: { silver: 0, essence: 0 }, processedRewardKeys: [] },
    () => {},
  );
  return {
    campaign,
    mainline,
    story,
    storyTasks,
    profile,
    deck,
    shell,
    reward,
    campaignSaves,
    mainlineSaves,
    storySaves,
    storyTaskSaves,
    profileSaves,
    deckSaves,
    shellSaves,
    campaignPersist,
    setCampaignPersistenceFailure(value) { campaignPersistenceFailure = value; },
  };
}

function runNegativeCases() {
  const runnerInput = { protocol: BATTLE_RUNNER_PROTOCOL, seed: 1, actions: [] };
  expectCode(
    'runner state rehydration',
    () => runBattleRunner({ ...runnerInput, finalState: {} }),
    'STATE_REHYDRATION_FORBIDDEN',
  );
  expectCode(
    'runner invalid action',
    () => runBattleRunner({ ...runnerInput, actions: [{ type: 'TELEPORT_HACK' }] }),
    'INVALID_COMMAND',
  );

  const timedConfig = [{ id: 'timed', type: 'TIMED', targetId: 'boss', count: 1, timeLimitMs: 100 }];
  expectCode('objective negative time', () => {
    const state = startObjectives(createObjectiveState(timedConfig));
    applyObjectiveEvent(state, { id: 'backwards', type: 'TIME_ADVANCED', deltaMs: -1 });
  }, 'NEGATIVE_TIME', ObjectiveError);
  expectCode('objective event after timeout', () => {
    let state = startObjectives(createObjectiveState(timedConfig));
    state = applyObjectiveEvent(state, { id: 'timeout', type: 'TIME_ADVANCED', deltaMs: 101 });
    applyObjectiveEvent(state, { id: 'late-kill', type: 'UNIT_DEFEATED', unitId: 'boss', side: 'enemy' });
  }, 'STATE_SETTLED', ObjectiveError);

  const lockedCampaign = new CampaignStateService(campaignConfig.config);
  expectCode('campaign locked level', () => lockedCampaign.selectLevel('L02'), 'LEVEL_LOCKED', CampaignStateError);
  lockedCampaign.selectLevel('L01');
  lockedCampaign.startLevel();
  expectCode('campaign invalid stars', () => lockedCampaign.completeLevel(4), 'INVALID_STARS', CampaignStateError);

  const mainline = new MainlineTaskService({ definitions: MAINLINE_TASK_DEFINITIONS, initialFeatures: ['campaign', 'tasks'] });
  expectCode('mainline invalid event', () => mainline.advance({ type: 'FEATURE_UNLOCKED', featureId: 'deck' }), 'INVALID_EVENT', MainlineTaskError);
  expectCode('mainline direct unlock', () => mainline.unlockFeature('deck'), 'INVALID_UNLOCK', MainlineTaskError);

  expectMessage('profile malformed save', () => ProfileService.fromSave('{"schemaVersion":2}'), /unsupported profile save version/);
  expectMessage('profile negative stamina', () => new ProfileService(createProfile({ stamina: 0 })).consumeStamina(1), /stamina cost exceeds/);

  const deck = new DeckManagementService({ metadata: cardsTable, availableCards });
  expectCode('deck unknown card', () => deck.addCard('U999', 1), 'UNKNOWN_CARD', DeckManagementError);
  expectCode('deck invalid count', () => deck.addCard('U001', 0), 'INVALID_CARD_COUNT', DeckManagementError);

  const shell = new ShellService();
  expectCode('shell negative resource', () => shell.setResource('silver', -1), 'INVALID_NUMBER', ShellContractError);
  expectCode('shell unknown page', () => shell.navigate('not-a-page'), 'PAGE_NOT_FOUND', ShellContractError);

  const story = createChapter01Story();
  expectCode('story out of order', () => story.skip('CH01-L01-POST'), 'OUT_OF_ORDER', Chapter01StoryError);
  expectCode('story malformed save', () => restoreChapter01Story('{'), 'INVALID_SAVE', Chapter01StoryError);
}

function runRollbackCases() {
  let failCampaignSave = true;
  const campaignSeed = new CampaignStateService(campaignConfig.config);
  campaignSeed.selectLevel('L01');
  const rollbackCampaign = new CampaignStateService({
    ...campaignConfig,
    initialState: campaignSeed.serialize(),
    persist: () => { if (failCampaignSave) throw new Error('disk full'); },
  });
  const campaignBefore = rollbackCampaign.snapshot();
  expectCode('campaign persistence rollback', () => rollbackCampaign.startLevel(), 'PERSISTENCE_FAILED', CampaignStateError);
  assert.strictEqual(rollbackCampaign.snapshot(), campaignBefore);
  failCampaignSave = false;
  rollbackCampaign.startLevel();
  stats.rollbackChecks += 1;

  let failMainlineSave = true;
  const rollbackMainline = new MainlineTaskService({
    definitions: MAINLINE_TASK_DEFINITIONS,
    initialFeatures: ['campaign', 'tasks'],
    persist: () => { if (failMainlineSave) throw new Error('mainline disk full'); },
  });
  const mainlineBefore = rollbackMainline.snapshot();
  expectCode('mainline persistence rollback', () => rollbackMainline.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' }), 'PERSISTENCE_FAILED', MainlineTaskError);
  assert.strictEqual(rollbackMainline.snapshot(), mainlineBefore);
  failMainlineSave = false;
  rollbackMainline.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' });
  stats.rollbackChecks += 1;

  let failProfileSave = true;
  const rollbackProfile = new ProfileService(createProfile(), DEFAULT_PROFILE_RULES, () => {
    if (failProfileSave) throw new Error('profile disk full');
  });
  const profileBefore = rollbackProfile.snapshot();
  expectMessage('profile persistence rollback', () => rollbackProfile.grantExperience(10), /profile disk full/);
  assert.deepEqual(rollbackProfile.snapshot(), profileBefore);
  failProfileSave = false;
  rollbackProfile.grantExperience(10);
  stats.rollbackChecks += 1;

  let failDeckSave = true;
  const rollbackDeck = new DeckManagementService({
    metadata: cardsTable,
    availableCards,
    onSave: () => { if (failDeckSave) throw new Error('deck disk full'); },
  });
  const deckBefore = rollbackDeck.snapshot();
  expectCode('deck persistence rollback', () => rollbackDeck.createDeck('不会保存'), 'PERSISTENCE_FAILED', DeckManagementError);
  assert.deepEqual(rollbackDeck.snapshot(), deckBefore);
  failDeckSave = false;
  rollbackDeck.createDeck('保存成功');
  stats.rollbackChecks += 1;

  let failShellSave = true;
  const rollbackShell = new ShellService({ persist: () => { if (failShellSave) throw new Error('shell disk full'); } });
  const shellBefore = rollbackShell.snapshot();
  expectMessage('shell persistence rollback', () => rollbackShell.setResource('silver', 99), /shell disk full/);
  assert.strictEqual(rollbackShell.snapshot(), shellBefore);
  failShellSave = false;
  rollbackShell.setResource('silver', 99);
  stats.rollbackChecks += 1;

  let failStorySave = true;
  const rollbackStory = createChapter01Story({ persist: () => { if (failStorySave) throw new Error('story disk full'); } });
  const storyBefore = rollbackStory.serialize();
  expectCode('story persistence rollback', () => rollbackStory.skipCurrent(), 'PERSISTENCE_FAILED', Chapter01StoryError);
  assert.equal(rollbackStory.serialize(), storyBefore);
  failStorySave = false;
  rollbackStory.skipCurrent();
  stats.rollbackChecks += 1;

  let failRewardSave = true;
  const rollbackReward = new RewardService(
    { resources: { silver: 0 }, processedRewardKeys: [] },
    () => { if (failRewardSave) throw new Error('reward disk full'); },
  );
  const rewardBefore = rollbackReward.snapshot();
  expectMessage('reward persistence rollback', () => rollbackReward.grant('rollback:reward', { silver: 5 }), /reward disk full/);
  assert.deepEqual(rollbackReward.snapshot(), rewardBefore);
  failRewardSave = false;
  rollbackReward.grant('rollback:reward', { silver: 5 });
  stats.rollbackChecks += 1;
}

function checkpoint(services) {
  const serialized = {
    campaign: services.campaign.save(),
    mainline: services.mainline.serialize(),
    story: services.story.save(),
    storyTasks: services.storyTasks.serialize(),
    profile: services.profile.save(),
    deck: services.deck.save(),
    shell: services.shell.save(),
  };
  stats.saves += Object.keys(serialized).length;
  services.campaign = new CampaignStateService({
    ...campaignConfig,
    initialState: serialized.campaign,
    persist: services.campaignPersist,
  });
  services.mainline = new MainlineTaskService({
    definitions: MAINLINE_TASK_DEFINITIONS,
    initialFeatures: ['campaign', 'tasks'],
    initialState: serialized.mainline,
    persist: (value) => services.mainlineSaves.push(value),
  });
  services.story = restoreChapter01Story(serialized.story, { persist: (value) => services.storySaves.push(value) });
  services.storyTasks = new MainlineTaskService({
    ...storyTaskOptions,
    initialState: serialized.storyTasks,
    persist: (value) => services.storyTaskSaves.push(value),
  });
  services.profile = ProfileService.fromSave(serialized.profile, DEFAULT_PROFILE_RULES, (value) => services.profileSaves.push(value));
  services.deck = DeckManagementService.restore(cardsTable, serialized.deck, {
    availableCards,
    onSave: (value) => services.deckSaves.push(value),
  });
  services.shell = ShellService.fromSerialized(serialized.shell, (value) => services.shellSaves.push(value));
  stats.checkpoints += 1;
  stats.restoredServices += 7;
}

function runSimulation() {
  const services = buildServices();
  let longObjective = startObjectives(
    createObjectiveState([{ id: 'thirty-minute-survival', type: 'SURVIVE', durationMs: SIMULATION_DURATION_MS }]),
    0,
  );
  const pages = ['home', 'campaign', 'deck', 'tasks'];
  const deterministicInput = { protocol: BATTLE_RUNNER_PROTOCOL, seed: 42, actions: roundLimitActions() };
  const deterministicA = runBattleRunner(deterministicInput);
  const deterministicB = runBattleRunner(JSON.parse(JSON.stringify(deterministicInput)));
  assert.deepEqual(deterministicA, deterministicB, 'same runner seed and actions must be byte-equivalent data');
  assert.notEqual(
    runBattleRunner({ protocol: BATTLE_RUNNER_PROTOCOL, seed: 42, actions: [{ type: 'BATTLE_START' }] }).finalHash,
    runBattleRunner({ protocol: BATTLE_RUNNER_PROTOCOL, seed: 43, actions: [{ type: 'BATTLE_START' }] }).finalHash,
    'seed must affect runner output',
  );
  assertBattleResult(deterministicA, 'determinism probe');
  assertFrozenBoundary('battle final state', deterministicA.finalState);

  const combatProbe = runBattleRunner({
    protocol: BATTLE_RUNNER_PROTOCOL,
    seed: 223,
    actions: [
      { type: 'BATTLE_START' },
      { type: 'DEPLOY_UNIT', cardId: 'U002', side: 'player', lane: 0, cell: 0 },
      { type: 'MOVE_UNIT', unitId: 'unit-player-1', steps: 2 },
      { type: 'END_TURN' },
      { type: 'DEPLOY_UNIT', cardId: 'U002', side: 'enemy', lane: 0, cell: 11 },
      { type: 'MOVE_UNIT', unitId: 'unit-enemy-2', steps: 8 },
      { type: 'END_TURN' },
      { type: 'ATTACK', attackerId: 'unit-player-1' },
      { type: 'END_TURN' },
    ],
  });
  assert.equal(combatProbe.events.some(({ type }) => type === 'ATTACK'), true, 'combat probe must exercise attack resolution');
  assert.equal(combatProbe.events.some(({ type }) => type === 'UNIT_MOVED'), true, 'combat probe must exercise movement');

  let deckId = services.deck.createDeck({ id: 't215-stability', name: 'T215稳定编队' }).id;
  services.deck.addCard(deckId, 'U001', 1);
  services.deck.addCard(deckId, 'S001', 1);
  services.deck.switchDeck(deckId);
  assert.equal(services.deck.getCurrentDeck().cardEntries.length, 2);
  assertFrozenBoundary('deck snapshot', services.deck.snapshot());

  for (let tick = 1; tick <= TICK_COUNT; tick += 1) {
    stats.ticks = tick;
    longObjective = applyObjectiveEvent(longObjective, {
      id: `clock-${tick}`,
      type: 'TIME_ADVANCED',
      deltaMs: TICK_MS,
    });
    if (tick % 10 === 0) services.shell.navigate(pages[(tick / 10) % pages.length]);
    if (tick % 15 === 0) services.shell.adjustResource('crystal', 1);
    services.profile.recoverStamina(tick * TICK_MS);

    if (tick % BATTLE_INTERVAL_TICKS === 0) {
      const battleNumber = tick / BATTLE_INTERVAL_TICKS;
      const levelIndex = (battleNumber - 1) % CAMPAIGN_LEVEL_IDS.length;
      const levelId = CAMPAIGN_LEVEL_IDS[levelIndex];
      services.profile.consumeStamina(1);
      services.shell.adjustResource('silver', -1);
      services.shell.adjustResource('silver', 2);
      if (battleNumber === 1) {
        readAndSyncStory(services.story, services.storyTasks);
        assert.equal(services.story.currentNode().id, 'CH01-L01-PRE');
      }
      if (battleNumber <= CAMPAIGN_LEVEL_IDS.length) {
        assert.equal(services.story.currentNode().levelId, levelId, `${levelId} story must precede its battle`);
        readAndSyncStory(services.story, services.storyTasks);
      }
      services.campaign.selectLevel(levelId);
      services.campaign.startLevel();
      if (battleNumber === 13) {
        const beforeFailure = services.campaign.snapshot();
        services.setCampaignPersistenceFailure(true);
        expectCode('campaign replay persistence recovery', () => services.campaign.failLevel(levelId), 'PERSISTENCE_FAILED', CampaignStateError);
        assert.strictEqual(services.campaign.snapshot(), beforeFailure);
        services.setCampaignPersistenceFailure(false);
        services.campaign.failLevel(levelId);
        services.campaign.startLevel();
        stats.recoveredExceptions += 1;
      }
      const battleInput = battleNumber % 2 === 0
        ? { protocol: BATTLE_RUNNER_PROTOCOL, seed: 42, actions: roundLimitActions() }
        : { protocol: BATTLE_RUNNER_PROTOCOL, seed: 223, actions: heroDeathActions() };
      const result = runBattleRunner({
        ...battleInput,
      });
      assertBattleResult(result, `continuous battle ${battleNumber}`);
      services.campaign.completeLevel(levelId, 3 - (battleNumber % 3 === 0 ? 1 : 0));
      if (battleNumber <= CAMPAIGN_LEVEL_IDS.length) {
        if (levelId === 'L12') {
          readAndSyncStory(services.story, services.storyTasks);
          assert.equal(services.story.currentNode().id, 'CH01-L12-POST');
        }
        readAndSyncStory(services.story, services.storyTasks);
      }

      if (battleNumber <= CAMPAIGN_LEVEL_IDS.length) {
        services.mainline.syncCampaign(services.campaign.snapshot());
        const taskId = `M4-10-${levelId}`;
        if (battleNumber === 1) {
          let firstRewardFailure = true;
          expectCode('mainline reward callback recovery', () => services.mainline.claim(taskId, (_task, businessKey) => {
            if (firstRewardFailure) {
              firstRewardFailure = false;
              throw new Error('reward sink unavailable');
            }
            services.reward.grant(businessKey, { silver: 10, essence: 1 });
          }), 'REWARD_FAILED', MainlineTaskError);
          stats.recoveredExceptions += 1;
          assert.equal(services.mainline.getTask(taskId).claimed, true);
          const flushed = services.mainline.flushRewards((_task, businessKey) => {
            services.reward.grant(businessKey, { silver: 10, essence: 1 });
          });
          assert.equal(flushed[0].code, 'DELIVERED');
          services.mainline.acknowledgeReward(flushed[0].businessKey);
        } else {
          const claimed = services.mainline.claim(taskId, (_task, businessKey) => {
            services.reward.grant(businessKey, { silver: 10 + battleNumber, essence: 1 });
          });
          assert.equal(claimed.code, 'APPLIED');
          services.mainline.acknowledgeReward(claimed.businessKey);
        }
        const rewardKey = `mainline:CHAPTER01:${taskId}`;
        const duplicateReward = services.reward.grant(rewardKey, { silver: 999, essence: 999 });
        assert.equal(duplicateReward.applied, false, `${rewardKey} reward must remain idempotent`);
        stats.duplicateRewards += 1;
      }

      runObjectiveBattle(battleNumber, tick * TICK_MS);
      stats.battles += 1;
      stats.battleEvents += result.events.length;
    }

    assertNonNegativeResources('shell resources', Object.fromEntries(services.shell.snapshot().resources.map(({ id, value }) => [id, value])));
    assertNonNegativeResources('reward resources', services.reward.snapshot().resources);
    assert(services.profile.snapshot().stamina >= 0, 'profile stamina must remain non-negative');

    if (tick === 600 || tick === 1_200) {
      longObjective = deserializeObjectiveState(serializeObjectiveState(longObjective), [{ id: 'thirty-minute-survival', type: 'SURVIVE', durationMs: SIMULATION_DURATION_MS }]);
      checkpoint(services);
      assert.equal(services.campaign.snapshot().activeLevelId, null);
      assert.equal(services.story.snapshot().readNodeIds.length, CHAPTER01_STORY_NODE_IDS.length);
      assert.equal(services.mainline.snapshot().chapter.completed, true);
      assert.deepEqual(services.deck.snapshot(), DeckManagementService.restore(cardsTable, services.deck.save(), { availableCards }).snapshot());
      assert.deepEqual(services.shell.snapshot(), ShellService.fromSerialized(services.shell.save()).snapshot());
      assert.deepEqual(services.profile.snapshot(), ProfileService.fromSave(services.profile.save()).snapshot());
    }
  }

  assert.equal(stats.ticks, TICK_COUNT);
  assert.equal(longObjective.elapsedMs, SIMULATION_DURATION_MS);
  assert.equal(longObjective.lifecycle, 'won');
  assertFrozenBoundary('long objective final state', longObjective);
  assert.equal(services.campaign.snapshot().levels.L12.firstClear, true);
  assert.equal(services.campaign.snapshot().levels.L01.replayCount, 5);
  assert.equal(services.campaign.snapshot().levels.L01.failureCount, 1);
  assert.equal(services.mainline.snapshot().chapter.completed, true);
  assert.deepEqual(services.mainline.snapshot().features && Object.keys(services.mainline.snapshot().features).filter((id) => services.mainline.isFeatureUnlocked(id)), [
    ...Object.keys(services.mainline.snapshot().features),
  ]);
  for (const featureId of MAINLINE_FEATURE_IDS) assert.equal(services.mainline.isFeatureUnlocked(featureId), true, `${featureId} must unlock after chapter clear`);
  assert.equal(services.story.snapshot().currentNodeId, null);
  assert.equal(services.storyTasks.snapshot().chapter.completed, true);
  assert.equal(services.deck.currentDeckId, deckId);
  assert(services.reward.snapshot().resources.silver > 0);
  assertNonNegativeResources('final reward resources', services.reward.snapshot().resources);
  assert(services.campaignSaves.length > 0 && services.mainlineSaves.length > 0 && services.storySaves.length > 0, 'service persistence must be exercised');
  assert(services.profileSaves.length > 0 && services.deckSaves.length > 0 && services.shellSaves.length > 0, 'meta persistence must be exercised');
  return services;
}

runNegativeCases();
runRollbackCases();
const finalServices = runSimulation();

assert(stats.checkpoints >= 2, 'simulation must restore at least two multi-service checkpoints');
assert.equal(stats.restoredServices, stats.checkpoints * 7);
assert.equal(stats.battles, BATTLE_COUNT);
assert.equal(stats.objectiveBattles, BATTLE_COUNT);
assert.equal(stats.duplicateRewards, CAMPAIGN_LEVEL_IDS.length);
assert(stats.negativeCases >= 15, 'negative-case coverage must remain meaningful');
assert(stats.recoveredExceptions >= 2, 'exception recovery must be exercised');
assert(stats.rollbackChecks >= 7, 'all stateful services must exercise rollback');
assert.equal(finalServices.campaign.snapshot().activeLevelId, null);

console.log(
  `T215 R2 stability PASS: ticks=${stats.ticks}, battles=${stats.battles}, objectiveBattles=${stats.objectiveBattles}, `
  + `battleEvents=${stats.battleEvents}, objectiveEvents=${stats.objectiveEvents}, checkpoints=${stats.checkpoints}, `
  + `restoredServices=${stats.restoredServices}, saves=${stats.saves}, rollbackChecks=${stats.rollbackChecks}, `
  + `recoveredExceptions=${stats.recoveredExceptions}, duplicateRewards=${stats.duplicateRewards}, negativeCases=${stats.negativeCases}`,
);
