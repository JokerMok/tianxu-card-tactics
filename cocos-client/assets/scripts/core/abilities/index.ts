import type { BoardState } from '../board/index.ts';

export interface AbilityResult {
  readonly state: BoardState;
  readonly steps: number;
  readonly blocked: 'boundary' | 'occupied' | 'none';
}

export interface RecallResult { readonly state: BoardState; readonly recalledUnitId?: string; }
export type ReactionType = 'GUARD' | 'COUNTER' | 'REFLECT';
export interface ReactionPlan { readonly type: ReactionType; readonly unitId: string; }
export interface ReactionInput {
  readonly guardUnitId?: string;
  readonly counterUnitId?: string;
  readonly reflectUnitId?: string;
}

function replaceUnits(state: BoardState, units: readonly BoardState['units'][number][]): BoardState {
  return { ...state, units: [...units] };
}

export function knockback(state: BoardState, sourceId: string, targetId: string, distance: number): AbilityResult {
  if (!Number.isSafeInteger(distance) || distance < 0) throw new Error('knockback distance is invalid');
  const source = state.units.find((unit) => unit.id === sourceId);
  const targetIndex = state.units.findIndex((unit) => unit.id === targetId);
  if (!source || targetIndex < 0) return { state, steps: 0, blocked: 'none' };
  const target = state.units[targetIndex];
  const direction = source.side === 'player' ? 1 : -1;
  let cell = target.cell;
  let steps = 0;
  let blocked: AbilityResult['blocked'] = 'none';
  for (let attempt = 0; attempt < distance; attempt += 1) {
    const next = cell + direction;
    if (next < 0 || next >= state.cellsPerLane) { blocked = 'boundary'; break; }
    if (state.units.some((unit) => unit.id !== target.id && unit.hp > 0 && unit.lane === target.lane && unit.cell === next)) { blocked = 'occupied'; break; }
    cell = next;
    steps += 1;
  }
  if (steps === 0) return { state, steps, blocked };
  const units = [...state.units];
  units[targetIndex] = { ...target, cell };
  return { state: replaceUnits(state, units), steps, blocked };
}

export function recall(state: BoardState, unitId: string): RecallResult {
  if (!state.units.some((unit) => unit.id === unitId)) return { state };
  return { state: replaceUnits(state, state.units.filter((unit) => unit.id !== unitId)), recalledUnitId: unitId };
}

export function swapPositions(state: BoardState, firstId: string, secondId: string): BoardState {
  const firstIndex = state.units.findIndex((unit) => unit.id === firstId);
  const secondIndex = state.units.findIndex((unit) => unit.id === secondId);
  if (firstIndex < 0 || secondIndex < 0 || firstIndex === secondIndex) return state;
  const first = state.units[firstIndex];
  const second = state.units[secondIndex];
  const units = [...state.units];
  units[firstIndex] = { ...first, lane: second.lane, cell: second.cell };
  units[secondIndex] = { ...second, lane: first.lane, cell: first.cell };
  return replaceUnits(state, units);
}

export function firstStrikeOrder(state: BoardState, prioritizedUnitIds: readonly string[]): readonly string[] {
  const priority = new Map(prioritizedUnitIds.map((id, index) => [id, index]));
  return state.units.filter((unit) => unit.hp > 0).slice().sort((a, b) => (
    (priority.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (priority.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    || a.lane - b.lane || a.cell - b.cell || a.id.localeCompare(b.id)
  )).map((unit) => unit.id);
}

export function reactionOrder(input: ReactionInput): readonly ReactionPlan[] {
  return [
    input.guardUnitId ? { type: 'GUARD' as const, unitId: input.guardUnitId } : undefined,
    input.counterUnitId ? { type: 'COUNTER' as const, unitId: input.counterUnitId } : undefined,
    input.reflectUnitId ? { type: 'REFLECT' as const, unitId: input.reflectUnitId } : undefined,
  ].filter((item): item is ReactionPlan => item !== undefined);
}
