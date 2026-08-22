import assert from 'node:assert/strict';
import { AnalyticsClient, AnalyticsEventValidationError, ANALYTICS_CATEGORIES, createAnalyticsEvent, deterministicAnalyticsEventId, validateAnalyticsEvent } from '../assets/scripts/services/telemetry/index.ts';
import { AnalyticsStore, AnalyticsStoreError } from '../../backend/analytics/index.ts';

const playerId = 'player-opaque-001'; const sessionId = 'session-telemetry-001';
function event(category, type, sequence, payload, occurredAt = 1_700_000_000_000) { return createAnalyticsEvent({ category, type, playerId, sessionId, sequence, occurredAt: occurredAt + sequence, payload }); }
function expectCode(code, action) { assert.throws(action, (error) => error instanceof AnalyticsEventValidationError && error.code === code); }

const battleStarted = event('battle', 'battle_started', 1, { battleId: 'B001', levelId: 'L01', mode: 'mainline' });
const levelCompleted = event('level', 'level_completed', 2, { levelId: 'L01', outcome: 'CLEARED', stars: 3 });
const heroLevelUp = event('progression', 'hero_level_up', 3, { heroId: 'H001', fromLevel: 1, toLevel: 2 });
const currencyEarned = event('economy', 'currency_earned', 4, { resourceId: 'credits', amount: 120, source: 'level_reward' });
const mutablePayload = { battleId: 'B003', nested: { round: 1 } };
const detachedEvent = event('battle', 'battle_started', 5, mutablePayload);
assert.equal(Object.isFrozen(mutablePayload), false, 'event creation must not freeze caller payload');
mutablePayload.nested.round = 2;
assert.equal(detachedEvent.payload.nested.round, 1, 'event payload must be detached from caller state');
assert.deepEqual(ANALYTICS_CATEGORIES, ['battle', 'level', 'progression', 'economy']);
assert.equal(createAnalyticsEvent({ category: 'battle', type: 'battle_started', playerId, sessionId, sequence: 1, occurredAt: battleStarted.occurredAt, payload: { mode: 'mainline', levelId: 'L01', battleId: 'B001' } }).eventId, battleStarted.eventId);
assert.equal(battleStarted.eventId, deterministicAnalyticsEventId(battleStarted)); assert.equal(validateAnalyticsEvent(battleStarted).length, 0);
expectCode('SENSITIVE_FIELD', () => event('battle', 'battle_started', 5, { battleId: 'B002', email: 'player@example.com' }));
expectCode('SENSITIVE_FIELD', () => event('economy', 'currency_earned', 5, { resourceId: 'credits', amount: 1, access_token: 'secret' }));
for (const key of ['socialSecurityNumber', 'SOCIAL_SECURITY_NUMBER', 'social-security-number', 'dob', 'DOB', 'date_of_birth', 'credit_card', 'creditCard', 'user_id', 'UserId', 'email', 'PHONE', 'street-address']) expectCode('SENSITIVE_FIELD', () => event('battle', 'battle_started', 5, { [key]: 'opaque-value' }));
expectCode('SENSITIVE_FIELD', () => event('battle', 'battle_started', 5, { metadata: { contact: { phone_number: 'opaque-value' } } }));
expectCode('SENSITIVE_FIELD', () => event('battle', 'battle_started', 5, { metadata: [{ identity: { social_security_number: 'opaque-value' } }] }));
const legalFieldEvent = event('battle', 'battle_started', 5, { equipmentId: 'E001', equipment: 'sword', apiVersion: 'v1' });
assert.deepEqual(legalFieldEvent.payload, { equipmentId: 'E001', equipment: 'sword', apiVersion: 'v1' });
for (const key of ['email', 'EMAIL', 'e_mail', 'e-mail', 'phone', 'PHONE', 'phone_number', 'phoneNumber', 'phone-number', 'address', 'ADDRESS', 'street_address', 'streetAddress', 'street-address', 'socialSecurityNumber', 'SOCIAL_SECURITY_NUMBER', 'social_security_number', 'social-security-number', 'dob', 'DOB', 'date_of_birth', 'dateOfBirth', 'date-of-birth', 'credit_card', 'creditCard', 'credit-card', 'user_id', 'UserId', 'user-id', 'ssn', 'access_token', 'accessToken', 'access-token', 'api', 'API', 'api_key', 'apiKey', 'api-key']) expectCode('SENSITIVE_FIELD', () => event('battle', 'battle_started', 5, { [key]: 'opaque-value' }));
expectCode('INVALID_FIELD', () => event('battle', 'battle_started', 5, { value: Number.NaN }));
expectCode('UNSUPPORTED_EVENT_TYPE', () => event('battle', 'currency_earned', 5, { resourceId: 'credits', amount: 1 }));
assert.notEqual(validateAnalyticsEvent({ ...battleStarted, type: 'changed_type' }).length, 0);

