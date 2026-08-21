import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CARD_SYNTHESIS_RECIPES,
  CARD_SYNTHESIS_SCHEMA_VERSION,
  CardSynthesisError,
  CardSynthesisService,
  createCardSynthesisService,
  restoreCardSynthesisService,
} from '../assets/scripts/meta/alchemy/synthesis/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const cardsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const cards = cardsTable.cards.filter((card) => card.enabled !== false);
const realCardIds = new Set(cards.map(({ id }) => id));
const EXPECTED_PRODUCTION_CARD_IDS = Object.freeze([
  'U001', 'U002', 'U003', 'U004', 'U005', 'U006', 'U007', 'U008', 'U009', 'U010', 'U011', 'U012',
  'U013', 'U014', 'U015', 'U016', 'U017', 'U018', 'U019', 'U020', 'U021', 'U022', 'U023', 'U024',
  'U025', 'U026', 'U027', 'U028', 'S001', 'S002', 'S003', 'S004', 'S005', 'S006', 'S007', 'S008',
  'S009', 'S010', 'S011', 'S012', 'S013', 'S014', 'S015', 'S016',
]);
const EXPECTED_PRODUCTION_BY_SOURCE_QUALITY = Object.freeze({
  1: Object.freeze({ outputQuality: 2, materialQuantity: 3, outputQuantity: 1, baseProbability: 0.8 }),
  2: Object.freeze({ outputQuality: 3, materialQuantity: 3, outputQuantity: 1, baseProbability: 0.7 }),
  3: Object.freeze({ outputQuality: 4, materialQuantity: 3, outputQuantity: 1, baseProbability: 0.6 }),
  4: Object.freeze({ outputQuality: 5, materialQuantity: 3, outputQuantity: 1, baseProbability: 0.5 }),
  5: Object.freeze({ outputQuality: 6, materialQuantity: 3, outputQuantity: 1, baseProbability: 0.4 }),
});
const productionRecipe = CARD_SYNTHESIS_RECIPES.find((recipe) => recipe.id === 'U001-Q1-TO-Q2');
assert(productionRecipe, 'production synthesis must expose the real U001 Q1 to Q2 recipe');
assert.equal(cards.length, 44, 'the production card registry must contain exactly 44 enabled cards');
assert.deepEqual([...realCardIds].sort(), [...EXPECTED_PRODUCTION_CARD_IDS].sort(), 'production card IDs must match the fixed synthesis fixture');
assert.equal(CARD_SYNTHESIS_RECIPES.length, cards.length * 5, 'production must expose one recipe for every card and source quality');
assert.equal(CARD_SYNTHESIS_RECIPES.length, 44 * 5, 'production must expose exactly 44 cards x 5 source qualities');
assert(CARD_SYNTHESIS_RECIPES.every((recipe) => realCardIds.has(recipe.output.cardId)), 'production recipes must target real cards');
const expectedProductionRecipeIds = new Set(EXPECTED_PRODUCTION_CARD_IDS.flatMap((cardId) => Object.keys(EXPECTED_PRODUCTION_BY_SOURCE_QUALITY).map((quality) => `${cardId}-Q${quality}-TO-Q${EXPECTED_PRODUCTION_BY_SOURCE_QUALITY[quality].outputQuality}`)));
assert.deepEqual(new Set(CARD_SYNTHESIS_RECIPES.map((recipe) => recipe.id)), expectedProductionRecipeIds, 'production recipe IDs must cover every fixed cardId/quality from-to combination');
for (const cardId of EXPECTED_PRODUCTION_CARD_IDS) {
  for (const [sourceQualityText, expected] of Object.entries(EXPECTED_PRODUCTION_BY_SOURCE_QUALITY)) {
    const sourceQuality = Number(sourceQualityText);
    const recipeId = `${cardId}-Q${sourceQuality}-TO-Q${expected.outputQuality}`;
    const production = CARD_SYNTHESIS_RECIPES.find((entry) => entry.id === recipeId);
    assert(production, `missing fixed production recipe ${recipeId}`);
    assert.deepEqual(production.materials, [{ cardId, quality: sourceQuality, quantity: expected.materialQuantity }], `${recipeId} input must match the fixed fixture`);
    assert.deepEqual(production.output, { cardId, quality: expected.outputQuality, quantity: expected.outputQuantity }, `${recipeId} output must match the fixed fixture`);
    assert.equal(production.baseProbability, expected.baseProbability, `${recipeId} base probability must match the fixed fixture`);
    assert.deepEqual(production.pity, { increment: 0.1, guaranteedAfterFailures: 4 }, `${recipeId} pity must match the fixed fixture`);
    assert.deepEqual(production.failureRefund, [{ cardId, quality: sourceQuality, quantity: 1 }], `${recipeId} failure refund must match the fixed fixture`);
  }
}

