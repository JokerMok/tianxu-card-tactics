import assert from 'node:assert/strict';
import { createBattleState } from '../../core/types/index.ts';
import { BattleStateView, createCocosBattleNodeFactory } from './battle-state-view.ts';

function makeUnit(overrides = {}) {
  return {
    id: 'unit-1',
    cardId: 'U001',
    name: 'Guard',
    side: 'player',
    lane: 0,
    cell: 2,
    hp: 8,
    maxHp: 10,
    attack: 2,
    armor: 1,
    move: 1,
    range: 1,
    role: 'guard',
    tags: ['frontline'],
    statuses: [{ id: 'burn-1', kind: 'burn', stacks: 2, remainingRounds: 1 }],
    actionsTaken: 0,
    spawnRound: 1,
    ...overrides,
  };
}

function makeState(units) {
  return createBattleState({
    revision: 1,
    seed: 7,
    rngState: 7,
    rngCursor: 0,
    round: 1,
    turn: 1,
    maxRounds: 80,
    laneCount: 2,
    cellsPerLane: 12,
    summonDepth: 3,
    openingInitiative: 'player',
    activeSide: 'player',
    heroHp: { player: 30, enemy: 30 },
    heroMaxHp: { player: 30, enemy: 30 },
    decks: { player: [], enemy: [] },
    hands: { player: [], enemy: [] },
    graveyards: { player: [], enemy: [] },
    units,
    events: [],
    status: 'playing',
    nextId: 2,
    nextEventId: 1,
  });
}

function makeNodeFactory() {
  const root = { children: [] };
  const created = [];
  const destroyed = [];
  return {
    root,
    created,
    destroyed,
    createUnitNode(unit, parent) {
      const node = {
        name: `unit-${unit.id}`,
        parent,
        state: undefined,
        destroyed: false,
        apply(next) { this.state = next; },
        destroy() {
          this.destroyed = true;
          destroyed.push(this);
          const index = parent.children.indexOf(this);
          if (index >= 0) parent.children.splice(index, 1);
        },
      };
      parent.children.push(node);
      created.push(node);
      return node;
    },
  };
}

function makeTransactionalFactory({ failCreateId, failApplyId } = {}) {
  const root = { children: [] };
  const created = [];
  const destroyed = [];
  return {
    root,
    created,
    destroyed,
    createUnitNode(unit, parent) {
      if (unit.id === failCreateId) throw new Error(`create failed: ${unit.id}`);
      const node = {
        unitId: unit.id,
        parent,
        state: undefined,
        apply(next) {
          if (next.id === failApplyId) throw new Error(`apply failed: ${next.id}`);
          this.state = next;
        },
        destroy() {
          this.destroyed = true;
          destroyed.push(this);
          const index = parent.children.indexOf(this);
          if (index >= 0) parent.children.splice(index, 1);
        },
      };
      parent.children.push(node);
      created.push(node);
      return node;
    },
  };
}

const factory = makeNodeFactory();
const view = new BattleStateView({ root: factory.root, factory });
const first = makeState([
  makeUnit(),
  makeUnit({ id: 'unit-2', side: 'enemy', lane: 1, cell: 9, hp: 4, statuses: [] }),
]);

const firstSync = view.sync(first);
assert.equal(firstSync.created, 2);
assert.equal(firstSync.updated, 0);
assert.equal(firstSync.removed, 0);
assert.equal(factory.root.children.length, 2);
assert.deepEqual(factory.root.children.map((node) => node.state.id).sort(), ['unit-1', 'unit-2']);
assert.equal(factory.root.children.find((node) => node.state.id === 'unit-1').state.side, 'player');
assert.equal(factory.root.children.find((node) => node.state.id === 'unit-2').state.lane, 1);
assert.equal(factory.root.children.find((node) => node.state.id === 'unit-1').state.cell, 2);
assert.equal(factory.root.children.find((node) => node.state.id === 'unit-1').state.hp, 8);
assert.deepEqual(factory.root.children.find((node) => node.state.id === 'unit-1').state.statuses, first.units[0].statuses);

