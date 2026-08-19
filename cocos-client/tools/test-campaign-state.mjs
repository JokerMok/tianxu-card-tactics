import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CAMPAIGN_LEVEL_IDS,
  CAMPAIGN_STATE_SCHEMA_VERSION,
  CampaignStateError,
  CampaignStateService,
  createCampaignState,
  restoreCampaignState,
} from '../assets/scripts/meta/campaign/CampaignState.ts';

const root = path.resolve(import.meta.dirname, '..');
const configRoot = path.join(root, 'assets/resources/config');
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const index = readJson(path.join(configRoot, 'levels/chapter01/index.json'));
const levelConfigs = index.levels.map(({ id }) => {
  const document = readJson(path.join(configRoot, `levels/chapter01/${id}.json`));
  assert.equal(document.chapterLevels.length, 1, `${id} must contain one real level config`);
  assert.equal(document.chapterLevels[0].id, id, `${id} config must match the real index`);
  return document.chapterLevels[0];
});
const definition = { chapterId: index.chapterId, levels: levelConfigs };

assert.deepEqual(index.levels.map(({ id }) => id), [...CAMPAIGN_LEVEL_IDS]);
assert.deepEqual(index.levels.map(({ prerequisiteLevelId }) => prerequisiteLevelId), [
  null, 'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09', 'L10', 'L11',
]);
assert.deepEqual(createCampaignState(definition).selectedLevelId, 'L01');

const saved = [];
const campaign = new CampaignStateService({ config: index, levelConfigs, onSave: (serialized) => saved.push(serialized) });
assert.equal(campaign.snapshot().schemaVersion, CAMPAIGN_STATE_SCHEMA_VERSION);
assert.equal(campaign.snapshot().activeLevelId, null);
assert.deepEqual(Object.keys(campaign.snapshot().levels), [...CAMPAIGN_LEVEL_IDS]);
assert.equal(campaign.isUnlocked('L01'), true);
assert.equal(campaign.isUnlocked('L02'), false);
assert.equal(campaign.snapshot().levels.L01.firstClear, false);
assert.equal(campaign.snapshot().levels.L01.failed, false);

