import {
  ADVENTURE_MODE_IDS,
  ADVENTURE_PAGE_SCHEMA_VERSION,
  ADVENTURE_STATUS_IDS,
  type AdventureFilter,
  type AdventureInteraction,
  type AdventureInteractionReason,
  type AdventureInteractionResult,
  type AdventureModeId,
  type AdventurePageData,
  type AdventurePageDataFactoryOptions,
  type AdventurePageServiceOptions,
  type AdventurePageSnapshot,
  type AdventurePageState,
  type AdventureRewardData,
  type AdventureTaskData,
  type AdventureTaskProgress,
  type AdventureTaskStatus,
} from './AdventureContracts.ts';
import { createAdventurePageComponents, taskStatus } from './AdventureComponents.ts';

export type AdventurePageErrorCode =
  | 'INVALID_ARGUMENT' | 'MISSING_FIELD' | 'INVALID_DATA' | 'INVALID_ID'
  | 'DUPLICATE_ID' | 'TASK_NOT_FOUND' | 'TASK_NOT_VISIBLE' | 'FILTER_INVALID'
  | 'STATE_NOT_AVAILABLE' | 'STATE_DATA_MISMATCH' | 'INVALID_STATE' | 'INVALID_SAVE'
  | 'SAVE_VERSION' | 'TASK_LOCKED' | 'NO_ACTIVE_TASK' | 'ACTIVE_TASK_MISMATCH'
  | 'TASK_NOT_READY' | 'TASK_ALREADY_ACTIVE' | 'TASK_ALREADY_CLAIMED'
  | 'INVALID_PROGRESS' | 'PERSISTENCE_FAILED' | 'REENTRANT';

export class AdventurePageError extends Error {
  readonly code: AdventurePageErrorCode;
  readonly reason: AdventurePageErrorCode;
  readonly cause?: unknown;

