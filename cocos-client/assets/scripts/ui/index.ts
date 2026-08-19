/**
 * Runtime-neutral UI component models for Cocos Creator 3.8.8.
 *
 * The models deliberately do not import `cc`, DOM APIs, or timers. A Cocos
 * adapter can read each immutable `snapshot` and apply it to Label, Button,
 * Graphics, Node, or a prefab. Mutations are methods so external objects can
 * never replace an internal array, payload, or item by reference.
 */

export type UiSerializable =
  | null
  | boolean
  | number
  | string
  | readonly UiSerializable[]
  | { readonly [key: string]: UiSerializable };

export type UiContractErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_ID'
  | 'INVALID_TEXT'
  | 'TEXT_TOO_LONG'
  | 'INVALID_NUMBER'
  | 'INVALID_BOOLEAN'
  | 'INVALID_SERIALIZABLE'
  | 'BUTTON_EVENT_DUPLICATE'
  | 'BUTTON_DISABLED'
  | 'BUTTON_REENTRANT'
  | 'MODAL_ALREADY_OPEN'
  | 'MODAL_ALREADY_CLOSED'
  | 'LIST_LIMIT'
  | 'LIST_DUPLICATE_ID'
  | 'LIST_PAGE_INVALID'
  | 'LIST_SORT_INVALID'
  | 'TABS_EMPTY'
  | 'TAB_DUPLICATE_ID'
  | 'TAB_NOT_FOUND'
  | 'TAB_DISABLED'
  | 'TOAST_QUEUE_FULL'
  | 'TOAST_EXPIRED'
  | 'CLOCK_INVALID';

export class UiContractError extends Error {
  readonly code: UiContractErrorCode;

  constructor(code: UiContractErrorCode, message: string) {
    super(message);
    this.name = 'UiContractError';
    this.code = code;
  }
}

function reject(code: UiContractErrorCode, message: string): never {
  throw new UiContractError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function defineOwn<T extends object>(target: T, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function ownDataEntries(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) reject('INVALID_ARGUMENT', `${label} must be an object`);
  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      reject('INVALID_SERIALIZABLE', `${label} must be a plain object`);
    }
    if (Object.getOwnPropertySymbols(value).length > 0) {
      reject('INVALID_SERIALIZABLE', `${label} cannot contain symbol properties`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries: Record<string, unknown> = {};
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        reject('INVALID_SERIALIZABLE', `${label}.${key} must be an enumerable data property`);
      }
      defineOwn(entries, key, descriptor.value);
    }
    return entries;
  } catch (error) {
    if (error instanceof UiContractError) throw error;
    reject('INVALID_SERIALIZABLE', `${label} could not be read safely`);
  }
}

function cloneSerializable(value: unknown, label: string, active = new WeakSet<object>()): UiSerializable {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) reject('INVALID_SERIALIZABLE', `${label} must contain finite numbers`);
    return value;
  }
  if (typeof value !== 'object') reject('INVALID_SERIALIZABLE', `${label} is not serializable`);
  if (active.has(value)) reject('INVALID_SERIALIZABLE', `${label} contains a cycle`);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const descriptors = Object.getOwnPropertyDescriptors(value);
      const lengthDescriptor = descriptors.length;
      const length = lengthDescriptor?.value;
      if (!Number.isSafeInteger(length) || length < 0) {
        reject('INVALID_SERIALIZABLE', `${label} has an invalid array length`);
      }
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key === 'symbol') {
          reject('INVALID_SERIALIZABLE', `${label} cannot contain symbol properties`);
        }
        if (key === 'length') continue;
        const index = Number(key);
        if (!/^(?:0|[1-9]\d*)$/.test(key) || !Number.isSafeInteger(index) || index >= length) {
          reject('INVALID_SERIALIZABLE', `${label} contains an unsupported array property`);
        }
      }
      const result: UiSerializable[] = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          reject('INVALID_SERIALIZABLE', `${label}[${index}] must be an enumerable data property`);
        }
        result.push(cloneSerializable(descriptor.value, `${label}[${index}]`, active));
      }
      return Object.freeze(result);
    }

    const entries = ownDataEntries(value, label);
    const result: Record<string, UiSerializable> = {};
    for (const [key, entry] of Object.entries(entries)) {
      defineOwn(result, key, cloneSerializable(entry, `${label}.${key}`, active));
    }
    return Object.freeze(result);
  } catch (error) {
    if (error instanceof UiContractError) throw error;
    reject('INVALID_SERIALIZABLE', `${label} could not be read safely`);
  } finally {
    active.delete(value);
  }
}

