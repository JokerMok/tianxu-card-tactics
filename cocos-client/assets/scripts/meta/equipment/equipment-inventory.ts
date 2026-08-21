export const EQUIPMENT_INVENTORY_SCHEMA_VERSION = 1 as const;

export const EQUIPMENT_SLOTS = Object.freeze(['weapon', 'helmet', 'armor', 'cloak']) as readonly [
  'weapon',
  'helmet',
  'armor',
  'cloak',
];
export type EquipmentSlot = (typeof EQUIPMENT_SLOTS)[number];

export const EQUIPMENT_QUALITY_LEVELS = Object.freeze([1, 2, 3, 4]) as readonly [1, 2, 3, 4];
export const EQUIPMENT_QUALITIES = EQUIPMENT_QUALITY_LEVELS;
export type EquipmentQuality = (typeof EQUIPMENT_QUALITY_LEVELS)[number];

export const EQUIPMENT_PRIMARY_ATTRIBUTES = Object.freeze([
  'attack',
  'spellPower',
  'health',
  'armor',
  'damageReduction',
  'draw',
  'energy',
  'cooldown',
  'heroSkill',
  'tagUnitBoost',
]) as readonly [
  'attack',
  'spellPower',
  'health',
  'armor',
  'damageReduction',
  'draw',
  'energy',
  'cooldown',
  'heroSkill',
  'tagUnitBoost',
];
export type EquipmentPrimaryAttribute = (typeof EQUIPMENT_PRIMARY_ATTRIBUTES)[number];

export type EquipmentSortField =
  | 'equipmentId'
  | 'slot'
  | 'quality'
  | 'primaryAttribute'
  | 'primaryValue'
  | 'locked';
export type EquipmentSortDirection = 'asc' | 'desc';

export interface EquipmentItem {
  readonly equipmentId: string;
  readonly slot: EquipmentSlot;
  readonly quality: EquipmentQuality;
  readonly primaryAttribute: EquipmentPrimaryAttribute;
  readonly primaryValue: number;
  readonly locked: boolean;
}

export interface EquipmentSort {
  readonly field: EquipmentSortField;
  readonly direction: EquipmentSortDirection;
}

export interface EquippedSlots {
  readonly weapon: EquipmentItem | null;
  readonly helmet: EquipmentItem | null;
  readonly armor: EquipmentItem | null;
  readonly cloak: EquipmentItem | null;
}

export interface EquipmentProcessedRequest {
  readonly requestId: string;
  readonly fingerprint: string;
  readonly sold: readonly EquipmentItem[];
  readonly totalValue: number;
}

export interface EquipmentInventoryState {
  readonly schemaVersion: typeof EQUIPMENT_INVENTORY_SCHEMA_VERSION;
  readonly capacity: number;
  readonly items: readonly EquipmentItem[];
  readonly equipped: EquippedSlots;
  readonly sort: EquipmentSort;
  readonly processedRequests: readonly EquipmentProcessedRequest[];
}

export interface EquipmentInventoryOptions {
  readonly capacity?: unknown;
  readonly state?: unknown;
  readonly persist?: (serialized: string) => void;
  readonly onSave?: (serialized: string) => void;
}

export type EquipmentInput = unknown;

export type EquipmentInventoryErrorCode =
  | 'INVALID_CONFIG'
  | 'INVALID_STATE'
  | 'INVALID_EQUIPMENT'
  | 'INVALID_EQUIPMENT_ID'
  | 'INVALID_SLOT'
  | 'INVALID_QUALITY'
  | 'INVALID_PRIMARY_ATTRIBUTE'
  | 'INVALID_PRIMARY_VALUE'
  | 'INVALID_LOCKED'
  | 'INVALID_CAPACITY'
  | 'CAPACITY_EXCEEDED'
  | 'DUPLICATE_EQUIPMENT'
  | 'EQUIPMENT_NOT_FOUND'
  | 'EQUIPMENT_LOCKED'
  | 'EQUIPMENT_EQUIPPED'
  | 'INVALID_SORT'
  | 'INVALID_REQUEST_ID'
  | 'INVALID_REQUEST'
  | 'DUPLICATE_REQUEST'
  | 'REQUEST_CONFLICT'
  | 'INVALID_SLOT_STATE'
  | 'PERSISTENCE_FAILED'
  | 'PERSISTENCE_REENTRANT';

