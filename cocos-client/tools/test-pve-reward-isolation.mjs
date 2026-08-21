import assert from 'node:assert/strict';
import {
  PveRewardIsolationError,
  PveRewardIsolationService,
  createPveRewardIsolationState,
  restorePveRewardIsolationState,
  serializePveRewardIsolationState,
} from '../assets/scripts/tests/pve/reward-isolation/index.ts';
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
const service = new PveRewardIsolationService(undefined, (serialized) => serviceSaves.push(serialized));
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
  createBattleResultState({ gold: 0, essence: 0 }, { clearedNodes: [], unlockedNodes: ['L01'] }),
  () => {},
);
const mainlineBattleResult = mainlineBattle.settle({
  businessKey: 'battle:L01:1',
  nodeId: 'L01',
  cost: {},
  outcome: { kind: 'victory' },
  reward: { gold: 5 },
  progress: { clearedNodes: ['L01'], unlockedNodes: ['L02'] },
});
assert.equal(mainlineBattleResult.code, 'APPLIED');
const beforeMainline = snapshotWithoutSchema(service.snapshot());
result(service, {
  mode: 'MAINLINE',
  settlementKey: 'mainline:L01:1',
  levelId: 'L01',
  outcome: 'CLEARED',
  rewards: [{ id: 'gold', quantity: 5 }],
}, 'APPLIED');
assertOnlyModeChanged(beforeMainline, snapshotWithoutSchema(service.snapshot()), 'mainline', 'mainline clear');
assert.equal(service.snapshot().mainline.levels[0].clearCount, 1);
assert.equal(service.snapshot().mainline.levels[1].unlocked, true);
assert.deepEqual(service.snapshot().mainline.rewards, { gold: 5 });

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

// Boss settlement is driven by the existing phase/outcome runtime; a lost attempt cannot grant its mark.
const bossConfig = {
  id: 'BOSS-T225-IRON-ROOT',
  maxHp: 100,
  flags: ['sealBroken'],
  summons: [{ id: 'rootling', unitId: 'U-ROOTLING', maxHp: 12, maxActive: 1 }],
  skills: [{ id: 'seal-break', effect: { type: 'SET_FLAG', flag: 'sealBroken', value: true } }],
  phases: [{ id: 'P1', hpPercentAtMost: 100, skillIds: ['seal-break'], onEnterSummonIds: [] }],
  outcome: {
    priority: 'LOSE',
    win: { mode: 'ALL', rules: [{ type: 'BOSS_HP_AT_MOST', value: 0 }, { type: 'FLAG_SET', flag: 'sealBroken' }] },
    lose: { mode: 'ANY', rules: [{ type: 'PLAYER_HERO_HP_AT_MOST', value: 0 }, { type: 'ROUND_AT_LEAST', value: 5 }] },
  },
};
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
  rewards: [{ id: 'boss-mark', quantity: 1 }],
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
  rewards: [{ id: 'gold', quantity: 5 }],
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
const reloadedSaves = [];
const reloaded = new PveRewardIsolationService(saved, (serialized) => reloadedSaves.push(serialized));
assert.equal(reloaded.settle(duplicateRequest).code, 'DUPLICATE');
assert.equal(reloadedSaves.length, 0);
assert.equal(reloaded.snapshot().tower.progress.bestFloor, 5);

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
});
const rollbackBefore = rollback.snapshot();
assert.equal(rollback.settle({
  mode: 'MAINLINE',
  settlementKey: 'mainline:L01:1',
  levelId: 'L01',
  outcome: 'CLEARED',
  rewards: [{ id: 'gold', quantity: 1 }],
}).code, 'PERSIST_FAILED');
assert.equal(persistAttempts, 1);
assert.deepEqual(rollback.snapshot(), rollbackBefore, 'failed persistence must not mutate the in-memory shard');
failPersistence = false;
assert.equal(rollback.settle({
  mode: 'MAINLINE',
  settlementKey: 'mainline:L01:1',
  levelId: 'L01',
  outcome: 'CLEARED',
  rewards: [{ id: 'gold', quantity: 1 }],
}).code, 'APPLIED');

let reentrantService;
let reentrantResult;
reentrantService = new PveRewardIsolationService(undefined, () => {
  reentrantResult = reentrantService.settle({
    mode: 'MAINLINE',
    settlementKey: 'mainline:L01:2',
    levelId: 'L01',
    outcome: 'CLEARED',
    rewards: [{ id: 'gold', quantity: 2 }],
  });
});
assert.equal(reentrantService.settle({
  mode: 'MAINLINE',
  settlementKey: 'mainline:L01:1',
  levelId: 'L01',
  outcome: 'CLEARED',
  rewards: [{ id: 'gold', quantity: 1 }],
}).code, 'APPLIED');
assert.equal(reentrantResult.code, 'PERSISTENCE_REENTRANT');
assert.equal(reentrantService.snapshot().mainline.levels[0].clearCount, 1);
assert.equal(reentrantService.snapshot().mainline.rewards.gold, 1);

console.log('T225 M5-10 reward isolation PASS: real mainline/dungeon/tower/boss rules, failure boundaries, save restore, idempotency and atomic persistence');
