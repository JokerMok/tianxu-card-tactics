export const DAILY_REWARDS_SCHEMA_VERSION = 1 as const;

export type DailyTaskCycle = 'DAILY' | 'WEEKLY';
export type DailyTaskEventType = 'LOGIN' | 'BATTLE_WON' | 'LEVEL_CLEARED' | 'DECK_UPDATED' | 'ONLINE_MINUTES';
export type DailyRewardSource = 'TASK' | 'ACTIVE' | 'ONLINE';

export interface DailyTaskTrigger {
  readonly type: DailyTaskEventType;
  readonly sourceTable?: string;
  readonly sourceId?: string;
}

export interface DailyTaskDefinition {
  readonly id: string;
  readonly cycle: DailyTaskCycle;
  readonly title: string;
  readonly target: number;
  readonly trigger: DailyTaskTrigger;
  readonly rewardId: string;
  readonly activePoints: number;
}

export interface DailyRewardDefinition {
  readonly id: string;
  readonly resourceId: string;
  readonly amount: number;
}

export interface DailyThresholdRewardDefinition {
  readonly id: string;
  readonly threshold: number;
  readonly rewardId: string;
}

export interface DailyRewardCatalogConfig {
  readonly schemaVersion: typeof DAILY_REWARDS_SCHEMA_VERSION;
  readonly dailySelectionCount: number;
  readonly makeupWindowDays: number;
  readonly makeupCreditsPerWeek: number;
  readonly tasks: readonly DailyTaskDefinition[];
  readonly rewards: readonly DailyRewardDefinition[];
  readonly activeRewards: readonly DailyThresholdRewardDefinition[];
  readonly onlineRewards: readonly DailyThresholdRewardDefinition[];
}

export interface DailyTaskProgress {
  readonly id: string;
  readonly cycle: DailyTaskCycle;
  readonly target: number;
  readonly progress: number;
  readonly completed: boolean;
  readonly claimed: boolean;
  readonly eventKeys: readonly string[];
}

export interface DailyPeriodState {
  readonly dayKey: string;
  readonly taskIds: readonly string[];
  readonly tasks: Readonly<Record<string, DailyTaskProgress>>;
  readonly activePoints: number;
  readonly activeClaimedRewardIds: readonly string[];
  readonly onlineMinutes: number;
  readonly onlineClaimedRewardIds: readonly string[];
}

export interface DailyRewardOutboxEntry {
  readonly businessKey: string;
  readonly source: DailyRewardSource;
  readonly sourceId: string;
  readonly periodKey: string;
  readonly rewardId: string;
  readonly status: 'PENDING' | 'ACKNOWLEDGED';
}

export interface DailyRewardState {
  readonly schemaVersion: typeof DAILY_REWARDS_SCHEMA_VERSION;
  readonly dayKey: string;
  readonly weekKey: string;
  readonly daily: DailyPeriodState;
  readonly weeklyTasks: Readonly<Record<string, DailyTaskProgress>>;
  readonly makeupCredits: number;
  readonly expiredDays: Readonly<Record<string, DailyPeriodState>>;
  readonly rewardOutbox: Readonly<Record<string, DailyRewardOutboxEntry>>;
}

export interface DailyRewardMetadataAuthority {
  readonly resources: readonly unknown[] | { readonly resources?: readonly unknown[] };
  readonly tables?: Readonly<Record<string, readonly unknown[] | { readonly [key: string]: unknown }>>;
  readonly [tableName: string]: unknown;
}

export type DailyRewardSink = (reward: DailyRewardDefinition, entry: DailyRewardOutboxEntry) => void;

export type DailyRewardErrorCode =
  | 'INVALID_ARGUMENT' | 'INVALID_CONFIG' | 'INVALID_STATE' | 'INVALID_EVENT' | 'INVALID_DAY'
  | 'TIME_REWIND' | 'UNKNOWN_TASK' | 'TASK_NOT_AVAILABLE' | 'UNKNOWN_REWARD'
  | 'UNKNOWN_THRESHOLD' | 'NOT_READY' | 'DUPLICATE' | 'EXPIRED' | 'MAKEUP_UNAVAILABLE'
  | 'REWARD_FAILED' | 'PERSISTENCE_FAILED' | 'UNKNOWN_OUTBOX_ENTRY' | 'REENTRANT';

export class DailyRewardError extends Error {
  readonly code: DailyRewardErrorCode;
  readonly reason: DailyRewardErrorCode;
  readonly cause?: unknown;

  constructor(code: DailyRewardErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'DailyRewardError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }
}

interface MutableTaskProgress {
  id: string;
  cycle: DailyTaskCycle;
  target: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  eventKeys: string[];
}

interface MutablePeriodState {
  dayKey: string;
  taskIds: string[];
  tasks: Record<string, MutableTaskProgress>;
  activePoints: number;
  activeClaimedRewardIds: string[];
  onlineMinutes: number;
  onlineClaimedRewardIds: string[];
}

interface MutableOutboxEntry {
  businessKey: string;
  source: DailyRewardSource;
  sourceId: string;
  periodKey: string;
  rewardId: string;
  status: 'PENDING' | 'ACKNOWLEDGED';
}

interface MutableState {
  schemaVersion: typeof DAILY_REWARDS_SCHEMA_VERSION;
  dayKey: string;
  weekKey: string;
  daily: MutablePeriodState;
  weeklyTasks: Record<string, MutableTaskProgress>;
  makeupCredits: number;
  expiredDays: Record<string, MutablePeriodState>;
  rewardOutbox: Record<string, MutableOutboxEntry>;
}

function fail(code: DailyRewardErrorCode, message: string, cause?: unknown): never {
  throw new DailyRewardError(code, message, cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string, code: DailyRewardErrorCode): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(code, `${label} contains unexpected or missing fields`);
  }
}

