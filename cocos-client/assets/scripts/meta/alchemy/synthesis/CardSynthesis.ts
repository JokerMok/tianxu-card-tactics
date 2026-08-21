import { CARD_QUALITY_CATALOG_DATA } from '../../cards/quality/index.ts';

export const CARD_SYNTHESIS_SCHEMA_VERSION = 1 as const;
export const CARD_QUALITY_LEVELS = Object.freeze([1, 2, 3, 4, 5, 6]) as readonly [1, 2, 3, 4, 5, 6];
export type CardQuality = (typeof CARD_QUALITY_LEVELS)[number];

export interface SynthesisMaterial {
  readonly cardId: string;
  readonly quality: CardQuality;
  readonly quantity: number;
}

export interface CardSynthesisPityRule {
  readonly increment: number;
  readonly guaranteedAfterFailures: number;
}

export interface CardSynthesisRecipe {
  readonly id: string;
  readonly materials: readonly SynthesisMaterial[];
  readonly output: SynthesisMaterial;
  readonly baseProbability: number;
  readonly pity: CardSynthesisPityRule;
  readonly failureRefund?: readonly SynthesisMaterial[];
}

export interface CardSynthesisRequest {
  readonly requestId: string;
  readonly recipeId: string;
  readonly materials?: readonly SynthesisMaterial[];
}

export interface CardSynthesisLedgerEntry {
  readonly sequence: number;
  readonly requestId: string;
  readonly recipeId: string;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly roll: number | null;
  readonly probability: number;
  readonly guaranteed: boolean;
  readonly pityBefore: number;
  readonly pityAfter: number;
  readonly debited: readonly SynthesisMaterial[];
  readonly returned: readonly SynthesisMaterial[];
  readonly credited: readonly SynthesisMaterial[];
}

export interface CardSynthesisResult {
  readonly requestId: string;
  readonly recipeId: string;
  readonly outcome: 'SUCCESS' | 'FAILURE';
  readonly success: boolean;
  readonly roll: number | null;
  readonly probability: number;
  readonly guaranteed: boolean;
  readonly pityBefore: number;
  readonly pityAfter: number;
  readonly debited: readonly SynthesisMaterial[];
  readonly returned: readonly SynthesisMaterial[];
  readonly credited: readonly SynthesisMaterial[];
  readonly ledgerSequence: number;
  readonly applied: boolean;
}

interface CardSynthesisReceipt {
  readonly requestId: string;
  readonly fingerprint: string;
  readonly result: CardSynthesisResult;
}

export interface CardSynthesisState {
  readonly schemaVersion: typeof CARD_SYNTHESIS_SCHEMA_VERSION;
  readonly materials: readonly SynthesisMaterial[];
  readonly pity: readonly { readonly recipeId: string; readonly failures: number }[];
  readonly ledger: readonly CardSynthesisLedgerEntry[];
  readonly receipts: readonly CardSynthesisReceipt[];
}

export interface CardSynthesisOptions {
  readonly recipes?: readonly unknown[] | { readonly recipes: readonly unknown[] };
  readonly state?: unknown;
  readonly initialState?: unknown;
  readonly rng?: () => number;
  readonly onSave?: (serialized: string) => void;
  readonly persist?: (serialized: string) => void;
}

export type CardSynthesisErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_REQUEST'
  | 'UNKNOWN_RECIPE'
  | 'IDEMPOTENCY_CONFLICT'
  | 'MATERIAL_INPUT_MISMATCH'
  | 'INSUFFICIENT_MATERIALS'
  | 'INVALID_RNG'
  | 'QUANTITY_EXCEEDED'
  | 'REENTRANT'
  | 'PERSISTENCE_FAILED';

export class CardSynthesisError extends Error {
  readonly code: CardSynthesisErrorCode;
  readonly reason: CardSynthesisErrorCode;
  readonly cause?: unknown;

