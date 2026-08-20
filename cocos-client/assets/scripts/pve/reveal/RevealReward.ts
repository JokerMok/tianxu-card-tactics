export const REVEAL_REWARD_SCHEMA_VERSION = 1 as const;

export type RevealRewardAmounts = Readonly<Record<string, number>>;

export type RevealCard = Readonly<{
  id: string;
  rewards: RevealRewardAmounts;
}>;

export type RevealPool = Readonly<{
  id: string;
  cards: readonly RevealCard[];
}>;

export type RevealRewardConfig = Readonly<{
  /** Number of reveals shared by the account on each local calendar day. */
  dailyFreeClaims: number;
  /** Default number of extra reveals granted by one successful dungeon clear. */
  additionalClaimsPerCompletion: number;
  /** Daily cap for completion-granted reveals. */
  maxDailyAdditionalClaims: number;
  pools: readonly RevealPool[];
}>;

export type RevealSessionState = Readonly<{
  sessionId: string;
  poolId: string;
  createdDayKey: string;
  claimedCardIds: readonly string[];
}>;

export type RevealRewardState = Readonly<{
  schemaVersion: typeof REVEAL_REWARD_SCHEMA_VERSION;
  dayKey: string;
  freeClaimsUsed: number;
  additionalClaimsGranted: number;
  additionalClaimsUsed: number;
  resources: Readonly<Record<string, number>>;
  processedRewardKeys: readonly string[];
  processedGrantKeys: readonly string[];
  sessions: readonly RevealSessionState[];
}>;

export type RevealRewardPersistence = (serialized: string) => void;

export type RevealResultCode =
  | 'APPLIED'
  | 'DUPLICATE'
  | 'NO_CLAIMS'
  | 'POOL_EXHAUSTED';

export type RevealClaimSource = 'FREE' | 'ADDITIONAL';

export type RevealResult = Readonly<{
  applied: boolean;
  code: RevealResultCode;
  state: RevealRewardState;
  reward: RevealRewardAmounts | null;
  source: RevealClaimSource | null;
}>;

export type RevealMutationCode = 'APPLIED' | 'DUPLICATE' | 'LIMIT_REACHED';

export type RevealMutationResult = Readonly<{
  applied: boolean;
  code: RevealMutationCode;
  state: RevealRewardState;
}>;

export type RevealSynchronizeResult = Readonly<{
  reset: boolean;
  state: RevealRewardState;
}>;

export type RevealRewardErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_ARGUMENT'
  | 'STALE_DAY'
  | 'UNKNOWN_POOL'
  | 'SESSION_NOT_FOUND'
  | 'SESSION_EXISTS'
  | 'SESSION_EXPIRED'
  | 'CARD_NOT_FOUND'
  | 'CARD_ALREADY_REVEALED'
  | 'PERSISTENCE_FAILED'
  | 'PERSISTENCE_REENTRANT';

export class RevealRewardError extends Error {
  readonly code: RevealRewardErrorCode;

  constructor(code: RevealRewardErrorCode, message: string) {
    super(message);
    this.name = 'RevealRewardError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => clone(item)) as T;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, clone(item)]),
  ) as T;
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function fail(code: RevealRewardErrorCode, message: string): never {
  throw new RevealRewardError(code, message);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], path: string, code: RevealRewardErrorCode): void {
  const expectedSet = new Set(expected);
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== expected.length
    || actual.some((key) => typeof key !== 'string' || !expectedSet.has(key))
    || expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    fail(code, `${path} contains unexpected or missing fields`);
  }
}

function assertTrimmedString(value: unknown, path: string, code: RevealRewardErrorCode): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail(code, `${path} must be a trimmed non-empty string`);
  }
}

function assertNonNegativeInteger(value: unknown, path: string, code: RevealRewardErrorCode): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    fail(code, `${path} must be a non-negative safe integer`);
  }
}

function assertPositiveInteger(value: unknown, path: string, code: RevealRewardErrorCode): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    fail(code, `${path} must be a positive safe integer`);
  }
}

function assertDayKey(value: unknown, path: string, code: RevealRewardErrorCode): asserts value is string {
  assertTrimmedString(value, path, code);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(code, `${path} must use YYYY-MM-DD`);
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    fail(code, `${path} is not a real calendar date`);
  }
}

