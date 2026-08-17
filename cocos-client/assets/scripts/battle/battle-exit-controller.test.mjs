import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleExitController } from './battle-exit-controller.ts';

const source = fs.readFileSync(new URL('./battle-exit-controller.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /\b(?:import|require)\b/, 'exit controller must not import a runtime');
assert.doesNotMatch(source, /(?:from|require\()\s*["']node:/, 'exit controller must be runtime-neutral');
assert.doesNotMatch(source, /\b(?:window|document|cc|React|setTimeout|setInterval|Date)\b/, 'exit controller must not require a host runtime');
assert.match(source, /Object\.freeze/, 'published snapshots must be immutable');

function topEntry({ throwsOnUnsubscribe = false, retainsListener = false } = {}) {
  let listener = null;
  return {
    subscribeClick(next) {
      listener = next;
      return () => {
        if (!retainsListener) listener = null;
        if (throwsOnUnsubscribe) throw new Error('unsubscribe failed');
      };
    },
    click() {
      if (listener) listener();
    },
  };
}

function controller(port) {
  return new BattleExitController({ port });
}

// A top entry moves active to confirmation exactly once and can be rebound safely.
{
  const calls = [];
  const entry = topEntry();
  const exits = controller({ settle(request) { calls.push(request); } });
  assert.equal(exits.snapshot.state, 'active');
  assert.equal(exits.bindTopEntry(entry).accepted, true);
  entry.click();
  entry.click();
  assert.equal(exits.snapshot.state, 'confirming');
  assert.equal(calls.length, 0);
  assert.equal(exits.confirm().accepted, true);
  assert.equal(exits.confirm().accepted, false, 'a second confirmation must be ignored');
  entry.click();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { reason: 'surrender' });
  assert.equal(exits.snapshot.state, 'terminal');
  assert.equal(exits.snapshot.terminal, true);
  assert.equal(exits.snapshot.failed, false);
  assert.equal(Object.isFrozen(exits.snapshot), true);
}

// Cancellation only works while confirming, then a later surrender remains valid.
{
  let calls = 0;
  const exits = controller({ settle() { calls += 1; } });
  assert.equal(exits.cancel().accepted, false);
  assert.equal(exits.requestSurrender().accepted, true);
  assert.equal(exits.cancel().accepted, true);
  assert.equal(exits.snapshot.state, 'active');
  assert.equal(exits.requestSurrender().accepted, true);
  assert.equal(exits.confirm().accepted, true);
  assert.equal(calls, 1);
}

// An abnormal exit is the sole settlement path before confirmation, even with an open confirmation.
{
  const calls = [];
  const entry = topEntry();
  const exits = controller({ settle(request) { calls.push(request.reason); } });
  exits.bindTopEntry(entry);
  entry.click();
  assert.equal(exits.snapshot.state, 'confirming');
  assert.equal(exits.abnormalExit().accepted, true);
  entry.click();
  assert.equal(exits.confirm().accepted, false);
  assert.equal(exits.abnormalExit().accepted, false);
  assert.deepEqual(calls, ['abnormal']);
  assert.equal(exits.snapshot.reason, 'abnormal');
}

// Synchronous re-entry from the settlement port cannot open a second settlement path.
{
  let calls = 0;
  const entry = topEntry();
  let exits;
  exits = controller({
    settle() {
      calls += 1;
      exits.confirm();
      exits.abnormalExit();
      entry.click();
    },
  });
  exits.bindTopEntry(entry);
  entry.click();
  assert.doesNotThrow(() => exits.confirm());
  assert.equal(calls, 1);
  assert.equal(exits.snapshot.state, 'terminal');
  assert.equal(exits.snapshot.reason, 'surrender');
}

// A failing port exposes no successful snapshot during its callback and is never retried.
{
  let calls = 0;
  let cancelResult;
  let callbackSnapshot;
  let exits;
  exits = controller({
    settle() {
      calls += 1;
      cancelResult = exits.cancel();
      callbackSnapshot = exits.snapshot;
      throw new Error('exit failed');
    },
  });
  exits.requestSurrender();
  assert.doesNotThrow(() => exits.confirm());
  assert.equal(cancelResult.accepted, false, 'cancel must not reopen a latched settlement');
  assert.deepEqual(callbackSnapshot, {
    state: 'settling', terminal: false, failed: false, settled: false, reason: 'surrender',
  }, 'the settlement callback must not observe a successful terminal snapshot');
  assert.equal(exits.snapshot.state, 'failed');
  assert.equal(exits.snapshot.terminal, true);
  assert.equal(exits.snapshot.failed, true);
  assert.equal(exits.snapshot.settled, false, 'a failed port must not look settled');
  assert.equal(exits.abnormalExit().accepted, false);
  assert.equal(calls, 1);
}

// Unbound entries and host registration or cleanup failures never escape the controller.
{
  let calls = 0;
  const entry = topEntry({ throwsOnUnsubscribe: true, retainsListener: true });
  const exits = controller({ settle() { calls += 1; } });
  exits.bindTopEntry(entry);
  assert.doesNotThrow(() => exits.unbindTopEntry());
  entry.click();
  assert.equal(exits.snapshot.state, 'active');
  assert.equal(calls, 0);
  assert.doesNotThrow(() => exits.bindTopEntry({ subscribeClick() { throw new Error('registration failed'); } }));
  assert.equal(exits.snapshot.state, 'active');
}

// All externally callable transitions are total for illegal timing and invalid host values.
{
  const exits = controller({ settle() {} });
  for (const invoke of [
    () => exits.cancel(),
    () => exits.confirm(),
    () => exits.unbindTopEntry(),
    () => exits.bindTopEntry(null),
    () => exits.bindTopEntry({}),
  ]) {
    assert.doesNotThrow(invoke);
  }
  assert.equal(exits.snapshot.state, 'active');
}

console.log('BattleExitController contract PASS');
