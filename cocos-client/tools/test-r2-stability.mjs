import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
const LONG_OBJECTIVE_CONFIG = [{ id: 'thirty-minute-survival', type: 'SURVIVE', durationMs: SIMULATION_DURATION_MS }];
const ROUND_LIMIT_SEEDS = Object.freeze([
  6, 8, 14, 18, 20, 26, 28, 34, 36, 42, 44, 48, 54, 56, 62, 64, 70, 72, 78, 82,
  84, 90, 92, 98, 100, 106, 108, 112, 118, 120, 126, 130, 132, 138, 140, 144, 150,
  152, 158, 160, 166, 168, 174, 178, 180, 186, 188, 194, 196, 202, 204, 208, 214,
  216, 222, 224, 230, 232, 238, 242, 244, 250, 252,
].slice(0, BATTLE_COUNT));
assert.equal(ROUND_LIMIT_SEEDS.length, BATTLE_COUNT, 'round-limit seed fixture must match battle count');

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
  restoredObjectives: 0,
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

function battleInputFor(battleNumber) {
  assert(battleNumber >= 1 && battleNumber <= ROUND_LIMIT_SEEDS.length, `battle ${battleNumber} must have a safe runner seed`);
  return {
    protocol: BATTLE_RUNNER_PROTOCOL,
    seed: ROUND_LIMIT_SEEDS[battleNumber - 1],
    professionId: `P00${(battleNumber % 4) + 1}`,
    actions: roundLimitActions(),
  };
}

function heroDeathActions() {
  return [
    { type: 'BATTLE_START' },
    { type: 'DEPLOY_UNIT', cardId: 'U002', side: 'player', lane: 0, cell: 0 },
    { type: 'MOVE_UNIT', unitId: 'unit-player-1', steps: 11 },
    ...Array.from({ length: 10 }, () => ({ type: 'ATTACK', attackerId: 'unit-player-1' })),
  ];
}

function assertRunnerContract(result, expectedActionCount, label, expectedSeed) {
  assert.equal(result.protocol, BATTLE_RUNNER_PROTOCOL, `${label} protocol must match`);
  assert.equal(result.status, 'ok', `${label} status must be ok`);
  assert.equal(result.runner, 'cocos-battle', `${label} runner must match`);
  assert.equal(result.actionCount, expectedActionCount, `${label} actionCount must match input`);
  if (expectedSeed !== undefined) assert.equal(result.seed, expectedSeed, `${label} seed must match input`);
}

function battleEndEvent(result, label) {
  const battleEnds = result.events.filter(({ type }) => type === 'BATTLE_END');
  assert.equal(battleEnds.length, 1, `${label} must contain exactly one BATTLE_END`);
  const battleEnd = battleEnds[0];
  assert.equal(battleEnd.payload.status, result.outcome.status, `${label} BATTLE_END status must match outcome`);
  assert.equal(battleEnd.payload.winner, result.outcome.winner, `${label} BATTLE_END winner must match outcome`);
  return battleEnd;
}

function assertBattleResult(result, label, expectedActionCount = result.actionCount, expectedSeed) {
  assertRunnerContract(result, expectedActionCount, label, expectedSeed);
  assert.equal(result.status, 'ok', `${label} must return ok`);
  assert.equal(result.outcome.status, 'won', `${label} must settle as a win`);
  assert.equal(result.finalState.status, 'won', `${label} final state must be won`);
  battleEndEvent(result, label);
  assert.equal(result.rngCursor, result.finalState.rngCursor, `${label} rng cursor must be state-derived`);
  assert.equal(typeof result.finalHash, 'string');
  for (const side of ['player', 'enemy']) {
    assert(result.finalState.heroHp[side] >= 0, `${label} ${side} hero HP must be non-negative`);
  }
  for (const unit of result.finalState.units) assert(unit.hp >= 0, `${label} unit HP must be non-negative`);
}

function assertObjectiveRoundTrip(state, configs, label, repeatedEvent) {
  const serialized = serializeObjectiveState(state);
  const restored = deserializeObjectiveState(serialized, configs);
  assert.deepEqual(restored, state, `${label} JSON round-trip must restore exactly`);
  if (repeatedEvent !== undefined) {
    assert.strictEqual(applyObjectiveEvent(restored, repeatedEvent), restored, `${label} repeated event must be idempotent`);
  }
  assertFrozenBoundary(label, restored);
  return restored;
}

