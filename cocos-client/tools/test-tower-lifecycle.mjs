import assert from 'node:assert/strict';
import {
  DEFAULT_TOWER_TICKETS,
  TOWER_FLOOR_COUNT,
  TowerLifecycleError,
  TowerLifecycleService,
  restoreTowerLifecycle,
  serializeTowerLifecycle,
  towerCycleKeyAt,
} from '../assets/scripts/pve/tower/lifecycle/TowerLifecycle.ts';
import { towerConfig } from '../assets/scripts/pve/tower/TowerConfig.ts';

const shanghai = (local) => Date.parse(`${local}+08:00`);
const day = (local) => local.slice(0, 10);
let now = shanghai('2026-08-20T10:00:00');
const clock = { now: () => now };
const saved = [];

assert.equal(towerConfig.floors.length, TOWER_FLOOR_COUNT, 'lifecycle must use the configured 50-floor tower');
assert.equal(towerCycleKeyAt(shanghai('2026-08-23T23:59:59')), '2026-08-17');
assert.equal(towerCycleKeyAt(shanghai('2026-08-24T04:59:59')), '2026-08-17');
assert.equal(towerCycleKeyAt(shanghai('2026-08-24T05:00:00')), '2026-08-24');
assert.equal(towerCycleKeyAt(shanghai('2026-08-24T05:00:01')), '2026-08-24');
assert.equal(new TowerLifecycleService({ clock }).snapshot().tickets, DEFAULT_TOWER_TICKETS);

const service = new TowerLifecycleService({ clock, tickets: 2, persist: (value) => saved.push(value) });
assert.equal(service.snapshot().status, 'ready');
assert.equal(service.snapshot().floor, 1);
assert.equal(service.snapshot().bestFloor, 0);
assert.equal(service.snapshot().tickets, 2);
assert(Object.isFrozen(service.snapshot()));

const firstEntry = service.startChallenge(now);
assert.equal(firstEntry.status, 'active');
assert.equal(firstEntry.activeAttempt.cost, 'FREE', 'the first challenge of the day must be free');
assert.equal(firstEntry.tickets, 2);
assert.equal(firstEntry.freeEntryDayKey, day('2026-08-20T10:00:00'));
const firstAttemptId = firstEntry.activeAttempt.attemptId;
assert.throws(
  () => service.startChallenge(now),
  (error) => error instanceof TowerLifecycleError && error.code === 'INVALID_TRANSITION',
);
assert.throws(
  () => service.completeBattle({ outcome: 'won', attemptId: firstAttemptId + 1 }, now),
  (error) => error instanceof TowerLifecycleError && error.code === 'INVALID_TRANSITION',
);
assert.equal(service.snapshot().status, 'active', 'a stale result must not settle the active attempt');

const afterFirstWin = service.completeBattle({ outcome: 'won', attemptId: firstAttemptId }, now);
assert.equal(afterFirstWin.status, 'ready');
assert.equal(afterFirstWin.floor, 2);
assert.equal(afterFirstWin.bestFloor, 1);
assert.equal(afterFirstWin.tickets, 2);

const paidEntry = service.startChallenge(now);
assert.equal(paidEntry.activeAttempt.cost, 'TICKET');
assert.equal(paidEntry.tickets, 1);
service.completeBattle({ outcome: 'lost', attemptId: paidEntry.activeAttempt.attemptId }, now);
assert.equal(service.snapshot().status, 'failed');
assert.equal(service.snapshot().floor, 2);
assert.equal(service.snapshot().lastFailure.cost, 'TICKET');
assert.equal(service.snapshot().tickets, 1, 'failure keeps the paid entry consumed');
assert.throws(
  () => service.startChallenge(now),
  (error) => error instanceof TowerLifecycleError && error.code === 'INVALID_TRANSITION',
);

const continued = service.continueChallenge(now);
assert.equal(continued.status, 'active');
assert.equal(continued.activeAttempt.cost, 'TICKET');
assert.equal(continued.tickets, 0, 'continuing a failed floor consumes one ticket');
service.completeBattle({ outcome: 'won', attemptId: continued.activeAttempt.attemptId }, now);
assert.equal(service.snapshot().floor, 3);
assert.equal(service.snapshot().bestFloor, 2);
assert.throws(
  () => service.startChallenge(now),
  (error) => error instanceof TowerLifecycleError && error.code === 'TICKETS_EXHAUSTED',
);

now = shanghai('2026-08-21T10:00:00');
const nextDayFree = service.startChallenge(now);
assert.equal(nextDayFree.activeAttempt.cost, 'FREE', 'the free entry is per local calendar day');
service.completeBattle({ outcome: 'won' }, now);
assert.equal(service.snapshot().floor, 4);

const restored = new TowerLifecycleService({ clock, initialState: service.save() });
assert.deepEqual(restored.snapshot(), service.snapshot(), 'a valid persisted state must round-trip exactly');
assert.deepEqual(restoreTowerLifecycle(service.save()), service.snapshot());
assert.equal(serializeTowerLifecycle(service.snapshot()), service.save());

const finalState = JSON.stringify({
  schemaVersion: 1,
  cycleKey: towerCycleKeyAt(now),
  status: 'ready',
  floor: 50,
  bestFloor: 49,
  tickets: 0,
  freeEntryDayKey: null,
  attemptCount: 49,
  activeAttempt: null,
  lastFailure: null,
  lastReset: null,
});
const finalService = new TowerLifecycleService({ clock, initialState: finalState });
finalService.startChallenge(now);
finalService.completeBattle({ outcome: 'won' }, now);
assert.equal(finalService.snapshot().status, 'completed');
assert.equal(finalService.snapshot().floor, 50);
assert.equal(finalService.snapshot().bestFloor, 50);
assert.throws(
  () => finalService.startChallenge(now),
  (error) => error instanceof TowerLifecycleError && error.code === 'TOWER_COMPLETED',
);

