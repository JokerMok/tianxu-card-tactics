import assert from 'node:assert/strict';
import {
  ObjectiveError,
  applyObjectiveEvent,
  createObjectiveState,
  deserializeObjectiveState,
  getObjectiveProgress,
  normalizeObjectiveConfigs,
  objectiveIsComplete,
  serializeObjectiveState,
  settleObjectives,
  startObjectives,
} from '../assets/scripts/core/outcome/objectives/index.ts';
import { createObjectivePanelViewModel, ObjectivePanelService } from '../assets/scripts/battle/ui/objectives/index.ts';

const configs = [
  { id: 'clear-minions', type: 'KILL', targetSide: 'enemy', count: 2, label: '清除两名敌军' },
  { id: 'protect-gate', type: 'DEFEND', targetId: 'gate', minHp: 5 },
  { id: 'timed-boss', type: 'TIMED', targetId: 'boss', count: 1, timeLimitMs: 1000 },
  { id: 'survive-wave', type: 'SURVIVE', durationMs: 2000 },
];

const normalized = normalizeObjectiveConfigs(configs);
assert.equal(normalized[0].count, 2, 'kill count must come from config');
assert.equal(normalized[2].timeLimitMs, 1000, 'timed limit must come from config');
assert.equal(normalized[3].durationMs, 2000, 'survival duration must come from config');

let state = createObjectiveState(configs);
assert.equal(state.lifecycle, 'not_started');
assert.equal(state.settled, false);
state = startObjectives(state, 100, { gate: 10 });
assert.equal(state.lifecycle, 'active');
assert.equal(getObjectiveProgress(state, 'protect-gate')?.currentHp, 10);

state = applyObjectiveEvent(state, { id: 'minion-1', type: 'UNIT_DEFEATED', unitId: 'm1', side: 'enemy' });
state = applyObjectiveEvent(state, { id: 'minion-2', type: 'UNIT_DEFEATED', unitId: 'm2', side: 'enemy' });
assert.equal(getObjectiveProgress(state, 'clear-minions')?.current, 2, 'kill progress must update from defeat events');
assert.equal(objectiveIsComplete(state, 'clear-minions'), true);
assert.equal(getObjectiveProgress(state, 'timed-boss')?.current, 0, 'different target must not count');

state = applyObjectiveEvent(state, { id: 'clock-1', type: 'TIME_ADVANCED', deltaMs: 1000 });
assert.equal(state.elapsedMs, 1000);
state = applyObjectiveEvent(state, { id: 'boss-dead', type: 'UNIT_DEFEATED', unitId: 'boss', side: 'enemy' });
assert.equal(objectiveIsComplete(state, 'timed-boss'), true, 'timed kill at inclusive boundary must count');
assert.equal(state.lifecycle, 'active', 'defense and survival still require their own conditions');

const duplicateKill = applyObjectiveEvent(state, { id: 'boss-dead', type: 'UNIT_DEFEATED', unitId: 'boss', side: 'enemy' });
assert.strictEqual(duplicateKill, state, 'duplicate event must be idempotent');
const serialized = serializeObjectiveState(state);
const restored = deserializeObjectiveState(serialized, configs);
assert.deepEqual(restored, state, 'objective state must round-trip through JSON');
assert.equal(JSON.parse(serialized).objectives[0].id, 'clear-minions');

state = applyObjectiveEvent(state, { id: 'gate-hit', type: 'TARGET_HEALTH', targetId: 'gate', hp: 5 });
state = applyObjectiveEvent(state, { id: 'clock-2', type: 'TIME_ADVANCED', deltaMs: 1000 });
assert.equal(objectiveIsComplete(state, 'survive-wave'), true, 'survival must complete at configured duration');
state = settleObjectives(state, 'won', 'battle-end');
assert.equal(state.lifecycle, 'won');
assert.equal(state.settlement?.reason, 'OBJECTIVES_COMPLETE');
assert.strictEqual(settleObjectives(state, 'won', 'battle-end-duplicate'), state, 'repeated settlement must not mutate state');

const panel = createObjectivePanelViewModel(configs, state);
assert.equal(panel.objectives.length, 4);
assert.equal(panel.objectives.find(({ id }) => id === 'clear-minions')?.label, '清除两名敌军');
assert.equal(panel.objectives.find(({ id }) => id === 'timed-boss')?.remainingMs, 0);
assert.equal(panel.objectives.find(({ id }) => id === 'survive-wave')?.progress, 1);
assert(Object.isFrozen(panel) && Object.isFrozen(panel.objectives), 'UI snapshots must be immutable');
assert.deepEqual(new ObjectivePanelService(configs).render(state), panel, 'UI service must render the same config-driven snapshot');

const activeWithNonStartFirstEvent = JSON.parse(serialized);
activeWithNonStartFirstEvent.events.shift();
activeWithNonStartFirstEvent.processedEventIds.shift();
const lostWithCompleteReason = JSON.parse(serializeObjectiveState(state));
lostWithCompleteReason.lifecycle = 'lost';
lostWithCompleteReason.settlement.status = 'lost';
assert.throws(
  () => createObjectivePanelViewModel(configs, activeWithNonStartFirstEvent),
  (error) => error instanceof ObjectiveError && error.code === 'INVALID_STATE',
  'UI snapshot builder must reject an unreachable objective event sequence',
);

