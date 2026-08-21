import type { BuildingConfig, BuildingPrerequisite, BuildingUpgradeDefinition } from './BuildingConfig.ts';
import { findBuilding, findUpgrade } from './BuildingConfig.ts';

export type BuildingResources = Readonly<Record<string, number>>;

export interface BuildingQueueEntry {
  readonly id: string;
  readonly buildingId: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly cost: BuildingResources;
  readonly durationMs: number;
  readonly startAtMs: number;
  readonly finishAtMs: number;
}

export interface BuildingQueueState {
  readonly schemaVersion: 1;
  readonly resources: BuildingResources;
  readonly buildingLevels: Readonly<Record<string, number>>;
  readonly queue: readonly BuildingQueueEntry[];
  readonly nextSequence: number;
  readonly lastUpdatedAtMs: number;
}

export type BuildingQueueCode =
  | 'ENQUEUED'
  | 'SETTLED'
  | 'BOOST_APPLIED'
  | 'INVALID_STATE'
  | 'INVALID_TIME'
  | 'TIME_REWIND'
  | 'UNKNOWN_BUILDING'
  | 'BUILDING_BUSY'
  | 'QUEUE_FULL'
  | 'MAX_LEVEL'
  | 'PREREQUISITE_MISSING'
  | 'INSUFFICIENT_RESOURCES'
  | 'INVALID_BOOST'
  | 'ENTRY_NOT_FOUND';

