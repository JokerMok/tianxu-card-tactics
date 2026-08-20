import {
  CAMPAIGN_CHAPTER_ID,
  CAMPAIGN_LEVEL_IDS,
  restoreCampaignState,
  type CampaignState,
} from '../../campaign/CampaignState.ts';
import {
  CHAPTER01_STORY_NODE_IDS,
  STORY_SAVE_VERSION,
  type Chapter01StorySnapshot,
} from '../../story/Chapter01Story.ts';

/** Root save version 2 adds the durable reward outbox; v1 saves are rejected, not silently reinterpreted. */
export const MAINLINE_TASK_SCHEMA_VERSION = 2 as const;
export const MAINLINE_REWARD_OUTBOX_SCHEMA_VERSION = 1 as const;
export const MAINLINE_CHAPTER_ID = CAMPAIGN_CHAPTER_ID;
export const CHAPTER01_LEVEL_IDS = CAMPAIGN_LEVEL_IDS;

export const MAINLINE_FEATURE_IDS = Object.freeze([
  'campaign',
  'tasks',
  'deck',
  'hero',
  'adventure',
  'city',
  'inventory',
  'chapter02',
] as const);

export type MainlineFeatureId = typeof MAINLINE_FEATURE_IDS[number] | (string & {});
export type MainlineEventType = 'CAMPAIGN_LEVEL_CLEARED' | 'STORY_NODE_READ' | 'DECK_UPDATED';

export interface MainlineTaskTrigger {
  readonly type: MainlineEventType;
  readonly levelId?: string;
  readonly nodeId?: string;
  readonly deckId?: string;
}

export interface MainlineTaskDefinition {
  readonly id: string;
  readonly title?: string;
  readonly target: number;
  readonly trigger: MainlineTaskTrigger;
  readonly unlocks: readonly string[];
  readonly rewardPoolId?: string;
}

export interface MainlineTaskEvent {
  readonly type: MainlineEventType;
  readonly levelId?: string;
  readonly nodeId?: string;
  readonly deckId?: string;
  /** Required when a repeatable trigger has no naturally unique source key. */
  readonly key?: string;
}

export interface MainlineTaskProgress {
  readonly id: string;
  readonly target: number;
  readonly progress: number;
  readonly completed: boolean;
  readonly claimed: boolean;
  readonly eventKeys: readonly string[];
}

export interface MainlineFeatureProgress {
  readonly id: string;
  readonly unlocked: boolean;
  readonly unlockedByTaskId: string | null;
}

export interface MainlineChapterProgress {
  readonly completedTaskCount: number;
  readonly totalTaskCount: number;
  /** A normalized value in [0, 1]. */
  readonly progress: number;
  readonly completed: boolean;
  readonly currentTaskId: string | null;
}

export type MainlineRewardOutboxStatus = 'PENDING' | 'ACKNOWLEDGED';

export interface MainlineRewardOutboxEntry {
  readonly businessKey: string;
  readonly taskId: string;
  readonly status: MainlineRewardOutboxStatus;
}

export interface MainlineRewardOutboxState {
  readonly schemaVersion: typeof MAINLINE_REWARD_OUTBOX_SCHEMA_VERSION;
  readonly entries: Readonly<Record<string, MainlineRewardOutboxEntry>>;
}

export interface MainlineTaskState {
  readonly schemaVersion: typeof MAINLINE_TASK_SCHEMA_VERSION;
  readonly chapterId: typeof MAINLINE_CHAPTER_ID;
  readonly tasks: Readonly<Record<string, MainlineTaskProgress>>;
  readonly features: Readonly<Record<string, MainlineFeatureProgress>>;
  readonly chapter: MainlineChapterProgress;
  readonly rewardOutbox: MainlineRewardOutboxState;
}

export interface MainlineTaskServiceOptions {
  readonly definitions?: readonly MainlineTaskDefinition[];
  readonly initialFeatures?: readonly string[];
  readonly initialState?: MainlineTaskState | string;
  readonly state?: MainlineTaskState | string;
  readonly persist?: (serialized: string) => void;
  readonly onSave?: (serialized: string) => void;
}

export type MainlineTaskErrorCode =
  | 'INVALID_ARGUMENT'
  | 'INVALID_CONFIG'
  | 'INVALID_EVENT'
  | 'INVALID_TASK_ID'
  | 'INVALID_STATE'
  | 'INVALID_SAVE'
  | 'SAVE_VERSION'
  | 'CHAPTER_MISMATCH'
  | 'TASK_NOT_AVAILABLE'
  | 'CHAPTER_COMPLETE'
  | 'INVALID_UNLOCK'
  | 'INVALID_SYNC'
  | 'NOT_READY'
  | 'REWARD_FAILED'
  | 'REENTRANT'
  | 'PERSISTENCE_FAILED';

export class MainlineTaskError extends Error {
  readonly code: MainlineTaskErrorCode;
  readonly reason: MainlineTaskErrorCode;
  readonly cause?: unknown;

  constructor(code: MainlineTaskErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'MainlineTaskError';
    this.code = code;
    this.reason = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export type MainlineAdvanceCode = 'APPLIED' | 'DUPLICATE_EVENT';

export interface MainlineAdvanceResult {
  readonly applied: boolean;
  readonly code: MainlineAdvanceCode;
  readonly taskId: string;
  readonly state: MainlineTaskState;
}

export type MainlineClaimCode = 'APPLIED' | 'DUPLICATE' | 'NOT_READY';

export interface MainlineClaimResult {
  readonly applied: boolean;
  readonly code: MainlineClaimCode;
  readonly taskId: string;
  readonly businessKey: string;
  readonly state: MainlineTaskState;
}

export type MainlineRewardAcknowledgeCode = 'APPLIED' | 'DUPLICATE';

export interface MainlineRewardAcknowledgeResult {
  readonly applied: boolean;
  readonly code: MainlineRewardAcknowledgeCode;
  readonly businessKey: string;
  readonly state: MainlineTaskState;
}

export type MainlineRewardFlushCode = 'DELIVERED' | 'FAILED';

export interface MainlineRewardFlushResult {
  readonly code: MainlineRewardFlushCode;
  readonly taskId: string;
  readonly businessKey: string;
  readonly acknowledged: boolean;
  readonly state: MainlineTaskState;
}

/**
 * Legacy delivery callback, called only after the claim state has been persisted.
 * A normal return means only that this delivery attempt returned; it is not an
 * exactly-once acknowledgement. Call acknowledgeReward with the same businessKey
 * after the external sink explicitly confirms success.
 */
export type MainlineRewardClaim = (
  task: MainlineTaskDefinition,
  businessKey: string,
) => void;

const DEFAULT_INITIAL_FEATURES = Object.freeze(['campaign', 'tasks'] as const);
const EVENT_TYPES = Object.freeze([
  'CAMPAIGN_LEVEL_CLEARED',
  'STORY_NODE_READ',
  'DECK_UPDATED',
] as const);

const DEFAULT_FEATURE_UNLOCKS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  L01: Object.freeze(['deck']),
  L03: Object.freeze(['hero']),
  L05: Object.freeze(['adventure']),
  L07: Object.freeze(['city']),
  L09: Object.freeze(['inventory']),
  L12: Object.freeze(['chapter02']),
});

