import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CARD_REFINING_RECIPES,
  CARD_REFINING_SCHEMA_VERSION,
  CardRefiningError,
  CardRefiningService,
  createCardRefiningService,
  restoreCardRefiningService,
} from '../assets/scripts/meta/alchemy/refining/index.ts';

const root = path.resolve(import.meta.dirname, '..');
const cardsTable = JSON.parse(fs.readFileSync(path.join(root, 'assets/resources/config/cards.json'), 'utf8'));
const realCardIds = new Set(cardsTable.cards.filter((card) => card.enabled !== false).map((card) => card.id));
const expectedProductionRecipes = new Map([...realCardIds].map((cardId) => [
  `${cardId}-REFINE`,
  {
    id: `${cardId}-REFINE`,
    materials: [{ materialId: 'CARD_DUST', quantity: 10 }],
    output: { cardId, quality: 1, quantity: 1 },
    probability: 1,
    failureRefund: [],
  },
]));
assert.equal(realCardIds.size, 44, 'the production card registry must contain 44 enabled cards');
assert.equal(CARD_REFINING_RECIPES.length, 44, 'production refining must expose one recipe per real card');
assert.equal(new Set(CARD_REFINING_RECIPES.map((recipe) => recipe.id)).size, CARD_REFINING_RECIPES.length, 'production recipe IDs must be unique');
assert.equal(new Set(CARD_REFINING_RECIPES.map((recipe) => recipe.output.cardId)).size, CARD_REFINING_RECIPES.length, 'production recipe outputs must be unique');
assert.deepEqual(new Set(CARD_REFINING_RECIPES.map((recipe) => recipe.id)), new Set(expectedProductionRecipes.keys()), 'production recipe IDs must exactly match the real card set');
assert.deepEqual(new Set(CARD_REFINING_RECIPES.map((recipe) => recipe.output.cardId)), realCardIds, 'production recipe outputs must exactly match the real card set');
for (const recipe of CARD_REFINING_RECIPES) {
  const expected = expectedProductionRecipes.get(recipe.id);
  assert(expected, `production recipe ${recipe.id} must be expected`);
  assert.deepEqual(recipe.materials, expected.materials, `${recipe.id} materials must match production config`);
  assert.deepEqual(recipe.output, expected.output, `${recipe.id} output card and quality must match production config`);
  assert.equal(recipe.probability, expected.probability, `${recipe.id} probability must match production config`);
  assert.deepEqual(recipe.failureRefund, expected.failureRefund, `${recipe.id} failure refund must match production config`);
  assert(Object.isFrozen(recipe), `${recipe.id} recipe must be frozen`);
  assert(Object.isFrozen(recipe.materials), `${recipe.id} materials array must be frozen`);
  assert(recipe.materials.every((material) => Object.isFrozen(material)), `${recipe.id} material entries must be frozen`);
  assert(Object.isFrozen(recipe.output), `${recipe.id} output must be frozen`);
  assert(Object.isFrozen(recipe.failureRefund), `${recipe.id} failure refund array must be frozen`);
  assert(recipe.failureRefund.every((material) => Object.isFrozen(material)), `${recipe.id} failure refund entries must be frozen`);
}
const productionFreezeProbe = CARD_REFINING_RECIPES[0];
assert.throws(() => { productionFreezeProbe.id = 'TAMPERED'; }, TypeError, 'production recipe mutation must fail');
assert.throws(() => { productionFreezeProbe.materials.push({ materialId: 'CARD_DUST', quantity: 1 }); }, TypeError, 'production materials array mutation must fail');
assert.throws(() => { productionFreezeProbe.materials[0].quantity = 1; }, TypeError, 'production material mutation must fail');
assert.throws(() => { productionFreezeProbe.output.cardId = 'TAMPERED'; }, TypeError, 'production output mutation must fail');

const SHANGHAI_BEFORE_MIDNIGHT = Date.parse('2026-08-20T15:59:59.999Z');
const SHANGHAI_MIDNIGHT = Date.parse('2026-08-20T16:00:00.000Z');
const SHANGHAI_AFTER_MIDNIGHT = Date.parse('2026-08-20T16:00:00.001Z');

