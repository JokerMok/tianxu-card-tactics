export interface BattleSafeRecord { readonly [key: string]: BattleSafeValue; }
export type BattleSafeValue = null | boolean | number | string | readonly BattleSafeValue[] | BattleSafeRecord;

export interface BattleProgress {
  readonly clearedNodes: readonly string[];
  readonly unlockedNodes: readonly string[];
}

export interface BattleResultState {
  readonly resources: Readonly<Record<string, number>>;
  readonly progress: BattleProgress;
  readonly battleOutcomes: Readonly<Record<string, BattleSafeValue>>;
  /** Maps a durable business key to the canonical immutable intent fingerprint. */
  readonly processedBattleKeys: Readonly<Record<string, string>>;
}

export interface BattleResultIntent {
  readonly businessKey: string;
  readonly nodeId: string;
  readonly cost: Readonly<Record<string, number>>;
  readonly outcome: BattleSafeValue;
  readonly reward: Readonly<Record<string, number>>;
  readonly progress: BattleProgress;
}

export type BattleResultPersistence = (next: BattleResultState) => void;
export type BattleResultCode = 'APPLIED' | 'DUPLICATE' | 'CONFLICT' | 'INVALID' | 'PERSIST_FAILED' | 'REENTRANT';

export interface BattleResultTransactionResult {
  readonly accepted: boolean;
  readonly applied: boolean;
  readonly code: BattleResultCode;
  readonly state: BattleResultState;
}

const snapshots = new WeakSet<object>();

function plainObject(value: object): boolean {
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

function snapshotValue(value: unknown, active: Set<object>): BattleSafeValue | null {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'object') return null;
  if (active.has(value)) return null;

  active.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
      if (!lengthDescriptor || !('value' in lengthDescriptor) || typeof lengthDescriptor.value !== 'number') return null;
      const length = Reflect.get(value, 'length');
      if (length !== lengthDescriptor.value || !Number.isSafeInteger(length) || length < 0) return null;
      if (keys.length !== length + 1 || !keys.includes('length')) return null;
      const copy: BattleSafeValue[] = [];
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        if (!keys.includes(key)) return null;
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
        const child = Reflect.get(value, key);
        if (!Object.is(child, descriptor.value)) return null;
        const frozenChild = snapshotValue(child, active);
        if (frozenChild === null && child !== null) return null;
        copy.push(frozenChild);
      }
      const frozen = Object.freeze(copy);
      snapshots.add(frozen);
      return frozen;
    }

    if (!plainObject(value)) return null;
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) return null;
    const copy: Record<string, BattleSafeValue> = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || descriptor.get || descriptor.set || !descriptor.enumerable) return null;
      const child = Reflect.get(value, key);
      if (!Object.is(child, descriptor.value)) return null;
      const frozenChild = snapshotValue(child, active);
      if (frozenChild === null && child !== null) return null;
      Object.defineProperty(copy, key, {
        value: frozenChild,
        enumerable: true,
        configurable: false,
        writable: false,
      });
    }
    const frozen = Object.freeze(copy);
    snapshots.add(frozen);
    return frozen;
  } catch {
    return null;
  } finally {
    active.delete(value);
  }
}

/**
 * Reads each external data property once after checking its own descriptor.
 * Accessors, unsafe primitives, cyclic values and hostile Proxy traps are rejected.
 */
export function snapshotBattleValue(value: unknown): BattleSafeValue | null {
  return snapshotValue(value, new Set<object>());
}

function record(value: BattleSafeValue | undefined): Readonly<Record<string, BattleSafeValue>> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Readonly<Record<string, BattleSafeValue>> : null;
}

function string(value: BattleSafeValue | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 && value === value.trim() ? value : null;
}

function resourceMap(value: BattleSafeValue | undefined): Readonly<Record<string, number>> | null {
  const candidate = record(value);
  if (candidate === null) return null;
  for (const [key, amount] of Object.entries(candidate)) {
    if (key.trim().length === 0 || key !== key.trim() || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return null;
  }
  return candidate as Readonly<Record<string, number>>;
}

function nodes(value: BattleSafeValue | undefined): readonly string[] | null {
  if (!Array.isArray(value) || value.some((node) => typeof node !== 'string' || node.trim().length === 0 || node !== node.trim())) return null;
  return value as readonly string[];
}

function progress(value: BattleSafeValue | undefined): BattleProgress | null {
  const candidate = record(value);
  if (candidate === null || !sameKeys(candidate, ['clearedNodes', 'unlockedNodes'])) return null;
  const clearedNodes = nodes(candidate.clearedNodes);
  const unlockedNodes = nodes(candidate.unlockedNodes);
  return clearedNodes === null || unlockedNodes === null ? null : candidate as unknown as BattleProgress;
}

function sameKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function canonical(value: BattleSafeValue): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `s:${JSON.stringify(value)}`;
  if (typeof value === 'boolean') return value ? 'b:1' : 'b:0';
  if (typeof value === 'number') return `n:${String(value)}`;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const object = record(value);
  if (!object) throw new Error('invalid canonical record');
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
}

function freezeState(value: BattleResultState): BattleResultState {
  const snapshot = snapshotBattleValue(value);
  if (snapshot === null) throw new Error('internal battle transaction state is invalid');
  return snapshot as unknown as BattleResultState;
}

