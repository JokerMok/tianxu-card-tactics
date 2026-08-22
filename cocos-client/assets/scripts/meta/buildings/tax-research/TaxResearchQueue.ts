import type { ResearchPrerequisite, ResearchUpgradeDefinition, TaxResearchConfig } from './TaxResearchConfig.ts';
import { findResearch, findResearchUpgrade, findTaxTier } from './TaxResearchConfig.ts';

export type TaxResearchResources = Readonly<Record<string, number>>;

export interface TaxResearchQueueEntry {
  readonly id: string;
  readonly researchId: string;
  readonly fromLevel: number;
  readonly targetLevel: number;
  readonly cost: TaxResearchResources;
  readonly durationMs: number;
  readonly startAtMs: number;
  readonly finishAtMs: number;
}

export interface TaxResearchState {
  readonly schemaVersion: 1;
  readonly resources: TaxResearchResources;
  readonly buildingLevels: Readonly<Record<string, number>>;
  readonly researchLevels: Readonly<Record<string, number>>;
  readonly queue: readonly TaxResearchQueueEntry[];
  readonly nextSequence: number;
  readonly lastUpdatedAtMs: number;
  readonly lastTaxClaimDay: number | null;
}

export type TaxResearchCode =
  | 'TAX_CLAIMED'
  | 'RESEARCH_ENQUEUED'
  | 'SETTLED'
  | 'INVALID_STATE'
  | 'INVALID_TIME'
  | 'TIME_REWIND'
  | 'INVALID_DAY'
  | 'DAY_REWIND'
  | 'TAX_ALREADY_CLAIMED'
  | 'UNKNOWN_RESEARCH'
  | 'RESEARCH_BUSY'
  | 'RESEARCH_QUEUE_FULL'
  | 'MAX_LEVEL'
  | 'PREREQUISITE_MISSING'
  | 'INSUFFICIENT_RESOURCES'
  | 'ENTRY_NOT_FOUND';

export interface TaxResearchResult {
  readonly accepted: boolean;
  readonly code: TaxResearchCode;
  readonly state: TaxResearchState | null;
  readonly completedEntryIds: readonly string[];
  readonly entry?: TaxResearchQueueEntry;
  readonly tax?: TaxResearchResources;
  readonly effects?: Readonly<Record<string, number>>;
  readonly message?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSafeInteger(value: unknown, minimum = 0): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum;
}

function cloneResources(resources: TaxResearchResources): Record<string, number> {
  return { ...resources };
}

function cloneEntry(entry: TaxResearchQueueEntry): TaxResearchQueueEntry {
  return { ...entry, cost: cloneResources(entry.cost) };
}

function cloneState(state: TaxResearchState): TaxResearchState {
  return {
    schemaVersion: 1,
    resources: cloneResources(state.resources),
    buildingLevels: { ...state.buildingLevels },
    researchLevels: { ...state.researchLevels },
    queue: state.queue.map(cloneEntry),
    nextSequence: state.nextSequence,
    lastUpdatedAtMs: state.lastUpdatedAtMs,
    lastTaxClaimDay: state.lastTaxClaimDay,
  };
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  if (Object.keys(value).length !== expected.length || expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error(`${label} shape is invalid`);
  }
}

function entrySequence(entry: Record<string, unknown>, researchId: string, targetLevel: number, index: number): number {
  const prefix = `${researchId}:L${targetLevel}:Q`;
  if (typeof entry.id !== 'string' || !entry.id.startsWith(prefix)) {
    throw new Error(`tax research queue entry ${index} id is invalid`);
  }
  const sequenceText = entry.id.slice(prefix.length);
  if (!/^[1-9]\d*$/.test(sequenceText)) throw new Error(`tax research queue entry ${index} id is invalid`);
  const sequence = Number(sequenceText);
  if (!Number.isSafeInteger(sequence) || String(sequence) !== sequenceText) {
    throw new Error(`tax research queue entry ${index} id is invalid`);
  }
  return sequence;
}

function validResourceMap(resources: unknown, config: TaxResearchConfig): resources is TaxResearchResources {
  if (!isRecord(resources)) return false;
  const expected = config.buildingConfig.resources.map((resource) => resource.id);
  const keys = Object.keys(resources);
  return keys.length === expected.length
    && expected.every((resourceId) => Object.prototype.hasOwnProperty.call(resources, resourceId))
    && keys.every((resourceId) => isSafeInteger(resources[resourceId]));
}

function validCostMap(cost: unknown, config: TaxResearchConfig): cost is TaxResearchResources {
  if (!isRecord(cost) || Object.keys(cost).length === 0) return false;
  const resourceIds = new Set(config.buildingConfig.resources.map((resource) => resource.id));
  return Object.entries(cost).every(([resourceId, amount]) => resourceIds.has(resourceId) && isSafeInteger(amount, 1));
}