function assertId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) reject('INVALID_ID', `${label} must be a non-empty string`);
}

function textLength(value: string): number {
  return Array.from(value).length;
}

function assertText(value: unknown, label: string, maxLength: number): asserts value is string {
  if (typeof value !== 'string') reject('INVALID_TEXT', `${label} must be a string`);
  if (textLength(value) > maxLength) reject('TEXT_TOO_LONG', `${label} exceeds ${maxLength} characters`);
}

function assertMaxLength(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    reject('INVALID_NUMBER', `${label} must be an integer from 1 to 10000`);
  }
}

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) reject('INVALID_NUMBER', `${label} must be finite`);
}

function assertNonNegative(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  if (value < 0) reject('INVALID_NUMBER', `${label} cannot be negative`);
}

function assertPositive(value: unknown, label: string): asserts value is number {
  assertFiniteNumber(value, label);
  if (value <= 0) reject('INVALID_NUMBER', `${label} must be positive`);
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') reject('INVALID_BOOLEAN', `${label} must be boolean`);
}

function freezeState<T extends object>(state: T): Readonly<T> {
  return Object.freeze(state);
}

function result<T extends object>(value: T): Readonly<T> {
  return Object.freeze(value);
}

export interface LabelState {
  readonly id: string;
  readonly text: string;
  readonly length: number;
  readonly maxLength: number;
}

export interface LabelOptions {
  readonly id: string;
  readonly text?: string;
  readonly maxLength?: number;
}

export class LabelModel {
  private stateValue: LabelState;

  constructor(options: LabelOptions) {
    if (!options || typeof options !== 'object') reject('INVALID_ARGUMENT', 'label options are required');
    assertId(options.id, 'label id');
    const maxLength = options.maxLength === undefined ? 128 : options.maxLength;
    assertMaxLength(maxLength, 'label maxLength');
    const text = options.text === undefined ? '' : options.text;
    assertText(text, 'label text', maxLength);
    this.stateValue = freezeState({ id: options.id, text, length: textLength(text), maxLength });
  }

  get snapshot(): LabelState {
    return this.stateValue;
  }

  setText(text: string): LabelState {
    assertText(text, 'label text', this.stateValue.maxLength);
    this.stateValue = freezeState({ ...this.stateValue, text, length: textLength(text) });
    return this.stateValue;
  }
}

export interface ButtonState {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  readonly clickCount: number;
}

export interface ButtonOptions {
  readonly id: string;
  readonly label?: string;
  readonly disabled?: boolean;
  readonly maxLabelLength?: number;
  readonly onClick?: () => void;
}

export type ButtonClickReason = 'triggered' | 'disabled' | 'duplicate-event' | 'reentrant';

export interface ButtonClickResult {
  readonly accepted: boolean;
  readonly reason: ButtonClickReason;
}

export class ButtonModel {
  private stateValue: ButtonState;
  private readonly onClick?: () => void;
  private readonly maxLabelLength: number;
  private handlingClick = false;
  private lastEventKey?: string;

  constructor(options: ButtonOptions) {
    if (!options || typeof options !== 'object') reject('INVALID_ARGUMENT', 'button options are required');
    assertId(options.id, 'button id');
    this.maxLabelLength = options.maxLabelLength === undefined ? 128 : options.maxLabelLength;
    assertMaxLength(this.maxLabelLength, 'button maxLabelLength');
    const label = options.label === undefined ? '' : options.label;
    assertText(label, 'button label', this.maxLabelLength);
    const disabled = options.disabled === undefined ? false : options.disabled;
    assertBoolean(disabled, 'button disabled');
    if (options.onClick !== undefined && typeof options.onClick !== 'function') {
      reject('INVALID_ARGUMENT', 'button onClick must be a function');
    }
    this.onClick = options.onClick;
    this.stateValue = freezeState({ id: options.id, label, disabled, clickCount: 0 });
  }

  get snapshot(): ButtonState {
    return this.stateValue;
  }

  setDisabled(disabled: boolean): ButtonState {
    assertBoolean(disabled, 'button disabled');
    this.stateValue = freezeState({ ...this.stateValue, disabled });
    return this.stateValue;
  }

