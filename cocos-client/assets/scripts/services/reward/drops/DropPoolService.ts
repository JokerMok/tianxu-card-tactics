export type RewardAmounts = Readonly<Record<string, number>>;
export type DropSource = 'FIRST_CLEAR' | 'WEIGHTED' | 'PITY';

export interface DropReward {
  readonly id: string;
  readonly rewards: RewardAmounts;
  readonly weight?: number;
}

export interface DropPityRule {
  readonly rareRewardId: string;
  readonly guaranteedAfterMisses: number;
}

export interface DropPool {
  readonly id: string;
  readonly maxClaims: number;
  readonly firstClear: DropReward;
  readonly repeat: readonly DropReward[];
  readonly pity?: DropPityRule;
}

export interface DropPoolConfig {
  readonly pools: readonly DropPool[];
}

export interface DropPoolState {
  readonly claims: number;
  readonly firstClearClaimed: boolean;
  readonly rareMisses: number;
}

export type DropResolution =
  | {
    readonly code: 'GRANTED';
    readonly source: DropSource;
    readonly reward: DropReward;
    readonly nextState: DropPoolState;
  }
  | {
    readonly code: 'LIMIT_REACHED';
    readonly nextState: DropPoolState;
  };

export type DropRng = () => number;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty trimmed string`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`);
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative safe integer`);
}

function assertReward(value: unknown, label: string, requiresWeight: boolean): asserts value is DropReward {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertId(value.id, `${label}.id`);
  if (!isRecord(value.rewards) || Object.keys(value.rewards).length === 0) {
    throw new Error(`${label}.rewards must be a non-empty resource map`);
  }
  for (const [resource, amount] of Object.entries(value.rewards)) {
    assertId(resource, `${label}.rewards key`);
    assertPositiveInteger(amount, `${label}.rewards.${resource}`);
  }
  if (requiresWeight) {
    assertPositiveInteger(value.weight, `${label}.weight`);
  } else if (value.weight !== undefined) {
    throw new Error(`${label}.weight is only allowed for repeat rewards`);
  }
}

function assertPool(value: unknown, label: string): asserts value is DropPool {
  if (!isRecord(value)) throw new Error(`${label} must be an object`);
  assertId(value.id, `${label}.id`);
  assertPositiveInteger(value.maxClaims, `${label}.maxClaims`);
  assertReward(value.firstClear, `${label}.firstClear`, false);
  if (!Array.isArray(value.repeat) || value.repeat.length === 0) throw new Error(`${label}.repeat must be a non-empty array`);

  const repeatIds = new Set<string>();
  let totalWeight = 0;
  value.repeat.forEach((reward, index) => {
    assertReward(reward, `${label}.repeat[${index}]`, true);
    if (repeatIds.has(reward.id)) throw new Error(`${label}.repeat[${index}].id is duplicated`);
    repeatIds.add(reward.id);
    totalWeight += reward.weight as number;
    if (!Number.isSafeInteger(totalWeight)) throw new Error(`${label}.repeat total weight is unsafe`);
  });

  if (value.pity === undefined) return;
  if (!isRecord(value.pity)) throw new Error(`${label}.pity must be an object`);
  assertId(value.pity.rareRewardId, `${label}.pity.rareRewardId`);
  assertPositiveInteger(value.pity.guaranteedAfterMisses, `${label}.pity.guaranteedAfterMisses`);
  if (!repeatIds.has(value.pity.rareRewardId)) {
    throw new Error(`${label}.pity.rareRewardId must reference a repeat reward`);
  }
}

export function assertDropPoolConfig(value: unknown): asserts value is DropPoolConfig {
  if (!isRecord(value) || !Array.isArray(value.pools) || value.pools.length === 0) {
    throw new Error('drop pool config must contain a non-empty pools array');
  }
  const ids = new Set<string>();
  value.pools.forEach((pool, index) => {
    assertPool(pool, `pools[${index}]`);
    if (ids.has(pool.id)) throw new Error(`pools[${index}].id is duplicated`);
    ids.add(pool.id);
  });
}

function assertState(pool: DropPool, state: DropPoolState): void {
  if (!isRecord(state)) throw new Error('drop pool state must be an object');
  assertNonNegativeInteger(state.claims, 'drop pool state claims');
  assertNonNegativeInteger(state.rareMisses, 'drop pool state rareMisses');
  if (typeof state.firstClearClaimed !== 'boolean') throw new Error('drop pool state firstClearClaimed must be boolean');
  if (state.claims > pool.maxClaims) throw new Error('drop pool state claims exceed maxClaims');
  if (!state.firstClearClaimed && (state.claims !== 0 || state.rareMisses !== 0)) {
    throw new Error('drop pool state has repeat progress before first clear');
  }
  if (!state.firstClearClaimed) return;
  if (state.firstClearClaimed && state.claims === 0) {
    throw new Error('drop pool state first clear flag requires at least one claim');
  }

  const repeatClaims = state.claims - 1;
  if (pool.pity === undefined && state.rareMisses !== 0) {
    throw new Error('drop pool state pity misses require a pity rule');
  }
  if (state.rareMisses > repeatClaims) {
    throw new Error('drop pool state rareMisses exceed repeat claims');
  }
}

export function assertDropPoolState(pool: DropPool, state: DropPoolState): asserts state is DropPoolState {
  assertPool(pool, 'drop pool');
  assertState(pool, state);
}

function copyReward(reward: DropReward): DropReward {
  return Object.freeze({
    id: reward.id,
    ...(reward.weight === undefined ? {} : { weight: reward.weight }),
    rewards: Object.freeze({ ...reward.rewards }),
  });
}

function nextState(state: DropPoolState, rareMisses: number): DropPoolState {
  if (state.claims >= Number.MAX_SAFE_INTEGER) throw new Error('drop pool claims would overflow');
  if (!Number.isSafeInteger(rareMisses) || rareMisses < 0) {
    throw new Error('drop pool rareMisses would overflow');
  }
  return Object.freeze({
    claims: state.claims + 1,
    firstClearClaimed: true,
    rareMisses,
  });
}

function weightedReward(pool: DropPool, rng: DropRng): DropReward {
  const roll = rng();
  if (typeof roll !== 'number' || !Number.isFinite(roll) || roll < 0 || roll >= 1) {
    throw new Error('drop RNG must return a finite number in [0, 1)');
  }
  const totalWeight = pool.repeat.reduce((total, reward) => total + (reward.weight as number), 0);
  let threshold = roll * totalWeight;
  for (const reward of pool.repeat) {
    threshold -= reward.weight as number;
    if (threshold < 0) return reward;
  }
  throw new Error('drop pool weighted selection failed');
}

/** Resolves one drop without retaining state; RNG is supplied by the caller. */
export function resolveDrop(pool: DropPool, state: DropPoolState, rng: DropRng): DropResolution {
  assertDropPoolState(pool, state);
  if (typeof rng !== 'function') throw new Error('drop RNG must be a function');
  if (state.claims >= pool.maxClaims) return Object.freeze({ code: 'LIMIT_REACHED', nextState: state });

  if (!state.firstClearClaimed) {
    return Object.freeze({
      code: 'GRANTED',
      source: 'FIRST_CLEAR',
      reward: copyReward(pool.firstClear),
      nextState: nextState(state, 0),
    });
  }

  const pityReward = pool.pity === undefined || state.rareMisses < pool.pity.guaranteedAfterMisses
    ? undefined
    : pool.repeat.find((reward) => reward.id === pool.pity?.rareRewardId);
  const reward = pityReward ?? weightedReward(pool, rng);
  const isRare = pool.pity !== undefined && reward.id === pool.pity.rareRewardId;
  return Object.freeze({
    code: 'GRANTED',
    source: pityReward === undefined ? 'WEIGHTED' : 'PITY',
    reward: copyReward(reward),
    nextState: nextState(state, isRare ? 0 : state.rareMisses + 1),
  });
}
