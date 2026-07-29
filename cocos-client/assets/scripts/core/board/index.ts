import type { Side, Unit } from '../types/index.ts';

export const LANE_COUNT = 2;
export const CELLS_PER_LANE = 12;
export const SUMMON_DEPTH = 3;

export interface BoardState {
  readonly laneCount: typeof LANE_COUNT;
  readonly cellsPerLane: typeof CELLS_PER_LANE;
  readonly summonDepth: typeof SUMMON_DEPTH;
  readonly units: readonly Unit[];
}

export function createBoardState(units: readonly Unit[] = []): BoardState {
  return { laneCount: LANE_COUNT, cellsPerLane: CELLS_PER_LANE, summonDepth: SUMMON_DEPTH, units: [...units] };
}

function validLane(lane: number): boolean { return Number.isInteger(lane) && lane >= 0 && lane < LANE_COUNT; }
function validCell(cell: number): boolean { return Number.isInteger(cell) && cell >= 0 && cell < CELLS_PER_LANE; }

export function summonCells(side: Side): readonly number[] {
  return side === 'player'
    ? [0, 1, 2]
    : [CELLS_PER_LANE - 1, CELLS_PER_LANE - 2, CELLS_PER_LANE - 3];
}

export function isSummonCell(side: Side, lane: number, cell: number): boolean {
  return validLane(lane) && validCell(cell) && summonCells(side).includes(cell);
}

export function isOccupied(state: BoardState, lane: number, cell: number): boolean {
  return state.units.some((unit) => unit.hp > 0 && unit.lane === lane && unit.cell === cell);
}

export function getLegalDeploymentCells(state: BoardState, side: Side): Array<{ lane: number; cell: number }> {
  return Array.from({ length: LANE_COUNT }, (_, lane) => lane)
    .flatMap((lane) => summonCells(side).map((cell) => ({ lane, cell })))
    .filter(({ lane, cell }) => !isOccupied(state, lane, cell));
}

export function deployUnit(state: BoardState, unit: Unit): BoardState {
  if (!isSummonCell(unit.side, unit.lane, unit.cell)) throw new Error('unit deployment cell is invalid');
  if (isOccupied(state, unit.lane, unit.cell)) throw new Error('unit deployment cell is occupied');
  if (state.units.some((candidate) => candidate.id === unit.id)) throw new Error('unit id already exists');
  return { ...state, units: [...state.units, unit] };
}