function assertResourceMap(value: unknown, path: string, code: RevealRewardErrorCode): asserts value is RevealRewardAmounts {
  if (!isPlainRecord(value) || Object.keys(value).length === 0) fail(code, `${path} must be a non-empty resource map`);
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== Object.keys(value).length || ownKeys.some((key) => typeof key !== 'string')) {
    fail(code, `${path} contains non-enumerable or symbol fields`);
  }
  for (const [resource, amount] of Object.entries(value)) {
    assertTrimmedString(resource, `${path} resource`, code);
    assertPositiveInteger(amount, `${path}.${resource}`, code);
  }
}

function assertKeyList(value: unknown, path: string, code: RevealRewardErrorCode): asserts value is readonly string[] {
  if (!Array.isArray(value)) fail(code, `${path} must be an array`);
  const keys = new Set<string>();
  value.forEach((item, index) => {
    assertTrimmedString(item, `${path}[${index}]`, code);
    if (keys.has(item)) fail(code, `${path} contains duplicate ${item}`);
    keys.add(item);
  });
}

function validateConfig(value: unknown): asserts value is RevealRewardConfig {
  if (!isRecord(value)) fail('INVALID_CONFIG', 'reveal reward config must be an object');
  exactKeys(value, [
    'dailyFreeClaims',
    'additionalClaimsPerCompletion',
    'maxDailyAdditionalClaims',
    'pools',
  ], 'config', 'INVALID_CONFIG');
  assertNonNegativeInteger(value.dailyFreeClaims, 'config.dailyFreeClaims', 'INVALID_CONFIG');
  assertNonNegativeInteger(value.additionalClaimsPerCompletion, 'config.additionalClaimsPerCompletion', 'INVALID_CONFIG');
  assertNonNegativeInteger(value.maxDailyAdditionalClaims, 'config.maxDailyAdditionalClaims', 'INVALID_CONFIG');
  if (!Array.isArray(value.pools) || value.pools.length === 0) fail('INVALID_CONFIG', 'config.pools must be non-empty');

  const poolIds = new Set<string>();
  value.pools.forEach((pool, poolIndex) => {
    const path = `config.pools[${poolIndex}]`;
    if (!isRecord(pool)) fail('INVALID_CONFIG', `${path} must be an object`);
    exactKeys(pool, ['id', 'cards'], path, 'INVALID_CONFIG');
    assertTrimmedString(pool.id, `${path}.id`, 'INVALID_CONFIG');
    if (poolIds.has(pool.id)) fail('INVALID_CONFIG', `config contains duplicate pool ${pool.id}`);
    poolIds.add(pool.id);
    if (!Array.isArray(pool.cards) || pool.cards.length === 0) fail('INVALID_CONFIG', `${path}.cards must be non-empty`);
    const cardIds = new Set<string>();
    pool.cards.forEach((card, cardIndex) => {
      const cardPath = `${path}.cards[${cardIndex}]`;
      if (!isRecord(card)) fail('INVALID_CONFIG', `${cardPath} must be an object`);
      exactKeys(card, ['id', 'rewards'], cardPath, 'INVALID_CONFIG');
      assertTrimmedString(card.id, `${cardPath}.id`, 'INVALID_CONFIG');
      if (cardIds.has(card.id)) fail('INVALID_CONFIG', `${path} contains duplicate card ${card.id}`);
      cardIds.add(card.id);
      assertResourceMap(card.rewards, `${cardPath}.rewards`, 'INVALID_CONFIG');
    });
  });
}

function normalizeConfig(value: unknown): RevealRewardConfig {
  validateConfig(value);
  return freezeDeep(clone(value));
}

