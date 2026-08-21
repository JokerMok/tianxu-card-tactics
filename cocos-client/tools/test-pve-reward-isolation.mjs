import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  PveRewardIsolationError,
  PveRewardIsolationService,
  createPveRewardIsolationState,
  restorePveRewardIsolationState,
  serializePveRewardIsolationState,
} from '../assets/scripts/services/reward/isolation/PveRewardIsolationService.ts';
import { loadPveRewardIsolationConfig } from '../assets/scripts/services/reward/isolation/PveRewardIsolationConfig.ts';
import { createDefaultSave, encodeSave, recoverSave, validateSave } from '../assets/scripts/services/SaveSchema.ts';
import {
  BattleResultTransactionService,
  createBattleResultState,
} from '../assets/scripts/services/BattleResultTransactionService.ts';
import {
  DEFAULT_DUNGEON_DIFFICULTY_CONFIG,
  DungeonDifficultyService,
} from '../assets/scripts/pve/dungeon/difficulty/DungeonDifficulty.ts';
import {
  TOWER_FLOOR_COUNT,
  TowerLifecycleService,
} from '../assets/scripts/pve/tower/lifecycle/TowerLifecycle.ts';
import {
  towerCoinDropAtFloor,
  towerShopConfig,
} from '../assets/scripts/pve/tower/shop/TowerShopConfig.ts';
import {
  applyBossDamage,
  createBossState,
  setBossFlag,
} from '../assets/scripts/core/boss/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const levelIndex = readJson(path.join(configRoot, 'levels/chapter01/index.json'));
const levelConfigs = levelIndex.levels.map(({ id }) => {
  const document = readJson(path.join(configRoot, `levels/chapter01/${id}.json`));
  assert.equal(document.chapterLevels.length, 1, `${id} must contain one real level config`);
  assert.equal(document.chapterLevels[0].id, id, `${id} config must match the real index`);
  return document.chapterLevels[0];
});
const bossRewardDocument = readJson(path.join(configRoot, 'levels/chapter01/boss-rewards.json'));
const isolationConfig = loadPveRewardIsolationConfig({
  schemaVersion: 1,
  mainlineRewards: Object.fromEntries(levelConfigs.map((level) => [
    level.id,
    level.rewards.map(({ id, quantity }) => ({ id, quantity })),
  ])),
  bosses: bossRewardDocument.bosses,
});

function result(service, request, expectedCode) {
  const outcome = service.settle(request);
  assert.equal(outcome.code, expectedCode, `${request.mode} settlement should be ${expectedCode}`);
  return outcome;
}

function snapshotWithoutSchema(state) {
  const { schemaVersion: _schemaVersion, ...rest } = structuredClone(state);
  return rest;
}

function assertOnlyModeChanged(before, after, mode, label) {
  for (const candidate of ['mainline', 'dungeon', 'tower', 'boss']) {
    if (candidate !== mode) assert.deepEqual(after[candidate], before[candidate], `${label} must not change ${candidate}`);
  }
}

function assertInvalidRestore(label, serialized) {
  assert.throws(
    () => restorePveRewardIsolationState(serialized),
    (error) => error instanceof PveRewardIsolationError && error.code === 'INVALID_STATE',
    label,
  );
}

const serviceSaves = [];
const service = new PveRewardIsolationService(undefined, (serialized) => serviceSaves.push(serialized), isolationConfig);
assert.deepEqual(service.snapshot(), createPveRewardIsolationState(), 'default state must contain four independent empty shards');
assert.equal(service.snapshot().mainline.levels[0].levelId, 'L01');
assert.equal(service.snapshot().mainline.levels[0].unlocked, true);
assert.equal(service.snapshot().mainline.levels[1].unlocked, false);
assert.equal(service.snapshot().dungeon.difficulties[0].difficultyId, 'NORMAL');
assert.equal(service.snapshot().dungeon.difficulties[0].unlocked, true);
assert.equal(service.snapshot().dungeon.difficulties[1].unlocked, false);
assert.equal(service.snapshot().tower.progress.currentFloor, 1);
assert.equal(service.snapshot().tower.progress.bestFloor, 0);
assert.deepEqual(service.snapshot().boss.encounters, []);

