import assert from 'node:assert/strict';

import { CampaignStateService } from '../assets/scripts/meta/campaign/index.ts';
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

function campaignSnapshotAfterClears(count) {
  const service = new CampaignStateService(campaignDefinition);
  for (let index = 0; index < count; index += 1) {
    const levelId = CHAPTER01_LEVEL_IDS[index];
    service.selectLevel(levelId);
    service.startLevel();
    service.completeLevel(3);
  }
  return service.snapshot();
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

const rewardVisibilityService = freshService();
rewardVisibilityService.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' });
const rewardVisibility = [];
rewardVisibilityService.claim('M4-10-L01', () => {
  rewardVisibility.push(rewardVisibilityService.getTask('M4-10-L01').claimed);
});
assert.deepEqual(rewardVisibility, [true], 'reward callback must run after the claim state is durably committed');

const rewardFailureService = freshService();
rewardFailureService.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' });
expectCode('REWARD_FAILED', () => rewardFailureService.claim('M4-10-L01', () => {
  throw new Error('reward sink unavailable');
}), 'reward callback failure');
assert.equal(rewardFailureService.getTask('M4-10-L01').claimed, true, 'reward callback failure must not roll back the durable claim');

let failClaimPersist = false;
let retryRewardCalls = 0;
const retryClaimService = freshService({
  persist: () => {
    if (failClaimPersist) throw new Error('claim disk full');
  },
});
retryClaimService.advance({ type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' });
const beforeClaimRetry = retryClaimService.serialize();
failClaimPersist = true;
expectCode('PERSISTENCE_FAILED', () => retryClaimService.claim('M4-10-L01', () => {
  retryRewardCalls += 1;
}), 'claim persistence failure');
assert.equal(retryRewardCalls, 0, 'a failed claim persistence must not invoke its reward callback');
assert.equal(retryClaimService.serialize(), beforeClaimRetry, 'failed claim persistence must preserve the prior state');
failClaimPersist = false;
assert.equal(retryClaimService.claim('M4-10-L01', () => {
  retryRewardCalls += 1;
}).code, 'APPLIED');
assert.equal(retryRewardCalls, 1, 'a retried claim must invoke the reward callback exactly once');
assert.equal(retryClaimService.claim('M4-10-L01', () => {
  retryRewardCalls += 1;
}).code, 'DUPLICATE');
assert.equal(retryRewardCalls, 1, 'the stable business key must protect duplicate reward callbacks');
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
  ...campaignSnapshotAfterClears(2),
});
assert.equal(synced.chapter.completedTaskCount, 2);
assert.equal(syncService.getTask('M4-10-L01').progress, 1);
assert.equal(syncService.getTask('M4-10-L02').progress, 1);
assert.equal(syncService.getTask('M4-10-L03').progress, 0);
assert.equal(syncService.isFeatureUnlocked('hero'), false);

const invalidCampaign = JSON.parse(JSON.stringify(campaignSnapshotAfterClears(2)));
invalidCampaign.levels.L04.firstClear = true;
invalidCampaign.levels.L04.clearCount = 1;
invalidCampaign.levels.L04.stars = 3;
invalidCampaign.levels.L04.lastOutcome = 'CLEARED';
const atomicCampaignService = freshService();
const beforeInvalidCampaign = atomicCampaignService.snapshot();
const beforeInvalidCampaignSerialized = atomicCampaignService.serialize();
expectCode('INVALID_SYNC', () => atomicCampaignService.syncCampaign(invalidCampaign), 'forged campaign sync');
assert.strictEqual(atomicCampaignService.snapshot(), beforeInvalidCampaign, 'invalid campaign sync must not partially advance tasks');
assert.equal(atomicCampaignService.serialize(), beforeInvalidCampaignSerialized, 'invalid campaign sync must not partially persist');

const invalidCampaignFields = JSON.parse(JSON.stringify(campaignSnapshotAfterClears(1)));
invalidCampaignFields.levels.L01.failed = true;
const beforeInvalidFields = atomicCampaignService.snapshot();
expectCode('INVALID_SYNC', () => atomicCampaignService.syncCampaign(invalidCampaignFields), 'inconsistent campaign fields');
assert.strictEqual(atomicCampaignService.snapshot(), beforeInvalidFields, 'inconsistent campaign fields must not mutate state');

const incompleteCampaign = JSON.parse(JSON.stringify(campaignSnapshotAfterClears(1)));
delete incompleteCampaign.levels.L02;
expectCode('INVALID_SYNC', () => atomicCampaignService.syncCampaign(incompleteCampaign), 'incomplete campaign level set');
assert.strictEqual(atomicCampaignService.snapshot(), beforeInvalidFields, 'incomplete campaign sync must not mutate state');

const wrongChapterCampaign = JSON.parse(JSON.stringify(campaignSnapshotAfterClears(1)));
wrongChapterCampaign.chapterId = 'CHAPTER02';
expectCode('CHAPTER_MISMATCH', () => atomicCampaignService.syncCampaign(wrongChapterCampaign), 'wrong campaign chapter');
assert.strictEqual(atomicCampaignService.snapshot(), beforeInvalidFields, 'wrong chapter sync must not mutate state');

let campaignPersistCalls = 0;
const campaignPersistFailureService = freshService({
  persist: () => {
    campaignPersistCalls += 1;
    if (campaignPersistCalls === 1) throw new Error('sync disk full');
  },
});
const beforeCampaignPersistFailure = campaignPersistFailureService.serialize();
expectCode('PERSISTENCE_FAILED', () => campaignPersistFailureService.syncCampaign(campaignSnapshotAfterClears(2)), 'campaign sync persistence failure');
assert.equal(campaignPersistFailureService.serialize(), beforeCampaignPersistFailure, 'campaign sync persistence failure must be atomic');

const storyDefinitions = [
  { id: 'story-one', target: 1, trigger: { type: 'STORY_NODE_READ', nodeId: 'NODE-1' }, unlocks: [] },
  { id: 'story-two', target: 1, trigger: { type: 'STORY_NODE_READ', nodeId: 'NODE-2' }, unlocks: [] },
];
const storyService = new MainlineTaskService({ definitions: storyDefinitions, initialFeatures: [] });
const beforeInvalidStory = storyService.snapshot();
const beforeInvalidStorySerialized = storyService.serialize();
expectCode('INVALID_SYNC', () => storyService.syncStory({ chapterId: 'CHAPTER01', readNodeIds: ['NODE-1', 'NODE-1'] }), 'duplicate story sync');
assert.strictEqual(storyService.snapshot(), beforeInvalidStory, 'invalid story sync must not partially advance tasks');
assert.equal(storyService.serialize(), beforeInvalidStorySerialized, 'invalid story sync must not partially persist');

let storyPersistCalls = 0;
const storyPersistFailureService = new MainlineTaskService({
  definitions: storyDefinitions,
  initialFeatures: [],
  persist: () => {
    storyPersistCalls += 1;
    if (storyPersistCalls === 1) throw new Error('story sync disk full');
  },
});
const beforeStoryPersistFailure = storyPersistFailureService.serialize();
expectCode('PERSISTENCE_FAILED', () => storyPersistFailureService.syncStory({ chapterId: 'CHAPTER01', readNodeIds: ['NODE-1', 'NODE-2'] }), 'story sync persistence failure');
assert.equal(storyPersistFailureService.serialize(), beforeStoryPersistFailure, 'story sync persistence failure must be atomic');

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
