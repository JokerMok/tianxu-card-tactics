import {
  ADVENTURE_MODE_IDS,
  type AdventureDetailComponent,
  type AdventureEmptyComponent,
  type AdventureFilter,
  type AdventureFilterComponent,
  type AdventureHeaderComponent,
  type AdventurePageComponent,
  type AdventurePageData,
  type AdventurePageState,
  type AdventureTaskComponent,
  type AdventureTaskData,
  type AdventureTaskStatus,
} from './AdventureContracts.ts';

export const ADVENTURE_MODE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  dungeon: '三段式副本',
  tower: '挑战塔',
  boss: '援军 Boss',
});

export const ADVENTURE_STATUS_LABELS: Readonly<Record<AdventureTaskStatus, string>> = Object.freeze({
  ready: '可挑战',
  locked: '未解锁',
  inProgress: '进行中',
  failed: '待重试',
  completed: '已完成',
  claimed: '已领取',
});

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function cloneFilter(filter: AdventureFilter): AdventureFilter {
  return { mode: filter.mode, status: filter.status, taskIds: [...filter.taskIds] };
}

function visibleTasks(data: AdventurePageData, state: AdventurePageState | null, filter: AdventureFilter): AdventureTaskData[] {
  return data.tasks.filter((task) => {
    if (filter.mode !== 'all' && task.mode !== filter.mode) return false;
    if (filter.taskIds.length > 0 && !filter.taskIds.includes(task.id)) return false;
    const progress = state?.tasks[task.id];
    const status = progress?.status ?? 'ready';
    const unlocked = task.prerequisiteTaskId === null
      || progress === undefined
      || state?.tasks[task.prerequisiteTaskId]?.claimed === true;
    const effectiveStatus = unlocked ? status : 'locked';
    return filter.status === 'all' || effectiveStatus === filter.status;
  });
}

function taskStatus(
  task: AdventureTaskData,
  state: AdventurePageState | null,
): { status: AdventureTaskStatus; progress: number; attempts: number; claimed: boolean; unlocked: boolean } {
  const progress = state?.tasks[task.id];
  const unlocked = task.prerequisiteTaskId === null
    || progress === undefined
    || state?.tasks[task.prerequisiteTaskId]?.claimed === true;
  const status = unlocked ? (progress?.status ?? 'ready') : 'locked';
  return {
    status,
    progress: progress?.progress ?? 0,
    attempts: progress?.attempts ?? 0,
    claimed: progress?.claimed ?? false,
    unlocked,
  };
}

function cloneTask(task: AdventureTaskData): Omit<AdventureTaskComponent, 'id' | 'kind' | 'state' | 'status' | 'taskId' | 'modeLabel' | 'statusLabel' | 'selected' | 'active' | 'unlocked' | 'progress' | 'attempts' | 'claimed' | 'canStart' | 'canComplete' | 'canClaim'> {
  return {
    mode: task.mode,
    label: task.label,
    title: task.title,
    description: task.description,
    objective: task.objective,
    target: task.target,
    recommendedPower: task.recommendedPower,
    staminaCost: task.staminaCost,
    rewards: task.rewards.map((reward) => ({ ...reward })),
    prerequisiteTaskId: task.prerequisiteTaskId,
  };
}

function taskComponent(
  task: AdventureTaskData,
  state: AdventurePageState | null,
  selectedTaskId: string | null,
): AdventureTaskComponent {
  const current = taskStatus(task, state);
  return deepFreeze({
    ...cloneTask(task),
    id: `task-${task.id}`,
    kind: 'task',
    state: current.status,
    status: current.status,
    taskId: task.id,
    modeLabel: ADVENTURE_MODE_LABELS[task.mode] ?? task.mode,
    statusLabel: ADVENTURE_STATUS_LABELS[current.status],
    selected: selectedTaskId === task.id,
    active: state?.activeTaskId === task.id,
    unlocked: current.unlocked,
    progress: current.progress,
    attempts: current.attempts,
    claimed: current.claimed,
    canStart: current.unlocked && (current.status === 'ready' || current.status === 'failed') && state?.activeTaskId === null,
    canComplete: current.status === 'inProgress' && state?.activeTaskId === task.id,
    canClaim: current.status === 'completed' && !current.claimed,
  });
}

function detailComponent(
  task: AdventureTaskData,
  state: AdventurePageState | null,
  selectedTaskId: string | null,
): AdventureDetailComponent {
  const component = taskComponent(task, state, selectedTaskId) as Omit<AdventureDetailComponent, 'id' | 'kind'>;
  return deepFreeze({ ...component, id: 'detail', kind: 'detail' });
}

function emptyComponent(reason: AdventureEmptyComponent['reason']): AdventureEmptyComponent {
  return deepFreeze({
    id: 'adventure-empty',
    kind: 'empty',
    state: 'empty',
    reason,
    message: reason === 'noTasks' ? '当前没有可挑战的历练任务。' : '当前筛选没有匹配的历练任务。',
  });
}

export function createAdventurePageComponents(
  data: AdventurePageData,
  state: AdventurePageState | null = null,
): readonly AdventurePageComponent[] {
  const filter = state?.filter ?? { mode: 'all', status: 'all', taskIds: [] };
  if (data.tasks.length === 0) return Object.freeze([emptyComponent('noTasks')]);
  const visible = visibleTasks(data, state, filter);
  if (visible.length === 0) return Object.freeze([emptyComponent('noVisibleTasks')]);
  const selectedTaskId = visible.some((task) => task.id === state?.selectedTaskId)
    ? state!.selectedTaskId
    : visible[0]!.id;
  const visibleStatuses = visible.map((task) => taskStatus(task, state));
  const header: AdventureHeaderComponent = deepFreeze({
    id: 'header',
    kind: 'header',
    state: 'ready',
    title: data.title,
    subtitle: data.subtitle,
    totalTasks: data.tasks.length,
    visibleTasks: visible.length,
    completedTasks: data.tasks.filter((task) => ['completed', 'claimed'].includes(taskStatus(task, state).status)).length,
    claimedTasks: data.tasks.filter((task) => taskStatus(task, state).claimed).length,
    selectedTaskId,
    activeTaskId: state?.activeTaskId ?? null,
  });
  const modes = ADVENTURE_MODE_IDS
    .filter((mode) => data.tasks.some((task) => task.mode === mode))
    .concat(data.tasks.map((task) => task.mode).filter((mode) => !ADVENTURE_MODE_IDS.includes(mode as typeof ADVENTURE_MODE_IDS[number])))
    .filter((mode, index, all) => all.indexOf(mode) === index)
    .map((mode) => ({ id: mode, label: ADVENTURE_MODE_LABELS[mode] ?? mode, selected: filter.mode === mode }));
  const statuses = (['all', 'ready', 'locked', 'inProgress', 'failed', 'completed', 'claimed'] as const)
    .map((status) => ({ id: status, label: status === 'all' ? '全部状态' : ADVENTURE_STATUS_LABELS[status], selected: filter.status === status }));
  const filterComponent: AdventureFilterComponent = deepFreeze({
    id: 'filters', kind: 'filters', state: 'ready', filter: cloneFilter(filter), modes, statuses,
  });
  const tasks = visible.map((task) => taskComponent(task, state, selectedTaskId));
  const selected = visible.find((task) => task.id === selectedTaskId) ?? visible[0]!;
  return Object.freeze([header, filterComponent, ...tasks, detailComponent(selected, state, selectedTaskId)]);
}

export { deepFreeze, taskStatus, visibleTasks };
