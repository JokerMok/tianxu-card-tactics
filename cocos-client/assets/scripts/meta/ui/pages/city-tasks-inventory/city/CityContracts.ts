import { createDefaultState, type GameState } from '../../../../GameState.ts';

export type CityPageErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_ARGUMENT'
  | 'INVALID_ID'
  | 'INVALID_NUMBER'
  | 'INVALID_DATA'
  | 'DUPLICATE_ID'
  | 'BUILDING_NOT_FOUND'
  | 'INDEX_OUT_OF_RANGE'
  | 'STATE_NOT_AVAILABLE'
  | 'PERSISTENCE_FAILED'
  | 'REENTRANT';

export class CityPageError extends Error {
  readonly code: CityPageErrorCode;
  readonly reason: CityPageErrorCode;
  readonly cause?: unknown;

  constructor(code: CityPageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'CityPageError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export const CITY_PAGE_SCHEMA_VERSION = 1 as const;
export const CITY_BUILDING_IDS = Object.freeze(['castle', 'alchemy', 'forge', 'harbor'] as const);
export type CityBuildingId = (typeof CITY_BUILDING_IDS)[number];

export interface CityCost {
  readonly silver: number;
  readonly crystal: number;
}

export interface CityBuildingData {
  readonly id: CityBuildingId;
  readonly title: string;
  readonly description: string;
  readonly level: number;
  readonly maxLevel: number;
  readonly upgradeCost: CityCost;
}

export interface CityResourcesData {
  readonly silver: number;
  readonly crystal: number;
  readonly stamina: number;
  readonly staminaMax: number;
}

export interface CityExpeditionData {
  readonly active: boolean;
  readonly endsAt: number;
  readonly rewardSilver: number;
  readonly staminaCost: number;
  readonly durationMs: number;
}

export interface CityPageData {
  readonly schemaVersion: typeof CITY_PAGE_SCHEMA_VERSION;
  readonly title: string;
  readonly subtitle: string;
  readonly resources: CityResourcesData;
  readonly buildings: readonly CityBuildingData[];
  readonly expedition: CityExpeditionData | null;
}

export type CityBuildingComponentState = 'ready' | 'selected' | 'maxed' | 'insufficient';
export type CityExpeditionComponentState = 'idle' | 'active' | 'claimable';

export interface CityHeaderComponent {
  readonly id: 'header';
  readonly kind: 'header';
  readonly state: 'ready';
  readonly title: string;
  readonly subtitle: string;
  readonly silver: number;
  readonly crystal: number;
  readonly stamina: number;
  readonly staminaMax: number;
  readonly selectedBuildingId: CityBuildingId | null;
}

export interface CityBuildingComponent extends Omit<CityBuildingData, 'id'> {
  readonly id: `building-${CityBuildingId}`;
  readonly kind: 'building';
  readonly state: CityBuildingComponentState;
  readonly buildingId: CityBuildingId;
  readonly selected: boolean;
  readonly canUpgrade: boolean;
}

export interface CityExpeditionComponent extends CityExpeditionData {
  readonly id: 'expedition';
  readonly kind: 'expedition';
  readonly state: CityExpeditionComponentState;
  readonly canDispatch: boolean;
  readonly canClaim: boolean;
}

export interface CityEmptyComponent {
  readonly id: 'city-empty';
  readonly kind: 'empty';
  readonly state: 'empty';
  readonly message: string;
}

export type CityPageComponent = CityHeaderComponent | CityBuildingComponent | CityExpeditionComponent | CityEmptyComponent;

export interface CityPageSnapshot {
  readonly schemaVersion: typeof CITY_PAGE_SCHEMA_VERSION;
  readonly pageId: 'city';
  readonly selectedBuildingId: CityBuildingId | null;
  readonly components: readonly CityPageComponent[];
}

export type CityInteraction =
  | { readonly type: 'selectBuilding'; readonly buildingId: string }
  | { readonly type: 'selectBuildingAt'; readonly index: number }
  | { readonly type: 'upgradeBuilding'; readonly buildingId?: string }
  | { readonly type: 'dispatchExpedition'; readonly now?: number }
  | { readonly type: 'claimExpedition'; readonly now?: number };

export type CityInteractionReason =
  | 'selected'
  | 'same'
  | 'upgraded'
  | 'maxed'
  | 'insufficient'
  | 'dispatched'
  | 'active'
  | 'claimable'
  | 'claimed'
  | 'idle'
  | 'empty';

export interface CityInteractionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason: CityInteractionReason;
  readonly buildingId: CityBuildingId | null;
}

export interface CityPageServiceOptions {
  readonly data?: CityPageData;
  readonly state?: GameState;
  readonly initialSelectedBuildingId?: string | null;
  readonly onSave?: (serialized: string) => void;
  readonly persist?: (serialized: string) => void;
  /** State-boundary hook reserved for the later production integration. */
  readonly onStateChange?: (state: GameState) => void;
}

export const CITY_BUILDING_DEFINITIONS: Readonly<Record<CityBuildingId, { readonly title: string; readonly description: string }>> = Object.freeze({
  castle: Object.freeze({ title: '主堡', description: '提高玩家等级上限与每日税收' }),
  alchemy: Object.freeze({ title: '炼金房', description: '卡牌升品、分解与配方熔炼' }),
  forge: Object.freeze({ title: '铁匠铺', description: '装备强化、合成与保护' }),
  harbor: Object.freeze({ title: '远征港口', description: '派遣队伍获得离线资源' }),
});

export const CITY_EXPEDITION_STAMINA_COST = 10 as const;
export const CITY_EXPEDITION_DURATION_MS = 60_000 as const;
export const CITY_EXPEDITION_REWARD_SILVER = 1_600 as const;

function assertValidGameStateExpedition(expedition: GameState['expedition']): void {
  if (typeof expedition.active !== 'boolean'
    || !Number.isSafeInteger(expedition.endsAt)
    || !Number.isSafeInteger(expedition.reward)
    || expedition.endsAt < 0
    || expedition.endsAt >= Number.MAX_SAFE_INTEGER
    || expedition.reward < 0) {
    throw new CityPageError('INVALID_DATA', 'game state expedition values are invalid');
  }
  if (expedition.active && (expedition.endsAt === 0 || expedition.reward === 0)) {
    throw new CityPageError('INVALID_DATA', 'active expedition must have a positive endsAt and reward');
  }
  if (!expedition.active && (expedition.endsAt !== 0 || expedition.reward !== 0)) {
    throw new CityPageError('INVALID_DATA', 'inactive expedition must have endsAt and reward 0');
  }
}

function freeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => freeze(item))) as T;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) copy[key] = freeze(child);
  return Object.freeze(copy) as T;
}

