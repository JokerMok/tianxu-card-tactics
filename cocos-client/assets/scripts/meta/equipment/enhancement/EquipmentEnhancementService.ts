import {
  EQUIPMENT_PRIMARY_ATTRIBUTES,
  EQUIPMENT_QUALITY_LEVELS,
  EQUIPMENT_SLOTS,
  type EquipmentItem,
  type EquipmentPrimaryAttribute,
  type EquipmentQuality,
  type EquipmentSlot,
} from '../equipment-inventory.ts';

export const EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION = 1 as const;
export const EQUIPMENT_ENHANCEMENT_MAX_LEVEL = 10 as const;
export const EQUIPMENT_ENHANCEMENT_MATERIAL_ID = 'ENHANCEMENT_STONE' as const;
export const EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID = 'ENHANCEMENT_PROTECTION' as const;

export type EquipmentEnhancementMaterialId =
  | typeof EQUIPMENT_ENHANCEMENT_MATERIAL_ID
  | typeof EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID;

export interface EquipmentEnhancementLevelRule {
  readonly level: number;
  readonly materialQuantity: number;
  readonly goldCost: number;
  readonly successProbability: number;
}

const LEVEL_RULES = [
  { level: 0, materialQuantity: 1, goldCost: 100, successProbability: 1 },
  { level: 1, materialQuantity: 2, goldCost: 200, successProbability: 1 },
  { level: 2, materialQuantity: 3, goldCost: 300, successProbability: 0.9 },
  { level: 3, materialQuantity: 4, goldCost: 400, successProbability: 0.85 },
  { level: 4, materialQuantity: 5, goldCost: 500, successProbability: 0.8 },
  { level: 5, materialQuantity: 6, goldCost: 600, successProbability: 0.7 },
  { level: 6, materialQuantity: 7, goldCost: 700, successProbability: 0.6 },
  { level: 7, materialQuantity: 8, goldCost: 800, successProbability: 0.5 },
  { level: 8, materialQuantity: 9, goldCost: 900, successProbability: 0.4 },
  { level: 9, materialQuantity: 10, goldCost: 1000, successProbability: 0.3 },
] as const satisfies readonly EquipmentEnhancementLevelRule[];

export const EQUIPMENT_ENHANCEMENT_LEVEL_RULES: readonly EquipmentEnhancementLevelRule[] = Object.freeze(
  LEVEL_RULES.map((rule) => Object.freeze({ ...rule })),
);

export const EQUIPMENT_ENHANCEMENT_STAT_INCREMENT_BY_QUALITY: Readonly<Record<EquipmentQuality, number>> = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
  4: 4,
});

export const EQUIPMENT_ENHANCEMENT_MATERIAL_IDS: readonly EquipmentEnhancementMaterialId[] = Object.freeze([
  EQUIPMENT_ENHANCEMENT_MATERIAL_ID,
  EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID,
]);

export type EquipmentEnhancementMaterials = Readonly<Record<string, number>>;

export interface EquipmentEnhancementResources {
  readonly gold: number;
  readonly materials: EquipmentEnhancementMaterials;
}

export interface EquipmentEnhancementRecord {
  readonly equipment: EquipmentItem;
  readonly level: number;
  readonly basePrimaryValue: number;
}

export interface EquipmentEnhancementState {
  readonly schemaVersion: typeof EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION;
  readonly equipment: readonly EquipmentEnhancementRecord[];
  readonly resources: EquipmentEnhancementResources;
  readonly processedRequests: readonly EquipmentEnhancementProcessedRequest[];
}

export interface EquipmentEnhancementProcessedRequest {
  readonly requestId: string;
  readonly fingerprint: string;
  readonly result: EquipmentEnhancementResult;
}

export interface EquipmentEnhancementRequest {
  readonly equipmentId: unknown;
  readonly materials?: unknown;
  readonly materialId?: unknown;
  readonly materialQuantity?: unknown;
  readonly protectionMaterialId?: unknown;
  readonly protectionQuantity?: unknown;
  readonly protect?: unknown;
  readonly roll?: unknown;
}

export interface EquipmentEnhancementCost {
  readonly level: number;
  readonly materialId: typeof EQUIPMENT_ENHANCEMENT_MATERIAL_ID;
  readonly materialQuantity: number;
  readonly gold: number;
  readonly successProbability: number;
}

export interface EquipmentEnhancementQuote {
  readonly equipmentId: string;
  readonly equipment: EquipmentItem;
  readonly level: number;
  readonly canEnhance: boolean;
  readonly cost: EquipmentEnhancementCost | null;
  readonly protectionMaterialId: typeof EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID;
}

export type EquipmentEnhancementOutcome = 'SUCCESS' | 'FAILURE' | 'MAX_LEVEL';

export interface EquipmentEnhancementResult {
  readonly requestId: string;
  readonly equipmentId: string;
  readonly outcome: EquipmentEnhancementOutcome;
  readonly applied: boolean;
  readonly idempotent: boolean;
  readonly success: boolean;
  readonly protected: boolean;
  readonly downgraded: boolean;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly level: number;
  readonly attributeDelta: number;
  readonly equipment: EquipmentItem;
  readonly materialCost: EquipmentEnhancementMaterials;
  readonly materialsSpent: EquipmentEnhancementMaterials;
  readonly goldCost: number;
  readonly successProbability: number;
  readonly roll: number;
  readonly cost: {
    readonly gold: number;
    readonly materials: EquipmentEnhancementMaterials;
  };
  readonly resources: EquipmentEnhancementResources;
}

