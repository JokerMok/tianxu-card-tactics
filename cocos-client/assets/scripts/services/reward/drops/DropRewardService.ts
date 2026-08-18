import {
  assertDropPoolConfig,
  assertDropPoolState,
  resolveDrop,
  type DropPool,
  type DropPoolState,
  type DropRng,
  type RewardAmounts,
} from './DropPoolService.ts';

export interface DropRewardState {
  readonly resources: Readonly<Record<string, number>>;
  readonly processedRewardKeys: readonly string[];
  readonly dropPools: Readonly<Record<string, DropPoolState>>;
}

export type DropRewardPersistence = (next: Readonly<DropRewardState>) => void;
export type DropClaimCode = 'APPLIED' | 'DUPLICATE' | 'LIMIT_REACHED';

export interface DropClaimResult {
  readonly applied: boolean;
  readonly code: DropClaimCode;
  readonly state: DropRewardState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertBusinessKey(businessKey: string): void {
  if (typeof businessKey !== 'string' || businessKey.trim().length === 0 || businessKey !== businessKey.trim()) {
    throw new Error('businessKey is invalid');
  }
}

function assertState(state: DropRewardState): void {
  if (!isRecord(state) || !isRecord(state.resources) || !isRecord(state.dropPools) || !Array.isArray(state.processedRewardKeys)) {
    throw new Error('drop reward state is invalid');
  }
  for (const [resource, amount] of Object.entries(state.resources)) {
    if (resource.trim().length === 0 || resource !== resource.trim() || !Number.isSafeInteger(amount) || amount < 0) {
      throw new Error('drop reward state resources are invalid');
    }
  }
  if (
    state.processedRewardKeys.some((key) => typeof key !== 'string' || key.trim().length === 0 || key !== key.trim())
    || new Set(state.processedRewardKeys).size !== state.processedRewardKeys.length
  ) {
    throw new Error('processedRewardKeys are invalid');
  }
  for (const progress of Object.values(state.dropPools)) {
    if (!isRecord(progress) || !Number.isSafeInteger(progress.claims) || progress.claims < 0
      || typeof progress.firstClearClaimed !== 'boolean'
      || !Number.isSafeInteger(progress.rareMisses) || progress.rareMisses < 0) {
      throw new Error('drop pool progress is invalid');
    }
  }
}

function copyState(state: DropRewardState): DropRewardState {
  const dropPools: Record<string, DropPoolState> = {};
  for (const [poolId, progress] of Object.entries(state.dropPools)) {
    dropPools[poolId] = { ...progress };
  }
  return {
    resources: { ...state.resources },
    processedRewardKeys: [...state.processedRewardKeys],
    dropPools,
  };
}

function grantResources(resources: Readonly<Record<string, number>>, reward: RewardAmounts): Record<string, number> {
  const next = { ...resources };
  for (const [resource, amount] of Object.entries(reward)) {
    if (!Object.prototype.hasOwnProperty.call(next, resource)) throw new Error(`unknown reward resource: ${resource}`);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`invalid reward amount: ${resource}`);
    const total = next[resource] + amount;
    if (!Number.isSafeInteger(total)) throw new Error(`reward amount overflow: ${resource}`);
    next[resource] = total;
  }
  return next;
}

/**
 * Persists the complete next reward state before replacing memory, matching RewardService's
 * single-commit failure semantics while including drop counters in the same transaction.
 */
export class DropRewardService {
  private current: DropRewardState;
  private readonly pools: ReadonlyMap<string, DropPool>;
  private readonly rng: DropRng;
  private readonly persist: DropRewardPersistence;

  constructor(initialState: DropRewardState, pools: readonly DropPool[], rng: DropRng, persist: DropRewardPersistence) {
    assertState(initialState);
    assertDropPoolConfig({ pools });
    if (typeof rng !== 'function' || typeof persist !== 'function') throw new Error('drop reward service is invalid');
    const poolIndex = new Map(pools.map((pool) => [pool.id, pool]));
    for (const [poolId, progress] of Object.entries(initialState.dropPools)) {
      const pool = poolIndex.get(poolId);
      if (pool === undefined) throw new Error(`unknown drop pool progress: ${poolId}`);
      assertDropPoolState(pool, progress);
    }
    this.current = copyState(initialState);
    this.pools = poolIndex;
    this.rng = rng;
    this.persist = persist;
  }

  snapshot(): DropRewardState {
    return copyState(this.current);
  }

  claim(businessKey: string, poolId: string): DropClaimResult {
    assertBusinessKey(businessKey);
    if (this.current.processedRewardKeys.includes(businessKey)) return this.result(false, 'DUPLICATE');

    const pool = this.pools.get(poolId);
    if (pool === undefined) throw new Error(`unknown drop pool: ${poolId}`);
    const poolState = this.current.dropPools[poolId];
    if (poolState === undefined) throw new Error(`missing drop pool progress: ${poolId}`);
    const resolution = resolveDrop(pool, poolState, this.rng);
    if (resolution.code === 'LIMIT_REACHED') return this.result(false, 'LIMIT_REACHED');

    const next: DropRewardState = {
      resources: grantResources(this.current.resources, resolution.reward.rewards),
      processedRewardKeys: [...this.current.processedRewardKeys, businessKey],
      dropPools: { ...this.current.dropPools, [poolId]: resolution.nextState },
    };
    this.persist(copyState(next));
    this.current = next;
    return this.result(true, 'APPLIED');
  }

  private result(applied: boolean, code: DropClaimCode): DropClaimResult {
    return { applied, code, state: this.snapshot() };
  }
}