function assertRunnerEventSource(event, expectedType, label) {
  assert(event, `${label} source event must exist`);
  assert(Number.isSafeInteger(event.eventId) && event.eventId >= 0, `${label} source eventId must be numeric`);
  assert.equal(event.type, expectedType, `${label} source type must be ${expectedType}`);
  assert(event.payload !== null && typeof event.payload === 'object', `${label} source payload must be present`);
  return event;
}

function adaptRunnerEvent(event, expectedType, mapPayload, label) {
  const source = assertRunnerEventSource(event, expectedType, label);
  const objectiveEvent = mapPayload(source.payload, source);
  assert.equal(objectiveEvent.eventId, source.eventId, `${label} must retain the runner numeric eventId`);
  return objectiveEvent;
}

function adaptBattleStartedEvent(event, expectedSeed, label) {
  return adaptRunnerEvent(event, 'BATTLE_START', (payload, source) => {
    assert.equal(payload.seed, expectedSeed, `${label} payload.seed must match runner seed`);
    return { eventId: source.eventId, type: 'BATTLE_STARTED' };
  }, label);
}

function adaptRoundStartEvent(event, expectedRound, label) {
  return adaptRunnerEvent(event, 'ROUND_START', (payload, source) => {
    assert.equal(payload.round, expectedRound, `${label} payload.round must be source-derived`);
    assert.equal(source.round, expectedRound, `${label} round must be source-derived`);
    return { eventId: source.eventId, type: 'TIME_ADVANCED', deltaMs: 1_000 };
  }, label);
}

function adaptUnitDiedEvent(event, label) {
  return adaptRunnerEvent(event, 'UNIT_DIED', (payload, source) => {
    assert.equal(source.activeSide, 'player', `${label} source activeSide must be player`);
    assert.equal(payload.unitId, 'unit-enemy-2', `${label} payload.unitId must identify the real defeated unit`);
    assert.equal(payload.cardId, 'U002', `${label} payload.cardId must remain runner-derived`);
    return {
      eventId: source.eventId,
      type: 'UNIT_DEFEATED',
      unitId: payload.unitId,
      side: 'enemy',
    };
  }, label);
}

function adaptHeroDamageEvent(event, hp, label) {
  return adaptRunnerEvent(event, 'DAMAGE', (payload, source) => {
    assert.equal(source.activeSide, 'player', `${label} source activeSide must be player`);
    assert.equal(payload.targetKind, 'hero', `${label} payload.targetKind must be hero`);
    assert.equal(payload.targetId, 'enemy', `${label} payload.targetId must identify the enemy hero`);
    assert(Number.isSafeInteger(payload.value) && payload.value > 0, `${label} payload.value must be positive damage`);
    assert(Number.isSafeInteger(hp) && hp >= 0, `${label} mapped HP must remain non-negative`);
    return { eventId: source.eventId, type: 'TARGET_HEALTH', targetId: 'enemy-hero', hp };
  }, label);
}

function adaptBattleEndEvent(event, expectedOutcome, label) {
  return adaptRunnerEvent(event, 'BATTLE_END', (payload, source) => {
    assert.equal(payload.status, expectedOutcome, `${label} payload.status must match runner outcome`);
    assert.equal(payload.winner, 'player', `${label} payload.winner must remain source-derived`);
    assert.equal(payload.reason, 'HERO_DEFEATED', `${label} payload.reason must remain source-derived`);
    return { eventId: source.eventId, type: 'BATTLE_ENDED', outcome: payload.status };
  }, label);
}

function adaptBattleEndedEvent(event, expectedOutcome, label) {
  return adaptRunnerEvent(event, 'BATTLE_END', (payload, source) => {
    assert.equal(payload.status, expectedOutcome, `${label} payload.status must match runner outcome`);
    return { eventId: source.eventId, type: 'BATTLE_ENDED', outcome: payload.status };
  }, label);
}

