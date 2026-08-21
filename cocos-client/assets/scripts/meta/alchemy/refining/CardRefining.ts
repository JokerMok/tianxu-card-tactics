import { CARD_QUALITY_CATALOG_DATA } from '../../cards/quality/index.ts';

export const CARD_REFINING_SCHEMA_VERSION = 2 as const;
export const REFINING_SCHEMA_VERSION = CARD_REFINING_SCHEMA_VERSION;
export const DEFAULT_REFINING_SLOT_COUNT = 3;
export const DEFAULT_REFINING_REFRESH_TICKET_ID = 'REFINING_REFRESH_TICKET' as const;
export const DEFAULT_REFINING_REFRESH_HOUR = 0;
export const DEFAULT_REFINING_REFRESH_MINUTE = 0;
export const DEFAULT_REFINING_TIMEZONE = 'Asia/Shanghai' as const;

export interface RefiningMaterial {
  readonly materialId: string;
  readonly quantity: number;
}

export interface RefiningCard {
  readonly cardId: string;
  readonly quality: number;
  readonly quantity: number;
}

export interface CardRefiningRecipe {
  readonly id: string;
  readonly materials: readonly RefiningMaterial[];
  readonly output: RefiningCard;
  readonly probability: number;
  readonly failureRefund: readonly RefiningMaterial[];
}

export interface RefiningSlot {
  readonly slotId: number;
  readonly recipeId: string;
}

export type CardRefiningLedgerOperation = 'REFINE' | 'REFRESH' | 'AUTO_REFRESH';

export interface CardRefiningLedgerEntry {
  readonly sequence: number;
  readonly operation: CardRefiningLedgerOperation;
  readonly requestId: string;
  readonly at: number;
  readonly slotId: number | null;
  readonly recipeId: string | null;
  readonly success: boolean | null;
  readonly probability: number | null;
  readonly roll: number | null;
  readonly debited: readonly RefiningMaterial[];
  readonly returned: readonly RefiningMaterial[];
  readonly credited: readonly RefiningCard[];
  readonly spentRefreshTickets: number;
}

export interface CardRefiningResult {
  readonly operation: CardRefiningLedgerOperation;
  readonly requestId: string;
  readonly applied: boolean;
  readonly idempotent: boolean;
  readonly at: number;
  readonly slotId: number | null;
  readonly recipeId: string | null;
  readonly success: boolean | null;
  readonly probability: number | null;
  readonly roll: number | null;
  readonly debited: readonly RefiningMaterial[];
  readonly returned: readonly RefiningMaterial[];
  readonly credited: readonly RefiningCard[];
  readonly spentRefreshTickets: number;
  readonly refreshedCycles: number;
  readonly refreshCount: number;
  readonly ledgerSequence: number;
}

interface CardRefiningReceipt {
  readonly requestId: string;
  readonly fingerprint: string;
  readonly result: CardRefiningResult;
}

export interface CardRefiningState {
  readonly schemaVersion: typeof CARD_REFINING_SCHEMA_VERSION;
  readonly materials: readonly RefiningMaterial[];
  readonly cards: readonly RefiningCard[];
  readonly initialMaterials: readonly RefiningMaterial[];
  readonly initialCards: readonly RefiningCard[];
  readonly initialRefreshTickets: number;
  readonly initialLastObservedAt: number;
  readonly refreshTickets: number;
  readonly slots: readonly RefiningSlot[];
  readonly refreshCount: number;
  readonly lastRefreshAt: number;
  readonly nextRefreshAt: number;
  readonly lastObservedAt: number;
  readonly ledger: readonly CardRefiningLedgerEntry[];
  readonly receipts: readonly CardRefiningReceipt[];
  readonly chainDigest: string;
}

export interface CardRefiningClock {
  now(): number;
}

export interface CardRefiningOptions {
  readonly recipes?: readonly unknown[] | { readonly recipes: readonly unknown[] };
  readonly state?: unknown;
  readonly initialState?: unknown;
  readonly materials?: readonly unknown[];
  readonly cards?: readonly unknown[];
  readonly refreshTickets?: number;
  readonly slotCount?: number;
  readonly slotCapacity?: number;
  readonly timezone?: string;
  readonly refreshHour?: number;
  readonly refreshMinute?: number;
  readonly clock?: CardRefiningClock;
  readonly rng?: () => number;
  readonly persist?: (serialized: string) => void;
  readonly onSave?: (serialized: string) => void;
}

export type CardRefiningErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_REQUEST'
  | 'INVALID_REQUEST_ID'
  | 'UNKNOWN_RECIPE'
  | 'INVALID_SLOT'
  | 'SLOT_RECIPE_MISMATCH'
  | 'MATERIAL_INPUT_MISMATCH'
  | 'INSUFFICIENT_MATERIALS'
  | 'INVALID_RNG'
  | 'INVALID_TIME'
  | 'TIME_REVERSED'
  | 'REFRESH_TICKETS_EXHAUSTED'
  | 'DUPLICATE_REQUEST'
  | 'REQUEST_CONFLICT'
  | 'QUANTITY_EXCEEDED'
  | 'REENTRANT'
  | 'PERSISTENCE_FAILED';

export class CardRefiningError extends Error {
  readonly code: CardRefiningErrorCode;
  readonly reason: CardRefiningErrorCode;
  readonly cause?: unknown;

  constructor(code: CardRefiningErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'CardRefiningError';
    this.code = code;
    this.reason = code;
    this.cause = cause;
  }
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;
const RESOURCE_ID_PATTERN = /^[A-Z][A-Z0-9_.:-]*$/;
const CARD_ID_PATTERN = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const AUTO_REFRESH_REQUEST_PREFIX = 'AUTO_REFRESH-';
const RESERVED_RECIPE_IDS = new Set([
  '__proto__', 'prototype', 'Object.prototype', ...Object.getOwnPropertyNames(Object.prototype),
]);
const RECIPE_KEYS = new Set(['id', 'materials', 'inputs', 'output', 'probability', 'baseProbability', 'successRate', 'failureRefund']);
const MATERIAL_KEYS = new Set(['materialId', 'quantity']);
const CARD_KEYS = new Set(['cardId', 'quality', 'quantity']);
const SLOT_KEYS = new Set(['slotId', 'recipeId']);
const STATE_KEYS = new Set([
  'schemaVersion', 'materials', 'cards', 'initialMaterials', 'initialCards', 'initialRefreshTickets', 'initialLastObservedAt',
  'refreshTickets', 'slots', 'refreshCount', 'lastRefreshAt', 'nextRefreshAt',
  'lastObservedAt', 'ledger', 'receipts', 'chainDigest',
]);
const LEDGER_KEYS = new Set([
  'sequence', 'operation', 'requestId', 'at', 'slotId', 'recipeId', 'success', 'probability',
  'roll', 'debited', 'returned', 'credited', 'spentRefreshTickets',
]);
const RESULT_KEYS = new Set([
  'operation', 'requestId', 'applied', 'idempotent', 'at', 'slotId', 'recipeId', 'success',
  'probability', 'roll', 'debited', 'returned', 'credited', 'spentRefreshTickets',
  'refreshedCycles', 'refreshCount', 'ledgerSequence',
]);
const RECEIPT_KEYS = new Set(['requestId', 'fingerprint', 'result']);
const REQUEST_KEYS = new Set(['requestId', 'slotId', 'slot', 'slotIndex', 'recipeId', 'materials', 'at', 'now']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(code: CardRefiningErrorCode, message: string, cause?: unknown): never {
  throw new CardRefiningError(code, message, cause);
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, label: string, code: CardRefiningErrorCode): void {
  if (Object.getOwnPropertySymbols(value).length > 0 || Object.keys(value).some((key) => !allowed.has(key))) {
    fail(code, `${label} contains an unknown field`);
  }
}

function assertText(value: unknown, label: string, pattern: RegExp, code: CardRefiningErrorCode): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || !pattern.test(value)) {
    fail(code, `${label} is invalid`);
  }
}

function assertRecipeId(value: unknown, label: string, code: CardRefiningErrorCode): asserts value is string {
  assertText(value, label, ID_PATTERN, code);
  if (RESERVED_RECIPE_IDS.has(value)) fail(code, `${label} is reserved`);
}

function assertUserRequestId(value: string, label: string, code: CardRefiningErrorCode): void {
  if (value.startsWith(AUTO_REFRESH_REQUEST_PREFIX)) fail(code, `${label} is reserved`);
}

function assertSafeInteger(value: unknown, label: string, code: CardRefiningErrorCode, minimum = 0): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    fail(code, `${label} must be a safe integer >= ${minimum}`);
  }
}

function assertPositiveInteger(value: unknown, label: string, code: CardRefiningErrorCode): asserts value is number {
  assertSafeInteger(value, label, code, 1);
}

function assertProbability(value: unknown, label: string, code: CardRefiningErrorCode): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    fail(code, `${label} must be a finite number in [0, 1]`);
  }
}

function assertTimestamp(value: unknown, label: string, code: CardRefiningErrorCode = 'INVALID_TIME'): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || !Number.isFinite(value)) {
    fail(code, `${label} must be a finite safe-integer timestamp`);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) fail(code, `${label} is outside the supported Date range`);
}