  constructor(code: AdventurePageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'AdventurePageError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code: AdventurePageErrorCode, message: string, cause?: unknown): never {
  throw new AdventurePageError(code, message, cause);
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

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string, code: AdventurePageErrorCode = 'INVALID_DATA'): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    const missing = allowed.find((key) => !actual.includes(key));
    fail(missing ? 'MISSING_FIELD' : code, `${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) fail('INVALID_DATA', `${label} contains unsupported field: ${unknown}`);
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail('INVALID_DATA', `${label} must be a non-empty string`);
}

function safeInteger(value: unknown, label: string, positive = false): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) {
    fail('INVALID_DATA', `${label} must be ${positive ? 'a positive' : 'a non-negative'} safe integer`);
  }
}

function cloneReward(reward: AdventureRewardData): AdventureRewardData {
  return { id: reward.id, label: reward.label, quantity: reward.quantity, ...(reward.type === undefined ? {} : { type: reward.type }) };
}

function cloneTask(task: AdventureTaskData): AdventureTaskData {
  return { ...task, rewards: task.rewards.map(cloneReward) };
}

function cloneData(data: AdventurePageData): AdventurePageData {
  return { ...data, tasks: data.tasks.map(cloneTask) };
}

function cloneFilter(filter: AdventureFilter): AdventureFilter {
  return { mode: filter.mode, status: filter.status, taskIds: [...filter.taskIds] };
}

function rows(input: unknown, keys: readonly string[]): readonly unknown[] {
  if (Array.isArray(input)) return input;
  if (isRecord(input)) {
    for (const key of keys) if (Array.isArray(input[key])) return input[key] as readonly unknown[];
  }
  return [];
}

function normalizeReward(raw: unknown, index: number): AdventureRewardData {
  assertRecord(raw, `adventure reward[${index}]`);
  assertAllowedKeys(raw, ['id', 'label', 'quantity', 'type'], `adventure reward[${index}]`);
  nonEmptyString(raw.id, `adventure reward[${index}].id`);
  const label = raw.label ?? raw.id;
  nonEmptyString(label, `adventure reward[${index}].label`);
  safeInteger(raw.quantity, `adventure reward[${index}].quantity`, true);
  if (raw.type !== undefined) nonEmptyString(raw.type, `adventure reward[${index}].type`);
  return { id: raw.id, label, quantity: raw.quantity, ...(raw.type === undefined ? {} : { type: raw.type }) };
}

function normalizeTask(raw: unknown, index: number): AdventureTaskData {
  assertRecord(raw, `adventure tasks[${index}]`);
  assertAllowedKeys(raw, [
    'id', 'mode', 'label', 'title', 'description', 'objective', 'target', 'recommendedPower',
    'staminaCost', 'rewards', 'prerequisiteTaskId', 'status', 'progress', 'unlocks', 'rewardPoolId', 'trigger',
  ], `adventure tasks[${index}]`);
  nonEmptyString(raw.id, `adventure tasks[${index}].id`);
  const trigger = isRecord(raw.trigger) ? raw.trigger : null;
  const mode = raw.mode ?? (trigger?.type === 'CAMPAIGN_LEVEL_CLEARED' ? 'dungeon' : 'dungeon');
  nonEmptyString(mode, `adventure tasks[${index}].mode`);
  const label = raw.label ?? raw.title ?? raw.id;
  const title = raw.title ?? label;
  const description = raw.description ?? raw.objective ?? '完成历练目标。';
  const objective = raw.objective ?? (trigger?.type as string | undefined) ?? title;
  nonEmptyString(label, `adventure tasks[${index}].label`);
  nonEmptyString(title, `adventure tasks[${index}].title`);
  nonEmptyString(description, `adventure tasks[${index}].description`);
  nonEmptyString(objective, `adventure tasks[${index}].objective`);
  safeInteger(raw.target ?? 1, `adventure tasks[${index}].target`, true);
  safeInteger(raw.recommendedPower ?? 0, `adventure tasks[${index}].recommendedPower`);
  safeInteger(raw.staminaCost ?? 0, `adventure tasks[${index}].staminaCost`);
  if (raw.target !== undefined && raw.target <= 0) fail('INVALID_DATA', `adventure tasks[${index}].target must be positive`);
  if (raw.recommendedPower !== undefined && raw.recommendedPower < 0) fail('INVALID_DATA', `adventure tasks[${index}].recommendedPower is invalid`);
  if (raw.staminaCost !== undefined && raw.staminaCost < 0) fail('INVALID_DATA', `adventure tasks[${index}].staminaCost is invalid`);
  const rewards = Object.prototype.hasOwnProperty.call(raw, 'rewards')
    ? raw.rewards
    : (raw.rewardPoolId === undefined
    ? []
    : [{ id: raw.rewardPoolId, label: raw.rewardPoolId, quantity: 1, type: 'POOL' }]);
  if (!Array.isArray(rewards)) fail('INVALID_ARGUMENT', `adventure tasks[${index}].rewards must be an array`);
  if (raw.prerequisiteTaskId !== undefined && raw.prerequisiteTaskId !== null) nonEmptyString(raw.prerequisiteTaskId, `adventure tasks[${index}].prerequisiteTaskId`);
  return {
    id: raw.id,
    mode,
    label,
    title,
    description,
    objective,
    target: raw.target ?? 1,
    recommendedPower: raw.recommendedPower ?? 0,
    staminaCost: raw.staminaCost ?? 0,
    rewards: rewards.map(normalizeReward),
    prerequisiteTaskId: raw.prerequisiteTaskId ?? null,
  };
}

const DEFAULT_TASKS: readonly AdventureTaskData[] = Object.freeze([
  {
    id: 'dungeon', mode: 'dungeon', label: '副本', title: '山海遗踪',
    description: '连续三场战斗，关间状态由出战牌组继承。', objective: '完成三场副本战斗',
    target: 3, recommendedPower: 1850, staminaCost: 5,
    rewards: [{ id: 'SILVER', label: '银币', quantity: 1800, type: 'CURRENCY' }, { id: 'SCALE', label: '山海鳞片', quantity: 2, type: 'MATERIAL' }], prerequisiteTaskId: null,
  },
  {
    id: 'tower', mode: 'tower', label: '挑战塔', title: '五十层挑战塔',
    description: '逐层挑战强化敌人，每五层获得定向奖励。', objective: '推进挑战塔一层',
    target: 1, recommendedPower: 2050, staminaCost: 0,
    rewards: [{ id: 'TOWER_TOKEN', label: '塔币', quantity: 1, type: 'CURRENCY' }, { id: 'SILVER', label: '银币', quantity: 500, type: 'CURRENCY' }], prerequisiteTaskId: null,
  },
  {
    id: 'boss', mode: 'boss', label: '援军 Boss', title: '吞册玄龟',
    description: '与系统援军共同对抗多阶段山海巨兽。', objective: '击破援军 Boss',
    target: 1, recommendedPower: 2400, staminaCost: 8,
    rewards: [{ id: 'SILVER', label: '银币', quantity: 2600, type: 'CURRENCY' }, { id: 'CRYSTAL', label: '水晶', quantity: 60, type: 'CURRENCY' }, { id: 'ESSENCE', label: '法印残片', quantity: 6, type: 'MATERIAL' }], prerequisiteTaskId: null,
  },
]);

function normalizeTaskRows(options: AdventurePageDataFactoryOptions): readonly unknown[] {
  const source = options.tasks ?? options.adventures ?? options.modes;
  if (source !== undefined) return rows(source, ['tasks', 'adventures', 'modes']);
  if (options.taskDefinitions !== undefined) return options.taskDefinitions;
  return DEFAULT_TASKS;
}

export function createAdventurePageData(options: AdventurePageDataFactoryOptions = {}): AdventurePageData {
  const tasks = normalizeTaskRows(options).map(normalizeTask);
  const ids = new Set<string>();
  for (const task of tasks) {
    if (ids.has(task.id)) fail('DUPLICATE_ID', `duplicate adventure task: ${task.id}`);
    ids.add(task.id);
    if (task.prerequisiteTaskId !== null && !tasks.some((candidate) => candidate.id === task.prerequisiteTaskId)) {
      fail('INVALID_DATA', `adventure task prerequisite is unknown: ${task.prerequisiteTaskId}`);
    }
    if (task.prerequisiteTaskId === task.id) fail('INVALID_DATA', `adventure task cannot depend on itself: ${task.id}`);
  }
  return {
    schemaVersion: ADVENTURE_PAGE_SCHEMA_VERSION,
    title: options.title ?? '历练',
    subtitle: options.subtitle ?? '副本、挑战塔与援军 Boss 共用出战牌组。',
    tasks,
  };
}

export function createDefaultAdventurePageData(options: AdventurePageDataFactoryOptions = {}): AdventurePageData {
  return createAdventurePageData(options);
}

export function createEmptyAdventurePageData(): AdventurePageData {
  return { schemaVersion: ADVENTURE_PAGE_SCHEMA_VERSION, title: '历练', subtitle: '暂无可用历练任务', tasks: [] };
}

export const ADVENTURE_DEFAULT_DATA = createDefaultAdventurePageData();

function validateData(input: AdventurePageData): AdventurePageData {
  assertRecord(input, 'adventure page data');
  assertExactKeys(input, ['schemaVersion', 'title', 'subtitle', 'tasks'], 'adventure page data');
  if (input.schemaVersion !== ADVENTURE_PAGE_SCHEMA_VERSION) fail('INVALID_DATA', 'unsupported adventure page schema version');
  nonEmptyString(input.title, 'adventure page title');
  nonEmptyString(input.subtitle, 'adventure page subtitle');
  if (!Array.isArray(input.tasks)) fail('INVALID_ARGUMENT', 'adventure page tasks must be an array');
  return createAdventurePageData({ title: input.title, subtitle: input.subtitle, tasks: input.tasks });
}

function defaultFilter(): AdventureFilter {
  return { mode: 'all', status: 'all', taskIds: [] };
}

function cloneProgress(progress: AdventureTaskProgress): AdventureTaskProgress {
  return { ...progress };
}

function cloneState(state: AdventurePageState): AdventurePageState {
  const tasks: Record<string, AdventureTaskProgress> = {};
  for (const [id, progress] of Object.entries(state.tasks)) tasks[id] = cloneProgress(progress);
  return {
    schemaVersion: state.schemaVersion,
    pageId: state.pageId,
    selectedTaskId: state.selectedTaskId,
    activeTaskId: state.activeTaskId,
    filter: cloneFilter(state.filter),
    tasks,
  };
}

function parseFilter(
  value: unknown,
  taskIds: ReadonlySet<string>,
  label = 'adventure filter',
  modes: ReadonlySet<string> = new Set(),
): AdventureFilter {
  assertRecord(value, label);
  assertExactKeys(value, ['mode', 'status', 'taskIds'], label, 'INVALID_STATE');
  if (value.mode !== 'all' && (typeof value.mode !== 'string' || value.mode.length === 0 || (modes.size > 0 && !modes.has(value.mode)))) fail('FILTER_INVALID', `${label}.mode is invalid`);
  if (value.status !== 'all' && !ADVENTURE_STATUS_IDS.includes(value.status as AdventureTaskStatus)) fail('FILTER_INVALID', `${label}.status is invalid`);
  if (!Array.isArray(value.taskIds) || value.taskIds.some((id) => typeof id !== 'string' || !taskIds.has(id))) fail('FILTER_INVALID', `${label}.taskIds contains an unknown task`);
  const uniqueIds = [...new Set(value.taskIds as string[])];
  if (uniqueIds.length !== value.taskIds.length) fail('FILTER_INVALID', `${label}.taskIds contains duplicates`);
  return { mode: value.mode as AdventureModeId | 'all', status: value.status as AdventureTaskStatus | 'all', taskIds: uniqueIds };
}

function defaultProgress(task: AdventureTaskData): AdventureTaskProgress {
  return { taskId: task.id, status: 'ready', progress: 0, attempts: 0, claimed: false };
}

function parseState(value: unknown, data: AdventurePageData): AdventurePageState {
  const taskIds = new Set(data.tasks.map((task) => task.id));
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch { fail('INVALID_SAVE', 'adventure save is not valid JSON'); }
  }
  assertRecord(parsed, 'adventure state');
  assertExactKeys(parsed, ['schemaVersion', 'pageId', 'selectedTaskId', 'activeTaskId', 'filter', 'tasks'], 'adventure state', 'INVALID_STATE');
  if (parsed.schemaVersion !== ADVENTURE_PAGE_SCHEMA_VERSION) fail('SAVE_VERSION', 'unsupported adventure save version');
  if (parsed.pageId !== 'adventure') fail('INVALID_STATE', 'adventure save pageId is invalid');
  if (typeof parsed.selectedTaskId !== 'string' || !taskIds.has(parsed.selectedTaskId)) fail('TASK_NOT_FOUND', 'saved selected task is not configured');
  if (parsed.activeTaskId !== null && (typeof parsed.activeTaskId !== 'string' || !taskIds.has(parsed.activeTaskId))) fail('TASK_NOT_FOUND', 'saved active task is not configured');
  const filter = parseFilter(parsed.filter, taskIds, 'adventure state filter', new Set(data.tasks.map((task) => task.mode)));
  assertRecord(parsed.tasks, 'adventure state tasks');
  assertExactKeys(parsed.tasks, [...taskIds], 'adventure state tasks', 'INVALID_STATE');
  const tasks: Record<string, AdventureTaskProgress> = {};
  for (const task of data.tasks) {
    const raw = parsed.tasks[task.id];
    assertRecord(raw, `adventure state tasks.${task.id}`);
    assertExactKeys(raw, ['taskId', 'status', 'progress', 'attempts', 'claimed'], `adventure state tasks.${task.id}`, 'INVALID_STATE');
    if (raw.taskId !== task.id || !ADVENTURE_STATUS_IDS.includes(raw.status as AdventureTaskStatus) || raw.status === 'locked') fail('INVALID_STATE', `adventure state tasks.${task.id} is invalid`);
    safeInteger(raw.progress, `adventure state tasks.${task.id}.progress`);
    safeInteger(raw.attempts, `adventure state tasks.${task.id}.attempts`);
    if (raw.progress > task.target || raw.attempts < 0 || typeof raw.claimed !== 'boolean') fail('INVALID_STATE', `adventure state tasks.${task.id} is out of range`);
    if (raw.status === 'claimed' && raw.claimed !== true) fail('INVALID_STATE', `adventure state tasks.${task.id} claimed flag is inconsistent`);
    if (raw.claimed && raw.status !== 'claimed') fail('INVALID_STATE', `adventure state tasks.${task.id} status is inconsistent`);
    if (raw.status === 'completed' && raw.progress < task.target) fail('INVALID_STATE', `adventure state tasks.${task.id} completed before target`);
    tasks[task.id] = { taskId: task.id, status: raw.status as Exclude<AdventureTaskStatus, 'locked'>, progress: raw.progress, attempts: raw.attempts, claimed: raw.claimed };
  }
  if (parsed.activeTaskId !== null && tasks[parsed.activeTaskId].status !== 'inProgress') fail('INVALID_STATE', 'active adventure task must be in progress');
  if (Object.values(tasks).filter((task) => task.status === 'inProgress').length > (parsed.activeTaskId === null ? 0 : 1)) fail('INVALID_STATE', 'only one adventure task may be active');
  return { schemaVersion: ADVENTURE_PAGE_SCHEMA_VERSION, pageId: 'adventure', selectedTaskId: parsed.selectedTaskId, activeTaskId: parsed.activeTaskId as string | null, filter, tasks };
}

function freshState(data: AdventurePageData): AdventurePageState {
  const tasks: Record<string, AdventureTaskProgress> = {};
  for (const task of data.tasks) tasks[task.id] = defaultProgress(task);
  return { schemaVersion: ADVENTURE_PAGE_SCHEMA_VERSION, pageId: 'adventure', selectedTaskId: data.tasks[0]!.id, activeTaskId: null, filter: defaultFilter(), tasks };
}

function result(accepted: boolean, changed: boolean, reason: AdventureInteractionReason, taskId: string | null, mode: AdventureModeId | null, progress: number | null): AdventureInteractionResult {
  return Object.freeze({ accepted, changed, reason, taskId, mode, progress });
}

function isPageData(value: unknown): value is AdventurePageData {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'schemaVersion') && Object.prototype.hasOwnProperty.call(value, 'tasks');
}

export class AdventurePageService {
  private readonly data: AdventurePageData;
  private current: AdventurePageState | null;
  private readonly persistCallback?: (serialized: string) => void;
  private transactionActive = false;

  constructor(input: AdventurePageData | AdventurePageServiceOptions = {}) {
    const options: AdventurePageServiceOptions = isPageData(input) ? { data: input } : input;
    assertRecord(options, 'adventure page options');
    assertAllowedKeys(options, ['data', 'tasks', 'adventures', 'modes', 'taskDefinitions', 'title', 'subtitle', 'initialState', 'state', 'onSave', 'persist'], 'adventure page options');
    this.data = options.data === undefined
      ? createAdventurePageData(options)
      : validateData(options.data);
    this.persistCallback = options.onSave ?? options.persist;
    if (this.data.tasks.length === 0) {
      if (options.initialState !== undefined || options.state !== undefined) fail('STATE_DATA_MISMATCH', 'an empty adventure page cannot restore state');
      if (this.persistCallback !== undefined) fail('STATE_NOT_AVAILABLE', 'an empty adventure page cannot persist state');
      this.current = null;
      return;
    }
    const initial = options.initialState ?? options.state;
    this.current = initial === undefined ? freshState(this.data) : parseState(initial, this.data);
  }

  get pageData(): AdventurePageData { return cloneData(this.data); }

  get state(): AdventurePageState | null { return this.current === null ? null : cloneState(this.current); }

  snapshot(): AdventurePageSnapshot {
    const state = this.current === null ? null : cloneState(this.current);
    const components = createAdventurePageComponents(this.data, state);
    const visibleSelected = state === null ? null : components.find((component) => component.kind === 'task' && component.selected)?.taskId ?? null;
    return deepFreeze({
      schemaVersion: ADVENTURE_PAGE_SCHEMA_VERSION,
      pageId: 'adventure',
      selectedTaskId: visibleSelected,
      activeTaskId: state?.activeTaskId ?? null,
      filter: state === null ? null : cloneFilter(state.filter),
      state,
      components,
    }) as AdventurePageSnapshot;
  }

  interact(action: AdventureInteraction): AdventureInteractionResult {
    if (!isRecord(action) || typeof action.type !== 'string') fail('INVALID_ARGUMENT', 'adventure interaction must contain a type');
    switch (action.type) {
      case 'selectTask': case 'selectAdventure': return this.selectTask(action.taskId);
      case 'setFilter': return this.setFilter(action.filter);
      case 'clearFilter': return this.clearFilter();
      case 'startTask': case 'startAdventure': return this.startTask(action.taskId);
      case 'progressTask': return this.progressTask(action.taskId, action.progress);
      case 'completeTask': case 'completeAdventure': return this.completeTask(action.taskId, action.progress);
      case 'failTask': return this.failTask(action.taskId);
      case 'retryTask': return this.retryTask(action.taskId);
      case 'claimTask': case 'claimReward': return this.claimTask(action.taskId);
      default: fail('INVALID_ARGUMENT', `unknown adventure interaction: ${action.type}`);
    }
  }

  selectTask(taskId: string): AdventureInteractionResult {
    if (this.current === null) return result(false, false, 'empty', null, null, null);
    const task = this.assertTask(taskId);
    if (!this.isVisible(task.id, this.current.filter)) fail('TASK_NOT_VISIBLE', `adventure task is hidden by the current filter: ${taskId}`);
    if (this.current.selectedTaskId === taskId) return result(true, false, 'same', taskId, task.mode, this.progressOf(taskId));
    const next = cloneState(this.current); next.selectedTaskId = taskId;
    this.commit(next);
    return result(true, true, 'selected', taskId, task.mode, this.progressOf(taskId));
  }

  selectAdventure(taskId: string): AdventureInteractionResult { return this.selectTask(taskId); }

  setFilter(input: Partial<AdventureFilter>): AdventureInteractionResult {
    if (this.current === null) return result(false, false, 'empty', null, null, null);
    assertRecord(input, 'adventure filter');
    assertAllowedKeys(input, ['mode', 'status', 'taskIds'], 'adventure filter');
    const candidate = {
      mode: input.mode ?? this.current.filter.mode,
      status: input.status ?? this.current.filter.status,
      taskIds: input.taskIds ?? this.current.filter.taskIds,
    };
    const normalized = parseFilter(candidate, new Set(this.data.tasks.map((task) => task.id)), 'adventure filter', new Set(this.data.tasks.map((task) => task.mode)));
    if (JSON.stringify(normalized) === JSON.stringify(this.current.filter)) return result(true, false, 'same', this.current.selectedTaskId, this.taskById(this.current.selectedTaskId).mode, this.progressOf(this.current.selectedTaskId));
    const next = cloneState(this.current); next.filter = normalized;
    const visible = this.visibleIds(normalized);
    if (visible.length > 0 && !visible.includes(next.selectedTaskId)) next.selectedTaskId = visible[0]!;
    this.commit(next);
    return result(true, true, 'filtered', visible[0] ?? null, visible.length > 0 ? this.taskById(visible[0]!).mode : null, visible.length > 0 ? this.progressOf(visible[0]!) : null);
  }

  clearFilter(): AdventureInteractionResult { return this.setFilter({ mode: 'all', status: 'all', taskIds: [] }); }

  startTask(taskId?: string): AdventureInteractionResult {
    if (this.current === null) return result(false, false, 'empty', null, null, null);
    const id = taskId ?? this.current.selectedTaskId;
    const task = this.assertTask(id);
    if (!this.isVisible(id, this.current.filter)) fail('TASK_NOT_VISIBLE', `adventure task is hidden by the current filter: ${id}`);
    const current = taskStatus(task, this.current);
    if (!current.unlocked) fail('TASK_LOCKED', `adventure task is locked: ${id}`);
    if (this.current.activeTaskId === id) fail('TASK_ALREADY_ACTIVE', `adventure task is already active: ${id}`);
    if (this.current.activeTaskId !== null) fail('ACTIVE_TASK_MISMATCH', 'another adventure task is already active');
    if (!['ready', 'failed'].includes(current.status)) fail('TASK_NOT_READY', `adventure task cannot start from ${current.status}`);
    const next = cloneState(this.current); next.selectedTaskId = id; next.activeTaskId = id;
    const previous = next.tasks[id]; next.tasks[id] = { ...previous, status: 'inProgress', attempts: previous.attempts + 1 };
    this.commit(next);
    return result(true, true, current.status === 'failed' ? 'retried' : 'started', id, task.mode, next.tasks[id].progress);
  }

  startAdventure(taskId?: string): AdventureInteractionResult { return this.startTask(taskId); }

  progressTask(taskId: string | undefined, progress: number): AdventureInteractionResult {
    if (this.current === null) return result(false, false, 'empty', null, null, null);
    const id = taskId ?? this.current.activeTaskId;
    if (id === null || id === undefined) fail('NO_ACTIVE_TASK', 'no adventure task is active');
    const task = this.assertTask(id);
    if (this.current.activeTaskId !== id) fail('ACTIVE_TASK_MISMATCH', `adventure task is not active: ${id}`);
    if (this.current.tasks[id].status !== 'inProgress') fail('TASK_NOT_READY', 'active adventure task is not in progress');
    this.assertProgress(progress, task.target);
    if (progress >= task.target) return this.completeTask(id, progress);
    const next = cloneState(this.current); next.tasks[id] = { ...next.tasks[id], progress };
    this.commit(next);
    return result(true, true, 'progressed', id, task.mode, progress);
  }

  completeTask(taskId?: string, progress = -1): AdventureInteractionResult {
    if (this.current === null) return result(false, false, 'empty', null, null, null);
    const id = taskId ?? this.current.activeTaskId;
    if (id === null || id === undefined) fail('NO_ACTIVE_TASK', 'no adventure task is active');
    const task = this.assertTask(id);
    if (this.current.activeTaskId !== id) fail('ACTIVE_TASK_MISMATCH', `adventure task is not active: ${id}`);
    if (this.current.tasks[id].status !== 'inProgress') fail('TASK_NOT_READY', 'active adventure task is not in progress');
    const completedProgress = progress < 0 ? task.target : progress;
    this.assertProgress(completedProgress, task.target);
    if (completedProgress < task.target) return this.progressTask(id, completedProgress);
    const next = cloneState(this.current); next.activeTaskId = null; next.tasks[id] = { ...next.tasks[id], status: 'completed', progress: task.target };
    this.commit(next);
    return result(true, true, 'completed', id, task.mode, task.target);
  }

  completeAdventure(taskId?: string, progress?: number): AdventureInteractionResult { return this.completeTask(taskId, progress); }

  failTask(taskId?: string): AdventureInteractionResult {
    if (this.current === null) return result(false, false, 'empty', null, null, null);
    const id = taskId ?? this.current.activeTaskId;
    if (id === null || id === undefined) fail('NO_ACTIVE_TASK', 'no adventure task is active');
    const task = this.assertTask(id);
    if (this.current.activeTaskId !== id) fail('ACTIVE_TASK_MISMATCH', `adventure task is not active: ${id}`);
    const next = cloneState(this.current); next.activeTaskId = null; next.tasks[id] = { ...next.tasks[id], status: 'failed' };
    this.commit(next);
    return result(true, true, 'failed', id, task.mode, next.tasks[id].progress);
  }

  retryTask(taskId?: string): AdventureInteractionResult { return this.startTask(taskId); }

  claimTask(taskId?: string): AdventureInteractionResult {
    if (this.current === null) return result(false, false, 'empty', null, null, null);
    const id = taskId ?? this.current.selectedTaskId;
    const task = this.assertTask(id);
    const current = this.current.tasks[id];
    if (current.claimed || current.status === 'claimed') fail('TASK_ALREADY_CLAIMED', `adventure reward is already claimed: ${id}`);
    if (current.status !== 'completed') fail('TASK_NOT_READY', `adventure task is not completed: ${id}`);
    const next = cloneState(this.current); next.tasks[id] = { ...next.tasks[id], status: 'claimed', claimed: true };
    this.commit(next);
    return result(true, true, 'claimed', id, task.mode, next.tasks[id].progress);
  }

  claimReward(taskId?: string): AdventureInteractionResult { return this.claimTask(taskId); }

  serialize(): string {
    if (this.current === null) fail('STATE_NOT_AVAILABLE', 'adventure state is not available for an empty page');
    return JSON.stringify(cloneState(this.current));
  }

  save(): string {
    const serialized = this.serialize();
    if (this.persistCallback === undefined) return serialized;
    this.persist(serialized);
    return serialized;
  }

  restore(serialized: string): AdventurePageSnapshot {
    if (this.current === null) fail('STATE_NOT_AVAILABLE', 'adventure state is not available for an empty page');
    const next = parseState(serialized, this.data);
    this.current = next;
    return this.snapshot();
  }

  private persist(serialized: string): void {
    if (this.persistCallback === undefined) return;
    if (this.transactionActive) fail('REENTRANT', 'adventure persistence is reentrant');
    this.transactionActive = true;
    try { this.persistCallback(serialized); } catch (error) { throw new AdventurePageError('PERSISTENCE_FAILED', 'adventure persistence failed', error); } finally { this.transactionActive = false; }
  }

  private commit(next: AdventurePageState): void {
    const serialized = JSON.stringify(next);
    this.persist(serialized);
    this.current = next;
  }

  private taskById(taskId: string): AdventureTaskData { return this.data.tasks.find((task) => task.id === taskId) ?? fail('TASK_NOT_FOUND', `unknown adventure task: ${taskId}`); }

  private assertTask(taskId: unknown): AdventureTaskData {
    if (typeof taskId !== 'string' || taskId.trim().length === 0) fail('INVALID_ID', 'adventure task id is invalid');
    return this.taskById(taskId);
  }

  private progressOf(taskId: string): number { return this.current?.tasks[taskId]?.progress ?? 0; }

  private isVisible(taskId: string, filter: AdventureFilter): boolean {
    const task = this.taskById(taskId);
    if (filter.mode !== 'all' && task.mode !== filter.mode) return false;
    if (filter.taskIds.length > 0 && !filter.taskIds.includes(taskId)) return false;
    const current = taskStatus(task, this.current);
    return filter.status === 'all' || current.status === filter.status;
  }

  private visibleIds(filter: AdventureFilter): string[] { return this.data.tasks.filter((task) => this.isVisible(task.id, filter)).map((task) => task.id); }

  private assertProgress(progress: unknown, target: number): asserts progress is number {
    if (typeof progress !== 'number' || !Number.isSafeInteger(progress) || progress < 0 || progress > target) fail('INVALID_PROGRESS', `adventure progress must be an integer from 0 to ${target}`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

export function createAdventurePageService(input: AdventurePageData | AdventurePageServiceOptions = {}): AdventurePageService {
  return new AdventurePageService(input);
}

export function restoreAdventurePageService(data: AdventurePageData, serialized: string, options: Omit<AdventurePageServiceOptions, 'data' | 'initialState' | 'state'> = {}): AdventurePageService {
  return new AdventurePageService({ ...options, data, initialState: serialized });
}