function parseState(value: BattleSafeValue | null): BattleResultState | null {
  const candidate = record(value ?? undefined);
  if (candidate === null || !sameKeys(candidate, ['resources', 'progress', 'battleOutcomes', 'processedBattleKeys'])) return null;
  const resources = resourceMap(candidate.resources);
  const stateProgress = progress(candidate.progress);
  const battleOutcomes = record(candidate.battleOutcomes);
  const processedBattleKeys = record(candidate.processedBattleKeys);
  if (resources === null || stateProgress === null || battleOutcomes === null || processedBattleKeys === null) return null;
  for (const [key, fingerprint] of Object.entries(processedBattleKeys)) {
    if (string(key) === null || typeof fingerprint !== 'string' || fingerprint.length === 0) return null;
  }
  if (Object.keys(battleOutcomes).some((key) => string(key) === null || !Object.prototype.hasOwnProperty.call(processedBattleKeys, key))) return null;
  return candidate as unknown as BattleResultState;
}

function parseIntent(value: BattleSafeValue): BattleResultIntent | null {
  const candidate = record(value);
  if (candidate === null || !sameKeys(candidate, ['businessKey', 'nodeId', 'cost', 'outcome', 'reward', 'progress'])) return null;
  const businessKey = string(candidate.businessKey);
  const nodeId = string(candidate.nodeId);
  const cost = resourceMap(candidate.cost);
  const reward = resourceMap(candidate.reward);
  const nextProgress = progress(candidate.progress);
  if (businessKey === null || nodeId === null || cost === null || reward === null || nextProgress === null || !Object.prototype.hasOwnProperty.call(candidate, 'outcome')) return null;
  return candidate as unknown as BattleResultIntent;
}

function uniqueNodes(existing: readonly string[], addition: readonly string[]): readonly string[] {
  const next = [...existing];
  for (const node of addition) if (!next.includes(node)) next.push(node);
  return Object.freeze(next);
}

function makeState(current: BattleResultState, intent: BattleResultIntent, fingerprint: string): BattleResultState | null {
  const resources: Record<string, number> = Object.create(null) as Record<string, number>;
  for (const [resource, amount] of Object.entries(current.resources)) {
    const cost = intent.cost[resource] ?? 0;
    const reward = intent.reward[resource] ?? 0;
    if (cost > amount || !Number.isSafeInteger(amount - cost + reward) || amount - cost + reward < 0) return null;
    resources[resource] = amount - cost + reward;
  }
  if (Object.keys(intent.cost).some((resource) => !Object.prototype.hasOwnProperty.call(current.resources, resource))) return null;
  if (Object.keys(intent.reward).some((resource) => !Object.prototype.hasOwnProperty.call(current.resources, resource))) return null;

  return freezeState({
    resources,
    progress: {
      clearedNodes: uniqueNodes(current.progress.clearedNodes, intent.progress.clearedNodes),
      unlockedNodes: uniqueNodes(current.progress.unlockedNodes, intent.progress.unlockedNodes),
    },
    battleOutcomes: { ...current.battleOutcomes, [intent.businessKey]: intent.outcome },
    processedBattleKeys: { ...current.processedBattleKeys, [intent.businessKey]: fingerprint },
  });
}

export function createBattleResultState(resources: Record<string, number>, progressValue: BattleProgress = { clearedNodes: [], unlockedNodes: [] }): BattleResultState {
  const state = parseState(snapshotBattleValue({
    resources,
    progress: progressValue,
    battleOutcomes: {},
    processedBattleKeys: {},
  }));
  if (state === null) throw new Error('battle result state is invalid');
  return state;
}

/** A single-persist, failure-atomic transaction service for all battle settlement effects. */
export class BattleResultTransactionService {
  private current: BattleResultState;
  private readonly persist: BattleResultPersistence;
  private committing = false;

  constructor(initialState: BattleResultState, persist: BattleResultPersistence) {
    const initial = parseState(snapshotBattleValue(initialState));
    if (initial === null || typeof persist !== 'function') throw new Error('battle transaction service is invalid');
    this.current = initial;
    this.persist = persist;
  }

  get snapshot(): BattleResultState {
    return this.current;
  }

  settle(candidate: unknown): BattleResultTransactionResult {
    const snapshot = snapshotBattleValue(candidate);
    return snapshot === null ? this.result(false, false, 'INVALID') : this.settleSnapshot(snapshot);
  }

  settleSnapshot(snapshot: BattleSafeValue): BattleResultTransactionResult {
    try {
      if (!isOwnedBattleSnapshot(snapshot)) return this.result(false, false, 'INVALID');
      if (this.committing) return this.result(false, false, 'REENTRANT');
      const intent = parseIntent(snapshot);
      if (intent === null) return this.result(false, false, 'INVALID');
      const fingerprint = canonical(snapshot);
      const processed = this.current.processedBattleKeys[intent.businessKey];
      if (processed !== undefined) return processed === fingerprint
        ? this.result(true, false, 'DUPLICATE')
        : this.result(false, false, 'CONFLICT');

      const next = makeState(this.current, intent, fingerprint);
      if (next === null) return this.result(false, false, 'INVALID');
      this.committing = true;
      try {
        this.persist(next);
      } catch {
        return this.result(false, false, 'PERSIST_FAILED');
      } finally {
        this.committing = false;
      }
      this.current = next;
      return this.result(true, true, 'APPLIED');
    } catch {
      return this.result(false, false, 'INVALID');
    }
  }

  private result(accepted: boolean, applied: boolean, code: BattleResultCode): BattleResultTransactionResult {
    return Object.freeze({ accepted, applied, code, state: this.current });
  }
}

export function isOwnedBattleSnapshot(value: unknown): value is BattleSafeValue {
  return value !== null && typeof value === 'object' && snapshots.has(value);
}
