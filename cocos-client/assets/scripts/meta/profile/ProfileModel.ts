export const PROFILE_SAVE_VERSION = 1 as const;

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export interface ProfileRules {
  readonly experiencePerLevel: number;
  readonly staminaRecoveryIntervalMs: number;
}

export const DEFAULT_PROFILE_RULES: ProfileRules = {
  experiencePerLevel: 100,
  staminaRecoveryIntervalMs: 60_000,
};

export interface ProfileState {
  readonly level: number;
  readonly xp: number;
  readonly stamina: number;
  readonly staminaMax: number;
  readonly lastStaminaAt: number;
}

export interface ProfileInput {
  readonly level?: unknown;
  readonly xp?: unknown;
  readonly stamina?: unknown;
  readonly staminaMax?: unknown;
  readonly lastStaminaAt?: unknown;
}

export interface ExperienceResult {
  readonly state: ProfileState;
  readonly levelsGained: number;
  readonly experienceGranted: number;
}

export interface StaminaRecoveryResult {
  readonly state: ProfileState;
  readonly staminaRecovered: number;
}

export interface ProfileSave extends ProfileState {
  readonly schemaVersion: typeof PROFILE_SAVE_VERSION;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertSafeInteger(value: unknown, field: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new Error(`${field} must be a safe integer`);
}

function assertNonNegativeInteger(value: unknown, field: string): asserts value is number {
  assertSafeInteger(value, field);
  if (value < 0) throw new Error(`${field} must be non-negative`);
}

function assertPositiveInteger(value: unknown, field: string): asserts value is number {
  assertSafeInteger(value, field);
  if (value <= 0) throw new Error(`${field} must be positive`);
}

function assertRules(rules: ProfileRules): void {
  if (!isRecord(rules)) throw new Error('profile rules are invalid');
  assertPositiveInteger(rules.experiencePerLevel, 'experiencePerLevel');
  assertPositiveInteger(rules.staminaRecoveryIntervalMs, 'staminaRecoveryIntervalMs');
  if (Math.floor(MAX_SAFE_INTEGER / rules.experiencePerLevel) < 1) {
    throw new Error('experiencePerLevel cannot produce a valid level');
  }
}

function maxLevel(rules: ProfileRules): number {
  return Math.floor(MAX_SAFE_INTEGER / rules.experiencePerLevel);
}

function levelThreshold(level: number, rules: ProfileRules): number {
  const threshold = level * rules.experiencePerLevel;
  if (!Number.isSafeInteger(threshold) || threshold <= 0) throw new Error('level threshold overflow');
  return threshold;
}

function assertProfileRecord(value: unknown): asserts value is ProfileState {
  if (!isRecord(value)) throw new Error('profile must be an object');
  assertPositiveInteger(value.level, 'level');
  assertNonNegativeInteger(value.xp, 'xp');
  assertNonNegativeInteger(value.stamina, 'stamina');
  assertPositiveInteger(value.staminaMax, 'staminaMax');
  assertNonNegativeInteger(value.lastStaminaAt, 'lastStaminaAt');
}

export function validateProfile(value: unknown, rules: ProfileRules = DEFAULT_PROFILE_RULES): ProfileState {
  assertRules(rules);
  assertProfileRecord(value);
  if (value.level > maxLevel(rules)) throw new Error('level is invalid');
  if (value.xp >= levelThreshold(value.level, rules)) throw new Error('xp must be below the level threshold');
  if (value.stamina > value.staminaMax) throw new Error('stamina cannot exceed staminaMax');
  return {
    level: value.level,
    xp: value.xp,
    stamina: value.stamina,
    staminaMax: value.staminaMax,
    lastStaminaAt: value.lastStaminaAt,
  };
}

export function createProfile(input: ProfileInput = {}, rules: ProfileRules = DEFAULT_PROFILE_RULES): ProfileState {
  if (!isRecord(input)) throw new Error('profile input is invalid');
  return validateProfile({
    level: input.level === undefined ? 1 : input.level,
    xp: input.xp === undefined ? 0 : input.xp,
    stamina: input.stamina === undefined ? 100 : input.stamina,
    staminaMax: input.staminaMax === undefined ? 100 : input.staminaMax,
    lastStaminaAt: input.lastStaminaAt === undefined ? 0 : input.lastStaminaAt,
  }, rules);
}

function multiplyWithinLimit(left: number, right: number, limit: number): number {
  if (left === 0 || right === 0) return 0;
  if (left > Math.floor(limit / right)) return Number.POSITIVE_INFINITY;
  return left * right;
}

function experienceCost(level: number, upgrades: number, rules: ProfileRules, limit: number): number {
  if (upgrades === 0) return 0;

  const base = rules.experiencePerLevel;
  let first = multiplyWithinLimit(base, upgrades, limit);
  if (first !== Number.POSITIVE_INFINITY) first = multiplyWithinLimit(first, level, limit);

  let halfUpgrades = upgrades;
  let adjacentLevelCount = upgrades - 1;
  if (halfUpgrades % 2 === 0) halfUpgrades /= 2;
  else adjacentLevelCount /= 2;
  let second = multiplyWithinLimit(base, halfUpgrades, limit);
  if (second !== Number.POSITIVE_INFINITY) second = multiplyWithinLimit(second, adjacentLevelCount, limit);

  if (first === Number.POSITIVE_INFINITY || second === Number.POSITIVE_INFINITY || first > limit - second) {
    return Number.POSITIVE_INFINITY;
  }
  return first + second;
}

function copyProfile(state: ProfileState): ProfileState {
  return { ...state };
}

export function grantExperience(
  profile: ProfileState,
  amount: number,
  rules: ProfileRules = DEFAULT_PROFILE_RULES,
): ExperienceResult {
  const current = validateProfile(profile, rules);
  assertNonNegativeInteger(amount, 'experience');
  const combinedExperience = current.xp + amount;
  if (!Number.isSafeInteger(combinedExperience)) throw new Error('experience overflow');

  const maximumUpgrades = maxLevel(rules) - current.level;
  let low = 0;
  let high = maximumUpgrades + 1;
  while (low + 1 < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (experienceCost(current.level, middle, rules, combinedExperience) <= combinedExperience) low = middle;
    else high = middle;
  }

  const spent = experienceCost(current.level, low, rules, combinedExperience);
  const levelsGained = low;
  const nextLevel = current.level + levelsGained;
  const nextXp = combinedExperience - Number(spent);
  const next = validateProfile({
    ...current,
    level: nextLevel,
    xp: nextXp,
    stamina: levelsGained > 0 ? current.staminaMax : current.stamina,
  }, rules);
  return { state: next, levelsGained, experienceGranted: amount };
}

export function consumeStamina(profile: ProfileState, amount: number, rules: ProfileRules = DEFAULT_PROFILE_RULES): ProfileState {
  const current = validateProfile(profile, rules);
  assertPositiveInteger(amount, 'stamina cost');
  if (amount > current.stamina) throw new Error('stamina cost exceeds current stamina');
  return validateProfile({ ...current, stamina: current.stamina - amount }, rules);
}

export function recoverStamina(
  profile: ProfileState,
  now: number,
  rules: ProfileRules = DEFAULT_PROFILE_RULES,
): StaminaRecoveryResult {
  const current = validateProfile(profile, rules);
  assertNonNegativeInteger(now, 'time');
  if (now < current.lastStaminaAt) throw new Error('time cannot move backwards');

  if (current.stamina === current.staminaMax) {
    const next = validateProfile({ ...current, lastStaminaAt: now }, rules);
    return { state: next, staminaRecovered: 0 };
  }

  const elapsed = now - current.lastStaminaAt;
  const availableRecovery = Math.floor(elapsed / rules.staminaRecoveryIntervalMs);
  if (availableRecovery === 0) return { state: copyProfile(current), staminaRecovered: 0 };

  const missing = current.staminaMax - current.stamina;
  const staminaRecovered = Math.min(missing, availableRecovery);
  const stamina = current.stamina + staminaRecovered;
  const lastStaminaAt = stamina === current.staminaMax
    ? now
    : current.lastStaminaAt + staminaRecovered * rules.staminaRecoveryIntervalMs;
  const next = validateProfile({ ...current, stamina, lastStaminaAt }, rules);
  return { state: next, staminaRecovered };
}

export function serializeProfile(profile: ProfileState, rules: ProfileRules = DEFAULT_PROFILE_RULES): string {
  const current = validateProfile(profile, rules);
  const save: ProfileSave = { schemaVersion: PROFILE_SAVE_VERSION, ...current };
  return JSON.stringify(save);
}

function parseSave(value: unknown): ProfileState {
  if (!isRecord(value)) throw new Error('profile save must be an object');
  if (value.schemaVersion !== PROFILE_SAVE_VERSION) throw new Error('unsupported profile save version');
  const expectedKeys = ['schemaVersion', 'level', 'xp', 'stamina', 'staminaMax', 'lastStaminaAt'];
  if (Object.keys(value).some((key) => !expectedKeys.includes(key))) throw new Error('unknown profile save field');
  assertProfileRecord(value);
  return {
    level: value.level,
    xp: value.xp,
    stamina: value.stamina,
    staminaMax: value.staminaMax,
    lastStaminaAt: value.lastStaminaAt,
  };
}

export function deserializeProfile(serialized: string, rules: ProfileRules = DEFAULT_PROFILE_RULES): ProfileState {
  if (typeof serialized !== 'string' || serialized.length === 0) throw new Error('profile save must be a string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error('profile save is not valid JSON');
  }
  return validateProfile(parseSave(parsed), rules);
}
