import { createRng } from '../rng/index.ts';
import { evaluateObjectives, resolveOutcome } from './index.ts';

export function runOutcomeValidation(): void {
  const rng = createRng(7);
  const immediate = resolveOutcome({ heroHp: { player: 0, enemy: 3 }, round: 1, rng });
  if (immediate.status !== 'lost' || immediate.reason !== 'HERO_DEFEATED' || !immediate.settled) throw new Error('hero death resolution failed');
  const enemyDeath = resolveOutcome({ heroHp: { player: 3, enemy: 0 }, round: 1, rng });
  if (enemyDeath.status !== 'won' || enemyDeath.winner !== 'player') throw new Error('enemy death resolution failed');
  const simultaneous = resolveOutcome({ heroHp: { player: 0, enemy: 0 }, round: 4, rng });
  if (!simultaneous.settled || simultaneous.reason !== 'SIMULTANEOUS_DEATH' || simultaneous.rng.rngCursor !== 1) throw new Error('simultaneous death RNG failed');
  const limit = resolveOutcome({ heroHp: { player: 4, enemy: 4 }, round: 80, rng });
  if (!limit.settled || limit.reason !== 'ROUND_LIMIT') throw new Error('round limit tie failed');
  const objectiveContext = { round: 3, defeatedUnits: { player: 0, enemy: 2 }, heroHp: { player: 5, enemy: 4 } } as const;
  if (evaluateObjectives([{ id: 'survive', kind: 'SURVIVE_ROUNDS', target: 3 }, { id: 'kill', kind: 'DEFEAT_UNITS', target: 2 }], objectiveContext).length !== 2) throw new Error('objective evaluation failed');
  const objective = resolveOutcome({ heroHp: { player: 5, enemy: 5 }, round: 3, rng, objectives: [{ id: 'survive', kind: 'SURVIVE_ROUNDS', target: 3 }], objectiveContext });
  if (objective.status !== 'won' || objective.reason !== 'OBJECTIVE') throw new Error('objective outcome failed');
  const settled = resolveOutcome({ heroHp: { player: 5, enemy: 5 }, round: 1, rng, alreadySettled: true, settledResult: objective });
  if (settled !== objective || !settled.settled || settled.status !== 'won') throw new Error('settled guard failed');
  const reach = resolveOutcome({ heroHp: { player: 5, enemy: 5 }, round: 4, rng, objectives: [{ id: 'reach', kind: 'REACH_ROUND', target: 4 }], objectiveContext: { ...objectiveContext, round: 4 } });
  if (reach.reason !== 'OBJECTIVE' || reach.objectiveIds[0] !== 'reach') throw new Error('reach objective failed');
  const protect = evaluateObjectives([{ id: 'protect', kind: 'PROTECT_HERO', side: 'player' }], objectiveContext);
  if (protect[0] !== 'protect') throw new Error('protect objective failed');
}

runOutcomeValidation();
