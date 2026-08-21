import {
  type CampaignDetailComponent,
  type CampaignEmptyComponent,
  type CampaignHeaderComponent,
  type CampaignLevelComponent,
  type CampaignPageComponent,
  type CampaignPageData,
  type CampaignState,
} from './CampaignContracts.ts';
import { type CampaignLevelId } from '../../../../campaign/CampaignState.ts';

function emptyComponent(message: string): CampaignEmptyComponent {
  return Object.freeze({ id: 'campaign-empty', kind: 'empty', state: 'empty', message });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function cloneLevelData(data: CampaignPageData['levels'][number]): CampaignPageData['levels'][number] {
  return {
    ...data,
    rewards: data.rewards.map((reward) => ({ ...reward })),
  };
}

function stateForLevel(
  levelId: CampaignLevelId,
  state: CampaignState | null,
  selectedLevelId: CampaignLevelId | null,
): CampaignLevelComponent['state'] {
  const progress = state?.levels[levelId];
  if (!progress) return state === null && selectedLevelId === levelId ? 'selected' : 'locked';
  if (progress.lastOutcome === 'IN_PROGRESS') return 'inProgress';
  if (progress.lastOutcome === 'FAILED') return 'failed';
  if (progress.firstClear) return 'cleared';
  if (progress.unlocked && selectedLevelId === levelId) return 'selected';
  if (progress.unlocked) return 'ready';
  return 'locked';
}

function levelComponent(
  data: CampaignPageData['levels'][number],
  state: CampaignState | null,
  selectedLevelId: CampaignLevelId | null,
): CampaignLevelComponent {
  const progress = state?.levels[data.id];
  const selected = selectedLevelId === data.id;
  const unlocked = progress?.unlocked ?? (state === null && selected);
  return deepFreeze({
    ...cloneLevelData(data),
    id: `level-${data.id}` as `level-${CampaignLevelId}`,
    kind: 'level',
    state: stateForLevel(data.id, state, selectedLevelId),
    levelId: data.id,
    selected,
    unlocked,
    stars: progress?.stars ?? 0,
    active: state?.activeLevelId === data.id,
  });
}

function detailComponent(
  data: CampaignPageData['levels'][number],
  state: CampaignState | null,
  selectedLevelId: CampaignLevelId | null,
): CampaignDetailComponent {
  const progress = state?.levels[data.id];
  const selected = selectedLevelId === data.id;
  const unlocked = progress?.unlocked ?? (state === null && selected);
  const activeLevelId = state?.activeLevelId ?? null;
  return deepFreeze({
    ...cloneLevelData(data),
    id: 'detail',
    kind: 'detail',
    state: 'ready',
    levelId: data.id,
    selected,
    unlocked,
    stars: progress?.stars ?? 0,
    active: activeLevelId === data.id,
    canStart: unlocked && activeLevelId === null,
  });
}

export function createCampaignPageComponents(
  data: CampaignPageData,
  state: CampaignState | null = null,
): readonly CampaignPageComponent[] {
  if (data.levels.length === 0) return Object.freeze([emptyComponent('当前没有可征战的章节。')]);

  const visibleIds = new Set(data.levels.map((level) => level.id));
  const selectedLevelId = state === null
    ? data.levels[0]!.id
    : visibleIds.has(state.selectedLevelId)
      ? state.selectedLevelId
      : null;
  const selectedData = data.levels.find((level) => level.id === selectedLevelId) ?? data.levels[0]!;
  const visibleProgress = data.levels
    .map((level) => state?.levels[level.id])
    .filter((progress): progress is NonNullable<typeof progress> => progress !== undefined);
  const header: CampaignHeaderComponent = Object.freeze({
    id: 'header',
    kind: 'header',
    state: 'ready',
    title: data.title,
    subtitle: data.subtitle,
    clearedLevels: visibleProgress.filter((progress) => progress.firstClear).length,
    totalLevels: data.levels.length,
    earnedStars: visibleProgress.reduce((total, progress) => total + progress.stars, 0),
    totalStars: data.levels.length * 3,
  });
  const levels = data.levels.map((level) => levelComponent(level, state, selectedLevelId));
  return Object.freeze([header, ...levels, detailComponent(selectedData, state, selectedLevelId)]);
}