let negativeCaseCount = 0;
function expectFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof CampaignStateError, `${label} must throw CampaignStateError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}

// Real transition path: a failed first attempt does not unlock the next node.
campaign.selectLevel('L01');
campaign.startLevel();
expectFailure('start an active level twice', () => campaign.startLevel(), 'REENTRANT');
expectFailure('select while a level is active', () => campaign.selectLevel('L01'), 'REENTRANT');
campaign.failLevel();
assert.equal(campaign.snapshot().levels.L01.failed, true);
assert.equal(campaign.snapshot().levels.L01.failureCount, 1);
assert.equal(campaign.snapshot().levels.L01.firstClear, false);
assert.equal(campaign.snapshot().levels.L02.unlocked, false);
assert.equal(campaign.snapshot().levels.L02.failed, false);

// First clear unlocks exactly the next configured level and preserves per-level history.
campaign.startLevel('L01');
campaign.completeLevel('L01', 2);
assert.equal(campaign.snapshot().levels.L01.firstClear, true);
assert.equal(campaign.snapshot().levels.L01.stars, 2);
assert.equal(campaign.snapshot().levels.L01.clearCount, 1);
assert.equal(campaign.snapshot().levels.L01.failureCount, 1);
assert.equal(campaign.snapshot().levels.L01.failed, false);
assert.equal(campaign.snapshot().levels.L02.unlocked, true);
assert.equal(campaign.snapshot().levels.L03.unlocked, false);

campaign.selectLevel('L02');
campaign.startLevel();
campaign.failLevel('L02');
assert.equal(campaign.snapshot().levels.L02.failed, true);
assert.equal(campaign.snapshot().levels.L02.failureCount, 1);
assert.equal(campaign.snapshot().levels.L02.firstClear, false);
assert.equal(campaign.snapshot().levels.L01.failed, false);
assert.equal(campaign.snapshot().levels.L01.stars, 2);
assert.equal(campaign.snapshot().levels.L03.unlocked, false);

campaign.startLevel('L02');
campaign.completeLevel(1);
assert.equal(campaign.snapshot().levels.L02.firstClear, true);
assert.equal(campaign.snapshot().levels.L02.stars, 1);
assert.equal(campaign.snapshot().levels.L02.replayCount, 0, 'pre-clear failures are not replays');
assert.equal(campaign.snapshot().levels.L03.unlocked, true);

// Replaying a cleared level is isolated and cannot lower its best star result.
campaign.selectLevel('L01');
campaign.startLevel();
assert.equal(campaign.snapshot().levels.L01.replayCount, 1);
campaign.completeLevel('L01', 3);
assert.equal(campaign.snapshot().levels.L01.stars, 3);
assert.equal(campaign.snapshot().levels.L01.clearCount, 2);
assert.equal(campaign.snapshot().levels.L02.stars, 1);
assert.equal(campaign.snapshot().levels.L02.failed, false);
campaign.startLevel('L01');
campaign.failLevel();
assert.equal(campaign.snapshot().levels.L01.failed, true);
assert.equal(campaign.snapshot().levels.L01.firstClear, true);
assert.equal(campaign.snapshot().levels.L01.stars, 3);
assert.equal(campaign.snapshot().levels.L02.failed, false);
campaign.selectLevel('L02');
assert.equal(campaign.snapshot().levels.L01.failed, true, 'selecting another level must not clear L01 failure history');

// Invalid runtime transitions and real level IDs.
expectFailure('unknown level id', () => campaign.selectLevel('L99'), 'INVALID_LEVEL_ID');
expectFailure('empty level id', () => campaign.selectLevel(''), 'INVALID_LEVEL_ID');
expectFailure('non-string level id', () => campaign.selectLevel(2), 'INVALID_LEVEL_ID');
expectFailure('locked level selection', () => campaign.selectLevel('L04'), 'LEVEL_LOCKED');
expectFailure('locked level start', () => campaign.startLevel('L04'), 'LEVEL_LOCKED');
expectFailure('start unselected unlocked level', () => campaign.startLevel('L03'), 'INVALID_ORDER');
expectFailure('victory without active level', () => campaign.completeLevel('L02', 1), 'NO_ACTIVE_LEVEL');
expectFailure('failure without active level', () => campaign.failLevel('L02'), 'NO_ACTIVE_LEVEL');
expectFailure('zero stars', () => campaign.startLevel('L02') && campaign.completeLevel(0), 'INVALID_STARS');
expectFailure('four stars', () => campaign.completeLevel('L02', 4), 'INVALID_STARS');
expectFailure('fractional stars', () => campaign.completeLevel('L02', 1.5), 'INVALID_STARS');
expectFailure('settlement for another active level', () => campaign.completeLevel('L01', 1), 'ACTIVE_LEVEL_MISMATCH');
campaign.failLevel('L02');
expectFailure('settle after failure', () => campaign.completeLevel('L02', 1), 'NO_ACTIVE_LEVEL');

// Invalid configuration order is rejected before a state can be created.
expectFailure('duplicate level configuration', () => new CampaignStateService({
  levels: [...levelConfigs.slice(0, 11), { ...levelConfigs[10], id: 'L11' }],
}), 'INVALID_CONFIG');
expectFailure('wrong configuration prerequisite', () => new CampaignStateService({
  levels: levelConfigs.map((level, index) => index === 3 ? { ...level, prerequisiteLevelId: 'L01' } : level),
}), 'INVALID_CONFIG');
expectFailure('wrong configuration id', () => new CampaignStateService({
  levels: levelConfigs.map((level, index) => index === 1 ? { ...level, id: 'L99' } : level),
}), 'INVALID_CONFIG');

const validSave = campaign.serialize();
const mutateSave = (mutate) => {
  const candidate = JSON.parse(validSave);
  mutate(candidate);
  return JSON.stringify(candidate);
};
let restoreNegativeCaseCount = 0;
let replayReachabilityNegativeCaseCount = 0;
function expectInvalidRestoredState(label, mutate) {
  restoreNegativeCaseCount += 1;
  const serialized = mutateSave(mutate);
  const before = campaign.snapshot();
  assert.throws(() => campaign.restore(serialized), (error) => {
    assert(error instanceof CampaignStateError, `${label} must throw CampaignStateError`);
    assert.equal(error.code, 'INVALID_STATE', `${label} must report INVALID_STATE`);
    assert.equal(error.reason, 'INVALID_STATE', `${label} reason must be stable`);
    return true;
  }, label);
  assert.deepEqual(campaign.snapshot(), before, `${label} must not change current state`);
  assert.throws(() => CampaignStateService.fromSave(definition, serialized), (error) => {
    assert(error instanceof CampaignStateError, `${label} deserialize must throw CampaignStateError`);
    assert.equal(error.code, 'INVALID_STATE', `${label} deserialize must report INVALID_STATE`);
    return true;
  }, `${label} deserialize`);
}
function expectInvalidReplayReachabilityState(label, mutate) {
  replayReachabilityNegativeCaseCount += 1;
  const serialized = mutateSave(mutate);
  const before = campaign.snapshot();
  assert.throws(() => campaign.restore(serialized), (error) => {
    assert(error instanceof CampaignStateError, `${label} must throw CampaignStateError`);
    assert.equal(error.code, 'INVALID_STATE', `${label} must report INVALID_STATE`);
    assert.equal(error.reason, 'INVALID_STATE', `${label} reason must be stable`);
    return true;
  }, label);
  assert.deepEqual(campaign.snapshot(), before, `${label} must not change current state`);
  assert.throws(() => CampaignStateService.fromSave(definition, serialized), (error) => {
    assert(error instanceof CampaignStateError, `${label} deserialize must throw CampaignStateError`);
    assert.equal(error.code, 'INVALID_STATE', `${label} deserialize must report INVALID_STATE`);
    return true;
  }, `${label} deserialize`);
}

// The complete deterministic reachability matrix: 15 reachable histories and
// 9 adjacent histories that must be rejected. The counters describe one level;
// the surrounding save remains the real L01-L12 campaign state.
const reachabilityCases = [
  { label: 'initial NONE', valid: true, clearCount: 0, replayCount: 0, failureCount: 0, lastOutcome: 'NONE' },
  { label: 'pre-clear IN_PROGRESS after failures', valid: true, clearCount: 0, replayCount: 0, failureCount: 4, lastOutcome: 'IN_PROGRESS' },
  { label: 'pre-clear FAILED after failures', valid: true, clearCount: 0, replayCount: 0, failureCount: 1, lastOutcome: 'FAILED' },
  { label: 'first clear after prior failures', valid: true, clearCount: 1, replayCount: 0, failureCount: 3, lastOutcome: 'CLEARED' },
  { label: 'first replay IN_PROGRESS', valid: true, clearCount: 1, replayCount: 1, failureCount: 0, lastOutcome: 'IN_PROGRESS' },
  { label: 'first replay FAILED', valid: true, clearCount: 1, replayCount: 1, failureCount: 1, lastOutcome: 'FAILED' },
  { label: 'replay failure then another replay IN_PROGRESS', valid: true, clearCount: 1, replayCount: 2, failureCount: 1, lastOutcome: 'IN_PROGRESS' },
  { label: 'replay failures ending FAILED', valid: true, clearCount: 1, replayCount: 2, failureCount: 2, lastOutcome: 'FAILED' },
  { label: 'one replay success CLEARED', valid: true, clearCount: 2, replayCount: 1, failureCount: 0, lastOutcome: 'CLEARED' },
  { label: 'replay success and failure CLEARED', valid: true, clearCount: 2, replayCount: 2, failureCount: 1, lastOutcome: 'CLEARED' },
  { label: 'replay success then next replay IN_PROGRESS', valid: true, clearCount: 2, replayCount: 2, failureCount: 0, lastOutcome: 'IN_PROGRESS' },
  { label: 'replay success and failure then next replay IN_PROGRESS', valid: true, clearCount: 2, replayCount: 3, failureCount: 1, lastOutcome: 'IN_PROGRESS' },
  { label: 'replay success then replay FAILED', valid: true, clearCount: 2, replayCount: 2, failureCount: 1, lastOutcome: 'FAILED' },
  { label: 'two replay successes with failure CLEARED', valid: true, clearCount: 3, replayCount: 3, failureCount: 1, lastOutcome: 'CLEARED' },
  { label: 'two replay successes and two failures CLEARED', valid: true, clearCount: 3, replayCount: 4, failureCount: 2, lastOutcome: 'CLEARED' },
  { label: 'IN_PROGRESS replay failures exceed failureCount', valid: false, clearCount: 1, replayCount: 2, failureCount: 0, lastOutcome: 'IN_PROGRESS' },
  { label: 'FAILED replay failures exceed failureCount', valid: false, clearCount: 1, replayCount: 3, failureCount: 1, lastOutcome: 'FAILED' },
  { label: 'CLEARED replay has no prior replay success', valid: false, clearCount: 1, replayCount: 1, failureCount: 1, lastOutcome: 'CLEARED' },
  { label: 'IN_PROGRESS lacks an outstanding replay attempt', valid: false, clearCount: 2, replayCount: 1, failureCount: 0, lastOutcome: 'IN_PROGRESS' },
  { label: 'FAILED lacks a replay failure', valid: false, clearCount: 2, replayCount: 1, failureCount: 1, lastOutcome: 'FAILED' },
  { label: 'CLEARED replay count is below clear count', valid: false, clearCount: 2, replayCount: 0, failureCount: 0, lastOutcome: 'CLEARED' },
  { label: 'CLEARED replay failure is not accounted for', valid: false, clearCount: 3, replayCount: 3, failureCount: 0, lastOutcome: 'CLEARED' },
  { label: 'IN_PROGRESS replay failure is not accounted for', valid: false, clearCount: 2, replayCount: 3, failureCount: 0, lastOutcome: 'IN_PROGRESS' },
  { label: 'FAILED replay failures are not accounted for', valid: false, clearCount: 2, replayCount: 3, failureCount: 1, lastOutcome: 'FAILED' },
];

const reachabilitySave = (testCase) => {
  const value = JSON.parse(validSave);
  value.selectedLevelId = 'L03';
  value.activeLevelId = testCase.lastOutcome === 'IN_PROGRESS' ? 'L03' : null;
  Object.assign(value.levels.L03, {
    stars: testCase.clearCount > 0 ? 1 : 0,
    firstClear: testCase.clearCount > 0,
    clearCount: testCase.clearCount,
    replayCount: testCase.replayCount,
    failureCount: testCase.failureCount,
    failed: testCase.lastOutcome === 'FAILED',
    lastOutcome: testCase.lastOutcome,
  });
  value.levels.L04.unlocked = testCase.clearCount > 0;
  return JSON.stringify(value);
};

let reachabilityEnumerationCaseCount = 0;
let reachabilityValidCaseCount = 0;
let reachabilityInvalidCaseCount = 0;
const reachabilityService = new CampaignStateService({ config: index, levelConfigs, initialState: validSave });
for (const testCase of reachabilityCases) {
  reachabilityEnumerationCaseCount += 1;
  const serialized = reachabilitySave(testCase);
  const before = reachabilityService.snapshot();
  if (testCase.valid) {
    const restoredCase = reachabilityService.restore(serialized);
    assert.equal(restoredCase.levels.L03.lastOutcome, testCase.lastOutcome, testCase.label);
    assert.equal(restoredCase.levels.L03.clearCount, testCase.clearCount, testCase.label);
    assert.equal(restoredCase.levels.L03.replayCount, testCase.replayCount, testCase.label);
    assert.equal(restoredCase.levels.L03.failureCount, testCase.failureCount, testCase.label);
    assert.equal(reachabilityService.serialize(), serialized, `${testCase.label} must round-trip deterministically`);
    assert.deepEqual(
      CampaignStateService.fromSave(definition, serialized).snapshot(),
      restoredCase,
      `${testCase.label} must deserialize identically`,
    );
    reachabilityValidCaseCount += 1;
  } else {
    assert.throws(() => reachabilityService.restore(serialized), (error) => {
      assert(error instanceof CampaignStateError, `${testCase.label} must throw CampaignStateError`);
      assert.equal(error.code, 'INVALID_STATE', `${testCase.label} must report INVALID_STATE`);
      return true;
    }, testCase.label);
    assert.deepEqual(reachabilityService.snapshot(), before, `${testCase.label} must not change current state`);
    assert.throws(() => CampaignStateService.fromSave(definition, serialized), (error) => {
      assert(error instanceof CampaignStateError, `${testCase.label} deserialize must throw CampaignStateError`);
      assert.equal(error.code, 'INVALID_STATE', `${testCase.label} deserialize must report INVALID_STATE`);
      return true;
    }, `${testCase.label} deserialize`);
    reachabilityInvalidCaseCount += 1;
  }
}
reachabilityService.restore(validSave);

expectInvalidRestoredState('saved first clear in progress without replay', (value) => {
  value.selectedLevelId = 'L03';
  value.activeLevelId = 'L03';
  Object.assign(value.levels.L03, {
    firstClear: true,
    stars: 1,
    clearCount: 1,
    replayCount: 0,
    failureCount: 0,
    failed: false,
    lastOutcome: 'IN_PROGRESS',
  });
});
expectInvalidRestoredState('saved first clear failed without replay', (value) => {
  value.selectedLevelId = 'L03';
  value.activeLevelId = null;
  Object.assign(value.levels.L03, {
    firstClear: true,
    stars: 1,
    clearCount: 1,
    replayCount: 0,
    failureCount: 1,
    failed: true,
    lastOutcome: 'FAILED',
  });
});
expectInvalidRestoredState('saved replay clear missing second clear', (value) => {
  value.selectedLevelId = 'L03';
  value.activeLevelId = null;
  Object.assign(value.levels.L03, {
    firstClear: true,
    stars: 1,
    clearCount: 1,
    replayCount: 1,
    failureCount: 0,
    failed: false,
    lastOutcome: 'CLEARED',
  });
});
expectInvalidReplayReachabilityState('saved in-progress replay without matching failure', (value) => {
  value.selectedLevelId = 'L03';
  value.activeLevelId = 'L03';
  Object.assign(value.levels.L03, {
    firstClear: true,
    stars: 1,
    clearCount: 1,
    replayCount: 2,
    failureCount: 0,
    failed: false,
    lastOutcome: 'IN_PROGRESS',
  });
});
expectInvalidReplayReachabilityState('saved failed replays without matching failure count', (value) => {
  value.selectedLevelId = 'L03';
  value.activeLevelId = null;
  Object.assign(value.levels.L03, {
    firstClear: true,
    stars: 1,
    clearCount: 1,
    replayCount: 3,
    failureCount: 1,
    failed: true,
    lastOutcome: 'FAILED',
  });
});
expectFailure('malformed save', () => CampaignStateService.fromSave(definition, '{bad-json'), 'INVALID_SAVE');
expectFailure('wrong save version', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.schemaVersion = 2; })), 'SAVE_VERSION');
expectFailure('unknown save field', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.extra = true; })), 'INVALID_STATE');
expectFailure('unknown saved level field', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.levels.L01.extra = true; })), 'INVALID_STATE');
expectFailure('saved star out of range', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.levels.L01.stars = 4; })), 'INVALID_STARS');
expectFailure('saved negative failure count', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.levels.L01.failureCount = -1; })), 'INVALID_STATE');
expectFailure('saved first-clear mismatch', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.levels.L01.firstClear = false; })), 'INVALID_STATE');
expectFailure('saved replay before first clear', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.levels.L03.replayCount = 1; })), 'INVALID_STATE');
expectFailure('saved level unlock skips prerequisite', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.levels.L04.unlocked = true; })), 'INVALID_ORDER');
expectFailure('saved L01 locked', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.levels.L01.unlocked = false; })), 'INVALID_ORDER');
expectFailure('saved selected level locked', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.selectedLevelId = 'L04'; })), 'LEVEL_LOCKED');
expectFailure('saved active level mismatch', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.activeLevelId = 'L02'; })), 'INVALID_STATE');
expectFailure('saved in-progress level without active id', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.levels.L01.lastOutcome = 'IN_PROGRESS'; })), 'INVALID_STATE');
expectFailure('saved failed flag mismatch', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.levels.L01.failed = false; })), 'INVALID_STATE');
expectFailure('wrong chapter save', () => CampaignStateService.fromSave(definition, mutateSave((value) => { value.chapterId = 'CHAPTER02'; })), 'CHAPTER_MISMATCH');

// Save/restore is deterministic and detached from the source service.
const restored = CampaignStateService.fromSave(definition, validSave);
assert.deepEqual(restored.snapshot(), campaign.snapshot());
assert.equal(restored.serialize(), validSave);
assert.equal(restored.save(), validSave);
const detached = restored.snapshot();
assert(Object.isFrozen(detached));
assert(Object.isFrozen(detached.levels));
assert(Object.isFrozen(detached.levels.L01));
assert.throws(() => { detached.levels.L01.stars = 0; }, TypeError);
assert.equal(restored.getLevel('L01').stars, 3);
assert.deepEqual(restoreCampaignState(definition, validSave), campaign.snapshot());
const activeSaveService = new CampaignStateService(definition);
activeSaveService.startLevel('L01');
const activeSave = activeSaveService.serialize();
const activeRestored = CampaignStateService.fromSave(definition, activeSave);
assert.equal(activeRestored.activeLevelId, 'L01');
assert.equal(activeRestored.snapshot().levels.L01.lastOutcome, 'IN_PROGRESS');
assert.equal(activeRestored.serialize(), activeSave, 'in-progress state must also round-trip deterministically');
activeRestored.failLevel('L01');
assert.equal(activeRestored.snapshot().levels.L01.failed, true);

// Persistence failures are atomic, and persistence callbacks cannot re-enter the state machine.
const beforeFailure = restored.snapshot();
const failing = new CampaignStateService({ config: index, levelConfigs, onSave: () => { throw new Error('disk full'); } });
expectFailure('failed persistence rolls back', () => failing.startLevel('L01'), 'PERSISTENCE_FAILED');
assert.deepEqual(failing.snapshot(), createCampaignState(definition));
let reentrantError;
let reentrantService;
reentrantService = new CampaignStateService({ config: index, levelConfigs, onSave: () => {
  try {
    reentrantService.startLevel('L01');
  } catch (error) {
    reentrantError = error;
  }
} });
reentrantService.startLevel('L01');
assert(reentrantError instanceof CampaignStateError);
assert.equal(reentrantError.code, 'REENTRANT');
assert.equal(reentrantService.activeLevelId, 'L01');
assert.equal(reentrantService.selectedLevelId, 'L01');

assert(saved.length >= 12, 'real mutations must persist immediately');
assert.equal(negativeCaseCount, 34, 'all listed negative cases must execute exactly once');
assert.equal(restoreNegativeCaseCount, 3, 'all strict restore reachability negatives must execute exactly once');
assert.equal(replayReachabilityNegativeCaseCount, 2, 'both replay reachability regressions must execute exactly once');
assert.equal(reachabilityEnumerationCaseCount, 24, 'all deterministic reachability cases must execute exactly once');
assert.equal(reachabilityValidCaseCount, 15, 'all 15 legal reachability cases must restore');
assert.equal(reachabilityInvalidCaseCount, 9, 'all 9 illegal reachability cases must reject');
assert(negativeCaseCount >= 12, 'T205 must retain at least 12 real negative cases');
assert.deepEqual(restored.snapshot(), beforeFailure, 'read-only save operations must not mutate state');
console.log(`T205 campaign state PASS: real levels=${levelConfigs.length}, saves=${saved.length}, negative-cases=${negativeCaseCount}, restore-reachability-negatives=${restoreNegativeCaseCount}, reachability-enumeration=${reachabilityEnumerationCaseCount} (valid=${reachabilityValidCaseCount}, invalid=${reachabilityInvalidCaseCount}), isolated failure/first-clear/replay, deterministic save-restore, rollback and re-entry`);
