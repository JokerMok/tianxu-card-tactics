import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  DAILY_REWARDS_CONFIG,
  DAILY_REWARDS_PRODUCTION_DIGEST,
  DAILY_REWARDS_PRODUCTION_SKELETON,
  DailyRewardCatalog,
  DailyRewardError,
  DailyRewardService,
  assertDailyRewardCatalogSkeleton,
  assertDailyRewardProductionIntegrity,
  dayKeyFromTimestamp,
  dailyRewardCatalogDigest,
  diffDailyRewardConfig,
  loadDailyRewardCatalog,
  restoreDailyRewardState,
  serializeDailyRewardState,
  weekKeyFromDayKey,
} from '../assets/scripts/meta/tasks/daily/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const levelIndex = readJson('assets/resources/config/levels/chapter01/index.json');
const metadata = {
  resources: ['silver', 'crystal', 'stamina', 'towerTicket'],
  levels: levelIndex.levels,
};

function expectCode(label, action, code) {
  assert.throws(action, (error) => error instanceof DailyRewardError && error.code === code, `${label} must fail with ${code}`);
}

function dayAfter(dayKey, amount) {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function findDay(requiredIds, start = '2026-08-20') {
  for (let offset = 0; offset < 370; offset += 1) {
    const dayKey = dayAfter(start, offset);
    const ids = new Set(new DailyRewardCatalog(DAILY_REWARDS_CONFIG).dailyTaskIds(dayKey));
    if (requiredIds.every((id) => ids.has(id))) return dayKey;
  }
  throw new Error(`no deterministic fixture day found for ${requiredIds.join(', ')}`);
}

const digest = dailyRewardCatalogDigest(DAILY_REWARDS_CONFIG);
assert.notEqual(DAILY_REWARDS_PRODUCTION_DIGEST, 'TO_BE_LOCKED');
assert.equal(digest, DAILY_REWARDS_PRODUCTION_DIGEST, 'production digest must be locked');
assertDailyRewardCatalogSkeleton(DAILY_REWARDS_CONFIG);
assert.deepEqual(diffDailyRewardConfig(DAILY_REWARDS_CONFIG, structuredClone(DAILY_REWARDS_CONFIG)), { added: [], removed: [], changed: [] });

const reordered = structuredClone(DAILY_REWARDS_CONFIG);
reordered.tasks.reverse();
reordered.rewards.reverse();
reordered.activeRewards.reverse();
reordered.onlineRewards.reverse();
assertDailyRewardCatalogSkeleton(reordered);
assert.equal(dailyRewardCatalogDigest(reordered), digest, 'record ordering must not change the catalog digest');
const nestedReordered = structuredClone(DAILY_REWARDS_CONFIG);
const nestedTrigger = nestedReordered.tasks.find((task) => task.id === 'D_CLEAR_L01').trigger;
nestedReordered.tasks.find((task) => task.id === 'D_CLEAR_L01').trigger = { sourceId: nestedTrigger.sourceId, type: nestedTrigger.type, sourceTable: nestedTrigger.sourceTable };
assert.equal(dailyRewardCatalogDigest(nestedReordered), digest, 'nested record ordering must not change the catalog digest');
const tamperedNested = structuredClone(DAILY_REWARDS_CONFIG);
tamperedNested.tasks.find((task) => task.id === 'D_CLEAR_L01').trigger.sourceId = 'L404';
assert.throws(() => assertDailyRewardProductionIntegrity(tamperedNested), /digest mismatch/, 'nested config tampering must be rejected');

const changed = structuredClone(DAILY_REWARDS_CONFIG);
changed.tasks[0].target += 1;
assert.deepEqual(diffDailyRewardConfig(DAILY_REWARDS_CONFIG, changed).changed, ['D_LOGIN']);
const added = structuredClone(DAILY_REWARDS_CONFIG);
added.tasks.push({ ...added.tasks[0], id: 'D_FORGED' });
assert.equal(diffDailyRewardConfig(DAILY_REWARDS_CONFIG, added).added.includes('taskIds:D_FORGED'), true);
assert.throws(() => assertDailyRewardCatalogSkeleton(added), /skeleton mismatch/, 'skeleton drift must be rejected');

const catalog = loadDailyRewardCatalog(metadata);
assert.equal(catalog.config.tasks.length, 7);
assert.equal(catalog.config.activeRewards.length, 3);
assert.equal(catalog.config.onlineRewards.length, 3);
assert.equal(weekKeyFromDayKey('2026-01-01'), '2026-W01');
assert.equal(weekKeyFromDayKey('2026-01-04'), '2026-W01');
assert.equal(weekKeyFromDayKey('2026-01-05'), '2026-W02');
assert.deepEqual(catalog.dailyTaskIds('2026-08-20'), catalog.dailyTaskIds('2026-08-20'), 'same day selection must be deterministic');
assert.equal(new Set(Array.from({ length: 14 }, (_, index) => catalog.dailyTaskIds(dayAfter('2026-08-20', index)).join('|'))).size > 1, true, 'daily selection must rotate deterministically');

const fixtureDay = findDay(['D_LOGIN', 'D_BATTLE', 'D_ONLINE']);
const persisted = [];
const service = new DailyRewardService(catalog, { dayKey: fixtureDay, persist: (serialized) => persisted.push(serialized) });
const initial = service.snapshot();
assert(Object.isFrozen(initial));
assert(Object.isFrozen(initial.daily));
assert.equal(initial.dayKey, fixtureDay);
assert.equal(initial.weekKey, weekKeyFromDayKey(fixtureDay));
assert.equal(serializeDailyRewardState(initial), service.serialize());
assert.deepEqual(restoreDailyRewardState(catalog, service.serialize()), initial);

const selected = new Set(initial.daily.taskIds);
const unchanged = service.snapshot();
const noOp = service.record({ type: 'DECK_UPDATED', key: 'no-match' });
assert.equal(noOp.code, selected.has('D_DECK') ? 'APPLIED' : 'NOOP');
if (!selected.has('D_DECK')) assert.strictEqual(service.snapshot(), unchanged, 'unmatched events must not persist');

const notReady = service.claimTask('D_LOGIN');
assert.equal(notReady.code, selected.has('D_LOGIN') ? 'NOT_READY' : 'TASK_NOT_AVAILABLE');

const loginEvent = service.record({ type: 'LOGIN', key: 'login:once' });
assert.equal(loginEvent.code, 'APPLIED');
const duplicateEvent = service.record({ type: 'LOGIN', key: 'login:once' });
assert.equal(duplicateEvent.code, 'DUPLICATE_EVENT');
assert.equal(service.task('D_LOGIN').progress, 1);

const battleEvent = service.record({ type: 'BATTLE_WON', amount: 3, key: 'battle:1' });
assert.equal(battleEvent.code, 'APPLIED');
assert.equal(service.task('D_BATTLE').progress, 3);
assert.equal(service.snapshot().weeklyTasks.W_BATTLE.progress, 3);
service.record({ type: 'BATTLE_WON' });
assert.equal(service.snapshot().weeklyTasks.W_BATTLE.progress, 4, 'events without keys must remain repeatable');
const onlineEvent = service.record({ type: 'ONLINE_MINUTES', amount: 30, key: 'online:1' });
assert.equal(onlineEvent.code, 'APPLIED');
assert.equal(service.task('D_ONLINE').progress, 30);
assert.equal(service.snapshot().daily.onlineMinutes, 30);
assert.equal(service.record({ type: 'ONLINE_MINUTES', amount: 30, key: 'online:1' }).code, 'DUPLICATE_EVENT');
assert.equal(service.snapshot().daily.onlineMinutes, 30, 'duplicate ONLINE_MINUTES key must not accumulate');

const rewardCalls = [];
const taskClaim = service.claimTask('D_LOGIN', (reward, entry) => rewardCalls.push({ reward, entry }));
assert.equal(taskClaim.code, 'APPLIED');
assert.equal(rewardCalls.length, 1);
assert.equal(rewardCalls[0].entry.businessKey, `task:${fixtureDay}:D_LOGIN`);
assert.equal(service.snapshot().rewardOutbox[taskClaim.businessKey].status, 'PENDING');
const duplicateClaim = service.claimTask('D_LOGIN', () => { throw new Error('duplicate must not deliver'); });
assert.equal(duplicateClaim.code, 'DUPLICATE');
assert.equal(rewardCalls.length, 1);
assert.equal(service.acknowledgeReward(taskClaim.businessKey).code, 'APPLIED');
assert.equal(service.acknowledgeReward(taskClaim.businessKey).code, 'DUPLICATE');

const activityClaim = service.claimActivityReward('ACTIVE_10');
assert.equal(activityClaim.code, 'APPLIED');
assert.equal(service.claimActivityReward('ACTIVE_10').code, 'DUPLICATE');
assert.equal(service.claimActivityReward('ACTIVE_60').code, 'NOT_READY');
const onlineClaim = service.claimOnlineReward('ONLINE_30');
assert.equal(onlineClaim.code, 'APPLIED');
assert.equal(service.claimOnlineReward('ONLINE_30').code, 'DUPLICATE');
assert.equal(service.claimOnlineReward('ONLINE_60').code, 'NOT_READY');

const unclaimedCompleted = [...service.snapshot().daily.taskIds].find((id) => service.task(id).completed && !service.task(id).claimed);
assert(unclaimedCompleted, 'fixture must leave one completed task for makeup');
const secondUnclaimedCompleted = [...service.snapshot().daily.taskIds].find((id) => id !== unclaimedCompleted && service.task(id).completed && !service.task(id).claimed);
assert(secondUnclaimedCompleted, 'fixture must leave two completed tasks for makeup boundary');
const beforeRefresh = service.snapshot();
const nextDay = dayAfter(fixtureDay, 1);
service.refresh(nextDay);
assert.equal(service.snapshot().dayKey, nextDay);
assert.equal(service.snapshot().expiredDays[fixtureDay].tasks[unclaimedCompleted].completed, true);
assert.equal(service.claimTask(unclaimedCompleted, { dayKey: fixtureDay }).code, 'EXPIRED');
const makeupClaim = service.claimTask(unclaimedCompleted, { dayKey: fixtureDay, makeup: true });
assert.equal(makeupClaim.code, 'APPLIED');
assert.equal(service.snapshot().makeupCredits, 0);
assert.equal(service.claimTask(secondUnclaimedCompleted, { dayKey: fixtureDay, makeup: true }).code, 'MAKEUP_UNAVAILABLE');
assert.notEqual(service.snapshot(), beforeRefresh);

const oldDay = dayAfter(nextDay, 3);
service.refresh(oldDay);
assert.equal(service.snapshot().expiredDays[fixtureDay], undefined, 'expired periods outside makeup window must be pruned');
assert.equal(service.claimTask(unclaimedCompleted, { dayKey: fixtureDay, makeup: true }).code, 'EXPIRED');
assert.doesNotThrow(() => restoreDailyRewardState(catalog, service.serialize()), 'durable outbox entries may outlive pruned period snapshots');

const weekBoundaryDay = '2026-08-23';
const weeklyService = new DailyRewardService(catalog, { dayKey: weekBoundaryDay });
weeklyService.record({ type: 'BATTLE_WON', amount: 1, key: 'w1' });
assert.equal(weeklyService.snapshot().weeklyTasks.W_BATTLE.progress, 1);
weeklyService.record({ type: 'BATTLE_WON', amount: 9, key: 'w2' });
assert.equal(weeklyService.task('W_BATTLE').completed, true);
const weeklyClaim = weeklyService.claimTask('W_BATTLE');
assert.equal(weeklyClaim.code, 'APPLIED', 'weekly task must be claimable');
assert.equal(weeklyClaim.businessKey, `task:${weeklyService.snapshot().weekKey}:W_BATTLE`);
assert.equal(weeklyService.snapshot().rewardOutbox[weeklyClaim.businessKey].status, 'PENDING');
assert.equal(weeklyService.acknowledgeReward(weeklyClaim.businessKey).code, 'APPLIED');
weeklyService.refresh('2026-08-24');
assert.equal(weeklyService.snapshot().weeklyTasks.W_BATTLE.progress, 0, 'weekly tasks must reset at ISO week boundary');
assert.equal(weeklyService.snapshot().makeupCredits, 1);
assert.doesNotThrow(() => restoreDailyRewardState(catalog, weeklyService.serialize()), 'durable weekly outbox entries may outlive weekly task reset');

const failedPersistence = new DailyRewardService(catalog, { dayKey: fixtureDay, persist: () => { throw new Error('disk full'); } });
const failedBefore = failedPersistence.serialize();
expectCode('persistence rollback', () => failedPersistence.record({ type: 'LOGIN', key: 'persist-fail' }), 'PERSISTENCE_FAILED');
assert.equal(failedPersistence.serialize(), failedBefore, 'failed persistence must preserve the prior state');

let crossDayPersistCalls = 0;
const failedCrossDay = new DailyRewardService(catalog, { dayKey: fixtureDay, persist: () => { crossDayPersistCalls += 1; throw new Error('disk full'); } });
const failedCrossDayBefore = failedCrossDay.serialize();
expectCode('atomic cross-day record', () => failedCrossDay.record({ type: 'LOGIN', key: 'cross-day' }, dayAfter(fixtureDay, 1)), 'PERSISTENCE_FAILED');
assert.equal(crossDayPersistCalls, 1, 'cross-day record must persist once');
assert.equal(failedCrossDay.serialize(), failedCrossDayBefore, 'cross-day persistence failure must roll back refresh and record');

let recordReentrantCode;
let reentrantRecordService;
reentrantRecordService = new DailyRewardService(catalog, {
  dayKey: fixtureDay,
  persist: () => {
    try { reentrantRecordService.record({ type: 'LOGIN', key: 'nested-record' }); } catch (error) { recordReentrantCode = error.code; }
  },
});
reentrantRecordService.record({ type: 'LOGIN', key: 'outer-record' });
assert.equal(recordReentrantCode, 'REENTRANT', 'record must reject reentrant persistence callbacks');

const failedDelivery = new DailyRewardService(catalog, { dayKey: fixtureDay });
failedDelivery.record({ type: 'LOGIN', key: 'delivery' });
let reentrantCode;
expectCode('reward delivery failure', () => failedDelivery.claimTask('D_LOGIN', () => {
  try { failedDelivery.claimTask('D_DECK'); } catch (error) { reentrantCode = error.code; }
  throw new Error('sink unavailable');
}), 'REWARD_FAILED');
assert.equal(reentrantCode, 'REENTRANT');
assert.equal(failedDelivery.task('D_LOGIN').claimed, true);
assert.equal(failedDelivery.snapshot().rewardOutbox[`task:${fixtureDay}:D_LOGIN`].status, 'PENDING');
let flushed = 0;
assert.equal(failedDelivery.flushRewards(() => { flushed += 1; }).length, 1);
assert.equal(flushed, 1);
let flushReentrantCode;
assert.equal(failedDelivery.flushRewards(() => {
  try { failedDelivery.flushRewards(() => {}); } catch (error) { flushReentrantCode = error.code; }
}).length, 1);
assert.equal(flushReentrantCode, 'REENTRANT', 'flushRewards must reject reentrant sinks');

let acknowledgeReentrantCode;
let acknowledgeService;
acknowledgeService = new DailyRewardService(catalog, {
  dayKey: fixtureDay,
  persist: () => {
    try { acknowledgeService.acknowledgeReward(`task:${fixtureDay}:D_LOGIN`); } catch (error) { acknowledgeReentrantCode = error.code; }
  },
});
acknowledgeService.record({ type: 'LOGIN', key: 'ack-record' });
const acknowledgeClaim = acknowledgeService.claimTask('D_LOGIN');
assert.equal(acknowledgeReentrantCode, 'REENTRANT', 'acknowledgeReward must reject reentrant persistence callbacks');
assert.equal(acknowledgeService.acknowledgeReward(acknowledgeClaim.businessKey).code, 'APPLIED');

const snapshotBeforeMutation = service.snapshot();
service.record({ type: 'ONLINE_MINUTES', amount: 1, key: 'snapshot-isolation' });
assert.equal(snapshotBeforeMutation.daily.onlineMinutes, 0, 'prior snapshots must remain isolated');
assert.equal(service.snapshot().daily.onlineMinutes, 1);
assert(Object.isFrozen(snapshotBeforeMutation.daily.eventKeys));

const malformed = JSON.parse(service.serialize());
malformed.daily.tasks[malformed.daily.taskIds[0]].progress = malformed.daily.tasks[malformed.daily.taskIds[0]].target + 1;
expectCode('malformed state', () => restoreDailyRewardState(catalog, JSON.stringify(malformed)), 'INVALID_STATE');
const claimedIncomplete = JSON.parse(service.serialize());
const claimedIncompleteTask = claimedIncomplete.daily.tasks[claimedIncomplete.daily.taskIds[0]];
claimedIncompleteTask.claimed = true;
claimedIncompleteTask.completed = false;
claimedIncompleteTask.progress = 0;
expectCode('claimed incomplete task', () => restoreDailyRewardState(catalog, JSON.stringify(claimedIncomplete)), 'INVALID_STATE');
const wrongPeriodOwner = JSON.parse(service.serialize());
wrongPeriodOwner.daily.dayKey = dayAfter(service.snapshot().dayKey, 1);
expectCode('period day ownership', () => restoreDailyRewardState(catalog, JSON.stringify(wrongPeriodOwner)), 'INVALID_STATE');
const extraStateField = JSON.parse(service.serialize());
extraStateField.untrusted = true;
expectCode('state exact keys', () => restoreDailyRewardState(catalog, JSON.stringify(extraStateField)), 'INVALID_STATE');
const outboxOwnership = JSON.parse(acknowledgeService.serialize());
const outboxKey = acknowledgeClaim.businessKey;
outboxOwnership.rewardOutbox[outboxKey].rewardId = 'REWARD_FORGED';
expectCode('outbox ownership', () => restoreDailyRewardState(catalog, JSON.stringify(outboxOwnership)), 'INVALID_STATE');
const outboxBusinessKey = JSON.parse(acknowledgeService.serialize());
outboxBusinessKey.rewardOutbox[outboxKey].businessKey = 'task:forged:D_LOGIN';
expectCode('outbox business key', () => restoreDailyRewardState(catalog, JSON.stringify(outboxBusinessKey)), 'INVALID_STATE');
expectCode('event exact keys', () => service.record({ type: 'LOGIN', unexpected: true }), 'INVALID_EVENT');
expectCode('invalid calendar date', () => service.refresh('2026-02-30'), 'INVALID_DAY');
expectCode('invalid task date', () => service.task('D_LOGIN', '2026-02-30'), 'INVALID_DAY');
expectCode('unsafe timestamp', () => dayKeyFromTimestamp(Number.MAX_SAFE_INTEGER), 'INVALID_ARGUMENT');
const invalidReward = structuredClone(DAILY_REWARDS_CONFIG);
invalidReward.rewards[0].resourceId = 'forged-resource';
expectCode('missing cross-table resource', () => loadDailyRewardCatalog(metadata, invalidReward), 'INVALID_CONFIG');
const invalidLevel = structuredClone(DAILY_REWARDS_CONFIG);
invalidLevel.tasks.find((task) => task.id === 'D_CLEAR_L01').trigger.sourceId = 'L404';
expectCode('missing cross-table level', () => loadDailyRewardCatalog(metadata, invalidLevel), 'INVALID_CONFIG');
const duplicateTask = structuredClone(DAILY_REWARDS_CONFIG);
duplicateTask.tasks[1].id = duplicateTask.tasks[0].id;
expectCode('duplicate task configuration', () => new DailyRewardCatalog(duplicateTask), 'INVALID_CONFIG');
const invalidThreshold = structuredClone(DAILY_REWARDS_CONFIG);
invalidThreshold.activeRewards[1].threshold = invalidThreshold.activeRewards[0].threshold;
expectCode('threshold boundary', () => new DailyRewardCatalog(invalidThreshold), 'INVALID_CONFIG');
expectCode('time rewind', () => service.refresh(dayAfter(oldDay, -1)), 'TIME_REWIND');
expectCode('unknown outbox', () => service.acknowledgeReward('missing'), 'UNKNOWN_OUTBOX_ENTRY');

assert.equal(persisted.length > 0, true);
console.log(`T239 daily rewards PASS: deterministic day/week refresh, progress, expiry, makeup boundary, active/online thresholds, idempotent claims, persistence rollback, cross-table config, skeleton/diff; persists=${persisted.length}`);
