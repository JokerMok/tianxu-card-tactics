import assert from 'node:assert/strict';

import {
  CHAPTER01_LEVEL_IDS,
  MAINLINE_FEATURE_IDS,
  MAINLINE_TASK_DEFINITIONS,
  MainlineTaskError,
  MainlineTaskService,
  createMainlineTaskState,
} from '../assets/scripts/meta/tasks/mainline/index.ts';

const campaignDefinition = {
  chapterId: 'CHAPTER01',
  levels: CHAPTER01_LEVEL_IDS.map((id, index) => ({
    id,
    prerequisiteLevelId: index === 0 ? null : CHAPTER01_LEVEL_IDS[index - 1],
  })),
};

function expectCode(code, callback, label) {
  assert.throws(callback, (error) => {
    assert(error instanceof MainlineTaskError, `${label} must throw MainlineTaskError`);
    assert.equal(error.code, code, `${label} error code`);
    return true;
  });
}

function freshService(options = {}) {
  return new MainlineTaskService({
    definitions: MAINLINE_TASK_DEFINITIONS,
    initialFeatures: ['campaign', 'tasks'],
    ...options,
  });
}

const initial = freshService();
assert.deepEqual(initial.snapshot().chapter, {
  completedTaskCount: 0,
  totalTaskCount: MAINLINE_TASK_DEFINITIONS.length,
  progress: 0,
  completed: false,
  currentTaskId: MAINLINE_TASK_DEFINITIONS[0].id,
});
assert.equal(initial.isFeatureUnlocked('campaign'), true);
assert.equal(initial.isFeatureUnlocked('tasks'), true);
assert.equal(initial.isFeatureUnlocked('deck'), false);
assert(Object.isFrozen(initial.snapshot()));
assert(Object.isFrozen(initial.snapshot().tasks[MAINLINE_TASK_DEFINITIONS[0].id]));
assert(Object.isFrozen(initial.snapshot().features));

const initialSerialized = initial.serialize();
const beforeInvalidEvent = initial.snapshot();
expectCode('INVALID_EVENT', () => initial.advance({ type: 'FEATURE_UNLOCKED', featureId: 'deck' }), 'direct unlock event');
assert.strictEqual(initial.snapshot(), beforeInvalidEvent, 'invalid event must not mutate state');
expectCode('TASK_NOT_AVAILABLE', () => initial.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L02' }), 'out-of-order level event');
assert.equal(initial.serialize(), initialSerialized, 'illegal progression must not persist');
expectCode('INVALID_EVENT', () => initial.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'NOPE' }), 'unknown level event');
expectCode('INVALID_UNLOCK', () => initial.unlockFeature('deck'), 'direct feature unlock');

const transitions = [];
const service = freshService({ persist: (serialized) => transitions.push(serialized) });
const first = service.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' });
assert.equal(first.code, 'APPLIED');
assert.equal(first.applied, true);
assert.equal(service.getTask('M4-10-L01').progress, 1);
assert.equal(service.getTask('M4-10-L01').completed, true);
assert.equal(service.getTask('M4-10-L02').progress, 0);
assert.equal(service.isFeatureUnlocked('deck'), true, 'L01 completion unlocks deck');
assert.equal(service.snapshot().chapter.completedTaskCount, 1);
assert.equal(service.snapshot().chapter.currentTaskId, 'M4-10-L02');
assert.equal(transitions.length, 1);

const afterFirst = service.snapshot();
const duplicateEvent = service.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' });
assert.deepEqual(duplicateEvent, {
  applied: false,
  code: 'DUPLICATE_EVENT',
  taskId: 'M4-10-L01',
  state: afterFirst,
});
assert.strictEqual(service.snapshot(), afterFirst, 'duplicate event must preserve the snapshot');
assert.equal(transitions.length, 1, 'duplicate event must not persist');

const notReady = service.claim('M4-10-L02');
assert.equal(notReady.code, 'NOT_READY');
assert.equal(notReady.applied, false);
assert.strictEqual(service.snapshot(), afterFirst, 'claiming an incomplete task must not mutate state');

for (const levelId of CHAPTER01_LEVEL_IDS.slice(1)) {
  const result = service.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId });
  assert.equal(result.code, 'APPLIED');
}
assert.equal(service.snapshot().chapter.completed, true);
assert.equal(service.snapshot().chapter.progress, 1);
assert.equal(service.snapshot().chapter.currentTaskId, null);
for (const task of Object.values(service.snapshot().tasks)) {
  assert.equal(task.progress, task.target);
  assert.equal(task.completed, true);
  assert.equal(task.claimed, false);
}
for (const featureId of MAINLINE_FEATURE_IDS) assert.equal(service.isFeatureUnlocked(featureId), true);