const recipe = Object.freeze({
  id: 'R1',
  materials: Object.freeze([{ materialId: 'CARD_DUST', quantity: 3 }]),
  output: Object.freeze({ cardId: 'U001', quality: 2, quantity: 1 }),
  probability: 0.5,
  failureRefund: Object.freeze([{ materialId: 'CARD_DUST', quantity: 1 }]),
});
const recipe2 = Object.freeze({
  id: 'R2',
  materials: Object.freeze([{ materialId: 'CARD_DUST', quantity: 2 }]),
  output: Object.freeze({ cardId: 'U002', quality: 1, quantity: 1 }),
  probability: 1,
  failureRefund: Object.freeze([]),
});

function expectCode(label, action, code) {
  assert.throws(action, (error) => {
    assert(error instanceof CardRefiningError, `${label} must throw CardRefiningError`);
    assert.equal(error.code, code, `${label} must report ${code}`);
    assert.equal(error.reason, code, `${label} reason must be stable`);
    return true;
  }, label);
}

function makeService(options = {}) {
  return createCardRefiningService({
    recipes: [recipe],
    slotCount: 1,
    timezone: 'Asia/Shanghai',
    clock: { now: () => SHANGHAI_BEFORE_MIDNIGHT },
    refreshTickets: 1,
    materials: [{ materialId: 'CARD_DUST', quantity: 3 }],
    rng: () => 0,
    ...options,
  });
}

const realService = createCardRefiningService({
  materials: [{ materialId: 'CARD_DUST', quantity: 10 }],
  refreshTickets: 1,
  rng: () => 0,
  clock: { now: () => SHANGHAI_BEFORE_MIDNIGHT },
});
const productionRecipe = realService.getRecipe('U001-REFINE');
const productionResult = realService.refine({
  requestId: 'production-refine-1',
  slotId: 0,
  recipeId: productionRecipe.id,
  materials: productionRecipe.materials,
});
assert.equal(productionResult.success, true, 'the real production refining service must produce on a successful roll');
assert.deepEqual(productionResult.credited, [{ cardId: 'U001', quality: 1, quantity: 1 }]);
assert.deepEqual(realService.snapshot().materials, []);
assert.deepEqual(realService.snapshot().cards, [{ cardId: 'U001', quality: 1, quantity: 1 }]);
assert.equal(realService.snapshot().slots.length, 3, 'production must expose the configured three refining slots');

const boundaryService = makeService({ rng: () => 0.5 });
const boundaryBefore = boundaryService.save();
const failure = boundaryService.refine({ requestId: 'failure-1', slotId: 0, recipeId: 'R1', materials: recipe.materials });
assert.equal(failure.success, false, 'roll equal to probability must fail at the half-open boundary');
assert.equal(failure.roll, 0.5);
assert.deepEqual(failure.returned, [{ materialId: 'CARD_DUST', quantity: 1 }]);
assert.deepEqual(boundaryService.snapshot().materials, [{ materialId: 'CARD_DUST', quantity: 1 }], 'failure must debit three and refund one atomically');
assert.deepEqual(boundaryService.snapshot().cards, []);
assert.notEqual(boundaryService.save(), boundaryBefore, 'a successful transaction must change the serialized state');

const successService = makeService({ recipes: [recipe, recipe2], rng: () => 0.499999 });
const success = successService.refine({ requestId: 'success-1', slotId: 0, recipeId: 'R1' });
assert.equal(success.success, true);
assert.deepEqual(success.credited, [{ cardId: 'U001', quality: 2, quantity: 1 }]);
assert.deepEqual(successService.snapshot().materials, []);
assert.deepEqual(successService.snapshot().cards, [{ cardId: 'U001', quality: 2, quantity: 1 }]);

const duplicateBefore = successService.save();
const duplicate = successService.refine({ requestId: 'success-1', slotId: 0, recipeId: 'R1' });
assert.deepEqual(duplicate, success, 'a duplicate refining request must replay the original receipt');
assert.equal(successService.save(), duplicateBefore, 'a duplicate must not consume materials or persist again');
expectCode('same request ID with changed slot payload', () => successService.refine({ requestId: 'success-1', slotId: 0, recipeId: 'R1', materials: recipe.materials }), 'REQUEST_CONFLICT');