const SORT_FIELDS = Object.freeze([
  'equipmentId',
  'slot',
  'quality',
  'primaryAttribute',
  'primaryValue',
  'locked',
]) as readonly EquipmentSortField[];
const SLOT_SET = new Set<string>(EQUIPMENT_SLOTS);
const QUALITY_SET = new Set<number>(EQUIPMENT_QUALITY_LEVELS);
const ATTRIBUTE_SET = new Set<string>(EQUIPMENT_PRIMARY_ATTRIBUTES);
const ITEM_KEYS = new Set(['equipmentId', 'slot', 'quality', 'primaryAttribute', 'primaryValue', 'locked']);
const SORT_KEYS = new Set(['field', 'direction']);
const STATE_KEYS = new Set(['schemaVersion', 'capacity', 'items', 'equipped', 'sort', 'processedRequests']);
const EQUIPPED_KEYS = new Set(EQUIPMENT_SLOTS);
const PROCESSED_REQUEST_KEYS = new Set(['requestId', 'fingerprint', 'sold', 'totalValue']);
const REQUEST_ID_PATTERN = /^\S(?:.*\S)?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(value: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(code: EquipmentInventoryErrorCode, cause?: unknown): never {
  throw new EquipmentInventoryError(code, cause);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function assertExactKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, code: EquipmentInventoryErrorCode): void {
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.has(key)) fail(code);
  }
}

function assertRequiredKeys(value: Record<string, unknown>, keys: ReadonlySet<string>, code: EquipmentInventoryErrorCode): void {
  for (const key of keys) if (!hasOwn(value, key)) fail(code);
}

function normalizeEquipmentId(value: unknown, code: EquipmentInventoryErrorCode = 'INVALID_EQUIPMENT_ID'): string {
  if (!isText(value)) fail(code);
  return value;
}

function normalizeSlot(value: unknown, code: EquipmentInventoryErrorCode = 'INVALID_SLOT'): EquipmentSlot {
  if (typeof value !== 'string' || !SLOT_SET.has(value)) fail(code);
  return value as EquipmentSlot;
}

function normalizeQuality(value: unknown, code: EquipmentInventoryErrorCode = 'INVALID_QUALITY'): EquipmentQuality {
  if (typeof value !== 'number' || !QUALITY_SET.has(value)) fail(code);
  return value as EquipmentQuality;
}

function normalizePrimaryAttribute(
  value: unknown,
  code: EquipmentInventoryErrorCode = 'INVALID_PRIMARY_ATTRIBUTE',
): EquipmentPrimaryAttribute {
  if (typeof value !== 'string' || !ATTRIBUTE_SET.has(value)) fail(code);
  return value as EquipmentPrimaryAttribute;
}

function normalizePrimaryValue(value: unknown, code: EquipmentInventoryErrorCode = 'INVALID_PRIMARY_VALUE'): number {
  if (!isPositiveInteger(value)) fail(code);
  return value;
}

function normalizeItem(value: unknown, state = false): EquipmentItem {
  if (!isRecord(value)) fail(state ? 'INVALID_STATE' : 'INVALID_EQUIPMENT');
  const code: EquipmentInventoryErrorCode = state ? 'INVALID_STATE' : 'INVALID_EQUIPMENT';
  assertExactKeys(value, ITEM_KEYS, code);
  assertRequiredKeys(value, ITEM_KEYS, code);
  const equipmentId = normalizeEquipmentId(value.equipmentId, state ? 'INVALID_STATE' : 'INVALID_EQUIPMENT_ID');
  const slot = normalizeSlot(value.slot, state ? 'INVALID_STATE' : 'INVALID_SLOT');
  const quality = normalizeQuality(value.quality, state ? 'INVALID_STATE' : 'INVALID_QUALITY');
  const primaryAttribute = normalizePrimaryAttribute(
    value.primaryAttribute,
    state ? 'INVALID_STATE' : 'INVALID_PRIMARY_ATTRIBUTE',
  );
  const primaryValue = normalizePrimaryValue(value.primaryValue, state ? 'INVALID_STATE' : 'INVALID_PRIMARY_VALUE');
  if (typeof value.locked !== 'boolean') fail(state ? 'INVALID_STATE' : 'INVALID_LOCKED');
  return { equipmentId, slot, quality, primaryAttribute, primaryValue, locked: value.locked };
}

