import assert from 'node:assert/strict';
import { createBattleState } from '../../core/types/index.ts';
import { BattleHandView, createCocosBattleHandNodeFactory } from './battle-hand-view.ts';

function makeCard(instanceId, cardId = 'U001', remainingPreparation = 0) {
  return { instanceId, cardId, remainingPreparation };
}

function makeState(playerCards = [], enemyCards = [], graveyards = { player: [], enemy: [] }) {
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
    hands: { player: playerCards, enemy: enemyCards },
    graveyards,
    units: [],
    events: [],
    status: 'playing',
    nextId: 2,
    nextEventId: 1,
  });
}

function makeFactory() {
  const root = { children: [] };
  const created = [];
  const destroyed = [];
  return {
    root,
    created,
    destroyed,
    createCardNode(card, parent) {
      const node = {
        parent,
        state: undefined,
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

const factory = makeFactory();
const view = new BattleHandView({ root: factory.root, side: 'player', factory });
const first = makeState([
  makeCard('card-1', 'U001', 0),
  makeCard('card-2', 'S001', 2),
]);

const firstSync = view.sync(first, { selectedCardId: 'card-1' });
assert.deepEqual(firstSync, { created: 2, updated: 0, unchanged: 0, removed: 0, discarded: 0, cardCount: 2 });
assert.equal(factory.root.children[0].state.available, true);
assert.equal(factory.root.children[0].state.selected, true);
assert.equal(factory.root.children[0].state.disabled, false);
assert.equal(factory.root.children[1].state.remainingPreparation, 2);
assert.equal(factory.root.children[1].state.available, false);
assert.equal(factory.root.children[1].state.disabled, true);
assert.equal(Object.isFrozen(factory.root.children[0].state), true);

const firstNode = factory.root.children[0];
const repeat = view.sync(first, { selectedCardId: 'card-1' });
assert.deepEqual(repeat, { created: 0, updated: 0, unchanged: 2, removed: 0, discarded: 0, cardCount: 2 });
assert.strictEqual(factory.root.children[0], firstNode);

const second = makeState(
  [makeCard('card-1', 'U001', 1), makeCard('card-3', 'U002', 0)],
  [],
  { player: ['U001'], enemy: [] },
);
const secondSync = view.sync(second, { selectedCardId: 'card-3' });
assert.deepEqual(secondSync, { created: 1, updated: 1, unchanged: 0, removed: 1, discarded: 1, cardCount: 2 });
assert.equal(factory.root.children.length, 2);
assert.equal(factory.root.children.find((node) => node.state.instanceId === 'card-1').state.selected, false);
assert.equal(factory.root.children.find((node) => node.state.instanceId === 'card-3').state.selected, true);
assert.equal(factory.destroyed.length, 1);

const beforeInvalid = [...view.nodes];
assert.throws(() => view.sync(makeState([
  makeCard('card-1', 'U001', 1),
  makeCard('card-1', 'U002', 0),
])), /duplicate card instanceId/);
assert.deepEqual(view.nodes, beforeInvalid);
assert.throws(() => view.sync(makeState([
  makeCard('card-1', 'U001', -1),
])), /remainingPreparation/);
assert.deepEqual(view.nodes, beforeInvalid);

const cocosRoot = { children: [] };
const cocosView = new BattleHandView({
  root: cocosRoot,
  side: 'player',
  factory: createCocosBattleHandNodeFactory({
    parent: cocosRoot,
    createNode(name) {
      return {
        name,
        active: false,
        setParent(parent) { this.parent = parent; parent.children.push(this); },
        setPosition(x, y, z) { this.position = { x, y, z }; },
        destroy() { this.destroyed = true; },
      };
    },
    getPosition(card, index) { return { x: index * 10, y: 0, z: 0 }; },
  }),
});
cocosView.sync(makeState([makeCard('cocos-card', 'U001', 0)]));
assert.equal(cocosRoot.children[0].battleCardInstanceId, 'cocos-card');
assert.equal(cocosRoot.children[0].battleAvailable, true);
assert.equal(cocosRoot.children[0].battleDisabled, false);
assert.equal(Object.isFrozen(cocosRoot.children[0].battleCardState), true);

console.log('BattleHand view binding contract: PASS');