export interface EquipmentEnhancementOptions {
  readonly equipment?: readonly unknown[];
  readonly resources?: unknown;
  readonly state?: unknown;
  readonly persist?: (serialized: string) => void;
  readonly onSave?: (serialized: string) => void;
}

export type EquipmentEnhancementErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_REQUEST_ID'
  | 'INVALID_REQUEST'
  | 'INVALID_EQUIPMENT'
  | 'INVALID_EQUIPMENT_ID'
  | 'INVALID_SLOT'
  | 'INVALID_QUALITY'
  | 'INVALID_PRIMARY_ATTRIBUTE'
  | 'INVALID_PRIMARY_VALUE'
  | 'INVALID_LOCKED'
  | 'INVALID_LEVEL'
  | 'INVALID_ROLL'
  | 'INVALID_MATERIAL'
  | 'INVALID_MATERIAL_QUANTITY'
  | 'EQUIPMENT_NOT_FOUND'
  | 'EQUIPMENT_AT_MAX_LEVEL'
  | 'INSUFFICIENT_GOLD'
  | 'INSUFFICIENT_MATERIALS'
  | 'DUPLICATE_EQUIPMENT'
  | 'DUPLICATE_REQUEST'
  | 'REQUEST_CONFLICT'
  | 'PERSISTENCE_FAILED'
  | 'PERSISTENCE_REENTRANT';

const SLOT_SET = new Set<string>(EQUIPMENT_SLOTS);
const QUALITY_SET = new Set<number>(EQUIPMENT_QUALITY_LEVELS);
const ATTRIBUTE_SET = new Set<string>(EQUIPMENT_PRIMARY_ATTRIBUTES);
const MATERIAL_SET = new Set<string>(EQUIPMENT_ENHANCEMENT_MATERIAL_IDS);
const ITEM_KEYS = new Set(['equipmentId', 'slot', 'quality', 'primaryAttribute', 'primaryValue', 'locked']);
const RECORD_KEYS = new Set(['equipment', 'level', 'basePrimaryValue']);
const RESOURCE_KEYS = new Set(['gold', 'materials']);
const STATE_KEYS = new Set(['schemaVersion', 'equipment', 'resources', 'processedRequests']);
const PROCESSED_REQUEST_KEYS = new Set(['requestId', 'fingerprint', 'result']);
const RESULT_KEYS = new Set([
  'requestId',
  'equipmentId',
  'outcome',
  'applied',
  'idempotent',
  'success',
  'protected',
  'downgraded',
  'levelBefore',
  'levelAfter',
  'level',
  'attributeDelta',
  'equipment',
  'materialCost',
  'materialsSpent',
  'goldCost',
  'successProbability',
  'roll',
  'cost',
  'resources',
]);
const COST_KEYS = new Set(['gold', 'materials']);
const FINGERPRINT_KEYS = new Set([
  'equipmentId',
  'materialsMode',
  'submittedMaterials',
  'materialId',
  'materialQuantity',
  'protectionMaterialId',
  'protectionQuantity',
  'roll',
]);
const REQUEST_KEYS = new Set([
  'equipmentId',
  'materials',
  'materialId',
  'materialQuantity',
  'protectionMaterialId',
  'protectionQuantity',
  'protect',
  'roll',
]);
const REQUEST_ID_PATTERN = /^\S(?:.*\S)?$/;

interface NormalizedRequest {
  readonly equipmentId: string;
  readonly materialsMode: 'default' | 'map' | 'fields';
  readonly submittedMaterials: Readonly<Record<string, number>> | null;
  readonly materialId: string;
  readonly materialQuantity?: number;
  readonly protectionMaterialId: string;
  readonly protectionQuantity: number;
  readonly roll: number;
}

interface MutableState {
  schemaVersion: typeof EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION;
  equipment: EquipmentEnhancementRecord[];
  resources: EquipmentEnhancementResources;
  processedRequests: EquipmentEnhancementProcessedRequest[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(code: EquipmentEnhancementErrorCode, cause?: unknown): never {
  throw new EquipmentEnhancementError(code, cause);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return isSafeInteger(value) && value > 0;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function assertExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, code: EquipmentEnhancementErrorCode): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) fail(code);
  }
}

function assertRequiredKeys(value: Record<string, unknown>, required: ReadonlySet<string>, code: EquipmentEnhancementErrorCode): void {
  for (const key of required) if (!hasOwn(value, key)) fail(code);
}

function normalizeRequestId(value: unknown): string {
  if (!isText(value) || !REQUEST_ID_PATTERN.test(value)) fail('INVALID_REQUEST_ID');
  return value;
}

function normalizeEquipmentId(value: unknown, code: EquipmentEnhancementErrorCode = 'INVALID_EQUIPMENT_ID'): string {
  if (!isText(value)) fail(code);
  return value;
}

function normalizeSlot(value: unknown, code: EquipmentEnhancementErrorCode): EquipmentSlot {
  if (typeof value !== 'string' || !SLOT_SET.has(value)) fail(code);
  return value as EquipmentSlot;
}

function normalizeQuality(value: unknown, code: EquipmentEnhancementErrorCode): EquipmentQuality {
  if (typeof value !== 'number' || !QUALITY_SET.has(value)) fail(code);
  return value as EquipmentQuality;
}

function normalizePrimaryAttribute(value: unknown, code: EquipmentEnhancementErrorCode): EquipmentPrimaryAttribute {
  if (typeof value !== 'string' || !ATTRIBUTE_SET.has(value)) fail(code);
  return value as EquipmentPrimaryAttribute;
}

