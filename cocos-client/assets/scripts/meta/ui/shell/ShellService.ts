import { createDefaultState } from '../../GameState.ts';
import {
  SHELL_NAVIGATION,
  SHELL_RESOURCE_DEFINITIONS,
  SHELL_SCHEMA_VERSION,
  type ShellPageId,
  type ShellResourceId,
} from './ShellContracts.ts';

export type ShellContractErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_ID'
  | 'INVALID_NUMBER'
  | 'INVALID_BOOLEAN'
  | 'INVALID_SAVE'
  | 'SAVE_VERSION'
  | 'RESOURCE_NOT_FOUND'
  | 'RESOURCE_LIMIT'
  | 'PAGE_NOT_FOUND'
  | 'PAGE_DISABLED'
  | 'NO_AVAILABLE_PAGE';

export class ShellContractError extends Error {
  readonly code: ShellContractErrorCode;

  constructor(code: ShellContractErrorCode, message: string) {
    super(message);
    this.name = 'ShellContractError';
    this.code = code;
  }
}

export interface ShellResourceState {
  readonly id: ShellResourceId;
  readonly label: string;
  readonly value: number;
  readonly max: number | null;
}

export interface ShellNavigationState {
  readonly id: ShellPageId;
  readonly label: string;
  readonly glyph: string;
  readonly enabled: boolean;
  readonly selected: boolean;
}

export interface ShellState {
  readonly schemaVersion: typeof SHELL_SCHEMA_VERSION;
  readonly page: ShellPageId;
  readonly history: readonly ShellPageId[];
  readonly navigation: readonly ShellNavigationState[];
  readonly resources: readonly ShellResourceState[];
}

export type ShellInitialResource = number | {
  readonly value: number;
  readonly max?: number | null;
};

export interface ShellInitialState {
  readonly page?: ShellPageId;
  readonly history?: readonly ShellPageId[];
  readonly enabledPages?: readonly ShellPageId[];
  readonly resources?: Partial<Record<ShellResourceId, ShellInitialResource>>;
}

export type ShellPersistence = (serialized: string) => void;

export interface ShellServiceOptions {
  readonly initial?: ShellInitialState;
  readonly persist?: ShellPersistence;
}

export type ShellNavigationReason = 'selected' | 'same' | 'disabled' | 'back';

export interface ShellNavigationResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly page: ShellPageId;
  readonly reason: ShellNavigationReason;
}

interface MutableResource {
  readonly id: ShellResourceId;
  readonly label: string;
  value: number;
  max: number | null;
}

interface MutableShellState {
  page: ShellPageId;
  history: ShellPageId[];
  enabled: Record<ShellPageId, boolean>;
  resources: MutableResource[];
}

interface ResourceSaveEntry {
  readonly id: ShellResourceId;
  readonly value: number;
  readonly max: number | null;
}

interface NavigationSaveEntry {
  readonly id: ShellPageId;
  readonly enabled: boolean;
}

interface ShellMutationResult<T> {
  readonly next: ShellState;
  readonly result: T;
}

type ShellMutation<T> = (state: ShellState) => ShellMutationResult<T>;

function reject(code: ShellContractErrorCode, message: string): never {
  throw new ShellContractError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPlainRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    reject('INVALID_ARGUMENT', `${label} must be a plain object`);
  }
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    reject('INVALID_SAVE', `${label} contains unexpected or missing fields`);
  }
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) reject('INVALID_NUMBER', `${label} must be a safe integer`);
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  assertSafeInteger(value, label);
  if (value < 0) reject('INVALID_NUMBER', `${label} cannot be negative`);
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  assertSafeInteger(value, label);
  if (value <= 0) reject('INVALID_NUMBER', `${label} must be positive`);
}

function assertBoolean(value: unknown, label: string): asserts value is boolean {
  if (typeof value !== 'boolean') reject('INVALID_BOOLEAN', `${label} must be boolean`);
}

function pageDefinition(id: unknown, label: string): (typeof SHELL_NAVIGATION)[number] {
  if (typeof id !== 'string' || !id.trim()) reject('INVALID_ID', `${label} must be a non-empty string`);
  const definition = SHELL_NAVIGATION.find((entry) => entry.id === id);
  if (!definition) reject('PAGE_NOT_FOUND', `unknown shell page: ${id}`);
  return definition;
}