function identifier(value: unknown, label: string, code: DailyRewardErrorCode): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) fail(code, `${label} must be a non-empty trimmed string`);
  return value;
}

function safeInteger(value: unknown, label: string, min: number, code: DailyRewardErrorCode): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) fail(code, `${label} must be a safe integer >= ${min}`);
  return value;
}

function assertDayKey(value: unknown, label = 'dayKey'): asserts value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_DAY', `${label} must be YYYY-MM-DD`);
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail('INVALID_DAY', `${label} is not a calendar date`);
}

export function dayKeyFromTimestamp(timestamp: number, timezoneOffsetMinutes = 0): string {
  safeInteger(timestamp, 'timestamp', 0, 'INVALID_ARGUMENT');
  safeInteger(timezoneOffsetMinutes, 'timezoneOffsetMinutes', -840, 'INVALID_ARGUMENT');
  if (timezoneOffsetMinutes > 840) fail('INVALID_ARGUMENT', 'timezoneOffsetMinutes must be between -840 and 840');
  const date = new Date(timestamp + timezoneOffsetMinutes * 60_000);
  return `${date.getUTCFullYear().toString().padStart(4, '0')}-${(date.getUTCMonth() + 1).toString().padStart(2, '0')}-${date.getUTCDate().toString().padStart(2, '0')}`;
}

export function weekKeyFromDayKey(dayKey: string): string {
  assertDayKey(dayKey);
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86_400_000) + 1) / 7);
  return `${date.getUTCFullYear().toString().padStart(4, '0')}-W${week.toString().padStart(2, '0')}`;
}

function dayDistance(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193) >>> 0;
  return hash >>> 0;
}

function sortedUnique(values: readonly string[], label: string): string[] {
  const result = [...values].sort();
  if (result.some((value, index) => index > 0 && result[index - 1] === value)) fail('INVALID_STATE', `${label} contains duplicates`);
  return result;
}

function metadataRows(value: unknown, key: string): readonly Record<string, unknown>[] {
  const rows = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value[key]) ? value[key] : null;
  if (!rows) fail('INVALID_CONFIG', `metadata ${key} must be an array`);
  return rows.map((row, index) => {
    if (!isRecord(row)) fail('INVALID_CONFIG', `metadata ${key}[${index}] must be an object`);
    return row;
  });
}

function metadataIds(value: unknown, key: string): Set<string> {
  return new Set(metadataRows(value, key).map((row, index) => identifier(row.id, `metadata ${key}[${index}].id`, 'INVALID_CONFIG')));
}