const slotsBeforeRefresh = successService.snapshot().slots;
const refresh = successService.refresh({ requestId: 'refresh-1', at: SHANGHAI_BEFORE_MIDNIGHT });
assert.equal(refresh.operation, 'REFRESH');
assert.equal(refresh.spentRefreshTickets, 1, 'manual refresh must spend exactly one refresh ticket');
assert.equal(successService.snapshot().refreshTickets, 0);
assert.notDeepEqual(successService.snapshot().slots, slotsBeforeRefresh, 'manual refresh must rotate the offered slot recipe');
const refreshSerialized = successService.save();
const refreshDuplicate = successService.refresh({ requestId: 'refresh-1', at: SHANGHAI_BEFORE_MIDNIGHT });
assert.deepEqual(refreshDuplicate, refresh, 'duplicate refresh must replay without spending another ticket');
assert.equal(successService.save(), refreshSerialized);
expectCode('refresh ticket exhaustion', () => successService.refresh({ requestId: 'refresh-2', at: SHANGHAI_BEFORE_MIDNIGHT }), 'REFRESH_TICKETS_EXHAUSTED');

const timedService = makeService({ recipes: [recipe, recipe2] });
const timedSlots = timedService.snapshot().slots;
const beforeBoundary = timedService.synchronize(SHANGHAI_MIDNIGHT - 1);
assert.equal(beforeBoundary.refreshedCycles, 0, 'the instant before local midnight must not refresh');
const atBoundary = timedService.synchronize(SHANGHAI_MIDNIGHT);
assert.equal(atBoundary.refreshedCycles, 1, 'refresh must happen at the exact local-time boundary');
assert.notDeepEqual(atBoundary.state.slots, timedSlots);
assert.equal(atBoundary.state.lastRefreshAt, SHANGHAI_MIDNIGHT);
assert.equal(atBoundary.state.nextRefreshAt, Date.parse('2026-08-21T16:00:00.000Z'));
expectCode('time cannot move backwards', () => timedService.synchronize(SHANGHAI_MIDNIGHT - 2), 'TIME_REVERSED');
expectCode('invalid timezone', () => makeService({ timezone: 'Not/A-Timezone' }), 'INVALID_CONFIG');
expectCode('invalid refresh hour', () => makeService({ refreshHour: 24 }), 'INVALID_CONFIG');
expectCode('invalid timestamp', () => timedService.synchronize(Number.MAX_SAFE_INTEGER), 'INVALID_TIME');

const REFRESH_HOUR_PROBE = Date.parse('2026-08-20T16:30:00.000Z');
for (let refreshHour = 0; refreshHour <= 23; refreshHour += 1) {
  const hourlyService = makeService({
    refreshHour,
    clock: { now: () => REFRESH_HOUR_PROBE },
  });
  const hourlyState = hourlyService.snapshot();
  assert(hourlyState.lastRefreshAt < hourlyState.nextRefreshAt, `refreshHour=${refreshHour} must create an ordered window`);
  assert.doesNotThrow(() => hourlyService.refine({ requestId: `hourly-refine-${refreshHour}`, slotId: 0, recipeId: 'R1' }), `refreshHour=${refreshHour} first refine must be valid`);

  const restoredHourlyService = restoreCardRefiningService(hourlyService.save(), {
    recipes: [recipe],
    slotCount: 1,
    timezone: 'Asia/Shanghai',
    refreshHour,
    rng: () => 0,
  });
  assert.equal(restoredHourlyService.snapshot().lastRefreshAt, hourlyService.snapshot().lastRefreshAt, `refreshHour=${refreshHour} restore must preserve the previous boundary`);
}
const nonMidnightService = makeService({
  refreshHour: 6,
  refreshMinute: 30,
  clock: { now: () => REFRESH_HOUR_PROBE },
});
const restoredNonMidnightService = restoreCardRefiningService(nonMidnightService.save(), {
  recipes: [recipe],
  slotCount: 1,
  timezone: 'Asia/Shanghai',
  refreshHour: 6,
  refreshMinute: 30,
  rng: () => 0,
});
assert.deepEqual(restoredNonMidnightService.snapshot(), nonMidnightService.snapshot(), 'restore must preserve a non-midnight, non-zero-minute refresh window');