function copyMaterial(value: RefiningMaterial): RefiningMaterial {
  return Object.freeze({ materialId: value.materialId, quantity: value.quantity });
}

function copyMaterials(values: readonly RefiningMaterial[]): readonly RefiningMaterial[] {
  return Object.freeze(values.map(copyMaterial));
}

function copyCard(value: RefiningCard): RefiningCard {
  return Object.freeze({ cardId: value.cardId, quality: value.quality, quantity: value.quantity });
}

function copyCards(values: readonly RefiningCard[]): readonly RefiningCard[] {
  return Object.freeze(values.map(copyCard));
}

function materialKey(value: Pick<RefiningMaterial, 'materialId'>): string {
  return value.materialId;
}

function cardKey(value: Pick<RefiningCard, 'cardId' | 'quality'>): string {
  return `${value.cardId}:${value.quality}`;
}

function compareMaterials(left: RefiningMaterial, right: RefiningMaterial): number {
  return left.materialId.localeCompare(right.materialId);
}

function compareCards(left: RefiningCard, right: RefiningCard): number {
  const idOrder = left.cardId.localeCompare(right.cardId);
  return idOrder === 0 ? left.quality - right.quality : idOrder;
}

function normalizeMaterial(value: unknown, label: string, code: CardRefiningErrorCode): RefiningMaterial {
  if (!isRecord(value)) fail(code, `${label} must be an object`);
  assertOnlyKeys(value, MATERIAL_KEYS, label, code);
  if (!hasOwn(value, 'materialId') || !hasOwn(value, 'quantity')) fail(code, `${label} is incomplete`);
  assertText(value.materialId, `${label}.materialId`, RESOURCE_ID_PATTERN, code);
  assertPositiveInteger(value.quantity, `${label}.quantity`, code);
  return { materialId: value.materialId, quantity: value.quantity };
}

function normalizeMaterials(value: unknown, label: string, code: CardRefiningErrorCode, allowEmpty = false): readonly RefiningMaterial[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(code, `${label} must be a ${allowEmpty ? '' : 'non-empty '}array`);
  const values = value.map((entry, index) => normalizeMaterial(entry, `${label}[${index}]`, code));
  const keys = new Set<string>();
  for (const entry of values) {
    if (keys.has(materialKey(entry))) fail(code, `${label} contains duplicate material`);
    keys.add(materialKey(entry));
  }
  return Object.freeze([...values].sort(compareMaterials).map(copyMaterial));
}

function normalizeCard(value: unknown, label: string, code: CardRefiningErrorCode): RefiningCard {
  if (!isRecord(value)) fail(code, `${label} must be an object`);
  assertOnlyKeys(value, CARD_KEYS, label, code);
  if (!hasOwn(value, 'cardId') || !hasOwn(value, 'quality') || !hasOwn(value, 'quantity')) fail(code, `${label} is incomplete`);
  assertText(value.cardId, `${label}.cardId`, CARD_ID_PATTERN, code);
  assertPositiveInteger(value.quality, `${label}.quality`, code);
  if (value.quality > 6) fail(code, `${label}.quality must be between 1 and 6`);
  assertPositiveInteger(value.quantity, `${label}.quantity`, code);
  return { cardId: value.cardId, quality: value.quality, quantity: value.quantity };
}

function normalizeCards(value: unknown, label: string, code: CardRefiningErrorCode, allowEmpty = true): readonly RefiningCard[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) fail(code, `${label} must be an array`);
  const values = value.map((entry, index) => normalizeCard(entry, `${label}[${index}]`, code));
  const keys = new Set<string>();
  for (const entry of values) {
    if (keys.has(cardKey(entry))) fail(code, `${label} contains duplicate card stack`);
    keys.add(cardKey(entry));
  }
  return Object.freeze([...values].sort(compareCards).map(copyCard));
}

function normalizeRecipe(value: unknown, index: number): CardRefiningRecipe {
  const label = `recipes[${index}]`;
  if (!isRecord(value)) fail('INVALID_CONFIG', `${label} must be an object`);
  assertOnlyKeys(value, RECIPE_KEYS, label, 'INVALID_CONFIG');
  if (!hasOwn(value, 'id') || !hasOwn(value, 'output')) fail('INVALID_CONFIG', `${label} is incomplete`);
  assertRecipeId(value.id, `${label}.id`, 'INVALID_CONFIG');

  const hasMaterials = hasOwn(value, 'materials');
  const hasInputs = hasOwn(value, 'inputs');
  if (hasMaterials === hasInputs) fail('INVALID_CONFIG', `${label} must contain exactly one of materials or inputs`);
  const materials = normalizeMaterials(value[hasMaterials ? 'materials' : 'inputs'], `${label}.materials`, 'INVALID_CONFIG');
  const output = normalizeCard(value.output, `${label}.output`, 'INVALID_CONFIG');

  const probabilityKeys = ['probability', 'baseProbability', 'successRate'].filter((key) => hasOwn(value, key));
  if (probabilityKeys.length !== 1) fail('INVALID_CONFIG', `${label} must contain exactly one probability field`);
  const probability = value[probabilityKeys[0]];
  assertProbability(probability, `${label}.${probabilityKeys[0]}`, 'INVALID_CONFIG');

  let failureRefund: readonly RefiningMaterial[] = Object.freeze([]);
  if (hasOwn(value, 'failureRefund')) {
    failureRefund = normalizeMaterials(value.failureRefund, `${label}.failureRefund`, 'INVALID_CONFIG', true);
    const inputById = new Map(materials.map((entry) => [entry.materialId, entry.quantity]));
    for (const entry of failureRefund) {
      const inputQuantity = inputById.get(entry.materialId);
      if (inputQuantity === undefined || entry.quantity > inputQuantity) fail('INVALID_CONFIG', `${label}.failureRefund exceeds its input`);
    }
  }
  return Object.freeze({ id: value.id, materials, output: copyCard(output), probability, failureRefund });
}

function normalizeRecipes(input: readonly unknown[] | { readonly recipes: readonly unknown[] } | undefined): ReadonlyMap<string, CardRefiningRecipe> {
  let rows: unknown;
  if (input === undefined) rows = CARD_REFINING_RECIPES;
  else if (Array.isArray(input)) rows = input;
  else if (isRecord(input) && hasOwn(input, 'recipes')) rows = input.recipes;
  else fail('INVALID_CONFIG', 'refining recipes must be a non-empty array or { recipes: [...] }');
  if (!Array.isArray(rows) || rows.length === 0) fail('INVALID_CONFIG', 'refining recipes must be a non-empty array');
  const recipes = new Map<string, CardRefiningRecipe>();
  rows.forEach((row, index) => {
    const recipe = normalizeRecipe(row, index);
    if (recipes.has(recipe.id)) fail('INVALID_CONFIG', `duplicate refining recipe: ${recipe.id}`);
    recipes.set(recipe.id, recipe);
  });
  return recipes;
}

function parseState(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (error) { fail('INVALID_STATE', 'refining state is not valid JSON', error); }
}

function validateTimezone(timezone: unknown): asserts timezone is string {
  if (typeof timezone !== 'string' || timezone.trim() !== timezone || timezone.length === 0) fail('INVALID_CONFIG', 'timezone is invalid');
  try { new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date(0)); } catch (error) { fail('INVALID_CONFIG', 'timezone is invalid', error); }
}

interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number; }

function localParts(at: number, timezone: string): LocalParts {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(new Date(at));
    const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute'), second: value('second') };
  } catch (error) {
    fail('INVALID_TIME', 'timestamp or timezone cannot be converted', error);
  }
}

function dateAtLocalBoundary(year: number, month: number, day: number, hour: number, minute: number, timezone: string): number | null {
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const guesses = [
    targetAsUtc,
    targetAsUtc - 2 * 60 * 60 * 1000,
    targetAsUtc + 2 * 60 * 60 * 1000,
    targetAsUtc - 6 * 60 * 60 * 1000,
    targetAsUtc + 6 * 60 * 60 * 1000,
    targetAsUtc - 24 * 60 * 60 * 1000,
    targetAsUtc + 24 * 60 * 60 * 1000,
  ];
  const candidates = new Set<number>();
  for (const guess of guesses) {
    const parts = localParts(guess, timezone);
    const actualAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, 0);
    const candidate = guess + targetAsUtc - actualAsUtc;
    const resolved = localParts(candidate, timezone);
    if (resolved.year === year && resolved.month === month && resolved.day === day
      && resolved.hour === hour && resolved.minute === minute && resolved.second === 0) {
      candidates.add(candidate);
    }
  }
  if (candidates.size === 0) return null;
  const boundary = Math.min(...candidates);
  assertTimestamp(boundary, 'refresh boundary');
  return boundary;
}