// The mainline request is produced by the existing battle-result transaction contract.
const mainlineBattle = new BattleResultTransactionService(
  createBattleResultState({ U001: 0 }, { clearedNodes: [], unlockedNodes: ['L01'] }),
  () => {},
);
const mainlineBattleResult = mainlineBattle.settle({
  businessKey: 'battle:L01:1',
  nodeId: 'L01',
  cost: {},
  outcome: { kind: 'victory' },
  reward: { U001: isolationConfig.mainlineRewards.L01[0].quantity },
  progress: { clearedNodes: ['L01'], unlockedNodes: ['L02'] },
});
assert.equal(mainlineBattleResult.code, 'APPLIED');
const beforeMainline = snapshotWithoutSchema(service.snapshot());
result(service, {
  mode: 'MAINLINE',
  settlementKey: 'mainline:L01:1',
  levelId: 'L01',
  outcome: 'CLEARED',
  rewards: [...isolationConfig.mainlineRewards.L01],
}, 'APPLIED');
assertOnlyModeChanged(beforeMainline, snapshotWithoutSchema(service.snapshot()), 'mainline', 'mainline clear');
assert.equal(service.snapshot().mainline.levels[0].clearCount, 1);
assert.equal(service.snapshot().mainline.levels[1].unlocked, true);
assert.deepEqual(service.snapshot().mainline.rewards, { U001: 4 });

// Dungeon settlement uses the real three-stage difficulty service and its configured first-clear reward.
const dungeonRuntime = new DungeonDifficultyService({ config: DEFAULT_DUNGEON_DIFFICULTY_CONFIG });
const normalRun = dungeonRuntime.startRun('NORMAL');
const normalSettlement = dungeonRuntime.settleRun(normalRun.runId, 'won');
assert.equal(normalSettlement.firstClear, true);
const beforeDungeon = snapshotWithoutSchema(service.snapshot());
result(service, {
  mode: 'DUNGEON',
  settlementKey: normalSettlement.runId,
  difficultyId: normalSettlement.difficultyId,
  outcome: 'WON',
  rewards: normalSettlement.rewards,
}, 'APPLIED');
assertOnlyModeChanged(beforeDungeon, snapshotWithoutSchema(service.snapshot()), 'dungeon', 'dungeon clear');
assert.equal(service.snapshot().dungeon.difficulties[0].clearCount, 1);
assert.equal(service.snapshot().dungeon.difficulties[1].unlocked, true, 'a NORMAL clear unlocks HARD only in the dungeon shard');
assert.equal(service.snapshot().dungeon.rewards['dungeon-token-normal'], 1);
assert.equal(service.snapshot().mainline.levels[2].unlocked, false);

