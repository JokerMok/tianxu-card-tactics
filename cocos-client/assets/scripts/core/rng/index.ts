export interface RngState { readonly rngState: number; readonly rngCursor: number; }
export interface RandomResult { readonly value: number; readonly state: RngState; }
export interface ShuffleResult<T> { readonly values: readonly T[]; readonly state: RngState; }

export function createRng(seed = 20260712): RngState {
  const normalizedSeed = seed || 1;
  return { rngState: normalizedSeed | 0, rngCursor: 0 };
}

export function nextRandom(state: RngState): RandomResult {
  let value = state.rngState | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return { value: (value >>> 0) / 4294967296, state: { rngState: value | 0, rngCursor: state.rngCursor + 1 } };
}

export function shuffle<T>(state: RngState, values: readonly T[]): ShuffleResult<T> {
  const result = [...values];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const random = nextRandom(state);
    const swapIndex = Math.floor(random.value * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
    state = random.state;
  }
  return { values: result, state };
}

export function chooseSeeded<T>(state: RngState, values: readonly T[]): { value: T | undefined; state: RngState } {
  if (values.length === 0) return { value: undefined, state };
  const random = nextRandom(state);
  return { value: values[Math.floor(random.value * values.length)], state: random.state };
}

export function cloneRngState(state: RngState): RngState {
  return { rngState: state.rngState, rngCursor: state.rngCursor };
}