function normalizeNewItem(value: unknown): EquipmentItem {
  if (!isRecord(value)) fail('INVALID_EQUIPMENT');
  const addKeys = new Set(['equipmentId', 'slot', 'quality', 'primaryAttribute', 'primaryValue', 'locked']);
  assertExactKeys(value, addKeys, 'INVALID_EQUIPMENT');
  for (const key of ['equipmentId', 'slot', 'quality', 'primaryAttribute', 'primaryValue']) {
    if (!hasOwn(value, key)) fail('INVALID_EQUIPMENT');
  }
  if (value.locked !== undefined && typeof value.locked !== 'boolean') fail('INVALID_LOCKED');
  return {
    equipmentId: normalizeEquipmentId(value.equipmentId),
    slot: normalizeSlot(value.slot),
    quality: normalizeQuality(value.quality),
    primaryAttribute: normalizePrimaryAttribute(value.primaryAttribute),
    primaryValue: normalizePrimaryValue(value.primaryValue),
    locked: value.locked === undefined ? false : value.locked,
  };
}

function cloneItem(item: EquipmentItem): EquipmentItem {
  return { ...item };
}

function freezeItem(item: EquipmentItem): Readonly<EquipmentItem> {
  return Object.freeze(cloneItem(item));
}

function normalizeSort(value: unknown, state = false): EquipmentSort {
  if (!isRecord(value)) fail(state ? 'INVALID_STATE' : 'INVALID_SORT');
  const code: EquipmentInventoryErrorCode = state ? 'INVALID_STATE' : 'INVALID_SORT';
  assertExactKeys(value, SORT_KEYS, code);
  assertRequiredKeys(value, SORT_KEYS, code);
  if (typeof value.field !== 'string' || !SORT_FIELDS.includes(value.field as EquipmentSortField)) fail(code);
  if (value.direction !== 'asc' && value.direction !== 'desc') fail(code);
  return { field: value.field as EquipmentSortField, direction: value.direction };
}

function emptyEquipped(): EquippedSlots {
  return { weapon: null, helmet: null, armor: null, cloak: null };
}

function normalizeEquipped(value: unknown, state = false): EquippedSlots {
  if (!isRecord(value)) fail(state ? 'INVALID_STATE' : 'INVALID_SLOT_STATE');
  const code: EquipmentInventoryErrorCode = state ? 'INVALID_STATE' : 'INVALID_SLOT_STATE';
  assertExactKeys(value, EQUIPPED_KEYS, code);
  assertRequiredKeys(value, EQUIPPED_KEYS, code);
  const equipped = {} as Record<EquipmentSlot, EquipmentItem | null>;
  const ids = new Set<string>();
  for (const slot of EQUIPMENT_SLOTS) {
    const raw = value[slot];
    if (raw === null) {
      equipped[slot] = null;
      continue;
    }
    const item = normalizeItem(raw, state);
    if (item.slot !== slot) fail(code);
    if (ids.has(item.equipmentId)) fail(code);
    ids.add(item.equipmentId);
    equipped[slot] = item;
  }
  return equipped;
}

function normalizeItems(value: unknown, state = false): EquipmentItem[] {
  if (!Array.isArray(value)) fail(state ? 'INVALID_STATE' : 'INVALID_EQUIPMENT');
  const ids = new Set<string>();
  return value.map((raw) => {
    const item = normalizeItem(raw, state);
    if (ids.has(item.equipmentId)) fail(state ? 'INVALID_STATE' : 'DUPLICATE_EQUIPMENT');
    ids.add(item.equipmentId);
    return item;
  });
}

function normalizeRequestId(value: unknown): string {
  if (!isText(value) || !REQUEST_ID_PATTERN.test(value)) fail('INVALID_REQUEST_ID');
  return value;
}

function normalizeProcessedRequest(value: unknown): EquipmentProcessedRequest {
  if (!isRecord(value)) fail('INVALID_STATE');
  assertExactKeys(value, PROCESSED_REQUEST_KEYS, 'INVALID_STATE');
  assertRequiredKeys(value, PROCESSED_REQUEST_KEYS, 'INVALID_STATE');
  const requestId = normalizeRequestId(value.requestId);
  if (!isText(value.fingerprint) || !Array.isArray(value.sold) || !isNonNegativeInteger(value.totalValue)) fail('INVALID_STATE');
  const sold = normalizeItems(value.sold, true);
  return { requestId, fingerprint: value.fingerprint, sold, totalValue: value.totalValue };
}

