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

function stateForLevel(
  levelId: CampaignLevelId,
  state: CampaignState | null,
): CampaignLevelComponent['state'] {
  const progress = state?.levels[levelId];
  if (!progress) return levelId === 'L01' ? 'selected' : 'locked';
  if (progress.lastOutcome === 'IN_PROGRESS') return 'inProgress';
  if (progress.lastOutcome === 'FAILED') return 'failed';
  if (progress.firstClear) return 'cleared';
  if (progress.unlocked && state.selectedLevelId === levelId) return 'selected';
  if (progress.unlocked) return 'ready';
  return 'locked';
}

function levelComponent(
  data: CampaignPageData['levels'][number],
  state: CampaignState | null,
): CampaignLevelComponent {
  const progress = state?.levels[data.id];
  const selected = state === null ? data.id === 'L01' : state.selectedLevelId === data.id;
  const unlocked = progress?.unlocked ?? data.id === 'L01';
  return Object.freeze({
    ...data,
    id: `level-${data.id}` as `level-${CampaignLevelId}`,
    kind: 'level',
    state: stateForLevel(data.id, state),
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
): CampaignDetailComponent {
  const progress = state?.levels[data.id];
  const selected = state === null ? data.id === 'L01' : state.selectedLevelId === data.id;
  const unlocked = progress?.unlocked ?? data.id === 'L01';
  const activeLevelId = state?.activeLevelId ?? null;
  return Object.freeze({
    ...data,
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
  const selectedLevelId = state && visibleIds.has(state.selectedLevelId)
    ? state.selectedLevelId
    : data.levels[0]!.id;
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
  const levels = data.levels.map((level) => levelComponent(level, state));
  return Object.freeze([header, ...levels, detailComponent(selectedData, state)]);
}