const store = new AnalyticsStore(); const appended = store.appendBatch([battleStarted, levelCompleted, heroLevelUp, currencyEarned]);
assert.equal(appended.length, 4); assert.equal(appended.every((result) => result.accepted && !result.idempotent), true); assert.equal(store.snapshot().length, 4);
assert.deepEqual(store.append(battleStarted), { eventId: battleStarted.eventId, accepted: false, idempotent: true });
assert.throws(() => store.append({ ...battleStarted, payload: { ...battleStarted.payload, durationMs: 12 } }), (error) => error instanceof AnalyticsStoreError && error.code === 'IDEMPOTENCY_CONFLICT');
assert.equal(store.query({ category: 'battle' }).length, 1); assert.equal(store.query({ type: 'level_completed' })[0].payload.levelId, 'L01'); assert.equal(store.query({ category: 'progression' })[0].payload.toLevel, 2); assert.equal(store.query({ fromOccurredAt: currencyEarned.occurredAt }).length, 1); assert.equal(store.query({ afterSequence: 2 }).length, 2); assert.equal(store.summarize().byCategory.economy, 1); assert.equal(store.summarize().outcomes.CLEARED, 1); assert.throws(() => store.query({ fromOccurredAt: 2, toOccurredAt: 1 }), /time range/);
assert.equal(store.query({ offset: 1, limit: 1 })[0].eventId, levelCompleted.eventId); assert.equal(store.query({ cursor: battleStarted.eventId, limit: 1 })[0].eventId, levelCompleted.eventId);
assert.throws(() => store.query({ offset: -1 }), (error) => error instanceof AnalyticsStoreError && error.code === 'INVALID_QUERY'); assert.throws(() => store.query({ offset: 1.5 }), (error) => error instanceof AnalyticsStoreError && error.code === 'INVALID_QUERY'); assert.throws(() => store.query({ limit: 0 }), (error) => error instanceof AnalyticsStoreError && error.code === 'INVALID_QUERY'); assert.throws(() => store.query({ limit: 1001 }), (error) => error instanceof AnalyticsStoreError && error.code === 'INVALID_QUERY'); assert.throws(() => store.query({ offset: 1, cursor: battleStarted.eventId }), (error) => error instanceof AnalyticsStoreError && error.code === 'INVALID_QUERY'); assert.throws(() => store.query({ unknownPage: 1 }), (error) => error instanceof AnalyticsStoreError && error.code === 'INVALID_QUERY'); assert.throws(() => store.query({ cursor: 'evt_missing' }), (error) => error instanceof AnalyticsStoreError && error.code === 'INVALID_QUERY');

const orderedStore = new AnalyticsStore(); const orderedEvents = [event('battle', 'battle_started', 1, { battleId: 'B002' }, 1_800_000_000_000), event('battle', 'battle_ended', 2, { battleId: 'B002', outcome: 'WON' }, 1_800_000_000_000), event('battle', 'battle_action', 3, { battleId: 'B002', action: 'ATTACK' }, 1_800_000_000_000)];
assert.throws(() => orderedStore.append(orderedEvents[1]), (error) => error instanceof AnalyticsStoreError && error.code === 'OUT_OF_ORDER'); assert.equal(orderedStore.append(orderedEvents[0]).accepted, true); assert.equal(orderedStore.appendBatch(orderedEvents.slice(1)).length, 2); assert.equal(orderedStore.snapshot().length, 3); assert.throws(() => orderedStore.appendBatch([orderedEvents[0], { malformed: true }]), /event/); assert.equal(orderedStore.snapshot().length, 3); assert.throws(() => orderedStore.appendBatch(Array.from({ length: 101 }, (_, index) => orderedEvents[index % 3])), /1\.\.100/);

let attempts = 0; const sentBatches = []; const client = new AnalyticsClient({ maxBatchSize: 2, maxRetries: 1, transport: { async send(batch) { sentBatches.push(batch.map(({ eventId }) => eventId)); attempts += 1; if (attempts === 1) throw new Error('temporary failure'); return { acceptedEventIds: batch.map(({ eventId }) => eventId) }; } } });
client.trackBatch([battleStarted, levelCompleted, heroLevelUp]); client.track(battleStarted); assert.equal(client.pending().length, 3); assert.deepEqual(await client.flush(), { sent: 3, remaining: 0, attempts: 3 }); assert.deepEqual(sentBatches, [[battleStarted.eventId, levelCompleted.eventId], [battleStarted.eventId, levelCompleted.eventId], [heroLevelUp.eventId]]); assert.equal((await client.flush()).sent, 0); assert.throws(() => client.trackBatch(Array.from({ length: 101 }, (_, index) => event('battle', 'battle_started', index + 1, { battleId: `B${index}` }, 1_900_000_000_000))), /too large/);
const duplicateClient = new AnalyticsClient({ transport: { send() { return { acceptedEventIds: [] }; } } }); assert.equal(duplicateClient.trackBatch([battleStarted, battleStarted]).length, 1); assert.equal(duplicateClient.trackBatch([battleStarted]).length, 0); assert.equal(duplicateClient.pending().length, 1);
const atomicStore = new AnalyticsStore(); assert.throws(() => atomicStore.appendBatch([battleStarted, { ...battleStarted, payload: { ...battleStarted.payload, outcome: 'CHEATED' } }]), (error) => error instanceof AnalyticsStoreError && error.code === 'IDEMPOTENCY_CONFLICT'); assert.equal(atomicStore.snapshot().length, 0);

console.log('T261 analytics events PASS: schema, four categories, deterministic IDs, sensitive-field rejection, query, idempotency, batch atomicity, retry and ordering boundaries');