  setLabel(label: string): ButtonState {
    assertText(label, 'button label', this.maxLabelLength);
    this.stateValue = freezeState({ ...this.stateValue, label });
    return this.stateValue;
  }

  click(eventKey?: string): ButtonClickResult {
    if (eventKey !== undefined) assertId(eventKey, 'button eventKey');
    if (this.stateValue.disabled) return result({ accepted: false, reason: 'disabled' as const });
    if (this.handlingClick) return result({ accepted: false, reason: 'reentrant' as const });
    if (eventKey !== undefined && this.lastEventKey === eventKey) {
      return result({ accepted: false, reason: 'duplicate-event' as const });
    }
    if (eventKey !== undefined) this.lastEventKey = eventKey;
    this.handlingClick = true;
    try {
      this.onClick?.();
      this.stateValue = freezeState({ ...this.stateValue, clickCount: this.stateValue.clickCount + 1 });
      return result({ accepted: true, reason: 'triggered' as const });
    } finally {
      this.handlingClick = false;
    }
  }
}

export interface ResourceBarState {
  readonly id: string;
  readonly value: number;
  readonly max: number;
  readonly ratio: number;
}

export interface ResourceBarOptions {
  readonly id: string;
  readonly value?: number;
  readonly max: number;
}

function resourceState(id: string, value: number, max: number): ResourceBarState {
  const safeValue = Math.min(value, max);
  return freezeState({ id, value: safeValue, max, ratio: max === 0 ? 0 : safeValue / max });
}

export class ResourceBarModel {
  private stateValue: ResourceBarState;

  constructor(options: ResourceBarOptions) {
    if (!options || typeof options !== 'object') reject('INVALID_ARGUMENT', 'resource bar options are required');
    assertId(options.id, 'resource bar id');
    assertNonNegative(options.max, 'resource bar max');
    const value = options.value === undefined ? 0 : options.value;
    assertNonNegative(value, 'resource bar value');
    this.stateValue = resourceState(options.id, value, options.max);
  }

  get snapshot(): ResourceBarState {
    return this.stateValue;
  }

  setValue(value: number): ResourceBarState {
    assertNonNegative(value, 'resource bar value');
    this.stateValue = resourceState(this.stateValue.id, value, this.stateValue.max);
    return this.stateValue;
  }

  setMax(max: number): ResourceBarState {
    assertNonNegative(max, 'resource bar max');
    this.stateValue = resourceState(this.stateValue.id, this.stateValue.value, max);
    return this.stateValue;
  }
}

export interface ModalState {
  readonly id: string;
  readonly isOpen: boolean;
  readonly payload: UiSerializable | null;
  readonly openCount: number;
  readonly closeCount: number;
}

export interface ModalOptions {
  readonly id: string;
  readonly onOpen?: (state: ModalState) => void;
  readonly onClose?: (state: ModalState) => void;
}

export class ModalModel {
  private readonly onOpen?: (state: ModalState) => void;
  private readonly onClose?: (state: ModalState) => void;
  private stateValue: ModalState;

  constructor(options: ModalOptions) {
    if (!options || typeof options !== 'object') reject('INVALID_ARGUMENT', 'modal options are required');
    assertId(options.id, 'modal id');
    if (options.onOpen !== undefined && typeof options.onOpen !== 'function') reject('INVALID_ARGUMENT', 'modal onOpen must be a function');
    if (options.onClose !== undefined && typeof options.onClose !== 'function') reject('INVALID_ARGUMENT', 'modal onClose must be a function');
    this.onOpen = options.onOpen;
    this.onClose = options.onClose;
    this.stateValue = freezeState({ id: options.id, isOpen: false, payload: null, openCount: 0, closeCount: 0 });
  }

  get snapshot(): ModalState {
    return this.stateValue;
  }

  open(payload: UiSerializable | null = null): boolean {
    const safePayload = payload === null ? null : cloneSerializable(payload, 'modal payload');
    if (this.stateValue.isOpen) return false;
    this.stateValue = freezeState({
      ...this.stateValue,
      isOpen: true,
      payload: safePayload,
      openCount: this.stateValue.openCount + 1,
    });
    this.onOpen?.(this.stateValue);
    return true;
  }

