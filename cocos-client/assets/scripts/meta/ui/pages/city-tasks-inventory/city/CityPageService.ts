import {
  CITY_BUILDING_IDS,
  CITY_PAGE_SCHEMA_VERSION,
  createDefaultCityPageData,
  type CityBuildingId,
  type CityInteraction,
  type CityInteractionReason,
  type CityInteractionResult,
  type CityPageData,
  type CityPageServiceOptions,
  type CityPageSnapshot,
} from './CityContracts.ts';
import { createCityPageComponents, resolveCitySelectedBuildingId } from './CityComponents.ts';

export type CityPageErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_ARGUMENT'
  | 'INVALID_ID'
  | 'INVALID_NUMBER'
  | 'INVALID_DATA'
  | 'DUPLICATE_ID'
  | 'BUILDING_NOT_FOUND'
  | 'INDEX_OUT_OF_RANGE'
  | 'STATE_NOT_AVAILABLE';

export class CityPageError extends Error {
  readonly code: CityPageErrorCode;

  constructor(code: CityPageErrorCode, message: string) {
    super(message);
    this.name = 'CityPageError';
    this.code = code;
  }
}

function fail(code: CityPageErrorCode, message: string): never {
  throw new CityPageError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) fail('INVALID_ARGUMENT', `${label} must be a plain object`);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    const missing = allowed.find((key) => !actual.includes(key));
    fail(missing ? 'MISSING_FIELD' : 'INVALID_DATA', `${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) fail('INVALID_DATA', `${label} contains unsupported field: ${unknown}`);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail('INVALID_DATA', `${label} must be a non-empty string`);
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail('INVALID_NUMBER', `${label} must be a safe integer`);
}

function cloneData(data: CityPageData): CityPageData {
  return {
    schemaVersion: data.schemaVersion,
    title: data.title,
    subtitle: data.subtitle,
    resources: { ...data.resources },
    buildings: data.buildings.map((building) => ({ ...building, upgradeCost: { ...building.upgradeCost } })),
    expedition: data.expedition === null ? null : { ...data.expedition },
  };
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => deepFreeze(item))) as T;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) copy[key] = deepFreeze(child);
  return Object.freeze(copy) as T;
}

function validateData(input: CityPageData): CityPageData {
  assertRecord(input, 'city page data');
  assertExactKeys(input, ['schemaVersion', 'title', 'subtitle', 'resources', 'buildings', 'expedition'], 'city page data');
  if (input.schemaVersion !== CITY_PAGE_SCHEMA_VERSION) fail('INVALID_DATA', 'unsupported city page schema version');
  assertNonEmptyString(input.title, 'city page title');
  assertNonEmptyString(input.subtitle, 'city page subtitle');
  assertRecord(input.resources, 'city page resources');
  assertExactKeys(input.resources, ['silver', 'crystal', 'stamina', 'staminaMax'], 'city page resources');
  for (const key of ['silver', 'crystal', 'stamina', 'staminaMax']) {
    assertSafeInteger(input.resources[key], `city page resources.${key}`);
    if (input.resources[key] < 0) fail('INVALID_DATA', `city page resources.${key} cannot be negative`);
  }
  if (input.resources.stamina > input.resources.staminaMax) fail('INVALID_DATA', 'stamina cannot exceed staminaMax');
  if (!Array.isArray(input.buildings)) fail('INVALID_ARGUMENT', 'city page buildings must be an array');
  const ids = new Set<string>();
  input.buildings.forEach((building, index) => {
    assertRecord(building, `city page buildings[${index}]`);
    assertExactKeys(building, ['id', 'title', 'description', 'level', 'maxLevel', 'upgradeCost'], `city page buildings[${index}]`);
    if (!CITY_BUILDING_IDS.includes(building.id as CityBuildingId)) fail('INVALID_ID', `unknown city building: ${String(building.id)}`);
    if (ids.has(building.id as string)) fail('DUPLICATE_ID', `duplicate city building: ${String(building.id)}`);
    ids.add(building.id as string);
    assertNonEmptyString(building.title, `city page buildings[${index}].title`);
    assertNonEmptyString(building.description, `city page buildings[${index}].description`);
    assertSafeInteger(building.level, `city page buildings[${index}].level`);
    assertSafeInteger(building.maxLevel, `city page buildings[${index}].maxLevel`);
    if (building.level <= 0 || building.maxLevel < building.level) fail('INVALID_DATA', `city page buildings[${index}] levels are out of range`);
    assertRecord(building.upgradeCost, `city page buildings[${index}].upgradeCost`);
    assertExactKeys(building.upgradeCost, ['silver', 'crystal'], `city page buildings[${index}].upgradeCost`);
    assertSafeInteger(building.upgradeCost.silver, `city page buildings[${index}].upgradeCost.silver`);
    assertSafeInteger(building.upgradeCost.crystal, `city page buildings[${index}].upgradeCost.crystal`);
    if (building.upgradeCost.silver <= 0 || building.upgradeCost.crystal <= 0) fail('INVALID_DATA', `city page buildings[${index}] costs must be positive`);
  });
  if (input.buildings.length !== 0 && input.buildings.length !== CITY_BUILDING_IDS.length) {
    fail('INVALID_DATA', 'a non-empty city page must contain all configured buildings');
  }
  if (input.expedition !== null) {
    assertRecord(input.expedition, 'city page expedition');
    assertExactKeys(input.expedition, ['active', 'endsAt', 'rewardSilver', 'staminaCost', 'durationMs'], 'city page expedition');
    if (typeof input.expedition.active !== 'boolean') fail('INVALID_DATA', 'expedition.active must be boolean');
    for (const key of ['endsAt', 'rewardSilver', 'staminaCost', 'durationMs']) {
      assertSafeInteger(input.expedition[key], `city page expedition.${key}`);
    }
    if (input.expedition.endsAt < 0 || input.expedition.rewardSilver <= 0 || input.expedition.staminaCost <= 0 || input.expedition.durationMs <= 0) {
      fail('INVALID_DATA', 'expedition values are out of range');
    }
    if (!input.expedition.active && input.expedition.endsAt !== 0) fail('INVALID_DATA', 'inactive expedition must have endsAt 0');
  }
  return cloneData(input);
}

function result(
  accepted: boolean,
  changed: boolean,
  reason: CityInteractionReason,
  buildingId: CityBuildingId | null = null,
): CityInteractionResult {
  return Object.freeze({ accepted, changed, reason, buildingId });
}

function nowValue(value: unknown): number {
  if (value === undefined) return Date.now();
  assertSafeInteger(value, 'interaction now');
  if (value < 0) fail('INVALID_DATA', 'interaction now cannot be negative');
  return value;
}

export class CityPageService {
  private data: CityPageData;
  private selectedBuildingId: CityBuildingId | null;
  private readonly saveCallbacks: readonly ((serialized: string) => void)[];

  constructor(input: CityPageData | CityPageServiceOptions = {}) {
    const options: CityPageServiceOptions = isRecord(input) && Object.prototype.hasOwnProperty.call(input, 'schemaVersion')
      ? { data: input as CityPageData }
      : input as CityPageServiceOptions;
    assertRecord(options, 'city page options');
    assertAllowedKeys(options, ['data', 'state', 'initialSelectedBuildingId', 'onSave', 'persist'], 'city page options');
    if (options.data !== undefined && options.state !== undefined) fail('INVALID_ARGUMENT', 'city data and game state cannot be combined');
    this.data = validateData(options.data ?? createDefaultCityPageData(options.state));
    const selected = options.initialSelectedBuildingId ?? null;
    if (selected !== null && !CITY_BUILDING_IDS.includes(selected as CityBuildingId)) fail('INVALID_ID', `unknown selected city building: ${selected}`);
    this.selectedBuildingId = resolveCitySelectedBuildingId(this.data, selected) as CityBuildingId | null;
    this.saveCallbacks = Object.freeze([options.onSave, options.persist].filter((callback): callback is (serialized: string) => void => callback !== undefined));
  }

  get pageData(): CityPageData {
    return deepFreeze(cloneData(this.data));
  }

  snapshot(now: number = Date.now()): CityPageSnapshot {
    const timestamp = nowValue(now);
    return deepFreeze({
      schemaVersion: CITY_PAGE_SCHEMA_VERSION,
      pageId: 'city' as const,
      selectedBuildingId: this.selectedBuildingId,
      components: createCityPageComponents(this.data, this.selectedBuildingId, timestamp),
    });
  }

  selectBuilding(buildingId: string): CityInteractionResult {
    if (!CITY_BUILDING_IDS.includes(buildingId as CityBuildingId)) fail('INVALID_ID', `unknown city building: ${buildingId}`);
    if (this.data.buildings.length === 0) return result(false, false, 'empty');
    const id = buildingId as CityBuildingId;
    if (this.selectedBuildingId === id) return result(true, false, 'same', id);
    this.selectedBuildingId = id;
    return result(true, true, 'selected', id);
  }

  selectBuildingAt(index: number): CityInteractionResult {
    if (this.data.buildings.length === 0) return result(false, false, 'empty');
    assertSafeInteger(index, 'city building index');
    if (index < 0 || index >= this.data.buildings.length) fail('INDEX_OUT_OF_RANGE', `city building index out of range: ${index}`);
    return this.selectBuilding(this.data.buildings[index]!.id);
  }

  upgradeBuilding(buildingId: string = this.selectedBuildingId ?? ''): CityInteractionResult {
    if (!CITY_BUILDING_IDS.includes(buildingId as CityBuildingId)) fail('INVALID_ID', `unknown city building: ${buildingId}`);
    const id = buildingId as CityBuildingId;
    if (this.data.buildings.length === 0) return result(false, false, 'empty', null);
    const building = this.data.buildings.find((entry) => entry.id === id);
    if (building === undefined) fail('BUILDING_NOT_FOUND', `city building is not available: ${id}`);
    this.selectedBuildingId = id;
    if (building.level >= building.maxLevel) return result(false, false, 'maxed', id);
    if (this.data.resources.silver < building.upgradeCost.silver || this.data.resources.crystal < building.upgradeCost.crystal) {
      return result(false, false, 'insufficient', id);
    }
    this.data.resources.silver -= building.upgradeCost.silver;
    this.data.resources.crystal -= building.upgradeCost.crystal;
    const nextLevel = building.level + 1;
    const nextCastleLevel = id === 'castle' ? nextLevel : this.data.buildings.find((entry) => entry.id === 'castle')!.level;
    this.data.buildings = this.data.buildings.map((entry) => ({
      ...entry,
      level: entry.id === id ? nextLevel : entry.level,
      maxLevel: nextCastleLevel + (entry.id === 'castle' ? 1 : 0),
      upgradeCost: {
        silver: (entry.id === id ? nextLevel : entry.level) * 1_400,
        crystal: (entry.id === id ? nextLevel : entry.level) * 40,
      },
    }));
    this.persist();
    return result(true, true, 'upgraded', id);
  }

  dispatchExpedition(now: number = Date.now()): CityInteractionResult {
    const expedition = this.data.expedition;
    if (expedition === null) return result(false, false, 'empty');
    const timestamp = nowValue(now);
    if (expedition.active) return result(false, false, 'active');
    if (this.data.resources.stamina < expedition.staminaCost) return result(false, false, 'insufficient');
    this.data.resources.stamina -= expedition.staminaCost;
    this.data.expedition = { ...expedition, active: true, endsAt: timestamp + expedition.durationMs };
    this.persist();
    return result(true, true, 'dispatched');
  }

  claimExpedition(now: number = Date.now()): CityInteractionResult {
    const expedition = this.data.expedition;
    if (expedition === null) return result(false, false, 'empty');
    const timestamp = nowValue(now);
    if (!expedition.active) return result(false, false, 'idle');
    if (timestamp < expedition.endsAt) return result(false, false, 'active');
    this.data.resources.silver += expedition.rewardSilver;
    this.data.expedition = { ...expedition, active: false, endsAt: 0 };
    this.persist();
    return result(true, true, 'claimed');
  }

  interact(action: CityInteraction): CityInteractionResult {
    if (!isRecord(action) || typeof action.type !== 'string') fail('INVALID_ARGUMENT', 'city interaction must contain a type');
    switch (action.type) {
      case 'selectBuilding': return this.selectBuilding(action.buildingId);
      case 'selectBuildingAt': return this.selectBuildingAt(action.index);
      case 'upgradeBuilding': return this.upgradeBuilding(action.buildingId);
      case 'dispatchExpedition': return this.dispatchExpedition(action.now);
      case 'claimExpedition': return this.claimExpedition(action.now);
      default: fail('INVALID_ARGUMENT', `unknown city interaction: ${action.type}`);
    }
  }

  private persist(): void {
    if (this.saveCallbacks.length === 0) return;
    const serialized = JSON.stringify(this.data);
    for (const callback of this.saveCallbacks) callback(serialized);
  }
}
