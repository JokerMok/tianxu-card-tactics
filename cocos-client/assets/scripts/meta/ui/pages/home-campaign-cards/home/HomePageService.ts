import {
  HOME_GOAL_IDS,
  HOME_QUICK_ACTION_IDS,
  HOME_SCHEMA_VERSION,
  createDefaultHomePageData,
  type HomeGoalData,
  type HomeGoalId,
  type HomeInteraction,
  type HomeInteractionReason,
  type HomeInteractionResult,
  type HomeNavigationTarget,
  type HomePageData,
  type HomePageSnapshot,
  type HomeQuickActionData,
} from './HomeContracts.ts';
import { createHomePageComponents } from './HomeComponents.ts';

export type HomePageErrorCode =
  | 'MISSING_FIELD'
  | 'INVALID_ARGUMENT'
  | 'INVALID_ID'
  | 'INVALID_NUMBER'
  | 'INVALID_DATA'
  | 'DUPLICATE_ID'
  | 'INDEX_OUT_OF_RANGE'
  | 'QUICK_ACTION_NOT_FOUND'
  | 'GOAL_NOT_FOUND';

export class HomePageError extends Error {
  readonly code: HomePageErrorCode;

  constructor(code: HomePageErrorCode, message: string) {
    super(message);
    this.name = 'HomePageError';
    this.code = code;
  }
}

function reject(code: HomePageErrorCode, message: string): never {
  throw new HomePageError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!isRecord(value)) reject('INVALID_ARGUMENT', `${label} must be an object`);
}

function assertExactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const allowed = [...expected].sort();
  if (actual.length !== allowed.length || actual.some((key, index) => key !== allowed[index])) {
    const missing = allowed.find((key) => !actual.includes(key));
    reject(missing ? 'MISSING_FIELD' : 'INVALID_DATA', `${label} must contain exactly ${expected.join(', ')}`);
  }
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) reject('INVALID_DATA', `${label} must be a non-empty string`);
}

function assertSafeInteger(value: unknown, label: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) reject('INVALID_NUMBER', `${label} must be a safe integer`);
}

function cloneData(data: HomePageData): HomePageData {
  return {
    schemaVersion: data.schemaVersion,
    player: { ...data.player },
    mission: data.mission ? { ...data.mission } : null,
    quickActions: data.quickActions.map((action) => ({ ...action })),
    goals: data.goals.map((goal) => ({ ...goal })),
  };
}

function validateData(input: HomePageData): HomePageData {
  assertRecord(input, 'home page data');
  assertExactKeys(input, ['schemaVersion', 'player', 'mission', 'quickActions', 'goals'], 'home page data');
  if (input.schemaVersion !== HOME_SCHEMA_VERSION) reject('INVALID_DATA', 'unsupported home page schema version');

  assertRecord(input.player, 'home page player');
  assertExactKeys(input.player, ['name', 'profession', 'level'], 'home page player');
  assertNonEmptyString(input.player.name, 'home page player.name');
  assertNonEmptyString(input.player.profession, 'home page player.profession');
  assertSafeInteger(input.player.level, 'home page player.level');
  if (input.player.level <= 0) reject('INVALID_DATA', 'home page player.level must be positive');

  if (input.mission !== null) {
    assertRecord(input.mission, 'home page mission');
    assertExactKeys(input.mission, ['chapter', 'stage', 'title', 'description', 'actionLabel'], 'home page mission');
    assertNonEmptyString(input.mission.chapter, 'home page mission.chapter');
    assertNonEmptyString(input.mission.stage, 'home page mission.stage');
    assertNonEmptyString(input.mission.title, 'home page mission.title');
    assertNonEmptyString(input.mission.description, 'home page mission.description');
    assertNonEmptyString(input.mission.actionLabel, 'home page mission.actionLabel');
  }

  if (!Array.isArray(input.quickActions)) reject('INVALID_ARGUMENT', 'home page quickActions must be an array');
  const quickActionIds = new Set<string>();
  for (const [index, action] of input.quickActions.entries()) {
    assertRecord(action, `home page quickActions[${index}]`);
    assertExactKeys(action, ['id', 'title', 'value', 'target', 'enabled'], `home page quickActions[${index}]`);
    if (!HOME_QUICK_ACTION_IDS.includes(action.id as HomeQuickActionData['id'])) {
      reject('INVALID_ID', `unknown home quick action: ${String(action.id)}`);
    }
    if (quickActionIds.has(action.id as string)) reject('DUPLICATE_ID', `duplicate home quick action: ${String(action.id)}`);
    quickActionIds.add(action.id as string);
    assertNonEmptyString(action.title, `home page quickActions[${index}].title`);
    assertNonEmptyString(action.value, `home page quickActions[${index}].value`);
    if (!['deck', 'adventure', 'city'].includes(action.target as string)) {
      reject('INVALID_DATA', `invalid home quick action target: ${String(action.target)}`);
    }
    if (typeof action.enabled !== 'boolean') reject('INVALID_DATA', `home page quickActions[${index}].enabled must be boolean`);
  }

  if (!Array.isArray(input.goals)) reject('INVALID_ARGUMENT', 'home page goals must be an array');
  const goalIds = new Set<string>();
  for (const [index, goal] of input.goals.entries()) {
    assertRecord(goal, `home page goals[${index}]`);
    assertExactKeys(goal, ['id', 'label', 'progress', 'target'], `home page goals[${index}]`);
    if (!HOME_GOAL_IDS.includes(goal.id as HomeGoalData['id'])) reject('INVALID_ID', `unknown home goal: ${String(goal.id)}`);
    if (goalIds.has(goal.id as string)) reject('DUPLICATE_ID', `duplicate home goal: ${String(goal.id)}`);
    goalIds.add(goal.id as string);
    assertNonEmptyString(goal.label, `home page goals[${index}].label`);
    assertSafeInteger(goal.progress, `home page goals[${index}].progress`);
    assertSafeInteger(goal.target, `home page goals[${index}].target`);
    if (goal.target <= 0 || goal.progress < 0 || goal.progress > goal.target) {
      reject('INVALID_DATA', `home page goals[${index}] progress must be between zero and target`);
    }
  }

  return cloneData(input);
}