function validateConfig(config: unknown): DailyRewardCatalogConfig {
  if (!isPlainRecord(config)) fail('INVALID_CONFIG', 'daily reward config must be a plain object');
  exactKeys(config, ['schemaVersion', 'dailySelectionCount', 'makeupWindowDays', 'makeupCreditsPerWeek', 'tasks', 'rewards', 'activeRewards', 'onlineRewards'], 'daily reward config', 'INVALID_CONFIG');
  if (config.schemaVersion !== DAILY_REWARDS_SCHEMA_VERSION) fail('INVALID_CONFIG', 'unsupported daily reward schemaVersion');
  const dailySelectionCount = safeInteger(config.dailySelectionCount, 'dailySelectionCount', 1, 'INVALID_CONFIG');
  const makeupWindowDays = safeInteger(config.makeupWindowDays, 'makeupWindowDays', 0, 'INVALID_CONFIG');
  const makeupCreditsPerWeek = safeInteger(config.makeupCreditsPerWeek, 'makeupCreditsPerWeek', 0, 'INVALID_CONFIG');
  if (!Array.isArray(config.tasks) || config.tasks.length === 0) fail('INVALID_CONFIG', 'tasks must be a non-empty array');
  if (!Array.isArray(config.rewards) || config.rewards.length === 0) fail('INVALID_CONFIG', 'rewards must be a non-empty array');
  if (!Array.isArray(config.activeRewards) || config.activeRewards.length === 0 || !Array.isArray(config.onlineRewards) || config.onlineRewards.length === 0) fail('INVALID_CONFIG', 'threshold reward tables must be non-empty arrays');
  const taskIds = new Set<string>();
  const tasks = config.tasks.map((candidate, index) => {
    const label = `tasks[${index}]`;
    if (!isPlainRecord(candidate)) fail('INVALID_CONFIG', `${label} must be an object`);
    exactKeys(candidate, ['id', 'cycle', 'title', 'target', 'trigger', 'rewardId', 'activePoints'], label, 'INVALID_CONFIG');
    const id = identifier(candidate.id, `${label}.id`, 'INVALID_CONFIG');
    if (taskIds.has(id)) fail('INVALID_CONFIG', `duplicate task id: ${id}`);
    taskIds.add(id);
    if (candidate.cycle !== 'DAILY' && candidate.cycle !== 'WEEKLY') fail('INVALID_CONFIG', `${label}.cycle is invalid`);
    const title = identifier(candidate.title, `${label}.title`, 'INVALID_CONFIG');
    const target = safeInteger(candidate.target, `${label}.target`, 1, 'INVALID_CONFIG');
    const activePoints = safeInteger(candidate.activePoints, `${label}.activePoints`, 0, 'INVALID_CONFIG');
    if (!isPlainRecord(candidate.trigger)) fail('INVALID_CONFIG', `${label}.trigger must be an object`);
    const trigger = candidate.trigger;
    if (Object.keys(trigger).some((key) => !['type', 'sourceTable', 'sourceId'].includes(key))) fail('INVALID_CONFIG', `${label}.trigger contains invalid fields`);
    if (typeof trigger.type !== 'string' || !['LOGIN', 'BATTLE_WON', 'LEVEL_CLEARED', 'DECK_UPDATED', 'ONLINE_MINUTES'].includes(trigger.type)) fail('INVALID_CONFIG', `${label}.trigger.type is invalid`);
    if ((trigger.sourceTable === undefined) !== (trigger.sourceId === undefined)) fail('INVALID_CONFIG', `${label}.trigger sourceTable/sourceId must be paired`);
    const normalizedTrigger = {
      type: trigger.type as DailyTaskEventType,
      ...(trigger.sourceTable === undefined ? {} : { sourceTable: identifier(trigger.sourceTable, `${label}.trigger.sourceTable`, 'INVALID_CONFIG'), sourceId: identifier(trigger.sourceId, `${label}.trigger.sourceId`, 'INVALID_CONFIG') }),
    };
    return { id, cycle: candidate.cycle as DailyTaskCycle, title, target, trigger: normalizedTrigger, rewardId: identifier(candidate.rewardId, `${label}.rewardId`, 'INVALID_CONFIG'), activePoints };
  });
  if (tasks.filter((task) => task.cycle === 'DAILY').length < dailySelectionCount) fail('INVALID_CONFIG', 'dailySelectionCount exceeds daily task pool');
  const rewardIds = new Set<string>();
  const rewards = config.rewards.map((candidate, index) => {
    const label = `rewards[${index}]`;
    if (!isPlainRecord(candidate)) fail('INVALID_CONFIG', `${label} must be an object`);
    exactKeys(candidate, ['id', 'resourceId', 'amount'], label, 'INVALID_CONFIG');
    const id = identifier(candidate.id, `${label}.id`, 'INVALID_CONFIG');
    if (rewardIds.has(id)) fail('INVALID_CONFIG', `duplicate reward id: ${id}`);
    rewardIds.add(id);
    return { id, resourceId: identifier(candidate.resourceId, `${label}.resourceId`, 'INVALID_CONFIG'), amount: safeInteger(candidate.amount, `${label}.amount`, 1, 'INVALID_CONFIG') };
  });
  const thresholdTable = (value: unknown[], tableName: string): DailyThresholdRewardDefinition[] => {
    const ids = new Set<string>();
    let lastThreshold = 0;
    return value.map((candidate, index) => {
      const label = `${tableName}[${index}]`;
      if (!isPlainRecord(candidate)) fail('INVALID_CONFIG', `${label} must be an object`);
      exactKeys(candidate, ['id', 'threshold', 'rewardId'], label, 'INVALID_CONFIG');
      const id = identifier(candidate.id, `${label}.id`, 'INVALID_CONFIG');
      if (ids.has(id)) fail('INVALID_CONFIG', `duplicate ${tableName} id: ${id}`);
      ids.add(id);
      const threshold = safeInteger(candidate.threshold, `${label}.threshold`, 1, 'INVALID_CONFIG');
      if (threshold <= lastThreshold) fail('INVALID_CONFIG', `${tableName} thresholds must be strictly increasing`);
      lastThreshold = threshold;
      return { id, threshold, rewardId: identifier(candidate.rewardId, `${label}.rewardId`, 'INVALID_CONFIG') };
    });
  };
  const activeRewards = thresholdTable(config.activeRewards, 'activeRewards');
  const onlineRewards = thresholdTable(config.onlineRewards, 'onlineRewards');
  const allRewardRefs = [...tasks.map((task) => task.rewardId), ...activeRewards.map((reward) => reward.rewardId), ...onlineRewards.map((reward) => reward.rewardId)];
  if (allRewardRefs.some((id) => !rewardIds.has(id))) fail('INVALID_CONFIG', 'a task or threshold references an unknown reward');
  return freeze({ schemaVersion: DAILY_REWARDS_SCHEMA_VERSION, dailySelectionCount, makeupWindowDays, makeupCreditsPerWeek, tasks: freeze(tasks), rewards: freeze(rewards), activeRewards: freeze(activeRewards), onlineRewards: freeze(onlineRewards) });
}