const moduloRecipes = Array.from({ length: 44 }, (_, index) => ({
  id: `R${index}`,
  materials: [{ materialId: 'CARD_DUST', quantity: 1 }],
  output: { cardId: 'U001', quality: 1, quantity: 1 },
  probability: 1,
  failureRefund: [],
}));
const moduloService = createCardRefiningService({
  recipes: moduloRecipes,
  slotCount: 3,
  timezone: 'Asia/Shanghai',
  clock: { now: () => SHANGHAI_BEFORE_MIDNIGHT },
  refreshTickets: 1,
});
const moduloState = JSON.parse(moduloService.save());
moduloState.refreshCount = Number.MAX_SAFE_INTEGER - 1;
moduloState.slots = [
  { slotId: 0, recipeId: 'R18' },
  { slotId: 1, recipeId: 'R19' },
  { slotId: 2, recipeId: 'R20' },
];
const restoredModuloService = restoreCardRefiningService(JSON.stringify(moduloState), {
  recipes: moduloRecipes,
  slotCount: 3,
  timezone: 'Asia/Shanghai',
  clock: { now: () => SHANGHAI_BEFORE_MIDNIGHT },
  rng: () => 0,
});
const moduloRefresh = restoredModuloService.refresh({ requestId: 'safe-modulo-refresh' });
assert.equal(moduloRefresh.refreshCount, Number.MAX_SAFE_INTEGER, 'refresh count must remain a safe integer at the boundary');
assert.deepEqual(restoredModuloService.snapshot().slots, [
  { slotId: 0, recipeId: 'R21' },
  { slotId: 1, recipeId: 'R22' },
  { slotId: 2, recipeId: 'R23' },
], 'slot selection must use exact modular arithmetic for large refresh counts');

const slotMismatch = makeService({ rng: () => 0 });
const slotSave = slotMismatch.save();
expectCode('slot recipe mismatch', () => slotMismatch.refine({ requestId: 'wrong-slot-recipe', slotId: 0, recipeId: 'missing' }), 'SLOT_RECIPE_MISMATCH');
assert.equal(slotMismatch.save(), slotSave, 'slot validation failure must not mutate state');
expectCode('input mismatch', () => slotMismatch.refine({ requestId: 'wrong-input', slotId: 0, recipeId: 'R1', materials: [{ materialId: 'CARD_DUST', quantity: 2 }] }), 'MATERIAL_INPUT_MISMATCH');
assert.equal(slotMismatch.save(), slotSave);
expectCode('insufficient materials', () => createCardRefiningService({ recipes: [recipe], slotCount: 1, materials: [], rng: () => { throw new Error('rng must not be called'); } }).refine({ requestId: 'short-1', slotId: 0, recipeId: 'R1' }), 'INSUFFICIENT_MATERIALS');

for (const [label, invalidRecipes] of [
  ['null recipes', null],
  ['null wrapper', { recipes: null }],
  ['missing wrapper', {}],
  ['numeric recipes', 42],
  ['empty recipes', []],
]) {
  expectCode(label, () => createCardRefiningService({ recipes: invalidRecipes }), 'INVALID_CONFIG');
}
for (const dangerousRecipeId of new Set(['__proto__', ...Object.getOwnPropertyNames(Object.prototype)])) {
  expectCode(`dangerous recipe key ${dangerousRecipeId}`, () => createCardRefiningService({ recipes: [{ ...recipe, id: dangerousRecipeId }] }), 'INVALID_CONFIG');
}
expectCode('prototype material key', () => createCardRefiningService({ recipes: [{ ...recipe, materials: [{ materialId: '__proto__', quantity: 1 }] }] }), 'INVALID_CONFIG');
expectCode('zero quantity', () => createCardRefiningService({ recipes: [{ ...recipe, materials: [{ materialId: 'CARD_DUST', quantity: 0 }] }] }), 'INVALID_CONFIG');
expectCode('fractional quantity', () => createCardRefiningService({ recipes: [{ ...recipe, materials: [{ materialId: 'CARD_DUST', quantity: 1.5 }] }] }), 'INVALID_CONFIG');
expectCode('unsafe quantity', () => createCardRefiningService({ recipes: [{ ...recipe, materials: [{ materialId: 'CARD_DUST', quantity: Number.MAX_SAFE_INTEGER + 1 }] }] }), 'INVALID_CONFIG');
expectCode('probability out of range', () => createCardRefiningService({ recipes: [{ ...recipe, probability: 1.1 }] }), 'INVALID_CONFIG');
expectCode('slot count exceeds recipes', () => createCardRefiningService({ recipes: [recipe], slotCount: 2 }), 'INVALID_CONFIG');

