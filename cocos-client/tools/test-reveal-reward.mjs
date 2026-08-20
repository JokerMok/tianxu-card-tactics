import assert from 'node:assert/strict';
import {
  REVEAL_REWARD_SCHEMA_VERSION,
  RevealRewardError,
  RevealRewardService,
  restoreRevealRewardState,
  serializeRevealRewardState,
  validateRevealRewardConfig,
} from '../assets/scripts/pve/reveal/RevealReward.ts';

const config = {
  dailyFreeClaims: 1,
  additionalClaimsPerCompletion: 1,
  maxDailyAdditionalClaims: 2,
  pools: [
    {
      id: 'NORMAL',
      cards: [
        { id: 'normal-gold', rewards: { gold: 100 } },
        { id: 'normal-essence', rewards: { essence: 2 } },
        { id: 'normal-bundle', rewards: { gold: 10, essence: 1 } },
      ],
    },
    {
      id: 'HARD',
      cards: [
        { id: 'hard-gold', rewards: { gold: 220 } },
        { id: 'hard-essence', rewards: { essence: 3 } },
      ],
    },
  ],
};

const DAY_ONE = '2026-08-20';
const DAY_TWO = '2026-08-21';
const FUTURE_DAY = '2099-01-01';
const localDayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const saves = [];
const service = new RevealRewardService({
  config,
  resources: { gold: 0, essence: 0 },
  todayDayKey: DAY_ONE,
  persist: (serialized) => saves.push(serialized),
});

validateRevealRewardConfig(config);
assert.equal(service.snapshot().schemaVersion, REVEAL_REWARD_SCHEMA_VERSION);
assert.deepEqual(service.availableClaims(), { freeRemaining: 1, additionalRemaining: 0, totalRemaining: 1 });
assert.equal(service.synchronize(DAY_ONE).reset, false, 'initial state already uses the injected business day');
assert.equal(service.synchronize(DAY_ONE).reset, false, 'same day synchronization must be idempotent');
assert.throws(
  () => service.synchronize('2026-08-19'),
  (error) => error instanceof RevealRewardError && error.code === 'STALE_DAY',
  'a stale calendar day must not replay the free allowance',
);
assert.throws(
  () => service.synchronize(DAY_TWO),
  (error) => error instanceof RevealRewardError && error.code === 'FUTURE_DAY',
  'a future calendar day must not advance daily allowances',
);
const realDayService = new RevealRewardService({ config });
assert.equal(realDayService.snapshot().dayKey, localDayKey(new Date()), 'default day must use the local calendar day');
assert.throws(
  () => realDayService.synchronize(localDayKey(new Date(Date.now() + 86_400_000))),
  (error) => error instanceof RevealRewardError && error.code === 'FUTURE_DAY',
  'the default local calendar day must reject a future synchronization day',
);