export class DailyRewardCatalog {
  readonly config: DailyRewardCatalogConfig;
  private readonly tasksById: ReadonlyMap<string, DailyTaskDefinition>;
  private readonly rewardsById: ReadonlyMap<string, DailyRewardDefinition>;

  constructor(config: DailyRewardCatalogConfig) {
    this.config = validateConfig(config);
    this.tasksById = new Map(this.config.tasks.map((task) => [task.id, task]));
    this.rewardsById = new Map(this.config.rewards.map((reward) => [reward.id, reward]));
  }

  task(id: string): DailyTaskDefinition {
    const task = this.tasksById.get(id);
    if (!task) fail('UNKNOWN_TASK', `unknown daily task: ${id}`);
    return task;
  }

  reward(id: string): DailyRewardDefinition {
    const reward = this.rewardsById.get(id);
    if (!reward) fail('UNKNOWN_REWARD', `unknown daily reward: ${id}`);
    return reward;
  }

  dailyTaskIds(dayKey: string): readonly string[] {
    assertDayKey(dayKey);
    return Object.freeze(this.config.tasks.filter((task) => task.cycle === 'DAILY')
      .map((task) => task.id)
      .sort((left, right) => fnv1a(`${dayKey}:${left}`) - fnv1a(`${dayKey}:${right}`) || left.localeCompare(right))
      .slice(0, this.config.dailySelectionCount)
      .sort());
  }

  weeklyTaskIds(): readonly string[] {
    return Object.freeze(this.config.tasks.filter((task) => task.cycle === 'WEEKLY').map((task) => task.id).sort());
  }

  createState(dayKey: string): DailyRewardState {
    assertDayKey(dayKey);
    const daily = createPeriod(this, dayKey, this.dailyTaskIds(dayKey));
    const weeklyTasks: Record<string, MutableTaskProgress> = {};
    for (const taskId of this.weeklyTaskIds()) weeklyTasks[taskId] = taskProgress(this.task(taskId));
    return freeze({ schemaVersion: DAILY_REWARDS_SCHEMA_VERSION, dayKey, weekKey: weekKeyFromDayKey(dayKey), daily, weeklyTasks, makeupCredits: this.config.makeupCreditsPerWeek, expiredDays: {}, rewardOutbox: {} });
  }
}

function taskProgress(task: DailyTaskDefinition): MutableTaskProgress {
  return { id: task.id, cycle: task.cycle, target: task.target, progress: 0, completed: false, claimed: false, eventKeys: [] };
}

function createPeriod(catalog: DailyRewardCatalog, dayKey: string, taskIds: readonly string[]): MutablePeriodState {
  const tasks: Record<string, MutableTaskProgress> = {};
  for (const taskId of taskIds) tasks[taskId] = taskProgress(catalog.task(taskId));
  return { dayKey, taskIds: [...taskIds], tasks, activePoints: 0, activeClaimedRewardIds: [], onlineMinutes: 0, onlineClaimedRewardIds: [] };
}

function freezeState(state: MutableState): DailyRewardState {
  for (const period of [state.daily, ...Object.values(state.expiredDays)]) {
    period.taskIds.sort();
    period.activeClaimedRewardIds.sort();
    period.onlineClaimedRewardIds.sort();
    for (const task of Object.values(period.tasks)) task.eventKeys.sort();
  }
  for (const task of Object.values(state.weeklyTasks)) task.eventKeys.sort();
  return freeze(state as unknown as DailyRewardState);
}

function mutableState(state: DailyRewardState): MutableState {
  return clone(state) as unknown as MutableState;
}

function assertTaskState(task: unknown, definition: DailyTaskDefinition, label: string): asserts task is DailyTaskProgress {
  if (!isPlainRecord(task)) fail('INVALID_STATE', `${label} must be an object`);
  exactKeys(task, ['id', 'cycle', 'target', 'progress', 'completed', 'claimed', 'eventKeys'], label, 'INVALID_STATE');
  if (task.id !== definition.id || task.cycle !== definition.cycle || task.target !== definition.target) fail('INVALID_STATE', `${label} does not match configured task`);
  safeInteger(task.progress, `${label}.progress`, 0, 'INVALID_STATE');
  if ((task.progress as number) > definition.target || task.completed !== (task.progress === definition.target) || typeof task.claimed !== 'boolean') fail('INVALID_STATE', `${label} has invalid completion state`);
  if (!Array.isArray(task.eventKeys) || task.eventKeys.some((key) => typeof key !== 'string' || key.length === 0)) fail('INVALID_STATE', `${label}.eventKeys is invalid`);
  sortedUnique(task.eventKeys as string[], `${label}.eventKeys`);
}

