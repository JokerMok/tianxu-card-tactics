import assert from 'node:assert/strict';
import test from 'node:test';
import { BattlePresentation } from './BattlePresentation.ts';

const unit = (id, playerId, team, row, col, hp = 5, flags = {}) => ({
  id, playerId, team, cardId: `card:${id}`, monsterId: 1, row, col, hp, maxHp: 5,
  attack: 2, range: 1, movement: 1, statuses: [], effects: [], summonedTurn: 1, flags,
});

const player = (id, team, hp = 20) => ({
  id, name: id, team, hp, maxHp: hp, deck: [], drawPile: [], hand: [], graveyard: [],
  fatigue: 0, row: 0, surrendered: false,
});

function state(overrides = {}) {
  return {
    version: 1, id: 'battle-1', seed: 1, rng: 1, turn: 1, revision: 0,
    activePlayer: 0, mapId: 1, columns: 12, rows: 4,
    players: [player('p0', 0), player('p1', 1)],
    units: [unit('a', 'p0', 0, 0, 1), unit('b', 'p1', 1, 0, 6)],
    events: [], status: 'playing', winner: null, nextId: 3,
    ...overrides,
  };
}

const withViews = (event, units) => ({
  ...event,
  ...(event.actor && units[event.actor] ? { actorView: structuredClone(units[event.actor]) } : {}),
  ...(event.target && units[event.target] ? { targetView: structuredClone(units[event.target]) } : {}),
});

test('bootstrap and explicit refresh establish a baseline without replaying event history', () => {
  const presenter = new BattlePresentation();
  const initial = state({ revision: 4, events: [{ seq: 8, type: 'turn-start' }] });
  assert.equal(presenter.bootstrap(initial).mode, 'baseline');
  assert.equal(presenter.nextStep(), undefined);
  assert.equal(presenter.visibleState.revision, 4);

  const refreshed = state({ revision: 9, turn: 5, events: [{ seq: 20, type: 'turn-start' }] });
  assert.equal(presenter.sync(refreshed, { baseline: true }).mode, 'baseline');
  assert.equal(presenter.visibleState.turn, 5);
  assert.equal(presenter.locked, false);
});

test('a newly discovered PVE battle queues AI opening events after its entry baseline', () => {
  const presenter = new BattlePresentation();
  const entry = state({ events: [
    { seq: 1, type: 'battle-start', amount: 1 },
    { seq: 2, type: 'turn-start', actor: 'p1' },
  ] });
  assert.equal(presenter.sync(entry, { baseline: true }).mode, 'baseline');

  const damagedA = unit('a', 'p0', 0, 0, 1, 3);
  const current = state({ revision: 1, units: [damagedA, entry.units[1]], events: [
    ...entry.events,
    withViews({ seq: 3, type: 'attack', actor: 'b', target: 'a', amount: 2 }, { a: damagedA, b: entry.units[1] }),
    withViews({ seq: 4, type: 'damage', actor: 'b', target: 'a', amount: 2, effectiveAmount: 2, hpBefore: 5, hpAfter: 3 }, { a: damagedA, b: entry.units[1] }),
  ] });
  const synced = presenter.sync(current);
  assert.equal(synced.mode, 'queued');
  assert.equal(synced.acceptedEvents, 2);
  assert.equal(presenter.visibleState.units.find(value => value.id === 'a').hp, 5);
  const attack = presenter.nextStep();
  assert.equal(attack.kind, 'attack');
  assert.equal(presenter.cue(attack.token, 'impact'), true);
  assert.equal(presenter.visibleState.units.find(value => value.id === 'a').hp, 3);
});

