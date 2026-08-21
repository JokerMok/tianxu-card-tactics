import {
  CITY_BUILDING_IDS,
  CityPageError,
  type CityBuildingComponent,
  type CityBuildingData,
  type CityExpeditionComponent,
  type CityPageComponent,
  type CityPageData,
} from './CityContracts.ts';

function fail(code: ConstructorParameters<typeof CityPageError>[0], message: string): never {
  throw new CityPageError(code, message);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertSafeTime(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value >= Number.MAX_SAFE_INTEGER) {
    fail('INVALID_NUMBER', `${label} must be below Number.MAX_SAFE_INTEGER`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    fail('INVALID_DATA', `${label} has an invalid shape`);
  }
}

function assertComponentData(data: CityPageData, now: number): void {
  if (!isPlainRecord(data)) fail('INVALID_ARGUMENT', 'city page data must be a plain object');
  assertExactKeys(data, ['schemaVersion', 'title', 'subtitle', 'resources', 'buildings', 'expedition'], 'city page data');
  if (data.schemaVersion !== 1) fail('INVALID_DATA', 'unsupported city page schema version');
  if (typeof data.title !== 'string' || data.title.trim().length === 0 || typeof data.subtitle !== 'string' || data.subtitle.trim().length === 0) {
    fail('INVALID_DATA', 'city page title and subtitle are required');
  }
  if (!isPlainRecord(data.resources)) fail('INVALID_DATA', 'city page resources must be a plain object');
  assertExactKeys(data.resources, ['silver', 'crystal', 'stamina', 'staminaMax'], 'city page resources');
  for (const key of ['silver', 'crystal', 'stamina', 'staminaMax'] as const) {
    const value = data.resources[key];
    if (!Number.isSafeInteger(value) || value < 0) fail('INVALID_DATA', `city page resources.${key} is invalid`);
  }
  if (data.resources.stamina > data.resources.staminaMax) fail('INVALID_DATA', 'stamina cannot exceed staminaMax');
  if (!Array.isArray(data.buildings)) fail('INVALID_DATA', 'city page buildings must be an array');
  const ids = new Set<string>();
  for (const [index, building] of data.buildings.entries()) {
    if (!isPlainRecord(building)) fail('INVALID_DATA', `city page buildings[${index}] must be a plain object`);
    assertExactKeys(building, ['id', 'title', 'description', 'level', 'maxLevel', 'upgradeCost'], `city page buildings[${index}]`);
    if (!CITY_BUILDING_IDS.includes(building.id as (typeof CITY_BUILDING_IDS)[number])) {
      fail('INVALID_ID', `unknown city building: ${String(building.id)}`);
    }
    if (ids.has(building.id as string)) fail('DUPLICATE_ID', `duplicate city building: ${String(building.id)}`);
    ids.add(building.id as string);
    if (typeof building.title !== 'string' || building.title.trim().length === 0
      || typeof building.description !== 'string' || building.description.trim().length === 0) {
      fail('INVALID_DATA', `city page buildings[${index}] text is invalid`);
    }
    if (!Number.isSafeInteger(building.level) || !Number.isSafeInteger(building.maxLevel)
      || building.level <= 0 || building.maxLevel < building.level) {
      fail('INVALID_DATA', `city page buildings[${index}] levels are invalid`);
    }
    if (!isPlainRecord(building.upgradeCost)) fail('INVALID_DATA', `city page buildings[${index}] upgrade cost is invalid`);
    assertExactKeys(building.upgradeCost, ['silver', 'crystal'], `city page buildings[${index}].upgradeCost`);
    if (!isPlainRecord(building.upgradeCost)
      || !Number.isSafeInteger(building.upgradeCost.silver) || building.upgradeCost.silver <= 0
      || !Number.isSafeInteger(building.upgradeCost.crystal) || building.upgradeCost.crystal <= 0) {
      fail('INVALID_DATA', `city page buildings[${index}] upgrade cost is invalid`);
    }
  }
  if (data.buildings.length !== 0 && data.buildings.length !== CITY_BUILDING_IDS.length) {
    fail('INVALID_DATA', 'a non-empty city page must contain all configured buildings');
  }
  if (data.expedition !== null) {
    if (!isPlainRecord(data.expedition)) fail('INVALID_DATA', 'city page expedition must be a plain object or null');
    assertExactKeys(data.expedition, ['active', 'endsAt', 'rewardSilver', 'staminaCost', 'durationMs'], 'city page expedition');
    if (typeof data.expedition.active !== 'boolean') fail('INVALID_DATA', 'expedition.active must be boolean');
    for (const key of ['endsAt', 'rewardSilver', 'staminaCost', 'durationMs'] as const) {
      if (!Number.isSafeInteger(data.expedition[key])) fail('INVALID_NUMBER', `city page expedition.${key} is invalid`);
    }
    if (data.expedition.endsAt < 0 || data.expedition.endsAt >= Number.MAX_SAFE_INTEGER
      || data.expedition.rewardSilver <= 0 || data.expedition.staminaCost <= 0 || data.expedition.durationMs <= 0
      || (!data.expedition.active && data.expedition.endsAt !== 0)) {
      fail('INVALID_DATA', 'city page expedition values are invalid');
    }
    if (data.expedition.active && data.expedition.endsAt === 0) {
      fail('INVALID_DATA', 'active expedition must have a positive endsAt');
    }
  }
  assertSafeTime(now, 'city snapshot time');
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => deepFreeze(item))) as T;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) copy[key] = deepFreeze(child);
  return Object.freeze(copy) as T;
}