function stateError(): TaxResearchResult {
  return { accepted: false, code: 'INVALID_STATE', state: null, completedEntryIds: [], message: '税收研究状态无效' };
}

function reject(state: TaxResearchState, code: TaxResearchCode, message: string): TaxResearchResult {
  return { accepted: false, code, state: cloneState(state), completedEntryIds: [], message };
}

function timeError(state: TaxResearchState, code: 'INVALID_TIME' | 'TIME_REWIND', message: string): TaxResearchResult {
  return reject(state, code, message);
}

function prerequisiteMet(
  levels: Readonly<Record<string, number>>,
  prerequisite: ResearchPrerequisite,
): boolean {
  const key = prerequisite.type === 'building' ? prerequisite.buildingId : prerequisite.researchId;
  return (levels[key] ?? 0) >= prerequisite.requiredLevel;
}

function allPrerequisitesMet(
  buildingLevels: Readonly<Record<string, number>>,
  researchLevels: Readonly<Record<string, number>>,
  prerequisites: readonly ResearchPrerequisite[],
): boolean {
  return prerequisites.every((prerequisite) => prerequisiteMet(
    prerequisite.type === 'building' ? buildingLevels : researchLevels,
    prerequisite,
  ));
}

function settleMutable(state: TaxResearchState, atMs: number): string[] {
  const mutable = state as { researchLevels: Record<string, number>; queue: TaxResearchQueueEntry[]; lastUpdatedAtMs: number };
  const completedEntryIds: string[] = [];
  while (mutable.queue.length > 0 && mutable.queue[0].finishAtMs <= atMs) {
    const completed = mutable.queue.shift() as TaxResearchQueueEntry;
    mutable.researchLevels[completed.researchId] = completed.targetLevel;
    completedEntryIds.push(completed.id);
  }
  mutable.lastUpdatedAtMs = atMs;
  return completedEntryIds;
}

export function assertTaxResearchState(state: unknown, config: TaxResearchConfig): asserts state is TaxResearchState {
  if (!isRecord(state) || state.schemaVersion !== 1) throw new Error('tax research state schemaVersion is invalid');
  exactKeys(state, ['schemaVersion', 'resources', 'buildingLevels', 'researchLevels', 'queue', 'nextSequence', 'lastUpdatedAtMs', 'lastTaxClaimDay'], 'tax research state');
  if (!validResourceMap(state.resources, config)) throw new Error('tax research state resources are invalid');

  if (!isRecord(state.buildingLevels)) throw new Error('tax research state buildingLevels are invalid');
  const buildingIds = config.buildingConfig.buildings.map((building) => building.id);
  if (Object.keys(state.buildingLevels).length !== buildingIds.length || buildingIds.some((id) => !Object.prototype.hasOwnProperty.call(state.buildingLevels, id))) {
    throw new Error('tax research state buildingLevels keys are invalid');
  }
  for (const building of config.buildingConfig.buildings) {
    const level = state.buildingLevels[building.id];
    if (!isSafeInteger(level, building.initialLevel) || level > building.maxLevel) throw new Error(`building level is invalid: ${building.id}`);
  }

  if (!isRecord(state.researchLevels)) throw new Error('tax research state researchLevels are invalid');
  const researchIds = config.researches.map((research) => research.id);
  if (Object.keys(state.researchLevels).length !== researchIds.length || researchIds.some((id) => !Object.prototype.hasOwnProperty.call(state.researchLevels, id))) {
    throw new Error('tax research state researchLevels keys are invalid');
  }
  for (const research of config.researches) {
    const level = state.researchLevels[research.id];
    if (!isSafeInteger(level, research.initialLevel) || level > research.maxLevel) throw new Error(`research level is invalid: ${research.id}`);
  }

  if (!Array.isArray(state.queue) || state.queue.length > config.researchQueue.maxEntries) throw new Error('tax research queue entries are invalid');
  if (!isSafeInteger(state.nextSequence, 1) || !isSafeInteger(state.lastUpdatedAtMs)) throw new Error('tax research queue clock is invalid');
  if (state.lastTaxClaimDay !== null && !isSafeInteger(state.lastTaxClaimDay)) throw new Error('tax research tax day is invalid');
  const entryIds = new Set<string>();
  const researchIdsInQueue = new Set<string>();
  let previousSequence: number | null = null;
  state.queue.forEach((entry, index) => {
    if (!isRecord(entry)) throw new Error(`tax research queue entry ${index} is invalid`);
    exactKeys(entry, ['id', 'researchId', 'fromLevel', 'targetLevel', 'cost', 'durationMs', 'startAtMs', 'finishAtMs'], `tax research queue entry ${index}`);
    const research = findResearch(config, entry.researchId as string);
    const upgrade = findResearchUpgrade(config, entry.researchId as string, entry.targetLevel as number);
    if (!research || !upgrade || researchIdsInQueue.has(entry.researchId as string)) throw new Error(`tax research queue entry ${index} research is invalid`);
    if (entry.fromLevel !== state.researchLevels[entry.researchId as string]) throw new Error(`tax research queue entry ${index} fromLevel is invalid`);
    if (!isSafeInteger(entry.fromLevel, research.initialLevel) || !isSafeInteger(entry.targetLevel, entry.fromLevel + 1) || entry.targetLevel > research.maxLevel) throw new Error(`tax research queue entry ${index} level is invalid`);
    const sequence = entrySequence(entry, research.id, entry.targetLevel as number, index);
    if (entryIds.has(entry.id as string) || sequence >= state.nextSequence || (previousSequence !== null && (sequence <= previousSequence || sequence !== previousSequence + 1))) {
      throw new Error(`tax research queue entry ${index} id sequence is invalid`);
    }
    if (!validCostMap(entry.cost, config) || Object.keys(entry.cost).length !== Object.keys(upgrade.cost).length || Object.keys(entry.cost).some((resourceId) => entry.cost[resourceId] !== upgrade.cost[resourceId])) throw new Error(`tax research queue entry ${index} cost is invalid`);
    if (!allPrerequisitesMet(state.buildingLevels, state.researchLevels, upgrade.prerequisites)) throw new Error(`tax research queue entry ${index} prerequisite is invalid`);
    if (entry.durationMs !== upgrade.durationMs || !isSafeInteger(entry.startAtMs) || !isSafeInteger(entry.finishAtMs) || !Number.isSafeInteger(entry.startAtMs + entry.durationMs) || entry.finishAtMs !== entry.startAtMs + entry.durationMs || entry.finishAtMs <= state.lastUpdatedAtMs) {
      throw new Error(`tax research queue entry ${index} timing is invalid`);
    }
    if (index > 0 && entry.startAtMs < state.queue[index - 1].finishAtMs) throw new Error(`tax research queue entry ${index} overlaps previous entry`);
    entryIds.add(entry.id);
    researchIdsInQueue.add(entry.researchId as string);
    previousSequence = sequence;
  });
  if (state.queue.length > 0 && previousSequence !== null && state.nextSequence !== previousSequence + 1) throw new Error('tax research queue nextSequence is invalid');
}