function assertPeriodState(catalog: DailyRewardCatalog, period: unknown, expectedTaskIds: readonly string[], label: string): asserts period is DailyPeriodState {
  if (!isPlainRecord(period)) fail('INVALID_STATE', `${label} must be an object`);
  exactKeys(period, ['dayKey', 'taskIds', 'tasks', 'activePoints', 'activeClaimedRewardIds', 'onlineMinutes', 'onlineClaimedRewardIds'], label, 'INVALID_STATE');
  assertDayKey(period.dayKey as string, `${label}.dayKey`);
  if (!Array.isArray(period.taskIds) || JSON.stringify([...period.taskIds].sort()) !== JSON.stringify([...expectedTaskIds].sort())) fail('INVALID_STATE', `${label}.taskIds do not match deterministic selection`);
  if (!isPlainRecord(period.tasks) || Object.keys(period.tasks).length !== expectedTaskIds.length) fail('INVALID_STATE', `${label}.tasks are incomplete`);
  for (const taskId of expectedTaskIds) {
    const task = catalog.task(taskId);
    assertTaskState(period.tasks[taskId], task, `${label}.tasks.${taskId}`);
  }
  safeInteger(period.activePoints, `${label}.activePoints`, 0, 'INVALID_STATE');
  safeInteger(period.onlineMinutes, `${label}.onlineMinutes`, 0, 'INVALID_STATE');
  for (const key of ['activeClaimedRewardIds', 'onlineClaimedRewardIds'] as const) {
    if (!Array.isArray(period[key]) || period[key].some((id) => typeof id !== 'string')) fail('INVALID_STATE', `${label}.${key} is invalid`);
    sortedUnique(period[key], `${label}.${key}`);
    const configuredIds = new Set((key === 'activeClaimedRewardIds' ? catalog.config.activeRewards : catalog.config.onlineRewards).map((reward) => reward.id));
    if (period[key].some((id) => !configuredIds.has(id))) fail('INVALID_STATE', `${label}.${key} references an unknown threshold reward`);
  }
}

function assertState(catalog: DailyRewardCatalog, value: unknown): asserts value is DailyRewardState {
  if (!isPlainRecord(value)) fail('INVALID_STATE', 'daily reward state must be a plain object');
  exactKeys(value, ['schemaVersion', 'dayKey', 'weekKey', 'daily', 'weeklyTasks', 'makeupCredits', 'expiredDays', 'rewardOutbox'], 'daily reward state', 'INVALID_STATE');
  if (value.schemaVersion !== DAILY_REWARDS_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported daily reward state schemaVersion');
  assertDayKey(value.dayKey as string);
  if (value.weekKey !== weekKeyFromDayKey(value.dayKey as string)) fail('INVALID_STATE', 'state weekKey does not match dayKey');
  assertPeriodState(catalog, value.daily, catalog.dailyTaskIds(value.dayKey as string), 'daily');
  if (!isPlainRecord(value.weeklyTasks) || Object.keys(value.weeklyTasks).length !== catalog.weeklyTaskIds().length) fail('INVALID_STATE', 'weeklyTasks are incomplete');
  for (const taskId of catalog.weeklyTaskIds()) assertTaskState(value.weeklyTasks[taskId], catalog.task(taskId), `weeklyTasks.${taskId}`);
  safeInteger(value.makeupCredits, 'makeupCredits', 0, 'INVALID_STATE');
  if ((value.makeupCredits as number) > catalog.config.makeupCreditsPerWeek) fail('INVALID_STATE', 'makeupCredits exceeds the configured weekly allowance');
  if (!isPlainRecord(value.expiredDays)) fail('INVALID_STATE', 'expiredDays must be an object');
  for (const [dayKey, period] of Object.entries(value.expiredDays)) {
    assertDayKey(dayKey, `expiredDays.${dayKey}`);
    if (dayKey >= value.dayKey) fail('INVALID_STATE', 'expiredDays must be before current day');
    assertPeriodState(catalog, period, catalog.dailyTaskIds(dayKey), `expiredDays.${dayKey}`);
  }
  if (!isPlainRecord(value.rewardOutbox)) fail('INVALID_STATE', 'rewardOutbox must be an object');
  for (const [key, entry] of Object.entries(value.rewardOutbox)) {
    if (!isPlainRecord(entry)) fail('INVALID_STATE', `rewardOutbox.${key} must be an object`);
    exactKeys(entry, ['businessKey', 'source', 'sourceId', 'periodKey', 'rewardId', 'status'], `rewardOutbox.${key}`, 'INVALID_STATE');
    if (entry.businessKey !== key || !['TASK', 'ACTIVE', 'ONLINE'].includes(entry.source as string) || !['PENDING', 'ACKNOWLEDGED'].includes(entry.status as string)) fail('INVALID_STATE', `rewardOutbox.${key} is invalid`);
    identifier(entry.sourceId, `rewardOutbox.${key}.sourceId`, 'INVALID_STATE');
    assertDayKey(entry.periodKey, `rewardOutbox.${key}.periodKey`);
    catalog.reward(entry.rewardId as string);
  }
}

function canonicalState(state: DailyRewardState): DailyRewardState {
  const next = mutableState(state);
  next.daily = { ...next.daily, taskIds: [...next.daily.taskIds].sort(), tasks: Object.fromEntries(Object.entries(next.daily.tasks).sort()), activeClaimedRewardIds: [...next.daily.activeClaimedRewardIds].sort(), onlineClaimedRewardIds: [...next.daily.onlineClaimedRewardIds].sort() };
  next.weeklyTasks = Object.fromEntries(Object.entries(next.weeklyTasks).sort());
  next.expiredDays = Object.fromEntries(Object.entries(next.expiredDays).sort().map(([key, period]) => [key, { ...period, taskIds: [...period.taskIds].sort(), tasks: Object.fromEntries(Object.entries(period.tasks).sort()), activeClaimedRewardIds: [...period.activeClaimedRewardIds].sort(), onlineClaimedRewardIds: [...period.onlineClaimedRewardIds].sort() }]));
  next.rewardOutbox = Object.fromEntries(Object.entries(next.rewardOutbox).sort());
  return freezeState(next);
}

export function serializeDailyRewardState(state: DailyRewardState): string {
  return JSON.stringify(canonicalState(state));
}

export function restoreDailyRewardState(catalog: DailyRewardCatalog, value: string | DailyRewardState): DailyRewardState {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch (error) { fail('INVALID_STATE', 'daily reward state JSON is invalid', error); }
  }
  assertState(catalog, parsed);
  return canonicalState(parsed);
}