// Tower settlement follows the real lifecycle floor and the real tower-coin drop table.
const towerNow = Date.parse('2026-08-17T01:00:00.000Z');
const towerRuntime = new TowerLifecycleService({
  clock: { now: () => towerNow },
  tickets: 10,
});
for (let floor = 1; floor <= 5; floor += 1) {
  const started = towerRuntime.startChallenge(towerNow);
  assert.equal(started.activeAttempt.floor, floor);
  const completed = towerRuntime.completeBattle({ outcome: 'won', attemptId: started.activeAttempt.attemptId }, towerNow);
  assert.equal(completed.bestFloor, floor);
  const drop = towerCoinDropAtFloor(towerShopConfig, floor);
  const beforeTower = snapshotWithoutSchema(service.snapshot());
  result(service, {
    mode: 'TOWER',
    settlementKey: `tower:${floor}:${floor}`,
    floor,
    outcome: 'WON',
    rewards: drop === null ? [] : [{ id: 'tower-coin', quantity: drop.amount }],
  }, 'APPLIED');
  assertOnlyModeChanged(beforeTower, snapshotWithoutSchema(service.snapshot()), 'tower', `tower floor ${floor}`);
}
assert.equal(service.snapshot().tower.progress.bestFloor, 5);
assert.equal(service.snapshot().tower.progress.currentFloor, 6);
assert.equal(service.snapshot().tower.rewards['tower-coin'], 20, 'floor 5 must use the configured 20-coin boundary drop');
assert.equal(service.snapshot().dungeon.difficulties[1].clearCount, 0);
const towerLostStart = towerRuntime.startChallenge(towerNow);
assert.equal(towerLostStart.activeAttempt.floor, 6);
const towerLost = towerRuntime.completeBattle({ outcome: 'lost', attemptId: towerLostStart.activeAttempt.attemptId }, towerNow);
assert.equal(towerLost.status, 'failed');
const beforeTowerLoss = snapshotWithoutSchema(service.snapshot());
result(service, {
  mode: 'TOWER',
  settlementKey: 'tower:6:6',
  floor: 6,
  outcome: 'LOST',
  rewards: [],
}, 'APPLIED');
assertOnlyModeChanged(beforeTowerLoss, snapshotWithoutSchema(service.snapshot()), 'tower', 'tower loss');
assert.equal(service.snapshot().tower.progress.currentFloor, 6);
assert.equal(service.snapshot().tower.progress.bestFloor, 5);
const towerRetryStart = towerRuntime.continueChallenge(towerNow);
assert.equal(towerRetryStart.activeAttempt.floor, 6);
const towerRetry = towerRuntime.completeBattle({ outcome: 'won', attemptId: towerRetryStart.activeAttempt.attemptId }, towerNow);
assert.equal(towerRetry.bestFloor, 6);
result(service, {
  mode: 'TOWER',
  settlementKey: 'tower:6:7',
  floor: 6,
  outcome: 'WON',
  rewards: [],
}, 'APPLIED');
assert.equal(service.snapshot().tower.progress.currentFloor, 7, 'a won retry must advance from the lost floor');
assert.equal(service.snapshot().tower.progress.bestFloor, 6);

// Boss settlement is driven by the existing phase/outcome runtime and the real resource config.
const bossDefinition = isolationConfig.bosses.find(({ config }) => config.id === 'BOSS-T225-IRON-ROOT');
assert.ok(bossDefinition, 'T225 boss must come from the production resource config');
const bossConfig = bossDefinition.config;
const bossRewards = [...bossDefinition.rewards];
const lostBoss = createBossState(bossConfig, { playerHeroHp: 0 });
assert.equal(lostBoss.status, 'lost');
const beforeBossLoss = snapshotWithoutSchema(service.snapshot());
result(service, {
  mode: 'BOSS',
  settlementKey: 'boss:BOSS-T225-IRON-ROOT:1',
  bossId: 'BOSS-T225-IRON-ROOT',
  outcome: 'LOST',
  rewards: [],
}, 'APPLIED');
assertOnlyModeChanged(beforeBossLoss, snapshotWithoutSchema(service.snapshot()), 'boss', 'boss loss');
assert.equal(service.snapshot().boss.encounters[0].defeated, false);
assert.deepEqual(service.snapshot().boss.rewards, { 'boss-mark': 0 });
const wonBoss = applyBossDamage(
  bossConfig,
  setBossFlag(bossConfig, createBossState(bossConfig), 'sealBroken', true),
  100,
);
assert.equal(wonBoss.status, 'won');
result(service, {
  mode: 'BOSS',
  settlementKey: 'boss:BOSS-T225-IRON-ROOT:2',
  bossId: 'BOSS-T225-IRON-ROOT',
  outcome: 'WON',
  rewards: bossRewards,
}, 'APPLIED');
assert.equal(service.snapshot().boss.encounters[0].defeated, true);
assert.equal(service.snapshot().boss.rewards['boss-mark'], 1);
assert.equal(service.snapshot().mainline.levels[1].clearCount, 0);

// Failure and invalid paths never grant rewards or unlock another mode.
const beforeMainlineFailure = structuredClone(service.snapshot().mainline);
result(service, {
  mode: 'MAINLINE',
  settlementKey: 'mainline:L01:2',
  levelId: 'L01',
  outcome: 'FAILED',
  rewards: [],
}, 'APPLIED');
assert.equal(service.snapshot().mainline.levels[0].clearCount, beforeMainlineFailure.levels[0].clearCount);
assert.equal(service.snapshot().mainline.levels[0].attemptsUsed, beforeMainlineFailure.levels[0].attemptsUsed + 1);
assert.deepEqual(service.snapshot().mainline.rewards, beforeMainlineFailure.rewards);

