import {
  EQUIPMENT_QUALITIES,
  EQUIPMENT_SLOTS,
  EquipmentInventoryError,
  EquipmentInventoryService,
  type EquipmentInventoryState,
  type EquipmentItem,
  type EquipmentQuality,
  type EquipmentSlot,
  type EquipmentSort,
} from '../../../../equipment/index.ts';
import {
  createInventoryPageComponents,
  deepFreeze,
  projectVisibleInventoryItems,
  type InventoryComponentProjection,
} from './InventoryComponents.ts';
import {
  INVENTORY_PAGE_SCHEMA_VERSION,
  createDefaultInventoryPageData,
  type InventoryFilter,
  type InventoryInteraction,
  type InventoryInteractionReason,
  type InventoryInteractionResult,
  type InventoryPageData,
  type InventoryPageServiceOptions,
  type InventoryPageSnapshot,
  type InventoryPageState,
} from './InventoryContracts.ts';

export type InventoryPageErrorCode =
  | 'INVALID_ARGUMENT'
  | 'MISSING_FIELD'
  | 'INVALID_DATA'
  | 'INVALID_ID'
  | 'INVALID_NUMBER'
  | 'INVALID_FILTER'
  | 'INVALID_SORT'
  | 'INVALID_SAVE'
  | 'SAVE_VERSION'
  | 'STATE_NOT_AVAILABLE'
  | 'INDEX_OUT_OF_RANGE'
  | 'EQUIPMENT_NOT_FOUND'
  | 'EQUIPMENT_NOT_VISIBLE'
  | 'EQUIPMENT_LOCKED'
  | 'EQUIPMENT_EQUIPPED'
  | 'CAPACITY_EXCEEDED'
  | 'INVALID_REQUEST'
  | 'DUPLICATE_REQUEST'
  | 'REQUEST_CONFLICT'
  | 'PERSISTENCE_FAILED'
  | 'PERSISTENCE_REENTRANT'
  | 'INVALID_STATE';

export class InventoryPageError extends Error {
  readonly code: InventoryPageErrorCode;
  readonly reason: InventoryPageErrorCode;
  readonly cause?: unknown;

  constructor(code: InventoryPageErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'InventoryPageError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }
}

function fail(code: InventoryPageErrorCode, message: string, cause?: unknown): never {
  throw new InventoryPageError(code, message, cause);
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
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key !== 'string')) fail('INVALID_ARGUMENT', `${label} contains unsupported key`);
  const actual = (ownKeys as string[]).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    const missing = allowed.find((key) => !actual.includes(key));
    fail(missing === undefined ? 'INVALID_DATA' : 'MISSING_FIELD', `${label} must contain exactly ${expected.join(', ')}`);
  }
}

function nonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) fail('INVALID_DATA', `${label} must be a non-empty string`);
}

function safeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail('INVALID_NUMBER', `${label} must be a safe integer`);
}

function cloneFilter(filter: InventoryFilter): InventoryFilter {
  return {
    ...(!Object.prototype.hasOwnProperty.call(filter, 'slot') || filter.slot === undefined ? {} : { slot: filter.slot }),
    ...(!Object.prototype.hasOwnProperty.call(filter, 'qualities') || filter.qualities === undefined ? {} : { qualities: [...filter.qualities] }),
    ...(!Object.prototype.hasOwnProperty.call(filter, 'locked') || filter.locked === undefined ? {} : { locked: filter.locked }),
  };
}

function validateData(input: InventoryPageData): InventoryPageData {
  assertRecord(input, 'inventory page data');
  assertExactKeys(input, ['schemaVersion', 'title', 'subtitle', 'stateAvailable'], 'inventory page data');
  if (input.schemaVersion !== INVENTORY_PAGE_SCHEMA_VERSION) fail('INVALID_DATA', 'unsupported inventory page schema version');
  nonEmptyString(input.title, 'inventory page title');
  nonEmptyString(input.subtitle, 'inventory page subtitle');
  if (typeof input.stateAvailable !== 'boolean') fail('INVALID_DATA', 'inventory page stateAvailable must be boolean');
  return deepFreeze({ ...input });
}