function nextLocalDate(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function previousLocalDate(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const previous = new Date(Date.UTC(year, month - 1, day - 1));
  return { year: previous.getUTCFullYear(), month: previous.getUTCMonth() + 1, day: previous.getUTCDate() };
}

function refreshBoundaryAfter(at: number, timezone: string, hour: number, minute: number): number {
  const parts = localParts(at, timezone);
  let date = { year: parts.year, month: parts.month, day: parts.day };
  for (let index = 0; index < 370; index += 1) {
    const boundary = dateAtLocalBoundary(date.year, date.month, date.day, hour, minute, timezone);
    if (boundary !== null && boundary > at) return boundary;
    date = nextLocalDate(date.year, date.month, date.day);
  }
  fail('INVALID_TIME', 'no valid refresh boundary was found after the timestamp');
}

function refreshBoundaryBefore(at: number, timezone: string, hour: number, minute: number): number {
  const parts = localParts(at, timezone);
  let date = { year: parts.year, month: parts.month, day: parts.day };
  for (let index = 0; index < 370; index += 1) {
    const boundary = dateAtLocalBoundary(date.year, date.month, date.day, hour, minute, timezone);
    if (boundary !== null && boundary < at) return boundary;
    date = previousLocalDate(date.year, date.month, date.day);
  }
  fail('INVALID_TIME', 'no valid refresh boundary was found before the timestamp');
}

function initialRefreshBoundary(at: number, timezone: string, hour: number, minute: number): { last: number; next: number } {
  const next = refreshBoundaryAfter(at, timezone, hour, minute);
  const last = refreshBoundaryBefore(next, timezone, hour, minute);
  return { last, next };
}

function sameMaterials(left: readonly RefiningMaterial[], right: readonly RefiningMaterial[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry.materialId === right[index].materialId && entry.quantity === right[index].quantity);
}

function sameCards(left: readonly RefiningCard[], right: readonly RefiningCard[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry.cardId === right[index].cardId && entry.quality === right[index].quality && entry.quantity === right[index].quantity);
}

function sameSlots(left: readonly RefiningSlot[], right: readonly RefiningSlot[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry.slotId === right[index].slotId && entry.recipeId === right[index].recipeId);
}

function copySlot(value: RefiningSlot): RefiningSlot {
  return Object.freeze({ slotId: value.slotId, recipeId: value.recipeId });
}

function copySlots(values: readonly RefiningSlot[]): readonly RefiningSlot[] {
  return Object.freeze(values.map(copySlot));
}

function cloneResult(value: CardRefiningResult): CardRefiningResult {
  return Object.freeze({
    ...value,
    debited: copyMaterials(value.debited), returned: copyMaterials(value.returned), credited: copyCards(value.credited),
  });
}

function cloneLedger(value: CardRefiningLedgerEntry): CardRefiningLedgerEntry {
  return Object.freeze({
    ...value,
    debited: copyMaterials(value.debited), returned: copyMaterials(value.returned), credited: copyCards(value.credited),
  });
}

function freezeState(value: CardRefiningState): CardRefiningState {
  return Object.freeze({
    schemaVersion: CARD_REFINING_SCHEMA_VERSION,
    materials: copyMaterials(value.materials), cards: copyCards(value.cards),
    initialMaterials: copyMaterials(value.initialMaterials), initialCards: copyCards(value.initialCards),
    initialRefreshTickets: value.initialRefreshTickets, initialLastObservedAt: value.initialLastObservedAt,
    refreshTickets: value.refreshTickets, slots: copySlots(value.slots), refreshCount: value.refreshCount,
    lastRefreshAt: value.lastRefreshAt, nextRefreshAt: value.nextRefreshAt, lastObservedAt: value.lastObservedAt,
    ledger: Object.freeze(value.ledger.map(cloneLedger)),
    receipts: Object.freeze(value.receipts.map((entry) => Object.freeze({ requestId: entry.requestId, fingerprint: entry.fingerprint, result: cloneResult(entry.result) }))),
    chainDigest: value.chainDigest,
  });
}

function toMaterialMap(values: readonly RefiningMaterial[]): Map<string, number> {
  return new Map(values.map((entry) => [entry.materialId, entry.quantity]));
}

function toCardMap(values: readonly RefiningCard[]): Map<string, RefiningCard> {
  return new Map(values.map((entry) => [cardKey(entry), entry]));
}

function materialList(values: Map<string, number>): readonly RefiningMaterial[] {
  return Object.freeze([...values.entries()].filter(([, quantity]) => quantity > 0).map(([materialId, quantity]) => copyMaterial({ materialId, quantity })).sort(compareMaterials));
}

function cardList(values: Map<string, RefiningCard>): readonly RefiningCard[] {
  return Object.freeze([...values.values()].filter((entry) => entry.quantity > 0).map(copyCard).sort(compareCards));
}

function addMaterial(values: Map<string, number>, entry: RefiningMaterial, quantity = entry.quantity, code: CardRefiningErrorCode = 'QUANTITY_EXCEEDED'): void {
  const current = values.get(entry.materialId) ?? 0;
  if (quantity < 0 || !Number.isSafeInteger(quantity) || current > Number.MAX_SAFE_INTEGER - quantity) fail(code, `material quantity exceeds the safe integer limit: ${entry.materialId}`);
  values.set(entry.materialId, current + quantity);
}

function subtractMaterial(values: Map<string, number>, entry: RefiningMaterial): void {
  const current = values.get(entry.materialId) ?? 0;
  if (current < entry.quantity) fail('INSUFFICIENT_MATERIALS', `insufficient material: ${entry.materialId}`);
  const next = current - entry.quantity;
  if (next === 0) values.delete(entry.materialId); else values.set(entry.materialId, next);
}

function addCard(values: Map<string, RefiningCard>, entry: RefiningCard): void {
  const key = cardKey(entry);
  const current = values.get(key)?.quantity ?? 0;
  if (current > Number.MAX_SAFE_INTEGER - entry.quantity) fail('QUANTITY_EXCEEDED', `card quantity exceeds the safe integer limit: ${key}`);
  values.set(key, { ...entry, quantity: current + entry.quantity });
}

function selectSlots(recipes: readonly string[], slotCount: number, refreshCount: number): readonly RefiningSlot[] {
  const recipeCount = BigInt(recipes.length);
  const refreshOffset = BigInt(refreshCount) * BigInt(slotCount);
  return Object.freeze(Array.from({ length: slotCount }, (_, slotId) => copySlot({
    slotId,
    recipeId: recipes[Number((refreshOffset + BigInt(slotId)) % recipeCount)],
  })));
}

function requestFingerprint(value: { operation: CardRefiningLedgerOperation; slotId: number | null; recipeId: string | null; materials: readonly RefiningMaterial[] }): string {
  return JSON.stringify({ operation: value.operation, slotId: value.slotId, recipeId: value.recipeId, materials: value.materials });
}

function autoRefreshRequestId(at: number): string {
  return `${AUTO_REFRESH_REQUEST_PREFIX}${at}`;
}

function assertEventRequestId(operation: CardRefiningLedgerOperation, requestId: string, at: number, label: string): void {
  if (operation === 'AUTO_REFRESH') {
    if (requestId !== autoRefreshRequestId(at)) fail('INVALID_STATE', `${label}.requestId is not derived from its scheduled event`);
  } else {
    assertUserRequestId(requestId, `${label}.requestId`, 'INVALID_STATE');
  }
}

// The serialized state is untrusted. This key makes the chain digest a tamper
// evidence boundary for ordinary save-file edits; state reachability remains
// checked independently below.
const REFINING_CHAIN_KEY = 'card-refining-chain-v2:7d8b0c2e-4a3f-4f7e-bd4c-91a3d5e8c6b2';
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function stableSerialize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  fail('INVALID_STATE', 'refining chain contains an unsupported value');
}

function utf8Bytes(value: string): number[] {
  const bytes: number[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes.push(code);
    else if (code < 0x800) bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        const codePoint = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
        bytes.push(0xf0 | (codePoint >> 18), 0x80 | ((codePoint >> 12) & 0x3f), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f));
        index += 1;
      } else bytes.push(0xef, 0xbf, 0xbd);
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes.push(0xef, 0xbf, 0xbd);
    else bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
  }
  return bytes;
}

function sha256Hex(value: string): string {
  const bytes = utf8Bytes(value);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length + 8) % 64 !== 0) bytes.push(0);
  for (let shift = 56; shift >= 0; shift -= 8) bytes.push((bitLength / 2 ** shift) & 0xff);
  let h0 = 0x6a09e667; let h1 = 0xbb67ae85; let h2 = 0x3c6ef372; let h3 = 0xa54ff53a;
  let h4 = 0x510e527f; let h5 = 0x9b05688c; let h6 = 0x1f83d9ab; let h7 = 0x5be0cd19;
  const rightRotate = (word: number, bits: number) => (word >>> bits) | (word << (32 - bits));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Array<number>(64).fill(0);
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = (bytes[position] << 24) | (bytes[position + 1] << 16) | (bytes[position + 2] << 8) | bytes[position + 3];
    }
    for (let index = 16; index < 64; index += 1) {
      const s0 = rightRotate(words[index - 15], 7) ^ rightRotate(words[index - 15], 18) ^ (words[index - 15] >>> 3);
      const s1 = rightRotate(words[index - 2], 17) ^ rightRotate(words[index - 2], 19) ^ (words[index - 2] >>> 10);
      words[index] = (words[index - 16] + s0 + words[index - 7] + s1) | 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3; let e = h4; let f = h5; let g = h6; let h = h7;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25);
      const choice = (e & f) ^ (~e & g);
      const temp1 = (h + sum1 + choice + SHA256_K[index] + words[index]) | 0;
      const sum0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sum0 + majority) | 0;
      h = g; g = f; f = e; e = (d + temp1) | 0; d = c; c = b; b = a; a = (temp1 + temp2) | 0;
    }
    h0 = (h0 + a) | 0; h1 = (h1 + b) | 0; h2 = (h2 + c) | 0; h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0; h5 = (h5 + f) | 0; h6 = (h6 + g) | 0; h7 = (h7 + h) | 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('');
}