const recipe = {
  id: 'U001-Q1-TEST',
  materials: [{ cardId: 'U001', quality: 1, quantity: 3 }],
  output: { cardId: 'U001', quality: 2, quantity: 1 },
  baseProbability: 0.5,
  pity: { increment: 0.1, guaranteedAfterFailures: 2 },
  failureRefund: [{ cardId: 'U001', quality: 1, quantity: 1 }],
};

const stateWith = (materials, extra = {}) => ({
  schemaVersion: CARD_SYNTHESIS_SCHEMA_VERSION,
  materials,
  pity: [],
  ledger: [],
  receipts: [],
  ...extra,
});

function makeService({ materials = [{ cardId: 'U001', quality: 1, quantity: 3 }], rng = () => 0, onSave, state } = {}) {
  return createCardSynthesisService({
    recipes: [recipe],
    state: state ?? stateWith(materials),
    rng,
    ...(onSave === undefined ? {} : { onSave }),
  });
}

function expectCode(label, action, code) {
  assert.throws(action, (error) => error instanceof CardSynthesisError && error.code === code, `${label} must fail with ${code}`);
}

let rngCalls = 0;
const success = makeService({ rng: () => { rngCalls += 1; return 0.499999; } }).synthesize({ requestId: 'success-1', recipeId: recipe.id });
assert.equal(success.outcome, 'SUCCESS', 'roll below probability must succeed');
assert.equal(success.roll, 0.499999);
assert.equal(success.probability, 0.5);
assert.equal(success.pityAfter, 0);
assert.deepEqual(success.credited, [{ cardId: 'U001', quality: 2, quantity: 1 }]);
assert.equal(rngCalls, 1, 'a non-guaranteed attempt must consume exactly one RNG value');

const boundaryService = makeService({ rng: () => 0.5 });
const boundaryFailure = boundaryService.attempt({ requestId: 'boundary-1', recipeId: recipe.id, materials: recipe.materials });
assert.equal(boundaryFailure.outcome, 'FAILURE', 'roll equal to probability must fail by the half-open boundary');
assert.deepEqual(boundaryFailure.returned, [{ cardId: 'U001', quality: 1, quantity: 1 }]);
assert.equal(boundaryService.getPity(recipe.id), 1, 'failure must advance pity');
assert.deepEqual(boundaryService.snapshot().materials, [{ cardId: 'U001', quality: 1, quantity: 1 }], 'failure must consume three and return one atomically');
assert.deepEqual(boundaryService.snapshot().ledger[0], {
  sequence: 1,
  requestId: 'boundary-1',
  recipeId: recipe.id,
  outcome: 'FAILURE',
  roll: 0.5,
  probability: 0.5,
  guaranteed: false,
  pityBefore: 0,
  pityAfter: 1,
  debited: [{ cardId: 'U001', quality: 1, quantity: 3 }],
  returned: [{ cardId: 'U001', quality: 1, quantity: 1 }],
  credited: [],
}, 'failure ledger must reflect debit, refund, pity and probability exactly');