function validateFilter(input: unknown, label = 'inventory filter'): InventoryFilter {
  assertRecord(input, label);
  const allowed = ['slot', 'qualities', 'locked'];
  const ownKeys = Reflect.ownKeys(input);
  if (ownKeys.some((key) => typeof key !== 'string' || !allowed.includes(key))) {
    fail('INVALID_FILTER', `${label} contains an unsupported field`);
  }
  const hasSlot = Object.prototype.hasOwnProperty.call(input, 'slot');
  const hasQualities = Object.prototype.hasOwnProperty.call(input, 'qualities');
  const hasLocked = Object.prototype.hasOwnProperty.call(input, 'locked');
  if (hasSlot && input.slot !== undefined && !EQUIPMENT_SLOTS.includes(input.slot as EquipmentSlot)) fail('INVALID_FILTER', `${label}.slot is invalid`);
  if (hasQualities && input.qualities !== undefined) {
    if (!Array.isArray(input.qualities) || input.qualities.some((quality) => !EQUIPMENT_QUALITIES.includes(quality as EquipmentQuality))) {
      fail('INVALID_FILTER', `${label}.qualities is invalid`);
    }
    if (new Set(input.qualities).size !== input.qualities.length) fail('INVALID_FILTER', `${label}.qualities contains duplicates`);
  }
  if (hasLocked && input.locked !== undefined && typeof input.locked !== 'boolean') fail('INVALID_FILTER', `${label}.locked is invalid`);
  return deepFreeze(cloneFilter(input as InventoryFilter));
}

interface ParsedSave {
  readonly selectedEquipmentId: string | null;
  readonly filter: InventoryFilter;
  readonly inventory: string;
}

function parseSave(serialized: unknown): ParsedSave {
  if (typeof serialized !== 'string' || serialized.length === 0) fail('INVALID_SAVE', 'inventory page save must be a non-empty string');
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { fail('INVALID_SAVE', 'inventory page save is not valid JSON'); }
  assertRecord(parsed, 'inventory page save');
  assertExactKeys(parsed, ['schemaVersion', 'selectedEquipmentId', 'filter', 'inventory'], 'inventory page save');
  if (parsed.schemaVersion !== INVENTORY_PAGE_SCHEMA_VERSION) fail('SAVE_VERSION', 'unsupported inventory page save version');
  if (parsed.selectedEquipmentId !== null) nonEmptyString(parsed.selectedEquipmentId, 'saved selected equipment');
  if (typeof parsed.inventory !== 'string') fail('INVALID_SAVE', 'saved inventory must be serialized JSON');
  return {
    selectedEquipmentId: parsed.selectedEquipmentId as string | null,
    filter: validateFilter(parsed.filter, 'saved inventory filter'),
    inventory: parsed.inventory,
  };
}

function interactionResult(
  accepted: boolean,
  changed: boolean,
  reason: InventoryInteractionReason,
  equipmentId: string | null,
  extras: Partial<Pick<InventoryInteractionResult, 'slot' | 'totalValue'>> = {},
): InventoryInteractionResult {
  return deepFreeze({ accepted, changed, reason, equipmentId, ...extras });
}

function mapEquipmentError(error: unknown): never {
  if (error instanceof InventoryPageError) throw error;
  if (error instanceof EquipmentInventoryError) {
    const code = error.code as InventoryPageErrorCode;
    throw new InventoryPageError(code, `equipment inventory rejected the operation: ${error.code}`, error);
  }
  throw error;
}

function cloneData(data: InventoryPageData): InventoryPageData {
  return { ...data };
}

export class InventoryPageService {
  private readonly data: InventoryPageData;
  private inventory: EquipmentInventoryService | null;
  private selectedEquipmentId: string | null;
  private filter: InventoryFilter;
  private readonly persist?: (serialized: string) => void;
  private persisting = false;

