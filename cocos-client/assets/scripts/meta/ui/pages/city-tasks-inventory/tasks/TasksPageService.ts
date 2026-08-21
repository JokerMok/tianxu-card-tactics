import {
  MAINLINE_TASK_DEFINITIONS,
  MainlineTaskError,
  MainlineTaskService,
  type MainlineTaskDefinition,
  type MainlineTaskEvent,
  type MainlineTaskState,
} from '../../../../tasks/mainline/MainlineTasks.ts';
import { createTasksPageComponents, deepFreeze, taskStatus } from './TasksComponents.ts';
import {
  TASKS_PAGE_SCHEMA_VERSION,
  type TasksInteraction,
  type TasksInteractionReason,
  type TasksInteractionResult,
  type TasksPageData,
  type TasksPageDataFactoryOptions,
  type TasksPageServiceOptions,
  type TasksPageSnapshot,
  type TasksTaskData,
} from './TasksContracts.ts';

export type TasksPageErrorCode =
  | 'INVALID_ARGUMENT'
  | 'MISSING_FIELD'
  | 'INVALID_DATA'
  | 'INVALID_ID'
  | 'DUPLICATE_ID'
  | 'TASK_NOT_FOUND'
  | 'TASK_LOCKED'
  | 'TASK_NOT_READY'
  | 'TASK_ALREADY_COMPLETE'
  | 'STATE_NOT_AVAILABLE'
  | 'INVALID_STATE'
  | 'INVALID_SAVE'
  | 'INDEX_OUT_OF_RANGE'
  | 'PERSISTENCE_FAILED';

export class TasksPageError extends Error {
  readonly code: TasksPageErrorCode;
  readonly reason: TasksPageErrorCode;
  readonly cause?: unknown;

