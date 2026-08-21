import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CardCollectionError,
  CardCollectionService,
} from '../assets/scripts/meta/collection/index.ts';
import {
  CARD_QUALITY_CATALOG_DATA,
  loadCardQualityCatalog,
} from '../assets/scripts/meta/cards/quality/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const cardsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const cards = cardsTable.cards.filter((card) => card.enabled !== false);
const qualityCatalog = loadCardQualityCatalog(cardsTable, CARD_QUALITY_CATALOG_DATA);

assert.equal(cards.length, 44, 'collection must use all 44 enabled cards from real cards.json');
assert.equal(qualityCatalog.snapshot().entries.length, 264, 'collection must use all real six-quality definitions');

const rewards = [
  { id: 'collection-1', trigger: 'COLLECTION_COUNT', count: 1, reward: { currency: { coins: 10 }, nested: ['first'] } },
  { id: 'collection-2', trigger: 'COLLECTION_COUNT', count: 2, reward: { currency: { coins: 25 } } },
  { id: 'first-U001', trigger: 'FIRST_ACQUISITION', cardId: 'U001', reward: { title: 'scout', tags: ['catalogue'] } },
  { id: 'quality-U001-4', trigger: 'QUALITY_REACHED', cardId: 'U001', quality: 4, reward: { currency: { coins: 40 } } },
];
const rewardsBefore = structuredClone(rewards);
const saves = [];
const collection = new CardCollectionService({
  metadata: cardsTable,
  qualityCatalog,
  rewards,
  persist: (serialized) => saves.push(serialized),
});

assert.deepEqual(collection.progress(), { collectedCount: 0, totalCount: 44, percentage: 0 });
assert.deepEqual(collection.list(), []);

const first = collection.acquire('obtain-1', { cardId: 'U001', quality: 1, quantity: 1 });
assert.equal(first.firstAcquisition, true, 'first acquisition must be detected');
assert.equal(first.qualityUpgraded, true);
assert.deepEqual(first.entry, { cardId: 'U001', quantity: 1, highestQuality: 1 });
assert.deepEqual(first.rewards.map(({ id }) => id), ['collection-1', 'first-U001']);
assert.deepEqual(first.progress, { collectedCount: 1, totalCount: 44, percentage: 1 / 44 });

const repeat = collection.acquire('obtain-2', { cardId: 'U001', quality: 1, quantity: 2 });
assert.equal(repeat.firstAcquisition, false, 'repeat acquisition must not be first acquisition');
assert.equal(repeat.qualityUpgraded, false, 'same quality must not be an upgrade');
assert.equal(repeat.entry.quantity, 3);
assert.deepEqual(repeat.rewards, [], 'first reward must be one-time');

const upgrade = collection.acquire('obtain-3', { cardId: 'U001', quality: 4, quantity: 1 });
assert.equal(upgrade.qualityUpgraded, true, 'higher quality must upgrade the collection record');
assert.equal(upgrade.entry.highestQuality, 4);
assert.deepEqual(upgrade.rewards.map(({ id }) => id), ['quality-U001-4']);
const lowerQuality = collection.acquire('obtain-4', { cardId: 'U001', quality: 2, quantity: 1 });
assert.equal(lowerQuality.entry.highestQuality, 4, 'lower quality must never downgrade highest quality');
assert.deepEqual(lowerQuality.rewards, []);

const secondCard = collection.acquire({ requestId: 'obtain-5', cardId: 'U002', quality: 6, quantity: 1 });
assert.deepEqual(secondCard.rewards.map(({ id }) => id), ['collection-2']);
assert.equal(collection.progress().collectedCount, 2);

const beforeIdempotent = collection.save();
const saveCountBeforeIdempotent = saves.length;
const idempotent = collection.acquire('obtain-3', { cardId: 'U001', quality: 4, quantity: 1 });
assert.equal(idempotent.applied, false);
assert.equal(idempotent.idempotent, true);
assert.deepEqual(idempotent.rewards.map(({ id }) => id), ['quality-U001-4']);
assert.equal(collection.save(), beforeIdempotent, 'idempotent retry must not change state');
assert.equal(saves.length, saveCountBeforeIdempotent, 'idempotent retry must not persist');
assert.throws(
  () => collection.acquire('obtain-3', { cardId: 'U001', quality: 5, quantity: 1 }),
  (error) => error instanceof CardCollectionError && error.code === 'REQUEST_CONFLICT',
);

const serialized = collection.save();
const recovered = CardCollectionService.restore(cardsTable, serialized, { qualityCatalog, rewards });
assert.deepEqual(recovered.snapshot(), collection.snapshot(), 'collection state must survive serialization and restoration');
assert.equal(recovered.save(), serialized, 'collection serialization must be deterministic');
const recoveredRetry = recovered.acquire('obtain-3', { cardId: 'U001', quality: 4, quantity: 1 });
assert.equal(recoveredRetry.idempotent, true, 'processed request IDs must survive restore');
assert.equal(recovered.getCard('U001').highestQuality, 4);

const expectCode = (label, action, code) => assert.throws(action, (error) => {
  assert(error instanceof CardCollectionError, `${label} must use CardCollectionError`);
  assert.equal(error.code, code, `${label} must report ${code}`);
  return true;
}, label);

