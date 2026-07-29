import type { BoardState } from '../board/index.ts';
import type { Side, Unit } from '../types/index.ts';

export type AttackTarget =
  | { readonly kind: 'unit'; readonly unit: Unit; readonly distance: number }
  | { readonly kind: 'hero'; readonly side: Side; readonly distance: number };

export interface AttackAction {
  readonly attackerId: string;
  readonly target: AttackTarget;
  readonly damage: number;
}

function forwardDistance(attacker: Unit, target: Unit): number {
  return attacker.side === 'player' ? target.cell - attacker.cell : attacker.cell - target.cell;
}

export function findTarget(state: BoardState, attackerId: string): AttackTarget | undefined {
  const attacker = state.units.find((unit) => unit.id === attackerId && unit.hp > 0);
  if (!attacker) return undefined;
  const unit = state.units
    .filter((target) => target.side !== attacker.side && target.lane === attacker.lane && target.hp > 0)
    .map((target) => ({ unit: target, distance: forwardDistance(attacker, target) }))
    .filter((candidate) => candidate.distance > 0 && candidate.distance <= attacker.range)
    .sort((a, b) => a.distance - b.distance || a.unit.hp - b.unit.hp || a.unit.id.localeCompare(b.unit.id))[0];
  if (unit) return { kind: 'unit', ...unit };
  const heroDistance = attacker.side === 'player' ? state.cellsPerLane - attacker.cell : attacker.cell + 1;
  if (heroDistance <= attacker.range) return { kind: 'hero', side: attacker.side === 'player' ? 'enemy' : 'player', distance: heroDistance };
  return undefined;
}

export function createAttackAction(state: BoardState, attackerId: string): AttackAction | undefined {
  const attacker = state.units.find((unit) => unit.id === attackerId && unit.hp > 0);
  const target = findTarget(state, attackerId);
  if (!attacker || !target) return undefined;
  return { attackerId, target, damage: attacker.attack };
}

export function actionOrder(state: BoardState, side: Side): readonly string[] {
  const direction = side === 'player' ? -1 : 1;
  return state.units
    .filter((unit) => unit.side === side && unit.hp > 0)
    .slice()
    .sort((a, b) => a.lane - b.lane || direction * (a.cell - b.cell) || a.id.localeCompare(b.id))
    .map((unit) => unit.id);
}
