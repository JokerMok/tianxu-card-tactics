import {
  CITY_BUILDING_IDS,
  CITY_PAGE_SCHEMA_VERSION,
  CityPageError,
  createDefaultCityPageData,
  type CityPageErrorCode,
  type CityBuildingId,
  type CityInteraction,
  type CityInteractionReason,
  type CityInteractionResult,
  type CityPageData,
  type CityPageServiceOptions,
  type CityPageSnapshot,
} from './CityContracts.ts';
import { createCityPageComponents, resolveCitySelectedBuildingId } from './CityComponents.ts';
import type { GameState } from '../../../../GameState.ts';

export { CityPageError, type CityPageErrorCode } from './CityContracts.ts';

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

const GAME_STATE_KEYS = ['version', 'player', 'resources', 'cards', 'deck', 'equipment', 'campaign', 'tower', 'buildings', 'inventory', 'tasks', 'expedition', 'transactions'] as const;

function cloneGameState(state: GameState): GameState {
  return {
    version: state.version,
    player: { ...state.player },
    resources: { ...state.resources },
    cards: state.cards.map((card) => ({ ...card })),
    deck: [...state.deck],
    equipment: {
      weapon: { ...state.equipment.weapon },
      helmet: { ...state.equipment.helmet },
      armor: { ...state.equipment.armor },
      cloak: { ...state.equipment.cloak },
    },
    campaign: { ...state.campaign, stars: { ...state.campaign.stars } },
    tower: { ...state.tower },
    buildings: { ...state.buildings },
    inventory: { ...state.inventory },
    tasks: Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => [id, { ...task }])) as GameState['tasks'],
    expedition: { ...state.expedition },
    transactions: [...state.transactions],
  };
}

function validateGameState(input: unknown): GameState {
  assertRecord(input, 'game state');
  assertExactKeys(input, GAME_STATE_KEYS, 'game state');
  if (input.version !== 1) fail('INVALID_DATA', 'unsupported game state version');
  assertRecord(input.resources, 'game state resources');
  assertExactKeys(input.resources, ['silver', 'crystal', 'stamina', 'staminaMax', 'towerTicket'], 'game state resources');
  for (const key of ['silver', 'crystal', 'stamina', 'staminaMax', 'towerTicket']) {
    assertSafeInteger(input.resources[key], `game state resources.${key}`);
    if (input.resources[key] < 0) fail('INVALID_DATA', `game state resources.${key} cannot be negative`);
  }
  if (input.resources.stamina > input.resources.staminaMax) fail('INVALID_DATA', 'game state stamina cannot exceed staminaMax');
  assertRecord(input.buildings, 'game state buildings');
  assertExactKeys(input.buildings, CITY_BUILDING_IDS, 'game state buildings');
  for (const id of CITY_BUILDING_IDS) {
    assertSafeInteger(input.buildings[id], `game state buildings.${id}`);
    if (input.buildings[id] <= 0 || input.buildings[id] >= Number.MAX_SAFE_INTEGER) fail('INVALID_DATA', `game state buildings.${id} is out of range`);
  }
  assertRecord(input.expedition, 'game state expedition');
  assertExactKeys(input.expedition, ['active', 'endsAt', 'reward'], 'game state expedition');
  if (typeof input.expedition.active !== 'boolean') fail('INVALID_DATA', 'game state expedition.active must be boolean');
  assertSafeInteger(input.expedition.endsAt, 'game state expedition.endsAt');
  assertSafeInteger(input.expedition.reward, 'game state expedition.reward');
  if (input.expedition.endsAt < 0 || input.expedition.endsAt >= Number.MAX_SAFE_INTEGER || input.expedition.reward < 0) {
    fail('INVALID_DATA', 'game state expedition values are out of range');
  }
  if (!Array.isArray(input.cards) || !Array.isArray(input.deck) || !Array.isArray(input.transactions)) fail('INVALID_DATA', 'game state collection fields are invalid');
  assertRecord(input.player, 'game state player');
  assertRecord(input.equipment, 'game state equipment');
  assertRecord(input.campaign, 'game state campaign');
  assertRecord(input.tower, 'game state tower');
  assertRecord(input.inventory, 'game state inventory');
  assertRecord(input.tasks, 'game state tasks');
  return cloneGameState(input as GameState);
}

