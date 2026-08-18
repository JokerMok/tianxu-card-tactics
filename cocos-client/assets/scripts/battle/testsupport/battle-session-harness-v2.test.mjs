import assert from 'node:assert/strict';
import {
  BATTLE_HARNESS_V2_ALLOWED_ACTIONS,
  createBattleSessionHarnessV2,
} from './battle-session-harness-v2.ts';

const harness = createBattleSessionHarnessV2(42);
const initialHash = harness.readHash();

assert.equal(harness.start().lifecycle, 'active');
assert.equal(harness.selectFirstUnit().ok, true);
assert.equal(harness.deploySelection(0).ok, true);
assert.equal(harness.actions.at(-1).type, 'DEPLOY_UNIT');
assert.notEqual(harness.readHash(), initialHash);

assert.equal(harness.endTurn().state.turn > 1, true);
assert.equal(harness.enqueueManagedEndTurn(), true);
assert.equal(harness.tickManaged().dispatched, true);
assert.equal(harness.actions.at(-1).type, 'END_TURN');

const actionCountBeforePause = harness.actions.length;
harness.pause();
assert.equal(harness.lifecycle, 'paused');
assert.throws(() => harness.endTurn(), /paused/);
assert.equal(harness.actions.length, actionCountBeforePause);
harness.resume();
assert.equal(harness.lifecycle, 'active');

assert.equal(harness.requestExit().accepted, true);
assert.equal(harness.confirmExit().settled, true);
assert.equal(harness.lifecycle, 'ended');
assert.equal(typeof harness.readHash(), 'string');
assert.equal(harness.readHash().length > 0, true);

assert.equal(
  harness.actions.every((action) => BATTLE_HARNESS_V2_ALLOWED_ACTIONS.includes(action.type)),
  true,
  'Harness must only exercise state changes through supported BattleSession input actions',
);

console.log('BattleSession Harness v2 PASS');
