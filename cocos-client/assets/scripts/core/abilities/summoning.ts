import { isOccupied, isSummonCell, type BoardState } from '../board/index.ts';
import type { Side, Unit } from '../types/index.ts';

export interface SummonState {
  readonly board: BoardState;
  readonly graveyard: Readonly<Record<Side, readonly Unit[]>>;
  readonly maxActiveBySide: Readonly<Record<Side, number>>;
}

export interface ReclaimResult { readonly state: SummonState; readonly cardId?: string; }

function update(state: SummonState, board: BoardState, graveyard = state.graveyard): SummonState {
  return { ...state, board, graveyard: { player: [...graveyard.player], enemy: [...graveyard.enemy] } };
}

function activeCount(state: SummonState, side: Side): number {
  return state.board.units.filter((unit) => unit.side === side && unit.hp > 0).length;
}

export function createSummonState(board: BoardState, maxActiveBySide: Readonly<Record<Side, number>> = { player: 6, enemy: 6 }): SummonState {
  if (![maxActiveBySide.player, maxActiveBySide.enemy].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error('summon limit is invalid');
  return { board, graveyard: { player: [], enemy: [] }, maxActiveBySide: { ...maxActiveBySide } };
}

export function summonUnit(state: SummonState, unit: Unit): SummonState {
  if (activeCount(state, unit.side) >= state.maxActiveBySide[unit.side]) throw new Error('summon limit reached');
  if (!isSummonCell(unit.side, unit.lane, unit.cell) || isOccupied(state.board, unit.lane, unit.cell)) throw new Error('summon position is invalid');
  if (state.board.units.some((candidate) => candidate.id === unit.id) || state.graveyard.player.some((candidate) => candidate.id === unit.id) || state.graveyard.enemy.some((candidate) => candidate.id === unit.id)) throw new Error('unit id already exists');
  return update(state, { ...state.board, units: [...state.board.units, unit] });
}

export function killUnit(state: SummonState, unitId: string): SummonState {
  const target = state.board.units.find((unit) => unit.id === unitId);
  if (!target) return state;
  const board = { ...state.board, units: state.board.units.filter((unit) => unit.id !== unitId) };
  const graveyard = { ...state.graveyard, [target.side]: [...state.graveyard[target.side], { ...target, hp: 0 }] } as Record<Side, readonly Unit[]>;
  return update(state, board, graveyard);
}

export function reviveUnit(state: SummonState, unitId: string, lane: number, cell: number): SummonState {
  const side: Side = state.graveyard.player.some((unit) => unit.id === unitId) ? 'player' : 'enemy';
  const index = state.graveyard[side].findIndex((unit) => unit.id === unitId);
  if (index < 0) return state;
  if (activeCount(state, side) >= state.maxActiveBySide[side]) throw new Error('summon limit reached');
  if (!isSummonCell(side, lane, cell) || isOccupied(state.board, lane, cell)) throw new Error('revive position is invalid');
  const original = state.graveyard[side][index];
  const revived = { ...original, lane, cell, hp: original.maxHp };
  const graveyard = { ...state.graveyard, [side]: state.graveyard[side].filter((unit) => unit.id !== unitId) } as Record<Side, readonly Unit[]>;
  return update(state, { ...state.board, units: [...state.board.units, revived] }, graveyard);
}

export function reclaimGraveyard(state: SummonState, unitId: string): ReclaimResult {
  const side: Side = state.graveyard.player.some((unit) => unit.id === unitId) ? 'player' : 'enemy';
  const target = state.graveyard[side].find((unit) => unit.id === unitId);
  if (!target) return { state };
  const graveyard = { ...state.graveyard, [side]: state.graveyard[side].filter((unit) => unit.id !== unitId) } as Record<Side, readonly Unit[]>;
  return { state: update(state, state.board, graveyard), cardId: target.cardId };
}