export interface BuildingQueueResult {
  readonly accepted: boolean;
  readonly code: BuildingQueueCode;
  readonly state: BuildingQueueState;
  readonly completedEntryIds: readonly string[];
  readonly entry?: BuildingQueueEntry;
  readonly appliedMs?: number;
  readonly message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function cloneResources(resources: BuildingResources): Record<string, number> {
  return { ...resources };
}

function cloneEntry(entry: BuildingQueueEntry): BuildingQueueEntry {
  return { ...entry, cost: cloneResources(entry.cost) };
}

function cloneState(state: BuildingQueueState): BuildingQueueState {
  return {
    schemaVersion: 1,
    resources: cloneResources(state.resources),
    buildingLevels: { ...state.buildingLevels },
    queue: state.queue.map(cloneEntry),
    nextSequence: state.nextSequence,
    lastUpdatedAtMs: state.lastUpdatedAtMs,
  };
}

function validResourceMap(resources: unknown, config: BuildingConfig): resources is BuildingResources {
  if (!isRecord(resources)) return false;
  const expected = config.resources.map((resource) => resource.id);
  const keys = Object.keys(resources);
  return keys.length === expected.length
    && expected.every((resourceId) => Object.prototype.hasOwnProperty.call(resources, resourceId))
    && keys.every((resourceId) => isSafeInteger(resources[resourceId]));
}

function validCostMap(cost: unknown, config: BuildingConfig): cost is BuildingResources {
  if (!isRecord(cost) || Object.keys(cost).length === 0) return false;
  const resourceIds = new Set(config.resources.map((resource) => resource.id));
  return Object.entries(cost).every(([resourceId, amount]) => resourceIds.has(resourceId) && isSafeInteger(amount, 1));
}

function stateError(state: BuildingQueueState): BuildingQueueResult {
  return { accepted: false, code: 'INVALID_STATE', state: cloneState(state), completedEntryIds: [], message: '建筑队列状态无效' };
}

function timeError(state: BuildingQueueState, code: 'INVALID_TIME' | 'TIME_REWIND', message: string): BuildingQueueResult {
  return { accepted: false, code, state: cloneState(state), completedEntryIds: [], message };
}

function reject(settled: BuildingQueueResult, code: BuildingQueueCode, message: string): BuildingQueueResult {
  return { accepted: false, code, state: settled.state, completedEntryIds: settled.completedEntryIds, message };
}

function prerequisiteMet(levels: Readonly<Record<string, number>>, prerequisite: BuildingPrerequisite): boolean {
  return (levels[prerequisite.buildingId] ?? 0) >= prerequisite.requiredLevel;
}

function allPrerequisitesMet(levels: Readonly<Record<string, number>>, prerequisites: readonly BuildingPrerequisite[]): boolean {
  return prerequisites.every((prerequisite) => prerequisiteMet(levels, prerequisite));
}

function shiftFollowingEntries(queue: BuildingQueueEntry[], fromIndex: number): void {
  for (let index = fromIndex; index < queue.length; index += 1) {
    const previous = queue[index - 1];
    const current = queue[index];
    const startAtMs = Math.max(current.startAtMs, previous.finishAtMs);
    queue[index] = {
      ...current,
      startAtMs,
      finishAtMs: startAtMs + current.durationMs,
    };
  }
}

function settleMutable(state: BuildingQueueState, atMs: number): string[] {
  const mutable = state as { buildingLevels: Record<string, number>; queue: BuildingQueueEntry[]; lastUpdatedAtMs: number };
  const completedEntryIds: string[] = [];
  while (mutable.queue.length > 0 && mutable.queue[0].finishAtMs <= atMs) {
    const completed = mutable.queue.shift() as BuildingQueueEntry;
    mutable.buildingLevels[completed.buildingId] = completed.targetLevel;
    completedEntryIds.push(completed.id);
  }
  mutable.lastUpdatedAtMs = atMs;
  return completedEntryIds;
}

export function assertBuildingQueueState(state: unknown, config: BuildingConfig): asserts state is BuildingQueueState {
  if (!isRecord(state) || state.schemaVersion !== 1) throw new Error('building queue state schemaVersion is invalid');
  if (!validResourceMap(state.resources, config)) throw new Error('building queue state resources are invalid');
  if (!isRecord(state.buildingLevels)) throw new Error('building queue state buildingLevels are invalid');
  const buildingIds = config.buildings.map((building) => building.id);
  if (Object.keys(state.buildingLevels).length !== buildingIds.length || buildingIds.some((id) => !Object.prototype.hasOwnProperty.call(state.buildingLevels, id))) {
    throw new Error('building queue state buildingLevels keys are invalid');
  }
  for (const building of config.buildings) {
    const level = state.buildingLevels[building.id];
    if (!isSafeInteger(level, building.initialLevel) || level > building.maxLevel) throw new Error(`building level is invalid: ${building.id}`);
  }
  if (!Array.isArray(state.queue) || state.queue.length > config.queue.maxEntries) throw new Error('building queue entries are invalid');
  if (!isSafeInteger(state.nextSequence, 1) || !isSafeInteger(state.lastUpdatedAtMs)) throw new Error('building queue clock is invalid');
  const entryIds = new Set<string>();
  const buildingIdsInQueue = new Set<string>();
  state.queue.forEach((entry, index) => {
    if (!isRecord(entry)) throw new Error(`building queue entry ${index} is invalid`);
    const expectedKeys = ['id', 'buildingId', 'fromLevel', 'targetLevel', 'cost', 'durationMs', 'startAtMs', 'finishAtMs'];
    if (Object.keys(entry).length !== expectedKeys.length || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(entry, key))) throw new Error(`building queue entry ${index} shape is invalid`);
    if (typeof entry.id !== 'string' || entry.id.length === 0 || entryIds.has(entry.id)) throw new Error(`building queue entry ${index} id is invalid`);
    const building = findBuilding(config, entry.buildingId as string);
    const upgrade = findUpgrade(config, entry.buildingId as string, entry.targetLevel as number);
    if (!building || !upgrade || buildingIdsInQueue.has(entry.buildingId as string)) throw new Error(`building queue entry ${index} building is invalid`);
    if (entry.fromLevel !== (state.buildingLevels[entry.buildingId as string] as number) && index === 0) throw new Error(`building queue entry ${index} fromLevel is invalid`);
    if (!isSafeInteger(entry.fromLevel, building.initialLevel) || !isSafeInteger(entry.targetLevel, entry.fromLevel + 1) || entry.targetLevel > building.maxLevel) throw new Error(`building queue entry ${index} level is invalid`);
    if (!validCostMap(entry.cost, config) || Object.keys(entry.cost).length !== Object.keys(upgrade.cost).length || Object.keys(entry.cost).some((resourceId) => entry.cost[resourceId] !== upgrade.cost[resourceId])) throw new Error(`building queue entry ${index} cost is invalid`);
    if (!allPrerequisitesMet(state.buildingLevels, upgrade.prerequisites)) throw new Error(`building queue entry ${index} prerequisite is invalid`);
    if (entry.durationMs !== upgrade.durationMs || !isSafeInteger(entry.startAtMs) || !isSafeInteger(entry.finishAtMs) || entry.finishAtMs <= entry.startAtMs) throw new Error(`building queue entry ${index} timing is invalid`);
    if (index > 0 && entry.startAtMs < state.queue[index - 1].finishAtMs) throw new Error(`building queue entry ${index} overlaps previous entry`);
    entryIds.add(entry.id);
    buildingIdsInQueue.add(entry.buildingId as string);
  });
}

export function createInitialBuildingQueueState(
  config: BuildingConfig,
  resources: BuildingResources,
  atMs = 0,
): BuildingQueueState {
  if (!isSafeInteger(atMs)) throw new Error('initial building queue time is invalid');
  if (!validResourceMap(resources, config)) throw new Error('initial building queue resources are invalid');
  const state: BuildingQueueState = {
    schemaVersion: 1,
    resources: cloneResources(resources),
    buildingLevels: Object.fromEntries(config.buildings.map((building) => [building.id, building.initialLevel])),
    queue: [],
    nextSequence: 1,
    lastUpdatedAtMs: atMs,
  };
  assertBuildingQueueState(state, config);
  return state;
}

