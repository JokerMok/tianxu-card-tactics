import {
  CAMPAIGN_CHAPTER_ID,
  CAMPAIGN_LEVEL_IDS,
  type CampaignLevelId,
  type CampaignDefinition,
  type CampaignLevelDefinition,
  type CampaignState,
  type CampaignStateService,
} from '../../../../campaign/CampaignState.ts';

export const CAMPAIGN_PAGE_SCHEMA_VERSION = 1 as const;

export interface CampaignRewardData {
  readonly id: string;
  readonly label: string;
  readonly quantity: number;
}

export interface CampaignLevelData {
  readonly id: CampaignLevelId;
  readonly label: string;
  readonly title: string;
  readonly description: string;
  readonly objective: string;
  readonly recommendedPower: number;
  readonly staminaCost: number;
  readonly rewards: readonly CampaignRewardData[];
}

export interface CampaignPageData {
  readonly schemaVersion: typeof CAMPAIGN_PAGE_SCHEMA_VERSION;
  readonly chapterId: typeof CAMPAIGN_CHAPTER_ID;
  readonly title: string;
  readonly subtitle: string;
  readonly levels: readonly CampaignLevelData[];
}

export type CampaignComponentState = 'ready' | 'selected' | 'locked' | 'inProgress' | 'failed' | 'cleared' | 'empty';

export interface CampaignHeaderComponent {
  readonly id: 'header';
  readonly kind: 'header';
  readonly state: 'ready';
  readonly title: string;
  readonly subtitle: string;
  readonly clearedLevels: number;
  readonly totalLevels: number;
  readonly earnedStars: number;
  readonly totalStars: number;
}

export interface CampaignLevelComponent extends Omit<CampaignLevelData, 'id'> {
  readonly id: `level-${CampaignLevelId}`;
  readonly kind: 'level';
  readonly state: Exclude<CampaignComponentState, 'empty'>;
  readonly levelId: CampaignLevelId;
  readonly selected: boolean;
  readonly unlocked: boolean;
  readonly stars: number;
  readonly active: boolean;
}

export interface CampaignDetailComponent extends Omit<CampaignLevelData, 'id'> {
  readonly id: 'detail';
  readonly kind: 'detail';
  readonly state: 'ready';
  readonly levelId: CampaignLevelId;
  readonly selected: boolean;
  readonly unlocked: boolean;
  readonly stars: number;
  readonly active: boolean;
  readonly canStart: boolean;
}

export interface CampaignEmptyComponent {
  readonly id: 'campaign-empty';
  readonly kind: 'empty';
  readonly state: 'empty';
  readonly message: string;
}

export type CampaignPageComponent = CampaignHeaderComponent | CampaignLevelComponent | CampaignDetailComponent | CampaignEmptyComponent;

export interface CampaignPageSnapshot {
  readonly schemaVersion: typeof CAMPAIGN_PAGE_SCHEMA_VERSION;
  readonly pageId: 'campaign';
  readonly selectedLevelId: CampaignLevelId | null;
  readonly activeLevelId: CampaignLevelId | null;
  readonly state: CampaignState | null;
  readonly components: readonly CampaignPageComponent[];
}

export type CampaignInteraction =
  | { readonly type: 'selectLevel'; readonly levelId: string }
  | { readonly type: 'startLevel'; readonly levelId?: string }
  | { readonly type: 'completeLevel'; readonly levelId?: string; readonly stars: number }
  | { readonly type: 'failLevel'; readonly levelId?: string };

export type CampaignInteractionReason = 'selected' | 'same' | 'started' | 'completed' | 'failed' | 'empty';

export interface CampaignInteractionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason: CampaignInteractionReason;
  readonly levelId: CampaignLevelId | null;
}

export interface CampaignPageServiceOptions {
  readonly data?: CampaignPageData;
  readonly campaign?: CampaignStateService;
  readonly stateService?: CampaignStateService;
  readonly config?: CampaignDefinition | readonly CampaignLevelDefinition[];
  readonly index?: CampaignDefinition | readonly CampaignLevelDefinition[];
  readonly levels?: readonly CampaignLevelDefinition[];
  readonly levelConfigs?: readonly CampaignLevelDefinition[];
  readonly chapterId?: string;
  readonly initialState?: CampaignState | string;
  readonly onSave?: (serialized: string) => void;
  readonly persist?: (serialized: string) => void;
}

const DEFAULT_LEVEL_TITLES = Object.freeze([
  '起程', '林道伏击', '断桥', '白鹿渡口', '异兽潮', '沉册坑',
  '旧神庙', '无名祭坛', '仙门阵眼', '龙骨关', '天序裂口', '吞册玄龟',
]);

function freezeReward(id: string, label: string, quantity: number): CampaignRewardData {
  return Object.freeze({ id, label, quantity });
}

function freezeLevel(level: CampaignLevelData): CampaignLevelData {
  return Object.freeze({ ...level, rewards: Object.freeze(level.rewards.map((reward) => freezeReward(reward.id, reward.label, reward.quantity))) });
}

export const CAMPAIGN_DEFAULT_DATA: CampaignPageData = Object.freeze({
  schemaVersion: CAMPAIGN_PAGE_SCHEMA_VERSION,
  chapterId: CAMPAIGN_CHAPTER_ID,
  title: '主线征战',
  subtitle: '第一章·白鹿古道',
  levels: Object.freeze(CAMPAIGN_LEVEL_IDS.map((id, index) => {
    const stage = index + 1;
    return freezeLevel({
      id,
      label: `1-${stage}`,
      title: DEFAULT_LEVEL_TITLES[index]!,
      description: '胜利条件：击破敌方主将。',
      objective: 'DEFEAT_ENEMY_HERO',
      recommendedPower: 1250 + stage * 105,
      staminaCost: 6,
      rewards: [
        freezeReward('SILVER', '银币', 900),
        freezeReward('ESSENCE', '法印残片', 3),
      ],
    });
  })),
});

export function createDefaultCampaignPageData(): CampaignPageData {
  return {
    schemaVersion: CAMPAIGN_DEFAULT_DATA.schemaVersion,
    chapterId: CAMPAIGN_DEFAULT_DATA.chapterId,
    title: CAMPAIGN_DEFAULT_DATA.title,
    subtitle: CAMPAIGN_DEFAULT_DATA.subtitle,
    levels: CAMPAIGN_DEFAULT_DATA.levels.map((level) => ({
      ...level,
      rewards: level.rewards.map((reward) => ({ ...reward })),
    })),
  };
}

export function createEmptyCampaignPageData(): CampaignPageData {
  return {
    schemaVersion: CAMPAIGN_PAGE_SCHEMA_VERSION,
    chapterId: CAMPAIGN_CHAPTER_ID,
    title: '主线征战',
    subtitle: '暂无已配置章节',
    levels: [],
  };
}