  close(): boolean {
    if (!this.stateValue.isOpen) return false;
    this.stateValue = freezeState({
      ...this.stateValue,
      isOpen: false,
      payload: null,
      closeCount: this.stateValue.closeCount + 1,
    });
    this.onClose?.(this.stateValue);
    return true;
  }
}

export interface UiListItem<T extends UiSerializable = UiSerializable> {
  readonly id: string;
  readonly data: T;
}

export interface ListPage<T extends UiSerializable = UiSerializable> {
  readonly page: number;
  readonly pageSize: number;
  readonly totalPages: number;
  readonly items: readonly UiListItem<T>[];
  readonly isEmpty: boolean;
}

export interface ListState<T extends UiSerializable = UiSerializable> {
  readonly items: readonly UiListItem<T>[];
  readonly itemCount: number;
  readonly isEmpty: boolean;
  readonly emptyText: string;
  readonly pageSize: number;
  readonly maxItems: number;
}

export interface ListOptions<T extends UiSerializable = UiSerializable> {
  readonly items?: readonly UiListItem<T>[];
  readonly maxItems?: number;
  readonly pageSize?: number;
  readonly emptyText?: string;
  readonly compare?: (left: UiListItem<T>, right: UiListItem<T>) => number;
}

function assertListItem<T extends UiSerializable>(value: unknown, label: string): UiListItem<T> {
  const entries = ownDataEntries(value, label);
  assertId(entries.id, `${label}.id`);
  if (!Object.prototype.hasOwnProperty.call(entries, 'data')) reject('INVALID_ARGUMENT', `${label}.data is required`);
  const data = cloneSerializable(entries.data, `${label}.data`) as T;
  return Object.freeze({ id: entries.id, data });
}

function normalizeListItems<T extends UiSerializable>(value: unknown, label: string): UiListItem<T>[] {
  if (!Array.isArray(value)) reject('INVALID_ARGUMENT', `${label} must be an array`);
  const ids = new Set<string>();
  const normalized: UiListItem<T>[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = assertListItem<T>(value[index], `${label}[${index}]`);
    if (ids.has(item.id)) reject('LIST_DUPLICATE_ID', `duplicate list item id: ${item.id}`);
    ids.add(item.id);
    normalized.push(item);
  }
  return normalized;
}

function stableSort<T extends UiSerializable>(
  items: readonly UiListItem<T>[],
  compare?: (left: UiListItem<T>, right: UiListItem<T>) => number,
): UiListItem<T>[] {
  if (!compare) return [...items];
  try {
    return items
      .map((item, index) => ({ item, index }))
      .sort((left, right) => {
        const order = compare(left.item, right.item);
        if (typeof order !== 'number' || !Number.isFinite(order)) {
          reject('LIST_SORT_INVALID', 'list compare must return a finite number');
        }
        return order === 0 ? left.index - right.index : order;
      })
      .map(({ item }) => item);
  } catch (error) {
    if (error instanceof UiContractError) throw error;
    reject('LIST_SORT_INVALID', 'list compare failed');
  }
}

export class ListModel<T extends UiSerializable = UiSerializable> {
  private readonly compare?: (left: UiListItem<T>, right: UiListItem<T>) => number;
  private stateValue: ListState<T>;

  constructor(options: ListOptions<T> = {}) {
    if (!options || typeof options !== 'object') reject('INVALID_ARGUMENT', 'list options are required');
    const maxItems = options.maxItems === undefined ? 100 : options.maxItems;
    const pageSize = options.pageSize === undefined ? 10 : options.pageSize;
    assertMaxLength(maxItems, 'list maxItems');
    assertMaxLength(pageSize, 'list pageSize');
    if (options.compare !== undefined && typeof options.compare !== 'function') reject('INVALID_ARGUMENT', 'list compare must be a function');
    const emptyText = options.emptyText === undefined ? '暂无数据' : options.emptyText;
    assertText(emptyText, 'list emptyText', 128);
    this.compare = options.compare;
    const items = normalizeListItems<T>(options.items === undefined ? [] : options.items, 'list items');
    this.stateValue = this.buildState(this.sortAndLimit(items, maxItems), emptyText, pageSize, maxItems);
  }

  private sortAndLimit(items: readonly UiListItem<T>[], maxItems: number): UiListItem<T>[] {
    if (items.length > maxItems) reject('LIST_LIMIT', `list cannot exceed ${maxItems} items`);
    return stableSort(items, this.compare);
  }