export function createDefaultCityPageData(state: GameState = createDefaultState()): CityPageData {
  assertValidGameStateExpedition(state.expedition);
  const castleLevel = state.buildings.castle;
  const buildings = CITY_BUILDING_IDS.map((id) => {
    const level = state.buildings[id];
    const maxLevel = castleLevel + (id === 'castle' ? 1 : 0);
    return {
      id,
      title: CITY_BUILDING_DEFINITIONS[id].title,
      description: CITY_BUILDING_DEFINITIONS[id].description,
      level,
      maxLevel,
      upgradeCost: { silver: level * 1_400, crystal: level * 40 },
    };
  });
  return freeze({
    schemaVersion: CITY_PAGE_SCHEMA_VERSION,
    title: '营造与远征',
    subtitle: '主堡决定其他建筑上限，建筑产出只用于 PVE 养成。',
    resources: {
      silver: state.resources.silver,
      crystal: state.resources.crystal,
      stamina: state.resources.stamina,
      staminaMax: state.resources.staminaMax,
    },
    buildings,
    expedition: {
      active: state.expedition.active,
      endsAt: state.expedition.endsAt,
      rewardSilver: state.expedition.active ? state.expedition.reward : CITY_EXPEDITION_REWARD_SILVER,
      staminaCost: CITY_EXPEDITION_STAMINA_COST,
      durationMs: CITY_EXPEDITION_DURATION_MS,
    },
  });
}

export function createEmptyCityPageData(): CityPageData {
  return freeze({
    schemaVersion: CITY_PAGE_SCHEMA_VERSION,
    title: '营造与远征',
    subtitle: '暂无可用营造设施',
    resources: { silver: 0, crystal: 0, stamina: 0, staminaMax: 0 },
    buildings: [],
    expedition: null,
  });
}
