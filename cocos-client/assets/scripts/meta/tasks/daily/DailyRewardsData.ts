import {
  DAILY_REWARDS_SCHEMA_VERSION,
  type DailyRewardCatalogConfig,
} from './DailyRewards.ts';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const config: DailyRewardCatalogConfig = {
  schemaVersion: DAILY_REWARDS_SCHEMA_VERSION,
  dailySelectionCount: 3,
  makeupWindowDays: 2,
  makeupCreditsPerWeek: 1,
  tasks: [
    { id: 'D_LOGIN', cycle: 'DAILY', title: '每日登录', target: 1, trigger: { type: 'LOGIN' }, rewardId: 'REWARD_D_LOGIN', activePoints: 10 },
    { id: 'D_BATTLE', cycle: 'DAILY', title: '完成战斗', target: 3, trigger: { type: 'BATTLE_WON' }, rewardId: 'REWARD_D_BATTLE', activePoints: 10 },
    { id: 'D_CLEAR_L01', cycle: 'DAILY', title: '通关 L01', target: 1, trigger: { type: 'LEVEL_CLEARED', sourceTable: 'levels', sourceId: 'L01' }, rewardId: 'REWARD_D_CLEAR_L01', activePoints: 15 },
    { id: 'D_DECK', cycle: 'DAILY', title: '更新牌组', target: 1, trigger: { type: 'DECK_UPDATED' }, rewardId: 'REWARD_D_DECK', activePoints: 10 },
    { id: 'D_ONLINE', cycle: 'DAILY', title: '在线 30 分钟', target: 30, trigger: { type: 'ONLINE_MINUTES' }, rewardId: 'REWARD_D_ONLINE', activePoints: 15 },
    { id: 'W_BATTLE', cycle: 'WEEKLY', title: '本周完成战斗', target: 10, trigger: { type: 'BATTLE_WON' }, rewardId: 'REWARD_W_BATTLE', activePoints: 20 },
    { id: 'W_CLEAR', cycle: 'WEEKLY', title: '本周通关 L02', target: 3, trigger: { type: 'LEVEL_CLEARED', sourceTable: 'levels', sourceId: 'L02' }, rewardId: 'REWARD_W_CLEAR', activePoints: 25 },
  ],
  rewards: [
    { id: 'REWARD_D_LOGIN', resourceId: 'silver', amount: 20 },
    { id: 'REWARD_D_BATTLE', resourceId: 'silver', amount: 40 },
    { id: 'REWARD_D_CLEAR_L01', resourceId: 'crystal', amount: 2 },
    { id: 'REWARD_D_DECK', resourceId: 'silver', amount: 30 },
    { id: 'REWARD_D_ONLINE', resourceId: 'crystal', amount: 3 },
    { id: 'REWARD_W_BATTLE', resourceId: 'silver', amount: 120 },
    { id: 'REWARD_W_CLEAR', resourceId: 'crystal', amount: 8 },
    { id: 'REWARD_ACTIVE_10', resourceId: 'silver', amount: 25 },
    { id: 'REWARD_ACTIVE_30', resourceId: 'silver', amount: 60 },
    { id: 'REWARD_ACTIVE_60', resourceId: 'crystal', amount: 5 },
    { id: 'REWARD_ONLINE_10', resourceId: 'silver', amount: 15 },
    { id: 'REWARD_ONLINE_30', resourceId: 'silver', amount: 45 },
    { id: 'REWARD_ONLINE_60', resourceId: 'crystal', amount: 4 },
  ],
  activeRewards: [
    { id: 'ACTIVE_10', threshold: 10, rewardId: 'REWARD_ACTIVE_10' },
    { id: 'ACTIVE_30', threshold: 30, rewardId: 'REWARD_ACTIVE_30' },
    { id: 'ACTIVE_60', threshold: 60, rewardId: 'REWARD_ACTIVE_60' },
  ],
  onlineRewards: [
    { id: 'ONLINE_10', threshold: 10, rewardId: 'REWARD_ONLINE_10' },
    { id: 'ONLINE_30', threshold: 30, rewardId: 'REWARD_ONLINE_30' },
    { id: 'ONLINE_60', threshold: 60, rewardId: 'REWARD_ONLINE_60' },
  ],
};

export const DAILY_REWARDS_CONFIG: DailyRewardCatalogConfig = deepFreeze(config);
export type DailyRewardsConfigData = typeof DAILY_REWARDS_CONFIG;