const saturated = makeService({ materials: [{ materialId: 'CARD_DUST', quantity: 3 }], cards: [{ cardId: 'U001', quality: 2, quantity: Number.MAX_SAFE_INTEGER }], rng: () => 0 });
const saturatedBefore = saturated.save();
expectCode('card output overflow', () => saturated.refine({ requestId: 'overflow-1', slotId: 0, recipeId: 'R1' }), 'QUANTITY_EXCEEDED');
assert.equal(saturated.save(), saturatedBefore, 'output overflow must not debit inputs');
expectCode('refresh ticket unsafe integer', () => makeService({ refreshTickets: Number.MAX_SAFE_INTEGER + 1 }), 'INVALID_CONFIG');

let failPersistence = true;
const persistenceService = makeService({ persist: () => { if (failPersistence) throw new Error('disk full'); } });
const persistenceBefore = persistenceService.save();
expectCode('persist failure', () => persistenceService.refine({ requestId: 'persist-1', slotId: 0, recipeId: 'R1' }), 'PERSISTENCE_FAILED');
assert.equal(persistenceService.save(), persistenceBefore, 'persist failure must roll back slots, inventory, ledger and receipt');
failPersistence = false;
assert.equal(persistenceService.refine({ requestId: 'persist-1', slotId: 0, recipeId: 'R1' }).success, true, 'the service must remain usable after a persist failure');

let failScheduledPersistence = true;
const scheduledPersistence = makeService({
  recipes: [recipe, recipe2],
  persist: () => { if (failScheduledPersistence) throw new Error('scheduled write failed'); },
});
const scheduledBefore = scheduledPersistence.save();
expectCode('scheduled persist failure', () => scheduledPersistence.synchronize(SHANGHAI_MIDNIGHT), 'PERSISTENCE_FAILED');
assert.equal(scheduledPersistence.save(), scheduledBefore, 'scheduled refresh persistence failure must roll back the refresh');
failScheduledPersistence = false;
assert.equal(scheduledPersistence.synchronize(SHANGHAI_MIDNIGHT).refreshedCycles, 1);

let reentryError;
let reentryService;
reentryService = makeService({ persist: () => {
  try { reentryService.refine({ requestId: 'nested-1', slotId: 0, recipeId: 'R1' }); } catch (error) { reentryError = error; }
} });
reentryService.refine({ requestId: 'outer-1', slotId: 0, recipeId: 'R1' });
assert(reentryError instanceof CardRefiningError && reentryError.code === 'REENTRANT', 'persist re-entry must fail fast');
assert.equal(reentryService.snapshot().ledger.length, 1, 'caught re-entry must not append a nested ledger entry');

let abortingService;
const abortingBeforeHolder = { active: true };
abortingService = makeService({ persist: () => {
  if (abortingBeforeHolder.active) abortingService.refine({ requestId: 'nested-abort-1', slotId: 0, recipeId: 'R1' });
} });
const abortingBefore = abortingService.save();
expectCode('unhandled persist re-entry', () => abortingService.refine({ requestId: 'outer-abort-1', slotId: 0, recipeId: 'R1' }), 'REENTRANT');
assert.equal(abortingService.save(), abortingBefore, 'unhandled re-entry must roll back the outer transaction');
abortingBeforeHolder.active = false;
assert.equal(abortingService.refine({ requestId: 'after-abort-1', slotId: 0, recipeId: 'R1' }).success, true);

