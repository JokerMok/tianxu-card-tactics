export const ANALYTICS_SCHEMA_VERSION = 1 as const;
export const ANALYTICS_MAX_BATCH_SIZE = 100 as const;
export const ANALYTICS_CATEGORIES = Object.freeze(['battle', 'level', 'progression', 'economy'] as const);
export type AnalyticsCategory = typeof ANALYTICS_CATEGORIES[number];

export const ANALYTICS_EVENT_TYPES: Readonly<Record<AnalyticsCategory, readonly string[]>> = Object.freeze({
  battle: Object.freeze(['battle_started', 'battle_action', 'battle_ended']),
  level: Object.freeze(['level_started', 'level_completed', 'level_failed']),
  progression: Object.freeze(['hero_level_up', 'deck_updated', 'equipment_enhanced', 'craft_completed']),
  economy: Object.freeze(['currency_earned', 'currency_spent', 'purchase_completed', 'reward_claimed', 'day_advanced']),
});

const CATEGORY_SET = new Set<string>(ANALYTICS_CATEGORIES);
const TYPE_SETS = Object.fromEntries(ANALYTICS_CATEGORIES.map((category) => [category, new Set(ANALYTICS_EVENT_TYPES[category])])) as Readonly<Record<AnalyticsCategory, ReadonlySet<string>>>;
const SENSITIVE_KEY = /(email|phone|mobile|address|name|nickname|realname|userid|playerid|account|token|secret|password|passwd|credential|authorization|cookie|ip|device|advertising|idfa|gaid|private|api|socialsecuritynumber|ssn|dob|dateofbirth|birthdate|creditcard|cardnumber|cardno|cvv|cvc|bankaccount)/i;
const EMAIL_VALUE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_VALUE = /^\+?[0-9][0-9\s().-]{7,}$/;
const UNSAFE_STRING = /[\u0000-\u001f\u007f]/;

export type AnalyticsScalar = string | number | boolean | null;
export type AnalyticsSafeValue = AnalyticsScalar | readonly AnalyticsSafeValue[] | Readonly<Record<string, AnalyticsSafeValue>>;
export type AnalyticsPayload = Readonly<Record<string, AnalyticsSafeValue>>;

export interface AnalyticsEventInput {
  readonly category: AnalyticsCategory;
  readonly type: string;
  readonly playerId: string;
  readonly sessionId: string;
  readonly sequence: number;
  readonly occurredAt: number;
  readonly payload: AnalyticsPayload;
}

export interface AnalyticsEvent extends AnalyticsEventInput {
  readonly schemaVersion: typeof ANALYTICS_SCHEMA_VERSION;
  readonly eventId: string;
}

export class AnalyticsEventValidationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'AnalyticsEventValidationError'; this.code = code; }
}