const CAMPAIGN_DEFINITION = Object.freeze(CAMPAIGN_LEVEL_IDS.map((id, index) => Object.freeze({
  id,
  prerequisiteLevelId: index === 0 ? null : CAMPAIGN_LEVEL_IDS[index - 1],
})));

export const MAINLINE_TASK_DEFINITIONS: readonly MainlineTaskDefinition[] = Object.freeze(
  CHAPTER01_LEVEL_IDS.map((levelId) => Object.freeze({
    id: `M4-10-${levelId}`,
    title: `完成${levelId}`,
    target: 1,
    trigger: Object.freeze({ type: 'CAMPAIGN_LEVEL_CLEARED' as const, levelId }),
    unlocks: Object.freeze([...(DEFAULT_FEATURE_UNLOCKS[levelId] ?? [])]),
    rewardPoolId: `chapter01:${levelId}`,
  })),
);

interface NormalizedConfig {
  readonly definitions: readonly MainlineTaskDefinition[];
  readonly featureIds: readonly string[];
  readonly initialFeatures: readonly string[];
}

interface MutableTaskProgress {
  id: string;
  target: number;
  progress: number;
  completed: boolean;
  claimed: boolean;
  eventKeys: string[];
}

interface MutableFeatureProgress {
  id: string;
  unlocked: boolean;
  unlockedByTaskId: string | null;
}

interface MutableState {
  schemaVersion: typeof MAINLINE_TASK_SCHEMA_VERSION;
  chapterId: typeof MAINLINE_CHAPTER_ID;
  tasks: Record<string, MutableTaskProgress>;
  features: Record<string, MutableFeatureProgress>;
  chapter: MainlineChapterProgress;
  rewardOutbox: MutableRewardOutboxState;
}

interface MutableRewardOutboxEntry {
  businessKey: string;
  taskId: string;
  status: MainlineRewardOutboxStatus;
}

interface MutableRewardOutboxState {
  schemaVersion: typeof MAINLINE_REWARD_OUTBOX_SCHEMA_VERSION;
  entries: Record<string, MutableRewardOutboxEntry>;
}

function fail(code: MainlineTaskErrorCode, message: string, cause?: unknown): never {
  throw new MainlineTaskError(code, message, cause);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPlainRecord(
  value: unknown,
  label: string,
  code: MainlineTaskErrorCode = 'INVALID_ARGUMENT',
): asserts value is Record<string, unknown> {
  if (!isPlainRecord(value)) fail(code, `${label} must be a plain object`);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
  code: MainlineTaskErrorCode,
): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    fail(code, `${label} contains unexpected or missing fields`);
  }
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
  code: MainlineTaskErrorCode,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    fail(code, `${label} contains unexpected fields`);
  }
}

function assertIdentifier(value: unknown, label: string, code: MainlineTaskErrorCode): asserts value is string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value) {
    fail(code, `${label} must be a non-empty trimmed string`);
  }
}

function assertSafeInteger(value: unknown, label: string, code: MainlineTaskErrorCode): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) fail(code, `${label} must be a safe integer`);
}

function assertBoolean(value: unknown, label: string, code: MainlineTaskErrorCode): asserts value is boolean {
  if (typeof value !== 'boolean') fail(code, `${label} must be boolean`);
}

function assertChapterId(value: unknown, label: string, code: MainlineTaskErrorCode): asserts value is typeof MAINLINE_CHAPTER_ID {
  if (value !== MAINLINE_CHAPTER_ID) fail(code, `${label} must be ${MAINLINE_CHAPTER_ID}`);
}

function assertEventType(value: unknown, label: string, code: MainlineTaskErrorCode): asserts value is MainlineEventType {
  if (typeof value !== 'string' || !EVENT_TYPES.includes(value as MainlineEventType)) {
    fail(code, `${label} is not a supported mainline event type`);
  }
}

function validateLevelId(value: string, label: string, code: MainlineTaskErrorCode): void {
  if (!CAMPAIGN_LEVEL_IDS.includes(value as (typeof CAMPAIGN_LEVEL_IDS)[number])) {
    fail(code, `${label} is not a CHAPTER01 level`);
  }
}

function validateTrigger(value: unknown, label: string): MainlineTaskTrigger {
  assertPlainRecord(value, label, 'INVALID_CONFIG');
  assertEventType(value.type, `${label}.type`, 'INVALID_CONFIG');
  switch (value.type) {
    case 'CAMPAIGN_LEVEL_CLEARED':
      assertExactKeys(value, ['type', 'levelId'], label, 'INVALID_CONFIG');
      assertIdentifier(value.levelId, `${label}.levelId`, 'INVALID_CONFIG');
      if (value.levelId !== '*') validateLevelId(value.levelId, `${label}.levelId`, 'INVALID_CONFIG');
      return Object.freeze({ type: value.type, levelId: value.levelId });
    case 'STORY_NODE_READ':
      assertExactKeys(value, ['type', 'nodeId'], label, 'INVALID_CONFIG');
      assertIdentifier(value.nodeId, `${label}.nodeId`, 'INVALID_CONFIG');
      return Object.freeze({ type: value.type, nodeId: value.nodeId });
    case 'DECK_UPDATED':
      assertAllowedKeys(value, ['type', 'deckId'], label, 'INVALID_CONFIG');
      if (value.deckId !== undefined) assertIdentifier(value.deckId, `${label}.deckId`, 'INVALID_CONFIG');
      return Object.freeze({ type: value.type, ...(value.deckId === undefined ? {} : { deckId: value.deckId }) });
    default:
      return fail('INVALID_CONFIG', `${label}.type is invalid`);
  }
}