function freezeEquipped(equipped: EquippedSlots): EquippedSlots {
  return Object.freeze({
    weapon: equipped.weapon === null ? null : freezeItem(equipped.weapon),
    helmet: equipped.helmet === null ? null : freezeItem(equipped.helmet),
    armor: equipped.armor === null ? null : freezeItem(equipped.armor),
    cloak: equipped.cloak === null ? null : freezeItem(equipped.cloak),
  });
}

function freezeProcessedRequests(requests: readonly EquipmentProcessedRequest[]): readonly EquipmentProcessedRequest[] {
  return Object.freeze(requests.map((request) => Object.freeze({
    requestId: request.requestId,
    fingerprint: request.fingerprint,
    sold: Object.freeze(request.sold.map((item) => freezeItem(item))),
    totalValue: request.totalValue,
  })));
}

function freezeState(value: EquipmentInventoryState): EquipmentInventoryState {
  return Object.freeze({
    schemaVersion: EQUIPMENT_INVENTORY_SCHEMA_VERSION,
    capacity: value.capacity,
    items: Object.freeze(value.items.map((item) => freezeItem(item))),
    equipped: freezeEquipped(value.equipped),
    sort: Object.freeze({ ...value.sort }),
    processedRequests: freezeProcessedRequests(value.processedRequests),
  });
}

function cloneState(value: EquipmentInventoryState): EquipmentInventoryState {
  return {
    schemaVersion: EQUIPMENT_INVENTORY_SCHEMA_VERSION,
    capacity: value.capacity,
    items: value.items.map(cloneItem),
    equipped: {
      weapon: value.equipped.weapon === null ? null : cloneItem(value.equipped.weapon),
      helmet: value.equipped.helmet === null ? null : cloneItem(value.equipped.helmet),
      armor: value.equipped.armor === null ? null : cloneItem(value.equipped.armor),
      cloak: value.equipped.cloak === null ? null : cloneItem(value.equipped.cloak),
    },
    sort: { ...value.sort },
    processedRequests: value.processedRequests.map((request) => ({
      requestId: request.requestId,
      fingerprint: request.fingerprint,
      sold: request.sold.map(cloneItem),
      totalValue: request.totalValue,
    })),
  };
}

function normalizeCapacity(value: unknown, state = false): number {
  if (!isPositiveInteger(value)) fail(state ? 'INVALID_STATE' : 'INVALID_CAPACITY');
  return value;
}

function parseState(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (error) {
    fail('INVALID_STATE', error);
  }
}

function normalizeState(value: unknown): EquipmentInventoryState {
  const parsed = parseState(value);
  if (!isRecord(parsed)) fail('INVALID_STATE');
  assertExactKeys(parsed, STATE_KEYS, 'INVALID_STATE');
  assertRequiredKeys(parsed, STATE_KEYS, 'INVALID_STATE');
  if (parsed.schemaVersion !== EQUIPMENT_INVENTORY_SCHEMA_VERSION) fail('INVALID_STATE');
  const capacity = normalizeCapacity(parsed.capacity, true);
  const items = normalizeItems(parsed.items, true);
  const equipped = normalizeEquipped(parsed.equipped, true);
  const equippedIds = new Set<string>();
  for (const slot of EQUIPMENT_SLOTS) {
    const item = equipped[slot];
    if (item !== null) equippedIds.add(item.equipmentId);
  }
  if (items.some((item) => equippedIds.has(item.equipmentId))) fail('INVALID_STATE');
  if (items.length > capacity) fail('INVALID_STATE');
  if (!Array.isArray(parsed.processedRequests)) fail('INVALID_STATE');
  const processedRequests = parsed.processedRequests.map(normalizeProcessedRequest);
  const requestIds = new Set<string>();
  for (const request of processedRequests) {
    if (requestIds.has(request.requestId)) fail('INVALID_STATE');
    requestIds.add(request.requestId);
  }
  return freezeState({
    schemaVersion: EQUIPMENT_INVENTORY_SCHEMA_VERSION,
    capacity,
    items,
    equipped,
    sort: normalizeSort(parsed.sort, true),
    processedRequests,
  });
}