export function createInitialTaxResearchState(
  config: TaxResearchConfig,
  buildingLevels: Readonly<Record<string, number>>,
  resources: TaxResearchResources,
  atMs = 0,
): TaxResearchState {
  if (!isSafeInteger(atMs)) throw new Error('initial tax research time is invalid');
  const state: TaxResearchState = {
    schemaVersion: 1,
    resources: cloneResources(resources),
    buildingLevels: { ...buildingLevels },
    researchLevels: Object.fromEntries(config.researches.map((research) => [research.id, research.initialLevel])),
    queue: [],
    nextSequence: 1,
    lastUpdatedAtMs: atMs,
    lastTaxClaimDay: null,
  };
  assertTaxResearchState(state, config);
  return state;
}

export function calculateDailyTax(config: TaxResearchConfig, castleLevel: number): TaxResearchResources {
  const tier = findTaxTier(config, castleLevel);
  if (!tier) throw new Error(`unknown castle tax level: ${castleLevel}`);
  return Object.fromEntries(tier.payouts.map((payout) => [payout.resourceId, Math.min(payout.dailyAmount, payout.dailyCap)]));
}

export function settleTaxResearchQueue(state: TaxResearchState, config: TaxResearchConfig, atMs: number): TaxResearchResult {
  try { assertTaxResearchState(state, config); } catch { return stateError(); }
  if (!isSafeInteger(atMs)) return timeError(state, 'INVALID_TIME', '时间必须是非负安全整数');
  if (atMs < state.lastUpdatedAtMs) return timeError(state, 'TIME_REWIND', '时间不能倒退');
  const next = cloneState(state);
  const completedEntryIds = settleMutable(next, atMs);
  return { accepted: true, code: 'SETTLED', state: next, completedEntryIds };
}