function resourceDefinition(id: unknown, label: string): (typeof SHELL_RESOURCE_DEFINITIONS)[number] {
  if (typeof id !== 'string' || !id.trim()) reject('INVALID_ID', `${label} must be a non-empty string`);
  const definition = SHELL_RESOURCE_DEFINITIONS.find((entry) => entry.id === id);
  if (!definition) reject('RESOURCE_NOT_FOUND', `unknown shell resource: ${id}`);
  return definition;
}

function cloneEnabledPages(enabled: Record<ShellPageId, boolean>): Record<ShellPageId, boolean> {
  const copy = {} as Record<ShellPageId, boolean>;
  for (const definition of SHELL_NAVIGATION) copy[definition.id] = enabled[definition.id];
  return copy;
}

function defaultMutableState(): MutableShellState {
  const game = createDefaultState();
  const enabled = {} as Record<ShellPageId, boolean>;
  for (const definition of SHELL_NAVIGATION) enabled[definition.id] = true;
  return {
    page: 'home',
    history: [],
    enabled,
    resources: [
      { id: 'stamina', label: '体力', value: game.resources.stamina, max: game.resources.staminaMax },
      { id: 'silver', label: '银币', value: game.resources.silver, max: null },
      { id: 'crystal', label: '水晶', value: game.resources.crystal, max: null },
      { id: 'towerTicket', label: '塔票', value: game.resources.towerTicket, max: null },
    ],
  };
}

function findFallbackPage(enabled: Record<ShellPageId, boolean>): ShellPageId {
  const fallback = SHELL_NAVIGATION.find((definition) => enabled[definition.id]);
  if (!fallback) reject('NO_AVAILABLE_PAGE', 'shell requires at least one enabled page');
  return fallback.id;
}

function resourceValueAndMax(value: ShellInitialResource, defaultMax: number | null, label: string): { value: number; max: number | null } {
  let nextValue: unknown = value;
  let nextMax: unknown = defaultMax;
  if (isRecord(value)) {
    const keys = Object.keys(value);
    if (keys.some((key) => key !== 'value' && key !== 'max')) reject('INVALID_ARGUMENT', `${label} contains unexpected fields`);
    nextValue = value.value;
    nextMax = value.max === undefined ? defaultMax : value.max;
  }
  assertNonNegativeInteger(nextValue, `${label}.value`);
  if (nextMax !== null) assertPositiveInteger(nextMax, `${label}.max`);
  if (nextMax !== null && nextValue > nextMax) reject('RESOURCE_LIMIT', `${label}.value exceeds max`);
  return { value: nextValue, max: nextMax as number | null };
}

function initialState(input: ShellInitialState | undefined): MutableShellState {
  const state = defaultMutableState();
  if (input === undefined) return state;
  assertPlainRecord(input, 'shell initial state');
  const allowed = ['page', 'history', 'enabledPages', 'resources'];
  if (Object.keys(input).some((key) => !allowed.includes(key))) reject('INVALID_ARGUMENT', 'shell initial state contains an unknown field');

  const requestedPage = input.page === undefined ? state.page : pageDefinition(input.page, 'shell page').id;
  const enabled = cloneEnabledPages(state.enabled);
  if (input.enabledPages !== undefined) {
    if (!Array.isArray(input.enabledPages)) reject('INVALID_ARGUMENT', 'enabledPages must be an array');
    for (const definition of SHELL_NAVIGATION) enabled[definition.id] = false;
    const seen = new Set<string>();
    for (const id of input.enabledPages) {
      const page = pageDefinition(id, 'enabled page');
      if (seen.has(page.id)) reject('INVALID_ARGUMENT', `duplicate enabled page: ${page.id}`);
      seen.add(page.id);
      enabled[page.id] = true;
    }
  }
  if (!Object.values(enabled).some(Boolean)) reject('NO_AVAILABLE_PAGE', 'shell requires at least one enabled page');
  state.page = enabled[requestedPage] ? requestedPage : findFallbackPage(enabled);
  state.enabled = enabled;

  if (input.history !== undefined) {
    if (!Array.isArray(input.history)) reject('INVALID_ARGUMENT', 'history must be an array');
    state.history = input.history.map((id, index) => pageDefinition(id, `history[${index}]`).id);
  }

  if (input.resources !== undefined) {
    assertPlainRecord(input.resources, 'resources');
    for (const key of Object.keys(input.resources)) resourceDefinition(key, 'resource id');
    state.resources = state.resources.map((resource) => {
      if (!Object.prototype.hasOwnProperty.call(input.resources, resource.id)) return resource;
      const normalized = resourceValueAndMax(input.resources[resource.id]!, resource.max, `resources.${resource.id}`);
      if (resource.id === 'stamina' && normalized.max === null) reject('RESOURCE_LIMIT', 'stamina requires a finite max');
      return { ...resource, ...normalized };
    });
  }
  return state;
}