function matchTrigger(task: DailyTaskDefinition, event: DailyRewardEvent): boolean {
  if (task.trigger.type !== event.type) return false;
  if (task.trigger.sourceId !== undefined && (task.trigger.sourceTable !== event.sourceTable || task.trigger.sourceId !== event.sourceId)) return false;
  return true;
}

export interface DailyRewardEvent {
  readonly type: DailyTaskEventType;
  readonly amount?: number;
  readonly key?: string;
  readonly sourceTable?: string;
  readonly sourceId?: string;
}

export type DailyProgressCode = 'APPLIED' | 'DUPLICATE_EVENT' | 'NOOP';
export interface DailyProgressResult { readonly applied: boolean; readonly code: DailyProgressCode; readonly state: DailyRewardState; }
export type DailyClaimCode = 'APPLIED' | 'DUPLICATE' | 'NOT_READY' | 'TASK_NOT_AVAILABLE' | 'EXPIRED' | 'MAKEUP_UNAVAILABLE';
export interface DailyClaimResult { readonly applied: boolean; readonly code: DailyClaimCode; readonly source: DailyRewardSource; readonly sourceId: string; readonly businessKey: string; readonly state: DailyRewardState; }
export interface DailyRewardFlushResult { readonly code: 'DELIVERED' | 'FAILED'; readonly businessKey: string; readonly state: DailyRewardState; }

export interface DailyRewardServiceOptions {
  readonly initialState?: DailyRewardState | string;
  readonly dayKey?: string;
  readonly persist?: (serialized: string) => void;
}

function asOptions(value: unknown): DailyRewardServiceOptions {
  if (value === undefined) return {};
  if (!isPlainRecord(value)) fail('INVALID_ARGUMENT', 'daily reward service options must be an object');
  return value as DailyRewardServiceOptions;
}

export class DailyRewardService {
  private current: DailyRewardState;
  private readonly catalog: DailyRewardCatalog;
  private readonly persist?: (serialized: string) => void;
  private inTransition = false;

  constructor(catalog: DailyRewardCatalog | DailyRewardCatalogConfig, options?: DailyRewardServiceOptions) {
    this.catalog = catalog instanceof DailyRewardCatalog ? catalog : new DailyRewardCatalog(catalog);
    const normalized = asOptions(options);
    this.persist = normalized.persist;
    if (normalized.initialState !== undefined) {
      this.current = restoreDailyRewardState(this.catalog, normalized.initialState);
      if (normalized.dayKey !== undefined && normalized.dayKey !== this.current.dayKey) fail('INVALID_ARGUMENT', 'dayKey cannot differ from initialState.dayKey');
    } else {
      const dayKey = normalized.dayKey ?? '1970-01-01';
      assertDayKey(dayKey);
      this.current = this.catalog.createState(dayKey);
    }
  }

  snapshot(): DailyRewardState { return this.current; }
  serialize(): string { return serializeDailyRewardState(this.current); }
  task(id: string, dayKey = this.current.dayKey): DailyTaskProgress {
    const period = dayKey === this.current.dayKey ? this.current.daily : this.current.expiredDays[dayKey];
    if (!period) fail('EXPIRED', `daily task period is unavailable: ${dayKey}`);
    const task = period.tasks[id];
    if (!task) fail('TASK_NOT_AVAILABLE', `task ${id} is not selected for ${dayKey}`);
    return task;
  }

  refresh(dayKey: string): DailyRewardState {
    assertDayKey(dayKey);
    if (dayKey === this.current.dayKey) return this.current;
    if (dayKey < this.current.dayKey) fail('TIME_REWIND', 'daily reward clock cannot move backwards');
    const next = mutableState(this.current);
    let cursor = next.dayKey;
    while (cursor < dayKey) {
      next.expiredDays[cursor] = clone(next.daily);
      const nextDay = new Date(`${cursor}T00:00:00.000Z`);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      cursor = dayKeyFromTimestamp(nextDay.getTime());
      next.daily = createPeriod(this.catalog, cursor, this.catalog.dailyTaskIds(cursor));
      const nextWeek = weekKeyFromDayKey(cursor);
      if (nextWeek !== next.weekKey) {
        next.weekKey = nextWeek;
        next.makeupCredits = this.catalog.config.makeupCreditsPerWeek;
        next.weeklyTasks = Object.fromEntries(this.catalog.weeklyTaskIds().map((id) => [id, taskProgress(this.catalog.task(id))]));
      }
    }
    next.dayKey = dayKey;
    for (const oldDay of Object.keys(next.expiredDays)) if (dayDistance(oldDay, dayKey) > this.catalog.config.makeupWindowDays) delete next.expiredDays[oldDay];
    return this.commit(next);
  }

