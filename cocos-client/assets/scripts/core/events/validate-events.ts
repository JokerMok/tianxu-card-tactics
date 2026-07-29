import assert from 'node:assert/strict';
import { createEventQueue, dequeue, drain, enqueue, enqueueBatch, event, peek } from './index.ts';

const initial = createEventQueue();
const ordered = enqueueBatch(initial, [
  event('BATTLE_START', 'player', { seed: 1 }),
  event('TURN_START', 'player'),
  event('ATTACK', 'player', { sourceId: 'u1', targetId: 'u2' }),
  event('DAMAGE', 'enemy', { value: 3 }),
  event('UNIT_DIED', 'enemy', { unitId: 'u2' }),
  event('BATTLE_END', 'player', { winner: 'player' }),
]);
assert.deepEqual(ordered.events.map((item) => item.type), ['BATTLE_START', 'TURN_START', 'ATTACK', 'DAMAGE', 'UNIT_DIED', 'BATTLE_END']);
assert.deepEqual(ordered.events.map((item) => item.eventId), [1, 2, 3, 4, 5, 6]);
assert.equal(peek(ordered)?.type, 'BATTLE_START');
const first = dequeue(ordered);
assert.equal(first.event?.eventId, 1);
assert.equal(first.queue.events.length, 5);
assert.equal(ordered.events.length, 6, 'dequeue must preserve the previous queue');
const drained = drain(first.queue);
assert.equal(drained.events.length, 5);
assert.equal(drained.queue.events.length, 0);
assert.equal(dequeue(drained.queue).event, undefined);
const appended = enqueue(drained.queue, event('ROUND_END', 'enemy'));
assert.equal(appended.events[0].eventId, 7, 'event ids remain monotonic after draining');
assert.throws(() => createEventQueue(0), /invalid/);

console.log('T025 events PASS: stable battle event ordering, monotonic IDs, immutable queue operations');
