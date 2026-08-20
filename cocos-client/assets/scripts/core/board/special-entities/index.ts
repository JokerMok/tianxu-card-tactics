import type { BoardState } from '../index.ts';

export type SpecialEntitySource = 'LEVEL' | 'UNIT_CARD';

export interface BoardCell {
  readonly lane: number;
  readonly cell: number;
}

export interface FootprintOffset {
  readonly laneOffset: number;
  readonly cellOffset: number;
}

export interface SpecialEntityDefinition {
  readonly id: string;
  readonly source: SpecialEntitySource;
  readonly footprint: readonly FootprintOffset[];
}

export interface SpecialEntity extends SpecialEntityDefinition {
  readonly anchor: BoardCell;
}

export interface SpecialEntityBoardState {
  readonly board: BoardState;
  readonly entities: readonly SpecialEntity[];
}

export interface SpecialEntityOccupancy {
  readonly entityId: string;
  readonly lane: number;
  readonly cell: number;
  readonly role: 'PRIMARY' | 'PROXY';
}

export type SpecialEntityPlacementFailure =
  | 'INVALID_ENTITY'
  | 'ID_CONFLICT'
  | 'OUT_OF_BOUNDS'
  | 'UNIT_OCCUPIED'
  | 'ENTITY_OCCUPIED';

export type SpecialEntityPlacement =
  | { readonly ok: true; readonly entity: SpecialEntity; readonly cells: readonly BoardCell[] }
  | {
      readonly ok: false;
      readonly reason: SpecialEntityPlacementFailure;
      readonly cell?: BoardCell;
      readonly conflictingId?: string;
    };

export class SpecialEntityConfigError extends Error {
  readonly configPath: string;

  constructor(configPath: string, message: string) {
    super(`${configPath}: ${message}`);
    this.name = 'SpecialEntityConfigError';
    this.configPath = configPath;
  }
}

export class SpecialEntityPlacementError extends Error {
  readonly reason: SpecialEntityPlacementFailure;
  readonly cell?: BoardCell;
  readonly conflictingId?: string;

  constructor(result: Exclude<SpecialEntityPlacement, { readonly ok: true }>) {
    const detail = result.cell ? ` at (${result.cell.lane},${result.cell.cell})` : '';
    const conflict = result.conflictingId ? `: ${result.conflictingId}` : '';
    super(`special entity placement failed: ${result.reason}${detail}${conflict}`);
    this.name = 'SpecialEntityPlacementError';
    this.reason = result.reason;
    this.cell = result.cell;
    this.conflictingId = result.conflictingId;
  }
}

function record(value: unknown, configPath: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new SpecialEntityConfigError(configPath, '必须是对象');
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, required: readonly string[], configPath: string): void {
  const allowed = new Set(required);
  for (const key of required) {
    if (!(key in value)) throw new SpecialEntityConfigError(`${configPath}.${key}`, '缺少字段');
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new SpecialEntityConfigError(`${configPath}.${key}`, '未知字段');
  }
}

function nonEmptyString(value: unknown, configPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SpecialEntityConfigError(configPath, '必须是非空字符串');
  }
  return value;
}

function safeInteger(value: unknown, configPath: string): number {
  if (!Number.isSafeInteger(value)) throw new SpecialEntityConfigError(configPath, '必须是安全整数');
  return value as number;
}

function parseOffset(value: unknown, configPath: string): FootprintOffset {
  const offset = record(value, configPath);
  exactKeys(offset, ['laneOffset', 'cellOffset'], configPath);
  return {
    laneOffset: safeInteger(offset.laneOffset, `${configPath}.laneOffset`),
    cellOffset: safeInteger(offset.cellOffset, `${configPath}.cellOffset`),
  };
}

function compareOffsets(a: FootprintOffset, b: FootprintOffset): number {
  if (a.laneOffset !== b.laneOffset) return a.laneOffset - b.laneOffset;
  return a.cellOffset - b.cellOffset;
}

