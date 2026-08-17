import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BattleControlController } from './battle-control-controller.ts';
import { BattleSessionController } from './session-controller.ts';

const source = fs.readFileSync(new URL('./battle-control-controller.ts', import.meta.url), 'utf8');
assert.doesNotMatch(source, /(?:from|require\()\s*["']node:/, 'control controller must be runtime-neutral');
assert.doesNotMatch(source, /\b(?:window|document|cc|React|setTimeout|setInterval|Date)\b/, 'control controller must not require a host runtime');
assert.match(source, /Object\.freeze/, 'managed actions must be frozen');

function action(lane = 0) {
  return { type: 'PLAY_CARD', cardId: 'S001', side: 'player', target: { kind: 'lane', lane } };
}

function makeEngine({ reject = false, throwOnDispatch = false } = {}) {
  let actionRuns = 0;
  return {
    run(seed, actions) {
      if (actions.length > 1) {
        actionRuns += 1;
        if (reject || (throwOnDispatch && actionRuns > 0)) throw new Error('engine rejected action');
      }
      return {
        finalState: Object.freeze({ status: 'playing', seed, turn: actions.length }),
        events: Object.freeze([]),
        finalHash: `hash:${actions.map((item) => item.type).join(',')}`,
      };
    },
  };
}

function session(options) {
  const value = new BattleSessionController({ seed: 7, engine: makeEngine(options) });
  value.start();
  return value;
}

function proxyAction() {
  const counts = { get: 0, ownKeys: 0 };
  const value = new Proxy(action(), {
    get(target, property, receiver) {
      counts.get += 1;
      return Reflect.get(target, property, receiver);
    },
    ownKeys(target) {
      counts.ownKeys += 1;
      return Reflect.ownKeys(target);
    },
  });
  return { value, counts };
}

// Candidate normalization and legality are total functions, including hostile values.
{
  const managed = new BattleControlController({ session: session(), isActionLegal: () => false });
  for (const invoke of [
    (candidate) => managed.normalize(candidate),
    (candidate) => managed.isActionLegal(candidate),
    (candidate) => managed.enqueue(candidate),
    (candidate) => managed.dispatch(candidate),
  ]) {
    const before = managed.session.snapshot;
    const poisoned = proxyAction();
    assert.doesNotThrow(() => invoke(poisoned.value));
    assert.ok(poisoned.counts.get > 0, 'candidate get trap must run');
    assert.ok(poisoned.counts.ownKeys > 0, 'candidate ownKeys trap must run');
    assert.strictEqual(managed.session.snapshot, before, 'hostile candidate must not change the session');
  }

  const getter = {};
  Object.defineProperty(getter, 'type', { enumerable: true, get() { throw new Error('getter failed'); } });
  const ownKeysFailure = new Proxy({}, { ownKeys() { throw new Error('ownKeys failed'); } });
  for (const candidate of [getter, ownKeysFailure, null, { type: 'INVALID' }]) {
    const before = managed.session.snapshot;
    assert.equal(managed.isActionLegal(candidate), false);
    assert.equal(managed.enqueue(candidate), false);
    assert.equal(managed.dispatch(candidate), false);
    assert.strictEqual(managed.session.snapshot, before);
  }
}

// Engine rejection is a rejected legality query, not a session transition.
{
  const rejected = session({ reject: true });
  const managed = new BattleControlController({ session: rejected });
  const before = rejected.snapshot;
  assert.equal(rejected.isActionLegal(action()), false);
  assert.equal(managed.isActionLegal(action()), false);
  assert.equal(managed.enqueue(action()), false);
  assert.strictEqual(rejected.snapshot, before);
}

// Enqueue takes a deeply defensive, frozen copy before outside code can mutate it.
{
  const controlled = session();
  const managed = new BattleControlController({ session: controlled });
  const candidate = action(0);
  assert.equal(managed.enqueue(candidate), true);
  candidate.target.lane = 2;
  assert.equal(managed.tick().dispatched, true);
  const dispatched = controlled.snapshot.actions.at(-1);
  assert.deepEqual(dispatched, action(0));
  assert.equal(Object.isFrozen(dispatched), true);
  assert.equal(Object.isFrozen(dispatched.target), true);
}

// Every control change and a real external session advance invalidate strategy output.
for (const operation of ['hide', 'show', 'pause', 'resume', 'disable', 'enable']) {
  const controlled = session();
  let managed;
  let calls = 0;
  managed = new BattleControlController({
    session: controlled,
    strategy() {
      calls += 1;
      managed[operation]();
      return action();
    },
  });
  const before = controlled.snapshot;
  const result = managed.tick();
  assert.equal(result.dispatched, false, `${operation} must invalidate the strategy result`);
  assert.equal(calls, 1, `${operation} must not re-plan in the same tick`);
  assert.strictEqual(controlled.snapshot, before);
  assert.equal(managed.queuedActions.length, 0);
}

{
  const controlled = session();
  const managed = new BattleControlController({
    session: controlled,
    strategy() {
      controlled.dispatch({ type: 'END_TURN' });
      return action();
    },
  });
  const beforeActions = controlled.snapshot.actions.length;
  assert.equal(managed.tick().dispatched, false);
  assert.equal(controlled.snapshot.actions.length, beforeActions + 1, 'only the real manual advance may apply');
  assert.equal(managed.queuedActions.length, 0);
}

// A queued action is also discarded after an external manual advance.
{
  const controlled = session();
  const managed = new BattleControlController({ session: controlled });
  assert.equal(managed.enqueue(action()), true);
  controlled.dispatch({ type: 'END_TURN' });
  const before = controlled.snapshot;
  assert.equal(managed.tick().dispatched, false);
  assert.strictEqual(controlled.snapshot, before);
  assert.equal(managed.queuedActions.length, 0);
}

// Pausing, hiding, or disabling delays policy; restoring it preserves the normal action flow.
{
  const controlled = session();
  let lane = 0;
  const managed = new BattleControlController({ session: controlled, strategy: () => action(lane++) });
  managed.pause();
  assert.equal(managed.tick().dispatched, false);
  managed.resume();
  assert.equal(managed.tick().dispatched, true);
  managed.hide();
  assert.equal(managed.tick().dispatched, false);
  managed.show();
  assert.equal(managed.tick().dispatched, true);
  managed.disable();
  assert.equal(managed.tick().dispatched, false);
  managed.enable();
  assert.equal(managed.tick().dispatched, true);
  assert.deepEqual(controlled.snapshot.actions.slice(1).map((item) => item.target.lane), [0, 1, 2]);
}

// Strategy failures, illegal candidates, and dispatch failures never cross the host boundary.
{
  const controlled = session();
  const strategyFailure = new BattleControlController({ session: controlled, strategy() { throw new Error('strategy failed'); } });
  const invalid = new BattleControlController({ session: controlled, strategy: () => ({ type: 'INVALID' }) });
  const before = controlled.snapshot;
  assert.doesNotThrow(() => strategyFailure.tick());
  assert.doesNotThrow(() => invalid.tick());
  assert.strictEqual(controlled.snapshot, before);
}

{
  const controlled = session({ throwOnDispatch: true });
  const managed = new BattleControlController({ session: controlled, isActionLegal: () => true, strategy: () => action() });
  const before = controlled.snapshot;
  const result = managed.tick();
  assert.equal(result.dispatched, false);
  assert.equal(managed.queuedActions.length, 0);
  assert.strictEqual(controlled.snapshot.state, before.state);
  assert.strictEqual(controlled.snapshot.actions, before.actions);
  assert.strictEqual(controlled.snapshot.events, before.events);
  assert.equal(controlled.snapshot.finalHash, before.finalHash);
}

// A tick dispatches at most one legal candidate, and playback rate cannot affect actions.
{
  const first = session();
  const second = session();
  let firstLane = 0;
  let secondLane = 0;
  const slow = new BattleControlController({ session: first, speed: 0.5, strategy: () => action(firstLane++) });
  const fast = new BattleControlController({ session: second, speed: 4, strategy: () => action(secondLane++) });
  for (let index = 0; index < 3; index += 1) {
    const before = first.snapshot.actions.length;
    assert.equal(slow.tick().dispatched, true);
    assert.equal(first.snapshot.actions.length, before + 1, 'one tick may dispatch only one action');
    assert.equal(fast.tick().dispatched, true);
  }
  assert.deepEqual(first.snapshot.actions, second.snapshot.actions);
}

console.log('BattleControlController contract PASS');
