export interface RngState {
  rngState: number;
  rngCursor: number;
}

export function createRng(seed = 20260712): RngState {
  const normalizedSeed = seed || 1;
  return { rngState: normalizedSeed | 0, rngCursor: 0 };
}

export function nextRandom(state: RngState): number {
  let value = state.rngState | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = value | 0;
  state.rngCursor += 1;
  return (value >>> 0) / 4294967296;
}

export function shuffleInPlace<T>(state: RngState, values: T[]): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextRandom(state) * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}

export function chooseSeeded<T>(state: RngState, values: readonly T[]): T | undefined {
  if (values.length === 0) return undefined;
  return values[Math.floor(nextRandom(state) * values.length)];
}

export function cloneRngState(state: RngState): RngState {
  return { rngState: state.rngState, rngCursor: state.rngCursor };
}
