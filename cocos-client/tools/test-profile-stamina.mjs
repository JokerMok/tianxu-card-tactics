import assert from 'node:assert/strict';
import {
  createProfile,
  DEFAULT_PROFILE_RULES,
  deserializeProfile,
  grantExperience,
  ProfileService,
  recoverStamina,
  serializeProfile,
} from '../assets/scripts/meta/profile/index.ts';

const rules = { experiencePerLevel: 100, staminaRecoveryIntervalMs: 1_000 };

const threshold = grantExperience(
  createProfile({ level: 1, xp: 99, stamina: 2, staminaMax: 10, lastStaminaAt: 0 }, rules),
  1,
  rules,
);
assert.deepEqual(threshold.state, { level: 2, xp: 0, stamina: 10, staminaMax: 10, lastStaminaAt: 0 });
assert.equal(threshold.levelsGained, 1);
assert.equal(threshold.experienceGranted, 1);

const scaledThreshold = grantExperience(
  createProfile({ level: 2, xp: 199, stamina: 3, staminaMax: 10, lastStaminaAt: 0 }, rules),
  1,
  rules,
);
assert.deepEqual(scaledThreshold.state, { level: 3, xp: 0, stamina: 10, staminaMax: 10, lastStaminaAt: 0 });
assert.equal(scaledThreshold.levelsGained, 1, 'the next level threshold must use the current level');

const remainder = grantExperience(
  createProfile({ level: 2, xp: 0, stamina: 3, staminaMax: 10, lastStaminaAt: 0 }, rules),
  250,
  rules,
);
assert.deepEqual(remainder.state, { level: 3, xp: 50, stamina: 10, staminaMax: 10, lastStaminaAt: 0 });
assert.equal(remainder.levelsGained, 1);
assert.equal(remainder.experienceGranted, 250);

const continuous = grantExperience(createProfile({ level: 1, xp: 95, stamina: 4, staminaMax: 10 }, rules), 205, rules);
assert.deepEqual(continuous.state, { level: 3, xp: 0, stamina: 10, staminaMax: 10, lastStaminaAt: 0 });
assert.equal(continuous.levelsGained, 2, 'one grant must support consecutive upgrades');

const noUpgrade = grantExperience(createProfile({ level: 3, xp: 2, stamina: 4, staminaMax: 10 }, rules), 0, rules);
assert.deepEqual(noUpgrade.state, { level: 3, xp: 2, stamina: 4, staminaMax: 10, lastStaminaAt: 0 });

const service = new ProfileService(createProfile({ level: 2, xp: 20, stamina: 8, staminaMax: 10, lastStaminaAt: 0 }, rules), rules);
assert.deepEqual(service.consumeStamina(3), { level: 2, xp: 20, stamina: 5, staminaMax: 10, lastStaminaAt: 0 });

const beforeBoundary = recoverStamina(service.snapshot(), 999, rules);
assert.equal(beforeBoundary.staminaRecovered, 0);
assert.equal(beforeBoundary.state.stamina, 5);
const atBoundary = recoverStamina(beforeBoundary.state, 1_000, rules);
assert.equal(atBoundary.staminaRecovered, 1);
assert.equal(atBoundary.state.stamina, 6);
assert.equal(atBoundary.state.lastStaminaAt, 1_000);
const clamped = recoverStamina(atBoundary.state, 10_000, rules);
assert.equal(clamped.staminaRecovered, 4);
assert.deepEqual(clamped.state, { level: 2, xp: 20, stamina: 10, staminaMax: 10, lastStaminaAt: 10_000 });
const fullAtLaterTime = recoverStamina(clamped.state, 12_000, rules);
assert.equal(fullAtLaterTime.state.lastStaminaAt, 12_000, 'full stamina must move the recovery anchor forward');

const carriedRemainder = recoverStamina(createProfile({ stamina: 0, staminaMax: 10, lastStaminaAt: 0 }, rules), 2_500, rules);
assert.deepEqual(carriedRemainder.state, { level: 1, xp: 0, stamina: 2, staminaMax: 10, lastStaminaAt: 2_000 });
assert.equal(carriedRemainder.staminaRecovered, 2);
const carriedBoundary = recoverStamina(carriedRemainder.state, 3_000, rules);
assert.deepEqual(carriedBoundary.state, { level: 1, xp: 0, stamina: 3, staminaMax: 10, lastStaminaAt: 3_000 });
assert.equal(carriedBoundary.staminaRecovered, 1);