function result(
  accepted: boolean,
  changed: boolean,
  reason: HomeInteractionReason,
  target: HomeNavigationTarget | null = null,
): HomeInteractionResult {
  return Object.freeze({ accepted, changed, reason, target });
}

export class HomePageService {
  private readonly data: HomePageData;
  private selectedComponentId: string | null = null;
  private readonly claimedGoalIds = new Set<HomeGoalId>();

  constructor(initial: HomePageData = createDefaultHomePageData()) {
    this.data = validateData(initial);
  }

  snapshot(): HomePageSnapshot {
    return Object.freeze({
      schemaVersion: HOME_SCHEMA_VERSION,
      pageId: 'home',
      selectedComponentId: this.selectedComponentId,
      claimedGoalIds: Object.freeze(this.data.goals
        .map((goal) => goal.id)
        .filter((id) => this.claimedGoalIds.has(id))),
      components: createHomePageComponents(this.data, this.claimedGoalIds),
    });
  }

  interact(action: HomeInteraction): HomeInteractionResult {
    if (!isRecord(action) || typeof action.type !== 'string') reject('INVALID_ARGUMENT', 'home interaction must contain a type');
    switch (action.type) {
      case 'activateMission':
        return this.activateMission();
      case 'activateQuickAction':
        return this.activateQuickAction(action.index);
      case 'claimGoal':
        return this.claimGoal(action.id);
      default:
        reject('INVALID_ARGUMENT', `unknown home interaction: ${action.type}`);
    }
  }

  activateMission(): HomeInteractionResult {
    if (!this.data.mission) return result(false, false, 'empty');
    const changed = this.selectedComponentId !== 'mission';
    this.selectedComponentId = 'mission';
    return result(true, changed, changed ? 'navigated' : 'same', 'campaign');
  }

  activateQuickAction(index: number): HomeInteractionResult {
    assertSafeInteger(index, 'home quick action index');
    if (index < 0 || index >= this.data.quickActions.length) {
      reject('INDEX_OUT_OF_RANGE', `home quick action index ${index} is outside the data range`);
    }
    const action = this.data.quickActions[index]!;
    if (!action.enabled) return result(false, false, 'disabled');
    const componentId = `quick-${action.id}`;
    const changed = this.selectedComponentId !== componentId;
    this.selectedComponentId = componentId;
    return result(true, changed, changed ? 'navigated' : 'same', action.target);
  }

  claimGoal(id: string): HomeInteractionResult {
    assertNonEmptyString(id, 'home goal id');
    const goal = this.data.goals.find((candidate) => candidate.id === id);
    if (!goal) reject('GOAL_NOT_FOUND', `unknown home goal: ${id}`);
    if (this.claimedGoalIds.has(goal.id)) return result(false, false, 'claimed');
    if (goal.progress < goal.target) return result(false, false, 'not-ready');
    this.claimedGoalIds.add(goal.id);
    this.selectedComponentId = `goal-${goal.id}`;
    return result(true, true, 'claimed');
  }
}

export function createHomePageService(initial?: HomePageData): HomePageService {
  return new HomePageService(initial);
}