function keyedDigest(value: unknown): string {
  return sha256Hex(`${REFINING_CHAIN_KEY}\u0000${stableSerialize(value)}`);
}

function calculateChainDigest(
  recipeMap: ReadonlyMap<string, CardRefiningRecipe>,
  slotCount: number,
  initialMaterials: readonly RefiningMaterial[],
  initialCards: readonly RefiningCard[],
  initialRefreshTickets: number,
  initialLastObservedAt: number,
  ledger: readonly CardRefiningLedgerEntry[],
  receipts: readonly CardRefiningReceipt[],
): string {
  let digest = keyedDigest({
    type: 'GENESIS', schemaVersion: CARD_REFINING_SCHEMA_VERSION,
    initialMaterials, initialCards, initialRefreshTickets, initialLastObservedAt,
    initialSlots: selectSlots([...recipeMap.keys()], slotCount, 0),
  });
  for (let index = 0; index < ledger.length; index += 1) {
    digest = keyedDigest({ type: 'EVENT', previous: digest, sequence: index + 1, ledger: ledger[index], receipt: receipts[index] });
  }
  return digest;
}

function normalizeRequest(value: unknown): { requestId: string; slotId: number | null; recipeId: string | null; materials?: readonly RefiningMaterial[]; at?: number } {
  if (!isRecord(value)) fail('INVALID_REQUEST', 'refining request must be an object');
  assertOnlyKeys(value, REQUEST_KEYS, 'refining request', 'INVALID_REQUEST');
  if (!hasOwn(value, 'requestId')) fail('INVALID_REQUEST', 'requestId is required');
  assertText(value.requestId, 'requestId', ID_PATTERN, 'INVALID_REQUEST_ID');
  assertUserRequestId(value.requestId, 'requestId', 'INVALID_REQUEST_ID');
  const slotKeys = ['slotId', 'slot', 'slotIndex'].filter((key) => hasOwn(value, key));
  if (slotKeys.length > 1) fail('INVALID_REQUEST', 'only one slot field may be supplied');
  const slotValue = slotKeys.length === 0 ? null : value[slotKeys[0]];
  if (slotValue !== null) assertSafeInteger(slotValue, 'slotId', 'INVALID_REQUEST', 0);
  const recipeId = value.recipeId === undefined ? null : value.recipeId;
  if (recipeId !== null) assertRecipeId(recipeId, 'recipeId', 'INVALID_REQUEST');
  const materials = value.materials === undefined ? undefined : normalizeMaterials(value.materials, 'request.materials', 'INVALID_REQUEST');
  if (hasOwn(value, 'at') && hasOwn(value, 'now')) fail('INVALID_REQUEST', 'only one time field may be supplied');
  const atValue = value.at === undefined ? value.now : value.at;
  if (atValue !== undefined) assertTimestamp(atValue, 'request.at');
  return { requestId: value.requestId, slotId: slotValue as number | null, recipeId: recipeId as string | null, ...(materials === undefined ? {} : { materials }), ...(atValue === undefined ? {} : { at: atValue }) };
}