const saved = boundaryService.save();
const restored = restoreCardRefiningService(saved, { recipes: [recipe], slotCount: 1, timezone: 'Asia/Shanghai', rng: () => 0 });
assert.deepEqual(restored.snapshot(), boundaryService.snapshot(), 'restore must preserve slots, inventory, schedule and receipts');
assert.equal(restored.save(), saved, 'restore must serialize deterministically');
assert.deepEqual(restored.refine({ requestId: 'failure-1', slotId: 0, recipeId: 'R1', materials: recipe.materials }), failure, 'restored duplicate must replay the original result');
assert(Object.isFrozen(restored.snapshot()));
assert(Object.isFrozen(restored.snapshot().slots[0]));
assert(Object.isFrozen(restored.snapshot().ledger[0]));
assert(Object.isFrozen(restored.snapshot().receipts[0].result));
assert.throws(() => { restored.snapshot().slots[0].recipeId = 'R1'; }, TypeError);

const semanticSaved = timedService.save();
const semanticRestoreOptions = { recipes: [recipe, recipe2], slotCount: 1, timezone: 'Asia/Shanghai', rng: () => 0 };
const tamperedSlotRecipe = JSON.parse(semanticSaved);
tamperedSlotRecipe.slots[0].recipeId = 'R1';
expectCode('tampered known slot recipe', () => restoreCardRefiningService(JSON.stringify(tamperedSlotRecipe), semanticRestoreOptions), 'INVALID_STATE');
const tamperedLastRefreshAt = JSON.parse(semanticSaved);
tamperedLastRefreshAt.lastRefreshAt -= 1;
expectCode('tampered last refresh boundary', () => restoreCardRefiningService(JSON.stringify(tamperedLastRefreshAt), semanticRestoreOptions), 'INVALID_STATE');
const tamperedNextRefreshAt = JSON.parse(semanticSaved);
tamperedNextRefreshAt.nextRefreshAt += 1;
expectCode('tampered next refresh boundary', () => restoreCardRefiningService(JSON.stringify(tamperedNextRefreshAt), semanticRestoreOptions), 'INVALID_STATE');
const tamperedRefreshCount = JSON.parse(semanticSaved);
tamperedRefreshCount.refreshCount = 0;
expectCode('tampered refresh count', () => restoreCardRefiningService(JSON.stringify(tamperedRefreshCount), semanticRestoreOptions), 'INVALID_STATE');
const tamperedReachableState = JSON.parse(boundaryService.save());
tamperedReachableState.refreshCount = 1;
tamperedReachableState.slots[0].recipeId = 'R2';
expectCode('coordinated unreachable refresh state', () => restoreCardRefiningService(JSON.stringify(tamperedReachableState), { recipes: [recipe, recipe2], slotCount: 1, timezone: 'Asia/Shanghai', rng: () => 0 }), 'INVALID_STATE');
const tamperedReceiptRefreshCount = JSON.parse(saved);
tamperedReceiptRefreshCount.receipts[0].result.refreshCount = 1;
expectCode('tampered receipt refresh count', () => restoreCardRefiningService(JSON.stringify(tamperedReceiptRefreshCount), { recipes: [recipe], slotCount: 1, timezone: 'Asia/Shanghai', rng: () => 0 }), 'INVALID_STATE');

const corrupted = JSON.parse(saved);
corrupted.receipts = [];
expectCode('ledger without receipt', () => restoreCardRefiningService(JSON.stringify(corrupted), { recipes: [recipe], slotCount: 1 }), 'INVALID_STATE');
const unknownStateField = JSON.parse(saved);
Object.defineProperty(unknownStateField, '__proto__', { configurable: true, enumerable: true, value: true });
expectCode('unknown state field', () => restoreCardRefiningService(JSON.stringify(unknownStateField), { recipes: [recipe], slotCount: 1 }), 'INVALID_STATE');
expectCode('unsupported schema', () => restoreCardRefiningService(JSON.stringify({ ...JSON.parse(saved), schemaVersion: CARD_REFINING_SCHEMA_VERSION + 1 }), { recipes: [recipe], slotCount: 1 }), 'INVALID_STATE');

console.log(`T229 card refining PASS: real-cards=${realCardIds.size}, production-recipes=${CARD_REFINING_RECIPES.length}, slots, probability/output, ticket refresh, timezone boundary, idempotency, restore, rollback, prototype/integer/freeze guards`);