function normalizeConfig(
  definitionsInput: readonly MainlineTaskDefinition[],
  initialFeaturesInput: readonly string[] = DEFAULT_INITIAL_FEATURES,
): NormalizedConfig {
  if (!Array.isArray(definitionsInput) || definitionsInput.length === 0) {
    fail('INVALID_CONFIG', 'mainline task definitions must be a non-empty array');
  }
  if (!Array.isArray(initialFeaturesInput)) fail('INVALID_ARGUMENT', 'initialFeatures must be an array');

  const definitions: MainlineTaskDefinition[] = [];
  const ids = new Set<string>();
  const featureIds: string[] = [];
  const featureSet = new Set<string>();
  const addFeature = (featureId: string): void => {
    if (!featureSet.has(featureId)) {
      featureSet.add(featureId);
      featureIds.push(featureId);
    }
  };

  for (const [index, value] of definitionsInput.entries()) {
    const label = `definitions[${index}]`;
    assertPlainRecord(value, label, 'INVALID_CONFIG');
    assertAllowedKeys(value, ['id', 'title', 'target', 'trigger', 'unlocks', 'rewardPoolId'], label, 'INVALID_CONFIG');
    for (const key of ['id', 'target', 'trigger', 'unlocks']) {
      if (!Object.prototype.hasOwnProperty.call(value, key)) fail('INVALID_CONFIG', `${label}.${key} is required`);
    }
    assertIdentifier(value.id, `${label}.id`, 'INVALID_CONFIG');
    if (ids.has(value.id)) fail('INVALID_CONFIG', `${label}.id is duplicated`);
    ids.add(value.id);
    if (value.title !== undefined) assertIdentifier(value.title, `${label}.title`, 'INVALID_CONFIG');
    assertSafeInteger(value.target, `${label}.target`, 'INVALID_CONFIG');
    if (value.target <= 0) fail('INVALID_CONFIG', `${label}.target must be positive`);
    const trigger = validateTrigger(value.trigger, `${label}.trigger`);
    if (!Array.isArray(value.unlocks)) fail('INVALID_CONFIG', `${label}.unlocks must be an array`);
    const unlocks: string[] = [];
    const unlockSet = new Set<string>();
    for (const [unlockIndex, unlock] of value.unlocks.entries()) {
      assertIdentifier(unlock, `${label}.unlocks[${unlockIndex}]`, 'INVALID_CONFIG');
      if (unlockSet.has(unlock)) fail('INVALID_CONFIG', `${label}.unlocks contains a duplicate feature`);
      unlockSet.add(unlock);
      unlocks.push(unlock);
      addFeature(unlock);
    }
    if (value.rewardPoolId !== undefined) assertIdentifier(value.rewardPoolId, `${label}.rewardPoolId`, 'INVALID_CONFIG');
    definitions.push(Object.freeze({
      id: value.id,
      ...(value.title === undefined ? {} : { title: value.title }),
      target: value.target,
      trigger,
      unlocks: Object.freeze(unlocks),
      ...(value.rewardPoolId === undefined ? {} : { rewardPoolId: value.rewardPoolId }),
    }));
  }

  const initialFeatures: string[] = [];
  const initialFeatureSet = new Set<string>();
  for (const [index, feature] of initialFeaturesInput.entries()) {
    assertIdentifier(feature, `initialFeatures[${index}]`, 'INVALID_CONFIG');
    if (initialFeatureSet.has(feature)) fail('INVALID_CONFIG', `initialFeatures contains duplicate feature: ${feature}`);
    initialFeatureSet.add(feature);
    initialFeatures.push(feature);
    addFeature(feature);
  }

  return Object.freeze({
    definitions: Object.freeze(definitions),
    featureIds: Object.freeze(featureIds),
    initialFeatures: Object.freeze(initialFeatures),
  });
}

function initialMutableState(config: NormalizedConfig): MutableState {
  const tasks: Record<string, MutableTaskProgress> = {};
  for (const definition of config.definitions) {
    tasks[definition.id] = {
      id: definition.id,
      target: definition.target,
      progress: 0,
      completed: false,
      claimed: false,
      eventKeys: [],
    };
  }
  const features: Record<string, MutableFeatureProgress> = {};
  for (const featureId of config.featureIds) {
    features[featureId] = {
      id: featureId,
      unlocked: config.initialFeatures.includes(featureId),
      unlockedByTaskId: null,
    };
  }
  return {
    schemaVersion: MAINLINE_TASK_SCHEMA_VERSION,
    chapterId: MAINLINE_CHAPTER_ID,
    tasks,
    features,
    chapter: {
      completedTaskCount: 0,
      totalTaskCount: config.definitions.length,
      progress: 0,
      completed: false,
      currentTaskId: config.definitions[0].id,
    },
    rewardOutbox: {
      schemaVersion: MAINLINE_REWARD_OUTBOX_SCHEMA_VERSION,
      entries: {},
    },
  };
}

function copyMutableState(state: MainlineTaskState): MutableState {
  const tasks: Record<string, MutableTaskProgress> = {};
  for (const [id, task] of Object.entries(state.tasks)) tasks[id] = { ...task, eventKeys: [...task.eventKeys] };
  const features: Record<string, MutableFeatureProgress> = {};
  for (const [id, feature] of Object.entries(state.features)) features[id] = { ...feature };
  const rewardEntries: Record<string, MutableRewardOutboxEntry> = {};
  for (const [businessKey, entry] of Object.entries(state.rewardOutbox.entries)) {
    rewardEntries[businessKey] = { ...entry };
  }
  return {
    schemaVersion: state.schemaVersion,
    chapterId: state.chapterId,
    tasks,
    features,
    chapter: { ...state.chapter },
    rewardOutbox: {
      schemaVersion: state.rewardOutbox.schemaVersion,
      entries: rewardEntries,
    },
  };
}

function deriveFeatures(
  config: NormalizedConfig,
  tasks: Record<string, MutableTaskProgress>,
): Record<string, MutableFeatureProgress> {
  const features: Record<string, MutableFeatureProgress> = {};
  for (const featureId of config.featureIds) {
    features[featureId] = {
      id: featureId,
      unlocked: config.initialFeatures.includes(featureId),
      unlockedByTaskId: null,
    };
  }
  for (const definition of config.definitions) {
    if (!tasks[definition.id].completed) continue;
    for (const featureId of definition.unlocks) {
      const feature = features[featureId];
      if (!feature.unlocked) {
        feature.unlocked = true;
        feature.unlockedByTaskId = definition.id;
      }
    }
  }
  return features;
}

