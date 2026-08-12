import assert from 'node:assert/strict';
import { runBattleRunner, BATTLE_RUNNER_PROTOCOL } from './runner/battle-runner.ts';
import { BattleSessionController } from './session-controller.ts';

const session = new BattleSessionController({ seed: 42 });
assert.equal(session.lifecycle, 'idle');
assert.equal(session.snapshot.state.round, 0);
assert.deepEqual(session.consumeEvents(), []);

const started = session.start();
assert.equal(started.lifecycle, 'active');
assert.equal(started.state.round, 1);
assert.deepEqual(session.consumeEvents().map((event) => event.type), [
  'BATTLE_START', 'ROUND_START', 'TURN_START',
]);
assert.deepEqual(session.consumeEvents(), []);
assert.equal(Object.isFrozen(started.state), true);
assert.equal(Object.isFrozen(started.state.heroHp), true);
assert.equal(Object.isFrozen(started.state.hands.player), true);
assert.equal(Object.isFrozen(started.events), true);
assert.equal(Object.isFrozen(started.actions), true);

const beforePause = session.snapshot;
session.pause();
assert.equal(session.lifecycle, 'paused');
assert.deepEqual(session.snapshot.state, beforePause.state);
assert.throws(() => session.dispatch({ type: 'END_TURN' }), /paused/);
session.resume();
assert.equal(session.lifecycle, 'active');

const beforeInvalid = session.snapshot;
assert.throws(
  () => session.dispatch({ type: 'INVALID_COMMAND' }),
  (error) => error?.code === 'INVALID_COMMAND',
);
assert.strictEqual(session.snapshot, beforeInvalid);

const turn = session.dispatch({ type: 'END_TURN' });
assert.equal(turn.state.turn, 2);
assert.deepEqual(session.consumeEvents().map((event) => event.type), [
  'TURN_END', 'TURN_START',
]);

const expected = runBattleRunner({
  protocol: BATTLE_RUNNER_PROTOCOL,
  seed: 42,
  actions: [{ type: 'BATTLE_START' }, { type: 'END_TURN' }],
});
assert.deepEqual(session.snapshot.state, expected.finalState);
assert.deepEqual(session.snapshot.events, expected.events);
assert.equal(session.snapshot.finalHash, expected.finalHash);

const ended = session.end();
assert.equal(ended.lifecycle, 'ended');
assert.equal(session.end(), ended);
assert.throws(() => session.dispatch({ type: 'END_TURN' }), /ended/);
assert.deepEqual(session.consumeEvents(), []);

console.log('BattleSessionController contract PASS');
