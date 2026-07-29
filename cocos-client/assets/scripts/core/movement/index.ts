import type { BoardState } from '../board/index.ts';

export interface MovementResult {
  readonly state: BoardState;
  readonly moved: boolean;
  readonly steps: number;
  readonly blocked: 'boundary' | 'occupied' | 'none';
}

export function moveUnit(state: BoardState, unitId: string, requestedSteps?: number): MovementResult {
  const index = state.units.findIndex((unit) => unit.id === unitId);
  if (index < 0) return { state, moved: false, steps: 0, blocked: 'none' };
  const unit = state.units[index];
  const distance = requestedSteps ?? unit.move;
  if (!Number.isSafeInteger(distance) || distance < 0) throw new Error('movement distance is invalid');
  const direction = unit.side === 'player' ? 1 : -1;
  let cell = unit.cell;
  let movedSteps = 0;
  let blocked: MovementResult['blocked'] = 'none';
  for (let attempt = 0; attempt < distance; attempt += 1) {
    const nextCell = cell + direction;
    if (nextCell < 0 || nextCell >= state.cellsPerLane) { blocked = 'boundary'; break; }
    if (state.units.some((candidate) => candidate.id !== unit.id && candidate.hp > 0
      && candidate.lane === unit.lane && candidate.cell === nextCell)) {
      blocked = 'occupied';
      break;
    }
    cell = nextCell;
    movedSteps += 1;
  }
  if (cell === unit.cell) return { state, moved: false, steps: 0, blocked };
  const updated = { ...unit, cell, actionsTaken: unit.actionsTaken + 1 };
  const units = [...state.units];
  units[index] = updated;
  return { state: { ...state, units }, moved: true, steps: movedSteps, blocked };
}