let shortageRngCalls = 0;
const shortage = makeService({ materials: [{ cardId: 'U001', quality: 1, quantity: 2 }], rng: () => { shortageRngCalls += 1; return 0; } });
const shortageBefore = shortage.save();
expectCode('insufficient materials', () => shortage.synthesize({ requestId: 'shortage-1', recipeId: recipe.id }), 'INSUFFICIENT_MATERIALS');
assert.equal(shortage.save(), shortageBefore, 'material shortage must not mutate state');
assert.equal(shortageRngCalls, 0, 'material shortage must not consume RNG');

const pityRolls = [0.99, 0.99];
const pityService = makeService({ materials: [{ cardId: 'U001', quality: 1, quantity: 9 }], rng: () => pityRolls.shift() });
const firstMiss = pityService.synthesize({ requestId: 'pity-1', recipeId: recipe.id });
const secondMiss = pityService.synthesize({ requestId: 'pity-2', recipeId: recipe.id });
assert.equal(firstMiss.probability, 0.5);
assert.equal(secondMiss.probability, 0.6, 'pity must increase probability after each failure');
assert.equal(pityService.getPity(recipe.id), 2);
let forbiddenGuaranteedRngCalls = 0;
const guaranteedService = makeService({
  rng: () => { forbiddenGuaranteedRngCalls += 1; throw new Error('guarantee must not roll RNG'); },
  state: pityService.snapshot(),
});
const guaranteed = guaranteedService.synthesize({ requestId: 'pity-3', recipeId: recipe.id });
assert.equal(guaranteed.outcome, 'SUCCESS', 'threshold pity must guarantee the next attempt');
assert.equal(guaranteed.guaranteed, true);
assert.equal(guaranteed.roll, null, 'guaranteed success must not invent a random roll');
assert.equal(forbiddenGuaranteedRngCalls, 0);
assert.equal(guaranteedService.getPity(recipe.id), 0, 'success must reset pity');

const duplicateCalls = [];
const duplicateService = makeService({ rng: () => { duplicateCalls.push('rng'); return 0; }, onSave: (serialized) => duplicateCalls.push(serialized) });
const firstRequest = duplicateService.synthesize({ requestId: 'idempotent-1', recipeId: recipe.id });
const afterFirst = duplicateService.save();
const repeatedRequest = duplicateService.synthesize({ requestId: 'idempotent-1', recipeId: recipe.id });
assert.deepEqual(repeatedRequest, firstRequest, 'duplicate request must replay the original receipt');
assert.equal(duplicateCalls.filter((entry) => entry === 'rng').length, 1, 'duplicate request must not roll RNG');
assert.equal(duplicateCalls.filter((entry) => typeof entry === 'string' && entry.startsWith('{')).length, 1, 'duplicate request must not persist twice');
assert.equal(duplicateService.save(), afterFirst, 'duplicate request must leave serialized state unchanged');
expectCode('idempotency conflict', () => duplicateService.synthesize({ requestId: 'idempotent-1', recipeId: recipe.id, materials: [{ cardId: 'U001', quality: 1, quantity: 2 }] }), 'IDEMPOTENCY_CONFLICT');

let shouldFailPersist = true;
const persistenceService = makeService({
  rng: () => 0,
  onSave: () => { if (shouldFailPersist) throw new Error('disk full'); },
});
const persistenceBefore = persistenceService.save();
expectCode('persistence failure', () => persistenceService.synthesize({ requestId: 'persist-1', recipeId: recipe.id }), 'PERSISTENCE_FAILED');
assert.equal(persistenceService.save(), persistenceBefore, 'persist failure must roll back materials, pity, ledger and receipt');
shouldFailPersist = false;
assert.equal(persistenceService.synthesize({ requestId: 'persist-1', recipeId: recipe.id }).outcome, 'SUCCESS', 'service must remain usable after persistence failure');