  constructor(code: CardSynthesisErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'CardSynthesisError';
    this.code = code;
    this.reason = code;
    this.cause = cause;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const CARD_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const RECIPE_KEYS = new Set(['id', 'materials', 'output', 'baseProbability', 'pity', 'failureRefund']);
const MATERIAL_KEYS = new Set(['cardId', 'quality', 'quantity']);
const PITY_KEYS = new Set(['increment', 'guaranteedAfterFailures']);
const STATE_KEYS = new Set(['schemaVersion', 'materials', 'pity', 'ledger', 'receipts']);
const PITY_STATE_KEYS = new Set(['recipeId', 'failures']);
const LEDGER_KEYS = new Set([
  'sequence', 'requestId', 'recipeId', 'outcome', 'roll', 'probability', 'guaranteed',
  'pityBefore', 'pityAfter', 'debited', 'returned', 'credited',
]);
const RESULT_KEYS = new Set([
  'requestId', 'recipeId', 'outcome', 'success', 'roll', 'probability', 'guaranteed',
  'pityBefore', 'pityAfter', 'debited', 'returned', 'credited', 'ledgerSequence', 'applied',
]);
const RECEIPT_KEYS = new Set(['requestId', 'fingerprint', 'result']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(code: CardSynthesisErrorCode, message: string, cause?: unknown): never {
  throw new CardSynthesisError(code, message, cause);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string, code: CardSynthesisErrorCode): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(code, `${label} contains unknown field: ${key}`);
  }
}

function assertId(value: unknown, label: string, pattern = ID_PATTERN): asserts value is string {
  if (typeof value !== 'string' || !pattern.test(value) || value.trim() !== value) {
    fail('INVALID_CONFIG', `${label} must be a non-empty safe identifier`);
  }
}

function assertPositiveInteger(value: unknown, label: string, code: CardSynthesisErrorCode = 'INVALID_CONFIG'): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    fail(code, `${label} must be a positive safe integer`);
  }
}

function assertNonNegativeInteger(value: unknown, label: string, code: CardSynthesisErrorCode = 'INVALID_STATE'): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail(code, `${label} must be a non-negative safe integer`);
  }
}

function assertProbability(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail('INVALID_CONFIG', `${label} must be a finite number in [0, 1]`);
  }
}

function normalizeQuality(value: unknown, label: string, code: CardSynthesisErrorCode = 'INVALID_CONFIG'): CardQuality {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || !CARD_QUALITY_LEVELS.includes(value as CardQuality)) {
    fail(code, `${label} must be one of 1, 2, 3, 4, 5 or 6`);
  }
  return value as CardQuality;
}

function materialKey(material: Pick<SynthesisMaterial, 'cardId' | 'quality'>): string {
  return `${material.cardId}:${material.quality}`;
}

function copyMaterial(material: SynthesisMaterial): SynthesisMaterial {
  return Object.freeze({ cardId: material.cardId, quality: material.quality, quantity: material.quantity });
}

function copyMaterials(materials: readonly SynthesisMaterial[]): readonly SynthesisMaterial[] {
  return Object.freeze(materials.map(copyMaterial));
}

function normalizeMaterial(value: unknown, label: string, code: CardSynthesisErrorCode): SynthesisMaterial {
  if (!isRecord(value)) fail(code, `${label} must be an object`);
  assertOnlyKeys(value, MATERIAL_KEYS, label, code);
  if (!hasOwn(value, 'cardId') || !hasOwn(value, 'quality') || !hasOwn(value, 'quantity')) {
    fail(code, `${label} must contain cardId, quality and quantity`);
  }
  assertId(value.cardId, `${label}.cardId`, CARD_ID_PATTERN);
  const quality = normalizeQuality(value.quality, `${label}.quality`, code);
  assertPositiveInteger(value.quantity, `${label}.quantity`, code);
  return { cardId: value.cardId, quality, quantity: value.quantity };
}

function normalizeMaterialList(value: unknown, label: string, code: CardSynthesisErrorCode, allowEmpty = false): readonly SynthesisMaterial[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(code, `${label} must be an ${allowEmpty ? 'array' : 'non-empty array'}`);
  const result = value.map((entry, index) => normalizeMaterial(entry, `${label}[${index}]`, code));
  const keys = new Set<string>();
  for (const material of result) {
    const key = materialKey(material);
    if (keys.has(key)) fail(code, `${label} contains duplicate material: ${key}`);
    keys.add(key);
  }
  return Object.freeze([...result].sort(compareMaterials).map(copyMaterial));
}