function deriveChapter(config: NormalizedConfig, tasks: Record<string, MutableTaskProgress>): MainlineChapterProgress {
  const completedTaskCount = config.definitions.reduce((count, definition) => count + (tasks[definition.id].completed ? 1 : 0), 0);
  const currentTaskId = config.definitions.find((definition) => !tasks[definition.id].completed)?.id ?? null;
  return {
    completedTaskCount,
    totalTaskCount: config.definitions.length,
    progress: completedTaskCount / config.definitions.length,
    completed: completedTaskCount === config.definitions.length,
    currentTaskId,
  };
}

function businessKeyForTask(taskId: string): string {
  return `mainline:${MAINLINE_CHAPTER_ID}:${taskId}`;
}

function validateRewardOutbox(
  value: unknown,
  config: NormalizedConfig,
  tasks: Record<string, MutableTaskProgress>,
): MutableRewardOutboxState {
  assertPlainRecord(value, 'mainline task state.rewardOutbox', 'INVALID_STATE');
  assertExactKeys(value, ['schemaVersion', 'entries'], 'mainline task state.rewardOutbox', 'INVALID_STATE');
  if (value.schemaVersion !== MAINLINE_REWARD_OUTBOX_SCHEMA_VERSION) {
    fail('SAVE_VERSION', 'unsupported mainline reward outbox save version');
  }
  assertPlainRecord(value.entries, 'mainline task state.rewardOutbox.entries', 'INVALID_STATE');
  const claimedBusinessKeys = config.definitions
    .filter((definition) => tasks[definition.id].claimed)
    .map((definition) => businessKeyForTask(definition.id));
  assertExactKeys(
    value.entries,
    claimedBusinessKeys,
    'mainline task state.rewardOutbox.entries',
    'INVALID_STATE',
  );

  const entries: Record<string, MutableRewardOutboxEntry> = {};
  for (const definition of config.definitions) {
    if (!tasks[definition.id].claimed) continue;
    const businessKey = businessKeyForTask(definition.id);
    const entry = value.entries[businessKey];
    assertPlainRecord(entry, `mainline task state.rewardOutbox.entries.${businessKey}`, 'INVALID_STATE');
    assertExactKeys(
      entry,
      ['businessKey', 'taskId', 'status'],
      `mainline task state.rewardOutbox.entries.${businessKey}`,
      'INVALID_STATE',
    );
    if (entry.businessKey !== businessKey || entry.taskId !== definition.id) {
      fail('INVALID_STATE', `reward outbox entry does not match ${definition.id}`);
    }
    if (entry.status !== 'PENDING' && entry.status !== 'ACKNOWLEDGED') {
      fail('INVALID_STATE', `reward outbox entry status is invalid: ${businessKey}`);
    }
    entries[businessKey] = {
      businessKey,
      taskId: definition.id,
      status: entry.status,
    };
  }
  return {
    schemaVersion: MAINLINE_REWARD_OUTBOX_SCHEMA_VERSION,
    entries,
  };
}

function freezeState(state: MutableState): MainlineTaskState {
  const tasks: Record<string, MainlineTaskProgress> = {};
  for (const [id, task] of Object.entries(state.tasks)) {
    tasks[id] = Object.freeze({ ...task, eventKeys: Object.freeze([...task.eventKeys]) });
  }
  const features: Record<string, MainlineFeatureProgress> = {};
  for (const [id, feature] of Object.entries(state.features)) features[id] = Object.freeze({ ...feature });
  const rewardEntries: Record<string, MainlineRewardOutboxEntry> = {};
  for (const [businessKey, entry] of Object.entries(state.rewardOutbox.entries)) {
    rewardEntries[businessKey] = Object.freeze({ ...entry });
  }
  return Object.freeze({
    schemaVersion: MAINLINE_TASK_SCHEMA_VERSION,
    chapterId: MAINLINE_CHAPTER_ID,
    tasks: Object.freeze(tasks),
    features: Object.freeze(features),
    chapter: Object.freeze({ ...state.chapter }),
    rewardOutbox: Object.freeze({
      schemaVersion: MAINLINE_REWARD_OUTBOX_SCHEMA_VERSION,
      entries: Object.freeze(rewardEntries),
    }),
  });
}

