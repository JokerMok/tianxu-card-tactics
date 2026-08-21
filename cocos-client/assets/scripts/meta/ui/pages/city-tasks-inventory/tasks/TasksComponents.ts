import {
  type MainlineTaskState,
} from '../../../../tasks/mainline/MainlineTasks.ts';
import {
  type TasksDetailComponent,
  type TasksEmptyComponent,
  type TasksPageComponent,
  type TasksPageData,
  type TasksTaskComponent,
  type TasksTaskData,
  type TasksTaskStatus,
} from './TasksContracts.ts';

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function taskProgress(data: TasksTaskData, state: MainlineTaskState | null): MainlineTaskState['tasks'][string] | null {
  return state?.tasks[data.id] ?? null;
}

export function taskStatus(
  data: TasksPageData,
  task: TasksTaskData,
  state: MainlineTaskState | null,
): TasksTaskStatus {
  if (state === null) return data.tasks[0]?.id === task.id ? 'ready' : 'locked';
  const progress = taskProgress(task, state);
  if (progress?.claimed) return 'claimed';
  if (progress?.completed) return 'completed';
  const firstIncomplete = data.tasks.find((candidate) => {
    const candidateProgress = taskProgress(candidate, state);
    return candidateProgress !== null && !candidateProgress.completed;
  });
  return firstIncomplete?.id === task.id ? 'ready' : 'locked';
}

function triggerLabel(task: TasksTaskData): string {
  if (task.trigger.type === 'CAMPAIGN_LEVEL_CLEARED') return `通关 ${task.trigger.levelId ?? '主线关卡'}`;
  if (task.trigger.type === 'STORY_NODE_READ') return `阅读 ${task.trigger.nodeId}`;
  return task.trigger.deckId === undefined ? '更新任意牌组' : `更新 ${task.trigger.deckId}`;
}

function componentForTask(
  data: TasksPageData,
  task: TasksTaskData,
  state: MainlineTaskState | null,
  selectedTaskId: string,
): TasksTaskComponent {
  const progress = taskProgress(task, state);
  const status = taskStatus(data, task, state);
  const value = progress?.progress ?? 0;
  return deepFreeze({
    id: `task-${task.id}`,
    kind: 'task',
    state: status,
    taskId: task.id,
    title: task.title,
    target: task.target,
    trigger: task.trigger,
    unlocks: [...task.unlocks],
    rewardPoolId: task.rewardPoolId,
    selected: task.id === selectedTaskId,
    progress: value,
    completed: progress?.completed ?? false,
    claimed: progress?.claimed ?? false,
    canAdvance: status === 'ready',
    canClaim: status === 'completed',
    triggerLabel: triggerLabel(task),
    unlockLabels: [...task.unlocks],
    rewardLabel: task.rewardPoolId ?? '无任务奖励池',
  });
}

function detailForTask(component: TasksTaskComponent): TasksDetailComponent {
  return deepFreeze({ ...component, id: 'detail', kind: 'detail' });
}

function emptyComponent(): TasksEmptyComponent {
  return deepFreeze({
    id: 'tasks-empty',
    kind: 'empty',
    state: 'empty',
    message: '当前没有可领取的主线任务。',
  });
}

export function createTasksPageComponents(
  data: TasksPageData,
  state: MainlineTaskState | null = null,
  selectedTaskId: string | null = null,
): readonly TasksPageComponent[] {
  if (data.tasks.length === 0) return Object.freeze([emptyComponent()]);
  const selected = data.tasks.find((task) => task.id === selectedTaskId)?.id ?? data.tasks[0]!.id;
  const taskComponents = data.tasks.map((task) => componentForTask(data, task, state, selected));
  const header = deepFreeze({
    id: 'header',
    kind: 'header',
    state: 'ready',
    title: data.title,
    subtitle: data.subtitle,
    totalTasks: data.tasks.length,
    completedTasks: data.tasks.filter((task) => taskProgress(task, state)?.completed).length,
    claimedTasks: data.tasks.filter((task) => taskProgress(task, state)?.claimed).length,
    selectedTaskId: selected,
    pendingRewardCount: state === null ? 0 : Object.values(state.rewardOutbox.entries).filter((entry) => entry.status === 'PENDING').length,
  });
  const detail = detailForTask(taskComponents.find((task) => task.taskId === selected)!);
  return Object.freeze([header, ...taskComponents, detail]);
}

export { deepFreeze };