function normalizeRefund(value: unknown, recipeMaterials: readonly SynthesisMaterial[], label: string): readonly SynthesisMaterial[] {
  if (value === undefined) return Object.freeze([]);
  const refund = normalizeMaterialList(value, label, 'INVALID_CONFIG');
  const inputByKey = new Map(recipeMaterials.map((material) => [materialKey(material), material.quantity]));
  for (const material of refund) {
    const inputQuantity = inputByKey.get(materialKey(material));
    if (inputQuantity === undefined || material.quantity > inputQuantity) {
      fail('INVALID_CONFIG', `${label} cannot return more than its recipe input`);
    }
  }
  return refund;
}

function compareMaterials(left: SynthesisMaterial, right: SynthesisMaterial): number {
  const idOrder = left.cardId.localeCompare(right.cardId);
  return idOrder === 0 ? left.quality - right.quality : idOrder;
}

function normalizeRecipe(value: unknown, index: number): CardSynthesisRecipe {
  const label = `recipes[${index}]`;
  if (!isRecord(value)) fail('INVALID_CONFIG', `${label} must be an object`);
  assertOnlyKeys(value, RECIPE_KEYS, label, 'INVALID_CONFIG');
  for (const key of ['id', 'materials', 'output', 'baseProbability', 'pity']) {
    if (!hasOwn(value, key)) fail('INVALID_CONFIG', `${label}.${key} is required`);
  }
  assertId(value.id, `${label}.id`);
  const materials = normalizeMaterialList(value.materials, `${label}.materials`, 'INVALID_CONFIG');
  const output = normalizeMaterial(value.output, `${label}.output`, 'INVALID_CONFIG');
  assertProbability(value.baseProbability, `${label}.baseProbability`);
  if (!isRecord(value.pity)) fail('INVALID_CONFIG', `${label}.pity must be an object`);
  assertOnlyKeys(value.pity, PITY_KEYS, `${label}.pity`, 'INVALID_CONFIG');
  if (!hasOwn(value.pity, 'increment') || !hasOwn(value.pity, 'guaranteedAfterFailures')) {
    fail('INVALID_CONFIG', `${label}.pity must contain increment and guaranteedAfterFailures`);
  }
  assertProbability(value.pity.increment, `${label}.pity.increment`);
  assertPositiveInteger(value.pity.guaranteedAfterFailures, `${label}.pity.guaranteedAfterFailures`);
  const failureRefund = normalizeRefund(value.failureRefund, materials, `${label}.failureRefund`);
  return Object.freeze({
    id: value.id,
    materials: copyMaterials(materials),
    output: copyMaterial(output),
    baseProbability: value.baseProbability,
    pity: Object.freeze({ increment: value.pity.increment, guaranteedAfterFailures: value.pity.guaranteedAfterFailures }),
    failureRefund: copyMaterials(failureRefund),
  });
}

function normalizeRecipes(input: readonly unknown[] | { readonly recipes: readonly unknown[] } | undefined): ReadonlyMap<string, CardSynthesisRecipe> {
  let rows: unknown;
  if (input === undefined) rows = CARD_SYNTHESIS_RECIPES;
  else if (Array.isArray(input)) rows = input;
  else if (isRecord(input) && hasOwn(input, 'recipes')) rows = input.recipes;
  else fail('INVALID_CONFIG', 'synthesis recipes must be a non-empty array or { recipes: [...] }');
  if (!Array.isArray(rows) || rows.length === 0) fail('INVALID_CONFIG', 'synthesis recipes must be a non-empty array');
  const recipes = new Map<string, CardSynthesisRecipe>();
  rows.forEach((row, index) => {
    const recipe = normalizeRecipe(row, index);
    if (recipes.has(recipe.id)) fail('INVALID_CONFIG', `duplicate synthesis recipe: ${recipe.id}`);
    recipes.set(recipe.id, recipe);
  });
  return recipes;
}

function parseObject(value: unknown, label: string): Record<string, unknown> {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch (error) { fail('INVALID_STATE', `${label} is not valid JSON`, error); }
  }
  if (!isRecord(value)) fail('INVALID_STATE', `${label} must be an object`);
  return value;
}

function cloneResult(result: CardSynthesisResult): CardSynthesisResult {
  return Object.freeze({
    ...result,
    debited: copyMaterials(result.debited),
    returned: copyMaterials(result.returned),
    credited: copyMaterials(result.credited),
  });
}

