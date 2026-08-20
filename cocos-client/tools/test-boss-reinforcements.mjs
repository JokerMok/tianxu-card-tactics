import assert from 'node:assert/strict';
import {
  BOSS_REINFORCEMENT_CONFIG,
  DEFAULT_REINFORCEMENT_CONFIG,
  ReinforcementConfigError,
  ReinforcementStateError,
  advanceReinforcementRound,
  createReinforcementState,
  damageReinforcement,
  executeReinforcementAction,
  planReinforcementAction,
  recoverReinforcement,
  restoreReinforcementState,
  serializeReinforcementState,
  validateReinforcementConfig,
} from '../assets/scripts/core/ai/reinforcements/index.ts';

const clone = (value) => structuredClone(value);
const unit = (id, kind, hp, maxHp, threat = 0, attack = 0, status = 'ACTIVE') => ({ id, kind, status, hp, maxHp, threat, attack });
const emptyContext = { allies: [], enemies: [], boss: null };
const fullContext = {
  allies: [unit('C001', 'ALLY', 18, 18), unit('C002', 'ALLY', 14, 14), unit('C003', 'ALLY', 24, 24)],
  enemies: [unit('enemy-low', 'ENEMY', 3, 10, 4, 2), unit('enemy-threat', 'ENEMY', 8, 12, 12, 5)],
  boss: unit('boss', 'BOSS', 100, 100, 99, 10),
};

assert.equal(DEFAULT_REINFORCEMENT_CONFIG.reinforcements.length, 3);
assert.deepEqual(DEFAULT_REINFORCEMENT_CONFIG.reinforcements.map(({ id, profession, battleRole }) => ({ id, profession, battleRole })), [
  { id: 'C001', profession: 'PACTKEEPER', battleRole: 'SUPPORT' },
  { id: 'C002', profession: 'SHADOW_STRATEGIST', battleRole: 'SCOUT' },
  { id: 'C003', profession: 'COMMANDER', battleRole: 'GUARD' },
]);
assert.strictEqual(BOSS_REINFORCEMENT_CONFIG, DEFAULT_REINFORCEMENT_CONFIG);
assert(Object.isFrozen(DEFAULT_REINFORCEMENT_CONFIG.reinforcements[0].recovery));

function expectConfigError(label, mutate, expectedPath) {
  const candidate = clone(DEFAULT_REINFORCEMENT_CONFIG);
  mutate(candidate);
  assert.throws(() => validateReinforcementConfig(candidate), (error) => {
    assert(error instanceof ReinforcementConfigError, `${label} must throw ReinforcementConfigError`);
    assert.equal(error.configPath, expectedPath, `${label} path`);
    return true;
  });
}

expectConfigError('duplicate id', (candidate) => { candidate.reinforcements[1].id = 'C001'; }, 'reinforcements.reinforcements[1].id');
expectConfigError('unknown field', (candidate) => { candidate.reinforcements[0].cheat = true; }, 'reinforcements.reinforcements[0].cheat');
expectConfigError('invalid profession', (candidate) => { candidate.reinforcements[0].profession = 'HEALER'; }, 'reinforcements.reinforcements[0].profession');
expectConfigError('empty priorities', (candidate) => { candidate.reinforcements[0].targetPriority = []; }, 'reinforcements.reinforcements[0].targetPriority');
expectConfigError('duplicate action', (candidate) => { candidate.reinforcements[0].actionPriority[1] = 'REVIVE'; }, 'reinforcements.reinforcements[0].actionPriority');
expectConfigError('invalid recovery hp', (candidate) => { candidate.reinforcements[0].recovery.recoverHp = 99; }, 'reinforcements.reinforcements[0].recovery.recoverHp');
expectConfigError('recovery over max uses', (candidate) => { candidate.reinforcements[0].recovery.maxUses = 2; }, 'reinforcements.reinforcements[0].recovery.maxUses');
expectConfigError('disabled downed with occurrences', (candidate) => { candidate.reinforcements[0].downed.enabled = false; }, 'reinforcements.reinforcements[0].downed.maxOccurrences');

const configurable = clone(DEFAULT_REINFORCEMENT_CONFIG);
configurable.reinforcements[1].profession = 'MYSTIC';
configurable.reinforcements[1].targetPriority = ['LOWEST_HP_ENEMY', 'BOSS'];
configurable.reinforcements[1].recovery.delayRounds = 0;
configurable.reinforcements[1].recovery.recoverHp = 10;
const customConfig = validateReinforcementConfig(configurable);
assert.equal(customConfig.reinforcements[1].profession, 'MYSTIC');
assert.deepEqual(customConfig.reinforcements[1].targetPriority, ['LOWEST_HP_ENEMY', 'BOSS']);

let state = createReinforcementState(DEFAULT_REINFORCEMENT_CONFIG);
assert.equal(state.round, 0);
assert.deepEqual(state.reinforcements.map(({ id, status, hp }) => ({ id, status, hp })), [
  { id: 'C001', status: 'ACTIVE', hp: 18 }, { id: 'C002', status: 'ACTIVE', hp: 14 }, { id: 'C003', status: 'ACTIVE', hp: 24 },
]);
assert(Object.isFrozen(state));

