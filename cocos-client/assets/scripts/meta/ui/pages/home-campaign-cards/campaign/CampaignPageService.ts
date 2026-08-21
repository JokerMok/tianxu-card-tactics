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
import { createCampaignPageComponents } from './CampaignComponents.ts';
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

function isPageData(value: unknown): value is CampaignPageData {
  if (!isRecord(value)) return false;
  return ['schemaVersion', 'chapterId', 'title', 'subtitle', 'levels']
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
      this.campaign = suppliedCampaign;
      return;
    }
    const configuredDefinition = options.config ?? options.index;
    const configuredLevels = options.levels ?? options.levelConfigs;
    const stateOptions = configuredDefinition !== undefined
      ? { config: configuredDefinition }
      : configuredLevels !== undefined
        ? { levels: configuredLevels, chapterId: options.chapterId }
        : { config: defaultDefinition() };
    this.campaign = new CampaignStateService({
      ...stateOptions,
      initialState: options.initialState,
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
    return Object.freeze({
      schemaVersion: CAMPAIGN_PAGE_SCHEMA_VERSION,
      pageId: 'campaign',
      selectedLevelId: state?.selectedLevelId ?? null,
      activeLevelId: state?.activeLevelId ?? null,
      state,
      components: createCampaignPageComponents(this.data, state),
    });
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