function normalizeResult(value: unknown, label: string): CardSynthesisResult {
  if (!isRecord(value)) fail('INVALID_STATE', `${label} must be an object`);
  assertOnlyKeys(value, RESULT_KEYS, label, 'INVALID_STATE');
  assertId(value.requestId, `${label}.requestId`);
  assertId(value.recipeId, `${label}.recipeId`);
  if (value.outcome !== 'SUCCESS' && value.outcome !== 'FAILURE') fail('INVALID_STATE', `${label}.outcome is invalid`);
  if (typeof value.success !== 'boolean' || value.success !== (value.outcome === 'SUCCESS')) fail('INVALID_STATE', `${label}.success is inconsistent`);
  if (value.roll !== null && (typeof value.roll !== 'number' || !Number.isFinite(value.roll) || value.roll < 0 || value.roll >= 1)) fail('INVALID_STATE', `${label}.roll is invalid`);
  assertProbability(value.probability, `${label}.probability`);
  if (typeof value.guaranteed !== 'boolean') fail('INVALID_STATE', `${label}.guaranteed is invalid`);
  assertNonNegativeInteger(value.pityBefore, `${label}.pityBefore`);
  assertNonNegativeInteger(value.pityAfter, `${label}.pityAfter`);
  const debited = normalizeMaterialList(value.debited, `${label}.debited`, 'INVALID_STATE');
  const returned = value.returned === undefined ? Object.freeze([]) : normalizeMaterialList(value.returned, `${label}.returned`, 'INVALID_STATE', true);
  const credited = value.credited === undefined ? Object.freeze([]) : normalizeMaterialList(value.credited, `${label}.credited`, 'INVALID_STATE', true);
  assertPositiveInteger(value.ledgerSequence, `${label}.ledgerSequence`, 'INVALID_STATE');
  if (value.applied !== true) fail('INVALID_STATE', `${label}.applied must be true`);
  return cloneResult({
    requestId: value.requestId,
    recipeId: value.recipeId,
    outcome: value.outcome,
    success: value.success,
    roll: value.roll,
    probability: value.probability,
    guaranteed: value.guaranteed,
    pityBefore: value.pityBefore,
    pityAfter: value.pityAfter,
    debited,
    returned,
    credited,
    ledgerSequence: value.ledgerSequence,
    applied: true,
  });
}