function validateState(state: unknown, config: NormalizedConfig): MainlineTaskState {
  assertPlainRecord(state, 'mainline task state', 'INVALID_STATE');
  if (state.schemaVersion !== MAINLINE_TASK_SCHEMA_VERSION) fail('SAVE_VERSION', 'unsupported mainline task save version');
  assertExactKeys(state, ['schemaVersion', 'chapterId', 'tasks', 'features', 'chapter', 'rewardOutbox'], 'mainline task state', 'INVALID_STATE');
  assertChapterId(state.chapterId, 'mainline task state.chapterId', 'CHAPTER_MISMATCH');
  assertPlainRecord(state.tasks, 'mainline task state.tasks', 'INVALID_STATE');
  assertExactKeys(state.tasks, config.definitions.map(({ id }) => id), 'mainline task state.tasks', 'INVALID_STATE');

  const tasks: Record<string, MutableTaskProgress> = {};
  for (const definition of config.definitions) {
    const value = state.tasks[definition.id];
    assertPlainRecord(value, `mainline task state.tasks.${definition.id}`, 'INVALID_STATE');
    assertExactKeys(value, ['id', 'target', 'progress', 'completed', 'claimed', 'eventKeys'], `mainline task state.tasks.${definition.id}`, 'INVALID_STATE');
    if (value.id !== definition.id || value.target !== definition.target) fail('INVALID_STATE', `task definition mismatch: ${definition.id}`);
    assertSafeInteger(value.progress, `${definition.id}.progress`, 'INVALID_STATE');
    if (value.progress < 0 || value.progress > definition.target) fail('INVALID_STATE', `${definition.id}.progress is out of range`);
    assertBoolean(value.completed, `${definition.id}.completed`, 'INVALID_STATE');
    assertBoolean(value.claimed, `${definition.id}.claimed`, 'INVALID_STATE');
    if (value.completed !== (value.progress >= definition.target)) fail('INVALID_STATE', `${definition.id}.completed is not derived from progress`);
    if (value.claimed && !value.completed) fail('INVALID_STATE', `${definition.id}.claimed requires completion`);
    if (!Array.isArray(value.eventKeys)) fail('INVALID_STATE', `${definition.id}.eventKeys must be an array`);
    const eventKeys: string[] = [];
    const eventKeySet = new Set<string>();
    for (const [index, key] of value.eventKeys.entries()) {
      assertIdentifier(key, `${definition.id}.eventKeys[${index}]`, 'INVALID_STATE');
      if (eventKeySet.has(key)) fail('INVALID_STATE', `${definition.id}.eventKeys contains a duplicate`);
      eventKeySet.add(key);
      eventKeys.push(key);
    }
    if (eventKeys.length !== value.progress) fail('INVALID_STATE', `${definition.id}.progress does not match eventKeys`);
    tasks[definition.id] = {
      id: definition.id,
      target: definition.target,
      progress: value.progress,
      completed: value.completed,
      claimed: value.claimed,
      eventKeys,
    };
  }

  const rewardOutbox = validateRewardOutbox(state.rewardOutbox, config, tasks);

  assertPlainRecord(state.features, 'mainline task state.features', 'INVALID_STATE');
  assertExactKeys(state.features, config.featureIds, 'mainline task state.features', 'INVALID_STATE');
  const derivedFeatures = deriveFeatures(config, tasks);
  const features: Record<string, MutableFeatureProgress> = {};
  for (const featureId of config.featureIds) {
    const value = state.features[featureId];
    assertPlainRecord(value, `mainline task state.features.${featureId}`, 'INVALID_STATE');
    assertExactKeys(value, ['id', 'unlocked', 'unlockedByTaskId'], `mainline task state.features.${featureId}`, 'INVALID_STATE');
    assertBoolean(value.unlocked, `${featureId}.unlocked`, 'INVALID_UNLOCK');
    if (value.id !== featureId || value.unlocked !== derivedFeatures[featureId].unlocked || value.unlockedByTaskId !== derivedFeatures[featureId].unlockedByTaskId) {
      fail('INVALID_UNLOCK', `feature ${featureId} is not derived from mainline progress`);
    }
    if (value.unlockedByTaskId !== null && !tasks[value.unlockedByTaskId]?.completed) {
      fail('INVALID_UNLOCK', `feature ${featureId} references an incomplete task`);
    }
    features[featureId] = {
      id: featureId,
      unlocked: value.unlocked,
      unlockedByTaskId: value.unlockedByTaskId,
    };
  }

  assertPlainRecord(state.chapter, 'mainline task state.chapter', 'INVALID_STATE');
  assertExactKeys(state.chapter, ['completedTaskCount', 'totalTaskCount', 'progress', 'completed', 'currentTaskId'], 'mainline task state.chapter', 'INVALID_STATE');
  assertSafeInteger(state.chapter.completedTaskCount, 'chapter.completedTaskCount', 'INVALID_STATE');
  assertSafeInteger(state.chapter.totalTaskCount, 'chapter.totalTaskCount', 'INVALID_STATE');
  if (state.chapter.totalTaskCount !== config.definitions.length || state.chapter.completedTaskCount < 0 || state.chapter.completedTaskCount > state.chapter.totalTaskCount) {
    fail('INVALID_STATE', 'chapter task counts are invalid');
  }
  if (typeof state.chapter.progress !== 'number' || !Number.isFinite(state.chapter.progress)) fail('INVALID_STATE', 'chapter.progress must be finite');
  assertBoolean(state.chapter.completed, 'chapter.completed', 'INVALID_STATE');
  if (state.chapter.currentTaskId !== null) assertIdentifier(state.chapter.currentTaskId, 'chapter.currentTaskId', 'INVALID_STATE');
  const derivedChapter = deriveChapter(config, tasks);
  if (
    state.chapter.completedTaskCount !== derivedChapter.completedTaskCount
    || state.chapter.totalTaskCount !== derivedChapter.totalTaskCount
    || state.chapter.progress !== derivedChapter.progress
    || state.chapter.completed !== derivedChapter.completed
    || state.chapter.currentTaskId !== derivedChapter.currentTaskId
  ) fail('INVALID_STATE', 'chapter progress is not derived from task progress');

  return freezeState({
    schemaVersion: MAINLINE_TASK_SCHEMA_VERSION,
    chapterId: MAINLINE_CHAPTER_ID,
    tasks,
    features,
    chapter: derivedChapter,
    rewardOutbox,
  });
}

function serializeState(state: MainlineTaskState): string {
  return JSON.stringify({
    schemaVersion: state.schemaVersion,
    chapterId: state.chapterId,
    tasks: Object.fromEntries(Object.entries(state.tasks).map(([id, task]) => [id, {
      id: task.id,
      target: task.target,
      progress: task.progress,
      completed: task.completed,
      claimed: task.claimed,
      eventKeys: [...task.eventKeys],
    }])),
    features: Object.fromEntries(Object.entries(state.features).map(([id, feature]) => [id, { ...feature }])),
    chapter: { ...state.chapter },
    rewardOutbox: {
      schemaVersion: state.rewardOutbox.schemaVersion,
      entries: Object.fromEntries(Object.entries(state.rewardOutbox.entries).map(([businessKey, entry]) => [businessKey, { ...entry }])),
    },
  });
}

function parseSerialized(serialized: string): unknown {
  if (typeof serialized !== 'string' || serialized.length === 0) fail('INVALID_SAVE', 'mainline task save must be a non-empty string');
  try {
    return JSON.parse(serialized);
  } catch (error) {
    fail('INVALID_SAVE', 'mainline task save is not valid JSON', error);
  }
}

function normalizedEvent(event: unknown): MainlineTaskEvent {
  assertPlainRecord(event, 'mainline event', 'INVALID_EVENT');
  assertEventType(event.type, 'mainline event.type', 'INVALID_EVENT');
  switch (event.type) {
    case 'CAMPAIGN_LEVEL_CLEARED':
      assertAllowedKeys(event, ['type', 'levelId', 'key'], 'mainline campaign event', 'INVALID_EVENT');
      if (!Object.prototype.hasOwnProperty.call(event, 'levelId')) fail('INVALID_EVENT', 'mainline event.levelId is required');
      assertIdentifier(event.levelId, 'mainline event.levelId', 'INVALID_EVENT');
      validateLevelId(event.levelId, 'mainline event.levelId', 'INVALID_EVENT');
      if (event.key !== undefined) assertIdentifier(event.key, 'mainline event.key', 'INVALID_EVENT');
      return Object.freeze({ type: event.type, levelId: event.levelId, ...(event.key === undefined ? {} : { key: event.key }) });
    case 'STORY_NODE_READ':
      assertAllowedKeys(event, ['type', 'nodeId', 'key'], 'mainline story event', 'INVALID_EVENT');
      if (!Object.prototype.hasOwnProperty.call(event, 'nodeId')) fail('INVALID_EVENT', 'mainline event.nodeId is required');
      assertIdentifier(event.nodeId, 'mainline event.nodeId', 'INVALID_EVENT');
      if (event.key !== undefined) assertIdentifier(event.key, 'mainline event.key', 'INVALID_EVENT');
      return Object.freeze({ type: event.type, nodeId: event.nodeId, ...(event.key === undefined ? {} : { key: event.key }) });
    case 'DECK_UPDATED':
      assertAllowedKeys(event, ['type', 'deckId', 'key'], 'mainline deck event', 'INVALID_EVENT');
      if (event.deckId !== undefined) assertIdentifier(event.deckId, 'mainline event.deckId', 'INVALID_EVENT');
      if (event.key !== undefined) assertIdentifier(event.key, 'mainline event.key', 'INVALID_EVENT');
      return Object.freeze({ type: event.type, ...(event.deckId === undefined ? {} : { deckId: event.deckId }), ...(event.key === undefined ? {} : { key: event.key }) });
    default:
      return fail('INVALID_EVENT', 'unsupported mainline event type');
  }
}