  private buildState(items: readonly UiListItem<T>[], emptyText: string, pageSize: number, maxItems: number): ListState<T> {
    return freezeState({
      items: Object.freeze([...items]),
      itemCount: items.length,
      isEmpty: items.length === 0,
      emptyText,
      pageSize,
      maxItems,
    });
  }

  get snapshot(): ListState<T> {
    return this.stateValue;
  }

  replace(items: readonly UiListItem<T>[]): ListState<T> {
    const normalized = normalizeListItems<T>(items, 'list items');
    if (normalized.length > this.stateValue.maxItems) {
      reject('LIST_LIMIT', `list cannot exceed ${this.stateValue.maxItems} items`);
    }
    const sorted = stableSort(normalized, this.compare);
    this.stateValue = this.buildState(sorted, this.stateValue.emptyText, this.stateValue.pageSize, this.stateValue.maxItems);
    return this.stateValue;
  }

  append(item: UiListItem<T>): ListState<T> {
    if (this.stateValue.itemCount >= this.stateValue.maxItems) {
      reject('LIST_LIMIT', `list cannot exceed ${this.stateValue.maxItems} items`);
    }
    return this.replace([...this.stateValue.items, item]);
  }

  remove(id: string): boolean {
    assertId(id, 'list item id');
    const index = this.stateValue.items.findIndex((item) => item.id === id);
    if (index < 0) return false;
    const next = [...this.stateValue.items];
    next.splice(index, 1);
    this.replace(next);
    return true;
  }

  clear(): ListState<T> {
    return this.replace([]);
  }

  getPage(page: number): ListPage<T> {
    if (!Number.isSafeInteger(page) || page < 1) reject('LIST_PAGE_INVALID', 'list page must be a positive integer');
    const totalPages = Math.ceil(this.stateValue.itemCount / this.stateValue.pageSize);
    if (totalPages === 0 && page === 1) {
      return result({ page, pageSize: this.stateValue.pageSize, totalPages, items: Object.freeze([]), isEmpty: true });
    }
    if (page > totalPages) reject('LIST_PAGE_INVALID', `list page ${page} is out of range`);
    const start = (page - 1) * this.stateValue.pageSize;
    const items = Object.freeze(this.stateValue.items.slice(start, start + this.stateValue.pageSize));
    return result({ page, pageSize: this.stateValue.pageSize, totalPages, items, isEmpty: false });
  }
}

export interface TabDefinition {
  readonly id: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface TabsState {
  readonly tabs: readonly TabDefinition[];
  readonly selectedId: string;
}

export interface TabsOptions {
  readonly tabs: readonly TabDefinition[];
  readonly selectedId?: string;
  readonly maxLabelLength?: number;
  readonly onChange?: (selectedId: string) => void;
}

function normalizeTabs(value: unknown, maxLabelLength: number): TabDefinition[] {
  if (!Array.isArray(value) || value.length === 0) reject('TABS_EMPTY', 'tabs require at least one tab');
  const ids = new Set<string>();
  const tabs: TabDefinition[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const entries = ownDataEntries(value[index], `tabs[${index}]`);
    assertId(entries.id, `tabs[${index}].id`);
    assertText(entries.label, `tabs[${index}].label`, maxLabelLength);
    const disabled = entries.disabled === undefined ? false : entries.disabled;
    assertBoolean(disabled, `tabs[${index}].disabled`);
    if (ids.has(entries.id)) reject('TAB_DUPLICATE_ID', `duplicate tab id: ${entries.id}`);
    ids.add(entries.id);
    tabs.push(Object.freeze({ id: entries.id, label: entries.label, disabled }));
  }
  if (!tabs.some((tab) => !tab.disabled)) reject('TABS_EMPTY', 'tabs require at least one enabled tab');
  return tabs;
}

export class TabsModel {
  private readonly maxLabelLength: number;
  private readonly onChange?: (selectedId: string) => void;
  private stateValue: TabsState;

