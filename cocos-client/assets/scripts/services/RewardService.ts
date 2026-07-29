export interface RewardState {
  readonly resources: Readonly<Record<string, number>>;
  readonly processedRewardKeys: readonly string[];
}

export type RewardAmounts<T extends RewardState> = Partial<Record<Extract<keyof T['resources'], string>, number>>;
export type RewardPersistence<T extends RewardState> = (next: Readonly<T>) => void;

export interface RewardGrantResult<T extends RewardState> {
  applied: boolean;
  state: T;
}

function copyState<T extends RewardState>(state: T): T {
  return {
    ...state,
    resources: { ...state.resources },
    processedRewardKeys: [...state.processedRewardKeys],
  };
}

function assertBusinessKey(businessKey: string): void {
  if (businessKey.trim().length === 0 || businessKey !== businessKey.trim()) {
    throw new Error('businessKey is invalid');
  }
}

function assertState(state: RewardState): void {
  const resourceValues = Object.values(state.resources);
  if (resourceValues.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new Error('reward state resources are invalid');
  }
  if (
    state.processedRewardKeys.some(
      (key) => typeof key !== 'string' || key.trim().length === 0 || key !== key.trim(),
    )
    || new Set(state.processedRewardKeys).size !== state.processedRewardKeys.length
  ) {
    throw new Error('processedRewardKeys are invalid');
  }
}

export class RewardService<T extends RewardState> {
  private current: T;
  private readonly persist: RewardPersistence<T>;

  constructor(initialState: T, persist: RewardPersistence<T>) {
    assertState(initialState);
    this.current = copyState(initialState);
    this.persist = persist;
  }

  snapshot(): T {
    return copyState(this.current);
  }

  grant(businessKey: string, reward: RewardAmounts<T>): RewardGrantResult<T> {
    assertBusinessKey(businessKey);
    if (this.current.processedRewardKeys.includes(businessKey)) {
      return { applied: false, state: this.snapshot() };
    }

    const entries = Object.entries(reward);
    if (entries.length === 0) throw new Error('reward must contain at least one resource');

    const resources: Record<string, number> = { ...this.current.resources };
    for (const [resource, amount] of entries) {
      if (!Object.prototype.hasOwnProperty.call(resources, resource)) {
        throw new Error(`unknown reward resource: ${resource}`);
      }
      if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error(`invalid reward amount: ${resource}`);
      const nextAmount = resources[resource] + amount;
      if (!Number.isSafeInteger(nextAmount)) throw new Error(`reward amount overflow: ${resource}`);
      resources[resource] = nextAmount;
    }

    const next = {
      ...this.current,
      resources,
      processedRewardKeys: [...this.current.processedRewardKeys, businessKey],
    } as T;

    this.persist(copyState(next));
    this.current = next;
    return { applied: true, state: this.snapshot() };
  }
}