function validateState(value: unknown, config?: RevealRewardConfig): asserts value is RevealRewardState {
  if (!isPlainRecord(value)) fail('INVALID_STATE', 'reveal reward state must be an object');
  exactKeys(value, [
    'schemaVersion',
    'dayKey',
    'freeClaimsUsed',
    'additionalClaimsGranted',
    'additionalClaimsUsed',
    'resources',
    'processedRewardKeys',
    'processedGrantKeys',
    'sessions',
  ], 'state', 'INVALID_STATE');
  if (value.schemaVersion !== REVEAL_REWARD_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported reveal reward schema version');
  assertDayKey(value.dayKey, 'state.dayKey', 'INVALID_STATE');
  assertNonNegativeInteger(value.freeClaimsUsed, 'state.freeClaimsUsed', 'INVALID_STATE');
  assertNonNegativeInteger(value.additionalClaimsGranted, 'state.additionalClaimsGranted', 'INVALID_STATE');
  assertNonNegativeInteger(value.additionalClaimsUsed, 'state.additionalClaimsUsed', 'INVALID_STATE');
  if (value.additionalClaimsUsed > value.additionalClaimsGranted) fail('INVALID_STATE', 'additional claims used exceeds granted claims');
  if (config !== undefined) {
    if (value.freeClaimsUsed > config.dailyFreeClaims) fail('INVALID_STATE', 'free claims used exceeds daily limit');
    if (value.additionalClaimsGranted > config.maxDailyAdditionalClaims) fail('INVALID_STATE', 'additional claims granted exceeds daily limit');
  }
  if (!isPlainRecord(value.resources)) fail('INVALID_STATE', 'state.resources must be an object');
  const resourceKeys = Reflect.ownKeys(value.resources);
  if (resourceKeys.length !== Object.keys(value.resources).length || resourceKeys.some((key) => typeof key !== 'string')) {
    fail('INVALID_STATE', 'state.resources contains non-enumerable or symbol fields');
  }
  for (const [resource, amount] of Object.entries(value.resources)) {
    assertTrimmedString(resource, 'state.resources resource', 'INVALID_STATE');
    assertNonNegativeInteger(amount, `state.resources.${resource}`, 'INVALID_STATE');
  }
  assertKeyList(value.processedRewardKeys, 'state.processedRewardKeys', 'INVALID_STATE');
  assertKeyList(value.processedGrantKeys, 'state.processedGrantKeys', 'INVALID_STATE');
  if (!Array.isArray(value.sessions)) fail('INVALID_STATE', 'state.sessions must be an array');

  const sessionIds = new Set<string>();
  value.sessions.forEach((session, index) => {
    const path = `state.sessions[${index}]`;
    if (!isPlainRecord(session)) fail('INVALID_STATE', `${path} must be an object`);
    exactKeys(session, ['sessionId', 'poolId', 'createdDayKey', 'claimedCardIds'], path, 'INVALID_STATE');
    assertTrimmedString(session.sessionId, `${path}.sessionId`, 'INVALID_STATE');
    if (sessionIds.has(session.sessionId)) fail('INVALID_STATE', `state.sessions contains duplicate ${session.sessionId}`);
    sessionIds.add(session.sessionId);
    assertTrimmedString(session.poolId, `${path}.poolId`, 'INVALID_STATE');
    assertDayKey(session.createdDayKey, `${path}.createdDayKey`, 'INVALID_STATE');
    assertKeyList(session.claimedCardIds, `${path}.claimedCardIds`, 'INVALID_STATE');
    if (config !== undefined) {
      const pool = config.pools.find((candidate) => candidate.id === session.poolId);
      if (pool === undefined) fail('INVALID_STATE', `${path}.poolId is not configured`);
      for (const cardId of session.claimedCardIds) {
        if (!pool.cards.some((card) => card.id === cardId)) fail('INVALID_STATE', `${path} references unknown card ${cardId}`);
      }
    }
  });
}

function copyState(state: RevealRewardState): RevealRewardState {
  return freezeDeep(clone(state));
}

function copyReward(reward: RevealRewardAmounts): RevealRewardAmounts {
  return freezeDeep({ ...reward });
}

function assertBusinessKey(value: unknown, path: string): asserts value is string {
  assertTrimmedString(value, path, 'INVALID_ARGUMENT');
}

function assertDayArgument(value: unknown, path: string): asserts value is string {
  assertDayKey(value, path, 'INVALID_ARGUMENT');
}

function initialState(config: RevealRewardConfig, resources: Readonly<Record<string, number>> = { gold: 0, essence: 0 }): RevealRewardState {
  const next = {
    schemaVersion: REVEAL_REWARD_SCHEMA_VERSION,
    dayKey: '1970-01-01',
    freeClaimsUsed: 0,
    additionalClaimsGranted: 0,
    additionalClaimsUsed: 0,
    resources: { ...resources },
    processedRewardKeys: [],
    processedGrantKeys: [],
    sessions: [],
  } satisfies RevealRewardState;
  validateState(next, config);
  return copyState(next);
}

function resetDaily(state: RevealRewardState, dayKey: string): RevealRewardState {
  return {
    ...state,
    dayKey,
    freeClaimsUsed: 0,
    additionalClaimsGranted: 0,
    additionalClaimsUsed: 0,
  };
}

function poolFor(config: RevealRewardConfig, poolId: string): RevealPool {
  const pool = config.pools.find((candidate) => candidate.id === poolId);
  if (pool === undefined) fail('UNKNOWN_POOL', `unknown reveal reward pool ${poolId}`);
  return pool;
}

function rewardFor(pool: RevealPool, cardId: string): RevealCard {
  const card = pool.cards.find((candidate) => candidate.id === cardId);
  if (card === undefined) fail('CARD_NOT_FOUND', `card ${cardId} is not in pool ${pool.id}`);
  return card;
}

function grantResources(
  resources: Readonly<Record<string, number>>,
  reward: RevealRewardAmounts,
): Record<string, number> {
  const next = { ...resources };
  for (const [resource, amount] of Object.entries(reward)) {
    if (!Object.prototype.hasOwnProperty.call(next, resource)) fail('INVALID_STATE', `unknown reward resource ${resource}`);
    const total = next[resource] + amount;
    if (!Number.isSafeInteger(total)) fail('INVALID_STATE', `reward amount overflow: ${resource}`);
    next[resource] = total;
  }
  return next;
}

export const DEFAULT_REVEAL_REWARD_CONFIG: RevealRewardConfig = freezeDeep({
  dailyFreeClaims: 1,
  additionalClaimsPerCompletion: 1,
  maxDailyAdditionalClaims: 2,
  pools: [
    {
      id: 'DUNGEON-REVEAL-NORMAL',
      cards: [
        { id: 'normal-card-gold-large', rewards: { gold: 100 } },
        { id: 'normal-card-gold-small', rewards: { gold: 60 } },
        { id: 'normal-card-essence', rewards: { essence: 1 } },
      ],
    },
    {
      id: 'DUNGEON-REVEAL-HARD',
      cards: [
        { id: 'hard-card-gold-large', rewards: { gold: 220 } },
        { id: 'hard-card-gold-small', rewards: { gold: 140 } },
        { id: 'hard-card-essence', rewards: { essence: 2 } },
      ],
    },
  ],
});

export const DEFAULT_REVEAL_CONFIG = DEFAULT_REVEAL_REWARD_CONFIG;

export function validateRevealRewardConfig(value: unknown): asserts value is RevealRewardConfig {
  normalizeConfig(value);
}

export function serializeRevealRewardState(state: RevealRewardState): string {
  validateState(state);
  return JSON.stringify(state);
}

export function restoreRevealRewardState(
  serialized: string,
  config: RevealRewardConfig = DEFAULT_REVEAL_REWARD_CONFIG,
): RevealRewardState {
  const normalizedConfig = normalizeConfig(config);
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    fail('INVALID_STATE', 'reveal reward state is not valid JSON');
  }
  validateState(parsed, normalizedConfig);
  return copyState(parsed);
}