const rewardCalls = [];
const claimed = service.claim('M4-10-L01', (task, businessKey) => {
  rewardCalls.push({ taskId: task.id, businessKey });
});
assert.equal(claimed.code, 'APPLIED');
assert.equal(claimed.applied, true);
assert.equal(rewardCalls.length, 1);
assert.equal(rewardCalls[0].businessKey, 'mainline:CHAPTER01:M4-10-L01');
assert.equal(service.getTask('M4-10-L01').claimed, true);

const afterClaim = service.snapshot();
const duplicateClaim = service.claim('M4-10-L01', () => {
  throw new Error('duplicate claim must not invoke reward callback');
});
assert.equal(duplicateClaim.code, 'DUPLICATE');
assert.equal(duplicateClaim.applied, false);
assert.equal(duplicateClaim.businessKey, claimed.businessKey);
assert.strictEqual(service.snapshot(), afterClaim, 'duplicate claim must preserve the snapshot');
assert.equal(rewardCalls.length, 1);

const campaignState = createMainlineTaskState(MAINLINE_TASK_DEFINITIONS);
assert.equal(campaignState.chapter.progress, 0);
const syncService = freshService();
const synced = syncService.syncCampaign({
  chapterId: campaignDefinition.chapterId,
  levels: Object.fromEntries(CHAPTER01_LEVEL_IDS.map((levelId, index) => [levelId, {
    levelId,
    unlocked: index < 3,
    stars: index < 2 ? 3 : 0,
    firstClear: index < 2,
    clearCount: index < 2 ? 1 : 0,
    replayCount: 0,
    failureCount: 0,
    failed: false,
    lastOutcome: index < 2 ? 'CLEARED' : 'NONE',
  }])),
});
assert.equal(synced.chapter.completedTaskCount, 2);
assert.equal(syncService.getTask('M4-10-L01').progress, 1);
assert.equal(syncService.getTask('M4-10-L02').progress, 1);
assert.equal(syncService.getTask('M4-10-L03').progress, 0);
assert.equal(syncService.isFeatureUnlocked('hero'), false);

const restored = MainlineTaskService.fromSave(MAINLINE_TASK_DEFINITIONS, service.serialize(), {
  initialFeatures: ['campaign', 'tasks'],
});
assert.deepEqual(restored.snapshot(), service.snapshot());
assert.equal(restored.serialize(), service.serialize());

const forgedUnlock = JSON.parse(service.serialize());
forgedUnlock.features.hero.unlocked = false;
expectCode('INVALID_UNLOCK', () => MainlineTaskService.fromSave(
  MAINLINE_TASK_DEFINITIONS,
  JSON.stringify(forgedUnlock),
  { initialFeatures: ['campaign', 'tasks'] },
), 'forged feature state');

const forgedProgress = JSON.parse(initialSerialized);
forgedProgress.tasks['M4-10-L01'].progress = 1;
expectCode('INVALID_STATE', () => MainlineTaskService.fromSave(
  MAINLINE_TASK_DEFINITIONS,
  JSON.stringify(forgedProgress),
  { initialFeatures: ['campaign', 'tasks'] },
), 'forged task progress');

const persistenceFailure = freshService({ persist: () => { throw new Error('disk full'); } });
const beforePersistenceFailure = persistenceFailure.snapshot();
expectCode('PERSISTENCE_FAILED', () => persistenceFailure.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' }), 'persistence failure');
assert.strictEqual(persistenceFailure.snapshot(), beforePersistenceFailure, 'failed persistence must not mutate state');

expectCode('INVALID_CONFIG', () => new MainlineTaskService({
  definitions: [{
    id: 'bad',
    target: 0,
    trigger: { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' },
    unlocks: [],
  }],
}), 'invalid task definition');

const compactDefinitions = [{
  id: 'compact-task',
  target: 1,
  trigger: { type: 'DECK_UPDATED' },
  unlocks: ['compact-feature'],
}];
const compactService = new MainlineTaskService({ definitions: compactDefinitions, initialFeatures: [] });
assert.equal(compactService.advance({ type: 'DECK_UPDATED' }).code, 'APPLIED');
assert.equal(compactService.isFeatureUnlocked('compact-feature'), true, 'optional task fields must remain optional');

assert.throws(() => {
  service.snapshot().tasks['M4-10-L01'].progress = 99;
}, TypeError, 'frozen task state must be immutable');

console.log('T213 mainline tasks PASS: automatic progression, idempotent claims, derived unlocks, chapter sync, invalid transitions, persistence rollback, and immutable state');