function normalizeState(
  value: unknown,
  recipeMap: ReadonlyMap<string, CardRefiningRecipe>,
  slotCount: number,
  timezone: string,
  refreshHour: number,
  refreshMinute: number,
): CardRefiningState {
  const parsed = parseState(value);
  if (!isRecord(parsed)) fail('INVALID_STATE', 'refining state must be an object');
  assertOnlyKeys(parsed, STATE_KEYS, 'refining state', 'INVALID_STATE');
  if (parsed.schemaVersion !== CARD_REFINING_SCHEMA_VERSION) fail('INVALID_STATE', 'unsupported refining state schema');
  for (const key of ['materials', 'cards', 'initialMaterials', 'initialCards', 'initialRefreshTickets', 'initialLastObservedAt', 'refreshTickets', 'slots', 'refreshCount', 'lastRefreshAt', 'nextRefreshAt', 'ledger', 'receipts', 'chainDigest']) {
    if (!hasOwn(parsed, key)) fail('INVALID_STATE', `refining state.${key} is required`);
  }
  const materials = normalizeMaterials(parsed.materials, 'refining state.materials', 'INVALID_STATE', true);
  const cards = normalizeCards(parsed.cards, 'refining state.cards', 'INVALID_STATE');
  const initialMaterials = normalizeMaterials(parsed.initialMaterials, 'refining state.initialMaterials', 'INVALID_STATE', true);
  const initialCards = normalizeCards(parsed.initialCards, 'refining state.initialCards', 'INVALID_STATE');
  if (!hasOwn(parsed, 'initialRefreshTickets') || !hasOwn(parsed, 'initialLastObservedAt')) {
    fail('INVALID_STATE', 'refining state initial refresh anchors are required');
  }
  assertSafeInteger(parsed.initialRefreshTickets, 'refining state.initialRefreshTickets', 'INVALID_STATE');
  assertTimestamp(parsed.initialLastObservedAt, 'refining state.initialLastObservedAt', 'INVALID_STATE');
  assertSafeInteger(parsed.refreshTickets, 'refining state.refreshTickets', 'INVALID_STATE');
  assertSafeInteger(parsed.refreshCount, 'refining state.refreshCount', 'INVALID_STATE');
  assertTimestamp(parsed.lastRefreshAt, 'refining state.lastRefreshAt', 'INVALID_STATE');
  assertTimestamp(parsed.nextRefreshAt, 'refining state.nextRefreshAt', 'INVALID_STATE');
  if (parsed.nextRefreshAt <= parsed.lastRefreshAt) fail('INVALID_STATE', 'refining state refresh boundaries are invalid');
  const lastObservedAt = parsed.lastObservedAt === undefined ? parsed.lastRefreshAt : parsed.lastObservedAt;
  assertTimestamp(lastObservedAt, 'refining state.lastObservedAt', 'INVALID_STATE');
  if (lastObservedAt < parsed.lastRefreshAt || lastObservedAt >= parsed.nextRefreshAt) fail('INVALID_STATE', 'refining state.lastObservedAt is outside the current refresh window');
  if (typeof parsed.chainDigest !== 'string' || !/^[0-9a-f]{64}$/.test(parsed.chainDigest)) fail('INVALID_STATE', 'refining state.chainDigest is invalid');

  if (!Array.isArray(parsed.slots) || parsed.slots.length !== slotCount) fail('INVALID_STATE', 'refining state.slots has the wrong count');
  const slots = parsed.slots.map((entry, index) => {
    if (!isRecord(entry)) fail('INVALID_STATE', `refining state.slots[${index}] must be an object`);
    assertOnlyKeys(entry, SLOT_KEYS, `refining state.slots[${index}]`, 'INVALID_STATE');
    if (!hasOwn(entry, 'slotId') || !hasOwn(entry, 'recipeId')) fail('INVALID_STATE', 'refining slot is incomplete');
    assertSafeInteger(entry.slotId, `refining state.slots[${index}].slotId`, 'INVALID_STATE', 0);
    assertRecipeId(entry.recipeId, `refining state.slots[${index}].recipeId`, 'INVALID_STATE');
    if (entry.slotId !== index || !recipeMap.has(entry.recipeId)) fail('INVALID_STATE', 'refining slots are not contiguous or reference an unknown recipe');
    return { slotId: entry.slotId, recipeId: entry.recipeId };
  });
  const expectedSlots = selectSlots([...recipeMap.keys()], slotCount, parsed.refreshCount);
  if (!sameSlots(slots, expectedSlots)) fail('INVALID_STATE', 'refining state.slots do not match refreshCount');
  try {
    const expectedLastRefreshAt = refreshBoundaryBefore(parsed.nextRefreshAt, timezone, refreshHour, refreshMinute);
    const expectedNextRefreshAt = refreshBoundaryAfter(parsed.lastRefreshAt, timezone, refreshHour, refreshMinute);
    if (expectedLastRefreshAt !== parsed.lastRefreshAt || expectedNextRefreshAt !== parsed.nextRefreshAt) {
      fail('INVALID_STATE', 'refining state refresh boundaries do not match the configured schedule');
    }
  } catch (error) {
    if (error instanceof CardRefiningError && error.code === 'INVALID_STATE') throw error;
    fail('INVALID_STATE', 'refining state refresh boundaries are not valid for the configured schedule', error);
  }

  if (!Array.isArray(parsed.ledger)) fail('INVALID_STATE', 'refining state.ledger must be an array');
  const ledger = parsed.ledger.map((entry, index) => normalizeLedger(entry, index, recipeMap));
  ledger.forEach((entry, index) => { if (entry.sequence !== index + 1) fail('INVALID_STATE', 'refining ledger sequence is not contiguous'); });
  if (!Array.isArray(parsed.receipts)) fail('INVALID_STATE', 'refining state.receipts must be an array');
  const receipts = parsed.receipts.map((entry, index) => normalizeReceipt(entry, index, recipeMap));
  if (new Set(ledger.map((entry) => entry.requestId)).size !== ledger.length) fail('INVALID_STATE', 'refining ledger request IDs are duplicated');
  if (new Set(receipts.map((entry) => entry.requestId)).size !== receipts.length) fail('INVALID_STATE', 'refining receipts are duplicated');
  if (ledger.length !== receipts.length) fail('INVALID_STATE', 'refining ledger and receipts must have the same length');
  for (let index = 0; index < ledger.length; index += 1) {
    const entry = ledger[index];
    const receipt = receipts[index];
    if (!receipt || receipt.requestId !== entry.requestId || receipt.result.ledgerSequence !== entry.sequence || receipt.result.operation !== entry.operation
      || receipt.result.at !== entry.at || receipt.result.slotId !== entry.slotId || receipt.result.recipeId !== entry.recipeId
      || receipt.result.success !== entry.success || receipt.result.probability !== entry.probability || receipt.result.roll !== entry.roll
      || !sameMaterials(receipt.result.debited, entry.debited) || !sameMaterials(receipt.result.returned, entry.returned)
      || !sameCards(receipt.result.credited, entry.credited) || receipt.result.spentRefreshTickets !== entry.spentRefreshTickets) {
      fail('INVALID_STATE', `refining receipt and ledger do not match: ${entry.requestId}`);
    }
  }
  const expectedChainDigest = calculateChainDigest(
    recipeMap, slotCount, initialMaterials, initialCards, parsed.initialRefreshTickets, parsed.initialLastObservedAt, ledger, receipts,
  );
  if (parsed.chainDigest !== expectedChainDigest) fail('INVALID_STATE', 'refining event chain digest is invalid');

  const initialBoundaries = initialRefreshBoundary(parsed.initialLastObservedAt, timezone, refreshHour, refreshMinute);
  let replayLastRefreshAt = initialBoundaries.last;
  let replayNextRefreshAt = initialBoundaries.next;
  let replayRefreshCount = 0;
  let replayRefreshTickets = parsed.initialRefreshTickets;
  let replaySlots = selectSlots([...recipeMap.keys()], slotCount, 0);
  let replayObservedAt = parsed.initialLastObservedAt;
  const replayMaterials = toMaterialMap(initialMaterials);
  const replayCards = toCardMap(initialCards);
  for (let index = 0; index < ledger.length; index += 1) {
    const entry = ledger[index];
    const receipt = receipts[index];
    if (entry.at < replayObservedAt) fail('INVALID_STATE', 'refining ledger timestamps are not monotonic or precede the initial state');
    let expectedRefreshedCycles = 0;
    if (entry.operation === 'AUTO_REFRESH') {
      if (entry.at !== replayNextRefreshAt || entry.requestId !== autoRefreshRequestId(entry.at)) {
        fail('INVALID_STATE', `refining ledger[${index}] is not a valid scheduled refresh event`);
      }
      replayLastRefreshAt = replayNextRefreshAt;
      replayNextRefreshAt = refreshBoundaryAfter(replayNextRefreshAt, timezone, refreshHour, refreshMinute);
      replayRefreshCount += 1;
      replaySlots = selectSlots([...recipeMap.keys()], slotCount, replayRefreshCount);
      expectedRefreshedCycles = 1;
    } else {
      if (entry.at >= replayNextRefreshAt) fail('INVALID_STATE', `refining ledger[${index}] is missing scheduled refresh events`);
      if (entry.operation === 'REFRESH') {
        if (replayRefreshTickets < 1) fail('INVALID_STATE', 'refining ledger spends more refresh tickets than the initial state provides');
        replayRefreshTickets -= 1;
        replayRefreshCount += 1;
        replaySlots = selectSlots([...recipeMap.keys()], slotCount, replayRefreshCount);
        expectedRefreshedCycles = 1;
      } else {
        if (entry.slotId === null || entry.slotId >= slotCount || replaySlots[entry.slotId]?.recipeId !== entry.recipeId) {
          fail('INVALID_STATE', `refining ledger[${index}] is not reachable from the slot state at its sequence`);
        }
        for (const material of entry.debited) {
          const currentQuantity = replayMaterials.get(material.materialId) ?? 0;
          if (currentQuantity < material.quantity) fail('INVALID_STATE', `refining ledger[${index}] overspends ${material.materialId}`);
          const nextQuantity = currentQuantity - material.quantity;
          if (nextQuantity === 0) replayMaterials.delete(material.materialId);
          else replayMaterials.set(material.materialId, nextQuantity);
        }
        for (const material of entry.returned) {
          const currentQuantity = replayMaterials.get(material.materialId) ?? 0;
          if (currentQuantity > Number.MAX_SAFE_INTEGER - material.quantity) fail('INVALID_STATE', `refining ledger[${index}] overflows ${material.materialId}`);
          replayMaterials.set(material.materialId, currentQuantity + material.quantity);
        }
        for (const card of entry.credited) {
          const key = cardKey(card);
          const currentCard = replayCards.get(key);
          const currentQuantity = currentCard?.quantity ?? 0;
          if (currentQuantity > Number.MAX_SAFE_INTEGER - card.quantity) fail('INVALID_STATE', `refining ledger[${index}] overflows ${key}`);
          replayCards.set(key, { ...card, quantity: currentQuantity + card.quantity });
        }
      }
    }
    if (receipt.result.refreshCount !== replayRefreshCount || receipt.result.refreshedCycles !== expectedRefreshedCycles) {
      fail('INVALID_STATE', `refining receipt[${index}].result refresh fields are not reachable from its event`);
    }
    replayObservedAt = entry.at;
  }
  if (lastObservedAt < replayObservedAt) fail('INVALID_STATE', 'refining state.lastObservedAt precedes the event history');
  if (lastObservedAt >= replayNextRefreshAt) fail('INVALID_STATE', 'refining state is missing scheduled refresh events');
  if (replayRefreshCount !== parsed.refreshCount || replayRefreshTickets !== parsed.refreshTickets
    || replayLastRefreshAt !== parsed.lastRefreshAt || replayNextRefreshAt !== parsed.nextRefreshAt
    || !sameSlots(replaySlots, slots)) {
    fail('INVALID_STATE', 'refining state is not reachable from its initial state and event history');
  }
  if (!sameMaterials(materialList(replayMaterials), materials) || !sameCards(cardList(replayCards), cards)) {
    fail('INVALID_STATE', 'refining inventory is not reachable from its initial state and event history');
  }
  return freezeState({
    schemaVersion: CARD_REFINING_SCHEMA_VERSION, materials, cards, initialMaterials, initialCards, refreshTickets: parsed.refreshTickets,
    initialRefreshTickets: parsed.initialRefreshTickets, initialLastObservedAt: parsed.initialLastObservedAt,
    slots, refreshCount: parsed.refreshCount, lastRefreshAt: parsed.lastRefreshAt,
    nextRefreshAt: parsed.nextRefreshAt, lastObservedAt, ledger, receipts, chainDigest: parsed.chainDigest,
  });
}