export type RevealRewardServiceOptions = Readonly<{
  config?: RevealRewardConfig;
  initialState?: string | RevealRewardState;
  resources?: Readonly<Record<string, number>>;
  persist?: RevealRewardPersistence;
}>;

/**
 * Owns daily reveal allowances, completion-granted extra reveals, pool selection,
 * and the atomic resource/idempotency save for a reveal reward.
 *
 * The dungeon service calls grantAdditionalClaims once for each successful clear.
 * A claim consumes the daily free allowance first, then the completion-granted
 * allowance. Card ids are the player's choice; a card can be revealed once per
 * dungeon session, while business keys make retries safe across reloads.
 */
export class RevealRewardService {
  private readonly config: RevealRewardConfig;
  private readonly persist: RevealRewardPersistence;
  private current: RevealRewardState;
  private committing = false;

  constructor(options: RevealRewardServiceOptions = {}) {
    this.config = normalizeConfig(options.config ?? DEFAULT_REVEAL_REWARD_CONFIG);
    this.persist = options.persist ?? (() => {});
    if (typeof this.persist !== 'function') fail('INVALID_CONFIG', 'persist must be a function');
    if (options.initialState === undefined) {
      this.current = initialState(this.config, options.resources);
    } else if (typeof options.initialState === 'string') {
      this.current = restoreRevealRewardState(options.initialState, this.config);
    } else {
      validateState(options.initialState, this.config);
      this.current = copyState(options.initialState);
    }
  }

