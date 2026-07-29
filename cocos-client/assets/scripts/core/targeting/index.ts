import type { BoardState } from '../board/index.ts';
import type { Side, Unit } from '../types/index.ts';

export type TargetType = 'single' | 'lane' | 'rectangle' | 'adjacent' | 'global';
export type TargetRelation = 'friendly' | 'enemy' | 'all';

export interface TargetSpec {
  readonly type: TargetType;
  readonly relation?: TargetRelation;
  readonly unitId?: string;
  readonly lane?: number;
  readonly cell?: number;
  readonly laneRadius?: number;
  readonly cellRadius?: number;
  readonly includeDead?: boolean;
}

function relationMatches(source: Unit, target: Unit, relation: TargetRelation): boolean {
  if (relation === 'all') return true;
  return relation === 'friendly' ? target.side === source.side : target.side !== source.side;
}

function stable(units: readonly Unit[]): readonly Unit[] {
  return [...units].sort((a, b) => a.lane - b.lane || a.cell - b.cell || a.id.localeCompare(b.id));
}

export function resolveTargets(state: BoardState, sourceId: string, spec: TargetSpec): readonly Unit[] {
  const source = state.units.find((unit) => unit.id === sourceId);
  if (!source) return [];
  const relation = spec.relation ?? 'enemy';
  const candidates = state.units.filter((target) => (
    (spec.includeDead || target.hp > 0) && relationMatches(source, target, relation) && target.id !== sourceId
  ));
  if (spec.type === 'single') {
    const target = candidates.find((unit) => unit.id === spec.unitId);
    return target ? [target] : [];
  }
  if (spec.type === 'lane') {
    if (!Number.isInteger(spec.lane) || spec.lane! < 0 || spec.lane! >= state.laneCount) return [];
    return stable(candidates.filter((unit) => unit.lane === spec.lane));
  }
  if (spec.type === 'rectangle') {
    if (!Number.isInteger(spec.lane) || !Number.isInteger(spec.cell)) return [];
    const laneRadius = spec.laneRadius ?? 0;
    const cellRadius = spec.cellRadius ?? 0;
    return stable(candidates.filter((unit) => Math.abs(unit.lane - spec.lane!) <= laneRadius && Math.abs(unit.cell - spec.cell!) <= cellRadius));
  }
  if (spec.type === 'adjacent') {
    const center = spec.unitId ? state.units.find((unit) => unit.id === spec.unitId) : source;
    if (!center) return [];
    const laneRadius = spec.laneRadius ?? 1;
    const cellRadius = spec.cellRadius ?? 1;
    return stable(candidates.filter((unit) => unit.id !== center.id
      && Math.abs(unit.lane - center.lane) <= laneRadius && Math.abs(unit.cell - center.cell) <= cellRadius));
  }
  return stable(candidates);
}