function normalizeLedger(value: unknown, index: number, recipeMap: ReadonlyMap<string, CardRefiningRecipe>): CardRefiningLedgerEntry {
  const label = `refining state.ledger[${index}]`;
  if (!isRecord(value)) fail('INVALID_STATE', `${label} must be an object`);
  assertOnlyKeys(value, LEDGER_KEYS, label, 'INVALID_STATE');
  for (const key of ['sequence', 'operation', 'requestId', 'at', 'slotId', 'recipeId', 'success', 'probability', 'roll', 'debited', 'returned', 'credited', 'spentRefreshTickets']) {
    if (!hasOwn(value, key)) fail('INVALID_STATE', `${label}.${key} is required`);
  }
  assertPositiveInteger(value.sequence, `${label}.sequence`, 'INVALID_STATE');
  if (value.operation !== 'REFINE' && value.operation !== 'REFRESH' && value.operation !== 'AUTO_REFRESH') fail('INVALID_STATE', `${label}.operation is invalid`);
  assertText(value.requestId, `${label}.requestId`, ID_PATTERN, 'INVALID_STATE');
  assertTimestamp(value.at, `${label}.at`, 'INVALID_STATE');
  assertEventRequestId(value.operation, value.requestId, value.at, label);
  if (value.operation === 'REFINE') {
    assertSafeInteger(value.slotId, `${label}.slotId`, 'INVALID_STATE', 0);
    assertRecipeId(value.recipeId, `${label}.recipeId`, 'INVALID_STATE');
    if (!recipeMap.has(value.recipeId)) fail('INVALID_STATE', `${label}.recipeId is unknown`);
    if (typeof value.success !== 'boolean') fail('INVALID_STATE', `${label}.success is invalid`);
    assertProbability(value.probability, `${label}.probability`, 'INVALID_STATE');
    if (value.roll !== null && (typeof value.roll !== 'number' || !Number.isFinite(value.roll) || value.roll < 0 || value.roll >= 1)) fail('INVALID_STATE', `${label}.roll is invalid`);
  } else if (value.operation === 'REFRESH') {
    if (value.slotId !== null || value.recipeId !== null || value.success !== null || value.probability !== null || value.roll !== null) fail('INVALID_STATE', `${label} refresh fields are invalid`);
  } else {
    if (value.slotId !== null || value.recipeId !== null || value.success !== null || value.probability !== null || value.roll !== null) {
      fail('INVALID_STATE', `${label} scheduled refresh fields are invalid`);
    }
  }
  const debited = normalizeMaterials(value.debited, `${label}.debited`, 'INVALID_STATE', true);
  const returned = normalizeMaterials(value.returned, `${label}.returned`, 'INVALID_STATE', true);
  const credited = normalizeCards(value.credited, `${label}.credited`, 'INVALID_STATE');
  assertSafeInteger(value.spentRefreshTickets, `${label}.spentRefreshTickets`, 'INVALID_STATE');
  if (value.operation === 'REFRESH') {
    if (value.spentRefreshTickets !== 1 || debited.length !== 0 || returned.length !== 0 || credited.length !== 0) {
      fail('INVALID_STATE', `${label} refresh accounting is invalid`);
    }
  } else if (value.operation === 'AUTO_REFRESH') {
    if (value.spentRefreshTickets !== 0 || debited.length !== 0 || returned.length !== 0 || credited.length !== 0) {
      fail('INVALID_STATE', `${label} scheduled refresh accounting is invalid`);
    }
  } else {
    const recipe = recipeMap.get(value.recipeId as string)!;
    const expectedReturned = value.success ? [] : recipe.failureRefund;
    const expectedCredited = value.success ? [recipe.output] : [];
    if (value.probability !== recipe.probability || value.roll === null || (value.roll < value.probability) !== value.success
      || !sameMaterials(debited, recipe.materials) || !sameMaterials(returned, expectedReturned)
      || !sameCards(credited, expectedCredited) || value.spentRefreshTickets !== 0) {
      fail('INVALID_STATE', `${label} refine accounting is inconsistent with its recipe`);
    }
  }
  return cloneLedger({
    sequence: value.sequence, operation: value.operation, requestId: value.requestId, at: value.at,
    slotId: value.slotId, recipeId: value.recipeId, success: value.success, probability: value.probability,
    roll: value.roll, debited, returned, credited, spentRefreshTickets: value.spentRefreshTickets,
  });
}

function normalizeResult(value: unknown, label: string, recipeMap: ReadonlyMap<string, CardRefiningRecipe>): CardRefiningResult {
  if (!isRecord(value)) fail('INVALID_STATE', `${label} must be an object`);
  assertOnlyKeys(value, RESULT_KEYS, label, 'INVALID_STATE');
  for (const key of ['operation', 'requestId', 'applied', 'idempotent', 'at', 'slotId', 'recipeId', 'success', 'probability', 'roll', 'debited', 'returned', 'credited', 'spentRefreshTickets', 'refreshedCycles', 'refreshCount', 'ledgerSequence']) {
    if (!hasOwn(value, key)) fail('INVALID_STATE', `${label}.${key} is required`);
  }
  if (value.operation !== 'REFINE' && value.operation !== 'REFRESH' && value.operation !== 'AUTO_REFRESH') fail('INVALID_STATE', `${label}.operation is invalid`);
  assertText(value.requestId, `${label}.requestId`, ID_PATTERN, 'INVALID_STATE');
  if (value.applied !== true || value.idempotent !== false) fail('INVALID_STATE', `${label} must be an applied first result`);
  assertTimestamp(value.at, `${label}.at`, 'INVALID_STATE');
  assertEventRequestId(value.operation, value.requestId, value.at, label);
  if (value.operation === 'REFINE') {
    assertSafeInteger(value.slotId, `${label}.slotId`, 'INVALID_STATE', 0);
    assertRecipeId(value.recipeId, `${label}.recipeId`, 'INVALID_STATE');
    if (!recipeMap.has(value.recipeId) || typeof value.success !== 'boolean') fail('INVALID_STATE', `${label} refine fields are invalid`);
    assertProbability(value.probability, `${label}.probability`, 'INVALID_STATE');
    if (value.roll !== null && (typeof value.roll !== 'number' || !Number.isFinite(value.roll) || value.roll < 0 || value.roll >= 1)) fail('INVALID_STATE', `${label}.roll is invalid`);
  } else if (value.operation === 'REFRESH') {
    if (value.slotId !== null || value.recipeId !== null || value.success !== null || value.probability !== null || value.roll !== null) {
      fail('INVALID_STATE', `${label} refresh fields are invalid`);
    }
  } else if (value.slotId !== null || value.recipeId !== null || value.success !== null || value.probability !== null || value.roll !== null) {
    fail('INVALID_STATE', `${label} refresh fields are invalid`);
  }
  assertSafeInteger(value.refreshedCycles, `${label}.refreshedCycles`, 'INVALID_STATE');
  assertSafeInteger(value.refreshCount, `${label}.refreshCount`, 'INVALID_STATE');
  assertPositiveInteger(value.ledgerSequence, `${label}.ledgerSequence`, 'INVALID_STATE');
  assertSafeInteger(value.spentRefreshTickets, `${label}.spentRefreshTickets`, 'INVALID_STATE');
  const debited = normalizeMaterials(value.debited, `${label}.debited`, 'INVALID_STATE', true);
  const returned = normalizeMaterials(value.returned, `${label}.returned`, 'INVALID_STATE', true);
  const credited = normalizeCards(value.credited, `${label}.credited`, 'INVALID_STATE');
  if (value.operation === 'REFRESH') {
    if (value.spentRefreshTickets !== 1 || debited.length !== 0 || returned.length !== 0 || credited.length !== 0) fail('INVALID_STATE', `${label} refresh accounting is invalid`);
  } else if (value.operation === 'AUTO_REFRESH') {
    if (value.spentRefreshTickets !== 0 || debited.length !== 0 || returned.length !== 0 || credited.length !== 0) fail('INVALID_STATE', `${label} scheduled refresh accounting is invalid`);
  } else {
    const recipe = recipeMap.get(value.recipeId as string)!;
    const expectedReturned = value.success ? [] : recipe.failureRefund;
    const expectedCredited = value.success ? [recipe.output] : [];
    if (value.probability !== recipe.probability || value.roll === null || (value.roll < value.probability) !== value.success
      || !sameMaterials(debited, recipe.materials) || !sameMaterials(returned, expectedReturned)
      || !sameCards(credited, expectedCredited) || value.spentRefreshTickets !== 0) {
      fail('INVALID_STATE', `${label} refine accounting is inconsistent with its recipe`);
    }
  }
  return cloneResult({
    operation: value.operation, requestId: value.requestId, applied: true, idempotent: false, at: value.at,
    slotId: value.slotId, recipeId: value.recipeId, success: value.success, probability: value.probability,
    roll: value.roll, debited, returned, credited,
    spentRefreshTickets: value.spentRefreshTickets, refreshedCycles: value.refreshedCycles,
    refreshCount: value.refreshCount, ledgerSequence: value.ledgerSequence,
  });
}

function normalizeReceipt(value: unknown, index: number, recipeMap: ReadonlyMap<string, CardRefiningRecipe>): CardRefiningReceipt {
  const label = `refining state.receipts[${index}]`;
  if (!isRecord(value)) fail('INVALID_STATE', `${label} must be an object`);
  assertOnlyKeys(value, RECEIPT_KEYS, label, 'INVALID_STATE');
  if (!hasOwn(value, 'requestId') || !hasOwn(value, 'fingerprint') || !hasOwn(value, 'result')) fail('INVALID_STATE', `${label} is incomplete`);
  assertText(value.requestId, `${label}.requestId`, ID_PATTERN, 'INVALID_STATE');
  if (typeof value.fingerprint !== 'string' || value.fingerprint.length === 0) fail('INVALID_STATE', `${label}.fingerprint is invalid`);
  const result = normalizeResult(value.result, `${label}.result`, recipeMap);
  if (result.requestId !== value.requestId) fail('INVALID_STATE', `${label}.requestId does not match result`);
  const withMaterialsFingerprint = requestFingerprint({ operation: result.operation, slotId: result.slotId, recipeId: result.recipeId, materials: result.debited });
  const withoutMaterialsFingerprint = requestFingerprint({ operation: result.operation, slotId: result.slotId, recipeId: result.recipeId, materials: [] });
  if (value.fingerprint !== withMaterialsFingerprint && value.fingerprint !== withoutMaterialsFingerprint) fail('INVALID_STATE', `${label}.fingerprint is inconsistent`);
  return Object.freeze({ requestId: value.requestId, fingerprint: value.fingerprint, result });
}