function triggerMatches(trigger: MainlineTaskTrigger, event: MainlineTaskEvent): boolean {
  if (trigger.type !== event.type) return false;
  if (trigger.levelId !== undefined && trigger.levelId !== '*' && trigger.levelId !== event.levelId) return false;
  if (trigger.nodeId !== undefined && trigger.nodeId !== '*' && trigger.nodeId !== event.nodeId) return false;
  if (trigger.deckId !== undefined && trigger.deckId !== event.deckId) return false;
  return true;
}

function eventKey(task: MainlineTaskDefinition, event: MainlineTaskEvent): string {
  if (event.key !== undefined) return `${event.type}:${event.key}`;
  const identity = event.levelId ?? event.nodeId ?? event.deckId ?? 'default';
  if (task.target > 1 && task.trigger.type === 'DECK_UPDATED') {
    fail('INVALID_EVENT', `${task.id} requires an explicit event key for repeatable deck events`);
  }
  return `${event.type}:${identity}`;
}

function sameEventAlreadySeen(
  config: NormalizedConfig,
  tasks: Readonly<Record<string, MainlineTaskProgress | MutableTaskProgress>>,
  event: MainlineTaskEvent,
): { readonly taskId: string; readonly key: string } | null {
  for (const definition of config.definitions) {
    if (!triggerMatches(definition.trigger, event)) continue;
    const key = eventKey(definition, event);
    if (tasks[definition.id].eventKeys.includes(key)) return { taskId: definition.id, key };
  }
  return null;
}

function validateCampaignSnapshot(value: unknown): CampaignState {
  assertPlainRecord(value, 'campaign sync', 'INVALID_SYNC');
  assertChapterId(value.chapterId, 'campaign sync.chapterId', 'CHAPTER_MISMATCH');
  try {
    const validated = restoreCampaignState(CAMPAIGN_DEFINITION, JSON.stringify(value));
    let blocked = false;
    for (const levelId of CAMPAIGN_LEVEL_IDS) {
      const level = validated.levels[levelId];
      if (level.firstClear && !level.unlocked) fail('INVALID_SYNC', `${levelId} cannot be cleared while locked`);
      if (level.firstClear && blocked) fail('INVALID_SYNC', 'campaign first clears must be a continuous prefix');
      if (!level.firstClear) blocked = true;
    }
    return validated;
  } catch (error) {
    if (error instanceof MainlineTaskError) throw error;
    fail('INVALID_SYNC', 'campaign sync state is invalid', error);
  }
}

function usesChapter01StoryContract(config: NormalizedConfig): boolean {
  const storyDefinitions = config.definitions.filter(
    (definition) => definition.trigger.type === 'STORY_NODE_READ',
  );
  // The configured story triggers choose the protocol; an incoming node id alone
  // cannot identify the business source. No story trigger means generic sync.
  return storyDefinitions.length > 0 && storyDefinitions.every(
    (definition) => CHAPTER01_STORY_NODE_IDS.includes(definition.trigger.nodeId!),
  );
}

function validateStorySync(
  value: unknown,
  strictChapter01: boolean,
): readonly MainlineTaskEvent[] {
  assertPlainRecord(value, 'story sync', 'INVALID_SYNC');
  if (strictChapter01) {
    assertExactKeys(value, ['chapterId', 'readNodeIds', 'currentNodeId', 'schemaVersion'], 'story sync', 'INVALID_SYNC');
  } else {
    assertAllowedKeys(value, ['chapterId', 'readNodeIds', 'currentNodeId', 'schemaVersion'], 'story sync', 'INVALID_SYNC');
  }
  assertChapterId(value.chapterId, 'story sync.chapterId', 'CHAPTER_MISMATCH');
  if (strictChapter01) {
    if (value.schemaVersion !== STORY_SAVE_VERSION) fail('INVALID_SYNC', 'unsupported story sync version');
  } else if (value.schemaVersion !== undefined && value.schemaVersion !== STORY_SAVE_VERSION) {
    fail('INVALID_SYNC', 'unsupported story sync version');
  }
  if (value.currentNodeId !== undefined && value.currentNodeId !== null) assertIdentifier(value.currentNodeId, 'story sync.currentNodeId', 'INVALID_SYNC');
  if (!Array.isArray(value.readNodeIds)) fail('INVALID_SYNC', 'story sync.readNodeIds must be an array');
  const seen = new Set<string>();
  const events: MainlineTaskEvent[] = [];
  for (const [index, nodeId] of value.readNodeIds.entries()) {
    assertIdentifier(nodeId, `story sync.readNodeIds[${index}]`, 'INVALID_SYNC');
    if (seen.has(nodeId)) fail('INVALID_SYNC', 'story sync.readNodeIds must not contain duplicates');
    seen.add(nodeId);
    if (strictChapter01 && nodeId !== CHAPTER01_STORY_NODE_IDS[index]) {
      fail('INVALID_SYNC', 'CHAPTER01 story readNodeIds must be the real continuous prefix');
    }
    events.push({ type: 'STORY_NODE_READ', nodeId });
  }
  if (strictChapter01) {
    const readCount = value.readNodeIds.length;
    const expectedCurrentNodeId = readCount < CHAPTER01_STORY_NODE_IDS.length
      ? CHAPTER01_STORY_NODE_IDS[readCount]
      : null;
    if (value.currentNodeId !== expectedCurrentNodeId) {
      fail('INVALID_SYNC', 'story sync.currentNodeId does not match the read prefix');
    }
  }
  return Object.freeze(events);
}