function normalizeFootprint(value: unknown, configPath: string, source: SpecialEntitySource): FootprintOffset[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SpecialEntityConfigError(configPath, '必须是非空数组');
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new SpecialEntityConfigError(`${configPath}[${index}]`, '不得包含稀疏空位');
    }
  }
  const footprint: FootprintOffset[] = [];
  for (let index = 0; index < value.length; index += 1) {
    footprint.push(parseOffset(value[index], `${configPath}[${index}]`));
  }
  const keys = footprint.map(({ laneOffset, cellOffset }) => `${laneOffset}:${cellOffset}`);
  if (new Set(keys).size !== keys.length) {
    throw new SpecialEntityConfigError(configPath, '不得包含重复占位');
  }
  if (!keys.includes('0:0')) {
    throw new SpecialEntityConfigError(configPath, '必须包含锚点占位 (0,0)');
  }
  if (source === 'UNIT_CARD' && footprint.length !== 1) {
    throw new SpecialEntityConfigError(configPath, '单位卡实体必须固定占用单格');
  }
  const origin = footprint.find(({ laneOffset, cellOffset }) => laneOffset === 0 && cellOffset === 0)!;
  return [origin, ...footprint.filter((item) => item !== origin).sort(compareOffsets)];
}

function parseSource(value: unknown, configPath: string): SpecialEntitySource {
  if (value !== 'LEVEL' && value !== 'UNIT_CARD') {
    throw new SpecialEntityConfigError(configPath, '必须是 LEVEL 或 UNIT_CARD');
  }
  return value;
}

function parseAnchor(value: unknown, configPath: string): BoardCell {
  const anchor = record(value, configPath);
  exactKeys(anchor, ['lane', 'cell'], configPath);
  return {
    lane: safeInteger(anchor.lane, `${configPath}.lane`),
    cell: safeInteger(anchor.cell, `${configPath}.cell`),
  };
}

function immutableSpecialEntity(entity: SpecialEntity): SpecialEntity {
  return Object.freeze({
    id: entity.id,
    source: entity.source,
    footprint: Object.freeze(entity.footprint.map(({ laneOffset, cellOffset }) => Object.freeze({
      laneOffset,
      cellOffset,
    }))),
    anchor: Object.freeze({ lane: entity.anchor.lane, cell: entity.anchor.cell }),
  });
}

function immutableSpecialEntityState(state: SpecialEntityBoardState): SpecialEntityBoardState {
  return Object.freeze({
    ...state,
    entities: Object.freeze(state.entities.map(immutableSpecialEntity)),
  });
}

export function validateSpecialEntityDefinition(value: unknown, configPath = 'specialEntity'): SpecialEntityDefinition {
  const root = record(value, configPath);
  exactKeys(root, ['id', 'source', 'footprint'], configPath);
  const source = parseSource(root.source, `${configPath}.source`);
  return {
    id: nonEmptyString(root.id, `${configPath}.id`),
    source,
    footprint: normalizeFootprint(root.footprint, `${configPath}.footprint`, source),
  };
}

export function validateSpecialEntity(value: unknown, configPath = 'specialEntity'): SpecialEntity {
  const root = record(value, configPath);
  exactKeys(root, ['id', 'source', 'footprint', 'anchor'], configPath);
  const definition = validateSpecialEntityDefinition(
    { id: root.id, source: root.source, footprint: root.footprint },
    configPath,
  );
  return { ...definition, anchor: parseAnchor(root.anchor, `${configPath}.anchor`) };
}

export function createSpecialEntity(definition: unknown, anchor: unknown): SpecialEntity {
  const parsed = validateSpecialEntityDefinition(definition);
  return immutableSpecialEntity({ ...parsed, anchor: parseAnchor(anchor, 'specialEntity.anchor') });
}

export function createLevelSpecialEntity(
  id: string,
  anchor: BoardCell,
  footprint: readonly FootprintOffset[],
): SpecialEntity {
  return createSpecialEntity({ id, source: 'LEVEL', footprint }, anchor);
}

export function createUnitCardEntity(id: string, anchor: BoardCell): SpecialEntity {
  return createSpecialEntity({
    id,
    source: 'UNIT_CARD',
    footprint: [{ laneOffset: 0, cellOffset: 0 }],
  }, anchor);
}

export function getSpecialEntityCells(entityInput: SpecialEntity): readonly BoardCell[] {
  const entity = validateSpecialEntity(entityInput);
  return entity.footprint.map(({ laneOffset, cellOffset }) => ({
    lane: entity.anchor.lane + laneOffset,
    cell: entity.anchor.cell + cellOffset,
  }));
}

export function getSpecialEntityOccupancy(entityInput: SpecialEntity): readonly SpecialEntityOccupancy[] {
  const entity = validateSpecialEntity(entityInput);
  return getSpecialEntityCells(entity).map((cell, index) => ({
    entityId: entity.id,
    lane: cell.lane,
    cell: cell.cell,
    role: index === 0 ? 'PRIMARY' : 'PROXY',
  }));
}