function immutableState(state: MutableShellState): ShellState {
  const navigation = SHELL_NAVIGATION.map((definition) => Object.freeze({
    id: definition.id,
    label: definition.label,
    glyph: definition.glyph,
    enabled: state.enabled[definition.id],
    selected: state.page === definition.id,
  }));
  const resources = state.resources.map((resource) => Object.freeze({ ...resource }));
  return Object.freeze({
    schemaVersion: SHELL_SCHEMA_VERSION,
    page: state.page,
    history: Object.freeze([...state.history]),
    navigation: Object.freeze(navigation),
    resources: Object.freeze(resources),
  });
}

function serializeState(state: ShellState): string {
  const navigation: NavigationSaveEntry[] = state.navigation.map(({ id, enabled }) => ({ id, enabled }));
  const resources: ResourceSaveEntry[] = state.resources.map(({ id, value, max }) => ({ id, value, max }));
  return JSON.stringify({
    schemaVersion: state.schemaVersion,
    page: state.page,
    history: [...state.history],
    navigation,
    resources,
  });
}

function parseSerialized(serialized: string): ShellInitialState {
  if (typeof serialized !== 'string' || serialized.length === 0) reject('INVALID_SAVE', 'shell save must be a non-empty string');
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    reject('INVALID_SAVE', 'shell save is not valid JSON');
  }
  assertPlainRecord(parsed, 'shell save');
  assertExactKeys(parsed, ['schemaVersion', 'page', 'history', 'navigation', 'resources'], 'shell save');
  if (parsed.schemaVersion !== SHELL_SCHEMA_VERSION) reject('SAVE_VERSION', 'unsupported shell save version');
  pageDefinition(parsed.page, 'saved page');
  if (!Array.isArray(parsed.history)) reject('INVALID_SAVE', 'saved history must be an array');
  const history = parsed.history.map((id, index) => pageDefinition(id, `saved history[${index}]`).id);

  if (!Array.isArray(parsed.navigation) || parsed.navigation.length !== SHELL_NAVIGATION.length) {
    reject('INVALID_SAVE', 'saved navigation does not match the shell contract');
  }
  const enabledPages: ShellPageId[] = [];
  parsed.navigation.forEach((entry, index) => {
    assertPlainRecord(entry, `saved navigation[${index}]`);
    assertExactKeys(entry, ['id', 'enabled'], `saved navigation[${index}]`);
    const expected = SHELL_NAVIGATION[index];
    if (entry.id !== expected.id) reject('INVALID_SAVE', 'saved navigation order does not match the shell contract');
    assertBoolean(entry.enabled, `saved navigation[${index}].enabled`);
    if (entry.enabled) enabledPages.push(expected.id);
  });
  if (enabledPages.length === 0) reject('NO_AVAILABLE_PAGE', 'saved shell has no enabled page');
  if (!enabledPages.includes(parsed.page as ShellPageId)) reject('PAGE_DISABLED', 'saved page is disabled');

  if (!Array.isArray(parsed.resources) || parsed.resources.length !== SHELL_RESOURCE_DEFINITIONS.length) {
    reject('INVALID_SAVE', 'saved resources do not match the shell contract');
  }
  const resources: Partial<Record<ShellResourceId, ShellInitialResource>> = {};
  parsed.resources.forEach((entry, index) => {
    assertPlainRecord(entry, `saved resources[${index}]`);
    assertExactKeys(entry, ['id', 'value', 'max'], `saved resources[${index}]`);
    const expected = SHELL_RESOURCE_DEFINITIONS[index];
    if (entry.id !== expected.id) reject('INVALID_SAVE', 'saved resource order does not match the shell contract');
    if (entry.max !== null) assertPositiveInteger(entry.max, `saved resources[${index}].max`);
    if (expected.id === 'stamina' && entry.max === null) reject('RESOURCE_LIMIT', 'saved stamina requires a finite max');
    resources[expected.id] = { value: entry.value as number, max: entry.max as number | null };
  });
  return { page: parsed.page as ShellPageId, history, enabledPages, resources };
}

