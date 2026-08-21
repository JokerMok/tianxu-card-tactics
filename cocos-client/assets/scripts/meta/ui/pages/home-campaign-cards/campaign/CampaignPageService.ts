import {
  CAMPAIGN_CHAPTER_ID,
  CAMPAIGN_LEVEL_IDS,
  CampaignStateError,
  CampaignStateService,
  type CampaignDefinition,
  type CampaignLevelDefinition,
  type CampaignLevelId,
  type CampaignState,
} from '../../../../campaign/CampaignState.ts';
import {
  createCampaignPageComponents,
  resolveCampaignSelectedLevelId,
} from './CampaignComponents.ts';
import {
  CAMPAIGN_PAGE_SCHEMA_VERSION,
  createDefaultCampaignPageData,
  type CampaignInteraction,
  type CampaignInteractionReason,
  type CampaignInteractionResult,
  type CampaignPageData,
  type CampaignPageServiceOptions,
  type CampaignPageSnapshot,
} from './CampaignContracts.ts';

export type CampaignPageErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_ARGUMENT'
  | 'INVALID_ID'
  | 'INVALID_NUMBER'
  | 'INVALID_DATA'
  | 'DUPLICATE_ID'
  | 'LEVEL_NOT_FOUND'
  | 'STATE_NOT_AVAILABLE'
  | 'STATE_DATA_MISMATCH';

export class CampaignPageError extends Error {
  readonly code: CampaignPageErrorCode;

  constructor(code: CampaignPageErrorCode, message: string) {
    super(message);
    this.name = 'CampaignPageError';
    this.code = code;
  }
}