expectCode('invalid card format', () => collection.acquire('bad-card', { cardId: 'u001', quality: 1, quantity: 1 }), 'INVALID_CARD_ID');
expectCode('unknown card', () => collection.acquire('unknown-card', { cardId: 'U999', quality: 1, quantity: 1 }), 'UNKNOWN_CARD');
expectCode('quality below range', () => collection.acquire('bad-quality-low', { cardId: 'U001', quality: 0, quantity: 1 }), 'INVALID_QUALITY');
expectCode('quality above range', () => collection.acquire('bad-quality-high', { cardId: 'U001', quality: 7, quantity: 1 }), 'INVALID_QUALITY');
expectCode('fractional quality', () => collection.acquire('bad-quality-fraction', { cardId: 'U001', quality: 1.5, quantity: 1 }), 'INVALID_QUALITY');
expectCode('zero quantity', () => collection.acquire('bad-quantity-zero', { cardId: 'U001', quality: 1, quantity: 0 }), 'INVALID_QUANTITY');
expectCode('negative quantity', () => collection.acquire('bad-quantity-negative', { cardId: 'U001', quality: 1, quantity: -1 }), 'INVALID_QUANTITY');
expectCode('fractional quantity', () => collection.acquire('bad-quantity-fraction', { cardId: 'U001', quality: 1, quantity: 1.5 }), 'INVALID_QUANTITY');
expectCode('unsafe quantity', () => collection.acquire('bad-quantity-unsafe', { cardId: 'U001', quality: 1, quantity: Number.MAX_SAFE_INTEGER + 1 }), 'INVALID_QUANTITY');
expectCode('prototype request', () => collection.acquire('bad-prototype', Object.assign(Object.create({ inherited: true }), { cardId: 'U001', quality: 1, quantity: 1 })), 'INVALID_REQUEST');
expectCode('unknown request key', () => collection.acquire('bad-key', { cardId: 'U001', quality: 1, quantity: 1, forged: true }), 'INVALID_REQUEST');

const exactBoundary = CardCollectionService.restore(cardsTable, JSON.stringify({
  schemaVersion: 1,
  cards: [{ cardId: 'U003', quantity: Number.MAX_SAFE_INTEGER - 1, highestQuality: 1 }],
  claimedRewards: [],
  processedRequests: [],
}), { qualityCatalog, rewards });
exactBoundary.acquire('boundary-ok', { cardId: 'U003', quality: 1, quantity: 1 });
assert.equal(exactBoundary.getCard('U003').quantity, Number.MAX_SAFE_INTEGER);
expectCode('quantity overflow', () => exactBoundary.acquire('boundary-overflow', { cardId: 'U003', quality: 1, quantity: 1 }), 'QUANTITY_EXCEEDED');

let failPersist = true;
const rollback = new CardCollectionService({
  metadata: cardsTable,
  qualityCatalog,
  rewards,
  persist: () => { if (failPersist) throw new Error('disk full'); },
});
expectCode('persistence rollback', () => rollback.acquire('rollback-1', { cardId: 'U004', quality: 1, quantity: 1 }), 'PERSISTENCE_FAILED');
assert.deepEqual(rollback.snapshot().cards, [], 'failed persist must roll back cards');
assert.deepEqual(rollback.snapshot().processedRequests, [], 'failed persist must roll back idempotency ledger');
failPersist = false;
rollback.acquire('rollback-1', { cardId: 'U004', quality: 1, quantity: 1 });
assert.equal(rollback.getCard('U004').quantity, 1, 'service must remain usable after persistence failure');

rewards[0].reward.nested.push('mutated-after-construction');
assert.deepEqual(rewardsBefore, [
  { id: 'collection-1', trigger: 'COLLECTION_COUNT', count: 1, reward: { currency: { coins: 10 }, nested: ['first'] } },
  { id: 'collection-2', trigger: 'COLLECTION_COUNT', count: 2, reward: { currency: { coins: 25 } } },
  { id: 'first-U001', trigger: 'FIRST_ACQUISITION', cardId: 'U001', reward: { title: 'scout', tags: ['catalogue'] } },
  { id: 'quality-U001-4', trigger: 'QUALITY_REACHED', cardId: 'U001', quality: 4, reward: { currency: { coins: 40 } } },
], 'test fixture must actually mutate its own nested input');
const returnedReward = first.rewards[0].reward;
if (returnedReward && typeof returnedReward === 'object' && !Array.isArray(returnedReward)) returnedReward.currency.coins = 999;
assert.equal(collection.snapshot().claimedRewards.includes('collection-1'), true, 'nested output mutation must not change service state');
assert.deepEqual(
  collection.acquire('obtain-1', { cardId: 'U001', quality: 1, quantity: 1 }).rewards.find(({ id }) => id === 'collection-1').reward,
  { currency: { coins: 10 }, nested: ['first'] },
  'nested reward input/output mutation must not change the stored grant',
);

const forgedPrototypeReward = { id: 'forged', trigger: 'COLLECTION_COUNT', count: 1, reward: {} };
Object.defineProperty(forgedPrototypeReward.reward, '__proto__', { value: { polluted: true }, enumerable: true });
expectCode('prototype reward key', () => new CardCollectionService({ metadata: cardsTable, qualityCatalog, rewards: [...rewards, forgedPrototypeReward] }), 'INVALID_CONFIG');
expectCode('malformed save', () => CardCollectionService.restore(cardsTable, '{bad-json', { qualityCatalog, rewards }), 'INVALID_STATE');
const forgedSave = JSON.parse(serialized);
forgedSave.processedRequests[0].result.rewards[0].reward.currency.coins = 9999;
expectCode('forged processed reward', () => CardCollectionService.restore(cardsTable, JSON.stringify(forgedSave), { qualityCatalog, rewards }), 'INVALID_STATE');

assert.equal(saves.length >= 5, true, 'successful acquisitions must persist');
console.log(`T230 card collection PASS: real-cards=${cards.length}, quality-definitions=${qualityCatalog.snapshot().entries.length}, saves=${saves.length}, idempotent, rollback, isolation`);