test('move, real attack impact, death completion, and settlement advance visible state in order', () => {
  const presenter = new BattlePresentation();
  presenter.bootstrap(state());
  const movedA = unit('a', 'p0', 0, 0, 5);
  const deadB = unit('b', 'p1', 1, 0, 6, 0);
  const units = { a: movedA, b: deadB };
  const events = [
    withViews({ seq: 1, type: 'move', actor: 'a', row: 0, col: 5, moveFrom: { row: 0, col: 1 }, moveTo: { row: 0, col: 5 } }, units),
    withViews({ seq: 2, type: 'attack', actor: 'a', target: 'b', amount: 5 }, units),
    withViews({ seq: 3, type: 'damage', actor: 'a', target: 'b', amount: 5, effectiveAmount: 5, hpBefore: 5, hpAfter: 0 }, units),
    withViews({ seq: 4, type: 'death', actor: 'b', row: 0, col: 6 }, units),
    { seq: 5, type: 'settled', amount: 0 },
  ];
  const final = state({ revision: 1, status: 'settled', winner: 0, units: [movedA], events });
  assert.equal(presenter.sync(final).mode, 'queued');
  assert.equal(presenter.visibleState.units.find(value => value.id === 'a').col, 1, 'authoritative final position is not shown early');
  assert.equal(presenter.visibleState.units.find(value => value.id === 'b').hp, 5, 'authoritative final HP is not shown early');

  const move = presenter.nextStep();
  assert.equal(move.kind, 'move');
  assert.deepEqual(move.moveFrom, { row: 0, col: 1 });
  assert.deepEqual(move.moveTo, { row: 0, col: 5 });
  assert.equal(presenter.complete(move.token), true);
  assert.equal(presenter.visibleState.units.find(value => value.id === 'a').col, 5);

  const attack = presenter.nextStep();
  assert.equal(attack.kind, 'attack');
  assert.deepEqual(attack.events.map(event => event.type), ['attack', 'damage']);
  assert.deepEqual(attack.hpChanges.map(change => [change.before, change.after]), [[5, 0]]);
  assert.equal(presenter.complete(attack.token), false, 'attack cannot skip its real impact cue');
  assert.equal(presenter.cue(attack.token, 'impact'), true);
  assert.equal(presenter.visibleState.units.find(value => value.id === 'b').hp, 0);
  assert.equal(presenter.visibleState.units.some(value => value.id === 'b'), true, 'lethal target remains visible for death presentation');
  assert.equal(presenter.complete(attack.token), true);

  const death = presenter.nextStep();
  assert.equal(death.kind, 'death');
  assert.equal(presenter.visibleState.units.some(value => value.id === 'b'), true);
  assert.equal(presenter.complete(death.token), true);
  assert.equal(presenter.visibleState.units.some(value => value.id === 'b'), false);
  assert.equal(presenter.settledReady, false);

  const settle = presenter.nextStep();
  assert.equal(settle.kind, 'settle');
  assert.equal(presenter.complete(settle.token), true);
  assert.equal(presenter.settledReady, true);
  assert.equal(presenter.visibleState.status, 'settled');
});

test('duplicate polls are ignored and a newer snapshot appends while the prior queue is active', () => {
  const presenter = new BattlePresentation();
  const initial = state();
  presenter.bootstrap(initial);
  const aAt2 = unit('a', 'p0', 0, 0, 2);
  const firstEvents = [withViews({ seq: 1, type: 'move', actor: 'a', row: 0, col: 2, moveFrom: { row: 0, col: 1 }, moveTo: { row: 0, col: 2 } }, { a: aAt2 })];
  const first = state({ revision: 1, units: [aAt2, initial.units[1]], events: firstEvents });
  assert.equal(presenter.sync(first).acceptedEvents, 1);
  const move = presenter.nextStep();
  assert.equal(presenter.sync(first).mode, 'duplicate');

  const bAfter = unit('b', 'p1', 1, 0, 6, 3);
  const events = [
    ...firstEvents,
    withViews({ seq: 2, type: 'attack', actor: 'a', target: 'b', amount: 2 }, { a: aAt2, b: bAfter }),
    withViews({ seq: 3, type: 'damage', actor: 'a', target: 'b', amount: 2, effectiveAmount: 2, hpBefore: 5, hpAfter: 3 }, { a: aAt2, b: bAfter }),
  ];
  const second = state({ revision: 2, units: [aAt2, bAfter], events });
  assert.equal(presenter.sync(second).acceptedEvents, 2);
  assert.equal(presenter.queuedStepCount, 2, 'active move plus appended attack');
  assert.equal(presenter.complete(move.token), true);
  const attack = presenter.nextStep();
  assert.equal(attack.kind, 'attack');
  presenter.cue(attack.token, 'impact');
  presenter.complete(attack.token);
  assert.equal(presenter.visibleState.revision, 2);
  assert.equal(presenter.visibleState.units.find(value => value.id === 'b').hp, 3);
});

