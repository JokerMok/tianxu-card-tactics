import type { BoardState } from '../board/index.ts';

export interface DamageResult {
  readonly state: BoardState;
  readonly damage: number;
  readonly killed: boolean;
}

export interface HealResult {
  readonly state: BoardState;
  readonly healed: number;
}

function replaceUnit(state: BoardState, unitId: string, update: (unit: BoardState['units'][number]) => BoardState['units'][number]): BoardState {
  const index = state.units.findIndex((unit) => unit.id === unitId);
  if (index < 0) return state;
  const units = [...state.units];
  units[index] = update(units[index]);
  return { ...state, units };
}

export function damageUnit(state: BoardState, unitId: string, rawDamage: number, physical = true): DamageResult {
  if (!Number.isSafeInteger(rawDamage) || rawDamage < 0) throw new Error('damage is invalid');
  const target = state.units.find((unit) => unit.id === unitId);
  if (!target) return { state, damage: 0, killed: false };
  const amount = physical ? Math.max(1, rawDamage - target.armor) : Math.max(1, rawDamage);
  const dealt = Math.min(target.hp, amount);
  const next = replaceUnit(state, unitId, (unit) => ({ ...unit, hp: Math.max(0, unit.hp - amount) }));
  return { state: next, damage: dealt, killed: target.hp > 0 && target.hp - amount <= 0 };
}

export function healUnit(state: BoardState, unitId: string, rawAmount: number): HealResult {
  if (!Number.isSafeInteger(rawAmount) || rawAmount < 0) throw new Error('healing is invalid');
  const target = state.units.find((unit) => unit.id === unitId);
  if (!target) return { state, healed: 0 };
  const healed = Math.min(rawAmount, Math.max(0, target.maxHp - target.hp));
  return { state: replaceUnit(state, unitId, (unit) => ({ ...unit, hp: unit.hp + healed })), healed };
}

export function removeDead(state: BoardState): BoardState {
  const living = state.units.filter((unit) => unit.hp > 0);
  return living.length === state.units.length ? state : { ...state, units: living };
}
