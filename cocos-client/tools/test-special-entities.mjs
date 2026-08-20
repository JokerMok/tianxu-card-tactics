import assert from 'node:assert/strict';

import {
  SpecialEntityConfigError,
  SpecialEntityPlacementError,
  canPlaceSpecialEntity,
  createLevelSpecialEntity,
  createSpecialEntity,
  createSpecialEntityBoardState,
  createUnitCardEntity,
  evaluateSpecialEntityPlacement,
  getSpecialEntityAtCell,
  getSpecialEntityCells,
  getSpecialEntityOccupancy,
  isSpecialEntityCellOccupied,
  moveSpecialEntity,
  placeSpecialEntity,
  removeSpecialEntity,
  validateSpecialEntityDefinition,
} from '../assets/scripts/core/board/special-entities/index.ts';
import { createBoardState, deployUnit } from '../assets/scripts/core/board/index.ts';

function unit(id, side, lane, cell, hp = 10) {
  return {
    id,
    cardId: `U-${id}`,
    name: id,
    side,
    lane,
    cell,
    hp,
    maxHp: 10,
    attack: 1,
    armor: 0,
    move: 1,
    range: 1,
    role: 'guard',
    tags: [],
    statuses: [],
    actionsTaken: 0,
    spawnRound: 1,
  };
}

const origin = { laneOffset: 0, cellOffset: 0 };
const twoByTwo = [
  origin,
  { laneOffset: 0, cellOffset: 1 },
  { laneOffset: 1, cellOffset: 0 },
  { laneOffset: 1, cellOffset: 1 },
];

const empty = createSpecialEntityBoardState(createBoardState());
const boss = createLevelSpecialEntity('boss-1', { lane: 0, cell: 4 }, twoByTwo);
assert.equal(boss.source, 'LEVEL');
assert.deepEqual(getSpecialEntityCells(boss), [
  { lane: 0, cell: 4 },
  { lane: 0, cell: 5 },
  { lane: 1, cell: 4 },
  { lane: 1, cell: 5 },
], 'a multi-cell level entity must expand from its anchor into every logical cell');
assert.deepEqual(getSpecialEntityOccupancy(boss), [
  { entityId: 'boss-1', lane: 0, cell: 4, role: 'PRIMARY' },
  { entityId: 'boss-1', lane: 0, cell: 5, role: 'PROXY' },
  { entityId: 'boss-1', lane: 1, cell: 4, role: 'PROXY' },
  { entityId: 'boss-1', lane: 1, cell: 5, role: 'PROXY' },
], 'the anchor is the primary entity and every other cell is an occupancy proxy');

let state = placeSpecialEntity(empty, boss);
assert.equal(state.entities.length, 1);
assert.equal(empty.entities.length, 0, 'placing an entity must not mutate the previous board state');
assert.equal(isSpecialEntityCellOccupied(state, 0, 4), true);
assert.equal(isSpecialEntityCellOccupied(state, 1, 5), true);
assert.equal(isSpecialEntityCellOccupied(state, 0, 6), false);
assert.equal(getSpecialEntityAtCell(state, 1, 4)?.id, 'boss-1');
assert.equal(getSpecialEntityAtCell(state, -1, 0), undefined, 'out-of-board queries must not resolve an entity');
assert.equal(Object.isFrozen(state), true, 'published special-entity state must be frozen');
assert.equal(Object.isFrozen(state.entities), true, 'published entity collections must be frozen');
assert.equal(Object.isFrozen(state.entities[0]), true, 'published entities must be frozen');
assert.equal(Object.isFrozen(state.entities[0].footprint), true, 'published footprints must be frozen');
assert.equal(Object.isFrozen(state.entities[0].footprint[0]), true, 'footprint offsets must be frozen');
assert.equal(Object.isFrozen(state.entities[0].anchor), true, 'entity anchors must be frozen');
assert.throws(() => { state.entities = []; }, TypeError, 'callers must not replace the entity collection');
assert.throws(() => { state.entities.push(boss); }, TypeError, 'callers must not append to the entity collection');
assert.throws(() => { state.entities[0].footprint = []; }, TypeError, 'callers must not replace an entity footprint');
assert.throws(() => { state.entities[0].anchor = { lane: 0, cell: 0 }; }, TypeError, 'callers must not replace an entity anchor');
assert.throws(() => { state.entities[0].footprint[0].laneOffset = 99; }, TypeError, 'callers must not mutate nested footprint coordinates');
assert.throws(() => { state.entities[0].anchor.cell = 0; }, TypeError, 'callers must not mutate nested anchor coordinates');
assert.deepEqual(getSpecialEntityCells(state.entities[0]), [
  { lane: 0, cell: 4 },
  { lane: 0, cell: 5 },
  { lane: 1, cell: 4 },
  { lane: 1, cell: 5 },
], 'mutation attempts must not alter the occupancy snapshot');
assert.equal(getSpecialEntityAtCell(state, 1, 5)?.id, 'boss-1', 'mutation attempts must not poison occupancy queries');

