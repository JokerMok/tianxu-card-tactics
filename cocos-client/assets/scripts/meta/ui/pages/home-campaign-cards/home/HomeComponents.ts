import {
  type HomeEmptyComponent,
  type HomeGoalComponent,
  type HomeGoalData,
  type HomeMissionComponent,
  type HomePageComponent,
  type HomePageData,
  type HomeQuickActionComponent,
  type HomeQuickActionData,
} from './HomeContracts.ts';

function emptyComponent(
  id: HomeEmptyComponent['id'],
  section: HomeEmptyComponent['section'],
  message: string,
): HomeEmptyComponent {
  return Object.freeze({ id, kind: 'empty', state: 'empty', section, message });
}

function missionComponent(data: NonNullable<HomePageData['mission']>): HomeMissionComponent {
  return Object.freeze({
    id: 'mission',
    kind: 'mission',
    state: 'ready',
    chapter: data.chapter,
    stage: data.stage,
    title: data.title,
    description: data.description,
    actionLabel: data.actionLabel,
    target: 'campaign',
  });
}

function quickActionComponent(data: HomeQuickActionData): HomeQuickActionComponent {
  return Object.freeze({
    id: `quick-${data.id}` as `quick-${HomeQuickActionData['id']}`,
    kind: 'quickAction',
    state: data.enabled ? 'ready' : 'disabled',
    actionId: data.id,
    title: data.title,
    value: data.value,
    target: data.target,
  });
}

function goalComponent(data: HomeGoalData, claimed: boolean): HomeGoalComponent {
  const complete = data.progress >= data.target;
  return Object.freeze({
    id: `goal-${data.id}` as `goal-${HomeGoalData['id']}`,
    kind: 'goal',
    state: claimed ? 'claimed' : complete ? 'complete' : 'ready',
    actionId: data.id,
    label: data.label,
    progress: data.progress,
    target: data.target,
    claimed,
  });
}

export function createHomePageComponents(
  data: HomePageData,
  claimedGoalIds: ReadonlySet<HomeGoalData['id']> = new Set(),
): readonly HomePageComponent[] {
  const components: HomePageComponent[] = [
    Object.freeze({
      id: 'hero',
      kind: 'hero',
      state: 'ready',
      title: data.player.name,
      subtitle: data.player.profession,
      value: `Lv.${data.player.level}`,
    }),
  ];

  components.push(data.mission
    ? missionComponent(data.mission)
    : emptyComponent('mission-empty', 'mission', '当前没有可继续的主线任务。'));

  if (data.quickActions.length === 0) {
    components.push(emptyComponent('quick-actions-empty', 'quickActions', '暂无可用快捷入口。'));
  } else {
    components.push(...data.quickActions.map(quickActionComponent));
  }

  if (data.goals.length === 0) {
    components.push(emptyComponent('goals-empty', 'goals', '今日暂无目标。'));
  } else {
    components.push(...data.goals.map((goal) => goalComponent(goal, claimedGoalIds.has(goal.id))));
  }

  return Object.freeze(components);
}
