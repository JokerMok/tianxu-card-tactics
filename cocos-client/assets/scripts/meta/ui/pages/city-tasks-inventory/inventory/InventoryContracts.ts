import {
  EQUIPMENT_PRIMARY_ATTRIBUTES,
  EQUIPMENT_QUALITIES,
  EQUIPMENT_SLOTS,
  type EquipmentInventoryState,
  type EquipmentItem,
  type EquipmentPrimaryAttribute,
  type EquipmentQuality,
  type EquipmentSlot,
  type EquipmentSort,
} from '../../../../equipment/index.ts';

export const INVENTORY_PAGE_SCHEMA_VERSION = 1 as const;

export interface InventoryPageData {
  readonly schemaVersion: typeof INVENTORY_PAGE_SCHEMA_VERSION;
  readonly title: string;
  readonly subtitle: string;
  readonly stateAvailable: boolean;
}

export interface InventoryFilter {
  readonly slot?: EquipmentSlot;
  readonly qualities?: readonly EquipmentQuality[];
  readonly locked?: boolean;
}

export type InventoryLocation = 'bag' | 'equipped';
export type InventoryEquipmentState = 'ready' | 'selected' | 'equipped';

export interface InventoryHeaderComponent {
  readonly id: 'header';
  readonly kind: 'header';
  readonly state: 'ready';
  readonly title: string;
  readonly subtitle: string;
  readonly totalItems: number;
  readonly visibleItems: number;
  readonly lockedItems: number;
  readonly equippedItems: number;
  readonly capacity: number;
  readonly usedCapacity: number;
  readonly availableCapacity: number;
  readonly selectedEquipmentId: string | null;
}

export interface InventoryFilterComponent {
  readonly id: 'filters';
  readonly kind: 'filters';
  readonly state: 'ready';
  readonly filter: InventoryFilter;
  readonly sort: EquipmentSort;
  readonly slots: readonly EquipmentSlot[];
  readonly qualities: readonly EquipmentQuality[];
  readonly primaryAttributes: readonly EquipmentPrimaryAttribute[];
}

export interface InventoryEquipmentComponent extends Omit<EquipmentItem, 'equipmentId'> {
  readonly id: `equipment-${string}`;
  readonly kind: 'equipment';
  readonly state: InventoryEquipmentState;
  readonly equipmentId: string;
  readonly location: InventoryLocation;
  readonly selected: boolean;
  readonly canEquip: boolean;
  readonly canUnequip: boolean;
  readonly canSell: boolean;
}

export interface InventorySlotComponent {
  readonly id: 'equipped-slots';
  readonly kind: 'slots';
  readonly state: 'ready';
  readonly slots: Readonly<Record<EquipmentSlot, InventoryEquipmentComponent | null>>;
}

export interface InventoryDetailComponent extends Omit<InventoryEquipmentComponent, 'id' | 'kind' | 'state' | 'selected'> {
  readonly id: 'detail';
  readonly kind: 'detail';
  readonly state: 'ready';
  readonly selected: true;
}

export interface InventoryEmptyComponent {
  readonly id: 'inventory-empty';
  readonly kind: 'empty';
  readonly state: 'empty';
  readonly reason: 'noItems' | 'filtered' | 'unavailable';
  readonly message: string;
}

export type InventoryPageComponent =
  | InventoryHeaderComponent
  | InventoryFilterComponent
  | InventoryEquipmentComponent
  | InventorySlotComponent
  | InventoryDetailComponent
  | InventoryEmptyComponent;

export interface InventoryPageState {
  readonly schemaVersion: typeof INVENTORY_PAGE_SCHEMA_VERSION;
  readonly selectedEquipmentId: string | null;
  readonly filter: InventoryFilter;
  readonly inventory: string;
}

export interface InventoryPageSnapshot {
  readonly schemaVersion: typeof INVENTORY_PAGE_SCHEMA_VERSION;
  readonly pageId: 'inventory';
  readonly selectedEquipmentId: string | null;
  readonly state: InventoryPageState | null;
  readonly components: readonly InventoryPageComponent[];
}

export type InventoryInteraction =
  | { readonly type: 'selectEquipment'; readonly equipmentId: string }
  | { readonly type: 'selectEquipmentAt'; readonly index: number }
  | { readonly type: 'setFilter'; readonly filter: unknown }
  | { readonly type: 'clearFilter' }
  | { readonly type: 'setSort'; readonly sort: unknown }
  | { readonly type: 'toggleLock'; readonly equipmentId: string; readonly locked?: boolean }
  | { readonly type: 'equip'; readonly equipmentId?: string }
  | { readonly type: 'unequip'; readonly slot: string }
  | { readonly type: 'sell'; readonly requestId: string; readonly equipmentId?: string };

export type InventoryInteractionReason =
  | 'selected'
  | 'same'
  | 'filtered'
  | 'locked'
  | 'unlocked'
  | 'equipped'
  | 'unequipped'
  | 'sold'
  | 'idempotent'
  | 'empty';

export interface InventoryInteractionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason: InventoryInteractionReason;
  readonly equipmentId: string | null;
  readonly slot?: EquipmentSlot | null;
  readonly totalValue?: number;
}

export interface InventoryPageServiceOptions {
  readonly data?: InventoryPageData;
  readonly inventory?: unknown;
  readonly capacity?: unknown;
  readonly initialState?: unknown;
  readonly onSave?: (serialized: string) => void;
  readonly persist?: (serialized: string) => void;
}

export const INVENTORY_DEFAULT_TITLE = '行囊';
export const INVENTORY_DEFAULT_SUBTITLE = '查看、装备与整理获得的装备';
export const INVENTORY_EMPTY_MESSAGE = '行囊中暂无装备。';
export const INVENTORY_FILTER_EMPTY_MESSAGE = '当前筛选条件下暂无装备。';

export const INVENTORY_FILTER_OPTIONS = Object.freeze({
  slots: EQUIPMENT_SLOTS,
  qualities: EQUIPMENT_QUALITIES,
  primaryAttributes: EQUIPMENT_PRIMARY_ATTRIBUTES,
});

export function createDefaultInventoryPageData(
  options: Partial<Pick<InventoryPageData, 'title' | 'subtitle'>> = {},
): InventoryPageData {
  return {
    schemaVersion: INVENTORY_PAGE_SCHEMA_VERSION,
    title: options.title ?? INVENTORY_DEFAULT_TITLE,
    subtitle: options.subtitle ?? INVENTORY_DEFAULT_SUBTITLE,
    stateAvailable: true,
  };
}

export function createEmptyInventoryPageData(): InventoryPageData {
  return {
    schemaVersion: INVENTORY_PAGE_SCHEMA_VERSION,
    title: INVENTORY_DEFAULT_TITLE,
    subtitle: '暂无可用行囊数据',
    stateAvailable: false,
  };
}

export type InventoryEquipmentStateSnapshot = EquipmentInventoryState;
