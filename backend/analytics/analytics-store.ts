import { ANALYTICS_MAX_BATCH_SIZE, type AnalyticsCategory, type AnalyticsEvent, assertAnalyticsEvent, canonicalJson, cloneAnalyticsEvent } from '../../cocos-client/assets/scripts/services/telemetry/analytics-contract.ts';

export interface AnalyticsQuery { readonly category?: AnalyticsCategory; readonly type?: string; readonly playerId?: string; readonly sessionId?: string; readonly fromOccurredAt?: number; readonly toOccurredAt?: number; readonly afterSequence?: number; readonly limit?: number; }
export interface AnalyticsAppendResult { readonly eventId: string; readonly accepted: boolean; readonly idempotent: boolean; }
export interface AnalyticsSummary { readonly total: number; readonly byCategory: Readonly<Record<AnalyticsCategory, number>>; readonly byType: Readonly<Record<string, number>>; readonly outcomes: Readonly<Record<string, number>>; }
export class AnalyticsStoreError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.name = 'AnalyticsStoreError'; this.code = code; } }
function fail(code: string, message: string): never { throw new AnalyticsStoreError(code, message); }
function streamKey(event: AnalyticsEvent): string { return `${event.playerId}\u0000${event.sessionId}`; }
function validateQuery(query: AnalyticsQuery): void { if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)) fail('INVALID_QUERY', 'limit must be 1..1000'); for (const key of ['fromOccurredAt', 'toOccurredAt', 'afterSequence'] as const) if (query[key] !== undefined && (!Number.isSafeInteger(query[key]) || query[key] < 0)) fail('INVALID_QUERY', `${key} must be a non-negative safe integer`); if (query.fromOccurredAt !== undefined && query.toOccurredAt !== undefined && query.fromOccurredAt > query.toOccurredAt) fail('INVALID_QUERY', 'time range is inverted'); }

export class AnalyticsStore {
  private readonly events: AnalyticsEvent[] = [];
  private readonly byId = new Map<string, AnalyticsEvent>();
  private readonly lastSequence = new Map<string, number>();
  constructor(initialEvents: readonly AnalyticsEvent[] = []) { if (!Array.isArray(initialEvents)) fail('INVALID_EVENT', 'initial events must be an array'); if (initialEvents.length > 0) this.appendBatch(initialEvents); }
  append(event: unknown): AnalyticsAppendResult { return this.appendBatch([event])[0]; }
  appendBatch(rawEvents: readonly unknown[]): readonly AnalyticsAppendResult[] {
    if (!Array.isArray(rawEvents) || rawEvents.length < 1 || rawEvents.length > ANALYTICS_MAX_BATCH_SIZE) fail('INVALID_BATCH', `analytics batch must contain 1..${ANALYTICS_MAX_BATCH_SIZE} events`);
    const localIds = new Map<string, AnalyticsEvent>(); const localSequences = new Map(this.lastSequence); const pending: AnalyticsEvent[] = []; const results: AnalyticsAppendResult[] = [];
    for (const raw of rawEvents) {
      const eventId = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as { eventId?: unknown }).eventId : undefined;
      const existing = typeof eventId === 'string' ? (this.byId.get(eventId) ?? localIds.get(eventId)) : undefined;
      if (existing) { if (canonicalJson(existing) !== canonicalJson(raw)) fail('IDEMPOTENCY_CONFLICT', `eventId ${eventId} was reused with different payload`); results.push({ eventId, accepted: false, idempotent: true }); continue; }
      assertAnalyticsEvent(raw); const event = cloneAnalyticsEvent(raw); const key = streamKey(event); const expected = (localSequences.get(key) ?? 0) + 1;
      if (event.sequence !== expected) fail('OUT_OF_ORDER', `sequence ${event.sequence} must be ${expected} for ${key}`);
      localSequences.set(key, event.sequence); localIds.set(event.eventId, event); pending.push(event); results.push({ eventId: event.eventId, accepted: true, idempotent: false });
    }
    for (const event of pending) this.events.push(event), this.byId.set(event.eventId, event);
    for (const [key, sequence] of localSequences) this.lastSequence.set(key, sequence);
    return Object.freeze(results.map((result) => Object.freeze(result)));
  }
  ingest(event: unknown): AnalyticsAppendResult { return this.append(event); }
  ingestBatch(events: readonly unknown[]): readonly AnalyticsAppendResult[] { return this.appendBatch(events); }
  query(query: AnalyticsQuery = {}): readonly AnalyticsEvent[] { const result = this.match(query); return Object.freeze(result.slice(0, query.limit ?? 1000).map(cloneAnalyticsEvent)); }
  count(query: AnalyticsQuery = {}): number { return this.match({ ...query, limit: undefined }).length; }
  summarize(query: AnalyticsQuery = {}): AnalyticsSummary { const events = this.match({ ...query, limit: undefined }); const byCategory: Record<AnalyticsCategory, number> = { battle: 0, level: 0, progression: 0, economy: 0 }; const byType: Record<string, number> = {}; const outcomes: Record<string, number> = {}; for (const event of events) { byCategory[event.category] += 1; byType[event.type] = (byType[event.type] ?? 0) + 1; const outcome = event.payload.outcome; if (typeof outcome === 'string') outcomes[outcome] = (outcomes[outcome] ?? 0) + 1; } return Object.freeze({ total: events.length, byCategory: Object.freeze(byCategory), byType: Object.freeze(byType), outcomes: Object.freeze(outcomes) }); }
  snapshot(): readonly AnalyticsEvent[] { return Object.freeze(this.events.map(cloneAnalyticsEvent)); }
  private match(query: AnalyticsQuery): AnalyticsEvent[] { validateQuery(query); return this.events.filter((event) => (query.category === undefined || event.category === query.category) && (query.type === undefined || event.type === query.type) && (query.playerId === undefined || event.playerId === query.playerId) && (query.sessionId === undefined || event.sessionId === query.sessionId) && (query.fromOccurredAt === undefined || event.occurredAt >= query.fromOccurredAt) && (query.toOccurredAt === undefined || event.occurredAt <= query.toOccurredAt) && (query.afterSequence === undefined || event.sequence > query.afterSequence)); }
}
export const InMemoryAnalyticsStore = AnalyticsStore;
export const AnalyticsEventStore = AnalyticsStore;
export function queryAnalyticsEvents(store: AnalyticsStore, query: AnalyticsQuery = {}): readonly AnalyticsEvent[] { return store.query(query); }
