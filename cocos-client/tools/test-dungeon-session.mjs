import assert from 'node:assert/strict';
import { runNeutralBattle } from '../assets/scripts/battle/runner/battle-runner.ts';
import {
  DUNGEON_SESSION_SCHEMA_VERSION,
  DUNGEON_STAGE_COUNT,
  DungeonSessionError,
  DungeonSessionService,
  restoreDungeonSession,
} from '../assets/scripts/pve/dungeon/DungeonSession.ts';

function unitsFromBattle(output) {
  return output.finalState.units
    .filter(({ side }) => side === 'player')
    .map(({ id, hp, maxHp }) => ({ id, hp, maxHp }));
}

function battleResult(seed) {
  const output = runNeutralBattle(seed);
  assert.notEqual(output.finalState.status, 'playing', `seed ${seed} must settle`);
  assert.equal(output.outcome.status, output.finalState.status, `seed ${seed} outcome must match battle state`);
  return {
    output,
    result: {
      outcome: output.outcome.status,
      heroHp: output.finalState.heroHp.player,
      units: unitsFromBattle(output),
    },
  };
}

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
assert.throws(
  () => service.replaceDeck('deck-other', ['U003']),
  (error) => error instanceof DungeonSessionError && error.code === 'DECK_LOCKED',
);

const first = battleResult(102);
assert.equal(first.result.outcome, 'won');
service.completeBattle(first.result);
assert.equal(service.snapshot().stageIndex, 1);
assert.equal(service.snapshot().stages[0].status, 'completed');
assert.equal(service.snapshot().stages[1].status, 'active');
assert.equal(service.snapshot().stages[1].heroHp, first.result.heroHp);
assert.deepEqual(service.snapshot().stages[1].units, first.result.units);

const second = battleResult(105);
assert.equal(second.result.outcome, 'won');
service.completeBattle(second.result);
assert.equal(service.snapshot().stageIndex, 2);
assert.equal(service.snapshot().stages[2].heroHp, second.result.heroHp);
assert.deepEqual(service.snapshot().stages[2].units, second.result.units);

const third = battleResult(223);
assert.equal(third.result.outcome, 'won');
service.completeBattle(third.result);
assert.equal(service.snapshot().status, 'won');
assert.equal(service.snapshot().stageIndex, 3);
assert(service.snapshot().stages.every(({ status }) => status === 'completed'));
assert.throws(
  () => service.completeBattle(third.result),
  (error) => error instanceof DungeonSessionError && error.code === 'SESSION_SETTLED',
);
assert(Object.isFrozen(service.snapshot()));
assert(Object.isFrozen(service.snapshot().stages));

const restored = new DungeonSessionService({ initialState: service.save() });
assert.deepEqual(restored.snapshot(), service.snapshot());
assert.deepEqual(restoreDungeonSession(service.save()), service.snapshot());

const retry = new DungeonSessionService({ sessionId: 'T216-retry' });
retry.start('deck-main', lockedCards, 30, [{ id: 'hero-unit', hp: 10, maxHp: 10 }]);
const retryFirst = battleResult(102);
retry.completeBattle(retryFirst.result);
const failed = battleResult(101);
assert.equal(failed.result.outcome, 'lost');
retry.completeBattle(failed.result);
assert.equal(retry.snapshot().status, 'lost');
assert.equal(retry.snapshot().stageIndex, 1);
assert.equal(retry.snapshot().stages[1].attempts, 1);
assert.throws(
  () => retry.completeBattle(failed.result),
  (error) => error instanceof DungeonSessionError && error.code === 'SESSION_SETTLED',
);

retry.retry();
assert.equal(retry.snapshot().status, 'active');
assert.equal(retry.snapshot().stageIndex, 1);
assert.equal(retry.snapshot().stages[1].heroHp, retryFirst.result.heroHp, 'retry must inherit cleared-stage hero HP');
assert.deepEqual(retry.snapshot().stages[1].units, retryFirst.result.units, 'retry must inherit cleared-stage units');
assert.throws(
  () => retry.replaceDeck('deck-other', ['U003']),
  (error) => error instanceof DungeonSessionError && error.code === 'DECK_LOCKED',
);