function normalizeOptions(
  input: MainlineTaskServiceOptions | readonly MainlineTaskDefinition[],
  options: MainlineTaskServiceOptions | undefined,
): MainlineTaskServiceOptions & { readonly definitions: readonly MainlineTaskDefinition[] } {
  if (Array.isArray(input)) return { ...(options ?? {}), definitions: input };
  assertPlainRecord(input, 'mainline task service input');
  return { ...(input as MainlineTaskServiceOptions), ...(options ?? {}), definitions: input.definitions ?? MAINLINE_TASK_DEFINITIONS };
}

function persistenceCallback(options: MainlineTaskServiceOptions): ((serialized: string) => void) | undefined {
  if (options.persist !== undefined && options.onSave !== undefined && options.persist !== options.onSave) {
    fail('INVALID_ARGUMENT', 'persist and onSave cannot both be provided');
  }
  const callback = options.persist ?? options.onSave;
  if (callback !== undefined && typeof callback !== 'function') fail('INVALID_ARGUMENT', 'mainline persistence must be a function');
  return callback;
}

export function createMainlineTaskState(
  definitions: readonly MainlineTaskDefinition[] = MAINLINE_TASK_DEFINITIONS,
  initialFeatures: readonly string[] = DEFAULT_INITIAL_FEATURES,
): MainlineTaskState {
  const config = normalizeConfig(definitions, initialFeatures);
  return freezeState(initialMutableState(config));
}

export function serializeMainlineTaskState(
  state: MainlineTaskState,
  definitions: readonly MainlineTaskDefinition[] = MAINLINE_TASK_DEFINITIONS,
  initialFeatures: readonly string[] = DEFAULT_INITIAL_FEATURES,
): string {
  const config = normalizeConfig(definitions, initialFeatures);
  return serializeState(validateState(state, config));
}

export function restoreMainlineTaskState(
  serialized: string,
  definitions: readonly MainlineTaskDefinition[] = MAINLINE_TASK_DEFINITIONS,
  initialFeatures: readonly string[] = DEFAULT_INITIAL_FEATURES,
): MainlineTaskState {
  const config = normalizeConfig(definitions, initialFeatures);
  return validateState(parseSerialized(serialized), config);
}

export class MainlineTaskService {
  private current: MainlineTaskState;
  private readonly config: NormalizedConfig;
  private readonly persist?: (serialized: string) => void;
  private committing = false;

  constructor(
    input: MainlineTaskServiceOptions | readonly MainlineTaskDefinition[] = {},
    options?: MainlineTaskServiceOptions,
  ) {
    const normalized = normalizeOptions(input, options);
    this.config = normalizeConfig(normalized.definitions, normalized.initialFeatures ?? DEFAULT_INITIAL_FEATURES);
    this.persist = persistenceCallback(normalized);
    const initial = normalized.initialState ?? normalized.state;
    this.current = initial === undefined
      ? freezeState(initialMutableState(this.config))
      : typeof initial === 'string'
        ? validateState(parseSerialized(initial), this.config)
        : validateState(initial, this.config);
  }

  static fromSave(
    definitions: readonly MainlineTaskDefinition[],
    serialized: string,
    options: Omit<MainlineTaskServiceOptions, 'definitions' | 'initialState' | 'state'> = {},
  ): MainlineTaskService {
    return new MainlineTaskService({
      ...options,
      definitions,
      initialState: serialized,
    });
  }

  snapshot(): MainlineTaskState {
    return this.current;
  }

  serialize(): string {
    return serializeState(this.current);
  }

  getTask(taskId: string): MainlineTaskProgress {
    const id = this.validTaskId(taskId);
    return this.current.tasks[id];
  }

  isFeatureUnlocked(featureId: string): boolean {
    const id = this.validFeatureId(featureId);
    return this.current.features[id].unlocked;
  }

  pendingRewards(): readonly MainlineRewardOutboxEntry[] {
    return Object.freeze(
      Object.values(this.current.rewardOutbox.entries)
        .filter((entry) => entry.status === 'PENDING')
        .map((entry) => entry),
    );
  }

  advance(input: MainlineTaskEvent): MainlineAdvanceResult {
    const batch = this.applyEvents([input]);
    const result = batch.results[0];
    return Object.freeze({
      applied: result.applied,
      code: result.code,
      taskId: result.taskId,
      state: batch.state,
    });
  }

  claim(taskId: string, rewardClaim?: MainlineRewardClaim): MainlineClaimResult {
    this.assertIdle();
    const id = this.validTaskId(taskId);
    const task = this.current.tasks[id];
    const definition = this.config.definitions.find((candidate) => candidate.id === id)!;
    const businessKey = `mainline:${MAINLINE_CHAPTER_ID}:${id}`;
    if (task.claimed) {
      return Object.freeze({ applied: false, code: 'DUPLICATE' as const, taskId: id, businessKey, state: this.current });
    }
    if (!task.completed) {
      return Object.freeze({ applied: false, code: 'NOT_READY' as const, taskId: id, businessKey, state: this.current });
    }
    const next = copyMutableState(this.current);
    next.tasks[id].claimed = true;
    next.rewardOutbox.entries[businessKey] = {
      businessKey,
      taskId: id,
      status: 'PENDING',
    };
    next.features = deriveFeatures(this.config, next.tasks);
    next.chapter = deriveChapter(this.config, next.tasks);
    const nextState = freezeState(next);
    this.commit(nextState);
    if (rewardClaim !== undefined) {
      try {
        rewardClaim(definition, businessKey);
      } catch (error) {
        if (error instanceof MainlineTaskError) throw error;
        throw new MainlineTaskError('REWARD_FAILED', 'mainline task reward callback failed', error);
      }
    }
    return Object.freeze({ applied: true, code: 'APPLIED' as const, taskId: id, businessKey, state: this.current });
  }

  flushRewards(rewardClaim: MainlineRewardClaim): readonly MainlineRewardFlushResult[] {
    if (typeof rewardClaim !== 'function') fail('INVALID_ARGUMENT', 'reward flush callback must be a function');
    this.assertIdle();
    const results: MainlineRewardFlushResult[] = [];
    for (const pending of this.pendingRewards()) {
      const entry = this.current.rewardOutbox.entries[pending.businessKey];
      if (entry === undefined || entry.status !== 'PENDING') continue;
      const definition = this.config.definitions.find((candidate) => candidate.id === pending.taskId)!;
      try {
        rewardClaim(definition, pending.businessKey);
        results.push(Object.freeze({
          code: 'DELIVERED' as const,
          taskId: pending.taskId,
          businessKey: pending.businessKey,
          acknowledged: this.current.rewardOutbox.entries[pending.businessKey].status === 'ACKNOWLEDGED',
          state: this.current,
        }));
      } catch {
        results.push(Object.freeze({
          code: 'FAILED' as const,
          taskId: pending.taskId,
          businessKey: pending.businessKey,
          acknowledged: this.current.rewardOutbox.entries[pending.businessKey].status === 'ACKNOWLEDGED',
          state: this.current,
        }));
      }
    }
    return Object.freeze(results);
  }