function normalizeState(value: unknown): CardSynthesisState {
  const raw = parseObject(value, 'synthesis state');
  assertOnlyKeys(raw, STATE_KEYS, 'synthesis state', 'INVALID_STATE');
  if (raw.schemaVersion !== CARD_SYNTHESIS_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported synthesis state schema');
  for (const key of ['materials', 'pity', 'ledger', 'receipts']) {
    if (!hasOwn(raw, key)) fail('INVALID_STATE', `synthesis state.${key} is required`);
  }
  const materials = normalizeMaterialList(raw.materials, 'synthesis state.materials', 'INVALID_STATE', true);
  if (!Array.isArray(raw.pity)) fail('INVALID_STATE', 'synthesis state.pity must be an array');
  const pity = raw.pity.map((entry, index) => {
    const label = `synthesis state.pity[${index}]`;
    if (!isRecord(entry)) fail('INVALID_STATE', `${label} must be an object`);
    assertOnlyKeys(entry, PITY_STATE_KEYS, label, 'INVALID_STATE');
    assertId(entry.recipeId, `${label}.recipeId`);
    assertNonNegativeInteger(entry.failures, `${label}.failures`);
    return { recipeId: entry.recipeId, failures: entry.failures };
  });
  if (new Set(pity.map((entry) => entry.recipeId)).size !== pity.length) fail('INVALID_STATE', 'synthesis state.pity contains duplicates');
  if (!Array.isArray(raw.ledger)) fail('INVALID_STATE', 'synthesis state.ledger must be an array');
  const ledger = raw.ledger.map((entry, index) => {
    const label = `synthesis state.ledger[${index}]`;
    if (!isRecord(entry)) fail('INVALID_STATE', `${label} must be an object`);
    assertOnlyKeys(entry, LEDGER_KEYS, label, 'INVALID_STATE');
    assertPositiveInteger(entry.sequence, `${label}.sequence`, 'INVALID_STATE');
    assertId(entry.requestId, `${label}.requestId`);
    assertId(entry.recipeId, `${label}.recipeId`);
    if (entry.outcome !== 'SUCCESS' && entry.outcome !== 'FAILURE') fail('INVALID_STATE', `${label}.outcome is invalid`);
    if (entry.roll !== null && (typeof entry.roll !== 'number' || !Number.isFinite(entry.roll) || entry.roll < 0 || entry.roll >= 1)) fail('INVALID_STATE', `${label}.roll is invalid`);
    assertProbability(entry.probability, `${label}.probability`);
    if (typeof entry.guaranteed !== 'boolean') fail('INVALID_STATE', `${label}.guaranteed is invalid`);
    assertNonNegativeInteger(entry.pityBefore, `${label}.pityBefore`);
    assertNonNegativeInteger(entry.pityAfter, `${label}.pityAfter`);
    const debited = normalizeMaterialList(entry.debited, `${label}.debited`, 'INVALID_STATE');
    const returned = normalizeMaterialList(entry.returned, `${label}.returned`, 'INVALID_STATE', true);
    const credited = normalizeMaterialList(entry.credited, `${label}.credited`, 'INVALID_STATE', true);
    return Object.freeze({
      sequence: entry.sequence, requestId: entry.requestId, recipeId: entry.recipeId, outcome: entry.outcome,
      roll: entry.roll, probability: entry.probability, guaranteed: entry.guaranteed,
      pityBefore: entry.pityBefore, pityAfter: entry.pityAfter, debited, returned, credited,
    });
  });
  ledger.forEach((entry, index) => {
    if (entry.sequence !== index + 1) fail('INVALID_STATE', 'synthesis ledger sequence is not contiguous');
  });
  if (!Array.isArray(raw.receipts)) fail('INVALID_STATE', 'synthesis state.receipts must be an array');
  const receipts = raw.receipts.map((entry, index) => {
    const label = `synthesis state.receipts[${index}]`;
    if (!isRecord(entry)) fail('INVALID_STATE', `${label} must be an object`);
    assertOnlyKeys(entry, RECEIPT_KEYS, label, 'INVALID_STATE');
    assertId(entry.requestId, `${label}.requestId`);
    if (typeof entry.fingerprint !== 'string' || entry.fingerprint.length === 0) fail('INVALID_STATE', `${label}.fingerprint is invalid`);
    const result = normalizeResult(entry.result, `${label}.result`);
    if (result.requestId !== entry.requestId || result.ledgerSequence > ledger.length) fail('INVALID_STATE', `${label} result is inconsistent`);
    return Object.freeze({ requestId: entry.requestId, fingerprint: entry.fingerprint, result });
  });
  if (new Set(ledger.map((entry) => entry.requestId)).size !== ledger.length) fail('INVALID_STATE', 'synthesis ledger request IDs must be unique');
  if (new Set(receipts.map((entry) => entry.requestId)).size !== receipts.length) fail('INVALID_STATE', 'synthesis receipts must be unique');
  return freezeState({ schemaVersion: CARD_SYNTHESIS_SCHEMA_VERSION, materials, pity, ledger, receipts });
}

function freezeState(state: CardSynthesisState): CardSynthesisState {
  return Object.freeze({
    schemaVersion: CARD_SYNTHESIS_SCHEMA_VERSION,
    materials: Object.freeze(state.materials.map(copyMaterial)),
    pity: Object.freeze(state.pity.map((entry) => Object.freeze({ recipeId: entry.recipeId, failures: entry.failures }))),
    ledger: Object.freeze(state.ledger.map((entry) => Object.freeze({
      ...entry, debited: copyMaterials(entry.debited), returned: copyMaterials(entry.returned), credited: copyMaterials(entry.credited),
    }))),
    receipts: Object.freeze(state.receipts.map((entry) => Object.freeze({ requestId: entry.requestId, fingerprint: entry.fingerprint, result: cloneResult(entry.result) }))),
  });
}

function defaultState(): CardSynthesisState {
  return freezeState({ schemaVersion: CARD_SYNTHESIS_SCHEMA_VERSION, materials: [], pity: [], ledger: [], receipts: [] });
}

function normalizeRequest(value: unknown): CardSynthesisRequest {
  if (!isRecord(value)) fail('INVALID_REQUEST', 'synthesis request must be an object');
  assertOnlyKeys(value, new Set(['requestId', 'recipeId', 'materials']), 'synthesis request', 'INVALID_REQUEST');
  assertId(value.requestId, 'synthesis request.requestId');
  assertId(value.recipeId, 'synthesis request.recipeId');
  return {
    requestId: value.requestId,
    recipeId: value.recipeId,
    ...(value.materials === undefined ? {} : { materials: normalizeMaterialList(value.materials, 'synthesis request.materials', 'INVALID_REQUEST') }),
  };
}

function requestFingerprint(request: CardSynthesisRequest): string {
  return JSON.stringify({ recipeId: request.recipeId, materials: request.materials ?? null });
}

function sameMaterials(left: readonly SynthesisMaterial[], right: readonly SynthesisMaterial[]): boolean {
  return left.length === right.length && left.every((material, index) => {
    const other = right[index];
    return material.cardId === other.cardId && material.quality === other.quality && material.quantity === other.quantity;
  });
}

function mapMaterials(materials: readonly SynthesisMaterial[]): Map<string, number> {
  return new Map(materials.map((material) => [materialKey(material), material.quantity]));
}

function listMaterials(values: Map<string, number>): readonly SynthesisMaterial[] {
  const result: SynthesisMaterial[] = [];
  for (const [key, quantity] of values) {
    if (quantity <= 0) continue;
    const separator = key.lastIndexOf(':');
    result.push({ cardId: key.slice(0, separator), quality: Number(key.slice(separator + 1)) as CardQuality, quantity });
  }
  return Object.freeze(result.sort(compareMaterials).map(copyMaterial));
}

function addQuantity(values: Map<string, number>, material: SynthesisMaterial, amount: number): void {
  const key = materialKey(material);
  const current = values.get(key) ?? 0;
  if (current > Number.MAX_SAFE_INTEGER - amount) fail('QUANTITY_EXCEEDED', `quantity exceeds the safe integer limit: ${key}`);
  values.set(key, current + amount);
}

function subtractQuantity(values: Map<string, number>, material: SynthesisMaterial): void {
  const current = values.get(materialKey(material)) ?? 0;
  if (current < material.quantity) fail('INSUFFICIENT_MATERIALS', `insufficient material: ${materialKey(material)}`);
  const next = current - material.quantity;
  if (next === 0) values.delete(materialKey(material));
  else values.set(materialKey(material), next);
}

function copyLedgerEntry(entry: CardSynthesisLedgerEntry): CardSynthesisLedgerEntry {
  return Object.freeze({
    ...entry,
    debited: copyMaterials(entry.debited), returned: copyMaterials(entry.returned), credited: copyMaterials(entry.credited),
  });
}

function makeDefaultRecipes(): readonly CardSynthesisRecipe[] {
  const entries = CARD_QUALITY_CATALOG_DATA.entries
    .filter((entry) => entry.quality < 6)
    .map((entry) => {
      const rate = [0, 0.8, 0.7, 0.6, 0.5, 0.4][entry.quality];
      return {
        id: `${entry.cardId}-Q${entry.quality}-TO-Q${entry.quality + 1}`,
        materials: [{ cardId: entry.cardId, quality: entry.quality, quantity: 3 }],
        output: { cardId: entry.cardId, quality: (entry.quality + 1) as CardQuality, quantity: 1 },
        baseProbability: rate,
        pity: { increment: 0.1, guaranteedAfterFailures: 4 },
        failureRefund: [{ cardId: entry.cardId, quality: entry.quality, quantity: 1 }],
      } satisfies CardSynthesisRecipe;
    });
  return Object.freeze(entries);
}

export const CARD_SYNTHESIS_RECIPES = makeDefaultRecipes();

export class CardSynthesisService {
  private readonly recipes: ReadonlyMap<string, CardSynthesisRecipe>;
  private readonly rng: () => number;
  private readonly onSave?: (serialized: string) => void;
  private state: CardSynthesisState;
  private transactionActive = false;

  constructor(options: CardSynthesisOptions = {}) {
    if (!isRecord(options)) fail('INVALID_ARGUMENT', 'synthesis options must be an object');
    this.recipes = normalizeRecipes(options.recipes);
    if (options.onSave !== undefined && typeof options.onSave !== 'function') fail('INVALID_ARGUMENT', 'onSave must be a function');
    if (options.persist !== undefined && typeof options.persist !== 'function') fail('INVALID_ARGUMENT', 'persist must be a function');
    if (options.onSave !== undefined && options.persist !== undefined && options.onSave !== options.persist) fail('INVALID_ARGUMENT', 'onSave and persist cannot both be provided');
    if (options.rng !== undefined && typeof options.rng !== 'function') fail('INVALID_ARGUMENT', 'rng must be a function');
    this.rng = options.rng ?? Math.random;
    this.onSave = options.persist ?? options.onSave;
    this.state = normalizeState(options.state ?? options.initialState ?? defaultState());
    this.validateStateAgainstRecipes();
  }

  static restore(serialized: string, options: Omit<CardSynthesisOptions, 'state' | 'initialState'> = {}): CardSynthesisService {
    return new CardSynthesisService({ ...options, state: serialized });
  }

  snapshot(): CardSynthesisState {
    return freezeState(this.state);
  }

  save(): string {
    return JSON.stringify(this.snapshot());
  }

  recipesList(): readonly CardSynthesisRecipe[] {
    return Object.freeze([...this.recipes.values()].map((recipe) => Object.freeze({
      ...recipe,
      materials: copyMaterials(recipe.materials), output: copyMaterial(recipe.output),
      pity: Object.freeze({ ...recipe.pity }), failureRefund: copyMaterials(recipe.failureRefund ?? []),
    })));
  }

  getRecipe(recipeId: string): CardSynthesisRecipe {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) fail('UNKNOWN_RECIPE', `unknown synthesis recipe: ${recipeId}`);
    return Object.freeze({
      ...recipe, materials: copyMaterials(recipe.materials), output: copyMaterial(recipe.output),
      pity: Object.freeze({ ...recipe.pity }), failureRefund: copyMaterials(recipe.failureRefund ?? []),
    });
  }

  getPity(recipeId: string): number {
    this.getRecipe(recipeId);
    return this.state.pity.find((entry) => entry.recipeId === recipeId)?.failures ?? 0;
  }

  getReceipt(requestId: string): CardSynthesisResult | undefined {
    const receipt = this.state.receipts.find((entry) => entry.requestId === requestId);
    return receipt === undefined ? undefined : cloneResult(receipt.result);
  }

  synthesize(input: unknown): CardSynthesisResult {
    if (this.transactionActive) fail('REENTRANT', 'synthesis transaction cannot re-enter resolve, RNG or persistence');
    this.transactionActive = true;
    try {
      return this.synthesizeTransaction(input);
    } finally {
      this.transactionActive = false;
    }
  }

  private synthesizeTransaction(input: unknown): CardSynthesisResult {
    const request = normalizeRequest(input);
    const existing = this.state.receipts.find((receipt) => receipt.requestId === request.requestId);
    const fingerprint = requestFingerprint(request);
    if (existing) {
      if (existing.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', `request ID was already used with different input: ${request.requestId}`);
      return cloneResult(existing.result);
    }

    const recipe = this.recipes.get(request.recipeId);
    if (!recipe) fail('UNKNOWN_RECIPE', `unknown synthesis recipe: ${request.recipeId}`);
    if (request.materials !== undefined && !sameMaterials(request.materials, recipe.materials)) {
      fail('MATERIAL_INPUT_MISMATCH', 'submitted materials must exactly match the recipe inputs');
    }
    const currentMaterials = mapMaterials(this.state.materials);
    for (const material of recipe.materials) {
      if ((currentMaterials.get(materialKey(material)) ?? 0) < material.quantity) {
        fail('INSUFFICIENT_MATERIALS', `insufficient material: ${materialKey(material)}`);
      }
    }

    const pityBefore = this.getPity(recipe.id);
    const guaranteed = pityBefore >= recipe.pity.guaranteedAfterFailures;
    const probability = Math.min(1, recipe.baseProbability + pityBefore * recipe.pity.increment);
    let roll: number | null = null;
    let success = guaranteed;
    if (!guaranteed) {
      roll = this.rng();
      if (typeof roll !== 'number' || !Number.isFinite(roll) || roll < 0 || roll >= 1) fail('INVALID_RNG', 'rng must return a finite number in [0, 1)');
      success = roll < probability;
    }
    const returned = success ? Object.freeze([]) : copyMaterials(recipe.failureRefund ?? []);
    const credited = success ? Object.freeze([copyMaterial(recipe.output)]) : Object.freeze([]);
    const pityAfter = success ? 0 : pityBefore + 1;
    if (!Number.isSafeInteger(pityAfter)) fail('QUANTITY_EXCEEDED', 'pity counter exceeds the safe integer limit');
    const nextMaterials = new Map(currentMaterials);
    for (const material of recipe.materials) subtractQuantity(nextMaterials, material);
    for (const material of returned) addQuantity(nextMaterials, material, material.quantity);
    for (const material of credited) addQuantity(nextMaterials, material, material.quantity);

    const sequence = this.state.ledger.length + 1;
    if (!Number.isSafeInteger(sequence)) fail('QUANTITY_EXCEEDED', 'synthesis ledger sequence exceeds the safe integer limit');
    const ledgerEntry = copyLedgerEntry({
      sequence, requestId: request.requestId, recipeId: recipe.id,
      outcome: success ? 'SUCCESS' : 'FAILURE',
      roll, probability, guaranteed, pityBefore, pityAfter,
      debited: copyMaterials(recipe.materials), returned, credited,
    } as unknown as CardSynthesisLedgerEntry);
    const result = cloneResult({
      requestId: request.requestId, recipeId: recipe.id,
      outcome: success ? 'SUCCESS' : 'FAILURE', success, roll, probability, guaranteed,
      pityBefore, pityAfter, debited: copyMaterials(recipe.materials), returned, credited,
      ledgerSequence: sequence, applied: true,
    });
    const nextPity = this.state.pity.filter((entry) => entry.recipeId !== recipe.id);
    if (pityAfter > 0) nextPity.push({ recipeId: recipe.id, failures: pityAfter });
    nextPity.sort((left, right) => left.recipeId.localeCompare(right.recipeId));
    const nextState = freezeState({
      schemaVersion: CARD_SYNTHESIS_SCHEMA_VERSION,
      materials: listMaterials(nextMaterials), pity: nextPity,
      ledger: [...this.state.ledger, ledgerEntry],
      receipts: [...this.state.receipts, { requestId: request.requestId, fingerprint, result }],
    });
    const before = this.state;
    try {
      if (this.onSave) this.onSave(JSON.stringify(nextState));
      this.state = nextState;
      return cloneResult(result);
    } catch (error) {
      this.state = before;
      if (error instanceof CardSynthesisError && (error.code === 'REENTRANT' || error.code === 'PERSISTENCE_FAILED')) throw error;
      throw new CardSynthesisError('PERSISTENCE_FAILED', 'synthesis state persistence failed', error);
    }
  }

  attempt(input: unknown): CardSynthesisResult {
    return this.synthesize(input);
  }

  private validateStateAgainstRecipes(): void {
    for (const entry of this.state.pity) {
      const recipe = this.recipes.get(entry.recipeId);
      if (!recipe) fail('INVALID_STATE', `pity state references unknown recipe: ${entry.recipeId}`);
      if (entry.failures > recipe.pity.guaranteedAfterFailures) fail('INVALID_STATE', `pity state exceeds recipe threshold: ${entry.recipeId}`);
    }
    for (const entry of this.state.ledger) {
      if (!this.recipes.has(entry.recipeId)) fail('INVALID_STATE', `ledger references unknown recipe: ${entry.recipeId}`);
    }
    for (const receipt of this.state.receipts) {
      if (!this.recipes.has(receipt.result.recipeId)) fail('INVALID_STATE', `receipt references unknown recipe: ${receipt.result.recipeId}`);
    }
  }
}

export function createCardSynthesisService(options: CardSynthesisOptions = {}): CardSynthesisService {
  return new CardSynthesisService(options);
}

export function restoreCardSynthesisService(serialized: string, options: Omit<CardSynthesisOptions, 'state' | 'initialState'> = {}): CardSynthesisService {
  return CardSynthesisService.restore(serialized, options);
}

export const SynthesisService = CardSynthesisService;
