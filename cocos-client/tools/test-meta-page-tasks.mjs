import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CAMPAIGN_LEVEL_IDS,
} from '../assets/scripts/meta/campaign/CampaignState.ts';
import { MAINLINE_TASK_DEFINITIONS } from '../assets/scripts/meta/tasks/mainline/index.ts';
import {
  TASKS_PAGE_SCHEMA_VERSION,
  TasksPageError,
  TasksPageService,
  createDefaultTasksPageData,
  createEmptyTasksPageData,
  createTasksPageComponents,
  createTasksPageData,
} from '../assets/scripts/meta/ui/pages/city-tasks-inventory/tasks/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const tasksRoot = path.join(root, 'assets/scripts/meta/ui/pages/city-tasks-inventory/tasks');
const targetFiles = ['TasksContracts.ts', 'TasksComponents.ts', 'TasksPageService.ts', 'index.ts'];
const targetSource = new Map(targetFiles.map((file) => [file, fs.readFileSync(path.join(tasksRoot, file), 'utf8')]));

for (const [file, source] of targetSource) {
  assert(source.length > (file === 'index.ts' ? 100 : 900), `${file} must contain an implemented module`);
  assert.doesNotMatch(source, /from ['"]cc['"]|require\(['"]cc['"]\)/, `${file} must remain Cocos-adapter friendly`);
  assert.doesNotMatch(source, /UI08|loadSprite|整图/, `${file} must not depend on page artwork text or numeric literals`);
}
assert.match(targetSource.get('TasksComponents.ts'), /createTasksPageComponents/);
assert.match(targetSource.get('TasksPageService.ts'), /class TasksPageService/);
assert.match(targetSource.get('TasksPageService.ts'), /TASK_NOT_FOUND/);
assert.match(targetSource.get('TasksPageService.ts'), /PERSISTENCE_FAILED/);

const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const levelRoot = path.join(root, 'assets/resources/config/levels/chapter01');
const realLevels = CAMPAIGN_LEVEL_IDS.map((id) => {
  const document = readJson(path.join(levelRoot, `${id}.json`));
  assert.equal(document.chapterLevels.length, 1, `${id} must contain one real chapter level`);
  assert.equal(document.chapterLevels[0].id, id, `${id} must match its real file name`);
  return document.chapterLevels[0];
});
assert.equal(realLevels.length, 12, 'the page test must use all real chapter levels');
assert.equal(MAINLINE_TASK_DEFINITIONS.length, realLevels.length, 'real mainline task count must match real levels');
assert.deepEqual(
  MAINLINE_TASK_DEFINITIONS.map(({ trigger }) => trigger.levelId),
  realLevels.map(({ id }) => id),
  'real task triggers must point at the real chapter levels',
);

const realData = createTasksPageData({
  taskDefinitions: MAINLINE_TASK_DEFINITIONS,
  title: '真实主线任务',
  subtitle: '由第一章关卡定义驱动',
});
assert.equal(realData.schemaVersion, TASKS_PAGE_SCHEMA_VERSION);
assert.deepEqual(realData.tasks.map(({ id }) => id), MAINLINE_TASK_DEFINITIONS.map(({ id }) => id));
assert.equal(realData.tasks[0].trigger.levelId, realLevels[0].id);
assert.equal(realData.tasks.at(-1).rewardPoolId, MAINLINE_TASK_DEFINITIONS.at(-1).rewardPoolId);
assert.deepEqual(createTasksPageComponents(realData).map((component) => component.id), [
  'header', ...realData.tasks.map((task) => `task-${task.id}`), 'detail',
]);

let negativeCaseCount = 0;
function expectPageFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof TasksPageError, `${label} must use TasksPageError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}

const saves = [];
const page = new TasksPageService({ data: realData, persist: (serialized) => saves.push(serialized) });
const initial = page.snapshot();
assert.equal(initial.pageId, 'tasks');
assert.equal(initial.selectedTaskId, 'M4-10-L01');
assert.equal(initial.components.find((component) => component.id === 'header')?.totalTasks, 12);
assert.equal(initial.components.find((component) => component.id === 'task-M4-10-L01')?.title, MAINLINE_TASK_DEFINITIONS[0].title);
assert.equal(initial.components.find((component) => component.id === 'task-M4-10-L01')?.triggerLabel, '通关 L01');
assert.equal(initial.components.find((component) => component.id === 'task-M4-10-L01')?.state, 'ready');
assert.equal(initial.components.find((component) => component.id === 'task-M4-10-L02')?.state, 'locked');
assert.equal(initial.components.find((component) => component.id === 'detail')?.rewardPoolId, MAINLINE_TASK_DEFINITIONS[0].rewardPoolId);

// Input and snapshot isolation are part of the page contract.
const mutableInput = {
  schemaVersion: TASKS_PAGE_SCHEMA_VERSION,
  title: '可变输入',
  subtitle: '输入隔离',
  tasks: MAINLINE_TASK_DEFINITIONS.map((task) => ({
    id: task.id,
    title: task.title,
    target: task.target,
    trigger: { ...task.trigger },
    unlocks: [...task.unlocks],
    rewardPoolId: task.rewardPoolId ?? null,
  })),
};
const isolated = new TasksPageService({ data: mutableInput });
mutableInput.tasks[0].unlocks.push('mutated-after-construction');
assert.deepEqual(isolated.pageData.tasks[0].unlocks, MAINLINE_TASK_DEFINITIONS[0].unlocks);
const frozen = page.snapshot();
assert(Object.isFrozen(frozen));
assert(Object.isFrozen(frozen.components));
assert(Object.isFrozen(frozen.components.find((component) => component.id === 'task-M4-10-L01').unlocks));
assert.throws(() => { frozen.components.find((component) => component.id === 'task-M4-10-L01').progress = 3; }, TypeError);

// Normal selection, sequential unlock, completion and reward claim use the real task definitions.
assert.deepEqual(page.selectTask('M4-10-L02'), { accepted: true, changed: true, reason: 'selected', taskId: 'M4-10-L02', progress: 0 });
expectPageFailure('locked task advance', () => page.advanceTask(), 'TASK_LOCKED');
assert.deepEqual(page.selectTask('M4-10-L01'), { accepted: true, changed: true, reason: 'selected', taskId: 'M4-10-L01', progress: 0 });
assert.deepEqual(page.advanceTask(), { accepted: true, changed: true, reason: 'completed', taskId: 'M4-10-L01', progress: 1 });
assert.equal(page.snapshot().components.find((component) => component.id === 'task-M4-10-L02')?.state, 'ready');
const beforeCompletedRepeat = page.serialize();
const savesBeforeCompletedRepeat = saves.length;
assert.deepEqual(page.advanceTask('M4-10-L01', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L01' }), {
  accepted: false,
  changed: false,
  reason: 'duplicate',
  taskId: 'M4-10-L01',
  progress: 1,
});
assert.equal(page.serialize(), beforeCompletedRepeat, 'completed-task duplicate must preserve the serialized state');
assert.equal(saves.length, savesBeforeCompletedRepeat, 'completed-task duplicate must not persist');
expectPageFailure('completed task with a different event', () => page.advanceTask('M4-10-L01', { type: 'CAMPAIGN_LEVEL_CLEARED', levelId: 'L02' }), 'TASK_ALREADY_COMPLETE');
assert.deepEqual(page.claimTask('M4-10-L01'), { accepted: true, changed: true, reason: 'claimed', taskId: 'M4-10-L01', progress: 1 });
assert.equal(page.snapshot().components.find((component) => component.id === 'header')?.pendingRewardCount, 1);
const beforeClaimedRepeat = page.serialize();
assert.deepEqual(page.advanceTask('M4-10-L01'), {
  accepted: false,
  changed: false,
  reason: 'duplicate',
  taskId: 'M4-10-L01',
  progress: 1,
});
assert.equal(page.serialize(), beforeClaimedRepeat, 'claimed-task duplicate must preserve the serialized state');
assert.deepEqual(page.claimTask('M4-10-L01'), { accepted: false, changed: false, reason: 'not-ready', taskId: 'M4-10-L01', progress: 1 });
assert.deepEqual(page.advanceTask('M4-10-L02'), { accepted: true, changed: true, reason: 'completed', taskId: 'M4-10-L02', progress: 1 });
assert.deepEqual(page.claimTask('M4-10-L02'), { accepted: true, changed: true, reason: 'claimed', taskId: 'M4-10-L02', progress: 1 });

// Duplicate domain events are valid no-ops and must not be reported as changes.
const repeatable = new TasksPageService({ data: createTasksPageData({ tasks: [{
  id: 'repeatable',
  title: '重复事件探针',
  target: 2,
  trigger: { type: 'DECK_UPDATED' },
  unlocks: [],
  rewardPoolId: null,
}] }) });
assert.deepEqual(repeatable.advanceTask(undefined, { type: 'DECK_UPDATED', key: 'same-event' }), {
  accepted: true,
  changed: true,
  reason: 'progressed',
  taskId: 'repeatable',
  progress: 1,
});
const beforeDuplicate = repeatable.serialize();
assert.deepEqual(repeatable.advanceTask(undefined, { type: 'DECK_UPDATED', key: 'same-event' }), {
  accepted: false,
  changed: false,
  reason: 'duplicate',
  taskId: 'repeatable',
  progress: 1,
});
assert.equal(repeatable.serialize(), beforeDuplicate, 'duplicate event must preserve the serialized state');

// Empty state has no fake domain state and rejects stateful operations explicitly.
const empty = new TasksPageService(createEmptyTasksPageData());
const emptySnapshot = empty.snapshot();
assert.deepEqual(emptySnapshot.components.map((component) => component.id), ['tasks-empty']);
assert.equal(emptySnapshot.state, null);
assert.deepEqual(empty.selectTask('M4-10-L01'), { accepted: false, changed: false, reason: 'empty', taskId: null, progress: null });
assert.deepEqual(empty.advanceTask(), { accepted: false, changed: false, reason: 'empty', taskId: null, progress: null });
expectPageFailure('empty serialize', () => empty.serialize(), 'STATE_NOT_AVAILABLE');
expectPageFailure('empty page persistence', () => new TasksPageService({ data: createEmptyTasksPageData(), persist: () => {} }), 'STATE_NOT_AVAILABLE');

// Missing, illegal and out-of-range inputs must reach real validation paths.
expectPageFailure('null task input', () => createTasksPageData({ tasks: null }), 'INVALID_ARGUMENT');
expectPageFailure('non-array task input', () => createTasksPageData({ tasks: {} }), 'INVALID_ARGUMENT');
expectPageFailure('null task definition input', () => createTasksPageData({ taskDefinitions: null }), 'INVALID_ARGUMENT');
const missingTask = { ...realData.tasks[0] };
delete missingTask.title;
expectPageFailure('missing task title', () => new TasksPageService({ data: { ...realData, tasks: [missingTask, ...realData.tasks.slice(1)] } }), 'MISSING_FIELD');
expectPageFailure('invalid target', () => new TasksPageService({ data: { ...realData, tasks: [{ ...realData.tasks[0], target: 0 }, ...realData.tasks.slice(1)] } }), 'INVALID_DATA');
expectPageFailure('duplicate task id', () => new TasksPageService({ data: { ...realData, tasks: [realData.tasks[0], realData.tasks[0]] } }), 'DUPLICATE_ID');
expectPageFailure('reserved task id', () => new TasksPageService({ data: { ...realData, tasks: [{ ...realData.tasks[0], id: '__proto__' }, ...realData.tasks.slice(1)] } }), 'INVALID_ID');
expectPageFailure('prototype-chain task id', () => new TasksPageService({ data: { ...realData, tasks: [{ ...realData.tasks[0], id: 'constructor' }, ...realData.tasks.slice(1)] } }), 'INVALID_ID');
const taskWithPrototypeField = { ...realData.tasks[0] };
Object.defineProperty(taskWithPrototypeField, '__proto__', { value: 'polluted', enumerable: true });
expectPageFailure('prototype-chain task field', () => new TasksPageService({ data: { ...realData, tasks: [taskWithPrototypeField, ...realData.tasks.slice(1)] } }), 'INVALID_DATA');
expectPageFailure('unknown task id', () => page.selectTask('M4-10-NOPE'), 'TASK_NOT_FOUND');
expectPageFailure('empty task id', () => page.selectTask(''), 'INVALID_ID');
expectPageFailure('invalid event', () => page.advanceTask('M4-10-L03', { type: 'DECK_UPDATED' }), 'TASK_NOT_READY');
expectPageFailure('unknown interaction', () => page.interact({ type: 'not-supported' }), 'INVALID_ARGUMENT');
const invalidSave = JSON.parse(page.serialize());
invalidSave.tasks['M4-10-L03'].progress = 99;
expectPageFailure('out-of-range saved progress', () => new TasksPageService({ data: realData, initialState: JSON.stringify(invalidSave) }), 'INVALID_STATE');
expectPageFailure('malformed save', () => page.restore('{bad-json'), 'INVALID_SAVE');
expectPageFailure('non-function persistence', () => new TasksPageService({ data: realData, persist: 'not-a-function' }), 'INVALID_ARGUMENT');

// A persistence failure is atomic: the rejected transition cannot change the real state.
const failing = new TasksPageService({ data: realData, persist: () => { throw new Error('disk full'); } });
const beforeFailure = failing.serialize();
expectPageFailure('persistence failure', () => failing.advanceTask(), 'PERSISTENCE_FAILED');
assert.equal(failing.serialize(), beforeFailure);

assert.equal(negativeCaseCount, 21, 'all negative cases must execute');
assert(saves.length >= 4, 'real transitions must invoke persistence');
console.log(`T313 tasks page PASS: real-levels=${realLevels.length}, real-tasks=${realData.tasks.length}, components=${initial.components.length}, empty-components=${emptySnapshot.components.length}, saves=${saves.length}, negative-cases=${negativeCaseCount}`);