function runObjectiveCoverage(unitDeathProbe, heroDeathProbe) {
  const unitBattleStart = unitDeathProbe.events.find(({ type }) => type === 'BATTLE_START');
  const unitRoundStart = unitDeathProbe.events.find(({ type, payload }) => type === 'ROUND_START' && payload.round === 1);
  const unitDied = unitDeathProbe.events.find(({ type, payload }) => type === 'UNIT_DIED' && payload.unitId === 'unit-enemy-2');
  const unitBattleStarted = adaptBattleStartedEvent(unitBattleStart, unitDeathProbe.seed, 'unit-death BATTLE_START');
  const unitTimeAdvanced = adaptRoundStartEvent(unitRoundStart, 1, 'unit-death ROUND_START');
  const unitDefeated = adaptUnitDiedEvent(unitDied, 'unit-death UNIT_DIED');
  assert.equal(unitDied.eventId, 32, 'unit-death source must retain the verified runner eventId');

  const killConfig = [{ id: 'kill-enemy-unit', type: 'KILL', targetId: 'unit-enemy-2', targetSide: 'enemy', count: 1 }];
  let killState = createObjectiveState(killConfig);
  killState = applyObjectiveEvent(killState, unitBattleStarted);
  killState = applyObjectiveEvent(killState, unitDefeated);
  assert.equal(killState.objectives[0].status, 'completed', 'KILL must use the real UNIT_DIED payload');
  assert.equal(killState.lifecycle, 'won', 'KILL must settle as won');
  assertObjectiveRoundTrip(killState, killConfig, 'KILL objective', unitDefeated);
  stats.objectiveEvents += killState.events.length;

  const timedConfig = [{ id: 'timed-enemy-unit', type: 'TIMED', targetId: 'unit-enemy-2', targetSide: 'enemy', count: 1, timeLimitMs: 1_000 }];
  let timedState = createObjectiveState(timedConfig);
  timedState = applyObjectiveEvent(timedState, unitBattleStarted);
  timedState = applyObjectiveEvent(timedState, unitTimeAdvanced);
  assert.equal(timedState.elapsedMs, 1_000, 'TIMED must apply the real ROUND_START at the legal time limit');
  timedState = applyObjectiveEvent(timedState, unitDefeated);
  assert.equal(timedState.objectives[0].status, 'completed', 'TIMED must accept a kill at the inclusive time limit');
  assert.equal(timedState.lifecycle, 'won', 'TIMED must settle as won at the boundary');
  assertObjectiveRoundTrip(timedState, timedConfig, 'TIMED objective', unitDefeated);
  stats.objectiveEvents += timedState.events.length;

  const heroBattleStart = heroDeathProbe.events.find(({ type }) => type === 'BATTLE_START');
  const heroRoundStart = heroDeathProbe.events.find(({ type, payload }) => type === 'ROUND_START' && payload.round === 1);
  const heroBattleEnd = heroDeathProbe.events.find(({ type }) => type === 'BATTLE_END');
  const heroBattleStarted = adaptBattleStartedEvent(heroBattleStart, heroDeathProbe.seed, 'hero-death BATTLE_START');
  const heroTimeAdvanced = adaptRoundStartEvent(heroRoundStart, 1, 'hero-death ROUND_START');
  const heroDamageSources = heroDeathProbe.events.filter(({ type, payload }) => type === 'DAMAGE' && payload.targetKind === 'hero' && payload.targetId === 'enemy');
  assert(heroDamageSources.length > 0, 'hero-death probe must expose real hero DAMAGE events');
  let enemyHeroHp = 30;
  const heroDamageEvents = heroDamageSources.map((source, index) => {
    const damage = source.payload.value;
    assert(Number.isSafeInteger(damage) && damage > 0, `hero DAMAGE ${index + 1} must expose positive payload.value`);
    enemyHeroHp -= damage;
    return adaptHeroDamageEvent(source, enemyHeroHp, `hero-death DAMAGE ${index + 1}`);
  });
  assert.equal(enemyHeroHp, heroDeathProbe.finalState.heroHp.enemy, 'mapped hero HP must equal runner finalState.heroHp.enemy');
  assert(heroDamageEvents.some(({ hp }) => hp > 0), 'DEFEND must cover a positive TARGET_HEALTH path');
  const heroBattleEnded = adaptBattleEndEvent(heroBattleEnd, heroDeathProbe.outcome.status, 'hero-death BATTLE_END');

  const defendConfig = [{ id: 'defend-enemy-hero', type: 'DEFEND', targetId: 'enemy-hero', minHp: 1 }];
  assert.equal(defendConfig[0].minHp, 1, 'DEFEND minHp must remain positive under the objective schema');
  let defendState = createObjectiveState(defendConfig);
  defendState = applyObjectiveEvent(defendState, heroBattleStarted);
  defendState = applyObjectiveEvent(defendState, heroDamageEvents[0]);
  assert(defendState.objectives[0].currentHp > defendConfig[0].minHp, 'DEFEND must cover a positive TARGET_HEALTH path');
  defendState = applyObjectiveEvent(defendState, heroBattleEnded);
  assert.equal(defendState.objectives[0].status, 'completed', 'DEFEND must complete from the real BATTLE_END after health updates');
  assert.equal(defendState.lifecycle, 'won', 'DEFEND must settle as won');
  assertObjectiveRoundTrip(defendState, defendConfig, 'DEFEND objective', heroDamageEvents[0]);
  let defendFailureState = createObjectiveState(defendConfig);
  defendFailureState = applyObjectiveEvent(defendFailureState, heroBattleStarted);
  for (const event of heroDamageEvents) defendFailureState = applyObjectiveEvent(defendFailureState, event);
  assert.equal(defendFailureState.objectives[0].currentHp, 0, 'DEFEND failure must retain the final real TARGET_HEALTH value');
  assert.equal(defendFailureState.lifecycle, 'lost', 'DEFEND must fail when the real hero reaches HP 0');
  assertObjectiveRoundTrip(defendFailureState, defendConfig, 'DEFEND failure objective', heroDamageEvents.at(-1));
  stats.objectiveEvents += defendState.events.length + defendFailureState.events.length;

  const surviveConfig = [{ id: 'survive-one-round', type: 'SURVIVE', durationMs: 1_000 }];
  let surviveState = createObjectiveState(surviveConfig);
  surviveState = applyObjectiveEvent(surviveState, unitBattleStarted);
  surviveState = applyObjectiveEvent(surviveState, unitTimeAdvanced);
  assert.equal(surviveState.elapsedMs, 1_000, 'SURVIVE must use the real round duration');
  assert.equal(surviveState.objectives[0].status, 'completed', 'SURVIVE must auto-win at its duration');
  assert.equal(surviveState.lifecycle, 'won', 'SURVIVE must settle as won at its duration');
  assertObjectiveRoundTrip(surviveState, surviveConfig, 'SURVIVE objective', unitTimeAdvanced);
  surviveState = createObjectiveState(surviveConfig);
  surviveState = applyObjectiveEvent(surviveState, heroBattleStarted);
  surviveState = applyObjectiveEvent(surviveState, heroTimeAdvanced);
  assert.equal(surviveState.elapsedMs, 1_000, 'SURVIVE must also accept the hero-death ROUND_START source');
  assert.equal(surviveState.lifecycle, 'won', 'SURVIVE hero-death source must settle as won');
  stats.objectiveEvents += surviveState.events.length;
}