export function claimDailyTax(state: TaxResearchState, config: TaxResearchConfig, dayIndex: number, atMs: number): TaxResearchResult {
  const settled = settleTaxResearchQueue(state, config, atMs);
  if (!settled.accepted || !settled.state) return settled;
  const rollback = cloneState(state);
  if (!isSafeInteger(dayIndex)) return reject(rollback, 'INVALID_DAY', '税收日必须是非负安全整数');
  if (state.lastTaxClaimDay !== null && dayIndex < state.lastTaxClaimDay) return reject(rollback, 'DAY_REWIND', '税收日不能倒退');
  if (dayIndex === state.lastTaxClaimDay) return reject(rollback, 'TAX_ALREADY_CLAIMED', '当天税收已经领取');
  const castleLevel = settled.state.buildingLevels[config.tax.buildingId];
  const tax = calculateDailyTax(config, castleLevel);
  const next = cloneState(settled.state);
  next.resources = cloneResources(next.resources);
  for (const [resourceId, amount] of Object.entries(tax)) {
    if (!Number.isSafeInteger(next.resources[resourceId] + amount)) return reject(rollback, 'INVALID_TIME', '税收累计超出安全整数范围');
    next.resources[resourceId] += amount;
  }
  next.lastTaxClaimDay = dayIndex;
  assertTaxResearchState(next, config);
  return { accepted: true, code: 'TAX_CLAIMED', state: next, completedEntryIds: settled.completedEntryIds, tax };
}

export function enqueueResearch(state: TaxResearchState, config: TaxResearchConfig, researchId: string, atMs: number): TaxResearchResult {
  const settled = settleTaxResearchQueue(state, config, atMs);
  if (!settled.accepted || !settled.state) return settled;
  const rollback = cloneState(state);
  const next = cloneState(settled.state);
  const research = findResearch(config, researchId);
  if (!research) return reject(rollback, 'UNKNOWN_RESEARCH', `未知研究: ${researchId}`);
  if (next.queue.length >= config.researchQueue.maxEntries) return reject(rollback, 'RESEARCH_QUEUE_FULL', '研究队列已满');
  if (next.queue.some((entry) => entry.researchId === researchId)) return reject(rollback, 'RESEARCH_BUSY', '同一研究不能重复排队');
  const fromLevel = next.researchLevels[researchId];
  const targetLevel = fromLevel + 1;
  if (targetLevel > research.maxLevel) return reject(rollback, 'MAX_LEVEL', '研究已达到最高等级');
  const upgrade = findResearchUpgrade(config, researchId, targetLevel) as ResearchUpgradeDefinition | undefined;
  if (!upgrade) return reject(rollback, 'INVALID_STATE', '缺少目标等级配置');
  if (!allPrerequisitesMet(next.buildingLevels, next.researchLevels, upgrade.prerequisites)) return reject(rollback, 'PREREQUISITE_MISSING', '研究前置未满足');
  for (const [resourceId, amount] of Object.entries(upgrade.cost)) {
    if (next.resources[resourceId] < amount) return reject(rollback, 'INSUFFICIENT_RESOURCES', `资源不足: ${resourceId}`);
  }
  const previous = next.queue[next.queue.length - 1];
  const startAtMs = Math.max(atMs, previous?.finishAtMs ?? atMs);
  if (!Number.isSafeInteger(startAtMs + upgrade.durationMs) || !Number.isSafeInteger(next.nextSequence + 1)) {
    return reject(rollback, 'INVALID_TIME', '研究完成时间超出安全整数范围');
  }
  const entry: TaxResearchQueueEntry = {
    id: `${researchId}:L${targetLevel}:Q${next.nextSequence}`,
    researchId,
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
  assertTaxResearchState(next, config);
  return { accepted: true, code: 'RESEARCH_ENQUEUED', state: next, completedEntryIds: settled.completedEntryIds, entry };
}

export function getResearchEffects(state: TaxResearchState, config: TaxResearchConfig): Readonly<Record<string, number>> {
  assertTaxResearchState(state, config);
  const effects: Record<string, number> = {};
  for (const research of config.researches) {
    const level = state.researchLevels[research.id];
    for (const upgrade of research.upgrades) {
      if (upgrade.targetLevel > level) break;
      for (const effect of upgrade.effects) effects[effect.effectId] = (effects[effect.effectId] ?? 0) + effect.amountBps;
    }
  }
  return effects;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function serializeTaxResearchState(state: TaxResearchState, config: TaxResearchConfig): string {
  assertTaxResearchState(state, config);
  return JSON.stringify(canonicalize(state));
}

export function deserializeTaxResearchState(serialized: string, config: TaxResearchConfig): TaxResearchState {
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { throw new Error('tax research state JSON is invalid'); }
  assertTaxResearchState(value, config);
  return cloneState(value);
}

export function buildingLevelsFromConfig(config: TaxResearchConfig): Readonly<Record<string, number>> {
  return Object.fromEntries(config.buildingConfig.buildings.map((building) => [building.id, building.initialLevel]));
}