const singleLevelEntity = createLevelSpecialEntity('beacon', { lane: 1, cell: 10 }, [origin]);
assert.equal(getSpecialEntityCells(singleLevelEntity).length, 1, 'level entities may also occupy one cell');
assert.equal(canPlaceSpecialEntity(state, singleLevelEntity), true);

const unitCardEntity = createUnitCardEntity('card-unit-1', { lane: 0, cell: 0 });
assert.equal(unitCardEntity.source, 'UNIT_CARD');
assert.equal(unitCardEntity.footprint.length, 1, 'unit card entities stay single-cell');
assert.equal(canPlaceSpecialEntity(state, unitCardEntity), true);
assert.throws(
  () => validateSpecialEntityDefinition({
    id: 'card-unit-multi',
    source: 'UNIT_CARD',
    footprint: twoByTwo,
  }),
  (error) => error instanceof SpecialEntityConfigError && /单格/.test(error.message),
  'a unit card must not opt into a multi-cell footprint',
);

assert.throws(
  () => validateSpecialEntityDefinition({ id: 'empty', source: 'LEVEL', footprint: [] }),
  /非空数组/,
  'an entity must have at least one occupied cell',
);
const sparseFootprint = new Array(2);
sparseFootprint[0] = origin;
assert.equal(Object.prototype.hasOwnProperty.call(sparseFootprint, 1), false, 'the negative fixture must contain a real hole');
assert.throws(
  () => validateSpecialEntityDefinition({ id: 'sparse', source: 'LEVEL', footprint: sparseFootprint }),
  (error) => error instanceof SpecialEntityConfigError
    && error.configPath === 'specialEntity.footprint[1]'
    && error.message === 'specialEntity.footprint[1]: 不得包含稀疏空位',
  'sparse footprint holes must be rejected instead of skipped by map',
);
assert.throws(
  () => validateSpecialEntityDefinition({ id: 'missing-anchor', source: 'LEVEL', footprint: [{ laneOffset: 1, cellOffset: 0 }] }),
  /锚点占位/,
  'the footprint must identify the primary anchor cell',
);
assert.throws(
  () => validateSpecialEntityDefinition({ id: 'duplicate', source: 'LEVEL', footprint: [origin, origin] }),
  /重复占位/,
  'duplicate offsets would double-book the same logical cell',
);
assert.throws(
  () => validateSpecialEntityDefinition({ id: 'bad-source', source: 'CARD', footprint: [origin] }),
  /LEVEL 或 UNIT_CARD/,
  'unknown entity sources must be rejected',
);
assert.throws(
  () => validateSpecialEntityDefinition({ id: 'unknown-field', source: 'LEVEL', footprint: [origin], debug: true }),
  /未知字段/,
  'unsupported configuration fields must not be silently ignored',
);
assert.throws(
  () => createSpecialEntity({ id: 'bad-anchor', source: 'LEVEL', footprint: [origin] }, { lane: 0.5, cell: 1 }),
  /安全整数/,
  'fractional anchors are invalid board coordinates',
);

const boundaryEntity = createLevelSpecialEntity('edge', { lane: 0, cell: 11 }, [origin, { laneOffset: 0, cellOffset: 1 }]);
const boundaryCheck = evaluateSpecialEntityPlacement(empty, boundaryEntity);
assert.deepEqual(boundaryCheck, {
  ok: false,
  reason: 'OUT_OF_BOUNDS',
  cell: { lane: 0, cell: 12 },
}, 'every footprint cell must remain inside the board');
assert.throws(
  () => placeSpecialEntity(empty, boundaryEntity),
  (error) => error instanceof SpecialEntityPlacementError && error.reason === 'OUT_OF_BOUNDS',
  'out-of-bounds entities must fail placement rather than be clipped',
);

const occupiedUnitBoard = createBoardState();
const occupiedUnit = unit('occupied-unit', 'player', 0, 0);
const boardWithUnit = deployUnit(occupiedUnitBoard, occupiedUnit);
const unitCollisionEntity = createLevelSpecialEntity('unit-collision', { lane: 0, cell: 0 }, [origin, { laneOffset: 0, cellOffset: 1 }]);
const unitCollisionCheck = evaluateSpecialEntityPlacement({ board: boardWithUnit, entities: [] }, unitCollisionEntity);
assert.deepEqual(unitCollisionCheck, {
  ok: false,
  reason: 'UNIT_OCCUPIED',
  cell: { lane: 0, cell: 0 },
  conflictingId: 'occupied-unit',
}, 'a live unit must block every special-entity footprint cell');