const persisted = [];
const savingService = new ProfileService(
  createProfile({ level: 1, xp: 99, stamina: 5, staminaMax: 10, lastStaminaAt: 500 }, rules),
  rules,
  (serialized) => persisted.push(serialized),
);
savingService.grantExperience(1);
assert.deepEqual(savingService.snapshot(), { level: 2, xp: 0, stamina: 10, staminaMax: 10, lastStaminaAt: 500 });
const save = savingService.save();
assert.equal(persisted.at(-1), save);
const restored = ProfileService.fromSave(save, rules);
assert.deepEqual(restored.snapshot(), savingService.snapshot());
assert.equal(serializeProfile(restored.snapshot(), rules), save, 'save/restore must be deterministic');
assert.deepEqual(deserializeProfile(save, rules), savingService.snapshot());

const expectFailure = (label, callback, message) => {
  assert.throws(callback, { message }, label);
};

expectFailure('negative experience', () => grantExperience(createProfile({}, rules), -1, rules), 'experience must be non-negative');
expectFailure('fractional experience', () => grantExperience(createProfile({}, rules), 1.5, rules), 'experience must be a safe integer');
expectFailure('non-finite experience', () => grantExperience(createProfile({}, rules), Number.POSITIVE_INFINITY, rules), 'experience must be a safe integer');
expectFailure('invalid zero level', () => createProfile({ level: 0 }, rules), 'level must be positive');
expectFailure('invalid fractional level', () => createProfile({ level: 1.5 }, rules), 'level must be a safe integer');
expectFailure('null level is not a default', () => createProfile({ level: null }, rules), 'level must be a safe integer');
expectFailure('negative stamina', () => createProfile({ stamina: -1 }, rules), 'stamina must be non-negative');
expectFailure('stamina over maximum', () => createProfile({ stamina: 11, staminaMax: 10 }, rules), 'stamina cannot exceed staminaMax');
expectFailure('zero stamina cost', () => service.consumeStamina(0), 'stamina cost must be positive');
expectFailure('negative stamina cost', () => service.consumeStamina(-1), 'stamina cost must be positive');
expectFailure('over stamina cost', () => service.consumeStamina(6), 'stamina cost exceeds current stamina');
expectFailure('negative time', () => recoverStamina(service.snapshot(), -1, rules), 'time must be non-negative');
expectFailure('fractional time', () => recoverStamina(service.snapshot(), 1.5, rules), 'time must be a safe integer');
expectFailure('time overflow', () => recoverStamina(service.snapshot(), Number.MAX_SAFE_INTEGER + 1, rules), 'time must be a safe integer');
expectFailure('time moved backwards', () => recoverStamina({ ...service.snapshot(), lastStaminaAt: 2_000 }, 1_000, rules), 'time cannot move backwards');
expectFailure('experience overflow', () => grantExperience(createProfile({ xp: 99 }, rules), Number.MAX_SAFE_INTEGER, rules), 'experience overflow');
expectFailure('invalid recovery interval', () => createProfile({}, { ...rules, staminaRecoveryIntervalMs: 0 }), 'staminaRecoveryIntervalMs must be positive');
expectFailure('fractional recovery interval', () => createProfile({}, { ...rules, staminaRecoveryIntervalMs: 1.5 }), 'staminaRecoveryIntervalMs must be a safe integer');
expectFailure('invalid experience threshold', () => createProfile({}, { ...rules, experiencePerLevel: -1 }), 'experiencePerLevel must be positive');
expectFailure('malformed save', () => deserializeProfile('{"schemaVersion":1,"level":1}', rules), 'xp must be a safe integer');
expectFailure('invalid JSON save', () => deserializeProfile('{', rules), 'profile save is not valid JSON');
expectFailure('unknown save field', () => deserializeProfile(`${save.slice(0, -1)},"extra":true}`, rules), 'unknown profile save field');
expectFailure('unsupported save version', () => deserializeProfile('{"schemaVersion":2,"level":1,"xp":0,"stamina":1,"staminaMax":1,"lastStaminaAt":0}', rules), 'unsupported profile save version');

assert.deepEqual(DEFAULT_PROFILE_RULES, { experiencePerLevel: 100, staminaRecoveryIntervalMs: 60_000 });
console.log('T209 profile/stamina PASS: scaled thresholds, consecutive upgrades, level refill, stamina boundaries, deterministic persistence and 23 negative cases');