const beforeDungeonFailure = structuredClone(service.snapshot().dungeon);
const lostNormalRun = dungeonRuntime.startRun('NORMAL');
const lostNormalSettlement = dungeonRuntime.settleRun(lostNormalRun.runId, 'lost');
result(service, {
  mode: 'DUNGEON',
  settlementKey: lostNormalSettlement.runId,
  difficultyId: 'NORMAL',
  outcome: 'LOST',
  rewards: [],
}, 'APPLIED');
assert.equal(service.snapshot().dungeon.difficulties[0].clearCount, beforeDungeonFailure.difficulties[0].clearCount);
assert.deepEqual(service.snapshot().dungeon.rewards, beforeDungeonFailure.rewards);

const invalidBefore = service.snapshot();
for (const [label, request] of [
  ['locked mainline level', { mode: 'MAINLINE', settlementKey: 'mainline:L03:1', levelId: 'L03', outcome: 'CLEARED', rewards: [] }],
  ['dungeon reward in mainline namespace', { mode: 'MAINLINE', settlementKey: 'mainline:L01:3', levelId: 'L01', outcome: 'CLEARED', rewards: [{ id: 'dungeon-token-normal', quantity: 1 }] }],
  ['wrong dungeon reward quantity', { mode: 'DUNGEON', settlementKey: 'dungeon:HARD:1', difficultyId: 'HARD', outcome: 'WON', rewards: [{ id: 'gold', quantity: 1 }] }],
  ['tower floor must be current', { mode: 'TOWER', settlementKey: 'tower:6:4', floor: 4, outcome: 'WON', rewards: [] }],
  ['boss cannot grant a non-boss reward', { mode: 'BOSS', settlementKey: 'boss:OTHER:1', bossId: 'OTHER', outcome: 'WON', rewards: [{ id: 'gold', quantity: 1 }] }],
  ['unknown mode', { mode: 'PVP', settlementKey: 'pvp:1', outcome: 'WON', rewards: [] }],
]) {
  assert.equal(service.settle(request).code, 'INVALID', label);
  assert.deepEqual(service.snapshot(), invalidBefore, `${label} must not mutate any shard`);
}

// Idempotency is keyed inside each mode namespace and conflicting reuse cannot overwrite a prior result.
const duplicateRequest = {
  mode: 'MAINLINE',
  settlementKey: 'mainline:L01:1',
  levelId: 'L01',
  outcome: 'CLEARED',
  rewards: [...isolationConfig.mainlineRewards.L01],
};
const savesBeforeDuplicate = serviceSaves.length;
assert.equal(service.settle(duplicateRequest).code, 'DUPLICATE');
assert.equal(serviceSaves.length, savesBeforeDuplicate);
const beforeConflict = service.snapshot();
assert.equal(service.settle({ ...duplicateRequest, rewards: [{ id: 'gold', quantity: 99 }] }).code, 'CONFLICT');
assert.deepEqual(service.snapshot(), beforeConflict, 'conflicting reuse must not mutate state');
assert.equal(service.settle({
  mode: 'DUNGEON',
  settlementKey: 'dungeon-normal-1',
  difficultyId: 'NORMAL',
  outcome: 'WON',
  rewards: normalSettlement.rewards,
}).code, 'DUPLICATE', 'the dungeon namespace has its own idempotency ledger');