let rngReentryError;
let rngReentryService;
rngReentryService = makeService({
  materials: [{ cardId: 'U001', quality: 1, quantity: 6 }],
  rng: () => {
    try {
      rngReentryService.synthesize({ requestId: 'nested-rng-1', recipeId: recipe.id });
    } catch (error) {
      rngReentryError = error;
    }
    return 0;
  },
});
const rngReentryResult = rngReentryService.synthesize({ requestId: 'outer-rng-1', recipeId: recipe.id });
assert(rngReentryError instanceof CardSynthesisError && rngReentryError.code === 'REENTRANT', 'RNG re-entry must fail fast with a controlled CardSynthesisError');
assert.equal(rngReentryResult.outcome, 'SUCCESS', 'the outer RNG transaction may commit after the rejected nested attempt');
assert.equal(rngReentryService.snapshot().ledger.length, 1, 'RNG re-entry must not append a nested ledger entry');
assert.equal(rngReentryService.snapshot().receipts.length, 1, 'RNG re-entry must not append a nested receipt');
assert.deepEqual(rngReentryService.snapshot().materials, [
  { cardId: 'U001', quality: 1, quantity: 3 },
  { cardId: 'U001', quality: 2, quantity: 1 },
], 'RNG re-entry must preserve strict single-transaction material conservation');

let persistenceReentryError;
let persistenceReentryService;
persistenceReentryService = makeService({
  materials: [{ cardId: 'U001', quality: 1, quantity: 6 }],
  onSave: () => {
    try {
      persistenceReentryService.synthesize({ requestId: 'nested-persist-1', recipeId: recipe.id });
    } catch (error) {
      persistenceReentryError = error;
    }
  },
});
const persistenceReentryResult = persistenceReentryService.synthesize({ requestId: 'outer-persist-1', recipeId: recipe.id });
assert(persistenceReentryError instanceof CardSynthesisError && persistenceReentryError.code === 'REENTRANT', 'persistence re-entry must fail fast with a controlled CardSynthesisError');
assert.equal(persistenceReentryResult.outcome, 'SUCCESS', 'the outer persistence transaction may commit after the rejected nested attempt');
assert.equal(persistenceReentryService.snapshot().ledger.length, 1, 'persistence re-entry must not append a nested ledger entry');
assert.equal(persistenceReentryService.snapshot().receipts.length, 1, 'persistence re-entry must not append a nested receipt');

let abortingPersistenceService;
let abortPersistence = true;
abortingPersistenceService = makeService({
  onSave: () => {
    if (abortPersistence) abortingPersistenceService.synthesize({ requestId: 'nested-persist-abort-1', recipeId: recipe.id });
  },
});
const abortingPersistenceBefore = abortingPersistenceService.save();
expectCode('unhandled persistence re-entry', () => abortingPersistenceService.synthesize({ requestId: 'outer-persist-abort-1', recipeId: recipe.id }), 'REENTRANT');
assert.equal(abortingPersistenceService.save(), abortingPersistenceBefore, 'unhandled persistence re-entry must not partially commit the outer transaction');
abortPersistence = false;
assert.equal(abortingPersistenceService.synthesize({ requestId: 'after-persist-abort-1', recipeId: recipe.id }).success, true, 'transaction guard must release after an aborted re-entry');

const serialized = boundaryService.save();
const restored = restoreCardSynthesisService(serialized, { recipes: [recipe], rng: () => 0 });
assert.deepEqual(restored.snapshot(), boundaryService.snapshot(), 'serialization restore must preserve all synthesis state');
assert.equal(restored.save(), serialized, 'serialization must be deterministic after restore');
assert.deepEqual(restored.synthesize({ requestId: 'boundary-1', recipeId: recipe.id, materials: recipe.materials }), boundaryFailure, 'restored duplicate must replay the saved result');
assert(Object.isFrozen(restored.snapshot()) && Object.isFrozen(restored.snapshot().ledger[0]), 'snapshots and ledger entries must be immutable');