const resetAt = shanghai('2026-08-23T12:00:00');
let resetNow = resetAt;
const resetClock = { now: () => resetNow };
const paidState = JSON.stringify({
  schemaVersion: 1,
  cycleKey: towerCycleKeyAt(resetAt),
  status: 'ready',
  floor: 5,
  bestFloor: 4,
  tickets: 1,
  freeEntryDayKey: day('2026-08-23T12:00:00'),
  attemptCount: 8,
  activeAttempt: null,
  lastFailure: null,
  lastReset: null,
});
const resetService = new TowerLifecycleService({ clock: resetClock, initialState: paidState });
const paidResetEntry = resetService.startChallenge(resetAt);
assert.equal(paidResetEntry.activeAttempt.cost, 'TICKET');
assert.equal(paidResetEntry.tickets, 0);
resetService.completeBattle({ outcome: 'lost' }, resetAt);
resetNow = shanghai('2026-08-24T05:00:00');
const resetResult = resetService.synchronize(resetNow);
assert(resetResult.reset);
assert.equal(resetResult.reset.compensationTickets, 1);
assert.equal(resetService.snapshot().status, 'ready');
assert.equal(resetService.snapshot().floor, 1);
assert.equal(resetService.snapshot().bestFloor, 4, 'weekly reset must not erase the all-time best floor');
assert.equal(resetService.snapshot().tickets, 1, 'a paid failed attempt invalidated by reset is refunded once');
assert.equal(resetService.snapshot().freeEntryDayKey, null);
assert.equal(resetService.synchronize(resetNow).reset, null, 'the same reset must be idempotent');
const afterResetFree = resetService.startChallenge(resetNow);
assert.equal(afterResetFree.activeAttempt.cost, 'FREE');

let boundaryNow = shanghai('2026-08-24T04:59:59');
const boundaryService = new TowerLifecycleService({ clock: { now: () => boundaryNow }, tickets: 0 });
assert.equal(boundaryService.synchronize(boundaryNow).reset, null);
boundaryNow = shanghai('2026-08-24T05:00:00');
assert.equal(boundaryService.synchronize(boundaryNow).reset.compensationTickets, 0);
assert.equal(boundaryService.snapshot().floor, 1);
assert.equal(boundaryService.snapshot().status, 'ready');

const noTicketState = JSON.stringify({
  schemaVersion: 1,
  cycleKey: towerCycleKeyAt(now),
  status: 'failed',
  floor: 4,
  bestFloor: 3,
  tickets: 0,
  freeEntryDayKey: day('2026-08-21T10:00:00'),
  attemptCount: 2,
  activeAttempt: null,
  lastFailure: { attemptId: 2, floor: 4, cost: 'FREE', failedAt: now },
  lastReset: null,
});
const noTicketService = new TowerLifecycleService({ clock, initialState: noTicketState });
const noTicketSnapshot = noTicketService.snapshot();
assert.throws(
  () => noTicketService.continueChallenge(now),
  (error) => error instanceof TowerLifecycleError && error.code === 'TICKETS_EXHAUSTED',
);
assert.strictEqual(noTicketService.snapshot(), noTicketSnapshot, 'ticket exhaustion must not mutate the save');
assert.throws(
  () => noTicketService.completeBattle({ outcome: 'won' }, now),
  (error) => error instanceof TowerLifecycleError && error.code === 'INVALID_TRANSITION',
);

for (const invalidState of [
  '',
  '{',
  JSON.stringify({ ...JSON.parse(service.save()), extra: true }),
  JSON.stringify({ ...JSON.parse(service.save()), status: 'active' }),
  JSON.stringify({ ...JSON.parse(service.save()), floor: 0 }),
  JSON.stringify({ ...JSON.parse(service.save()), floor: TOWER_FLOOR_COUNT }),
]) {
  assert.throws(
    () => restoreTowerLifecycle(invalidState),
    (error) => error instanceof TowerLifecycleError && error.code === 'INVALID_STATE',
    `invalid save must be rejected: ${invalidState.slice(0, 24)}`,
  );
}
assert.throws(
  () => new TowerLifecycleService({ tickets: -1 }),
  (error) => error instanceof TowerLifecycleError && error.code === 'INVALID_CONFIG',
);
assert.throws(
  () => new TowerLifecycleService({ timezone: 'Not/A-Timezone' }),
  (error) => error instanceof TowerLifecycleError && error.code === 'INVALID_CONFIG',
);
const nonEnumerableState = JSON.parse(service.save());
Object.defineProperty(nonEnumerableState, 'hidden', { value: true });
assert.throws(
  () => serializeTowerLifecycle(nonEnumerableState),
  (error) => error instanceof TowerLifecycleError && error.code === 'INVALID_STATE',
);

let persistenceShouldFail = true;
const persistenceService = new TowerLifecycleService({
  clock,
  persist: () => {
    if (persistenceShouldFail) throw new Error('storage unavailable');
  },
});
const beforePersistenceFailure = persistenceService.snapshot();
assert.throws(
  () => persistenceService.startChallenge(now),
  (error) => error instanceof TowerLifecycleError && error.code === 'PERSISTENCE_FAILED',
);
assert.strictEqual(persistenceService.snapshot(), beforePersistenceFailure, 'failed persistence must leave memory unchanged');
persistenceShouldFail = false;
persistenceService.startChallenge(now);
assert.equal(persistenceService.snapshot().status, 'active');

console.log(`T220 tower lifecycle PASS: floors=${TOWER_FLOOR_COUNT}, daily-free=2, paid-retry=1, weekly-reset=2, invalid-cases=16, saves=${saved.length}`);
