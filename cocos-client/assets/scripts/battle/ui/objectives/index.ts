import {
  normalizeObjectiveConfigs,
  validateObjectiveState,
  type ObjectiveConfig,
  type ObjectiveConfigInput,
  type ObjectiveProgress,
  type ObjectiveState,
  type ObjectiveType,
} from '../../../core/outcome/objectives/index.ts';

export const OBJECTIVE_UI_SCHEMA_VERSION = 1 as const;

export interface ObjectiveViewModel {
  readonly id: string;
  readonly type: ObjectiveType;
  readonly label: string;
  readonly description?: string;
  readonly status: ObjectiveProgress['status'];
  readonly current: number;
  readonly target: number;
  readonly progress: number;
  readonly targetId?: string;
  readonly targetSide?: 'player' | 'enemy';
  readonly currentHp: number | null;
  readonly minHp?: number;
  readonly remainingMs?: number;
  readonly timeLimitMs?: number;
  readonly durationMs?: number;
}

export interface ObjectivePanelViewModel {
  readonly schemaVersion: typeof OBJECTIVE_UI_SCHEMA_VERSION;
  readonly lifecycle: ObjectiveState['lifecycle'];
  readonly settled: boolean;
  readonly elapsedMs: number;
  readonly objectives: readonly ObjectiveViewModel[];
}

const DEFAULT_LABELS: Readonly<Record<ObjectiveType, string>> = Object.freeze({
  KILL: '击杀目标',
  DEFEND: '防守目标',
  TIMED: '限时目标',
  SURVIVE: '存活目标',
});

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function ratio(progress: ObjectiveProgress, elapsedMs: number): number {
  if (progress.type === 'DEFEND') return progress.currentHp === null ? 0 : Math.min(1, progress.currentHp / progress.target);
  if (progress.target <= 0) return 0;
  const current = progress.type === 'SURVIVE' ? Math.min(elapsedMs, progress.target) : progress.current;
  return Math.min(1, current / progress.target);
}

export function createObjectivePanelViewModel(
  configs: readonly ObjectiveConfigInput[],
  state: ObjectiveState,
): ObjectivePanelViewModel {
  const normalized = normalizeObjectiveConfigs(configs);
  validateObjectiveState(state, normalized);
  if (normalized.length !== state.objectives.length || normalized.some((config, index) => {
    const progress = state.objectives[index];
    const target = config.type === 'DEFEND' ? config.minHp : config.type === 'TIMED' ? config.count : config.type === 'KILL' ? config.count : config.durationMs;
    return config.id !== progress.id
      || config.type !== progress.type
      || target !== progress.target
      || config.targetId !== progress.targetId
      || config.targetSide !== progress.targetSide
      || config.type === 'DEFEND' && config.minHp !== progress.minHp
      || config.type === 'TIMED' && config.timeLimitMs !== progress.timeLimitMs
      || config.type === 'SURVIVE' && config.durationMs !== progress.durationMs;
  })) {
    throw new Error('objective UI configuration does not match state');
  }
  const objectives = normalized.map((config, index) => {
    const progress = state.objectives[index];
    const view: ObjectiveViewModel = {
      id: progress.id,
      type: progress.type,
      label: config.label ?? DEFAULT_LABELS[config.type],
      ...(config.description === undefined ? {} : { description: config.description }),
      status: progress.status,
      current: progress.current,
      target: progress.target,
      progress: ratio(progress, state.elapsedMs),
      ...(progress.targetId === undefined ? {} : { targetId: progress.targetId }),
      ...(progress.targetSide === undefined ? {} : { targetSide: progress.targetSide }),
      currentHp: progress.currentHp,
      ...(progress.minHp === undefined ? {} : { minHp: progress.minHp }),
      ...(progress.timeLimitMs === undefined ? {} : { timeLimitMs: progress.timeLimitMs, remainingMs: Math.max(0, progress.timeLimitMs - state.elapsedMs) }),
      ...(progress.durationMs === undefined ? {} : { durationMs: progress.durationMs, remainingMs: Math.max(0, progress.durationMs - state.elapsedMs) }),
    };
    return freezeDeep(view);
  });
  return freezeDeep({
    schemaVersion: OBJECTIVE_UI_SCHEMA_VERSION,
    lifecycle: state.lifecycle,
    settled: state.settled,
    elapsedMs: state.elapsedMs,
    objectives,
  });
}

export class ObjectivePanelService {
  readonly configs: readonly ObjectiveConfig[];

  constructor(configs: readonly ObjectiveConfigInput[]) {
    this.configs = normalizeObjectiveConfigs(configs);
  }

  render(state: ObjectiveState): ObjectivePanelViewModel {
    return createObjectivePanelViewModel(this.configs, state);
  }
}
