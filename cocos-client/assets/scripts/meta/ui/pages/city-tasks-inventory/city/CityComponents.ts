import {
  CITY_BUILDING_IDS,
  type CityBuildingComponent,
  type CityBuildingData,
  type CityExpeditionComponent,
  type CityPageComponent,
  type CityPageData,
} from './CityContracts.ts';

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
  if (data.buildings.length === 0) {
    return Object.freeze([Object.freeze({
      id: 'city-empty' as const,
      kind: 'empty' as const,
      state: 'empty' as const,
      message: '当前没有可用的营造设施。',
    })]);
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
  const buildings = data.buildings
    .filter((building) => CITY_BUILDING_IDS.includes(building.id))
    .map((building) => buildingComponent(building, data, selected));
  const expedition = data.expedition === null ? [] : [expeditionComponent(data, now)];
  return Object.freeze([header, ...buildings, ...expedition]);
}