function buildingState(
  building: CityBuildingData,
  silver: number,
  crystal: number,
  selected: boolean,
): CityBuildingComponent['state'] {
  if (building.level >= building.maxLevel) return 'maxed';
  if (silver < building.upgradeCost.silver || crystal < building.upgradeCost.crystal) return 'insufficient';
  return selected ? 'selected' : 'ready';
}

function buildingComponent(
  building: CityBuildingData,
  data: CityPageData,
  selectedBuildingId: CityPageData['buildings'][number]['id'] | null,
): CityBuildingComponent {
  const selected = selectedBuildingId === building.id;
  return Object.freeze({
    ...building,
    id: `building-${building.id}` as `building-${typeof building.id}`,
    kind: 'building' as const,
    state: buildingState(building, data.resources.silver, data.resources.crystal, selected),
    buildingId: building.id,
    selected,
    canUpgrade: building.level < building.maxLevel
      && data.resources.silver >= building.upgradeCost.silver
      && data.resources.crystal >= building.upgradeCost.crystal,
  });
}

function expeditionComponent(data: CityPageData, now: number): CityExpeditionComponent {
  const expedition = data.expedition!;
  const claimable = expedition.active && expedition.endsAt <= now;
  return Object.freeze({
    ...expedition,
    id: 'expedition' as const,
    kind: 'expedition' as const,
    state: claimable ? 'claimable' as const : expedition.active ? 'active' as const : 'idle' as const,
    canDispatch: !expedition.active && data.resources.stamina >= expedition.staminaCost,
    canClaim: claimable,
  });
}

export function resolveCitySelectedBuildingId(data: CityPageData, selectedBuildingId: string | null): CityPageData['buildings'][number]['id'] | null {
  if (data.buildings.length === 0) return null;
  return selectedBuildingId !== null && data.buildings.some((building) => building.id === selectedBuildingId)
    ? selectedBuildingId as CityPageData['buildings'][number]['id']
    : data.buildings[0]!.id;
}

export function createCityPageComponents(
  data: CityPageData,
  selectedBuildingId: CityPageData['buildings'][number]['id'] | null = null,
  now: number = Date.now(),
): readonly CityPageComponent[] {
  assertComponentData(data, now);
  if (selectedBuildingId !== null && !CITY_BUILDING_IDS.includes(selectedBuildingId)) {
    fail('INVALID_ID', `unknown selected city building: ${selectedBuildingId}`);
  }
  if (data.buildings.length === 0) {
    return deepFreeze([{
      id: 'city-empty' as const,
      kind: 'empty' as const,
      state: 'empty' as const,
      message: '当前没有可用的营造设施。',
    }]);
  }

  const selected = resolveCitySelectedBuildingId(data, selectedBuildingId);
  const header = Object.freeze({
    id: 'header' as const,
    kind: 'header' as const,
    state: 'ready' as const,
    title: data.title,
    subtitle: data.subtitle,
    silver: data.resources.silver,
    crystal: data.resources.crystal,
    stamina: data.resources.stamina,
    staminaMax: data.resources.staminaMax,
    selectedBuildingId: selected,
  });
  const buildings = data.buildings.map((building) => buildingComponent(building, data, selected));
  const expedition = data.expedition === null ? [] : [expeditionComponent(data, now)];
  return deepFreeze([header, ...buildings, ...expedition]);
}