  constructor(code: TasksPageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'TasksPageError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code: TasksPageErrorCode, message: string, cause?: unknown): never {
  throw new TasksPageError(code, message, cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) fail('INVALID_ARGUMENT', `${label} must be a plain object`);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    const missing = allowed.find((key) => !actual.includes(key));
    fail(missing === undefined ? 'INVALID_DATA' : 'MISSING_FIELD', `${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) fail('INVALID_ARGUMENT', `${label} contains unsupported field: ${unknown}`);
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail('INVALID_DATA', `${label} must be a non-empty string`);
}

const DANGEROUS_TASK_IDS = new Set([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
]);

function safeTaskId(value: unknown, label: string): asserts value is string {
  nonEmptyString(value, label);
  if (DANGEROUS_TASK_IDS.has(value)) fail('INVALID_ID', `${label} is a reserved object key`);
}

function safeInteger(value: unknown, label: string, positive = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
    fail('INVALID_DATA', `${label} must be ${positive ? 'a positive' : 'a non-negative'} safe integer`);
  }
}

function cloneTask(task: TasksTaskData): TasksTaskData {
  return {
    id: task.id,
    title: task.title,
    target: task.target,
    trigger: { ...task.trigger },
    unlocks: [...task.unlocks],
    rewardPoolId: task.rewardPoolId,
  };
}

function cloneData(data: TasksPageData): TasksPageData {
  return { ...data, tasks: data.tasks.map(cloneTask) };
}

function normalizeTrigger(value: unknown, label: string): MainlineTaskDefinition['trigger'] {
  assertRecord(value, label);
  nonEmptyString(value.type, `${label}.type`);
  if (value.type === 'CAMPAIGN_LEVEL_CLEARED') {
    assertExactKeys(value, ['type', 'levelId'], label);
    nonEmptyString(value.levelId, `${label}.levelId`);
    return { type: value.type, levelId: value.levelId };
  }
  if (value.type === 'STORY_NODE_READ') {
    assertExactKeys(value, ['type', 'nodeId'], label);
    nonEmptyString(value.nodeId, `${label}.nodeId`);
    return { type: value.type, nodeId: value.nodeId };
  }
  if (value.type === 'DECK_UPDATED') {
    const unknown = Object.keys(value).find((key) => !['type', 'deckId'].includes(key));
    if (unknown !== undefined) fail('INVALID_DATA', `${label} contains unsupported field: ${unknown}`);
    if (value.deckId !== undefined) nonEmptyString(value.deckId, `${label}.deckId`);
    return value.deckId === undefined ? { type: value.type } : { type: value.type, deckId: value.deckId };
  }
  fail('INVALID_DATA', `${label}.type is unsupported`);
}

function normalizeTask(value: unknown, index: number): TasksTaskData {
  assertRecord(value, `tasks[${index}]`);
  const source = value as Record<string, unknown>;
  const allowed = ['id', 'title', 'target', 'trigger', 'unlocks', 'rewardPoolId'];
  const unknown = Object.keys(source).find((key) => !allowed.includes(key));
  if (unknown !== undefined) fail('INVALID_DATA', `tasks[${index}] contains unsupported field: ${unknown}`);
  for (const key of allowed) if (!Object.prototype.hasOwnProperty.call(source, key)) fail('MISSING_FIELD', `tasks[${index}] is missing ${key}`);
  safeTaskId(source.id, `tasks[${index}].id`);
  nonEmptyString(source.title, `tasks[${index}].title`);
  safeInteger(source.target, `tasks[${index}].target`, true);
  const trigger = normalizeTrigger(source.trigger, `tasks[${index}].trigger`);
  if (!Array.isArray(source.unlocks)) fail('INVALID_ARGUMENT', `tasks[${index}].unlocks must be an array`);
  source.unlocks.forEach((unlock, unlockIndex) => nonEmptyString(unlock, `tasks[${index}].unlocks[${unlockIndex}]`));
  if (source.rewardPoolId !== null) nonEmptyString(source.rewardPoolId, `tasks[${index}].rewardPoolId`);
  return {
    id: source.id,
    title: source.title,
    target: source.target,
    trigger,
    unlocks: [...source.unlocks],
    rewardPoolId: source.rewardPoolId,
  };
}

function normalizeDefinitions(input: readonly unknown[]): readonly TasksTaskData[] {
  const ids = new Set<string>();
  const tasks = input.map((raw, index) => {
    const task = normalizeTask(raw, index);
    if (ids.has(task.id)) fail('DUPLICATE_ID', `duplicate task id: ${task.id}`);
    ids.add(task.id);
    return task;
  });
  return tasks;
}

function definitionToPageTask(value: unknown, index: number): TasksTaskData {
  assertRecord(value, `taskDefinitions[${index}]`);
  assertAllowedKeys(value, ['id', 'title', 'target', 'trigger', 'unlocks', 'rewardPoolId'], `taskDefinitions[${index}]`);
  return {
    id: value.id as string,
    title: value.title === undefined ? value.id as string : value.title as string,
    target: value.target as number,
    trigger: value.trigger as MainlineTaskDefinition['trigger'],
    unlocks: value.unlocks as readonly string[],
    rewardPoolId: value.rewardPoolId === undefined ? null : value.rewardPoolId as string | null,
  };
}

function inputRows(options: TasksPageDataFactoryOptions): { readonly rows: readonly unknown[]; readonly fromDefinitions: boolean } {
  assertRecord(options, 'tasks page data options');
  const hasTasks = Object.prototype.hasOwnProperty.call(options, 'tasks');
  const hasDefinitions = Object.prototype.hasOwnProperty.call(options, 'taskDefinitions');
  if (hasTasks && hasDefinitions) fail('INVALID_ARGUMENT', 'tasks and taskDefinitions cannot both be provided');
  if (!hasTasks && !hasDefinitions) return { rows: MAINLINE_TASK_DEFINITIONS, fromDefinitions: true };
  const rows = hasTasks ? options.tasks : options.taskDefinitions;
  if (!Array.isArray(rows)) fail('INVALID_ARGUMENT', `${hasTasks ? 'tasks' : 'taskDefinitions'} must be an array`);
  return { rows, fromDefinitions: hasDefinitions };
}

export function createTasksPageData(options: TasksPageDataFactoryOptions = {}): TasksPageData {
  const input = inputRows(options);
  const tasks = input.fromDefinitions
    ? normalizeDefinitions(input.rows.map((raw, index) => definitionToPageTask(raw, index)))
    : normalizeDefinitions(input.rows);
  return deepFreeze({
    schemaVersion: TASKS_PAGE_SCHEMA_VERSION,
    title: options.title ?? '任务与活跃',
    subtitle: options.subtitle ?? '主线目标按真实章节进度顺序解锁。',
    tasks,
  });
}

export function createDefaultTasksPageData(): TasksPageData {
  return createTasksPageData();
}

export function createEmptyTasksPageData(): TasksPageData {
  return deepFreeze({
    schemaVersion: TASKS_PAGE_SCHEMA_VERSION,
    title: '任务与活跃',
    subtitle: '暂无可用任务',
    tasks: [],
  });
}

export const TASKS_DEFAULT_DATA = createDefaultTasksPageData();

function validateData(input: TasksPageData): TasksPageData {
  assertRecord(input, 'tasks page data');
  assertExactKeys(input, ['schemaVersion', 'title', 'subtitle', 'tasks'], 'tasks page data');
  if (input.schemaVersion !== TASKS_PAGE_SCHEMA_VERSION) fail('INVALID_DATA', 'unsupported tasks page schema version');
  nonEmptyString(input.title, 'tasks page title');
  nonEmptyString(input.subtitle, 'tasks page subtitle');
  if (!Array.isArray(input.tasks)) fail('INVALID_ARGUMENT', 'tasks page tasks must be an array');
  return {
    schemaVersion: TASKS_PAGE_SCHEMA_VERSION,
    title: input.title,
    subtitle: input.subtitle,
    tasks: normalizeDefinitions(input.tasks),
  };
}

function mapDomainError(error: unknown): never {
  if (!(error instanceof MainlineTaskError)) throw error;
  const map: Partial<Record<string, TasksPageErrorCode>> = {
    INVALID_ARGUMENT: 'INVALID_ARGUMENT',
    INVALID_CONFIG: 'INVALID_DATA',
    INVALID_TASK_ID: 'TASK_NOT_FOUND',
    INVALID_STATE: 'INVALID_STATE',
    INVALID_SAVE: 'INVALID_SAVE',
    SAVE_VERSION: 'INVALID_SAVE',
    TASK_NOT_AVAILABLE: 'TASK_LOCKED',
    INVALID_EVENT: 'TASK_NOT_READY',
    CHAPTER_COMPLETE: 'TASK_ALREADY_COMPLETE',
    PERSISTENCE_FAILED: 'PERSISTENCE_FAILED',
  };
  throw new TasksPageError(map[error.code] ?? 'INVALID_DATA', error.message, error);
}

function isPageData(value: unknown): value is TasksPageData {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'schemaVersion');
}

function result(
  accepted: boolean,
  changed: boolean,
  reason: TasksInteractionReason,
  taskId: string | null,
  progress: number | null,
): TasksInteractionResult {
  return Object.freeze({ accepted, changed, reason, taskId, progress });
}

function triggerMatchesEvent(task: TasksTaskData, event: MainlineTaskEvent): boolean {
  if (task.trigger.type !== event.type) return false;
  if (task.trigger.levelId !== undefined && task.trigger.levelId !== '*' && task.trigger.levelId !== event.levelId) return false;
  if (task.trigger.nodeId !== undefined && task.trigger.nodeId !== '*' && task.trigger.nodeId !== event.nodeId) return false;
  if (task.trigger.deckId !== undefined && task.trigger.deckId !== event.deckId) return false;
  return true;
}

function eventStateKey(event: MainlineTaskEvent): string {
  if (event.key !== undefined) return `${event.type}:${event.key}`;
  const identity = event.levelId ?? event.nodeId ?? event.deckId ?? 'default';
  return `${event.type}:${identity}`;
}

export class TasksPageService {
  private readonly data: TasksPageData;
  private readonly persist?: (serialized: string) => void;
  private stateService: MainlineTaskService | null;
  private selectedTaskId: string | null;

  constructor(input: TasksPageData | TasksPageServiceOptions = {}) {
    const options: TasksPageServiceOptions = isPageData(input) ? { data: input } : input;
    assertRecord(options, 'tasks page options');
    assertAllowedKeys(options, ['data', 'taskDefinitions', 'tasks', 'title', 'subtitle', 'initialState', 'state', 'onSave', 'persist'], 'tasks page options');
    const data = options.data === undefined ? createTasksPageData(options) : validateData(options.data);
    if (options.data !== undefined && (options.tasks !== undefined || options.taskDefinitions !== undefined)) fail('INVALID_ARGUMENT', 'data cannot be combined with task input');
    if (options.persist !== undefined && options.onSave !== undefined && options.persist !== options.onSave) fail('INVALID_ARGUMENT', 'persist and onSave cannot both be provided');
    this.persist = options.persist ?? options.onSave;
    if (this.persist !== undefined && typeof this.persist !== 'function') fail('INVALID_ARGUMENT', 'tasks persistence must be a function');
    this.data = deepFreeze(cloneData(data));
    if (this.data.tasks.length === 0) {
      if (options.initialState !== undefined || options.state !== undefined || this.persist !== undefined) fail('STATE_NOT_AVAILABLE', 'empty tasks page cannot own state or persistence');
      this.stateService = null;
      this.selectedTaskId = null;
      return;
    }
    try {
      this.stateService = new MainlineTaskService({
        definitions: this.data.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          target: task.target,
          trigger: task.trigger,
          unlocks: task.unlocks,
          ...(task.rewardPoolId === null ? {} : { rewardPoolId: task.rewardPoolId }),
        })),
        initialState: options.initialState ?? options.state,
        persist: this.persist,
      });
    } catch (error) {
      mapDomainError(error);
    }
    this.selectedTaskId = this.firstSelectableTaskId();
  }

  get pageData(): TasksPageData {
    return cloneData(this.data);
  }

  get state(): MainlineTaskState | null {
    return this.stateService?.snapshot() ?? null;
  }

  snapshot(): TasksPageSnapshot {
    return deepFreeze({
      schemaVersion: TASKS_PAGE_SCHEMA_VERSION,
      pageId: 'tasks',
      selectedTaskId: this.selectedTaskId,
      state: this.state,
      components: createTasksPageComponents(this.data, this.state, this.selectedTaskId),
    });
  }

  serialize(): string {
    if (this.stateService === null) fail('STATE_NOT_AVAILABLE', 'empty tasks page has no state');
    return this.stateService.serialize();
  }

  restore(serialized: string): TasksPageSnapshot {
    if (this.stateService === null) fail('STATE_NOT_AVAILABLE', 'empty tasks page has no state');
    let candidate: MainlineTaskService;
    try {
      candidate = new MainlineTaskService({
        definitions: this.data.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          target: task.target,
          trigger: task.trigger,
          unlocks: task.unlocks,
          ...(task.rewardPoolId === null ? {} : { rewardPoolId: task.rewardPoolId }),
        })),
        initialState: serialized,
        persist: this.persist,
      });
    } catch (error) {
      mapDomainError(error);
    }
    this.stateService = candidate!;
    this.selectedTaskId = this.firstSelectableTaskId();
    return this.snapshot();
  }

  selectTask(taskId: string): TasksInteractionResult {
    if (this.stateService === null) return result(false, false, 'empty', null, null);
    const task = this.task(taskId);
    const progress = this.state!.tasks[task.id].progress;
    if (this.selectedTaskId === task.id) return result(true, false, 'same', task.id, progress);
    this.selectedTaskId = task.id;
    return result(true, true, 'selected', task.id, progress);
  }

  advanceTask(taskId?: string, event?: MainlineTaskEvent): TasksInteractionResult {
    if (this.stateService === null) return result(false, false, 'empty', null, null);
    const task = this.task(taskId ?? this.selectedTaskId);
    const status = taskStatus(this.data, task, this.state);
    if (status === 'locked') fail('TASK_LOCKED', `task is locked: ${task.id}`);
    const taskEvent = event ?? task.trigger;
    if (status === 'completed' || status === 'claimed') {
      const taskState = this.state!.tasks[task.id];
      const isProcessedEvent = isRecord(taskEvent)
        && triggerMatchesEvent(task, taskEvent as MainlineTaskEvent)
        && taskState.eventKeys.includes(eventStateKey(taskEvent as MainlineTaskEvent));
      if (!isProcessedEvent) fail('TASK_ALREADY_COMPLETE', `task is already complete: ${task.id}`);
    }
    let advanceResult: ReturnType<MainlineTaskService['advance']>;
    try {
      advanceResult = this.stateService!.advance(taskEvent);
    } catch (error) {
      mapDomainError(error);
    }
    const progress = this.state!.tasks[task.id].progress;
    if (!advanceResult!.applied) return result(false, false, 'duplicate', task.id, progress);
    return result(true, true, progress >= task.target ? 'completed' : 'progressed', task.id, progress);
  }

  claimTask(taskId?: string): TasksInteractionResult {
    if (this.stateService === null) return result(false, false, 'empty', null, null);
    const task = this.task(taskId ?? this.selectedTaskId);
    const status = taskStatus(this.data, task, this.state);
    if (status === 'locked') fail('TASK_LOCKED', `task is locked: ${task.id}`);
    const before = this.state!.tasks[task.id];
    try {
      const claimed = this.stateService!.claim(task.id);
      if (!claimed.applied) return result(false, false, 'not-ready', task.id, before.progress);
    } catch (error) {
      mapDomainError(error);
    }
    return result(true, true, 'claimed', task.id, this.state!.tasks[task.id].progress);
  }

  interact(input: TasksInteraction): TasksInteractionResult {
    assertRecord(input, 'tasks interaction');
    switch (input.type) {
      case 'selectTask': return this.selectTask(input.taskId);
      case 'advanceTask': return this.advanceTask(input.taskId, input.event);
      case 'claimTask': return this.claimTask(input.taskId);
      default: fail('INVALID_ARGUMENT', `unsupported tasks interaction: ${String(input.type)}`);
    }
  }

  private task(taskId: string | null): TasksTaskData {
    if (typeof taskId !== 'string' || taskId.trim().length === 0) fail('INVALID_ID', 'task id must be a non-empty string');
    const task = this.data.tasks.find((candidate) => candidate.id === taskId);
    if (task === undefined) fail('TASK_NOT_FOUND', `unknown task: ${taskId}`);
    return task;
  }

  private firstSelectableTaskId(): string | null {
    if (this.stateService === null) return null;
    const state = this.stateService.snapshot();
    return this.data.tasks.find((task) => !state.tasks[task.id].completed)?.id
      ?? this.data.tasks.at(-1)!.id;
  }
}
