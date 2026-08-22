import { ANALYTICS_MAX_BATCH_SIZE, type AnalyticsEvent, type AnalyticsEventInput, canonicalJson, cloneAnalyticsEvent, createAnalyticsEvent } from './analytics-contract.ts';

export interface AnalyticsTransportResponse { readonly acceptedEventIds?: readonly string[]; }
export interface AnalyticsTransport { send(events: readonly AnalyticsEvent[]): Promise<AnalyticsTransportResponse> | AnalyticsTransportResponse; }
export interface AnalyticsClientOptions { readonly transport: AnalyticsTransport; readonly maxBatchSize?: number; readonly maxRetries?: number; }
export interface AnalyticsFlushResult { readonly sent: number; readonly remaining: number; readonly attempts: number; }
export class AnalyticsTransportError extends Error { readonly cause: unknown; constructor(message: string, cause?: unknown) { super(message); this.name = 'AnalyticsTransportError'; this.cause = cause; } }

export class AnalyticsClient {
  private readonly transport: AnalyticsTransport;
  private readonly maxBatchSize: number;
  private readonly maxRetries: number;
  private queue: AnalyticsEvent[] = [];
  private flushPromise: Promise<AnalyticsFlushResult> | null = null;
  constructor(options: AnalyticsClientOptions) {
    if (!options || typeof options.transport?.send !== 'function') throw new Error('analytics transport is required');
    this.transport = options.transport; this.maxBatchSize = options.maxBatchSize ?? 20; this.maxRetries = options.maxRetries ?? 2;
    if (!Number.isSafeInteger(this.maxBatchSize) || this.maxBatchSize < 1 || this.maxBatchSize > ANALYTICS_MAX_BATCH_SIZE) throw new Error('maxBatchSize is invalid');
    if (!Number.isSafeInteger(this.maxRetries) || this.maxRetries < 0 || this.maxRetries > 10) throw new Error('maxRetries is invalid');
  }
  track(input: AnalyticsEventInput): AnalyticsEvent { const event = createAnalyticsEvent(input); const existing = this.queue.find((item) => item.eventId === event.eventId); if (existing && canonicalJson(existing) !== canonicalJson(event)) throw new Error('eventId payload conflict'); if (!existing) this.queue.push(event); return cloneAnalyticsEvent(event); }
  trackBatch(inputs: readonly AnalyticsEventInput[]): readonly AnalyticsEvent[] {
    if (!Array.isArray(inputs) || inputs.length === 0 || inputs.length > ANALYTICS_MAX_BATCH_SIZE) throw new Error('analytics batch is too large');
    const events = inputs.map(createAnalyticsEvent); const pendingIds = new Set(this.queue.map(({ eventId }) => eventId)); const batchIds = new Set<string>();
    for (const event of events) { if (batchIds.has(event.eventId) || pendingIds.has(event.eventId)) continue; batchIds.add(event.eventId); }
    this.queue.push(...events.filter((event) => batchIds.has(event.eventId))); return Object.freeze(events.map(cloneAnalyticsEvent));
  }
  pending(): readonly AnalyticsEvent[] { return Object.freeze(this.queue.map(cloneAnalyticsEvent)); }
  async flush(): Promise<AnalyticsFlushResult> {
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flushInternal().finally(() => { this.flushPromise = null; }); return this.flushPromise;
  }
  private async flushInternal(): Promise<AnalyticsFlushResult> {
    let sent = 0; let attempts = 0;
    while (this.queue.length > 0) {
      const batch = this.queue.slice(0, this.maxBatchSize); let response: AnalyticsTransportResponse | undefined; let lastError: unknown;
      for (let retry = 0; retry <= this.maxRetries; retry += 1) { attempts += 1; try { response = await this.transport.send(batch.map(cloneAnalyticsEvent)); break; } catch (error) { lastError = error; } }
      if (!response && lastError !== undefined) throw new AnalyticsTransportError('analytics send failed after retries', lastError);
      const ids = response?.acceptedEventIds ?? batch.map(({ eventId }) => eventId);
      if (ids.length < 1 || ids.length > batch.length || ids.some((id, index) => id !== batch[index].eventId)) throw new AnalyticsTransportError('analytics transport must acknowledge an ordered prefix');
      this.queue.splice(0, ids.length); sent += ids.length;
    }
    return Object.freeze({ sent, remaining: this.queue.length, attempts });
  }
}