  constructor(input: InventoryPageData | InventoryPageServiceOptions = {}) {
    const options: InventoryPageServiceOptions = isRecord(input) && Object.prototype.hasOwnProperty.call(input, 'schemaVersion')
      ? { data: input as InventoryPageData }
      : input as InventoryPageServiceOptions;
    assertRecord(options, 'inventory page options');
    const allowed = ['data', 'inventory', 'capacity', 'initialState', 'onSave', 'persist'];
    if (Object.keys(options).some((key) => !allowed.includes(key))) fail('INVALID_ARGUMENT', 'inventory page options contain an unknown field');
    if (options.onSave !== undefined && options.persist !== undefined) fail('INVALID_ARGUMENT', 'onSave and persist cannot both be provided');
    if (options.onSave !== undefined && typeof options.onSave !== 'function') fail('INVALID_ARGUMENT', 'onSave must be a function');
    if (options.persist !== undefined && typeof options.persist !== 'function') fail('INVALID_ARGUMENT', 'persist must be a function');
    if (options.inventory !== undefined && !(options.inventory instanceof EquipmentInventoryService)) fail('INVALID_ARGUMENT', 'inventory must be an EquipmentInventoryService');
    if (options.capacity !== undefined && (typeof options.capacity !== 'number' || !Number.isSafeInteger(options.capacity) || options.capacity <= 0)) fail('INVALID_ARGUMENT', 'capacity must be a positive safe integer');
    if (options.inventory !== undefined && options.capacity !== undefined) fail('INVALID_ARGUMENT', 'inventory cannot be combined with capacity');
    if (options.inventory !== undefined && options.initialState !== undefined) fail('INVALID_ARGUMENT', 'inventory cannot be combined with initialState');
    this.persist = options.persist ?? options.onSave;
    this.data = validateData(options.data === undefined ? createDefaultInventoryPageData() : options.data);
    if (!this.data.stateAvailable) {
      if (options.inventory !== undefined || options.capacity !== undefined || options.initialState !== undefined || this.persist !== undefined) {
        fail('STATE_NOT_AVAILABLE', 'an empty inventory page has no inventory-backed state');
      }
      this.inventory = null;
      this.selectedEquipmentId = null;
      this.filter = deepFreeze({});
      return;
    }
    const save = options.initialState === undefined ? null : parseSave(options.initialState);
    try {
      this.inventory = options.inventory instanceof EquipmentInventoryService
        ? EquipmentInventoryService.restore(options.inventory.save())
        : EquipmentInventoryService.restore(save?.inventory ?? new EquipmentInventoryService({ capacity: options.capacity }).save());
    } catch (error) { mapEquipmentError(error); }
    this.filter = save?.filter ?? deepFreeze({});
    this.selectedEquipmentId = save?.selectedEquipmentId ?? this.firstVisibleEquipmentId();
    this.normalizeSelection();
  }

  get pageData(): InventoryPageData { return cloneData(this.data); }
  get inventoryService(): EquipmentInventoryService | null { return this.inventory; }

  snapshot(): InventoryPageSnapshot {
    if (this.inventory === null) {
      return deepFreeze({
        schemaVersion: INVENTORY_PAGE_SCHEMA_VERSION,
        pageId: 'inventory',
        selectedEquipmentId: null,
        state: null,
        components: createInventoryPageComponents(this.data, null),
      });
    }
    const state = this.inventory.snapshot();
    const projection: InventoryComponentProjection = {
      inventory: state,
      filter: this.filter,
      selectedEquipmentId: this.selectedEquipmentId,
    };
    return deepFreeze({
      schemaVersion: INVENTORY_PAGE_SCHEMA_VERSION,
      pageId: 'inventory',
      selectedEquipmentId: this.selectedEquipmentId,
      state: {
        schemaVersion: INVENTORY_PAGE_SCHEMA_VERSION,
        selectedEquipmentId: this.selectedEquipmentId,
        filter: this.filter,
        inventory: this.inventory.save(),
      },
      components: createInventoryPageComponents(this.data, projection),
    });
  }