const deadUnitBoard = deployUnit(createBoardState(), unit('dead-unit', 'player', 0, 0, 0));
const deadUnitState = createSpecialEntityBoardState(deadUnitBoard);
assert.equal(
  canPlaceSpecialEntity(deadUnitState, unitCollisionEntity),
  true,
  'dead units follow the existing board occupancy rule and do not block placement',
);

const overlap = createLevelSpecialEntity('overlap', { lane: 0, cell: 5 }, [origin]);
const overlapCheck = evaluateSpecialEntityPlacement(state, overlap);
assert.deepEqual(overlapCheck, {
  ok: false,
  reason: 'ENTITY_OCCUPIED',
  cell: { lane: 0, cell: 5 },
  conflictingId: 'boss-1',
}, 'a proxy cell must collide just like the primary entity cell');
assert.throws(
  () => placeSpecialEntity(state, overlap),
  (error) => error instanceof SpecialEntityPlacementError && error.reason === 'ENTITY_OCCUPIED',
);

const idConflict = createLevelSpecialEntity('boss-1', { lane: 0, cell: 8 }, [origin]);
assert.deepEqual(evaluateSpecialEntityPlacement(state, idConflict), {
  ok: false,
  reason: 'ID_CONFLICT',
  conflictingId: 'boss-1',
}, 'special entity ids must remain unique');
const unitIdConflict = createLevelSpecialEntity('occupied-unit', { lane: 1, cell: 8 }, [origin]);
assert.deepEqual(evaluateSpecialEntityPlacement({ board: boardWithUnit, entities: [] }, unitIdConflict), {
  ok: false,
  reason: 'ID_CONFLICT',
  conflictingId: 'occupied-unit',
}, 'entity ids must not shadow unit ids');
assert.deepEqual(evaluateSpecialEntityPlacement(empty, { malformed: true }), {
  ok: false,
  reason: 'INVALID_ENTITY',
}, 'malformed entities must produce a typed placement failure');
assert.throws(
  () => placeSpecialEntity(empty, { malformed: true }),
  (error) => error instanceof SpecialEntityPlacementError && error.reason === 'INVALID_ENTITY',
  'placing a malformed entity must fail with the same typed reason',
);
assert.throws(
  () => createSpecialEntityBoardState(createBoardState(), null),
  (error) => error instanceof SpecialEntityConfigError && /必须是数组/.test(error.message),
  'the board-state constructor must reject a malformed entity collection',
);

const moved = moveSpecialEntity(state, 'boss-1', { lane: 0, cell: 6 });
assert.equal(moved.entities[0].anchor.cell, 6);
assert.equal(state.entities[0].anchor.cell, 4, 'moving an entity must not mutate the previous state');
assert.equal(isSpecialEntityCellOccupied(moved, 1, 7), true);
assert.throws(
  () => moveSpecialEntity(moved, 'boss-1', { lane: 0, cell: 11 }),
  (error) => error instanceof SpecialEntityPlacementError && error.reason === 'OUT_OF_BOUNDS',
  'moving a multi-cell entity must re-check its whole footprint',
);
assert.equal(moved.entities[0].anchor.cell, 6, 'a failed move must leave the source state unchanged');
const stateWithBeacon = placeSpecialEntity(moved, singleLevelEntity);
assert.throws(
  () => moveSpecialEntity(stateWithBeacon, 'boss-1', { lane: 0, cell: 9 }),
  (error) => error instanceof SpecialEntityPlacementError && error.reason === 'ENTITY_OCCUPIED',
  'moving must reject collisions with another entity after removing only the moving entity from consideration',
);
const removed = removeSpecialEntity(moved, 'boss-1');
assert.equal(removed.entities.length, 0);
assert.equal(moved.entities.length, 1, 'removing an entity must not mutate the previous state');
assert.equal(isSpecialEntityCellOccupied(removed, 0, 6), false);
assert.throws(() => removeSpecialEntity(removed, 'missing'), /unknown special entity/);
assert.throws(() => moveSpecialEntity(removed, 'missing', { lane: 0, cell: 0 }), /unknown special entity/);

assert.throws(
  () => createSpecialEntityBoardState(createBoardState(), [boss, createLevelSpecialEntity('duplicate', { lane: 0, cell: 5 }, [origin])]),
  (error) => error instanceof SpecialEntityPlacementError && error.reason === 'ENTITY_OCCUPIED',
  'state construction must reject overlapping entities instead of storing an invalid board',
);
assert.throws(
  () => createSpecialEntityBoardState(createBoardState(), [boss, idConflict]),
  (error) => error instanceof SpecialEntityPlacementError && error.reason === 'ID_CONFLICT',
  'state construction must reject duplicate entity ids',
);

console.log('T223 special entities PASS: level-only multi-cell footprints, single-cell unit cards, occupancy proxies, bounds, collisions, immutable movement/removal, and invalid paths');
