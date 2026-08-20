import assert from 'node:assert/strict';
import {
  DEFAULT_DUNGEON_DIFFICULTY_CONFIG,
  DUNGEON_DIFFICULTY_SCHEMA_VERSION,
  DungeonDifficultyError,
  DungeonDifficultyService,
  restoreDungeonDifficultyState,
  serializeDungeonDifficultyState,
  validateDungeonDifficultyConfig,
} from '../assets/scripts/pve/dungeon/difficulty/DungeonDifficulty.ts';

function errorCode(error, code) {
  return error instanceof DungeonDifficultyError && error.code === code;
}

let negativeCases = 0;

function expectError(label, callback, code) {
  assert.throws(callback, (error) => errorCode(error, code), `${label} must fail with ${code}`);
  negativeCases += 1;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function progress(service, difficultyId) {
  return service.progress(difficultyId);
}

const normalDefinition = DEFAULT_DUNGEON_DIFFICULTY_CONFIG.find(({ id }) => id === 'NORMAL');
const hardDefinition = DEFAULT_DUNGEON_DIFFICULTY_CONFIG.find(({ id }) => id === 'HARD');
assert(normalDefinition);
assert(hardDefinition);
validateDungeonDifficultyConfig(DEFAULT_DUNGEON_DIFFICULTY_CONFIG);
assert.equal(DEFAULT_DUNGEON_DIFFICULTY_CONFIG.length, 2);
assert.equal(normalDefinition.stages.length, 3);
assert.equal(hardDefinition.stages.length, 3);
assert.notDeepEqual(normalDefinition.stages, hardDefinition.stages, 'difficulty stages must be independent');
assert(normalDefinition.stages.every((stage, index) => stage.enemy.id !== hardDefinition.stages[index].enemy.id));
assert.notDeepEqual(normalDefinition.firstClearRewards, hardDefinition.firstClearRewards, 'difficulty first-clear rewards must be independent');
assert.notDeepEqual(normalDefinition.repeatClearRewards, hardDefinition.repeatClearRewards, 'difficulty repeat rewards must be independent');

const saves = [];
const service = new DungeonDifficultyService({ persist: (serialized) => saves.push(serialized) });
assert.equal(service.snapshot().schemaVersion, DUNGEON_DIFFICULTY_SCHEMA_VERSION);
assert.equal(progress(service, 'NORMAL').unlocked, true);
assert.equal(progress(service, 'NORMAL').attemptsRemaining, normalDefinition.attemptLimit);
assert.equal(progress(service, 'HARD').unlocked, false);
assert.equal(progress(service, 'HARD').attemptsRemaining, hardDefinition.attemptLimit);
const beforeLockedStart = service.snapshot();
expectError('locked hard start', () => service.startRun('HARD'), 'DIFFICULTY_LOCKED');
assert.deepEqual(service.snapshot(), beforeLockedStart, 'locked start must not mutate either difficulty');

const normalRun = service.startRun('NORMAL');
assert.equal(normalRun.difficultyId, 'NORMAL');
assert.equal(normalRun.attemptNumber, 1);
assert.equal(normalRun.stageIndex, 0);
assert.equal(normalRun.stages.length, 3);
assert.equal(service.activeRun(normalRun.runId).runId, normalRun.runId);
assert.equal(progress(service, 'NORMAL').attemptsUsed, 1);
assert.equal(progress(service, 'NORMAL').attemptsRemaining, normalDefinition.attemptLimit - 1);
expectError('parallel normal run', () => service.startRun('NORMAL'), 'RUN_ACTIVE');
expectError('invalid stage below zero', () => service.stage('NORMAL', -1), 'INVALID_STAGE');
expectError('invalid stage above end', () => service.stage('NORMAL', 3), 'INVALID_STAGE');
assert.equal(service.stage('NORMAL', 0).id, 'DUNGEON-01');
assert.equal(service.stage('NORMAL', 2).enemy.id, normalDefinition.stages[2].enemy.id);

const invalidOutcomeState = service.snapshot();
expectError('invalid outcome', () => service.settleRun(normalRun.runId, 'draw'), 'INVALID_OUTCOME');
assert.deepEqual(service.snapshot(), invalidOutcomeState, 'invalid outcome must not consume or settle the run');

const normalFirstClear = service.settleRun(normalRun.runId, 'won');
assert.equal(normalFirstClear.firstClear, true);
assert.equal(normalFirstClear.rewards[0].id, normalDefinition.firstClearRewards[0].id);
assert.deepEqual(normalFirstClear.rewards, normalDefinition.firstClearRewards);
assert.equal(progress(service, 'NORMAL').clearCount, 1);
assert.equal(progress(service, 'HARD').unlocked, true, 'normal first clear must unlock hard');
assert.equal(progress(service, 'HARD').attemptsUsed, 0, 'hard attempts must remain independent');
expectError('settled run', () => service.settleRun(normalRun.runId, 'won'), 'RUN_SETTLED');
expectError('unknown settled run id', () => service.settleRun('unknown-after-settle', 'won'), 'RUN_NOT_FOUND');

const normalRepeatRun = service.startRun('NORMAL');
assert.equal(normalRepeatRun.runId, 'dungeon-normal-2');
const normalRepeat = service.settleRun(normalRepeatRun.runId, 'won');
assert.equal(normalRepeat.firstClear, false);
assert.deepEqual(normalRepeat.rewards, normalDefinition.repeatClearRewards);
assert.equal(progress(service, 'NORMAL').clearCount, 2);
assert.equal(progress(service, 'NORMAL').attemptsUsed, 2);
assert.equal(progress(service, 'HARD').attemptsUsed, 0);

const normalBeforeHardFailure = progress(service, 'NORMAL');
const hardFailureRun = service.startRun('HARD');
assert.equal(hardFailureRun.runId, 'dungeon-hard-3');
const hardFailure = service.settleRun(hardFailureRun.runId, 'lost');
assert.equal(hardFailure.firstClear, false);
assert.deepEqual(hardFailure.rewards, [], 'failed run must not grant rewards');
assert.equal(progress(service, 'HARD').lastOutcome, 'lost');
assert.equal(progress(service, 'HARD').attemptsUsed, 1);
assert.deepEqual(progress(service, 'NORMAL'), normalBeforeHardFailure, 'hard failure must not change normal progress');

const hardSecondRun = service.startRun('HARD');
assert.equal(hardSecondRun.runId, 'dungeon-hard-4');
const hardFirstClear = service.settleRun(hardSecondRun.runId, 'won');
assert.equal(hardFirstClear.firstClear, true);
assert.deepEqual(hardFirstClear.rewards, hardDefinition.firstClearRewards);
assert.equal(progress(service, 'HARD').clearCount, 1);
assert.equal(progress(service, 'HARD').attemptsRemaining, 0);
expectError('hard attempt exhaustion', () => service.startRun('HARD'), 'ATTEMPTS_EXHAUSTED');
assert.equal(progress(service, 'NORMAL').attemptsRemaining, 1, 'hard exhaustion must not consume normal attempts');

const normalLastRun = service.startRun('NORMAL');
assert.equal(normalLastRun.runId, 'dungeon-normal-5');
const normalFailure = service.settleRun(normalLastRun.runId, 'lost');
assert.deepEqual(normalFailure.rewards, []);
assert.equal(progress(service, 'NORMAL').attemptsRemaining, 0);
expectError('normal attempt exhaustion', () => service.startRun('NORMAL'), 'ATTEMPTS_EXHAUSTED');
assert.deepEqual(
  restoreDungeonDifficultyState(serializeDungeonDifficultyState(service.snapshot())),
  service.snapshot(),
  'settled difficulty history must survive public snapshot serialization',
);

const activeService = new DungeonDifficultyService();
const activeRun = activeService.startRun('NORMAL');
const restored = new DungeonDifficultyService({ initialState: activeService.save() });
assert.deepEqual(restored.snapshot(), activeService.snapshot(), 'active difficulty state must restore exactly');
assert.deepEqual(restored.activeRun(activeRun.runId).stages, activeRun.stages);
assert.deepEqual(restoreDungeonDifficultyState(activeService.save()), activeService.snapshot());
assert.deepEqual(
  restoreDungeonDifficultyState(serializeDungeonDifficultyState(activeService.snapshot())),
  activeService.snapshot(),
  'public snapshot serialization must restore exactly',
);
assert(Object.isFrozen(restored.snapshot()));
assert(Object.isFrozen(restored.snapshot().difficulties));

const persistenceFailure = new DungeonDifficultyService({ persist: () => { throw new Error('disk full'); } });
const beforePersistenceFailure = persistenceFailure.snapshot();
expectError('persistence failure', () => persistenceFailure.startRun('NORMAL'), 'PERSISTENCE_FAILED');
assert.deepEqual(persistenceFailure.snapshot(), beforePersistenceFailure, 'persistence failure must roll back the state mutation');

expectError('unknown difficulty', () => service.progress('INVALID'), 'UNKNOWN_DIFFICULTY');
expectError('unknown active run', () => service.activeRun('missing-run'), 'RUN_NOT_FOUND');
expectError('invalid serialized state', () => restoreDungeonDifficultyState('{'), 'INVALID_STATE');
const invalidState = JSON.parse(activeService.save());
invalidState.schemaVersion = 99;
expectError('unsupported serialized schema', () => restoreDungeonDifficultyState(JSON.stringify(invalidState)), 'INVALID_STATE');
const danglingRunState = JSON.parse(activeService.save());
danglingRunState.activeRuns[0].runId = 'dangling-run';
expectError('dangling active run', () => restoreDungeonDifficultyState(JSON.stringify(danglingRunState)), 'INVALID_STATE');
const lockedActiveRunState = JSON.parse(activeService.save());
lockedActiveRunState.progress[1].attemptsUsed = 1;
lockedActiveRunState.progress[1].activeRunId = lockedActiveRunState.activeRuns[0].runId;
lockedActiveRunState.activeRuns[0].difficultyId = 'HARD';
expectError('active run in locked difficulty', () => restoreDungeonDifficultyState(JSON.stringify(lockedActiveRunState)), 'INVALID_STATE');
const mismatchedAttemptState = JSON.parse(activeService.save());
mismatchedAttemptState.activeRuns[0].attemptNumber = 2;
expectError('active run attempt mismatch', () => restoreDungeonDifficultyState(JSON.stringify(mismatchedAttemptState)), 'INVALID_STATE');

for (const difficultyId of ['NORMAL', 'HARD']) {
  const forgedProgressState = JSON.parse(activeService.save());
  const forgedProgress = forgedProgressState.progress.find((candidate) => candidate.difficultyId === difficultyId);
  assert(forgedProgress);
  forgedProgress.clearCount = forgedProgress.attemptsUsed + 1;
  expectError(`forged ${difficultyId} clear progress`, () => restoreDungeonDifficultyState(JSON.stringify(forgedProgressState)), 'INVALID_STATE');
}
const negativeProgressState = JSON.parse(activeService.save());
negativeProgressState.progress[1].attemptsUsed = -1;
expectError('negative difficulty progress', () => restoreDungeonDifficultyState(JSON.stringify(negativeProgressState)), 'INVALID_STATE');
const inconsistentProgressState = JSON.parse(activeService.save());
inconsistentProgressState.progress[0].activeRunId = null;
expectError('settled attempts without outcome', () => restoreDungeonDifficultyState(JSON.stringify(inconsistentProgressState)), 'INVALID_STATE');

const rolledBackRunNumberState = JSON.parse(activeService.save());
rolledBackRunNumberState.nextRunNumber = 1;
expectError('rolled-back next run number', () => restoreDungeonDifficultyState(JSON.stringify(rolledBackRunNumberState)), 'INVALID_STATE');
const historicalRunIdConflictState = JSON.parse(activeService.save());
historicalRunIdConflictState.nextRunNumber = 3;
historicalRunIdConflictState.settledRunIds = ['dungeon-normal-3'];
expectError('historical run id conflicts with next run', () => restoreDungeonDifficultyState(JSON.stringify(historicalRunIdConflictState)), 'INVALID_STATE');
const duplicateSettledRunState = JSON.parse(service.save());
duplicateSettledRunState.settledRunIds.push(duplicateSettledRunState.settledRunIds[0]);
expectError('duplicate settled run id', () => restoreDungeonDifficultyState(JSON.stringify(duplicateSettledRunState)), 'INVALID_STATE');
const activeSettledConflictState = JSON.parse(activeService.save());
activeSettledConflictState.settledRunIds = [activeSettledConflictState.activeRuns[0].runId];
expectError('active and settled run id conflict', () => restoreDungeonDifficultyState(JSON.stringify(activeSettledConflictState)), 'INVALID_STATE');

const invalidConfigs = [
  ['duplicate difficulty', (candidate) => { candidate[1].id = candidate[0].id; }],
  ['wrong stage count', (candidate) => { candidate[0].stages.pop(); }],
  ['duplicate stage', (candidate) => { candidate[0].stages[1].id = candidate[0].stages[0].id; }],
  ['cross-difficulty stage mismatch', (candidate) => { candidate[1].stages[2].id = 'OTHER-STAGE'; }],
  ['duplicate enemy id', (candidate) => { candidate[1].stages[0].enemy.id = candidate[0].stages[0].enemy.id; }],
  ['invalid attempt limit', (candidate) => { candidate[0].attemptLimit = 0; }],
  ['invalid reward quantity', (candidate) => { candidate[0].repeatClearRewards[0].quantity = 0; }],
  ['invalid unlock source', (candidate) => { candidate[1].unlock.difficultyId = 'INVALID'; }],
  ['self unlock', (candidate) => { candidate[1].unlock.difficultyId = 'HARD'; }],
];
for (const [label, mutate] of invalidConfigs) {
  const candidate = clone(DEFAULT_DUNGEON_DIFFICULTY_CONFIG);
  mutate(candidate);
  expectError(label, () => validateDungeonDifficultyConfig(candidate), 'INVALID_CONFIG');
}

assert.throws(() => { normalDefinition.displayName = 'mutated'; }, TypeError, 'configuration must be deeply frozen');
assert.equal(normalDefinition.displayName, '普通');
assert.equal(saves.length, 10, 'each successful start and settlement must be persisted exactly once');
const persistedStates = saves.map((serialized) => JSON.parse(serialized));
assert.deepEqual(
  persistedStates.map(({ nextRunNumber }) => nextRunNumber),
  [2, 2, 3, 3, 4, 4, 5, 5, 6, 6],
  'persisted run numbers must advance without rollback',
);
for (const [index, persistedState] of persistedStates.entries()) {
  const runIds = [...persistedState.activeRuns.map(({ runId }) => runId), ...persistedState.settledRunIds];
  assert.equal(new Set(runIds).size, runIds.length, `persisted state ${index + 1} must not duplicate active or settled run ids`);
  assert(persistedState.settledRunIds.every((runId) => !persistedState.activeRuns.some((run) => run.runId === runId)));
}
assert.equal(negativeCases, 34, 'all expected negative and regression cases must execute');

console.log(`T217 dungeon difficulty PASS: difficulties=${DEFAULT_DUNGEON_DIFFICULTY_CONFIG.length}, stages=${normalDefinition.stages.length}, rewards=${normalDefinition.firstClearRewards.length + hardDefinition.firstClearRewards.length}, negative-cases=${negativeCases}, saves=${saves.length}`);