const unitOneNode = factory.root.children.find((node) => node.state.id === 'unit-1');
const createdBeforeRepeat = factory.created.length;
const repeatSync = view.sync(first);
assert.equal(repeatSync.created, 0);
assert.equal(repeatSync.updated, 0);
assert.equal(repeatSync.removed, 0);
assert.equal(factory.created.length, createdBeforeRepeat);
assert.strictEqual(factory.root.children.find((node) => node.state.id === 'unit-1'), unitOneNode);

const second = makeState([
  makeUnit({ hp: 3, lane: 1, cell: 4, statuses: [{ id: 'shield-1', kind: 'shield', stacks: 1, value: 2 }] }),
  makeUnit({ id: 'unit-3', side: 'enemy', lane: 0, cell: 10, hp: 6, statuses: [] }),
]);
const secondSync = view.sync(second);
assert.equal(secondSync.created, 1);
assert.equal(secondSync.updated, 1);
assert.equal(secondSync.removed, 1);
assert.equal(factory.root.children.length, 2);
assert.equal(unitOneNode.state.lane, 1);
assert.equal(unitOneNode.state.cell, 4);
assert.equal(unitOneNode.state.hp, 3);
assert.deepEqual(unitOneNode.state.statuses, second.units[0].statuses);
assert.equal(factory.destroyed.length, 1);
assert.equal(factory.destroyed[0].state.id, 'unit-2');

const unknown = makeUnit({ id: 'unknown-entity', cardId: 'UNLISTED', side: 'enemy', lane: 1, cell: 11 });
const third = makeState([unknown]);
view.sync(third);
assert.equal(factory.root.children.length, 1);
assert.equal(factory.root.children[0].state.id, 'unknown-entity');
assert.equal(factory.root.children[0].state.cardId, 'UNLISTED');

assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.units[0]), true);
assert.equal(Object.isFrozen(factory.root.children[0].state), true);
assert.equal(Object.isFrozen(factory.root.children[0].state.statuses), true);
assert.throws(() => {
  factory.root.children[0].state.hp = 99;
}, TypeError);

assert.throws(() => view.sync({ ...third, units: [...third.units, unknown] }), /duplicate unit id/);
assert.equal(factory.root.children.length, 1);

const createFailureFactory = makeTransactionalFactory({ failCreateId: 'create-fail-2' });
const createFailureView = new BattleStateView({ root: createFailureFactory.root, factory: createFailureFactory });
createFailureView.sync(makeState([
  makeUnit({ id: 'create-old-1' }),
  makeUnit({ id: 'create-old-2', side: 'enemy' }),
]));
const createFailureNodes = [...createFailureView.nodes];
const createFailureStates = createFailureNodes.map((node) => node.state);
assert.throws(() => createFailureView.sync(makeState([
  makeUnit({ id: 'create-old-1', hp: 1 }),
  makeUnit({ id: 'create-old-2', side: 'enemy', cell: 8 }),
  makeUnit({ id: 'create-temp-1' }),
  makeUnit({ id: 'create-fail-2' }),
])), /create failed: create-fail-2/);
assert.deepEqual(createFailureView.nodes, createFailureNodes);
assert.deepEqual(createFailureView.nodes.map((node) => node.state), createFailureStates);
assert.equal(createFailureView.unitCount, 2);
assert.deepEqual(createFailureView.nodes.map((node) => node.state.id), ['create-old-1', 'create-old-2']);
assert.equal(createFailureFactory.destroyed.length, 1);
assert.equal(createFailureFactory.destroyed[0].unitId, 'create-temp-1');
assert.equal(createFailureFactory.root.children.includes(createFailureFactory.destroyed[0]), false);

