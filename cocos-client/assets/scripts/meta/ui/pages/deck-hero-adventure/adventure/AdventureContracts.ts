export const ADVENTURE_PAGE_SCHEMA_VERSION = 1 as const;

export const ADVENTURE_MODE_IDS = Object.freeze(['dungeon', 'tower', 'boss'] as const);
export type AdventureModeId = typeof ADVENTURE_MODE_IDS[number] | (string & {});

export const ADVENTURE_STATUS_IDS = Object.freeze([
  'ready', 'locked', 'inProgress', 'failed', 'completed', 'claimed',
] as const);
export type AdventureTaskStatus = typeof ADVENTURE_STATUS_IDS[number];
export type AdventureFilterValue = AdventureModeId | AdventureTaskStatus | 'all';

export interface AdventureRewardData {
  readonly id: string;
  readonly label: string;
  readonly quantity: number;
  readonly type?: string;
}

export interface AdventureTaskData {
  readonly id: string;
  readonly mode: AdventureModeId;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly objective: string;
  readonly target: number;
  readonly recommendedPower: number;
  readonly staminaCost: number;
  readonly rewards: readonly AdventureRewardData[];
  readonly prerequisiteTaskId: string | null;
}

export interface AdventurePageData {
  readonly schemaVersion: typeof ADVENTURE_PAGE_SCHEMA_VERSION;
  readonly title: string;
  readonly subtitle: string;
  readonly tasks: readonly AdventureTaskData[];
}

export interface AdventureFilter {
  readonly mode: AdventureModeId | 'all';
  readonly status: AdventureTaskStatus | 'all';
  readonly taskIds: readonly string[];
}

export interface AdventureTaskProgress {
  readonly taskId: string;
  readonly status: Exclude<AdventureTaskStatus, 'locked'>;
  readonly progress: number;
  readonly attempts: number;
  readonly claimed: boolean;
}

export interface AdventurePageState {
  readonly schemaVersion: typeof ADVENTURE_PAGE_SCHEMA_VERSION;
  readonly pageId: 'adventure';
  readonly selectedTaskId: string;
  readonly activeTaskId: string | null;
  readonly filter: AdventureFilter;
  readonly tasks: Readonly<Record<string, AdventureTaskProgress>>;
}

export interface AdventureHeaderComponent {
  readonly id: 'header';
  readonly kind: 'header';
  readonly state: 'ready';
  readonly title: string;
  readonly subtitle: string;
  readonly totalTasks: number;
  readonly visibleTasks: number;
  readonly completedTasks: number;
  readonly claimedTasks: number;
  readonly selectedTaskId: string | null;
  readonly activeTaskId: string | null;
}

export interface AdventureFilterComponent {
  readonly id: 'filters';
  readonly kind: 'filters';
  readonly state: 'ready';
  readonly filter: AdventureFilter;
  readonly modes: readonly { readonly id: AdventureModeId; readonly label: string; readonly selected: boolean }[];
  readonly statuses: readonly { readonly id: AdventureFilterValue; readonly label: string; readonly selected: boolean }[];
}

export interface AdventureTaskComponent extends Omit<AdventureTaskData, 'id'> {
  readonly id: `task-${string}`;
  readonly kind: 'task';
  readonly state: AdventureTaskStatus;
  readonly status: AdventureTaskStatus;
  readonly taskId: string;
  readonly modeLabel: string;
  readonly statusLabel: string;
  readonly selected: boolean;
  readonly active: boolean;
  readonly unlocked: boolean;
  readonly progress: number;
  readonly attempts: number;
  readonly claimed: boolean;
  readonly canStart: boolean;
  readonly canComplete: boolean;
  readonly canClaim: boolean;
}

export interface AdventureDetailComponent extends Omit<AdventureTaskComponent, 'id' | 'kind'> {
  readonly id: 'detail';
  readonly kind: 'detail';
}

export interface AdventureEmptyComponent {
  readonly id: 'adventure-empty';
  readonly kind: 'empty';
  readonly state: 'empty';
  readonly reason: 'noTasks' | 'noVisibleTasks';
  readonly message: string;
}

export type AdventurePageComponent =
  | AdventureHeaderComponent
  | AdventureFilterComponent
  | AdventureTaskComponent
  | AdventureDetailComponent
  | AdventureEmptyComponent;

export interface AdventurePageSnapshot {
  readonly schemaVersion: typeof ADVENTURE_PAGE_SCHEMA_VERSION;
  readonly pageId: 'adventure';
  readonly selectedTaskId: string | null;
  readonly activeTaskId: string | null;
  readonly filter: AdventureFilter | null;
  readonly state: AdventurePageState | null;
  readonly components: readonly AdventurePageComponent[];
}

export type AdventureInteraction =
  | { readonly type: 'selectTask'; readonly taskId: string }
  | { readonly type: 'selectAdventure'; readonly taskId: string }
  | { readonly type: 'setFilter'; readonly filter: Partial<AdventureFilter> }
  | { readonly type: 'clearFilter' }
  | { readonly type: 'startTask'; readonly taskId?: string }
  | { readonly type: 'startAdventure'; readonly taskId?: string }
  | { readonly type: 'progressTask'; readonly taskId?: string; readonly progress: number }
  | { readonly type: 'completeTask'; readonly taskId?: string; readonly progress?: number }
  | { readonly type: 'completeAdventure'; readonly taskId?: string; readonly progress?: number }
  | { readonly type: 'failTask'; readonly taskId?: string }
  | { readonly type: 'retryTask'; readonly taskId?: string }
  | { readonly type: 'claimTask'; readonly taskId?: string }
  | { readonly type: 'claimReward'; readonly taskId?: string };

export type AdventureInteractionReason =
  | 'selected' | 'same' | 'filtered' | 'started' | 'progressed'
  | 'completed' | 'failed' | 'retried' | 'claimed' | 'empty';

export interface AdventureInteractionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason: AdventureInteractionReason;
  readonly taskId: string | null;
  readonly mode: AdventureModeId | null;
  readonly progress: number | null;
}

export interface AdventurePageDataFactoryOptions {
  readonly tasks?: readonly unknown[] | { readonly tasks: readonly unknown[] };
  readonly adventures?: readonly unknown[] | { readonly adventures: readonly unknown[] };
  readonly modes?: readonly unknown[] | { readonly modes: readonly unknown[] };
  readonly taskDefinitions?: readonly unknown[];
  readonly title?: string;
  readonly subtitle?: string;
}

export interface AdventurePageServiceOptions extends AdventurePageDataFactoryOptions {
  readonly data?: AdventurePageData;
  readonly initialState?: AdventurePageState | string;
  readonly state?: AdventurePageState | string;
  readonly onSave?: (serialized: string) => void;
  readonly persist?: (serialized: string) => void;
}