function runObjectiveBattle(battleNumber, atMs, result) {
  const battleEnd = battleEndEvent(result, `battle ${battleNumber} objective source`);
  assert.equal(battleEnd.payload.reason, 'ROUND_LIMIT', `battle ${battleNumber} must use real ROUND_LIMIT result for DEFEND`);
  assert.equal(result.finalState.round, battleEnd.round, `battle ${battleNumber} DEFEND source round must be runner-derived`);
  assert(result.finalState.heroHp.player > 0, `battle ${battleNumber} DEFEND source player HP must remain positive`);
  const config = {
    id: `protect-player-hero-${battleNumber}`,
    type: 'DEFEND',
    targetId: 'player-hero',
    minHp: result.finalState.heroHp.player,
  };
  let state = startObjectives(createObjectiveState([config]), atMs, {
    'player-hero': result.finalState.heroHp.player,
  });
  assert.equal(state.objectives[0].currentHp, result.finalState.heroHp.player, `battle ${battleNumber} DEFEND HP must use runner state`);
  const objectiveEvent = {
    ...adaptBattleEndedEvent(battleEnd, result.outcome.status, `battle ${battleNumber} BATTLE_END`),
  };
  state = applyObjectiveEvent(state, objectiveEvent);
  assert.equal(state.lifecycle, result.outcome.status, `battle ${battleNumber} objectives must match runner result`);
  assert.equal(state.settlement?.status, result.outcome.status);
  assert.equal(state.settlement?.reason, 'OBJECTIVES_COMPLETE');
  assertObjectiveRoundTrip(state, [config], `DEFEND objective ${battleNumber}`);
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
  const rewardSaves = [];
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
    (state) => rewardSaves.push(state),
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
    rewardSaves,
    campaignPersist,
    setCampaignPersistenceFailure(value) { campaignPersistenceFailure = value; },
  };
}