test('multi-attack, counterattack, reflection damage, multiple deaths, and summon stay distinct and ordered', () => {
  const presenter = new BattlePresentation();
  const initial = state({ units: [
    unit('a', 'p0', 0, 0, 5), unit('b', 'p1', 1, 0, 6), unit('c', 'p1', 1, 1, 6),
  ] });
  presenter.bootstrap(initial);
  const views = Object.fromEntries(initial.units.map(value => [value.id, value]));
  const summoned = unit('d', 'p0', 0, 2, 2, 4);
  const events = [
    withViews({ seq: 1, type: 'attack', actor: 'a', target: 'b' }, views),
    withViews({ seq: 2, type: 'damage', actor: 'a', target: 'b', amount: 2, hpBefore: 5, hpAfter: 3 }, views),
    withViews({ seq: 3, type: 'damage', actor: 'b', target: 'a', amount: 1, hpBefore: 5, hpAfter: 4, message: 'reflection' }, views),
    withViews({ seq: 4, type: 'attack', actor: 'b', target: 'a', message: 'counter' }, views),
    withViews({ seq: 5, type: 'damage', actor: 'b', target: 'a', amount: 4, hpBefore: 4, hpAfter: 0, message: 'counter' }, views),
    withViews({ seq: 6, type: 'attack', actor: 'c', target: 'a' }, views),
    withViews({ seq: 7, type: 'damage', actor: 'c', target: 'a', amount: 1, hpBefore: 0, hpAfter: 0 }, views),
    withViews({ seq: 8, type: 'death', actor: 'a' }, views),
    withViews({ seq: 9, type: 'death', actor: 'c' }, views),
    withViews({ seq: 10, type: 'summon', actor: 'p0', target: 'd', row: 2, col: 2 }, { d: summoned }),
  ];
  const final = state({ revision: 1, units: [unit('b', 'p1', 1, 0, 6, 3), summoned], events });
  presenter.sync(final);
  const kinds = [];
  while (presenter.locked) {
    const step = presenter.nextStep();
    kinds.push(step.kind);
    if (step.requiredCues.includes('impact')) presenter.cue(step.token, 'impact');
    assert.equal(presenter.complete(step.token), true);
  }
  assert.deepEqual(kinds, ['attack', 'attack', 'attack', 'death', 'death', 'summon']);
  assert.equal(presenter.visibleState.units.some(value => value.id === 'd'), true);
  assert.equal(presenter.replayTrace().steps.length, kinds.length);
});

test('events from another connection are queued solely by authoritative sequence', () => {
  const presenter = new BattlePresentation();
  const initial = state();
  presenter.bootstrap(initial);
  const movedEnemy = unit('b', 'p1', 1, 0, 5);
  const event = withViews({ seq: 1, type: 'move', actor: 'b', row: 0, col: 5, moveFrom: { row: 0, col: 6 }, moveTo: { row: 0, col: 5 } }, { b: movedEnemy });
  presenter.sync(state({ revision: 1, units: [initial.units[0], movedEnemy], events: [event] }));
  const step = presenter.nextStep();
  assert.equal(step.actorId, 'b');
  assert.equal(step.kind, 'move');
});