const opened = service.openSession('run-normal-1', 'NORMAL', DAY_ONE);
assert.equal(opened.code, 'APPLIED');
assert.deepEqual(service.session('run-normal-1').claimedCardIds, []);
assert.deepEqual(service.availableClaims(), { freeRemaining: 1, additionalRemaining: 0, totalRemaining: 1 });
assert.throws(
  () => service.openSession('run-future', 'NORMAL', DAY_TWO),
  (error) => error instanceof RevealRewardError && error.code === 'FUTURE_DAY',
);
assert.throws(
  () => service.grantAdditionalClaims('clear:future', DAY_TWO),
  (error) => error instanceof RevealRewardError && error.code === 'FUTURE_DAY',
);
assert.throws(
  () => service.reveal('run-normal-1', 'normal-gold', 'reveal:future', DAY_TWO),
  (error) => error instanceof RevealRewardError && error.code === 'FUTURE_DAY',
);
assert.throws(
  () => service.reveal('run-normal-1', 'unknown-card', 'reveal:unknown-card-before-exhaustion', DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'CARD_NOT_FOUND',
);

const freeReveal = service.reveal('run-normal-1', 'normal-gold', 'reveal:run-normal-1:gold', DAY_ONE);
assert.equal(freeReveal.code, 'APPLIED');
assert.equal(freeReveal.source, 'FREE');
assert.deepEqual(freeReveal.reward, { gold: 100 });
assert.deepEqual(service.snapshot().resources, { gold: 100, essence: 0 });
assert.deepEqual(service.availableClaims(), { freeRemaining: 0, additionalRemaining: 0, totalRemaining: 0 });
assert.deepEqual(service.session('run-normal-1').claimedCardIds, ['normal-gold']);
assert.throws(
  () => service.reveal('run-normal-1', 'normal-gold', 'reveal:run-normal-1:gold-retry', DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'CARD_ALREADY_REVEALED',
  'a repeated card must remain a card-level duplicate while another card is unclaimed',
);

const saveCountAfterFreeReveal = saves.length;
const duplicate = service.reveal('run-normal-1', 'normal-essence', 'reveal:run-normal-1:gold', DAY_ONE);
assert.equal(duplicate.code, 'DUPLICATE');
assert.equal(duplicate.applied, false);
assert.equal(saves.length, saveCountAfterFreeReveal, 'duplicate reveal must not persist');
assert.deepEqual(service.snapshot().resources, { gold: 100, essence: 0 });
assert.deepEqual(service.session('run-normal-1').claimedCardIds, ['normal-gold']);

const firstExtra = service.grantAdditionalClaims('clear:run-normal-1', DAY_ONE);
assert.equal(firstExtra.code, 'APPLIED');
assert.equal(service.availableClaims().additionalRemaining, 1);
const duplicateExtra = service.grantAdditionalClaims('clear:run-normal-1', DAY_ONE);
assert.equal(duplicateExtra.code, 'DUPLICATE');
assert.equal(service.availableClaims().additionalRemaining, 1, 'duplicate completion must not add an extra claim');

const additionalReveal = service.reveal('run-normal-1', 'normal-essence', 'reveal:run-normal-1:essence', DAY_ONE);
assert.equal(additionalReveal.source, 'ADDITIONAL');
assert.deepEqual(additionalReveal.reward, { essence: 2 });
assert.deepEqual(service.snapshot().resources, { gold: 100, essence: 2 });
assert.deepEqual(service.availableClaims(), { freeRemaining: 0, additionalRemaining: 0, totalRemaining: 0 });

const noClaimsSaveCount = saves.length;
const noClaims = service.reveal('run-normal-1', 'normal-bundle', 'reveal:run-normal-1:bundle', DAY_ONE);
assert.equal(noClaims.code, 'NO_CLAIMS');
assert.equal(noClaims.applied, false);
assert.equal(saves.length, noClaimsSaveCount, 'no-claim rejection must not persist or consume a card');
assert.deepEqual(service.snapshot().resources, { gold: 100, essence: 2 });
assert.deepEqual(service.session('run-normal-1').claimedCardIds, ['normal-gold', 'normal-essence']);

assert.equal(service.grantAdditionalClaims('clear:run-normal-1:second', 1, DAY_ONE).code, 'APPLIED');
const bundle = service.reveal('run-normal-1', 'normal-bundle', 'reveal:run-normal-1:bundle', DAY_ONE);
assert.equal(bundle.source, 'ADDITIONAL');
assert.deepEqual(bundle.reward, { gold: 10, essence: 1 });
assert.deepEqual(service.snapshot().resources, { gold: 110, essence: 3 });
assert.deepEqual(service.session('run-normal-1').claimedCardIds, ['normal-gold', 'normal-essence', 'normal-bundle']);

assert.equal(
  service.reveal('run-normal-1', 'normal-bundle', 'reveal:run-normal-1:bundle-retry', DAY_ONE).code,
  'POOL_EXHAUSTED',
  'a fully revealed pool must report exhaustion before card validation',
);
assert.throws(
  () => service.openSession('run-normal-1', 'HARD', DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'SESSION_EXISTS',
);
assert.throws(
  () => service.reveal('missing-run', 'normal-gold', 'reveal:missing', DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'SESSION_NOT_FOUND',
);
assert.equal(
  service.reveal('run-normal-1', 'unknown-card', 'reveal:unknown-card', DAY_ONE).code,
  'POOL_EXHAUSTED',
  'a fully revealed pool must report exhaustion before validating an unknown card',
);
assert.throws(
  () => service.openSession('run-unknown-pool', 'UNKNOWN', DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'UNKNOWN_POOL',
);

const cappedGrant = service.grantAdditionalClaims('clear:run-normal-1:over-cap', 1, DAY_ONE);
assert.equal(cappedGrant.code, 'LIMIT_REACHED');
assert.equal(cappedGrant.applied, false);
assert(!service.snapshot().processedGrantKeys.includes('clear:run-normal-1:over-cap'), 'rejected grant must remain retryable');

const persisted = service.save();
assert.equal(persisted, saves.at(-1));
assert.deepEqual(restoreRevealRewardState(persisted, config, DAY_ONE), service.snapshot());
assert.deepEqual(restoreRevealRewardState(serializeRevealRewardState(service.snapshot()), config, DAY_ONE), service.snapshot());
assert(Object.isFrozen(service.snapshot()));
assert(Object.isFrozen(service.snapshot().sessions));
assert.throws(() => { service.snapshot().resources.gold = 999; }, TypeError, 'snapshots must be immutable');

const reloadedSaves = [];
const reloaded = new RevealRewardService({
  config,
  initialState: persisted,
  todayDayKey: DAY_ONE,
  persist: (serialized) => reloadedSaves.push(serialized),
});
const reloadedDuplicate = reloaded.reveal('run-normal-1', 'normal-gold', 'reveal:run-normal-1:gold', DAY_ONE);
assert.equal(reloadedDuplicate.code, 'DUPLICATE');
assert.equal(reloadedSaves.length, 0, 'a reloaded duplicate must not persist');
assert.deepEqual(reloaded.snapshot(), service.snapshot());

let rolloverTodayDayKey = DAY_ONE;
const rollover = new RevealRewardService({
  config,
  resources: { gold: 0, essence: 0 },
  todayDayKey: () => rolloverTodayDayKey,
});
rollover.synchronize(DAY_ONE);
rollover.openSession('run-expired', 'NORMAL', DAY_ONE);
rollover.grantAdditionalClaims('clear:expired', DAY_ONE);
rollover.reveal('run-expired', 'normal-gold', 'reveal:expired:gold', DAY_ONE);
rolloverTodayDayKey = DAY_TWO;
const reset = rollover.synchronize(DAY_TWO);
assert.equal(reset.reset, true);
assert.deepEqual(rollover.availableClaims(), { freeRemaining: 1, additionalRemaining: 0, totalRemaining: 1 });
assert.throws(
  () => rollover.reveal('run-expired', 'normal-essence', 'reveal:expired:essence', DAY_TWO),
  (error) => error instanceof RevealRewardError && error.code === 'SESSION_EXPIRED',
  'a session cannot carry a previous day allowance into a new day',
);
rollover.openSession('run-day-two', 'HARD', DAY_TWO);
const dayTwoReveal = rollover.reveal('run-day-two', 'hard-essence', 'reveal:day-two:essence', DAY_TWO);
assert.equal(dayTwoReveal.source, 'FREE');
assert.deepEqual(rollover.snapshot().resources, { gold: 100, essence: 3 });

let failPersistence = true;
const rollback = new RevealRewardService({
  config,
  resources: { gold: 0, essence: 0 },
  todayDayKey: DAY_ONE,
  persist: () => {
    if (failPersistence) throw new Error('disk full');
  },
});
failPersistence = false;
rollback.synchronize(DAY_ONE);
rollback.openSession('run-rollback', 'NORMAL', DAY_ONE);
failPersistence = true;
const beforeFailure = rollback.snapshot();
assert.throws(
  () => rollback.reveal('run-rollback', 'normal-gold', 'reveal:rollback:gold', DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'PERSISTENCE_FAILED',
);
assert.strictEqual(rollback.snapshot(), beforeFailure, 'failed persistence must leave the whole reward state unchanged');
failPersistence = false;
assert.equal(rollback.reveal('run-rollback', 'normal-gold', 'reveal:rollback:gold', DAY_ONE).code, 'APPLIED');
assert.deepEqual(rollback.snapshot().resources, { gold: 100, essence: 0 });

const invalidConfigs = [
  ['missing pool cards', (candidate) => { candidate.pools[0].cards = []; }],
  ['duplicate pool id', (candidate) => { candidate.pools[1].id = candidate.pools[0].id; }],
  ['duplicate card id', (candidate) => { candidate.pools[0].cards[1].id = candidate.pools[0].cards[0].id; }],
  ['zero reward', (candidate) => { candidate.pools[0].cards[0].rewards.gold = 0; }],
  ['negative free claims', (candidate) => { candidate.dailyFreeClaims = -1; }],
];
for (const [label, mutate] of invalidConfigs) {
  const candidate = structuredClone(config);
  mutate(candidate);
  assert.throws(
    () => validateRevealRewardConfig(candidate),
    (error) => error instanceof RevealRewardError && error.code === 'INVALID_CONFIG',
    label,
  );
}

const zeroConfig = structuredClone(config);
zeroConfig.additionalClaimsPerCompletion = 0;
validateRevealRewardConfig(zeroConfig);
const zeroSaves = [];
const zeroService = new RevealRewardService({
  config: zeroConfig,
  todayDayKey: DAY_ONE,
  persist: (serialized) => zeroSaves.push(serialized),
});
assert.equal(zeroService.snapshot().dayKey, DAY_ONE, 'injected business day must seed initial state');
assert.equal(zeroService.grantAdditionalClaims('clear:zero', DAY_ONE).code, 'NO_OP');
assert.equal(zeroService.snapshot().additionalClaimsGranted, 0);
assert(zeroService.snapshot().processedGrantKeys.includes('clear:zero'), 'zero grant must be marked processed');
assert.equal(zeroService.grantAdditionalClaims('clear:zero', DAY_ONE).code, 'DUPLICATE');
assert.equal(zeroService.grantAdditionalClaims('clear:zero-explicit', 0, DAY_ONE).code, 'NO_OP');
assert.equal(zeroSaves.length, 2, 'zero grants persist once and duplicate retries do not persist');

const singleCardService = new RevealRewardService({
  config: {
    dailyFreeClaims: 2,
    additionalClaimsPerCompletion: 0,
    maxDailyAdditionalClaims: 0,
    pools: [{ id: 'SINGLE', cards: [{ id: 'only-card', rewards: { gold: 1 } }] }],
  },
  todayDayKey: DAY_ONE,
});
singleCardService.openSession('run-single', 'SINGLE', DAY_ONE);
assert.equal(singleCardService.reveal('run-single', 'only-card', 'reveal:single:first', DAY_ONE).code, 'APPLIED');
assert.equal(
  singleCardService.reveal('run-single', 'only-card', 'reveal:single:second', DAY_ONE).code,
  'POOL_EXHAUSTED',
  'a single-card pool must report exhaustion after its only card is revealed',
);

const validState = JSON.parse(persisted);
const invalidStates = [
  { ...validState, extra: true },
  { ...validState, dayKey: '2026-02-30' },
  { ...validState, additionalClaimsUsed: validState.additionalClaimsGranted + 1 },
  { ...validState, processedRewardKeys: [...validState.processedRewardKeys, validState.processedRewardKeys[0]] },
  { ...validState, sessions: [{ ...validState.sessions[0], claimedCardIds: ['unknown-card'] }] },
];
for (const invalidState of invalidStates) {
  assert.throws(
    () => restoreRevealRewardState(JSON.stringify(invalidState), config, DAY_ONE),
    (error) => error instanceof RevealRewardError && error.code === 'INVALID_STATE',
    `invalid reveal save must be rejected: ${JSON.stringify(invalidState).slice(0, 60)}`,
  );
}
assert.throws(
  () => restoreRevealRewardState('{', config, DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'INVALID_STATE',
);

const futureState = { ...validState, dayKey: FUTURE_DAY };
assert.throws(
  () => restoreRevealRewardState(JSON.stringify(futureState), config, DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'INVALID_STATE',
  'a future state day must not be restored',
);
const futureSessionState = {
  ...validState,
  sessions: validState.sessions.map((session) => ({ ...session, createdDayKey: FUTURE_DAY })),
};
assert.throws(
  () => restoreRevealRewardState(JSON.stringify(futureSessionState), config, DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'INVALID_STATE',
  'a future session day must not be restored',
);
assert.throws(
  () => new RevealRewardService({ config, initialState: JSON.stringify(futureState), todayDayKey: DAY_ONE }),
  (error) => error instanceof RevealRewardError && error.code === 'INVALID_STATE',
  'initial state validation must reject a future state day',
);
assert.throws(
  () => new RevealRewardService({ config, initialState: futureSessionState, todayDayKey: DAY_ONE }),
  (error) => error instanceof RevealRewardError && error.code === 'INVALID_STATE',
  'initial state validation must reject a future session day',
);
const sessionAheadOfState = { ...validState, dayKey: '2026-08-19' };
assert.throws(
  () => restoreRevealRewardState(JSON.stringify(sessionAheadOfState), config, DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'INVALID_STATE',
  'a restored session must not be newer than its saved state day',
);

const nonEnumerableState = JSON.parse(persisted);
Object.defineProperty(nonEnumerableState, 'hidden', { value: true });
assert.throws(
  () => serializeRevealRewardState(nonEnumerableState),
  (error) => error instanceof RevealRewardError && error.code === 'INVALID_STATE',
  'non-enumerable save fields must not bypass the schema check',
);

let reentrantService;
let reentrantError;
let reenterOnPersist = false;
reentrantService = new RevealRewardService({
  config,
  resources: { gold: 0, essence: 0 },
  todayDayKey: DAY_ONE,
  persist: () => {
    if (!reenterOnPersist) return;
    try {
      reentrantService.reveal('run-reentrant', 'normal-gold', 'reveal:reentrant:inner', DAY_ONE);
    } catch (error) {
      reentrantError = error;
      throw error;
    }
  },
});
reentrantService.synchronize(DAY_ONE);
reentrantService.openSession('run-reentrant', 'NORMAL', DAY_ONE);
reenterOnPersist = true;
assert.throws(
  () => reentrantService.reveal('run-reentrant', 'normal-gold', 'reveal:reentrant:outer', DAY_ONE),
  (error) => error instanceof RevealRewardError && error.code === 'PERSISTENCE_FAILED',
  're-entrant persistence must fail the outer transaction',
);
assert(reentrantError instanceof RevealRewardError && reentrantError.code === 'PERSISTENCE_REENTRANT');
assert.deepEqual(reentrantService.snapshot().resources, { gold: 0, essence: 0 });

console.log(`T218 reveal reward PASS: pools=${config.pools.length}, cards=${config.pools.reduce((total, pool) => total + pool.cards.length, 0)}, free-claims=2, additional-claims=3, invalid-cases=${invalidConfigs.length + invalidStates.length + 4}, saves=${saves.length}`);