  record(event: DailyRewardEvent, dayKey = this.current.dayKey): DailyProgressResult {
    if (!isPlainRecord(event)) fail('INVALID_EVENT', 'daily reward event must be an object');
    if (!['LOGIN', 'BATTLE_WON', 'LEVEL_CLEARED', 'DECK_UPDATED', 'ONLINE_MINUTES'].includes(event.type)) fail('INVALID_EVENT', 'unsupported daily reward event type');
    if (event.key !== undefined) identifier(event.key, 'event.key', 'INVALID_EVENT');
    const amount = event.amount === undefined ? 1 : safeInteger(event.amount, 'event.amount', 1, 'INVALID_EVENT');
    if (event.sourceTable !== undefined) identifier(event.sourceTable, 'event.sourceTable', 'INVALID_EVENT');
    if (event.sourceId !== undefined) identifier(event.sourceId, 'event.sourceId', 'INVALID_EVENT');
    if ((event.sourceTable === undefined) !== (event.sourceId === undefined)) fail('INVALID_EVENT', 'event sourceTable/sourceId must be paired');
    if (dayKey !== this.current.dayKey) {
      this.refresh(dayKey);
      if (dayKey !== this.current.dayKey) fail('INVALID_EVENT', 'event day cannot be in the past');
    }
    const next = mutableState(this.current);
    let changed = false;
    let duplicate = false;
    const applyTo = (progress: MutableTaskProgress, task: DailyTaskDefinition): void => {
      if (!matchTrigger(task, event)) return;
      const eventKey = event.key;
      if (eventKey !== undefined) {
        if (progress.eventKeys.includes(eventKey)) { duplicate = true; return; }
        progress.eventKeys.push(eventKey);
      }
      const before = progress.progress;
      progress.progress = Math.min(progress.target, progress.progress + amount);
      progress.completed = progress.progress >= progress.target;
      changed = true;
      if (!progress.completed || before >= progress.target) return;
      if (task.cycle === 'DAILY') next.daily.activePoints += task.activePoints;
      else next.daily.activePoints += task.activePoints;
    };
    for (const taskId of next.daily.taskIds) applyTo(next.daily.tasks[taskId], this.catalog.task(taskId));
    for (const taskId of this.catalog.weeklyTaskIds()) applyTo(next.weeklyTasks[taskId], this.catalog.task(taskId));
    if (event.type === 'ONLINE_MINUTES') {
      if (next.daily.onlineMinutes > Number.MAX_SAFE_INTEGER - amount) fail('INVALID_EVENT', 'online minutes would overflow');
      next.daily.onlineMinutes += amount;
      changed = true;
    }
    if (!changed) return { applied: false, code: duplicate ? 'DUPLICATE_EVENT' : 'NOOP', state: this.current };
    return { applied: true, code: 'APPLIED', state: this.commit(next) };
  }

  private commit(next: MutableState): DailyRewardState {
    const normalized = canonicalState(freezeState(next));
    try { this.persist?.(serializeDailyRewardState(normalized)); }
    catch (error) { fail('PERSISTENCE_FAILED', 'daily reward persistence failed', error); }
    this.current = normalized;
    return this.current;
  }

  private claim(source: DailyRewardSource, sourceId: string, periodKey: string, sink?: DailyRewardSink): DailyClaimResult {
    if (this.inTransition) fail('REENTRANT', 'daily reward transition is reentrant');
    const next = mutableState(this.current);
    const period = source === 'TASK' && periodKey !== next.dayKey ? next.expiredDays[periodKey] : next.daily;
    if (!period) return { applied: false, code: 'EXPIRED', source, sourceId, businessKey: `${source.toLowerCase()}:${periodKey}:${sourceId}`, state: this.current };
    const businessKey = `${source.toLowerCase()}:${periodKey}:${sourceId}`;
    const existing = next.rewardOutbox[businessKey];
    if (existing) return { applied: false, code: 'DUPLICATE', source, sourceId, businessKey, state: this.current };
    const rewardId = source === 'TASK' ? this.catalog.task(sourceId).rewardId
      : source === 'ACTIVE' ? this.catalog.config.activeRewards.find((entry) => entry.id === sourceId)?.rewardId
        : this.catalog.config.onlineRewards.find((entry) => entry.id === sourceId)?.rewardId;
    if (!rewardId) fail(source === 'TASK' ? 'UNKNOWN_TASK' : 'UNKNOWN_THRESHOLD', `unknown ${source.toLowerCase()} reward source: ${sourceId}`);
    const task = source === 'TASK' ? period.tasks[sourceId] : undefined;
    if (source === 'TASK') {
      if (!task) return { applied: false, code: 'TASK_NOT_AVAILABLE', source, sourceId, businessKey, state: this.current };
      if (task.claimed) return { applied: false, code: 'DUPLICATE', source, sourceId, businessKey, state: this.current };
      if (!task.completed) return { applied: false, code: 'NOT_READY', source, sourceId, businessKey, state: this.current };
      if (periodKey !== next.dayKey) {
        if (next.makeupCredits <= 0) return { applied: false, code: 'MAKEUP_UNAVAILABLE', source, sourceId, businessKey, state: this.current };
        next.makeupCredits -= 1;
      }
      task.claimed = true;
    } else {
      const table = source === 'ACTIVE' ? this.catalog.config.activeRewards : this.catalog.config.onlineRewards;
      const threshold = table.find((entry) => entry.id === sourceId);
      if (!threshold) fail('UNKNOWN_THRESHOLD', `unknown ${source.toLowerCase()} reward source: ${sourceId}`);
      const claimedIds = source === 'ACTIVE' ? period.activeClaimedRewardIds : period.onlineClaimedRewardIds;
      const currentValue = source === 'ACTIVE' ? period.activePoints : period.onlineMinutes;
      if (claimedIds.includes(sourceId)) return { applied: false, code: 'DUPLICATE', source, sourceId, businessKey, state: this.current };
      if (currentValue < threshold.threshold) return { applied: false, code: 'NOT_READY', source, sourceId, businessKey, state: this.current };
      claimedIds.push(sourceId);
    }
    next.rewardOutbox[businessKey] = { businessKey, source, sourceId, periodKey, rewardId, status: 'PENDING' };
    this.inTransition = true;
    try {
      const state = this.commit(next);
      if (sink) {
        try { sink(this.catalog.reward(rewardId), state.rewardOutbox[businessKey]); }
        catch (error) { fail('REWARD_FAILED', 'daily reward delivery failed', error); }
      }
      return { applied: true, code: 'APPLIED', source, sourceId, businessKey, state: this.current };
    } finally { this.inTransition = false; }
  }