// Saved state round-trips deterministically and a reloaded service still rejects a duplicate.
const saved = service.save();
assert.equal(saved, serializePveRewardIsolationState(service.snapshot()));
assert.deepEqual(restorePveRewardIsolationState(saved), service.snapshot());
const saveWithPveShard = { ...createDefaultSave('PVE-T225', 200), pveRewardIsolation: service.snapshot() };
const encodedSave = encodeSave(saveWithPveShard);
assert.deepEqual(validateSave(JSON.parse(encodedSave)).pveRewardIsolation, service.snapshot(), 'SaveSchema must persist and restore all four PVE shards');
assert.deepEqual(recoverSave(JSON.parse(encodedSave), null, 'PVE-T225').data.pveRewardIsolation, service.snapshot(), 'SaveSchema recovery must restore all four PVE shards');
const legacySave = { ...createDefaultSave('LEGACY-T225', 201) };
delete legacySave.pveRewardIsolation;
assert.deepEqual(validateSave(legacySave).pveRewardIsolation, createPveRewardIsolationState(), 'v1 saves without PVE shards must migrate to isolated defaults');
const reloadedSaves = [];
const reloaded = new PveRewardIsolationService(saved, (serialized) => reloadedSaves.push(serialized), isolationConfig);
assert.equal(reloaded.settle(duplicateRequest).code, 'DUPLICATE');
assert.equal(reloadedSaves.length, 0);
assert.equal(reloaded.snapshot().tower.progress.bestFloor, 6);

const malformedSave = JSON.parse(saved);
malformedSave.dungeon.difficulties[1].unlocked = false;
assertInvalidRestore('a saved HARD unlock must be derived from NORMAL clear history', JSON.stringify(malformedSave));
const malformedTowerSave = JSON.parse(saved);
malformedTowerSave.tower.progress.currentFloor = TOWER_FLOOR_COUNT + 1;
assertInvalidRestore('a saved tower floor beyond the configured boundary must be rejected', JSON.stringify(malformedTowerSave));
const malformedProcessedSave = JSON.parse(saved);
malformedProcessedSave.boss.processedSettlements.push(malformedProcessedSave.boss.processedSettlements[0]);
assertInvalidRestore('a saved duplicate settlement key must be rejected', JSON.stringify(malformedProcessedSave));
const beforeRestoreFailure = reloaded.snapshot();
assert.throws(() => reloaded.restore(JSON.stringify(malformedSave)), PveRewardIsolationError);
assert.deepEqual(reloaded.snapshot(), beforeRestoreFailure, 'failed restore must preserve the current state');

// Persistence is failure-atomic and re-entry cannot create a second settlement.
let failPersistence = true;
let persistAttempts = 0;
const rollback = new PveRewardIsolationService(undefined, () => {
  persistAttempts += 1;
  if (failPersistence) throw new Error('disk full');
}, isolationConfig);
const rollbackBefore = rollback.snapshot();
assert.equal(rollback.settle({
  mode: 'MAINLINE',
  settlementKey: 'mainline:L01:1',
  levelId: 'L01',
  outcome: 'CLEARED',
  rewards: [...isolationConfig.mainlineRewards.L01],
}).code, 'PERSIST_FAILED');
assert.equal(persistAttempts, 1);
assert.deepEqual(rollback.snapshot(), rollbackBefore, 'failed persistence must not mutate the in-memory shard');
failPersistence = false;
assert.equal(rollback.settle({
  mode: 'MAINLINE',
  settlementKey: 'mainline:L01:1',
  levelId: 'L01',
  outcome: 'CLEARED',
  rewards: [...isolationConfig.mainlineRewards.L01],
}).code, 'APPLIED');

let reentrantService;
let reentrantResult;
reentrantService = new PveRewardIsolationService(undefined, () => {
  reentrantResult = reentrantService.settle({
    mode: 'MAINLINE',
    settlementKey: 'mainline:L01:2',
    levelId: 'L01',
    outcome: 'CLEARED',
    rewards: [...isolationConfig.mainlineRewards.L01],
  });
}, isolationConfig);
assert.equal(reentrantService.settle({
  mode: 'MAINLINE',
  settlementKey: 'mainline:L01:1',
  levelId: 'L01',
  outcome: 'CLEARED',
  rewards: [...isolationConfig.mainlineRewards.L01],
}).code, 'APPLIED');
assert.equal(reentrantResult.code, 'PERSISTENCE_REENTRANT');
assert.equal(reentrantService.snapshot().mainline.levels[0].clearCount, 1);
assert.equal(reentrantService.snapshot().mainline.rewards.U001, 4);

console.log('T225 M5-10 reward isolation PASS: real mainline/dungeon/tower/boss rules, failure boundaries, save restore, idempotency and atomic persistence');