const downedAllyContext = {
  ...fullContext,
  allies: [unit('C002', 'ALLY', 0, 14, 0, 0, 'DOWNED'), unit('C003', 'ALLY', 12, 24, 0, 4)],
};
const reviveDecision = planReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, 'C001', downedAllyContext);
assert.equal(reviveDecision.reason, 'REVIVE_DOWNED_ALLY');
assert.deepEqual(reviveDecision.action && { type: reviveDecision.action.type, targetId: reviveDecision.action.targetId }, { type: 'REVIVE', targetId: 'C002' });
const reviveResult = executeReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, reviveDecision.action, downedAllyContext);
assert.equal(reviveResult.applied, true);
assert.equal(reviveResult.effects[0].type, 'REVIVE_TARGET');
assert.deepEqual(reviveResult.effects[0], { type: 'REVIVE_TARGET', targetId: 'C002', hp: 6 });
assert.equal(reviveResult.state.events.at(-1).type, 'ACTION_EXECUTED');
const repeatedRevive = executeReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, reviveResult.state, reviveDecision.action, downedAllyContext);
assert.equal(repeatedRevive.idempotent, true);
assert.strictEqual(repeatedRevive.state, reviveResult.state);
assert.equal(repeatedRevive.state.events.length, reviveResult.state.events.length);

const healContext = { ...fullContext, allies: [unit('C002', 'ALLY', 8, 14), unit('C003', 'ALLY', 22, 24)] };
const healDecision = planReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, 'C001', healContext);
assert.equal(healDecision.reason, 'HEAL_INJURED_ALLY');
assert.equal(healDecision.action.targetId, 'C002');
const healResult = executeReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, healDecision.action, healContext);
assert.deepEqual(healResult.effects, [{ type: 'HEAL_TARGET', targetId: 'C002', amount: 5 }]);

const attackDecision = planReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, 'C002', fullContext);
assert.equal(attackDecision.reason, 'ATTACK_PRIORITY_TARGET');
assert.equal(attackDecision.action.targetId, 'boss');
const attackResult = executeReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, attackDecision.action, fullContext);
assert.deepEqual(attackResult.effects, [{ type: 'DAMAGE_TARGET', targetId: 'boss', amount: 5 }]);

const customAttackDecision = planReinforcementAction(customConfig, createReinforcementState(customConfig), 'C002', fullContext);
assert.equal(customAttackDecision.action.targetId, 'enemy-low', 'configurable target priority must drive target selection');
const noBossContext = { allies: [], enemies: [], boss: null };
const guardDecision = planReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, 'C003', noBossContext);
assert.equal(guardDecision.reason, 'GUARD');
assert.equal(guardDecision.action.type, 'GUARD');
const guardResult = executeReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, guardDecision.action, noBossContext);
assert.deepEqual(guardResult.effects, [{ type: 'GUARD', targetId: 'C003', durationRounds: 2 }]);
const guardFallbackDecision = planReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, 'C001', emptyContext);
assert.equal(guardFallbackDecision.reason, 'GUARD', 'support without target still uses configured guard fallback');
const downedState = damageReinforcement(DEFAULT_REINFORCEMENT_CONFIG, state, 'C003', 24);
assert.equal(downedState.reinforcements[2].status, 'DOWNED');
assert.equal(downedState.reinforcements[2].hp, 0);
assert.equal(downedState.reinforcements[2].recoveryReadyRound, 2);
assert.equal(downedState.events.at(-1).type, 'REINFORCEMENT_DOWNED');
const repeatedDamage = damageReinforcement(DEFAULT_REINFORCEMENT_CONFIG, downedState, 'C003', 999);
assert.strictEqual(repeatedDamage, downedState, 'damage on a downed unit is idempotent');
const beforeRecovery = advanceReinforcementRound(DEFAULT_REINFORCEMENT_CONFIG, downedState);
assert.equal(beforeRecovery.round, 1);
assert.equal(beforeRecovery.reinforcements[2].status, 'DOWNED');
const recovered = advanceReinforcementRound(DEFAULT_REINFORCEMENT_CONFIG, beforeRecovery);
assert.equal(recovered.round, 2);
assert.equal(recovered.reinforcements[2].status, 'ACTIVE');
assert.equal(recovered.reinforcements[2].hp, 8);
assert.equal(recovered.reinforcements[2].recoveriesUsed, 1);
assert.equal(recovered.events.at(-1).type, 'REINFORCEMENT_RECOVERED');
assert.strictEqual(recoverReinforcement(DEFAULT_REINFORCEMENT_CONFIG, recovered, 'C003'), recovered, 'recovery after active is idempotent');
const defeated = damageReinforcement(DEFAULT_REINFORCEMENT_CONFIG, recovered, 'C003', 999);
assert.equal(defeated.reinforcements[2].status, 'DEFEATED', 'an exhausted recovery budget must defeat the unit');
assert.strictEqual(damageReinforcement(DEFAULT_REINFORCEMENT_CONFIG, defeated, 'C003', 1), defeated);
assert.equal(planReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, defeated, 'C003', fullContext).action, null);