const applyFailureFactory = makeTransactionalFactory({ failApplyId: 'apply-fail-new' });
const applyFailureView = new BattleStateView({ root: applyFailureFactory.root, factory: applyFailureFactory });
applyFailureView.sync(makeState([
  makeUnit({ id: 'apply-old-1', hp: 9 }),
  makeUnit({ id: 'apply-old-2', side: 'enemy', cell: 9 }),
]));
const applyFailureNodes = [...applyFailureView.nodes];
const applyFailureStates = applyFailureNodes.map((node) => node.state);
assert.throws(() => applyFailureView.sync(makeState([
  makeUnit({ id: 'apply-old-1', hp: 2, lane: 1, cell: 5 }),
  makeUnit({ id: 'apply-old-2', side: 'enemy', cell: 10 }),
  makeUnit({ id: 'apply-fail-new' }),
])), /apply failed: apply-fail-new/);
assert.deepEqual(applyFailureView.nodes, applyFailureNodes);
assert.deepEqual(applyFailureView.nodes.map((node) => node.state), applyFailureStates);
assert.equal(applyFailureView.unitCount, 2);
assert.deepEqual(applyFailureView.nodes.map((node) => node.state.id), ['apply-old-1', 'apply-old-2']);
assert.equal(applyFailureNodes[0].state.hp, 9);
assert.equal(applyFailureNodes[0].state.lane, 0);
assert.equal(applyFailureFactory.destroyed.length, 1);
assert.equal(applyFailureFactory.destroyed[0].unitId, 'apply-fail-new');

const cocosRoot = { children: [] };
const cocosNodes = [];
const applied = [];
const cocosFactory = createCocosBattleNodeFactory({
  parent: cocosRoot,
  createNode(name) {
    const node = {
      name,
      active: false,
      parent: null,
      position: null,
      setParent(parent) { this.parent = parent; parent.children.push(this); },
      setPosition(x, y, z) { this.position = { x, y, z }; },
      destroy() { this.destroyed = true; },
    };
    cocosNodes.push(node);
    return node;
  },
  getPosition(unit) { return { x: unit.cell * 10, y: unit.lane * -20, z: 0 }; },
  applyState(node, state) { applied.push({ node, state }); },
});
const cocosView = new BattleStateView({ root: cocosRoot, factory: cocosFactory });
cocosView.sync(makeState([makeUnit({ id: 'cocos-unit', lane: 1, cell: 6, hp: 5 })]));
assert.equal(cocosNodes.length, 1);
assert.equal(cocosNodes[0].name, 'BattleUnit-cocos-unit');
assert.equal(cocosNodes[0].parent, cocosRoot);
assert.deepEqual(cocosNodes[0].position, { x: 60, y: -20, z: 0 });
assert.equal(cocosNodes[0].active, true);
assert.equal(applied.length, 1);
assert.equal(cocosView.nodes[0].state.hp, 5);

const defaultCocosRoot = { children: [] };
const defaultCocosFactory = createCocosBattleNodeFactory({
  parent: defaultCocosRoot,
  createNode(name) {
    return {
      name,
      active: false,
      parent: null,
      position: null,
      setParent(parent) { this.parent = parent; parent.children.push(this); },
      setPosition(x, y, z) { this.position = { x, y, z }; },
      destroy() { this.destroyed = true; },
    };
  },
});
const defaultCocosView = new BattleStateView({ root: defaultCocosRoot, factory: defaultCocosFactory });
const defaultCocosState = makeState([makeUnit({
  id: 'default-cocos-unit',
  side: 'enemy',
  lane: 1,
  cell: 7,
  hp: 4,
  maxHp: 12,
  statuses: [{ id: 'stun-1', kind: 'stun', stacks: 1, remainingRounds: 2 }],
})]);
defaultCocosView.sync(defaultCocosState);
const defaultCocosNode = defaultCocosRoot.children[0];
assert.equal(defaultCocosNode.battleUnitId, 'default-cocos-unit');
assert.equal(defaultCocosNode.battleSide, 'enemy');
assert.equal(defaultCocosNode.battleLane, 1);
assert.equal(defaultCocosNode.battleCell, 7);
assert.equal(defaultCocosNode.battleHp, 4);
assert.equal(defaultCocosNode.battleMaxHp, 12);
assert.deepEqual(defaultCocosNode.battleStatuses, defaultCocosState.units[0].statuses);
assert.equal(Object.isFrozen(defaultCocosNode.battleUnitState), true);
assert.equal(Object.isFrozen(defaultCocosNode.battleStatuses), true);
assert.equal(defaultCocosNode.battleUnitState.side, defaultCocosState.units[0].side);
assert.equal(defaultCocosNode.battleUnitState.hp, defaultCocosState.units[0].hp);

console.log('BattleState view binding contract: PASS');