  claimTask(taskId: string, optionsOrSink?: { readonly dayKey?: string; readonly makeup?: boolean } | DailyRewardSink, sink?: DailyRewardSink): DailyClaimResult {
    const options = typeof optionsOrSink === 'function' ? {} : optionsOrSink ?? {};
    const delivery = typeof optionsOrSink === 'function' ? optionsOrSink : sink;
    const periodKey = options.dayKey ?? this.current.dayKey;
    assertDayKey(periodKey);
    if (periodKey !== this.current.dayKey) {
      if (!options.makeup) return { applied: false, code: 'EXPIRED', source: 'TASK', sourceId: taskId, businessKey: `task:${periodKey}:${taskId}`, state: this.current };
      if (dayDistance(periodKey, this.current.dayKey) > this.catalog.config.makeupWindowDays) return { applied: false, code: 'EXPIRED', source: 'TASK', sourceId: taskId, businessKey: `task:${periodKey}:${taskId}`, state: this.current };
    }
    return this.claim('TASK', taskId, periodKey, delivery);
  }

  claimActivityReward(rewardId: string, sink?: DailyRewardSink): DailyClaimResult {
    return this.claim('ACTIVE', rewardId, this.current.dayKey, sink);
  }

  claimOnlineReward(rewardId: string, sink?: DailyRewardSink): DailyClaimResult {
    return this.claim('ONLINE', rewardId, this.current.dayKey, sink);
  }

  acknowledgeReward(businessKey: string): { readonly applied: boolean; readonly code: 'APPLIED' | 'DUPLICATE'; readonly state: DailyRewardState } {
    identifier(businessKey, 'businessKey', 'INVALID_ARGUMENT');
    const entry = this.current.rewardOutbox[businessKey];
    if (!entry) fail('UNKNOWN_OUTBOX_ENTRY', `unknown daily reward outbox entry: ${businessKey}`);
    if (entry.status === 'ACKNOWLEDGED') return { applied: false, code: 'DUPLICATE', state: this.current };
    const next = mutableState(this.current);
    next.rewardOutbox[businessKey].status = 'ACKNOWLEDGED';
    return { applied: true, code: 'APPLIED', state: this.commit(next) };
  }

  flushRewards(sink: DailyRewardSink): readonly DailyRewardFlushResult[] {
    if (typeof sink !== 'function') fail('INVALID_ARGUMENT', 'reward sink must be a function');
    const results: DailyRewardFlushResult[] = [];
    for (const entry of Object.values(this.current.rewardOutbox).sort((left, right) => left.businessKey.localeCompare(right.businessKey))) {
      if (entry.status === 'ACKNOWLEDGED') continue;
      try { sink(this.catalog.reward(entry.rewardId), entry); results.push({ code: 'DELIVERED', businessKey: entry.businessKey, state: this.current }); }
      catch { results.push({ code: 'FAILED', businessKey: entry.businessKey, state: this.current }); }
    }
    return Object.freeze(results);
  }
}

export function createDailyRewardCatalog(config: DailyRewardCatalogConfig): DailyRewardCatalog { return new DailyRewardCatalog(config); }
export function createDailyRewardState(catalog: DailyRewardCatalog, dayKey: string): DailyRewardState { return catalog.createState(dayKey); }
export function createDailyRewardService(catalog: DailyRewardCatalog | DailyRewardCatalogConfig, options?: DailyRewardServiceOptions): DailyRewardService {
  return new DailyRewardService(catalog, options);
}