function runNegativeCases() {
  const runnerInput = {
    protocol: BATTLE_RUNNER_PROTOCOL,
    seed: 42,
    professionId: 'P001',
    actions: roundLimitActions(),
  };
  const inProcessOutput = runBattleRunner(runnerInput);
  assertBattleResult(inProcessOutput, 'runner in-process positive output', runnerInput.actions.length);
  const runnerScriptPath = path.join(PROJECT_ROOT, 'assets', 'scripts', 'battle', 'runner', 'battle-runner.ts');
  const cliInput = spawnSync(process.execPath, ['--experimental-strip-types', runnerScriptPath], {
    input: JSON.stringify(runnerInput),
    encoding: 'utf8',
  });
  assert.equal(cliInput.status, 0, 'runner CLI valid input must exit zero');
  const cliOutput = JSON.parse(cliInput.stdout);
  assertRunnerContract(cliOutput, runnerInput.actions.length, 'runner CLI valid output');
  assert.deepEqual(cliOutput, inProcessOutput, 'runner CLI and in-process output must be identical');

  const invalidProtocolInput = { ...runnerInput, protocol: 'tianxu.cocos-battle-runner/invalid' };
  expectCode(
    'runner invalid protocol',
    () => runBattleRunner(invalidProtocolInput),
    'INVALID_INPUT',
  );
  const cliInvalidProtocol = spawnSync(process.execPath, ['--experimental-strip-types', runnerScriptPath], {
    input: JSON.stringify(invalidProtocolInput),
    encoding: 'utf8',
  });
  assert.equal(cliInvalidProtocol.status, 1, 'runner CLI invalid protocol must exit one');
  const cliError = JSON.parse(cliInvalidProtocol.stdout);
  assert.equal(cliError.protocol, BATTLE_RUNNER_PROTOCOL);
  assert.equal(cliError.status, 'error');
  assert.equal(cliError.error.code, 'INVALID_INPUT');
  const cliInvalidJson = spawnSync(process.execPath, ['--experimental-strip-types', runnerScriptPath], {
    input: '{',
    encoding: 'utf8',
  });
  assert.equal(cliInvalidJson.status, 1, 'runner CLI malformed JSON must exit one');
  assert.equal(JSON.parse(cliInvalidJson.stdout).error.code, 'INVALID_JSON');

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

  expectCode('campaign corrupted save', () => CampaignStateService.restore(campaignConfig.config, '{'), 'INVALID_SAVE', CampaignStateError);
  expectCode('mainline corrupted save', () => MainlineTaskService.fromSave(
    MAINLINE_TASK_DEFINITIONS,
    '{',
    { initialFeatures: ['campaign', 'tasks'] },
  ), 'INVALID_SAVE', MainlineTaskError);
  expectCode('deck corrupted save', () => DeckManagementService.restore(cardsTable, '{', { availableCards }), 'INVALID_STATE', DeckManagementError);
  expectCode('shell corrupted save', () => ShellService.fromSerialized('{'), 'INVALID_SAVE', ShellContractError);
  expectCode('objective corrupted save', () => deserializeObjectiveState('{', [
    { id: 'survive', type: 'SURVIVE', durationMs: 1_000 },
  ]), 'INVALID_STATE', ObjectiveError);
  expectMessage(
    'reward corrupted save',
    () => new RewardService(JSON.parse('{"resources":{"silver":-1},"processedRewardKeys":[]}'), () => {}),
    /reward state resources are invalid/,
  );
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

function checkpoint(services, longObjective) {
  const rewardBefore = services.reward.snapshot();
  const lastProcessedRewardKey = rewardBefore.processedRewardKeys.at(-1);
  const replayObjectiveEvent = longObjective.events.at(-1);
  assert(replayObjectiveEvent, 'long objective checkpoint must have a previously processed event');
  const serialized = {
    campaign: services.campaign.save(),
    mainline: services.mainline.serialize(),
    story: services.story.save(),
    storyTasks: services.storyTasks.serialize(),
    profile: services.profile.save(),
    deck: services.deck.save(),
    shell: services.shell.save(),
    reward: JSON.stringify(rewardBefore),
    longObjective: serializeObjectiveState(longObjective),
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
  services.reward = new RewardService(
    JSON.parse(serialized.reward),
    (value) => services.rewardSaves.push(value),
  );
  const restoredLongObjective = deserializeObjectiveState(serialized.longObjective, LONG_OBJECTIVE_CONFIG);
  assert.deepEqual(restoredLongObjective, longObjective, 'long objective checkpoint must restore exactly');
  assert.strictEqual(
    applyObjectiveEvent(restoredLongObjective, replayObjectiveEvent),
    restoredLongObjective,
    'replaying a pre-checkpoint objective event must be idempotent after restore',
  );
  assert.deepEqual(services.reward.snapshot(), rewardBefore, 'reward checkpoint must restore exactly');
  if (lastProcessedRewardKey !== undefined) {
    const duplicate = services.reward.grant(lastProcessedRewardKey, { silver: 999, essence: 999 });
    assert.equal(duplicate.applied, false, 'restored reward key must remain idempotent');
    assert.deepEqual(services.reward.snapshot(), rewardBefore, 'duplicate restored reward must not mutate state');
  }
  stats.checkpoints += 1;
  stats.restoredServices += 8;
  stats.restoredObjectives += 1;
  return restoredLongObjective;
}

function runSimulation() {
  const services = buildServices();
  let longObjective = startObjectives(
    createObjectiveState(LONG_OBJECTIVE_CONFIG),
    0,
  );
  const pages = ['home', 'campaign', 'deck', 'tasks'];
  const battleSeeds = new Set();
  const battleFinalHashes = new Set();
  const deterministicInput = { protocol: BATTLE_RUNNER_PROTOCOL, seed: 42, actions: roundLimitActions() };
  const deterministicA = runBattleRunner(deterministicInput);
  const deterministicB = runBattleRunner(JSON.parse(JSON.stringify(deterministicInput)));
  assert.deepEqual(deterministicA, deterministicB, 'same runner seed and actions must be byte-equivalent data');
  assert.notEqual(
    runBattleRunner({ protocol: BATTLE_RUNNER_PROTOCOL, seed: 42, actions: [{ type: 'BATTLE_START' }] }).finalHash,
    runBattleRunner({ protocol: BATTLE_RUNNER_PROTOCOL, seed: 43, actions: [{ type: 'BATTLE_START' }] }).finalHash,
    'seed must affect runner output',
  );
  assertBattleResult(deterministicA, 'determinism probe', deterministicInput.actions.length);
  assertFrozenBoundary('battle final state', deterministicA.finalState);

  const normalFixtureActions = [
    { type: 'BATTLE_START' },
    { type: 'DEPLOY_UNIT', cardId: 'U002', side: 'player', lane: 0, cell: 0 },
    { type: 'MOVE_UNIT', unitId: 'unit-player-1', steps: 2 },
    { type: 'END_TURN' },
    { type: 'DEPLOY_UNIT', cardId: 'U002', side: 'enemy', lane: 0, cell: 11 },
    { type: 'MOVE_UNIT', unitId: 'unit-enemy-2', steps: 8 },
    { type: 'END_TURN' },
    { type: 'ATTACK', attackerId: 'unit-player-1' },
    { type: 'END_TURN' },
    { type: 'MOVE_UNIT', unitId: 'unit-enemy-2', steps: 1 },
    { type: 'END_TURN' },
  ];
  const unitDeathActions = [
    ...normalFixtureActions,
    { type: 'ATTACK', attackerId: 'unit-player-1' },
    { type: 'END_TURN' },
    { type: 'END_TURN' },
    { type: 'ATTACK', attackerId: 'unit-player-1' },
  ];
  const combatProbe = runBattleRunner({
    protocol: BATTLE_RUNNER_PROTOCOL,
    seed: 223,
    actions: unitDeathActions,
  });
  assertRunnerContract(combatProbe, unitDeathActions.length, 'combat probe', 223);
  assert.equal(combatProbe.events.some(({ type }) => type === 'ATTACK'), true, 'combat probe must exercise attack resolution');
  assert.equal(combatProbe.events.some(({ type }) => type === 'UNIT_MOVED'), true, 'combat probe must exercise movement');
  const unitDied = combatProbe.events.filter(({ type }) => type === 'UNIT_DIED');
  assert.equal(unitDied.length, 1, 'unit-death probe must contain exactly one UNIT_DIED');
  assert.equal(unitDied[0].eventId, 32, 'unit-death probe must retain runner UNIT_DIED eventId 32');
  assert.equal(unitDied[0].payload.unitId, 'unit-enemy-2', 'unit-death probe must identify the real defeated unit');
  assert.equal(combatProbe.finalState.units.some(({ id }) => id === 'unit-enemy-2'), false, 'unit-death probe final state must remove the defeated unit');

  const heroDeathProbe = runBattleRunner({
    protocol: BATTLE_RUNNER_PROTOCOL,
    seed: 223,
    actions: heroDeathActions(),
  });
  assertBattleResult(heroDeathProbe, 'hero defeat probe', heroDeathActions().length);
  assert.equal(
    [...heroDeathProbe.events].reverse().find(({ type }) => type === 'BATTLE_END')?.payload.reason,
    'HERO_DEFEATED',
    'hero defeat probe must exercise hero defeat settlement',
  );
  runObjectiveCoverage(combatProbe, heroDeathProbe);

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
      const battleInput = battleInputFor(battleNumber);
      const result = runBattleRunner(battleInput);
      assertBattleResult(result, `continuous battle ${battleNumber}`, battleInput.actions.length, battleInput.seed);
      battleSeeds.add(result.seed);
      battleFinalHashes.add(result.finalHash);
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

      runObjectiveBattle(battleNumber, tick * TICK_MS, result);
      stats.battles += 1;
      stats.battleEvents += result.events.length;
    }

    assertNonNegativeResources('shell resources', Object.fromEntries(services.shell.snapshot().resources.map(({ id, value }) => [id, value])));
    assertNonNegativeResources('reward resources', services.reward.snapshot().resources);
    assert(services.profile.snapshot().stamina >= 0, 'profile stamina must remain non-negative');

    if (tick === 600 || tick === 1_200) {
      longObjective = deserializeObjectiveState(serializeObjectiveState(longObjective), LONG_OBJECTIVE_CONFIG);
      longObjective = checkpoint(services, longObjective);
      assert.equal(services.campaign.snapshot().activeLevelId, null);
      assert.equal(services.story.snapshot().readNodeIds.length, CHAPTER01_STORY_NODE_IDS.length);
      assert.equal(services.mainline.snapshot().chapter.completed, true);
      assert.deepEqual(services.deck.snapshot(), DeckManagementService.restore(cardsTable, services.deck.save(), { availableCards }).snapshot());
      assert.deepEqual(services.shell.snapshot(), ShellService.fromSerialized(services.shell.save()).snapshot());
      assert.deepEqual(services.profile.snapshot(), ProfileService.fromSave(services.profile.save()).snapshot());
    }
  }

  assert.equal(stats.ticks, TICK_COUNT);
  assert.equal(battleSeeds.size, BATTLE_COUNT, 'continuous battles must use 60 unique runner seeds');
  assert.equal(battleFinalHashes.size, BATTLE_COUNT, 'continuous battles must produce 60 unique final hashes');
  assert.equal(longObjective.elapsedMs, SIMULATION_DURATION_MS);
  assert.equal(longObjective.objectives[0].type, 'SURVIVE', 'SURVIVE objective type must be preserved');
  assert.equal(longObjective.lifecycle, 'won');
  assertObjectiveRoundTrip(longObjective, LONG_OBJECTIVE_CONFIG, 'SURVIVE long objective');
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
assert.equal(stats.restoredServices, stats.checkpoints * 8);
assert.equal(stats.restoredObjectives, stats.checkpoints);
assert.equal(stats.saves, stats.checkpoints * 9);
assert.equal(stats.battles, BATTLE_COUNT);
assert.equal(stats.objectiveBattles, BATTLE_COUNT);
assert(stats.battleEvents >= BATTLE_COUNT * 3, 'battle event coverage must meet its quantity gate');
assert(stats.objectiveEvents >= BATTLE_COUNT * 2, 'objective event coverage must meet its quantity gate');
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