function emptyState(capacity: number): EquipmentInventoryState {
  return freezeState({
    schemaVersion: EQUIPMENT_INVENTORY_SCHEMA_VERSION,
    capacity,
    items: [],
    equipped: emptyEquipped(),
    sort: { field: 'equipmentId', direction: 'asc' },
    processedRequests: [],
  });
}

function itemFingerprint(item: EquipmentItem): string {
  return JSON.stringify(item);
}

function requestFingerprint(ids: readonly string[]): string {
  return JSON.stringify([...ids].sort());
}

function cloneResult(result: EquipmentSellResult): EquipmentSellResult {
  return Object.freeze({
    requestId: result.requestId,
    applied: result.applied,
    idempotent: result.idempotent,
    sold: Object.freeze(result.sold.map((item) => freezeItem(item))),
    totalValue: result.totalValue,
  });
}

export interface EquipmentSellResult {
  readonly requestId: string;
  readonly applied: boolean;
  readonly idempotent: boolean;
  readonly sold: readonly EquipmentItem[];
  readonly totalValue: number;
}

export class EquipmentInventoryError extends Error {
  readonly code: EquipmentInventoryErrorCode;
  readonly reason: EquipmentInventoryErrorCode;
  readonly cause?: unknown;

  constructor(code: EquipmentInventoryErrorCode, cause?: unknown) {
    super(code);
    this.name = 'EquipmentInventoryError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export class EquipmentInventoryService {
  private readonly persist: (serialized: string) => void;
  private current: EquipmentInventoryState;
  private committing = false;

  constructor(options: EquipmentInventoryOptions = {}) {
    if (!isRecord(options)) fail('INVALID_CONFIG');
    if (options.persist !== undefined && options.onSave !== undefined) fail('INVALID_CONFIG');
    this.persist = options.persist ?? options.onSave ?? (() => {});
    if (typeof this.persist !== 'function') fail('INVALID_CONFIG');

    if (options.state !== undefined) {
      const restored = normalizeState(options.state);
      if (options.capacity !== undefined && normalizeCapacity(options.capacity) !== restored.capacity) fail('INVALID_CONFIG');
      this.current = restored;
      return;
    }
    const capacity = normalizeCapacity(options.capacity ?? 20);
    this.current = emptyState(capacity);
  }

  static restore(serialized: string, options: Omit<EquipmentInventoryOptions, 'state'> = {}): EquipmentInventoryService {
    return new EquipmentInventoryService({ ...options, state: serialized });
  }

  snapshot(): EquipmentInventoryState {
    return freezeState(cloneState(this.current));
  }

  save(): string {
    return JSON.stringify(this.snapshot());
  }

  get capacity(): number {
    return this.current.capacity;
  }

  list(): readonly EquipmentItem[] {
    return this.query();
  }

  query(): readonly EquipmentItem[] {
    const rows = this.current.items.map((item, index) => ({ item, index }));
    rows.sort((left, right) => {
      const comparison = this.compare(left.item, right.item);
      if (comparison !== 0) return this.current.sort.direction === 'asc' ? comparison : -comparison;
      return left.index - right.index;
    });
    return Object.freeze(rows.map(({ item }) => freezeItem(item)));
  }

  get(equipmentId: string): EquipmentItem {
    const normalizedId = normalizeEquipmentId(equipmentId);
    const item = this.findOwned(normalizedId);
    if (!item) fail('EQUIPMENT_NOT_FOUND');
    return cloneItem(item);
  }

  getEquipment(equipmentId: string): EquipmentItem {
    return this.get(equipmentId);
  }

  add(input: EquipmentInput): EquipmentItem {
    return this.transact(() => {
      const item = normalizeNewItem(input);
      if (this.findOwned(item.equipmentId)) fail('DUPLICATE_EQUIPMENT');
      if (this.current.items.length >= this.current.capacity) fail('CAPACITY_EXCEEDED');
      this.current.items.push(item);
      return cloneItem(item);
    });
  }

  addEquipment(input: EquipmentInput): EquipmentItem {
    return this.add(input);
  }

  setLocked(equipmentId: string, locked: boolean): EquipmentItem {
    if (typeof locked !== 'boolean') fail('INVALID_LOCKED');
    const normalizedId = normalizeEquipmentId(equipmentId);
    const current = this.findOwned(normalizedId);
    if (!current) fail('EQUIPMENT_NOT_FOUND');
    if (current.locked === locked) return cloneItem(current);
    return this.transact(() => {
      const location = this.findLocation(normalizedId);
      if (!location) fail('EQUIPMENT_NOT_FOUND');
      const updated = { ...location.item, locked };
      location.replace(updated);
      return cloneItem(updated);
    });
  }

  lock(equipmentId: string): EquipmentItem {
    return this.setLocked(equipmentId, true);
  }

  unlock(equipmentId: string): EquipmentItem {
    return this.setLocked(equipmentId, false);
  }

  equip(equipmentId: string): EquipmentItem {
    const normalizedId = normalizeEquipmentId(equipmentId);
    const alreadyEquipped = this.findEquipped(normalizedId);
    if (alreadyEquipped) return cloneItem(alreadyEquipped);
    return this.transact(() => {
      const index = this.current.items.findIndex((item) => item.equipmentId === normalizedId);
      if (index === -1) {
        const equipped = this.findEquipped(normalizedId);
        if (!equipped) fail('EQUIPMENT_NOT_FOUND');
        return cloneItem(equipped);
      }
      const item = this.current.items[index];
      const previous = this.current.equipped[item.slot];
      this.current.items.splice(index, 1);
      if (previous !== null) this.current.items.push(previous);
      this.current.equipped[item.slot] = item;
      return cloneItem(item);
    });
  }

  equipEquipment(equipmentId: string): EquipmentItem {
    return this.equip(equipmentId);
  }

  unequip(slot: string): EquipmentItem | undefined {
    const normalizedSlot = normalizeSlot(slot);
    if (this.current.equipped[normalizedSlot] === null) return undefined;
    return this.transact(() => {
      const item = this.current.equipped[normalizedSlot];
      if (item === null) return undefined;
      if (this.current.items.length >= this.current.capacity) fail('CAPACITY_EXCEEDED');
      this.current.equipped[normalizedSlot] = null;
      this.current.items.push(item);
      return cloneItem(item);
    });
  }

  unequipEquipment(slot: string): EquipmentItem | undefined {
    return this.unequip(slot);
  }

  sell(requestId: string, equipmentId: string): EquipmentSellResult;
  sell(equipmentId: string): EquipmentSellResult;
  sell(request: { readonly requestId: string; readonly equipmentId: string }): EquipmentSellResult;
  sell(
    requestIdOrEquipment: string | { readonly requestId: string; readonly equipmentId: string },
    equipmentId?: string,
  ): EquipmentSellResult {
    if (typeof requestIdOrEquipment === 'object') {
      if (!isRecord(requestIdOrEquipment)) fail('INVALID_REQUEST');
      assertExactKeys(requestIdOrEquipment, new Set(['requestId', 'equipmentId']), 'INVALID_REQUEST');
      assertRequiredKeys(requestIdOrEquipment, new Set(['requestId', 'equipmentId']), 'INVALID_REQUEST');
      return this.sellBatch(requestIdOrEquipment.requestId, [requestIdOrEquipment.equipmentId]);
    }
    if (equipmentId === undefined) {
      const normalizedEquipmentId = normalizeEquipmentId(requestIdOrEquipment);
      return this.sellBatch(`sell:${normalizedEquipmentId}`, [normalizedEquipmentId]);
    }
    return this.sellBatch(requestIdOrEquipment, [equipmentId]);
  }

  sellBatch(requestId: string, equipmentIds: readonly string[]): EquipmentSellResult {
    if (this.committing) fail('PERSISTENCE_REENTRANT');
    const normalizedRequestId = normalizeRequestId(requestId);
    if (!Array.isArray(equipmentIds) || equipmentIds.length === 0) fail('INVALID_REQUEST');
    const normalizedIds = equipmentIds.map((equipmentId) => normalizeEquipmentId(equipmentId, 'INVALID_REQUEST'));
    if (new Set(normalizedIds).size !== normalizedIds.length) fail('DUPLICATE_EQUIPMENT');
    const fingerprint = requestFingerprint(normalizedIds);
    const previous = this.current.processedRequests.find((request) => request.requestId === normalizedRequestId);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('REQUEST_CONFLICT');
      return cloneResult({
        requestId: normalizedRequestId,
        applied: false,
        idempotent: true,
        sold: previous.sold,
        totalValue: previous.totalValue,
      });
    }

    return this.transact(() => {
      const sold: EquipmentItem[] = [];
      let totalValue = 0;
      for (const equipmentId of normalizedIds) {
        const index = this.current.items.findIndex((item) => item.equipmentId === equipmentId);
        if (index === -1) {
          if (this.findEquipped(equipmentId)) fail('EQUIPMENT_EQUIPPED');
          fail('EQUIPMENT_NOT_FOUND');
        }
        const item = this.current.items[index];
        if (item.locked) fail('EQUIPMENT_LOCKED');
        sold.push(cloneItem(item));
        this.current.items.splice(index, 1);
        if (totalValue > Number.MAX_SAFE_INTEGER - item.quality) fail('INVALID_STATE');
        totalValue += item.quality;
      }
      this.current.processedRequests.push({
        requestId: normalizedRequestId,
        fingerprint,
        sold: sold.map(cloneItem),
        totalValue,
      });
      return cloneResult({ requestId: normalizedRequestId, applied: true, idempotent: false, sold, totalValue });
    });
  }