export function settleBuildingQueue(state: BuildingQueueState, config: BuildingConfig, atMs: number): BuildingQueueResult {
  try { assertBuildingQueueState(state, config); } catch { return stateError(state); }
  if (!isSafeInteger(atMs)) return timeError(state, 'INVALID_TIME', '时间必须是非负安全整数');
  if (atMs < state.lastUpdatedAtMs) return timeError(state, 'TIME_REWIND', '时间不能倒退');
  const next = cloneState(state);
  const completedEntryIds = settleMutable(next, atMs);
  return { accepted: true, code: 'SETTLED', state: next, completedEntryIds };
}

export function enqueueBuildingUpgrade(
  state: BuildingQueueState,
  config: BuildingConfig,
  buildingId: string,
  atMs: number,
): BuildingQueueResult {
  const settled = settleBuildingQueue(state, config, atMs);
  if (!settled.accepted) return settled;
  const next = cloneState(settled.state);
  const building = findBuilding(config, buildingId);
  if (!building) return reject(settled, 'UNKNOWN_BUILDING', `未知建筑: ${buildingId}`);
  if (next.queue.length >= config.queue.maxEntries) return reject(settled, 'QUEUE_FULL', '建筑队列已满');
  if (next.queue.some((entry) => entry.buildingId === buildingId)) return reject(settled, 'BUILDING_BUSY', '同一建筑不能重复排队');
  const fromLevel = next.buildingLevels[buildingId];
  const targetLevel = fromLevel + 1;
  if (targetLevel > building.maxLevel) return reject(settled, 'MAX_LEVEL', '建筑已达到最高等级');
  const upgrade = findUpgrade(config, buildingId, targetLevel) as BuildingUpgradeDefinition | undefined;
  if (!upgrade) return reject(settled, 'INVALID_STATE', '缺少目标等级配置');
  if (!allPrerequisitesMet(next.buildingLevels, upgrade.prerequisites)) return reject(settled, 'PREREQUISITE_MISSING', '建筑前置未满足');
  for (const [resourceId, amount] of Object.entries(upgrade.cost)) {
    if (next.resources[resourceId] < amount) return reject(settled, 'INSUFFICIENT_RESOURCES', `资源不足: ${resourceId}`);
  }
  const previous = next.queue[next.queue.length - 1];
  const startAtMs = Math.max(atMs, previous?.finishAtMs ?? atMs);
  if (!Number.isSafeInteger(startAtMs + upgrade.durationMs)) return reject(settled, 'INVALID_TIME', '队列完成时间超出安全整数范围');
  const entry: BuildingQueueEntry = {
    id: `${buildingId}:L${targetLevel}:Q${next.nextSequence}`,
    buildingId,
    fromLevel,
    targetLevel,
    cost: cloneResources(upgrade.cost),
    durationMs: upgrade.durationMs,
    startAtMs,
    finishAtMs: startAtMs + upgrade.durationMs,
  };
  next.resources = cloneResources(next.resources);
  for (const [resourceId, amount] of Object.entries(upgrade.cost)) next.resources[resourceId] -= amount;
  next.queue = [...next.queue, entry];
  next.nextSequence += 1;
  assertBuildingQueueState(next, config);
  return { accepted: true, code: 'ENQUEUED', state: next, completedEntryIds: settled.completedEntryIds, entry };
}

export function applyBuildingSpeedup(
  state: BuildingQueueState,
  config: BuildingConfig,
  entryId: string,
  amountMs: number,
  atMs: number,
): BuildingQueueResult {
  const settled = settleBuildingQueue(state, config, atMs);
  if (!settled.accepted) return settled;
  if (!isSafeInteger(amountMs, 1)) return reject(settled, 'INVALID_BOOST', '加速时长必须是正安全整数');
  const index = settled.state.queue.findIndex((entry) => entry.id === entryId);
  if (index < 0) return reject(settled, 'ENTRY_NOT_FOUND', '找不到建筑队列项');
  const next = cloneState(settled.state);
  const current = next.queue[index];
  const earliestFinish = Math.max(current.startAtMs, atMs);
  const appliedMs = Math.min(amountMs, Math.max(0, current.finishAtMs - earliestFinish));
  if (appliedMs === 0) return reject(settled, 'INVALID_BOOST', '该队列项已无可加速时长');
  next.queue[index] = { ...current, finishAtMs: current.finishAtMs - appliedMs };
  shiftFollowingEntries(next.queue, index + 1);
  assertBuildingQueueState(next, config);
  return { accepted: true, code: 'BOOST_APPLIED', state: next, completedEntryIds: settled.completedEntryIds, appliedMs };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function serializeBuildingQueueState(state: BuildingQueueState, config: BuildingConfig): string {
  assertBuildingQueueState(state, config);
  return JSON.stringify(canonicalize(state));
}

export function deserializeBuildingQueueState(serialized: string, config: BuildingConfig): BuildingQueueState {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error('building queue state JSON is invalid'); }
  assertBuildingQueueState(value, config);
  return cloneState(value);
}