  snapshot(): RevealRewardState {
    return this.current;
  }

  save(): string {
    return serializeRevealRewardState(this.current);
  }

  configSnapshot(): RevealRewardConfig {
    return this.config;
  }

  availableClaims(): Readonly<{
    freeRemaining: number;
    additionalRemaining: number;
    totalRemaining: number;
  }> {
    const freeRemaining = this.config.dailyFreeClaims - this.current.freeClaimsUsed;
    const additionalRemaining = this.current.additionalClaimsGranted - this.current.additionalClaimsUsed;
    return { freeRemaining, additionalRemaining, totalRemaining: freeRemaining + additionalRemaining };
  }

  session(sessionId: string): RevealSessionState {
    assertBusinessKey(sessionId, 'sessionId');
    const session = this.current.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) fail('SESSION_NOT_FOUND', `reveal session ${sessionId} was not found`);
    return session;
  }

  synchronize(dayKey: string): RevealSynchronizeResult {
    assertDayArgument(dayKey, 'dayKey');
    this.assertNotStale(dayKey);
    if (dayKey === this.current.dayKey) return { reset: false, state: this.current };
    const next = resetDaily(this.current, dayKey);
    this.commit(next);
    return { reset: true, state: this.current };
  }

  openSession(sessionId: string, poolId: string, dayKey = this.current.dayKey): RevealMutationResult {
    assertBusinessKey(sessionId, 'sessionId');
    assertBusinessKey(poolId, 'poolId');
    assertDayArgument(dayKey, 'dayKey');
    poolFor(this.config, poolId);

    const existing = this.current.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (existing !== undefined) {
      if (existing.poolId !== poolId) fail('SESSION_EXISTS', `reveal session ${sessionId} already uses another pool`);
      return { applied: false, code: 'DUPLICATE', state: this.current };
    }

    const base = this.forDay(dayKey);
    const next: RevealRewardState = {
      ...base,
      sessions: [
        ...base.sessions,
        { sessionId, poolId, createdDayKey: dayKey, claimedCardIds: [] },
      ],
    };
    this.commit(next);
    return { applied: true, code: 'APPLIED', state: this.current };
  }

  createSession(sessionId: string, poolId: string, dayKey = this.current.dayKey): RevealMutationResult {
    return this.openSession(sessionId, poolId, dayKey);
  }

  grantAdditionalClaims(
    businessKey: string,
    countOrDayKey: number | string = this.config.additionalClaimsPerCompletion,
    dayKey = this.current.dayKey,
  ): RevealMutationResult {
    assertBusinessKey(businessKey, 'businessKey');
    if (this.current.processedGrantKeys.includes(businessKey)) {
      return { applied: false, code: 'DUPLICATE', state: this.current };
    }

    let count: number;
    let effectiveDayKey = dayKey;
    if (typeof countOrDayKey === 'string') {
      effectiveDayKey = countOrDayKey;
      count = this.config.additionalClaimsPerCompletion;
    } else {
      count = countOrDayKey;
    }
    assertPositiveInteger(count, 'additionalClaims', 'INVALID_ARGUMENT');
    assertDayArgument(effectiveDayKey, 'dayKey');
    const base = this.forDay(effectiveDayKey);
    if (base.additionalClaimsGranted > this.config.maxDailyAdditionalClaims - count) {
      return { applied: false, code: 'LIMIT_REACHED', state: this.current };
    }

    const next: RevealRewardState = {
      ...base,
      additionalClaimsGranted: base.additionalClaimsGranted + count,
      processedGrantKeys: [...base.processedGrantKeys, businessKey],
    };
    this.commit(next);
    return { applied: true, code: 'APPLIED', state: this.current };
  }

  addAdditionalClaims(
    businessKey: string,
    countOrDayKey: number | string = this.config.additionalClaimsPerCompletion,
    dayKey = this.current.dayKey,
  ): RevealMutationResult {
    return this.grantAdditionalClaims(businessKey, countOrDayKey, dayKey);
  }

  reveal(sessionId: string, cardId: string, businessKey: string, dayKey = this.current.dayKey): RevealResult {
    assertBusinessKey(businessKey, 'businessKey');
    if (this.current.processedRewardKeys.includes(businessKey)) {
      return { applied: false, code: 'DUPLICATE', state: this.current, reward: null, source: null };
    }
    assertBusinessKey(sessionId, 'sessionId');
    assertBusinessKey(cardId, 'cardId');
    assertDayArgument(dayKey, 'dayKey');

    const base = this.forDay(dayKey);
    const session = base.sessions.find((candidate) => candidate.sessionId === sessionId);
    if (session === undefined) fail('SESSION_NOT_FOUND', `reveal session ${sessionId} was not found`);
    if (session.createdDayKey !== dayKey) fail('SESSION_EXPIRED', `reveal session ${sessionId} expired on ${session.createdDayKey}`);
    const pool = poolFor(this.config, session.poolId);
    const card = rewardFor(pool, cardId);
    if (session.claimedCardIds.includes(cardId)) {
      fail('CARD_ALREADY_REVEALED', `card ${cardId} was already revealed in ${sessionId}`);
    }

    const unclaimedCount = pool.cards.filter(({ id }) => !session.claimedCardIds.includes(id)).length;
    if (unclaimedCount === 0) {
      return { applied: false, code: 'POOL_EXHAUSTED', state: this.current, reward: null, source: null };
    }

    const freeRemaining = this.config.dailyFreeClaims - base.freeClaimsUsed;
    const additionalRemaining = base.additionalClaimsGranted - base.additionalClaimsUsed;
    let source: RevealClaimSource;
    let freeClaimsUsed = base.freeClaimsUsed;
    let additionalClaimsUsed = base.additionalClaimsUsed;
    if (freeRemaining > 0) {
      source = 'FREE';
      freeClaimsUsed += 1;
    } else if (additionalRemaining > 0) {
      source = 'ADDITIONAL';
      additionalClaimsUsed += 1;
    } else {
      if (base.dayKey !== this.current.dayKey) this.commit(base);
      return { applied: false, code: 'NO_CLAIMS', state: this.current, reward: null, source: null };
    }

    const next: RevealRewardState = {
      ...base,
      freeClaimsUsed,
      additionalClaimsUsed,
      resources: grantResources(base.resources, card.rewards),
      processedRewardKeys: [...base.processedRewardKeys, businessKey],
      sessions: base.sessions.map((candidate) => candidate.sessionId === sessionId
        ? { ...candidate, claimedCardIds: [...candidate.claimedCardIds, cardId] }
        : candidate),
    };
    this.commit(next);
    return {
      applied: true,
      code: 'APPLIED',
      state: this.current,
      reward: copyReward(card.rewards),
      source,
    };
  }

  claim(sessionId: string, cardId: string, businessKey: string, dayKey = this.current.dayKey): RevealResult {
    return this.reveal(sessionId, cardId, businessKey, dayKey);
  }

  private forDay(dayKey: string): RevealRewardState {
    this.assertNotStale(dayKey);
    if (dayKey === this.current.dayKey) return this.current;
    return resetDaily(this.current, dayKey);
  }

  private assertNotStale(dayKey: string): void {
    if (dayKey < this.current.dayKey) {
      fail('STALE_DAY', `day ${dayKey} is before current reveal day ${this.current.dayKey}`);
    }
  }

  private commit(next: RevealRewardState): void {
    if (this.committing) fail('PERSISTENCE_REENTRANT', 'reveal reward persistence re-entered settlement');
    validateState(next, this.config);
    this.committing = true;
    try {
      this.persist(JSON.stringify(next));
    } catch (error) {
      fail('PERSISTENCE_FAILED', error instanceof Error ? error.message : String(error));
    } finally {
      this.committing = false;
    }
    this.current = copyState(next);
  }
}