function makeProductionRecipes(): readonly CardRefiningRecipe[] {
  const cardIds = Array.from(new Set(CARD_QUALITY_CATALOG_DATA.entries.map((entry) => entry.cardId)));
  return Object.freeze(cardIds.map((cardId, index) => normalizeRecipe({
    id: `${cardId}-REFINE`,
    materials: [{ materialId: 'CARD_DUST', quantity: 10 }],
    output: { cardId, quality: 1, quantity: 1 },
    probability: 1,
    failureRefund: [],
  }, index)));
}

export const CARD_REFINING_RECIPES = makeProductionRecipes();
export const REFINING_RECIPES = CARD_REFINING_RECIPES;

function defaultState(recipeMap: ReadonlyMap<string, CardRefiningRecipe>, slotCount: number, now: number, timezone: string, refreshHour: number, refreshMinute: number, refreshTickets: number, materials: readonly RefiningMaterial[], cards: readonly RefiningCard[]): CardRefiningState {
  const boundaries = initialRefreshBoundary(now, timezone, refreshHour, refreshMinute);
  const initial = {
    schemaVersion: CARD_REFINING_SCHEMA_VERSION, materials, cards, initialMaterials: materials, initialCards: cards, refreshTickets,
    initialRefreshTickets: refreshTickets, initialLastObservedAt: now,
    slots: selectSlots([...recipeMap.keys()], slotCount, 0), refreshCount: 0,
    lastRefreshAt: boundaries.last, nextRefreshAt: boundaries.next, lastObservedAt: now,
    ledger: [], receipts: [],
  };
  return freezeState({ ...initial, chainDigest: calculateChainDigest(
    recipeMap, slotCount, materials, cards, refreshTickets, now, initial.ledger, initial.receipts,
  ) });
}

function cloneRecipe(value: CardRefiningRecipe): CardRefiningRecipe {
  return Object.freeze({ ...value, materials: copyMaterials(value.materials), output: copyCard(value.output), failureRefund: copyMaterials(value.failureRefund) });
}

interface PreparedState { state: CardRefiningState; refreshedCycles: number; }

export class CardRefiningService {
  private readonly recipes: ReadonlyMap<string, CardRefiningRecipe>;
  private readonly slotCount: number;
  private readonly timezone: string;
  private readonly refreshHour: number;
  private readonly refreshMinute: number;
  private readonly clock: CardRefiningClock;
  private readonly rng: () => number;
  private readonly persist?: (serialized: string) => void;
  private current: CardRefiningState;
  private transactionActive = false;
  private committing = false;

  constructor(options: CardRefiningOptions = {}) {
    if (!isRecord(options)) fail('INVALID_ARGUMENT', 'refining options must be an object');
    this.recipes = normalizeRecipes(options.recipes);
    const slotCount = options.slotCount ?? options.slotCapacity ?? DEFAULT_REFINING_SLOT_COUNT;
    assertPositiveInteger(slotCount, 'slotCount', 'INVALID_CONFIG');
    if (slotCount > this.recipes.size) fail('INVALID_CONFIG', 'slotCount cannot exceed recipe count');
    this.slotCount = slotCount;
    const timezone = options.timezone ?? DEFAULT_REFINING_TIMEZONE;
    validateTimezone(timezone);
    this.timezone = timezone;
    const refreshHour = options.refreshHour ?? DEFAULT_REFINING_REFRESH_HOUR;
    const refreshMinute = options.refreshMinute ?? DEFAULT_REFINING_REFRESH_MINUTE;
    if (!Number.isSafeInteger(refreshHour) || refreshHour < 0 || refreshHour > 23) fail('INVALID_CONFIG', 'refreshHour is invalid');
    if (!Number.isSafeInteger(refreshMinute) || refreshMinute < 0 || refreshMinute > 59) fail('INVALID_CONFIG', 'refreshMinute is invalid');
    this.refreshHour = refreshHour;
    this.refreshMinute = refreshMinute;
    this.clock = options.clock ?? { now: () => Date.now() };
    if (!isRecord(this.clock) || typeof this.clock.now !== 'function') fail('INVALID_ARGUMENT', 'clock.now must be a function');
    if (options.rng !== undefined && typeof options.rng !== 'function') fail('INVALID_ARGUMENT', 'rng must be a function');
    this.rng = options.rng ?? Math.random;
    if (options.persist !== undefined && typeof options.persist !== 'function') fail('INVALID_ARGUMENT', 'persist must be a function');
    if (options.onSave !== undefined && typeof options.onSave !== 'function') fail('INVALID_ARGUMENT', 'onSave must be a function');
    if (options.persist !== undefined && options.onSave !== undefined && options.persist !== options.onSave) fail('INVALID_ARGUMENT', 'persist and onSave cannot both be provided');
    this.persist = options.persist ?? options.onSave;

    if (options.state !== undefined && options.initialState !== undefined) fail('INVALID_ARGUMENT', 'state and initialState cannot both be provided');
    if (options.state !== undefined || options.initialState !== undefined) {
      this.current = normalizeState(options.state ?? options.initialState, this.recipes, this.slotCount, this.timezone, this.refreshHour, this.refreshMinute);
    } else {
      const now = this.now();
      const materials = normalizeMaterials(options.materials ?? [], 'materials', 'INVALID_CONFIG', true);
      const cards = normalizeCards(options.cards ?? [], 'cards', 'INVALID_CONFIG');
      const tickets = options.refreshTickets ?? 0;
      assertSafeInteger(tickets, 'refreshTickets', 'INVALID_CONFIG');
      this.current = defaultState(this.recipes, this.slotCount, now, this.timezone, this.refreshHour, this.refreshMinute, tickets, materials, cards);
    }
  }

  static restore(serialized: string, options: Omit<CardRefiningOptions, 'state' | 'initialState'> = {}): CardRefiningService {
    return new CardRefiningService({ ...options, state: serialized });
  }

  snapshot(): CardRefiningState { return freezeState(this.current); }

  save(): string { return JSON.stringify(this.snapshot()); }

  recipesList(): readonly CardRefiningRecipe[] { return Object.freeze([...this.recipes.values()].map(cloneRecipe)); }

  getRecipe(recipeId: string): CardRefiningRecipe {
    const recipe = this.recipes.get(recipeId);
    if (!recipe) fail('UNKNOWN_RECIPE', `unknown refining recipe: ${recipeId}`);
    return cloneRecipe(recipe);
  }

  synchronize(at = this.now()): { readonly state: CardRefiningState; readonly refreshedCycles: number; readonly applied: boolean } {
    this.ensureIdle();
    const prepared = this.prepare(at);
    if (prepared.refreshedCycles === 0 && prepared.state.lastObservedAt === this.current.lastObservedAt) {
      return { state: this.snapshot(), refreshedCycles: 0, applied: false };
    }
    this.commit(prepared.state);
    return { state: this.snapshot(), refreshedCycles: prepared.refreshedCycles, applied: true };
  }

  refine(input: unknown): CardRefiningResult {
    this.ensureIdle();
    this.transactionActive = true;
    try { return this.refineTransaction(input); } finally { this.transactionActive = false; }
  }

  smelt(input: unknown): CardRefiningResult { return this.refine(input); }

  private refineTransaction(input: unknown): CardRefiningResult {
    const request = normalizeRequest(input);
    const fingerprint = requestFingerprint({ operation: 'REFINE', slotId: request.slotId, recipeId: request.recipeId, materials: request.materials ?? [] });
    const existing = this.current.receipts.find((entry) => entry.requestId === request.requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) fail('REQUEST_CONFLICT', `request ID was already used with different input: ${request.requestId}`);
      return cloneResult(existing.result);
    }
    const at = request.at ?? this.now();
    const prepared = this.prepare(at);
    const slotId = request.slotId;
    if (slotId === null || slotId >= this.slotCount) fail('INVALID_SLOT', 'a valid slotId is required');
    const slot = prepared.state.slots[slotId];
    const recipeId = request.recipeId ?? slot.recipeId;
    if (recipeId !== slot.recipeId) fail('SLOT_RECIPE_MISMATCH', 'recipeId does not match the selected slot');
    const recipe = this.recipes.get(recipeId);
    if (!recipe) fail('UNKNOWN_RECIPE', `unknown refining recipe: ${recipeId}`);
    if (request.materials !== undefined && !sameMaterials(request.materials, recipe.materials)) fail('MATERIAL_INPUT_MISMATCH', 'submitted materials must exactly match the recipe inputs');