function isInBounds(board: BoardState, cell: BoardCell): boolean {
  return Number.isInteger(cell.lane)
    && cell.lane >= 0
    && cell.lane < board.laneCount
    && Number.isInteger(cell.cell)
    && cell.cell >= 0
    && cell.cell < board.cellsPerLane;
}

function sameCell(a: BoardCell, b: BoardCell): boolean {
  return a.lane === b.lane && a.cell === b.cell;
}

function entityAtCell(entities: readonly SpecialEntity[], cell: BoardCell): SpecialEntity | undefined {
  return entities.find((entity) => getSpecialEntityCells(entity).some((occupied) => sameCell(occupied, cell)));
}

export function evaluateSpecialEntityPlacement(
  state: SpecialEntityBoardState,
  entityInput: unknown,
): SpecialEntityPlacement {
  let entity: SpecialEntity;
  try {
    entity = validateSpecialEntity(entityInput);
  } catch {
    return { ok: false, reason: 'INVALID_ENTITY' };
  }

  if (state.entities.some((candidate) => candidate.id === entity.id)
    || state.board.units.some((unit) => unit.id === entity.id)) {
    return { ok: false, reason: 'ID_CONFLICT', conflictingId: entity.id };
  }

  const cells = getSpecialEntityCells(entity);
  const outOfBounds = cells.find((cell) => !isInBounds(state.board, cell));
  if (outOfBounds) return { ok: false, reason: 'OUT_OF_BOUNDS', cell: outOfBounds };

  for (const cell of cells) {
    const unit = state.board.units.find((candidate) => (
      candidate.hp > 0 && candidate.lane === cell.lane && candidate.cell === cell.cell
    ));
    if (unit) return { ok: false, reason: 'UNIT_OCCUPIED', cell, conflictingId: unit.id };
    const occupant = entityAtCell(state.entities, cell);
    if (occupant) return { ok: false, reason: 'ENTITY_OCCUPIED', cell, conflictingId: occupant.id };
  }
  return { ok: true, entity, cells };
}

export function canPlaceSpecialEntity(state: SpecialEntityBoardState, entityInput: unknown): boolean {
  return evaluateSpecialEntityPlacement(state, entityInput).ok;
}

export function placeSpecialEntity(state: SpecialEntityBoardState, entityInput: unknown): SpecialEntityBoardState {
  const placement = evaluateSpecialEntityPlacement(state, entityInput);
  if (!placement.ok) throw new SpecialEntityPlacementError(placement);
  return immutableSpecialEntityState({ ...state, entities: [...state.entities, placement.entity] });
}

export function createSpecialEntityBoardState(
  board: BoardState,
  entities: readonly unknown[] = [],
): SpecialEntityBoardState {
  if (!Array.isArray(entities)) throw new SpecialEntityConfigError('entities', '必须是数组');
  let state: SpecialEntityBoardState = immutableSpecialEntityState({ board, entities: [] });
  for (const entity of entities) state = placeSpecialEntity(state, entity);
  return state;
}

export function isSpecialEntityCellOccupied(state: SpecialEntityBoardState, lane: number, cell: number): boolean {
  return getSpecialEntityAtCell(state, lane, cell) !== undefined;
}

export function getSpecialEntityAtCell(
  state: SpecialEntityBoardState,
  lane: number,
  cell: number,
): SpecialEntity | undefined {
  if (!isInBounds(state.board, { lane, cell })) return undefined;
  return entityAtCell(state.entities, { lane, cell });
}

export function removeSpecialEntity(state: SpecialEntityBoardState, entityId: string): SpecialEntityBoardState {
  const entity = state.entities.find((candidate) => candidate.id === entityId);
  if (!entity) throw new Error(`unknown special entity: ${entityId}`);
  return immutableSpecialEntityState({
    ...state,
    entities: state.entities.filter((candidate) => candidate.id !== entityId),
  });
}

export function moveSpecialEntity(
  state: SpecialEntityBoardState,
  entityId: string,
  anchor: unknown,
): SpecialEntityBoardState {
  const current = state.entities.find((candidate) => candidate.id === entityId);
  if (!current) throw new Error(`unknown special entity: ${entityId}`);
  const moved = { ...current, anchor: parseAnchor(anchor, 'specialEntity.anchor') };
  const withoutCurrent = { ...state, entities: state.entities.filter((candidate) => candidate.id !== entityId) };
  const placement = evaluateSpecialEntityPlacement(withoutCurrent, moved);
  if (!placement.ok) throw new SpecialEntityPlacementError(placement);
  return immutableSpecialEntityState({
    ...state,
    entities: state.entities.map((candidate) => candidate.id === entityId ? placement.entity : candidate),
  });
}