function reject(code: CampaignPageErrorCode, message: string): never {
  throw new CampaignPageError(code, message);
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
  if (!isPlainRecord(value)) reject('INVALID_ARGUMENT', `${label} must be a plain object`);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    const missing = allowed.find((key) => !actual.includes(key));
    reject(missing ? 'MISSING_FIELD' : 'INVALID_DATA', `${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) reject('INVALID_DATA', `${label} contains unsupported field: ${unknown}`);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) reject('INVALID_DATA', `${label} must be a non-empty string`);
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) reject('INVALID_NUMBER', `${label} must be a safe integer`);
}

function cloneData(data: CampaignPageData): CampaignPageData {
  return {
    schemaVersion: data.schemaVersion,
    chapterId: data.chapterId,
    title: data.title,
    subtitle: data.subtitle,
    levels: data.levels.map((level) => ({ ...level, rewards: level.rewards.map((reward) => ({ ...reward })) })),
  };
}

function cloneAndFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Object.freeze(value.map((item) => cloneAndFreeze(item))) as T;
  const copy: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    copy[key] = cloneAndFreeze(child);
  }
  return Object.freeze(copy) as T;
}

function validateData(input: CampaignPageData): CampaignPageData {
  assertRecord(input, 'campaign page data');
  assertExactKeys(input, ['schemaVersion', 'chapterId', 'title', 'subtitle', 'levels'], 'campaign page data');
  if (input.schemaVersion !== CAMPAIGN_PAGE_SCHEMA_VERSION) reject('INVALID_DATA', 'unsupported campaign page schema version');
  if (input.chapterId !== CAMPAIGN_CHAPTER_ID) reject('INVALID_DATA', `campaign page chapterId must be ${CAMPAIGN_CHAPTER_ID}`);
  assertNonEmptyString(input.title, 'campaign page title');
  assertNonEmptyString(input.subtitle, 'campaign page subtitle');
  if (!Array.isArray(input.levels)) reject('INVALID_ARGUMENT', 'campaign page levels must be an array');

  const ids = new Set<string>();
  input.levels.forEach((level, index) => {
    assertRecord(level, `campaign page levels[${index}]`);
    assertExactKeys(level, [
      'id', 'label', 'title', 'description', 'objective', 'recommendedPower', 'staminaCost', 'rewards',
    ], `campaign page levels[${index}]`);
    if (!CAMPAIGN_LEVEL_IDS.includes(level.id as CampaignLevelId)) reject('INVALID_ID', `unknown campaign level: ${String(level.id)}`);
    if (ids.has(level.id as string)) reject('DUPLICATE_ID', `duplicate campaign level: ${String(level.id)}`);
    ids.add(level.id as string);
    assertNonEmptyString(level.label, `campaign page levels[${index}].label`);
    assertNonEmptyString(level.title, `campaign page levels[${index}].title`);
    assertNonEmptyString(level.description, `campaign page levels[${index}].description`);
    assertNonEmptyString(level.objective, `campaign page levels[${index}].objective`);
    assertSafeInteger(level.recommendedPower, `campaign page levels[${index}].recommendedPower`);
    assertSafeInteger(level.staminaCost, `campaign page levels[${index}].staminaCost`);
    if (level.recommendedPower < 0 || level.staminaCost <= 0) reject('INVALID_DATA', `campaign page levels[${index}] numbers are out of range`);
    if (!Array.isArray(level.rewards)) reject('INVALID_ARGUMENT', `campaign page levels[${index}].rewards must be an array`);
    level.rewards.forEach((reward, rewardIndex) => {
      assertRecord(reward, `campaign page levels[${index}].rewards[${rewardIndex}]`);
      assertExactKeys(reward, ['id', 'label', 'quantity'], `campaign page levels[${index}].rewards[${rewardIndex}]`);
      assertNonEmptyString(reward.id, `campaign page levels[${index}].rewards[${rewardIndex}].id`);
      assertNonEmptyString(reward.label, `campaign page levels[${index}].rewards[${rewardIndex}].label`);
      assertSafeInteger(reward.quantity, `campaign page levels[${index}].rewards[${rewardIndex}].quantity`);
      if (reward.quantity <= 0) reject('INVALID_DATA', `campaign page levels[${index}].rewards[${rewardIndex}].quantity must be positive`);
    });
  });
  return cloneData(input);
}

function defaultDefinition(): CampaignDefinition {
  return {
    chapterId: CAMPAIGN_CHAPTER_ID,
    levels: CAMPAIGN_LEVEL_IDS.map((id, index) => ({
      id,
      prerequisiteLevelId: index === 0 ? null : CAMPAIGN_LEVEL_IDS[index - 1],
    })),
  };
}

function seedStateForVisibleLevel(
  definition: CampaignDefinition | readonly CampaignLevelDefinition[],
  data: CampaignPageData,
): string | undefined {
  const firstVisibleLevelId = data.levels[0]?.id;
  if (firstVisibleLevelId === undefined || firstVisibleLevelId === 'L01') return undefined;
  const seeded = new CampaignStateService(definition);
  const firstVisibleIndex = CAMPAIGN_LEVEL_IDS.indexOf(firstVisibleLevelId);
  for (const levelId of CAMPAIGN_LEVEL_IDS.slice(0, firstVisibleIndex)) {
    seeded.startLevel(levelId);
    seeded.completeLevel(levelId, 1);
  }
  seeded.selectLevel(firstVisibleLevelId);
  return seeded.serialize();
}

function normalizeStateForVisibleLevel(
  stateOptions: Record<string, unknown>,
  data: CampaignPageData,
  initialState: CampaignState | string,
): string {
  const candidate = new CampaignStateService({ ...stateOptions, initialState });
  const firstVisibleLevelId = data.levels[0]?.id;
  if (firstVisibleLevelId === undefined || firstVisibleLevelId === 'L01') return candidate.serialize();
  if (candidate.activeLevelId !== null && !data.levels.some((level) => level.id === candidate.activeLevelId)) {
    reject('STATE_DATA_MISMATCH', 'a hidden campaign level cannot remain active on a partial campaign page');
  }
  if (data.levels.some((level) => level.id === candidate.selectedLevelId)) return candidate.serialize();

  const normalized = new CampaignStateService({ ...stateOptions, initialState: candidate.serialize() });
  const firstVisibleIndex = CAMPAIGN_LEVEL_IDS.indexOf(firstVisibleLevelId);
  for (const levelId of CAMPAIGN_LEVEL_IDS.slice(0, firstVisibleIndex)) {
    const progress = normalized.getLevel(levelId);
    if (progress.firstClear) continue;
    if (normalized.selectedLevelId !== levelId) normalized.selectLevel(levelId);
    normalized.startLevel(levelId);
    normalized.completeLevel(levelId, 1);
  }
  if (normalized.selectedLevelId !== firstVisibleLevelId) normalized.selectLevel(firstVisibleLevelId);
  return normalized.serialize();
}

function normalizeInjectedCampaignForVisibleLevel(
  campaign: CampaignStateService,
  data: CampaignPageData,
): CampaignStateService {
  if (data.levels[0]?.id === 'L01' || data.levels.some((level) => level.id === campaign.selectedLevelId)) return campaign;
  const current = campaign.serialize();
  const normalized = normalizeStateForVisibleLevel(
    { config: defaultDefinition() },
    data,
    current,
  );
  if (normalized !== current) campaign.restore(normalized);
  return campaign;
}

function isPageData(value: unknown): value is CampaignPageData {
  if (!isRecord(value)) return false;
  return ['schemaVersion', 'chapterId', 'title', 'subtitle']
    .some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function result(
  accepted: boolean,
  changed: boolean,
  reason: CampaignInteractionReason,
  levelId: CampaignLevelId | null = null,
): CampaignInteractionResult {
  return Object.freeze({ accepted, changed, reason, levelId });
}

function assertStateService(value: unknown): asserts value is CampaignStateService {
  if (!(value instanceof CampaignStateService)) reject('INVALID_ARGUMENT', 'campaign state service must be a CampaignStateService');
}

function projectVisibleLevelId(
  data: CampaignPageData,
  levelId: CampaignLevelId | null,
): CampaignLevelId | null {
  return levelId !== null && data.levels.some((level) => level.id === levelId) ? levelId : null;
}

export class CampaignPageService {
  private readonly data: CampaignPageData;
  private readonly campaign: CampaignStateService | null;

  constructor(input: CampaignPageData | CampaignPageServiceOptions = {}, injectedCampaign?: CampaignStateService) {
    const options: CampaignPageServiceOptions = isPageData(input)
      ? { data: input, campaign: injectedCampaign }
      : input;
    assertRecord(options, 'campaign page options');
    assertAllowedKeys(options, [
      'data', 'campaign', 'stateService', 'config', 'index', 'levels', 'levelConfigs', 'chapterId',
      'initialState', 'onSave', 'persist',
    ], 'campaign page options');
    const hasDefinitionOption = Object.prototype.hasOwnProperty.call(options, 'config')
      || Object.prototype.hasOwnProperty.call(options, 'index');
    const hasLevelsOption = Object.prototype.hasOwnProperty.call(options, 'levels')
      || Object.prototype.hasOwnProperty.call(options, 'levelConfigs');
    if (hasDefinitionOption && options.config === undefined && options.index === undefined) {
      reject('INVALID_ARGUMENT', 'campaign config options cannot be undefined');
    }
    if (hasLevelsOption && options.levels === undefined && options.levelConfigs === undefined) {
      reject('INVALID_ARGUMENT', 'campaign levels options cannot be undefined');
    }
    this.data = options.data === undefined
      ? createDefaultCampaignPageData()
      : validateData(options.data);

    const suppliedCampaign = options.campaign ?? options.stateService ?? injectedCampaign;
    if (this.data.levels.length === 0) {
      if (
        suppliedCampaign !== undefined
        || options.config !== undefined
        || options.index !== undefined
        || options.levels !== undefined
        || options.levelConfigs !== undefined
        || options.initialState !== undefined
      ) {
        reject('STATE_DATA_MISMATCH', 'an empty campaign page cannot be backed by campaign state');
      }
      if (options.onSave !== undefined || options.persist !== undefined) reject('STATE_NOT_AVAILABLE', 'an empty campaign page cannot persist campaign state');
      this.campaign = null;
      return;
    }
    if (suppliedCampaign !== undefined) {
      assertStateService(suppliedCampaign);
      if (
        options.config !== undefined
        || options.index !== undefined
        || options.levels !== undefined
        || options.levelConfigs !== undefined
        || options.chapterId !== undefined
        || options.initialState !== undefined
        || options.onSave !== undefined
        || options.persist !== undefined
      ) {
        reject('INVALID_ARGUMENT', 'campaign state service options cannot be combined with an injected service');
      }
      this.campaign = normalizeInjectedCampaignForVisibleLevel(suppliedCampaign, this.data);
      return;
    }
    const configuredDefinition = options.config !== undefined ? options.config : options.index;
    const configuredLevels = options.levels !== undefined ? options.levels : options.levelConfigs;
    const definition = configuredDefinition ?? configuredLevels ?? defaultDefinition();
    const stateOptions = configuredDefinition !== undefined
      ? { config: configuredDefinition }
      : configuredLevels !== undefined
        ? { levels: configuredLevels, chapterId: options.chapterId }
        : { config: defaultDefinition() };
    const initialState = options.initialState === undefined
      ? seedStateForVisibleLevel(definition, this.data)
      : this.data.levels[0]?.id === 'L01'
        ? options.initialState
        : normalizeStateForVisibleLevel(
          stateOptions,
          this.data,
          options.initialState,
        );
    this.campaign = new CampaignStateService({
      ...stateOptions,
      initialState,
      onSave: options.onSave,
      persist: options.persist,
    });
  }

  get campaignState(): CampaignStateService | null {
    return this.campaign;
  }

  get pageData(): CampaignPageData {
    return cloneData(this.data);
  }

  snapshot(): CampaignPageSnapshot {
    const state = this.campaign?.snapshot() ?? null;
    return cloneAndFreeze({
      schemaVersion: CAMPAIGN_PAGE_SCHEMA_VERSION,
      pageId: 'campaign',
      selectedLevelId: state === null
        ? this.data.levels[0]?.id ?? null
        : resolveCampaignSelectedLevelId(this.data, state),
      activeLevelId: projectVisibleLevelId(this.data, state?.activeLevelId ?? null),
      state,
      components: createCampaignPageComponents(this.data, state),
    }) as CampaignPageSnapshot;
  }

  interact(action: CampaignInteraction): CampaignInteractionResult {
    if (!isRecord(action) || typeof action.type !== 'string') reject('INVALID_ARGUMENT', 'campaign interaction must contain a type');
    switch (action.type) {
      case 'selectLevel':
        return this.selectLevel(action.levelId);
      case 'startLevel':
        return this.startLevel(action.levelId);
      case 'completeLevel':
        return this.completeLevel(action.levelId, action.stars);
      case 'failLevel':
        return this.failLevel(action.levelId);
      default:
        reject('INVALID_ARGUMENT', `unknown campaign interaction: ${action.type}`);
    }
  }

  selectLevel(levelId: string): CampaignInteractionResult {
    if (!this.campaign) return result(false, false, 'empty');
    this.assertVisibleLevel(levelId);
    const before = this.campaign.selectedLevelId;
    const after = this.campaign.selectLevel(levelId);
    const changed = before !== after.selectedLevelId;
    return result(true, changed, changed ? 'selected' : 'same', after.selectedLevelId);
  }

  startLevel(levelId?: string): CampaignInteractionResult {
    if (!this.campaign) return result(false, false, 'empty');
    const id = levelId ?? this.campaign.selectedLevelId;
    this.assertVisibleLevel(id);
    const after = this.campaign.startLevel(levelId);
    return result(true, true, 'started', after.activeLevelId);
  }

  completeLevel(stars: number): CampaignInteractionResult;
  completeLevel(levelId: string | undefined, stars: number): CampaignInteractionResult;
  completeLevel(levelIdOrStars: string | number | undefined, starsArgument?: number): CampaignInteractionResult {
    if (!this.campaign) return result(false, false, 'empty');
    const activeId = this.campaign.activeLevelId;
    if (typeof levelIdOrStars === 'string') this.assertVisibleLevel(levelIdOrStars);
    if (activeId !== null) this.assertVisibleLevel(activeId);
    const after = typeof levelIdOrStars === 'number'
      ? this.campaign.completeLevel(levelIdOrStars)
      : this.campaign.completeLevel(levelIdOrStars, starsArgument);
    return result(true, true, 'completed', after.selectedLevelId);
  }

  failLevel(levelId?: string): CampaignInteractionResult {
    if (!this.campaign) return result(false, false, 'empty');
    const id = levelId ?? this.campaign.activeLevelId;
    if (id !== null && id !== undefined) this.assertVisibleLevel(id);
    const after = this.campaign.failLevel(levelId);
    return result(true, true, 'failed', after.selectedLevelId);
  }

  serialize(): string {
    if (!this.campaign) reject('STATE_NOT_AVAILABLE', 'campaign state is not available for an empty page');
    return this.campaign.serialize();
  }

  save(): string {
    if (!this.campaign) reject('STATE_NOT_AVAILABLE', 'campaign state is not available for an empty page');
    return this.campaign.save();
  }

  restore(serialized: string): CampaignPageSnapshot {
    if (!this.campaign) reject('STATE_NOT_AVAILABLE', 'campaign state is not available for an empty page');
    this.campaign.restore(serialized);
    return this.snapshot();
  }

  private assertVisibleLevel(levelId: string): asserts levelId is CampaignLevelId {
    if (typeof levelId !== 'string' || !CAMPAIGN_LEVEL_IDS.includes(levelId as CampaignLevelId)) {
      throw new CampaignStateError('INVALID_LEVEL_ID', `invalid campaign level: ${String(levelId)}`);
    }
    if (!this.data.levels.some((level) => level.id === levelId)) reject('LEVEL_NOT_FOUND', `campaign page does not contain level: ${levelId}`);
  }
}

export function createCampaignPageService(
  input: CampaignPageData | CampaignPageServiceOptions = {},
): CampaignPageService {
  return new CampaignPageService(input);
}