function normalizeEquipment(value: unknown, state = false): EquipmentItem {
  const code: EquipmentEnhancementErrorCode = state ? 'INVALID_STATE' : 'INVALID_EQUIPMENT';
  if (!isRecord(value)) fail(code);
  assertExactKeys(value, ITEM_KEYS, code);
  assertRequiredKeys(value, ITEM_KEYS, code);
  return {
    equipmentId: normalizeEquipmentId(value.equipmentId, state ? 'INVALID_STATE' : 'INVALID_EQUIPMENT_ID'),
    slot: normalizeSlot(value.slot, state ? 'INVALID_STATE' : 'INVALID_SLOT'),
    quality: normalizeQuality(value.quality, state ? 'INVALID_STATE' : 'INVALID_QUALITY'),
    primaryAttribute: normalizePrimaryAttribute(value.primaryAttribute, state ? 'INVALID_STATE' : 'INVALID_PRIMARY_ATTRIBUTE'),
    primaryValue: isPositiveInteger(value.primaryValue)
      ? value.primaryValue
      : fail(state ? 'INVALID_STATE' : 'INVALID_PRIMARY_VALUE'),
    locked: typeof value.locked === 'boolean'
      ? value.locked
      : fail(state ? 'INVALID_STATE' : 'INVALID_LOCKED'),
  };
}

function normalizeLevel(value: unknown, code: EquipmentEnhancementErrorCode = 'INVALID_LEVEL'): number {
  if (!isSafeInteger(value) || value < 0 || value > EQUIPMENT_ENHANCEMENT_MAX_LEVEL) fail(code);
  return value;
}

function normalizeProbability(value: unknown, code: EquipmentEnhancementErrorCode): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) fail(code);
  return value;
}

function normalizeRoll(value: unknown): number {
  if (value === undefined) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value >= 1) fail('INVALID_ROLL');
  return value;
}

function materialObject(materials: ReadonlyMap<string, number>): EquipmentEnhancementMaterials {
  const result: Record<string, number> = {};
  for (const [key, quantity] of [...materials.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (quantity === 0) continue;
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: quantity,
      writable: false,
    });
  }
  return Object.freeze(result);
}

function materialMap(value: unknown, code: EquipmentEnhancementErrorCode, allowEmpty = true): Map<string, number> {
  if (!isRecord(value)) fail(code);
  const result = new Map<string, number>();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !MATERIAL_SET.has(key)) {
      fail(code === 'INVALID_STATE' ? 'INVALID_STATE' : 'INVALID_MATERIAL');
    }
    const quantity = value[key];
    if (!isNonNegativeInteger(quantity) || (!allowEmpty && quantity === 0)) {
      fail(code === 'INVALID_STATE' ? 'INVALID_STATE' : 'INVALID_MATERIAL_QUANTITY');
    }
    if (quantity > 0) result.set(key, quantity);
  }
  return result;
}

function normalizeResources(value: unknown, code: EquipmentEnhancementErrorCode): EquipmentEnhancementResources {
  if (!isRecord(value)) fail(code);
  assertExactKeys(value, RESOURCE_KEYS, code);
  assertRequiredKeys(value, RESOURCE_KEYS, code);
  if (!isNonNegativeInteger(value.gold)) fail(code);
  return { gold: value.gold, materials: materialObject(materialMap(value.materials, code)) };
}

function normalizeRecord(value: unknown): EquipmentEnhancementRecord {
  if (!isRecord(value)) fail('INVALID_STATE');
  assertExactKeys(value, RECORD_KEYS, 'INVALID_STATE');
  assertRequiredKeys(value, RECORD_KEYS, 'INVALID_STATE');
  const equipment = normalizeEquipment(value.equipment, true);
  const level = normalizeLevel(value.level, 'INVALID_STATE');
  if (!isPositiveInteger(value.basePrimaryValue)) fail('INVALID_STATE');
  const basePrimaryValue = value.basePrimaryValue;
  const increment = EQUIPMENT_ENHANCEMENT_STAT_INCREMENT_BY_QUALITY[equipment.quality];
  if (basePrimaryValue + increment * level !== equipment.primaryValue) fail('INVALID_STATE');
  return { equipment, level, basePrimaryValue };
}

function getLevelRule(level: number): EquipmentEnhancementLevelRule | null {
  return EQUIPMENT_ENHANCEMENT_LEVEL_RULES.find((rule) => rule.level === level) ?? null;
}

export function getEquipmentEnhancementCost(level: unknown): EquipmentEnhancementCost | null {
  const normalizedLevel = normalizeLevel(level);
  const rule = getLevelRule(normalizedLevel);
  if (rule === null) return null;
  return Object.freeze({
    level: rule.level,
    materialId: EQUIPMENT_ENHANCEMENT_MATERIAL_ID,
    materialQuantity: rule.materialQuantity,
    gold: rule.goldCost,
    successProbability: rule.successProbability,
  });
}

export function getEquipmentEnhancementStatIncrement(quality: unknown): number {
  const normalizedQuality = normalizeQuality(quality, 'INVALID_QUALITY');
  return EQUIPMENT_ENHANCEMENT_STAT_INCREMENT_BY_QUALITY[normalizedQuality];
}