  setSort(sort: unknown): EquipmentSort {
    return this.transact(() => {
      this.current.sort = normalizeSort(sort);
      return { ...this.current.sort };
    });
  }

  private findEquipped(equipmentId: string): EquipmentItem | undefined {
    for (const slot of EQUIPMENT_SLOTS) {
      const item = this.current.equipped[slot];
      if (item?.equipmentId === equipmentId) return item;
    }
    return undefined;
  }

  private findOwned(equipmentId: string): EquipmentItem | undefined {
    return this.current.items.find((item) => item.equipmentId === equipmentId) ?? this.findEquipped(equipmentId);
  }

  private findLocation(equipmentId: string): { item: EquipmentItem; replace: (item: EquipmentItem) => void } | undefined {
    const itemIndex = this.current.items.findIndex((candidate) => candidate.equipmentId === equipmentId);
    if (itemIndex !== -1) {
      return {
        item: this.current.items[itemIndex],
        replace: (updated) => { this.current.items[itemIndex] = updated; },
      };
    }
    for (const slot of EQUIPMENT_SLOTS) {
      if (this.current.equipped[slot]?.equipmentId === equipmentId) {
        return {
          item: this.current.equipped[slot]!,
          replace: (updated) => { this.current.equipped[slot] = updated; },
        };
      }
    }
    return undefined;
  }