  interact(action: InventoryInteraction): InventoryInteractionResult {
    this.assertNotPersisting();
    if (!isRecord(action) || typeof action.type !== 'string') fail('INVALID_ARGUMENT', 'inventory interaction must contain a type');
    const interactionKeys: Record<string, readonly (readonly string[])[]> = {
      selectEquipment: [['type', 'equipmentId']],
      selectEquipmentAt: [['type', 'index']],
      setFilter: [['type', 'filter']],
      clearFilter: [['type']],
      setSort: [['type', 'sort']],
      toggleLock: [['type', 'equipmentId'], ['type', 'equipmentId', 'locked']],
      equip: [['type'], ['type', 'equipmentId']],
      unequip: [['type', 'slot']],
      sell: [['type', 'requestId'], ['type', 'requestId', 'equipmentId']],
    };
    const expectedKeySets = interactionKeys[action.type];
    if (expectedKeySets === undefined) fail('INVALID_ARGUMENT', `unknown inventory interaction: ${action.type}`);
    const actualKeys = Reflect.ownKeys(action);
    const hasExpectedKeys = expectedKeySets.some((expectedKeys) => {
      const expected = [...expectedKeys].sort();
      const actual = actualKeys.filter((key): key is string => typeof key === 'string').sort();
      return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
    });
    if (actualKeys.some((key) => typeof key !== 'string') || !hasExpectedKeys) {
      fail('INVALID_ARGUMENT', `inventory interaction ${action.type} contains unsupported or missing fields`);
    }
    switch (action.type) {
      case 'selectEquipment': return this.selectEquipment(action.equipmentId);
      case 'selectEquipmentAt': return this.selectEquipmentAt(action.index);
      case 'setFilter': return this.setFilter(action.filter);
      case 'clearFilter': return this.setFilter({});
      case 'setSort': return this.setSort(action.sort);
      case 'toggleLock': return this.toggleLock(action.equipmentId, action.locked);
      case 'equip': return this.equip(action.equipmentId);
      case 'unequip': return this.unequip(action.slot);
      case 'sell': return this.sell(action.requestId, action.equipmentId);
      default: fail('INVALID_ARGUMENT', `unknown inventory interaction: ${action.type}`);
    }
  }

  selectEquipment(equipmentId: unknown): InventoryInteractionResult {
    this.assertNotPersisting();
    if (this.inventory === null) return interactionResult(false, false, 'empty', null);
    if (this.ownedEquipmentIds().length === 0) return interactionResult(false, false, 'empty', null);
    this.assertEquipmentId(equipmentId);
    if (!this.ownedEquipmentIds().includes(equipmentId)) fail('EQUIPMENT_NOT_FOUND', `unknown equipment: ${equipmentId}`);
    if (!this.visibleEquipmentIds().includes(equipmentId) && !this.equippedEquipmentIds().includes(equipmentId)) {
      fail('EQUIPMENT_NOT_VISIBLE', `equipment is hidden by the current filter: ${equipmentId}`);
    }
    if (this.selectedEquipmentId === equipmentId) return interactionResult(true, false, 'same', equipmentId);
    return this.mutate(() => {
      this.selectedEquipmentId = equipmentId;
      return interactionResult(true, true, 'selected', equipmentId);
    });
  }

  selectEquipmentAt(index: unknown): InventoryInteractionResult {
    this.assertNotPersisting();
    if (this.inventory === null) return interactionResult(false, false, 'empty', null);
    if (this.ownedEquipmentIds().length === 0) return interactionResult(false, false, 'empty', null);
    safeInteger(index, 'inventory equipment index');
    const visible = this.visibleEquipmentIds();
    if (index < 0 || index >= visible.length) fail('INDEX_OUT_OF_RANGE', `inventory equipment index is out of range: ${index}`);
    return this.selectEquipment(visible[index]!);
  }

  setFilter(filter: unknown): InventoryInteractionResult {
    this.assertNotPersisting();
    if (this.inventory === null) return interactionResult(false, false, 'empty', null);
    const next = validateFilter(filter);
    if (JSON.stringify(next) === JSON.stringify(this.filter)) return interactionResult(true, false, 'same', this.selectedEquipmentId);
    return this.mutate(() => {
      this.filter = next;
      this.normalizeSelection();
      return interactionResult(true, true, 'filtered', this.selectedEquipmentId);
    });
  }

  clearFilter(): InventoryInteractionResult { return this.setFilter({}); }

  setSort(sort: unknown): InventoryInteractionResult {
    this.assertNotPersisting();
    if (this.inventory === null) return interactionResult(false, false, 'empty', null);
    return this.mutate(() => {
      const before = this.inventory!.save();
      try { this.inventory!.setSort(sort); } catch (error) { mapEquipmentError(error); }
      const changed = before !== this.inventory!.save();
      this.normalizeSelection();
      return interactionResult(true, changed, changed ? 'filtered' : 'same', this.selectedEquipmentId);
    });
  }