function fail(code: string, message: string): never { throw new AnalyticsEventValidationError(code, message); }
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function isPlainRecord(value: unknown): value is Record<string, unknown> { return isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function normalizedKey(key: string): string { return key.replace(/[^a-z0-9]/gi, '').toLowerCase(); }
function safeString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 96 || value !== value.trim() || UNSAFE_STRING.test(value)) fail('INVALID_FIELD', `${label} is invalid`);
  if (EMAIL_VALUE.test(value) || PHONE_VALUE.test(value)) fail('SENSITIVE_FIELD', `${label} contains sensitive data`);
}
function safeValue(value: unknown, label: string, depth: number, seen: Set<object>): asserts value is AnalyticsSafeValue {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { if (!Number.isFinite(value) || !Number.isSafeInteger(value)) fail('INVALID_FIELD', `${label} must be a safe integer`); return; }
  if (typeof value === 'string') { if (value.length > 256) fail('INVALID_FIELD', `${label} is too long`); if (EMAIL_VALUE.test(value) || PHONE_VALUE.test(value)) fail('SENSITIVE_FIELD', `${label} contains sensitive data`); return; }
  if (typeof value !== 'object' || seen.has(value)) fail('INVALID_FIELD', `${label} must be acyclic JSON data`);
  if (depth > 5) fail('INVALID_FIELD', `${label} is nested too deeply`);
  seen.add(value);
  try {
    if (Array.isArray(value)) { if (value.length > 50) fail('INVALID_FIELD', `${label} has too many items`); value.forEach((item, index) => safeValue(item, `${label}[${index}]`, depth + 1, seen)); return; }
    if (!isPlainRecord(value)) fail('INVALID_FIELD', `${label} must be a plain object`);
    if (Object.keys(value).length > 64) fail('INVALID_FIELD', `${label} has too many fields`);
    for (const [key, child] of Object.entries(value)) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail('INVALID_FIELD', `${label}.${key} is not allowed`);
      if (SENSITIVE_KEY.test(normalizedKey(key))) fail('SENSITIVE_FIELD', `${label}.${key} is not allowed`);
      safeValue(child, `${label}.${key}`, depth + 1, seen);
    }
  } finally { seen.delete(value); }
}
function validateInput(input: unknown): asserts input is AnalyticsEventInput {
  if (!isPlainRecord(input)) fail('INVALID_FIELD', 'event must be a plain object');
  if (typeof input.category !== 'string' || !CATEGORY_SET.has(input.category)) fail('UNSUPPORTED_CATEGORY', 'event category is unsupported');
  safeString(input.type, 'type');
  const category = input.category as AnalyticsCategory;
  if (!TYPE_SETS[category].has(input.type)) fail('UNSUPPORTED_EVENT_TYPE', `event type ${input.type} is unsupported for ${category}`);
  safeString(input.playerId, 'playerId'); safeString(input.sessionId, 'sessionId');
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 1) fail('INVALID_FIELD', 'sequence must be a positive safe integer');
  if (!Number.isSafeInteger(input.occurredAt) || input.occurredAt < 0) fail('INVALID_FIELD', 'occurredAt must be a non-negative safe integer');
  safeValue(input.payload, 'payload', 0, new Set<object>());
  if (!isPlainRecord(input.payload)) fail('INVALID_FIELD', 'payload must be a plain object');
}
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = canonicalize(value[key]); return out; }, Object.create(null) as Record<string, unknown>);
}
export function canonicalJson(value: unknown): string { return JSON.stringify(canonicalize(value)); }
function hash(value: string): string {
  let left = 2_166_136_261; let right = 2_654_435_761;
  for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); left = Math.imul(left ^ code, 16_777_619) >>> 0; right = Math.imul(right ^ (code + index), 2_246_822_519) >>> 0; }
  return `${left.toString(16).padStart(8, '0')}${right.toString(16).padStart(8, '0')}`;
}
function eventIdentity(input: AnalyticsEventInput): Record<string, unknown> { return { schemaVersion: ANALYTICS_SCHEMA_VERSION, category: input.category, type: input.type, playerId: input.playerId, sessionId: input.sessionId, sequence: input.sequence, occurredAt: input.occurredAt, payload: input.payload }; }
export function deterministicAnalyticsEventId(input: AnalyticsEventInput): string { return `evt_${hash(canonicalJson(eventIdentity(input)))}`; }
function cloneValue<T>(value: T): T { if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T; if (isPlainRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneValue(child)])) as T; return value; }
export function createAnalyticsEvent(input: AnalyticsEventInput): AnalyticsEvent { validateInput(input); return deepFreeze({ ...eventIdentity({ ...input, payload: cloneValue(input.payload) }), eventId: deterministicAnalyticsEventId(input) } as AnalyticsEvent); }
export function parseAnalyticsEvent(raw: unknown): AnalyticsEvent {
  if (!isPlainRecord(raw)) fail('INVALID_SCHEMA', 'event must be a plain object');
  const keys = ['schemaVersion', 'eventId', 'category', 'type', 'playerId', 'sessionId', 'sequence', 'occurredAt', 'payload'];
  if (Object.keys(raw).length !== keys.length || Object.keys(raw).some((key) => !keys.includes(key))) fail('INVALID_SCHEMA', 'event envelope keys are invalid');
  if (raw.schemaVersion !== ANALYTICS_SCHEMA_VERSION || typeof raw.eventId !== 'string' || !/^evt_[0-9a-f]{16}$/.test(raw.eventId)) fail('INVALID_EVENT_ID', 'event envelope is invalid');
  const input = { category: raw.category, type: raw.type, playerId: raw.playerId, sessionId: raw.sessionId, sequence: raw.sequence, occurredAt: raw.occurredAt, payload: raw.payload } as AnalyticsEventInput;
  validateInput(input);
  if (raw.eventId !== deterministicAnalyticsEventId(input)) fail('INVALID_EVENT_ID', 'eventId is not deterministic for event content');
  return deepFreeze({ ...eventIdentity({ ...input, payload: cloneValue(input.payload) }), schemaVersion: ANALYTICS_SCHEMA_VERSION, eventId: raw.eventId } as AnalyticsEvent);
}
export function validateAnalyticsEvent(raw: unknown): string[] { try { parseAnalyticsEvent(raw); return []; } catch (error) { return [error instanceof AnalyticsEventValidationError ? error.message : String(error)]; } }
export function assertAnalyticsEvent(raw: unknown): asserts raw is AnalyticsEvent { parseAnalyticsEvent(raw); }
export function cloneAnalyticsEvent(event: AnalyticsEvent): AnalyticsEvent { return parseAnalyticsEvent(JSON.parse(JSON.stringify(event))); }
function deepFreeze<T>(value: T): T { if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value; Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child); return value; }