const validFailureSave = JSON.parse(serialized);
const validSuccessSave = JSON.parse(afterFirst);
for (const [label, corruptedState] of [
  ['ledgerWithoutReceipt', { ...validFailureSave, receipts: [] }],
  ['receiptLedgerRequestMismatch', {
    ...validFailureSave,
    ledger: [{ ...validFailureSave.ledger[0], requestId: 'boundary-ledger-mismatch' }],
  }],
  ['inventoryLedgerMismatch', { ...validSuccessSave, materials: [] }],
]) {
  expectCode(label, () => restoreCardSynthesisService(JSON.stringify(corruptedState), { recipes: [recipe] }), 'INVALID_STATE');
}

const net = new Map();
for (const material of boundaryFailure.debited) net.set(`${material.cardId}:${material.quality}`, -(material.quantity));
for (const material of boundaryFailure.returned) net.set(`${material.cardId}:${material.quality}`, (net.get(`${material.cardId}:${material.quality}`) ?? 0) + material.quantity);
for (const material of boundaryFailure.credited) net.set(`${material.cardId}:${material.quality}`, (net.get(`${material.cardId}:${material.quality}`) ?? 0) + material.quantity);
assert.deepEqual([...net.entries()], [['U001:1', -2]], 'failure ledger net delta must equal three投入 minus one返还');

for (const [label, invalidRecipes] of [
  ['null recipes', null],
  ['null wrapped recipes', { recipes: null }],
  ['missing wrapped recipes', {}],
  ['numeric recipes', 42],
  ['string recipes', 'invalid'],
]) {
  expectCode(label, () => createCardSynthesisService({ recipes: invalidRecipes }), 'INVALID_CONFIG');
}
expectCode('prototype recipe key', () => createCardSynthesisService({ recipes: [{ ...recipe, id: '__proto__' }] }), 'INVALID_CONFIG');
expectCode('prototype card key', () => createCardSynthesisService({ recipes: [{ ...recipe, materials: [{ cardId: '__proto__', quality: 1, quantity: 3 }] }] }), 'INVALID_CONFIG');
expectCode('zero quantity', () => createCardSynthesisService({ recipes: [{ ...recipe, materials: [{ cardId: 'U001', quality: 1, quantity: 0 }] }] }), 'INVALID_CONFIG');
expectCode('fractional quantity', () => createCardSynthesisService({ recipes: [{ ...recipe, materials: [{ cardId: 'U001', quality: 1, quantity: 1.5 }] }] }), 'INVALID_CONFIG');
expectCode('unsafe quantity', () => createCardSynthesisService({ recipes: [{ ...recipe, materials: [{ cardId: 'U001', quality: 1, quantity: Number.MAX_SAFE_INTEGER + 1 }] }] }), 'INVALID_CONFIG');
const saturated = makeService({ materials: [
  { cardId: 'U001', quality: 1, quantity: 3 },
  { cardId: 'U001', quality: 2, quantity: Number.MAX_SAFE_INTEGER },
] });
const saturatedBefore = saturated.save();
expectCode('output quantity overflow', () => saturated.synthesize({ requestId: 'overflow-1', recipeId: recipe.id }), 'QUANTITY_EXCEEDED');
assert.equal(saturated.save(), saturatedBefore, 'overflow must not partially commit material debit or pity');

const empty = makeService({ materials: [] });
assert.deepEqual(empty.snapshot(), stateWith([]), 'empty state must be a valid serializable initial state');
expectCode('unknown state field', () => createCardSynthesisService({ recipes: [recipe], state: '{"schemaVersion":1,"materials":[],"pity":[],"ledger":[],"receipts":[],"__proto__":true}' }), 'INVALID_STATE');
expectCode('unsupported schema', () => restoreCardSynthesisService(JSON.stringify({ ...stateWith([]), schemaVersion: 2 }), { recipes: [recipe] }), 'INVALID_STATE');

console.log(`T227 card synthesis PASS: real-cards=${cards.length}, production-recipes=${CARD_SYNTHESIS_RECIPES.length}, success/failure-boundaries, pity, refund-ledger, idempotency, rollback, restore, integer/prototype guards`);