  toggleLock(equipmentId: unknown, locked?: unknown): InventoryInteractionResult {
    this.assertNotPersisting();
    if (this.inventory === null) return interactionResult(false, false, 'empty', null);
    this.assertEquipmentId(equipmentId);
    const item = this.getEquipment(equipmentId);
    const nextLocked = locked === undefined ? !item.locked : locked;
    if (typeof nextLocked !== 'boolean') fail('INVALID_ARGUMENT', 'locked must be boolean');
    return this.mutate(() => {
      try { this.inventory!.setLocked(equipmentId, nextLocked); } catch (error) { mapEquipmentError(error); }
      return interactionResult(true, item.locked !== nextLocked, nextLocked ? 'locked' : 'unlocked', equipmentId);
    });
  }

  equip(equipmentId?: unknown): InventoryInteractionResult {
    this.assertNotPersisting();
    if (this.inventory === null) return interactionResult(false, false, 'empty', null);
    const target = equipmentId ?? this.selectedEquipmentId;
    this.assertEquipmentId(target);
    const item = this.getEquipment(target);
    if (this.equippedEquipmentIds().includes(target)) return interactionResult(true, false, 'same', target, { slot: item.slot });
    return this.mutate(() => {
      try { this.inventory!.equip(target); } catch (error) { mapEquipmentError(error); }
      this.selectedEquipmentId = target;
      return interactionResult(true, true, 'equipped', target, { slot: item.slot });
    });
  }

  unequip(slot: unknown): InventoryInteractionResult {
    this.assertNotPersisting();
    if (this.inventory === null) return interactionResult(false, false, 'empty', null);
    if (typeof slot !== 'string' || !EQUIPMENT_SLOTS.includes(slot as EquipmentSlot)) fail('INVALID_ARGUMENT', 'invalid equipment slot');
    const current = this.inventory.snapshot().equipped[slot as EquipmentSlot];
    if (current === null) return interactionResult(true, false, 'same', null, { slot: slot as EquipmentSlot });
    return this.mutate(() => {
      try { this.inventory!.unequip(slot); } catch (error) { mapEquipmentError(error); }
      this.selectedEquipmentId = current.equipmentId;
      return interactionResult(true, true, 'unequipped', current.equipmentId, { slot: slot as EquipmentSlot });
    });
  }

  sell(requestId: unknown, equipmentId?: unknown): InventoryInteractionResult {
    this.assertNotPersisting();
    if (this.inventory === null) return interactionResult(false, false, 'empty', null);
    if (typeof requestId !== 'string' || requestId.trim().length === 0) fail('INVALID_REQUEST', 'request id must be non-empty');
    const target = equipmentId ?? this.selectedEquipmentId;
    this.assertEquipmentId(target);
    return this.mutate(() => {
      let result;
      try { result = this.inventory!.sell(requestId, target); } catch (error) { mapEquipmentError(error); }
      this.normalizeSelection();
      return interactionResult(true, result!.applied, result!.idempotent ? 'idempotent' : 'sold', target, { totalValue: result!.totalValue });
    });
  }

  serialize(): string {
    if (this.inventory === null) fail('STATE_NOT_AVAILABLE', 'empty inventory page has no state to serialize');
    return JSON.stringify({
      schemaVersion: INVENTORY_PAGE_SCHEMA_VERSION,
      selectedEquipmentId: this.selectedEquipmentId,
      filter: this.filter,
      inventory: this.inventory.save(),
    });
  }

  save(): string {
    this.assertNotPersisting();
    const serialized = this.serialize();
    this.persistSafely(serialized);
    return serialized;
  }

  restore(serialized: unknown): InventoryPageSnapshot {
    this.assertNotPersisting();
    if (this.inventory === null) fail('STATE_NOT_AVAILABLE', 'empty inventory page has no state to restore');
    const parsed = parseSave(serialized);
    const before = this.serialize();
    try {
      const restored = EquipmentInventoryService.restore(parsed.inventory);
      if (parsed.selectedEquipmentId !== null && !this.ownedEquipmentIdsFrom(restored).includes(parsed.selectedEquipmentId)) {
        fail('EQUIPMENT_NOT_FOUND', `saved selected equipment is not present: ${parsed.selectedEquipmentId}`);
      }
      this.inventory = restored;
      this.filter = parsed.filter;
      this.selectedEquipmentId = parsed.selectedEquipmentId;
      this.normalizeSelection();
      const next = this.serialize();
      if (next !== before) this.persistSafely(next);
      return this.snapshot();
    } catch (error) {
      this.restoreInternal(before);
      if (error instanceof InventoryPageError) throw error;
      mapEquipmentError(error);
    }
  }