    const currentMaterials = toMaterialMap(prepared.state.materials);
    for (const material of recipe.materials) if ((currentMaterials.get(material.materialId) ?? 0) < material.quantity) fail('INSUFFICIENT_MATERIALS', `insufficient material: ${material.materialId}`);
    const roll = this.rng();
    if (typeof roll !== 'number' || !Number.isFinite(roll) || roll < 0 || roll >= 1) fail('INVALID_RNG', 'rng must return a finite number in [0, 1)');
    const success = roll < recipe.probability;
    const nextMaterials = new Map(currentMaterials);
    for (const material of recipe.materials) subtractMaterial(nextMaterials, material);
    const returned = success ? Object.freeze([]) : copyMaterials(recipe.failureRefund);
    for (const material of returned) addMaterial(nextMaterials, material);
    const credited = success ? Object.freeze([copyCard(recipe.output)]) : Object.freeze([]);
    const nextCards = toCardMap(prepared.state.cards);
    for (const card of credited) addCard(nextCards, card);
    const sequence = prepared.state.ledger.length + 1;
    if (!Number.isSafeInteger(sequence)) fail('QUANTITY_EXCEEDED', 'refining ledger sequence exceeds the safe integer limit');
    const ledger = cloneLedger({ sequence, operation: 'REFINE', requestId: request.requestId, at, slotId, recipeId, success, probability: recipe.probability, roll, debited: copyMaterials(recipe.materials), returned, credited, spentRefreshTickets: 0 });
    const result = cloneResult({ operation: 'REFINE', requestId: request.requestId, applied: true, idempotent: false, at, slotId, recipeId, success, probability: recipe.probability, roll, debited: copyMaterials(recipe.materials), returned, credited, spentRefreshTickets: 0, refreshedCycles: 0, refreshCount: prepared.state.refreshCount, ledgerSequence: sequence });
    const nextLedger = [...prepared.state.ledger, ledger];
    const nextReceipts = [...prepared.state.receipts, { requestId: request.requestId, fingerprint, result }];
    const next = freezeState({ ...prepared.state, materials: materialList(nextMaterials), cards: cardList(nextCards), ledger: nextLedger, receipts: nextReceipts, chainDigest: calculateChainDigest(
      this.recipes, this.slotCount, prepared.state.initialMaterials, prepared.state.initialCards,
      prepared.state.initialRefreshTickets, prepared.state.initialLastObservedAt, nextLedger, nextReceipts,
    ) });
    this.commit(next);
    return cloneResult(result);
  }

  refresh(input: unknown, at?: number): CardRefiningResult {
    this.ensureIdle();
    this.transactionActive = true;
    try { return this.refreshTransaction(input, at); } finally { this.transactionActive = false; }
  }

  refreshNow(input: unknown, at?: number): CardRefiningResult { return this.refresh(input, at); }

  private refreshTransaction(input: unknown, explicitAt?: number): CardRefiningResult {
    const normalized = typeof input === 'string' ? null : normalizeRequest(input);
    if (normalized !== null && (normalized.slotId !== null || normalized.recipeId !== null || normalized.materials !== undefined)) {
      fail('INVALID_REQUEST', 'refresh requests cannot contain a slot, recipe or materials');
    }
    const requestId = typeof input === 'string' ? input : normalized?.requestId;
    const requestedAt = typeof input === 'string' ? explicitAt : (normalized?.at ?? explicitAt);
    assertText(requestId, 'requestId', ID_PATTERN, 'INVALID_REQUEST_ID');
    assertUserRequestId(requestId, 'requestId', 'INVALID_REQUEST_ID');
    if (requestedAt !== undefined) assertTimestamp(requestedAt, 'refresh.at');
    const fingerprint = requestFingerprint({ operation: 'REFRESH', slotId: null, recipeId: null, materials: [] });
    const existing = this.current.receipts.find((entry) => entry.requestId === requestId);
    if (existing) {
      if (existing.fingerprint !== fingerprint) fail('REQUEST_CONFLICT', `request ID was already used with different input: ${requestId}`);
      return cloneResult(existing.result);
    }
    const atValue = requestedAt ?? this.now();
    const prepared = this.prepare(atValue);
    if (prepared.state.refreshTickets < 1) fail('REFRESH_TICKETS_EXHAUSTED', 'a refresh ticket is required');
    if (prepared.state.refreshCount === Number.MAX_SAFE_INTEGER) fail('QUANTITY_EXCEEDED', 'refresh count exceeds the safe integer limit');
    const refreshCount = prepared.state.refreshCount + 1;
    const slots = selectSlots([...this.recipes.keys()], this.slotCount, refreshCount);
    const sequence = prepared.state.ledger.length + 1;
    if (!Number.isSafeInteger(sequence)) fail('QUANTITY_EXCEEDED', 'refining ledger sequence exceeds the safe integer limit');
    const ledger = cloneLedger({ sequence, operation: 'REFRESH', requestId, at: atValue, slotId: null, recipeId: null, success: null, probability: null, roll: null, debited: [], returned: [], credited: [], spentRefreshTickets: 1 });
    const result = cloneResult({ operation: 'REFRESH', requestId, applied: true, idempotent: false, at: atValue, slotId: null, recipeId: null, success: null, probability: null, roll: null, debited: [], returned: [], credited: [], spentRefreshTickets: 1, refreshedCycles: 1, refreshCount, ledgerSequence: sequence });
    const nextLedger = [...prepared.state.ledger, ledger];
    const nextReceipts = [...prepared.state.receipts, { requestId, fingerprint, result }];
    const next = freezeState({ ...prepared.state, refreshTickets: prepared.state.refreshTickets - 1, slots, refreshCount, ledger: nextLedger, receipts: nextReceipts, chainDigest: calculateChainDigest(
      this.recipes, this.slotCount, prepared.state.initialMaterials, prepared.state.initialCards,
      prepared.state.initialRefreshTickets, prepared.state.initialLastObservedAt, nextLedger, nextReceipts,
    ) });
    this.commit(next);
    return cloneResult(result);
  }

  private now(): number {
    const at = this.clock.now();
    assertTimestamp(at, 'clock.now()');
    return at;
  }

  private prepare(at: number): PreparedState {
    assertTimestamp(at, 'at');
    if (at < this.current.lastObservedAt) fail('TIME_REVERSED', 'refining time cannot move backwards');
    let nextRefreshAt = this.current.nextRefreshAt;
    let lastRefreshAt = this.current.lastRefreshAt;
    let refreshCount = this.current.refreshCount;
    let refreshedCycles = 0;
    const ledger = [...this.current.ledger];
    const receipts = [...this.current.receipts];
    while (at >= nextRefreshAt) {
      if (refreshCount === Number.MAX_SAFE_INTEGER) fail('QUANTITY_EXCEEDED', 'refresh count exceeds the safe integer limit');
      const eventAt = nextRefreshAt;
      refreshCount += 1;
      refreshedCycles += 1;
      if (refreshedCycles > 100000) fail('INVALID_TIME', 'too many scheduled refresh cycles to catch up');
      const sequence = ledger.length + 1;
      if (!Number.isSafeInteger(sequence)) fail('QUANTITY_EXCEEDED', 'refining ledger sequence exceeds the safe integer limit');
      const requestId = autoRefreshRequestId(eventAt);
      const fingerprint = requestFingerprint({ operation: 'AUTO_REFRESH', slotId: null, recipeId: null, materials: [] });
      const ledgerEntry = cloneLedger({ sequence, operation: 'AUTO_REFRESH', requestId, at: eventAt, slotId: null, recipeId: null, success: null, probability: null, roll: null, debited: [], returned: [], credited: [], spentRefreshTickets: 0 });
      const result = cloneResult({ operation: 'AUTO_REFRESH', requestId, applied: true, idempotent: false, at: eventAt, slotId: null, recipeId: null, success: null, probability: null, roll: null, debited: [], returned: [], credited: [], spentRefreshTickets: 0, refreshedCycles: 1, refreshCount, ledgerSequence: sequence });
      ledger.push(ledgerEntry);
      receipts.push({ requestId, fingerprint, result });
      lastRefreshAt = eventAt;
      nextRefreshAt = refreshBoundaryAfter(eventAt, this.timezone, this.refreshHour, this.refreshMinute);
    }
    const slots = refreshedCycles === 0 ? this.current.slots : selectSlots([...this.recipes.keys()], this.slotCount, refreshCount);
    const state = freezeState({ ...this.current, slots, refreshCount, lastRefreshAt, nextRefreshAt, lastObservedAt: at, ledger, receipts, chainDigest: calculateChainDigest(
      this.recipes, this.slotCount, this.current.initialMaterials, this.current.initialCards,
      this.current.initialRefreshTickets, this.current.initialLastObservedAt, ledger, receipts,
    ) });
    return { state, refreshedCycles };
  }

  private ensureIdle(): void {
    if (this.transactionActive || this.committing) fail('REENTRANT', 'refining transaction cannot re-enter');
  }

  private commit(next: CardRefiningState): void {
    const checked = normalizeState(next, this.recipes, this.slotCount, this.timezone, this.refreshHour, this.refreshMinute);
    if (this.committing) fail('REENTRANT', 'refining persistence cannot re-enter');
    this.committing = true;
    try {
      if (this.persist) this.persist(JSON.stringify(checked));
      this.current = checked;
    } catch (error) {
      if (error instanceof CardRefiningError && error.code === 'REENTRANT') throw error;
      throw new CardRefiningError('PERSISTENCE_FAILED', 'refining state persistence failed', error);
    } finally {
      this.committing = false;
    }
  }
}

export function createCardRefiningService(options: CardRefiningOptions = {}): CardRefiningService {
  return new CardRefiningService(options);
}

export function restoreCardRefiningService(serialized: string, options: Omit<CardRefiningOptions, 'state' | 'initialState'> = {}): CardRefiningService {
  return CardRefiningService.restore(serialized, options);
}

export const RefiningService = CardRefiningService;