const retrySecond = battleResult(105);
retry.completeBattle(retrySecond.result);
const retryThird = battleResult(223);
retry.completeBattle(retryThird.result);
assert.equal(retry.snapshot().status, 'won');
assert.equal(retry.snapshot().stageIndex, 3);
assert.throws(
  () => retry.retry(),
  (error) => error instanceof DungeonSessionError && error.code === 'INVALID_TRANSITION',
);

const firstStageRetry = new DungeonSessionService({ sessionId: 'T216-first-stage-retry' });
firstStageRetry.start('deck-main', lockedCards, 30, [{ id: 'hero-unit', hp: 10, maxHp: 10 }]);
firstStageRetry.completeBattle({ outcome: 'lost', heroHp: 0, units: [{ id: 'hero-unit', hp: 0, maxHp: 10 }] });
assert.equal(firstStageRetry.snapshot().status, 'lost');
assert.throws(
  () => firstStageRetry.completeBattle({ outcome: 'won', heroHp: 30, units: [] }),
  (error) => error instanceof DungeonSessionError && error.code === 'SESSION_SETTLED',
);
firstStageRetry.retry();
assert.equal(firstStageRetry.snapshot().stages[0].heroHp, 30, 'first-stage retry must restore the entry HP');
assert.deepEqual(firstStageRetry.snapshot().stages[0].units, [{ id: 'hero-unit', hp: 10, maxHp: 10 }]);
firstStageRetry.completeBattle({ outcome: 'won', heroHp: 25, units: [{ id: 'hero-unit', hp: 8, maxHp: 10 }] });
firstStageRetry.completeBattle({ outcome: 'won', heroHp: 20, units: [{ id: 'hero-unit', hp: 6, maxHp: 10 }] });
firstStageRetry.completeBattle({ outcome: 'won', heroHp: 15, units: [{ id: 'hero-unit', hp: 4, maxHp: 10 }] });
assert.equal(firstStageRetry.snapshot().status, 'won');

assert.throws(() => new DungeonSessionService({ stageIds: ['only-one'] }), (error) => error instanceof DungeonSessionError && error.code === 'INVALID_CONFIG');
assert.throws(() => new DungeonSessionService({ initialState: '{' }), (error) => error instanceof DungeonSessionError && error.code === 'INVALID_STATE');
assert.throws(() => restoreDungeonSession(JSON.stringify({ schemaVersion: 99 })), (error) => error instanceof DungeonSessionError && error.code === 'INVALID_STATE');
assert.throws(() => {
  const invalid = new DungeonSessionService({ sessionId: 'invalid' });
  invalid.start('deck-main', lockedCards, 30);
  invalid.completeBattle({ outcome: 'won', heroHp: 30, units: [{ id: 'broken', hp: 3, maxHp: 2 }] });
}, (error) => error instanceof DungeonSessionError && error.code === 'INVALID_STATE');
assert.throws(() => {
  const invalid = new DungeonSessionService({ sessionId: 'invalid-result' });
  invalid.start('deck-main', lockedCards, 30);
  invalid.completeBattle(null);
}, (error) => error instanceof DungeonSessionError && error.code === 'INVALID_CONFIG');
assert.throws(
  () => new DungeonSessionService({ sessionId: 'duplicate-deck' }).start('deck-main', ['U001', 'U001'], 30),
  (error) => error instanceof DungeonSessionError && error.code === 'INVALID_CONFIG',
);

assert(saves.length >= 4, 'every stage checkpoint must persist');
console.log(`T216 dungeon session PASS: real-battles=7, stages=${service.snapshot().stages.length}, retries=${retry.snapshot().stages[1].attempts}, saves=${saves.length}, negative-cases=11`);
