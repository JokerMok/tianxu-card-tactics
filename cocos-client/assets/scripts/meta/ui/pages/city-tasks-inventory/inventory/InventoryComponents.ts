import {
  INVENTORY_EMPTY_MESSAGE,
  INVENTORY_FILTER_EMPTY_MESSAGE,
  INVENTORY_FILTER_OPTIONS,
  type InventoryDetailComponent,
  type InventoryEmptyComponent,
  type InventoryEquipmentComponent,
  type InventoryFilter,
  type InventoryFilterComponent,
  type InventoryHeaderComponent,
  type InventoryPageComponent,
  type InventoryPageData,
  type InventorySlotComponent,
} from './InventoryContracts.ts';
import {
  EQUIPMENT_SLOTS,
  type EquipmentInventoryState,
  type EquipmentItem,
  type EquipmentSlot,
  type EquipmentSort,
} from '../../../../equipment/index.ts';

export interface InventoryComponentProjection {
  readonly inventory: EquipmentInventoryState;
  readonly filter: InventoryFilter;
  readonly selectedEquipmentId: string | null;
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function equippedIds(inventory: EquipmentInventoryState): ReadonlySet<string> {
  return new Set(EQUIPMENT_SLOTS.flatMap((slot) => {
    const item = inventory.equipped[slot];
    return item === null ? [] : [item.equipmentId];
  }));
}

function matches(item: EquipmentItem, filter: InventoryFilter): boolean {
  if (filter.slot !== undefined && item.slot !== filter.slot) return false;
  if (filter.qualities !== undefined && !filter.qualities.includes(item.quality)) return false;
  if (filter.locked !== undefined && item.locked !== filter.locked) return false;
  return true;
}

function sortedItems(items: readonly EquipmentItem[], sort: EquipmentSort): readonly EquipmentItem[] {
  return items.map((item, index) => ({ item, index })).sort((left, right) => {
    let leftValue: string | number | boolean;
    let rightValue: string | number | boolean;
    switch (sort.field) {
      case 'equipmentId': leftValue = left.item.equipmentId; rightValue = right.item.equipmentId; break;
      case 'slot': leftValue = left.item.slot; rightValue = right.item.slot; break;
      case 'quality': leftValue = left.item.quality; rightValue = right.item.quality; break;
      case 'primaryAttribute': leftValue = left.item.primaryAttribute; rightValue = right.item.primaryAttribute; break;
      case 'primaryValue': leftValue = left.item.primaryValue; rightValue = right.item.primaryValue; break;
      case 'locked': leftValue = left.item.locked; rightValue = right.item.locked; break;
    }
    const comparison = leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
    if (comparison !== 0) return sort.direction === 'asc' ? comparison : -comparison;
    return left.index - right.index;
  }).map(({ item }) => item);
}

function componentForItem(item: EquipmentItem, selectedEquipmentId: string | null, location: 'bag' | 'equipped'): InventoryEquipmentComponent {
  const selected = item.equipmentId === selectedEquipmentId;
  return deepFreeze({
    id: `equipment-${item.equipmentId}` as `equipment-${string}`,
    kind: 'equipment',
    state: location === 'equipped' ? 'equipped' : selected ? 'selected' : 'ready',
    equipmentId: item.equipmentId,
    slot: item.slot,
    quality: item.quality,
    primaryAttribute: item.primaryAttribute,
    primaryValue: item.primaryValue,
    locked: item.locked,
    location,
    selected,
    canEquip: location === 'bag',
    canUnequip: location === 'equipped',
    canSell: location === 'bag' && !item.locked,
  });
}

function headerComponent(data: InventoryPageData, projection: InventoryComponentProjection, visible: readonly EquipmentItem[]): InventoryHeaderComponent {
  const equipped = EQUIPMENT_SLOTS.filter((slot) => projection.inventory.equipped[slot] !== null).length;
  return deepFreeze({
    id: 'header',
    kind: 'header',
    state: 'ready',
    title: data.title,
    subtitle: data.subtitle,
    totalItems: projection.inventory.items.length,
    visibleItems: visible.length,
    lockedItems: projection.inventory.items.filter((item) => item.locked).length,
    equippedItems: equipped,
    capacity: projection.inventory.capacity,
    usedCapacity: projection.inventory.items.length,
    availableCapacity: projection.inventory.capacity - projection.inventory.items.length,
    selectedEquipmentId: projection.selectedEquipmentId,
  });
}

function filtersComponent(filter: InventoryFilter, sort: EquipmentSort): InventoryFilterComponent {
  return deepFreeze({
    id: 'filters',
    kind: 'filters',
    state: 'ready',
    filter,
    sort,
    slots: INVENTORY_FILTER_OPTIONS.slots,
    qualities: INVENTORY_FILTER_OPTIONS.qualities,
    primaryAttributes: INVENTORY_FILTER_OPTIONS.primaryAttributes,
  });
}

function slotComponent(inventory: EquipmentInventoryState, selectedEquipmentId: string | null): InventorySlotComponent {
  const slots = {} as Record<EquipmentSlot, InventoryEquipmentComponent | null>;
  for (const slot of EQUIPMENT_SLOTS) {
    const item = inventory.equipped[slot];
    slots[slot] = item === null ? null : componentForItem(item, selectedEquipmentId, 'equipped');
  }
  return deepFreeze({ id: 'equipped-slots', kind: 'slots', state: 'ready', slots });
}

function detailComponent(item: EquipmentItem, selectedEquipmentId: string, location: 'bag' | 'equipped'): InventoryDetailComponent {
  const component = componentForItem(item, selectedEquipmentId, location);
  return deepFreeze({ ...component, id: 'detail', kind: 'detail', state: 'ready', selected: true });
}

function emptyComponent(reason: InventoryEmptyComponent['reason']): InventoryEmptyComponent {
  return deepFreeze({
    id: 'inventory-empty',
    kind: 'empty',
    state: 'empty',
    reason,
    message: reason === 'filtered' ? INVENTORY_FILTER_EMPTY_MESSAGE : INVENTORY_EMPTY_MESSAGE,
  });
}

export function projectVisibleInventoryItems(
  inventory: EquipmentInventoryState,
  filter: InventoryFilter,
): readonly EquipmentItem[] {
  return inventory.items.filter((item) => matches(item, filter));
}

export function createInventoryPageComponents(
  data: InventoryPageData,
  projection: InventoryComponentProjection | null,
): readonly InventoryPageComponent[] {
  if (!data.stateAvailable || projection === null) return Object.freeze([emptyComponent('unavailable')]);
  const visible = sortedItems(projectVisibleInventoryItems(projection.inventory, projection.filter), projection.inventory.sort);
  const components: InventoryPageComponent[] = [
    headerComponent(data, projection, visible),
    filtersComponent(projection.filter, projection.inventory.sort),
    slotComponent(projection.inventory, projection.selectedEquipmentId),
    ...visible.map((item) => componentForItem(item, projection.selectedEquipmentId, 'bag')),
  ];
  const selected = projection.selectedEquipmentId === null ? null
    : projection.inventory.items.find((item) => item.equipmentId === projection.selectedEquipmentId)
      ?? EQUIPMENT_SLOTS.map((slot) => projection.inventory.equipped[slot]).find((item) => item?.equipmentId === projection.selectedEquipmentId)
      ?? null;
  if (selected !== null) {
    const isEquipped = equippedIds(projection.inventory).has(selected.equipmentId);
    if (isEquipped || visible.some((item) => item.equipmentId === selected.equipmentId)) {
      components.push(detailComponent(selected, projection.selectedEquipmentId, isEquipped ? 'equipped' : 'bag'));
    }
  }
  if (visible.length === 0) components.push(emptyComponent(projection.inventory.items.length === 0 ? 'noItems' : 'filtered'));
  return deepFreeze(components);
}

export function inventorySortForProjection(inventory: EquipmentInventoryState): EquipmentSort {
  return inventory.sort;
}