  private compare(left: EquipmentItem, right: EquipmentItem): number {
    let leftValue: string | number | boolean;
    let rightValue: string | number | boolean;
    switch (this.current.sort.field) {
      case 'equipmentId': leftValue = left.equipmentId; rightValue = right.equipmentId; break;
      case 'slot': leftValue = left.slot; rightValue = right.slot; break;
      case 'quality': leftValue = left.quality; rightValue = right.quality; break;
      case 'primaryAttribute': leftValue = left.primaryAttribute; rightValue = right.primaryAttribute; break;
      case 'primaryValue': leftValue = left.primaryValue; rightValue = right.primaryValue; break;
      case 'locked': leftValue = left.locked; rightValue = right.locked; break;
      default: fail('INVALID_SORT');
    }
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -1 : 1;
  }

  private transact<T>(action: () => T): T {
    if (this.committing) fail('PERSISTENCE_REENTRANT');
    const before = this.current;
    this.current = cloneState(before);
    try {
      const result = action();
      const next = normalizeState(this.current);
      this.committing = true;
      try {
        this.persist(JSON.stringify(next));
      } catch (error) {
        fail('PERSISTENCE_FAILED', error);
      } finally {
        this.committing = false;
      }
      this.current = next;
      return result;
    } catch (error) {
      this.current = before;
      throw error;
    }
  }
}

export function createEquipmentInventory(options: EquipmentInventoryOptions = {}): EquipmentInventoryService {
  return new EquipmentInventoryService(options);
}

export function restoreEquipmentInventory(
  serialized: string,
  options: Omit<EquipmentInventoryOptions, 'state'> = {},
): EquipmentInventoryService {
  return EquipmentInventoryService.restore(serialized, options);
}

export function serializeEquipmentInventory(service: EquipmentInventoryService): string {
  return service.save();
}

export function equipmentFingerprint(item: EquipmentItem): string {
  return itemFingerprint(item);
}
