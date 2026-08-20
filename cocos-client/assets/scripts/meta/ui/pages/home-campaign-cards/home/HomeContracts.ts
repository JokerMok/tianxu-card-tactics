export const HOME_SCHEMA_VERSION = 1 as const;

export const HOME_QUICK_ACTION_IDS = ['deck', 'tower', 'city'] as const;
export type HomeQuickActionId = (typeof HOME_QUICK_ACTION_IDS)[number];

export const HOME_GOAL_IDS = ['stage', 'upgrade'] as const;
export type HomeGoalId = (typeof HOME_GOAL_IDS)[number];

export type HomeNavigationTarget = 'campaign' | 'deck' | 'adventure' | 'city';

export interface HomePlayerData {
  readonly name: string;
  readonly profession: string;
  readonly level: number;
}

export interface HomeMissionData {
  readonly chapter: string;
  readonly stage: string;
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
}

export interface HomeQuickActionData {
  readonly id: HomeQuickActionId;
  readonly title: string;
  readonly value: string;
  readonly target: HomeNavigationTarget;
  readonly enabled: boolean;
}

export interface HomeGoalData {
  readonly id: HomeGoalId;
  readonly label: string;
  readonly progress: number;
  readonly target: number;
}

export interface HomePageData {
  readonly schemaVersion: typeof HOME_SCHEMA_VERSION;
  readonly player: HomePlayerData;
  readonly mission: HomeMissionData | null;
  readonly quickActions: readonly HomeQuickActionData[];
  readonly goals: readonly HomeGoalData[];
}

export type HomeComponentState = 'ready' | 'disabled' | 'complete' | 'claimed' | 'empty';

export interface HomeHeroComponent {
  readonly id: 'hero';
  readonly kind: 'hero';
  readonly state: 'ready';
  readonly title: string;
  readonly subtitle: string;
  readonly value: string;
}

export interface HomeMissionComponent {
  readonly id: 'mission';
  readonly kind: 'mission';
  readonly state: 'ready';
  readonly chapter: string;
  readonly stage: string;
  readonly title: string;
  readonly description: string;
  readonly actionLabel: string;
  readonly target: 'campaign';
}

export interface HomeQuickActionComponent {
  readonly id: `quick-${HomeQuickActionId}`;
  readonly kind: 'quickAction';
  readonly state: 'ready' | 'disabled';
  readonly actionId: HomeQuickActionId;
  readonly title: string;
  readonly value: string;
  readonly target: HomeNavigationTarget;
}

export interface HomeGoalComponent {
  readonly id: `goal-${HomeGoalId}`;
  readonly kind: 'goal';
  readonly state: 'ready' | 'complete' | 'claimed';
  readonly actionId: HomeGoalId;
  readonly label: string;
  readonly progress: number;
  readonly target: number;
  readonly claimed: boolean;
}

export interface HomeEmptyComponent {
  readonly id: 'mission-empty' | 'quick-actions-empty' | 'goals-empty';
  readonly kind: 'empty';
  readonly state: 'empty';
  readonly section: 'mission' | 'quickActions' | 'goals';
  readonly message: string;
}

export type HomePageComponent =
  | HomeHeroComponent
  | HomeMissionComponent
  | HomeQuickActionComponent
  | HomeGoalComponent
  | HomeEmptyComponent;

export interface HomePageSnapshot {
  readonly schemaVersion: typeof HOME_SCHEMA_VERSION;
  readonly pageId: 'home';
  readonly selectedComponentId: string | null;
  readonly claimedGoalIds: readonly HomeGoalId[];
  readonly components: readonly HomePageComponent[];
}

export type HomeInteraction =
  | { readonly type: 'activateMission' }
  | { readonly type: 'activateQuickAction'; readonly index: number }
  | { readonly type: 'claimGoal'; readonly id: string };

export type HomeInteractionReason = 'navigated' | 'same' | 'empty' | 'disabled' | 'claimed' | 'not-ready';

export interface HomeInteractionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason: HomeInteractionReason;
  readonly target: HomeNavigationTarget | null;
}

export const HOME_DEFAULT_DATA: HomePageData = Object.freeze({
  schemaVersion: HOME_SCHEMA_VERSION,
  player: Object.freeze({ name: '岳沉戈', profession: '镇军', level: 8 }),
  mission: Object.freeze({
    chapter: '第一章·空册入世',
    stage: '1-4',
    title: '白鹿渡口',
    description: '神册的气息引来山海异兽，护送队必须在日落前穿过渡口。',
    actionLabel: '继续征战',
  }),
  quickActions: Object.freeze([
    Object.freeze({ id: 'deck', title: '卡组编成', value: '10/10 张', target: 'deck', enabled: true }),
    Object.freeze({ id: 'tower', title: '挑战塔', value: '当前第 7 层', target: 'adventure', enabled: true }),
    Object.freeze({ id: 'city', title: '营造队列', value: '港口可派遣', target: 'city', enabled: true }),
  ]),
  goals: Object.freeze([
    Object.freeze({ id: 'stage', label: '通关 4 次', progress: 3, target: 4 }),
    Object.freeze({ id: 'upgrade', label: '强化 1 次', progress: 0, target: 1 }),
  ]),
});

export function createDefaultHomePageData(): HomePageData {
  return {
    schemaVersion: HOME_DEFAULT_DATA.schemaVersion,
    player: { ...HOME_DEFAULT_DATA.player },
    mission: HOME_DEFAULT_DATA.mission ? { ...HOME_DEFAULT_DATA.mission } : null,
    quickActions: HOME_DEFAULT_DATA.quickActions.map((action) => ({ ...action })),
    goals: HOME_DEFAULT_DATA.goals.map((goal) => ({ ...goal })),
  };
}

export function createEmptyHomePageData(): HomePageData {
  const data = createDefaultHomePageData();
  return { ...data, mission: null, quickActions: [], goals: [] };
}
