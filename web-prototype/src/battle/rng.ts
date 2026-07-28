import type { BattleState } from './types';

export function nextRandom(state: BattleState): number {
  let value = state.rngState | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  state.rngState = value | 0;
  state.rngCursor += 1;
  return (value >>> 0) / 4294967296;
}

export function shuffleInPlace<T>(state: BattleState, values: T[]): void {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(nextRandom(state) * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
  }
}

export function chooseSeeded<T>(state: BattleState, values: T[]): T | undefined {
  if (values.length === 0) return undefined;
  return values[Math.floor(nextRandom(state) * values.length)];
}