export function createDefaultShellState(): ShellState {
  return immutableState(defaultMutableState());
}

export function serializeShellState(state: ShellState): string {
  if (!state || state.schemaVersion !== SHELL_SCHEMA_VERSION) reject('INVALID_ARGUMENT', 'shell state is invalid');
  return serializeState(state);
}

export class ShellService {
  private current: ShellState;
  private readonly persist?: ShellPersistence;
  private persistenceActive = false;
  private pendingState: ShellState | undefined;
  private queuedMutations: Array<ShellMutation<unknown>> = [];

  constructor(options: ShellServiceOptions = {}) {
    if (!options || typeof options !== 'object') reject('INVALID_ARGUMENT', 'shell service options are required');
    this.persist = options.persist;
    if (this.persist !== undefined && typeof this.persist !== 'function') reject('INVALID_ARGUMENT', 'persist must be a function');
    this.current = immutableState(initialState(options.initial));
  }

  static fromSerialized(serialized: string, persist?: ShellPersistence): ShellService {
    return new ShellService({ initial: parseSerialized(serialized), persist });
  }

  snapshot(): ShellState {
    return this.current;
  }

  serialize(): string {
    return serializeState(this.current);
  }

  save(): string {
    const serialized = serializeState(this.pendingState ?? this.current);
    if (this.persist !== undefined && !this.persistenceActive) {
      this.persistTransaction(serialized);
    }
    return serialized;
  }

  restore(serialized: string): ShellState {
    const restored = immutableState(initialState(parseSerialized(serialized)));
    return this.mutate(() => ({ next: restored, result: restored }));
  }

  resource(id: ShellResourceId): ShellResourceState {
    resourceDefinition(id, 'resource id');
    return this.current.resources.find((resource) => resource.id === id)!;
  }

  setResource(id: ShellResourceId, value: number): boolean {
    resourceDefinition(id, 'resource id');
    assertNonNegativeInteger(value, `resource ${id}`);
    return this.mutate((state) => {
      const resource = state.resources.find((entry) => entry.id === id)!;
      if (resource.max !== null && value > resource.max) reject('RESOURCE_LIMIT', `resource ${id} exceeds max`);
      if (resource.value === value) return { next: state, result: false };
      const next = cloneMutableStateFromSnapshot(state);
      next.resources.find((entry) => entry.id === id)!.value = value;
      return { next: immutableState(next), result: true };
    });
  }

  adjustResource(id: ShellResourceId, delta: number): boolean {
    resourceDefinition(id, 'resource id');
    assertSafeInteger(delta, `resource ${id} delta`);
    return this.mutate((state) => {
      const resource = state.resources.find((entry) => entry.id === id)!;
      if ((delta > 0 && resource.value > Number.MAX_SAFE_INTEGER - delta)
        || (delta < 0 && resource.value < -delta)) {
        reject('RESOURCE_LIMIT', `resource ${id} would leave the valid range`);
      }
      const value = resource.value + delta;
      if (resource.max !== null && value > resource.max) reject('RESOURCE_LIMIT', `resource ${id} exceeds max`);
      if (resource.value === value) return { next: state, result: false };
      const next = cloneMutableStateFromSnapshot(state);
      next.resources.find((entry) => entry.id === id)!.value = value;
      return { next: immutableState(next), result: true };
    });
  }

  setResourceMax(id: ShellResourceId, max: number | null): boolean {
    resourceDefinition(id, 'resource id');
    if (id === 'stamina' && max === null) reject('RESOURCE_LIMIT', 'stamina requires a finite max');
    if (max !== null) assertPositiveInteger(max, `resource ${id} max`);
    return this.mutate((state) => {
      const resource = state.resources.find((entry) => entry.id === id)!;
      if (max !== null && resource.value > max) reject('RESOURCE_LIMIT', `resource ${id} max is below current value`);
      if (resource.max === max) return { next: state, result: false };
      const next = cloneMutableStateFromSnapshot(state);
      next.resources.find((entry) => entry.id === id)!.max = max;
      return { next: immutableState(next), result: true };
    });
  }