  private mutate<T>(action: () => T): T {
    this.assertNotPersisting();
    if (this.inventory === null) return action();
    const before = this.serialize();
    try {
      const result = action();
      const next = this.serialize();
      if (next !== before) this.persistSafely(next);
      return result;
    } catch (error) {
      this.restoreInternal(before);
      if (error instanceof InventoryPageError) throw error;
      mapEquipmentError(error);
    }
  }

  private persistSafely(serialized: string): void {
    if (!this.persist) return;
    if (this.persisting) fail('PERSISTENCE_REENTRANT', 'inventory page persistence callback cannot re-enter the page');
    this.persisting = true;
    try {
      this.persist(serialized);
    } catch (error) {
      if (error instanceof InventoryPageError && error.code === 'PERSISTENCE_REENTRANT') throw error;
      throw new InventoryPageError('PERSISTENCE_FAILED', 'inventory page state persistence failed', error);
    } finally {
      this.persisting = false;
    }
  }

  private assertNotPersisting(): void {
    if (this.persisting) fail('PERSISTENCE_REENTRANT', 'inventory page persistence callback cannot re-enter the page');
  }

  private restoreInternal(serialized: string): void {
    const parsed = parseSave(serialized);
    this.inventory = EquipmentInventoryService.restore(parsed.inventory);
    this.filter = parsed.filter;
    this.selectedEquipmentId = parsed.selectedEquipmentId;
    this.normalizeSelection();
  }

  private assertEquipmentId(value: unknown): asserts value is string {
    if (typeof value !== 'string' || value.trim().length === 0) fail('INVALID_ID', 'equipment id must be a non-empty string');
  }

  private getEquipment(equipmentId: string): EquipmentItem {
    try { return this.inventory!.get(equipmentId); } catch (error) { mapEquipmentError(error); }
  }

  private ownedEquipmentIds(): readonly string[] { return this.ownedEquipmentIdsFrom(this.inventory!); }

  private ownedEquipmentIdsFrom(service: EquipmentInventoryService): readonly string[] {
    const state = service.snapshot();
    return [
      ...state.items.map((item) => item.equipmentId),
      ...EQUIPMENT_SLOTS.flatMap((slot) => state.equipped[slot] === null ? [] : [state.equipped[slot]!.equipmentId]),
    ];
  }

  private equippedEquipmentIds(): readonly string[] {
    const state = this.inventory!.snapshot();
    return EQUIPMENT_SLOTS.flatMap((slot) => state.equipped[slot] === null ? [] : [state.equipped[slot]!.equipmentId]);
  }

  private visibleEquipmentIds(): readonly string[] {
    const state = this.inventory!.snapshot();
    return projectVisibleInventoryItems(state, this.filter).sort((left, right) => {
      const items = this.inventory!.query();
      return items.findIndex((item) => item.equipmentId === left.equipmentId) - items.findIndex((item) => item.equipmentId === right.equipmentId);
    }).map((item) => item.equipmentId);
  }

  private firstVisibleEquipmentId(): string | null { return this.visibleEquipmentIds()[0] ?? null; }

  private normalizeSelection(): void {
    if (this.inventory === null) { this.selectedEquipmentId = null; return; }
    const owned = this.ownedEquipmentIds();
    if (owned.length === 0) { this.selectedEquipmentId = null; return; }
    if (this.selectedEquipmentId !== null && (this.visibleEquipmentIds().includes(this.selectedEquipmentId) || this.equippedEquipmentIds().includes(this.selectedEquipmentId))) return;
    this.selectedEquipmentId = this.firstVisibleEquipmentId();
  }
}

export function createInventoryPageService(input: InventoryPageData | InventoryPageServiceOptions = {}): InventoryPageService {
  return new InventoryPageService(input);
}

export function createInventoryPageData(
  options: Partial<Pick<InventoryPageData, 'title' | 'subtitle'>> = {},
): InventoryPageData {
  return createDefaultInventoryPageData(options);
}

export { createEmptyInventoryPageData } from './InventoryContracts.ts';