  acknowledgeReward(businessKey: string): MainlineRewardAcknowledgeResult {
    this.assertIdle();
    assertIdentifier(businessKey, 'reward business key', 'INVALID_ARGUMENT');
    const entry = this.current.rewardOutbox.entries[businessKey];
    if (entry === undefined) fail('INVALID_ARGUMENT', `unknown mainline reward business key: ${businessKey}`);
    if (entry.status === 'ACKNOWLEDGED') {
      return Object.freeze({ applied: false, code: 'DUPLICATE' as const, businessKey, state: this.current });
    }
    const next = copyMutableState(this.current);
    next.rewardOutbox.entries[businessKey].status = 'ACKNOWLEDGED';
    const nextState = freezeState(next);
    this.commit(nextState);
    return Object.freeze({ applied: true, code: 'APPLIED' as const, businessKey, state: this.current });
  }

  ackReward(businessKey: string): MainlineRewardAcknowledgeResult {
    return this.acknowledgeReward(businessKey);
  }

  syncCampaign(campaign: CampaignState): MainlineTaskState {
    const validated = validateCampaignSnapshot(campaign);
    const active = this.config.definitions.find((definition) => !this.current.tasks[definition.id].completed);
    if (active?.trigger.type !== 'CAMPAIGN_LEVEL_CLEARED') return this.current;
    const events = CAMPAIGN_LEVEL_IDS
      .filter((levelId) => validated.levels[levelId].firstClear)
      .map((levelId) => ({ type: 'CAMPAIGN_LEVEL_CLEARED' as const, levelId }));
    return this.applyEvents(events).state;
  }

  syncStory(story: Chapter01StorySnapshot | { readonly chapterId: string; readonly readNodeIds: readonly string[] }): MainlineTaskState {
    const events = validateStorySync(story, usesChapter01StoryContract(this.config));
    const active = this.config.definitions.find((definition) => !this.current.tasks[definition.id].completed);
    if (active?.trigger.type !== 'STORY_NODE_READ') return this.current;
    return this.applyEvents(events).state;
  }

  syncDeck(deckId?: string): MainlineTaskState {
    const active = this.config.definitions.find((definition) => !this.current.tasks[definition.id].completed);
    if (active?.trigger.type !== 'DECK_UPDATED') return this.current;
    this.advance({ type: 'DECK_UPDATED', ...(deckId === undefined ? {} : { deckId }) });
    return this.current;
  }

  unlockFeature(featureId: string): never {
    this.validFeatureId(featureId);
    return fail('INVALID_UNLOCK', 'features are derived from completed mainline tasks');
  }

  private validTaskId(taskId: string): string {
    assertIdentifier(taskId, 'task id', 'INVALID_TASK_ID');
    if (!Object.prototype.hasOwnProperty.call(this.current.tasks, taskId)) fail('INVALID_TASK_ID', `unknown mainline task: ${taskId}`);
    return taskId;
  }

  private validFeatureId(featureId: string): string {
    assertIdentifier(featureId, 'feature id', 'INVALID_UNLOCK');
    if (!Object.prototype.hasOwnProperty.call(this.current.features, featureId)) fail('INVALID_UNLOCK', `unknown mainline feature: ${featureId}`);
    return featureId;
  }

  private assertIdle(): void {
    if (this.committing) fail('REENTRANT', 'mainline task mutation cannot re-enter persistence');
  }

  private applyEvents(inputs: readonly MainlineTaskEvent[]): {
    readonly state: MainlineTaskState;
    readonly results: readonly Readonly<{ applied: boolean; code: MainlineAdvanceCode; taskId: string }>[];
  } {
    this.assertIdle();
    const events = inputs.map((input) => normalizedEvent(input));
    const next = copyMutableState(this.current);
    const results: Array<{ applied: boolean; code: MainlineAdvanceCode; taskId: string }> = [];
    let changed = false;

    for (const event of events) {
      const duplicate = sameEventAlreadySeen(this.config, next.tasks, event);
      if (duplicate !== null) {
        results.push({ applied: false, code: 'DUPLICATE_EVENT', taskId: duplicate.taskId });
        continue;
      }
      const activeDefinition = this.config.definitions.find((definition) => !next.tasks[definition.id].completed);
      if (activeDefinition === undefined) fail('CHAPTER_COMPLETE', 'all mainline tasks are already complete');
      if (!triggerMatches(activeDefinition.trigger, event)) {
        const futureMatch = this.config.definitions.some((definition) => definition.id !== activeDefinition.id && !next.tasks[definition.id].completed && triggerMatches(definition.trigger, event));
        if (futureMatch) fail('TASK_NOT_AVAILABLE', `event cannot advance before task ${activeDefinition.id} is complete`);
        fail('INVALID_EVENT', `event does not match active task ${activeDefinition.id}`);
      }
      const key = eventKey(activeDefinition, event);
      const task = next.tasks[activeDefinition.id];
      task.eventKeys.push(key);
      task.progress += 1;
      task.completed = task.progress >= task.target;
      changed = true;
      results.push({ applied: true, code: 'APPLIED', taskId: activeDefinition.id });
    }

    if (!changed) return { state: this.current, results: Object.freeze(results) };
    next.features = deriveFeatures(this.config, next.tasks);
    next.chapter = deriveChapter(this.config, next.tasks);
    const nextState = freezeState(next);
    this.commit(nextState);
    return { state: this.current, results: Object.freeze(results) };
  }

  private commit(next: MainlineTaskState): void {
    this.assertIdle();
    const serialized = serializeState(next);
    this.committing = true;
    try {
      if (this.persist !== undefined) this.persist(serialized);
    } catch (error) {
      if (error instanceof MainlineTaskError) throw error;
      throw new MainlineTaskError('PERSISTENCE_FAILED', 'mainline task state persistence failed', error);
    } finally {
      this.committing = false;
    }
    this.current = next;
  }
}

export { MainlineTaskService as MainlineTaskMachine };