let negativeCaseCount = 0;
function expectFailure(label, action, code) {
  negativeCaseCount += 1;
  assert.throws(action, (error) => {
    assert(error instanceof ObjectiveError, `${label} must use ObjectiveError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.deepEqual(JSON.parse(JSON.stringify(error)), {
      name: 'ObjectiveError',
      code,
      reason: code,
      message: error.message,
    }, `${label} error must be serializable`);
    return true;
  }, label);
}

const invalidConfigCases = [
  ['empty config', () => createObjectiveState([]), 'INVALID_CONFIG'],
  ['duplicate config id', () => createObjectiveState([{ id: 'x', type: 'KILL', targetId: 'u', count: 1 }, { id: 'x', type: 'SURVIVE', durationMs: 1 }]), 'INVALID_CONFIG'],
  ['unknown objective type', () => createObjectiveState([{ id: 'x', type: 'UNKNOWN', targetId: 'u', count: 1 }]), 'INVALID_CONFIG'],
  ['kill without target', () => createObjectiveState([{ id: 'x', type: 'KILL', count: 1 }]), 'INVALID_CONFIG'],
  ['zero kill count', () => createObjectiveState([{ id: 'x', type: 'KILL', targetId: 'u', count: 0 }]), 'INVALID_CONFIG'],
  ['defend without target id', () => createObjectiveState([{ id: 'x', type: 'DEFEND', minHp: 1 }]), 'INVALID_CONFIG'],
  ['negative defend hp', () => createObjectiveState([{ id: 'x', type: 'DEFEND', targetId: 'gate', minHp: -1 }]), 'INVALID_CONFIG'],
  ['zero timed limit', () => createObjectiveState([{ id: 'x', type: 'TIMED', targetId: 'u', count: 1, timeLimitMs: 0 }]), 'INVALID_CONFIG'],
  ['zero survival duration', () => createObjectiveState([{ id: 'x', type: 'SURVIVE', durationMs: 0 }]), 'INVALID_CONFIG'],
  ['unknown config field', () => createObjectiveState([{ id: 'x', type: 'SURVIVE', durationMs: 1, hack: true }]), 'INVALID_CONFIG'],
];

const fresh = createObjectiveState(configs);
const active = startObjectives(fresh, 0, { gate: 10 });
const timedOut = applyObjectiveEvent(active, { id: 'timeout', type: 'TIME_ADVANCED', deltaMs: 1001 });
assert.equal(timedOut.lifecycle, 'lost', 'timed objective must fail after configured limit');

const negativeCases = [
  ...invalidConfigCases,
  ['kill before start', () => applyObjectiveEvent(fresh, { id: 'early-kill', type: 'UNIT_DEFEATED', unitId: 'm1', side: 'enemy' }), 'INVALID_TIMING'],
  ['negative start time', () => startObjectives(fresh, -1), 'NEGATIVE_TIME'],
  ['duplicate start with new event', () => applyObjectiveEvent(active, { id: 'start-again', type: 'BATTLE_STARTED' }), 'INVALID_TIMING'],
  ['negative time advance', () => applyObjectiveEvent(active, { id: 'backwards', type: 'TIME_ADVANCED', deltaMs: -1 }), 'NEGATIVE_TIME'],
  ['fractional time advance', () => applyObjectiveEvent(active, { id: 'fractional', type: 'TIME_ADVANCED', deltaMs: 1.5 }), 'INVALID_EVENT'],
  ['future event timing', () => applyObjectiveEvent(active, { id: 'future-kill', type: 'UNIT_DEFEATED', unitId: 'm1', side: 'enemy', atMs: 1 }), 'INVALID_TIMING'],
  ['invalid target health', () => applyObjectiveEvent(active, { id: 'bad-health', type: 'TARGET_HEALTH', targetId: 'gate', hp: -1 }), 'INVALID_EVENT'],
  ['event after settlement', () => applyObjectiveEvent(timedOut, { id: 'late-kill', type: 'UNIT_DEFEATED', unitId: 'boss', side: 'enemy' }), 'STATE_SETTLED'],
  ['malformed serialized state', () => deserializeObjectiveState('{', configs), 'INVALID_STATE'],
  ['state from another config', () => deserializeObjectiveState(serialized, [{ id: 'other', type: 'SURVIVE', durationMs: 1 }]), 'INVALID_STATE'],
  ['state from changed target config', () => deserializeObjectiveState(serialized, configs.map((config) => config.id === 'clear-minions' ? { ...config, count: 3 } : config)), 'INVALID_STATE'],
  ['active state with a non-start first event', () => deserializeObjectiveState(JSON.stringify(activeWithNonStartFirstEvent), configs), 'INVALID_STATE'],
  ['lost state with OBJECTIVES_COMPLETE settlement', () => deserializeObjectiveState(JSON.stringify(lostWithCompleteReason), configs), 'INVALID_STATE'],
];
for (const [label, action, code] of negativeCases) expectFailure(label, action, code);
assert.equal(negativeCaseCount, negativeCases.length, 'every listed negative case must execute exactly once');
assert.equal(negativeCaseCount, 21 + 2, 'negative-case coverage must retain all 21 cases plus two reachability cases');
assert.equal(active.elapsedMs, 0, 'rejected negative time must leave state unchanged');
assert.deepEqual(active.processedEventIds, ['battle-start'], 'rejected future event must not be recorded');
console.log(`T206 chapter objectives PASS: config-driven KILL/DEFEND/TIMED/SURVIVE, JSON state, UI snapshot, negative-cases=${negativeCaseCount}`);
