import type { BoardState } from '../board/index.ts';
import type { Side, Unit } from '../types/index.ts';

export type AuraShape = 'global' | 'lane' | 'radius';
export type AuraRelation = 'friendly' | 'enemy' | 'all';
export type AuraStat = 'attack' | 'armor' | 'move' | 'range';

export interface AuraDefinition {
  readonly id: string;
  readonly sourceId: string;
  readonly shape: AuraShape;
  readonly relation?: AuraRelation;
  readonly lane?: number;
  readonly radius?: number;
  readonly stat: AuraStat;
  readonly value: number;
}

export interface AuraModifier {
  readonly auraId: string;
  readonly stat: AuraStat;
  readonly value: number;
}

export interface AuraState {
  readonly board: BoardState;
  readonly auras: readonly AuraDefinition[];
  readonly modifiers: Readonly<Record<string, readonly AuraModifier[]>>;
}

function matches(aura: AuraDefinition, source: Unit, target: Unit): boolean {
  if (aura.relation === 'friendly' && source.side !== target.side) return false;
  if (aura.relation === 'enemy' && source.side === target.side) return false;
  if (aura.shape === 'global') return true;
  if (aura.shape === 'lane') return target.lane === aura.lane;
  return target.lane === source.lane && Math.abs(target.cell - source.cell) <= (aura.radius ?? 0);
}

export function createAuraState(board: BoardState, auras: readonly AuraDefinition[] = []): AuraState {
  return refreshAuras({ board, auras: [...auras], modifiers: {} });
}

export function refreshAuras(state: AuraState): AuraState {
  const modifiers: Record<string, AuraModifier[]> = {};
  for (const target of state.board.units) {
    if (target.hp <= 0) continue;
    for (const aura of state.auras) {
      const source = state.board.units.find((unit) => unit.id === aura.sourceId && unit.hp > 0);
      if (source && matches(aura, source, target)) {
        (modifiers[target.id] ??= []).push({ auraId: aura.id, stat: aura.stat, value: aura.value });
      }
    }
  }
  for (const values of Object.values(modifiers)) values.sort((a, b) => a.auraId.localeCompare(b.auraId));
  return { ...state, modifiers };
}

export function addAura(state: AuraState, aura: AuraDefinition): AuraState {
  if (state.auras.some((item) => item.id === aura.id)) throw new Error('aura id already exists');
  if (!Number.isSafeInteger(aura.value)) throw new Error('aura value is invalid');
  return refreshAuras({ ...state, auras: [...state.auras, aura] });
}

export function removeAura(state: AuraState, auraId: string): AuraState {
  return refreshAuras({ ...state, auras: state.auras.filter((aura) => aura.id !== auraId) });
}

export function effectiveUnit(state: AuraState, unitId: string): Unit | undefined {
  const unit = state.board.units.find((candidate) => candidate.id === unitId);
  if (!unit) return undefined;
  return (state.modifiers[unitId] ?? []).reduce((current, modifier) => ({
    ...current,
    [modifier.stat]: Math.max(0, current[modifier.stat] + modifier.value),
  }), { ...unit });
}