function normalizeRequest(value: unknown): NormalizedRequest {
  if (!isRecord(value)) fail('INVALID_REQUEST');
  assertExactKeys(value, REQUEST_KEYS, 'INVALID_REQUEST');
  if (!hasOwn(value, 'equipmentId')) fail('INVALID_REQUEST');
  const equipmentId = normalizeEquipmentId(value.equipmentId, 'INVALID_REQUEST');
  const roll = normalizeRoll(value.roll);

  const hasMaterials = hasOwn(value, 'materials');
  const hasFieldMaterials = ['materialId', 'materialQuantity', 'protectionMaterialId', 'protectionQuantity', 'protect']
    .some((key) => hasOwn(value, key));
  if (hasMaterials && hasFieldMaterials) fail('INVALID_REQUEST');

  if (hasMaterials) {
    const submittedMaterials = materialObject(materialMap(value.materials, 'INVALID_REQUEST'));
    return {
      equipmentId,
      materialsMode: 'map',
      submittedMaterials,
      materialId: EQUIPMENT_ENHANCEMENT_MATERIAL_ID,
      protectionMaterialId: EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID,
      protectionQuantity: 0,
      roll,
    };
  }

  const hasMaterialId = hasOwn(value, 'materialId');
  const hasMaterialQuantity = hasOwn(value, 'materialQuantity');
  const hasProtectionMaterialId = hasOwn(value, 'protectionMaterialId');
  const hasProtectionQuantity = hasOwn(value, 'protectionQuantity');
  const hasProtect = hasOwn(value, 'protect');
  if (!hasMaterialId && !hasMaterialQuantity && !hasProtectionMaterialId && !hasProtectionQuantity && !hasProtect) {
    return {
      equipmentId,
      materialsMode: 'default',
      submittedMaterials: null,
      materialId: EQUIPMENT_ENHANCEMENT_MATERIAL_ID,
      protectionMaterialId: EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID,
      protectionQuantity: 0,
      roll,
    };
  }

  const materialId = value.materialId === undefined
    ? EQUIPMENT_ENHANCEMENT_MATERIAL_ID
    : normalizeEquipmentId(value.materialId, 'INVALID_MATERIAL');
  const protectionMaterialId = value.protectionMaterialId === undefined
    ? EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID
    : normalizeEquipmentId(value.protectionMaterialId, 'INVALID_MATERIAL');
  const materialQuantity = value.materialQuantity === undefined
    ? undefined
    : isPositiveInteger(value.materialQuantity)
      ? value.materialQuantity
      : fail('INVALID_MATERIAL_QUANTITY');
  let protectionQuantity = value.protectionQuantity === undefined
    ? 0
    : isNonNegativeInteger(value.protectionQuantity)
      ? value.protectionQuantity
      : fail('INVALID_MATERIAL_QUANTITY');
  if (hasProtect) {
    if (typeof value.protect !== 'boolean') fail('INVALID_REQUEST');
    const protectedQuantity = value.protect ? 1 : 0;
    if (hasProtectionQuantity && protectionQuantity !== protectedQuantity) fail('INVALID_REQUEST');
    protectionQuantity = protectedQuantity;
  }
  return {
    equipmentId,
    materialsMode: 'fields',
    submittedMaterials: null,
    materialId,
    materialQuantity,
    protectionMaterialId,
    protectionQuantity,
    roll,
  };
}