function replaceGameState(target: GameState, next: GameState): void {
  Object.assign(target, cloneGameState(next));
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
    if (input.expedition.endsAt < 0 || input.expedition.endsAt >= Number.MAX_SAFE_INTEGER
      || input.expedition.rewardSilver <= 0 || input.expedition.staminaCost <= 0 || input.expedition.durationMs <= 0) {
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
  if (value < 0 || value >= Number.MAX_SAFE_INTEGER) fail('INVALID_DATA', 'interaction now is outside the safe time range');
  return value;
}

export class CityPageService {
  private data: CityPageData;
  private selectedBuildingId: CityBuildingId | null;
  private currentState: GameState | null;
  private readonly targetState?: GameState;
  private readonly persistCallback?: (serialized: string) => void;
  private readonly stateCallback?: (state: GameState) => void;
  private committing = false;

  constructor(input: CityPageData | CityPageServiceOptions = {}) {
    const options: CityPageServiceOptions = isRecord(input) && Object.prototype.hasOwnProperty.call(input, 'schemaVersion')
      ? { data: input as CityPageData }
      : input as CityPageServiceOptions;
    assertRecord(options, 'city page options');
    assertAllowedKeys(options, ['data', 'state', 'initialSelectedBuildingId', 'onSave', 'persist', 'onStateChange'], 'city page options');
    if (options.data !== undefined && options.state !== undefined) fail('INVALID_ARGUMENT', 'city data and game state cannot be combined');
    if (options.onSave !== undefined && options.persist !== undefined && options.onSave !== options.persist) fail('INVALID_ARGUMENT', 'onSave and persist cannot both be provided');
    this.persistCallback = options.persist ?? options.onSave;
    if (this.persistCallback !== undefined && typeof this.persistCallback !== 'function') fail('INVALID_ARGUMENT', 'city persistence must be a function');
    if (options.onStateChange !== undefined && typeof options.onStateChange !== 'function') fail('INVALID_ARGUMENT', 'onStateChange must be a function');
    this.stateCallback = options.onStateChange;
    this.targetState = options.state;
    this.currentState = options.state === undefined ? null : validateGameState(options.state);
    this.data = validateData(options.data ?? createDefaultCityPageData(this.currentState ?? undefined));
    const selected = options.initialSelectedBuildingId ?? null;
    if (selected !== null && !CITY_BUILDING_IDS.includes(selected as CityBuildingId)) fail('INVALID_ID', `unknown selected city building: ${selected}`);
    this.selectedBuildingId = resolveCitySelectedBuildingId(this.data, selected) as CityBuildingId | null;
  }

  get pageData(): CityPageData {
    return deepFreeze(cloneData(this.data));
  }

  get state(): GameState | null {
    return this.currentState === null ? null : deepFreeze(cloneGameState(this.currentState));
  }

  serialize(): string {
    return JSON.stringify(this.currentState === null ? this.data : this.currentState);
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
    const previousSelectedBuildingId = this.selectedBuildingId;
    const nextLevel = building.level + 1;
    if (!Number.isSafeInteger(nextLevel) || nextLevel >= Number.MAX_SAFE_INTEGER) fail('INVALID_DATA', 'building level would exceed the safe integer range');
    const nextData = cloneData(this.data);
    nextData.resources.silver -= building.upgradeCost.silver;
    nextData.resources.crystal -= building.upgradeCost.crystal;
    const nextCastleLevel = id === 'castle' ? nextLevel : nextData.buildings.find((entry) => entry.id === 'castle')!.level;
    nextData.buildings = nextData.buildings.map((entry) => {
      const level = entry.id === id ? nextLevel : entry.level;
      const silver = level * 1_400;
      const crystal = level * 40;
      if (!Number.isSafeInteger(silver) || !Number.isSafeInteger(crystal)) fail('INVALID_DATA', 'building upgrade cost would exceed the safe integer range');
      return {
        ...entry,
        level,
        maxLevel: nextCastleLevel + (entry.id === 'castle' ? 1 : 0),
        upgradeCost: { silver, crystal },
      };
    });
    const nextState = this.currentState === null ? null : cloneGameState(this.currentState);
    if (nextState !== null) {
      nextState.resources.silver = nextData.resources.silver;
      nextState.resources.crystal = nextData.resources.crystal;
      nextState.buildings[id] = nextLevel;
    }
    this.selectedBuildingId = id;
    try {
      this.commit(nextData, nextState);
    } catch (error) {
      this.selectedBuildingId = previousSelectedBuildingId;
      throw error;
    }
    return result(true, true, 'upgraded', id);
  }

  dispatchExpedition(now: number = Date.now()): CityInteractionResult {
    const expedition = this.data.expedition;
    if (expedition === null) return result(false, false, 'empty');
    const timestamp = nowValue(now);
    if (expedition.active) return result(false, false, 'active');
    if (this.data.resources.stamina < expedition.staminaCost) return result(false, false, 'insufficient');
    if (timestamp >= Number.MAX_SAFE_INTEGER - expedition.durationMs) fail('INVALID_DATA', 'expedition end time would exceed the safe integer range');
    const nextData = cloneData(this.data);
    nextData.resources.stamina -= expedition.staminaCost;
    nextData.expedition = { ...expedition, active: true, endsAt: timestamp + expedition.durationMs };
    const nextState = this.currentState === null ? null : cloneGameState(this.currentState);
    if (nextState !== null) {
      nextState.resources.stamina = nextData.resources.stamina;
      nextState.expedition = { active: true, endsAt: nextData.expedition.endsAt, reward: expedition.rewardSilver };
    }
    this.commit(nextData, nextState);
    return result(true, true, 'dispatched');
  }

  claimExpedition(now: number = Date.now()): CityInteractionResult {
    const expedition = this.data.expedition;
    if (expedition === null) return result(false, false, 'empty');
    const timestamp = nowValue(now);
    if (!expedition.active) return result(false, false, 'idle');
    if (timestamp < expedition.endsAt) return result(false, false, 'active');
    if (this.data.resources.silver > Number.MAX_SAFE_INTEGER - expedition.rewardSilver) fail('INVALID_DATA', 'silver reward would exceed the safe integer range');
    const nextData = cloneData(this.data);
    nextData.resources.silver += expedition.rewardSilver;
    nextData.expedition = { ...expedition, active: false, endsAt: 0 };
    const nextState = this.currentState === null ? null : cloneGameState(this.currentState);
    if (nextState !== null) {
      nextState.resources.silver = nextData.resources.silver;
      nextState.expedition = { active: false, endsAt: 0, reward: 0 };
    }
    this.commit(nextData, nextState);
    return result(true, true, 'claimed');
  }

  interact(action: CityInteraction): CityInteractionResult {
    assertRecord(action, 'city interaction');
    if (typeof action.type !== 'string') fail('INVALID_ARGUMENT', 'city interaction must contain a type');
    switch (action.type) {
      case 'selectBuilding':
        assertExactKeys(action, ['type', 'buildingId'], 'selectBuilding interaction');
        return this.selectBuilding(action.buildingId as string);
      case 'selectBuildingAt':
        assertExactKeys(action, ['type', 'index'], 'selectBuildingAt interaction');
        return this.selectBuildingAt(action.index as number);
      case 'upgradeBuilding':
        assertAllowedKeys(action, ['type', 'buildingId'], 'upgradeBuilding interaction');
        return this.upgradeBuilding(action.buildingId as string | undefined);
      case 'dispatchExpedition':
        assertAllowedKeys(action, ['type', 'now'], 'dispatchExpedition interaction');
        return this.dispatchExpedition(action.now as number | undefined);
      case 'claimExpedition':
        assertAllowedKeys(action, ['type', 'now'], 'claimExpedition interaction');
        return this.claimExpedition(action.now as number | undefined);
      default: fail('INVALID_ARGUMENT', `unknown city interaction: ${action.type}`);
    }
  }

  private commit(nextData: CityPageData, nextState: GameState | null): void {
    if (this.committing) fail('REENTRANT', 'city state submission is reentrant');
    const serialized = JSON.stringify(nextState === null ? nextData : nextState);
    this.committing = true;
    try {
      this.persistCallback?.(serialized);
      if (nextState !== null) this.stateCallback?.(deepFreeze(cloneGameState(nextState)));
      if (nextState !== null && this.targetState !== undefined) replaceGameState(this.targetState, nextState);
    } catch (error) {
      if (error instanceof CityPageError) throw error;
      throw new CityPageError('PERSISTENCE_FAILED', 'city state submission failed', error);
    } finally {
      this.committing = false;
    }
    this.data = nextData;
    this.currentState = nextState;
  }
}
