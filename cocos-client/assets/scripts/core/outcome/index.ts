import { chooseSeeded, type RngState } from '../rng/index.ts';
import type { BattleStatus, Side } from '../types/index.ts';

export type OutcomeReason = 'HERO_DEFEATED' | 'SIMULTANEOUS_DEATH' | 'ROUND_LIMIT' | 'OBJECTIVE' | 'ONGOING';
export type ObjectiveKind = 'SURVIVE_ROUNDS' | 'DEFEAT_UNITS' | 'PROTECT_HERO' | 'REACH_ROUND';

export interface Objective {
  readonly id: string;
  readonly kind: ObjectiveKind;
  readonly target?: number;
  readonly side?: Side;
}

export interface ObjectiveContext {
  readonly round: number;
  readonly defeatedUnits: Readonly<Record<Side, number>>;
  readonly heroHp: Readonly<Record<Side, number>>;
}

export interface OutcomeInput {
  readonly heroHp: Readonly<Record<Side, number>>;
  readonly round: number;
  readonly maxRounds?: number;
  readonly rng: RngState;
  readonly objectives?: readonly Objective[];
  readonly objectiveContext?: ObjectiveContext;
  readonly alreadySettled?: boolean;
  readonly settledResult?: OutcomeResult;
}

export interface OutcomeResult {
  readonly status: BattleStatus;
  readonly winner?: Side;
  readonly reason: OutcomeReason;
  readonly round: number;
  readonly rng: RngState;
  readonly objectiveIds: readonly string[];
  readonly settled: boolean;
}

function winnerBySeed(rng: RngState): { winner: Side; rng: RngState } {
  const result = chooseSeeded(rng, ['player', 'enemy'] as const);
  return { winner: result.value ?? 'player', rng: result.state };
}

function objectiveMet(objective: Objective, context: ObjectiveContext): boolean {
  const target = objective.target ?? 1;
  if (objective.kind === 'SURVIVE_ROUNDS' || objective.kind === 'REACH_ROUND') return context.round >= target;
  if (objective.kind === 'DEFEAT_UNITS') return (context.defeatedUnits[objective.side ?? 'enemy'] ?? 0) >= target;
  if (objective.kind === 'PROTECT_HERO') return (context.heroHp[objective.side ?? 'player'] ?? 0) > 0;
  return false;
}

export function evaluateObjectives(objectives: readonly Objective[] = [], context?: ObjectiveContext): readonly string[] {
  if (!context) return [];
  return objectives.filter((objective) => objectiveMet(objective, context)).map((objective) => objective.id);
}

export function resolveOutcome(input: OutcomeInput): OutcomeResult {
  if (input.alreadySettled) {
    if (!input.settledResult?.settled) throw new Error('settledResult is required for an idempotent outcome check');
    return input.settledResult;
  }
  const playerDead = input.heroHp.player <= 0;
  const enemyDead = input.heroHp.enemy <= 0;
  if (playerDead || enemyDead) {
    if (playerDead && enemyDead) {
      const tie = winnerBySeed(input.rng);
      return { status: tie.winner === 'player' ? 'won' : 'lost', winner: tie.winner, reason: 'SIMULTANEOUS_DEATH', round: input.round, rng: tie.rng, objectiveIds: [], settled: true };
    }
    const winner: Side = playerDead ? 'enemy' : 'player';
    return { status: winner === 'player' ? 'won' : 'lost', winner, reason: 'HERO_DEFEATED', round: input.round, rng: input.rng, objectiveIds: [], settled: true };
  }
  const objectiveIds = evaluateObjectives(input.objectives, input.objectiveContext);
  if (input.objectives?.length && objectiveIds.length === input.objectives.length) {
    return { status: 'won', winner: 'player', reason: 'OBJECTIVE', round: input.round, rng: input.rng, objectiveIds, settled: true };
  }
  const maxRounds = input.maxRounds ?? 80;
  if (input.round >= maxRounds) {
    if (input.heroHp.player === input.heroHp.enemy) {
      const tie = winnerBySeed(input.rng);
      return { status: tie.winner === 'player' ? 'won' : 'lost', winner: tie.winner, reason: 'ROUND_LIMIT', round: input.round, rng: tie.rng, objectiveIds, settled: true };
    }
    const winner: Side = input.heroHp.player > input.heroHp.enemy ? 'player' : 'enemy';
    return { status: winner === 'player' ? 'won' : 'lost', winner, reason: 'ROUND_LIMIT', round: input.round, rng: input.rng, objectiveIds, settled: true };
  }
  return { status: 'playing', reason: 'ONGOING', round: input.round, rng: input.rng, objectiveIds, settled: false };
}