function requestFingerprint(request: NormalizedRequest): string {
  return JSON.stringify({
    equipmentId: request.equipmentId,
    materialsMode: request.materialsMode,
    submittedMaterials: request.submittedMaterials,
    materialId: request.materialId,
    materialQuantity: request.materialQuantity ?? null,
    protectionMaterialId: request.protectionMaterialId,
    protectionQuantity: request.protectionQuantity,
    roll: request.roll,
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareEquipmentRecords(left: EquipmentEnhancementRecord, right: EquipmentEnhancementRecord): number {
  return compareText(left.equipment.equipmentId, right.equipment.equipmentId);
}

function compareProcessedRequests(
  left: EquipmentEnhancementProcessedRequest,
  right: EquipmentEnhancementProcessedRequest,
): number {
  return compareText(left.requestId, right.requestId);
}

function sameMaterials(left: EquipmentEnhancementMaterials, right: EquipmentEnhancementMaterials): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeProcessedFingerprint(value: unknown): NormalizedRequest {
  if (!isText(value)) fail('INVALID_STATE');
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    fail('INVALID_STATE', error);
  }
  if (!isRecord(parsed)) fail('INVALID_STATE');
  assertExactKeys(parsed, FINGERPRINT_KEYS, 'INVALID_STATE');
  assertRequiredKeys(parsed, FINGERPRINT_KEYS, 'INVALID_STATE');

  const materialQuantity = parsed.materialQuantity === null ? undefined : parsed.materialQuantity;
  const requestValue: Record<string, unknown> = {
    equipmentId: parsed.equipmentId,
    roll: parsed.roll,
  };
  if (parsed.materialsMode === 'map') {
    requestValue.materials = parsed.submittedMaterials;
  } else if (parsed.materialsMode === 'fields') {
    requestValue.materialId = parsed.materialId;
    if (materialQuantity !== undefined) requestValue.materialQuantity = materialQuantity;
    requestValue.protectionMaterialId = parsed.protectionMaterialId;
    requestValue.protectionQuantity = parsed.protectionQuantity;
  } else if (parsed.materialsMode !== 'default') {
    fail('INVALID_STATE');
  }

  let normalized: NormalizedRequest;
  try {
    normalized = normalizeRequest(requestValue);
  } catch (error) {
    if (error instanceof EquipmentEnhancementError && error.code === 'INVALID_STATE') throw error;
    fail('INVALID_STATE', error);
  }
  if (requestFingerprint(normalized) !== value) fail('INVALID_STATE');
  return normalized;
}

function assertProcessedFingerprintMatchesResult(
  request: NormalizedRequest,
  result: EquipmentEnhancementResult,
): void {
  if (request.equipmentId !== result.equipmentId || request.roll !== result.roll) fail('INVALID_STATE');
  let expectedMaterials: EquipmentEnhancementMaterials;
  try {
    expectedMaterials = canonicalMaterialsForAttempt(request, getEquipmentEnhancementCost(result.levelBefore));
  } catch (error) {
    fail('INVALID_STATE', error);
  }
  if (!sameMaterials(expectedMaterials, result.materialsSpent)) fail('INVALID_STATE');
}

function normalizeState(value: unknown): EquipmentEnhancementState {
  const parsed = typeof value === 'string'
    ? (() => {
      try {
        return JSON.parse(value);
      } catch (error) {
        fail('INVALID_STATE', error);
      }
    })()
    : value;
  if (!isRecord(parsed)) fail('INVALID_STATE');
  assertExactKeys(parsed, STATE_KEYS, 'INVALID_STATE');
  assertRequiredKeys(parsed, STATE_KEYS, 'INVALID_STATE');
  if (parsed.schemaVersion !== EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION || !Array.isArray(parsed.equipment)
    || !Array.isArray(parsed.processedRequests)) fail('INVALID_STATE');
  const equipment = parsed.equipment.map(normalizeRecord).sort(compareEquipmentRecords);
  const ids = new Set<string>();
  for (const record of equipment) {
    if (ids.has(record.equipment.equipmentId)) fail('INVALID_STATE');
    ids.add(record.equipment.equipmentId);
  }
  const processedRequests = parsed.processedRequests.map((value) => normalizeProcessedRequest(value))
    .sort(compareProcessedRequests);
  const requestIds = new Set<string>();
  for (const request of processedRequests) {
    if (requestIds.has(request.requestId)) fail('INVALID_STATE');
    requestIds.add(request.requestId);
  }
  return freezeState({
    schemaVersion: EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION,
    equipment,
    resources: normalizeResources(parsed.resources, 'INVALID_STATE'),
    processedRequests,
  });
}

function normalizeProcessedRequest(value: unknown): EquipmentEnhancementProcessedRequest {
  if (!isRecord(value)) fail('INVALID_STATE');
  assertExactKeys(value, PROCESSED_REQUEST_KEYS, 'INVALID_STATE');
  assertRequiredKeys(value, PROCESSED_REQUEST_KEYS, 'INVALID_STATE');
  const requestId = normalizeRequestId(value.requestId);
  const result = normalizeResult(value.result);
  if (result.requestId !== requestId) fail('INVALID_STATE');
  const request = normalizeProcessedFingerprint(value.fingerprint);
  assertProcessedFingerprintMatchesResult(request, result);
  return { requestId, fingerprint: value.fingerprint, result };
}

function normalizeMaterialsForResult(value: unknown): EquipmentEnhancementMaterials {
  return materialObject(materialMap(value, 'INVALID_STATE'));
}

function normalizeResult(value: unknown): EquipmentEnhancementResult {
  if (!isRecord(value)) fail('INVALID_STATE');
  assertExactKeys(value, RESULT_KEYS, 'INVALID_STATE');
  assertRequiredKeys(value, RESULT_KEYS, 'INVALID_STATE');
  const equipment = normalizeEquipment(value.equipment, true);
  const outcome = value.outcome;
  if (outcome !== 'SUCCESS' && outcome !== 'FAILURE' && outcome !== 'MAX_LEVEL') fail('INVALID_STATE');
  const levelBefore = normalizeLevel(value.levelBefore, 'INVALID_STATE');
  const levelAfter = normalizeLevel(value.levelAfter, 'INVALID_STATE');
  if (value.level !== levelAfter || !isText(value.requestId) || !isText(value.equipmentId)
    || equipment.equipmentId !== value.equipmentId || typeof value.applied !== 'boolean'
    || typeof value.idempotent !== 'boolean' || typeof value.success !== 'boolean'
    || typeof value.protected !== 'boolean' || typeof value.downgraded !== 'boolean'
    || !isSafeInteger(value.attributeDelta) || !isNonNegativeInteger(value.goldCost)
    || !Number.isInteger(value.levelBefore) || !Number.isInteger(value.levelAfter)) fail('INVALID_STATE');
  if (outcome === 'SUCCESS' && !value.success) fail('INVALID_STATE');
  if (outcome !== 'SUCCESS' && value.success) fail('INVALID_STATE');
  const successProbability = normalizeProbability(value.successProbability, 'INVALID_STATE');
  if (typeof value.roll !== 'number' || !Number.isFinite(value.roll) || value.roll < 0 || value.roll >= 1) fail('INVALID_STATE');
  const materialCost = normalizeMaterialsForResult(value.materialCost);
  const materialsSpent = normalizeMaterialsForResult(value.materialsSpent);
  if (!isRecord(value.cost)) fail('INVALID_STATE');
  assertExactKeys(value.cost, COST_KEYS, 'INVALID_STATE');
  assertRequiredKeys(value.cost, COST_KEYS, 'INVALID_STATE');
  if (value.cost.gold !== value.goldCost) fail('INVALID_STATE');
  const costMaterials = normalizeMaterialsForResult(value.cost.materials);
  if (JSON.stringify(materialCost) !== JSON.stringify(materialsSpent)
    || JSON.stringify(costMaterials) !== JSON.stringify(materialsSpent)) fail('INVALID_STATE');
  return freezeResult({
    requestId: value.requestId,
    equipmentId: value.equipmentId,
    outcome,
    applied: value.applied,
    idempotent: value.idempotent,
    success: value.success,
    protected: value.protected,
    downgraded: value.downgraded,
    levelBefore,
    levelAfter,
    level: levelAfter,
    attributeDelta: value.attributeDelta,
    equipment,
    materialCost,
    materialsSpent,
    goldCost: value.goldCost,
    successProbability,
    roll: value.roll,
    cost: { gold: value.cost.gold, materials: costMaterials },
    resources: normalizeResources(value.resources, 'INVALID_STATE'),
  });
}

function freezeEquipment(equipment: EquipmentItem): EquipmentItem {
  return Object.freeze({ ...equipment });
}

function freezeResources(resources: EquipmentEnhancementResources): EquipmentEnhancementResources {
  return Object.freeze({
    gold: resources.gold,
    materials: materialObject(materialMap(resources.materials, 'INVALID_STATE')),
  });
}

function freezeRecord(record: EquipmentEnhancementRecord): EquipmentEnhancementRecord {
  return Object.freeze({
    equipment: freezeEquipment(record.equipment),
    level: record.level,
    basePrimaryValue: record.basePrimaryValue,
  });
}

function freezeResult(result: EquipmentEnhancementResult): EquipmentEnhancementResult {
  const materialsSpent = materialObject(materialMap(result.materialsSpent, 'INVALID_STATE'));
  return Object.freeze({
    requestId: result.requestId,
    equipmentId: result.equipmentId,
    outcome: result.outcome,
    applied: result.applied,
    idempotent: result.idempotent,
    success: result.success,
    protected: result.protected,
    downgraded: result.downgraded,
    levelBefore: result.levelBefore,
    levelAfter: result.levelAfter,
    level: result.levelAfter,
    attributeDelta: result.attributeDelta,
    equipment: freezeEquipment(result.equipment),
    materialCost: materialObject(materialMap(result.materialCost, 'INVALID_STATE')),
    materialsSpent,
    goldCost: result.goldCost,
    successProbability: result.successProbability,
    roll: result.roll,
    cost: Object.freeze({ gold: result.goldCost, materials: materialsSpent }),
    resources: freezeResources(result.resources),
  });
}

function freezeState(value: MutableState): EquipmentEnhancementState {
  const equipment = [...value.equipment].sort(compareEquipmentRecords);
  const processedRequests = [...value.processedRequests].sort(compareProcessedRequests);
  return Object.freeze({
    schemaVersion: EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION,
    equipment: Object.freeze(equipment.map(freezeRecord)),
    resources: freezeResources(value.resources),
    processedRequests: Object.freeze(processedRequests.map((request) => Object.freeze({
      requestId: request.requestId,
      fingerprint: request.fingerprint,
      result: freezeResult(request.result),
    }))),
  });
}

function cloneEquipment(equipment: EquipmentItem): EquipmentItem {
  return { ...equipment };
}

function cloneResources(resources: EquipmentEnhancementResources): EquipmentEnhancementResources {
  return { gold: resources.gold, materials: { ...resources.materials } };
}

function cloneState(value: EquipmentEnhancementState): MutableState {
  return {
    schemaVersion: EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION,
    equipment: value.equipment.map((record) => ({
      equipment: cloneEquipment(record.equipment),
      level: record.level,
      basePrimaryValue: record.basePrimaryValue,
    })),
    resources: cloneResources(value.resources),
    processedRequests: value.processedRequests.map((request) => ({
      requestId: request.requestId,
      fingerprint: request.fingerprint,
      result: freezeResult(request.result),
    })),
  };
}

function emptyState(equipment: readonly unknown[], resources: unknown): EquipmentEnhancementState {
  const normalizedEquipment = equipment.map((value) => normalizeEquipment(value));
  const ids = new Set<string>();
  const records = normalizedEquipment.map((item) => {
    if (ids.has(item.equipmentId)) fail('DUPLICATE_EQUIPMENT');
    ids.add(item.equipmentId);
    return { equipment: item, level: 0, basePrimaryValue: item.primaryValue };
  });
  return freezeState({
    schemaVersion: EQUIPMENT_ENHANCEMENT_SCHEMA_VERSION,
    equipment: records,
    resources: normalizeResources(resources, 'INVALID_CONFIG'),
    processedRequests: [],
  });
}

function cloneResultForReplay(result: EquipmentEnhancementResult, requestId: string): EquipmentEnhancementResult {
  return freezeResult({ ...result, requestId, idempotent: true, applied: false });
}

function canonicalMaterialsForAttempt(
  request: NormalizedRequest,
  cost: EquipmentEnhancementCost | null,
): EquipmentEnhancementMaterials {
  const expectedStone = cost?.materialQuantity ?? 0;
  const expectedProtection = request.protectionQuantity;
  if (request.materialsMode === 'map') {
    const submitted = request.submittedMaterials ?? {};
    const submittedStone = submitted[EQUIPMENT_ENHANCEMENT_MATERIAL_ID] ?? 0;
    const submittedProtection = submitted[EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID] ?? 0;
    if (submittedStone !== expectedStone) fail('INVALID_MATERIAL_QUANTITY');
    if (submittedProtection > 1) fail('INVALID_MATERIAL_QUANTITY');
    if (cost === null && submittedProtection !== 0) fail('INVALID_MATERIAL_QUANTITY');
    return materialObject(new Map([
      [EQUIPMENT_ENHANCEMENT_MATERIAL_ID, submittedStone],
      [EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID, submittedProtection],
    ]));
  }
  if (request.materialId !== EQUIPMENT_ENHANCEMENT_MATERIAL_ID) fail('INVALID_MATERIAL');
  if (request.materialQuantity !== undefined && request.materialQuantity !== expectedStone) fail('INVALID_MATERIAL_QUANTITY');
  if (request.protectionMaterialId !== EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID) fail('INVALID_MATERIAL');
  if (expectedProtection > 1) fail('INVALID_MATERIAL_QUANTITY');
  if (cost === null && (request.materialQuantity !== undefined || expectedProtection !== 0)) fail('INVALID_MATERIAL_QUANTITY');
  const materials = new Map<string, number>([[EQUIPMENT_ENHANCEMENT_MATERIAL_ID, expectedStone]]);
  if (expectedProtection > 0) materials.set(EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID, expectedProtection);
  return materialObject(materials);
}

function subtractMaterials(
  resources: EquipmentEnhancementResources,
  spent: EquipmentEnhancementMaterials,
): EquipmentEnhancementResources {
  const available = materialMap(resources.materials, 'INVALID_STATE');
  for (const [materialId, quantity] of Object.entries(spent)) {
    if ((available.get(materialId) ?? 0) < quantity) fail('INSUFFICIENT_MATERIALS');
    available.set(materialId, (available.get(materialId) ?? 0) - quantity);
  }
  return { gold: resources.gold, materials: materialObject(available) };
}

function currentRecord(state: EquipmentEnhancementState, equipmentId: string): EquipmentEnhancementRecord {
  const record = state.equipment.find((candidate) => candidate.equipment.equipmentId === equipmentId);
  if (!record) fail('EQUIPMENT_NOT_FOUND');
  return record;
}

export class EquipmentEnhancementError extends Error {
  readonly code: EquipmentEnhancementErrorCode;
  readonly reason: EquipmentEnhancementErrorCode;
  readonly cause?: unknown;

  constructor(code: EquipmentEnhancementErrorCode, cause?: unknown) {
    super(code);
    this.name = 'EquipmentEnhancementError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class EquipmentEnhancementService {
  private readonly persist: (serialized: string) => void;
  private current: EquipmentEnhancementState;
  private committing = false;

  constructor(options: EquipmentEnhancementOptions = {}) {
    if (!isRecord(options)) fail('INVALID_CONFIG');
    assertExactKeys(options, new Set(['equipment', 'resources', 'state', 'persist', 'onSave']), 'INVALID_CONFIG');
    if (options.persist !== undefined && options.onSave !== undefined) fail('INVALID_CONFIG');
    this.persist = options.persist ?? options.onSave ?? (() => {});
    if (typeof this.persist !== 'function') fail('INVALID_CONFIG');
    if (options.state !== undefined) {
      if (options.equipment !== undefined || options.resources !== undefined) fail('INVALID_CONFIG');
      this.current = normalizeState(options.state);
      return;
    }
    const equipment = options.equipment ?? [];
    if (!Array.isArray(equipment)) fail('INVALID_CONFIG');
    const resources = options.resources ?? { gold: 0, materials: {} };
    if (!isRecord(resources)) fail('INVALID_CONFIG');
    this.current = emptyState(equipment, resources);
  }

  static restore(serialized: string, options: Omit<EquipmentEnhancementOptions, 'state' | 'equipment' | 'resources'> = {}): EquipmentEnhancementService {
    return new EquipmentEnhancementService({ ...options, state: serialized });
  }

  snapshot(): EquipmentEnhancementState {
    return normalizeState(this.current);
  }

  save(): string {
    return JSON.stringify(this.snapshot());
  }

  get(equipmentId: string): EquipmentEnhancementRecord {
    const normalizedId = normalizeEquipmentId(equipmentId);
    return freezeRecord(currentRecord(this.current, normalizedId));
  }

  getEquipment(equipmentId: string): EquipmentEnhancementRecord {
    return this.get(equipmentId);
  }

  list(): readonly EquipmentEnhancementRecord[] {
    return Object.freeze(this.current.equipment.map(freezeRecord));
  }

  quote(equipmentId: string): EquipmentEnhancementQuote {
    const record = this.get(equipmentId);
    return Object.freeze({
      equipmentId: record.equipment.equipmentId,
      equipment: freezeEquipment(record.equipment),
      level: record.level,
      canEnhance: record.level < EQUIPMENT_ENHANCEMENT_MAX_LEVEL,
      cost: getEquipmentEnhancementCost(record.level),
      protectionMaterialId: EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID,
    });
  }

  add(equipment: unknown): EquipmentEnhancementRecord {
    if (this.committing) fail('PERSISTENCE_REENTRANT');
    const item = normalizeEquipment(equipment);
    if (this.current.equipment.some((record) => record.equipment.equipmentId === item.equipmentId)) fail('DUPLICATE_EQUIPMENT');
    return this.transact((next) => {
      next.equipment.push({ equipment: item, level: 0, basePrimaryValue: item.primaryValue });
      return freezeRecord(next.equipment[next.equipment.length - 1]);
    });
  }

  addEquipment(equipment: unknown): EquipmentEnhancementRecord {
    return this.add(equipment);
  }

  enhance(requestId: string, request: EquipmentEnhancementRequest): EquipmentEnhancementResult;
  enhance(requestId: string, equipmentId: string, options?: Omit<EquipmentEnhancementRequest, 'equipmentId'>): EquipmentEnhancementResult;
  enhance(request: EquipmentEnhancementRequest & { readonly requestId: unknown }): EquipmentEnhancementResult;
  enhance(
    requestIdOrRequest: string | EquipmentEnhancementRequest & { readonly requestId: unknown },
    requestOrEquipment?: EquipmentEnhancementRequest | string,
    options: Omit<EquipmentEnhancementRequest, 'equipmentId'> = {},
  ): EquipmentEnhancementResult {
    let requestId: unknown;
    let requestValue: unknown;
    if (typeof requestIdOrRequest === 'string') {
      requestId = requestIdOrRequest;
      if (typeof requestOrEquipment === 'string') requestValue = { ...options, equipmentId: requestOrEquipment };
      else requestValue = requestOrEquipment;
    } else {
      if (!isRecord(requestIdOrRequest) || !hasOwn(requestIdOrRequest, 'requestId')) fail('INVALID_REQUEST');
      assertExactKeys(requestIdOrRequest, new Set([...REQUEST_KEYS, 'requestId']), 'INVALID_REQUEST');
      requestId = requestIdOrRequest.requestId;
      const { requestId: _requestId, ...rest } = requestIdOrRequest;
      requestValue = rest;
    }
    const normalizedRequestId = normalizeRequestId(requestId);
    const normalizedRequest = normalizeRequest(requestValue);
    const fingerprint = requestFingerprint(normalizedRequest);
    const previous = this.current.processedRequests.find((entry) => entry.requestId === normalizedRequestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('REQUEST_CONFLICT');
      return cloneResultForReplay(previous.result, normalizedRequestId);
    }

    const record = currentRecord(this.current, normalizedRequest.equipmentId);
    const cost = getEquipmentEnhancementCost(record.level);
    if (record.level === EQUIPMENT_ENHANCEMENT_MAX_LEVEL) {
      canonicalMaterialsForAttempt(normalizedRequest, cost);
      return freezeResult({
        requestId: normalizedRequestId,
        equipmentId: record.equipment.equipmentId,
        outcome: 'MAX_LEVEL',
        applied: false,
        idempotent: false,
        success: false,
        protected: false,
        downgraded: false,
        levelBefore: record.level,
        levelAfter: record.level,
        level: record.level,
        attributeDelta: 0,
        equipment: cloneEquipment(record.equipment),
        materialCost: {},
        materialsSpent: {},
        goldCost: 0,
        successProbability: 1,
        roll: normalizedRequest.roll,
        cost: { gold: 0, materials: {} },
        resources: cloneResources(this.current.resources),
      });
    }
    if (cost === null) fail('INVALID_STATE');
    const materialsSpent = canonicalMaterialsForAttempt(normalizedRequest, cost);
    if (this.current.resources.gold < cost.gold) fail('INSUFFICIENT_GOLD');
    const afterMaterials = subtractMaterials(this.current.resources, materialsSpent);
    const afterResources = { gold: this.current.resources.gold - cost.gold, materials: afterMaterials.materials };
    const success = normalizedRequest.roll < cost.successProbability;
    const protectedAttempt = (materialsSpent[EQUIPMENT_ENHANCEMENT_PROTECTION_MATERIAL_ID] ?? 0) === 1;
    const levelAfter = success || protectedAttempt ? record.level + (success ? 1 : 0) : Math.max(0, record.level - 1);
    const increment = EQUIPMENT_ENHANCEMENT_STAT_INCREMENT_BY_QUALITY[record.equipment.quality];
    const attributeDelta = increment * (levelAfter - record.level);
    const updatedEquipment: EquipmentItem = {
      ...record.equipment,
      primaryValue: record.basePrimaryValue + increment * levelAfter,
    };
    const result: EquipmentEnhancementResult = {
      requestId: normalizedRequestId,
      equipmentId: record.equipment.equipmentId,
      outcome: success ? 'SUCCESS' : 'FAILURE',
      applied: true,
      idempotent: false,
      success,
      protected: protectedAttempt,
      downgraded: !success && !protectedAttempt && levelAfter < record.level,
      levelBefore: record.level,
      levelAfter,
      level: levelAfter,
      attributeDelta,
      equipment: updatedEquipment,
      materialCost: materialsSpent,
      materialsSpent,
      goldCost: cost.gold,
      successProbability: cost.successProbability,
      roll: normalizedRequest.roll,
      cost: { gold: cost.gold, materials: materialsSpent },
      resources: afterResources,
    };
    return this.transact((next) => {
      const index = next.equipment.findIndex((candidate) => candidate.equipment.equipmentId === record.equipment.equipmentId);
      if (index === -1) fail('EQUIPMENT_NOT_FOUND');
      next.equipment[index] = { equipment: updatedEquipment, level: levelAfter, basePrimaryValue: record.basePrimaryValue };
      next.resources = afterResources;
      next.processedRequests.push({ requestId: normalizedRequestId, fingerprint, result });
      return freezeResult(result);
    });
  }

  enhanceEquipment(
    requestIdOrRequest: string | EquipmentEnhancementRequest & { readonly requestId: unknown },
    requestOrEquipment?: EquipmentEnhancementRequest | string,
    options: Omit<EquipmentEnhancementRequest, 'equipmentId'> = {},
  ): EquipmentEnhancementResult {
    return this.enhance(requestIdOrRequest as never, requestOrEquipment as never, options);
  }

  private transact<T>(action: (next: MutableState) => T): T {
    if (this.committing) fail('PERSISTENCE_REENTRANT');
    const before = this.current;
    const next = cloneState(before);
    try {
      const result = action(next);
      const normalized = normalizeState(next);
      this.committing = true;
      try {
        this.persist(JSON.stringify(normalized));
      } catch (error) {
        fail('PERSISTENCE_FAILED', error);
      } finally {
        this.committing = false;
      }
      this.current = normalized;
      return result;
    } catch (error) {
      this.current = before;
      throw error;
    }
  }
}

export function createEquipmentEnhancementService(options: EquipmentEnhancementOptions = {}): EquipmentEnhancementService {
  return new EquipmentEnhancementService(options);
}

export function restoreEquipmentEnhancement(
  serialized: string,
  options: Omit<EquipmentEnhancementOptions, 'state' | 'equipment' | 'resources'> = {},
): EquipmentEnhancementService {
  return EquipmentEnhancementService.restore(serialized, options);
}

export function serializeEquipmentEnhancement(service: EquipmentEnhancementService): string {
  return service.save();
}
