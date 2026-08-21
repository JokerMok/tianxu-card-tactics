import type {
  MainlineTaskDefinition,
  MainlineTaskEvent,
  MainlineTaskState,
} from '../../../../tasks/mainline/MainlineTasks.ts';

export const TASKS_PAGE_SCHEMA_VERSION = 1 as const;

export interface TasksTaskData {
  readonly id: string;
  readonly title: string;
  readonly target: number;
  readonly trigger: MainlineTaskDefinition['trigger'];
  readonly unlocks: readonly string[];
  readonly rewardPoolId: string | null;
}

export interface TasksPageData {
  readonly schemaVersion: typeof TASKS_PAGE_SCHEMA_VERSION;
  readonly title: string;
  readonly subtitle: string;
  readonly tasks: readonly TasksTaskData[];
}

export type TasksTaskStatus = 'locked' | 'ready' | 'completed' | 'claimed';

export interface TasksHeaderComponent {
  readonly id: 'header';
  readonly kind: 'header';
  readonly state: 'ready';
  readonly title: string;
  readonly subtitle: string;
  readonly totalTasks: number;
  readonly completedTasks: number;
  readonly claimedTasks: number;
  readonly selectedTaskId: string | null;
  readonly pendingRewardCount: number;
}

export interface TasksTaskComponent extends Omit<TasksTaskData, 'id'> {
  readonly id: `task-${string}`;
  readonly kind: 'task';
  readonly state: TasksTaskStatus;
  readonly taskId: string;
  readonly selected: boolean;
  readonly progress: number;
  readonly completed: boolean;
  readonly claimed: boolean;
  readonly canAdvance: boolean;
  readonly canClaim: boolean;
  readonly triggerLabel: string;
  readonly unlockLabels: readonly string[];
  readonly rewardLabel: string;
}

export interface TasksDetailComponent extends Omit<TasksTaskComponent, 'id' | 'kind'> {
  readonly id: 'detail';
  readonly kind: 'detail';
}

export interface TasksEmptyComponent {
  readonly id: 'tasks-empty';
  readonly kind: 'empty';
  readonly state: 'empty';
  readonly message: string;
}

export type TasksPageComponent =
  | TasksHeaderComponent
  | TasksTaskComponent
  | TasksDetailComponent
  | TasksEmptyComponent;

export interface TasksPageSnapshot {
  readonly schemaVersion: typeof TASKS_PAGE_SCHEMA_VERSION;
  readonly pageId: 'tasks';
  readonly selectedTaskId: string | null;
  readonly state: MainlineTaskState | null;
  readonly components: readonly TasksPageComponent[];
}

export type TasksInteraction =
  | { readonly type: 'selectTask'; readonly taskId: string }
  | { readonly type: 'advanceTask'; readonly taskId?: string; readonly event?: MainlineTaskEvent }
  | { readonly type: 'claimTask'; readonly taskId?: string };

export type TasksInteractionReason =
  | 'selected'
  | 'same'
  | 'duplicate'
  | 'progressed'
  | 'completed'
  | 'claimed'
  | 'not-ready'
  | 'empty';

export interface TasksInteractionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason: TasksInteractionReason;
  readonly taskId: string | null;
  readonly progress: number | null;
}

export interface TasksPageDataFactoryOptions {
  readonly taskDefinitions?: readonly unknown[];
  readonly tasks?: readonly unknown[];
  readonly title?: string;
  readonly subtitle?: string;
}

export interface TasksPageServiceOptions extends TasksPageDataFactoryOptions {
  readonly data?: TasksPageData;
  readonly initialState?: MainlineTaskState | string;
  readonly state?: MainlineTaskState | string;
  readonly onSave?: (serialized: string) => void;
  readonly persist?: (serialized: string) => void;
}
