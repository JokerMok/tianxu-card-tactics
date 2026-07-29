import type { BattleEvent, Side } from '../types/index.ts';

export type EventInput = Omit<BattleEvent, 'eventId'>;

export interface EventQueue {
  readonly nextEventId: number;
  readonly events: readonly BattleEvent[];
}

export interface DequeueResult {
  readonly event: BattleEvent | undefined;
  readonly queue: EventQueue;
}

export function createEventQueue(nextEventId = 1): EventQueue {
  if (!Number.isSafeInteger(nextEventId) || nextEventId < 1) throw new Error('nextEventId is invalid');
  return { nextEventId, events: [] };
}

export function enqueue(queue: EventQueue, input: EventInput): EventQueue {
  const event: BattleEvent = { ...input, eventId: queue.nextEventId };
  return { nextEventId: queue.nextEventId + 1, events: [...queue.events, event] };
}

export function enqueueBatch(queue: EventQueue, inputs: readonly EventInput[]): EventQueue {
  return inputs.reduce(enqueue, queue);
}

export function peek(queue: EventQueue): BattleEvent | undefined {
  return queue.events[0];
}

export function dequeue(queue: EventQueue): DequeueResult {
  return { event: peek(queue), queue: queue.events.length === 0 ? queue : { ...queue, events: queue.events.slice(1) } };
}

export function drain(queue: EventQueue): { readonly events: readonly BattleEvent[]; readonly queue: EventQueue } {
  return { events: [...queue.events], queue: { ...queue, events: [] } };
}

export function event(type: string, activeSide: Side, payload: Readonly<Record<string, unknown>> = {}): EventInput {
  return { round: 1, turn: 1, activeSide, rngCursor: 0, type, payload };
}
