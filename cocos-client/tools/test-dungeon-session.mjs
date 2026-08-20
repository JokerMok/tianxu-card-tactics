import assert from 'node:assert/strict';

import {
  DUNGEON_SESSION_SCHEMA_VERSION,
  DUNGEON_STAGE_COUNT,
  DungeonSessionError,
  DungeonSessionService,
  restoreDungeonSession,
} from '../assets/scripts/pve/dungeon/DungeonSession.ts';

const saves = [];
const service = new DungeonSessionService({ sessionId: 'T216', persist: (value) => saves.push(value) });
assert.equal(service.snapshot().schemaVersion, DUNGEON_SESSION_SCHEMA_VERSION);
assert.equal(service.snapshot().status, 'idle');
assert.equal(service.snapshot().stages.length, DUNGEON_STAGE_COUNT);

const lockedCards = ['U001', 'U002', 'S001'];
service.start('deck-main', lockedCards, 30, [{ id: 'hero-unit', hp: 10, maxHp: 10 }]);
assert.equal(service.snapshot().status, 'active');
assert.equal(service.snapshot().lockedDeckId, 'deck-main');
assert.deepEqual(service.snapshot().lockedCardIds, lockedCards);
assert.throws(() => service.replaceDeck('deck-other', ['U003']), (error) => error instanceof DungeonSessionError && error.code === 'DECK_LOCKED');

const stageOneUnits = [{ id: 'hero-unit', hp: 7, maxHp: 10 }];
service.completeBattle({ outcome: 'won', heroHp: 24, units: stageOneUnits });
assert.equal(service.snapshot().stageIndex, 1);
assert.equal(service.snapshot().stages[0].status, 'completed');
assert.equal(service.snapshot().stages[1].status, 'active');
assert.equal(service.snapshot().stages[1].heroHp, 24);
assert.deepEqual(service.snapshot().stages[1].units, stageOneUnits);

service.completeBattle({ outcome: 'won', heroHp: 18, units: [{ id: 'hero-unit', hp: 3, maxHp: 10 }] });
assert.equal(service.snapshot().stageIndex, 2);
assert.equal(service.snapshot().stages[2].heroHp, 18);
service.completeBattle({ outcome: 'won', heroHp: 11, units: [{ id: 'hero-unit', hp: 1, maxHp: 10 }] });
assert.equal(service.snapshot().status, 'won');
assert.equal(service.snapshot().stageIndex, 3);
assert(service.snapshot().stages.every(({ status }) => status === 'completed'));
assert.throws(() => service.completeBattle({ outcome: 'won', heroHp: 11, units: [] }), (error) => error instanceof DungeonSessionError && error.code === 'SESSION_SETTLED');

const restored = new DungeonSessionService({ initialState: service.save() });
assert.deepEqual(restored.snapshot(), service.snapshot());
assert.deepEqual(restoreDungeonSession(service.save()), service.snapshot());

const retry = new DungeonSessionService({ sessionId: 'T216-retry' });
retry.start('deck-main', lockedCards, 30, [{ id: 'hero-unit', hp: 10, maxHp: 10 }]);
retry.completeBattle({ outcome: 'won', heroHp: 20, units: [{ id: 'hero-unit', hp: 4, maxHp: 10 }] });
retry.completeBattle({ outcome: 'lost', heroHp: 0, units: [{ id: 'hero-unit', hp: 0, maxHp: 10 }] });
assert.equal(retry.snapshot().status, 'lost');
assert.equal(retry.snapshot().stages[1].attempts, 1);
retry.retry();
assert.equal(retry.snapshot().status, 'active');
assert.equal(retry.snapshot().stageIndex, 1);
assert.equal(retry.snapshot().stages[1].heroHp, 20, 'retry must inherit the previous cleared stage HP');
assert.deepEqual(retry.snapshot().stages[1].units, [{ id: 'hero-unit', hp: 4, maxHp: 10 }]);
retry.completeBattle({ outcome: 'won', heroHp: 16, units: [{ id: 'hero-unit', hp: 2, maxHp: 10 }] });
retry.completeBattle({ outcome: 'won', heroHp: 12, units: [] });
assert.equal(retry.snapshot().status, 'won');

assert.throws(() => new DungeonSessionService({ stageIds: ['only-one'] }), (error) => error instanceof DungeonSessionError && error.code === 'INVALID_CONFIG');
assert.throws(() => new DungeonSessionService({ initialState: '{' }), (error) => error instanceof DungeonSessionError && error.code === 'INVALID_STATE');
assert.throws(() => restoreDungeonSession(JSON.stringify({ schemaVersion: 99 })), (error) => error instanceof DungeonSessionError && error.code === 'INVALID_STATE');
assert.throws(() => {
  const invalid = new DungeonSessionService({ sessionId: 'invalid' });
  invalid.start('deck-main', lockedCards, 30);
  invalid.completeBattle({ outcome: 'won', heroHp: 30, units: [{ id: 'broken', hp: 3, maxHp: 2 }] });
}, (error) => error instanceof DungeonSessionError && error.code === 'INVALID_STATE');

assert(saves.length >= 3, 'every completed battle must persist a checkpoint');
assert(Object.isFrozen(service.snapshot()));
assert(Object.isFrozen(service.snapshot().stages));
console.log(`T216 dungeon session PASS: stages=${service.snapshot().stages.length}, retries=${retry.snapshot().stages[1].attempts}, saves=${saves.length}, negative-cases=4`);