  navigate(id: ShellPageId): ShellNavigationResult {
    const page = pageDefinition(id, 'shell page').id;
    return this.mutate((state) => {
      const currentPage = state.page;
      const selected = state.navigation.find((entry) => entry.id === page)!;
      if (!selected.enabled) return { next: state, result: { accepted: false, changed: false, page: currentPage, reason: 'disabled' } };
      if (page === currentPage) return { next: state, result: { accepted: true, changed: false, page, reason: 'same' } };
      const next = cloneMutableStateFromSnapshot(state);
      next.history.push(currentPage);
      next.page = page;
      return { next: immutableState(next), result: { accepted: true, changed: true, page, reason: 'selected' } };
    });
  }

  selectPage(id: ShellPageId): ShellNavigationResult {
    return this.navigate(id);
  }

  setPageEnabled(id: ShellPageId, enabled: boolean): boolean {
    const page = pageDefinition(id, 'shell page').id;
    assertBoolean(enabled, `page ${page} enabled`);
    return this.mutate((state) => {
      const selected = state.navigation.find((entry) => entry.id === page)!;
      if (selected.enabled === enabled) return { next: state, result: false };
      const next = cloneMutableStateFromSnapshot(state);
      next.enabled[page] = enabled;
      if (!enabled) {
        next.history = next.history.filter((historyPage) => next.enabled[historyPage]);
        if (next.page === page) next.page = findFallbackPage(next.enabled);
      }
      return { next: immutableState(next), result: true };
    });
  }

  back(): ShellNavigationResult {
    return this.mutate((state) => {
      const next = cloneMutableStateFromSnapshot(state);
      while (next.history.length > 0) {
        const candidate = next.history.pop()!;
        if (next.enabled[candidate] && candidate !== next.page) {
          next.page = candidate;
          return { next: immutableState(next), result: { accepted: true, changed: true, page: candidate, reason: 'back' } };
        }
      }
      if (next.page === state.page) return { next: state, result: { accepted: false, changed: false, page: state.page, reason: 'back' } };
      return { next: immutableState(next), result: { accepted: true, changed: true, page: next.page, reason: 'back' } };
    });
  }

  private mutate<T>(mutation: ShellMutation<T>): T {
    if (this.persistenceActive) {
      const base = this.pendingState ?? this.current;
      const { next, result } = mutation(base);
      this.pendingState = next;
      if (next !== base) this.queuedMutations.push(mutation as ShellMutation<unknown>);
      return result;
    }

    const { next, result } = mutation(this.current);
    if (next !== this.current) this.commit(next);
    return result;
  }

  private commit(next: ShellState): void {
    this.persistTransaction(serializeState(next), next);
  }

  /**
   * Persistence is a synchronous transaction boundary. Reentrant mutations
   * are evaluated against the pending state and replayed only after the
   * active payload succeeds, so an outer commit cannot overwrite them.
   */
  private persistTransaction(serialized: string, next?: ShellState): void {
    this.persistenceActive = true;
    this.pendingState = next ?? this.current;
    this.queuedMutations = [];
    try {
      this.persist?.(serialized);
    } catch (error) {
      this.persistenceActive = false;
      this.pendingState = undefined;
      this.queuedMutations = [];
      throw error;
    }

    if (next !== undefined) this.current = next;
    const queued = this.queuedMutations;
    this.persistenceActive = false;
    this.pendingState = undefined;
    this.queuedMutations = [];
    for (const mutation of queued) this.mutate(mutation);
  }
}

function cloneMutableStateFromSnapshot(snapshot: ShellState): MutableShellState {
  const enabled = {} as Record<ShellPageId, boolean>;
  for (const navigation of snapshot.navigation) enabled[navigation.id] = navigation.enabled;
  return {
    page: snapshot.page,
    history: [...snapshot.history],
    enabled,
    resources: snapshot.resources.map((resource) => ({ ...resource })),
  };
}