const manualConfigValue = clone(DEFAULT_REINFORCEMENT_CONFIG);
manualConfigValue.reinforcements[0].recovery.trigger = 'MANUAL';
manualConfigValue.reinforcements[0].recovery.delayRounds = 0;
const manualConfig = validateReinforcementConfig(manualConfigValue);
const manualDowned = damageReinforcement(manualConfig, createReinforcementState(manualConfig), 'C001', 999);
assert.equal(advanceReinforcementRound(manualConfig, manualDowned).reinforcements[0].status, 'DOWNED');
const manuallyRecovered = recoverReinforcement(manualConfig, manualDowned, 'C001');
assert.equal(manuallyRecovered.reinforcements[0].status, 'ACTIVE');
assert.equal(manuallyRecovered.reinforcements[0].hp, 6);

assert.throws(() => damageReinforcement(DEFAULT_REINFORCEMENT_CONFIG, state, 'missing', 1), /unknown reinforcement/);
assert.throws(() => damageReinforcement(DEFAULT_REINFORCEMENT_CONFIG, state, 'C001', 0), ReinforcementStateError);
assert.throws(() => executeReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, { ...attackDecision.action, targetId: 'missing' }, fullContext), (error) => error instanceof ReinforcementStateError && error.code === 'INVALID_TARGET');
assert.throws(() => executeReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, { ...attackDecision.action, actorId: 'C003', type: 'ATTACK', targetId: 'missing' }, fullContext), /attack target/);
assert.throws(() => executeReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, { ...attackDecision.action, actorId: 'C002', type: 'REVIVE', targetId: 'C003' }, fullContext), /not configured/);
assert.throws(() => executeReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, { ...attackDecision.action, targetId: 'enemy-low' }, fullContext), /configured priority/);
assert.throws(() => planReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, 'C001', { ...emptyContext, allies: [unit('dup', 'ALLY', 1, 2), unit('dup', 'ALLY', 1, 2)] }), (error) => error.code === 'INVALID_TARGET');
assert.throws(() => executeReinforcementAction(DEFAULT_REINFORCEMENT_CONFIG, state, { ...attackDecision.action, targetId: null }, fullContext), /attack target/);

const saved = serializeReinforcementState(reviveResult.state);
const restored = restoreReinforcementState(DEFAULT_REINFORCEMENT_CONFIG, saved);
assert.deepEqual(restored, reviveResult.state, 'valid save must restore exact runtime state');
assert.equal(serializeReinforcementState(restored), saved, 'save serialization must be deterministic');
assert.notStrictEqual(restored, reviveResult.state);
assert.notStrictEqual(restored.reinforcements, reviveResult.state.reinforcements);
const corrupted = JSON.parse(saved);
corrupted.reinforcements[0].hp = 999;
assert.throws(() => restoreReinforcementState(DEFAULT_REINFORCEMENT_CONFIG, JSON.stringify(corrupted)), /ACTIVE/);
const unknownField = JSON.parse(saved);
unknownField.cheat = true;
assert.throws(() => restoreReinforcementState(DEFAULT_REINFORCEMENT_CONFIG, unknownField), /未知字段/);
const badVersion = JSON.parse(saved);
badVersion.schemaVersion = 2;
assert.throws(() => restoreReinforcementState(DEFAULT_REINFORCEMENT_CONFIG, JSON.stringify(badVersion)), (error) => error instanceof ReinforcementStateError && error.code === 'INVALID_SAVE');
assert.throws(() => restoreReinforcementState({ ...DEFAULT_REINFORCEMENT_CONFIG, id: 'other' }, saved), (error) => error instanceof ReinforcementStateError && error.code === 'CONFIG_MISMATCH');
assert.throws(() => restoreReinforcementState(DEFAULT_REINFORCEMENT_CONFIG, '{'), /valid JSON/);

const noDownedConfigValue = clone(DEFAULT_REINFORCEMENT_CONFIG);
noDownedConfigValue.reinforcements[2].downed = { enabled: false, maxOccurrences: 0 };
noDownedConfigValue.reinforcements[2].recovery.maxUses = 0;
const noDownedConfig = validateReinforcementConfig(noDownedConfigValue);
const noDownedState = damageReinforcement(noDownedConfig, createReinforcementState(noDownedConfig), 'C003', 999);
assert.equal(noDownedState.reinforcements[2].status, 'DEFEATED', 'disabled downed rule must remove the unit immediately');

console.log('T224 M5-09 Boss reinforcements: configurable professions, target priorities, downed/recovery rules, idempotent actions and save restore PASS');
