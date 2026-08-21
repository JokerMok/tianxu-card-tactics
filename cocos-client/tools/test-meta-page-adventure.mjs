import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ADVENTURE_PAGE_SCHEMA_VERSION,
  AdventurePageError,
  AdventurePageService,
  createAdventurePageComponents,
  createDefaultAdventurePageData,
  createEmptyAdventurePageData,
} from '../assets/scripts/meta/ui/pages/deck-hero-adventure/adventure/index.ts';
import { MAINLINE_TASK_DEFINITIONS } from '../assets/scripts/meta/tasks/mainline/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const adventureRoot = path.join(root, 'assets/scripts/meta/ui/pages/deck-hero-adventure/adventure');
const targetFiles = ['AdventureContracts.ts', 'AdventureComponents.ts', 'AdventurePageService.ts', 'index.ts'];
const targetSource = new Map(targetFiles.map((file) => [file, fs.readFileSync(path.join(adventureRoot, file), 'utf8')]));

for (const [file, source] of targetSource) {
  assert(source.length > (file === 'index.ts' ? 100 : 500), `${file} must contain an implemented module`);
  assert.doesNotMatch(source, /from ['"]cc['"]|require\(['"]cc['"]\)/, `${file} must remain Cocos-adapter friendly`);
  assert.doesNotMatch(source, /UI0[1-9]|loadSprite|整图/, `${file} must not depend on artwork text or numeric literals`);
}
assert.match(targetSource.get('AdventureComponents.ts'), /createAdventurePageComponents/);
assert.match(targetSource.get('AdventurePageService.ts'), /class AdventurePageService/);
assert.match(targetSource.get('AdventurePageService.ts'), /persistCallback/);

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const levelRoot = path.join(root, 'assets/resources/config/levels/chapter01');
const levelIndex = readJson(path.join(levelRoot, 'index.json'));
const realLevels = levelIndex.levels.map(({ id }) => {
  const document = readJson(path.join(levelRoot, `${id}.json`));
  assert.equal(document.chapterLevels.length, 1, `${id} must contain one real level row`);
  assert.equal(document.chapterLevels[0].id, id, `${id} must match the real level index`);
  return document.chapterLevels[0];
});
assert.equal(realLevels.length, 12, 'the page test must use all real chapter levels');
assert.equal(MAINLINE_TASK_DEFINITIONS.length, 12, 'the page test must use all real mainline task definitions');
assert.deepEqual(MAINLINE_TASK_DEFINITIONS.map(({ id }) => id), realLevels.map(({ id }) => `M4-10-${id}`));
const mainlineBackedData = createDefaultAdventurePageData({ taskDefinitions: MAINLINE_TASK_DEFINITIONS.slice(0, 2) });
assert.deepEqual(mainlineBackedData.tasks.map(({ id }) => id), MAINLINE_TASK_DEFINITIONS.slice(0, 2).map(({ id }) => id), 'real task definitions must be accepted as page input');
assert.equal(mainlineBackedData.tasks[0].rewards[0].id, MAINLINE_TASK_DEFINITIONS[0].rewardPoolId, 'real reward pool must map into a display reward');

const rewardLabel = (reward) => `${reward.type}:${reward.id}`;
const adventureTasks = [
  { id: 'real-dungeon', mode: 'dungeon', label: '副本', title: '真实副本任务', description: '由第一章 L05 配置驱动的副本入口。', objective: realLevels[4].objectives[0].type, target: 3, recommendedPower: 1850, staminaCost: 5, rewards: realLevels[4].rewards.map((reward) => ({ id: reward.id, label: rewardLabel(reward), quantity: reward.quantity, type: reward.type })), prerequisiteTaskId: null },
  { id: 'real-tower', mode: 'tower', label: '挑战塔', title: '真实挑战塔任务', description: '由第一章 L07 奖励登记驱动的挑战入口。', objective: realLevels[6].objectives[0].type, target: 1, recommendedPower: 2050, staminaCost: 0, rewards: realLevels[6].rewards.map((reward) => ({ id: reward.id, label: rewardLabel(reward), quantity: reward.quantity, type: reward.type })), prerequisiteTaskId: null },
  { id: 'real-boss', mode: 'boss', label: '援军 Boss', title: '真实 Boss 任务', description: '由第一章 L09 奖励登记驱动的 Boss 入口。', objective: realLevels[8].objectives[0].type, target: 1, recommendedPower: 2400, staminaCost: 8, rewards: realLevels[8].rewards.map((reward) => ({ id: reward.id, label: rewardLabel(reward), quantity: reward.quantity, type: reward.type })), prerequisiteTaskId: null },
];
const mutableInput = {
  schemaVersion: ADVENTURE_PAGE_SCHEMA_VERSION,
  title: '真实历练页',
  subtitle: '真实任务与奖励',
  tasks: adventureTasks,
};
const data = createDefaultAdventurePageData(mutableInput);
assert.equal(data.schemaVersion, ADVENTURE_PAGE_SCHEMA_VERSION);
assert.deepEqual(data.tasks.map(({ id }) => id), adventureTasks.map(({ id }) => id));
assert.equal(data.tasks[0].objective, realLevels[4].objectives[0].type, 'objective must come from the real level config');
assert.equal(data.tasks[0].rewards[0].id, realLevels[4].rewards[0].id, 'reward mapping must preserve the real reward id');
assert.deepEqual(createAdventurePageComponents(data).map((component) => component.id), [
  'header', 'filters', 'task-real-dungeon', 'task-real-tower', 'task-real-boss', 'detail',
]);

let negativeCaseCount = 0;
function expectPageFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof AdventurePageError, `${label} must use AdventurePageError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}

const saves = [];
const page = new AdventurePageService({ data, persist: (serialized) => saves.push(serialized) });
const initial = page.snapshot();
assert.equal(initial.pageId, 'adventure');
assert.equal(initial.selectedTaskId, 'real-dungeon');
assert.equal(initial.components.find((component) => component.id === 'header')?.totalTasks, 3);
assert.equal(initial.components.find((component) => component.id === 'header')?.visibleTasks, 3);
assert.equal(initial.components.find((component) => component.id === 'task-real-dungeon')?.modeLabel, '三段式副本');
assert.equal(initial.components.find((component) => component.id === 'task-real-dungeon')?.state, 'ready');
assert.equal(initial.components.find((component) => component.id === 'task-real-dungeon')?.statusLabel, '可挑战');
assert.equal(initial.components.find((component) => component.id === 'task-real-dungeon')?.rewards[0].id, realLevels[4].rewards[0].id);
assert.equal(initial.components.find((component) => component.id === 'detail')?.objective, realLevels[4].objectives[0].type);

// The page owns detached input data and freezes every returned nested branch.
mutableInput.tasks[0].rewards[0].quantity = 999;
assert.equal(page.pageData.tasks[0].rewards[0].quantity, realLevels[4].rewards[0].quantity, 'constructor must isolate nested input');
const frozen = page.snapshot();
assert(Object.isFrozen(frozen));
assert(Object.isFrozen(frozen.state));
assert(Object.isFrozen(frozen.state.tasks));
assert(Object.isFrozen(frozen.components));
assert(Object.isFrozen(frozen.components.find((component) => component.id === 'task-real-dungeon').rewards));
assert.throws(() => { frozen.state.tasks['real-dungeon'].progress = 2; }, TypeError);
assert.throws(() => { frozen.components.find((component) => component.id === 'task-real-dungeon').rewards[0].quantity = 0; }, TypeError);
const later = page.snapshot();
assert.notStrictEqual(later, frozen, 'each snapshot must be a fresh deep copy');
assert.equal(later.state.tasks['real-dungeon'].progress, 0);

// Selection, lifecycle and reward state are real service transitions.
assert.deepEqual(page.selectTask('real-tower'), { accepted: true, changed: true, reason: 'selected', taskId: 'real-tower', mode: 'tower', progress: 0 });
const savesBeforeSameSelection = saves.length;
assert.deepEqual(page.selectTask('real-tower'), { accepted: true, changed: false, reason: 'same', taskId: 'real-tower', mode: 'tower', progress: 0 });
assert.equal(saves.length, savesBeforeSameSelection, 'same selection must not persist');
assert.deepEqual(page.startTask(), { accepted: true, changed: true, reason: 'started', taskId: 'real-tower', mode: 'tower', progress: 0 });
assert.equal(page.snapshot().components.find((component) => component.id === 'task-real-tower')?.state, 'inProgress');
expectPageFailure('starting an already active task', () => page.startTask(), 'TASK_ALREADY_ACTIVE');
assert.deepEqual(page.progressTask(undefined, 1), { accepted: true, changed: true, reason: 'completed', taskId: 'real-tower', mode: 'tower', progress: 1 });
assert.equal(page.snapshot().components.find((component) => component.id === 'task-real-tower')?.canClaim, true);
assert.deepEqual(page.claimReward('real-tower'), { accepted: true, changed: true, reason: 'claimed', taskId: 'real-tower', mode: 'tower', progress: 1 });
assert.equal(page.snapshot().components.find((component) => component.id === 'task-real-tower')?.state, 'claimed');
expectPageFailure('duplicate reward claim', () => page.claimTask('real-tower'), 'TASK_ALREADY_CLAIMED');

// Filter projection and invalid filter/task/progress boundaries.
assert.deepEqual(page.setFilter({ mode: 'boss' }), { accepted: true, changed: true, reason: 'filtered', taskId: 'real-boss', mode: 'boss', progress: 0 });
assert.deepEqual(page.snapshot().components.map((component) => component.id), ['header', 'filters', 'task-real-boss', 'detail']);
expectPageFailure('selecting a task hidden by a filter', () => page.selectTask('real-dungeon'), 'TASK_NOT_VISIBLE');
expectPageFailure('unknown task', () => page.selectTask('missing-task'), 'TASK_NOT_FOUND');
expectPageFailure('invalid filter mode', () => page.setFilter({ mode: 'missing-mode' }), 'FILTER_INVALID');
expectPageFailure('invalid filter status', () => page.setFilter({ status: 'missing-status' }), 'FILTER_INVALID');
expectPageFailure('invalid filter task id', () => page.setFilter({ taskIds: ['missing-task'] }), 'FILTER_INVALID');
page.clearFilter();
page.selectTask('real-dungeon');
expectPageFailure('complete without active task', () => page.completeTask(), 'NO_ACTIVE_TASK');
page.startTask();
expectPageFailure('progress beyond target', () => page.progressTask(undefined, 4), 'INVALID_PROGRESS');
assert.deepEqual(page.progressTask(undefined, 1), { accepted: true, changed: true, reason: 'progressed', taskId: 'real-dungeon', mode: 'dungeon', progress: 1 });
assert.deepEqual(page.failTask(), { accepted: true, changed: true, reason: 'failed', taskId: 'real-dungeon', mode: 'dungeon', progress: 1 });
assert.equal(page.snapshot().components.find((component) => component.id === 'task-real-dungeon')?.state, 'failed');
assert.deepEqual(page.retryTask('real-dungeon'), { accepted: true, changed: true, reason: 'retried', taskId: 'real-dungeon', mode: 'dungeon', progress: 1 });
assert.deepEqual(page.completeTask('real-dungeon'), { accepted: true, changed: true, reason: 'completed', taskId: 'real-dungeon', mode: 'dungeon', progress: 3 });

// Prerequisites map to a locked state and unlock after the prerequisite reward is claimed.
const lockedData = createDefaultAdventurePageData({ tasks: [
  { ...adventureTasks[0], id: 'first', prerequisiteTaskId: null },
  { ...adventureTasks[1], id: 'second', prerequisiteTaskId: 'first' },
] });
const lockedPage = new AdventurePageService({ data: lockedData });
assert.equal(lockedPage.snapshot().components.find((component) => component.id === 'task-second')?.state, 'locked');
expectPageFailure('locked task start', () => lockedPage.startTask('second'), 'TASK_LOCKED');
const illegalLockedSave = JSON.parse(lockedPage.serialize());
illegalLockedSave.tasks.second.status = 'completed';
illegalLockedSave.tasks.second.progress = lockedData.tasks[1].target;
const illegalLockedSerialized = JSON.stringify(illegalLockedSave);
for (const [label, normalizedLockedPage] of [
  ['loaded', new AdventurePageService({ data: lockedData, initialState: illegalLockedSerialized })],
  ['restored', new AdventurePageService({ data: lockedData })],
]) {
  if (label === 'restored') normalizedLockedPage.restore(illegalLockedSerialized);
  assert.equal(normalizedLockedPage.snapshot().components.find((component) => component.id === 'task-second')?.state, 'locked');
  assert.equal(normalizedLockedPage.state.tasks.second.status, 'ready', `${label} locked completion must normalize to ready`);
  assert.equal(normalizedLockedPage.state.tasks.second.progress, 0, `${label} locked completion must not retain claimable progress`);
  expectPageFailure(`claiming a locked ${label} task`, () => normalizedLockedPage.claimTask('second'), 'TASK_LOCKED');
}
lockedPage.startTask('first');
lockedPage.completeTask('first');
lockedPage.claimTask('first');
assert.equal(lockedPage.snapshot().components.find((component) => component.id === 'task-second')?.state, 'ready');

// Empty state is explicit and has no fake state or persistence surface.
const empty = new AdventurePageService(createEmptyAdventurePageData());
const emptySnapshot = empty.snapshot();
assert.deepEqual(emptySnapshot.components.map((component) => component.id), ['adventure-empty']);
assert.equal(emptySnapshot.components[0].reason, 'noTasks');
assert.equal(emptySnapshot.state, null);
assert.deepEqual(empty.selectTask('real-dungeon'), { accepted: false, changed: false, reason: 'empty', taskId: null, mode: null, progress: null });
expectPageFailure('empty serialize', () => empty.serialize(), 'STATE_NOT_AVAILABLE');
expectPageFailure('empty page with persistence', () => new AdventurePageService({ data: createEmptyAdventurePageData(), persist: () => {} }), 'STATE_NOT_AVAILABLE');

// Malformed data and saves are rejected by the real service, not by file-existence checks.
expectPageFailure('duplicate task id', () => new AdventurePageService({ data: { ...data, tasks: [data.tasks[0], data.tasks[0]] } }), 'DUPLICATE_ID');
expectPageFailure('missing task field', () => new AdventurePageService({ data: { ...data, tasks: [{ ...data.tasks[0], rewards: undefined }] } }), 'INVALID_ARGUMENT');
expectPageFailure('invalid reward quantity', () => new AdventurePageService({ data: { ...data, tasks: [{ ...data.tasks[0], rewards: [{ ...data.tasks[0].rewards[0], quantity: 0 }] }] } }), 'INVALID_DATA');
const unknownTaskSave = JSON.parse(page.serialize());
unknownTaskSave.selectedTaskId = 'missing-task';
expectPageFailure('unknown task in save', () => page.restore(JSON.stringify(unknownTaskSave)), 'TASK_NOT_FOUND');
expectPageFailure('malformed save', () => page.restore('{bad-json'), 'INVALID_SAVE');
expectPageFailure('out-of-range saved progress', () => page.restore(page.serialize().replace('"progress":3', '"progress":99')), 'INVALID_STATE');
const invalidClaimedSave = JSON.parse(page.serialize());
invalidClaimedSave.tasks['real-dungeon'] = { ...invalidClaimedSave.tasks['real-dungeon'], status: 'claimed', progress: 0, claimed: true };
expectPageFailure('claimed task before target', () => new AdventurePageService({ data, initialState: JSON.stringify(invalidClaimedSave) }), 'INVALID_STATE');
expectPageFailure('non-function persist rejected at construction', () => new AdventurePageService({ data, persist: 'not-a-function' }), 'INVALID_ARGUMENT');

const monotonicPage = new AdventurePageService({ data });
monotonicPage.startTask('real-dungeon');
monotonicPage.progressTask(undefined, 2);
expectPageFailure('progress cannot regress', () => monotonicPage.progressTask(undefined, 1), 'INVALID_PROGRESS');
assert.equal(monotonicPage.state.tasks['real-dungeon'].progress, 2, 'rejected progress regression must preserve state');

// Save/restore is deterministic, detached and idempotent; persistence failure is atomic.
const serialized = page.serialize();
assert.equal(page.save(), serialized);
assert.equal(saves.at(-1), serialized);
const restored = new AdventurePageService({ data, initialState: serialized });
assert.equal(restored.serialize(), serialized);
assert.deepEqual(restored.snapshot(), page.snapshot());
assert.deepEqual(restored.restore(serialized), page.snapshot(), 'restoring the same save must be idempotent');
const restoredData = restored.pageData;
restoredData.tasks[0].rewards[0].quantity = 1;
assert.notEqual(restored.pageData.tasks[0].rewards[0].quantity, 1, 'pageData must be detached');
const failing = new AdventurePageService({ data, persist: () => { throw new Error('disk full'); } });
const beforeFailure = failing.snapshot();
expectPageFailure('persistence failure is atomic', () => failing.selectTask('real-tower'), 'PERSISTENCE_FAILED');
assert.deepEqual(failing.snapshot(), beforeFailure, 'failed persistence must not commit selection');

console.log(`T311 adventure page PASS: real-levels=${realLevels.length}, real-tasks=${MAINLINE_TASK_DEFINITIONS.length}, visible=${initial.components.find((component) => component.id === 'header')?.visibleTasks}, empty-components=${emptySnapshot.components.length}, saves=${saves.length}, negative-cases=${negativeCaseCount}, deep-freeze/input-isolation/save-restore-idempotent=true`);