  constructor(options: TabsOptions) {
    if (!options || typeof options !== 'object') reject('INVALID_ARGUMENT', 'tabs options are required');
    this.maxLabelLength = options.maxLabelLength === undefined ? 64 : options.maxLabelLength;
    assertMaxLength(this.maxLabelLength, 'tabs maxLabelLength');
    if (options.onChange !== undefined && typeof options.onChange !== 'function') reject('INVALID_ARGUMENT', 'tabs onChange must be a function');
    const tabs = normalizeTabs(options.tabs, this.maxLabelLength);
    const selectedId = options.selectedId === undefined ? tabs.find((tab) => !tab.disabled)!.id : options.selectedId;
    assertId(selectedId, 'selected tab id');
    const selected = tabs.find((tab) => tab.id === selectedId);
    if (!selected) reject('TAB_NOT_FOUND', `unknown tab id: ${selectedId}`);
    if (selected.disabled) reject('TAB_DISABLED', `tab is disabled: ${selectedId}`);
    this.onChange = options.onChange;
    this.stateValue = freezeState({ tabs: Object.freeze(tabs), selectedId });
  }

  get snapshot(): TabsState {
    return this.stateValue;
  }

  select(id: string): boolean {
    assertId(id, 'tab id');
    const tab = this.stateValue.tabs.find((candidate) => candidate.id === id);
    if (!tab) reject('TAB_NOT_FOUND', `unknown tab id: ${id}`);
    if (tab.disabled) return false;
    if (this.stateValue.selectedId === id) return false;
    this.stateValue = freezeState({ ...this.stateValue, selectedId: id });
    this.onChange?.(id);
    return true;
  }
}

export interface ToastEntry {
  readonly id: string;
  readonly message: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export interface ToastQueueState {
  readonly entries: readonly ToastEntry[];
  readonly pendingCount: number;
  readonly maxQueue: number;
}

export interface ToastQueueOptions {
  readonly now?: () => number;
  readonly maxQueue?: number;
  readonly messageMaxLength?: number;
}

export class ToastQueueModel {
  private readonly now: () => number;
  private readonly maxQueue: number;
  private readonly messageMaxLength: number;
  private queue: ToastEntry[] = [];
  private nextId = 1;

  constructor(options: ToastQueueOptions = {}) {
    if (!options || typeof options !== 'object') reject('INVALID_ARGUMENT', 'toast queue options are required');
    this.now = options.now === undefined ? () => 0 : options.now;
    if (typeof this.now !== 'function') reject('INVALID_ARGUMENT', 'toast now must be a function');
    this.maxQueue = options.maxQueue === undefined ? 20 : options.maxQueue;
    this.messageMaxLength = options.messageMaxLength === undefined ? 128 : options.messageMaxLength;
    assertMaxLength(this.maxQueue, 'toast maxQueue');
    assertMaxLength(this.messageMaxLength, 'toast messageMaxLength');
  }

  private readNow(useInjectedClock: boolean, value?: unknown): number {
    const time = useInjectedClock ? this.now() : value;
    if (typeof time !== 'number' || !Number.isFinite(time)) reject('CLOCK_INVALID', 'toast clock must return a finite number');
    return time;
  }

  private expireAt(time: number): number {
    const before = this.queue.length;
    this.queue = this.queue.filter((entry) => entry.expiresAt > time);
    return before - this.queue.length;
  }

  get snapshot(): ToastQueueState {
    this.expireAt(this.readNow(true));
    return freezeState({ entries: Object.freeze([...this.queue]), pendingCount: this.queue.length, maxQueue: this.maxQueue });
  }

  enqueue(message: string, duration = 2000): string | null {
    assertText(message, 'toast message', this.messageMaxLength);
    assertPositive(duration, 'toast duration');
    const createdAt = this.readNow(true);
    this.expireAt(createdAt);
    const expiresAt = createdAt + duration;
    assertFiniteNumber(expiresAt, 'toast expiresAt');
    if (this.queue.length >= this.maxQueue) return null;
    const entry = freezeState({
      id: `toast-${this.nextId}`,
      message,
      createdAt,
      expiresAt,
    });
    this.nextId += 1;
    this.queue.push(entry);
    return entry.id;
  }

  expire(now?: number): number {
    return this.expireAt(this.readNow(arguments.length === 0, now));
  }

  dismiss(id: string): boolean {
    this.expire();
    assertId(id, 'toast id');
    const index = this.queue.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    return true;
  }

  consumeNext(now?: number): ToastEntry | null {
    if (arguments.length === 0) this.expire();
    else this.expire(now);
    return this.queue.shift() ?? null;
  }

  clear(): number {
    this.expire();
    const count = this.queue.length;
    this.queue = [];
    return count;
  }
}
